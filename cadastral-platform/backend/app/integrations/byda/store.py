"""Project private DBYD storage: ``<base>/<project_id>/dbyd/`` holds the enquiry log, webhook events, the uploaded plan files and their index.

Nothing here is shared across projects or users: the folder belongs to one project, and every route that reaches it first checks the caller's access to that project.
Caps (sanity limits, not engineering values): ``MAX_PLAN_BYTES`` per file, ``MAX_PLANS`` per project, ``MAX_ENQUIRIES`` and ``MAX_EVENTS`` records.

WRITES. Every JSON store is written atomically (a unique temporary file in the same folder, flushed, then renamed over the target) and every read-modify-write holds a per file
lock (``app.common.filestore.file_lock``: a thread lock and an ``fcntl`` lock on ``<file>.lock``), so two worker processes cannot interleave and a reader never sees a half
written file.

LODGEMENTS. An enquiry is written as a PENDING record with a client reference BEFORE the call to BYDA and then finished (LODGED, FAILED) or marked UNKNOWN. A project with a
PENDING or UNKNOWN record refuses a new lodgement until the user resolves it (``resolve_lodgement``).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.common.filestore import atomic_write_bytes, atomic_write_json, file_lock, file_locks

MAX_PLAN_BYTES = 25 * 1024 * 1024
MAX_PLANS = 100
MAX_ENQUIRIES = 500
MAX_EVENTS = 200
#: webhook delivery ids are remembered this long (longer than twice the accepted timestamp skew) and at most this many
DELIVERY_ID_TTL_S = 3600
MAX_DELIVERY_IDS = 2000
#: a PENDING lodgement older than this (several request timeouts) is treated as UNKNOWN: the process that began it is gone or the call hung
PENDING_STALE_S = 120
#: the status shown on a lodgement whose outcome is not known
UNKNOWN_STATUS = "LODGEMENT OUTCOME UNKNOWN, CHECK BYDA PORTAL"
PENDING_STATUS = "LODGEMENT IN PROGRESS"
_ID = re.compile(r"^[0-9a-f]{32}$")
PLAN_KINDS = {".pdf": "pdf", ".dwf": "dwf", ".dwfx": "dwf", ".dxf": "dxf"}
#: declared content types accepted per kind (octet-stream and an empty type are always accepted: the content check below is the real test)
CONTENT_TYPES = {"pdf": {"application/pdf"}, "dwf": {"model/vnd.dwf", "application/x-dwf", "drawing/x-dwf", "application/vnd.autodesk.dwf"},
                 "dxf": {"image/vnd.dxf", "application/dxf", "application/x-dxf", "image/x-dxf", "text/plain"}}


class StoreError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def safe_name(name: str | None, default: str = "plan") -> str:
    base = os.path.basename((name or default).replace("\\", "/"))
    out = "".join(c if c.isalnum() or c in "._ -()" else "_" for c in base)[:200].strip(" .")
    return out or default


def classify_plan(name: str, content_type: str | None, head: bytes) -> str:
    """The kind (pdf, dwf, dxf) of an uploaded plan: the extension decides the kind, the declared content type must not contradict it, and the first bytes must match."""
    ext = os.path.splitext(name.lower())[1]
    kind = PLAN_KINDS.get(ext)
    if kind is None:
        raise StoreError(415, "UNSUPPORTED_FILE_TYPE", "UPLOAD A PDF, DWF OR DXF PLAN")
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct and ct != "application/octet-stream" and ct not in CONTENT_TYPES[kind]:
        raise StoreError(415, "CONTENT_TYPE_MISMATCH", f"THE CONTENT TYPE {ct.upper()} DOES NOT MATCH A {kind.upper()} FILE")
    ok = False
    if kind == "pdf":
        ok = head.startswith(b"%PDF-")
    elif kind == "dwf":
        ok = head.startswith(b"(DWF V") or head.startswith(b"PK\x03\x04")                 # a DWF, or a DWFx (a zip package)
    else:
        ok = bool(re.match(rb"^(\xef\xbb\xbf)?\s*0\s*\r?\n\s*SECTION", head[:64])) or head.startswith(b"AutoCAD Binary DXF")
    if not ok:
        raise StoreError(422, "CONTENT_MISMATCH", f"THE FILE CONTENT IS NOT A {kind.upper()} FILE")
    return kind


class DbydStore:
    def __init__(self, project_folder: Path) -> None:
        self.dir = project_folder / "dbyd"

    # ---- json files
    def _path(self, name: str) -> Path:
        return self.dir / name

    def _read(self, name: str) -> list[dict[str, Any]]:
        try:
            v = json.loads(self._path(name).read_text(encoding="utf-8"))
            return v if isinstance(v, list) else []
        except (OSError, ValueError):
            return []

    def _write(self, name: str, rows: list[dict[str, Any]]) -> None:
        """Atomic write. Callers that read first hold ``file_lock`` of the same file around the read and the write."""
        atomic_write_json(self._path(name), rows)

    def exists(self) -> bool:
        return self.dir.is_dir()

    # ---- enquiries
    def enquiries(self) -> list[dict[str, Any]]:
        return self._read("enquiries.json")

    def add_enquiry(self, rec: dict[str, Any]) -> None:
        with file_lock(self._path("enquiries.json")):
            rows = self.enquiries()
            rows.append(rec)
            self._write("enquiries.json", rows[-MAX_ENQUIRIES:])

    def merge_enquiries(self, remote: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Update the stored enquiries of this project from BYDA's list: only enquiries this project lodged (matched by id or job number) are updated; others are NOT added,
        so one project never shows another project's enquiries. A record whose lodgement outcome is unknown is not touched: the user resolves it."""
        with file_lock(self._path("enquiries.json")):
            rows = self.enquiries()
            for r in rows:
                if r.get("lodge_state") in ("pending", "unknown"):
                    continue
                for x in remote:
                    if (x.get("id") is not None and x.get("id") == r.get("id")) or (x.get("job_number") is not None and x.get("job_number") == r.get("job_number")):
                        for k in ("status", "expires_at", "job_number", "id"):
                            if x.get(k) is not None:
                                r[k] = x[k]
                        r["refreshed_at"] = now_iso()
            self._write("enquiries.json", rows)
            return rows

    # ---- lodgement records (pending before the call, finished or unknown after it)
    def _stale_to_unknown(self, rows: list[dict[str, Any]]) -> bool:
        changed = False
        for r in rows:
            if r.get("lodge_state") == "pending" and time.time() - float(r.get("requested_epoch") or 0) > PENDING_STALE_S:
                r.update({"lodge_state": "unknown", "status": UNKNOWN_STATUS})
                changed = True
        return changed

    def blocking_lodgement(self) -> dict[str, Any] | None:
        """The record that stops a new lodgement for this project: one still PENDING (in progress) or UNKNOWN (outcome not known), else None."""
        with file_lock(self._path("enquiries.json")):
            rows = self.enquiries()
            if self._stale_to_unknown(rows):
                self._write("enquiries.json", rows)
            return next((r for r in rows if r.get("lodge_state") in ("pending", "unknown")), None)

    def begin_lodgement(self, rec: dict[str, Any]) -> dict[str, Any]:
        """Write the PENDING record (with its client reference) before BYDA is called. Refuses with 409 while another lodgement is pending or unknown for this project."""
        with file_lock(self._path("enquiries.json")):
            rows = self.enquiries()
            if self._stale_to_unknown(rows):
                self._write("enquiries.json", rows)
            blocking = next((r for r in rows if r.get("lodge_state") in ("pending", "unknown")), None)
            if blocking is not None:
                if blocking["lodge_state"] == "pending":
                    raise StoreError(409, "LODGEMENT_IN_PROGRESS", "ANOTHER LODGEMENT FOR THIS PROJECT IS IN PROGRESS; WAIT FOR IT TO FINISH")
                raise StoreError(409, "LODGEMENT_OUTCOME_UNKNOWN", f"{UNKNOWN_STATUS}. A PREVIOUS LODGEMENT (REFERENCE {str(blocking.get('client_ref', '')).upper()}) MAY OR MAY NOT HAVE REACHED "
                                 "BYDA. CHECK THE BYDA PORTAL AND RECORD WHAT YOU FOUND BEFORE LODGING AGAIN")
            row = {**rec, "client_ref": uuid.uuid4().hex, "lodge_state": "pending", "status": PENDING_STATUS, "requested_at": now_iso(), "requested_epoch": time.time()}
            rows.append(row)
            self._write("enquiries.json", rows[-MAX_ENQUIRIES:])
            return row

    def update_lodgement(self, client_ref: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        with file_lock(self._path("enquiries.json")):
            rows = self.enquiries()
            hit = next((r for r in rows if r.get("client_ref") == client_ref), None)
            if hit is None:
                return None
            hit.update(fields)
            self._write("enquiries.json", rows)
            return hit

    def resolve_lodgement(self, client_ref: str, outcome: str, job_number: str | None = None, enquiry_id: str | None = None, by: str | None = None) -> dict[str, Any]:
        """The user's statement after checking the BYDA portal: ``not_lodged`` (nothing reached BYDA: a new lodgement is allowed) or ``lodged`` (it did; the job number or
        enquiry id the user read off the portal is recorded as entered by the user)."""
        with file_lock(self._path("enquiries.json")):
            rows = self.enquiries()
            hit = next((r for r in rows if r.get("client_ref") == client_ref), None)
            if hit is None:
                raise StoreError(404, "ENQUIRY_NOT_FOUND", "NO SUCH LODGEMENT IN THIS PROJECT")
            if hit.get("lodge_state") != "unknown":
                raise StoreError(409, "NOT_UNRESOLVED", "ONLY A LODGEMENT WHOSE OUTCOME IS UNKNOWN CAN BE RESOLVED")
            if outcome == "not_lodged":
                hit.update({"lodge_state": "failed", "status": "NOT LODGED (CONFIRMED BY THE USER ON THE BYDA PORTAL)"})
            elif outcome == "lodged":
                if not (job_number or enquiry_id):
                    raise StoreError(422, "REFERENCE_REQUIRED", "ENTER THE JOB NUMBER OR ENQUIRY ID SHOWN ON THE BYDA PORTAL")
                hit.update({"lodge_state": "lodged", "status": "LODGED (RECORDED BY THE USER FROM THE BYDA PORTAL)", "job_number": job_number or hit.get("job_number"), "id": enquiry_id or hit.get("id"),
                            "reference_source": "ENTERED BY THE USER"})
            else:
                raise StoreError(422, "BAD_OUTCOME", "THE OUTCOME MUST BE not_lodged OR lodged")
            hit.update({"resolved_at": now_iso(), "resolved_by": by})
            self._write("enquiries.json", rows)
            return hit

    # ---- webhook events
    def add_event(self, ev: dict[str, Any]) -> None:
        with file_locks(self._path("events.json"), self._path("enquiries.json")):
            rows = self._read("events.json")
            rows.append(ev)
            self._write("events.json", rows[-MAX_EVENTS:])
            q = self.enquiries()
            changed = False
            for r in q:
                if ev.get("enquiry_id") is not None and ev["enquiry_id"] in (r.get("id"), r.get("job_number")):
                    r["last_event_at"], changed = ev["received_at"], True
                    if ev.get("status") and r.get("lodge_state") not in ("pending", "unknown"):
                        r["status"] = ev["status"]
            if changed:
                self._write("enquiries.json", q)

    def events(self) -> list[dict[str, Any]]:
        return self._read("events.json")

    def claim_delivery(self, delivery_id: str, now: float | None = None) -> bool:
        """Remember a webhook delivery id. False when it was already seen within ``DELIVERY_ID_TTL_S`` (a replay); True when it is new (and is now remembered)."""
        t = time.time() if now is None else now
        with file_lock(self._path("webhook_ids.json")):
            rows = [r for r in self._read("webhook_ids.json") if t - float(r.get("at", 0)) < DELIVERY_ID_TTL_S]
            if any(r.get("id") == delivery_id for r in rows):
                return False
            rows.append({"id": delivery_id, "at": t})
            self._write("webhook_ids.json", rows[-MAX_DELIVERY_IDS:])
            return True

    # ---- plans
    def plans(self) -> list[dict[str, Any]]:
        return self._read("plans.json")

    def add_plan(self, name: str, kind: str, data: bytes, meta: dict[str, Any]) -> dict[str, Any]:
        with file_lock(self._path("plans.json")):
            rows = self.plans()
            if len(rows) >= MAX_PLANS:
                raise StoreError(409, "TOO_MANY_PLANS", f"THIS PROJECT ALREADY HAS {MAX_PLANS} PLANS; DELETE ONE FIRST")
            pid = uuid.uuid4().hex
            (self.dir / "plans").mkdir(parents=True, exist_ok=True)
            ext = {"pdf": ".pdf", "dwf": ".dwf", "dxf": ".dxf"}[kind]
            atomic_write_bytes(self.dir / "plans" / (pid + ext), data)
            rec = {"plan_id": pid, "name": name, "kind": kind, "size_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "uploaded_at": now_iso(), **meta}
            rows.append(rec)
            self._write("plans.json", rows)
            return rec

    def plan(self, plan_id: str) -> tuple[dict[str, Any], Path] | None:
        if not _ID.match(plan_id):
            return None
        rec = next((p for p in self.plans() if p.get("plan_id") == plan_id), None)
        if rec is None:
            return None
        path = self.dir / "plans" / (plan_id + {"pdf": ".pdf", "dwf": ".dwf", "dxf": ".dxf"}[rec["kind"]])
        return (rec, path) if path.is_file() else None

    def delete_plan(self, plan_id: str) -> bool:
        with file_lock(self._path("plans.json")):
            hit = self.plan(plan_id)
            if hit is None:
                return False
            hit[1].unlink(missing_ok=True)
            self._write("plans.json", [p for p in self.plans() if p.get("plan_id") != plan_id])
            return True
