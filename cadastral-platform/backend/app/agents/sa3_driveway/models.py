"""Models for SA3 driveway/crossover/envelope. All geometry is WKT in MGA metres.

Every AS/NZS 2890.1 default below is a PARAMETER flagged VERIFY: confirm against the current standard and
the relevant council's driveway guide before use. Nothing here is a certification.
"""
from __future__ import annotations

from typing import Any, Callable, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.agents.requirements.models import RequirementSet, UnresolvedItem
from app.common.contracts import DrivewayDesign, LotContext


class M(BaseModel):
    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)


class SetbackRule(M):
    """Row of planning.setback_rules (subset)."""
    rule_id: UUID | str
    element: str
    value_numeric: float
    unit: str = "m"
    zone_code: str | None = None
    lot_condition: dict[str, Any] = {}


class EnvelopeResult(M):
    envelope_wkt: str                      # MultiPolygon
    upper_envelope_wkt: str | None = None  # MultiPolygon (upper-level), if side_upper/rear_upper rules found
    applied_rule_ids: list[str]
    segment_roles: dict[int, str]          # seq -> front/secondary/side/rear
    setbacks_m: dict[str, float]
    area_m2: float
    max_height_m: float | None = None
    max_site_cover_pct: float | None = None
    warnings: list[str] = []


class CouncilDrivewayStandard(M):
    council_name: str
    source_label: str
    max_grade_pct: float | None = 25.0              # None => unresolved (not checked)
    max_change_of_grade_pct: float | None = None   # overrides both summit & sag limits when set
    min_crossover_width_m: float | None = None
    max_crossover_width_m: float | None = None
    min_separation_m: float | None = None          # min crossover separation from corner/intersection
    kerb_return_splay_m: float | None = None


DEFAULT_STANDARD = CouncilDrivewayStandard(
    council_name="default", source_label="default (AS/NZS 2890.1) used", max_grade_pct=25.0)


class DrivewayWidths(M):
    """AS/NZS 2890.1 Class 1 (domestic) widths at the boundary. VERIFY against the standard."""
    single_m: float = 3.0
    double_m: float = 5.5
    verify: bool = True


class Exclusion(M):
    xy: tuple[float, float]
    label: str = "obstacle"
    clearance_m: float = 1.5               # keep crossover footprint at least this far from the point


class CheckItem(M):
    name: str
    passed: bool | None                    # None = not evaluated
    value: float | None = None
    limit: float | None = None
    unit: str = ""
    note: str = ""


class CrossoverLayout(M):
    centreline_wkt: str
    crossover_wkt: str
    boundary_point: tuple[float, float]
    kerb_point: tuple[float, float]
    garage_point: tuple[float, float]
    offset_m: float                        # centre offset along front segment from its start
    width_m: float
    inward_normal: tuple[float, float]
    front_dir: tuple[float, float]
    dimensions: list[tuple[str, tuple[float, float], tuple[float, float]]]
    standard_label: str
    warnings: list[str] = []


class Sa3DrivewayRequest(M):
    lot: LotContext
    setback_rules: list[SetbackRule]
    dwelling_type: str = "dwelling_house"
    segment_role_overrides: dict[int, str] = {}
    easements_wkt: list[str] = []
    exclusion_polygons_wkt: list[str] = []
    exclusion_points: list[Exclusion] = []
    obstacle_polygons_wkt: list[str] = []          # fixed obstacles the swept path must avoid
    preferred_offset_m: float | None = None
    garage_xy: tuple[float, float] | None = None
    parking: Literal["single", "double"] = "single"
    width_m: float | None = None
    widths: DrivewayWidths = DrivewayWidths()
    user_class: int = 1
    council_standard: CouncilDrivewayStandard | None = None
    kerb_to_boundary_m: float = 4.0                # verge depth, kerb line to front boundary
    min_corner_distance_m: float = 6.0
    min_side_distance_m: float = 1.0
    vehicle: str = "B85"
    levels: dict[str, float] = {}                  # gutter, kerb, boundary, garage (m AHD)
    tin_sampler: Callable[[float, float], float] | None = Field(default=None, exclude=True)
    on_site_turn: bool = False
    clearance_min_m: float = 0.3                   # VERIFY
    requirements: RequirementSet | None = None     # None => legacy default standard (stamped placeholder)
    use_placeholders: bool = False                 # with requirements: allow stamped fallback when unresolved


class Sa3DrivewayResult(M):
    envelope: EnvelopeResult
    driveway: DrivewayDesign
    checks: list[CheckItem]
    warnings: list[str]
    status: Literal["unverified"] = "unverified"
    unresolved: list[UnresolvedItem] = []
    requirement_citations: list[str] = []
    placeholders_used: bool = False
    verifiable: bool = False
    disclaimer: str = ("Indicative design check only; not certified. Verify against AS/NZS 2890.1 and the "
                       "council's driveway standard.")
