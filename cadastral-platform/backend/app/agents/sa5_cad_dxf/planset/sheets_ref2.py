"""Reference-style sheets: C000 cover, C001 general notes (sheet 2), C100 to C500 plan and driveway sheets, C600 details, on A1 in the JCESITE frame.

Data rules (unchanged): nothing is invented.  Absent data show the DATA NOT AVAILABLE panel, assumed items are labelled ASSUMED, defaults PLATFORM
DEFAULT, drafting conventions (PLACEHOLDER).  The dwelling is NOT drawn (another tool handles the house).  General notes live on C001 only (including
that detail survey is undertaken at the detailed design stage); each plan sheet carries only notes specific to it.
Plan sheets: scale 1:100 where the subject lot plus margin fits, else 1:200, 1:250 ...; the subject lot stays fully in view, the cadastre is fetched for the
viewport window and clipped to it (edge to edge, LOT n over DP labels), and the view is ROTATED (viewport.py) before 1:100 is given up.
Driveway and crossover dimensions are drawn on the driveway sheets only (C101, C400, C420).
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

import numpy as np
from shapely import affinity
from shapely.geometry import LineString, Point, Polygon, box as sbox
from shapely.ops import unary_union

from app.agents.sa5_cad_dxf.planset import building_draw as BD
from app.agents.sa5_cad_dxf.planset import dbyd_draw as DD
from app.agents.sa5_cad_dxf.planset import callout as CO
from app.agents.sa5_cad_dxf.planset import cadwin
from app.agents.sa5_cad_dxf.planset import lga_notes as LN
from app.agents.sa5_cad_dxf.planset import panels as PN
from app.agents.sa5_cad_dxf.planset import phrases as PH
from app.agents.sa5_cad_dxf.planset import sections as SEC
from app.agents.sa5_cad_dxf.planset import typical_details as TD
from app.agents.sa5_cad_dxf.planset.typicals import refs_short
from app.agents.sa5_cad_dxf.planset.terrain_notes import dem_fall, drainage_discharge_note, fall_vs_street  # noqa: F401
from app.agents.sa5_cad_dxf.planset import viewport as VP
from app.agents.sa5_cad_dxf.planset import codes
from app.agents.sa5_cad_dxf.planset import collide
from app.agents.sa5_cad_dxf.planset import crossover as CX
from app.agents.sa5_cad_dxf.planset import draw as D
from app.agents.sa5_cad_dxf.planset import fonts
from app.agents.sa5_cad_dxf.planset import sheets_other as SO
from app.agents.sa5_cad_dxf.planset import sheets_plan as SP
from app.agents.sa5_cad_dxf.planset import style as ST
from app.agents.sa5_cad_dxf.planset.core import A1, STD_SCALES, Item, Sheet, View, pick_scale
from app.agents.sa5_cad_dxf.planset.data import Site, contour_sets
from app.agents.sa5_cad_dxf.planset.dimstyle import dim_best
from app.agents.sa5_cad_dxf.planset.frame_a1 import _fit, notes_layout
from app.agents.sa5_cad_dxf.planset.sheets_ref import _text_poly as _tp
from app.agents.sa5_cad_dxf.planset.sheets_ref import (PAVEMENT_BASIS, PAVEMENT_MISSING, PAVEMENT_TEXT, PLAN_RECT, STRIP_H, STRIP_RECT, SUBJECT_MARGIN_MM, VIEW_RECT, RefCtx,
                                                       _front_segment, _services, _ffl_lines, a3_scale, boundary_labels, lot_labels, road_labels, scale_pair,
                                                       subject_lot_lines, title_strip)

TXT = ST.TXT
RED = (0.72, 0.1, 0.1)
AMBER = (0.72, 0.45, 0.05)
DISCL = SO.DISCL
PAD_TBC = "finished floor level TBC (no cited flood level in the data), so no pad level, cut, fill or batter is assumed or calculated"
NO_DWELLING = "building design (the building is not part of this plan set and no building footprint or level is drawn)"
DEM_NOTE_REF = "INDICATIVE, DERIVED FROM 5 m DEM"
CONTOUR_NOTE = "EXISTING CONTOURS: LABELS ARE RL m AHD, INDEX (MAJOR) CONTOURS HEAVIER, " + DEM_NOTE_REF
SWEPT_TBC = "SWEPT PATH: TO BE CONFIRMED AT DETAILED DESIGN"
DRIVE_END = "DRIVEWAY END (PLATFORM DEFAULT LEVEL, NOT DESIGNED)"
KERB_STATION = "KERB LINE (GROUND, ASSUMED)"
BAND_STATION = "BACK OF KERB AND GUTTER BAND (GROUND, ASSUMED)"
BAND_STATION_CITED = "BACK OF LAYBACK (E.J.)"            # SD-107: the expansion joint at the back of the layback, the same station as the layback run on C420
BDY_STATION = "PROPERTY BOUNDARY (GROUND)"
DRIVEWAY_SHEETS = ("C101", "C400", "C420")
LAYOVER_REF = ["LAYOVER DIMENSIONS (SEE C420)", "FULL SCHEDULE, SOURCES AND TYPICAL SECTIONS ON C420"]      # the layover is dimensioned in full on its own sheet


def draw_ctrs(b, light: bool = True, column_w: float = 0.0, labels: bool = True, lines: bool = True, extra_avoid=None) -> int:
    """Existing contours with RL labels (stage 8: on every plan sheet), labels clear of the dwelling and of everything already reserved."""
    s, v = b.s, b.v
    if s.tin is None:
        return 0
    contour_sets(s, v.model_window())
    R = v.rect
    strips = ((R[0], R[1], R[0] + column_w + 6.0, R[3]), (R[2] - column_w - 6.0, R[1], R[2], R[3])) if column_w else ()          # the data-panel column goes against either edge: keep labels out of both
    av = [g for g in ([s.footprint] if s.placement is not None else []) + list(extra_avoid or []) if g is not None and not g.is_empty]
    return D.contours(v, s, "ex", labels=labels, lab_h=D.CONTOUR_LAB_H, light=light, avoid=unary_union(av) if av else None, no_label_rects=strips, lines=lines)


def ctr_notes(s: Site) -> list[str]:
    return [CONTOUR_NOTE] if s.tin is not None else []


def building_status_text(s: Site) -> str:
    """Cover line for the building: what is drawn and where it came from (stage 8), or that none is."""
    pl = s.placement
    if pl is None or not pl.placed:
        return "NOT PART OF THIS SET: NO BUILDING FOOTPRINT, SETBACK OR FLOOR LEVEL IS DRAWN."
    ffl = f"FINISHED FLOOR LEVEL RL {pl.ffl_m:.2f} m AHD" if pl.ffl_m is not None else "FINISHED FLOOR LEVEL TBC"
    return f"{pl.source}: A TYPICAL HOUSE PLACED TO THE CITED SETBACKS, NOT A DESIGN FOR THIS LOT. {ffl}."


def draws_dwelling(s: Site) -> bool:
    """A dwelling is drawn when a building was placed (stage 8) or the legacy opt-in is set."""
    return bool(s.placement is not None or s.inp.show_dwelling)


def _dedupe(xs) -> list[str]:
    return list(dict.fromkeys(ST.clean(x) for x in xs if x))


def make_xg(s: Site, reach: float = 0.0):
    front = _front_segment(s)
    fseg = (front.start_xy, front.end_xy) if front is not None else None
    drv = s.inp.driveway
    kuser = drv.kerb_to_boundary_user_supplied if drv is not None else None
    std = drv.council_standard_label if drv is not None else None
    cit = CX.cited_crossing(getattr(getattr(s, "cites", None), "typ", None))             # council standard drawing geometry (SD-107) where the council data has it
    xg = CX.build_crossover(fseg, s.lot, s.crossover, CX.default_kerb_offset_m(), True, reach, kuser, cit)
    xg.drive_width_m = drv.width_m if drv is not None else 0.0
    if cit is not None:
        std = cit.label                              # the council standard drawing the crossing is drawn to
    xg.std_label = std                               # provenance of the width and splay (platform default unless a council standard was selected)
    return front, drv, std, xg


def neighbour_polys(s: Site) -> list[Polygon]:
    return [p for _l, p, r in s.neighbours if not r]          # adjoining lots only (cover locality plan)


def _wrap_h(lines, w: float, h: float = 2.4, bold_first: bool = False) -> float:
    return 8.0 + sum(len(fonts.wrap(x, h, w - 5)) * (h + 1.0) + 0.8 for x in lines)


# ====================================================================================================== plan base (C100..C500)
@dataclass
class Base:
    s: Site
    sh: Sheet
    v: View
    scale: int
    fit: tuple
    nrect: tuple
    front: object
    drv: object
    std: object
    xg: CX.CrossoverGeom
    rows: list
    pre: list
    keep: list = field(default_factory=list)
    panel: tuple | None = None
    pave: object = None
    hard: list = field(default_factory=list)
    choice: object = None                 # viewport.ViewChoice: scale, twist, reason lines
    strip: object = None


def fit_scale(ext, rects, margin, min_scale: int = 100):
    w, h = ext[2] - ext[0], ext[3] - ext[1]
    for sc in (x for x in STD_SCALES if x >= min_scale):
        for r in rects:
            if w * 1000.0 / sc + 2 * margin <= r[2] - r[0] and h * 1000.0 / sc + 2 * margin <= r[3] - r[1]:
                return sc, r
    return STD_SCALES[-1], rects[0]


def start(ctx: RefCtx, number: str, rows=(), notes=(), want_xover: bool = False, focus: str = "lot") -> Base:
    """Common plan base: scale chooser (1:100 first, view rotation before a smaller drawing), cadastre padded to the viewport, faded aerial when
    supplied, assumed road pavement, neighbours to the viewport edge."""
    s, proj = ctx.site, ctx.proj
    sh = Sheet(number, codes.SHEET_TITLES[number], "", paper=A1, north=0.0)
    front, drv, std, xg0 = make_xg(s, 0.0)
    pre = _dedupe(list(notes) + (CX.crossover_notes(xg0, std) if want_xover else []))
    nrect, _ = notes_layout(proj, pre, (), reserve=3)
    rows = [ST.clean(r).upper() for r in rows]
    ph = 0.0
    if rows:
        extra = "  ".join(f"({i + 1}) {r}." for i, r in enumerate(rows))
        ph = PN.panel_height(["NOT DRAWN, NO DATA SUPPLIED:", extra], 102.0)
    lot_subject = unary_union([s.lot] + [g for g in (s.drive_poly, s.crossover, xg0.verge) if g is not None])
    if s.view_twist is None:                                             # one orientation for the whole set, decided once from the lot
        s.view_twist = VP.baseline_twist(lot_subject, s.lot, PLAN_RECT, SUBJECT_MARGIN_MM)
    if focus == "drive" and s.drive_poly is not None and xg0.present:
        subject_g = unary_union([g for g in (s.drive_poly, xg0.body, xg0.band, xg0.wing_a, xg0.wing_b) if g is not None and not g.is_empty])
        margin, min_sc, align = 30.0, 50, None
    else:
        subject_g, margin, min_sc, align = lot_subject, SUBJECT_MARGIN_MM, 100, s.lot
    vx, vy = (PLAN_RECT[0] + PLAN_RECT[2]) / 2, (PLAN_RECT[1] + PLAN_RECT[3]) / 2
    nrect, _ = notes_layout(proj, pre, (), reserve=0)
    rects = [PLAN_RECT] if nrect[3] <= PLAN_RECT[1] + 0.5 else [(PLAN_RECT[0], max(nrect[3] + 3.0, PLAN_RECT[1]), PLAN_RECT[2], PLAN_RECT[3]), (PLAN_RECT[0], PLAN_RECT[1], nrect[0] - 3.0, PLAN_RECT[3])]
    ch = VP.choose_view(subject_g, rects, margin, min_scale=min_sc, align_poly=align, prefer_twist=s.view_twist)
    scale, r, twist = ch.scale, ch.rect, ch.twist
    k = 1000.0 / scale
    fx, fy = (r[0] + r[2]) / 2, (r[1] + r[3]) / 2                      # the full plan rectangle on every sheet, so the plan sheets overlay exactly
    centre = VP.centre_for(subject_g, twist, scale, vx, vy, fx, fy)
    panel = None
    if rows:                                                             # DATA NOT AVAILABLE panel: the first corner that does not touch the subject
        tv = View("t", PLAN_RECT, centre, scale, twist=twist)
        pw = 102.0
        corners = [(PLAN_RECT[0] + 4.0, PLAN_RECT[3] - 4.0 - ph), (PLAN_RECT[0] + 4.0, PLAN_RECT[1] + 4.0),
                   (PLAN_RECT[2] - 4.0 - pw, PLAN_RECT[1] + 4.0), (PLAN_RECT[2] - 4.0 - pw, PLAN_RECT[3] - 4.0 - ph)]
        for cx0, cy0 in corners:
            cand = (cx0, cy0, cx0 + pw, cy0 + ph)
            pb = Polygon([tv.tm(px, py) for px, py in ((cand[0], cand[1]), (cand[2], cand[1]), (cand[2], cand[3]), (cand[0], cand[3]))])
            if not pb.buffer(3.0 / k).intersects(subject_g):
                panel = cand
                break
        if panel is None:
            panel = corners[0]
    sh.scale_text = f"1:{scale} @ A1"
    v = sh.add(View("main", PLAN_RECT, centre, scale, twist=twist))
    cadwin.ensure(s, v)                                                  # pad the cadastre to this viewport (window derived from the viewport)
    reach = math.hypot(PLAN_RECT[2] - PLAN_RECT[0], PLAN_RECT[3] - PLAN_RECT[1]) / k
    front, drv, std, xg = make_xg(s, reach)
    D.aerial_underlay(v, s)                                            # faded greyscale aerial when imagery was supplied; nothing otherwise
    lots = cadwin.all_lots(s)
    roads = [p for _l, p, r_ in lots if r_]
    pave = None
    if xg.kerb_line is not None and roads:
        fr = xg.frontage
        half = fr.poly([(-reach, xg.kerb_offset_m), (fr.length + reach, xg.kerb_offset_m), (fr.length + reach, xg.kerb_offset_m + reach), (-reach, xg.kerb_offset_m + reach)])
        pave = unary_union(roads).intersection(half)
        if pave.is_empty or pave.area < 1e-6:
            pave = None
        else:
            ST.bitumen_fill(v, pave)
    for _l, p, _r in lots:
        v.geom(p, "C-PROP-ADJN", lw=ST.REF.neighbour_lw, color=ST.FENCE)      # clipped to the viewport: lines run edge to edge
    b = Base(s, sh, v, scale, r, nrect, front, drv, std, xg, rows, pre, pave=pave, choice=ch)
    if rows:
        b.panel = panel
    b.hard = [g for g in (xg.band, xg.body, xg.wing_a, xg.wing_b) if g is not None and not g.is_empty] if xg.present else []
    b.kerb_geoms = []                                                    # kerb and gutter lines: callout boxes keep off them
    if xg.kerb_line is not None:
        fr = xg.frontage
        for off in (xg.kerb_offset_m, xg.kerb_offset_m - xg.band_w_m):
            b.kerb_geoms.append(LineString([fr.xy(-reach, off), fr.xy(fr.length + reach, off)]).buffer(0.25))
    return b


def road_rows(s: Site, xg: CX.CrossoverGeom, front, pave) -> list[str]:
    out = []
    if xg.kerb_line is None:
        out.append("kerb line and road edge (no front boundary segment in the lot data)" if front is None else "kerb line and road edge (no verge depth available)")
    elif pave is None:
        out.append(PAVEMENT_MISSING)
    return out


def draw_xover(b: Base, mode: str = "proposed", dims: bool = False, light: bool = False) -> None:
    """mode 'existing': assumed kerb and gutter lines only.  'proposed': crossover and driveway in the lot (dims: driveway sheets only)."""
    s, v = b.s, b.v
    CX.draw_crossover(v, b.xg, b.std, kerb_only=(mode == "existing"), light=light)
    if mode == "existing":
        return
    if s.drive_poly is not None:
        di = s.drive_poly.intersection(s.lot)
        if not di.is_empty:
            ST.driveway_fill(v, di, SEC.TypicalValues(s.cites).material())
            b.hard.append(di)
    if dims:
        CX.layover_dims(v, b.xg)


def finish(b: Base, title: str, reserve=()) -> None:
    """Boundary, north point (rotated with the view), title strip (title, both scales, scale bar) and DATA NOT AVAILABLE panel are reserved first,
    then boundary bearings and distances and LOT/DP labels are placed around them."""
    s, v, sh = b.s, b.v, b.sh
    ST.boundary(v, s.lot)
    lotb = to_paper(v, s.lot.boundary).buffer(2.0)
    ncx, ncy = PLAN_RECT[2] - 38.0, PLAN_RECT[3] - 28.0
    for cx_, cy_ in ((PLAN_RECT[2] - 38.0, PLAN_RECT[3] - 28.0), (PLAN_RECT[2] - 38.0, PLAN_RECT[1] + 28.0), (PLAN_RECT[0] + 38.0, PLAN_RECT[1] + 28.0),
                     (PLAN_RECT[0] + 38.0, PLAN_RECT[3] - 28.0)):           # first corner where no boundary line runs through the north point
        r_ = sbox(cx_ - 21.0, cy_ - 21.0, cx_ + 30.0, cy_ + 24.0)
        if lotb.intersects(r_) or (b.rows and sbox(*b.panel).intersects(r_)) or any(sbox(*q_).intersects(r_) for q_ in reserve):
            continue
        ncx, ncy = cx_, cy_
        break
    ST.north_point(v, ncx, ncy, 15.0, (-v.twist) % 360.0)
    keep = [(ncx - 21.0, ncy - 21.0, ncx + 30.0, ncy + 24.0), (b.nrect[0] - 3, b.nrect[1] - 1, b.nrect[2] + 1, b.nrect[3] + 3)]
    b.strip = title_strip(sh, title, scale_pair(b.scale), b.scale, notes=list(b.choice.notes) + cadwin.cad_notes(s))
    if b.rows:
        extra = "  ".join(f"({i + 1}) {r}." for i, r in enumerate(b.rows))
        PN.no_data(v, b.panel, "NOT DRAWN, NO DATA SUPPLIED:", extra)
        keep.append(b.panel)
    keep += [tuple(r_) for r_ in reserve]                      # extra paper rectangles the caller will fill (reserved before any label is placed)
    b.keep = keep
    for kb in keep:
        v.reserve(kb)
    boundary_labels(v, s, b.xg, b.front)
    avoid = unary_union([g for g in b.hard if g is not None and not g.is_empty] or [Point(1e9, 1e9)]).buffer(2.0 / v.k)
    lot_labels(v, s, avoid)
    sh.data_missing = list(b.rows) + ([x.capitalize() for x in cadwin.cad_notes(s)] if s.cad_complete is not True else [])


def seal(b: Base, extra_notes=()) -> Sheet:
    """Road names (last, so they clear call-outs and leaders), the label collision pass, then the sheet-specific notes."""
    s, v = b.s, b.v
    road_labels(v, s, b.xg, b.front)
    collide.resolve(v)
    b.sh.notes = _dedupe(list(b.pre) + list(extra_notes))
    b.sh.tag_notes = _tag_notes(v, to_paper(v, unary_union([g for g in [s.lot, s.drive_poly, s.crossover] + list(getattr(b, "kerb_geoms", [])) if g is not None])).buffer(3.0))
    return b.sh


def _tag_notes(v: View, avoid=None) -> list[str]:
    """Text of call-outs and labels that found no free place: drawn as a boxed notes list on the sheet when there is room, else returned for the datum panel
    (never dropped, and never left to wrap in the datum panel when a proper list fits)."""
    lines = list(v.fallback_notes)
    if lines and PN.place_notes_panel(v, lines, avoid) is not None:
        return []
    return lines


def place(b: Base, lines, pt, term="dot", must=True, avoid=(), short_first: float | None = None):
    return CO.place_callout(b.v, lines, pt, term, b.keep, avoid=list(avoid), soft_avoid=[b.s.lot], must=must, must_avoid=list(getattr(b, 'kerb_geoms', [])), short_first=short_first)


def to_paper(v: View, g):
    return v.to_paper_geom(g)


def place_panel(b: Base, w: float, h: float):
    """First free paper rectangle (w x h) away from the plan linework and earlier labels; reserved on success, None when the sheet is full."""
    v = b.v
    R = PLAN_RECT
    subj = to_paper(v, unary_union([g for g in [b.s.lot, b.s.drive_poly, b.s.crossover] + list(getattr(b, "kerb_geoms", [])) if g is not None])).buffer(3.0)
    xs = [R[2] - 4 - w, R[0] + 4, (R[0] + R[2]) / 2 - w / 2, R[2] - 4 - w - w - 6, R[0] + 4 + w + 6]
    ys = [R[3] - 70 - h, R[3] - 4 - h, R[1] + 6.0, (R[1] + R[3]) / 2 - h / 2, R[3] - 4 - h - 20]
    for yy in ys:
        for xx in xs:
            r = (xx, yy, xx + w, yy + h)
            if r[0] < R[0] + 2 or r[2] > R[2] - 2 or r[1] < R[1] + 2 or r[3] > R[3] - 2:
                continue
            if v.free((r[0] - 3.0, r[1] - 3.0, r[2] + 3.0, r[3] + 3.0)) and not subj.intersects(sbox(*r)):
                v.reserve(r)
                b.keep.append(r)
                return r
    return None


def text_panel(b: Base, title: str, lines, w: float = 100.0, warn: bool = False, h_text: float = TXT.BODY):
    h = PN.panel_height(lines, w, h_text, title)
    r = place_panel(b, w, h)
    if r is None:
        for ln in [title] + list(lines):
            CO.fallback_tag(b.v, [ln], (0, 0), hidden=True)
        return None
    PN.draw_panel(b.v, r, title, lines, warn=warn, h=h_text)
    return r


def pave_callout(b: Base) -> None:
    if b.pave is None:
        return
    v = b.v
    p = b.pave.intersection(v.window_poly().buffer(-10 / v.k))
    p = b.pave if p.is_empty else p
    rp = max(getattr(p, "geoms", [p]), key=lambda g: g.area).representative_point()
    place(b, [PAVEMENT_TEXT, PAVEMENT_BASIS], (rp.x, rp.y), "dot", must=False, avoid=b.hard)


def cited(s: Site, keys) -> list[str]:
    """Readable cited sentences (phrases.py) for the keys that resolve; a key without a sentence is dropped, never printed raw."""
    return [t for t in (PH.sentence(s.cites, k) for k in keys) if t]


# ====================================================================================================== driveway profile, checks, earthworks
def ref_profile(s: Site):
    """Existing ground and platform design stations along the SA3 centreline, chainage 0 = kerb line.  Stations: kerb line, back of the kerb and
    gutter band (CX.gutter_band_m, the same band as the plan), property boundary and, when the platform default end level exists, the driveway end."""
    if s.drive_cl is None or s.tin is None:
        return None
    cl = s.drive_cl
    L = cl.length
    c = list(cl.coords)
    xg = make_xg(s, 0.0)[3]
    gw = CX.gutter_band_m(xg.kerb_offset_m or CX.default_kerb_offset_m(), xg.cited.layback_run_m if getattr(xg, "cited", None) else None)
    sb = None
    for g in s.inp.lot.segments:
        h = cl.intersection(LineString([g.start_xy, g.end_xy]))
        if h.geom_type == "Point" and (g.is_front or sb is None):
            sb = cl.project(h)
    sb = sb if sb is not None else 0.0
    ex = []
    for t in [i * 0.5 for i in range(int(L / 0.5) + 1)] + [L]:
        q = cl.interpolate(min(t, L))
        z = float(s.tin.z_at(q.x, q.y))
        if np.isfinite(z):
            ex.append((t, z))
    if len(ex) < 3:
        return None
    exz = lambda t: float(np.interp(t, [e[0] for e in ex], [e[1] for e in ex]))   # noqa: E731
    cit_ = getattr(xg, "cited", None)
    st = [(0.0, exz(0.0), KERB_STATION), (gw, exz(gw), BAND_STATION_CITED if cit_ is not None else BAND_STATION), (sb, exz(sb), BDY_STATION)]
    # a driveway END level is never defaulted: only a supplied or cited finished floor level gives one (the illustrative mean ground under a footprint does not)
    proposed = s.ffl is not None and "ILLUSTRATIVE" not in str(getattr(s, "ffl_note", "") or "").upper()
    if proposed:
        st.append((L, float(s.ffl), DRIVE_END))
    out, last = [], -9.0
    for t, z, nm in sorted(st):
        if t - last < 0.05 and out:
            continue
        out.append((t, z, nm))
        last = t
    p = {"ex": ex, "st": out, "L": L, "sb": sb, "gw": gw, "proposed": proposed and len(out) >= 3, "exz": exz, "checks": [], "typ": _typical_line(s, cit_, exz, gw, sb)}
    if p["proposed"]:
        from app.agents.sa3_driveway.profile import check_profile
        p["checks"] = check_profile(out, vehicle=(s.inp.driveway.design_vehicle if s.inp.driveway is not None else "B85"))
        ts, zs = [o[0] for o in out], [o[1] for o in out]
        p["design"] = lambda t: float(np.interp(t, ts, zs))     # noqa: E731
    else:
        p["design"] = None
    return p


def _typical_line(s: Site, cit, exz, gw: float, sb: float):
    """The council typical longitudinal line of the vehicle crossing (SD-107 section), from the ASSUMED kerb RL (existing ground at chainage 0) to the property boundary:
    the near-vertical lip rises back to edge level (the 40 fall), the layback rises 60 over its 450 run to the expansion joint, then the pathway crossfall (1.5 to 2.5 percent,
    rising away from the kerb) to the boundary.  Indicative: no verge is designed and no driveway end level is given.  None when the council data lacks any of these values."""
    T = getattr(getattr(s, "cites", None), "typ", None)
    if cit is None or T is None or sb <= gw + 0.05 or abs(gw - cit.layback_run_m) > 1e-6:
        return None
    lip, rise, cf = (T.get("sd107.section.gutter_crossing_fall_edge_to_flowline"), T.get("sd107.section.layback_top_above_road_side_edge"), T.get("sd107.crossfall.pathway_crossing"))
    back = T.get("eng.crossing.layback_back_height")
    if lip is None or rise is None or cf is None or lip.mm is None or rise.mm is None or cf.rng is None:
        return None
    z0 = exz(0.0)
    z_lip = z0 + lip.mm / 1000.0
    z_ej = z_lip + rise.mm / 1000.0
    lo, hi = cf.rng
    mid = (lo + hi) / 2.0

    def at(t: float, pct: float = mid) -> float | None:
        if t < -1e-9 or t > sb + 1e-9:
            return None
        if t <= 1e-9:
            return z0
        if t <= gw:
            return z_lip + (z_ej - z_lip) * t / gw
        return z_ej + pct / 100.0 * (t - gw)
    return {"z0": z0, "z_lip": z_lip, "z_ej": z_ej, "t_ej": gw, "sb": sb, "pcts": (lo, mid, hi), "at": at, "lip": lip, "rise": rise, "crossfall": cf, "back": back,
            "run": cit.layback_run_m}


NO_VERGE_DESIGN = "NO VERGE DESIGN: DESIGN LINE SHOWN AS EXISTING SURFACE FROM THE KERB LINE TO THE PROPERTY BOUNDARY"


def verge_fall(s: Site) -> int | None:
    """Direction of the EXISTING surface from the kerb line to the property boundary (-1 falls towards the lot, +1 rises, None = flat within 0.5 percent or no levels).
    Read from the same profile as C410, so C420 never contradicts it; no design level is invented for the verge."""
    p = ref_profile(s)
    if p is None or p["sb"] - 0.0 < 0.5:
        return None
    g = 100.0 * (p["exz"](p["sb"]) - p["exz"](0.0)) / p["sb"]
    return None if abs(g) < 0.5 else (-1 if g < 0 else 1)


CHECK_TITLE = "PLATFORM SCREENING CHECKS (NOT A COUNCIL COMPLIANCE CHECK)"


def _veh_of(ch) -> str:
    m = re.match(r"\s*(B\d\d)\b", str(getattr(ch, 'note', '') or ''))
    return m.group(1) if m else "B85"


def _check_text(ch) -> str:
    """Readable platform screening line: what was screened, the value and the PLATFORM limit (never PASS or FAIL against a council requirement)."""
    nm = ch.name
    if nm == "max_grade":
        what = "STEEPEST GRADE ALONG THE DRIVEWAY PROFILE"
    elif nm.startswith("change_of_grade"):
        what = "CHANGE OF GRADE AT " + nm.split("@", 1)[-1].replace("_", " ").upper()
    elif nm == "b85_scraping_clearance":
        what = f"{_veh_of(ch)} UNDERBODY CLEARANCE ALONG THE PROFILE, FORWARD AND REVERSE"
    else:
        what = nm.replace("_", " ").upper()
    unit = {"%": "%", "percent": "%", "m": " m", "mm": " mm"}.get(ch.unit, f" {ch.unit}" if ch.unit else "")
    val = "VALUE NOT EVALUATED" if ch.value is None else f"VALUE {ch.value:g}{unit}"
    lim = "" if ch.limit is None else f", PLATFORM SCREENING LIMIT {ch.limit:g}{unit}"
    if nm == "b85_scraping_clearance":
        val = "MINIMUM CLEARANCE NOT EVALUATED" if ch.value is None else f"MINIMUM CLEARANCE {ch.value:g}{unit}"
        lim = "" if ch.limit is None else f", PLATFORM SCREENING LIMIT AT LEAST {ch.limit:g}{unit} CLEARANCE (NO SCRAPING)"
    res = "NOT EVALUATED" if ch.passed is None else ("WITHIN THE PLATFORM LIMIT" if ch.passed else "EXCEEDS THE PLATFORM LIMIT")
    return f"{what}: {val}{lim}: {res}."


def _council_grade_line(s: Site, screened: bool = True) -> str:
    c = s.cites.get("driveway.max_grade_pct") or s.cites.get("access.driveway_max_grade_pct")
    council = LN.lga_name(getattr(s.inp, "council_name", None), getattr(s.inp.lot, "lga_name", None), getattr(s.cites, "council_name", None))
    if c is not None:
        return f"COUNCIL MAXIMUM DRIVEWAY GRADE {PH.num(c)} {PH.short_ref(c)}: " + ("THE SCREENING RESULT ABOVE IS NOT A CHECK AGAINST IT." if screened else "NOT CHECKED, NO PROFILE LEVELS.")
    return f"COUNCIL REQUIREMENT: DRIVEWAY MAXIMUM GRADE UNRESOLVED, CONFIRM WITH {council}"


def profile_check_lines(s: Site) -> list[str]:
    """ONE status source for C400 and C410: the SA3 profile checks run on the C410 profile, written as PLATFORM SCREENING (not council compliance)."""
    p = ref_profile(s)
    if p is None:
        return ["PROFILE CHECKS NOT EVALUATED: NO DRIVEWAY CENTRELINE OR EXISTING LEVELS", _council_grade_line(s, False)]
    if not p["proposed"]:
        return ["PROFILE CHECKS NOT EVALUATED: NO DRIVEWAY END LEVEL SUPPLIED (NONE IS ASSUMED)", _council_grade_line(s, False)]
    return [_check_text(ch) for ch in p["checks"]] + [_council_grade_line(s)]


def falls_to_lot_note(s: Site) -> str | None:
    """Computed from the profile: when the level at the property boundary is below the kerb line level the driveway falls towards the lot."""
    p = ref_profile(s)
    if p is None:
        return None
    zs = {nm: (t, z) for t, z, nm in p["st"]}
    k, b = zs.get(KERB_STATION), zs.get(BDY_STATION)
    if k is None or b is None or b[0] - k[0] < 0.5:
        return None
    g = 100.0 * (b[1] - k[1]) / (b[0] - k[0])
    if g >= -0.5:
        return None
    return (f"INDICATIVE PROFILE FALLS TOWARDS THE LOT ({abs(g):.1f}% FROM THE KERB LINE TO THE PROPERTY BOUNDARY): ROAD RUNOFF EXCLUSION TO BE CHECKED BY A QUALIFIED PERSON")


def driveway_earthworks(s: Site):
    """Cut and fill over the driveway between the DEM and the platform design profile (flat across the width).  None when the inputs are absent."""
    p = ref_profile(s)
    if p is None or not p["proposed"] or s.drive_poly is None or s.inp.driveway is None:
        return None
    cl, w, des = s.drive_cl, s.inp.driveway.width_m, p["design"]
    step, cells = 0.5, []
    n = max(1, int(cl.length / step))
    for i in range(n):
        t0, t1 = i * cl.length / n, (i + 1) * cl.length / n
        a, b = cl.interpolate(t0), cl.interpolate(t1)
        dx, dy = b.x - a.x, b.y - a.y
        d = math.hypot(dx, dy)
        if d < 1e-6:
            continue
        ux, uy = dx / d, dy / d
        nx, ny = -uy, ux
        quad = Polygon([(a.x + nx * w / 2, a.y + ny * w / 2), (b.x + nx * w / 2, b.y + ny * w / 2), (b.x - nx * w / 2, b.y - ny * w / 2), (a.x - nx * w / 2, a.y - ny * w / 2)])
        m = cl.interpolate((t0 + t1) / 2)
        zs = []
        for off in (-w / 3, 0.0, w / 3):
            z = float(s.tin.z_at(m.x + nx * off, m.y + ny * off))
            if np.isfinite(z):
                zs.append(z)
        if not zs:
            continue
        dz = float(np.mean(zs)) - des((t0 + t1) / 2)
        cells.append((dz, quad.intersection(s.drive_poly)))
    zones, vol = [], {"cut": 0.0, "fill": 0.0}
    for kind, test in (("cut", lambda z: z > 0.03), ("fill", lambda z: z < -0.03)):
        gs = [g for z, g in cells if test(z) and not g.is_empty]
        if gs:
            zones.append((kind, unary_union(gs).buffer(0.005)))
        vol[kind] = sum(abs(z) * g.area for z, g in cells if test(z) and not g.is_empty)
    return {"zones": zones, "cut": vol["cut"], "fill": vol["fill"], "profile": p}


def swept_ok(s: Site, xg: CX.CrossoverGeom) -> bool:
    """The platform swept path polygon is drawn only when it is one valid shape inside the lot, the verge and the road reserve (no path through
    the boundary).  The platform turning circle is never drawn unless it sits wholly inside the lot."""
    tp = s.turn_path
    if tp is None or tp.is_empty or not tp.is_valid:
        return False
    roads = [p for _l, p, r in cadwin.all_lots(s) if r]
    allowed = unary_union([g for g in [s.lot, xg.verge, s.crossover] + roads if g is not None]).buffer(0.25)
    return bool(tp.within(allowed) and getattr(tp, "geom_type", "") in ("Polygon", "MultiPolygon") and len(getattr(tp, "interiors", [])) == 0)


# ====================================================================================================== C100 existing conditions
def c100(ctx: RefCtx) -> Sheet:
    s = ctx.site
    rows = []
    if s.tin is None:
        rows.append("existing contours and spot levels: no survey or DEM levels supplied (run with levels nsw or supply a detail survey)")
    if not s.inp.services and DD.n_drawn(s) == 0:
        rows += (DD.rows_missing(s) if DD.view_of(s) is not None else ["existing services: none supplied; location to be confirmed from council records and BYDA"])
    rows.append("existing buildings, trees, fences and easements: not in the supplied data (confirm by title search and s88B instrument)")
    b0 = start(ctx, "C100", rows, DD.notes_for(s), want_xover=False)
    rows += road_rows(s, b0.xg, b0.front, b0.pave)
    if len(rows) != len(b0.rows):                                    # the missing-road row changes the panel: rebuild with it
        b0 = start(ctx, "C100", rows, DD.notes_for(s), want_xover=False)
    b = b0
    b.pre = ([CONTOUR_NOTE] if s.tin is not None else []) + DD.notes_for(s)
    v = b.v
    if s.tin is not None:
        contour_sets(s, v.model_window())
        D.contours(v, s, "ex", lab_h=D.CONTOUR_LAB_H)                     # contours only: spot levels are not shown on the existing site plan
    draw_xover(b, "existing")
    missing: list[str] = []
    _n, pending = _services(v, s, missing)
    pending = list(pending) + DD.draw_verified(b)                     # verified BYDA services only (owner, plan date, location indicative)
    finish(b, "EXISTING SITE PLAN")
    if DD.view_of(s) is not None:
        text_panel(b, "EXISTING SERVICES (BYDA)", DD.status_lines(DD.view_of(s)), 110.0, warn=DD.view_of(s).n_verified == 0)
    CX.callouts_crossover(v, b.xg, b.std, b.keep, [], [s.lot], kerb_only=True, short_kerb=True, must_avoid=list(getattr(b, 'kerb_geoms', [])))
    for lines_, pt_ in pending:
        place(b, lines_, pt_)
    pave_callout(b)
    b.sh.data_missing += [m for m in missing]
    return seal(b)


# ====================================================================================================== C101 proposed site plan
def _svc_missing(s: Site) -> list[str]:
    from shapely import wkt as swkt
    from app.agents.sa5_cad_dxf.planset.sheets_ref import _symbol
    out = []
    for sv in s.inp.services:
        g = swkt.loads(sv.geometry_wkt)
        if g.geom_type == "Point" and _symbol(sv) is None:
            out.append(f"point service {ST.clean(sv.label)} ({sv.service}) has no symbol in the reference set")
    return out


def c101(ctx: RefCtx) -> Sheet:
    s = ctx.site
    fp = s.footprint if draws_dwelling(s) else None
    b = start(ctx, "C101", [], ctr_notes(s), want_xover=True)
    front, drv, std, xg = b.front, b.drv, b.std, b.xg
    rows = list(road_rows(s, xg, front, b.pave))
    if drv is None or s.drive_poly is None:
        rows.append("driveway and crossover (SA3 driveway result not supplied)")
    if not s.neighbours:
        rows.append("adjoining lots (cadastre query returned none)")
    if xg.kerb_line is None and "kerb line" not in " ".join(rows):
        rows.append("kerb line and road edge")
    if draws_dwelling(s) and fp is None:
        rows.append("proposed structure footprint (no SA7 overlay, SA8 layout or envelope large enough for the preset)")
    rows += _svc_missing(s)
    if rows:
        b = start(ctx, "C101", rows, ctr_notes(s), want_xover=True)
        front, drv, std, xg = b.front, b.drv, b.std, b.xg
    v = b.v
    draw_ctrs(b)
    draw_xover(b, "proposed", dims=True)
    pl = s.placement if (s.placement is not None and s.placement.placed) else None
    if fp is not None:
        BD.draw_outline(v, s) if pl is not None else ST.hatch_fill(v, fp, "proposed")
        b.hard.append(fp)
    lost_dims: list[str] = []
    if fp is not None:
        avoid = unary_union([g for g in b.hard if g is not None and not g.is_empty] or [Point(1e9, 1e9)])
        if pl is not None:
            lost_dims = BD.draw_setback_dims(b, [to_paper(v, s.drive_poly).buffer(0.5)] if s.drive_poly is not None else [], keep_clear=unary_union([g for g in (s.drive_poly, s.crossover) if g is not None]) if s.drive_poly is not None else None)
        else:
            D.building_setbacks(v, s, text_h=2.5, off_mm=4.0, color=ST.BLACK, mask=True, avoid=avoid)
    nsv, svc_pending = _services(v, s, [])
    if s.inp.rwt is not None:
        x, y = s.inp.rwt.location_xy
        v.fill(Point(x, y).buffer(s.inp.rwt.diameter_m / 2), "C-UTIL-RWTK", ST.WHITE, 1.0, edge=ST.BLACK, edge_lw=ST.REF.outline_lw)
    ph = fonts.wrap(codes.SETBACK_PLACEHOLDER, TXT.BODY, 96.0, True)
    hh = 4.0 + 3.4 * len(ph)
    pr = (PLAN_RECT[2] - 106.0, PLAN_RECT[3] - 70.0 - hh, PLAN_RECT[2] - 4.0, PLAN_RECT[3] - 70.0)
    col, bpanels = None, []
    if pl is not None:
        bpanels = BD.panels(s)
        PW = 124.0
        heights = [PN.table_height(p_[2], PW, cols=BD.COLS) if p_[0] == "table" else PN.panel_height(p_[2], PW, title=p_[1]) for p_ in bpanels]
        col = PN.column(b, heights, PW)
    finish(b, "PROPOSED SITE PLAN", reserve=[pr] if fp is None else (col or ()))
    keep = b.keep
    if col:
        for p_, r_ in zip(bpanels, col):
            (PN.draw_table(v, r_, p_[1], p_[2], cols=BD.COLS, red_when=BD.row_failed, bold_col=2) if p_[0] == "table" else PN.draw_panel(v, r_, p_[1], p_[2], warn=p_[3]))
    elif pl is not None:                                               # no clear column: the same panels wherever the sheet is free
        for p_ in bpanels:
            text_panel(b, p_[1], [" ".join(map(str, r_)) for r_ in p_[2]] if p_[0] == "table" else p_[2], 124.0, warn=(p_[0] == "text" and p_[3]))
    if fp is None:
        PP = ST.Paper(v)
        PP.poly([(pr[0], pr[1]), (pr[2], pr[1]), (pr[2], pr[3]), (pr[0], pr[3])], "C-DATA-NONE", ST.WHITE, edge=RED, edge_lw=0.35)
        for i, t in enumerate(ph):
            PP.text(pr[0] + 2.0, pr[3] - 2.0 - 3.4 * i, t, TXT.BODY, "TOP_LEFT", bold=True, color=RED, layer="C-DATA-NONE")
    hard, soft = b.hard, [s.lot]
    CX.callouts_crossover(v, xg, std, keep, list(hard), soft, must_avoid=list(b.kerb_geoms))
    if xg.present:
        place(b, LAYOVER_REF, xg.frontage.xy(xg.centre_s - xg.width_m * 0.3, xg.body_len_m * 0.4), avoid=hard)
    if fp is not None:
        c = fp.representative_point()
        place(b, [s.fp_label, f"FOOTPRINT AREA {fp.area:.0f} m2" + ("" if pl is not None else f"  ({D._dim_text(fp)})")] + _ffl_lines(s), (c.x, c.y), avoid=hard)
    if s.drive_poly is not None and s.drive_cl is not None and drv is not None:
        cl_in = s.drive_cl.intersection(s.lot)
        seg = max(getattr(cl_in, "geoms", [cl_in]), key=lambda g: g.length) if not cl_in.is_empty else None
        if seg is not None and seg.geom_type == "LineString" and seg.length > 0:
            m = seg.interpolate(0.5, normalized=True)
            lines = ["PROPOSED DRIVEWAY", "MATERIAL TO BE CONFIRMED", f"WIDTH {drv.width_m:.1f}m (PLATFORM DEFAULT)"]
            if drv.max_grade_pct is not None:
                lines.append(f"MAX GRADE {drv.max_grade_pct:.1f}% (PLATFORM SCREENING LIMIT)")
            place(b, lines, (m.x, m.y), avoid=hard, short_first=60.0)
    pave_callout(b)
    for lines_, pt_ in svc_pending:
        place(b, lines_, pt_, avoid=hard)
    cand = [g for g in s.inp.lot.segments if not g.is_front]
    if cand:
        sg = max(cand, key=lambda g: g.distance_m)
        mid = ((sg.start_xy[0] + sg.end_xy[0]) / 2, (sg.start_xy[1] + sg.end_xy[1]) / 2)
        place(b, [f"AREA {s.inp.lot.area_m2_calculated:,.0f} m2 (CALCULATED FROM CADASTRE)"], mid, "arrow", avoid=hard)
    notes = [codes.SETBACK_PLACEHOLDER + "."] if fp is None else []
    if lost_dims:
        notes.append(f"SETBACK DIMENSION NOT PLACED ON THE PLAN ({', '.join(lost_dims)}): SEE THE BUILDING SETBACKS SCHEDULE")
    return seal(b, notes)


# ====================================================================================================== C200 earthworks
SECTION_ID = "A"


def section_station(s: Site, ew) -> tuple[float, tuple[float, float], tuple[float, float], tuple[float, float], float]:
    """(chainage, point on the centreline, unit direction of increasing chainage, unit left normal, half length of the section line in m) for the typical
    driveway section: ONE source for the section drawing and for the section marker on the plan."""
    p = ew["profile"]
    cl, w = s.drive_cl, s.inp.driveway.width_m
    tm = (p["sb"] + cl.length) / 2.0 if p["sb"] < cl.length - 1.0 else cl.length / 2.0
    q, q2 = cl.interpolate(tm), cl.interpolate(min(cl.length, tm + 0.2))
    d = math.hypot(q2.x - q.x, q2.y - q.y) or 1.0
    ux, uy = (q2.x - q.x) / d, (q2.y - q.y) / d
    return tm, (q.x, q.y), (ux, uy), (-uy, ux), w / 2 + 1.8


def draw_section_marker(b: Base, ew) -> None:
    """Section line on the plan across the driveway at the section chainage: a chain line with an arrow at each end (looking towards the kerb, the way
    the section is drawn) and the section letter in a circle, so "AT CHAINAGE n" on the section can be found on the plan."""
    v = b.v
    if ew is None or v is None:
        return
    tm, (qx, qy), (ux, uy), (nx, ny), half = section_station(b.s, ew)
    pp = ST.Paper(v)
    ends = []
    for sg in (-1, 1):
        ex_, ey_ = qx + sg * nx * (half + 1.0), qy + sg * ny * (half + 1.0)
        ends.append(v.tp(ex_, ey_))
    (ax, ay), (bx, by) = ends
    L = math.hypot(bx - ax, by - ay) or 1.0
    ex_, ey_ = (bx - ax) / L, (by - ay) / L                                            # paper direction of the section line
    pdx, pdy = v.tp(qx - ux, qy - uy)[0] - v.tp(qx, qy)[0], v.tp(qx - ux, qy - uy)[1] - v.tp(qx, qy)[1]      # paper direction towards the kerb (looking direction)
    pl = math.hypot(pdx, pdy) or 1.0
    pdx, pdy = pdx / pl, pdy / pl
    ext = 7.0
    ln_a, ln_b = (ax - ex_ * ext, ay - ey_ * ext), (bx + ex_ * ext, by + ey_ * ext)
    pp.line([ln_a, ln_b], "C-ANNO-NOTE", 0.35, (0, 0, 0), dash="DASHED")
    for (px, py), sg in ((ln_a, -1), (ln_b, 1)):
        cx_, cy_ = px + sg * ex_ * 3.2, py + sg * ey_ * 3.2
        pp.circle(cx_, cy_, 3.0, "C-ANNO-NOTE", 0.35, (0, 0, 0), (1, 1, 1))
        pp.text(cx_, cy_, SECTION_ID, 3.0, "MIDDLE_CENTER", bold=True, layer="C-ANNO-NOTE")
        tip = (px + pdx * 5.5, py + pdy * 5.5)
        pp.line([(px, py), tip], "C-ANNO-NOTE", 0.35, (0, 0, 0))
        hx, hy = -pdy, pdx
        pp.poly([tip, (tip[0] - pdx * 2.2 + hx * 0.9, tip[1] - pdy * 2.2 + hy * 0.9), (tip[0] - pdx * 2.2 - hx * 0.9, tip[1] - pdy * 2.2 - hy * 0.9)], "C-ANNO-NOTE", (0, 0, 0))
        v.occ.append((min(cx_, tip[0]) - 4.0, min(cy_, tip[1]) - 4.0, max(cx_, tip[0]) + 4.0, max(cy_, tip[1]) + 4.0))
    b.keep.append((min(ln_a[0], ln_b[0]) - 1.0, min(ln_a[1], ln_b[1]) - 1.0, max(ln_a[0], ln_b[0]) + 1.0, max(ln_a[1], ln_b[1]) + 1.0))


def _section_panel(b: Base, ew) -> None:
    """TYPICAL cut section across the driveway at its mid length, in a framed paper panel: existing ground (DEM), design level, cut ("/" existing
    material removed) and fill ("\\" proposed), batters drawn from the platform edges to existing ground and labelled 1:n (cited or TBC)."""
    s, p = b.s, ew["profile"]
    cl, w, des = s.drive_cl, s.inp.driveway.width_m, p["design"]
    tv = SEC.TypicalValues(s.cites)
    tm, (qx, qy), _u, (nx, ny), half = section_station(s, ew)
    q = Point(qx, qy)
    offs = [o * 0.25 for o in range(int(-half / 0.25), int(half / 0.25) + 1)]
    pts = []
    for o in offs:
        z = float(s.tin.z_at(q.x + nx * o, q.y + ny * o))
        if np.isfinite(z):
            pts.append((o, z))
    if len(pts) < 5:
        return
    zd = des(tm)
    r = None
    for W, H in ((300.0, 128.0), (280.0, 120.0), (260.0, 112.0), (240.0, 104.0)):
        r = place_panel(b, W, H)
        if r is not None:
            break
    if r is None:
        CO.fallback_tag(b.v, ["TYPICAL DRIVEWAY CUT AND FILL SECTION NOT DRAWN: NO FREE SPACE ON THE SHEET"], (0, 0), hidden=True)
        return
    sv = b.sh.add(View("section", r))
    P = ST.Paper(sv)
    span = pts[-1][0] - pts[0][0]
    hs = next((h_ for h_ in (25, 50, 100, 200) if span * 1000.0 / h_ <= W - 24.0), 200)        # horizontal scale: the whole profile fits inside the frame
    z0, z1 = min(min(z for _o, z in pts), zd), max(max(z for _o, z in pts), zd)
    ex = next((e for e in (20, 10, 5, 2.5, 2, 1) if (z1 - z0 + 0.1) * 1000.0 * e / hs <= H - 80.0), 1)
    vs = hs / ex
    X = lambda o: (r[0] + r[2]) / 2 + o * 1000 / hs      # noqa: E731
    zmin = z0 - 0.15
    Y = lambda z: r[1] + 40.0 + (z - zmin) * 1000 / vs   # noqa: E731
    sv.fill(Polygon([(r[0], r[1]), (r[2], r[1]), (r[2], r[3]), (r[0], r[3])]), "C-ANNO-TABL", (1, 1, 1), 1.0, anno=True)      # white mask over the aerial
    sv.line([(r[0], r[1]), (r[2], r[1]), (r[2], r[3]), (r[0], r[3])], "C-ANNO-TABL", True, 0.35)
    SEC.title(sv, P, r[0], r[3], W, f"TYPICAL DRIVEWAY CUT AND FILL SECTION {SECTION_ID}-{SECTION_ID}", f"AT CHAINAGE {tm:.1f} m (SECTION LINE {SECTION_ID}-{SECTION_ID} ON THE PLAN, LOOKING TO THE KERB). HORIZONTAL 1:{hs}, VERTICAL 1:{vs:.4g} (VERT EXAG {ex:g}). INDICATIVE, DEM DERIVED.")
    ex_pts = [(X(o), Y(z)) for o, z in pts]
    sv.line(ex_pts, "C-DRIV-EXGD", False, 0.4, color=(0.3, 0.3, 0.3))
    xl, xr = X(-w / 2), X(w / 2)
    for kind in ("cut", "fill"):                                       # reference hatches: "/" existing material removed, "\\" proposed fill
        for o0, o1 in zip(pts, pts[1:]):
            if not (-w / 2 <= o0[0] <= w / 2 and -w / 2 <= o1[0] <= w / 2):
                continue
            d0, d1 = o0[1] - zd, o1[1] - zd
            if (kind == "cut" and d0 > 0 and d1 > 0) or (kind == "fill" and d0 < 0 and d1 < 0):
                poly = [(X(o0[0]), Y(o0[1])), (X(o1[0]), Y(o1[1])), (X(o1[0]), Y(zd)), (X(o0[0]), Y(zd))]
                if Polygon(poly).is_valid and Polygon(poly).area > 0.01:
                    SEC.hatch(sv, poly, "existing" if kind == "cut" else "proposed")
    sv.line([(xl, Y(zd)), (xr, Y(zd))], "C-DRIV-LONG", False, 0.8, color=(0.8, 0, 0))
    # batters from each platform edge to existing ground at a graphic slope (paper slope 1 : 1.5, not the ratio), labelled by call-outs off the lines
    gp = lambda x: float(np.interp(x, [a_ for a_, _b in ex_pts], [b_ for _a, b_ in ex_pts]))      # noqa: E731
    bat = []
    for side in (-1, 1):
        xe = xl if side < 0 else xr
        ge = gp(xe)
        up = ge > Y(zd)
        name = "cut_batter" if up else "fill_batter"
        x_end, y_end = xe, Y(zd)
        for k in range(1, 400):
            xx = xe + side * k * 0.25
            yy = Y(zd) + (1 if up else -1) * k * 0.25 / 1.5
            if (up and yy >= gp(xx)) or ((not up) and yy <= gp(xx)) or not (ex_pts[0][0] <= xx <= ex_pts[-1][0]):
                x_end, y_end = xx, min(max(yy, r[1] + 20.0), r[3] - 24.0)
                break
        if abs(x_end - xe) < 1.0:
            continue
        sv.line([(xe, Y(zd)), (x_end, y_end)], "C-EART-BATR", False, 0.7, color=(0.85, 0.15, 0.1) if up else (0.1, 0.6, 0.2))
        bat.append((side, (xe + x_end) / 2, (Y(zd) + y_end) / 2, ("CUT" if up else "FILL") + " BATTER " + tv.ratio(name)))
    dimy = r[1] + 12.0
    for side, mx_, my_, txt in bat:                                     # boxed labels in the free band under the section, leader up to the batter
        tw_ = fonts.text_width(txt, TXT.BODY, True) + 6.0
        bx0 = (xl - 8.0 - tw_) if side < 0 else (xr + 8.0)
        bx0 = min(max(bx0, r[0] + 3.0), r[2] - 3.0 - tw_)
        SEC.callout(sv, P, [txt], (bx0, dimy + 17.0), (mx_, my_ - 0.4), tw_ + 2.0, TXT.BODY)
    P.text((xl + xr) / 2, dimy + 4.0, f"DESIGN RL {zd:.2f}", TXT.BODY, "BOTTOM_CENTER", layer="C-ANNO-NOTE", color=(0.8, 0, 0))
    ex_txt = f"EXISTING GROUND (INDICATIVE, DEM) RL {pts[0][1]:.2f}"
    tx0 = r[0] + 4.0
    tw2 = fonts.text_width(ex_txt, TXT.BODY)
    top_g = max(y_ for x_, y_ in ex_pts if tx0 - 1.0 <= x_ <= tx0 + tw2 + 1.0) if any(tx0 - 1.0 <= x_ <= tx0 + tw2 + 1.0 for x_, _y in ex_pts) else ex_pts[0][1]
    P.text(tx0, min(top_g + 3.0, r[3] - 22.0), ex_txt, TXT.BODY, "BOTTOM_LEFT", layer="C-ANNO-NOTE", color=(0.3, 0.3, 0.3))
    for xe in (xl, xr):                                                 # extension lines attached to the platform edges
        P.line([(xe, Y(zd) - 0.8), (xe, dimy + 1.5)], "C-ANNO-DIMS", 0.1, ST.GRID)
    SEC.dim_h(P, dimy, xl, xr, f"DRIVEWAY WIDTH {CX._fmt_m(w)}", TXT.BODY)
    P.text(r[0] + 3.0, r[1] + 3.0, "BATTER SLOPES ARE DRAWN FOR GRAPHIC PURPOSES: " + (tv.ratio("cut_batter") + " CITED" if tv.has("cut_batter") else "1:N " + SEC.TBC_STATEMENT), TXT.BODY, "BOTTOM_LEFT", layer="C-ANNO-NOTE", color=RED)


def c200(ctx: RefCtx) -> Sheet:
    s = ctx.site
    pad_ok = bool(draws_dwelling(s) and s.cutfill is not None)
    ew = driveway_earthworks(s)
    rows = []
    if not pad_ok:
        rows.append("building pad cut, fill, batters and volumes: " + (PAD_TBC if s.placement is not None else "depend on the " + NO_DWELLING))
    if s.tin is None:
        rows.append("existing levels: no survey or DEM levels supplied")
    elif ew is None:
        rows.append("driveway cut and fill: no driveway design or driveway end level available")
    notes = []
    if pad_ok:
        notes.append("BATTERS 1V:2H CUT AND 1V:3H FILL ARE ASSUMED. GEOTECHNICAL ADVICE REQUIRED.")
    if s.tin is not None:
        notes.append(CONTOUR_NOTE)
    if ew is not None:
        notes.append("DRIVEWAY CUT AND FILL: EXISTING 5 m DEM AGAINST THE PLATFORM DRIVEWAY PROFILE (LEVEL AT THE DRIVEWAY END IS A PLATFORM DEFAULT). INDICATIVE.")
    b = start(ctx, "C200", rows, notes, want_xover=False)
    rr = road_rows(s, b.xg, b.front, b.pave)
    v = b.v
    if s.tin is not None:
        contour_sets(s, v.model_window())
        D.contours(v, s, "ex", lab_h=D.CONTOUR_LAB_H)
    if pad_ok:
        from shapely import wkt as swkt
        for z in s.cutfill.zones:
            g = swkt.loads(z.wkt)
            col = (0.85, 0.15, 0.1) if z.kind == "cut" else (0.1, 0.6, 0.2)
            v.fill(g, "C-EART-CUTT" if z.kind == "cut" else "C-EART-FILL", col, 0.5, (45 if z.kind == "cut" else -45, 2.0))
        if s.pad is not None:
            v.geom(s.pad, "C-EART-PADD", lw=0.3, color=D.BLUE)
    draw_xover(b, "proposed")
    if s.placement is not None:
        BD.draw_light(b)
    if ew is not None:                                           # same convention: red cut hatch, green fill hatch
        for kind, g in ew["zones"]:
            col = (0.85, 0.15, 0.1) if kind == "cut" else (0.1, 0.6, 0.2)
            v.fill(g, "C-EART-CUTT" if kind == "cut" else "C-EART-FILL", col, 0.55, (45 if kind == "cut" else -45, 1.6))
    finish(b, "EARTHWORKS")
    if ew is not None:
        draw_section_marker(b, ew)
    CX.callouts_crossover(v, b.xg, b.std, b.keep, [], [s.lot], kerb_only=True, short_kerb=True, must_avoid=list(getattr(b, 'kerb_geoms', [])))
    if ew is not None:
        c = s.drive_cl.interpolate(0.6, normalized=True)
        place(b, ["DRIVEWAY EARTHWORKS (INDICATIVE, DEM)", f"CUT {ew['cut']:,.1f} m3, FILL {ew['fill']:,.1f} m3", "RED HATCH CUT, GREEN HATCH FILL"], (c.x, c.y), avoid=b.hard)
        _section_panel(b, ew)
    pave_callout(b)
    if s.placement is not None and s.footprint is not None:
        c_ = s.footprint.representative_point()
        gr = s.placement.ground_range
        place(b, BD.label_lines(s, ["FINISHED FLOOR LEVEL TBC: NO PAD CUT OR FILL CALCULATED"] + ([f"EXISTING GROUND UNDER FOOTPRINT RL {gr[0]:.2f} TO {gr[2]:.2f} m AHD (INDICATIVE 5 m DEM)"] if gr else [])), (c_.x, c_.y), avoid=b.hard)
    extra = []
    if pad_ok:
        extra.append(f"PAD CUT {s.cutfill.cut_volume_m3:,.1f} m3, FILL {s.cutfill.fill_volume_m3:,.1f} m3, NET {s.cutfill.net_volume_m3:+,.1f} m3 (INDICATIVE, 5 m DEM)")
    sh = seal(b, extra)
    sh.data_missing = list(b.rows) + [r for r in rr if r not in b.rows]
    return sh


def services_status_text(s) -> str:
    dv = DD.view_of(s)
    if dv is not None:
        return " ".join(dv.summary_lines()[:1] + [dv.not_confirmed_text() + "."] + ([dv.expiry_warning()] if dv.expiry_warning() else []) + (["SYNTHETIC DEMO DATA: NOT REAL SERVICES."] if dv.synthetic else []) + ["LOCATE BY POTHOLING."])
    return "SUPPLIED SERVICES ARE DRAWN AS SUPPLIED (INDICATIVE)." if s.inp.services else "NONE SUPPLIED: LOCATE BY BEFORE YOU DIG AUSTRALIA (BYDA) AND POTHOLING."


# ====================================================================================================== C300 stormwater
def inter_allotment_notes(s: Site) -> list[str]:
    """Council inter-allotment drainage rules (Engineering Standards 3.9) for a lot that falls away from the street: read from the typicals data, only
    where gravity drainage to the street gutter is not possible from the lot itself.  Empty when the council has no typicals data."""
    T = s.cites.typ
    if not T.present:
        return []
    t_pipe, t_in, t_ease = T.get("eng.inter_allotment.min_pipe_diameter"), T.get("eng.inter_allotment.lot_inlet"), T.get("eng.inter_allotment.easement_width")
    if t_pipe is None or t_in is None or t_ease is None:
        return []
    pipe = t_pipe.value.split(" (")[0] if isinstance(t_pipe.value, str) else t_pipe.value
    out = [f"INTER-ALLOTMENT DRAINAGE ONLY WHERE GRAVITY TO THE STREET IS NOT POSSIBLE: PIPE {pipe} mm MIN (150 mm FOR ONE LOT), GRATED INLET PIT AT THE LOWEST POINT WITH A 150 mm JUNCTION, "
           f"EASEMENT {t_ease.value} m [{refs_short([t_pipe, t_ease])}]. DETAIL ON C600."]
    return [ST.clean(n).upper() for n in out]


def c300(ctx: RefCtx) -> Sheet:
    s = ctx.site
    if s.placement is not None:
        rows = ["downpipe positions, pits, pipe sizes and grades and the roof discharge route: not designed (hydraulic designer; no roof drainage layout exists for the typical house)"]
    else:
        rows = ["roof catchment, downpipes, pits and discharge route: depend on the " + NO_DWELLING]
    if s.tin is None:
        rows.append("overland flow arrows: no survey or DEM levels supplied")
    st_exist = [x for x in s.inp.services if x.service == "stormwater"]
    if not st_exist and DD.n_drawn(s, ("stormwater",)) == 0:
        rows.append("existing council stormwater assets: none supplied; confirm from council records and BYDA" if DD.view_of(s) is None else "existing stormwater assets: none verified from the BYDA responses (see C310); confirm from council records and by potholing")
    notes = ["ALL DRAINAGE IS TO BE DESIGNED BY A HYDRAULIC DESIGNER. NOTHING HERE IS A DRAINAGE DESIGN."]
    notes += cited(s, ("stormwater.designed_per_eng_standards", "stormwater.osd_roof_plumbing_design_aep_pct"))
    if s.tin is not None:
        notes.append("OVERLAND FLOW ARROWS SHOW THE DOWNSLOPE DIRECTION OF THE 5 m DEM (INDICATIVE). FLOW PATHS AND CATCHMENTS ARE NOT MODELLED.")
    dn = drainage_discharge_note(s)
    if dn:
        notes.append(dn)
        notes += inter_allotment_notes(s)
    if s.inp.rwt is None:
        notes.append("RAINWATER TANK: NONE SUPPLIED (ANY COUNCIL REQUIREMENT TO BE CONFIRMED)")
    b = start(ctx, "C300", rows, notes + ctr_notes(s))
    v = b.v
    draw_ctrs(b)
    draw_xover(b, "proposed")
    if s.placement is not None:
        BD.draw_light(b, door=False)
    if s.tin is not None:
        w = v.model_window()
        gx = np.linspace(w[0] + 30 / v.k, w[2] - 30 / v.k, 14)
        gy = np.linspace(w[1] + 30 / v.k, w[3] - 30 / v.k, 10)
        for x in gx:
            for y in gy:
                p = Point(x, y)
                if not s.lot.buffer(-1.0).contains(p) or (s.drive_poly is not None and s.drive_poly.buffer(2).contains(p)) or (s.footprint is not None and s.footprint.buffer(2).contains(p)):
                    continue
                d = SP.downslope(s, (x, y))
                if d:
                    SP.arrow(v, (x, y), d)
    _n_sw, sw_pending = _services(v, s, [], ("stormwater",))
    sw_pending = list(sw_pending) + DD.draw_verified(b, ("stormwater",))     # verified BYDA stormwater only
    if s.inp.rwt is not None:
        x, y = s.inp.rwt.location_xy
        v.fill(Point(x, y).buffer(s.inp.rwt.diameter_m / 2), "C-UTIL-RWTK", ST.WHITE, 1.0, edge=ST.BLACK, edge_lw=ST.REF.outline_lw)
    finish(b, "STORMWATER")
    if s.placement is not None and s.footprint is not None:
        ra = BD.roof_area_m2(s.placement)
        c_ = s.footprint.representative_point()
        place(b, BD.label_lines(s, ([f"ROOF PLAN AREA TO THE EAVES {ra:,.0f} m2 (CATCHMENT, INDICATIVE)"] if ra else []) + ["ROOF WATER TO THE LEGAL POINT OF DISCHARGE: NOT DESIGNED"]), (c_.x, c_.y), avoid=b.hard)
    if dn:                                                                       # visible on the plan, not only in the notes panel
        text_panel(b, "DRAINAGE DISCHARGE (INDICATIVE)", [dn], 120.0, warn=True)
    for lines_, pt_ in sw_pending:
        place(b, lines_, pt_)
    CX.callouts_crossover(v, b.xg, b.std, b.keep, [], [s.lot], kerb_only=True, short_kerb=True, must_avoid=list(getattr(b, 'kerb_geoms', [])))
    pave_callout(b)
    return seal(b)


# ====================================================================================================== C310 water and sewer
def c310(ctx: RefCtx) -> Sheet:
    s = ctx.site
    ex_w = [x for x in s.inp.services if x.service in ("water", "sewer") and not x.is_proposed]
    if s.placement is not None:
        rows = ["proposed water service and sewer house connection: not designed (position, size and cover to be determined by the water and sewer authority from the dwelling design)"]
    else:
        rows = ["proposed water service and sewer house connection: depend on the " + NO_DWELLING]
    if not ex_w and DD.n_drawn(s, ("water", "sewer")) == 0:
        rows.append("existing water main, sewer main and junction: none supplied; EXISTING SERVICE LOCATION TO BE CONFIRMED FROM COUNCIL RECORDS / BYDA" if DD.view_of(s) is None
                    else "existing water main, sewer main and junction: none verified from the BYDA responses; EXISTING SERVICE LOCATION NOT CONFIRMED, CONFIRM BY POTHOLING")
    notes = cited(s, ("water.min_cover_m", "sewer.junction_min_diameter_mm", "sewer.house_connection_min_cover_m", "util.build_over_sewer_policy"))
    notes.append("LOCATE ALL SERVICES BY BYDA AND POTHOLING BEFORE EXCAVATION.")
    b = start(ctx, "C310", rows, notes + ctr_notes(s) + DD.notes_for(s))
    draw_ctrs(b)
    draw_xover(b, "proposed")
    if s.placement is not None:
        BD.draw_light(b, door=False)
    _n, pending = _services(b.v, s, [], ("water", "sewer"))
    pending = list(pending) + DD.draw_verified(b)                     # verified BYDA services only, every owner and service type
    finish(b, "WATER AND SEWER")
    dv_ = DD.view_of(s)
    if dv_ is not None:                                                # the services status table: owners, response, plans, traced and verified counts, validity
        if DD.table_panel(b, "EXISTING SERVICES STATUS (BYDA)", DD.table_rows(dv_), 160.0) is None:
            b.sh.data_missing.append("services status table: no free place on the sheet")
        text_panel(b, "BYDA SUMMARY", DD.status_lines(dv_), 110.0, warn=dv_.n_verified == 0 or dv_.expiry_warning() is not None)
    CX.callouts_crossover(b.v, b.xg, b.std, b.keep, [], [s.lot], kerb_only=True, short_kerb=True, must_avoid=list(getattr(b, 'kerb_geoms', [])))
    for lines_, pt_ in pending:
        place(b, lines_, pt_)
    pave_callout(b)
    return seal(b)


# ====================================================================================================== C400 driveway plan
def _vehicle_lines(name: str, cited=None) -> list[str]:
    """Design vehicle from the platform's own vehicle table (SA3 swept path module); DATA NOT AVAILABLE when the vehicle is not in it."""
    try:
        from app.agents.sa3_driveway import swept as sw
        v = sw.VEHICLES.get(name)
    except Exception:  # noqa: BLE001
        v = None
    if v is None:
        return [f"DESIGN VEHICLE {ST.clean(name).upper()}: DATA NOT AVAILABLE (NOT IN THE PLATFORM VEHICLE DATA)"]
    head = (f"DESIGN VEHICLE {v.name} (AS/NZS 2890.1), REQUIRED BY THE COUNCIL: {ST.clean(cited[1].ref_short).upper()}" if cited is not None and cited[0] == v.name
            else f"DESIGN VEHICLE {v.name} (AS/NZS 2890.1)")
    return [head, f"OVERALL LENGTH {v.length:.2f}m", f"OVERALL WIDTH {v.width:.2f}m", f"WHEELBASE {v.wheelbase:.2f}m",
            f"FRONT OVERHANG {v.front_oh:.2f}m", f"REAR OVERHANG {v.rear_oh:.2f}m", f"MINIMUM TURNING RADIUS {v.min_turn_radius:.2f}m (PLATFORM VALUE, TO BE VERIFIED)",
            "VEHICLE DIMENSIONS: PLATFORM VEHICLE DATA (FLAGGED TO VERIFY AGAINST THE STANDARD)" + ("" if cited is not None and cited[0] == v.name else "; THE DESIGN VEHICLE ITSELF IS A PLATFORM DEFAULT")]


