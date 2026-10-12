"""build_site_report(inputs) -> (pdf bytes, json dict). Pure function of its inputs (plus optional imagery fetches)."""
from __future__ import annotations

import io
from datetime import date

from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import BaseDocTemplate, Frame, NextPageTemplate, PageBreak, PageTemplate
from shapely import wkt

from app.report import fmt, theme as T
from app.report import sections as S
from app.report.blocks import draw_logo
from app.report.findings import build_findings
from app.report.inputs import IMAGERY_FROM_ENV, SiteReportInputs

TITLE = "Site Assessment and Planning Constraints Report"
DEV_BY_LABEL = {"dwelling house": "dwelling_house", "secondary dwelling (granny flat)": "secondary_dwelling", "shed": "shed"}


class _Numbered(rl_canvas.Canvas):
    """Two-pass canvas so the footer can say 'Page x of y'."""
    _footer = None

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._saved: list[dict] = []

    def showPage(self):
        self._saved.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        n = len(self._saved)
        for st in self._saved:
            self.__dict__.update(st)
            if self._pageNumber > 1 and _Numbered._footer:
                _Numbered._footer(self, self._pageNumber, n)
            super().showPage()
        super().save()


def _resolve_imagery(inp: SiteReportInputs):
    if inp.imagery is IMAGERY_FROM_ENV or inp.imagery == IMAGERY_FROM_ENV:
        try:
            from app.imagery.provider import provider_from_env
            return provider_from_env(inp.meta.get("jurisdiction", "NSW"))
        except Exception:  # noqa: BLE001
            return None
    return inp.imagery


def _brand(inp: SiteReportInputs):
    if inp.brand is not None:
        return inp.brand
    from app.branding.brand import Brand
    return Brand.from_env()


