"""Sa3Terrain: SubAgent (SA3_GEOM_TIN)."""
from __future__ import annotations

import base64

import numpy as np
from shapely import wkt as swkt

from app.agents.base import AgentError
from app.common.contracts import AgentCode

from .cutfill import cut_fill, pad_surface
from .ingest import ingest
from .models import MeshOut, Sa3TerrainRequest, Sa3TerrainResult, TinOut
from .tin import build_tin, decimate_for_mesh
from .walls import find_walls


class Sa3Terrain:
    code = AgentCode.SA3_GEOM_TIN
    version = "0.1.0"
    input_schema = "sa3_terrain_request.v1"
    output_schema = "sa3_terrain_result.v1"
    input_model = Sa3TerrainRequest

    def run(self, p: Sa3TerrainRequest) -> Sa3TerrainResult:
        o = p.options
        sv = ingest(p.survey, p.lot.mga_srid)
        lot = swkt.loads(p.lot.boundary_wkt)
        try:
            tin = build_tin(sv, lot, o.max_spacing_m, o.lot_buffer_m, o.max_edge_m, o.min_angle_deg)
        except ValueError as e:
            raise AgentError("TIN_FAILED", str(e)) from e
        warns = list(sv.warnings)
        from shapely import contains_xy
        gx, gy = np.meshgrid(np.linspace(lot.bounds[0], lot.bounds[2], 40), np.linspace(lot.bounds[1], lot.bounds[3], 40))
        ins = contains_xy(lot, gx.ravel(), gy.ravel())
        coverage = 100 * float(np.mean(~np.isnan(tin.z_at(gx.ravel()[ins], gy.ravel()[ins])))) if ins.any() else 0.0
        if coverage < 99:
            warns.append(f"TIN covers only {coverage:.0f}% of lot; extrapolation not performed")
        if sv.accuracy_m > 0.25:
            warns.append(f"vertical accuracy {sv.accuracy_m} m is coarse for earthworks")
        cf = walls = flood_out = min_ffl_out = None
        pad = None
        if p.design:
            d = p.design
            fp = swkt.loads(d.footprint_wkt)
            if not lot.buffer(1e-6).contains(fp):
                warns.append("pad footprint extends outside lot boundary")
            pad = d.pad_level_m
            if d.flood_level_ahd is not None or d.flood_freeboard_m is not None:
                from app.flood import Freeboard, FloodLevelInput, compute_min_ffl
                fchk = compute_min_ffl(FloodLevelInput(level_ahd=d.flood_level_ahd, event=d.flood_event, source=d.flood_source,
                                                       source_ref=d.flood_source_ref),
                                       Freeboard(value_m=d.flood_freeboard_m, source=d.flood_freeboard_source),
                                       tin, footprint=fp, proposed_ffl=d.pad_level_m)
                if fchk.min_ffl is not None:
                    pad = max(d.pad_level_m, fchk.min_ffl)
                    fchk.proposed_ffl = pad
                    fchk.floor_above_flood_m = round(pad - d.flood_level_ahd, 3)
                    fchk.floor_above_flood_ok = True
                    fchk.result = "PASS"
                    if pad > d.pad_level_m:
                        warns.append(f"FFL raised from requested RL {d.pad_level_m:.2f} to RL {pad:.2f} (flood level + freeboard)")
                else:
                    warns.append(fchk.prompt or "flood level unresolved")
                warns.extend(fchk.warnings)
                flood_out = fchk.model_dump()
                min_ffl_out = fchk.min_ffl
            d = d.model_copy(update={"pad_level_m": pad})
            surf = pad_surface(tin, fp, d.pad_level_m, d.cut_batter_h_per_v, d.fill_batter_h_per_v)
            cf = cut_fill(tin, surf, region=lot, footprint=fp, accuracy_m=sv.accuracy_m,
                          topsoil_depth=d.topsoil_strip_depth_m, bulking=d.bulking_factor,
                          shrinkage=d.shrinkage_factor, pad_level=d.pad_level_m)
            walls = find_walls(tin, fp, d.pad_level_m, d.wall_height_threshold_m)
            pad = d.pad_level_m
            if walls.engineer_certification_required:
                warns.append("retaining wall > 1.0 m: engineer certification required (screening is NOT design)")
        vb, tb = tin.to_bytes()
        t = TinOut(mga_srid=p.survey.srid, vertex_count=len(tin.vertices), triangle_count=len(tin.triangles),
                   min_z=tin.min_z, max_z=tin.max_z, vertices_f64_b64=base64.b64encode(vb).decode(),
                   triangles_u32_b64=base64.b64encode(tb).decode(), build_params=tin.build_params)
        V, T = decimate_for_mesh(tin, o.mesh_max_vertices)
        org = V.mean(0)
        mesh = MeshOut(origin=tuple(float(v) for v in org), vertices=(V - org).ravel().round(4).tolist(),
                       indices=np.asarray(T).ravel().tolist())
        return Sa3TerrainResult(tin=t, cut_fill=cf, walls=walls, mesh=mesh, vertical_accuracy_m=sv.accuracy_m,
                                source=sv.source, lot_coverage_pct=coverage, warnings=warns,
                                flood=flood_out, min_ffl=min_ffl_out, effective_pad_level_m=pad)
