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
from app.agents.sa5_cad_dxf.planset import style as _ref_style
from app.agents.sa5_cad_dxf.planset.core import A3, CUSTOM_DASH, Item, Sheet, View
from app.agents.sa5_cad_dxf.planset.layers_ext import layer as layer_def

DASH_UNIT_MM = 2.2


def _style(c: canvas.Canvas, it: Item, fill: bool = False) -> None:
    d = layer_def(it.layer)
    col = it.color if it.color is not None else pdf_rgb(d.aci)
    c.setStrokeColorRGB(*col)
    c.setFillColorRGB(*col)
    c.setLineWidth(max(0.08, it.lw if it.lw is not None else d.lineweight_mm) * mm)
    lt = it.dash or d.linetype
    custom = CUSTOM_DASH.get(lt)
    pat = custom or LINETYPE_PATTERNS.get(lt, ())
    if custom:
        c.setDash([abs(p) * mm for p in custom], 0)             # reference-style dash: lengths are paper mm
    else:
        c.setDash([max(0.3, abs(p) * DASH_UNIT_MM) * mm for p in pat] if pat else [], 0)
    c.setLineJoin(1)
    c.setLineCap(1 if not pat else 0)


_SMOOTH_PITCH_MM = 0.3         # an aerial pixel larger than this on the paper is smoothed (bicubic) instead of printing as a hard block
_SMOOTH_MAX_PX = 3800


def _faded(path: str, fade: float, placed_w_mm: float | None = None) -> ImageReader:
    im = Image.open(path).convert("RGB")
    if placed_w_mm:                                              # large-scale sheets (1:50) enlarge a low resolution aerial: smooth it, never invent detail
        pitch = placed_w_mm / im.width
        if pitch > _SMOOTH_PITCH_MM:
            f = min(pitch / _SMOOTH_PITCH_MM, 4.0, _SMOOTH_MAX_PX / max(im.size))
            if f > 1.05:
                im = im.resize((int(im.width * f), int(im.height * f)), Image.BICUBIC)
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


def _stipple(c: canvas.Canvas, rings, pitch: float | None = None) -> None:
    """AR-CONC look inside the current clip, as plotted in the reference: tiny round dots with an occasional larger round dot or short dash
    (round-capped strokes), deterministic pseudo-random placement.  Sizes and density are graphic conventions, not data."""
    import random
    R = _ref_style.REF
    xs = [x for r in rings for x, _ in r]
    ys = [y for r in rings for _, y in r]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    sp = pitch or R.stipple_spacing_mm
    while ((x1 - x0) / sp + 1) * ((y1 - y0) / sp + 1) > 40000:
        sp *= 1.5
    rnd = random.Random(int(abs(x0) * 7919) ^ int(abs(y0) * 104729))
    ink = (0, 0, 0) if not pitch else (0.55, 0.55, 0.55)       # a lighter stipple (pitch override) also prints in a lighter ink
    c.setStrokeColorRGB(*ink)
    c.setFillColorRGB(*ink)
    c.setDash([], 0)
    c.setLineCap(1)
    n, y = 0, y0
    while y <= y1 + sp:
        x = x0
        while x <= x1 + sp:
            px, py = x + rnd.uniform(0, sp), y + rnd.uniform(0, sp)
            n += 1
            if n % R.stipple_big_every == 0:
                w, L = R.stipple_big_w_mm, (R.stipple_dash_len_mm if (n // R.stipple_big_every) % 2 else R.stipple_dot_len_mm)
            else:
                w, L = R.stipple_small_w_mm, 0.0
            a = rnd.uniform(-0.26, 0.26)
            if n % R.stipple_big_every != 0 and n % R.stipple_tri_every == 3:       # small solid triangle (about 1 mark in 6)
                z, rot = R.stipple_tri_size_mm, rnd.uniform(0, 2 * math.pi)
                q = c.beginPath()
                for k in range(3):
                    ax_, ay_ = px + z * 0.58 * math.cos(rot + k * 2.0944), py + z * 0.58 * math.sin(rot + k * 2.0944)
                    (q.moveTo if k == 0 else q.lineTo)(ax_ * mm, ay_ * mm)
                q.close()
                c.drawPath(q, stroke=0, fill=1)
                x += sp
                continue
            c.setLineWidth(w * mm)
            q = c.beginPath()
            q.moveTo(px * mm, py * mm)
            q.lineTo((px + L * math.cos(a)) * mm, (py + L * math.sin(a)) * mm)
            c.drawPath(q, stroke=1, fill=0)
            x += sp
        y += sp


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
        if it.pattern == "AR-CONC":
            c.setFillAlpha(it.alpha)
            c.drawPath(p, stroke=0, fill=1, fillMode=0)
            c.clipPath(p, stroke=0, fill=0, fillMode=0)
            _stipple(c, rings, it.stipple)
        elif it.hatch is None:
            c.setFillAlpha(it.alpha)
            c.drawPath(p, stroke=0, fill=1, fillMode=0)       # even-odd
        else:
            ang, sp = it.hatch
            c.clipPath(p, stroke=0, fill=0, fillMode=0)
            c.setStrokeAlpha(it.alpha)
            c.setLineWidth((it.hatch_lw if it.hatch_lw else 0.15) * mm)
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
        if it.edge is not None:
            c.saveState()
            c.setStrokeColorRGB(*it.edge)
            c.setLineWidth((it.edge_lw or 0.254) * mm)
            c.setDash([], 0)
            c.setLineJoin(1)
            c.drawPath(p, stroke=1, fill=0)
            c.restoreState()
    elif it.kind == "text":
        _text(c, v, it)
    elif it.kind == "image":
        x0, y0, x1, y1 = it.extent
        if not v.paper and v.twist:                                   # rotated view: draw the image about its centre, turned by the view twist
            px, py = T((x0 + x1) / 2, (y0 + y1) / 2)
            w, h = (x1 - x0) * v.k, (y1 - y0) * v.k
            c.saveState()
            c.translate(px * mm, py * mm)
            c.rotate(v.twist)
            c.drawImage(_faded(it.image, it.fade, w), -w / 2 * mm, -h / 2 * mm, w * mm, h * mm)
            c.restoreState()
            return
        (a, b), (d, e) = T(x0, y0), T(x1, y1)
        c.drawImage(_faded(it.image, it.fade, abs(d - a)), a * mm, b * mm, (d - a) * mm, (e - b) * mm)


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
    t._code.append("0 Tr")                                       # Tr persists across BT/ET; reportlab skips the default mode
    t.textOut(it.text)
    c.drawText(t)
    c.restoreState()


def render_pdf(sheets: list[tuple[Sheet, list[View]]], path: str | Path, title: str = "Civil plan set", author: str = "JCE plan set generator") -> int:
    """``sheets``: [(sheet, [frame view, content views...])] in page order."""
    fonts.info()
    c = canvas.Canvas(str(path), pagesize=(A3[0] * mm, A3[1] * mm), pageCompression=1)
    c.setTitle(title)
    c.setAuthor(author)
    for sh, views in sheets:
        c.setPageSize((sh.paper[0] * mm, sh.paper[1] * mm))
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
