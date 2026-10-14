"""Stage 8: existing services (DBYD), the sewer drain and water service checks, the zone of influence, the clash checks and the route proposals.

Local coordinates are metres from the sample lot origin (see site_support): the lot is x 0 to 18 and y 0 to 34, the street is at y below 0. The synthetic terrain rises 5
percent away from the street: ground = 100 + 0.05 y. Every rule value in this file is a FAKE value written for the test; none is an engineering value.
"""
from __future__ import annotations

import math
import re
from datetime import date

import numpy as np
import pytest

import site_support as H
from app.agents.requirements.models import Requirement, RequirementSet, Selectors, Source
from app.design import engine_limits as EL
from app.design import service_checks as SC
from app.design import service_model as SM
from app.design import sewer_engine as ES
from app.design.object_checks import check_design
from app.design.param_basis import NO_RULES
from app.design.service_route import RouteError, propose_sewer, propose_water
from app.design.site_design import SiteDesign
from app.design.site_rules import SiteRules
from app.design.terrain_source import terrain_from_bundle

E0, N0 = H.E0, H.N0
TODAY = date(2026, 10, 15)
NONE = SiteRules(None)
SLOPE = lambda x, y: 100.0 + 0.05 * y + 0.0 * x           # noqa: E731


def ground(y: float) -> float:
    return 100.0 + 0.05 * y


def at(x, y):
    return [E0 + x, N0 + y]


def P(v, ref=None):
    return {"value": v, "basis": "user", **({"ref": ref} if ref else {})}


def rq(key: str, value, unit: str, **sel) -> Requirement:
    return Requirement(key=key, applies_to=Selectors(jurisdiction="NSW", lga="Testshire", **sel), value=value, unit=unit, status="resolved", extraction_method="table", confidence=1.0,
                       source=Source(document_title="Test Standard", authority="Testshire Council", page=1, section_ref="1", quote=f"{key} {value}"))


def rules(*rows: Requirement) -> SiteRules:
    return SiteRules(RequirementSet(requirements=list(rows), loaded=[Selectors(jurisdiction="NSW", lga="Testshire")]), "Testshire", "NSW")


def line(id_, type_, pts, **params):
    return {"id": id_, "type": type_, "geometry": {"kind": "polyline", "pts": [at(*p) for p in pts]}, "params": {k: v if isinstance(v, dict) else P(v) for k, v in params.items()}}


def pt(id_, type_, x, y, **params):
    return {"id": id_, "type": type_, "geometry": {"kind": "point", "p": at(x, y)}, "params": {k: v if isinstance(v, dict) else P(v) for k, v in params.items()}}


def bld(id_, ring, sewer=None, water=None, **params):
    o = {"id": id_, "type": "building", "geometry": {"kind": "polygon", "ring": [at(*p) for p in ring]}, "params": {k: P(v) for k, v in params.items()}}
    o["building"] = {"levels": [{"name": "GROUND", "elevation_m": 0.0, "rings": [[at(*p) for p in ring]]}], "frame": {"origin": at(0, 0)},
                     "exits": {"sewer": [at(*p) for p in (sewer or [])], "water": [at(*p) for p in (water or [])]}}
    return o


def svc(id_, kind, pts, owner="Hunter Water", verified=True, **params):
    base = {"service_kind": kind, "asset_owner": owner, "diameter_mm": 150, "depth_m": 2.5, "depth_basis": "potholed", "depth_reference": "invert", "position_tolerance_m": 0.3,
            "plan_date": "2026-09-01", "plan_expiry_date": "2026-12-01"}
    base.update(params)
    o = line(id_, "service_existing", pts, **{k: v for k, v in base.items() if v is not None})
    if verified:
        o["verified"], o["verified_on"] = True, "2026-09-05"
        o["params"]["verified_by"] = P("J Citizen")
    return o


def design(*objs) -> SiteDesign:
    return SiteDesign.model_validate({"schema": "site_design.v1", "version": 1, "objects": list(objs)})


@pytest.fixture(scope="module")
def terrain():
    return terrain_from_bundle(H.bundle(z=SLOPE, extent=(-10.0, 28.0, -10.0, 44.0)))


def run(d, r=NONE, t=None, today=TODAY):
    return check_design(d, r, t, today)


def get(res, code, oid=None):
    hits = [c for c in res["checks"] if c["code"] == code and (oid is None or c["object_id"] == oid)]
    assert hits, f"no check {code}: {[(c['code'], c['object_id']) for c in res['checks']]}"
    return hits[0]


# ---------------------------------------------------------------------------------------------------------------------------------- model and dates
def test_show_date_is_dd_mm_yyyy_and_unset_is_not_set():
    assert SM.show_date("2026-04-01") == "01/04/2026" and SM.show_date(None) == "NOT SET" and SM.show_date("not a date") == "NOT SET"


def test_plan_expiry_from_the_plan_validity_rule_and_the_date_comparison():
    r = rules(rq("dbyd.plan_validity_days", 90, "days"))
    old = design(svc("s1", "sewer", [(0, -3), (18, -3)], plan_expiry_date=None, plan_date="2026-01-01"))
    c = get(run(old, r), "SVC_PLAN_EXPIRY")                                  # 01/01/2026 plus 90 days is 01/04/2026
    assert c["status"] == "FAIL" and c["message"].startswith("PLAN EXPIRED") and "01/04/2026" in c["message"] and "15/10/2026" in c["message"]
    assert c["requirements"][0]["key"] == "dbyd.plan_validity_days"
    # valid up to and including the expiry date
    assert get(run(old, r, today=date(2026, 4, 1)), "SVC_PLAN_EXPIRY")["status"] == "PASS"
    assert get(run(old, r, today=date(2026, 4, 2)), "SVC_PLAN_EXPIRY")["status"] == "FAIL"


