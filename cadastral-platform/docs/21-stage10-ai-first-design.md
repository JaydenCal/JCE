# 21. Stage 10: AI first design and the proposal checklist

Date: 15/10/2026. Status: STAGE 10 COMPLETE, REVIEW FIXES APPLIED (section 13), AWAITING OWNER REVIEW. Local commit only; nothing is pushed.

## 1. Purpose and rules

The AI prepares a first pass of the design from what the client has already placed and what the platform has already resolved: the buildings and their exits, the terrain, the verified services and the rules of the council. The end user then works through the result item by item and accepts, edits or rejects each one. The first pass is a draft for the user and for the responsible engineer. It is not a design that has been checked or certified.

1. The language model never produces a number. Every length, level, area, count and coordinate in the result comes from a deterministic engine or from an input that was already resolved (a placed object, a verified service, a rule with a source, or the terrain). The model is only asked to choose between candidates that the engine has already built and checked.
2. A value that has no source is left NOT SET. It is listed as a required input on the proposal, with the object and the key, so the user knows what must be supplied.
3. Buildings are never created, moved or edited. The AI works around the buildings that the client placed.
4. Everything the AI adds has the origin `ai_proposal` and the state `accepted: pending`. Nothing is treated as part of the design until the user accepts it.
5. The whole first design is applied as one batch and one undo step. Undo removes all of it.
6. Usage is kept low. The default model is `claude-haiku-5-5`, the model is asked only about sets that have a real choice, the output is bounded, the system prompt and tools are cached, and daily and monthly spending caps, a rate limit per project and a confirm step apply.
7. User facing text has upper case labels, no em or en dashes and dates as DD/MM/YYYY.
8. Nothing is sent to anyone on the user's behalf.

## 2. What was built

| Item | Where |
|---|---|
| Candidate model, ranking, step builders, generators for driveway, tank, sewer, water, stormwater links, retaining walls and landscape areas | `backend/app/design/ai_candidates.py` |
| Selection by tool calls (`choose_candidate`, `skip_set`), validation, rules fallback | `backend/app/design/ai_select.py` |
| Plan, two stage orchestration, estimate, result `first_design.v1` | `backend/app/design/ai_first_design.py` |
| Guard: configuration, cost arithmetic, caps, reservation per call, rate limits (project and global), usage log | `backend/app/design/ai_guard.py` |
| Batch guard, server side (same rules as the browser) | `backend/app/design/ai_batch_guard.py` |
| Model client (default model, cache markers, bounded tokens, usage log) | `backend/app/design/assistant/llm.py` |
| Route `POST /projects/{id}/ai/first-design` | `backend/app/api/first_design.py`, `app.py` |
| Route planning with unset inputs (start invert, diameter, cover, meter may be None) | `backend/app/design/service_route.py` |
| Limits | `backend/app/design/engine_limits.py` (AI constants, `MAX_AI_TOTAL_SECONDS`) |
| Browser: guard on the batch, checklist operations, live checks | `frontend/src/lib/site/firstDesign.ts` |
| Browser: session (estimate, run, apply, accept, reject, restore, edit, step through) | `frontend/src/lib/site/firstDesignSession.ts`, `firstDesignApi.ts` |
| Operation `restore_proposal`; accept, reject and restore are not offered to the AI | `frontend/src/lib/site/ops.ts` |
| Design tab checklist | `frontend/src/components/viewer/FirstDesignPanel.tsx`, `DesignPanel.tsx`, `designController.ts` |
| Tests | `backend/tests/test_stage10_ai.py` (44), `backend/tests/test_stage10_review.py`, `backend/tests/ai_support.py`, `frontend/tests/site/first_design.test.ts` (23) |
| Shared fixture, a real answer of the server | `backend/tests/fixtures/first_design_v1.json` |

## 3. Architecture

The work is split so that the model has the smallest possible role.

