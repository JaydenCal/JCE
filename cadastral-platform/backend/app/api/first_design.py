"""AI first design route (stage 10).

POST /projects/{id}/ai/first-design  body ``{"design": <site_design.v1>, "estimate": false, "confirm_large": false, "use_ai": true}``

* ``estimate`` true: the candidates are built (no model call, nothing spent) and the answer is the estimate: tokens, cost, whether a confirm step is needed and the sets. The
  front end shows this before it asks to run.
* otherwise: the design is built by the rules and, when the AI is on and configured, the model chooses among the prepared candidates. The answer is ONE batch of registry
  operations plus the proposals (reason, checks, the operations of each and the operations that undo it). Nothing is saved: the page runs the batch through ``runBatch`` (atomic, one
  undo step) and the user accepts, edits or rejects each proposal.

GUARDS (``ai_guard``, ported from Plan Studio): 503 AI_PAUSED when the daily or monthly spending cap is reached (or this request could pass it; nothing is charged), 409
CONFIRM_REQUIRED when the worst case cost is over the confirm threshold and ``confirm_large`` is not set, 429 RATE_LIMITED per project (per minute and per day). The order is
pause, confirm, rate limit (per project and global). With ``use_ai`` false, no key, or no set with a real choice, the rules decide and none of these applies. Before EACH model call the worst case cost of that call is reserved under the store lock together with the cap check and settled after it, so concurrent requests cannot pass the cap together. Spend is recorded for every call that returned, also one whose answer was ignored because the deadline passed; a call that failed records nothing. The 504 answer says how many calls were recorded.

Same access and caps as the other site design routes: terms accepted, project visible, 413 over 5 MB, caps by ``engine_limits`` (422), engines on a pool under the per project gate.
"""
from __future__ import annotations

import asyncio
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, ValidationError

from app.api.deps import ApiError
from app.api.site_design import (_engine_json, _limit_422, _project_gate, _run_engine, _terrain_or_none, limited_body, site_design_access, site_design_base, site_rules_dep)
from app.design import ai_first_design as F
from app.design import ai_guard as GU
from app.design import engine_limits as EL
from app.design.ai_candidates import GenerateError
from app.design.assistant.llm import AnthropicClient, LlmClient
from app.design.site_design import SiteDesign
from app.design.site_rules import SiteRules

router = APIRouter()
_AI_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="first-design-ai")
RUN_TIMEOUT_S = EL.MAX_AI_TOTAL_SECONDS + 2 * EL.MAX_AI_GENERATE_SECONDS + 15


class FirstDesignRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    design: SiteDesign
    estimate: bool = False
    confirm_large: bool = False
    use_ai: bool = True


def ai_config(request: Request) -> GU.AiConfig:
    """The AI settings: ``app.state.ai_config`` (tests) or the environment."""
    return getattr(request.app.state, "ai_config", None) or GU.AiConfig.from_env()


def ai_client(request: Request, cfg: GU.AiConfig) -> LlmClient | None:
    """The model client: ``app.state.first_design_llm`` (tests) or, when a key is set, the Anthropic client (no extended reasoning, bounded output). None without a key."""
    c = getattr(request.app.state, "first_design_llm", None)
    if c is not None:
        return c
    if not cfg.has_key:
        return None
    return AnthropicClient(api_key=cfg.api_key, model=cfg.model, timeout=cfg.timeout_s, reasoning=False, fallbacks=False, purpose="first_design")


async def _run_ai(project_id: UUID, work, gate: GU.CallGate | None = None, cancel: threading.Event | None = None):
    def guarded():
        try:
            return work()
        except EL.EngineLimitError as e:
            raise ApiError(422, e.code, e.message) from None
        except GenerateError as e:
            raise ApiError(500, e.code, e.message) from None
    async with _project_gate(project_id):
        try:
            return await asyncio.wait_for(asyncio.get_running_loop().run_in_executor(_AI_POOL, guarded), timeout=RUN_TIMEOUT_S)
        except asyncio.TimeoutError:
            if cancel is not None:
                cancel.set()                                   # no new model call is started and the answer of a call in flight is ignored (its spend is still recorded)
            n = gate.calls if gate is not None else 0
            raise ApiError(504, EL.AI_TIMEOUT, f"AI FIRST DESIGN TOOK TOO LONG AND NOTHING WAS APPLIED. SPEND RECORDED: {n} CALLS. A CALL STILL RUNNING IS RECORDED WHEN IT FINISHES. "
                           "TRY AGAIN, OR DESIGN BY THE RULES", calls_recorded=n) from None


def _refuse(r: GU.Refusal) -> ApiError:
    return ApiError(r.status, r.code, r.message, **r.extra)


@router.post("/projects/{project_id}/ai/first-design")
async def post_first_design(project_id: UUID, request: Request, _user: UUID = Depends(site_design_access), rules: SiteRules = Depends(site_rules_dep),
                            raw: bytes = Depends(limited_body)) -> JSONResponse:
    try:
        body = FirstDesignRequest.model_validate_json(raw)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors(include_url=False, include_context=False, include_input=False)) from None
    _limit_422(EL.check_site_design, body.design)
    if len(body.design.objects) > EL.MAX_AI_DESIGN_OBJECTS:
        raise ApiError(422, EL.AI_TOO_LARGE, f"THE DESIGN HAS {len(body.design.objects)} OBJECTS; AT MOST {EL.MAX_AI_DESIGN_OBJECTS} ARE ACCEPTED FOR AI FIRST DESIGN")
    base = site_design_base(request)
    cfg = ai_config(request)
    client = ai_client(request, cfg)
    will_use_ai = bool(body.use_ai and client is not None and getattr(client, "configured", True))
    store = GU.UsageStore(base)
    pid = str(project_id)

    plan = await _run_ai(project_id, lambda: F.make_plan(body.design, rules, _terrain_or_none(base, project_id), None))
    est = F.estimate(plan, cfg, will_use_ai=will_use_ai)
    now = time.time() * 1000
    if body.estimate:
        day, month = GU.period_keys(now)
        return _engine_json({"schema": "first_design_estimate.v1", "estimate": est, "ai_available": client is not None and getattr(client, "configured", True), "model": cfg.model,
                             "spend": {"day_usd": round(store.get_spend(day) / 1e6, 6), "day_cap_usd": cfg.daily_cap_usd, "month_usd": round(store.get_spend(month) / 1e6, 6),
                                       "month_cap_usd": cfg.monthly_cap_usd}, **F.plan_summary(plan)})
    if est["uses_ai"]:
        r = GU.global_pause(store, cfg, now, est["max_cost_micros"])
        if r is not None:
            raise _refuse(r)
        if est["requires_confirm"] and not body.confirm_large:
            raise ApiError(409, "CONFIRM_REQUIRED", "This request is estimated above the confirm threshold. Confirm to run it, or design by the rules.", estimate=est)
        r = GU.rate_limit(store, cfg, pid, now)
        if r is not None:
            raise _refuse(r)

    model = getattr(client, "model", cfg.model)
    cancel = threading.Event()
    gate = GU.CallGate(store, cfg, pid, model) if will_use_ai else None

    def run():
        return F.execute(plan, cfg, client if will_use_ai else None, use_ai=will_use_ai, may_continue=lambda: not cancel.is_set(), cancelled=cancel.is_set, gate=gate,
                         deadline=time.monotonic() + EL.MAX_AI_TOTAL_SECONDS)

    out = await _run_ai(project_id, run, gate, cancel)
    out["estimate"] = est
    return _engine_json(out)
