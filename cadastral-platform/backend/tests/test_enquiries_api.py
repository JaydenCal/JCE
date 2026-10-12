"""POST /enquiries against the scratch DB (skipped unless TEST_DATABASE_URL with 001 + 004 loaded)."""
import uuid

import pytest
from fastapi.testclient import TestClient
from psycopg.conninfo import make_conninfo

from app.api.app import create_app
from app.api.enquiries import CONSENT_VERSION, TokenBucket
from app.api.settings import Settings
from app.common.db import make_pool, user_connection
from app.notify import CompositeNotifier, OutboxNotifier, deliver
from test_orch_support import make_orch, make_project, make_user, pool, dsn  # noqa: F401

PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF"
FORM = {"name": "Jo Citizen", "email": "jo@example.com", "message": "Need a driveway", "consent": "true",
        "consent_version": CONSENT_VERSION, "enquiry_types": ["civil_design", "services"], "role": "builder"}


class Fake:
    name = "fake"

    def __init__(self, fail=False):
        self.fail, self.notified, self.acked = fail, [], []

    def notify(self, m):
        if self.fail:
            raise RuntimeError("smtp down")
        self.notified.append(m)

    def acknowledge(self, m):
        self.acked.append(m)


@pytest.fixture
def env(pool, tmp_path, monkeypatch):
    with pool.connection() as c:
        if c.execute("SELECT to_regclass('core.enquiries') AS t").fetchone()["t"] is None:
            pytest.skip("db/004_enquiries.sql not loaded")
    monkeypatch.setenv("ENQUIRY_UPLOAD_DIR", str(tmp_path / "up"))
    app = create_app(Settings(upload_dir=str(tmp_path), export_dir=str(tmp_path)), pool=pool, orchestrator=make_orch(pool)[0])
    app.state.enquiry_notifier = Fake()
    app.state.enquiry_bucket = TokenBucket(capacity=100)
    return app, TestClient(app)


def row(pool, ref):
    with pool.connection() as c:
        return c.execute("SELECT * FROM core.enquiries WHERE reference=%s", (ref,)).fetchone()


def test_anonymous_submit_stores_notifies_acks(env, pool):
    app, c = env
    r = c.post("/enquiries", data=FORM, files=[("files", ("p.pdf", PDF, "application/pdf"))])
    assert r.status_code == 201, r.text
    ref = r.json()["reference"]
    d = row(pool, ref)
    assert d["submitter_user_id"] is None and d["status"] == "new" and d["referral_partner"] == "JCE Infrastructure"
    assert d["enquiry_types"] == ["civil_design", "services"] and d["attachments"][0]["sha256"]
    assert d["notified_at"] and d["acknowledged_at"] and d["notify_error"] is None and d["share_context"] is False
    n = app.state.enquiry_notifier
    assert n.notified[0].reference == ref and n.acked[0].email == "jo@example.com"


def test_logged_in_project_and_context_only_when_shared(env, pool):
    app, c = env
    uid = make_user(pool)
    pid = make_project(pool, uid)
    ctx = '{"lot":"1/DP1","zoning":"R2"}'
    r = c.post("/enquiries", headers={"X-User-Id": str(uid)}, data={**FORM, "project_id": str(pid), "share_context": "true", "context_json": ctx})
    d = row(pool, r.json()["reference"])
    assert d["submitter_user_id"] == uid and d["project_id"] == pid and d["context_json"] == {"lot": "1/DP1", "zoning": "R2"}
    r = c.post("/enquiries", headers={"X-User-Id": str(uid)}, data={**FORM, "project_id": str(pid), "context_json": ctx})
    d = row(pool, r.json()["reference"])
    assert d["share_context"] is False and d["context_json"] is None


def test_foreign_project_404_and_anonymous_project_ignored(env, pool):
    app, c = env
    owner, other = make_user(pool), make_user(pool)
    pid = make_project(pool, owner)
    assert c.post("/enquiries", headers={"X-User-Id": str(other)}, data={**FORM, "project_id": str(pid)}).status_code == 404
    r = c.post("/enquiries", data={**FORM, "project_id": str(pid)})
    assert r.status_code == 201 and row(pool, r.json()["reference"])["project_id"] is None


def test_validation_errors_and_no_consent(env):
    _, c = env
    r = c.post("/enquiries", data={**FORM, "consent": "false"})
    assert r.status_code == 422 and "consent" in r.json()["fields"]
    assert c.post("/enquiries", data={**FORM, "email": "bad"}).json()["code"] == "VALIDATION_FAILED"


def test_attachment_rejected(env):
    _, c = env
    r = c.post("/enquiries", data=FORM, files=[("files", ("x.exe", b"MZ", "application/octet-stream"))])
    assert r.status_code == 415


