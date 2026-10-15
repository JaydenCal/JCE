"""Terrain facts read from the DEM levels (never typed per lot): the overall fall of the lot, whether it falls away from the street, and the hedged
discharge note that follows when it does.  Shared by the plan sheets (C300, C500) and the general notes (C001) so every sheet states the same thing."""
from __future__ import annotations

import math

import numpy as np
from shapely.geometry import Point

from app.agents.sa5_cad_dxf.planset import lga_notes as LN
from app.agents.sa5_cad_dxf.planset.data import Site
from app.agents.sa5_cad_dxf.planset.sheets_ref import _front_segment


def dem_fall(s: Site) -> dict | None:
    """Overall fall of the lot read from the DEM spot levels (least-squares plane over the points within 40 m of the lot): bearing of the downslope
    direction in degrees from grid north, percent, and the direction vector.  Computed, never typed; None without levels or when the fit is under 0.5 percent."""
    pts = [tuple(float(c) for c in q) for q in (getattr(s, "spots", None) or [])]
    tin = getattr(s, "tin", None)
    if len(pts) < 3 and tin is not None:
        pts = [tuple(float(c) for c in q) for q in tin.vertices.tolist()]
    near = [q for q in pts if s.lot.distance(Point(q[0], q[1])) <= 40.0]
    pts = near if len(near) >= 3 else pts
    if len(pts) < 3:
        return None
    a = np.array(pts)
    cx, cy = a[:, 0].mean(), a[:, 1].mean()
    A = np.column_stack([a[:, 0] - cx, a[:, 1] - cy, np.ones(len(a))])
    try:
        (gx, gy, _c), *_ = np.linalg.lstsq(A, a[:, 2], rcond=None)
    except np.linalg.LinAlgError:
        return None
    n = math.hypot(gx, gy)
    if not np.isfinite(n) or 100.0 * n < 0.5:
        return None
    vec = (-gx / n, -gy / n)
    return {"bearing": math.degrees(math.atan2(vec[0], vec[1])) % 360.0, "pct": 100.0 * n, "vec": vec, "n": len(pts)}


def fall_vs_street(s: Site) -> float | None:
    """Component (-1 to 1) of the DEM fall direction along the INWARD normal of the front boundary: positive = the lot falls away from the street."""
    f = dem_fall(s)
    seg = _front_segment(s)
    if f is None or seg is None:
        return None
    x0, y0 = seg.start_xy
    x1, y1 = seg.end_xy
    d = math.hypot(x1 - x0, y1 - y0)
    if d < 1e-6:
        return None
    nx, ny = -(y1 - y0) / d, (x1 - x0) / d
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    if s.lot.buffer(1e-6).contains(Point(mx - nx * 0.5, my - ny * 0.5)):          # make (nx, ny) the inward normal
        nx, ny = -nx, -ny
    return f["vec"][0] * nx + f["vec"][1] * ny


def drainage_discharge_note(s: Site) -> str | None:
    """Hedged engineering note, present only when the DEM fall puts the lot's low side away from the street (so a gravity connection to the street
    gutter is not available from the lot itself).  Derived from the DEM, never hard coded for a lot."""
    try:
        c = fall_vs_street(s)
        f = dem_fall(s)
    except (AttributeError, TypeError):                       # a partial site (no lot geometry or levels): no statement
        return None
    if c is None or f is None or c < 0.25:
        return None
    council = LN.lga_name(getattr(s.inp, "council_name", None), getattr(s.inp.lot, "lga_name", None), getattr(s.cites, "council_name", None))
    basis = getattr(s, "dem_label", "5 m DEM") if (getattr(s.inp, "terrain_label", "") or "5 m DEM" in (getattr(s, "tin_source", "") or "")) else "SUPPLIED LEVELS"
    return (f"LOT FALLS AWAY FROM THE STREET (INDICATIVE, {basis}). LEGAL POINT OF DISCHARGE UNRESOLVED; AN INTER-ALLOTMENT DRAINAGE EASEMENT OR OTHER "
            f"SOLUTION MAY BE REQUIRED. CONFIRM WITH {council}.")
