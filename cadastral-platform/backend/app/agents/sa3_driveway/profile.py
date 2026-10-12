"""Longitudinal profile checks (grade, change of grade, B85 scraping by the ramp-grade-change template method).

Chainage s increases from the road toward the garage; grade = +ve rising in that direction. All limits are
parameters flagged VERIFY against AS/NZS 2890.1 (Cl 2.5.3 / Fig 2.?) and the council standard.
"""
from __future__ import annotations

import math
from typing import Callable

import numpy as np

from .models import CheckItem, CouncilDrivewayStandard, DEFAULT_STANDARD

SUMMIT_MAX_CHANGE_PCT = 12.5   # VERIFY: max grade change without transition, summit (crest) over TRANSITION_M
SAG_MAX_CHANGE_PCT = 15.0      # VERIFY: sag (dip)
TRANSITION_M = 2.0             # VERIFY: transition length the above limits are quoted over
B85_TEMPLATE = dict(wheelbase=2.8, front_oh=0.94, rear_oh=1.17, clear_mid=0.10, clear_oh=0.10)  # VERIFY


def build_stations(levels: dict[str, float], verge_m: float, garage_dist_m: float, gutter_w: float = 0.45,
                   sampler: Callable[[float, float], float] | None = None, xy_at: Callable[[float], tuple[float, float]] | None = None
                   ) -> list[tuple[float, float, str]]:
    """Stations (s, z, label): gutter (s=-gutter_w), kerb (0), boundary (verge), garage (verge+depth)."""
    spec = [("gutter", -gutter_w), ("kerb", 0.0), ("boundary", verge_m), ("garage", verge_m + garage_dist_m)]
    out = []
    for name, s in spec:
        z = levels.get(name)
        if z is None and sampler and xy_at:
            z = sampler(*xy_at(s))
        if z is not None:
            out.append((s, float(z), name))
    return out


def min_transition_length(delta_pct: float, kind: str) -> float:
    """Min transition (vertical curve) length so grade change per metre stays within the template rate."""
    lim = SUMMIT_MAX_CHANGE_PCT if kind == "summit" else SAG_MAX_CHANGE_PCT
    return max(TRANSITION_M, abs(delta_pct) / (lim / TRANSITION_M))


def vertical_curve_length(delta_pct: float, kind: str) -> float:
    return min_transition_length(delta_pct, kind)   # parabolic curve length L = A / (rate per m)


def _interp(st: list[tuple[float, float, str]]) -> Callable[[float], float]:
    s = np.array([p[0] for p in st]); z = np.array([p[1] for p in st])
    g0 = (z[1] - z[0]) / (s[1] - s[0]); g1 = (z[-1] - z[-2]) / (s[-1] - s[-2])

    def f(x: float) -> float:
        if x < s[0]:
            return float(z[0] + g0 * (x - s[0]))
        if x > s[-1]:
            return float(z[-1] + g1 * (x - s[-1]))
        return float(np.interp(x, s, z))
    return f


def scraping_margin(z: Callable[[float], float], s_lo: float, s_hi: float, tpl=B85_TEMPLATE, step: float = 0.05) -> float:
    """Min vertical gap (m) between the vehicle underbody line and ground, minus nothing: >=0 means no scrape.
    Axles ride on the ground; underbody = axle chord + clearance (mid) / overhang clearance outside the axles.
    Runs the vehicle forward and (mirrored) in reverse."""
    wb, fo, ro = tpl["wheelbase"], tpl["front_oh"], tpl["rear_oh"]
    worst = math.inf
    for flip in (False, True):
        zz = (lambda x: z(-x)) if flip else z
        lo, hi = (-s_hi, -s_lo) if flip else (s_lo, s_hi)
        for sr in np.arange(lo - fo, hi + ro, step):          # rear axle position
            zr, zf = zz(sr), zz(sr + wb)
            for x in np.arange(sr - ro, sr + wb + fo + 1e-9, 0.1):
                c = tpl["clear_mid"] if sr <= x <= sr + wb else tpl["clear_oh"]
                body = zr + (zf - zr) * (x - sr) / wb + c
                worst = min(worst, body - zz(x))
    return float(worst)


def check_profile(stations: list[tuple[float, float, str]], std: CouncilDrivewayStandard = DEFAULT_STANDARD,
                  transition_len_m: float | None = None, strict: bool = False) -> list[CheckItem]:
    items: list[CheckItem] = []
    if len(stations) < 2:
        return [CheckItem(name="profile", passed=None, note="insufficient levels supplied; profile not checked")]
    st = sorted(stations)
    grades = [100 * (b[1] - a[1]) / (b[0] - a[0]) for a, b in zip(st, st[1:])]
    mg = max(abs(g) for g in grades)
    items.append(CheckItem(name="max_grade", passed=None if std.max_grade_pct is None else mg <= std.max_grade_pct + 1e-9, value=round(mg, 2),
                           limit=std.max_grade_pct, unit="%",
                           note=f"grades by section: {[round(g, 2) for g in grades]}" + ("; max grade requirement UNRESOLVED" if std.max_grade_pct is None else "")))
    for i in range(1, len(st) - 1):
        d = grades[i] - grades[i - 1]
        kind = "summit" if d < 0 else "sag"
        if strict and std.max_change_of_grade_pct is None:
            items.append(CheckItem(name=f"change_of_grade@{st[i][2]}", passed=None, value=round(abs(d), 2),
                                   note="max change-of-grade requirement UNRESOLVED; not checked"))
            continue
        lim = std.max_change_of_grade_pct or (SUMMIT_MAX_CHANGE_PCT if kind == "summit" else SAG_MAX_CHANGE_PCT)
        need = min_transition_length(d, kind)
        ok = abs(d) <= lim + 1e-9
        note = f"{kind} at {st[i][2]}; min transition/vertical curve {need:.1f} m (limit quoted over {TRANSITION_M} m)"
        if transition_len_m is not None and abs(d) > lim:
            ok = need <= transition_len_m + 1e-9
            note += f"; provided {transition_len_m:.1f} m"
        items.append(CheckItem(name=f"change_of_grade@{st[i][2]}", passed=ok, value=round(abs(d), 2), limit=lim, unit="%", note=note))
    margin = scraping_margin(_interp(st), st[0][0], st[-1][0])
    items.append(CheckItem(name="b85_scraping_clearance", passed=margin >= 0, value=round(margin, 3), limit=0.0, unit="m",
                           note="B85 template, forward and reverse; min underbody-to-ground gap (negative = scrape). Not certification."))
    return items
