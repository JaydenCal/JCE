"""build_site_report(inputs) -> (pdf bytes, json dict). Pure function of its inputs (plus optional imagery fetches)."""
from __future__ import annotations

import io
from datetime import date
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import BaseDocTemplate, Frame, NextPageTemplate, PageBreak, PageTemplate
from shapely import wkt

from app.report import fmt, theme as T
from app.common.statement import VERIFY_FIELDS, VERIFY_STATEMENT
from app.report import sections as S
from app.agents.sa5_cad_dxf.planset import codes as PS_CODES
from app.report import explain as EX
from app.report import sections_ex as SX
from app.report import sections_maps as SM
from app.report import maps as MP
from app.report.blocks import Bookmark
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
        self._bm_log: list[tuple] = []

    def showPage(self):
        self._saved.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        n = len(self._saved)
        log = self._bm_log
        for st in self._saved:
            self.__dict__.update(st)
            self._bm_log = log
            for pg, key, title, level in log:
                if pg == self._pageNumber:
                    self.bookmarkPage(key)
                    self.addOutlineEntry(title, key, level=level, closed=0)
            if log:
                self.showOutline()
            if _Numbered._footer:
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
    """The JCESITE platform brand (plain text wordmark, as in the plan set title block). A JCE Infrastructure Brand is never used."""
    if isinstance(inp.brand, PS_CODES.PlatformBrand):
        return inp.brand
    return PS_CODES.PLATFORM_BRAND


