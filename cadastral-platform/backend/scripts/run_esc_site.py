#!/usr/bin/env python3
"""Live ESCP sample run (needs network): SA1 lot -> NSW 5 m DEM levels -> SA2 user/cited rules -> ENV envelope+driveway -> SA10 ESCP.

    python scripts/run_esc_site.py --lotplan 2//DP227508 --rules-json ../test-runs/rules/R2_dwelling_house.json --out ../test-runs/esc_lot2_dp227508
"""
from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import run_site as RS  # noqa: E402
from app.agents.sa10_esc import Sa10Esc, Sa10EscInput  # noqa: E402
from app.agents.sa3_terrain.live_levels import fetch_levels  # noqa: E402
from app.agents.sa6_site3d.presets import preset_footprint  # noqa: E402
from app.common.contracts import AgentCode, DevelopmentType  # noqa: E402
from app.imagery.provider import provider_from_env, NswImageryProvider  # noqa: E402
from app.orchestrator.adapters.config import sa1_config_from_env  # noqa: E402
from app.orchestrator.inputs import BuildContext, RunRequest, build_input  # noqa: E402
from app.orchestrator.registry import default_registry  # noqa: E402
from app.agents.sa1_cadastre import clients as C  # noqa: E402
import os, time  # noqa: E402


def placeholder_dwelling(lot, env_wkt, w=12.0, d=12.0):
    """Rectangle w x d aligned to the front boundary, centred laterally in the envelope, as close to the road as the envelope allows."""
    import math
    from shapely import wkt as W
    from shapely.affinity import rotate
    from shapely.geometry import box
    env = W.loads(env_wkt)
    seg = next(x for x in lot.segments if x.is_front)
    ang = math.degrees(math.atan2(seg.end_xy[1] - seg.start_xy[1], seg.end_xy[0] - seg.start_xy[0]))
    o = env.centroid
    loc = rotate(env, -ang, origin=o)
    cs = W.loads(lot.boundary_wkt).centroid
    minx, miny, maxx, maxy = loc.bounds
    front_low = rotate(__import__("shapely.geometry", fromlist=["Point"]).Point(seg.start_xy), -ang, origin=o).y < rotate(cs, -ang, origin=o).y
    cx = (minx + maxx) / 2
    for k in range(0, 400):
        y = (miny + k * 0.25) if front_low else (maxy - k * 0.25 - d)
        r = box(cx - w / 2, y, cx + w / 2, y + d)
        if loc.contains(r):
            return rotate(r, ang, origin=o).wkt
    return env_wkt


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lotplan", required=True)
    ap.add_argument("--development-type", default="dwelling_house")
    ap.add_argument("--rules-json")
    ap.add_argument("--zone-code")
    ap.add_argument("--out", required=True)
    ap.add_argument("--no-levels", action="store_true")
    ap.add_argument("--no-imagery", action="store_true")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    e = dict(os.environ)
    dev = DevelopmentType(a.development_type)
    client = C.ArcGISClient(retries=2, timeout=30.0, sleep=time.sleep)
    reg = default_registry(env=e, sa1_client=client)
    params = {"jurisdiction": "NSW", "lot_identifier": a.lotplan}
    if a.zone_code:
        params["zone_code"] = a.zone_code
    pid = uuid.uuid5(uuid.NAMESPACE_URL, "esc:" + a.lotplan)
    sa1 = reg.get(AgentCode.SA1_CADASTRE)
    r1 = sa1.run(sa1.input_model.model_validate({"project_id": str(pid), "project_jurisdiction": "NSW", "params": params}))
    lot = r1.lot
    if not lot.lga_name:
        lot.lga_name = 'Gunnedah'   # SA1 returned no LGA name; the lot was requested as Gunnedah
    print("SA1:", lot.lotplan, lot.lga_name, lot.zone_code, round(lot.area_m2_calculated), r1.flags)
    pts, lv_note = [], "no levels requested"
    if not a.no_levels:
        lv = fetch_levels(lot.boundary_wkt, lot.mga_srid)
        pts = [tuple(p) for p in lv.survey["points"]]
        lv_note = f"{lv.provenance['points']} points, {lv.provenance['source']}, {lv.provenance['copyright']}; " + "; ".join(lv.warnings)
        print("levels:", lv_note[:200])
    footprint, driveway, notes = None, None, []
    if a.rules_json:
        rr = RunRequest(project_id=pid, params={**params, "terrain": {}}, development_type=dev, project_title="esc")
        ctx = BuildContext(run_id=pid, project_id=pid, user_id=pid, request=rr, conn=None, export_dir=str(out))  # type: ignore[arg-type]
        ctx.upstream["SA1"] = json.loads(r1.model_dump_json())
        sa2 = RS._user_rules_sa2(json.loads(Path(a.rules_json).read_text()), a.zone_code or lot.zone_code, dev.rule_dwelling_type)
        ctx.upstream["SA2"] = json.loads(sa2.model_dump_json())
        env_agent = reg.get(AgentCode.SA3_GEOM_TIN)
        envo = env_agent.run(env_agent.input_model.model_validate(build_input("ENV", ctx)))
        driveway = envo.driveway
        footprint = preset_footprint(dev, envo.envelope.envelope_wkt)
        notes.append("Building footprint is the SA6 PRESET placed in the cited-rule envelope (placeholder size, not a design).")
        if footprint is None:
            footprint = placeholder_dwelling(lot, envo.envelope.envelope_wkt)
            notes.append("SA6 has no dwelling preset: a PLACEHOLDER 12 x 12 m (144 m2) footprint, aligned to the frontage and centred in the envelope, stands in for the architect's slab. Not a design.")
    base_path, base_ext, base_note = None, None, ""
    if not a.no_imagery:
        try:
            from shapely import wkt as W
            from app.imagery.figure import fit_extent
            lg = W.loads(lot.boundary_wkt)
            bbox = fit_extent([lg], 1.0, buffer_frac=0.6)
            res = NswImageryProvider().fetch(bbox, lot.mga_srid, (700, 700))
            base_path = str(out / "basemap.png")
            Path(base_path).write_bytes(res.data)
            base_ext = bbox
            base_note = f"NSW aerial imagery ({res.meta.source}); capture {res.meta.capture_date or 'date n/a'}; {res.meta.attribution}"
            print("basemap ok", res.meta.capture_date)
        except Exception as ex:  # noqa: BLE001
            print("basemap failed:", ex)
    inp = Sa10EscInput(lot=lot, development_type=dev, project_title=f"Proposed {dev.label} - {lot.lotplan}, {lot.lga_name}",
                       footprint_wkt=footprint, driveway=driveway, terrain_points=pts, output_dir=str(out), file_stem="escp",
                       basemap_image_path=base_path, basemap_extent=base_ext, basemap_note=base_note)
    res = Sa10Esc().run(inp)
    (out / "escp_result.json").write_text(res.model_dump_json(indent=1))
    (out / "run_notes.json").write_text(json.dumps({"levels": lv_note, "notes": notes}, indent=1))
    print(json.dumps({"files": res.files, "flow": res.flow.source, "quantities": res.quantities}, indent=1))
    print("unresolved:", [u["key"] for u in res.unresolved])
    return 0


if __name__ == "__main__":
    sys.exit(main())
