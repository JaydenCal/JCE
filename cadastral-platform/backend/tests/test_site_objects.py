"""Stage 7 site objects: key registration, the rule based checks (with fake requirement sets), NOT EVALUATED when unresolved, the platform default stamp,
the SA4 placeholder stamps, the wall screening refusal, the trench volume, pipe grade and cover on a synthetic terrain, the endpoints and a dash scan.

Local coordinates are metres from the sample lot origin (see site_support): the lot is x 0 to 18 and y 0 to 34, the street is at y below 0.
"""
from __future__ import annotations

import json
import math
import re
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import site_support as H
from app.agents.requirements.models import EXTRA_KEY_HELP, Requirement, RequirementSet, Selectors, Source
from app.agents.sa4_hydro.models import RainfallTable, RwtDemand, RwtInput
from app.agents.sa4_hydro.rwt import size_rwt
from app.api.app import create_app
from app.api.settings import Settings
from app.api.site_design import site_design_access, site_rules_dep
from app.design import object_keys as OK
from app.design import terrain_source as TS
from app.design.object_checks import CONNECT_TOL_M, check_design
from app.design.rwt_size import size_tank
from app.design.site_design import SiteDesign, SiteObject
from app.design.site_rules import SiteRules, rules_for
from app.design.terrain_source import terrain_from_bundle
from app.design.wall_screening import SCREENING_LABEL, screen_wall

E0, N0 = H.E0, H.N0
NONE = SiteRules(None)
SLOPE = lambda x, y: 100.0 + 0.05 * y + 0.0 * x           # noqa: E731  (5 percent rising away from the street)


def P(v):
    return H.user(v)


def at(x, y):
    return [E0 + x, N0 + y]


def pt(id_, type_, x, y, yaw=None, **params):
    g = {"kind": "point", "p": at(x, y)}
    if yaw is not None:
        g["yaw_deg"] = yaw
    return {"id": id_, "type": type_, "geometry": g, "params": {k: v if isinstance(v, dict) else P(v) for k, v in params.items()}}


def line(id_, type_, pts, vertex_rls=None, **params):
    o = {"id": id_, "type": type_, "geometry": {"kind": "polyline", "pts": [at(*p) for p in pts]}, "params": {k: v if isinstance(v, dict) else P(v) for k, v in params.items()}}
    if vertex_rls:
        o["vertex_rls"] = vertex_rls
    return o


def poly(id_, type_, ring, **params):
    return {"id": id_, "type": type_, "geometry": {"kind": "polygon", "ring": [at(*p) for p in ring]}, "params": {k: v if isinstance(v, dict) else P(v) for k, v in params.items()}}


def bld(id_, ring, **params):
    """A building object: a polygon footprint with the read only building block (levels, frame)."""
    o = poly(id_, "building", ring, **params)
    o["building"] = {"levels": [{"name": "GROUND", "elevation_m": 0.0, "rings": [[at(*p) for p in ring]]}], "frame": {"origin": at(0, 0)}}
    return o


def design(*objs) -> SiteDesign:
    return SiteDesign.model_validate({"schema": "site_design.v1", "version": 1, "objects": list(objs)})


@pytest.fixture(scope="module")
def terrain():
    return terrain_from_bundle(H.bundle(z=SLOPE, extent=(-10.0, 28.0, -10.0, 44.0)))


def R(**kv):
    """A fake RequirementSet: key=value pairs; the unit is the canonical unit of the key."""
    rows = []
    for k, v in kv.items():
        key = k.replace("__", ".")
        spec = OK.BY_KEY[key]
        rows.append(H.req(key, v, spec.unit if spec.kind in ("number",) else ""))
    return SiteRules(RequirementSet(requirements=rows, loaded=[Selectors(jurisdiction="NSW", lga="Testshire")]), "Testshire", "NSW")


def run(d, rules=NONE, terrain=None):
    return check_design(d, rules, terrain)


def get(res, code, oid=None):
    hits = [c for c in res["checks"] if c["code"] == code and (oid is None or c["object_id"] == oid)]
    assert hits, f"no check {code}: {[c['code'] for c in res['checks']]}"
    return hits[0]


# ---- keys ------------------------------------------------------------------------------------------------------------------------------
def test_every_key_is_registered_with_help_and_only_two_have_a_platform_default():
    for s in OK.SPECS:
        assert EXTRA_KEY_HELP.get(s.key, "").strip(), s.key
    prof = json.loads((Path(__file__).parent.parent / "knowledge" / "platform_default" / "requirements.json").read_text())
    assert {r["key"] for r in prof["requirements"]} == OK.PLATFORM_DEFAULT_KEYS == {"stormwater.osd_required", "stormwater.psd_l_s"}
    r = rules_for("Nowhere", "NSW")
    for s in OK.SPECS:
        got = r.get(s.key)
        assert got.resolved == (s.key in OK.PLATFORM_DEFAULT_KEYS), s.key


