"""DB integration: terms gate, payload store, append-only log, RLS user context."""
import psycopg
import pytest

from app.common.db import get_payload, put_payload, set_user, user_connection
from app.orchestrator.inputs import RunRequest
from test_orch_support import make_orch, make_project, make_user, pool, dsn, world  # noqa: F401


def test_terms_gate_function(pool):
    u_no, u_yes = make_user(pool, accepted=False), make_user(pool)
    with pool.connection() as conn:
        f = "SELECT legal.has_accepted_current_terms(%s) AS ok"
        assert conn.execute(f, (u_no,)).fetchone()["ok"] is False
        assert conn.execute(f, (u_yes,)).fetchone()["ok"] is True


def test_payload_dedupe_and_roundtrip(pool):
    body = {"b": [1, 2, {"z": "é"}], "a": 1.5, "nonce": __import__("uuid").uuid4().hex}
    with pool.connection() as conn:
        r1 = put_payload(conn, "lot_context.v1", body)
        r2 = put_payload(conn, "lot_context.v1", dict(reversed(list(body.items()))))   # key order differs
        assert r1.payload_id == r2.payload_id and r1.sha256 == r2.sha256
        n = conn.execute("SELECT count(*) AS n FROM agents.payloads WHERE sha256=%s",
                         (bytes.fromhex(r1.sha256),)).fetchone()["n"]
        assert n == 1
        assert get_payload(conn, r1.payload_id) == body
        with pytest.raises(ValueError):
            put_payload(conn, "badname", {})


def test_state_log_is_append_only(pool, world):
    uid, project = world
    orch, _ = make_orch(pool)
    run = orch.create_run(uid, RunRequest(project_id=project))
    with pytest.raises(psycopg.Error):
        with pool.connection() as conn:
            conn.execute("UPDATE agents.state_log SET detail='{}' WHERE run_id=%s", (run.run_id,))
    with pytest.raises(psycopg.Error):
        with pool.connection() as conn:
            conn.execute("DELETE FROM agents.state_log WHERE run_id=%s", (run.run_id,))
    with pool.connection() as conn:
        assert conn.execute("SELECT count(*) AS n FROM agents.state_log WHERE run_id=%s",
                            (run.run_id,)).fetchone()["n"] == 1


def test_set_local_user_is_transaction_scoped(pool):
    uid = make_user(pool)
    with user_connection(pool, uid) as conn:
        assert conn.execute("SELECT core.current_user_id() AS u").fetchone()["u"] == uid
    with pool.connection() as conn:
        assert conn.execute("SELECT core.current_user_id() AS u").fetchone()["u"] is None
