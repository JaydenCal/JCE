"""Stage 6: the driveway object exported to the SA3/SA5 structure (DrivewayDesign) and the plan set's own long section for the same inputs.

The plan set path under test is ``sheets_ref2.ref_profile`` (sheet C410, and the checks on C400) driven by a minimal Site stand-in, with the same terrain
(the planar surface as an SA3 Tin), the same centreline, the same lot and the driveway end level as its FFL. The engine (3D model) must give the same numbers.
"""
from __future__ import annotations

import copy
import json
import uuid
from types import SimpleNamespace

import numpy as np
import pytest
from scipy.spatial import Delaunay
from shapely import wkt
from shapely.geometry import LineString, Polygon

import site_support as H
from app.agents.sa3_driveway.crossover import plan_crossover
from app.agents.sa3_driveway.models import CouncilDrivewayStandard
from app.agents.sa3_terrain.tin import Tin
from app.agents.sa5_cad_dxf.planset import sheets_ref2 as R2
from app.agents.sa6_site3d import build_scene, dumps
from app.agents.sa6_site3d.models import TinArrays
from app.common.contracts import BoundarySegment, DrivewayDesign, LotContext
from app.design.driveway_engine import driveway_profile
from app.design.driveway_export import ExportError, export_driveway
from app.design.site_design import SiteObject
from app.design.site_rules import SiteRules
from app.design.terrain_source import terrain_from_bundle

UNRES = SiteRules(None)
TOL_PCT = 0.1       # the bundle stores vertices to the mm; over the 0.5 m gutter band that is up to 0.2 percent of grade


def mga(x, y):
    return (H.E0 + x, H.N0 + y)


def rough(x, y):
    return 100 + 0.06 * y + 0.01 * x + 0.3 * np.sin(x / 3.0) * np.cos(y / 5.0)


@pytest.fixture(scope="module")
def mesh():
    """A jittered (not gridded) rough surface, triangulated once, so the engine (bundle triangles) and the plan set (SA3 Tin of the same points) see the SAME surface."""
    rng = np.random.default_rng(11)
    xs, ys = np.meshgrid(np.arange(-8.0, H.W + 8.01, 2.0), np.arange(-8.0, H.D + 8.01, 2.0))
    x, y = xs.ravel() + rng.uniform(-0.6, 0.6, xs.size), ys.ravel() + rng.uniform(-0.6, 0.6, xs.size)
    P = np.column_stack([x + H.E0, y + H.N0, rough(x, y)])
    return P, Delaunay(P[:, :2]).simplices


@pytest.fixture(scope="module")
def terrain(mesh):
    P, F = mesh
    r = H.request()
    r = r.model_copy(update=dict(existing_tin=TinArrays(vertices=[tuple(map(float, v)) for v in P], triangles=[tuple(int(i) for i in f) for f in F])))
    return terrain_from_bundle(json.loads(dumps(build_scene(r))))


def drive(pts, end, width=3.0, **kw):
    params = dict(kw)
    if width is not None:
        params["width_m"] = width
    if end is not None:
        params["end_level_rl"] = end
    return SiteObject.model_validate(H.driveway(pts, **params))


def plan_set_site(P, obj, ffl):
    """The inputs the plan set takes: lot polygon and segments (front on y = 0), the SA3 Tin of the same terrain, the centreline, the FFL."""
    lot = Polygon([mga(0, 0), mga(H.W, 0), mga(H.W, H.D), mga(0, H.D)])
    seg = lambda a, b, front: SimpleNamespace(start_xy=a, end_xy=b, is_front=front)       # noqa: E731
    segs = [seg(mga(0, 0), mga(H.W, 0), True), seg(mga(H.W, 0), mga(H.W, H.D), False), seg(mga(H.W, H.D), mga(0, H.D), False), seg(mga(0, H.D), mga(0, 0), False)]
    return SimpleNamespace(drive_cl=LineString([tuple(p) for p in obj.geometry.pts]), tin=Tin(np.asarray(P)), inp=SimpleNamespace(lot=SimpleNamespace(segments=segs), driveway=None),
                           ffl=ffl, lot=lot, crossover=None)


