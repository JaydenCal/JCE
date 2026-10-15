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

from app.agents.sa5_cad_dxf.planset import callout as CO
from app.agents.sa5_cad_dxf.planset import cadwin
from app.agents.sa5_cad_dxf.planset import lga_notes as LN
from app.agents.sa5_cad_dxf.planset import phrases as PH
from app.agents.sa5_cad_dxf.planset import sections as SEC
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

RED = (0.72, 0.1, 0.1)
AMBER = (0.72, 0.45, 0.05)
DISCL = SO.DISCL
NO_DWELLING = "building design (the building is not part of this plan set and no building footprint or level is drawn)"
DEM_NOTE_REF = "INDICATIVE, DERIVED FROM 5 m DEM"
SWEPT_TBC = "SWEPT PATH: TO BE CONFIRMED AT DETAILED DESIGN"
DRIVE_END = "DRIVEWAY END (PLATFORM DEFAULT LEVEL, NOT DESIGNED)"
KERB_STATION = "KERB LINE (GROUND, ASSUMED)"
BAND_STATION = "BACK OF KERB AND GUTTER BAND (GROUND, ASSUMED)"
BDY_STATION = "PROPERTY BOUNDARY (GROUND)"
DRIVEWAY_SHEETS = ("C101", "C400", "C420")
LAYOVER_REF = ["LAYOVER DIMENSIONS (SEE C420)", "FULL SCHEDULE, SOURCES AND TYPICAL SECTIONS ON C420"]      # the layover is dimensioned in full on its own sheet


def _dedupe(xs) -> list[str]:
    return list(dict.fromkeys(ST.clean(x) for x in xs if x))


def make_xg(s: Site, reach: float = 0.0):
    front = _front_segment(s)
    fseg = (front.start_xy, front.end_xy) if front is not None else None
    drv = s.inp.driveway
    kuser = drv.kerb_to_boundary_user_supplied if drv is not None else None
    std = drv.council_standard_label if drv is not None else None
    xg = CX.build_crossover(fseg, s.lot, s.crossover, CX.default_kerb_offset_m(), True, reach, kuser)
    xg.drive_width_m = drv.width_m if drv is not None else 0.0
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
        ph = 12.0 + 3.4 * (len(fonts.wrap("NOT DRAWN, NO DATA SUPPLIED:", 2.4, 96.0)) + len(fonts.wrap(extra, 2.4, 96.0)))
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
    if front is None and ch.rot_note:                                    # no frontage in the lot data: the view is aligned to the long axis of the lot, not to a frontage
        import dataclasses as _dc
        ch = _dc.replace(ch, rot_note=ch.rot_note.replace("TO SQUARE THE LOT FRONTAGE TO THE SHEET", "TO ALIGN THE LONG AXIS OF THE LOT WITH THE SHEET (NO FRONTAGE IDENTIFIED)"))
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
        if lotb.intersects(r_) or (b.rows and sbox(*b.panel).intersects(r_)):
            continue
        ncx, ncy = cx_, cy_
        break
    ST.north_point(v, ncx, ncy, 15.0, (-v.twist) % 360.0)
    keep = [(ncx - 21.0, ncy - 21.0, ncx + 30.0, ncy + 24.0), (b.nrect[0] - 3, b.nrect[1] - 1, b.nrect[2] + 1, b.nrect[3] + 3)]
    b.strip = title_strip(sh, title, scale_pair(b.scale), b.scale, notes=list(b.choice.notes) + cadwin.cad_notes(s))
    if b.rows:
        extra = "  ".join(f"({i + 1}) {r}." for i, r in enumerate(b.rows))
        D.no_data(v, b.panel, "NOT DRAWN, NO DATA SUPPLIED:", extra)
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
    b.sh.tag_notes = list(v.fallback_notes)
    return b.sh


def place(b: Base, lines, pt, term="dot", must=True, avoid=()):
    return CO.place_callout(b.v, lines, pt, term, b.keep, avoid=list(avoid), soft_avoid=[b.s.lot], must=must, must_avoid=list(getattr(b, 'kerb_geoms', [])))


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


def text_panel(b: Base, title: str, lines, w: float = 100.0, warn: bool = False, h_text: float = 2.4):
    h = _wrap_h(lines, w, h_text)
    r = place_panel(b, w, h)
    if r is None:
        for ln in [title] + list(lines):
            CO.fallback_tag(b.v, [ln], (0, 0), hidden=True)
        return None
    D.panel(b.v, r[0], r[1], r[2], r[3], title, lines, h_text, warn=warn)
    return r


def byda_panel(b: Base) -> None:
    """BYDA status panel (C100, C310): job, owners responded, validity and the project-only notice.  Status only: no service is drawn from the BYDA data."""
    pan = getattr(b.s.inp, "byda", None)
    if pan is None:
        return
    text_panel(b, "BYDA STATUS: EXISTING SERVICES NOT CONFIRMED", [ST.clean(x) for x in pan.all_lines()], 150.0, warn=True)


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
    gw = CX.gutter_band_m(xg.kerb_offset_m or CX.default_kerb_offset_m())
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
    st = [(0.0, exz(0.0), KERB_STATION), (gw, exz(gw), BAND_STATION), (sb, exz(sb), BDY_STATION)]
    proposed = s.ffl is not None
    if proposed:
        st.append((L, float(s.ffl), DRIVE_END))
    out, last = [], -9.0
    for t, z, nm in sorted(st):
        if t - last < 0.05 and out:
            continue
        out.append((t, z, nm))
        last = t
    p = {"ex": ex, "st": out, "L": L, "sb": sb, "gw": gw, "proposed": proposed and len(out) >= 3, "exz": exz, "checks": []}
    if p["proposed"]:
        from app.agents.sa3_driveway.profile import check_profile
        p["checks"] = check_profile(out)
        ts, zs = [o[0] for o in out], [o[1] for o in out]
        p["design"] = lambda t: float(np.interp(t, ts, zs))     # noqa: E731
    else:
        p["design"] = None
    return p


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


def _check_text(ch) -> str:
    """Readable platform screening line: what was screened, the value and the PLATFORM limit (never PASS or FAIL against a council requirement)."""
    nm = ch.name
    if nm == "max_grade":
        what = "STEEPEST GRADE ALONG THE DRIVEWAY PROFILE"
    elif nm.startswith("change_of_grade"):
        what = "CHANGE OF GRADE AT " + nm.split("@", 1)[-1].replace("_", " ").upper()
    elif nm == "b85_scraping_clearance":
        what = "B85 UNDERBODY CLEARANCE ALONG THE PROFILE, FORWARD AND REVERSE"
    else:
        what = nm.replace("_", " ").upper()
    unit = {"%": "%", "percent": "%", "m": " m", "mm": " mm"}.get(ch.unit, f" {ch.unit}" if ch.unit else "")
    val = "VALUE NOT EVALUATED" if ch.value is None else f"VALUE {ch.value:g}{unit}"
    lim = "" if ch.limit is None else f", PLATFORM SCREENING LIMIT {ch.limit:g}{unit}"
    res = "NOT EVALUATED" if ch.passed is None else ("WITHIN THE PLATFORM LIMIT" if ch.passed else "EXCEEDS THE PLATFORM LIMIT")
    return f"{what}: {val}{lim}: {res}."


def _council_grade_line(s: Site) -> str:
    c = s.cites.get("driveway.max_grade_pct") or s.cites.get("access.driveway_max_grade_pct")
    council = LN.lga_name(getattr(s.inp, "council_name", None), getattr(s.inp.lot, "lga_name", None), getattr(s.cites, "council_name", None))
    if c is not None:
        return f"COUNCIL MAXIMUM DRIVEWAY GRADE {PH.num(c)} {PH.short_ref(c)}: THE SCREENING RESULT ABOVE IS NOT A CHECK AGAINST IT."
    return f"COUNCIL REQUIREMENT: DRIVEWAY MAXIMUM GRADE UNRESOLVED, CONFIRM WITH {council}"


