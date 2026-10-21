"""Reference-style panels and tables on the plan sheets (one look everywhere): boxed text panel, red DATA NOT AVAILABLE or flag panel, schedule table
and a stacked column of them.  All text is UPPERCASE drawing text at the sheet type scale (``style.TXT``); positions are PAPER mm.

The legacy A3 style keeps ``draw.panel``; nothing here is used by it.
"""
from __future__ import annotations

import re

from shapely.geometry import box as sbox

from app.agents.sa5_cad_dxf.planset import fonts
from app.agents.sa5_cad_dxf.planset.core import View
from app.agents.sa5_cad_dxf.planset.style import GRID, TXT, WHITE, Paper, clean

def up(t: str) -> str:
    """UPPERCASE drawing text with SI unit symbols kept lower case (3.0m, 5 m DEM, 15 m2)."""
    return re.sub(r"(\d)(\s?)M(2?)(?![A-Z0-9])", r"\1\2m\3", clean(t).upper())


RED = (0.72, 0.1, 0.1)
PAD = 2.0
PITCH = TXT.BODY + 1.1
TITLE_H = 7.2           # title line plus gap above the first body line


def _lines(lines, w: float, h: float = TXT.BODY) -> list[tuple[str, bool]]:
    """(text, continuation) for every wrapped line of ``lines``; a line that starts with '- ' is a bullet with a hanging indent."""
    out = []
    for ln in lines:
        if not ln:
            continue
        bullet = ln.startswith("- ")
        for k, t in enumerate(fonts.wrap(up(ln), h, w - 2 * PAD - (3.0 if bullet else 0.0))):
            out.append((t, bullet and k > 0))
        out.append(("", False))                       # paragraph gap
    return out[:-1] if out else out


def _title_lines(title: str, w: float) -> list[str]:
    return fonts.wrap(up(title), TXT.LABEL, w - 2 * PAD, bold=True) if title else [""]


def panel_height(lines, w: float, h: float = TXT.BODY, title: str = "") -> float:
    ls = _lines(lines, w, h)
    extra = (len(_title_lines(title, w)) - 1) * (TXT.LABEL + 1.2)
    return TITLE_H + extra + sum(PITCH if t else 0.9 for t, _c in ls) + PAD


def draw_panel(v: View, rect, title: str, lines, warn: bool = False, h: float = TXT.BODY, layer: str = "C-ANNO-NOTE") -> float:
    """Boxed panel (white, thin black edge, or red when ``warn``): bold title, wrapped body.  Returns the paper y of the bottom of the text."""
    x0, y0, x1, y1 = rect
    P = Paper(v)
    col = RED if warn else None
    P.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], layer, WHITE, edge=RED if warn else (0, 0, 0), edge_lw=0.35 if warn else 0.25)
    tl = _title_lines(title, x1 - x0)
    for i, t_ in enumerate(tl):
        P.text(x0 + PAD, y1 - 1.2 - i * (TXT.LABEL + 1.2), t_, TXT.LABEL, "TOP_LEFT", bold=True, color=col, layer=layer)
    yy = y1 - TITLE_H + 0.4 - (len(tl) - 1) * (TXT.LABEL + 1.2)
    for t, cont in _lines(lines, x1 - x0, h):
        if not t:
            yy -= 0.9
            continue
        bul = t.startswith("- ")
        P.text(x0 + PAD + (3.0 if cont else 0.0), yy, t, h, "TOP_LEFT", color=col, layer=layer)
        yy -= PITCH
    return yy


def no_data(v: View, rect, what: str, extra: str = "") -> None:
    draw_panel(v, rect, "DATA NOT AVAILABLE", [what] + ([extra] if extra else []), warn=True, layer="C-DATA-NONE")


# ---- schedule table -----------------------------------------------------------------------------------------------------------------------
def table_height(rows, w: float, cols=(0.46, 0.16, 0.38), h: float = TXT.BODY) -> float:
    """Height of a schedule: title band plus one row per entry (row = tuple of cell strings, wrapped within its column)."""
    tot = TITLE_H - 1.0
    for r in rows:
        n = max(len(fonts.wrap(up(c), h, w * f - 2 * 1.2)) for c, f in zip(r, cols))
        tot += n * PITCH + 1.4
    return tot + 1.0


