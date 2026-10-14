"""Readable sentences for cited requirements (reference style sheets only; the legacy A3 sheets keep ``Cites.line``).

One sentence per requirement, UPPERCASE, with the number and its unit written out and a short source reference.  A key without a sentence here is
dropped from the sheets rather than printed raw, and a requirement that only makes sense for the dwelling (habitable floor level) is not used at all
because this plan set is site only.
"""
from __future__ import annotations

import re

from app.agents.sa5_cad_dxf.planset import style as ST

_UNIT = {"m": " m", "mm": " mm", "percent": "%", "days": " DAYS", "count": "", None: ""}


def num(c) -> str:
    """Value with its unit: 0.5 m, 150 mm, 5%, 3 DAYS."""
    v = c.value
    if isinstance(v, bool):
        return ""
    if isinstance(v, (int, float)):
        t = f"{v:g}"
        u = _UNIT.get(c.unit, f" {str(c.unit).upper()}" if c.unit else "")
        return t + u
    return ST.clean(str(v)).upper()


def short_ref(c) -> str:
    """[SOURCE DOCUMENT, SECTION NUMBER, P.n]"""
    m = re.match(r"\s*([A-Z]?\d+(?:\.\d+)*(?:\([a-z0-9]+\))?)", c.section or "")
    parts = [c.doc] + ([m.group(1)] if m else []) + ([f"P.{c.page}"] if c.page else [])
    return "[" + ", ".join(parts).upper() + "]"


def _txt(c) -> str:
    return ST.clean(str(c.value)).upper()


