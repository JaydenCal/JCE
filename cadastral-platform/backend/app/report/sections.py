"""Content of each report section, returned as lists of platypus flowables."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, PageBreak, Paragraph, Spacer, Table, TableStyle
from shapely import wkt as _wkt

from app.report import catalogue as CAT
from app.report import fmt, theme as T
from app.report.acks import ACK_TEXT
from app.report.blocks import Chip, P, Rule, block, callout, grid_table, kv_table, section_head, st
from app.report.figures import Layer, make_map, nearest_pair
from app.report.findings import Finding, control_value
from app.report.inputs import SiteReportInputs

CW = T.CW
NOT_CLEAR = ("Not checked is not clear. A layer marked 'Not checked' could not be queried, so the site may well be affected. "
             "It must be checked with the council before design or purchase decisions are made.")
LEGAL = ("This report is informational and indicative only. It is not a planning certificate under section 10.7 of the NSW "
         "Environmental Planning and Assessment Act 1979, and it is not a council property or planning report. Mapping data may be out "
         "of date, incomplete or inaccurate, and cadastral boundaries are not a survey. Verify every matter with the relevant council "
         "and authority, and use a registered surveyor, a qualified engineer and an accredited certifier where their sign-off is needed.")


@dataclass
class Ctx:
    inp: SiteReportInputs
    findings: list[Finding]
    lot: object
    imagery: object
    brand: object
    dev_key: str
    zone: str | None
    lga: str
    fig_no: int = 0
    figures: list[dict] = field(default_factory=list)

    def next_fig(self) -> int:
        self.fig_no += 1
        return self.fig_no

    @property
    def meta(self) -> dict:
        return self.inp.meta

    @property
    def lot_label(self) -> str:
        return fmt.lot_label(self.meta.get("lotplan", ""))

    def f(self, key: str) -> Finding | None:
        return next((x for x in self.findings if x.key == key), None)


def _chip_cell(f: Finding):
    kind = {"affected": "affected", "nearby": "nearby", "clear": "clear", "unchecked": "unchecked", "mapped": "mapped", "notmapped": "clear"}[f.status]
    return Chip(f.chip, kind)


def _caption(ctx: Ctx, n: int, text: str, fig) -> Paragraph:
    return P(f"<b>Figure {n}.</b> {fmt.esc(text)} {fmt.esc(fig.imagery_line)}", "caption", raw=True)


# ------------------------------------------------------------------ requirements helpers
def _unit(u: str | None) -> str:
    return {None: "", "m": " m", "m2": " m²", "m3": " m³", "percent": "%", "L": " L", "mm": " mm", "AUD": " AUD", "count": "",
            "ratio (1 in N)": " (1 in N)"}.get(u, f" {u}" if u else "")


def req_label(key: str) -> str:
    parts = key.split(".")
    last = re.sub(r"_(m2|m3|m|mm|l|pct|percent)$", "", parts[-1]) if len(parts) > 1 else parts[0]
    segs = parts[:-1] + [last] if len(parts) > 1 else [last]
    segs = [s.replace("_", " ") for s in segs]
    words = {"min": "minimum", "max": "maximum", "aep pct": "AEP", "gt": ">", "lt": "<", "lot gt 900m2": "lot over 900 m²",
             "rwt": "rainwater tank", "osd": "on-site detention", "cdc": "complying development", "basix": "BASIX", "dcp": "DCP"}
    def fix(s):
        return " ".join(words.get(w, w) for w in s.split(" "))
    head = segs[0].capitalize() if segs[0] not in ("rwt", "basix") else words[segs[0]].capitalize()
    tail = ", ".join(fix(s) for s in segs[1:])
    return fmt.clean(f"{head}: {tail}" if tail else head)


def req_value(r: dict) -> tuple[str, str]:
    v = r.get("value")
    rule = (r.get("value_struct") or {}).get("rule")
    if v is None:
        return "Not resolved", ""
    if isinstance(v, bool):
        return ("Yes / required" if v else "No"), ""
    if isinstance(v, (int, float)):
        s = f"{v:g}{_unit(r.get('unit'))}"
    else:
        s = fmt.clean(v)
    return s, (fmt.clean(rule) if rule and fmt.clean(rule) != s else "")


GROUPS = [("setback", "Setbacks"), ("secondary_dwelling", "Secondary dwelling"), ("outbuilding", "Outbuildings and carports"),
          ("carport", "Outbuildings and carports"), ("farm_building", "Outbuildings and carports"), ("parking", "Parking, access and driveway"),
          ("access", "Parking, access and driveway"), ("driveway", "Parking, access and driveway"), ("flood", "Flood"), ("bushfire", "Bushfire"),
          ("water", "Water, sewer, stormwater and rainwater tanks"), ("sewer", "Water, sewer, stormwater and rainwater tanks"),
          ("stormwater", "Water, sewer, stormwater and rainwater tanks"), ("rwt", "Water, sewer, stormwater and rainwater tanks"),
          ("util", "Water, sewer, stormwater and rainwater tanks"), ("utilities", "Water, sewer, stormwater and rainwater tanks"),
          ("basix", "BASIX"), ("site", "Site")]
GROUP_ORDER = ["Setbacks", "Secondary dwelling", "Outbuildings and carports", "Parking, access and driveway", "Flood", "Bushfire",
               "Water, sewer, stormwater and rainwater tanks", "BASIX", "Site", "Other"]


def relevant_requirements(reqs: list[dict], zone: str | None, dev: str) -> list[dict]:
    out = []
    for r in reqs:
        k = r["key"]
        z = (r.get("applies_to") or {}).get("zone")
        if z and zone and z.upper() != zone.upper():
            continue
        top = k.split(".")[0]
        el = k.split(".")[1] if k.count(".") >= 1 else ""
        if top == "setback" and el not in ({"dwelling_house": ("dwelling_house",), "secondary_dwelling": ("secondary_dwelling",), "shed": ("outbuilding",)}.get(dev, (dev,))):
            if not (dev == "shed" and el in ("farm_building",) and zone and zone.startswith("RU")):
                continue
        if top == "secondary_dwelling" and dev != "secondary_dwelling":
            continue
        if top in ("outbuilding", "carport", "farm_building", "stormwater") and k.startswith(("outbuilding", "carport", "farm_building")) and dev != "shed":
            continue
        if top == "parking" and el != dev and el != "":
            continue
        if top == "basix" and dev == "shed":
            continue
        out.append(r)
    return out


def group_of(key: str) -> str:
    top = key.split(".")[0]
    return next((g for p, g in GROUPS if p == top), "Other")


def _src_cell(r: dict) -> list:
    s = r.get("source") or {}
    if not s:
        return [P("No citation", "cellm")]
    t = (s.get("document_title") or "").replace("Gunnedah Shire Council ", "GSC ")
    bits = [f"{t}" + (f", p.{s['page']}" if s.get("page") else "") + (f", {s['section_ref']}" if s.get("section_ref") else "")]
    q = fmt.clean(s.get("quote") or "")
    out = [P(bits[0], "cellm")]
    if q:
        out.append(P("“" + (q if len(q) <= 150 else q[:147].rstrip() + "...") + "”", "cellm"))
    return out


# ------------------------------------------------------------------ 1 cover content (drawn partly on canvas)
def cover_flow(ctx: Ctx) -> list:
    m, S = ctx.meta, st()
    dev = m.get("development_type", "not stated")
    fl = [Spacer(1, 3 * mm), P("SITE ASSESSMENT AND PLANNING CONSTRAINTS", "label"), Spacer(1, 2),
          Paragraph("Site Assessment and Planning Constraints Report", T.styles()["h1"].clone("cov", fontSize=26, leading=29, spaceAfter=3)),
          P(f"{ctx.lot_label}" + (f", {ctx.lga}" if ctx.lga else ""), "lead"), Spacer(1, 1)]
    hero = make_map(ctx.lot, ctx_m=45, width=CW, height=98 * mm, srid=ctx.inp.srid, imagery=ctx.imagery,
                    neighbours=[], footprint=None, show_labels=False, compact=True, max_px=1800,
                    layers=[])
    n = ctx.next_fig()
    ctx.figures.append(_fig_record(n, "Site aerial", hero))
    fl += [hero.flowable(), _caption(ctx, n, f"{ctx.lot_label}: site context. Lot boundary from NSW cadastre (indicative, not a survey).", hero), Spacer(1, 2)]
    area = m.get("area_m2")
    rows = [("Project", m.get("project_title") or f"{ctx.lot_label} {dev}"), ("Lot / plan", ctx.lot_label), ("Council (LGA)", ctx.lga or "Not determined"),
            ("Zone", zone_text(ctx)), ("Site area", fmt.area(area) if area else "Not stated"), ("Development", dev.capitalize() if dev else "Not stated"),
            ("Report date", fmt.hdate_long(m.get("date"))), ("Status", "DRAFT, indicative"), ("Prepared by", ctx.brand.company_name)]
    cells = []
    for i in range(0, len(rows), 3):
        row = []
        for k, v in rows[i:i + 3]:
            row.append([P(k.upper(), "labelm"), Paragraph(fmt.esc(v), S["cellb"])])
        cells.append(row)
    t = Table(cells, colWidths=[CW / 3] * 3)
    t.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.9, T.INK), ("INNERGRID", (0, 0), (-1, -1), 0.4, T.RULE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                           ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4), ("LEFTPADDING", (0, 0), (-1, -1), 6),
                           ("BACKGROUND", (0, 0), (-1, -1), T.PAPER)]))
    fl += [t, Spacer(1, 3 * mm),
           P("Draft for discussion. Mapping data is indicative and unverified; this is not a section 10.7 planning certificate or a council "
             "property report. See the legal statement and limits in the appendix.", "muted")]
    return fl


def zone_text(ctx: Ctx) -> str:
    z = ctx.zone
    if not z:
        return "Not determined"
    nm = CAT.ZONES.get(z.upper())
    return f"{z} {nm}" if nm else z


def _fig_record(n: int, title: str, fig) -> dict:
    return {"figure": n, "title": title, "aerial": bool(fig.image), "imagery_date": fig.capture_date, "note": fig.note}


# ------------------------------------------------------------------ 2 executive summary
IMPLIC = {
    "nsw_flood": "Expect controls on the minimum floor level, filling of land, building materials and evacuation.",
    "nsw_bushfire_habitable": "A habitable building here will need a Bushfire Attack Level (BAL) assessment (AS 3959) and compliance with Planning for Bush Fire Protection.",
    "nsw_bushfire_shed": "Bushfire rules for a Class 10a shed differ from a house; confirm what applies with the certifier.",
    "nsw_heritage_item": "Consent and a heritage impact statement are usually needed.",
    "nsw_heritage_conservation": "Consent and a heritage impact statement are usually needed.",
    "nsw_acid_sulfate": "Excavation below the mapped level may need an acid sulfate soils management plan.",
    "nsw_biodiversity": "Clearing may trigger the Biodiversity Offsets Scheme.",
}


def implication(ctx: Ctx, f: Finding) -> str:
    if f.key == "nsw_bushfire":
        return IMPLIC["nsw_bushfire_shed" if ctx.dev_key == "shed" else "nsw_bushfire_habitable"]
    if f.key in IMPLIC:
        return IMPLIC[f.key]
    if f.trigger and f.trigger.next_steps:
        return f.trigger.next_steps[0] + "."
    return f.action


def freeboard_req(ctx: Ctx) -> dict | None:
    return next((r for r in ctx.inp.requirements if r["key"] == "flood.freeboard_m" and r.get("value") is not None), None)


def _cite_short(r: dict) -> str:
    s = r.get("source") or {}
    t = (s.get("document_title") or "").replace("Gunnedah Shire Council ", "Gunnedah ")
    return f"{t}, p.{s.get('page')}" if s.get("page") else t


def count_unresolved(ctx: Ctx) -> int:
    n = 0
    for t in ctx.inp.triggers:
        if t.rule_id == "generic":
            continue
        n += sum(1 for c in t.consequences if c.status != "resolved")
    return n


def summary_findings(ctx: Ctx) -> list[tuple[str, str, str]]:
    out: list[tuple[str, str, str]] = []
    act = sorted([f for f in ctx.findings if f.status == "affected" and f.key not in CAT.INFO_KEYS], key=lambda f: f.rank)
    near = sorted([f for f in ctx.findings if f.status == "nearby"], key=lambda f: f.rank)
    for f in act + near:
        out.append((f.status, f.short, f"{f.headline} {implication(ctx, f)}"))
    # planning controls
    bits = []
    if ctx.zone:
        bits.append(f"zoned {zone_text(ctx)}")
    for key, lab in (("nsw_lot_size_map", "minimum lot size"), ("nsw_fsr_map", "floor space ratio"), ("nsw_height_map", "maximum building height")):
        v = control_value(ctx.findings, key)
        if v and v != "not mapped":
            bits.append(f"{lab} {v}")
        elif v == "not mapped":
            bits.append(f"no mapped {lab} control")
    if bits:
        extra = " Two lot size classes are mapped over the lot; confirm which applies with council." if len((ctx.f("nsw_lot_size_map") or Finding("", "", "", "", "", "", 0)).rows) > 1 else ""
        out.append(("mapped", "Zoning and planning controls", "The lot is " + "; ".join(bits) + "." + extra))
    fl = ctx.f("nsw_flood")
    if fl and fl.status == "clear":
        fb = freeboard_req(ctx)
        txt = fl.headline
        if fb:
            txt += f" If council gives a flood level, the minimum floor level is that level plus {fb['value']:g} m freeboard ({_cite_short(fb)})."
        out.append(("nearby", "Flood: not mapped, but check", txt))
    nc = [f for f in ctx.findings if f.status == "unchecked"]
    if nc:
        out.append(("unchecked", f"{len(nc)} layers not checked", "These could not be queried and must be checked manually: " + "; ".join(f.short.lower() for f in nc) + ". Not checked is not clear."))
    return out


def next_actions(ctx: Ctx) -> list[str]:
    instr = None
    acts: list[str] = []
    for t in ctx.inp.triggers:
        for s in t.next_steps:
            if s.startswith("Obtain the s10.7"):
                instr = s
    acts.append(f"Obtain the s10.7 planning certificate for {ctx.lot_label} from council and confirm every layer below against it.")
    seen = {acts[0]}
    for t in sorted(ctx.inp.triggers, key=lambda t: (t.layer_key == "development_type", CAT.LAYERS.get(t.layer_key, {}).get("rank", 8))):
        if t.rule_id == "generic":
            continue
        for s in t.next_steps:
            if s.startswith("Obtain the s10.7") or s in seen:
                continue
            seen.add(s); acts.append(s.rstrip(".") + ".")
    fl = ctx.f("nsw_flood")
    if fl and fl.status == "clear":
        acts.append("Ask council for flood information for the lot (flood planning level or flood certificate), even though no flood planning area is mapped.")
    nc = [f for f in ctx.findings if f.status == "unchecked"]
    if nc:
        acts.append("Check the layers marked 'Not checked' directly with council: " + "; ".join(f.short.lower() for f in nc) + ".")
    low = [r for r in relevant_requirements(ctx.inp.requirements, ctx.zone, ctx.dev_key) if r.get("confidence", 1) < 0.75 or r.get("status") != "resolved"]
    if low or ctx.inp.unresolved_requirements:
        acts.append("Confirm the flagged council requirements (low confidence or not found) with council planning staff.")
    acts.append("Engage a registered surveyor for an identification and detail survey before design is finalised.")
    return acts[:9]


def exec_summary(ctx: Ctx) -> list:
    S = st()
    fl = section_head("02", "What matters for this site", None)
    # traffic light tiles
    cnt = {k: sum(1 for f in ctx.findings if f.status in ks) for k, ks in
           (("affected", ("affected",)), ("nearby", ("nearby",)), ("clear", ("clear", "notmapped")), ("unchecked", ("unchecked",)), ("mapped", ("mapped",)))}
    tiles = []
    for lab, kind, n in (("Affected", "affected", cnt["affected"]), ("Nearby", "nearby", cnt["nearby"]), ("Not affected", "clear", cnt["clear"]),
                         ("Not checked", "unchecked", cnt["unchecked"]), ("To be confirmed", "unresolved", count_unresolved(ctx))):
        fg, bg = T.STATUS_COL[kind]
        tiles.append([Paragraph(f'<font name="Jost-Bold" size="20" color="{fg}">{n}</font>', S["body"]),
                      Paragraph(f'<font name="Mono-Medium" size="6" color="{fg}">{lab.upper()}</font>', S["body"])])
    tt = Table([[x[0] for x in tiles], [x[1] for x in tiles]], colWidths=[CW / 5] * 5, rowHeights=[22, 12])
    sty = [("ALIGN", (0, 0), (-1, -1), "LEFT"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 9),
           ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1)]
    for i, k in enumerate(("affected", "nearby", "clear", "unchecked", "unresolved")):
        fg, bg = T.STATUS_COL[k]
        sty += [("BACKGROUND", (i, 0), (i, 1), colors.HexColor(bg)), ("LINEBEFORE", (i, 0), (i, 1), 3, colors.HexColor(fg))]
        if i:
            sty.append(("LINEBEFORE", (i, 0), (i, 1), 3, colors.HexColor(fg)))
    tt.setStyle(TableStyle(sty))
    fl += [tt, Spacer(1, 2.5 * mm)]
    lead = [f"{len(ctx.findings)} planning and hazard layers were screened for {ctx.lot_label}"
            + (f" ({ctx.lga})" if ctx.lga else "") + f" for a proposed {ctx.meta.get('development_type', 'development').lower()}."]
    fl.append(P(" ".join(lead), "lead"))
    fl.append(P("TOP FINDINGS, RANKED", "label"))
    fl.append(Spacer(1, 2))
    rows = []
    for i, (kind, title, text) in enumerate(summary_findings(ctx), 1):
        kk = {"affected": "affected", "nearby": "nearby", "mapped": "mapped", "unchecked": "unchecked"}.get(kind, "mapped")
        lab = {"affected": "Affected", "nearby": "Nearby", "mapped": "Controls", "unchecked": "Not checked"}[kk]
        rows.append([P(f"{i:02d}", "label"), [Paragraph(f"<b>{fmt.esc(title)}</b>", S["cellb"]), Paragraph(fmt.esc(text), S["cell"])], Chip(lab, kk)])
    if rows:
        t = Table(rows, colWidths=[9 * mm, CW - 9 * mm - 24 * mm, 24 * mm])
        t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -1), 0.4, T.RULE), ("TOPPADDING", (0, 0), (-1, -1), 4.2),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 4.2), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (2, 0), (2, -1), 0),
                               ("ALIGN", (2, 0), (2, -1), "RIGHT")]))
        fl.append(t)
    else:
        fl.append(P("No affected or nearby constraints were found in the layers that could be checked.", "body"))
    fl.append(Spacer(1, 3 * mm))
    # pathway
    pw = _pathway_text(ctx)
    fl.append(callout([P("LIKELY APPROVAL PATHWAY (INDICATIVE)", "label"), Spacer(1, 2)] + [P(x, "body") for x in pw], "blue"))
    fl.append(Spacer(1, 2.5 * mm))
    acts = next_actions(ctx)
    fl.append(P("NEXT ACTIONS", "label")); fl.append(Spacer(1, 2))
    rows = [[P("□", "body"), P(a, "cell")] for a in acts]
    t = Table(rows, colWidths=[6 * mm, CW - 6 * mm])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 1.6), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.6),
                           ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    fl.append(t)
    if cnt["unchecked"]:
        fl += [Spacer(1, 2.5 * mm), callout(NOT_CLEAR, "red")]
    return fl


def _pathway_text(ctx: Ctx) -> list[str]:
    pw = ctx.inp.pathway
    if pw is not None:
        d = pw if isinstance(pw, dict) else (pw.model_dump() if hasattr(pw, "model_dump") else {})
        head = d.get("headline") or d.get("summary") or d.get("pathway")
        if head:
            out = [fmt.clean(head)]
            for r in (d.get("reasons") or [])[:4]:
                out.append("• " + fmt.clean(r))
            if d.get("unresolved"):
                out.append("To be confirmed: " + "; ".join(map(fmt.clean, d["unresolved"][:5])))
            return out
    hints = [t.development_pathway_hint for t in ctx.inp.triggers if t.layer_key == "development_type"]
    if hints:
        return [f"Pathway analysis has not been run for this report. The platform's generic hint for a {ctx.meta.get('development_type', 'this development').lower()} is: "
                + fmt.clean(hints[0]) + ". Treat this as a prompt for questions, not a finding."]
    return ["Pathway analysis not run for this report. Ask council or an accredited certifier whether exempt development, complying development or a development application applies."]


# ------------------------------------------------------------------ 3 site and zoning
def lga_from_layers(findings: list[Finding]) -> str:
    for f in findings:
        for r in f.rows:
            m = re.match(r"^(.*?) (?:Local Environmental Plan|LEP)\b", str(r.attrs.get("EPI_NAME", "")))
            if m:
                return m[1]
    return ""


def frontage_text(ctx: Ctx) -> str:
    segs = ctx.inp.segments or []
    fr = [s for s in segs if getattr(s, "is_front", False)]
    if not fr:
        fr = [s for s in segs if "road" in str(getattr(s, "adjoins", "")).lower()]
    roads = ", ".join(ctx.inp.road_names or [])
    if not fr:
        return "Not determined from the cadastre" + (f" (roads nearby: {roads})" if roads else "")
    tot = "; ".join(f"{s.distance_m:.1f} m" for s in fr[:4])
    return tot + (f" to {roads}" if roads else "")


def site_page(ctx: Ctx) -> list:
    m = ctx.meta
    fl = section_head("03", "Site and zoning")
    f_lot = ctx.f("nsw_lot_size_map")
    ev = ctx.inp.civil or {}
    rows = [("Lot / plan", ctx.lot_label + f"   ({m.get('lotplan', '')})"), ("Council (LGA)", ctx.lga or "Not determined"),
            ("Zone", zone_text(ctx) + (" (from the NSW LEP zoning layer)" if ctx.zone else "")),
            ("Site area", fmt.area(m.get("area_m2")) + " calculated from the boundary" + (f"; registered area {fmt.area(m['area_registered'])}" if m.get("area_registered") else "; registered area not available")),
            ("Frontage", frontage_text(ctx)), ("Development", m.get("development_type", "Not stated").capitalize())]
    for key, lab in (("nsw_lot_size_map", "Minimum lot size"), ("nsw_fsr_map", "Floor space ratio"), ("nsw_height_map", "Maximum height")):
        v = control_value(ctx.findings, key)
        f = ctx.f(key)
        src = f"  ({f.currency.lower()})" if f and f.status in ("mapped", "notmapped") else ""
        rows.append((lab, ("No control mapped on this lot in the LEP layer" if v == "not mapped" else v) + src if v else "Not checked"))
    rows.append(("Zone objectives", "Not loaded: the LEP land use table and zone objectives have not been ingested for this council. Read them in the LEP."))
    flags = [x for x in (m.get("flags") or []) if x]
    if "multi_zone" in flags:
        rows.append(("Note", "The lot touches more than one zone or map class. Confirm which controls apply."))
    fl.append(kv_table(rows))
    sepp = ctx.f("nsw_sepp_area")
    if sepp and sepp.status == "mapped":
        fl += [Spacer(1, 2), P("PLANNING INSTRUMENTS THAT APPLY", "label"), Spacer(1, 1),
               P("; ".join(sorted({r.name for r in sepp.rows})) + ". Other policies (for example Housing, Transport and Infrastructure) apply by their own rules and are not mapped here.", "small")]
    fl.append(Spacer(1, 3 * mm))
    # figures
    nb = ctx.inp.neighbours
    bw = (CW - 4 * mm) / 2
    h = 84 * mm
    f1 = make_map(ctx.lot, ctx_m=35, width=bw, height=h, srid=ctx.inp.srid, imagery=ctx.imagery, neighbours=nb, footprint=ctx.inp.footprint_wkt, compact=True, max_px=1100)
    f2 = make_map(ctx.lot, ctx_m=280, width=bw, height=h, srid=ctx.inp.srid, imagery=ctx.imagery, neighbours=nb, footprint=None, show_labels=False, compact=True, max_px=1100)
    n1, n2 = ctx.next_fig(), ctx.next_fig()
    ctx.figures += [_fig_record(n1, "Lot detail", f1), _fig_record(n2, "Neighbourhood", f2)]
    cap = lambda n, t, f: P(f"<b>Figure {n}.</b> {fmt.esc(t)}", "caption", raw=True)  # noqa: E731
    t = Table([[f1.flowable(), f2.flowable()], [cap(n1, "Lot detail (about 35 m context) with adjoining lots.", f1), cap(n2, "Neighbourhood (about 280 m context).", f2)]],
              colWidths=[bw + 2 * mm, bw + 2 * mm])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    fl.append(t)
    fl.append(P(fmt.esc(f1.imagery_line) + " Lot boundaries are from the NSW cadastre and are indicative, not a survey.", "muted", raw=True))
    adj = [n for n in nb if not getattr(n, "is_road", False)]
    roads = [n for n in nb if getattr(n, "is_road", False)]
    if nb:
        fl += [Spacer(1, 2 * mm), P("ADJOINING PARCELS", "label"), Spacer(1, 1),
               P((", ".join(sorted({fmt.clean(n.label) for n in adj if n.label})[:14]) or "none labelled") + (f"; road reserves: {len(roads)}" if roads else "") + ".", "small")]
    else:
        fl += [Spacer(1, 2 * mm), P("Adjoining parcel labels were not available for this lot.", "muted")]
    return fl


# ------------------------------------------------------------------ 4 constraint summary table
def _result_text(f: Finding) -> str:
    if f.status == "unchecked":
        return f"{f.why_unchecked} To do: {f.action}"
    if f.status in ("mapped", "affected", "nearby"):
        return f.headline
    return f.headline


def _dist_text(f: Finding) -> str:
    r = f.result
    if f.status == "unchecked":
        return "-"
    if f.status == "affected":
        return f"Overlap {fmt.area(r.overlap_area_m2)} ({r.pct_of_lot:.0f}% of lot)"
    if f.status == "nearby":
        veg = [x for x in f.rows if x.name != "Vegetation Buffer"] or f.rows
        d = min((x.distance_m for x in veg), default=r.nearest_distance_m or 0)
        return f"{d:.0f} m away; {f.buffer_m:.0f} m buffer applies"
    if f.status == "mapped":
        return f"{r.pct_of_lot:.0f}% of lot" if r.pct_of_lot < 99.5 else "Whole lot"
    if r.nearest_distance_m is not None:
        return f"Nearest {r.nearest_distance_m:.0f} m away"
    return "None within about 150 m"


def constraint_table(ctx: Ctx) -> list:
    S = st()
    fl = section_head("04", "Constraint summary", "Every layer screened for this lot, with what was found, how far away it is and where the data came from.")
    order = {"affected": 0, "nearby": 1, "unchecked": 2, "clear": 3, "notmapped": 3, "mapped": 4}
    rows = []
    fs = sorted(ctx.findings, key=lambda f: (order[f.status], f.rank, f.short))
    for f in fs:
        src = [P(f.source_name.replace("NSW Government planning spatial services: ", "NSW planning: "), "cellm"), P(f.currency if f.status != "unchecked" else "Not queried", "cellm")]
        res = [Paragraph(f"<b>{fmt.esc(f.short)}</b>", S["cellb"]), Paragraph(fmt.esc(_result_text(f)), S["cell"])]
        if f.status == "clear" and f.caveat and f.key != "nsw_flood":
            res.append(Paragraph(fmt.esc("Note: " + f.caveat), S["cellm"]))
        if f.status == "clear" and f.key == "nsw_flood":
            res = [Paragraph(f"<b>{fmt.esc(f.short)}</b>", S["cellb"]), Paragraph(fmt.esc(f.headline), S["cell"]), Paragraph(fmt.esc("Note: " + f.caveat), S["cellm"])]
        rows.append([_chip_cell(f), res, P(_dist_text(f), "cell"), src])
    t = grid_table(["Status", "Layer and result", "Distance / overlap", "Source and data currency"], rows, [22 * mm, 80 * mm, 26 * mm, CW - 128 * mm])
    fl.append(t)
    fl += [Spacer(1, 3 * mm), callout(NOT_CLEAR, "red")]
    return fl


# ------------------------------------------------------------------ 5 per-constraint pages
def layer_page(ctx: Ctx, f: Finding, idx: int, total: int) -> list:
    S = st()
    lot = ctx.lot
    fl = [P(f"CONSTRAINT {idx} OF {total}", "label"), Spacer(1, 1.5), P(f.short, "h1"), Rule(CW, gold=26 * mm), Spacer(1, 3)]
    fl.append(Table([[_chip_cell(f), P(f.headline, "body")]], colWidths=[26 * mm, CW - 26 * mm],
                    style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0)])))
    fl.append(Spacer(1, 1.5 * mm))
    geoms = [r.geom for r in f.rows]
    layers = []
    nonbuf = [r for r in f.rows if r.name != "Vegetation Buffer"]
    groups: dict[str, list] = {}
    for r in f.rows:
        groups.setdefault(r.name, []).append(r.geom)
    palette = [("#a63a2b", "#d9402e"), ("#b4601a", "#e8923c"), ("#6a3d9a", "#9b6bc7"), ("#2d5a96", "#4f86c6")]
    for i, (nm, gs) in enumerate(groups.items()):
        s, fc = ("#b4601a", "#f2b24a") if nm == "Vegetation Buffer" else palette[i % len(palette)]
        layers.append(Layer(nm, gs, s, fc, 0.30 if nm == "Vegetation Buffer" else 0.40))
    ring = (lot.buffer(f.buffer_m), f"{f.buffer_m:.0f} m screening buffer") if f.buffer_m and f.status in ("nearby", "affected") else None
    pair = nearest_pair(lot, [r.geom for r in (nonbuf or f.rows)]) if f.status == "nearby" else None
    measure = (pair[1], pair[2], f"{pair[0]:.0f} m") if pair and pair[0] > 1 else None
    ctxm = min(300, max(110, f.buffer_m * 1.45))
    fig = make_map(lot, ctx_m=ctxm, width=CW, height=82 * mm, srid=ctx.inp.srid, imagery=ctx.imagery, layers=layers, neighbours=ctx.inp.neighbours,
                   footprint=ctx.inp.footprint_wkt, buffer_ring=ring, measure=measure, show_labels=False, compact=False,
                   extra_extent=[pair and _wkt.loads(f"POINT({pair[2][0]} {pair[2][1]})")] if pair else None)
    n = ctx.next_fig()
    ctx.figures.append(_fig_record(n, f.short, fig))
    fl.append(fig.flowable())
    cur = f.currency.lower() if f.currency else ""
    fl.append(_caption(ctx, n, f"{f.short} near {ctx.lot_label}, clipped to a {ctxm:.0f} m window around the lot. Source: {f.source_name}; {cur}.", fig))
    # feature table
    if f.rows:
        rows = []
        for r in f.rows[:6]:
            rows.append([P(r.name, "cellb"), P(("Within the lot" if r.distance_m == 0 else fmt.metres(r.distance_m, 0)), "cell"),
                         P(fmt.area(r.overlap_m2) + (f" ({r.pct_of_lot:.0f}% of lot)" if r.overlap_m2 > 0 else "") if r.overlap_m2 > 0 else "None", "cell"), P(r.details or "-", "cellm")])
        fl.append(grid_table(["Mapped feature", "Distance from lot", "Overlap with lot", "Other attributes"], rows, [46 * mm, 30 * mm, 38 * mm, CW - 114 * mm], zebra=False))
        fl.append(Spacer(1, 2 * mm))
    # blocks
    src_line = f"Source: {f.source_name}" + (f", {f.currency.lower()}." if f.currency else ".")
    what = [P(f.what, "body")]
    if f.caveat:
        what.append(P("Limit of this check: " + f.caveat, "muted"))
    what.append(P(src_line, "muted"))
    fl.append(block("What it is", what))
    fl.append(Spacer(1, 1.5 * mm))
    fl.append(block("What it may trigger", _trigger_flow(ctx, f)))
    fl.append(Spacer(1, 1.5 * mm))
    fl.append(block("What to do next", _next_flow(ctx, f)))
    return fl


def _trigger_flow(ctx: Ctx, f: Finding) -> list:
    t = f.trigger
    out: list = []
    if t is None or (t.rule_id == "generic" and not t.consequences):
        return [P("No trigger rules are loaded for this constraint yet.", "muted"),
                P("No cited rule loaded for this constraint yet. Ask council what it triggers for a " + CAT.DEV_LABEL.get(ctx.dev_key, "development") + ".", "mutedi")]
    rows = []
    for c in t.consequences:
        label, who = CAT.ITEMS.get(c.item, (c.item.replace("_", " ").capitalize(), "Council"))
        if c.status == "resolved":
            status = [P(f"{fmt.clean(c.value)}", "cellb"), P(fmt.clean(c.citation or ""), "cellm")]
        else:
            status = [P("To be confirmed", "cellb")]
        rows.append([P(label, "cell"), status, P(who, "cell")])
    out.append(grid_table(["May be required", "Status", "Who to ask"], rows, [CW - 9 * mm - 62 * mm - 40 * mm, 62 * mm, 40 * mm], zebra=False))
    out.append(Spacer(1, 1))
    out.append(P("Platform hint (not a finding): " + fmt.clean(t.development_pathway_hint) + ".", "muted"))
    if str(t.source).lower().startswith("to be cited"):
        out.append(P("No cited rule loaded for this constraint yet: the items above are the checks this platform raises, not a statement of what is required.", "mutedi"))
    reqs = _layer_reqs(ctx, f)
    if reqs:
        out.append(Spacer(1, 2))
        out.append(P("COUNCIL REQUIREMENTS ON FILE", "labelm"))
        rr = []
        for r in reqs[:6]:
            v, sub = req_value(r)
            rr.append([P(req_label(r["key"]), "cell"), P(v, "cellb"), _src_cell(r)])
        out.append(grid_table(["Requirement", "Value", "Source"], rr, [58 * mm, 24 * mm, CW - 9 * mm - 82 * mm], zebra=False))
    return out


def _layer_reqs(ctx: Ctx, f: Finding) -> list[dict]:
    pre = CAT.REQ_PREFIX.get(f.key, ())
    return [r for r in relevant_requirements(ctx.inp.requirements, ctx.zone, ctx.dev_key) if r["key"].startswith(pre)] if pre else []


def _next_flow(ctx: Ctx, f: Finding) -> list:
    steps: list[str] = []
    t = f.trigger
    if t:
        for s in t.next_steps:
            if not s.startswith("Obtain the s10.7"):
                steps.append(s.rstrip(".") + ".")
    if f.action and not any(f.action.rstrip(".") in s for s in steps):
        steps.append(f.action)
    if f.key == "nsw_flood" and ctx.meta.get("flood_ffl_text"):
        steps.insert(0, f"Computed minimum floor level: {ctx.meta['flood_ffl_text']}.")
    steps.append("Confirm against the s10.7 planning certificate for the lot.")
    return [Paragraph(fmt.esc(s), S_["bullet"], bulletText="•") for s in steps for S_ in [st()]]


# ------------------------------------------------------------------ 6 requirements
def requirements_section(ctx: Ctx) -> list:
    S = st()
    reqs = relevant_requirements(ctx.inp.requirements, ctx.zone, ctx.dev_key)
    fl = section_head("06", "Council requirements", f"Requirements loaded for {ctx.zone or 'this zone'} and a {ctx.meta.get('development_type', 'development').lower()}, each cited to the council document.")
    fl.append(callout("These values were extracted automatically from council documents and may be wrong, incomplete or superseded. "
                      "Items flagged 'Low confidence' or 'Not found' need confirming with council before they are relied on.", "gold"))
    fl.append(Spacer(1, 2 * mm))
    if not reqs:
        fl.append(P("No cited requirements are loaded for this council and zone yet. Obtain the council's DCP and engineering standards and confirm setbacks, access and drainage directly with council.", "body"))
    by: dict[str, list[dict]] = {}
    for r in reqs:
        by.setdefault(group_of(r["key"]), []).append(r)
    rows, extra = [], []
    for g in GROUP_ORDER:
        if g not in by:
            continue
        rows.append([P(g.upper(), "label"), "", "", ""])
        extra += [("SPAN", (0, len(rows)), (-1, len(rows))), ("BACKGROUND", (0, len(rows)), (-1, len(rows)), T.PAPER), ("LINEBELOW", (0, len(rows)), (-1, len(rows)), 0.6, T.GOLD)]
        for r in sorted(by[g], key=lambda x: x["key"]):
            v, sub = req_value(r)
            cell_v = [P(v, "cellb")] + ([P(sub, "cellm")] if sub else [])
            flag = []
            if r.get("status") != "resolved" and r.get("status") != "user_confirmed":
                flag = [Chip("Unresolved", "unresolved", h=9.5, size=5.4)]
            elif (r.get("confidence") or 0) < 0.75:
                flag = [Chip("Low confidence", "nearby", h=9.5, size=5.4)]
            rows.append([P(req_label(r["key"]), "cell"), cell_v, _src_cell(r), flag or ""])
    if rows:
        fl.append(grid_table(["Requirement", "Value", "Source (document, page, quote)", "Flag"], rows, [48 * mm, 30 * mm, CW - 48 * mm - 30 * mm - 22 * mm, 22 * mm], zebra=False, extra=extra))
    # unresolved
    unres = []
    for u in ctx.inp.unresolved_requirements:
        ap = str(u.get("applies_to", ""))
        zones = re.findall(r"\b(?:RU\d|R\d|B\d|IN\d|E\d)\b", ap)
        if zones and ctx.zone and ctx.zone not in zones:
            continue
        unres.append(u)
    if unres:
        fl += [Spacer(1, 3 * mm), P("NOT FOUND, TO BE CONFIRMED", "label"), Spacer(1, 2)]
        rr = [[P(fmt.clean(u.get("key", "")), "cell"), P(fmt.clean(u.get("reason", "")), "cell")] for u in unres[:10]]
        fl.append(grid_table(["Item", "Why it is not shown"], rr, [48 * mm, CW - 48 * mm], zebra=False))
    # development-type checks
    dts = [t for t in ctx.inp.triggers if t.layer_key == "development_type"]
    if dts:
        fl += [Spacer(1, 3 * mm), P("APPROVAL PATHWAY AND SERVICING CHECKS (TO BE CONFIRMED)", "label"), Spacer(1, 2)]
        for t in dts:
            rows = []
            for c in t.consequences:
                label, who = CAT.ITEMS.get(c.item, (c.item.replace("_", " ").capitalize(), "Council"))
                rows.append([P(label, "cell"), P("Resolved: " + fmt.clean(c.value) if c.status == "resolved" else "To be confirmed", "cell"), P(who, "cell")])
            fl.append(KeepTogether([P(t.title, "h3"), grid_table(["Item", "Status", "Who to ask"], rows, [CW - 86 * mm, 38 * mm, 48 * mm], zebra=False),
                                    P("Platform hint (not a finding): " + fmt.clean(t.development_pathway_hint) + ".", "muted"), Spacer(1, 2 * mm)]))
    return fl


# ------------------------------------------------------------------ 7 civil
def civil_section(ctx: Ctx) -> list | None:
    cv = ctx.inp.civil
    if not cv:
        return None
    fl = section_head("07", "Civil summary", "Indicative civil quantities and levels. Everything on this page is unverified.")
    fl.append(Table([[Chip("Unverified", "unresolved"), P("Based on public data and defaults. Not survey, engineering design or certification.", "muted")]],
                    colWidths=[26 * mm, CW - 26 * mm], style=TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0)])))
    fl.append(Spacer(1, 2 * mm))
    tr = cv.get("terrain")
    if tr:
        rows = [("Source", tr.get("source", "-")), ("Points sampled", str(tr.get("points", "-"))),
                ("Ground range", f"RL {tr['min_z']:.1f} to {tr['max_z']:.1f} m AHD ({tr['max_z'] - tr['min_z']:.1f} m relief across the lot)" if tr.get("min_z") is not None else "-"),
                ("Vertical accuracy", tr.get("accuracy_text", "Unknown"))]
        fl += [P("Terrain", "h2"), kv_table(rows)]
        if tr.get("dem_5m"):
            fl.append(Spacer(1, 1.5 * mm))
            fl.append(callout("The 5 m DEM is derived from stereo imagery and is too coarse for detailed cut and fill on a residential lot. Commission a detail survey before relying on levels or earthworks quantities.", "gold"))
    ff = cv.get("ffl") or {}
    fb = freeboard_req(ctx)
    rows = []
    if ff.get("min_ffl") is not None:
        rows += [("Flood level", f"RL {ff['flood_level_ahd']:.2f} m AHD ({ff.get('event', '1% AEP')}, {ff.get('flood_source', 'user entered')})"),
                 ("Freeboard", f"{ff['freeboard_m']:.2f} m ({ff.get('freeboard_source', '')})"), ("Minimum floor level", f"RL {ff['min_ffl']:.2f} m AHD")]
    else:
        rows += [("Minimum floor level", "Not set: no flood level has been supplied. Minimum floor level = flood level + freeboard."),
                 ("Freeboard", (f"{fb['value']:g} m ({_cite_short(fb)})" if fb else "Not resolved")),
                 ("To do", "Ask council for the design flood level (1% AEP) for this lot.")]
    fl += [P("Floor level", "h2"), kv_table(rows)]
    ew = cv.get("earthworks")
    fl.append(P("Earthworks", "h2"))
    if ew:
        rows = [("Cut", f"{ew['cut_volume_m3']:.0f} m³ bank over {ew['cut_area_m2']:.0f} m²"), ("Fill", f"{ew['fill_volume_m3']:.0f} m³ bank over {ew['fill_area_m2']:.0f} m²"),
                ("Net", f"{ew['net_volume_m3']:+.0f} m³ (positive = export)"), ("Topsoil strip", f"{ew['topsoil_strip_m3']:.0f} m³"),
                ("Uncertainty", f"plus or minus {ew['volume_uncertainty_m3']:.0f} m³")]
        fl += [kv_table(rows), P("Cut and fill volumes are indicative estimates from third-party terrain data (5 m DEM) and must not be used for pricing or earthworks without independent verification.", "muted")]
    else:
        fl.append(P("Not calculated: no pad design was supplied and the terrain model is a coarse 5 m DEM.", "body"))
    dv = cv.get("driveway")
    fl.append(P("Driveway and crossover", "h2"))
    if dv:
        w = dv.get("width_m")
        mn = next((r for r in ctx.inp.requirements if r["key"] == "driveway.min_width_m"), None)
        mx = next((r for r in ctx.inp.requirements if r["key"] == "driveway.max_width_m"), None)
        rows = [("Design width", f"{w:.1f} m"), ("Design vehicle", dv.get("design_vehicle", "-")), ("Maximum grade", f"{dv['max_grade_pct']:.1f}%" if dv.get("max_grade_pct") is not None else "Not computed (no survey levels along the route)"),
                ("Standard", dv.get("council_standard_label") or "Default (AS/NZS 2890.1) used; council standard not applied")]
        if mn and mx:
            ok = mn["value"] <= w <= mx["value"]
            rows.append(("Council width range", f"{mn['value']:g} to {mx['value']:g} m ({_cite_short(mn)}): design width is {'within' if ok else 'OUTSIDE'} the range"))
        fl += [kv_table(rows), P("The driveway check is preliminary screening, not certified compliance with AS/NZS 2890.1.", "muted")]
    else:
        fl.append(P("No driveway was designed for this run.", "body"))
    sv = cv.get("services") or {}
    fl.append(P("Services and rainwater tank", "h2"))
    rows = [("Existing services", f"{sv.get('assets', 0)} service assets entered" + ("; no BYDA plans were supplied, so existing underground services are unknown" if not sv.get("assets") else "; all unverified")),
            ("Proposed connections", f"{sv.get('connections', 0)}"),
            ("Rainwater tank", sv.get("rwt_text") or "Not sized in this run")]
    fl += [kv_table(rows), P("Service positions and depths are indicative. Obtain current BYDA plans and physically locate services (potholing) before any excavation.", "muted")]
    return fl


# ------------------------------------------------------------------ 8 appendix
def appendix(ctx: Ctx) -> list:
    S = st()
    fl = section_head("08", "Appendix", "Data sources, method, limits and acknowledgements.")
    fl.append(P("A. Data sources", "h2"))
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
        rows.append([P(f.source_name.replace("NSW Government planning spatial services: ", ""), "cell"), P(f.short, "cell"),
                     P(fmt.hdate(c["source"], "not published") , "cell"), P(fmt.hdate(c["fetched"], "-"), "cell"),
                     P(fmt.clean(f.copyright or "Not stated by the service."), "cellm")])
    if rows:
        fl.append(grid_table(["Service / layer", "Used for", "Mapping date", "Retrieved", "Copyright / notes"], rows, [46 * mm, 32 * mm, 20 * mm, 18 * mm, CW - 116 * mm]))
    ext = []
    ims = [x for x in ctx.figures if x["aerial"]]
    if ctx.imagery is not None and ims:
        lic = getattr(ctx.imagery, "licence", None)
        ext.append(["Aerial imagery (NSW Imagery)", lic.attribution if lic else "NSW Spatial Services", fmt.hdate(ims[0]["imagery_date"], "not published"),
                    (lic.licence_note if lic else "")])
    ext.append(["Lot boundaries (NSW Cadastre)", "NSW Spatial Services (Department of Customer Service). Indicative, not a survey.", "-", ""])
    if ctx.inp.civil and ctx.inp.civil.get("terrain"):
        ext.append(["Ground levels (NSW 5 m DEM)", fmt.clean(ctx.inp.civil["terrain"].get("source", "NSW_5M_Elevation")) + ". " + fmt.clean(ctx.inp.civil["terrain"].get("copyright", "")), "-", ""])
    if ctx.inp.requirements:
        ext.append(["Council requirements", "Council planning and engineering documents cited line by line in section 6; extracted automatically.", "-", ""])
    fl += [Spacer(1, 2), grid_table(["Other sources", "Attribution", "Date", "Licence note"], [[P(a, "cell"), P(b, "cellm"), P(c, "cell"), P(d, "cellm")] for a, b, c, d in ext],
                                    [40 * mm, CW - 40 * mm - 20 * mm - 40 * mm, 20 * mm, 40 * mm], zebra=False)]
    fl.append(P("B. Method", "h2"))
    for s in ["The lot boundary from the NSW cadastre is intersected with each mapped layer (metric MGA coordinates). 'Affected' means the mapped area overlaps the lot.",
              "'Nearby' means there is no overlap, but a mapped feature lies within the layer's screening distance (for example 100 m for bush fire prone vegetation); the distance is measured from the lot boundary.",
              "'Not affected' means no mapped feature was found on or within the screening distance of the lot, in that layer only. 'Not checked' means the layer could not be queried.",
              "Trigger rules list what a mapped constraint may require. Values appear only when cited to a document; otherwise the item is shown as 'To be confirmed'.",
              "Figures show the lot over NSW aerial imagery with mapped polygons clipped to the figure window. Mapping and imagery dates are shown on each figure."]:
        fl.append(Paragraph(fmt.esc(s), st()["bullet"], bulletText="•"))
    fl.append(P("C. Limits of this report", "h2"))
    nc = [f for f in ctx.findings if f.status == "unchecked"]
    lim = ["Only layers listed in section 4 were screened. Local council overlays, DCP maps, flood studies, easements, covenants and underground services are not covered unless stated.",
           "Boundaries are from the cadastre and are not a survey. Aerial imagery may be years old and does not show current buildings or vegetation reliably."]
    if nc:
        lim.insert(0, "Not checked: " + "; ".join(f.short.lower() for f in nc) + ". Not checked is not clear.")
    for f in ctx.findings:
        if f.caveat and f.status in ("clear", "affected", "nearby", "mapped"):
            lim.append(f"{f.short}: {f.caveat}")
    for s in lim:
        fl.append(Paragraph(fmt.esc(s), st()["bullet"], bulletText="•"))
    fl.append(callout(NOT_CLEAR, "red"))
    fl.append(P("D. Acknowledgements", "h2"))
    acks = [a for a in ctx.inp.acknowledgements if a in ACK_TEXT]
    if acks:
        fl.append(P("The user gave the following acknowledgements (Terms and Conditions, Schedule A) before this report was produced.", "muted"))
        rows = [[P(ACK_TEXT[a][0], "label"), P(ACK_TEXT[a][2], "cell")] for a in acks]
        fl.append(grid_table(["Ref", "Acknowledgement"], rows, [12 * mm, CW - 12 * mm], zebra=False))
    else:
        fl.append(P("No acknowledgements were recorded for this report.", "body"))
    fl.append(P("E. Legal statement", "h2"))
    fl.append(callout(LEGAL, "ink"))
    return fl
