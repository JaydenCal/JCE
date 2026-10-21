"""Stage 7 review fixes: the basis of a parameter is enforced (user, a verified LGA rule, never a platform default), the check route is bounded, no check can raise,
unit and range handling, the SRZ formula keys, the pool barrier link, the tank level checks, client and server parity, and uppercase strings.

Local coordinates are metres from the sample lot origin (see site_support): the lot is x 0 to 18 and y 0 to 34, the street is at y below 0.
"""
from __future__ import annotations

import json
import math
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import site_support as H
from app.agents.requirements.models import DIMENSIONLESS_UNITS, Requirement, RequirementSet, Selectors, Source
from app.agents.sa4_hydro import rwt as SA4
from app.api.app import create_app
from app.api.settings import Settings
from app.api.site_design import site_design_access, site_rules_dep
from app.design import engine_limits as EL
from app.design import object_keys as OK
from app.design import terrain_source as TS
from app.design.object_checks import check_design
from app.design.rwt_size import size_tank
from app.design.site_design import Param, SiteDesign, SiteObject
from app.design.site_rules import SiteRules, rules_for
from app.design.terrain_source import terrain_from_bundle
from app.design.wall_screening import screen_wall
from test_site_objects import NONE, RAIN, WALL_KEYS, R, at, bld, design, get, line, osd, pit, pipe, poly, pt, run, tank_full, wall

SLOPE = lambda x, y: 100.0 + 0.05 * y + 0.0 * x           # noqa: E731


@pytest.fixture(scope="module")
def terrain():
    return terrain_from_bundle(H.bundle(z=SLOPE, extent=(-10.0, 28.0, -10.0, 44.0)))


def lga(v, ref):
    return {"value": v, "basis": "lga_rule", "ref": ref}


def pdef(v, ref="PLATFORM DEFAULT, LGA RULE NOT LOADED"):
    return {"value": v, "basis": "platform_default", "ref": ref}


# ---- 1. the basis of a parameter -----------------------------------------------------------------------------------------------------
def test_model_refuses_a_platform_default_on_a_stage_7_parameter_and_a_blank_lga_reference():
    with pytest.raises(ValueError, match="platform default"):
        SiteObject.model_validate(pt("t1", "rwt", 5, 5, height_m=pdef(2.0, "STAMP")))
    with pytest.raises(ValueError, match="platform default"):
        SiteObject.model_validate(pt("w", "stormwater_pit", 5, 5, invert_rl=pdef(99.0)))
    with pytest.raises(ValueError, match="requirement reference"):
        SiteObject.model_validate(pt("t1", "rwt", 5, 5, height_m=lga(2.0, "   ")))
    # still allowed: the Plan Studio size estimate on a tank, the OSD psd (the checks verify its value), and the older types
    SiteObject.model_validate(pt("t1", "rwt", 5, 5, diameter_m=pdef(2.0, "PLAN STUDIO ESTIMATE: size for a non standard capacity")))
    SiteObject.model_validate(pt("o1", "osd", 5, 5, psd_l_s=pdef(2.0)))
    SiteObject.model_validate(poly("l1", "landscape_area", [(2, 20), (8, 20), (8, 26)], surface_kind=pdef("turf")))


def test_an_lga_rule_parameter_is_used_only_when_the_server_resolves_its_reference_to_that_value():
    ok = get(run(design(osd(psd_l_s=lga(7.0, "stormwater.psd_l_s"))), R(stormwater__psd_l_s=7.0)), "OSD_PSD")
    assert ok["status"] == "INFO" and ok["value"] == 7.0 and ok["requirements"][0]["basis"] == "LGA RULE"
    for rules, ref in ((R(stormwater__psd_l_s=5.0), "stormwater.psd_l_s"),            # the server resolves another value
                       (R(stormwater__psd_l_s=7.0), "stormwater.ssr_m3"),              # the reference names another key
                       (R(stormwater__psd_l_s=7.0), "tree.made_up"),                   # not a requirement
                       (NONE, "stormwater.psd_l_s")):                                  # nothing to verify against
        c = get(run(design(osd(psd_l_s=lga(7.0, ref))), rules), "OSD_PSD")
        assert c["status"] == "NOT EVALUATED" and "LGA RULE REFERENCE NOT VERIFIED" in c["message"], (ref, c["message"])
        assert c["value"] is None


