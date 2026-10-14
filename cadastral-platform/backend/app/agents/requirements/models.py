"""Requirement models. No value exists here without a citation or an explicit user entry (decision #8)."""
from __future__ import annotations

from datetime import date, datetime, timezone
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

PLACEHOLDER_STAMP = "PLACEHOLDER, NOT A REQUIREMENT"
# Stamp carried by every platform default value (docs/14-3d-site-design-tools.md section 7.3). A default is shown and printed
# with this text wherever it appears; it is never an LGA rule.
PLATFORM_DEFAULT_STAMP = "PLATFORM DEFAULT, LGA RULE NOT LOADED"
#: units a requirement row may carry for a dimensionless number (a ratio or a count). The ONE set used by the site object keys (``app.design.site_rules``) and
#: by the SA4 rainwater mass balance (``app.agents.sa4_hydro.rwt``); compare in lower case.
DIMENSIONLESS_UNITS = frozenset({"", "ratio", "count", "-", "1"})
# Owner decision D3: until an LGA's own value for a key is loaded the platform default applies, and the stamp says why.
STAMP_LGA_RULE_NOT_LOADED = PLATFORM_DEFAULT_STAMP                 # no rules loaded for the caller's LGA at all
STAMP_LGA_VALUE_NOT_FOUND = "PLATFORM DEFAULT, LGA VALUE NOT FOUND"   # the LGA's rules are loaded but hold no row for the key
STAMP_LGA_VALUE_UNRESOLVED = "PLATFORM DEFAULT, LGA VALUE UNRESOLVED"  # the LGA has an explicit unresolved entry for the key
PLATFORM_DEFAULT_PROFILE = "JCESITE platform default profile"


class RequirementKey(str, Enum):
    RWT_MIN_TANK_VOLUME_L = "rwt.min_tank_volume_l"
    RWT_ROOF_CONNECTION_PCT = "rwt.roof_connection_pct"
    RWT_DEMAND_CONNECTIONS = "rwt.demand_connections"
    RWT_WATER_TARGET_PCT = "rwt.water_target_pct"
    UTIL_CLEARANCE_M = "util.clearance_m"
    UTIL_BUILD_OVER_ALLOWED = "util.build_over_allowed"
    UTIL_MIN_COVER_M = "util.min_cover_m"
    SEWER_MIN_GRADE_PCT = "sewer.min_grade_pct"
    WATER_MIN_COVER_M = "water.min_cover_m"
    DRIVEWAY_MAX_GRADE_PCT = "driveway.max_grade_pct"
    DRIVEWAY_MAX_GRADE_CHANGE_PCT = "driveway.max_grade_change_pct"
    DRIVEWAY_MIN_WIDTH_M = "driveway.min_width_m"
    DRIVEWAY_MAX_WIDTH_M = "driveway.max_width_m"
    DRIVEWAY_MIN_SEPARATION_M = "driveway.min_separation_m"
    # setback.<element> values come from SA2's SetbackRule pipeline (not duplicated here)


KEY_HELP = {
    RequirementKey.RWT_MIN_TANK_VOLUME_L: "minimum rainwater tank volume (L)",
    RequirementKey.RWT_ROOF_CONNECTION_PCT: "minimum % of roof area connected to the tank",
    RequirementKey.RWT_DEMAND_CONNECTIONS: "number of demand connections (toilets/laundry/etc) required",
    RequirementKey.RWT_WATER_TARGET_PCT: "water-saving / reliability target (%)",
    RequirementKey.UTIL_CLEARANCE_M: "horizontal clearance (m) from a utility of this service/diameter",
    RequirementKey.UTIL_BUILD_OVER_ALLOWED: "whether building over this service is permitted",
    RequirementKey.UTIL_MIN_COVER_M: "minimum cover (m) over this utility",
    RequirementKey.SEWER_MIN_GRADE_PCT: "minimum sewer grade (%) for this diameter",
    RequirementKey.WATER_MIN_COVER_M: "minimum water service cover (m)",
    RequirementKey.DRIVEWAY_MAX_GRADE_PCT: "maximum driveway grade (%)",
    RequirementKey.DRIVEWAY_MAX_GRADE_CHANGE_PCT: "maximum change of grade (%)",
    RequirementKey.DRIVEWAY_MIN_WIDTH_M: "minimum crossover/driveway width (m)",
    RequirementKey.DRIVEWAY_MAX_WIDTH_M: "maximum crossover/driveway width (m)",
    RequirementKey.DRIVEWAY_MIN_SEPARATION_M: "minimum crossover separation from corner/intersection (m)",
}


