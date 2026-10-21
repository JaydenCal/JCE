"""A1 landscape frame in the engineer's reference style: border with zone grid (letters A to F, numbers 1 to 8), full-width title block
along the bottom and a small datum / accuracy notes panel directly above it on the right.  Paper mm, origin bottom-left.

Layout numbers are measured from the reference sheet (JCE-004-CV-1100).  Nothing here is a requirement.  CHECKED and APPROVED are left
blank and no initials or signatures are implied.
"""
from __future__ import annotations

import datetime as dt
import re

from shapely.geometry import Polygon

from app.agents.sa5_cad_dxf.planset import fonts
from app.agents.sa5_cad_dxf.planset.core import A1, Sheet, View
from app.agents.sa5_cad_dxf.planset import codes
from app.agents.sa5_cad_dxf.planset.style import BLACK, GRID, LABEL_GREY, WHITE, clean
from app.agents.sa5_cad_dxf.planset.titleblock import STAMP, Proj

W, H = A1
BX0, BX1, BY0, BY1 = 20.0, 831.0, 10.0, 584.0      # border
TB_TOP = 88.0                                       # top of the title block
AREA = (BX0, TB_TOP, BX1, BY1)                      # drawing area inside the border, above the title block
NOTES_X0 = 611.0
_L = "C-ANNO-TTLB"
_G = "C-ANNO-GRID"
SMALL, LABEL_H = 2.2, 2.2


def fmt_date(s: str) -> str:
    """DD/MM/YYYY from an ISO date; other text is returned unchanged."""
    try:
        return dt.date.fromisoformat(str(s)[:10]).strftime("%d/%m/%Y")
    except (ValueError, TypeError):
        return str(s or "")


def drawing_number(sheet_number: str, job: str = "") -> str:
    """JCS-{job}-CIV-{NNN} (see codes.py); an empty job shows XXX so the placeholder is visible."""
    return codes.drawing_number(sheet_number, job)


AI_NOTE_H = 2.2
AI_RED = (0.72, 0.0, 0.0)


def _ai_notes_h(x0: float = NOTES_X0) -> tuple[list[str], float]:
    """Stage 8: the AI statement is no longer drawn on the notes panel (the verification block is on the cover only); kept as a zero height box."""
    return [], 0.0


def verification_block(v, x0: float, y0: float, x1: float, y1: float, big: bool = False) -> None:
    """The cover verification block inside the paper-mm rectangle: heading label, tick box with the statement, then a signature box divided into NAME, SIGNATURE and DATE.
    Blank by design: a person fills it in.  Layer JCS-FRAM-AICK-* (the layer code of the earlier AI CHECK field)."""
    L = "JCS-FRAM-AICK-TEXT"
    ln = "JCS-FRAM-AICK-LINE"
    v.text(x0 + 1.0, y1 - 1.0, codes.VERIFY_LABEL, 3.0 if big else 2.0, "TOP_LEFT", color=LABEL_GREY, layer=L)
    tb = 10.0 if big else 7.0
    th = 5.2 if big else 3.6
    bx, by = x0 + 4.0, y1 - (7.0 if big else 5.0) - tb
    v.line([(bx, by), (bx + tb, by), (bx + tb, by + tb), (bx, by + tb), (bx, by)], ln, False, 0.35)
    v.text(bx + tb + 3.0, by + tb / 2.0 + (3.4 if big else 3.0), codes.VERIFY_TEXT, _fit(codes.VERIFY_TEXT, x1 - bx - tb - 8.0, th), "MIDDLE_LEFT", bold=True, layer=L)
    v.text(bx + tb + 3.0, by + tb / 2.0 - (3.0 if big else 2.2), "TICK WHEN VERIFIED", 2.5 if big else 2.0, "MIDDLE_LEFT", color=LABEL_GREY, layer=L)
    sx0, sx1, sy0, sy1 = x0 + 4.0, x1 - 4.0, y0 + 3.0, by - 3.0
    v.line([(sx0, sy0), (sx1, sy0), (sx1, sy1), (sx0, sy1), (sx0, sy0)], ln, False, 0.35)
    wd = sx1 - sx0
    xs = [sx0, sx0 + wd * 0.33, sx0 + wd * 0.78, sx1]
    for xx in xs[1:-1]:
        v.line([(xx, sy0), (xx, sy1)], ln, False, 0.25)
    for xx, nm in zip(xs[:-1], codes.VERIFY_FIELD_NAMES):
        v.text(xx + 1.2, sy1 - 1.0, nm, 2.8 if big else 2.0, "TOP_LEFT", color=LABEL_GREY, layer=L)


