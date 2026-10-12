"""Deterministic mesh primitives. A mesh is a triangle soup: float array (T,3,3), local metres."""
from __future__ import annotations

import math

import numpy as np
import shapely
from shapely.geometry import MultiPolygon, Polygon, box
from shapely.geometry.polygon import orient

EMPTY = np.zeros((0, 3, 3))


def cat(parts) -> np.ndarray:
    parts = [p for p in parts if len(p)]
    return np.concatenate(parts) if parts else EMPTY.copy()


def polys(g) -> list[Polygon]:
    if g is None or g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    return [p for x in getattr(g, "geoms", []) for p in polys(x)]


def tri_polygon(poly: Polygon) -> np.ndarray:
    """(T,3,2) triangles covering the polygon (holes respected)."""
    out = []
    for p in polys(poly):
        if p.area < 1e-9:
            continue
        for t in shapely.constrained_delaunay_triangles(p).geoms:
            out.append(np.asarray(t.exterior.coords)[:3])
    return np.array(out).reshape(-1, 3, 2)


def _up(tris: np.ndarray, up: bool = True) -> np.ndarray:
    n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])[:, 2]
    flip = (n < 0) if up else (n > 0)
    tris = tris.copy()
    tris[flip] = tris[flip][:, [0, 2, 1]]
    return tris


def drape(poly, zfunc, cell: float = 2.0, dz: float = 0.0) -> np.ndarray:
    """Planar polygon draped on zfunc(x,y), subdivided in cell-size pieces; faces up."""
    out = []
    for p in polys(poly):
        x0, y0, x1, y1 = p.bounds
        nx, ny = max(1, math.ceil((x1 - x0) / cell)), max(1, math.ceil((y1 - y0) / cell))
        for i in range(nx):
            for j in range(ny):
                piece = p.intersection(box(x0 + i * (x1 - x0) / nx, y0 + j * (y1 - y0) / ny,
                                           x0 + (i + 1) * (x1 - x0) / nx, y0 + (j + 1) * (y1 - y0) / ny))
                t = tri_polygon(piece)
                if len(t):
                    out.append(t)
    if not out:
        return EMPTY.copy()
    t2 = np.concatenate(out)
    z = np.asarray(zfunc(t2[..., 0].ravel(), t2[..., 1].ravel()), float).reshape(-1, 3) + dz
    return _up(np.concatenate([t2, z[..., None]], axis=2))


def flat(poly, z: float) -> np.ndarray:
    t = tri_polygon(poly)
    return _up(np.concatenate([t, np.full((len(t), 3, 1), z)], axis=2)) if len(t) else EMPTY.copy()


def prism(poly, z0: float, z1: float, caps: bool = True, sides: bool = True) -> np.ndarray:
    """Closed extrusion of a polygon (exterior walls outward-facing)."""
    out = []
    for p in polys(poly):
        p = orient(p, 1.0)
        rings = [p.exterior] + list(p.interiors)
        if sides:
            for k, r in enumerate(rings):
                c = np.asarray(r.coords)
                if k:  # holes: reverse so normals face the void
                    c = c[::-1]
                for a, b in zip(c[:-1], c[1:]):
                    A0, B0 = (*a, z0), (*b, z0)
                    A1, B1 = (*a, z1), (*b, z1)
                    out.append(np.array([[A0, B0, B1], [A0, B1, A1]]))
        if caps:
            out.append(flat(p, z1))
            out.append(_up(np.concatenate([tri_polygon(p), np.full((len(tri_polygon(p)), 3, 1), z0)], 2), False))
    return cat(out)


