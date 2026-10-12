"""A3 landscape ESCP sheet (reportlab, vector). Styling follows sa5_cad_dxf/sheet.py (frame, title block, north arrow, scale bar)."""
from __future__ import annotations

import math
from datetime import date
from pathlib import Path

from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas
from shapely import wkt as swkt
from shapely.geometry import LineString, Point

from app.agents.sa5_cad_dxf.sheet import FRAME, SHEET_H, SHEET_W, STANDARD_SCALES
from app.agents.sa5_cad_dxf.annotate import format_lotplan

from .layout import Layout, lines_of, polys_of
from .models import DISCLAIMER, EscElement, Sa10EscInput
from app.branding.brand import Brand
from .logo import logo_png
from .notes import general_notes, maintenance_rows
from .reqs import ReqView

VIEW = (12.0, 12.0, 268.0, 285.0)
COL1, COL2, COL3 = 270.0, 336.0, 410.0           # panel columns x0, x1(=col2 start), right edge
COLOUR = {"fence": (0.80, 0.08, 0.08), "return": (0.80, 0.08, 0.08), "access": (0.50, 0.30, 0.05), "stockpile": (0.90, 0.45, 0.0),
          "topsoil": (0.55, 0.40, 0.10), "laydown": (0.45, 0.45, 0.45), "washout": (0.0, 0.50, 0.55), "bin": (0.30, 0.30, 0.30),
          "toilet": (0.30, 0.30, 0.30), "inlet": (0.70, 0.10, 0.60), "diversion": (0.10, 0.30, 0.85), "berm": (0.10, 0.30, 0.85),
          "check_dam": (0.10, 0.20, 0.65), "limit": (0.10, 0.55, 0.20), "nogo": (0.10, 0.55, 0.20)}
CODE = {"access": "SA", "stockpile": "SP", "topsoil": "TS", "laydown": "LD", "washout": "CW", "bin": "BIN", "toilet": "WC",
        "inlet": "IP", "diversion": "DD", "check_dam": "CD", "nogo": "NG", "fence": "SF", "berm": "DB"}
LEGEND = [("fence", "Sediment fence (SF) with returns"), ("access", "Stabilised site access (SA)"), ("stockpile", "Soil stockpile (SP)"),
          ("topsoil", "Topsoil stockpile (TS)"), ("laydown", "Materials laydown (LD)"), ("washout", "Concrete washout / wash-down, bunded (CW)"),
          ("bin", "Waste bin (BIN) / portable toilet (WC)"), ("inlet", "Kerb inlet / gutter sediment trap (IP)"),
          ("diversion", "Clean-water diversion drain / bund (DD), arrow = flow"), ("berm", "Diversion berm across access (DB)"),
          ("check_dam", "Check dam (CD)"), ("limit", "Limit of works"), ("nogo", "No-go / tree protection (NG)")]
FS = 5.0          # panel font size (pt)


def _wrap(text: str, font: str, size: float, width_mm: float) -> list[str]:
    out, cur = [], ""
    for w in text.split():
        t = f"{cur} {w}".strip()
        if cur and stringWidth(t, font, size) / mm > width_mm:
            out.append(cur)
            cur = w
        else:
            cur = t
    if cur:
        out.append(cur)
    return out


class Sheet:
    def __init__(self, c: canvas.Canvas):
        self.c = c

    # --- primitives in paper mm
    def stroke(self, rgb, lw=0.25, dash=None):
        self.c.setStrokeColorRGB(*rgb)
        self.c.setLineWidth(lw * mm)
        self.c.setDash(*(([d * mm for d in dash], 0) if dash else ([], 0)))

    def line(self, pts, close=False, fill=None):
        p = self.c.beginPath()
        p.moveTo(pts[0][0] * mm, pts[0][1] * mm)
        for x, y in pts[1:]:
            p.lineTo(x * mm, y * mm)
        if close:
            p.close()
        if fill is not None:
            self.c.setFillColorRGB(*fill)
        self.c.drawPath(p, stroke=1, fill=0 if fill is None else 1)

    def text(self, x, y, s, size=FS, bold=False, anchor="l", rgb=(0, 0, 0), halo=False, rot=0.0):
        c = self.c
        f = "Helvetica-Bold" if bold else "Helvetica"
        w = stringWidth(s, f, size)
        dx = {"l": 0, "c": -w / 2, "r": -w}[anchor]
        c.saveState()
        c.translate(x * mm, y * mm)
        c.rotate(rot)
        if halo:
            t = c.beginText(dx, -size * 0.35)
            t.setFont(f, size)
            t.setTextRenderMode(1)
            c.setStrokeColorRGB(1, 1, 1)
            c.setLineWidth(0.6)
            c.setLineJoin(1)
            t.textOut(s)
            c.drawText(t)
        c.setFillColorRGB(*rgb)
        t = c.beginText(dx, -size * 0.35)
        t.setFont(f, size)
        if halo:
            t.setTextRenderMode(2)
            c.setStrokeColorRGB(*rgb)
            c.setLineWidth(0.03)
        t.textOut(s)
        c.drawText(t)
        c.restoreState()