1. Generators build candidate sets. A set is one decision, for example the driveway alignment. Each set holds up to four candidates, lettered A to D. A candidate is a list of registry operations (the objects it would add and the link edits it would make), the engine checks it produces, flags, the inputs it still needs, and a metric used only for ordering.
2. Every candidate is checked by the same engine that checks the user's own design (`check_site_design`). Only the checks that the candidate adds or changes are attached to it.
3. A candidate that has a blocking failure is kept and flagged, and is ranked last. It is never removed, so the user can see why it fails, and it can never be chosen by the model or by the rules.
4. Ranking is by blocked, number of blocking checks, number of failing checks, warnings per object, then the ordering metric, then generation order.
5. Selection chooses one candidate per set, or skips the set with a reason. The model does this through a tool loop. If the model is off, not configured, over a cap or fails, the rules take the best ranked candidate and the proposal is labelled SELECTED BY RULES, NO AI.
6. The chosen candidates become one batch of operations, which the browser applies atomically.

The design is built in two stages because some sets depend on others. Stage 1 holds the sets that stand alone: driveway, rainwater tank positions, sewer route and water route. The chosen stage 1 candidates are applied to a working copy of the design in the server. Stage 2 then builds the sets that refer to those objects: stormwater links, retaining walls and landscape areas. Only sets that have at least two candidates that are not blocked are put to the model. Every other set is decided by the rules, and no model call is spent on it.

### 3.1 The generators

| Set | What it proposes | What it does not do |
|---|---|---|
| Driveway | Alignments from the kerb frontage to the nearest point of the building footprint, at the sampling choices of section 3.3 | Invents no width, surface, grade or garage position |
| Tank | A position at each downpipe exit of the building | Invents no capacity or size; the position marks the downpipe |
| Sewer | A route from the building sewer exit to a verified sewer main, with a connection node | Invents no diameter, cover or start invert |
| Water | A route from the building water exit to a verified water main, with a connection node and meter position | Invents no diameter, cover or meter size |
| Stormwater links | `drains_to_id` links from surfaces to tanks, OSDs and discharge points the user placed, and overflow routes | Never creates a discharge point and never invents one; where the user placed none, the link is left unset and the proposal says so |
| Retaining walls | Walls only where the engine batter or platform polygon passes the lot boundary, excluding the street frontage | Invents no height, thickness or type |
| Landscape areas | The unbuilt part of the lot, computed as the lot minus the union of the occupied footprints, cut into parts without holes (section 13.3), in at most two candidates | The surface kind stays unresolved |

An unverified service is never routed to. A connection point that the user placed is used as a target and labelled NOT VERIFIED.

### 3.2 Numbers that appear in the batch

Only two numeric parameters are written by the generators, and both come from existing resolved inputs: `crossover_chainage_m`, which is the position along the kerb of a crossover that the geometry fixes, and the invert level of a connection node, which is derived from the terrain level and the verified depth of the main. Both carry the basis DERIVED, never USER, with a ref that names the engine and its inputs (section 13.7). All other numbers in the batch are coordinates of geometry that the engines produced. A test walks the whole batch and fails if any other numeric parameter appears, and the guard of section 8 refuses any other.

### 3.3 Candidate sampling choices

These are constants of the generator module (`ai_candidates.py`). They decide which candidates are offered. They are choices of this tool and NOT requirements of any standard, council or authority, and no check reads them.

| Constant | Value | Meaning |
|---|---|---|
| `DRIVEWAY_SAMPLE_FRACTIONS` | 0.2, 0.5, 0.8 | Crossovers are tried at these fractions of the chainage range that the lot frontage spans on the assumed kerb line, plus the chainage nearest the centre of the building |
| `DRIVEWAY_MIN_LENGTH_M` | 0.5 | An alignment shorter than this between the kerb and the building is not offered |
| `DEDUPE_M` | 0.5 | Two crossovers closer than this are one candidate |
| `BATTER_EXCEED_M` | 0.1 | An earthwork polygon counts as past the lot boundary only when some part of it is at least this far outside the lot |
| `WALL_MIN_LENGTH_M` | 0.5 | A boundary wall shorter than this is not proposed |
| `SLIVER_M2` | 0.5 | A landscape part smaller than this is not proposed (the area left out is stated in a note) |

## 4. Selection by the model

