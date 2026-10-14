"""Stage 8 review fixes: crossings, zone of influence, verification, dates, proposal bases, route filtering. Every rule value here is a FAKE value written for the test."""
from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

import site_support as H
from app.design import service_checks as SC
from app.design import service_model as SM
from app.design.object_checks import check_design
from app.design.param_basis import Reader
from app.design.service_route import propose_sewer, _filter
from app.design.site_design import SiteDesign
from app.design.terrain_source import terrain_from_bundle
from test_stage8_services import (FULL, NONE, SLOPE, TODAY, ZR, at, bld, design, drain, line, pt, rq, rules, run, sewer_scene, svc, get, P)


@pytest.fixture(scope="module")
def terrain():
    return terrain_from_bundle(H.bundle(z=SLOPE, extent=(-10.0, 28.0, -10.0, 44.0)))


CLASH_RULES = rules(rq("sewer.min_grade_pct", 1.5, "%"), rq("sewer.min_cover_m.open_ground", 0.3, "m"), rq("sewer.inspection_opening_max_spacing_m", 6.0, "m"),
                    rq("sewer.inspection_opening_max_deflection_deg", 45.0, "deg"), rq("sewer.max_connection_depth_m", 3.0, "m"),
                    rq("util.clearance_m", 1.0, "m", service="sewer", authority="Hunter Water"), rq("util.clearance_m", 1.0, "m", service="sewer"),
                    rq("util.min_vertical_clearance_m", 0.3, "m", service="sewer", authority="Hunter Water"))


# ---------------------------------------------------------------------------------------------------------------------------------- 1 touches are not crossings
def test_a_sewer_proposal_with_an_opening_has_no_crossing_fail_between_its_links_or_with_its_main(terrain):
    out = propose_sewer(sewer_scene(), CLASH_RULES, terrain, building_id="b1", start_invert_rl=99.5, diameter_mm=100, connection={"main_id": "m1"}, grade_pct=2.0, today=TODAY)
    links = [o for o in out["objects"] if o["type"] == "sewer_drain"]
    assert len(links) == 2 and out["inspection_chainages_m"] == [5.5]                              # an inspection opening splits the run into two touching links
    bad = [c for c in out["checks"] if c["code"] in ("CLASH_CROSSING", "CLASH_HORIZONTAL") and c["status"] == "FAIL"]
    assert not bad, [(c["id"], c["message"]) for c in bad]
    # the same through a full design check of the design with the proposal applied (the main it connects to is checked too)
    full = SiteDesign.model_validate({"schema": "site_design.v1", "version": 1, "objects": [*sewer_scene().dump()["objects"], *out["objects"]]})
    res = check_design(full, CLASH_RULES, terrain, TODAY)
    assert not [c for c in res["checks"] if c["code"] in ("CLASH_CROSSING", "CLASH_HORIZONTAL") and c["status"] == "FAIL"]


def test_a_real_crossing_is_still_a_crossing_and_an_end_touch_of_another_kind_is_not_a_crossing(terrain):
    main = svc("m1", "water", [(0, 4), (18, 4)], diameter_mm=100, depth_m=0.8, depth_reference="top")
    through = drain("d1", pts=((9, 12), (9, -3)), up=99.9, down=99.5, dia=100)                    # passes through the interior of the main
    r = rules(rq("util.min_vertical_clearance_m", 0.3, "m", service="water", authority="Hunter Water"))
    assert [c for c in run(design(main, through), r, terrain)["checks"] if c["code"] == "CLASH_CROSSING"]
    ends = drain("d1", pts=((9, 12), (9, 4)), up=99.9, down=99.5, dia=100)                        # ends ON the water main (a different kind): a touch, judged horizontally
    res = run(design(main, ends), r, terrain)
    assert not [c for c in res["checks"] if c["code"] == "CLASH_CROSSING"]
    assert not SC.interiors_cross(*[__import__("shapely.geometry", fromlist=["LineString"]).LineString(p) for p in ([(0, 0), (1, 0)], [(1, 0), (2, 0)])])


