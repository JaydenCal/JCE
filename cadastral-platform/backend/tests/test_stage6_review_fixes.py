"""Stage 6 review fixes: input caps, the building linked end level resolved on the server, the gutter band without a verge, the standard built from SiteRules,
batters clipped at the kerb line and the building footprint, the end level kept when stations merge, single flight terrain parsing, the engine
concurrency limits and the requirement cache that follows the knowledge files. (The crossover splay is in test_driveway_export.py.)

Each test fails on the code before the fixes. Terrain: real scene bundles (SA6 builder) over synthetic surfaces, see site_support.
"""
from __future__ import annotations

import asyncio
import json
import threading
import time
import uuid

import numpy as np
import pytest
from fastapi.testclient import TestClient
from shapely import wkt
from shapely.geometry import Polygon

import site_support as H
from app.agents.sa3_driveway import profile as pf
from app.api import site_design as API
from app.api.app import create_app
from app.api.settings import Settings
from app.api.site_design import site_design_access, site_rules_dep
from app.design import terrain_source as TS
from app.design.driveway_engine import driveway_profile
from app.design.driveway_export import ExportError, export_driveway
from app.design.site_design import SiteDesign, SiteObject
from app.design.site_rules import SiteRules
from app.design.terrain_source import terrain_from_bundle

UNRES = SiteRules(None)
X0 = 9.0
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


def building_json(bid="bld1", ffl: float | None = 102.0, ring=((5, 13), (13, 13), (13, 20), (5, 20))) -> dict:
    r = [[H.E0 + x, H.N0 + y] for x, y in ring]
    return {"id": bid, "type": "building", "label": "House", "geometry": {"kind": "polygon", "ring": r},
            "params": {"ffl_rl": H.user(ffl) if ffl is not None else {"value": None, "basis": "unresolved"}},
            "building": {"levels": [{"name": "Ground", "elevation_m": 0, "rings": [r]}], "frame": {"origin": [H.E0, H.N0]}}}


def saved(*buildings: dict) -> SiteDesign:
    return SiteDesign.model_validate({"objects": list(buildings), "version": 1})


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.delenv("SCENE_BUNDLE_DIR", raising=False)
    TS.clear_cache()
    app = create_app(Settings(export_dir=str(tmp_path)), pool=object())
    app.dependency_overrides[site_design_access] = lambda: uuid.uuid4()
    app.dependency_overrides[site_rules_dep] = lambda: H.rules(H.req("driveway.max_grade_pct", 5.0, "%"))
    pid = uuid.uuid4()
    return TestClient(app), tmp_path, pid, app


def write_design(base, pid, doc: SiteDesign):
    d = base / str(pid)
    d.mkdir(parents=True, exist_ok=True)
    (d / "site_design.json").write_text(json.dumps(doc.dump()))


def post_drive(c, pid, pts=((X0, -4.0), (X0, 14.0)), detail="full", extra=None, **params):
    params.setdefault("width_m", 3.0)
    body = {"driveway": H.driveway(pts, **params), "detail": detail}
    body.update(extra or {})
    return c.post(f"/projects/{pid}/site-design/driveway-profile", json=body)


def grading_body(ring_local, **params):
    return {"grading_area": {"id": "g1", "type": "grading_area", "geometry": {"kind": "polygon", "ring": [[H.E0 + x, H.N0 + y] for x, y in ring_local]},
                             "params": {k: H.user(v) for k, v in params.items()}}}


# ---- 1. input caps ---------------------------------------------------------------------------------------------------------------------
def test_a_20_km_driveway_is_refused_with_422_and_fast(api):
    c, tmp, pid, _ = api
    H.write_bundle(tmp, pid, H.bundle())
    t0 = time.perf_counter()
    r = post_drive(c, pid, pts=((X0, -4.0), (X0, 20000.0)), end_level_rl=100.0)
    assert r.status_code == 422 and time.perf_counter() - t0 < 2.0
    assert "300" in r.json()["message"] and r.json()["code"] == "ENGINE_INPUT_TOO_LARGE"


def test_a_20_km_driveway_is_refused_even_with_no_bundle(api):
    c, tmp, pid, _ = api
    assert post_drive(c, pid, pts=((X0, -4.0), (X0, 20000.0))).status_code == 422                      # the cheap caps run before the bundle is read


