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

SCHEMA = "site_design.v1"

ObjectType = Literal["tree", "rwt", "pit", "osd", "retaining_wall", "infiltration_trench", "stormwater_pipe",
                     "service_trace", "landscape_area", "grading_area", "osd_basin",
                     "building", "pool", "footpath", "furniture", "driveway"]
GeometryKind = Literal["point", "polyline", "polygon"]
Status = Literal["existing", "proposed", "to_be_removed"]
Origin = Literal["user", "ai_proposal", "imported", "dbyd"]
Accepted = Literal["pending", "accepted", "rejected"]
Basis = Literal["user", "lga_rule", "platform_default", "unresolved"]
Severity = Literal["blocking", "warning", "info"]

#: geometry kind required by each object type (docs/14 section 6.5)
GEOMETRY_OF: dict[str, GeometryKind] = {
    "tree": "point", "rwt": "point", "pit": "point", "osd": "point",
    "retaining_wall": "polyline", "infiltration_trench": "polyline", "stormwater_pipe": "polyline", "service_trace": "polyline",
    "landscape_area": "polygon", "grading_area": "polygon", "osd_basin": "polygon",
    "building": "polygon", "pool": "polygon", "footpath": "polyline", "furniture": "point", "driveway": "polyline",
}
#: a second geometry kind an object type may also use (a footpath is a line with a width param, or an area)
ALT_GEOMETRY_OF: dict[str, GeometryKind] = {"footpath": "polygon"}

# Enumerated text parameters (stage 5). The same lists are in frontend/src/lib/site/types.ts. A value outside a list is refused.
BUILDING_USES = ("house", "granny_flat", "unit", "shed", "other")
BUILDING_SOURCES = ("plan_studio", "pdf", "dxf", "footprint_entry")
ROOF_AREA_BASES = ("SOURCE VALUE", "APPROXIMATE (PLAN STUDIO RASTER)", "NOT SET")
SURFACE_KINDS = ("turf", "garden_bed", "mulch", "gravel", "permeable_paving", "impervious_paving")
FOOTPATH_SURFACES = ("concrete", "pavers", "gravel", "permeable_pavers")
DRIVEWAY_SURFACES = ("concrete", "asphalt", "pavers", "gravel", "permeable_pavers")
PARAM_ENUMS: dict[tuple[str, str], tuple[str, ...]] = {
    ("building", "building_use"): BUILDING_USES, ("building", "source"): BUILDING_SOURCES,
    ("building", "roof_area_basis"): ROOF_AREA_BASES,
    ("landscape_area", "surface_kind"): SURFACE_KINDS, ("footpath", "surface_kind"): FOOTPATH_SURFACES,
    ("driveway", "surface_kind"): DRIVEWAY_SURFACES,
}
#: parameters that must be numbers when they carry a value
PARAM_NUMBERS: dict[str, tuple[str, ...]] = {
    "building": ("ffl_rl", "height_m", "roof_plan_area_m2"),
    "pool": ("depth_m", "coping_width_m"), "footpath": ("width_m",), "furniture": ("width_m", "depth_m", "height_m"),
    # stage 6. Batter slopes are H per V (a 1 in 3 batter is 3). A grade is a percentage; a fall direction is a grid bearing in degrees.
    "driveway": ("width_m", "end_level_rl", "crossover_chainage_m", "batter_cut_h_per_v", "batter_fill_h_per_v"),
    "grading_area": ("target_level_m", "target_grade_pct", "fall_direction_deg", "pivot_level_m", "batter_cut_h_per_v", "batter_fill_h_per_v"),
}

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
        if self.basis == "lga_rule" and not self.ref:
            raise ValueError("an LGA RULE parameter needs its requirement reference")
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
        for (t, k), allowed in PARAM_ENUMS.items():
            p = self.params.get(k) if t == self.type else None
            if p is not None and p.value is not None and p.value not in allowed:
                raise ValueError(f"{k} must be one of: {', '.join(allowed)}")
        for k in PARAM_NUMBERS.get(self.type, ()):
            p = self.params.get(k)
            if p is not None and p.value is not None and (isinstance(p.value, bool) or not isinstance(p.value, (int, float))):
                raise ValueError(f"{k} must be a number")
        if self.origin == "ai_proposal":
            if self.accepted is None:
                self.accepted = "pending"
        elif self.accepted is not None:
            raise ValueError("accepted applies to AI proposals only")
        if self.verified_on is not None and not self.verified:
            raise ValueError("verified_on needs verified")
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
