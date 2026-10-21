"""General notes (C001) for the LGA of the lot, built from data.

Rules:
  * the council is NAMED FROM DATA: the council source document title in the requirements file (e.g. "Gunnedah Shire Council"), else the lot's LGA
    name followed by COUNCIL.  No council name is typed into this module.
  * council content is CITED: each line comes from the requirements resolver (``Cites``) or from the rules JSON (``PlansetInput.rules``) with its
    source document, section and page.  Nothing is defaulted.
  * a topic with no resolved requirement is written as
    ``COUNCIL REQUIREMENT: <TOPIC> UNRESOLVED, CONFIRM WITH <LGA NAME> COUNCIL``.
  * no AI statement is drawn on these notes (stage 8): the verification block is on the cover sheet only.
"""
from __future__ import annotations

import re

from app.agents.sa5_cad_dxf.planset import phrases as PH
from app.agents.sa5_cad_dxf.planset import style as ST

# group -> list of (label, requirement keys that may supply it).  The first resolved key is shown with its citation.
CITED_TOPICS: dict[str, list[tuple[str, tuple[str, ...]]]] = {
    "SURVEY AND EXISTING SERVICES": [
        ("WATER MAIN COVER", ("water.min_cover_m",)),
        ("WATER MAIN COVER IN FOOTWAY RESERVE", ("water.min_cover_m.footway_reserve",)),
        ("SEWER JUNCTION MINIMUM DIAMETER", ("sewer.junction_min_diameter_mm",)),
        ("SEWER HOUSE CONNECTION COVER", ("sewer.house_connection_min_cover_m",)),
        ("SEWER HOUSE CONNECTION GRADE (1 IN)", ("sewer.house_connection_min_grade_1_in",)),
        ("BUILDING OVER SEWER", ("util.build_over_sewer_policy",)),
        ("SERVICING STRATEGY", ("utilities.servicing_strategy_required",)),
    ],
    "EARTHWORKS AND EROSION AND SEDIMENT CONTROL": [
        ("SLOPE THRESHOLD FOR GEOTECHNICAL ADVICE (PERCENT)", ("site.slope_geotech_threshold_pct",)),
        ("TOPSOIL STRIP DEPTH, MINIMUM", ("esc.topsoil.strip_depth_min_mm",)),
        ("TOPSOIL STOCKPILE, MAXIMUM DEPTH", ("esc.topsoil.stockpile_max_depth_m",)),
        ("STOCKPILE, MAXIMUM HEIGHT", ("esc.stockpile.max_height_m",)),
        ("SEDIMENT FENCE POST SPACING", ("esc.sediment_fence.post_spacing_m",)),
        ("SEDIMENT FENCE TRENCH DEPTH", ("esc.sediment_fence.trench_depth_mm",)),
        ("STABILISED ACCESS, MINIMUM LENGTH", ("esc.access.min_length_m",)),
        ("STABILISED ACCESS, MINIMUM LENGTH (BUILDING SITES GUIDELINE)", ("esc.access.min_length_building_sites_m",)),
        ("STABILISED ACCESS, MINIMUM WIDTH", ("esc.access.min_width_m",)),
        ("ESCP PREPARED BY A SUITABLY QUALIFIED PERSON", ("esc.escp.prepared_by_suitably_qualified_person",)),
        ("ESC INSPECTION FREQUENCY", ("esc.inspection.min_frequency",)),
        ("TRENCH, MAXIMUM OPEN PERIOD (DAYS)", ("esc.trench.max_open_days",)),
    ],
    "DRIVEWAY AND CROSSOVER": [
        ("VEHICLE CROSSING STANDARD", ("access.crossing_standard",)),
        ("DRIVEWAY MINIMUM WIDTH", ("driveway.min_width_m",)),
        ("DRIVEWAY MAXIMUM WIDTH", ("driveway.max_width_m",)),
        ("MINIMUM SEPARATION BETWEEN DRIVEWAYS", ("driveway.min_separation_m",)),
        ("MINIMUM CROSSING TO KERB SEPARATION", ("driveway.min_crossing_kerb_separation_m",)),
        ("MINIMUM SEPARATION FROM COMMON BOUNDARY", ("driveway.min_separation_from_common_boundary_m",)),
        ("MAXIMUM CROSSINGS PER FRONTAGE", ("driveway.max_crossings_per_frontage",)),
        ("INTERNAL ACCESS SURFACE", ("access.internal_surface",)),
    ],
    "STORMWATER AND FLOOD": [
        ("STORMWATER DESIGN", ("stormwater.designed_per_eng_standards",)),
        ("FLOOD PLANNING LEVEL AEP (PERCENT)", ("flood.planning_level_aep_pct",)),
    ],
}

