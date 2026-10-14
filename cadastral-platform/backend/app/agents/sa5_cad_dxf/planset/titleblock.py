"""Common sheet frame and title block (right-hand strip), north arrow, legend, scale bar."""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from app.agents.sa5_cad_dxf.planset import fonts
from app.agents.sa5_cad_dxf.planset.core import A3, LegendEntry, Sheet, View
from app.agents.sa5_cad_dxf.planset.logo import GOLD, logo_in_box

STRIP_X0, STRIP_X1 = 335.0, 410.0
AREA = (10.0, 10.0, 332.0, 287.0)
STAMP = "PRELIMINARY: NOT FOR CONSTRUCTION"
RED = (0.72, 0.1, 0.1)


@dataclass
class Proj:
    title: str
    address: str = ""
    lotplan: str = ""
    council: str = ""
    zone: str = ""
    area: str = ""
    dev_label: str = ""
    drawn: str = "JCE"
    checked: str = ""
    date: str = ""
    brand: object = None
    datum: list[str] = field(default_factory=list)
    revisions: list[tuple[str, str, str, str]] = field(default_factory=list)
    client: str = ""
    job: str = ""                       # job number for the A1 reference-style drawing number; empty shows JCE-XXX-CV-1xxx


def _box(v: View, x0, y0, x1, y1, lw=0.25, layer="C-ANNO-TTLB") -> None:
    v.line([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], layer, True, lw)


def _lbl(v: View, x, y, label: str, value: str, vh=3.0, bold=True, maxw=None) -> None:
    v.text(x, y, label, 1.8, "TOP_LEFT", color=(0.35, 0.35, 0.35), layer="C-ANNO-TTLB")
    if value:
        v.text(x, y - 2.6, value, vh, "TOP_LEFT", bold=bold, layer="C-ANNO-TTLB")


