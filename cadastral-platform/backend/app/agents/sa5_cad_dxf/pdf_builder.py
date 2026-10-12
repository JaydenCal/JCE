"""Vector A3 landscape plan PDF drawn directly from the PlanModel (reportlab).

Not converted from the DXF: both outputs share the model, annotation set and
sheet layout so they agree, but the PDF is rendered natively.  Fonts are the
standard Helvetica family (no raster content).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path

from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas
from shapely.geometry import Point

from app.agents.sa5_cad_dxf.annotate import CAP_HEIGHT_RATIO, AnnotationSet, upright_rotation
from app.agents.sa5_cad_dxf.dxf_builder import DEFAULT_OVERLAY_STYLE, OVERLAY_STYLE
from app.agents.sa5_cad_dxf.layers import LAYER_BY_NAME, PATTERN_UNIT_MM, LINETYPE_PATTERNS, SERVICE_LAYER, pdf_rgb
from app.agents.sa5_cad_dxf.model import PlanModel, hatch_lines, left_normal, lines_of, polygons_of
from app.agents.sa5_cad_dxf.sheet import (FRAME, SHEET_H, SHEET_W, VIEWPORT, Circle, FitResult, Line, Poly, Prim,
                                          Text, build_panel)
from app.common.contracts import AckKind


@dataclass
class PdfBuild:
    fit: FitResult
    page_count: int = 1
    warnings: list[str] = field(default_factory=list)


class _Page:
    def __init__(self, c: canvas.Canvas, model: PlanModel, fit: FitResult):
        self.c, self.model, self.fit = c, model, fit
        self.s = 1000.0 / model.scale            # paper mm per model metre
        self.vcx = (VIEWPORT[0] + VIEWPORT[2]) / 2
        self.vcy = (VIEWPORT[1] + VIEWPORT[3]) / 2

    # model metres -> paper mm
    def mx(self, x: float) -> float:
        return self.vcx + (x - self.fit.centre[0]) * self.s

    def my(self, y: float) -> float:
        return self.vcy + (y - self.fit.centre[1]) * self.s

    def style(self, layer: str, lw: float | None = None) -> None:
        d = LAYER_BY_NAME[layer]
        r, g, b = pdf_rgb(d.aci)
        self.c.setStrokeColorRGB(r, g, b)
        self.c.setFillColorRGB(r, g, b)
        self.c.setLineWidth(max(0.1, lw if lw is not None else d.lineweight_mm) * mm)
        pat = LINETYPE_PATTERNS.get(d.linetype, ())
        self.c.setDash(*self._dash(pat))

    @staticmethod
    def _dash(pat: tuple[float, ...]):
        if not pat:
            return ([], 0)
        arr = [max(0.35, abs(v) * PATTERN_UNIT_MM) * mm for v in pat]
        return (arr, 0)

    def path(self, pts_mm, close: bool, fill: bool = False) -> None:
        p = self.c.beginPath()
        p.moveTo(pts_mm[0][0] * mm, pts_mm[0][1] * mm)
        for x, y in pts_mm[1:]:
            p.lineTo(x * mm, y * mm)
        if close:
            p.close()
        self.c.drawPath(p, stroke=0 if fill else 1, fill=1 if fill else 0)

    def geom(self, g, layer: str, lw: float | None = None, dash: bool | None = None) -> None:
        self.style(layer, lw)
        if dash:
            self.c.setDash(*self._dash(LINETYPE_PATTERNS["DASHDOT"]))
        for ln in lines_of(g):
            pts = [(self.mx(x), self.my(y)) for x, y in ln.coords]
            closed = len(pts) > 2 and pts[0] == pts[-1]
            self.path(pts[:-1] if closed else pts, closed)

    def text(self, x_mm: float, y_mm: float, h_mm: float, text: str, anchor: str = "MIDDLE_CENTER",
             rot: float = 0.0, bold: bool = False, grey: bool = False, halo: bool = False) -> None:
        c = self.c
        font = "Helvetica-Bold" if bold else "Helvetica"
        size = h_mm / CAP_HEIGHT_RATIO * mm
        w = stringWidth(text, font, size)
        v, hz = anchor.split("_")
        dx = {"LEFT": 0.0, "CENTER": -w / 2, "RIGHT": -w}[hz]
        dy = {"BOTTOM": 0.0, "MIDDLE": -h_mm * mm / 2, "TOP": -h_mm * mm}[v]
        c.saveState()
        c.setFillColorRGB(0.45, 0.45, 0.45) if grey else c.setFillColorRGB(0, 0, 0)
        c.translate(x_mm * mm, y_mm * mm)
        c.rotate(rot)
        if halo:
            # white outline behind the glyphs keeps text legible over linework
            t = c.beginText(dx, dy)
            t.setFont(font, size)
            t.setTextRenderMode(1)
            c.setStrokeColorRGB(1, 1, 1)
            c.setLineWidth(1.4)
            c.setLineJoin(1)
            t.textOut(text)
            c.drawText(t)
        t = c.beginText(dx, dy)
        t.setFont(font, size)
        if halo:
            # reportlab drops "0 Tr"; use fill+hairline stroke (mode 2) in the text colour instead
            t.setTextRenderMode(2)
            c.setStrokeColorRGB(0, 0, 0)
            c.setLineWidth(0.03)
        t.textOut(text)
        c.drawText(t)
        c.restoreState()

    def arrow(self, tip, direction, size=1.6, layer="C-ANNO-DIMS") -> None:
        ux, uy = direction
        nx, ny = -uy, ux
        b = (tip[0] - ux * size, tip[1] - uy * size)
        self.style(layer)
        self.c.setDash([], 0)
        self.path([tip, (b[0] + nx * size * 0.2, b[1] + ny * size * 0.2), (b[0] - nx * size * 0.2, b[1] - ny * size * 0.2)],
                  True, fill=True)


def _draw_dim(pg: _Page, d) -> None:
    k = pg.model.scale / 1000.0
    p1 = (pg.mx(d.p1[0]), pg.my(d.p1[1]))
    p2 = (pg.mx(d.p2[0]), pg.my(d.p2[1]))
    sx, sy = d.side
    nx, ny = left_normal(p2[0] - p1[0], p2[1] - p1[1])
    off = d.offset_mm
    if nx * sx + ny * sy < 0:
        nx, ny = -nx, -ny
    q1 = (p1[0] + nx * off, p1[1] + ny * off)
    q2 = (p2[0] + nx * off, p2[1] + ny * off)
    pg.style("C-ANNO-DIMS")
    pg.c.setDash([], 0)
    for p, q in ((p1, q1), (p2, q2)):
        e = (q[0] + nx * 1.0, q[1] + ny * 1.0)
        s = (p[0] + nx * 0.6, p[1] + ny * 0.6)
        pg.path([s, e], False)
    pg.path([q1, q2], False)
    ux, uy = (q2[0] - q1[0]), (q2[1] - q1[1])
    L = math.hypot(ux, uy)
    if L > 1e-6:
        ux, uy = ux / L, uy / L
        pg.arrow(q1, (-ux, -uy))
        pg.arrow(q2, (ux, uy))
    rot = upright_rotation(math.degrees(math.atan2(uy, ux)))
    a = math.radians(rot)
    upx, upy = -math.sin(a), math.cos(a)             # text "up" direction
    mid = ((q1[0] + q2[0]) / 2, (q1[1] + q2[1]) / 2)
    h = 2.0
    tx, ty = mid[0] + upx * (0.9 + h / 2), mid[1] + upy * (0.9 + h / 2)
    # white halo so text stays legible over linework
    pg.text(tx, ty, h, d.text, "MIDDLE_CENTER", rot, halo=True)


def _draw_plan(pg: _Page, aset: AnnotationSet) -> None:
    m = pg.model
    c = pg.c
    k = m.scale / 1000.0
    c.saveState()
    clip = c.beginPath()
    clip.rect(VIEWPORT[0] * mm, VIEWPORT[1] * mm, (VIEWPORT[2] - VIEWPORT[0]) * mm, (VIEWPORT[3] - VIEWPORT[1]) * mm)
    c.clipPath(clip, stroke=0, fill=0)

    for o in m.overlays:
        aci, _pat, ang = OVERLAY_STYLE.get(o.kind.lower(), DEFAULT_OVERLAY_STYLE)
        for poly in polygons_of(o.geom):
            pg.style("C-ZONE-OVLY", 0.1)
            r, g, b = pdf_rgb(aci)
            c.setStrokeColorRGB(r, g, b)
            for ln in hatch_lines(poly, 2.5 * k, ang):
                pts = [(pg.mx(x), pg.my(y)) for x, y in ln.coords]
                pg.path(pts, False)
        pg.geom(o.geom, "C-ZONE-OVLY")
        r, g, b = pdf_rgb(aci)
        c.setStrokeColorRGB(r, g, b)
        for ln in lines_of(o.geom):
            pts = [(pg.mx(x), pg.my(y)) for x, y in ln.coords]
            pg.path(pts, True)

    for sv in m.services:
        if sv.exclusion is not None:
            pg.geom(sv.exclusion, "C-UTIL-EXCL")
    for sv in m.services:
        layer = SERVICE_LAYER[sv.service]
        if sv.geom.geom_type == "Point":
            pg.style(layer)
            c.circle(pg.mx(sv.geom.x) * mm, pg.my(sv.geom.y) * mm, 0.5 * mm, stroke=1, fill=0)
        else:
            pg.geom(sv.geom, layer, dash=sv.is_proposed)

    if m.envelope is not None:
        pg.geom(m.envelope, "C-ZONE-ENVL")
    for d in m.dims:
        if d.kind == "setback":
            pg.style("C-ZONE-SBAK")
            pg.path([(pg.mx(d.p1[0]), pg.my(d.p1[1])), (pg.mx(d.p2[0]), pg.my(d.p2[1]))], False)
    pg.geom(m.lot, "C-PROP-BDY")
    if m.footprint is not None:
        pg.geom(m.footprint, "A-BLDG-SLAB")
    if m.drive_poly is not None:
        pg.geom(m.drive_poly, "C-DRIV-XOVR")
        pg.geom(m.crossover, "C-DRIV-XOVR")
        pg.geom(m.drive_centreline, "C-DRIV-CNTR")
    if m.turn_path is not None:
        pg.geom(m.turn_path, "C-DRIV-TURN")
    if m.turn_centre is not None and m.turn_radius:
        pg.style("C-DRIV-TURN")
        cx, cy = pg.mx(m.turn_centre[0]), pg.my(m.turn_centre[1])
        c.circle(cx * mm, cy * mm, m.turn_radius * pg.s * mm, stroke=1, fill=0)
        c.setDash([], 0)
        pg.path([(cx - 1.2, cy), (cx + 1.2, cy)], False)
        pg.path([(cx, cy - 1.2), (cx, cy + 1.2)], False)
    if m.rwt is not None:
        pg.style("C-UTIL-RWTK")
        c.circle(pg.mx(m.rwt[0]) * mm, pg.my(m.rwt[1]) * mm, m.rwt[2] / 2 * pg.s * mm, stroke=1, fill=0)
    for x, y, _z in m.level_spots:
        pg.style("C-ANNO-LEVL")
        X, Y = pg.mx(x), pg.my(y)
        pg.path([(X - 0.8, Y), (X + 0.8, Y)], False)
        pg.path([(X, Y - 0.8), (X, Y + 0.8)], False)

    for d in m.dims:
        _draw_dim(pg, d)
    rd = m.radius_dim
    if rd is not None:
        cx, cy = pg.mx(rd.centre[0]), pg.my(rd.centre[1])
        a = math.radians(rd.angle_deg)
        ux, uy = math.cos(a), math.sin(a)
        r_mm = rd.radius * pg.s
        edge = (cx + ux * r_mm, cy + uy * r_mm)
        end = (cx + ux * (r_mm + 5.0), cy + uy * (r_mm + 5.0))
        pg.style("C-ANNO-DIMS")
        c.setDash([], 0)
        pg.path([(cx, cy), end], False)
        pg.arrow(edge, (ux, uy))
        pg.text(end[0] + 0.8, end[1], 2.0, rd.text, "MIDDLE_LEFT", halo=True)

    for a in aset.drawn:
        if a.kind == "disclaimer":
            continue
        pg.text(pg.mx(a.x), pg.my(a.y), a.height_m * pg.s, a.content, a.attachment, a.rotation_deg, halo=True)
    c.restoreState()


def _draw_prims(pg: _Page, prims: list[Prim]) -> None:
    c = pg.c
    for p in prims:
        if isinstance(p, Line):
            pg.style(p.layer, p.lw)
            c.setDash([], 0) if p.layer in ("C-ANNO-TTLB",) else None
            pg.path([(p.x1, p.y1), (p.x2, p.y2)], False)
        elif isinstance(p, Poly):
            pg.style(p.layer, p.lw)
            if p.layer == "C-ANNO-TTLB":
                c.setDash([], 0)
            pg.path(p.pts, p.closed, fill=p.fill)
        elif isinstance(p, Circle):
            pg.style(p.layer)
            c.setDash([], 0) if p.layer == "C-ANNO-TTLB" else None
            c.circle(p.x * mm, p.y * mm, p.r * mm, stroke=1, fill=0)
        elif isinstance(p, Text):
            pg.text(p.x, p.y, p.h, p.text, p.anchor, 0.0, p.bold, p.grey)


def build_pdf(model: PlanModel, aset: AnnotationSet, fit: FitResult, acks: list[AckKind],
              path: str | Path) -> PdfBuild:
    c = canvas.Canvas(str(path), pagesize=(SHEET_W * mm, SHEET_H * mm), invariant=1)
    c.setTitle(f"{model.request.project_title} - Site plan")
    c.setAuthor(model.request.drawn_by)
    c.setSubject("Indicative site plan. Not a survey.")
    c.setCreator("Cadastral platform SA5")
    pg = _Page(c, model, fit)
    warnings: list[str] = []
    if not fit.fits:
        warnings.append(fit.message)

    _draw_plan(pg, aset)
    # sheet frame + title block panel on top of the clipped plan
    pg.style("C-ANNO-TTLB", 0.5)
    c.setDash([], 0)
    pg.path([(FRAME[0], FRAME[1]), (FRAME[2], FRAME[1]), (FRAME[2], FRAME[3]), (FRAME[0], FRAME[3])], True)
    pg.style("C-ANNO-TTLB", 0.25)
    c.setDash([], 0)
    pg.path([(VIEWPORT[0], VIEWPORT[1]), (VIEWPORT[2], VIEWPORT[1]), (VIEWPORT[2], VIEWPORT[3]),
             (VIEWPORT[0], VIEWPORT[3])], True)
    _draw_prims(pg, build_panel(model, model.scale, acks, fit, model.issue_date))
    c.showPage()
    c.save()
    return PdfBuild(fit=fit, warnings=warnings)