def test_plan_expiry_entered_on_the_object_needs_no_rule_and_missing_is_not_set():
    ok = get(run(design(svc("s1", "sewer", [(0, -3), (18, -3)], plan_expiry_date="2026-12-01"))), "SVC_PLAN_EXPIRY")
    assert ok["status"] == "PASS" and "01/12/2026" in ok["message"]
    gone = get(run(design(svc("s1", "sewer", [(0, -3), (18, -3)], plan_expiry_date="2026-10-14"))), "SVC_PLAN_EXPIRY")
    assert gone["status"] == "FAIL" and "PLAN EXPIRED" in gone["message"]
    nothing = get(run(design(svc("s1", "sewer", [(0, -3), (18, -3)], plan_expiry_date=None, plan_date=None))), "SVC_PLAN_EXPIRY")
    assert nothing["status"] == "NOT EVALUATED" and "NOT SET" in nothing["message"]
    # a plan date without a resolvable validity period is NOT SET too (nothing is assumed)
    nov = get(run(design(svc("s1", "sewer", [(0, -3), (18, -3)], plan_expiry_date=None))), "SVC_PLAN_EXPIRY")
    assert nov["status"] == "NOT EVALUATED" and "dbyd.plan_validity_days" in nov["message"]


def test_unverified_service_is_labelled_and_a_verified_one_needs_who_and_when():
    c = get(run(design(svc("s1", "sewer", [(0, -3), (18, -3)], verified=False))), "SVC_VERIFIED")
    assert c["status"] == "ACTION REQUIRED" and "UNVERIFIED, INDICATIVE ONLY" in c["message"]
    ok = get(run(design(svc("s1", "sewer", [(0, -3), (18, -3)], verified=True))), "SVC_VERIFIED")
    assert ok["status"] == "PASS" and "J CITIZEN" in ok["message"] and "05/09/2026" in ok["message"]
    bad = svc("s1", "sewer", [(0, -3), (18, -3)], verified=False)
    bad["verified"] = True
    with pytest.raises(ValueError):
        design(bad)                                                         # verified without verified_by and verified_on is refused


def test_depth_needs_a_basis_and_a_reference_and_is_never_assumed():
    s = SM.read_service(design(svc("s1", "sewer", [(0, -3), (18, -3)])).objects[0], NO_RULES)
    assert s.depth_usable and s.invert_depth() == 2.5 and s.top_depth() == pytest.approx(2.35)
    nobasis = get(run(design(svc("s1", "sewer", [(0, -3), (18, -3)], depth_basis="unknown"))), "SVC_DEPTH")
    assert nobasis["status"] == "NOT EVALUATED" and "BASIS" in nobasis["message"]
    nodepth = get(run(design(svc("s1", "sewer", [(0, -3), (18, -3)], depth_m=None))), "SVC_DEPTH")
    assert nodepth["status"] == "NOT EVALUATED" and "DEPTH DATA NOT AVAILABLE" in nodepth["message"]
    noref = get(run(design(svc("s1", "sewer", [(0, -3), (18, -3)], depth_reference=None))), "SVC_DEPTH")
    assert noref["status"] == "NOT EVALUATED" and "REFERENCE" in noref["message"]
    plan = get(run(design(svc("s1", "sewer", [(0, -3), (18, -3)], depth_basis="plan_indicated"))), "SVC_DEPTH")
    assert plan["status"] == "ACTION REQUIRED" and "PLAN INDICATED" in plan["message"]


def test_exclusion_buffer_comes_from_the_rule_for_the_kind_and_the_owner_only():
    d = design(svc("s1", "sewer", [(0, -3), (18, -3)]))
    none = get(run(d), "SVC_EXCLUSION")
    assert none["status"] == "NOT EVALUATED" and "util.clearance_m" in none["message"]
    r = rules(rq("util.clearance_m", 1.5, "m", service="sewer", authority="Hunter Water"), rq("util.clearance_m", 9.0, "m", service="sewer", authority="Another Owner"))
    got = get(run(d, r), "SVC_EXCLUSION")
    assert got["status"] == "INFO" and got["value"] == pytest.approx(1.8) and got["unit"] == "m"            # 1.5 clearance plus 0.3 tolerance; the other owner's row is not used
    no_owner = get(run(design(svc("s1", "sewer", [(0, -3), (18, -3)], owner=None)), r), "SVC_EXCLUSION")
    assert no_owner["status"] == "NOT EVALUATED" and "OWNER" in no_owner["message"]
    no_tol = get(run(design(svc("s1", "sewer", [(0, -3), (18, -3)], position_tolerance_m=None)), r), "SVC_EXCLUSION")
    assert no_tol["status"] == "NOT EVALUATED" and "TOLERANCE" in no_tol["message"]


# ---------------------------------------------------------------------------------------------------------------------------------- engine pieces
def test_cover_profile_on_a_sloping_terrain_is_terrain_minus_crown():
    g = lambda xs, ys: 100.0 + 0.05 * np.asarray(ys)                       # noqa: E731
    pts = [(9, 8), (9, -3)]
    prof = ES.cover_profile(pts, 99.5, 99.28, 100.0, g, [], [])
    assert prof.ts[0] == 0 and prof.ts[-1] == pytest.approx(11.0)
    assert prof.cover[0] == pytest.approx(100.4 - (99.5 + 0.1)) and prof.cover[-1] == pytest.approx(99.85 - (99.28 + 0.1))
    assert prof.min_cover() == pytest.approx(0.47, abs=1e-6) and set(prof.cls) == {"open_ground"}


def test_location_class_driveway_wins_over_footpath():
    from shapely.geometry import box
    assert ES.location_class(1, 1, [box(0, 0, 2, 2)], [box(0, 0, 3, 3)]) == "driveway"
    assert ES.location_class(2.5, 2.5, [box(0, 0, 2, 2)], [box(0, 0, 3, 3)]) == "footpath" and ES.location_class(5, 5, [], []) == "open_ground"


