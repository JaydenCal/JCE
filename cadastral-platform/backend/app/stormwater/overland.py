"""Overland flow (stage 9): D8 flow direction and accumulation on a raster of the combined existing ground and design surfaces, with depression (ponding) detection.

WHAT THIS IS. An INDICATIVE map of where surface water would collect and run, from the shape of the ground alone. It is NOT a flood study: no rainfall, no runoff coefficient, no
roughness, no depth of flow, no velocity, no pipes and no blockage is used. Every result carries the terrain status of the model (for example INDICATIVE 5 m DEM, LIDAR PENDING) and
the label FLOW PATHS INDICATIVE, NOT A FLOOD STUDY.

THE SURFACE. Cell centres sample the existing ground (``TriSurface.z_at``). Design surfaces are applied to it when ``surface = design``:
* a proposed grading area sets its cells to the design level function of the area (flat target level, or the target grade plane); its batters are NOT applied (stated on the result);
* a building (existing or proposed) is an OBSTACLE: its footprint cells are walls that water cannot enter and that contribute no area (roof runoff belongs to the catchment table);
* a retaining wall with a known thickness is an OBSTACLE in the same way.
Cells with no ground under them are NO DATA and are outlets (water leaves the model there), as is the edge of the raster.

THE METHOD. (1) Priority flood with a small epsilon (Barnes et al. 2014, epsilon variant) gives the conditioned surface that every cell can drain across. (2) Depressions are the cells
where the conditioned surface is more than ``DEPRESSION_MIN_DEPTH_M`` above the ground. They are REPORTED (area, depth, volume, spill level, outline); they are not filled silently:
flow is routed across them on the conditioned surface so the paths continue to an outlet, and the depression is drawn as a ponding polygon. (3) D8 flow direction: each cell drains to
the steepest descent among its eight neighbours on the conditioned surface. (4) Flow accumulation: the contributing area (m2) of a cell is the area of all cells that drain through
it. (5) Flow paths: the cells with contributing area at or above the display threshold, joined into lines.

PARAMETERS (all documented, none a requirement): cell size ``DEFAULT_CELL_M``; the contributing area threshold ``DEFAULT_THRESHOLD_M2`` that decides which cells are drawn as a flow path
(a DISPLAY parameter: it changes what is drawn, never the accumulation); ``DEPRESSION_MIN_DEPTH_M`` (a noise tolerance on the ground levels); ``MARGIN_M`` (raster margin around the lot).
"""
from __future__ import annotations

import heapq
import math
import time
from typing import Any

import numpy as np
import shapely
from scipy import ndimage
from shapely.geometry import Polygon

from app.design import engine_limits as EL
from app.design import object_geometry as G
from app.design.grading_engine import grading_plane
from app.design.param_basis import Reader
from app.design.site_design import SiteDesign
from app.design.terrain_source import SiteTerrain

DEFAULT_CELL_M = 0.5            # computation resolution of the raster
DEFAULT_THRESHOLD_M2 = 25.0     # DISPLAY parameter: contributing area at which a cell is drawn as a flow path
DEPRESSION_MIN_DEPTH_M = 0.01   # noise tolerance: a depression shallower than this is not reported
MARGIN_M = 5.0                  # raster margin around the lot, so water arriving from and leaving to the neighbours is routed
EPS = 1e-5                      # epsilon of the priority flood (m per cell); well below DEPRESSION_MIN_DEPTH_M over any plausible flat run
FLOW_LABEL = "FLOW PATHS INDICATIVE, NOT A FLOOD STUDY"
OFFS = ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1))


def check_deadline(deadline: float | None) -> None:
    """Stop the calculation when the wall clock limit has passed (422 OVERLAND_TIMEOUT through the API)."""
    if deadline is not None and time.perf_counter() > deadline:
        raise EL.EngineLimitError(EL.OVERLAND_TIMEOUT, f"THE OVERLAND FLOW CALCULATION TOOK LONGER THAN {EL.MAX_OVERLAND_SECONDS:g} S AND WAS STOPPED. USE A LARGER CELL SIZE OR A SMALLER SITE")