def test_an_unverified_lga_rule_value_is_not_replaced_by_the_requirement_and_is_named_on_the_check():
    d = design(pt("t1", "rwt", 10, 20, shape="round", diameter_m=2.0, height_m=lga(3.5, "rwt.max_height_m.urban_zones")))
    c = get(run(d, R(rwt__max_height_m__urban_zones=3.0)), "RWT_MAX_HEIGHT")
    assert c["status"] == "NOT EVALUATED" and "HEIGHT_M" in c["message"] and "LGA RULE REFERENCE NOT VERIFIED" in c["message"]
    # the same value that the server resolves is accepted, with its TRUE basis
    d2 = design(pt("t1", "rwt", 10, 20, shape="round", diameter_m=2.0, height_m=lga(3.0, "rwt.max_height_m.urban_zones")))
    assert get(run(d2, R(rwt__max_height_m__urban_zones=3.0)), "RWT_MAX_HEIGHT")["status"] == "PASS"


def test_a_platform_default_is_never_an_engineering_input_except_the_registered_psd():
    est = "PLAN STUDIO ESTIMATE: size for a non standard capacity"
    d = design(pt("t1", "rwt", 10, 20, shape="round", diameter_m=pdef(2.0, est), height_m=pdef(3.5, est)))
    res = run(d, R(rwt__max_height_m__urban_zones=3.2))
    c = get(res, "RWT_MAX_HEIGHT")
    assert c["status"] == "NOT EVALUATED" and "PLATFORM DEFAULT IS NOT ACCEPTED" in c["message"]
    assert get(res, "RWT_BOUNDARY_DISTANCE")["status"] == "NOT EVALUATED"                      # the footprint is not known from an estimate
    r = rules_for("Nowhere", "NSW")                                                               # psd 2 L/s is the registered platform default
    assert get(run(design(osd(psd_l_s=pdef(2.0))), r), "OSD_PSD")["basis"] == "PLATFORM DEFAULT"
    c = get(run(design(osd(psd_l_s=pdef(3.0))), r), "OSD_PSD")                                    # a value the resolver does not give
    assert c["status"] == "NOT EVALUATED" and "PLATFORM DEFAULT IS NOT ACCEPTED" in c["message"]


def test_the_true_basis_is_echoed_never_relabelled_as_user():
    rules = R(stormwater__orifice_discharge_coefficient=0.62, stormwater__psd_l_s=20.0)
    c = get(run(design(osd(discharge_coefficient=lga(0.62, "stormwater.orifice_discharge_coefficient"))), rules), "OSD_ORIFICE")
    assert c["requirements"][0]["key"] == "stormwater.orifice_discharge_coefficient" and c["requirements"][0]["basis"] == "LGA RULE"
    # a capacity entered by the user is shown as USER, and the value box carries the basis of the read
    res = run(design(pt("t1", "rwt", 10, 20, shape="round", diameter_m=2.0, height_m=2.0, capacity_l=3000)), NONE)
    assert [v for v in res["values"]["t1"] if v["key"] == "capacity_l"][0]["basis"] == "USER"


def test_wall_screening_and_psd_read_a_parameter_the_same_way():
    vals = {k.split("__")[1]: v for k, v in WALL_KEYS.items()}
    mine = {**{k: v for k, v in vals.items() if k != "surcharge_kpa"}}
    unverified = wall(height_m=1.2, surcharge_kpa=lga(5.0, "retaining.surcharge_kpa"), **mine)
    r = screen_wall(unverified, R(**{**WALL_KEYS, "retaining__surcharge_kpa": 4.0}))
    assert r["status"] == "NOT EVALUATED" and "LGA RULE REFERENCE NOT VERIFIED" in r["reason"]
    verified = screen_wall(unverified, R(**WALL_KEYS))
    assert verified["status"] == "SCREENED" and [u for u in verified["used"] if u["key"] == "retaining.surcharge_kpa"][0]["basis"] == "LGA RULE"
    assert screen_wall(wall(height_m=1.2, surcharge_kpa=pdef(5.0, "PLAN STUDIO ESTIMATE: x"), **mine), R(**WALL_KEYS))["status"] == "NOT EVALUATED"


def test_the_size_action_reads_tank_values_by_basis_and_echoes_it():
    rules = R(rwt__candidate_sizes_l="2000,3000,5000")
    t = tank_full(runoff_coefficient=lga(0.8, "rwt.runoff_coefficient"))
    r = size_tank(t, None, rules, RAIN, "S1")
    assert r["status"] == "UNRESOLVED" and any(m["input"] == "runoff_coefficient" and "LGA RULE REFERENCE NOT VERIFIED" in m["why"] for m in r["missing"])
    ok = size_tank(t, None, R(rwt__candidate_sizes_l="2000,3000,5000", rwt__runoff_coefficient=0.8), RAIN, "S1")
    entered = {e["input"]: e for e in ok["entered"]}
    assert ok["status"] == "SIZED" and entered["runoff_coefficient"]["value"] == 0.8 and entered["runoff_coefficient"]["basis"] == "LGA RULE"
    assert entered["first_flush_mm"]["basis"] == "USER"


