from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import pytest
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents.sa6_site3d import Sa6Site3d, SceneBundle, SceneRequest, build_scene, dumps  # noqa: E402
from app.agents.sa6_site3d import geom as G  # noqa: E402
from app.agents.sa6_site3d import sample as S  # noqa: E402
from app.common.contracts import AgentCode, ServiceLine  # noqa: E402
from app.common.statement import AI_DRAFT_STATEMENT  # noqa: E402

FIX = Path(__file__).parent / "fixtures" / "sample_scene_bundle.json"


@pytest.fixture(scope="module")
def req():
    return S.sample_request()


@pytest.fixture(scope="module")
def bundle(req):
    return build_scene(req)


def soup(b, name):
    p = next(p for p in b.parts if p.n == name)
    return np.array(p.v).reshape(-1, 3, 3)


def test_agent_and_schema(req, bundle):
    a = Sa6Site3d()
    assert a.code == AgentCode.SA6_SITE3D and a.status == "unverified" and a.input_model is SceneRequest
    SceneBundle.model_validate_json(dumps(bundle))
    d = json.loads(dumps(bundle))
    assert {"info", "layers", "parts", "labels", "views", "summary", "notes", "walkable", "items"} <= d.keys()
    ids = {l["c"] for l in d["layers"]}
    assert {"surface", "contours", "buildings", "services", "walls", "boundary", "road"} <= ids
    for p in d["parts"]:
        assert p["c"] in ids or p["c"] == "cutfill"
        if "v" in p:
            assert len(p["v"]) % 9 == 0 and len(p["f"]) == len(p["v"]) // 3
        else:
            assert len(p["lines"]) % 6 == 0
    assert AI_DRAFT_STATEMENT not in d["notes"] and "statement" not in d["info"]      # owner decision 15/10/2026: no AI draft banner text in the bundle
    assert not any("Illustrative only" in n for n in d["notes"])
    assert {"iso-sw", "iso-ne", "iso-se", "plan", "s", "w", "frontage"} <= d["views"].keys()
    assert d["walkable"]["spawn"]["eye_height_m"] == 1.6 and d["walkable"]["colliders"] and d["walkable"]["floors"]


def test_surface_cutfill_attribute(bundle):
    p = next(p for p in bundle.parts if p.n == "FS_surface")
    assert len(p.cf) == len(p.v) // 3
    assert min(p.cf) < -0.5 and max(p.cf) < 1.0 or max(p.cf) >= 0   # pad cuts the high side of the slope
    cf = next(p for p in bundle.parts if p.n == "FS_cutfill")
    assert len(cf.vc) == len(cf.v)


def test_box_volume_and_roof_planes():
    fp = box(0, 0, 10, 6)
    walls = G.prism(fp, 0, 2.7)
    assert G.signed_volume(walls) == pytest.approx(10 * 6 * 2.7, rel=1e-9)
    assert G.area(G.prism(fp, 0, 2.7, caps=False)) == pytest.approx(32 * 2.7)
    pitch, eaves = 20.0, 0.5
    ae, be = 5.5, 3.5
    gable = G.roof(fp, 2.7, "gable", pitch, eaves)
    slope = 2 * (2 * ae) * be / math.cos(math.radians(pitch))
    ends = 2 * 0.5 * (2 * be) * (be * math.tan(math.radians(pitch)))
    assert G.area(gable) == pytest.approx(slope + ends, rel=1e-6)
    hip = G.roof(fp, 2.7, "hip", pitch, eaves)
    h = be * math.tan(math.radians(pitch))
    assert hip[..., 2].max() == pytest.approx(2.7 + h) and (hip[..., 2] >= 2.7 - 1e-9).all()
    sk = G.roof(fp, 2.7, "skillion", pitch, eaves)
    assert sk[..., 2].max() == pytest.approx(2.7 + 2 * be * math.tan(math.radians(pitch)))
    assert G.area(G.roof(fp, 2.7, "flat", 0, 0.5)) == pytest.approx(11 * 7, rel=1e-6)
    # roof planes face upward
    for r in (gable, hip):
        n = np.cross(r[:, 1] - r[:, 0], r[:, 2] - r[:, 0])
        assert (n[:, 2] >= -1e-9).all()


def test_wall_strip_volume():
    w = G.strip_extrude([(0, 0), (4, 0)], [0, 0], [1.2, 1.2], 0.3)
    assert G.signed_volume(w) == pytest.approx(4 * 0.3 * 1.2, rel=1e-6)


