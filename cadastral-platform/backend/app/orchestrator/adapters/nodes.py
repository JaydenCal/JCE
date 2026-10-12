"""Per-node adapters.

Each real agent is wrapped by a subclass whose ``input_model`` is a typed *node input*: the
validated outputs of the upstream nodes (read back from the payload store) plus the run
parameters. ``run`` converts that into the agent's native request model, runs the agent and
returns its native result, which is what downstream node inputs embed. Nothing is passed as a
loose dict; every hop is validated by pydantic.

    SA1 -> Sa1Result     SA2 -> Sa2Output     ENV -> Sa3DrivewayResult   SA3 -> Sa3TerrainResult
    SA7 -> PlanOverlay   SA4 -> Sa4Result     SA5 -> CadResult
"""
from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator
from shapely import wkt as shw
from shapely.geometry import MultiPolygon, Polygon

from app.agents.base import AgentError
from app.agents.sa1_cadastre.agent import Sa1Cadastre
from app.agents.sa1_cadastre.models import Sa1Request, Sa1Result
from app.agents.sa2_dcp_rag.agent import Sa2DcpRag
from app.agents.sa2_dcp_rag.models import Sa2Input, Sa2Output
from app.agents.sa3_driveway.agent import Sa3Driveway
from app.agents.sa3_driveway.models import Sa3DrivewayRequest, Sa3DrivewayResult
from app.agents.sa3_driveway.models import SetbackRule as DrivewayRule
from app.agents.sa3_terrain.agent import Sa3Terrain
from app.agents.sa3_terrain.models import PadDesign, Sa3TerrainRequest, Sa3TerrainResult
from app.agents.sa4_hydro.agent import Sa4Hydro
from app.agents.sa4_hydro.models import Sa4Request, Sa4Result
from app.agents.sa5_cad_dxf.agent import Sa5CadDxf
from app.agents.sa5_cad_dxf.model import CadRequestSa5
from app.agents.sa7_pdf_align.agent import Sa7PdfAligner
from app.common.contracts import AckKind, AgentCode, LotContext, PlanOverlay, PlanUpload

from .params import SiteParams

ADAPTER_SUFFIX = "+adp1"


class NodeModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------------------- node inputs
class Sa1Node(NodeModel):
    project_id: UUID
    project_jurisdiction: Literal["NSW", "QLD"] | None = None
    params: SiteParams


class Sa7Node(NodeModel):
    upload_id: UUID
    project_id: UUID
    storage_path: str
    file_sha256: str
    selected_page: int | None = None
    sa1: Sa1Result


class Sa2Node(NodeModel):
    sa1: Sa1Result
    params: SiteParams


class EnvNode(NodeModel):
    sa1: Sa1Result
    sa2: Sa2Output
    params: SiteParams


class TerrainNode(NodeModel):
    sa1: Sa1Result
    env: Sa3DrivewayResult
    overlay: PlanOverlay | None = None
    params: SiteParams


class Sa3Dispatch_Input(NodeModel):
    node: Literal["ENV", "SA3"]
    env: EnvNode | None = None
    terrain: TerrainNode | None = None

    @model_validator(mode="after")
    def _match(self):
        if (self.node == "ENV") != (self.env is not None) or (self.node == "SA3") != (self.terrain is not None):
            raise ValueError(f"payload for node {self.node} must carry exactly its own section")
        return self


class Sa4Node(NodeModel):
    sa1: Sa1Result
    env: Sa3DrivewayResult
    overlay: PlanOverlay | None = None
    params: SiteParams


class Sa5Node(NodeModel):
    project_id: UUID
    drawing_scale_denominator: int = Field(gt=0)
    sa1: Sa1Result
    sa2: Sa2Output | None = None
    env: Sa3DrivewayResult
    sa4: Sa4Result
    overlay: PlanOverlay | None = None
    export_formats: list[Literal["dxf", "pdf"]] = ["dxf", "pdf"]
    acknowledgements_present: list[AckKind]
    project_title: str
    drawn_by: str
    output_path: str