# ---- 2. the check endpoint is bounded ----------------------------------------------------------------------------------------------
@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.delenv("SCENE_BUNDLE_DIR", raising=False)
    TS.clear_cache()
    app = create_app(Settings(export_dir=str(tmp_path)), pool=object())
    app.dependency_overrides[site_design_access] = lambda: uuid.uuid4()
    app.dependency_overrides[site_rules_dep] = lambda: R(stormwater__min_cover_m=0.6)
    return TestClient(app), tmp_path, uuid.uuid4()


def post(c, pid, d):
    return c.post(f"/projects/{pid}/site-design/check", content=json.dumps(d.dump()), headers={"content-type": "application/json"})


def long_pipe(i, length, step=100.0):
    xs = [k * step for k in range(int(length / step) + 1)]
    xs = xs if xs[-1] == length else xs + [length]
    return pipe([(x, 1.0 + i * 0.01) for x in xs], diameter_mm=300, upstream_invert_rl=99.0, downstream_invert_rl=98.0) | {"id": f"p{i}"}


def test_the_check_route_refuses_pipes_over_the_caps_with_422(api):
    c, _tmp, pid = api
    assert post(c, pid, design(long_pipe(0, 250))).status_code == 200
    one = post(c, pid, design(long_pipe(0, 301)))
    assert one.status_code == 422 and "CHECK_INPUT_TOO_LARGE" in one.text and "300" in one.text
    total = post(c, pid, design(*[long_pipe(i, 280, step=280.0) for i in range(8)]))             # 8 x 280 m = 2240 m in all
    assert total.status_code == 422 and "CHECK_INPUT_TOO_LARGE" in total.text and "2,000" in total.text
    many_vertices = pipe([(i * 0.1, 1.0) for i in range(201)], diameter_mm=300)
    assert post(c, pid, design(many_vertices)).status_code == 422
    # the caps are engine_limits, like the driveway and grading routes
    with pytest.raises(EL.EngineLimitError) as e:
        EL.check_site_design(design(long_pipe(0, 301)))
    assert e.value.code == EL.CHECK_TOO_LARGE


def test_pipe_cover_is_sampled_in_one_vectorised_call(terrain, monkeypatch):
    calls = []
    orig = TS.TriSurface.z_at
    monkeypatch.setattr(TS.TriSurface, "z_at", lambda self, x, y: (calls.append(len(x)), orig(self, x, y))[1])
    p = pipe([(5, 1), (5, 31)], diameter_mm=300, upstream_invert_rl=98.0, downstream_invert_rl=97.5)
    res = run(design(p), R(stormwater__min_cover_m=0.6), terrain)
    assert get(res, "PIPE_COVER")["status"] in ("PASS", "FAIL")
    stations = [n for n in calls if n >= 10]
    assert len(stations) == 1 and stations[0] >= 31                       # one call for the 31 stations, not one call per station


# ---- 3. no check path raises -------------------------------------------------------------------------------------------------------
def test_a_zero_length_pipe_is_not_evaluated_not_a_500(terrain):
    p = pipe([(5, 10), (5, 10)], diameter_mm=300, upstream_invert_rl=99.5, downstream_invert_rl=99.1)
    res = run(design(p), R(stormwater__min_pipe_grade_pct=1.0, stormwater__min_cover_m=0.6), terrain)
    for code in ("PIPE_GRADE", "PIPE_COVER"):
        assert get(res, code)["status"] == "NOT EVALUATED" and "PIPE LENGTH ZERO" in get(res, code)["message"]


def test_zero_and_negative_screening_inputs_are_refused_with_a_message_not_a_500():
    vals = {k.split("__")[1]: v for k, v in WALL_KEYS.items()}
    for key, bad in (("min_fs_sliding", 0.0), ("min_fs_overturning", -2.0), ("soil_unit_weight_kn_m3", 0.0), ("gravity_wall_width_ratio", 0.0), ("wall_unit_weight_kn_m3", -1.0)):
        w = wall(height_m=1.2, **{**vals, key: bad})
        r = screen_wall(w, NONE)
        assert r["status"] == "NOT EVALUATED" and key.upper() in r["reason"] and "IS NOT ALLOWED" in r["reason"], key
        c = get(run(design(line("w1", "retaining_wall", [(2, 10), (12, 10)], wall_type="block", height_m=1.2, **{**vals, key: bad}))), "WALL_SCREENING")
        assert c["status"] == "NOT EVALUATED"
    # a requirement row of zero is refused the same way
    r = screen_wall(wall(height_m=1.2), R(**{**WALL_KEYS, "retaining__min_fs_sliding": 0.0}))
    assert r["status"] == "NOT EVALUATED" and "retaining.min_fs_sliding" in r["reason"]