def _hatch(sh: Sheet, ptsmm, rgb, spacing=1.4, cross=False):
    """Diagonal hatch of a convex-ish polygon given in paper mm (clipped to the polygon)."""
    c = sh.c
    c.saveState()
    p = c.beginPath()
    p.moveTo(ptsmm[0][0] * mm, ptsmm[0][1] * mm)
    for x, y in ptsmm[1:]:
        p.lineTo(x * mm, y * mm)
    p.close()
    c.clipPath(p, stroke=0, fill=0)
    xs, ys = [q[0] for q in ptsmm], [q[1] for q in ptsmm]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    sh.stroke(rgb, 0.12)
    k = x0 - (y1 - y0)
    while k < x1:
        sh.line([(k, y0), (k + (y1 - y0), y1)])
        if cross:
            sh.line([(k + (y1 - y0), y0), (k, y1)])
        k += spacing
    c.restoreState()


def draw_symbol(sh: Sheet, kind: str, geom, tx, label: str | None = None, big: float = 1.0):
    """Draw one ESC element. ``geom`` shapely (model metres); ``tx`` maps (x, y) -> paper mm."""
    rgb = COLOUR[kind]
    if kind in ("fence", "return"):
        sh.stroke(rgb, 0.55 if kind == "fence" else 0.4)
        for ln in lines_of(geom):
            pts = [tx(*p) for p in ln.coords]
            sh.line(pts)
            if kind == "fence":                      # standard "-x-x-" fence tick
                total = LineString(pts).length
                s = 1.5
                while s < total:
                    a, b = LineString(pts).interpolate(s), LineString(pts).interpolate(min(total, s + 0.1))
                    tt = (b.x - a.x, b.y - a.y)
                    nn = math.hypot(*tt) or 1
                    tt = (tt[0] / nn, tt[1] / nn)
                    nx, ny = -tt[1], tt[0]
                    h = 0.9
                    sh.line([(a.x - tt[0] * h + nx * h, a.y - tt[1] * h + ny * h), (a.x + tt[0] * h - nx * h, a.y + tt[1] * h - ny * h)])
                    sh.line([(a.x - tt[0] * h - nx * h, a.y - tt[1] * h - ny * h), (a.x + tt[0] * h + nx * h, a.y + tt[1] * h + ny * h)])
                    s += 4.0
    elif kind in ("access", "stockpile", "topsoil", "laydown", "washout", "bin", "toilet", "inlet"):
        for pg in polys_of(geom):
            pts = [tx(*p) for p in pg.exterior.coords][:-1]
            if kind in ("bin", "toilet"):
                sh.stroke(rgb, 0.3)
                sh.line(pts, close=True, fill=(0.85, 0.85, 0.85))
            elif kind == "inlet":
                sh.stroke(rgb, 0.3)
                sh.line(pts, close=True, fill=(0.95, 0.75, 0.9))
            else:
                _hatch(sh, pts, rgb, 1.2 if kind != "washout" else 1.6, cross=kind in ("washout", "stockpile"))
                sh.stroke(rgb, 0.45, dash=[1.5, 0.8] if kind in ("washout",) else None)
                sh.line(pts, close=True)
    elif kind in ("diversion", "berm"):
        sh.stroke(rgb, 0.4, dash=[2.0, 1.0] if kind == "diversion" else None)
        for ln in lines_of(geom):
            pts = [tx(*p) for p in ln.coords]
            sh.line(pts)
            if kind == "diversion" and len(pts) >= 2:
                L = LineString(pts)
                for f in (0.35, 0.75):
                    if L.length < 8:
                        f = 0.55
                    a, b = L.interpolate(f, normalized=True), L.interpolate(min(1.0, f + 0.04), normalized=True)
                    tt = (b.x - a.x, b.y - a.y)
                    n_ = math.hypot(*tt) or 1
                    tt = (tt[0] / n_, tt[1] / n_)
                    nx, ny = -tt[1], tt[0]
                    sh.stroke(rgb, 0.4)
                    sh.line([(b.x - tt[0] * 2.2 + nx * 0.9, b.y - tt[1] * 2.2 + ny * 0.9), (b.x, b.y), (b.x - tt[0] * 2.2 - nx * 0.9, b.y - tt[1] * 2.2 - ny * 0.9)])
                    if L.length < 8:
                        break
            if kind == "berm":
                L = LineString(pts)
                k = 0.0
                while k < L.length:                    # half-round bumps
                    a = L.interpolate(k)
                    sh.c.circle(a.x * mm, a.y * mm, 0.5 * mm, stroke=1, fill=0)
                    k += 1.6
    elif kind == "check_dam":
        sh.stroke(rgb, 0.9)
        for ln in lines_of(geom):
            sh.line([tx(*p) for p in ln.coords])
    elif kind == "limit":
        sh.stroke(rgb, 0.4, dash=[3.0, 1.0, 0.6, 1.0])
        for ln in lines_of(geom):
            sh.line([tx(*p) for p in ln.coords])
    elif kind == "nogo":
        sh.stroke(rgb, 0.4, dash=[1.2, 0.8])
        for pg in polys_of(geom):
            c = pg.centroid
            r = (pg.area / math.pi) ** 0.5
            cx, cy = tx(c.x, c.y)
            sh.c.circle(cx * mm, cy * mm, r * (tx(1, 0)[0] - tx(0, 0)[0]) * mm, stroke=1, fill=0)
            sh.stroke(rgb, 0.4)
            sh.line([(cx - 1.2, cy - 1.2), (cx + 1.2, cy + 1.2)])
            sh.line([(cx - 1.2, cy + 1.2), (cx + 1.2, cy - 1.2)])