def test_new_keys_are_unresolved_in_gunnedah_except_the_three_existing_rwt_rules():
    r = rules_for("Gunnedah", "NSW")
    ok = {s.key for s in OK.SPECS if r.get(s.key).resolved}
    assert {"rwt.max_height_m.urban_zones", "rwt.location_behind_street_setback", "rwt.underground_tank_min_clearance_m"} <= ok
    assert not any(k.startswith(("retaining.", "infiltration.", "pool.", "footpath.", "tree.", "landscape.")) for k in ok)


# ---- rainwater tank ---------------------------------------------------------------------------------------------------------------------
def test_rwt_height_check_uses_the_rule_and_the_zone_note():
    d = design(pt("t1", "rwt", 10, 20, shape="round", diameter_m=2.0, height_m=3.5))
    res = run(d, R(rwt__max_height_m__urban_zones=3.2))
    c = get(res, "RWT_MAX_HEIGHT")
    assert c["status"] == "FAIL" and c["limit"] == 3.2 and c["requirements"][0]["key"] == "rwt.max_height_m.urban_zones" and "ZONE" in c["message"]
    assert get(run(design(pt("t1", "rwt", 10, 20, shape="round", diameter_m=2.0, height_m=3.0)), R(rwt__max_height_m__urban_zones=3.2)), "RWT_MAX_HEIGHT")["status"] == "PASS"


def test_rwt_checks_are_not_evaluated_when_unresolved_or_a_dimension_is_missing():
    res = run(design(pt("t1", "rwt", 10, 20, shape="round", diameter_m=2.0)), NONE)
    assert get(res, "RWT_MAX_HEIGHT")["status"] == "NOT EVALUATED" and "rwt.max_height_m" in get(res, "RWT_MAX_HEIGHT")["message"]
    assert get(res, "RWT_STREET_SETBACK")["status"] == "NOT EVALUATED" and "rwt.location_behind_street_setback" in get(res, "RWT_STREET_SETBACK")["message"]
    assert get(res, "RWT_BOUNDARY_DISTANCE")["status"] == "NOT EVALUATED"
    r2 = run(design(pt("t1", "rwt", 10, 20, shape="round", diameter_m=2.0)), R(rwt__max_height_m__urban_zones=3.2))
    assert get(r2, "RWT_MAX_HEIGHT")["message"].startswith("NOT EVALUATED") and "HEIGHT" in get(r2, "RWT_MAX_HEIGHT")["message"]


def test_rwt_behind_the_street_setback_uses_the_kerb_and_the_dwelling(terrain):
    house = bld("b1", [(4, 8), (14, 8), (14, 18), (4, 18)], building_use="house")
    rules = R(rwt__location_behind_street_setback=True)
    behind = run(design(house, pt("t1", "rwt", 10, 24, shape="round", diameter_m=1.5, height_m=2.0)), rules, terrain)
    front = run(design(house, pt("t1", "rwt", 10, 3, shape="round", diameter_m=1.5, height_m=2.0)), rules, terrain)
    assert get(behind, "RWT_STREET_SETBACK")["status"] == "PASS" and get(front, "RWT_STREET_SETBACK")["status"] == "FAIL"
    no_terrain = run(design(house, pt("t1", "rwt", 10, 24, shape="round", diameter_m=1.5, height_m=2.0)), rules, None)
    assert get(no_terrain, "RWT_STREET_SETBACK")["status"] == "NOT EVALUATED"


def test_rwt_underground_clearance_and_boundary_distance(terrain):
    svc = line("s1", "service_trace", [(0, 12), (18, 12)])
    d = design(svc, pt("t1", "rwt", 9, 12.4, shape="underground", length_m=2.0, width_m=1.0, height_m=1.5))
    rules = R(rwt__underground_tank_min_clearance_m=1.0, rwt__min_boundary_distance_m=0.45)
    res = run(d, rules, terrain)
    c = get(res, "RWT_UNDERGROUND_CLEARANCE")
    assert c["status"] == "FAIL" and c["value"] == pytest.approx(0.0, abs=1e-6)
    assert get(res, "RWT_BOUNDARY_DISTANCE")["status"] == "PASS"
    res2 = run(design(pt("t1", "rwt", 0.6, 12.4, shape="round", diameter_m=1.0, height_m=2.0)), rules, terrain)
    assert get(res2, "RWT_BOUNDARY_DISTANCE")["status"] == "FAIL"
    assert get(res2, "RWT_UNDERGROUND_CLEARANCE")["status"] == "NOT APPLICABLE"


def test_rwt_connected_roof_comes_from_the_linked_building_and_shows_its_basis():
    house = bld("b1", [(4, 8), (14, 8), (14, 18), (4, 18)], building_use="house", roof_plan_area_m2=100.0, roof_area_basis="APPROXIMATE (PLAN STUDIO RASTER)")
    ok = run(design(house, pt("t1", "rwt", 10, 24, shape="round", diameter_m=1.5, height_m=2.0, roof_building_id="b1", connected_roof_area_m2=80.0)))
    c = get(ok, "RWT_ROOF_CONNECTION")
    assert c["status"] == "INFO" and "APPROXIMATE" in c["message"] and c["value"] == pytest.approx(80.0)
    over = run(design(house, pt("t1", "rwt", 10, 24, shape="round", diameter_m=1.5, height_m=2.0, roof_building_id="b1", connected_roof_area_m2=150.0)))
    assert get(over, "RWT_ROOF_CONNECTION")["status"] == "FAIL"
    assert get(run(design(pt("t1", "rwt", 10, 24, roof_building_id="gone", connected_roof_area_m2=5.0))), "RWT_ROOF_LINK")["status"] == "FAIL"


