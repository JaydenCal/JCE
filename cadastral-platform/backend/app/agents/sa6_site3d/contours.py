"""Contour interval chosen from the data resolution (stage 3, owner decision C).

The interval is a DISPLAY choice that avoids implying more vertical detail than the ground data supports.  It is not a council, design or
survey requirement and is never presented as one (the basis text says so).

Rule: one quarter of the data resolution, rounded to the nearest standard step (0.1, 0.25, 0.5, 1, 2, 5 m, compared on a log scale).
  0.5 m LiDAR -> 0.1 m,  1 m LiDAR -> 0.25 m,  2 m -> 0.5 m,  5 m DEM -> 1 m.
If that would draw more than ``max_lines`` contours over the relief, the next standard step up is used.
Major contours: every 5th line at 0.1 m, 4th at 0.25 m (1 m), 2nd at 0.5 m (1 m), 5th at 1 m, 5th at 2 m, 2nd at 5 m (10 m).
"""
from __future__ import annotations

import math
from dataclasses import dataclass

STEPS = (0.1, 0.25, 0.5, 1.0, 2.0, 5.0)
MAJOR_EVERY = {0.1: 5, 0.25: 4, 0.5: 2, 1.0: 5, 2.0: 5, 5.0: 2}
DEFAULT_INTERVAL = 0.5


@dataclass(frozen=True)
class ContourPlan:
    interval_m: float
    major_every: int
    basis: str


def contour_plan(resolution_m: float | None, relief_m: float | None = None, max_lines: int = 60, resolution_basis: str = "data resolution") -> ContourPlan:
    if not resolution_m or resolution_m <= 0:
        iv = DEFAULT_INTERVAL
        basis = (f"Contour interval {iv:g} m is the platform display default because the data resolution is not stated. "
                 "It is a display choice, not a requirement.")
    else:
        raw = resolution_m / 4.0
        iv = min(STEPS, key=lambda s: abs(math.log(s / raw)))
        basis = (f"Contour interval {iv:g} m: one quarter of the {resolution_m:g} m {resolution_basis}, rounded to the nearest standard step "
                 "(0.1, 0.25, 0.5, 1, 2, 5 m), so that the lines do not imply more vertical detail than the data supports. "
                 "It is a display choice, not a requirement.")
    if relief_m is not None and relief_m / iv > max_lines:
        bigger = [s for s in STEPS if s > iv and relief_m / s <= max_lines] or [STEPS[-1]]
        iv = bigger[0]
        basis += f" Increased to {iv:g} m because the relief of {relief_m:.1f} m would otherwise draw more than {max_lines} lines."
    return ContourPlan(iv, MAJOR_EVERY[iv], basis)
