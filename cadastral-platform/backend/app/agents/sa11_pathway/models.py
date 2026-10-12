"""SA11 Approval Pathway models.  Decision support only: never asserts an approval."""
from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.agents.requirements.models import Source

RECOMMENDATION = "May apply: verify with council or a certifier."
DISCLAIMER = ("Decision-support only. This is not a planning, complying development or building approval, and it is not a "
              "certificate. Results depend on the data supplied and on the cited summaries (several dated 2018); the Codes SEPP, "
              "Housing SEPP and the LEP could not be obtained. Verify with the council or an accredited certifier.")


class M(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DevType(str, Enum):
    DWELLING_HOUSE = "dwelling_house"
    SECONDARY_DWELLING = "secondary_dwelling"
    SHED = "shed"


class Status(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    UNRESOLVED = "UNRESOLVED"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class PathwayStatus(str, Enum):
    ELIGIBLE = "ELIGIBLE"
    NOT_ELIGIBLE = "NOT_ELIGIBLE"
    UNRESOLVED = "UNRESOLVED"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class Pill(str, Enum):
    REQUIRED = "Required"
    POSSIBLE = "Possible"
    NOT_APPLICABLE = "Not applicable"
    UNRESOLVED = "Unresolved"


class PathwayInput(M):
    """Lot + proposal facts. Every field defaults to None (= unknown => UNRESOLVED); nothing is assumed."""
    dev_type: DevType
    lga: str | None = None
    zone: str | None = None
    lot_area_m2: float | None = None
    lot_width_m: float | None = None                 # at the primary road building line
    landholding_area_m2: float | None = None         # defaults to lot area for farm building rules
    lot_type: Literal["standard", "corner", "battle_axe", "parallel_road"] | None = None
    farm_building: bool | None = None                # shed: ancillary to an agricultural use of the landholding
    within_existing_dwelling: bool = False           # secondary dwelling entirely within an existing dwelling
    # proposal
    storeys: float | None = None
    building_height_m: float | None = None
    gfa_m2: float | None = None
    footprint_m2: float | None = None
    setback_primary_m: float | None = None
    setback_secondary_m: float | None = None
    setback_side_m: float | None = None              # smallest side setback achieved
    setback_rear_m: float | None = None
    wall_height_side_m: float | None = None          # height of the development nearest the side boundary
    wall_height_rear_m: float | None = None
    neighbour_avg_primary_setback_m: float | None = None   # average of the 2 nearest dwelling houses within 40 m, same side
    primary_road_sealed: bool | None = None
    parking_spaces: float | None = None
    watercourse_distance_m: float | None = None
    distance_to_other_building_m: float | None = None
    existing_dwelling_houses_on_lot: int | None = None
    principal_dwelling_present: bool | None = None
    lot_is_strata_or_community: bool | None = None
    involves_subdivision: bool | None = None
    engineer_design_provided: bool | None = None
    # LEP
    lep_permissibility: Literal["permitted_with_consent", "permitted_without_consent", "prohibited"] | None = None
    lep_min_lot_size_m2: float | None = None
    lep_min_lot_size_specified: bool | None = None
    # constraints (SA9 / s10.7). True = the exclusion applies.
    bushfire_prone: bool | None = None
    bal: str | None = None                           # BAL-LOW, BAL-12.5, BAL-19, BAL-29, BAL-40, BAL-FZ
    flood_control_lot: bool | None = None
    flood_affected: bool | None = None
    heritage_item: bool | None = None
    state_heritage_item: bool | None = None
    heritage_conservation_area: bool | None = None
    land_reserved_public_purpose: bool | None = None
    acid_sulfate_class_1_or_2: bool | None = None
    buffer_area: bool | None = None
    riverfront_area: bool | None = None
    ecologically_sensitive_area: bool | None = None
    protected_area: bool | None = None
    coastal_hazard: bool | None = None
    foreshore_area: bool | None = None
    anef_25_or_higher: bool | None = None
    unsewered_drinking_water_catchment: bool | None = None
    special_area: bool | None = None
    environmentally_sensitive_area: bool | None = None
    critical_habitat_or_wilderness: bool | None = None
    easements_present: bool | None = None
    near_incompatible_land_use_250m: bool | None = None
    provenance: dict[str, str] = Field(default_factory=dict)   # field -> where the value came from (e.g. "SA9 nsw_heritage_item")


class CriterionResult(M):
    rule_id: str
    code: str
    category: Literal["applicability", "exclusion", "standard", "data"]
    label: str
    status: Status
    field: str | None = None
    op: str | None = None
    required_value: float | None = None
    required_text: str = ""
    unit: str | None = None
    proposed_value: Any = None
    citation: Source | None = None
    note: str = ""
    prompt: str | None = None                  # what to supply when UNRESOLVED
    assumptions: list[str] = Field(default_factory=list)
    verify_current: bool = False

    def cite(self) -> str:
        return self.citation.cite() if self.citation else ""


class PathwayCard(M):
    pathway: Literal["exempt", "cdc", "da"]
    title: str
    status: PathwayStatus
    pill: Pill
    headline: str
    recommendation: str
    codes: list[str] = Field(default_factory=list)
    criteria: list[CriterionResult] = Field(default_factory=list)
    failing: CriterionResult | None = None
    unresolved: list[CriterionResult] = Field(default_factory=list)


class PathwayResult(M):
    dev_type: DevType
    lga: str | None
    zone: str | None
    cards: list[PathwayCard]
    suggested_pathway: Literal["exempt", "cdc", "da"] | None
    summary: str
    recommendation: str = RECOMMENDATION
    data_gaps: list[str] = Field(default_factory=list)
    blocked_documents: list[str] = Field(default_factory=list)
    rule_set_built_at: str | None = None
    currency_warning: str | None = None
    disclaimer: str = DISCLAIMER

    def card(self, pathway: str) -> PathwayCard:
        return next(c for c in self.cards if c.pathway == pathway)

    def ui_model(self) -> dict:
        """Compact model for the UI cards."""
        return {"summary": self.summary, "recommendation": self.recommendation, "suggested": self.suggested_pathway,
                "cards": [{"pathway": c.pathway, "title": c.title, "pill": c.pill.value, "status": c.status.value, "headline": c.headline,
                           "failing": c.failing.label if c.failing else None, "failing_citation": c.failing.cite() if c.failing else None,
                           "unresolved": [{"label": u.label, "prompt": u.prompt} for u in c.unresolved]} for c in self.cards],
                "disclaimer": self.disclaimer}
