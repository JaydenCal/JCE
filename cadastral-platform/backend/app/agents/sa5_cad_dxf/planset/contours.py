"""Contour generation by marching triangles over a TIN (vertices (n,3), triangles (m,3)).

Used for the EXISTING surface (SA3 TIN, derived from the 5 m DEM when --levels nsw) and the PROPOSED surface (pad + batters
sampled on a regular grid and triangulated).  Output polylines are lightly smoothed (Chaikin) for plotting only.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

INTERVALS = (0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0)
INDEX_EVERY = {0.1: 5, 0.25: 4, 0.5: 4, 1.0: 5, 2.0: 5, 5.0: 4, 10.0: 5, 20.0: 5, 50.0: 4}


@dataclass
class Contour:
    level: float
    pts: list[tuple[float, float]]
    closed: bool
    index: bool


def pick_interval(relief: float, min_interval: float = 0.0, max_levels: int = 14) -> float:
    for c in INTERVALS:
        if c >= min_interval - 1e-9 and relief / c <= max_levels:
            return c
    return INTERVALS[-1]


def contour_levels(zmin: float, zmax: float, interval: float) -> list[float]:
    k0 = math.ceil(zmin / interval - 1e-9)
    k1 = math.floor(zmax / interval + 1e-9)
    return [round(k * interval, 6) for k in range(k0, k1 + 1)]


def _segments(V: np.ndarray, T: np.ndarray, level: float):
    z = V[T, 2] - level
    z = np.where(z == 0, 1e-9, z)
    pos = z > 0
    n = pos.sum(1)
    sel = (n == 1) | (n == 2)
    if not sel.any():
        return []
    Tt, zt, pt = T[sel], z[sel], pos[sel]
    odd = np.where((pt.sum(1) == 1)[:, None], pt, ~pt)         # the lone vertex on its own side
    lone = odd.argmax(1)
    segs = []
    idx = np.arange(len(Tt))
    for k in range(3):
        m = lone == k
        if not m.any():
            continue
        a = Tt[m, k]
        b = Tt[m, (k + 1) % 3]
        c = Tt[m, (k + 2) % 3]

        def cross(i, j):
            zi = V[i, 2] - level
            zj = V[j, 2] - level
            zi = np.where(zi == 0, 1e-9, zi)
            zj = np.where(zj == 0, 1e-9, zj)
            t = zi / (zi - zj)
            return V[i, :2] + (V[j, :2] - V[i, :2]) * t[:, None]
        p, q = cross(a, b), cross(a, c)
        segs.append(np.stack([p, q], axis=1))
    return np.concatenate(segs) if segs else []


def _chain(segs: np.ndarray, level: float, index: bool) -> list[Contour]:
    key = lambda p: (round(float(p[0]), 5), round(float(p[1]), 5))  # noqa: E731
    adj: dict = {}
    for i, (p, q) in enumerate(segs):
        adj.setdefault(key(p), []).append((i, 0))
        adj.setdefault(key(q), []).append((i, 1))
    used = np.zeros(len(segs), bool)
    out: list[Contour] = []

    def walk(i: int, end: int) -> list:
        pts = []
        while True:
            used[i] = True
            p = segs[i][end]
            pts.append((float(p[0]), float(p[1])))
            nxt = [(j, e) for j, e in adj.get(key(p), []) if not used[j]]
            if not nxt:
                return pts
            i, e = nxt[0]
            end = 1 - e
    # open lines first: start from vertices with a single incident segment
    ends = [k for k, v in adj.items() if len(v) == 1]
    for k in ends:
        i, e = adj[k][0]
        if used[i]:
            continue
        pts = [(float(segs[i][e][0]), float(segs[i][e][1]))] + walk(i, 1 - e)
        out.append(Contour(level, pts, False, index))
    for i in range(len(segs)):
        if not used[i]:
            pts = walk(i, 1)
            pts = [(float(segs[i][0][0]), float(segs[i][0][1]))] + pts
            closed = math.dist(pts[0], pts[-1]) < 1e-4 or True
            out.append(Contour(level, pts[:-1] if math.dist(pts[0], pts[-1]) < 1e-3 else pts, math.dist(pts[0], pts[-1]) < 1e-3, index))
    return out


def chaikin(pts: list, closed: bool, iters: int = 2) -> list:
    for _ in range(iters):
        if len(pts) < 3:
            return pts
        new = [] if closed else [pts[0]]
        rng = range(len(pts)) if closed else range(len(pts) - 1)
        for i in rng:
            p, q = pts[i], pts[(i + 1) % len(pts)]
            new += [(0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]), (0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1])]
        if not closed:
            new.append(pts[-1])
        pts = new
    return pts


def contours_from_mesh(V: np.ndarray, T: np.ndarray, interval: float, index_every: int | None = None, smooth: bool = True,
                       zrange: tuple[float, float] | None = None) -> list[Contour]:
    V = np.asarray(V, float)
    T = np.asarray(T, int)
    if len(T) == 0:
        return []
    zmin, zmax = (V[:, 2].min(), V[:, 2].max()) if zrange is None else zrange
    ie = index_every or INDEX_EVERY.get(round(interval, 3), 5)
    out: list[Contour] = []
    for lv in contour_levels(zmin, zmax, interval):
        segs = _segments(V, T, lv)
        if len(segs) == 0:
            continue
        isidx = abs(lv / (interval * ie) - round(lv / (interval * ie))) < 1e-6
        for c in _chain(np.asarray(segs), lv, isidx):
            if len(c.pts) < 2:
                continue
            if smooth:
                c.pts = chaikin(c.pts, c.closed)
            out.append(c)
    return out


def grid_mesh(fn, bounds, step: float) -> tuple[np.ndarray, np.ndarray]:
    """Triangulated regular grid of fn(x, y) over bounds; cells with NaN vertices are dropped."""
    x0, y0, x1, y1 = bounds
    xs = np.arange(x0, x1 + step, step)
    ys = np.arange(y0, y1 + step, step)
    gx, gy = np.meshgrid(xs, ys)
    z = np.asarray(fn(gx.ravel(), gy.ravel()), float).reshape(gx.shape)
    ny, nx = gx.shape
    V = np.column_stack([gx.ravel(), gy.ravel(), z.ravel()])
    idx = np.arange(nx * ny).reshape(ny, nx)
    a, b, c, d = idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, 1:].ravel(), idx[1:, :-1].ravel()
    T = np.concatenate([np.column_stack([a, b, c]), np.column_stack([a, c, d])])
    ok = np.isfinite(V[T, 2]).all(1)
    return V, T[ok]
