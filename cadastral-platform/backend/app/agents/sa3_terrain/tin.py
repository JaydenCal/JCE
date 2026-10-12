"""3D TIN from x,y Delaunay with densified contours, breaklines, clipping, sampler."""
from __future__ import annotations

import numpy as np
import shapely
from scipy.spatial import Delaunay
from shapely.geometry import Polygon

from .ingest import Survey, dedupe


def densify(line: np.ndarray, max_sp: float) -> np.ndarray:
    """Insert vertices so spacing <= max_sp; z linearly interpolated."""
    out = [line[:1]]
    for a, b in zip(line[:-1], line[1:]):
        n = int(np.ceil(np.hypot(*(b[:2] - a[:2])) / max_sp))
        if n > 1:
            t = np.arange(1, n)[:, None] / n
            out.append(a + t * (b - a))
        out.append(b[None])
    return np.vstack(out)


class Tin:
    def __init__(self, vertices: np.ndarray, triangles: np.ndarray | None = None, build_params: dict | None = None):
        self.vertices = np.ascontiguousarray(vertices, float)
        self.build_params = build_params or {}
        self._del = Delaunay(self.vertices[:, :2])
        s = self._del.simplices
        if triangles is None:
            self._keep = np.ones(len(s), bool)
        else:
            want = {tuple(sorted(t)) for t in np.asarray(triangles).tolist()}
            self._keep = np.array([tuple(sorted(t)) in want for t in s.tolist()])
        self.triangles = s[self._keep].astype(np.uint32)

    @property
    def min_z(self): return float(self.vertices[:, 2].min())
    @property
    def max_z(self): return float(self.vertices[:, 2].max())

    def z_at(self, x, y) -> np.ndarray:
        """Barycentric interpolation; NaN outside the TIN. Vectorised, shape follows x."""
        x = np.asarray(x, float); y = np.asarray(y, float)
        q = np.column_stack([x.ravel(), y.ravel()])
        d = self._del
        s = d.find_simplex(q, tol=1e-9)
        ok = s >= 0
        ok[ok] = self._keep[s[ok]]
        z = np.full(len(q), np.nan)
        si = s[ok]
        T = d.transform[si]
        b = np.einsum("nij,nj->ni", T[:, :2, :], q[ok] - T[:, 2, :])
        w = np.column_stack([b, 1 - b.sum(1)])
        zv = self.vertices[d.simplices[si], 2]
        z[ok] = (w * zv).sum(1)
        return z.reshape(x.shape)

    def tri_areas(self) -> np.ndarray:
        v = self.vertices[self.triangles.astype(int)]
        a, b = v[:, 1, :2] - v[:, 0, :2], v[:, 2, :2] - v[:, 0, :2]
        return 0.5 * np.abs(a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0])

    def slope_aspect(self) -> tuple[np.ndarray, np.ndarray]:
        """Per-triangle slope (deg) and downslope aspect (deg clockwise from north)."""
        v = self.vertices[self.triangles.astype(int)]
        n = np.cross(v[:, 1] - v[:, 0], v[:, 2] - v[:, 0])
        nz = np.where(np.abs(n[:, 2]) < 1e-12, 1e-12, n[:, 2])
        gx, gy = -n[:, 0] / nz, -n[:, 1] / nz
        slope = np.degrees(np.arctan(np.hypot(gx, gy)))
        aspect = np.degrees(np.arctan2(-gx, -gy)) % 360
        return slope, aspect

    def to_bytes(self) -> tuple[bytes, bytes]:
        """(vertices_f64 interleaved x,y,z LE, triangles_u32 LE) matching terrain.tin_surfaces."""
        return self.vertices.astype("<f8").tobytes(), self.triangles.astype("<u4").tobytes()


