"""SA3 driveway / envelope / swept path tests."""
from __future__ import annotations

import math
from uuid import uuid4

import numpy as np
import pytest
from shapely import wkt as shw
from shapely.geometry import Point, Polygon

from app.agents.sa3_driveway import Sa3Driveway, Sa3DrivewayRequest
from app.agents.sa3_driveway import profile as pf
from app.agents.sa3_driveway import swept as sw
from app.agents.sa3_driveway.crossover import COUNCIL_REGISTRY, council_standard, plan_crossover
from app.agents.sa3_driveway.envelope import build_envelope
from app.agents.sa3_driveway.models import CouncilDrivewayStandard, Exclusion, SetbackRule
from app.common.contracts import LotContext

OX, OY = 334000.0, 6263000.0


def lot_from(ring, road_seqs=(1,), front=1):
    segs = []
    for i, (a, b) in enumerate(zip(ring, ring[1:] + ring[:1]), 1):
        p0, p1 = (OX + a[0], OY + a[1]), (OX + b[0], OY + b[1])
        dx, dy = p1[0] - p0[0], p1[1] - p0[1]
        segs.append(dict(seq=i, bearing_deg=math.degrees(math.atan2(dx, dy)) % 360, bearing_dms="x", distance_m=math.hypot(dx, dy),
                         adjoins="road" if i in road_seqs else "lot", is_front=i == front, start_xy=p0, end_xy=p1))
    poly = Polygon([(OX + x, OY + y) for x, y in ring])
    return LotContext(lot_id=uuid4(), jurisdiction="NSW", lotplan="1//DP1", lga_name="Testshire", mga_srid=7856,
                      area_m2_calculated=poly.area, boundary_wkt=poly.wkt, segments=segs, zone_code="R2")


def rules(front=6.0, sec=3.0, side=0.9, rear=3.0):
    mk = lambda e, v, **c: SetbackRule(rule_id=str(uuid4()), element=e, value_numeric=v, lot_condition=c)  # noqa: E731
    return [mk("front", front), mk("secondary_frontage", sec), mk("side", side), mk("rear", rear),
            mk("site_cover_max", 50), mk("height_max", 8.5)]


RECT = [(0, 0), (15, 0), (15, 30), (0, 30)]


def test_envelope_rectangle():
    lot = lot_from(RECT)
    e = build_envelope(lot, rules())
    assert e.area_m2 == pytest.approx((15 - 1.8) * (30 - 6 - 3))      # 13.2 x 21
    assert e.segment_roles == {1: "front", 2: "side", 3: "rear", 4: "side"}
    assert e.max_site_cover_pct == 50 and e.max_height_m == 8.5 and len(e.applied_rule_ids) == 5
    assert shw.loads(e.envelope_wkt).geom_type == "MultiPolygon"


def test_envelope_irregular_corner_lot_and_easement():
    # front y=0 (x 0..20); right side x=20 is the secondary road; slanted left side; skew rear
    ring = [(0, 0), (20, 0), (20, 30), (3, 28)]
    lot = lot_from(ring, road_seqs=(1, 2))
    e = build_envelope(lot, rules(front=5, sec=3, side=1, rear=2))
    assert e.segment_roles == {1: "front", 2: "secondary", 3: "rear", 4: "side"}
    # hand calc: offset lines -> vertices from line intersections
    def line(p, q, d):  # inward (left-of-direction for CCW ring) offset line  n.x = c
        t = np.subtract(q, p) / math.dist(p, q); n = np.array([-t[1], t[0]])
        return n, n @ np.array(p) + d
    def x(l1, l2): return np.linalg.solve(np.array([l1[0], l2[0]]), np.array([l1[1], l2[1]]))
    L = [line(ring[i], ring[(i + 1) % 4], d) for i, d in enumerate([5, 3, 2, 1])]
    pts = [x(L[3], L[0]), x(L[0], L[1]), x(L[1], L[2]), x(L[2], L[3])]
    exp = Polygon(pts).area
    assert e.area_m2 == pytest.approx(exp, rel=1e-6)
    # easement strip removed
    ease = "POLYGON((%f %f,%f %f,%f %f,%f %f,%f %f))" % tuple(np.array([[OX + 5, OY], [OX + 7, OY], [OX + 7, OY + 40], [OX + 5, OY + 40], [OX + 5, OY]]).ravel())
    e2 = build_envelope(lot, rules(front=5, sec=3, side=1, rear=2), easements_wkt=[ease])
    assert e2.area_m2 < e.area_m2 - 20


