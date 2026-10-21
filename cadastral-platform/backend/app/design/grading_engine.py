"""Grading areas and earthworks for the site design tools: design surface patch, batters, cut and fill against the existing ground.

The earthworks maths is the SA3 routine ``sa3_terrain.cutfill.cut_fill`` (prismoidal volume on a triangulated grid, cut and fill zones by depth
band) and the SA3 batter convention of ``pad_surface`` (``z = clip(existing, pad - d / fill_h, pad + d / cut_h)`` with ``d`` the distance from the
platform and the slopes in H per V). ``graded_surface`` below is ``pad_surface`` with the platform level allowed to vary from point to point (a
sloping driveway or a graded plane); with a constant level it is identical (tested).

Nothing is assumed. A target level or a target grade with a fall direction must be on the object; a batter slope is the user's own value or the
resolved requirement (earthworks.batter.cut_max_slope / fill_max_slope / max_slope) and is otherwise UNRESOLVED, in which case NO batter is drawn
and only the platform's own cut and fill are computed. Volumes are INDICATIVE and always carry the terrain status.
"""
from __future__ import annotations

import math
import time
from typing import Any, Callable

import numpy as np
import shapely
from shapely import wkt as shw
from shapely.affinity import translate
from shapely.geometry import Polygon

from app.agents.sa3_terrain.cutfill import cut_fill
from app.agents.sa3_terrain.provenance import parse_accuracy_m

from . import engine_limits as EL
from .site_design import SiteObject
from .site_rules import DEFAULT, LGA, STATE, UNRESOLVED, USER, Rule, SiteRules
from .terrain_source import NO_TERRAIN, SiteTerrain

LevelAt = Callable[[np.ndarray, np.ndarray], np.ndarray]
#: grid spacing (m) of the cut and fill integration: a computation resolution, not an engineering value. Finer than the SA3 plan set default (1 m).
GRID_M = 0.5
#: extra distance (m) beyond the computed daylight reach that the integration region covers, so the batter toe is inside it. Numerical margin only.
REGION_MARGIN_M = 1.5
MAX_REACH_M = 60.0
EDGE_TOL_M = 1e-6


def graded_surface(window: Any, footprint: Polygon, level_at: LevelAt, cut_h: float | None, fill_h: float | None) -> Callable:
    """Proposed surface: the platform at ``level_at(platform point)`` inside ``footprint``; outside it the batter ``clip(existing, zp - d / fill_h,
    zp + d / cut_h)`` with ``d`` the distance to the footprint, ``zp`` the platform level at the nearest platform point (SA3 ``pad_surface``
    convention). With no batter slope (``None``) the surface outside the platform is the existing ground."""
    def f(x, y):
        x = np.asarray(x, float)
        y = np.asarray(y, float)
        px, py = x.ravel(), y.ravel()
        pts = shapely.points(px, py)
        d = shapely.distance(footprint, pts)
        d = np.where(d < EDGE_TOL_M, 0.0, d)               # a grid point on the platform edge belongs to the platform (floating point puts it either side)
        ze = np.asarray(window.z_at(px, py), float)
        near_x, near_y = px.copy(), py.copy()
        out = d > 0
        if out.any():
            sl = shapely.shortest_line(footprint, pts[out])
            c = shapely.get_coordinates(sl).reshape(-1, 2, 2)
            near_x[out], near_y[out] = c[:, 0, 0], c[:, 0, 1]
        zp = np.asarray(level_at(near_x, near_y), float)
        if cut_h is None or fill_h is None:
            z = np.where(d > 0, ze, zp)
        else:
            z = np.clip(ze, zp - d / fill_h, zp + d / cut_h)
        return z.reshape(x.shape)
    return f


