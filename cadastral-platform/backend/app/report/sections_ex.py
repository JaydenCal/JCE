"""Explanatory sections: How to read this report, Buffers explained, Layer guide, Glossary, Data sources and limitations."""
from __future__ import annotations

from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import CondPageBreak, KeepTogether, PageBreak, Paragraph, Spacer, Table, TableStyle

from app.report import catalogue as CAT
from app.report import explain as EX
from app.report import fmt, theme as T
from app.report.acks import ACK_TEXT
from app.report.blocks import KS, Bookmark, Chip, P, block, callout, grid_table, st
from app.report.diagrams import BufferDiagram
from app.report.sections import LEGAL, NOT_CLEAR, Ctx, _chip_cell, _dist_text, _sh, ai_banner, screening_info

CW = T.CW


def _dots(items: list[str]) -> list:
    return [Paragraph(fmt.esc(x), st()["bullet"], bulletText="•") for x in items]


# ------------------------------------------------------------------ How to read this report
def how_to_read(ctx: Ctx) -> list:
    fl = _sh(ctx, "How to read this report", "What the report is, what it is not, and what each result means in plain words.")
    fl += [P("WHAT THIS REPORT IS", "label"), KS(2)] + _dots(EX.ABOUT_IS)
    fl += [Spacer(1, 2 * mm), P("WHAT THIS REPORT IS NOT", "label"), KS(2)] + _dots(EX.ABOUT_IS_NOT)
    fl += [Spacer(1, 2 * mm), ai_banner(), Spacer(1, 3 * mm)]
    rows = []
    for term, kind, words in EX.RESULT_TERMS:
        chip = Chip(term.split(" (")[0].replace("NOT INTERSECTED BY THE DATA LOADED", "Not intersected").replace("ASSUMED / PLATFORM DEFAULT", "Assumed"), kind, h=10, size=5.6)
        rows.append([[chip], [P(term, "cellb"), P(words, "cell")]])
    fl += [KeepTogether([P("WHAT EACH RESULT MEANS", "label"), KS(2),
                         _plain_table(rows, [30 * mm, CW - 30 * mm])])]
    fl += [Spacer(1, 3 * mm), KeepTogether([P("HOW A CONSTRAINT PAGE IS LAID OUT", "label"), KS(2)] + _dots([
        "A figure with the lot outline, the mapped feature, the screening buffer ring and, where a feature is inside the ring, a distance line marked d.",
        "A caption stating the screening distance used and whether it is a screening setting, a cited rule or UNRESOLVED.",
        "A reference to the matching map extract in the Planning maps section (every layer screened, and the zoning, has one).",
        "RESULT FOR THIS LOT, then WHAT THIS IS, WHY IT MATTERS and WHAT TO DO NEXT.",
        "Layers with no map page are explained in the Layer guide, with the same four parts."]))]
    return fl


def _plain_table(rows, widths) -> Table:
    t = Table(rows, colWidths=widths)
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -1), 0.4, T.RULE), ("TOPPADDING", (0, 0), (-1, -1), 4),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 4), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 4)]))
    return t