def test_a_400_m_grading_square_is_refused_with_422_and_fast(api):
    c, tmp, pid, _ = api
    H.write_bundle(tmp, pid, H.bundle())
    t0 = time.perf_counter()
    r = c.post(f"/projects/{pid}/site-design/grading", json=grading_body(((0, 0), (400, 0), (400, 400), (0, 400)), target_level_m=100.0))
    assert r.status_code == 422 and time.perf_counter() - t0 < 2.0 and r.json()["code"] == "ENGINE_INPUT_TOO_LARGE"
    ok = c.post(f"/projects/{pid}/site-design/grading", json=grading_body(((4, 10), (14, 10), (14, 20), (4, 20)), target_level_m=100.0))
    assert ok.status_code == 200


def test_vertex_caps(api):
    c, tmp, pid, _ = api
    H.write_bundle(tmp, pid, H.bundle())
    wiggle = [(X0 + (0.01 if i % 2 else 0.0), -4.0 + 0.05 * i) for i in range(201)]                        # 201 vertices, 10 m long
    assert post_drive(c, pid, pts=wiggle).status_code == 422
    assert post_drive(c, pid, pts=wiggle[:200]).status_code == 200
    n = 501
    ring = [(10 + 4 * np.cos(2 * np.pi * i / n), 20 + 4 * np.sin(2 * np.pi * i / n)) for i in range(n)]
    assert c.post(f"/projects/{pid}/site-design/grading", json=grading_body(ring, target_level_m=100.0)).status_code == 422
    assert c.post(f"/projects/{pid}/site-design/grading", json=grading_body(ring[:500], target_level_m=100.0)).status_code == 200


def test_geometry_beyond_the_terrain_bounds_plus_20_m_is_refused(api):
    c, tmp, pid, _ = api
    H.write_bundle(tmp, pid, H.bundle())                                       # ground covers x in [-8, 26] and y in [-8, 42]
    assert post_drive(c, pid, pts=((X0, -4.0), (X0, 61.0))).status_code == 200            # 19 m past the ground: inside the margin (the ground just is not there)
    r = post_drive(c, pid, pts=((X0, -4.0), (X0, 63.0)))
    assert r.status_code == 422 and r.json()["code"] == "GEOMETRY_OUTSIDE_TERRAIN"
    assert c.post(f"/projects/{pid}/site-design/grading", json=grading_body(((100, 10), (110, 10), (110, 20), (100, 20)), target_level_m=100.0)).status_code == 422
    assert c.post(f"/projects/{pid}/site-design/grading", json=grading_body(((40, 10), (44, 10), (44, 20), (40, 20)), target_level_m=100.0)).status_code == 200


def test_the_engines_enforce_the_caps_themselves(terrain):
    from app.design.engine_limits import EngineLimitError
    from app.design.grading_engine import grading
    with pytest.raises(EngineLimitError):
        driveway_profile(drive(end=100.0, pts=((X0, -4.0), (X0, 400.0))), terrain, UNRES)
    sq = SiteObject.model_validate({"id": "g", "type": "grading_area", "geometry": {"kind": "polygon", "ring": [[H.E0, H.N0], [H.E0 + 400, H.N0], [H.E0 + 400, H.N0 + 400], [H.E0, H.N0 + 400]]}})
    with pytest.raises(EngineLimitError):
        grading(sq, terrain, UNRES)


def test_sample_grid_and_scraping_paths_are_guarded():
    from app.design.driveway_engine import _sample_ts
    from app.design.engine_limits import EngineLimitError
    with pytest.raises(EngineLimitError):
        _sample_ts(20000.0)
    assert len(_sample_ts(300.0)) == 602
    f = pf._interp([(0.0, 100.0, "a"), (10.0, 100.5, "b"), (20.0, 101.0, "c")])
    t0 = time.perf_counter()
    with pytest.raises(ValueError, match="longer than"):
        pf.scraping_margin(f, 0.0, 20000.0, max_span_m=310.0)
    with pytest.raises(ValueError, match="longer than"):
        pf.check_profile([(0.0, 100.0, "a"), (10.0, 100.5, "b"), (20000.0, 130.0, "c")], max_span_m=310.0)
    assert time.perf_counter() - t0 < 1.0
    assert np.isfinite(pf.scraping_margin(f, 0.0, 20.0, max_span_m=310.0))