def test_local_coordinates_roundtrip(req, bundle):
    E0, N0, _ = bundle.info.origin
    assert (E0, N0) == (S.E0, S.N0)
    w = soup(bundle, "PW_House_Walls")
    house = box(S.E0 + 4.5, S.N0 + 12, S.E0 + 14, S.N0 + 22)
    abs_xy = w[..., :2].reshape(-1, 2) + [E0, N0]
    assert abs_xy[:, 0].min() == pytest.approx(house.bounds[0], abs=1e-3) and abs_xy[:, 1].max() == pytest.approx(house.bounds[3], abs=1e-3)
    assert w[..., 2].min() == pytest.approx(req.buildings[0].base_rl, abs=1e-3)
    assert np.abs(np.array(next(p for p in bundle.parts if p.n == "FS_surface").v)).max() < 1000   # local, not MGA
    # three decimal places
    assert all(round(v, 3) == v for v in next(p for p in bundle.parts if p.n == "FS_surface").v[:300])


def test_services_below_ground(req, bundle):
    ground = lambda x, y: 100.0 + 0.06 * y + 0.01 * x
    for i, s in enumerate(req.services):
        if s.depth_m is None:
            continue                       # no depth supplied: drawn on the surface, see test_no_invented_service_depths
        p = next(p for p in bundle.parts if p.n.endswith(f"{s.service}_{i}"))
        t = np.array(p.v).reshape(-1, 3)
        assert (t[:, 2] < ground(t[:, 0], t[:, 1])).all()
    p = next(p for p in bundle.parts if p.n == "Existing_sewer_1")
    t = np.array(p.v).reshape(-1, 3)
    assert (ground(t[:, 0], t[:, 1]) - t[:, 2]).max() < 1.91 and (ground(t[:, 0], t[:, 1]) - t[:, 2]).min() > 1.79   # cover 1.8 m to top of pipe
    assert any(p.c == "buffers" and p.a < 0.3 for p in bundle.parts)
    assert not any("assumed" in l.t for l in bundle.labels if l.c == "lab_svc")
    assert any("DEPTH NOT AVAILABLE" in l.t for l in bundle.labels)


