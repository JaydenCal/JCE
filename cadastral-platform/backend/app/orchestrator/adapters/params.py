"""Typed view of ``RunRequest.params`` (opaque to the orchestrator core, parsed per node here)."""
from __future__ import annotations

from typing import Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from app.common.contracts import DevelopmentType
from app.agents.sa3_terrain.models import SurveyInput, TinOptions
from app.agents.sa4_hydro.models import DigitisedAsset, LegendEntry, RwtInput

XY = tuple[float, float]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TerrainParams(_Strict):
    survey: SurveyInput | None = None
    pad_level_m: float | None = None          # without it only the TIN is built (no cut/fill)
    options: TinOptions | None = None


class DrivewayParams(_Strict):
    parking: Literal["single", "double"] = "single"
    width_m: float | None = None
    preferred_offset_m: float | None = None
    garage_xy: XY | None = None
    levels: dict[str, float] = Field(default_factory=dict)
    kerb_to_boundary_m: float = 4.0
    vehicle: str = "B85"
    on_site_turn: bool = False
    easements_wkt: list[str] = Field(default_factory=list)
    exclusion_polygons_wkt: list[str] = Field(default_factory=list)


class DbydParams(_Strict):
    pdf_path: str | None = None
    pdf_page: int = 1
    legend: list[LegendEntry] | None = None
    control_points: list[tuple[XY, XY]] = Field(default_factory=list)   # (pdf point, MGA)
    scale_denominator: float | None = None
    boundary_rgb: str | None = None
    tolerance_m: float = 1.0
    digitised_assets: list[DigitisedAsset] = Field(default_factory=list)
    outlet_xy: XY | None = None
    outlet_invert_m: float | None = None
    main_invert_m: float | None = None
    sewer_junction_xy: XY | None = None
    meter_xy: XY | None = None
    rwt: RwtInput | None = None
    occupants: int | None = Field(default=None, ge=0)   # secondary dwelling: drives RWT demand


class SiteParams(BaseModel):
    """Unknown keys are ignored (the params dict is shared by every node)."""
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    jurisdiction: Literal["NSW", "QLD"] | None = None
    lot_identifier: str | None = Field(default=None, validation_alias=AliasChoices("lot_identifier", "lotplan"))
    address: str | None = None
    point: XY | None = None
    development_type: DevelopmentType = DevelopmentType.dwelling_house
    dwelling_type: str | None = None          # explicit override of the setback-rule dwelling_type
    zone_code: str | None = None              # override when SA1 could not determine the zone
    terrain: TerrainParams = Field(default_factory=TerrainParams)
    driveway: DrivewayParams = Field(default_factory=DrivewayParams)
    dbyd: DbydParams = Field(default_factory=DbydParams)

    @property
    def rule_dwelling_type(self) -> str:
        return self.dwelling_type or self.development_type.rule_dwelling_type