def _all_keys_rules(v_number: float, v_ratio: float) -> SiteRules:
    rows = []
    for s in OK.SPECS:
        if s.kind == "bool":
            rows.append(H.req(s.key, True, ""))
        elif s.kind == "list":
            rows.append(H.req(s.key, ",".join([str(v_ratio)] * (s.length or 3)), ""))
        else:
            rows.append(H.req(s.key, v_ratio if s.kind in ("ratio", "count") else v_number, s.unit if s.kind == "number" else ""))
    return SiteRules(RequirementSet(requirements=rows, loaded=[Selectors(jurisdiction="NSW", lga="Testshire")]), "Testshire", "NSW")


def _full_design() -> list[dict]:
    house = bld("b1", [(4, 8), (14, 8), (14, 18), (4, 18)], building_use="house", roof_plan_area_m2=100.0)
    wall_p = dict(wall_type="block", height_m=1.2, thickness_m=0.2, surcharge_kpa=5.0, soil_friction_angle_deg=30.0, soil_unit_weight_kn_m3=18.0, wall_friction_ratio=0.5,
                  gravity_wall_width_ratio=0.6, wall_unit_weight_kn_m3=24.0, min_fs_sliding=1.5, min_fs_overturning=2.0)
    tank_p = dict(shape="round", diameter_m=1.5, height_m=2.0, base_rl=101.0, inlet_rl=102.8, overflow_rl=102.5, outlet_rl=101.2, capacity_l=3000, roof_building_id="b1",
                  connected_roof_area_m2=80.0, reuse_toilet=True, reuse_laundry=True, reuse_garden=True, garden_area_m2=40.0, runoff_coefficient=0.8, first_flush_mm=2.0, occupants=3,
                  toilet_l_pp_day=18, laundry_l_pp_day=20, garden_l_m2_day=3, wet_day_fraction=0.3, water_target_pct=50.0, tank_height_m=2.0)
    return [
        house,
        pt("t1", "rwt", 10, 24, **tank_p),
        pt("t2", "rwt", 15, 28, **{**tank_p, "shape": "slimline", "length_m": 2.0, "width_m": 0.8, "connected_roof_area_m2": 50.0}),
        line("w1", "retaining_wall", [(2, 10), (12, 10)], vertex_rls={"top": [101.0, 102.0], "bottom": [100.0, 100.0]}, **wall_p),
        line("i1", "infiltration_trench", [(4, 20), (9, 20)], width_m=1.0, depth_m=1.2, void_ratio=0.35, infiltration_rate_mm_h=30, infiltration_basis="indicative"),
        pt("o1", "osd", 9, 28, form="tank", width_m=2.0, length_m=3.0, height_m=1.5, storage_volume_m3=9.0, orifice_diameter_mm=40, orifice_invert_rl=100.0,
                                    top_water_level_rl=101.2, discharge_coefficient=0.6, psd_l_s=5.0),
        poly("ob1", "osd_basin", [(1, 28), (6, 28), (6, 32)], form="basin", depth_m=0.5, storage_volume_m3=8.0, orifice_diameter_mm=40, orifice_invert_rl=100.0, top_water_level_rl=101.0),
        line("r1", "overflow_route", [(9, 28), (9, 10)], osd_id="o1"),
        pit("a", 5, 10, invert_rl=99.0), pit("b", 5, 30, invert_rl=99.0),
        pipe([(5, 10), (5, 20), (5, 30)], diameter_mm=300, upstream_invert_rl=99.5, downstream_invert_rl=99.1),
        poly("pl1", "pool", [(4, 15), (10, 15), (10, 21), (4, 21)], depth_m=1.5, coping_width_m=0.3, water_level_rl=100.4),
        line("f1", "pool_barrier", [(2, 13), (12, 13), (12, 23), (2, 23)], height_m=1.2, pool_id="pl1"),
        line("fp1", "footpath", [(2, 5), (2, 20)], width_m=0.9, crossfall_pct=3.0, impervious=True),
        pt("tr1", "tree", 9, 17, trunk_diameter_mm=500, height_m=8.0, canopy_diameter_m=5.0) | {"status": "existing"},
        poly("l1", "landscape_area", [(2, 20), (8, 20), (8, 26), (2, 26)], surface_kind="gravel"),
        line("s1", "service_trace", [(0, 12), (18, 12)]),
    ]


FUZZ = (0.0, -1.0, -1e-9, float("nan"), float("inf"), 1e12, 1e-300)


def _survive(d: SiteDesign, rules: SiteRules, terrain) -> dict:
    res = check_design(d, rules, terrain)
    json.dumps(res, allow_nan=False)                               # the answer is always valid JSON
    return res