The model is offered two tools only.

* `choose_candidate(set_id, candidate_id, reason)`
* `skip_set(set_id, reason)`

The schemas contain no numeric type, no limit and no free format field. The candidate identifier is an enumeration of the letters A to H.

The prompt holds only generated identifiers and engine summaries (section 13.2): for each set the set id and kind, the number of inputs still to be entered, and the candidates with their letter, flags, a summary in which every object is an alias (OBJ1, OBJ2, ...) and the check lines (status and check code only, the failing ones first and cut to ten per candidate). A label, an object id, an owner name or any other text written by the user is never put in the prompt, and nothing is searched for in text and replaced, so free text written by the user cannot reach the model as an instruction.

Every tool call is validated before it is used. A call is refused when it carries any JSON number or boolean anywhere (including nested), has an extra key, names an unknown or duplicate set, names an unknown candidate, or names a candidate that is blocked. A refused call is returned to the model as an error, once per round, and the rules fill the gap for any set left undecided. The reason is cleaned: control characters, markup, links and dashes are removed, the text is set in upper case and cut to 300 characters, and any figure that is not in the prompt is replaced by `[NUMBER REMOVED]`. The redaction covers digits only. It does not detect numbers spelled as words, which is a known limitation (section 11).

The number of model calls is bounded by `MAX_TURNS` for each round and by a hard deadline of `MAX_AI_TOTAL_SECONDS` (60 seconds) for the whole run (section 13.5). When the time is used, the remaining sets are decided by the rules. Any exception of the model client, not only those of the SDK, ends in the rules with the label SELECTED BY RULES, NO AI and a note, never in an error of the route (section 13.11).

## 5. Configuration and guard

The settings are read from environment variables. They are configuration, not engineering values.

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Without a key the rules decide and no model call is made |
| `JCESITE_AI_MODEL` | `claude-haiku-5-5` | Model used by the first design and by the assistant |
| `JCESITE_AI_PRICE_IN_PER_MTOK_USD` | 0.1 | Input price used for the estimate and the caps |
| `JCESITE_AI_PRICE_OUT_PER_MTOK_USD` | 0.5 | Output price |
| `JCESITE_AI_MAX_OUTPUT_TOKENS` | 1500 | Output bound for one call |
| `JCESITE_AI_TIMEOUT_S` | 30 | Timeout of one call |
| `JCESITE_AI_DAILY_CAP_USD` | 5 | Daily spending cap |
| `JCESITE_AI_MONTHLY_CAP_USD` | 50 | Monthly spending cap |
| `JCESITE_AI_RATE_PER_MIN` | 6 | Requests per project per minute |
| `JCESITE_AI_RATE_PER_DAY` | 150 | Requests per project per day |
| `JCESITE_AI_GLOBAL_RATE_PER_MIN` | 20 | Requests over all projects per minute |
| `JCESITE_AI_GLOBAL_RATE_PER_DAY` | 1000 | Requests over all projects per day |
| `JCESITE_AI_CONFIRM_USD` | 0.01 | Worst case cost above which the user must confirm |
| `JCESITE_AI_MAX_TURNS` | 3 (range 1 to 6) | Model calls per round |

Prices are placeholders to be set to the current published prices by the owner. The caps and the rate limits follow Plan Studio.

The client sends cache markers on the system prompt and the tools, sends no extended reasoning setting, and bounds the output. It has not been confirmed against the live service whether the default model accepts reasoning or effort settings, so the client sends neither.

State is kept in files under `<base>/_ai/`: `state.json` (spend by day and month, reservations, rate windows) and `usage.jsonl`. The usage log holds the time, project, purpose, model, token counts and cost. It holds no prompt and no answer. Spend is recorded for every call that returned, including one whose answer is ignored because the deadline had passed. A call that fails records nothing.

The guard order is: pause or cap (503 `AI_PAUSED` or `AI_CAP_WOULD_BE_EXCEEDED`, which includes a request that could pass the cap in the worst case, counting what other requests have reserved), confirmation (409 `CONFIRM_REQUIRED`), rate limit (429 `RATE_LIMITED`, per project and over all projects). In addition, each model call reserves its own worst case cost under the store lock together with the cap check, and settles it after the call (section 13.6). When the AI is off, has no key, or no set has a real choice, none of these applies and the rules decide.