def strip_extrude(path, z0s, z1s, thick: float) -> np.ndarray:
    """Closed wall of thickness `thick` along a polyline with per-vertex base/top levels."""
    P = np.asarray(path, float)
    n = len(P)
    if n < 2:
        return EMPTY.copy()
    d = np.gradient(P, axis=0) if n > 2 else np.tile(P[1] - P[0], (2, 1))
    d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
    nrm = np.stack([-d[:, 1], d[:, 0]], 1) * thick / 2
    L, R = P + nrm, P - nrm
    z0s, z1s = np.asarray(z0s, float), np.asarray(z1s, float)
    def V(xy, z): return np.array([*xy, z])
    out = []
    for i in range(n - 1):
        # left face (normal +n), right face (normal -n), top, bottom
        a, b = i, i + 1
        out.append([[V(L[a], z0s[a]), V(L[b], z0s[b]), V(L[b], z1s[b])], [V(L[a], z0s[a]), V(L[b], z1s[b]), V(L[a], z1s[a])]])
        out.append([[V(R[b], z0s[b]), V(R[a], z0s[a]), V(R[a], z1s[a])], [V(R[b], z0s[b]), V(R[a], z1s[a]), V(R[b], z1s[b])]])
        out.append([[V(L[a], z1s[a]), V(L[b], z1s[b]), V(R[b], z1s[b])], [V(L[a], z1s[a]), V(R[b], z1s[b]), V(R[a], z1s[a])]])
        out.append([[V(L[a], z0s[a]), V(R[b], z0s[b]), V(L[b], z0s[b])], [V(L[a], z0s[a]), V(R[a], z0s[a]), V(R[b], z0s[b])]])
    for i, s in ((0, -1), (n - 1, 1)):
        q = [V(L[i], z0s[i]), V(R[i], z0s[i]), V(R[i], z1s[i]), V(L[i], z1s[i])]
        t = [[q[0], q[1], q[2]], [q[0], q[2], q[3]]] if s < 0 else [[q[1], q[0], q[3]], [q[1], q[3], q[2]]]
        out.append(t)
    return np.concatenate([np.array(o) for o in out])


def ring_pts(cx, cy, r, sides):
    a = np.linspace(0, 2 * math.pi, sides, endpoint=False)
    return np.stack([cx + r * np.cos(a), cy + r * np.sin(a)], 1)


def cylinder(cx, cy, r, z0, z1, sides: int = 24) -> np.ndarray:
    return prism(Polygon(ring_pts(cx, cy, r, sides)), z0, z1)


def tube(path3d, r: float, sides: int = 8) -> np.ndarray:
    """Closed tube along a 3D polyline (swept circle of radius r)."""
    P = np.asarray(path3d, float)
    if len(P) < 2:
        return EMPTY.copy()
    T = np.gradient(P, axis=0) if len(P) > 2 else np.tile(P[1] - P[0], (2, 1))
    T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-9)
    up = np.array([0, 0, 1.0])
    rings = []
    for p, t in zip(P, T):
        u = np.cross(t, up)
        if np.linalg.norm(u) < 1e-6:
            u = np.array([1.0, 0, 0])
        u /= np.linalg.norm(u)
        v = np.cross(t, u)
        a = np.linspace(0, 2 * math.pi, sides, endpoint=False)
        rings.append(p + r * (np.outer(np.cos(a), u) + np.outer(np.sin(a), v)))
    out = []
    for i in range(len(P) - 1):
        for k in range(sides):
            k2 = (k + 1) % sides
            a, b, c, d = rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]
            out.append([[a, b, c], [a, c, d]])
    for i, s in ((0, 0), (len(P) - 1, 1)):
        for k in range(sides):
            k2 = (k + 1) % sides
            tri = [P[i], rings[i][k2], rings[i][k]] if s == 0 else [P[i], rings[i][k], rings[i][k2]]
            out.append([tri])
    return np.concatenate([np.array(o) for o in out])


def area(soup: np.ndarray) -> float:
    if not len(soup):
        return 0.0
    return float(0.5 * np.linalg.norm(np.cross(soup[:, 1] - soup[:, 0], soup[:, 2] - soup[:, 0]), axis=1).sum())


def signed_volume(soup: np.ndarray) -> float:
    if not len(soup):
        return 0.0
    return float(np.einsum("ij,ij->i", soup[:, 0], np.cross(soup[:, 1], soup[:, 2])).sum() / 6.0)


def obb(poly: Polygon):
    """Oriented bounding rectangle: centre, unit u (long), unit v, half a (long), half b (short)."""
    r = np.asarray(poly.minimum_rotated_rectangle.exterior.coords)[:4]
    e1, e2 = r[1] - r[0], r[2] - r[1]
    l1, l2 = np.linalg.norm(e1), np.linalg.norm(e2)
    (u, a), (v, b) = ((e1 / l1, l1 / 2), (e2 / l2, l2 / 2)) if l1 >= l2 else ((e2 / l2, l2 / 2), (e1 / l1, l1 / 2))
    return r.mean(0), u, v, a, b