def test_no_check_path_raises_for_zero_negative_or_nan_values(terrain):
    base = design(*_full_design())
    rules = _all_keys_rules(2.0, 0.5)
    _survive(base, rules, terrain)
    for i, o in enumerate(base.objects):
        for key, p in list(o.params.items()):
            if isinstance(p.value, bool) or not isinstance(p.value, (int, float)):
                continue
            for v in FUZZ:
                d = base.model_copy(deep=True)
                d.objects[i].params[key] = Param.model_construct(value=v, basis="user", ref=None)
                _survive(d, rules, terrain)
                _survive(d, NONE, None)
                if o.type == "rwt":
                    size_tank(d.objects[i], d.objects[0], rules, RAIN, "S1", [2000, 3000], [1.0] * 12)
                    size_tank(d.objects[i], d.objects[0], NONE, RAIN, "S1")


def test_no_check_path_raises_for_zero_negative_or_nan_requirement_values(terrain):
    base = design(*_full_design())
    for v in (0.0, -1.0, 1e-300, 1e12, float("nan"), float("inf")):
        _survive(base, _all_keys_rules(v, v), terrain)
        _survive(base, _all_keys_rules(v, 0.5), terrain)
    for t in (tank_full(), tank_full(height_m=0.0)):
        for v in (0.0, -1.0, float("nan")):
            size_tank(t, None, _all_keys_rules(v, v), RAIN, "S1")


def test_no_check_path_raises_for_degenerate_geometry_and_levels(terrain):
    same = [(5, 10), (5, 10)]
    objs = [pipe(same, diameter_mm=300, upstream_invert_rl=99.0, downstream_invert_rl=99.0), line("w1", "retaining_wall", same, wall_type="block", height_m=1.2),
            line("i1", "infiltration_trench", same, width_m=1, depth_m=1, void_ratio=0.3), line("fp1", "footpath", same, width_m=1.0), line("f1", "pool_barrier", same, height_m=1.2),
            poly("pl1", "pool", [(4, 15), (4, 15), (4, 15)], depth_m=1.0, coping_width_m=0.3), poly("l1", "landscape_area", [(2, 20), (4, 20), (6, 20)], surface_kind="turf"),
            poly("ob1", "osd_basin", [(1, 28), (1, 28), (1, 28)], form="basin", depth_m=0.5)]
    for o in objs:
        _survive(design(o), _all_keys_rules(2.0, 0.5), terrain)
    w = line("w2", "retaining_wall", [(2, 10), (12, 10)], wall_type="block", vertex_rls={"top": [101.0, 1e308], "bottom": [100.0, -1e308]})
    _survive(design(w), R(**WALL_KEYS), terrain)


# ---- 4. units of zone qualified keys, and zone keys that do not resolve are named -------------------------------------------------
def _rules(*rows: Requirement) -> SiteRules:
    return SiteRules(RequirementSet(requirements=list(rows), loaded=[Selectors(jurisdiction="NSW", lga="Testshire")]), "Testshire", "NSW")


def test_a_zone_qualified_key_takes_the_unit_of_its_family():
    assert OK.spec_for("rwt.max_height_m.rural") is OK.BY_KEY["rwt.max_height_m"] and OK.spec_for("made.up.key") is None
    r = _rules(H.req("rwt.max_height_m.rural", 3200.0, "mm"))
    got = r.get("rwt.max_height_m.rural")
    assert got.resolved and got.value == pytest.approx(3.2) and got.unit == "m"           # converted from mm; the old fallback had no unit and refused it
    assert _rules(H.req("rwt.max_height_m.coastal", 3.0, "m")).get("rwt.max_height_m.coastal").value == 3.0


def test_the_tank_height_check_names_every_zone_key_it_could_not_resolve():
    unresolved = Requirement(key="rwt.max_height_m.hill", applies_to=Selectors(jurisdiction="NSW", lga="Testshire"), status="unresolved", prompt="enter it")
    rules = _rules(H.req("rwt.max_height_m.urban_zones", 3.2, "m"), H.req("rwt.max_height_m.coastal", 3.0, "kg"), unresolved)
    c = get(run(design(pt("t1", "rwt", 10, 20, shape="round", diameter_m=2.0, height_m=3.0)), rules), "RWT_MAX_HEIGHT")
    assert c["status"] == "PASS" and "NOT RESOLVED AND NOT CHECKED" in c["message"] and "rwt.max_height_m.coastal" in c["message"] and "rwt.max_height_m.hill" in c["message"]
    none_ok = get(run(design(pt("t1", "rwt", 10, 20, shape="round", diameter_m=2.0, height_m=3.0)), _rules(unresolved)), "RWT_MAX_HEIGHT")
    assert none_ok["status"] == "NOT EVALUATED" and "rwt.max_height_m.hill" in none_ok["message"]


