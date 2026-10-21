"""Property sewer drain geometry (stage 8): stations, inverts, cover against the terrain, location classes, inspection openings and a route around objects.

Nothing here carries an engineering value. Every limit (minimum grade, minimum cover, maximum depth, inspection opening spacing and deflection, clearances) is a
requirement key resolved by ``SiteRules`` and applied by ``service_checks`` or by ``propose_sewer``. A value that is not set stays None.

The route is the shortest path in plan around the footprints of the placed objects (a visibility graph over the corners of the objects). It is a PROPOSAL for the
user to adjust: the tool never claims it is the only or the best route.

Strings are upper case where they are shown as labels and contain no em or en dash.
"""
from __future__ import annotations

import heapq
import math
from dataclasses import dataclass
from typing import Any, Sequence

import numpy as np
from shapely import STRtree
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.base import BaseGeometry

from . import object_geometry as G

#: the cover location classes of a drain; each has a requirement key ``sewer.min_cover_m.<class>``
COVER_CLASSES = ("open_ground", "footpath", "driveway")
COVER_CLASS_LABEL = {"open_ground": "OPEN GROUND", "footpath": "FOOTPATH OR PAVED AREA", "driveway": "DRIVEWAY OR TRAFFICABLE AREA"}
#: spacing of the cover stations along a drain (a resolution, not a requirement); the same value the stormwater pipe cover uses
STATION_STEP_M = 1.0
#: a drain end within this distance (m) of a node or a main is connected to it (a drawing tolerance, not a requirement)
CONNECT_TOL_M = 0.05
#: numerical offset (m) that keeps a route corner off the edge of the object it goes around; a drawing tolerance, not a clearance requirement
ROUTE_EDGE_EPS_M = 0.02
MAX_ROUTE_OBSTACLES = 80
MAX_ROUTE_VERTICES = 300


