"""Neutral plan model shared by the DXF and PDF builders.

Both outputs are produced from the same ``PlanModel`` (parsed shapely geometry
plus derived dimension specs), so they cannot drift apart.
"""
from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass, field
from typing import Sequence

from pydantic import Field
from shapely import force_2d
from shapely import wkt as swkt
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from app.agents.base import AgentError
from app.common.contracts import CadRequest, ServiceLine

DISCLAIMER_PARTS = (
    "Indicative only. Not a survey.",
    "Verify BYDA plans and physically locate services before excavation.",
    "Verify setbacks with council.",
)
DISCLAIMER = " ".join(DISCLAIMER_PARTS)

# Default horizontal exclusion distance (m) either side of a service line when the
# upstream agent supplied no exclusion polygon.  Indicative planning values only.
DEFAULT_EXCLUSION_M = {
    "water": 0.6, "sewer": 1.0, "stormwater": 0.6, "electricity": 1.0,
    "gas": 1.0, "telecom": 0.5, "other": 0.5,
}


class CadRequestSa5(CadRequest):
    """CadRequest plus optional level spots (x, y, RL) - proposed contract addition."""

    level_spots: list[tuple[float, float, float]] = Field(default_factory=list)
    # optional aerial underlay: image north-up in plan coordinates; extent = (xmin, ymin, xmax, ymax) metres
    basemap_image_path: str | None = None
    basemap_extent: tuple[float, float, float, float] | None = None
    basemap_note: str = ""   # source / imagery date line for the legend


@dataclass
class DimSpec:
    kind: str                       # frontage | setback | driveway
    label: str
    p1: tuple[float, float]
    p2: tuple[float, float]
    text: str
    side: tuple[float, float]       # unit vector, direction to offset the dimension line
    offset_mm: float                # paper offset of the dimension line from p1-p2

    @property
    def length(self) -> float:
        return math.dist(self.p1, self.p2)


@dataclass
class RadiusDim:
    centre: tuple[float, float]
    radius: float
    angle_deg: float
    text: str


@dataclass
class ServiceDraw:
    service: str
    label: str
    geom: BaseGeometry
    diameter_mm: int | None
    depth_m: float | None
    is_proposed: bool
    exclusion: BaseGeometry | None
    exclusion_derived: bool


@dataclass
class OverlayDraw:
    label: str
    kind: str
    geom: BaseGeometry


@dataclass
class PlanModel:
    request: CadRequestSa5
    lot: Polygon
    envelope: Polygon | None
    footprint: Polygon | None
    drive_centreline: LineString | None
    drive_poly: Polygon | None
    crossover: Polygon | None
    turn_path: BaseGeometry | None
    turn_centre: tuple[float, float] | None
    turn_radius: float | None
    radius_dim: RadiusDim | None
    services: list[ServiceDraw]
    rwt: tuple[float, float, float] | None          # x, y, diameter
    rwt_text: str
    overlays: list[OverlayDraw]
    dims: list[DimSpec]
    level_spots: list[tuple[float, float, float]]
    issue_date: str
    scale: int
    warnings: list[str] = field(default_factory=list)

    @property
    def rep_point(self) -> Point:
        return self.lot.representative_point()


# ---- helpers ----------------------------------------------------------------

def load_polygon(wkt_text: str, what: str) -> Polygon:
    try:
        g = force_2d(swkt.loads(wkt_text))
    except Exception as exc:  # shapely raises various WKT errors
        raise AgentError("INVALID_GEOMETRY", f"{what}: unparseable WKT ({exc})") from exc
    if g.is_empty:
        raise AgentError("INVALID_GEOMETRY", f"{what}: empty geometry")
    if g.geom_type == "Polygon":
        return g
    if g.geom_type == "MultiPolygon":
        return max(g.geoms, key=lambda p: p.area)
    raise AgentError("INVALID_GEOMETRY", f"{what}: expected polygon, got {g.geom_type}")


def load_geom(wkt_text: str, what: str) -> BaseGeometry:
    try:
        g = force_2d(swkt.loads(wkt_text))
    except Exception as exc:
        raise AgentError("INVALID_GEOMETRY", f"{what}: unparseable WKT ({exc})") from exc
    if g.is_empty:
        raise AgentError("INVALID_GEOMETRY", f"{what}: empty geometry")
    return g


def lines_of(g: BaseGeometry) -> list[LineString]:
    """All linear parts of ``g`` (polygon rings included)."""
    if g.is_empty:
        return []
    t = g.geom_type
    if t == "LineString":
        return [g]
    if t == "LinearRing":
        return [LineString(g.coords)]
    if t == "Polygon":
        return [LineString(g.exterior.coords)] + [LineString(r.coords) for r in g.interiors]
    if hasattr(g, "geoms"):
        out: list[LineString] = []
        for p in g.geoms:
            out.extend(lines_of(p))
        return out
    return []


