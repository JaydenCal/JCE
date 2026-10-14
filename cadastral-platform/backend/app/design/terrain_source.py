"""Terrain for the site design engines: the project's scene bundle, read once and cached.

WHICH TERRAIN. The engines work on the EXISTING ground of the project's scene bundle (``<SCENE_BUNDLE_DIR or export_dir>/<project_id>/
scene_bundle.json``, the same file GET /projects/{id}/scene-bundle serves and the 3D viewer shows): the parts of class ``existing`` (survey TIN
inside the lot) and ``context`` (surrounds) are both triangle soups of the one survey TIN that the SA3 terrain run produced, in metres local to
``info.origin``. They are joined into one indexed surface in MGA. The design surface (``surface`` / ``cutfill`` parts) is NEVER used as ground
here. Using the bundle, not the SA3 result files, means the profile a user drags against is exactly the ground they see.

The bundle is a display product: its triangles are rounded to 1 mm and, on a large survey, decimated for the viewer (see build.py). The terrain
status in ``info.terrain.status`` (for example INDICATIVE 5 m DEM, LIDAR PENDING) is carried with every result. No height is invented: outside
the triangles the surface is NaN and the engines report DATA NOT AVAILABLE for those chainages.

CACHE. One parsed terrain per bundle file, keyed by (path, modification time, size) and held in a small LRU, so a drag that calls the profile
endpoint many times reads and triangulates the bundle once. The first parse is SINGLE FLIGHT: requests that arrive while a bundle is being parsed wait
for that parse and share its result instead of each reading and triangulating the same file (a burst of first requests would otherwise multiply the
CPU and memory by the number of requests).
"""
from __future__ import annotations

import json
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from shapely.geometry import LineString, MultiLineString, Polygon
from shapely.ops import polygonize, unary_union

NO_TERRAIN = "TERRAIN DATA NOT AVAILABLE"
GROUND_CLASSES = ("existing", "context")
KERB_PART = "Kerb_line_assumed"
CACHE_SIZE = 8


