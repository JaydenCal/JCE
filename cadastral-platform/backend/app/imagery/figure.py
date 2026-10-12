"""Georeferenced figure: aerial basemap with vector overlays drawn ABOVE the raster (reportlab)."""
from __future__ import annotations

import io
import math
from dataclasses import dataclass, field

from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Flowable
from shapely import wkt as _wkt
from shapely.geometry.base import BaseGeometry

from app.imagery.provider import ImageMeta, ImageryProvider

CAP_H = 24 * mm   # caption strip height


@dataclass
class OverlaySpec:
    geom: BaseGeometry
    stroke: str = "#b03a2e"
    fill: str | None = "#d93030"
    alpha: float = 0.3
    label: str = ""
    width: float = 1.0


def _geom(g) -> BaseGeometry:
    return _wkt.loads(g) if isinstance(g, str) else g


def _polys(g):
    return [p for p in (g.geoms if hasattr(g, "geoms") else [g]) if p.geom_type == "Polygon"]


def fit_extent(geoms: list[BaseGeometry], aspect: float, buffer_frac: float = 0.35, min_span: float = 40.0):
    x0 = min(g.bounds[0] for g in geoms); y0 = min(g.bounds[1] for g in geoms)
    x1 = max(g.bounds[2] for g in geoms); y1 = max(g.bounds[3] for g in geoms)
    w = max(x1 - x0, min_span) * (1 + 2 * buffer_frac); h = max(y1 - y0, min_span) * (1 + 2 * buffer_frac)
    if w / h < aspect:
        w = h * aspect
    else:
        h = w / aspect
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)


def nice_length(target: float) -> float:
    e = 10 ** math.floor(math.log10(max(target, 1e-9)))
    return max(m * e for m in (1, 2, 5, 10) if m * e <= target)


@dataclass
class Figure:
    number: int
    caption: str
    srid: int
    extent: tuple[float, float, float, float]
    width: float
    height: float
    lot: BaseGeometry
    footprint: BaseGeometry | None
    overlays: list[OverlaySpec]
    image: bytes | None
    meta: ImageMeta | None
    note: str = ""

    @property
    def source_line(self) -> str:
        if not self.meta:
            return "No aerial imagery available. Vector overlays only."
        d = self.meta.capture_date or "capture date unavailable"
        return f"{self.meta.attribution}; imagery date: {d}; {self.meta.resolution_m_per_px * 100:.0f} cm/px (requested)."

    def as_flowable(self) -> "FigureFlowable":
        return FigureFlowable(self)


def render_figure(lot, extra_polygons=(), imagery: ImageryProvider | None = None, *, srid: int = 7856, number: int = 1,
                  caption: str = "", footprint=None, width=170 * mm, height=120 * mm, buffer_frac: float = 0.35,
                  max_px: int = 1600) -> Figure:
    """lot / footprint: shapely or WKT. extra_polygons: iterable of OverlaySpec | geometry | WKT | (label, geom)."""
    lot_g = _geom(lot); fp = _geom(footprint) if footprint else None
    ov: list[OverlaySpec] = []
    for e in extra_polygons:
        if isinstance(e, OverlaySpec):
            ov.append(e)
        elif isinstance(e, tuple):
            ov.append(OverlaySpec(_geom(e[1]), label=e[0]))
        else:
            ov.append(OverlaySpec(_geom(e)))
    geoms = [lot_g] + ([fp] if fp else []) + [o.geom for o in ov]
    img_h = height - CAP_H
    ext = fit_extent(geoms, width / img_h, buffer_frac)
    data = meta = None
    note = ""
    if imagery is not None:
        try:
            s = max(width, img_h)
            px = (max(64, int(max_px * width / s)), max(64, int(max_px * img_h / s)))
            r = imagery.fetch(ext, srid, px)
            data, meta = r.data, r.meta
        except Exception as e:  # imagery is optional: fall back to vector only
            note = f"Aerial imagery unavailable ({type(e).__name__})"
    return Figure(number, caption, srid, ext, width, height, lot_g, fp, ov, data, meta, note)


class FigureFlowable(Flowable):
    def __init__(self, fig: Figure):
        super().__init__()
        self.fig = fig
        self.width, self.height = fig.width, fig.height

    def wrap(self, aw, ah):
        return self.width, self.height

    def draw(self):
        draw_figure(self.canv, self.fig, 0, 0)


