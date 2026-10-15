"""The inputs and the status labels shared by all exports (``ExportContext``)."""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.common.labels import upper_label
from app.design.site_design import SiteDesign, SiteObject, empty_design

NOT_AVAILABLE = "DATA NOT AVAILABLE"
NO_TERRAIN = "TERRAIN DATA NOT AVAILABLE"
INDICATIVE = "INDICATIVE ONLY, TO BE CHECKED BY A QUALIFIED PERSON BEFORE ANY USE"

#: the export kinds served by GET /projects/{id}/exports/{kind}, with the media type and the file extension of each
KINDS: dict[str, tuple[str, str]] = {
    "glb": ("model/gltf-binary", "glb"),
    "dxf": ("application/dxf", "dxf"),
    "objects.csv": ("text/csv; charset=utf-8", "csv"),
    "objects.json": ("application/json", "json"),
    "checks.csv": ("text/csv; charset=utf-8", "csv"),
    "checks.json": ("application/json", "json"),
    "stormwater.csv": ("text/csv; charset=utf-8", "csv"),
    "stormwater.json": ("application/json", "json"),
}


class ExportTimeout(Exception):
    """An export build passed its time cap (the API answers 504)."""


def check_deadline(deadline: float | None) -> None:
    if deadline is not None and time.monotonic() > deadline:
        raise ExportTimeout("THE EXPORT TOOK TOO LONG AND WAS STOPPED")


@dataclass
class ExportContext:
    """The data of one project export. ``bundle`` is the raw scene bundle JSON (None when the project has none), ``design`` the saved site design."""
    project_id: str
    design: SiteDesign
    bundle: dict[str, Any] | None = None
    folder: Path | None = None
    now: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    notes: list[str] = field(default_factory=list)

    # ---- the bundle
    @property
    def info(self) -> dict[str, Any]:
        return (self.bundle or {}).get("info") or {}

    @property
    def origin(self) -> tuple[float, float]:
        o = self.info.get("origin") or [0.0, 0.0, 0.0]
        return float(o[0]), float(o[1])

    @property
    def srid(self) -> int | None:
        s = self.info.get("srid")
        return int(s) if isinstance(s, (int, float)) and not isinstance(s, bool) else None

    @property
    def title(self) -> str:
        return str(self.info.get("title") or "").strip() or NOT_AVAILABLE

    # ---- labels (the same words as the viewer)
    @property
    def terrain_status(self) -> str:
        if self.bundle is None:
            return NO_TERRAIN
        t = (self.info.get("terrain") or {}).get("status")
        return upper_label(str(t)).strip() if t else "TERRAIN SOURCE NOT STATED"

    @property
    def terrain_source(self) -> str:
        t = self.info.get("terrain") or {}
        return upper_label(str(t.get("source") or "SOURCE NOT STATED"))

    def services(self) -> list[SiteObject]:
        return [o for o in self.design.objects if o.type == "service_existing"]

    def unverified_services(self) -> list[SiteObject]:
        return [o for o in self.services() if not o.verified]

    def pending_proposals(self) -> list[SiteObject]:
        return [o for o in self.design.objects if o.origin == "ai_proposal" and o.accepted == "pending"]

    def status_lines(self) -> list[str]:
        """The status wording every export carries (upper case, no dashes)."""
        out = [f"TERRAIN: {self.terrain_status}", f"TERRAIN SOURCE: {self.terrain_source}"]
        ds = self.info.get("data_status")
        if ds:
            out.append(f"DATA STATUS: {upper_label(str(ds))}")
        s = self.services()
        if s:
            u = self.unverified_services()
            out.append(f"SERVICES: {len(u)} OF {len(s)} UNVERIFIED, INDICATIVE ONLY" if u else f"SERVICES: ALL {len(s)} VERIFIED BY THE USER, POSITIONS STILL INDICATIVE")
        else:
            out.append("SERVICES: NONE IN THE DESIGN (NO DBYD DATA ENTERED)")
        p = self.pending_proposals()
        if p:
            out.append(f"AI PROPOSALS PENDING REVIEW: {len(p)}")
        out.append(INDICATIVE)
        return out

    def date_text(self) -> str:
        return self.now.strftime("%d/%m/%Y")

    def coordinate_text(self) -> str:
        s = self.srid
        if s is None:
            return "COORDINATE SYSTEM NOT STATED"
        if 7846 <= s <= 7859:
            return f"MGA2020 ZONE {s - 7800} (EPSG:{s}), METRES"
        if 28348 <= s <= 28358:
            return f"MGA94 ZONE {s - 28300} (EPSG:{s}), METRES"
        return f"EPSG:{s}, METRES"


def load_context(folder: Path, project_id: str, design: SiteDesign | None = None, now: datetime | None = None) -> ExportContext:
    """Read the stored scene bundle and site design of a project folder. A missing file is not an error: the export says DATA NOT AVAILABLE."""
    bundle = None
    bp = folder / "scene_bundle.json"
    if bp.is_file():
        try:
            bundle = json.loads(bp.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            bundle = None
    if design is None:
        dp = folder / "site_design.json"
        try:
            design = SiteDesign.model_validate_json(dp.read_text(encoding="utf-8")) if dp.is_file() else empty_design(project_id)
        except (OSError, ValueError):
            design = empty_design(project_id)
    return ExportContext(project_id=project_id, design=design, bundle=bundle, folder=folder, now=now or datetime.now(timezone.utc))