def draw_frame(sheet: Sheet, proj: Proj, index: int, total: int, main_scale_text: str) -> View:
    v = View("titleblock", (0, 0, A3[0], A3[1]))
    v.line([(5, 5), (415, 5), (415, 292), (5, 292)], "C-ANNO-TTLB", True, 0.5)
    v.line([(10, 10), (410, 10), (410, 287), (10, 287)], "C-ANNO-TTLB", True, 0.35)
    v.line([(AREA[0], AREA[1]), (AREA[2], AREA[1]), (AREA[2], AREA[3]), (AREA[0], AREA[3])], "C-ANNO-TTLB", True, 0.25)
    X0, X1 = STRIP_X0, STRIP_X1
    W = X1 - X0
    y = 287.0           # top, working downward

    # ---- brand / logo ------------------------------------------------------------------------------------
    b = proj.brand
    extra = []
    if b is not None:
        for t in (b.address, f"ABN {b.abn}" if b.abn else None, f"T {b.phone}" if b.phone else None, b.email, *(b.registrations or ())):
            if t:
                extra.append(t)
    bh = 24.0 + 3.0 * len(extra)
    _box(v, X0, y - bh, X1, y)
    if b is not None:
        polys, uw, uh = logo_in_box(b.logo_path, X0 + 3, y - 3 - 12, 24, 12)
        from shapely.geometry import MultiPolygon
        for p in polys:
            v.fill(p, "C-ANNO-LOGO", GOLD, 1.0, anno=True)
        tx = X0 + 3 + (uw if uw else 0) + 3
        v.text(tx, y - 4.5, b.company_name.upper(), 2.8, "TOP_LEFT", bold=True, layer="C-ANNO-TTLB")
        for i, ln in enumerate(fonts.wrap(b.trading_line, 2.0, X1 - tx - 2)[:3]):
            v.text(tx, y - 8.5 - i * 2.6, ln, 2.0, "TOP_LEFT", layer="C-ANNO-TTLB", color=(0.25, 0.25, 0.25))
        v.text(X0 + 3, y - 19.5, b.website, 2.4, "TOP_LEFT", layer="C-ANNO-TTLB", color=(0.1, 0.25, 0.55))
        for i, t in enumerate(extra):
            v.text(X0 + 3, y - 24.0 - i * 3.0, t, 2.0, "TOP_LEFT", layer="C-ANNO-TTLB")
    y -= bh

    # ---- north arrow ------------------------------------------------------------------------------------
    if sheet.north is not None:
        nh = 24.0
        _box(v, X0, y - nh, X1, y)
        cx, cy, r = X0 + 14, y - nh / 2 - 1.5, 6.5
        a = math.radians(sheet.north)
        ux, uy = math.sin(a), math.cos(a)
        nx, ny = uy, -ux
        for i in range(48):
            t0, t1 = 2 * math.pi * i / 48, 2 * math.pi * (i + 1) / 48
            v.line([(cx + r * math.cos(t0), cy + r * math.sin(t0)), (cx + r * math.cos(t1), cy + r * math.sin(t1))], "C-ANNO-NRTH", False, 0.18)
        tip = (cx + ux * (r + 2.5), cy + uy * (r + 2.5))
        left = (cx - ux * r * .6 + nx * r * .38, cy - uy * r * .6 + ny * r * .38)
        right = (cx - ux * r * .6 - nx * r * .38, cy - uy * r * .6 - ny * r * .38)
        mid = (cx - ux * r * .25, cy - uy * r * .25)
        from shapely.geometry import Polygon
        v.fill(Polygon([tip, left, mid]), "C-ANNO-NRTH", (0, 0, 0), 1.0, anno=True)
        v.line([tip, right, mid], "C-ANNO-NRTH", True, 0.25)
        v.text(tip[0] + ux * 2.4, tip[1] + uy * 2.4 + 0.3, "N", 3.0, "MIDDLE_CENTER", bold=True, layer="C-ANNO-NRTH")
        v.text(X0 + 28, cy + 4, "GRID NORTH", 2.2, "TOP_LEFT", bold=True, layer="C-ANNO-NRTH")
        v.text(X0 + 28, cy + 0.6, "(MGA2020)", 2.0, "TOP_LEFT", layer="C-ANNO-NRTH")
        v.text(X0 + 28, cy - 3.4, "SCALE " + main_scale_text, 2.2, "TOP_LEFT", bold=True, layer="C-ANNO-NRTH")
        y -= nh

    # ---- bottom-up fixed blocks --------------------------------------------------------------------------
    yb = 10.0
    # drawing number / revision / sheet
    h = 14.0
    _box(v, X0, yb, X1, yb + h)
    v.line([(X0 + 36, yb), (X0 + 36, yb + h)], "C-ANNO-TTLB", False, 0.25)
    v.line([(X0 + 60, yb), (X0 + 60, yb + h)], "C-ANNO-TTLB", False, 0.25)
    v.text(X0 + 2, yb + h - 1.4, "DRAWING No.", 1.8, "TOP_LEFT", color=(0.35, 0.35, 0.35), layer="C-ANNO-TTLB")
    v.text(X0 + 2, yb + 2.0, sheet.number, 6.5, "BOTTOM_LEFT", bold=True, layer="C-ANNO-TTLB")
    v.text(X0 + 62, yb + h - 1.4, "REV", 1.8, "TOP_LEFT", color=(0.35, 0.35, 0.35), layer="C-ANNO-TTLB")
    v.text(X0 + 62, yb + 2.0, sheet.revision, 6.5, "BOTTOM_LEFT", bold=True, layer="C-ANNO-TTLB")
    v.text(X0 + 38, yb + h - 1.4, "SHEET", 1.8, "TOP_LEFT", color=(0.35, 0.35, 0.35), layer="C-ANNO-TTLB")
    v.text(X0 + 38, yb + 2.0, f"{index} of {total}", 3.8, "BOTTOM_LEFT", bold=True, layer="C-ANNO-TTLB")
    yb += h
    # status stamp
    h = 10.0
    v.line([(X0, yb), (X1, yb), (X1, yb + h), (X0, yb + h)], "C-ANNO-STMP", True, 0.5, color=RED)
    v.text((X0 + X1) / 2, yb + h / 2, STAMP, 2.7, "MIDDLE_CENTER", bold=True, color=RED, layer="C-ANNO-STMP")
    yb += h
    # scale / date / drawn / checked
    h = 22.0
    _box(v, X0, yb, X1, yb + h)
    mid = X0 + W / 2
    for k in (1, 2):
        v.line([(X0, yb + k * h / 3), (X1, yb + k * h / 3)], "C-ANNO-TTLB", False, 0.18)
    v.line([(mid, yb), (mid, yb + h)], "C-ANNO-TTLB", False, 0.18)
    rows = [("SCALE (A3)", main_scale_text, "DATE", proj.date), ("DRAWN", proj.drawn, "CHECKED", proj.checked), ("SHEET SIZE", "A3 LANDSCAPE", "JOB No.", "")]
    for i, (l1, v1, l2, v2) in enumerate(rows):
        top = yb + h - i * h / 3
        _lbl(v, X0 + 1.5, top - 0.8, l1, v1, 2.8)
        _lbl(v, mid + 1.5, top - 0.8, l2, v2, 2.8)
    yb += h
    # sheet title
    h = 20.0
    _box(v, X0, yb, X1, yb + h)
    v.text(X0 + 2, yb + h - 1.2, "SHEET TITLE", 1.8, "TOP_LEFT", color=(0.35, 0.35, 0.35), layer="C-ANNO-TTLB")
    ls = fonts.wrap(sheet.title.upper(), 4.2, W - 4, True)[:2]
    for i, ln in enumerate(ls):
        v.text(X0 + 2, yb + h - 4.2 - i * 5.2, ln, 4.2, "TOP_LEFT", bold=True, layer="C-ANNO-TTLB")
    if sheet.subtitle:
        v.text(X0 + 2, yb + 1.6, fonts.wrap(sheet.subtitle, 2.2, W - 4)[0], 2.2, "BOTTOM_LEFT", layer="C-ANNO-TTLB", color=(0.2, 0.2, 0.2))
    yb += h
    # project box
    h = 44.0
    _box(v, X0, yb, X1, yb + h)
    yy = yb + h - 1.0
    v.text(X0 + 2, yy, "PROJECT", 1.8, "TOP_LEFT", color=(0.35, 0.35, 0.35), layer="C-ANNO-TTLB")
    yy -= 2.6
    for ln in fonts.wrap(proj.title, 3.2, W - 4, True)[:2]:
        v.text(X0 + 2, yy, ln, 3.2, "TOP_LEFT", bold=True, layer="C-ANNO-TTLB")
        yy -= 3.9
    yy -= 1.2
    rows = [("SITE", proj.address), ("LOT / PLAN", proj.lotplan), ("COUNCIL", proj.council), ("ZONE / AREA", f"{proj.zone}  {proj.area}".strip()),
            ("DEVELOPMENT", proj.dev_label)]
    for l, t in rows:
        if not t:
            continue
        if yy < yb + 3:
            break
        v.text(X0 + 2, yy, l, 1.8, "TOP_LEFT", color=(0.35, 0.35, 0.35), layer="C-ANNO-TTLB")
        for ln in fonts.wrap(t, 2.6, W - 24)[:2]:
            v.text(X0 + 22, yy, ln, 2.6, "TOP_LEFT", layer="C-ANNO-TTLB")
            yy -= 3.1
        yy -= 0.9
    yb += h
    # datum notes
    h = 22.0
    _box(v, X0, yb, X1, yb + h)
    v.text(X0 + 2, yb + h - 1.0, "DATUM AND ACCURACY NOTES", 1.8, "TOP_LEFT", color=(0.35, 0.35, 0.35), layer="C-ANNO-TTLB")
    yy = yb + h - 3.6
    for t in proj.datum:
        for ln in fonts.wrap(t, 2.0, W - 4):
            if yy > yb + 0.8:
                v.text(X0 + 2, yy, ln, 2.0, "TOP_LEFT", layer="C-ANNO-TTLB")
            yy -= 2.5
    yb += h
    # revision table
    h = 18.0
    _box(v, X0, yb, X1, yb + h)
    cols = [X0, X0 + 9, X0 + 53, X0 + 67, X1]
    for c in cols[1:-1]:
        v.line([(c, yb), (c, yb + h)], "C-ANNO-TABL", False, 0.13)
    rh = h / 4
    for r in (1, 2, 3):
        v.line([(X0, yb + r * rh), (X1, yb + r * rh)], "C-ANNO-TABL", False, 0.13)
    for i, t in enumerate(("REV", "DESCRIPTION", "DATE", "BY")):
        v.text(cols[i] + 1.2, yb + h - rh / 2, t, 1.8, "MIDDLE_LEFT", bold=True, layer="C-ANNO-TABL")
    for r, row in enumerate(proj.revisions[:3]):
        for i, t in enumerate(row):
            v.text(cols[i] + 1.2, yb + h - rh * (r + 1.5), t, 2.0, "MIDDLE_LEFT", layer="C-ANNO-TABL")
    yb += h

    # ---- legend (remaining space) -------------------------------------------------------------------------
    _box(v, X0, yb, X1, y)
    v.text(X0 + 2, y - 1.0, "LEGEND", 2.6, "TOP_LEFT", bold=True, layer="C-ANNO-TTLB")
    yy = y - 6.5
    for e in sheet.legend:
        if yy < yb + 2:
            break
        _legend_row(v, e, X0 + 2, yy)
        yy -= 4.0
    return v


