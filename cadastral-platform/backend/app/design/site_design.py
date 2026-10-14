"""``site_design.v1``: the site design document (docs/14 section 5, stages 4 and 5).

One document per project holds every object the user (or, later, the AI) places on the site. Geometry is in MGA metres
(E, N and an optional z). Nothing in this module carries an engineering requirement value: a parameter is either entered
by the user, taken from an LGA rule (with its reference), a stamped platform default, or UNRESOLVED (value ``None``).
Type-specific parameters are placeholders until stage 7; no default dimension is ever invented here.

Stage 6 adds the ``driveway`` object type (a centreline polyline whose first point is the crossover on the assumed kerb line) and the grading parameters
of ``grading_area`` (see PARAM_ENUMS and PARAM_NUMBERS). Their dimensions are never defaulted: a width, an end level or a batter slope that is not
entered is UNRESOLVED / NOT SET, and the engines (``driveway_engine``, ``grading_engine``) say so instead of assuming a value.

Stage 5 adds four object types: ``building`` (a polygon footprint plus a read only ``building`` block with the levels, roof outline, exit
points and the import frame; it is imported or entered as a footprint, never designed), ``pool`` (polygon), ``footpath`` (a polyline with a
width, or a polygon) and ``furniture`` (point). Their text parameters are limited to the lists below and their numbers must be numbers.

This model mirrors ``frontend/src/lib/site/types.ts``; ``tests/fixtures/site_design_v1.json`` is validated by both sides.
"""
from __future__ import annotations

import math
import re
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from . import object_keys as OK

SCHEMA = "site_design.v1"

ObjectType = Literal["tree", "rwt", "stormwater_pit", "osd", "retaining_wall", "infiltration_trench", "stormwater_pipe",
                     "service_trace", "landscape_area", "grading_area", "osd_basin",
                     "building", "pool", "footpath", "furniture", "driveway", "pool_barrier", "overflow_route",
                     "service_existing", "sewer_drain", "service_node", "water_service"]
#: stage 7 renamed the stormwater pit from ``pit``; a stored document that still says ``pit`` is read as ``stormwater_pit``
LEGACY_TYPES = {"pit": "stormwater_pit"}
GeometryKind = Literal["point", "polyline", "polygon"]
Status = Literal["existing", "proposed", "to_be_removed"]
Origin = Literal["user", "ai_proposal", "imported", "dbyd"]
Accepted = Literal["pending", "accepted", "rejected"]
Basis = Literal["user", "lga_rule", "platform_default", "unresolved", "plan_indicated", "derived"]
#: ``plan_indicated``: read from a DBYD plan (parsed, not measured and not entered by the user); accepted only for these (type, parameter) pairs, and the checks show it as such.
#: ``derived``: computed by the server from a requirement (a proposal invert from the minimum grade rule); accepted only for these pairs and only when its ``ref`` names a
#: requirement key that resolves. Neither basis may be set by hand: the operations refuse them.
PLAN_INDICATED_PARAMS: frozenset[tuple[str, str]] = frozenset({("service_existing", k) for k in ("service_kind", "diameter_mm", "material", "depth_m", "depth_basis", "source_file")})
DERIVED_PARAMS: frozenset[tuple[str, str]] = frozenset({("sewer_drain", "upstream_invert_rl"), ("sewer_drain", "downstream_invert_rl"), ("service_node", "invert_rl")})
Severity = Literal["blocking", "warning", "info"]

#: geometry kind required by each object type (docs/14 section 6.5)
GEOMETRY_OF: dict[str, GeometryKind] = {
    "tree": "point", "rwt": "point", "stormwater_pit": "point", "osd": "point",
    "retaining_wall": "polyline", "infiltration_trench": "polyline", "stormwater_pipe": "polyline", "service_trace": "polyline",
    "landscape_area": "polygon", "grading_area": "polygon", "osd_basin": "polygon",
    "building": "polygon", "pool": "polygon", "footpath": "polyline", "furniture": "point", "driveway": "polyline",
    "pool_barrier": "polyline", "overflow_route": "polyline",
    # stage 8: an existing service (a line, or a point for a pit, valve or pole), a sewer drain link, a node of a drain or water service, a water service line
    "service_existing": "polyline", "sewer_drain": "polyline", "service_node": "point", "water_service": "polyline",
}
#: a second geometry kind an object type may also use (a footpath is a line with a width param, or an area; an existing service may be a point)
ALT_GEOMETRY_OF: dict[str, GeometryKind] = {"footpath": "polygon", "service_existing": "point"}

