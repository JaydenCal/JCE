"""Small mesh builders for the export of site design objects (plan polygons, ribbons, prisms, cylinders). All coordinates are (E, N, U) in metres; the GLB writer
turns them into glTF axes. Nothing here decides a dimension: a builder is called only with the dimensions the object has."""
from __future__ import annotations

import math
from typing import Sequence

from shapely.geometry import Polygon

Vec = tuple[float, float, float]
Mesh = tuple[list[Vec], list[int]]


def _ccw(ring: Sequence[Sequence[float]]) -> bool:
    a = 0.0
    for i, p in enumerate(ring):
        q = ring[(i + 1) % len(ring)]
        a += p[0] * q[1] - q[0] * p[1]
    return a > 0


def triangulate_ring(ring: Sequence[Sequence[float]]) -> list[tuple[int, int, int]]:
    """Triangles (indices into ``ring``) covering a simple polygon, by ear clipping. A degenerate ring gives an empty list."""
    n = len(ring)
    if n < 3:
        return []
    idx = list(range(n)) if _ccw(ring) else list(range(n - 1, -1, -1))
    out: list[tuple[int, int, int]] = []

    def cross(a, b, c):
        return (ring[b][0] - ring[a][0]) * (ring[c][1] - ring[a][1]) - (ring[b][1] - ring[a][1]) * (ring[c][0] - ring[a][0])

    def inside(p, a, b, c):
        d1, d2, d3 = cross(a, b, p), cross(b, c, p), cross(c, a, p)
        return d1 >= -1e-12 and d2 >= -1e-12 and d3 >= -1e-12

    guard = 0
    while len(idx) > 3 and guard < 10 * n * n:
        guard += 1
        clipped = False
        for k in range(len(idx)):
            a, b, c = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            if cross(a, b, c) <= 1e-12:
                continue
            if any(inside(p, a, b, c) for p in idx if p not in (a, b, c)):
                continue
            out.append((a, b, c))
            del idx[k]
            clipped = True
            break
        if not clipped:
            break
    if len(idx) == 3:
        out.append((idx[0], idx[1], idx[2]))
    return out


def fill(ring: Sequence[Sequence[float]], zs: Sequence[float]) -> Mesh:
    """A polygon surface with a level at every vertex."""
    pts = [(float(p[0]), float(p[1]), float(z)) for p, z in zip(ring, zs)]
    tri = triangulate_ring(pts)
    return pts, [i for t in tri for i in t]


def prism(ring: Sequence[Sequence[float]], z_base: float, z_top: float) -> Mesh:
    """A closed block: top cap, bottom cap and the walls."""
    n = len(ring)
    pts: list[Vec] = [(float(p[0]), float(p[1]), float(z_top)) for p in ring] + [(float(p[0]), float(p[1]), float(z_base)) for p in ring]
    tri = triangulate_ring(ring)
    idx: list[int] = []
    for a, b, c in tri:
        idx += [a, b, c, n + a, n + c, n + b]
    for i in range(n):
        j = (i + 1) % n
        idx += [i, j, n + j, i, n + j, n + i]
    return pts, idx


def ribbon(pts: Sequence[Sequence[float]], width: float, zs: Sequence[float]) -> Mesh:
    """A flat strip along a polyline, ``width`` wide, with a level at every vertex."""
    n = len(pts)
    out: list[Vec] = []
    for i in range(n):
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, n - 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        d = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / d * width / 2, dx / d * width / 2
        out.append((pts[i][0] + nx, pts[i][1] + ny, zs[i]))
        out.append((pts[i][0] - nx, pts[i][1] - ny, zs[i]))
    idx: list[int] = []
    for i in range(n - 1):
        a, b, c, d = 2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 3
        idx += [a, b, c, b, d, c]
    return out, idx


def wall(pts: Sequence[Sequence[float]], thickness: float, z_bottom: Sequence[float], z_top: Sequence[float]) -> Mesh:
    """A wall along a polyline: ``thickness`` wide, from a bottom level to a top level at every vertex (both faces, the top and the ends)."""
    n = len(pts)
    left: list[tuple[float, float]] = []
    right: list[tuple[float, float]] = []
    for i in range(n):
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, n - 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        d = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / d * thickness / 2, dx / d * thickness / 2
        left.append((pts[i][0] + nx, pts[i][1] + ny))
        right.append((pts[i][0] - nx, pts[i][1] - ny))
    v: list[Vec] = []
    for i in range(n):
        v += [(*left[i], z_top[i]), (*right[i], z_top[i]), (*left[i], z_bottom[i]), (*right[i], z_bottom[i])]
    idx: list[int] = []
    for i in range(n - 1):
        a, b = 4 * i, 4 * (i + 1)
        idx += [a, a + 1, b, a + 1, b + 1, b]                       # top
        idx += [a, b, a + 2, b, b + 2, a + 2]                       # left face
        idx += [a + 1, a + 3, b + 1, b + 1, a + 3, b + 3]           # right face
    idx += [0, 2, 1, 1, 2, 3]
    e = 4 * (n - 1)
    idx += [e, e + 1, e + 2, e + 1, e + 3, e + 2]
    return v, idx


def cylinder(cx: float, cy: float, z0: float, r: float, h: float, n: int = 24) -> Mesh:
    ring = [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    return prism(ring, z0, z0 + h)


def box(cx: float, cy: float, z0: float, w: float, d: float, h: float, yaw_deg: float = 0.0) -> Mesh:
    t = math.radians(yaw_deg)
    s, c = math.sin(t), math.cos(t)
    ring = []
    for lx, ly in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)):
        ring.append((cx + lx * c + ly * s, cy - lx * s + ly * c))
    return prism(ring, z0, z0 + h)


def ellipsoid(cx: float, cy: float, zc: float, rx: float, rz: float, nu: int = 16, nv: int = 8) -> Mesh:
    v: list[Vec] = []
    for j in range(nv + 1):
        phi = math.pi * j / nv
        for i in range(nu):
            th = 2 * math.pi * i / nu
            v.append((cx + rx * math.sin(phi) * math.cos(th), cy + rx * math.sin(phi) * math.sin(th), zc + rz * math.cos(phi)))
    idx: list[int] = []
    for j in range(nv):
        for i in range(nu):
            a, b = j * nu + i, j * nu + (i + 1) % nu
            c, d = (j + 1) * nu + i, (j + 1) * nu + (i + 1) % nu
            idx += [a, c, b, b, c, d]
    return v, idx


def ring_polygon(ring: Sequence[Sequence[float]]) -> Polygon | None:
    p = Polygon([(q[0], q[1]) for q in ring])
    return p if p.is_valid and p.area > 0 else None
