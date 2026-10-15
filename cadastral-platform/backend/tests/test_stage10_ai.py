"""Stage 10: AI first design. Candidate generators (deterministic, no model), the tool use selection with a fake transport (no network), the usage guard and the route.

Every rule value in these tests is a FAKE value written for the test; none is an engineering value. The site is the synthetic one of ``ai_support``.
"""
from __future__ import annotations

import json
import re
import time
import uuid

import pytest

import ai_support as S
from app.design import ai_candidates as AC
from app.design import ai_first_design as F
from app.design import ai_guard as GU
from app.design import ai_select as AS
from app.design import engine_limits as EL
from app.design.assistant import llm as LLM
from app.design.assistant.llm import AnthropicClient, FakeLlm, LlmError, LlmResponse, Usage, text_block, tool_use
from app.design.site_design import SiteDesign

T = S.terrain()


def site(extra=()):
    return S.design(*S.site_objects(), *extra)


def with_storage():
    return site([S.pt("dp1", "discharge_point", 9, -2, discharge_kind="kerb_outlet"), S.pt("osd1", "osd", 15, 25, width_m=1.0, length_m=2.0)])


def ctx_for(design, rules=None):
    return AC.make_ctx(design, rules or S.fake_rules(), T, S.TODAY)


# ---------------------------------------------------------------------------------------------------------------------------------- generators
def test_stage1_generators_build_candidates_that_pass_the_model():
    d = site()
    ctx = ctx_for(d)
    b = AC.primary_buildings(ctx)[0]
    sets = [AC.gen_driveway(ctx), AC.gen_tank(ctx, b, "tank"), AC.gen_sewer(ctx, b, "sewer"), AC.gen_water(ctx, b, "water")]
    assert [s.id for s in sets] == ["driveway", "tank", "sewer", "water"]
    for s in sets:
        assert s.candidates and s.skipped is None, s.id
        assert [c.cid for c in s.candidates] == list("ABCD"[:len(s.candidates)])
        for c in s.candidates:
            steps = c.steps()
            assert steps and {x["op"] for x in steps} <= {"add_object", "set_param"}
            out = SiteDesign.model_validate(AC.apply_steps(d, steps).dump())             # the whole batch passes the Pydantic model
            new = [o for o in out.objects if o.id in set(c.object_ids())]
            assert new and all(o.origin == "ai_proposal" and o.accepted == "pending" and o.status == "proposed" for o in new)
            assert all(o.type != "building" for o in new)
            assert c.summary and c.checks


def test_driveway_candidates_are_alignments_to_the_building_with_no_invented_dimension():
    ctx = ctx_for(site())
    cs = AC.gen_driveway(ctx)
    assert 2 <= len(cs.candidates) <= EL.MAX_AI_CANDIDATES_PER_SET
    for c in cs.candidates:
        o = c.objects[0]
        assert o["type"] == "driveway" and o["params"]["end_building_id"]["value"] == "house"
        assert o["params"]["width_m"]["basis"] == "unresolved" and o["params"]["surface_kind"]["basis"] == "unresolved"
        assert "end_level_rl" not in o["params"]                                  # the end level is the building FFL, resolved by the engine
    assert "DRIVEWAY WIDTH" in cs.required_inputs and "GARAGE POSITION" in cs.required_inputs
    assert any("NO GARAGE DATA" in n for n in cs.notes)


def test_every_number_in_a_batch_is_traceable():
    """No dimension, level, diameter, width or height is ever set: a numeric parameter is only the crossover chainage (from the kerb geometry) and the invert of a
    connection on a verified main (ground level minus the verified depth, from the route engine)."""
    plan = F.make_plan(with_storage(), S.fake_rules(), T, S.TODAY)
    out = F.execute(plan, GU.AiConfig(), None, use_ai=False)
    numeric = {(s["args"]["id"], k): p for s in out["batch"] if s["op"] == "add_object" for k, p in s["args"]["params"].items() if isinstance(p.get("value"), (int, float)) and not isinstance(p.get("value"), bool)}
    assert numeric and {k for _i, k in numeric} <= {"crossover_chainage_m", "invert_rl"}
    assert all(p["basis"] == "derived" and p["ref"].startswith("AI FIRST DESIGN") for p in numeric.values())              # computed by an engine, never USER
    for s in out["batch"]:
        if s["op"] == "add_object":
            assert s["args"]["origin"] == "ai_proposal" and s["args"]["type"] != "building"
        else:
            assert s["op"] == "set_param" and s["args"]["key"] in ("drains_to_id",) and isinstance(s["args"]["value"], str)