def build_tin(survey: Survey, boundary: Polygon, max_spacing: float = 2.0, buffer_m: float = 10.0,
              max_edge: float = 40.0, min_angle_deg: float = 1.0) -> Tin:
    clip = boundary.buffer(buffer_m)
    parts = [survey.points] + [densify(c, max_spacing) for c in survey.contours] \
        + [densify(b, max_spacing) for b in survey.breaklines]
    P = dedupe(np.vstack([p.reshape(-1, 3) for p in parts if len(p)]))
    P = P[shapely.contains_xy(clip, P[:, 0], P[:, 1]) | shapely.touches(clip, shapely.points(P[:, :2]))]
    if len(P) < 3:
        raise ValueError("fewer than 3 survey points inside lot + buffer")
    d = Delaunay(P[:, :2])
    s = d.simplices
    v = P[s]
    e = np.stack([np.hypot(*(v[:, i, :2] - v[:, (i + 1) % 3, :2]).T) for i in range(3)], 1)
    cx, cy = v[:, :, 0].mean(1), v[:, :, 1].mean(1)
    keep = shapely.contains_xy(clip, cx, cy) & (e.max(1) <= max_edge)
    # sliver: smallest angle via law of cosines
    a, b, c = e[:, 0], e[:, 1], e[:, 2]
    with np.errstate(divide="ignore", invalid="ignore"):
        ang = np.degrees(np.arccos(np.clip(np.stack([
            (b**2 + c**2 - a**2) / (2 * b * c), (a**2 + c**2 - b**2) / (2 * a * c),
            (a**2 + b**2 - c**2) / (2 * a * b)], 1), -1, 1)))
    keep &= np.nan_to_num(ang, nan=0).min(1) >= min_angle_deg
    n_long, n_sliver = int((e.max(1) > max_edge).sum()), int((np.nan_to_num(ang, nan=0).min(1) < min_angle_deg).sum())
    t = Tin(P, s[keep], {"max_spacing_m": max_spacing, "buffer_m": buffer_m, "max_edge_m": max_edge,
                         "min_angle_deg": min_angle_deg, "breaklines": len(survey.breaklines),
                         "contours": len(survey.contours), "removed_long_edge": n_long,
                         "removed_sliver": n_sliver})
    t.build_params["breaklines_honoured_pct"] = breakline_honoured(t, survey.breaklines, max_spacing)
    return t


def breakline_honoured(t: Tin, breaklines, max_spacing: float) -> float:
    """% of densified breakline vertex-pairs that are TIN edges."""
    edges = set()
    for tr in t.triangles.astype(int):
        for i in range(3):
            edges.add(frozenset((tr[i], tr[(i + 1) % 3])))
    tot = ok = 0
    key = {tuple(np.round(p[:2], 3)): i for i, p in enumerate(t.vertices)}
    for b in breaklines:
        dd = densify(b, max_spacing)
        ids = [key.get(tuple(np.round(p[:2], 3))) for p in dd]
        for i, j in zip(ids[:-1], ids[1:]):
            tot += 1
            ok += int(i is not None and j is not None and frozenset((i, j)) in edges)
    return 100.0 if tot == 0 else round(100 * ok / tot, 1)


def decimate_for_mesh(t: Tin, cap: int) -> tuple[np.ndarray, np.ndarray]:
    """Vertex-clustering decimation to <= ~cap vertices; returns (vertices, triangles)."""
    if len(t.vertices) <= cap:
        return t.vertices, t.triangles.astype(int)
    xy = t.vertices[:, :2]
    ext = np.ptp(xy, axis=0)
    cell = np.sqrt(ext[0] * ext[1] / cap) * 1.1
    for _ in range(6):
        k = np.floor((xy - xy.min(0)) / cell).astype(np.int64)
        _, inv = np.unique(k, axis=0, return_inverse=True)
        if inv.max() + 1 <= cap:
            break
        cell *= 1.3
    n = inv.max() + 1
    cnt = np.bincount(inv, minlength=n)
    V = np.column_stack([np.bincount(inv, t.vertices[:, i], minlength=n) / cnt for i in range(3)])
    D = Tin(V)
    z = t.z_at(*(D.vertices[:, :2].T))
    cen = D.vertices[D.triangles.astype(int)][:, :, :2].mean(1)
    ok = ~np.isnan(t.z_at(cen[:, 0], cen[:, 1]))
    return D.vertices, D.triangles.astype(int)[ok]