class _LocalWindow:
    """A surface window in coordinates shifted by (-ox, -oy)."""

    def __init__(self, win: Any, ox: float, oy: float) -> None:
        self.win, self.ox, self.oy = win, ox, oy
        self.vertices = win.vertices - np.array([ox, oy, 0.0])

    def z_at(self, x, y):
        return self.win.z_at(np.asarray(x) + self.ox, np.asarray(y) + self.oy)


def volume_label(terrain: SiteTerrain) -> str:
    """INDICATIVE plus the terrain status, e.g. INDICATIVE 5 m DEM, LIDAR PENDING, NOT SURVEY (the status already says INDICATIVE for the DEM)."""
    s = terrain.status.strip()
    return s if s.upper().startswith("INDICATIVE") else f"INDICATIVE, {s}"


def batter_value(obj: SiteObject, which: str, rules: SiteRules) -> dict[str, Any]:
    """The batter slope (H per V) for ``cut`` or ``fill``: the object's own user value, else the resolved requirement, else UNRESOLVED."""
    key = f"batter_{which}_h_per_v"
    p = obj.params.get(key)
    rule = rules.batter(which)
    if p is not None and p.basis != "unresolved" and isinstance(p.value, (int, float)) and not isinstance(p.value, bool) and p.value > 0:
        return {"which": which, "h_per_v": float(p.value), "basis": USER, "ref": p.ref or "ENTERED BY THE USER", "requirement_key": rule.key,
                "limit_h_per_v": rule.value, "limit_basis": rule.basis, "limit_ref": rule.ref}
    if rule.resolved:
        return {"which": which, "h_per_v": rule.value, "basis": rule.basis, "ref": rule.ref, "requirement_key": rule.key,
                "limit_h_per_v": rule.value, "limit_basis": rule.basis, "limit_ref": rule.ref}
    return {"which": which, "h_per_v": None, "basis": UNRESOLVED, "ref": rule.ref, "requirement_key": rule.key,
            "limit_h_per_v": None, "limit_basis": UNRESOLVED, "limit_ref": rule.ref}


def batter_checks(b: dict[str, Any]) -> dict[str, Any]:
    """A check for one batter. A user slope steeper than the resolved maximum slope fails; one with no requirement to compare is NOT EVALUATED."""
    title = f"{b['which'].upper()} BATTER SLOPE"
    base = {"id": f"batter_{b['which']}", "title": title, "requirement_key": b["requirement_key"], "unit": "H per V", "chainage_from_m": None, "chainage_to_m": None}
    if b["h_per_v"] is None:
        return {**base, "status": "NOT EVALUATED", "value": None, "limit": None, "basis": UNRESOLVED, "ref": b["ref"],
                "note": f"BATTER SLOPE NOT SET AND {b['requirement_key']} IS UNRESOLVED, SO NO BATTER IS DRAWN"}
    if b["limit_h_per_v"] is None:
        return {**base, "status": "NOT EVALUATED", "value": b["h_per_v"], "limit": None, "basis": UNRESOLVED, "ref": b["limit_ref"],
                "note": f"USER SLOPE; THE REQUIREMENT {b['requirement_key']} IS UNRESOLVED, SO IT IS NOT CHECKED"}
    ok = b["h_per_v"] >= b["limit_h_per_v"] - 1e-9
    return {**base, "status": "PASS" if ok else "FAIL", "value": b["h_per_v"], "limit": b["limit_h_per_v"], "basis": b["limit_basis"], "ref": b["limit_ref"],
            "note": "H PER V; A BATTER STEEPER THAN THE MAXIMUM SLOPE FAILS" if not ok else "H PER V, NOT STEEPER THAN THE MAXIMUM SLOPE"}


def _polygonal(g):
    """The area parts of a geometry (an intersection can return a collection with lines or points as well)."""
    if g.geom_type in ("Polygon", "MultiPolygon"):
        return g
    parts = [p for p in getattr(g, "geoms", []) if p.geom_type in ("Polygon", "MultiPolygon")]
    return shapely.union_all(parts) if parts else Polygon()


