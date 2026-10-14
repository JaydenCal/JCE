"""Reference-style sheet helpers shared by every A1 plan sheet (C100 to C500) plus the C101 entry point (``c101_ref``, built in sheets_ref2).

Data rules: only what the run supplies is drawn.  The kerb line and the road pavement extent are NOT surveyed in the plan set input, so
they are drawn as assumptions and labelled ASSUMED.  Detail survey is a general note on sheet 2 (C001), not repeated on each sheet.
Helpers here: lot labels (DCDB), boundary bearings and distances, road names, view titles and the service symbols.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass

from shapely import wkt as swkt
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import polylabel

from app.agents.sa5_cad_dxf.planset import crossover as CX
from app.agents.sa5_cad_dxf.planset import fonts
from app.agents.sa5_cad_dxf.planset import style as ST
from app.agents.sa5_cad_dxf.planset.core import STD_SCALES, Sheet, View, upright
from app.agents.sa5_cad_dxf.planset.data import Site
from app.agents.sa5_cad_dxf.planset.frame_a1 import AREA
from app.agents.sa5_cad_dxf.planset.titleblock import Proj

VIEW_RECT = (AREA[0] + 2.0, AREA[1] + 2.0, AREA[2] - 2.0, AREA[3] - 2.0)
STRIP_H = 33.0                                   # white strip directly above the title block: view title, scale (both sizes) and graduated scale bar
STRIP_RECT = (VIEW_RECT[0], VIEW_RECT[1], VIEW_RECT[2], VIEW_RECT[1] + STRIP_H)
PLAN_RECT = (VIEW_RECT[0], VIEW_RECT[1] + STRIP_H, VIEW_RECT[2], VIEW_RECT[3])        # the model viewport sits above the strip
SUBJECT_MARGIN_MM = 20.0      # paper margin around the subject lot, crossover and verge (neighbours run on to the viewport edge)
PAVEMENT_TEXT = "ASSUMED ROAD PAVEMENT EXTENT"
PAVEMENT_BASIS = "(ROAD RESERVE LIMITS FROM CADASTRE)"
PAVEMENT_MISSING = "road pavement extent not shown: no survey or road reserve data"
DBYD_TEXT = "LOCATION INDICATIVE, CONFIRM BY DBYD AND POTHOLING"
NEIGHBOUR_MARGIN_MM = SUBJECT_MARGIN_MM       # kept for older imports


@dataclass
class RefCtx:
    site: Site
    proj: Proj
    aerial: bool = False


def _front_segment(s: Site):
    segs = [x for x in s.inp.lot.segments if x.is_front]
    if not segs:
        return None
    if len(segs) > 1:
        ref = s.crossover if s.crossover is not None else s.drive_cl
        if ref is not None:
            return min(segs, key=lambda g: LineString([g.start_xy, g.end_xy]).distance(ref))
        return max(segs, key=lambda g: g.distance_m)
    return segs[0]


def _choose_scale(ext, fit_w: float, fit_h: float, margin: float = SUBJECT_MARGIN_MM) -> int:
    w, h = ext[2] - ext[0], ext[3] - ext[1]
    for sc in (x for x in STD_SCALES if x >= 100):
        if w * 1000.0 / sc + 2 * margin <= fit_w and h * 1000.0 / sc + 2 * margin <= fit_h:
            return sc
    return STD_SCALES[-1]


def _text_poly(v: View, x: float, y: float, s: str, h: float, rot_deg: float) -> Polygon:
    """Rotated rectangle (paper mm) of a centred model-point text, for testing against leaders."""
    px, py = v.tp(x, y)
    w, a = fonts.text_width(s, h), math.radians(v.paper_rot(rot_deg))
    ca, sa = math.cos(a), math.sin(a)
    return Polygon([(px + u * ca - q * sa, py + u * sa + q * ca) for u, q in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2))])


# ---- DCDB lot labels: LOT n over DPnnnnnn at the lot centre; rotated along narrow lots -------------------------------------------------
NA_TEXT = "DATA NOT AVAILABLE"


def _lot_lines(label: str) -> list[str]:
    """LOT n over DPnnnnnn from a cadastre label.  A lot number or plan the data do not carry reads DATA NOT AVAILABLE (never invented)."""
    t = ST.clean(label or "").upper().strip()
    t = re.sub(r"\b(NONE|NULL|NAN|UNKNOWN)\b", "", t).strip()
    m = re.match(r"^(LOT\s+\S+)(?:\s+SEC\s+\S+)?\s+(.+)$", t)
    if m:
        return [m.group(1), m.group(2)]
    m = re.match(r"^(LOT\s+\S+)$", t)
    if m:
        return [m.group(1), f"DP {NA_TEXT}"]
    if not t or t == "LOT":
        return [f"LOT {NA_TEXT}", f"DP {NA_TEXT}"]
    return [t]


def subject_lot_lines(lotplan: str) -> list[str]:
    """'2//DP227508' -> ['LOT 2', 'DP227508']."""
    m = re.match(r"^\s*(\w+)\s*(?://|/)\s*(\S+)\s*$", ST.clean(lotplan).upper())
    return [f"LOT {m.group(1)}", m.group(2)] if m else [ST.clean(lotplan).upper()]


def _lot_label(v: View, p, lines: list[str]) -> bool:
    """Two-line horizontal label centred at model point ``p``."""
    px, py = v.tp(*p)
    hs = [ST.REF.lot_h, ST.REF.plan_h][:len(lines)] if len(lines) == 2 else [ST.REF.plan_h]
    w = max(fonts.text_width(t, h) for t, h in zip(lines, hs)) + 3.0
    hh = sum(hs) + 3.0
    box = (px - w / 2, py - hh / 2, px + w / 2, py + hh / 2)
    if not v.free(box):
        return False
    v.occ.append(box)
    P = ST.Paper(v)
    if len(lines) == 2:
        P.text(px, py + 0.8, lines[0], hs[0], "BOTTOM_CENTER", layer="C-ANNO-LOTN")
        P.text(px, py - 0.8, lines[1], hs[1], "TOP_CENTER", layer="C-ANNO-LOTN")
    else:
        P.text(px, py, lines[0], hs[0], "MIDDLE_CENTER", layer="C-ANNO-LOTN")
    return True


def lot_label(v: View, poly: Polygon, lines: list[str], avoid=None, inset_mm: float = 8.0) -> bool:
    """LOT n / DPnnnnnn inside ``poly`` (the part in the view, inset from the frame), clear of ``avoid`` geometry.  Horizontal where it fits,
    rotated along the long axis of a narrow lot.  Returns False when no clear place exists."""
    win = v.window_poly().buffer(-inset_mm / v.k)
    part = poly.intersection(win)
    if avoid is not None and not part.is_empty:
        free = part.difference(avoid)
        if not free.is_empty and free.area > 0.15 * part.area:
            part = free
    if part.is_empty:
        return False
    best = max(getattr(part, "geoms", [part]), key=lambda g: g.area)
    if best.area * v.k * v.k < 80.0:                       # under 80 mm2 of paper: too small to carry a label
        return False
    cands = []
    try:
        cands.append(polylabel(best, tolerance=0.2 / v.k))
    except Exception:  # noqa: BLE001
        pass
    cands += [best.centroid, best.representative_point()]
    for c in cands:
        if best.contains(c) and _lot_label(v, (c.x, c.y), lines):
            return True
    mrr = list(best.minimum_rotated_rectangle.exterior.coords)
    e1, e2 = (mrr[1][0] - mrr[0][0], mrr[1][1] - mrr[0][1]), (mrr[2][0] - mrr[1][0], mrr[2][1] - mrr[1][1])
    ax = e1 if math.hypot(*e1) >= math.hypot(*e2) else e2
    ang = math.degrees(math.atan2(ax[1], ax[0]))
    txt = " ".join(lines)
    for c in cands:
        if best.contains(c) and v.label(c.x, c.y, txt, ST.REF.plan_h, ang, layer="C-ANNO-LOTN", halo=True, nudges=False):
            return True
    return False


def lot_labels(v: View, s: Site, avoid=None) -> None:
    """Subject lot and every neighbouring lot (not roads): DCDB label at the centre of the part inside the frame."""
    from app.agents.sa5_cad_dxf.planset import cadwin
    lot_label(v, s.lot, subject_lot_lines(s.inp.lot.lotplan), avoid)
    for label, poly, road in cadwin.all_lots(s):
        if not road:
            lot_label(v, poly, _lot_lines(label))


# ---- boundary bearings and distances: bearing above, distance below, upright, next to the line ------------------------------------------
def _leader_hit(v: View, *boxes) -> bool:
    """True when a call-out leader already drawn crosses one of the paper boxes."""
    from shapely.geometry import LineString
    for ld in v.leaders:
        if len(ld) < 2:
            continue
        ls = LineString([(p[0], p[1]) for p in ld])
        for b in boxes:
            pts = list(b) if not isinstance(b, (tuple, list)) or len(b) != 4 or not isinstance(b[0], (tuple, list)) else b
            xs = [q[0] for q in pts] if isinstance(pts[0], (tuple, list)) else [pts[0], pts[2]]
            ys = [q[1] for q in pts] if isinstance(pts[0], (tuple, list)) else [pts[1], pts[3]]
            if ls.intersects(Polygon([(min(xs), min(ys)), (max(xs), min(ys)), (max(xs), max(ys)), (min(xs), max(ys))])):
                return True
    return False


def _put(v: View, pt, text: str, h: float, rot: float, box) -> None:
    """Draw a boundary label on its white mask unconditionally (the free-space check was done, or deliberately overridden, by the caller) and reserve its box."""
    px, py = v.tp(*pt)
    v.occ.append(box)
    v._mask(px, py, fonts.text_width(text, h) + 0.8, h + 0.8, rot, "C-ANNO-BRNG")          # ``rot`` is the PAPER angle (upright)
    v.text(pt[0], pt[1], text, h, "MIDDLE_CENTER", v.model_rot(rot), False, layer="C-ANNO-BRNG", halo=False)


def boundary_labels(v: View, s: Site, xg: CX.CrossoverGeom, front) -> int:
    """Bearing (above) and distance (below) of every subject boundary segment from the cadastre, placed on the line, reading upright, clear
    of the crossover and of earlier labels.  Returns the number of segments labelled."""
    win = v.window_poly().buffer(-3.0 / v.k)
    h, n_done = ST.REF.label_h, 0
    for seg in s.inp.lot.segments:
        a, b = seg.start_xy, seg.end_xy
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 1e-6:
            continue
        brg = ST.clean(seg.bearing_dms)
        dist = f"{round(float(seg.distance_m), 2):.2f}m"
        tw = max(fonts.text_width(brg, h), fonts.text_width(dist, h)) + 2.0
        ranges = [(0.0, L)]
        if front is not None and seg.seq == front.seq and xg.present:
            s0 = xg.frontage.st(*a)[0]
            gap = 3.0 / v.k
            lo = xg.centre_s - xg.width_m / 2 - xg.flare_m - s0 - gap
            hi = xg.centre_s + xg.width_m / 2 + xg.flare_m - s0 + gap
            ranges = [(0.0, max(0.0, lo)), (min(L, hi), L)]
        ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        rot = v.paper_rot(math.degrees(math.atan2(uy, ux)))   # PAPER angle that reads upright
        ra = math.radians(v.model_rot(rot))
        nx, ny = -math.sin(ra), math.cos(ra)                 # the text's own up direction, in MODEL axes (it maps to paper up through the view twist)
        placed = False
        cand = []                                              # (range, fraction, offset mm): clear spots first, widening the offset
        wide = [r for r in sorted(ranges, key=lambda r: r[0] - r[1]) if (r[1] - r[0]) * v.k >= tw]
        for om in (1.8, 2.8, 4.2):
            for lo_, hi_ in wide:
                for f in (0.35, 0.65, 0.22, 0.78, 0.5, 0.15, 0.85, 0.42, 0.58):
                    cand.append((lo_, hi_, f, om))
        for lo_, hi_, f, om in cand:
            off = (h / 2 + om) / v.k
            t = lo_ + (hi_ - lo_) * f
            mx, my = a[0] + ux * t, a[1] + uy * t
            if not win.contains(Point(mx, my)):
                continue
            up, dn = (mx + nx * off, my + ny * off), (mx - nx * off, my - ny * off)
            bu = v._box(*v.tp(*up), brg, h, "MIDDLE_CENTER", rot, False)
            bd = v._box(*v.tp(*dn), dist, h, "MIDDLE_CENTER", rot, False)
            if v.free(bu) and v.free(bd) and not _leader_hit(v, bu, bd):
                _put(v, up, brg, h, rot, bu)
                _put(v, dn, dist, h, rot, bd)
                placed = True
                break
        if not placed:                                         # never skip: place on the longest visible stretch over a white mask
            t0 = None
            best = (-1.0, None)
            src = wide or [(lo_, hi_) for lo_, hi_ in ranges]
            for lo_, hi_ in src:
                for f in (0.5, 0.3, 0.7, 0.15, 0.85):
                    t = lo_ + (hi_ - lo_) * f
                    P = Point(a[0] + ux * t, a[1] + uy * t)
                    sc = -P.distance(win) if not win.contains(P) else (hi_ - lo_) * (1.0 - abs(f - 0.5))
                    if sc > best[0]:
                        best, t0 = (sc, t), t
            if t0 is not None:
                mx, my = a[0] + ux * t0, a[1] + uy * t0
                p = Point(mx, my)
                if not win.contains(p):                        # clamp into the frame
                    from shapely.ops import nearest_points
                    q = nearest_points(win, p)[0]
                    mx, my = q.x, q.y
                off = (h / 2 + 1.8) / v.k
                for pt, tx in (((mx + nx * off, my + ny * off), brg), ((mx - nx * off, my - ny * off), dist)):
                    _put(v, pt, tx, h, rot, v._box(*v.tp(*pt), tx, h, "MIDDLE_CENTER", rot, False))
                placed = True
        if placed:
            n_done += 1
    return n_done


# ---- road names ------------------------------------------------------------------------------------------------------------------------
def road_labels(v: View, s: Site, xg: CX.CrossoverGeom, front) -> int:
    """Road name along the road, upright, outside the lot.  Placed last so it clears call-outs and their leaders."""
    n = 0
    for seg in s.inp.lot.segments:
        nm = s.road_name_by_seq.get(seg.seq, "")
        if not nm:
            continue
        txt = ST.clean(nm).upper()
        half_m = fonts.text_width(txt, ST.REF.road_h) / v.k / 2.0
        is_front = front is not None and seg.seq == front.seq and xg.frontage is not None and bool(xg.kerb_offset_m)
        cands: list[tuple[float, float, float]] = []
        if is_front:
            fr = xg.frontage
            ang = math.degrees(math.atan2(fr.u[1], fr.u[0]))
            c0 = xg.centre_s if xg.present else fr.length / 2.0
            clear = (xg.width_m / 2 + xg.flare_m + ST.REF.band_extra_m + 1.0) if xg.present else 0.0
            ss = [c0 - clear - half_m - 1.0, c0 + clear + half_m + 1.0] + [fr.length * f for f in (0.2, 0.8, 0.35, 0.65, 0.05, 0.95, -0.3, 1.3, -0.6, 1.6)]
            for sf in ss:
                x, y = fr.xy(sf, xg.kerb_offset_m + 9.0 / v.k)
                cands.append((x, y, ang))
        else:
            a, b = seg.start_xy, seg.end_xy
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            if L < 1e-6:
                continue
            ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
            nx, ny = -uy, ux
            if s.lot.contains(Point((a[0] + b[0]) / 2 + nx * 0.5 / v.k, (a[1] + b[1]) / 2 + ny * 0.5 / v.k)):
                nx, ny = -nx, -ny
            ang = math.degrees(math.atan2(uy, ux))
            for f in (0.5, 0.3, 0.7, 0.15, 0.85):
                cands.append((a[0] + ux * L * f + nx * 12.0 / v.k, a[1] + uy * L * f + ny * 12.0 / v.k, ang))
        for x, y, ang in cands:
            if any(_text_poly(v, x, y, txt, ST.REF.road_h, ang).buffer(1.0).intersects(LineString(q)) for q in v.leaders):
                continue
            if v.label(x, y, txt, ST.REF.road_h, ang, layer="C-ANNO-ROAD", halo=False, nudges=False):
                n += 1
                break
    return n


def a3_scale(scale: int) -> int:
    """The same drawing at A3 is half the paper size, so the scale denominator doubles (1:100 @ A1 is 1:200 @ A3)."""
    return int(scale) * 2


def scale_pair(scale: int) -> str:
    return f"1:{scale} @ A1    1:{a3_scale(scale)} @ A3"


def title_strip(sh: Sheet, title: str, scale_line: str, bar_scale: int | None = None, notes=()) -> View:
    """White strip directly above the title block (Clarence Village style): bold UPPERCASE view title with a red underline, the scale with BOTH
    sizes under it (e.g. 1:100 @ A1 and 1:200 @ A3), the reason line when the scale or view was not the preferred one, and the graduated scale bar
    beside the title.  A separate paper view, so the plan viewport above it stays clean."""
    v = sh.add(View("strip", STRIP_RECT))
    P = ST.Paper(v)
    x0, top = STRIP_RECT[0] + 6.0, STRIP_RECT[3]
    P.line([(STRIP_RECT[0], top), (STRIP_RECT[2], top)], "C-ANNO-NOTE", 0.35, ST.BLACK)
    t = ST.clean(title).upper()
    th = 5.2
    tw = fonts.text_width(t, th, True)
    P.text(x0, top - 3.5, t, th, "TOP_LEFT", bold=True, layer="C-ANNO-NOTE")
    yu = top - 3.5 - th - 2.2
    P.line([(x0, yu), (x0 + max(tw, 40.0), yu)], "C-ANNO-NOTE", 0.7, RED_UL)
    sl = ST.clean(scale_line).upper() if scale_line else ""
    P.text(x0 + 1.0, yu - 2.2, sl, 3.4, "TOP_LEFT", layer="C-ANNO-NOTE")
    sw = fonts.text_width(sl, 3.4)
    yy = yu - 2.2 - 3.4 - 1.8
    yy = top - 18.6
    strip_end = x0 + max(tw, sw, 40.0)
    for n_ in notes:
        for ln in fonts.wrap(ST.clean(n_).upper(), 2.4, 560.0, True)[:2]:
            if yy > STRIP_RECT[1] + 1.0:
                P.text(x0 + 1.0, yy, ln, 2.4, "TOP_LEFT", bold=True, layer="C-ANNO-NOTE")
                strip_end = max(strip_end, x0 + 1.0 + fonts.text_width(ln, 2.4, True))
                yy -= 3.1
    if bar_scale:
        bx = x0 + max(tw, sw, 40.0) + 34.0
        if notes:
            bx = max(bx, x0 + 300.0)
        ST.scale_bar_ref(v, bx, top - 12.5, bar_scale)
        strip_end = max(strip_end, bx + 56.0)                 # graduated bar and its labels
    sh.strip_end = strip_end                                   # the datum and notes panel stays right of the strip text
    return v


RED_UL = (0.80, 0.08, 0.08)


def _symbol(sv):
    t = (sv.label or "").lower()
    if "hydrant" in t:
        return ST.hyd
    if "meter" in t or t.strip() == "wm":
        return ST.water_meter
    if sv.service == "telecom":
        return ST.tpit
    if "grate" in t or (sv.service == "stormwater" and "pit" in t):
        return ST.grate
    return None


def _services(v: View, s: Site, missing: list[str], which: tuple | None = None) -> tuple[int, list]:
    """Draw services.  Returns (count drawn, pending call-outs for existing lines: (lines, model point)); call-outs are placed after the crossover ones."""
    from app.agents.sa5_cad_dxf.layers import SERVICE_LAYER
    n, pending = 0, []
    for sv in s.inp.services:
        if which is not None and sv.service not in which:
            continue
        g = swkt.loads(sv.geometry_wkt)
        if g.geom_type == "Point":
            fn = _symbol(sv)
            if fn is None:
                missing.append(f"point service {ST.clean(sv.label)} ({sv.service}) has no symbol in the reference set")
            elif v.inside(g.x, g.y, 4):
                fn(v, g.x, g.y)
                n += 1
            continue
        v.geom(g, SERVICE_LAYER[sv.service], lw=0.25, dash="DASHED" if sv.is_proposed else None, color=ST.BLACK)
        c = g.representative_point()
        txt = ST.clean(sv.label).upper() + (f" DN{sv.diameter_mm}" if sv.diameter_mm else "") + (" (PROPOSED)" if sv.is_proposed else " (EXISTING)")
        if sv.is_proposed:
            ST.label_masked(v, c.x, c.y, txt, 2.5, 0, "C-ANNO-SERV")
        else:
            pending.append(([txt, DBYD_TEXT], (c.x, c.y)))
        n += 1
    return n, pending


def _ffl_lines(s: Site) -> list[str]:
    if s.ffl is None:
        return []
    if s.inp.ffl_value is not None and s.inp.ffl_label:
        return [f"DESIGN FFL RL {s.ffl:.2f} m AHD (SUPPLIED)"]
    return [f"MEAN EXISTING GROUND UNDER FOOTPRINT RL {s.ffl:.2f} m AHD (DEM-DERIVED, INDICATIVE)", "DESIGN FFL NOT SET. FLOOD FREEBOARD NOT CHECKED."]


def c101_ref(ctx: RefCtx, aerial: bool | None = None) -> Sheet:
    """Proposed site plan (built in sheets_ref2 on the shared plan base)."""
    from app.agents.sa5_cad_dxf.planset import sheets_ref2 as S2
    return S2.c101(ctx)