def profile_check_lines(s: Site) -> list[str]:
    """ONE status source for C400 and C410: the SA3 profile checks run on the C410 profile, written as PLATFORM SCREENING (not council compliance)."""
    p = ref_profile(s)
    if p is None:
        return ["PROFILE CHECKS NOT EVALUATED: NO DRIVEWAY CENTRELINE OR EXISTING LEVELS"]
    if not p["proposed"]:
        return ["PROFILE CHECKS NOT EVALUATED: NO DRIVEWAY END LEVEL (PLATFORM DEFAULT) AVAILABLE"]
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
    if not s.inp.services:
        rows.append("existing services: NOT CONFIRMED (BYDA PLANS ARE NOT TRACED: SEE THE BYDA PANEL)" if s.inp.byda is not None else "existing services: none supplied; location to be confirmed from council records and DBYD")
    rows.append("existing buildings, trees, fences and easements: not in the supplied data (confirm by title search and s88B instrument)")
    b0 = start(ctx, "C100", rows, [], want_xover=False)
    rows += road_rows(s, b0.xg, b0.front, b0.pave)
    if len(rows) != len(b0.rows):                                    # the missing-road row changes the panel: rebuild with it
        b0 = start(ctx, "C100", rows, [], want_xover=False)
    b = b0
    b.pre = ([f"EXISTING CONTOURS: {s.dem_note_ref}" + (f" ({s.inp.contour_source.upper()}, {s.inp.contour_interval_m:g} m MINOR, {s.inp.contour_major_m:g} m MAJOR)" if (s.inp.contour_source and s.inp.contour_interval_m and s.inp.contour_major_m) else "")] if s.tin is not None else [])
    v = b.v
    if s.tin is not None:
        contour_sets(s, v.model_window())
        D.contours(v, s, "ex")                                       # contours only: spot levels are not shown on the existing site plan
    draw_xover(b, "existing")
    missing: list[str] = []
    _n, pending = _services(v, s, missing)
    finish(b, "EXISTING SITE PLAN")
    CX.callouts_crossover(v, b.xg, b.std, b.keep, [], [s.lot], kerb_only=True, short_kerb=True, must_avoid=list(getattr(b, 'kerb_geoms', [])))
    for lines_, pt_ in pending:
        place(b, lines_, pt_)
    byda_panel(b)
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
    fp = s.footprint if s.inp.show_dwelling else None
    b = start(ctx, "C101", [], [], want_xover=True)
    front, drv, std, xg = b.front, b.drv, b.std, b.xg
    rows = list(road_rows(s, xg, front, b.pave))
    if drv is None or s.drive_poly is None:
        rows.append("driveway and crossover (SA3 driveway result not supplied)")
    if not s.neighbours:
        rows.append("adjoining lots (cadastre query returned none)")
    if xg.kerb_line is None and "kerb line" not in " ".join(rows):
        rows.append("kerb line and road edge")
    if s.inp.show_dwelling and fp is None:
        rows.append("proposed structure footprint (no SA7 overlay, SA8 layout or envelope large enough for the preset)")
    rows += _svc_missing(s)
    if rows:
        b = start(ctx, "C101", rows, [], want_xover=True)
        front, drv, std, xg = b.front, b.drv, b.std, b.xg
    v = b.v
    draw_xover(b, "proposed", dims=True)
    if fp is not None:
        ST.hatch_fill(v, fp, "proposed")
        b.hard.append(fp)
    if fp is not None:
        avoid = unary_union([g for g in b.hard if g is not None and not g.is_empty] or [Point(1e9, 1e9)])
        D.building_setbacks(v, s, text_h=2.5, off_mm=4.0, color=ST.BLACK, mask=True, avoid=avoid)
    nsv, svc_pending = _services(v, s, [])
    if s.inp.rwt is not None:
        x, y = s.inp.rwt.location_xy
        v.fill(Point(x, y).buffer(s.inp.rwt.diameter_m / 2), "C-UTIL-RWTK", ST.WHITE, 1.0, edge=ST.BLACK, edge_lw=ST.REF.outline_lw)
    ph = fonts.wrap(codes.SETBACK_PLACEHOLDER, 2.4, 96.0, True)
    hh = 4.0 + 3.4 * len(ph)
    pr = (PLAN_RECT[2] - 106.0, PLAN_RECT[3] - 70.0 - hh, PLAN_RECT[2] - 4.0, PLAN_RECT[3] - 70.0)
    finish(b, "PROPOSED SITE PLAN", reserve=[pr] if fp is None else ())
    keep = b.keep
    if fp is None:
        PP = ST.Paper(v)
        PP.poly([(pr[0], pr[1]), (pr[2], pr[1]), (pr[2], pr[3]), (pr[0], pr[3])], "C-DATA-NONE", ST.WHITE, edge=RED, edge_lw=0.35)
        for i, t in enumerate(ph):
            PP.text(pr[0] + 2.0, pr[3] - 2.0 - 3.4 * i, t, 2.4, "TOP_LEFT", bold=True, color=RED, layer="C-DATA-NONE")
    hard, soft = b.hard, [s.lot]
    CX.callouts_crossover(v, xg, std, keep, list(hard), soft, must_avoid=list(b.kerb_geoms))
    if xg.present:
        place(b, LAYOVER_REF, xg.frontage.xy(xg.centre_s - xg.width_m * 0.3, xg.body_len_m * 0.4), avoid=hard)
    if fp is not None:
        c = fp.representative_point()
        place(b, [s.fp_label, f"AREA {fp.area:.0f} m2  ({D._dim_text(fp)})"] + _ffl_lines(s), (c.x, c.y), avoid=hard)
    if s.drive_poly is not None and s.drive_cl is not None and drv is not None:
        cl_in = s.drive_cl.intersection(s.lot)
        seg = max(getattr(cl_in, "geoms", [cl_in]), key=lambda g: g.length) if not cl_in.is_empty else None
        if seg is not None and seg.geom_type == "LineString" and seg.length > 0:
            m = seg.interpolate(0.5, normalized=True)
            lines = ["PROPOSED DRIVEWAY", "MATERIAL TO BE CONFIRMED", f"WIDTH {drv.width_m:.1f}m (PLATFORM DEFAULT)"]
            if drv.max_grade_pct is not None:
                lines.append(f"MAX GRADE {drv.max_grade_pct:.1f}% (PLATFORM SCREENING LIMIT)")
            place(b, lines, (m.x, m.y), avoid=hard)
    pave_callout(b)
    for lines_, pt_ in svc_pending:
        place(b, lines_, pt_, avoid=hard)
    cand = [g for g in s.inp.lot.segments if not g.is_front]
    if cand:
        sg = max(cand, key=lambda g: g.distance_m)
        mid = ((sg.start_xy[0] + sg.end_xy[0]) / 2, (sg.start_xy[1] + sg.end_xy[1]) / 2)
        place(b, [f"AREA {s.inp.lot.area_m2_calculated:,.0f} m2 (CALCULATED FROM " + ("THE SITE DATA FOLDER BOUNDARY)" if s.inp.boundary_source else "CADASTRE)")], mid, "arrow", avoid=hard)
    notes = [codes.SETBACK_PLACEHOLDER + "."] if fp is None else []
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
        tw_ = fonts.text_width(txt, 2.3, True) + 6.0
        bx0 = (xl - 8.0 - tw_) if side < 0 else (xr + 8.0)
        bx0 = min(max(bx0, r[0] + 3.0), r[2] - 3.0 - tw_)
        SEC.callout(sv, P, [txt], (bx0, dimy + 17.0), (mx_, my_ - 0.4), tw_ + 2.0, 2.3)
    P.text((xl + xr) / 2, dimy + 4.0, f"DESIGN RL {zd:.2f}", 2.3, "BOTTOM_CENTER", layer="C-ANNO-NOTE", color=(0.8, 0, 0))
    ex_txt = f"EXISTING GROUND (INDICATIVE, DEM) RL {pts[0][1]:.2f}"
    tx0 = r[0] + 4.0
    tw2 = fonts.text_width(ex_txt, 2.3)
    top_g = max(y_ for x_, y_ in ex_pts if tx0 - 1.0 <= x_ <= tx0 + tw2 + 1.0) if any(tx0 - 1.0 <= x_ <= tx0 + tw2 + 1.0 for x_, _y in ex_pts) else ex_pts[0][1]
    P.text(tx0, min(top_g + 3.0, r[3] - 22.0), ex_txt, 2.3, "BOTTOM_LEFT", layer="C-ANNO-NOTE", color=(0.3, 0.3, 0.3))
    for xe in (xl, xr):                                                 # extension lines attached to the platform edges
        P.line([(xe, Y(zd) - 0.8), (xe, dimy + 1.5)], "C-ANNO-DIMS", 0.1, ST.GRID)
    SEC.dim_h(P, dimy, xl, xr, f"DRIVEWAY WIDTH {CX._fmt_m(w)}", 2.4)
    P.text(r[0] + 3.0, r[1] + 3.0, "BATTER SLOPES ARE DRAWN FOR GRAPHIC PURPOSES: " + (tv.ratio("cut_batter") + " CITED" if tv.has("cut_batter") else "1:N " + SEC.TBC_STATEMENT), 2.1, "BOTTOM_LEFT", layer="C-ANNO-NOTE", color=RED)


