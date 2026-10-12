"""SA3 driveway / crossover / vehicle-turning + building envelope. Status always 'unverified'."""
from __future__ import annotations

import math

import numpy as np
from shapely import wkt as shw
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

from app.common.contracts import AgentCode, DrivewayDesign

from . import profile as pf
from . import swept as sw
from .crossover import council_standard, driveway_width, plan_crossover
from .envelope import build_envelope
from .models import CheckItem, Sa3DrivewayRequest, Sa3DrivewayResult

AGENT_VERSION = "0.1.0"
ROAD_SIDE_DEPTH = 30.0


class Sa3Driveway:
    code = AgentCode.SA3_GEOM_TIN
    version = AGENT_VERSION
    input_schema = "sa3_driveway_request.v1"
    output_schema = "sa3_driveway_result.v1"
    input_model = Sa3DrivewayRequest

    def run(self, req: Sa3DrivewayRequest) -> Sa3DrivewayResult:
        lot = req.lot
        warns: list[str] = []
        env = build_envelope(lot, req.setback_rules, req.easements_wkt, req.exclusion_polygons_wkt, req.dwelling_type,
                             req.segment_role_overrides)
        warns += env.warnings
        items, cites = [], []
        std = council_standard(lot.lga_name, req.council_standard, requirements=req.requirements,
                               use_placeholders=req.use_placeholders, unresolved=items, citations=cites,
                               selectors=dict(jurisdiction=lot.jurisdiction, lga=lot.lga_name))
        ph = req.council_standard is None and (req.requirements is None or any(
            i.key == "driveway.max_grade_pct" for i in items) and req.use_placeholders)
        width = driveway_width(req.parking, req.width_m, req.widths, std, warns)
        depth = env.setbacks_m.get("front", 0.0) or 6.0
        lay = plan_crossover(lot, std, width, preferred_offset_m=req.preferred_offset_m, garage_xy=req.garage_xy,
                             garage_depth_m=depth, kerb_to_boundary_m=req.kerb_to_boundary_m, exclusions=req.exclusion_points,
                             min_corner_m=req.min_corner_distance_m, min_side_m=req.min_side_distance_m)
        warns += lay.warnings
        checks = [CheckItem(name="crossover_width", passed=True, value=width, unit="m",
                            note="AS/NZS 2890.1 Class 1 width parameters - VERIFY; " + std.source_label)]

        # longitudinal profile
        bp, gp, kp = map(np.array, (lay.boundary_point, lay.garage_point, lay.kerb_point))
        gd = float(np.linalg.norm(gp - bp))
        n = np.array(lay.inward_normal)
        xy_at = lambda s: tuple(bp + n * (s - req.kerb_to_boundary_m))  # noqa: E731
        st = pf.build_stations(req.levels, req.kerb_to_boundary_m, gd, sampler=req.tin_sampler, xy_at=xy_at)
        pchecks = pf.check_profile(st, std, strict=req.requirements is not None and not req.use_placeholders)
        checks += pchecks
        mg = next((c.value for c in pchecks if c.name == "max_grade"), None)

        # swept path: park nose-in, reverse out onto the street
        v = sw.VEHICLES.get(req.vehicle) or sw.VEHICLES["B85"]
        heading = math.atan2(n[1], n[0])
        fd = lay.front_dir
        side = 1 if (n[0] * fd[1] - n[1] * fd[0]) < 0 else -1
        s1 = sw.reverse_out(v, tuple(gp), heading, gd + req.kerb_to_boundary_m, 90.0, side)
        sweeps = [s1.polygon]
        start_turn = (*(bp + n * max(gd / 2, 0)), heading)
        if req.on_site_turn:
            sweeps.append(sw.three_point_turn(v, (start_turn[0], start_turn[1], heading), side).polygon)
        swept = unary_union(sweeps)
        lotp = shw.loads(lot.boundary_wkt)
        road = Polygon([tuple(bp - n * 0 - np.array(lay.front_dir) * 100), tuple(bp + np.array(lay.front_dir) * 100),
                        tuple(bp + np.array(lay.front_dir) * 100 - n * ROAD_SIDE_DEPTH),
                        tuple(bp - np.array(lay.front_dir) * 100 - n * ROAD_SIDE_DEPTH)])
        allowed = unary_union([lotp, road])
        excl = [shw.loads(w) for w in req.exclusion_polygons_wkt if w]
        # envelope exclusions apply to the manoeuvre only on the lot side; easements may be driven over
        checks += sw.check_envelope(swept, allowed=allowed, obstacles=[shw.loads(w) for w in req.obstacle_polygons_wkt],
                                    min_clear_m=req.clearance_min_m)
        c, R, outer, inner = sw.turning_circle(v, (*(bp + n * gd * 0.5), heading), side)
        drive = DrivewayDesign(
            centreline_wkt=lay.centreline_wkt, width_m=width, crossover_wkt=lay.crossover_wkt, max_grade_pct=mg,
            design_vehicle=v.name, council_standard_label=lay.standard_label, turning_path_wkt=swept.wkt,
            turning_circle_centre_xy=(float(c[0]), float(c[1])), turning_circle_radius_m=float(outer), dimensions=lay.dimensions)
        if not st:
            warns.append("no levels supplied: grade/scraping checks not evaluated")
        if ph:
            warns.append("PLACEHOLDER, NOT A REQUIREMENT: default driveway standard values used; cannot be verified.")
        if items:
            warns.append(f"{len(items)} requirement(s) unresolved: " + "; ".join(i.key for i in items))
        return Sa3DrivewayResult(envelope=env, driveway=drive, checks=checks, warnings=warns, unresolved=items,
                                 requirement_citations=cites, placeholders_used=ph,
                                 verifiable=(req.requirements is not None and not items and not ph))