# ---- 5. ranges ----------------------------------------------------------------------------------------------------------------------
def test_out_of_range_screening_inputs_are_refused():
    vals = {k.split("__")[1]: v for k, v in WALL_KEYS.items()}
    for key, bad in (("soil_friction_angle_deg", 70.0), ("soil_friction_angle_deg", -5.0), ("wall_friction_ratio", 1.5), ("surcharge_kpa", -1.0), ("soil_unit_weight_kn_m3", -18.0)):
        r = screen_wall(wall(height_m=1.2, **{**vals, key: bad}), NONE)
        assert r["status"] == "NOT EVALUATED" and key.upper() in r["reason"], (key, bad)
        assert all(s["fs_sliding"] is None for s in r["segments"])
    ok = screen_wall(wall(height_m=1.2, **{**vals, "soil_friction_angle_deg": 60.0, "surcharge_kpa": 0.0}), NONE)
    assert ok["status"] == "SCREENED"


def test_out_of_range_tank_inputs_are_refused_with_a_message_not_a_result():
    rules = R(rwt__candidate_sizes_l="2000,3000,5000")
    for param, bad in (("runoff_coefficient", 1.5), ("runoff_coefficient", -0.1), ("first_flush_mm", -2.0), ("tank_height_m", 0.0), ("toilet_l_pp_day", -18), ("wet_day_fraction", 0.0)):
        r = size_tank(tank_full(**{param: bad}), None, rules, RAIN, "S1")
        assert r["status"] == "UNRESOLVED" and any(m["input"] == param for m in r["missing"]), (param, bad)
        assert "chosen" not in r
    # a requirement row out of range is refused the same way and blocks the run
    out = size_tank(SiteObject.model_validate(pt("t1", "rwt", 1, 1, connected_roof_area_m2=50.0, reuse_toilet=True, reuse_laundry=False, reuse_garden=False, occupants=3,
                                                 toilet_l_pp_day=18, water_target_pct=50.0)),
                    None, R(rwt__runoff_coefficient=1.4, rwt__first_flush_mm=2.0, rwt__candidate_sizes_l="2000,3000", rwt__tank_height_m=2.0, rwt__wet_day_fraction=0.3), RAIN, "S1")
    assert out["status"] == "UNRESOLVED" and any(m["input"] == "rwt.runoff_coefficient" and "NOT ALLOWED" in m["why"] for m in out["missing"])


# ---- 6. placeholders are listed ------------------------------------------------------------------------------------------------------
def test_a_size_run_blocked_only_by_a_placeholder_lists_each_placeholder_field():
    rules = R(rwt__candidate_sizes_l="2000,3000,5000", rwt__demand__garden_l_m2_day=3.0, rwt__demand__garden_monthly_factor="1,1,1,1,1,1,1,1,1,1,1,1")
    t = tank_full(reuse_garden=True)                                         # the garden area is not entered and no requirement key holds it
    r = size_tank(t, None, rules, RAIN, "S1")
    assert r["status"] == "UNRESOLVED" and r["placeholders"] and [m for m in r["missing"] if "garden_area_m2" in m["input"]], r
    assert r["message"].startswith("NOT SIZED. ENTER EACH VALUE ON THE TANK OR LOAD THE REQUIREMENT: ")
    full = size_tank(tank_full(reuse_garden=True, garden_area_m2=40.0), None, rules, RAIN, "S1")
    assert full["status"] == "SIZED"


# ---- 7. one dimensionless set -----------------------------------------------------------------------------------------------------------
def test_sa4_and_the_site_keys_share_one_dimensionless_unit_set():
    assert OK.DIMENSIONLESS_UNITS is DIMENSIONLESS_UNITS and not hasattr(SA4, "STRICT_UNITS")
    for unit in ("", "ratio", "count", "-", "1"):
        req = Requirement(key="rwt.runoff_coefficient", value=0.8, unit=unit, status="resolved")
        assert SA4._parse(req, "num", "") == (0.8, None), unit
    assert SA4._parse(Requirement(key="rwt.runoff_coefficient", value=0.8, unit="mm", status="resolved"), "num", "")[1]


