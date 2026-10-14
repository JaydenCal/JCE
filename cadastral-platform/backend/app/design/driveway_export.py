"""Export a ``driveway`` site design object into the structure the SA3 / SA5 pipeline consumes (``common.contracts.DrivewayDesign``).

``export_driveway`` is a pure function of the object, the profile record the engine returned for it (``driveway_engine.driveway_profile``) and, for a
driveway whose end is linked to a building, the saved site design that holds the building: no file, database or terrain access. The plan set (sheets C101, C400, C410, C420) then draws the driveway from the same centreline, width and end level
as the 3D model, and its own ``ref_profile`` reproduces the engine's long section for the same terrain (tests/test_driveway_export.py).

Rules: nothing is invented. A driveway whose width is not set cannot be exported (``ExportError``); a boundary point that could not be found
(no lot boundary or no kerb line in the 3D model) cannot be exported either, because the crossover footprint is built from it. The plan set's
FFL is the driveway END LEVEL (``end_level_rl``), exactly as its ``ref_profile`` takes the driveway end from ``site.ffl``.

END LEVEL AND LINK. With ``end_building_id`` the end level is the linked building's FFL, resolved here from the saved design (``driveway_link``); the
object's own ``end_level_rl`` is never read while a link exists. A profile computed for another end level than the link now gives is refused (it is stale).

SPLAY. The kerb return splay is the requirement ``driveway.crossover_splay_m`` from the profile's resolved rules. There is no default: when it is
UNRESOLVED the footprint is drawn with no splay and the export carries the note CROSSOVER SPLAY UNRESOLVED.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from shapely.geometry import LineString

from app.agents.sa3_driveway.crossover import _footprint
from app.common.contracts import DrivewayDesign

from .driveway_link import resolve_end_building
from .site_design import SiteDesign, SiteObject
from .site_rules import KEY_SPLAY

DESIGN_VEHICLE = "B85"
SPLAY_UNRESOLVED_NOTE = "CROSSOVER SPLAY UNRESOLVED"


class ExportError(Exception):
    """The driveway cannot be exported as it stands; the message says what is missing."""


@dataclass(frozen=True)
class DrivewayExport:
    design: DrivewayDesign
    end_level_rl: float | None       # the driveway end level, which the plan set takes as its FFL
    verge_m: float                   # kerb line to property boundary (assumed, not surveyed)
    notes: tuple[str, ...] = ()      # what the export could not take from a requirement (for example CROSSOVER SPLAY UNRESOLVED)


def export_driveway(obj: SiteObject, profile: dict[str, Any], *, design: SiteDesign | None = None, building: SiteObject | None = None) -> DrivewayExport:
    if obj.type != "driveway" or obj.geometry.kind != "polyline":
        raise ExportError("only a driveway object with a centreline can be exported")
    link = resolve_end_building(obj, design, building)
    if link.linked:                                       # the link is the source of truth: the saved building FFL, never the object's own end_level_rl
        pv = profile["end_level"]["value"]
        if (pv is None) != (link.ffl_rl is None) or (pv is not None and abs(float(pv) - link.ffl_rl) > 1e-6):
            raise ExportError(f"THE PROFILE WAS COMPUTED FOR AN END LEVEL OF {pv} BUT THE LINKED BUILDING NOW GIVES {link.ffl_rl}: compute the profile again before exporting")
    width = profile["width"]["value"]
    if width is None:
        raise ExportError("WIDTH NOT SET: a driveway without a width cannot be exported")
    geo, frame = profile.get("geometry") or {}, profile.get("frame")
    bp, verge = geo.get("boundary_point"), geo.get("verge_m")
    if bp is None or verge is None or frame is None:
        raise ExportError("BOUNDARY POINT NOT AVAILABLE: the lot boundary and the assumed kerb line are needed to build the crossover")
    pts = [(float(p[0]), float(p[1])) for p in obj.geometry.pts]
    u, n = np.array(frame["front_dir"]), np.array(frame["inward_normal"])
    bpa = np.array(bp, float)
    splay_rule = (profile.get("rules") or {}).get(KEY_SPLAY) or {}
    splay = splay_rule.get("value")
    notes: list[str] = []
    if splay is None:
        splay = 0.0                                        # no requirement, no splay: nothing is invented
        notes.append(SPLAY_UNRESOLVED_NOTE)
    foot = _footprint(bpa, u, n, float(width), float(verge), float(splay))
    h = float(width) / 2
    gp = np.array(pts[-1], float)
    dims = [("Crossover width", tuple(map(float, bpa - u * h)), tuple(map(float, bpa + u * h))), ("Garage setback", tuple(map(float, bpa)), tuple(map(float, gp)))]
    mg = next((c["value"] for c in profile["checks"] if c["id"] == "max_grade"), None)
    dd = DrivewayDesign(
        centreline_wkt=LineString(pts).wkt, width_m=float(width), crossover_wkt=foot.wkt, max_grade_pct=mg, design_vehicle=DESIGN_VEHICLE,
        council_standard_label=profile.get("standard_label"), turning_path_wkt=None, dimensions=dims, kerb_to_boundary_user_supplied=False)
    ev = link.ffl_rl if link.linked else profile["end_level"]["value"]
    return DrivewayExport(design=dd, end_level_rl=None if ev is None else float(ev), verge_m=float(verge), notes=tuple(notes))
