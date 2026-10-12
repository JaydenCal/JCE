"""Multi-page vector PDF (A3 landscape) from Sheets."""
from __future__ import annotations

import io
import math
from pathlib import Path

from PIL import Image
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from app.agents.sa5_cad_dxf.layers import LINETYPE_PATTERNS, pdf_rgb
from app.agents.sa5_cad_dxf.planset import fonts
from app.agents.sa5_cad_dxf.planset.core import A3, Item, Sheet, View
from app.agents.sa5_cad_dxf.planset.layers_ext import layer as layer_def

DASH_UNIT_MM = 2.2


def _style(c: canvas.Canvas, it: Item, fill: bool = False) -> None:
    d = layer_def(it.layer)
    col = it.color if it.color is not None else pdf_rgb(d.aci)
    c.setStrokeColorRGB(*col)
    c.setFillColorRGB(*col)
    c.setLineWidth(max(0.08, it.lw if it.lw is not None else d.lineweight_mm) * mm)
    lt = it.dash or d.linetype
    pat = LINETYPE_PATTERNS.get(lt, ())
    c.setDash([max(0.3, abs(p) * DASH_UNIT_MM) * mm for p in pat] if pat else [], 0)
    c.setLineJoin(1)
    c.setLineCap(1 if not pat else 0)


def _faded(path: str, fade: float) -> ImageReader:
    im = Image.open(path).convert("RGB")
    white = Image.new("RGB", im.size, (255, 255, 255))
    im = Image.blend(im, white, fade)
    b = io.BytesIO()
    im.save(b, "JPEG", quality=88)
    b.seek(0)
    return ImageReader(b)


def _path(c, pts_mm, close: bool):
    p = c.beginPath()
    p.moveTo(pts_mm[0][0] * mm, pts_mm[0][1] * mm)
    for x, y in pts_mm[1:]:
        p.lineTo(x * mm, y * mm)
    if close:
        p.close()
    return p


def _draw(c: canvas.Canvas, v: View, it: Item) -> None:
    T = v.tp
    if it.kind == "line":
        _style(c, it)
        pts = [T(x, y) for x, y in it.pts]
        c.drawPath(_path(c, pts, it.closed), stroke=1, fill=0)
    elif it.kind == "fill":
        rings = [[T(x, y) for x, y in r] for r in it.pts]
        c.saveState()
        _style(c, it)
        p = c.beginPath()
        for r in rings:
            p.moveTo(r[0][0] * mm, r[0][1] * mm)
            for x, y in r[1:]:
                p.lineTo(x * mm, y * mm)
            p.close()
        if it.hatch is None:
            c.setFillAlpha(it.alpha)
            c.drawPath(p, stroke=0, fill=1, fillMode=0)       # even-odd
        else:
            ang, sp = it.hatch
            c.clipPath(p, stroke=0, fill=0, fillMode=0)
            c.setStrokeAlpha(it.alpha)
            c.setLineWidth(0.15 * mm)
            xs = [x for r in rings for x, _ in r]
            ys = [y for r in rings for _, y in r]
            cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
            R = math.hypot(max(xs) - min(xs), max(ys) - min(ys)) / 2 + sp
            a = math.radians(ang)
            ux, uy, nx, ny = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
            n = int(R / sp) + 1
            q = c.beginPath()
            for i in range(-n, n + 1):
                ox, oy = cx + nx * i * sp, cy + ny * i * sp
                q.moveTo((ox - ux * R) * mm, (oy - uy * R) * mm)
                q.lineTo((ox + ux * R) * mm, (oy + uy * R) * mm)
            c.drawPath(q, stroke=1, fill=0)
        c.restoreState()
    elif it.kind == "text":
        _text(c, v, it)
    elif it.kind == "image":
        x0, y0, x1, y1 = it.extent
        (a, b), (d, e) = T(x0, y0), T(x1, y1)
        c.drawImage(_faded(it.image, it.fade), a * mm, b * mm, (d - a) * mm, (e - b) * mm)


def _text(c: canvas.Canvas, v: View, it: Item) -> None:
    px, py = v.tp(*it.pts[0])
    font = fonts.face(it.bold, it.italic)
    size = it.h / fonts.CAP_RATIO * mm
    w = c.stringWidth(it.text, font, size)
    vt, hz = it.anchor.split("_")
    dx = {"LEFT": 0.0, "CENTER": -w / 2, "RIGHT": -w}[hz]
    dy = {"BOTTOM": 0.0, "MIDDLE": -it.h * mm / 2, "TOP": -it.h * mm}[vt]
    d = layer_def(it.layer)
    col = it.color if it.color is not None else (0, 0, 0)
    c.saveState()
    c.translate(px * mm, py * mm)
    c.rotate(it.rot)
    if it.halo:
        t = c.beginText(dx, dy)
        t.setFont(font, size)
        t.setTextRenderMode(1)
        c.setStrokeColorRGB(1, 1, 1)
        c.setLineWidth(1.5)
        c.setLineJoin(1)
        t.textOut(it.text)
        c.drawText(t)
    c.setFillColorRGB(*col)
    t = c.beginText(dx, dy)
    t.setFont(font, size)
    t.textOut(it.text)
    c.drawText(t)
    c.restoreState()


def render_pdf(sheets: list[tuple[Sheet, list[View]]], path: str | Path, title: str = "Civil plan set") -> int:
    """``sheets``: [(sheet, [frame view, content views...])] in page order."""
    fonts.info()
    c = canvas.Canvas(str(path), pagesize=(A3[0] * mm, A3[1] * mm), pageCompression=1)
    c.setTitle(title)
    c.setAuthor("JCE plan set generator")
    for sh, views in sheets:
        for v in views:
            c.saveState()
            if not v.paper and v.clip:
                r = v.rect
                p = c.beginPath()
                p.rect(r[0] * mm, r[1] * mm, (r[2] - r[0]) * mm, (r[3] - r[1]) * mm)
                c.clipPath(p, stroke=0, fill=0)
            elif v.paper and v.clip and v.name.startswith("clip:"):
                r = v.rect
                p = c.beginPath()
                p.rect(r[0] * mm, r[1] * mm, (r[2] - r[0]) * mm, (r[3] - r[1]) * mm)
                c.clipPath(p, stroke=0, fill=0)
            for it in v.items:
                _draw(c, v, it)
            c.restoreState()
            if v.frame:
                r = v.rect
                c.setStrokeColorRGB(0, 0, 0)
                c.setLineWidth(0.35 * mm)
                c.setDash([], 0)
                c.rect(r[0] * mm, r[1] * mm, (r[2] - r[0]) * mm, (r[3] - r[1]) * mm)
        c.showPage()
    c.save()
    return len(sheets)
