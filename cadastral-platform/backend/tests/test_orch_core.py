"""Orchestrator tests with fake in-memory agents (state lives in PostgreSQL)."""
import time
from collections import Counter
from uuid import UUID

import pytest

from app.agents.base import AgentError
from app.common.contracts import AgentCode, RunStatus
from app.orchestrator.core import GateBlocked, Orchestrator, record_tokens
from app.orchestrator.context import current_invocation
from app.orchestrator.inputs import RunRequest
from app.orchestrator.registry import AgentRegistry, default_registry
from test_orch_support import (ALL_ACKS, ack_all, events, fast_config, invocations, make_orch,  # noqa: F401
                               make_project, make_user, pool, dsn, world)


def req(project, **kw):
    return RunRequest(project_id=project, params={"lotplan": "12//DP345678"}, **kw)


def go(orch, uid, project, **kw):
    run = orch.create_run(uid, req(project, **kw))
    return run, orch.execute_run(run.run_id, uid)


def test_full_dag_success_and_logs(pool, world):
    uid, project = world
    ack_all(pool, uid, project)
    orch, calls = make_orch(pool)
    run, out = go(orch, uid, project)
    assert out.status is RunStatus.succeeded
    assert set(out.nodes) == {"SA1", "SA2", "ENV", "SA3", "SA4", "SA5", "SA6"}
    assert all(n.status == "succeeded" for n in out.nodes.values())
    inv = invocations(pool, uid, run.run_id)
    assert len(inv) == 7 and all(i["status"] == "succeeded" and not i["cache_hit"] for i in inv)
    ev = [e["event"] for e in events(pool, uid, run.run_id)]
    assert ev.count("spawned") == 1 + 7 and ev.count("handoff") == 7 and ev[-1] == "succeeded"
    assert orch.get_run(run.run_id, uid)["status"] == "succeeded"


def test_retry_then_success(pool, world):
    uid, project = world
    def flaky(n, payload):
        if n < 3:
            raise AgentError("UPSTREAM_5XX", "boom")
    orch, calls = make_orch(pool, behaviors={AgentCode.SA1_CADASTRE: flaky})
    run, out = go(orch, uid, project, targets=["SA1"])
    assert out.status is RunStatus.succeeded and calls["SA1_CADASTRE"] == 3
    inv = invocations(pool, uid, run.run_id, "SA1_CADASTRE")
    assert [(i["attempt"], i["status"]) for i in inv] == [(1, "failed"), (2, "failed"), (3, "succeeded")]
    assert len(events(pool, uid, run.run_id, "retry")) == 2


def test_permanent_failure_preserves_partial_results(pool, world):
    uid, project = world
    def bad(n, payload):
        raise AgentError("VALIDATION_FAILED", "invalid geometry")
    orch, calls = make_orch(pool, behaviors={AgentCode.SA2_DCP_RAG: bad})
    run, out = go(orch, uid, project)
    assert out.status is RunStatus.failed
    assert calls["SA2_DCP_RAG"] == 1                      # no retry for validation failures
    assert out.nodes["SA1"].status == "succeeded" and out.nodes["SA1"].output_ref
    assert out.nodes["SA2"].error_code == "VALIDATION_FAILED"
    assert {n for n, r in out.nodes.items() if r.status == "skipped"} == {"ENV", "SA3", "SA4", "SA5", "SA6"}


def test_retries_exhausted(pool, world):
    uid, project = world
    def down(n, payload):
        raise AgentError("UPSTREAM_UNAVAILABLE", "nsw api down")
    orch, calls = make_orch(pool, behaviors={AgentCode.SA1_CADASTRE: down})
    run, out = go(orch, uid, project, targets=["SA1"])
    assert out.status is RunStatus.failed and calls["SA1_CADASTRE"] == 3
    assert len(invocations(pool, uid, run.run_id)) == 3


def test_stub_agents_fail_not_implemented(pool, world):
    uid, project = world
    reg = default_registry()
    from app.orchestrator.registry import StubAgent
    reg.register(AgentCode.SA1_CADASTRE, lambda: StubAgent(AgentCode.SA1_CADASTRE))   # SA1 is real by default now
    orch = Orchestrator(pool, reg, fast_config())
    run, out = go(orch, uid, project, targets=["SA1"])
    assert out.status is RunStatus.failed and out.nodes["SA1"].error_code == "NOT_IMPLEMENTED"
    assert len(invocations(pool, uid, run.run_id)) == 1


