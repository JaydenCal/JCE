"""Master Orchestrator.

Responsibilities (docs/01-orchestration-topology.md sections 1, 5, 7):
  * legal gate before a run exists (GateBlocked) and before exports (export_gate_missing)
  * parallel execution of the run DAG on a thread pool
  * idempotency cache (agents.invocations) with cache_hit invocations
  * retries with exponential backoff (new attempt row each time), per-call timeouts
  * append-only state_log for every transition; token ledger and budget enforcement
  * cancellation, partial-result preservation, run status finalisation

All database access runs inside ``user_connection`` so ``app.user_id`` is set and RLS
applies. The orchestrator acts as the requesting user.

Threading note: Python cannot kill a thread. On timeout the attempt is recorded as failed
(TIMEOUT) and the agent thread is abandoned (daemon); its late result is discarded.
"""
from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from contextvars import copy_context
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping
from uuid import UUID

from psycopg import Connection
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool
from pydantic import BaseModel, ValidationError

from app.agents.base import AgentError
from app.common.contracts import (
    AgentCode, Envelope, PayloadRef, RunStatus, idempotency_key,
)
from app.common.db import get_payload, put_payload, user_connection
from app.orchestrator import dag as dagmod
from app.orchestrator.context import (
    BUDGET_EXHAUSTED, InvocationContext, TokenState, set_current,
)
from app.orchestrator.dag import NodeSpec
from app.orchestrator.inputs import BuildContext, InputError, RunRequest, build_input
from app.orchestrator.registry import AgentRegistry, default_registry

log = logging.getLogger(__name__)

RETRYABLE_CODES = frozenset(
    {"TIMEOUT", "UPSTREAM_UNAVAILABLE", "UPSTREAM_5XX", "TRANSIENT", "INTERNAL_ERROR"}
)
TERMINAL = {RunStatus.succeeded.value, RunStatus.failed.value, RunStatus.cancelled.value}
EXECUTABLE = {RunStatus.queued.value, RunStatus.waiting_user.value, RunStatus.blocked_by_gate.value}


class GateBlocked(Exception):
    """A legal gate refused the operation."""

    def __init__(self, code: str, detail: str = "", missing: list[str] | None = None) -> None:
        super().__init__(f"{code}: {detail}")
        self.code, self.detail, self.missing = code, detail, missing or []


class RunNotFound(Exception):
    pass


class InvalidRunState(Exception):
    pass


@dataclass
class OrchestratorConfig:
    max_retries: int = 2                 # retries after the first attempt (3 attempts max)
    backoff_base_s: float = 0.5
    backoff_max_s: float = 8.0
    max_parallel: int = 4
    default_deadline_ms: int = 120_000
    default_token_budget: int = 200_000
    export_dir: str = "./var/exports"
    poll_interval_s: float = 0.2
    node_deadline_ms: Mapping[str, int] = field(default_factory=dict)


@dataclass
class NodeResult:
    node: str
    status: str    # succeeded|failed|blocked_by_gate|budget_stopped|cancelled|skipped
    output: dict | None = None
    output_ref: PayloadRef | None = None
    invocation_id: UUID | None = None
    error_code: str | None = None
    cache_hit: bool = False
    attempts: int = 0


@dataclass
class RunOutcome:
    run_id: UUID
    status: RunStatus
    nodes: dict[str, NodeResult]


@dataclass
class RunInfo:
    run_id: UUID
    project_id: UUID
    user_id: UUID
    terms_version_id: UUID
    status: str
    token_budget: int
    tokens_used: int
    plan: dict


def log_event(
    conn: Connection, run_id: UUID, event: str, *, invocation_id: UUID | None = None,
    from_agent: AgentCode | None = None, to_agent: AgentCode | None = None,
    payload_id: UUID | None = None, detail: dict | None = None,
) -> None:
    """Append one row to agents.state_log."""
    conn.execute(
        "INSERT INTO agents.state_log (run_id, invocation_id, event, from_agent, to_agent, payload_id, detail) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (run_id, invocation_id, event, from_agent.value if from_agent else None,
         to_agent.value if to_agent else None, payload_id, Jsonb(detail or {})),
    )