# topics that must appear whether or not data exist.  Cited when one of the keys resolves, else the UNRESOLVED line.
REQUIRED_TOPICS: dict[str, list[tuple[str, tuple[str, ...]]]] = {
    "SURVEY AND EXISTING SERVICES": [
        ("SEWER MAIN AND CONNECTION POINT AVAILABILITY", ("sewer.connection_available", "sewer.main_location")),
        ("WATER MAIN AND CONNECTION POINT AVAILABILITY", ("water.connection_available", "water.main_location")),
    ],
    "EARTHWORKS AND EROSION AND SEDIMENT CONTROL": [
        ("CUT AND FILL BATTER SLOPES (MAXIMUM)", ("earthworks.batter.cut_max_slope", "earthworks.batter.fill_max_slope", "earthworks.batter.max_slope")),
        ("EARTHWORKS LIMITS (CUT AND FILL DEPTH)", ("earthworks.max_cut_m", "earthworks.max_fill_m")),
    ],
    "DRIVEWAY AND CROSSOVER": [
        ("DRIVEWAY MAXIMUM GRADE", ("driveway.max_grade_pct", "access.driveway_max_grade_pct")),
        ("VEHICLE CROSSING STANDARD DRAWING NUMBER", ("access.crossing_standard_drawing",)),
        ("DRIVEWAY PAVEMENT LAYERS AND THICKNESS", ("driveway.pavement.thickness_mm", "driveway.pavement.wearing_mm")),
        ("KERB AND GUTTER PROFILE", ("kerb.profile", "kerb.type")),
    ],
    "STORMWATER AND FLOOD": [
        ("LEGAL POINT OF STORMWATER DISCHARGE", ("stormwater.legal_point_of_discharge",)),
        ("FLOOD PLANNING LEVEL (METRES AHD)", ("flood.planning_level_m", "flood.fpl_m")),
    ],
}

# Source documents about the BUILDING (energy and water ratings, carports and garages, hot water and rainwater tanks, secondary dwellings, bushfire
# vegetation clearing) are not cited on a civil site plan set: the building is not part of it.
BUILDING_DOC_RE = re.compile(r"BASIX|CARPORT|GARAGE|HOT WATER|RAINWATER TANK|SECONDARY DWELLING|HOUSING SEPP|10/50|VEGETATION CLEARING|BUSHFIRE", re.I)

SETBACK_GROUP = "BUILDING SETBACKS (REFERENCE ONLY, BUILDING NOT SHOWN)"
SETBACK_GROUP_PLACED = "BUILDING SETBACKS (CITED; THE TYPICAL HOUSE IS PLACED TO THESE, SEE C101)"       # stage 8: heading when a building is drawn
DOC_GROUP = "STANDARDS AND DOCUMENTS CITED"
GROUP_ORDER = ["GENERAL", "SURVEY AND EXISTING SERVICES", "EARTHWORKS AND EROSION AND SEDIMENT CONTROL", "DRIVEWAY AND CROSSOVER",
               "STORMWATER AND FLOOD", SETBACK_GROUP, "STANDARDS AND APPROVALS", DOC_GROUP]


def _crossing(site):
    """(CitedCrossing or None, design vehicle (code, Typical) or None) from the council typicals; the sd107 data resolves the standard drawing, the 2.8.7 key the vehicle."""
    typ = getattr(getattr(site, "cites", None), "typ", None)
    if typ is None or not getattr(typ, "present", False):
        return None, None
    from app.agents.sa5_cad_dxf.planset import crossover as CX
    return CX.cited_crossing(typ), typ.design_vehicle()


def lga_name(council_name: str | None, lot_lga: str | None, cites_council: str | None = None) -> str:
    """Council display name, UPPERCASE, from data only.  Source document title first, then the supplied council name, then the lot LGA name."""
    for c in (cites_council, council_name, lot_lga):
        c = ST.clean(c or "").strip()
        if c:
            c = c.upper()
            return c if re.search(r"COUNCIL\b", c) else f"{c} COUNCIL"
    return "THE LOCAL COUNCIL"


def unresolved(topic: str, council: str) -> str:
    return f"COUNCIL REQUIREMENT: {topic.upper()} UNRESOLVED, CONFIRM WITH {council.upper()}"


def _cite_line(cites, label: str, keys) -> str | None:
    """A readable sentence with a short source reference for the first resolved key (never a raw key, boolean or unit string)."""
    for k in keys:
        t = PH.sentence(cites, k)
        if t:
            return t
    return None