# ---- SA4 placeholders and the size action -----------------------------------------------------------------------------------------------
RAIN = [80, 70, 60, 50, 40, 40, 40, 40, 50, 60, 70, 80]


def test_sa4_placeholder_path_still_works_and_every_placeholder_is_stamped():
    inp = RwtInput(roof_area_m2=100.0, rainfall=RainfallTable(station_id="X", monthly_mm=RAIN))
    res = size_rwt(inp)                                  # the legacy path, no requirement set
    assert res.chosen is not None and res.placeholder
    fields = {p.field for p in res.placeholders}
    assert {"runoff_coeff", "first_flush_mm", "candidate_sizes_l", "tank_height_m", "demand.occupants", "demand.toilet_l_pp_day", "demand.laundry_l_pp_day",
            "demand.garden_l_m2_day", "demand.garden_monthly_factor", "rainfall.wet_day_fraction"} <= fields
    assert all(p.stamp.startswith("PLACEHOLDER") for p in res.placeholders) and all(p.text() in res.messages for p in res.placeholders)
    assert {p.key for p in res.placeholders if p.key} <= {s.key for s in OK.SPECS}


def test_sa4_with_a_requirement_set_never_defaults_and_lists_what_is_unresolved():
    inp = RwtInput(roof_area_m2=100.0, rainfall=RainfallTable(station_id="X", monthly_mm=RAIN))
    res = size_rwt(inp, requirements=RequirementSet(), use_placeholders=False)
    assert res.chosen is None and res.placeholders == [] and {u.key for u in res.unresolved} >= {"rwt.runoff_coefficient", "rwt.first_flush_mm", "rwt.candidate_sizes_l"}


def tank_full(**over):
    p = dict(shape="round", diameter_m=2.0, height_m=2.0, connected_roof_area_m2=100.0, runoff_coefficient=0.8, first_flush_mm=2.0, occupants=3, toilet_l_pp_day=18,
             laundry_l_pp_day=20, reuse_toilet=True, reuse_laundry=True, reuse_garden=False, wet_day_fraction=0.3, water_target_pct=50.0, tank_height_m=2.0)
    p.update(over)
    return SiteObject.model_validate(pt("t1", "rwt", 10, 24, **p))


SIZE_KEYS = dict(rwt__candidate_sizes_l="2000,3000,5000", rwt__runoff_coefficient=0.8, rwt__first_flush_mm=2.0, rwt__tank_height_m=2.0, rwt__wet_day_fraction=0.3,
                 rwt__demand__occupants=3, rwt__demand__toilet_l_pp_day=18.0, rwt__demand__laundry_l_pp_day=20.0)


def test_size_action_runs_only_when_every_input_resolves():
    # nothing but the roof area, the uses and the target is entered on the tank: every other input is read from a REGISTERED REQUIREMENT KEY
    bare = SiteObject.model_validate(pt("t1", "rwt", 10, 24, connected_roof_area_m2=100.0, reuse_toilet=True, reuse_laundry=True, reuse_garden=False, water_target_pct=50.0))
    ok = size_tank(bare, None, R(**SIZE_KEYS), RAIN, "STATION 1")
    assert ok["status"] == "SIZED" and ok["placeholders"] == [] and ok["inputs"]["rainfall_basis"] == "USER" and ok["chosen"]["volume_l"] in (2000, 3000, 5000)
    cited = " ".join(ok["citations"])
    for key in ("rwt.runoff_coefficient", "rwt.first_flush_mm", "rwt.candidate_sizes_l", "rwt.tank_height_m", "rwt.demand.occupants", "rwt.demand.toilet_l_pp_day"):
        assert key in cited, key
    assert not [e for e in ok["entered"] if e["input"] in ("runoff_coefficient", "first_flush_mm", "occupants")]                 # none of them came from the tank
    # the answer follows the keys: a different runoff coefficient gives different candidate yields
    other = size_tank(bare, None, R(**{**SIZE_KEYS, "rwt__runoff_coefficient": 0.4}), RAIN, "STATION 1")
    assert other["status"] == "SIZED" and [c["annual_yield_l"] for c in other["candidates"]] != [c["annual_yield_l"] for c in ok["candidates"]]
    # a missing key is listed and nothing is sized
    part = {k: v for k, v in SIZE_KEYS.items() if k != "rwt__runoff_coefficient"}
    miss = size_tank(bare, None, R(**part), RAIN, "STATION 1")
    assert miss["status"] == "UNRESOLVED" and any(m["input"] == "rwt.runoff_coefficient" for m in miss["missing"]) and "chosen" not in miss
    # without any key the tank must carry every value itself (USER)
    assert size_tank(tank_full(), None, NONE, RAIN, "STATION 1", candidate_sizes_l=[2000, 3000, 5000])["status"] == "SIZED"
    assert size_tank(tank_full(), None, NONE, RAIN, "STATION 1")["status"] == "UNRESOLVED"
    no_rain = size_tank(tank_full(), None, NONE, None, None, candidate_sizes_l=[2000])
    assert no_rain["status"] == "UNRESOLVED" and any(m["input"] == "rainfall" for m in no_rain["missing"])
    no_uses = size_tank(SiteObject.model_validate(pt("t1", "rwt", 1, 1, connected_roof_area_m2=50.0)), None, NONE, RAIN, "S")
    assert no_uses["status"] == "UNRESOLVED" and {m["input"] for m in no_uses["missing"]} >= {"reuse_toilet", "reuse_laundry", "reuse_garden"}


