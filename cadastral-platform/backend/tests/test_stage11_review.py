"""Stage 11 review fixes (docs/22 section 10): CSV formula injection, building GLB validation and atomic merge, export limits and the engine gate, one base folder for the scene
bundle, SA6 never cached and one rebuild at a time, DXF text encoding and unlabelled bundle labels, the NOT SET text of the JSON schedule, removal of the stored GLB of a removed
building, and the offline fixture only in a test run. (Items 6 and 11 are in test_derived_ledger.py and the frontend tests.)"""
from __future__ import annotations

import csv
import io
import json
import logging
import os
import struct
import uuid
from pathlib import Path

import ezdxf
import pytest
from fastapi.testclient import TestClient

import ai_support as A
import site_support as H
from app.api.app import create_app
from app.api.scene import scene_access
from app.api.settings import Settings
from app.api.site_design import SITE_DESIGN_FILE, site_design_access, site_rules_dep
from app.design.site_design import SiteDesign
from app.exports import dxf as XD
from app.exports import glb as XG
from app.exports import schedules as XS
from app.exports.common import ExportContext
from app.orchestrator import rebuild_lease
from app.orchestrator.core import Orchestrator
from app.orchestrator.dag import DAG

FRONTEND_FIXTURE = Path(__file__).parent / "fixtures" / "site_design_v1_frontend.json"


@pytest.fixture(scope="module")
def design() -> SiteDesign:
    return SiteDesign.model_validate(json.loads(FRONTEND_FIXTURE.read_text()))


@pytest.fixture(scope="module")
def bundle() -> dict:
    return H.bundle()


def ctx_of(d, b=None) -> ExportContext:
    return ExportContext(project_id=str(uuid.uuid4()), design=d, bundle=b)


def edited(d: SiteDesign, fn) -> SiteDesign:
    doc = d.dump()
    fn(doc)
    return SiteDesign.model_validate(doc)


def rows_of(data: bytes):
    return list(csv.reader(io.StringIO(data.decode("utf-8-sig"))))


FORMULAS = ('=HYPERLINK("http://x","a")', "+1+1", "-2+3", "@SUM(1,1)", "\t=1", "\r=1")


# ---------------------------------------------------------------- 1. CSV formula injection
def test_csv_cells_that_a_spreadsheet_would_run_as_formulas_get_a_leading_apostrophe(design):
    def f(doc):
        doc["objects"][0]["label"] = '=HYPERLINK("http://x","a")'
        doc["objects"][1]["label"] = "@SUM(1,1)"
        doc["objects"][0]["params"]["evil"] = {"value": "+cmd|' /C calc'!A0", "basis": "user", "ref": "-2+3"}
        doc["objects"][1]["params"]["evil2"] = {"value": "ok", "basis": "user", "ref": "=1+1"}
    d = edited(design, f)
    rows = rows_of(XS.objects_csv(ctx_of(d)))
    head, body = rows[0], rows[1:]
    label, ref, value = head.index("label"), head.index("ref"), head.index("value")
    labels = {r[label] for r in body}
    assert "'=HYPERLINK(\"http://x\",\"a\")" in labels and "'@SUM(1,1)" in labels
    assert {r[ref] for r in body} >= {"'-2+3", "'=1+1"} and any(r[value] == "'+cmd|' /C calc'!A0" for r in body)
    for r in body:
        for i in (label, ref):
            assert not r[i].startswith(XS.FORMULA_LEADERS), r[i]


def test_csv_checks_and_stormwater_cells_are_neutralised_and_numbers_are_not(design):
    res = {"checks": [{"object_id": "=A1", "object_type": "tree", "code": "C1", "title": "+t", "status": "fail", "severity": "blocking", "message": '=HYPERLINK("http://x","a")', "basis": "-b",
                       "value": -1.5, "limit": 2, "unit": "m", "requirements": [{"key": "@k"}]}]}
    rows = rows_of(XS.checks_csv(ctx_of(design), res))
    h, r = rows[0], rows[1]
    assert r[h.index("message")] == "'=HYPERLINK(\"http://x\",\"a\")" and r[h.index("object_id")] == "'=A1" and r[h.index("basis")] == "'-b" and r[h.index("requirements")] == "'@k"
    assert r[h.index("value")] == "-1.5"                                                          # a number stays a number
    sw = rows_of(XS.stormwater_csv(ctx_of(design), {"notes": ["=cmd"], "lot_area_m2": 500}))
    assert ["notes", "'=cmd"] == sw[[x[0] for x in sw].index("notes")][:2]
    assert XS.safe_cell("-") == "'-" and XS.safe_cell("abc") == "abc" and XS.safe_cell(None) == "" and XS.safe_cell(-3) == -3


