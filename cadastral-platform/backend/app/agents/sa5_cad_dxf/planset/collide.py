"""Label collision audit and resolution (bounding boxes in paper mm).

``text_poly`` gives the rotated rectangle of any text item.  ``audit`` lists overlapping text pairs on a view, ``leader_hits`` lists call-out
leaders that run through text that is not their own, and ``resolve`` nudges movable labels (with their white mask) to the nearest free place that
is inside the view, clear of other text and call-out boxes and, where possible, off hatched or stippled fills.
"""
from __future__ import annotations

import math

from shapely.geometry import LineString, Polygon, box as sbox

from app.agents.sa5_cad_dxf.planset import fonts
from app.agents.sa5_cad_dxf.planset.core import Item, View

MIN_OVERLAP_MM2 = 0.15
MOVABLE = ("C-ANNO-DIMS", "C-ANNO-BRNG", "C-ANNO-LOTN", "C-ANNO-SERV", "C-ANNO-CNTR", "C-TOPO-SPOT", "C-ANNO-NOTE")
FIXED_HINT = ("C-ANNO-NRTH", "C-ANNO-CALL", "C-DATA-NONE", "C-ANNO-TABL", "C-ANNO-ROAD")


def text_poly(v: View, it: Item) -> Polygon:
    px, py = v.tp(*it.pts[0])
    w, h = fonts.text_width(it.text, it.h, it.bold), it.h
    vt, hz = it.anchor.split("_")
    dx = {"LEFT": 0.0, "CENTER": -w / 2, "RIGHT": -w}[hz]
    dy = {"BOTTOM": 0.0, "MIDDLE": -h / 2, "TOP": -h}[vt]
    a = math.radians(it.rot)
    ca, sa = math.cos(a), math.sin(a)
    return Polygon([(px + (dx + u) * ca - (dy + q) * sa, py + (dx + u) * sa + (dy + q) * ca) for u, q in ((0, 0), (w, 0), (w, h), (0, h))])


def texts(v: View) -> list[tuple[int, Item, Polygon]]:
    return [(i, it, text_poly(v, it)) for i, it in enumerate(v.items) if it.kind == "text" and it.text.strip()]


def audit(v: View, min_area: float = MIN_OVERLAP_MM2) -> list[tuple[str, str]]:
    """Overlapping text pairs (by their rotated boxes) as (text, text); empty list = no overlapping labels on the view."""
    ts = texts(v)
    out = []
    for a in range(len(ts)):
        for b in range(a + 1, len(ts)):
            if ts[a][2].intersects(ts[b][2]) and ts[a][2].intersection(ts[b][2]).area > min_area:
                out.append((ts[a][1].text, ts[b][1].text))
    return out


def outside(v: View) -> list[str]:
    """Texts whose box leaves the view rectangle (a model view clips them)."""
    r = sbox(*v.rect).buffer(0.2)
    return [it.text for _i, it, p in texts(v) if not r.contains(p)]


def leader_hits(v: View) -> list[tuple[str, int]]:
    """(text, leader index) for every leader that crosses text outside its own call-out box."""
    hits = []
    ts = texts(v)
    for k, ld in enumerate(v.leaders):
        ln = LineString(ld)
        own = sbox(*v.callout_boxes[k]).buffer(0.3) if k < len(v.callout_boxes) else None
        for _i, it, p in ts:
            if own is not None and own.contains(p.centroid):
                continue
            if ln.intersects(p) and ln.intersection(p).length > 0.3:
                hits.append((it.text, k))
    return hits


LINE_TAGS = ("BNDY", "BNDD", "KERB", "DIMS", "DETL", "EART", "ADJN", "DRVC", "BATR", "C-PROP-BDY", "C-ROAD-KERB", "C-ANNO-DIMS", "C-DETL-LINE", "C-EART-BATR")


def line_hits(v: View, tags=LINE_TAGS, shrink: float = 0.25, min_len: float = 10.0) -> list[tuple[str, str]]:
    """(text, layer) for every text box crossed by drawn linework (boundary, kerb, dimension, detail, batter and driveway lines).  Leader and callout
    lines are tested by ``leader_hits``; contours and fills are not blocking.  Short stubs (dimension ticks and text leaders, under ``min_len`` mm)
    belong to their own dimension and are ignored."""
    from shapely.geometry import LineString as LS
    lines = []
    for it in v.items:
        if it.kind == "line" and any(t in it.layer for t in tags) and it.pts and len(it.pts) > 1:
            pts = [v.tp(*q) for q in it.pts] if not v.paper else list(it.pts)
            if it.closed:
                pts = pts + [pts[0]]
            ln_ = LS(pts)
            if ln_.length >= min_len:
                lines.append((it.layer, ln_))
    out = []
    for _i, it, p in texts(v):
        box_ = p.buffer(-shrink)
        for ly, ln in lines:
            if box_.intersects(ln):
                out.append((it.text, ly))
                break
    return out


