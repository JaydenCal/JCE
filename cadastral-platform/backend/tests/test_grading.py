"""Stage 6 grading areas: design level or plane, batters, INDICATIVE cut and fill volumes against analytic values, the endpoint, auth.

Terrain: real scene bundles (SA6 builder) over synthetic surfaces. Local coordinates are metres from the sample lot origin (see site_support).
"""
from __future__ import annotations

import math
import uuid

import numpy as np
import pytest
from fastapi.testclient import TestClient
from shapely.geometry import Polygon

import site_support as H
from app.agents.sa3_terrain.cutfill import pad_surface
from app.api.app import create_app
from app.api.settings import Settings
from app.api.site_design import site_design_access, site_rules_dep
from app.design import grading_engine as ge
from app.design import terrain_source as TS
from app.design.grading_engine import grading
from app.design.site_design import SiteObject
from app.design.site_rules import SiteRules, hv_from
from app.design.terrain_source import terrain_from_bundle

UNRES = SiteRules(None)
SLOPE = lambda x, y: 100.0 + 0.1 * x                      # noqa: E731  (10 percent rising to the east)
FLAT = lambda x, y: 100.0 + 0 * x                         # noqa: E731


def area(x0, y0, x1, y1, **params) -> SiteObject:
    ring = [[H.E0 + x0, H.N0 + y0], [H.E0 + x1, H.N0 + y0], [H.E0 + x1, H.N0 + y1], [H.E0 + x0, H.N0 + y1]]
    return SiteObject.model_validate({"id": "g1", "type": "grading_area", "geometry": {"kind": "polygon", "ring": ring},
                                      "params": {k: v if isinstance(v, dict) else H.user(v) for k, v in params.items()}})


@pytest.fixture(scope="module")
def slope():
    return terrain_from_bundle(H.bundle(z=SLOPE, extent=(-10.0, 28.0, -10.0, 44.0)))


@pytest.fixture(scope="module")
def flat():
    return terrain_from_bundle(H.bundle(z=FLAT, extent=(-10.0, 28.0, -10.0, 44.0)))


def test_cut_and_fill_of_a_level_platform_on_a_slope_match_the_analytic_values(slope):
    # existing z = 100 + 0.1 x. A 10 m x 10 m platform from x = 4 to 14 at the level of the middle (x = 9 gives 100.9): depth 0.1 (x - 9) either side.
    r = grading(area(4, 10, 14, 20, target_level_m=100.9), slope, UNRES)
    ew = r["earthworks"]
    hand = 10.0 * 0.1 * 5.0 ** 2 / 2                                  # width x slope x run^2 / 2 = 12.5 m3 each way
    assert r["status"] == "OK" and ew["batters_computed"] is False
    assert ew["cut_m3"] == pytest.approx(hand, rel=0.01) and ew["fill_m3"] == pytest.approx(hand, rel=0.01)
    assert ew["net_m3"] == pytest.approx(0.0, abs=0.15)
    assert ew["cut_area_m2"] == pytest.approx(50.0, rel=0.02) and ew["fill_area_m2"] == pytest.approx(50.0, rel=0.02)
    assert r["design"] == {"mode": "level", "target_level_m": 100.9, "pivot_level_m": None, "pivot_basis": None}


def test_a_platform_above_flat_ground_with_batters_matches_the_analytic_volume(flat):
    # 10 x 10 m platform 1 m above flat ground, fill batter 3 H per V (rounded corners, the SA3 pad_surface convention):
    # platform 100 + four side wedges 10 x (1 x 3 / 2) + four quarter cones pi x 3^2 x 1 / 3 / 4 = 169.42 m3 of fill, no cut
    r = grading(area(4, 10, 14, 20, target_level_m=101.0, batter_cut_h_per_v=2.0, batter_fill_h_per_v=3.0), flat, UNRES)
    ew = r["earthworks"]
    hand = 100.0 + 4 * 10 * 1.5 + math.pi * 9 / 3
    assert ew["batters_computed"] and ew["fill_m3"] == pytest.approx(hand, rel=0.01) and ew["cut_m3"] == pytest.approx(0.0, abs=0.01)
    assert ew["batters"]["fill"]["h_per_v"] == 3.0 and ew["batters"]["fill"]["basis"] == "USER"
    from shapely import wkt
    b = wkt.loads(ew["batters"]["fill_wkt"])
    assert b.area == pytest.approx(4 * 10 * 3 + math.pi * 9, rel=0.05)            # the batter footprint reaches 3 m out (1 m of fill at 3 H per V)
    assert b.bounds[0] == pytest.approx(H.E0 + 4 - 3.0, abs=0.1) and b.bounds[2] == pytest.approx(H.E0 + 14 + 3.0, abs=0.1)