# ---------------------------------------------------------------- 9. NOT SET in the JSON as in the CSV
def test_objects_json_says_not_set_for_an_unresolved_parameter_like_the_csv(design):
    c = ctx_of(design)
    j = XS.objects_json(c)
    un = [(o["id"], k, p) for o in j["objects"] for k, p in o["params"].items() if p["basis"] == "unresolved"]
    assert un and all(p["value"] == "NOT SET" for _i, _k, p in un)
    assert all(p["value"] != "NOT SET" for o in j["objects"] for p in o["params"].values() if p["basis"] != "unresolved")
    rows = rows_of(XS.objects_csv(c))
    h = rows[0]
    assert all(r[h.index("value")] == "NOT SET" for r in rows[1:] if r[h.index("basis")] == "unresolved")


# ---------------------------------------------------------------- 2. building GLB validation, atomic merge
def make_glb(j, binc: bytes = b"") -> bytes:
    js = json.dumps(j).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    binc += b"\0" * ((4 - len(binc) % 4) % 4)
    body = struct.pack("<II", len(js), XG.JSON_CHUNK) + js + (struct.pack("<II", len(binc), XG.BIN_CHUNK) + binc if binc else b"")
    return b"glTF" + struct.pack("<II", 2, 12 + len(body)) + body


def tiny_json_and_bin():
    g = XG.Glb()
    p = g.primitive([(0, 0, 0), (1, 0, 0), (0, 1, 0)], [0, 1, 2], g.material("#ff0000", name="red"))
    return XG.parse_glb(g.to_bytes([g.node("root", g.mesh("tri", [p]))], {}))


def tiny_glb() -> bytes:
    j, b = tiny_json_and_bin()
    return make_glb(j, b)


def bad_variants():
    out = {}

    def v(name, fn):
        j, b = tiny_json_and_bin()
        j = json.loads(json.dumps(j))
        res = fn(j, b)
        out[name] = make_glb(j, res if isinstance(res, bytes) else b)
    v("float index", lambda j, b: j["meshes"][0]["primitives"][0].__setitem__("indices", 1.5))
    v("string index", lambda j, b: j["meshes"][0]["primitives"][0]["attributes"].__setitem__("POSITION", "0"))
    v("bool index", lambda j, b: j["nodes"][0].__setitem__("mesh", True))
    v("index out of range", lambda j, b: j["meshes"][0]["primitives"][0].__setitem__("material", 7))
    v("negative index", lambda j, b: j["nodes"][0].__setitem__("mesh", -1))
    v("view outside the bin", lambda j, b: j["bufferViews"][0].__setitem__("byteLength", 10_000))
    v("view offset outside the bin", lambda j, b: j["bufferViews"][1].__setitem__("byteOffset", 10_000))
    v("accessor past its view", lambda j, b: j["accessors"][0].__setitem__("count", 4))
    v("accessor count cap", lambda j, b: j["accessors"][0].__setitem__("count", XG.MAX_ACCESSOR_COUNT + 1))
    v("accessor float count", lambda j, b: j["accessors"][0].__setitem__("count", 3.0))
    v("too many nodes", lambda j, b: j.__setitem__("nodes", [{"name": "n"}] * (XG.MAX_NODES + 1)))
    v("node cycle", lambda j, b: j["nodes"].append({"children": [1]}))
    v("child out of range", lambda j, b: j["nodes"][0].__setitem__("children", [5]))
    v("nodes not objects", lambda j, b: j.__setitem__("nodes", [1, 2]))
    v("meshes not a list", lambda j, b: j.__setitem__("meshes", {"a": 1}))
    v("matrix wrong size", lambda j, b: j["nodes"][0].__setitem__("matrix", [1.0] * 15))
    v("texture reference out of range", lambda j, b: j["materials"][0]["pbrMetallicRoughness"].__setitem__("baseColorTexture", {"index": 3}))
    v("second buffer", lambda j, b: j["bufferViews"][0].__setitem__("buffer", 1))
    return out


def json_only(j) -> bytes:
    return make_glb(j)