@pytest.fixture
def plan_set(monkeypatch):
    monkeypatch.setattr(R2, "make_xg", lambda s, reach=0.0: (None, None, None, SimpleNamespace(kerb_offset_m=4.0)))
    return R2.ref_profile


CASES = {
    "straight": ((9, -4), (9, 8), (9, 15)),
    "bent": ((6, -4), (7, 4), (12, 9), (13, 16)),
}


@pytest.mark.parametrize("name", list(CASES))
def test_engine_long_section_equals_the_plan_set_ref_profile(terrain, mesh, plan_set, name):
    pts = CASES[name]
    end = 101.2
    obj = drive(pts, end)
    prof = driveway_profile(obj, terrain, UNRES)
    ref = plan_set(plan_set_site(mesh[0], obj, end))
    assert prof["status"] == "OK" and ref is not None and ref["proposed"]
    assert prof["length_m"] == pytest.approx(ref["L"], abs=1e-3)
    assert prof["geometry"]["boundary_chainage_m"] == pytest.approx(ref["sb"], abs=1e-3) and prof["geometry"]["gutter_band_m"] == pytest.approx(ref["gw"])
    assert len(prof["stations"]) == len(ref["st"])
    for es, (t, z, _name) in zip(prof["stations"], ref["st"]):
        assert es["chainage_m"] == pytest.approx(t, abs=1e-3)
        assert es["design_rl"] == pytest.approx(z, abs=6e-3)                 # the engine rounds levels to 0.01 m
    sm = prof["samples"]
    for t, e, d in zip(sm["chainage"], sm["existing"], sm["design"]):
        assert e == pytest.approx(ref["exz"](t), abs=0.02) and d == pytest.approx(ref["design"](t), abs=0.02)
    mine = {c["id"]: c["value"] for c in prof["checks"] if c["value"] is not None}
    theirs = {c.name: c.value for c in ref["checks"] if c.value is not None}
    assert mine["max_grade"] == pytest.approx(theirs["max_grade"], abs=TOL_PCT)
    assert mine["b85_scraping_clearance"] == pytest.approx(theirs["b85_scraping_clearance"], abs=0.01)
    cg_mine = sorted(v for k, v in mine.items() if k.startswith("change_of_grade@"))
    cg_theirs = sorted(v for k, v in theirs.items() if k.startswith("change_of_grade@"))
    assert len(cg_mine) == len(cg_theirs) and cg_mine == pytest.approx(cg_theirs, abs=TOL_PCT)


def _lot_context() -> LotContext:
    return LotContext(lot_id=uuid.uuid4(), jurisdiction="NSW", lotplan="1/DP1", lga_name="Testshire", mga_srid=7856, area_m2_calculated=H.W * H.D, boundary_wkt=Polygon(
        [mga(0, 0), mga(H.W, 0), mga(H.W, H.D), mga(0, H.D)]).wkt, segments=[BoundarySegment(seq=1, bearing_deg=90.0, bearing_dms="90", distance_m=H.W, is_front=True, start_xy=mga(0, 0), end_xy=mga(H.W, 0)),
        BoundarySegment(seq=2, bearing_deg=0.0, bearing_dms="0", distance_m=H.D, start_xy=mga(H.W, 0), end_xy=mga(H.W, H.D))])


def _planner_footprint(splay: float, width: float):
    """The footprint SA3 plan_crossover builds for a crossover at x = 9 (front boundary on y = 0, verge 4 m) with a standard that gives this splay."""
    std = CouncilDrivewayStandard(council_name="t", source_label="t", max_grade_pct=None, kerb_return_splay_m=splay)
    return plan_crossover(_lot_context(), std, width, preferred_offset_m=9.0, garage_xy=mga(9, 15), kerb_to_boundary_m=4.0)


