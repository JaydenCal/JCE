"""Stage 6 driveway engine: long section, checks against resolved requirements, batters and cut and fill, the endpoint, performance, auth.

The terrain is a real scene bundle written by the SA6 builder over a PLANAR synthetic surface, z = 100 + 0.06 y + 0.01 x (local metres), so every
level, grade and volume below has a hand value. The lot is the SA6 sample lot (18 m x 34 m, front boundary on y = 0), the assumed kerb line is 4 m
in front of it (y = -4) and runs from x = -30 to x = 48, so a crossover at x = 9 is at chainage 39 on the kerb line.
"""
from __future__ import annotations

import math
import time
import uuid

import numpy as np
import pytest
from fastapi.testclient import TestClient
from scipy.spatial import Delaunay

import site_support as H
from app.agents.sa3_driveway import profile as pf
from app.agents.sa3_terrain.tin import Tin
from app.api.app import create_app
from app.api.settings import Settings
from app.api.site_design import site_design_access, site_rules_dep
from app.design import terrain_source as TS
from app.design.driveway_engine import driveway_profile
from app.design.site_design import SiteObject
from app.design.site_rules import SiteRules, rules_for
from app.design.terrain_source import TriSurface, terrain_from_bundle

UNRES = SiteRules(None)
X0 = 9.0                                  # crossover x (local), mid frontage
Z = lambda y, x=X0: H.PLANAR(x, y)        # noqa: E731


@pytest.fixture(scope="module")
def terrain():
    return terrain_from_bundle(H.bundle())


def drive(end=None, width=3.0, pts=((X0, -4.0), (X0, 8.0), (X0, 14.0)), **kw):
    params = dict(kw)
    if width is not None:
        params["width_m"] = width
    if end is not None:
        params["end_level_rl"] = end
    return SiteObject.model_validate(H.driveway(pts, **params))


def check(r, id_):
    return next(c for c in r["checks"] if c["id"] == id_)


# ---- terrain source -----------------------------------------------------------------------------------------------------------------
def test_terrain_is_read_from_the_bundle_existing_and_context_parts(terrain):
    assert terrain.origin == (H.E0, H.N0) and terrain.status == H.STATUS.upper()
    assert terrain.kerb == ((H.E0 - 30.0, H.N0 - 4.0), (H.E0 + 48.0, H.N0 - 4.0))
    assert terrain.lot is not None and terrain.lot.bounds == (H.E0, H.N0, H.E0 + H.W, H.N0 + H.D)
    for x, y in ((9, 10), (3, 0), (17, 33), (9, -3), (9, -7.5)):
        assert terrain.surface.z_at(np.array([H.E0 + x]), np.array([H.N0 + y]))[0] == pytest.approx(H.PLANAR(x, y), abs=1e-6)
    assert np.isnan(terrain.surface.z_at(np.array([H.E0 + 9]), np.array([H.N0 + 200]))[0])           # outside the surface: no level


def test_design_surface_is_never_used_as_ground():
    b = H.bundle()
    b["parts"] = [p for p in b["parts"] if p["c"] not in ("existing", "context")]                    # leave only FS_surface etc.
    with pytest.raises(TS.TerrainUnavailable) as e:
        terrain_from_bundle(b)
    assert e.value.code == "TERRAIN_NOT_AVAILABLE" and "TERRAIN DATA NOT AVAILABLE" in e.value.message


def test_tri_surface_matches_the_sa3_tin_on_a_rough_surface():
    rng = np.random.default_rng(3)
    xs, ys = np.meshgrid(np.arange(0, 50.01, 2.5), np.arange(0, 50.01, 2.5))
    P = np.column_stack([xs.ravel() + rng.normal(0, 0.3, xs.size), ys.ravel() + rng.normal(0, 0.3, xs.size), np.zeros(xs.size)])
    P[:, 2] = 100 + 0.08 * P[:, 0] - 0.05 * P[:, 1] + np.sin(P[:, 0] / 7)
    tin = Tin(P)
    s = TriSurface(tin.vertices, tin.triangles)
    q = rng.uniform(-2, 52, (3000, 2))
    a, b = tin.z_at(q[:, 0], q[:, 1]), s.z_at(q[:, 0], q[:, 1])
    assert np.array_equal(np.isfinite(a), np.isfinite(b))
    m = np.isfinite(a)
    assert np.max(np.abs(a[m] - b[m])) < 1e-9