def test_corner_condition_rule_selection():
    lot = lot_from([(0, 0), (20, 0), (20, 30), (0, 30)], road_seqs=(1, 2))
    r = rules() + [SetbackRule(rule_id="corner", element="side", value_numeric=2.0, lot_condition={"corner_lot": True})]
    e = build_envelope(lot, r)
    assert e.setbacks_m["side"] == 2.0 and "corner" in e.applied_rule_ids


def test_upper_level_envelope():
    lot = lot_from(RECT)
    r = rules() + [SetbackRule(rule_id="u", element="side_upper", value_numeric=1.5)]
    e = build_envelope(lot, r)
    assert shw.loads(e.upper_envelope_wkt).area == pytest.approx((15 - 3) * 21)


def test_crossover_placement_and_exclusion():
    lot = lot_from([(0, 0), (20, 0), (20, 30), (0, 30)], road_seqs=(1, 2))
    std = council_standard("nowhere")
    assert std.source_label == "default (AS/NZS 2890.1) used" and COUNCIL_REGISTRY == {}
    lay = plan_crossover(lot, std, 3.0, preferred_offset_m=10.0)
    assert lay.offset_m == pytest.approx(10.0, abs=0.11)
    # right end is a corner (secondary road): >= 6 m + w/2 clearance
    lay = plan_crossover(lot, std, 3.0, preferred_offset_m=19.0)
    assert lay.offset_m <= 20 - 6 - 1.5 + 1e-6
    lay = plan_crossover(lot, std, 3.0, preferred_offset_m=0.2)
    assert lay.offset_m >= 1.0 + 1.5 - 1e-6
    # street tree at x=10 forces offset
    lay = plan_crossover(lot, std, 3.0, preferred_offset_m=10.0, exclusions=[Exclusion(xy=(OX + 10, OY - 2), clearance_m=1.5)])
    assert abs(lay.offset_m - 10.0) >= 1.5 + 1.5 - 0.15
    assert lay.inward_normal[1] > 0.99 and shw.loads(lay.crossover_wkt).area > 3.0 * 4.0


def test_council_override_width_label():
    lot = lot_from(RECT)
    c = CouncilDrivewayStandard(council_name="X", source_label="X Council DDG", min_crossover_width_m=3.5, max_grade_pct=20)
    lay = plan_crossover(lot, c, 3.5)
    assert lay.standard_label == "X Council DDG"


LEVELS_OK = dict(gutter=10.10, kerb=10.15, boundary=10.45, garage=10.90)


def stations(l, verge=4.0, depth=6.0):
    return pf.build_stations(l, verge, depth)


def test_profile_pass():
    items = pf.check_profile(stations(LEVELS_OK))
    assert all(i.passed for i in items), [i for i in items if not i.passed]


def test_profile_grade_fail_and_numbers():
    items = {i.name: i for i in pf.check_profile(stations(dict(gutter=10, kerb=10.15, boundary=10.2, garage=13.0)))}
    assert not items["max_grade"].passed and items["max_grade"].value == pytest.approx(46.67, abs=0.01)
    assert items["max_grade"].limit == 25.0


def test_change_of_grade_and_transition_lengths():
    # +30% -> -? : kerb->boundary rising 5%, boundary->garage falling -12% => summit 17% > 12.5
    items = {i.name: i for i in pf.check_profile(stations(dict(gutter=10, kerb=10, boundary=10.2, garage=9.48)))}
    ch = items["change_of_grade@boundary"]
    assert not ch.passed and ch.value == pytest.approx(17.0) and "summit" in ch.note
    assert pf.min_transition_length(17.0, "summit") == pytest.approx(17 / 12.5 * 2)
    assert pf.min_transition_length(5.0, "sag") == 2.0
    # provided transition long enough passes
    ok = pf.check_profile(stations(dict(gutter=10, kerb=10, boundary=10.2, garage=9.48)), transition_len_m=3.0)
    assert {i.name: i for i in ok}["change_of_grade@boundary"].passed