def test_validate_gltf_accepts_a_good_glb_and_refuses_each_bad_one():
    j, b = tiny_json_and_bin()
    XG.validate_gltf(j, b)
    for name, data in bad_variants().items():
        jj, bb = XG.parse_glb(data)
        with pytest.raises(XG.GlbMergeError):
            XG.validate_gltf(jj, bb)
        assert name


def test_parse_glb_refuses_a_json_chunk_that_is_not_an_object_or_not_json_or_runs_past_the_file():
    for js in (b"[1,2]", b"nonsense", b'"x"'):
        body = struct.pack("<II", len(js), XG.JSON_CHUNK) + js + b" " * ((4 - len(js) % 4) % 4)
        with pytest.raises(XG.GlbMergeError):
            XG.parse_glb(b"glTF" + struct.pack("<II", 2, 12 + len(body)) + body)
    ok = tiny_glb()
    cut = bytearray(ok)
    struct.pack_into("<I", cut, 12, 10_000_000)                          # the chunk claims more bytes than the file has
    with pytest.raises(XG.GlbMergeError):
        XG.parse_glb(bytes(cut))


def test_a_merge_that_fails_changes_nothing_and_a_good_one_still_merges():
    def state(g):
        return (len(g.bin), len(g.views), len(g.accessors), len(g.meshes), len(g.materials), len(g.nodes), len(g.images), len(g.textures), len(g.samplers))
    g = XG.Glb()
    before = state(g)
    j, b = tiny_json_and_bin()
    j["images"] = [{"mimeType": "image/png"}]                            # not embedded: only found after the views were copied by the old merge
    import numpy as np
    with pytest.raises(XG.GlbMergeError):
        g.merge(make_glb(j, b), np.eye(4), "bad", {})
    assert state(g) == before
    for data in bad_variants().values():
        with pytest.raises(XG.GlbMergeError):
            g.merge(data, np.eye(4), "bad", {})
        assert state(g) == before
    idx = g.merge(tiny_glb(), np.eye(4), "good", {})
    assert g.nodes[idx]["name"] == "good" and state(g)[0] > 0


def test_build_glb_skips_one_bad_building_with_a_note_and_the_rest_is_intact(design, bundle):
    b = next(o for o in design.objects if o.type == "building")
    ref, _ = (lambda d: (XG.parse_glb(d), None))(XG.build_glb(ctx_of(design, bundle)))
    for name, data in bad_variants().items():
        out = XG.build_glb(ctx_of(design, bundle), building_glbs={b.id: data})
        j, binc = XG.parse_glb(out)
        node = next(n for n in j["nodes"] if n.get("name") == b.id)
        assert node["extras"]["glb"].startswith("BUILDING MODEL SKIPPED, INVALID"), name
        assert any("BUILDING MODEL SKIPPED, INVALID" in n for n in j["asset"]["extras"]["notes"])
        assert len(j["nodes"]) == len(ref[0]["nodes"]) and len(j["accessors"]) == len(ref[0]["accessors"]) and len(binc) == len(ref[1]), name
    ok = XG.parse_glb(XG.build_glb(ctx_of(design, bundle), building_glbs={b.id: tiny_glb()}))[0]
    assert next(n for n in ok["nodes"] if n.get("name") == b.id)["extras"]["glb"] == "MERGED"


# ---------------------------------------------------------------- API fixtures
@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.delenv("SCENE_BUNDLE_DIR", raising=False)
    app = create_app(Settings(export_dir=str(tmp_path)), pool=object())
    app.dependency_overrides[site_design_access] = lambda: uuid.uuid4()
    app.dependency_overrides[scene_access] = lambda: uuid.uuid4()
    app.dependency_overrides[site_rules_dep] = lambda: A.fake_rules()
    monkeypatch.setattr("app.api.site_design.istore.check_design", lambda *a, **k: None)
    return TestClient(app), tmp_path


def seed(tmp: Path, pid, d: SiteDesign, b: dict | None, version: int = 1):
    f = tmp / str(pid)
    f.mkdir(parents=True, exist_ok=True)
    (f / SITE_DESIGN_FILE).write_text(json.dumps({**d.dump(), "version": version}))
    if b is not None:
        (f / "scene_bundle.json").write_text(json.dumps(b))


