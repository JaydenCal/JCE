"""Sub-Agent 4: Hydrology & Services Mapper (deterministic, outputs always 'unverified')."""
from __future__ import annotations

from pathlib import Path

from shapely import wkt

from app.agents.base import AgentError
from app.agents.requirements.models import UnresolvedRequirement, to_item
from app.common.contracts import AgentCode

from .buffers import PH_STAMP, build_buffers, rules_from_requirements
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
        reqs, items, cites, ph = req.requirements, [], [], False
        sel = dict(jurisdiction=req.lot.jurisdiction, lga=req.lot.lga_name, zone=req.lot.zone_code)
        rules = req.clearance_rules
        if rules is None and reqs is not None:
            rules = rules_from_requirements(assets, reqs, sel, req.use_placeholders, items)
            ph = ph or any(r.placeholder for r in rules)
            cites += [f"util.clearance_m {r.service} dn{r.dia_min_mm}: {r.rule_source}" for r in rules if not r.placeholder]
            buffers = build_buffers(assets, rules, strict=True)
        else:
            ph = ph or (rules is None and bool(assets))
            buffers = build_buffers(assets, rules)

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
                           slab_wkt=req.slab_wkt, avoid_wkts=avoid, requirements=reqs,
                           use_placeholders=req.use_placeholders, selectors=sel)
            items += rwt.unresolved
            cites += rwt.citations
            ph = ph or rwt.placeholder
            if rwt.location_xy and rwt.diameter_m:
                from shapely.geometry import Point
                feats.append(("rwt", Point(rwt.location_xy).buffer(rwt.diameter_m / 2)))
        conflicts = detect_conflicts(assets, buffers, feats)

        # minimum grade / cover: explicit user value > cited requirement > (flagged) placeholder
        grade, gnote = req.min_sewer_grade_pct, None
        cover, cnote = req.proposed_cover_m, None
        if grade is not None:
            gnote = "Minimum grade supplied by the user (no citation)."
        elif reqs is None:
            grade = 1.65
        else:
            try:
                r = reqs.get_requirement("sewer.min_grade_pct", dia_mm=100, **sel)
                grade, gnote = float(r.value), f"Minimum grade {r.value}% - {r.citation()}"
                cites.append(f"sewer.min_grade_pct: {r.citation()}")
            except UnresolvedRequirement as e:
                items.append(to_item(e))
                if req.use_placeholders:
                    grade = 1.65
                else:
                    gnote = "Minimum sewer grade UNRESOLVED: grade not checked."
        ph = ph or (grade == 1.65 and gnote is None)
        required_cover = None
        if reqs is not None:
            try:
                r = reqs.get_requirement("water.min_cover_m", dia_mm=req.water_dia_mm, **sel)
                required_cover = float(r.value)
                cites.append(f"water.min_cover_m: {r.citation()}")
                if cover is None:
                    cover, cnote = required_cover, f"Cover {required_cover} m is the cited minimum - {r.citation()}"
                elif cover < required_cover:
                    warnings.append(f"Proposed cover {cover} m is below the cited minimum {required_cover} m ({r.citation()}).")
                    cnote = f"Proposed cover {cover} m is BELOW the cited minimum {required_cover} m."
            except UnresolvedRequirement as e:
                items.append(to_item(e))
                if cover is None:
                    if req.use_placeholders:
                        cover = 0.6
                    else:
                        cnote = "Minimum cover UNRESOLVED: cover not set."
        elif cover is None:
            cover = 0.6
        ph = ph or (cover == 0.6 and cnote is None and req.proposed_cover_m is None)

        conns = []
        if req.skip_connections:
            warnings.append("Shed (Class 10a): no sewer/water connection modelled; rainwater roof catchment only if supplied.")
        elif req.require_connections and not req.outlet_xy:
            warnings.append("UNRESOLVED: secondary dwelling needs a sewer connection; supply the outlet position (outlet_xy). Not proposed.")
        if req.skip_connections:
            pass
        elif req.outlet_xy:
            c = propose_sewer(req.outlet_xy, assets, junction=req.sewer_junction_xy, outlet_invert_m=req.outlet_invert_m,
                              main_invert_m=req.main_invert_m, min_grade_pct=grade, rules=rules, grade_note=gnote)
            if c:
                conns.append(c)
            else:
                warnings.append("No sewer main found; sewer connection not proposed.")
        meter = None if req.skip_connections else (req.meter_xy or default_meter(req.lot.boundary_wkt, req.lot.segments))
        if req.require_connections and req.meter_xy is None:
            warnings.append("Secondary dwelling water connection: meter position not supplied; default meter position used - confirm with the water authority.")
        if meter:
            c = propose_water(meter, assets, dia_mm=req.water_dia_mm, cover_m=cover, rules=rules, cover_note=cnote)
            if c:
                conns.append(c)
            elif assets:
                warnings.append("No water main found; water service not proposed.")
        uniq = list({(i.key, str(sorted(i.selectors.items()))): i for i in items}.values())
        if ph:
            warnings.append(f"{PH_STAMP}: placeholder values were used; outputs cannot be verified.")
        if uniq:
            warnings.append(f"{len(uniq)} requirement(s) unresolved: " + "; ".join(i.key for i in uniq))
        return Sa4Result(assets=assets, buffers=buffers, conflicts=conflicts, connections=conns, rwt=rwt,
                         georef=georef, warnings=warnings, unresolved=uniq,
                         requirement_citations=cites, placeholders_used=ph,
                         verifiable=(reqs is not None and not uniq and not ph))