def test_an_absurd_platform_is_refused_before_the_grid_is_built(api):
    c, tmp, pid, _ = api
    H.write_bundle(tmp, pid, H.bundle())
    t0 = time.perf_counter()
    r = post_drive(c, pid, pts=((X0, -4.0), (X0, 30.0)), end_level_rl=Z(30), width_m=6000.0)           # a 6 km wide platform: a ~1.2 million point grid
    assert r.status_code == 422 and "GRID CELLS" in r.json()["message"] and time.perf_counter() - t0 < 3.0


def test_the_largest_accepted_grading_area_is_computed_in_reasonable_time(api):
    c, tmp, pid, _ = api
    b = H.bundle(step=4.0, extent=(-80.0, 220.0, -80.0, 220.0))
    H.write_bundle(tmp, pid, b)
    ring = ((10, 10), (150, 10), (150, 150), (10, 150))                          # 19600 m2: under the cap
    t0 = time.perf_counter()
    r = c.post(f"/projects/{pid}/site-design/grading", json=grading_body(ring, target_level_m=104.0, batter_cut_h_per_v=2.0, batter_fill_h_per_v=3.0))
    assert r.status_code == 200 and r.json()["status"] == "OK"
    assert time.perf_counter() - t0 < 60.0


# ---- 2. the building linked end level is resolved on the server ----------------------------------------------------------------------
def linked(end_level=None, **kw):
    kw["end_building_id"] = {"value": "bld1", "basis": "user"}
    return drive(end=end_level, **kw)


def test_endpoint_takes_the_end_level_from_the_saved_building_not_the_objects_own_level(api):
    c, tmp, pid, _ = api
    H.write_bundle(tmp, pid, H.bundle())
    write_design(tmp, pid, saved(building_json(ffl=Z(14))))
    r = post_drive(c, pid, end_level_rl=90.0, end_building_id={"value": "bld1", "basis": "user"})                # a stale typed level of 90 m
    j = r.json()
    assert r.status_code == 200 and j["end_level"]["value"] == pytest.approx(Z(14)) and j["end_level"]["building_id"] == "bld1"
    assert j["stations"][-1]["name"] == "DRIVEWAY END" and j["stations"][-1]["design_rl"] == pytest.approx(Z(14), abs=1e-3)
    assert all(abs(s["grade_pct"] - 6.0) < 0.05 for s in j["segments"])                                           # a 90 m end level would give a huge grade


def test_a_linked_building_with_no_ffl_leaves_the_end_level_not_set_whatever_the_object_carries(api):
    c, tmp, pid, _ = api
    H.write_bundle(tmp, pid, H.bundle())
    write_design(tmp, pid, saved(building_json(ffl=None)))
    j = post_drive(c, pid, end_level_rl=101.0, end_building_id={"value": "bld1", "basis": "user"}).json()
    assert j["end_level"]["value"] is None and j["status"] == "END LEVEL NOT SET" and j["samples"]["design"] is None
    assert any("END LEVEL NOT SET" in n and "NO FFL" in n for n in j["notes"])


def test_the_building_sent_with_the_request_is_validated_against_the_saved_design(api):
    c, tmp, pid, _ = api
    H.write_bundle(tmp, pid, H.bundle())
    link = {"end_building_id": {"value": "bld1", "basis": "user"}}
    write_design(tmp, pid, saved(building_json(ffl=100.0)))
    j = post_drive(c, pid, extra={"building": building_json(ffl=Z(14))}, **link).json()              # the browser has edited the FFL and not saved yet
    assert j["end_level"]["value"] == pytest.approx(Z(14))
    j = post_drive(c, pid, extra={"building": building_json(bid="other", ffl=Z(14))}, **link).json()     # not the linked building
    assert j["end_level"]["value"] is None and any("NOT THE LINKED BUILDING" in n for n in j["notes"])
    write_design(tmp, pid, saved())                                                                      # the building is not in the saved design
    j = post_drive(c, pid, extra={"building": building_json(ffl=Z(14))}, **link).json()
    assert j["end_level"]["value"] is None and any("NOT IN THE SAVED SITE DESIGN" in n for n in j["notes"])
    (tmp / str(pid) / "site_design.json").unlink()                                                      # nothing saved at all
    assert post_drive(c, pid, **link).json()["end_level"]["value"] is None
    assert post_drive(c, pid, end_level_rl=101.0).json()["end_level"]["value"] == 101.0                   # no link: the object's own level is the end level