def test_put_refuses_a_building_glb_that_fails_validation_with_422(api, design, bundle):
    c, tmp = api
    pid = uuid.uuid4()
    seed(tmp, pid, design, bundle)
    b = next(o for o in design.objects if o.type == "building")
    for name, data in list(bad_variants().items())[:8]:
        r = c.put(f"/projects/{pid}/exports/building-glb/{b.id}", content=data)
        assert r.status_code == 422 and r.json()["code"] == "INVALID_GLB", name
    assert not (tmp / str(pid) / "building_glb" / f"{b.id}.glb").exists()
    assert c.put(f"/projects/{pid}/exports/building-glb/{b.id}", content=tiny_glb()).status_code == 204


def test_a_stored_bad_model_never_makes_the_export_a_500(api, design, bundle):
    c, tmp = api
    pid = uuid.uuid4()
    seed(tmp, pid, design, bundle)
    b = next(o for o in design.objects if o.type == "building")
    d = tmp / str(pid) / "building_glb"
    d.mkdir()
    (d / f"{b.id}.glb").write_bytes(bad_variants()["float index"])
    r = c.get(f"/projects/{pid}/exports/glb")
    assert r.status_code == 200
    j, _ = XG.parse_glb(r.content)
    assert "BUILDING MODEL SKIPPED, INVALID" in json.dumps(j)


# ---------------------------------------------------------------- 3. the engine gate, the time cap and the byte total
def test_the_running_byte_total_stops_a_build_before_it_passes_the_limit():
    import numpy as np
    g = XG.Glb(max_bytes=2000)
    g.view(b"x" * 200)
    n = len(g.bin)
    with pytest.raises(XG.GlbTooLarge):
        g.view(b"y" * 5000)
    assert len(g.bin) == n                                               # nothing of the refused bytes was added
    with pytest.raises(XG.GlbTooLarge):
        g.accessor(np.zeros((1000, 3), np.float32), "VEC3", 5126, 34962)
    assert len(g.bin) == n
    with pytest.raises(XG.GlbTooLarge):
        XG.Glb(max_bytes=100).merge(tiny_glb(), np.eye(4), "x", {})


def test_the_glb_export_is_413_before_it_passes_the_limit_and_504_after_the_time_cap(api, design, bundle, monkeypatch):
    c, tmp = api
    pid = uuid.uuid4()
    seed(tmp, pid, design, bundle)
    assert c.get(f"/projects/{pid}/exports/glb").status_code == 200
    monkeypatch.setattr(XG, "MAX_GLB_BYTES", 20_000)
    r = c.get(f"/projects/{pid}/exports/glb")
    assert r.status_code == 413 and r.json()["code"] == "EXPORT_TOO_LARGE"
    monkeypatch.undo()
    monkeypatch.setattr("app.api.exports.EXPORT_TIME_CAP_S", -1.0)
    for kind in ("glb", "dxf"):
        r = c.get(f"/projects/{pid}/exports/{kind}")
        assert r.status_code == 504 and r.json()["code"] == "EXPORT_TIMEOUT", kind


def test_glb_dxf_and_schedule_builds_run_through_the_engine_gate(api, design, bundle, monkeypatch):
    import app.api.exports as E
    c, tmp = api
    pid = uuid.uuid4()
    seed(tmp, pid, design, bundle)
    seen = []
    orig = E._run_engine

    async def spy(project_id, work, timeout_s=None):
        seen.append((str(project_id), timeout_s))
        return await orig(project_id, work, timeout_s)
    monkeypatch.setattr(E, "_run_engine", spy)
    for kind in ("glb", "dxf", "objects.csv", "objects.json"):
        assert c.get(f"/projects/{pid}/exports/{kind}").status_code == 200
    assert [s[0] for s in seen] == [str(pid)] * 4 and all(s[1] for s in seen)


