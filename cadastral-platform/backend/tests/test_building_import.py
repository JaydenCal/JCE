"""Building importers (stage 5): Plan Studio, footprint entry, DXF (SA8), PDF (SA7) and POST /projects/{id}/site-design/import-building.

The Plan Studio files here are a SYNTHETIC TEST FIXTURE (an L shaped plan made by the tests, not a real design)."""
from __future__ import annotations

import copy
import io
import json
import math
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from shapely.geometry import Polygon

from app.api.app import create_app
from app.api.settings import Settings
from app.api.site_design import MAX_IMPORT_BYTES, site_design_access
from app.design import building_import as bi
from app.design.site_design import SiteObject

FIX = Path(__file__).parent / "fixtures"
WITH_EXPORT = FIX / "planstudio_synthetic.planstudio.json"
NO_EXPORT = FIX / "planstudio_synthetic.planstudio.no_export.json"
N = 30.0                       # north angle in the fixture, degrees


def raw(path: Path = NO_EXPORT) -> dict:
    return json.loads(path.read_text())


def local_of(x_mm: float, y_mm: float, north: float = N) -> tuple[float, float]:
    """Independent statement of the mapping (not the code under test): plan y is DOWN and the north arrow turns clockwise by `north`."""
    n = math.radians(north)
    return ((x_mm * math.cos(n) + y_mm * math.sin(n)) / 1000, (x_mm * math.sin(n) - y_mm * math.cos(n)) / 1000)


def area(ring) -> float:
    return Polygon(ring).area


def signed(ring) -> float:
    a = 0.0
    for i in range(len(ring)):
        (x1, y1), (x2, y2) = ring[i], ring[(i + 1) % len(ring)]
        a += x1 * y2 - x2 * y1
    return a / 2


# ---------------------------------------------------------------------------------------------------------------------------------
# Plan Studio
# ---------------------------------------------------------------------------------------------------------------------------------
def test_fixture_is_marked_synthetic():
    assert "SYNTHETIC TEST FIXTURE" in WITH_EXPORT.read_text() and "SYNTHETIC TEST FIXTURE" in NO_EXPORT.read_text()


@pytest.mark.parametrize("path", [WITH_EXPORT, NO_EXPORT], ids=["site_export", "derived"])
def test_planstudio_flip_rotation_units(path):
    pl = bi.import_planstudio(path.read_bytes(), "house.planstudio.json")
    assert pl.used_site_export is (path is WITH_EXPORT) and pl.source == "plan_studio"
    ring = pl.building.levels[0].rings[0]
    assert len(ring) == 6                                            # an L has six corners
    # every expected corner (plan mm, walls included: 100 mm half thickness) is a vertex, in metres, flipped and rotated
    for corner in [(-100, -100), (6100, -100), (6100, 5100), (3100, 5100), (3100, 8100), (-100, 8100)]:
        e, n = local_of(*corner)
        assert any(math.hypot(e - x, n - y) < 1e-6 for x, y in ring), corner
    assert signed(ring) > 0                                          # the flip reverses winding: rings are re-oriented counter clockwise
    assert area(ring) == pytest.approx(41.84, abs=1e-6)             # rotation and flip keep the area; mm -> m squared
    # handedness: with north 0 the plan is only flipped (E = x, N = -y)
    r0 = raw()
    r0["site"]["northDeg"] = 0
    p0 = bi.import_planstudio(json.dumps(r0).encode(), "h.planstudio.json")
    xs = sorted(x for x, _ in p0.building.levels[0].rings[0])
    ys = sorted(y for _, y in p0.building.levels[0].rings[0])
    assert xs[0] == pytest.approx(-0.1) and xs[-1] == pytest.approx(6.1)
    assert ys[0] == pytest.approx(-8.1) and ys[-1] == pytest.approx(0.1)       # the south leg (y = 8100 down) is at N = -8.1
    assert pl.building.north_deg == N


def test_planstudio_exit_points_and_defaults_not_invented():
    pl = bi.import_planstudio(NO_EXPORT.read_bytes(), "h.planstudio.json")
    ex = pl.building.exits
    assert ex.downpipes == [pytest.approx(list(local_of(6000, 0)))]
    assert ex.sewer == [pytest.approx(list(local_of(3000, 8000)))]
    assert ex.water == [pytest.approx(list(local_of(-400, 2000)))]
    pr = pl.building.params
    assert "ffl_rl" not in pr and "height_m" not in pr and "roof_pitch_deg" not in pr          # never invented
    assert pl.building.levels[0].elevation_m == 0.0
    text = " ".join(pl.building.notes)
    assert "Overall height is NOT SET" in text and "ffl_rl) is NOT SET" in text