def test_inspection_chainages_only_where_the_rules_require():
    straight = [(0, 0), (30, 0)]
    assert ES.inspection_chainages(straight, None, None) == []
    assert ES.inspection_chainages(straight, 45.0, 12.0) == [10.0, 20.0]            # 30 m split into three equal parts of at most 12 m
    assert ES.inspection_chainages(straight, 45.0, 30.0) == []
    bend = [(0, 0), (10, 0), (10, 10)]
    assert ES.inspection_chainages(bend, 45.0, None) == [10.0] and ES.inspection_chainages(bend, 90.0, None) == [] and ES.inspection_chainages(bend, None, 100.0) == []


def test_link_inverts_chain_without_a_drop_at_nodes():
    inv = ES.link_inverts([10.0, 5.0], 99.0, 2.0)
    assert inv[0] == (99.0, pytest.approx(98.8)) and inv[1] == (pytest.approx(98.8), pytest.approx(98.7))


def test_route_goes_around_an_obstacle_and_is_direct_when_nothing_is_in_the_way():
    from shapely.geometry import box
    assert ES.route_around((0, 0), (10, 0), []) == [(0, 0), (10, 0)]
    r = ES.route_around((0, 0), (10, 0), [box(4, -2, 6, 2)])
    assert r is not None and len(r) == 4 and r[0] == (0, 0) and r[-1] == (10, 0)
    from shapely.geometry import LineString
    assert LineString(r).intersection(box(4.001, -1.999, 5.999, 1.999)).length == 0 and LineString(r).length < 14.2


def test_zone_half_width_formula():
    assert SC.zone_half_width(0.5, 45.0, 3.0, 1.0) == pytest.approx(0.5 + 2.0)       # 2 m above the invert at 45 degrees
    assert SC.zone_half_width(0.5, 30.0, 3.0, 1.0) == pytest.approx(0.5 + 2.0 / math.tan(math.radians(30)))
    assert SC.zone_half_width(0.5, 45.0, 3.0, 3.0) == 0.5 and SC.zone_half_width(0.5, 45.0, 3.0, 4.0) == 0.5


# ---------------------------------------------------------------------------------------------------------------------------------- sewer drain checks
def drain(id_="d1", pts=((9, 8), (9, -3)), up=99.5, down=99.28, dia=100, **kw):
    return line(id_, "sewer_drain", list(pts), diameter_mm=dia, upstream_invert_rl=up, downstream_invert_rl=down, **kw)


def test_drain_grade_cover_and_connection_depth_on_the_sloping_terrain(terrain):
    main = svc("m1", "sewer", [(0, -3), (18, -3)])
    r = rules(rq("sewer.min_grade_pct", 1.5, "%"), rq("sewer.min_cover_m.open_ground", 0.5, "m"), rq("sewer.max_connection_depth_m", 2.0, "m"))
    res = run(design(main, drain()), r, terrain)
    g = get(res, "DRAIN_GRADE", "d1")                                        # (99.5 - 99.28) / 11 = 2 percent
    assert g["status"] == "PASS" and g["value"] == pytest.approx(2.0) and g["limit"] == 1.5
    cv = get(res, "DRAIN_COVER", "d1")                                       # minimum cover 0.47 at the street end
    assert cv["status"] == "FAIL" and cv["value"] == pytest.approx(0.47, abs=1e-3) and cv["limit"] == 0.5 and "OPEN GROUND" in cv["message"]
    cd = get(res, "DRAIN_CONNECTION_DEPTH", "d1")                            # ground 99.85 minus invert 99.28
    assert cd["status"] == "PASS" and cd["limit"] == 2.0
    assert cd["value"] == pytest.approx(0.57, abs=1e-3)
    r2 = rules(rq("sewer.min_grade_pct", 2.5, "%"), rq("sewer.min_cover_m.open_ground", 0.3, "m"))
    res2 = run(design(main, drain()), r2, terrain)
    assert get(res2, "DRAIN_GRADE", "d1")["status"] == "FAIL" and get(res2, "DRAIN_COVER", "d1")["status"] == "PASS"
    assert get(res2, "DRAIN_CONNECTION_DEPTH", "d1")["status"] == "NOT EVALUATED"


def test_drain_wrong_way_and_missing_inputs_and_no_terrain(terrain):
    wrong = run(design(drain(up=99.0, down=99.4)), NONE, terrain)
    assert get(wrong, "DRAIN_GRADE")["status"] == "FAIL" and "WRONG WAY" in get(wrong, "DRAIN_GRADE")["message"]
    nodia = run(design(line("d1", "sewer_drain", [(9, 8), (9, -3)], upstream_invert_rl=99.5, downstream_invert_rl=99.28)), rules(rq("sewer.min_grade_pct", 1.0, "%")), terrain)
    assert get(nodia, "DRAIN_GRADE")["status"] == "NOT EVALUATED" and get(nodia, "DRAIN_COVER")["status"] == "NOT EVALUATED"
    noterr = run(design(drain()), rules(rq("sewer.min_cover_m.open_ground", 0.3, "m")), None)
    assert get(noterr, "DRAIN_COVER")["status"] == "NOT EVALUATED" and "TERRAIN" in get(noterr, "DRAIN_COVER")["message"]
    unres = run(design(drain()), NONE, terrain)
    c = get(unres, "DRAIN_COVER")
    assert c["status"] == "NOT EVALUATED" and "sewer.min_cover_m.open_ground" in c["message"]


def test_cover_uses_the_driveway_class_rule_under_a_driveway(terrain):
    drv = line("v1", "driveway", [(9, 12), (9, -3)], width_m=3.0)
    r = rules(rq("sewer.min_cover_m.open_ground", 0.1, "m"), rq("sewer.min_cover_m.driveway", 0.6, "m"))
    res = run(design(drv, drain()), r, terrain)
    c = get(res, "DRAIN_COVER", "d1")
    assert c["status"] == "FAIL" and "DRIVEWAY" in c["message"] and c["limit"] == 0.6


