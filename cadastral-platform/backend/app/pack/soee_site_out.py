"""Writers for the JCESITE site works SoEE: PDF (reportlab), DOCX (python-docx), JSON sidecar, page PNGs and the pagination checker.

JCESITE is NOT affiliated with JCE Infrastructure: no JCE logo, name or ABN is drawn.  The AI statement is on the cover and in every page footer.
Headings keep with the next block (reportlab keepWithNext plus a conditional page break; Word keep_with_next, repeated table header rows and rows that
do not split across pages).  ``stranded_headings`` checks the result by reading the rendered PDF (and the LibreOffice rendering of the DOCX).
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

from app.common.statement import VERIFY_FIELDS, VERIFY_STATEMENT, VERIFY_TITLE
from app.pack.soee_site import BRAND, BUILDING_BY_OTHERS, METHOD_TEXT, SiteSoee, Stmt, Table, T
from app.report import fmt

# status word -> (text colour, fill colour) for table cells
STATUS_HEX = {
    "PASS": ("#2f6b3a", "#e1efe3"), "FAIL": ("#a63a2b", "#f6e1dd"), "UNRESOLVED": ("#2d5a96", "#dde7f4"),
    "NOT CHECKED": ("#4a5160", "#e3e5e9"), "NOT INTERSECTED BY THE DATA LOADED": ("#5b5f66", "#ececea"),
    "MAPPED OR INTERSECTS": ("#a63a2b", "#f6e1dd"), "WITHIN BUFFER": ("#b4601a", "#f7e6d3"),
    "NOT REVIEWED, UNRESOLVED": ("#2d5a96", "#dde7f4"), "CITED VALUES FOUND": ("#5b5f66", "#ececea"),
    "NOT TRIGGERED": ("#2f6b3a", "#e1efe3"), "TRIGGERED": ("#b4601a", "#f7e6d3"),
}


def status_style(txt: str) -> tuple[str, str]:
    """(text colour, fill) for a status cell.  A qualified result such as PASS (PLATFORM DEFAULT, TO BE CONFIRMED) is amber: it is not a plain pass."""
    if txt in STATUS_HEX:
        return STATUS_HEX[txt]
    if txt.startswith("PASS ("):
        return ("#8a5a12", "#f7ecd3")
    return STATUS_HEX.get(txt.split(" (")[0], ("#1e2024", "#ffffff"))
TAG_HEX = {"NOT CHECKED": "#4a5160", "UNRESOLVED": "#2d5a96", "NOT REVIEWED, UNRESOLVED": "#2d5a96", "DATA NOT AVAILABLE": "#a63a2b", "NOT ASSESSED": "#6b6e75",
           "ASSUMED / PLATFORM DEFAULT": "#b4601a", "ASSUMED": "#b4601a", "INDICATIVE, 5 m DEM": "#8a5a12", "BUILDING DESIGN BY OTHERS": "#6b6e75", "TYPICAL HOUSE, INDICATIVE": "#8a5a12", "OFFLINE FIXTURE": "#a63a2b",
           "MAPPED OR INTERSECTS": "#a63a2b", "WITHIN BUFFER": "#b4601a", "NOT INTERSECTED BY THE DATA LOADED": "#5b5f66"}
TOC_SKIP = ("Section 4.15(1)",)     # the nine section 4.15 sub headings are not listed in the contents (the list must fit on one page)
SMALL_TABLE_ROWS = 6              # a table of this many rows or fewer is kept on one page
PAGE_BREAK_BEFORE = {"1", "Appendix A"}          # sections that start a new page (the others follow on, with a conditional break)
DEMO_STAMP = "SYNTHETIC DEMO DATA"
FOOT_LEFT = "JCESITE. AI-assisted site planning. Not affiliated with any consultancy."


def _plain(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


# ---------------------------------------------------------------------------------------------------------------------- sidecar
def write_json(doc: SiteSoee, path: Path) -> Path:
    stm = []
    for s in doc.statements():
        stm.append({"id": s.id, "section": s.section, "kind": s.kind, "tag": s.tag or None, "text": s.text, "source": s.source, "citation": s.cite})
    payload = {"document": {"title": doc.title, "number": doc.number, "site": doc.site, "council": doc.council, "date": doc.date, "revision": doc.revision,
                            "status": doc.status, "verification": {"statement": VERIFY_STATEMENT, "fields": list(VERIFY_FIELDS), "on": "cover only"}, "platform": BRAND.name, "scope": "SITE WORKS ONLY", "building": doc.building_line,
                            "mode": doc.mode, "synthetic_demo": bool(doc.meta.get("synthetic_demo")), "text_written_by_language_model": False, "requirement_values_extracted_by_ai_model": True,
                            "requirement_values_verified_by_person": False, "method": METHOD_TEXT},
               "meta": doc.meta, "compliance": doc.compliance, "open_items": doc.open_items,
               "headings": doc.headings(), "statements": stm}
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    return path


# ---------------------------------------------------------------------------------------------------------------------- PDF
def write_pdf(doc: SiteSoee, path: Path) -> Path:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas as rl_canvas
    from reportlab.platypus import (BaseDocTemplate, CondPageBreak, Frame, KeepTogether, PageBreak, PageTemplate, Paragraph, Spacer, Table as RTable, TableStyle)
    from reportlab.platypus.tableofcontents import TableOfContents
    from reportlab.pdfbase.pdfmetrics import stringWidth
    from reportlab.lib.utils import simpleSplit
    from app.report import theme as TH

    TH.register_fonts()
    st = TH.styles()
    INK, GOLD, MUTED, RULE = TH.INK, TH.GOLD, TH.MUTED, TH.RULE
    W, H = TH.PAGE_W, TH.PAGE_H
    LM, RM, TM, BM = 18 * mm, 18 * mm, 22 * mm, 26 * mm
    CW = W - LM - RM
    e = fmt.esc

    sty = {
        "body": ParagraphStyle("b", parent=st["body"], fontSize=9, leading=13, spaceAfter=4),
        "body_kwn": ParagraphStyle("bk", parent=st["body"], fontSize=9, leading=13, spaceAfter=4, keepWithNext=1),
        "bullet": ParagraphStyle("bl", parent=st["bullet"], fontSize=9, leading=13, leftIndent=11, bulletIndent=1, spaceAfter=3),
        "bullet_kwn": ParagraphStyle("blk", parent=st["bullet"], fontSize=9, leading=13, leftIndent=11, bulletIndent=1, spaceAfter=3, keepWithNext=1),
        "h1": ParagraphStyle("h1", parent=st["h1"], fontSize=19, leading=22, spaceBefore=14, spaceAfter=5, keepWithNext=1),
        "h2": ParagraphStyle("h2", parent=st["h2"], fontSize=11.5, leading=14, spaceBefore=8, spaceAfter=3, keepWithNext=1),
        "cell": ParagraphStyle("c", parent=st["cell"], fontSize=7.8, leading=10.2),
        "cellh": ParagraphStyle("ch", parent=st["cellb"], fontSize=7.6, leading=9.6, textColor=colors.white),
        "cellb": ParagraphStyle("cb", parent=st["cellb"], fontSize=7.9, leading=10.2),
        "cap": ParagraphStyle("cap", parent=st["caption"], fontSize=7.4, spaceBefore=1, spaceAfter=6),
        "toc0": ParagraphStyle("toc0", fontName="Plex-Medium", fontSize=8.8, leading=10.4, textColor=INK, spaceBefore=1.2),
        "toc1": ParagraphStyle("toc1", fontName="Plex", fontSize=7.5, leading=8.2, textColor=INK, leftIndent=12),
    }

    def _verification_box(sty_):
        """Cover verification block (stage 8): the statement, a tick box and blank NAME, SIGNATURE and DATE boxes for the person who verifies."""
        from app.report.blocks import CheckBox
        inner = CW - 18
        head = RTable([[Paragraph(f'<font name="Plex-Bold" size="7.6" color="#6b6e75">{e(VERIFY_TITLE)}</font>', sty_["cell"]), ""],
                       [CheckBox(), Paragraph(f'<font name="Plex-Bold" size="11">{e(VERIFY_STATEMENT)}</font>', sty_["body"])]], colWidths=[12 * mm, inner - 12 * mm])
        head.setStyle(TableStyle([("SPAN", (0, 0), (1, 0)), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 2),
                                  ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
        ws = [inner * 0.34, inner * 0.40, inner * 0.26]
        sig = RTable([[Paragraph(f'<font name="Plex" size="7.6" color="#6b6e75">{e(f)}</font>', sty_["cell"]) for f in VERIFY_FIELDS], ["", "", ""]], colWidths=ws, rowHeights=[6 * mm, 15 * mm])
        sig.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.9, INK), ("INNERGRID", (0, 0), (-1, -1), 0.5, INK), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 4),
                                 ("TOPPADDING", (0, 0), (-1, -1), 2)]))
        outer = RTable([[head], [sig]], colWidths=[CW])
        outer.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 1.2, INK), ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9), ("TOPPADDING", (0, 0), (-1, -1), 8),
                                   ("BOTTOMPADDING", (0, 0), (-1, -1), 9)]))
        return outer

    def tagged(s: Stmt) -> str:
        if s.tag:
            col = TAG_HEX.get(s.tag, "#1e2024")
            return f'<font name="Plex-Bold" color="{col}">{e(s.tag)}.</font> {e(s.text)}'
        return e(s.text)

    class Doc(BaseDocTemplate):
        def afterFlowable(self, fl):
            t = getattr(fl, "_toc", None)
            if t:
                self.notify("TOCEntry", (t[0], t[1], self.page))

    class Numbered(rl_canvas.Canvas):
        """Two pass canvas: footer 'Page X of Y' and the AI statement on every page including the cover."""

        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            self._saved = []

        def showPage(self):
            self._saved.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            n = len(self._saved)
            for state in self._saved:
                self.__dict__.update(state)
                self._furniture(n)
                super().showPage()
            super().save()

        def _furniture(self, n: int):
            pg = self._pageNumber
            self.saveState()
            if pg > 1:
                self.setFont("Plex", 7.2)
                self.setFillColor(MUTED)
                self.drawString(LM, H - 13 * mm, f"{BRAND.name}   STATEMENT OF ENVIRONMENTAL EFFECTS (SITE WORKS)")
                self.drawRightString(W - RM, H - 13 * mm, f"{doc.site}   {doc.number}")
                self.setStrokeColor(RULE)
                self.setLineWidth(0.5)
                self.line(LM, H - 15 * mm, W - RM, H - 15 * mm)
            self.setStrokeColor(RULE)
            self.setLineWidth(0.5)
            self.line(LM, 21 * mm, W - RM, 21 * mm)
            self.setFont("Plex", 6.8)
            self.setFillColor(MUTED)
            left = f"{doc.number}   {doc.status}   Revision {doc.revision}   {doc.date}"
            self.drawString(LM, 9.5 * mm, left)
            if doc.meta.get("synthetic_demo"):
                self.setFont("Plex-Bold", 6.9)
                self.setFillColor(colors.HexColor("#a63a2b"))
                self.drawString(LM + stringWidth(left, "Plex", 6.8) + 8, 9.5 * mm, DEMO_STAMP)
                self.setFont("Plex", 6.8)
                self.setFillColor(MUTED)
            self.drawRightString(W - RM, 9.5 * mm, f"Page {pg} of {n}")
            self.restoreState()

    def P(text, style="body"):
        return Paragraph(text, sty[style] if isinstance(style, str) else style)

    def heading(text: str, level: int) -> Paragraph:
        p = Paragraph(e(text), sty["h1" if level == 0 else "h2"])
        if not text.startswith(TOC_SKIP):
            p._toc = (level, T(text))
        return p

    def chip_cell(txt: str):
        col, fill = status_style(txt)
        return Paragraph(f'<font name="Plex-Bold" color="{col}">{e(txt)}</font>', sty["cell"]), fill

    def make_table(t: Table):
        tot = sum(t.widths)
        cws = [CW * w / tot for w in t.widths]
        data = [[Paragraph(e(h), sty["cellh"]) for h in t.header]]
        fills = []
        for ri, r in enumerate(t.rows, 1):
            row = []
            for ci, c in enumerate(r):
                if t.status_col is not None and ci == t.status_col:
                    p, fill = chip_cell(c)
                    row.append(p)
                    fills.append((ri, fill))
                else:
                    row.append(Paragraph(e(c), sty["cell"]))
            data.append(row)
        tb = RTable(data, colWidths=cws, repeatRows=1, splitByRow=1)
        style = [("BACKGROUND", (0, 0), (-1, 0), INK), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 1), (-1, -1), 0.4, RULE),
                 ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                 ("BOX", (0, 0), (-1, -1), 0.5, RULE)]
        for ri, fill in fills:
            style.append(("BACKGROUND", (t.status_col, ri), (t.status_col, ri), colors.HexColor(fill)))
        tb.setStyle(TableStyle(style))
        return tb

    FW = (CW - 4 * mm) / 2

    def fig_row(grp: list):
        from PIL import Image as PILImage
        from reportlab.platypus import Image as RLImage
        cells = []
        for fb in grp:
            png = fb.fig["png"]
            with PILImage.open(png) as im:
                wpx, hpx = im.size
            cells.append([RLImage(png, width=FW, height=FW * hpx / wpx), Paragraph(e(fb.stmts[0].text), sty["cap"])])
        row = [cells[0], "", cells[1] if len(cells) > 1 else ""]
        t = RTable([row], colWidths=[FW, 4 * mm, FW])
        t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                               ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
        return t

    story: list = []
    # ---- cover
    story.append(Spacer(1, 18 * mm))
    story.append(Paragraph(BRAND.name, ParagraphStyle("wm", fontName="Jost-Bold", fontSize=40, leading=48, textColor=INK, spaceAfter=4)))
    story.append(Paragraph(BRAND.tagline, ParagraphStyle("tg", fontName="Mono", fontSize=8.5, leading=11, textColor=GOLD, spaceAfter=10)))
    story.append(Spacer(1, 20 * mm))
    story.append(Paragraph(e(doc.title), ParagraphStyle("ct", fontName="Jost-Bold", fontSize=27, leading=31, textColor=INK, spaceAfter=3)))
    story.append(Paragraph("SITE WORKS ONLY" if doc.building_line == BUILDING_BY_OTHERS else "SITE WORKS AND AN INDICATIVE TYPICAL HOUSE", ParagraphStyle("cs", fontName="Mono-Medium", fontSize=9, leading=12, textColor=GOLD, spaceBefore=5, spaceAfter=14)))
    story.append(Paragraph(e(doc.site), ParagraphStyle("csite", fontName="Jost-Medium", fontSize=17, leading=21, textColor=INK, spaceAfter=2)))
    story.append(Paragraph(e(doc.council), ParagraphStyle("cc", fontName="Plex", fontSize=11, leading=15, textColor=INK, spaceAfter=14)))
    cov = [[Paragraph(e(k), sty["cellb"]), Paragraph(e(v), sty["cell"])] for k, v in
           [("Date", doc.date), ("Revision", doc.revision), ("Status", doc.status), ("Document number", doc.number),
            ("Scope", "Civil and site works: crossover and layover, driveway, earthworks, stormwater, erosion and sediment control, indicative services, site constraints"),
            ("Building", doc.building_line)]]
    ct = RTable(cov, colWidths=[38 * mm, CW - 38 * mm])
    ct.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story.append(ct)
    story.append(Spacer(1, 14 * mm))
    story.append(_verification_box(sty))
    if doc.meta.get("synthetic_demo"):
        story.append(Spacer(1, 4 * mm))
        story.append(P(f'<font name="Plex-Bold" color="#a63a2b">{DEMO_STAMP}.</font> {e("The constraint layers and planning maps in this document are invented to exercise the drawing code. They describe no real site and must not be used.")}', "cap"))
    if doc.meta.get("offline_fixture"):
        story.append(Spacer(1, 4 * mm))
        story.append(P(f'<font name="Plex-Bold" color="#a63a2b">OFFLINE FIXTURE.</font> {e("The site and constraint data in this draft come from saved fixture data (approximate geometry), not from live services.")}', "cap"))
    story.append(PageBreak())

    # ---- document control
    story.append(Paragraph("Document control", sty["h1"]))
    story.append(Spacer(1, 2 * mm))
    ctl = [("Title", doc.title + " (site works only)"), ("Site", doc.site), ("Council", doc.council), ("Document number", doc.number), ("Status", doc.status),
           ("Revision", doc.revision), ("Date", doc.date), ("Prepared by", f"{BRAND.name} (software, deterministic text from data and cited documents)"),
           ("Plan set", "JCESITE civil plan set, drawings JCS-XXX-CIV-000 to JCS-XXX-CIV-600 (section 1.2)"), ("Building", doc.building_line),
           ("Method", METHOD_TEXT)]
    rows = [[Paragraph(e(k), sty["cellb"]), Paragraph(e(v), sty["cell"])] for k, v in ctl]
    ctt = RTable(rows, colWidths=[38 * mm, CW - 38 * mm])
    ctt.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 3.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5)]))
    story.append(ctt)
    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph("Revision history", sty["h2"]))
    rv = RTable([[Paragraph(e(h), sty["cellh"]) for h in ("Revision", "Date", "Description", "Status")],
                 [Paragraph(e(doc.revision), sty["cell"]), Paragraph(e(doc.date), sty["cell"]), Paragraph("First draft generated from project data", sty["cell"]), Paragraph(e(doc.status), sty["cell"])]],
                colWidths=[22 * mm, 28 * mm, CW - 22 * mm - 28 * mm - 30 * mm, 30 * mm])
    rv.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), INK), ("BOX", (0, 0), (-1, -1), 0.5, RULE), ("LINEBELOW", (0, 1), (-1, -1), 0.4, RULE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                            ("LEFTPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
    story.append(KeepTogether([rv]))
    story.append(PageBreak())

    # ---- contents
    story.append(Paragraph("Contents", sty["h1"]))
    toc = TableOfContents()
    toc.levelStyles = [sty["toc0"], sty["toc1"]]
    toc.dotsMinLevel = 0
    story.append(toc)

    # ---- sections
    for s in doc.sections:
        if s.number in PAGE_BREAK_BEFORE:
            story.append(PageBreak())
        else:
            story.append(CondPageBreak(75 * mm))          # the section heading, the first sub heading (which breaks the page below 42 mm) and some body text must fit
        story.append(heading(f"{s.number} {s.title}", 0))
        fig_done: set[int] = set()
        for bi, b in enumerate(s.blocks):
            nxt = s.blocks[bi + 1] if bi + 1 < len(s.blocks) else None
            if b.kind == "figure":
                if bi in fig_done:
                    continue
                grp = [b]
                if nxt is not None and nxt.kind == "figure":
                    grp.append(nxt)
                    fig_done.add(bi + 1)
                story.append(fig_row(grp))
                story.append(Spacer(1, 3 * mm))
            elif b.kind == "h2":
                nxt2 = s.blocks[bi + 2] if bi + 2 < len(s.blocks) else None
                intro_table = nxt is not None and nxt.kind == "p" and nxt2 is not None and nxt2.kind in ("table", "figure")
                story.append(CondPageBreak(62 * mm if intro_table else 42 * mm))      # heading, intro paragraph and the head of the table or figure below it
                story.append(heading(b.text, 1))
            elif b.kind == "p":
                # a paragraph that introduces a table stays with the table (when a heading sits directly above, the break was made before the heading)
                prev = s.blocks[bi - 1] if bi > 0 else None
                if nxt is not None and nxt.kind == "table" and not (prev is not None and prev.kind == "h2"):
                    story.append(CondPageBreak(50 * mm))                 # room for the paragraph and the head of the table below it
                story.append(Paragraph(tagged(b.stmts[0]), sty["body_kwn" if nxt is not None and nxt.kind == "figure" else "body"]))
            elif b.kind == "bullets":
                n_ = len(b.stmts)
                for i_, x in enumerate(b.stmts):
                    # no single item of a list is left alone at the foot or the head of a page: the first two and the last two items stay together
                    kwn = n_ > 1 and (i_ == 0 or (n_ > 2 and i_ == n_ - 2))
                    story.append(Paragraph(tagged(x), sty["bullet_kwn" if kwn else "bullet"], bulletText="•"))
            elif b.kind == "table" and b.table:
                parts = [make_table(b.table), Paragraph(e(b.table.caption), sty["cap"]) if b.table.caption else Spacer(1, 3 * mm)]
                if len(b.table.rows) <= SMALL_TABLE_ROWS:
                    story.append(KeepTogether(parts))              # a small table is not split across a page break
                else:
                    story += parts

    d = Doc(str(path), pagesize=(W, H), leftMargin=LM, rightMargin=RM, topMargin=TM, bottomMargin=BM, title=f"{doc.title} {doc.site}", author=BRAND.name,
            subject="Indicative. To be verified by a suitably qualified person.")
    d.addPageTemplates([PageTemplate(id="main", frames=[Frame(LM, BM, CW, H - TM - BM, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="f")])])
    d.multiBuild(story, canvasmaker=Numbered)
    return path


# ---------------------------------------------------------------------------------------------------------------------- DOCX
def write_docx(doc: SiteSoee, path: Path) -> Path:
    from docx import Document
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Mm, Pt, RGBColor

    d = Document()
    sec = d.sections[0]
    sec.page_width, sec.page_height = Mm(210), Mm(297)
    sec.left_margin = sec.right_margin = Mm(18)
    sec.top_margin, sec.bottom_margin = Mm(22), Mm(26)
    sec.footer_distance = Mm(8)
    CWmm = 174.0

    def rgb(h: str) -> RGBColor:
        return RGBColor.from_string(h.lstrip("#").upper())

    # styles
    n = d.styles["Normal"]
    n.font.name, n.font.size = "Arial", Pt(10)
    n.element.rPr.rFonts.set(qn("w:eastAsia"), "Arial")
    n.paragraph_format.space_after = Pt(5)
    n.paragraph_format.line_spacing = 1.12
    for nm, sz, before, after in (("Heading 1", 17, 6, 8), ("Heading 2", 12, 12, 4)):
        h = d.styles[nm]
        h.font.name, h.font.size, h.font.bold = "Arial", Pt(sz), True
        h.font.color.rgb = rgb("1E2024")
        h.element.rPr.rFonts.set(qn("w:eastAsia"), "Arial")
        h.element.rPr.rFonts.set(qn("w:ascii"), "Arial")
        h.element.rPr.rFonts.set(qn("w:hAnsi"), "Arial")
        for a_ in ("asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"):
            h.element.rPr.rFonts.attrib.pop(qn("w:" + a_), None)
        h.paragraph_format.space_before, h.paragraph_format.space_after = Pt(before), Pt(after)
        h.paragraph_format.keep_with_next = True
        h.paragraph_format.keep_together = True
    lb = d.styles["List Bullet"]
    lb.font.name, lb.font.size = "Arial", Pt(10)
    lb.paragraph_format.space_after = Pt(3)

    def run(p, text, bold=False, color=None, size=None, italic=False):
        r = p.add_run(T(text))
        r.bold, r.italic = bold, italic
        r.font.name = "Arial"
        r._element.rPr.rFonts.set(qn("w:eastAsia"), "Arial")
        if color:
            r.font.color.rgb = rgb(color)
        if size:
            r.font.size = Pt(size)
        return r

    def field(p, instr: str, size=7.5, color="6B6E75"):
        """A complex field (PAGE, NUMPAGES) built from separate runs so every part carries the footer font size."""
        def part(kind=None, text=None, instr_text=None):
            r = p.add_run()
            r.font.size = Pt(size)
            r.font.name = "Arial"
            r.font.color.rgb = rgb(color)
            if kind:
                fc = OxmlElement("w:fldChar")
                fc.set(qn("w:fldCharType"), kind)
                r._element.append(fc)
            if instr_text:
                it = OxmlElement("w:instrText")
                it.set(qn("xml:space"), "preserve")
                it.text = instr_text
                r._element.append(it)
            if text:
                tx = OxmlElement("w:t")
                tx.text = text
                r._element.append(tx)
        part("begin")
        part(instr_text=f" {instr} ")
        part("separate")
        part(text="1")
        part("end")

    def tagged(p, s: Stmt):
        if s.tag:
            run(p, s.tag + ". ", bold=True, color=TAG_HEX.get(s.tag, "#1e2024"))
        run(p, s.text)

    def shade(cell, fill: str):
        tcPr = cell._element.get_or_add_tcPr()
        sh = OxmlElement("w:shd")
        sh.set(qn("w:val"), "clear")
        sh.set(qn("w:color"), "auto")
        sh.set(qn("w:fill"), fill.lstrip("#").upper())
        tcPr.append(sh)

    def borders(tbl, color="CFCDC6"):
        tblPr = tbl._element.tblPr
        b = OxmlElement("w:tblBorders")
        for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
            el = OxmlElement(f"w:{edge}")
            el.set(qn("w:val"), "single")
            el.set(qn("w:sz"), "4")
            el.set(qn("w:space"), "0")
            el.set(qn("w:color"), color)
            b.append(el)
        tblPr.append(b)

    def fixed(tbl, widths_mm):
        tbl.autofit = False
        tbl.alignment = WD_TABLE_ALIGNMENT.LEFT
        tblPr = tbl._element.tblPr
        lay = OxmlElement("w:tblLayout")
        lay.set(qn("w:type"), "fixed")
        tblPr.append(lay)
        for col, w in zip(tbl.columns, widths_mm):
            col.width = Mm(w)
        for row in tbl.rows:
            for c, w in zip(row.cells, widths_mm):
                c.width = Mm(w)

    def row_props(row, header=False):
        trPr = row._tr.get_or_add_trPr()
        cs = OxmlElement("w:cantSplit")
        trPr.append(cs)
        if header:
            th = OxmlElement("w:tblHeader")
            trPr.append(th)

    def cell_text(cell, text, bold=False, color=None, size=8.5, keep=False):
        p = cell.paragraphs[0]
        p.paragraph_format.space_after = Pt(1)
        p.paragraph_format.space_before = Pt(1)
        p.paragraph_format.keep_with_next = keep
        run(p, text, bold=bold, color=color, size=size)

    def add_table(t: Table):
        tot = sum(t.widths)
        wmm = [CWmm * w / tot for w in t.widths]
        tbl = d.add_table(rows=1, cols=len(t.header))
        borders(tbl)
        for i, h in enumerate(t.header):
            c = tbl.rows[0].cells[i]
            shade(c, "1E2024")
            cell_text(c, h, bold=True, color="FFFFFF", size=8.3, keep=True)
        row_props(tbl.rows[0], header=True)
        small = len(t.rows) <= SMALL_TABLE_ROWS
        for ri, r in enumerate(t.rows):
            cells = tbl.add_row().cells
            row_props(tbl.rows[-1])
            kp = ri == 0 or (small and ri < len(t.rows) - 1)           # first row stays with the header; a small table stays together
            for ci, v in enumerate(r):
                if t.status_col is not None and ci == t.status_col:
                    col, fill = status_style(v)
                    shade(cells[ci], fill)
                    cell_text(cells[ci], v, bold=True, color=col, keep=kp)
                else:
                    cell_text(cells[ci], v, keep=kp)
        fixed(tbl, wmm)
        if t.caption:
            p = d.add_paragraph()
            run(p, t.caption, size=8, color="6B6E75")
        else:
            sp = d.add_paragraph()
            sp.paragraph_format.space_after = Pt(2)

    def page_break():
        d.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    # footer (every page, including the cover) and header (not on the cover)
    sec.different_first_page_header_footer = True

    def build_footer(f):
        f.is_linked_to_previous = False
        p = f.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(2)
        p2 = p
        p2.paragraph_format.space_after = Pt(0)
        run(p2, f"{doc.number}   {doc.status}   Revision {doc.revision}   {doc.date}   ", size=7.5, color="6B6E75")
        if doc.meta.get("synthetic_demo"):
            run(p2, DEMO_STAMP + "   ", bold=True, size=7.5, color="A63A2B")
        run(p2, "Page ", size=7.5, color="6B6E75")
        field(p2, "PAGE")
        run(p2, " of ", size=7.5, color="6B6E75")
        field(p2, "NUMPAGES")

    build_footer(sec.footer)
    build_footer(sec.first_page_footer)
    h = sec.header
    h.is_linked_to_previous = False
    hp = h.paragraphs[0]
    run(hp, f"{BRAND.name}   STATEMENT OF ENVIRONMENTAL EFFECTS (SITE WORKS)   {doc.site}   {doc.number}", size=7.5, color="6B6E75")
    sec.first_page_header.is_linked_to_previous = False

    # cover
    for _ in range(3):
        d.add_paragraph()
    p = d.add_paragraph()
    run(p, BRAND.name, bold=True, size=38)
    p = d.add_paragraph()
    run(p, BRAND.tagline, size=9, color="A8842F", bold=True)
    for _ in range(3):
        d.add_paragraph()
    p = d.add_paragraph()
    run(p, doc.title, bold=True, size=26)
    p = d.add_paragraph()
    run(p, "SITE WORKS ONLY" if doc.building_line == BUILDING_BY_OTHERS else "SITE WORKS AND AN INDICATIVE TYPICAL HOUSE", bold=True, size=10, color="A8842F")
    p = d.add_paragraph()
    run(p, doc.site, bold=True, size=16)
    p = d.add_paragraph()
    run(p, doc.council, size=11)
    cov = d.add_table(rows=0, cols=2)
    borders(cov)
    for k, v in [("Date", doc.date), ("Revision", doc.revision), ("Status", doc.status), ("Document number", doc.number),
                 ("Scope", "Civil and site works: crossover and layover, driveway, earthworks, stormwater, erosion and sediment control, indicative services, site constraints"),
                 ("Building", doc.building_line)]:
        cs = cov.add_row().cells
        cell_text(cs[0], k, bold=True, size=9.5)
        cell_text(cs[1], v, size=9.5)
        row_props(cov.rows[-1])
    fixed(cov, [38, CWmm - 38])
    d.add_paragraph()
    vb = d.add_table(rows=3, cols=3)
    borders(vb, "1E2024")
    vb.rows[0].cells[0].merge(vb.rows[0].cells[2])
    cell_text(vb.rows[0].cells[0], VERIFY_TITLE, bold=True, size=8, color="6B6E75")
    vb.rows[1].cells[0].merge(vb.rows[1].cells[2])
    cell_text(vb.rows[1].cells[0], "[   ]  " + VERIFY_STATEMENT, bold=True, size=12)
    for i_, nm_ in enumerate(VERIFY_FIELDS):
        cell_text(vb.rows[2].cells[i_], nm_, size=8, color="6B6E75")
    row_props(vb.rows[0])
    row_props(vb.rows[1])
    vb.rows[2].height = Pt(46)
    fixed(vb, [CWmm * 0.34, CWmm * 0.40, CWmm * 0.26])
    if doc.meta.get("synthetic_demo"):
        d.add_paragraph().paragraph_format.space_after = Pt(2)
        p = d.add_paragraph()
        run(p, DEMO_STAMP + ". ", bold=True, color="A63A2B", size=8.5)
        run(p, "The constraint layers and planning maps in this document are invented to exercise the drawing code. They describe no real site and must not be used.", size=8.5)
    if doc.meta.get("offline_fixture"):
        d.add_paragraph().paragraph_format.space_after = Pt(2)
        p = d.add_paragraph()
        run(p, "OFFLINE FIXTURE. ", bold=True, color="A63A2B", size=8.5)
        run(p, "The site and constraint data in this draft come from saved fixture data (approximate geometry), not from live services.", size=8.5)
    page_break()

    # document control
    d.add_heading("Document control", 1)
    rows = [("Title", doc.title + " (site works only)"), ("Site", doc.site), ("Council", doc.council), ("Document number", doc.number), ("Status", doc.status),
            ("Revision", doc.revision), ("Date", doc.date), ("Prepared by", f"{BRAND.name} (software, deterministic text from data and cited documents)"),
            ("Plan set", "JCESITE civil plan set, drawings JCS-XXX-CIV-000 to JCS-XXX-CIV-600 (section 1.2)"), ("Building", doc.building_line),
            ("Method", METHOD_TEXT)]
    t = d.add_table(rows=0, cols=2)
    borders(t)
    for k, v in rows:
        cs = t.add_row().cells
        cell_text(cs[0], k, bold=True, size=9)
        cell_text(cs[1], v, size=9)
        row_props(t.rows[-1])
    fixed(t, [38, CWmm - 38])
    d.add_paragraph()
    d.add_heading("Revision history", 2)
    rv = d.add_table(rows=2, cols=4)
    borders(rv)
    for i, hh in enumerate(("Revision", "Date", "Description", "Status")):
        shade(rv.rows[0].cells[i], "1E2024")
        cell_text(rv.rows[0].cells[i], hh, bold=True, color="FFFFFF", size=8.3, keep=True)
    for i, vv in enumerate((doc.revision, doc.date, "First draft generated from project data", doc.status)):
        cell_text(rv.rows[1].cells[i], vv, size=9, keep=True)
    for ri_, r_ in enumerate(rv.rows):
        row_props(r_, header=(ri_ == 0))
    fixed(rv, [22, 28, 94, 30])
    page_break()

    # contents (static; page numbers are in the PDF)
    d.add_heading("Contents", 1)
    for s in doc.sections:
        p = d.add_paragraph()
        p.paragraph_format.space_after = Pt(2)
        run(p, f"{s.number}  {s.title}", bold=True, size=10)
        for b in s.blocks:
            if b.kind == "h2" and not b.text.startswith(TOC_SKIP):
                q = d.add_paragraph()
                q.paragraph_format.left_indent = Mm(8)
                q.paragraph_format.space_after = Pt(0)
                run(q, b.text, size=8.5)
    def fig_row(grp: list):
        from PIL import Image as PILImage
        fw = (CWmm - 4) / 2
        tbl = d.add_table(rows=1, cols=3)
        row_props(tbl.rows[0])
        for ci, fb in zip((0, 2), grp):
            cell = tbl.rows[0].cells[ci]
            p0 = cell.paragraphs[0]
            p0.paragraph_format.keep_with_next = True
            p0.paragraph_format.space_after = Pt(1)
            with PILImage.open(fb.fig["png"]) as im:
                wpx, hpx = im.size
            iw = fw - 4.4                                  # less the default cell margins, or the picture runs past the cell
            p0.add_run().add_picture(fb.fig["png"], width=Mm(iw), height=Mm(iw * hpx / wpx))
            pc = cell.add_paragraph()
            pc.paragraph_format.space_after = Pt(4)
            run(pc, fb.stmts[0].text, size=7.8, color="6B6E75")
        fixed(tbl, [fw, 4, fw])
        sp = d.add_paragraph()
        sp.paragraph_format.space_after = Pt(2)

    # sections
    for s in doc.sections:
        if s.number in PAGE_BREAK_BEFORE or s.number == "1":
            page_break()
        d.add_heading(f"{s.number} {s.title}", 1)
        fig_done: set[int] = set()
        for bi, b in enumerate(s.blocks):
            nxt = s.blocks[bi + 1] if bi + 1 < len(s.blocks) else None
            if b.kind == "figure":
                if bi in fig_done:
                    continue
                grp = [b]
                if nxt is not None and nxt.kind == "figure":
                    grp.append(nxt)
                    fig_done.add(bi + 1)
                fig_row(grp)
            elif b.kind == "h2":
                d.add_heading(b.text, 2)
            elif b.kind == "p":
                p = d.add_paragraph()
                tagged(p, b.stmts[0])
                if nxt is not None and nxt.kind in ("table", "figure"):
                    p.paragraph_format.keep_with_next = True       # a paragraph that introduces a table or a figure stays with it
            elif b.kind == "bullets":
                n_ = len(b.stmts)
                for i_, x in enumerate(b.stmts):
                    p = d.add_paragraph(style="List Bullet")
                    tagged(p, x)
                    if n_ > 1 and (i_ == 0 or (n_ > 2 and i_ == n_ - 2)):
                        p.paragraph_format.keep_with_next = True      # no single item of a list alone at the foot or head of a page
            elif b.kind == "table" and b.table:
                add_table(b.table)
    d.core_properties.title = f"{doc.title} {doc.site}"
    d.core_properties.author = BRAND.name
    d.core_properties.subject = "Indicative. To be verified by a suitably qualified person."
    d.save(str(path))
    return path


# ---------------------------------------------------------------------------------------------------------------------- rasterise and pagination
def rasterise(pdf: Path, out_dir: Path, prefix: str = "page", dpi: int = 110) -> list[Path]:
    import pymupdf
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    with pymupdf.open(str(pdf)) as pd:
        for i, pg in enumerate(pd, 1):
            p = out_dir / f"{prefix}_{i:02d}.png"
            pg.get_pixmap(dpi=dpi).save(str(p))
            paths.append(p)
    import os
    for old in out_dir.glob(f"{prefix}_*.png"):          # stale pages from an earlier, longer run
        if old not in paths:
            os.remove(old)
    return paths


def page_texts(pdf: Path) -> list[str]:
    import pymupdf
    with pymupdf.open(str(pdf)) as pd:
        return [_plain(pg.get_text()) for pg in pd]


def stranded_headings(pdf: Path, headings: list[str], footer_mm: float = 27.0, header_mm: float = 18.0) -> list[dict]:
    """Pages whose last body line is a heading (or part of one): a heading stranded at the bottom of a page.  Footer and header furniture is ignored."""
    import pymupdf
    norm = [_plain(h).lower() for h in headings]
    bad = []
    with pymupdf.open(str(pdf)) as pd:
        for i, pg in enumerate(pd, 1):
            H = pg.rect.height
            y_lo, y_hi = header_mm / 25.4 * 72, H - footer_mm / 25.4 * 72
            lines = []
            for blk in pg.get_text("dict")["blocks"]:
                for ln in blk.get("lines", []):
                    y0, y1 = ln["bbox"][1], ln["bbox"][3]
                    txt = _plain("".join(s["text"] for s in ln["spans"]))
                    if txt and y0 >= y_lo and y1 <= y_hi:
                        lines.append((y1, txt))
            if not lines:
                continue
            lines.sort()
            if sum(1 for _y, t_ in lines if len(t_) >= 6 and any(t_.lower() == h or h.startswith(t_.lower()) for h in norm)) > 6:
                continue                                      # a contents page lists headings: not a stranded heading
            last = lines[-1][1].lower()
            # the last body line is a heading when a heading text starts with it, ends with it (wrapped heading) or equals it
            if len(last) >= 6 and any(h == last or h.startswith(last) or h.endswith(last) or last.startswith(h) for h in norm):
                bad.append({"page": i, "line": lines[-1][1]})
    return bad


def orphan_bullets(pdf: Path, footer_mm: float = 27.0, header_mm: float = 18.0) -> list[dict]:
    """Pages where a bullet list runs over a page break and a single bullet is left alone: one bullet at the foot of a page, or one at the head of the next.
    Bullet glyphs are counted at the start of lines (a PDF bullet or the Word list glyph).  A merged text block can only raise the count, so a result of one is a real orphan."""
    import pymupdf

    def runs(pg):
        H = pg.rect.height
        out = []
        for b in pg.get_text("blocks"):
            if b[1] < header_mm / 25.4 * 72 or b[3] > H - footer_mm / 25.4 * 72 or not b[4].strip():
                continue
            out.append(sum(1 for ln in b[4].split("\n") if ln.strip().startswith(("\u2022", "\uf0b7"))))
        return out
    bad = []
    with pymupdf.open(str(pdf)) as pd:
        prev = None
        for i, pg in enumerate(pd, 1):
            cur = runs(pg)
            if prev and cur:
                top = bot = 0
                for k in cur:                      # bullets at the head of this page, before the first block that is not a bullet
                    if not k:
                        break
                    top += k
                for k in reversed(prev):           # bullets at the foot of the previous page
                    if not k:
                        break
                    bot += k
                if top and bot and (top == 1 or bot == 1):
                    bad.append({"page": i, "bullets_at_foot_of_previous_page": bot, "bullets_at_head": top})
            prev = cur
    return bad


def docx_to_pdf(docx: Path, out_dir: Path) -> Path | None:
    exe = shutil.which("soffice") or shutil.which("libreoffice")
    if not exe:
        return None
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run([exe, "--headless", "--convert-to", "pdf", "--outdir", str(out_dir), str(docx)], check=True, capture_output=True, timeout=240)
    except Exception:  # noqa: BLE001
        return None
    p = out_dir / (docx.stem + ".pdf")
    return p if p.exists() else None


def write_all(doc: SiteSoee, out: Path, png: bool = True) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    res = {"json": str(write_json(doc, out / "soee.json")), "pdf": str(write_pdf(doc, out / "soee.pdf")), "docx": str(write_docx(doc, out / "soee.docx"))}
    hs = doc.headings()
    res["pdf_stranded_headings"] = stranded_headings(Path(res["pdf"]), hs)
    res["pdf_orphan_bullets"] = orphan_bullets(Path(res["pdf"]))
    if png:
        res["pages"] = [str(p) for p in rasterise(Path(res["pdf"]), out / "pages", "soee")]
        dp = docx_to_pdf(Path(res["docx"]), out / "docx_check")
        if dp:
            res["docx_pdf"] = str(dp)
            res["docx_stranded_headings"] = stranded_headings(dp, hs)
            res["docx_orphan_bullets"] = orphan_bullets(dp)
            res["docx_pages"] = [str(p) for p in rasterise(dp, out / "docx_check", "docx")]
    return res
