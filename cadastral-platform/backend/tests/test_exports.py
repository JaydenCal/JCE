"""Stage 11 exports: GLB (header, JSON chunk, node names), DXF (re read with ezdxf: layers, entities, dashed unverified services, upper case), schedules, the API, building GLB merge."""
from __future__ import annotations

import csv
import io
import json
import re
import struct
import uuid
from pathlib import Path

import ezdxf
import pytest
from fastapi.testclient import TestClient

import ai_support as A
import site_support as H
from app.api.app import create_app
from app.api.settings import Settings
from app.api.site_design import SITE_DESIGN_FILE, site_design_access, site_rules_dep
from app.design.site_design import SiteDesign
from app.exports import dxf as XD
from app.exports import glb as XG
from app.exports import layers as XL
from app.exports import schedules as XS
from app.exports.common import ExportContext, load_context
from app.agents.sa5_cad_dxf.planset.codes import LAYER_RE

FRONTEND_FIXTURE = Path(__file__).parent / "fixtures" / "site_design_v1_frontend.json"


@pytest.fixture(scope="module")
def design() -> SiteDesign:
    return SiteDesign.model_validate(json.loads(FRONTEND_FIXTURE.read_text()))


@pytest.fixture(scope="module")
def bundle() -> dict:
    return H.bundle()


def ctx_of(design, bundle) -> ExportContext:
    return ExportContext(project_id=str(uuid.uuid4()), design=design, bundle=bundle)


def chunks(data: bytes):
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF" and version == 2 and length == len(data)
    pos, out = 12, {}
    while pos < length:
        n, kind = struct.unpack_from("<I4s", data, pos)
        out[kind] = data[pos + 8:pos + 8 + n]
        pos += 8 + n
    return json.loads(out[b"JSON"].rstrip(b" ")), out.get(b"BIN\x00", b"")


# ---- GLB
def test_glb_header_json_chunk_and_node_names(design, bundle):
    data = XG.build_glb(ctx_of(design, bundle))
    j, binary = chunks(data)
    assert j["asset"]["version"] == "2.0" and len(binary) > 0 and len(data) % 4 == 0
    names = {n.get("name") for n in j["nodes"]}
    assert {o.id for o in design.objects} <= names                                   # a node per object, named by the object id
    kinds = {n["extras"]["kind"] for n in j["nodes"] if n.get("name") in {o.id for o in design.objects} and "extras" in n}
    assert kinds == {o.type for o in design.objects}                                   # userData kind is the object type
    assert {"SITE_TERRAIN", "SITE_DESIGN"} <= names
    status = json.dumps(j["asset"].get("extras", {})) + json.dumps(j.get("extras", {}))
    assert "INDICATIVE 5 m DEM" in status and "UNVERIFIED" in status.upper() or "LIDAR PENDING" in status


def test_glb_without_bundle_says_terrain_not_available(design):
    j, _ = chunks(XG.build_glb(ExportContext(project_id="p", design=design, bundle=None)))
    assert "TERRAIN DATA NOT AVAILABLE" in json.dumps(j)


def test_glb_aerial_is_optional(design, bundle):
    j, _ = chunks(XG.build_glb(ctx_of(design, bundle), include_aerial=False))
    assert "SITE_AERIAL" not in {n.get("name") for n in j["nodes"]}


def test_glb_binary_is_deterministic_apart_from_nothing(design, bundle):
    c = ctx_of(design, bundle)
    assert XG.build_glb(c) == XG.build_glb(c)


def _tiny_glb() -> bytes:
    g = XG.Glb()
    m = g.material("#ff0000", name="red")
    p = g.primitive([(0, 0, 0), (1, 0, 0), (0, 1, 0)], [0, 1, 2], m)
    mesh = g.mesh("tri", [p])
    return g.to_bytes([g.node("root", mesh)], {})


def test_building_glb_is_merged_under_the_building_node(design, bundle):
    b = next(o for o in design.objects if o.type == "building")
    c = ctx_of(design, bundle)
    j, _ = chunks(XG.build_glb(c, building_glbs={b.id: _tiny_glb()}))
    node = next(n for n in j["nodes"] if n.get("name") == b.id)
    child_names = [j["nodes"][i].get("name") for i in node.get("children", [])]
    assert child_names, "the attached GLB is a child of the building node"
    assert all(j["nodes"][i].get("name") for i in node["children"])


