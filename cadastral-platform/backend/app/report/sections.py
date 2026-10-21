"""Content of each report section, returned as lists of platypus flowables."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import CondPageBreak, KeepTogether, PageBreak, Paragraph, Spacer, Table, TableStyle
from shapely import wkt as _wkt

from app.report import catalogue as CAT
from app.report import fmt, theme as T
from app.report.acks import ACK_TEXT
from app.report import explain as EX
from app.report.blocks import KS, CheckBox, Bookmark, Chip, P, Rule, block, callout, grid_table, kv_table, section_head, st
from app.report.figures import Layer, make_map, nearest_pair
from app.report.findings import Finding, control_value
from app.report.inputs import SiteReportInputs

CW = T.CW
NOT_CLEAR = ("Not checked is not clear. A layer marked NOT CHECKED could not be queried, so the site may well be affected. "
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
    sec_no: int = 0
    sections: list[tuple[str, str]] = field(default_factory=list)
    maps: list = field(default_factory=list)            # app.report.maps.PlanMap, numbered from map_base + 1 (built before the story so earlier text can refer to them)
    map_base: int = 3                                    # figures numbered before the planning maps section: the cover (1) and the site page (2, 3)

    def map_for(self, key: str):
        return next((m for m in self.maps if m.key == key), None)

    def map_ref(self, key: str) -> str | None:
        """'Figure n' for the planning map of a layer (or 'zoning'); None when the run has no such map."""
        m = self.map_for(key)
        return f"Figure {m.number}" if m else None

    def sec(self, title: str) -> str:
        self.sec_no += 1
        num = f"{self.sec_no:02d}"
        self.sections.append((num, title))
        return num

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


def _ref(ctx: "Ctx", key: str) -> str:
    """' (refer Figure n, Title)' for the planning map of a layer, or '' when the run has none."""
    m = ctx.map_for(key)
    return f" (refer Figure {m.number}, {m.title})" if m else ""


def _chip_cell(f: Finding):
    kind = {"affected": "affected", "nearby": "nearby", "clear": "clear", "unchecked": "unchecked", "mapped": "mapped", "notmapped": "clear"}[f.status]
    return Chip(f.chip, kind)


def _sh(ctx: "Ctx", title: str, sub: str | None = None) -> list:
    return section_head(ctx.sec(title), title, sub)


def _caption(ctx: Ctx, n: int, text: str, fig) -> Paragraph:
    demo = "<b>SYNTHETIC DEMO DATA.</b> " if ctx.meta.get("synthetic_demo") else ""
    return P(f"<b>Figure {n}.</b> {demo}{fmt.esc(text)} {fmt.esc(fig.imagery_line)}", "caption", raw=True)


# ------------------------------------------------------------------ requirements helpers
def _unit(u: str | None) -> str:
    return {None: "", "m": " m", "m2": " m²", "m3": " m³", "percent": "%", "L": " L", "mm": " mm", "AUD": " AUD", "count": "",
            "ratio (1 in N)": " (1 in N)"}.get(u, f" {u}" if u else "")


# Client facing labels for site level requirement keys. A key with no label here is NOT printed (no raw internal key ever reaches the report).
REQ_LABELS = {
    "access.crossing_standard": "Standard for access from the road to the property boundary",
    "access.internal_surface": "Surface of internal access and manoeuvring areas",
    "access.internal_surface_alternative_allowed": "Alternative access surface",
    "access.multiple_access_points": "Multiple access points",
    "access.rural.sight_distance": "Rural access sight distance",
    "access.rural.design_vehicle_length_m": "Rural access design vehicle length",
    "access.rural.designed_per_eng_standards": "Rural access design standard",
    "driveway.min_width_m": "Driveway access width, minimum",
    "driveway.max_width_m": "Driveway access width, maximum",
    "driveway.min_separation_m": "Crossing to corner allotment boundary, minimum distance",
    "driveway.min_crossing_kerb_separation_m": "Kerb separation between crossings, minimum",
    "driveway.min_separation_from_common_boundary_m": "Crossing to common boundary, minimum distance",
    "driveway.max_crossings_per_frontage": "Crossings per street frontage, maximum",
    "driveway.min_culvert_diameter_mm.rural": "Rural driveway culvert diameter, minimum",
    "driveway.min_culvert_width_m": "Driveway culvert width, minimum",
    "driveway.rural_gate_recessed": "Rural gate set back from the road",
    "flood.planning_level_aep_pct": "Flood planning level, annual exceedance probability",
    "flood.onsite_sewage_no_discharge_to_floodwater": "On-site sewage not to discharge to floodwater",
    "bushfire.exempt_clearing_trees_within_m": "Exempt clearing of trees, distance from buildings",
    "bushfire.exempt_clearing_undergrowth_within_m": "Exempt clearing of undergrowth, distance from buildings",
    "water.min_cover_m": "Water main cover, minimum",
    "water.min_cover_m.footway_reserve": "Water main cover in the footway, minimum",
    "water.potable_connection_required_if_available": "Potable water connection where available",
    "water.unserviced_min_tank_storage_l": "Water storage where no mains water, minimum",
    "sewer.junction_min_diameter_mm": "Sewer junction diameter, minimum",
    "sewer.house_connection_min_cover_m": "Sewer property connection cover, minimum",
    "sewer.house_connection_min_grade_1_in": "Sewer property connection grade, minimum (1 in N)",
    "util.build_over_sewer_policy": "Building over or near a council sewer main",
    "utilities.servicing_strategy_required": "Servicing strategy with the application",
    "stormwater.designed_per_eng_standards": "Stormwater design standard",
    "stormwater.osd_roof_plumbing_design_aep_pct": "Roof water plumbing design event, annual exceedance probability",
    "site.slope_geotech_threshold_pct": "Slope above which a geotechnical investigation is required",
}
# Unresolved (not found) items that are site level, with a client facing topic. Anything else is dropped, never printed raw.
UNRESOLVED_TOPICS = {
    "landuse.permissibility.*": "Land use permissibility and zone objectives",
    "lot.min_lot_size_m2": "Minimum lot size",
    "driveway.max_grade_pct / driveway.max_grade_change_pct / rural driveway width": "Driveway maximum grade and grade change",
    "sewer.min_grade_pct (mains)": "Minimum grade of sewer mains",
    "wastewater.on_site.*": "On-site wastewater management",
    "sewer.connection_availability": "Sewer and water connection availability",
    "bushfire.bal / bushfire.apz / bushfire.access / bushfire.water": "Bushfire requirements (attack level, asset protection zone, access and water supply)",
    "flood.lot_specific_fpl": "Lot specific flood planning level",
}


def req_label(key: str) -> str | None:
    return REQ_LABELS.get(key)


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
          ("carport", "Outbuildings and carports"), ("farm_building", "Outbuildings and carports"), ("parking", "Access and driveway"),
          ("access", "Access and driveway"), ("driveway", "Access and driveway"), ("flood", "Flood"), ("bushfire", "Bushfire"),
          ("water", "Water, sewer, stormwater and rainwater tanks"), ("sewer", "Water, sewer, stormwater and rainwater tanks"),
          ("stormwater", "Water, sewer, stormwater and rainwater tanks"), ("rwt", "Water, sewer, stormwater and rainwater tanks"),
          ("util", "Water, sewer, stormwater and rainwater tanks"), ("utilities", "Water, sewer, stormwater and rainwater tanks"),
          ("basix", "BASIX"), ("site", "Site")]
GROUP_ORDER = ["Setbacks", "Secondary dwelling", "Outbuildings and carports", "Access and driveway", "Flood", "Bushfire",
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


def is_building_key(key: str) -> bool:
    """Requirement keys that only make sense for a building (setbacks, secondary dwelling, outbuildings, floor levels). Out of scope here."""
    top = key.split(".")[0]
    if top in ("setback", "secondary_dwelling", "outbuilding", "carport", "farm_building", "basix", "rwt", "parking"):
        return True
    return any(w in key for w in ("habitable", "garage", "outbuilding", "floor", "freeboard_m", "dwelling"))


def site_requirements(ctx: Ctx) -> list[dict]:
    """Cited requirements that apply to the site itself (access, flood, bushfire, services, stormwater), not to a building."""
    out = []
    for r in ctx.inp.requirements:
        z = (r.get("applies_to") or {}).get("zone")
        if z and ctx.zone and z.upper() != ctx.zone.upper():
            continue
        if is_building_key(r["key"]) or r["key"] not in REQ_LABELS:
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
        out.append(P("\u201c" + fmt.shorten_quote(q, 150) + "\u201d", "cellm"))
    return out


# ------------------------------------------------------------------ 1 cover content (drawn partly on canvas)
def verification_box(width: float = CW) -> Table:
    """The verification block (cover only, stage 8): the statement, a tick box, and NAME, SIGNATURE and DATE boxes left blank for the person who verifies."""
    from app.common.statement import VERIFY_FIELDS, VERIFY_STATEMENT, VERIFY_TICK, VERIFY_TITLE
    S = st()
    inner_w = width - 16
    head = [[P(VERIFY_TITLE, "labelm"), ""],
            [CheckBox(), Paragraph(f'<font name="Mono-Medium" size="8.5" color="#1a1a1a">{fmt.esc(VERIFY_STATEMENT)}</font>', S["body"])]]
    t0 = Table(head, colWidths=[12 * mm, inner_w - 12 * mm])
    t0.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("SPAN", (0, 0), (1, 0)), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 2),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    ws = [inner_w * 0.34, inner_w * 0.40, inner_w * 0.26]
    sig = Table([[P(f.upper() + (" (TICK WHEN " + VERIFY_TICK + ")" if False else ""), "labelm") for f in VERIFY_FIELDS], ["", "", ""]], colWidths=ws, rowHeights=[5 * mm, 13 * mm])
    sig.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.9, T.INK), ("INNERGRID", (0, 0), (-1, -1), 0.5, T.INK), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                             ("LEFTPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 2)]))
    outer = Table([[t0], [sig]], colWidths=[width])
    outer.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 1.1, T.INK), ("BACKGROUND", (0, 0), (-1, -1), colors.white), ("LEFTPADDING", (0, 0), (-1, -1), 8),
                               ("RIGHTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    return outer


def cover_flow(ctx: Ctx) -> list:
    m, S = ctx.meta, st()
    fl = [Spacer(1, 3 * mm), P("SITE ASSESSMENT AND PLANNING CONSTRAINTS", "label"), Spacer(1, 2),
          Paragraph("Site Assessment and Planning Constraints Report", T.styles()["h1"].clone("cov", fontSize=26, leading=29, spaceAfter=3, keepWithNext=0)),
          Paragraph(fmt.esc(f"{ctx.lot_label}" + (f", {ctx.lga}" if ctx.lga else "")), T.styles()["lead"].clone("covl", keepWithNext=0)), Spacer(1, 1)]
    hero = make_map(ctx.lot, ctx_m=45, width=CW, height=88 * mm, srid=ctx.inp.srid, imagery=ctx.imagery, neighbours=[], footprint=None,
                    show_labels=False, compact=True, max_px=1800, layers=[])
    n = ctx.next_fig()
    ctx.figures.append(_fig_record(n, "Site aerial", hero))
    fl += [hero.flowable(), _caption(ctx, n, f"{ctx.lot_label}: site context. Lot boundary from the cadastre (indicative, not a survey).", hero), Spacer(1, 2)]
    area = m.get("area_m2")
    tl = (getattr(ctx.brand, "tagline", "") or "").lower().replace("ai-", "AI-")
    produced = ctx.brand.name + (f" ({tl[:1].upper() + tl[1:] if not tl.startswith('AI-') else tl})" if tl else "")
    rows = [("Project", m.get("project_title") or f"{ctx.lot_label}"), ("Lot / plan", ctx.lot_label), ("Council (LGA)", ctx.lga or "Not determined"),
            ("Zone", zone_text(ctx)), ("Site area", fmt.area(area) if area else "Not stated"), ("Scope", "Site works, with an indicative typical house" if (ctx.inp.civil or {}).get("building") else "Site only"),
            ("Report date", fmt.hdate_long(m.get("date"))), ("Status", "Indicative, to be verified"), ("Produced by", produced)]
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
    if ctx.meta.get("synthetic_demo"):
        fl += [t, Spacer(1, 2 * mm), callout("SYNTHETIC DEMO DATA. The layer results in this file are invented to test the layout. They are not real findings for any lot.", "red")]
        t = Spacer(1, 0)
    fl += [t, Spacer(1, 3 * mm), verification_box(), Spacer(1, 2 * mm),
           P("Indicative only. Mapping data is unverified. This is not a section 10.7 planning certificate or a council property report. "
             "Read How to read this report before relying on any result.", "muted")]
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
BUILDING_ITEMS = {"floor_level", "max_floor_area", "setbacks", "private_open_space", "basix_certificate", "max_height", "max_site_cover",
                  "separation_from_dwelling", "class10a_bushfire_applicability", "exempt_development_eligibility",
                  "complying_development_eligibility", "min_lot_size", "parking", "freeboard", "materials"}      # building or pathway items: out of scope for a site only report


def first_sentence(text: str) -> str:
    return text.split(". ")[0].rstrip(".") + "."


def implication(ctx: Ctx, f: Finding) -> str:
    """Hedged, generic consequence of the layer (never a definitive requirement)."""
    return first_sentence(EX.layer_explain(f.key)["why"])


def freeboard_req(ctx: Ctx) -> dict | None:
    return next((r for r in ctx.inp.requirements if r["key"] == "flood.freeboard_m" and r.get("value") is not None), None)


def _cite_short(r: dict) -> str:
    s = r.get("source") or {}
    t = (s.get("document_title") or "").replace("Gunnedah Shire Council ", "Gunnedah ")
    return f"{t}, p.{s.get('page')}" if s.get("page") else t


def count_unresolved(ctx: Ctx) -> int:
    n = 0
    for t in ctx.inp.triggers:
        if t.rule_id == "generic" or t.layer_key == "development_type":
            continue
        n += sum(1 for c in t.consequences if c.status != "resolved" and c.item not in BUILDING_ITEMS)
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
            bits.append(f"{lab}: not intersected by the data loaded (no control mapped on the lot)")
    if bits:
        extra = " Two lot size classes are mapped over the lot; confirm which applies with council." if len((ctx.f("nsw_lot_size_map") or Finding("", "", "", "", "", "", 0)).rows) > 1 else ""
        out.append(("mapped", "Zoning and planning controls", "The lot is " + "; ".join(bits) + "." + extra))
    fl = ctx.f("nsw_flood")
    if fl and fl.status == "clear":
        out.append(("caution", "Flood: not intersected, but check", fl.headline))
    nc = [f for f in ctx.findings if f.status == "unchecked"]
    if nc:
        out.append(("unchecked", f"{len(nc)} layers not checked", "These could not be queried and must be checked manually: " + "; ".join(f.short.lower() for f in nc) + ". Not checked is not clear."))
    return out


def next_actions(ctx: Ctx) -> list[str]:
    acts: list[str] = [f"Obtain the s10.7 planning certificate for {ctx.lot_label} from council and confirm every layer in this report against it."]
    seen = set(acts)
    act = [f for f in ctx.findings if f.status in ("affected", "nearby") and f.key not in CAT.INFO_KEYS]
    for f in sorted(act, key=lambda f: f.rank):
        nxt = first_sentence(EX.layer_explain(f.key)["next"])
        line = f"{f.short}: {nxt}"
        if line not in seen:
            seen.add(line); acts.append(line)
    fl = ctx.f("nsw_flood")
    if fl and fl.status == "clear":
        acts.append("Ask council for flood information for the lot (flood planning level or flood certificate), even though no flood planning area intersects the lot in the data loaded.")
    nc = [f for f in ctx.findings if f.status == "unchecked"]
    if nc:
        acts.append("Check the layers marked NOT CHECKED directly with council: " + "; ".join(f.short.lower() for f in nc) + ".")
    low = [r for r in site_requirements(ctx) if r.get("confidence", 1) < 0.75 or r.get("status") != "resolved"]
    if low or ctx.inp.unresolved_requirements:
        acts.append("Confirm the flagged council requirements (low confidence or UNRESOLVED) with council planning staff.")
    acts.append("Engage a registered surveyor for an identification and detail survey before any design is finalised.")
    return acts[:9]


def exec_summary(ctx: Ctx) -> list:
    S = st()
    fl = _sh(ctx, "What matters for this site", None)
    # traffic light tiles
    cnt = {k: sum(1 for f in ctx.findings if f.status in ks) for k, ks in
           (("affected", ("affected",)), ("nearby", ("nearby",)), ("clear", ("clear", "notmapped")), ("unchecked", ("unchecked",)), ("mapped", ("mapped",)))}
    tiles = []
    for lab, kind, n in (("Intersects", "affected", cnt["affected"]), ("Within buffer", "nearby", cnt["nearby"]), ("Not intersected", "clear", cnt["clear"]),
                         ("Not checked", "unchecked", cnt["unchecked"]), ("Unresolved items", "unresolved", count_unresolved(ctx))):
        fg, bg = T.STATUS_COL[kind]
        tiles.append([Paragraph(f'<font name="Jost-Bold" size="20" color="{fg}">{n}</font>', S["body"]),
                      Paragraph(f'<font name="Mono-Medium" size="6" color="{fg}">{lab.upper()}</font>', S["body"])])
    tt = Table([[x[0] for x in tiles], [x[1] for x in tiles]], colWidths=[CW / 5] * 5, rowHeights=[26, 14])
    sty = [("ALIGN", (0, 0), (-1, -1), "LEFT"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 9),
           ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1)]
    for i, k in enumerate(("affected", "nearby", "clear", "unchecked", "unresolved")):
        fg, bg = T.STATUS_COL[k]
        sty += [("BACKGROUND", (i, 0), (i, 1), colors.HexColor(bg)), ("LINEBEFORE", (i, 0), (i, 1), 3, colors.HexColor(fg))]
        if i:
            sty.append(("LINEBEFORE", (i, 0), (i, 1), 3, colors.HexColor(fg)))
    tt.setStyle(TableStyle(sty))
    fl += [tt, Spacer(1, 2.5 * mm)]
    n_nc = sum(1 for f in ctx.findings if f.status == "unchecked")
    n_ok = len(ctx.findings) - n_nc
    lead = [f"{len(ctx.findings)} planning and hazard layers were listed for screening for {ctx.lot_label}" + (f" ({ctx.lga})" if ctx.lga else "")
            + (f"; {n_ok} could be checked and {n_nc} could not be checked." if n_nc else "; all could be checked.")
            + " The result of each layer is one of INTERSECTS, WITHIN BUFFER, NOT INTERSECTED BY THE DATA LOADED or NOT CHECKED."]
    fl.append(P(" ".join(lead), "lead"))
    fl.append(P("TOP FINDINGS, RANKED", "label"))
    fl.append(Spacer(1, 2))
    rows = []
    for i, (kind, title, text) in enumerate(summary_findings(ctx), 1):
        kk = {"affected": "affected", "nearby": "nearby", "mapped": "mapped", "unchecked": "unchecked", "caution": "nearby"}.get(kind, "mapped")
        lab = {"affected": "Intersects", "nearby": "Within buffer", "mapped": "Controls", "unchecked": "Not checked"}[kk] if kind != "caution" else "Confirm"
        rows.append([P(f"{i:02d}", "label"), [Paragraph(f"<b>{fmt.esc(title)}</b>", S["cellb"]), Paragraph(fmt.esc(text), S["cell"])], Chip(lab, kk)])
    if rows:
        t = Table(rows, colWidths=[9 * mm, CW - 9 * mm - 24 * mm, 24 * mm])
        t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -1), 0.4, T.RULE), ("TOPPADDING", (0, 0), (-1, -1), 4.2),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 4.2), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (2, 0), (2, -1), 0),
                               ("ALIGN", (2, 0), (2, -1), "RIGHT")]))
        fl.append(t)
    else:
        fl.append(P("No layer intersects the lot or lies within its screening distance in the data loaded. This describes the data only.", "body"))
    fl.append(Spacer(1, 3 * mm))
    # pathway
    pw = _pathway_text(ctx)
    fl.append(callout([P("APPROVAL PATHWAY", "label"), Spacer(1, 2)] + [P(x, "body") for x in pw], "blue"))
    fl.append(Spacer(1, 2.5 * mm))
    acts = next_actions(ctx)
    fl.append(P("NEXT ACTIONS", "label")); fl.append(Spacer(1, 2))
    rows = [[CheckBox(), P(a, "cell")] for a in acts]
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
                out.append("\u2022 " + fmt.clean(r))
            if d.get("unresolved"):
                out.append("UNRESOLVED: " + "; ".join(map(fmt.clean, d["unresolved"][:5])))
            return out
    return ["NOT ASSESSED in this report. The approval pathway (exempt development, complying development or a development application) depends on "
            "the proposal and is outside this site only report. Ask council or an accredited certifier."]


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
    fl = _sh(ctx, "Site and zoning")
    f_lot = ctx.f("nsw_lot_size_map")
    ev = ctx.inp.civil or {}
    rows = [("Lot / plan", ctx.lot_label + f"   ({m.get('lotplan', '')})"), ("Council (LGA)", ctx.lga or "Not determined"),
            ("Zone", zone_text(ctx) + (" (from the NSW LEP zoning layer)" if ctx.zone else "") + _ref(ctx, "zoning")),
            ("Site area", fmt.area(m.get("area_m2")) + " calculated from the boundary" + (f"; registered area {fmt.area(m['area_registered'])}" if m.get("area_registered") else "; registered area not available")),
            ("Frontage", frontage_text(ctx))]
    for key, lab in (("nsw_lot_size_map", "Minimum lot size"), ("nsw_fsr_map", "Floor space ratio"), ("nsw_height_map", "Maximum height")):
        v = control_value(ctx.findings, key)
        f = ctx.f(key)
        src = f"  ({f.currency.lower()})" if f and f.status in ("mapped", "notmapped") else ""
        val = ("NOT INTERSECTED BY THE DATA LOADED: no control mapped on this lot in the LEP layer loaded" if v == "not mapped" else v) + src if v else "Not checked"
        rows.append((lab, val + _ref(ctx, key)))
    rows.append(("Zone objectives", "Not available in this report: the zone objectives and land use table from the LEP were not loaded. Read them in the LEP."))
    flags = [x for x in (m.get("flags") or []) if x]
    if "multi_zone" in flags:
        rows.append(("Note", "The lot touches more than one zone or map class. Confirm which controls apply."))
    elif "multi_zone_in_saved_live_run" in flags:
        rows.append(("Note", "The saved live run flagged this lot as possibly multi-zone. The offline data hold one simplified zone attribute. Confirm the zones with the council."))
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
    f1 = make_map(ctx.lot, ctx_m=35, width=bw, height=h, srid=ctx.inp.srid, imagery=ctx.imagery, neighbours=nb, footprint=None, compact=True, max_px=1100)
    f2 = make_map(ctx.lot, ctx_m=280, width=bw, height=h, srid=ctx.inp.srid, imagery=ctx.imagery, neighbours=nb, footprint=None, show_labels=False, compact=True, max_px=1100)
    n1, n2 = ctx.next_fig(), ctx.next_fig()
    ctx.figures += [_fig_record(n1, "Lot detail", f1), _fig_record(n2, "Neighbourhood", f2)]
    cap = lambda n, t, f: P(f"<b>Figure {n}.</b> {fmt.esc(t)}", "caption", raw=True)  # noqa: E731
    t = Table([[f1.flowable(), f2.flowable()], [cap(n1, f"Lot detail with adjoining lots. Figure extent {f1.extent_text}.", f1), cap(n2, f"Neighbourhood. Figure extent {f2.extent_text}.", f2)]],
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
        d = min((x.distance_m for x in f.rows), default=r.nearest_distance_m or 0)
        return f"{d:.0f} m from the lot; inside the {f.buffer_m:.0f} m screening distance"
    if f.status == "mapped":
        return f"{r.pct_of_lot:.0f}% of lot" if r.pct_of_lot < 99.5 else "Whole lot"
    if r.nearest_distance_m is not None:
        return f"Nearest {r.nearest_distance_m:.0f} m away"
    return f"None in the data loaded (about {EX.LOAD_MARGIN_M} m around the lot)"


def constraint_table(ctx: Ctx) -> list:
    S = st()
    fl = _sh(ctx, "Constraint summary", "Every layer screened for this lot, with what was found, how far away it is and where the data came from.")
    order = {"affected": 0, "nearby": 1, "unchecked": 2, "clear": 3, "notmapped": 3, "mapped": 4}
    rows = []
    fs = sorted(ctx.findings, key=lambda f: (order[f.status], f.rank, f.short))
    for f in fs:
        src = [P(f.source_name, "cellm"), P(f.currency if f.status != "unchecked" else "Not queried", "cellm")]
        res = [Paragraph(f"<b>{fmt.esc(f.short)}</b>", S["cellb"]), Paragraph(fmt.esc(_result_text(f)), S["cell"])]
        if f.status == "clear" and f.caveat and f.key != "nsw_flood":
            res.append(Paragraph(fmt.esc("Note: " + f.caveat), S["cellm"]))
        if f.status == "clear" and f.key == "nsw_flood":
            res = [Paragraph(f"<b>{fmt.esc(f.short)}</b>", S["cellb"]), Paragraph(fmt.esc(f.headline), S["cell"]), Paragraph(fmt.esc("Note: " + f.caveat), S["cellm"])]
        mref = ctx.map_for(f.key)
        if mref:
            res.append(Paragraph(fmt.esc(f"Map: refer Figure {mref.number}, {mref.title}."), S["cellm"]))
        rows.append([_chip_cell(f), res, P(_dist_text(f), "cell"), src])
    t = grid_table(["Status", "Layer and result", "Distance / overlap", "Source and data currency"], rows, [27 * mm, 77 * mm, 26 * mm, CW - 130 * mm])
    fl.append(t)
    fl += [Spacer(1, 3 * mm), callout(NOT_CLEAR, "red")]
    return fl


# ------------------------------------------------------------------ 5 per-constraint pages
def screening_info(ctx: Ctx, f: Finding) -> tuple[str, str]:
    """(caption text, status) for the screening distance of a layer. Status is SCREENING SETTING, CITED RULE or UNRESOLVED."""
    from app.agents.sa9_constraints.layers import REGISTRY
    if f.key not in REGISTRY:
        return ("Screening distance used: UNRESOLVED. This layer is not in the platform layer list, so no screening setting is available "
                "and no figure is assumed."), "UNRESOLVED"
    pre = CAT.REQ_PREFIX.get(f.key, ())
    cited = next((r for r in ctx.inp.requirements if r.get("value") is not None and isinstance(r.get("value"), (int, float))
                  and r.get("unit") == "m" and pre and r["key"].startswith(pre) and "buffer" in r["key"]), None)
    d = f"{f.buffer_m:g} m" if f.buffer_m else "none (0 m, only features that intersect the lot are reported)"
    base = (f"Screening distance used: {d}. Status: SCREENING SETTING, a setting in {EX.SETTINGS_NAME}, not a statutory requirement.")
    if cited:
        base += (f" A cited requirement ({REQ_LABELS.get(cited['key'], 'see the requirements section')}) gives {cited['value']:g} m ({_cite_short(cited)}); the check above was run with the "
                 "screening setting and has not been re-run at the cited figure.")
        return base, "SCREENING SETTING"
    return base, "SCREENING SETTING"


def _bullets(items: list[str]) -> list:
    return [Paragraph(fmt.esc(x), st()["bullet"], bulletText="\u2022") for x in items]


def _source_para(f: Finding) -> Paragraph:
    if f.meta.get("synthetic"):
        return P("Source: SYNTHETIC DEMO DATA. Not from any real service.", "muted")
    return P("Source: " + EX.source_line(f.meta, f.host) + (f" {f.currency}." if f.currency else ""), "muted")


def layer_blocks(ctx: Ctx, f: Finding) -> list:
    """The WHAT THIS IS / WHY IT MATTERS / WHAT TO DO NEXT blocks (kept whole, never split across pages)."""
    ex = EX.layer_explain(f.key)
    what = [P(ex["what"], "body")]
    if f.caveat:
        what.append(P("Limit of this check: " + f.caveat, "muted"))
    what.append(_source_para(f))
    out = [KeepTogether([block("What this is", what)]), Spacer(1, 1.5 * mm)]
    why = [P(ex["why"], "body")] + _why_extra(ctx, f)
    out += [KeepTogether([block("Why it matters", why)]), Spacer(1, 1.5 * mm)]
    nxt = _bullets([x.strip().rstrip(".") + "." for x in ex["next"].split(". ") if x.strip()]) + [
        Paragraph(fmt.esc("Confirm against the section 10.7 planning certificate for the lot."), st()["bullet"], bulletText="\u2022")]
    out += [KeepTogether([block("What to do next", nxt)])]
    return out


def _why_extra(ctx: Ctx, f: Finding) -> list:
    """Trigger items the platform raises (building items removed) and any cited requirements on file."""
    out: list = []
    t = f.trigger
    cons = [c for c in (t.consequences if t else []) if c.item not in BUILDING_ITEMS]
    if cons:
        res = [c for c in cons if c.status == "resolved"]
        if res:
            rows = []
            for c in cons:
                label, who = CAT.ITEMS.get(c.item, (c.item.replace("_", " ").capitalize(), "Council"))
                status = [P(fmt.clean(c.value), "cellb"), P(fmt.clean(c.citation or ""), "cellm")] if c.status == "resolved" else [P("UNRESOLVED", "cellb")]
                rows.append([P(label, "cell"), status, P(who, "cell")])
            out.append(grid_table(["May be required", "Status", "Who to ask"], rows, [CW - 9 * mm - 62 * mm - 40 * mm, 62 * mm, 40 * mm], zebra=False))
        else:
            names = "; ".join(CAT.ITEMS.get(c.item, (c.item.replace("_", " ").capitalize(), ""))[0].lower() for c in cons)
            out.append(P("Items the platform raises for confirmation: " + names + ". Each is UNRESOLVED: no cited value is on file. "
                         "These are prompts, not a statement of what is required.", "muted"))
    reqs = _layer_reqs(ctx, f)
    if reqs:
        out += [Spacer(1, 3 * mm), P("COUNCIL REQUIREMENTS ON FILE (CITED)", "labelm"), KS(2)]
        rr = []
        for r in reqs[:6]:
            v, sub = req_value(r)
            rr.append([P(req_label(r["key"]), "cell"), P(v, "cellb"), _src_cell(r)])
        out.append(grid_table(["Requirement", "Value", "Source"], rr, [58 * mm, 24 * mm, CW - 9 * mm - 82 * mm], zebra=False))
    return out


def layer_page(ctx: Ctx, f: Finding, idx: int, total: int) -> list:
    S = st()
    lot = ctx.lot
    fl = [Bookmark(f"{f.short} ({f.chip})", 1), P(f"CONSTRAINT {idx} OF {total}", "label"), KS(1.5), P(f.short, "h1"), Rule(CW, gold=26 * mm), KS(3)]
    fl.append(Table([[_chip_cell(f), P(_dist_text(f), "body")]], colWidths=[30 * mm, CW - 30 * mm],
                    style=TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0)])))
    fl.append(Spacer(1, 1.5 * mm))
    layers = []
    groups: dict[str, list] = {}
    for r in f.rows:
        groups.setdefault(r.name, []).append(r.geom)
    palette = [("#a63a2b", "#d9402e"), ("#b4601a", "#e8923c"), ("#6a3d9a", "#9b6bc7"), ("#2d5a96", "#4f86c6")]
    for i, (nm, gs) in enumerate(groups.items()):
        s, fc = ("#b4601a", "#f2b24a") if nm == "Vegetation Buffer" else palette[i % len(palette)]
        layers.append(Layer(nm, gs, s, fc, 0.30 if nm == "Vegetation Buffer" else 0.40))
    ring = (lot.buffer(f.buffer_m), f"{f.buffer_m:.0f} m screening buffer") if f.buffer_m and f.status in ("nearby", "affected") else None
    pair = nearest_pair(lot, [r.geom for r in f.rows]) if f.status == "nearby" else None
    measure = (pair[1], pair[2], f"d = {pair[0]:.0f} m") if pair and pair[0] > 1 else None
    ctxm = min(300, max(110, f.buffer_m * 1.45))
    fig = make_map(lot, ctx_m=ctxm, width=CW, height=60 * mm, srid=ctx.inp.srid, imagery=ctx.imagery, layers=layers, neighbours=ctx.inp.neighbours,
                   footprint=None, buffer_ring=ring, measure=measure, show_labels=False, compact=False,
                   extra_extent=[_wkt.loads(f"POINT({pair[1][0]} {pair[1][1]})"), _wkt.loads(f"POINT({pair[2][0]} {pair[2][1]})")] if pair else None)
    n = ctx.next_fig()
    ctx.figures.append(_fig_record(n, f.short, fig))
    cur = f.currency.lower() if f.currency else ""
    cap = _caption(ctx, n, f"{f.short} near {ctx.lot_label}. Figure extent {fig.extent_text}. Source: {f.source_name}; {cur}.", fig)
    sc_text, sc_status = screening_info(ctx, f)
    fl.append(KeepTogether([fig.flowable(), cap, P("<b>Buffer.</b> " + fmt.esc(sc_text), "caption", raw=True)]))
    # result for this lot
    res = [P(f.headline, "body")]
    if ctx.map_for(f.key):
        m_ = ctx.map_for(f.key)
        res.append(P(f"Planning map: refer Figure {m_.number}, {m_.title}, in the Planning maps section. It shows the mapped polygons of this layer around the lot, with their source.", "muted"))
    if f.rows:
        rows = []
        for r in f.rows[:5]:
            rows.append([P(r.name, "cellb"), P(("Within the lot" if r.distance_m == 0 else fmt.metres(r.distance_m, 0)), "cell"),
                         P(fmt.area(r.overlap_m2) + (f" ({r.pct_of_lot:.0f}% of lot)" if r.overlap_m2 > 0 else "") if r.overlap_m2 > 0 else "None", "cell"), P(r.details or "-", "cellm")])
        res.append(grid_table(["Mapped feature", "Distance from lot", "Overlap with lot", "Other attributes"], rows, [46 * mm, 30 * mm, 38 * mm, CW - 114 * mm - 9 * mm], zebra=False))
        if len(f.rows) > 5:
            res.append(P(f"{len(f.rows) - 5} further mapped features are not listed.", "muted"))
    fl += [KeepTogether([block("Result for this lot", res)]), Spacer(1, 1.5 * mm)]
    fl += layer_blocks(ctx, f)
    return fl


def _layer_reqs(ctx: Ctx, f: Finding) -> list[dict]:
    pre = CAT.REQ_PREFIX.get(f.key, ())
    return [r for r in site_requirements(ctx) if r["key"].startswith(pre)] if pre else []


# ------------------------------------------------------------------ 6 requirements
def requirements_section(ctx: Ctx) -> list:
    S = st()
    reqs = site_requirements(ctx)
    fl = _sh(ctx, "Council requirements for the site", f"Site level requirements loaded for {ctx.zone or 'this zone'}, each cited to the council document. "
             "Building requirements (setbacks, floor levels, outbuildings) are outside this site only report.")
    fl.append(callout("These values were extracted automatically from council documents and may be wrong, incomplete or superseded. "
                      "Items flagged 'Low confidence' or 'Not found' need confirming with council before they are relied on.", "gold"))
    fl.append(Spacer(1, 2 * mm))
    if not reqs:
        fl.append(P("UNRESOLVED: no cited site requirements are loaded for this council and zone. Obtain the council's DCP and engineering standards and confirm access, drainage and servicing directly with council.", "body"))
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
        if u.get("key") not in UNRESOLVED_TOPICS or any(UNRESOLVED_TOPICS[u["key"]] == UNRESOLVED_TOPICS[x["key"]] for x in unres):
            continue
        unres.append(u)
    if unres:
        fl += [Spacer(1, 3 * mm), P("NOT FOUND IN THE CITED SOURCES (UNRESOLVED)", "label"), KS(2)]
        rr = [[P(UNRESOLVED_TOPICS[u["key"]], "cell"), P("UNRESOLVED. Not found in the cited sources. Confirm with council.", "cell")] for u in unres]
        fl.append(grid_table(["Item", "Status"], rr, [90 * mm, CW - 90 * mm], zebra=False))
    return fl


# ------------------------------------------------------------------ 7 civil

def dbyd_block(ctx: Ctx, dy: dict) -> list:
    """Civil summary: the Before You Dig (BYDA) responses, owner by owner: response status, plans received, traced (draft) and verified counts, and the date the plans stop being valid."""
    S = st()
    fl = [P("Before You Dig (BYDA) responses", "label"), KS(2)]
    rows = [("BYDA job", dy.get("job_number") or "Not stated"), ("Responses", (dy.get("responses_text") or f"{dy.get('n_received', 0)} of {dy.get('n_owners', 0)} owners responded")),
            ("Plans valid until", fmt.hdate_long(dy["enquiry_valid_until"]) if dy.get("enquiry_valid_until") else "Not stated"),
            ("Services", f"{dy.get('n_verified', 0)} verified, {dy.get('n_draft', 0)} traced and not yet verified (draft). Only verified services are drawn on the plans.")]
    fl.append(kv_table(rows))
    trs = [[P(c, "cell") for c in r] for r in dy.get("rows") or []]
    if trs:
        fl += [Spacer(1, 1.5 * mm), grid_table(list(dy.get("header") or []), trs, [44 * mm, 22 * mm, 42 * mm, 14 * mm, 18 * mm, T.CW - 140 * mm])]
    if dy.get("expiry_warning"):
        fl.append(callout(dy["expiry_warning"], "red"))
    if not dy.get("n_verified"):
        fl.append(callout("No existing service is verified, so none is shown on the plans. Existing services are not confirmed. Not checked is not clear.", "red"))
    if dy.get("synthetic"):
        fl.append(callout("SYNTHETIC DEMO DATA: these responses and services are invented to exercise the software. They are not real services.", "red"))
    fl.append(P("Asset owner plans are for this project only. Every service location is indicative: confirm by potholing before any excavation.", "muted"))
    fl.append(Spacer(1, 2 * mm))
    return fl


def building_block(ctx: Ctx, bd: dict) -> list:
    """Civil summary: the dwelling placed on the lot (stage 8), from the building data: the Plan Studio typical house (indicative), the cited setbacks with provided values and
    results, the garage control and the finished floor level.  Nothing here is a design for the lot."""
    fl = [P("Building (indicative typical house)", "h2")]
    src = bd.get("source") or "Plan Studio typical house (indicative)"
    if src.isupper():
        import re as _re
        src = _re.sub(r"(?i)plan studio", "Plan Studio", src.capitalize())
    rows = [("Source", f"{src}. A typical template from the Plan Studio design tool, not a design for this lot. Placed to the cited setbacks and oriented to the street frontage."),
            ("House", str(bd.get("house") or "Not stated")),
            ("Footprint", (f"{bd['footprint_area_m2']:,.0f} m² (outline of the dwelling, garage and roofed alfresco)" if bd.get("footprint_area_m2") else "Not stated")
             + (f"; roof plan area to the eaves {bd['roof_area_m2']:,.0f} m²" if bd.get("roof_area_m2") else ""))]
    ffl_note = (bd.get("ffl_note") or "").strip()
    if ffl_note.startswith("FFL TBC: "):
        ffl_note = ffl_note[9:]
    ffl_note = ffl_note[:1].upper() + ffl_note[1:]
    rows.append(("Finished floor level", (f"RL {bd['ffl_m']:.2f} m AHD. " if bd.get("ffl_m") is not None else "TBC (to be confirmed). ") + ffl_note))
    gr_ = bd.get("ground_range")
    if gr_:
        rows.append(("Existing ground", f"RL {gr_[0]:.2f} to {gr_[2]:.2f} m AHD under the footprint (mean {gr_[1]:.2f}), from the 5 m DEM. A detail survey is required."))
    fl.append(kv_table(rows))
    trs = []
    for r in bd.get("rows") or []:
        if r.get("informational"):
            continue
        res = "Not checked" if r.get("met") is None else ("Met" if r["met"] else "Not met")
        trs.append([P(r["label"].lower().capitalize() if r["label"].isupper() else r["label"], "cell"), P(r.get("cite_value") if r.get("met") is not None else "UNRESOLVED", "cell"),
                    P(f"{r['actual_m']:.2f} m", "cellb"), P(res, "cellb")])
    g = bd.get("garage_rule")
    if g:
        fwd = g["actual_m"] < 0
        trs.append([P("Garage behind the front building line", "cell"), P((f"{g['required_m']:g} m behind" if g.get("required_m") is not None else "UNRESOLVED"), "cell"),
                    P(f"{abs(g['actual_m']):.2f} m " + ("forward" if fwd else "behind"), "cellb"), P("Met" if g.get("met") else "Not met", "cellb")])
    if trs:
        fl += [Spacer(1, 1.5 * mm), grid_table(["Boundary or control", "Cited minimum", "Provided", "Result"], trs, [68 * mm, 36 * mm, 28 * mm, T.CW - 132 * mm])]
        fl.append(P("Setbacks are measured from the cadastral boundary to the nearest part of the dwelling. The cited values, sources and pages are on plan set sheet C101. "
                    "A result of Not met is reported and the layout is not changed to hide it.", "muted"))
    from app.design.building_place import plain_flags
    for f in plain_flags(bd):
        fl.append(callout(f, "red"))
    fl.append(Spacer(1, 2 * mm))
    return fl

def civil_section(ctx: Ctx) -> list | None:
    cv = ctx.inp.civil
    if not cv:
        return None
    fl = _sh(ctx, "Civil summary", "Indicative ground levels, driveway and services notes for the site. Everything on this page is unverified.")
    fl.append(Table([[Chip("Unverified", "unresolved"), P("Based on public data and defaults. Not survey, engineering design or certification.", "muted")]],
                    colWidths=[26 * mm, CW - 26 * mm], style=TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0)])))
    fl.append(Spacer(1, 2 * mm))
    if cv.get("building"):
        fl += building_block(ctx, cv["building"])
    ps = cv.get("planset") or {}
    fl.append(P("Plan set in this run: " + ("built; the driveway earthworks and grade below are the plan set figures." if cv.get("planset_built") else "not built; no driveway profile, earthworks or grade was computed for this report."), "muted"))
    tr = cv.get("terrain")
    if tr:
        rows = [("Source", tr.get("source", "-")), ("Points sampled", str(tr.get("points", "-"))),
                ("Ground range", f"RL {tr['min_z']:.1f} to {tr['max_z']:.1f} m AHD ({tr['max_z'] - tr['min_z']:.1f} m relief across the lot)" if tr.get("min_z") is not None else "-"),
                ("Vertical accuracy", str(tr.get("accuracy_text", "UNKNOWN")))]
        fl += [P("Terrain", "h2"), kv_table(rows)]
        if tr.get("dem_5m"):
            fl.append(Spacer(1, 1.5 * mm))
            fl.append(callout("The 5 m DEM is derived from stereo imagery and is too coarse for detailed cut and fill on a residential lot. Commission a detail survey before relying on levels or earthworks quantities.", "gold"))
    ew = cv.get("earthworks")
    fl.append(P("Earthworks", "h2"))
    if ew:
        rows = [("Cut", f"{ew['cut_volume_m3']:.0f} m³ bank over {ew['cut_area_m2']:.0f} m²"), ("Fill", f"{ew['fill_volume_m3']:.0f} m³ bank over {ew['fill_area_m2']:.0f} m²"),
                ("Net", f"{ew['net_volume_m3']:+.0f} m³ (positive = export)"), ("Topsoil strip", f"{ew['topsoil_strip_m3']:.0f} m³"),
                ("Uncertainty", f"plus or minus {ew['volume_uncertainty_m3']:.0f} m³")]
        fl += [kv_table(rows), P("Cut and fill volumes are indicative estimates from third-party terrain data (5 m DEM) and must not be used for pricing or earthworks without independent verification.", "muted")]
    elif ps.get("driveway_cut_m3") is not None:
        fl.append(kv_table([("Driveway cut", f"{ps['driveway_cut_m3']:,.1f} m³"), ("Driveway fill", f"{ps['driveway_fill_m3']:,.1f} m³")]))
        fl.append(P("INDICATIVE. Existing 5 m DEM levels against the platform driveway profile, as stated on the plan set (the same figures as the plan set and the SoEE). "
                    "The level at the driveway end is a PLATFORM DEFAULT, not a design level. No building pad is included.", "muted"))
    elif cv.get("planset_built"):
        fl.append(P("NOT AVAILABLE: the plan set was built in this run but gave no driveway earthworks figure.", "body"))
    else:
        fl.append(P("Not calculated in this run: no plan set was built (so no driveway profile was drawn) and no earthworks design was supplied. The plan set and the SoEE give driveway "
                    "earthworks when they are built from a run that includes the plan set. The terrain model is a coarse 5 m DEM.", "body"))
    dv = cv.get("driveway")
    fl.append(P("Driveway and crossover", "h2"))
    if dv:
        w = dv.get("width_m")
        mn = next((r for r in ctx.inp.requirements if r["key"] == "driveway.min_width_m"), None)
        mx = next((r for r in ctx.inp.requirements if r["key"] == "driveway.max_width_m"), None)
        dflt = "" if dv.get("council_standard_label") else " (ASSUMED / PLATFORM DEFAULT design value, no cited source)"
        rows = [("Design width", f"{w:.1f} m{dflt}"), ("Design vehicle", (f"{dv.get('design_vehicle', '-')} (required by the council: {dv['design_vehicle_source']})" if dv.get("design_vehicle_source") else f"{dv.get('design_vehicle', '-')} (ASSUMED / PLATFORM DEFAULT design value, no cited source)")), ("Maximum grade", f"{dv['max_grade_pct']:.1f}%" if dv.get("max_grade_pct") is not None else (f"{ps['driveway_max_grade_pct']:.2f}% steepest profile grade from the 5 m DEM (plan set, platform screening only, INDICATIVE)" if ps.get("driveway_max_grade_pct") is not None else "Not computed in this run" + ("" if cv.get("planset_built") else " (no plan set built, so no profile along the route)"))),
                ("Standard", dv.get("council_standard_label") or "ASSUMED / PLATFORM DEFAULT: AS/NZS 2890.1 used; council standard not applied")]
        if mn and mx:
            ok = mn["value"] <= w <= mx["value"]
            rows.append(("Council width range", f"{mn['value']:g} to {mx['value']:g} m ({_cite_short(mn)}): design width is {'within' if ok else 'OUTSIDE'} the range"))
        fl += [kv_table(rows), P("The driveway check is preliminary screening, not certified compliance with AS/NZS 2890.1.", "muted")]
    else:
        fl.append(P("No driveway was designed for this run.", "body"))
    sv = cv.get("services") or {}
    fl.append(P("Services and rainwater tank", "h2"))
    dy = cv.get("dbyd")
    if dy:
        fl += dbyd_block(ctx, dy)
    rows = [("Existing services", f"{sv.get('assets', 0)} service assets entered" + (("; no BYDA plans were supplied, so existing underground services are unknown" if not dy else "; see the BYDA table above for the responses received") if not sv.get("assets") else "; all unverified")),
            ("Proposed connections", f"{sv.get('connections', 0)}"),
            ("Rainwater tank", sv.get("rwt_text") or "Not sized in this run")]
    fl += [kv_table(rows), P("Service positions and depths are indicative. Obtain current BYDA plans and physically locate services (potholing) before any excavation.", "muted")]
    return fl


