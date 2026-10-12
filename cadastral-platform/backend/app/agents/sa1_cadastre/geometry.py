from __future__ import annotations

import math

from pyproj import Transformer
from shapely.geometry import MultiPolygon, Polygon, shape
from shapely.geometry.polygon import orient
from shapely.ops import transform
from shapely.validation import explain_validity

from app.agents.base import AgentError
from app.common.contracts import BoundarySegment
from .models import SegmentDetail

AREA_TOLERANCE = 0.02  # 2% vs registered area


def mga_srid_for_lon(lon: float) -> int:
    if not 138.0 <= lon < 156.0:
        raise AgentError("SA1_OUT_OF_RANGE", f"longitude {lon} outside MGA zones 54-56")
    return 7854 if lon < 144 else 7855 if lon < 150 else 7856


_T: dict = {}


def to_mga(geom, srid: int):
    t = _T.setdefault(srid, Transformer.from_crs(7844, srid, always_xy=True))
    return transform(t.transform, geom)


def parse_polygonal(geojson_geom: dict):
    """GeoJSON geometry -> validated shapely Polygon/MultiPolygon in GDA2020. Never repairs."""
    if not geojson_geom:
        raise AgentError("SA1_INVALID_GEOMETRY", "feature has no geometry")
    try:
        g = shape(geojson_geom)
    except Exception as e:  # noqa: BLE001
        raise AgentError("SA1_INVALID_GEOMETRY", f"unparseable geometry: {e}") from e
    if not isinstance(g, (Polygon, MultiPolygon)) or g.is_empty:
        raise AgentError("SA1_INVALID_GEOMETRY", f"expected non-empty polygon, got {g.geom_type}")
    if not g.is_valid:
        raise AgentError("SA1_INVALID_GEOMETRY", explain_validity(g))
    return g


def as_multi(g) -> MultiPolygon:
    return g if isinstance(g, MultiPolygon) else MultiPolygon([g])


def bearing_deg(x1, y1, x2, y2) -> float:
    return math.degrees(math.atan2(x2 - x1, y2 - y1)) % 360.0


def to_dms(deg: float) -> str:
    total = round(deg * 3600)
    total %= 360 * 3600
    d, r = divmod(total, 3600)
    m, s = divmod(r, 60)
    return f"{d}°{m:02d}'{s:02d}\""


def compute_segments(mga, roads=(), tol: float = 15.0, min_cover: float = 0.5):
    """roads: iterable of (name, LineString in MGA). Returns (segments, details, road_names).

    A segment is 'front' when >= min_cover of its length lies within `tol` metres of a road line.
    """
    from shapely.geometry import LineString
    roads = [(n, r.buffer(tol)) for n, r in roads]
    segs, det, names, seq = [], [], [], 0
    for pi, poly in enumerate(as_multi(mga).geoms):
        poly = orient(poly, sign=-1.0)  # exterior clockwise
        for ri, ring in enumerate([poly.exterior, *poly.interiors]):
            c = list(ring.coords)
            k = 0
            for (x1, y1), (x2, y2) in zip(c[:-1], c[1:]):
                d = math.hypot(x2 - x1, y2 - y1)
                if d == 0:
                    continue
                b = bearing_deg(x1, y1, x2, y2)
                line = LineString([(x1, y1), (x2, y2)])
                hit = [n for n, buf in roads if line.intersection(buf).length >= min_cover * d]
                if hit:
                    names += [n for n in hit if n and n not in names]
                segs.append(BoundarySegment(seq=seq, bearing_deg=round(b, 5), bearing_dms=to_dms(b),
                                            distance_m=round(d, 3), adjoins="road" if hit else "unknown",
                                            is_front=bool(hit) and ri == 0,
                                            start_xy=(x1, y1), end_xy=(x2, y2)))
                det.append(SegmentDetail(polygon_index=pi, ring_index=ri, seq_in_ring=k, seq=seq))
                seq += 1
                k += 1
    return segs, det, names


def area_mismatch(calculated: float, registered: float | None) -> bool:
    return bool(registered) and abs(calculated - registered) / registered > AREA_TOLERANCE
