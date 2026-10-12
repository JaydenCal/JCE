"""API tests (FastAPI TestClient against the real schema)."""
import io
import uuid

import pytest
from fastapi.testclient import TestClient

from app.api.app import create_app
from app.api.settings import Settings
from test_orch_support import ack_all, make_orch, make_project, make_user, pool, dsn, world  # noqa: F401


def pdf_bytes(pages=1) -> bytes:
    from pypdf import PdfWriter
    w = PdfWriter()
    for _ in range(pages):
        w.add_blank_page(width=842, height=595)
    b = io.BytesIO()
    w.write(b)
    return b.getvalue()


@pytest.fixture
def client(pool, tmp_path):
    orch, _ = make_orch(pool)
    app = create_app(Settings(upload_dir=str(tmp_path / "up"), export_dir=str(tmp_path / "ex"),
                              max_upload_bytes=200_000), pool=pool, orchestrator=orch)
    return TestClient(app)


def H(uid):
    return {"X-User-Id": str(uid)}


def test_endpoints_require_terms(client, pool):
    uid = make_user(pool, accepted=False)
    owner = make_user(pool)
    project = make_project(pool, owner)
    for method, url, kw in [
        ("post", "/runs", {"json": {"project_id": str(project)}}),
        ("get", f"/runs/{uuid.uuid4()}", {}),
        ("post", f"/runs/{uuid.uuid4()}/cancel", {}),
        ("post", f"/projects/{project}/acknowledgements", {"json": {"kinds": ["cadastre_not_survey"]}}),
        ("post", f"/projects/{project}/plans", {"files": {"file": ("a.pdf", pdf_bytes(), "application/pdf")},
                                                "data": {"upload_rights_warranty": "true"}}),
    ]:
        r = getattr(client, method)(url, headers=H(uid), **kw)
        assert r.status_code == 403 and r.json()["code"] == "TERMS_NOT_ACCEPTED", url


def test_missing_user_header(client):
    assert client.get(f"/runs/{uuid.uuid4()}").status_code == 401


def test_legal_flow(client, pool):
    uid = make_user(pool, accepted=False)
    t = client.get("/legal/terms/current", headers=H(uid)).json()
    assert t["accepted"] is False
    body = {"terms_version_id": t["terms_version_id"], "body_sha256": t["body_sha256"], "scrolled_to_end": True}
    assert client.post("/legal/accept", headers=H(uid), json={**body, "scrolled_to_end": False}).status_code == 422
    assert client.post("/legal/accept", headers=H(uid), json={**body, "body_sha256": "0" * 64}).json()["code"] == "DIGEST_MISMATCH"
    r = client.post("/legal/accept", headers=H(uid), json=body)
    assert r.status_code == 201 and r.json()["accepted"]
    assert client.post("/legal/accept", headers=H(uid), json=body).json()["already_accepted"] is True
    assert client.get("/legal/terms/current", headers=H(uid)).json()["accepted"] is True
    with pool.connection() as conn:
        row = conn.execute("SELECT user_agent, scrolled_to_end FROM legal.terms_acceptances WHERE user_id=%s", (uid,)).fetchone()
    assert row["scrolled_to_end"] and row["user_agent"]


def test_run_lifecycle(client, pool, world):
    uid, project = world
    ack_all(pool, uid, project)
    r = client.post("/runs", headers=H(uid), json={"project_id": str(project), "params": {"x": 1}})
    assert r.status_code == 202
    run_id = r.json()["run_id"]
    g = client.get(f"/runs/{run_id}", headers=H(uid)).json()      # background task already ran
    assert g["status"] == "succeeded" and len(g["invocations"]) == 7
    assert client.post(f"/runs/{run_id}/cancel", headers=H(uid)).json()["cancelled"] is False
    stranger = make_user(pool)
    assert client.get(f"/runs/{run_id}", headers=H(stranger)).status_code == 404


def test_acknowledgements(client, world):
    uid, project = world
    r = client.post(f"/projects/{project}/acknowledgements", headers=H(uid),
                    json={"kinds": ["cadastre_not_survey", "cadastre_not_survey"]})
    assert r.status_code == 201 and r.json()["recorded"] == 1
    assert "cadastre_not_survey" not in r.json()["export_gate_missing"]
    assert len(r.json()["export_gate_missing"]) == 8
    assert client.post(f"/projects/{project}/acknowledgements", headers=H(uid), json={"kinds": ["bogus"]}).status_code == 422


def test_plan_upload(client, pool, world):
    uid, project = world
    url = f"/projects/{project}/plans"
    ok = lambda b=None, ct="application/pdf", rights="true": client.post(  # noqa: E731
        url, headers=H(uid), files={"file": ("plan.pdf", b if b is not None else pdf_bytes(2), ct)},
        data={"upload_rights_warranty": rights})
    r = ok()
    assert r.status_code == 201, r.text
    j = r.json()
    assert j["page_count"] == 2 and len(j["sha256"]) == 64
    with pool.connection() as conn:
        row = conn.execute("SELECT encode(file_sha256,'hex') h, storage_uri, status FROM plans.plan_uploads WHERE upload_id=%s",
                           (j["upload_id"],)).fetchone()
        assert row["h"] == j["sha256"] and row["storage_uri"].startswith("file://")
        assert conn.execute("SELECT count(*) n FROM agents.runs WHERE run_id=%s", (j["run_id"],)).fetchone()["n"] == 1
        assert conn.execute("SELECT count(*) n FROM legal.project_acknowledgements WHERE project_id=%s AND kind='upload_rights_warranty'",
                            (project,)).fetchone()["n"] == 1
    assert ok(ct="image/png").status_code == 415
    assert ok(b=b"GIF89a" + b"0" * 100).json()["code"] == "NOT_A_PDF"
    assert ok(b=b"%PDF-1.7\n" + b"0" * 300_000).json()["code"] == "FILE_TOO_LARGE"
    assert ok(b=b"%PDF-1.7\ngarbage").json()["code"] == "PDF_UNREADABLE"
    assert ok(b=pdf_bytes() + b"\n1 0 obj << /S /JavaScript /JS (app.alert(1)) >> endobj").json()["code"] == "PDF_ACTIVE_CONTENT"
    assert ok(rights="false").json()["code"] == "UPLOAD_RIGHTS_REQUIRED"
    assert client.post(f"/projects/{uuid.uuid4()}/plans", headers=H(uid),
                       files={"file": ("p.pdf", pdf_bytes(), "application/pdf")},
                       data={"upload_rights_warranty": "true"}).status_code == 404