def c200(ctx: RefCtx) -> Sheet:
    s = ctx.site
    pad_ok = bool(s.inp.show_dwelling and s.cutfill is not None)
    ew = driveway_earthworks(s)
    rows = []
    if not pad_ok:
        rows.append("building pad cut, fill, batters and volumes: depend on the " + NO_DWELLING)
    if s.tin is None:
        rows.append("existing levels: no survey or DEM levels supplied")
    elif ew is None:
        rows.append("driveway cut and fill: no driveway design or driveway end level available")
    notes = []
    if pad_ok:
        notes.append("BATTERS 1V:2H CUT AND 1V:3H FILL ARE ASSUMED. GEOTECHNICAL ADVICE REQUIRED.")
    if s.tin is not None:
        notes.append("EXISTING CONTOURS: " + s.dem_note_ref)
    if ew is not None:
        notes.append(f"DRIVEWAY CUT AND FILL: EXISTING {s.dem_label} AGAINST THE PLATFORM DRIVEWAY PROFILE (LEVEL AT THE DRIVEWAY END IS A PLATFORM DEFAULT). INDICATIVE.")
    b = start(ctx, "C200", rows, notes, want_xover=False)
    rr = road_rows(s, b.xg, b.front, b.pave)
    v = b.v
    if s.tin is not None:
        contour_sets(s, v.model_window())
        D.contours(v, s, "ex")
    if pad_ok:
        from shapely import wkt as swkt
        for z in s.cutfill.zones:
            g = swkt.loads(z.wkt)
            col = (0.85, 0.15, 0.1) if z.kind == "cut" else (0.1, 0.6, 0.2)
            v.fill(g, "C-EART-CUTT" if z.kind == "cut" else "C-EART-FILL", col, 0.5, (45 if z.kind == "cut" else -45, 2.0))
        if s.pad is not None:
            v.geom(s.pad, "C-EART-PADD", lw=0.3, color=D.BLUE)
    draw_xover(b, "proposed")
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
    extra = []
    if pad_ok:
        extra.append(f"PAD CUT {s.cutfill.cut_volume_m3:,.1f} m3, FILL {s.cutfill.fill_volume_m3:,.1f} m3, NET {s.cutfill.net_volume_m3:+,.1f} m3 (INDICATIVE, {s.dem_label})")
    sh = seal(b, extra)
    sh.data_missing = list(b.rows) + [r for r in rr if r not in b.rows]
    return sh


# ====================================================================================================== C300 stormwater
def c300(ctx: RefCtx) -> Sheet:
    s = ctx.site
    rows = ["roof catchment, downpipes, pits and discharge route: depend on the " + NO_DWELLING]
    if s.tin is None:
        rows.append("overland flow arrows: no survey or DEM levels supplied")
    st_exist = [x for x in s.inp.services if x.service == "stormwater"]
    if not st_exist:
        rows.append("existing council stormwater assets: none supplied; confirm from council records and DBYD")
    notes = ["ALL DRAINAGE IS TO BE DESIGNED BY A HYDRAULIC DESIGNER. NOTHING HERE IS A DRAINAGE DESIGN."]
    notes += cited(s, ("stormwater.designed_per_eng_standards", "stormwater.osd_roof_plumbing_design_aep_pct"))
    if s.tin is not None:
        notes.append(f"OVERLAND FLOW ARROWS SHOW THE DOWNSLOPE DIRECTION OF THE {s.dem_label} (INDICATIVE). FLOW PATHS AND CATCHMENTS ARE NOT MODELLED.")
    dn = drainage_discharge_note(s)
    if dn:
        notes.append(dn)
    if s.inp.rwt is None:
        notes.append("RAINWATER TANK: NONE SUPPLIED (ANY COUNCIL REQUIREMENT TO BE CONFIRMED)")
    b = start(ctx, "C300", rows, notes)
    v = b.v
    draw_xover(b, "proposed")
    if s.tin is not None:
        w = v.model_window()
        gx = np.linspace(w[0] + 30 / v.k, w[2] - 30 / v.k, 14)
        gy = np.linspace(w[1] + 30 / v.k, w[3] - 30 / v.k, 10)
        for x in gx:
            for y in gy:
                p = Point(x, y)
                if not s.lot.buffer(-1.0).contains(p) or (s.drive_poly is not None and s.drive_poly.buffer(2).contains(p)):
                    continue
                d = SP.downslope(s, (x, y))
                if d:
                    SP.arrow(v, (x, y), d)
    _services(v, s, [], ("stormwater",))
    if s.inp.rwt is not None:
        x, y = s.inp.rwt.location_xy
        v.fill(Point(x, y).buffer(s.inp.rwt.diameter_m / 2), "C-UTIL-RWTK", ST.WHITE, 1.0, edge=ST.BLACK, edge_lw=ST.REF.outline_lw)
    finish(b, "STORMWATER")
    if dn:                                                                       # visible on the plan, not only in the notes panel
        text_panel(b, "DRAINAGE DISCHARGE (INDICATIVE)", [dn], 120.0, warn=True)
    CX.callouts_crossover(v, b.xg, b.std, b.keep, [], [s.lot], kerb_only=True, short_kerb=True, must_avoid=list(getattr(b, 'kerb_geoms', [])))
    pave_callout(b)
    return seal(b)


# ====================================================================================================== C310 water and sewer
def c310(ctx: RefCtx) -> Sheet:
    s = ctx.site
    ex_w = [x for x in s.inp.services if x.service in ("water", "sewer") and not x.is_proposed]
    rows = ["proposed water service and sewer house connection: depend on the " + NO_DWELLING]
    if not ex_w:
        rows.append("existing water main, sewer main and junction: none supplied; EXISTING SERVICE LOCATION TO BE CONFIRMED FROM COUNCIL RECORDS / DBYD")
    notes = cited(s, ("water.min_cover_m", "sewer.junction_min_diameter_mm", "sewer.house_connection_min_cover_m", "util.build_over_sewer_policy"))
    notes.append("LOCATE ALL SERVICES BY DBYD AND POTHOLING BEFORE EXCAVATION.")
    b = start(ctx, "C310", rows, notes)
    draw_xover(b, "proposed")
    _n, pending = _services(b.v, s, [], ("water", "sewer"))
    finish(b, "WATER AND SEWER")
    CX.callouts_crossover(b.v, b.xg, b.std, b.keep, [], [s.lot], kerb_only=True, short_kerb=True, must_avoid=list(getattr(b, 'kerb_geoms', [])))
    for lines_, pt_ in pending:
        place(b, lines_, pt_)
    byda_panel(b)
    pave_callout(b)
    return seal(b)