def test_inspection_openings_are_checked_against_the_spacing_and_deflection_rules(terrain):
    long_ = drain("d1", pts=((9, 30), (9, -3)), up=100.0, down=99.0)
    r = rules(rq("sewer.inspection_opening_max_spacing_m", 12.0, "m"), rq("sewer.inspection_opening_max_deflection_deg", 45.0, "deg"))
    bad = get(run(design(long_), r, terrain), "DRAIN_INSPECTION")
    assert bad["status"] == "FAIL" and "STRETCH" in bad["message"]
    node = pt("n1", "service_node", 9, 14.5, node_kind="inspection_opening")
    node2 = pt("n2", "service_node", 9, 6.5, node_kind="inspection_pit")
    # nodes at chainage 15.5 and 23.5 from the start (y = 30): the stretches are 15.5, 8 and 26.5 m; add one more to bring all under 12
    node3 = pt("n3", "service_node", 9, 22.0, node_kind="inspection_opening")
    node4 = pt("n4", "service_node", 9, 3.0, node_kind="inspection_opening")
    ok = get(run(design(long_, node, node2, node3, node4), r, terrain), "DRAIN_INSPECTION")
    assert ok["status"] == "PASS"                                           # openings at chainages 8, 15.5, 23.5 and 27 m: every stretch is under 12 m
    only = rules(rq("sewer.inspection_opening_max_spacing_m", 12.0, "m"))
    un = get(run(design(long_), only, terrain), "DRAIN_INSPECTION")
    assert un["status"] == "FAIL"                                          # the resolved spacing rule is still broken, so FAIL stands
    short = get(run(design(drain()), only, terrain), "DRAIN_INSPECTION")
    assert short["status"] == "NOT EVALUATED" and "deflection" in short["message"]
    both = get(run(design(drain()), r, terrain), "DRAIN_INSPECTION")
    assert both["status"] == "PASS"                                         # 11 m straight run


def test_deflection_without_an_opening_fails_and_with_one_passes(terrain):
    bend = line("d1", "sewer_drain", [(2, 20), (10, 20), (10, 5)], diameter_mm=100, upstream_invert_rl=99.9, downstream_invert_rl=99.5)
    r = rules(rq("sewer.inspection_opening_max_spacing_m", 40.0, "m"), rq("sewer.inspection_opening_max_deflection_deg", 45.0, "deg"))
    assert get(run(design(bend), r, terrain), "DRAIN_INSPECTION")["status"] == "FAIL"
    with_pit = pt("n1", "service_node", 10, 20, node_kind="inspection_pit")
    assert get(run(design(bend, with_pit), r, terrain), "DRAIN_INSPECTION")["status"] == "PASS"


def test_connection_node_not_verified_when_the_main_is_not_verified(terrain):
    node = pt("c1", "service_node", 9, -3, node_kind="sewer_connection", main_id="m1")
    ok = get(run(design(svc("m1", "sewer", [(0, -3), (18, -3)]), node)), "NODE_CONNECTION")
    assert ok["status"] == "PASS"
    uv = get(run(design(svc("m1", "sewer", [(0, -3), (18, -3)], verified=False), node)), "NODE_CONNECTION")
    assert uv["status"] == "ACTION REQUIRED" and "NOT VERIFIED" in uv["message"]
    free = get(run(design(pt("c1", "service_node", 9, -3, node_kind="sewer_connection"))), "NODE_CONNECTION")
    assert free["status"] == "ACTION REQUIRED" and "NOT VERIFIED" in free["message"]
    off = get(run(design(svc("m1", "sewer", [(0, -3), (18, -3)]), pt("c1", "service_node", 9, 5, node_kind="sewer_connection", main_id="m1"))), "NODE_CONNECTION")
    assert off["status"] == "FAIL"


# ---------------------------------------------------------------------------------------------------------------------------------- zone of influence
def zone_design(footing=None, tol=0.3, depth_basis="potholed"):
    main = svc("m1", "sewer", [(0, 10), (18, 10)], depth_m=3.0, depth_basis=depth_basis, position_tolerance_m=tol)
    house_params = {} if footing is None else {"footing_depth_m": footing}
    house = bld("b1", [(4, 12), (14, 12), (14, 22), (4, 22)], **house_params)         # 2 m north of the main
    return design(main, house)


ZR = rules(rq("sewer.zone_of_influence.angle_deg", 45.0, "deg"), rq("sewer.zone_of_influence.offset_m", 0.5, "m"))


def test_zone_of_influence_with_resolved_rules_uses_the_footing_depth_and_tolerance():
    res = run(zone_design(footing=1.0), ZR)
    z = get(res, "ZONE_OF_INFLUENCE", "b1")                                  # half width 0.5 + (3.0 - 1.0) / tan 45 = 2.5 plus 0.3 tolerance = 2.8; distance 2.0
    assert z["status"] == "FAIL" and z["limit"] == pytest.approx(2.8) and z["value"] == pytest.approx(2.0) and "INSIDE THE ZONE" in z["message"]
    deep = get(run(zone_design(footing=3.0), ZR), "ZONE_OF_INFLUENCE", "b1")     # at invert level the zone is the offset only: 0.5 plus 0.3 = 0.8 < 2.0
    assert deep["status"] == "PASS" and deep["limit"] == pytest.approx(0.8)
    shallow = get(run(zone_design(footing=2.6), ZR), "ZONE_OF_INFLUENCE", "b1")   # 0.5 + 0.4 + 0.3 = 1.2 < 2.0
    assert shallow["status"] == "PASS"


