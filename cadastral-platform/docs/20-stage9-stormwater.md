# 20. Stage 9: the stormwater helper

Date: 15/10/2026. Status: STAGE 9 COMPLETE, REVIEW FIXES APPLIED (section 13), AWAITING OWNER REVIEW. Local commits only; nothing is pushed.

## 1. Rules this stage follows

1. No data is invented. Rainfall, runoff behaviour, losses, the time of concentration method, the OSD sizing method, the site storage requirement and infiltration or soil data come only from a cited data source upload with provenance, a requirement key, or a user entry. The platform default applies to two keys only, `stormwater.psd_l_s` and `stormwater.osd_required`, and is stamped PLATFORM DEFAULT wherever it is used. Every other missing value is UNRESOLVED, the calculation that needs it is NOT EVALUATED, and the answer lists what is missing, the requirement key and how to supply it.
2. A result is never shown as a pass or a fail without its inputs. Each calculation shows the formula, the inputs with their basis and the result.
3. The server is authoritative for the calculation. The browser collects the entries, shows the answer and draws the overland flow layer.
4. User facing strings contain no em or en dash. Labels are upper case. Dates are shown as DD/MM/YYYY and stored as ISO dates.
5. Nothing is sent to anyone on the user's behalf.

## 2. What was built

| Item | Where |
|---|---|
| Catchment builder (areas, runoff coefficients, routing, pre and post development) | `backend/app/stormwater/catchment.py` |
| Design rainfall: IFD CSV parser, uploaded provider, live provider stub, ARR Data Hub export, soil table | `backend/app/stormwater/rainfall.py` |
| Uploaded data and entries per project | `backend/app/stormwater/store.py`, `inputs.py` |
| OSD sizing, orifice, comparison with placed storage | `backend/app/stormwater/osd.py` |
| Infiltration trench check | `backend/app/stormwater/infiltration.py` |
| Overland flow and ponding | `backend/app/stormwater/overland.py` |
| Orchestration and the `stormwater.v1` result | `backend/app/stormwater/analyse.py` |
| API | `backend/app/api/stormwater.py` |
| Overland limits | `backend/app/design/engine_limits.py` (`check_overland`) |
| New object type `discharge_point`, `drains_to_id` links, `detention_volume_l` | `backend/app/design/site_design.py`, `frontend/src/lib/site/types.ts`, `ops.ts`, `siteObjects.ts` |
| Requirement keys | `backend/app/design/object_keys.py`, `backend/app/agents/requirements/models.py` |
| Design tab panel | `frontend/src/components/viewer/StormwaterPanel.tsx`, `DesignPanel.tsx` |
| Mapping of the answer, entries, session | `frontend/src/lib/site/stormwater.ts`, `stormwaterApi.ts`, `stormwaterSession.ts` |
| Overland layer in 3D | `frontend/src/lib/site/overlandScene.ts`, `siteScene.ts` |
| Tests | `backend/tests/test_stage9_stormwater.py` (69), `frontend/tests/site/stormwater.test.ts` (40) |

Twenty three object types now exist (the new one is `discharge_point`). The golden fixture `backend/tests/fixtures/site_design_v1_frontend.json` was regenerated with `UPDATE_SITE_FIXTURE=1 npx vitest run tests/site/fixture_export.test.ts`.

## 3. Catchments and routing

Each surface object contributes a catchment row: roof (building footprint), driveway, footpath, pool, landscape, grading platform, and so on. The area is the footprint area from the model, and the basis of the area is shown. The runoff coefficient is read from `stormwater.runoff_coefficient.<surface>` (an LGA rule or a user entry). There is no default coefficient: an unresolved coefficient makes C x A for that row NOT EVALUATED and the total INCOMPLETE.

Routing follows the `drains_to_id` links (surface to rainwater tank, OSD, trench or discharge point) and `overflow_route` objects. Each row is grouped by its final destination, normally a discharge point. A surface with no link, a link to an unknown object or to the wrong type of object is reported as NO ROUTE and is not assumed to drain anywhere. An overflow route must end at an OSD (`osd_id`, an osd or osd_basin) or an infiltration trench (`trench_id`); the TYPE of the object named is checked. A tank can have one overflow route: two or more are refused (the overflow is not routed and the message names the routes). The pre development comparison uses surfaces marked existing; where none is marked it is shown as NOT SET.

Formula: CA = sum of (C x A) for each surface. Weighted coefficient C = CA / A.

## 4. Design rainfall

Providers:

1. Uploaded table (default). The user uploads the CSV exported from the Bureau of Meteorology 2016 IFD design rainfall page. The parser reads the header row (two or more exceedance columns, as AEP percent or EY, with AEP = 1 - exp(-EY)), then one duration per row. A user AEP matches a column within 0.05 percentage points (`AEP_MATCH_TOL_PCT`, a matching tolerance of this tool, not a requirement), so the BoM labels `63.2%` and `1EY` (63.21 percent) are one column: two columns within the tolerance are merged when their values agree (the exact EY conversion is kept as the AEP) and the upload is refused (`DUPLICATE_COLUMN`) when they differ. Units (intensity mm/h or depth mm) are read from the text above the table; if absent or ambiguous the upload is refused unless the user declares them. The requested and grid coordinates and the issue date are read when present, otherwise stored as NOT STATED. The exact layout of the export is not confirmed from a live download, so the parser is tolerant and records every assumption in the provenance (file name, hash, parser version, assumptions). A table whose coordinate is more than 5 km from the site is flagged. A hostile or damaged file is refused with a code and a 422 message, never a server error: a line over 2000 characters (`FIELD_TOO_LONG`; `csv.field_size_limit` is process wide and other modules read csv, so it is not changed and the line length check bounds every field), a row with more cells than the header (`RAGGED_ROW`), more than 200 cells in a row, a value that is not finite, not above zero or above 100000 (`BAD_VALUE`), a csv reader failure (`CSV_ERROR`) or any other parser failure (`PARSE_FAILED`). The same applies to the soil table and the ARR export (at most 300 sections).
2. Live BoM request. The request format is UNCONFIRMED (the BoM site is not reachable from the build sandbox). The default client refuses with `LIVE_UNCONFIRMED` and sends nothing. A client can be injected through the `live_ifd_client` dependency once the format is confirmed.
3. ARR Data Hub export. The text export is parsed and recorded with provenance. It is shown for reference. The sizing does not use it, because losses and temporal patterns are not applied in this stage.

A soil table (CSV) can also be uploaded for infiltration (section 7).

## 5. On site detention

The method is named by the requirement key `stormwater.osd_method`. Supported values: `mass_balance_modified_rational` and `user_ssr`. If the key is unresolved or names another method, the sizing is NOT EVALUATED and the answer lists the method as missing. There is no default method.

Required or not: `stormwater.osd_required` (platform default, stamped). If not required the answer is NOT REQUIRED.

Permissible site discharge PSD: `stormwater.psd_l_s` (platform default, stamped, or an LGA rule or entry).

Mass balance (modified rational method), for each duration td in the table:

* Qp = C x i(td) x A / 360 (Qp in m3/s from i in mm/h and A in ha), shown in L/s as Qp x 1000.
* Storage S(td) = (Qp - PSD) x (td x 60 - Tc x 60 x PSD / Qp), with Qp and PSD in the same units, td and Tc in minutes.
* Required storage = the maximum S(td). The td at which it occurs is the critical duration. The durations searched are the table rows from Tc to the search limit, and Tc itself when it is not a table row: its intensity is interpolated in log duration and log intensity between the two nearest rows, labelled INTERPOLATED, and a note states it. A Tc outside the table cannot be interpolated and is stated as not searched.

Surfaces that have no valid route (no link, an unknown link, an overflow route with no valid target, a tank with several overflow routes) block the sizing: the status is NOT EVALUATED, the message and the missing inputs list each unrouted surface and how to fix it, and `osd.catchment.unrouted` carries them. For the user SSR method the block applies only to the per hectare basis on the area draining to the OSD.

Hand check used in the tests: CA 360 m2, Tc 5 min, PSD 2 L/s, AEP 10 percent, the table gives a critical duration of 20 minutes and a required storage of 4.4 m3.

User SSR method: the required volume is `stormwater.ssr_m3`, or `stormwater.ssr_m3_per_ha` multiplied by the site area, with the area basis stated.

Rainwater tank rule: the detention portion of a tank counts toward the OSD volume only when `stormwater.rainwater_tank_excluded_from_detention_volume` is resolved and false, and only for a tank whose overflow route path reaches an OSD of the design (`provided.tanks`); a tank that does not reach one is listed in `provided.tanks_not_reaching_osd` and not counted. If it is unresolved the comparison is NOT EVALUATED.

Orifice: d = SQRT(4 Q / (pi x Cd x SQRT(2 g h))), with Q the PSD in m3/s, g = 9.81 m/s2 and h the head. The discharge coefficient Cd comes from `stormwater.orifice_discharge_coefficient` or an entry. If only the head to the invert is known, the diameter is found by iteration with the head taken to the orifice centre. The head entered in the panel (to the orifice centre) takes precedence over the head computed from the top water level and orifice invert on the OSD; the computed head is then shown as a reference input and marked NOT USED. The orifice is NOT EVALUATED without Cd and a head. A minimum diameter is compared where `stormwater.osd_min_orifice_diameter_mm` is resolved.