def build_site_report(inp: SiteReportInputs) -> tuple[bytes, dict]:
    T.register_fonts()
    lot = wkt.loads(inp.lot_wkt)
    brand = _brand(inp)
    dev_label = str(inp.meta.get("development_type", "")).lower()
    dev_key = inp.meta.get("development_type_key") or DEV_BY_LABEL.get(dev_label, "dwelling_house")
    findings = build_findings(inp.results, inp.triggers, lot, dev_key)
    lga = (inp.meta.get("lga_name") or "").strip() or S.lga_from_layers(findings)
    zone = inp.meta.get("zone_code")
    ctx = S.Ctx(inp, findings, lot, _resolve_imagery(inp), brand, dev_key, zone, lga)
    m = inp.meta
    lot_label = ctx.lot_label
    date_s = fmt.hdate_long(m.get("date")) or str(m.get("date", ""))

    # ---- story
    story: list = []
    story += S.cover_flow(ctx)
    story += [NextPageTemplate("body"), PageBreak()]
    story += S.exec_summary(ctx) + [PageBreak()]
    story += S.site_page(ctx) + [PageBreak()]
    story += S.constraint_table(ctx)
    pages = [f for f in findings if f.has_page]
    pages.sort(key=lambda f: ({"affected": 0, "nearby": 1}[f.status], f.rank))
    for i, f in enumerate(pages, 1):
        story += [PageBreak()] + S.layer_page(ctx, f, i, len(pages))
    story += [PageBreak()] + S.requirements_section(ctx)
    cv = S.civil_section(ctx)
    if cv:
        story += [PageBreak()] + cv
    story += [PageBreak()] + S.appendix(ctx)

    # ---- page furniture
    def cover(c, doc):
        w, h = T.PAGE_W, T.PAGE_H
        c.saveState()
        c.setFillColor(T.INK); c.rect(0, h - 62 * mm, w, 62 * mm, stroke=0, fill=1)
        c.setFillColor(T.GOLD); c.rect(0, h - 62 * mm, w, 1.4 * mm, stroke=0, fill=1)
        lw = draw_logo(c, brand, T.LM - 4 * mm, h - 49 * mm, 28 * mm, bg=None)
        x = T.LM + (lw or 0) + 6 * mm - 4 * mm
        c.setFillColor(T.PAPER); c.setFont("Jost-Bold", 17); c.drawString(x if lw else T.LM, h - 33 * mm, brand.company_name)
        c.setFont("Plex", 8); c.setFillColor(colors.HexColor("#c9c6bb")); c.drawString(x if lw else T.LM, h - 39.5 * mm, brand.trading_line or "")
        det = [d for d in (brand.address, brand.phone, brand.email, (f"ABN {brand.abn}" if brand.abn else None), brand.website) if d]
        c.setFont("Mono", 6.4); yy = h - 46.5 * mm
        for line in [" · ".join(det[:3]), " · ".join(det[3:] + list(brand.registrations))]:
            if line.strip():
                c.drawString(x if lw else T.LM, yy, line); yy -= 3.6 * mm
        c.setFillColor(T.GOLD); c.setFont("Mono-Medium", 7); c.drawRightString(w - T.RM, h - 14 * mm, "DRAFT, INDICATIVE")
        c.setFillColor(colors.HexColor("#c9c6bb")); c.setFont("Mono", 6.4)
        c.drawRightString(w - T.RM, h - 19 * mm, date_s.upper())
        c.drawRightString(w - T.RM, h - 23 * mm, "REV A")
        c.setFillColor(T.GOLD); c.rect(0, 0, w, 3, stroke=0, fill=1)
        c.restoreState()

    def body(c, doc):
        w, h = T.PAGE_W, T.PAGE_H
        c.saveState()
        c.setFillColor(T.INK); c.roundRect(T.LM, h - 17 * mm, 22 * mm, 8.2 * mm, 1.2 * mm, stroke=0, fill=1)
        draw_logo(c, brand, T.LM + 1.8 * mm, h - 16 * mm + 0.1 * mm, 6.0 * mm, bg=None)
        c.setFillColor(T.INK); c.setFont("Jost-Medium", 8.6); c.drawString(T.LM + 25 * mm, h - 12.3 * mm, f"{lot_label}" + (f", {lga}" if lga else ""))
        c.setFont("Mono", 6); c.setFillColor(T.MUTED)
        c.drawString(T.LM + 25 * mm, h - 15.8 * mm, str(m.get("project_title") or m.get("development_type", "")).upper()[:70])
        c.setFont("Mono-Medium", 6); c.setFillColor(T.GOLD)
        c.drawRightString(w - T.RM, h - 12.3 * mm, TITLE.upper())
        c.setFillColor(T.MUTED); c.setFont("Mono", 6); c.drawRightString(w - T.RM, h - 15.8 * mm, f"{date_s.upper()}  ·  DRAFT, INDICATIVE")
        c.setStrokeColor(T.GOLD); c.setLineWidth(0.9); c.line(T.LM, h - 19.6 * mm, w - T.RM, h - 19.6 * mm)
        c.restoreState()

    def footer(c, n, total):
        w = T.PAGE_W
        c.saveState()
        c.setStrokeColor(T.RULE); c.setLineWidth(0.5); c.line(T.LM, 14 * mm, w - T.RM, 14 * mm)
        c.setFont("Mono", 5.8); c.setFillColor(T.MUTED)
        c.drawString(T.LM, 10.2 * mm, "NOT A S10.7 PLANNING CERTIFICATE OR COUNCIL PROPERTY REPORT. INDICATIVE ONLY. NOT CHECKED IS NOT CLEAR.")
        c.drawString(T.LM, 7.4 * mm, f"{brand.company_name.upper()}  ·  {lot_label.upper()}  ·  {date_s.upper()}")
        c.setFont("Mono-Medium", 7); c.setFillColor(T.INK)
        c.drawRightString(w - T.RM, 8.8 * mm, f"PAGE {n} OF {total}")
        c.restoreState()

    _Numbered._footer = staticmethod(footer)
    buf = io.BytesIO()
    doc = BaseDocTemplate(buf, pagesize=(T.PAGE_W, T.PAGE_H), title=f"{TITLE}: {lot_label}", author=brand.company_name,
                          subject=f"{lot_label} {lga}".strip(), leftMargin=T.LM, rightMargin=T.RM, topMargin=T.TM, bottomMargin=T.BM)
    cover_frame = Frame(T.LM, T.BM, T.CW, T.PAGE_H - 62 * mm - 8 * mm - T.BM, id="cov", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    body_frame = Frame(T.LM, T.BM - 2 * mm, T.CW, T.PAGE_H - T.TM - T.BM + 4 * mm, id="body", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate("cover", [cover_frame], onPage=cover), PageTemplate("body", [body_frame], onPage=body)])
    doc.build(story, canvasmaker=_Numbered)
    pdf = buf.getvalue()
    try:
        import pymupdf
        pages_n = len(pymupdf.open(stream=pdf, filetype="pdf"))
    except Exception:  # noqa: BLE001
        pages_n = None

    cnt: dict[str, int] = {}
    for f in findings:
        cnt[f.status] = cnt.get(f.status, 0) + 1
    js = {"title": TITLE, "status": "DRAFT, indicative", "meta": {**{k: v for k, v in m.items()}, "lga_name": lga, "lot_label": lot_label},
          "pages": pages_n, "counts": cnt, "unresolved_items": S.count_unresolved(ctx),
          "findings": [{"key": f.key, "label": f.short, "status": f.status, "headline": f.headline, "currency": f.currency, "source": f.source_name,
                        "features": [{"name": r.name, "distance_m": r.distance_m, "overlap_m2": r.overlap_m2} for r in f.rows], "has_page": f.has_page,
                        "why_unchecked": f.why_unchecked or None} for f in findings],
          "triggers": [t.model_dump() for t in inp.triggers], "figures": ctx.figures,
          "requirements_shown": [r["key"] for r in S.relevant_requirements(inp.requirements, zone, dev_key)],
          "pathway": "provided" if inp.pathway is not None else "not run", "civil": bool(inp.civil), "legal": S.LEGAL,
          "brand": {"company": brand.company_name}}
    return pdf, js