def draw_figure(c, fig: Figure, ox: float, oy: float) -> None:
    """Draw at canvas origin (ox, oy) = bottom-left of the figure block."""
    iw, ih = fig.width, fig.height - CAP_H
    iy = oy + CAP_H
    x0, y0, x1, y1 = fig.extent
    sx, sy = iw / (x1 - x0), ih / (y1 - y0)
    px = lambda x: ox + (x - x0) * sx
    py = lambda y: iy + (y - y0) * sy
    c.saveState()
    p = c.beginPath(); p.rect(ox, iy, iw, ih); c.clipPath(p, stroke=0, fill=0)
    c.setFillColor(colors.Color(0.93, 0.93, 0.93)); c.rect(ox, iy, iw, ih, stroke=0, fill=1)
    if fig.image:
        c.drawImage(ImageReader(io.BytesIO(fig.image)), ox, iy, iw, ih)

    def poly(g, stroke, fill, alpha, lw):
        for pl in _polys(g):
            path = c.beginPath()
            pts = list(pl.exterior.coords)
            path.moveTo(px(pts[0][0]), py(pts[0][1]))
            for x, y in pts[1:]:
                path.lineTo(px(x), py(y))
            path.close()
            for ring in pl.interiors:
                r = list(ring.coords); path.moveTo(px(r[0][0]), py(r[0][1]))
                for x, y in r[1:]:
                    path.lineTo(px(x), py(y))
                path.close()
            c.setLineWidth(lw); c.setStrokeColor(colors.HexColor(stroke))
            if fill:
                c.setFillColor(colors.HexColor(fill)); c.setFillAlpha(alpha)
            c.drawPath(path, stroke=1, fill=1 if fill else 0)
            c.setFillAlpha(1)
    for o in fig.overlays:
        poly(o.geom, o.stroke, o.fill, o.alpha, o.width)
    poly(fig.lot, "#ffd400" if fig.image else "#000000", None, 1, 1.8)
    if fig.footprint is not None:
        poly(fig.footprint, "#1f4e79", "#1f6fd0", 0.3, 1.2)
    c.restoreState()
    c.setStrokeColor(colors.black); c.setLineWidth(0.5); c.rect(ox, iy, iw, ih, stroke=1, fill=0)

    # north arrow (image is north-up in an MGA/projected CRS)
    ax, ay = ox + iw - 14, iy + ih - 34
    c.setFillColor(colors.white); c.setFillAlpha(0.7); c.rect(ax - 10, ay - 6, 20, 38, stroke=0, fill=1); c.setFillAlpha(1)
    c.setFillColor(colors.black); c.setStrokeColor(colors.black); c.setLineWidth(0.5)
    t = c.beginPath(); t.moveTo(ax, ay + 20); t.lineTo(ax - 5, ay); t.lineTo(ax, ay + 5); t.lineTo(ax + 5, ay); t.close()
    c.drawPath(t, stroke=1, fill=1)
    c.setFont("Helvetica-Bold", 8); c.drawCentredString(ax, ay + 24, "N")
    # scale bar
    L = nice_length((x1 - x0) * 0.2); bw = L * sx
    bx, by = ox + 8, iy + 8
    c.setFillColor(colors.white); c.setFillAlpha(0.7); c.rect(bx - 4, by - 4, bw + 30, 18, stroke=0, fill=1); c.setFillAlpha(1)
    c.setFillColor(colors.black); c.setLineWidth(1.2); c.line(bx, by, bx + bw, by)
    c.line(bx, by - 2, bx, by + 3); c.line(bx + bw, by - 2, bx + bw, by + 3)
    c.setFont("Helvetica", 6.5); c.drawString(bx, by + 5, f"0   {L:g} m")
    # legend
    lx, ly = ox + 6, iy + ih - 10
    c.setFont("Helvetica", 6.5)
    items = [("Lot boundary", "#ffd400" if fig.image else "#000000")] + ([("Footprint", "#1f4e79")] if fig.footprint is not None else [])
    seen = set()
    for o in fig.overlays:
        if o.label and o.label not in seen:
            seen.add(o.label); items.append((o.label, o.stroke))
    for lab, col in items[:6]:
        c.setFillColor(colors.white); c.setFillAlpha(0.7); c.rect(lx - 2, ly - 2, 6.5 * len(lab) * 0.55 + 18, 9, stroke=0, fill=1); c.setFillAlpha(1)
        c.setStrokeColor(colors.HexColor(col)); c.setLineWidth(2); c.line(lx, ly + 2, lx + 10, ly + 2)
        c.setFillColor(colors.black); c.drawString(lx + 13, ly, lab); ly -= 10
    # caption
    c.setFillColor(colors.black); c.setFont("Helvetica-Bold", 8)
    c.drawString(ox, oy + CAP_H - 10, f"Figure {fig.number}. {fig.caption}")
    c.setFont("Helvetica", 6)
    src = fig.source_line + (" " + fig.note if fig.note else "")
    for i, ln in enumerate(_wrap(src, "Helvetica", 6, fig.width)[:2]):
        c.drawString(ox, oy + CAP_H - 19 - 7 * i, ln)


def _wrap(text, font, size, width):
    from reportlab.pdfbase.pdfmetrics import stringWidth
    out, cur = [], ""
    for w in text.split():
        t = (cur + " " + w).strip()
        if stringWidth(t, font, size) > width and cur:
            out.append(cur); cur = w
        else:
            cur = t
    return out + ([cur] if cur else [])