# key -> function(cite, cites) -> sentence (without reference); returning None drops the item
SENT = {
    "water.min_cover_m": lambda c, k: f"MINIMUM COVER TO WATER SERVICES UNDER CARRIAGEWAYS IS {num(c)}",
    "water.min_cover_m.footway_reserve": lambda c, k: f"MINIMUM COVER TO WATER SERVICES IN THE FOOTWAY IS {num(c)}",
    "sewer.junction_min_diameter_mm": lambda c, k: f"A SEWER JUNCTION OF {num(c)} DIAMETER IS PROVIDED WITHIN EACH LOT",
    "sewer.house_connection_min_cover_m": lambda c, k: f"SEWER HOUSE CONNECTIONS ARE LAID WITH AT LEAST {num(c)} OF COVER",
    "sewer.house_connection_min_grade_1_in": lambda c, k: f"SEWER HOUSE CONNECTIONS ARE LAID AT A MINIMUM GRADE OF 1 IN {c.value:g}",
    "util.build_over_sewer_policy": lambda c, k: "BUILDING NEAR A COUNCIL SEWER MAIN IS SUBJECT TO THE COUNCIL BUILDING OVER SEWER POLICY (POLICY DOCUMENT NOT OBTAINED)",
    "utilities.servicing_strategy_required": lambda c, k: "A SERVICING STRATEGY IS REQUIRED WITH THE DEVELOPMENT APPLICATION",
    "site.slope_geotech_threshold_pct": lambda c, k: f"A DETAILED GEOTECHNICAL INVESTIGATION IS REQUIRED FOR DEVELOPMENT ON SLOPES GREATER THAN {num(c)}",
    "esc.topsoil.strip_depth_min_mm": lambda c, k: (f"TOPSOIL IS USUALLY STRIPPED TO A DEPTH OF {c.value:g} TO {num(k.get('esc.topsoil.strip_depth_max_mm'))}"
                                                     if k.get("esc.topsoil.strip_depth_max_mm") else f"TOPSOIL IS USUALLY STRIPPED TO A DEPTH OF AT LEAST {num(c)}"),
    "esc.topsoil.stockpile_max_depth_m": lambda c, k: f"TOPSOIL STOCKPILES ARE NO GREATER THAN {num(c)} DEEP",
    "esc.stockpile.max_height_m": lambda c, k: f"STOCKPILES ARE TO BE NO MORE THAN {num(c)} HIGH WHERE POSSIBLE",
    "esc.sediment_fence.post_spacing_m": lambda c, k: f"SEDIMENT FENCE STAR PICKETS ARE USUALLY {num(c)} APART",
    "esc.sediment_fence.trench_depth_mm": lambda c, k: f"THE SEDIMENT FENCE TRENCH IS {num(c)} DEEP ON THE UPSLOPE SIDE",
    "esc.access.min_length_m": lambda c, k: f"STABILISED SITE ACCESS IS AT LEAST {num(c)} LONG",
    "esc.access.min_width_m": lambda c, k: f"STABILISED SITE ACCESS IS AT LEAST {num(c)} WIDE",
    "esc.escp.prepared_by_suitably_qualified_person": lambda c, k: "THE ESCP IS TO BE PREPARED BY A SUITABLY QUALIFIED PERSON",
    "esc.inspection.min_frequency": lambda c, k: f"ESC MEASURES ARE TO BE INSPECTED {_txt(c)}",
    "esc.trench.max_open_days": lambda c, k: f"SERVICE TRENCHES ARE TO BE OPEN FOR LESS THAN {num(c)}",
    "access.crossing_standard": lambda c, k: f"ACCESS FROM THE PUBLIC ROAD TO THE PROPERTY BOUNDARY IS TO COMPLY WITH {_txt(c)}",
    "driveway.min_width_m": lambda c, k: f"DRIVEWAY ACCESS WIDTH (EXCLUDING LAYBACK SPLAYS) IS AT LEAST {num(c)}",
    "driveway.max_width_m": lambda c, k: f"DRIVEWAY ACCESS WIDTH (EXCLUDING LAYBACK SPLAYS) IS NO MORE THAN {num(c)}",
    "driveway.min_separation_m": lambda c, k: f"MINIMUM DISTANCE FROM A CROSSING TO A CORNER ALLOTMENT BOUNDARY IS {num(c)}",
    "driveway.min_crossing_kerb_separation_m": lambda c, k: f"MINIMUM KERB SEPARATION BETWEEN CROSSINGS IS {num(c)}",
    "driveway.min_separation_from_common_boundary_m": lambda c, k: f"MINIMUM DISTANCE BETWEEN A CROSSING AND THE COMMON PROPERTY BOUNDARY IS {num(c)}",
    "driveway.max_crossings_per_frontage": lambda c, k: f"NO MORE THAN {c.value:g} CROSSINGS ARE PERMITTED PER STREET FRONTAGE",
    "access.internal_surface": lambda c, k: f"INTERNAL VEHICLE ACCESS AND MANOEUVRING AREAS ARE CONSTRUCTED OF {_txt(c)}",
    "parking.dwelling_house.spaces": lambda c, k: f"COUNCIL PARKING PROVISION FOR A DWELLING HOUSE IS {c.value:g} SPACES (THE DWELLING IS NOT PART OF THIS SET)",
    "stormwater.designed_per_eng_standards": lambda c, k: f"STORMWATER SYSTEMS ARE TO BE DESIGNED AND CONSTRUCTED IN ACCORDANCE WITH {_txt(c)}",
    "stormwater.osd_roof_plumbing_design_aep_pct": lambda c, k: f"ROOF WATER PLUMBING IS DESIGNED FOR THE {num(c)} AEP EVENT",
    "flood.planning_level_aep_pct": lambda c, k: (f"THE COUNCIL FLOOD PLANNING LEVEL IS THE {num(c)} AEP FLOOD PLUS {num(k.get('flood.freeboard_m'))} FREEBOARD"
                                                  if k.get("flood.freeboard_m") else f"THE COUNCIL FLOOD PLANNING LEVEL IS BASED ON THE {num(c)} AEP FLOOD"),
    "basix.certificate_required_new_dwelling": lambda c, k: "A BASIX CERTIFICATE IS REQUIRED FOR A NEW DWELLING (THE DWELLING IS NOT PART OF THIS SET)",
}


def sentence(cites, key: str) -> str | None:
    """'<SENTENCE> [SOURCE, SECTION, P.n]' for a resolved requirement with a phrase, else None."""
    c = cites.get(key)
    f = SENT.get(key)
    if c is None or f is None:
        return None
    try:
        t = f(c, cites)
    except Exception:  # noqa: BLE001 - a value of an unexpected type drops the line rather than printing a raw key
        return None
    t = _expand_council_initials(t, getattr(cites, "council_name", None))
    return f"{t} {short_ref(c)}" if t else None


def _expand_council_initials(t: str | None, council: str | None) -> str | None:
    """A cited value may carry the council's own initialism ("GSC Engineering Design ..."): it is written out in full from the council name in the
    source document title (initials computed from that name, so no council is typed here)."""
    if not t or not council:
        return t
    ini = "".join(w[0] for w in council.split() if w[:1].isupper())
    return re.sub(rf"\b{re.escape(ini)}\b", council, t) if len(ini) >= 2 else t