EXTRA_KEY_HELP: dict[str, str] = {}      # keys registered by extensions (e.g. app.jurisdiction custom keys)

# Stormwater keys used by the 3D site design tools (stage 2B). osd_required and psd_l_s have a platform default
# (knowledge/platform_default/requirements.json); osd_method and ssr_m3 have none and stay UNRESOLVED until an LGA supplies them.
STORMWATER_KEY_HELP: dict[str, str] = {
    "stormwater.osd_required": "whether on-site detention (OSD) is required for this LGA",
    "stormwater.psd_l_s": "permissible site discharge (PSD), litres per second",
    "stormwater.osd_method": "the OSD sizing method the LGA prescribes (e.g. a named procedure or table)",
    "stormwater.ssr_m3": "site storage requirement (SSR), cubic metres",
}
EXTRA_KEY_HELP.update(STORMWATER_KEY_HELP)

# Driveway keys used by the 3D site design tools (stage 6) that are not in the SA3 standard set above. None has a platform default: unresolved until an
# LGA row or a user entry supplies the value.
DRIVEWAY_KEY_HELP: dict[str, str] = {
    "driveway.crossover_splay_m": "kerb return splay of the crossover footprint (m), measured along the kerb line from each side of the crossover width",
}
EXTRA_KEY_HELP.update(DRIVEWAY_KEY_HELP)