def earthworks(terrain: SiteTerrain, platform: Polygon, level_at: LevelAt, cut: dict[str, Any], fill: dict[str, Any], *,
               depth_hint_m: float | None = None, keep: Polygon | None = None, exclude: Polygon | None = None) -> dict[str, Any]:
    """Cut and fill of a platform with batters against the existing ground. All geometry in MGA metres; volumes in m3 (INDICATIVE).

    ``cut`` / ``fill`` are ``batter_value`` dicts. When either slope is UNRESOLVED no batter is computed and the result is the platform alone.
    ``keep`` limits the earthworks region to one side of a line (the driveway start: nothing on the road side of the kerb line) and ``exclude`` removes an
    area from it (a linked building footprint); the platform itself is never cut by ``keep``. The batter zones are cut to the region exactly.
    The grid of the region is capped (``engine_limits.MAX_GRID_CELLS``): over it ``EngineLimitError`` is raised before anything is built."""
    cut_h, fill_h = cut["h_per_v"], fill["h_per_v"]
    batters = cut_h is not None and fill_h is not None
    reach = 0.0
    if batters:
        depth = depth_hint_m if depth_hint_m is not None else 3.0
        reach = min(MAX_REACH_M, depth * max(cut_h, fill_h) + REGION_MARGIN_M)
    region = platform.buffer(reach + (REGION_MARGIN_M if batters else 0.0), join_style=2) if batters else platform
    if keep is not None:
        region = region.intersection(keep).union(platform)
    if exclude is not None:
        region = region.difference(exclude)
    dropped = 0
    if region.geom_type != "Polygon":                                  # a clip can split the region; the SA3 integration takes one area, so the largest part is computed
        parts = list(getattr(region, "geoms", [region]))
        region = max(parts, key=lambda g: g.area)
        dropped = len(parts) - 1
    EL.check_grid(region, GRID_M)
    win = terrain.surface.window(region, 1.0)
    prop = graded_surface(win, platform, level_at, cut_h if batters else None, fill_h if batters else None)
    acc = parse_accuracy_m(str(terrain.provenance.get("accuracy") or ""))
    # SA3 cut_fill triangulates with Delaunay, which loses its exact ties at MGA magnitudes (6 million metres); run it in coordinates local to the platform
    ox, oy = round(platform.centroid.x), round(platform.centroid.y)
    shift = lambda g, sx, sy: translate(g, sx, sy)          # noqa: E731
    lwin = _LocalWindow(win, ox, oy)
    lprop = lambda x, y: prop(np.asarray(x) + ox, np.asarray(y) + oy)          # noqa: E731
    lplat, lregion = shift(platform, -ox, -oy), shift(region, -ox, -oy)
    r = cut_fill(lwin, lprop, region=lregion, spacing=GRID_M, footprint=lplat, accuracy_m=acc if acc is not None else 0.0)
    plat = platform
    zones = []
    cut_u, fill_u = [], []
    clipped = keep is not None or exclude is not None

    def out_wkt(g):
        g = g.simplify(0.02)
        return (_polygonal(g.intersection(region)) if clipped else g).wkt          # simplifying can move an edge by 0.02 m: clip again so nothing is drawn past the clip lines
    for z in r.zones:
        g = shift(shw.loads(z.wkt), ox, oy)
        if clipped:
            g = _polygonal(g.intersection(region))
            if g.is_empty:
                continue
        zones.append({"kind": z.kind, "min_depth_m": round(z.min_depth_m, 3), "max_depth_m": round(z.max_depth_m, 3), "area_m2": round(z.area_m2, 3), "wkt": out_wkt(g)})
        (cut_u if z.kind == "cut" else fill_u).append(g)
    cut_batter = shapely.union_all(cut_u).difference(plat) if (batters and cut_u) else None
    fill_batter = shapely.union_all(fill_u).difference(plat) if (batters and fill_u) else None
    return {
        "label": volume_label(terrain), "terrain_status": terrain.status, "grid_m": GRID_M,
        "cut_m3": round(r.cut_volume_m3, 3), "fill_m3": round(r.fill_volume_m3, 3), "net_m3": round(r.cut_volume_m3 - r.fill_volume_m3, 3),
        "cut_area_m2": round(r.cut_area_m2, 3), "fill_area_m2": round(r.fill_area_m2, 3),
        "uncertainty_m3": round(r.volume_uncertainty_m3, 3) if acc is not None else None,
        "uncertainty_note": None if acc is not None else "VERTICAL ACCURACY OF THE TERRAIN IS NOT STATED AS A NUMBER, SO NO VOLUME UNCERTAINTY IS GIVEN",
        "batters_computed": batters,
        "batters": {
            "cut": {k: cut[k] for k in ("h_per_v", "basis", "ref", "requirement_key")},
            "fill": {k: fill[k] for k in ("h_per_v", "basis", "ref", "requirement_key")},
            "cut_wkt": out_wkt(cut_batter) if cut_batter is not None and not cut_batter.is_empty else None,
            "fill_wkt": out_wkt(fill_batter) if fill_batter is not None and not fill_batter.is_empty else None,
        },
        "platform_wkt": platform.wkt, "zones": zones,
        "notes": ([] if batters else ["NO BATTER DRAWN: THE BATTER SLOPE IS UNRESOLVED. CUT AND FILL ARE OF THE PLATFORM ALONE"]) +
                 (["THE CLIP SPLIT THE EARTHWORKS REGION: ONLY ITS LARGEST PART IS COMPUTED AND DRAWN"] if dropped else []) +
                 ["VOLUMES ARE INDICATIVE, FROM THE EXISTING GROUND TRIANGLES OF THE 3D MODEL, NOT A SURVEY QUANTITY"],
    }


