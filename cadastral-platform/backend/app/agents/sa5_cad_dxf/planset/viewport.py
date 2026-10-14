"""View planning for the reference-style plan sheets: the scale chooser (prefers 1:100) and view rotation.

Scale rule (owner): plan sheets are drawn at 1:100.  The chooser steps to 1:200, 1:250 ... only when the subject (lot plus the required driveway,
crossover and road frontage) cannot fit the viewport at 1:100, and it says why on the sheet.  Before it gives up 1:100 it tries to ROTATE the
view so the long axis of the lot runs along the sheet (the lot frontage squared to the sheet); the north point is then drawn rotated and labelled.

Twist convention: ``twist`` is the counter-clockwise rotation of the model drawing on the sheet, in degrees (0 = north up).  North therefore
points ``twist`` degrees counter-clockwise from the top of the sheet.  DXF viewport twist angle (VIEWTWIST) uses the same sign.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from shapely import affinity
from shapely.geometry import Polygon

from app.agents.sa5_cad_dxf.planset.core import STD_SCALES

PREFERRED_SCALE = 100
MIN_TWIST_TO_TRY = 3.0          # degrees: a lot already within this of square to the sheet is not rotated


@dataclass(frozen=True)
class ViewChoice:
    scale: int
    twist: float                # degrees counter-clockwise (0 = north up)
    rect: tuple                 # the fit rectangle (paper mm) the subject was fitted into
    reason: str = ""            # printed on the sheet when the scale is not the preferred one
    rot_note: str = ""          # printed on the sheet when the view is rotated
    fitted: bool = True         # False when nothing fitted and the smallest drawing scale was used

    @property
    def notes(self) -> list[str]:
        return [x for x in (self.reason, self.rot_note) if x]


def long_axis_deg(poly: Polygon) -> float:
    """Direction (degrees, model frame, 0 to 180) of the long side of the minimum rotated rectangle of ``poly``."""
    m = list(poly.minimum_rotated_rectangle.exterior.coords)
    e1, e2 = (m[1][0] - m[0][0], m[1][1] - m[0][1]), (m[2][0] - m[1][0], m[2][1] - m[1][1])
    ax = e1 if math.hypot(*e1) >= math.hypot(*e2) else e2
    return math.degrees(math.atan2(ax[1], ax[0])) % 180.0


def aligned_twists(poly: Polygon) -> list[float]:
    """Twists (counter-clockwise, degrees) that lay the long axis of ``poly`` along the sheet's long direction: the smaller turn first, then its reverse."""
    t = -long_axis_deg(poly)
    t = (t + 90.0) % 180.0 - 90.0                       # (-90, 90]
    if t == -90.0:
        t = 90.0
    return [t, t + 180.0 if t <= 0 else t - 180.0]


def rotated_bounds(g, twist: float) -> tuple:
    return (affinity.rotate(g, twist, origin=(0.0, 0.0)) if twist else g).bounds


def fits(g, twist: float, scale: int, rect: tuple, margin_mm: float) -> bool:
    b = rotated_bounds(g, twist)
    return ((b[2] - b[0]) * 1000.0 / scale + 2 * margin_mm <= rect[2] - rect[0]) and ((b[3] - b[1]) * 1000.0 / scale + 2 * margin_mm <= rect[3] - rect[1])


def rot_note(twist: float, scale: int) -> str:
    return (f"VIEW ROTATED {abs(twist):.0f} DEG {'ANTICLOCKWISE' if twist > 0 else 'CLOCKWISE'} TO SQUARE THE LOT FRONTAGE TO THE SHEET"
            f"{f' SO THE SUBJECT FITS AT 1:{scale}' if scale <= PREFERRED_SCALE else ''}. NORTH POINT SHOWN")


def baseline_twist(subject, align_poly: Polygon | None, rect: tuple, margin_mm: float, min_scale: int = PREFERRED_SCALE) -> float:
    """The twist the whole set uses: 0 when the subject fits north-up at the preferred scale, else the aligned twist if that makes it fit,
    else 0 (rotation only ever buys a larger drawing scale)."""
    if fits(subject, 0.0, PREFERRED_SCALE, rect, margin_mm) or align_poly is None:
        return 0.0
    for t in aligned_twists(align_poly):
        if abs(t) > MIN_TWIST_TO_TRY and fits(subject, t, PREFERRED_SCALE, rect, margin_mm):
            return t
    return 0.0


def choose_view(subject, rects, margin_mm: float, *, min_scale: int = PREFERRED_SCALE, align_poly: Polygon | None = None, prefer_twist: float = 0.0,
                allow_rotation: bool = True) -> ViewChoice:
    """Largest drawing (smallest denominator >= ``min_scale``) at which ``subject`` fits one of ``rects`` with ``margin_mm`` of paper around it.
    For each scale the unrotated view is tried, then ``prefer_twist``, then the twists that align ``align_poly`` with the sheet, so 1:100 is given up
    only when no rotation fits either."""
    cands: list[float] = [prefer_twist]
    if 0.0 not in cands:
        cands.append(0.0)
    if allow_rotation and align_poly is not None:
        for t in aligned_twists(align_poly):
            if abs(t) > MIN_TWIST_TO_TRY and all(abs(t - c) > 0.01 for c in cands):
                cands.append(t)
    for sc in (x for x in STD_SCALES if x >= min_scale):
        for t in cands:
            for r in rects:
                if fits(subject, t, sc, r, margin_mm):
                    reason = f"SCALE 1:{sc} CHOSEN: LOT EXTENT EXCEEDS 1:100 VIEWPORT" if sc > PREFERRED_SCALE and min_scale <= PREFERRED_SCALE else ""
                    return ViewChoice(sc, t, r, reason, rot_note(t, sc) if abs(t) > 0.01 else "")
    return ViewChoice(STD_SCALES[-1], 0.0, rects[0], f"SCALE 1:{STD_SCALES[-1]} CHOSEN: SUBJECT DOES NOT FIT ANY STANDARD SCALE", "", False)


def centre_for(subject, twist: float, scale: int, vx: float, vy: float, fx: float, fy: float) -> tuple[float, float]:
    """Model point to put at the viewport centre (vx, vy) so the centre of ``subject``'s rotated bounds lands on the paper point (fx, fy)."""
    b = rotated_bounds(subject, twist)
    rx, ry = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2                     # centre of the rotated bounds, in the rotated frame
    a = math.radians(-twist)                                            # rotate it back into the model frame
    mx, my = rx * math.cos(a) - ry * math.sin(a), rx * math.sin(a) + ry * math.cos(a)
    k = 1000.0 / scale
    c, s = math.cos(math.radians(twist)), math.sin(math.radians(twist))
    dx, dy = fx - vx, fy - vy
    return (mx - (dx * c + dy * s) / k, my - (-dx * s + dy * c) / k)
