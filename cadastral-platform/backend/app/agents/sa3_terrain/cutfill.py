"""Prismoidal cut/fill between an existing TIN and a proposed surface (pad+batters or TIN)."""
from __future__ import annotations

from typing import Callable

import numpy as np
import shapely
from shapely.geometry import Polygon

from .models import CutFillOut, ZoneOut
from .tin import Tin, densify


def _pos_integral(d: np.ndarray, A: np.ndarray) -> np.ndarray:
    """Integral of max(f,0) over triangles, f linear with vertex values d (n,3), areas A."""
    d = np.sort(d, axis=1)
    d0, d1, d2 = d[:, 0], d[:, 1], d[:, 2]
    S = d0 + d1 + d2
    out = np.zeros(len(d))
    allpos = d0 >= 0
    out[allpos] = A[allpos] * S[allpos] / 3
    m = (~allpos) & (d1 >= 0)          # one negative corner
    f = (d0[m] / (d0[m] - d1[m])) * (d0[m] / (d0[m] - d2[m] + 1e-300))
    out[m] = A[m] * S[m] / 3 - f * A[m] * d0[m] / 3
    m = (d1 < 0) & (d2 > 0)            # one positive corner
    f = (d2[m] / (d2[m] - d0[m])) * (d2[m] / (d2[m] - d1[m]))
    out[m] = f * A[m] * d2[m] / 3
    return out


def _ring_points(ring, spacing: float) -> np.ndarray:
    """Points every ``spacing`` metres along a ring (vectorised; the same points the per-point ``interpolate`` loop gave)."""
    return shapely.get_coordinates(shapely.line_interpolate_point(ring, np.arange(0, ring.length, spacing)))


def pad_surface(existing: Tin, footprint: Polygon, pad: float, cut_h: float = 2.0, fill_h: float = 3.0) -> Callable:
    """Proposed z = clip(existing, pad - d/fill_h, pad + d/cut_h), d = distance to footprint."""
    def f(x, y):
        x = np.asarray(x, float); y = np.asarray(y, float)
        d = shapely.distance(footprint, shapely.points(x.ravel(), y.ravel())).reshape(x.shape)
        ze = existing.z_at(x, y)
        return np.clip(ze, pad - d / fill_h, pad + d / cut_h)
    return f


def cut_fill(existing: Tin, proposed: Callable | Tin, region: Polygon | None = None, spacing: float | None = None,
             footprint: Polygon | None = None, accuracy_m: float = 0.1, topsoil_depth: float = 0.15,
             bulking: float = 1.25, shrinkage: float = 0.90, pad_level: float | None = None,
             bands=(0.1, 0.5, 1.0, 2.0, 1e9)) -> CutFillOut:
    zp_fn = proposed.z_at if isinstance(proposed, Tin) else proposed
    pts = [existing.vertices[:, :2]]
    if isinstance(proposed, Tin):
        pts.append(proposed.vertices[:, :2])
    ext = existing.vertices[:, :2]
    bb = (ext.min(0), ext.max(0))
    area_bb = np.prod(bb[1] - bb[0])
    h = spacing or max(1.0, float(np.sqrt(area_bb / 40000)))
    gx, gy = np.meshgrid(np.arange(bb[0][0], bb[1][0] + h, h), np.arange(bb[0][1], bb[1][1] + h, h))
    pts.append(np.column_stack([gx.ravel(), gy.ravel()]))
    for g in (footprint, region):
        if g is not None:
            pts.append(_ring_points(g.exterior, h / 2))
    if footprint is not None:
        for k in range(1, 13):
            pts.append(_ring_points(footprint.buffer(k * h, join_style=2).exterior, h))
    P = np.unique(np.round(np.vstack(pts), 6), axis=0)
    from scipy.spatial import Delaunay
    tri = Delaunay(P).simplices
    ze, zp = existing.z_at(P[:, 0], P[:, 1]), zp_fn(P[:, 0], P[:, 1])
    dv = zp - ze
    cen = P[tri].mean(1)
    ok = np.isfinite(dv[tri]).all(1)
    ok &= ~np.isnan(existing.z_at(cen[:, 0], cen[:, 1]))
    if region is not None:
        ok &= shapely.contains_xy(region, cen[:, 0], cen[:, 1])
    tri = tri[ok]
    xy = P[tri]
    A = 0.5 * np.abs((xy[:, 1, 0] - xy[:, 0, 0]) * (xy[:, 2, 1] - xy[:, 0, 1]) - (xy[:, 2, 0] - xy[:, 0, 0]) * (xy[:, 1, 1] - xy[:, 0, 1]))
    d3 = dv[tri]
    fill = _pos_integral(d3, A)
    cut = _pos_integral(-d3, A)
    # areas of cut/fill and disturbed ground
    mean_d = d3.mean(1)
    cut_a, fill_a = float(A[mean_d < -1e-3].sum()), float(A[mean_d > 1e-3].sum())
    dist_a = float(A[np.abs(d3).max(1) > 1e-3].sum())
    C, F = float(cut.sum()), float(fill.sum())
    unc = dist_a * accuracy_m
    zones = []
    cen_t = xy.mean(1)
    for kind, sign in (("cut", -1), ("fill", 1)):
        dep = sign * mean_d
        lo = 0.0
        for hi in bands:
            m = (dep > max(lo, 1e-3)) & (dep <= hi)
            if m.any():
                u = shapely.union_all(shapely.polygons(xy[m]))
                zones.append(ZoneOut(kind=kind, min_depth_m=lo, max_depth_m=min(hi, 99.0),
                                     area_m2=float(A[m].sum()), wkt=u.wkt))
            lo = hi
    fbe = F / shrinkage
    return CutFillOut(
        pad_level_m=pad_level, cut_volume_m3=C, fill_volume_m3=F, net_volume_m3=C - F,
        cut_area_m2=cut_a, fill_area_m2=fill_a, topsoil_strip_m3=topsoil_depth * dist_a,
        topsoil_area_m2=dist_a, cut_loose_m3=C * bulking, fill_bank_equivalent_m3=fbe,
        net_bank_after_shrinkage_m3=C - fbe, bulking_factor=bulking, shrinkage_factor=shrinkage,
        volume_uncertainty_m3=unc, stated_uncertainty_pct=100 * unc / max(C + F, 1e-9), zones=zones)