SHEET_NOTES = "SHEET NOTES"
PANEL_MAX_H = 35.0 - 1.5                    # panel stays inside the strip band between the title block (y 88) and the plan viewport (y 123)
PANEL_X0S = (611.0, 560.0, 510.0, 460.0, 410.0, 360.0)


def _panel(proj: Proj, notes, tags, reserve: int, x0: float):
    lines: list[str] = []
    w = BX1 - x0 - 4
    if proj.datum:                                                       # one paragraph (UPPERCASE) instead of one line per datum item
        lines += fonts.wrap(" ".join(clean(t) for t in proj.datum).upper(), 2.0, w)
    notes = [clean(n).upper() for n in notes if n]
    tags = [clean(n).upper() for n in tags if n]
    if notes or tags:
        lines.append(SHEET_NOTES)
        for i, n in enumerate(notes, 1):
            lines += fonts.wrap(f"{i}. {n}", 2.0, w)
        for n in tags:
            lines += fonts.wrap(n, 2.0, w)
    lines += [""] * reserve
    return (x0, TB_TOP, BX1, TB_TOP + 6.5 + 2.6 * len(lines) + _ai_notes_h(x0)[1] + 2.0), lines


def notes_layout(proj: Proj, notes=(), tags=(), reserve: int = 0, min_x0: float = 400.0) -> tuple[tuple, list[str]]:
    """(rect, wrapped lines) of the datum and notes panel above the title block, right side: datum paragraph, then numbered sheet notes and tag notes.
    The panel is as narrow as the standard width allows and widens leftwards (never left of ``min_x0``, the end of the strip text) until it fits the
    strip band, so it never overhangs the plan viewport; if it still does not fit at ``min_x0`` it grows upward (reported by the tests)."""
    cands = [x for x in PANEL_X0S if x >= min_x0]
    if not cands or cands[-1] > min_x0 + 1.0:
        cands.append(min(min_x0, NOTES_X0))
    best = None
    for x0 in cands:
        best = _panel(proj, notes, tags, reserve, x0)
        if best[0][3] - TB_TOP <= PANEL_MAX_H:
            return best
    return best


def _fit(s: str, max_w: float, h_max: float, bold: bool = False, h_min: float = 1.8) -> float:
    h = h_max
    while h > h_min and fonts.text_width(s, h, bold) > max_w:
        h -= 0.1
    return max(h, h_min)