# ====================================================================================================== C400 driveway plan
def _vehicle_lines(name: str) -> list[str]:
    """Design vehicle from the platform's own vehicle table (SA3 swept path module); DATA NOT AVAILABLE when the vehicle is not in it."""
    try:
        from app.agents.sa3_driveway import swept as sw
        v = sw.VEHICLES.get(name)
    except Exception:  # noqa: BLE001
        v = None
    if v is None:
        return [f"DESIGN VEHICLE {ST.clean(name).upper()}: DATA NOT AVAILABLE (NOT IN THE PLATFORM VEHICLE DATA)"]
    return [f"DESIGN VEHICLE {v.name} (AS/NZS 2890.1)", f"OVERALL LENGTH {v.length:.2f}m", f"OVERALL WIDTH {v.width:.2f}m", f"WHEELBASE {v.wheelbase:.2f}m",
            f"FRONT OVERHANG {v.front_oh:.2f}m", f"REAR OVERHANG {v.rear_oh:.2f}m", f"MINIMUM TURNING RADIUS {v.min_turn_radius:.2f}m (PLATFORM VALUE, TO BE VERIFIED)",
            "SOURCE: PLATFORM VEHICLE DATA (FLAGGED TO VERIFY AGAINST THE STANDARD)"]


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
    b = start(ctx, "C400", rows, notes, want_xover=True, focus="drive")
    v, xg = b.v, b.xg
    if has:
        v.avoid_lines = [to_paper(v, s.drive_cl)]                       # dimension figures never sit on the driveway centreline
    draw_xover(b, "proposed", dims=True)
    swept = False
    if has:
        swept = swept_ok(s, xg)
        if swept:
            v.fill(s.turn_path, "C-DRIV-TURN", (0.9, 0.45, 0.0), 0.12)
            v.geom(s.turn_path, "C-DRIV-TURN", lw=0.25, color=(0.9, 0.45, 0.0))
        L = s.drive_cl.length
        step = 5.0 if (L > 12 and b.scale > 50) else 2.0
        for i in range(int(L / step) + 1):
            d = i * step
            p, q = s.drive_cl.interpolate(d), s.drive_cl.interpolate(min(L, d + 0.2))
            a = math.atan2(q.y - p.y, q.x - p.x)
            nx, ny = -math.sin(a), math.cos(a)
            h = 1.6 / v.k
            v.line([(p.x - nx * h, p.y - ny * h), (p.x + nx * h, p.y + ny * h)], "C-DRIV-CNTR", False, 0.25, "CONTINUOUS", anno=False)
        v.geom(s.drive_cl, "C-DRIV-CNTR", lw=0.13, color=ST.BLACK)
        P = ST.Paper(v)
        avoid = [to_paper(v, s.drive_poly).buffer(0.5)] + [to_paper(v, g).buffer(0.5) for g in b.hard]
        for lab, p1, p2 in [d_ for d_ in drv.dimensions if not re.search(r"GARAGE|DWELLING|FFL|HOUSE", d_[0].upper()) and not (xg.present and ("CROSSOVER WIDTH" in d_[0].upper() or abs(math.dist(d_[1], d_[2]) - drv.width_m) < 0.02 or re.fullmatch(r"\d+(\.\d+)?\s*M", d_[0].strip().upper())))]:      # no building wording or values (site only); SA3 driveway dimensions: placed clear of the driveway, each other and the other labels
            txt = f"{lab} {math.dist(p1, p2):.2f} m" if not any(ch.isdigit() for ch in lab) else lab
            if "OFFSET" in lab.upper():                                   # SA3 offset: boundary corner to the crossover centre at the boundary, i.e. the driveway centreline
                txt = f"OFFSET FROM BOUNDARY CORNER TO DRIVEWAY CENTRELINE {math.dist(p1, p2):.2f} m"
            if "OFFSET" in lab.upper():                                   # runs along the boundary to the centre of the driveway: may cross the pale driveway fill, never the stipple; clear of the width dimensions
                dark = [to_paper(v, xg.polys[k_]).buffer(0.3) for k_ in ("body", "wing_a", "wing_b", "band") if xg.present and xg.polys.get(k_) is not None and xg.polys[k_].area > 1e-6]
                dim_best(v, v.tp(*p1), v.tp(*p2), CO.prep([txt])[0], (14.0, 20.0, 27.0, 35.0, 45.0), ((0, 1), (0, -1), (1, 0), (-1, 0)), 2.3, dark)
            else:
                dim_best(v, v.tp(*p1), v.tp(*p2), CO.prep([txt])[0], (7.0, 12.0, 17.0, 23.0), ((0, 1), (0, -1), (1, 0), (-1, 0)), 2.3, avoid)
    finish(b, "DRIVEWAY PLAN")
    keep = b.keep
    if b.xg.present:
        if s.drive_cl is not None:
            cl_in = s.drive_cl.intersection(s.lot)
            seg = max(getattr(cl_in, "geoms", [cl_in]), key=lambda g: g.length) if not cl_in.is_empty else None
            if seg is not None and seg.geom_type == "LineString" and seg.length > 0:
                m = seg.interpolate(0.5, normalized=True)
                lines = ["PROPOSED DRIVEWAY", "MATERIAL TO BE CONFIRMED", f"WIDTH {drv.width_m:.1f}m (PLATFORM DEFAULT)"]
                if drv.max_grade_pct is not None:
                    lines.append(f"MAX GRADE {drv.max_grade_pct:.1f}% (PLATFORM SCREENING LIMIT)")
                place(b, lines, (m.x, m.y), avoid=b.hard)
        CX.callouts_crossover(v, xg, b.std, keep, list(b.hard), [s.lot], must_avoid=list(b.kerb_geoms))
        place(b, LAYOVER_REF, xg.frontage.xy(xg.centre_s - xg.width_m * 0.3, xg.body_len_m * 0.4), avoid=b.hard)
        e = s.drive_cl.interpolate(s.drive_cl.length)
        place(b, [DRIVE_END], (e.x, e.y), "dot", must=False, avoid=b.hard)
    if has:
        L = s.drive_cl.length
        for i in range(int(L / (5.0 if b.scale > 50 else 2.0)) + 1):
            d = i * (5.0 if b.scale > 50 else 2.0)
            p, q = s.drive_cl.interpolate(d), s.drive_cl.interpolate(min(L, d + 0.2))
            a = math.atan2(q.y - p.y, q.x - p.x)
            lx, ly = p.x - math.sin(a) * 6.0 / v.k, p.y + math.cos(a) * 6.0 / v.k
            tp_ = _tp(v, lx, ly, f"CH {d:g}", 2.2, math.degrees(a) + 90).buffer(0.8)
            if any(tp_.intersects(LineString(q)) for q in v.leaders):
                continue                                                 # a call-out leader runs here: skip this chainage label
            v.label(lx, ly, f"CH {d:g}", 2.2, math.degrees(a) + 90, layer="C-ANNO-DIMS", nudges=False)
    if has:
        text_panel(b, "DESIGN VEHICLE", _vehicle_lines(drv.design_vehicle), 92.0)
        if not swept:
            text_panel(b, "SWEPT PATH", [SWEPT_TBC, "THE PLATFORM PATH IS NOT DRAWN: IT DOES NOT FORM ONE CLEAN PATH INSIDE THE LOT, VERGE AND ROAD."], 92.0, warn=True)
        text_panel(b, CHECK_TITLE, profile_check_lines(s), 130.0)
    pave_callout(b)
    if s.spots and s.drive_poly is not None:                      # sparse design-sheet spot levels near the driveway (never on C100)
        D.spot_levels_sparse(b.v, s, s.drive_poly, avoid=list(b.kerb_geoms) + [s.lot.boundary, s.drive_poly] + [g for g in b.hard if g is not None and not g.is_empty])
    return seal(b)