def build_site_report(inp: SiteReportInputs, maps_dir: Path | None = None) -> tuple[bytes, dict]:
    """(pdf bytes, json dict). ``maps_dir``: when given, each planning map is also written there as a PNG (the SoEE appendix uses them) and
    the JSON lists them under ``planning_maps``."""
    T.register_fonts()
    lot = wkt.loads(inp.lot_wkt)
    brand = _brand(inp)
    dev_label = str(inp.meta.get("development_type", "")).lower()
    dev_key = inp.meta.get("development_type_key") or DEV_BY_LABEL.get(dev_label, "dwelling_house")
    findings = build_findings(inp.results, inp.triggers, lot, dev_key)
    demo = bool(inp.meta.get("synthetic_demo"))
    if demo:                      # synthetic layout test data: no realistic provenance may survive on any finding
        for f in findings:
            f.meta, f.host, f.source_name, f.source_url = {"synthetic": True}, "", "SYNTHETIC DEMO DATA", ""
            f.currency, f.currency_raw, f.copyright = "SYNTHETIC DEMO DATA, no real data date", None, None
    from app.report import figures as _figs
    _figs.STAMP = "SYNTHETIC DEMO DATA" if demo else None
    lga = (inp.meta.get("lga_name") or "").strip() or S.lga_from_layers(findings)
    zone = inp.meta.get("zone_code")
    ctx = S.Ctx(inp, findings, lot, _resolve_imagery(inp), brand, dev_key, zone, lga)
    ctx.maps = MP.build_plan_maps(inp, findings, lot, ctx.imagery, demo=demo, base_no=ctx.map_base + 1, width_pt=SM.FIG_W)
    m = inp.meta
    lot_label = ctx.lot_label
    date_s = fmt.hdate_long(m.get("date")) or str(m.get("date", ""))
    

    # ---- story
    story: list = []
    story += S.cover_flow(ctx)
    story += [NextPageTemplate("body"), PageBreak()]
    story += SX.how_to_read(ctx) + [PageBreak()]
    story += SX.buffers_explained(ctx) + [PageBreak()]
    story += S.exec_summary(ctx) + [PageBreak()]
    story += S.site_page(ctx) + [PageBreak()]
    story += SM.planning_maps_section(ctx) + ([PageBreak()] if ctx.maps else [])
    story += S.constraint_table(ctx)
    pages = [f for f in findings if f.has_page]
    pages.sort(key=lambda f: ({"affected": 0, "nearby": 1}[f.status], f.rank))
    if pages:
        story += [PageBreak(), Bookmark("Constraint pages", 0)]
    for i, f in enumerate(pages, 1):
        story += ([PageBreak()] if i > 1 else []) + S.layer_page(ctx, f, i, len(pages))
    story += [PageBreak()] + SX.layer_guide(ctx)
    story += [PageBreak()] + S.requirements_section(ctx)
    cv = S.civil_section(ctx)
    if cv:
        story += [PageBreak()] + cv
    story += [PageBreak()] + SX.glossary(ctx)
    story += [PageBreak()] + SX.data_limits(ctx)

    # ---- page furniture
    def cover(c, doc):
        w, h = T.PAGE_W, T.PAGE_H
        c.saveState()
        c.setFillColor(T.INK); c.rect(0, h - 52 * mm, w, 52 * mm, stroke=0, fill=1)
        c.setFillColor(T.GOLD); c.rect(0, h - 52 * mm, w, 1.4 * mm, stroke=0, fill=1)
        # plain text wordmark, same construction as the plan set title block (name bold, tagline beneath)
        c.setFillColor(T.PAPER); c.setFont("Jost-Bold", 19); c.drawString(T.LM, h - 29 * mm, brand.name)
        c.setFont("Plex", 7); c.setFillColor(colors.HexColor("#c9c6bb")); c.drawString(T.LM, h - 34.5 * mm, brand.tagline)
        det = [d for d in (brand.address, brand.phone, brand.email, (f"ABN {brand.abn}" if brand.abn else None), brand.website) if d]
        c.setFont("Mono", 6.4); yy = h - 41 * mm
        for line in (" · ".join(det[:3]), " · ".join(det[3:])):
            if line.strip():
                c.drawString(T.LM, yy, line); yy -= 3.6 * mm
        c.setFillColor(T.GOLD); c.setFont("Mono-Medium", 7); c.drawRightString(w - T.RM, h - 14 * mm, "INDICATIVE")
        c.setFillColor(colors.HexColor("#c9c6bb")); c.setFont("Mono", 6.4)
        c.drawRightString(w - T.RM, h - 19 * mm, date_s)
        c.drawRightString(w - T.RM, h - 23 * mm, "REV A")
        c.setFillColor(T.GOLD); c.rect(0, 0, w, 3, stroke=0, fill=1)
        c.restoreState()

    def body(c, doc):
        w, h = T.PAGE_W, T.PAGE_H
        c.saveState()
        c.setFillColor(T.INK); c.roundRect(T.LM, h - 17 * mm, 22 * mm, 8.2 * mm, 1.2 * mm, stroke=0, fill=1)
        c.setFillColor(T.PAPER); c.setFont("Jost-Bold", 9.2); c.drawCentredString(T.LM + 11 * mm, h - 14.4 * mm, brand.name)
        c.setFillColor(T.INK); c.setFont("Jost-Medium", 8.6); c.drawString(T.LM + 25 * mm, h - 12.3 * mm, f"{lot_label}" + (f", {lga}" if lga else ""))
        c.setFont("Mono", 6); c.setFillColor(T.MUTED)
        c.drawString(T.LM + 25 * mm, h - 15.8 * mm, str(m.get("project_title") or "").upper()[:70])
        c.setFont("Mono-Medium", 6); c.setFillColor(T.GOLD)
        c.drawRightString(w - T.RM, h - 12.3 * mm, TITLE.upper())
        c.setFillColor(T.MUTED); c.setFont("Mono", 6); c.drawRightString(w - T.RM, h - 15.8 * mm, f"{date_s}  ·  INDICATIVE")
        c.setStrokeColor(T.GOLD); c.setLineWidth(0.9); c.line(T.LM, h - 19.6 * mm, w - T.RM, h - 19.6 * mm)
        c.restoreState()

    def footer(c, n, total):
        w = T.PAGE_W
        c.saveState()
        c.setStrokeColor(T.RULE); c.setLineWidth(0.5); c.line(T.LM, 15 * mm, w - T.RM, 15 * mm)
        c.setFont("Mono", 5.6); c.setFillColor(T.MUTED)
        c.drawString(T.LM, 8.6 * mm, "NOT A S10.7 PLANNING CERTIFICATE OR COUNCIL PROPERTY REPORT. INDICATIVE ONLY. NOT CHECKED IS NOT CLEAR.")
        c.drawString(T.LM, 5.8 * mm, f"{brand.name}  ·  {lot_label.upper()}  ·  {date_s}" + ("  ·  SYNTHETIC DEMO DATA" if demo else ""))
        c.setFont("Mono-Medium", 7); c.setFillColor(T.INK)
        c.drawRightString(w - T.RM, 5.8 * mm, f"PAGE {n} OF {total}")
        c.restoreState()

    _Numbered._footer = staticmethod(footer)
    buf = io.BytesIO()
    doc = BaseDocTemplate(buf, pagesize=(T.PAGE_W, T.PAGE_H), title=f"{TITLE}: {lot_label}", author=brand.name,
                          subject=f"{lot_label} {lga}".strip(), leftMargin=T.LM, rightMargin=T.RM, topMargin=T.TM, bottomMargin=T.BM)
    cover_frame = Frame(T.LM, T.BM, T.CW, T.PAGE_H - 52 * mm - 6 * mm - T.BM, id="cov", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    body_frame = Frame(T.LM, T.BM - 2 * mm, T.CW, T.PAGE_H - T.TM - T.BM + 4 * mm, id="body", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate("cover", [cover_frame], onPage=cover), PageTemplate("body", [body_frame], onPage=body)])
    doc.build(story, canvasmaker=_Numbered)
    pdf = buf.getvalue()
    try:
        import pymupdf
        pages_n = len(pymupdf.open(stream=pdf, filetype="pdf"))
    except Exception:  # noqa: BLE001
        pages_n = None

    pm_rec = []
    for pm in ctx.maps:
        png = None
        if maps_dir is not None:
            maps_dir = Path(maps_dir)
            maps_dir.mkdir(parents=True, exist_ok=True)
            (maps_dir / f"{pm.key}.png").write_bytes(MP.render_png(pm, SM.FIG_W))
            png = f"{maps_dir.name}/{pm.key}.png"
        pm_rec.append(pm.record(png))
    cnt: dict[str, int] = {}
    for f in findings:
        cnt[f.status] = cnt.get(f.status, 0) + 1
    js = {"title": TITLE, "status": "indicative, to be verified by a suitably qualified person", "meta": {**{k: v for k, v in m.items()}, "lga_name": lga, "lot_label": lot_label},
          "pages": pages_n, "counts": cnt, "unresolved_items": S.count_unresolved(ctx),
          "findings": [{"key": f.key, "label": f.short, "status": f.status, "headline": f.headline, "currency": f.currency, "source": f.source_name,
                        "features": [{"name": r.name, "distance_m": r.distance_m, "overlap_m2": r.overlap_m2} for r in f.rows], "has_page": f.has_page,
                        "why_unchecked": f.why_unchecked or None} for f in findings],
          "triggers": [t.model_dump() for t in inp.triggers], "figures": ctx.figures, "planning_maps": pm_rec,
          "requirements_shown": [r["key"] for r in S.relevant_requirements(inp.requirements, zone, dev_key)],
          "pathway": "provided" if inp.pathway is not None else "not run", "civil": bool(inp.civil), "legal": S.LEGAL,
          "brand": {"company": brand.name, "tagline": brand.tagline}, "verification": {"statement": VERIFY_STATEMENT, "fields": list(VERIFY_FIELDS), "on": "cover only"},
          "sections": [{"number": n, "title": t} for n, t in ctx.sections]}
    return pdf, js