def test_the_export_resolves_the_link_from_the_saved_design_and_refuses_a_stale_profile(terrain):
    obj = linked(end_level=95.0)                                                    # a stale typed level
    doc = saved(building_json(ffl=101.2))
    prof = driveway_profile(obj, terrain, UNRES, saved_design=doc)
    ex = export_driveway(obj, prof, design=doc)
    assert ex.end_level_rl == pytest.approx(101.2)                                  # the building FFL, not 95
    stale = driveway_profile(obj, terrain, UNRES, saved_design=saved(building_json(ffl=100.0)))        # computed before the FFL changed
    with pytest.raises(ExportError, match="compute the profile again"):
        export_driveway(obj, stale, design=doc)
    with pytest.raises(ExportError):                                                # a linked driveway cannot be exported without the design that holds the building
        export_driveway(obj, prof)
    nofl = saved(building_json(ffl=None))
    noprof = driveway_profile(obj, terrain, UNRES, saved_design=nofl)
    assert export_driveway(obj, noprof, design=nofl).end_level_rl is None
    plain = drive(end=101.2)
    assert export_driveway(plain, driveway_profile(plain, terrain, UNRES)).end_level_rl == pytest.approx(101.2)


# ---- 4. the gutter band with no verge ---------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("case", ["no_lot", "does_not_cross"])
def test_an_unknown_verge_leaves_the_gutter_band_unresolved_not_the_sa3_default(case):
    if case == "no_lot":
        b = H.bundle()
        b["parts"] = [p for p in b["parts"] if p["c"] != "boundary"]
        t, pts = terrain_from_bundle(b), ((X0, -4.0), (X0, 8.0), (X0, 14.0))
    else:
        t, pts = terrain_from_bundle(H.bundle()), ((X0, -4.0), (X0, -2.0), (X0, -1.0))              # never reaches the front boundary
    assert (t.lot is None) == (case == "no_lot")
    r = driveway_profile(drive(end=Z(pts[-1][1]) + 0.2, pts=pts), t, H.rules(H.req("driveway.max_grade_change_pct", 5.0, "%")))
    assert r["geometry"]["gutter_band_m"] is None and r["geometry"]["gutter_band_status"] == "UNRESOLVED" and r["geometry"]["verge_m"] is None
    assert "GUTTER BAND" not in [s["name"] for s in r["stations"]] and r["unresolved_stations"][0]["name"] == "GUTTER BAND"
    c = check(r, "change_of_grade@GUTTER BAND")
    assert (c["status"], c["value"], c["limit"], c["requirement_key"]) == ("NOT EVALUATED", None, None, "driveway.max_grade_change_pct")
    assert any("GUTTER BAND UNRESOLVED" in n for n in r["notes"])
    assert r["status"] == "OK" and r["samples"]["design"] is not None and not any(f["id"].endswith("GUTTER BAND") for f in r["failing"])     # the rest still works


# ---- 5. the standard from SiteRules; a FAIL always has a limit ----------------------------------------------------------------------------
def test_the_grade_limit_is_unit_aware(terrain):
    steep = drive(end=Z(14) + 0.7)                                                  # the last 14 m climb 11 percent
    r = driveway_profile(steep, terrain, H.rules(H.req("driveway.max_grade_pct", 8.0, "deg")))        # 8 degrees is 14.05 percent
    c = check(r, "max_grade")
    assert c["limit"] == pytest.approx(14.054, abs=0.01) and c["status"] == "PASS" and c["value"] == pytest.approx(11.0, abs=0.2)
    lo = driveway_profile(steep, terrain, H.rules(H.req("driveway.max_grade_pct", 8.0, "%")))
    assert check(lo, "max_grade")["status"] == "FAIL" and check(lo, "max_grade")["limit"] == 8.0


def test_a_requirement_in_an_unusable_unit_is_not_evaluated_and_never_a_fail_without_a_limit(api, terrain):
    rules = H.rules(H.req("driveway.max_grade_change_pct", 5.0, "mm"), H.req("driveway.max_grade_pct", 8.0, "m"))
    r = driveway_profile(drive(end=Z(14) + 1.2), terrain, rules)                  # a grade break of 8.6 percent at the boundary
    cg = check(r, "change_of_grade@PROPERTY BOUNDARY")
    assert cg["status"] == "NOT EVALUATED" and cg["limit"] is None and check(r, "max_grade")["status"] == "NOT EVALUATED"
    assert all(c["limit"] is not None for c in r["checks"] if c["status"] == "FAIL") and all(f["limit"] is not None for f in r["failing"])
    c, tmp, pid, app = api
    app.dependency_overrides[site_rules_dep] = lambda: rules
    H.write_bundle(tmp, pid, H.bundle())
    resp = post_drive(c, pid, end_level_rl=Z(14) + 1.2)
    assert resp.status_code == 200                                                # was a 500: the failing message formatted a missing limit