# ====================================================================================================== C410 long section
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
            P.text(x + i * length / n, y + 3.0, t, 2.2, "BOTTOM_LEFT" if i == n else "BOTTOM_CENTER", layer="C-ANNO-NRTH")
        else:
            P.text(x + 3.0, y + i * length / n, t, 2.2, "MIDDLE_LEFT", layer="C-ANNO-NRTH")
    if horizontal:
        P.text(x, y - 1.2, label, 2.4, "TOP_LEFT", bold=True, layer="C-ANNO-NRTH")
    else:
        P.text(x, y - 2.0, label, 2.4, "TOP_LEFT", bold=True, layer="C-ANNO-NRTH")


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
        D.no_data(v, (VIEW_RECT[0] + 8, VIEW_RECT[3] - 70, VIEW_RECT[0] + 200, VIEW_RECT[3] - 8), "LONGITUDINAL SECTION NOT DRAWN.", "Needed: " + "; ".join(why) + ".")
        sh.data_missing.append("driveway long section: " + "; ".join(why))
        sh.notes = ["LONGITUDINAL SECTION NOT DRAWN: DATA NOT AVAILABLE"]
        sh.scale_text = "NOT DRAWN"
        return sh
    ex, st, L, gw, proposed = p["ex"], p["st"], p["L"], p["gw"], p["proposed"]
    des, exz = p["design"], p["exz"]
    zs = [e[1] for e in ex] + [x[1] for x in st]
    zmin, zmax = min(zs), max(zs)
    datum = math.floor((zmin - 0.25) * 4) / 4.0
    hs, vs, ex_ = 200, 40, 5
    fit_ = False
    for hs_ in (10, 20, 25, 50, 100, 200):                              # smallest denominator that fits: the largest drawing, using the sheet width
        for ex__ in (5, 2.5, 2, 1):                                     # vertical exaggeration: vertical scale is 1:(H denominator / exaggeration)
            vs_ = hs_ / ex__
            if (L + 1.0) * 1000.0 / hs_ <= 704.0 and (zmax - datum + 0.3) * 1000.0 / vs_ <= 270.0:
                hs, vs, ex_, fit_ = hs_, vs_, ex__, True
                break
        if fit_:
            break
    X0, Yd, ROWH = 74.0, 232.0, 19.0
    hx = lambda t: X0 + (t + 0.5) * 1000.0 / hs        # noqa: E731
    zy = lambda z: Yd + (z - datum) * 1000.0 / vs      # noqa: E731
    Lc = "C-DRIV-LONG"
    xr = hx(L + 0.5)
    rows_ = ("DESIGN LEVEL", "EXISTING LEVEL", "CUT/FILL DEPTH", "CHAINAGE")
    ybot = Yd - ROWH * len(rows_)
    # datum, VERT EXAG and RL grid ---------------------------------------------------------------------------------------------
    v.text(28.0, Yd + 8.0, f"VERT EXAG {ex_:g}", 2.8, "BOTTOM_LEFT", bold=True, layer=Lc)
    v.text(28.0, Yd + 2.5, f"DATUM RL {datum:.3f}", 2.8, "BOTTOM_LEFT", bold=True, layer=Lc)
    z = datum + 0.5
    while z <= zmax + 0.3:
        v.line([(X0 - 2, zy(z)), (xr, zy(z))], "C-ANNO-TABL", False, 0.05, color=(0.8, 0.8, 0.8))
        v.text(X0 - 3, zy(z), f"{z:.2f}", 2.4, "MIDDLE_RIGHT", layer=Lc)
        z += 0.5
    v.line([(27.0, Yd), (xr, Yd)], Lc, False, 0.35)
    # data bands ----------------------------------------------------------------------------------------------------------------
    for i, lab in enumerate(rows_):
        yt = Yd - i * ROWH
        v.line([(27.0, yt - ROWH), (xr, yt - ROWH)], "C-ANNO-TABL", False, 0.2)
        v.text(28.0, yt - ROWH / 2, lab, 2.4, "MIDDLE_LEFT", bold=True, layer="C-ANNO-TABL")
    v.line([(27.0, Yd), (27.0, ybot)], "C-ANNO-TABL", False, 0.2)
    v.line([(X0 - 4, Yd), (X0 - 4, ybot)], "C-ANNO-TABL", False, 0.2)
    v.line([(xr, Yd), (xr, ybot)], "C-ANNO-TABL", False, 0.2)
    stat_t = [q[0] for q in st]
    pts = list(stat_t)
    for t in [i * 2.0 for i in range(int(L / 2.0) + 1)] + [L]:
        if all(abs(t - q) * 1000.0 / hs >= 4.6 for q in pts):
            pts.append(t)
    pts = sorted(pts)
    for t in pts:
        x = hx(t)
        zex = exz(t)
        zde = des(t) if proposed else None
        ytop = zy(max(zex, zde if zde is not None else zex))
        v.line([(x, Yd), (x, ytop)], Lc, False, 0.1, "DASHED", color=(0.45, 0.45, 0.45))        # ticks break at the data bands (text sits there)
        for k_ in range(len(rows_) + 1):
            v.line([(x, Yd - k_ * ROWH - 1.2), (x, Yd - k_ * ROWH + 1.2)], "C-ANNO-TABL", False, 0.15)
        vals = [f"{zde:.3f}" if zde is not None else "N/A", f"{zex:.3f}", ("N/A" if zde is None else (f"{abs(zex - zde):.2f} CUT" if zex - zde > 0.005 else (f"{abs(zex - zde):.2f} FILL" if zex - zde < -0.005 else "0.00"))), f"{t:.2f}"]
        for i, tx in enumerate(vals):
            v.text(x, Yd - i * ROWH - ROWH / 2, tx, 2.2, "MIDDLE_CENTER", 90.0, layer="C-ANNO-TABL")
    # profile -----------------------------------------------------------------------------------------------------------------------
    v.line([(hx(t), zy(zz)) for t, zz in ex], "C-DRIV-EXGD", False, 0.35, color=(0.3, 0.3, 0.3))
    gx0, gx1 = hx(0.0), hx(gw)
    v.fill(Polygon([(gx0, Yd), (gx1, Yd), (gx1, Yd + 3.0), (gx0, Yd + 3.0)]), Lc, (0.55, 0.55, 0.55), 0.8, anno=True)
    if proposed:
        v.line([(hx(t), zy(zz)) for t, zz, _n in st], Lc, False, 0.7, color=(0.85, 0, 0))
        for (t0, z0_, _a), (t1, z1, _b) in zip(st, st[1:]):
            g = 100.0 * (z1 - z0_) / (t1 - t0)
            txt = f"{g:+.1f}%"
            if (t1 - t0) * 1000.0 / hs < fonts.text_width(txt, 2.4) + 3.0:
                continue
            xm, ym = hx((t0 + t1) / 2), (zy(z0_) + zy(z1)) / 2
            ang = math.degrees(math.atan2(zy(z1) - zy(z0_), hx(t1) - hx(t0)))
            v.text(xm, ym + 3.2, txt, 2.4, "MIDDLE_CENTER", ang, bold=True, layer=Lc, color=(0.85, 0, 0), halo=True)
    for t, zz, nm in st:
        yb = zy(max(zz, exz(t))) + 5.0
        v.text(hx(t) - 1.6, yb, f"{nm}  RL {zz:.2f}" + ("" if proposed else " (EXISTING)"), 2.4, "MIDDLE_LEFT", 90.0, layer=Lc, halo=True)
    tg = min(max(L * 0.62, st[-1][0] * 0.55), L)
    need = fonts.text_width("DESIGN LEVEL (PLATFORM PROFILE)", 2.6) + 8.0
    gaps = [((a_ + b_) / 2, (b_ - a_) * 1000.0 / hs) for a_, b_ in zip(pts, pts[1:]) if (b_ - a_) * 1000.0 / hs >= need]
    if gaps:
        tg = min(gaps, key=lambda g_: abs(g_[0] - tg))[0]               # centred between two station ticks: no tick runs through the label
    low = zy(min(exz(tg), des(tg) if proposed else exz(tg)))
    high = zy(max(exz(tg), des(tg) if proposed else exz(tg)))
    v.text(hx(tg), high + 9.0, "EXISTING GROUND (INDICATIVE, DEM)", 2.6, "BOTTOM_CENTER", layer="C-DRIV-EXGD", color=(0.3, 0.3, 0.3), halo=True)
    if proposed:
        v.text(hx(tg), low - 14.0, "DESIGN LEVEL (PLATFORM PROFILE)", 2.6, "TOP_CENTER", layer=Lc, color=(0.85, 0, 0), halo=True)
    # scale bars -------------------------------------------------------------------------------------------------------------------------
    mh = next(m for m in (1, 2, 5, 10) if m * 1000.0 / hs >= 25.0)
    lh = mh * 1000.0 / hs
    mv = max([m for m in (0.05, 0.1, 0.25, 0.5, 1, 2, 5) if m * 1000.0 / vs <= 80.0] or [0.05])      # largest round length that stays a compact bar
    _bar(v, xr + 14.0, Yd + 6.0, mv * 1000.0 / vs, mv, False, f"VERTICAL SCALE 1:{vs:g} @ A1")
    title_strip(sh, "DRIVEWAY LONGITUDINAL SECTION" + ("" if proposed else " (EXISTING GROUND ONLY)"), f"H 1:{hs}  V 1:{vs:g} @ A1    H 1:{a3_scale(hs)}  V 1:{a3_scale(vs):g} @ A3", hs)
    sh.scale_text = f"H 1:{hs} V 1:{vs:g}"
    # status, checks, notes ---------------------------------------------------------------------------------------------------------------
    lines = []
    if not proposed:
        D.no_data(v, (X0 - 4.0, 440.0, X0 + 360.0, 500.0), "PROPOSED LEVELS NOT AVAILABLE.", "No driveway end level (platform default) is available, so the design line, grades and B85 checks are not drawn.")
        sh.data_missing.append("proposed driveway levels and checks: driveway end level (platform default) not available")
    else:
        lines += profile_check_lines(s)
        lines.append(NO_VERGE_DESIGN + ".")
        lines.append(f"DRIVEWAY END LEVEL RL {st[-1][1]:.2f} IS A PLATFORM DEFAULT: NO BUILDING LEVEL IS DESIGNED.")
    fl = falls_to_lot_note(s)
    if fl:
        lines.append(fl + ".")
    lines.append(f"EXISTING GROUND {s.dem_note_ref}. KERB LINE, GUTTER BAND ({CX._fmt_m(gw)}) AND PROPERTY BOUNDARY POSITIONS ARE ASSUMED GROUND POINTS (KERB NOT SURVEYED).")
    pw = min(165.0, VIEW_RECT[2] - 2.0 - (xr + 12.0))               # notes column to the right of the profile (the chart keeps the full width)
    h_ = _wrap_h(lines, pw - 2.0, 2.4)
    ptop = CONTENT_Y1 - 2.0
    D.panel(v, xr + 12.0, ptop - h_, xr + 12.0 + pw, ptop, "NOTES AND " + CHECK_TITLE, lines, 2.4)
    # plan strip aligned to the chainage of the profile (lateral extent diagrammatic) ---------------------------------------------
    top_lab = max(zy(max(zz, exz(t))) + 5.0 + fonts.text_width(f"{nm}  RL {zz:.2f}" + ("" if proposed else " (EXISTING)"), 2.4) for t, zz, nm in st)
    SH_ = 26.0
    sy0 = top_lab + 7.0
    if sy0 + SH_ <= CONTENT_Y1 - 2.0:
        _plan_strip(v, s, X0, xr, hx, sy0, sy0 + SH_, L, gw, p["sb"])
    sh.notes = ["LONGITUDINAL SECTION ALONG THE SA3 DRIVEWAY CENTRELINE. CHAINAGE 0 IS THE KERB LINE.", "LEVELS ARE DEM-DERIVED AND INDICATIVE."] + ([fl] if fl else [])
    return sh