def polygons_of(g: BaseGeometry) -> list[Polygon]:
    if g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    if hasattr(g, "geoms"):
        out: list[Polygon] = []
        for p in g.geoms:
            out.extend(polygons_of(p))
        return out
    return []


def left_normal(dx: float, dy: float) -> tuple[float, float]:
    n = math.hypot(dx, dy)
    return (-dy / n, dx / n)


def dim_text(label: str, length: float) -> str:
    if any(ch.isdigit() for ch in label):
        return label
    return f"{label} {length:.2f} m" if label else f"{length:.2f} m"


def hatch_lines(poly: Polygon, spacing: float, angle_deg: float) -> list[LineString]:
    """Parallel hatch lines clipped to ``poly`` (used by the PDF renderer)."""
    minx, miny, maxx, maxy = poly.bounds
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    r = math.hypot(maxx - minx, maxy - miny) / 2 + spacing
    a = math.radians(angle_deg)
    ux, uy = math.cos(a), math.sin(a)
    nx, ny = -uy, ux
    out: list[LineString] = []
    n = int(r / spacing) + 1
    for i in range(-n, n + 1):
        ox, oy = cx + nx * i * spacing, cy + ny * i * spacing
        seg = LineString([(ox - ux * r, oy - uy * r), (ox + ux * r, oy + uy * r)])
        out.extend(lines_of(seg.intersection(poly)))
    return out


# ---- derivations ------------------------------------------------------------