# ---- retaining wall -----------------------------------------------------------------------------------------------------------------
WALL_KEYS = dict(retaining__soil_friction_angle_deg=30.0, retaining__soil_unit_weight_kn_m3=18.0, retaining__wall_friction_ratio=0.5, retaining__gravity_wall_width_ratio=0.6,
                 retaining__wall_unit_weight_kn_m3=24.0, retaining__min_fs_sliding=1.5, retaining__min_fs_overturning=2.0, retaining__surcharge_kpa=5.0)


def wall(**kw):
    return SiteObject.model_validate(line("w1", "retaining_wall", [(2, 10), (12, 10)], wall_type="block", **kw))


def test_wall_screening_refuses_without_resolved_assumptions():
    r = screen_wall(wall(height_m=1.2), NONE)
    assert r["status"] == "NOT EVALUATED" and r["label"] == SCREENING_LABEL == "SCREENING ONLY, NOT STRUCTURAL DESIGN" and r["segments"][0]["fs_sliding"] is None
    assert {m["key"] for m in r["missing"]} == {"retaining.soil_friction_angle_deg", "retaining.soil_unit_weight_kn_m3", "retaining.wall_friction_ratio",
                                                 "retaining.gravity_wall_width_ratio", "retaining.wall_unit_weight_kn_m3", "retaining.min_fs_sliding",
                                                 "retaining.min_fs_overturning", "retaining.surcharge_kpa"}
    part = R(**{k: v for k, v in WALL_KEYS.items() if k != "retaining__surcharge_kpa"})
    assert screen_wall(wall(height_m=1.2), part)["status"] == "NOT EVALUATED"


def test_wall_screening_runs_from_registered_keys_and_user_values_and_is_labelled():
    r = screen_wall(wall(height_m=1.2), R(**WALL_KEYS))
    assert r["status"] == "SCREENED" and r["structural"] is False and r["label"] == SCREENING_LABEL
    s = r["segments"][0]
    assert s["fs_sliding"] > 0 and s["fs_overturning"] > 0 and s["height_m"] == 1.2
    user_vals = {k.split("__")[1]: v for k, v in WALL_KEYS.items()}
    w = wall(height_m=1.2, **{k: v for k, v in user_vals.items() if k != "surcharge_kpa"}, surcharge_kpa=5.0)
    assert screen_wall(w, NONE)["status"] == "SCREENED" and all(u["basis"] == "USER" for u in screen_wall(w, NONE)["used"])
    # a different phi changes the result: the value comes from the key, not a built in number
    other = screen_wall(wall(height_m=1.2), R(**{**WALL_KEYS, "retaining__soil_friction_angle_deg": 20.0}))
    assert other["segments"][0]["ka"] > s["ka"]


def test_wall_heights_from_vertex_levels_and_certification_height():
    w = line("w1", "retaining_wall", [(2, 10), (7, 10), (12, 10)], wall_type="block", vertex_rls={"top": [101.0, 102.0, None], "bottom": [100.0, 100.0, 100.0]})
    res = run(design(w), R(**WALL_KEYS, retaining__certification_height_m=1.0))
    sc = get(res, "WALL_SCREENING")["screening"]
    assert sc["segments"][0]["height_m"] == 2.0 and sc["segments"][1]["height_m"] is None and sc["unscreened_segments"] == 1       # a vertex with no RL leaves the segment NOT SET
    c = get(res, "WALL_CERTIFICATION")
    assert c["status"] == "ACTION REQUIRED" and c["value"] == 2.0 and c["limit"] == 1.0
    assert get(run(design(w), NONE), "WALL_CERTIFICATION")["status"] == "NOT EVALUATED"
    assert get(run(design(w), NONE), "WALL_SCREENING")["message"].startswith("SCREENING ONLY, NOT STRUCTURAL DESIGN")


def test_wall_type_height_limit_is_a_rule_key():
    w = line("w1", "retaining_wall", [(2, 10), (12, 10)], wall_type="sleeper", height_m=1.5)
    assert get(run(design(w), R(retaining__type_max_height_m__sleeper=1.0)), "WALL_TYPE_HEIGHT")["status"] == "FAIL"
    assert get(run(design(w), NONE), "WALL_TYPE_HEIGHT")["status"] == "NOT EVALUATED"