def _plan_strip(v: View, s: Site, X0: float, xr: float, hx, y0: float, y1: float, L: float, gw: float, sb: float) -> None:
    """Plan strip above the long section, on the same chainage axis: kerb line, kerb and gutter band, property boundary, layover (concrete stipple) and
    driveway (surface from the cited value only).  The lateral extent is DIAGRAMMATIC: the strip is not to scale across the driveway."""
    P = ST.Paper(v)
    P.line([(27.0, y0), (xr, y0), (xr, y1), (27.0, y1)], "C-ANNO-TABL", 0.2, None, None, True)
    P.line([(X0 - 4.0, y0), (X0 - 4.0, y1)], "C-ANNO-TABL", 0.2)
    v.text(28.0, (y0 + y1) / 2 + 3.0, "PLAN", 2.4, "MIDDLE_LEFT", bold=True, layer="C-ANNO-TABL")
    v.text(28.0, (y0 + y1) / 2 - 1.0, "(DIAGRAMMATIC,", 2.0, "MIDDLE_LEFT", layer="C-ANNO-TABL")
    v.text(28.0, (y0 + y1) / 2 - 3.6, "NOT TO SCALE ACROSS)", 2.0, "MIDDLE_LEFT", layer="C-ANNO-TABL")
    xk, xg_, xb, xe = hx(0.0), hx(gw), hx(sb), hx(L)
    ym, hw = (y0 + y1) / 2, 7.0
    # road to the left of the kerb line and the gutter band (hatch between the kerb line and the back of the band)
    P.poly([(X0 - 4.0 + 0.5, y0 + 0.5), (xk, y0 + 0.5), (xk, y1 - 0.5), (X0 - 4.0 + 0.5, y1 - 0.5)], "C-ROAD-PAVE", ST.BITUMEN, edge=None)
    v.text((X0 - 4.0 + xk) / 2, ym, "ROAD", 2.2, "MIDDLE_CENTER", layer="C-ANNO-TABL")
    P.poly([(xk, y0 + 0.5), (xg_, y0 + 0.5), (xg_, y1 - 0.5), (xk, y1 - 0.5)], "C-ROAD-KERB", (0.82, 0.82, 0.82), edge=None)
    for xx, lw_ in ((xk, ST.REF.kerb_lw), (xg_, ST.REF.gutter_lw)):
        P.line([(xx, y0 + 0.5), (xx, y1 - 0.5)], "C-ROAD-KERB", lw_, ST.BLACK if xx == xk else ST.FENCE)
    # layover: kerb line to the property boundary; driveway: boundary to the end of the profile
    if xb > xg_ + 1.0:
        lay = Polygon([(xg_, ym - hw), (xb, ym - hw), (xb, ym + hw), (xg_, ym + hw)])
        ST.concrete_fill(v, lay, "C-ROAD-CONC")
        if xb - xg_ > 38.0:
            v.text((xg_ + xb) / 2, y1 - 3.0, "LAYOVER (SEE C420)", 2.2, "TOP_CENTER", bold=True, layer="C-ANNO-TABL", halo=True)
        if xb - xg_ > 90.0:
            v.text((xg_ + xb) / 2, y0 + 1.8, "NO VERGE DESIGN: DESIGN LINE IS THE EXISTING SURFACE", 2.0, "BOTTOM_CENTER", layer="C-ANNO-TABL", halo=True)
    if xe > xb + 1.0:
        drv = Polygon([(xb, ym - hw), (xe, ym - hw), (xe, ym + hw), (xb, ym + hw)])
        ST.driveway_fill(v, drv, SEC.TypicalValues(s.cites).material())
        v.text((xb + xe) / 2, y1 - 3.0, "DRIVEWAY (SURFACE PER CITED VALUE, ELSE TO BE CONFIRMED)", 2.2, "TOP_CENTER", bold=True, layer="C-ANNO-TABL", halo=True)
    P.line([(xk, ym), (xe, ym)], "C-DRIV-CNTR", 0.18, ST.BLACK, "DASHDOT")
    P.line([(xb, y0 + 0.5), (xb, y1 - 0.5)], "C-PROP-BDY", ST.REF.boundary_lw, ST.BLACK)
    P.line([(xb, y0 + 0.5), (xb, y1 - 0.5)], "C-PROP-BDYD", ST.REF.dash_lw, ST.YELLOW, ST.DASH_BDY)
    v.text(xb + 1.5, y0 + 2.0, "PROPERTY BOUNDARY", 2.0, "BOTTOM_LEFT", layer="C-ANNO-TABL", halo=True)
    v.text(xe - 1.5, y0 + 2.0, "END OF PROFILE", 2.0, "BOTTOM_RIGHT", layer="C-ANNO-TABL", halo=True)
    v.text(xk - 1.5, y0 + 2.0, "KERB LINE", 2.0, "BOTTOM_RIGHT", layer="C-ANNO-TABL", halo=True)


# ====================================================================================================== C420 driveway layover details
def c420(ctx: RefCtx) -> Sheet:
    s, proj = ctx.site, ctx.proj
    sh = Sheet("C420", codes.SHEET_TITLES["C420"], "", paper=A1, north=0.0)
    front, drv, std, xg = make_xg(s, 0.0)
    notes = [CX.LAYOVER_STANDARD_NOTE] + CX.crossover_notes(xg, std)
    nrect, _ = notes_layout(proj, _dedupe(notes), (), reserve=2)
    v = sh.add(View("layover", PLAN_RECT))
    P = ST.Paper(v)
    if not xg.present:
        D.no_data(v, (VIEW_RECT[0] + 8, VIEW_RECT[1] + 8, VIEW_RECT[2] - 8, VIEW_RECT[3] - 8), "DRIVEWAY LAYOVER NOT DRAWN.", (xg.note or CX.NO_DRIVEWAY_TEXT) + " Needed: SA3 driveway result with a crossover polygon. The layover plan, dimensions and typical cross section need the crossover.")
        sh.data_missing.append("driveway layover (SA3 driveway result)")
        sh.notes = _dedupe(notes)
        sh.scale_text = "NOT DRAWN"
        return sh
    fr, w, f, Dk = xg.frontage, xg.width_m, xg.flare_m, xg.kerb_offset_m
    avail, gw, ex = xg.avail_m, xg.band_w_m, ST.REF.band_extra_m
    sa, sb, sc0 = xg.centre_s - w / 2, xg.centre_s + w / 2, xg.centre_s
    sgn = -1.0 if (fr.u[0] * fr.n[1] - fr.u[1] * fr.n[0]) > 0 else 1.0          # road at the bottom of the sheet, no mirroring
    PX0, PX1, PY0, PY1 = CONTENT_X0, 566.0, CONTENT_Y0 + 2.0, CONTENT_Y1 - 2.0
    half = w / 2 + f + ex + 1.6
    t_lo, t_hi = -2.2, Dk + 2.0
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
    dim_best(v, M(sc0 - drive_w / 2, t_lo), M(sc0 + drive_w / 2, t_lo), f"DRIVEWAY WIDTH {CX._fmt_m(drive_w)}{wid_ph}", (9.0, 16.0), (up,), 2.8, [])
    dim_best(v, M(sa, 0), M(sb, 0), f"LAYOVER WIDTH AT BOUNDARY {CX._fmt_m(w)}{wid_ph}", (14.0, 22.0), (up, down), 2.8, [])
    dim_best(v, M(sa - f, avail), M(sb + f, avail), f"LAYOVER WIDTH AT KERB {CX._fmt_m(w + 2 * f)}{flare_ph}", (gw * k + 16.0, gw * k + 24.0), (down,), 2.8, [])
    dim_best(v, M(sb, avail), M(sb + f, avail), f"FLARE {CX._fmt_m(f)}{flare_ph}", (gw * k + 7.0, gw * k + 11.0), (down,), 2.8, [])
    s_e = sa if sgn > 0 else sb
    dim_best(v, M(s_e, xg.body_len_m), M(s_e, avail), f"WING LENGTH {CX._fmt_m(xg.wing_len_m)}{PH}", (f * k + 9.0, f * k + 16.0), (left,), 2.8, [])
    s_l = sc0 - sgn * (w / 2 + f + ex + 0.3)
    dim_best(v, M(s_l, 0), M(s_l, Dk), f"BOUNDARY TO KERB {CX._fmt_m(Dk)}", (9.0, 16.0), (left,), 2.8, [])
    s_r = sc0 + sgn * (w / 2 + f + ex)
    dim_best(v, M(s_r, Dk - gw), M(s_r, Dk), f"KERB AND GUTTER BAND {CX._fmt_m(gw)}{PH}", (9.0, 15.0), ((1.0, 0.0),), 2.8, [])
    # labels, each at the first free spot ----------------------------------------------------------------------------------------------------
    def put(txt, cands, h=2.6, **kw):
        for x, y, anc in cands:
            if v.label(x, y, txt, h, 0.0, anc, nudges=False, **kw):
                return True
        v.fallback_notes.append(txt)
        return False

    kerb_src = "USER INPUT" if xg.kerb_source == "USER INPUT" else "PLATFORM DEFAULT"
    lot_txt = f"LOT {s.inp.lot.lotplan.replace('//', ' ')} (SUBJECT LOT)".upper()
    put(lot_txt, [(xl + 3, yt - 3, "TOP_LEFT")], 3.0, bold=True, color=None, halo=True)
    if front is not None:
        ltr = "LEFT TO RIGHT" if sgn > 0 else "RIGHT TO LEFT"
        put(f"FRONT BOUNDARY: BEARING {front.bearing_dms}  {CX.frontage_length_m(front):.2f}m ({ltr}, CADASTRE)", [(xr - 3, M(0, 0)[1] + 3.0 + d, "BOTTOM_RIGHT") for d in (0, 4, 8)], halo=True)
    put(("BOUNDARY FROM THE SITE DATA FOLDER: NOT A SURVEY" if s.inp.boundary_source else "BOUNDARY FROM CADASTRE: NOT A SURVEY"), [(xr - 3, M(0, 0)[1] - 3.0 - d, "TOP_RIGHT") for d in (0, 4, 8)], 2.4, halo=True)
    put(f"VERGE (ASSUMED, NOT SURVEYED; {kerb_src})", [(xr - 3, M(0, Dk / 2)[1] + d, "MIDDLE_RIGHT") for d in (0, 6, -6, 12)], halo=True)
    put("ROAD (ASSUMED PAVEMENT EXTENT)", [(xl + 3, M(0, Dk + 1.0)[1] + d, "MIDDLE_LEFT") for d in (0, -5, 5, 10)], halo=True)
    CO.place_callout(v, ["KERB AND GUTTER BAND", CX.KERB_ASSUMED_TEXT], M(s_r + sgn * 0.5, Dk - gw / 2), "arrow", keep, must=True)
    CO.place_callout(v, ["PROPOSED LAYOVER (VEHICLE CROSSING)", CX.standard_text(std)], M(sc0 + sgn * w * 0.25, xg.body_len_m * 0.6), "dot", keep, must=True)
    # right column: statement, schedule, typical cross section -------------------------------------------------------------------------------
    RX0, RX1 = 574.0, 828.0
    y = 580.0
    stmt = fonts.wrap(CX.LAYOVER_STANDARD_NOTE, 2.6, RX1 - RX0 - 6, True)
    hh = 10.0 + 3.6 * len(stmt)
    P.poly([(RX0, y - hh), (RX1, y - hh), (RX1, y), (RX0, y)], "C-DATA-NONE", ST.WHITE, edge=RED, edge_lw=0.4)
    P.text(RX0 + 2, y - 1.5, "COUNCIL STANDARD NOT SELECTED", 2.8, "TOP_LEFT", bold=True, color=RED, layer="C-DATA-NONE")
    for i, t in enumerate(stmt):
        P.text(RX0 + 2, y - 7.0 - 3.6 * i, t, 2.6, "TOP_LEFT", bold=True, color=RED, layer="C-DATA-NONE")
    y -= hh + 5
    vals = CX.layover_values(xg, front)
    th = 9.0 + 6.4 * (len(vals) + (1 if front is not None else 0))
    P.poly([(RX0, y - th), (RX1, y - th), (RX1, y), (RX0, y)], "C-ANNO-TABL", ST.WHITE, edge=ST.BLACK, edge_lw=0.25)
    P.text(RX0 + 2, y - 1.5, "LAYOVER DIMENSION SCHEDULE", 2.8, "TOP_LEFT", bold=True)
    yy = y - 9.0
    for r in vals:
        P.line([(RX0, yy + 3.2), (RX1, yy + 3.2)], "C-ANNO-TABL", 0.08, ST.GRID)
        P.text(RX0 + 2, yy, r["label"], 2.3, "MIDDLE_LEFT")
        P.text(RX0 + 88, yy, CX._fmt_m(r["m"]), 2.3, "MIDDLE_LEFT", bold=True)
        P.text(RX0 + 104, yy, CX.PLACEHOLDER_TAG if r["placeholder"] else r["src"], 2.1, "MIDDLE_LEFT", color=RED if r["placeholder"] else None)
        yy -= 6.4
    if front is not None:
        P.line([(RX0, yy + 3.2), (RX1, yy + 3.2)], "C-ANNO-TABL", 0.08, ST.GRID)
        P.text(RX0 + 2, yy, "FRONTAGE BEARING", 2.3, "MIDDLE_LEFT")
        P.text(RX0 + 88, yy, f"{front.bearing_dms}  {CX.frontage_length_m(front):.2f}m", 2.3, "MIDDLE_LEFT", bold=True)
        P.text(RX0 + 160, yy, CX.FRONTAGE_SOURCE, 2.1, "MIDDLE_LEFT")
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
    sh.notes = _dedupe(notes)
    sh.tag_notes = list(v.fallback_notes)
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
        lines = fonts.wrap(txt, 2.4, 52.0)
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


