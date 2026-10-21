"""Typical details: cut and fill batters, pavement layers, kerb and gutter profile, ESC details.

Drawn in paper mm on a paper view, in the reference hatches: existing "/" (REF.hatch_existing), proposed "\\" (REF.hatch_proposed), concrete AR-CONC
stipple, bitumen grey.  GEOMETRY IS SCHEMATIC AND NOT TO SCALE.  Every number comes from cited data (``Cites``) or is shown as TBC with the
statement that the COUNCIL STANDARD DRAWING GOVERNS (NOT SELECTED); nothing is invented.  A cited value changes the printed label only, never the
schematic geometry.
"""
from __future__ import annotations

import math

from shapely.geometry import Polygon

from app.agents.sa5_cad_dxf.planset import fonts
from app.agents.sa5_cad_dxf.planset import style as ST

TBC = "TBC"
TBC_STATEMENT = "TBC (COUNCIL STANDARD DRAWING GOVERNS, NOT SELECTED)"
L_LINE, L_BATR, L_NOTE, L_DIM = "C-DETL-LINE", "C-EART-BATR", "C-ANNO-NOTE", "C-ANNO-DIMS"
GREY_BASE, GREY_SUB = (0.74, 0.74, 0.74), (0.87, 0.87, 0.87)

# requirement keys the details read.  When a key is absent the detail says TBC; the keys are looked up, never defaulted.
KEYS = {
    "wearing": ("driveway.pavement.wearing_mm", "access.pavement.wearing_mm"),
    "base": ("driveway.pavement.base_mm", "access.pavement.base_mm"),
    "subbase": ("driveway.pavement.subbase_mm", "access.pavement.subbase_mm"),
    "subgrade": ("driveway.pavement.subgrade_cbr", "access.pavement.subgrade_cbr"),
    "crossfall": ("driveway.crossfall_pct", "access.crossfall_pct"),
    "kerb_height": ("kerb.height_mm", "kerb.profile.height_mm"),
    "kerb_type": ("kerb.profile", "kerb.type"),
    "slab": ("driveway.pavement.slab_mm", "driveway.pavement.concrete_mm", "driveway.pavement.wearing_mm", "access.pavement.wearing_mm"),
    "material": ("driveway.pavement.type", "driveway.pavement.material", "driveway.surface", "driveway.surface_type", "access.pavement.type"),
    "cut_batter": ("earthworks.batter.cut_max_slope", "earthworks.batter.max_slope"),
    "fill_batter": ("earthworks.batter.fill_max_slope", "earthworks.batter.max_slope"),
}


class TypicalValues:
    """Resolver for the numbers on the typical details.  ``text(name)`` is the printed value (cited value or TBC) and ``ref(name)`` the citation."""

    def __init__(self, cites):
        self.c = cites

    def cite(self, name: str):
        for k in KEYS.get(name, (name,)):
            c = self.c.get(k)
            if c is not None:
                return c
        return None

    def has(self, name: str) -> bool:
        return self.cite(name) is not None

    def material(self) -> str | None:
        """'concrete', 'bitumen' or None when the surface is not selected (no cited pavement type): nothing is assumed."""
        c = self.cite("material")
        if c is None:
            return None
        t = str(c.value).upper()
        if "CONCRETE" in t:
            return "concrete"
        if any(w in t for w in ("BITUM", "ASPHALT", "SPRAY", "FLEXIBLE", "SEAL")):
            return "bitumen"
        return None

    def text(self, name: str, unit: str = "") -> str:
        c = self.cite(name)
        if c is None:
            return TBC
        return c.vtext if not unit or c.unit else f"{c.vtext} {unit}"

    def ratio(self, name: str) -> str:
        """Batter ratio label, '1:n' (cited) or '1:n TBC'."""
        c = self.cite(name)
        if c is None:
            return "1:N TBC"
        v = c.value
        if isinstance(v, (int, float)):
            return f"1:{v:g}"
        return str(v).upper().replace("V", "").replace("H", "").replace(" ", "") if str(v).count(":") else str(v).upper()

    def ref(self, name: str) -> str:
        c = self.cite(name)
        return f"[{c.ref}]" if c else ""

    def any_tbc(self, names) -> bool:
        return any(not self.has(n) for n in names)


# ------------------------------------------------------------------------------------------------------------------- primitives
def hatch(v, pts, kind: str) -> None:
    """Reference hatch over a polygon: existing "/" or proposed "\\", black hatch lines and outline."""
    ang, sp = ST.REF.hatch_existing if kind == "existing" else ST.REF.hatch_proposed
    v.fill(Polygon(pts), L_LINE, ST.BLACK, 1.0, (ang, sp * 0.7), None, True, pattern="LINES", edge=ST.BLACK, edge_lw=0.25, hatch_lw=ST.REF.hatch_lw * 0.8)


def stipple(v, pts) -> None:
    v.fill(Polygon(pts), L_LINE, (0.9, 0.9, 0.9), 1.0, None, None, True, pattern="AR-CONC", edge=ST.BLACK, edge_lw=0.3, stipple=ST.LIGHT_STIPPLE_MM * 0.7)