def test_a_cut_into_flat_ground_uses_the_cut_batter(flat):
    r = grading(area(4, 10, 14, 20, target_level_m=99.0, batter_cut_h_per_v=2.0, batter_fill_h_per_v=3.0), flat, UNRES)
    ew = r["earthworks"]
    hand = 100.0 + 4 * 10 * (1 * 2 / 2) + math.pi * 4 / 3
    assert ew["fill_m3"] == pytest.approx(0.0, abs=0.01) and ew["cut_m3"] == pytest.approx(hand, rel=0.01)
    assert ew["batters"]["cut_wkt"] and ew["batters"]["fill_wkt"] is None


def test_graded_surface_with_a_constant_level_is_the_sa3_pad_surface(slope):
    fp = Polygon([(H.E0 + 4, H.N0 + 10), (H.E0 + 14, H.N0 + 10), (H.E0 + 14, H.N0 + 20), (H.E0 + 4, H.N0 + 20)])
    win = slope.surface.window(fp, 12.0)
    ours = ge.graded_surface(win, fp, lambda x, y: np.full(np.shape(x), 100.9), 2.0, 3.0)
    theirs = pad_surface(win, fp, 100.9, 2.0, 3.0)
    rng = np.random.default_rng(4)
    q = np.column_stack([rng.uniform(H.E0 - 6, H.E0 + 24, 400), rng.uniform(H.N0 + 3, H.N0 + 27, 400)])
    a, b = ours(q[:, 0], q[:, 1]), theirs(q[:, 0], q[:, 1])
    m = np.isfinite(a) & np.isfinite(b)
    assert m.sum() > 300 and np.max(np.abs(a[m] - b[m])) < 1e-9


def test_a_target_grade_with_a_fall_direction_is_a_plane_through_the_ground_at_the_centroid(slope):
    # fall direction 270 (towards the west, against the 10 percent rise): a 10 percent fall west is the existing ground's plane flipped
    r = grading(area(4, 10, 14, 20, target_grade_pct=10.0, fall_direction_deg=90.0), slope, UNRES)           # falls to the EAST, the ground rises east: depth = 0.2 (x - 9)
    d = r["design"]
    assert d["mode"] == "grade" and d["pivot_level_m"] == pytest.approx(100.9, abs=1e-3) and d["pivot_basis"] == "EXISTING GROUND AT THE CENTROID OF THE AREA"
    hand = 10.0 * 0.2 * 5.0 ** 2 / 2
    assert r["earthworks"]["cut_m3"] == pytest.approx(hand, rel=0.01) and r["earthworks"]["fill_m3"] == pytest.approx(hand, rel=0.01)
    along = grading(area(4, 10, 14, 20, target_grade_pct=10.0, fall_direction_deg=270.0), slope, UNRES)      # falls west, same as the ground: the plane IS the ground
    assert along["earthworks"]["cut_m3"] == pytest.approx(0.0, abs=0.05) and along["earthworks"]["fill_m3"] == pytest.approx(0.0, abs=0.05)
    pivot = grading(area(4, 10, 14, 20, target_grade_pct=10.0, fall_direction_deg=270.0, pivot_level_m=101.9), slope, UNRES)
    assert pivot["design"]["pivot_basis"] == "ENTERED BY THE USER" and pivot["earthworks"]["fill_m3"] == pytest.approx(100.0, rel=0.02)      # 1 m above, 100 m2


def test_design_patch_lists_the_corner_levels(slope):
    r = grading(area(4, 10, 14, 20, target_grade_pct=10.0, fall_direction_deg=270.0), slope, UNRES)
    assert [round(p[2], 2) for p in r["design_patch"]] == [100.4, 101.4, 101.4, 100.4]            # x = 4 and x = 14 at 10 percent through (9, 100.9)


def test_nothing_is_assumed_when_the_target_or_the_batter_is_missing(slope):
    r = grading(area(4, 10, 14, 20), slope, UNRES)
    assert r["status"].startswith("TARGET LEVEL NOT SET") and r["earthworks"] is None
    only_grade = grading(area(4, 10, 14, 20, target_grade_pct=5.0), slope, UNRES)
    assert only_grade["status"].startswith("TARGET LEVEL NOT SET") and only_grade["earthworks"] is None            # a grade needs its fall direction
    plat = grading(area(4, 10, 14, 20, target_level_m=100.9), slope, UNRES)
    assert plat["earthworks"]["batters_computed"] is False and plat["earthworks"]["batters"]["fill_wkt"] is None
    assert any("BATTER SLOPE IS UNRESOLVED" in n for n in plat["notes"])
    cks = {c["id"]: c for c in plat["checks"]}
    assert cks["batter_cut"]["status"] == "NOT EVALUATED" and cks["batter_cut"]["basis"] == "UNRESOLVED" and cks["batter_fill"]["requirement_key"] == "earthworks.batter.fill_max_slope"


