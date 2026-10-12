"""Shared helpers for test_orch_*.py (fake agents, DB fixtures). Contains no tests."""
from __future__ import annotations

import hashlib
import os
import threading
import uuid
from collections import Counter
from typing import Callable

import pytest

from app.agents.base import AgentError
from app.common.contracts import AckKind, AgentCode
from app.common.db import make_pool, user_connection
from app.orchestrator.core import Orchestrator, OrchestratorConfig
from app.orchestrator.registry import AgentRegistry, AnyPayload, _STUB_SCHEMAS

ALL_ACKS = [k.value for k in AckKind]


class FakeAgent:
    """In-memory agent. ``behavior(call_no, payload)`` returns a dict or raises."""

    model_id = None
    input_model = AnyPayload

    def __init__(self, code: AgentCode, calls: Counter, behavior: Callable | None = None, version="test"):
        self.code = code
        self.version = version      # unique per registry so the global idempotency cache never leaks across tests
        self.input_schema, self.output_schema = _STUB_SCHEMAS[code]
        self._calls, self._behavior = calls, behavior
        self._lock = threading.Lock()

    def run(self, payload):
        with self._lock:
            self._calls[self.code.value] += 1
            n = self._calls[self.code.value]
        if self._behavior:
            out = self._behavior(n, payload)
            if out is not None:
                return AnyPayload(**out)
        return AnyPayload(**default_output(self.code))


def default_output(code: AgentCode) -> dict:
    if code is AgentCode.SA1_CADASTRE:
        return {"lot_id": "11111111-1111-1111-1111-111111111111", "jurisdiction": "NSW",
                "lga_name": "Hornsby", "mga_srid": 7856, "zone_code": "R2"}
    return {"agent": code.value, "ok": True}


def fake_registry(calls: Counter, behaviors: dict[AgentCode, Callable] | None = None) -> AgentRegistry:
    behaviors = behaviors or {}
    reg = AgentRegistry()
    version = "test-" + uuid.uuid4().hex[:8]
    for code in _STUB_SCHEMAS:
        reg.register(code, lambda c=code: FakeAgent(c, calls, behaviors.get(c), version))
    return reg


def fast_config(**kw) -> OrchestratorConfig:
    base = dict(backoff_base_s=0.0, poll_interval_s=0.02, export_dir="/tmp/orch-test-exports")
    base.update(kw)
    return OrchestratorConfig(**base)


@pytest.fixture(scope="session")
def dsn():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL not set")
    return url


@pytest.fixture(scope="session")
def pool(dsn):
    p = make_pool(dsn, min_size=1, max_size=12)
    with p.connection() as conn:
        if conn.execute("SELECT to_regclass('agents.runs') AS t").fetchone()["t"] is None:
            pytest.skip("db/001_schema.sql not loaded into TEST_DATABASE_URL")
        if conn.execute("SELECT count(*) AS n FROM legal.terms_versions WHERE is_current").fetchone()["n"] == 0:
            body = "Test terms " + uuid.uuid4().hex
            conn.execute(
                "INSERT INTO legal.terms_versions (version_label, effective_from, body_markdown, body_sha256, is_current) "
                "VALUES (%s, now(), %s, %s, true)",
                ("test-" + uuid.uuid4().hex[:8], body, hashlib.sha256(body.encode()).digest()))
    yield p
    p.close()


def make_user(pool, *, accepted: bool = True) -> uuid.UUID:
    uid = uuid.uuid4()
    with pool.connection() as conn:
        conn.execute("INSERT INTO core.users (user_id, email, display_name) VALUES (%s,%s,%s)",
                     (uid, f"{uid}@example.test", "Test User"))
    if accepted:
        accept_terms(pool, uid)
    return uid


def accept_terms(pool, uid) -> None:
    with user_connection(pool, uid) as conn:
        t = conn.execute("SELECT terms_version_id, body_sha256 FROM legal.terms_versions WHERE is_current").fetchone()
        conn.execute("INSERT INTO legal.terms_acceptances (user_id, terms_version_id, scrolled_to_end, body_sha256_seen) "
                     "VALUES (%s,%s,true,%s)", (uid, t["terms_version_id"], t["body_sha256"]))


def make_project(pool, owner) -> uuid.UUID:
    with user_connection(pool, owner) as conn:
        return conn.execute("INSERT INTO core.projects (owner_user_id, name, jurisdiction) "
                            "VALUES (%s, 'Test project', 'NSW') RETURNING project_id", (owner,)).fetchone()["project_id"]


def ack_all(pool, owner, project) -> None:
    with user_connection(pool, owner) as conn:
        t = conn.execute("SELECT terms_version_id FROM legal.terms_versions WHERE is_current").fetchone()
        for k in ALL_ACKS:
            conn.execute("INSERT INTO legal.project_acknowledgements (project_id,user_id,kind,terms_version_id) "
                         "VALUES (%s,%s,%s::legal.acknowledgement_kind,%s) ON CONFLICT DO NOTHING",
                         (project, owner, k, t["terms_version_id"]))


@pytest.fixture
def world(pool):
    uid = make_user(pool)
    return uid, make_project(pool, uid)


def make_orch(pool, calls=None, behaviors=None, **cfg) -> tuple[Orchestrator, Counter]:
    calls = calls if calls is not None else Counter()
    return Orchestrator(pool, fake_registry(calls, behaviors), fast_config(**cfg)), calls


def events(pool, uid, run_id, event: str | None = None):
    with user_connection(pool, uid) as conn:
        rows = conn.execute("SELECT event, detail, invocation_id FROM agents.state_log WHERE run_id=%s ORDER BY log_id",
                            (run_id,)).fetchall()
    return [r for r in rows if event is None or r["event"] == event]


def invocations(pool, uid, run_id, agent: str | None = None):
    with user_connection(pool, uid) as conn:
        rows = conn.execute("SELECT agent::text AS agent, attempt, status::text AS status, cache_hit, error_code "
                            "FROM agents.invocations WHERE run_id=%s ORDER BY agent, attempt", (run_id,)).fetchall()
    return [r for r in rows if agent is None or r["agent"] == agent]