def test_real_agent_import_failure_is_contained():
    reg = default_registry()
    a = reg.get(AgentCode.SA7_PDF_ALIGN)   # may or may not exist yet; must never raise
    assert a.code is AgentCode.SA7_PDF_ALIGN
    reg2 = AgentRegistry()
    reg2.register_import_path(AgentCode.SA5_CAD_DXF, "no.such.module:Thing")
    assert reg2.get(AgentCode.SA5_CAD_DXF).error_code == "AGENT_UNAVAILABLE"
    assert AgentCode.SA5_CAD_DXF in reg2.load_errors


def test_timeout_retried_then_fails(pool, world):
    uid, project = world
    def slow(n, payload):
        time.sleep(0.4)
    orch, calls = make_orch(pool, behaviors={AgentCode.SA1_CADASTRE: slow}, max_retries=1,
                            node_deadline_ms={"SA1": 100})
    run, out = go(orch, uid, project, targets=["SA1"])
    assert out.status is RunStatus.failed and out.nodes["SA1"].error_code == "TIMEOUT"
    assert [i["error_code"] for i in invocations(pool, uid, run.run_id)] == ["TIMEOUT", "TIMEOUT"]


def test_cache_hit_on_second_run(pool, world):
    uid, project = world
    ack_all(pool, uid, project)
    orch, calls = make_orch(pool)
    go(orch, uid, project)
    first = dict(calls)
    run2, out2 = go(orch, uid, project)
    assert out2.status is RunStatus.succeeded
    assert dict(calls) == first                                  # nothing re-executed
    assert all(n.cache_hit for n in out2.nodes.values())
    inv = invocations(pool, uid, run2.run_id)
    assert len(inv) == 7 and all(i["cache_hit"] for i in inv)
    assert len(events(pool, uid, run2.run_id, "cache_hit")) == 7


def test_changed_input_invalidates_downstream_only(pool, world):
    uid, project = world
    ack_all(pool, uid, project)
    orch, calls = make_orch(pool)
    go(orch, uid, project)
    # different SA2 behaviour is not an input change; change the request params instead
    run2 = orch.create_run(uid, RunRequest(project_id=project, params={"lotplan": "other"}))
    out = orch.execute_run(run2.run_id, uid)
    assert not out.nodes["SA1"].cache_hit            # new request hash -> SA1 reruns


def test_token_budget_stop_and_resume(pool, world):
    uid, project = world
    def llm(n, payload):
        ctx = current_invocation()
        ctx.ensure_budget()
        if n == 1:
            ctx.record_tokens("test-model", fresh=800, output=300)   # blows the 1000 budget
    orch, calls = make_orch(pool, behaviors={AgentCode.SA2_DCP_RAG: llm})
    run = orch.create_run(uid, req(project, targets=["ENV"], token_budget=1000))
    out = orch.execute_run(run.run_id, uid)
    assert out.status is RunStatus.waiting_user
    assert out.nodes["SA1"].status == "succeeded" and out.nodes["SA2"].status == "budget_stopped"
    info = orch.get_run(run.run_id, uid)
    assert info["status"] == "waiting_user" and info["tokens_used"] == 1100
    assert any(e["detail"].get("reason") == "token_budget_exhausted"
               for e in events(pool, uid, run.run_id, "user_input_requested"))
    orch.extend_budget(run.run_id, uid, 5000)
    out2 = orch.execute_run(run.run_id, uid)
    assert out2.status is RunStatus.succeeded and out2.nodes["SA1"].cache_hit


def test_token_budget_blocks_llm_node_before_start(pool, world):
    uid, project = world
    orch, calls = make_orch(pool)
    run = orch.create_run(uid, req(project, targets=["SA2"], token_budget=100))
    with pool.connection() as conn:        # pretend earlier spend used the whole budget
        conn.execute("UPDATE agents.runs SET tokens_used=100 WHERE run_id=%s", (run.run_id,))
    out = orch.execute_run(run.run_id, uid)
    assert out.status is RunStatus.waiting_user and calls["SA2_DCP_RAG"] == 0