# ---- infiltration trench ----------------------------------------------------------------------------------------------------------
def test_trench_storage_volume_is_length_width_depth_void_ratio_with_the_calculation():
    t = line("i1", "infiltration_trench", [(4, 20), (9, 20)], width_m=1.0, depth_m=1.2, void_ratio=0.35, infiltration_rate_mm_h=30, infiltration_basis="indicative")
    c = get(run(design(t)), "TRENCH_STORAGE")
    assert c["value"] == pytest.approx(5 * 1.0 * 1.2 * 0.35, abs=1e-4) and "V = L x W x D x n" in c["message"] and "2.100" in c["message"]
    assert "INDICATIVE" in get(run(design(t)), "TRENCH_RATE_BASIS")["message"]
    nv = line("i1", "infiltration_trench", [(4, 20), (9, 20)], width_m=1.0, depth_m=1.2)
    assert get(run(design(nv)), "TRENCH_STORAGE")["status"] == "NOT EVALUATED"


def test_trench_site_test_needs_its_date_and_offsets_come_from_rules(terrain):
    t = line("i1", "infiltration_trench", [(1.0, 20), (6, 20)], width_m=1.0, depth_m=1.0, void_ratio=0.3, infiltration_rate_mm_h=40, infiltration_basis="site_test", test_date="2026-03-04")
    house = bld("b1", [(4, 22), (14, 22), (14, 30), (4, 30)], building_use="house")
    rules = R(infiltration__min_offset_boundary_m=1.5, infiltration__min_offset_building_m=3.0, infiltration__min_offset_service_m=1.0)
    res = run(design(t, house), rules, terrain)
    assert "04/03/2026" in get(res, "TRENCH_RATE_BASIS")["message"]
    assert get(res, "TRENCH_OFFSET_BOUNDARY")["status"] == "FAIL" and get(res, "TRENCH_OFFSET_BUILDING")["status"] == "FAIL"
    assert get(res, "TRENCH_OFFSET_SERVICE")["status"] == "NOT EVALUATED"                     # no service in the model
    un = run(design(t, house), NONE, terrain)
    assert get(un, "TRENCH_OFFSET_BOUNDARY")["status"] == "NOT EVALUATED" and "infiltration.min_offset_boundary_m" in get(un, "TRENCH_OFFSET_BOUNDARY")["message"]
    nodate = line("i1", "infiltration_trench", [(4, 20), (9, 20)], width_m=1.0, depth_m=1.0, void_ratio=0.3, infiltration_rate_mm_h=40, infiltration_basis="site_test")
    assert get(run(design(nodate)), "TRENCH_RATE_BASIS")["status"] == "NOT EVALUATED"


# ---- OSD ---------------------------------------------------------------------------------------------------------------------------
def osd(**kw):
    return pt("o1", "osd", 9, 25, form="tank", width_m=2.0, length_m=3.0, height_m=1.5, storage_volume_m3=9.0, orifice_diameter_mm=40, orifice_invert_rl=100.0, top_water_level_rl=101.2, **kw)


def test_psd_platform_default_is_stamped_when_the_lga_has_no_value():
    res = run(design(osd()), rules_for("Nowhere", "NSW"))
    c = get(res, "OSD_PSD")
    assert c["requirements"][0]["basis"] == "PLATFORM DEFAULT" and c["requirements"][0]["stamp"].startswith("PLATFORM DEFAULT") and c["basis"] == "PLATFORM DEFAULT"
    v = [x for x in res["values"]["o1"] if x["key"] == "stormwater.psd_l_s"][0]
    assert v["basis"] == "PLATFORM DEFAULT" and v["stamp"] and v["value"] == 2.0
    # an LGA rule beats the platform default; a user value on the OSD beats both
    assert get(run(design(osd()), R(stormwater__psd_l_s=5.0)), "OSD_PSD")["basis"] == "LGA RULE"
    assert get(run(design(osd(psd_l_s=7.0))), "OSD_PSD")["basis"] == "USER"


def test_orifice_equation_is_shown_only_when_cd_resolves():
    res = run(design(osd()), rules_for("Nowhere", "NSW"))
    c = get(res, "OSD_ORIFICE")
    assert c["status"] == "NOT EVALUATED" and "stormwater.orifice_discharge_coefficient" in c["message"] and "Q = Cd" not in c["message"]
    assert not [x for x in res["values"]["o1"] if x["key"] == "orifice_q_l_s"]
    with_cd = run(design(osd()), R(stormwater__orifice_discharge_coefficient=0.6, stormwater__psd_l_s=20.0))
    c = get(with_cd, "OSD_ORIFICE")
    head = 101.2 - (100.0 + 0.020)
    q = 0.6 * math.pi * 0.04 ** 2 / 4 * math.sqrt(2 * 9.81 * head) * 1000
    assert c["status"] == "PASS" and c["value"] == pytest.approx(q, abs=1e-3) and "Q = Cd x A" in c["message"]
    user_cd = run(design(osd(discharge_coefficient=0.62)), rules_for("Nowhere", "NSW"))
    assert get(user_cd, "OSD_ORIFICE")["requirements"][0]["basis"] == "USER"
    over = run(design(osd()), R(stormwater__orifice_discharge_coefficient=0.6, stormwater__psd_l_s=1.0))
    assert get(over, "OSD_ORIFICE")["status"] == "FAIL"