def test_zone_of_influence_is_not_evaluated_without_rules_footing_depth_or_depth_or_tolerance():
    assert get(run(zone_design(footing=1.0), NONE), "ZONE_OF_INFLUENCE")["status"] == "NOT EVALUATED"
    assert "sewer.zone_of_influence.angle_deg" in get(run(zone_design(footing=1.0), NONE), "ZONE_OF_INFLUENCE")["message"]
    nf = get(run(zone_design(footing=None), ZR), "ZONE_OF_INFLUENCE", "b1")
    assert nf["status"] == "NOT EVALUATED" and "FOOTING DEPTH" in nf["message"]
    nd = get(run(zone_design(footing=1.0, depth_basis="unknown"), ZR), "ZONE_OF_INFLUENCE", "b1")
    assert nd["status"] == "NOT EVALUATED" and "DEPTH" in nd["message"]
    # outside the zone but the tolerance of the main is not set: not a PASS
    far = design(svc("m1", "sewer", [(0, 10), (18, 10)], depth_m=3.0, position_tolerance_m=None), bld("b1", [(4, 30), (14, 30), (14, 33), (4, 33)], footing_depth_m=1.0))
    assert run(far, ZR)["checks"] and not [c for c in run(far, ZR)["checks"] if c["code"] == "ZONE_OF_INFLUENCE"]     # beyond the surface reach: nothing to evaluate


def test_zone_of_influence_for_a_tree_and_a_proposed_drain(terrain):
    r = rules(rq("sewer.zone_of_influence.angle_deg", 45.0, "deg"), rq("sewer.zone_of_influence.offset_m", 0.5, "m"))
    d = design(drain("d1", pts=((9, 20), (9, 2)), up=99.9, down=99.0), pt("t1", "tree", 10.0, 10.0, footing_depth_m=0.5))
    z = get(run(d, r, terrain), "ZONE_OF_INFLUENCE", "t1")
    # the invert falls 0.05 m per metre like the ground, so it is 1.1 m deep all along; zone half width 0.5 + (1.1 - 0.5) / tan 45 = 1.1 m, the tree is 1.0 m away
    assert z["status"] == "FAIL" and z["value"] == pytest.approx(1.0) and z["limit"] == pytest.approx(1.1)


# ---------------------------------------------------------------------------------------------------------------------------------- water and tank
def test_water_service_cover_and_connection(terrain):
    wmain = svc("w1", "water", [(0, -3), (18, -3)], diameter_mm=100)
    ws = line("ws1", "water_service", [(9, -3), (9, 8)], diameter_mm=25, cover_m=0.4, main_id="w1")
    r = rules(rq("water.min_cover_m", 0.6, "m"))
    res = run(design(wmain, ws), r, terrain)
    c = get(res, "WATER_COVER", "ws1")
    assert c["status"] == "FAIL" and c["limit"] == 0.6 and c["value"] == 0.4
    assert get(res, "WATER_MAIN", "ws1")["status"] == "PASS"
    assert get(res, "WATER_METER", "ws1")["status"] == "ACTION REQUIRED"
    assert get(run(design(wmain, ws), NONE, terrain), "WATER_COVER", "ws1")["status"] == "NOT EVALUATED"
    unv = svc("w1", "water", [(0, -3), (18, -3)], verified=False)
    assert get(run(design(unv, ws), r, terrain), "WATER_MAIN", "ws1")["status"] == "ACTION REQUIRED"
    free = line("ws1", "water_service", [(9, -3), (9, 8)], diameter_mm=25, cover_m=0.7)
    assert get(run(design(free), r, terrain), "WATER_MAIN", "ws1")["status"] == "ACTION REQUIRED" and "NOT VERIFIED" in get(run(design(free), r, terrain), "WATER_MAIN")["message"]


def test_rwt_with_reuse_needs_a_linked_water_service_only_where_the_rule_says_so():
    tank = pt("r1", "rwt", 10, 24, shape="round", diameter_m=1.5, height_m=2.0, reuse_toilet=True)
    ws = line("ws1", "water_service", [(9, -3), (9, 8)], diameter_mm=25, cover_m=0.7, rwt_id="r1")
    need = rules(rq("rwt.mains_backup_required", True, ""))
    assert get(run(design(tank), need), "RWT_MAINS_BACKUP", "r1")["status"] == "FAIL"
    assert get(run(design(tank, ws), need), "RWT_MAINS_BACKUP", "r1")["status"] == "PASS"
    assert get(run(design(tank), rules(rq("rwt.mains_backup_required", False, ""))), "RWT_MAINS_BACKUP", "r1")["status"] == "PASS"
    assert get(run(design(tank), NONE), "RWT_MAINS_BACKUP", "r1")["status"] == "NOT EVALUATED"
    plain = pt("r1", "rwt", 10, 24, shape="round", diameter_m=1.5, height_m=2.0)
    assert not [c for c in run(design(plain), need)["checks"] if c["code"] == "RWT_MAINS_BACKUP"]


# ---------------------------------------------------------------------------------------------------------------------------------- clash
def test_vertical_crossing_of_an_existing_main_and_a_proposed_drain(terrain):
    main = svc("m1", "water", [(0, 4), (18, 4)], diameter_mm=100, depth_m=0.8, depth_reference="top")        # top 0.8 m below ground, bottom 0.9
    dr = drain("d1", pts=((9, 12), (9, -3)), up=99.9, down=99.5, dia=100)                                      # at y 4 the invert is 99.9 - 0.4 * (8 / 15) = 99.687; ground 100.2: bottom 0.513 m deep
    r = rules(rq("util.min_vertical_clearance_m", 0.3, "m", service="water", authority="Hunter Water"))
    res = run(design(main, dr), r, terrain)
    c = get(res, "CLASH_CROSSING", "m1") if any(x["object_id"] == "m1" for x in res["checks"] if x["code"] == "CLASH_CROSSING") else get(res, "CLASH_CROSSING", "d1")
    # the drain is above the main: drain bottom 0.513, main top 0.8, gap 0.287 which is under 0.3
    assert c["status"] == "FAIL" and c["value"] == pytest.approx(0.287, abs=2e-3) and c["limit"] == 0.3
    r2 = rules(rq("util.min_vertical_clearance_m", 0.2, "m", service="water", authority="Hunter Water"))
    assert [x for x in run(design(main, dr), r2, terrain)["checks"] if x["code"] == "CLASH_CROSSING"][0]["status"] == "PASS"


