"""Reference-style call-outs: UPPERCASE text in a white box with a thin black outline, last line right-aligned, and a leader that
leaves the middle of a box edge, runs a short landing, then a diagonal to the target (dot, arrow or nothing).

Box geometry is in PAPER mm (box position = top-left corner), the target is a MODEL point; works on any paper size.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

from shapely.geometry import Point, LineString, Polygon
from shapely.geometry import box as shp_box

from app.agents.sa5_cad_dxf.planset import fonts
from app.agents.sa5_cad_dxf.planset.core import View
from app.agents.sa5_cad_dxf.planset.style import BLACK, REF, WHITE, Paper, clean


@dataclass
class Callout:
    box: tuple                      # (x0, y0, x1, y1) paper mm
    start: tuple                    # leader start, on the middle of a box edge (paper mm)
    leader: list                    # [start, landing end, target] (paper mm); two points when the target is too close for a landing
    target: tuple                   # paper mm
    side: str
    lines: list = field(default_factory=list)


def prep(lines) -> list[str]:
    """UPPERCASE call-out text; SI unit symbols stay lower case (3.0m, 158 m2, 265.25 m AHD)."""
    return [re.sub(r"(\d)(\s?)M(2?)(?![A-Z0-9])", r"\1\2m\3", clean(x).upper()) for x in lines if x]


def box_size(lines: list[str]) -> tuple[float, float]:
    w = max(fonts.text_width(x, REF.callout_h) for x in lines) + 2 * REF.callout_pad_x
    return w, 2 * REF.callout_pad_y + (len(lines) - 1) * REF.callout_pitch + REF.callout_h


def _overlap(a, b, m: float = 0.0) -> bool:
    return not (a[2] + m < b[0] or a[0] - m > b[2] or a[3] + m < b[1] or a[1] - m > b[3])


def nudge_box(box, placed, bounds, keep_out=(), step: float = 2.0, margin: float = 1.5, max_r: float = 120.0):
    """Smallest search-ring shift of ``box`` (x0, y0, x1, y1) that keeps it inside ``bounds`` and clear of ``placed`` and ``keep_out``."""
    w, h = box[2] - box[0], box[3] - box[1]
    r = 0.0
    while r <= max_r:
        n = 1 if r == 0 else max(8, int(2 * math.pi * r / step))
        for i in range(n):
            a = 2 * math.pi * i / n
            x0, y0 = box[0] + r * math.cos(a), box[1] + r * math.sin(a)
            c = (x0, y0, x0 + w, y0 + h)
            if c[0] < bounds[0] + 1 or c[1] < bounds[1] + 1 or c[2] > bounds[2] - 1 or c[3] > bounds[3] - 1:
                continue
            if any(_overlap(c, o, margin) for o in list(placed) + list(keep_out)):
                continue
            return c
        r += step
    return None


def _pick_side(side: str, box, t) -> str:
    if side != "auto":
        return side
    if t[0] >= box[2]:
        return "right"
    if t[0] <= box[0]:
        return "left"
    return "bottom" if t[1] <= box[1] else "top"


def callout(view: View, lines, box_xy_paper, target_model_xy, side: str = "auto", terminator: str = "dot", layer: str = "C-ANNO-CALL") -> Callout | None:
    """Draw one call-out.  ``box_xy_paper`` = top-left corner of the box in paper mm; ``target_model_xy`` is in model metres (paper mm on a paper view)."""
    lines = prep(lines)
    if not lines:
        return None
    h, pitch, px = REF.callout_h, REF.callout_pitch, REF.callout_pad_x
    w, ht = box_size(lines)
    x0, yt = box_xy_paper
    box = (x0, yt - ht, x0 + w, yt)
    t = view.tp(*target_model_xy)
    side = _pick_side(side, box, t)
    mid = {"right": (box[2], (box[1] + box[3]) / 2), "left": (box[0], (box[1] + box[3]) / 2),
           "top": ((box[0] + box[2]) / 2, box[3]), "bottom": ((box[0] + box[2]) / 2, box[1])}[side]
    L = REF.leader_landing
    if side in ("left", "right"):
        sg = 1.0 if side == "right" else -1.0
        p1 = (mid[0] + sg * L, mid[1])
        ok = (t[0] - mid[0]) * sg > L + 1.0
    else:
        sg = 1.0 if side == "top" else -1.0
        p1 = (mid[0], mid[1] + sg * L)
        ok = (t[1] - mid[1]) * sg > L + 1.0
    leader = [mid, p1, t] if ok else [mid, t]
    pp = Paper(view)
    pp.poly([(box[0], box[1]), (box[2], box[1]), (box[2], box[3]), (box[0], box[3])], layer, WHITE, edge=BLACK, edge_lw=REF.callout_lw)
    for i, ln in enumerate(lines):
        yb = yt - REF.callout_pad_y - h - i * pitch
        if i == len(lines) - 1 and len(lines) > 1:
            pp.text(box[2] - px, yb, ln, h, "BOTTOM_RIGHT", layer=layer)
        else:
            pp.text(box[0] + px, yb, ln, h, "BOTTOM_LEFT", layer=layer)
    pp.line(leader, layer, REF.leader_lw, BLACK)
    if terminator == "dot":
        pp.circle(t[0], t[1], REF.dot_r, layer, 0.1, BLACK, BLACK)
    elif terminator == "arrow":
        a, b = leader[-2], leader[-1]
        d = math.hypot(b[0] - a[0], b[1] - a[1]) or 1.0
        ux, uy = (b[0] - a[0]) / d, (b[1] - a[1]) / d
        bx, by = b[0] - ux * REF.arrow_len, b[1] - uy * REF.arrow_len
        pp.poly([b, (bx - uy * REF.arrow_half_w, by + ux * REF.arrow_half_w), (bx + uy * REF.arrow_half_w, by - ux * REF.arrow_half_w)], layer, BLACK)
    view.occ.append((box[0] - 0.5, box[1] - 0.5, box[2] + 0.5, box[3] + 0.5))
    view.callout_boxes.append(box)
    view.leaders.append(list(leader))
    return Callout(box, mid, leader, t, side, lines)


def _is_own(o, box) -> bool:
    """True when the occupied rectangle ``o`` is (a margin around) the candidate box itself."""
    return abs(o[0] - box[0]) < 2.0 and abs(o[1] - box[1]) < 2.0 and abs(o[2] - box[2]) < 2.0 and abs(o[3] - box[3]) < 2.0


def leader_conflicts(view: View, ln: LineString, box) -> bool:
    """True when the new leader ``ln`` crosses (or touches) an earlier leader, or an earlier leader runs through the new box.  Always enforced."""
    bx = shp_box(*box)
    for q in view.leaders:
        lq = LineString(q)
        if ln.intersects(lq) or lq.intersects(bx):
            return True
    return False


def find_slot(view: View, w: float, ht: float, t, keep_out=(), avoid=(), strict: int = 2, max_dist: float = 1e9):
    """First free top-left corner for a box w x ht whose leader (landing + diagonal) reaches paper point ``t``; None if the view is full."""
    L = REF.leader_landing
    for dist in (d_ for d_ in (16, 24, 34, 46, 60, 78, 100, 130) if d_ <= max_dist):
        for sy in (1, -1):
            for sx in (-1, 1):
                for ang in (52, 35, 70):
                    p1 = (t[0] + sx * dist * math.cos(math.radians(ang)), t[1] + sy * dist * math.sin(math.radians(ang)))
                    ax = p1[0] + sx * L
                    x0 = ax - w if sx < 0 else ax
                    box = (x0, p1[1] - ht / 2, x0 + w, p1[1] + ht / 2)
                    if not view.free((box[0] - 1, box[1] - 1, box[2] + 1, box[3] + 1)):
                        continue
                    if any(_overlap(box, o, 1.5) for o in keep_out) or (box[0] - 2 < t[0] < box[2] + 2 and box[1] - 2 < t[1] < box[3] + 2):
                        continue
                    if avoid:
                        bp = Polygon([view.tm(box[0], box[1]), view.tm(box[2], box[1]), view.tm(box[2], box[3]), view.tm(box[0], box[3])])
                        if any(bp.intersects(g) for g in avoid):
                            continue
                    if keep_out and any(LineString([(ax, p1[1]), p1, t]).intersects(shp_box(*k)) for k in keep_out):
                        continue                                 # the leader must not run through a reserved rectangle (north point, scale bar, notes panel)
                    ln = LineString([(ax, p1[1]), p1, t])
                    if leader_conflicts(view, ln, box):
                        continue                                 # a leader NEVER crosses an earlier leader, and an earlier leader never runs through the new box
                    if strict and view.leader_avoid and any(ln.difference(Point(t).buffer(1.2)).intersects(g) for g in view.leader_avoid):
                        continue                                 # nor through the layover wings
                    if strict and view.dim_geoms and any(ln.difference(Point(t).buffer(1.2)).intersects(g) for g in view.dim_geoms):
                        continue                                 # a leader does not cross or graze a dimension line or its extension lines
                    if any(ln.difference(Point(t).buffer(1.2)).intersects(shp_box(*o)) for o in view.tbox):
                        continue                                 # a leader never runs through text already placed (bearings, distances, names, chainage, dimension figures)
                    if strict > 1 and any(ln.difference(Point(t).buffer(1.2)).intersects(shp_box(*o)) for o in view.occ if not _is_own(o, box)):
                        continue                                 # preferred: nor through the reserved zone of a label or dimension
                    if strict and any(ln.intersects(shp_box(*b)) for b in view.callout_boxes):
                        continue                                 # nor through an earlier call-out box (relaxed only when the sheet is full)
                    return (x0, box[3])
    return None


def fallback_tag(view: View, lines, target_model_xy, hidden: bool = False, layer: str = "C-ANNO-CALL") -> str | None:
    """Must-carry text that has no free call-out slot: a numbered tag at the target (when it is on the view and not under a box) and the full
    text kept in ``view.fallback_notes`` for the notes panel.  Never silent."""
    lines = prep(lines)
    if not lines:
        return None
    text = ". ".join(lines)
    entry = text
    if not hidden and view.inside(*target_model_xy, 2.0):
        view.tag_n += 1
        label = f"T{view.tag_n}"
        t = view.tp(*target_model_xy)
        pp = Paper(view)
        pp.circle(t[0], t[1], 2.4, layer, REF.callout_lw, BLACK, WHITE)
        pp.text(t[0], t[1], label, 1.8, "MIDDLE_CENTER", layer=layer)
        view.occ.append((t[0] - 3.0, t[1] - 3.0, t[0] + 3.0, t[1] + 3.0))
        entry = f"{label}: {text}"
    if entry not in view.fallback_notes:
        view.fallback_notes.append(entry)
    return entry


def place_callout(view: View, lines, target_model_xy, terminator: str = "dot", keep_out=(), layer: str = "C-ANNO-CALL", avoid=(), soft_avoid=(),
                  must: bool = False, must_avoid=(), short_first: float | None = None) -> Callout | None:
    """Pick a free slot near the target (greedy, avoids earlier boxes, labels in ``view.occ`` and ``keep_out``) and draw the call-out.
    ``must``: when no slot fits, fall back to a numbered tag at the target with the full text in the notes panel (``fallback_tag``)."""
    lines = prep(lines)
    if not lines:
        return None
    if not view.inside(*target_model_xy, 2.0):
        if must:
            fallback_tag(view, lines, target_model_xy, hidden=True, layer=layer)
        return None
    w, ht = box_size(lines)
    t = view.tp(*target_model_xy)
    if any(b[0] - 1.0 <= t[0] <= b[2] + 1.0 and b[1] - 1.0 <= t[1] <= b[3] + 1.0 for b in view.callout_boxes):
        if must:
            fallback_tag(view, lines, target_model_xy, hidden=True, layer=layer)
        return None                                      # the target is hidden under an earlier call-out
    slot = None
    if short_first:                                                   # a crowded sheet: a short leader (box close to its target, even inside the soft-avoided lot) beats a long one
        for av in (list(avoid) + list(soft_avoid) + list(must_avoid), list(avoid) + list(must_avoid), list(must_avoid)):
            slot = find_slot(view, w, ht, t, keep_out, av, 2, short_first)
            if slot is not None:
                break
    for strict in ((2, 1, 0) if slot is None else ()):                # leaders crossing leaders, then boxes, are relaxed only when the sheet is full
        for av in (list(avoid) + list(soft_avoid) + list(must_avoid), list(avoid) + list(must_avoid), list(must_avoid)):      # soft items (the lot) are relaxed first when the sheet is full; must_avoid (kerb lines) never
            slot = find_slot(view, w, ht, t, keep_out, av, strict)
            if slot is not None:
                break
        if slot is not None:
            break
    if slot is None:
        c = nudge_box((t[0] + 20, t[1] + 20, t[0] + 20 + w, t[1] + 20 + ht), view.occ, view.rect, keep_out)
        slot = (c[0], c[3]) if c else None
        if slot is not None:                                         # the last resort still never crosses an earlier leader
            bx_ = (slot[0], slot[1] - ht, slot[0] + w, slot[1])
            mid_ = ((bx_[0] + bx_[2]) / 2, (bx_[1] + bx_[3]) / 2)
            if leader_conflicts(view, LineString([mid_, t]), bx_):
                slot = None
    if slot is None:
        view.dropped += 1
        if must:
            fallback_tag(view, lines, target_model_xy, layer=layer)
        return None
    return callout(view, lines, slot, target_model_xy, "auto", terminator, layer)