# Keys used by the stage 7 site object checks (rainwater tank, retaining wall, infiltration trench, OSD, pits and pipes, pool, footpath, tree, landscape).
# The canonical unit and value kind of each key are in ``app.design.object_keys`` (a test keeps the two lists in step). NONE of these keys has a platform
# default except stormwater.osd_required and stormwater.psd_l_s above: each is UNRESOLVED until an LGA row, a state row or a user entry supplies it.
SITE_OBJECT_KEY_HELP: dict[str, str] = {
    "rwt.max_height_m": "maximum height of a rainwater tank (m)",
    "rwt.max_height_m.urban_zones": "maximum height of a rainwater tank in urban zones (m); the zone of the lot is not checked by the tool",
    "rwt.location_behind_street_setback": "whether a rainwater tank must be located behind the street setback of the existing or proposed dwelling",
    "rwt.underground_tank_min_clearance_m": "minimum clearance (m) of an underground tank from a water main, sewer main or on-site wastewater system",
    "rwt.min_boundary_distance_m": "minimum distance (m) from a rainwater tank to a lot boundary",
    "rwt.runoff_coefficient": "roof runoff coefficient used in the rainwater tank mass balance (ratio)",
    "rwt.first_flush_mm": "first flush depth taken from each rain day before water enters the tank (mm)",
    "rwt.demand.occupants": "number of occupants used for the rainwater tank demand",
    "rwt.demand.toilet_l_pp_day": "toilet demand supplied from the tank (L per person per day)",
    "rwt.demand.laundry_l_pp_day": "laundry demand supplied from the tank (L per person per day)",
    "rwt.demand.garden_l_m2_day": "garden irrigation demand supplied from the tank (L per square metre per day)",
    "rwt.demand.garden_monthly_factor": "twelve monthly factors (January to December, comma separated) applied to the garden demand",
    "rwt.candidate_sizes_l": "candidate tank volumes tested in the mass balance (L, comma separated)",
    "rwt.tank_height_m": "tank height used to turn a volume into a diameter in the mass balance sizing (m)",
    "rwt.wet_day_fraction": "fraction of days in a month on which the monthly rainfall is assumed to fall (ratio)",
    "retaining.soil_friction_angle_deg": "soil friction angle (degrees) for retaining wall screening",
    "retaining.soil_unit_weight_kn_m3": "soil unit weight (kN per cubic metre) for retaining wall screening",
    "retaining.wall_friction_ratio": "wall friction as a ratio of the soil friction angle, for retaining wall screening",
    "retaining.gravity_wall_width_ratio": "base width of the screening gravity wall as a ratio of its height",
    "retaining.wall_unit_weight_kn_m3": "unit weight of the screening wall material (kN per cubic metre)",
    "retaining.min_fs_sliding": "minimum factor of safety against sliding for screening",
    "retaining.min_fs_overturning": "minimum factor of safety against overturning for screening",
    "retaining.surcharge_kpa": "surcharge on the retained ground (kPa) for screening; a project value may be entered on the wall instead",
    "retaining.certification_height_m": "retained height (m) above which engineer certification or approval is required",
    "retaining.type_max_height_m.sleeper": "maximum retained height (m) for a sleeper wall",
    "retaining.type_max_height_m.block": "maximum retained height (m) for a block wall",
    "retaining.type_max_height_m.concrete": "maximum retained height (m) for a concrete wall",
    "infiltration.min_offset_boundary_m": "minimum offset (m) of an infiltration trench from a lot boundary",
    "infiltration.min_offset_building_m": "minimum offset (m) of an infiltration trench from a building",
    "infiltration.min_offset_service_m": "minimum offset (m) of an infiltration trench from a service",
    "stormwater.orifice_discharge_coefficient": "discharge coefficient Cd of an OSD outlet orifice (ratio)",
    "stormwater.osd_min_orifice_diameter_mm": "minimum diameter (mm) of an OSD outlet orifice",
    "stormwater.min_pipe_grade_pct": "minimum stormwater pipe grade (%)",
    "stormwater.min_cover_m": "minimum cover over stormwater pipes (m)",
    "stormwater.min_pipe_diameter_mm": "minimum stormwater pipe diameter (mm)",
    "stormwater.pipe_bends_at_pits_only": "whether a stormwater pipe may change direction only at a pit",
    "pool.barrier_min_height_m": "minimum height (m) of a pool barrier",
    "pool.barrier_min_setback_m": "minimum setback (m) of a pool barrier from the lot boundary",
    "footpath.min_width_m": "minimum footpath width (m)",
    "footpath.max_crossfall_pct": "maximum footpath crossfall (%)",
    "footpath.min_crossfall_pct": "minimum footpath crossfall (%)",
    "tree.tpz_dbh_multiplier": "tree protection zone radius as a multiple of the trunk diameter (DBH), as AS 4970 states it",
    "tree.tpz_min_radius_m": "minimum tree protection zone radius (m)",
    "tree.tpz_max_radius_m": "maximum tree protection zone radius (m)",
    "tree.srz_coefficient": "coefficient c of the structural root zone formula R = c x D^e, with D the trunk diameter (DBH) in metres and R the radius in metres, as the rule states it",
    "tree.srz_exponent": "exponent e of the structural root zone formula R = c x D^e, with D the trunk diameter (DBH) in metres and R the radius in metres, as the rule states it",
    "tree.srz_min_radius_m": "minimum structural root zone radius (m)",
    **{f"landscape.runoff_coefficient.{k}": f"runoff coefficient of a {k.replace('_', ' ')} surface (ratio)"
       for k in ("turf", "garden_bed", "mulch", "gravel", "permeable_paving", "impervious_paving")},
}
EXTRA_KEY_HELP.update(SITE_OBJECT_KEY_HELP)