def _away_side(p1: tuple[float, float], p2: tuple[float, float], rep: Point) -> tuple[float, float]:
    """Unit normal to p1-p2 pointing away from the lot representative point."""
    nx, ny = left_normal(p2[0] - p1[0], p2[1] - p1[1])
    mx, my = (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2
    if (nx * (mx - rep.x) + ny * (my - rep.y)) < 0:
        nx, ny = -nx, -ny
    return (nx, ny)


def _setback_name(seg, front_dirs: list[tuple[float, float]]) -> str:
    if seg.is_front:
        return "Front"
    if seg.adjoins == "road":
        return "Side (road)"
    dx, dy = seg.end_xy[0] - seg.start_xy[0], seg.end_xy[1] - seg.start_xy[1]
    n = math.hypot(dx, dy)
    for fx, fy in front_dirs:
        if (dx * fx + dy * fy) / n < -0.7:
            return "Rear"
    return "Side"


def derive_setbacks(lot: Polygon, envelope: Polygon, segments, rep: Point, limit: int = 6) -> list[DimSpec]:
    """Setback = distance from a boundary segment to the envelope along its inward normal."""
    front_dirs = []
    for s in segments:
        if s.is_front:
            dx, dy = s.end_xy[0] - s.start_xy[0], s.end_xy[1] - s.start_xy[1]
            n = math.hypot(dx, dy)
            if n > 0:
                front_dirs.append((dx / n, dy / n))
    reach = math.hypot(lot.bounds[2] - lot.bounds[0], lot.bounds[3] - lot.bounds[1])
    cands: list[tuple[float, DimSpec]] = []
    for s in segments:
        dx, dy = s.end_xy[0] - s.start_xy[0], s.end_xy[1] - s.start_xy[1]
        length = math.hypot(dx, dy)
        if length < 6.0:
            continue
        ux, uy = dx / length, dy / length
        nx, ny = -uy, ux
        o = (s.start_xy[0] + ux * length * 0.25, s.start_xy[1] + uy * length * 0.25)
        if not lot.buffer(1e-6).contains(Point(o[0] + nx * 0.02, o[1] + ny * 0.02)):
            nx, ny = -nx, -ny
        ray = LineString([o, (o[0] + nx * reach, o[1] + ny * reach)])
        hit = ray.intersection(envelope.exterior)
        pts = [g for g in (hit.geoms if hasattr(hit, "geoms") else [hit]) if g.geom_type == "Point"]
        if not pts:
            continue
        p = min(pts, key=lambda g: Point(o).distance(g))
        d = Point(o).distance(p)
        if d < 0.05 or envelope.contains(Point(o)):
            continue
        name = _setback_name(s, front_dirs)
        p2 = (p.x, p.y)
        spec = DimSpec("setback", f"{name} setback", o, p2, f"{name} {d:.2f} m",
                       _away_side(o, p2, rep), 3.0)
        cands.append((length, spec))
    cands.sort(key=lambda t: -t[0])
    return [c[1] for c in cands[:limit]]


def build_plan_model(req: CadRequestSa5) -> PlanModel:
    lot = load_polygon(req.lot.boundary_wkt, "lot.boundary_wkt")
    warnings: list[str] = []
    rep = lot.representative_point()
    envelope = load_polygon(req.lot.envelope_wkt, "lot.envelope_wkt") if req.lot.envelope_wkt else None
    footprint = load_polygon(req.overlay.footprint_wkt, "overlay.footprint_wkt") if req.overlay else None

    dims: list[DimSpec] = []
    # lot frontage
    for s in req.lot.segments:
        if s.is_front:
            length = math.dist(s.start_xy, s.end_xy)
            dims.append(DimSpec("frontage", "Frontage", s.start_xy, s.end_xy,
                                f"Frontage {length:.2f} m", _away_side(s.start_xy, s.end_xy, rep), 8.0))
    if envelope is not None:
        dims.extend(derive_setbacks(lot, envelope, req.lot.segments, rep))

    # driveway
    dcl = dpoly = xover = tpath = None
    tcentre = tradius = None
    rdim = None
    if req.driveway is not None:
        dw = req.driveway
        dcl = load_geom(dw.centreline_wkt, "driveway.centreline_wkt")
        if dcl.geom_type != "LineString":
            dcl = max(lines_of(dcl), key=lambda g: g.length)
        dpoly = dcl.buffer(dw.width_m / 2.0, cap_style="flat", join_style="mitre")
        xover = load_polygon(dw.crossover_wkt, "driveway.crossover_wkt")
        if dw.turning_path_wkt:
            tpath = load_geom(dw.turning_path_wkt, "driveway.turning_path_wkt")
        if dw.turning_circle_centre_xy and dw.turning_circle_radius_m:
            tcentre = tuple(dw.turning_circle_centre_xy)
            tradius = float(dw.turning_circle_radius_m)
            rdim = RadiusDim(tcentre, tradius, 45.0, f"R{tradius:.2f} m")
        for label, p1, p2 in dw.dimensions:
            d = math.dist(p1, p2)
            if d <= 0:
                continue
            dims.append(DimSpec("driveway", label, tuple(p1), tuple(p2), dim_text(label, d),
                                _away_side(p1, p2, rep), 4.0))
        if not any("width" in x.label.lower() for x in dims if x.kind == "driveway") and dcl.length > 1.0:
            a = dcl.interpolate(0.4 * dcl.length)
            b = dcl.interpolate(min(dcl.length, 0.4 * dcl.length + 0.5))
            ux, uy = left_normal(b.x - a.x, b.y - a.y)
            hw = dw.width_m / 2.0
            p1 = (a.x - ux * hw, a.y - uy * hw)
            p2 = (a.x + ux * hw, a.y + uy * hw)
            dims.append(DimSpec("driveway", "Driveway width", p1, p2, f"Driveway width {dw.width_m:.2f} m",
                                _away_side(p1, p2, rep), 4.0))

    services: list[ServiceDraw] = []
    for sl in req.services:
        services.append(_service(sl))

    rwt = None
    rwt_text = ""
    if req.rwt is not None:
        rwt = (req.rwt.location_xy[0], req.rwt.location_xy[1], req.rwt.diameter_m)
        rwt_text = f"RWT {req.rwt.tank_volume_l} L"
        if req.rwt.regime:
            rwt_text += f" ({req.rwt.regime})"

    overlays = [OverlayDraw(o.label, o.kind, load_geom(o.geometry_wkt, f"overlay {o.label}")) for o in req.council_overlays]

    if not lot.is_valid:
        warnings.append("Lot boundary polygon is not valid; drawn as supplied.")

    return PlanModel(
        request=req, lot=lot, envelope=envelope, footprint=footprint,
        drive_centreline=dcl, drive_poly=dpoly, crossover=xover, turn_path=tpath,
        turn_centre=tcentre, turn_radius=tradius, radius_dim=rdim, services=services,
        rwt=rwt, rwt_text=rwt_text, overlays=overlays, dims=dims,
        level_spots=[tuple(p) for p in req.level_spots],
        issue_date=dt.date.today().isoformat(), scale=req.drawing_scale_denominator, warnings=warnings,
    )


def _service(sl: ServiceLine) -> ServiceDraw:
    g = load_geom(sl.geometry_wkt, f"service {sl.label}")
    excl = None
    derived = False
    if sl.exclusion_wkt:
        excl = load_geom(sl.exclusion_wkt, f"exclusion {sl.label}")
    elif g.geom_type in ("LineString", "MultiLineString"):
        excl = g.buffer(DEFAULT_EXCLUSION_M[sl.service], cap_style="flat", join_style="round")
        derived = True
    return ServiceDraw(sl.service, sl.label, g, sl.diameter_mm, sl.depth_m, sl.is_proposed, excl, derived)


def union_bounds(geoms: Sequence[BaseGeometry]) -> tuple[float, float, float, float]:
    u = unary_union([g for g in geoms if g is not None and not g.is_empty])
    return u.bounds
