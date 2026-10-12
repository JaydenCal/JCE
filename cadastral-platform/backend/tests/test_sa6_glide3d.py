from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import pytest
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents.sa6_glide3d import Sa6Glide3d, SceneBundle, SceneRequest, build_scene, dumps  # noqa: E402
from app.agents.sa6_glide3d import geom as G  # noqa: E402
from app.agents.sa6_glide3d import sample as S  # noqa: E402
from app.common.contracts import AgentCode  # noqa: E402

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
    a = Sa6Glide3d()
    assert a.code == AgentCode.SA6_GLIDE3D and a.status == "unverified" and a.input_model is SceneRequest
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
    assert any("Illustrative only" in n for n in d["notes"])
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
        p = next(p for p in bundle.parts if p.n.endswith(f"{s.service}_{i}"))
        t = np.array(p.v).reshape(-1, 3)
        assert (t[:, 2] < ground(t[:, 0], t[:, 1])).all()
    p = next(p for p in bundle.parts if p.n == "Existing_sewer_1")
    t = np.array(p.v).reshape(-1, 3)
    assert (ground(t[:, 0], t[:, 1]) - t[:, 2]).max() < 1.91 and (ground(t[:, 0], t[:, 1]) - t[:, 2]).min() > 1.79   # cover 1.8 m to top of pipe
    assert any(p.c == "buffers" and p.a < 0.3 for p in bundle.parts)
    assert any("assumed" in l.t for l in bundle.labels)


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
