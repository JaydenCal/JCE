"""Reusable flowables: chips, callouts, labelled tables, section headers, logo compositing."""
from __future__ import annotations

import io
from functools import lru_cache

from PIL import Image
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import Flowable, KeepTogether, Paragraph, Spacer, Table, TableStyle

from app.report import theme as T
from app.report.fmt import esc

ST = None


def st():
    global ST
    if ST is None:
        ST = T.styles()
    return ST


def P(text: str, style: str = "body", raw: bool = False) -> Paragraph:
    return Paragraph(text if raw else esc(text), st()[style])


def KS(h: float) -> Spacer:
    """Spacer that stays with the next flowable (so a heading is never left alone at the foot of a page)."""
    sp = Spacer(1, h)
    sp.keepWithNext = 1
    return sp


class Bookmark(Flowable):
    """Zero height flowable that adds a PDF outline (bookmark) entry at its position."""
    _n = 0

    def __init__(self, title: str, level: int = 0):
        super().__init__()
        Bookmark._n += 1
        self.title, self.level, self.key = title, level, f"bm{Bookmark._n}"
        self.keepWithNext = 1

    def wrap(self, aw, ah):
        return 0, 0

    def draw(self):
        # recorded now, replayed on the right page by the two-pass canvas (build._Numbered.save)
        c = self.canv
        c.__dict__.setdefault("_bm_log", []).append((c._pageNumber, self.key, self.title, self.level))


class CheckBox(Flowable):
    """Empty tick box drawn as a vector square (the bundled fonts have no box glyph)."""

    def wrap(self, aw, ah):
        return 9, 9

    def draw(self):
        c = self.canv
        c.setStrokeColor(T.INK); c.setLineWidth(0.7)
        c.rect(1, 1.5, 6, 6, stroke=1, fill=0)


class Chip(Flowable):
    """Rounded status chip (mono caps)."""

    def __init__(self, text: str, kind: str = "unchecked", h: float = 11.0, size: float = 6.2):
        super().__init__()
        self.text, self.kind, self.h, self.size = text.upper(), kind, h, size
        self.width = stringWidth(self.text, "Mono-Medium", size) + 11
        self.height = h

    def wrap(self, aw, ah):
        return self.width, self.height

    def draw(self):
        fg, bg = T.STATUS_COL.get(self.kind, T.STATUS_COL["unchecked"])
        c = self.canv
        c.setFillColor(colors.HexColor(bg)); c.setStrokeColor(colors.HexColor(fg)); c.setLineWidth(0.7)
        c.roundRect(0, 0, self.width, self.height, self.height / 2.6, stroke=1, fill=1)
        c.setFillColor(colors.HexColor(fg)); c.setFont("Mono-Medium", self.size)
        c.drawCentredString(self.width / 2, self.height / 2 - self.size * 0.33, self.text)


class Rule(Flowable):
    def __init__(self, width=None, color=T.RULE, thickness=0.6, gold: int = 0):
        super().__init__()
        self.w, self.color, self.t, self.gold = width, color, thickness, gold
        self.keepWithNext = 1

    def wrap(self, aw, ah):
        self.width = self.w or aw
        return self.width, self.t + 2

    def draw(self):
        c = self.canv
        c.setStrokeColor(self.color); c.setLineWidth(self.t); c.line(0, 1, self.width, 1)
        if self.gold:
            c.setStrokeColor(T.GOLD); c.setLineWidth(1.6); c.line(0, 1, self.gold, 1)


def section_head(num: str, title: str, sub: str | None = None) -> list:
    out = [Bookmark(f"{num}  {title}", 0), P(f"{num}  /  SECTION", "label"), KS(1.5), P(title, "h1"), Rule(CW_, gold=26 * mm), KS(4)]
    if sub:
        lead = P(sub, "lead")
        lead.style = lead.style.clone("leadk", keepWithNext=1)
        out += [lead, KS(1)]
    return out


CW_ = T.CW


def callout(inner: list | str, kind: str = "gold", width: float = T.CW, bg=T.PAPER) -> Table:
    col = {"gold": T.GOLD, "red": colors.HexColor("#a63a2b"), "blue": colors.HexColor("#2d5a96"), "ink": T.INK,
           "grey": T.MUTED, "green": colors.HexColor("#2f6b4a")}[kind]
    cell = [P(inner, "body")] if isinstance(inner, str) else inner
    t = Table([[cell]], colWidths=[width])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), bg), ("LINEBEFORE", (0, 0), (0, -1), 2.6, col),
                           ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                           ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    return t


def block(label: str, body: list, width: float = T.CW) -> Table:
    """Labelled content block with a gold rule on the left (What it is / What it may trigger / What to do next)."""
    t = Table([[[P(label.upper(), "label"), Spacer(1, 2)] + body]], colWidths=[width])
    t.setStyle(TableStyle([("LINEBEFORE", (0, 0), (0, -1), 1.4, T.GOLD), ("LEFTPADDING", (0, 0), (-1, -1), 9),
                           ("RIGHTPADDING", (0, 0), (-1, -1), 2), ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    return t


def kv_table(rows: list[tuple[str, str]], widths=(36 * mm, T.CW - 36 * mm), raw_values: bool = False) -> Table:
    data = [[P(k.upper(), "labelm"), (Paragraph(v, st()["cell"]) if raw_values else P(v, "cell"))] for k, v in rows]
    t = Table(data, colWidths=list(widths))
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -1), 0.4, T.RULE),
                           ("TOPPADDING", (0, 0), (-1, -1), 3.2), ("BOTTOMPADDING", (0, 0), (-1, -1), 3.2),
                           ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 4)]))
    return t


def grid_table(header: list[str], rows: list[list], widths: list[float], zebra: bool = True, repeat: int = 1, extra: list | None = None) -> Table:
    hdr = [P(h.upper(), "labelm") for h in header]
    t = Table([hdr] + rows, colWidths=widths, repeatRows=repeat)
    style = [("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, 0), 0.9, T.INK), ("LINEBELOW", (0, 1), (-1, -1), 0.4, T.RULE),
             ("TOPPADDING", (0, 0), (-1, -1), 3.4), ("BOTTOMPADDING", (0, 0), (-1, -1), 3.4),
             ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4)]
    if zebra:
        style += [("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f7f6f3")])]
    t.setStyle(TableStyle(style + (extra or [])))
    return t


@lru_cache(maxsize=8)
def logo_png(path: str, bg: str | None, height_px: int = 220) -> bytes | None:
    """Brand logo (gold outline on transparent) composited on a solid colour (ink for contrast), cropped to the lettering."""
    try:
        im = Image.open(path).convert("RGBA")
        bb = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
        if bb:
            im = im.crop(bb)
        r = height_px / im.height
        im = im.resize((max(1, int(im.width * r)), height_px), Image.LANCZOS)
        if bg:
            pad = int(height_px * 0.28)
            canvas = Image.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad), bg)
            canvas.alpha_composite(im, (pad, pad))
            im = canvas
        b = io.BytesIO(); im.save(b, "PNG")
        return b.getvalue()
    except Exception:  # noqa: BLE001  a missing logo must never stop a report
        return None


def draw_logo(c, brand, x, y, h, bg: str | None = "#1e2024") -> float:
    """Draw the logo with bottom-left (x, y) and height h; returns the drawn width (0 if unavailable)."""
    data = logo_png(str(brand.logo_path), bg)
    if not data:
        return 0.0
    im = Image.open(io.BytesIO(data))
    w = h * im.width / im.height
    c.drawImage(ImageReader(io.BytesIO(data)), x, y, w, h, mask="auto")
    return w