# ---------------------------------------------------------------- 4. one base folder
def test_the_sa6_writer_the_scene_bundle_route_and_the_exports_share_one_base_folder(tmp_path, monkeypatch):
    from app.agents.sa6_site3d import SceneBundle  # noqa: F401
    from app.orchestrator import inputs as I
    from app.orchestrator.inputs import BuildContext, RunRequest
    scene_dir, export_dir = tmp_path / "scene", tmp_path / "exports"
    monkeypatch.setenv("SCENE_BUNDLE_DIR", str(scene_dir))
    pid = uuid.uuid4()
    ctx = BuildContext(uuid.uuid4(), pid, uuid.uuid4(), RunRequest(project_id=pid, project_title="T"), conn=None, export_dir=str(export_dir), upstream={"SA1": {}, "ENV": {}})
    out = Path(I.build_input("SA6", ctx)["output_path"])
    assert out == scene_dir / str(pid)
    monkeypatch.delenv("SCENE_BUNDLE_DIR")
    assert Path(I.build_input("SA6", ctx)["output_path"]) == export_dir / str(pid)             # without the variable: the export folder
    monkeypatch.setenv("SCENE_BUNDLE_DIR", str(scene_dir))
    app = create_app(Settings(export_dir=str(export_dir)), pool=object())
    app.dependency_overrides[site_design_access] = lambda: uuid.uuid4()
    app.dependency_overrides[scene_access] = lambda: uuid.uuid4()
    c = TestClient(app)
    H.write_bundle(scene_dir, pid, H.bundle())                                                 # where SA6 writes
    assert c.get(f"/projects/{pid}/scene-bundle").status_code == 200
    r = c.get(f"/projects/{pid}/exports/objects.json")
    assert r.status_code == 200 and r.json()["terrain_status"].startswith("INDICATIVE")        # the exports read the same bundle
    assert not (export_dir / str(pid)).exists()


# ---------------------------------------------------------------- 5. SA6 is never cached, one rebuild at a time
def test_only_sa6_is_not_cacheable_and_a_not_cacheable_node_never_gets_a_cache_hit():
    assert DAG["SA6"].cacheable is False and all(n.cacheable for k, n in DAG.items() if k != "SA6")

    class Conn:
        def __init__(self):
            self.sql = []

        def execute(self, sql, params=None):
            self.sql.append(sql)

            class R:
                @staticmethod
                def fetchone():
                    return {"output_payload_id": uuid.uuid4()}
            return R
    conn = Conn()
    assert Orchestrator._cache_hit(conn, DAG["SA6"], "k") is None and conn.sql == []            # not even asked
    assert Orchestrator._cache_hit(conn, DAG["SA1"], "k") is not None and len(conn.sql) == 1


class FakeOrch:
    pool = object()

    def __init__(self, fail=False):
        self.fail, self.executed = fail, 0

    def create_run(self, user_id, request):
        class R:
            run_id = uuid.uuid4()
            status = "queued"
        return R

    def execute_run(self, run_id, user_id):
        self.executed += 1
        if self.fail:
            raise RuntimeError("boom")


def test_a_second_active_rebuild_of_a_project_is_409_and_the_lease_is_given_back(tmp_path, monkeypatch):
    monkeypatch.delenv("SCENE_BUNDLE_DIR", raising=False)
    fake = FakeOrch()
    app = create_app(Settings(export_dir=str(tmp_path)), pool=object(), orchestrator=fake)
    app.dependency_overrides[scene_access] = lambda: uuid.uuid4()
    c = TestClient(app)
    pid = uuid.uuid4()
    assert c.post(f"/projects/{pid}/scene/rebuild", json={}).status_code == 202 and fake.executed == 1
    assert c.post(f"/projects/{pid}/scene/rebuild", json={}).status_code == 202               # the first one has finished: the lease is back
    assert rebuild_lease.claim(tmp_path / str(pid))                                            # a rebuild is running (another worker)
    r = c.post(f"/projects/{pid}/scene/rebuild", json={})
    assert r.status_code == 409 and r.json()["code"] == "REBUILD_ACTIVE" and fake.executed == 2
    assert c.post(f"/projects/{uuid.uuid4()}/scene/rebuild", json={}).status_code == 202       # another project is not held up
    rebuild_lease.release(tmp_path / str(pid))
    bad = FakeOrch(fail=True)
    app.state.orchestrator = bad
    assert c.post(f"/projects/{pid}/scene/rebuild", json={}).status_code == 202 and bad.executed == 1
    assert rebuild_lease.claim(tmp_path / str(pid))                                            # a failed rebuild gave the lease back too
    assert rebuild_lease.claim(tmp_path / str(pid), now=10 ** 12) is True                      # and a lease that is too old (a crash) expires


# ---------------------------------------------------------------- 7. DXF encoding, 8. labels without a position
def read_dxf(data: bytes, tmp_path: Path):
    p = tmp_path / "x.dxf"
    p.write_bytes(data)
    return ezdxf.readfile(str(p))


@pytest.mark.parametrize("version", ["R2010", "R2000", "R12"])
def test_dxf_label_with_an_accent_round_trips(version, design, bundle, tmp_path):
    d = edited(design, lambda doc: doc["objects"][0].__setitem__("label", "Café Zoë Ñandú"))
    doc = read_dxf(XD.build_dxf(ctx_of(d, bundle), version), tmp_path)
    texts = [e.dxf.text for e in doc.modelspace() if e.dxftype() == "TEXT"]
    assert any("CAFÉ ZOË ÑANDÚ" in t for t in texts), [t for t in texts if "CAF" in t]


