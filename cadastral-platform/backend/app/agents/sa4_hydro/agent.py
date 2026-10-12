"""Sub-Agent 4: Hydrology & Services Mapper (deterministic, outputs always 'unverified')."""
from __future__ import annotations

from pathlib import Path

from shapely import wkt

from app.agents.base import AgentError
from app.common.contracts import AgentCode

from .buffers import build_buffers
from .conflicts import detect_conflicts
from .connections import default_meter, propose_sewer, propose_water
from .dbyd_parse import assets_from_digitised, parse_dbyd
from .models import Sa4Request, Sa4Result
from .rwt import size_rwt


class Sa4Hydro:
    code = AgentCode.SA4_HYDRO
    version = "1.0.0"
    input_schema = "services_request.v1"
    output_schema = "services_result.v1"
    input_model = Sa4Request

    def run(self, payload: Sa4Request) -> Sa4Result:
        req = payload if isinstance(payload, Sa4Request) else Sa4Request(**payload.model_dump())
        warnings: list[str] = []
        assets, georef = [], {}
        lot = wkt.loads(req.lot.boundary_wkt)
        if req.pdf_path:
            try:
                data = Path(req.pdf_path).read_bytes()
            except OSError as exc:
                raise AgentError("DBYD_PDF_UNREADABLE", str(exc)) from exc
            ring = list(lot.exterior.coords)[:-1] if lot.geom_type == "Polygon" else None
            assets, g = parse_dbyd(data, page=req.pdf_page, legend=req.legend, control_points=req.control_points,
                                   scale_denominator=req.scale_denominator, lot_ring=ring,
                                   boundary_rgb=req.boundary_rgb, tolerance_m=req.tolerance_m)
            georef = dict(rmse_m=g.rmse_m, max_residual_m=g.max_residual_m, outcome=g.outcome, control_points=g.n_points)
            warnings += g.messages
        assets += assets_from_digitised(req.digitised_assets, req.tolerance_m)
        if not assets:
            warnings.append("No service assets supplied; results contain no existing-service constraints.")
        warnings.append("Depths are never inferred; unknown depths must be confirmed by potholing. All outputs unverified.")
        buffers = build_buffers(assets, req.clearance_rules)

        feats = []
        if req.slab_wkt:
            feats.append(("slab", wkt.loads(req.slab_wkt)))
        feats += [("excluded_area", wkt.loads(w)) for w in req.excluded_wkts]
        feats += [("trench", wkt.loads(w)) for w in req.trench_wkts]
        if req.driveway:
            feats += [("driveway", wkt.loads(req.driveway.centreline_wkt).buffer(req.driveway.width_m / 2)),
                      ("crossover", wkt.loads(req.driveway.crossover_wkt))]

        rwt = None
        if req.rwt:
            avoid = [b.geometry_wkt for b in buffers] + req.excluded_wkts + req.trench_wkts
            if req.driveway:
                avoid += [g.wkt for k, g in feats if k in ("driveway", "crossover")]
            rwt = size_rwt(req.rwt, lot_wkt=req.lot.boundary_wkt, envelope_wkt=req.lot.envelope_wkt,
                           slab_wkt=req.slab_wkt, avoid_wkts=avoid)
            if rwt.location_xy:
                from shapely.geometry import Point
                feats.append(("rwt", Point(rwt.location_xy).buffer(rwt.diameter_m / 2)))
        conflicts = detect_conflicts(assets, buffers, feats)

        conns = []
        if req.outlet_xy:
            c = propose_sewer(req.outlet_xy, assets, junction=req.sewer_junction_xy, outlet_invert_m=req.outlet_invert_m,
                              main_invert_m=req.main_invert_m, min_grade_pct=req.min_sewer_grade_pct, rules=req.clearance_rules)
            if c:
                conns.append(c)
            else:
                warnings.append("No sewer main found; sewer connection not proposed.")
        meter = req.meter_xy or default_meter(req.lot.boundary_wkt, req.lot.segments)
        if meter:
            c = propose_water(meter, assets, dia_mm=req.water_dia_mm, cover_m=req.proposed_cover_m, rules=req.clearance_rules)
            if c:
                conns.append(c)
            elif assets:
                warnings.append("No water main found; water service not proposed.")
        return Sa4Result(assets=assets, buffers=buffers, conflicts=conflicts, connections=conns, rwt=rwt,
                         georef=georef, warnings=warnings)