def grey(v, pts, col=GREY_BASE) -> None:
    v.fill(Polygon(pts), L_LINE, col, 1.0, None, None, True, edge=ST.BLACK, edge_lw=0.25)


def dim_v(P, x: float, y0: float, y1: float, text: str, side: int = 1, h: float = ST.TXT.BODY, ext_to: float | None = None) -> None:
    """Vertical dimension at x between y0 and y1; ticks, text to the right (side 1) or left (side -1) of the line."""
    P.line([(x, y0), (x, y1)], L_DIM, 0.2)
    for y in (y0, y1):
        P.line([(x - 1.2, y - 1.2), (x + 1.2, y + 1.2)], L_DIM, 0.3)
    if ext_to is not None:
        for y in (y0, y1):
            P.line([(ext_to, y), (x + 1.5 * (1 if x >= ext_to else -1), y)], L_DIM, 0.1, ST.GRID)
    P.text(x + side * 2.0, (y0 + y1) / 2, text, h, "MIDDLE_LEFT" if side > 0 else "MIDDLE_RIGHT", layer=L_DIM)


def dim_h(P, y: float, x0: float, x1: float, text: str, h: float = ST.TXT.BODY, below: bool = True) -> None:
    P.line([(x0, y), (x1, y)], L_DIM, 0.2)
    for x in (x0, x1):
        P.line([(x - 1.2, y - 1.2), (x + 1.2, y + 1.2)], L_DIM, 0.3)
    P.text((x0 + x1) / 2, y + (-1.8 if below else 2.6), text, h, "TOP_CENTER" if below else "BOTTOM_CENTER", layer=L_DIM)


def callout(v, P, lines, box_xy, target, w: float = 52.0, h: float = ST.TXT.BODY, dot: bool = True, bold_first: bool = True) -> tuple:
    """Boxed UPPERCASE call-out with a leader to ``target`` (paper mm).  ``box_xy`` is the top-left corner of the box.  Returns the box (x0, y0, x1, y1)."""
    lines = [ST.clean(x).upper() for x in lines if x]
    wr = []
    for i, ln in enumerate(lines):
        wr += fonts.wrap(ln, h, w - 3.0, bold_first and i == 0)
    bh = 2.6 + (h + 1.1) * len(wr)
    tw = max(fonts.text_width(t, h, bold_first and i == 0) for i, t in enumerate(wr)) if wr else 10.0
    bw = min(w, tw + 3.4)
    x0, y1 = box_xy
    y0 = y1 - bh
    x1 = x0 + bw
    P.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], L_NOTE, ST.WHITE, edge=ST.BLACK, edge_lw=0.25)
    for i, t in enumerate(wr):
        P.text(x0 + 1.7, y1 - 1.5 - (h + 1.1) * i, t, h, "TOP_LEFT", bold=(bold_first and i < len(fonts.wrap(lines[0], h, w - 3.0, True))), layer=L_NOTE)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    sx = x1 if target[0] > x1 else (x0 if target[0] < x0 else cx)
    sy = y0 if target[1] < y0 and sx == cx else (y1 if target[1] > y1 and sx == cx else cy)
    P.line([(sx, sy), target], L_NOTE, 0.2)
    if dot:
        P.circle(target[0], target[1], 0.7, L_NOTE, 0.2, ST.BLACK, ST.BLACK)
    return (x0, y0, x1, y1)


def slope_tag(P, x0, y0, x1, y1, label: str, h: float = ST.TXT.BODY, off: float = 3.0) -> None:
    """Ratio label set along a sloping line, on its upper side: the slope is drawn with a 1:n label."""
    ang = math.degrees(math.atan2(y1 - y0, x1 - x0))
    ang = ang + 180 if ang > 90 or ang < -90 else ang
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    nx, ny = -math.sin(math.radians(ang)), math.cos(math.radians(ang))
    if ny < 0:
        nx, ny = -nx, -ny
    P.text(mx + nx * off, my + ny * off, label, h, "MIDDLE_CENTER", ang, bold=True, layer=L_NOTE)


def gradient_triangle(P, x: float, y: float, run: float, rise: float, label: str) -> None:
    """Right triangle (1 vertical over n horizontal) with its ratio label, the usual way a batter is dimensioned."""
    P.line([(x, y), (x + run, y), (x + run, y + rise)], L_DIM, 0.2)
    P.text(x + run + 1.5, y + rise / 2, "1", ST.TXT.BODY, "MIDDLE_LEFT", layer=L_DIM)
    P.text(x + run / 2, y - 1.4, "N  (" + label + ")", ST.TXT.BODY, "TOP_CENTER", layer=L_DIM)


def shift(r: tuple, yb: float, dh: float, foot: float = 48.0) -> float:
    """Vertical centring of a detail drawing between its title and the footer lines of the box."""
    return yb - max(0.0, ((yb - (r[1] + foot)) - dh) / 2.0)


