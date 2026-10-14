"""QLD LiDAR terrain provider (stage 3).

Service metadata read 15/10/2026 (f=pjson):
  DEM    https://spatial-img.information.qld.gov.au/arcgis/rest/services/Elevation/QldDem/ImageServer
         CONFIRMED: spatial reference 102100 (3857), pixelType F32, 1 band, maxImageWidth 4096, maxImageHeight 2048, capabilities Image,Metadata,
         mosaic ByAttribute, tile cached (LERC). Description: 0.5 m and 1 m bare earth LiDAR DEMs, a 1 s (about 30 m) SRTM DEM and bathymetry in one
         mosaic, so a request outside LiDAR coverage silently returns SRTM fill.  Accuracy depends on the underlying projects.
         NOT STATED by the service: licence, height model / vertical datum, noData value.
         exportImage with bboxSR / imageSR 7856 or 4326 is ACCEPTED at request level (f=pjson returns an extent in that CRS) but the pixel
         output could not be downloaded from the sandbox, so the request is made in 3857 and the cell centres are reprojected with pyproj.
  EXTENTS https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Elevation/ElevationProjectExtents/MapServer
         layers: 0 QLD elevation data extents, 100 LiDAR tile footprints, 200 LiDAR project extents, 300 SRTM + bathymetry + OrthoDEM.
         Layer 100 fields (verified): tile_name, project_name, title, start_date, end_date, mga_zone, class_las, xyz_dem, geotif_dem, contour,
         horiz_acc, vert_acc, metadata_link, available_for_download, zgrid_dem.  A live point query returned four overlapping projects for one tile with
         vert_acc strings such as "0.3 m @ 95% CL" and geotif_dem "1 m" / "0.5 m".
Because several projects can cover one lot and the mosaic does not say which one supplied a cell, resolution, capture date and accuracy are
reported PER PROJECT, never as one invented value.  Licence CC BY SA is the owner's instruction of 15/10/2026 (docs/15 section 3), not text from the
service metadata.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone

from pyproj import Transformer
from shapely import wkt as _wkt
from shapely.geometry import Polygon
from shapely.ops import unary_union

from .chain import ExportFn, ProviderSkip, QueryFn, TerrainRequest, TerrainResult
from .provenance import NOT_STATED, STATUS_QLD_LIDAR, TIER_QLD_LIDAR, TerrainProvenance, ddmmyyyy, parse_accuracy_m
from .raster import raster_to_points, read_f32

DEM_SERVICE = "https://spatial-img.information.qld.gov.au/arcgis/rest/services/Elevation/QldDem/ImageServer"
EXTENTS_SERVICE = "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Elevation/ElevationProjectExtents/MapServer"
LAYER_TILES, LAYER_PROJECTS = 100, 200
MAX_W, MAX_H = 4096, 2048
LICENCE = ("CC BY SA (as advised by the owner on 15/10/2026; the service metadata states copyright only: Includes material (c) State of Queensland, "
           "(c) Commonwealth of Australia (Geoscience Australia, Australian Hydrographic Office))")
DATUM = "NOT STATED BY THE SERVICE (AHD NOT CONFIRMED)"
TILE_FIELDS = "tile_name,project_name,title,start_date,end_date,mga_zone,geotif_dem,horiz_acc,vert_acc,available_for_download"


def default_query(fetcher) -> QueryFn:
    """QueryFn from a ``(url, params) -> (bytes, etag)`` fetcher (the run_site / SA1 convention)."""
    import json

    def q(url: str, params: dict) -> dict:
        data = json.loads(fetcher(url, {**params, "f": "json"})[0])
        if isinstance(data, dict) and data.get("error"):
            raise RuntimeError(f"service error from {url}: {data['error']}")
        return data
    return q


def default_export(fetcher) -> ExportFn:
    return lambda url, params: fetcher(url, params)[0]


def _envelope(lot_zone, srid: int) -> str:
    import json
    x0, y0, x1, y1 = lot_zone.bounds
    return json.dumps({"xmin": x0, "ymin": y0, "xmax": x1, "ymax": y1, "spatialReference": {"wkid": srid}})


def _rings_to_geom(geom: dict | None):
    rings = (geom or {}).get("rings") or []
    polys = [Polygon(r) for r in rings if len(r) >= 4]
    polys = [p if p.is_valid else p.buffer(0) for p in polys]
    return unary_union(polys) if polys else None


@dataclass
class Coverage:
    tiles: list[dict] = field(default_factory=list)          # layer 100 attributes
    footprint: object | None = None                           # shapely union of the tile footprints (scene CRS)
    project_names: list[str] = field(default_factory=list)   # layer 200 project names at the lot


def lidar_coverage(query: QueryFn, zone, srid: int, extents: str = EXTENTS_SERVICE) -> Coverage:
    """LiDAR project coverage (layer 200; all fields requested, only ``project_name`` is verified) and the tile footprints with attributes (layer 100)
    intersecting the lot zone.  Only layer 100 tiles with a non-empty ``geotif_dem`` value count as coverage."""
    env = {"geometry": _envelope(zone, srid), "geometryType": "esriGeometryEnvelope", "inSR": srid, "spatialRel": "esriSpatialRelIntersects"}
    proj = query(f"{extents}/{LAYER_PROJECTS}/query", {**env, "outFields": "*", "returnGeometry": "false"})
    tiles = query(f"{extents}/{LAYER_TILES}/query", {**env, "outFields": TILE_FIELDS, "returnGeometry": "true", "outSR": srid})
    cov = Coverage()
    cov.project_names = sorted({(f.get("attributes") or {}).get("project_name") or "" for f in proj.get("features", [])} - {""})
    geoms = []
    for f in tiles.get("features", []):
        if not str((f.get("attributes") or {}).get("geotif_dem") or "").strip():
            continue            # a footprint without a DEM product (geotif_dem empty) does not count as LiDAR DEM coverage
        cov.tiles.append(f.get("attributes") or {})
        g = _rings_to_geom(f.get("geometry"))
        if g is not None:
            geoms.append(g)
    cov.footprint = unary_union(geoms) if geoms else None
    return cov


_RES = re.compile(r"(\d+(?:\.\d+)?)\s*(cm|m)\b", re.I)


def _res_m(text) -> float | None:
    m = _RES.search(str(text or ""))
    return float(m.group(1)) * (0.01 if m.group(2).lower() == "cm" else 1.0) if m else None


def project_table(tiles: list[dict]) -> list[dict]:
    """One row per project: resolution, capture dates and the accuracy strings exactly as the footprint layer states them."""
    rows: dict[str, dict] = {}
    for t in tiles:
        name = t.get("project_name") or NOT_STATED
        r = rows.setdefault(name, {"project": name, "title": t.get("title") or "", "res": set(), "start": [], "end": [], "vert": set(), "horiz": set(), "download": set()})
        if t.get("geotif_dem"):
            r["res"].add(str(t["geotif_dem"]))
        if t.get("start_date"):
            r["start"].append(t["start_date"])
        if t.get("end_date"):
            r["end"].append(t["end_date"])
        if t.get("vert_acc"):
            r["vert"].add(str(t["vert_acc"]))
        if t.get("horiz_acc"):
            r["horiz"].add(str(t["horiz_acc"]))
        if t.get("available_for_download"):
            r["download"].add(str(t["available_for_download"]))
    return [rows[k] for k in sorted(rows)]


def _span(r: dict) -> str | None:
    a, b = ddmmyyyy(min(r["start"])) if r["start"] else None, ddmmyyyy(max(r["end"])) if r["end"] else None
    return f"{a} TO {b}" if a and b and a != b else (a or b)


def provenance_from_tiles(tiles: list[dict], n_points: int, notes: list[str]) -> TerrainProvenance:
    rows = project_table(tiles)
    multi = len(rows) > 1
    res_txt = "; ".join(f"{'/'.join(sorted(r['res'])) or NOT_STATED} ({r['project']})" for r in rows) if multi else ("/".join(sorted(rows[0]["res"])) or NOT_STATED)
    cap_parts = [f"{r['project']} {_span(r) or 'CAPTURE DATE NOT STATED'}" for r in rows]
    capture = ("PROJECT DEPENDENT, CELL SOURCE NOT STATED BY THE SERVICE: " + "; ".join(cap_parts)) if multi else (_span(rows[0]) if rows else None)
    acc_parts = [f"{' / '.join(sorted(r['vert'])) or NOT_STATED} ({r['project']})" for r in rows]
    acc_txt = ("PROJECT DEPENDENT: " + "; ".join(acc_parts)) if multi else (acc_parts[0].rsplit(" (", 1)[0] if rows else NOT_STATED)
    nums = [parse_accuracy_m(v) for r in rows for v in r["vert"]]
    acc_m = max(nums) if nums and all(n is not None for n in nums) else None
    if multi and acc_m is not None:
        notes.append("Numeric vertical accuracy used by the earthworks module is the LARGEST value stated by any project covering the lot; confidence levels may differ between projects.")
    if any("no" == d.lower() for r in rows for d in r["download"]):
        notes.append("At least one covering tile is marked not available for download in the tile footprint layer; the elevation service may still draw from it (not confirmed).")
    res_vals = [x for r in rows for x in (_res_m(v) for v in r["res"]) if x]
    return TerrainProvenance(
        tier=TIER_QLD_LIDAR, status=STATUS_QLD_LIDAR, source_name="Queensland DEM ImageServer (QLD Government LiDAR bare earth DEM), projects: " + ", ".join(r["project"] for r in rows),
        url=DEM_SERVICE, resolution_m=min(res_vals) if res_vals else None, resolution_text=res_txt, capture_date=capture, accuracy_text=acc_txt, accuracy_m=acc_m,
        licence=LICENCE, datum=DATUM, retrieved=ddmmyyyy(datetime.now(timezone.utc)), points=n_points, notes=notes)


def export_geometry(zone, srid: int, target_res_m: float) -> tuple[tuple[float, float, float, float], int, int, float, bool]:
    """Web Mercator bbox, pixel size and a flag when the target had to be coarsened to fit the 4096 x 2048 limit.  Web pixel size is
    target / cos(latitude) so the ground cell is about ``target_res_m``."""
    to_web = Transformer.from_crs(srid, 3857, always_xy=True)
    to_ll = Transformer.from_crs(srid, 4326, always_xy=True)
    x0, y0, x1, y1 = zone.bounds
    xs, ys = zip(*[to_web.transform(x, y) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))])
    lat = to_ll.transform((x0 + x1) / 2, (y0 + y1) / 2)[1]
    p = target_res_m / math.cos(math.radians(lat))
    bx0, by0, bx1, by1 = min(xs), min(ys), max(xs), max(ys)
    w, h = math.ceil((bx1 - bx0) / p), math.ceil((by1 - by0) / p)
    coarse = False
    if w > MAX_W or h > MAX_H:
        p *= max(w / MAX_W, h / MAX_H)
        w, h = math.ceil((bx1 - bx0) / p), math.ceil((by1 - by0) / p)
        coarse = True
    return (bx0, by0, bx0 + w * p, by0 + h * p), max(w, 1), max(h, 1), p, coarse


class QldLidarProvider:
    tier, name = TIER_QLD_LIDAR, "QLD LiDAR"

    def __init__(self, query: QueryFn, export: ExportFn, target_res_m: float = 1.0, dem_service: str = DEM_SERVICE, extents_service: str = EXTENTS_SERVICE,
                 min_lot_coverage: float = 0.999):
        self.query, self.export, self.target, self.dem, self.extents, self.min_cov = query, export, target_res_m, dem_service, extents_service, min_lot_coverage

    def fetch(self, req: TerrainRequest) -> TerrainResult:
        if req.state != "QLD":
            raise ProviderSkip("QLD LiDAR service applies to Queensland lots only", notable=False)
        lot = _wkt.loads(req.boundary_wkt)
        zone = lot.buffer(req.buffer_m)
        cov = lidar_coverage(self.query, zone, req.srid, self.extents)
        if not cov.project_names and not cov.tiles:
            raise ProviderSkip("no QLD LiDAR project coverage at the lot (the DEM service would return 30 m SRTM fill, so it was not used)")
        if cov.footprint is None or cov.footprint.is_empty:
            raise ProviderSkip("a LiDAR project extent intersects the lot but no LiDAR tile footprint was returned for it, so coverage is not confirmed (SRTM fill risk); not used")
        covered = lot.intersection(cov.footprint).area / lot.area if lot.area else 0.0
        if covered < self.min_cov:
            raise ProviderSkip(f"LiDAR tile footprints cover only {covered * 100:.1f}% of the lot; a mixed LiDAR and SRTM surface is not built, so the QLD service was not used")
        bbox, w, h, pix, coarse = export_geometry(zone, req.srid, self.target)
        params = {"bbox": ",".join(f"{v:.3f}" for v in bbox), "bboxSR": 102100, "imageSR": 102100, "size": f"{w},{h}", "format": "tiff", "pixelType": "F32",
                  "interpolation": "RSP_NearestNeighbor", "noData": -9999, "f": "image"}
        data = self.export(f"{self.dem}/exportImage", params)
        arr = read_f32(data)
        if arr.shape != (h, w):
            raise RuntimeError(f"unexpected raster shape {arr.shape}, wanted {(h, w)}")
        s = raster_to_points(arr, bbox, 3857, req.srid, lot, zone, clip=cov.footprint)
        if not s.cells_in_lot or s.valid_in_lot / s.cells_in_lot < 0.95:
            raise RuntimeError(f"QldDem export returned valid cells for only {s.valid_in_lot} of {s.cells_in_lot} cells inside the lot")
        lat = Transformer.from_crs(req.srid, 4326, always_xy=True).transform(*zone.centroid.coords[0])[1]
        ground_cell = pix * math.cos(math.radians(lat))                  # ground size of one requested cell
        notes = ["Cells outside the LiDAR tile footprints (SRTM fill) were excluded.",
                 "Vertical datum is not stated by the service (AHD not confirmed); the service notes a seven-parameter transformation applied to GDA2020 projects so they align with GDA94 data in Web Mercator.",
                 f"Sampled at about {ground_cell * max(1, s.stride_inner):.2f} m ground spacing (nearest cell, requested {self.target:g} m), not at the finest project resolution; "
                 "the contour interval follows this sampled spacing."]
        if coarse:
            notes.append(f"The request was coarsened to {pix:.2f} Web Mercator units per pixel to fit the 4096 x 2048 service limit.")
        prov = provenance_from_tiles(cov.tiles, len(s.points), notes)
        prov.effective_spacing_m = round(max(ground_cell * max(1, s.stride_inner), prov.resolution_m or 0.0), 3)   # never finer than the product or the sampling
        acc = prov.accuracy_m
        survey = {"srid": req.srid, "points": s.points, "stated_vertical_accuracy_m": acc if acc is not None else 0.3,
                  "source": f"{prov.source_name} ({prov.status})"}
        warns = [] if acc is not None else ["vertical accuracy NOT STATED for the covering project(s); 0.3 m placeholder (ICSM LiDAR specification level) used only for the earthworks uncertainty, not a stated figure"]
        return TerrainResult(s.points, prov, survey, warns)
