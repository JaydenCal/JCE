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
    """Piecewise linear level along the chainage, extended past both ends at the end-segment grades. Accepts a float or an array."""
    s = np.array([p[0] for p in st]); z = np.array([p[1] for p in st])
    g0 = (z[1] - z[0]) / (s[1] - s[0]); g1 = (z[-1] - z[-2]) / (s[-1] - s[-2])

    def f(x):
        xa = np.asarray(x, float)
        out = np.where(xa < s[0], z[0] + g0 * (xa - s[0]), np.where(xa > s[-1], z[-1] + g1 * (xa - s[-1]), np.interp(xa, s, z)))
        return float(out) if np.ndim(x) == 0 else out
    return f


def scraping_margin(z: Callable[[float], float], s_lo: float, s_hi: float, tpl=B85_TEMPLATE, step: float = 0.05, max_span_m: float | None = None) -> float:
    """Min vertical gap (m) between the vehicle underbody line and ground, minus nothing: >=0 means no scrape.
    Axles ride on the ground; underbody = axle chord + clearance (mid) / overhang clearance outside the axles.
    Runs the vehicle forward and (mirrored) in reverse.

    Vectorised over the rear axle position and the body points (same positions, same arithmetic as the scalar loops it replaced, so the
    result is identical); ``z`` must accept an array. The live driveway tool calls this on every drag, so it has to be fast.

    ``max_span_m`` (optional) refuses a span longer than that with ValueError BEFORE any array is built: the work and the memory grow with the span
    (``step`` positions times ~50 body points), so a caller that takes the span from user input must give it."""
    if max_span_m is not None and not (s_hi - s_lo) <= max_span_m:
        raise ValueError(f"profile span {s_hi - s_lo:g} m is longer than the {max_span_m:g} m limit")
    wb, fo, ro = tpl["wheelbase"], tpl["front_oh"], tpl["rear_oh"]
    worst = math.inf
    for flip in (False, True):
        zz = (lambda x: z(-x)) if flip else z
        lo, hi = (-s_hi, -s_lo) if flip else (s_lo, s_hi)
        sr = np.arange(lo - fo, hi + ro, step)                                   # rear axle position
        if not len(sr):
            continue
        nx = len(np.arange(sr[0] - ro, sr[0] + wb + fo + 1e-9, 0.1))             # body points per position (the same count for every position)
        x = (sr - ro)[:, None] + 0.1 * np.arange(nx)[None, :]
        zr, zf = np.asarray(zz(sr), float)[:, None], np.asarray(zz(sr + wb), float)[:, None]
        c = np.where((sr[:, None] <= x) & (x <= sr[:, None] + wb), tpl["clear_mid"], tpl["clear_oh"])
        body = zr + (zf - zr) * (x - sr[:, None]) / wb + c
        worst = min(worst, float(np.min(body - np.asarray(zz(x), float))))
    return float(worst)


def check_profile(stations: list[tuple[float, float, str]], std: CouncilDrivewayStandard = DEFAULT_STANDARD,
                  transition_len_m: float | None = None, strict: bool = False, max_span_m: float | None = None) -> list[CheckItem]:
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
    margin = scraping_margin(_interp(st), st[0][0], st[-1][0], max_span_m=max_span_m)
    items.append(CheckItem(name="b85_scraping_clearance", passed=margin >= 0, value=round(margin, 3), limit=0.0, unit="m",
                           note="B85 template, forward and reverse; min underbody-to-ground gap (negative = scrape). Not certification."))
    return items