# Enumerated text parameters (stage 5). The same lists are in frontend/src/lib/site/types.ts. A value outside a list is refused.
BUILDING_USES = ("house", "granny_flat", "unit", "shed", "other")
BUILDING_SOURCES = ("plan_studio", "pdf", "dxf", "footprint_entry")
ROOF_AREA_BASES = ("SOURCE VALUE", "APPROXIMATE (PLAN STUDIO RASTER)", "NOT SET")
SURFACE_KINDS = ("turf", "garden_bed", "mulch", "gravel", "permeable_paving", "impervious_paving")
FOOTPATH_SURFACES = ("concrete", "pavers", "gravel", "permeable_pavers")
DRIVEWAY_SURFACES = ("concrete", "asphalt", "pavers", "gravel", "permeable_pavers")
RWT_SHAPES = ("round", "slimline", "underground")
WALL_TYPES = ("sleeper", "block", "concrete", "other")
INFILTRATION_BASES = ("site_test", "indicative")
OSD_FORMS = ("tank", "basin", "below_ground")
# stage 8 (the same lists are in frontend/src/lib/site/types.ts)
SERVICE_KINDS = ("water", "sewer", "stormwater", "gas", "electricity", "telecommunications", "other")
DEPTH_BASES = ("plan_indicated", "potholed", "surveyed", "unknown")
DEPTH_REFERENCES = ("top", "invert")
NODE_KINDS = ("inspection_opening", "inspection_pit", "sewer_connection", "water_connection", "water_meter")
PARAM_ENUMS: dict[tuple[str, str], tuple[str, ...]] = {
    ("rwt", "shape"): RWT_SHAPES, ("retaining_wall", "wall_type"): WALL_TYPES, ("infiltration_trench", "infiltration_basis"): INFILTRATION_BASES,
    ("osd", "form"): OSD_FORMS, ("osd_basin", "form"): OSD_FORMS,
    ("building", "building_use"): BUILDING_USES, ("building", "source"): BUILDING_SOURCES,
    ("building", "roof_area_basis"): ROOF_AREA_BASES,
    ("landscape_area", "surface_kind"): SURFACE_KINDS, ("footpath", "surface_kind"): FOOTPATH_SURFACES,
    ("driveway", "surface_kind"): DRIVEWAY_SURFACES,
    ("service_existing", "service_kind"): SERVICE_KINDS, ("service_existing", "depth_basis"): DEPTH_BASES, ("service_existing", "depth_reference"): DEPTH_REFERENCES,
    ("service_node", "node_kind"): NODE_KINDS,
}
#: parameters that must be numbers when they carry a value
PARAM_NUMBERS: dict[str, tuple[str, ...]] = {
    "building": ("ffl_rl", "height_m", "roof_plan_area_m2"),
    "pool": ("depth_m", "coping_width_m", "water_level_rl"), "footpath": ("width_m", "crossfall_pct"), "furniture": ("width_m", "depth_m", "height_m"),
    # stage 6. Batter slopes are H per V (a 1 in 3 batter is 3). A grade is a percentage; a fall direction is a grid bearing in degrees.
    "driveway": ("width_m", "end_level_rl", "crossover_chainage_m", "batter_cut_h_per_v", "batter_fill_h_per_v"),
    "grading_area": ("target_level_m", "target_grade_pct", "fall_direction_deg", "pivot_level_m", "batter_cut_h_per_v", "batter_fill_h_per_v"),
    # stage 7. Levels (``_rl``) are RLs in metres and may be negative; a quantity that must be above zero is checked by the engines, not here.
    "rwt": ("capacity_l", "diameter_m", "length_m", "width_m", "height_m", "base_rl", "inlet_rl", "overflow_rl", "outlet_rl", "connected_roof_area_m2", "garden_area_m2",
            "runoff_coefficient", "first_flush_mm", "occupants", "toilet_l_pp_day", "laundry_l_pp_day", "garden_l_m2_day", "wet_day_fraction", "water_target_pct", "tank_height_m"),
    "retaining_wall": ("height_m", "thickness_m", "surcharge_kpa", "soil_friction_angle_deg", "soil_unit_weight_kn_m3", "wall_friction_ratio", "gravity_wall_width_ratio",
                       "wall_unit_weight_kn_m3", "min_fs_sliding", "min_fs_overturning"),
    "infiltration_trench": ("width_m", "depth_m", "void_ratio", "infiltration_rate_mm_h"),
    "osd": ("width_m", "length_m", "height_m", "storage_volume_m3", "orifice_diameter_mm", "orifice_invert_rl", "top_water_level_rl", "discharge_coefficient", "psd_l_s"),
    "osd_basin": ("depth_m", "storage_volume_m3", "orifice_diameter_mm", "orifice_invert_rl", "top_water_level_rl", "discharge_coefficient", "psd_l_s"),
    "stormwater_pit": ("width_m", "length_m", "invert_rl"), "stormwater_pipe": ("diameter_mm", "upstream_invert_rl", "downstream_invert_rl"),
    "pool_barrier": ("height_m",), "tree": ("height_m", "canopy_diameter_m", "trunk_diameter_mm"),
    # stage 8. Depths are metres below the ground at the service; levels are RLs in metres.
    "service_existing": ("diameter_mm", "depth_m", "position_tolerance_m"), "sewer_drain": ("diameter_mm", "upstream_invert_rl", "downstream_invert_rl"),
    "water_service": ("diameter_mm", "cover_m"), "service_node": ("invert_rl",),
}
#: the optional founding (footing) depth below ground, entered by the user on the objects the zone of influence of a sewer main is checked for
FOOTING_TYPES = ("building", "retaining_wall", "rwt", "osd", "osd_basin", "pool", "tree")
PARAM_NUMBERS = {**PARAM_NUMBERS, **{t: tuple(dict.fromkeys((*PARAM_NUMBERS.get(t, ()), "footing_depth_m"))) for t in FOOTING_TYPES}}
#: parameters that must be true or false when they carry a value
PARAM_BOOLS: dict[str, tuple[str, ...]] = {"rwt": ("reuse_toilet", "reuse_laundry", "reuse_garden"), "footpath": ("impervious",)}
#: parameters that must be an ISO date (YYYY-MM-DD) when they carry a value
PARAM_DATES: dict[str, tuple[str, ...]] = {"infiltration_trench": ("test_date",), "service_existing": ("plan_date", "plan_expiry_date")}
#: object links: (type, parameter) -> the object types the linked id must have (checked by the engines against the document, not by this model)
PARAM_LINKS: dict[tuple[str, str], tuple[str, ...]] = {
    ("rwt", "roof_building_id"): ("building",), ("overflow_route", "osd_id"): ("osd", "osd_basin"), ("pool_barrier", "pool_id"): ("pool",),
    # stage 8: the main a node or service connects to, the building a sewer drain leaves, the tank a water service tops up
    ("service_node", "main_id"): ("service_existing",), ("sewer_drain", "building_id"): ("building",), ("water_service", "main_id"): ("service_existing",),
    ("water_service", "rwt_id"): ("rwt",),
}

