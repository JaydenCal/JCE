"""Council typical details drawn from typicals.json (planset/typicals.py): the vehicle crossover plan and section of the council standard drawing
(SD-107), the pavement, drainage, OSD, verge services and ESC typicals.

Rules (stage 8b): every dimension, note and clause printed here is read from ``Typicals`` and carries its citation; nothing in this module is a council
value.  The geometry is drawn proportional to the cited dimensions where the council drawing is dimensioned, and is marked NOT TO SCALE where it is
schematic (the SD-107 section is itself drawn with the vertical scale exaggerated).  An entry with confidence 0.7 or lower prints with
VERIFY AGAINST SD-107.  A value that is absent is never drawn: the detail says it is not available.  Profiles the council has not published (the
kerb and gutter profile RD003, the layback drawings RD0010 and RD011) are not drawn: the detail states that they are not published.
"""
from __future__ import annotations

import math
import re

from shapely.geometry import Polygon

from app.agents.sa5_cad_dxf.planset import fonts
from app.agents.sa5_cad_dxf.planset import sections as SEC
from app.agents.sa5_cad_dxf.planset import style as ST

TXT = ST.TXT
L_LINE, L_NOTE, L_DIM = SEC.L_LINE, SEC.L_NOTE, SEC.L_DIM
RED = (0.72, 0.1, 0.1)
H = TXT.BODY
SD = "sd107."
TITLE_SD107 = "TYPICAL VEHICLE CROSSOVER (GUNNEDAH SHIRE COUNCIL SD-107 REV A)"
RD003_TEXT = "KERB AND GUTTER PROFILE TO GSC RD003 (NOT PUBLISHED, OBTAIN FROM COUNCIL)"
LAYBACK_DWG_TEXT = "LAYBACK DRAWINGS GSC RD0010 AND RD011 (NOT PUBLISHED, OBTAIN FROM COUNCIL)"
G001_TEXT = "UTILITY LOCATION DRAWINGS GSC G001 AND G002 (NOT AVAILABLE TO THIS PLATFORM, OBTAIN FROM COUNCIL)"
CONFLICT_NOTE = ("CONFLICT IN THE COUNCIL DOCUMENTS: THE DCP (C.1.4) DOES NOT PERMIT MULTIPLE VEHICLE ACCESS POINTS AND LAYBACKS UNLESS THE LOT HAS TWO ROAD FRONTAGES, "
                 "BUT THE ENGINEERING STANDARDS (TABLE 2-H) ALLOW A MAXIMUM OF 2 CROSSINGS PER STREET FRONTAGE. ONE CROSSING IS DRAWN; COUNCIL TO CONFIRM BEFORE A SECOND IS PROPOSED")


# ------------------------------------------------------------------------------------------------------------------------- helpers
class Fr:
    """Real-world millimetres (x right, y up) to paper mm: origin (ox, oy) on the sheet, k paper mm per real mm (kx, ky when the vertical is exaggerated)."""

    def __init__(self, ox: float, oy: float, kx: float, ky: float | None = None):
        self.ox, self.oy, self.kx, self.ky = ox, oy, kx, kx if ky is None else ky

    def p(self, x: float, y: float) -> tuple[float, float]:
        return (self.ox + x * self.kx, self.oy + y * self.ky)


def n0(v) -> str:
    """Number without a trailing .0."""
    return f"{int(v)}" if float(v) == int(v) else f"{v:g}"


def mmv(T, key: str):
    """mm value of a typical, or None."""
    t = T.get(key)
    return None if t is None else t.mm


def rng(T, kmin: str, kmax: str):
    a, b = mmv(T, kmin), mmv(T, kmax)
    return None if a is None or b is None else (a, b)


def vtag(T, *keys: str) -> str:
    """' VERIFY AGAINST SD-107' when any key is flagged verify, else ''."""
    for k in keys:
        t = T.get(k)
        if t is not None and t.verify:
            return " VERIFY AGAINST SD-107"
    return ""


def tx(P, x, y, s, h=H, anchor="MIDDLE_CENTER", rot=0.0, bold=False, color=None, halo=False):
    P.text(x, y, s, h, anchor, rot, bold, color=color, layer=L_NOTE, halo=halo)


def para(P, x, y_top, w, text, h=H, color=None, bold=False, gap: float = 0.9, lead: float = 1.0) -> float:
    """Wrapped UPPERCASE paragraph from the top-left (x, y_top); returns the y below it."""
    for ln in fonts.wrap(ST.clean(text).upper(), h, w, bold):
        P.text(x, y_top, ln, h, "TOP_LEFT", bold=bold, color=color, layer=L_NOTE)
        y_top -= h + lead
    return y_top - gap


def bullets(P, x, y_top, w, lines, h=H, color=None, y_min: float | None = None) -> float:
    """List of paragraphs with a dot bullet; stops (returning the y where it stopped) before y_min."""
    for t in lines:
        col = RED if (color is None and ("VERIFY" in t or "NOT PUBLISHED" in t or "NOT AVAILABLE" in t)) else color
        wr = fonts.wrap(ST.clean(t).upper(), h, w - 3.5)
        if y_min is not None and y_top - len(wr) * (h + 1.0) < y_min:
            return y_top
        for i, ln in enumerate(wr):
            if i == 0:
                P.circle(x + 0.8, y_top - h * 0.55, 0.45, L_NOTE, 0.2, ST.BLACK, fill=ST.BLACK)                  # bullet dot (a typed hyphen would read as a spaced dash)
            P.text(x + 3.5, y_top, ln, h, "TOP_LEFT", color=col, layer=L_NOTE)
            y_top -= h + 1.0
        y_top -= 0.9
    return y_top


def cite_lines(T, keys, h=H) -> list[str]:
    """'VALUE [DOCUMENT, CLAUSE, p.N]' per key that resolves (citation printed with the value)."""
    out = []
    for k in keys:
        t = T.get(k)
        if t is not None:
            out.append(f"{t.vtext if t.unit else t.value} [{t.ref}]" + (f" {t.tag}" if t.verify else ""))
    return out


def arrow_dim_h(P, y, x0, x1, text, h=H, above=True, color=None, ext_from=None):
    """Horizontal dimension with 45 degree ticks; text above or below the line."""
    P.line([(x0, y), (x1, y)], L_DIM, 0.2)
    for x in (x0, x1):
        P.line([(x - 1.0, y - 1.0), (x + 1.0, y + 1.0)], L_DIM, 0.3)
        if ext_from is not None:
            P.line([(x, ext_from), (x, y + (1.5 if y > ext_from else -1.5))], L_DIM, 0.1, ST.GRID)
    P.text((x0 + x1) / 2, y + (1.0 if above else -1.0), text, h, "BOTTOM_CENTER" if above else "TOP_CENTER", color=color, layer=L_DIM)


def arrow_dim_v(P, x, y0, y1, text, side=1, h=H, color=None, ext_to=None):
    P.line([(x, y0), (x, y1)], L_DIM, 0.2)
    for y in (y0, y1):
        P.line([(x - 1.0, y - 1.0), (x + 1.0, y + 1.0)], L_DIM, 0.3)
        if ext_to is not None:
            P.line([(ext_to, y), (x + (1.5 if x > ext_to else -1.5), y)], L_DIM, 0.1, ST.GRID)
    P.text(x + side * 1.8, (y0 + y1) / 2, text, h, "MIDDLE_LEFT" if side > 0 else "MIDDLE_RIGHT", color=color, layer=L_DIM)


def leader(P, pt_from, pt_to, dot=True):
    P.line([pt_from, pt_to], L_NOTE, 0.2)
    if dot:
        P.circle(pt_to[0], pt_to[1], 0.6, L_NOTE, 0.2, ST.BLACK, ST.BLACK)


def label_box(P, x, y_top, w, lines, h=H, bold_first=False, border=True, color=None):
    """Boxed UPPERCASE call-out text from the top-left; returns (x0, y0, x1, y1).  Lines are wrapped to w."""
    wr = []
    for i, ln in enumerate(lines):
        wr += fonts.wrap(ST.clean(ln).upper(), h, w - 3.0, bold_first and i == 0)
    bh = 2.6 + (h + 1.0) * len(wr)
    tw = max((fonts.text_width(t, h) for t in wr), default=10.0)
    bw = min(w, tw + 3.4)
    if border:
        P.poly([(x, y_top - bh), (x + bw, y_top - bh), (x + bw, y_top), (x, y_top)], L_NOTE, ST.WHITE, edge=ST.BLACK, edge_lw=0.2)
    n_first = len(fonts.wrap(ST.clean(lines[0]).upper(), h, w - 3.0, True)) if lines and bold_first else 0
    for i, t in enumerate(wr):
        P.text(x + 1.6, y_top - 1.4 - (h + 1.0) * i, t, h, "TOP_LEFT", bold=i < n_first, color=color or (RED if "VERIFY" in t else None), layer=L_NOTE)
    return (x, y_top - bh, x + bw, y_top)


def not_available(P, r, what: str) -> None:
    x0, y0, x1, y1 = r
    P.line([(x0 + 6, y0 + 6), (x1 - 6, y0 + 6), (x1 - 6, y1 - 24), (x0 + 6, y1 - 24)], L_NOTE, 0.25, RED, dash="DASHED", closed=True)
    para(P, x0 + 10, y1 - 30, x1 - x0 - 20, "DATA NOT AVAILABLE: " + what, color=RED, bold=True)


def detail_title(P, r, text, sub=""):
    """Detail title (bold, red rule) at the top-left of the cell r; returns the y below it."""
    return SEC.title(None, P, r[0], r[3], r[2] - r[0], text, sub)


def footer(P, r, lines, h=H) -> float:
    """Citation and status lines stacked upward from the bottom of the cell (never past the cell width); returns the top y of the stack."""
    y = r[1] + 2.5
    for ln in reversed([x for x in lines if x]):
        wr = fonts.wrap(ST.clean(ln).upper(), h, r[2] - r[0] - 7.0)
        for w in reversed(wr):
            P.text(r[0] + 3.5, y, w, h, "BOTTOM_LEFT", color=RED if ("VERIFY" in w or "NOT PUBLISHED" in w or "NOT AVAILABLE" in w or "CONFLICT" in w) else None, layer=L_NOTE)
            y += h + 1.0
        y += 0.7
    return y


