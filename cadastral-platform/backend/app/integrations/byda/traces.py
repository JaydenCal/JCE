"""DBYD trace store (stage 8, Phase 0): the services a person traced over an asset owner's plan, and whether anyone has verified them.

Rules (docs/12-dbyd-integration-plan.md, section 2 and Phase 0):
  * Every traced service is a DRAFT.  It becomes VERIFIED only through ``verify`` called with the name of the person who checked it; nothing in the platform calls ``verify`` on its own
    and no import, parse or trace operation can create a verified service.  A service can be REJECTED (with the reason and the person).
  * Each service stores its source plan (owner, plan id, page), the plan date as recorded for the owner, who traced it and who verified or rejected it, and when.
  * Only VERIFIED services reach a drawing (``verified_for_drawing``).  Draft and rejected services are never drawn, and the plan set says how many of each exist.
  * Depths are never inferred.  ``depth_note`` is the person's own entry or None.

The file is ``<project>/dbyd/traces.json`` (project private; written atomically under a file lock).
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from app.common.filestore import atomic_write_json, file_lock
from app.integrations.byda.store import now_iso

TRACES_FILE = "traces.json"
STATUSES = ("draft", "verified", "rejected")
SERVICE_TYPES = ("water", "sewer", "stormwater", "electricity", "gas", "telecom", "other")
#: a verifier name that is not a person is refused (a person verifies; no process does)
NOT_A_PERSON = {"", "auto", "automatic", "system", "claude", "ai", "bot", "platform", "jcesite", "script", "import", "importer", "none", "unknown", "n/a", "na"}


class TraceError(Exception):
    pass


def _person(name: str | None) -> str:
    n = (name or "").strip()
    if len(n) < 2 or n.lower() in NOT_A_PERSON:
        raise TraceError("A PERSON'S NAME IS REQUIRED: SERVICES ARE NEVER VERIFIED OR TRACED AUTOMATICALLY")
    return n


class TraceStore:
    def __init__(self, project_dir: str | Path) -> None:
        self.dir = Path(project_dir) / "dbyd"
        self.path = self.dir / TRACES_FILE

    def _read(self) -> list[dict[str, Any]]:
        try:
            v = json.loads(self.path.read_text(encoding="utf-8"))
            return v if isinstance(v, list) else []
        except (OSError, ValueError):
            return []

    def _write(self, rows: list[dict[str, Any]]) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        atomic_write_json(self.path, rows)

    def features(self, status: str | None = None, owner: str | None = None) -> list[dict[str, Any]]:
        rows = self._read()
        if status:
            rows = [r for r in rows if r.get("status") == status]
        if owner:
            rows = [r for r in rows if (r.get("owner") or "").lower() == owner.lower()]
        return rows

    def get(self, fid: str) -> dict[str, Any] | None:
        return next((r for r in self._read() if r.get("id") == fid), None)

    def add_draft(self, *, owner: str, service: str, kind: str, pts: list[list[float]], traced_by: str, plan_id: str | None = None, page: int | None = None,
                  plan_date: str | None = None, label: str | None = None, depth_note: str | None = None, srid: int | None = None, note: str | None = None) -> dict[str, Any]:
        """Record a traced service as a DRAFT.  ``pts`` are project CRS (MGA) easting, northing pairs: one for a point, two or more for a line."""
        if service not in SERVICE_TYPES:
            raise TraceError(f"SERVICE TYPE {service!r} IS NOT ONE OF {', '.join(SERVICE_TYPES)}")
        if kind not in ("point", "polyline"):
            raise TraceError("GEOMETRY KIND MUST BE point OR polyline")
        if (kind == "point" and len(pts) != 1) or (kind == "polyline" and len(pts) < 2):
            raise TraceError("A POINT NEEDS ONE POSITION AND A LINE AT LEAST TWO")
        by = _person(traced_by)
        rec = {"id": uuid.uuid4().hex, "status": "draft", "owner": owner, "service": service, "geometry": {"kind": kind, "pts": [[float(x), float(y)] for x, y in pts], "srid": srid},
               "plan_id": plan_id, "page": page, "plan_date": plan_date, "label": label, "depth_note": depth_note, "note": note,
               "traced_by": by, "traced_at": now_iso(), "verified_by": None, "verified_at": None, "rejected_by": None, "rejected_at": None, "reject_reason": None,
               "history": [{"at": now_iso(), "by": by, "event": "traced (draft)"}]}
        with file_lock(self.path):
            rows = self._read()
            rows.append(rec)
            self._write(rows)
        return rec

    def _change(self, fid: str, fn) -> dict[str, Any]:
        with file_lock(self.path):
            rows = self._read()
            for r in rows:
                if r.get("id") == fid:
                    fn(r)
                    self._write(rows)
                    return r
        raise TraceError(f"NO TRACED SERVICE {fid}")

    def verify(self, fid: str, by: str, note: str | None = None) -> dict[str, Any]:
        """A person confirms the traced service against the plan.  Only a draft can be verified."""
        who = _person(by)

        def fn(r):
            if r["status"] != "draft":
                raise TraceError(f"ONLY A DRAFT CAN BE VERIFIED (THIS SERVICE IS {r['status'].upper()})")
            r.update(status="verified", verified_by=who, verified_at=now_iso())
            r["history"].append({"at": r["verified_at"], "by": who, "event": "verified" + (f": {note}" if note else "")})
        return self._change(fid, fn)

    def reject(self, fid: str, by: str, reason: str) -> dict[str, Any]:
        who = _person(by)
        if not (reason or "").strip():
            raise TraceError("A REASON IS REQUIRED TO REJECT A TRACED SERVICE")

        def fn(r):
            if r["status"] == "rejected":
                raise TraceError("THIS SERVICE IS ALREADY REJECTED")
            r.update(status="rejected", rejected_by=who, rejected_at=now_iso(), reject_reason=reason.strip(), verified_by=None, verified_at=None)
            r["history"].append({"at": r["rejected_at"], "by": who, "event": f"rejected: {reason.strip()}"})
        return self._change(fid, fn)

    def verified_for_drawing(self) -> list[dict[str, Any]]:
        """The only services a drawing may show."""
        return [r for r in self._read() if r.get("status") == "verified"]

    def counts(self, owner: str | None = None) -> dict[str, int]:
        rows = self.features(owner=owner)
        return {s: sum(1 for r in rows if r.get("status") == s) for s in STATUSES}