def title(v, P, x0: float, ytop: float, w: float, text: str, sub: str = "") -> float:
    """Detail title: bold UPPERCASE with a red underline (same style as the sheet title strip); returns the y below it."""
    t = ST.clean(text).upper()
    P.text(x0 + 3.0, ytop - 3.0, t, ST.TXT.DETAIL_TITLE, "TOP_LEFT", bold=True, layer=L_NOTE)
    yu = ytop - 3.0 - ST.TXT.DETAIL_TITLE - 1.6
    P.line([(x0 + 3.0, yu), (x0 + 3.0 + max(fonts.text_width(t, ST.TXT.DETAIL_TITLE, True), 30.0), yu)], L_NOTE, 0.7, (0.80, 0.08, 0.08))
    if sub:
        P.text(x0 + 3.0, yu - 1.6, ST.clean(sub).upper(), ST.TXT.BODY, "TOP_LEFT", layer=L_NOTE)
        return yu - 1.6 - ST.TXT.BODY - 2.0
    return yu - 3.0


# ------------------------------------------------------------------------------------------------------------------- pavement layers
NOT_SELECTED = "PAVEMENT TYPE NOT SELECTED, THICKNESS TBC"
PLAIN = (0.97, 0.97, 0.97)


def layer_spec(tv: TypicalValues) -> list[tuple[str, str, str]]:
    """(thickness key, label, fill) per layer for the surface type; nothing implies a type that is not selected.
    concrete: slab over subbase; bitumen or asphalt: wearing, base, subbase; not selected: plain layers named only by number."""
    m = tv.material()
    if m == "concrete":
        return [("slab", "CONCRETE SLAB", "stipple"), ("subbase", "SUBBASE", "sub")]
    if m == "bitumen":
        return [("wearing", "WEARING COURSE", "bitumen"), ("base", "BASE COURSE", "base"), ("subbase", "SUBBASE", "sub")]
    return [("layer1", "PAVEMENT LAYER 1", "plain"), ("layer2", "PAVEMENT LAYER 2", "plain"), ("layer3", "PAVEMENT LAYER 3", "plain")]


def _fill(v, poly, kind: str) -> None:
    if kind == "stipple":
        stipple(v, poly)
    elif kind == "bitumen":
        grey(v, poly, ST.BITUMEN)
    elif kind == "base":
        grey(v, poly, GREY_BASE)
    elif kind == "sub":
        grey(v, poly, GREY_SUB)
    else:
        grey(v, poly, PLAIN)


def pavement_layers(v, P, tv: TypicalValues, x0: float, x1: float, ytop: float, thick: float = 7.0, crossfall: bool = True) -> tuple[float, float]:
    """Layered pavement section across a driveway (width x0..x1, surface at ytop, falling with the crossfall): the layers for the selected surface
    type (see ``layer_spec``), subgrade, a thickness label per layer and the crossfall.  Returns (y of the bottom of the subgrade, x of the label column)."""
    spec = layer_spec(tv)
    n = len(spec)
    drop = 3.0 if crossfall else 0.0                                      # graphic crossfall (not a design value)
    ys = lambda x, k: ytop - drop * (x - x0) / max(x1 - x0, 1e-6) - k * thick       # noqa: E731  layer k top surface at x
    for k, (_n, _lab, kind) in enumerate(spec):
        _fill(v, [(x0, ys(x0, k)), (x1, ys(x1, k)), (x1, ys(x1, k + 1)), (x0, ys(x0, k + 1))], kind)
    sub = 1.6 * thick
    hatch(v, [(x0, ys(x0, n)), (x1, ys(x1, n)), (x1, ys(x1, n) - sub), (x0, ys(x0, n) - sub)], "existing")
    xd = x1 + 5.0
    for k in range(n + 1):
        P.line([(x1, ys(x1, k)), (xd + 1.5, ys(x1, k))], L_DIM, 0.1, ST.GRID)
    for k, (name, lab, _kind) in enumerate(spec):
        dim_v(P, xd, ys(x1, k + 1), ys(x1, k), "", 1)
        P.text(xd + 3.0, (ys(x1, k) + ys(x1, k + 1)) / 2, f"{lab}  T = {tv.text(name, 'mm')}", ST.TXT.BODY, "MIDDLE_LEFT", layer=L_DIM, bold=tv.has(name))
    P.text(xd + 3.0, ys(x1, n) - 0.4 * thick, "SUBGRADE (EXISTING, COMPACTED)", ST.TXT.BODY, "MIDDLE_LEFT", layer=L_DIM)
    P.text(xd + 3.0, ys(x1, n) - 1.2 * thick, f"CBR {tv.text('subgrade')}" if tv.has("subgrade") else "CBR TBC", ST.TXT.BODY, "MIDDLE_LEFT", layer=L_DIM)
    if crossfall:
        slope_tag(P, x0, ytop, x1, ytop - drop, f"CROSSFALL {tv.text('crossfall', '%')}", ST.TXT.BODY, 3.2)
    return ys(x1, n) - sub, xd


LAYBACK_RISE, LAYBACK_RUN, GUTTER_RUN = 5.0, 9.0, 8.0         # graphic proportions only (mm at S = 1), not design values