def stations(pts: Sequence[Sequence[float]], step: float = STATION_STEP_M) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(chainages, x, y): every ``step`` metres along the line plus the ends and every vertex."""
    P = np.array([(q[0], q[1]) for q in pts], float)
    cum = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(P, axis=0).T))])
    L = float(cum[-1])
    steps = np.arange(1, int(L / step) + 1) * step
    ts = np.unique(np.concatenate([[0.0, L], cum, steps[steps < L]]))
    return ts, np.interp(ts, cum, P[:, 0]), np.interp(ts, cum, P[:, 1])


def inside_any(x: float, y: float, polys: Sequence[BaseGeometry]) -> bool:
    p = Point(x, y)
    return any(g.intersects(p) for g in polys)


def location_class(x: float, y: float, driveways: Sequence[BaseGeometry], footpaths: Sequence[BaseGeometry]) -> str:
    """The cover class of a point of the drain: under a driveway, under a footpath or paved area, otherwise open ground. A driveway wins over a footpath."""
    if inside_any(x, y, driveways):
        return "driveway"
    if inside_any(x, y, footpaths):
        return "footpath"
    return "open_ground"


@dataclass
class CoverProfile:
    """Stations of a drain: invert and crown levels, terrain level, cover to the crown and the location class. Terrain arrays hold NaN where the terrain does not reach."""
    ts: np.ndarray
    xs: np.ndarray
    ys: np.ndarray
    ground: np.ndarray
    invert: np.ndarray
    crown: np.ndarray
    cover: np.ndarray
    cls: list[str]

    def finite(self) -> np.ndarray:
        return np.isfinite(self.cover)

    def min_cover(self, cls: str | None = None) -> float | None:
        m = self.finite() & (np.array([c == cls for c in self.cls]) if cls else True)
        return float(self.cover[m].min()) if np.any(m) else None


def cover_profile(pts: Sequence[Sequence[float]], up: float, down: float, dia_mm: float, ground_many, driveways: Sequence[BaseGeometry], footpaths: Sequence[BaseGeometry]) -> CoverProfile:
    """Invert (linear from ``up`` to ``down`` over the plan length), crown (invert plus the nominal diameter; wall thickness is not modelled), cover (terrain minus crown)."""
    ts, xs, ys = stations(pts)
    L = float(ts[-1])
    inv = up + (down - up) * ts / L
    crown = inv + dia_mm / 1000.0
    z = np.asarray(ground_many(xs, ys), float)
    return CoverProfile(ts, xs, ys, z, inv, crown, z - crown, [location_class(float(x), float(y), driveways, footpaths) for x, y in zip(xs, ys)])


def link_inverts(lengths: Sequence[float], start_invert: float, grade_pct: float) -> list[tuple[float, float]]:
    """(upstream, downstream) invert of each link of a run: the first starts at ``start_invert`` and each link falls ``grade_pct`` percent over its plan length; the next link
    starts at the level the last one ended (no drop at a node is assumed)."""
    out, cur = [], start_invert
    for L in lengths:
        nxt = cur - grade_pct / 100.0 * L
        out.append((cur, nxt))
        cur = nxt
    return out


def inspection_chainages(route: Sequence[Sequence[float]], max_deflection_deg: float | None, max_spacing_m: float | None) -> list[float]:
    """Chainages (m from the start) of the inspection openings the two rules require. A vertex whose change of direction exceeds ``max_deflection_deg`` gets one; then any
    stretch between openings (or the ends) longer than ``max_spacing_m`` is divided into equal parts no longer than the spacing. A rule that is None adds nothing."""
    pts = [(q[0], q[1]) for q in route]
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    cuts = [0.0]
    if max_deflection_deg is not None:
        cuts += [cum[i] for i in range(1, len(pts) - 1) if G.heading_change_deg(pts[i - 1], pts[i], pts[i + 1]) > max_deflection_deg + 1e-9]
    cuts.append(cum[-1])
    nodes = [c for c in cuts[1:-1]]
    if max_spacing_m is not None and max_spacing_m > 0:
        extra: list[float] = []
        for a, b in zip(cuts, cuts[1:]):
            n = math.ceil((b - a) / max_spacing_m - 1e-9)
            extra += [a + (b - a) * k / n for k in range(1, n)] if n > 1 else []
        nodes = sorted(set(round(c, 6) for c in nodes + extra))
    return nodes


def point_at(route: Sequence[Sequence[float]], chainage: float) -> tuple[float, float]:
    ln = LineString([(q[0], q[1]) for q in route])
    p = ln.interpolate(min(max(chainage, 0.0), ln.length))
    return (p.x, p.y)


def split_route(route: Sequence[Sequence[float]], node_chainages: Sequence[float]) -> list[list[tuple[float, float]]]:
    """The route as links: each link runs from one node (or the start) to the next (or the end) and keeps the route vertices between them."""
    pts = [(q[0], q[1]) for q in route]
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    cuts = [0.0, *sorted(c for c in node_chainages if 1e-9 < c < cum[-1] - 1e-9), cum[-1]]
    links: list[list[tuple[float, float]]] = []
    for a, b in zip(cuts, cuts[1:]):
        link = [point_at(pts, a)]
        link += [pts[i] for i in range(1, len(pts) - 1) if a + 1e-9 < cum[i] < b - 1e-9]
        link.append(point_at(pts, b))
        links.append(link)
    return links


def _visible(a: tuple[float, float], b: tuple[float, float], shrunk: Sequence[Polygon], tree: STRtree | None) -> bool:
    seg = LineString([a, b])
    if seg.length < 1e-9:
        return True
    idx = tree.query(seg) if tree is not None else range(len(shrunk))
    return not any(seg.intersection(shrunk[i]).length > 1e-9 for i in idx)


def route_around(start: tuple[float, float], end: tuple[float, float], obstacles: Sequence[BaseGeometry]) -> list[tuple[float, float]] | None:
    """The shortest plan route from ``start`` to ``end`` that does not cross the interior of any obstacle polygon, or None when there is none. The corners of the obstacles
    are pushed out by ``ROUTE_EDGE_EPS_M`` so the route runs beside them, not on them. A direct line is used when nothing is in the way."""
    polys: list[Polygon] = []
    for g in obstacles:
        for part in (g.geoms if hasattr(g, "geoms") else [g]):
            if isinstance(part, Polygon) and not part.is_empty and part.area > 0:
                polys.append(part)
    shrunk = [p.buffer(-1e-6) for p in polys]
    tree = STRtree(shrunk) if shrunk else None
    if _visible(start, end, shrunk, tree):
        return [start, end]
    corners: list[tuple[float, float]] = []
    for p in polys:
        big = p.buffer(ROUTE_EDGE_EPS_M, join_style=2, mitre_limit=2.0)
        corners += [(x, y) for x, y in big.exterior.coords[:-1]]
        corners += [(x, y) for ring in big.interiors for x, y in ring.coords[:-1]]
    nodes = [start, end] + [c for c in corners if not any(s.contains(Point(c)) for s in shrunk)]
    if len(nodes) > MAX_ROUTE_VERTICES + 2:
        return None
    n = len(nodes)
    dist = [math.inf] * n
    prev = [-1] * n
    dist[0] = 0.0
    heap = [(0.0, 0)]
    while heap:
        d, i = heapq.heappop(heap)
        if d > dist[i]:
            continue
        if i == 1:
            break
        for j in range(n):
            if j == i:
                continue
            w = math.hypot(nodes[j][0] - nodes[i][0], nodes[j][1] - nodes[i][1])
            if d + w < dist[j] - 1e-12 and _visible(nodes[i], nodes[j], shrunk, tree):
                dist[j], prev[j] = d + w, i
                heapq.heappush(heap, (dist[j], j))
    if not math.isfinite(dist[1]):
        return None
    path, k = [], 1
    while k != -1:
        path.append(nodes[k])
        k = prev[k]
    return path[::-1]


def simplify_collinear(route: Sequence[tuple[float, float]], tol_deg: float = 0.5) -> list[tuple[float, float]]:
    """Drop route vertices where the heading does not change (collinear points from the graph search)."""
    out = [route[0]]
    for i in range(1, len(route) - 1):
        if G.heading_change_deg(out[-1], route[i], route[i + 1]) > tol_deg:
            out.append(route[i])
    out.append(route[-1])
    return out