def _rule_lines(rules: list) -> list[str]:
    """Council setback requirements from the rules JSON, cited.  The building is not part of this plan set, so the line names the BUILDING setback only."""
    out = []
    for r in rules or []:
        if not isinstance(r, dict) or r.get("value_numeric") is None:
            continue
        el = str(r.get("element", "")).replace("_", " ").upper()
        val = f"{r['value_numeric']:g} {r.get('unit', 'm')}".strip()
        src = ", ".join(str(x).replace(" - ", ", ") for x in (r.get("source_doc"), r.get("section_ref")) if x)
        pg = f", p.{r['source_page']}" if r.get("source_page") else ""
        txt = r.get("rule_text")
        out.append(f"BUILDING {el} SETBACK: {txt or val} [{src}{pg}]".upper() if src else f"BUILDING {el} SETBACK: {val} (USER ENTERED)".upper())
    return out


def _building_note(site) -> str:
    pl = getattr(site, "placement", None)
    if pl is None or not getattr(pl, "placed", False):
        return "THE BUILDING DESIGN IS NOT PART OF THIS PLAN SET: NO BUILDING FOOTPRINT OR FLOOR LEVEL IS DRAWN."
    return (f"THE BUILDING SHOWN IS THE {pl.source}: A TYPICAL HOUSE PLACED ON THE LOT TO THE CITED SETBACKS, NOT A DESIGN FOR THIS LOT. FINISHED FLOOR LEVEL IS "
            + (f"RL {pl.ffl_m:.2f} m AHD." if pl.ffl_m is not None else "TBC (NOT ASSUMED)."))