def kerb_gutter_profile(v, P, tv: TypicalValues, x: float, y: float, s: float = 1.0, depth: float | None = None) -> dict:
    """LAID-BACK (layback) kerb and gutter profile, schematic, concrete stipple: the gutter lip at (x, y), a flat gutter, then the layback face rising
    at a flat angle to the top of kerb, where the driveway layover begins.  There is no barrier upstand.  The proportions are graphic only (the
    council standard drawing governs).  Returns key points."""
    f = s
    xl0 = x + GUTTER_RUN * f                                     # foot of the layback
    xt = xl0 + LAYBACK_RUN * f                                   # top of the layback
    top = y + LAYBACK_RISE * f
    dp = 10.0 * f if depth is None else depth                    # the kerb body runs down to the top of the base course when the caller gives its level
    prof = [(x, y), (xl0, y), (xt, top), (xt + 2.0 * f, top), (xt + 2.0 * f, y - dp), (x, y - dp)]
    stipple(v, prof)
    P.line([(x, y), (xl0, y), (xt, top), (xt + 2.0 * f, top)], L_LINE, 0.5, ST.BLACK)
    return {"lip": (x, y), "foot": (xl0, y), "face_top": (xt, top), "back": (xt + 2.0 * f, top), "bot": (xt + 2.0 * f, y - dp), "x1": xt + 2.0 * f, "top": top}


# ------------------------------------------------------------------------------------------------------------------- detail drawings (each in a box)
def detail_driveway_pavement(v, P, tv: TypicalValues, r: tuple, foot: list | None = None) -> None:
    x0, y0, x1, y1 = r
    W = x1 - x0
    yb = title(v, P, x0, y1, W, "DRIVEWAY PAVEMENT SECTION", "TYPICAL, NOT TO SCALE")
    n = len(layer_spec(tv))
    avail = (yb - (y0 + 24.0))
    Sp = max(1.0, min(2.2, avail / (34.0 + 9.0 * (n + 1.6))))               # enlarge the section to the room the box offers
    thick = 9.0 * Sp
    yb = shift(r, yb, 30.0 + thick * (n + 1.6) + 4.0, 24.0)
    ytop = yb - 30.0
    xa = x0 + 14.0
    lab_w = max(fonts.text_width(t_, ST.TXT.BODY) for t_ in ("SUBGRADE (EXISTING, COMPACTED)", "PAVEMENT LAYER 3  T = TBC", "WEARING COURSE  T = TBC")) + 14.0
    xb = max(xa + 60.0, x1 - 8.0 - lab_w - 5.0)                                # the section runs to the label column, which ends at the cell edge
    pavement_layers(v, P, tv, xa, xb, ytop, thick)
    m = tv.material()
    surf = {"concrete": "CONCRETE", "bitumen": "BITUMEN OR ASPHALT"}.get(m, NOT_SELECTED)
    callout(v, P, ["PROPOSED DRIVEWAY SURFACE", surf], (x0 + 8.0, ytop + 26.0), (xa + 0.12 * (xb - xa), ytop - 0.4 * 3.0 * 0.12), 62.0)
    if foot is not None:
        foot.append("DRIVEWAY WIDTH: SEE C101 AND C400.")
        if m is None:
            foot.append(NOT_SELECTED + ".")
        names = [nm for nm, _l, _k in layer_spec(tv)] + ["crossfall"]
        foot.append("LAYER THICKNESSES, SUBGRADE AND CROSSFALL: " + (TBC_STATEMENT if tv.any_tbc(names + ["subgrade"]) else "CITED"))