def test_the_exported_design_carries_the_object_and_the_crossover_the_planner_would_build(terrain):
    obj = drive(CASES["straight"], 101.2, width=3.6)
    prof = driveway_profile(obj, terrain, H.rules(H.req("driveway.crossover_splay_m", 0.8, "m")))
    ex = export_driveway(obj, prof)
    d = ex.design
    assert isinstance(d, DrivewayDesign) and d.width_m == 3.6 and d.design_vehicle == "B85" and d.kerb_to_boundary_user_supplied is False
    assert wkt.loads(d.centreline_wkt).equals(LineString([mga(*p) for p in CASES["straight"]]))
    assert ex.end_level_rl == pytest.approx(101.2) and ex.verge_m == pytest.approx(4.0) and ex.notes == ()
    lay = _planner_footprint(0.8, 3.6)                     # the splay is the RESOLVED requirement driveway.crossover_splay_m, not a constant of ours
    assert lay.offset_m == pytest.approx(9.0)
    assert wkt.loads(d.crossover_wkt).symmetric_difference(wkt.loads(lay.crossover_wkt)).area < 1e-6
    assert [dim[0] for dim in d.dimensions] == ["Crossover width", "Garage setback"]
    assert np.allclose(d.dimensions[0][1:], lay.dimensions[0][1:]) and np.allclose(d.dimensions[1][1:], lay.dimensions[1][1:])


def test_an_unresolved_splay_draws_no_splay_and_says_so(terrain):
    import app.design.driveway_export as X
    assert not hasattr(X, "DEFAULT_SPLAY_M")                                  # the invented 0.5 m is gone
    obj = drive(CASES["straight"], 101.2, width=3.6)
    prof = driveway_profile(obj, terrain, UNRES)
    assert prof["rules"]["driveway.crossover_splay_m"]["basis"] == "UNRESOLVED"
    ex = export_driveway(obj, prof)
    assert "CROSSOVER SPLAY UNRESOLVED" in ex.notes
    foot = wkt.loads(ex.design.crossover_wkt)
    assert foot.symmetric_difference(wkt.loads(_planner_footprint(0.0, 3.6).crossover_wkt)).area < 1e-6
    assert foot.area == pytest.approx(3.6 * 4.0, abs=1e-6)                    # a plain rectangle: the crossover width by the verge, no splay beyond the width
    assert foot.symmetric_difference(wkt.loads(_planner_footprint(0.5, 3.6).crossover_wkt)).area > 1.0      # and it is NOT the old 0.5 m splay footprint


def test_the_splay_key_is_registered_with_no_platform_default():
    from app.agents.requirements.models import EXTRA_KEY_HELP
    from app.report.knowledge import load_platform_default
    assert "driveway.crossover_splay_m" in EXTRA_KEY_HELP
    assert not any(r.get("key") == "driveway.crossover_splay_m" for r in load_platform_default())


def test_max_grade_in_the_export_is_the_steepest_grade_of_the_long_section_as_sa3_records_it(terrain):
    # SA3 agent.py: DrivewayDesign.max_grade_pct = the value of its max_grade profile check (the steepest grade), whatever limit applies
    obj = drive(CASES["straight"], 101.2)
    prof = driveway_profile(obj, terrain, UNRES)
    ex = export_driveway(obj, prof)
    steepest = max(abs(sg["grade_pct"]) for sg in prof["segments"])
    assert ex.design.max_grade_pct == pytest.approx(steepest, abs=0.02)
    assert export_driveway(obj, driveway_profile(obj, terrain, H.rules(H.req("driveway.max_grade_pct", 20.0, "%")))).design.max_grade_pct == ex.design.max_grade_pct