def test_batter_slope_from_the_rules_and_their_units(slope):
    ruled = H.rules(H.req("earthworks.batter.cut_max_slope", 50.0, "%"), H.req("earthworks.batter.fill_max_slope", 3.0, "H:V"))
    r = grading(area(4, 10, 14, 20, target_level_m=101.5), slope, ruled)
    b = r["earthworks"]["batters"]
    assert b["cut"]["h_per_v"] == pytest.approx(2.0) and b["cut"]["basis"] == "LGA RULE"          # 50 percent is 2 H per V
    assert b["fill"]["h_per_v"] == 3.0 and r["earthworks"]["batters_computed"]
    assert hv_from(2.0, "H:V") == 2.0 and hv_from(25.0, "%") == pytest.approx(4.0) and hv_from(45.0, "deg") == pytest.approx(1.0) and hv_from(5.0, "m") is None
    general = H.rules(H.req("earthworks.batter.max_slope", 2.5, "H:V"))
    assert grading(area(4, 10, 14, 20, target_level_m=101.5), slope, general)["earthworks"]["batters"]["cut"]["h_per_v"] == 2.5       # the general key is the fallback


def test_a_user_batter_steeper_than_the_rule_fails(slope):
    ruled = H.rules(H.req("earthworks.batter.max_slope", 2.5, "H:V"))
    r = grading(area(4, 10, 14, 20, target_level_m=101.5, batter_cut_h_per_v=2.0, batter_fill_h_per_v=3.0), slope, ruled)
    cks = {c["id"]: c for c in r["checks"]}
    assert (cks["batter_cut"]["status"], cks["batter_cut"]["limit"], cks["batter_cut"]["value"]) == ("FAIL", 2.5, 2.0)
    assert cks["batter_fill"]["status"] == "PASS"


def test_volumes_are_indicative_with_the_terrain_status(slope):
    r = grading(area(4, 10, 14, 20, target_level_m=100.9), slope, UNRES)
    assert r["label"] == "INDICATIVE 5 M DEM, LIDAR PENDING, NOT SURVEY" and r["earthworks"]["label"] == r["label"]
    assert r["terrain"]["status"] == H.STATUS.upper()
    other = terrain_from_bundle(H.bundle(z=SLOPE, status="SURVEY (AS SUPPLIED)", extent=(-10.0, 28.0, -10.0, 44.0)))
    assert grading(area(4, 10, 14, 20, target_level_m=100.9), other, UNRES)["label"] == "INDICATIVE, SURVEY (AS SUPPLIED)"
    unstated = terrain_from_bundle(H.bundle(z=SLOPE, status=None, extent=(-10.0, 28.0, -10.0, 44.0)))
    assert grading(area(4, 10, 14, 20, target_level_m=100.9), unstated, UNRES)["label"] == "INDICATIVE, TERRAIN SOURCE NOT STATED"
    assert r["earthworks"]["uncertainty_m3"] is None and "NOT STATED AS A NUMBER" in r["earthworks"]["uncertainty_note"]


def test_no_ground_under_the_area_is_data_not_available(slope):
    r = grading(area(32, 10, 42, 20, target_level_m=100.0), slope, UNRES)                  # beyond the ground (x up to 28) but inside the 20 m margin of the terrain bounds
    assert r["status"].startswith("TERRAIN DATA NOT AVAILABLE") and r["earthworks"] is None
    e, n = H.E0, H.N0
    bad = SiteObject.model_validate({"id": "g2", "type": "grading_area", "geometry": {"kind": "polygon", "ring": [[e, n], [e + 10, n + 10], [e + 10, n], [e, n + 10]]},
                                     "params": {"target_level_m": H.user(100.0)}})
    assert grading(bad, slope, UNRES)["status"].startswith("INVALID GEOMETRY")


# ---- the endpoint ------------------------------------------------------------------------------------------------------------------
@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.delenv("SCENE_BUNDLE_DIR", raising=False)
    TS.clear_cache()
    app = create_app(Settings(export_dir=str(tmp_path)), pool=object())
    app.dependency_overrides[site_design_access] = lambda: uuid.uuid4()
    app.dependency_overrides[site_rules_dep] = lambda: UNRES
    return TestClient(app), tmp_path, uuid.uuid4()


def obj_json(o: SiteObject) -> dict:
    return o.model_dump(mode="json", exclude_none=True)


def test_grading_endpoint(api):
    c, tmp, pid = api
    url = f"/projects/{pid}/site-design/grading"
    o = area(4, 10, 14, 20, target_level_m=100.9)
    assert c.post(url, json={"grading_area": obj_json(o)}).status_code == 404
    H.write_bundle(tmp, pid, H.bundle(z=SLOPE, extent=(-10.0, 28.0, -10.0, 44.0)))
    r = c.post(url, json={"grading_area": obj_json(o)})
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    j = r.json()
    assert j["schema"] == "grading.v1" and j["earthworks"]["cut_m3"] == pytest.approx(12.5, rel=0.02) and j["label"].startswith("INDICATIVE")
    assert c.post(url, json={"grading_area": {"id": "t", "type": "tree", "geometry": {"kind": "point", "p": [1, 2]}}}).status_code == 422
    assert c.post(url, json={}).status_code == 422


def test_grading_endpoint_without_a_user_is_401(tmp_path):
    t = TestClient(create_app(Settings(export_dir=str(tmp_path)), pool=object()))
    assert t.post(f"/projects/{uuid.uuid4()}/site-design/grading", json={"grading_area": {}}).status_code == 401
