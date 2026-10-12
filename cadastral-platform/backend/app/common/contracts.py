"""Shared message contracts between the Orchestrator and sub-agents.

Mirrors docs/01-orchestration-topology.md section 4. Every payload carries a
schema name and version; large bodies are passed by reference (PayloadRef).
"""
from __future__ import annotations

import hashlib
import json
from enum import Enum
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field


class AgentCode(str, Enum):
    ORCH = "ORCH"
    SA1_CADASTRE = "SA1_CADASTRE"
    SA2_DCP_RAG = "SA2_DCP_RAG"
    SA3_GEOM_TIN = "SA3_GEOM_TIN"
    SA4_HYDRO = "SA4_HYDRO"
    SA5_CAD_DXF = "SA5_CAD_DXF"
    SA6_GLIDE3D = "SA6_GLIDE3D"
    SA7_PDF_ALIGN = "SA7_PDF_ALIGN"


class RunStatus(str, Enum):
    queued = "queued"
    running = "running"
    waiting_user = "waiting_user"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"
    blocked_by_gate = "blocked_by_gate"


class AckKind(str, Enum):
    dbyd_physical_verification = "dbyd_physical_verification"
    setback_user_verification = "setback_user_verification"
    cut_fill_indicative_only = "cut_fill_indicative_only"
    retaining_wall_not_structural = "retaining_wall_not_structural"
    crossover_not_certified = "crossover_not_certified"
    cadastre_not_survey = "cadastre_not_survey"
    uploaded_plan_accuracy = "uploaded_plan_accuracy"
    upload_rights_warranty = "upload_rights_warranty"
    hydrology_not_certified = "hydrology_not_certified"


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=False)


class PayloadRef(Model):
    payload_id: UUID
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    schema_name: str
    byte_size: int


class Envelope(Model):
    envelope_version: Literal[1] = 1
    run_id: UUID
    invocation_id: UUID = Field(default_factory=uuid4)
    sender: AgentCode = Field(alias="from")
    recipient: AgentCode = Field(alias="to")
    schema_name: str = Field(alias="schema")
    idempotency_key: str
    terms_version_id: UUID
    token_budget: int = Field(gt=0)
    payload_ref: PayloadRef
    deadline_ms: int = Field(default=120_000, gt=0)

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


def canonical_json(obj: Any) -> bytes:
    """Deterministic JSON used for hashing (sorted keys, no whitespace, UTF-8)."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def idempotency_key(agent: AgentCode, input_sha256: str, agent_version: str) -> str:
    return sha256_hex(f"{agent.value}|{input_sha256}|{agent_version}".encode())


# ---- Payloads --------------------------------------------------------------

class BoundarySegment(Model):
    seq: int
    bearing_deg: float
    bearing_dms: str
    distance_m: float
    adjoins: str = "unknown"
    is_front: bool = False
    # MGA coordinates of the segment start and end (metres).
    start_xy: tuple[float, float]
    end_xy: tuple[float, float]


class LotContext(Model):
    """lot_context.v1 (SA1 output). Geometry as WKT in MGA metres for portability."""
    lot_id: UUID
    jurisdiction: Literal["NSW", "QLD"]
    lotplan: str
    lga_name: str
    mga_srid: Literal[7854, 7855, 7856]
    area_m2_calculated: float
    area_m2_registered: float | None = None
    boundary_wkt: str
    segments: list[BoundarySegment]
    road_names: list[str] = []
    zone_code: str | None = None
    envelope_wkt: str | None = None


class PlanUpload(Model):
    """plan_upload.v1 (ORCH -> SA7)."""
    upload_id: UUID
    project_id: UUID
    storage_path: str
    file_sha256: str
    selected_page: int | None = None
    user_scale_denominator: float | None = None
    user_control_points: list[tuple[tuple[float, float], tuple[float, float]]] = []
    lot: LotContext


class PlanOverlay(Model):
    """plan_overlay.v1 (SA7 output)."""
    overlay_id: UUID
    upload_id: UUID
    scale_denominator_used: float
    scale_source: Literal["title_block_text", "scale_bar_measure", "dimension_string", "user_entered"]
    scale_confidence: float
    metres_per_point: float
    rotation_rad: float
    transform: tuple[float, float, float, float, float, float]  # a, b, d, e, xoff, yoff
    matrix_3x3: list[float]
    reflection_applied: bool
    control_point_count: int
    rmse_m: float
    max_residual_m: float
    footprint_wkt: str
    footprint_area_m2: float
    inside_envelope: bool | None = None
    envelope_encroachment_m2: float | None = None
    outcome: Literal["accepted_unverified", "needs_user_confirmation", "refused"]
    messages: list[str] = []


class DrivewayDesign(Model):
    """Driveway and crossover as computed by SA3 (Phase 3); drawn by SA5."""
    centreline_wkt: str                 # MGA, kerb/road edge to garage threshold
    width_m: float
    crossover_wkt: str                  # crossover footprint polygon
    max_grade_pct: float | None = None
    design_vehicle: str = "B85"
    council_standard_label: str | None = None   # e.g. "Hornsby Council Driveway Design Guide"
    turning_path_wkt: str | None = None         # swept path envelope polygon
    turning_circle_centre_xy: tuple[float, float] | None = None
    turning_circle_radius_m: float | None = None
    dimensions: list[tuple[str, tuple[float, float], tuple[float, float]]] = []  # label, p1, p2


class ServiceLine(Model):
    """Water / sewer / stormwater / other line from DBYD or proposed design."""
    service: Literal["water", "sewer", "stormwater", "electricity", "gas", "telecom", "other"]
    label: str
    geometry_wkt: str
    diameter_mm: int | None = None
    depth_m: float | None = None
    is_proposed: bool = False
    exclusion_wkt: str | None = None


class RwtSummary(Model):
    tank_volume_l: int
    location_xy: tuple[float, float]
    diameter_m: float
    regime: str
    note: str = ""


class OverlayPolygon(Model):
    """Council-specific overlay or control (flood, bushfire, heritage, DCP envelope, ...)."""
    label: str
    kind: str
    geometry_wkt: str


class CadRequest(Model):
    """cad_request.v1 (ORCH -> SA5)."""
    project_id: UUID
    mga_srid: Literal[7854, 7855, 7856]
    drawing_scale_denominator: int = Field(gt=0)
    lot: LotContext
    overlay: PlanOverlay | None = None
    driveway: DrivewayDesign | None = None
    services: list[ServiceLine] = []
    rwt: RwtSummary | None = None
    council_overlays: list[OverlayPolygon] = []
    council_name: str | None = None
    export_formats: list[Literal["dxf", "pdf"]] = ["dxf", "pdf"]
    acknowledgements_present: list[AckKind]
    project_title: str
    drawn_by: str
    output_path: str


class CadResult(Model):
    """cad_result.v1 (SA5 output)."""
    dxf_path: str | None = None
    dxf_sha256: str | None = None
    pdf_path: str | None = None
    pdf_sha256: str | None = None
    layers_used: list[str]
    entity_counts: dict[str, int]
    annotation_count: int
