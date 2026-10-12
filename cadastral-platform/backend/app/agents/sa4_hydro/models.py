"""SA4 models. All numeric defaults flagged ``placeholder`` MUST be replaced by the owner-agency / instrument value."""
from __future__ import annotations

from typing import Literal
from uuid import UUID, uuid4

from pydantic import Field

from app.agents.requirements.models import RequirementSet, UnresolvedItem
from app.common.contracts import DrivewayDesign, LotContext, Model, RwtSummary, ServiceLine

Service = Literal["water", "sewer", "stormwater", "electricity", "gas", "telecom", "other"]
XY = tuple[float, float]


class LegendEntry(Model):
    service: Service
    rgb: str                      # hex without '#', e.g. '0000ff'
    dashed: bool | None = None    # None = linetype ignored
    colour_tol: float = 90.0      # euclid distance in 0-255 RGB space


def default_legend() -> list[LegendEntry]:
    """Typical BYDA colours; overridable per response (agencies differ)."""
    return [LegendEntry(service=s, rgb=c) for s, c in [
        ("water", "0000ff"), ("sewer", "008000"), ("stormwater", "00a0a0"),
        ("electricity", "ff0000"), ("gas", "e6c800"), ("telecom", "ff8000")]]


class DigitisedAsset(Model):
    service: Service
    coords: list[XY]              # already MGA
    label: str = ""
    diameter_mm: int | None = None
    material: str | None = None
    depth_m: float | None = None
    tolerance_m: float | None = None


class Asset(Model):
    asset_id: str = Field(default_factory=lambda: uuid4().hex[:12])
    service: Service
    label: str = ""
    geometry_wkt: str             # MGA LineString
    diameter_mm: int | None = None
    material: str | None = None
    depth_m: float | None = None
    depth_basis: Literal["plan_indicated", "unknown"] = "unknown"
    position_tolerance_m: float = 1.0
    extraction_method: Literal["dbyd_pdf_vector", "user_digitised"] = "dbyd_pdf_vector"
    extraction_confidence: float = 0.5
    status: Literal["unverified"] = "unverified"


class ClearanceRule(Model):
    service: Service | Literal["*"]
    dia_min_mm: int = 0
    dia_max_mm: int | None = None
    clearance_m: float
    rule_source: str
    placeholder: bool = True


class AssetBuffer(Model):
    asset_id: str
    service: Service
    clearance_m: float
    tolerance_m: float
    total_m: float
    rule_source: str
    placeholder: bool
    geometry_wkt: str


class Conflict(Model):
    asset_id: str
    service: Service
    feature: str                  # slab | excluded_area | driveway | crossover | rwt | trench
    severity: Literal["info", "warning", "blocking"]
    overlap_area_m2: float = 0.0
    line_intersects: bool = False
    message: str


class Check(Model):
    asset_id: str
    service: Service
    kind: Literal["crossing", "clearance", "cover", "grade", "info"]
    severity: Literal["info", "warning", "blocking"]
    message: str


class ProposedConnection(Model):
    kind: Literal["sewer", "water"]
    geometry_wkt: str
    start_xy: XY
    end_xy: XY
    target_asset_id: str | None = None
    length_m: float
    diameter_mm: int
    grade_pct: float | None = None
    required_min_grade_pct: float | None = None
    required_fall_m: float | None = None
    grade_ok: bool | None = None
    cover_m: float | None = None
    checks: list[Check] = []
    notes: list[str] = []
    verify_with_authority: bool = True

    def to_service_line(self) -> ServiceLine:
        return ServiceLine(service=self.kind, label=f"Proposed {self.kind} connection", geometry_wkt=self.geometry_wkt,
                           diameter_mm=self.diameter_mm, depth_m=self.cover_m, is_proposed=True)


class RainfallTable(Model):
    station_id: str
    monthly_mm: list[float] = Field(min_length=12, max_length=12)
    wet_day_fraction: float = Field(default=0.3, gt=0, le=1)


class RwtDemand(Model):
    occupants: int = 3
    toilet_l_pp_day: float = 18.0
    laundry_l_pp_day: float = 20.0
    garden_area_m2: float = 0.0
    garden_l_m2_day: float = 2.0
    garden_monthly_factor: list[float] = [1.4, 1.3, 1.0, 0.7, 0.4, 0.3, 0.3, 0.4, 0.7, 1.0, 1.2, 1.4]
    use_toilet: bool = True
    use_laundry: bool = True
    use_garden: bool = True


class RwtRegime(Model):
    name: str
    target_reliability_pct: float
    note: str = ""
    verify_against_current_instrument: bool = True   # defaults are placeholders, not statutory values