def c500(ctx: RefCtx) -> Sheet:
    s = ctx.site
    out = s.esc
    rows = [] if out is not None else ([f"ESC LAYOUT NOT DRAWN: {s.inp.esc_unavailable_reason}"] if s.inp.esc_unavailable_reason else
                                       ["ESCP DATA PENDING: the SA10 erosion and sediment control layout was not available in this run; controls will be drawn when SA10 output is supplied"])
    notes = ["ESCP TO BE REVIEWED AND CERTIFIED BY A SUITABLY QUALIFIED PERSON", (PH.sentence(s.cites, "esc.escp.prepared_by_suitably_qualified_person") or "")]
    b = start(ctx, "C500", rows, notes)
    v = b.v
    draw_xover(b, "proposed")
    pend = []
    conflict = esc_flow_conflict(s, out) if out is not None else None
    if out is not None:
        from shapely import wkt as swkt
        for el in out.elements:
            g = swkt.loads(el.geometry_wkt)
            v.geom(g, el.layer, lw=0.4)
            if g.geom_type in ("Polygon", "MultiPolygon"):
                v.fill(g, el.layer, (0.4, 0.7, 0.4), 0.35)
            pend.append((el, g))
    finish(b, "EROSION AND SEDIMENT CONTROL")
    if out is not None:
        dem = dem_fall(s)
        flags, basis = [], []
        if conflict:
            flags.append(f"SA10 FLOW BEARING {conflict['sa10']:.0f} DEG ({'ASSUMED TOWARDS THE ROAD, NO LEVELS PASSED TO SA10' if conflict['assumed'] else 'FROM ITS OWN INPUT'}) DOES NOT MATCH THE DEM FALL "
                         f"BEARING {conflict['dem']:.0f} DEG (DIFFERENCE {conflict['diff']:.0f} DEG). FENCES AND DIVERSION MAY NOT SIT ON THE LOW SIDE: RE-RUN OR CHECK BEFORE USE. DOWNSLOPE LABELS REMOVED.")
        sh_ = esc_access_shortfall(s, out)
        if sh_:
            flags.append(f"STABILISED ACCESS DRAWN {sh_[0]:.1f}m LONG, SHORTER THAN THE CITED {PH.num(sh_[2])} {PH.short_ref(sh_[2])}: THE LOT DOES NOT ALLOW THE CITED LENGTH IN THIS LAYOUT. TO BE RESOLVED BY THE ESCP PREPARER.")
        for w in out.warnings:
            (flags if "not drawn" in w.lower() else basis).append(_up(w))
        if dem:
            basis.insert(0, f"LOT FALL {dem['pct']:.1f} PERCENT TOWARDS BEARING {dem['bearing']:.0f} DEG (INDICATIVE, {s.dem_label}, PLANE FIT TO {dem.get('n', 0)} LEVELS)")
        elif out.flow.assumed:
            basis.insert(0, f"FALL DIRECTION ASSUMED TOWARDS THE ROAD (BEARING {out.flow.bearing_deg:.0f} DEG): NO LEVELS AVAILABLE TO THE ESCP LAYOUT")
        basis.append(f"ELEMENTS FROM SA10: {len(out.elements)} (INDICATIVE LAYOUT, TO BE CONFIRMED BY THE ESCP PREPARER)")
        basis += [_up(x) for x in list(out.assumptions[:2])]
        if flags:
            text_panel(b, "ESC FLAGS", flags, 130.0, warn=True)
        text_panel(b, "ESC LAYOUT BASIS AND ASSUMPTIONS", basis, 150.0)
    CX.callouts_crossover(v, b.xg, b.std, b.keep, [], [s.lot], kerb_only=True, short_kerb=True, must_avoid=list(getattr(b, 'kerb_geoms', [])))
    pave_callout(b)
    if out is not None:                                                          # one boxed call-out with a leader per element, boxes off the control geometry
        ctl = [g.buffer(0.6 / v.k * 2) if g.geom_type != "Point" else g for _e, g in pend]
        for el, g in sorted(pend, key=lambda eg: ESC_ORDER.get(eg[0].kind, 9)):
            pm = any("not supplied" in n.lower() and "pit" in n.lower() for n in el.notes)
            place(b, _esc_lines(el, out, conflict, pm), _esc_target(g), "dot", must=True, avoid=list(b.hard) + ctl)
    return seal(b)


# ====================================================================================================== C600 typical details
CONTENT_X0, CONTENT_X1 = VIEW_RECT[0] + 4.0, VIEW_RECT[2] - 4.0
CONTENT_Y0, CONTENT_Y1 = STRIP_RECT[3] + 4.0, VIEW_RECT[3] - 4.0         # drawing content area: above the title strip, inside the frame


def _footer(P, r: tuple, lines, h: float = 2.2) -> None:
    """Cited values and TBC statements at the bottom of a detail box (stacked upward from the box bottom, wrapped, never past the box)."""
    y = r[1] + 3.0
    for ln in reversed([x for x in lines if x]):
        wr = fonts.wrap(ST.clean(ln).upper(), h, r[2] - r[0] - 8.0)
        for w in reversed(wr):
            P.text(r[0] + 4.0, y, w, h, "BOTTOM_LEFT", layer="C-ANNO-NOTE", color=RED if ("TBC" in w or "UNRESOLVED" in w) else None)
            y += h + 1.0
        y += 0.8