# --------------------------------------------------------------------------- conversions
def _largest_polygon_wkt(w: str) -> str:
    g = shw.loads(w)
    if isinstance(g, MultiPolygon):
        g = max(g.geoms, key=lambda x: x.area)
    if not isinstance(g, Polygon) or g.is_empty:
        raise AgentError("NO_FOOTPRINT", "no polygon available for the building pad")
    return g.wkt


def sa1_request(n: Sa1Node) -> Sa1Request:
    p = n.params
    return Sa1Request(jurisdiction=p.jurisdiction or n.project_jurisdiction or _missing("jurisdiction"),
                      lot_identifier=p.lot_identifier, address=p.address, point=p.point)


def _missing(what: str):
    raise AgentError("PARAM_MISSING", f"run params / project must provide {what}")


def road_frontages(lot: LotContext) -> int:
    return sum(1 for s in lot.segments if s.adjoins == "road")


def sa2_input(n: Sa2Node) -> Sa2Input:
    lot = n.sa1.lot
    zone = n.params.zone_code or lot.zone_code
    if not zone:
        raise AgentError("ZONE_UNKNOWN", "SA1 found no zone for the lot; supply params.zone_code")
    front = next((s for s in lot.segments if s.is_front), None)
    return Sa2Input(lga=lot.lga_name, zone_code=zone, corner_lot=road_frontages(lot) >= 2,
                    area_m2=lot.area_m2_calculated, frontage_m=front.distance_m if front else None,
                    dwelling_type=n.params.dwelling_type)


def driveway_rules(sa2: Sa2Output) -> list[DrivewayRule]:
    out = []
    for r in sa2.setback_ruleset.rules:
        if r.is_performance_outcome:      # only deemed-to-comply numbers drive the envelope
            continue
        out.append(DrivewayRule(rule_id=f"{r.source_chunk_id}:{r.element}", element=r.element,
                                value_numeric=r.value_numeric, unit=r.unit, zone_code=r.zone_code,
                                lot_condition=r.lot_condition))
    return out


def driveway_request(n: EnvNode) -> Sa3DrivewayRequest:
    d = n.params.driveway
    return Sa3DrivewayRequest(
        lot=n.sa1.lot, setback_rules=driveway_rules(n.sa2), dwelling_type=n.params.dwelling_type,
        easements_wkt=d.easements_wkt, exclusion_polygons_wkt=d.exclusion_polygons_wkt,
        preferred_offset_m=d.preferred_offset_m, garage_xy=d.garage_xy, parking=d.parking, width_m=d.width_m,
        kerb_to_boundary_m=d.kerb_to_boundary_m, vehicle=d.vehicle, levels=d.levels, on_site_turn=d.on_site_turn)


def terrain_request(n: TerrainNode) -> Sa3TerrainRequest:
    t = n.params.terrain
    if t.survey is None:
        raise AgentError("SURVEY_MISSING", "params.terrain.survey is required for earthworks")
    design = None
    if t.pad_level_m is not None:
        fp = n.overlay.footprint_wkt if n.overlay else _largest_polygon_wkt(n.env.envelope.envelope_wkt)
        design = PadDesign(pad_level_m=t.pad_level_m, footprint_wkt=fp)
    kw = {"options": t.options} if t.options else {}
    return Sa3TerrainRequest(lot=n.sa1.lot, survey=t.survey, design=design, **kw)


def lot_with_envelope(sa1: Sa1Result, env: Sa3DrivewayResult) -> LotContext:
    return sa1.lot.model_copy(update={"envelope_wkt": env.envelope.envelope_wkt})


