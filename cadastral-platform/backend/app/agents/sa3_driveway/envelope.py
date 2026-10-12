"""Building envelope: offset each boundary segment inward by its setback via half-plane clipping.

Exact for convex lots; for concave lots the intersection of half-planes is conservative (may over-trim).
"""
from __future__ import annotations

import math

import numpy as np
from shapely import wkt as shw
from shapely.geometry import MultiPolygon, Polygon
from shapely.ops import unary_union

from app.agents.base import AgentError
from app.common.contracts import LotContext

from .models import EnvelopeResult, SetbackRule

BIG = 1.0e4


def _multi(g) -> MultiPolygon:
    if g.is_empty:
        return MultiPolygon()
    polys = [p for p in (g.geoms if hasattr(g, "geoms") else [g]) if isinstance(p, Polygon) and not p.is_empty]
    return MultiPolygon(polys)


def half_plane(p0, p1, side_pt, d: float) -> Polygon:
    """Region on side_pt's side of the line p0-p1 shifted by d towards side_pt."""
    a, b = np.array(p0, float), np.array(p1, float)
    t = (b - a) / np.linalg.norm(b - a)
    n = np.array([-t[1], t[0]])
    if np.dot(np.array(side_pt) - a, n) < 0:
        n = -n
    o = a + n * d
    return Polygon([o - t * BIG, o + t * BIG, o + t * BIG + n * BIG, o - t * BIG + n * BIG])


def classify_segments(lot: LotContext, overrides: dict[int, str] | None = None) -> dict[int, str]:
    segs = lot.segments
    front = next((s for s in segs if s.is_front), None)
    if front is None:
        raise AgentError("NO_FRONT_SEGMENT", "no boundary segment flagged is_front")
    fv = np.subtract(front.end_xy, front.start_xy)
    fa = math.atan2(fv[1], fv[0])
    roles = {}
    for s in segs:
        if s.seq == front.seq:
            roles[s.seq] = "front"
        elif s.adjoins == "road":
            roles[s.seq] = "secondary"
        else:
            v = np.subtract(s.end_xy, s.start_xy)
            diff = abs((math.atan2(v[1], v[0]) - fa + math.pi) % (2 * math.pi) - math.pi)
            roles[s.seq] = "rear" if diff > math.radians(135) else "side"   # antiparallel to front => rear
    roles.update(overrides or {})
    return roles


def select_rule(rules: list[SetbackRule], element: str, lot: LotContext, corner: bool, dwelling: str):
    """Most specific matching rule (more satisfied lot_condition keys wins)."""
    best, best_score = None, -1
    for r in rules:
        if r.element != element or (r.dwelling_type and r.dwelling_type != dwelling) or (r.zone_code and lot.zone_code and r.zone_code != lot.zone_code):
            continue
        c, score, ok = r.lot_condition, 0, True
        if "corner_lot" in c:
            ok &= bool(c["corner_lot"]) == corner
            score += 1
        if "min_area_m2" in c:
            ok &= lot.area_m2_calculated >= float(c["min_area_m2"])
            score += 1
        if "max_area_m2" in c:
            ok &= lot.area_m2_calculated <= float(c["max_area_m2"])
            score += 1
        if ok and score > best_score:
            best, best_score = r, score
    return best


def build_envelope(lot: LotContext, rules: list[SetbackRule], easements_wkt=(), exclusions_wkt=(),
                   dwelling_type: str = "dwelling_house", overrides: dict[int, str] | None = None) -> EnvelopeResult:
    try:
        poly = shw.loads(lot.boundary_wkt)
    except Exception as e:  # noqa: BLE001
        raise AgentError("LOT_GEOMETRY_INVALID", str(e)) from e
    roles = classify_segments(lot, overrides)
    corner = any(r == "secondary" for r in roles.values())
    warns: list[str] = []
    unresolved: list[str] = []
    applied: list[str] = []
    cache: dict[str, float] = {}

    def val(el: str, fallback: str | None = None) -> float:
        r = select_rule(rules, el, lot, corner, dwelling_type) or (select_rule(rules, fallback, lot, corner, dwelling_type) if fallback else None)
        if r is None:
            unresolved.append(el)
            warns.append(f"UNRESOLVED: no '{el}' setback rule for dwelling_type '{dwelling_type}'; no value defaulted "
                         "(0 m used ONLY to draw the geometry - the envelope is not a valid setback line)")
            cache[el] = 0.0
            return 0.0
        if str(r.rule_id) not in applied:
            applied.append(str(r.rule_id))
        cache[el] = float(r.value_numeric)
        return cache[el]

    ground = {"front": val("front"), "secondary": val("secondary_frontage", "side") if corner else 0.0,
              "side": val("side"), "rear": val("rear")}
    upper_els = {"side": "side_upper", "rear": "rear_upper"}
    has_upper = any(select_rule(rules, e, lot, corner, dwelling_type) for e in upper_els.values())
    upper = dict(ground)
    if has_upper:
        upper["side"] = val("side_upper", "side")
        upper["rear"] = val("rear_upper", "rear")

    inside = poly.representative_point()

    def clip(dist: dict[str, float]):
        env = poly
        for s in lot.segments:
            d = dist.get(roles[s.seq], 0.0)
            if d <= 0:
                continue
            mid = ((s.start_xy[0] + s.end_xy[0]) / 2, (s.start_xy[1] + s.end_xy[1]) / 2)
            env = env.intersection(half_plane(s.start_xy, s.end_xy, _inward_pt(poly, s, inside), d))
        for w in (*easements_wkt, *exclusions_wkt):
            env = env.difference(shw.loads(w))
        return _multi(env)

    env = clip(ground)
    up = clip(upper) if has_upper else None
    if env.is_empty:
        warns.append("envelope is empty after setbacks/exclusions")
    cover = select_rule(rules, "site_cover_max", lot, corner, dwelling_type)
    height = select_rule(rules, "height_max", lot, corner, dwelling_type)
    for el, r in (("site_cover_max", cover), ("height_max", height)):
        if r is None:
            unresolved.append(el)
            warns.append(f"UNRESOLVED: no '{el}' rule for dwelling_type '{dwelling_type}'; not defaulted")
    for r in (cover, height):
        if r and str(r.rule_id) not in applied:
            applied.append(str(r.rule_id))
    return EnvelopeResult(
        envelope_wkt=env.wkt, upper_envelope_wkt=up.wkt if up is not None else None, applied_rule_ids=applied,
        segment_roles=roles, setbacks_m=cache, area_m2=env.area,
        max_height_m=float(height.value_numeric) if height else None,
        max_site_cover_pct=float(cover.value_numeric) if cover else None,
        unresolved_elements=list(dict.fromkeys(unresolved)), dwelling_type=dwelling_type, warnings=warns)


def _inward_pt(poly: Polygon, s, inside) -> tuple[float, float]:
    """A point on the interior side of segment s (probe off the midpoint along its normal)."""
    a, b = np.array(s.start_xy, float), np.array(s.end_xy, float)
    t = (b - a) / np.linalg.norm(b - a)
    n = np.array([-t[1], t[0]])
    m = (a + b) / 2
    from shapely.geometry import Point
    for eps in (0.05, 0.5):
        if poly.contains(Point(*(m + n * eps))):
            return tuple(m + n)
        if poly.contains(Point(*(m - n * eps))):
            return tuple(m - n)
    return (inside.x, inside.y)