def draw_table(v: View, rect, title: str, rows, cols=(0.46, 0.16, 0.38), h: float = TXT.BODY, bold_col: int = 1, red_col: int | None = 2, red_when=None,
               layer: str = "C-ANNO-TABL") -> None:
    """Boxed schedule: bold title, one ruled row per entry; column ``bold_col`` is bold (the value); a row whose cells match ``red_when`` (callable on the row) is red."""
    x0, y0, x1, y1 = rect
    w = x1 - x0
    P = Paper(v)
    P.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], layer, WHITE, edge=(0, 0, 0), edge_lw=0.25)
    P.text(x0 + PAD, y1 - 1.2, up(title), TXT.LABEL, "TOP_LEFT", bold=True, layer=layer)
    xs = [x0]
    for f in cols:
        xs.append(xs[-1] + w * f)
    yy = y1 - TITLE_H + 1.0
    for r in rows:
        cells = [fonts.wrap(up(c), h, w * f - 2 * 1.2) for c, f in zip(r, cols)]
        n = max(len(c) for c in cells)
        P.line([(x0, yy + 0.2), (x1, yy + 0.2)], layer, 0.08, GRID)
        red = bool(red_when and red_when(r))
        for k, c in enumerate(cells):
            for i, t in enumerate(c):
                P.text(xs[k] + 1.2, yy - 1.2 - i * PITCH, t, h, "TOP_LEFT", bold=(k == bold_col), color=RED if (red and (red_col is None or k == red_col)) else None, layer=layer)
        yy -= n * PITCH + 1.4


# ---- stacked column ------------------------------------------------------------------------------------------------------------------------
def column(b, heights, w: float, gap: float = 3.0, margin: float = 4.0, sides=("left", "right"), top: bool = True):
    """Paper rectangles for a column of boxes (heights top to bottom) against the left or right edge of the plan viewport, on the first side where the whole
    column clears the drawn subject (lot, driveway, crossover, kerb lines), the reserved rectangles and the sheet labels.  None when neither side is clear."""
    from shapely.ops import unary_union
    v, R = b.v, b.v.rect
    subj = v.to_paper_geom(unary_union([g for g in [b.s.lot, b.s.drive_poly, b.s.crossover] + list(getattr(b, "kerb_geoms", [])) if g is not None])).buffer(4.0)
    total = sum(heights) + gap * (len(heights) - 1)
    for side in sides:
        x0 = R[0] + margin if side == "left" else R[2] - margin - w
        ytop = R[3] - margin
        rects = []
        y = ytop
        for hh in heights:
            rects.append((x0, y - hh, x0 + w, y))
            y -= hh + gap
        if rects[-1][1] < R[1] + margin:
            continue
        if any(subj.intersects(sbox(*r)) for r in rects):
            continue
        if any(not v.free((r[0] - 2, r[1] - 2, r[2] + 2, r[3] + 2)) for r in rects):
            continue
        return rects
    return None


# ---- notes for text that could not be placed on the drawing --------------------------------------------------------------------------------------
TAG_NOTES_TITLE = "NOTES FOR TAGS AND LABELS NOT PLACED ON THE DRAWING"


def place_notes_panel(v: View, lines, avoid=None, w: float = 120.0, margin: float = 4.0) -> tuple | None:
    """Draw the text of call-outs and labels that found no free place as one boxed notes list in the first free rectangle of the view (clear of ``avoid``,
    a paper-mm geometry, and of every reserved label), and reserve it.  Returns the rectangle, or None when the view has no room (the caller then keeps
    the lines for the datum panel, so nothing is dropped)."""
    lines = [x for x in lines if x]
    if not lines:
        return None
    h = panel_height(lines, w)
    R = v.rect
    xs = [R[2] - margin - w, R[0] + margin, (R[0] + R[2]) / 2 - w / 2]
    y = R[1] + margin
    while y + h <= R[3] - margin:
        for x in xs:
            r = (x, y, x + w, y + h)
            if not v.free((r[0] - 2, r[1] - 2, r[2] + 2, r[3] + 2)):
                continue
            if avoid is not None and avoid.intersects(sbox(*r)):
                continue
            v.reserve(r)
            draw_panel(v, r, TAG_NOTES_TITLE, lines)
            return r
        y += 6.0
    return None