def test_site_export_and_derived_paths_agree():
    a = bi.import_planstudio(WITH_EXPORT.read_bytes(), "h.json")
    b = bi.import_planstudio(NO_EXPORT.read_bytes(), "h.json")
    assert area(a.building.levels[0].rings[0]) == pytest.approx(area(b.building.levels[0].rings[0]), abs=1e-6)
    assert a.building.params["roof_plan_area_m2"].value == b.building.params["roof_plan_area_m2"].value == 54.0     # Plan Studio's own roofPlanAreaM2
    assert a.building.exits == b.building.exits
    assert area(a.building.roof_outline[0]) == pytest.approx(area(b.building.roof_outline[0]), abs=1e-6)


def test_site_export_inconsistent_with_the_project_is_ignored_and_derived():
    d = raw(WITH_EXPORT)
    d["site_export"]["levels"][0]["ffl_above_ground_floor_mm"] = 999            # the level elevation in the project is 0
    pl = bi.import_planstudio(json.dumps(d).encode(), "h.json")
    assert pl.used_site_export is False
    assert area(pl.building.levels[0].rings[0]) == pytest.approx(41.84, abs=1e-6)


def test_vectorisation_area_within_documented_tolerance():
    """A free (rotated, non axis aligned) room outline: the vectorised footprint area differs from the analytic polygon area by at most
    perimeter x raster half cell, and the Douglas-Peucker tolerance adds at most perimeter x SIMPLIFY_TOL_M."""
    d = raw()
    ang = math.radians(23)
    base = [(0, 0), (7000, 0), (7000, 4500), (0, 4500)]
    poly = [{"x": 1000 + x * math.cos(ang) - y * math.sin(ang), "y": 1000 + x * math.sin(ang) + y * math.cos(ang)} for x, y in base]
    lv = d["levels"][0]
    lv["walls"], lv["openings"], lv["furniture"], lv["stairs"] = [], [], [], []
    lv["rooms"] = [{"id": "r_free", "name": "Free", "type": "living", "status": "new", "polygon": poly}]
    d["site"]["northDeg"] = 0
    pl = bi.import_planstudio(json.dumps(d).encode(), "free.json")
    truth = 7.0 * 4.5
    perimeter = 2 * (7.0 + 4.5)
    got = area(pl.building.levels[0].rings[0])
    assert abs(got - truth) <= perimeter * (0.05 + bi.SIMPLIFY_TOL_M)
    assert bi.SIMPLIFY_TOL_M == 0.05 and bi.CELL_MM == 100


def test_courtyard_is_reported_not_exported():
    d = raw()
    lv = d["levels"][0]
    lv["walls"], lv["openings"], lv["furniture"], lv["stairs"] = [], [], [], []
    sq = lambda x, y, w, h: [{"x": x, "y": y}, {"x": x + w, "y": y}, {"x": x + w, "y": y + h}, {"x": x, "y": y + h}]     # noqa: E731
    lv["rooms"] = [{"id": f"r{i}", "name": f"R{i}", "type": "living", "status": "new", "polygon": sq(*g)} for i, g in
                   enumerate([(0, 0, 9000, 3000), (0, 6000, 9000, 3000), (0, 3000, 3000, 3000), (6000, 3000, 3000, 3000)])]
    pl = bi.import_planstudio(json.dumps(d).encode(), "court.json")
    assert len(pl.building.levels[0].rings) == 1 and area(pl.building.levels[0].rings[0]) == pytest.approx(81.0, abs=0.5)      # the outer boundary: the courtyard is not subtracted
    assert any("courtyard" in n or "hole" in n for n in pl.building.notes)