The assistant of the Design tab now uses the same default model and the same environment variable.

## 6. The API

`POST /projects/{id}/ai/first-design`

Request: `{"design": <site_design.v1>, "estimate": false, "confirm_large": false, "use_ai": true}`. Extra keys are refused.

* `estimate: true` builds the candidates, makes no model call and spends nothing. The answer has the schema `first_design_estimate.v1`: the estimate (expected calls, worst case calls, tokens, cost, whether confirmation is needed, the threshold, the model, a reason when the AI will not be used), whether the AI is available, the current spend against the caps, and the sets.
* otherwise the answer has the schema `first_design.v1`: the draft statement, the mode (AI or RULES), the proposals (title, reason, who selected it, checks, inputs still required, the operations and the operations that undo them), the sets that were skipped, the single batch of operations, the required inputs, the final checks of the whole design, the usage, any model errors and refused tool calls, and notes.

The route has the same access rules as the other site design routes (terms accepted, project visible, 413 over 5 MB, limits by `engine_limits` returning 422). The engines run on their own pool under the per project gate and a timeout. Nothing is saved on the server.

## 7. The checklist in the Design tab

The panel DESIGN FOR ME sits above the checks.

1. The user presses the button and first sees the estimate: calls, tokens, cost, the model, and the current spend against the caps. The user can turn the AI off for the run, in which case the rules decide.
2. When the worst case cost is over the threshold, a confirm step is shown and nothing is sent until the user confirms.
3. The batch is checked in the browser before it is run (section 8) and then applied with `runBatch` in atomic mode, as one undo step labelled AI FIRST DESIGN with the number of proposals.
4. The panel steps through the proposals one at a time. Each shows the title, the reason, whether the choice was made by the AI or by the rules, the checks with their state (live, pending, stale or none), the inputs still required, and any notice, for example that other proposals refer to this one.
5. For each proposal the user can ACCEPT, EDIT or REJECT. Accept marks the objects accepted. Edit selects the first object so the user can change it and keeps the proposal pending. Reject marks the objects rejected, which hides them, and reverts any link edit that the proposal made. A rejected proposal is listed in a hidden group and can be restored, which brings the objects back as pending and sets the link edits again.
6. ACCEPT ALL PASSING accepts every pending proposal whose live checks have no blocking failure. It accepts nothing while the checks are not current for the present design, so an old answer is never trusted. The proposals that were left are named in the message.
7. The checks are asked for again after every change of the design.

Reject reverts a link edit only where the value still equals the proposed value. A value that the user has changed since is kept.

## 8. The safety guard on the batch

Before any operation runs, the browser (`assertAiBatch`) refuses a batch that contains an operation outside the allowed list, more than 400 steps, an object of type building, an object that does not have the origin `ai_proposal` and the status `proposed`, an identifier that is already in the design or repeated in the batch, a move or deletion of any object, a parameter of a new object that carries a value other than a DERIVED value of an engine pair with an engine ref (a number only for the two pairs of section 3.2), a `set_param` on an existing object other than a link key, or a `set_param` on a new object outside the list of link keys. The server runs the same rules (`ai_batch_guard.py`) before it returns the batch, and a test compares the lists of the two. The registry also keeps accept, reject and restore out of the tools offered to the AI, so the assistant cannot accept its own proposals.

## 9. Tests

