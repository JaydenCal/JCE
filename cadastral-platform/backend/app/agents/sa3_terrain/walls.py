"""Retaining wall location and indicative (NOT structural) Rankine/Coulomb screening."""
from __future__ import annotations

import math
from itertools import groupby

import numpy as np
from shapely.geometry import Polygon

from .models import WallAssumptions, WallSegment, WallsOut
from .tin import Tin


def coulomb_ka(phi_deg: float, delta_deg: float) -> float:
    """Coulomb Ka, vertical back face, horizontal backfill."""
    p, d = math.radians(phi_deg), math.radians(delta_deg)
    return math.cos(p) ** 2 / (math.cos(d) * (1 + math.sqrt(math.sin(p + d) * math.sin(p) / math.cos(d))) ** 2)


def rankine_ka(phi_deg: float) -> float:
    return math.tan(math.radians(45 - phi_deg / 2)) ** 2


def suggest_type(h: float) -> str:
    if h <= 0.6:
        return "landscape sleeper / dry-stack block (non-structural, <=0.6 m)"
    if h <= 1.0:
        return "segmental block gravity wall"
    if h <= 1.5:
        return "reinforced masonry / engineered sleeper-post wall"
    if h <= 3.0:
        return "cantilever reinforced concrete or reinforced block wall"
    return "piled / anchored engineered wall"


def screen(h: float, a: WallAssumptions) -> tuple[float, float, float, float]:
    """(Ka, Pa kN/m, FS sliding, FS overturning) for a gravity wall of width ratio*H."""
    ka = coulomb_ka(a.phi_deg, a.phi_deg * a.wall_friction_ratio)
    delta = math.radians(a.phi_deg * a.wall_friction_ratio)
    pa = 0.5 * ka * a.unit_weight_kn_m3 * h * h + ka * a.surcharge_kpa * h
    ph = pa * math.cos(delta)   # vertical component ignored (conservative)
    W = a.wall_unit_weight_kn_m3 * a.gravity_wall_width_ratio * h * h
    mu = math.tan(math.radians(a.phi_deg * a.wall_friction_ratio))
    mo = ph * h / 3 + (ka * a.surcharge_kpa * h * math.cos(delta)) * h / 6
    return ka, pa, W * mu / ph, W * a.gravity_wall_width_ratio * h / 2 / mo


def find_walls(existing: Tin, footprint: Polygon, pad: float, threshold: float = 0.5,
               spacing: float = 1.0, a: WallAssumptions | None = None) -> WallsOut:
    if a is None:       # the legacy SA3 path: the model defaults are PLACEHOLDERS and the output says so (the 3D site tool never takes this path, see app.design.wall_screening)
        a = WallAssumptions(note="PLACEHOLDER, NOT A REQUIREMENT: soil, factors of safety and the 1.0 m certification height are platform placeholders. " + WallAssumptions().note)
    ring = footprint.exterior
    n = max(int(ring.length / spacing), 4)
    xy = np.array([ring.interpolate(s).coords[0] for s in np.linspace(0, ring.length, n, endpoint=False)])
    hgt = existing.z_at(xy[:, 0], xy[:, 1]) - pad          # +ve cut face, -ve fill face
    hgt = np.nan_to_num(hgt, nan=0.0)
    s = np.where(np.abs(hgt) > threshold, np.sign(hgt), 0).astype(int)
    if s.any() and s[0] != 0 and s[0] == s[-1]:
        ch = np.nonzero(s != np.roll(s, 1))[0]
        if len(ch):
            k = ch[0]
            xy, hgt, s = np.roll(xy, -k, 0), np.roll(hgt, -k), np.roll(s, -k)
    segs, i = [], 0
    for key, g in groupby(s):
        m = len(list(g))
        if key != 0:
            idx = slice(i, i + m)
            hh = np.abs(hgt[idx]); mh = float(hh.max())
            al = [(float(x), float(y)) for x, y in xy[idx]]
            ka, pa, fss, fso = screen(mh, a)
            segs.append(WallSegment(
                mode="cut" if key > 0 else "fill", length_m=float(m * ring.length / n), max_height_m=mh,
                alignment=al, suggested_type=suggest_type(mh), ka=ka, active_force_kn_per_m=pa,
                fs_sliding=fss, fs_overturning=fso,
                screening_ok=fss >= a.min_fs_sliding and fso >= a.min_fs_overturning,
                engineer_certification_required=mh > 1.0))
        i += m
    mx = max((w.max_height_m for w in segs), default=0.0)
    return WallsOut(segments=segs, max_retained_height_m=mx, total_length_m=sum(w.length_m for w in segs),
                    engineer_certification_required=mx > 1.0, assumptions=a)