def test_roof_basis_and_missing_overhang():
    pl = bi.import_planstudio(NO_EXPORT.read_bytes(), "h.json")
    assert pl.building.params["roof_area_basis"].value == "APPROXIMATE (PLAN STUDIO RASTER)"
    assert area(pl.building.roof_outline[0]) > area(pl.building.levels[0].rings[0])         # eaves dilate the footprint
    d = raw()
    del d["levels"][0]["roof"]["overhang"]
    nz = bi.import_planstudio(json.dumps(d).encode(), "h.json")
    assert any("ROOF OVERHANG NOT IN SOURCE" in n for n in nz.building.notes)               # the overhang is used only when the source gives one
    assert nz.building.params["roof_plan_area_m2"].value == pytest.approx(30 + 9 + 0.0, abs=2.5)
    d["levels"][0]["roof"]["enabled"] = False
    off = bi.import_planstudio(json.dumps(d).encode(), "h.json")
    assert "roof_plan_area_m2" not in off.building.params and off.building.params["roof_area_basis"].value == "NOT SET"
    assert off.building.roof_outline is None


def test_overhang_rounding_matches_plan_studio_half_up():
    d = raw()
    d["levels"][0]["roof"]["overhang"] = 450                                              # JS Math.round(4.5) is 5 cells, not 4
    a = bi.import_planstudio(json.dumps(d).encode(), "h.json").building.params["roof_plan_area_m2"].value
    d["levels"][0]["roof"]["overhang"] = 500
    b = bi.import_planstudio(json.dumps(d).encode(), "h.json").building.params["roof_plan_area_m2"].value
    assert a == b == 54.0


def test_tanks_become_rwt_with_capacity_and_no_invented_levels():
    d = raw()
    d["site"]["tanks"] = [{"id": "t1", "x": 7000, "y": 2000, "capacityL": 5000, "diameter": 2300, "height": 1900, "colour": "x", "status": "new"},
                          {"id": "t2", "x": 8000, "y": 3000, "status": "demolish"}]
    pl = bi.import_planstudio(json.dumps(d).encode(), "t.json")
    assert len(pl.extras) == 1
    t = pl.extras[0]
    assert t.type == "rwt" and t.params["capacity_l"].value == 5000 and t.params["diameter_m"].value == 2.3
    assert t.p == [pytest.approx(local_of(7000, 2000)[0]), pytest.approx(local_of(7000, 2000)[1])]
    assert not ({"inlet_level_m", "overflow_level_m", "outlet_level_m"} & set(t.params))
    assert any("NOT SET" in n and "tank" in n for n in pl.building.notes)


def test_two_storeys_ascending_with_relative_elevations():
    d = raw()
    up = copy.deepcopy(d["levels"][0])
    up.update(id="l_up", name="First", elevation=2700)
    for k in ("walls", "rooms", "openings"):
        for i, e in enumerate(up[k]):
            e["id"] = f"u_{k}_{i}"
            if k == "openings":
                e["wallId"] = "none"
    up["openings"] = []
    for i, w in enumerate(up["walls"]):
        w["id"] = f"u_w_{i}"
    d["levels"].append(up)
    pl = bi.import_planstudio(json.dumps(d).encode(), "two.json")
    assert [lv.elevation_m for lv in pl.building.levels] == [0.0, 2.7] and pl.building.datum_index == 0


@pytest.mark.parametrize("mutate,code", [
    (lambda d: d.pop("schema"), "NOT_PLAN_STUDIO"),
    (lambda d: d.update(schema=99), "PS_NEWER"),
    (lambda d: d.update(levels=[]), "PS_INVALID"),
    (lambda d: d["levels"][0]["rooms"][0].update(polygon=[{"x": 0, "y": 0}]), "PS_INVALID"),
    (lambda d: d["site"].update(northDeg="north"), "PS_INVALID"),
])
def test_bad_planstudio_files_are_refused_with_422(mutate, code):
    d = raw()
    mutate(d)
    with pytest.raises(bi.ImportFailure) as ei:
        bi.import_planstudio(json.dumps(d).encode(), "bad.json")
    assert ei.value.code == code and ei.value.status == 422


def test_not_json_and_empty_plan():
    with pytest.raises(bi.ImportFailure) as ei:
        bi.import_planstudio(b"\x00\x01 not json", "x.json")
    assert ei.value.code == "NOT_JSON"
    d = raw()
    d["levels"][0].update(walls=[], rooms=[], openings=[], furniture=[], stairs=[])
    with pytest.raises(bi.ImportFailure) as ei2:
        bi.import_planstudio(json.dumps(d).encode(), "empty.json")
    assert ei2.value.code == "NO_FOOTPRINT"


