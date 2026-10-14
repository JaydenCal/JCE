"""Plan footprints of site design objects (shapely, MGA metres), shared by the stage 7 checks.

A footprint is built only from dimensions the object really has. A dimension that is NOT SET gives ``None`` (never a guessed size), so a check that needs the
footprint is NOT EVALUATED. Point objects are rotated by ``yaw_deg`` clockwise from grid north; their local x axis is the width and local y the length (the
same convention the 3D model draws them with).
"""
from __future__ import annotations

import math
from typing import Any

from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.base import BaseGeometry

from .param_basis import NO_RULES, Reader
from .site_design import SiteObject

CIRCLE_SEGMENTS = 32


def num(o: SiteObject, key: str, rd: Reader | None = None) -> float | None:
    """A numeric parameter that is set and whose basis is accepted (``param_basis``), any sign, else None. Without a reader only USER values are accepted."""
    return (rd or NO_RULES).num(o, key)


def pos(o: SiteObject, key: str, rd: Reader | None = None) -> float | None:
    """A numeric parameter that is set, accepted and above zero, else None."""
    return (rd or NO_RULES).pos(o, key)


def flag(o: SiteObject, key: str, rd: Reader | None = None) -> bool | None:
    return (rd or NO_RULES).flag(o, key)


def text(o: SiteObject, key: str, rd: Reader | None = None) -> str | None:
    return (rd or NO_RULES).text(o, key)


def centre(o: SiteObject) -> tuple[float, float]:
    g = o.geometry
    if g.kind == "point":
        return float(g.p[0]), float(g.p[1])
    v = g.pts if g.kind == "polyline" else g.ring
    return sum(p[0] for p in v) / len(v), sum(p[1] for p in v) / len(v)


def rect_polygon(x: float, y: float, width: float, length: float, yaw_deg: float = 0.0) -> Polygon:
    t = math.radians(yaw_deg)
    s, c = math.sin(t), math.cos(t)
    pts = []
    for lx, ly in ((-width / 2, -length / 2), (width / 2, -length / 2), (width / 2, length / 2), (-width / 2, length / 2)):
        pts.append((x + lx * c + ly * s, y - lx * s + ly * c))
    return Polygon(pts)


def ring_polygon(o: SiteObject) -> Polygon | None:
    if o.geometry.kind != "polygon":
        return None
    p = Polygon([(q[0], q[1]) for q in o.geometry.ring])
    return p if p.is_valid and p.area > 0 else (p.buffer(0) if p.area > 0 else None)


def line_of(o: SiteObject) -> LineString | None:
    if o.geometry.kind != "polyline":
        return None
    ln = LineString([(q[0], q[1]) for q in o.geometry.pts])
    return ln if ln.length > 0 else None


def rwt_dims(o: SiteObject, rd: Reader | None = None) -> tuple[str | None, tuple[float, ...] | None]:
    """(shape, dimensions) of a rainwater tank: round (diameter, height) or slimline / underground (length, width, height). Dimensions are None when any is NOT SET."""
    shape = text(o, "shape", rd)
    if shape in ("slimline", "underground"):
        v = [pos(o, "length_m", rd), pos(o, "width_m", rd), pos(o, "height_m", rd)]
    else:
        v = [pos(o, "diameter_m", rd), pos(o, "height_m", rd)]
    return shape, (tuple(v) if all(x is not None for x in v) else None)  # type: ignore[arg-type]


def footprint(o: SiteObject, rd: Reader | None = None) -> BaseGeometry | None:
    """The plan footprint of an object when its dimensions are set, else None (also None when the dimensions give an empty shape). A line object with a width is its
    centreline buffered by half the width."""
    g = _footprint(o, rd)
    return None if g is None or g.is_empty else g


def _footprint(o: SiteObject, rd: Reader | None = None) -> BaseGeometry | None:
    g = o.geometry
    t = o.type
    if t == "rwt" and g.kind == "point":
        shape, d = rwt_dims(o, rd)
        if d is None:
            return None
        if shape in ("slimline", "underground"):
            return rect_polygon(g.p[0], g.p[1], d[1], d[0], g.yaw_deg or 0.0)
        return Point(g.p[0], g.p[1]).buffer(d[0] / 2, CIRCLE_SEGMENTS // 4)
    if t in ("osd", "stormwater_pit") and g.kind == "point":
        w, l = pos(o, "width_m", rd), pos(o, "length_m", rd)
        return None if w is None or l is None else rect_polygon(g.p[0], g.p[1], w, l, g.yaw_deg or 0.0)
    if t in ("osd_basin", "landscape_area", "grading_area", "building") and g.kind == "polygon":
        return ring_polygon(o)
    if t == "pool" and g.kind == "polygon":
        base = ring_polygon(o)
        cw = pos(o, "coping_width_m", rd)
        return base if base is None or cw is None else base.buffer(cw, join_style=2)
    if t == "footpath":
        if g.kind == "polygon":
            return ring_polygon(o)
        ln, w = line_of(o), pos(o, "width_m", rd)
        return None if ln is None or w is None else ln.buffer(w / 2, cap_style=2)
    ln = line_of(o)
    if ln is None:
        return None
    if t == "infiltration_trench":
        w = pos(o, "width_m", rd)
        return None if w is None else ln.buffer(w / 2, cap_style=2)
    if t == "retaining_wall":
        w = pos(o, "thickness_m", rd)
        return None if w is None else ln.buffer(w / 2, cap_style=2)
    if t == "driveway":
        w = pos(o, "width_m", rd)
        return None if w is None else ln.buffer(w / 2, cap_style=2)
    if t == "stormwater_pipe":
        d = pos(o, "diameter_mm", rd)
        return None if d is None else ln.buffer(d / 2000.0, cap_style=2)
    if t in ("pool_barrier", "service_trace", "overflow_route"):
        return ln
    return None


def distance_to_boundary(geom: BaseGeometry, lot: Polygon) -> float:
    """Shortest distance from a footprint to the lot boundary line (0 when they touch or cross)."""
    return float(geom.distance(lot.exterior))


def on_vertex(pt: tuple[float, float], other: SiteObject, tol: float) -> bool:
    c = other.geometry.p if other.geometry.kind == "point" else None
    return c is not None and math.hypot(pt[0] - c[0], pt[1] - c[1]) <= tol


def pit_at(pt: tuple[float, float], pits: list[SiteObject], tol: float) -> SiteObject | None:
    return next((p for p in pits if on_vertex(pt, p, tol)), None)


def heading_change_deg(a: Any, b: Any, c: Any) -> float:
    """Absolute change of heading (degrees) at b between a to b and b to c."""
    h1 = math.atan2(b[1] - a[1], b[0] - a[0])
    h2 = math.atan2(c[1] - b[1], c[0] - b[0])
    d = abs(h2 - h1) % (2 * math.pi)
    return math.degrees(min(d, 2 * math.pi - d))