def detail_kerb_layover(v, P, tv: TypicalValues, r: tuple, foot: list | None = None, gutter_w_text: str = "", fall: int | None = None) -> None:
    """Road pavement (assumed, bitumen grey), LAYBACK kerb and gutter profile (concrete assumed; the gutter lip runs into the layback, no barrier
    upstand) and the driveway layover from the top of the layback to the boundary.  ``fall``: None draws the layover level ("LAYOVER GRADE TBC"),
    -1 falls from the kerb towards the lot and +1 rises, as read from the existing surface by the caller (diagrammatic: no verge design exists)."""
    x0, y0, x1, y1 = r
    W = x1 - x0
    yb = title(v, P, x0, y1, W, "KERB AND GUTTER, LAYOVER SECTION", "TYPICAL, NOT TO SCALE")
    # the drawing and its call-outs occupy 26 S + 79 mm (top call-out 5 S + 48 above the gutter lip, layback call-out 21 S + 31 below it): S fills the cell
    S = max(1.0, min(3.0, ((yb - (y0 + 24.0)) - 79.0) / 26.0))
    yg = yb - 2.0 - 5.0 * S - 48.0                                             # gutter lip level
    xr0, xk = x0 + 6.0, x0 + 0.26 * W
    road_top = yg - 2.0
    th = 7.0 * S
    xb = x1 - max(0.07 * W, 30.0)                                              # property boundary, near the right edge of the cell
    grey(v, [(xr0, road_top), (xk, yg), (xk, yg - th), (xr0, road_top - th)], ST.BITUMEN)
    grey(v, [(xr0, road_top - th), (xk, yg - th), (xk, yg - 2 * th), (xr0, road_top - 2 * th)], GREY_BASE)
    grey(v, [(xr0, road_top - 2 * th), (xk, yg - 2 * th), (xk, yg - 3 * th), (xr0, road_top - 3 * th)], GREY_SUB)
    hatch(v, [(xr0, road_top - 3 * th), (xk, yg - 3 * th), (xk, yg - 3 * th - 9), (xr0, road_top - 3 * th - 9)], "existing")
    k = kerb_gutter_profile(v, P, tv, xk, yg, S, depth=th)                       # kerb body down to the top of the base course
    yv = k["top"]                                                          # the layover starts at the top of the layback (no upstand)
    ybnd = yv + (0.0 if fall is None else (-6.0 if fall < 0 else 6.0))
    m = tv.material()
    ybot = yg - th                                                         # the layover slab sits on the same base course as the road: no void under the kerb
    slab = [(k["x1"], yv), (xb, ybnd), (xb, ybot), (k["x1"], ybot)]
    if m == "concrete":
        stipple(v, slab)
    elif m == "bitumen":
        grey(v, slab, ST.BITUMEN)
    else:
        grey(v, slab, PLAIN)                                               # layover surface type not selected: plain, no stipple
    grey(v, [(xk, yg - th), (xb, yg - th), (xb, yg - 2 * th), (xk, yg - 2 * th)], GREY_BASE if m else PLAIN)          # base course continues under the kerb and the layover
    grey(v, [(xk, yg - 2 * th), (xb, yg - 2 * th), (xb, yg - 3 * th), (xk, yg - 3 * th)], GREY_SUB if m else PLAIN)
    hatch(v, [(xk, yg - 3 * th), (xb, yg - 3 * th), (xb, yg - 3 * th - 9), (xk, yg - 3 * th - 9)], "existing")
    P.line([(xb, max(yv, ybnd) + 14.0), (xb, yg - 3 * th - 12.0)], L_LINE, 0.3, ST.BLACK, dash="DASHED")
    P.text(xb, max(yv, ybnd) + 15.5, "PROPERTY BOUNDARY", ST.TXT.BODY, "BOTTOM_CENTER", layer=L_NOTE)
    grade = {None: "LAYOVER GRADE " + tv.text("crossfall", "%"), -1: "LAYOVER GRADE FALLS TOWARDS THE LOT (DIAGRAMMATIC)", 1: "LAYOVER GRADE RISES TO THE BOUNDARY (DIAGRAMMATIC)"}[fall]
    if fall is None:
        slope_tag(P, k["x1"], yv, xb, ybnd, grade, ST.TXT.BODY, 3.0)
    else:
        wr = fonts.wrap(grade, ST.TXT.BODY, 46.0)                                                    # right aligned and wrapped: clear of the layover call-out leader and the boundary line
        for i_, ln_ in enumerate(wr):
            P.text(xb - 3.0, max(yv, ybnd) + 4.5 + 3.4 * (len(wr) - 1 - i_), ln_, ST.TXT.BODY, "BOTTOM_RIGHT", layer=L_NOTE)
    dim_v(P, k["foot"][0] - 3.0 * S, yg, k["top"], "", 1)
    P.text(k["foot"][0] - 3.0 * S - 2.0, yg + LAYBACK_RISE * S / 2, f"LAYBACK HEIGHT {tv.text('kerb_height', 'mm')}", ST.TXT.BODY, "MIDDLE_RIGHT", layer=L_DIM)
    dim_h(P, yg + LAYBACK_RISE * S + 7.0, xk, k["foot"][0], f"GUTTER {gutter_w_text or TBC}", ST.TXT.BODY, below=False)
    callout(v, P, ["LAYBACK KERB AND GUTTER", f"CONCRETE ASSUMED, PROFILE {tv.text('kerb_type')}", "GUTTER LIP RUNS INTO THE LAYBACK"], (xk + 4.0, yg - 3 * th - 9.0 - 8.0), (xk + 14.0 * S, yg - 1.0), 52.0)
    lay = "DRIVEWAY LAYOVER" if m is None else ("DRIVEWAY LAYOVER SLAB" if m == "concrete" else "DRIVEWAY LAYOVER")
    lay2 = NOT_SELECTED if m is None else ("CONCRETE" if m == "concrete" else "BITUMEN OR ASPHALT")
    callout(v, P, [lay, lay2, f"T = {tv.text('slab' if m == 'concrete' else 'wearing', 'mm')}"], (k["x1"] + 8.0, max(yv, ybnd) + 34.0), (k["x1"] + 24.0, yv - 2.0), 54.0)
    callout(v, P, ["ROAD PAVEMENT (ASSUMED)", "CROSSFALL TBC"], (xr0, yg + LAYBACK_RISE * S + 26.0), (xr0 + 5.0, road_top - 2.0), 34.0)
    if foot is not None:
        foot.append("LAYER THICKNESSES: SEE THE DRIVEWAY PAVEMENT SECTION. LAYBACK HEIGHT, GUTTER WIDTH AND CROSSFALLS: " + (TBC_STATEMENT if tv.any_tbc(("kerb_height", "crossfall")) else "CITED, SEE VALUES"))
        foot.append("NO VERGE DESIGN: THE LAYOVER GRADE IS DIAGRAMMATIC.")


