"""Requirement keys used by the stage 7 site object checks (rainwater tank, retaining wall, trench, OSD, pipes, pool, footpath, tree, landscape).

This table is the single list of the keys, their canonical unit and their value kind. The help text of every key is registered in
``app.agents.requirements.models.SITE_OBJECT_KEY_HELP`` (a test keeps the two in step). No key here has a default value: the platform default profile
(``knowledge/platform_default/requirements.json``) holds ``stormwater.osd_required`` and ``stormwater.psd_l_s`` only (docs/14 section 7.3), so every other key is
UNRESOLVED until an LGA row, a state row or a user entry supplies it.

Kinds: ``number`` (a number in the canonical unit), ``ratio`` (a dimensionless number), ``count`` (a whole number), ``bool`` (true or false), ``list`` (a comma separated
list of numbers; ``length`` gives the number of items when it is fixed).
"""
from __future__ import annotations

from dataclasses import dataclass

from app.agents.requirements.models import DIMENSIONLESS_UNITS  # noqa: F401  (one shared constant: see below)


@dataclass(frozen=True)
class KeySpec:
    key: str
    unit: str          # canonical unit ('' for a boolean or a list)
    kind: str          # number, ratio, count, bool, list
    group: str
    length: int | None = None


def _n(key: str, unit: str, group: str) -> KeySpec:
    return KeySpec(key, unit, "number", group)


SPECS: tuple[KeySpec, ...] = (
    # rainwater tank (existing keys first, then the SA4 mass balance inputs moved out of code, then the placement rules)
    _n("rwt.max_height_m", "m", "rwt"),
    _n("rwt.max_height_m.urban_zones", "m", "rwt"),
    KeySpec("rwt.location_behind_street_setback", "", "bool", "rwt"),
    _n("rwt.underground_tank_min_clearance_m", "m", "rwt"),
    _n("rwt.min_boundary_distance_m", "m", "rwt"),
    KeySpec("rwt.runoff_coefficient", "ratio", "ratio", "rwt"),
    _n("rwt.first_flush_mm", "mm", "rwt"),
    KeySpec("rwt.demand.occupants", "count", "count", "rwt"),
    _n("rwt.demand.toilet_l_pp_day", "L/person/day", "rwt"),
    _n("rwt.demand.laundry_l_pp_day", "L/person/day", "rwt"),
    _n("rwt.demand.garden_l_m2_day", "L/m2/day", "rwt"),
    KeySpec("rwt.demand.garden_monthly_factor", "", "list", "rwt", 12),
    KeySpec("rwt.candidate_sizes_l", "", "list", "rwt"),
    _n("rwt.tank_height_m", "m", "rwt"),
    KeySpec("rwt.wet_day_fraction", "ratio", "ratio", "rwt"),
    # retaining wall screening (values of WallAssumptions and the certification height)
    _n("retaining.soil_friction_angle_deg", "deg", "retaining"),
    _n("retaining.soil_unit_weight_kn_m3", "kN/m3", "retaining"),
    KeySpec("retaining.wall_friction_ratio", "ratio", "ratio", "retaining"),
    KeySpec("retaining.gravity_wall_width_ratio", "ratio", "ratio", "retaining"),
    _n("retaining.wall_unit_weight_kn_m3", "kN/m3", "retaining"),
    KeySpec("retaining.min_fs_sliding", "ratio", "ratio", "retaining"),
    KeySpec("retaining.min_fs_overturning", "ratio", "ratio", "retaining"),
    _n("retaining.surcharge_kpa", "kPa", "retaining"),
    _n("retaining.certification_height_m", "m", "retaining"),
    _n("retaining.type_max_height_m.sleeper", "m", "retaining"),
    _n("retaining.type_max_height_m.block", "m", "retaining"),
    _n("retaining.type_max_height_m.concrete", "m", "retaining"),
    # infiltration trench offsets
    _n("infiltration.min_offset_boundary_m", "m", "infiltration"),
    _n("infiltration.min_offset_building_m", "m", "infiltration"),
    _n("infiltration.min_offset_service_m", "m", "infiltration"),
    # on site detention (osd_required, psd_l_s, ssr_m3 and osd_method were registered in stage 2B)
    KeySpec("stormwater.osd_required", "", "bool", "stormwater"),
    _n("stormwater.psd_l_s", "L/s", "stormwater"),
    _n("stormwater.ssr_m3", "m3", "stormwater"),
    KeySpec("stormwater.orifice_discharge_coefficient", "ratio", "ratio", "stormwater"),
    _n("stormwater.osd_min_orifice_diameter_mm", "mm", "stormwater"),
    # stormwater pits and pipes
    _n("stormwater.min_pipe_grade_pct", "%", "stormwater"),
    _n("stormwater.min_cover_m", "m", "stormwater"),
    _n("stormwater.min_pipe_diameter_mm", "mm", "stormwater"),
    KeySpec("stormwater.pipe_bends_at_pits_only", "", "bool", "stormwater"),
    # pool and pool barrier
    _n("pool.barrier_min_height_m", "m", "pool"),
    _n("pool.barrier_min_setback_m", "m", "pool"),
    # footpath
    _n("footpath.min_width_m", "m", "footpath"),
    _n("footpath.max_crossfall_pct", "%", "footpath"),
    _n("footpath.min_crossfall_pct", "%", "footpath"),
    # tree protection. The TPZ radius is a multiple of the trunk diameter (DBH). The SRZ radius is R = c x D^e (D = DBH in metres, R in metres) with the
    # coefficient c, the exponent e and the minimum radius all taken from the cited rule; the SRZ is computed only when all three resolve.
    KeySpec("tree.tpz_dbh_multiplier", "ratio", "ratio", "tree"),
    _n("tree.tpz_min_radius_m", "m", "tree"),
    _n("tree.tpz_max_radius_m", "m", "tree"),
    KeySpec("tree.srz_coefficient", "ratio", "ratio", "tree"),
    KeySpec("tree.srz_exponent", "ratio", "ratio", "tree"),
    _n("tree.srz_min_radius_m", "m", "tree"),
    # landscape runoff behaviour, one key per surface kind (the runoff coefficient of the surface)
    *(KeySpec(f"landscape.runoff_coefficient.{k}", "ratio", "ratio", "landscape")
      for k in ("turf", "garden_bed", "mulch", "gravel", "permeable_paving", "impervious_paving")),
)
BY_KEY: dict[str, KeySpec] = {s.key: s for s in SPECS}
assert len(BY_KEY) == len(SPECS), "duplicate key in object_keys.SPECS"

