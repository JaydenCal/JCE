"""Georeferenced, zoomed figures: aerial underlay + clipped constraint polygons + lot outline + legend/scale/north."""
from __future__ import annotations

import io
import math
from dataclasses import dataclass, field

from PIL import Image
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import FILL_EVEN_ODD
from reportlab.platypus import Flowable
from shapely import wkt as _wkt
from shapely.geometry import box
from shapely.geometry.base import BaseGeometry
from shapely.ops import nearest_points

from app.report import theme as T
from app.report.fmt import clean, hdate

YELLOW = "#ffd400"


@dataclass
class Layer:
    label: str
    geoms: list[BaseGeometry]
    stroke: str = "#a63a2b"
    fill: str | None = "#d9402e"
    alpha: float = 0.34
    dash: bool = False
    width: float = 0.9


@dataclass
class MapFigure:
    width: float
    height: float
    window: tuple[float, float, float, float]
    lot: BaseGeometry
    layers: list[Layer] = field(default_factory=list)
    neighbours: list[tuple[str, BaseGeometry, bool]] = field(default_factory=list)
    footprint: BaseGeometry | None = None
    image: bytes | None = None
    capture_date: str | None = None
    attribution: str = ""
    note: str = ""
    buffer_ring: tuple[BaseGeometry, str] | None = None
    measure: tuple[tuple[float, float], tuple[float, float], str] | None = None
    show_labels: bool = True
    compact: bool = False

    @property
    def imagery_line(self) -> str:
        if not self.image:
            return "No aerial imagery available for this figure; vector overlay only."
        d = hdate(self.capture_date, "capture date not published")
        return f"Aerial: {clean(self.attribution)}. Imagery date: {d}." if self.attribution else f"Aerial imagery date: {d}."

    def flowable(self) -> "MapFlowable":
        return MapFlowable(self)


def window_for(lot: BaseGeometry, ctx_m: float, aspect: float, min_span: float = 50.0, extra: list[BaseGeometry] | None = None):
    x0, y0, x1, y1 = lot.bounds
    for g in extra or []:
        b = g.bounds
        x0, y0, x1, y1 = min(x0, b[0]), min(y0, b[1]), max(x1, b[2]), max(y1, b[3])
    x0, y0, x1, y1 = x0 - ctx_m, y0 - ctx_m, x1 + ctx_m, y1 + ctx_m
    w, h = max(x1 - x0, min_span), max(y1 - y0, min_span)
    if w / h < aspect:
        w = h * aspect
    else:
        h = w / aspect
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)


def fetch_aerial(imagery, window, srid, width, height, max_px=1700):
    """-> (jpeg bytes | None, capture_date, attribution, note)."""
    if imagery is None:
        return None, None, "", "Aerial imagery not enabled for this run (set IMAGERY_PROVIDER=nsw)."
    try:
        s = max(width, height)
        px = (max(64, int(max_px * width / s)), max(64, int(max_px * height / s)))
        try:
            r = imagery.fetch(window, srid, px)
        except Exception:  # noqa: BLE001  one retry for transient service errors
            import time; time.sleep(1.5)
            r = imagery.fetch(window, srid, px)
        im = Image.open(io.BytesIO(r.data)).convert("RGB")
        b = io.BytesIO()
        im.save(b, "JPEG", quality=82, optimize=True)
        return b.getvalue(), r.meta.capture_date, r.meta.attribution, ""
    except Exception as e:  # noqa: BLE001  imagery is optional
        return None, None, "", f"Aerial imagery unavailable ({type(e).__name__}: {str(e)[:80]})."


def _g(x) -> BaseGeometry:
    return _wkt.loads(x) if isinstance(x, str) else x


def _clip(g: BaseGeometry, win) -> BaseGeometry | None:
    try:
        if not g.is_valid:
            g = g.buffer(0)
        c = g.intersection(box(*win).buffer(2))
        return None if c.is_empty else c
    except Exception:  # noqa: BLE001
        return None


