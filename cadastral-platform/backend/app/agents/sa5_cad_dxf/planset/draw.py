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


def contours(v: View, s: Site, which: str, labels: bool = True, light: bool = False) -> int:
    conts = s.ex_cont if which == "ex" else s.pr_cont
    layer = "C-TOPO-EXST" if which == "ex" else "C-TOPO-PROP"
    col = (0.5, 0.5, 0.5) if which == "ex" else MAGENTA
    lab_col = (0.35, 0.35, 0.35) if which == "ex" else MAGENTA
    win = v.window_poly()
    zone = None
    if which == "pr" and s.pad is not None and s.surf is not None:
        zone = s.pad.buffer(36)
    n = 0
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
        lw = (0.28 if c.index else 0.13) if which == "ex" else (0.4 if c.index else 0.2)
        v.geom(g, layer, lw=lw, color=col if which == "ex" else None, dash=None)
        n += 1
        if labels and (c.index or (s.interval >= 1.0 and getattr(s, "contour_label_policy", None) != "major_only") or which == "ex" and len(conts) <= 8):
            vis = ln.intersection(win.buffer(-8 / v.k))
            if vis.is_empty:
                continue
            piece = max(getattr(vis, "geoms", [vis]), key=lambda x: x.length) if vis.geom_type != "LineString" else vis
            if piece.geom_type != "LineString" or piece.length * v.k < 24:
                continue
            for t in (0.5, 0.3, 0.7):
                p = piece.interpolate(t, normalized=True)
                q = piece.interpolate(min(1, t + 0.04), normalized=True)
                r = piece.interpolate(max(0, t - 0.04), normalized=True)
                ang = math.degrees(math.atan2(q.y - r.y, q.x - r.x))
                if v.label(p.x, p.y, _rl_text(c.level, s.interval), 1.9, ang, color=lab_col, layer="C-ANNO-CNTR", halo=True, nudges=False):
                    break
    return n


def spot_levels_sparse(v: View, s: Site, near, gap_mm: float = 22.0, maxn: int = 8, avoid=None) -> int:
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
        if block is not None and _box(*v._box(px, py - 1.6, f"{z:.2f}", 2.4, "TOP_CENTER", 0.0, False)).union(_P(px, py).buffer(1.0)).intersects(block):
            continue
        lx, ly = v.tm(px, py - 1.6)                                                      # 1.6 mm below the post on the PAPER
        if v.label(lx, ly, f"{z:.2f}", 2.4, -v.twist, anchor="TOP_CENTER", color=(0.2, 0.2, 0.2), layer="C-TOPO-SPOT", halo=True, nudges=False):       # upright on the paper whatever the view twist
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
        v.callout((m.x, m.y), ["PROPOSED DRIVEWAY & CROSSOVER", f"WIDTH {w:.1f} m  (B85 design vehicle)"], 2.2, layer="C-DRIV-XOVR",
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