def _chainage_stations(L: float, step: float) -> list[float]:
    ds = [i * step for i in range(int(L / step + 1e-9) + 1)]
    if L - ds[-1] > 0.25:
        ds.append(L)
    return ds


def plan_chainage(b: Base, step: float) -> tuple[list, list[str]]:
    """Choose and RESERVE the chainage label positions along the driveway centreline (before the dimensions, so they route around the labels, not the
    other way round).  Each station tries both sides of the line at several offsets and shifts of at most 4 mm along it (a label stays on its station);
    the end of the driveway is labelled along the line.  Returns (plan, lost): ``lost`` are the labels that found no free place (never dropped silently:
    the caller prints them on the sheet)."""
    s, v = b.s, b.v
    cl = s.drive_cl
    L = cl.length
    plan: list = []
    lost: list[str] = []
    from shapely.geometry import box as _bx
    blocking = [to_paper(v, s.lot.boundary)]                                           # linework drawn later (boundary, kerb and gutter lines): a label never sits on it
    xg_ = b.xg
    if xg_.kerb_line is not None:
        fr_ = xg_.frontage
        blocking += [to_paper(v, LineString([fr_.xy(-40.0, off), fr_.xy(fr_.length + 40.0, off)])) for off in (xg_.kerb_offset_m, xg_.kerb_offset_m - xg_.band_w_m)]
    corridor = None                                                                  # where the driveway width dimension at the property boundary will be drawn: no label here
    try:
        ib = cl.intersection(s.lot.boundary)
        if not ib.is_empty and s.drive_poly is not None:
            pb = ib if ib.geom_type == "Point" else min(getattr(ib, "geoms", [ib]), key=lambda g_: cl.project(g_))
            db = cl.project(pb)
            dpp = to_paper(v, s.drive_poly.intersection(s.lot))
            rc = list(dpp.minimum_rotated_rectangle.exterior.coords)
            hw_ = min(math.dist(rc[0], rc[1]), math.dist(rc[1], rc[2])) / 2 + 2.0          # half the driveway width on the sheet, plus a margin
            p0, p1 = to_paper(v, cl.interpolate(max(0.0, db - 0.1))), to_paper(v, cl.interpolate(min(L, db + 0.1)))
            c0 = to_paper(v, pb)
            ax, ay = (p1.x - p0.x), (p1.y - p0.y)
            al = math.hypot(ax, ay) or 1.0
            ax, ay = ax / al, ay / al
            corridor = Polygon([(c0.x - ax * 2.0 - ay * hw_, c0.y - ay * 2.0 + ax * hw_), (c0.x + ax * 20.0 - ay * hw_, c0.y + ay * 20.0 + ax * hw_),
                                (c0.x + ax * 20.0 + ay * hw_, c0.y + ay * 20.0 - ax * hw_), (c0.x - ax * 2.0 + ay * hw_, c0.y - ay * 2.0 - ax * hw_)])
    except Exception:
        corridor = None
    for d in _chainage_stations(L, step):
        p = cl.interpolate(min(d, L))
        p0, q = cl.interpolate(max(0.0, min(d, L) - 0.1)), cl.interpolate(min(L, d + 0.1))
        a = math.atan2(q.y - p0.y, q.x - p0.x)
        ux, uy, nx, ny = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
        end = abs(d - L) < 1e-6
        txt = f"CH {d:g}"
        hit = None
        if end:
            txt = f"DRIVEWAY END, CH {d:.1f}"
            tw = fonts.text_width(txt, ST.TXT.BODY)
            cands = [(p.x + ux * (tw / 2 + 3.0) / v.k + nx * off / v.k, p.y + uy * (tw / 2 + 3.0) / v.k + ny * off / v.k, math.degrees(a)) for off in (0.0, 5.0, -5.0)]
        else:
            cands = [(p.x + nx * off / v.k + ux * sh / v.k, p.y + ny * off / v.k + uy * sh / v.k, math.degrees(a) + 90)
                     for off in (6.5, -6.5, 10.0, -10.0, 13.5, -13.5, 17.0, -17.0) for sh in (0.0, 2.0, -2.0, 4.0, -4.0)]
        for lx, ly, rot in cands:
            box = ST.label_box(v, lx, ly, txt, ST.TXT.BODY, rot)
            if v.free((box[0] - 1.2, box[1] - 1.2, box[2] + 1.2, box[3] + 1.2)) and not any(_bx(*box).buffer(-0.25).intersects(g_) for g_ in blocking) and not (corridor is not None and _bx(*box).intersects(corridor)):          # a little clear space round the label
                v.occ.append((box[0] - 1.2, box[1] - 1.2, box[2] + 1.2, box[3] + 1.2))
                hit = (txt, lx, ly, rot)
                break
        if hit is None:
            lost.append(txt)
        plan.append((d, p, a, hit))
    return plan, lost