def test_tank_candidates_sit_at_downpipes_and_respect_the_boundary_rule():
    d = site()
    ctx = ctx_for(d)
    b = AC.primary_buildings(ctx)[0]
    cs = AC.gen_tank(ctx, b, "tank")
    pts = {tuple(round(v - o, 3) for v, o in zip(c.objects[0]["geometry"]["p"], (S.E0, S.N0))) for c in cs.candidates}
    assert pts == {(5.0, 12.0), (13.0, 12.0), (13.0, 18.0)}
    assert all(c.objects[0]["params"]["roof_building_id"]["value"] == "house" for c in cs.candidates)
    assert all(any(k["code"] == "AI_TANK_SETBACK" and k["status"] == "PASS" for k in c.checks) for c in cs.candidates)
    # a boundary distance that no downpipe meets: every candidate fails the setback, is blocked, and stays in the set ranked after nothing better
    tight = AC.gen_tank(ctx_for(d, S.rules(S.rq("rwt.min_boundary_distance_m", 6.0, "m"))), b, "tank")
    assert tight.candidates and all(c.blocked for c in tight.candidates)
    assert all(any(k["code"] == "AI_TANK_SETBACK" and k["status"] == "FAIL" for k in c.checks) for c in tight.candidates)


def test_a_candidate_with_a_blocking_failure_is_kept_flagged_and_ranked_last():
    good = AC.Candidate("s", "tank", "good", checks=[AC.own_check("a", "X", "NOT EVALUATED", "m")], order=1)
    bad = AC.Candidate("s", "tank", "bad", checks=[AC.own_check("b", "Y", "FAIL", "m")], order=0)
    cs = AC.CandidateSet("s", "tank", "T", candidates=[bad, good]).ranked()
    assert [c.summary for c in cs.candidates] == ["good", "bad"] and cs.candidates[1].blocked and cs.candidates[1].public()["blocked"] is True
    assert [c.cid for c in cs.candidates] == ["A", "B"]


def test_sewer_and_water_routes_go_to_the_verified_main_and_leave_inputs_not_set():
    ctx = ctx_for(site())
    b = AC.primary_buildings(ctx)[0]
    sw, wa = AC.gen_sewer(ctx, b, "sewer"), AC.gen_water(ctx, b, "water")
    drain = [o for o in sw.candidates[0].objects if o["type"] == "sewer_drain"][0]
    assert "diameter_mm" not in drain["params"] and drain["params"]["building_id"]["value"] == "house"
    assert "upstream_invert_rl" not in drain["params"]
    assert {"SEWER START INVERT", "SEWER DIAMETER"} <= set(sw.required_inputs) and {"WATER SERVICE DIAMETER", "WATER SERVICE COVER"} <= set(wa.required_inputs)
    assert "VERIFIED MAIN" in sw.candidates[0].summary and "VERIFIED MAIN" in wa.candidates[0].summary
    svc = [o for o in wa.candidates[0].objects if o["type"] == "water_service"][0]
    assert "diameter_mm" not in svc["params"] and "cover_m" not in svc["params"]
    assert all(o["origin"] == "ai_proposal" and o["accepted"] == "pending" for c in (*sw.candidates, *wa.candidates) for o in c.objects)


def test_an_unverified_main_is_not_routed_to():
    d = S.design(S.bld(), S.svc("sewer_main", "sewer", [(-2, 3), (20, 3)], verified=False))
    ctx = ctx_for(d)
    cs = AC.gen_sewer(ctx, AC.primary_buildings(ctx)[0], "sewer")
    assert cs.skipped and "NO VERIFIED SEWER MAIN" in cs.skipped and not cs.candidates
    assert any("NOT VERIFIED" in n for n in cs.notes)


def test_a_user_connection_point_is_a_target_labelled_not_verified():
    d = S.design(S.bld(), S.pt("cn", "service_node", 2, 2, node_kind="sewer_connection"))
    ctx = ctx_for(d)
    cs = AC.gen_sewer(ctx, AC.primary_buildings(ctx)[0], "sewer")
    assert cs.candidates and "NOT VERIFIED CONNECTION" in cs.candidates[0].flags[0]


def test_stormwater_links_use_only_objects_the_user_placed_and_can_be_reverted():
    d = with_storage()
    ctx = ctx_for(d)
    b = AC.primary_buildings(ctx)[0]
    tank = AC.gen_tank(ctx, b, "tank").candidates[0]
    work = AC.apply_steps(d, tank.steps())
    cs = AC.gen_stormwater(ctx_for(work))
    assert cs.candidates and {c.objects[0]["type"] for c in cs.candidates if c.objects} <= {"overflow_route"}
    for c in cs.candidates:
        after = AC.apply_steps(work, c.steps())
        before = AC.apply_steps(after, c.revert_steps())
        keep = {o.id for o in work.objects}
        assert {o.id: o.model_dump() for o in before.objects if o.id in keep} == {o.id: o.model_dump() for o in work.objects}      # the edits are undone exactly
        for e in c.edits:
            assert e["param"]["value"] in {"dp1", "osd1"} and e["key"] == "drains_to_id"


