"""Building importers for the site design (stage 5).

A building is never designed in JCESITE: it is imported from the owner's design tool (Plan Studio), from an architectural PDF
(SA7) or a plan DXF (SA8), or entered as a footprint. Every importer returns one ``building_import.v1`` payload in LOCAL plan
coordinates (metres, x east, y north, origin arbitrary but stated) for the frontend to place on the terrain with the
``place_building`` operation. Nothing is invented: a height, a finished floor level, a roof pitch or a roof area that the source
does not give is left out (NOT SET) and the payload says so.

Plan Studio (``.planstudio.json``)
  * The file is checked the way Plan Studio's own ``migrate`` and ``validate`` check it (schema version, structure).
  * When the file carries a ``site_export`` block (written by Plan Studio from stage 5) its footprints, roof outline and area, downpipes
    and exit points are used. Otherwise they are DERIVED here by porting Plan Studio's raster logic (``viewer3d/footprint.js``
    ``rasteriseLevel`` and ``ui/schedules.js`` ``roofPlanAreaM2``) to numpy and vectorising the raster.
  * Vectorisation: the filled raster cells (100 mm) are merged into row runs, unioned (shapely) into polygons and simplified with
    the Douglas-Peucker tolerance ``SIMPLIFY_TOL_M`` (0.05 m, half a raster cell, so a one cell feature survives; the area change is at
    most the perimeter times the tolerance). Only outer rings are kept; courtyards are not representable and are reported.
  * Handedness: Plan Studio plan y points DOWN the screen and its rotations are clockwise on screen, and its north arrow is rotated
    clockwise by ``site.northDeg``. A plan point (px, py) in mm becomes (E, N) = ((px cos n + py sin n), (px sin n - py cos n)) / 1000,
    a proper rotation composed with a flip (determinant -1). Rings are re-oriented counter clockwise after the flip.
  * The roof plan area is Plan Studio's own approximate raster value (rooms under the roof, dilated by the eave overhang on a 100 mm
    grid), labelled APPROXIMATE (PLAN STUDIO RASTER). The eave overhang is used only when the source gives one.
  * Site tanks in the design file become ``rwt`` objects with their capacity. No level (inlet, overflow, outlet) is invented.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from scipy import ndimage
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry.polygon import orient

from app.design.site_design import (BUILDING_USES, MAX_VERTICES, Building, BuildingExits, BuildingLevel, Param)

PAYLOAD_SCHEMA = "building_import.v1"
SUPPORTED_PS_SCHEMAS = (1, 2)            # Plan Studio project schema versions this importer reads (it migrates version 1 on the fly)
SITE_EXPORT_SCHEMA = "planstudio.site_export.v1"

CELL_MM = 100                             # Plan Studio raster cell (footprint.js CELL, schedules.js CELL)
FOOTPRINT_MARGIN_MM = 1500                # footprint.js makeGrid margin
ROOF_MARGIN_CELLS = 12                    # schedules.js rasterise margin (the roof dilation is clipped to it, as in Plan Studio)
MAX_GRID_CELLS = 4_000_000                # Plan Studio gives up above this size; so does the importer (a sanity limit)
SIMPLIFY_TOL_M = 0.05                     # Douglas-Peucker tolerance of the vectorised outlines, metres (half a raster cell)
MAX_LEVELS = 16
MAX_ELEMENTS = 20_000                     # walls plus rooms per level (sanity limit)
MAX_RINGS = 64
MAX_SEWER_EXITS = 64                      # the site design model limits (BuildingExits); an import above them is refused, never cut
MAX_WATER_EXITS = 64
MAX_DOWNPIPES = 256
MAX_TANKS = 64                            # rainwater tanks that come with one building
# CPU budget for the Plan Studio importer (sanity limits that protect the server, not engineering values)
MAX_ROOM_VERTICES = 2000                  # vertices in one room outline
MAX_FILE_VERTICES = 100_000               # all outline, wall, stair and site_export vertices in one file
MAX_WORK_UNITS = 300_000_000              # estimated raster work: grid cells per level plus (room bounding box cells x vertices) plus wall cost
MAX_OVERHANG_MM = 5000                    # Plan Studio limits the eave overhang to 1500 mm; a larger value in a file is refused
MAX_RUNS_PER_LEVEL = 20_000               # row runs of one raster mask handed to the polygon union
WALL_CLOCK_S = 10.0                       # wall clock budget for rasterise and derive
WALL_UNIT_COST = 20_000                   # python overhead of one wall, in work units

BASIS_RASTER = "APPROXIMATE (PLAN STUDIO RASTER)"
BASIS_SOURCE = "SOURCE VALUE"
BASIS_NOT_SET = "NOT SET"
BASIS_PS_ESTIMATE = "PLAN STUDIO ESTIMATE"


class ImportFailure(Exception):
    """The file cannot be imported. ``status`` is the HTTP status the API route answers with (422 for a bad file)."""

    def __init__(self, code: str, message: str, status: int = 422) -> None:
        super().__init__(f"{code}: {message}")
        self.code, self.message, self.status = code, message, status


def too_complex(why: str) -> ImportFailure:
    return ImportFailure("IMPORT_TOO_COMPLEX", f"IMPORT TOO COMPLEX: {why}. Simplify the plan, or enter the footprint instead.")


class Budget:
    """Wall clock budget for rasterise and derive. ``check`` raises IMPORT TOO COMPLEX (422) once it is spent."""

    def __init__(self, seconds: float | None = None) -> None:
        self.limit = WALL_CLOCK_S if seconds is None else seconds
        self.t0 = time.monotonic()

    def check(self) -> None:
        if time.monotonic() - self.t0 > self.limit:
            raise too_complex(f"it took longer than {self.limit:g} s to read")


def _build(cls, **kw):
    """Construct a payload model; a ValidationError (a limit of the site design model) is a 422 with a plain message, never a 500."""
    try:
        return cls(**kw)
    except ValidationError as e:
        first = e.errors(include_url=False)[0]
        where = ".".join(str(x) for x in first.get("loc", ()))
        raise ImportFailure("IMPORT_EXCEEDS_LIMITS", f"the import is larger than the site design allows ({where}: {first['msg']})") from None


# ---------------------------------------------------------------------------------------------------------------------------------
# payload model
# ---------------------------------------------------------------------------------------------------------------------------------
class _M(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ImportedBuilding(_M):
    levels: list[BuildingLevel] = Field(min_length=1, max_length=MAX_LEVELS)
    datum_index: int = Field(default=0, ge=0)
    roof_outline: list[list[list[float]]] | None = None
    exits: BuildingExits = Field(default_factory=BuildingExits)
    north_deg: float | None = None
    notes: list[str] = Field(default_factory=list)
    params: dict[str, Param] = Field(default_factory=dict)


class ImportedExtra(_M):
    """A site object that came with the building (a Plan Studio tank becomes an rwt)."""
    type: Literal["rwt"]
    p: list[float]
    yaw_deg: float = 0.0
    status: Literal["existing", "proposed"] = "proposed"
    label: str | None = None
    params: dict[str, Param] = Field(default_factory=dict)


class ImportAlignment(_M):
    """SA7 alignment result (PDF imports only)."""
    outcome: str
    rmse_m: float
    max_residual_m: float
    scale_denominator: float
    scale_source: str
    reflection_applied: bool


class BuildingImportPayload(_M):
    schema_: Literal["building_import.v1"] = Field(default=PAYLOAD_SCHEMA, alias="schema")
    source: Literal["plan_studio", "pdf", "dxf", "footprint_entry"]
    source_file: str
    used_site_export: bool = False
    building: ImportedBuilding
    ref: list[float]                                  # local reference point that the frontend puts under the cursor
    aligned_at: list[float] | None = None             # MGA position of ``ref`` when the source was aligned to the lot (PDF)
    import_id: str | None = Field(default=None, pattern=r"^[0-9a-f]{32}$")     # set by the import route, which stores the payload under it
    extras: list[ImportedExtra] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    requires_confirmation: bool = False
    alignment: ImportAlignment | None = None
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    def dump(self) -> dict:
        return self.model_dump(mode="json", by_alias=True, exclude_none=True)


# ---------------------------------------------------------------------------------------------------------------------------------
# shared helpers
# ---------------------------------------------------------------------------------------------------------------------------------
def _imp(source_file: str, what: str) -> dict[str, Any]:
    return {"basis": "user", "ref": f"IMPORTED FROM {what}: {source_file}"[:200]}


def _param(value: Any, source_file: str, what: str) -> Param:
    return Param(value=value, **_imp(source_file, what))


def _largest_first(polys: list[Polygon]) -> list[Polygon]:
    return sorted(polys, key=lambda p: -p.area)


def _ring_pts(poly: Polygon) -> list[list[float]]:
    """Open counter clockwise exterior ring."""
    r = list(orient(poly, 1.0).exterior.coords)[:-1]
    return [[float(x), float(y)] for x, y in r]


def _polys_of(g: Any) -> list[Polygon]:
    if g is None or g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, MultiPolygon):
        return list(g.geoms)
    return [p for x in getattr(g, "geoms", []) for p in _polys_of(x)]


def safe_name(name: str | None, default: str) -> str:
    base = os.path.basename((name or default).replace("\\", "/"))
    out = "".join(c if c.isalnum() or c in "._ -()" else "_" for c in base)[:200].strip(" .")
    return out or default


def check_use(use: str | None) -> str | None:
    if use is None or use == "":
        return None
    if use not in BUILDING_USES:
        raise ImportFailure("BAD_BUILDING_USE", f"building use must be one of: {', '.join(BUILDING_USES)}")
    return use


def _finish(payload: dict) -> BuildingImportPayload:
    try:
        return BuildingImportPayload.model_validate(payload)
    except ValidationError as e:  # pragma: no cover - a defect in an importer, not in the file
        raise ImportFailure("IMPORT_INCONSISTENT", f"the import produced an invalid payload: {e.errors(include_url=False)[0]['msg']}") from None


def _level_from_polys(name: str, elevation_m: float | None, polys: list[Polygon]) -> tuple[BuildingLevel, int]:
    """Level with up to MAX_RINGS rings (largest first); returns it with the number of rings that did not fit."""
    ps = _largest_first(polys)
    kept, dropped = ps[:MAX_RINGS], max(0, len(ps) - MAX_RINGS)
    return _build(BuildingLevel, name=name, elevation_m=elevation_m, rings=[_ring_pts(p) for p in kept]), dropped


# ---------------------------------------------------------------------------------------------------------------------------------
# Plan Studio: raster port (footprint.js and schedules.js) and vectorisation
# ---------------------------------------------------------------------------------------------------------------------------------
@dataclass
class Grid:
    x0: float
    y0: float
    nx: int
    ny: int
    cell: float = CELL_MM


def _fin(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _pt(p: Any) -> tuple[float, float]:
    return float(p["x"]), float(p["y"])


def _pip(px: np.ndarray, py: np.ndarray, poly: list[tuple[float, float]]) -> np.ndarray:
    """Plan Studio ``pointInPolygon`` (even-odd, same edge rule), vectorised over points."""
    inside = np.zeros(px.shape, dtype=bool)
    n = len(poly)
    j = n - 1
    for i in range(n):
        ax, ay = poly[i]
        bx, by = poly[j]
        j = i
        cond = (ay > py) != (by > py)
        if not cond.any():
            continue
        with np.errstate(divide="ignore", invalid="ignore"):
            xint = (bx - ax) * (py - ay) / (by - ay) + ax
        inside ^= cond & (px < xint)
    return inside


def make_grid(project: dict) -> Grid:
    """footprint.js ``makeGrid``: one grid over every level, margin 1500 mm."""
    xs: list[float] = []
    ys: list[float] = []
    for lv in project["levels"]:
        for w in lv["walls"]:
            for k in ("a", "b"):
                xs.append(float(w[k]["x"])); ys.append(float(w[k]["y"]))
        for r in lv["rooms"]:
            for p in r["polygon"]:
                xs.append(float(p["x"])); ys.append(float(p["y"]))
        for s in lv["stairs"]:
            xs.append(float(s["x"])); ys.append(float(s["y"]))
    if xs:
        minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    else:
        minx, miny, maxx, maxy = 0.0, 0.0, 1000.0, 1000.0
    m, c = FOOTPRINT_MARGIN_MM, CELL_MM
    x0 = math.floor((minx - m) / c) * c
    y0 = math.floor((miny - m) / c) * c
    nx = math.ceil((maxx + m - x0) / c) + 1
    ny = math.ceil((maxy + m - y0) / c) + 1
    if nx * ny > MAX_GRID_CELLS:
        raise ImportFailure("PLAN_TOO_LARGE", "the plan extent is too large to rasterise at 100 mm")
    return Grid(x0, y0, nx, ny)


def _raster_polygon(g: Grid, mask: np.ndarray, poly: list[tuple[float, float]]) -> None:
    xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
    i0 = max(0, math.floor((min(xs) - g.x0) / g.cell)); i1 = min(g.nx - 1, math.floor((max(xs) - g.x0) / g.cell))
    j0 = max(0, math.floor((min(ys) - g.y0) / g.cell)); j1 = min(g.ny - 1, math.floor((max(ys) - g.y0) / g.cell))
    if i1 < i0 or j1 < j0:
        return
    ii, jj = np.meshgrid(np.arange(i0, i1 + 1), np.arange(j0, j1 + 1))
    cx = g.x0 + (ii + 0.5) * g.cell + 0.013          # the same tiny offset as Plan Studio, so edges through cell centres resolve the same way
    cy = g.y0 + (jj + 0.5) * g.cell + 0.021
    ins = _pip(cx, cy, poly)
    mask[jj[ins], ii[ins]] = True


def _wall_quad(w: dict, ext: float = 0.0, grow: float = 0.0) -> np.ndarray:
    ax, ay = _pt(w["a"]); bx, by = _pt(w["b"])
    L = math.hypot(bx - ax, by - ay) or 1.0
    dx, dy = (bx - ax) / L, (by - ay) / L
    nx_, ny_ = -dy, dx
    t = (w.get("thickness") or 100) / 2 + grow
    a = (ax - dx * ext, ay - dy * ext); b = (bx + dx * ext, by + dy * ext)
    return np.array([(a[0] + nx_ * t, a[1] + ny_ * t), (b[0] + nx_ * t, b[1] + ny_ * t), (b[0] - nx_ * t, b[1] - ny_ * t), (a[0] - nx_ * t, a[1] - ny_ * t)])


def _quad_overlaps_cells(q: np.ndarray, x0: np.ndarray, y0: np.ndarray, x1: np.ndarray, y1: np.ndarray) -> np.ndarray:
    """Plan Studio ``quadOverlapsCell`` (separating axes, touching counts as overlap), vectorised over cells."""
    ok = np.ones(x0.shape, dtype=bool)
    for axis, cl, ch in (((1.0, 0.0), x0, x1), ((0.0, 1.0), y0, y1)):
        s = q[:, 0] * axis[0] + q[:, 1] * axis[1]
        ok &= ~((s.max() < cl) | (s.min() > ch))
    for i in range(2):
        a, b = q[i], q[i + 1]
        axx, axy = -(b[1] - a[1]), b[0] - a[0]
        s = q[:, 0] * axx + q[:, 1] * axy
        corners = [x0 * axx + y0 * axy, x1 * axx + y0 * axy, x1 * axx + y1 * axy, x0 * axx + y1 * axy]
        clo = np.minimum.reduce(corners); chi = np.maximum.reduce(corners)
        ok &= ~((s.max() < clo) | (s.min() > chi))
    return ok


def _in_convex(px: np.ndarray, py: np.ndarray, q: np.ndarray) -> np.ndarray:
    pos = np.zeros(px.shape, dtype=bool); neg = np.zeros(px.shape, dtype=bool)
    for i in range(4):
        a, b = q[i], q[(i + 1) % 4]
        c = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0])
        pos |= c > 1e-6; neg |= c < -1e-6
    return ~(pos & neg)


def rasterise_level(g: Grid, level: dict, budget: Budget | None = None) -> np.ndarray:
    """footprint.js ``rasteriseLevel``: rooms, walls and the area enclosed by walls (flood fill from outside). Returns the footprint mask
    [ny, nx]. Elements marked ``demolish`` are left out: the site model shows the proposed state."""
    rooms = np.zeros((g.ny, g.nx), dtype=bool)
    walls = np.zeros_like(rooms); blocked = np.zeros_like(rooms)
    budget = budget or Budget()
    for r in level["rooms"]:
        budget.check()
        if r.get("status") == "demolish":
            continue
        if r.get("outdoor") and not r.get("roofed"):
            continue
        _raster_polygon(g, rooms, [_pt(p) for p in r["polygon"]])
    for w in level["walls"]:
        budget.check()
        if w.get("status") == "demolish":
            continue
        ax, ay = _pt(w["a"]); bx, by = _pt(w["b"])
        if math.hypot(bx - ax, by - ay) < 10:
            continue
        half = (w.get("thickness") or 100) / 2
        q = _wall_quad(w, half); qc = _wall_quad(w, half, 4)
        i0 = max(0, math.floor((q[:, 0].min() - 5 - g.x0) / g.cell)); i1 = min(g.nx - 1, math.floor((q[:, 0].max() + 5 - g.x0) / g.cell))
        j0 = max(0, math.floor((q[:, 1].min() - 5 - g.y0) / g.cell)); j1 = min(g.ny - 1, math.floor((q[:, 1].max() + 5 - g.y0) / g.cell))
        if i1 < i0 or j1 < j0:
            continue
        ii, jj = np.meshgrid(np.arange(i0, i1 + 1), np.arange(j0, j1 + 1))
        cx = g.x0 + ii * g.cell; cy = g.y0 + jj * g.cell
        hit = _quad_overlaps_cells(qc, cx, cy, cx + g.cell, cy + g.cell)
        blocked[jj[hit], ii[hit]] = True
        inq = _in_convex(cx + g.cell / 2, cy + g.cell / 2, q)
        walls[jj[inq], ii[inq]] = True
    lab, _n = ndimage.label(~blocked)                     # 4 connected, as the flood fill in Plan Studio
    border = np.unique(np.concatenate([lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]]))
    border = border[border > 0]
    outside = np.isin(lab, border)
    enclosed = ~blocked & ~outside
    return rooms | walls | enclosed


def mask_to_polygons(mask: np.ndarray, x0: float, y0: float, cell: float, tol: float, budget: Budget | None = None) -> tuple[list[Polygon], int]:
    """Vectorise a raster mask: merge row runs into boxes, union them, keep the OUTER rings, simplify with ``tol`` (same units as x0, y0).
    Returns (polygons, number of holes dropped). A mask with more than MAX_RUNS_PER_LEVEL row runs is refused (IMPORT TOO COMPLEX)."""
    from shapely import box, union_all
    budget = budget or Budget()
    padded = np.zeros((mask.shape[0], mask.shape[1] + 2), dtype=np.int8)
    padded[:, 1:-1] = mask
    d = np.diff(padded, axis=1)
    rj, rs = np.nonzero(d == 1)                       # row-major order: the starts and the ends pair up run by run
    _, re = np.nonzero(d == -1)
    if len(rj) == 0:
        return [], 0
    if len(rj) > MAX_RUNS_PER_LEVEL:
        raise too_complex(f"a level outline has {len(rj)} separate row runs, the limit is {MAX_RUNS_PER_LEVEL}")
    boxes = box(x0 + rs * cell, y0 + rj * cell, x0 + re * cell, y0 + (rj + 1) * cell)
    budget.check()
    holes = 0
    out: list[Polygon] = []
    for p in _polys_of(union_all(boxes)):
        budget.check()
        holes += len(p.interiors)
        s = Polygon(p.exterior).simplify(tol, preserve_topology=True)
        for q in _polys_of(s):
            if q.area > 0:
                out.append(q)
    return out, holes


def work_estimate(project: dict, grid: Grid | None) -> int:
    """Estimated raster work for the derive path, in units of about one cell operation: per level the grid cells (flood fill and masks), per
    room its bounding box cells times its vertices, per wall a fixed python cost plus its bounding box cells. Used to refuse a file BEFORE
    rasterising it (the wall clock budget is the second line of defence)."""
    c = CELL_MM
    total = 0
    for lv in project["levels"]:
        if grid is not None:
            total += 8 * grid.nx * grid.ny
        for r in lv["rooms"]:
            if r.get("status") == "demolish":
                continue
            xs = [float(q["x"]) for q in r["polygon"]]; ys = [float(q["y"]) for q in r["polygon"]]
            nx = int((max(xs) - min(xs)) / c) + 2; ny = int((max(ys) - min(ys)) / c) + 2
            if grid is not None:
                nx, ny = min(nx, grid.nx), min(ny, grid.ny)
            total += nx * ny * len(xs) + 2000
        for w in lv["walls"]:
            if w.get("status") == "demolish":
                continue
            ax, ay = _pt(w["a"]); bx, by = _pt(w["b"])
            t = float(w.get("thickness") or 100)
            nx = int((abs(bx - ax) + t) / c) + 2; ny = int((abs(by - ay) + t) / c) + 2
            if grid is not None:
                nx, ny = min(nx, grid.nx), min(ny, grid.ny)
            total += WALL_UNIT_COST + 24 * nx * ny
    return total


def derive_footprints(project: dict, budget: Budget | None = None) -> list[tuple[dict, list[Polygon], int]]:
    """Per level (in the order of ``project['levels']``): (level, outer footprint polygons in plan mm, holes dropped)."""
    budget = budget or Budget()
    g = make_grid(project)
    est = work_estimate(project, g)
    if est > MAX_WORK_UNITS:
        raise too_complex(f"the plan needs about {est:,} raster steps, the limit is {MAX_WORK_UNITS:,}")
    res = []
    for lv in project["levels"]:
        budget.check()
        polys, holes = mask_to_polygons(rasterise_level(g, lv, budget), g.x0, g.y0, g.cell, SIMPLIFY_TOL_M * 1000, budget)
        res.append((lv, polys, holes))
    return res


def derive_roof(project: dict, use_overhang_from: list[dict], budget: Budget | None = None) -> tuple[list[Polygon], float | None, int, list[str]]:
    """schedules.js ``roofPlanAreaM2`` ported: per level with the roof enabled, the rooms under the roof (not demolished; outdoor rooms only
    when roofed) rasterised on a 100 mm grid, dilated by the eave overhang (square element, clipped to the 12 cell margin like Plan Studio),
    unioned over the levels. ``use_overhang_from`` is the RAW levels list: the overhang is used only when the source gives one.
    Returns (outline polygons in plan mm, plan area m2 or None when nothing is roofed, holes dropped, notes)."""
    cells_x: list[np.ndarray] = []
    cells_y: list[np.ndarray] = []
    notes: list[str] = []
    budget = budget or Budget()
    work = 0
    for lv, raw in zip(project["levels"], use_overhang_from):
        budget.check()
        roof = raw.get("roof") if isinstance(raw.get("roof"), dict) else {}
        if roof.get("enabled") is False:
            continue
        polys = [[_pt(p) for p in r["polygon"]] for r in lv["rooms"] if r.get("status") != "demolish" and (not r.get("outdoor") or r.get("roofed"))]
        if not polys:
            continue
        allp = [p for poly in polys for p in poly]
        minx, maxx = min(p[0] for p in allp), max(p[0] for p in allp)
        miny, maxy = min(p[1] for p in allp), max(p[1] for p in allp)
        gx0 = math.floor(minx / CELL_MM) - ROOF_MARGIN_CELLS
        gy0 = math.floor(miny / CELL_MM) - ROOF_MARGIN_CELLS
        nx = math.ceil((maxx - minx) / CELL_MM) + 2 * ROOF_MARGIN_CELLS + 1
        ny = math.ceil((maxy - miny) / CELL_MM) + 2 * ROOF_MARGIN_CELLS + 1
        if nx * ny > MAX_GRID_CELLS:
            continue                                              # Plan Studio skips a level whose raster is too large
        ov = roof.get("overhang")
        r = 0
        if _fin(ov) and ov > 0:
            if ov > MAX_OVERHANG_MM:
                raise ImportFailure("PS_INVALID", f"the roof overhang of level {str(lv.get('name', '?'))[:40]} is above {MAX_OVERHANG_MM} mm")
            r = int(math.floor(ov / CELL_MM + 0.5))      # JS Math.round (halves go up), not banker's rounding
        work += nx * ny * (2 * r + 1) ** 2 // 8 + 8 * nx * ny + sum((int((max(p[0] for p in poly) - min(p[0] for p in poly)) / CELL_MM) + 2) * (int((max(p[1] for p in poly) - min(p[1] for p in poly)) / CELL_MM) + 2) * len(poly) + 2000 for poly in polys)
        if work > MAX_WORK_UNITS:
            raise too_complex(f"the roof needs about {work:,} raster steps, the limit is {MAX_WORK_UNITS:,}")
        data = np.zeros((ny, nx), dtype=bool)
        for poly in polys:
            budget.check()
            xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
            ix0 = max(0, math.floor(min(xs) / CELL_MM) - gx0); ix1 = min(nx - 1, math.ceil(max(xs) / CELL_MM) - gx0)
            iy0 = max(0, math.floor(min(ys) / CELL_MM) - gy0); iy1 = min(ny - 1, math.ceil(max(ys) / CELL_MM) - gy0)
            if ix1 < ix0 or iy1 < iy0:
                continue
            ii, jj = np.meshgrid(np.arange(ix0, ix1 + 1), np.arange(iy0, iy1 + 1))
            ins = _pip((gx0 + ii + 0.5) * CELL_MM, (gy0 + jj + 0.5) * CELL_MM, poly)
            data[jj[ins], ii[ins]] = True
        if _fin(ov) and ov > 0:
            data = ndimage.binary_dilation(data, structure=np.ones((2 * r + 1, 2 * r + 1), dtype=bool)) if r > 0 else data
        elif not _fin(ov):
            notes.append(f"ROOF OVERHANG NOT IN SOURCE for level {lv.get('name', '?')}: its roof outline is the roofed rooms without eaves")
        jj, ii = np.nonzero(data)
        cells_x.append((gx0 + ii).astype(np.int64)); cells_y.append((gy0 + jj).astype(np.int64))
    if not cells_x:
        return [], None, 0, notes
    allx, ally = np.concatenate(cells_x), np.concatenate(cells_y)
    minx, miny = int(allx.min()), int(ally.min())
    width = int(allx.max()) - minx + 1
    keys = np.unique((ally - miny) * width + (allx - minx))                    # union over the levels, in absolute cell indices
    mask = np.zeros((int(ally.max()) - miny + 1, width), dtype=bool)
    mask[keys // width, keys % width] = True
    area = len(keys) * (CELL_MM * CELL_MM) / 1e6
    polys, holes = mask_to_polygons(mask, float(minx * CELL_MM), float(miny * CELL_MM), CELL_MM, SIMPLIFY_TOL_M * 1000, budget)
    return polys, area, holes, notes


def to_local(x_mm: float, y_mm: float, north_deg: float) -> tuple[float, float]:
    """Plan Studio plan point (mm, x right, y DOWN, north arrow rotated clockwise by ``north_deg``) -> local (E, N) metres.
    E = (x cos n + y sin n), N = (x sin n - y cos n): a rotation composed with a flip (determinant -1)."""
    n = math.radians(north_deg)
    c, s = math.cos(n), math.sin(n)
    return (x_mm * c + y_mm * s) / 1000.0, (x_mm * s - y_mm * c) / 1000.0


def _local_polys(rings_mm: list[list[tuple[float, float]]], north: float) -> list[Polygon]:
    out = []
    for r in rings_mm:
        p = Polygon([to_local(x, y, north) for x, y in r])
        if not p.is_valid:
            p = p.buffer(0)
        out.extend(q for q in _polys_of(p) if q.area > 0)
    return out


# ---------------------------------------------------------------------------------------------------------------------------------
# Plan Studio: file check (migrate and validate) and site_export
# ---------------------------------------------------------------------------------------------------------------------------------
_LIST_KEYS = ("walls", "openings", "rooms", "furniture", "stairs")


def check_planstudio(raw: Any) -> dict:
    """Port of Plan Studio's ``migrate`` + ``validate`` for the parts the importer reads. Returns a normalised COPY (missing lists backfilled);
    raises ImportFailure with a message fit for the person."""
    if not isinstance(raw, dict):
        raise ImportFailure("NOT_PLAN_STUDIO", "Not a Plan Studio project file")
    schema = raw.get("schema")
    if not _fin(schema) or schema != int(schema) or schema < 1:
        raise ImportFailure("NOT_PLAN_STUDIO", "Not a Plan Studio project file (no schema version)")
    if schema > max(SUPPORTED_PS_SCHEMAS):
        raise ImportFailure("PS_NEWER", "This project was saved by a newer version of Plan Studio")
    p = json.loads(json.dumps(raw))
    levels = p.get("levels")
    if not isinstance(levels, list) or not levels:
        raise ImportFailure("PS_INVALID", "project has no levels")
    if len(levels) > MAX_LEVELS:
        raise ImportFailure("PS_INVALID", f"project has more than {MAX_LEVELS} levels")
    site = p.get("site") if isinstance(p.get("site"), dict) else {}
    p["site"] = {"northDeg": 0, "tanks": [], "points": [], **site}
    if not isinstance(p["site"]["tanks"], list):
        p["site"]["tanks"] = []
    if not isinstance(p["site"]["points"], list):
        p["site"]["points"] = []
    north = p["site"].get("northDeg")
    if not _fin(north):
        raise ImportFailure("PS_INVALID", "site.northDeg is not a number")
    ids: set[str] = set()
    vertices = 0

    def seen(i: Any, what: str) -> None:
        if not i or not isinstance(i, str):
            raise ImportFailure("PS_INVALID", f"{what} without id")
        if i in ids:
            raise ImportFailure("PS_INVALID", f"duplicate id {i}")
        ids.add(i)

    def finite_pt(q: Any) -> bool:
        return isinstance(q, dict) and _fin(q.get("x")) and _fin(q.get("y"))

    for lv in levels:
        if not isinstance(lv, dict):
            raise ImportFailure("PS_INVALID", "a level is not an object")
        seen(lv.get("id"), "level")
        if not isinstance(lv.get("name"), str):
            lv["name"] = "Level"
        if not _fin(lv.get("elevation", 0)):
            raise ImportFailure("PS_INVALID", f"level {lv.get('id')} has an invalid elevation")
        lv.setdefault("elevation", 0)
        for k in _LIST_KEYS:
            if not isinstance(lv.get(k), list):
                lv[k] = []
        if len(lv["walls"]) + len(lv["rooms"]) > MAX_ELEMENTS:
            raise ImportFailure("PS_INVALID", "a level has too many walls and rooms")
        for lst, what in ((lv["walls"], "wall"), (lv["rooms"], "room"), (lv["stairs"], "stair")):
            if not all(isinstance(e, dict) for e in lst):
                raise ImportFailure("PS_INVALID", f"a {what} is not an object")
        for w in lv["walls"]:
            seen(w.get("id"), "wall")
            if not (finite_pt(w.get("a")) and finite_pt(w.get("b")) and _fin(w.get("thickness"))):
                raise ImportFailure("PS_INVALID", f"wall {w.get('id')} has invalid geometry")
        vertices += 2 * len(lv["walls"]) + len(lv["stairs"])
        for r in lv["rooms"]:
            seen(r.get("id"), "room")
            if not isinstance(r.get("polygon"), list) or len(r["polygon"]) < 3 or not all(finite_pt(q) for q in r["polygon"]):
                raise ImportFailure("PS_INVALID", f"room {r.get('id')} has an invalid outline")
            if len(r["polygon"]) > MAX_ROOM_VERTICES:
                raise too_complex(f"room {str(r.get('id'))[:40]} has {len(r['polygon'])} vertices, the limit is {MAX_ROOM_VERTICES}")
            vertices += len(r["polygon"])
        if vertices > MAX_FILE_VERTICES:
            raise too_complex(f"the file has more than {MAX_FILE_VERTICES:,} outline vertices")
        for st in lv["stairs"]:
            seen(st.get("id"), "stair")
            if not finite_pt(st):
                raise ImportFailure("PS_INVALID", "a stair has an invalid position")
    for lst, what in ((p["site"]["tanks"], "tank"), (p["site"]["points"], "site point")):
        if not all(isinstance(e, dict) for e in lst):
            raise ImportFailure("PS_INVALID", f"a {what} is not an object")
    for t in p["site"]["tanks"]:
        seen(t.get("id"), "tank")
    for q in p["site"]["points"]:
        seen(q.get("id"), "site point")
        if not finite_pt(q):
            raise ImportFailure("PS_INVALID", f"site point {q.get('id')} has an invalid position")
    return p


def _read_site_export(p: dict, warnings: list[str]) -> dict | None:
    """The ``site_export`` block when it is present and consistent with the project; otherwise None (the importer then derives everything)."""
    se = p.get("site_export")
    if se is None:
        return None

    def bad(why: str) -> None:
        warnings.append(f"SITE_EXPORT IGNORED ({why}): the footprint and roof were derived from the plan instead")
    if not isinstance(se, dict) or se.get("schema") != SITE_EXPORT_SCHEMA:
        bad("unknown schema")
        return None
    lv = se.get("levels")
    ids = [lv_["id"] for lv_ in p["levels"]]
    if not isinstance(lv, list) or [x.get("id") if isinstance(x, dict) else None for x in lv] != ids:
        bad("its levels do not match the project's levels")
        return None

    def rings_ok(rs: Any) -> bool:
        return isinstance(rs, list) and len(rs) <= MAX_RINGS and all(isinstance(r, list) and 3 <= len(r) <= MAX_VERTICES and all(isinstance(q, list) and len(q) == 2 and _fin(q[0]) and _fin(q[1]) for q in r) for r in rs)
    total = 0
    for x in lv:
        total += sum(len(r) for r in x.get("footprint", []) if isinstance(r, list)) if isinstance(x.get("footprint"), list) else 0
    ro = se.get("roof")
    if isinstance(ro, dict) and isinstance(ro.get("outline"), list):
        total += sum(len(r) for r in ro["outline"] if isinstance(r, list))
    if total > MAX_FILE_VERTICES:
        raise too_complex(f"the site_export block has more than {MAX_FILE_VERTICES:,} footprint vertices")
    for x, lv_ in zip(lv, p["levels"]):
        if not rings_ok(x.get("footprint")) or not _fin(x.get("ffl_above_ground_floor_mm")):
            bad("a level footprint is malformed")
            return None
        if abs(float(x["ffl_above_ground_floor_mm"]) - float(lv_["elevation"])) > 1e-6:
            bad("a level elevation differs from the project's")
            return None
    roof = se.get("roof")
    if roof is not None and (not isinstance(roof, dict) or (roof.get("outline") is not None and not rings_ok(roof.get("outline"))) or (roof.get("plan_area_m2") is not None and not _fin(roof.get("plan_area_m2")))):
        bad("the roof block is malformed")
        return None
    for k in ("downpipes", "sewer_exits", "water_exits"):
        v = se.get(k, [])
        if not isinstance(v, list) or len(v) > 256 or not all(isinstance(q, dict) and _fin(q.get("x")) and _fin(q.get("y")) for q in v):
            bad(f"{k} is malformed")
            return None
    if not _fin(se.get("north_deg")) or abs(se["north_deg"] - p["site"]["northDeg"]) > 1e-9:
        bad("its north angle differs from the project's")
        return None
    return se


def _exits_mm(p: dict, se: dict | None) -> tuple[list[tuple[float, float]], list[tuple[float, float]], list[tuple[float, float]]]:
    if se is not None:
        g = lambda k: [(float(q["x"]), float(q["y"])) for q in se.get(k, [])]           # noqa: E731
        return g("sewer_exits"), g("water_exits"), g("downpipes")
    pts = [q for q in p["site"]["points"] if q.get("status") != "demolish"]
    g = lambda kind: [(float(q["x"]), float(q["y"])) for q in pts if q.get("kind") == kind]   # noqa: E731
    return g("sewer_exit"), g("water_exit"), g("downpipe")


_PS_USE = {"house": "house", "unit": "unit", "shed": "shed"}          # Plan Studio types that name a use; "extension" and anything else do not


def _use_param(use: str | None, derived: str | None, source_file: str, what: str) -> Param:
    """The building use: the one the user chose, else the one the source names, else NOT SET (unresolved). Never defaulted to 'other'."""
    if use:
        return _param(use, source_file, what)
    if derived:
        return _param(derived, source_file, what)
    return Param(value=None, basis="unresolved")


# Plan Studio's standard round tanks (schema.js DEFAULTS.tanks): capacity (L) -> (diameter, height) in mm. Any other capacity is sized by
# Plan Studio's own estimate (schema.js tankSize), which is not a manufacturer dimension.
_PS_STANDARD_TANKS = {2000: (1350, 1600), 5000: (1850, 2000), 10000: (2400, 2400), 22500: (3600, 2400)}


def _tank_size_is_estimate(t: dict) -> bool:
    """Plan Studio writes ``sizeBasis`` ("standard" or "estimate") on a tank from stage 5; older files are judged by the standard size table."""
    sb = t.get("sizeBasis")
    if sb in ("standard", "estimate"):
        return sb == "estimate"
    cap = t.get("capacityL")
    return not (_fin(cap) and int(cap) == cap and _PS_STANDARD_TANKS.get(int(cap)) == (t.get("diameter"), t.get("height")))


def import_planstudio(data: bytes | str | dict, source_file: str = "design.planstudio.json", use: str | None = None) -> BuildingImportPayload:
    """``.planstudio.json`` -> ``building_import.v1`` (see the module docstring)."""
    use = check_use(use)
    budget = Budget()
    if isinstance(data, dict):
        raw = data
    else:
        try:
            raw = json.loads(data.decode("utf-8") if isinstance(data, bytes) else data)
        except (ValueError, UnicodeDecodeError, RecursionError):
            raise ImportFailure("NOT_JSON", "That file is not a Plan Studio design. It could not be read as JSON.") from None
    p = check_planstudio(raw)
    warnings: list[str] = []
    notes: list[str] = []
    north = float(p["site"]["northDeg"])
    se = _read_site_export(p, warnings)
    raw_levels = raw["levels"]

    # ---- footprints per level (plan frame, mm)
    holes_total = 0
    per_level: list[tuple[dict, list[Polygon]]] = []
    if se is not None:
        for lv, x in zip(p["levels"], se["levels"]):
            budget.check()
            polys = [q for r in x["footprint"] for q in _polys_of((lambda g: g if g.is_valid else g.buffer(0))(Polygon([(a, b) for a, b in r])))]
            per_level.append((lv, polys))
    else:
        for lv, polys, holes in derive_footprints(p, budget):
            holes_total += holes
            per_level.append((lv, polys))
    if holes_total:
        notes.append(f"{holes_total} courtyard or hole outline(s) in the footprint were not kept (a footprint is its outer boundary)")

    # ---- levels (local metres, ascending elevation); levels with no footprint are skipped and said so
    built: list[tuple[float, str, BuildingLevel]] = []
    dropped_rings = 0
    for lv, polys in per_level:
        if not polys:
            warnings.append(f"LEVEL {str(lv.get('name'))[:40]} HAS NO FOOTPRINT (no rooms or enclosed walls) and was not imported")
            continue
        local = _local_polys([list(q.exterior.coords)[:-1] for q in polys], north)
        if not local:
            continue
        el = float(lv["elevation"]) / 1000.0
        bl, d = _level_from_polys(str(lv["name"])[:60] or "Level", el, local)
        dropped_rings += d
        built.append((el, lv["id"], bl))
    if not built:
        raise ImportFailure("NO_FOOTPRINT", "The design has no rooms or enclosed walls, so there is no building footprint to place")
    built.sort(key=lambda t: t[0])
    levels = [b[2] for b in built]
    datum = next((i for i, lv in enumerate(levels) if lv.elevation_m == 0), 0)
    if levels[datum].elevation_m != 0:
        warnings.append("NO LEVEL AT ELEVATION 0: the lowest level is used as the ground floor datum")
    if dropped_rings:
        warnings.append(f"{dropped_rings} separate footprint part(s) beyond {MAX_RINGS} per level were not kept")
    ground_ring = Polygon(levels[datum].rings[0])
    ref = [float(ground_ring.centroid.x), float(ground_ring.centroid.y)]

    # ---- roof
    roof_rings: list[list[list[float]]] | None = None
    roof_area: float | None = None
    basis = BASIS_NOT_SET
    if se is not None and se.get("roof") is not None:
        r = se["roof"]
        if r.get("outline"):
            roof_rings = [_ring_pts(q) for q in _largest_first(_local_polys([[(a, b) for a, b in ring] for ring in r["outline"]], north))[:MAX_RINGS]]
        if r.get("plan_area_m2") is not None:
            roof_area = float(r["plan_area_m2"])
            basis = BASIS_SOURCE if r.get("area_basis") == "source" else BASIS_RASTER
        notes.extend(str(n)[:400] for n in (r.get("notes") or [])[:10] if isinstance(n, str))
    elif se is None:
        polys, area, holes, rnotes = derive_roof(p, raw_levels, budget)
        notes.extend(rnotes)
        if polys:
            loc = _local_polys([list(q.exterior.coords)[:-1] for q in polys], north)
            roof_rings = [_ring_pts(q) for q in _largest_first(loc)[:MAX_RINGS]]
        if area is not None:
            roof_area, basis = area, BASIS_RASTER
        if holes:
            notes.append(f"{holes} hole(s) in the roof outline were not kept")
    if basis == BASIS_RASTER:
        notes.append("Roof plan area is Plan Studio's approximate raster value (100 mm cells, rooms under the roof plus the eave overhang). It is not a measured area.")
    if roof_area is None:
        notes.append("Roof plan area is NOT SET: the source has no roofed rooms or no roof area.")

    # ---- exits
    sew, wat, dps = _exits_mm(p, se)
    cv = lambda pts: [list(to_local(x, y, north)) for x, y in pts]       # noqa: E731
    for what, n, cap in (("sewer exits", len(sew), MAX_SEWER_EXITS), ("water exits", len(wat), MAX_WATER_EXITS), ("downpipes", len(dps), MAX_DOWNPIPES)):
        if n > cap:
            raise ImportFailure("TOO_MANY_EXITS", f"the design has {n} {what}, more than the {cap} that one building can hold. Remove some in Plan Studio and import again.")
    exits = _build(BuildingExits, sewer=cv(sew), water=cv(wat), downpipes=cv(dps))

    # ---- height: not in a Plan Studio file (only the ceiling height of each level is), so it stays NOT SET
    top = max(p["levels"], key=lambda lv: float(lv["elevation"]))
    ch = top.get("height")
    if _fin(ch):
        notes.append(f"Overall height is NOT SET: the file gives the ceiling height of the top level ({(float(top['elevation']) + float(ch)) / 1000:.2f} m above the ground floor), not the roof ridge. Enter it, or take it from the Plan Studio GLB.")
    else:
        notes.append("Overall height is NOT SET: the file does not give it.")
    notes.append("Finished floor level (ffl_rl) is NOT SET: Plan Studio levels are relative to the ground floor. Enter the absolute RL.")
    skipped = sum(1 for lv in p["levels"] for k in ("walls", "rooms") for e in lv[k] if e.get("status") == "demolish")
    if skipped:
        notes.append(f"{skipped} wall(s) and room(s) marked demolish were left out (the proposed state is imported)")

    params: dict[str, Param] = {
        "building_use": _use_param(use, _PS_USE.get(str(p.get("type"))), source_file, "PLAN STUDIO"),
        "source": Param(value="plan_studio", basis="user", ref=f"IMPORTED FROM PLAN STUDIO: {source_file}"[:200]),
        "source_file": Param(value=source_file[:200], basis="user", ref="IMPORTED"),
        "roof_area_basis": Param(value=basis, basis="user", ref=f"IMPORTED FROM PLAN STUDIO: {source_file}"[:200]),
    }
    if params["building_use"].basis == "unresolved":
        warnings.append("BUILDING USE NOT SET: the file does not name one (Plan Studio type %s). Choose house, granny flat, unit, shed or other." % str(p.get("type"))[:40])
    if roof_area is not None:
        params["roof_plan_area_m2"] = _param(round(roof_area, 3), source_file, "PLAN STUDIO " + ("FILE" if basis == BASIS_SOURCE else "RASTER"))

    # ---- tanks -> rwt (capacity from the file; no levels invented)
    extras: list[ImportedExtra] = []
    live_tanks = [t for t in p["site"]["tanks"] if t.get("status") != "demolish" and _fin(t.get("x")) and _fin(t.get("y"))]
    if len(live_tanks) > MAX_TANKS:
        raise ImportFailure("TOO_MANY_TANKS", f"the design has {len(live_tanks)} rainwater tanks, more than the {MAX_TANKS} that can be imported with one building. Remove some in Plan Studio and import again.")
    estimated = 0
    for t in live_tanks:
        e, n = to_local(float(t["x"]), float(t["y"]), north)
        tp: dict[str, Param] = {}
        if _fin(t.get("capacityL")) and t["capacityL"] > 0:
            tp["capacity_l"] = _param(float(t["capacityL"]), source_file, "PLAN STUDIO TANK")
        est = _tank_size_is_estimate(t)
        for key, field_, div in (("diameter_m", "diameter", 1000.0), ("height_m", "height", 1000.0)):
            if _fin(t.get(field_)) and t[field_] > 0:
                if est:
                    tp[key] = Param(value=float(t[field_]) / div, basis="platform_default", ref=f"{BASIS_PS_ESTIMATE}: size for a non standard capacity, not a manufacturer dimension ({source_file})"[:200])
                else:
                    tp[key] = _param(float(t[field_]) / div, source_file, "PLAN STUDIO TANK")
        estimated += 1 if est and ("diameter_m" in tp or "height_m" in tp) else 0
        extras.append(_build(ImportedExtra, type="rwt", p=[e, n], status="existing" if t.get("status") == "existing" else "proposed", label=(f"{int(t['capacityL'])} L tank" if tp.get("capacity_l") else "Tank")[:120], params=tp))
    if extras:
        notes.append(f"{len(extras)} rainwater tank(s) in the file are imported as rwt objects with their capacity. Inlet, overflow and outlet levels are NOT SET.")
    if estimated:
        notes.append(f"{estimated} tank(s) have a non standard capacity: their diameter and height are PLAN STUDIO ESTIMATES (basis {BASIS_PS_ESTIMATE}), not manufacturer dimensions.")

    b = _build(ImportedBuilding, levels=levels, datum_index=datum, roof_outline=roof_rings, exits=exits, north_deg=north, notes=[n[:400] for n in notes[:30]], params=params)
    return _finish({"source": "plan_studio", "source_file": source_file, "used_site_export": se is not None, "building": b.model_dump(mode="json"), "ref": ref,
                    "extras": [x.model_dump(mode="json") for x in extras], "warnings": warnings})


# ---------------------------------------------------------------------------------------------------------------------------------
# footprint entry, DXF, PDF
# ---------------------------------------------------------------------------------------------------------------------------------
def _single_level_payload(source: str, source_file: str, polys: list[Polygon], use: str | None, extra_notes: list[str], warnings: list[str],
                          aligned_offset: tuple[float, float] | None = None, requires_confirmation: bool = False, alignment: dict | None = None) -> BuildingImportPayload:
    local, dropped = _level_from_polys("Ground", 0.0, polys)
    if dropped:
        warnings.append(f"{dropped} separate footprint part(s) beyond {MAX_RINGS} were not kept")
    ring0 = Polygon(local.rings[0])
    ref = [float(ring0.centroid.x), float(ring0.centroid.y)]
    notes = list(extra_notes) + ["Overall height is NOT SET: the source gives none. Enter it.", "Finished floor level (ffl_rl) is NOT SET. Enter the absolute RL.",
                                 "Roof plan area is NOT SET: the source gives none."]
    what = {"pdf": "PDF (SA7)", "dxf": "DXF (SA8)", "footprint_entry": "FOOTPRINT ENTRY"}[source]
    params = {
        "building_use": _use_param(use, None, source_file, what),
        "source": Param(value=source, basis="user", ref=f"IMPORTED FROM {what}: {source_file}"[:200]),
        "source_file": Param(value=source_file[:200], basis="user", ref="IMPORTED"),
        "roof_area_basis": Param(value=BASIS_NOT_SET, basis="user", ref=f"IMPORTED FROM {what}: {source_file}"[:200]),
    }
    if use is None:
        warnings.append("BUILDING USE NOT SET: choose house, granny flat, unit, shed or other")
    b = _build(ImportedBuilding, levels=[local], datum_index=0, notes=[n[:400] for n in notes], params=params)
    return _finish({"source": source, "source_file": source_file, "building": b.model_dump(mode="json"), "ref": ref,
                    "aligned_at": ([ref[0] + aligned_offset[0], ref[1] + aligned_offset[1]] if aligned_offset else None),
                    "warnings": warnings, "requires_confirmation": requires_confirmation, "alignment": alignment})


def import_footprint_entry(width_m: float, depth_m: float, use: str | None, source_file: str = "footprint entry") -> BuildingImportPayload:
    """A rectangle entered by the user: width (x) by depth (y), centred on the local origin. Height NOT SET until entered."""
    for n, v in (("width", width_m), ("depth", depth_m)):
        if not _fin(v) or v <= 0 or v > 1000:
            raise ImportFailure("BAD_FOOTPRINT", f"{n} must be a number above 0 and at most 1000 m")
    w, d = width_m / 2, depth_m / 2
    return _single_level_payload("footprint_entry", source_file, [Polygon([(-w, -d), (w, -d), (w, d), (-w, d)])], check_use(use),
                                 [f"Footprint entered as a {width_m:g} m by {depth_m:g} m rectangle."], [])


def footprint_from_ring(ring: list[tuple[float, float]], use: str | None, source_file: str = "drawn footprint") -> BuildingImportPayload:
    """A polygon drawn by the user (any local or MGA coordinates). Returned relative to its centroid.
    A ring that crosses itself is refused (422): repairing it would change the shape and move its centroid away from the drawn one."""
    if len(ring) < 3 or len(ring) > MAX_VERTICES or not all(_fin(x) and _fin(y) for x, y in ring):
        raise ImportFailure("BAD_FOOTPRINT", f"a footprint needs 3 to {MAX_VERTICES} finite vertices")
    p = Polygon(ring)
    if not p.is_valid:
        raise ImportFailure("FOOTPRINT_SELF_INTERSECTS", "FOOTPRINT RING SELF INTERSECTS, REDRAW")
    if p.is_empty or p.area <= 0:
        raise ImportFailure("BAD_FOOTPRINT", "the footprint has no area")
    c = p.centroid
    from shapely.affinity import translate
    return _single_level_payload("footprint_entry", source_file, [translate(p, -c.x, -c.y)], check_use(use), ["Footprint drawn by the user."], [])


def import_dxf(data: bytes, source_file: str = "plan.dxf", use: str | None = None) -> BuildingImportPayload:
    """Plan DXF via SA8 ``from_dxf``: the footprint is the union of the enclosed rooms it infers. SA8's confidence and notes are carried."""
    use = check_use(use)
    from app.agents.sa8_layout import from_dxf, to_footprint_polygon
    fd, name = tempfile.mkstemp(suffix=".dxf")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        try:
            model, rep = from_dxf(name)
        except ValueError as e:
            raise ImportFailure("DXF_NO_FOOTPRINT", str(e)) from None
        except Exception as e:  # noqa: BLE001 - ezdxf raises its own error types for a file that is not a DXF
            raise ImportFailure("DXF_UNREADABLE", f"That file could not be read as a DXF ({type(e).__name__}).") from None
    finally:
        try:
            os.unlink(name)
        except OSError:
            pass
    polys = _polys_of(to_footprint_polygon(model))
    if not polys:
        raise ImportFailure("DXF_NO_FOOTPRINT", "No enclosed rooms were found in the DXF, so there is no footprint")
    notes = [f"DXF units read as {rep.units} (scale {rep.scale_to_metres:g} to metres); footprint method {rep.method}; SA8 confidence {rep.confidence:.2f}.",
             "The coordinates are relative to the lowest left corner of the rooms: the DXF position on the site is not known."] + [str(n) for n in rep.notes]
    warn = []
    if rep.confidence < 0.6:
        warn.append(f"LOW CONFIDENCE DXF IMPORT ({rep.confidence:.2f}): check the footprint against the drawing before placing")
    return _single_level_payload("dxf", source_file, polys, use, notes, warn, requires_confirmation=rep.confidence < 0.6)