# ---- vectorised scraping margin = the scalar routine it replaced ---------------------------------------------------------------------
def _scraping_reference(z, s_lo, s_hi, tpl=pf.B85_TEMPLATE, step=0.05):
    """The scalar loops of sa3_driveway.profile.scraping_margin before it was vectorised (kept here as the reference)."""
    wb, fo, ro = tpl["wheelbase"], tpl["front_oh"], tpl["rear_oh"]
    worst = math.inf
    for flip in (False, True):
        zz = (lambda x: z(-x)) if flip else z
        lo, hi = (-s_hi, -s_lo) if flip else (s_lo, s_hi)
        for sr in np.arange(lo - fo, hi + ro, step):
            zr, zf = zz(sr), zz(sr + wb)
            for x in np.arange(sr - ro, sr + wb + fo + 1e-9, 0.1):
                c = tpl["clear_mid"] if sr <= x <= sr + wb else tpl["clear_oh"]
                worst = min(worst, zr + (zf - zr) * (x - sr) / wb + c - zz(x))
    return float(worst)


@pytest.mark.parametrize("seed", range(6))
def test_vectorised_scraping_margin_equals_the_scalar_reference(seed):
    rng = np.random.default_rng(seed)
    s = np.concatenate([[0.0], np.cumsum(rng.uniform(1.5, 6.0, rng.integers(2, 6)))])
    st = [(float(a), float(100 + rng.uniform(-1, 1)), "x") for a in s]
    f = pf._interp(st)
    ref = _scraping_reference(lambda x: float(f(float(x))), st[0][0], st[-1][0])
    assert pf.scraping_margin(f, st[0][0], st[-1][0]) == pytest.approx(ref, abs=1e-9)
    assert isinstance(f(2.0), float) and np.shape(f(np.array([1.0, 2.0]))) == (2,)           # still a float for a float, an array for an array


# ---- long section on planar terrain ------------------------------------------------------------------------------------------------
def test_long_section_matches_hand_values_on_planar_terrain(terrain):
    r = driveway_profile(drive(end=Z(14)), terrain, UNRES)
    assert r["status"] == "OK" and r["length_m"] == pytest.approx(18.0)
    g = r["geometry"]
    assert g["boundary_chainage_m"] == pytest.approx(4.0) and g["verge_m"] == pytest.approx(4.0) and g["gutter_band_m"] == pytest.approx(0.5)
    names = [s["name"] for s in r["stations"]]
    assert names == ["KERB LINE", "GUTTER BAND", "PROPERTY BOUNDARY", "DRIVEWAY END"]
    for s, y in zip(r["stations"], (-4.0, -3.5, 0.0, 14.0)):
        assert s["design_rl"] == pytest.approx(Z(y), abs=1e-3) and s["existing_rl"] == pytest.approx(Z(y), abs=1e-3)
    assert all(abs(s["grade_pct"] - 6.0) < 0.01 for s in r["segments"])
    sm = r["samples"]
    assert sm["chainage"][0] == 0 and sm["chainage"][-1] == pytest.approx(18.0) and len(sm["chainage"]) == len(sm["existing"]) == len(sm["design"]) == len(sm["grade_pct"])
    for t, e, d, gr in zip(sm["chainage"], sm["existing"], sm["design"], sm["grade_pct"]):
        assert e == pytest.approx(Z(-4 + t), abs=1e-3) and d == pytest.approx(e, abs=1e-3) and gr == pytest.approx(6.0, abs=0.01)
    assert check(r, "max_grade")["value"] == pytest.approx(6.0, abs=0.01)
    assert r["terrain"]["status"] == H.STATUS.upper()