def test_cannot_export_what_is_not_set(terrain):
    nowidth = drive(CASES["straight"], 101.2, width=None)
    with pytest.raises(ExportError, match="WIDTH NOT SET"):
        export_driveway(nowidth, driveway_profile(nowidth, terrain, UNRES))
    obj = drive(CASES["straight"], 101.2)
    prof = driveway_profile(obj, terrain, UNRES)
    broken = copy.deepcopy(prof)
    broken["geometry"]["boundary_point"] = None
    with pytest.raises(ExportError, match="BOUNDARY POINT NOT AVAILABLE"):
        export_driveway(obj, broken)
    tree = SiteObject.model_validate({"id": "t", "type": "tree", "geometry": {"kind": "point", "p": [1, 2]}})
    with pytest.raises(ExportError):
        export_driveway(tree, prof)
    noend = drive(CASES["straight"], None)
    assert export_driveway(noend, driveway_profile(noend, terrain, UNRES)).end_level_rl is None


def test_export_is_pure(terrain):
    obj = drive(CASES["bent"], 101.2)
    prof = driveway_profile(obj, terrain, UNRES)
    before_o, before_p = obj.model_dump_json(), copy.deepcopy(prof)
    a, b = export_driveway(obj, prof), export_driveway(obj, prof)
    assert a == b and obj.model_dump_json() == before_o and prof == before_p


# ---- the kerb offset: the same source on both paths, without patching the plan set -------------------------------------------------------------
def test_engine_and_plan_set_read_the_same_kerb_offset_without_patching_the_plan_set(mesh):
    """No monkeypatch of ``make_xg``: the plan set takes its kerb offset (kerb line to front boundary) from ``crossover.default_kerb_offset_m()`` (the SA3 request
    default), and builds the gutter band and the profile stations from it. The engine measures the offset between the assumed kerb line of the 3D model and the
    lot boundary; that kerb line is built by SA6 with ``verge_depth_m``, which the pipeline takes from the same SA3 value. So the two agree when the 3D model is
    built with the SA3 default, and this test pins that: the verge, the band and the stations are equal.

    KNOWN GAP (documented, not hidden): the engine does not call ``default_kerb_offset_m()``; it trusts the bundle's kerb line. A bundle built with another
    ``verge_depth_m`` (a user supplied kerb offset, ``kerb_to_boundary_user_supplied``) gives a different engine verge than the plan set's default. The last
    assertion below shows the engine then follows the 3D model, which is the one the user sees and drags against."""
    from app.agents.sa5_cad_dxf.planset import crossover as CX
    P, F = mesh
    sa3_default = CX.default_kerb_offset_m()
    assert sa3_default is not None

    def terrain_with(verge):
        r = H.request(verge=verge)
        r = r.model_copy(update=dict(existing_tin=TinArrays(vertices=[tuple(map(float, v)) for v in P], triangles=[tuple(int(i) for i in f) for f in F])))
        return terrain_from_bundle(json.loads(dumps(build_scene(r))))
    obj = drive(CASES["straight"], 101.2)
    prof = driveway_profile(obj, terrain_with(sa3_default), UNRES)
    site = plan_set_site(P, obj, 101.2)
    xg = R2.make_xg(site)[3]                                                    # the real thing: not patched
    assert xg.kerb_offset_m == pytest.approx(sa3_default) == pytest.approx(prof["geometry"]["verge_m"], abs=1e-6)
    ref = R2.ref_profile(site)
    assert ref is not None and ref["gw"] == pytest.approx(prof["geometry"]["gutter_band_m"])
    assert [round(t, 3) for t, _z, _n in ref["st"]] == [s["chainage_m"] for s in prof["stations"]]
    other = driveway_profile(obj, terrain_with(sa3_default + 2.0), UNRES)
    assert other["geometry"]["verge_m"] == pytest.approx(sa3_default + 2.0, abs=1e-6)       # the engine follows the 3D model's kerb line
    assert R2.make_xg(site)[3].kerb_offset_m == pytest.approx(sa3_default)                   # the plan set path keeps the SA3 default: the documented gap