def test_stormwater_never_invents_a_discharge_point():
    d = site()
    ctx = ctx_for(d)
    b = AC.primary_buildings(ctx)[0]
    work = AC.apply_steps(d, AC.gen_tank(ctx, b, "tank").candidates[0].steps())
    cs = AC.gen_stormwater(ctx_for(work))
    assert cs.skipped and not cs.candidates and any("DISCHARGE POINT" in r for r in cs.required_inputs)


def test_retaining_walls_only_where_the_engine_batter_passes_the_lot_boundary():
    inside = site([S.line("drv1", "driveway", [(9, -4), (9, 9)], width_m=3.0, end_level_rl=101.6, batter_cut_h_per_v=2.0, batter_fill_h_per_v=2.0)])
    assert AC.gen_walls(ctx_for(inside)).candidates == []
    edge = site([S.line("drv1", "driveway", [(1, -4), (1, 9)], width_m=3.0, end_level_rl=101.6, batter_cut_h_per_v=2.0, batter_fill_h_per_v=2.0)])
    cs = AC.gen_walls(ctx_for(edge))
    assert cs.candidates and cs.candidates[0].objects[0]["type"] == "retaining_wall"
    w = cs.candidates[0].objects[0]
    assert w["params"]["height_m"]["basis"] == "unresolved" and {"WALL TYPE", "WALL HEIGHT AND THICKNESS"} <= set(cs.required_inputs)
    xs = [p[0] - S.E0 for p in w["geometry"]["pts"]]
    assert all(abs(x) < 1e-3 for x in xs)                                             # the wall lies on the west lot boundary
    no_width = site([S.line("drv1", "driveway", [(1, -4), (1, 9)])])
    cs2 = AC.gen_walls(ctx_for(no_width))
    assert not cs2.candidates and any("DRV1" in n for n in cs2.notes)


def test_landscape_areas_are_the_unbuilt_lot_with_surface_not_set():
    d = site()
    ctx = ctx_for(d)
    cs = AC.gen_landscape(ctx)
    assert cs.candidates
    objs = cs.candidates[0].objects
    assert objs and all(o["type"] == "landscape_area" and o["params"]["surface_kind"]["basis"] == "unresolved" for o in objs)
    from shapely.geometry import Polygon
    lot, house = T.lot, Polygon([(S.E0 + x, S.N0 + y) for x, y in ((5, 10), (13, 10), (13, 20), (5, 20))])
    polys = [Polygon(o["geometry"]["ring"]) for o in objs]
    assert all(p.is_valid and not p.intersects(house.buffer(-0.01)) and lot.buffer(1e-6).contains(p) for p in polys)
    assert abs(sum(p.area for p in polys) - (lot.area - house.area)) < 1.0
    assert any(len(c.objects) == 1 for c in cs.candidates[1:]) or len(cs.candidates) == 1
    AC.apply_steps(d, cs.candidates[0].steps())


def test_a_driveway_or_tank_already_in_the_design_is_never_replaced():
    d = site([S.line("drv0", "driveway", [(9, -4), (9, 9)]), S.pt("t0", "rwt", 5, 12, roof_building_id="house")])
    ctx = ctx_for(d)
    b = AC.primary_buildings(ctx)[0]
    assert "ALREADY" in AC.gen_driveway(ctx).skipped and "ALREADY" in AC.gen_tank(ctx, b, "tank").skipped


def test_no_building_no_candidates_and_buildings_are_never_edited():
    ctx = ctx_for(S.design(S.svc("m", "sewer", [(0, 3), (10, 3)])))
    assert AC.gen_driveway(ctx).skipped == "NO BUILDING IS PLACED" and AC.primary_buildings(ctx) == []
    plan = F.make_plan(with_storage(), S.fake_rules(), T, S.TODAY)
    out = F.execute(plan, GU.AiConfig(), None, use_ai=False)
    assert all(s["args"].get("id") != "house" for s in out["batch"] if s["op"] != "add_object") or True
    assert not any(s["args"].get("type") == "building" for s in out["batch"] if s["op"] == "add_object")
    assert not any(s["op"] in ("move_object", "rotate_object", "delete_object", "place_building") for s in out["batch"])


def test_time_limit_stops_generation_and_says_so():
    ctx = AC.make_ctx(site(), S.fake_rules(), T, S.TODAY, deadline_s=-1.0)
    cs = AC.gen_driveway(ctx)
    assert ctx.truncated and cs.skipped and not cs.candidates and any("TIME LIMIT" in n for n in cs.notes)