# Keys used by the stage 8 service tools (existing services, sewer drain, water service, clashes). NONE has a platform default: each is UNRESOLVED until an LGA row,
# a state row, an authority row or a user entry supplies it. util.clearance_m, util.build_over_allowed, sewer.min_grade_pct and water.min_cover_m already exist (above)
# and are read with their selectors (service, diameter, authority = the asset owner).
SERVICE_KEY_HELP: dict[str, str] = {
    "sewer.min_cover_m.open_ground": "minimum cover (m) to the crown of a property sewer drain under open ground (lawn, garden, unpaved)",
    "sewer.min_cover_m.footpath": "minimum cover (m) to the crown of a property sewer drain under a footpath or paved area",
    "sewer.min_cover_m.driveway": "minimum cover (m) to the crown of a property sewer drain under a driveway or trafficable area",
    "sewer.max_connection_depth_m": "maximum depth (m) of the property sewer drain invert below ground at the connection to the main",
    "sewer.min_clearance_to_building_m": "minimum horizontal clearance (m) from a property sewer drain to a building",
    "sewer.inspection_opening_max_spacing_m": "maximum spacing (m) between inspection openings or pits along a property sewer drain",
    "sewer.inspection_opening_max_deflection_deg": "largest change of direction (degrees) of a property sewer drain before an inspection opening or pit is required",
    "sewer.zone_of_influence.angle_deg": "angle (degrees from horizontal) of the zone of influence line of a sewer main, rising from the offset at the pipe invert to the surface",
    "sewer.zone_of_influence.offset_m": "horizontal offset (m) from the centreline of a sewer main to the zone of influence line at the level of the pipe invert",
    "util.min_vertical_clearance_m": "minimum vertical clearance (m) between a service and another service where they cross",
    "util.build_over_allowed": "whether building over this service is permitted by the asset owner (read with the service kind and the asset owner)",
    "rwt.mains_backup_required": "whether a rainwater tank that supplies indoor reuse must have a mains water backup connection",
    "dbyd.plan_validity_days": "number of days a DBYD response plan stays valid from its plan date, as the asset owner or BYDA states it",
}
EXTRA_KEY_HELP.update(SERVICE_KEY_HELP)

# Keys used by the stage 9 stormwater helper. NONE has a platform default (the only two are stormwater.osd_required and stormwater.psd_l_s). Each is UNRESOLVED until an
# LGA row, a state row or a user entry supplies it. stormwater.osd_method is a text key: the name of the sizing method the LGA prescribes (see ``app.stormwater.osd``).
STORMWATER_HELPER_KEY_HELP: dict[str, str] = {
    "stormwater.design_aep_pct": "annual exceedance probability (percent) of the design storm for on site detention sizing",
    "stormwater.tc_pre_min": "time of concentration (minutes) of the pre development site, where the rule states one",
    "stormwater.tc_post_min": "time of concentration (minutes) of the post development site, where the rule states one",
    "stormwater.ssr_m3_per_ha": "site storage requirement (SSR) per hectare, cubic metres per hectare",
    "stormwater.rainwater_tank_excluded_from_detention_volume": "whether the detention portion of a rainwater tank is excluded from the on site detention volume",
    **{f"stormwater.runoff_coefficient.{k}": f"runoff coefficient of a {k.replace('_', ' ')} surface for the design event (ratio)"
       for k in ("roof", "pool", "concrete", "asphalt", "pavers", "gravel", "permeable_pavers")},
    "infiltration.max_emptying_time_h": "longest time (hours) an infiltration trench may take to empty",
}
EXTRA_KEY_HELP.update(STORMWATER_HELPER_KEY_HELP)


