"""Hosted LiDAR tile library (stage 3): 1 m DEM GeoTIFF / COG tiles read from a configurable location.

Configuration: env ``JCESITE_LIDAR_TILE_DIR`` = a local directory holding ``index.json`` and the tiles.  Storage is behind the thin ``TileStore``
protocol so an S3 bucket can be added later without touching the provider; only ``LocalDirTileStore`` exists now.

Index file (``index.json``)::

    {"schema": "jcesite.lidar_tile_index.v1",
     "tiles": [{"file": "Gunnedah_1m_E238000_N6569000.tif", "bbox": [minx, miny, maxx, maxy], "crs": 7856,
                "source_dataset": "ELVIS ... 1 m DEM", "capture_date": "2019-05-14" | "14/05/2019" | null, "licence": "CC BY 4.0",
                "resolution_m": 1.0, "vertical_accuracy": "0.3 m @ 95% CL" | null, "horizontal_accuracy": null, "nodata": -9999,
                "url": "https://...", "datum": "AHD"}]}

``file``, ``bbox``, ``crs``, ``source_dataset`` and ``licence`` are required; everything else is optional and reported as NOT STATED when absent.
The tile's georeference is taken from the index (bbox and CRS) and the raster size, not from GeoTIFF tags.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol

from pyproj import Transformer
import shapely
from shapely import wkt as _wkt
from shapely.geometry import box
from shapely.ops import transform as shp_transform, unary_union

from .chain import ProviderSkip, TerrainRequest, TerrainResult
from .provenance import LIDAR_PENDING_NOTE, NOT_STATED, STATUS_TILE_LIDAR, TIER_TILE_LIBRARY, TerrainProvenance, ddmmyyyy, parse_accuracy_m
from .raster import raster_to_points, read_f32

INDEX_NAME = "index.json"
INDEX_SCHEMA = "jcesite.lidar_tile_index.v1"
REQUIRED = ("file", "bbox", "crs", "source_dataset", "licence")


class TileIndexError(ValueError):
    pass


class TileStore(Protocol):
    """Where the index and the tiles live. Implement ``S3TileStore`` here later; the provider only uses these three methods."""

    def describe(self) -> str: ...
    def read_index(self) -> dict | None: ...
    def read_tile(self, name: str) -> bytes: ...


class LocalDirTileStore:
    def __init__(self, root: str | os.PathLike, index_name: str = INDEX_NAME):
        self.root, self.index_name = Path(root), index_name

    def describe(self) -> str:
        return str(self.root)

    def read_index(self) -> dict | None:
        p = self.root / self.index_name
        return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else None

    def read_tile(self, name: str) -> bytes:
        p = (self.root / name).resolve()
        if self.root.resolve() not in p.parents:
            raise TileIndexError(f"tile path escapes the library directory: {name}")
        return p.read_bytes()


def parse_index(raw: dict) -> list[dict]:
    if not isinstance(raw, dict) or not isinstance(raw.get("tiles"), list):
        raise TileIndexError("tile index must be an object with a 'tiles' list")
    out = []
    for i, t in enumerate(raw["tiles"]):
        miss = [k for k in REQUIRED if t.get(k) in (None, "")]
        if miss:
            raise TileIndexError(f"tile {i} is missing {', '.join(miss)}")
        b = t["bbox"]
        if not (isinstance(b, (list, tuple)) and len(b) == 4 and all(isinstance(v, (int, float)) for v in b) and b[0] < b[2] and b[1] < b[3]):
            raise TileIndexError(f"tile {i} has an invalid bbox {b!r} (minx, miny, maxx, maxy)")
        out.append({**t, "bbox": tuple(float(v) for v in b), "crs": int(t["crs"])})
    return out


def _capture_key(t: dict) -> tuple[int, int, int]:
    d = ddmmyyyy(t.get("capture_date"))
    return (int(d[6:]), int(d[3:5]), int(d[:2])) if d else (0, 0, 0)


def _priority(t: dict) -> tuple:
    """Which tile supplies a cell where tiles overlap: latest capture date first (undated last), then the finest resolution, then the file name."""
    res = float(t["resolution_m"]) if t.get("resolution_m") else float("inf")
    return (tuple(-v for v in _capture_key(t)), res, t["file"])


def _footprint(t: dict, srid: int):
    """Tile bbox as a polygon in the scene CRS (edges densified when the tile is in another zone)."""
    tb = box(*t["bbox"])
    if t["crs"] == srid:
        return tb
    w = max(t["bbox"][2] - t["bbox"][0], t["bbox"][3] - t["bbox"][1])
    return shp_transform(Transformer.from_crs(t["crs"], srid, always_xy=True).transform, shapely.segmentize(tb, max(w / 50.0, 1.0)))


class TileLibraryProvider:
    """NSW only: a lot is accepted only when the hosted tiles (one value per cell, see ``_priority``) cover at least ``min_lot_coverage`` of its area
    with valid cells.  Coverage = (lot intersect the tile footprints, valid cells only) / lot area, so a tile that covers half the lot is half
    coverage, never full coverage."""
    tier, name = TIER_TILE_LIBRARY, "Hosted LiDAR tile library"

    def __init__(self, store: TileStore | None, min_lot_coverage: float = 0.95, disabled_reason: str | None = None):
        self.store, self.min_cov, self.disabled_reason = store, min_lot_coverage, disabled_reason

    def fetch(self, req: TerrainRequest) -> TerrainResult:
        if req.state == "QLD":
            raise ProviderSkip("the hosted tile library is NSW only", notable=False)       # QLD lots use the QLD service: silent skip
        if self.store is None:
            raise ProviderSkip(self.disabled_reason or "hosted LiDAR tile library not configured (JCESITE_LIDAR_TILE_DIR is not set)")
        raw = self.store.read_index()
        if raw is None:
            raise ProviderSkip(f"hosted LiDAR tile library has no {INDEX_NAME} in {self.store.describe()}")
        tiles = parse_index(raw)
        lot = _wkt.loads(req.boundary_wkt)
        zone = lot.buffer(req.buffer_m)
        hits = []
        for t in tiles:
            fp = _footprint(t, req.srid)
            if fp.intersects(zone):
                hits.append((t, fp))
        covered_lot = unary_union([fp for _, fp in hits]).intersection(lot) if hits else None
        if covered_lot is None or covered_lot.is_empty or covered_lot.area <= 0:
            # the index holds no tile for this lot
            raise ProviderSkip(LIDAR_PENDING_NOTE if req.state == "NSW" else "no hosted LiDAR tile covers this lot")
        hits.sort(key=lambda h: _priority(h[0]))
        pts: list = []
        coverage = 0.0
        used: list[dict] = []
        spacing: list[float] = []
        taken = None                      # union of the footprints of the tiles already read (higher priority)
        for t, fp in hits:
            region = fp if taken is None else fp.difference(taken)     # one value per cell: an overlap is supplied by the higher priority tile only
            taken = fp if taken is None else taken.union(fp)
            if region.is_empty:
                continue
            arr = read_f32(self.store.read_tile(t["file"]))
            nod = t.get("nodata", -9999)
            s = raster_to_points(arr, t["bbox"], t["crs"], req.srid, lot, zone, nodata=None if nod is None else float(nod), clip=region)
            if s.cells_in_lot:
                coverage += lot.intersection(region).area / lot.area * (s.valid_in_lot / s.cells_in_lot)
            if s.valid_in_lot or s.points:
                used.append(t)
                cell = (t["bbox"][2] - t["bbox"][0]) / arr.shape[1]
                spacing.append(cell * max(1, s.stride_inner))      # ground spacing of the cells actually kept (metres, the tile CRS is a projected MGA zone)
            pts += s.points
        by_pos: dict[tuple[float, float], tuple[float, float, float]] = {}
        for q in pts:
            by_pos.setdefault((q[0], q[1]), q)             # tiles were read in priority order: a position never carries two levels
        pts = sorted(by_pos.values())
        if coverage < self.min_cov:
            raise ProviderSkip(f"hosted LiDAR tiles cover only {coverage * 100:.0f}% of the lot with valid cells; a partial LiDAR surface is not used")
        res = self._result(req, used, pts)
        res.provenance.effective_spacing_m = round(max(spacing), 3) if spacing else None
        return res

    def _result(self, req: TerrainRequest, used: list[dict], pts: list) -> TerrainResult:
        ds = sorted({t["source_dataset"] for t in used})
        dates = sorted({d for d in (ddmmyyyy(t.get("capture_date")) for t in used) if d}, key=lambda s: (s[6:], s[3:5], s[:2]))
        n_nodate = sum(1 for t in used if not ddmmyyyy(t.get("capture_date")))
        res = sorted({float(t["resolution_m"]) for t in used if t.get("resolution_m")})
        va = sorted({str(t["vertical_accuracy"]) for t in used if t.get("vertical_accuracy")})
        nums = [parse_accuracy_m(v) for v in va]
        capture = None
        if dates:
            capture = dates[0] if len(dates) == 1 else f"{dates[0]} TO {dates[-1]}"
            if n_nodate:
                capture += f" (CAPTURE DATE NOT STATED FOR {n_nodate} TILE(S))"
        notes = [f"Tiles used: {', '.join(t['file'] for t in used)}.", "Cell values are used as stored in the tile; nothing is interpolated or filled."]
        if len(ds) > 1:
            notes.append("More than one source dataset covers the lot; the dataset names are listed in the source.")
        licences = sorted({t["licence"] for t in used})
        prov = TerrainProvenance(
            tier=TIER_TILE_LIBRARY, status=STATUS_TILE_LIDAR, source_name="Hosted LiDAR tile library: " + "; ".join(ds), url="; ".join(sorted({t["url"] for t in used if t.get("url")})),
            resolution_m=min(res) if res else None, resolution_text=("/".join(f"{r:g}" for r in res) + " m") if res else NOT_STATED, capture_date=capture,
            accuracy_text="; ".join(va) if va else NOT_STATED, accuracy_m=max(nums) if nums and all(n is not None for n in nums) else None,
            licence="; ".join(licences), datum="; ".join(sorted({t.get("datum") or NOT_STATED for t in used})),
            retrieved=ddmmyyyy(datetime.now(timezone.utc)), points=len(pts), notes=notes)
        survey = {"srid": req.srid, "points": pts, "stated_vertical_accuracy_m": prov.accuracy_m if prov.accuracy_m is not None else 0.3,
                  "source": f"{prov.source_name} ({prov.status})"}
        warns = [] if prov.accuracy_m is not None else ["vertical accuracy NOT STATED in the tile index; 0.3 m placeholder (ICSM LiDAR specification level) used only for the earthworks uncertainty, not a stated figure"]
        return TerrainResult(pts, prov, survey, warns)


def store_from_env(env: dict[str, str] | None = None) -> TileStore | None:
    e = os.environ if env is None else env
    d = e.get("JCESITE_LIDAR_TILE_DIR")
    return LocalDirTileStore(d) if d else None
