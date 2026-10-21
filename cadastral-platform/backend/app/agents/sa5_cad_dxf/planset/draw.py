"""Reusable plan elements drawn onto a model View."""
from __future__ import annotations

import math

import numpy as np
from shapely.geometry import LineString, MultiLineString, Point, Polygon, box
from shapely.ops import substring, unary_union

from app.agents.sa5_cad_dxf.planset import fonts
from app.agents.sa5_cad_dxf.planset.core import LegendEntry, View, upright
from app.agents.sa5_cad_dxf.planset.data import DEM_NOTE, Site

GREY = (0.42, 0.42, 0.42)
LGREY = (0.62, 0.62, 0.62)
BLUE = (0.08, 0.2, 0.62)
RED = (0.8, 0.1, 0.1)
GREEN = (0.0, 0.5, 0.2)
MAGENTA = (0.72, 0.0, 0.5)
WATER = (0.0, 0.35, 0.8)
SEWER = (0.55, 0.3, 0.05)
STORM = (0.0, 0.5, 0.55)


def circle(cx, cy, r, n=16):
    return [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def paper_circle(v: View, cx, cy, r_mm, layer="C-ANNO-NOTE", lw=0.18, color=None, n=16):
    pts = [v.tm(cx + r_mm * math.cos(2 * math.pi * i / n), cy + r_mm * math.sin(2 * math.pi * i / n)) for i in range(n)]
    v.line(pts, layer, True, lw, color=color, anno=True)


AERIAL_OPACITY = 0.30       # faded aerial underlay: 25 to 35 percent, desaturated, so linework reads clearly over it


def _grey_copy(path: str) -> str:
    """Desaturated copy of an aerial image (written beside it once); the faded underlay is greyscale so coloured linework stays legible."""
    from pathlib import Path
    from PIL import Image
    p = Path(path)
    g = p.with_name(p.stem + "_grey.png")
    if not g.exists() or g.stat().st_mtime < p.stat().st_mtime:
        Image.open(p).convert("L").convert("RGB").save(g)
    return str(g)


def aerial_underlay(v: View, s: Site, opacity: float = AERIAL_OPACITY) -> bool:
    """Faded, desaturated aerial behind the plan when imagery was supplied (``s.aerial_site``); returns True when drawn.  No imagery: nothing."""
    from pathlib import Path
    a = s.aerial_site
    if a is None or not Path(a.path).exists():
        return False
    v.image(_grey_copy(a.path), a.extent, 1.0 - min(max(opacity, 0.05), 1.0), layer="C-IMAG-AERL")
    return True


def aerial(v: View, s: Site, fade: float = 0.5) -> None:
    if s.aerial_site:
        v.image(s.aerial_site.path, s.aerial_site.extent, fade)


def neighbours(v: View, s: Site, labels: bool = True, h: float = 2.8) -> None:
    win = v.window_poly()
    for label, poly, road in s.neighbours:
        v.geom(poly, "C-PROP-ADJN", lw=0.13, color=(0.35, 0.35, 0.35))
        if not labels:
            continue
        part = poly.intersection(win.buffer(-3 / v.k))
        if part.is_empty:
            continue
        best = max(getattr(part, "geoms", [part]), key=lambda g: g.area)
        if best.area < 6 / v.k / v.k * 2 and not road:        # too small on paper
            continue
        p = best.representative_point()
        v.label(p.x, p.y, label, h, 0, bold=True, color=(0.25, 0.25, 0.25), layer="C-ANNO-LOTN", halo=True)


def lot_boundary(v: View, s: Site, bearings: bool = True, corners: bool = True) -> None:
    v.geom(s.lot, "C-PROP-BDY", lw=0.5)
    win = v.window_poly()
    if corners:
        for x, y in list(s.lot.exterior.coords)[:-1]:
            if v.inside(x, y, 2):
                px, py = v.tp(x, y)
                paper_circle(v, px, py, 0.9, "C-PROP-BDY", 0.18, color=(0, 0.5, 0.1))
    if not bearings:
        return
    for seg in s.inp.lot.segments:
        ln = LineString([seg.start_xy, seg.end_xy])
        part = ln.intersection(win.buffer(-2 / v.k))
        if part.is_empty:
            continue
        if part.geom_type != "LineString":
            part = max(part.geoms, key=lambda g: g.length)
        if part.length * v.k < 22:
            continue
        m = part.interpolate(0.5, normalized=True)
        dx, dy = seg.end_xy[0] - seg.start_xy[0], seg.end_xy[1] - seg.start_xy[1]
        L = math.hypot(dx, dy)
        nx, ny = -dy / L, dx / L
        if not s.lot.contains(Point(m.x + nx * 0.5 / v.k, m.y + ny * 0.5 / v.k)):
            nx, ny = -nx, -ny
        off = 2.4 / v.k
        txt = f"{seg.bearing_dms}  {seg.distance_m:.2f} m"
        ang = math.degrees(math.atan2(dy, dx))
        v.label(m.x + nx * off, m.y + ny * off, txt, 2.2, ang, color=(0, 0.4, 0.1), layer="C-ANNO-BRNG", halo=True, nudges=False)


def road_names(v: View, s: Site) -> None:
    done = set()
    for seg in s.inp.lot.segments:
        nm = s.road_name_by_seq.get(seg.seq)
        if not nm or nm in done and not seg.is_front:
            continue
        ln = LineString([seg.start_xy, seg.end_xy])
        part = ln.intersection(v.window_poly().buffer(-4 / v.k))
        if part.is_empty or (part.geom_type != "LineString" and not part.geoms):
            continue
        if part.geom_type != "LineString":
            part = max(part.geoms, key=lambda g: g.length)
        if part.length * v.k < 30:
            continue
        m = part.interpolate(0.5, normalized=True)
        dx, dy = seg.end_xy[0] - seg.start_xy[0], seg.end_xy[1] - seg.start_xy[1]
        L = math.hypot(dx, dy)
        nx, ny = -dy / L, dx / L
        if s.lot.contains(Point(m.x + nx * 0.5 / v.k, m.y + ny * 0.5 / v.k)):
            nx, ny = -nx, -ny
        off = 7.0 / v.k
        ang = math.degrees(math.atan2(dy, dx))
        ok = v.label(m.x + nx * off, m.y + ny * off, nm.upper(), 3.6, ang, bold=True, color=(0.2, 0.2, 0.2), layer="C-ANNO-ROAD", halo=True)
        if ok:
            v.label(m.x + nx * (off + 4.2 / v.k), m.y + ny * (off + 4.2 / v.k), "ROAD RESERVE", 2.0, ang, color=(0.3, 0.3, 0.3), layer="C-ANNO-ROAD", halo=True, nudges=False)
            done.add(nm)


def _rl_text(lv: float, interval: float) -> str:
    return f"{lv:.2f}" if interval < 1 else f"{lv:.1f}"


CONTOUR_SLOT_T = (0.5, 0.35, 0.65, 0.22, 0.78, 0.12, 0.88, 0.42, 0.58, 0.28, 0.72, 0.17, 0.83)    # fractions along a contour piece tried for a label, in order
CONTOUR_LAB_H = 3.0          # contour label height, paper mm (TXT.LABEL; legible over an aerial, white halo)
CONTOUR_LAB_SPACING_MM = 110.0   # a long contour is labelled again about every this many paper mm (never closer than half of it)
CONTOUR_COLOUR = (0.27, 0.19, 0.10)   # dark brown: reads over an aerial photograph and on white
CONTOUR_LW_MAJOR, CONTOUR_LW_MINOR = 0.50, 0.25
LABEL_ALL_MAX = 24            # at most this many contours in the view and every one is labelled; above it only the index (major) contours are


def _label_slots(piece, v: View, text: str, h: float, n_max: int, avoid=None) -> list[tuple[float, float, float]]:
    """Candidate label positions (model x, y, model baseline angle) along a contour piece: a run of the line at least as long as the label plus clearance, nearly straight
    under the label (so the text lies along the contour without crossing it), outside ``avoid`` (model geometry such as the dwelling) and away from the piece ends."""
    bx = v._box(0.0, 0.0, text, max(h, 1.8), "MIDDLE_CENTER", 0.0, False)
    wl = bx[2] - bx[0]                                                       # label width on paper, mm
    L = piece.length * v.k                                                   # paper mm
    if L < wl + 10.0:
        return []
    half = (wl / 2.0 + 1.0) / v.k                                            # model m
    out = []
    for t in CONTOUR_SLOT_T:
        d = piece.length * t
        if d - half < 0 or d + half > piece.length:
            continue
        p = piece.interpolate(d)
        q, r = piece.interpolate(d + half), piece.interpolate(d - half)
        ang = math.degrees(math.atan2(q.y - r.y, q.x - r.x))
        m1 = piece.interpolate(d + half / 2.0)
        m0 = piece.interpolate(d - half / 2.0)
        a1 = math.degrees(math.atan2(m1.y - m0.y, m1.x - m0.x))
        if abs((a1 - ang + 180.0) % 360.0 - 180.0) > 20.0:                  # bends under the label: try elsewhere
            continue
        if avoid is not None and avoid.distance(p) < half + 0.4:
            continue
        out.append((p.x, p.y, ang))
        if len(out) >= n_max:
            break
    return out


def contours(v: View, s: Site, which: str, labels: bool = True, light: bool = False, lab_h: float = CONTOUR_LAB_H, avoid=None, label_all: bool | None = None,
             no_label_rects=(), lines: bool = True) -> int:
    """Contours with RL labels (m AHD, numeric) along the line, upright on the paper, never colliding (``View.label`` checks the reserved boxes and earlier labels).
    Index (major) contours are labelled always; the other (minor) contours are labelled as well while there are at most LABEL_ALL_MAX in the view, so a plan at a large
    scale labels every contour and a small scale labels the major contours only.  ``avoid`` is model geometry (the dwelling) that labels must not sit on.  ``light``: lighter lines."""
    conts = s.ex_cont if which == "ex" else s.pr_cont
    layer = "C-TOPO-EXST" if which == "ex" else "C-TOPO-PROP"
    col = CONTOUR_COLOUR if which == "ex" else MAGENTA          # stage 8b: dark linework (``light`` no longer lightens it; it was too faint over the aerial)
    lab_col = (0.1, 0.07, 0.03) if which == "ex" else MAGENTA
    win = v.window_poly()
    zone = None
    if which == "pr" and s.pad is not None and s.surf is not None:
        zone = s.pad.buffer(36)
    drawn = []
    for c in conts:
        ln = LineString(c.pts).simplify(0.04)
        if ln.length * v.k < 6:
            continue
        g = ln
        if which == "pr" and s.tin is not None:
            # draw proposed contours only where the surface differs from existing
            xs = np.array([p[0] for p in ln.coords])
            ys = np.array([p[1] for p in ln.coords])
            diff = np.abs(np.asarray(s.surf(xs, ys)) - np.asarray(s.tin.z_at(xs, ys)))
            if not (diff > 0.02).any():
                continue
            mask = unary_union([Point(x, y).buffer(0.9) for x, y, d in zip(xs, ys, diff) if d > 0.02])
            g = ln.intersection(mask)
            if g.is_empty:
                continue
        lw = (CONTOUR_LW_MAJOR if c.index else CONTOUR_LW_MINOR) if which == "ex" else (0.5 if c.index else 0.25)
        if lines:                                                    # ``lines=False`` labels the contours only (the lines were drawn earlier; used to label after the sheet's own symbols are placed)
            v.geom(g, layer, lw=lw, color=col if which == "ex" else None, dash=None)
        drawn.append((c, ln))
    if labels:
        vis_n = sum(1 for _c, ln in drawn if ln.intersects(win))
        every = (vis_n <= LABEL_ALL_MAX) if label_all is None else label_all
        order = sorted(drawn, key=lambda cl: (not cl[0].index, cl[0].level))        # major contours get the free positions first
        for c, ln in order:
            if not (c.index or every):
                continue
            vis = ln.intersection(win.buffer(-8 / v.k))
            if vis.is_empty:
                continue
            pieces = [x for x in getattr(vis, "geoms", [vis]) if x.geom_type == "LineString"]
            text = _rl_text(c.level, s.interval)
            placed: list[tuple[float, float]] = []
            for piece in sorted(pieces, key=lambda x: -x.length):
                wanted = max(1, min(4, int(piece.length * v.k // CONTOUR_LAB_SPACING_MM) + (1 if piece.length * v.k > 60.0 else 0)))
                if every and not c.index:
                    wanted = min(wanted, 2)
                got = 0
                for x, y, ang in _label_slots(piece, v, text, lab_h, 13, avoid):
                    px_, py_ = v.tp(x, y)
                    if any(r_[0] - 12.0 <= px_ <= r_[2] + 12.0 and r_[1] - 3.0 <= py_ <= r_[3] + 3.0 for r_ in no_label_rects):
                        continue                                                                                   # a data-panel column is reserved here: no label
                    if any(math.hypot(px_ - a, py_ - b) < CONTOUR_LAB_SPACING_MM * 0.5 for a, b in placed):
                        continue                                                                                   # spaced along the contour, not bunched
                    if v.label(x, y, text, lab_h, ang, color=lab_col, layer="C-ANNO-CNTR", halo=True, nudges=False):
                        placed.append((px_, py_))
                        got += 1
                        if got >= wanted:
                            break
    return len(drawn)


def spot_levels_sparse(v: View, s: Site, near, gap_mm: float = 22.0, maxn: int = 8, avoid=None, h: float = 2.4) -> int:
    """Design-sheet spot levels: a few DEM posts near ``near`` (driveway), at least ``gap_mm`` of paper apart, each label kept clear of everything
    already reserved (call-outs, panels, other labels).  Contours stay on the existing-site sheet; spot levels are NOT drawn on C100."""
    from shapely.geometry import Point as _P, box as _box
    n, taken = 0, []
    block = None
    if avoid:                                                                       # model geometry the labels must not sit on (kerb and gutter lines, boundary, driveway edge)
        from shapely.ops import unary_union as _uu
        block = v.to_paper_geom(_uu([g for g in avoid if g is not None and not g.is_empty])).buffer(0.8)
    for x, y, z in sorted(s.spots, key=lambda t: (round(t[1], 0), t[0])):
        if n >= maxn or not v.inside(x, y, 10) or not near.buffer(8.0).contains(_P(x, y)):
            continue
        px, py = v.tp(x, y)
        if any(math.hypot(px - a, py - b) < gap_mm for a, b in taken):
            continue
        if block is not None and _box(*v._box(px, py - 1.6, f"{z:.2f}", h, "TOP_CENTER", 0.0, False)).union(_P(px, py).buffer(1.0)).intersects(block):
            continue
        lx, ly = v.tm(px, py - 1.6)                                                      # 1.6 mm below the post on the PAPER
        if v.label(lx, ly, f"{z:.2f}", h, -v.twist, anchor="TOP_CENTER", color=(0.2, 0.2, 0.2), layer="C-TOPO-SPOT", halo=True, nudges=False):       # upright on the paper whatever the view twist
            v.line([v.tm(px - 0.8, py), v.tm(px + 0.8, py)], "C-TOPO-SPOT", lw=0.1, color=LGREY, anno=True)
            v.line([v.tm(px, py - 0.8), v.tm(px, py + 0.8)], "C-TOPO-SPOT", lw=0.1, color=LGREY, anno=True)
            taken.append((px, py))
            n += 1
    return n


def spot_levels(v: View, s: Site, maxn: int = 120) -> int:
    """DEM posts inside the view as small crosses with RL (indicative)."""
    n = 0
    for x, y, z in s.spots:
        if not v.inside(x, y, 6) or n >= maxn or not s.lot.buffer(12).contains(Point(x, y)):
            continue
        px, py = v.tp(x, y)
        v.line([v.tm(px - 0.8, py), v.tm(px + 0.8, py)], "C-TOPO-SPOT", lw=0.1, color=LGREY, anno=True)
        v.line([v.tm(px, py - 0.8), v.tm(px, py + 0.8)], "C-TOPO-SPOT", lw=0.1, color=LGREY, anno=True)
        if v.label(*v.tm(px, py - 1.2), f"{z:.1f}", 1.8, -v.twist, anchor="TOP_CENTER", color=LGREY, layer="C-TOPO-SPOT", halo=True, nudges=False):
            n += 1
    return n


def envelope(v: View, s: Site, label: bool = True) -> None:
    if s.envelope is None:
        return
    v.geom(s.envelope, "C-ZONE-ENVL", lw=0.3)
    if label:
        ln = LineString(s.envelope.exterior.coords)
        win = v.window_poly().buffer(-10 / v.k)
        vis = ln.intersection(win)
        if not vis.is_empty:
            piece = max(getattr(vis, "geoms", [vis]), key=lambda x: x.length)
            if piece.geom_type == "LineString" and piece.length * v.k > 60:
                a, b = piece.interpolate(0.3, normalized=True), piece.interpolate(0.31, normalized=True)
                ang = math.degrees(math.atan2(b.y - a.y, b.x - a.x))
                v.label(a.x, a.y, "BUILDING ENVELOPE (SETBACK LINE)", 2.0, ang, color=(0.8, 0.1, 0.1), layer="C-ANNO-NOTE", halo=True, nudges=False)


def building(v: View, s: Site, with_label: bool = True, ffl: bool = True) -> None:
    fp = s.footprint
    if fp is None:
        return
    v.fill(fp, "A-BLDG-SLAB", (0.78, 0.84, 1.0), 0.75)
    v.geom(fp, "A-BLDG-SLAB", lw=0.6, color=BLUE)
    if not with_label:
        return
    c = fp.centroid
    lines = [s.fp_label]
    if ffl and s.ffl is not None:
        lines.append(f"FFL RL {s.ffl:.2f} m AHD (illustrative)" if "ILLUSTRATIVE" in s.ffl_note else f"FFL RL {s.ffl:.2f} m AHD")
    lines.append(f"AREA {fp.area:.0f} m2  ({_dim_text(fp)})")
    v.callout((c.x, c.y), lines, 2.3, color=BLUE, layer="A-BLDG-SLAB", prefer=[(14, 14), (14, -22), (-70, 14), (-70, -22)])


def _dim_text(fp: Polygon) -> str:
    r = list(fp.minimum_rotated_rectangle.exterior.coords)
    a, b = math.dist(r[0], r[1]), math.dist(r[1], r[2])
    return f"{max(a, b):.1f} x {min(a, b):.1f} m"


def building_setbacks(v: View, s: Site, text_h: float = 2.0, off_mm: float = 2.2, color=None, mask: bool = False, avoid=None) -> None:
    """Distance from each side of the structure to the nearest lot boundary, along the side's outward normal.

    ``avoid`` (optional shapely geometry, e.g. the driveway): a side whose dimension would cross it is dimensioned from another point along that side."""
    fp = s.footprint
    if fp is None:
        return
    mrr = list(fp.minimum_rotated_rectangle.exterior.coords)[:4]
    cen = fp.centroid
    reach = max(s.lot.bounds[2] - s.lot.bounds[0], s.lot.bounds[3] - s.lot.bounds[1]) * 2
    fracs = (0.5,) if avoid is None else (0.5, 0.25, 0.75, 0.12, 0.88)
    for i in range(4):
        p, q = mrr[i], mrr[(i + 1) % 4]
        dx, dy = q[0] - p[0], q[1] - p[1]
        L = math.hypot(dx, dy)
        nx, ny = dy / L, -dx / L
        mx0, my0 = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
        if (mx0 - cen.x) * nx + (my0 - cen.y) * ny < 0:
            nx, ny = -nx, -ny
        chosen = None
        for f in fracs:
            mx, my = (mx0, my0) if f == 0.5 else (p[0] + dx * f, p[1] + dy * f)
            ray = LineString([(mx, my), (mx + nx * reach, my + ny * reach)])
            hit = ray.intersection(s.lot.exterior)
            pts = [g for g in getattr(hit, "geoms", [hit]) if g.geom_type == "Point"]
            if not pts:
                continue
            h = min(pts, key=lambda g: g.distance(Point(mx, my)))
            d = h.distance(Point(mx, my))
            if d < 0.3 or not (v.inside(mx, my, 3) and v.inside(h.x, h.y, 3)):
                continue
            cand = (mx, my, h, d)
            if chosen is None:
                chosen = cand                     # fall back to the first valid point when every point crosses ``avoid``
            if avoid is None or LineString([(mx, my), (h.x, h.y)]).distance(avoid) > 0.8:
                chosen = cand
                break
        if chosen is not None:
            mx, my, h, d = chosen
            v.dim((mx, my), (h.x, h.y), f"{d:.1f} m", side=(-ny, nx), off_mm=off_mm, h=text_h, color=color, mask=mask)


def drive(v: View, s: Site, label: bool = True) -> None:
    if s.crossover is not None:
        v.fill(s.crossover, "C-DRIV-XOVR", (0.75, 0.75, 0.75), 0.55)
        v.geom(s.crossover, "C-DRIV-XOVR", lw=0.35)
    if s.drive_poly is not None:
        v.fill(s.drive_poly, "C-DRIV-XOVR", (0.86, 0.86, 0.86), 0.7)
        v.geom(s.drive_poly, "C-DRIV-XOVR", lw=0.3)
    if s.drive_cl is not None:
        v.geom(s.drive_cl, "C-DRIV-CNTR", lw=0.13)
    if label and s.drive_poly is not None:
        m = s.drive_cl.interpolate(0.5, normalized=True)
        w = s.inp.driveway.width_m
        v.callout((m.x, m.y), ["PROPOSED DRIVEWAY & CROSSOVER", f"WIDTH {w:.1f} m  ({s.inp.driveway.design_vehicle} design vehicle)"], 2.2, layer="C-DRIV-XOVR",
                  prefer=[(12, -12), (-60, -12), (12, 12)])


def services(v: View, s: Site, which: str | None = None) -> int:
    from app.agents.sa5_cad_dxf.layers import SERVICE_LAYER
    from shapely import wkt as swkt
    n = 0
    for sv in s.inp.services:
        if which and sv.service != which:
            continue
        g = swkt.loads(sv.geometry_wkt)
        lay = SERVICE_LAYER[sv.service]
        v.geom(g, lay, lw=0.3, dash="DASHED" if sv.is_proposed else None)
        if sv.exclusion_wkt:
            v.geom(swkt.loads(sv.exclusion_wkt), "C-UTIL-EXCL", lw=0.13)
        c = g.representative_point()
        txt = sv.label + (f" DN{sv.diameter_mm}" if sv.diameter_mm else "") + (" (PROPOSED)" if sv.is_proposed else " (EXISTING)")
        v.label(c.x, c.y, txt, 2.0, 0, layer="C-ANNO-SERV", halo=True)
        n += 1
    return n


def panel(v: View, x0, y0, x1, y1, title: str, lines: list[str], h: float = 2.2, warn: bool = False, layer: str = "C-ANNO-NOTE") -> float:
    """Boxed text panel given in PAPER mm (works on paper and model views); returns the paper y of the bottom of the text."""
    T = (lambda a, b: v.tm(a, b)) if not v.paper else (lambda a, b: (a, b))  # noqa: E731
    col = (0.72, 0.1, 0.1) if warn else (0, 0, 0)
    if warn:
        from shapely.geometry import Polygon
        v.fill(Polygon([T(x0, y0), T(x1, y0), T(x1, y1), T(x0, y1)]), layer, (1, 1, 1), 0.9, anno=True)
    v.line([T(x0, y0), T(x1, y0), T(x1, y1), T(x0, y1)], "C-DATA-NONE" if warn else "C-ANNO-TABL", True, 0.35 if warn else 0.25, color=col if warn else None, anno=True)
    rot = 0.0 if v.paper else -v.twist                                      # text stays horizontal on the sheet whatever the view twist
    v.text(*T(x0 + 2, y1 - 1.2), title, 2.8, "TOP_LEFT", rot, True, color=col, layer=layer)
    yy = y1 - 6.4
    for ln in lines:
        bullet = ln.startswith("- ")
        for k, w in enumerate(fonts.wrap(ln, h, x1 - x0 - 5 - (3 if bullet else 0))):
            if yy < y0 + 1.2:
                return yy
            v.text(*T(x0 + 2 + (3 if bullet and k else 0), yy), w, h, "TOP_LEFT", rot, layer=layer, color=col if warn else None)
            yy -= h + 1.0
        yy -= 0.8
    return yy


def no_data(v: View, rect, what: str, extra: str = "") -> None:
    x0, y0, x1, y1 = rect
    lines = [what] + ([extra] if extra else [])
    panel(v, x0, y0, x1, y1, "DATA NOT AVAILABLE", lines, 2.4, warn=True, layer="C-DATA-NONE")