def _parts(g, kinds=("Polygon",)):
    for p in (g.geoms if hasattr(g, "geoms") else [g]):
        if p.geom_type in kinds:
            yield p
        elif hasattr(p, "geoms"):
            yield from _parts(p, kinds)


def nice_length(target: float) -> float:
    e = 10 ** math.floor(math.log10(max(target, 1e-9)))
    return max(m * e for m in (1, 2, 5, 10) if m * e <= target)


class MapFlowable(Flowable):
    def __init__(self, fig: MapFigure):
        super().__init__()
        self.fig, self.width, self.height = fig, fig.width, fig.height

    def wrap(self, aw, ah):
        return self.width, self.height

    def draw(self):
        draw_map(self.canv, self.fig, 0, 0)


def draw_map(c, f: MapFigure, ox: float, oy: float) -> None:
    W, H = f.width, f.height
    x0, y0, x1, y1 = f.window
    sx, sy = W / (x1 - x0), H / (y1 - y0)
    px = lambda x: ox + (x - x0) * sx          # noqa: E731
    py = lambda y: oy + (y - y0) * sy          # noqa: E731
    c.saveState()
    p = c.beginPath(); p.rect(ox, oy, W, H); c.clipPath(p, stroke=0, fill=0)
    c.setFillColor(T.PAPER_DK); c.rect(ox, oy, W, H, stroke=0, fill=1)
    aerial = bool(f.image)
    if aerial:
        c.drawImage(ImageReader(io.BytesIO(f.image)), ox, oy, W, H)
    else:                                       # honest vector-only backdrop: survey-style grid
        c.setStrokeColor(colors.Color(1, 1, 1, alpha=0.7)); c.setLineWidth(0.4)
        step = nice_length((x1 - x0) / 6)
        gx = math.ceil(x0 / step) * step
        while gx < x1:
            c.line(px(gx), oy, px(gx), oy + H); gx += step
        gy = math.ceil(y0 / step) * step
        while gy < y1:
            c.line(ox, py(gy), ox + W, py(gy)); gy += step

    def path_for(poly):
        path = c.beginPath()
        for ring in [poly.exterior, *poly.interiors]:
            pts = list(ring.coords)
            path.moveTo(px(pts[0][0]), py(pts[0][1]))
            for x, y in pts[1:]:
                path.lineTo(px(x), py(y))
            path.close()
        return path

    def draw_geom(g, stroke, fill, alpha, lw, dash=False):
        g = _clip(g, f.window)
        if g is None:
            return
        for pl in _parts(g):
            c.setLineWidth(lw); c.setStrokeColor(colors.HexColor(stroke))
            c.setDash(3, 2) if dash else c.setDash()
            if fill:
                c.setFillColor(colors.HexColor(fill)); c.setFillAlpha(alpha)
            c.drawPath(path_for(pl), stroke=1, fill=1 if fill else 0, fillMode=FILL_EVEN_ODD)
            c.setFillAlpha(1); c.setDash()

    ln = colors.white if aerial else colors.HexColor("#8d8a80")
    for label, g, is_road in f.neighbours:     # adjoining parcels
        c.setLineWidth(0.5 if not is_road else 0.35); c.setStrokeColor(ln); c.setStrokeAlpha(0.85 if aerial else 1)
        gg = _clip(g, f.window)
        if gg is not None:
            for pl in _parts(gg):
                c.drawPath(path_for(pl), stroke=1, fill=0)
        c.setStrokeAlpha(1)
    for L in f.layers:
        for g in L.geoms:
            draw_geom(g, L.stroke, L.fill, L.alpha, L.width, L.dash)
    if f.buffer_ring:
        draw_geom(f.buffer_ring[0], "#ffb347" if aerial else "#b4601a", None, 1, 1.0, True)
    if f.footprint is not None:
        draw_geom(f.footprint, "#2d6fd6", "#3b82f6", 0.35, 1.1)
    # lot outline: casing + bold line
    lot_c = _clip(f.lot, f.window)
    if lot_c is not None:
        for pl in _parts(lot_c):
            pth = path_for(pl)
            c.setLineWidth(3.6); c.setStrokeColor(colors.Color(0, 0, 0, alpha=0.55)); c.drawPath(pth, stroke=1, fill=0)
            c.setLineWidth(2.0); c.setStrokeColor(colors.HexColor(YELLOW if aerial else "#1e2024")); c.drawPath(pth, stroke=1, fill=0)
    # adjoining labels
    if f.show_labels:
        c.setFont("Mono", 5.2)
        for label, g, is_road in f.neighbours:
            if is_road or not label:
                continue
            gg = _clip(g, f.window)
            if gg is None:
                continue
            rp = gg.representative_point()
            lab = clean(label).upper().replace("LOT ", "L").replace(" DP", "/DP")
            tw = c.stringWidth(lab, "Mono", 5.2) + 4
            if tw > 0.34 * W or not (x0 < rp.x < x1 and y0 < rp.y < y1):
                continue
            c.setFillColor(colors.Color(1, 1, 1, alpha=0.82)); c.rect(px(rp.x) - tw / 2, py(rp.y) - 3, tw, 8, stroke=0, fill=1)
            c.setFillColor(T.INK); c.drawCentredString(px(rp.x), py(rp.y) - 0.6, lab)
    # measurement line
    if f.measure:
        (ax, ay), (bx, by), txt = f.measure
        c.setStrokeColor(colors.HexColor("#ffffff" if aerial else "#1e2024")); c.setLineWidth(1.1); c.setDash(2.5, 2)
        c.line(px(ax), py(ay), px(bx), py(by)); c.setDash()
        mx, my = px((ax + bx) / 2), py((ay + by) / 2)
        tw = c.stringWidth(txt, "Mono-Medium", 7) + 8
        c.setFillColor(T.INK); c.roundRect(mx - tw / 2, my - 5, tw, 11, 2, stroke=0, fill=1)
        c.setFillColor(colors.white); c.setFont("Mono-Medium", 7); c.drawCentredString(mx, my - 2.2, txt)
    c.restoreState()
    # --- furniture (outside clip)
    c.saveState()
    c.setStrokeColor(T.INK); c.setLineWidth(0.8); c.rect(ox, oy, W, H, stroke=1, fill=0)
    # scale bar
    L = nice_length((x1 - x0) * 0.22)
    bw = L * sx
    bx0, by0 = ox + 8, oy + 8
    c.setFillColor(colors.Color(1, 1, 1, alpha=0.88)); c.rect(bx0 - 4, by0 - 4, bw + 36, 20, stroke=0, fill=1)
    c.setStrokeColor(T.INK); c.setLineWidth(0.6)
    for i in range(4):
        c.setFillColor(T.INK if i % 2 == 0 else colors.white)
        c.rect(bx0 + i * bw / 4, by0 + 6, bw / 4, 3.2, stroke=1, fill=1)
    c.setFillColor(T.INK); c.setFont("Mono", 5.6)
    c.drawString(bx0, by0, "0"); c.drawCentredString(bx0 + bw, by0, f"{L:g} m")
    c.setFont("Mono", 5); c.setFillColor(T.MUTED)
    c.drawString(bx0 + bw + 10, by0 + 6.5, "GDA2020 / MGA")
    # north arrow
    nx, ny = ox + W - 15, oy + H - 15
    c.setFillColor(colors.Color(1, 1, 1, alpha=0.9)); c.circle(nx, ny, 10.5, stroke=0, fill=1)
    c.setFillColor(T.INK); p = c.beginPath(); p.moveTo(nx, ny + 8); p.lineTo(nx - 4, ny - 5); p.lineTo(nx, ny - 2.5); p.lineTo(nx + 4, ny - 5); p.close()
    c.drawPath(p, stroke=0, fill=1)
    c.setFillColor(T.GOLD); c.setFont("Jost-Bold", 6.5); c.drawCentredString(nx, ny - 9.6 + 1, "N")
    # legend
    items: list[tuple[str, str | None, str, bool]] = [("Lot boundary", None, YELLOW if aerial else "#1e2024", False)]
    for L_ in f.layers:
        items.append((L_.label, L_.fill, L_.stroke, L_.dash))
    if f.buffer_ring:
        items.append((f.buffer_ring[1], None, "#ffb347" if aerial else "#b4601a", True))
    if f.footprint is not None:
        items.append(("Indicative building footprint", "#3b82f6", "#2d6fd6", False))
    if f.neighbours:
        items.append(("Adjoining lots", None, "#ffffff" if aerial else "#8d8a80", False))
    if not f.compact or len(items) <= 3:
        lh, lw_ = 8.4, max(c.stringWidth(clean(i[0]), "Plex", 6.2) for i in items) + 28
        lx, ly = ox + W - lw_ - 6, oy + 6
        c.setFillColor(colors.Color(1, 1, 1, alpha=0.9)); c.rect(lx, ly, lw_, lh * len(items) + 6, stroke=0, fill=1)
        c.setFont("Plex", 6.2)
        for i, (lab, fill, stroke, dash) in enumerate(reversed(items)):
            yy = ly + 4 + i * lh
            if fill:
                c.setFillColor(colors.HexColor(fill)); c.setFillAlpha(0.45); c.rect(lx + 4, yy, 14, 5.5, stroke=0, fill=1); c.setFillAlpha(1)
            c.setStrokeColor(colors.HexColor(stroke if stroke != "#ffffff" else "#8d8a80")); c.setLineWidth(1.3 if "Lot" in lab else 0.8)
            c.setDash(2, 1.5) if dash else c.setDash()
            c.rect(lx + 4, yy, 14, 5.5, stroke=1, fill=0); c.setDash()
            c.setFillColor(T.INK); c.drawString(lx + 22, yy + 0.8, clean(lab))
    if f.note:
        c.setFillColor(colors.Color(1, 1, 1, alpha=0.92)); c.rect(ox, oy + H - 12, W - 28, 12, stroke=0, fill=1)
        c.setFillColor(T.MUTED); c.setFont("Plex-Italic", 6.2); c.drawString(ox + 5, oy + H - 8.5, clean(f.note)[:150])
    c.restoreState()