# ---- 8. tree structural root zone from a cited formula --------------------------------------------------------------------------------
def test_srz_is_computed_only_when_coefficient_exponent_and_minimum_all_resolve():
    assert "tree.srz_dbh_multiplier" not in OK.BY_KEY
    assert {"tree.srz_coefficient", "tree.srz_exponent", "tree.srz_min_radius_m"} <= set(OK.BY_KEY)
    tree = pt("tr1", "tree", 9, 17, trunk_diameter_mm=500) | {"status": "existing"}
    base = dict(tree__tpz_dbh_multiplier=12.0)
    srz = lambda res: [v for v in res["values"].get("tr1", []) if v["key"] == "srz_radius_m"]   # noqa: E731
    part = run(design(tree), R(**base, tree__srz_coefficient=2.0, tree__srz_exponent=0.5))
    assert not srz(part) and "tree.srz_min_radius_m" in get(part, "TREE_ZONES")["message"]
    full = run(design(tree), R(**base, tree__srz_coefficient=2.0, tree__srz_exponent=0.5, tree__srz_min_radius_m=1.0))
    assert srz(full)[0]["value"] == pytest.approx(2.0 * 0.5 ** 0.5, abs=1e-3)
    floor = run(design(tree), R(**base, tree__srz_coefficient=0.1, tree__srz_exponent=0.5, tree__srz_min_radius_m=1.5))
    assert srz(floor)[0]["value"] == pytest.approx(1.5)                                            # the minimum radius wins
    assert not srz(run(design(tree), R(**base)))


# ---- 9. pool barrier link --------------------------------------------------------------------------------------------------------------
def test_a_barrier_must_be_linked_to_a_pool_to_satisfy_it():
    pool = poly("pl1", "pool", [(4, 15), (10, 15), (10, 21), (4, 21)], depth_m=1.5, coping_width_m=0.3, water_level_rl=100.4)
    loose = line("f1", "pool_barrier", [(2, 13), (12, 13), (12, 23), (2, 23)], height_m=1.2)
    res = run(design(pool, loose), NONE)
    c = get(res, "POOL_BARRIER")
    assert c["status"] == "FAIL" and "NO LINKED BARRIER" in c["message"] and "NOT LINKED TO ANY POOL" in c["message"]
    b = get(res, "BARRIER_POOL_LINK")
    assert b["status"] == "FAIL" and "NOT LINKED TO A POOL" in b["message"]
    linked = line("f1", "pool_barrier", [(2, 13), (12, 13), (12, 23), (2, 23)], height_m=1.2, pool_id="pl1")
    ok = run(design(pool, linked), NONE)
    assert get(ok, "POOL_BARRIER")["status"] == "INFO" and not [x for x in ok["checks"] if x["code"] == "BARRIER_POOL_LINK"]
    other = line("f1", "pool_barrier", [(2, 13), (12, 13), (12, 23), (2, 23)], height_m=1.2, pool_id="pl2")
    assert get(run(design(pool, poly("pl2", "pool", [(14, 15), (16, 15), (16, 17)]), other), NONE), "POOL_BARRIER", "pl1")["status"] == "FAIL"


# ---- 10. tank levels ---------------------------------------------------------------------------------------------------------------------
def tank(**kw):
    return design(pt("t1", "rwt", 10, 24, shape="round", diameter_m=1.5, height_m=2.0, **kw))


def test_tank_levels_are_ordered_and_inside_the_tank_body():
    ok = run(tank(base_rl=101.0, inlet_rl=102.8, overflow_rl=102.5, outlet_rl=101.2), NONE)
    assert get(ok, "RWT_LEVEL_ORDER")["status"] == "PASS" and get(ok, "RWT_LEVELS_IN_BODY")["status"] == "PASS"
    bad = run(tank(base_rl=101.0, inlet_rl=102.4, overflow_rl=102.5, outlet_rl=101.2), NONE)
    assert get(bad, "RWT_LEVEL_ORDER")["status"] == "FAIL" and "INLET" in get(bad, "RWT_LEVEL_ORDER")["message"]
    equal = run(tank(base_rl=101.0, inlet_rl=102.5, overflow_rl=102.5, outlet_rl=101.2), NONE)
    assert get(equal, "RWT_LEVEL_ORDER")["status"] == "FAIL"                                         # inlet must be ABOVE the overflow
    out = run(tank(base_rl=101.0, inlet_rl=103.5, overflow_rl=102.5, outlet_rl=100.5), NONE)         # body is 101.0 to 103.0
    c = get(out, "RWT_LEVELS_IN_BODY")
    assert c["status"] == "FAIL" and "INLET" in c["message"] and "OUTLET" in c["message"]
    nobase = run(tank(inlet_rl=102.8, overflow_rl=102.5, outlet_rl=101.2), NONE)
    c = get(nobase, "RWT_LEVELS_IN_BODY")
    assert c["status"] == "NOT EVALUATED" and "TANK BASE RL" in c["message"]
    nothing = run(design(pt("t1", "rwt", 10, 24, shape="round", diameter_m=1.5)), NONE)
    n = get(nothing, "RWT_LEVEL_ORDER")
    assert n["status"] == "NOT EVALUATED" and all(w in n["message"] for w in ("INLET RL", "OVERFLOW RL", "OUTLET RL"))
    m = get(nothing, "RWT_LEVELS_IN_BODY")
    assert m["status"] == "NOT EVALUATED" and "TANK BASE RL" in m["message"] and "TANK HEIGHT" in m["message"]


