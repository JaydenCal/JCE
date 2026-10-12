"""User-supplied parcel input for SA1 (custom municipality): GeoJSON, DXF polyline, KML, shapefile zip,
typed coordinates, or a bearings-and-distances traverse with a misclosure check.

Output is the same `LotContext` SA1 produces, with the boundary in the profile's METRIC working CRS
(`LotContext.mga_srid` carries that EPSG code) and bearings relative to GRID north.
"""
from __future__ import annotations

import json
import math
import re
import zipfile
from pathlib import Path
from typing import Any, Literal
from uuid import NAMESPACE_URL, uuid5

from pydantic import BaseModel, ConfigDict, Field
from pyproj import Transformer
from shapely.geometry import LineString, Polygon, shape

from app.agents.base import AgentError
from app.agents.sa1_cadastre.geometry import compute_segments, to_dms
from app.agents.sa1_cadastre.models import LotIdentifier, Sa1Result
from app.common.contracts import AgentCode, LotContext

from .profile import JurisdictionProfile
from .units import AmbiguousUnit, convert, parse_unit

DEFAULT_TOLERANCE = 5000.0       # 1 : 5000 relative closing error


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------------------- bearings

_QUAD = re.compile(r"^\s*([NS])\s*(\d+(?:\.\d+)?)\s*(?:[°d]\s*(?:(\d+(?:\.\d+)?)\s*['m]\s*(?:(\d+(?:\.\d+)?)\s*(?:\"|s)?)?)?)?\s*([EW])\s*$", re.I)
_AZ = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*(?:[°d]\s*(?:(\d+(?:\.\d+)?)\s*['m]\s*(?:(\d+(?:\.\d+)?)\s*(?:\"|s)?)?)?)?\s*$")


def parse_bearing(text: str | float) -> float:
    """Azimuth degrees clockwise from north.  Accepts 87.241667, 87°14'30", N 45°30' E, S10W."""
    if isinstance(text, (int, float)):
        return float(text) % 360.0
    t = text.strip().replace("º", "°").replace("’", "'").replace("”", '"')
    m = _QUAD.match(t)
    if m:
        ns, d, mi, se, ew = m.group(1).upper(), float(m.group(2)), float(m.group(3) or 0), float(m.group(4) or 0), m.group(5).upper()
        ang = d + mi / 60 + se / 3600
        if ang > 90:
            raise AgentError("PARCEL_BAD_BEARING", f"quadrant bearing {text!r} exceeds 90 degrees")
        if ns == "N":
            return ang if ew == "E" else (360 - ang) % 360
        return (180 - ang) if ew == "E" else 180 + ang
    m = _AZ.match(t)
    if m:
        return (float(m.group(1)) + float(m.group(2) or 0) / 60 + float(m.group(3) or 0) / 3600) % 360.0
    raise AgentError("PARCEL_BAD_BEARING", f"cannot read bearing {text!r}")


# ---------------------------------------------------------------------------- inputs


class TraverseLeg(Model):
    bearing: str | float
    distance: float
    unit: str | None = None            # default: the profile's length display unit - never guessed per document


class Traverse(Model):
    start: tuple[float, float]         # in the profile's horizontal CRS units
    legs: list[TraverseLeg]
    closing_leg: bool = True           # True: legs include the one returning to start (misclosure checked); False: closing line implied
    tolerance_ratio: float = DEFAULT_TOLERANCE
    accept_misclosure: bool = False    # user explicitly accepts a worse-than-tolerance misclosure
    adjust: Literal["none", "compass"] = "none"


class CustomParcelRequest(Model):
    lot_label: str = "CUSTOM-1"
    format: Literal["geojson", "dxf", "kml", "shapefile_zip", "coordinates", "traverse"]
    path: str | None = None
    geojson: dict | None = None
    coordinates: list[tuple[float, float]] | None = None      # horizontal CRS units
    traverse: Traverse | None = None
    source_epsg: int | None = None     # CRS of the data; defaults to the profile's horizontal CRS (GeoJSON: stated crs or required)
    dxf_layer: str | None = None
    dxf_units: str | None = None       # confirm when the DXF has INSUNITS 0 (unitless)
    front_edges: list[int] = Field(default_factory=list)       # input edge indices (vertex i -> i+1) that face the road
    road_lines: list[list[tuple[float, float]]] = Field(default_factory=list)   # optional, horizontal CRS
    registered_area_m2: float | None = None
    lga_name: str | None = None


class TraverseReport(Model):
    misclosure_m: float
    perimeter_m: float
    precision_ratio: float | None        # 1 : n
    within_tolerance: bool
    dx: float
    dy: float


# ---------------------------------------------------------------------------- traverse


def run_traverse(tv: Traverse, profile: JurisdictionProfile) -> tuple[list[tuple[float, float]], TraverseReport]:
    """Returns ring coordinates in the profile's horizontal CRS units (closed) and the misclosure report.

    Leg distances are converted to the horizontal CRS unit.  Bearings are taken relative to profile.crs.north_reference.
    """
    crs = profile.crs
    from .profile import crs_info
    info = crs_info(crs.horizontal_epsg)
    if not info["projected"]:
        raise AgentError("PARCEL_GEOGRAPHIC_TRAVERSE", "a traverse needs a projected horizontal CRS; give start in projected coordinates")
    m_per_unit = info["metres_per_unit"]
    off = crs.north_offset_deg()
    ctx = profile.unit_context()
    pts_m = [(0.0, 0.0)]
    total = 0.0
    for lg in tv.legs:
        unit = lg.unit or profile.units.length
        try:
            d_m = convert(lg.distance, unit, "m", ctx)
        except AmbiguousUnit as ex:
            raise AgentError("PARCEL_UNIT_AMBIGUOUS", str(ex)) from ex
        if d_m <= 0:
            raise AgentError("PARCEL_BAD_LEG", f"leg distance must be positive ({lg.distance} {unit})")
        az = math.radians(parse_bearing(lg.bearing) + off)
        x, y = pts_m[-1]
        pts_m.append((x + d_m * math.sin(az), y + d_m * math.cos(az)))
        total += d_m
    ex_, ey_ = pts_m[-1]
    mis = math.hypot(ex_, ey_)
    if not tv.closing_leg:           # implied closing line: no misclosure to check
        if len(pts_m) < 3:
            raise AgentError("PARCEL_TOO_FEW_LEGS", "need at least 2 legs plus the implied closing line")
        ring_m = pts_m
        rep = TraverseReport(misclosure_m=0.0, perimeter_m=total, precision_ratio=None, within_tolerance=True, dx=0.0, dy=0.0)
    else:
        if len(pts_m) < 4:
            raise AgentError("PARCEL_TOO_FEW_LEGS", "a closed parcel needs at least 3 legs")
        ratio = (total / mis) if mis > 1e-9 else None
        ok = mis <= 1e-9 or ratio >= tv.tolerance_ratio
        rep = TraverseReport(misclosure_m=mis, perimeter_m=total, precision_ratio=ratio, within_tolerance=ok, dx=ex_, dy=ey_)
        if not ok and not tv.accept_misclosure:
            raise AgentError("PARCEL_MISCLOSURE",
                             f"traverse misclosure {mis:.4f} m over {total:.3f} m (1:{ratio:.0f}) is worse than 1:{tv.tolerance_ratio:.0f}; "
                             "check bearings/distances/units, or set accept_misclosure after review")
        if tv.adjust == "compass" and mis > 0:
            run, adj = 0.0, [pts_m[0]]
            for (x0, y0), (x1, y1) in zip(pts_m[:-1], pts_m[1:]):
                run += math.hypot(x1 - x0, y1 - y0)
                adj.append((x1 - ex_ * run / total, y1 - ey_ * run / total))
            pts_m = adj
        ring_m = pts_m[:-1]          # the last point returns to the start
    sx, sy = tv.start
    ring = [(sx + x / m_per_unit, sy + y / m_per_unit) for x, y in ring_m]
    return ring + [ring[0]], rep


# ---------------------------------------------------------------------------- readers


def _geojson_crs(gj: dict) -> int | None:
    crs = gj.get("crs")
    if not crs:
        return None
    name = (crs.get("properties") or {}).get("name", "")
    m = re.search(r"(?:EPSG[:/]+|EPSG::)(\d+)", name) or re.search(r"/EPSG/\d+/(\d+)", name) or re.search(r"CRS84", name)
    if m is None:
        raise AgentError("PARCEL_BAD_CRS", f"unrecognised GeoJSON crs {name!r}; pass source_epsg")
    return 4326 if "CRS84" in name else int(m.group(1))


def _first_polygon(gj: dict):
    t = gj.get("type")
    feats = gj.get("features") if t == "FeatureCollection" else [gj] if t == "Feature" else [{"geometry": gj}]
    polys = []
    for f in feats:
        g = shape(f["geometry"])
        polys += list(g.geoms) if g.geom_type == "MultiPolygon" else [g] if g.geom_type == "Polygon" else []
    if not polys:
        raise AgentError("PARCEL_NO_POLYGON", "no polygon found in the supplied file")
    if len(polys) > 1:
        raise AgentError("PARCEL_MULTIPLE", f"{len(polys)} polygons supplied; supply one parcel at a time")
    return polys[0]


_INSUNITS = {1: "in", 2: "ft", 4: "mm", 5: "cm", 6: "m", 7: "km", 10: "yd"}


def _read_dxf(path: str, layer: str | None, confirm_units: str | None, profile: JurisdictionProfile) -> tuple[Polygon, str]:
    import ezdxf
    doc = ezdxf.readfile(path)
    code = int(doc.header.get("$INSUNITS", 0))
    if code in _INSUNITS:
        unit = _INSUNITS[code]
        if confirm_units and parse_unit(confirm_units, profile.unit_context()).name != parse_unit(unit).name:
            raise AgentError("PARCEL_UNIT_MISMATCH", f"DXF says {unit} but you confirmed {confirm_units}")
    elif confirm_units:
        unit = confirm_units
    else:
        raise AgentError("PARCEL_UNIT_AMBIGUOUS", "DXF has no $INSUNITS (unitless): confirm the drawing units (dxf_units), they are not guessed")
    cands = []
    for e in doc.modelspace():
        if layer and e.dxf.layer != layer:
            continue
        if e.dxftype() == "LWPOLYLINE" and (e.closed or len(e) >= 4):
            pts = [(p[0], p[1]) for p in e.get_points()]
        elif e.dxftype() == "POLYLINE" and e.is_2d_polyline:
            pts = [(v.dxf.location.x, v.dxf.location.y) for v in e.vertices]
        else:
            continue
        if pts[0] != pts[-1] and not getattr(e, "closed", False) and math.dist(pts[0], pts[-1]) > 1e-6:
            continue
        cands.append(pts)
    if not cands:
        raise AgentError("PARCEL_NO_POLYLINE", "no closed polyline found in the DXF" + (f" on layer {layer!r}" if layer else ""))
    if len(cands) > 1:
        cands.sort(key=lambda p: -Polygon(p).area)
        if not layer:
            raise AgentError("PARCEL_MULTIPLE", f"{len(cands)} closed polylines in the DXF; choose one with dxf_layer")
    return Polygon(cands[0]), unit


def _read_kml(path: str) -> dict:
    import xml.etree.ElementTree as ET
    root = ET.parse(path).getroot()
    ns = {"k": root.tag.split("}")[0].strip("{")}
    el = root.find(".//k:Polygon//k:outerBoundaryIs//k:coordinates", ns)
    if el is None or not (el.text or "").strip():
        raise AgentError("PARCEL_NO_POLYGON", "no Polygon found in the KML")
    ring = [tuple(float(v) for v in c.split(",")[:2]) for c in el.text.split()]
    return {"type": "Polygon", "coordinates": [ring]}


def _read_shp_zip(path: str) -> tuple[dict, int | None]:
    try:
        import shapefile  # pyshp
    except ImportError as ex:
        raise AgentError("PARCEL_FORMAT_UNAVAILABLE", "shapefile support needs the optional 'pyshp' package") from ex
    import tempfile
    with tempfile.TemporaryDirectory() as td, zipfile.ZipFile(path) as z:
        z.extractall(td)
        shp = next(Path(td).rglob("*.shp"), None)
        if shp is None:
            raise AgentError("PARCEL_NO_POLYGON", "no .shp in the zip")
        epsg = None
        prj = shp.with_suffix(".prj")
        if prj.exists():
            from pyproj import CRS
            try:
                epsg = CRS.from_wkt(prj.read_text()).to_epsg()
            except Exception:  # noqa: BLE001
                epsg = None
        r = shapefile.Reader(str(shp))
        feats = [{"type": "Feature", "geometry": s.__geo_interface__, "properties": {}} for s in r.shapes()]
    return {"type": "FeatureCollection", "features": feats}, epsg


# ---------------------------------------------------------------------------- build


class CustomParcelResult(Model):
    lot_context: LotContext
    traverse: TraverseReport | None = None
    flags: list[str] = Field(default_factory=list)
    source_description: str = ""


def _to_working(poly_h: Polygon, src_epsg: int, profile: JurisdictionProfile) -> Polygon:
    if src_epsg == profile.working_epsg:
        return poly_h
    t = Transformer.from_crs(src_epsg, profile.working_epsg, always_xy=True)
    return Polygon([t.transform(x, y) for x, y in poly_h.exterior.coords])


def build_custom_lot(req: CustomParcelRequest, profile: JurisdictionProfile) -> CustomParcelResult:
    flags: list[str] = ["user_supplied_parcel", "not_a_survey"]
    treport = None
    src = req.source_epsg
    ctx = profile.unit_context()
    scale_to_m = 1.0                     # for DXF with unit conversion (coordinates assumed in profile.horizontal CRS after scaling)
    front_pts_h: list[tuple[tuple[float, float], tuple[float, float]]] = []

    if req.format == "traverse":
        if req.traverse is None:
            raise AgentError("PARCEL_MISSING", "traverse data required")
        ring, treport = run_traverse(req.traverse, profile)
        poly_h, src = Polygon(ring), src or profile.crs.horizontal_epsg
        desc = f"traverse of {len(req.traverse.legs)} legs, misclosure {treport.misclosure_m:.4f} m"
        if not treport.within_tolerance:
            flags.append("misclosure_accepted_by_user")
    elif req.format == "coordinates":
        if not req.coordinates or len(req.coordinates) < 3:
            raise AgentError("PARCEL_MISSING", "at least 3 coordinates required")
        pts = list(req.coordinates)
        poly_h, src, desc = Polygon(pts), src or profile.crs.horizontal_epsg, "typed coordinates"
    else:
        if req.format == "geojson":
            gj = req.geojson or json.loads(Path(req.path or "").read_text())
            stated = _geojson_crs(gj)
            src = src or stated
            if src is None:
                raise AgentError("PARCEL_CRS_REQUIRED", "GeoJSON states no CRS: give source_epsg (RFC 7946 files are WGS84 = 4326 but this is not assumed)")
            poly_h, desc = _first_polygon(gj), "GeoJSON"
        elif req.format == "kml":
            src = src or 4326
            poly_h, desc = _first_polygon(_read_kml(req.path or "")), "KML (WGS84)"
        elif req.format == "shapefile_zip":
            gj, prj_epsg = _read_shp_zip(req.path or "")
            src = src or prj_epsg
            if src is None:
                raise AgentError("PARCEL_CRS_REQUIRED", "shapefile has no readable .prj: give source_epsg")
            poly_h, desc = _first_polygon(gj), "shapefile"
        else:  # dxf
            poly_h, unit = _read_dxf(req.path or "", req.dxf_layer, req.dxf_units, profile)
            src = src or profile.crs.horizontal_epsg
            from .profile import crs_info
            info = crs_info(src)
            if info["projected"]:
                k = convert(1.0, unit, "m", ctx) / info["metres_per_unit"]    # drawing unit -> CRS unit
                if abs(k - 1.0) > 1e-12:
                    poly_h = Polygon([(x * k, y * k) for x, y in poly_h.exterior.coords])
                    flags.append(f"dxf_units_{unit}_converted_to_crs_units")
            desc = f"DXF polyline ({unit})"
    if not poly_h.is_valid or poly_h.is_empty:
        from shapely.validation import explain_validity
        raise AgentError("PARCEL_INVALID", f"parcel polygon invalid: {explain_validity(poly_h)}")
    if poly_h.interiors:
        flags.append("holes_ignored")

    from .profile import crs_info
    if crs_info(src)["geographic"] and profile.crs.working_epsg == src:
        raise AgentError("PARCEL_GEOGRAPHIC", "metric work cannot be done in a geographic CRS")
    poly = _to_working(Polygon(poly_h.exterior.coords), src, profile)
    area = poly.area
    if area <= 0:
        raise AgentError("PARCEL_INVALID", "zero-area parcel")

    # front edges (mark via road lines in working CRS or by input edge index)
    roads = []
    if req.road_lines:
        tr = Transformer.from_crs(profile.crs.horizontal_epsg, profile.working_epsg, always_xy=True) if profile.crs.horizontal_epsg != profile.working_epsg else None
        for i, ln in enumerate(req.road_lines):
            pts = [tr.transform(x, y) for x, y in ln] if tr else ln
            roads.append((f"road {i + 1}", LineString(pts)))
    segs, det, names = compute_segments(poly, roads, tol=15.0)
    if req.front_edges:
        coords = list(Polygon(poly_h.exterior.coords).exterior.coords)
        tr2 = Transformer.from_crs(src, profile.working_epsg, always_xy=True) if src != profile.working_epsg else None
        fmids = []
        for i in req.front_edges:
            if not 0 <= i < len(coords) - 1:
                raise AgentError("PARCEL_BAD_EDGE", f"front edge index {i} out of range")
            a, b = coords[i], coords[i + 1]
            if tr2:
                a, b = tr2.transform(*a), tr2.transform(*b)
            fmids.append(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2))
        for s in segs:
            mid = ((s.start_xy[0] + s.end_xy[0]) / 2, (s.start_xy[1] + s.end_xy[1]) / 2)
            if any(math.dist(mid, f) < 1e-6 for f in fmids):
                s.is_front, s.adjoins = True, "road"
    if not any(s.is_front for s in segs):
        flags.append("no_front_segment_marked")
    reg = req.registered_area_m2
    if reg and abs(area - reg) / reg > 0.02:
        flags.append("area_mismatch")
    lot = LotContext(lot_id=uuid5(NAMESPACE_URL, f"custom:{profile.profile_id}:{req.lot_label}:{poly.wkt}"),
                     jurisdiction="CUSTOM", lotplan=req.lot_label, lga_name=req.lga_name or profile.council_label,
                     mga_srid=profile.working_epsg, area_m2_calculated=round(area, 3), area_m2_registered=reg,
                     boundary_wkt=poly.wkt, segments=segs, road_names=names)
    return CustomParcelResult(lot_context=lot, traverse=treport, flags=flags, source_description=desc)


class Sa1CustomParcel:
    """SA1 path for profile.cadastre_source.kind == 'custom'.  `run()` returns the same Sa1Result shape as Sa1Cadastre."""
    code = AgentCode.SA1_CADASTRE
    version = "1.0.0-custom"
    input_schema = "sa1_custom_request.v1"
    output_schema = "lot_context.v1"
    input_model = CustomParcelRequest

    def __init__(self, profile: JurisdictionProfile) -> None:
        if profile.cadastre_source.kind != "custom":
            raise AgentError("SA1_PROFILE_NOT_CUSTOM", "profile.cadastre_source.kind must be 'custom' to use user-supplied parcels")
        self.profile = profile

    def run(self, payload: CustomParcelRequest) -> Sa1Result:
        res = build_custom_lot(payload, self.profile)
        lot = res.lot_context
        ident = LotIdentifier(jurisdiction="CUSTOM", lot=payload.lot_label, plan_type="USER", plan_number="0")
        return Sa1Result(lot=lot, identifier=ident, segment_details=segment_details_for(lot), flags=res.flags,
                         area_mismatch="area_mismatch" in res.flags, boundary_wkt_gda2020="",
                         attributes={"source": res.source_description, "profile": self.profile.name,
                                     "profile_id": str(self.profile.profile_id), "working_epsg": self.profile.working_epsg})


def segment_details_for(lot: LotContext):
    from app.agents.sa1_cadastre.models import SegmentDetail
    return [SegmentDetail(polygon_index=0, ring_index=0, seq_in_ring=s.seq, seq=s.seq) for s in lot.segments]