def default_regimes() -> dict[str, RwtRegime]:
    ph = "PLACEHOLDER target - verify against the current instrument/council requirement"
    return {
        "BASIX_NSW": RwtRegime(name="BASIX_NSW", target_reliability_pct=60.0, note=ph),
        "QDC_MP4_2_QLD": RwtRegime(name="QDC_MP4_2_QLD", target_reliability_pct=50.0, note=ph),
        "COUNCIL_OVERRIDE": RwtRegime(name="COUNCIL_OVERRIDE", target_reliability_pct=70.0, note=ph),
    }


class RwtInput(Model):
    roof_area_m2: float
    rainfall: RainfallTable
    regime: Literal["BASIX_NSW", "QDC_MP4_2_QLD", "COUNCIL_OVERRIDE"] = "BASIX_NSW"
    regime_override: RwtRegime | None = None
    runoff_coeff: float = 0.85
    first_flush_mm: float = 2.0
    demand: RwtDemand = RwtDemand()
    candidate_sizes_l: list[int] = [2000, 3000, 4500, 5000, 7500, 10000]
    tank_height_m: float = 2.0
    downpipe_xy: XY | None = None
    boundary_offset_m: float = 0.45


class MonthTrace(Model):
    month: int
    inflow_l: float
    supplied_l: float
    overflow_l: float
    demand_l: float
    end_storage_l: float


class TankResult(Model):
    volume_l: int
    reliability_pct: float
    annual_yield_l: float
    annual_demand_l: float
    annual_inflow_l: float
    annual_overflow_l: float
    storage_change_l: float


class RwtSizing(Model):
    regime: str
    target_reliability_pct: float | None      # None => target unresolved (see `unresolved`)
    verify_against_current_instrument: bool
    target_met: bool | None
    chosen: TankResult | None
    candidates: list[TankResult]
    diameter_m: float | None
    location_xy: XY | None
    monthly_trace: list[MonthTrace]
    messages: list[str] = []
    unresolved: list[UnresolvedItem] = []
    citations: list[str] = []
    placeholder: bool = False


class Sa4Request(Model):
    lot: LotContext
    pdf_path: str | None = None
    pdf_page: int = 1
    legend: list[LegendEntry] | None = None
    control_points: list[tuple[XY, XY]] = []     # (pdf point, MGA)
    scale_denominator: float | None = None
    boundary_rgb: str | None = None
    digitised_assets: list[DigitisedAsset] = []
    tolerance_m: float = 1.0
    clearance_rules: list[ClearanceRule] | None = None
    slab_wkt: str | None = None
    excluded_wkts: list[str] = []
    trench_wkts: list[str] = []
    driveway: DrivewayDesign | None = None
    outlet_xy: XY | None = None
    outlet_invert_m: float | None = None
    main_invert_m: float | None = None
    sewer_junction_xy: XY | None = None
    min_sewer_grade_pct: float | None = None       # explicit user value; else resolved/placeholder
    meter_xy: XY | None = None
    water_dia_mm: int = 20
    proposed_cover_m: float | None = None          # explicit user value; else resolved/placeholder
    rwt: RwtInput | None = None
    requirements: RequirementSet | None = None     # None => legacy placeholders (stamped)
    use_placeholders: bool = False                 # with requirements: fall back to stamped placeholders when unresolved


class Sa4Result(Model):
    status: Literal["unverified"] = "unverified"
    assets: list[Asset] = []
    buffers: list[AssetBuffer] = []
    conflicts: list[Conflict] = []
    connections: list[ProposedConnection] = []
    rwt: RwtSizing | None = None
    georef: dict = {}
    warnings: list[str] = []
    unresolved: list[UnresolvedItem] = []
    requirement_citations: list[str] = []
    placeholders_used: bool = False
    verifiable: bool = False        # True only when every needed requirement is cited/confirmed (no placeholders)

    def to_cad_services(self, include_exclusions: bool = True) -> list[ServiceLine]:
        bmap = {b.asset_id: b.geometry_wkt for b in self.buffers}
        out = [ServiceLine(service=a.service, label=a.label or a.service, geometry_wkt=a.geometry_wkt,
                           diameter_mm=a.diameter_mm, depth_m=a.depth_m,
                           exclusion_wkt=bmap.get(a.asset_id) if include_exclusions else None) for a in self.assets]
        return out + [c.to_service_line() for c in self.connections]

    def to_cad_rwt(self) -> RwtSummary | None:
        r = self.rwt
        if r is None or r.location_xy is None or r.chosen is None:
            return None
        return RwtSummary(tank_volume_l=r.chosen.volume_l, location_xy=r.location_xy, diameter_m=r.diameter_m,
                          regime=r.regime, note=f"Reliability {r.chosen.reliability_pct:.0f}% (target {r.target_reliability_pct:.0f}%, "
                                                f"{'PLACEHOLDER, NOT A REQUIREMENT' if r.placeholder else 'cited target'}; unverified)")