def record_tokens(
    conn: Connection, run_id: UUID, invocation_id: UUID, model_id: str, *,
    fresh: int = 0, cache_write: int = 0, cache_read: int = 0, output: int = 0,
    cost_aud_micros: int = 0,
) -> TokenState:
    """Write one agents.token_ledger row (fresh, cache-write, cache-read and output tokens
    metered separately). The DB trigger rolls the total into agents.runs.tokens_used."""
    conn.execute(
        "INSERT INTO agents.token_ledger (run_id, invocation_id, model_id, input_tokens_fresh, "
        "input_tokens_cache_write, input_tokens_cache_read, output_tokens, cost_aud_micros) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
        (run_id, invocation_id, model_id, fresh, cache_write, cache_read, output, cost_aud_micros),
    )
    return _token_state(conn, run_id)


def _token_state(conn: Connection, run_id: UUID) -> TokenState:
    r = conn.execute("SELECT tokens_used, token_budget FROM agents.runs WHERE run_id = %s", (run_id,)).fetchone()
    if r is None:
        raise RunNotFound(str(run_id))
    return TokenState(r["tokens_used"], r["token_budget"])


def _call_with_timeout(fn, timeout_s: float):
    box: dict[str, Any] = {}
    ctx = copy_context()

    def target() -> None:
        try:
            box["v"] = ctx.run(fn)
        except BaseException as e:  # noqa: BLE001 - re-raised in caller
            box["e"] = e

    t = threading.Thread(target=target, daemon=True, name="agent-call")
    t.start()
    t.join(timeout_s)
    if t.is_alive():
        raise AgentError("TIMEOUT", f"agent exceeded {timeout_s:.1f}s deadline")
    if "e" in box:
        raise box["e"]
    return box["v"]