def test_crossover_is_a_chainage_along_the_assumed_kerb_line(terrain):
    r = driveway_profile(drive(end=Z(14)), terrain, UNRES)
    assert r["crossover"]["available"] and r["crossover"]["chainage_m"] == pytest.approx(39.0) and r["crossover"]["offset_from_kerb_m"] == pytest.approx(0.0, abs=1e-6)
    assert r["crossover"]["kerb_length_m"] == pytest.approx(78.0)
    off = driveway_profile(drive(end=Z(14), pts=((X0, -3.0), (X0, 14.0))), terrain, UNRES)
    assert any("OFF THE ASSUMED KERB LINE" in n for n in off["notes"]) and off["crossover"]["offset_from_kerb_m"] == pytest.approx(1.0)


def test_grade_check_fails_against_an_lga_rule_and_lists_the_failing_chainages(terrain):
    r = driveway_profile(drive(end=Z(14)), terrain, H.rules(H.req("driveway.max_grade_pct", 5.0, "%")))
    c = check(r, "max_grade")
    assert (c["status"], c["requirement_key"], c["basis"], c["limit"]) == ("FAIL", "driveway.max_grade_pct", "LGA RULE", 5.0)
    assert "Test Engineering Standard" in c["ref"]
    assert all(s["failing"] for s in r["segments"])
    f = r["failing"][0]
    assert f["requirement_key"] == "driveway.max_grade_pct" and f["chainage_from_m"] == pytest.approx(0.0) and f["chainage_to_m"] == pytest.approx(18.0)
    assert "driveway.max_grade_pct 5 %" in f["message"] and "LGA RULE" in f["message"]
    ok = driveway_profile(drive(end=Z(14)), terrain, H.rules(H.req("driveway.max_grade_pct", 8.0, "%")))
    assert check(ok, "max_grade")["status"] == "PASS" and ok["failing"] == []


def test_a_state_wide_rule_is_labelled_a_state_rule(terrain):
    r = driveway_profile(drive(end=Z(14)), terrain, H.rules(H.req("driveway.max_grade_pct", 8.0, "%", lga=None)))
    assert check(r, "max_grade")["basis"] == "STATE RULE"


def test_a_grade_break_is_a_transition_checked_against_the_resolved_change_of_grade(terrain):
    end = 100.0                                                       # boundary level 100.09, so 4 m at 6 percent then (100 - 100.09) / 14 = -0.64 percent
    r = driveway_profile(drive(end=end), terrain, H.rules(H.req("driveway.max_grade_change_pct", 5.0, "%"), H.req("driveway.max_grade_pct", 8.0, "%")))
    b = next(s for s in r["stations"] if s["name"] == "PROPERTY BOUNDARY")
    assert b["kind"] == "SUMMIT" and b["change_pct"] == pytest.approx(6.0 + 0.09 / 14 * 100, abs=0.01) and b["transition"] == "TRANSITION REQUIRED"
    c = check(r, "change_of_grade@PROPERTY BOUNDARY")
    assert (c["status"], c["requirement_key"], c["basis"], c["limit"], c["chainage_from_m"]) == ("FAIL", "driveway.max_grade_change_pct", "LGA RULE", 5.0, 4.0)
    assert any(f["id"] == "change_of_grade@PROPERTY BOUNDARY" and f["chainage_from_m"] == 4.0 for f in r["failing"])
    flags = r["samples"]["transition"]
    assert flags[r["samples"]["chainage"].index(4.0)] == "SUMMIT" and flags.count("SUMMIT") == 1
    easy = driveway_profile(drive(end=end), terrain, H.rules(H.req("driveway.max_grade_change_pct", 9.0, "%")))
    assert check(easy, "change_of_grade@PROPERTY BOUNDARY")["status"] == "PASS" and next(s for s in easy["stations"] if s["name"] == "PROPERTY BOUNDARY")["transition"] == ""
    sag = driveway_profile(drive(end=102.5), terrain, UNRES)
    assert next(s for s in sag["stations"] if s["name"] == "PROPERTY BOUNDARY")["kind"] == "SAG"