| Area | Count | File |
|---|---|---|
| Generators on a synthetic site validate against the model, no invented dimension, blocked candidates ranked last, existing objects never replaced, buildings never edited, limits | 14 | `backend/tests/test_stage10_ai.py` |
| Tool schemas contain no number, validation refuses unknown ids, numbers (also nested), extra keys and blocked candidates, reason cleaning, prompt content | 5 | same |
| Rules fallback, model flow with a fake transport, refused tool calls, model failure charges nothing, estimate | 7 | same |
| Client, cost with cache multipliers, spend caps, rate window | 6 | same |
| Route: estimate, no key, model run, cap refusal, confirmation, rate limit, error fallback, limits, sign in | 9 | same |
| Fixture equals regenerated output and its batch validates | 1 | same |
| Browser: one undo step with `ai_proposal` and pending, atomic failure, batch guard (including status, numbers and set_param on new objects), tool list, accept, reject, restore, accept all passing, stale checks, estimate, confirm, errors, locked design, lock while running, design changed, no dashes | 23 | `frontend/tests/site/first_design.test.ts` |
| Review fixes: two buildings, prompt without user text, landscape parts, provenance, sampling constants, server batch guard and list parity, walls, deadline, late answers, retries, 504 wording, reservation under concurrency, global rate limit, any client exception | 31 | `backend/tests/test_stage10_review.py` |

All rule values in the tests are FAKE values written for the tests. None is an engineering value.

## 10. Results

The results of the full runs are recorded in section 12.

## 11. Known limitations

1. The checklist state is kept for the session. After a reload the objects keep their accepted, pending or rejected state in the document, but the list of proposals, the reasons and the link edit markers are not stored. A link edit has no marker in the document.
2. Rejecting a proposal that other proposals depend on leaves the references in place. The panel warns, and the checks show the consequence.
3. A tank position marks the downpipe. The size of the tank is not known and is listed as a required input.
4. The driveway ends at the nearest point of the building footprint, because no garage data exists. The user must move the end to the garage.
5. The reason redaction removes digits only. A number written as words in a reason would not be detected. The reason is shown as text beside the proposal and is never used as data.
6. It is not confirmed that the default model accepts reasoning or effort settings. The client sends neither.
7. The estimate for stage 2 uses the sets built on the working design chosen by the rules. If the model chooses differently in stage 1, the stage 2 sets can differ from the estimate. The worst case cost is bounded by the number of rounds and the number of turns.
8. The model prices in the configuration are placeholders and must be set by the owner.
9. `set_param` accepts the basis DERIVED for the engine pairs when the ref starts with AI FIRST DESIGN. The design assistant could therefore label a value for one of those pairs as derived; its tool schema does not offer the basis, and the batch guard is what protects the AI first design path.
10. The landscape parts come from a greedy join and are not the fewest possible; they are exact in area, which is what matters.
11. The candidates are not an optimisation. They are a small, explainable set of alternatives. The user and the responsible engineer remain responsible for the design.

## 12. Verification record

Backend, from `cadastral-platform/backend`: `python3 -m pytest -q -p no:cacheprovider` gives 1417 passed, 46 skipped and the same 3 known failures in `tests/test_soee_site.py` that existed before this stage (baseline 1343 passed; 1386 before the review fixes). Frontend, from `cadastral-platform/frontend`: `npx tsc --noEmit -p . && npx vitest run` gives no type errors and 497 passed (baseline 474).

## 13. Review fixes

Each fix below has a test that fails on the code before it (`backend/tests/test_stage10_review.py`, `frontend/tests/site/first_design.test.ts`).

### 13.1 Object ids with several buildings

Every id made by a generator comes from ONE set of ids in use, held by the context and shared by all sets and all candidates (`Ctx.taken()`). Stage 2 starts from the ids of stage 1, chosen or not. Two buildings with exits and verified mains used to make `ai_sewer_1` twice, which failed the estimate and the run.

### 13.2 The prompt

The summary of a candidate is built from a template in which an object is a marker holding its id. The user sees the label, the prompt shows an alias (OBJ1, OBJ2, in the order of first appearance in that prompt). The check lines hold the status and the check code only: a check message is free text and can carry a label. The text replacement of labels (`scrub`) was removed, because it replaced letters inside ordinary words when a label was a short word. A test builds the prompt for a design with the labels "a", "Sewer" and "Fail" and for the same design without labels, and the two prompts are identical.

### 13.3 Landscape areas