def test_version_1_file_is_migrated():
    d = raw()
    d["schema"] = 1
    del d["site"]["points"]
    pl = bi.import_planstudio(json.dumps(d).encode(), "v1.json")
    assert pl.building.exits.downpipes == [] and area(pl.building.levels[0].rings[0]) == pytest.approx(41.84, abs=1e-6)


def test_payload_builds_a_valid_site_object():
    """The payload fields are exactly what place_building turns into a building object: the model accepts them."""
    pl = bi.import_planstudio(WITH_EXPORT.read_bytes(), "h.json")
    b = pl.building
    obj = {"id": "b1", "type": "building", "geometry": {"kind": "polygon", "ring": [[x, y] for x, y in b.levels[b.datum_index].rings[0]]},
           "building": {"levels": [lv.model_dump(mode="json") for lv in b.levels], "datum_index": b.datum_index,
                        "roof_outline": b.roof_outline, "exits": b.exits.model_dump(mode="json"),
                        "frame": {"origin": [0, 0], "yaw_deg": 0, "north_deg": b.north_deg}},
           "params": {k: v.model_dump(mode="json") for k, v in b.params.items()}}
    SiteObject.model_validate(obj)


PAYLOAD_GOLDEN = FIX / "building_import_planstudio.json"


def _close(a, b, path="") -> None:
    if isinstance(a, dict):
        assert isinstance(b, dict) and a.keys() == b.keys(), path
        for k in a:
            _close(a[k], b[k], f"{path}/{k}")
    elif isinstance(a, list):
        assert isinstance(b, list) and len(a) == len(b), path
        for i, (x, y) in enumerate(zip(a, b)):
            _close(x, y, f"{path}/{i}")
    elif isinstance(a, float) or isinstance(b, float):
        assert a == pytest.approx(b, abs=1e-6), path
    else:
        assert a == b, path


def test_payload_matches_the_golden_file_the_frontend_tests_use():
    """Drift check: the frontend place_building tests (frontend/tests/site/buildings.test.ts) run on this exact payload.
    UPDATE_BUILDING_PAYLOAD=1 regenerates it."""
    import os
    if os.environ.get("UPDATE_BUILDING_PAYLOAD") == "1":
        raw_t = raw(WITH_EXPORT)
        raw_t["site"]["tanks"] = [{"id": "t1", "x": 7000, "y": 2000, "capacityL": 5000, "diameter": 2300, "height": 1900, "status": "new"}]
        PAYLOAD_GOLDEN.write_text(json.dumps(bi.import_planstudio(json.dumps(raw_t).encode(), "synthetic.planstudio.json", "house").dump(), indent=2) + "\n")
    gold = json.loads(PAYLOAD_GOLDEN.read_text())
    assert gold["schema"] == "building_import.v1" and gold["source"] == "plan_studio"
    raw_t = raw(WITH_EXPORT)
    raw_t["site"]["tanks"] = [{"id": "t1", "x": 7000, "y": 2000, "capacityL": 5000, "diameter": 2300, "height": 1900, "status": "new"}]
    _close(bi.import_planstudio(json.dumps(raw_t).encode(), "synthetic.planstudio.json", "house").dump(), gold)


# ---------------------------------------------------------------------------------------------------------------------------------
# footprint entry, DXF, PDF
# ---------------------------------------------------------------------------------------------------------------------------------
def test_footprint_entry_rectangle_and_polygon():
    pl = bi.import_footprint_entry(12.0, 7.5, "shed")
    assert pl.source == "footprint_entry" and area(pl.building.levels[0].rings[0]) == pytest.approx(90.0)
    assert pl.building.params["building_use"].value == "shed"
    assert "height_m" not in pl.building.params and "ffl_rl" not in pl.building.params
    assert any("height is NOT SET" in n for n in pl.building.notes) and pl.building.params["roof_area_basis"].value == "NOT SET"
    dr = bi.footprint_from_ring([(100, 200), (110, 200), (110, 208), (100, 208)], "granny_flat")
    assert area(dr.building.levels[0].rings[0]) == pytest.approx(80.0) and dr.ref == [pytest.approx(0.0), pytest.approx(0.0)]
    assert any("BUILDING USE NOT GIVEN" in w for w in bi.import_footprint_entry(5, 5, None).warnings)