def legend_swatch(sh: Sheet, kind: str, x: float, y: float):
    """Small vector swatch (paper mm, 12 x 3.4) using the same drawing code on a local frame."""
    from shapely.geometry import box
    tx = lambda px, py: (x + px, y + py)           # noqa: E731
    h = 1.6
    if kind in ("fence", "return", "diversion", "berm", "limit"):
        draw_symbol(sh, kind, LineString([(0.5, 0), (11.5, 0)]), tx)
    elif kind == "check_dam":
        draw_symbol(sh, kind, LineString([(6, -1.4), (6, 1.4)]), tx)
        draw_symbol(sh, "diversion", LineString([(0.5, 0), (11.5, 0)]), tx)
    elif kind == "nogo":
        r = 1.5
        draw_symbol(sh, kind, Point(6, 0).buffer(r, 16), tx)
    else:
        draw_symbol(sh, kind, box(1.5, -h, 10.5, h), tx)


def _pick_scale(w_m: float, h_m: float, requested: int | None) -> int:
    aw, ah = VIEW[2] - VIEW[0], VIEW[3] - VIEW[1]
    ok = lambda n: (w_m * 1000 / n + 8 <= aw) and (h_m * 1000 / n + 8 <= ah)  # noqa: E731
    if requested and ok(requested):
        return requested
    return next((s for s in STANDARD_SCALES if s >= (requested or 0) and ok(s)), STANDARD_SCALES[-1])