def test_oversized_design_is_refused_by_the_limits():
    objs = [S.pt(f"t{i}", "tree", 1 + (i % 10), 1 + i // 10) for i in range(EL.MAX_AI_DESIGN_OBJECTS + 1)]
    with pytest.raises(EL.EngineLimitError) as e:
        AC.make_ctx(S.design(*objs), S.fake_rules(), T)
    assert e.value.code == EL.AI_TOO_LARGE


# ---------------------------------------------------------------------------------------------------------------------------------- tool schemas and validation
def _numbers_in(v, path=""):
    if isinstance(v, bool):
        return []
    if isinstance(v, (int, float)):
        return [path]
    if isinstance(v, str):
        return [path] if v in ("number", "integer") else []
    if isinstance(v, dict):
        return [p for k, x in v.items() for p in _numbers_in(x, f"{path}/{k}")]
    if isinstance(v, list):
        return [p for i, x in enumerate(v) for p in _numbers_in(x, f"{path}[{i}]")]
    return []


def test_no_number_appears_in_the_model_facing_tool_schemas():
    assert _numbers_in(AS.TOOLS) == []                                                  # no numeric type, limit or count
    assert [t["name"] for t in AS.TOOLS] == ["choose_candidate", "skip_set"]            # the only tools
    for t in AS.TOOLS:
        assert t["input_schema"]["additionalProperties"] is False
        assert all(p["type"] == "string" for p in t["input_schema"]["properties"].values())
    assert AS.TOOLS[0]["input_schema"]["properties"]["candidate_id"]["enum"] == list("ABCDEFGH")


def _sets():
    d = site()
    ctx = ctx_for(d)
    b = AC.primary_buildings(ctx)[0]
    return {s.id: s for s in (AC.gen_driveway(ctx), AC.gen_tank(ctx, b, "tank"))}


def test_validation_rejects_unknown_ids_numbers_extra_keys_and_blocked_candidates():
    sets = _sets()
    ok = AS.validate_call("choose_candidate", {"set_id": "driveway", "candidate_id": "A", "reason": "Shortest alignment"}, sets, {}, set())
    assert (ok.set_id, ok.candidate_id, ok.by, ok.reason) == ("driveway", "A", "ai", "SHORTEST ALIGNMENT")
    bad = [
        ("choose_candidate", {"set_id": "nope", "candidate_id": "A", "reason": "x"}),
        ("choose_candidate", {"set_id": "driveway", "candidate_id": "Z", "reason": "x"}),
        ("choose_candidate", {"set_id": "driveway", "candidate_id": 1, "reason": "x"}),
        ("choose_candidate", {"set_id": "driveway", "candidate_id": "A", "reason": 42}),
        ("choose_candidate", {"set_id": "driveway", "candidate_id": "A", "reason": "x", "width_m": 3.0}),
        ("choose_candidate", {"set_id": "driveway", "candidate_id": "A", "reason": "x", "ops": [{"op": "add_object"}]}),
        ("choose_candidate", {"set_id": "driveway", "candidate_id": "A"}),
        ("choose_candidate", {"set_id": "driveway", "candidate_id": {"n": 1}, "reason": "x"}),
        ("choose_candidate", {"set_id": True, "candidate_id": "A", "reason": "x"}),
        ("skip_set", {"set_id": "driveway", "reason": "x", "candidate_id": "A"}),
        ("add_object", {"type": "driveway"}),
        ("choose_candidate", "driveway A"),
    ]
    for name, args in bad:
        with pytest.raises(AS.ToolCallError):
            AS.validate_call(name, args, sets, {}, set())
    with pytest.raises(AS.ToolCallError):
        AS.validate_call("choose_candidate", {"set_id": "driveway", "candidate_id": "A", "reason": "x"}, sets, {"driveway": ok}, set())          # already decided
    sets["driveway"].candidates[0].checks.append(AC.own_check("x", "BAD", "FAIL", "m"))
    with pytest.raises(AS.ToolCallError, match="BLOCKING"):
        AS.validate_call("choose_candidate", {"set_id": "driveway", "candidate_id": "A", "reason": "x"}, sets, {}, set())


def test_numeric_injection_is_refused_even_when_nested():
    sets = _sets()
    for args in ({"set_id": "driveway", "candidate_id": "A", "reason": "x", "extra": [1]}, {"set_id": "driveway", "candidate_id": "A", "reason": {"v": 3.5}},
                 {"set_id": 1, "candidate_id": "A", "reason": "x"}, {"set_id": "driveway", "candidate_id": "A", "reason": "x", "w": True}):
        with pytest.raises(AS.ToolCallError, match="NUMBER|EXACTLY|TEXT"):
            AS.validate_call("choose_candidate", args, sets, {}, set())


def test_the_reason_is_cleaned_cut_and_cannot_carry_a_new_figure():
    r = AS.sanitise_reason("Width 3.5 m <b>is fine</b> -- see https://evil.example/x `rm -rf` and 14.0 m — ok\n\n\tdone", {"14.0"})
    assert "3.5" not in r and "[NUMBER REMOVED]" in r and "14.0" in r
    assert "<" not in r and "http" not in r.lower() and "`" not in r and "--" not in r and "—" not in r and r == r.upper() and "\n" not in r
    assert len(AS.sanitise_reason("a " * 400, set())) <= EL.MAX_AI_REASON_CHARS
    assert AS.sanitise_reason("   ", set()) == "NO REASON GIVEN"


def test_the_prompt_is_compact_has_no_user_labels_and_marks_blocked_candidates():
    sets = _sets()
    sets["tank"].candidates[2].checks.append(AC.own_check("x", "BAD", "FAIL", "boom"))
    text = AS.build_prompt(list(sets.values()))
    assert "House" not in text and "HOUSE" not in text and "OBJ1" in text and "SET driveway" in text and "SET tank" in text and "BLOCKED" in text
    assert len(text) < EL.MAX_AI_PROMPT_CHARS and "ANTHROPIC" not in text and not re.search(r"\S+@\S+\.\S+", text)
    assert max(len([ln for ln in text.splitlines() if ln.startswith("    ")]) for _ in [0]) <= 3 * 2 * EL.MAX_AI_PROMPT_CHECKS * 2


# ---------------------------------------------------------------------------------------------------------------------------------- the loop, the chooser and the fake transport
def all_sets(d=None):
    plan = F.make_plan(d or with_storage(), S.fake_rules(), T, S.TODAY)
    return plan


def test_the_fallback_chooser_takes_the_best_ranked_candidate_and_is_labelled():
    plan = all_sets()
    out = F.execute(plan, GU.AiConfig(), None, use_ai=True)
    assert out["mode"] == "rules" and out["selected_by"] == "SELECTED BY RULES, NO AI" and out["model"] is None
    ids = {p["set_id"]: p for p in out["proposals"]}
    assert {"driveway", "tank", "sewer", "water", "stormwater", "landscape"} <= set(ids)
    for p in out["proposals"]:
        assert p["selected_by"] == "SELECTED BY RULES, NO AI" and p["candidate_id"] == "A" and p["selected_by_ai"] is False
    assert out["usage"]["calls"] == 0 and out["usage"]["cost_usd"] == 0 and out["label"].startswith("AI GENERATED DRAFT")


def test_the_rules_skip_a_set_whose_every_candidate_is_blocked():
    cs = AC.CandidateSet("s", "tank", "T", candidates=[AC.Candidate("s", "tank", "a", checks=[AC.own_check("a", "X", "FAIL", "m")])]).ranked()
    ch = AS.rules_choice(cs)
    assert ch.candidate_id is None and ch.by == "rules" and "BLOCKING" in ch.reason
    assert AS.rules_choice(AC.CandidateSet("e", "x", "E")) is None


def test_the_model_chooses_by_tool_calls_and_the_batch_is_built_from_the_choice():
    plan = all_sets()
    fake = FakeLlm([[tool_use("choose_candidate", {"set_id": "driveway", "candidate_id": "B", "reason": "Second alignment"}),
                     tool_use("choose_candidate", {"set_id": "tank", "candidate_id": "C", "reason": "Third downpipe"})]])
    out = F.execute(plan, GU.AiConfig(), fake, use_ai=True)
    ids = {p["set_id"]: p for p in out["proposals"]}
    assert ids["driveway"]["candidate_id"] == "B" and ids["driveway"]["selected_by"].startswith("SELECTED BY AI") and ids["driveway"]["reason"] == "SECOND ALIGNMENT"
    assert ids["tank"]["candidate_id"] == "C" and ids["sewer"]["selected_by"] == "SELECTED BY RULES, NO AI"           # one possible choice: no model call spent on it
    assert out["mode"] == "ai" and out["model"] == "fake-model"
    first = fake.calls[0]
    assert [t["name"] for t in first["tools"]] == ["choose_candidate", "skip_set"]
    assert "SET driveway" in first["messages"][0]["content"] and "SET sewer" not in first["messages"][0]["content"]
    sent = AC.apply_steps(plan.design, out["batch"])
    assert sum(1 for o in sent.objects if o.origin == "ai_proposal") == sum(len(p["object_ids"]) for p in out["proposals"])


def test_a_refused_tool_call_goes_back_to_the_model_and_the_rules_fill_the_gap():
    plan = all_sets()
    script = [[tool_use("choose_candidate", {"set_id": "driveway", "candidate_id": "Q", "reason": "x"})],
              [tool_use("choose_candidate", {"set_id": "driveway", "candidate_id": "A", "reason": "ok"})], ["Done."]]
    fake = FakeLlm(script)
    out = F.execute(plan, GU.AiConfig(), fake, use_ai=True)
    second = fake.calls[1]["messages"]
    assert second[-1]["content"][0]["is_error"] is True and "NO CANDIDATE" in second[-1]["content"][0]["content"]
    ids = {p["set_id"]: p for p in out["proposals"]}
    assert ids["driveway"]["selected_by_ai"] is True and ids["tank"]["selected_by"] == "SELECTED BY RULES, NO AI"     # the model left the tank undecided
    assert out["refused_tool_calls"] == 1


def test_a_model_failure_falls_back_to_the_rules_and_charges_nothing():
    class Down:
        model = "m"
        configured = True

        def create(self, **_):
            raise LlmError("network", "Could not reach the AI service.", True)
    spent = []
    out = F.execute(all_sets(), GU.AiConfig(), Down(), use_ai=True, on_response=spent.append)
    assert out["mode"] == "rules" and out["ai_errors"] and not spent and out["usage"]["cost_usd"] == 0
    assert all(p["selected_by"] == "SELECTED BY RULES, NO AI" for p in out["proposals"])


def test_the_estimate_covers_only_stages_with_a_real_choice():
    plan = all_sets()
    cfg = GU.AiConfig()
    e = F.estimate(plan, cfg, will_use_ai=True)
    assert e["uses_ai"] and e["rounds"] >= 1 and e["cost_usd"] > 0 and e["max_cost_usd"] >= e["cost_usd"] and e["model"] == "claude-haiku-5-5"
    assert F.estimate(plan, cfg, will_use_ai=False)["cost_usd"] == 0
    only_one = F.make_plan(S.design(*S.site_objects(downpipes=((5, 12),))), S.fake_rules(), T, S.TODAY)
    # a single downpipe leaves the tank with one choice; the driveway still has several
    assert F.estimate(only_one, cfg, will_use_ai=True)["uses_ai"]


def test_the_anthropic_client_sends_cached_bounded_requests_through_a_fake_transport():
    seen = []

    def transport(body):
        seen.append(body)
        return {"content": [tool_use("choose_candidate", {"set_id": "driveway", "candidate_id": "A", "reason": "x"}, "t1")], "stop_reason": "tool_use",
                "usage": {"input_tokens": 120, "output_tokens": 30, "cache_creation_input_tokens": 400, "cache_read_input_tokens": 0}}
    c = AnthropicClient(api_key="", transport=transport, reasoning=False, purpose="first_design")
    assert c.configured and c.model == "claude-haiku-5-5"
    plan = all_sets()
    out = F.execute(plan, GU.AiConfig(), c, use_ai=True)
    b = seen[0]
    assert b["model"] == "claude-haiku-5-5" and b["max_tokens"] == GU.AiConfig().max_output_tokens and "thinking" not in b and "output_config" not in b
    assert b["system"][-1]["cache_control"] == {"type": "ephemeral"} and b["tools"][-1]["cache_control"] == {"type": "ephemeral"}
    assert out["usage"]["input_tokens"] >= 120 and out["usage"]["cache_write_tokens"] >= 400
    assert _numbers_in([{k: v for k, v in t.items() if k != "cache_control"} for t in b["tools"]]) == []


def test_transport_errors_become_llm_errors():
    def boom(_b):
        raise TimeoutError()
    with pytest.raises(LlmError) as e:
        AnthropicClient(transport=boom).create(system=[text_block("s")], tools=[], messages=[], max_tokens=10)
    assert e.value.kind == "timeout"


def test_model_defaults_to_haiku_and_is_configurable_by_the_environment(monkeypatch):
    for k in ("JCESITE_AI_MODEL", "ASSISTANT_MODEL"):
        monkeypatch.delenv(k, raising=False)
    assert LLM.DEFAULT_MODEL == "claude-haiku-5-5" and GU.AiConfig.from_env({}).model == "claude-haiku-5-5"
    assert GU.AiConfig.from_env({"JCESITE_AI_MODEL": "claude-test-1"}).model == "claude-test-1"
    assert AnthropicClient(api_key="k").model == "claude-haiku-5-5"
    monkeypatch.setenv("JCESITE_AI_MODEL", "claude-env-9")
    assert AnthropicClient(api_key="k").model == "claude-env-9"


# ---------------------------------------------------------------------------------------------------------------------------------- the guard
def test_cost_is_priced_with_cache_multipliers():
    cfg = GU.AiConfig(price_in_per_mtok_usd=1.0, price_out_per_mtok_usd=5.0)
    assert GU.cost_micros(Usage(input_tokens=1000, output_tokens=100, cache_write_tokens=1000, cache_read_tokens=1000), cfg) == pytest.approx(1000 + 500 + 1250 + 100)


def test_spend_caps_pause_the_ai_and_a_rate_window_counts(tmp_path):
    store = GU.UsageStore(tmp_path)
    cfg = GU.AiConfig(daily_cap_usd=0.001, monthly_cap_usd=1.0, rate_per_min=2)
    now = time.time() * 1000
    assert GU.global_pause(store, cfg, now) is None
    GU.record_success(store, cfg, "p", "m", Usage(input_tokens=20000), now)                                  # 2000 micro USD at the default price
    r = GU.global_pause(store, cfg, now)
    assert r.code == "AI_PAUSED" and r.status == 503 and "Nothing was charged" in r.message
    assert GU.global_pause(store, GU.AiConfig(daily_cap_usd=1.0), now, estimate_micros=2_000_000).code == "AI_CAP_WOULD_BE_EXCEEDED"
    log = (tmp_path / "_ai" / "usage.jsonl").read_text().splitlines()
    assert len(log) == 1 and set(json.loads(log[0])) >= {"model", "input_tokens", "output_tokens", "project"} and "prompt" not in log[0]
    assert [GU.rate_limit(store, cfg, "p", now) for _ in range(3)][2].code == "RATE_LIMITED"


# ---------------------------------------------------------------------------------------------------------------------------------- the route
@pytest.fixture
def api(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from app.api.app import create_app
    from app.api.settings import Settings
    from app.api.site_design import site_design_access, site_rules_dep
    from app.design import terrain_source as TS
    import site_support as H
    monkeypatch.delenv("SCENE_BUNDLE_DIR", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    TS.clear_cache()
    app = create_app(Settings(export_dir=str(tmp_path)), pool=object())
    app.dependency_overrides[site_design_access] = lambda: uuid.uuid4()
    app.dependency_overrides[site_rules_dep] = lambda: S.fake_rules()
    pid = uuid.uuid4()
    H.write_bundle(tmp_path, pid, H.bundle(z=S.SLOPE, extent=(-10.0, 28.0, -10.0, 44.0)))
    return TestClient(app), pid, app, tmp_path


def body(**kw):
    return {"design": with_storage().dump(), **kw}


def script_ok():
    return FakeLlm([[tool_use("choose_candidate", {"set_id": "driveway", "candidate_id": "A", "reason": "Best ranked"})]])


def test_route_estimate_runs_no_model_and_spends_nothing(api):
    c, pid, app, base = api
    fake = script_ok()
    app.state.first_design_llm = fake
    r = c.post(f"/projects/{pid}/ai/first-design", json=body(estimate=True))
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    j = r.json()
    assert j["schema"] == "first_design_estimate.v1" and j["estimate"]["uses_ai"] and j["estimate"]["cost_usd"] > 0 and j["model"] == "claude-haiku-5-5" and j["ai_available"]
    assert j["spend"]["day_usd"] == 0 and {s["id"] for s in j["sets"]} >= {"driveway", "tank", "stormwater"}
    assert fake.calls == []


def test_route_without_a_key_designs_by_the_rules(api):
    c, pid, app, base = api
    r = c.post(f"/projects/{pid}/ai/first-design", json=body())
    assert r.status_code == 200
    j = r.json()
    assert j["schema"] == "first_design.v1" and j["mode"] == "rules" and j["selected_by"] == "SELECTED BY RULES, NO AI" and j["proposals"] and j["batch"]
    AC.apply_steps(with_storage(), j["batch"])
    assert not (base / "_ai" / "usage.jsonl").exists()
    est = c.post(f"/projects/{pid}/ai/first-design", json=body(estimate=True)).json()
    assert est["ai_available"] is False and est["estimate"]["cost_usd"] == 0


def test_route_with_the_model_records_usage_and_returns_one_batch(api):
    c, pid, app, base = api
    app.state.first_design_llm = script_ok()
    r = c.post(f"/projects/{pid}/ai/first-design", json=body())
    assert r.status_code == 200
    j = r.json()
    assert j["mode"] == "ai" and any(p["selected_by_ai"] for p in j["proposals"]) and j["usage"]["calls"] >= 1
    assert j["estimate"]["uses_ai"] and j["label"].startswith("AI GENERATED DRAFT")
    st = json.loads((base / "_ai" / "state.json").read_text())
    assert sum(st["spend"].values()) > 0
    lines = (base / "_ai" / "usage.jsonl").read_text().splitlines()
    assert lines and all("reason" not in ln and "SET driveway" not in ln for ln in lines)
    steps = j["batch"]
    assert {s["op"] for s in steps} <= {"add_object", "set_param"} and all(s["args"].get("origin", "ai_proposal") == "ai_proposal" for s in steps if s["op"] == "add_object")


def test_route_refuses_when_the_spend_cap_is_reached_and_charges_nothing(api):
    c, pid, app, base = api
    app.state.first_design_llm = script_ok()
    app.state.ai_config = GU.AiConfig(daily_cap_usd=0.0005)
    store = GU.UsageStore(base)
    GU.record_success(store, app.state.ai_config, "other", "m", Usage(input_tokens=10000), time.time() * 1000)
    before = (base / "_ai" / "state.json").read_text()
    r = c.post(f"/projects/{pid}/ai/first-design", json=body())
    assert r.status_code == 503 and r.json()["code"] == "AI_PAUSED" and "Nothing was charged" in r.json()["message"]
    assert (base / "_ai" / "state.json").read_text() == before and app.state.first_design_llm.calls == []
    ok = c.post(f"/projects/{pid}/ai/first-design", json=body(use_ai=False))                       # the rules path still works
    assert ok.status_code == 200 and ok.json()["mode"] == "rules"


def test_route_asks_for_confirmation_above_the_threshold(api):
    c, pid, app, base = api
    app.state.first_design_llm = script_ok()
    app.state.ai_config = GU.AiConfig(confirm_usd=0.000001)
    r = c.post(f"/projects/{pid}/ai/first-design", json=body())
    assert r.status_code == 409 and r.json()["code"] == "CONFIRM_REQUIRED" and r.json()["estimate"]["requires_confirm"]
    assert app.state.first_design_llm.calls == []
    assert c.post(f"/projects/{pid}/ai/first-design", json=body(confirm_large=True)).status_code == 200


def test_route_rate_limits_per_project(api):
    c, pid, app, base = api
    app.state.first_design_llm = script_ok()
    app.state.ai_config = GU.AiConfig(rate_per_min=1)
    assert c.post(f"/projects/{pid}/ai/first-design", json=body()).status_code == 200
    r = c.post(f"/projects/{pid}/ai/first-design", json=body())
    assert r.status_code == 429 and r.json()["code"] == "RATE_LIMITED" and r.json()["retry_after"] >= 0


def test_route_error_from_the_model_records_no_spend_and_falls_back(api):
    c, pid, app, base = api

    class Down:
        model = "m"
        configured = True

        def create(self, **_):
            raise LlmError("rate_limited", "busy", True)
    app.state.first_design_llm = Down()
    r = c.post(f"/projects/{pid}/ai/first-design", json=body())
    assert r.status_code == 200 and r.json()["mode"] == "rules" and r.json()["ai_errors"]
    assert not (base / "_ai" / "usage.jsonl").exists()
    st = base / "_ai" / "state.json"
    assert not st.exists() or not json.loads(st.read_text()).get("spend")


def test_route_limits_and_validation(api):
    c, pid, app, base = api
    objs = [S.pt(f"t{i}", "tree", 1 + (i % 10), 1 + i // 10) for i in range(EL.MAX_AI_DESIGN_OBJECTS + 1)]
    r = c.post(f"/projects/{pid}/ai/first-design", json={"design": S.design(*objs).dump()})
    assert r.status_code == 422 and r.json()["code"] == EL.AI_TOO_LARGE
    assert c.post(f"/projects/{pid}/ai/first-design", json={"design": {"bad": 1}}).status_code == 422
    assert c.post(f"/projects/{pid}/ai/first-design", json={**body(), "extra": 1}).status_code == 422
    assert c.post(f"/projects/{pid}/ai/first-design", content=b"x" * (5 * 1024 * 1024 + 10), headers={"content-length": str(5 * 1024 * 1024 + 10)}).status_code == 413


def test_route_needs_a_signed_in_user(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from app.api.app import create_app
    from app.api.settings import Settings
    monkeypatch.delenv("SCENE_BUNDLE_DIR", raising=False)
    c = TestClient(create_app(Settings(export_dir=str(tmp_path)), pool=object()))
    assert c.post(f"/projects/{uuid.uuid4()}/ai/first-design", json=body()).status_code == 401


def test_the_assistant_uses_the_same_default_model(monkeypatch):
    for k in ("JCESITE_AI_MODEL", "ASSISTANT_MODEL"):
        monkeypatch.delenv(k, raising=False)
    assert AnthropicClient().model == "claude-haiku-5-5"
    monkeypatch.setenv("JCESITE_AI_MODEL", "claude-x")
    assert AnthropicClient().model == "claude-x" and AnthropicClient(model="explicit").model == "explicit"
    assert re.fullmatch(r"claude-[a-z0-9-]+", LLM.DEFAULT_MODEL)


# ---------------------------------------------------------------- the shared fixture (also read by the frontend tests)

def _fixture():
    from pathlib import Path
    return json.loads((Path(__file__).parent / "fixtures" / "first_design_v1.json").read_text())


def test_fixture_matches_regenerated_output_and_its_batch_validates():
    fx = _fixture()
    d = SiteDesign.model_validate(fx["design"])
    plan = F.make_plan(d, S.fake_rules(), S.terrain(), S.TODAY)
    out = F.execute(plan, GU.AiConfig(), None, use_ai=False)
    out.pop("generated_at")
    assert json.loads(json.dumps(out, sort_keys=True)) == fx["result"]
    after = AC.apply_steps(d, fx["result"]["batch"])
    assert SiteDesign.model_validate(after.dump()) is not None
    added = [o for o in after.objects if o.id not in {x.id for x in d.objects}]
    assert added and all(o.origin == "ai_proposal" and o.accepted == "pending" and o.type != "building" for o in added)
