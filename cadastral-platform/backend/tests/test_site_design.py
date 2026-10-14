"""site_design.v1 Pydantic model and GET/PUT /projects/{id}/site-design (no database: the access dependency is overridden)."""
from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.app import create_app
from app.api.settings import Settings
from app.api.site_design import SITE_DESIGN_FILE, site_design_access
from app.design.site_design import GEOMETRY_OF, SiteDesign, SiteObject, empty_design

FIXTURE = Path(__file__).parent / "fixtures" / "site_design_v1.json"
#: written by the frontend test tests/site/fixture_export.test.ts from registry operations (UPDATE_SITE_FIXTURE=1 regenerates it)
FRONTEND_FIXTURE = Path(__file__).parent / "fixtures" / "site_design_v1_frontend.json"


def obj(**kw) -> dict:
    base = {"id": "o1", "type": "tree", "geometry": {"kind": "point", "p": [100.0, 200.0]}}
    base.update(kw)
    return base


def doc(*objects: dict, version: int = 0) -> dict:
    return {"schema": "site_design.v1", "version": version, "objects": list(objects)}


# ---- model
def test_fixture_validates_and_round_trips():
    d = SiteDesign.model_validate_json(FIXTURE.read_text())
    assert d.version == 3 and len(d.objects) == 3
    assert d.objects[1].accepted == "pending" and d.objects[1].geometry.pts[1] == [496010.0, 6650090.0, 21.5]
    again = SiteDesign.model_validate(d.dump())
    assert again == d
    assert d.dump()["objects"][0]["params"]["canopy_diameter_m"] == {"value": None, "basis": "unresolved"}     # explicit null kept


def test_document_produced_by_the_frontend_operations_validates():
    """Drift check, backend side: a document built only through the TypeScript operation registry must be accepted by the model."""
    raw = json.loads(FRONTEND_FIXTURE.read_text())
    d = SiteDesign.model_validate(raw)
    assert {o.type for o in d.objects} == set(GEOMETRY_OF)                                   # all fifteen types
    assert any(len(p) == 3 for o in d.objects if o.geometry.kind == "polyline" for p in o.geometry.pts)       # a vertex RL survives
    again = d.dump()
    assert [o["id"] for o in again["objects"]] == [o["id"] for o in raw["objects"]]
    assert SiteDesign.model_validate(again) == d
    # the wire form of an UNRESOLVED parameter keeps its explicit null
    tree = next(o for o in again["objects"] if o["id"] == "tree_1")
    assert tree["params"]["canopy_diameter_m"] == {"value": None, "basis": "unresolved"}


def test_defaults_and_types_cover_the_fifteen_object_types():
    assert set(GEOMETRY_OF) == {"tree", "rwt", "pit", "osd", "retaining_wall", "infiltration_trench", "stormwater_pipe",
                                "service_trace", "landscape_area", "grading_area", "osd_basin", "building", "pool", "footpath", "furniture"}
    o = SiteObject.model_validate(obj())
    assert o.status == "proposed" and o.origin == "user" and o.accepted is None and o.verified is False and o.params == {} and o.issues == []
    d = empty_design("p")
    assert d.version == 0 and d.objects == [] and d.dump()["schema"] == "site_design.v1"


@pytest.mark.parametrize("bad", [
    obj(type="house"),                                                                   # not a stage 4 type
    obj(status="demolished"), obj(origin="robot"),
    obj(id="bad id"), obj(id=""),
    obj(geometry={"kind": "polyline", "pts": [[0, 0], [1, 1]]}),                         # tree needs a point
    obj(type="retaining_wall", geometry={"kind": "polyline", "pts": [[0, 0]]}),          # one vertex
    obj(type="landscape_area", geometry={"kind": "polygon", "ring": [[0, 0], [1, 0]]}),  # two vertices
    obj(geometry={"kind": "point", "p": [1]}),
    obj(geometry={"kind": "point", "p": [1, 2, 3, 4]}),
    obj(geometry={"kind": "point", "p": [float("inf"), 2]}),
    obj(geometry={"kind": "point", "p": [1, 2], "extra": 1}),
    obj(params={"Height": {"value": 1, "basis": "user"}}),                               # key must be snake case
    obj(params={"h": {"value": None, "basis": "user"}}),                                  # user value needs a value
    obj(params={"h": {"value": 3, "basis": "unresolved"}}),                               # unresolved carries no value
    obj(params={"h": {"value": 3, "basis": "lga_rule"}}),                                 # LGA rule needs its reference
    obj(params={"h": {"value": 3, "basis": "guess"}}),
    obj(accepted="accepted"),                                                             # accepted is for AI proposals only
    obj(verified_on="14/10/2026", verified=True), obj(verified_on="2026-10-14"),
    obj(issues=[{"code": "X", "severity": "fatal", "message": "m"}]),
    obj(unknown_field=1),
    obj(geometry={"kind": "point", "p": [True, 2]}),                                      # bool is not a number
    obj(geometry={"kind": "point", "p": ["12.5", 2]}),                                    # a numeric string is not a number
    obj(geometry={"kind": "point", "p": [1, 2, "3"]}),
    obj(geometry={"kind": "point", "p": [1, 2], "yaw_deg": "15"}),
    obj(geometry={"kind": "point", "p": [1, 2], "yaw_deg": False}),
    obj(type="retaining_wall", geometry={"kind": "polyline", "pts": [[0, 0], [True, 1]]}),
    obj(type="landscape_area", geometry={"kind": "polygon", "ring": [[0, 0], [1, 0], ["1", "1"]]}),
    obj(params={"h": {"value": "x" * 201, "basis": "user"}}),                             # text value over 200 characters
])
def test_invalid_objects_rejected(bad):
    with pytest.raises(ValidationError):
        SiteObject.model_validate(bad)