# ---- 11. client and server parity --------------------------------------------------------------------------------------------------------
PARITY = json.loads((Path(__file__).parent / "fixtures" / "stage7_parity.json").read_text())


def test_server_values_match_the_shared_parity_fixture_the_browser_also_runs():
    g = PARITY["ground"]
    assert (g["origin_e"], g["origin_n"]) == (H.E0, H.N0)
    terr = terrain_from_bundle(H.bundle(z=lambda x, y: g["z0"] + g["slope_y"] * y + 0.0 * x, extent=(-10.0, 28.0, -10.0, 44.0)))
    res = check_design(SiteDesign.model_validate(PARITY["doc"]), NONE, terr)
    for x in PARITY["expected"]:
        vals = [v for v in res["values"].get(x["object"], []) if v["key"] == x["key"]]
        if "status" in x:
            assert not vals, x                                                                           # a FAIL has no depth value
            assert get(res, "PIT_DEPTH", x["object"])["status"] == x["status"]
        else:
            assert vals and vals[0]["value"] == pytest.approx(x["value"], abs=x["tol"]), x


def test_the_server_computes_the_volume_of_a_slimline_and_an_underground_tank_as_well_as_a_round_one():
    res = run(design(pt("a", "rwt", 5, 5, shape="slimline", length_m=2.0, width_m=0.8, height_m=1.8), pt("b", "rwt", 9, 5, shape="underground", length_m=3.0, width_m=1.5, height_m=1.2),
                     pt("c", "rwt", 13, 5, shape="round", diameter_m=2.0, height_m=2.0)), NONE)
    v = lambda oid: [x for x in res["values"][oid] if x["key"] == "geometric_volume_l"][0]["value"]   # noqa: E731
    assert v("a") == pytest.approx(2880.0) and v("b") == pytest.approx(5400.0) and v("c") == pytest.approx(math.pi * 2000, abs=1.0)


# ---- 12. upper case strings ------------------------------------------------------------------------------------------------------------------
def test_user_facing_strings_of_the_wall_screening_and_the_size_action_are_upper_case():
    w = SiteObject.model_validate(line("w1", "retaining_wall", [(2, 10), (12, 10)], wall_type="block"))
    r = screen_wall(w, R(**WALL_KEYS))
    assert r["status"] == "NOT EVALUATED" and r["reason"] == r["reason"].upper()
    ok = screen_wall(wall(height_m=1.2), R(**WALL_KEYS))
    assert ok["status"] == "SCREENED"
    from app.design.wall_screening import resolve_assumptions
    a, _u, _m = resolve_assumptions(wall(height_m=1.2), R(**WALL_KEYS))
    assert a.note == a.note.upper() and a.groundwater == a.groundwater.upper()
    sized = size_tank(SiteObject.model_validate(pt("t1", "rwt", 1, 1)), None, NONE, None, None)
    assert sized["message"].startswith("NOT SIZED. ENTER EACH VALUE ON THE TANK OR LOAD THE REQUIREMENT: ")


def test_new_source_files_have_no_em_or_en_dash():
    here = Path(__file__).parent.parent / "app"
    for rel in ("design/param_basis.py", "design/engine_limits.py", "design/site_design.py", "design/site_rules.py"):
        t = (here / rel).read_text(encoding="utf-8")
        assert "—" not in t and "–" not in t, rel


# ---- 13. the legacy pit alias --------------------------------------------------------------------------------------------------------------
def test_a_stored_document_that_says_pit_is_read_as_a_stormwater_pit_and_round_trips(api, terrain):
    old = {"schema": "site_design.v1", "version": 3, "objects": [{**pit("a", 5, 10, invert_rl=99.0), "type": "pit"}]}
    d = SiteDesign.model_validate(old)
    assert d.objects[0].type == "stormwater_pit"
    again = d.dump()
    assert again["objects"][0]["type"] == "stormwater_pit" and SiteDesign.model_validate(again).objects[0].type == "stormwater_pit"
    assert get(run(d, NONE, terrain), "PIT_DEPTH")["status"] == "INFO"                            # the checks treat it as a pit
    c, tmp, pid = api
    H.write_bundle(tmp, pid, H.bundle(z=SLOPE, extent=(-10.0, 28.0, -10.0, 44.0)))
    r = c.post(f"/projects/{pid}/site-design/check", content=json.dumps(old), headers={"content-type": "application/json"})
    assert r.status_code == 200 and [x for x in r.json()["checks"] if x["code"] == "PIT_DEPTH"][0]["object_type"] == "stormwater_pit"
