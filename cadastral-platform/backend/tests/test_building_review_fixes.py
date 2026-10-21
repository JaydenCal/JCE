"""Stage 5 review fixes: import limits (422 not 500), CPU budget, NOT SET building use, tank cap and estimates, the stored import check on PUT,
the streaming upload cap and the drawn ring check. The Plan Studio files are SYNTHETIC TEST FIXTURES."""
from __future__ import annotations

import asyncio
import io
import json
import math
import time
import uuid
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.api.app import create_app
from app.api.settings import Settings
from app.api.site_design import MAX_IMPORT_BYTES, site_design_access
from app.design import building_import as bi
from app.design import import_store as istore

FIX = Path(__file__).parent / "fixtures"
WITH_EXPORT = FIX / "planstudio_synthetic.planstudio.json"
NO_EXPORT = FIX / "planstudio_synthetic.planstudio.no_export.json"


def raw(path: Path = NO_EXPORT) -> dict:
    return json.loads(path.read_text())


def imp(d: dict, use: str | None = "house"):
    return bi.import_planstudio(json.dumps(d).encode(), "t.planstudio.json", use)


def fail_code(d: dict, use: str | None = "house") -> str:
    with pytest.raises(bi.ImportFailure) as e:
        imp(d, use)
    assert e.value.status == 422
    return e.value.code


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.delenv("SCENE_BUNDLE_DIR", raising=False)
    app = create_app(Settings(export_dir=str(tmp_path)), pool=object())
    app.dependency_overrides[site_design_access] = lambda: uuid.uuid4()
    c = TestClient(app)
    c.tmp = tmp_path
    return c


def post_file(client, pid, name, content, ctype="application/json", **data):
    return client.post(f"/projects/{pid}/site-design/import-building", files={"file": (name, io.BytesIO(content), ctype)}, data=data)


# ---- 2. exits above the model limits are a 422 with a clear message, never a 500
@pytest.mark.parametrize("kind,code_n", [("sewer_exit", 65), ("water_exit", 65), ("downpipe", 257)])
def test_too_many_exits_is_a_422_not_a_500(kind, code_n):
    d = raw()
    d["site"]["points"] = [{"id": f"p{i}", "kind": kind, "x": i * 10, "y": 0, "status": "new"} for i in range(code_n)]
    with pytest.raises(bi.ImportFailure) as e:
        imp(d)
    assert e.value.status == 422 and e.value.code == "TOO_MANY_EXITS" and str(code_n) in e.value.message


def test_too_many_exits_in_a_site_export_block_and_through_the_route(client):
    d = raw(WITH_EXPORT)
    d["site_export"]["sewer_exits"] = [{"id": f"s{i}", "x": i, "y": 0} for i in range(65)]
    assert fail_code(d) == "TOO_MANY_EXITS"
    r = post_file(client, uuid.uuid4(), "x.planstudio.json", json.dumps(d).encode())
    assert r.status_code == 422 and r.json()["code"] == "TOO_MANY_EXITS" and "64" in r.json()["message"]


def test_exits_at_the_limit_are_kept_not_dropped():
    d = raw()
    d["site"]["points"] = [{"id": f"p{i}", "kind": "sewer_exit", "x": i * 10, "y": 0, "status": "new"} for i in range(64)]
    assert len(imp(d).building.exits.sewer) == 64


# ---- 3. CPU budget
def room(i: int, poly: list[tuple[float, float]]) -> dict:
    return {"id": f"r{i}", "name": "R", "type": "living", "polygon": [{"x": x, "y": y} for x, y in poly], "status": "new"}


def project_with(rooms: list[dict], walls: list[dict] | None = None, levels: int = 1) -> dict:
    d = raw()
    base = d["levels"][0]
    lvs = []
    for k in range(levels):
        lv = json.loads(json.dumps(base))
        lv["id"] = f"l{k}"; lv["elevation"] = k * 3000
        lv["walls"] = [dict(w, id=f"w{k}_{j}") for j, w in enumerate(walls or [])]
        lv["rooms"] = [dict(r, id=f"{r['id']}_{k}") for r in rooms]
        lv["openings"] = []; lv["furniture"] = []; lv["stairs"] = []
        lvs.append(lv)
    d["levels"] = lvs
    return d