def test_without_a_requirement_every_limit_is_unresolved_and_nothing_is_defaulted(terrain):
    r = driveway_profile(drive(end=102.5), terrain, UNRES)
    keyed = [c for c in r["checks"] if c["requirement_key"] and not c["id"].startswith("batter")]
    assert {c["requirement_key"] for c in keyed} >= {"driveway.max_grade_pct", "driveway.max_grade_change_pct", "driveway.min_width_m", "driveway.max_width_m", "driveway.min_separation_m"}
    assert all(c["status"] == "NOT EVALUATED" and c["basis"] == "UNRESOLVED" and c["limit"] is None for c in keyed)
    assert r["failing"] == [] and not any(s["failing"] for s in r["segments"])
    assert next(s for s in r["stations"] if s["name"] == "PROPERTY BOUNDARY")["transition"] == "UNRESOLVED"
    assert r["rules"]["driveway.max_grade_pct"]["basis"] == "UNRESOLVED"
    b85 = check(r, "b85_scraping_clearance")
    assert b85["requirement_key"] is None and "NOT A COUNCIL REQUIREMENT" in b85["basis"]               # a screening template, labelled as such


def test_the_real_gunnedah_rules_resolve_width_and_leave_grade_unresolved(terrain):
    r = driveway_profile(drive(end=Z(14), width=2.0), terrain, rules_for("Gunnedah", "NSW"))
    assert check(r, "max_grade")["basis"] == "UNRESOLVED"
    w = check(r, "width_min")
    assert (w["status"], w["basis"], w["limit"], w["value"]) == ("FAIL", "LGA RULE", 3.0, 2.0)
    assert check(r, "width_max")["status"] == "PASS"
    assert r["rules"]["driveway.min_width_m"]["value"] == 3.0 and r["rules_for"].startswith("Gunnedah")


def test_width_is_never_defaulted(terrain):
    r = driveway_profile(drive(end=Z(14), width=None), terrain, H.rules(H.req("driveway.min_width_m", 3.0, "m")))
    assert r["width"]["value"] is None and r["width"]["basis"] == "UNRESOLVED"
    assert check(r, "width_min")["status"] == "NOT EVALUATED" and check(r, "width_min")["note"] == "WIDTH NOT SET"
    assert r["earthworks"] is None and any("WIDTH NOT SET" in n for n in r["notes"])


def test_no_end_level_means_no_design_line(terrain):
    r = driveway_profile(drive(), terrain, UNRES)
    assert r["status"] == "END LEVEL NOT SET" and r["samples"]["design"] is None and r["earthworks"] is None
    assert r["end_level"]["basis"] == "NOT SET" and check(r, "profile")["status"] == "NOT EVALUATED"
    assert all(e is not None for e in r["samples"]["existing"])                       # the existing ground is still drawn


def test_no_ground_under_the_driveway_is_data_not_available(terrain):
    r = driveway_profile(drive(end=100.0, pts=((X0, 50.0), (X0, 60.0))), terrain, UNRES)          # beyond the ground (y up to 42) but inside the 20 m margin of the terrain bounds
    assert r["status"].startswith("TERRAIN DATA NOT AVAILABLE") and r["stations"] == [] and r["earthworks"] is None
    assert all(e is None for e in r["samples"]["existing"])