def key_help(key: str) -> str:
    try:
        return KEY_HELP.get(RequirementKey(key), key)
    except ValueError:
        return EXTRA_KEY_HELP.get(key, key)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class M(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Selectors(M):
    jurisdiction: str | None = None
    authority: str | None = None
    lga: str | None = None
    zone: str | None = None
    service: str | None = None
    dia_min_mm: int | None = None
    dia_max_mm: int | None = None

    def specificity(self) -> int:
        return sum(v is not None for v in self.model_dump().values())

    def canon(self) -> str:
        return "|".join(f"{k}={str(v).casefold()}" for k, v in sorted(self.model_dump().items()) if v is not None)


class Source(M):
    document_title: str = ""
    authority: str = ""
    version: str | None = None
    effective_date: date | None = None
    page: int | None = None
    section_ref: str | None = None
    quote: str = ""
    source_url: str | None = None
    retrieved_at: datetime = Field(default_factory=_now)
    sha256: str = ""
    chunk_id: str | None = None
    # custom municipalities: the quote above is ALWAYS the original-language text (what the validator checks);
    # the English gloss is a machine translation for the reader only
    language: str | None = None
    quote_en: str | None = None
    quote_en_machine_translated: bool = False
    entered_by: str | None = None      # user_entered only
    entered_at: datetime | None = None

    def cite(self) -> str:
        if self.entered_by:
            return f"user-entered by {self.entered_by}"
        return f"{self.document_title} ({self.authority}) p.{self.page} s.{self.section_ref}: \"{self.quote}\""


class Requirement(M):
    key: str
    applies_to: Selectors = Field(default_factory=Selectors)
    value: float | bool | str | None = None
    value_struct: dict[str, Any] | None = None
    unit: str | None = None
    source: Source | None = None
    extraction_method: Literal["table", "llm", "user_entered", "regex", "platform_default"] | None = None
    confidence: float = 0.0
    status: Literal["resolved", "unresolved", "user_confirmed", "conflict", "platform_default"] = "unresolved"
    prompt: str | None = None                      # what to ask the user when unresolved/conflict
    alternatives: list["Requirement"] = Field(default_factory=list)   # conflict: the competing citations
    verified_by: str | None = None
    entered_value: float | None = None             # user entry exactly as typed, in entered_unit (value/unit hold the canonical form)
    entered_unit: str | None = None
    default_profile: str | None = None             # platform_default only: the profile the default belongs to
    default_stamp: str | None = None               # platform_default only: why the default applies (one of the STAMP_ constants)
    notes: str | None = None                       # unresolved entries: what was looked for (e.g. unresolved.json "looked")
    lga_entry_prompt: str | None = None            # platform_default result: prompt of the LGA's unresolved entry, if any
    lga_entry_notes: str | None = None             # platform_default result: notes of the LGA's unresolved entry, if any

    def quantity(self, ctx=None):
        """(value, unit) as a Quantity; raises UnitMismatch/UnitError when unit is missing or unknown."""
        from app.jurisdiction.units import Quantity, UnitError
        if self.value is None or isinstance(self.value, (bool, str)) or self.unit is None:
            raise UnitError(f"{self.key}: no numeric (value, unit) to convert")
        return Quantity(float(self.value), self.unit, ctx)

    def value_in(self, unit: str, ctx=None) -> float:
        """Dimensional-analysis conversion, e.g. value_in('ft'). UnitMismatch if the dimensions differ."""
        return self.quantity(ctx).to(unit).value

    @property
    def usable(self) -> bool:
        return self.status in ("resolved", "user_confirmed", "platform_default") and self.value is not None

    @property
    def is_platform_default(self) -> bool:
        return self.status == "platform_default"

    @property
    def stamp(self) -> str | None:
        """The stamp of a platform default (default_stamp, else PLATFORM_DEFAULT_STAMP), else None. Callers print it beside the value."""
        return (self.default_stamp or PLATFORM_DEFAULT_STAMP) if self.is_platform_default else None

    def citation(self) -> str:
        if self.is_platform_default:
            s = self.source
            when = f" ({s.effective_date:%d/%m/%Y})" if s and s.effective_date and f"{s.effective_date:%d/%m/%Y}" not in s.document_title else ""
            return f"{self.stamp}: {s.document_title if s else self.default_profile or ''}{when}"
        return self.source.cite() if self.source else ""

    def describe(self) -> str:
        """Value with unit, followed by the stamp when the value is a platform default, e.g. '2 L/s [PLATFORM DEFAULT, ...]'."""
        v = self.value
        if isinstance(v, bool):
            v = "yes" if v else "no"
        elif isinstance(v, float) and v == int(v):
            v = int(v)
        txt = f"{v} {self.unit}".strip() if self.unit and not isinstance(self.value, bool) else str(v)
        return f"{txt} [{self.stamp}]" if self.is_platform_default else txt

    def lga_code(self) -> str | None:
        """Normalised LGA code of the row's selectors ("nsw-gunnedah"), None for state-wide rows and platform defaults."""
        from .lgacode import normalise_lga_code
        return normalise_lga_code(self.applies_to.jurisdiction, self.applies_to.lga)

    def to_db_row(self) -> dict[str, Any]:
        s = self.source or Source()
        return {"requirement_key": self.key, "applies_to": self.applies_to.model_dump(mode="json"),
                "value_json": self.value if self.value_struct is None else self.value_struct, "unit": self.unit,
                "status": self.status, "extraction_method": self.extraction_method, "confidence": self.confidence,
                "doc_title": s.document_title, "authority": s.authority, "version_label": s.version,
                "effective_date": s.effective_date, "page": s.page, "section_ref": s.section_ref, "quote": s.quote,
                "source_url": s.source_url, "retrieved_at": s.retrieved_at, "file_sha256": s.sha256,
                "entered_by": s.entered_by, "entered_at": s.entered_at, "verified_by": self.verified_by,
                "prompt": self.prompt,
                "entered_value": self.entered_value, "entered_unit": self.entered_unit, "quote_language": s.language,
                "quote_en": s.quote_en, "quote_en_machine_translated": s.quote_en_machine_translated,
                "lga_code": self.lga_code(),
                "default_profile": (self.default_profile or PLATFORM_DEFAULT_PROFILE) if self.is_platform_default else None,
                "default_stamp": self.stamp}


class UnresolvedRequirement(Exception):
    def __init__(self, key: str, selectors: dict[str, Any], prompt: str, conflict: "Requirement | None" = None):
        super().__init__(f"{key} unresolved for {selectors}: {prompt}")
        self.key, self.selectors, self.prompt, self.conflict = key, selectors, prompt, conflict


class UnresolvedItem(M):
    """Reported by agents in place of a defaulted value."""
    key: str
    selectors: dict[str, Any] = Field(default_factory=dict)
    prompt: str
    conflict: bool = False


def to_item(e: UnresolvedRequirement) -> UnresolvedItem:
    return UnresolvedItem(key=e.key, selectors=e.selectors, prompt=e.prompt, conflict=e.conflict is not None)


from .lgacode import lga_state, same_lga  # noqa: E402  (pure module, no import cycle)


def _ci(a: str | None, b: str | None) -> bool:
    return (a or "").casefold() == (b or "").casefold()


CONTEXT_SEL = ("jurisdiction", "authority", "lga", "zone")


class RequirementSet(M):
    requirements: list[Requirement] = Field(default_factory=list)
    # LGAs whose knowledge folder was loaded into this set (jurisdiction + lga name). An LGA listed here, or one that has any
    # row of its own in `requirements`, counts as "rules loaded" when a platform default is stamped.
    loaded: list[Selectors] = Field(default_factory=list)

    def add(self, r: Requirement) -> None:
        self.requirements.append(r)

    def _match(self, r: Requirement, key: str, q: dict[str, Any]) -> bool:
        if r.key != key and not (r.status == "unresolved" and r.key.endswith(".*") and key.startswith(r.key[:-1])):
            return False                           # (an unresolved "x.*" entry stands for every key under x.)
        a = r.applies_to
        # LGA isolation: a row that names an LGA matches only when the caller names a matching LGA (never a no-selector call).
        if a.lga is not None and q.get("lga") is None:
            return False
        for f in CONTEXT_SEL:                      # context selectors: checked only when the caller supplies them
            if getattr(a, f) is None or q.get(f) is None:
                continue
            if f == "lga":                         # "GUNNEDAH", "Gunnedah Shire Council" and "nsw-gunnedah" are one LGA; state must agree
                # Known limitation: an LGA row carrying no state (no jurisdiction, no state prefix) matches by name only.
                # All shipped LGA rows carry a jurisdiction; the loader must keep it that way (docs/14 section 7.2).
                ok = same_lga(a.lga, str(q["lga"]), a.jurisdiction or lga_state(a.lga), self._caller_state(q))
            else:
                ok = _ci(getattr(a, f), str(q[f]))
            if not ok:
                return False
        if a.service is not None and not _ci(a.service, q.get("service")):
            return False
        if a.dia_min_mm is not None or a.dia_max_mm is not None:
            d = q.get("dia_mm")
            if d is None or d < (a.dia_min_mm or 0) or (a.dia_max_mm is not None and d > a.dia_max_mm):
                return False
        return True

    def _caller_state(self, q: dict[str, Any]) -> str | None:
        return (str(q["jurisdiction"]).strip().upper() if q.get("jurisdiction") else None) or lga_state(q.get("lga"))

    def _match_default(self, r: Requirement, key: str, q: dict[str, Any]) -> bool:
        """A platform default applies only when the caller's jurisdiction is known and matches the default row's."""
        st = self._caller_state(q)
        if st is None or r.key != key:
            return False
        if r.applies_to.jurisdiction is not None and not _ci(r.applies_to.jurisdiction, st):
            return False
        return self._match(r, key, {**q, "jurisdiction": st})

    def lga_rules_loaded(self, q: dict[str, Any]) -> bool:
        """True when rules for the caller's LGA are in this set (a loaded folder, or any non-default row naming that LGA)."""
        lga = q.get("lga")
        if not lga:
            return False
        st = self._caller_state(q)
        if any(l.lga and same_lga(l.lga, str(lga), l.jurisdiction, st) for l in self.loaded):
            return True
        return any(r.status != "platform_default" and r.applies_to.lga and same_lga(r.applies_to.lga, str(lga), r.applies_to.jurisdiction, st)
                   for r in self.requirements)

    def get_requirement(self, key: "str | RequirementKey", **sel: Any) -> Requirement:
        k = key.value if isinstance(key, RequirementKey) else key
        shown = {a: b for a, b in sel.items() if b is not None}
        if "service" not in shown and k.split(".")[0] in ("sewer", "water"):
            shown["service"] = k.split(".")[0]
        # Resolution order: project user_confirmed > LGA-specific resolved > state-wide resolved (these two by selector
        # specificity, unchanged) > platform_default (only when nothing cited matches) > UnresolvedRequirement.
        # A cited value always beats the default; a conflict entry always raises; an LGA unresolved entry lets the default
        # apply but changes its stamp (owner decision D3: the default applies regardless of LGA, and says why).
        hits = [r for r in self.requirements if r.status not in ("unresolved", "platform_default") and self._match(r, k, shown)]
        confirmed = [r for r in hits if r.status == "user_confirmed"]
        pool = confirmed or hits
        if pool:
            top = max(r.applies_to.specificity() for r in pool)
            best = [r for r in pool if r.applies_to.specificity() == top]
            conf = [r for r in best if r.status == "conflict"]
            if conf:
                raise UnresolvedRequirement(k, shown, conf[0].prompt or "conflicting sources; confirm which applies", conf[0])
            vals = {str(r.value) for r in best}
            if len(vals) > 1:
                raise UnresolvedRequirement(k, shown, "conflicting values at equal specificity; confirm which applies")
            return best[0]
        defaults = [r for r in self.requirements if r.status == "platform_default" and r.value is not None and self._match_default(r, k, shown)]
        entry = next((r for r in self.requirements if r.status == "unresolved" and r.applies_to.lga is not None and self._match(r, k, shown)), None)
        if defaults:
            top = max(r.applies_to.specificity() for r in defaults)
            d = next(r for r in defaults if r.applies_to.specificity() == top).model_copy(deep=True)
            if entry is not None:
                d.default_stamp, d.lga_entry_prompt, d.lga_entry_notes = STAMP_LGA_VALUE_UNRESOLVED, entry.prompt, entry.notes
            elif self.lga_rules_loaded(shown):
                d.default_stamp = STAMP_LGA_VALUE_NOT_FOUND
            else:
                d.default_stamp = STAMP_LGA_RULE_NOT_LOADED
            return d
        help_ = key_help(k)
        pr = (entry.prompt if entry is not None else None) or next(
            (r.prompt for r in self.requirements if r.key == k and r.status == "unresolved" and r.prompt), None)
        raise UnresolvedRequirement(k, shown, pr or f"Not found in the governing documents: please supply {help_} "
                                    f"with its source, for {shown or 'this lot'}.")

    def get(self, key: "str | RequirementKey", **sel: Any) -> Any:
        return self.get_requirement(key, **sel).value

    def unresolved(self) -> list[Requirement]:
        return [r for r in self.requirements if r.status in ("unresolved", "conflict")]

    def citations(self) -> list[Requirement]:
        return [r for r in self.requirements if r.usable]