def test_osd_required_without_an_osd_and_overflow_route_link():
    res = run(design(pt("t1", "tree", 5, 5)), rules_for("Nowhere", "NSW"))
    c = get(res, "OSD_REQUIRED")
    assert c["status"] == "FAIL" and c["object_id"] is None and c["requirements"][0]["stamp"]
    ov = line("r1", "overflow_route", [(9, 25), (9, 10)], osd_id="o1")
    res2 = run(design(osd(), ov), rules_for("Nowhere", "NSW"))
    assert get(res2, "OSD_OVERFLOW_ROUTE", "o1")["status"] == "PASS" and get(res2, "OSD_REQUIRED")["status"] == "PASS"
    assert get(run(design(osd(), line("r1", "overflow_route", [(9, 25), (9, 10)], osd_id="nope"))), "OVERFLOW_LINK")["status"] == "FAIL"


# ---- pits and pipes -----------------------------------------------------------------------------------------------------------------
def pit(id_, x, y, **kw):
    return pt(id_, "stormwater_pit", x, y, width_m=0.6, length_m=0.6, **kw)


def pipe(pts, **kw):
    return line("p1", "stormwater_pipe", pts, **kw)


def test_pit_depth_is_computed_from_the_terrain(terrain):
    res = run(design(pit("a", 5, 10, invert_rl=99.0)), NONE, terrain)
    assert get(res, "PIT_DEPTH")["value"] == pytest.approx(100.5 - 99.0, abs=0.01)
    assert get(run(design(pit("a", 5, 10, invert_rl=99.0)), NONE, None), "PIT_DEPTH")["status"] == "NOT EVALUATED"


def test_pipe_grade_and_cover_on_a_synthetic_terrain(terrain):
    # pipe along y from 10 to 30 (20 m) at x = 5: ground 100.5 to 101.5 (5 percent), inverts 99.5 to 99.1: grade 2 percent, crown = invert + 0.3
    p = pipe([(5, 10), (5, 30)], diameter_mm=300, upstream_invert_rl=99.5, downstream_invert_rl=99.1)
    d = design(pit("a", 5, 10), pit("b", 5, 30), p)
    rules = R(stormwater__min_pipe_grade_pct=1.0, stormwater__min_cover_m=0.6)
    res = run(d, rules, terrain)
    g = get(res, "PIPE_GRADE")
    assert g["value"] == pytest.approx(2.0, abs=1e-6) and g["status"] == "PASS"
    c = get(res, "PIPE_COVER")
    # cover at the upstream end: 100.5 - (99.5 + 0.3) = 0.7; the downstream end: 101.5 - (99.1 + 0.3) = 2.1; the minimum is the upstream end
    assert c["value"] == pytest.approx(0.7, abs=0.01) and c["status"] == "PASS" and c["requirements"][0]["key"] == "stormwater.min_cover_m"
    assert get(run(d, R(stormwater__min_pipe_grade_pct=3.0, stormwater__min_cover_m=0.8), terrain), "PIPE_GRADE")["status"] == "FAIL"
    assert get(run(d, R(stormwater__min_pipe_grade_pct=3.0, stormwater__min_cover_m=0.8), terrain), "PIPE_COVER")["status"] == "FAIL"
    assert get(res, "PIPE_END_PITS")["status"] == "PASS"
    wrong = pipe([(5, 10), (5, 30)], diameter_mm=300, upstream_invert_rl=99.1, downstream_invert_rl=99.5)
    assert get(run(design(pit("a", 5, 10), pit("b", 5, 30), wrong), rules, terrain), "PIPE_GRADE")["status"] == "FAIL"


def test_pipe_grade_and_cover_are_not_evaluated_without_the_rule_keys(terrain):
    p = pipe([(5, 10), (5, 30)], diameter_mm=300, upstream_invert_rl=99.5, downstream_invert_rl=99.1)
    res = run(design(pit("a", 5, 10), pit("b", 5, 30), p), NONE, terrain)
    g, c = get(res, "PIPE_GRADE"), get(res, "PIPE_COVER")
    assert g["status"] == "NOT EVALUATED" and "stormwater.min_pipe_grade_pct" in g["message"] and g["value"] == pytest.approx(2.0, abs=1e-6)
    assert c["status"] == "NOT EVALUATED" and "stormwater.min_cover_m" in c["message"] and c["value"] == pytest.approx(0.7, abs=0.01)