Comparison: the placed storage (`detention_volume_l` on the OSD or tank objects, or the geometry volume) is compared with the requirement and reported as ENOUGH or SHORT with the difference.

## 6. Peak flows

The rational method peak flow Q = C x i(Tc) x A / 360 is shown for the pre and post development sites when the time of concentration and the coefficients are resolved. The time of concentration comes from `stormwater.tc_pre_min` and `stormwater.tc_post_min` or an entry. No method for estimating Tc is applied. Otherwise NOT EVALUATED with the reason. When the lot area that no drawn surface covers exceeds 0.05 m2 in the pre or the post condition, the comparison is labelled PRE AND POST COVER DIFFERENT AREAS (`peak_flows.comparison_label`, with a note) and the unclassified area is listed in the missing inputs (area PEAK FLOW), because the two totals then cover different areas.

## 7. Infiltration

For each infiltration trench: V = L x W x D x n (n the void ratio, entered on the object), emptying time t = V / (q x A), with A = L x W and q in m/h from the rate in mm/h. The rate comes from a site test entry (date and method stated), a soil table row for a named soil unit, or a rate entered on the trench. A rate taken from a soil table is labelled INDICATIVE, SITE TESTING REQUIRED. A trench with no rate is NOT EVALUATED. A rate must be above zero: the soil parser refuses a rate of zero or below (`BAD_RATE`, 422), and a stored zero rate reports DOES NOT EMPTY (no emptying time, check FAIL) instead of failing. The emptying time check against the limit uses a requirement key; without it the time is shown and the check is NOT EVALUATED.

Worked example in the fixtures: V = 6.000 x 1 x 1 x 0.4 = 2.400 m3; q = 36 mm/h = 0.036 m/h; A = 6 m2; t = 2.4 / (0.036 x 6) = 11.11 h.

## 8. Overland flow and ponding

Method, on a raster of the lot plus a 5 m margin:

1. The surface is the existing terrain, or the terrain with proposed grading platforms applied (batters are not applied). Buildings and retaining walls are obstacles.
2. Priority flood with epsilon conditioning gives a drainable surface.
3. D8 receivers give the flow direction, and the flow accumulation is the contributing area in m2.
4. Depressions deeper than 0.01 m are reported as ponds (area, maximum depth, volume, spill level). They are reported, not silently filled. Cells the priority flood cannot reach from an outlet (enclosed by buildings or retaining walls) are CLOSED BASINS with NO OUTLET: each is reported with its area, lowest ground level, outline and its D8 sinks (cells with no lower neighbour that are not an outlet), counted and listed, and a note states them. They are never dropped and never filled.
5. Flow paths are the cells above a display threshold, drawn as ribbons whose width grows with the logarithm of the contributing area.

Defaults: cell 0.5 m, threshold 25 m2 (a display parameter, not a design value), depression minimum depth 0.01 m, margin 5 m. Every result carries the label FLOW PATHS INDICATIVE, NOT A FLOOD STUDY, which is also drawn in 3D. The layer is not pickable. Without terrain the analysis is NOT EVALUATED.

Limits (`engine_limits.py`): 400000 cells, cell size between set bounds, and caps on the number of paths, path points and ponds. An over limit request answers 422 with code `OVERLAND_INPUT_TOO_LARGE`. A wall clock limit of 8 s (`MAX_OVERLAND_SECONDS`) stops a calculation with 422 `OVERLAND_TIMEOUT`. The depression statistics are vectorised (they were quadratic in the number of depressions: 38 s on a noisy 632 by 632 surface). Measured at the cap: the raster solution of a noisy surface of 399,424 cells takes about 1.1 s, and the whole analysis of a 305 m lot (398,161 cells, 40 to 100 buildings) about 1.5 s; both are under 3 s in the tests.

## 9. API

| Route | Purpose | Cap |
|---|---|---|
| `POST /projects/{id}/stormwater/analyse` | run the analysis from a design, entries, rainfall source and overland options | 5 MB body |
| `GET /projects/{id}/stormwater/data` | uploaded data and saved entries | |
| `PUT /projects/{id}/stormwater/inputs` | save entries | |
| `POST /projects/{id}/stormwater/ifd`, `/arr`, `/soil` | upload | 2 MB each; a parse error answers 422 with its message; a parsed upload over the 3 MB stored limit answers 422 `STORED_FILE_TOO_LARGE` |
| `DELETE /projects/{id}/stormwater/{ifd|arr|soil}` | remove an upload | |

The calculation runs in the engine thread pool with the per project gate. Engine limit errors answer 422.

## 10. Requirement keys added