# ---------------------------------------------------------------------------------------------------------------------------------- 2 the drain's own building
def test_zone_of_influence_skips_the_building_the_drain_leaves(terrain):
    house = bld("b1", [(4, 8), (14, 8), (14, 18), (4, 18)], sewer=[(9, 8)], building_use="house", footing_depth_m=0.5)
    other = bld("b2", [(10, 0), (16, 0), (16, 6), (10, 6)], building_use="house", footing_depth_m=0.5)
    d = drain("d1", pts=((9, 8), (9, 0)), up=99.9, down=99.5, building_id="b1")
    res = run(design(house, other, d), ZR, terrain)
    own = [c for c in res["checks"] if c["code"] == "ZONE_OF_INFLUENCE" and c["object_id"] == "b1"]
    assert not own, own
    assert [c for c in res["checks"] if c["code"] == "ZONE_OF_INFLUENCE" and c["object_id"] == "b2"]       # another building is still checked
    unlinked = drain("d1", pts=((9, 8), (9, 0)), up=99.9, down=99.5)
    assert [c for c in run(design(house, unlinked), ZR, terrain)["checks"] if c["code"] == "ZONE_OF_INFLUENCE" and c["object_id"] == "b1"]       # no link: the building is checked


# ---------------------------------------------------------------------------------------------------------------------------------- 12 proposed against proposed
def test_two_proposed_lines_with_no_resolved_clearance_say_not_evaluated_and_name_the_key(terrain):
    sew = drain("d1", pts=((2, 20), (2, 2)), up=99.9, down=99.5)
    wat = line("w1", "water_service", [(3, 20), (3, 2)], diameter_mm=25, cover_m=0.6)
    res = run(design(sew, wat), NONE, terrain)
    ne = [c for c in res["checks"] if c["code"] == "CLASH_HORIZONTAL" and c["status"] == "NOT EVALUATED"]
    assert ne and "util.clearance_m" in ne[0]["message"] and "SEWER" in ne[0]["message"] and "WATER" in ne[0]["message"]
    r = rules(rq("util.clearance_m", 1.5, "m", service="sewer"), rq("util.clearance_m", 1.0, "m", service="water"))
    got = [c for c in run(design(sew, wat), r, terrain)["checks"] if c["code"] == "CLASH_HORIZONTAL"]
    assert got and got[0]["status"] == "FAIL" and not [c for c in got if c["status"] == "NOT EVALUATED"]      # resolved: judged (1 m apart, 1.5 m needed)
    half = rules(rq("util.clearance_m", 1.5, "m", service="sewer"))
    assert [c for c in run(design(sew, wat), half, terrain)["checks"] if c["code"] == "CLASH_HORIZONTAL" and c["status"] == "NOT EVALUATED"]      # one kind unresolved: not judged on part of it


# ---------------------------------------------------------------------------------------------------------------------------------- 13 exact id matching
def test_route_check_filter_matches_ids_exactly_not_by_substring():
    checks = [{"id": "x:CLASH_CROSSING:sewer_1", "object_id": "x"}, {"id": "x:CLASH_CROSSING:sewer_10", "object_id": "x"}, {"id": "sewer_1:DRAIN_GRADE", "object_id": "sewer_1"},
              {"id": "sewer_10:DRAIN_GRADE", "object_id": "sewer_10"}, {"id": "y:ZONE_OF_INFLUENCE:sewer_1", "object_id": "y"}]
    got = [c["id"] for c in _filter(checks, {"sewer_1"})]
    assert got == ["x:CLASH_CROSSING:sewer_1", "sewer_1:DRAIN_GRADE", "y:ZONE_OF_INFLUENCE:sewer_1"]