def flood(z: np.ndarray, valid: np.ndarray, outlet: np.ndarray, eps: float = EPS, deadline: float | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Conditioned surface by priority flood (epsilon variant), and the mask of the valid cells the flood REACHED from an outlet. ``valid`` cells take part; ``outlet`` marks the
    valid cells where water may leave (the raster edge, next to no data). Valid cells not reachable from an outlet (enclosed by walls) are returned at their own level and are NOT in
    the reached mask: they are closed basins, reported by ``closed_basins`` and never dropped."""
    ny, nx = z.shape
    W = nx + 2
    zp = np.full((ny + 2, W), np.inf)
    zp[1:-1, 1:-1] = np.where(valid, z, np.inf)
    op = np.zeros((ny + 2, W), bool)
    op[1:-1, 1:-1] = outlet & valid
    vp = np.zeros((ny + 2, W), bool)
    vp[1:-1, 1:-1] = valid
    zl = zp.ravel().tolist()
    fl = list(zl)
    closed = bytearray((~vp).ravel().tobytes())          # 1 = not a valid cell (wall, no data, padding) or already settled
    heap: list[tuple[float, int]] = []
    for idx in np.flatnonzero(op.ravel()).tolist():
        closed[idx] = 1
        heap.append((zl[idx], idx))
    heapq.heapify(heap)
    offs = [dy * W + dx for dy, dx in OFFS]
    push, pop = heapq.heappush, heapq.heappop
    pops = 0
    while heap:
        fz, c = pop(heap)
        pops += 1
        if not pops & 16383:
            check_deadline(deadline)
        for o in offs:
            n = c + o
            if closed[n]:
                continue
            closed[n] = 1
            zn = zl[n]
            nz = zn if zn > fz else fz + eps
            fl[n] = nz
            push(heap, (nz, n))
    out = np.array(fl, float).reshape(ny + 2, W)[1:-1, 1:-1]
    reached = (np.frombuffer(bytes(closed), np.uint8).reshape(ny + 2, W)[1:-1, 1:-1] == 1) & valid
    return np.where(valid, out, np.nan), reached


def priority_flood(z: np.ndarray, valid: np.ndarray, outlet: np.ndarray, eps: float = EPS) -> np.ndarray:
    """The conditioned surface of ``flood`` (kept for callers that do not need the reached mask)."""
    return flood(z, valid, outlet, eps)[0]


def d8_receivers(f: np.ndarray, valid: np.ndarray, cell: float) -> np.ndarray:
    """Flat index of the cell each cell drains to (the steepest descent of its eight neighbours on ``f``), -1 for an outlet or a cell with no lower valid neighbour."""
    ny, nx = f.shape
    fp = np.full((ny + 2, nx + 2), np.nan)
    fp[1:-1, 1:-1] = np.where(valid, f, np.nan)
    best = np.zeros((ny, nx))
    recv = np.full((ny, nx), -1, np.int64)
    jj, ii = np.mgrid[0:ny, 0:nx]
    here = fp[1:-1, 1:-1]
    for dy, dx in OFFS:
        nb = fp[1 + dy:ny + 1 + dy, 1 + dx:nx + 1 + dx]
        dist = cell * (math.sqrt(2.0) if dy and dx else 1.0)
        with np.errstate(invalid="ignore"):
            slope = (here - nb) / dist
        slope = np.where(np.isfinite(slope) & valid, slope, 0.0)
        better = slope > best + 1e-15
        best = np.where(better, slope, best)
        recv = np.where(better, (jj + dy) * nx + (ii + dx), recv)
    return recv


def accumulate(f: np.ndarray, valid: np.ndarray, recv: np.ndarray, weight: np.ndarray) -> np.ndarray:
    """Contributing area: ``weight`` (m2 per cell) summed down the receivers, processed from the highest cell down."""
    flat_f = np.where(valid, f, -np.inf).ravel()
    order = np.argsort(-flat_f, kind="stable")
    n_valid = int(valid.sum())
    acc = weight.ravel().tolist()
    rv = recv.ravel().tolist()
    for c in order[:n_valid].tolist():
        r = rv[c]
        if r >= 0:
            acc[r] += acc[c]
    return np.array(acc, float).reshape(f.shape)


def _outline(mask: np.ndarray, cell: float, x0: float, y0: float) -> list[list[float]]:
    """Outline of the largest part of a cell mask: each row's runs of cells become one box, the boxes are merged and the result is simplified (bounded work for a large mask)."""
    jj, ii = np.nonzero(mask)
    if len(jj) == 0:
        return []
    order = np.lexsort((ii, jj))
    jj, ii = jj[order], ii[order]
    brk = np.flatnonzero((np.diff(jj) != 0) | (np.diff(ii) != 1)) + 1
    starts, ends = np.r_[0, brk], np.r_[brk, len(jj)] - 1
    boxes = shapely.box(x0 + ii[starts] * cell, y0 + jj[starts] * cell, x0 + (ii[ends] + 1) * cell, y0 + (jj[ends] + 1) * cell)
    geom = shapely.union_all(boxes).simplify(cell * 0.25)
    poly = geom if geom.geom_type == "Polygon" else max(geom.geoms, key=lambda g: g.area)
    return [[round(p[0], 3), round(p[1], 3)] for p in poly.exterior.coords]


def _labels(mask: np.ndarray) -> tuple[np.ndarray, int, list[tuple[slice, slice]]]:
    lab, n = ndimage.label(mask, structure=np.ones((3, 3)))
    return lab, n, ndimage.find_objects(lab)


def depressions(z: np.ndarray, f: np.ndarray, valid: np.ndarray, cell: float, x0: float, y0: float, min_depth: float = DEPRESSION_MIN_DEPTH_M,
                outline_limit: int = EL.MAX_OVERLAND_PONDS) -> list[dict[str, Any]]:
    """Depressions of the conditioned surface over the ground, largest volume first. The statistics are taken for every depression in one vectorised pass; the outline is built
    for the ``outline_limit`` largest only (the rest are not returned by the API)."""
    depth = np.where(valid, f - z, 0.0)
    mask = depth > min_depth
    if not mask.any():
        return []
    lab, n, slices = _labels(mask)
    idx = np.arange(1, n + 1)
    cnt = ndimage.sum(mask, lab, idx)
    vol = ndimage.sum(depth, lab, idx) * cell * cell
    mxd = ndimage.maximum(depth, lab, idx)
    spill = ndimage.maximum(np.where(mask, f, -np.inf), lab, idx)
    low = ndimage.minimum(np.where(mask, z, np.inf), lab, idx)
    jj, ii = np.mgrid[0:mask.shape[0], 0:mask.shape[1]]
    cj = ndimage.mean(jj, lab, idx)
    ci = ndimage.mean(ii, lab, idx)
    out: list[dict[str, Any]] = []
    for r in np.argsort(-vol, kind="stable").tolist():
        k = r + 1
        item = {"area_m2": round(float(cnt[r]) * cell * cell, 3), "max_depth_m": round(float(mxd[r]), 4), "volume_m3": round(float(vol[r]), 4),
                "spill_level_rl": round(float(spill[r]), 4), "lowest_ground_rl": round(float(low[r]), 4),
                "centroid": [round(x0 + (float(ci[r]) + 0.5) * cell, 3), round(y0 + (float(cj[r]) + 0.5) * cell, 3)], "outline": []}
        if len(out) < outline_limit:
            sl = slices[r]
            sub = lab[sl] == k
            ox, oy = x0 + sl[1].start * cell, y0 + sl[0].start * cell
            item["outline"] = _outline(sub, cell, ox, oy)
        out.append(item)
    return out


def closed_basins(z: np.ndarray, valid: np.ndarray, reached: np.ndarray, outlet: np.ndarray, recv: np.ndarray, acc: np.ndarray, cell: float, x0: float, y0: float,
                  limit: int = EL.MAX_OVERLAND_PONDS) -> dict[str, Any]:
    """Valid cells the priority flood never reached (water cannot get from them to an outlet: they are enclosed by obstacles) are CLOSED BASINS with NO OUTLET. Each is reported
    with its area, lowest ground level and the D8 sinks inside it (cells with no lower neighbour, the places water would collect). They are never dropped and never filled."""
    enc = valid & ~reached
    sink_mask = valid & (recv < 0) & ~outlet
    res: dict[str, Any] = {"basins": [], "total": 0, "cells": int(enc.sum()), "area_m2": round(float(enc.sum()) * cell * cell, 3), "sink_count": int(sink_mask.sum()), "sinks": [],
                           "sinks_truncated": False}
    if not enc.any() and not sink_mask.any():
        return res
    lab, n, slices = _labels(enc) if enc.any() else (np.zeros(enc.shape, int), 0, [])
    idx = np.arange(1, n + 1)
    cnt = ndimage.sum(enc, lab, idx) if n else np.zeros(0)
    order = np.argsort(-cnt, kind="stable").tolist()                      # largest basin first: CB1 is the largest
    id_of = {r + 1: f"CB{rank + 1}" for rank, r in enumerate(order)}
    sj, si = np.nonzero(sink_mask)
    sinks = [{"x": round(x0 + (a + 0.5) * cell, 3), "y": round(y0 + (b + 0.5) * cell, 3), "rl": round(float(z[b, a]), 4), "contributing_area_m2": round(float(acc[b, a]), 3),
              "basin": id_of.get(int(lab[b, a]))} for a, b in zip(si.tolist(), sj.tolist())]
    sinks.sort(key=lambda t: -t["contributing_area_m2"])
    res["sinks"], res["sinks_truncated"] = sinks[:limit], len(sinks) > limit
    if n == 0:
        return res
    low = ndimage.minimum(np.where(enc, z, np.inf), lab, idx)
    high = ndimage.maximum(np.where(enc, z, -np.inf), lab, idx)
    jj, ii = np.mgrid[0:enc.shape[0], 0:enc.shape[1]]
    cj, ci = ndimage.mean(jj, lab, idx), ndimage.mean(ii, lab, idx)
    sink_n = np.bincount(lab[sink_mask], minlength=n + 1)
    basins = []
    for r in order:
        k = r + 1
        item = {"id": id_of[k], "status": "NO OUTLET", "area_m2": round(float(cnt[r]) * cell * cell, 3), "cells": int(cnt[r]), "lowest_rl": round(float(low[r]), 4), "highest_rl": round(float(high[r]), 4),
                "centroid": [round(x0 + (float(ci[r]) + 0.5) * cell, 3), round(y0 + (float(cj[r]) + 0.5) * cell, 3)], "sink_count": int(sink_n[k]),
                "sinks": [t for t in sinks if t["basin"] == id_of[k]][:10], "outline": []}
        if len(basins) < limit:
            sl = slices[r]
            item["outline"] = _outline(lab[sl] == k, cell, x0 + sl[1].start * cell, y0 + sl[0].start * cell)
        basins.append(item)
    res["total"], res["basins"] = n, basins[:limit]
    return res


def flow_paths(acc: np.ndarray, recv: np.ndarray, z: np.ndarray, f: np.ndarray, cell: float, x0: float, y0: float, threshold_m2: float) -> dict[str, Any]:
    """Lines of the cells at or above the threshold, each running from the cell where the contributing area first reaches the threshold down to an outlet or onto an earlier line."""
    ny, nx = acc.shape
    T = acc >= threshold_m2 - 1e-9
    if not T.any():
        return {"paths": [], "truncated": False, "cells": 0}
    rv = recv.ravel()
    tf = T.ravel()
    donors = np.zeros(tf.size, np.int32)
    src = np.flatnonzero(tf & (rv >= 0))
    tgt = rv[src]
    keep = tf[tgt]
    np.add.at(donors, tgt[keep], 1)
    heads = np.flatnonzero(tf & (donors == 0))
    seen = bytearray(tf.size)
    paths: list[dict[str, Any]] = []
    accf, zf, ff = acc.ravel(), z.ravel(), f.ravel()
    for h in heads[np.argsort(-accf[heads], kind="stable")].tolist():
        pts, c = [], h
        while True:
            pts.append(c)
            if seen[c]:
                break
            seen[c] = 1
            r = int(rv[c])
            if r < 0 or not tf[r]:
                break
            c = r
        if len(pts) >= 2:
            paths.append({"cells": pts, "max_area_m2": float(accf[pts[-1]])})
    paths.sort(key=lambda p: -p["max_area_m2"])
    truncated = False
    if len(paths) > EL.MAX_OVERLAND_PATHS:
        paths, truncated = paths[:EL.MAX_OVERLAND_PATHS], True
    out, total = [], 0
    for p in paths:
        cs = np.array(p["cells"])
        if total + len(cs) > EL.MAX_OVERLAND_PATH_POINTS:
            truncated = True
            break
        total += len(cs)
        j, i = np.divmod(cs, nx)
        zz = np.where(np.isfinite(ff[cs]), ff[cs], zf[cs])
        out.append({"max_area_m2": round(p["max_area_m2"], 2), "points": [[round(x0 + (a + 0.5) * cell, 3), round(y0 + (b + 0.5) * cell, 3), round(float(c), 3)] for a, b, c in zip(i.tolist(), j.tolist(), zz.tolist())]})
    return {"paths": out, "truncated": truncated, "cells": int(T.sum())}


def solve(z: np.ndarray, valid: np.ndarray, outlet: np.ndarray, weight: np.ndarray, cell: float, x0: float, y0: float, threshold_m2: float = DEFAULT_THRESHOLD_M2,
          deadline: float | None = None) -> dict[str, Any]:
    """The raster solution on given arrays (the part tested on synthetic surfaces). ``z`` levels, ``valid`` cells in the model, ``outlet`` valid cells where water leaves, ``weight`` the area each cell contributes."""
    f, reached = flood(z, valid, outlet, deadline=deadline)
    check_deadline(deadline)
    pits = depressions(z, f, valid, cell, x0, y0)
    recv = d8_receivers(f, valid, cell)
    check_deadline(deadline)
    acc = accumulate(f, valid, recv, weight)
    check_deadline(deadline)
    basins = closed_basins(z, valid, reached, outlet, recv, acc, cell, x0, y0)
    paths = flow_paths(acc, recv, z, f, cell, x0, y0, threshold_m2)
    check_deadline(deadline)
    return {"f": f, "recv": recv, "acc": acc, "depressions": pits, "paths": paths, "reached": reached, "closed": basins}


def build_surface(design: SiteDesign | None, terrain: SiteTerrain, rd: Reader, region: tuple[float, float, float, float], cell: float, use_design: bool) -> dict[str, Any]:
    x0, y0, x1, y1 = region
    nx, ny = EL.check_overland(x1 - x0, y1 - y0, cell)
    xs = x0 + (np.arange(nx) + 0.5) * cell
    ys = y0 + (np.arange(ny) + 0.5) * cell
    X, Y = np.meshgrid(xs, ys)
    z = terrain.surface.z_at(X.ravel(), Y.ravel()).reshape(ny, nx)
    nodata = ~np.isfinite(z)
    obstacle = np.zeros((ny, nx), bool)
    notes: list[str] = []
    graded: list[dict[str, Any]] = []
    obstacles: list[dict[str, Any]] = []
    if use_design and design is not None:
        for o in design.objects:
            if o.accepted == "rejected" or o.status == "to_be_removed":
                continue
            poly = None
            if o.type == "building":
                poly = G.ring_polygon(o)
                kind = "BUILDING"
            elif o.type == "retaining_wall":
                poly = G.footprint(o, rd)
                kind = "RETAINING WALL"
                if poly is None:
                    notes.append(f"RETAINING WALL {o.id} HAS NO THICKNESS, SO IT IS NOT AN OBSTACLE")
            elif o.type == "grading_area" and o.status == "proposed" and o.geometry.kind == "polygon":
                ring = G.ring_polygon(o)
                if ring is None:
                    continue
                level_at, desc = grading_plane(o, terrain, ring)
                if level_at is None:
                    notes.append(f"GRADING AREA {o.id}: THE TARGET LEVEL OR GRADE IS NOT SET, SO THE EXISTING GROUND IS USED")
                    continue
                m = _mask(ring, xs, ys)
                z = np.where(m, level_at(X, Y).reshape(ny, nx), z)
                nodata &= ~m | ~np.isfinite(z)
                graded.append({"object_id": o.id, "mode": desc.get("mode"), "cells": int(m.sum())})
                continue
            else:
                continue
            if poly is None:
                continue
            m = _mask(poly, xs, ys)
            if m.any():
                obstacle |= m
                obstacles.append({"object_id": o.id, "kind": kind, "cells": int(m.sum())})
        if graded:
            notes.append("GRADING AREAS ARE APPLIED AS THEIR PLATFORM ONLY. THEIR BATTERS ARE NOT APPLIED")
    valid = ~nodata & ~obstacle
    # outlets: valid cells on the raster edge or touching no data
    edge = np.zeros((ny, nx), bool)
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True
    outlet = valid & (edge | ndimage.binary_dilation(nodata, structure=np.ones((3, 3))))
    zf = np.where(valid, z, 0.0)
    return {"z": zf, "valid": valid, "outlet": outlet, "obstacle": obstacle, "nodata": nodata, "nx": nx, "ny": ny, "graded": graded, "obstacles": obstacles, "notes": notes}


def _mask(poly: Polygon, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    b = poly.bounds
    i0, i1 = int(np.searchsorted(xs, b[0] - 1e-9)), int(np.searchsorted(xs, b[2] + 1e-9))
    j0, j1 = int(np.searchsorted(ys, b[1] - 1e-9)), int(np.searchsorted(ys, b[3] + 1e-9))
    m = np.zeros((len(ys), len(xs)), bool)
    if i1 <= i0 or j1 <= j0:
        return m
    X, Y = np.meshgrid(xs[i0:i1], ys[j0:j1])
    m[j0:j1, i0:i1] = shapely.contains_xy(poly, X.ravel(), Y.ravel()).reshape(Y.shape)
    return m


def region_of(lot: Polygon | None, design: SiteDesign | None) -> tuple[float, float, float, float] | None:
    if lot is not None:
        b = lot.bounds
    else:
        pts = [p for o in (design.objects if design else []) if o.accepted != "rejected"
               for p in (o.geometry.pts if o.geometry.kind == "polyline" else o.geometry.ring if o.geometry.kind == "polygon" else [o.geometry.p])]
        if not pts:
            return None
        b = (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))
    return b[0] - MARGIN_M, b[1] - MARGIN_M, b[2] + MARGIN_M, b[3] + MARGIN_M


def analyse(design: SiteDesign | None, terrain: SiteTerrain | None, lot: Polygon | None, rd: Reader, *, cell_m: float = DEFAULT_CELL_M, threshold_m2: float = DEFAULT_THRESHOLD_M2,
            surface: str = "design") -> dict[str, Any]:
    t0 = time.perf_counter()
    deadline = t0 + EL.MAX_OVERLAND_SECONDS
    out: dict[str, Any] = {"schema": "overland_flow.v1", "label": FLOW_LABEL, "status": "NOT EVALUATED", "message": "", "terrain_status": terrain.status if terrain else "NO TERRAIN",
                           "labels": [terrain.status if terrain else "NO TERRAIN", FLOW_LABEL],
                           "parameters": {"cell_m": cell_m, "threshold_m2": threshold_m2, "surface": surface, "depression_min_depth_m": DEPRESSION_MIN_DEPTH_M, "margin_m": MARGIN_M,
                                          "notes": {"cell_m": "COMPUTATION RESOLUTION OF THE RASTER (A PARAMETER OF THIS TOOL)",
                                                    "threshold_m2": "DISPLAY PARAMETER: THE CONTRIBUTING AREA AT WHICH A CELL IS DRAWN AS A FLOW PATH. IT DOES NOT CHANGE THE ACCUMULATION",
                                                    "depression_min_depth_m": "NOISE TOLERANCE ON GROUND LEVELS: A DEPRESSION SHALLOWER THAN THIS IS NOT REPORTED",
                                                    "margin_m": "RASTER MARGIN AROUND THE LOT SO WATER FROM AND TO THE NEIGHBOURS IS ROUTED"}},
                           "grid": None, "depressions": [], "paths": [], "obstacles": [], "graded": [], "notes": [], "timing_ms": 0.0, "missing": [],
                           "closed_basins": [], "closed_basins_total": 0, "enclosed_cells": 0, "enclosed_area_m2": 0.0, "sinks": {"count": 0, "listed": [], "truncated": False}}
    if terrain is None:
        out["message"] = "NOT EVALUATED: THE 3D MODEL HAS NO TERRAIN"
        out["missing"].append({"id": "terrain", "area": "OVERLAND FLOW", "what": "NO TERRAIN IN THE 3D MODEL", "key": None, "how": "Load the site into the 3D model so the existing ground is available."})
        return out
    if surface not in ("design", "existing"):
        raise ValueError("surface must be design or existing")
    region = region_of(lot, design)
    if region is None:
        out["message"] = "NOT EVALUATED: NO LOT BOUNDARY AND NO DESIGN OBJECT TO SET THE EXTENT"
        out["missing"].append({"id": "extent", "area": "OVERLAND FLOW", "what": "NO LOT BOUNDARY AND NO OBJECT", "key": None, "how": "Load the lot boundary or place design objects."})
        return out
    s = build_surface(design, terrain, rd, region, cell_m, surface == "design")
    check_deadline(deadline)
    if not s["valid"].any():
        out["message"] = "NOT EVALUATED: NO EXISTING GROUND UNDER THE EXTENT"
        return out
    weight = np.where(s["valid"], cell_m * cell_m, 0.0)
    sol = solve(s["z"], s["valid"], s["outlet"], weight, cell_m, region[0], region[1], threshold_m2, deadline)
    cb = sol["closed"]
    out.update({"status": "EVALUATED", "grid": {"cell_m": cell_m, "nx": s["nx"], "ny": s["ny"], "cells": s["nx"] * s["ny"], "valid_cells": int(s["valid"].sum()), "origin": [round(region[0], 3), round(region[1], 3)],
                                                "obstacle_cells": int(s["obstacle"].sum()), "no_data_cells": int(s["nodata"].sum())},
                "depressions": sol["depressions"][:EL.MAX_OVERLAND_PONDS], "depressions_total": len(sol["depressions"]), "paths": sol["paths"]["paths"], "paths_truncated": sol["paths"]["truncated"],
                "path_cells": sol["paths"]["cells"], "max_contributing_area_m2": round(float(sol["acc"].max()), 2), "obstacles": s["obstacles"], "graded": s["graded"],
                "closed_basins": cb["basins"], "closed_basins_total": cb["total"], "enclosed_cells": cb["cells"], "enclosed_area_m2": cb["area_m2"],
                "sinks": {"count": cb["sink_count"], "listed": cb["sinks"], "truncated": cb["sinks_truncated"]}})
    notes = list(s["notes"])
    if surface == "existing":
        notes.append("THE EXISTING GROUND ONLY IS USED (NO DESIGN SURFACE, NO OBSTACLE)")
    prov = terrain.provenance or {}
    res = prov.get("resolution") or prov.get("resolution_m")
    notes.append(f"TERRAIN SOURCE RESOLUTION: {str(res).upper() if res else 'NOT STATED'}. A RASTER CELL OF {cell_m:g} M DOES NOT ADD DETAIL THE TERRAIN DOES NOT HAVE")
    notes.append("CONTRIBUTING AREA IS THE AREA OF GROUND THAT DRAINS THROUGH A CELL. NO RAINFALL, RUNOFF COEFFICIENT, ROUGHNESS, DEPTH OR VELOCITY IS USED")
    notes.append("DEPRESSIONS ARE REPORTED AND DRAWN AS PONDING. THE FLOW PATHS CONTINUE ACROSS THEM ON THE CONDITIONED SURFACE")
    if cb["total"]:
        low = min(b["lowest_rl"] for b in cb["basins"])
        notes.append(f"{cb['total']} CLOSED BASIN(S), NO OUTLET, {cb['area_m2']:.1f} M2 IN TOTAL (LOWEST GROUND {low:.3f} RL): WATER THAT REACHES THEM CANNOT LEAVE THE MODEL. THEY ARE ENCLOSED BY BUILDINGS OR RETAINING WALLS, "
                     "SO CHECK FOR A GAP OR PROVIDE AN OVERFLOW PATH. THEY ARE REPORTED WITH THEIR D8 SINKS AND ARE NOT FILLED")
    if cb["sink_count"]:
        notes.append(f"{cb['sink_count']} D8 SINK(S) FOUND (CELLS WITH NO LOWER NEIGHBOUR THAT ARE NOT AN OUTLET)" + (f"; THE {len(cb['sinks'])} WITH THE LARGEST CONTRIBUTING AREA ARE LISTED" if cb["sinks_truncated"] else " AND LISTED"))
    if sol["paths"]["truncated"]:
        notes.append(f"ONLY THE {len(sol['paths']['paths'])} LONGEST FLOW PATHS ARE RETURNED (CAP OF THIS TOOL). RAISE THE THRESHOLD TO SEE FEWER, LARGER PATHS")
    if len(sol["depressions"]) > EL.MAX_OVERLAND_PONDS:
        notes.append(f"{len(sol['depressions'])} DEPRESSIONS WERE FOUND; THE {EL.MAX_OVERLAND_PONDS} LARGEST BY VOLUME ARE RETURNED")
    out["notes"] = notes
    out["timing_ms"] = round((time.perf_counter() - t0) * 1000, 1)
    return out