def import_pdf(data: bytes, *, lot_wkt: str, srid: int, source_file: str = "plan.pdf", use: str | None = None,
               scale_denominator: float | None = None) -> BuildingImportPayload:
    """Architectural PDF via SA7. The footprint comes back aligned to the lot in MGA; it is returned relative to its centroid with
    ``aligned_at`` giving the MGA position. SA7 refusals (RMSE above 0.30 m, no scale, no slab, no control points) are returned as errors."""
    use = check_use(use)
    from app.agents.base import AgentError
    from app.agents.sa7_pdf_align import Sa7PdfAligner
    from app.common.contracts import BoundarySegment, LotContext, PlanUpload
    from shapely import wkt as swkt
    try:
        lot = swkt.loads(lot_wkt)
    except Exception:  # noqa: BLE001
        raise ImportFailure("LOT_REQUIRED", "A PDF import needs the lot boundary (a valid polygon in MGA metres)") from None
    if lot.is_empty or lot.geom_type not in ("Polygon", "MultiPolygon"):
        raise ImportFailure("LOT_REQUIRED", "A PDF import needs the lot boundary (a valid polygon in MGA metres)")
    if not lot.is_valid:
        lot = lot.buffer(0)
    lot = max(lot.geoms, key=lambda g: g.area) if lot.geom_type == "MultiPolygon" else lot
    coords = list(lot.exterior.coords)
    segs = [BoundarySegment(seq=i + 1, bearing_deg=0.0, bearing_dms="0", distance_m=math.dist(coords[i], coords[i + 1]), start_xy=coords[i], end_xy=coords[i + 1])
            for i in range(len(coords) - 1)]
    ctx = LotContext(lot_id=uuid.uuid4(), jurisdiction="CUSTOM", lotplan="SUPPLIED BY CALLER", lga_name="NOT USED", mga_srid=int(srid), area_m2_calculated=float(lot.area),
                     boundary_wkt=lot.wkt, segments=segs)
    sha = hashlib.sha256(data).hexdigest()
    up = PlanUpload(upload_id=uuid.uuid4(), project_id=uuid.uuid4(), storage_path="upload://memory", file_sha256=sha, lot=ctx, user_scale_denominator=scale_denominator)
    try:
        run = Sa7PdfAligner(loader=lambda _p: data).run_detailed(up)
    except AgentError as e:
        raise ImportFailure(e.error_code, e.detail) from None
    ov = run.overlay
    from shapely import wkt as _w
    fp = _w.loads(ov.footprint_wkt)
    polys = _polys_of(fp)
    if not polys:
        raise ImportFailure("NO_SLAB_FOUND", "SA7 returned no footprint")
    big = _largest_first(polys)[0]
    c = big.centroid
    ox, oy = round(c.x), round(c.y)                   # local frame origin: the centroid rounded to 1 m (MGA magnitudes stay out of the local coordinates)
    from shapely.affinity import translate
    local = [translate(q, -ox, -oy) for q in polys]
    # aligned_at is the MGA position of `ref`, which _single_level_payload takes from the local ring centroid
    warn = list(ov.messages)
    al = {"outcome": ov.outcome, "rmse_m": ov.rmse_m, "max_residual_m": ov.max_residual_m, "scale_denominator": ov.scale_denominator_used,
          "scale_source": ov.scale_source, "reflection_applied": ov.reflection_applied}
    notes = [f"Aligned to the lot by SA7: RMSE {ov.rmse_m:.3f} m on {ov.control_point_count} control point(s), scale 1:{ov.scale_denominator_used:g} ({ov.scale_source}). "
             "The footprint is the slab outline found on the sheet, not a surveyed building outline.",
             f"Alignment outcome: {ov.outcome}. Unverified until confirmed by the user."]
    return _single_level_payload("pdf", source_file, local, use, notes, warn, aligned_offset=(float(ox), float(oy)),
                                 requires_confirmation=ov.outcome != "accepted_unverified", alignment=al)