def detail_batter(v, P, tv: TypicalValues, r: tuple, kind: str, foot: list | None = None) -> None:
    """CUT or FILL batter.  Cut: the existing ground line continues over the platform (dashed over the material to be removed), batter from the
    crest to the toe, platform to the daylight point, existing ground "/" below.  Fill: fill body under the platform "\\", batter from the crest
    down to existing ground, existing ground "/" below.  Slopes are graphic only; the printed ratio is the cited value or 1:N TBC."""
    x0, y0, x1, y1 = r
    W = x1 - x0
    cut = kind == "cut"
    name = "cut_batter" if cut else "fill_batter"
    yb = title(v, P, x0, y1, W, ("CUT" if cut else "FILL") + " BATTER (TYPICAL SECTION)", "NOT TO SCALE. SLOPE DRAWN FOR GRAPHIC PURPOSES")
    yb = shift(r, yb, 108.0, 24.0)
    Wd = W - 12.0                                                          # the drawing runs the full width of its cell
    xs0, xs1 = (x0 + x1) / 2 - Wd / 2, (x0 + x1) / 2 + Wd / 2
    g = 1.0
    m = 0.16 * min(1.0, 340.0 / Wd)                                        # graphic slope of existing ground, falling to the right (flatter in a wider cell so the drop stays inside the box)
    sl = 1.0 / 1.5                                                         # graphic batter slope
    hgt = 18.0
    xb_ = xs0 + 16.0
    rat = tv.ratio(name)
    if cut:
        yp = yb - 62.0                                                     # platform level
        xd = xs0 + 16.0 + hgt / m + 8.0                                    # daylight point: ground falls to the platform level
        xc = xd - hgt / m                                                  # crest on the ground
        xt = xc + hgt / sl                                                 # toe at platform level
        gs = lambda x: yp + m * (xd - x)                                   # noqa: E731
        base = min(yp - 24.0, gs(xs1) - 14.0)
        hatch(v, [(xs0, gs(xs0)), (xc, gs(xc)), (xt, yp), (xd, yp), (xs1, gs(xs1)), (xs1, base), (xs0, base)], "existing")
        v.fill(Polygon([(xc, gs(xc)), (xt, yp), (xd, yp)]), L_LINE, (1.0, 1.0, 1.0), 1.0, None, None, True, edge=ST.BLACK, edge_lw=0.2)
        P.line([(xs0, gs(xs0)), (xc, gs(xc))], L_BATR, 0.5, ST.BLACK)
        P.line([(xd, yp), (xs1, gs(xs1))], L_BATR, 0.5, ST.BLACK)
        P.line([(xc, gs(xc)), (xd, yp)], L_BATR, 0.4, ST.BLACK, dash="DASHED")           # existing ground continues over the platform
        P.line([(xc, gs(xc)), (xt, yp)], L_BATR, 0.9, (0.85, 0.15, 0.1))
        P.line([(xt, yp), (xd, yp)], L_BATR, 0.7, ST.BLACK)
        yair = gs(xs0) + 14.0
        callout(v, P, ["EXISTING MATERIAL TO BE REMOVED"], (xs0 + 92.0, yair + 24.0), ((xc + xd) / 2 + 2.0, (gs((xc + xd) / 2) + yp) / 2 + 1.5), 60.0)
        callout(v, P, ["CUT BATTER " + rat, "TOP OF CUT AT CREST"], (xs0 + 4.0, yair + 24.0), (xc + (xt - xc) * 0.5 - 1.0, gs(xc) - (gs(xc) - yp) * 0.5 + 0.5), 52.0)
        callout(v, P, ["PROPOSED PLATFORM LEVEL", "(LEVEL BY DESIGN)"], (xd + 8.0, yp + 26.0), (xd - 6.0, yp), 56.0)
        callout(v, P, ["EXISTING GROUND", "HATCH \"/\""], (xs1 - 52.0, gs(xs1) + 24.0), (xs1 - 14.0, gs(xs1 - 14.0) - 5.0), 44.0)
        gradient_triangle(P, xd + 80.0, yp + 4.0, 24.0, 16.0, rat)
    else:
        yp = yb - 40.0                                                     # platform level
        xd = xs0                                                           # existing ground starts level with the platform and falls to the right
        xc = xd + hgt / m                                                  # toe on the ground
        xt = xc - hgt / sl
        gs = lambda x: yp - m * (x - xd)                                   # noqa: E731
        base = gs(xs1) - 14.0
        hatch(v, [(xs0, yp), (xc, gs(xc)), (xs1, gs(xs1)), (xs1, base), (xs0, base)], "existing")
        hatch(v, [(xs0, yp), (xt, yp), (xc, gs(xc))], "proposed")           # fill body under the platform
        P.line([(xs0, yp), (xt, yp)], L_BATR, 0.8, ST.BLACK)
        P.line([(xt, yp), (xc, gs(xc))], L_BATR, 0.9, (0.1, 0.6, 0.2))
        P.line([(xs0, yp), (xc, gs(xc))], L_BATR, 0.5, ST.BLACK, dash="DASHED")          # original ground under the fill
        P.line([(xc, gs(xc)), (xs1, gs(xs1))], L_BATR, 0.5, ST.BLACK)
        callout(v, P, ["PROPOSED FILL (COMPACTED IN LAYERS BY DESIGN)", "HATCH \"\\\""], (xs0 + 4.0, yp - 4.0 - hgt - 26.0 + 0.0), ((xs0 + xt) / 2 + 6.0, yp - 3.0), 70.0)
        callout(v, P, ["FILL BATTER " + rat], (xt + 6.0, yp + 30.0), ((xt + xc) / 2 + 1.0, (yp + gs(xc)) / 2 + 0.5), 46.0)
        callout(v, P, ["PROPOSED PLATFORM LEVEL", "(LEVEL BY DESIGN)"], (xs0 + 4.0, yp + 30.0), (xs0 + 18.0, yp), 52.0)
        callout(v, P, ["TOE OF FILL", "KEY INTO EXISTING GROUND TBC"], (xc + 14.0, gs(xc) + 28.0), (xc, gs(xc)), 54.0)
        callout(v, P, ["EXISTING GROUND", "HATCH \"/\""], (xs1 - 52.0, gs(xs1) - 8.0), (xs1 - 14.0, gs(xs1 - 14.0) - 5.0), 44.0)
        gradient_triangle(P, xc + 50.0, gs(xc) + 8.0, 24.0, 16.0, rat)
    if foot is not None:
        foot.append(("BATTER SLOPE: " + rat + " " + tv.ref(name)) if tv.has(name) else "BATTER SLOPE 1:N: " + TBC_STATEMENT)


