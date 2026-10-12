"""SA3 terrain request/result models (pydantic v2)."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.common.contracts import LotContext


class M(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SurveyInput(M):
    """Any of: points [[x,y,z]], contours [{z, coords}], geojson dict, dxf_path, csv_path."""
    srid: int
    points: list[tuple[float, float, float]] = []
    contours: list[dict[str, Any]] = []      # {"z": float, "coords": [[x,y],...]}
    breaklines: list[list[tuple[float, float, float]]] = []
    geojson: dict[str, Any] | None = None
    dxf_path: str | None = None
    csv_path: str | None = None
    dxf_include_text: bool = False
    stated_vertical_accuracy_m: float = 0.1
    source: str = "unspecified"


class PadDesign(M):
    pad_level_m: float
    footprint_wkt: str
    cut_batter_h_per_v: float = 2.0   # 1:2 (V:H)
    fill_batter_h_per_v: float = 3.0  # 1:3
    topsoil_strip_depth_m: float = 0.15
    bulking_factor: float = 1.25
    shrinkage_factor: float = 0.90
    wall_height_threshold_m: float = 0.5


class TinOptions(M):
    max_spacing_m: float = 2.0
    lot_buffer_m: float = 10.0
    max_edge_m: float = 40.0
    min_angle_deg: float = 1.0
    mesh_max_vertices: int = 5000


class Sa3TerrainRequest(M):
    lot: LotContext
    survey: SurveyInput
    design: PadDesign | None = None
    options: TinOptions = TinOptions()


class TinOut(M):
    surface_role: Literal["existing", "proposed"] = "existing"
    mga_srid: int
    vertex_count: int
    triangle_count: int
    min_z: float
    max_z: float
    vertices_f64_b64: str
    triangles_u32_b64: str
    build_params: dict[str, Any]


class ZoneOut(M):
    kind: Literal["cut", "fill"]
    min_depth_m: float
    max_depth_m: float
    area_m2: float
    wkt: str


class CutFillOut(M):
    method: str = "prismoidal_triangle"
    pad_level_m: float | None = None
    cut_volume_m3: float
    fill_volume_m3: float
    net_volume_m3: float            # cut - fill (bank), +ve = export
    cut_area_m2: float
    fill_area_m2: float
    topsoil_strip_m3: float
    topsoil_area_m2: float
    cut_loose_m3: float             # cut * bulking
    fill_bank_equivalent_m3: float  # fill / shrinkage
    net_bank_after_shrinkage_m3: float
    bulking_factor: float
    shrinkage_factor: float
    volume_uncertainty_m3: float
    stated_uncertainty_pct: float
    zones: list[ZoneOut]


class WallAssumptions(M):
    unit_weight_kn_m3: float = 18.0
    phi_deg: float = 28.0
    surcharge_kpa: float = 0.0
    groundwater: str = "none"
    wall_friction_ratio: float = 2 / 3
    gravity_wall_width_ratio: float = 0.6
    wall_unit_weight_kn_m3: float = 22.0
    min_fs_sliding: float = 1.5
    min_fs_overturning: float = 2.0
    note: str = ("Indicative screening only. NOT structural design. Assumed soil, no groundwater, "
                 "no surcharge; a geotechnical/structural engineer must design and certify.")


class WallSegment(M):
    mode: Literal["cut", "fill"]
    length_m: float
    max_height_m: float
    alignment: list[tuple[float, float]]
    suggested_type: str
    ka: float
    active_force_kn_per_m: float
    fs_sliding: float
    fs_overturning: float
    screening_ok: bool
    engineer_certification_required: bool


class WallsOut(M):
    segments: list[WallSegment]
    max_retained_height_m: float
    total_length_m: float
    engineer_certification_required: bool
    assumptions: WallAssumptions
    disclaimer: str = "NOT structural design"


class MeshOut(M):
    origin: tuple[float, float, float]
    vertices: list[float]   # local x,y,z flattened (z up)
    indices: list[int]


class Sa3TerrainResult(M):
    schema_name: str = "sa3_terrain_result.v1"
    status: Literal["unverified"] = "unverified"
    tin: TinOut
    cut_fill: CutFillOut | None = None
    walls: WallsOut | None = None
    mesh: MeshOut
    vertical_accuracy_m: float
    source: str
    lot_coverage_pct: float
    warnings: list[str] = Field(default_factory=list)