# ---- batters, cut and fill ---------------------------------------------------------------------------------------------------------
def test_cut_and_fill_of_the_strip_on_planar_terrain(terrain):
    r = driveway_profile(drive(end=Z(14)), terrain, UNRES)                    # design = existing on the centreline, existing falls 1 percent across the strip
    ew = r["earthworks"]
    assert ew["batters_computed"] is False and any("BATTER SLOPE IS UNRESOLVED" in n for n in ew["notes"])
    hand = 18.0 * 0.01 * 1.5 ** 2 / 2                                        # each side: length x (1 percent x 1.5 m x 1.5 m / 2)
    assert ew["cut_m3"] == pytest.approx(hand, rel=0.03) and ew["fill_m3"] == pytest.approx(hand, rel=0.03)
    assert ew["label"] == "INDICATIVE 5 M DEM, LIDAR PENDING, NOT SURVEY" and ew["terrain_status"] == H.STATUS.upper()
    assert ew["batters"]["cut_wkt"] is None and ew["batters"]["fill_wkt"] is None
    assert {z["kind"] for z in ew["zones"]} == {"cut", "fill"}


def test_batters_come_from_the_user_or_the_rules_and_are_drawn_to_the_ground(terrain):
    o = drive(end=Z(14) + 0.6, batter_cut_h_per_v=2.0, batter_fill_h_per_v=3.0)                 # 0.6 m of fill at the end
    r = driveway_profile(o, terrain, UNRES)
    ew = r["earthworks"]
    assert ew["batters_computed"] and ew["batters"]["fill"]["basis"] == "USER" and ew["batters"]["fill"]["h_per_v"] == 3.0
    assert ew["batters"]["fill_wkt"] and ew["fill_m3"] > 0
    unchecked = [c for c in r["checks"] if c["id"] == "batter_fill"][0]
    assert unchecked["status"] == "NOT EVALUATED" and unchecked["requirement_key"] == "earthworks.batter.fill_max_slope"       # a user slope with no rule to check against
    ruled = H.rules(H.req("earthworks.batter.fill_max_slope", 4.0, "H:V"), H.req("earthworks.batter.cut_max_slope", 2.0, "H:V"))
    r2 = driveway_profile(o, terrain, ruled)
    f = [c for c in r2["checks"] if c["id"] == "batter_fill"][0]
    assert (f["status"], f["basis"], f["limit"], f["value"]) == ("FAIL", "LGA RULE", 4.0, 3.0)         # a 1 in 3 batter is steeper than the 1 in 4 maximum
    r3 = driveway_profile(drive(end=Z(14) + 0.6), terrain, ruled)                                       # no user slope: the rule values are used
    assert r3["earthworks"]["batters"]["fill"]["basis"] == "LGA RULE" and r3["earthworks"]["batters"]["fill"]["h_per_v"] == 4.0


def test_the_profile_detail_skips_the_earthworks(terrain):
    r = driveway_profile(drive(end=Z(14)), terrain, UNRES, detail="profile")
    assert r["earthworks"] is None and r["detail"] == "profile" and r["status"] == "OK"


# ---- the endpoint ------------------------------------------------------------------------------------------------------------------
@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.delenv("SCENE_BUNDLE_DIR", raising=False)
    TS.clear_cache()
    app = create_app(Settings(export_dir=str(tmp_path)), pool=object())
    app.dependency_overrides[site_design_access] = lambda: uuid.uuid4()
    app.dependency_overrides[site_rules_dep] = lambda: H.rules(H.req("driveway.max_grade_pct", 5.0, "%"))
    pid = uuid.uuid4()
    return TestClient(app), tmp_path, pid


def body(**kw):
    return {"driveway": H.driveway(((X0, -4.0), (X0, 14.0)), width_m=3.0, end_level_rl=Z(14), **kw), "detail": "full"}