The remaining area is the lot minus the union of the occupied footprints. A polygon with holes is cut into parts without holes by `decompose`: the polygon is intersected with the bands between the y levels of the vertices of its holes (so no part can contain a hole), and neighbouring parts are joined while the join is still one valid polygon without holes. The area of the parts equals the area of the remaining lot to floating point precision, nothing overlaps an object, and no hole is dropped. The candidate adds the check AI_LANDSCAPE_CLEAR (overlap with other objects below 0.01 m2). Parts under `SLIVER_M2` are not proposed and the area left out is stated in a note. The limit of areas in one candidate is now 24 (`MAX_AI_LANDSCAPE_AREAS`), because a lot with several objects needs more than six parts. Ring coordinates are rounded to 4 decimals (finer when a thin part needs it) so the area stays within 0.01 m2.

### 13.4 The browser

While a request runs the store is read only with the note AI DESIGN RUNNING, and it is opened again whatever the result. The signature of the design is taken when the request is sent. If it differs when the answer arrives, the answer is not applied and the panel shows DESIGN CHANGED, RUN AGAIN.

### 13.5 Time and spend

* The SDK is built with `max_retries` 0. A retry is made by our loop (`MAX_AI_CALL_RETRIES` 2, `AI_RETRY_BACKOFF_S`), only for a retryable failure and only while the deadline has not passed.
* `run_selection` takes a hard deadline (a monotonic time, shared by both rounds). No call and no retry is started after it, and a call gets at most the time that is left (`timeout`).
* When the route gives up (504) it sets a cancel flag. No new call is started. A call that returns after the deadline or after the cancel is recorded as spent, counted in `late_results_ignored`, and its answer is never used or applied.
* The 504 message states what was recorded: SPEND RECORDED: n CALLS. A call still running is recorded when it finishes.

### 13.6 Spend cap under concurrency, and the global rate limit

`UsageStore.reserve` checks the daily and monthly caps and reserves the worst case cost of the next call in one step under the store lock (a file lock, so it holds across threads and worker processes). The reservation counts what other requests hold. `settle` replaces it with the real cost, or releases it when the call failed. A reservation older than 15 minutes is dropped, so a worker that died cannot hold the cap. `rate_limit` now also counts requests over all projects (`global_rate_per_min`, `global_rate_per_day`).

### 13.7 Provenance

`crossover_chainage_m`, `end_building_id`, the links of tanks, overflow routes and stormwater edits, and the links and connection invert written by the route engines carry the basis DERIVED, with a ref that starts with AI FIRST DESIGN and names the engine and its inputs. The pairs allowed are `ENGINE_DERIVED_PARAMS` in `site_design.py` (the same list in `types.ts`). The model refuses DERIVED for any other pair, and reading a value of these pairs needs the engine ref. A person still cannot choose DERIVED by hand: `set_param` accepts it only for an engine pair with an engine ref, which is what the batch guard allows.

### 13.8 Sampling choices

See section 3.3. `DRIVEWAY_SAMPLE_FRACTIONS` and `DRIVEWAY_MIN_LENGTH_M` are named constants with a comment that they are candidate sampling choices and not requirements.

### 13.9 Batch guard

See section 8. The lists `AI_BATCH_OPS`, `AI_LINK_KEYS`, `AI_NEW_SET_KEYS`, `AI_NUMERIC_PARAMS` and `ENGINE_DERIVED_PARAMS` are the same in `ai_batch_guard.py` and in the browser, and a test reads the TypeScript and compares them.

### 13.10 Walls

A wall is proposed only where the boundary passes through the interior of the earthworks (a proper crossing). An earthwork polygon that touches the boundary along an edge gives no wall. The part of the earthworks outside the lot must reach at least `BATTER_EXCEED_M` beyond the boundary (a length, where the area threshold counted a 10 mm overshoot along 10 m as a wall), and a wall segment must be at least `WALL_MIN_LENGTH_M` long.

### 13.11 Any client failure

Every exception of the client is caught in the loop: an `LlmError` keeps its kind and message, anything else is recorded by its class name only. The client maps an import failure and any other non SDK exception to an `LlmError` of kind `client`. The result is the rules, the label SELECTED BY RULES, NO AI and a note that names the first reason.
