"""Proper linear dimension (reference style): extension lines, filled arrowheads, text above the dimension line, upright reading.

Works in PAPER mm on any View.  ``a`` and ``b`` are the measured feature points in paper mm (use ``view.tp`` for model points).  When the line is
too short for inside arrows the arrows flip outside with tails and the text moves beyond the end, so a short dimension is still readable.

``dim_linear(..., dry=True)`` only measures (returns the paper bounding box); ``dim_best`` tries several offsets and sides and draws the first
one whose text box and dimension line are clear of earlier labels, hatch and each other (the label collision pass for dimensions).
"""
from __future__ import annotations

import math

from shapely.geometry import LineString

from app.agents.sa5_cad_dxf.planset import fonts
from app.agents.sa5_cad_dxf.planset.core import View, upright
from app.agents.sa5_cad_dxf.planset.style import BLACK, WHITE, Paper

ARROW_LEN, ARROW_HALF = 2.4, 0.55


def dim_linear(v: View, a, b, text: str, off_mm: float = 6.0, side=None, h: float = 2.5, layer: str = "C-ANNO-DIMS", color=BLACK,
               mask: bool = True, reserve: bool = True, min_len: float = 0.8, dry: bool = False, tfrac: float = 0.5) -> tuple | None:
    """Draw a dimension between paper points ``a`` and ``b``.  The dimension line is ``off_mm`` from the feature along the normal that points
    toward ``side`` (a paper vector); returns the paper bounding box, or None when the measured length is below ``min_len`` mm.
    ``dry``: measure only, draw nothing.  ``tfrac``: where along the line the text sits (0.5 = middle)."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dy)
    if L < min_len:
        return None
    ux, uy = dx / L, dy / L
    nx, ny = -uy, ux
    if side is not None and nx * side[0] + ny * side[1] < 0:
        nx, ny = -nx, -ny
    sg = 1.0 if off_mm >= 0 else -1.0
    off = abs(off_mm)
    q1, q2 = (a[0] + nx * off * sg, a[1] + ny * off * sg), (b[0] + nx * off * sg, b[1] + ny * off * sg)
    inside = L >= 2 * ARROW_LEN + 1.0
    tail = 0.0 if inside else ARROW_LEN + 2.5
    ang = upright(math.degrees(math.atan2(uy, ux)))
    ra = math.radians(ang)
    tnx, tny = -math.sin(ra), math.cos(ra)                             # upward-reading normal of the text
    tw = fonts.text_width(text, h)
    mx, my = q1[0] + (q2[0] - q1[0]) * tfrac, q1[1] + (q2[1] - q1[1]) * tfrac
    if tw + 2 * ARROW_LEN + 2 > L:                                     # (the text is then no longer centred on the line)                                     # text does not fit between the arrows: put it beyond the right-hand end (reading direction)
        e = (q2 if (ux * math.cos(ra) + uy * math.sin(ra)) > 0 else q1)
        sgn_e = 1.0 if e is q2 else -1.0
        mx, my = e[0] + ux * sgn_e * (tail + 2.0 + tw / 2), e[1] + uy * sgn_e * (tail + 2.0 + tw / 2)
    tx, ty = mx + tnx * (h * 0.75 + 0.4), my + tny * (h * 0.75 + 0.4)
    ex = abs(math.cos(ra)) * tw / 2 + abs(math.sin(ra)) * h / 2         # half extents of the rotated text box
    ey = abs(math.sin(ra)) * tw / 2 + abs(math.cos(ra)) * h / 2
    xs = [q1[0], q2[0], a[0], b[0], tx - ex, tx + ex]
    ys = [q1[1], q2[1], a[1], b[1], ty - ey, ty + ey]
    box = (min(xs) - 1, min(ys) - 1, max(xs) + 1, max(ys) + 1)
    if dry:
        return box
    v.dim_lines.append(((q1[0] - ux * tail, q1[1] - uy * tail), (q2[0] + ux * tail, q2[1] + uy * tail)))
    P = Paper(v)
    for p, q in ((a, q1), (b, q2)):                                  # extension lines: a small gap off the feature, a little past the dimension line
        P.line([(p[0] + nx * sg * 1.0, p[1] + ny * sg * 1.0), (q[0] + nx * sg * 1.8, q[1] + ny * sg * 1.8)], layer, 0.13, color)
    P.line([(q1[0] - ux * tail, q1[1] - uy * tail), (q2[0] + ux * tail, q2[1] + uy * tail)], layer, 0.18, color)
    for q, d in ((q1, 1.0), (q2, -1.0)):                              # d = direction the arrow tip points along the line, toward the outside end when flipped
        sgn = d if inside else -d
        base = (q[0] + ux * sgn * ARROW_LEN, q[1] + uy * sgn * ARROW_LEN)
        P.poly([q, (base[0] - uy * ARROW_HALF, base[1] + ux * ARROW_HALF), (base[0] + uy * ARROW_HALF, base[1] - ux * ARROW_HALF)], layer, color)
    if mask:
        v._mask(tx, ty, tw + 1.2, h + 0.8, ang, layer)
    P.text(tx, ty, text, h, "MIDDLE_CENTER", ang, color=color, layer=layer)
    if reserve:
        v.occ.append(box)
        v.tbox.append((tx - ex - 0.3, ty - ey - 0.3, tx + ex + 0.3, ty + ey + 0.3))
    return box


def _line_clear(v: View, a, b, avoid) -> bool:
    return not avoid or not any(g.intersects(LineString([a, b])) for g in avoid)


def same_line(p, q, r, s, lat_mm: float = 1.5, angle_deg: float = 3.0, gap_mm: float = 1.0) -> bool:
    """True when segment p-q and segment r-s are parallel, within ``lat_mm`` of each other across the line and overlap along it (or touch within
    ``gap_mm``): two dimension lines that would print on top of each other or end to end on one line."""
    ux, uy = q[0] - p[0], q[1] - p[1]
    L = math.hypot(ux, uy)
    wx, wy = s[0] - r[0], s[1] - r[1]
    M = math.hypot(wx, wy)
    if L < 1e-6 or M < 1e-6:
        return False
    ux, uy, wx, wy = ux / L, uy / L, wx / M, wy / M
    if abs(ux * wy - uy * wx) > math.sin(math.radians(angle_deg)):
        return False
    lat = abs((r[0] - p[0]) * (-uy) + (r[1] - p[1]) * ux)
    if lat > lat_mm:
        return False
    t0, t1 = (r[0] - p[0]) * ux + (r[1] - p[1]) * uy, (s[0] - p[0]) * ux + (s[1] - p[1]) * uy
    lo, hi = min(t0, t1), max(t0, t1)
    return hi >= -gap_mm and lo <= L + gap_mm


def _text_box(q1, q2, text: str, h: float, tfrac: float) -> tuple:
    """Rough paper polygon of the dimension text (axis along the line, above it), for the avoid-line test."""
    dx, dy = q2[0] - q1[0], q2[1] - q1[1]
    L = math.hypot(dx, dy) or 1.0
    ux, uy = dx / L, dy / L
    tw = fonts.text_width(text, h)
    cx, cy = q1[0] + dx * tfrac, q1[1] + dy * tfrac
    nx, ny = -uy, ux
    hw, hh = tw / 2 + 0.6, h * 1.1
    from shapely.geometry import Polygon
    return Polygon([(cx - ux * hw - nx * hh, cy - uy * hw - ny * hh), (cx + ux * hw - nx * hh, cy + uy * hw - ny * hh),
                    (cx + ux * hw + nx * hh, cy + uy * hw + ny * hh), (cx - ux * hw + nx * hh, cy - uy * hw + ny * hh)])


def dim_best(v: View, a, b, text: str, offsets=(6.0, 10.0, 14.0), sides=(None,), h: float = 2.5, avoid=(), layer: str = "C-ANNO-DIMS", min_len: float = 0.8) -> tuple | None:
    """Draw ``text`` as a dimension at the first (side, offset) whose box is free in ``v.occ``, inside the view, whose dimension line does not
    cross the paper-space polygons in ``avoid`` (hatched concrete), does not share a line with an earlier dimension line (``same_line``) and whose
    text does not sit on a line in ``v.avoid_lines`` (the driveway centreline; the text slides along the dimension to clear it).  Falls back to
    the first candidate when nothing is clear (counted in ``v.dropped``) so the dimension is never silently lost."""
    first = None
    for sd in sides:
        for off in offsets:
            box = dim_linear(v, a, b, text, off, sd, h, layer, dry=True, min_len=min_len)
            if box is None:
                return None
            first = first or (off, sd)
            n = (b[0] - a[0], b[1] - a[1])
            L = math.hypot(*n) or 1.0
            nx, ny = -n[1] / L, n[0] / L
            if sd is not None and nx * sd[0] + ny * sd[1] < 0:
                nx, ny = -nx, -ny
            q1, q2 = (a[0] + nx * off, a[1] + ny * off), (b[0] + nx * off, b[1] + ny * off)
            if not (v.free(box) and _line_clear(v, q1, q2, avoid)):
                continue
            if any(same_line(q1, q2, r_, s_) for r_, s_ in v.dim_lines):
                continue
            for tf in (0.5, 0.3, 0.7, 0.2, 0.8):
                if v.avoid_lines and any(_text_box(q1, q2, text, h, tf).intersects(g) for g in v.avoid_lines):
                    continue
                return dim_linear(v, a, b, text, off, sd, h, layer, min_len=min_len, tfrac=tf)
    v.dropped += 1
    return dim_linear(v, a, b, text, first[0], first[1], h, layer, min_len=min_len)