def test_pipe_must_end_at_pits_within_the_snap_tolerance_and_bends_follow_the_rule(terrain):
    p = pipe([(5, 10), (5, 20), (9, 24)], diameter_mm=300, upstream_invert_rl=99.5, downstream_invert_rl=99.1)
    near = pit("b", 9 + CONNECT_TOL_M / 2, 24)
    res = run(design(pit("a", 5, 10), near, p), R(stormwater__pipe_bends_at_pits_only=True), terrain)
    assert get(res, "PIPE_END_PITS")["status"] == "PASS"
    assert get(res, "PIPE_BENDS")["status"] == "FAIL" and get(res, "PIPE_BENDS")["value"] == 1
    assert get(run(design(pit("a", 5, 10), near, p), R(stormwater__pipe_bends_at_pits_only=False), terrain), "PIPE_BENDS")["status"] == "PASS"
    assert get(run(design(pit("a", 5, 10), near, p), NONE, terrain), "PIPE_BENDS")["status"] == "NOT EVALUATED"
    assert get(run(design(pit("a", 5, 10), pit("b", 9.5, 24), p), NONE, terrain), "PIPE_END_PITS")["status"] == "FAIL"
    # a bend at a pit is allowed
    assert get(run(design(pit("a", 5, 10), pit("m", 5, 20), near, p), R(stormwater__pipe_bends_at_pits_only=True), terrain), "PIPE_BENDS")["status"] == "PASS"


# ---- pool, barrier, footpath, tree, landscape -------------------------------------------------------------------------------------
def test_pool_barrier_requirements_are_unresolved_and_labelled(terrain):
    pool = poly("pl1", "pool", [(4, 15), (10, 15), (10, 21), (4, 21)], depth_m=1.5, coping_width_m=0.3, water_level_rl=100.4)
    fence = line("f1", "pool_barrier", [(2, 13), (12, 13), (12, 23), (2, 23), (2, 13)], height_m=1.2, pool_id="pl1")
    res = run(design(pool, fence), NONE, terrain)
    assert "POOL BARRIER REQUIREMENTS: SEE RULES" in get(res, "BARRIER_HEIGHT")["message"] and get(res, "BARRIER_HEIGHT")["status"] == "NOT EVALUATED"
    assert get(res, "BARRIER_SETBACK")["status"] == "NOT EVALUATED"
    ok = run(design(pool, fence), R(pool__barrier_min_height_m=1.2, pool__barrier_min_setback_m=1.0), terrain)
    assert get(ok, "BARRIER_HEIGHT")["status"] == "PASS" and get(ok, "BARRIER_SETBACK")["status"] == "PASS"
    assert get(run(design(pool, fence), R(pool__barrier_min_height_m=1.5), terrain), "BARRIER_HEIGHT")["status"] == "FAIL"
    assert get(run(design(pool), NONE, terrain), "POOL_BARRIER")["status"] == "FAIL"


def test_footpath_width_and_crossfall_from_rules_or_the_user():
    f = line("fp1", "footpath", [(2, 5), (2, 20)], width_m=0.9, crossfall_pct=3.0, impervious=True)
    res = run(design(f), R(footpath__min_width_m=1.2, footpath__max_crossfall_pct=2.5))
    assert get(res, "FOOTPATH_WIDTH")["status"] == "FAIL" and get(res, "FOOTPATH_CROSSFALL")["status"] == "FAIL"
    assert get(run(design(f), NONE), "FOOTPATH_CROSSFALL")["status"] == "NOT EVALUATED"
    nf = line("fp1", "footpath", [(2, 5), (2, 20)], width_m=1.5)
    r2 = run(design(nf), NONE)
    assert get(r2, "FOOTPATH_CROSSFALL")["message"].startswith("NOT EVALUATED") and get(r2, "FOOTPATH_SURFACE_FLAG")["status"] == "NOT EVALUATED"


def test_tree_zones_only_from_rule_keys_and_encroachment():
    tree = pt("tr1", "tree", 9, 17, status="existing", trunk_diameter_mm=500)
    tree["status"] = "existing"
    shed = bld("b2", [(11, 16), (14, 16), (14, 19), (11, 19)], building_use="shed")
    assert get(run(design(tree, shed), NONE), "TREE_ZONES")["status"] == "NOT EVALUATED"
    assert not [c for c in run(design(tree, shed), NONE)["checks"] if c["code"] == "TREE_ENCROACHMENT"]
    res = run(design(tree, shed), R(tree__tpz_dbh_multiplier=12.0, tree__srz_coefficient=2.0, tree__srz_exponent=0.5, tree__srz_min_radius_m=1.0))
    z = get(res, "TREE_ZONES")
    assert z["status"] == "INFO" and z["value"] == pytest.approx(6.0)                        # 12 x 0.5 m
    e = get(res, "TREE_ENCROACHMENT")
    assert e["object_id"] == "b2" and e["value"] == pytest.approx(2.0) and e["severity"] == "warning"
    srz = [x for x in res["values"]["tr1"] if x["key"] == "srz_radius_m"][0]
    assert srz["value"] == pytest.approx(2.0 * 0.5 ** 0.5, abs=1e-3)                                       # SRZ = c x D^e = 2 x 0.5^0.5 = 1.414 m, above the 1.0 m minimum
    prop = pt("tr2", "tree", 9, 17, trunk_diameter_mm=500)
    assert get(run(design(prop), R(tree__tpz_dbh_multiplier=12.0)), "TREE_ZONES")["status"] == "NOT APPLICABLE"