def test_endpoint_returns_the_profile_for_the_projects_bundle(api):
    c, tmp, pid = api
    H.write_bundle(tmp, pid, H.bundle())
    r = c.post(f"/projects/{pid}/site-design/driveway-profile", json=body())
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    j = r.json()
    assert j["schema"] == "driveway_profile.v1" and j["status"] == "OK" and j["object_id"] == "drv1"
    assert j["checks"][0]["requirement_key"] == "driveway.max_grade_pct" and j["checks"][0]["status"] == "FAIL" and j["failing"]
    assert j["earthworks"]["label"].startswith("INDICATIVE") and set(j["samples"]) == {"chainage", "existing", "design", "grade_pct", "transition"}


def test_endpoint_errors(api):
    c, tmp, pid = api
    url = f"/projects/{pid}/site-design/driveway-profile"
    r = c.post(url, json=body())
    assert r.status_code == 404 and r.json()["code"] == "NO_BUNDLE" and "DATA NOT AVAILABLE" in r.json()["message"]
    b = H.bundle()
    b["parts"] = [p for p in b["parts"] if p["c"] not in ("existing", "context")]
    H.write_bundle(tmp, pid, b)
    r = c.post(url, json=body())
    assert r.status_code == 409 and r.json()["code"] == "TERRAIN_NOT_AVAILABLE"
    H.write_bundle(tmp, pid, H.bundle())
    tree = {"driveway": {"id": "t1", "type": "tree", "geometry": {"kind": "point", "p": [1, 2]}}}
    assert c.post(url, json=tree).status_code == 422
    assert c.post(url, json={"driveway": body()["driveway"], "detail": "everything"}).status_code == 422
    assert c.post(url, json={"driveway": body()["driveway"], "extra": 1}).status_code == 422


def test_endpoint_is_refused_without_a_user(tmp_path, monkeypatch):
    monkeypatch.delenv("SCENE_BUNDLE_DIR", raising=False)
    app = create_app(Settings(export_dir=str(tmp_path)), pool=object())
    t = TestClient(app)
    pid = uuid.uuid4()
    assert t.post(f"/projects/{pid}/site-design/driveway-profile", json=body()).status_code == 401
    assert t.post(f"/projects/{pid}/site-design/grading", json={"grading_area": {}}).status_code == 401


def test_terrain_is_parsed_once_per_bundle_file_and_reread_when_it_changes(api):
    c, tmp, pid = api
    p = H.write_bundle(tmp, pid, H.bundle())
    t1 = TS.load_terrain(p)
    assert TS.load_terrain(p) is t1
    time.sleep(0.01)
    H.write_bundle(tmp, pid, H.bundle(status="SURVEY (AS SUPPLIED)"))
    t2 = TS.load_terrain(p)
    assert t2 is not t1 and t2.status == "SURVEY (AS SUPPLIED)"
    assert len([k for k in TS._CACHE if k[0] == str(p)]) == 1


def test_profile_endpoint_is_fast_enough_to_drag_on_a_50_m_by_50_m_tin(api):
    c, tmp, pid = api
    b = H.bundle(step=1.0, extent=(-15.0, 35.0, -15.0, 35.0))                 # a 50 m x 50 m surface at 1 m posts: 5000 triangles, noisy enough to be a real TIN
    assert sum(len(p["v"]) // 9 for p in b["parts"] if p["c"] in ("existing", "context")) >= 4900
    H.write_bundle(tmp, pid, b)
    url = f"/projects/{pid}/site-design/driveway-profile"
    assert c.post(url, json=body()).status_code == 200                       # first call reads and indexes the bundle (cold); not part of the drag budget
    for detail in ("profile", "full"):
        times = []
        for k in range(9):
            req = body(); req["detail"] = detail
            req["driveway"]["geometry"]["pts"][1] = [H.E0 + X0 + 0.1 * k, H.N0 + 10.0]            # a drag: the control point moves a little each call
            t0 = time.perf_counter()
            assert c.post(url, json=req).status_code == 200
            times.append((time.perf_counter() - t0) * 1000)
        assert sorted(times)[len(times) // 2] < 150.0, (detail, times)           # the median round trip (request, engine, JSON) is under 150 ms
        assert max(times) < 400.0, (detail, times)