def test_scraping_summit_fails_flat_passes():
    flat = pf._interp([(0, 0.0, "a"), (10, 0.0, "b")])
    assert pf.scraping_margin(flat, 0, 10) == pytest.approx(0.10)
    # sharp crest: +15% then -15% with no transition
    crest = pf._interp([(-2, -0.3, "a"), (0, 0.0, "b"), (2, -0.3, "c")])
    assert pf.scraping_margin(crest, -2, 2) < 0


def test_swept_arc_matches_analytic():
    v = sw.VEHICLES["B85"]
    R = v.min_turn_radius
    full = sw.simulate(v, (0, 0, 0), [(2 * math.pi * R, v.max_steer)], step=0.05)
    Ro = math.hypot(R + v.width / 2, v.wheelbase + v.front_oh)
    Ri = R - v.width / 2
    c, R2, outer, inner = sw.turning_circle(v, (0, 0, 0), 1)
    assert (c[0], c[1]) == pytest.approx((0, R)) and outer == pytest.approx(Ro) and inner == pytest.approx(Ri)
    ann = Point(*c).buffer(Ro, 256).difference(Point(*c).buffer(Ri, 256))
    assert full.polygon.symmetric_difference(ann).area / ann.area < 0.02
    # sweep width
    assert Ro - Ri == pytest.approx(math.hypot(R + v.width / 2, 3.74) - R + v.width / 2)
    assert Point(*c).distance(full.polygon.exterior if hasattr(full.polygon, "exterior") else full.polygon.boundary) > 0


def test_swept_symmetry():
    v = sw.VEHICLES["B85"]
    left = sw.simulate(v, (0, 0, 0), [(8, v.max_steer)]).polygon
    right = sw.simulate(v, (0, 0, 0), [(8, -v.max_steer)]).polygon
    mirrored = shw.loads(left.wkt)
    from shapely.affinity import scale
    assert scale(mirrored, yfact=-1, origin=(0, 0)).symmetric_difference(right).area < 1e-6
    straight = sw.simulate(v, (0, 0, 0), [(10, 0)]).polygon
    assert straight.bounds == pytest.approx((-v.rear_oh, -v.width / 2, 10 + v.wheelbase + v.front_oh, v.width / 2))


def test_three_point_turn_rotates_and_park_in():
    v = sw.VEHICLES["B85"]
    t = sw.three_point_turn(v, (0, 0, 0), side=1)
    assert t.poses[-1][2] == pytest.approx(math.pi)
    p = sw.park_in_90(v, (0, 0, 0), side=1)
    assert p.poses[-1][2] == pytest.approx(-math.pi / 2)  # left lock in reverse: heading turns clockwise
    ch = sw.check_envelope(t.polygon, allowed=Polygon([(-10, -10), (10, -10), (10, 10), (-10, 10)]), obstacles=[Point(50, 50).buffer(1)])
    assert all(c.passed for c in ch)
    bad = sw.check_envelope(t.polygon, allowed=Polygon([(-1, -1), (1, -1), (1, 1), (-1, 1)]))
    assert not bad[0].passed


def make_req(**kw):
    lot = lot_from(RECT)
    base = dict(lot=lot, setback_rules=rules(), levels=LEVELS_OK, preferred_offset_m=7.5)
    base.update(kw)
    return Sa3DrivewayRequest(**base)


def test_agent_end_to_end_and_sa5_roundtrip(tmp_path):
    res = Sa3Driveway().run(make_req())
    assert res.status == "unverified" and res.driveway.council_standard_label == "default (AS/NZS 2890.1) used"
    d = res.driveway
    assert d.turning_circle_radius_m > 5.2 and d.max_grade_pct is not None
    names = {c.name for c in res.checks}
    assert {"max_grade", "b85_scraping_clearance", "swept_within_allowed_area"} <= names
    from tests.test_sa5_cad import make_request
    from app.agents.sa5_cad_dxf import Sa5CadDxf
    from app.agents.sa5_cad_dxf.model import CadRequestSa5
    base = make_request(tmp_path, formats=("dxf",)).model_dump()
    base["driveway"] = d.model_dump()
    out = Sa5CadDxf().run(CadRequestSa5(**base))
    assert out.dxf_path
