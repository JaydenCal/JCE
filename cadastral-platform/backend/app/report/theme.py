"""Drawing-office look: warm paper, ink, one gold accent. Embedded TTFs (Jost / IBM Plex)."""
from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

FONT_DIR = Path(__file__).parent / "fonts"
PAPER = colors.HexColor("#f1f0ec")
PAPER_DK = colors.HexColor("#e6e4dd")
INK = colors.HexColor("#1e2024")
GOLD = colors.HexColor("#a8842f")
GOLD_LT = colors.HexColor("#efe6cf")
MUTED = colors.HexColor("#6b6e75")
RULE = colors.HexColor("#cfcdc6")
WHITE = colors.white
STATUS_COL = {          # chip colours (text/stroke, fill)
    "affected": ("#a63a2b", "#f6e1dd"),
    "nearby": ("#b4601a", "#f7e6d3"),
    "clear": ("#5b5f66", "#ececea"),         # neutral on purpose: not intersected must never read as "clear"
    "unchecked": ("#4a5160", "#e3e5e9"),
    "unresolved": ("#2d5a96", "#dde7f4"),
    "mapped": ("#1e2024", "#e6e4dd"),
}
PAGE_W, PAGE_H = 210 * mm, 297 * mm
LM = RM = 18 * mm
TM, BM = 26 * mm, 20 * mm
CW = PAGE_W - LM - RM            # content width

_FONTS = {"Jost": "Jost-Regular", "Jost-Medium": "Jost-Medium", "Jost-Bold": "Jost-SemiBold",
          "Plex": "IBMPlexSans-Regular", "Plex-Medium": "IBMPlexSans-Medium", "Plex-Bold": "IBMPlexSans-SemiBold",
          "Plex-Italic": "IBMPlexSans-Italic", "Mono": "IBMPlexMono-Regular", "Mono-Medium": "IBMPlexMono-Medium"}
_done = False


def register_fonts() -> None:
    global _done
    if _done:
        return
    for name, file in _FONTS.items():
        pdfmetrics.registerFont(TTFont(name, str(FONT_DIR / f"{file}.ttf")))
    pdfmetrics.registerFontFamily("Plex", normal="Plex", bold="Plex-Bold", italic="Plex-Italic", boldItalic="Plex-Bold")
    pdfmetrics.registerFontFamily("Jost", normal="Jost", bold="Jost-Bold", italic="Jost", boldItalic="Jost-Bold")
    pdfmetrics.registerFontFamily("Mono", normal="Mono", bold="Mono-Medium", italic="Mono", boldItalic="Mono-Medium")
    _done = True


def styles() -> dict[str, ParagraphStyle]:
    register_fonts()
    P = ParagraphStyle
    s = {
        "body": P("body", fontName="Plex", fontSize=8.8, leading=12.6, textColor=INK, alignment=TA_LEFT, spaceAfter=3),
        "small": P("small", fontName="Plex", fontSize=7.6, leading=10.4, textColor=INK),
        "muted": P("muted", fontName="Plex", fontSize=7.4, leading=10, textColor=MUTED),
        "mutedi": P("mutedi", fontName="Plex-Italic", fontSize=7.4, leading=10, textColor=MUTED),
        "cell": P("cell", fontName="Plex", fontSize=7.6, leading=10, textColor=INK),
        "cellb": P("cellb", fontName="Plex-Medium", fontSize=7.8, leading=10, textColor=INK),
        "cellm": P("cellm", fontName="Plex", fontSize=7, leading=9.4, textColor=MUTED),
        "label": P("label", fontName="Mono", fontSize=6.4, leading=8, textColor=GOLD, keepWithNext=1),
        "labelm": P("labelm", fontName="Mono", fontSize=6.4, leading=8, textColor=MUTED),
        "h1": P("h1", fontName="Jost-Bold", fontSize=21, leading=24, textColor=INK, spaceAfter=2, keepWithNext=1),
        "h2": P("h2", fontName="Jost-Medium", fontSize=12.5, leading=15, textColor=INK, spaceBefore=7, spaceAfter=3, keepWithNext=1),
        "h3": P("h3", fontName="Jost-Medium", fontSize=10.2, leading=12.5, textColor=INK, spaceBefore=4, spaceAfter=1, keepWithNext=1),
        "lead": P("lead", fontName="Plex", fontSize=10, leading=14.5, textColor=INK, spaceAfter=4),
        "bullet": P("bullet", fontName="Plex", fontSize=8.6, leading=12, textColor=INK, leftIndent=9, bulletIndent=0, spaceAfter=2),
        "caption": P("caption", fontName="Plex", fontSize=7.2, leading=9.6, textColor=MUTED, spaceBefore=2, spaceAfter=5),
    }
    return s


def hexc(h: str):
    return colors.HexColor(h)