def test_dxf_r2010_keeps_any_letter_and_older_versions_escape_what_their_code_page_cannot_hold(design, bundle, tmp_path):
    d = edited(design, lambda doc: doc["objects"][0].__setitem__("label", "Łódź"))
    t10 = [e.dxf.text for e in read_dxf(XD.build_dxf(ctx_of(d, bundle), "R2010"), tmp_path).modelspace() if e.dxftype() == "TEXT"]
    assert any("ŁÓDŹ" in t for t in t10)
    raw = XD.build_dxf(ctx_of(d, bundle), "R2000")
    assert b"\\U+0141" in raw and "Ł".encode("utf-8") not in raw                      # escaped, not written as bytes the reader would misread
    assert XD.DEFAULT_VERSION == "R2010"


def test_dxf_label_without_a_position_is_skipped_with_a_note(design, bundle, tmp_path):
    b = json.loads(json.dumps(bundle))
    b["labels"] = [{"c": "lab_cont", "t": "NOPOS"}, {"c": "lab_cont", "t": "BADPOS", "p": ["x", 1]}, {"c": "lab_lots", "t": "SHORT", "p": [1]},
                   {"c": "lab_cont", "t": "KEPT", "p": [1.0, 2.0, 0.0]}, "junk"]
    doc = read_dxf(XD.build_dxf(ctx_of(design, b)), tmp_path)
    texts = [e.dxf.text for e in doc.modelspace() if e.dxftype() == "TEXT"]
    assert "KEPT" in texts and not {"NOPOS", "BADPOS", "SHORT"} & set(texts)
    assert any("4 LABELS OF THE SCENE BUNDLE SKIPPED, NO POSITION" in t for t in texts)


# ---------------------------------------------------------------- 10. the stored GLB goes with its building
def test_the_stored_glb_of_a_building_is_deleted_when_the_building_leaves_the_saved_design(api, design, bundle):
    c, tmp = api
    pid = uuid.uuid4()
    seed(tmp, pid, design, bundle)
    b = next(o for o in design.objects if o.type == "building")
    f = tmp / str(pid) / "building_glb" / f"{b.id}.glb"
    assert c.put(f"/projects/{pid}/exports/building-glb/{b.id}", content=tiny_glb()).status_code == 204 and f.is_file()
    same = c.put(f"/projects/{pid}/site-design", json={**design.dump(), "version": 1})
    assert same.status_code == 200 and f.is_file()                                              # still in the design: kept
    without = [o for o in design.dump()["objects"] if o["id"] != b.id]
    r = c.put(f"/projects/{pid}/site-design", json={**design.dump(), "objects": without, "version": 2})
    assert r.status_code == 200 and not f.exists() and not list((tmp / str(pid)).glob("building_glb/*.glb"))


# ---------------------------------------------------------------- 12. the offline fixture only in a test run
def test_the_offline_fixture_is_ignored_outside_a_test_run_with_a_warning(caplog):
    from app.agents.sa6_site3d.site_data import offline_fixture_name
    from app.orchestrator.adapters.sa6 import Sa6Adapter
    from app.orchestrator.registry import default_registry
    from app.common.contracts import AgentCode
    with caplog.at_level(logging.WARNING):
        assert offline_fixture_name({"JCESITE_OFFLINE_FIXTURE": "lot2"}) is None
        assert offline_fixture_name({"JCESITE_OFFLINE_FIXTURE": "lot2", "JCESITE_ENV": "production"}) is None
    assert "ignored" in caplog.text and "JCESITE_ENV=test" in caplog.text
    assert offline_fixture_name({"JCESITE_OFFLINE_FIXTURE": "lot2", "JCESITE_ENV": "test"}) == "lot2" and offline_fixture_name({"JCESITE_ENV": "test"}) is None
    assert Sa6Adapter(env={"JCESITE_OFFLINE_FIXTURE": "lot2"}).offline is None
    assert Sa6Adapter(env={"JCESITE_OFFLINE_FIXTURE": "lot2", "JCESITE_ENV": "test"}).offline is not None
    reg = default_registry(env={"JCESITE_OFFLINE_FIXTURE": "lot2"})
    assert reg.get(AgentCode.SA6_SITE3D).offline is None
