"""Crossover and driveway layout from the front boundary segment."""
from __future__ import annotations

import math

import numpy as np
from shapely.geometry import LineString, Point, Polygon

from app.agents.base import AgentError
from app.agents.requirements.models import UnresolvedRequirement, to_item
from app.common.contracts import LotContext

from .models import (CouncilDrivewayStandard, CrossoverLayout, DEFAULT_STANDARD, DrivewayWidths, Exclusion)

# Per-council overrides, keyed by lower-case council/LGA name. Intentionally empty by default.
COUNCIL_REGISTRY: dict[str, CouncilDrivewayStandard] = {}


PH_STAMP = "PLACEHOLDER, NOT A REQUIREMENT"
_FIELDS = (("driveway.max_grade_pct", "max_grade_pct"), ("driveway.max_grade_change_pct", "max_change_of_grade_pct"),
           ("driveway.min_width_m", "min_crossover_width_m"), ("driveway.max_width_m", "max_crossover_width_m"),
           ("driveway.min_separation_m", "min_separation_m"))


def council_standard(name: str | None, override: CouncilDrivewayStandard | None = None, *, requirements=None,
                     use_placeholders: bool = False, selectors: dict | None = None,
                     unresolved: list | None = None, citations: list | None = None) -> CouncilDrivewayStandard:
    """override (user supplied) > resolved RequirementSet (unresolved fields stay None and are reported) > legacy default."""
    if override is not None:
        return override
    if requirements is not None:
        vals, cites = {}, []
        for key, fld in _FIELDS:
            try:
                r = requirements.get_requirement(key, **(selectors or {}))
                vals[fld] = float(r.value)
                cites.append(f"{key}={r.value}: {r.citation()}")
            except UnresolvedRequirement as e:
                vals[fld] = None
                if unresolved is not None:
                    unresolved.append(to_item(e))
        if vals["max_grade_pct"] is None and use_placeholders:
            vals["max_grade_pct"] = DEFAULT_STANDARD.max_grade_pct
        if citations is not None:
            citations += cites
        label = "Resolved requirements (cited)" + (f"; {PH_STAMP} for max grade" if use_placeholders and any(
            i.key == "driveway.max_grade_pct" for i in (unresolved or [])) else "")
        return CouncilDrivewayStandard(council_name=name or "resolved", source_label=label, **vals)
    if name and name.lower() in COUNCIL_REGISTRY:
        return COUNCIL_REGISTRY[name.lower()]
    return DEFAULT_STANDARD


def driveway_width(parking: str, user_width: float | None, widths: DrivewayWidths, std: CouncilDrivewayStandard,
                   warns: list[str]) -> float:
    w = user_width if user_width is not None else (widths.double_m if parking == "double" else widths.single_m)
    lo, hi = std.min_crossover_width_m, std.max_crossover_width_m
    if lo is not None and w < lo:
        warns.append(f"width {w:.2f} m raised to council minimum {lo:.2f} m")
        w = lo
    if hi is not None and w > hi:
        warns.append(f"width {w:.2f} m reduced to council maximum {hi:.2f} m")
        w = hi
    return w


def _adjacent_is_road(lot: LotContext, front, end: str) -> bool:
    pt = front.start_xy if end == "start" else front.end_xy
    for s in lot.segments:
        if s.seq == front.seq:
            continue
        if adjoins_road(s) and (np.allclose(s.start_xy, pt, atol=1e-3) or np.allclose(s.end_xy, pt, atol=1e-3)):
            return True
    return False


def adjoins_road(s) -> bool:
    return s.adjoins == "road"


def plan_crossover(lot: LotContext, std: CouncilDrivewayStandard, width_m: float, *, preferred_offset_m=None,
                   garage_xy=None, garage_depth_m: float = 6.0, kerb_to_boundary_m: float = 4.0,
                   exclusions: list[Exclusion] | None = None, min_corner_m: float = 6.0, min_side_m: float = 1.0
                   ) -> CrossoverLayout:
    front = next((s for s in lot.segments if s.is_front), None)
    if front is None:
        raise AgentError("NO_FRONT_SEGMENT", "no boundary segment flagged is_front")
    warns: list[str] = []
    a, b = np.array(front.start_xy, float), np.array(front.end_xy, float)
    L = float(np.linalg.norm(b - a))
    u = (b - a) / L
    n = np.array([-u[1], u[0]])
    from shapely import wkt as shw
    poly = shw.loads(lot.boundary_wkt)
    if not poly.contains(Point(*(a + u * L / 2 + n * 0.1))):
        n = -n
    splay = std.kerb_return_splay_m if std.kerb_return_splay_m is not None else 0.5
    sep = std.min_separation_m
    dc = max(min_corner_m, sep or 0.0)
    lo_end = (dc if _adjacent_is_road(lot, front, "start") else min_side_m) + width_m / 2
    hi_end = L - (dc if _adjacent_is_road(lot, front, "end") else min_side_m) - width_m / 2
    if hi_end < lo_end:
        warns.append("front boundary too short for required corner/side clearances; centred")
        lo_end = hi_end = L / 2

    def ok(t: float) -> bool:
        foot = _footprint(a + u * t, u, n, width_m, kerb_to_boundary_m, splay)
        return all(foot.distance(Point(*e.xy)) >= e.clearance_m for e in (exclusions or []))

    target = preferred_offset_m
    if target is None:
        target = float(np.dot(np.array(garage_xy) - a, u)) if garage_xy else L / 2
    if preferred_offset_m is not None and not (lo_end <= target <= hi_end and ok(target)):
        warns.append("preferred offset violates clearances; nearest compliant offset used")
    cands = np.arange(lo_end, hi_end + 1e-9, 0.1)
    good = [t for t in cands if ok(t)]
    if not good:
        warns.append("no clear crossover position found; clearance to obstacles NOT met")
        good = list(cands)
    t = float(min(good, key=lambda x: abs(x - target)))
    bp = a + u * t
    kp = bp - n * kerb_to_boundary_m
    gp = np.array(garage_xy, float) if garage_xy else bp + n * garage_depth_m
    foot = _footprint(bp, u, n, width_m, kerb_to_boundary_m, splay)
    cl = LineString([tuple(kp), tuple(bp), tuple(gp)])
    h = width_m / 2
    dims = [("Crossover width", tuple(bp - u * h), tuple(bp + u * h)), ("Garage setback", tuple(bp), tuple(gp)),
            ("Offset from boundary corner", tuple(a), tuple(bp))]
    return CrossoverLayout(centreline_wkt=cl.wkt, crossover_wkt=foot.wkt, boundary_point=tuple(bp), kerb_point=tuple(kp),
                           garage_point=tuple(gp), offset_m=t, width_m=width_m, inward_normal=tuple(n), front_dir=tuple(u),
                           dimensions=dims, standard_label=std.source_label, warnings=warns)


def _footprint(bp, u, n, w, verge, splay) -> Polygon:
    h = w / 2
    kp = bp - n * verge
    return Polygon([tuple(bp - u * h), tuple(bp + u * h), tuple(kp + u * (h + splay)), tuple(kp - u * (h + splay))])