#: object types whose parameters are stage 7 engineering inputs. On them a parameter may NOT have basis ``platform_default`` (the only platform defaults are the
#: requirement values of the two keys in ``object_keys.PLATFORM_DEFAULT_KEYS``, which the checks resolve themselves). Two exceptions: a parameter mapped to one of those
#: two keys (the OSD ``psd_l_s``; the checks still verify its value against the resolver), and the Plan Studio size ESTIMATE the importer stamps on a tank diameter or height
#: (its ref starts with ``PS_ESTIMATE_REF``; the checks do NOT use such a value).
STAGE7_TYPES = frozenset({"rwt", "retaining_wall", "infiltration_trench", "osd", "osd_basin", "stormwater_pit", "stormwater_pipe", "pool_barrier", "overflow_route", "tree",
                          "service_existing", "sewer_drain", "service_node", "water_service"})
PS_ESTIMATE_REF = "PLAN STUDIO ESTIMATE"


def platform_default_refused(type_: str, key: str, ref: str | None) -> bool:
    """True when a parameter with basis ``platform_default`` is not allowed on this object type (see ``STAGE7_TYPES``)."""
    return (type_ in STAGE7_TYPES and not (ref or "").startswith(PS_ESTIMATE_REF)
            and OK.PARAM_RULE_KEYS.get((type_, key)) not in OK.PLATFORM_DEFAULT_KEYS)


# Sanity limits that protect the server from abusive payloads. They are not engineering values.
MAX_OBJECTS = 5000
MAX_VERTICES = 10000
MAX_PARAMS = 64
MAX_TEXT = 200                       # longest text parameter value and reference (the frontend enforces the same limit)
MAX_POSITIONS = 200_000              # total positions (vertices) in one document, over all objects