def draw_chainage(b: Base, plan: list) -> None:
    """Draw the ticks and the labels reserved by ``plan_chainage``."""
    v = b.v
    for d, p, a, hit in plan:
        ux, uy, nx, ny = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
        hh = 1.6 / v.k
        v.line([(p.x - nx * hh, p.y - ny * hh), (p.x + nx * hh, p.y + ny * hh)], "C-DRIV-CNTR", False, 0.25, "CONTINUOUS", anno=False)
        if hit is not None:
            txt, lx, ly, rot = hit
            ST.label_masked(v, lx, ly, txt, ST.TXT.BODY, rot, layer="C-ANNO-DIMS", reserved=True)


def chainage_labels(b: Base, step: float) -> list[str]:
    """Plan, reserve and draw in one go (used where nothing is drawn between the two steps).  Returns the labels that found no place."""
    plan, lost = plan_chainage(b, step)
    draw_chainage(b, plan)
    return lost


def c400(ctx: RefCtx) -> Sheet:
    s = ctx.site
    drv = s.inp.driveway
    has = drv is not None and s.drive_poly is not None
    rows = [] if has else ["driveway and crossover: SA3 driveway result not supplied"]
    notes = []
    if drv is not None:
        wmin, wmax = s.cites.get("driveway.min_width_m"), s.cites.get("driveway.max_width_m")
        if wmin and wmax:
            ok = wmin.value - 1e-6 <= drv.width_m <= wmax.value + 1e-6
            notes.append(f"CITED WIDTH OF ACCESS {wmin.value:g} TO {wmax.value:g} m [{wmin.ref}]: DESIGN {drv.width_m:.1f} m IS {'WITHIN RANGE' if ok else 'OUTSIDE RANGE'} (SCREENING)")
        notes.append("LONG SECTION: C410. LAYOVER DETAILS: C420.")
        fl = falls_to_lot_note(s)
        if fl:
            notes.append(fl)
    b = start(ctx, "C400", rows, notes + ctr_notes(s), want_xover=True, focus="drive")
    v, xg = b.v, b.xg
    draw_ctrs(b, column_w=132.0)
    step = 2.0
    ch_plan: list = []
    lost: list[str] = []
    if has:
        v.avoid_lines = [to_paper(v, s.drive_cl)]                       # dimension figures never sit on the driveway centreline
        step = 5.0 if (s.drive_cl.length > 12 and b.scale > 50) else 2.0
        ch_plan, lost = plan_chainage(b, step)                          # chainage labels reserved first: the dimensions and call-outs route around them
    draw_xover(b, "proposed", dims=True)
    if s.placement is not None:
        BD.draw_light(b)
    swept = False
    if has:
        swept = swept_ok(s, xg)
        if swept:
            v.fill(s.turn_path, "C-DRIV-TURN", (0.9, 0.45, 0.0), 0.12)
            v.geom(s.turn_path, "C-DRIV-TURN", lw=0.25, color=(0.9, 0.45, 0.0))
        L = s.drive_cl.length
        step = 5.0 if (L > 12 and b.scale > 50) else 2.0
        v.geom(s.drive_cl, "C-DRIV-CNTR", lw=0.13, color=ST.BLACK)
        avoid = [to_paper(v, s.drive_poly).buffer(0.5)] + [to_paper(v, g).buffer(0.5) for g in b.hard]
        for lab, p1, p2 in [d_ for d_ in drv.dimensions if not re.search(r"GARAGE|DWELLING|FFL|HOUSE", d_[0].upper()) and not (xg.present and ("CROSSOVER WIDTH" in d_[0].upper() or abs(math.dist(d_[1], d_[2]) - drv.width_m) < 0.02 or re.fullmatch(r"\d+(\.\d+)?\s*M", d_[0].strip().upper())))]:      # no building wording or values (site only); SA3 driveway dimensions: placed clear of the driveway, each other and the other labels
            txt = f"{lab} {math.dist(p1, p2):.2f} m" if not any(ch.isdigit() for ch in lab) else lab
            if "OFFSET" in lab.upper():                                   # SA3 offset: boundary corner to the crossover centre at the boundary, i.e. the driveway centreline
                txt = f"BOUNDARY CORNER TO DRIVEWAY CENTRELINE {math.dist(p1, p2):.2f} m"             # shorter than the 4.7 m dimension line it labels
            if "OFFSET" in lab.upper():                                   # runs along the boundary to the centre of the driveway: may cross the pale driveway fill, never the stipple; clear of the width dimensions
                dark = [to_paper(v, xg.polys[k_]).buffer(0.3) for k_ in ("body", "wing_a", "wing_b", "band") if xg.present and xg.polys.get(k_) is not None and xg.polys[k_].area > 1e-6]
                dim_best(v, v.tp(*p1), v.tp(*p2), CO.prep([txt])[0], (14.0, 20.0, 27.0, 35.0, 45.0), ((0, 1), (0, -1), (1, 0), (-1, 0)), ST.TXT.BODY, dark)
            else:
                dim_best(v, v.tp(*p1), v.tp(*p2), CO.prep([txt])[0], (7.0, 12.0, 17.0, 23.0), ((0, 1), (0, -1), (1, 0), (-1, 0)), ST.TXT.BODY, avoid)
    # --- data panels: one tidy column (reserved before any label), schedule first ---------------------------------------------------------------
    panels: list[tuple] = []
    PW = 132.0
    if has:
        panels.append(("table", "DRIVEWAY AND CROSSOVER SCHEDULE", driveway_schedule(s, xg, front=b.front)))
        panels.append(("text", "DESIGN VEHICLE", _vehicle_lines(drv.design_vehicle, s.cites.typ.design_vehicle()), False))
        if not swept:
            panels.append(("text", "SWEPT PATH", [SWEPT_TBC, "THE PLATFORM PATH IS NOT DRAWN: IT DOES NOT FORM ONE CLEAN PATH INSIDE THE LOT, VERGE AND ROAD."], True))
        panels.append(("text", CHECK_TITLE, profile_check_lines(s), False))
    heights = [PN.table_height(p_[2], PW) if p_[0] == "table" else PN.panel_height(p_[2], PW, title=p_[1]) for p_ in panels]
    col = PN.column(b, heights, PW) if panels else None
    finish(b, "DRIVEWAY PLAN", reserve=col or ())
    if col:
        for p_, r_ in zip(panels, col):
            (PN.draw_table(v, r_, p_[1], p_[2], red_when=_row_is_flag) if p_[0] == "table" else PN.draw_panel(v, r_, p_[1], p_[2], warn=p_[3]))
    keep = b.keep
    if has:
        draw_chainage(b, ch_plan)                                        # reserved before the dimensions: leaders and dimensions route around every chainage label
    if b.xg.present:
        CX.callouts_crossover(v, xg, b.std, keep, list(b.hard), [s.lot], must_avoid=list(b.kerb_geoms), extra=["LAYOVER DIMENSIONS (SEE C420)"])       # first: it has the fewest free slots
    if b.xg.present and has and s.drive_cl is not None:
        cl_in = s.drive_cl.intersection(s.lot)
        seg = max(getattr(cl_in, "geoms", [cl_in]), key=lambda g: g.length) if not cl_in.is_empty else None
        if seg is not None and seg.geom_type == "LineString" and seg.length > 0:
            m = seg.interpolate(0.5, normalized=True)
            lines = ["PROPOSED DRIVEWAY", "MATERIAL TO BE CONFIRMED", f"WIDTH {drv.width_m:.1f}m (PLATFORM DEFAULT)"]
            if drv.max_grade_pct is not None:
                lines.append(f"MAX GRADE {drv.max_grade_pct:.1f}% (PLATFORM SCREENING LIMIT)")
            place(b, lines, (m.x, m.y), avoid=b.hard)
    if not col and has:                                                  # no clear column: the old behaviour, panels wherever the sheet is free
        for p_ in panels:
            text_panel(b, p_[1], [" ".join(str(x_) for x_ in r_) for r_ in p_[2]] if p_[0] == "table" else p_[2], PW, warn=(p_[0] == "text" and p_[3]))
    pave_callout(b)
    if s.spots and s.drive_poly is not None:                      # sparse design-sheet spot levels near the driveway (never on C100)
        D.spot_levels_sparse(b.v, s, s.drive_poly, h=TXT.BODY, avoid=list(b.kerb_geoms) + [s.lot.boundary, s.drive_poly] + [g for g in b.hard if g is not None and not g.is_empty])
    return seal(b, extra_notes=[f"CHAINAGE LABEL NOT PLACED ({', '.join(lost)}): SEE C410 FOR THE CHAINAGE" ] if lost else ())