def test_honeypot_stores_nothing(env, pool):
    _, c = env
    r = c.post("/enquiries", data={**FORM, "website": "http://spam"})
    assert r.status_code == 201 and row(pool, r.json()["reference"]) is None


def test_rate_limit_bucket_and_db(env, pool, monkeypatch):
    app, c = env
    app.state.enquiry_bucket = TokenBucket(capacity=2, refill_per_sec=0)
    assert [c.post("/enquiries", data=FORM).status_code for _ in range(3)] == [201, 201, 429]
    app.state.enquiry_bucket = TokenBucket(capacity=100)
    monkeypatch.setattr("app.api.enquiries.DB_LIMIT_PER_HOUR", 1)
    monkeypatch.setenv("ENQUIRY_TRUST_XFF", "1")
    h = {"X-Forwarded-For": "203.0.113.%d" % (uuid.uuid4().int % 250 + 1)}
    assert c.post("/enquiries", data=FORM, headers=h).status_code == 201
    assert c.post("/enquiries", data=FORM, headers=h).status_code == 429    # DB count backstop (fresh bucket)


def test_email_failure_never_loses_enquiry_and_retry_works(env, pool):
    app, c = env
    app.state.enquiry_notifier = bad = Fake(fail=True)
    ref = c.post("/enquiries", data=FORM).json()["reference"]
    d = row(pool, ref)
    assert d["notified_at"] is None and "smtp down" in d["notify_error"] and d["notify_attempts"] == 1 and d["message"]
    good = Fake()
    from app.notify import retry_pending
    assert retry_pending(pool, good) >= 1
    d = row(pool, ref)
    assert d["notified_at"] and d["acknowledged_at"] and d["notify_error"] is None


def test_retry_endpoint_needs_token(env, monkeypatch):
    _, c = env
    assert c.post("/enquiries/retry").status_code == 403
    monkeypatch.setenv("ENQUIRY_PARTNER_TOKEN", "s3cret")
    assert c.post("/enquiries/retry", headers={"X-Partner-Token": "s3cret"}).status_code == 200


def test_rls_submitter_reads_own_partner_reads_all(env, pool, dsn):
    app, c = env
    u1, u2 = make_user(pool), make_user(pool)
    ref = c.post("/enquiries", headers={"X-User-Id": str(u1)}, data=FORM).json()["reference"]
    anon_ref = c.post("/enquiries", data=FORM).json()["reference"]
    with pool.connection() as conn:
        if not conn.execute("SELECT rolsuper FROM pg_roles WHERE rolname=current_user").fetchone()["rolsuper"]:
            pytest.skip("need superuser")
        for r in ("enq_app_test", "enq_partner_test"):
            conn.execute(f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{r}') THEN CREATE ROLE {r} LOGIN; END IF; END $$")
        conn.execute("GRANT enquiry_partner TO enq_partner_test")
        for r in ("enq_app_test", "enq_partner_test"):
            conn.execute(f"GRANT USAGE ON SCHEMA core TO {r}")
            conn.execute(f"GRANT SELECT, INSERT ON core.enquiries TO {r}")
            conn.execute(f"GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA core TO {r}")
    app_pool = make_pool(make_conninfo(dsn, user="enq_app_test"), min_size=1, max_size=2)
    partner_pool = make_pool(make_conninfo(dsn, user="enq_partner_test"), min_size=1, max_size=2)
    try:
        with user_connection(app_pool, u1) as conn:
            assert [r["reference"] for r in conn.execute("SELECT reference FROM core.enquiries WHERE reference IN (%s,%s)", (ref, anon_ref))] == [ref]
        with user_connection(app_pool, u2) as conn:
            assert conn.execute("SELECT count(*) AS n FROM core.enquiries WHERE reference=%s", (ref,)).fetchone()["n"] == 0
        with user_connection(app_pool, None) as conn:
            assert conn.execute("SELECT count(*) AS n FROM core.enquiries").fetchone()["n"] == 0
        with user_connection(partner_pool, None) as conn:
            assert conn.execute("SELECT count(*) AS n FROM core.enquiries WHERE reference IN (%s,%s)", (ref, anon_ref)).fetchone()["n"] == 2
        with pytest.raises(Exception):      # cannot impersonate another submitter on insert
            with user_connection(app_pool, u2) as conn:
                conn.execute("INSERT INTO core.enquiries (reference,submitter_user_id,name,email,message,consent_version,consent_at) "
                             "VALUES ('ENQ-X',%s,'a','a@b.c','m','v',now())", (u1,))
    finally:
        app_pool.close(); partner_pool.close()