def detail_batter_cut(v, P, tv, r, foot=None):
    detail_batter(v, P, tv, r, "cut", foot)


def detail_batter_fill(v, P, tv, r, foot=None):
    detail_batter(v, P, tv, r, "fill", foot)


def detail_sediment_fence(v, P, tv: TypicalValues, r: tuple) -> None:
    x0, y0, x1, y1 = r
    yb = title(v, P, x0, y1, x1 - x0, "SEDIMENT FENCE", "TYPICAL, NOT TO SCALE")
    yb = shift(r, yb, 85.0)
    yg = yb - 50.0
    grey(v, [(x0 + 6.0, yg - 20.0), (x1 - 6.0, yg - 20.0), (x1 - 6.0, yg), (x0 + 6.0, yg)], (0.96, 0.96, 0.96))
    hatch(v, [(x0 + 6.0, yg - 6.0), (x1 - 6.0, yg - 6.0), (x1 - 6.0, yg - 20.0), (x0 + 6.0, yg - 20.0)], "existing")
    P.line([(x0 + 6.0, yg), (x1 - 6.0, yg)], L_LINE, 0.6, ST.BLACK)
    xp = (x0 + x1) / 2
    P.line([(xp, yg - 14.0), (xp, yg + 34.0)], L_LINE, 0.9, ST.BLACK)                     # post
    P.line([(xp + 3.0, yg - 6.0), (xp + 3.0, yg + 32.0)], L_LINE, 0.5, (0.1, 0.4, 0.1))      # fabric, downslope side
    P.line([(xp + 3.0, yg - 6.0), (xp + 14.0, yg - 6.0)], L_LINE, 0.5, (0.1, 0.4, 0.1))
    P.line([(xp + 14.0, yg - 6.0), (xp + 14.0, yg)], L_LINE, 0.3, ST.BLACK, dash="DASHED")
    callout(v, P, ["STAR PICKET / POST", "SPACING " + tv.text("esc.sediment_fence.post_spacing_m")], (x0 + 4.0, yg + 40.0), (xp, yg + 24.0), 46.0)
    callout(v, P, ["GEOTEXTILE FABRIC", "FABRIC HEIGHT " + TBC], (xp + 8.0, yg + 40.0), (xp + 3.0, yg + 28.0), 46.0)
    callout(v, P, ["TRENCH, BACKFILLED AND COMPACTED", "DEPTH " + tv.text("esc.sediment_fence.trench_depth_mm")], (xp + 18.0, yg - 12.0), (xp + 14.0, yg - 3.0), 52.0)
    P.text(x0 + 8.0, yg + 3.0, "UPSLOPE", ST.TXT.BODY, "BOTTOM_LEFT", layer=L_NOTE, bold=True)
    P.text(x1 - 8.0, yg + 3.0, "DOWNSLOPE", ST.TXT.BODY, "BOTTOM_RIGHT", layer=L_NOTE, bold=True)