def _row_is_flag(r) -> bool:
    return False


def driveway_schedule(s: Site, xg: CX.CrossoverGeom, front=None) -> list[tuple]:
    """Rows (item, value, basis) for the on-sheet driveway and crossover schedule: every value from the SA3 driveway result, the crossover geometry or the
    C410 profile, with its provenance (PLATFORM DEFAULT, NOT SURVEYED, SA3 and so on).  Nothing is typed in here."""
    drv = s.inp.driveway
    rows: list[tuple] = []
    lv = {r_["key"]: r_ for r_ in CX.layover_values(xg, front)}
    for key, lab in (("w_bdy", "CROSSOVER WIDTH AT BOUNDARY"), ("w_kerb", "CROSSOVER WIDTH AT KERB"), ("drive", "DRIVEWAY WIDTH"), ("d_kerb", "BOUNDARY TO KERB")):
        r_ = lv.get(key)
        if r_ is not None:
            rows.append((lab, CX._fmt_m(r_["m"]), r_["src"]))
    for lab, p1, p2 in (drv.dimensions if drv is not None else []):
        if "OFFSET" in lab.upper():
            rows.append(("OFFSET, BOUNDARY CORNER TO DRIVEWAY CENTRELINE", f"{math.dist(p1, p2):.2f}m", "SA3 DRIVEWAY RESULT"))
    if s.drive_cl is not None:
        rows.append(("DRIVEWAY LENGTH, KERB LINE TO END (CENTRELINE)", CX._fmt_m(s.drive_cl.length), "SA3 DRIVEWAY CENTRELINE"))
    p = ref_profile(s)
    if p is not None and p["proposed"]:
        rows.append(("DRIVEWAY END LEVEL", f"RL {p['st'][-1][1]:.2f}", "PLATFORM DEFAULT, NOT DESIGNED (m AHD)"))
    if xg.cited is not None:                    # SD-107 values, each cited (C420 draws and dimensions them)
        for key, lab in (("wing", "SPLAY DEPTH, BACK OF LAYBACK TO BACK OF KERB"), ("flare", "SPLAY ALONG KERB, EACH SIDE"), ("band", "LAYBACK RUN BEHIND NOMINAL KERB LINE")):
            r_ = lv.get(key)
            if r_ is not None:
                rows.append((lab, CX._fmt_m(r_["m"]), r_["src"]))
    else:
        rows.append(("WING LENGTH, KERB AND GUTTER BAND", "SEE C420", "DRAFTING CONVENTIONS (PLACEHOLDER)"))
    return rows