# ------------------------------------------------------------------------------------------------------------------------- SD-107 plan
def crossing_dims(T) -> dict | None:
    """The cited plan dimensions (mm) or None when any is absent."""
    keys = dict(wmin="crossing.width_at_property_boundary_min", wmax="crossing.width_at_property_boundary_max", splay="layback.splay_length_along_kerb_each_side",
                depth="layback.splay_depth_back_of_layback_to_lip_line", lip="layback.lip_line_to_nominal_kerb_line", run="layback.run_behind_nominal_kerb_line",
                road="gutter_crossing.width_each_side_of_nominal_kerb_line", omin="crossing.overall_width_at_kerb_incl_splays_min", omax="crossing.overall_width_at_kerb_incl_splays_max")
    out = {}
    for f, k in keys.items():
        v = mmv(T, SD + k)
        if v is None:
            return None
        out[f] = v
    return out


def sd107_plan(P, T, r, plan_len_mm: float = 3000.0) -> dict:
    """SD-107 PLAN of the vehicle crossing in the cell r (paper mm), dimensions from the data.  Returns {'k': scale, 'frame': Fr, 'foot': [lines]}."""
    x0, y0, x1, y1 = r
    yb = detail_title(P, r, TITLE_SD107, "PLAN. GSC SD-107 REV A. DIMENSIONS IN MILLIMETRES, DO NOT SCALE")
    d = crossing_dims(T)
    if d is None:
        not_available(P, r, "THE SD-107 CROSSING DIMENSIONS ARE NOT IN THE COUNCIL DATA")
        return {}
    w = d["wmin"]                                                              # drawn at the minimum width; the 3000 MIN / 4500 MAX string is as SD-107
    run, lip, depth, splay, road = d["run"], d["lip"], d["depth"], d["splay"], d["road"]
    ov = w + 2 * splay
    foot_mm = 1200.0
    rx = (-ov / 2 - 1100.0, ov / 2 + 1100.0)                                    # footpath overhangs the slab each side
    ytop = run + plan_len_mm                                                   # property boundary
    ybot = -road
    W = x1 - x0
    avail_w = W - 2 * 50.0                                                     # text columns each side
    avail_h = (yb - 22.0) - (y0 + 44.0)                                        # below the title and the dimension string above the boundary, above the footer and the dimension strings below
    k = min(avail_w / (rx[1] - rx[0]), avail_h / (ytop - ybot))
    F = Fr((x0 + x1) / 2, (yb - 22.0) - ytop * k, k)
    sa, sb = -w / 2, w / 2
    # ---- existing kerb and gutter (outside the crossing), nominal kerb line and the road-side edge line --------------------------------------
    xl, xr = F.p(rx[0], 0)[0], F.p(rx[1], 0)[0]
    xs_l, xs_r = F.p(sa - splay, 0)[0], F.p(sb + splay, 0)[0]
    for yy in (lip, 0.0):
        P.line([(xl, F.p(0, yy)[1]), (xs_l, F.p(0, yy)[1])], L_LINE, 0.35, ST.BLACK)
        P.line([(xs_r, F.p(0, yy)[1]), (xr, F.p(0, yy)[1])], L_LINE, 0.35, ST.BLACK)
    P.line([(xl, F.p(0, ybot)[1]), (xr, F.p(0, ybot)[1])], L_LINE, 0.35, ST.BLACK)
    P.line([(xl, F.p(0, 0)[1]), (xr, F.p(0, 0)[1])], L_LINE, 0.15, ST.GRID, dash="DASHDOT")      # nominal kerb line datum
    yz = F.p(0, lip / 2)[1]
    P.line([(xl + 1.5, yz - 5), (xl + 3.0, yz - 1.5), (xl, yz + 1.5), (xl + 1.5, yz + 5)], L_LINE, 0.3)       # break line at the left end of the existing kerb
    # ---- slab outline: sides, splays, back of layback (E.J.) -----------------------------------------------------------------------------------
    pa, pb = F.p(sa, run), F.p(sb, run)
    p_sa, p_sb = F.p(sa - splay, lip), F.p(sb + splay, lip)
    slab = [F.p(sa, ytop), F.p(sb, ytop), pb, p_sb, F.p(sb + splay, ybot), F.p(sa - splay, ybot), p_sa, pa]
    P.poly(slab, L_LINE, (0.93, 0.93, 0.93), edge=ST.BLACK, edge_lw=0.45)
    # the stipple is drawn on the slab for concrete (same AR-CONC as the plan sheets)
    P.v.fill(Polygon(slab), "C-DETL-LINE", (0.9, 0.9, 0.9), 1.0, None, None, True, pattern="AR-CONC", edge=ST.BLACK, edge_lw=0.45, stipple=ST.LIGHT_STIPPLE_MM * 0.8)
    P.line([pa, pb], L_LINE, 0.7, ST.BLACK)                                                              # expansion joint at the back of the layback
    # ---- footpath (existing) with the slab through it and an E.J. each side -------------------------------------------------------------------
    fy1, fy0 = ytop - 300.0, ytop - 300.0 - foot_mm
    fl, fr_ = F.p(rx[0] + 200.0, 0)[0], F.p(rx[1] - 200.0, 0)[0]
    P.line([(fl, F.p(0, fy1)[1]), (F.p(sa, 0)[0], F.p(0, fy1)[1])], L_LINE, 0.35, ST.BLACK)
    P.line([(fl, F.p(0, fy0)[1]), (F.p(sa, 0)[0], F.p(0, fy0)[1])], L_LINE, 0.35, ST.BLACK)
    P.line([(F.p(sb, 0)[0], F.p(0, fy1)[1]), (fr_, F.p(0, fy1)[1])], L_LINE, 0.35, ST.BLACK)
    P.line([(F.p(sb, 0)[0], F.p(0, fy0)[1]), (fr_, F.p(0, fy0)[1])], L_LINE, 0.35, ST.BLACK)
    for xe, sgn in ((fl, 1), (fr_, -1)):                                                                 # zigzag break at the footpath ends
        ym = (F.p(0, fy1)[1] + F.p(0, fy0)[1]) / 2
        P.line([(xe, F.p(0, fy1)[1]), (xe + sgn * 2.0, ym + 1.5), (xe - sgn * 0.0, ym), (xe + sgn * 2.0, ym - 1.5), (xe, F.p(0, fy0)[1])], L_LINE, 0.3)
    ym = (F.p(0, fy1)[1] + F.p(0, fy0)[1]) / 2
    tx(P, F.p(sa, 0)[0] - 1.6, ym, "E.J.", rot=90.0, anchor="MIDDLE_CENTER")
    tx(P, F.p(sb, 0)[0] - 1.6, ym, "E.J.", rot=90.0, anchor="MIDDLE_CENTER")
    # ---- property boundary --------------------------------------------------------------------------------------------------------------------
    yq = F.p(0, ytop)[1]
    P.line([(xl, yq), (xr, yq)], L_LINE, 0.4, ST.BLACK, dash="DASHDOT")
    tx(P, xl + 1.0, yq + 1.4, "PROPERTY BOUNDARY", anchor="BOTTOM_LEFT")
    # ---- contraction joint (centred, double driveways) and E.J. dowel ticks -------------------------------------------------------------------
    xc = F.p(0, 0)[0]
    P.line([(xc, yq), (xc, F.p(0, run)[1])], L_LINE, 0.3, ST.BLACK, dash="DASHED")
    tx(P, xc - 2.6, (yq + F.p(0, run)[1]) / 2, "C.J. REFER NOTE 8", rot=90.0, halo=True)
    n_t = int(w // 300.0)
    for i in range(n_t + 1):
        xt = F.p(sa + i * (w / n_t), 0)[0] if n_t else xc
        P.line([(xt, F.p(0, run)[1]), (xt, F.p(0, run)[1] + 130.0 * k * 1.0 + 1.5)], L_LINE, 0.3, ST.BLACK)
    tx(P, xc, F.p(0, (run + lip) / 2)[1] - 0.8, "E.J. REFER NOTE 7", halo=True)
    # ---- saw cut across the existing kerb and gutter, R16 bars at 400 centres --------------------------------------------------------------------
    for xs, sgn in ((xs_l, -1), (xs_r, 1)):
        for yy in (lip * 0.5, -road * 0.5):
            P.line([(xs - 2.2, F.p(0, yy)[1]), (xs + 2.2, F.p(0, yy)[1])], L_LINE, 0.4, ST.BLACK)
    # ---- dimension strings ---------------------------------------------------------------------------------------------------------------------
    ytxt = yq + 12.0
    arrow_dim_h(P, ytxt - 4.0, F.p(sa, 0)[0], F.p(sb, 0)[0], "", ext_from=yq)
    tx(P, xc, ytxt + 1.4, f"{n0(d['wmin'])} MIN", anchor="BOTTOM_CENTER")
    tx(P, xc, ytxt + 4.9, f"{n0(d['wmax'])} MAX", anchor="BOTTOM_CENTER")
    yd1 = F.p(0, ybot)[1] - 7.0
    P.line([(F.p(sa - splay, 0)[0], yd1), (F.p(sb + splay, 0)[0], yd1)], L_DIM, 0.2)
    for xx in (sa - splay, sa, sb, sb + splay):
        P.line([(F.p(xx, 0)[0], F.p(0, ybot)[1] + 1.0), (F.p(xx, 0)[0], yd1 - 1.5)], L_DIM, 0.1, ST.GRID)
        P.line([(F.p(xx, 0)[0] - 1.0, yd1 - 1.0), (F.p(xx, 0)[0] + 1.0, yd1 + 1.0)], L_DIM, 0.3)
    tx(P, (F.p(sa - splay, 0)[0] + F.p(sa, 0)[0]) / 2, yd1 + 1.2, n0(splay), anchor="BOTTOM_CENTER")
    tx(P, (F.p(sb, 0)[0] + F.p(sb + splay, 0)[0]) / 2, yd1 + 1.2, n0(splay), anchor="BOTTOM_CENTER")
    tx(P, xc, yd1 + 1.2, f"{n0(d['wmin'])} MIN", anchor="BOTTOM_CENTER")
    tx(P, xc, yd1 - 1.6, f"{n0(d['wmax'])} MAX", anchor="TOP_CENTER")
    yd2 = yd1 - 11.0
    P.line([(F.p(sa - splay, 0)[0], yd2), (F.p(sb + splay, 0)[0], yd2)], L_DIM, 0.2)
    for xx in (sa - splay, sb + splay):
        P.line([(F.p(xx, 0)[0], F.p(0, ybot)[1] + 1.0), (F.p(xx, 0)[0], yd2 - 1.5)], L_DIM, 0.1, ST.GRID)
        P.line([(F.p(xx, 0)[0] - 1.0, yd2 - 1.0), (F.p(xx, 0)[0] + 1.0, yd2 + 1.0)], L_DIM, 0.3)
    tx(P, xc, yd2 + 1.2, f"{n0(d['omin'])} MIN", anchor="BOTTOM_CENTER")
    tx(P, xc, yd2 - 1.6, f"{n0(d['omax'])} MAX", anchor="TOP_CENTER")
    xdl = F.p(sa - splay, 0)[0] - 20.0                                                                   # stacked vertical dimensions at the left
    for ya, yb_, v in ((run, lip, depth), (lip, 0.0, lip), (0.0, -road, road)):
        pa_, pb_ = F.p(0, ya)[1], F.p(0, yb_)[1]
        P.line([(xdl, pa_), (xdl, pb_)], L_DIM, 0.2)
        for yy in (pa_, pb_):
            P.line([(xdl - 1.0, yy - 1.0), (xdl + 1.0, yy + 1.0)], L_DIM, 0.3)
            P.line([(xdl + 1.2, yy), (F.p(sa - splay, 0)[0] - 1.0, yy)], L_DIM, 0.1, ST.GRID)
        tx(P, xdl - 1.6, (pa_ + pb_) / 2, n0(v), anchor="MIDDLE_RIGHT", rot=0.0)
    # ---- labels and call-outs (the council's own wording, from the data) ------------------------------------------------------------------------
    lblk = T.get(SD + "joints.bars_into_existing_kerb_and_gutter")
    txt_saw = lblk.quote[0] if lblk is not None and lblk.quote else ""
    if txt_saw:
        ybx = F.p(0, run)[1] + 30.0
        bx = label_box(P, xs_l - 48.0, ybx, 44.0, [txt_saw], border=False)
        leader(P, (xs_l - 3.0, bx[1] - 0.6), (xs_l, F.p(0, lip)[1]), dot=False)
    tn = T.get(SD + "slab.thickness_min")
    if tn is not None:
        bx2 = label_box(P, xr + 4.0, F.p(0, run + 1500)[1], 44.0, [f"{tn.vtext.split()[0]} THICK REINFORCED CONCRETE SLAB.", "REFER NOTES 9 & 10."], border=False)
        leader(P, (bx2[0] - 1.0, bx2[3] - 3.0), F.p(sb - 300.0, run + 1500))
    bx3 = label_box(P, xr + 4.0, F.p(0, fy1 + 150)[1], 44.0, ["EXISTING CONCRETE FOOTPATH: REFER NOTE 11"], border=False)
    leader(P, (bx3[0] - 1.0, bx3[1] + 3.0), F.p(sb + 700.0, fy1 - 450.0), dot=False)
    tx(P, xr + 2.0, F.p(0, 0)[1] + 1.4, "NOMINAL", anchor="BOTTOM_LEFT")
    tx(P, xr + 2.0, F.p(0, 0)[1] - 1.0, "KERB LINE", anchor="TOP_LEFT")
    # section 1 cut: circle with the arrow towards the section (as SD-107 draws it at the top)
    cx_, cy_ = xc + 28.0, ytxt + 6.0
    P.circle(cx_, cy_, 4.0, L_NOTE, 0.3, ST.BLACK)
    P.line([(cx_ - 4.0, cy_), (cx_ + 4.0, cy_)], L_NOTE, 0.25)
    tx(P, cx_, cy_ + 1.6, "1", h=H)
    P.poly([(cx_ - 4.0, cy_), (cx_ - 8.0, cy_ + 1.6), (cx_ - 8.0, cy_ - 1.6)], L_NOTE, ST.BLACK)
    return {"k": k, "frame": F, "d": d, "foot": cite_lines(T, [SD + "crossing.width_at_property_boundary_min", SD + "layback.splay_length_along_kerb_each_side"])}


# ------------------------------------------------------------------------------------------------------------------------- SD-107 section
def sd107_section(P, T, r) -> dict:
    """SD-107 SECTION 1 through the crossing (kerb on the left, property boundary on the right), vertical scale exaggerated as on the drawing."""
    x0, y0, x1, y1 = r
    yb = detail_title(P, r, TITLE_SD107, "SECTION 1. GSC SD-107 REV A. DIMENSIONS IN MILLIMETRES, VERTICAL SCALE EXAGGERATED, DO NOT SCALE")
    g = lambda k: mmv(T, SD + k)                                                  # noqa: E731
    run, road = g("layback.run_behind_nominal_kerb_line"), g("gutter_crossing.width_each_side_of_nominal_kerb_line")
    e190 = g("section.slab_thickness_at_road_side_edge_of_gutter_crossing")
    f40, r60 = g("section.gutter_crossing_fall_edge_to_flowline"), g("section.layback_top_above_road_side_edge")
    slab = g("slab.thickness_min")
    bt = T.get(SD + "slab.base_course")
    base_mm = 50.0 if bt is not None and "50" in str(bt.value) else None
    cf = T.get(SD + "crossfall.pathway_crossing")
    cover = T.get(SD + "slab.reinforcement_top_cover")
    rein = T.get(SD + "slab.reinforcement")
    if None in (run, road, e190, f40, r60, slab) or base_mm is None or cf is None or cf.rng is None:
        not_available(P, r, "THE SD-107 SECTION DIMENSIONS ARE NOT IN THE COUNCIL DATA")
        return {}
    W = x1 - x0
    x_len = 1900.0                                                                  # slab length drawn beyond the layback (pictorial: the verge width varies)
    xa, xb = -road, run + x_len
    xleft = x0 + 58.0                                                               # room for the left dimensions and the VERIFY tags
    kx = (x1 - 40.0 - xleft) / (xb - xa)
    ve = 2.0
    ky = kx * ve                                                                    # vertical exaggeration, as on SD-107 (stated in the sub-title)
    rise = 0.02 * x_len                                                             # schematic crossfall rise toward the boundary (the cited range is the label)
    sub = 60.0                                                                      # sub-grade hatch depth (graphic)
    ytop_draw = yb - 58.0                                                           # top of the slab at the boundary end
    F = Fr(xleft + road * kx, ytop_draw - (r60 + rise) * ky, kx, ky)
    # SD-107 section 1 (checked at 600 dpi): the road-side edge is level 0; the surface falls 40 straight to the flowline at the nominal kerb line, a near-vertical lip rises back to about edge
    # level with an R25 rounded arris at its top, and the layback then rises straight (60 above edge level) over the 450 run to the E.J.
    eps = 8.0                                                                       # horizontal lean of the lip, mm (graphic: the lip is near vertical)
    rr_ = float(T.get(SD + "section.flowline_radius").mm or 25.0) if T.get(SD + "section.flowline_radius") is not None else 25.0
    ang_ = math.atan2(r60, run)                                                     # slope of the layback
    t_len = rr_ * math.tan((math.pi - (math.pi / 2 + ang_ + math.atan2(eps, f40))) / 2.0)   # tangent length of the arris fillet
    cxa, cya = eps + rr_ * 0.98, -t_len * 0.98                                      # fillet centre (graphic approximation of the R25 arc)
    arc = [(cxa + rr_ * math.cos(math.radians(th)), cya + rr_ * math.sin(math.radians(th))) for th in (180.0, 160.0, 140.0, 120.0, 100.0)]
    arris_top = arc[-1]
    top = [(-road, 0.0), (0.0, -f40), (eps * 0.4, -f40 * 0.45)] + arc + [(run, r60), (xb, r60 + rise)]
    bot_edge = -e190
    bottom = [(xb, r60 + rise - slab), (run, r60 - slab), (run * 0.30, bot_edge + (r60 - slab - bot_edge) * 0.55), (-road * 0.12, bot_edge), (-road, bot_edge)]
    P.v.fill(Polygon([F.p(*q) for q in top + bottom]), "C-DETL-LINE", (0.9, 0.9, 0.9), 1.0, None, None, True, pattern="AR-CONC", edge=ST.BLACK, edge_lw=0.5, stipple=ST.LIGHT_STIPPLE_MM * 0.7)
    bb = [(q[0], q[1] - base_mm) for q in bottom]
    SEC.grey(P.v, [F.p(*q) for q in bottom] + [F.p(*q) for q in reversed(bb)], SEC.GREY_BASE)
    SEC.hatch(P.v, [F.p(*q) for q in bb] + [F.p(bb[-1][0], bb[-1][1] - sub), F.p(bb[0][0], bb[0][1] - sub)], "existing")
    P.line([F.p(*q) for q in [(run + 40.0, r60 - 35.0), (xb - 100.0, r60 + rise - 35.0)]], L_LINE, 0.9, (0.1, 0.1, 0.1), dash="DASHED")     # SL82 fabric, cover 30 to 40
    for xj, yj in ((run, r60), (xb, r60 + rise)):                                      # expansion joints: at the layback and at the boundary
        P.line([F.p(xj, yj), F.p(xj, yj - slab)], L_LINE, 1.1, ST.BLACK)
    P.line([F.p(run - 70.0, r60 - slab / 2), F.p(run + 170.0, r60 - slab / 2)], L_LINE, 0.5, ST.BLACK)          # dowel
    xk = F.p(0, 0)[0]
    ybot_hatch = F.p(0, bot_edge - base_mm - sub)[1]
    P.line([(xk, F.p(0, r60 + rise)[1] + 20.0), (xk, ybot_hatch - 2.0)], L_LINE, 0.25, ST.BLACK, dash="DASHDOT")
    # ---- dimension block above the section (arrows, gutter crossing) ---------------------------------------------------------------------------
    ytop_s = F.p(0, r60 + rise)[1]
    ya = ytop_s + 31.0
    xl_s, xr_s = F.p(xa, 0)[0] - 14.0, F.p(xb, 0)[0] + 10.0
    P.line([(xl_s, ya), (xr_s, ya)], L_DIM, 0.2)
    P.poly([(xl_s, ya), (xl_s + 2.6, ya + 0.9), (xl_s + 2.6, ya - 0.9)], L_DIM, ST.BLACK)
    P.poly([(xr_s, ya), (xr_s - 2.6, ya + 0.9), (xr_s - 2.6, ya - 0.9)], L_DIM, ST.BLACK)
    tx(P, (xl_s + xk) / 2, ya + 1.2, "CARRIAGEWAY", anchor="BOTTOM_CENTER")
    tx(P, (xk + xr_s) / 2, ya + 1.2, "FOOTPATH CROSSING", anchor="BOTTOM_CENTER")
    tx(P, xk, ya + 6.4, "NOMINAL KERB LINE", anchor="BOTTOM_CENTER")
    P.line([(xk, ya - 1.5), (xk, ya + 1.5)], L_DIM, 0.3)
    yg = ytop_s + 19.0
    arrow_dim_h(P, yg, F.p(-road, 0)[0], xk, n0(road), ext_from=F.p(0, 0)[1] + 2.0)
    arrow_dim_h(P, yg, xk, F.p(run, 0)[0], n0(run), ext_from=F.p(0, r60)[1] + 2.0)
    tx(P, xk, yg + 5.6, "GUTTER CROSSING", anchor="BOTTOM_CENTER")
    # ---- left dimensions, one column each as SD-107 draws them: 40 (fall to the flowline), 60 (layback top above the road-side edge) and 190 (concrete depth at the road-side edge) ----
    xe0 = F.p(-road, 0)[0]
    col40, col60, col190 = xe0 - 6.0, xe0 - 17.0, xe0 - 28.0
    for xcol, val, y_a, y_b, key, xto in ((col40, f40, -f40, 0.0, "section.gutter_crossing_fall_edge_to_flowline", xe0), (col60, r60, 0.0, r60, "section.layback_top_above_road_side_edge", F.p(run, 0)[0]),
                                          (col190, e190, bot_edge, 0.0, "section.slab_thickness_at_road_side_edge_of_gutter_crossing", xe0)):
        arrow_dim_v(P, xcol, F.p(0, y_a)[1], F.p(0, y_b)[1], "", ext_to=xto)
        tg = vtag(T, SD + key)
        tx(P, xcol - 1.8, F.p(0, (y_a + y_b) / 2)[1], n0(val) + (tg if tg else ""), anchor="MIDDLE_RIGHT", color=RED if tg else None, h=TXT.BODY)
    rt = T.get(SD + "section.flowline_radius")
    if rt is not None and rt.mm:
        ax, ay = F.p(*arris_top)
        tx(P, ax + 4.5, ay + 8.0, f"R{n0(rt.mm)}" + (" " + rt.tag if rt.verify else ""), anchor="BOTTOM_LEFT", color=RED if rt.verify else None)
        leader(P, (ax + 5.5, ay + 7.4), (ax, ay), dot=True)
    xe = F.p(xb, 0)[0]
    arrow_dim_v(P, xe + 7.0, F.p(0, r60 + rise - slab)[1], F.p(0, r60 + rise)[1], "", ext_to=xe)
    tx(P, xe + 9.0, F.p(0, r60 + rise - slab / 2)[1], f"{n0(slab)} MIN", anchor="MIDDLE_LEFT")
    xcf = F.p(run + x_len * 0.08, 0)[0]
    leader(P, (xcf + 3.0, ytop_s + 9.0), (xcf + 3.0, F.p(0, r60 + rise * 0.1)[1] + 0.3), dot=False)
    tx(P, xcf, ytop_s + 10.0, f"{cf.rng[0]:g}% TO {cf.rng[1]:g}% NORMAL PATHWAY CROSSFALL", anchor="BOTTOM_LEFT")
    if rein is not None and cover is not None:
        txt_r = f"{str(rein.value).strip().split()[0]} FABRIC, {str(cover.value).replace(' to ', '-').replace(' mm', '')} TOP COVER (NOTE 9)"
        xs_ = F.p(run + x_len * 0.55, 0)[0]
        tx(P, xs_, ytop_s + 4.5, txt_r, anchor="BOTTOM_LEFT")
        leader(P, (xs_ + 4.0, ytop_s + 3.9), F.p(run + x_len * 0.55 + 100.0, r60 + rise * 0.55 - 35.0))
    xn = F.p(run + x_len * 0.30, 0)[0]
    yn = ybot_hatch + 14.0
    bx_ = label_box(P, xn, yn + 7.0, 66.0, ["REFER NOTE 6", f"{n0(base_mm)} BASE COURSE (FINE CRUSHED ROCK)"])
    leader(P, (xn + 2.0, yn + 7.0), F.p(run + x_len * 0.30 + 60.0, r60 + rise * 0.3 - slab - base_mm / 2))
    jt = F.p(run, r60 - slab)
    tx(P, jt[0] + 1.0, jt[1] - 2.0, "E.J.", anchor="TOP_LEFT", halo=True)
    tx(P, xe - 1.0, F.p(0, r60 + rise - slab)[1] - 4.0, "E.J.", anchor="TOP_RIGHT", halo=True)
    # cited section values with their citations (every number on the section)
    rows = []
    def addrow(item, key, value=None):
        t = T.get(key)
        if t is not None:
            rows.append((item, value or (t.vtext if t.unit else str(t.value)), (t.ref_short.replace("GSC SD-107 REV A, ", "") + (" VERIFY AGAINST SD-107" if t.verify else ""))))
    addrow("GUTTER CROSSING EACH SIDE OF THE NOMINAL KERB LINE", SD + "gutter_crossing.width_each_side_of_nominal_kerb_line")
    addrow("CONCRETE DEPTH AT THE ROAD-SIDE EDGE", SD + "section.slab_thickness_at_road_side_edge_of_gutter_crossing")
    addrow("FALL FROM THE EDGE TO THE FLOWLINE", SD + "section.gutter_crossing_fall_edge_to_flowline")
    addrow("LAYBACK TOP ABOVE THE ROAD-SIDE EDGE", SD + "section.layback_top_above_road_side_edge")
    addrow("LIP ARRIS RADIUS (TOP OF STEP AT NOMINAL KERB LINE)", SD + "section.flowline_radius", f"R{n0(rt.mm)}" if rt is not None and rt.mm else None)
    addrow("LAYBACK RUN BEHIND THE NOMINAL KERB LINE", SD + "layback.run_behind_nominal_kerb_line")
    addrow("SLAB THICKNESS (MINIMUM)", SD + "slab.thickness_min")
    addrow("PATHWAY CROSSFALL", SD + "crossfall.pathway_crossing", f"{cf.rng[0]:g} TO {cf.rng[1]:g} PERCENT")
    yt_tab = ybot_hatch - 9.0
    table_rows(P, T, x0 + 4.0, yt_tab, x1 - x0 - 8.0, rows, (0.46, 0.2, 0.34), h=TXT.SMALL, y_min=y0 + 11.0, head=("DIMENSION", "VALUE", "SOURCE"))
    return {"k": kx, "frame": F}


# ------------------------------------------------------------------------------------------------------------------------- SD-107 notes
def sd107_notes_box(P, T, r) -> None:
    """The 15 notes of SD-107, verbatim from the drawing text (typicals.json sd107_notes)."""
    x0, y0, x1, y1 = r
    yb = detail_title(P, r, "NOTES (GSC SD-107 REV A)", "VERBATIM FROM THE COUNCIL STANDARD DRAWING")
    hh = TXT.HEAD
    if not T.notes:
        not_available(P, r, "THE SD-107 NOTES ARE NOT IN THE COUNCIL DATA")
        return
    y = yb - 1.0
    w = x1 - x0 - 8.0
    for n in sorted(T.notes):
        wr = fonts.wrap(ST.clean(T.notes[n]).upper(), hh, w - 8.0)
        if y - len(wr) * (hh + 1.0) < y0 + 3.0:
            break
        P.text(x0 + 3.5, y, f"{n}.", hh, "TOP_LEFT", bold=True, layer=L_NOTE)
        for ln in wr:
            P.text(x0 + 11.5, y, ln, hh, "TOP_LEFT", layer=L_NOTE)
            y -= hh + 1.0
        y -= 1.6


# ------------------------------------------------------------------------------------------------------------------------- shared small drawings
def side_labels(P, items, x, y_top, w, h=H, gap=2.2, y_min=None):
    """Right-hand labels stacked from y_top, each with a leader to its target point (paper mm).  items = [(text, (tx, ty)) or (text, None)]."""
    y = y_top
    for text, tgt in items:
        wr = fonts.wrap(ST.clean(text).upper(), h, w)
        hh = len(wr) * (h + 1.0)
        if y_min is not None and y - hh < y_min:
            break
        for i, ln in enumerate(wr):
            P.text(x, y - i * (h + 1.0), ln, h, "TOP_LEFT", color=RED if "VERIFY" in ln else None, layer=L_NOTE)
        if tgt is not None:
            leader(P, (x - 1.0, y - h / 2), tgt)
        y -= hh + gap
    return y


def _short_cite(T, key):
    t = T.get(key)
    return "" if t is None else f"[{t.ref_short}]"


def pavement_detail(P, T, r) -> None:
    """Driveway crossing pavement per SD-107 notes 6, 9, 10, 12 and 13: the concrete slab and the paver option, drawn proportional to the cited thicknesses."""
    x0, y0, x1, y1 = r
    yb = detail_title(P, r, "DRIVEWAY CROSSING PAVEMENT (TYPICAL SECTIONS)", "GSC SD-107 REV A NOTES 6, 9, 10, 12, 13. THICKNESSES PROPORTIONAL, WIDTH NOT TO SCALE")
    g = lambda k: mmv(T, SD + k)                                                  # noqa: E731
    slab, cover = g("slab.thickness_min"), T.get(SD + "slab.reinforcement_top_cover")
    rein, f_c = T.get(SD + "slab.reinforcement"), T.get(SD + "slab.concrete_strength")
    bt = T.get(SD + "slab.base_course")
    pv = T.get(SD + "pavers.option")
    notes = T.notes
    if None in (slab,) or rein is None or cover is None or bt is None or pv is None or not notes:
        not_available(P, r, "THE SD-107 PAVEMENT VALUES ARE NOT IN THE COUNCIL DATA")
        return
    W = x1 - x0
    pw = (W - 9.0) / 2.0
    k = 0.15                                                                        # mm of paper per mm of thickness (thickness drawn to scale)
    hs = 12.0                                                                       # sub-grade hatch depth (graphic)
    sec_w = 0.36 * pw
    yt = yb - 6.0
    base = 50.0
    # ---- A. concrete slab ---------------------------------------------------------------------------------------------------------------------
    xa = x0 + 24.0
    ya_top = yt - 10.0
    P.text(xa, yt, "A. CONCRETE (SLAB TO NOTES 6, 9, 10)", H, "TOP_LEFT", bold=True, layer=L_NOTE)
    SEC.stipple(P.v, [(xa, ya_top), (xa + sec_w, ya_top), (xa + sec_w, ya_top - slab * k), (xa, ya_top - slab * k)])
    SEC.grey(P.v, [(xa, ya_top - slab * k), (xa + sec_w, ya_top - slab * k), (xa + sec_w, ya_top - (slab + base) * k), (xa, ya_top - (slab + base) * k)], SEC.GREY_BASE)
    SEC.hatch(P.v, [(xa, ya_top - (slab + base) * k), (xa + sec_w, ya_top - (slab + base) * k), (xa + sec_w, ya_top - (slab + base) * k - hs), (xa, ya_top - (slab + base) * k - hs)], "existing")
    P.line([(xa + 1.5, ya_top - 35.0 * k), (xa + sec_w - 1.5, ya_top - 35.0 * k)], L_LINE, 0.9, (0.1, 0.1, 0.1), dash="DASHED")
    arrow_dim_v(P, xa - 4.0, ya_top - slab * k, ya_top, "", ext_to=xa)
    tx(P, xa - 5.5, ya_top - slab * k / 2, f"{n0(slab)} MIN", anchor="MIDDLE_RIGHT")
    xl = xa + sec_w + 8.0
    items = [(f"CONCRETE SLAB {n0(slab)} MIN THICK, f'c {n0(f_c.number)} MPa (NOTES 9, 10)" if f_c is not None and f_c.number else "CONCRETE SLAB", (xa + sec_w * 0.75, ya_top - 8.0 * k)),
             (f"{str(rein.value).strip().split()[0]} FABRIC, TOP COVER {str(cover.value).replace(' to ', '-')} (NOTE 9)", (xa + sec_w * 0.6, ya_top - 35.0 * k)),
             (f"{n0(base)} BASE COURSE OF APPROVED GRANULAR (FINE CRUSHED ROCK), 95% STANDARD COMPACTION (NOTE 6)", (xa + sec_w * 0.4, ya_top - (slab + base / 2) * k)),
             ("COMPACTED SUB-GRADE (NOTE 6)", (xa + sec_w * 0.6, ya_top - (slab + base) * k - hs / 2))]
    ylast_a = side_labels(P, items, xl, ya_top + 4.0, x0 + pw - xl - 2.0)
    # ---- B. pavers (note 12) -----------------------------------------------------------------------------------------------------------------
    xb = x0 + pw + 9.0 + 5.0
    P.text(xb, yt, "B. PAVERS OPTION (NOTE 12)", H, "TOP_LEFT", bold=True, layer=L_NOTE)
    t_p, t_b, t_c = 65.0, 20.0, 100.0
    y = ya_top
    SEC.grey(P.v, [(xb, y), (xb + sec_w, y), (xb + sec_w, y - t_p * k), (xb, y - t_p * k)], (0.82, 0.82, 0.82))
    for i in range(1, 6):                                                           # paver joints
        P.line([(xb + i * sec_w / 6, y), (xb + i * sec_w / 6, y - t_p * k)], L_LINE, 0.25, ST.BLACK)
    y -= t_p * k
    SEC.grey(P.v, [(xb, y), (xb + sec_w, y), (xb + sec_w, y - t_b * k), (xb, y - t_b * k)], (0.95, 0.9, 0.78))
    y -= t_b * k
    SEC.stipple(P.v, [(xb, y), (xb + sec_w, y), (xb + sec_w, y - t_c * k), (xb, y - t_c * k)])
    P.line([(xb + 1.5, y - 35.0 * k), (xb + sec_w - 1.5, y - 35.0 * k)], L_LINE, 0.9, (0.1, 0.1, 0.1), dash="DASHED")
    y -= t_c * k
    SEC.grey(P.v, [(xb, y), (xb + sec_w, y), (xb + sec_w, y - base * k), (xb, y - base * k)], SEC.GREY_BASE)
    y -= base * k
    SEC.hatch(P.v, [(xb, y), (xb + sec_w, y), (xb + sec_w, y - hs), (xb, y - hs)], "existing")
    xl2 = xb + sec_w + 8.0
    n12 = notes.get(12, "")
    items = [("65 THICK CONCRETE OR CLAY PAVERS", (xb + sec_w * 0.7, ya_top - t_p * k / 2)),
             ("20 THICK 6:1 SAND CEMENT BEDDING", (xb + sec_w * 0.6, ya_top - (t_p + t_b / 2) * k)),
             ("MINIMUM 100 THICK REINFORCED (SL72) CONCRETE BASE", (xb + sec_w * 0.5, ya_top - (t_p + t_b + t_c / 2) * k)),
             (f"{n0(base)} BASE COURSE AND COMPACTED SUB-GRADE (NOTE 6)", (xb + sec_w * 0.3, ya_top - (t_p + t_b + t_c + base / 2) * k))] if "65" in n12 and "SL72" in n12 else []
    ylast_b = side_labels(P, items, xl2, ya_top + 4.0, x1 - xl2 - 3.0)
    # ---- statements ----------------------------------------------------------------------------------------------------------------------------
    ys = min(ya_top - (slab + base) * k - hs - 6.0, ya_top - (t_p + t_b + t_c + base) * k - hs - 6.0, ylast_a - 1.0, ylast_b - 1.0)       # below the taller pavers section as well
    fin = notes.get(13)
    dcp = T.get("dcp.pavement.surface_materials")
    nf = T.not_published("pavement_design")
    lines = []
    if fin:
        lines.append(f"NOTE 13: {fin}")
    if dcp is not None:
        q_ = dcp.quote[0] if dcp.quote else str(dcp.value)
        lines.append((f"DRIVEWAYS (ALL INTERNAL VEHICLE ACCESS AND MANOEUVRING AREAS) {q_}" if q_.lower().startswith("are to be") else q_) + f". [{dcp.ref_short}]")
    if nf:
        lines.append("PAVEMENT THICKNESS AND SUB-GRADE DESIGN FOR THE ON-LOT DRIVEWAY ARE NOT STATED IN THE COUNCIL DOCUMENTS (NOT FOUND, OBTAIN FROM COUNCIL). THE SD-107 SECTION APPLIES TO THE CROSSING WITHIN THE ROAD RESERVE")
    bullets(P, x0 + 4.0, ys, W - 8.0, lines, y_min=y0 + 11.0)
    footer(P, r, ["SOURCE: " + (T.get(SD + "slab.thickness_min").ref if T.get(SD + "slab.thickness_min") else "")])


def table_rows(P, T, x, y_top, w, rows, cols, h=H, y_min=None, head=None):
    """Compact ruled table of (text, text, ...) rows; returns the y below it.  cols are width fractions."""
    xs = [x]
    for c in cols:
        xs.append(xs[-1] + w * c)
    y = y_top
    if head:
        P.line([(x, y), (x + w, y)], L_NOTE, 0.3, ST.BLACK)
        for i, t in enumerate(head):
            P.text(xs[i] + 1.2, y - 1.0, t, h, "TOP_LEFT", bold=True, layer=L_NOTE)
        y -= h + 2.4
    for row in rows:
        cells = [fonts.wrap(ST.clean(t).upper(), h, w * cols[i] - 2.4) for i, t in enumerate(row)]
        hh = max(len(c) for c in cells) * (h + 0.9) + 1.6
        if y_min is not None and y - hh < y_min:
            break
        P.line([(x, y), (x + w, y)], L_NOTE, 0.15, ST.GRID)
        for i, c in enumerate(cells):
            for j, ln in enumerate(c):
                P.text(xs[i] + 1.2, y - 1.0 - j * (h + 0.9), ln, h, "TOP_LEFT", color=RED if ("NOT PUBLISHED" in ln or "VERIFY" in ln) else None, layer=L_NOTE)
        y -= hh
    P.line([(x, y), (x + w, y)], L_NOTE, 0.15, ST.GRID)
    return y


def kerb_detail(P, T, r) -> None:
    """Kerb and gutter: the council profile (RD003) is NOT published, so no profile is drawn: the cited requirements and what SD-107 shows are listed."""
    x0, y0, x1, y1 = r
    yb = detail_title(P, r, "KERB AND GUTTER", "NO PROFILE DRAWN: THE COUNCIL PROFILE DRAWING IS NOT PUBLISHED")
    W = x1 - x0
    y = yb - 1.0
    bx = label_box(P, x0 + 3.0, y, W - 6.0, [RD003_TEXT], color=RED, bold_first=True)
    y = bx[1] - 2.0
    bx = label_box(P, x0 + 3.0, y, W - 6.0, [LAYBACK_DWG_TEXT], color=RED)
    y = bx[1] - 3.0
    rows = []
    def add(label, key, text=None):
        t = T.get(key)
        if t is not None:
            rows.append((label, text or (t.quote[0] if t.quote else str(t.value)), t.ref_short + (" " + t.tag if t.verify else "")))
    add("TYPE", "eng.kerb.type", "INTEGRAL KERB AND GUTTER FOR ALL ROAD CLASSIFICATIONS; RD003 WHERE THE CARRIAGEWAY IS AN OVERLAND FLOW PATH")
    add("HIGH SIDE OF ONE-WAY CROSSFALL", "eng.kerb.semi_mountable", "SEMI-MOUNTABLE KERB")
    t = T.get("eng.kerb.carriageway_crossfall")
    if t is not None:
        rows.append(("CARRIAGEWAY CROSSFALL", f"{t.value:g} PERCENT", t.ref_short))
    t = T.get("eng.kerb.gutter_min_grade")
    if t is not None:
        rows.append(("GUTTER MINIMUM GRADE", f"{t.value:g} PERCENT", t.ref_short))
    t = T.get("eng.kerb.subgrade_behind_kerb_invert")
    if t is not None:
        rows.append(("SUB-GRADE BEHIND KERB INVERT", "500 MM MINIMUM (RD002)", t.ref_short))
    add("LAYBACK BACK HEIGHT", "eng.crossing.layback_back_height", "NOT LESS THAN THE ADJACENT KERB AND GUTTER HEIGHT")
    add("DRIVEWAY RISERS", "eng.crossing.driveway_risers", "NOT PERMITTED")
    e190, r60, r25 = T.get(SD + "section.slab_thickness_at_road_side_edge_of_gutter_crossing"), T.get(SD + "section.layback_top_above_road_side_edge"), T.get(SD + "section.flowline_radius")
    if e190 is not None:
        rows.append(("GUTTER CROSSING (WHAT SD-107 SHOWS)", f"{n0(e190.mm)} AT THE ROAD-SIDE EDGE; 450 EACH SIDE OF THE NOMINAL KERB LINE; LAYBACK TOP {n0(r60.mm) if r60 else '?'} ABOVE THE EDGE" + (" VERIFY AGAINST SD-107" if r60 is not None and r60.verify else "") + (f"; R{n0(r25.mm)} ARRIS AT THE TOP OF THE LIP" if r25 is not None else ""), "GSC SD-107 REV A, SECTION 1"))
    table_rows(P, T, x0 + 3.0, y, W - 6.0, rows, (0.26, 0.48, 0.26), y_min=y0 + 4.0)


def drainage_detail(P, T, r) -> None:
    """Lot drainage: roof and surface water to the street gutter where possible, inter-allotment drainage only where gravity to the street is not possible."""
    x0, y0, x1, y1 = r
    yb = detail_title(P, r, "LOT DRAINAGE TO STREET GUTTER AND INTER-ALLOTMENT DRAINAGE", "SCHEMATIC PLANS, NOT TO SCALE. ENGINEERING STANDARDS 3.9")
    W = x1 - x0
    hh = 36.0
    pw = (W - 9.0) / 2.0
    t_dir = T.get("eng.stormwater.direct_to_street_gutter")
    # ---- A. direct to street ---------------------------------------------------------------------------------------------------------------
    xa, ya = x0 + 4.0, yb - 5.0
    P.text(xa, ya, "A. DIRECT TO STREET GUTTER (PREFERRED)", H, "TOP_LEFT", bold=True, layer=L_NOTE)
    ya -= 5.0
    ax1, ax0 = xa + pw - 6.0, xa
    yl_t, yl_b = ya, ya - hh + 8.0
    P.line([(ax0, yl_t), (ax1, yl_t), (ax1, yl_b), (ax0, yl_b)], L_LINE, 0.4, ST.BLACK, dash="DASHDOT", closed=True)
    P.text(ax0 + 1.5, yl_t - 1.0, "LOT", H, "TOP_LEFT", layer=L_NOTE)
    P.poly([(ax0 + pw * 0.28, yl_t - 4.0), (ax0 + pw * 0.62, yl_t - 4.0), (ax0 + pw * 0.62, yl_b + 9.0), (ax0 + pw * 0.28, yl_b + 9.0)], L_LINE, (0.88, 0.88, 0.88), edge=ST.BLACK, edge_lw=0.3)
    P.text(ax0 + pw * 0.45, (yl_t + yl_b) / 2 + 1.0, "ROOF", H, "MIDDLE_CENTER", layer=L_NOTE)
    ky = yl_b - 5.0
    P.poly([(ax0 - 1.0, ky - 4.0), (ax1 + 1.0, ky - 4.0), (ax1 + 1.0, ky), (ax0 - 1.0, ky)], L_LINE, (0.82, 0.82, 0.82), edge=ST.BLACK, edge_lw=0.3)
    P.text(ax1 - 1.0, ky - 6.0, "STREET GUTTER", TXT.SMALL, "TOP_RIGHT", layer=L_NOTE)
    xp = ax0 + pw * 0.45
    P.line([(xp, yl_b + 9.0), (xp, yl_b + 5.0), (xp, ky)], L_LINE, 0.9, (0.1, 0.1, 0.5))
    P.poly([(xp - 1.2, ky + 2.5), (xp + 1.2, ky + 2.5), (xp, ky)], L_LINE, (0.1, 0.1, 0.5))
    P.text(xp + 2.0, yl_b + 5.0, "PIPE TO KERB OUTLET", TXT.SMALL, "MIDDLE_LEFT", layer=L_NOTE)
    # ---- B. inter-allotment ---------------------------------------------------------------------------------------------------------------
    xb = x0 + pw + 9.0 + 4.0
    yb2 = yb - 5.0
    P.text(xb, yb2, "B. INTER-ALLOTMENT DRAINAGE", H, "TOP_LEFT", bold=True, layer=L_NOTE)
    P.text(xb, yb2 - 3.6, "ONLY WHERE GRAVITY TO THE STREET IS NOT POSSIBLE", TXT.SMALL, "TOP_LEFT", layer=L_NOTE, color=RED)
    yt2 = yb2 - 8.5
    bx0, bx1 = xb, xb + pw - 8.0
    P.line([(bx0, yt2), (bx1, yt2), (bx1, yt2 - hh + 4.0), (bx0, yt2 - hh + 4.0)], L_LINE, 0.4, ST.BLACK, dash="DASHDOT", closed=True)
    xe0, xe1 = bx0 + (bx1 - bx0) * 0.55, bx0 + (bx1 - bx0) * 0.75                 # easement strip along the lower boundary side
    P.poly([(xe0, yt2), (xe1, yt2), (xe1, yt2 - hh + 4.0), (xe0, yt2 - hh + 4.0)], L_LINE, (0.93, 0.95, 0.85), edge=ST.BLACK, edge_lw=0.2)
    P.line([((xe0 + xe1) / 2, yt2 - 1.0), ((xe0 + xe1) / 2, yt2 - hh + 5.0)], L_LINE, 1.0, (0.1, 0.1, 0.5))
    P.circle((xe0 + xe1) / 2, yt2 - hh + 12.0, 1.8, L_LINE, 0.5, ST.BLACK, ST.WHITE)
    P.text(bx0 + 1.5, yt2 - 1.0, "LOT", H, "TOP_LEFT", layer=L_NOTE)
    P.poly([(bx0 + 4.0, yt2 - 8.0), (bx0 + (bx1 - bx0) * 0.38, yt2 - 8.0), (bx0 + (bx1 - bx0) * 0.38, yt2 - 24.0), (bx0 + 4.0, yt2 - 24.0)], L_LINE, (0.88, 0.88, 0.88), edge=ST.BLACK, edge_lw=0.3)
    P.text(bx0 + 4.0 + (bx1 - bx0) * 0.19, yt2 - 16.0, "ROOF", H, "MIDDLE_CENTER", layer=L_NOTE)
    P.line([(bx0 + (bx1 - bx0) * 0.38, yt2 - 16.0), ((xe0 + xe1) / 2, yt2 - hh + 12.0)], L_LINE, 0.5, (0.1, 0.1, 0.5))
    ez = T.get("eng.inter_allotment.easement_width")
    P.text((xe0 + xe1) / 2, yt2 - hh + 2.2, f"EASEMENT {ez.vtext.upper().replace(' M', ' m') if ez else ''}", TXT.SMALL, "TOP_CENTER", layer=L_NOTE)
    P.text(xe1 + 1.5, yt2 - hh + 13.5, "GRATED INLET PIT", TXT.SMALL, "MIDDLE_LEFT", layer=L_NOTE)          # right of the easement strip: the roof pipe arrives from the left
    P.text(xe1 + 1.5, yt2 - hh + 10.5, "AT LOWEST POINT", TXT.SMALL, "MIDDLE_LEFT", layer=L_NOTE)
    # ---- cited statements ---------------------------------------------------------------------------------------------------------------------
    y = yt2 - hh - 6.0
    pipe, lot, evt, free, ex, pd, osd = (T.get("eng.inter_allotment." + k) for k in ("min_pipe_diameter", "lot_inlet", "design_event", "pit_freeboard", "exclusions", "pit_drawings", "pipe_larger_than"))
    lines = []
    if t_dir is not None:
        lines.append("A. ROOF AND SURFACE WATER IS DISCHARGED TO THE STREET GUTTER WHERE POSSIBLE; INTER-ALLOTMENT DRAINAGE ONLY WHERE IT CANNOT [" + t_dir.ref_short + "]")
    if pipe is not None:
        lines.append(f"B. MINIMUM PIPE 225 MM, 150 MM MAY BE CONSIDERED WHERE ONLY ONE LOT IS SERVED; DESIGN EVENT {evt.value:g} PERCENT AEP" + (f" [{pipe.ref_short}]" if pipe else ""))
    if lot is not None:
        lines.append("B. EACH LOT: AT LEAST ONE GRATED INLET PIT AT THE LOWEST SURFACE POINT ALONG THE LINE, WITH A 150 MM JUNCTION LEFT IN THE PIT WALL FOR ROOF WATER [" + lot.ref_short + "]")
    if ez is not None and free is not None:
        lines.append(f"B. EASEMENT {ez.vtext.replace(' m', ' m')} [{ez.ref_short}]. PIT FREEBOARD {free.value} MM [{free.ref_short}]")
    if ex is not None:
        lines.append("B. NO ROAD, PARK OR PUBLIC DRAINAGE TO THE LINE: ROOFS AND PRIVATE SURFACES ONLY [" + ex.ref_short + "]")
    lines.append("KERB OUTLET AND KERB ADAPTOR PROPERTY CONNECTION DETAIL: NOT PUBLISHED, OBTAIN FROM COUNCIL")
    if pd is not None:
        lines.append("INTER-ALLOTMENT PIT DRAWINGS GSC SW009 AND SW010: NOT PUBLISHED, OBTAIN FROM COUNCIL")
    bullets(P, x0 + 4.0, y, W - 8.0, lines, y_min=y0 + 3.0)


def osd_detail(P, T, r) -> None:
    """On-site detention for a small development (Engineering Standards 3.10): the rules, no invented discharge rate or volume."""
    x0, y0, x1, y1 = r
    yb = detail_title(P, r, "ON-SITE DETENTION (SMALL DEVELOPMENT)", "SCHEMATIC, NOT TO SCALE. ENGINEERING STANDARDS 3.10")
    W = x1 - x0
    tk = T.get("eng.stormwater.osd_tank_rules")
    if tk is None:
        not_available(P, r, "THE OSD RULES ARE NOT IN THE COUNCIL DATA")
        return
    y = yb - 6.0
    gap_ = 17.0
    bw, bh = (W - 8.0 - 3 * gap_) / 4.0, 14.0
    xs = [x0 + 4.0 + i * (bw + gap_) for i in range(4)]
    labels = [["ROOF"], ["BASIX WATER", "STORAGE TANK"], ["DEDICATED", "DETENTION TANK"], ["LEGAL POINT OF", "DISCHARGE"]]
    for i, ls in enumerate(labels):
        P.poly([(xs[i], y), (xs[i] + bw, y), (xs[i] + bw, y - bh), (xs[i], y - bh)], L_NOTE, ST.WHITE, edge=ST.BLACK, edge_lw=0.3)
        for j, t in enumerate(ls):
            P.text(xs[i] + bw / 2, y - bh / 2 + (len(ls) - 1) * 1.6 - j * 3.3, t, H, "MIDDLE_CENTER", bold=(i == 2), layer=L_NOTE)
        if i < 3:
            P.line([(xs[i] + bw, y - bh / 2), (xs[i + 1], y - bh / 2)], L_LINE, 0.5, ST.BLACK)
            P.poly([(xs[i + 1] - 2.2, y - bh / 2 + 0.9), (xs[i + 1], y - bh / 2), (xs[i + 1] - 2.2, y - bh / 2 - 0.9)], L_LINE, ST.BLACK)
    P.text((xs[1] + bw + xs[2]) / 2, y - bh / 2 + 2.0, "OVERFLOW", TXT.SMALL, "BOTTOM_CENTER", layer=L_NOTE)
    P.text((xs[0] + bw + xs[1]) / 2, y - bh / 2 + 2.0, "ALL ROOF", TXT.SMALL, "BOTTOM_CENTER", layer=L_NOTE)
    y -= bh + 6.0
    g = lambda k: T.get("eng.stormwater." + k)                                      # noqa: E731
    lines = []
    for key, pre in (("osd_small_development_definition", "SMALL DEVELOPMENT: "), ("osd_trigger", "OSD MAY BE REQUIRED: "), ("osd_permissible_discharge", "DISCHARGE: "), ("osd_tank_rules", "TANKS: "),
                     ("osd_underground_tank", "UNDERGROUND TANK: "), ("osd_above_ground_paved_ponding", "ABOVE GROUND: ")):
        t = g(key)
        if t is not None and key == "osd_above_ground_paved_ponding" and "; landscaped" in str(t.value):       # two clauses: ponding depth 3.10.6.1, landscaped OSD 3.10.6.2
            a_, b_ = str(t.value).split("; landscaped", 1)
            lines.append(pre + a_.upper() + f" [{t.ref_at('3.10.6.1')}]")
            lines.append("LANDSCAPED OSD" + b_.upper() + f" [{t.ref_at('3.10.6.2')}]")
        elif t is not None:
            lines.append(pre + str(t.value).upper() + f" [{t.ref_short}]")
    lines.append("NO DISCHARGE RATE (L/s) OR STORAGE VOLUME IS GIVEN IN THE COUNCIL DOCUMENTS FOR A SMALL DEVELOPMENT: BY DESIGN, NOT STATED HERE")
    bullets(P, x0 + 4.0, y, W - 8.0, lines, h=TXT.LABEL, y_min=y0 + 3.0)


def verge_detail(P, T, r) -> None:
    """Typical verge (footway) section: service corridors from Table 2-I drawn at their cited offsets from the property boundary, footway crossfall 2 to 6 percent."""
    x0, y0, x1, y1 = r
    yb = detail_title(P, r, "TYPICAL VERGE SECTION (SERVICE CORRIDORS)", "TABLE 2-I OFFSETS FROM THE PROPERTY BOUNDARY, NOT TO SCALE VERTICALLY. ENGINEERING STANDARDS 2.10.5")
    W = x1 - x0
    fw = T.get("eng.verge.footway_width_built_up_min")
    cfx = T.get("eng.verge.footway_crossfall_unpaved_or_partly_paved")
    cfp = T.get("eng.verge.footpath_crossfall_paved")
    if fw is None or cfx is None or cfx.rng is None:
        not_available(P, r, "THE VERGE VALUES ARE NOT IN THE COUNCIL DATA")
        return
    Wv = fw.number * 1000.0                                                         # nominal built-up footway width (mm), kerb face to the property boundary
    gx0, gx1 = x0 + 34.0, x1 - 30.0                                                 # boundary at the right, kerb at the left
    k = (gx1 - gx0) / Wv
    xb_ = gx1
    X = lambda off: xb_ - off * k                                                   # noqa: E731  offset from the boundary (mm) to paper x
    ytop = yb - 17.0
    # ground line falling toward the carriageway, kerb block at the left, boundary at the right
    fall = 8.0
    P.line([(gx0, ytop - fall), (gx1, ytop)], L_LINE, 0.7, ST.BLACK)
    SEC.hatch(P.v, [(gx0, ytop - fall), (gx1, ytop), (gx1, ytop - 11.0), (gx0, ytop - fall - 11.0)], "existing")
    P.poly([(gx0 - 5.0, ytop - fall - 11.0), (gx0, ytop - fall - 11.0), (gx0, ytop - fall + 3.0), (gx0 - 5.0, ytop - fall + 3.0)], L_LINE, (0.8, 0.8, 0.8), edge=ST.BLACK, edge_lw=0.4)
    P.line([(gx0 - 14.0, ytop - fall - 3.0), (gx0 - 5.0, ytop - fall - 3.0)], L_LINE, 0.4, ST.BLACK)
    P.text(gx0 - 13.0, ytop - fall - 4.5, "ROAD", TXT.SMALL, "TOP_LEFT", layer=L_NOTE)
    P.text(gx0 - 1.0, ytop - fall + 4.5, "KERB AND GUTTER", TXT.SMALL, "BOTTOM_RIGHT", layer=L_NOTE)
    P.text(gx1 + 1.5, ytop + 3.0, "PROPERTY", TXT.SMALL, "BOTTOM_LEFT", layer=L_NOTE)
    P.text(gx1 + 1.5, ytop + 0.0, "BOUNDARY", TXT.SMALL, "TOP_LEFT", layer=L_NOTE)
    slope = f"FOOTWAY CROSSFALL {cfx.rng[0]:g} TO {cfx.rng[1]:g} PERCENT TO THE CARRIAGEWAY"
    ang = math.degrees(math.atan2(fall, gx1 - gx0))
    P.text((gx0 + gx1) / 2, ytop - fall / 2 + 3.4, slope, H, "MIDDLE_CENTER", rot=ang, bold=True, layer=L_NOTE)
    arrow_dim_h(P, ytop + 10.0, gx0, gx1, f"NOMINAL FOOTWAY WIDTH {n0(Wv)} MINIMUM IN BUILT-UP AREAS (KERB FACE TO BOUNDARY)", ext_from=ytop - fall + 3.0)
    # corridors: rows below the ground line, each bar at its cited offsets
    rows = []
    def pair(name, wk, ok, *, centre_from_kerb=None):
        w, o = T.get(wk), T.get(ok)
        if w is None or o is None:
            return
        if centre_from_kerb is not None:
            c = o.mm
            a, b = Wv - (c + w.mm / 2), Wv - (c - w.mm / 2)
            rows.append((name, a, b, f"{n0(w.mm)} WIDE, CENTRE {n0(c)} FROM KERB FACE", o))
        else:
            a, b = o.range_mm if o.range_mm else (0, 0)
            rows.append((name, a, b, f"{n0(w.mm)} WIDE, {n0(a)} TO {n0(b)} FROM BOUNDARY", o))
    pair("STREET LIGHTING", "eng.table2I.street_lighting.corridor_width", "eng.table2I.street_lighting.offset_from_boundary")
    pair("ELECTRICITY", "eng.table2I.electricity.corridor_width", "eng.table2I.electricity.offset_from_boundary")
    pair("TELECOMMUNICATIONS", "eng.table2I.telecommunications.corridor_width", "eng.table2I.telecommunications.offset_from_boundary")
    pair("SEWER", "eng.table2I.sewer.corridor_width", "eng.table2I.sewer.offset_from_boundary")
    pair("WATER", "eng.table2I.water.corridor_width", "eng.table2I.water.centre_from_kerb_face", centre_from_kerb=True)
    pair("CONCRETE FOOTPATH", "eng.table2I.concrete_footpath.corridor_width_min", "eng.table2I.concrete_footpath.offset_from_boundary")
    yr = ytop - fall - 11.0 - 3.0
    rh = 4.0
    for i, (name, a, b, txt, o) in enumerate(rows):
        yy = yr - i * (rh + 1.2)
        P.poly([(X(b), yy), (X(a), yy), (X(a), yy - rh), (X(b), yy - rh)], L_LINE, (0.78, 0.84, 0.92), edge=ST.BLACK, edge_lw=0.3)
        P.text(gx0 - 14.0 if False else x0 + 2.0, yy - rh / 2, name, TXT.SMALL, "MIDDLE_LEFT", layer=L_NOTE)
        tl = fonts.text_width(txt, TXT.SMALL)
        if X(b) - 2.0 - tl > gx0 + 1.0:
            P.text(X(b) - 2.0, yy - rh / 2, txt, TXT.SMALL, "MIDDLE_RIGHT", layer=L_NOTE)
        else:
            P.text(X(a) + 2.0, yy - rh / 2, txt, TXT.SMALL, "MIDDLE_LEFT", layer=L_NOTE)
    yy = yr - len(rows) * (rh + 1.2)
    st = T.get("eng.table2I.street_tree.corridor_width")
    se = T.get("eng.table2I.street_tree.edge_from_travel_lane_min")
    if st is not None and se is not None:
        P.text(x0 + 2.0, yy - rh / 2, "STREET TREE", TXT.SMALL, "MIDDLE_LEFT", layer=L_NOTE)
        P.text(gx0 + 2.0, yy - rh / 2, f"{n0(st.mm)} WIDE, EDGE OF TREE MINIMUM {n0(se.mm)} FROM THE EDGE OF THE TRAVEL LANE (NOT LOCATED ON THIS AXIS)", TXT.SMALL, "MIDDLE_LEFT", layer=L_NOTE)
        yy -= rh + 1.2
    ys = yy - 3.0
    P.line([(gx1, ytop + 6.0), (gx1, yy + 0.5)], L_LINE, 0.4, ST.BLACK, dash="DASHED")             # property boundary, down to the last corridor row only
    lines = []
    n2 = T.get("eng.table2I.note2.electrical_allocation")
    if n2 is not None:
        lines.append("TABLE 2-I NOTE 2: ELECTRICAL ALLOCATION 1000 MM IN WIDTH AND EXTENT FROM THE PROPERTY BOUNDARY (OVERLAPS THE OTHER CORRIDORS AS TABULATED)")
    ws, sj = T.get("eng.stormwater.water_service"), T.get("eng.stormwater.sewer_junction")
    if ws is not None:
        lines.append("WATER SERVICE: " + str(ws.value).upper() + f" [{ws.ref_at('4.5.12', 110)}; {ws.ref_at('4.7.7.4', 119)} (COVER)]")
    if sj is not None:
        lines.append("SEWER: " + str(sj.value).upper() + f" [{sj.ref_short}]")
    lines.append(f"FOOTWAY CROSSFALL {cfx.rng[0]:g} TO {cfx.rng[1]:g} PERCENT TO THE CARRIAGEWAY, KERB TO THE ADJACENT PROPERTY BOUNDARY [{cfx.ref_short}]")
    if cfp is not None:
        lines.append(f"PAVED FOOTPATH CROSSFALL {cfp.value.replace(' to ', ' TO ')} PERCENT [{cfp.ref_short}]")
    lines.append(G001_TEXT)
    bullets(P, x0 + 3.0, ys, W - 6.0, lines, y_min=y0 + 3.0)


def blue_cite(c, key: str, label: str) -> str | None:
    """'LABEL: VALUE [SOURCE SECTION, p.N]' with a short source name (the full titles are on C001)."""
    t = c.get(key)
    if t is None:
        return None
    doc = "BLUE BOOK VOL.1 (4TH ED.)" if "Blue Book" in t.doc else ("NSW ESC GUIDELINES FOR BUILDING SITES (OCT 2024)" if "ESC Guidelines" in t.doc else t.doc.upper())
    m = re.match(r"[\d.]+(?:\([A-Za-z]\))?", (t.section or "").strip())
    step = re.search(r"STEP \d+", (t.section or "").upper())
    sec = ((m.group(0) if m else "") + (" " + step.group(0) if step else "")).strip()
    return f"{label}: {t.vtext} [{doc}{' ' + sec if sec else ''}, p.{t.page}]"


def esc_notes_detail(P, T, r, notes_extra=()) -> None:
    """Council Part 7 notes for erosion and sediment control; the sediment fence and stabilised access details beside it are the Blue Book / NSW guideline typicals."""
    x0, y0, x1, y1 = r
    yb = detail_title(P, r, "ESC: COUNCIL REQUIREMENTS", "ENGINEERING STANDARDS PART 7")
    W = x1 - x0
    lines = []
    for key, pre in (("eng.esc.topsoil_reinstate_min", "TOPSOIL: "), ("eng.esc.controls_remain_until", "CONTROLS REMAIN UNTIL "), ("eng.esc.batter_revegetation", "BATTERS: "), ("eng.esc.standard_references", "REFERENCES: ")):
        t = T.get(key)
        if t is None:
            continue
        if key.endswith("topsoil_reinstate_min"):
            lines.append(f"TOPSOIL (AS 3798) IS REMOVED DURING THE WORKS AND RE-INSTATED AFTERWARDS AT {n0(t.mm)} MM MINIMUM THICKNESS [{t.ref_short}]")
        elif key.endswith("controls_remain_until"):
            lines.append(f"CONTROLS REMAIN IN PLACE UNTIL THE SITE IS {str(t.value).upper()} [{t.ref_short}]")
        else:
            lines.append(pre + str(t.value).upper() + f" [{t.ref_short}]")
    vf = T.get("eng.verge.verge_finish")
    if vf is not None:
        lines.append("VERGE FINISH: " + str(vf.value).upper() + f" [{vf.ref_short}]")
    nf = T.not_published("sediment_fence")
    if nf:
        lines.append("THE COUNCIL HAS NO OWN SEDIMENT FENCE OR STABILISED ACCESS TYPICAL (NOT FOUND): THE DETAILS BESIDE THIS ONE ARE THE BLUE BOOK AND NSW GUIDELINE TYPICALS, WITH THEIR OWN CITATIONS")
    lines += list(notes_extra)
    bullets(P, x0 + 3.0, yb - 1.0, W - 6.0, lines, h=TXT.LABEL, y_min=y0 + 3.0)


def status_notes_detail(P, T, r, extra=()) -> None:
    """Status of the details, the DCP and Engineering Standards conflict on the number of crossings, and what the council has not published."""
    x0, y0, x1, y1 = r
    yb = detail_title(P, r, "NOTES AND STATUS OF DETAILS")
    W = x1 - x0
    mx, wd = T.get("eng.table2H.max_crossings_per_frontage"), T.get("eng.table2H.access_width_residential")
    lines = ["ALL DETAILS ARE TYPICAL, NOT TO SCALE. COUNCIL STANDARD DRAWINGS GOVERN",
             ("EVERY VALUE SHOWN IS FROM THE CITED DOCUMENT, WITH ITS CITATION. A VALUE MARKED VERIFY AGAINST SD-107 WAS READ FROM THE DRAWN SHEET (CONFIDENCE 0.7 OR LOWER): CONFIRM IT ON THE COUNCIL PDF" if T.verify_keys() else
              "EVERY VALUE SHOWN IS FROM THE CITED DOCUMENT, WITH ITS CITATION. THE SD-107 DIMENSIONS READ OFF THE DRAWING (NOT STATED IN ITS NOTES) CARRY A READING CONFIDENCE BELOW 1.0 IN THE COUNCIL DATA FILE: CONFIRM THEM ON THE COUNCIL PDF"),
             "SD-107 LABELS THE SL82 FABRIC 'SEE NOTE 7'; THE REINFORCEMENT IS SPECIFIED IN ITS NOTE 9 AND IS SHOWN WITH NOTE 9"]
    if mx is not None:
        lines.append(CONFLICT_NOTE.replace("2 CROSSINGS PER STREET FRONTAGE", f"{n0(mx.number)} CROSSINGS PER STREET FRONTAGE" if mx.number else "2 CROSSINGS PER STREET FRONTAGE") + f" [{mx.ref_short}]")
    if wd is not None:
        lines.append(f"ACCESS WIDTH, RESIDENTIAL {wd.value.upper()} M (TABLE 2-H) AGREES WITH THE SD-107 RANGE {n0(mmv(T, SD + 'crossing.width_at_property_boundary_min') or 0)} MIN TO {n0(mmv(T, SD + 'crossing.width_at_property_boundary_max') or 0)} MAX" if wd.value else "")
    srcs = [f"{d['tag']} ({d['edition']})" for k, d in T.docs.items() if k in ("sd107", "eng", "dcp") and d.get("tag")]
    if srcs:
        lines.append("COUNCIL SOURCES: " + "; ".join(srcs) + ". ESC TYPICALS: BLUE BOOK VOL.1 (4TH ED.) AND THE NSW ESC GUIDELINES FOR BUILDING SITES (OCT 2024), AS CITED ON EACH DETAIL")
    nfs = [t for t in T.missing.values()]
    if nfs:
        lines.append("NOT PUBLISHED OR NOT FOUND IN THE COUNCIL DOCUMENTS (OBTAIN FROM COUNCIL): " + "; ".join(sorted({t.label or t.key for t in nfs})))
    lines += list(extra)
    bullets(P, x0 + 3.0, yb - 1.0, W - 6.0, [l for l in lines if l], y_min=y0 + 3.0)


# ------------------------------------------------------------------------------------------------------------------------- C600 layout
def c600_cells(X0, X1, Y0, Y1, gx, gy) -> dict:
    """Detail cells of C600 (paper mm): row 1 SD-107 plan, section, notes; rows 2 and 3 the other council typicals."""
    W, Hh = X1 - X0 - 2 * gx, Y1 - Y0 - 2 * gy
    h1 = 0.43 * Hh
    h2 = (Hh - h1) / 2.0
    out = {}
    wa, wb = 0.355 * W, 0.355 * W
    yt = Y1
    out["sd_plan"] = (X0, yt - h1, X0 + wa, yt)
    out["sd_section"] = (X0 + wa + gx, yt - h1, X0 + wa + gx + wb, yt)
    out["sd_notes"] = (X0 + wa + wb + 2 * gx, yt - h1, X1, yt)
    for names, ws, yt_ in ((("pavement", "kerb", "drain", "osd"), [0.27, 0.20, 0.265, 0.265], yt - h1 - gy), (("verge", "fence", "access", "esc", "status"), [0.27, 0.15, 0.15, 0.2, 0.23], yt - h1 - gy - h2 - gy)):
        tot, x = sum(ws), X0
        avail = X1 - X0 - (len(names) - 1) * gx
        for i, (nm, wf) in enumerate(zip(names, ws)):
            ww = avail * wf / tot
            out[nm] = (x, yt_ - h2, x + ww if i < len(names) - 1 else X1, yt_)
            x += ww + gx
    return out


def c600_fill(v, P, s, T, tv, cells) -> None:
    c = s.cites
    def src(k):
        t = T.get(k)
        return "SOURCE: " + t.ref if t else "COUNCIL DATA NOT AVAILABLE"
    sd107_plan(P, T, cells["sd_plan"])
    footer(P, cells["sd_plan"], [src(SD + "crossing.width_at_property_boundary_min")])
    sd107_section(P, T, cells["sd_section"])
    footer(P, cells["sd_section"], [src(SD + "slab.thickness_min")])
    sd107_notes_box(P, T, cells["sd_notes"])
    pavement_detail(P, T, cells["pavement"])
    kerb_detail(P, T, cells["kerb"])
    drainage_detail(P, T, cells["drain"])
    osd_detail(P, T, cells["osd"])
    verge_detail(P, T, cells["verge"])
    cl = lambda k, lab: blue_cite(c, k, lab)                                      # noqa: E731
    SEC.detail_sediment_fence(v, P, tv, cells["fence"])
    footer(P, cells["fence"], [x for x in (cl("esc.sediment_fence.post_spacing_m", "POST SPACING"), cl("esc.sediment_fence.trench_depth_mm", "TRENCH DEPTH (UPSLOPE)"),
                                           cl("esc.sediment_fence.return_interval_m", "RETURNS"), cl("esc.sediment_fence.joint_overlap_mm", "JOINT OVERLAP")) if x], h=TXT.SMALL)
    SEC.detail_access(v, P, tv, cells["access"])
    footer(P, cells["access"], [x for x in (cl("esc.access.min_length_m", "MIN LENGTH (BLUE BOOK)"), cl("esc.access.min_length_building_sites_m", "MIN LENGTH (BUILDING SITES 2024)"), cl("esc.access.min_width_m", "MIN WIDTH"), cl("esc.access.thickness_mm", "THICKNESS"),
                                            cl("esc.access.max_aggregate_mm", "MAX AGGREGATE"), cl("esc.access.geotextile_underlay", "UNDERLAY")) if x], h=TXT.SMALL)
    esc_notes_detail(P, T, cells["esc"])
    status_notes_detail(P, T, cells["status"])