def c600(ctx: RefCtx) -> Sheet:
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
        ("2", SEC.detail_access, [cl("esc.access.min_length_m", "Min length"), cl("esc.access.min_width_m", "Min width"), cl("esc.access.thickness_mm", "Thickness"),
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
        P.text(r[0] + 1.2, r[3] - 1.2, num, 2.4, "TOP_LEFT", bold=True, layer="C-ANNO-NOTE", color=RED)
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


# ====================================================================================================== C001 general notes (sheet 2)
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
    """General notes for the LGA: the AI statement in a red banner, grouped notes under dark heading bars, numbered, flowed over three columns on A1
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
    ai = None
    if groups and groups[0][1] and groups[0][1][0] == LN.AI_STATEMENT:      # the AI statement is carried by the banner (not repeated as a numbered note)
        ai = LN.AI_STATEMENT
        groups = [(groups[0][0], groups[0][1][1:])] + list(groups[1:])
    title = f"GENERAL NOTES FOR {council}"
    P.text(CONTENT_X0, CONTENT_Y1 - 1.0, title, 4.6, "TOP_LEFT", bold=True, layer="C-ANNO-NOTE")
    P.line([(CONTENT_X0, CONTENT_Y1 - 7.6), (CONTENT_X0 + fonts.text_width(title, 4.6, True), CONTENT_Y1 - 7.6)], "C-ANNO-NOTE", 0.7, (0.80, 0.08, 0.08))
    ytop = CONTENT_Y1 - 12.0
    if ai:                                                             # banner: the one statement every reader must see first
        wr = fonts.wrap(ai, 3.6, CONTENT_X1 - CONTENT_X0 - 10.0, True)
        bh = 5.0 + 5.0 * len(wr)
        P.poly([(CONTENT_X0, ytop - bh), (CONTENT_X1, ytop - bh), (CONTENT_X1, ytop), (CONTENT_X0, ytop)], "C-DATA-NONE", (1.0, 0.96, 0.96), edge=RED, edge_lw=0.5)
        for k, w in enumerate(wr):
            P.text(CONTENT_X0 + 5.0, ytop - 3.2 - 5.0 * k, w, 3.6, "TOP_LEFT", bold=True, color=RED, layer="C-DATA-NONE")
        ytop -= bh + 5.0
    from app.agents.sa5_cad_dxf.planset import legend as LG
    lg_cols, lg_pitch = 3, 11.0
    lg_h = LG.legend_height(lg_cols, lg_pitch)
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
    LG.draw_legend(v, CONTENT_X0, CONTENT_Y0 + lg_h, CONTENT_X1 - CONTENT_X0, lg_cols, lg_pitch,
                   contour_label=(f"EXISTING CONTOUR ({s.dem_label}, INDICATIVE)" if s.inp.terrain_label else None),
                   boundary_label=("PROPERTY BOUNDARY (SITE DATA FOLDER, NOT A SURVEY)" if s.inp.boundary_source else None))
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
    cap = _spaced("CIVIL SITE PLANNING DRAWINGS") + "   " + _spaced("(AI GENERATED DRAFT)")
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
    wlines = lambda notes: [w for n in notes for w in fonts.wrap(ST.clean(n).upper(), 2.4, r[2] - r[0] - 12.0)]   # noqa: E731
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
    lv.reserve((vr[2] - 40.0, vr[3] - 40.0, vr[2], vr[3]))
    lv.reserve((vr[0], vr[1], vr[0] + 30.0, vr[1] + 12.0))
    lot_labels(lv, s)
    D.road_names(lv, s)
    ST.north_point(lv, vr[2] - 22.0, vr[3] - 24.0, 9.0, (-lv.twist) % 360.0)
    ST.Paper(lv).text(vr[0] + 3.0, vr[1] + 4.0, "NTS", 3.4, "BOTTOM_LEFT", bold=True, layer="C-ANNO-NOTE")
    if dc_lines:                                                                 # DCDB incomplete or not checked: said on the panel, never left to read as clear
        for k_, ln in enumerate(dc_lines):
            P.text(r[0] + 5.0, r[1] + 3.0 + 3.6 * (len(dc_lines) - 1 - k_) + 1.5, ln, 2.4, "BOTTOM_LEFT", color=RED, layer="C-DATA-NONE")
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
        v.text(x, y - rh / 2, t, 2.8, a, bold=True, color=ST.WHITE, layer="C-ANNO-TABL")
    y -= rh
    allsheets = [sh] + [x for x in sheets if x.number != "C000"]
    for i, x in enumerate(allsheets):
        if i % 2 == 0:
            v.fill(Polygon([(rx0, y - rh), (rx1, y - rh), (rx1, y), (rx0, y)]), "C-ANNO-TABL", (0.93, 0.93, 0.93), 1.0, anno=True)
        v.line([(rx0, y - rh), (rx1, y - rh)], "C-ANNO-TABL", False, 0.1, color=ST.GRID)
        v.text(rx0 + 3.0, y - rh / 2, codes.drawing_number(x.number, pj.job), 2.8, "MIDDLE_LEFT", layer="C-ANNO-TABL")
        v.text(c1 + 3.0, y - rh / 2, ST.clean(x.title).upper(), 2.8, "MIDDLE_LEFT", layer="C-ANNO-TABL")
        v.text((c2 + rx1) / 2, y - rh / 2, ST.clean(x.revision), 2.8, "MIDDLE_CENTER", layer="C-ANNO-TABL")
        y -= rh
    v.line([(rx0, y), (rx1, y), (rx1, top - 9.0), (rx0, top - 9.0)], "C-ANNO-TABL", False, 0.25)
    for x in (c1, c2):
        v.line([(x, y), (x, top - 9.0)], "C-ANNO-TABL", False, 0.15, color=ST.GRID)
    v.line([(rx0, y), (rx0, top - 9.0)], "C-ANNO-TABL", False, 0.25)
    # ---- DATA SOURCES AND STATUS: what this set is built from (each line follows the data actually supplied) --------------------------------------
    yb = y - 12.0
    src = [("CADASTRE", (f"SUBJECT LOT FROM {s.inp.boundary_source}. NOT A SURVEY. NO ADJOINING LOT OR ROAD DATA WAS QUERIED." if s.inp.boundary_source
                         else "STATE CADASTRE (DCDB). BOUNDARIES, LOT NUMBERS AND PLAN NUMBERS ARE NOT A SURVEY.")),
           ("LEVELS", (f"{s.dem_label}, INDICATIVE ONLY. DETAIL SURVEY AT THE DETAILED DESIGN STAGE." + (f" {s.accuracy_sentence}." if s.inp.terrain_label else "")) if s.tin is not None else "NO LEVELS SUPPLIED: NOT DRAWN."),
           ("AERIAL", ST.clean(s.aerial_site.note).upper() if s.aerial_site is not None else "NO AERIAL IMAGE SUPPLIED."),
           ("SERVICES", "SUPPLIED SERVICES ARE DRAWN AS SUPPLIED (INDICATIVE)." if s.inp.services else
            ((s.inp.byda.headline + ". NO SERVICE IS DRAWN.") if s.inp.byda is not None else "NONE SUPPLIED: LOCATE BY DIAL BEFORE YOU DIG AND POTHOLING.")),
           ("ASSUMED ITEMS", "KERB, ROAD EXTENT AND LAYOVER VALUES ARE ASSUMED OR PLACEHOLDERS WHERE MARKED."),
           ("CODES", "DRAWING NUMBER JCS-{JOB}-CIV-{NNN}. LAYERS JCS-{DISCIPLINE}-{ELEMENT}-{TYPE}, THE SAME IN THE DXF."),
           ("BUILDING", "NOT PART OF THIS SET: NO BUILDING FOOTPRINT, SETBACK OR FLOOR LEVEL IS DRAWN.")]
    rows_ = []
    for k_, t_ in src:
        rows_.append((k_, fonts.wrap(t_, 2.6, rx1 - rx0 - 46.0)))
    hbox = 12.0 + sum(len(w) * 3.9 + 2.2 for _k, w in rows_)
    if yb - hbox > 104.0:
        P.line([(rx0, yb - hbox), (rx1, yb - hbox), (rx1, yb), (rx0, yb)], "C-ANNO-TABL", 0.35, ST.BLACK, closed=True)
        v.text(rx0 + 4.0, yb - 3.0, "DATA SOURCES AND STATUS", 4.0, "TOP_LEFT", bold=True, layer="C-ANNO-TABL")
        yy_ = yb - 14.0
        for k_, w in rows_:
            v.text(rx0 + 4.0, yy_, k_, 2.6, "TOP_LEFT", bold=True, layer="C-ANNO-TABL")
            for i_, ln in enumerate(w):
                v.text(rx0 + 42.0, yy_ - 3.9 * i_, ln, 2.6, "TOP_LEFT", layer="C-ANNO-TABL")
            yy_ -= len(w) * 3.9 + 2.2
    sh.notes = ["PRELIMINARY ISSUE: NOT FOR CONSTRUCTION"]
    return sh