def sa4_request(n: Sa4Node) -> Sa4Request:
    d = n.params.dbyd
    return Sa4Request(
        lot=lot_with_envelope(n.sa1, n.env), pdf_path=d.pdf_path, pdf_page=d.pdf_page, legend=d.legend,
        control_points=d.control_points, scale_denominator=d.scale_denominator, boundary_rgb=d.boundary_rgb,
        digitised_assets=d.digitised_assets, tolerance_m=d.tolerance_m,
        slab_wkt=n.overlay.footprint_wkt if n.overlay else None, driveway=n.env.driveway,
        outlet_xy=d.outlet_xy, outlet_invert_m=d.outlet_invert_m, main_invert_m=d.main_invert_m,
        sewer_junction_xy=d.sewer_junction_xy, meter_xy=d.meter_xy, rwt=d.rwt)


def cad_request(n: Sa5Node) -> CadRequestSa5:
    lot = lot_with_envelope(n.sa1, n.env)
    return CadRequestSa5(
        project_id=n.project_id, mga_srid=lot.mga_srid, drawing_scale_denominator=n.drawing_scale_denominator,
        lot=lot, overlay=n.overlay, driveway=n.env.driveway, services=n.sa4.to_cad_services(),
        rwt=n.sa4.to_cad_rwt(), council_overlays=[], council_name=lot.lga_name or None,
        export_formats=n.export_formats, acknowledgements_present=n.acknowledgements_present,
        project_title=n.project_title, drawn_by=n.drawn_by, output_path=n.output_path)


def plan_upload(n: Sa7Node) -> PlanUpload:
    return PlanUpload(upload_id=n.upload_id, project_id=n.project_id, storage_path=n.storage_path,
                      file_sha256=n.file_sha256, selected_page=n.selected_page, lot=n.sa1.lot)


# --------------------------------------------------------------------------- adapter agents
class Sa1Adapter(Sa1Cadastre):
    version = Sa1Cadastre.version + ADAPTER_SUFFIX
    input_model = Sa1Node

    def run(self, payload: Sa1Node) -> Sa1Result:  # type: ignore[override]
        return super().run(sa1_request(payload))


class Sa2Adapter(Sa2DcpRag):
    version = Sa2DcpRag.version + ADAPTER_SUFFIX
    input_model = Sa2Node

    def run(self, payload: Sa2Node) -> Sa2Output:  # type: ignore[override]
        return super().run(sa2_input(payload))


class Sa7Adapter(Sa7PdfAligner):
    version = Sa7PdfAligner.version + ADAPTER_SUFFIX
    input_model = Sa7Node

    def run(self, payload: Sa7Node) -> PlanOverlay:  # type: ignore[override]
        return super().run(plan_upload(payload))


class Sa4Adapter(Sa4Hydro):
    version = Sa4Hydro.version + ADAPTER_SUFFIX
    input_model = Sa4Node

    def run(self, payload: Sa4Node) -> Sa4Result:  # type: ignore[override]
        return super().run(sa4_request(payload))


class Sa5Adapter(Sa5CadDxf):
    version = Sa5CadDxf.version + ADAPTER_SUFFIX
    input_model = Sa5Node

    def run(self, payload: Sa5Node):  # type: ignore[override]
        return super().run(cad_request(payload))


class Sa3Dispatch:
    """AgentCode.SA3_GEOM_TIN serves two DAG nodes: ENV (envelope + driveway) and SA3 (terrain)."""

    code = AgentCode.SA3_GEOM_TIN
    input_schema = "sa3_dispatch_request.v1"
    output_schema = "sa3_dispatch_result.v1"
    input_model = Sa3Dispatch_Input

    def __init__(self, driveway: Sa3Driveway | None = None, terrain: Sa3Terrain | None = None) -> None:
        self.driveway, self.terrain = driveway or Sa3Driveway(), terrain or Sa3Terrain()
        self.version = f"{self.driveway.version}/{self.terrain.version}{ADAPTER_SUFFIX}"

    def run(self, payload: Sa3Dispatch_Input) -> BaseModel:
        if payload.node == "ENV":
            return self.driveway.run(driveway_request(payload.env))
        return self.terrain.run(terrain_request(payload.terrain))

