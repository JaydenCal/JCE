"""Drawing primitives shared by the PDF and DXF renderers.

A Sheet is a list of Views.  A *paper* View uses paper millimetres directly; a *model* View maps model metres (MGA) to paper
millimetres at a chosen scale and clips to its rectangle.  Items are recorded once and rendered by both outputs.
Text heights are CAP HEIGHTS in paper millimetres (min 1.8 mm for anything meant to be read at plot scale).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from shapely.geometry import LineString, Polygon
from shapely.geometry.base import BaseGeometry

from app.agents.sa5_cad_dxf.planset import fonts

STD_SCALES = (50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000)
A3 = (420.0, 297.0)
A1 = (841.0, 594.0)
MIN_TEXT_MM = 1.8
CUSTOM_DASH: dict = {}      # linetype name -> (dash, -gap, ...) in PAPER mm; registered by planset.style, used by both renderers


def pick_scale(w_m: float, h_m: float, vp_w_mm: float, vp_h_mm: float, min_scale: int = 0) -> int:
    """Smallest standard scale denominator (largest drawing) at which a w_m x h_m extent fits the viewport."""
    for s in STD_SCALES:
        if s >= min_scale and w_m * 1000.0 / s <= vp_w_mm and h_m * 1000.0 / s <= vp_h_mm:
            return s
    return STD_SCALES[-1]


@dataclass
class Item:
    kind: str                       # line | fill | text | image
    layer: str
    pts: list | None = None         # line: [(x,y)...]; fill: [ring, ring...] (first = outer; rest holes)
    closed: bool = False
    lw: float | None = None         # mm (None = layer default)
    dash: str | None = None         # linetype name override
    color: tuple | None = None      # RGB 0..1 override
    alpha: float = 1.0
    hatch: tuple | None = None      # (angle_deg, spacing_mm) pattern for fills; None = solid
    text: str = ""
    h: float = 2.5
    anchor: str = "MIDDLE_CENTER"
    rot: float = 0.0
    bold: bool = False
    italic: bool = False
    halo: bool = False
    image: str = ""
    extent: tuple | None = None
    fade: float = 0.0
    anno: bool = False              # annotation: drawn in paper space in the DXF (symbols, text)
    pattern: str | None = None      # named fill pattern: "AR-CONC" = concrete stipple; None = plain solid / line hatch
    edge: tuple | None = None       # RGB outline stroked around a fill (solid, hatched or stippled); None = no outline
    edge_lw: float | None = None    # outline width, mm
    hatch_lw: float | None = None   # hatch line width, mm (None = legacy 0.15)
    stipple: float | None = None    # AR-CONC stipple pitch override, paper mm (None = reference pitch; larger = lighter)


def upright(rot_deg: float) -> float:
    r = rot_deg % 360.0
    if r > 90.0 and r <= 270.0:
        r -= 180.0
    return r - 360.0 if r > 180.0 else r


class View:
    def __init__(self, name: str, rect: tuple[float, float, float, float], centre: tuple[float, float] | None = None,
                 scale: int | None = None, frame: bool = False, clip: bool = True, title: str = "", subtitle: str = "", twist: float = 0.0):
        self.name, self.rect, self.centre, self.scale = name, rect, centre, scale
        self.twist = float(twist or 0.0)                    # degrees, counter-clockwise: rotation of the model drawing on the paper (0 = north up)
        self._c, self._s = math.cos(math.radians(self.twist)), math.sin(math.radians(self.twist))
        self.paper = centre is None
        self.frame, self.clip, self.title, self.subtitle = frame, clip, title, subtitle
        self.items: list[Item] = []
        self.occ: list[tuple[float, float, float, float]] = []      # occupied label boxes (paper mm)
        self.tbox: list[tuple[float, float, float, float]] = []     # paper-mm boxes of placed TEXT only (labels, dimension figures): leaders and other linework never cross them
        self.dropped = 0
        self.dim_lines: list[tuple] = []            # paper-mm dimension lines drawn so far ((x1, y1), (x2, y2)); a new dimension never shares one
        self.dim_geoms: list = []                   # paper-mm LineStrings of every dimension line and extension line drawn (a leader never crosses them)
        self.leader_avoid: list = []                # paper-mm polygons a call-out leader must not cross (the layover wings)
        self.avoid_lines: list = []                 # paper-mm LineStrings (driveway centreline) that dimension text must not sit on
        self.callout_boxes: list[tuple] = []        # paper-mm boxes of call-outs drawn so far (planset.callout)
        self.fallback_notes: list[str] = []         # must-carry call-out text that could not be placed (rendered in the notes panel)
        self.tag_n = 0
        self.leaders: list[list] = []               # paper-mm leader polylines of call-outs drawn so far
        self.k = 1.0 if self.paper else 1000.0 / float(scale)       # paper mm per model metre

    # ---- transforms --------------------------------------------------------------------------------
    @property
    def cx(self) -> float:
        return (self.rect[0] + self.rect[2]) / 2

    @property
    def cy(self) -> float:
        return (self.rect[1] + self.rect[3]) / 2

    @property
    def w(self) -> float:
        return self.rect[2] - self.rect[0]

    @property
    def h_(self) -> float:
        return self.rect[3] - self.rect[1]

    def tp(self, x: float, y: float) -> tuple[float, float]:
        if self.paper:
            return x, y
        dx, dy = (x - self.centre[0]) * self.k, (y - self.centre[1]) * self.k
        return self.cx + dx * self._c - dy * self._s, self.cy + dx * self._s + dy * self._c

    def tm(self, px: float, py: float) -> tuple[float, float]:
        if self.paper:
            return px, py
        dx, dy = px - self.cx, py - self.cy
        return self.centre[0] + (dx * self._c + dy * self._s) / self.k, self.centre[1] + (-dx * self._s + dy * self._c) / self.k

    def model_window(self) -> tuple[float, float, float, float]:
        """Axis-aligned model bounds (x0, y0, x1, y1) of the (possibly rotated) viewport."""
        return self.window_poly().bounds

    def window_poly(self, pad_mm: float = 0.0) -> Polygon:
        """The viewport rectangle (inset by ``pad_mm``, negative = outset) as a model polygon; a rotated view gives a rotated rectangle."""
        r = self.rect
        return Polygon([self.tm(r[0] + pad_mm, r[1] + pad_mm), self.tm(r[2] - pad_mm, r[1] + pad_mm), self.tm(r[2] - pad_mm, r[3] - pad_mm), self.tm(r[0] + pad_mm, r[3] - pad_mm)])

    def to_paper_geom(self, g):
        """Model geometry -> paper-mm geometry through the view transform (scale, twist, offset)."""
        from shapely import affinity
        k, c, s = self.k, self._c, self._s
        X0, Y0 = self.centre
        return affinity.affine_transform(g, [k * c, -k * s, k * s, k * c, self.cx - k * (c * X0 - s * Y0), self.cy - k * (s * X0 + c * Y0)])

    def paper_rot(self, model_deg: float) -> float:
        """Paper angle that reads upright for a text whose baseline runs along the MODEL direction ``model_deg``."""
        return upright(model_deg + self.twist)

    def model_rot(self, paper_deg: float) -> float:
        return paper_deg - self.twist

    def inside(self, x: float, y: float, pad_mm: float = 0.0) -> bool:
        px, py = self.tp(x, y)
        return self.rect[0] + pad_mm <= px <= self.rect[2] - pad_mm and self.rect[1] + pad_mm <= py <= self.rect[3] - pad_mm

    # ---- drawing -----------------------------------------------------------------------------------
    def line(self, pts, layer: str, closed: bool = False, lw: float | None = None, dash: str | None = None,
             color=None, anno: bool = False) -> None:
        pts = [(float(x), float(y)) for x, y in pts]
        if len(pts) >= 2:
            self.items.append(Item("line", layer, pts, closed, lw, dash, color, anno=anno))

    def geom(self, g: BaseGeometry, layer: str, lw: float | None = None, dash: str | None = None, color=None,
             anno: bool = False) -> None:
        """Draw linework of any shapely geometry (polygon rings included), clipped to the view window for efficiency."""
        if g is None or g.is_empty:
            return
        win = None if (self.paper or not self.clip) else self.window_poly().buffer(3.0 / self.k)
        for ln in _lines(g):
            parts = [ln]
            if win is not None:
                if not win.intersects(ln):
                    continue
                if not win.contains(ln):
                    parts = _lines(ln.intersection(win))
            for pn in parts:
                c = list(pn.coords)
                closed = len(c) > 3 and c[0] == c[-1] and pn is ln
                self.line(c[:-1] if closed else c, layer, closed, lw, dash, color, anno)

    def fill(self, g: BaseGeometry, layer: str, color=(0.8, 0.8, 0.8), alpha: float = 1.0, hatch: tuple | None = None,
             lw: float | None = None, anno: bool = False, *, pattern: str | None = None, edge: tuple | None = None,
             edge_lw: float | None = None, hatch_lw: float | None = None, stipple: float | None = None) -> None:
        if g is None or g.is_empty:
            return
        if not self.paper and self.clip:
            g = g.intersection(self.window_poly().buffer(5.0 / self.k))
        for p in _polys(g):
            rings = [list(p.exterior.coords)[:-1]] + [list(r.coords)[:-1] for r in p.interiors]
            self.items.append(Item("fill", layer, rings, True, lw, None, color, alpha, hatch, anno=anno, pattern=pattern, edge=edge,
                                   edge_lw=edge_lw, hatch_lw=hatch_lw, stipple=stipple))

    def text(self, x: float, y: float, s: str, h: float = 2.5, anchor: str = "MIDDLE_CENTER", rot: float = 0.0,
             bold: bool = False, italic: bool = False, color=None, layer: str = "C-ANNO-NOTE", halo: bool = False) -> None:
        if not s:
            return
        s = fonts.units(s)
        if not self.paper and self.clip and not self.inside(x, y):
            return
        h = max(h, MIN_TEXT_MM)
        self.items.append(Item("text", layer, [(x, y)], False, None, None, color, 1.0, None, s, h, anchor, upright(rot + self.twist) if not self.paper else rot,
                               bold, italic, halo, anno=True))

    def image(self, path: str, extent, fade: float = 0.5, layer: str = "C-IMAG-AERL") -> None:
        self.items.append(Item("image", layer, None, False, image=path, extent=tuple(extent), fade=fade))

    # ---- labels with collision avoidance -----------------------------------------------------------
    def _box(self, px: float, py: float, s: str, h: float, anchor: str, rot: float, bold: bool) -> tuple[float, float, float, float]:
        w = fonts.text_width(s, h, bold)
        hz = anchor.split("_")[1]
        vt = anchor.split("_")[0]
        dx = {"LEFT": 0.0, "CENTER": -w / 2, "RIGHT": -w}[hz]
        dy = {"BOTTOM": 0.0, "MIDDLE": -h / 2, "TOP": -h}[vt]
        a = math.radians(rot)
        ca, sa = math.cos(a), math.sin(a)
        cs = [(dx, dy), (dx + w, dy), (dx + w, dy + h), (dx, dy + h)]
        xs = [px + x * ca - y * sa for x, y in cs]
        ys = [py + x * sa + y * ca for x, y in cs]
        return (min(xs) - 0.3, min(ys) - 0.3, max(xs) + 0.3, max(ys) + 0.3)

    def free(self, box) -> bool:
        if box[0] < self.rect[0] + 1 or box[1] < self.rect[1] + 1 or box[2] > self.rect[2] - 1 or box[3] > self.rect[3] - 1:
            return False
        return not any(not (box[2] < o[0] or box[0] > o[2] or box[3] < o[1] or box[1] > o[3]) for o in self.occ)

    def label(self, x: float, y: float, s: str, h: float = 2.5, rot: float = 0.0, anchor: str = "MIDDLE_CENTER", bold: bool = False,
              color=None, layer: str = "C-ANNO-NOTE", halo: bool = True, nudges: bool = True, force: bool = False) -> bool:
        """Place model-coordinate text if it fits inside the view and clears earlier labels; tries small perpendicular nudges."""
        h = max(h, MIN_TEXT_MM)
        rot = self.paper_rot(rot) if not self.paper else upright(rot)      # ``rot`` is the MODEL direction of the baseline; rot is now the paper angle
        px, py = self.tp(x, y)
        a = math.radians(rot + 90)
        cand = [(0.0, 0.0)]
        if nudges:
            for d in (h * 1.3, -h * 1.3, h * 2.6, -h * 2.6):
                cand.append((d * math.cos(a), d * math.sin(a)))
        for dx, dy in cand:
            box = self._box(px + dx, py + dy, s, h, anchor, rot, bold)
            if self.free(box):
                self.occ.append(box)
                self.tbox.append(box)
                mx, my = self.tm(px + dx, py + dy)
                self.text(mx, my, s, h, anchor, self.model_rot(rot), bold, color=color, layer=layer, halo=halo)
                return True
        if force:
            box = self._box(px, py, s, h, anchor, rot, bold)
            self.occ.append(box)
            self.tbox.append(box)
            self.text(x, y, s, h, anchor, self.model_rot(rot), bold, color=color, layer=layer, halo=halo)
            return True
        self.dropped += 1
        return False

    def reserve(self, geom_or_box) -> None:
        """Mark a paper-mm box (or model geometry bounds) as occupied so labels avoid it."""
        if hasattr(geom_or_box, "bounds"):
            x0, y0, x1, y1 = geom_or_box.bounds
            (a, b), (c, d) = self.tp(x0, y0), self.tp(x1, y1)
            self.occ.append((min(a, c), min(b, d), max(a, c), max(b, d)))
        else:
            self.occ.append(tuple(geom_or_box))

    # ---- common symbols ----------------------------------------------------------------------------
    def dim(self, p1, p2, text: str, side=(0.0, 1.0), off_mm: float = 4.0, h: float = 2.2, layer: str = "C-ANNO-DIMS", color=None, mask: bool = False) -> bool:
        """Aligned dimension between model points; dimension line offset ``off_mm`` on paper toward ``side``."""
        if not (self.inside(*p1, 3.0) and self.inside(*p2, 3.0)):
            return False
        a, b = self.tp(*p1), self.tp(*p2)
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy)
        if L < 4.0:
            return False
        ux, uy = dx / L, dy / L
        nx, ny = -uy, ux
        if nx * side[0] + ny * side[1] < 0:
            nx, ny = -nx, -ny
        q1, q2 = (a[0] + nx * off_mm, a[1] + ny * off_mm), (b[0] + nx * off_mm, b[1] + ny * off_mm)
        pv = View("p", self.rect)      # paper-coordinate drawing into this view's item list
        for p, q in ((a, q1), (b, q2)):
            self._pl([(p[0] + nx * 0.8, p[1] + ny * 0.8), (q[0] + nx * 1.2, q[1] + ny * 1.2)], layer, 0.13, color)
        self._pl([q1, q2], layer, 0.18, color)
        for q, d in ((q1, (-ux, -uy)), (q2, (ux, uy))):
            self._pl([q, (q[0] - d[0] * 1.8 + nx * 0.5, q[1] - d[1] * 1.8 + ny * 0.5)], layer, 0.18, color)
            self._pl([q, (q[0] - d[0] * 1.8 - nx * 0.5, q[1] - d[1] * 1.8 - ny * 0.5)], layer, 0.18, color)
        rot = upright(math.degrees(math.atan2(uy, ux)))
        mx, my = (q1[0] + q2[0]) / 2, (q1[1] + q2[1]) / 2
        w = fonts.text_width(text, h)
        if w + 4 > L:               # text does not fit between ticks: put it beside the line, still readable
            pass
        ra = math.radians(rot + 90)
        tx, ty = mx + math.cos(ra) * (h * 0.75), my + math.sin(ra) * (h * 0.75)
        if mask:
            self._mask(tx, ty, w + 1.6, h + 1.2, rot, layer)
        self.text_p(tx, ty, text, h, "MIDDLE_CENTER", rot, layer=layer)
        return True

    def callout(self, pt, lines: list[str], h: float = 2.4, prefer=None, bold_first: bool = True, color=None, layer: str = "C-ANNO-NOTE",
                maxw: float = 60.0) -> bool:
        """Leader + boxed text block placed at the first free of several offsets from model point ``pt`` (paper-mm offsets)."""
        if not self.inside(*pt, 2.0):
            return False
        wrapped: list[tuple[str, bool]] = []
        for i, ln in enumerate(lines):
            for w in fonts.wrap(ln, h, maxw, bold_first and i == 0):
                wrapped.append((w, bold_first and i == 0))
        tw = max(fonts.text_width(t, h, b) for t, b in wrapped) + 3.0
        th = len(wrapped) * (h + 1.1) + 1.6
        px, py = self.tp(*pt)
        cands = list(prefer or []) + [(12, 10), (12, -10), (-12 - tw, 10), (-12 - tw, -10), (6, 24), (6, -24 - th), (-tw / 2, 28), (-tw / 2, -28 - th),
                                      (30, 30), (-30 - tw, -30), (30, -30 - th), (-30 - tw, 30)]
        for dx, dy in cands:
            x0, y0 = px + dx, py + dy
            box = (x0, y0, x0 + tw, y0 + th)
            if self.free(box):
                break
        else:
            self.dropped += 1
            return False
        self.occ.append(box)
        # white backing box
        from shapely.geometry import Polygon
        poly = Polygon([self.tm(box[0], box[1]), self.tm(box[2], box[1]), self.tm(box[2], box[3]), self.tm(box[0], box[3])])
        self.items.append(Item("fill", "C-ANNO-NOTE", [list(poly.exterior.coords)[:-1]], True, None, None, (1, 1, 1), 0.88, None, anno=True))
        self.items.append(Item("line", layer, [self.tm(box[0], box[1]), self.tm(box[2], box[1]), self.tm(box[2], box[3]), self.tm(box[0], box[3])], True, 0.13, anno=True))
        ex = min(max(px, box[0]), box[2])
        ey = min(max(py, box[1]), box[3])
        self._pl([(px, py), (ex, ey)], layer, 0.15)
        # dot at the anchor
        self._pl([(px - 0.5, py), (px + 0.5, py)], layer, 0.5)
        yy = box[3] - 0.8
        for t, b in wrapped:
            self.text_p(box[0] + 1.5, yy, t, h, "TOP_LEFT", 0.0, b, color=color, layer=layer)
            yy -= h + 1.1
        return True

    def _pl(self, pts_paper, layer, lw, color=None) -> None:
        """Polyline given in PAPER mm inside a model view (annotation, so DXF puts it in paper space)."""
        inv = [self.tm(x, y) for x, y in pts_paper]
        self.items.append(Item("line", layer, inv, False, lw, color=color, anno=True))

    def _mask(self, px, py, w, h, rot_deg, layer="C-ANNO-NOTE") -> None:
        """White rectangle (PAPER mm, centre px,py, rotated) behind text so it stays legible over linework; annotation item."""
        a = math.radians(rot_deg)
        ca, sa = math.cos(a), math.sin(a)
        pts = [self.tm(px + x * ca - y * sa, py + x * sa + y * ca) for x, y in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2))]
        self.items.append(Item("fill", layer, [pts], True, None, None, (1, 1, 1), 1.0, None, anno=True))

    def text_p(self, px, py, s, h=2.5, anchor="MIDDLE_CENTER", rot=0.0, bold=False, color=None, layer="C-ANNO-NOTE", halo=False) -> None:
        mx, my = self.tm(px, py)
        self.text(mx, my, s, h, anchor, self.model_rot(rot) if not self.paper else rot, bold, color=color, layer=layer, halo=halo)


def _lines(g: BaseGeometry) -> list[LineString]:
    if g.is_empty:
        return []
    t = g.geom_type
    if t == "LineString":
        return [g]
    if t == "LinearRing":
        return [LineString(g.coords)]
    if t == "Polygon":
        return [LineString(g.exterior.coords)] + [LineString(r.coords) for r in g.interiors]
    if hasattr(g, "geoms"):
        return [x for p in g.geoms for x in _lines(p)]
    return []


def _polys(g: BaseGeometry) -> list[Polygon]:
    if g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    if hasattr(g, "geoms"):
        return [x for p in g.geoms for x in _polys(p)]
    return []


@dataclass
class LegendEntry:
    label: str
    kind: str = "line"                 # line | fill | point | text
    color: tuple = (0, 0, 0)
    lw: float = 0.25
    dash: str | None = None
    fill: tuple | None = None
    hatch: tuple | None = None
    layer: str = "C-ANNO-NOTE"


@dataclass
class Sheet:
    number: str
    title: str
    subtitle: str = ""
    views: list[View] = field(default_factory=list)
    legend: list[LegendEntry] = field(default_factory=list)
    scale_text: str = ""
    north: float | None = 0.0          # None = no north arrow (sections / details)
    revision: str = "A"
    data_missing: list[str] = field(default_factory=list)     # 'DATA NOT AVAILABLE' reasons, for the report
    notes: list[str] = field(default_factory=list)
    paper: tuple = A3                   # page size, mm (A3 unless the sheet style says otherwise)
    tag_notes: list[str] = field(default_factory=list)      # reference style: text of call-outs that fell back to a numbered tag

    def add(self, v: View) -> View:
        self.views.append(v)
        return v