`stormwater.osd_method` (text), `stormwater.design_aep_pct`, `stormwater.tc_pre_min`, `stormwater.tc_post_min`, `stormwater.ssr_m3_per_ha`, `stormwater.rainwater_tank_excluded_from_detention_volume`, `stormwater.orifice_discharge_coefficient`, `stormwater.osd_min_orifice_diameter_mm`, and `stormwater.runoff_coefficient.<surface>` for each surface type. None has a platform default. `SiteRules.get_text` reads a text key.

## 11. Tests

Backend: 69 tests in `test_stage9_stormwater.py` and 43 review tests in `test_stage9_review.py` (catchments, parsers, mass balance hand check, NOT EVALUATED paths, the PSD default stamp, orifice, tank rule, infiltration, D8 plane and pit, performance, caps, dash scan, API). Full backend suite after the review fixes: 1343 passed, 46 skipped, 3 known failures in `tests/test_soee_site.py` (unchanged from baseline). Frontend: 40 tests in `stormwater.test.ts` and 3 in `stormwater_review.test.ts`; full suite 474 passed and `tsc` clean. The two JSON files in `frontend/tests/fixtures/` are SYNTHETIC TEST FIXTURES, not project data.

## 12. Known gaps

1. The live BoM request format is UNCONFIRMED and no live request is made.
2. The IFD CSV layout is tolerant but not confirmed against a live download.
3. The ARR Data Hub export is recorded, not used in the sizing (no losses or temporal patterns).
4. No pipe or pit hydraulics, no major or minor system design, no hydrograph routing.
5. Overland flow does not apply batters, kerbs, pipes or building overflow, and is not a flood study.
6. Tc is never estimated; it must be supplied.

## 13. Review fixes (commit stage 9: review fixes)

| # | Finding | Fix | Tests (`backend/tests/test_stage9_review.py`) |
|---|---|---|---|
| 1 | A surface with a broken route (no target, unknown `drains_to_id`, overflow route with no valid target) was left out of the OSD catchment | `unrouted` is built from all post development rows before the split; the sizing is NOT EVALUATED and lists each surface and how to fix it | tank with a 300 m2 roof and an overflow route without `osd_id`; driveway with `drains_to_id` "nope"; per hectare basis |
| 2 | A rate of zero crashed the emptying time (500) | The soil parser refuses a rate of zero or below; an emptying time of None reports DOES NOT EMPTY | parser, route, stored zero rate |
| 3 | `csv.Error` was a 500; ragged rows and huge values passed | Bounded reader (line length, cells per row, rows), ragged row check, value bound, every parser failure is a `RainfallError` (422) | 131073 character field, ragged rows, NaN, infinity, negative, 1e308, NUL bytes, through the routes |
| 4 | Cells enclosed by obstacles vanished (`enclosed_cells` was always 0) | The flood returns the reached mask; closed basins (area, lowest RL, NO OUTLET) and D8 sinks are reported, listed in a note and drawn | basin walled by four buildings, raster level test |
| 5 | Tc was never a searched duration and the interpolation note was unreachable | Tc is searched when it is not a table row (log duration, log intensity, INTERPOLATED) | hand calculation at 12 min |
| 6 | EY columns and user AEPs were matched exactly | Match within 0.05 percentage points; `63.2%` and `1EY` merge, refused when values differ | merge, refusal, tolerance edges, sizing with 63.2 against a 1EY column |
| 7 | Every tank counted its detention | Only a tank whose route path reaches an OSD counts | tank with and without an overflow route to the OSD |
| 8 | The computed head won over the entered head | The entered head wins; the computed head is shown as a reference | diameter and inputs |
| 9 | Pre and post totals compared when they covered different areas | Label PRE AND POST COVER DIFFERENT AREAS and the unclassified area in the missing inputs | partial pre development, control with full cover |
| 10 | Depression statistics were quadratic; no time limit | Vectorised statistics, wall clock limit 8 s (`OVERLAND_TIMEOUT`, 422); the cell cap stays at 400000 because the worst case is now about 1.5 s | noisy surface at the cap, full analysis at the cap, timeout through the route |
| 11 | Overflow route targets were not type checked; several routes per tank were silently reduced to the first | Type check of `osd_id` and `trench_id`; a tank with more than one overflow route is refused with a message | building as target, unknown id, trench target, two routes |
| 12 | A parsed upload over the stored limit was a 500 | `StoreTooLarge` is 422 `STORED_FILE_TOO_LARGE` on all four saves | monkeypatched limit through the routes |

Changed existing test: `test_mass_balance_only_searches_durations_from_tc_to_the_limit` now expects Tc (12 min, INTERPOLATED) as a searched duration. Frontend: closed basins, the cover label, DOES NOT EMPTY and the unrouted fields are mapped and drawn (`frontend/tests/site/stormwater_review.test.ts`, 3 tests).
