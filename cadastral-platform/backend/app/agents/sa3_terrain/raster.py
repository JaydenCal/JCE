"""Raster helpers for the terrain chain: F32 TIFF bytes -> array (Pillow, as the NSW 5 m code does) and raster cells -> MGA points.

Pillow reads single band float TIFFs; no new dependency is needed.  A GeoTIFF's georeferencing tags are NOT read: the caller always
knows the raster's bbox and CRS (the export request, or the tile index), which are authoritative here.
"""
from __future__ import annotations

import io
import math
from dataclasses import dataclass

import numpy as np
from pyproj import Transformer
from shapely.geometry.base import BaseGeometry

NODATA = -9999.0
MIN_VALID_Z = -500.0
MAX_VALID_Z = 9000.0


def read_f32(data: bytes) -> np.ndarray:
    """Float array (rows, cols), row 0 = north.  Raises ValueError when the bytes are not a single band numeric TIFF."""
    from PIL import Image
    if data[:4] not in (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+"):
        raise ValueError(f"not a TIFF: {data[:120]!r}")
    im = Image.open(io.BytesIO(data))
    if im.mode not in ("F", "I", "I;16", "L"):
        raise ValueError(f"unsupported raster mode {im.mode} (single band numeric TIFF required)")
    return np.array(im, dtype=float)


@dataclass
class Sampled:
    points: list[tuple[float, float, float]]
    cells_in_lot: int          # raster cell centres inside the lot (and the clip region, when one is given), valid or not
    valid_in_lot: int
    dropped_nodata: int
    stride_inner: int
    stride_outer: int


def _in(geom, gx, gy):
    import shapely
    shapely.prepare(geom)
    return shapely.contains_xy(geom, gx, gy)


def _crop_to_zone(arr: np.ndarray, bbox, raster_srid: int, out_srid: int, zone: BaseGeometry):
    """Window of the raster that can touch ``zone`` (large tiles are never processed whole)."""
    h, w = arr.shape
    x0, y0, x1, y1 = bbox
    if raster_srid != out_srid:
        from shapely.ops import transform as _tr
        zone = _tr(Transformer.from_crs(out_srid, raster_srid, always_xy=True).transform, zone)
    zx0, zy0, zx1, zy1 = zone.bounds
    c0 = max(0, int(math.floor((zx0 - x0) / (x1 - x0) * w)) - 1)
    c1 = min(w, int(math.ceil((zx1 - x0) / (x1 - x0) * w)) + 1)
    r0 = max(0, int(math.floor((y1 - zy1) / (y1 - y0) * h)) - 1)
    r1 = min(h, int(math.ceil((y1 - zy0) / (y1 - y0) * h)) + 1)
    if c1 <= c0 or r1 <= r0:
        return arr[:0, :0], bbox
    sx, sy = (x1 - x0) / w, (y1 - y0) / h
    return arr[r0:r1, c0:c1], (x0 + c0 * sx, y1 - r1 * sy, x0 + c1 * sx, y1 - r0 * sy)


def raster_to_points(arr: np.ndarray, bbox: tuple[float, float, float, float], raster_srid: int, out_srid: int,
                     lot: BaseGeometry, zone: BaseGeometry, *, nodata: float | None = NODATA, clip: BaseGeometry | None = None,
                     dense: BaseGeometry | None = None, max_points: int = 6000, max_outer_points: int = 2500) -> Sampled:
    """Cell centres inside ``zone`` (and ``clip`` when given) as (E, N, z) in ``out_srid``.

    Cells inside ``dense`` (default: the lot buffered 5 m) are all kept unless they exceed ``max_points``; cells beyond it are thinned by an
    integer stride to at most ``max_outer_points``.  Nothing is interpolated: every point is a raster cell value."""
    arr, bbox = _crop_to_zone(arr, bbox, raster_srid, out_srid, zone)
    h, w = arr.shape
    if not h or not w:
        return Sampled([], 0, 0, 0, 1, 1)
    x0, y0, x1, y1 = bbox
    cx = x0 + (np.arange(w) + 0.5) * (x1 - x0) / w
    cy = y1 - (np.arange(h) + 0.5) * (y1 - y0) / h
    gx, gy = np.meshgrid(cx, cy)
    if raster_srid != out_srid:
        gx, gy = Transformer.from_crs(raster_srid, out_srid, always_xy=True).transform(gx, gy)
    import shapely
    inzone = _in(zone, gx, gy)
    if clip is not None:
        inzone &= _in(clip, gx, gy)
    inlot = _in(lot, gx, gy)
    if clip is not None:
        inlot &= _in(clip, gx, gy)          # only cells that lie inside the clip count towards lot coverage
    valid = np.isfinite(arr) & (arr > MIN_VALID_Z) & (arr < MAX_VALID_Z)
    if nodata is not None:
        valid &= ~np.isclose(arr, nodata)
    cells_in_lot = int(inlot.sum())
    valid_in_lot = int((inlot & valid).sum())
    dropped = int((inzone & ~valid).sum())
    keep = inzone & valid
    dense_geom = dense if dense is not None else lot.buffer(5.0)
    ind = _in(dense_geom, gx, gy) & keep
    outd = keep & ~ind
    rr, cc = np.indices(arr.shape)
    s_in = 1
    while ind.sum() and ((ind & (rr % s_in == 0) & (cc % s_in == 0)).sum() > max_points):
        s_in += 1
    s_out = 1
    while outd.sum() and ((outd & (rr % s_out == 0) & (cc % s_out == 0)).sum() > max_outer_points):
        s_out += 1
    sel = (ind & (rr % s_in == 0) & (cc % s_in == 0)) | (outd & (rr % s_out == 0) & (cc % s_out == 0))
    pts = [(round(float(x), 3), round(float(y), 3), round(float(z), 3)) for x, y, z in zip(gx[sel], gy[sel], arr[sel])]
    return Sampled(pts, cells_in_lot, valid_in_lot, dropped, s_in, s_out)


def mean_spacing(points: list[tuple[float, float, float]], area_m2: float) -> float | None:
    return round(math.sqrt(area_m2 / len(points)), 2) if points and area_m2 > 0 else None