def test_numbers_and_text_at_the_limits_are_accepted():
    o = SiteObject.model_validate(obj(geometry={"kind": "point", "p": [1, 2.5, 3], "yaw_deg": 15}, params={"h": {"value": "x" * 200, "basis": "user"}}))
    assert o.geometry.p == [1.0, 2.5, 3.0] and len(o.params["h"].value) == 200


def test_total_positions_are_capped(monkeypatch):
    line = lambda i: obj(id=f"w{i}", type="retaining_wall", geometry={"kind": "polyline", "pts": [[0, 0], [1, 1], [2, 2]]})
    from app.design.site_design import MAX_POSITIONS
    assert MAX_POSITIONS == 200_000                                                       # documented in docs/16
    SiteDesign.model_validate(doc(line(1), line(2)))                                      # 6 positions: fine
    monkeypatch.setattr("app.design.site_design.MAX_POSITIONS", 5)
    with pytest.raises(ValidationError, match="positions"):
        SiteDesign.model_validate(doc(line(1), line(2)))


def test_ai_proposal_defaults_to_pending_and_values_can_be_unresolved():
    o = SiteObject.model_validate(obj(origin="ai_proposal", params={"x_m": {"basis": "unresolved"}}))
    assert o.accepted == "pending" and o.params["x_m"].value is None


def test_document_level_rules():
    with pytest.raises(ValidationError):
        SiteDesign.model_validate(doc(obj(), obj()))                                      # duplicate id
    with pytest.raises(ValidationError):
        SiteDesign.model_validate({**doc(), "schema": "site_design.v2"})
    with pytest.raises(ValidationError):
        SiteDesign.model_validate(doc(version=-1))
    with pytest.raises(ValidationError):
        SiteDesign.model_validate({**doc(), "surprise": 1})


# ---- API
@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.delenv("SCENE_BUNDLE_DIR", raising=False)
    app = create_app(Settings(export_dir=str(tmp_path)), pool=object())
    app.dependency_overrides[site_design_access] = lambda: uuid.uuid4()
    return TestClient(app), tmp_path


def test_get_with_no_design_returns_empty_document_at_version_zero(client):
    c, _ = client
    pid = uuid.uuid4()
    r = c.get(f"/projects/{pid}/site-design")
    assert r.status_code == 200
    j = r.json()
    assert j == {"schema": "site_design.v1", "version": 0, "project_id": str(pid), "objects": []}
    assert r.headers["cache-control"] == "no-store"


def test_put_then_get_and_version_increments(client):
    c, tmp = client
    pid = uuid.uuid4()
    r = c.put(f"/projects/{pid}/site-design", json=doc(obj(), version=0))
    assert r.status_code == 200 and r.json()["version"] == 1 and r.json()["project_id"] == str(pid) and r.json()["updated_at"]
    assert (tmp / str(pid) / SITE_DESIGN_FILE).is_file()
    assert c.get(f"/projects/{pid}/site-design").json() == r.json()
    r2 = c.put(f"/projects/{pid}/site-design", json=doc(obj(), obj(id="o2"), version=1))
    assert r2.status_code == 200 and r2.json()["version"] == 2 and len(r2.json()["objects"]) == 2
    assert c.get(f"/projects/{uuid.uuid4()}/site-design").json()["objects"] == []           # another project is separate


