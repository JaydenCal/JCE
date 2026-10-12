"""Requirement-driven minimum floor level: FFL >= design flood level + freeboard.

Nothing is hard-coded: the flood level is supplied (council certificate, flood study, user entry or NSW data)
and the freeboard comes from the Requirements model (key ``flood.freeboard_m``) or a user override. An unknown
flood level is UNRESOLVED and the dwelling FFL is NOT derived from flood (no guessing).
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

FloodSource = Literal["council_certificate", "flood_study", "user_entered", "nsw_flood_data"]
UNRESOLVED_PROMPT = "Obtain the flood level / flood planning level certificate from the council or enter it"
FREEBOARD_KEY = "flood.freeboard_m"
KNOWLEDGE_DIR = Path(__file__).resolve().parents[2] / "knowledge"


class FloodLevelInput(BaseModel):
    level_ahd: float | None = None
    event: str = "1% AEP"           # council may define a different flood planning event
    source: FloodSource = "user_entered"
    source_ref: str | None = None
    as_at: str | None = None        # ISO date
    uncertainty_m: float | None = None


class Freeboard(BaseModel):
    value_m: float | None = None
    source: str = "unresolved"      # requirements | user_entered | unresolved
    citation: str | None = None


class FloodCheck(BaseModel):
    result: Literal["PASS", "FAIL", "UNRESOLVED"]
    min_ffl: float | None = None
    flood_level_ahd: float | None = None
    freeboard_m: float | None = None
    freeboard_source: str = "unresolved"
    freeboard_citation: str | None = None
    event: str | None = None
    flood_source: str | None = None
    flood_source_ref: str | None = None
    as_at: str | None = None
    uncertainty_m: float | None = None
    proposed_ffl: float | None = None
    floor_above_flood_m: float | None = None
    floor_above_flood_ok: bool | None = None
    existing_ground_at_footprint: float | None = None
    fill_depth_m: float | None = None      # required fill over existing ground at the footprint (>= 0)
    prompt: str | None = None
    warnings: list[str] = Field(default_factory=list)


def freeboard_from_knowledge(lga: str | None, *, jurisdiction_dir: str | None = None,
                             knowledge_dir: Path | None = None) -> Freeboard:
    """Cited freeboard (flood.freeboard_m) for an LGA from backend/knowledge/<lga>/requirements.json, else unresolved."""
    if not lga:
        return Freeboard()
    p = (knowledge_dir or KNOWLEDGE_DIR) / (jurisdiction_dir or lga.strip().lower().replace(" ", "_")) / "requirements.json"
    if not p.exists():
        return Freeboard()
    try:
        data: dict[str, Any] = json.loads(p.read_text())
    except (OSError, ValueError):
        return Freeboard()
    for r in data.get("requirements", []):
        if r.get("key") == FREEBOARD_KEY and r.get("status") == "resolved" and r.get("value") is not None:
            s = r.get("source") or {}
            cite = f"{s.get('document_title', '?')}, {s.get('section_ref', '')} p.{s.get('page', '?')}: \"{s.get('quote', '')}\""
            return Freeboard(value_m=float(r["value"]), source="requirements", citation=cite)
    return Freeboard()


def _ground_at(ground_levels: Any, existing_ground_at_footprint: float | None, footprint: Any) -> float | None:
    """Existing ground at the footprint: explicit value, else the LOWEST TIN level over the footprint (greatest fill)."""
    if existing_ground_at_footprint is not None:
        return float(existing_ground_at_footprint)
    if ground_levels is None or footprint is None:
        return None
    import numpy as np
    from shapely import intersects_xy as contains_xy
    minx, miny, maxx, maxy = footprint.bounds
    gx, gy = np.meshgrid(np.linspace(minx, maxx, 15), np.linspace(miny, maxy, 15))
    z = ground_levels.z_at(gx.ravel(), gy.ravel())
    z = z[np.isfinite(z) & contains_xy(footprint, gx.ravel(), gy.ravel())]
    return float(z.min()) if z.size else None


def compute_min_ffl(flood_level: FloodLevelInput | None, freeboard: Freeboard | float | None,
                    ground_levels: Any = None, existing_ground_at_footprint: float | None = None, *,
                    footprint: Any = None, proposed_ffl: float | None = None,
                    freeboard_override_m: float | None = None) -> FloodCheck:
    """min FFL = flood level + freeboard. ``ground_levels`` is a TIN (z_at) used with ``footprint`` (shapely) when
    ``existing_ground_at_footprint`` is not given. A user override of the freeboard is reported as user_entered."""
    if freeboard_override_m is not None:
        fb = Freeboard(value_m=float(freeboard_override_m), source="user_entered")
    elif isinstance(freeboard, Freeboard):
        fb = freeboard
    elif freeboard is not None:
        fb = Freeboard(value_m=float(freeboard), source="user_entered")
    else:
        fb = Freeboard()
    fl = flood_level or FloodLevelInput()
    chk = FloodCheck(result="UNRESOLVED", flood_level_ahd=fl.level_ahd, freeboard_m=fb.value_m, freeboard_source=fb.source,
                     freeboard_citation=fb.citation, event=fl.event, flood_source=fl.source, flood_source_ref=fl.source_ref,
                     as_at=fl.as_at, uncertainty_m=fl.uncertainty_m, proposed_ffl=proposed_ffl)
    if fl.level_ahd is None or not math.isfinite(fl.level_ahd):
        chk.prompt = UNRESOLVED_PROMPT
        chk.warnings.append("Flood level unknown: dwelling FFL is NOT set from flood.")
        return chk
    if fb.value_m is None:
        chk.prompt = ("Freeboard is not defined for this council in the requirements model: enter the council's freeboard "
                      "(user_entered) or obtain it from the council's flood policy")
        chk.warnings.append("Freeboard unresolved: minimum FFL not computed.")
        return chk
    chk.min_ffl = round(fl.level_ahd + fb.value_m, 3)
    if fl.uncertainty_m:
        chk.warnings.append(f"Flood level carries stated uncertainty of +/-{fl.uncertainty_m:g} m; not added to the minimum FFL.")
    if fl.source == "user_entered":
        chk.warnings.append("Flood level is user_entered: confirm against the council flood information certificate.")
    g = _ground_at(ground_levels, existing_ground_at_footprint, footprint)
    if g is not None:
        chk.existing_ground_at_footprint = round(g, 3)
        chk.fill_depth_m = round(max(0.0, chk.min_ffl - g), 3)
        if chk.fill_depth_m > 0:
            chk.warnings.append(f"Floor level is {chk.fill_depth_m:.2f} m above existing ground at the footprint. Fill in a "
                                "floodplain may be restricted: check council flood policy (no rule is asserted here).")
    elif ground_levels is None:
        chk.warnings.append("No ground levels supplied: required fill depth not computed.")
    if proposed_ffl is not None:
        chk.floor_above_flood_m = round(proposed_ffl - fl.level_ahd, 3)
        chk.floor_above_flood_ok = proposed_ffl + 1e-9 >= chk.min_ffl
        chk.result = "PASS" if chk.floor_above_flood_ok else "FAIL"
        if not chk.floor_above_flood_ok:
            chk.prompt = f"Raise FFL to at least RL {chk.min_ffl:.2f}"
    else:
        chk.result = "PASS"   # minimum computed; nothing proposed to fail
    return chk


def ffl_label(ffl: float, chk: FloodCheck | None) -> str:
    """'FFL RL xx.xx (flood level RL yy.yy + 0.50 freeboard)' or plain FFL when no flood basis."""
    if chk is None or chk.flood_level_ahd is None or chk.freeboard_m is None:
        return f"FFL RL {ffl:.2f}"
    return f"FFL RL {ffl:.2f} (flood level RL {chk.flood_level_ahd:.2f} + {chk.freeboard_m:.2f} freeboard)"