def test_a_bad_building_glb_is_ignored_with_a_note_not_a_crash(design, bundle):
    b = next(o for o in design.objects if o.type == "building")
    j, _ = chunks(XG.build_glb(ctx_of(design, bundle), building_glbs={b.id: b"not a glb"}))
    assert any(n.get("name") == b.id for n in j["nodes"])


# ---- layers and DXF
def test_every_export_layer_name_matches_the_jcs_scheme():
    els = XL.all_export_elements()
    assert len(els) > 60 and len(set(els)) == len(els)
    for e in els:
        disc = XL.FIXED[e][0] if e in XL.FIXED else "SITE"
        for kind in ("LINE", "TEXT"):
            assert LAYER_RE.match(XL.layer(e, kind, disc)), e
        XL.layer_defaults(e)
    assert {XL.object_element(t, "proposed") for t in XL.TYPE_CODES} <= set(els)
    assert XL.object_element("service_existing", "existing", "sewer", verified=False).endswith("U")


def _read(data: bytes):
    return ezdxf.read(io.StringIO(data.decode("utf-8", "replace")))


@pytest.mark.parametrize("version", ["R2000", "R12"])
def test_dxf_rereads_with_layers_and_entities(design, bundle, version):
    data = XD.build_dxf(ctx_of(design, bundle), version)
    doc = _read(data)
    assert doc.dxfversion == ("AC1015" if version == "R2000" else "AC1009")
    msp = doc.modelspace()
    assert len(msp) > 20
    layers = {l.dxf.name for l in doc.layers}
    used = {e.dxf.layer for e in msp}
    assert used <= layers | {"0"}
    for n in used - {"0"}:
        assert LAYER_RE.match(n), n
    auditor = doc.audit()
    assert not auditor.errors


def test_dxf_text_is_uppercase_and_carries_status_and_mga(design, bundle):
    doc = _read(XD.build_dxf(ctx_of(design, bundle)))
    texts = [e.dxf.text if e.dxftype() == "TEXT" else e.plain_text() for e in doc.modelspace() if e.dxftype() in ("TEXT", "MTEXT")]
    assert texts
    for t in texts:
        assert t == t.upper(), t
    blob = "\n".join(texts)
    assert "INDICATIVE 5 M DEM" in blob and "LIDAR PENDING" in blob
    assert re.search(r"MGA", blob) and re.search(r"\d\d/\d\d/\d{4}", blob)


def test_dxf_unverified_services_are_dashed_and_verified_are_continuous():
    d = A.design(*A.site_objects(), A.svc("gas_unv", "gas", [(0, 25), (18, 25)], owner="Jemena", verified=False))
    doc = _read(XD.build_dxf(ctx_of(d, H.bundle())))
    lt = {l.dxf.name: l.dxf.linetype.upper() for l in doc.layers}
    assert lt["JCS-SITE-GASU-LINE"] == "DASHED"                                    # an unverified service is dashed
    assert lt["JCS-SITE-SWRV-LINE"] == "CONTINUOUS" and lt["JCS-SITE-WATV-LINE"] == "CONTINUOUS"


def test_dxf_contours_and_boundary_present_from_bundle(bundle):
    doc = _read(XD.build_dxf(ctx_of(A.design(*A.site_objects()), bundle)))
    names = {e.dxf.layer for e in doc.modelspace()}
    assert any("-BNDY-" in n for n in names) and any("-CONT-" in n for n in names)


def test_dxf_without_bundle_still_exports_the_design_and_says_so():
    doc = _read(XD.build_dxf(ExportContext(project_id="p", design=A.design(*A.site_objects()), bundle=None)))
    blob = "\n".join(e.dxf.text for e in doc.modelspace() if e.dxftype() == "TEXT")
    assert "TERRAIN DATA NOT AVAILABLE" in blob


# ---- schedules
def test_objects_json_and_csv_carry_params_basis_and_status(design, bundle):
    c = ctx_of(design, bundle)
    j = XS.objects_json(c)
    assert j["terrain_status"].startswith("INDICATIVE") and j["objects"] and j["count"] == len(design.objects)
    assert all("basis" in p for o in j["objects"] for p in o["params"].values())
    rows = list(csv.DictReader(io.StringIO(XS.objects_csv(c).decode("utf-8-sig"))))
    assert rows and {"object_id", "type", "parameter", "value", "basis"} <= set(rows[0])
    assert {r["object_id"] for r in rows} <= {o.id for o in design.objects}
    assert any(r["basis"] == "unresolved" for r in rows) and any(r["basis"] == "user" for r in rows)