def test_a_fail_without_a_limit_is_converted_not_formatted():
    from app.design.driveway_engine import _from_item
    from app.agents.sa3_driveway.models import CheckItem
    stations = [(0.0, 100.0, "KERB LINE"), (4.0, 100.4, "PROPERTY BOUNDARY"), (10.0, 101.0, "DRIVEWAY END")]
    rg, rc = SiteRules(None).get("driveway.max_grade_pct"), SiteRules(None).get("driveway.max_grade_change_pct")
    c = _from_item(CheckItem(name="change_of_grade@PROPERTY BOUNDARY", passed=False, value=3.0, limit=None, unit="%"), stations, rg, rc)
    assert c["status"] == "NOT EVALUATED" and c["limit"] is None and c["chainage_from_m"] is None


# ---- 6. batters clipped at the kerb line and the building footprint ------------------------------------------------------------------------
def steep_road_side(x, y):
    """The planar lot ground, but falling away steeply (60 percent) on the road side of the kerb line (y < -4), so a fill batter wants to run into the road."""
    return H.PLANAR(x, y) + np.where(y < -4.0, 0.6 * (y + 4.0), 0.0)


def _coords(g):
    gs = getattr(g, "geoms", [g])
    return np.vstack([np.array(p.exterior.coords) for p in gs]) if gs else np.empty((0, 2))


def test_batters_are_clipped_at_the_kerb_line_and_the_linked_building_footprint():
    t = terrain_from_bundle(H.bundle(z=steep_road_side))
    ruled = dict(batter_cut_h_per_v=2.0, batter_fill_h_per_v=3.0)
    ffl = Z(14) + 0.6
    foot = Polygon([(H.E0 + x, H.N0 + y) for x, y in ((5, 13), (13, 13), (13, 20), (5, 20))])
    doc = saved(building_json(ffl=ffl))
    r = driveway_profile(linked(**ruled), t, UNRES, saved_design=doc)
    ew = r["earthworks"]
    assert ew["batters_computed"] and ew["batters"]["fill_wkt"] and ew["fill_m3"] > 0
    batter = wkt.loads(ew["batters"]["fill_wkt"])
    y_local = _coords(batter)[:, 1] - H.N0
    assert y_local.min() >= -4.0 - 1e-6                                              # nothing past chainage 0 (the kerb line, y = -4) into the road
    assert batter.intersection(foot).area < 1e-6                                     # nothing inside the building footprint
    for z in ew["zones"]:
        g = wkt.loads(z["wkt"])
        assert _coords(g)[:, 1].min() - H.N0 >= -4.0 - 1e-6 and g.intersection(foot).area < 1e-6
    assert wkt.loads(ew["platform_wkt"]).intersection(foot).area < 1e-6
    assert any("CLIPPED AT THE ASSUMED KERB LINE" in n for n in ew["notes"]) and any("FOOTPRINT OF THE LINKED BUILDING" in n for n in ew["notes"])
    # the same driveway with no link (same end level typed): still clipped at the kerb line, but nothing stops the batter at the building
    free = driveway_profile(drive(end=ffl, **ruled), t, UNRES)["earthworks"]
    fb = wkt.loads(free["batters"]["fill_wkt"])
    assert _coords(fb)[:, 1].min() - H.N0 >= -4.0 - 1e-6 and fb.intersection(foot).area > 0.5