# ---- grading areas ------------------------------------------------------------------------------------------------------------------
def _num(obj: SiteObject, key: str) -> float | None:
    p = obj.params.get(key)
    if p is None or p.basis == "unresolved" or isinstance(p.value, bool) or not isinstance(p.value, (int, float)):
        return None
    return float(p.value)


def grading_plane(obj: SiteObject, terrain: SiteTerrain, ring: Polygon) -> tuple[LevelAt | None, dict[str, Any]]:
    """The design level function of a grading area and a description of it.

    ``target_level_m`` gives a flat platform at that level. Otherwise ``target_grade_pct`` with ``fall_direction_deg`` (grid bearing the
    surface falls towards) gives a plane through a pivot level: ``pivot_level_m`` if the user entered it, else the existing ground level at the
    centroid of the area (so the plane is not anchored to an invented level). Neither: NOT SET."""
    level = _num(obj, "target_level_m")
    if level is not None:
        return (lambda x, y, z=level: np.full(np.shape(x), z)), {"mode": "level", "target_level_m": level, "pivot_level_m": None, "pivot_basis": None}
    grade, bearing = _num(obj, "target_grade_pct"), _num(obj, "fall_direction_deg")
    if grade is None or bearing is None:
        return None, {"mode": "not_set", "target_level_m": None, "pivot_level_m": None, "pivot_basis": None}
    c = ring.centroid
    pv = _num(obj, "pivot_level_m")
    basis = "ENTERED BY THE USER"
    if pv is None:
        z = terrain.surface.z_at(np.array([c.x]), np.array([c.y]))[0]
        if not np.isfinite(z):
            return None, {"mode": "no_terrain", "target_level_m": None, "pivot_level_m": None, "pivot_basis": None}
        pv, basis = float(z), "EXISTING GROUND AT THE CENTROID OF THE AREA"
    b = math.radians(bearing)
    fx, fy = math.sin(b), math.cos(b)                                 # unit vector of the fall direction (grid bearing: clockwise from north)
    g = grade / 100.0
    return (lambda x, y, cx=c.x, cy=c.y, z0=pv: z0 - g * ((np.asarray(x) - cx) * fx + (np.asarray(y) - cy) * fy)), \
           {"mode": "grade", "target_level_m": None, "target_grade_pct": grade, "fall_direction_deg": bearing, "pivot_level_m": pv, "pivot_basis": basis}


