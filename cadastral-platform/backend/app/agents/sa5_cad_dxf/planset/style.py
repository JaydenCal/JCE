"""Reference drafting style (stage 1): colour tokens, hatch and pattern specs, line-style helpers and symbol drawers.

Every number in `Conventions` is a GRAPHIC CONVENTION measured from the engineer's own A1 reference sheet
(JCE-004-CV-1100, vector PDF).  None of it is a requirement, a design value or survey data.  Hatch angles are in degrees
anticlockwise from +x on the sheet; hatch spacings are PERPENDICULAR spacings in paper mm (what both renderers expect).
Symbol drawers work in paper mm so they look the same on any paper size; they are only called when data exist.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from shapely.geometry import Polygon

from app.agents.sa5_cad_dxf.planset import core, fonts
from app.agents.sa5_cad_dxf.planset.core import Item, View


def hex_rgb(h: str) -> tuple:
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (1, 3, 5))


# ---- colour tokens (hex measured from the reference unless noted) -------------------------------------------------------
BLACK = (0.0, 0.0, 0.0)
WHITE = (1.0, 1.0, 1.0)
YELLOW = hex_rgb("#C6BC0C")        # boundary dash overlay
BITUMEN = hex_rgb("#E1E1E1")       # road / bitumen solid (sampled #E1E1E1; brief #E0E0E0)
LAWN = hex_rgb("#DBF4CF")          # landscape light green (sampled from the reference raster)
CONCRETE = hex_rgb("#808080")      # concrete base grey under the AR-CONC stipple
FENCE = hex_rgb("#5A5A5A")         # fence line grey
GRID = hex_rgb("#9C9C9C")          # zone grid ticks
LABEL_GREY = (0.3, 0.3, 0.3)
GOLD = (0.78, 0.60, 0.16)          # same gold as the logo vector fill

DASH_BDY = "JCS_BDY"               # boundary dash linetype (paper mm pattern registered in core.CUSTOM_DASH)


@dataclass(frozen=True)
class Conventions:
    """Graphic conventions copied from the reference sheet, NOT requirements."""
    hatch_existing: tuple = (55.17, 5.08)       # "/" existing building: angle deg, perpendicular spacing mm (6.19 mm horizontal)
    hatch_proposed: tuple = (-34.83, 3.17)      # "\" proposed works: angle deg, perpendicular spacing mm (3.87 mm vertical)
    hatch_lw: float = 0.254
    outline_lw: float = 0.254                   # building, crossover, kerb band outlines
    boundary_lw: float = 0.254                  # black base line under the yellow dashes
    dash_lw: float = 0.80                       # yellow dash thickness
    dash_len: float = 7.37                      # yellow dash length and gap, paper mm
    kerb_lw: float = 0.254
    gutter_lw: float = 0.13
    fence_lw: float = 0.296
    neighbour_lw: float = 0.13
    callout_h: float = 2.5                      # call-out cap height, mm
    callout_pitch: float = 4.2                  # call-out baseline pitch, mm
    callout_pad_x: float = 2.0
    callout_pad_y: float = 1.9
    callout_lw: float = 0.254
    leader_lw: float = 0.254
    leader_landing: float = 10.7                # horizontal landing before the diagonal, mm
    dot_r: float = 2.0                          # dot terminator radius, mm
    arrow_len: float = 4.0
    arrow_half_w: float = 0.9
    label_h: float = 3.0                        # boundary length labels
    lot_h: float = 2.5                          # LOT n
    plan_h: float = 3.5                         # DP number
    road_h: float = 4.8                         # road name
    wing_flare_m: float = 0.5                   # kerb-end wing flare, used only when the SA3 polygon carries no flare
    wing_len_m: float = 1.0                     # crossover wing length along the crossing
    kerb_band_m: float = 0.5                    # kerb and gutter band width
    band_extra_m: float = 1.5                   # band continues past the wings each side
    stipple_spacing_mm: float = 2.4             # AR-CONC look in the PDF: lattice pitch (approximate: marks counted inside the reference's concrete fills give 0.15 to 0.25 per mm2)
    stipple_small_w_mm: float = 0.254           # tiny round dot (zero-length round-capped stroke)
    stipple_big_every: int = 8                  # every 8th mark is a larger round dot or a short dash (measured mix)
    stipple_big_w_mm: float = 0.698             # larger round dot / short dash stroke width
    stipple_dot_len_mm: float = 0.13            # larger dot stroke length
    stipple_dash_len_mm: float = 0.75           # short dash stroke length (near horizontal in the reference)
    stipple_tri_every: int = 6                  # about 1 in 6 marks is a small solid triangle
    stipple_tri_size_mm: float = 0.9            # triangle side


REF = Conventions()
core.CUSTOM_DASH[DASH_BDY] = (REF.dash_len, -REF.dash_len)


def clean(s: str) -> str:
    """No em or en dashes in any rendered text."""
    return str(s).replace("—", "-").replace("–", "-").replace("−", "-")


class Paper:
    """Draw in PAPER mm on any View (paper or model).  Items are annotation items (paper space in the DXF)."""

    def __init__(self, v: View):
        self.v = v

    def xy(self, x: float, y: float) -> tuple:
        return (x, y) if self.v.paper else self.v.tm(x, y)

    def line(self, pts, layer: str, lw: float = 0.25, color=None, dash=None, closed: bool = False) -> None:
        self.v.items.append(Item("line", layer, [self.xy(*p) for p in pts], closed, lw, dash, color, anno=True))

    def poly(self, pts, layer: str, color, lw=None, edge=None, edge_lw=None, alpha: float = 1.0) -> None:
        self.v.items.append(Item("fill", layer, [[self.xy(*p) for p in pts]], True, lw, None, color, alpha, None, anno=True, edge=edge, edge_lw=edge_lw))

    def circle(self, x: float, y: float, r: float, layer: str, lw: float = 0.25, color=None, fill=None, n: int = 28) -> None:
        pts = [(x + r * math.cos(2 * math.pi * i / n), y + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
        if fill is not None:
            self.poly(pts, layer, fill, edge=color, edge_lw=lw)
        else:
            self.line(pts, layer, lw, color, closed=True)

    def text(self, x: float, y: float, s: str, h: float, anchor: str = "MIDDLE_CENTER", rot: float = 0.0, bold: bool = False,
             color=None, layer: str = "C-ANNO-NOTE", halo: bool = False) -> None:
        X, Y = self.xy(x, y)
        self.v.text(X, Y, clean(s), h, anchor, rot if self.v.paper else self.v.model_rot(rot), bold, color=color, layer=layer, halo=halo)      # rot is a PAPER angle


# ---- line-style and fill helpers (model geometry) -----------------------------------------------------------------------
def boundary(v: View, g) -> None:
    """Solid black line with yellow dashes laid over it."""
    v.geom(g, "C-PROP-BDY", lw=REF.boundary_lw, color=BLACK)
    v.geom(g, "C-PROP-BDYD", lw=REF.dash_lw, dash=DASH_BDY, color=YELLOW)


def outline(v: View, g, layer: str = "A-BLDG-PROP", lw: float | None = None) -> None:
    v.geom(g, layer, lw=lw or REF.outline_lw, color=BLACK)


def kerb(v: View, g, gutter: bool = False) -> None:
    v.geom(g, "C-ROAD-KERB", lw=REF.gutter_lw if gutter else REF.kerb_lw, color=FENCE if gutter else BLACK)


def fence(v: View, g) -> None:
    v.geom(g, "C-ROAD-KERB", lw=REF.fence_lw, color=FENCE)


def hatch_fill(v: View, g, kind: str = "proposed", outline_too: bool = True) -> None:
    """Building hatch: kind 'existing' = "/" , 'proposed' = "\\".  Hatch lines only (no background), black outline."""
    ang, sp = REF.hatch_existing if kind == "existing" else REF.hatch_proposed
    v.fill(g, "A-BLDG-EXST" if kind == "existing" else "A-BLDG-PROP", BLACK, 1.0, (ang, sp), None, False, pattern="LINES",
           edge=BLACK if outline_too else None, edge_lw=REF.outline_lw, hatch_lw=REF.hatch_lw)


LIGHT_STIPPLE_MM = 4.6          # lighter stipple pitch (paper mm) for detail sheets where dimensions must read clearly


def concrete_fill(v: View, g, layer: str = "C-ROAD-CONC", edge: bool = True, light: bool = False) -> None:
    v.fill(g, layer, CONCRETE if not light else (0.9, 0.9, 0.9), 1.0, None, None, False, pattern="AR-CONC", edge=BLACK if edge else None, edge_lw=REF.outline_lw,
           stipple=LIGHT_STIPPLE_MM if light else None)


PLAIN_PAVE = (0.95, 0.95, 0.95)      # driveway surface not selected: plain light fill, no pattern implies no material


def driveway_fill(v: View, g, material: str | None, layer: str = "C-DRIV-SURF") -> None:
    """Proposed driveway fill, lighter than the crossover (the owner's reference shows the layover in the dark concrete stipple and the pavement behind
    it light).  The pattern follows the CITED surface type only: concrete = light stipple, bitumen = bitumen grey, not selected = plain light fill."""
    if material == "concrete":
        concrete_fill(v, g, layer, light=True)
    else:
        v.fill(g, layer, BITUMEN if material == "bitumen" else PLAIN_PAVE, 1.0, edge=BLACK, edge_lw=REF.outline_lw)


def bitumen_fill(v: View, g, layer: str = "C-ROAD-PAVE") -> None:
    v.fill(g, layer, BITUMEN, 1.0)


def lawn_fill(v: View, g, layer: str = "C-LAND-LAWN") -> None:
    v.fill(g, layer, LAWN, 1.0)


# ---- symbols (paper mm; (x, y) is a MODEL point for model views, paper point for paper views) ---------------------------
def _at(v: View, x: float, y: float) -> tuple:
    return (x, y) if v.paper else v.tp(x, y)


def hyd(v: View, x: float, y: float) -> None:
    p, (px, py) = Paper(v), _at(v, x, y)
    p.circle(px, py, 3.4, "C-SITE-SYMB", 0.25, FENCE, WHITE)
    p.text(px, py, "HYD", 2.0, "MIDDLE_CENTER", layer="C-SITE-SYMB", color=FENCE)


def tpit(v: View, x: float, y: float) -> None:
    p, (px, py) = Paper(v), _at(v, x, y)
    p.poly([(px - 1.7, py - 1.7), (px + 1.7, py - 1.7), (px + 1.7, py + 1.7), (px - 1.7, py + 1.7)], "C-SITE-SYMB", WHITE, edge=FENCE, edge_lw=0.25)
    p.text(px, py, "T", 2.2, "MIDDLE_CENTER", layer="C-SITE-SYMB", color=FENCE)


def water_meter(v: View, x: float, y: float) -> None:
    p, (px, py) = Paper(v), _at(v, x, y)
    p.poly([(px - 1.6, py - 2.8), (px + 1.6, py - 2.8), (px + 1.6, py + 2.8), (px - 1.6, py + 2.8)], "C-SITE-SYMB", WHITE, edge=FENCE, edge_lw=0.25)
    p.text(px, py, "WM", 1.9, "MIDDLE_CENTER", 90.0, layer="C-SITE-SYMB", color=FENCE)


def grate(v: View, x: float, y: float) -> None:
    p, (px, py) = Paper(v), _at(v, x, y)
    p.poly([(px - 2.5, py - 2.2), (px + 2.5, py - 2.2), (px + 2.5, py + 2.2), (px - 2.5, py + 2.2)], "C-SITE-SYMB", WHITE, edge=FENCE, edge_lw=0.25)
    for i in range(-3, 4):
        p.line([(px + i * 0.65, py - 2.2), (px + i * 0.65, py + 2.2)], "C-SITE-SYMB", 0.1, FENCE)


def tree_canopy(v: View, x: float, y: float, r_m: float) -> None:
    """Irregular canopy outline with radial lines to a centre cross (radius from data, metres)."""
    p, (px, py) = Paper(v), _at(v, x, y)
    r = max(r_m * v.k, 2.0) if not v.paper else max(r_m, 2.0)
    pts = [(px + r * (0.9 + 0.1 * math.sin(5 * a)) * math.cos(a), py + r * (0.9 + 0.1 * math.sin(5 * a)) * math.sin(a))
           for a in (2 * math.pi * i / 36 for i in range(36))]
    p.line(pts, "C-SITE-SYMB", 0.13, FENCE, closed=True)
    for i in range(8):
        a = 2 * math.pi * i / 8
        p.line([(px, py), (px + 0.9 * r * math.cos(a), py + 0.9 * r * math.sin(a))], "C-SITE-SYMB", 0.08, FENCE)
    p.line([(px - 1.0, py), (px + 1.0, py)], "C-SITE-SYMB", 0.18, BLACK)
    p.line([(px, py - 1.0), (px, py + 1.0)], "C-SITE-SYMB", 0.18, BLACK)


def label_masked(v: View, x: float, y: float, s: str, h: float, rot_deg: float, layer: str = "C-ANNO-NOTE", color=None, bold: bool = False, pad: float = 0.9) -> bool:
    """Model-point label on a white mask (as the reference does) if it fits and clears earlier labels; no halo."""
    s, rot = clean(s), (v.paper_rot(rot_deg) if not v.paper else core.upright(rot_deg))        # rot_deg is a MODEL direction; rot the upright paper angle
    px, py = v.tp(x, y)
    box = v._box(px, py, s, h, "MIDDLE_CENTER", rot, bold)
    if not v.free(box):
        return False
    v.occ.append(box)
    v._mask(px, py, fonts.text_width(s, h, bold) + 2 * pad, h + 2 * pad, rot, layer)
    v.text(x, y, s, h, "MIDDLE_CENTER", v.model_rot(rot) if not v.paper else rot, bold, color=color, layer=layer, halo=False)
    return True


def north_point(v: View, px: float, py: float, r: float = 15.0, north_deg: float = 0.0) -> None:
    """North point at PAPER (px, py): circle, long arrow, N at the tip and the words NORTH POINT.  north_deg = clockwise from up."""
    p = Paper(v)
    p.circle(px, py, r, "C-ANNO-NRTH", 0.25, BLACK)
    a = math.radians(north_deg)
    ux, uy = math.sin(a), math.cos(a)
    nx, ny = uy, -ux
    tip = (px + ux * r * 0.95, py + uy * r * 0.95)
    tail = (px - ux * r * 0.7, py - uy * r * 0.7)
    base = (px + ux * r * 0.35, py + uy * r * 0.35)
    p.line([tail, tip], "C-ANNO-NRTH", 0.25, BLACK)
    p.poly([tip, (base[0] + nx * 2.2, base[1] + ny * 2.2), (base[0] - nx * 2.2, base[1] - ny * 2.2)], "C-ANNO-NRTH", BLACK)
    p.text(px + ux * (r + 3.2), py + uy * (r + 3.2), "N", 3.5, "MIDDLE_CENTER", layer="C-ANNO-NRTH", bold=True)
    p.text(px + r + 5.5, py, "NORTH POINT", 3.0, "MIDDLE_CENTER", 90.0, layer="C-ANNO-NRTH")


def scale_bar_ref(v: View, x: float, y: float, scale: int, paper_label: str = "A1") -> float:
    """Four-segment scale bar, lower-left at PAPER (x, y); returns the bar length in mm."""
    p = Paper(v)
    best = 1
    for n in (1, 2, 5, 10, 20, 25, 50, 100, 200, 500):
        if n * 1000.0 / scale <= 90.0:
            best = n
    L = best * 1000.0 / scale
    p.poly([(x - 3, y - 7.5), (x + L + 16, y - 7.5), (x + L + 16, y + 9.5), (x - 3, y + 9.5)], "C-ANNO-NRTH", WHITE)
    for i in range(4):
        x0 = x + i * L / 4
        quad = [(x0, y), (x0 + L / 4, y), (x0 + L / 4, y + 2.0), (x0, y + 2.0)]
        p.poly(quad, "C-ANNO-NRTH", BLACK if i % 2 == 0 else WHITE, edge=BLACK, edge_lw=0.18)
    for i in range(5):
        lab = f"{best * i / 4:g}" + (" m" if i == 4 else "")
        p.text(x + i * L / 4, y + 3.0, lab, 2.2, "BOTTOM_LEFT" if i == 4 else "BOTTOM_CENTER", layer="C-ANNO-NRTH")
    p.text(x, y - 1.2, f"SCALE 1:{scale} @ {paper_label}", 2.5, "TOP_LEFT", bold=True, layer="C-ANNO-NRTH")
    return L