def dim_line_overlaps(v: View) -> list[tuple]:
    """Pairs of dimension lines (two-point lines on a dimension layer drawn at the dimension weight) that lie on one line: parallel, within 1.5 mm
    across and overlapping by more than 1 mm along it (``dimstyle.same_line``).  Returns the pairs as paper-mm segment tuples; empty = none."""
    from app.agents.sa5_cad_dxf.planset.dimstyle import same_line
    segs = []
    for it in v.items:
        if it.kind == "line" and "DIMS" in it.layer and it.pts and len(it.pts) == 2 and not it.closed and (it.lw or 0.0) >= 0.17:
            a, b = (v.tp(*it.pts[0]), v.tp(*it.pts[1])) if not v.paper else (tuple(it.pts[0]), tuple(it.pts[1]))
            if math.dist(a, b) >= 6.0:
                segs.append((a, b))
    out = []
    for i in range(len(segs)):
        for j in range(i + 1, len(segs)):
            if same_line(segs[i][0], segs[i][1], segs[j][0], segs[j][1], gap_mm=-1.0):      # a chain of dimensions that only touch end to end is fine
                out.append((segs[i], segs[j]))
    return out


def dim_text_on_lines(v: View, tags=("DRVC",)) -> list[tuple[str, str]]:
    """(dimension text, layer) for every dimension text box that sits on a driveway centreline (line_hits ignores centrelines as deliberate underlay;
    a dimension figure on the centreline is still unreadable)."""
    from shapely.geometry import LineString as LS
    lines = []
    for it in v.items:
        if it.kind == "line" and any(t in it.layer for t in tags) and it.pts and len(it.pts) > 1:
            pts = [v.tp(*q) for q in it.pts] if not v.paper else list(it.pts)
            ln_ = LS(pts)
            if ln_.length >= 10.0:
                lines.append((it.layer, ln_))
    out = []
    for _i, it, p in texts(v):
        if "DIMS" not in it.layer:
            continue
        box_ = p.buffer(-0.25)
        for ly, ln in lines:
            if box_.intersects(ln):
                out.append((it.text, ly))
                break
    return out


def _hatch_polys(v: View) -> list[Polygon]:
    out = []
    for it in v.items:
        if it.kind == "fill" and (it.pattern or it.hatch) and it.pts:
            try:
                out.append(Polygon([v.tp(x, y) for x, y in it.pts[0]]).buffer(0))
            except Exception:  # noqa: BLE001
                pass
    return out


def _is_mask(prev: Item, poly: Polygon) -> bool:
    if prev.kind != "fill" or prev.color != (1, 1, 1) or prev.alpha < 0.99 or not prev.pts:
        return False
    return len(prev.pts[0]) == 4


def resolve(v: View, max_shift_mm: float = 14.0) -> int:
    """Nudge movable labels that overlap other text, a call-out box or the view edge.  Returns the number of labels still overlapping."""
    ts = texts(v)
    obst = [sbox(*b) for b in v.callout_boxes]
    hatch = _hatch_polys(v)
    frame = sbox(*v.rect).buffer(-1.0)
    polys = {i: p for i, _it, p in ts}
    items = {i: it for i, it, _p in ts}
    bad = 0
    for i, it, p in ts:
        if it.layer not in MOVABLE:
            continue
        others = [q for j, q in polys.items() if j != i] + obst
        hit = any(p.intersects(q) and p.intersection(q).area > MIN_OVERLAP_MM2 for q in others) or not frame.contains(p)
        if not hit:
            continue
        a = math.radians(it.rot)
        ux, uy, nx, ny = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
        cands = []
        for r in (1.5, 3.0, 4.5, 6.5, 9.0, max_shift_mm):
            for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (-1, 1), (1, -1), (-1, -1)):
                cands.append((r * (dx * ux + dy * nx), r * (dx * uy + dy * ny)))
        best = None
        for sx, sy in cands:
            q = Polygon([(x + sx, y + sy) for x, y in p.exterior.coords])
            if not frame.contains(q):
                continue
            if any(q.intersects(o) and q.intersection(o).area > MIN_OVERLAP_MM2 for o in others):
                continue
            score = 1 if any(q.intersects(h) for h in hatch) else 0
            if best is None or score < best[0]:
                best = (score, sx, sy, q)
                if score == 0:
                    break
        if best is None:
            bad += 1
            continue
        _s, sx, sy, q = best
        mx, my = v.tm(it.pts[0][0] * 0 + v.tp(*it.pts[0])[0] + sx, v.tp(*it.pts[0])[1] + sy) if not v.paper else (it.pts[0][0] + sx, it.pts[0][1] + sy)
        it.pts = [(mx, my)]
        if i > 0 and _is_mask(v.items[i - 1], p):
            m = v.items[i - 1]
            m.pts = [[v.tm(*(v.tp(x, y)[0] + sx, v.tp(x, y)[1] + sy)) if not v.paper else (x + sx, y + sy) for x, y in m.pts[0]]]
        polys[i] = q
    return bad