def build_notes(site, council_name: str | None = None) -> tuple[str, list[tuple[str, list[str]]]]:
    """(council display name, [(group heading, [note text, ...]), ...]).  Notes are unnumbered; the sheet numbers them."""
    cites = site.cites
    council = lga_name(council_name or getattr(site.inp, "council_name", None), getattr(site.inp.lot, "lga_name", None), getattr(cites, "council_name", None))
    groups: dict[str, list[str]] = {g: [] for g in GROUP_ORDER}
    g = groups["GENERAL"]
    g += ["THESE DRAWINGS ARE NOT A DEVELOPMENT APPLICATION, CONSTRUCTION CERTIFICATE OR BUILDING APPROVAL.",
          (_building_note(site)),
          "ITEMS LABELLED ASSUMED OR PLATFORM DEFAULT ARE NOT SURVEYED OR CONFIRMED. ITEMS LABELLED PLACEHOLDER OR TBC ARE DRAFTING CONVENTIONS, NOT DESIGN VALUES. DATA NOT AVAILABLE MEANS NOT CHECKED, NOT CLEAR.",
          "DIMENSIONS IN METRES. LEVELS IN METRES AHD."]
    g.append(f"HORIZONTAL DATUM GDA2020 / MGA (EPSG:{site.inp.lot.mga_srid}). VERTICAL DATUM AHD FROM THE NSW 5 m DEM WHERE LEVELS ARE SHOWN: INDICATIVE, VERTICAL ACCURACY NOT STATED BY THE SERVICE.")
    s_ = groups["SURVEY AND EXISTING SERVICES"]
    s_ += ["CADASTRAL BOUNDARIES AND ADJOINING LOTS ARE FROM THE STATE CADASTRE AND ARE NOT A SURVEY. ENGAGE A REGISTERED SURVEYOR.",
           "DETAIL SURVEY IS UNDERTAKEN AT THE DETAILED DESIGN STAGE. CONTOURS, LEVELS AND THE KERB LINE ARE INDICATIVE UNTIL THEN.",
           "NO EXISTING SERVICE LOCATIONS WERE SUPPLIED. LOCATE ALL SERVICES (BEFORE YOU DIG AUSTRALIA, BYDA) AND POTHOLE BEFORE EXCAVATION. DEPTHS ARE NEVER INFERRED."]
    e = groups["EARTHWORKS AND EROSION AND SEDIMENT CONTROL"]
    e += ["DRIVEWAY CUT AND FILL IS INDICATIVE (5 m DEM AGAINST THE PLATFORM DRIVEWAY PROFILE). " + ("NO BUILDING PAD LEVEL IS ASSUMED (FINISHED FLOOR LEVEL TBC): PAD EARTHWORKS ARE NOT CALCULATED." if getattr(getattr(site, "placement", None), "placed", False) else "BUILDING PAD EARTHWORKS ARE NOT PART OF THIS PLAN SET."),
          "BATTER SLOPES SHOWN ON THE TYPICAL SECTIONS ARE LABELLED 1:N TBC UNLESS A COUNCIL VALUE IS CITED BELOW. GEOTECHNICAL ADVICE IS REQUIRED."]
    d = groups["DRIVEWAY AND CROSSOVER"]
    cit, dv = _crossing(site)
    if cit is not None:
        d.append(f"VEHICLE CROSSING TO {cit.label} (C420, C600). ON-LOT DRIVEWAY PAVEMENT, THE KERB AND GUTTER PROFILE RD003 AND THE LAYBACK DRAWINGS RD0010 AND RD011 ARE NOT PUBLISHED: OBTAIN FROM COUNCIL.")
    else:
        d.append("THE COUNCIL STANDARD DRAWING GOVERNS THE VEHICLE CROSSING (NOT SELECTED). LAYOVER DIMENSIONS ARE PLACEHOLDERS WHERE MARKED.")
    veh = getattr(getattr(site.inp, "driveway", None), "design_vehicle", None) or "B85"
    if dv is not None and dv[0] == veh:
        vtxt = f"THE DESIGN VEHICLE IS {veh}, AS REQUIRED BY THE COUNCIL [{ST.clean(dv[1].ref_short).upper()}]. {veh} CHECKS ARE SCREENING ONLY."
    else:
        vtxt = f"THE DESIGN VEHICLE {veh} IS A PLATFORM DEFAULT. {veh} CHECKS ARE SCREENING ONLY."
    d += ["THE KERB LINE IS ASSUMED. BOUNDARY TO KERB DISTANCE IS A PLATFORM DEFAULT UNLESS USER SUPPLIED. " + vtxt,
          "THE SWEPT PATH IS SHOWN ONLY WHERE THE PLATFORM PATH IS ONE CLEAN PATH INSIDE THE LOT, VERGE AND ROAD, OTHERWISE IT IS TO BE CONFIRMED AT DETAILED DESIGN."]
    st = groups["STORMWATER AND FLOOD"]
    st += ["STORMWATER SHOWN IS LIMITED TO WHAT THE DATA SUPPORT. SIZES AND LEVELS TO BE DESIGNED BY A HYDRAULIC DESIGNER."]
    from app.agents.sa5_cad_dxf.planset.terrain_notes import drainage_discharge_note      # local import: terrain_notes imports this module
    dn = drainage_discharge_note(site)
    if dn:
        st.append(dn)
    sb = groups[SETBACK_GROUP]
    for ln in _rule_lines(site.inp.rules):
        sb.append(ln)
    if not any("SETBACK" in x and "UNRESOLVED" not in x for x in sb):
        sb.append(unresolved("BUILDING SETBACKS", council))
    sa = groups["STANDARDS AND APPROVALS"]
    sa.append(f"ALL WORK TO COMPLY WITH THE REQUIREMENTS OF {council} AND THE CURRENT AUSTRALIAN STANDARDS. THE COUNCIL REQUIREMENTS ABOVE ARE SUMMARIES, CHECK THE SOURCE DOCUMENT.")
    if getattr(getattr(cites, "typ", None), "present", False):
        sa.append("PAGE NUMBERS IN CITATIONS: DEVELOPMENT CONTROL PLAN PAGES ARE PDF PAGE NUMBERS. ENGINEERING STANDARDS PAGES ARE THE PRINTED PAGE NUMBERS.")
    docs = [x.upper() for x in cites.doc_list() if not BUILDING_DOC_RE.search(x)]
    if docs:
        groups[DOC_GROUP] += docs
    else:
        groups[DOC_GROUP].append(unresolved("DESIGN STANDARDS AND DOCUMENTS", council))
    for grp, items in CITED_TOPICS.items():
        for label, keys in items:
            ln = _cite_line(cites, label, keys)
            if ln:
                groups[grp].append(ln)
    for grp, items in REQUIRED_TOPICS.items():
        for label, keys in items:
            if cit is not None and label == "VEHICLE CROSSING STANDARD DRAWING NUMBER":
                continue                    # resolved: the SD-107 line above names the drawing
            ln = _cite_line(cites, label, keys)
            groups[grp].append(ln or unresolved(label, council))
    pl = getattr(site, "placement", None)
    head = {SETBACK_GROUP: SETBACK_GROUP_PLACED} if (pl is not None and getattr(pl, "placed", False)) else {}
    return council, [(head.get(k, k), v) for k, v in ((k, [x for x in groups[k] if x]) for k in GROUP_ORDER) if v]