# ====================================================================================================== C410 long section
def _typical_notes(s: Site, ty: dict, exz) -> list[str]:
    lo, mid, hi = ty["pcts"]
    out = [f"COUNCIL TYPICAL LINE (SD-107), INDICATIVE: FROM THE ASSUMED KERB RL {ty['z0']:.2f} (FLOWLINE AT THE NOMINAL KERB LINE) THE LIP RISES {ty['lip'].vtext}, THE LAYBACK RISES "
           f"{ty['rise'].vtext} OVER ITS {ty['run'] * 1000:g} RUN TO THE E.J. AT RL {ty['z_ej']:.2f}, THEN {mid:g}% (MID OF THE CITED {lo:g} TO {hi:g}% PATHWAY CROSSFALL) TO THE PROPERTY BOUNDARY "
           f"[{ty['rise'].ref_short.upper()}]."]
    if ty.get("back") is not None:
        out.append(f"BACK OF LAYBACK RL {ty['z_ej']:.2f} IS {ty['z_ej'] - ty['z0']:.2f} m ABOVE THE KERB RL {ty['z0']:.2f}: NOT LOWER THAN THE KERB [{ty['back'].ref_short.upper()}].")
    zb, ze = ty["at"](ty["sb"]), exz(ty["sb"])
    dz = zb - ze
    out.append(f"AT THE PROPERTY BOUNDARY THE TYPICAL LINE RL {zb:.2f} IS {abs(dz):.2f} m {'ABOVE' if dz > 0.005 else ('BELOW' if dz < -0.005 else 'LEVEL WITH')} EXISTING GROUND RL {ze:.2f}"
               + (": THE VERGE WOULD HAVE TO BE FILLED OR REGRADED TO MEET IT. NO VERGE DESIGN IS DONE." if abs(dz) > 0.005 else "."))
    return out


def _typical_on_chart(v: View, ty: dict, hx, zy, exz, Lc: str, ticks: list, hs: float) -> None:
    """COUNCIL TYPICAL LINE (SD-107), INDICATIVE: kerb line to the property boundary only, from the assumed kerb RL (see ``_typical_line``), the 1.5 and 2.5 percent limits
    dashed beyond the expansion joint, and the level difference to existing ground at the boundary."""
    red = (0.85, 0.0, 0.0)
    t_ej, sb = ty["t_ej"], ty["sb"]
    lo, mid, hi = ty["pcts"]
    v.line([(hx(0.0), zy(ty["z0"])), (hx(0.0), zy(ty["z_lip"])), (hx(t_ej), zy(ty["z_ej"])), (hx(sb), zy(ty["at"](sb)))], Lc, False, 0.7, color=red)
    for pct in (lo, hi):
        v.line([(hx(t_ej), zy(ty["z_ej"])), (hx(sb), zy(ty["at"](sb, pct)))], Lc, False, 0.15, "DASHED", color=red)
    # label centred in the widest gap between two station ticks on the typical line, so no tick runs through it
    need = fonts.text_width("COUNCIL TYPICAL LINE (SD-107), INDICATIVE", TXT.BODY) + 6.0
    tt = sorted(t for t in ticks if t_ej - 1e-9 <= t <= sb + 1e-9)
    gaps = [((a_ + b_) / 2, (b_ - a_) * 1000.0 / hs) for a_, b_ in zip(tt, tt[1:])]
    ok = [g_ for g_ in gaps if g_[1] >= need]
    tl = max(ok, key=lambda g_: g_[1])[0] if ok else (t_ej + sb) / 2
    v.text(hx(tl), zy(ty["at"](min(sb, tl + need / 2.0 * hs / 1000.0), hi)) + 3.0, "COUNCIL TYPICAL LINE (SD-107), INDICATIVE", TXT.BODY, "BOTTOM_CENTER", layer=Lc, color=red, halo=True)
    # level difference to existing ground at the property boundary
    zb, ze = ty["at"](sb), exz(sb)
    xb = hx(sb) + 3.0
    v.line([(xb, zy(ze)), (xb, zy(zb))], Lc, False, 0.25, color=red)
    for zz in (ze, zb):
        v.line([(xb - 1.2, zy(zz)), (xb + 1.2, zy(zz))], Lc, False, 0.25, color=red)
    dz = zb - ze
    word = "ABOVE" if dz > 0.005 else ("BELOW" if dz < -0.005 else "LEVEL WITH")
    d_lo, d_hi = sorted((ty["at"](sb, lo) - ze, ty["at"](sb, hi) - ze))
    txt = [f"AT THE BOUNDARY: TYPICAL LINE RL {zb:.2f} IS {abs(dz):.2f} m {word}", f"EXISTING GROUND RL {ze:.2f} ({abs(d_lo):.2f} TO {abs(d_hi):.2f} m FOR {lo:g} TO {hi:g}%)"]
    for i, ln in enumerate(txt):
        v.text(xb + 3.0, (zy(ze) + zy(zb)) / 2 + (1.8 - 3.6 * i), ln, TXT.BODY, "MIDDLE_LEFT", layer=Lc, color=red, halo=True)


def _bar(sv: View, x: float, y: float, length: float, metres: float, horizontal: bool, label: str) -> None:
    P = ST.Paper(sv)
    n = 4
    for i in range(n):
        if horizontal:
            quad = [(x + i * length / n, y), (x + (i + 1) * length / n, y), (x + (i + 1) * length / n, y + 2.0), (x + i * length / n, y + 2.0)]
        else:
            quad = [(x, y + i * length / n), (x + 2.0, y + i * length / n), (x + 2.0, y + (i + 1) * length / n), (x, y + (i + 1) * length / n)]
        P.poly(quad, "C-ANNO-NRTH", ST.BLACK if i % 2 == 0 else ST.WHITE, edge=ST.BLACK, edge_lw=0.18)
    for i in range(n + 1):
        t = f"{metres * i / n:g}" + (" m" if i == n else "")
        if horizontal:
            P.text(x + i * length / n, y + 3.0, t, TXT.BODY, "BOTTOM_LEFT" if i == n else "BOTTOM_CENTER", layer="C-ANNO-NRTH")
        else:
            P.text(x + 3.0, y + i * length / n, t, TXT.BODY, "MIDDLE_LEFT", layer="C-ANNO-NRTH")
    if horizontal:
        P.text(x, y - 1.2, label, TXT.BODY, "TOP_LEFT", bold=True, layer="C-ANNO-NRTH")
    else:
        P.text(x, y - 2.0, label, TXT.BODY, "TOP_LEFT", bold=True, layer="C-ANNO-NRTH")


def c410(ctx: RefCtx) -> Sheet:
    s = ctx.site
    sh = Sheet("C410", codes.SHEET_TITLES["C410"], "", paper=A1, north=None)
    v = sh.add(View("chart", VIEW_RECT))
    p = ref_profile(s)
    nrect, _ = notes_layout(ctx.proj, ["DEM-DERIVED LEVELS ARE INDICATIVE"], (), reserve=2)
    if p is None:
        why = []
        if s.drive_cl is None:
            why.append("driveway centreline (SA3 driveway result not supplied)")
        if s.tin is None:
            why.append("existing levels along the centreline (no survey or DEM levels supplied)")
        PN.no_data(v, (VIEW_RECT[0] + 8, VIEW_RECT[3] - 70, VIEW_RECT[0] + 200, VIEW_RECT[3] - 8), "LONGITUDINAL SECTION NOT DRAWN.", "Needed: " + "; ".join(why) + ".")
        sh.data_missing.append("driveway long section: " + "; ".join(why))
        sh.notes = ["LONGITUDINAL SECTION NOT DRAWN: DATA NOT AVAILABLE"]
        sh.scale_text = "NOT DRAWN"
        return sh
    ex, st, L, gw, proposed = p["ex"], p["st"], p["L"], p["gw"], p["proposed"]
    des, exz = p["design"], p["exz"]
    ty = p.get("typ")
    zs = [e[1] for e in ex] + [x[1] for x in st] + ([ty["z_lip"], ty["z_ej"], ty["at"](ty["sb"], ty["pcts"][2])] if ty else [])
    zmin, zmax = min(zs), max(zs)
    datum = math.floor((zmin - 0.1) * 20 + 1e-9) / 20.0
    # vertical budget: plan strip at the top, data bands on the bottom of the content area, the chart (profile and station labels) between them.  The scale
    # is the largest that fits the width and this budget; any height left over goes to the strip and the data bands, so no band is left empty.
    CY1, CY0 = CONTENT_Y1 - 2.0, CONTENT_Y0 + 2.0
    ROWH0, SH0, GAP = 19.0, 28.0, 5.0
    def _lab(zz, nm):
        return f"{nm}  RL {zz:.2f}" + ("" if proposed else " (EXISTING)")
    lab_ws = {t_: fonts.text_width(_lab(zz, nm), TXT.BODY) for t_, zz, nm in st}
    avail = (CY1 - SH0 - GAP) - (CY0 + 4 * ROWH0)

    def need_h(vs_: float) -> float:
        """Height above the datum line needed by the profile and the top-aligned station labels (each label sits above its own station point)."""
        return max((max(zz, exz(t_), (ty["at"](t_, ty["pcts"][2]) or 0.0) if ty else 0.0) - datum) * 1000.0 / vs_ + 8.0 + lab_ws[t_] for t_, zz, nm in st) + 3.0
    hs, vs, ex_ = 200, 40, 5
    fit_ = False
    for hs_ in (10, 20, 25, 50, 100, 200):                              # smallest denominator that fits: the largest drawing, using the sheet width
        for ex__ in (5, 2.5, 2, 1):                                     # vertical exaggeration: vertical scale is 1:(H denominator / exaggeration)
            vs_ = hs_ / ex__
            if (L + 1.0) * 1000.0 / hs_ <= 704.0 and need_h(vs_) <= avail:
                hs, vs, ex_, fit_ = hs_, vs_, ex__, True
                break
        if fit_:
            break
    spare = max(0.0, avail - need_h(vs))
    ROWH = ROWH0 + min(spare * 0.35 / 4.0, 5.0)
    SH_ = SH0 + min(spare - 4.0 * (ROWH - ROWH0), 22.0)
    X0 = 74.0
    Yd = CY0 + 4 * ROWH
    strip_note: list[str] = []
    sy1 = CY1                                                         # the plan strip is anchored to the top of the content area, the data bands to the bottom
    sy0 = sy1 - SH_
    hx = lambda t: X0 + (t + 0.5) * 1000.0 / hs        # noqa: E731
    zy = lambda z: Yd + (z - datum) * 1000.0 / vs      # noqa: E731
    Lc = "C-DRIV-LONG"
    xr = hx(L + 0.5)
    rows_ = ("TYPICAL LEVEL (SD-107)" if ty else "DESIGN LEVEL", "EXISTING LEVEL", "CUT/FILL DEPTH", "CHAINAGE")
    ybot = Yd - ROWH * len(rows_)
    # datum, VERT EXAG and RL grid ---------------------------------------------------------------------------------------------
    v.text(28.0, Yd + 8.0, f"VERT EXAG {ex_:g}", TXT.LABEL, "BOTTOM_LEFT", bold=True, layer=Lc)
    v.text(28.0, Yd + 2.5, f"DATUM RL {datum:.3f}", TXT.LABEL, "BOTTOM_LEFT", bold=True, layer=Lc)
    z = math.ceil(datum / 0.5 + 1e-9) * 0.5
    while zy(z) <= sy0 - 6.0:                                          # RL grid up to the plan strip
        v.line([(X0 - 2, zy(z)), (xr, zy(z))], "C-ANNO-TABL", False, 0.05, color=(0.8, 0.8, 0.8))
        v.text(X0 - 3, zy(z), f"{z:.2f}", TXT.BODY, "MIDDLE_RIGHT", layer=Lc)
        z += 0.5
    v.line([(27.0, Yd), (xr, Yd)], Lc, False, 0.35)
    # data bands ----------------------------------------------------------------------------------------------------------------
    for i, lab in enumerate(rows_):
        yt = Yd - i * ROWH
        v.line([(27.0, yt - ROWH), (xr, yt - ROWH)], "C-ANNO-TABL", False, 0.2)
        v.text(28.0, yt - ROWH / 2, lab, TXT.BODY, "MIDDLE_LEFT", bold=True, layer="C-ANNO-TABL")
    v.line([(27.0, Yd), (27.0, ybot)], "C-ANNO-TABL", False, 0.2)
    v.line([(X0 - 4, Yd), (X0 - 4, ybot)], "C-ANNO-TABL", False, 0.2)
    v.line([(xr, Yd), (xr, ybot)], "C-ANNO-TABL", False, 0.2)
    stat_t = [q[0] for q in st]
    pts = list(stat_t)
    for t in [i * 2.0 for i in range(int(L / 2.0) + 1)] + [L]:
        if all(abs(t - q) * 1000.0 / hs >= 4.6 for q in pts):
            pts.append(t)
    pts = sorted(pts)
    lab_top = sy0 - 4.0                                                 # station labels are top aligned under the plan strip; each station line runs up to its label
    lab_base = lambda t_: lab_top - lab_ws[t_]                          # noqa: E731
    for t in pts:
        x = hx(t)
        zex = exz(t)
        zde = des(t) if proposed else (ty["at"](t) if ty else None)
        ytop = lab_base(t) - 1.5 if t in lab_ws else zy(max(zex, zde if zde is not None else zex))
        v.line([(x, Yd), (x, ytop)], Lc, False, 0.1, "DASHED", color=(0.45, 0.45, 0.45))        # ticks break at the data bands (text sits there)
        for k_ in range(len(rows_) + 1):
            v.line([(x, Yd - k_ * ROWH - 1.2), (x, Yd - k_ * ROWH + 1.2)], "C-ANNO-TABL", False, 0.15)
        vals = [f"{zde:.3f}" if zde is not None else "N/A", f"{zex:.3f}", ("N/A" if zde is None else (f"{abs(zex - zde):.2f} CUT" if zex - zde > 0.005 else (f"{abs(zex - zde):.2f} FILL" if zex - zde < -0.005 else "0.00"))), f"{t:.2f}"]
        for i, tx in enumerate(vals):
            v.text(x, Yd - i * ROWH - ROWH / 2, tx, TXT.BODY, "MIDDLE_CENTER", 90.0, layer="C-ANNO-TABL")
    # profile -----------------------------------------------------------------------------------------------------------------------
    v.line([(hx(t), zy(zz)) for t, zz in ex], "C-DRIV-EXGD", False, 0.35, color=(0.3, 0.3, 0.3))
    if ty:
        _typical_on_chart(v, ty, hx, zy, exz, Lc, pts, hs)
    if proposed:
        v.line([(hx(t), zy(zz)) for t, zz, _n in st], Lc, False, 0.7, color=(0.85, 0, 0))
        for (t0, z0_, _a), (t1, z1, _b) in zip(st, st[1:]):
            g = 100.0 * (z1 - z0_) / (t1 - t0)
            txt = f"{g:+.1f}%"
            if (t1 - t0) * 1000.0 / hs < fonts.text_width(txt, TXT.BODY) + 3.0:
                continue
            xm, ym = hx((t0 + t1) / 2), (zy(z0_) + zy(z1)) / 2
            ang = math.degrees(math.atan2(zy(z1) - zy(z0_), hx(t1) - hx(t0)))
            v.text(xm, ym + 3.2, txt, TXT.BODY, "MIDDLE_CENTER", ang, bold=True, layer=Lc, color=(0.85, 0, 0), halo=True)
    for t, zz, nm in st:
        v.text(hx(t) - 1.6, lab_base(t), _lab(zz, nm), TXT.BODY, "MIDDLE_LEFT", 90.0, layer=Lc, halo=True)
    tg = min(max(L * 0.62, st[-1][0] * 0.55), L)
    need = fonts.text_width("DESIGN LEVEL (PLATFORM PROFILE)", TXT.BODY) + 8.0
    gaps = [((a_ + b_) / 2, (b_ - a_) * 1000.0 / hs) for a_, b_ in zip(pts, pts[1:]) if (b_ - a_) * 1000.0 / hs >= need]
    if gaps:
        tg = min(gaps, key=lambda g_: abs(g_[0] - tg))[0]               # centred between two station ticks: no tick runs through the label
    low = zy(min(exz(tg), des(tg) if proposed else exz(tg)))
    high = zy(max(exz(tg), des(tg) if proposed else exz(tg)))
    v.text(hx(tg), high + 9.0, "EXISTING GROUND (INDICATIVE, DEM)", TXT.BODY, "BOTTOM_CENTER", layer="C-DRIV-EXGD", color=(0.3, 0.3, 0.3), halo=True)
    if proposed:
        v.text(hx(tg), low - 14.0, "DESIGN LEVEL (PLATFORM PROFILE)", TXT.BODY, "TOP_CENTER", layer=Lc, color=(0.85, 0, 0), halo=True)
    # scale bars -------------------------------------------------------------------------------------------------------------------------
    mh = next((m for m in (1, 2, 4, 8, 20, 40) if m * 1000.0 / hs >= 25.0), 100)
    lh = mh * 1000.0 / hs
    mv = max([m for m in (0.04, 0.2, 0.4, 1, 2, 4, 8) if m * 1000.0 / vs <= 80.0] or [0.04])         # bar length whose four steps are round figures (0.05, 0.1, 0.25, 0.5, 1, 2 m)
    _bar(v, xr + 14.0, Yd + 6.0, mv * 1000.0 / vs, mv, False, f"VERTICAL SCALE 1:{vs:g} @ A1")
    title_strip(sh, sh.title.upper(), f"H 1:{hs}  V 1:{vs:g} @ A1    H 1:{a3_scale(hs)}  V 1:{a3_scale(vs):g} @ A3", hs, notes=([] if proposed else ["EXISTING GROUND ONLY: PROPOSED LEVELS NOT AVAILABLE."]))
    sh.scale_text = f"H 1:{hs} V 1:{vs:g}"
    # status, checks, notes ---------------------------------------------------------------------------------------------------------------
    lines = []
    dna_ = None
    veh_ = s.inp.driveway.design_vehicle if s.inp.driveway is not None else "B85"
    if not proposed:
        dna_ = ("PROPOSED DRIVEWAY LEVELS NOT AVAILABLE.", f"No driveway end level is supplied and none is assumed, so the driveway design line, its grades and the {veh_} checks are not drawn."
                + (" The council typical line covers the kerb line to the property boundary only." if ty else ""))
        sh.data_missing.append("proposed driveway levels and checks: no driveway end level supplied (none is assumed)")
        lines.append(_council_grade_line(s, False))
        if ty:
            lines += _typical_notes(s, ty, exz)
    else:
        lines += profile_check_lines(s)
        lines.append(NO_VERGE_DESIGN + ".")
        lines.append(f"DRIVEWAY END LEVEL RL {st[-1][1]:.2f} IS THE SUPPLIED FINISHED FLOOR LEVEL: NO BUILDING LEVEL IS DESIGNED HERE.")
        if ty:
            lines += _typical_notes(s, ty, exz)
    fl = falls_to_lot_note(s)
    if fl:
        lines.append(fl + ".")
    lines.append(f"EXISTING GROUND {DEM_NOTE_REF}. KERB LINE, GUTTER BAND ({CX._fmt_m(gw)}) AND PROPERTY BOUNDARY POSITIONS ARE ASSUMED GROUND POINTS (KERB NOT SURVEYED).")
    pw = min(165.0, VIEW_RECT[2] - 2.0 - (xr + 12.0))               # notes column to the right of the profile (the chart keeps the full width)
    h_ = PN.panel_height(lines, pw, title="NOTES AND " + CHECK_TITLE)
    ptop = CONTENT_Y1 - 2.0
    PN.draw_panel(v, (xr + 12.0, ptop - h_, xr + 12.0 + pw, ptop), "NOTES AND " + CHECK_TITLE, lines)
    if dna_ is not None:                                              # the data not available box sits under the notes, in the right column: the chart keeps its whole height
        hp_ = PN.panel_height([dna_[0], dna_[1]], pw)
        PN.no_data(v, (xr + 12.0, ptop - h_ - 4.0 - hp_, xr + 12.0 + pw, ptop - h_ - 4.0), dna_[0], dna_[1])
    # plan strip aligned to the chainage of the profile (lateral extent diagrammatic) ---------------------------------------------
    _plan_strip(v, s, X0, xr, hx, sy0, sy1, L, gw, p["sb"])
    sh.notes = ["LONGITUDINAL SECTION ALONG THE SA3 DRIVEWAY CENTRELINE. CHAINAGE 0 IS THE KERB LINE.", "LEVELS ARE DEM-DERIVED AND INDICATIVE."] + ([fl] if fl else []) + strip_note
    return sh


