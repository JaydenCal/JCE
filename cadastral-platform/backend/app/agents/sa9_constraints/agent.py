"""SA9 Planning Constraints & Triggers agent."""
from __future__ import annotations

from datetime import date
from pathlib import Path

from pydantic import BaseModel
from shapely import wkt

from app.agents.sa9_constraints.intersect import LayerLoader, LayerResult, check_layer
from app.agents.sa9_constraints.layers import layers_for
from app.agents.sa9_constraints.report import build_report, geojson, overlay_polygons
from app.agents.sa9_constraints.triggers import Resolver, TriggerResult, evaluate
from app.common.contracts import AckKind, DevelopmentType, LotContext, Model, OverlayPolygon

# AgentCode has no SA9 member and contracts.py is not edited here; orchestrator should add it.
AGENT_CODE_NAME = "SA9_CONSTRAINTS"


class Sa9Input(Model):
    lot: LotContext
    footprint_wkt: str | None = None
    output_dir: str
    report_date: str | None = None
    development_type: DevelopmentType = DevelopmentType.dwelling_house
    acknowledgements: list[str] = [k.value for k in AckKind]
    flood_ffl_text: str | None = None   # computed FFL statement (app.flood.ffl_label), referenced by the flood trigger
    # richer report inputs (all optional; the report says plainly what is missing)
    project_title: str | None = None
    flags: list[str] = []
    requirements: list[dict] | None = None              # cited Requirement rows; None = load backend/knowledge/<lga>/ if present
    unresolved_requirements: list[dict] | None = None
    civil: dict | None = None                            # terrain / ffl / earthworks / driveway / services summary
    pathway: dict | None = None                          # sa11 pathway result when available
    zone_map: dict | None = None                         # zone polygons and source for the land zoning map (app.report.maps.zone_map_from_sa1); None = attribute only


class Sa9Result(Model):
    pdf_path: str
    json_path: str
    geojson_path: str
    layers: list[LayerResult]
    triggers: list[TriggerResult]
    overlays: list[OverlayPolygon]


class Sa9Constraints:
    code = AGENT_CODE_NAME
    version = "1.0.0"
    input_schema = "constraints_request.v1"
    output_schema = "constraints_result.v1"
    input_model = Sa9Input

    def __init__(self, loader: LayerLoader | None = None, resolver: Resolver | None = None) -> None:
        self.loader, self.resolver = loader, resolver

    def run(self, p: Sa9Input) -> Sa9Result:
        lot = wkt.loads(p.lot.boundary_wkt)
        fp = wkt.loads(p.footprint_wkt) if p.footprint_wkt else (wkt.loads(p.lot.envelope_wkt) if p.lot.envelope_wkt else None)
        res = [check_layer(l, lot, fp, self.loader) for l in layers_for(p.lot.jurisdiction)]
        trig = evaluate(res, p.lot.jurisdiction, self.resolver, development_type=p.development_type.value)
        if p.flood_ffl_text:
            for t in trig:
                if t.rule_id == "flood.fpl":
                    t.next_steps = [f"Computed minimum floor level: {p.flood_ffl_text}"] + t.next_steps
        cur = sorted({r.data_currency for r in res if r.data_currency})
        from app.report.knowledge import derive_lga, load_requirements
        lga = derive_lga(p.lot.lga_name, res)
        meta = {"lotplan": p.lot.lotplan, "lga_name": lga, "jurisdiction": p.lot.jurisdiction, "development_type": p.development_type.label,
                "development_type_key": p.development_type.value, "date": p.report_date or date.today().isoformat(),
                "data_currency": "; ".join(cur) or "unknown", "zone_code": p.lot.zone_code, "area_m2": p.lot.area_m2_calculated,
                "area_registered": p.lot.area_m2_registered, "mga_srid": p.lot.mga_srid, "flags": p.flags,
                "flood_ffl_text": p.flood_ffl_text, "project_title": p.project_title}
        reqs, unres = p.requirements, p.unresolved_requirements
        if reqs is None:
            reqs, kunres = load_requirements(lga)
            unres = kunres if unres is None else unres
        out = Path(p.output_dir); out.mkdir(parents=True, exist_ok=True)
        pdf, js, gj = out / "constraints_report.pdf", out / "constraints_report.json", out / "constraints.geojson"
        build_report(pdf, js, meta, res, trig, p.lot.boundary_wkt, p.footprint_wkt, p.acknowledgements,
                     neighbours=p.lot.neighbours, segments=p.lot.segments, road_names=p.lot.road_names, requirements=reqs or [],
                     unresolved_requirements=unres or [], civil=p.civil, pathway=p.pathway, zone_map=p.zone_map, maps_dir=out / "planning_maps")
        import json
        gj.write_text(json.dumps(geojson(res, p.lot.boundary_wkt, p.footprint_wkt, p.lot.mga_srid)))
        return Sa9Result(pdf_path=str(pdf), json_path=str(js), geojson_path=str(gj), layers=res, triggers=trig,
                         overlays=overlay_polygons(res))
