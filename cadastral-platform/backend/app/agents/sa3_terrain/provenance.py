"""Terrain provenance: where the ground levels came from, how good they are stated to be, and the status label shown on every output.

Stage 3 (15/10/2026). Every provider in the terrain chain (see ``chain.py``) returns a ``TerrainProvenance``. Nothing here is invented:
a field the source does not state is ``NOT STATED`` and a date the source does not give is ``CAPTURE DATE NOT STATED``.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

from app.common.labels import upper_label

NOT_STATED = "NOT STATED"
CAPTURE_DATE_NOT_STATED = "CAPTURE DATE NOT STATED"

# Status labels (owner decision B, 15/10/2026). Labels shown in the 3D view are upper-cased by ``label_text`` (unit tokens such as "5 m" keep their case).
STATUS_SURVEY = "SURVEY (AS SUPPLIED)"
STATUS_QLD_LIDAR = "LIDAR (QLD STATE SERVICE), CC BY SA, NOT SURVEY"
STATUS_TILE_LIDAR = "LIDAR (HOSTED TILE LIBRARY), NOT SURVEY"
STATUS_NSW_5M = "INDICATIVE 5 m DEM, LIDAR PENDING, NOT SURVEY"
STATUS_NONE = "TERRAIN DATA NOT AVAILABLE"
LIDAR_PENDING_NOTE = "LIDAR PENDING: ELVIS 1 m TILES TO BE ORDERED AND LOADED; NO HOSTED TILE COVERS THIS LOT"
OFFLINE_SOURCE = "OFFLINE FIXTURE (app/offline/lot2.py), NOT LIVE DATA"

TIER_SURVEY, TIER_QLD_LIDAR, TIER_TILE_LIBRARY, TIER_NSW_5M, TIER_NONE = 1, 2, 3, 4, 5


def ddmmyyyy(value: datetime | int | float | str | None) -> str | None:
    """DD/MM/YYYY from a datetime, an ArcGIS epoch in milliseconds, or an ISO / DD/MM/YYYY string. None when absent or unreadable."""
    if value is None or value == "":
        return None
    try:
        if isinstance(value, datetime):
            return value.strftime("%d/%m/%Y")
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(float(value) / 1000.0, tz=timezone.utc).strftime("%d/%m/%Y")
        s = str(value).strip()
        if re.fullmatch(r"\d{2}/\d{2}/\d{4}", s):
            return s
        return datetime.fromisoformat(s[:10]).strftime("%d/%m/%Y")
    except (ValueError, OverflowError, OSError):
        return None


_ACC = re.compile(r"^\s*[±+\-]*\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\b", re.I)


def parse_accuracy_m(text: str | None) -> float | None:
    """Metres from a stated accuracy such as ``0.3 m @ 95% CL``. None unless the text starts with a number and a length unit."""
    m = _ACC.match(text or "")
    if not m:
        return None
    return float(m.group(1)) * {"mm": 0.001, "cm": 0.01, "m": 1.0}[m.group(2).lower()]


@dataclass
class TerrainProvenance:
    tier: int
    status: str
    source_name: str = ""
    url: str = ""
    resolution_m: float | None = None
    effective_spacing_m: float | None = None   # ground spacing of the points actually sampled (after coarsening / stride); drives the contour interval
    resolution_text: str = NOT_STATED
    capture_date: str | None = None            # DD/MM/YYYY (or a range); None = CAPTURE DATE NOT STATED
    accuracy_text: str = NOT_STATED            # as stated by the source, verbatim; NOT STATED when the source gives none
    accuracy_m: float | None = None            # numeric form of a STATED accuracy only
    licence: str = NOT_STATED
    datum: str = NOT_STATED
    retrieved: str | None = None               # DD/MM/YYYY
    points: int = 0
    notes: list[str] = field(default_factory=list)
    attempts: list[dict] = field(default_factory=list)   # [{"provider", "tier", "outcome", "note"}], in chain order

    @property
    def capture_text(self) -> str:
        return self.capture_date or CAPTURE_DATE_NOT_STATED

    def label_text(self) -> str:
        """The terrain label drawn in the 3D view (upper case)."""
        return upper_label(f"TERRAIN: {self.status}")

    def to_dict(self) -> dict:
        d = asdict(self)
        d["capture_text"] = self.capture_text
        return d

    def summary_rows(self) -> list[tuple[str, str]]:
        """Rows for the 3D summary table."""
        return [("Terrain status", upper_label(self.status)), ("Terrain source", self.source_name or NOT_STATED),
                ("Terrain resolution", self.resolution_text), ("Terrain capture date", self.capture_text),
                ("Terrain vertical accuracy", self.accuracy_text), ("Terrain licence", self.licence),
                ("Terrain datum", self.datum)]


def mark_offline(prov: TerrainProvenance) -> TerrainProvenance:
    """An offline fixture run must never read as a live retrieval: the source and URL say so and no retrieved date is kept."""
    prov.source_name = prov.url = OFFLINE_SOURCE
    prov.retrieved = None
    prov.notes = [OFFLINE_SOURCE + ": the levels were rebuilt from a saved run, no service was called and nothing was retrieved."] + list(prov.notes)
    return prov


def none_provenance(attempts: list[dict]) -> TerrainProvenance:
    return TerrainProvenance(tier=TIER_NONE, status=STATUS_NONE, source_name="NONE", resolution_text="NOT APPLICABLE",
                             accuracy_text="NOT APPLICABLE", licence="NOT APPLICABLE", datum="NOT APPLICABLE",
                             notes=["No terrain provider returned levels for this lot. No level is implied."], attempts=attempts)


def scene_provenance(prov: TerrainProvenance) -> dict:
    """kwargs for ``SceneRequest.terrain_provenance`` (TerrainProvenanceIn)."""
    return {"status": prov.status, "source": prov.source_name, "url": prov.url, "resolution_text": prov.resolution_text, "resolution_m": prov.resolution_m, "effective_spacing_m": prov.effective_spacing_m,
            "capture_date": prov.capture_text, "accuracy": prov.accuracy_text, "licence": prov.licence, "datum": prov.datum, "notes": list(prov.notes)}
