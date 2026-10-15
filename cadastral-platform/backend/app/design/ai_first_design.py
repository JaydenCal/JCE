"""AI first design (stage 10): the orchestrator.

Two stages, because some decisions depend on others. Stage 1 builds the independent sets (driveway, rainwater tank position, sewer route, water route); the choices are applied
to a working copy of the design; stage 2 builds the sets that need those objects (stormwater links, retaining walls at the boundary, landscape areas). Each stage asks the model
(``ai_select``) only about sets that have a real choice; everything else, and any model failure, goes to the deterministic chooser.

The result is ONE batch of registry operations (``add_object`` with origin ai_proposal, and ``set_param`` for link edits), the proposals (one per set, with the reason, the checks, the
operations of that proposal and the operations that undo it), the sets skipped with the reason, and the inputs the user must still enter. The batch is validated here against the
Pydantic model by applying it to a copy of the design. The browser runs it through ``runBatch`` with ``atomic`` so it is one undo step. Buildings are never created or moved.

NOTHING IN A PROPOSAL IS A NUMBER THE MODEL WROTE. See ``ai_candidates`` and ``ai_select``.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Callable

from app.common.statement import AI_DRAFT_STATEMENT

from . import ai_guard as GU
from . import engine_limits as EL
from .ai_candidates import (Candidate, CandidateSet, Ctx, GenerateError, _set_id, apply_steps, gen_driveway, gen_landscape, gen_sewer, gen_stormwater, gen_tank, gen_walls, gen_water,
                            make_ctx, primary_buildings)
from .ai_batch_guard import BatchRefused, assert_ai_batch
from .ai_select import AI_LABEL, RULES_LABEL, SYSTEM, TOOLS, Choice, build_prompt, decidable, rules_choice, run_selection
from .assistant.llm import LlmClient, LlmResponse, Usage
from .object_checks import check_design
from .site_design import SiteDesign
from .site_rules import SiteRules
from .terrain_source import SiteTerrain

SCHEMA = "first_design.v1"
STAGE1 = ("driveway", "tank", "sewer", "water")
STAGE2 = ("stormwater", "walls", "landscape")


def stage1_sets(ctx: Ctx) -> list[CandidateSet]:
    sets = [gen_driveway(ctx)]
    for i, b in enumerate(primary_buildings(ctx)):
        sets += [gen_tank(ctx, b, _set_id("tank", i)), gen_sewer(ctx, b, _set_id("sewer", i)), gen_water(ctx, b, _set_id("water", i))]
    if len(sets) > EL.MAX_AI_SETS:
        ctx.notes.append(f"ONLY THE FIRST {EL.MAX_AI_SETS} SETS ARE BUILT: THE OTHER BUILDINGS ARE NOT DESIGNED FOR IN THIS RUN")
        sets = sets[:EL.MAX_AI_SETS]
    return sets


def stage2_sets(ctx: Ctx) -> list[CandidateSet]:
    return [gen_stormwater(ctx), gen_walls(ctx), gen_landscape(ctx)]


def chosen(sets: list[CandidateSet], choices: dict[str, Choice]) -> list[tuple[CandidateSet, Candidate, Choice]]:
    out = []
    for s in sets:
        ch = choices.get(s.id)
        c = s.get(ch.candidate_id) if ch is not None and ch.candidate_id else None
        if ch is not None and c is not None:
            out.append((s, c, ch))
    return out


def rules_choices(sets: list[CandidateSet]) -> dict[str, Choice]:
    return {s.id: ch for s in sets if (ch := rules_choice(s)) is not None}


@dataclass
class Plan:
    """Everything that is computed without the model: the stage 1 sets, the stage 2 sets as the rules would leave them, and the prompts."""
    design: SiteDesign
    rules: SiteRules
    terrain: SiteTerrain | None
    today: date | None
    ctx1: Ctx
    sets1: list[CandidateSet]
    choices1: dict[str, Choice]
    ctx2: Ctx
    sets2: list[CandidateSet]
    notes: list[str] = field(default_factory=list)


def make_plan(design: SiteDesign, rules: SiteRules, terrain: SiteTerrain | None, today: date | None = None, *, deadline_s: float | None = None) -> Plan:
    ctx1 = make_ctx(design, rules, terrain, today, deadline_s=deadline_s)
    sets1 = stage1_sets(ctx1)
    choices1 = rules_choices(sets1)
    ctx2, sets2 = stage2(ctx1, sets1, choices1, deadline_s)
    return Plan(design, rules, terrain, today, ctx1, sets1, choices1, ctx2, sets2)


def stage2(ctx1: Ctx, sets1: list[CandidateSet], choices1: dict[str, Choice], deadline_s: float | None = None) -> tuple[Ctx, list[CandidateSet]]:
    steps = [s for _set, c, _ch in chosen(sets1, choices1) for s in c.steps()]
    try:
        work = apply_steps(ctx1.design, steps) if steps else ctx1.design
    except ValueError as e:
        raise GenerateError("BATCH_INVALID", f"THE STAGE 1 CHOICES DO NOT FIT THE DESIGN MODEL: {str(e)[:200]}") from None
    ctx2 = make_ctx(work, ctx1.rules, ctx1.terrain, ctx1.today, deadline_s=deadline_s)
    ctx2.taken().update(ctx1.taken())                                  # an id made in stage 1 (chosen or not) is never made again in stage 2
    return ctx2, stage2_sets(ctx2)


# ---------------------------------------------------------------------------------------------------------------------------------- the estimate
def estimate(plan: Plan, cfg: GU.AiConfig, *, will_use_ai: bool) -> dict[str, Any]:
    """The cost before anything is spent: the prompts of the stages that have a real choice, the system prompt and tool definitions (priced as a cache write), and the output
    at the bound. ``cost_usd`` is for the expected calls (one a stage); ``max_cost_usd`` for every turn of the loop, and the confirm step uses the larger."""
    rounds = [build_prompt([s for s in ss if decidable(s)]) for ss in (plan.sets1, plan.sets2) if any(decidable(s) for s in ss)]
    sys_tokens = GU.estimate_tokens(SYSTEM + str(TOOLS))
    prompt_tokens = sum(GU.estimate_tokens(p) for p in rounds)
    if not will_use_ai or not rounds:
        zero = GU.estimate_request(cfg, prompt_tokens=0, system_tokens=0, calls=0)
        return {**zero, "rounds": 0, "max_cost_usd": 0.0, "max_calls": 0, "model": cfg.model, "uses_ai": False, "requires_confirm": False, "prompt_tokens": prompt_tokens,
                "reason": "NO SET HAS MORE THAN ONE POSSIBLE CHOICE, SO THE RULES DECIDE AND NO MODEL CALL IS MADE" if will_use_ai else "THE AI IS OFF OR NOT CONFIGURED, SO THE RULES DECIDE"}
    n = len(rounds)
    exp = GU.estimate_request(cfg, prompt_tokens=prompt_tokens // n, system_tokens=sys_tokens, calls=n)
    worst = GU.estimate_request(cfg, prompt_tokens=2 * (prompt_tokens // n), system_tokens=sys_tokens, calls=n * cfg.max_turns)
    return {**exp, "rounds": n, "max_calls": n * cfg.max_turns, "max_cost_usd": worst["cost_usd"], "max_cost_micros": worst["cost_micros"], "model": cfg.model, "uses_ai": True,
            "requires_confirm": worst["cost_usd"] > cfg.confirm_usd + 1e-12, "prompt_tokens": prompt_tokens, "reason": ""}


# ---------------------------------------------------------------------------------------------------------------------------------- the run
def _proposal(s: CandidateSet, c: Candidate, ch: Choice, model: str) -> dict[str, Any]:
    by = RULES_LABEL if ch.by == "rules" else f"{AI_LABEL} ({model})"
    return {"id": s.id, "set_id": s.id, "kind": s.kind, "title": s.title, "candidate_id": c.cid, "summary": c.summary, "reason": ch.reason, "selected_by": by, "selected_by_ai": ch.by == "ai",
            "steps": c.steps(), "revert_steps": c.revert_steps(), "object_ids": c.object_ids(), "edited_ids": list(dict.fromkeys(e["id"] for e in c.edits)), "checks": c.checks,
            "counts": c.public()["counts"], "blocked": c.blocked, "flags": c.flags, "required_inputs": c.required_inputs,
            "alternatives": [{"id": o.cid, "summary": o.summary, "blocked": o.blocked} for o in s.candidates if o.cid != c.cid]}


def execute(plan: Plan, cfg: GU.AiConfig, client: LlmClient | None, *, use_ai: bool = True, on_response: Callable[[LlmResponse], None] | None = None,
            may_continue: Callable[[], bool] | None = None, deadline_s: float | None = None, deadline: float | None = None, cancelled: Callable[[], bool] | None = None,
            gate: GU.CallGate | None = None) -> dict[str, Any]:
    """``deadline`` is a ``time.monotonic()`` value shared by both rounds (default: ``MAX_AI_TOTAL_SECONDS`` from now): no model call is started after it and a late answer is ignored.
    ``cancelled`` is true when the request was given up. ``gate`` reserves and settles the spend of each call."""
    maxt = cfg.max_output_tokens
    t_end = deadline if deadline is not None else time.monotonic() + EL.MAX_AI_TOTAL_SECONDS
    sel_kw = dict(max_turns=cfg.max_turns, max_tokens=maxt, on_response=on_response, may_continue=may_continue, use_ai=use_ai, deadline=t_end, cancelled=cancelled, gate=gate)
    sel1 = run_selection(client, plan.sets1, **sel_kw)
    if {k: (v.candidate_id) for k, v in sel1.choices.items()} == {k: (v.candidate_id) for k, v in plan.choices1.items()}:
        ctx2, sets2 = plan.ctx2, plan.sets2                            # the same working design as the rules left: stage 2 is already built
    else:
        ctx2, sets2 = stage2(plan.ctx1, plan.sets1, sel1.choices, deadline_s)
    sel2 = run_selection(client, sets2, **sel_kw)
    model = getattr(client, "model", cfg.model) if client is not None else cfg.model
    picks = chosen(plan.sets1, sel1.choices) + chosen(sets2, sel2.choices)
    proposals = [_proposal(s, c, ch, model) for s, c, ch in picks]
    batch = [st for p in proposals for st in p["steps"]]
    if len(batch) > EL.MAX_AI_BATCH_STEPS:
        raise EL.EngineLimitError(EL.AI_TOO_LARGE, f"THE BATCH HAS {len(batch)} OPERATIONS; AT MOST {EL.MAX_AI_BATCH_STEPS} ARE ACCEPTED")
    try:
        final = apply_steps(plan.design, batch)                       # the whole batch must fit the model
    except ValueError as e:
        raise GenerateError("BATCH_INVALID", f"THE BATCH DOES NOT FIT THE DESIGN MODEL: {str(e)[:200]}") from None
    try:
        assert_ai_batch(batch, plan.design)                            # the same guard the browser runs, before the batch leaves the server
    except BatchRefused as e:
        raise GenerateError("BATCH_REFUSED", f"THE BATCH WAS REFUSED BY THE SAFETY GUARD: {str(e)[:200]}") from None
    skipped = []
    for s in [*plan.sets1, *sets2]:
        ch = {**sel1.choices, **sel2.choices}.get(s.id)
        if not any(p["set_id"] == s.id for p in proposals):
            skipped.append({"set_id": s.id, "title": s.title, "reason": s.skipped or (ch.reason if ch is not None else "NOT PROPOSED"), "skipped_by": "generator" if s.skipped else (ch.by if ch else "rules"),
                            "required_inputs": s.required_inputs, "notes": s.notes[:4]})
    needed: list[str] = []
    for p in proposals:
        for r in p["required_inputs"]:
            if r not in needed:
                needed.append(r)
    full = check_design(final, plan.rules, plan.terrain, plan.today)
    blocking = [e for e in full["checks"] if e["severity"] == "blocking"]
    usage = Usage()
    for sel in (sel1, sel2):
        usage.add(sel.usage)
    ai_n = sum(1 for p in proposals if p["selected_by_ai"])
    ai_errors = [*sel1.errors, *sel2.errors]
    ai_notes = ([f"THE AI COULD NOT BE USED FOR EVERY SET ({ai_errors[0][:120]}): THE RULES DECIDED THE OTHERS AND THEY ARE LABELLED {RULES_LABEL}"] if ai_errors and use_ai else [])
    ai_notes += ([f"{sel1.late + sel2.late} ANSWER(S) ARRIVED AFTER THE DEADLINE AND WERE IGNORED; THEIR SPEND IS RECORDED"] if sel1.late + sel2.late else [])
    return {
        "schema": SCHEMA, "label": AI_DRAFT_STATEMENT, "mode": "ai" if ai_n else "rules", "selected_by": f"{AI_LABEL} ({model})" if ai_n else RULES_LABEL, "model": model if ai_n else None,
        "proposals": proposals, "skipped": skipped, "batch": batch, "required_inputs": needed, "design_version": plan.design.version,
        "final_checks": {"total": len(full["checks"]), "blocking": len(blocking), "warning": full["summary"]["warning"], "blocking_list": [
            {"id": e["id"], "object_id": e["object_id"], "code": e["code"], "message": " ".join(str(e["message"]).split())[:200]} for e in blocking[:10]]},
        "late_results_ignored": sel1.late + sel2.late,
        "usage": {"calls": sel1.calls + sel2.calls, "input_tokens": usage.input_tokens, "output_tokens": usage.output_tokens, "cache_read_tokens": usage.cache_read_tokens,
                  "cache_write_tokens": usage.cache_write_tokens, "cost_usd": round(GU.cost_micros(usage, cfg) / 1e6, 6)},
        "ai_errors": ai_errors[:4], "refused_tool_calls": len(sel1.refused) + len(sel2.refused),
        "notes": [*ai_notes, *plan.ctx1.notes, *ctx2.notes][:10] + (["THE TIME LIMIT WAS REACHED: NOT EVERYTHING WAS BUILT"] if plan.ctx1.truncated or ctx2.truncated else []),
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def plan_summary(plan: Plan) -> dict[str, Any]:
    """A compact view of the sets (for the estimate answer): counts only, no operations."""
    return {"sets": [{"id": s.id, "title": s.title, "candidates": len(s.candidates), "skipped": s.skipped, "asks_model": decidable(s)} for s in [*plan.sets1, *plan.sets2]]}