def test_decimation_cap():
    rng = np.random.default_rng(1)
    g = np.arange(0, 100, 1.0)
    X, Y = np.meshgrid(g, g)
    V = np.c_[X.ravel(), Y.ravel(), np.sin(X.ravel() / 9)]
    n = len(g)
    F = np.array([t for j in range(n - 1) for i in range(n - 1) for t in ((j * n + i, j * n + i + 1, (j + 1) * n + i), (j * n + i + 1, (j + 1) * n + i + 1, (j + 1) * n + i))])
    Vd, Fd, _ = G.decimate(V, F, 1500)
    assert 0 < len(Fd) <= 1500 < len(F)
    assert abs(Vd[:, 2]).max() <= 1.0
    # end-to-end: a small total cap is honoured by the terrain meshes
    r = S.sample_request()
    r.options.max_total_triangles = 1500
    b = build_scene(r)
    terr = sum(len(p.v) // 9 for p in b.parts if p.n in ("FS_surface", "EG_survey_TIN", "Existing_ground_context"))
    assert terr <= 1500


def test_items_and_warnings(bundle):
    assert len(bundle.items) == 2
    assert bundle.items[0].proxy == "box" and bundle.items[0].t[2] > 90
    assert any("buffer" in w for w in bundle.items[1].warnings)


def test_deterministic(req):
    assert dumps(build_scene(req)) == dumps(build_scene(req))


def test_sample_fixture_generated_and_small():
    out = S.main([str(FIX)])
    assert out.exists() and out.stat().st_size < 1_000_000
    SceneBundle.model_validate_json(out.read_text())


def test_banner_removed_from_bundle(bundle):
    """Stage 3 owner decision A: the builder no longer sets info.statement or adds the draft text to the notes; info.status stays unverified."""
    assert bundle.info.statement is None and bundle.info.status == "unverified"
    for b in (json.loads(dumps(bundle)), json.loads(dumps(build_scene(_site_only_request())))):
        assert "statement" not in b["info"] and b["info"]["status"] == "unverified"
        assert not any("AI GENERATED DRAFT" in n for n in b["notes"])
    # a bundle written before stage 3 (with the field) still validates, and its text is not forced
    old = json.loads(dumps(bundle)); old["info"]["statement"] = AI_DRAFT_STATEMENT
    assert SceneBundle.model_validate(old).info.statement == AI_DRAFT_STATEMENT
    assert AI_DRAFT_STATEMENT == AI_DRAFT_STATEMENT.upper() and "," in AI_DRAFT_STATEMENT and "\u2014" not in AI_DRAFT_STATEMENT     # shared constant (sa5) untouched


def test_plan_set_uses_shared_statement():
    from app.agents.sa5_cad_dxf.planset import codes
    assert codes.AI_STATEMENT is AI_DRAFT_STATEMENT


def _site_only_request(**kw):
    base = S.sample_request()
    keep = {k: getattr(base, k) for k in ("project_title", "lot", "origin")}
    return SceneRequest(**keep, **kw)


def test_site_only_build_has_no_building_ffl_or_development_type():
    r = _site_only_request()
    assert r.buildings == [] and r.ffl is None and r.development_type is None
    b = build_scene(r)
    assert b.info.FFL is None
    keys = [k for k, _ in b.summary]
    assert "Development type" not in keys and "FFL (AHD)" not in keys and "Buildings" not in keys
    assert not any(p.c == "buildings" for p in b.parts)
    # no terrain: flat ground at 0 and an explicit not-available flag, never the FFL or a pad level
    assert ("Terrain", "DATA NOT AVAILABLE (ground drawn flat at RL 0.00, placeholder only)") in b.summary
    assert any("TERRAIN DATA NOT AVAILABLE" in n for n in b.notes) and any("TERRAIN DATA NOT AVAILABLE" in l.t for l in b.labels)
    bd = next(p for p in b.parts if p.n == "Property_boundary")
    assert {round(z, 3) for z in bd.lines[2::3]} == {0.05}
    assert b.walkable.spawn.pos[2] == 0.0
    assert not any("AHD" in n and "Heights are AHD" in n for n in b.notes)


def test_ffl_and_pad_level_are_not_ground_when_no_terrain():
    base = S.sample_request()
    r = _site_only_request(ffl=105.0, cut_fill=base.cut_fill)
    b = build_scene(r)
    bd = next(p for p in b.parts if p.n == "Property_boundary")
    assert {round(z, 3) for z in bd.lines[2::3]} == {0.05}
    assert "FFL (AHD)" not in dict(b.summary)             # no ground levels exist, so no AHD claim is made
    assert dict(b.summary)["FFL"].startswith("105.00 (as supplied") and "TERRAIN DATA NOT AVAILABLE" in dict(b.summary)["FFL"]


def _no_terrain_site(**kw):
    base = S.sample_request()
    return _site_only_request(buildings=base.buildings, driveway=base.driveway, pits=base.pits, ffl=base.ffl, **kw)


def test_buildings_sit_on_placeholder_ground_when_no_terrain():
    b = build_scene(_no_terrain_site())
    ffl = S.sample_request().buildings[0].base_rl
    walls = next(p for p in b.parts if p.n == "PW_House_Walls")
    zs = np.array(walls.v).reshape(-1, 3)[:, 2]
    assert zs.min() == 0.0 and zs.max() < 5.0                               # on the flat ground at RL 0, not floating at the FFL RL
    lab = next(l.t for l in b.labels if l.t.startswith("House"))
    assert f"FFL {ffl:.2f} NOT SHOWN AGAINST GROUND, TERRAIN DATA NOT AVAILABLE" in lab
    assert b.walkable.floors[0].level == 0.0 and all(l.kind != "stairs" for l in b.walkable.links)
    assert "FFL (AHD)" not in dict(b.summary) and "NOT SHOWN AGAINST GROUND" in dict(b.summary)["FFL"]
    assert b.info.FFL == ffl                                                # the supplied value is still reported, never used as ground


def test_driveway_grade_not_available_without_terrain_or_levels():
    b = build_scene(_no_terrain_site())
    lab = next(l.t for l in b.labels if l.t.startswith("Driveway"))
    assert "GRADE DATA NOT AVAILABLE" in lab and "0.0%" not in lab
    assert "GRADE DATA NOT AVAILABLE" in dict(b.summary)["Driveway"] and "0.0%" not in dict(b.summary)["Driveway"]
    lv = build_scene(_no_terrain_site(driveway_levels=(100.0, 101.2)))       # supplied driveway levels give a real grade
    assert "GRADE DATA NOT AVAILABLE" not in next(l.t for l in lv.labels if l.t.startswith("Driveway"))
    assert "avg grade" in dict(lv.summary)["Driveway"]
    with_terrain = build_scene(S.sample_request())
    assert "GRADE DATA NOT AVAILABLE" not in dict(with_terrain.summary)["Driveway"]


def test_pit_depth_is_never_invented():
    from app.agents.sa6_site3d.models import PitIn
    assert PitIn(xy=(0.0, 0.0)).depth_m is None
    assert next(p for p in S.sample_request().pits).depth_m == 0.9           # sample data, given explicitly
    r = S.sample_request()
    b = build_scene(r.model_copy(update={"pits": [PitIn(xy=(S.E0 + 9, S.N0 + 1), label="Pit P2"), PitIn(xy=(S.E0 + 9, S.N0 + 3), label="Pit P3", depth_m=1.1)]}))
    labs = {l.t.split(" (")[0]: l.t for l in b.labels if l.c == "lab_svc" and l.t.startswith("Pit")}
    assert labs["Pit P2"] == "Pit P2 (DEPTH NOT AVAILABLE)" and "invert 1.10 m below ground" in labs["Pit P3"]
    p2 = np.array(next(p for p in b.parts if p.n == "Pit_0").v).reshape(-1, 3)
    p3 = np.array(next(p for p in b.parts if p.n == "Pit_1").v).reshape(-1, 3)
    assert p2[:, 2].min() > p3[:, 2].min() + 0.5                            # unknown depth: a lid on the surface, not a buried box


def test_survey_points_build_the_existing_ground():
    pts = [(S.E0 + x, S.N0 + y, 100.0 + 0.05 * y) for x in (-2.0, 20.0) for y in (-2.0, 12.0, 36.0)]
    b = build_scene(_site_only_request(survey_points=pts))
    assert not any("TERRAIN DATA NOT AVAILABLE" in n for n in b.notes) and any("Delaunay" in n for n in b.notes)
    bd = next(p for p in b.parts if p.n == "Property_boundary")
    assert max(bd.lines[2::3]) > 100.0                                       # ground follows the survey points
    few = build_scene(_site_only_request(survey_points=pts[:2]))
    assert any("fewer than three" in n for n in few.notes) and any("TERRAIN DATA NOT AVAILABLE" in n for n in few.notes)


def test_road_label_states_assumed_width():
    b = build_scene(S.sample_request())
    road = [l.t for l in b.labels if l.t.startswith("Road frontage")]
    assert road and all("ASSUMED ROAD WIDTH 8 m" in t for t in road)


def test_no_invented_service_depths(req):
    assert not hasattr(req.options, "default_depth_m")
    nodepth = ServiceLine(service="water", label="DN100 water", geometry_wkt=f"LINESTRING ({S.E0 + 5} {S.N0 - 2}, {S.E0 + 5} {S.N0 + 14})", diameter_mm=100, depth_m=None)
    known = nodepth.model_copy(update={"label": "DN100 water known", "depth_m": 0.75, "geometry_wkt": f"LINESTRING ({S.E0 + 7} {S.N0 - 2}, {S.E0 + 7} {S.N0 + 14})"})
    b = build_scene(req.model_copy(update={"services": [nodepth, known], "pits": []}))
    ground = lambda x, y: 100.0 + 0.06 * y + 0.01 * x
    t0 = np.array(next(p for p in b.parts if p.n == "Existing_water_0").v).reshape(-1, 3)
    t1 = np.array(next(p for p in b.parts if p.n == "Existing_water_1").v).reshape(-1, 3)
    assert (t0[:, 2] >= ground(t0[:, 0], t0[:, 1]) - 0.01).all()          # on the surface, not buried at an assumed depth
    assert (t1[:, 2] < ground(t1[:, 0], t1[:, 1])).all()                  # supplied depth still buried
    lab = {l.t.split(":")[0]: l.t for l in b.labels if l.c == "lab_svc"}
    assert lab["DN100 water"].endswith("DEPTH NOT AVAILABLE") and "cover 0.75 m" in lab["DN100 water known"]
    assert not any("assum" in t.lower() for t in lab.values())
    svc = dict(b.summary)["Services"]
    assert "min cover 0.75 m" in svc and "DEPTH NOT AVAILABLE for 1" in svc
    only_none = build_scene(req.model_copy(update={"services": [nodepth], "pits": []}))
    assert dict(only_none.summary)["Services"].startswith("1 lines, min cover DATA NOT AVAILABLE")