class TerrainUnavailable(Exception):
    """The project has no usable existing ground (no bundle, or a bundle without existing ground parts)."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code, self.message = code, message


class TriSurface:
    """Existing ground as an indexed triangle mesh with a vectorised ``z_at`` (barycentric, NaN outside). Duck-types the part of
    ``sa3_terrain.tin.Tin`` that ``cut_fill`` uses (``vertices`` and ``z_at``), so the SA3 earthworks maths runs on it unchanged."""

    def __init__(self, vertices: np.ndarray, triangles: np.ndarray) -> None:
        self.vertices = np.ascontiguousarray(vertices, float).reshape(-1, 3)
        self.triangles = np.ascontiguousarray(triangles, np.int64).reshape(-1, 3)
        T = self.vertices[self.triangles]                                       # (m, 3, 3)
        x0, y0 = T[:, 0, 0], T[:, 0, 1]
        a, b = T[:, 1, 0] - x0, T[:, 2, 0] - x0
        c, d = T[:, 1, 1] - y0, T[:, 2, 1] - y0
        det = a * d - b * c
        self._ok = np.abs(det) > 1e-12                                          # degenerate triangles never contain a point
        det = np.where(self._ok, det, 1.0)
        self._x0, self._y0 = x0, y0
        self._ia, self._ib, self._ic, self._id = d / det, -b / det, -c / det, a / det
        self._z = T[:, :, 2]
        m = len(self.triangles)
        self.bounds = (float(self.vertices[:, 0].min()), float(self.vertices[:, 1].min()), float(self.vertices[:, 0].max()), float(self.vertices[:, 1].max())) if m else None
        self._build_grid(T)

    def _build_grid(self, T: np.ndarray) -> None:
        m = len(T)
        if not m:
            self._nx = self._ny = 0
            return
        lo, hi = T[:, :, :2].min(1), T[:, :, :2].max(1)
        x0, y0, x1, y1 = self.bounds
        size = float(np.median(hi - lo)) if m else 1.0
        cell = max(size * 1.5, (max(x1 - x0, y1 - y0) or 1.0) / 512.0, 1e-3)
        self._cell, self._gx, self._gy = cell, x0, y0
        self._nx, self._ny = int((x1 - x0) // cell) + 1, int((y1 - y0) // cell) + 1
        i0, i1 = ((lo[:, 0] - x0) // cell).astype(np.int64), ((hi[:, 0] - x0) // cell).astype(np.int64)
        j0, j1 = ((lo[:, 1] - y0) // cell).astype(np.int64), ((hi[:, 1] - y0) // cell).astype(np.int64)
        ni, nj = i1 - i0 + 1, j1 - j0 + 1
        cnt = ni * nj
        tid = np.repeat(np.arange(m), cnt)
        off = np.arange(int(cnt.sum())) - np.repeat(np.cumsum(cnt) - cnt, cnt)
        key = (j0[tid] + off // ni[tid]) * self._nx + (i0[tid] + off % ni[tid])
        order = np.argsort(key, kind="stable")
        self._tids = tid[order]
        self._start = np.searchsorted(key[order], np.arange(self._nx * self._ny + 1))

    def z_at(self, x: Any, y: Any) -> np.ndarray:
        """Barycentric height at (x, y); NaN where no triangle covers the point. Shape follows ``x``."""
        xa, ya = np.asarray(x, float), np.asarray(y, float)
        shape = xa.shape
        qx, qy = xa.ravel(), ya.ravel()
        out = np.full(qx.shape, np.nan)
        if not len(self.triangles) or not len(qx):
            return out.reshape(shape)
        ci, cj = np.floor((qx - self._gx) / self._cell).astype(np.int64), np.floor((qy - self._gy) / self._cell).astype(np.int64)
        inside = (ci >= 0) & (cj >= 0) & (ci < self._nx) & (cj < self._ny) & np.isfinite(qx) & np.isfinite(qy)
        if not inside.any():
            return out.reshape(shape)
        idx = np.flatnonzero(inside)
        key = cj[idx] * self._nx + ci[idx]
        s, e = self._start[key], self._start[key + 1]
        k = int((e - s).max())
        if k == 0:
            return out.reshape(shape)
        pos = s[:, None] + np.arange(k)[None, :]
        valid = pos < e[:, None]
        tri = self._tids[np.minimum(pos, len(self._tids) - 1)]
        dx, dy = qx[idx][:, None] - self._x0[tri], qy[idx][:, None] - self._y0[tri]
        u = self._ia[tri] * dx + self._ib[tri] * dy
        v = self._ic[tri] * dx + self._id[tri] * dy
        eps = 1e-9
        hit = valid & self._ok[tri] & (u >= -eps) & (v >= -eps) & (u + v <= 1 + eps)
        first = np.argmax(hit, axis=1)
        got = hit[np.arange(len(idx)), first]
        t = tri[np.arange(len(idx)), first]
        uu, vv = u[np.arange(len(idx)), first], v[np.arange(len(idx)), first]
        z = self._z[t]
        zz = z[:, 0] + uu * (z[:, 1] - z[:, 0]) + vv * (z[:, 2] - z[:, 0])
        sel = idx[got]
        out[sel] = zz[got]
        return out.reshape(shape)

    def window(self, polygon: Polygon, margin: float = 0.0) -> "SurfaceWindow":
        """A view limited to the bounding box of ``polygon`` (plus margin): ``cut_fill`` grids over the vertices it is given, so this keeps
        the grid small. Heights still come from the whole surface."""
        return SurfaceWindow(self, polygon.buffer(margin).bounds)


class SurfaceWindow:
    """``vertices`` of a surface inside a box (at least the box corners), with ``z_at`` delegated to the full surface."""

    def __init__(self, surface: TriSurface, box: tuple[float, float, float, float]) -> None:
        self.surface = surface
        x0, y0, x1, y1 = box
        corners = np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])
        v = surface.vertices
        inb = (v[:, 0] >= x0) & (v[:, 0] <= x1) & (v[:, 1] >= y0) & (v[:, 1] <= y1)
        self.vertices = np.vstack([v[inb], np.column_stack([corners, surface.z_at(corners[:, 0], corners[:, 1])])]) if inb.any() else \
            np.column_stack([corners, np.nan_to_num(surface.z_at(corners[:, 0], corners[:, 1]), nan=0.0)])

    def z_at(self, x: Any, y: Any) -> np.ndarray:
        return self.surface.z_at(x, y)


@dataclass
class SiteTerrain:
    surface: TriSurface
    origin: tuple[float, float]
    status: str                                     # terrain status text of the bundle, upper case
    provenance: dict[str, Any]                      # info.terrain of the bundle (source, resolution, accuracy, ...), possibly empty
    kerb: tuple[tuple[float, float], tuple[float, float]] | None       # ASSUMED kerb line end points in MGA, first to last
    lot: Polygon | None                             # lot boundary in MGA (from the bundle boundary lines)
    source: str = "scene bundle existing ground"
    notes: list[str] = field(default_factory=list)


def _soup(part: dict, origin: tuple[float, float]) -> np.ndarray:
    v = np.asarray(part.get("v") or [], float).reshape(-1, 3)
    return v + np.array([origin[0], origin[1], 0.0]) if len(v) else v


def _indexed(soups: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """Join triangle soups into one indexed mesh. Coordinates are rounded to the bundle's own precision (1 mm) to merge shared vertices."""
    P = np.vstack(soups)
    key = np.round(P, 3)
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    V = np.zeros_like(uniq)
    np.add.at(V, inv.ravel(), P)
    cnt = np.bincount(inv.ravel(), minlength=len(uniq))[:, None]
    return V / cnt, inv.ravel().reshape(-1, 3)