# ------------------------------------------------------------------ Buffers explained
def buffers_explained(ctx: Ctx) -> list:
    fl = _sh(ctx, "Buffers explained", "Why a feature that does not touch the lot can still be reported, and what the distance number means.")
    fl += [P("WHAT A BUFFER IS", "label"), KS(2)] + [P(x, "body") for x in EX.BUFFER_WHAT]
    fl += [Spacer(1, 1 * mm), KeepTogether([BufferDiagram(), P("<b>Diagram.</b> Schematic only, not to scale and not based on any value. The same ring is drawn on each "
                                                                   "constraint page, at the screening distance for that layer.", "caption", raw=True)])]
    fl += [P("WHY A LAYER IS SCREENED WITH A DISTANCE", "label"), KS(2)] + [P(x, "body") for x in EX.BUFFER_WHY]
    fl += [Spacer(1, 1 * mm), P("INTERSECTS COMPARED WITH WITHIN BUFFER", "label"), KS(2)]
    rows = [[P(a, "cellb"), P(b, "cell")] for a, b in EX.BUFFER_VS]
    fl.append(_plain_table(rows, [48 * mm, CW - 48 * mm]))
    fl += [Spacer(1, 2 * mm), P("WHAT THE DISTANCE NUMBER IS", "label"), KS(2)] + _dots(EX.BUFFER_NUMBER)
    rows = [[P(a.upper(), "cellb"), P(b, "cell")] for a, b in EX.BUFFER_STATUS]
    fl += [Spacer(1, 2 * mm), KeepTogether([
        P("WHERE THE SCREENING DISTANCE COMES FROM", "label"), KS(2),
        P(f"Each distance is a PLATFORM SCREENING SETTING taken from {EX.SETTINGS_NAME}. It is a screening setting and is not a statutory requirement. "
          "It changes only if a cited requirement supplies a different figure for that layer. Each constraint page states which of the following applies.", "body"),
        _plain_table(rows, [48 * mm, CW - 48 * mm])])]
    # per-layer table for this run
    lay = [f for f in ctx.findings]
    if lay:
        fl += [Spacer(1, 3 * mm), P("SCREENING DISTANCES USED IN THIS RUN", "label"), KS(2)]
        rows = []
        for f in sorted(lay, key=lambda f: (-f.buffer_m, f.rank, f.short)):
            _, status = screening_info(ctx, f)
            d = f"{f.buffer_m:g} m" if f.buffer_m else "None (overlap only)"
            rows.append([P(f.short, "cell"), P(d, "cellb"), P(status, "cell")])
        fl.append(grid_table(["Layer", "Screening distance", "Status"], rows, [CW - 90 * mm, 40 * mm, 50 * mm], zebra=True))
        fl.append(P(f"Data is loaded for the lot plus a margin of {EX.LOAD_MARGIN_M} m (a platform setting). "
                    "A layer with no screening distance reports only features that intersect the lot; a nearest distance may still be shown for information.", "caption"))
    return fl


# ------------------------------------------------------------------ Layer guide
def layer_guide(ctx: Ctx) -> list:
    fs = sorted(ctx.findings, key=lambda f: (f.rank, f.short))
    paged = [f for f in fs if f.has_page]
    rest = [f for f in fs if not f.has_page]
    fl = _sh(ctx, "Layer guide", "Every layer screened in this run, explained in the same four parts: result, what it is, why it matters and what to do next.")
    if paged:
        fl.append(P("Layers with a constraint page: " + "; ".join(f.short for f in paged) + ". Their explanation is on the constraint page.", "muted"))
        fl.append(Spacer(1, 2 * mm))
    for f in rest:
        ex = EX.layer_explain(f.key)
        head = Table([[_chip_cell(f), P(f.short, "h3")]], colWidths=[30 * mm, CW - 30 * mm],
                     style=TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0),
                                       ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
        res = f.headline if f.status != "unchecked" else f"NOT CHECKED. {f.why_unchecked} Not checked is not clear."
        src = P("Source: " + EX.source_line(f.meta, f.host), "muted")
        mp_ = ctx.map_for(f.key)
        if mp_:
            res += f" Map: refer Figure {mp_.number}, {mp_.title}."
        rows = [[P("RESULT", "labelm"), P(res, "cell")], [P("WHAT THIS IS", "labelm"), P(ex["what"], "cell")],
                [P("WHY IT MATTERS", "labelm"), P(ex["why"], "cell")], [P("WHAT TO DO NEXT", "labelm"), P(ex["next"], "cell")],
                [P("SOURCE", "labelm"), src]]
        t = Table(rows, colWidths=[28 * mm, CW - 28 * mm])
        t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -1), 0.3, T.RULE), ("TOPPADDING", (0, 0), (-1, -1), 2.4),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 2.4), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 3)]))
        fl += [KeepTogether([head, Spacer(1, 1.5), t]), Spacer(1, 3.5 * mm)]
    return fl


