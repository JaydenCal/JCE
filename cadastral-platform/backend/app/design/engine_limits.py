"""Input caps for the stage 6 engines (driveway profile, grading): they protect the server from requests that would take unbounded CPU or memory.

These are SANITY limits, not engineering values and not requirements: nothing here says what a driveway or a grading area may be, only how large a
single request may be before the server refuses to compute it. A request over a cap is refused with 422 (``EngineLimitError``) before any sampling,
triangulation or grid is built.

* geometry must lie inside the terrain bounds plus ``BOUNDS_MARGIN_M`` (a point further out has no ground under it and only makes the work larger)
* a driveway centreline is at most ``MAX_CENTRELINE_M`` long and has at most ``MAX_DRIVEWAY_VERTICES`` vertices
* a grading area outline encloses at most ``MAX_GRADING_AREA_M2`` and has at most ``MAX_GRADING_VERTICES`` vertices
* the cut and fill grid (platform plus batter reach) has at most ``MAX_GRID_CELLS`` cells
"""
from __future__ import annotations

import math
from typing import Any, Sequence

BOUNDS_MARGIN_M = 20.0
MAX_CENTRELINE_M = 300.0
MAX_DRIVEWAY_VERTICES = 200
MAX_GRADING_AREA_M2 = 20000.0
MAX_GRADING_VERTICES = 500
MAX_GRID_CELLS = 600_000
#: the SA3 B85 scraping routine is quadratic in the span it is given; the engine passes this as its own guard (the centreline cap plus a margin)
MAX_PROFILE_SPAN_M = MAX_CENTRELINE_M + 10.0

TOO_LARGE, OUTSIDE_TERRAIN = "ENGINE_INPUT_TOO_LARGE", "GEOMETRY_OUTSIDE_TERRAIN"


class EngineLimitError(Exception):
    """A request is larger than an engine accepts. The API answers 422 with ``code`` and ``message``."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code, self.message = code, message


def _positions(geometry: Any) -> Sequence[Sequence[float]]:
    return geometry.pts if geometry.kind == "polyline" else geometry.ring if geometry.kind == "polygon" else [geometry.p]


def polyline_length(pts: Sequence[Sequence[float]]) -> float:
    return float(sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:])))


def check_driveway(obj: Any) -> None:
    """Vertex count and centreline length of a driveway object (needs no terrain, so it runs before the bundle is read)."""
    pts = obj.geometry.pts
    if len(pts) > MAX_DRIVEWAY_VERTICES:
        raise EngineLimitError(TOO_LARGE, f"THE DRIVEWAY HAS {len(pts)} VERTICES; AT MOST {MAX_DRIVEWAY_VERTICES} ARE ACCEPTED")
    length = polyline_length(pts)
    if not length <= MAX_CENTRELINE_M:
        raise EngineLimitError(TOO_LARGE, f"THE DRIVEWAY CENTRELINE IS {length:,.0f} M LONG; AT MOST {MAX_CENTRELINE_M:g} M IS ACCEPTED")


def shoelace_area(ring: Sequence[Sequence[float]]) -> float:
    n = len(ring)
    return abs(sum(ring[i][0] * ring[(i + 1) % n][1] - ring[(i + 1) % n][0] * ring[i][1] for i in range(n))) / 2.0


def check_grading(obj: Any) -> None:
    """Vertex count and enclosed area of a grading area object."""
    ring = obj.geometry.ring
    if len(ring) > MAX_GRADING_VERTICES:
        raise EngineLimitError(TOO_LARGE, f"THE GRADING AREA HAS {len(ring)} VERTICES; AT MOST {MAX_GRADING_VERTICES} ARE ACCEPTED")
    x0 = min(p[0] for p in ring)                               # local coordinates: the shoelace sum on MGA magnitudes (millions of metres) loses digits
    y0 = min(p[1] for p in ring)
    area = shoelace_area([(p[0] - x0, p[1] - y0) for p in ring])
    if not area <= MAX_GRADING_AREA_M2:
        raise EngineLimitError(TOO_LARGE, f"THE GRADING AREA ENCLOSES {area:,.0f} M2; AT MOST {MAX_GRADING_AREA_M2:,.0f} M2 IS ACCEPTED")


def check_within_terrain(geometry: Any, terrain: Any, what: str) -> None:
    """Every position must lie inside the terrain bounds (bounding box of the existing ground triangles) plus ``BOUNDS_MARGIN_M``."""
    b = terrain.surface.bounds
    if b is None:
        raise EngineLimitError(OUTSIDE_TERRAIN, f"{what}: THE TERRAIN HAS NO BOUNDS")
    x0, y0, x1, y1 = b[0] - BOUNDS_MARGIN_M, b[1] - BOUNDS_MARGIN_M, b[2] + BOUNDS_MARGIN_M, b[3] + BOUNDS_MARGIN_M
    for p in _positions(geometry):
        if not (x0 <= p[0] <= x1 and y0 <= p[1] <= y1):
            raise EngineLimitError(OUTSIDE_TERRAIN, f"{what} IS OUTSIDE THE TERRAIN OF THE 3D MODEL BY MORE THAN {BOUNDS_MARGIN_M:g} M")


def check_grid(region: Any, grid_m: float) -> None:
    """The cut and fill grid of ``region`` (the SA3 integration grids the bounding box of the region plus 1 m) must not exceed ``MAX_GRID_CELLS``."""
    x0, y0, x1, y1 = region.bounds
    cells = ((x1 - x0 + 2.0) / grid_m) * ((y1 - y0 + 2.0) / grid_m)
    if not cells <= MAX_GRID_CELLS:
        raise EngineLimitError(TOO_LARGE, f"THE CUT AND FILL AREA (PLATFORM PLUS BATTERS) IS TOO LARGE TO COMPUTE: {cells:,.0f} GRID CELLS, AT MOST {MAX_GRID_CELLS:,} ARE ACCEPTED")