def _lot_polygon(parts: list[dict], origin: tuple[float, float]) -> Polygon | None:
    segs = []
    for p in parts:
        if p.get("c") != "boundary" or not p.get("lines"):
            continue
        L = np.asarray(p["lines"], float).reshape(-1, 6)
        segs += [((a[0] + origin[0], a[1] + origin[1]), (a[3] + origin[0], a[4] + origin[1])) for a in L]
    if not segs:
        return None
    polys = list(polygonize(unary_union(MultiLineString(segs))))
    return max(polys, key=lambda g: g.area) if polys else None


def _kerb_line(parts: list[dict], origin: tuple[float, float]) -> tuple[tuple[float, float], tuple[float, float]] | None:
    for p in parts:
        if p.get("n") == KERB_PART and p.get("lines"):
            L = np.asarray(p["lines"], float).reshape(-1, 6)
            a, b = L[0], L[-1]
            return (a[0] + origin[0], a[1] + origin[1]), (b[3] + origin[0], b[4] + origin[1])
    return None


def terrain_from_bundle(bundle: dict[str, Any]) -> SiteTerrain:
    """Build a ``SiteTerrain`` from a scene bundle dict (``scene_bundle.v1``)."""
    info = bundle.get("info") or {}
    o = info.get("origin") or [0.0, 0.0, 0.0]
    origin = (float(o[0]), float(o[1]))
    parts = bundle.get("parts") or []
    soups = [s for s in (_soup(p, origin) for p in parts if p.get("c") in GROUND_CLASSES and p.get("v")) if len(s)]
    if not soups:
        raise TerrainUnavailable("TERRAIN_NOT_AVAILABLE", f"{NO_TERRAIN}: the scene bundle has no existing ground")
    V, F = _indexed(soups)
    tp = info.get("terrain") or {}
    status = str(tp.get("status") or "").strip().upper() or "TERRAIN SOURCE NOT STATED"
    return SiteTerrain(TriSurface(V, F), origin, status, dict(tp), _kerb_line(parts, origin), _lot_polygon(parts, origin))


_CACHE: "OrderedDict[tuple, SiteTerrain]" = OrderedDict()
_LOCK = threading.Lock()
_INFLIGHT: dict[tuple, threading.Lock] = {}          # one lock per bundle key while it is being parsed


def load_terrain(path: Path) -> SiteTerrain:
    """The parsed terrain of a scene bundle file, cached by (path, mtime, size) and parsed once however many requests arrive together.
    Raises ``TerrainUnavailable`` when there is no bundle."""
    try:
        st = path.stat()
    except OSError:
        raise TerrainUnavailable("NO_BUNDLE", "DATA NOT AVAILABLE: no scene bundle for this project") from None
    key = (str(path), st.st_mtime_ns, st.st_size)
    with _LOCK:
        hit = _CACHE.get(key)
        if hit is not None:
            _CACHE.move_to_end(key)
            return hit
        gate = _INFLIGHT.setdefault(key, threading.Lock())
    with gate:                                                     # single flight: the first caller parses, the others wait here and then find it cached
        with _LOCK:
            hit = _CACHE.get(key)
            if hit is not None:
                _CACHE.move_to_end(key)
                return hit
        try:
            try:
                bundle = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                raise TerrainUnavailable("BUNDLE_UNREADABLE", "the scene bundle on disk could not be read") from None
            t = terrain_from_bundle(bundle)
            with _LOCK:
                _CACHE[key] = t
                for k in [k for k in _CACHE if k[0] == key[0] and k != key]:        # a newer file for the same path replaces the older entries
                    del _CACHE[k]
                while len(_CACHE) > CACHE_SIZE:
                    _CACHE.popitem(last=False)
            return t
        finally:
            with _LOCK:
                if _INFLIGHT.get(key) is gate:
                    del _INFLIGHT[key]


def clear_cache() -> None:
    with _LOCK:
        _CACHE.clear()