def test_record_tokens_ledger(pool, world):
    uid, project = world
    orch, _ = make_orch(pool)
    run, _out = go(orch, uid, project, targets=["SA1"])
    inv = invocations(pool, uid, run.run_id)[0]
    from app.common.db import user_connection
    with user_connection(pool, uid) as conn:
        iid = conn.execute("SELECT invocation_id FROM agents.invocations WHERE run_id=%s", (run.run_id,)).fetchone()["invocation_id"]
        st = record_tokens(conn, run.run_id, iid, "m", fresh=10, cache_write=20, cache_read=30, output=5)
    assert st.tokens_used == 65


def test_export_gate_blocks_then_resumes(pool, world):
    uid, project = world
    orch, calls = make_orch(pool)
    run, out = go(orch, uid, project)
    assert out.status is RunStatus.blocked_by_gate
    assert out.nodes["SA5"].status == "blocked_by_gate" and out.nodes["SA6"].status == "blocked_by_gate"
    assert calls["SA5_CAD_DXF"] == 0 and calls["SA6_GLIDE3D"] == 0
    gates = events(pool, uid, run.run_id, "gate_blocked")
    assert len(gates) == 2 and set(gates[0]["detail"]["missing"]) == set(ALL_ACKS)
    ack_all(pool, uid, project)
    out2 = orch.execute_run(run.run_id, uid)
    assert out2.status is RunStatus.succeeded
    assert out2.nodes["SA3"].cache_hit and not out2.nodes["SA5"].cache_hit


def test_create_run_requires_terms(pool):
    uid = make_user(pool, accepted=False)
    owner = make_user(pool)
    project = make_project(pool, owner)
    orch, _ = make_orch(pool)
    with pytest.raises(GateBlocked) as e:
        orch.create_run(uid, req(project))
    assert e.value.code == "TERMS_NOT_ACCEPTED"


def test_create_run_requires_project_access(pool, world):
    _, project = world
    stranger = make_user(pool)
    orch, _ = make_orch(pool)
    with pytest.raises(GateBlocked) as e:
        orch.create_run(stranger, req(project))
    assert e.value.code == "PROJECT_ACCESS_DENIED"


def test_cancel_preserves_finished_nodes(pool, world):
    uid, project = world
    holder = {}
    def sa1(n, payload):
        orch.cancel_run(holder["run"], uid)          # user cancels while SA1 is running
    orch, calls = make_orch(pool, behaviors={AgentCode.SA1_CADASTRE: sa1})
    run = orch.create_run(uid, req(project))
    holder["run"] = run.run_id
    out = orch.execute_run(run.run_id, uid)
    assert out.status is RunStatus.cancelled
    assert out.nodes["SA1"].status == "succeeded" and out.nodes["SA1"].output_ref
    assert calls["SA2_DCP_RAG"] == 0
    assert orch.get_run(run.run_id, uid)["status"] == "cancelled"
    assert orch.cancel_run(run.run_id, uid) is False


def test_parallel_execution(pool, world):
    uid, project = world
    ack_all(pool, uid, project)
    import threading
    barrier = threading.Barrier(2, timeout=5)
    def meet(n, payload):
        barrier.wait()                                  # SA2 and SA7 must be in flight together
    upload = None
    with pool.connection() as conn:
        pass
    orch, _ = make_orch(pool)
    # SA7 needs a plan_uploads row; create one
    from app.common.db import user_connection
    with user_connection(pool, uid) as conn:
        upload = conn.execute(
            "INSERT INTO plans.plan_uploads (project_id, uploaded_by, original_filename, storage_uri, file_sha256, "
            "byte_size, page_count, content_class, upload_rights_acknowledged) "
            "VALUES (%s,%s,'a.pdf','file:///x/a.pdf',%s,10,1,'vector',true) RETURNING upload_id",
            (project, uid, b"\x01" * 32)).fetchone()["upload_id"]
    orch, _ = make_orch(pool, behaviors={AgentCode.SA2_DCP_RAG: meet, AgentCode.SA7_PDF_ALIGN: meet})
    run, out = go(orch, uid, project, upload_id=upload)
    assert out.status is RunStatus.succeeded and "SA7" in out.nodes