def grading(obj: SiteObject, terrain: SiteTerrain, rules: SiteRules) -> dict[str, Any]:
    """Design surface patch, batters and cut and fill volumes of one ``grading_area`` object against the existing ground."""
    t0 = time.perf_counter()
    if obj.type != "grading_area" or obj.geometry.kind != "polygon":
        raise ValueError("a grading_area object with a polygon is needed")
    EL.check_grading(obj)
    EL.check_within_terrain(obj.geometry, terrain, "THE GRADING AREA")
    ring = Polygon([(p[0], p[1]) for p in obj.geometry.ring])
    out: dict[str, Any] = {"schema": "grading.v1", "object_id": obj.id, "terrain": {"status": terrain.status, "source": terrain.source, "provenance": terrain.provenance},
                           "rules": {k: rules.get(k).public() for k in ("earthworks.batter.cut_max_slope", "earthworks.batter.fill_max_slope", "earthworks.batter.max_slope")},
                           "label": volume_label(terrain)}
    if not ring.is_valid or ring.area <= 1e-6:
        return {**out, "status": "INVALID GEOMETRY: THE GRADING AREA OUTLINE IS NOT A VALID AREA", "design": None, "earthworks": None, "checks": [], "notes": [],
                "timing_ms": round((time.perf_counter() - t0) * 1000, 1)}
    z_in = terrain.surface.z_at(*np.array(ring.exterior.coords).T)
    level_at, desc = grading_plane(obj, terrain, ring)
    out["design"] = desc
    cut, fill = batter_value(obj, "cut", rules), batter_value(obj, "fill", rules)
    out["checks"] = [batter_checks(cut), batter_checks(fill)]
    if not np.isfinite(z_in).any():
        return {**out, "status": f"{NO_TERRAIN}: NO EXISTING GROUND UNDER THE AREA", "earthworks": None, "notes": [], "timing_ms": round((time.perf_counter() - t0) * 1000, 1)}
    if level_at is None:
        why = "TARGET LEVEL NOT SET (OR TARGET GRADE AND FALL DIRECTION NOT SET)" if desc["mode"] == "not_set" else f"{NO_TERRAIN} AT THE CENTROID OF THE AREA"
        return {**out, "status": why, "earthworks": None, "notes": [], "timing_ms": round((time.perf_counter() - t0) * 1000, 1)}
    ze = z_in[np.isfinite(z_in)]
    zp = level_at(np.array(ring.exterior.coords)[:, 0], np.array(ring.exterior.coords)[:, 1])
    depth = float(max(np.max(np.abs(zp[np.isfinite(z_in)] - ze)), 0.5)) if len(ze) else None
    ew = earthworks(terrain, ring, level_at, cut, fill, depth_hint_m=depth)
    # the design surface patch: the platform corners at their design levels, as a polygon with levels (E, N, RL)
    zc = level_at(np.array(ring.exterior.coords)[:-1, 0], np.array(ring.exterior.coords)[:-1, 1])
    patch = [[round(float(x), 3), round(float(y), 3), round(float(z), 3)] for (x, y), z in zip(list(ring.exterior.coords)[:-1], zc)]
    missing = int((~np.isfinite(z_in)).sum())
    notes = list(ew["notes"])
    if missing:
        notes.append(f"{NO_TERRAIN} UNDER {missing} OF {len(z_in)} OUTLINE POINTS: CUT AND FILL COVER ONLY THE PART OF THE AREA WITH EXISTING GROUND")
    return {**out, "status": "OK", "design_patch": patch, "earthworks": ew, "notes": notes, "timing_ms": round((time.perf_counter() - t0) * 1000, 1)}