def make_map(lot, *, ctx_m: float, width: float, height: float, srid: int, imagery, layers: list[Layer] | None = None,
             neighbours=(), footprint=None, buffer_ring=None, measure=None, extra_extent: list[BaseGeometry] | None = None,
             show_labels: bool = True, compact: bool = False, max_px: int = 1700) -> MapFigure:
    lot_g = _g(lot)
    win = window_for(lot_g, ctx_m, width / height, extra=extra_extent)
    img, cap, attr, note = fetch_aerial(imagery, win, srid, width, height, max_px)
    nb = []
    for n in neighbours:
        try:
            nb.append((getattr(n, "label", ""), _g(n.wkt), bool(getattr(n, "is_road", False))))
        except Exception:  # noqa: BLE001
            continue
    return MapFigure(width, height, win, lot_g, layers or [], nb, _g(footprint) if footprint else None, img, cap, attr, note,
                     buffer_ring, measure, show_labels, compact)


def nearest_pair(lot: BaseGeometry, geoms: list[BaseGeometry]):
    best = None
    for g in geoms:
        try:
            a, b = nearest_points(lot, g)
        except Exception:  # noqa: BLE001
            continue
        d = a.distance(b)
        if best is None or d < best[0]:
            best = (d, (a.x, a.y), (b.x, b.y))
    return best