def draw_frame_a1(sheet: Sheet, proj: Proj, index: int, total: int, scale_text: str) -> View:
    v = View("titleblock", (0, 0, W, H))

    def line(pts, closed=False, lw=0.254, layer=_L, color=None):
        v.line(pts, layer, closed, lw, color=color)

    def box(x0, y0, x1, y1, lw=0.254, layer=_L):
        line([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], True, lw, layer)

    def fillbox(x0, y0, x1, y1, color, layer=_L):
        v.fill(Polygon([(x0, y0), (x1, y0), (x1, y1), (x0, y1)]), layer, color, 1.0, anno=True)

    def label(x, ytop, s, color=LABEL_GREY):
        v.text(x + 1.5, ytop - 1.2, s, LABEL_H, "TOP_LEFT", color=color, layer=_L)

    def value(x, y, s, h, maxw, bold=True, anchor="BOTTOM_LEFT", color=None):
        s = clean(s)
        if s:
            v.text(x, y, s, _fit(s, maxw, h, bold), anchor, bold=bold, color=color, layer=_L)

    # ---- border and zone grid ------------------------------------------------------------------------------------
    box(BX0, BY0, BX1, BY1, 0.5)
    cw, rh = (BX1 - BX0) / 8.0, (BY1 - BY0) / 6.0
    for i in range(1, 8):
        x = BX0 + i * cw
        line([(x, BY0 - 2), (x, BY0)], False, 0.106, _G, GRID)
        line([(x, BY1), (x, BY1 + 2)], False, 0.106, _G, GRID)
    for j in range(1, 6):
        y = BY0 + j * rh
        line([(BX0 - 2, y), (BX0, y)], False, 0.106, _G, GRID)
        line([(BX1, y), (BX1 + 2, y)], False, 0.106, _G, GRID)
    for i in range(8):
        for y in (BY0 / 2.0, (BY1 + H) / 2.0):
            v.text(BX0 + (i + 0.5) * cw, y, str(i + 1), 2.5, "MIDDLE_CENTER", color=LABEL_GREY, layer=_G)
    for j, ch in enumerate("ABCDEF"):
        for x in (BX0 / 2.0, (BX1 + W) / 2.0):
            v.text(x, BY1 - (j + 0.5) * rh, ch, 2.5, "MIDDLE_CENTER", color=LABEL_GREY, layer=_G)

    # ---- title block skeleton ---------------------------------------------------------------------------------------
    X_CO, X_PRJ, X_REV, X_RT = 204.0, 451.0, 640.0, 640.0
    box(BX0, BY0, BX1, TB_TOP, 0.35)
    for x in (X_CO, X_PRJ, X_REV):
        line([(x, BY0), (x, TB_TOP)])
    for y in (32.0, 54.0):
        line([(X_CO, y), (X_PRJ, y)])

    # ---- platform block: plain text wordmark (JCESITE is not affiliated with JCE Infrastructure) and the AI CHECK field ------------------
    pb = proj.brand if isinstance(proj.brand, codes.PlatformBrand) else codes.PLATFORM_BRAND
    v.text(26.0, 64.0, pb.name, 16.0, "BOTTOM_LEFT", bold=True, layer=_L)
    v.text(26.5, 57.5, pb.tagline, _fit(pb.tagline, X_CO - 32.0, 3.6), "BOTTOM_LEFT", layer=_L)
    yy = 83.0
    for t in (pb.website, f"ABN {pb.abn}" if pb.abn else None, f"T {pb.phone}" if pb.phone else None, pb.email, pb.address):
        if t:                                           # only when a platform brand setting supplies them
            v.text(120.0, yy, clean(t), _fit(clean(t), X_CO - 123.0, 3.0), "BOTTOM_LEFT", layer=_L)
            yy -= 4.6
    line([(BX0, 54.0), (X_CO, 54.0)])
    if getattr(sheet, "number", "") == "C000":                                   # the verification block: the cover only (stage 8)
        verification_block(v, BX0, BY0, X_CO, 54.0)

    # ---- project / client / drawing title -----------------------------------------------------------------------------
    label(X_CO, TB_TOP, "PROJECT")
    value(X_CO + 1.5, 70.0, clean(proj.title).upper(), 4.9, X_PRJ - X_CO - 4)
    sub = ", ".join(x for x in (f"LOT {proj.lotplan}".upper() if proj.lotplan else "", clean(proj.address).upper()) if x)
    value(X_CO + 1.5, 61.0, sub, 3.5, X_PRJ - X_CO - 4, bold=False)
    value(X_CO + 1.5, 55.8, f"{proj.council}  {proj.zone}".strip().upper() if (proj.council or proj.zone) else "", 2.5, X_PRJ - X_CO - 4, bold=False)
    label(X_CO, 54.0, "CLIENT")
    value(X_CO + 1.5, 36.5, proj.client.upper() if proj.client else "", 4.9, X_PRJ - X_CO - 4)
    label(X_CO, 32.0, "DRAWING TITLE")
    value(X_CO + 1.5, 14.5, sheet.title.upper(), 4.9, X_PRJ - X_CO - 4)

    # ---- revisions table ----------------------------------------------------------------------------------------------
    cols = [X_PRJ, 467.0, 497.0, 592.0, 608.0, 624.0, X_REV]
    v.text(X_PRJ + 1.5, 84.5, "REVISIONS", 2.9, "MIDDLE_LEFT", layer=_L)
    fillbox(X_PRJ, 74.0, X_REV, 81.0, BLACK, "C-ANNO-TABL")
    for i, t in enumerate(("REV", "DATE", "DESCRIPTION", "DRN", "CHK", "APP")):
        left = t == "DESCRIPTION"
        v.text(cols[i] + (1.5 if left else (cols[i + 1] - cols[i]) / 2), 77.5, t, 2.0, "MIDDLE_LEFT" if left else "MIDDLE_CENTER", color=WHITE, layer="C-ANNO-TABL")
    for y in [81.0, 74.0] + [66.0 - 8.0 * k for k in range(8)]:
        line([(X_PRJ, y), (X_REV, y)])
    for x in cols[1:-1]:
        line([(x, BY0), (x, 74.0)])
    for r, row in enumerate(proj.revisions[:8]):
        rev, desc, date, by = (list(row) + ["", "", "", ""])[:4]
        yc = 70.0 - 8.0 * r
        for i, (t, w) in enumerate(((rev, 16.0), (fmt_date(date), 30.0), (desc.upper(), 92.0), (by, 16.0))):
            t = clean(t)
            if t:
                left = i == 2
                v.text(cols[i] + (1.5 if left else (cols[i + 1] - cols[i]) / 2), yc, t, _fit(t, w - 2, 2.6), "MIDDLE_LEFT" if left else "MIDDLE_CENTER", layer="C-ANNO-TABL")

    # ---- right block --------------------------------------------------------------------------------------------------
    for y in (33.0, 56.0):
        line([(X_RT, y), (BX1, y)])
    line([(805.0, 56.0), (805.0, TB_TOP)])
    for x in (743.4, 812.3):
        line([(x, BY0), (x, 56.0)])
    for x in (779.0, 795.6):
        line([(x, 33.0), (x, 56.0)])
    label(X_RT, TB_TOP, "DRAWING NUMBER")
    value(X_RT + 3.0, 61.0, drawing_number(sheet.number, proj.job), 8.0, 160.0)
    fillbox(805.0, 56.0, BX1, TB_TOP, BLACK)
    label(805.0, TB_TOP, "REV", WHITE)
    v.text((805.0 + BX1) / 2, 66.0, clean(sheet.revision), 8.0, "MIDDLE_CENTER", bold=True, color=WHITE, layer=_L)
    label(X_RT, 56.0, "STATUS")
    value(X_RT + 1.5, 48.3, STAMP, 3.6, 743.4 - X_RT - 4)
    label(743.4, 56.0, "DATE")
    value(744.9, 37.5, fmt_date(proj.date), 4.0, 779.0 - 743.4 - 3)
    label(779.0, 56.0, "DRAWN")
    value(780.5, 37.5, proj.drawn, 4.0, 795.6 - 779.0 - 3)
    label(795.6, 56.0, "CHECKED")
    label(812.3, 56.0, "APPROVED")
    label(X_RT, 33.0, "SCALE")
    value(X_RT + 1.5, 14.5, scale_text, 4.9, 743.4 - X_RT - 4)
    label(743.4, 33.0, "SHEET")
    value(744.9, 14.5, f"{index} OF {total}", 4.9, 812.3 - 743.4 - 4)
    label(812.3, 33.0, "SIZE")
    value(813.8, 14.5, "A1", 4.9, BX1 - 812.3 - 3)

    # ---- datum and accuracy notes panel (directly above the title block, right side) ------------------------------------
    rect, lines = notes_layout(proj, sheet.notes, getattr(sheet, "tag_notes", ()), min_x0=getattr(sheet, "strip_end", 392.0) + 8.0)
    v.fill(Polygon([(rect[0], rect[1]), (rect[2], rect[1]), (rect[2], rect[3]), (rect[0], rect[3])]), _L, WHITE, 1.0, anno=True, edge=BLACK, edge_lw=0.25)
    v.text(rect[0] + 2.0, rect[3] - 1.2, "DATUM AND ACCURACY NOTES", 2.2, "TOP_LEFT", bold=True, layer=_L)
    ai_h = 0.0
    ay1 = rect[3] - 4.3
    for i, t in enumerate(lines):
        if t:
            v.text(rect[0] + 2.0, ay1 - ai_h - 3.0 - 2.6 * i, t, 2.0, "TOP_LEFT", bold=(t == SHEET_NOTES), layer=_L)
    return v