def test_crossing_is_not_evaluated_where_depth_is_unknown_and_unresolved_without_the_rule(terrain):
    main = svc("m1", "water", [(0, 4), (18, 4)], depth_m=None)
    dr = drain("d1", pts=((9, 12), (9, -3)), up=99.9, down=99.5)
    res = run(design(main, dr), rules(rq("util.min_vertical_clearance_m", 0.3, "m", service="water", authority="Hunter Water")), terrain)
    c = [x for x in res["checks"] if x["code"] == "CLASH_CROSSING"][0]
    assert c["status"] == "NOT EVALUATED" and "DEPTH" in c["message"]
    known = svc("m1", "water", [(0, 4), (18, 4)], depth_m=1.5, depth_reference="top")
    un = [x for x in run(design(known, dr), NONE, terrain)["checks"] if x["code"] == "CLASH_CROSSING"][0]
    assert un["status"] == "NOT EVALUATED" and "util.min_vertical_clearance_m" in un["message"]


def test_horizontal_clearance_to_an_existing_service_and_an_object(terrain):
    main = svc("m1", "water", [(0, 4), (18, 4)], diameter_mm=100)
    house = bld("b1", [(4, 5), (14, 5), (14, 12), (4, 12)])            # 1 m from the main
    r = rules(rq("util.clearance_m", 1.5, "m", service="water", authority="Hunter Water"))
    res = run(design(main, house), r, terrain)
    c = get(res, "CLASH_OBJECT", "b1")                                  # buffer 1.5 plus 0.3 tolerance
    assert c["status"] == "FAIL" and c["limit"] == pytest.approx(1.8) and c["value"] == pytest.approx(1.0)
    far = bld("b1", [(4, 8), (14, 8), (14, 12), (4, 12)])
    assert not [x for x in run(design(main, far), r, terrain)["checks"] if x["code"] == "CLASH_OBJECT"]
    unresolved = run(design(main, house), NONE, terrain)
    assert not [x for x in unresolved["checks"] if x["code"] == "CLASH_OBJECT"]
    over = bld("b1", [(4, 2), (14, 2), (14, 12), (4, 12)])
    ov = get(run(design(main, over), rules(rq("util.clearance_m", 1.5, "m", service="water", authority="Hunter Water"), rq("util.build_over_allowed", True, "", service="water", authority="Hunter Water")), terrain), "CLASH_OBJECT", "b1")
    assert ov["status"] == "ACTION REQUIRED" and "APPROVAL" in ov["message"]
    assert get(run(design(main, over), r, terrain), "CLASH_OBJECT", "b1")["status"] == "FAIL"


# ---------------------------------------------------------------------------------------------------------------------------------- route proposals
def sewer_scene(extra=()):
    house = bld("b1", [(4, 8), (14, 8), (14, 18), (4, 18)], sewer=[(9, 8)], building_use="house")
    main = svc("m1", "sewer", [(0, -3), (18, -3)], depth_m=2.5)
    return design(house, main, *extra)


FULL = rules(rq("sewer.min_grade_pct", 1.5, "%"), rq("sewer.min_cover_m.open_ground", 0.3, "m"), rq("sewer.inspection_opening_max_spacing_m", 6.0, "m"),
             rq("sewer.inspection_opening_max_deflection_deg", 45.0, "deg"), rq("sewer.max_connection_depth_m", 3.0, "m"), rq("water.min_cover_m", 0.5, "m"))


def test_propose_sewer_straight_route_with_inverts_cover_and_connection(terrain):
    out = propose_sewer(sewer_scene(), FULL, terrain, building_id="b1", start_invert_rl=99.5, diameter_mm=100, connection={"main_id": "m1"}, grade_pct=2.0, today=TODAY)
    assert out["route"]["length_m"] == pytest.approx(11.0, abs=1e-6) and out["grade_pct"] == 2.0
    links = [o for o in out["objects"] if o["type"] == "sewer_drain"]
    nodes = [o for o in out["objects"] if o["type"] == "service_node"]
    assert len(links) == 2 and out["inspection_chainages_m"] == [5.5]                     # 11 m split into two parts of at most 6 m
    assert links[0]["params"]["upstream_invert_rl"]["value"] == 99.5 and links[0]["params"]["downstream_invert_rl"]["value"] == pytest.approx(99.39)
    assert links[1]["params"]["downstream_invert_rl"]["value"] == pytest.approx(99.28)
    assert {n["params"]["node_kind"]["value"] for n in nodes} == {"inspection_opening", "sewer_connection"}
    assert out["profile"][0]["cover_m"] == pytest.approx(100.4 - 99.6) and out["profile"][-1]["cover_m"] == pytest.approx(99.85 - 99.38)
    # the main's invert is 2.5 m below 99.85: 97.35, so the drain arrives 1.93 m above it
    assert out["connection"]["invert_rl"] == pytest.approx(97.35) and out["connection"]["status"] == "PASS" and out["connection"]["label"] == "VERIFIED"
    assert out["connection"]["arrival_invert_rl"] == pytest.approx(99.28)
    by = {c["code"]: c for c in out["checks"] if c["object_id"] == links[0]["id"]}
    assert by["DRAIN_GRADE"]["status"] == "PASS" and by["DRAIN_COVER"]["status"] == "PASS"
    SiteDesign.model_validate({"schema": "site_design.v1", "version": 1, "objects": [*sewer_scene().dump()["objects"], *out["objects"]]})        # the proposal is a valid document