def test_stale_version_is_409_and_nothing_is_written(client):
    c, tmp = client
    pid = uuid.uuid4()
    assert c.put(f"/projects/{pid}/site-design", json=doc(obj(), version=0)).status_code == 200      # now version 1
    r = c.put(f"/projects/{pid}/site-design", json=doc(obj(id="late"), version=0))                   # stale
    assert r.status_code == 409 and r.json()["code"] == "VERSION_CONFLICT" and r.json()["current_version"] == 1
    stored = json.loads((tmp / str(pid) / SITE_DESIGN_FILE).read_text())
    assert stored["version"] == 1 and [o["id"] for o in stored["objects"]] == ["o1"]
    assert c.put(f"/projects/{pid}/site-design", json=doc(obj(), version=5)).status_code == 409      # a future version is also not the stored one
    assert c.put(f"/projects/{uuid.uuid4()}/site-design", json=doc(obj(), version=3)).status_code == 409   # nothing stored: only version 0 is current


def test_invalid_document_is_422_and_not_written(client):
    c, tmp = client
    pid = uuid.uuid4()
    r = c.put(f"/projects/{pid}/site-design", json=doc(obj(type="tree", geometry={"kind": "polygon", "ring": [[0, 0], [1, 0], [1, 1]]})))
    assert r.status_code == 422
    assert not (tmp / str(pid)).exists()


def test_put_over_the_size_limit_is_413_and_nothing_is_written(client):
    from app.api.site_design import MAX_BODY_BYTES
    c, tmp = client
    pid = uuid.uuid4()
    pad = " " * (MAX_BODY_BYTES + 1)
    r = c.put(f"/projects/{pid}/site-design", content=json.dumps(doc(obj())) + pad, headers={"Content-Type": "application/json"})
    assert r.status_code == 413
    assert not (tmp / str(pid)).exists()
    # no declared length (chunked): the cap is enforced while streaming
    def body():
        yield json.dumps(doc(obj())).encode()
        for _ in range(6):
            yield b" " * (1024 * 1024)
    r = c.put(f"/projects/{pid}/site-design", content=body(), headers={"Content-Type": "application/json"})
    assert r.status_code == 413 and not (tmp / str(pid)).exists()
    # a body just inside the limit still works
    ok = c.put(f"/projects/{pid}/site-design", content=json.dumps(doc(obj())) + " " * 1000, headers={"Content-Type": "application/json"})
    assert ok.status_code == 200


def test_put_with_too_many_positions_is_422_and_not_written(client, monkeypatch):
    c, tmp = client
    pid = uuid.uuid4()
    monkeypatch.setattr("app.design.site_design.MAX_POSITIONS", 2)
    r = c.put(f"/projects/{pid}/site-design", json=doc(obj(), obj(id="o2"), obj(id="o3")))
    assert r.status_code == 422 and not (tmp / str(pid)).exists()


def test_put_rejects_bool_and_numeric_string_positions(client):
    c, tmp = client
    pid = uuid.uuid4()
    for bad in ([True, 2], ["496000.5", 2]):
        assert c.put(f"/projects/{pid}/site-design", json=doc(obj(geometry={"kind": "point", "p": bad}))).status_code == 422
    assert c.put(f"/projects/{pid}/site-design", content=b"{not json", headers={"Content-Type": "application/json"}).status_code == 422
    assert not (tmp / str(pid)).exists()


def test_env_dir_overrides_export_dir(client, tmp_path_factory, monkeypatch):
    c, tmp = client
    d = tmp_path_factory.mktemp("bundles")
    monkeypatch.setenv("SCENE_BUNDLE_DIR", str(d))
    pid = uuid.uuid4()
    assert c.put(f"/projects/{pid}/site-design", json=doc(obj())).status_code == 200
    assert (d / str(pid) / SITE_DESIGN_FILE).is_file() and not (tmp / str(pid)).exists()


def test_corrupt_file_on_disk_is_500(client):
    c, tmp = client
    pid = uuid.uuid4()
    (tmp / str(pid)).mkdir()
    (tmp / str(pid) / SITE_DESIGN_FILE).write_text("{not json")
    assert c.get(f"/projects/{pid}/site-design").status_code == 500
    assert c.put(f"/projects/{pid}/site-design", json=doc(obj())).status_code == 500


def test_requires_user_when_not_overridden(tmp_path):
    app = create_app(Settings(export_dir=str(tmp_path)), pool=object())
    t = TestClient(app)
    pid = uuid.uuid4()
    assert t.get(f"/projects/{pid}/site-design").status_code == 401
    assert t.put(f"/projects/{pid}/site-design", json=doc(obj())).status_code == 401