def roof(poly: Polygon, z: float, kind: str, pitch_deg: float = 22.5, eaves: float = 0.45) -> np.ndarray:
    """Roof soup above wall top `z`. kind: flat|gable|hip|skillion. Pitched roofs use the footprint's
    oriented bounding rectangle (exact for rectangles) extended by the eaves."""
    if kind == "flat":
        return flat(poly.buffer(eaves, join_style=2), z + 0.02)
    c, u, v, a, b = obb(poly)
    ae, be = a + eaves, b + eaves
    tp = math.tan(math.radians(pitch_deg))
    P = lambda s, t, h=0.0: np.array([c[0] + s * u[0] + t * v[0], c[1] + s * u[1] + t * v[1], z + h])
    def quad(*q): return _up(np.array([[q[0], q[1], q[2]], [q[0], q[2], q[3]]]))
    def tri(*q): return _up(np.array([[q[0], q[1], q[2]]]))
    out = []
    if kind == "skillion":
        H = 2 * be * tp
        out += [quad(P(-ae, -be), P(ae, -be), P(ae, be, H), P(-ae, be, H)),
                _up(np.array([[P(-ae, be), P(ae, be), P(ae, be, H)], [P(-ae, be), P(ae, be, H), P(-ae, be, H)]]), True)]
    elif kind == "gable":
        h = be * tp
        out += [quad(P(-ae, -be), P(ae, -be), P(ae, 0, h), P(-ae, 0, h)), quad(P(-ae, be), P(ae, be), P(ae, 0, h), P(-ae, 0, h)),
                tri(P(-ae, -be), P(-ae, be), P(-ae, 0, h)), tri(P(ae, -be), P(ae, be), P(ae, 0, h))]
    elif kind == "hip":
        h = be * tp
        r = max(ae - be, 0.0)
        out += [quad(P(-ae, -be), P(ae, -be), P(r, 0, h), P(-r, 0, h)), quad(P(-ae, be), P(ae, be), P(r, 0, h), P(-r, 0, h)),
                tri(P(-ae, -be), P(-ae, be), P(-r, 0, h)), tri(P(ae, -be), P(ae, be), P(r, 0, h))]
    else:
        raise ValueError(f"unknown roof kind {kind}")
    return cat(out)


def decimate(V: np.ndarray, F: np.ndarray, cap: int, attr: np.ndarray | None = None):
    """Vertex-clustering decimation of an indexed mesh to <= cap triangles (deterministic)."""
    V, F = np.asarray(V, float), np.asarray(F, np.int64)
    if len(F) <= cap:
        return V, F, attr
    ext = np.ptp(V[:, :2], axis=0)
    cell = max(math.sqrt(max(ext[0] * ext[1], 1e-6) / max(cap / 2, 1)), 1e-3)
    for _ in range(40):
        key = np.floor((V[:, :2] - V[:, :2].min(0)) / cell).astype(np.int64)
        _, inv = np.unique(key[:, 0] * 1_000_003 + key[:, 1], return_inverse=True)
        n = inv.max() + 1
        cnt = np.bincount(inv, minlength=n)
        NV = np.stack([np.bincount(inv, V[:, k], n) / cnt for k in range(3)], 1)
        NF = inv[F]
        NF = NF[(NF[:, 0] != NF[:, 1]) & (NF[:, 1] != NF[:, 2]) & (NF[:, 0] != NF[:, 2])]
        if len(NF) <= cap:
            NA = None if attr is None else np.bincount(inv, attr, n) / cnt
            return NV, NF, NA
        cell *= 1.2
    raise RuntimeError("decimation did not converge")


def soup_from(V, F) -> np.ndarray:
    return np.asarray(V, float)[np.asarray(F, np.int64)] if len(F) else EMPTY.copy()


def contour_segments(V: np.ndarray, F: np.ndarray, level: float) -> np.ndarray:
    """(S,2,3) contour segments at `level` across an indexed TIN."""
    z = V[F][:, :, 2] - level
    z = np.where(z == 0, 1e-9, z)
    s = z > 0
    cnt = s.sum(1)
    idx = np.where((cnt == 1) | (cnt == 2))[0]
    if not len(idx):
        return np.zeros((0, 2, 3))
    odd = np.where(cnt[idx] == 1, np.argmax(s[idx], 1), np.argmax(~s[idx], 1))
    a = F[idx, odd]
    b = F[idx, (odd + 1) % 3]
    c = F[idx, (odd + 2) % 3]
    def cross(i, j):
        t = (level - V[i, 2]) / (V[j, 2] - V[i, 2])
        return V[i] + (V[j] - V[i]) * t[:, None]
    return np.stack([cross(a, b), cross(a, c)], 1)