def test_propose_sewer_uses_the_resolved_minimum_grade_when_none_is_given_and_sets_no_inverts_without_one(terrain):
    out = propose_sewer(sewer_scene(), FULL, terrain, building_id="b1", start_invert_rl=99.5, diameter_mm=100, connection={"main_id": "m1"}, today=TODAY)
    assert out["grade_pct"] == 1.5 and "sewer.min_grade_pct" in out["grade_basis"]
    bare = propose_sewer(sewer_scene(), NONE, terrain, building_id="b1", start_invert_rl=99.5, diameter_mm=100, connection={"main_id": "m1"}, today=TODAY)
    links = [o for o in bare["objects"] if o["type"] == "sewer_drain"]
    assert bare["grade_pct"] is None and len(links) == 1 and "upstream_invert_rl" not in links[0]["params"]       # no rule, so no openings and no inverts
    assert any("INSPECTION OPENING" in n for n in bare["notes"]) and bare["connection"]["status"] == "NOT EVALUATED"
    assert {c["status"] for c in bare["checks"] if c["code"] in ("DRAIN_GRADE", "DRAIN_COVER")} == {"NOT EVALUATED"}


def test_propose_sewer_routes_around_a_building_and_labels_an_unverified_or_user_connection(terrain):
    block = bld("b2", [(6, 2), (12, 2), (12, 5), (6, 5)])
    out = propose_sewer(sewer_scene([block]), FULL, terrain, building_id="b1", start_invert_rl=99.5, diameter_mm=100, connection={"main_id": "m1"}, grade_pct=2.0, today=TODAY)
    pts = out["route"]["pts"]
    from shapely.geometry import LineString, Polygon
    ring = Polygon([(E0 + x, N0 + y) for x, y in [(6, 2), (12, 2), (12, 5), (6, 5)]])
    assert len(pts) > 2 and LineString(pts).intersection(ring.buffer(-1e-4)).length == 0 and out["route"]["length_m"] > 11.0
    free = propose_sewer(sewer_scene(), FULL, terrain, building_id="b1", start_invert_rl=99.5, diameter_mm=100, connection={"p": at(9, -3), "invert_rl": 98.0}, grade_pct=2.0, today=TODAY)
    assert free["connection"]["label"] == "NOT VERIFIED" and free["connection"]["main_id"] is None and free["connection"]["status"] == "PASS"
    cn = [o for o in free["objects"] if o["type"] == "service_node" and o["params"]["node_kind"]["value"] == "sewer_connection"][0]
    assert "NOT VERIFIED" in cn["label"] and "main_id" not in cn["params"]
    unv = design(*sewer_scene().dump()["objects"][:1], svc("m1", "sewer", [(0, -3), (18, -3)], verified=False))
    out2 = propose_sewer(unv, FULL, terrain, building_id="b1", start_invert_rl=99.5, diameter_mm=100, connection={"main_id": "m1"}, grade_pct=2.0, today=TODAY)
    assert out2["connection"]["label"] == "NOT VERIFIED" and any("UNVERIFIED" in n for n in out2["notes"])


def test_propose_sewer_errors_are_plain_and_nothing_is_invented(terrain):
    d = sewer_scene()
    with pytest.raises(RouteError) as e:
        propose_sewer(d, FULL, terrain, building_id="nope", start_invert_rl=99.5, diameter_mm=100, connection={"main_id": "m1"})
    assert e.value.code == "NO_SUCH_BUILDING"
    nobuild = design(bld("b1", [(4, 8), (14, 8), (14, 18), (4, 18)]), svc("m1", "sewer", [(0, -3), (18, -3)]))
    with pytest.raises(RouteError) as e2:
        propose_sewer(nobuild, FULL, terrain, building_id="b1", start_invert_rl=99.5, diameter_mm=100, connection={"main_id": "m1"})
    assert e2.value.code == "NO_EXIT_POINT" and "NO SEWER EXIT POINT" in e2.value.message
    with pytest.raises(RouteError) as e3:
        propose_sewer(d, FULL, terrain, building_id="b1", start_invert_rl=99.5, diameter_mm=100, connection={})
    assert e3.value.code == "NO_CONNECTION"
    with pytest.raises(RouteError):
        propose_sewer(d, FULL, terrain, building_id="b1", start_invert_rl=float("nan"), diameter_mm=100, connection={"main_id": "m1"})
    wrongkind = design(sewer_scene().dump()["objects"][0], svc("m1", "water", [(0, -3), (18, -3)]))
    with pytest.raises(RouteError) as e4:
        propose_sewer(wrongkind, FULL, terrain, building_id="b1", start_invert_rl=99.5, diameter_mm=100, connection={"main_id": "m1"})
    assert e4.value.code == "WRONG_SERVICE_KIND"