# ---------------------------------------------------------------------------------------------------------------------------------- 5 today in Sydney
def test_today_is_the_sydney_date_not_the_utc_or_server_date(monkeypatch):
    assert SM.today_local(datetime(2026, 10, 14, 23, 30, tzinfo=timezone.utc)) == date(2026, 10, 15)         # 10:30 on 15/10 in Sydney (daylight saving)
    assert SM.today_local(datetime(2026, 10, 15, 13, 30, tzinfo=timezone.utc)) == date(2026, 10, 16)
    assert SM.today_local(datetime(2026, 7, 14, 13, 30, tzinfo=timezone.utc)) == date(2026, 7, 14)           # 23:30 on 14/07 (standard time, UTC+10)
    expiring = design(svc("s1", "sewer", [(0, -3), (18, -3)], plan_expiry_date="2026-10-15"))
    monkeypatch.setattr(SM, "_utcnow", lambda: datetime(2026, 10, 14, 23, 30, tzinfo=timezone.utc))
    assert get(check_design(expiring, NONE, None), "SVC_PLAN_EXPIRY")["status"] == "PASS"                   # 15/10 in Sydney: valid up to and including today
    monkeypatch.setattr(SM, "_utcnow", lambda: datetime(2026, 10, 15, 14, 30, tzinfo=timezone.utc))
    c = get(check_design(expiring, NONE, None), "SVC_PLAN_EXPIRY")
    assert c["status"] == "FAIL" and "16/10/2026" in c["message"]                                            # 16/10 in Sydney: expired


# ---------------------------------------------------------------------------------------------------------------------------------- 4 verification server side
def stored_verified():
    return design(svc("s1", "water", [(0, 4), (18, 4)], diameter_mm=100, depth_m=1.2, depth_reference="top", material="PVC"))


def edited(**kw):
    return design(svc("s1", "water", kw.pop("pts", [(0, 4), (18, 4)]), diameter_mm=kw.pop("diameter_mm", 100), depth_m=kw.pop("depth_m", 1.2), depth_reference=kw.pop("depth_reference", "top"),
                      material=kw.pop("material", "PVC"), **kw))


@pytest.mark.parametrize("change", [dict(pts=[(0, 4), (18, 4.5)]), dict(depth_m=1.3), dict(depth_reference="invert"), dict(owner="Other Water"), dict(diameter_mm=150), dict(material="DICL")])
def test_a_save_that_changes_a_verified_service_clears_its_verification(change):
    new, cleared = SM.enforce_verification(edited(**change), stored_verified())
    o = new.objects[0]
    assert cleared == ["s1"] and o.verified is False and o.verified_on is None and "verified_by" not in o.params
    assert any(i.message.startswith("VERIFICATION CLEARED BY EDIT") for i in o.issues)
    SiteDesign.model_validate(new.dump())


def test_unchanged_or_unrelated_edits_keep_the_verification_and_verified_by_is_locked():
    same, cleared = SM.enforce_verification(edited(), stored_verified())
    assert cleared == [] and same.objects[0].verified is True
    tol = design(svc("s1", "water", [(0, 4), (18, 4)], diameter_mm=100, depth_m=1.2, depth_reference="top", material="PVC", position_tolerance_m=0.9))
    assert SM.enforce_verification(tol, stored_verified())[1] == []                                              # tolerance is not one of the verified facts
    other_by = edited()
    other_by.objects[0].params["verified_by"] = SiteDesign.model_validate({"schema": "site_design.v1", "objects": [svc("z", "water", [(0, 0), (1, 1)])]}).objects[0].params["verified_by"].model_copy(update={"value": "Someone Else"})
    with pytest.raises(SM.VerifiedByLocked):
        SM.enforce_verification(other_by, stored_verified())
    fresh = SM.enforce_verification(edited(depth_m=9.0), design())                                                # nothing stored: a new verified service arrives as sent
    assert fresh[1] == [] and fresh[0].objects[0].verified is True


# ---------------------------------------------------------------------------------------------------------------------------------- 11 bases
def with_basis(basis, ref=None, key="diameter_mm", value=100):
    o = svc("s1", "water", [(0, 4), (18, 4)], verified=False)
    o["params"][key] = {"value": value, "basis": basis, **({"ref": ref} if ref else {})}
    return design(o).objects[0]