# ---- stage 5: building, pool, footpath, furniture
def _building_block() -> dict:
    ring = [[100.0, 200.0], [110.0, 200.0], [110.0, 208.0], [100.0, 208.0]]
    return {"levels": [{"name": "Ground", "elevation_m": 0.0, "rings": [ring]}], "datum_index": 0, "roof_outline": [ring],
            "exits": {"sewer": [[101.0, 201.0]], "water": [], "downpipes": [[100.0, 200.0]]}, "frame": {"origin": [100.0, 200.0], "yaw_deg": 0.0, "north_deg": 30.0}, "notes": ["x"]}


def _building(**kw) -> dict:
    base = {"id": "b1", "type": "building", "geometry": {"kind": "polygon", "ring": [[100.0, 200.0], [110.0, 200.0], [110.0, 208.0], [100.0, 208.0]]},
            "building": _building_block(), "params": {"ffl_rl": {"value": None, "basis": "unresolved"}, "building_use": {"value": "house", "basis": "user"}}}
    base.update(kw)
    return base


def test_stage5_objects_validate_and_round_trip():
    d = SiteDesign.model_validate(doc(
        _building(),
        obj(id="p1", type="pool", geometry={"kind": "polygon", "ring": [[0, 0], [5, 0], [5, 4]]}, params={"depth_m": {"value": None, "basis": "unresolved"}}),
        obj(id="f1", type="footpath", geometry={"kind": "polyline", "pts": [[0, 0], [5, 0]]}, params={"surface_kind": {"value": "permeable_pavers", "basis": "user"}}),
        obj(id="f2", type="footpath", geometry={"kind": "polygon", "ring": [[0, 0], [5, 0], [5, 1]]}),                    # a footpath may be an area
        obj(id="g1", type="landscape_area", geometry={"kind": "polygon", "ring": [[0, 0], [5, 0], [5, 1]]}, params={"surface_kind": {"value": "garden_bed", "basis": "user"}}),
        obj(id="u1", type="furniture", params={"width_m": {"value": 1.3, "basis": "platform_default", "ref": "CATALOGUE"}})))
    assert SiteDesign.model_validate(d.dump()) == d
    assert d.dump()["objects"][0]["params"]["ffl_rl"] == {"value": None, "basis": "unresolved"}


@pytest.mark.parametrize("bad", [
    {k: v for k, v in _building().items() if k != "building"},                                              # a building needs its block
    obj(building=_building_block()),                                                                         # no other type carries one
    _building(params={"building_use": {"value": "palace", "basis": "user"}}),
    _building(params={"ffl_rl": {"value": "high", "basis": "user"}}),
    _building(params={"height_m": {"value": True, "basis": "user"}}),
    _building(geometry={"kind": "point", "p": [1.0, 2.0]}),
    obj(id="p1", type="pool", geometry={"kind": "polyline", "pts": [[0, 0], [1, 1]]}),                       # a pool is an area
    obj(id="f1", type="footpath", geometry={"kind": "point", "p": [0, 0]}),
    obj(id="f1", type="footpath", geometry={"kind": "polyline", "pts": [[0, 0], [5, 0]]}, params={"surface_kind": {"value": "lava", "basis": "user"}}),
    obj(id="g1", type="landscape_area", geometry={"kind": "polygon", "ring": [[0, 0], [5, 0], [5, 1]]}, params={"surface_kind": {"value": "lawn", "basis": "user"}}),
    obj(id="u1", type="furniture", params={"width_m": {"value": "wide", "basis": "user"}}),
])
def test_stage5_objects_that_must_be_refused(bad):
    with pytest.raises(ValidationError):
        SiteDesign.model_validate(doc(bad))


def test_building_block_rules():
    b = _building_block()
    b["datum_index"] = 3
    with pytest.raises(ValidationError):
        SiteDesign.model_validate(doc(_building(building=b)))
    b = _building_block()
    del b["frame"]
    with pytest.raises(ValidationError):
        SiteDesign.model_validate(doc(_building(building=b)))
    b = _building_block()
    b["levels"][0]["rings"][0] = [[1, 1], [2, 2]]                              # fewer than three vertices
    with pytest.raises(ValidationError):
        SiteDesign.model_validate(doc(_building(building=b)))
    b = _building_block()
    b["levels"][0]["elevation_m"] = None                                       # an elevation the source does not give is allowed (NOT SET)
    SiteDesign.model_validate(doc(_building(building=b)))