def circle(n: int, r: float = 1000.0, cx: float = 0.0, cy: float = 0.0) -> list[tuple[float, float]]:
    return [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def test_room_with_too_many_vertices_is_refused_quickly():
    d = project_with([room(0, circle(2001))])
    t = time.monotonic()
    with pytest.raises(bi.ImportFailure) as e:
        imp(d)
    assert e.value.code == "IMPORT_TOO_COMPLEX" and e.value.status == 422 and e.value.message.startswith("IMPORT TOO COMPLEX")
    assert time.monotonic() - t < 2


def test_total_vertices_per_file_are_capped():
    d = project_with([room(i, circle(1900, 500, i * 1.0, 0)) for i in range(60)])           # 114,000 vertices, each room within the room limit
    t = time.monotonic()
    assert fail_code(d) == "IMPORT_TOO_COMPLEX"
    assert time.monotonic() - t < 5


def test_rooms_times_grid_cells_work_estimate_refuses_a_heavy_file_quickly():
    big = [(0, 0), (189000, 0), (189000, 189000), (0, 189000)]                  # a 189 m square: 1.9k x 1.9k cells at 100 mm
    d = project_with([room(i, big) for i in range(40)])
    t = time.monotonic()
    with pytest.raises(bi.ImportFailure) as e:
        imp(d)
    assert e.value.code == "IMPORT_TOO_COMPLEX" and "raster steps" in e.value.message
    assert time.monotonic() - t < 3                                              # refused before any rasterising


def test_wall_clock_budget_returns_422(monkeypatch):
    monkeypatch.setattr(bi, "WALL_CLOCK_S", 1e-9)
    assert fail_code(raw(NO_EXPORT)) == "IMPORT_TOO_COMPLEX"
    assert fail_code(raw(WITH_EXPORT)) == "IMPORT_TOO_COMPLEX"                   # the site_export path is on the same clock


def test_row_runs_per_level_are_capped():
    mask = np.zeros((400, 400), dtype=bool)
    mask[::2, ::2] = True                                                        # a checkerboard: 40,000 separate runs
    with pytest.raises(bi.ImportFailure) as e:
        bi.mask_to_polygons(mask, 0.0, 0.0, 100.0, 50.0)
    assert e.value.code == "IMPORT_TOO_COMPLEX"


def test_huge_roof_overhang_is_refused_not_allocated():
    d = raw()
    d["levels"][0]["roof"]["overhang"] = 5e8
    assert fail_code(d) == "PS_INVALID"


def test_normal_files_still_import_within_the_budget():
    t = time.monotonic()
    assert imp(raw(NO_EXPORT)).building.levels and imp(raw(WITH_EXPORT)).used_site_export
    assert time.monotonic() - t < 5


# ---- 6. building use is NOT SET, never 'other' with a user basis
def test_missing_building_use_is_not_set():
    for pl in (bi.import_footprint_entry(5, 5, None), bi.footprint_from_ring([(0, 0), (4, 0), (4, 3), (0, 3)], None)):
        u = pl.building.params["building_use"]
        assert u.value is None and u.basis == "unresolved"
        assert any("BUILDING USE NOT SET" in w for w in pl.warnings)
    d = raw(); d["type"] = "extension"
    u = imp(d, None).building.params["building_use"]
    assert u.value is None and u.basis == "unresolved"
    assert imp(raw(), None).building.params["building_use"].value == "house"      # the Plan Studio type names a use
    assert bi.import_footprint_entry(5, 5, "shed").building.params["building_use"].value == "shed"


# ---- 7. and 8. tanks
def tank(i: int, cap: float = 5000, dia: float = 1850, h: float = 2000, **kw) -> dict:
    return {"id": f"t{i}", "x": 7000 + i * 10, "y": 2000, "capacityL": cap, "diameter": dia, "height": h, "status": "new", **kw}


def test_non_standard_tank_sizes_are_plan_studio_estimates():
    d = raw()
    d["site"]["tanks"] = [tank(1, 5000, 1850, 2000), tank(2, 7000, 2150, 2400), tank(3, 5000, 2300, 1900), tank(4, 5000, 1850, 2000, sizeBasis="estimate")]
    ex = imp(d).extras
    std, est, odd, flagged = ex
    assert std.params["diameter_m"].basis == "user" and std.params["height_m"].basis == "user"
    for t in (est, odd, flagged):
        for k in ("diameter_m", "height_m"):
            assert t.params[k].basis != "user" and t.params[k].ref.startswith("PLAN STUDIO ESTIMATE")
        assert t.params["capacity_l"].basis == "user"
    d["site"]["tanks"] = [tank(5, 7000, 2150, 2400, sizeBasis="standard")]
    assert imp(d).extras[0].params["diameter_m"].basis == "user"
    assert any("PLAN STUDIO ESTIMATES" in n for n in imp(raw() | {"site": raw()["site"] | {"tanks": [tank(2, 7000, 2150, 2400)]}}).building.notes)


def test_more_than_64_tanks_is_a_422_with_a_message(client):
    d = raw()
    d["site"]["tanks"] = [tank(i) for i in range(65)]
    with pytest.raises(bi.ImportFailure) as e:
        imp(d)
    assert e.value.code == "TOO_MANY_TANKS" and e.value.status == 422 and "64" in e.value.message
    r = post_file(client, uuid.uuid4(), "x.planstudio.json", json.dumps(d).encode())
    assert r.status_code == 422 and r.json()["code"] == "TOO_MANY_TANKS"
    d["site"]["tanks"] = [tank(i) for i in range(64)]
    assert len(imp(d).extras) == 64


# ---- 11. a self intersecting drawn ring is refused
def test_self_intersecting_ring_is_refused(client):
    bow = [(0, 0), (10, 10), (10, 0), (0, 10)]
    with pytest.raises(bi.ImportFailure) as e:
        bi.footprint_from_ring(bow, "shed")
    assert e.value.status == 422 and e.value.message == "FOOTPRINT RING SELF INTERSECTS, REDRAW"
    r = client.post(f"/projects/{uuid.uuid4()}/site-design/import-building", data={"source": "footprint_entry", "ring": json.dumps(bow), "building_use": "shed"})
    assert r.status_code == 422 and r.json()["message"] == "FOOTPRINT RING SELF INTERSECTS, REDRAW"
    ok = bi.footprint_from_ring([(0, 0), (10, 0), (10, 6), (0, 6)], "shed")
    assert ok.ref == [pytest.approx(0.0), pytest.approx(0.0)]


# ---- 10. the upload cap is enforced while the body streams
def test_chunked_upload_over_the_cap_is_cut_off_while_streaming(tmp_path, monkeypatch):
    monkeypatch.delenv("SCENE_BUNDLE_DIR", raising=False)
    app = create_app(Settings(export_dir=str(tmp_path)), pool=object())
    app.dependency_overrides[site_design_access] = lambda: uuid.uuid4()
    chunk = b"x" * (1024 * 1024)
    head = b'--B\r\nContent-Disposition: form-data; name="file"; filename="big.planstudio.json"\r\nContent-Type: application/json\r\n\r\n{'
    pulled = {"n": 0}
    total_chunks = 200                                                           # 200 MB offered, no content-length header

    async def run():
        sent: list[dict] = []
        queue = [head] + [chunk] * total_chunks

        async def receive():
            if not queue:
                return {"type": "http.request", "body": b"", "more_body": False}
            pulled["n"] += 1
            return {"type": "http.request", "body": queue.pop(0), "more_body": True}

        async def send(msg):
            sent.append(msg)

        scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST", "scheme": "http", "path": f"/projects/{uuid.uuid4()}/site-design/import-building",
                 "raw_path": b"", "query_string": b"", "root_path": "", "server": ("t", 80), "client": ("c", 1),
                 "headers": [(b"content-type", b"multipart/form-data; boundary=B"), (b"transfer-encoding", b"chunked"), (b"host", b"t")], "app": app, "state": {}}
        await app(scope, receive, send)
        return sent

    sent = asyncio.run(run())
    start = next(m for m in sent if m["type"] == "http.response.start")
    body = json.loads(b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body"))
    assert start["status"] == 413 and body["code"] == "FILE_TOO_LARGE"
    cap_mb = MAX_IMPORT_BYTES // (1024 * 1024)
    assert pulled["n"] <= cap_mb + 3, f"read {pulled['n']} chunks of {total_chunks}"        # stopped at the cap, not after the whole body


# ---- 5. stored imports and the PUT check
def rot(p, yaw):
    a = math.radians(yaw)
    return [p[0] * math.cos(a) + p[1] * math.sin(a), -p[0] * math.sin(a) + p[1] * math.cos(a)]


def place(payload: dict, at: tuple[float, float], yaw: float = 0.0) -> dict:
    """An independent statement of place_building: MGA = at + R_clockwise(yaw) (p - ref)."""
    ref = payload["ref"]
    f = lambda p: [at[0] + rot([p[0] - ref[0], p[1] - ref[1]], yaw)[0], at[1] + rot([p[0] - ref[0], p[1] - ref[1]], yaw)[1]]      # noqa: E731
    b = payload["building"]
    o = f([0, 0])
    levels = [{**lv, "rings": [[f(p) for p in r] for r in lv["rings"]]} for lv in b["levels"]]
    building = {"levels": levels, "datum_index": b["datum_index"], "exits": {k: [f(p) for p in b["exits"][k]] for k in ("sewer", "water", "downpipes")},
                "frame": {"origin": o, "yaw_deg": yaw, **({"north_deg": b["north_deg"]} if "north_deg" in b else {})}, "notes": b["notes"], "import_id": payload["import_id"]}
    if b.get("roof_outline"):
        building["roof_outline"] = [[f(p) for p in r] for r in b["roof_outline"]]
    params = {k: v for k, v in b["params"].items()}
    params.setdefault("ffl_rl", {"basis": "unresolved"}); params.setdefault("height_m", {"basis": "unresolved"})
    return {"id": "building_1", "type": "building", "status": "proposed", "origin": "imported", "geometry": {"kind": "polygon", "ring": levels[b["datum_index"]]["rings"][0]},
            "params": params, "building": building}


def doc_of(*objs: dict, version: int = 0) -> dict:
    return {"schema": "site_design.v1", "version": version, "objects": list(objs)}


@pytest.fixture
def imported(client):
    pid = uuid.uuid4()
    r = post_file(client, pid, "house.planstudio.json", WITH_EXPORT.read_bytes(), building_use="house")
    assert r.status_code == 200, r.text
    return pid, r.json()


def put(client, pid, doc):
    return client.put(f"/projects/{pid}/site-design", json=doc)


def test_import_route_stores_the_payload_and_returns_its_id(client, imported):
    pid, payload = imported
    iid = payload["import_id"]
    assert len(iid) == 32
    f = client.tmp / str(pid) / "imports" / f"{iid}.json"
    assert f.is_file() and json.loads(f.read_text())["building"] == payload["building"]


def test_a_building_placed_from_a_stored_import_is_saved(client, imported):
    pid, payload = imported
    r = put(client, pid, doc_of(place(payload, (496010.0, 6650020.0), 37.0)))
    assert r.status_code == 200, r.text
    assert r.json()["objects"][0]["building"]["import_id"] == payload["import_id"]


def test_placement_use_ffl_and_height_may_change_but_nothing_else(client, imported):
    pid, payload = imported
    o = place(payload, (496010.0, 6650020.0), 37.0)
    o["params"]["ffl_rl"] = {"value": 108.2, "basis": "user"}
    o["params"]["height_m"] = {"value": 5.5, "basis": "user"}
    o["params"]["building_use"] = {"value": "granny_flat", "basis": "user"}
    o["status"] = "existing"; o["label"] = "Rear flat"; o["building"]["glb_name"] = "house.glb"
    assert put(client, pid, doc_of(o)).status_code == 200
    moved = place(payload, (496055.0, 6650071.5), 112.0)                      # moved and turned
    r = put(client, pid, doc_of(moved, version=1))
    assert r.status_code == 200, r.text


def bad_doc(payload: dict, mutate) -> dict:
    o = place(payload, (496010.0, 6650020.0), 37.0)
    mutate(o)
    return doc_of(o)


@pytest.mark.parametrize("name,mutate,code", [
    ("no import id", lambda o: o["building"].pop("import_id"), "BUILDING_NOT_FROM_IMPORT"),
    ("unknown import id", lambda o: o["building"].update(import_id="ab" * 16), "BUILDING_NOT_FROM_IMPORT"),
    ("invented level", lambda o: o["building"]["levels"].append({"name": "Roof terrace", "elevation_m": 3.0, "rings": o["building"]["levels"][0]["rings"]}), "BUILDING_IMPORT_MISMATCH"),
    ("invented elevation", lambda o: o["building"]["levels"][0].update(elevation_m=0.6), "BUILDING_IMPORT_MISMATCH"),
    ("moved outline vertex", lambda o: o["building"]["levels"][0]["rings"][0][0].__setitem__(0, o["building"]["levels"][0]["rings"][0][0][0] + 0.5), "BUILDING_IMPORT_MISMATCH"),
    ("invented exit", lambda o: o["building"]["exits"]["sewer"].append([496000.0, 6650000.0]), "BUILDING_IMPORT_MISMATCH"),
    ("roof area", lambda o: o["params"].update(roof_plan_area_m2={"value": 400.0, "basis": "user"}), "BUILDING_IMPORT_MISMATCH"),
    ("roof area basis", lambda o: o["params"].update(roof_area_basis={"value": "SOURCE VALUE", "basis": "user"}), "BUILDING_IMPORT_MISMATCH"),
    ("source", lambda o: o["params"].update(source={"value": "dxf", "basis": "user"}), "BUILDING_IMPORT_MISMATCH"),
    ("roof outline removed", lambda o: o["building"].pop("roof_outline"), "BUILDING_IMPORT_MISMATCH"),
    ("north angle", lambda o: o["building"]["frame"].update(north_deg=0.0), "BUILDING_IMPORT_MISMATCH"),
    ("footprint polygon differs", lambda o: o["geometry"]["ring"][0].__setitem__(0, o["geometry"]["ring"][0][0] + 1.0), "BUILDING_IMPORT_MISMATCH"),
])
def test_a_building_that_does_not_match_its_import_is_refused(client, imported, name, mutate, code):
    pid, payload = imported
    r = put(client, pid, bad_doc(payload, mutate))
    assert r.status_code == 422, (name, r.text)
    assert r.json()["code"] == code, name
    assert "BUILDING" in r.json()["message"]
    assert not (client.tmp / str(pid) / "site_design.json").exists()


def test_import_id_path_traversal_is_refused(client, imported):
    pid, payload = imported
    r = put(client, pid, bad_doc(payload, lambda o: o["building"].update(import_id="../" * 5)))
    assert r.status_code == 422                                              # not a 32 hex id: the model refuses it
    assert istore.load_import(client.tmp / str(pid), "../../x") is None


def test_unused_imports_are_pruned_beyond_the_limit_but_used_ones_stay(client, imported, monkeypatch):
    pid, payload = imported
    assert put(client, pid, doc_of(place(payload, (496010.0, 6650020.0)))).status_code == 200
    monkeypatch.setattr(istore, "MAX_STORED_IMPORTS", 3)
    monkeypatch.setattr(istore, "prune", lambda d, keep, limit=3, _p=istore.prune: _p(d, keep, 3))
    for _ in range(5):
        assert post_file(client, pid, "h.planstudio.json", NO_EXPORT.read_bytes(), building_use="house").status_code == 200
    files = list((client.tmp / str(pid) / "imports").glob("*.json"))
    assert len(files) == 3 and any(f.stem == payload["import_id"] for f in files)
