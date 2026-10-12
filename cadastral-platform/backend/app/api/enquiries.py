"""POST /enquiries: "Talk to a civil engineer". Public (anonymous visitors) and signed-in (X-User-Id) submissions.

Stored first (core.enquiries), then delivered in the background; delivery failure never loses the enquiry.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Header, Request, UploadFile
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, ValidationError, field_validator

from app.api.deps import ApiError, optional_user_id
from app.api.uploads import _ACTIVE, safe_filename
from app.common.db import user_connection
from app.notify import build_notifier, deliver, retry_pending

router = APIRouter()

CONSENT_VERSION = "enquiry-consent-2026-10-12"
ENQUIRY_TYPES = ("civil_design", "earthworks_retaining", "driveway_stormwater", "services", "subdivision",
                 "flood_bushfire", "site_plan_certification", "other")
MAX_TOTAL_BYTES = 25 * 1024 * 1024
MAX_FILES = 10
MAX_CONTEXT_BYTES = 64 * 1024
ALLOWED_EXT = {".pdf": "application/pdf", ".dxf": "image/vnd.dxf", ".png": "image/png", ".jpg": "image/jpeg",
               ".jpeg": "image/jpeg", ".webp": "image/webp"}
_DXF_OK_TYPES = {"application/dxf", "image/vnd.dxf", "image/x-dxf", "application/x-dxf", "application/octet-stream", "text/plain", ""}


class EnquiryIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: str = Field(min_length=3, max_length=320)
    phone: str | None = Field(default=None, max_length=40)
    company: str | None = Field(default=None, max_length=200)
    role: Literal["homeowner", "builder", "designer", "developer", "other"] = "other"
    enquiry_types: list[str] = Field(default_factory=list, max_length=len(ENQUIRY_TYPES))
    message: str = Field(min_length=1, max_length=5000)
    address: str | None = Field(default=None, max_length=500)
    lot_plan: str | None = Field(default=None, max_length=100)
    preferred_contact: Literal["email", "phone", "either"] = "email"
    timeframe: str | None = Field(default=None, max_length=100)
    project_id: UUID | None = None
    share_context: bool = False
    consent: bool
    consent_version: str = Field(max_length=100)

    @field_validator("name", "message")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("required")
        return v

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip()
        if not re.fullmatch(r"[A-Za-z0-9._%+\-']+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}", v):
            raise ValueError("invalid email address")
        return v

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        if v and not re.fullmatch(r"[0-9 +()\-.]{6,40}", v):
            raise ValueError("invalid phone number")
        return v or None

    @field_validator("enquiry_types")
    @classmethod
    def _types(cls, v: list[str]) -> list[str]:
        bad = [t for t in v if t not in ENQUIRY_TYPES]
        if bad:
            raise ValueError(f"unknown enquiry type: {bad[0]}")
        return list(dict.fromkeys(v))

    @field_validator("consent")
    @classmethod
    def _consent(cls, v: bool) -> bool:
        if v is not True:
            raise ValueError("consent is required")
        return v


# ---------------------------------------------------------------- rate limiting
class TokenBucket:
    """Simple in-memory per-key token bucket (per process; the DB count is the cross-process backstop)."""

    def __init__(self, capacity: int = 5, refill_per_sec: float = 5 / 3600, clock=time.monotonic) -> None:
        self.capacity, self.rate, self.clock = capacity, refill_per_sec, clock
        self._b: dict[str, tuple[float, float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        with self._lock:
            now = self.clock()
            tokens, last = self._b.get(key, (float(self.capacity), now))
            tokens = min(self.capacity, tokens + (now - last) * self.rate)
            ok = tokens >= 1
            self._b[key] = (tokens - 1 if ok else tokens, now)
            if len(self._b) > 10_000:
                self._b = {k: v for k, v in self._b.items() if v[0] < self.capacity}
            return ok


DB_LIMIT_PER_HOUR = int(os.environ.get("ENQUIRY_MAX_PER_IP_HOUR", "10"))


def client_ip(request: Request) -> str | None:
    """Direct peer address. Behind a trusted proxy set ENQUIRY_TRUST_XFF=1 to use the first X-Forwarded-For hop."""
    if os.environ.get("ENQUIRY_TRUST_XFF") == "1":
        xff = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if xff:
            return xff
    return request.client.host if request.client else None


def _valid_ip(ip: str | None) -> str | None:
    import ipaddress
    try:
        return str(ipaddress.ip_address(ip)) if ip else None
    except ValueError:
        return None


# ---------------------------------------------------------------- attachments
def _sniff_ok(ext: str, head: bytes) -> bool:
    if ext == ".pdf":
        return head.startswith(b"%PDF-")
    if ext == ".png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if ext in (".jpg", ".jpeg"):
        return head.startswith(b"\xff\xd8\xff")
    if ext == ".webp":
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    if ext == ".dxf":
        return head.startswith(b"AutoCAD Binary DXF") or b"SECTION" in head[:2048] or head.lstrip()[:1] == b"0"
    return False


def validate_and_store(files: list[UploadFile], root: Path) -> list[dict]:
    if len(files) > MAX_FILES:
        raise ApiError(413, "TOO_MANY_FILES", f"at most {MAX_FILES} files")
    out, total = [], 0
    root.mkdir(parents=True, exist_ok=True)
    for f in files:
        name = safe_filename(f.filename or "file")
        ext = os.path.splitext(name)[1].lower()
        if ext not in ALLOWED_EXT:
            raise ApiError(415, "UNSUPPORTED_MEDIA_TYPE", f"{name}: only PDF, DXF, PNG, JPG and WEBP files are accepted")
        ct = (f.content_type or "").split(";")[0].strip().lower()
        expected = ALLOWED_EXT[ext]
        ok_ct = ct == expected or (ext == ".dxf" and ct in _DXF_OK_TYPES) or (ext == ".pdf" and ct == "application/x-pdf")
        if not ok_ct:
            raise ApiError(415, "MIME_MISMATCH", f"{name}: content type {ct or 'missing'} does not match the file extension")
        data = f.file.read(MAX_TOTAL_BYTES - total + 1)
        total += len(data)
        if total > MAX_TOTAL_BYTES:
            raise ApiError(413, "FILES_TOO_LARGE", "attachments are limited to 25 MB in total")
        if not data:
            raise ApiError(400, "EMPTY_FILE", f"{name} is empty")
        if not _sniff_ok(ext, data[:2048]):
            raise ApiError(415, "CONTENT_MISMATCH", f"{name}: file content does not match its type")
        if ext == ".pdf" and _ACTIVE.search(data):
            raise ApiError(422, "PDF_ACTIVE_CONTENT", f"{name}: PDFs with scripts or embedded files are rejected")
        sha = hashlib.sha256(data).hexdigest()
        p = root / sha[:2] / f"{sha}{ext}"
        p.parent.mkdir(parents=True, exist_ok=True)
        if not p.exists():
            tmp = p.with_suffix(p.suffix + ".part")
            tmp.write_bytes(data)
            os.replace(tmp, p)
            p.chmod(0o444)
        out.append({"filename": name, "content_type": expected, "byte_size": len(data), "sha256": sha,
                    "storage_path": str(p)})
    return out


def _upload_root(request: Request) -> Path:
    env = os.environ.get("ENQUIRY_UPLOAD_DIR")
    if env:
        return Path(env)
    return Path(getattr(request.app.state.settings, "upload_dir", "./var/uploads")) / "enquiries"


def _reference() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return f"ENQ-{datetime.now(timezone.utc):%Y%m%d}-" + "".join(secrets.choice(alphabet) for _ in range(6))


def _bucket(request: Request) -> TokenBucket:
    b = getattr(request.app.state, "enquiry_bucket", None)
    if b is None:
        b = request.app.state.enquiry_bucket = TokenBucket()
    return b


def _notifier(request: Request):
    n = getattr(request.app.state, "enquiry_notifier", None)
    if n is None:
        n = request.app.state.enquiry_notifier = build_notifier()
    return n


def _run_delivery(pool, notifier, enquiry_id: UUID) -> None:
    with pool.connection() as conn:
        row = conn.execute("SELECT * FROM core.enquiry_load(%s)", (enquiry_id,)).fetchone()
    if row:
        deliver(pool, notifier, row)


# ---------------------------------------------------------------- endpoints
@router.post("/enquiries", status_code=201)
def post_enquiry(
    request: Request, background: BackgroundTasks,
    name: str = Form(""), email: str = Form(""), phone: str = Form(""), company: str = Form(""),
    role: str = Form("other"), enquiry_types: list[str] = Form(default=[]), message: str = Form(""),
    address: str = Form(""), lot_plan: str = Form(""), preferred_contact: str = Form("email"),
    timeframe: str = Form(""), project_id: str = Form(""), share_context: bool = Form(False),
    context_json: str = Form(""), consent: bool = Form(False), consent_version: str = Form(""),
    website: str = Form(""),                                     # honeypot: humans leave it empty
    files: list[UploadFile] = File(default=[]),
    user_id: UUID | None = Depends(optional_user_id),
    user_agent: str | None = Header(default=None),
):
    ip = _valid_ip(client_ip(request))
    if website.strip():          # bot: pretend success, store nothing
        return {"reference": _reference(), "status": "new"}
    if not _bucket(request).allow(ip or "unknown"):
        raise ApiError(429, "RATE_LIMITED", "Too many enquiries from your network. Please try again later.")
    try:
        data = EnquiryIn(
            name=name, email=email, phone=phone or None, company=company.strip() or None, role=role,
            enquiry_types=enquiry_types, message=message, address=address.strip() or None,
            lot_plan=lot_plan.strip() or None, preferred_contact=preferred_contact, timeframe=timeframe.strip() or None,
            project_id=project_id or None, share_context=share_context, consent=consent, consent_version=consent_version)
    except ValidationError as e:
        errs = {".".join(str(x) for x in err["loc"]): err["msg"] for err in e.errors()}
        raise ApiError(422, "VALIDATION_FAILED", "Please check the form.", fields=errs) from None

    ctx = None
    if data.share_context and context_json.strip():
        if len(context_json.encode()) > MAX_CONTEXT_BYTES:
            raise ApiError(413, "CONTEXT_TOO_LARGE", "project summary is too large")
        try:
            ctx = json.loads(context_json)
        except ValueError:
            raise ApiError(422, "VALIDATION_FAILED", "context_json is not valid JSON", fields={"context_json": "invalid"}) from None
        if not isinstance(ctx, dict):
            raise ApiError(422, "VALIDATION_FAILED", "context_json must be an object", fields={"context_json": "invalid"})

    pool = request.app.state.pool
    with pool.connection() as conn:   # DB-backed per-IP count (survives restarts, shared across workers)
        if ip and conn.execute("SELECT core.enquiry_recent_count(%s, interval '1 hour') AS n", (ip,)).fetchone()["n"] >= DB_LIMIT_PER_HOUR:
            raise ApiError(429, "RATE_LIMITED", "Too many enquiries from your network. Please try again later.")

    stored = validate_and_store(list(files), _upload_root(request))   # after cheap checks so abuse costs little
    eid, ref = uuid4(), _reference()
    pid = data.project_id
    with user_connection(pool, user_id) as conn:
        if pid is not None:
            if user_id is None:
                pid = None      # anonymous visitors cannot link a project
            else:
                ok = conn.execute("SELECT core.can_access_project(%s) AS ok", (pid,)).fetchone()["ok"]
                if not ok:
                    raise ApiError(404, "PROJECT_NOT_FOUND", "project not found")
        if user_id is not None and conn.execute("SELECT 1 FROM core.users WHERE user_id=%s", (user_id,)).fetchone() is None:
            user_id = None
            conn.execute("SELECT set_config('app.user_id', '', true)")
        conn.execute(
            "INSERT INTO core.enquiries (enquiry_id, reference, submitter_user_id, name, email, phone, company, role, "
            "preferred_contact, timeframe, enquiry_types, message, address, lot_plan, project_id, share_context, context_json, "
            "attachments, consent_version, consent_at, ip, user_agent) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now(),%s,%s)",
            (eid, ref, user_id, data.name, str(data.email), data.phone, data.company, data.role, data.preferred_contact,
             data.timeframe, data.enquiry_types, data.message, data.address, data.lot_plan, pid, data.share_context,
             Jsonb(ctx) if (data.share_context and ctx is not None) else None, Jsonb(stored), data.consent_version or CONSENT_VERSION,
             ip, (user_agent or "")[:500] or None))
    background.add_task(_run_delivery, pool, _notifier(request), eid)
    return {"reference": ref, "status": "new"}


def _partner_ok(token: str | None) -> bool:
    want = os.environ.get("ENQUIRY_PARTNER_TOKEN", "")
    return bool(want) and bool(token) and secrets.compare_digest(want, token)


@router.post("/enquiries/retry")
def retry(request: Request, x_partner_token: str | None = Header(default=None)):
    """Re-attempt undelivered enquiries (also: python -m app.notify.dispatch). Guarded by ENQUIRY_PARTNER_TOKEN."""
    if not _partner_ok(x_partner_token):
        raise ApiError(403, "FORBIDDEN", "partner token required")
    return {"attempted": retry_pending(request.app.state.pool, _notifier(request))}


@router.get("/enquiries/{reference}/attachments/{index}")
def get_attachment(reference: str, index: int, request: Request, x_partner_token: str | None = Header(default=None)):
    """Download an attachment (for the partner's email links). Guarded by ENQUIRY_PARTNER_TOKEN."""
    from fastapi.responses import FileResponse
    if not _partner_ok(x_partner_token):
        raise ApiError(403, "FORBIDDEN", "partner token required")
    with request.app.state.pool.connection() as conn:
        row = conn.execute("SELECT core.enquiry_attachments(%s) AS attachments", (reference,)).fetchone()
    atts = (row or {}).get("attachments") or []
    if row is None or not (0 <= index < len(atts)):
        raise ApiError(404, "NOT_FOUND", "attachment not found")
    a = atts[index]
    return FileResponse(a["storage_path"], media_type=a["content_type"], filename=a["filename"])