_ID = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")
_KEY = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _pos(v: list[float]) -> list[float]:
    if len(v) not in (2, 3):
        raise ValueError("a position is [E, N] or [E, N, z]")
    if not all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) for x in v):
        raise ValueError("position values must be finite numbers")
    return [float(x) for x in v]


#: strict floats: a JSON number (int or float) is accepted; a bool or a numeric string such as "12.5" is rejected, like the frontend
StrictNum = Annotated[float, Field(strict=True)]
Position = Annotated[list[StrictNum], Field(min_length=2, max_length=3)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Param(_Strict):
    """One parameter: a value and where it came from. ``unresolved`` carries no value."""
    value: float | int | str | bool | None = None
    basis: Basis
    ref: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _basis_rules(self) -> "Param":
        if isinstance(self.value, float) and not math.isfinite(self.value):
            raise ValueError("value must be finite")
        if isinstance(self.value, str) and len(self.value) > MAX_TEXT:
            raise ValueError(f"text value is longer than {MAX_TEXT} characters")
        if self.basis == "unresolved":
            if self.value is not None:
                raise ValueError("an UNRESOLVED parameter carries no value")
        elif self.value is None:
            raise ValueError(f"basis {self.basis} needs a value")
        if self.basis == "lga_rule" and not (self.ref and self.ref.strip()):
            raise ValueError("an LGA RULE parameter needs its requirement reference")
        if self.basis == "derived" and not (self.ref and self.ref.strip()):
            raise ValueError("a DERIVED parameter needs the requirement key it was derived from (ref)")
        return self


class Issue(_Strict):
    code: str = Field(min_length=1, max_length=64)
    severity: Severity
    message: str = Field(min_length=1, max_length=500)


class PointGeometry(_Strict):
    kind: Literal["point"]
    p: Position
    yaw_deg: StrictNum | None = None        # clockwise from grid north, degrees

    @field_validator("p")
    @classmethod
    def _p(cls, v: list[float]) -> list[float]:
        return _pos(v)

    @field_validator("yaw_deg")
    @classmethod
    def _yaw(cls, v: float | None) -> float | None:
        if v is not None and not math.isfinite(v):
            raise ValueError("yaw must be finite")
        return v


class PolylineGeometry(_Strict):
    kind: Literal["polyline"]
    pts: list[Position] = Field(min_length=2, max_length=MAX_VERTICES)

    @field_validator("pts")
    @classmethod
    def _pts(cls, v: list[list[float]]) -> list[list[float]]:
        return [_pos(p) for p in v]


class PolygonGeometry(_Strict):
    kind: Literal["polygon"]
    ring: list[Position] = Field(min_length=3, max_length=MAX_VERTICES)      # open ring: the first point is not repeated

    @field_validator("ring")
    @classmethod
    def _ring(cls, v: list[list[float]]) -> list[list[float]]:
        return [_pos(p) for p in v]


Geometry = Annotated[Union[PointGeometry, PolylineGeometry, PolygonGeometry], Field(discriminator="kind")]


class BuildingLevel(_Strict):
    """One level of an imported building. ``elevation_m`` is relative to the datum level (the ground floor), from the source; ``None`` = not in the source."""
    name: str = Field(min_length=1, max_length=60)
    elevation_m: StrictNum | None = None
    rings: list[Annotated[list[Position], Field(min_length=3, max_length=MAX_VERTICES)]] = Field(min_length=1, max_length=64)    # outer rings in MGA, largest first

    @field_validator("rings")
    @classmethod
    def _rings(cls, v: list[list[list[float]]]) -> list[list[list[float]]]:
        return [[_pos(p) for p in r] for r in v]

    @field_validator("elevation_m")
    @classmethod
    def _el(cls, v: float | None) -> float | None:
        if v is not None and not math.isfinite(v):
            raise ValueError("elevation must be finite")
        return v


class BuildingExits(_Strict):
    """Child point lists (MGA): where the building's sewer, water and downpipes leave it. Empty = none in the source."""
    sewer: list[Position] = Field(default_factory=list, max_length=64)
    water: list[Position] = Field(default_factory=list, max_length=64)
    downpipes: list[Position] = Field(default_factory=list, max_length=256)

    @field_validator("sewer", "water", "downpipes")
    @classmethod
    def _pts(cls, v: list[list[float]]) -> list[list[float]]:
        return [_pos(p) for p in v]


class BuildingFrame(_Strict):
    """Where the importer's local frame sits in MGA: ``origin`` is the MGA position of local (0, 0), ``yaw_deg`` the clockwise rotation applied
    since import. ``north_deg`` is the Plan Studio north angle already applied by the importer (None for other sources). A GLB is placed with it."""
    origin: Annotated[list[StrictNum], Field(min_length=2, max_length=2)]
    yaw_deg: StrictNum = 0.0
    north_deg: StrictNum | None = None

    @field_validator("origin")
    @classmethod
    def _o(cls, v: list[float]) -> list[float]:
        return _pos(v)

    @field_validator("yaw_deg", "north_deg")
    @classmethod
    def _f(cls, v: float | None) -> float | None:
        if v is not None and not math.isfinite(v):
            raise ValueError("angle must be finite")
        return v


class Building(_Strict):
    """Read only building geometry (a building is never designed in JCESITE). Only placement (move, rotate) changes it."""
    levels: list[BuildingLevel] = Field(min_length=1, max_length=16)       # ascending by elevation
    datum_index: int = Field(default=0, ge=0)                               # the ground floor level (FFL datum); object.geometry is its footprint
    roof_outline: list[Annotated[list[Position], Field(min_length=3, max_length=MAX_VERTICES)]] | None = Field(default=None, max_length=64)
    exits: BuildingExits = Field(default_factory=BuildingExits)
    frame: BuildingFrame
    glb_name: str | None = Field(default=None, max_length=200)
    import_id: str | None = Field(default=None, pattern=r"^[0-9a-f]{32}$")     # the stored import this building came from (checked on every PUT)
    notes: list[Annotated[str, Field(max_length=400)]] = Field(default_factory=list, max_length=30)

    @field_validator("roof_outline")
    @classmethod
    def _roof(cls, v):
        return None if v is None else [[_pos(p) for p in r] for r in v]

    @model_validator(mode="after")
    def _datum(self) -> "Building":
        if self.datum_index >= len(self.levels):
            raise ValueError("datum_index is outside the levels list")
        return self

    def positions(self) -> int:
        n = sum(len(r) for lv in self.levels for r in lv.rings)
        n += sum(len(r) for r in (self.roof_outline or []))
        return n + len(self.exits.sewer) + len(self.exits.water) + len(self.exits.downpipes)


class VertexRls(_Strict):
    """Retaining wall levels per vertex: the RL of the top and of the bottom of the wall at each vertex of the polyline. ``None`` = NOT SET at that vertex."""
    top: list[StrictNum | None] = Field(max_length=MAX_VERTICES)
    bottom: list[StrictNum | None] = Field(max_length=MAX_VERTICES)

    @field_validator("top", "bottom")
    @classmethod
    def _finite(cls, v: list[float | None]) -> list[float | None]:
        if not all(x is None or math.isfinite(x) for x in v):
            raise ValueError("levels must be finite numbers or null")
        return v


class SiteObject(_Strict):
    id: str
    type: ObjectType
    status: Status = "proposed"
    origin: Origin = "user"
    accepted: Accepted | None = None            # AI proposals only
    verified: bool = False                      # imported and DBYD data: verified by the user
    verified_on: str | None = None              # ISO date (YYYY-MM-DD); shown as DD/MM/YYYY
    label: str | None = Field(default=None, max_length=120)
    geometry: Geometry
    params: dict[str, Param] = Field(default_factory=dict, max_length=MAX_PARAMS)
    issues: list[Issue] = Field(default_factory=list, max_length=100)
    building: Building | None = None            # buildings only (stage 5)
    vertex_rls: VertexRls | None = None         # retaining walls only (stage 7): top and bottom RL per vertex

    @model_validator(mode="before")
    @classmethod
    def _legacy_type(cls, data):
        if isinstance(data, dict) and data.get("type") in LEGACY_TYPES:
            return {**data, "type": LEGACY_TYPES[data["type"]]}
        return data

    @field_validator("id")
    @classmethod
    def _id(cls, v: str) -> str:
        if not _ID.match(v):
            raise ValueError("id must be 1 to 64 letters, digits, underscores or hyphens")
        return v

    @field_validator("params")
    @classmethod
    def _keys(cls, v: dict[str, Param]) -> dict[str, Param]:
        for k in v:
            if not _KEY.match(k):
                raise ValueError(f"parameter key {k!r} must be lower case letters, digits and underscores")
        return v

    @field_validator("verified_on")
    @classmethod
    def _date(cls, v: str | None) -> str | None:
        if v is not None and not _ISO_DATE.match(v):
            raise ValueError("verified_on must be an ISO date (YYYY-MM-DD)")
        return v

    @model_validator(mode="after")
    def _consistent(self) -> "SiteObject":
        ok = {GEOMETRY_OF[self.type], ALT_GEOMETRY_OF.get(self.type)}
        if self.geometry.kind not in ok:
            raise ValueError(f"{self.type} needs {GEOMETRY_OF[self.type]} geometry, not {self.geometry.kind}")
        if (self.type == "building") != (self.building is not None):
            raise ValueError("a building object carries a building block, and no other type does")
        for k, p in self.params.items():
            if p.basis == "platform_default" and platform_default_refused(self.type, k, p.ref):
                raise ValueError(f"{k}: a platform default is not accepted for a {self.type} parameter; enter a value (USER) or cite a requirement (LGA RULE with its key)")
            if p.basis == "plan_indicated" and (self.type, k) not in PLAN_INDICATED_PARAMS:
                raise ValueError(f"{k}: a PLAN INDICATED value is not accepted for a {self.type} parameter")
            if p.basis == "derived" and (self.type, k) not in DERIVED_PARAMS:
                raise ValueError(f"{k}: a DERIVED value is not accepted for a {self.type} parameter")
        for (t, k), allowed in PARAM_ENUMS.items():
            p = self.params.get(k) if t == self.type else None
            if p is not None and p.value is not None and p.value not in allowed:
                raise ValueError(f"{k} must be one of: {', '.join(allowed)}")
        for k in PARAM_NUMBERS.get(self.type, ()):
            p = self.params.get(k)
            if p is not None and p.value is not None and (isinstance(p.value, bool) or not isinstance(p.value, (int, float))):
                raise ValueError(f"{k} must be a number")
        for k in PARAM_BOOLS.get(self.type, ()):
            p = self.params.get(k)
            if p is not None and p.value is not None and not isinstance(p.value, bool):
                raise ValueError(f"{k} must be true or false")
        for k in PARAM_DATES.get(self.type, ()):
            p = self.params.get(k)
            if p is not None and p.value is not None and not (isinstance(p.value, str) and _ISO_DATE.match(p.value)):
                raise ValueError(f"{k} must be an ISO date (YYYY-MM-DD)")
        if self.vertex_rls is not None:
            n = len(self.geometry.pts) if self.geometry.kind == "polyline" else 0
            if self.type != "retaining_wall":
                raise ValueError("vertex_rls applies to a retaining_wall only")
            if len(self.vertex_rls.top) != n or len(self.vertex_rls.bottom) != n:
                raise ValueError("vertex_rls needs one top and one bottom entry for each vertex")
        if self.origin == "ai_proposal":
            if self.accepted is None:
                self.accepted = "pending"
        elif self.accepted is not None:
            raise ValueError("accepted applies to AI proposals only")
        if self.verified_on is not None and not self.verified:
            raise ValueError("verified_on needs verified")
        if self.type == "service_existing" and self.verified:
            by = self.params.get("verified_by")
            if self.verified_on is None or by is None or not isinstance(by.value, str) or not by.value.strip():
                raise ValueError("a verified existing service needs verified_by (who verified it) and verified_on (the date)")
        return self


class SiteDesign(_Strict):
    schema_: Literal["site_design.v1"] = Field(default=SCHEMA, alias="schema")
    version: int = Field(default=0, ge=0)        # server save counter, used for optimistic concurrency
    project_id: str | None = None
    updated_at: str | None = None
    objects: list[SiteObject] = Field(default_factory=list, max_length=MAX_OBJECTS)

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @model_validator(mode="after")
    def _unique_ids(self) -> "SiteDesign":
        seen: set[str] = set()
        total = 0
        for o in self.objects:
            if o.id in seen:
                raise ValueError(f"duplicate object id {o.id}")
            seen.add(o.id)
            g = o.geometry
            total += 1 if g.kind == "point" else len(g.pts) if g.kind == "polyline" else len(g.ring)
            if o.building is not None:
                total += o.building.positions()
        if total > MAX_POSITIONS:
            raise ValueError(f"a document can hold at most {MAX_POSITIONS} positions in total")
        return self

    def dump(self) -> dict:
        """JSON-ready dict with the wire field name ``schema``."""
        d = self.model_dump(mode="json", by_alias=True, exclude_none=True)
        for o in d["objects"]:
            for prm in o["params"].values():
                prm.setdefault("value", None)           # an UNRESOLVED parameter keeps an explicit null value
        return d


def empty_design(project_id: str | None = None) -> SiteDesign:
    return SiteDesign(project_id=project_id)