def _plan_strip(v: View, s: Site, X0: float, xr: float, hx, y0: float, y1: float, L: float, gw: float, sb: float) -> None:
    """Plan strip above the long section, on the same chainage axis: kerb line, kerb and gutter band, property boundary, layover (concrete stipple) and
    driveway (surface from the cited value only).  The lateral extent is DIAGRAMMATIC: the strip is not to scale across the driveway."""
    P = ST.Paper(v)
    P.line([(27.0, y0), (xr, y0), (xr, y1), (27.0, y1)], "C-ANNO-TABL", 0.2, None, None, True)
    P.line([(X0 - 4.0, y0), (X0 - 4.0, y1)], "C-ANNO-TABL", 0.2)
    v.text(28.0, (y0 + y1) / 2 + 3.0, "PLAN", TXT.BODY, "MIDDLE_LEFT", bold=True, layer="C-ANNO-TABL")
    v.text(28.0, (y0 + y1) / 2 - 1.0, "(DIAGRAMMATIC,", TXT.BODY, "MIDDLE_LEFT", layer="C-ANNO-TABL")
    v.text(28.0, (y0 + y1) / 2 - 3.6, "NOT TO SCALE ACROSS)", TXT.BODY, "MIDDLE_LEFT", layer="C-ANNO-TABL")
    xk, xg_, xb, xe = hx(0.0), hx(gw), hx(sb), hx(L)
    ym, hw = (y0 + y1) / 2, 7.0
    # road to the left of the kerb line and the gutter band (hatch between the kerb line and the back of the band)
    P.poly([(X0 - 4.0 + 0.5, y0 + 0.5), (xk, y0 + 0.5), (xk, y1 - 0.5), (X0 - 4.0 + 0.5, y1 - 0.5)], "C-ROAD-PAVE", ST.BITUMEN, edge=None)
    v.text((X0 - 4.0 + xk) / 2, ym, "ROAD", TXT.BODY, "MIDDLE_CENTER", layer="C-ANNO-TABL")
    P.poly([(xk, y0 + 0.5), (xg_, y0 + 0.5), (xg_, y1 - 0.5), (xk, y1 - 0.5)], "C-ROAD-KERB", (0.82, 0.82, 0.82), edge=None)
    for xx, lw_ in ((xk, ST.REF.kerb_lw), (xg_, ST.REF.gutter_lw)):
        P.line([(xx, y0 + 0.5), (xx, y1 - 0.5)], "C-ROAD-KERB", lw_, ST.BLACK if xx == xk else ST.FENCE)
    # layover: kerb line to the property boundary; driveway: boundary to the end of the profile
    if xb > xg_ + 1.0:
        lay = Polygon([(xg_, ym - hw), (xb, ym - hw), (xb, ym + hw), (xg_, ym + hw)])
        ST.concrete_fill(v, lay, "C-ROAD-CONC")
        if xb - xg_ > 38.0:
            v.text((xg_ + xb) / 2, y1 - 3.0, "LAYOVER (SEE C420)", TXT.BODY, "TOP_CENTER", bold=True, layer="C-ANNO-TABL", halo=True)
        if xb - xg_ > 90.0:
            v.text((xg_ + xb) / 2, y0 + 1.8, "NO VERGE DESIGN: DESIGN LINE IS THE EXISTING SURFACE", TXT.BODY, "BOTTOM_CENTER", layer="C-ANNO-TABL", halo=True)
    if xe > xb + 1.0:
        drv = Polygon([(xb, ym - hw), (xe, ym - hw), (xe, ym + hw), (xb, ym + hw)])
        ST.driveway_fill(v, drv, SEC.TypicalValues(s.cites).material())
        v.text((xb + xe) / 2, y1 - 3.0, "DRIVEWAY (SURFACE PER CITED VALUE, ELSE TO BE CONFIRMED)", TXT.BODY, "TOP_CENTER", bold=True, layer="C-ANNO-TABL", halo=True)
    P.line([(xk, ym), (xe, ym)], "C-DRIV-CNTR", 0.18, ST.BLACK, "DASHDOT")
    P.line([(xb, y0 + 0.5), (xb, y1 - 0.5)], "C-PROP-BDY", ST.REF.boundary_lw, ST.BLACK)
    P.line([(xb, y0 + 0.5), (xb, y1 - 0.5)], "C-PROP-BDYD", ST.REF.dash_lw, ST.YELLOW, ST.DASH_BDY)
    v.text(xb + 1.5, y0 + 2.0, "PROPERTY BOUNDARY", TXT.BODY, "BOTTOM_LEFT", layer="C-ANNO-TABL", halo=True)
    v.text(xe - 1.5, y0 + 2.0, "END OF PROFILE", TXT.BODY, "BOTTOM_RIGHT", layer="C-ANNO-TABL", halo=True)
    v.text(xk - 1.5, y0 + 2.0, "KERB LINE", TXT.BODY, "BOTTOM_RIGHT", layer="C-ANNO-TABL", halo=True)


