"""Sa10Esc input/output models. Geometry is WKT in MGA metres (the lot's SRID)."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.common.contracts import DevelopmentType, DrivewayDesign, LotContext, ServiceLine

AGENT_CODE_NAME = "SA10_ESC"          # AgentCode has no SA10 member yet (contracts.py is not edited here)
SCHEMA_IN, SCHEMA_OUT = "sa10_esc_request.v1", "sa10_esc_result.v1"
DISCLAIMER = "Indicative proposed ESCP - to be reviewed and certified by a suitably qualified person"


class M(BaseModel):
    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)


class TreePoint(M):
    xy: tuple[float, float]
    label: str = "tree"
    protect_radius_m: float | None = None       # canopy drip-line radius if known; None => unresolved


class LayoutParams(M):
    """Layout assumptions. These are drawing parameters, NOT regulatory requirements: each is listed on the plan/report."""
    boundary_inset_m: float = 0.5               # sediment fence line set in from the lot boundary
    low_margin_m: float = 1.5                   # clearance between works/stockpiles and the fence line
    search_radius_m: float = 25.0               # stockpiles are searched within this distance of the building/driveway
    flat_slope_pct: float = 0.5                 # below this fitted fall the site is treated as flat (flow to road assumed)
    edge_cos: float = 0.25                      # edges facing within ~75 deg of downslope get fence; upslope get diversion
    return_length_m: float = 1.0                # symbolic fence return length
    inlet_trap_length_m: float = 1.5
    inlet_trap_offset_m: float = 1.5            # beyond the crossover edge (gutter) when no pit location is supplied
    grid_step_m: float = 0.5
    # item footprints (length along contour x depth) per development type
    sizes: dict[str, dict[str, tuple[float, float]]] = Field(default_factory=lambda: {
        "dwelling": {"stockpile": (4.0, 3.0), "topsoil": (4.0, 3.0), "laydown": (5.0, 4.0), "washout": (3.0, 2.0),
                     "bin": (2.0, 1.2), "toilet": (1.2, 1.2)},
        "shed": {"stockpile": (3.0, 2.0), "topsoil": (3.0, 2.0), "laydown": (4.0, 3.0), "washout": (2.0, 2.0),
                 "bin": (2.0, 1.2)}})


class Sa10EscInput(M):
    lot: LotContext
    development_type: DevelopmentType = DevelopmentType.dwelling_house
    project_title: str = "Proposed erosion and sediment control plan"
    drawn_by: str = "Cadastral platform SA10"
    issue_date: str | None = None
    front_segment_seq: int | None = None                 # else the segment flagged is_front
    footprint_wkt: str | None = None                     # SA7 PlanOverlay.footprint_wkt or SA6/SA8 footprint
    driveway: DrivewayDesign | None = None
    terrain_points: list[tuple[float, float, float]] = []   # x, y, z (SA3 TIN vertices or survey)
    services: list[ServiceLine] = []                     # SA4 (exclusion buffers keep stockpiles clear)
    tree_points: list[TreePoint] = []
    drainage_lines_wkt: list[str] = []                   # watercourses / drainage lines on or beside the lot
    kerb_inlet_points: list[tuple[float, float]] = []    # street stormwater pits/kerb inlets (MGA)
    disturbed_area_m2: float | None = None               # override of the computed estimate
    duration_months: float | None = None
    params: LayoutParams = LayoutParams()
    requirements_path: str | None = None
    scale_denominator: int | None = None                 # None => smallest standard scale that fits
    basemap_image_path: str | None = None
    basemap_extent: tuple[float, float, float, float] | None = None
    basemap_note: str = ""
    output_dir: str
    file_stem: str | None = None


class EscElement(M):
    id: str
    kind: str                         # fence | access | stockpile | topsoil | laydown | washout | bin | toilet | inlet | diversion | berm | check_dam | limit | nogo | return
    layer: str
    label: str
    geometry_wkt: str
    status: Literal["resolved", "unresolved"]
    req_keys: list[str] = []          # cited requirement keys relied on
    unresolved_keys: list[str] = []   # keys that could not be resolved for this element
    citations: list[str] = []
    notes: list[str] = []
    quantity: float | None = None
    quantity_unit: str | None = None


class FlowInfo(M):
    direction: tuple[float, float]    # unit vector of downslope flow (MGA)
    slope_pct: float | None
    source: str                       # "terrain plane fit (n points)" | "assumed from road, no levels" ...
    assumed: bool
    bearing_deg: float


class Sa10EscOutput(M):
    schema_name: str = SCHEMA_OUT
    agent_code: str = AGENT_CODE_NAME
    status: Literal["unverified"] = "unverified"
    elements: list[EscElement]
    flow: FlowInfo
    quantities: dict[str, Any]
    resolved_keys: list[str]
    unresolved: list[dict[str, Any]]            # {key, prompt, used_by}
    assumptions: list[str]
    warnings: list[str]
    files: dict[str, str]
    disclaimer: str = DISCLAIMER