#: keys that have a platform default (docs/14 section 7.3); no other key may have one
PLATFORM_DEFAULT_KEYS = frozenset({"stormwater.osd_required", "stormwater.psd_l_s"})
# DIMENSIONLESS_UNITS (the units a requirement row may carry for a ratio or a count) lives in ``app.agents.requirements.models`` and is imported above, so the
# site object keys and the SA4 mass balance accept exactly the same set.

#: (object type, parameter key) -> the requirement key whose value the parameter may carry. A parameter with basis LGA RULE must name this key as its
#: reference (and the server must resolve it to the same value); a PLATFORM DEFAULT parameter is accepted only when this key is a registered platform default.
PARAM_RULE_KEYS: dict[tuple[str, str], str] = {
    **{("rwt", p): k for p, k in (
        ("runoff_coefficient", "rwt.runoff_coefficient"), ("first_flush_mm", "rwt.first_flush_mm"), ("occupants", "rwt.demand.occupants"),
        ("toilet_l_pp_day", "rwt.demand.toilet_l_pp_day"), ("laundry_l_pp_day", "rwt.demand.laundry_l_pp_day"), ("garden_l_m2_day", "rwt.demand.garden_l_m2_day"),
        ("wet_day_fraction", "rwt.wet_day_fraction"), ("tank_height_m", "rwt.tank_height_m"))},
    **{("retaining_wall", p): k for p, k in (
        ("soil_friction_angle_deg", "retaining.soil_friction_angle_deg"), ("soil_unit_weight_kn_m3", "retaining.soil_unit_weight_kn_m3"),
        ("wall_friction_ratio", "retaining.wall_friction_ratio"), ("gravity_wall_width_ratio", "retaining.gravity_wall_width_ratio"),
        ("wall_unit_weight_kn_m3", "retaining.wall_unit_weight_kn_m3"), ("min_fs_sliding", "retaining.min_fs_sliding"),
        ("min_fs_overturning", "retaining.min_fs_overturning"), ("surcharge_kpa", "retaining.surcharge_kpa"))},
    ("osd", "psd_l_s"): "stormwater.psd_l_s", ("osd_basin", "psd_l_s"): "stormwater.psd_l_s",
    ("osd", "discharge_coefficient"): "stormwater.orifice_discharge_coefficient", ("osd_basin", "discharge_coefficient"): "stormwater.orifice_discharge_coefficient",
}
assert all(k in BY_KEY for k in PARAM_RULE_KEYS.values()), "PARAM_RULE_KEYS names an unregistered key"


def spec_for(key: str) -> KeySpec | None:
    """The spec of a key, or of its family when the key is zone qualified: ``rwt.max_height_m.rural`` has the unit and kind of ``rwt.max_height_m``
    (the longest registered key that is a dotted prefix of it). None for a key outside the stage 7 table."""
    s = BY_KEY.get(key)
    if s is not None:
        return s
    parts = key.split(".")
    for n in range(len(parts) - 1, 1, -1):
        s = BY_KEY.get(".".join(parts[:n]))
        if s is not None:
            return s
    return None


def landscape_key(kind: str) -> str:
    return f"landscape.runoff_coefficient.{kind}"