@pytest.mark.parametrize("w,d,use", [(0, 5, "house"), (5, -1, "house"), (float("nan"), 5, "house"), (2000, 5, "house"), (5, 5, "mansion")])
def test_footprint_entry_refuses_bad_input(w, d, use):
    with pytest.raises(bi.ImportFailure):
        bi.import_footprint_entry(w, d, use)


def test_dxf_path_reuses_sa8(tmp_path):
    from app.agents.sa8_layout import floorplan_dxf, from_brief
    house = from_brief(3, 2, "double", 1, "contemporary")
    f = tmp_path / "plan.dxf"
    floorplan_dxf(house, f)
    pl = bi.import_dxf(f.read_bytes(), "plan.dxf", "house")
    assert pl.source == "dxf" and area(pl.building.levels[0].rings[0]) == pytest.approx(house.footprint().area, rel=0.02)
    assert pl.building.params["roof_area_basis"].value == "NOT SET"
    assert any("SA8" in n for n in pl.building.notes)
    with pytest.raises(bi.ImportFailure) as ei:
        bi.import_dxf(b"this is not a dxf", "junk.dxf")
    assert ei.value.status == 422
    import ezdxf
    doc = ezdxf.new()
    doc.modelspace().add_line((0, 0), (1, 1))
    g = tmp_path / "empty.dxf"
    doc.saveas(g)
    with pytest.raises(bi.ImportFailure) as e2:
        bi.import_dxf(g.read_bytes(), "empty.dxf")
    assert e2.value.code == "DXF_NO_FOOTPRINT"


def test_pdf_path_reuses_sa7_and_respects_its_refusal(tmp_path):
    from tests.test_sa7_pdf_align import make_plan
    plan = make_plan(tmp_path)
    pl = bi.import_pdf(plan.data, lot_wkt=plan.lot.wkt, srid=7856, source_file="plan.pdf", use="house")
    assert pl.source == "pdf" and pl.alignment is not None and pl.alignment.rmse_m <= 0.30
    got = Polygon(pl.building.levels[0].rings[0])
    assert got.area == pytest.approx(plan.slab.area, rel=0.05)
    # aligned_at is the MGA position of `ref`: ref is local, so aligned_at - ref is the local origin
    assert pl.aligned_at is not None and abs(pl.aligned_at[0] - plan.slab.centroid.x) < 1.0 and abs(pl.aligned_at[1] - plan.slab.centroid.y) < 1.0
    assert pl.building.params["roof_area_basis"].value == "NOT SET"
    # a wrong user scale makes the alignment residual exceed 0.30 m: SA7 refuses and so does the importer
    with pytest.raises(bi.ImportFailure) as ei:
        bi.import_pdf(plan.data, lot_wkt=plan.lot.wkt, srid=7856, source_file="plan.pdf", use="house", scale_denominator=180)
    assert ei.value.code == "ALIGN_REFUSED" and ei.value.status == 422
    with pytest.raises(bi.ImportFailure) as e2:
        bi.import_pdf(plan.data, lot_wkt="not wkt", srid=7856)
    assert e2.value.code == "LOT_REQUIRED"


# ---------------------------------------------------------------------------------------------------------------------------------
# API route
# ---------------------------------------------------------------------------------------------------------------------------------
@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.delenv("SCENE_BUNDLE_DIR", raising=False)
    app = create_app(Settings(export_dir=str(tmp_path)), pool=object())
    app.dependency_overrides[site_design_access] = lambda: uuid.uuid4()
    return TestClient(app)


def url(pid=None) -> str:
    return f"/projects/{pid or uuid.uuid4()}/site-design/import-building"


def post(client, name, content, ctype="application/octet-stream", **data):
    return client.post(url(), files={"file": (name, io.BytesIO(content), ctype)}, data=data)


def test_route_imports_a_planstudio_file(client):
    r = post(client, "house.planstudio.json", WITH_EXPORT.read_bytes(), "application/json", building_use="granny_flat")
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["schema"] == "building_import.v1" and j["source"] == "plan_studio" and j["used_site_export"] is True
    assert j["building"]["params"]["building_use"]["value"] == "granny_flat"
    assert j["building"]["params"]["roof_area_basis"]["value"] == "APPROXIMATE (PLAN STUDIO RASTER)"
    assert r.headers["cache-control"] == "no-store"
    r2 = post(client, "plain.planstudio.json", NO_EXPORT.read_bytes(), "application/json")
    assert r2.status_code == 200 and r2.json()["used_site_export"] is False