class Orchestrator:
    def __init__(
        self, pool: ConnectionPool, registry: AgentRegistry | None = None,
        config: OrchestratorConfig | None = None,
    ) -> None:
        self.pool = pool
        self.registry = registry or default_registry()
        self.cfg = config or OrchestratorConfig()

    # ------------------------------------------------------------------ runs

    def create_run(self, user_id: UUID, request: RunRequest) -> RunInfo:
        """Create a queued run. Refuses unless the user accepted the current Terms."""
        with user_connection(self.pool, user_id) as conn:
            ok = conn.execute(
                "SELECT legal.has_accepted_current_terms(%s) AS ok", (user_id,)).fetchone()["ok"]
            if not ok:
                log.warning("create_run refused: terms not accepted user=%s project=%s",
                            user_id, request.project_id)
                raise GateBlocked("TERMS_NOT_ACCEPTED", "current Terms not accepted")
            if not conn.execute("SELECT core.can_access_project(%s) AS ok",
                                (request.project_id,)).fetchone()["ok"]:
                raise GateBlocked("PROJECT_ACCESS_DENIED", str(request.project_id))
            terms = conn.execute(
                "SELECT terms_version_id FROM legal.terms_versions WHERE is_current").fetchone()
            plan = dagmod.build_plan(request.targets, with_plan_upload=request.upload_id is not None)
            budget = request.token_budget or self.cfg.default_token_budget
            plan_json = {
                "dag_version": 1,
                "nodes": dagmod.plan_to_json(plan),
                "request": request.model_dump(mode="json"),
            }
            row = conn.execute(
                "INSERT INTO agents.runs (project_id, requested_by, terms_version_id, plan_json, token_budget) "
                "VALUES (%s,%s,%s,%s,%s) RETURNING run_id",
                (request.project_id, user_id, terms["terms_version_id"], Jsonb(plan_json), budget),
            ).fetchone()
            run_id = row["run_id"]
            log_event(conn, run_id, "spawned", from_agent=AgentCode.ORCH,
                      detail={"nodes": list(plan), "token_budget": budget})
            return RunInfo(run_id, request.project_id, user_id, terms["terms_version_id"],
                           "queued", budget, 0, plan_json)

    def load_run(self, run_id: UUID, user_id: UUID) -> RunInfo:
        with user_connection(self.pool, user_id) as conn:
            r = conn.execute(
                "SELECT * FROM agents.runs WHERE run_id = %s AND core.can_access_project(project_id)",
                (run_id,)).fetchone()
        if r is None:
            raise RunNotFound(str(run_id))
        return RunInfo(r["run_id"], r["project_id"], r["requested_by"], r["terms_version_id"],
                       r["status"], r["token_budget"], r["tokens_used"], r["plan_json"])

    def get_run(self, run_id: UUID, user_id: UUID, *, log_limit: int = 200) -> dict:
        info = self.load_run(run_id, user_id)
        with user_connection(self.pool, user_id) as conn:
            run = conn.execute("SELECT * FROM agents.runs WHERE run_id = %s", (run_id,)).fetchone()
            inv = conn.execute(
                "SELECT i.invocation_id, i.agent::text AS agent, i.attempt, i.status::text AS status, "
                "i.cache_hit, i.error_code, i.error_detail, i.started_at, i.finished_at, "
                "i.output_payload_id, encode(p.sha256,'hex') AS output_sha256 "
                "FROM agents.invocations i LEFT JOIN agents.payloads p ON p.payload_id = i.output_payload_id "
                "WHERE i.run_id = %s ORDER BY i.started_at NULLS LAST, i.attempt", (run_id,)).fetchall()
            events = conn.execute(
                "SELECT log_id, logged_at, event, invocation_id, from_agent::text AS from_agent, "
                "to_agent::text AS to_agent, detail FROM agents.state_log WHERE run_id = %s "
                "ORDER BY log_id DESC LIMIT %s", (run_id, log_limit)).fetchall()
        return {
            "run_id": run["run_id"], "project_id": run["project_id"],
            "status": str(run["status"]), "token_budget": run["token_budget"],
            "tokens_used": run["tokens_used"], "started_at": run["started_at"],
            "finished_at": run["finished_at"], "created_at": run["created_at"],
            "plan": info.plan.get("nodes", []), "invocations": inv, "events": list(reversed(events)),
        }

    def cancel_run(self, run_id: UUID, user_id: UUID) -> bool:
        """Mark the run cancelled. A running executor notices within poll_interval_s, starts
        no new nodes, and keeps finished outputs. Returns False if already terminal."""
        self.load_run(run_id, user_id)
        with user_connection(self.pool, user_id) as conn:
            r = conn.execute(
                "UPDATE agents.runs SET status='cancelled', finished_at=now() "
                "WHERE run_id=%s AND status NOT IN ('succeeded','failed','cancelled') RETURNING run_id",
                (run_id,)).fetchone()
            if r:
                log_event(conn, run_id, "cancelled", from_agent=AgentCode.ORCH, detail={"by": str(user_id)})
        return r is not None

    def extend_budget(self, run_id: UUID, user_id: UUID, new_budget: int) -> None:
        """Raise the token budget (e.g. after the user approves more spend)."""
        with user_connection(self.pool, user_id) as conn:
            conn.execute("UPDATE agents.runs SET token_budget=%s WHERE run_id=%s AND token_budget < %s",
                         (new_budget, run_id, new_budget))
            log_event(conn, run_id, "progress", from_agent=AgentCode.ORCH,
                      detail={"token_budget_raised_to": new_budget})

    # ------------------------------------------------------------- execution

    def execute_run(self, run_id: UUID, user_id: UUID) -> RunOutcome:
        """Run (or resume) the DAG. Resuming is cheap: finished nodes are idempotency-cache hits."""
        info = self.load_run(run_id, user_id)
        if info.status not in EXECUTABLE:
            raise InvalidRunState(f"run {run_id} is {info.status}")
        plan = dagmod.subgraph([n["node"] for n in info.plan["nodes"]])
        request = RunRequest.model_validate(info.plan["request"])
        with user_connection(self.pool, user_id) as conn:
            conn.execute("UPDATE agents.runs SET status='running', started_at=COALESCE(started_at, now()), "
                         "finished_at=NULL WHERE run_id=%s", (run_id,))
            log_event(conn, run_id, "started", from_agent=AgentCode.ORCH)

        results: dict[str, NodeResult] = {}
        pending = set(plan)
        running: dict[Future, str] = {}
        order = dagmod.topological_order(plan)
        cancelled = False
        with ThreadPoolExecutor(max_workers=self.cfg.max_parallel, thread_name_prefix=f"run-{str(run_id)[:8]}") as ex:
            while pending or running:
                if not cancelled and self._status(run_id, user_id) == RunStatus.cancelled.value:
                    cancelled = True
                if not cancelled:
                    changed = True
                    while changed:
                        changed = False
                        for nid in [n for n in order if n in pending]:
                            node = plan[nid]
                            parents = [p for p in node.all_parents if p in plan]
                            if any(p not in results for p in parents):
                                continue
                            bad = [p for p in node.deps if results[p].status != "succeeded"]
                            soft = [p for p in node.after if p in plan and results[p].status != "succeeded"]
                            if soft and not node.tolerate_after_failure:
                                bad += soft
                            pending.discard(nid)
                            if bad:
                                results[nid] = NodeResult(nid, "skipped", error_code="UPSTREAM_NOT_SUCCEEDED")
                                with user_connection(self.pool, user_id) as conn:
                                    log_event(conn, run_id, "progress", from_agent=AgentCode.ORCH,
                                              to_agent=node.agent,
                                              detail={"node": nid, "skipped": True, "blocked_by": bad})
                                changed = True
                                continue
                            upstream = {k: r.output for k, r in results.items()
                                        if r.status == "succeeded" and r.output is not None}
                            fut = ex.submit(self._run_node, info, request, node, upstream,
                                            [results[p].invocation_id for p in parents
                                             if results[p].invocation_id], run_id)
                            running[fut] = nid
                if not running:
                    break
                done, _ = wait(list(running), timeout=self.cfg.poll_interval_s, return_when=FIRST_COMPLETED)
                for fut in done:
                    nid = running.pop(fut)
                    try:
                        results[nid] = fut.result()
                    except Exception as exc:  # defensive: _run_node should not raise
                        log.exception("node %s crashed", nid)
                        results[nid] = NodeResult(nid, "failed", error_code="ORCH_INTERNAL", )
                        with user_connection(self.pool, user_id) as conn:
                            log_event(conn, run_id, "failed", from_agent=AgentCode.ORCH,
                                      detail={"node": nid, "error": repr(exc)})

        return self._finalise(run_id, user_id, plan, results, cancelled)

    def _status(self, run_id: UUID, user_id: UUID) -> str:
        with user_connection(self.pool, user_id) as conn:
            r = conn.execute("SELECT status::text AS s FROM agents.runs WHERE run_id=%s", (run_id,)).fetchone()
        return r["s"] if r else RunStatus.cancelled.value

    def _finalise(self, run_id, user_id, plan, results, cancelled) -> RunOutcome:
        statuses = {r.status for r in results.values()}
        if cancelled or self._status(run_id, user_id) == RunStatus.cancelled.value:
            final = RunStatus.cancelled
        elif "failed" in statuses:
            final = RunStatus.failed
        elif "budget_stopped" in statuses:
            final = RunStatus.waiting_user
        elif "blocked_by_gate" in statuses:
            final = RunStatus.blocked_by_gate
        else:
            final = RunStatus.succeeded
        summary = {n: {"status": r.status, "error_code": r.error_code, "cache_hit": r.cache_hit,
                       "output_payload_id": str(r.output_ref.payload_id) if r.output_ref else None}
                   for n, r in results.items()}
        with user_connection(self.pool, user_id) as conn:
            if final != RunStatus.cancelled:
                terminal = final.value in TERMINAL
                conn.execute(
                    "UPDATE agents.runs SET status=%s::agents.run_status, "
                    "finished_at=CASE WHEN %s THEN now() ELSE NULL END "
                    "WHERE run_id=%s AND status <> 'cancelled'", (final.value, terminal, run_id))
            log_event(conn, run_id, "checkpoint", from_agent=AgentCode.ORCH,
                      detail={"run_status": final.value, "nodes": summary,
                              "not_started": sorted(set(plan) - set(results))})
            ev = {"succeeded": "succeeded", "failed": "failed", "cancelled": "cancelled"}.get(final.value)
            if ev:
                log_event(conn, run_id, ev, from_agent=AgentCode.ORCH, detail={"run_status": final.value})
        return RunOutcome(run_id, final, results)

    # ------------------------------------------------------------ node logic

    def _run_node(self, run: RunInfo, request: RunRequest, node: NodeSpec,
                  upstream: dict[str, dict], dep_invocations: list[UUID], run_id: UUID) -> NodeResult:
        uid = run.user_id
        agent = self.registry.get(node.agent)
        nid = node.node_id
        try:
            # 1. export gate: applies even when the result would be a cache hit
            if node.export_gate:
                with user_connection(self.pool, uid) as conn:
                    gate = self._export_gate(conn, run)
                    if gate:
                        log_event(conn, run_id, "gate_blocked", from_agent=AgentCode.ORCH,
                                  to_agent=node.agent, detail={"node": nid, **gate})
                        return NodeResult(nid, "blocked_by_gate", error_code=gate["reason"])

            # 2. build + validate + store input
            with user_connection(self.pool, uid) as conn:
                bctx = BuildContext(run_id, run.project_id, uid, request, conn, self.cfg.export_dir, upstream)
                try:
                    raw = build_input(nid, bctx)
                    model = agent.input_model.model_validate(raw)
                except InputError as e:
                    return self._fail_early(conn, run_id, node, e.code, e.detail)
                except ValidationError as e:
                    return self._fail_early(conn, run_id, node, "VALIDATION_FAILED", str(e)[:2000])
                in_dict = model.model_dump(mode="json")
                in_ref = put_payload(conn, node.input_schema, in_dict)
                key = idempotency_key(node.agent, in_ref.sha256, agent.version)

                # 3. idempotency cache
                hit = self._cache_hit(conn, node, key)
                if hit:
                    out = get_payload(conn, hit["output_payload_id"])
                    inv = self._new_invocation(conn, run_id, node, agent, key, in_ref, dep_invocations,
                                               status="succeeded", cache_hit=True,
                                               output_payload_id=hit["output_payload_id"])
                    ref = self._ref(conn, hit["output_payload_id"])
                    log_event(conn, run_id, "cache_hit", invocation_id=inv, from_agent=node.agent,
                              to_agent=AgentCode.ORCH, payload_id=hit["output_payload_id"],
                              detail={"node": nid, "idempotency_key": key})
                    return NodeResult(nid, "succeeded", out, ref, inv, cache_hit=True, attempts=0)

                # 4. token budget (LLM nodes only)
                if node.llm:
                    st = _token_state(conn, run_id)
                    if st.exhausted:
                        log_event(conn, run_id, "user_input_requested", from_agent=AgentCode.ORCH,
                                  to_agent=node.agent,
                                  detail={"node": nid, "reason": "token_budget_exhausted",
                                          "tokens_used": st.tokens_used, "token_budget": st.token_budget})
                        return NodeResult(nid, "budget_stopped", error_code=BUDGET_EXHAUSTED)
        except Exception as exc:  # DB or builder failure
            log.exception("node %s setup failed", nid)
            return NodeResult(nid, "failed", error_code="ORCH_INTERNAL")

        return self._attempt_loop(run, node, agent, key, in_ref, in_dict, dep_invocations, run_id)

    @staticmethod
    def _cache_hit(conn, node: NodeSpec, key: str):
        """The earlier succeeded invocation with this idempotency key, or None. A node that is not cacheable (SA6: its output depends on live terrain and aerial services that its
        input does not describe, so a rebuild must recompute) never gets a hit."""
        if not node.cacheable:
            return None
        return conn.execute(
            "SELECT i.output_payload_id FROM agents.invocations i "
            "WHERE i.idempotency_key=%s AND i.status='succeeded' AND i.output_payload_id IS NOT NULL "
            "ORDER BY i.finished_at DESC LIMIT 1", (key,)).fetchone()

    def _fail_early(self, conn, run_id, node, code, detail) -> NodeResult:
        log_event(conn, run_id, "failed", from_agent=AgentCode.ORCH, to_agent=node.agent,
                  detail={"node": node.node_id, "error_code": code, "error_detail": detail})
        return NodeResult(node.node_id, "failed", error_code=code)

    def _ref(self, conn, payload_id) -> PayloadRef:
        r = conn.execute("SELECT payload_id, encode(sha256,'hex') AS sha, schema_name, byte_size "
                         "FROM agents.payloads WHERE payload_id=%s", (payload_id,)).fetchone()
        return PayloadRef(payload_id=r["payload_id"], sha256=r["sha"], schema_name=r["schema_name"],
                          byte_size=r["byte_size"])

    def _export_gate(self, conn: Connection, run: RunInfo) -> dict | None:
        if not conn.execute("SELECT legal.has_accepted_current_terms(%s) AS ok", (run.user_id,)).fetchone()["ok"]:
            return {"reason": "TERMS_REACCEPTANCE_REQUIRED", "missing": []}
        missing = conn.execute("SELECT legal.export_gate_missing(%s,%s)::text[] AS m",
                               (run.project_id, run.user_id)).fetchone()["m"]
        if missing:
            return {"reason": "ACKNOWLEDGEMENTS_MISSING", "missing": list(missing)}
        return None

    def _new_invocation(self, conn, run_id, node, agent, key, in_ref, deps, *, status,
                        cache_hit=False, output_payload_id=None) -> UUID:
        conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"{run_id}:{node.agent.value}",))
        row = conn.execute(
            "INSERT INTO agents.invocations (run_id, agent, attempt, depends_on, status, idempotency_key, "
            "input_payload_id, output_payload_id, agent_version, model_id, cache_hit, started_at, finished_at) "
            "SELECT %s, %s::agents.agent_code, COALESCE(MAX(attempt),0)+1, %s, %s::agents.run_status, %s, %s, %s, %s, %s, %s, "
            "now(), CASE WHEN %s::agents.run_status IN ('succeeded','failed') THEN now() END "
            "FROM agents.invocations WHERE run_id=%s AND agent=%s::agents.agent_code RETURNING invocation_id",
            (run_id, node.agent.value, list(deps), status, key, in_ref.payload_id, output_payload_id,
             agent.version, getattr(agent, "model_id", None), cache_hit, status, run_id, node.agent.value),
        ).fetchone()
        return row["invocation_id"]

    def _deadline_s(self, node: NodeSpec, agent) -> float:
        ms = self.cfg.node_deadline_ms.get(node.node_id) or getattr(agent, "deadline_ms", None) \
            or self.cfg.default_deadline_ms
        return ms / 1000.0

    def _attempt_loop(self, run, node, agent, key, in_ref, in_dict, deps, run_id) -> NodeResult:
        uid, nid = run.user_id, node.node_id
        max_attempts = self.cfg.max_retries + 1
        deadline_s = self._deadline_s(node, agent)
        for attempt_no in range(1, max_attempts + 1):
            with user_connection(self.pool, uid) as conn:
                inv = self._new_invocation(conn, run_id, node, agent, key, in_ref, deps, status="running")
                st = _token_state(conn, run_id)
                env = Envelope(run_id=run_id, invocation_id=inv, sender=AgentCode.ORCH, recipient=node.agent,
                               schema_name=node.input_schema, idempotency_key=key,
                               terms_version_id=run.terms_version_id, token_budget=max(st.remaining, 1),
                               payload_ref=in_ref, deadline_ms=int(deadline_s * 1000))
                log_event(conn, run_id, "spawned", invocation_id=inv, from_agent=AgentCode.ORCH,
                          to_agent=node.agent, payload_id=in_ref.payload_id,
                          detail={"node": nid, "attempt": attempt_no, "envelope": env.model_dump(by_alias=True, mode="json")})
                log_event(conn, run_id, "started", invocation_id=inv, from_agent=node.agent,
                          detail={"node": nid, "attempt": attempt_no})
            ictx = self._invocation_context(run, inv, node)
            try:
                out_model = _call_with_timeout(lambda: self._invoke(agent, in_dict, ictx), deadline_s)
                out = out_model.model_dump(mode="json") if isinstance(out_model, BaseModel) else out_model
                if not isinstance(out, dict):
                    raise AgentError("BAD_OUTPUT", f"agent returned {type(out_model).__name__}, expected a model")
            except AgentError as e:
                code, detail = e.error_code, e.detail
            except ValidationError as e:
                code, detail = "VALIDATION_FAILED", str(e)[:2000]
            except Exception as e:  # noqa: BLE001
                log.exception("agent %s crashed", node.agent.value)
                code, detail = "INTERNAL_ERROR", f"{type(e).__name__}: {e}"
            else:
                with user_connection(self.pool, uid) as conn:
                    out_ref = put_payload(conn, node.output_schema, out)
                    conn.execute("UPDATE agents.invocations SET status='succeeded', output_payload_id=%s, "
                                 "finished_at=now() WHERE invocation_id=%s", (out_ref.payload_id, inv))
                    log_event(conn, run_id, "succeeded", invocation_id=inv, from_agent=node.agent,
                              detail={"node": nid, "attempt": attempt_no})
                    log_event(conn, run_id, "handoff", invocation_id=inv, from_agent=node.agent,
                              to_agent=AgentCode.ORCH, payload_id=out_ref.payload_id,
                              detail={"node": nid, "schema": node.output_schema})
                return NodeResult(nid, "succeeded", out, out_ref, inv, attempts=attempt_no)

            budget_stop = code == BUDGET_EXHAUSTED
            will_retry = code in RETRYABLE_CODES and attempt_no < max_attempts
            with user_connection(self.pool, uid) as conn:
                conn.execute("UPDATE agents.invocations SET status='failed', error_code=%s, error_detail=%s, "
                             "finished_at=now() WHERE invocation_id=%s", (code, detail[:4000], inv))
                if will_retry:
                    delay = min(self.cfg.backoff_base_s * (2 ** (attempt_no - 1)), self.cfg.backoff_max_s)
                    log_event(conn, run_id, "retry", invocation_id=inv, from_agent=AgentCode.ORCH,
                              to_agent=node.agent, detail={"node": nid, "attempt": attempt_no,
                                                           "error_code": code, "backoff_s": delay})
                elif budget_stop:
                    log_event(conn, run_id, "user_input_requested", invocation_id=inv,
                              from_agent=node.agent, to_agent=AgentCode.ORCH,
                              detail={"node": nid, "reason": "token_budget_exhausted"})
                else:
                    log_event(conn, run_id, "failed", invocation_id=inv, from_agent=node.agent,
                              detail={"node": nid, "attempt": attempt_no, "error_code": code,
                                      "error_detail": detail[:2000]})
            if will_retry:
                time.sleep(delay)
                continue
            return NodeResult(nid, "budget_stopped" if budget_stop else "failed",
                              invocation_id=inv, error_code=code, attempts=attempt_no)
        raise AssertionError("unreachable")

    @staticmethod
    def _invoke(agent, in_dict: dict, ictx: InvocationContext):
        tok = set_current(ictx)
        try:
            return agent.run(agent.input_model.model_validate(in_dict))
        finally:
            tok.var.reset(tok)

    def _invocation_context(self, run: RunInfo, inv: UUID, node: NodeSpec) -> InvocationContext:
        uid, run_id = run.user_id, run.run_id

        def rec(model_id, **kw) -> TokenState:
            with user_connection(self.pool, uid) as conn:
                return record_tokens(conn, run_id, inv, model_id, fresh=kw["fresh"],
                                     cache_write=kw["cache_write"], cache_read=kw["cache_read"],
                                     output=kw["output"], cost_aud_micros=kw["cost_aud_micros"])

        def state() -> TokenState:
            with user_connection(self.pool, uid) as conn:
                return _token_state(conn, run_id)

        return InvocationContext(run_id, inv, node.agent, rec, state)