def detail_access(v, P, tv: TypicalValues, r: tuple) -> None:
    x0, y0, x1, y1 = r
    yb = title(v, P, x0, y1, x1 - x0, "STABILISED SITE ACCESS", "TYPICAL SIDE SECTION, NOT TO SCALE")
    yb = shift(r, yb, 80.0)
    yg = yb - 44.0
    xa0, xa1 = x0 + 10.0, x1 - 62.0
    hatch(v, [(xa0 - 4.0, yg - 8.0), (xa1 + 4.0, yg - 8.0), (xa1 + 4.0, yg - 22.0), (xa0 - 4.0, yg - 22.0)], "existing")
    grey(v, [(xa0, yg - 3.0), (xa1, yg - 3.0), (xa1, yg - 8.0), (xa0, yg - 8.0)], (0.9, 0.9, 0.9))
    grey(v, [(xa0, yg + 5.0), (xa1, yg + 5.0), (xa1, yg - 3.0), (xa0, yg - 3.0)], GREY_BASE)
    P.line([(xa0 - 4.0, yg - 8.0), (xa1 + 4.0, yg - 8.0)], L_LINE, 0.4, (0.1, 0.1, 0.1), dash="DASHED")
    dim_v(P, xa1 + 8.0, yg - 3.0, yg + 5.0, "", 1)
    P.text(xa1 + 10.0, yg + 1.0, "THICKNESS " + tv.text("esc.access.thickness_mm"), ST.TXT.BODY, "MIDDLE_LEFT", layer=L_DIM)
    dim_h(P, yg - 28.0, xa0, xa1, "LENGTH " + tv.text("esc.access.min_length_m") + "   WIDTH " + tv.text("esc.access.min_width_m"), ST.TXT.BODY)
    callout(v, P, ["AGGREGATE", "MAX SIZE " + tv.text("esc.access.max_aggregate_mm")], (x0 + 4.0, yg + 38.0), (xa0 + 24.0, yg + 2.0), 46.0)
    callout(v, P, ["GEOTEXTILE UNDERLAY", tv.text("esc.access.geotextile_underlay")], (x0 + 70.0, yg + 38.0), (xa0 + 50.0, yg - 5.5), 54.0)
    callout(v, P, ["ROAD / SITE BOUNDARY"], (xa1 - 36.0, yg + 18.0), (xa1, yg + 5.0), 36.0)


def detail_trench(v, P, tv: TypicalValues, r: tuple) -> None:
    x0, y0, x1, y1 = r
    yb = title(v, P, x0, y1, x1 - x0, "PIPE TRENCH AND BEDDING", "SCHEMATIC, NOT TO SCALE")
    yb = shift(r, yb, 90.0)
    yg = yb - 14.0
    xl, xr = (x0 + x1) / 2 - 30.0, (x0 + x1) / 2 + 30.0
    yt = yg - 52.0
    hatch(v, [(x0 + 4.0, yg), (xl, yg), (xl, yt), (x0 + 4.0, yt)], "existing")
    hatch(v, [(xr, yg), (x1 - 4.0, yg), (x1 - 4.0, yt), (xr, yt)], "existing")
    grey(v, [(xl, yg), (xr, yg), (xr, yt + 18.0), (xl, yt + 18.0)], (0.97, 0.97, 0.97))
    grey(v, [(xl, yt + 18.0), (xr, yt + 18.0), (xr, yt), (xl, yt)], GREY_SUB)
    P.line([(x0 + 4.0, yg), (xl, yg), (xl, yt), (xr, yt), (xr, yg), (x1 - 4.0, yg)], L_LINE, 0.6, ST.BLACK)
    P.circle((xl + xr) / 2, yt + 13.0, 8.0, L_LINE, 0.5, ST.BLACK, ST.WHITE)
    dim_v(P, xl + 6.0, yg, yt + 21.0, "", 1)
    P.text(xl + 9.0, (yg + yt + 21.0) / 2, "COVER " + (tv.text("water.min_cover_m") if tv.has("water.min_cover_m") else TBC), ST.TXT.BODY, "MIDDLE_LEFT", layer=L_DIM)
    callout(v, P, ["BACKFILL (PER STANDARD)", "COMPACTED IN LAYERS"], (x0 + 4.0, yg - 4.0), ((xl + xr) / 2 - 12.0, yt + 28.0), 46.0)
    callout(v, P, ["PIPE, BEDDING, HAUNCH AND OVERLAY", "TYPE AND THICKNESS PER AS/NZS 3500 AND THE COUNCIL OR WSAA STANDARD DRAWING " + TBC], (x0 + 4.0, yt - 8.0), ((xl + xr) / 2, yt + 6.0), 90.0)


def detail_notes(v, P, tv: TypicalValues, r: tuple, lines: list[str]) -> None:
    x0, y0, x1, y1 = r
    yb = title(v, P, x0, y1, x1 - x0, "STATUS OF DETAILS")
    y = yb - 2.0
    for ln in lines:
        for w in fonts.wrap(ST.clean(ln).upper(), ST.TXT.BODY, x1 - x0 - 8.0):
            if y < y0 + 3.0:
                return
            P.text(x0 + 4.0, y, w, ST.TXT.BODY, "TOP_LEFT", layer=L_NOTE)
            y -= 3.4
        y -= 1.4


def box(v, P, r: tuple) -> None:
    P.line([(r[0], r[1]), (r[2], r[1]), (r[2], r[3]), (r[0], r[3])], L_NOTE, 0.35, ST.BLACK, closed=True)