# ---- 7. the end level survives the station merge ----------------------------------------------------------------------------------
def test_the_end_level_is_kept_when_the_end_is_within_the_merge_distance_of_the_boundary(terrain):
    end = Z(0.02) + 0.3
    r = driveway_profile(drive(end=end, pts=((X0, -4.0), (X0, 0.02))), terrain, UNRES)               # the boundary is at chainage 4.0, the end at 4.02
    names = [s["name"] for s in r["stations"]]
    assert names == ["KERB LINE", "GUTTER BAND", "DRIVEWAY END"]
    e = r["stations"][-1]
    assert e["design_rl"] == pytest.approx(end, abs=1e-3) and r["samples"]["design"][-1] == pytest.approx(end, abs=1e-3)
    assert any("PROPERTY BOUNDARY STATION IS WITHIN" in n and "END LEVEL IS KEPT" in n for n in r["notes"])
    assert r["status"] == "OK" and check(r, "max_grade")["value"] > 6.0                             # the 0.3 m rise over the last 3.5 m is in the grade
    far = driveway_profile(drive(end=end, pts=((X0, -4.0), (X0, 0.5))), terrain, UNRES)
    assert [s["name"] for s in far["stations"]] == ["KERB LINE", "GUTTER BAND", "PROPERTY BOUNDARY", "DRIVEWAY END"] and not any("MERGED" in n for n in far["notes"])


# ---- 11. single flight, concurrency, requirement cache ----------------------------------------------------------------------------------
def test_the_first_parse_of_a_bundle_is_single_flight(tmp_path, monkeypatch):
    TS.clear_cache()
    p = H.write_bundle(tmp_path, uuid.uuid4(), H.bundle())
    calls, real = [], TS.terrain_from_bundle

    def slow(bundle):
        calls.append(1)
        time.sleep(0.3)
        return real(bundle)
    monkeypatch.setattr(TS, "terrain_from_bundle", slow)
    out, barrier = [], threading.Barrier(6)

    def go():
        barrier.wait()
        out.append(TS.load_terrain(p))
    ts = [threading.Thread(target=go) for _ in range(6)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert len(calls) == 1 and len(out) == 6 and all(o is out[0] for o in out)
    assert TS._INFLIGHT == {}


def test_at_most_two_engine_requests_of_a_project_compute_at_once_on_the_engine_pool():
    state = {"now": 0, "max": 0, "threads": set()}
    lock = threading.Lock()

    def work():
        with lock:
            state["now"] += 1
            state["max"] = max(state["max"], state["now"])
            state["threads"].add(threading.current_thread().name)
        time.sleep(0.1)
        with lock:
            state["now"] -= 1
        return 1

    async def fire():
        mine, other = uuid.uuid4(), uuid.uuid4()
        return await asyncio.gather(*[API._run_engine(mine, work) for _ in range(6)])
    assert asyncio.run(fire()) == [1] * 6
    assert state["max"] == API.ENGINE_PER_PROJECT == 2
    assert all(n.startswith("site-engine") for n in state["threads"]) and API._GATES == {}          # no gate is kept for an idle project

    async def two_projects():
        t0 = time.perf_counter()
        await asyncio.gather(*[API._run_engine(uuid.uuid4(), work) for _ in range(4)])             # four projects: one request each, they do not wait for each other
        return time.perf_counter() - t0
    state["max"] = 0
    assert asyncio.run(two_projects()) < 0.35 and state["max"] >= 3


def test_the_routes_run_the_engines_on_the_engine_pool(api, monkeypatch):
    c, tmp, pid, _ = api
    H.write_bundle(tmp, pid, H.bundle())
    seen, real = [], API.driveway_profile
    monkeypatch.setattr(API, "driveway_profile", lambda *a, **k: (seen.append(threading.current_thread().name), real(*a, **k))[1])
    assert post_drive(c, pid, end_level_rl=Z(14)).status_code == 200
    assert seen and seen[0].startswith("site-engine")


def test_the_requirement_set_cache_follows_the_knowledge_files(tmp_path, monkeypatch):
    from app.design import site_rules as SR
    from app.report import knowledge as K
    monkeypatch.setattr(K, "KNOWLEDGE_DIR", tmp_path)
    lga_dir = tmp_path / "testshire"
    lga_dir.mkdir()
    f = lga_dir / "requirements.json"

    def write(v):
        f.write_text(json.dumps({"requirements": [H.req("driveway.max_grade_pct", v, "%", lga="Testshire").model_dump(mode="json")]}))
    write(8.0)
    SR._requirement_set_cached.cache_clear()
    assert SR.rules_for("Testshire", "NSW").get("driveway.max_grade_pct").value == 8.0
    assert SR.rules_for("Testshire", "NSW").get("driveway.max_grade_pct").value == 8.0
    write(12.5)                                                                     # the knowledge file changes while the server runs
    assert SR.rules_for("Testshire", "NSW").get("driveway.max_grade_pct").value == 12.5
    f.unlink()
    assert not SR.rules_for("Testshire", "NSW").get("driveway.max_grade_pct").resolved