def test_checks_and_stormwater_schedules_run_on_the_saved_design():
    d = A.design(*A.site_objects())
    c = ctx_of(d, H.bundle(z=A.SLOPE, extent=(-10.0, 28.0, -10.0, 44.0)))
    from app.design.object_checks import check_design
    res = check_design(d, A.fake_rules(), A.terrain(), today=A.TODAY)
    j = XS.checks_json(c, res)
    assert j["available"] and j["checks"] and j["terrain_status"].startswith("INDICATIVE")
    assert XS.checks_csv(c, res).startswith(b"\xef\xbb\xbf")
    n = XS.checks_json(c, None)
    assert n["available"] is False and "DATA NOT AVAILABLE" in n["message"]


# ---- API
@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.delenv("SCENE_BUNDLE_DIR", raising=False)
    app = create_app(Settings(export_dir=str(tmp_path)), pool=object())
    app.dependency_overrides[site_design_access] = lambda: uuid.uuid4()
    app.dependency_overrides[site_rules_dep] = lambda: A.fake_rules()
    return TestClient(app), tmp_path


def seed(tmp: Path, pid, design: SiteDesign, bundle: dict | None):
    d = tmp / str(pid)
    d.mkdir(parents=True, exist_ok=True)
    (d / SITE_DESIGN_FILE).write_text(json.dumps(design.dump()))
    if bundle is not None:
        (d / "scene_bundle.json").write_text(json.dumps(bundle))


def test_api_serves_every_kind_with_status_headers(api, design, bundle):
    c, tmp = api
    pid = uuid.uuid4()
    seed(tmp, pid, design, bundle)
    for kind, ext in (("glb", "glb"), ("dxf", "dxf"), ("objects.csv", "csv"), ("objects.json", "json"), ("checks.csv", "csv"), ("checks.json", "json"),
                      ("stormwater.csv", "csv"), ("stormwater.json", "json")):
        r = c.get(f"/projects/{pid}/exports/{kind}")
        assert r.status_code == 200, (kind, r.text[:200])
        assert f".{ext}" in r.headers["content-disposition"] and r.headers["x-terrain-status"].startswith("INDICATIVE")
        assert len(r.content) > 50
    assert c.get(f"/projects/{pid}/exports/glb").content[:4] == b"glTF"
    assert c.get(f"/projects/{pid}/exports/dxf?version=R12").status_code == 200
    assert c.get(f"/projects/{pid}/exports/dxf?version=R14").status_code == 422
    assert c.get(f"/projects/{pid}/exports/pdf").status_code in (404, 422)


def test_api_project_without_a_design_or_bundle_exports_with_data_not_available(api):
    c, _ = api
    r = c.get(f"/projects/{uuid.uuid4()}/exports/dxf")
    assert r.status_code == 200 and b"TERRAIN DATA NOT AVAILABLE" in r.content.upper()


def test_api_building_glb_upload_and_merge(api, design, bundle):
    c, tmp = api
    pid = uuid.uuid4()
    seed(tmp, pid, design, bundle)
    b = next(o for o in design.objects if o.type == "building")
    assert c.put(f"/projects/{pid}/exports/building-glb/{b.id}", content=b"junk").status_code in (400, 422)
    assert c.put(f"/projects/{pid}/exports/building-glb/nope", content=_tiny_glb()).status_code in (404, 422)
    r = c.put(f"/projects/{pid}/exports/building-glb/{b.id}", content=_tiny_glb())
    assert r.status_code in (200, 201, 204)
    j, _ = chunks(c.get(f"/projects/{pid}/exports/glb").content)
    node = next(n for n in j["nodes"] if n.get("name") == b.id)
    assert node.get("children")


def test_dxf_layer_table_for_docs_is_generated():
    t = XL.export_element_table_markdown()
    assert t.count("\n") >= len(XL.TYPE_CODES)
    doc = Path(__file__).parents[2] / "docs" / "11-jcesite-layer-and-drawing-codes.md"
    assert t in doc.read_text(encoding="utf-8"), "docs/11 must carry the generated stage 11 export layer table"