# ------------------------------------------------------------------ Glossary
def glossary(ctx: Ctx) -> list:
    fl = _sh(ctx, "Glossary", "Terms used in this report and in the JCESITE plan set. Definitions are general and carry no local values.")
    rows = [[P(a, "cellb"), P(b, "cell")] for a, b in sorted(EX.GLOSSARY, key=lambda x: x[0].lower())]
    fl.append(grid_table(["Term", "Definition"], rows, [44 * mm, CW - 44 * mm], zebra=True))
    return fl


# ------------------------------------------------------------------ Data sources and limitations
def data_limits(ctx: Ctx) -> list:
    m = ctx.meta
    fl = _sh(ctx, "Data sources and limitations", "What data this run used, what it did not use, and who must check the result.")
    fl += [Spacer(1, 3.5 * mm), P("A. DATA SOURCES USED IN THIS RUN", "label"), KS(2)]
    rows = []
    seen = set()
    for f in ctx.findings:
        if f.status == "unchecked":
            continue
        key = (f.source_name, f.currency_raw)
        if key in seen:
            continue
        seen.add(key)
        c = fmt.parse_currency(f.currency_raw)
        pub = (f.meta.get("copyright") or "").strip()
        rows.append([P(f.source_name, "cell"), P(f.short, "cell"), P(fmt.hdate(c["source"], "not published"), "cell"), P(fmt.hdate(c["fetched"], "DATA NOT AVAILABLE"), "cell"),
                     P(fmt.shorten_quote(pub, 170) if pub else EX.SOURCE_NOT_RECORDED, "cellm")])
    if rows:
        fl.append(grid_table(["Service / layer", "Used for", "Mapping date", "Retrieved", "Publisher or copyright"], rows, [46 * mm, 32 * mm, 20 * mm, 18 * mm, CW - 116 * mm]))
    else:
        fl.append(P("DATA NOT AVAILABLE: no constraint layer could be queried in this run, so no constraint data source was used.", "body"))
    ext = []
    ims = [x for x in ctx.figures if x["aerial"]]
    if ctx.imagery is not None and ims:
        lic = getattr(ctx.imagery, "licence", None)
        ext.append(["Aerial imagery", lic.attribution if lic else EX.SOURCE_NOT_RECORDED, fmt.hdate(ims[0]["imagery_date"], "date not published"), (lic.licence_note if lic else "")])
    else:
        ext.append(["Aerial imagery", "DATA NOT AVAILABLE for this run (vector figures only).", "-", ""])
    flags = [x for x in (m.get("flags") or []) if x]
    ext.append(["Lot boundary (cadastre)", "Boundary geometry supplied to this run" + (". OFFLINE FIXTURE, not live data." if "offline_fixture" in flags else ".")
                + " Publisher and date: " + EX.SOURCE_NOT_RECORDED + ". Indicative, not a survey.", "-", ""])
    tr = (ctx.inp.civil or {}).get("terrain")
    if tr:
        ext.append(["Ground levels (DEM)", fmt.clean(tr.get("source", EX.SOURCE_NOT_RECORDED)) + ". " + fmt.clean(tr.get("copyright", "")), "-", ""])
    else:
        ext.append(["Ground levels (DEM)", "DATA NOT AVAILABLE for this run.", "-", ""])
    if ctx.inp.requirements:
        docs = sorted({(r.get("source") or {}).get("document_title", "") for r in ctx.inp.requirements} - {""})
        ext.append(["Council requirements", "Cited line by line in the Council requirements section. Documents: " + "; ".join(docs[:4]) + ". Extracted automatically.", "-", ""])
    else:
        ext.append(["Council requirements", "DATA NOT AVAILABLE: no cited requirements were loaded for this council.", "-", ""])
    fl += [Spacer(1, 2), grid_table(["Other sources", "Attribution", "Date", "Licence note"], [[P(a, "cell"), P(b, "cellm"), P(c, "cell"), P(d, "cellm")] for a, b, c, d in ext],
                                    [38 * mm, CW - 38 * mm - 22 * mm - 38 * mm, 22 * mm, 38 * mm], zebra=False)]
    fl += [Spacer(1, 2), P(f"Report date: {fmt.hdate(m.get('date'), 'DATA NOT AVAILABLE')}. Run flags: {', '.join(x.replace('_', ' ').upper() for x in flags) if flags else 'none'}. "
                           "Development type is recorded only as a run setting used to select requirement sets; no building has been assessed.", "muted")]

    fl += [Spacer(1, 3.5 * mm), P("B. METHOD", "label"), KS(2)]
    fl += _dots(["The lot boundary is intersected with each mapped layer in metric map grid coordinates. INTERSECTS means a mapped feature overlaps the lot.",
                 "WITHIN BUFFER means no overlap, but a mapped feature lies inside the screening distance measured from the lot boundary. See Buffers explained.",
                 "NOT INTERSECTED BY THE DATA LOADED means no feature was found on or within the screening distance of the lot, in that layer only. NOT CHECKED means the layer could not be queried.",
                 "Requirement values appear only when cited to a document. Otherwise the item is shown as UNRESOLVED. Platform defaults and user entered values are labelled ASSUMED / PLATFORM DEFAULT where they are shown.",
                 "Figures show the lot over aerial imagery where available, with mapped features clipped to the figure window."])

    fl += [Spacer(1, 3.5 * mm), P("C. RESOLUTION AND CURRENCY CAVEATS", "label"), KS(2)]
    cav = ["Ground levels come from a 5 m DEM where one was loaded. A 5 m grid is coarse for a small lot and cannot show small level changes. "
           "Commission a detail survey before relying on any level.",
           "The aerial date is shown on each figure. Where the date is not published it is not assumed, and the image may be years old.",
           "Cadastral boundaries are indicative. Mapped features have their own positional accuracy, which is not stated in the data loaded."]
    for f in ctx.findings:
        if f.caveat and f.status in ("clear", "affected", "nearby", "mapped"):
            cav.append(f"{f.short}: {f.caveat}")
    fl += _dots(cav)

    fl += [Spacer(1, 3.5 * mm), P("D. WHAT WAS NOT CHECKED", "label"), KS(2)]
    nc = [f for f in ctx.findings if f.status == "unchecked"]
    nchk = ["Layers not queried in this run: " + ("; ".join(f.short.lower() for f in nc) + ". Not checked is not clear." if nc else "none."),
            "Not covered at all: easements, covenants, underground services, council flood studies, local council overlays and DCP maps, unless stated in a result above.",
            "Not assessed: any building, footprint, floor level, setback or approval pathway."]
    fl += _dots(nchk)
    fl.append(callout(NOT_CLEAR, "red"))

    fl += [Spacer(1, 3.5 * mm), KeepTogether([P("E. SIGN OFF AND QUALIFIED PERSON", "label"), KS(2)] + _dots(EX.SIGN_OFF) + [Spacer(1, 2 * mm), ai_banner()])]

    fl += [Spacer(1, 3.5 * mm), P("F. ACKNOWLEDGEMENTS", "label"), KS(2)]
    acks = [a for a in ctx.inp.acknowledgements if a in ACK_TEXT]
    if acks:
        fl.append(P("Acknowledgements given by the user (Terms and Conditions, Schedule A) before this report was produced.", "muted"))
        rows = [[P(ACK_TEXT[a][0], "label"), P(ACK_TEXT[a][2], "cell")] for a in acks]
        fl.append(grid_table(["Ref", "Acknowledgement"], rows, [12 * mm, CW - 12 * mm], zebra=False))
    else:
        fl.append(P("No acknowledgements were recorded for this report.", "body"))
    fl += [Spacer(1, 3.5 * mm), P("G. LEGAL STATEMENT", "label"), KS(2), callout(LEGAL, "ink")]
    return fl