def test_landscape_runoff_behaviour_is_a_key_per_surface_kind():
    la = poly("l1", "landscape_area", [(2, 20), (8, 20), (8, 26), (2, 26)], surface_kind="gravel")
    res = run(design(la), NONE)
    assert get(res, "LANDSCAPE_RUNOFF")["status"] == "NOT EVALUATED" and "landscape.runoff_coefficient.gravel" in get(res, "LANDSCAPE_RUNOFF")["message"]
    assert [v for v in res["values"]["l1"] if v["key"] == "area_m2"][0]["value"] == pytest.approx(36.0)
    ok = run(design(la), R(landscape__runoff_coefficient__gravel=0.6))
    assert get(ok, "LANDSCAPE_RUNOFF")["requirements"][0]["value"] == 0.6


def test_summary_counts_and_dash_scan():
    res = run(design(pt("t1", "rwt", 10, 20, shape="round", diameter_m=2.0, height_m=3.5), osd(), wall(height_m=1.2) and line("w1", "retaining_wall", [(2, 10), (12, 10)], wall_type="block", height_m=1.2)),
              rules_for("Nowhere", "NSW"))
    s = res["summary"]
    assert s["total"] == len(res["checks"]) and s["blocking"] + s["warning"] + s["info"] == s["total"]
    blob = json.dumps(res, ensure_ascii=False)
    assert "—" not in blob and "–" not in blob


def test_source_files_have_no_em_or_en_dash():
    here = Path(__file__).parent.parent / "app"
    for rel in ("design/object_checks.py", "design/object_keys.py", "design/rwt_size.py", "design/wall_screening.py", "design/object_geometry.py", "design/param_basis.py"):
        t = (here / rel).read_text(encoding="utf-8")
        assert "—" not in t and "–" not in t, rel


def test_rejected_objects_are_not_checked_and_oversized_designs_are_refused():
    t = pt("t1", "rwt", 10, 20, shape="round", diameter_m=2.0, height_m=3.5)
    t["origin"], t["accepted"] = "ai_proposal", "rejected"
    assert run(design(t), R(rwt__max_height_m__urban_zones=3.2))["checks"] == [c for c in run(design(t), R(rwt__max_height_m__urban_zones=3.2))["checks"] if c["object_id"] is None]


# ---- endpoints ----------------------------------------------------------------------------------------------------------------------
@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.delenv("SCENE_BUNDLE_DIR", raising=False)
    TS.clear_cache()
    app = create_app(Settings(export_dir=str(tmp_path)), pool=object())
    app.dependency_overrides[site_design_access] = lambda: uuid.uuid4()
    app.dependency_overrides[site_rules_dep] = lambda: R(rwt__max_height_m__urban_zones=3.2)
    return TestClient(app), tmp_path, uuid.uuid4()


def test_check_endpoint_is_server_authoritative_and_works_without_terrain(api):
    c, tmp, pid = api
    doc = design(pt("t1", "rwt", 10, 20, shape="round", diameter_m=2.0, height_m=3.5)).dump()
    r = c.post(f"/projects/{pid}/site-design/check", content=json.dumps(doc), headers={"content-type": "application/json"})
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    body = r.json()
    assert body["schema"] == "site_checks.v1" and body["terrain"]["available"] is False
    assert [x for x in body["checks"] if x["code"] == "RWT_MAX_HEIGHT"][0]["status"] == "FAIL"
    H.write_bundle(tmp, pid, H.bundle(z=SLOPE, extent=(-10.0, 28.0, -10.0, 44.0)))
    b2 = c.post(f"/projects/{pid}/site-design/check", content=json.dumps(doc), headers={"content-type": "application/json"}).json()
    assert b2["terrain"]["available"] is True and b2["lot_available"] is True
    assert c.post(f"/projects/{pid}/site-design/check", content=b'{"objects": 5}', headers={"content-type": "application/json"}).status_code == 422


def test_rwt_size_endpoint_lists_unresolved_inputs(api):
    c, _tmp, pid = api
    o = tank_full().model_dump(mode="json", exclude_none=True)
    r = c.post(f"/projects/{pid}/site-design/rwt-size", json={"rwt": o, "rainfall_monthly_mm": RAIN, "rainfall_station": "S1"})
    assert r.status_code == 200 and r.json()["status"] == "UNRESOLVED"
    r2 = c.post(f"/projects/{pid}/site-design/rwt-size", json={"rwt": o, "rainfall_monthly_mm": RAIN, "rainfall_station": "S1", "candidate_sizes_l": [2000, 5000]})
    assert r2.json()["status"] == "SIZED"
    assert c.post(f"/projects/{pid}/site-design/rwt-size", json={"rwt": pt("x", "tree", 1, 1)}).status_code == 422


def test_check_endpoint_without_a_user_is_401(tmp_path):
    t = TestClient(create_app(Settings(export_dir=str(tmp_path)), pool=object()))
    assert t.post(f"/projects/{uuid.uuid4()}/site-design/check", content=b"{}").status_code == 401