def test_propose_water_builds_the_service_meter_and_connection_and_links_the_tank(terrain):
    house = bld("b1", [(4, 8), (14, 8), (14, 18), (4, 18)], water=[(6, 8)])
    wmain = svc("w1", "water", [(0, -3), (18, -3)], diameter_mm=100)
    tank = pt("r1", "rwt", 10, 24, shape="round", diameter_m=1.5, height_m=2.0, reuse_toilet=True)
    r = rules(rq("water.min_cover_m", 0.5, "m"), rq("rwt.mains_backup_required", True, ""))
    out = propose_water(design(house, wmain, tank), r, terrain, building_id="b1", meter_p=at(6, 3), diameter_mm=25, cover_m=0.6, connection={"main_id": "w1"}, rwt_id="r1", today=TODAY)
    ws = [o for o in out["objects"] if o["type"] == "water_service"][0]
    assert ws["params"]["main_id"]["value"] == "w1" and ws["params"]["rwt_id"]["value"] == "r1" and ws["params"]["cover_m"]["value"] == 0.6
    assert {o["params"]["node_kind"]["value"] for o in out["objects"] if o["type"] == "service_node"} == {"water_connection", "water_meter"}
    codes = {c["code"]: c["status"] for c in out["checks"]}
    assert codes["WATER_COVER"] == "PASS" and codes["WATER_MAIN"] == "PASS" and codes["WATER_METER"] == "PASS" and codes["RWT_MAINS_BACKUP"] == "PASS"
    with pytest.raises(RouteError):
        propose_water(design(house, wmain), r, terrain, building_id="b1", meter_p=at(6, 3), diameter_mm=25, cover_m=0.6, connection={"main_id": "w1"}, rwt_id="zz")
    nowater = design(bld("b1", [(4, 8), (14, 8), (14, 18), (4, 18)]), wmain)
    with pytest.raises(RouteError) as e:
        propose_water(nowater, r, terrain, building_id="b1", meter_p=at(6, 3), diameter_mm=25, cover_m=0.6, connection={"main_id": "w1"})
    assert e.value.code == "NO_EXIT_POINT"


# ---------------------------------------------------------------------------------------------------------------------------------- limits and wording
def test_engine_limits_refuse_oversized_service_sets():
    EL.check_site_design(design(*[svc(f"s{i}", "sewer", [(0, i * 0.01 - 3), (18, i * 0.01 - 3)]) for i in range(60)]))
    lines = [line(f"d{i}", "sewer_drain", [(0, 0), (1, 1)], diameter_mm=100) for i in range(400)]
    with pytest.raises(EL.EngineLimitError):                                  # 400 lines times 1400 objects is over the pair cap
        EL.check_site_design(design(*lines, *[pt(f"t{i}", "furniture", 1, 1) for i in range(1400)]))
    long_drain = line("d1", "sewer_drain", [(0, 0), (400, 0)], diameter_mm=100)
    with pytest.raises(EL.EngineLimitError):
        EL.check_site_design(design(long_drain))


def test_every_check_message_is_dash_free_and_upper_case_labels(terrain):
    d = design(svc("m1", "sewer", [(0, 10), (18, 10)], verified=False), drain(), bld("b1", [(4, 12), (14, 12), (14, 22), (4, 22)], footing_depth_m=1.0),
               line("ws1", "water_service", [(9, -3), (9, 8)], diameter_mm=25, cover_m=0.4))
    res = run(d, ZR, terrain)
    text = " ".join(f"{c['title']} {c['message']}" for c in res["checks"])
    assert "—" not in text and "–" not in text
    assert all(c["title"] == c["title"].upper() for c in res["checks"])


# ---------------------------------------------------------------------------------------------------------------------------------- routes
@pytest.fixture
def api(tmp_path, monkeypatch):
    import uuid
    from fastapi.testclient import TestClient
    from app.api.app import create_app
    from app.api.settings import Settings
    from app.api.site_design import site_design_access, site_rules_dep
    from app.design import terrain_source as TS
    monkeypatch.delenv("SCENE_BUNDLE_DIR", raising=False)
    TS.clear_cache()
    app = create_app(Settings(export_dir=str(tmp_path)), pool=object())
    app.dependency_overrides[site_design_access] = lambda: uuid.uuid4()
    app.dependency_overrides[site_rules_dep] = lambda: FULL
    pid = uuid.uuid4()
    H.write_bundle(tmp_path, pid, H.bundle(z=SLOPE, extent=(-10.0, 28.0, -10.0, 44.0)))
    return TestClient(app), pid


def test_sewer_route_endpoint_returns_objects_checks_and_plain_errors(api):
    c, pid = api
    body = {"design": sewer_scene().dump(), "building_id": "b1", "start_invert_rl": 99.5, "diameter_mm": 100, "grade_pct": 2.0, "connection": {"main_id": "m1"}}
    r = c.post(f"/projects/{pid}/site-design/sewer-route", json=body)
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    out = r.json()
    assert out["schema"] == "sewer_proposal.v1" and "NOT A CERTIFIED DESIGN" in out["label"] and out["connection"]["label"] == "VERIFIED"
    assert {x["status"] for x in out["checks"] if x["code"] == "DRAIN_GRADE"} == {"PASS"}
    bad = c.post(f"/projects/{pid}/site-design/sewer-route", json={**body, "building_id": "zz"})
    assert bad.status_code == 422 and bad.json()["code"] == "NO_SUCH_BUILDING"
    assert c.post(f"/projects/{pid}/site-design/sewer-route", json={**body, "diameter_mm": -1}).status_code == 422
    assert c.post(f"/projects/{pid}/site-design/sewer-route", json={**body, "connection": {}}).json()["code"] == "NO_CONNECTION"


def test_water_route_endpoint(api):
    c, pid = api
    house = bld("b1", [(4, 8), (14, 8), (14, 18), (4, 18)], water=[(6, 8)])
    d = design(house, svc("w1", "water", [(0, -3), (18, -3)], diameter_mm=100)).dump()
    r = c.post(f"/projects/{pid}/site-design/water-route", json={"design": d, "building_id": "b1", "meter_p": at(6, 3), "diameter_mm": 25, "cover_m": 0.6, "connection": {"main_id": "w1"}})
    assert r.status_code == 200 and r.json()["schema"] == "water_proposal.v1"
    assert {x["code"]: x["status"] for x in r.json()["checks"]}["WATER_COVER"] == "PASS"
    assert c.post(f"/projects/{pid}/site-design/water-route", json={"design": d, "building_id": "b1", "meter_p": at(6, 3), "diameter_mm": 25, "cover_m": 0, "connection": {"main_id": "w1"}}).status_code == 422