def _legend_row(v: View, e: LegendEntry, x: float, y: float) -> None:
    from shapely.geometry import Polygon
    if e.kind == "line":
        v.line([(x, y), (x + 9, y)], e.layer if e.layer != "C-ANNO-NOTE" else "C-ANNO-TTLB", False, e.lw, e.dash, e.color)
    elif e.kind == "fill":
        poly = Polygon([(x, y - 1.3), (x + 9, y - 1.3), (x + 9, y + 1.3), (x, y + 1.3)])
        v.fill(poly, e.layer, e.fill or (0.8, 0.8, 0.8), 0.6, e.hatch, anno=True)
        v.line([(x, y - 1.3), (x + 9, y - 1.3), (x + 9, y + 1.3), (x, y + 1.3)], e.layer, True, 0.18, color=e.color)
    elif e.kind == "point":
        v.line([(x + 3.5, y - 1.2), (x + 5.5, y + 1.2)], e.layer, False, 0.25, color=e.color)
        v.line([(x + 3.5, y + 1.2), (x + 5.5, y - 1.2)], e.layer, False, 0.25, color=e.color)
    v.text(x + 11, y, e.label, 2.0, "MIDDLE_LEFT", layer="C-ANNO-TTLB")


def scale_bar(v: View, x: float, y: float, scale: int, label: str | None = None) -> float:
    """Scale bar at paper position (x, y) = left end, bar above y.  Returns the bar length in mm."""
    T = (lambda a, b: v.tm(a, b)) if not v.paper else (lambda a, b: (a, b))  # noqa: E731
    target = 55.0
    best = 1.0
    for n in (1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000):
        if n * 1000.0 / scale <= target:
            best = n
    seg = best / 4.0
    L = best * 1000.0 / scale
    from shapely.geometry import Polygon
    # white backing so the bar stays legible over aerial imagery
    bk = [(x - 2, y - 4.5), (x + L + 12, y - 4.5), (x + L + 12, y + 5.5), (x - 2, y + 5.5)]
    v.fill(Polygon([T(*p) for p in bk]), "C-ANNO-NRTH", (1, 1, 1), 0.8, anno=True)
    for i in range(4):
        x0 = x + i * L / 4
        quad = [T(x0, y), T(x0 + L / 4, y), T(x0 + L / 4, y + 1.6), T(x0, y + 1.6)]
        if i % 2 == 0:
            v.fill(Polygon(quad), "C-ANNO-NRTH", (0, 0, 0), 1.0, anno=True)
        v.line(quad, "C-ANNO-NRTH", True, 0.18, anno=True)
    for i in range(5):
        val = seg * i
        if i < 4:
            v.text(*T(x + i * L / 4, y + 2.1), f"{val:g}", 1.8, "BOTTOM_CENTER", layer="C-ANNO-NRTH")
        else:
            v.text(*T(x + L + 0.5, y + 0.2), f"{val:g} m", 1.8, "BOTTOM_LEFT", layer="C-ANNO-NRTH")
    v.text(*T(x, y - 0.8), label or f"SCALE 1:{scale} (A3)", 2.0, "TOP_LEFT", bold=True, layer="C-ANNO-NRTH")
    return L