def render_pdf(inp: Sa10EscInput, L: Layout, rq: ReqView, out: dict, path: str | Path) -> dict:
    lot, fp = L.lot, L.footprint
    geoms = [lot] + [swkt.loads(e.geometry_wkt) for e in L.elements]
    from shapely.ops import unary_union
    bx0, by0, bx1, by1 = unary_union(geoms).bounds
    scale = _pick_scale(bx1 - bx0, by1 - by0, inp.scale_denominator)
    k = 1000.0 / scale
    vcx, vcy = (VIEW[0] + VIEW[2]) / 2, (VIEW[1] + VIEW[3]) / 2
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
    tx = lambda x, y: (vcx + (x - cx) * k, vcy + (y - cy) * k)   # noqa: E731

    c = canvas.Canvas(str(path), pagesize=(SHEET_W * mm, SHEET_H * mm), invariant=1)
    c.setTitle(f"{inp.project_title} - ESCP")
    c.setAuthor(inp.drawn_by)
    c.setSubject(DISCLAIMER)
    c.setCreator("Cadastral platform SA10 (ESC)")
    sh = Sheet(c)

    # ---- plan viewport (clipped)
    c.saveState()
    clip = c.beginPath()
    clip.rect(VIEW[0] * mm, VIEW[1] * mm, (VIEW[2] - VIEW[0]) * mm, (VIEW[3] - VIEW[1]) * mm)
    c.clipPath(clip, stroke=0, fill=0)
    ext, img = inp.basemap_extent, inp.basemap_image_path
    if img and ext and Path(img).exists():
        c.saveState()
        c.setFillAlpha(0.5)
        x0, y0 = tx(ext[0], ext[1])
        x1, y1 = tx(ext[2], ext[3])
        c.drawImage(str(img), x0 * mm, y0 * mm, (x1 - x0) * mm, (y1 - y0) * mm, mask=None)
        c.restoreState()
    # lot, building, driveway
    sh.stroke((0, 0.5, 0.1), 0.6)
    for pg in polys_of(lot):
        sh.line([tx(*p) for p in pg.exterior.coords][:-1], close=True)
    if inp.footprint_wkt or inp.lot.envelope_wkt:
        sh.stroke((0.1, 0.2, 0.7), 0.5)
        for pg in polys_of(fp):
            sh.line([tx(*p) for p in pg.exterior.coords][:-1], close=True, fill=(0.88, 0.9, 1.0) if not (img and ext) else None)
        mx, my = tx(fp.centroid.x, fp.centroid.y)
        sh.text(mx, my, "PROPOSED BUILDING" if inp.footprint_wkt else "BUILDING ENVELOPE (footprint not supplied)", 5.0, True, "c", (0.1, 0.2, 0.7), halo=True)
    if L.crossover is not None:
        sh.stroke((0.35, 0.35, 0.35), 0.35)
        for pg in polys_of(L.crossover):
            sh.line([tx(*p) for p in pg.exterior.coords][:-1], close=True)
    if inp.driveway and inp.driveway.centreline_wkt:
        sh.stroke((0.35, 0.35, 0.35), 0.25, dash=[3, 1, 0.6, 1])
        for ln in lines_of(swkt.loads(inp.driveway.centreline_wkt)):
            sh.line([tx(*p) for p in ln.coords])
    for s in inp.services:
        sh.stroke((0.5, 0.5, 0.5), 0.2, dash=[1, 1])
        if s.exclusion_wkt:
            for pg in polys_of(swkt.loads(s.exclusion_wkt)):
                sh.line([tx(*p) for p in pg.exterior.coords][:-1], close=True)
    # ESC elements (limit first, fence last so it reads on top)
    order = ["limit", "nogo", "access", "stockpile", "topsoil", "laydown", "washout", "bin", "toilet", "diversion", "berm", "check_dam", "inlet", "return", "fence"]
    for kind in order:
        for e in (x for x in L.elements if x.kind == kind):
            g = swkt.loads(e.geometry_wkt)
            draw_symbol(sh, kind, g, tx)
            if kind in ("limit", "return"):
                continue
            code = CODE.get(kind, "")
            tag = f"{e.id}" if kind in ("stockpile", "topsoil", "laydown", "washout", "bin", "toilet", "access", "inlet", "nogo", "berm", "check_dam") else None
            if kind == "fence":
                ln = max(lines_of(g), key=lambda l: l.length)
                p = ln.interpolate(0.5, normalized=True)
                px, py = tx(p.x, p.y)
                sh.text(px, py, f"SF  {e.quantity:.1f} m", 5.0, True, "c", COLOUR[kind], halo=True)
            elif kind == "diversion":
                ln = max(lines_of(g), key=lambda l: l.length)
                p = ln.interpolate(0.5, normalized=True)
                px, py = tx(p.x, p.y)
                sh.text(px, py + 2.2, f"DD  {e.quantity:.1f} m", 5.0, True, "c", COLOUR[kind], halo=True)
            elif tag:
                cen = g.centroid
                px, py = tx(cen.x, cen.y)
                sh.text(px, py + (2.4 if kind in ("inlet", "check_dam", "berm", "nogo") else 0), tag, 4.6, True, "c", COLOUR[kind], halo=True)
    # flow arrow
    fcx, fcy = tx(lot.centroid.x, lot.centroid.y)
    dx, dy = L.flow.direction
    a0 = (fcx - dx * 14, fcy - dy * 14 - 12 * 0)
    a1 = (fcx + dx * 14, fcy + dy * 14)
    sh.stroke((0.1, 0.3, 0.85), 0.9)
    sh.line([a0, a1])
    nx, ny = -dy, dx
    sh.line([(a1[0] - dx * 3 + nx * 1.6, a1[1] - dy * 3 + ny * 1.6), a1, (a1[0] - dx * 3 - nx * 1.6, a1[1] - dy * 3 - ny * 1.6)])
    ang = math.degrees(math.atan2(dy, dx))
    rot = ang if -90 <= ang <= 90 else ang + 180
    lab = f"FLOW {L.flow.slope_pct:.1f}%" if L.flow.slope_pct is not None and not L.flow.assumed else "FLOW (ASSUMED, NO LEVELS)"
    mxx, myy = (a0[0] + a1[0]) / 2 - dy * 2.5, (a0[1] + a1[1]) / 2 + dx * 2.5
    sh.text(mxx, myy, lab, 4.6, True, "c", (0.1, 0.3, 0.85), halo=True, rot=rot)
    # lot label
    sh.text(*tx(lot.centroid.x, lot.centroid.y + (by1 - by0) * 0.40), f"{format_lotplan(inp.lot.lotplan)}   {inp.lot.area_m2_calculated:.0f} m2", 5.5, True, "c", (0, 0.4, 0.1), halo=True)
    c.restoreState()
    if img and ext:
        note = "Aerial underlay at 50% fade" + (f": {inp.basemap_note}" if inp.basemap_note else "")
        sh.stroke((1, 1, 1), 0.1)
        c.setFillColorRGB(1, 1, 1)
        c.rect(VIEW[0] * mm, VIEW[1] * mm, stringWidth(note, "Helvetica", 4.6) + 4 * mm, 3.6 * mm, stroke=0, fill=1)
        sh.text(VIEW[0] + 1.5, VIEW[1] + 1.8, note, 4.6, rgb=(0.2, 0.2, 0.2))

    # ---- frame
    sh.stroke((0, 0, 0), 0.5)
    sh.line([(FRAME[0], FRAME[1]), (FRAME[2], FRAME[1]), (FRAME[2], FRAME[3]), (FRAME[0], FRAME[3])], close=True)
    sh.stroke((0, 0, 0), 0.25)
    sh.line([(VIEW[0], VIEW[1]), (VIEW[2], VIEW[1]), (VIEW[2], VIEW[3]), (VIEW[0], VIEW[3])], close=True)
    sh.line([(COL1, FRAME[1]), (COL1, FRAME[3])])
    sh.line([(COL2, FRAME[1]), (COL2, FRAME[3] - 0.0)])

    # ---- column 1: title block, north arrow, scale bar, legend, quantities
    tw1 = COL2 - COL1 - 5
    x = COL1 + 2.5
    y = FRAME[3] - 5
    brand = Brand.from_env()
    try:
        from reportlab.lib.utils import ImageReader
        import io as _io
        png, asp = logo_png(brand)
        lw_mm = min(tw1 * 0.55, 34.0)
        c.drawImage(ImageReader(_io.BytesIO(png)), x * mm, (y - lw_mm / asp + 3) * mm, lw_mm * mm, lw_mm / asp * mm, mask="auto")
        sh.text(x + lw_mm + 2, y - 1.0, brand.company_name, 5.6, True)
        for i, ln in enumerate(_wrap(brand.trading_line, "Helvetica", 4.0, tw1 - lw_mm - 2)):
            sh.text(x + lw_mm + 2, y - 4.6 - i * 2.0, ln, 4.0, rgb=(0.35, 0.35, 0.35))
        y -= lw_mm / asp + 3
    except Exception:  # noqa: BLE001 - logo is decorative; the company name still prints
        sh.text(x, y, brand.company_name, 6.0, True)
        y -= 5
    sh.stroke((0, 0, 0), 0.13)
    sh.line([(COL1, y + 1.5), (COL2, y + 1.5)])
    y -= 3
    sh.text(x, y, "EROSION AND SEDIMENT CONTROL PLAN", 6.4, True)
    y -= 4.2
    sh.text(x, y, "(PROPOSED - INDICATIVE)", 5.0, True, rgb=(0.7, 0.1, 0.1))
    y -= 5
    for ln in _wrap(inp.project_title, "Helvetica-Bold", 7.0, tw1):
        sh.text(x, y, ln, 7.0, True)
        y -= 3.4
    zone = {7854: "54", 7855: "55", 7856: "56"}[inp.lot.mga_srid]
    rows = [("LOT / PLAN", format_lotplan(inp.lot.lotplan)), ("DEVELOPMENT", inp.development_type.label), ("COUNCIL", inp.lot.lga_name),
            ("SCALE", f"1:{scale} @ A3"), ("DATE", inp.issue_date or date.today().isoformat()), ("DRAWN BY", inp.drawn_by),
            ("DATUM / GRID", f"GDA2020 MGA zone {zone} (EPSG:{inp.lot.mga_srid})"), ("SITE AREA", f"{inp.lot.area_m2_calculated:.0f} sq m (calculated)"),
            ("EST. DISTURBED AREA", f"{L.quantities['disturbed_area_estimate_m2']:.0f} sq m")]
    sh.stroke((0, 0, 0), 0.13)
    for lab, val in rows:
        sh.line([(COL1, y + 0.8), (COL2, y + 0.8)])
        sh.text(x, y - 1.6, lab, 3.6, rgb=(0.45, 0.45, 0.45))
        for i, ln in enumerate(_wrap(val, "Helvetica", 5.2, tw1)):
            sh.text(x, y - 4.6 - i * 2.4, ln, 5.2)
        y -= 7.6
    sh.line([(COL1, y + 0.8), (COL2, y + 0.8)])
    # north arrow (grid north = up) + scale bar
    nx0, ny0 = COL1 + 11, y - 12
    sh.stroke((0, 0, 0), 0.3)
    c.circle(nx0 * mm, ny0 * mm, 6 * mm, stroke=1, fill=0)
    c.setFillColorRGB(0, 0, 0)
    sh.line([(nx0, ny0 + 6), (nx0 - 2.2, ny0 - 4.5), (nx0, ny0 - 2.5), (nx0 + 2.2, ny0 - 4.5)], close=True, fill=(0, 0, 0))
    sh.text(nx0, ny0 + 7.5, "N", 6, True, "c")
    total_m = next((m for m in (200, 100, 50, 25, 20, 10, 5, 2, 1) if m * k <= 38.0), 1)
    sbx, sby = COL1 + 24, ny0 - 3
    nseg = 4 if total_m in (10, 20, 50, 100, 200, 25) else 2
    for i in range(nseg):
        x0 = sbx + i * total_m / nseg * k
        sh.stroke((0, 0, 0), 0.25)
        sh.line([(x0, sby), (x0 + total_m / nseg * k, sby), (x0 + total_m / nseg * k, sby + 1.8), (x0, sby + 1.8)], close=True, fill=(0, 0, 0) if i % 2 == 0 else (1, 1, 1))
        sh.text(x0, sby + 2.6, f"{i * total_m / nseg:g}", 3.8, anchor="c")
    sh.text(sbx + total_m * k, sby + 2.6, f"{total_m:g} m", 3.8, anchor="c")
    sh.text(sbx, sby - 3.2, f"SCALE 1:{scale} (A3)", 4.2)
    y = ny0 - 10
    sh.stroke((0, 0, 0), 0.13)
    sh.line([(COL1, y), (COL2, y)])
    y -= 4
    sh.text(x, y, "LEGEND", 6.0, True)
    y -= 3.4
    sh.text(x, y, "Base: lot boundary (green), proposed building (blue)", 4.2, rgb=(0.3, 0.3, 0.3))
    y -= 3.8
    for kind, lab in LEGEND:
        legend_swatch(sh, kind, x, y)
        for i, ln in enumerate(_wrap(lab, "Helvetica", 4.6, tw1 - 14)):
            sh.text(x + 13.5, y - i * 2.3, ln, 4.6)
        y -= 4.2 + (2.3 if len(lab) > 40 else 0)
    sh.stroke((0, 0, 0), 0.13)
    sh.line([(COL1, y), (COL2, y)])
    y -= 4
    sh.text(x, y, "QUANTITIES (indicative)", 6.0, True)
    y -= 3.6
    q = L.quantities
    qrows = [f"Sediment fence: {q['fence_length_m']} m (+ returns {q['fence_returns_m']} m)" + (f", {q['fence_posts']} posts" if q.get("fence_posts") else ""),
             f"Stabilised access: {q['access_length_m']} x {q['access_width_m']} m = {q['access_area_m2']} m2"
             + (f", aggregate {q['access_aggregate_m3']} m3" if q.get("access_aggregate_m3") else ""),
             f"Stockpile / laydown area: {q['stockpile_area_m2']} m2", f"Diversion drain: {q['diversion_length_m']} m",
             f"Check dams: {q['check_dams']}  Inlet traps: {q['inlet_traps']}",
             f"Disturbed area est.: {q['disturbed_area_estimate_m2']} m2 of {q['site_area_m2']} m2 site"]
    if q.get("topsoil_strip_m3"):
        qrows.append(f"Topsoil strip: {q['topsoil_strip_m3'][0]}-{q['topsoil_strip_m3'][1]} m3 (100-150 mm, cited)")
    for r in qrows:
        for ln in _wrap(r, "Helvetica", 4.6, tw1):
            sh.text(x, y, ln, 4.6)
            y -= 2.4
    y -= 1.5
    sh.line([(COL1, y), (COL2, y)])
    y -= 4
    sh.text(x, y, "UNCONFIRMED (designer / certifier)", 6.0, True, rgb=(0.7, 0.1, 0.1))
    y -= 3.4
    unres_msgs = []
    if L.flow.assumed:
        unres_msgs.append("Flow direction assumed from boundary/road, no levels.")
    for k_, msg in rq.missing.items():
        unres_msgs.append(f"{k_.replace('esc.', '')}: to be confirmed by the designer/certifier.")
    seen = set()
    for m_ in unres_msgs:
        if m_ in seen:
            continue
        seen.add(m_)
        for i, ln in enumerate(_wrap(("- " if True else "") + m_, "Helvetica", 4.0, tw1)):
            if y < FRAME[1] + 3:
                break
            sh.text(x + (1.5 if i else 0), y, ln, 4.0)
            y -= 2.0

    # ---- column 2: general notes (cited), maintenance schedule, disclaimer
    tw2 = COL3 - COL2 - 5
    x = COL2 + 2.5
    y = FRAME[3] - 5
    sh.text(x, y, "GENERAL NOTES (quoted from the cited standards)", 6.0, True)
    y -= 3.6
    for i, n_ in enumerate(general_notes(rq), 1):
        lines = _wrap(f"{i}. {n_}", "Helvetica", 4.2, tw2)
        for j, ln in enumerate(lines):
            sh.text(x + (2.0 if j else 0), y, ln, 4.2)
            y -= 2.0
        y -= 0.5
    y -= 1.0
    sh.stroke((0, 0, 0), 0.13)
    sh.line([(COL2, y), (COL3, y)])
    y -= 4
    sh.text(x, y, "MAINTENANCE & INSPECTION SCHEDULE (cited)", 6.0, True)
    y -= 3.4
    for item, what, src in maintenance_rows(rq):
        sh.text(x, y, item, 4.4, True)
        y -= 2.1
        for ln in _wrap(what + (f" [{src}]" if src else ""), "Helvetica", 4.0, tw2 - 2):
            sh.text(x + 2.0, y, ln, 4.0)
            y -= 1.95
        y -= 0.5
    if y < FRAME[1] + 24:
        out.setdefault("warnings", []).append("Notes panel is full; see the ESC report for the complete cited list.")
    # disclaimer box
    yb = FRAME[1] + 18
    sh.stroke((0.7, 0.1, 0.1), 0.5)
    sh.line([(COL2 + 1.5, FRAME[1] + 1.5), (COL3 - 1.5, FRAME[1] + 1.5), (COL3 - 1.5, yb), (COL2 + 1.5, yb)], close=True)
    yy = yb - 3.5
    for ln in _wrap(DISCLAIMER.upper(), "Helvetica-Bold", 4.8, tw2):
        sh.text(x, yy, ln, 4.8, True, rgb=(0.7, 0.1, 0.1))
        yy -= 2.4
    for ln in _wrap("Not a survey and not a certified design. Positions follow the cited rules where stated; anything not stated is shown as "
                    "'to be confirmed by the designer/certifier'. Cadastre from NSW spatial services; levels, if any, from the stated source.", "Helvetica", 4.0, tw2):
        sh.text(x, yy, ln, 4.0)
        yy -= 1.9
    c.showPage()
    c.save()
    return {"scale": scale, "page_count": 1}