def test_plan_indicated_values_are_read_with_their_own_basis_where_allowed_only():
    rd = Reader(NONE)
    r = rd.read(with_basis("plan_indicated", "DBYD PLAN PARSE"), "diameter_mm")
    assert r.value == 100 and r.basis == "PLAN INDICATED" and r.ref == "DBYD PLAN PARSE"
    with pytest.raises(ValueError):
        with_basis("plan_indicated", "x", key="position_tolerance_m", value=0.3)                              # the model refuses it where a check does not allow it
    sv = SM.read_service(with_basis("plan_indicated", "x"), rd)
    assert sv.dia_mm == 100


def test_derived_values_need_the_requirement_they_were_derived_from():
    o = line("d1", "sewer_drain", [(2, 20), (2, 2)], diameter_mm=100, upstream_invert_rl={"value": 99.9, "basis": "derived", "ref": "sewer.min_grade_pct"},
             downstream_invert_rl={"value": 99.5, "basis": "derived", "ref": "sewer.min_grade_pct"})
    obj = design(o).objects[0]
    ok = Reader(rules(rq("sewer.min_grade_pct", 1.5, "%"))).read(obj, "upstream_invert_rl")
    assert ok.value == 99.9 and ok.basis == "DERIVED" and ok.ref == "sewer.min_grade_pct"
    no = Reader(NONE).read(obj, "upstream_invert_rl")
    assert no.value is None and "DERIVED" in no.why
    with pytest.raises(ValueError):
        design(line("d1", "sewer_drain", [(2, 20), (2, 2)], diameter_mm=100, upstream_invert_rl={"value": 99.9, "basis": "derived"}))             # no key to derive from
    with pytest.raises(ValueError):
        design(line("d1", "sewer_drain", [(2, 20), (2, 2)], diameter_mm={"value": 100, "basis": "derived", "ref": "sewer.min_grade_pct"}))          # not a derivable parameter


def test_proposal_inverts_from_a_rule_grade_are_derived_and_user_grade_inverts_stay_user(terrain):
    out = propose_sewer(sewer_scene(), FULL, terrain, building_id="b1", start_invert_rl=99.5, diameter_mm=100, connection={"main_id": "m1"}, today=TODAY)
    assert out["grade_basis"].startswith("MINIMUM GRADE FROM sewer.min_grade_pct")
    links = [o for o in out["objects"] if o["type"] == "sewer_drain"]
    first_up, first_down = links[0]["params"]["upstream_invert_rl"], links[0]["params"]["downstream_invert_rl"]
    assert first_up["basis"] == "user" and first_up["value"] == 99.5                                            # the start invert is the user's own entry
    for p in (first_down, links[1]["params"]["upstream_invert_rl"], links[1]["params"]["downstream_invert_rl"]):
        assert p["basis"] == "derived" and p["ref"] == "sewer.min_grade_pct"
    io = [o for o in out["objects"] if o["type"] == "service_node" and o["params"]["node_kind"]["value"] == "inspection_opening"][0]
    assert io["params"]["invert_rl"]["basis"] == "derived" and io["params"]["invert_rl"]["ref"] == "sewer.min_grade_pct"
    by_user = propose_sewer(sewer_scene(), FULL, terrain, building_id="b1", start_invert_rl=99.5, diameter_mm=100, connection={"main_id": "m1"}, grade_pct=2.0, today=TODAY)
    assert {p["basis"] for o in by_user["objects"] if o["type"] == "sewer_drain" for k, p in o["params"].items() if k.endswith("invert_rl")} == {"user"}
    # the derived values are accepted by the checks (the grade check evaluates them)
    g = [c for c in out["checks"] if c["code"] == "DRAIN_GRADE"]
    assert g and all(c["status"] == "PASS" for c in g)
    assert [c for c in run(design(*sewer_scene().dump()["objects"], *out["objects"]), NONE, terrain)["checks"] if c["code"] == "DRAIN_GRADE"][0]["status"] == "NOT EVALUATED"   # no rules: not trusted