# ====================================================================================================== C420 driveway layover details
def c420(ctx: RefCtx) -> Sheet:
    s, proj = ctx.site, ctx.proj
    sh = Sheet("C420", codes.SHEET_TITLES["C420"], "", paper=A1, north=0.0)
    front, drv, std, xg = make_xg(s, 0.0)
    cit = xg.cited
    T = s.cites.typ
    if cit is not None:
        notes = [f"CROSSING DRAWN TO {cit.label}. GSC RD003, RD0010, RD011 NOT PUBLISHED: OBTAIN FROM COUNCIL."] + CX.crossover_notes(xg, std)
        fw = T.get("eng.verge.footway_width_built_up_min")
        if fw is not None and fw.number and xg.kerb_offset_m and xg.kerb_offset_m < fw.number:
            notes.append(f"BOUNDARY TO KERB {CX._fmt_m(xg.kerb_offset_m)} (PLATFORM DEFAULT, NOT SURVEYED) IS LESS THAN THE CITED FOOTWAY WIDTH {fw.value} m ({fw.ref_short}): SURVEY REQUIRED")
        if xg.width_note:
            notes.append(xg.width_note)
    else:
        notes = [CX.LAYOVER_STANDARD_NOTE] + CX.crossover_notes(xg, std)
    nrect, _ = notes_layout(proj, _dedupe(notes), (), reserve=2)
    v = sh.add(View("layover", PLAN_RECT))
    P = ST.Paper(v)
    if not xg.present:
        PN.no_data(v, (VIEW_RECT[0] + 8, VIEW_RECT[1] + 8, VIEW_RECT[2] - 8, VIEW_RECT[3] - 8), "DRIVEWAY LAYOVER NOT DRAWN.", (xg.note or CX.NO_DRIVEWAY_TEXT) + " Needed: SA3 driveway result with a crossover polygon. The layover plan, dimensions and typical cross section need the crossover.")
        sh.data_missing.append("driveway layover (SA3 driveway result)")
        sh.notes = _dedupe(notes)
        sh.scale_text = "NOT DRAWN"
        return sh
    fr, w, f, Dk = xg.frontage, xg.width_m, xg.flare_m, xg.kerb_offset_m
    avail, gw, ex = xg.avail_m, xg.band_w_m, xg.band_extra_m
    sa, sb, sc0 = xg.centre_s - w / 2, xg.centre_s + w / 2, xg.centre_s
    sgn = -1.0 if (fr.u[0] * fr.n[1] - fr.u[1] * fr.n[0]) > 0 else 1.0          # road at the bottom of the sheet, no mirroring
    PX0, PX1, PY0, PY1 = CONTENT_X0, 566.0, CONTENT_Y0 + 2.0, CONTENT_Y1 - 2.0
    half = w / 2 + f + ex + 1.6
    t_lo, t_hi = -2.2, Dk + (xg.road_side_m or 0.0) + 2.0
    sc = 50
    for cand in (10, 20, 25, 50):
        if 2 * half * 1000 / cand <= PX1 - PX0 - 16 and (t_hi - t_lo) * 1000 / cand <= PY1 - PY0 - 30:
            sc = cand
            break
    k = 1000.0 / sc
    Xc, Yc, t_mid = (PX0 + PX1) / 2, (PY0 + PY1) / 2 - 6, (t_lo + t_hi) / 2

    def M(s_, t_):
        return (Xc + sgn * (s_ - sc0) * k, Yc - (t_ - t_mid) * k)

    def mp(poly):
        return Polygon([M(*fr.st(x, y)) for x, y in poly.exterior.coords])

    xl, xr = Xc - half * k, Xc + half * k
    yt, yb = M(0, t_lo)[1], M(0, t_hi)[1]
    sl, sr = sc0 - half, sc0 + half
    road = Polygon([(xl, M(0, Dk)[1]), (xr, M(0, Dk)[1]), (xr, yb), (xl, yb)])
    ST.bitumen_fill(v, road)
    drive_w = xg.drive_width_m or w
    dpoly = Polygon([M(sc0 - drive_w / 2, t_lo), M(sc0 + drive_w / 2, t_lo), M(sc0 + drive_w / 2, 0), M(sc0 - drive_w / 2, 0)])
    ST.driveway_fill(v, dpoly, SEC.TypicalValues(s.cites).material())          # lighter than the crossover so dimensions and text read clearly
    hardp = [dpoly]
    for key in ("band", "wing_a", "wing_b", "body"):
        if xg.polys[key].area > 1e-6:
            ST.concrete_fill(v, mp(xg.polys[key]), "C-ROAD-CONC", light=True)
            hardp.append(mp(xg.polys[key]))
    ST.kerb(v, LineString([M(sl, Dk - gw), M(sr, Dk - gw)]), gutter=True)
    ST.kerb(v, LineString([M(sl, Dk), M(sr, Dk)]))
    ST.boundary(v, LineString([M(sl, 0), M(sr, 0)]))
    P.line([(xl, yt), (xr, yt), (xr, yb), (xl, yb)], "C-ANNO-TABL", 0.25, ST.BLACK, closed=True)
    # north point, scale bar, title (reserved first) ----------------------------------------------------------------------------------
    nvec = (0.0, 1.0)
    ds, dt_ = nvec[0] * fr.u[0] + nvec[1] * fr.u[1], nvec[0] * fr.n[0] + nvec[1] * fr.n[1]
    north_deg = math.degrees(math.atan2(sgn * ds, -dt_)) % 360.0
    ncx, ncy = PX1 - 24.0, PY1 - 24.0
    ST.north_point(v, ncx, ncy, 11.0, north_deg)
    sh.scale_text = f"PLAN 1:{sc} @ A1"
    title_strip(sh, "DRIVEWAY LAYOVER PLAN", scale_pair(sc), sc, notes=[f"SECTIONS ON THIS SHEET ARE TYPICAL AND NOT TO SCALE (NTS)."])
    keep = [(ncx - 16, ncy - 16, ncx + 24, ncy + 20), (nrect[0] - 3, nrect[1] - 1, nrect[2] + 1, nrect[3] + 3), (570.0, CONTENT_Y0, 830.0, 585.0)]
    for kb in keep:
        v.reserve(kb)
    # dimensions: spread out, each at the first clear offset ----------------------------------------------------------------------------------
    PH = " " + CX.PLACEHOLDER_TAG
    lv = {r_["key"]: r_["src"] for r_ in CX.layover_values(xg)}                                  # one provenance source for the schedule and the plan dimensions
    PD = " (" + lv.get("flare", CX.FLARE_SRC) + ")"
    flare_ph = PD if xg.flare_source == "SA3 DRIVEWAY POLYGON" else PH + PD                      # the flare is always a platform default (placeholder as well when drawn by convention)
    wid_ph = " (" + lv.get("w_bdy", CX.WIDTH_SRC) + ")"
    left, up, down = (-1.0, 0.0), (0, 1), (0, -1)
    avoid = [g.buffer(0.3) for g in hardp]
    if cit is None:
        dim_best(v, M(sc0 - drive_w / 2, t_lo), M(sc0 + drive_w / 2, t_lo), f"DRIVEWAY WIDTH {CX._fmt_m(drive_w)}{wid_ph}", (9.0, 16.0), (up,), TXT.BODY, [])
        dim_best(v, M(sa, 0), M(sb, 0), f"LAYOVER WIDTH AT BOUNDARY {CX._fmt_m(w)}{wid_ph}", (14.0, 22.0), (up, down), TXT.BODY, [])
        dim_best(v, M(sa - f, avail), M(sb + f, avail), f"LAYOVER WIDTH AT KERB {CX._fmt_m(w + 2 * f)}{flare_ph}", (gw * k + 16.0, gw * k + 24.0), (down,), TXT.BODY, [])
        dim_best(v, M(sb, avail), M(sb + f, avail), f"FLARE {CX._fmt_m(f)}{flare_ph}", (gw * k + 7.0, gw * k + 11.0), (down,), TXT.BODY, [])
        s_e = sa if sgn > 0 else sb
        dim_best(v, M(s_e, xg.body_len_m), M(s_e, avail), f"WING LENGTH {CX._fmt_m(xg.wing_len_m)}{PH}", (f * k + 9.0, f * k + 16.0), (left,), TXT.BODY, [])
        s_l = sc0 - sgn * (w / 2 + f + ex + 0.3)
        dim_best(v, M(s_l, 0), M(s_l, Dk), f"BOUNDARY TO KERB {CX._fmt_m(Dk)}", (9.0, 16.0), (left,), TXT.BODY, [])
        s_r = sc0 + sgn * (w / 2 + f + ex)
        dim_best(v, M(s_r, Dk - gw), M(s_r, Dk), f"KERB AND GUTTER BAND {CX._fmt_m(gw)}{PH}", (9.0, 15.0), ((1.0, 0.0),), TXT.BODY, [])
    else:                                                                                              # council standard drawing: every dimension carries SD-107 (width: the SA3 width held to the cited range)
        lab = cit.label
        rngtxt = f"{cit.width_min_m * 1000:g} MIN TO {cit.width_max_m * 1000:g} MAX"
        lip = avail + xg.wing_len_m
        dim_best(v, M(sc0 - drive_w / 2, t_lo), M(sc0 + drive_w / 2, t_lo), f"DRIVEWAY WIDTH {CX._fmt_m(drive_w)} (SA3 WIDTH, PLATFORM DEFAULT)", (9.0, 16.0), (up,), TXT.BODY, [])
        dim_best(v, M(sa, 0), M(sb, 0), f"WIDTH AT BOUNDARY {CX._fmt_m(w)} ({lab}: {rngtxt})", (14.0, 22.0), (up, down), TXT.BODY, [])
        dim_best(v, M(sa - f, lip), M(sb + f, lip), f"OVERALL WIDTH AT KERB {CX._fmt_m(w + 2 * f)} ({lab}: {cit.overall_min_m * 1000:g} MIN TO {cit.overall_max_m * 1000:g} MAX)", ((Dk + xg.road_side_m - lip) * k + 14.0, (Dk + xg.road_side_m - lip) * k + 22.0), (down,), TXT.BODY, [])
        dim_best(v, M(sb, lip), M(sb + f, lip), f"SPLAY {CX._fmt_m(f)} ({lab})", ((Dk + xg.road_side_m - lip) * k + 6.0, (Dk + xg.road_side_m - lip) * k + 10.0), (down,), TXT.BODY, [])
        s_e = sa if sgn > 0 else sb
        dim_best(v, M(s_e, avail), M(s_e, lip), f"SPLAY DEPTH {CX._fmt_m(xg.wing_len_m)} (BACK OF LAYBACK TO BACK OF KERB; {lab})", (f * k + 9.0, f * k + 16.0), (left,), TXT.BODY, [])
        s_l = sc0 - sgn * (w / 2 + f + 0.5)
        dim_best(v, M(s_l, 0), M(s_l, Dk), f"BOUNDARY TO KERB {CX._fmt_m(Dk)}", (9.0, 16.0), (left,), TXT.BODY, [])
        s_r = sc0 + sgn * (w / 2 + f + 0.2)
        dim_best(v, M(s_r, avail), M(s_r, Dk), f"LAYBACK RUN {CX._fmt_m(gw)} ({lab})", (9.0, 15.0), ((1.0, 0.0),), TXT.BODY, [])
        dim_best(v, M(s_r, Dk), M(s_r, Dk + xg.road_side_m), f"{CX._fmt_m(xg.road_side_m)}", (9.0, 15.0), ((1.0, 0.0),), TXT.BODY, [])
        # joints and saw cut as SD-107: E.J. at the back of the layback with R16 dowels at 300 centres, E.J. at the boundary, saw cut across the existing kerb and gutter
        P.line([M(sa, avail), M(sb, avail)], "C-ANNO-NOTE", 0.7, ST.BLACK)
        P.line([M(sa, 0), M(sb, 0)], "C-ANNO-NOTE", 0.7, ST.BLACK)
        n_t = max(int(w // 0.3), 1)
        for i_ in range(n_t + 1):
            sx_ = sa + i_ * w / n_t
            a_, b_ = M(sx_, avail), M(sx_, avail - 0.13)
            P.line([a_, b_], "C-ANNO-NOTE", 0.3, ST.BLACK)
        for s_c in (sa - f, sb + f):
            P.line([M(s_c, lip), M(s_c, Dk + xg.road_side_m)], "C-ANNO-NOTE", 0.5, ST.BLACK, dash="DASHED")
        P.line([M(sc0, 0), M(sc0, avail)], "C-ANNO-NOTE", 0.3, ST.BLACK, dash="DASHED") if w > 4.2 else None
    # labels, each at the first free spot ----------------------------------------------------------------------------------------------------
    def put(txt, cands, h=TXT.BODY, **kw):
        for x, y, anc in cands:
            if v.label(x, y, txt, h, 0.0, anc, nudges=False, **kw):
                return True
        v.fallback_notes.append(txt)
        return False

    kerb_src = "USER INPUT" if xg.kerb_source == "USER INPUT" else "PLATFORM DEFAULT"
    lot_txt = f"LOT {s.inp.lot.lotplan.replace('//', ' ')} (SUBJECT LOT)".upper()
    put(lot_txt, [(xl + 3, yt - 3, "TOP_LEFT")], TXT.LABEL, bold=True, color=None, halo=True)
    if front is not None:
        ltr = "LEFT TO RIGHT" if sgn > 0 else "RIGHT TO LEFT"
        put(f"FRONT BOUNDARY: BEARING {front.bearing_dms}  {CX.frontage_length_m(front):.2f}m ({ltr}, CADASTRE)", [(xr - 3, M(0, 0)[1] + 3.0 + d, "BOTTOM_RIGHT") for d in (0, 4, 8)], halo=True)
    put("BOUNDARY FROM CADASTRE: NOT A SURVEY", [(xr - 3, M(0, 0)[1] - 3.0 - d, "TOP_RIGHT") for d in (0, 4, 8)], halo=True)
    put(f"VERGE (ASSUMED, NOT SURVEYED; {kerb_src})", [(xr - 3, M(0, Dk / 2)[1] + d, "MIDDLE_RIGHT") for d in (0, 6, -6, 12)], halo=True)
    put("ROAD (ASSUMED PAVEMENT EXTENT)", [(xl + 3, M(0, Dk + 1.0)[1] + d, "MIDDLE_LEFT") for d in (0, -5, 5, 10)], halo=True)
    if cit is None:
        CO.place_callout(v, ["KERB AND GUTTER BAND", CX.KERB_ASSUMED_TEXT], M(s_r + sgn * 0.5, Dk - gw / 2), "arrow", keep, must=True)
    else:
        CO.place_callout(v, ["NOMINAL KERB LINE", CX.KERB_ASSUMED_TEXT, f"GUTTER CROSSING {CX._fmt_m(xg.road_side_m)} EACH SIDE ({lab})"], M(s_r + sgn * 0.5, Dk), "arrow", keep, must=True)
        CO.place_callout(v, ["E.J. AT THE BACK OF THE LAYBACK (SD-107 NOTE 7)", "R16 DOWELS 300 LONG AT 300 CENTRES, BOND BREAK TO ONE HALF OF EACH DOWEL"], M(sc0 + sgn * w * 0.3, avail - 0.07), "dot", keep, must=True)
        CO.place_callout(v, ["E.J. AT THE PROPERTY BOUNDARY (SD-107 NOTE 7)", "R16 DOWELS 300 LONG AT 300 CENTRES, BOND BREAK TO ONE HALF OF EACH DOWEL"], M(sc0 - sgn * w * 0.3, 0.0), "dot", keep, must=True)
    CO.place_callout(v, ["PROPOSED LAYOVER (VEHICLE CROSSING)", CX.standard_text(std)], M(sc0 + sgn * w * 0.25, xg.body_len_m * 0.6), "dot", keep, must=True)
    if cit is None:
        # right column: statement, schedule, typical cross section (the same panel and table look as the other sheets) -------------------------------
        RX0, RX1 = 574.0, 828.0
        y = 580.0
        stmt_h = PN.panel_height([CX.LAYOVER_STANDARD_NOTE], RX1 - RX0)
        PN.draw_panel(v, (RX0, y - stmt_h, RX1, y), "COUNCIL STANDARD NOT SELECTED", [CX.LAYOVER_STANDARD_NOTE], warn=True, layer="C-DATA-NONE")
        y -= stmt_h + 5
        vals = CX.layover_values(xg, front)
        rows_ = [(r["label"], CX._fmt_m(r["m"]), CX.PLACEHOLDER_TAG if r["placeholder"] else r["src"]) for r in vals]
        if front is not None:
            rows_.append(("FRONTAGE BEARING", f"{front.bearing_dms}  {CX.frontage_length_m(front):.2f}m", CX.FRONTAGE_SOURCE))
        cols_ = (0.38, 0.22, 0.40)
        th = PN.table_height(rows_, RX1 - RX0, cols_)
        PN.draw_table(v, (RX0, y - th, RX1, y), "LAYOVER DIMENSION SCHEDULE", rows_, cols_, red_when=lambda r_: r_[2] == CX.PLACEHOLDER_TAG)
        y -= th + 6
        tv = SEC.TypicalValues(s.cites)
        ybot = max(nrect[3] + 4.0, CONTENT_Y0)
        hk = max(120.0, min(200.0, (y - ybot - 4.0) * 0.55))
        r1 = (RX0, y - hk, RX1, y)
        r2 = (RX0, ybot, RX1, y - hk - 4.0)
        foot1, foot2 = [], []
        SEC.box(v, P, r1)
        SEC.detail_kerb_layover(v, P, tv, r1, foot1, CX._fmt_m(gw) + " " + CX.PLACEHOLDER_TAG, fall=verge_fall(s))
        _footer(P, r1, [SEC.TBC_STATEMENT] + foot1)
        SEC.box(v, P, r2)
        SEC.detail_driveway_pavement(v, P, tv, r2, foot2)
        _footer(P, r2, foot2)

    else:
        RX0, RX1 = 574.0, 828.0
        y = 580.0
        stmt = [f"THE CROSSING IS DRAWN TO {cit.label} (PLAN, SECTION AND NOTES ON C600). THE SA3 WIDTH IS A PLATFORM DEFAULT HELD WITHIN THE CITED RANGE.",
                TD.RD003_TEXT + ". " + TD.LAYBACK_DWG_TEXT + "."]
        stmt_h = PN.panel_height(stmt, RX1 - RX0)
        PN.draw_panel(v, (RX0, y - stmt_h, RX1, y), "COUNCIL STANDARD: " + cit.label, stmt, warn=True, layer="C-DATA-NONE")
        y -= stmt_h + 5
        vals = CX.layover_values(xg, front)
        rows_ = [(r["label"], CX._fmt_m(r["m"]), r["src"]) for r in vals]
        if front is not None:
            rows_.append(("FRONTAGE BEARING", f"{front.bearing_dms}  {CX.frontage_length_m(front):.2f}m", CX.FRONTAGE_SOURCE))
        cols_ = (0.38, 0.16, 0.46)
        th = PN.table_height(rows_, RX1 - RX0, cols_)
        PN.draw_table(v, (RX0, y - th, RX1, y), "LAYOVER DIMENSION SCHEDULE", rows_, cols_)
        y -= th + 6
        ybot = max(nrect[3] + 4.0, CONTENT_Y0)
        cf = [TD.CONFLICT_NOTE.capitalize().upper() + ".", "SD-107 NOTES 1 TO 15 ARE PRINTED IN FULL ON C600."]
        cf_h = PN.panel_height(cf, RX1 - RX0)
        hk = max(120.0, min(215.0, (y - ybot - 8.0 - cf_h) * 0.62))
        r1 = (RX0, y - hk, RX1, y)
        r2 = (RX0, ybot + cf_h + 4.0, RX1, y - hk - 4.0)
        PN.draw_panel(v, (RX0, ybot, RX1, ybot + cf_h), "COUNCIL DOCUMENT CONFLICT: NUMBER OF CROSSINGS", cf, warn=True, layer="C-DATA-NONE")
        SEC.box(v, P, r1)
        TD.sd107_section(P, T, r1)
        TD.footer(P, r1, ["SOURCE: " + T.get(TD.SD + "slab.thickness_min").ref] if T.get(TD.SD + "slab.thickness_min") else [])
        SEC.box(v, P, r2)
        TD.pavement_detail(P, T, r2)
    sh.notes = _dedupe(notes)
    sh.tag_notes = _tag_notes(v, None)
    return sh


# ====================================================================================================== C500 ESC
def _up(t: str) -> str:
    """UPPERCASE drawing text, SI symbols kept (3.0m, 15 m2), no spaced hyphen dashes and no slash joins."""
    t = ST.clean(t).replace(" - ", ": ").replace(" / ", " OR ")
    return re.sub(r"(\d)(\s?)M(2?)(?![A-Z0-9])", r"\1\2m\3", t.upper())


ESC_ORDER = {"access": 0, "fence": 1, "diversion": 2, "limit": 3, "inlet": 4, "washout": 5, "stockpile": 6, "topsoil": 6, "laydown": 6, "bin": 7, "toilet": 7}


def esc_flow_conflict(s: Site, out) -> dict | None:
    """Compare the SA10 flow direction with the fall read from the DEM.  None when they agree or no levels exist; otherwise the evidence."""
    dem = dem_fall(s)
    if out is None or dem is None:
        return None
    fl = out.flow
    diff = abs((fl.bearing_deg - dem["bearing"] + 180.0) % 360.0 - 180.0)
    if fl.assumed or diff > 30.0:
        return {"sa10": fl.bearing_deg, "dem": dem["bearing"], "diff": diff, "assumed": bool(fl.assumed)}
    return None


def access_min_lines(s: Site) -> list[str]:
    """Both cited minimum lengths of the stabilised access: the Blue Book (15 m) and the Building Sites guideline 2024 (3 m).  Each with its own citation; nothing when neither is cited."""
    out = []
    for k, who in (("esc.access.min_length_m", "BLUE BOOK"), ("esc.access.min_length_building_sites_m", "BUILDING SITES GUIDELINE 2024")):
        c = s.cites.get(k)
        if c is not None and isinstance(c.value, (int, float)):
            out.append(f"STABILISED ACCESS MINIMUM LENGTH {PH.num(c)} ({who}) {PH.short_ref(c)}")
    return out


def access_bs_clause(s: Site, drawn: float) -> str:
    c = s.cites.get("esc.access.min_length_building_sites_m")
    if c is None or not isinstance(c.value, (int, float)):
        return ""
    return f" AND {'MEETS' if drawn + 0.05 >= float(c.value) else 'IS SHORTER THAN'} THE {PH.num(c)} OF THE BUILDING SITES GUIDELINE 2024 {PH.short_ref(c)}"


def esc_access_shortfall(s: Site, out) -> tuple[float, float, object] | None:
    """(drawn length, cited length, cite) when the stabilised access is drawn shorter than the cited minimum length; otherwise None."""
    c = s.cites.get("esc.access.min_length_m")
    if out is None or c is None or not isinstance(c.value, (int, float)):
        return None
    alen = float(out.quantities.get("access_length_m") or 0.0)
    return (alen, float(c.value), c) if alen + 0.05 < float(c.value) else None


def _esc_lines(el, out, conflict, pit_missing: bool) -> list[str]:
    """Call-out text for one SA10 element: UPPERCASE, no spaced dashes, DOWNSLOPE dropped where the DEM fall disagrees, no inlet pit claimed without pit data."""
    q = out.quantities
    txt = _up(el.label)
    if el.kind == "access":
        return ["STABILISED SITE ACCESS", f"LENGTH {float(q.get('access_length_m') or 0):.1f}m, WIDTH {float(q.get('access_width_m') or 0):.1f}m (INDICATIVE)"]
    if el.kind == "inlet":
        return ["GUTTER SEDIMENT TRAP (INDICATIVE)", "NO STREET PIT LOCATION IN DATA"] if pit_missing else ["KERB INLET SEDIMENT TRAP"]
    if conflict:
        txt = re.sub(r"\bDOWNSLOPE\b ?", "", txt).replace("LIMIT OF WORKS", "LIMIT OF WORKS (FALL UNCONFIRMED)") if el.kind == "fence" else re.sub(r"\bDOWNSLOPE\b ?", "", txt)
    if "(" in txt:
        a_, b_ = txt.split("(", 1)
        lines = [a_.strip().rstrip(":"), "(" + b_.strip()]
    else:
        lines = fonts.wrap(txt, TXT.BODY, 52.0)
    if el.kind in ("fence", "diversion") and el.quantity:
        lines.append(f"LENGTH {el.quantity:.0f}m")
    return [x for x in lines if x]


def _esc_target(g) -> tuple[float, float]:
    """Point on the element a call-out leader ends at: representative point of a fill, midpoint of the longest line of a line element."""
    if g.geom_type in ("Polygon", "MultiPolygon"):
        rp = g.representative_point()
        return rp.x, rp.y
    parts = [x for x in getattr(g, "geoms", [g])]
    ln = max(parts, key=lambda x: x.length)
    if ln.geom_type == "LinearRing":
        ln = LineString(ln.coords)
    m = ln.interpolate(0.5, normalized=True)
    return m.x, m.y


NOT_DRAWN_TITLE = "NOT DRAWN: POSITION TO BE CONFIRMED ONCE THE BUILDING FOOTPRINT IS KNOWN"
NOT_DRAWN_TITLE_FP = "NOT DRAWN: NO POSITION OUTSIDE THE DWELLING WITH THE CITED CLEARANCES IN THIS LAYOUT"


def esc_not_drawn_schedule(s, out) -> list[str]:
    """Boxed schedule lines for the activity areas SA10 could not place outside the building envelope: size (layout assumption), the cited clearances and the cited
    sediment control requirement, each from the cited requirement set.  Never a position.  Empty when every item was placed."""
    c = s.cites
    rows: list[str] = []
    hz_min, hz_pref = c.get("esc.stockpile.min_distance_from_hazard_m"), c.get("esc.stockpile.preferred_distance_from_hazard_m")
    for it in (getattr(out, "not_placed", None) or []):
        L, W = it["size_m"]
        parts = [f"{it['label'].upper()} ({it['id']}): FOOTPRINT {L:g} x {W:g}m (LAYOUT ASSUMPTION, NOT A CITED VALUE)."]
        if it["kind"] in ("stockpile", "topsoil", "laydown"):
            if hz_min is not None and hz_pref is not None:
                parts.append(f"CLEARANCE FROM HAZARD AREAS AT LEAST {PH.num(hz_min)}, {PH.num(hz_pref)} PREFERRED {PH.short_ref(hz_min)}.")
            elif hz_min is not None:
                parts.append(f"CLEARANCE FROM HAZARD AREAS AT LEAST {PH.num(hz_min)} {PH.short_ref(hz_min)}.")
            else:
                parts.append("CITED CLEARANCE FROM HAZARD AREAS NOT AVAILABLE: NOT CHECKED, NOT CLEAR.")
        if it["kind"] in ("stockpile", "topsoil"):
            fc = c.get("esc.stockpile.upslope_diversion_and_downslope_filter")
            if fc is not None:
                parts.append(f"SEDIMENT CONTROL IMMEDIATELY DOWNSLOPE {PH.short_ref(fc)}.")
            dn = c.get("esc.stockpile.avoid_downslope_of_construction")
            if dn is not None:
                parts.append(f"NOT DOWNSLOPE OF THE CONSTRUCTION {PH.short_ref(dn)}.")
        elif it["kind"] == "laydown":
            fp = c.get("esc.stockpile.not_on_footpath_or_road_reserve")
            if fp is not None:
                parts.append(f"NOT ON THE FOOTPATH OR WITHIN THE ROAD RESERVE {PH.short_ref(fp)}.")
        if it.get("whole_lot_feasible"):
            parts.append("A POSITION MEETING THE CLEARANCES EXISTS ONLY WHERE THE BUILDING MAY BE BUILT (WHOLE LOT CHECKED).")
        else:
            parts.append("NO POSITION MEETING THE CLEARANCES WAS FOUND ON THE LOT.")
        rows.append(" ".join(parts))
    sp = c.get("esc.sediment_fence.post_spacing_m")
    if rows and sp is not None:
        rows.append(f"SEDIMENT FENCE ALONG THE DOWNSLOPE SIDE OF EACH, STAR PICKETS USUALLY {PH.num(sp)} APART {PH.short_ref(sp)}. TYPICAL DETAIL: C600.")
    return rows


def c500(ctx: RefCtx) -> Sheet:
    s = ctx.site
    out = s.esc
    rows = [] if out is not None else ["ESCP DATA PENDING: the SA10 erosion and sediment control layout was not available in this run; controls will be drawn when SA10 output is supplied"]
    notes = ["ESCP TO BE REVIEWED AND CERTIFIED BY A SUITABLY QUALIFIED PERSON", (PH.sentence(s.cites, "esc.escp.prepared_by_suitably_qualified_person") or "")]
    b = start(ctx, "C500", rows, notes + ctr_notes(s))
    v = b.v
    draw_ctrs(b, labels=False)                       # lines now; the labels go on last, clear of the ESC symbols and of their call-out boxes (stage 8c)
    draw_xover(b, "proposed")
    if s.placement is not None:
        BD.draw_light(b, door=False)
    pend = []
    conflict = esc_flow_conflict(s, out) if out is not None else None
    if out is not None:
        from shapely import wkt as swkt
        for el in out.elements:
            g = swkt.loads(el.geometry_wkt)
            v.geom(g, el.layer, lw=0.4, color=ST.BLACK)
            if g.geom_type in ("Polygon", "MultiPolygon"):
                v.fill(g, el.layer, (0.4, 0.7, 0.4), 0.35)
            pend.append((el, g))
    panels: list[tuple] = []
    if out is not None:
        dem = dem_fall(s)
        flags, basis = [], []
        if conflict:
            flags.append(f"SA10 FLOW BEARING {conflict['sa10']:.0f} DEG ({'ASSUMED TOWARDS THE ROAD, NO LEVELS PASSED TO SA10' if conflict['assumed'] else 'FROM ITS OWN INPUT'}) DOES NOT MATCH THE DEM FALL "
                         f"BEARING {conflict['dem']:.0f} DEG (DIFFERENCE {conflict['diff']:.0f} DEG). FENCES AND DIVERSION MAY NOT SIT ON THE LOW SIDE: RE-RUN OR CHECK BEFORE USE. DOWNSLOPE LABELS REMOVED.")
        sh_ = esc_access_shortfall(s, out)
        if sh_:
            flags.append(f"STABILISED ACCESS DRAWN {sh_[0]:.1f}m LONG, SHORTER THAN THE CITED {PH.num(sh_[2])} (BLUE BOOK) {PH.short_ref(sh_[2])}{access_bs_clause(s, sh_[0])}: THE LOT DOES NOT ALLOW THE CITED LENGTH IN THIS LAYOUT. TO BE RESOLVED BY THE ESCP PREPARER.")
        sched = esc_not_drawn_schedule(s, out)
        for w in out.warnings:
            if "not drawn" in w.lower() and sched and any(w.lower().startswith(it["label"].lower() + ":") for it in out.not_placed):
                continue                                                            # listed with its size, clearances and fence in the NOT DRAWN schedule
            (flags if "not drawn" in w.lower() else basis).append(_up(w))
        if dem:
            basis.insert(0, f"LOT FALL {dem['pct']:.1f} PERCENT TOWARDS BEARING {dem['bearing']:.0f} DEG (INDICATIVE, 5 m DEM, PLANE FIT TO {dem.get('n', 0)} LEVELS)")
        elif out.flow.assumed:
            basis.insert(0, f"FALL DIRECTION ASSUMED TOWARDS THE ROAD (BEARING {out.flow.bearing_deg:.0f} DEG): NO LEVELS AVAILABLE TO THE ESCP LAYOUT")
        basis += access_min_lines(s)
        basis.append(f"ELEMENTS FROM SA10: {len(out.elements)} (INDICATIVE LAYOUT, TO BE CONFIRMED BY THE ESCP PREPARER)")
        basis += [_up(x) for x in list(out.assumptions[:2])]
        if flags:
            panels.append(("ESC FLAGS", flags, True))
        if sched:
            panels.append((NOT_DRAWN_TITLE_FP if s.placement is not None else NOT_DRAWN_TITLE, sched, True))
        panels.append(("ESC LAYOUT BASIS AND ASSUMPTIONS", basis, False))
    PW = 132.0
    col = PN.column(b, [PN.panel_height(p_[1], PW, title=p_[0]) for p_ in panels], PW, sides=("right", "left")) if panels else None      # one tidy column, reserved before any label is placed
    finish(b, "EROSION AND SEDIMENT CONTROL", reserve=col or ())
    if col:
        for p_, r_ in zip(panels, col):
            PN.draw_panel(v, r_, p_[0], p_[1], warn=p_[2])
    else:
        for p_ in panels:
            text_panel(b, p_[0], p_[1], 150.0, warn=p_[2])
    CX.callouts_crossover(v, b.xg, b.std, b.keep, [], [s.lot], kerb_only=True, short_kerb=True, must_avoid=list(getattr(b, 'kerb_geoms', [])))
    pave_callout(b)
    if out is not None:                                                          # one boxed call-out with a leader per element, boxes off the control geometry
        ctl = [g.buffer(0.6 / v.k * 2) if g.geom_type != "Point" else g for _e, g in pend]
        for el, g in sorted(pend, key=lambda eg: ESC_ORDER.get(eg[0].kind, 9)):
            pm = any("not supplied" in n.lower() and "pit" in n.lower() for n in el.notes)
            place(b, _esc_lines(el, out, conflict, pm), _esc_target(g), "dot", must=True, avoid=list(b.hard) + ctl, short_first=46.0)
    draw_ctrs(b, lines=False, extra_avoid=[g.buffer(1.2) for _e, g in pend])
    return seal(b)


# ====================================================================================================== C600 typical details
CONTENT_X0, CONTENT_X1 = VIEW_RECT[0] + 4.0, VIEW_RECT[2] - 4.0
CONTENT_Y0, CONTENT_Y1 = STRIP_RECT[3] + 4.0, VIEW_RECT[3] - 4.0         # drawing content area: above the title strip, inside the frame


def _footer(P, r: tuple, lines, h: float = TXT.BODY) -> None:
    """Cited values and TBC statements at the bottom of a detail box (stacked upward from the box bottom, wrapped, never past the box)."""
    y = r[1] + 3.0
    for ln in reversed([x for x in lines if x]):
        wr = fonts.wrap(ST.clean(ln).upper(), h, r[2] - r[0] - 8.0)
        for w in reversed(wr):
            P.text(r[0] + 4.0, y, w, h, "BOTTOM_LEFT", layer="C-ANNO-NOTE", color=RED if ("TBC" in w or "UNRESOLVED" in w) else None)
            y += h + 1.0
        y += 0.8


def c600(ctx: RefCtx) -> Sheet:
    """Typical details sheet: the council standard drawing SD-107 (plan, section, notes) and the council typicals for pavement, kerb and gutter, lot
    drainage, OSD, verge services and ESC.  Every value is read from the typicals data (typical_details.py) and printed with its citation."""
    s, c = ctx.site, ctx.site.cites
    T = c.typ
    if not T.present:
        return c600_generic(ctx)
    sh = Sheet("C600", codes.SHEET_TITLES["C600"], "", paper=A1, north=None, scale_text="NTS")
    v = sh.add(View("details", PLAN_RECT))
    P = ST.Paper(v)
    gx, gy = 5.0, 5.0
    total_h = CONTENT_Y1 - CONTENT_Y0 - 2 * gy
    cells = TD.c600_cells(CONTENT_X0, CONTENT_X1, CONTENT_Y0, CONTENT_Y1, gx, gy)
    for name, r in cells.items():
        SEC.box(v, P, r)
    TD.c600_fill(v, P, s, T, tv_for(s), cells)
    title_strip(sh, "TYPICAL DETAILS", "NOT TO SCALE (NTS)", None)
    sh.notes = ["TYPICAL DETAILS ONLY. COUNCIL STANDARD DRAWINGS GOVERN."]
    return sh


def c600_generic(ctx: RefCtx) -> Sheet:
    """Typical details for a council with NO typicals data: the schematic details with TBC for every value that is not cited (stage 8 layout, unchanged)."""
    s, c = ctx.site, ctx.site.cites
    tv = SEC.TypicalValues(c)
    sh = Sheet("C600", codes.SHEET_TITLES["C600"], "", paper=A1, north=None, scale_text="NTS")
    v = sh.add(View("details", PLAN_RECT))
    P = ST.Paper(v)
    nrect, _ = notes_layout(ctx.proj, ["ALL DETAILS ARE TYPICAL AND SCHEMATIC. COUNCIL STANDARD DRAWINGS GOVERN"], (), reserve=2)
    gx, gy = 5.0, 5.0
    total_h = CONTENT_Y1 - CONTENT_Y0 - 2 * gy
    ha = 0.33 * total_h                                                      # top row: four small details
    hb = (total_h - ha) / 2.0
    wa = (CONTENT_X1 - CONTENT_X0 - 3 * gx) / 4
    wb = (CONTENT_X1 - CONTENT_X0 - gx) / 2

    def cell(i):
        if i < 4:                                                            # top row
            x = CONTENT_X0 + i * (wa + gx)
            return (x, CONTENT_Y1 - ha, x + wa, CONTENT_Y1)
        j = i - 4                                                            # two wide cells per row below
        x = CONTENT_X0 + (j % 2) * (wb + gx)
        yt = CONTENT_Y1 - ha - gy - (j // 2) * (hb + gy)
        return (x, yt - hb, x + wb, yt)
    cl = c.line
    specs = [
        ("1", SEC.detail_sediment_fence, [cl("esc.sediment_fence.post_spacing_m", "Post spacing"), cl("esc.sediment_fence.trench_depth_mm", "Trench depth (upslope)"),
                                           cl("esc.sediment_fence.return_interval_m", "Returns"), cl("esc.sediment_fence.joint_overlap_mm", "Joint overlap")]),
        ("2", SEC.detail_access, [cl("esc.access.min_length_m", "Min length (Blue Book)"), cl("esc.access.min_length_building_sites_m", "Min length (Building Sites 2024)"), cl("esc.access.min_width_m", "Min width"), cl("esc.access.thickness_mm", "Thickness"),
                                   cl("esc.access.max_aggregate_mm", "Max aggregate"), cl("esc.access.geotextile_underlay", "Underlay")]),
        ("3", SEC.detail_trench, [cl("water.min_cover_m", "Water cover"), cl("sewer.house_connection_min_cover_m", "Sewer house connection cover"), cl("esc.trench.max_open_days", "Trench open (days)")]),
        ("4", SEC.detail_batter_cut, []),
        ("5", SEC.detail_batter_fill, []),
        ("6", SEC.detail_driveway_pavement, []),
        ("7", SEC.detail_kerb_layover, []),
    ]
    for i, (num, fn, cited_lines) in enumerate(specs):
        r = cell(i if i < 3 else i + 1)
        SEC.box(v, P, r)
        foot: list = []
        P.text(r[0] + 1.2, r[3] - 1.2, num, TXT.BODY, "TOP_LEFT", bold=True, layer="C-ANNO-NOTE", color=RED)
        try:
            fn(v, P, tv, r, foot=foot)
        except TypeError:
            fn(v, P, tv, r)
        _footer(P, r, [x for x in cited_lines if x] + foot)
    r = cell(3)
    SEC.box(v, P, r)
    SEC.detail_notes(v, P, tv, r, [
        "ALL DETAILS ARE TYPICAL AND SCHEMATIC, NOT TO SCALE.",
        "ONLY VALUES SHOWN WITH A [CITATION] COME FROM THE CITED DOCUMENTS. EVERY OTHER VALUE IS " + SEC.TBC_STATEMENT + ".",
        "BATTER SLOPES (1:N), PAVEMENT LAYER THICKNESSES, KERB AND GUTTER PROFILE AND CROSSFALLS ARE NOT INVENTED.",
        "DRIVEWAY LAYOVER PLAN AND DIMENSIONS: SEE C420.",
        "HATCHES: \"/\" EXISTING, \"\\\" PROPOSED, STIPPLE CONCRETE, GREY BITUMEN."])
    title_strip(sh, "TYPICAL DETAILS", "NOT TO SCALE (NTS)", None)
    sh.notes = ["TYPICAL DETAILS ONLY. COUNCIL STANDARD DRAWINGS GOVERN."]
    return sh


def tv_for(s: Site):
    return SEC.TypicalValues(s.cites)


DCDB_ROW = "DCDB BEYOND THE LOTS SHOWN IS NOT AVAILABLE OR NOT CHECKED (SEE THE NOTE UNDER THE TITLE OF EACH PLAN SHEET), SO THE CADASTRE MAY NOT REACH THE VIEWPORT EDGES. NOT CHECKED, NOT CLEAR"


def register_rows(others: list[Sheet]) -> list[str]:
    """DATA AND ASSUMPTIONS REGISTER: each distinct data gap ONCE with the sheets it applies to (sheets with no gap are not listed), and the DCDB
    statement once, not repeated on every plan sheet."""
    gaps: dict[str, list[str]] = {}
    dcdb = False
    for x in others:
        if x.number == "C001":
            continue
        for d in x.data_missing:
            t = ST.clean(d).upper().replace(NO_DWELLING.upper(), "BUILDING DESIGN (NOT PART OF THIS SET)").strip()
            if t.startswith("DCDB"):
                dcdb = True
            elif t:
                gaps.setdefault(t, []).append(x.number)
    rows = [f"{', '.join(dict.fromkeys(ns))}: {t}" for t, ns in gaps.items()]
    return ([DCDB_ROW] if dcdb else []) + rows


def _is_red(lines: list[str]) -> bool:
    j = " ".join(lines)
    return j.startswith("COUNCIL REQUIREMENT") or "UNRESOLVED, CONFIRM" in j


def c001(ctx: RefCtx, others: list[Sheet]) -> Sheet:
    """General notes for the LGA: grouped notes under dark heading bars, numbered, flowed over three columns on A1
    at the largest body size that fits (one size for all notes), then the legend.  Council named and cited from data; nothing defaulted."""
    s = ctx.site
    sh = Sheet("C001", codes.SHEET_TITLES["C001"], "", paper=A1, north=None, scale_text="NTS")
    v = sh.add(View("notes", PLAN_RECT))
    P = ST.Paper(v)
    nrect, _ = notes_layout(ctx.proj, ["SEE THE DATA AND ASSUMPTIONS REGISTER"], (), reserve=2)
    council, groups = LN.build_notes(s, ctx.proj.council or None)
    reg = register_rows(others)
    if reg:
        groups = groups + [("DATA AND ASSUMPTIONS REGISTER (BY SHEET)", reg)]
    title = f"GENERAL NOTES FOR {council}"
    P.text(CONTENT_X0, CONTENT_Y1 - 1.0, title, 4.6, "TOP_LEFT", bold=True, layer="C-ANNO-NOTE")
    P.line([(CONTENT_X0, CONTENT_Y1 - 7.6), (CONTENT_X0 + fonts.text_width(title, 4.6, True), CONTENT_Y1 - 7.6)], "C-ANNO-NOTE", 0.7, (0.80, 0.08, 0.08))
    ytop = CONTENT_Y1 - 12.0
    from app.agents.sa5_cad_dxf.planset import legend as LG
    lg_cols, lg_pitch = 3, 11.0
    lg_swept = False
    try:
        _f, _d, _std, _xg = make_xg(s, 0.0)
        lg_swept = bool(_xg.present and s.drive_cl is not None and swept_ok(s, _xg))
    except Exception:                                                  # the legend must never stop the sheet: a swept path entry is only added when it is certain
        lg_swept = False
    lg_entries = LG.entries_for(s, lg_swept)
    lg_h = LG.legend_height(lg_cols, lg_pitch, len(lg_entries))
    ybot_notes = CONTENT_Y0 + lg_h + 8.0
    gap, cw = 8.0, (CONTENT_X1 - CONTENT_X0 - 16.0) / 3
    cols = [CONTENT_X0 + i * (cw + gap) for i in range(3)]
    H_HEAD = 4.4
    body_sizes = (3.8, 3.6, 3.4, 3.2, 3.0)

    def flow(hb: float):
        """Place every item at body size ``hb``; returns (placements, fits).  Headings never end a column; notes never split."""
        pitch, hp = hb * 1.4, 9.0
        items = []
        n = 0
        for head, notes in groups:
            items.append(("H", head, None))
            for t in notes:
                n += 1
                items.append(("N", fonts.wrap(ST.clean(t).upper(), hb, cw - 9.0), f"{n}."))
        tot = sum((hp if k_ == "H" else len(p_) * pitch + 2.0) for k_, p_, _n in items)
        limit = tot / 3.0 + 24.0
        out, ci, y, i, ok = [], 0, ytop, 0, True
        while i < len(items):
            kind, payload, num = items[i]
            need = hp if kind == "H" else len(payload) * pitch + 2.0
            if kind == "H":
                nxt = items[i + 1] if i + 1 < len(items) else None
                need += (len(nxt[1]) * pitch + 2.0) if nxt and nxt[0] == "N" else 0.0
            if (y - need < ybot_notes or (ytop - y) + need > limit) and ci < 2:
                ci += 1
                y = ytop
            if y - need < ybot_notes and ci >= 2:
                ok = False
            out.append((ci, y, kind, payload, num))
            y -= (hp if kind == "H" else len(payload) * pitch + 2.0)
            i += 1
        return out, ok, pitch

    chosen = None
    for hb in body_sizes:
        pl, ok, pitch = flow(hb)
        chosen = (hb, pl, ok, pitch)
        if ok:
            break
    hb, pl, ok, pitch = chosen
    for ci, y, kind, payload, num in pl:
        if kind == "H":
            P.poly([(cols[ci], y - H_HEAD - 1.6), (cols[ci] + cw, y - H_HEAD - 1.6), (cols[ci] + cw, y + 1.0), (cols[ci], y + 1.0)], "C-ANNO-NOTE", (0.16, 0.16, 0.16))
            P.text(cols[ci] + 2.0, y, payload, H_HEAD, "TOP_LEFT", bold=True, color=ST.WHITE, layer="C-ANNO-NOTE")
        else:
            P.text(cols[ci] + 1.0, y, num, hb, "TOP_LEFT", bold=True, layer="C-ANNO-NOTE")
            red = _is_red(payload)
            for k, w in enumerate(payload):
                P.text(cols[ci] + 9.0, y - k * pitch, w, hb, "TOP_LEFT", layer="C-ANNO-NOTE", color=RED if red else None)
    if not ok:
        sh.data_missing.append("general notes overflow the sheet")
    LG.draw_legend(v, CONTENT_X0, CONTENT_Y0 + lg_h, CONTENT_X1 - CONTENT_X0, lg_cols, lg_pitch, entries=lg_entries)
    title_strip(sh, "GENERAL NOTES", "NOT TO SCALE (NTS)", None)
    sh.notes = ["GENERAL NOTES AND REGISTER OF MISSING DATA FOR THIS PLAN SET"]
    return sh


c700 = c001          # the notes sheet was C700 before it became sheet 2


# ====================================================================================================== C000 cover
def _spaced(t: str) -> str:
    return "   ".join(" ".join(w) for w in t.split())


def c000(ctx: RefCtx, sheets: list[Sheet], font_note: str) -> Sheet:
    """Cover in the owner's reference layout: wordmark, letter-spaced caption, large project name with accent underline, address, PREPARED FOR (client
    only), STATUS box with a coloured left bar, framed SITE PLAN (NTS) lower left and the DRAWING REGISTER (all sheets) on the right."""
    s, pj = ctx.site, ctx.proj
    pb = codes.PLATFORM_BRAND
    sh = Sheet("C000", codes.SHEET_TITLES["C000"], "", paper=A1, north=0.0, scale_text="NTS")
    v = sh.add(View("cover", VIEW_RECT))
    P = ST.Paper(v)
    cx = 426.0
    v.text(cx, 578.0, pb.name, 22.0, "TOP_CENTER", bold=True, layer="C-ANNO-TTLB")
    v.text(cx, 551.0, pb.tagline, 4.0, "TOP_CENTER", layer="C-ANNO-TTLB", color=ST.LABEL_GREY)
    cap = _spaced("CIVIL SITE PLANNING DRAWINGS")
    v.text(cx, 536.0, cap, _fit(cap, 640.0, 4.2), "TOP_CENTER", layer="C-ANNO-TTLB")
    title = ST.clean(pj.title).upper()
    th = _fit(title, 740.0, 17.0, True, 6.0)
    v.text(cx, 521.0, title, th, "TOP_CENTER", bold=True, layer="C-ANNO-TTLB")
    yu = 521.0 - th - 5.0
    v.line([(cx - 38.0, yu), (cx + 38.0, yu)], "C-ANNO-TTLB", False, 1.4, color=AMBER)
    lot_txt = " ".join(subject_lot_lines(s.inp.lot.lotplan)).upper()
    raw = ST.clean(pj.address).upper()
    street = bool(raw) and raw != ST.clean(pj.council).upper() and raw != ST.clean(s.inp.lot.lga_name or "").upper() and lot_txt not in raw
    addr = raw if street and any(ch.isdigit() for ch in raw) else ", ".join(x for x in (lot_txt, ST.clean(pj.council).upper() or ST.clean(s.inp.lot.lga_name or "").upper()) if x)
    v.text(cx, yu - 7.0, addr, _fit(addr, 700.0, 6.5), "TOP_CENTER", layer="C-ANNO-TTLB")
    yy = yu - 7.0 - 6.5 - 5.0
    t = "PREPARED FOR: " + (ST.clean(pj.client).upper() if pj.client else "DATA NOT AVAILABLE")
    v.text(cx, yy, t, 4.4, "TOP_CENTER", layer="C-ANNO-TTLB")
    yy -= 11.0
    bx0, bx1, by1 = cx - 130.0, cx + 130.0, yy - 4.0
    by0 = by1 - 14.0
    P.line([(bx0, by0), (bx1, by0), (bx1, by1), (bx0, by1)], "C-ANNO-TTLB", 0.35, ST.BLACK, closed=True)
    v.fill(Polygon([(bx0, by0), (bx0 + 3.0, by0), (bx0 + 3.0, by1), (bx0, by1)]), "C-ANNO-TTLB", AMBER, 1.0, anno=True)
    v.line([(bx0 + 40.0, by0), (bx0 + 40.0, by1)], "C-ANNO-TTLB", False, 0.25)
    v.text(bx0 + 21.5, (by0 + by1) / 2, "STATUS", 3.4, "MIDDLE_CENTER", color=ST.LABEL_GREY, layer="C-ANNO-TTLB")
    v.text(bx0 + 46.0, (by0 + by1) / 2, "PRELIMINARY: NOT FOR CONSTRUCTION", 5.0, "MIDDLE_LEFT", bold=True, layer="C-ANNO-TTLB")
    top = by0 - 12.0
    # ---- framed SITE PLAN (subject lot plus neighbours, north point, NTS) -------------------------------------------------------------------------
    r = (30.0, 100.0, 420.0, top)
    v.line([(r[0], r[1]), (r[2], r[1]), (r[2], r[3]), (r[0], r[3])], "C-ANNO-TTLB", True, 0.35)
    v.text(r[0] + 4.0, r[3] - 3.0, "SITE PLAN", 4.0, "TOP_LEFT", bold=True, layer="C-ANNO-TTLB")
    # DCDB statement for this panel: the cadastre may not reach the panel edges.  It is fixed first so its band is reserved at the bottom of the frame.
    dc_lines: list[str] = []
    probe = View("t", (r[0] + 3.0, r[1] + 3.0, r[2] - 3.0, r[3] - 12.0))
    wlines = lambda notes: [w for n in notes for w in fonts.wrap(ST.clean(n).upper(), TXT.BODY, r[2] - r[0] - 12.0)]   # noqa: E731
    vr = (r[0] + 3.0, r[1] + 3.0, r[2] - 3.0, r[3] - 12.0)
    tw = s.view_twist if s.view_twist is not None else 0.0                    # the same orientation as every plan sheet
    ext = unary_union([s.lot] + neighbour_polys(s)).bounds
    lb = s.lot.bounds
    side = max(lb[2] - lb[0], lb[3] - lb[1], 30.0)
    for _pass in (0, 1):
        vr = (r[0] + 3.0, r[1] + 3.0 + (3.6 * len(dc_lines) + 5.0 if dc_lines else 0.0), r[2] - 3.0, r[3] - 12.0)
        cen = ((lb[0] + lb[2]) / 2, (lb[1] + lb[3]) / 2)
        scl = STD_SCALES[-1]
        for sc in STD_SCALES:
            tv = View("t", vr, cen, sc, twist=tw)
            pts = [tv.tp(x, y) for x, y in s.lot.exterior.coords]
            mg = 0.28 * min(vr[2] - vr[0], vr[3] - vr[1])                       # the lot fills about half the panel, the rest shows the surrounding lots
            if all(vr[0] + mg <= px <= vr[2] - mg and vr[1] + mg <= py <= vr[3] - mg for px, py in pts):
                scl = sc
                break
        lv_probe = View("locality", vr, cen, scl, frame=False, twist=tw)
        cadwin.ensure(s, lv_probe)                                               # pad the cadastre to this panel exactly as the plan sheets do
        dc_lines = wlines(cadwin.cad_notes(s))
        if _pass == 1 or not dc_lines:
            break
    lv = sh.add(View("locality", vr, cen, scl, frame=False, twist=tw))
    for lab, p, road in cadwin.all_lots(s):
        lv.geom(p, "C-PROP-ADJN", lw=0.13, color=ST.FENCE)
    lv.fill(s.lot, "C-PROP-BDY", (1, 0.9, 0.5), 0.5)
    ST.boundary(lv, s.lot)
    if s.placement is not None and s.footprint is not None:
        lv.fill(s.footprint, "A-BLDG-PROP", (0.75, 0.75, 0.75), 1.0, edge=ST.BLACK, edge_lw=0.2)
    lv.reserve((vr[2] - 40.0, vr[3] - 40.0, vr[2], vr[3]))
    lv.reserve((vr[0], vr[1], vr[0] + 30.0, vr[1] + 12.0))
    lot_labels(lv, s)
    D.road_names(lv, s)
    ST.north_point(lv, vr[2] - 22.0, vr[3] - 24.0, 9.0, (-lv.twist) % 360.0)
    ST.Paper(lv).text(vr[0] + 3.0, vr[1] + 4.0, "NTS", 3.4, "BOTTOM_LEFT", bold=True, layer="C-ANNO-NOTE")
    if dc_lines:                                                                 # DCDB incomplete or not checked: said on the panel, never left to read as clear
        for k_, ln in enumerate(dc_lines):
            P.text(r[0] + 5.0, r[1] + 3.0 + 3.6 * (len(dc_lines) - 1 - k_) + 1.5, ln, TXT.BODY, "BOTTOM_LEFT", color=RED, layer="C-DATA-NONE")
        sh.data_missing.append(cadwin.cad_notes(s)[0].capitalize())
    # ---- DRAWING REGISTER (every sheet) --------------------------------------------------------------------------------------------------------
    rx0, rx1 = 450.0, 826.0
    c1, c2 = rx0 + 78.0, rx1 - 22.0
    rh = 9.0
    y = top
    v.text((rx0 + rx1) / 2, y - 4.0, "DRAWING REGISTER", 4.0, "MIDDLE_CENTER", bold=True, layer="C-ANNO-TABL")
    y -= 9.0
    v.fill(Polygon([(rx0, y - rh), (rx1, y - rh), (rx1, y), (rx0, y)]), "C-ANNO-TABL", (0.16, 0.16, 0.16), 1.0, anno=True)
    for x, t, a in ((rx0 + 3.0, "DRAWING No.", "MIDDLE_LEFT"), (c1 + 3.0, "DRAWING TITLE", "MIDDLE_LEFT"), ((c2 + rx1) / 2, "REV", "MIDDLE_CENTER")):
        v.text(x, y - rh / 2, t, TXT.LABEL, a, bold=True, color=ST.WHITE, layer="C-ANNO-TABL")
    y -= rh
    allsheets = [sh] + [x for x in sheets if x.number != "C000"]
    for i, x in enumerate(allsheets):
        if i % 2 == 0:
            v.fill(Polygon([(rx0, y - rh), (rx1, y - rh), (rx1, y), (rx0, y)]), "C-ANNO-TABL", (0.93, 0.93, 0.93), 1.0, anno=True)
        v.line([(rx0, y - rh), (rx1, y - rh)], "C-ANNO-TABL", False, 0.1, color=ST.GRID)
        v.text(rx0 + 3.0, y - rh / 2, codes.drawing_number(x.number, pj.job), TXT.LABEL, "MIDDLE_LEFT", layer="C-ANNO-TABL")
        v.text(c1 + 3.0, y - rh / 2, ST.clean(x.title).upper(), TXT.LABEL, "MIDDLE_LEFT", layer="C-ANNO-TABL")
        v.text((c2 + rx1) / 2, y - rh / 2, ST.clean(x.revision), TXT.LABEL, "MIDDLE_CENTER", layer="C-ANNO-TABL")
        y -= rh
    v.line([(rx0, y), (rx1, y), (rx1, top - 9.0), (rx0, top - 9.0)], "C-ANNO-TABL", False, 0.25)
    for x in (c1, c2):
        v.line([(x, y), (x, top - 9.0)], "C-ANNO-TABL", False, 0.15, color=ST.GRID)
    v.line([(rx0, y), (rx0, top - 9.0)], "C-ANNO-TABL", False, 0.25)
    # ---- DATA SOURCES AND STATUS: what this set is built from (each line follows the data actually supplied) --------------------------------------
    yb = y - 12.0
    _cc = CX.cited_crossing(getattr(getattr(s, "cites", None), "typ", None))
    _sd_label = f"{_cc.label}" if _cc is not None else ""
    src = [("CADASTRE", "STATE CADASTRE (DCDB). BOUNDARIES, LOT NUMBERS AND PLAN NUMBERS ARE NOT A SURVEY."),
           ("LEVELS", "5 m DEM, INDICATIVE ONLY. DETAIL SURVEY AT THE DETAILED DESIGN STAGE." if s.tin is not None else "NO LEVELS SUPPLIED: NOT DRAWN."),
           ("AERIAL", re.sub(r"^AERIAL IMAGERY:\s*", "", ST.clean(s.aerial_site.note).upper()) if s.aerial_site is not None else "NO AERIAL IMAGE SUPPLIED."),
           ("SERVICES", services_status_text(s)),
           ("ASSUMED ITEMS", ("KERB AND ROAD EXTENT ARE ASSUMED. THE CROSSING FOLLOWS " + _sd_label + " (C420, C600); ON-LOT DRIVEWAY PAVEMENT, KERB PROFILE RD003 AND LAYBACK DRAWINGS RD0010 AND RD011 ARE NOT PUBLISHED.")
            if _sd_label else "KERB, ROAD EXTENT AND LAYOVER VALUES ARE ASSUMED OR PLACEHOLDERS WHERE MARKED."),
           ("CODES", "DRAWING NUMBER JCS-{JOB}-CIV-{NNN}. LAYERS JCS-{DISCIPLINE}-{ELEMENT}-{TYPE}, THE SAME IN THE DXF."),
           ("BUILDING", building_status_text(s))]
    rows_ = []
    for k_, t_ in src:
        rows_.append((k_, fonts.wrap(t_, TXT.BODY, rx1 - rx0 - 46.0)))
    hbox = 12.0 + sum(len(w) * 3.9 + 2.2 for _k, w in rows_)
    if yb - hbox > 104.0:
        P.line([(rx0, yb - hbox), (rx1, yb - hbox), (rx1, yb), (rx0, yb)], "C-ANNO-TABL", 0.35, ST.BLACK, closed=True)
        v.text(rx0 + 4.0, yb - 3.0, "DATA SOURCES AND STATUS", 4.0, "TOP_LEFT", bold=True, layer="C-ANNO-TABL")
        yy_ = yb - 14.0
        for k_, w in rows_:
            v.text(rx0 + 4.0, yy_, k_, TXT.BODY, "TOP_LEFT", bold=True, layer="C-ANNO-TABL")
            for i_, ln in enumerate(w):
                v.text(rx0 + 42.0, yy_ - 3.9 * i_, ln, TXT.BODY, "TOP_LEFT", layer="C-ANNO-TABL")
            yy_ -= len(w) * 3.9 + 2.2
        vb_top = yb - hbox - 10.0                                        # the verification block, large, under the data sources (the cover only)
        if vb_top - 62.0 > 104.0:
            from app.agents.sa5_cad_dxf.planset.frame_a1 import verification_block
            P.line([(rx0, vb_top - 62.0), (rx1, vb_top - 62.0), (rx1, vb_top), (rx0, vb_top)], "JCS-FRAM-AICK-LINE", 0.5, ST.BLACK, closed=True)
            verification_block(v, rx0, vb_top - 62.0, rx1, vb_top, big=True)
    sh.notes = ["PRELIMINARY ISSUE: NOT FOR CONSTRUCTION"]
    return sh