def test_route_footprint_entry_and_drawn_ring(client):
    r = client.post(url(), data={"source": "footprint_entry", "width_m": "10", "depth_m": "6", "building_use": "shed"})
    assert r.status_code == 200 and r.json()["source"] == "footprint_entry"
    r2 = client.post(url(), data={"source": "footprint_entry", "ring": json.dumps([[0, 0], [8, 0], [8, 5], [0, 5]]), "building_use": "unit"})
    assert r2.status_code == 200 and area(r2.json()["building"]["levels"][0]["rings"][0]) == pytest.approx(40.0)
    for bad in ({"source": "footprint_entry"}, {"source": "footprint_entry", "ring": "nope"}, {"source": "footprint_entry", "ring": "[[0,0],[1,1]]"},
                {"source": "footprint_entry", "width_m": "0", "depth_m": "3"}, {"source": "footprint_entry", "width_m": "3", "depth_m": "3", "building_use": "palace"}):
        assert client.post(url(), data=bad).status_code == 422, bad


def test_route_dxf_and_pdf(client, tmp_path):
    from app.agents.sa8_layout import floorplan_dxf, from_brief
    from tests.test_sa7_pdf_align import make_plan
    f = tmp_path / "p.dxf"
    floorplan_dxf(from_brief(3, 2, "double", 1, "contemporary"), f)
    r = post(client, "p.dxf", f.read_bytes(), building_use="house")
    assert r.status_code == 200 and r.json()["source"] == "dxf"
    plan = make_plan(tmp_path)
    ok = post(client, "plan.pdf", plan.data, "application/pdf", lot_wkt=plan.lot.wkt, srid="7856", building_use="house")
    assert ok.status_code == 200 and ok.json()["source"] == "pdf" and ok.json()["alignment"]["rmse_m"] <= 0.30
    refused = post(client, "plan.pdf", plan.data, "application/pdf", lot_wkt=plan.lot.wkt, srid="7856", scale_denominator="180")
    assert refused.status_code == 422 and refused.json()["code"] == "ALIGN_REFUSED"
    nolot = post(client, "plan.pdf", plan.data, "application/pdf")
    assert nolot.status_code == 422 and nolot.json()["code"] == "LOT_REQUIRED"


def test_route_bad_files(client):
    assert post(client, "notes.txt", b"hello").status_code == 415
    assert post(client, "x.pdf", b"not a pdf").json()["code"] == "NOT_A_PDF"
    assert post(client, "x.planstudio.json", b"<html>").json()["code"] == "NOT_A_PLAN_STUDIO_FILE"
    r = post(client, "x.planstudio.json", b'{"schema": 99, "levels": []}')
    assert r.status_code == 422 and r.json()["code"] == "PS_NEWER"
    r = post(client, "x.planstudio.json", b'{"nope": 1}')
    assert r.status_code == 422 and r.json()["code"] == "NOT_PLAN_STUDIO"
    r = post(client, "x.dxf", b"junk")
    assert r.status_code == 422
    assert post(client, "x.pdf", b"").status_code == 422
    assert client.post(url(), data={"source": "bogus"}).status_code == 422
    mismatch = post(client, "x.dxf", WITH_EXPORT.read_bytes(), source="plan_studio")
    assert mismatch.status_code == 422 and mismatch.json()["code"] == "FILE_TYPE_MISMATCH"


def test_route_size_cap(client):
    big = b"{" + b" " * (MAX_IMPORT_BYTES + 10) + b"}"
    r = post(client, "big.planstudio.json", big, "application/json")
    assert r.status_code == 413 and r.json()["code"] == "FILE_TOO_LARGE"


def test_route_requires_authorisation(tmp_path, monkeypatch):
    monkeypatch.delenv("SCENE_BUNDLE_DIR", raising=False)
    app = create_app(Settings(export_dir=str(tmp_path)), pool=object())              # no dependency override: the real access dependency
    t = TestClient(app)
    r = t.post(url(), files={"file": ("a.planstudio.json", io.BytesIO(WITH_EXPORT.read_bytes()), "application/json")})
    assert r.status_code == 401
    assert t.post(url(), data={"source": "footprint_entry", "width_m": "5", "depth_m": "5"}).status_code == 401
