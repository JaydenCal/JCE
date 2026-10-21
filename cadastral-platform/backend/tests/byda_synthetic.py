"""SYNTHETIC BYDA responses for tests and demonstrations (stage 8).  EVERYTHING HERE IS INVENTED: the owners, the job number, the dates and the "plans".  Every page carries the text
"SYNTHETIC TEST DATA" so a person (and the importer) can tell it from a real BYDA download.  Nothing here is a real service, asset owner response or site.

``combined_pdf`` builds a single PDF laid out like the combined BYDA download (page 1 job table, page 2 confirmation, one section per owner with a cover page listing its files and pages),
``owner_folder`` builds the same data as BYDA/<owner>/<files> plus byda_status.md.
"""
from __future__ import annotations

from pathlib import Path

import pymupdf

JOB = "99000001"
PLAN_DATE_TEXT = "Thu 15 Oct 2026 10.11am"
EXPIRES_TEXT = "12 Nov 2026"
STAMP = "SYNTHETIC TEST DATA: NOT A REAL BYDA RESPONSE"
OWNERS = [                                       # name, status, plans?, validity days stated on the body page
    ("SYNTHETIC Power Co (99001)", "Received", True, 28),
    ("SYNTHETIC Water Authority", "Received", True, 30),
    ("SYNTHETIC Telecom", "Received", False, 60),
    ("SYNTHETIC Gas Co", "Pending", False, None),
]


def _page(doc, lines: list[str], draw_lines: int = 0, image: bool = False):
    p = doc.new_page(width=595, height=842)
    y = 60
    for ln in lines:
        p.insert_text((50, y), ln, fontsize=10)
        y += 16
    if draw_lines:
        for i in range(draw_lines):
            x = 40 + (i * 7) % 500
            yy = 300 + (i * 11) % 400
            p.draw_line((x, yy), (x + 20, yy + 6 + (i % 5)), width=0.4)
    if image:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 400, 400), False)
        pix.set_rect(pix.irect, (225, 235, 245))
        p.insert_image(pymupdf.Rect(20, 120, 575, 800), pixmap=pix)
    p.insert_text((50, 830), STAMP, fontsize=8)
    return p


def combined_pdf(path: Path, owners=OWNERS) -> dict[str, tuple[int, int]]:
    """Write the combined PDF.  Returns {owner name: (first page, last page)} (1-based) as laid out, so tests can compare the importer's parsed table with the truth."""
    doc = pymupdf.open()
    sections: list[tuple[str, str, str, bool, int | None, int]] = []
    pg = 3                                                                     # page 1 summary, page 2 BYDA confirmation
    for name, status, plans, days in owners:
        n_pages = 1 + 1 + (1 if plans else 0)                                  # cover, response body, plan
        sections.append((name, status, "", plans, days, pg))
        pg += n_pages
    row_lines = []
    for name, status, _p, _d, _days, start in [(s[0], s[1], s[2], s[3], s[4], s[5]) for s in sections]:
        row_lines += [name, status, str(start)]
    _page(doc, ["Job ID " + JOB, "SYNTHETIC LEAD 1 Test Street", "Review responses online", f"Received {sum(1 for o in owners if o[1] == 'Received')} of {len(owners)} responses", "1 Test Street, Testville NSW 2000",
                "Job dates", "15/10/2026 → 14/11/2026", "These plans expire on", EXPIRES_TEXT, "Lodged by", "SYNTHETIC Person", "Authority", "Status", "Page", "BYDA Confirmation", "2", *row_lines,
                "Created for SYNTHETIC Person at Thu 15 October 2026 11.08 am", STAMP])
    _page(doc, ["BYDA Confirmation", "SYNTHETIC confirmation page"])
    spans: dict[str, tuple[int, int]] = {}
    for name, status, _x, plans, days, start in sections:
        base = name.split(" (")[0]
        files = [("Response Body", start + 1)] + ([(base + " plan.pdf", start + 2)] if plans else [])
        cover = ["Job ID " + JOB, name, "Referral", f"9{start:08d}", "Responses from this member", "Response received " + PLAN_DATE_TEXT, "File name", "Page"]
        for fn, fp in files:
            cover += [fn, str(fp)]
        if not plans and days is not None:
            cover += [base + ".dwf", "Excluded"]
        cover += ["Created for SYNTHETIC Person at Thu 15 October 2026 11.08 am"]
        _page(doc, cover)
        _page(doc, ["Response", f"Plans are valid for {days} days from the date of issue." if days else "Response pending."])
        if plans:
            _page(doc, [f"SYNTHETIC PLAN {base}", "NOT REAL SERVICES"], draw_lines=300)
        spans[base] = (start, start + len(files))
    doc.save(str(path))
    return spans


def owner_folder(root: Path, owners=OWNERS) -> Path:
    """BYDA/<owner>/plan.pdf (vector) plus byda_status.md.  Returns the BYDA folder."""
    byda = Path(root) / "BYDA"
    byda.mkdir(parents=True, exist_ok=True)
    rows = []
    for name, status, plans, days in owners:
        base = name.split(" (")[0]
        rows.append(f"| {base} | {status} |")
        if plans:
            d = byda / base
            d.mkdir(exist_ok=True)
            doc = pymupdf.open()
            _page(doc, [f"SYNTHETIC PLAN {base}", f"Plans are valid for {days} days from the date of issue."], draw_lines=300)
            doc.save(str(d / "plan.pdf"))
    (byda / "byda_status.md").write_text("\n".join([
        f"# BYDA Job {JOB} (enquiry 99000002), lodged 15/10/2026", "", "SYNTHETIC TEST DATA: NOT A REAL BYDA RESPONSE", "", "Job dates 15/10/2026 to 14/11/2026", "Plans valid until 12/11/2026", "",
        "| Owner | Status |", "|---|---|", *rows, ""]), encoding="utf-8")
    return byda
