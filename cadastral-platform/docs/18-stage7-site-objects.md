# 18. Stage 7: engineering parameters, checks and 3D models for site objects

Date: 15/10/2026. Status: STAGE 7 COMPLETE, REVIEW FIXES APPLIED (section 10), AWAITING OWNER REVIEW. Local commit only; nothing pushed.

## 1. Rules this stage follows

1. No data is invented. Every engineering value is one of: a value the user entered (basis USER), an LGA or state rule through the requirement resolver, the platform default where docs/14 section 7.3 defines one (`stormwater.osd_required` and `stormwater.psd_l_s` only, stamped), or UNRESOLVED. A check that needs an UNRESOLVED requirement is NOT EVALUATED and names the key.
2. The JCE drainage conventions are not used anywhere.
3. Retaining walls are screening only. Every output is labelled SCREENING ONLY, NOT STRUCTURAL DESIGN.
4. User facing strings contain no em or en dash. 3D labels are upper case. Dates are shown as DD/MM/YYYY (stored as ISO dates).
5. The server is authoritative for rule based checks. The browser asks for them and shows what comes back.

## 2. What was built

| Item | Where |
|---|---|
| Requirement key table (56 keys), unit and kind of each | `backend/app/design/object_keys.py` |
| Help text of every key (the keys are registered with the resolver) | `backend/app/agents/requirements/models.py` (`SITE_OBJECT_KEY_HELP`) |
| Rule wrapper for booleans, ratios, counts and lists | `backend/app/design/site_rules.py` |
| Object geometry and footprints | `backend/app/design/object_geometry.py` |
| Retaining wall screening (reuses SA3 `walls.screen`) | `backend/app/design/wall_screening.py` |
| Whole design checks (`site_checks.v1`) | `backend/app/design/object_checks.py` |
| Optional tank sizing | `backend/app/design/rwt_size.py`, SA4 `rwt.py` |
| Routes `POST /projects/{id}/site-design/check` and `/rwt-size` | `backend/app/api/site_design.py` |
| Types, parameters, enumerations, wall levels per vertex | `frontend/src/lib/site/types.ts`, `ops.ts` |
| Fields, computed values, label lines | `frontend/src/lib/site/siteObjects.ts` |
| 3D models | `frontend/src/lib/site/siteScene.ts` |
| Server check client and the shared list | `serverChecks.ts`, `checkList.ts`, `engineApi.ts` |
| Design tab | `components/viewer/DesignPanel.tsx`, `ObjectSections.tsx` |

## 3. Object types

Eighteen object types now exist. The stormwater pit was renamed from `pit` to `stormwater_pit`; a stored document or a caller that still says `pit` is read as `stormwater_pit` (backend model and frontend `parseDesign` and `add_object`). `pool_barrier` (a fence line with a height) and `overflow_route` (an OSD overflow path) are new. Existing objects keep their meaning.

A 3D model is built from the parameters. While a parameter it needs is NOT SET the object is a marker (dots at its vertices, or a pole) and its label says DIMENSIONS NOT SET.

| Type | Parameters entered | Model | Checks (requirement keys) |
|---|---|---|---|
| `rwt` | shape (round, slimline, underground), diameter or length and width, height, volume, base, inlet, overflow and outlet RL, linked building, connected roof area, reuse flags, optional sizing inputs | Cylinder or box; an underground tank is a translucent body below the ground with its outline at the surface | Maximum height (`rwt.max_height_m` and every `rwt.max_height_m.*` row found); behind the street setback (`rwt.location_behind_street_setback`); underground clearance (`rwt.underground_tank_min_clearance_m`); boundary distance (`rwt.min_boundary_distance_m`); connected roof against the linked roof area (a model check that also shows the roof area basis); inlet above overflow above outlet, and all three inside the tank body from the base RL up to base RL plus height (model checks) |
| `retaining_wall` | wall type, top and bottom RL per vertex or one height, thickness, surcharge description, optional screening assumptions | Wall between the top and bottom surfaces, linearly interpolated between vertices | Screening (the eight `retaining.*` assumption keys); certification height (`retaining.certification_height_m`); height limit of the wall type (`retaining.type_max_height_m.*`) |
| `infiltration_trench` | width, depth, void ratio, design infiltration rate and basis (site test with its date, or indicative) | Surface ribbon and a translucent body below | Storage volume V = L x W x D x n shown with the calculation; offsets from the boundary, buildings and services (`infiltration.min_offset_*`); footprint within the lot |
| `osd`, `osd_basin` | form (tank, basin, below ground), dimensions, storage volume, orifice diameter and invert, top water level, optional Cd and PSD | Box above or below ground; basin walls | PSD (`stormwater.psd_l_s`, platform default stamped when no LGA row); orifice equation shown only when Cd resolves (`stormwater.orifice_discharge_coefficient` or a user entry); minimum orifice (`stormwater.osd_min_orifice_diameter_mm`); overflow route linked; OSD required (`stormwater.osd_required`); storage against `stormwater.ssr_m3` |
| `stormwater_pit` | width, length, invert RL | Plate and a translucent depth to the invert | Surface level from the terrain, depth computed |
| `stormwater_pipe` | diameter, material, upstream and downstream invert | Tube along the inverts | Ends at pits (snap tolerance 0.05 m); grade computed, minimum from `stormwater.min_pipe_grade_pct`; cover computed against the terrain, minimum from `stormwater.min_cover_m`; diameter (`stormwater.min_pipe_diameter_mm`); direction changes only at pits (`stormwater.pipe_bends_at_pits_only`) |
| `pool` | depth, coping width, water level | Water plane at the water level, walls and floor down by the depth, coping band | Label POOL BARRIER REQUIREMENTS: SEE RULES; a barrier must be drawn |
| `pool_barrier` | height, linked pool (required: an unlinked barrier satisfies no pool) | Fence | Height (`pool.barrier_min_height_m`); setback from the lot boundary (`pool.barrier_min_setback_m`); link to a pool |
| `footpath` | width, surface, impervious flag, crossfall | Ribbon | Width (`footpath.min_width_m`); crossfall (`footpath.min_crossfall_pct`, `footpath.max_crossfall_pct`) |
| `tree` | status, height, canopy, trunk diameter | Sphere on a pole; rings for the protection zones | TPZ only from `tree.tpz_dbh_multiplier` (with the optional radius limits); SRZ only from `tree.srz_coefficient`, `tree.srz_exponent` and `tree.srz_min_radius_m` together; encroachment of other objects |
| `landscape_area` | surface kind | Fill coloured by kind, area label | Runoff behaviour from `landscape.runoff_coefficient.<kind>` |
| `overflow_route` | linked OSD | Line with an arrow head | Link check |

## 4. Requirement keys

All keys below are registered with help text. None has a default except the two the platform default profile holds (docs/14 section 7.3). Gunnedah holds rows for three of them only; every other key is UNRESOLVED for Gunnedah, so its checks are NOT EVALUATED there until rules are loaded or the user enters a value.

| Key | Unit | Kind | Registration | Status |
|---|---|---|---|---|
| `rwt.max_height_m` | m | number | new in stage 7 | UNRESOLVED, no default |
| `rwt.max_height_m.urban_zones` | m | number | existing rows, help registered in stage 7 | LGA RULE in Gunnedah: 3.2 m; key help registered in stage 7 |
| `rwt.location_behind_street_setback` | true or false | bool | existing rows, help registered in stage 7 | LGA RULE in Gunnedah: true; key help registered in stage 7 |
| `rwt.underground_tank_min_clearance_m` | m | number | existing rows, help registered in stage 7 | LGA RULE in Gunnedah: 1 m; key help registered in stage 7 |
| `rwt.min_boundary_distance_m` | m | number | new in stage 7 | UNRESOLVED, no default |
| `rwt.runoff_coefficient` | ratio | ratio | new in stage 7 | UNRESOLVED, no default |
| `rwt.first_flush_mm` | mm | number | new in stage 7 | UNRESOLVED, no default |
| `rwt.demand.occupants` | count | count | new in stage 7 | UNRESOLVED, no default |
| `rwt.demand.toilet_l_pp_day` | L/person/day | number | new in stage 7 | UNRESOLVED, no default |
| `rwt.demand.laundry_l_pp_day` | L/person/day | number | new in stage 7 | UNRESOLVED, no default |
| `rwt.demand.garden_l_m2_day` | L/m2/day | number | new in stage 7 | UNRESOLVED, no default |
| `rwt.demand.garden_monthly_factor` | list | list | new in stage 7 | UNRESOLVED, no default |
| `rwt.candidate_sizes_l` | list | list | new in stage 7 | UNRESOLVED, no default |
| `rwt.tank_height_m` | m | number | new in stage 7 | UNRESOLVED, no default |
| `rwt.wet_day_fraction` | ratio | ratio | new in stage 7 | UNRESOLVED, no default |
| `retaining.soil_friction_angle_deg` | deg | number | new in stage 7 | UNRESOLVED, no default |
| `retaining.soil_unit_weight_kn_m3` | kN/m3 | number | new in stage 7 | UNRESOLVED, no default |
| `retaining.wall_friction_ratio` | ratio | ratio | new in stage 7 | UNRESOLVED, no default |
| `retaining.gravity_wall_width_ratio` | ratio | ratio | new in stage 7 | UNRESOLVED, no default |
| `retaining.wall_unit_weight_kn_m3` | kN/m3 | number | new in stage 7 | UNRESOLVED, no default |
| `retaining.min_fs_sliding` | ratio | ratio | new in stage 7 | UNRESOLVED, no default |
| `retaining.min_fs_overturning` | ratio | ratio | new in stage 7 | UNRESOLVED, no default |
| `retaining.surcharge_kpa` | kPa | number | new in stage 7 | UNRESOLVED, no default |
| `retaining.certification_height_m` | m | number | new in stage 7 | UNRESOLVED, no default |
| `retaining.type_max_height_m.sleeper` | m | number | new in stage 7 | UNRESOLVED, no default |
| `retaining.type_max_height_m.block` | m | number | new in stage 7 | UNRESOLVED, no default |
| `retaining.type_max_height_m.concrete` | m | number | new in stage 7 | UNRESOLVED, no default |
| `infiltration.min_offset_boundary_m` | m | number | new in stage 7 | UNRESOLVED, no default |
| `infiltration.min_offset_building_m` | m | number | new in stage 7 | UNRESOLVED, no default |
| `infiltration.min_offset_service_m` | m | number | new in stage 7 | UNRESOLVED, no default |
| `stormwater.osd_required` | true or false | bool | existing (stage 2B) | Platform default stamped (PLATFORM DEFAULT, LGA RULE NOT LOADED, or LGA VALUE NOT FOUND); an LGA row overrides it |
| `stormwater.psd_l_s` | L/s | number | existing (stage 2B) | Platform default stamped (PLATFORM DEFAULT, LGA RULE NOT LOADED, or LGA VALUE NOT FOUND); an LGA row overrides it |
| `stormwater.ssr_m3` | m3 | number | existing (stage 2B) | UNRESOLVED (no default) |
| `stormwater.orifice_discharge_coefficient` | ratio | ratio | new in stage 7 | UNRESOLVED, no default |
| `stormwater.osd_min_orifice_diameter_mm` | mm | number | new in stage 7 | UNRESOLVED, no default |
| `stormwater.min_pipe_grade_pct` | % | number | new in stage 7 | UNRESOLVED, no default |
| `stormwater.min_cover_m` | m | number | new in stage 7 | UNRESOLVED, no default |
| `stormwater.min_pipe_diameter_mm` | mm | number | new in stage 7 | UNRESOLVED, no default |
| `stormwater.pipe_bends_at_pits_only` | true or false | bool | new in stage 7 | UNRESOLVED, no default |
| `pool.barrier_min_height_m` | m | number | new in stage 7 | UNRESOLVED, no default |
| `pool.barrier_min_setback_m` | m | number | new in stage 7 | UNRESOLVED, no default |
| `footpath.min_width_m` | m | number | new in stage 7 | UNRESOLVED, no default |
| `footpath.max_crossfall_pct` | % | number | new in stage 7 | UNRESOLVED, no default |
| `footpath.min_crossfall_pct` | % | number | new in stage 7 | UNRESOLVED, no default |
| `tree.tpz_dbh_multiplier` | ratio | ratio | new in stage 7 | UNRESOLVED, no default |
| `tree.tpz_min_radius_m` | m | number | new in stage 7 | UNRESOLVED, no default |
| `tree.tpz_max_radius_m` | m | number | new in stage 7 | UNRESOLVED, no default |
| `tree.srz_coefficient` | ratio | ratio | new in review | UNRESOLVED, no default |
| `tree.srz_exponent` | ratio | ratio | new in review | UNRESOLVED, no default |
| `tree.srz_min_radius_m` | m | number | new in review | UNRESOLVED, no default |
| `landscape.runoff_coefficient.turf` | ratio | ratio | new in stage 7 | UNRESOLVED, no default |
| `landscape.runoff_coefficient.garden_bed` | ratio | ratio | new in stage 7 | UNRESOLVED, no default |
| `landscape.runoff_coefficient.mulch` | ratio | ratio | new in stage 7 | UNRESOLVED, no default |
| `landscape.runoff_coefficient.gravel` | ratio | ratio | new in stage 7 | UNRESOLVED, no default |
| `landscape.runoff_coefficient.permeable_paving` | ratio | ratio | new in stage 7 | UNRESOLVED, no default |
| `landscape.runoff_coefficient.impervious_paving` | ratio | ratio | new in stage 7 | UNRESOLVED, no default |

A test (`test_every_key_is_registered_with_help_and_only_two_have_a_platform_default`) fails if a key lacks help text or if any key other than the two above resolves for an LGA with no rows.

## 5. SA4 rainwater tank changes

The hard coded values of the SA4 mass balance (runoff coefficient, first flush, occupants, toilet, laundry and garden demand, monthly garden factors, candidate sizes, tank height, wet day fraction, boundary offset) are now registered keys (`rwt.runoff_coefficient`, `rwt.first_flush_mm`, `rwt.demand.*`, `rwt.candidate_sizes_l`, `rwt.tank_height_m`, `rwt.wet_day_fraction`, `rwt.min_boundary_distance_m`) with no defaults.

- `size_rwt` takes a value the caller set explicitly as USER. With a requirement set it uses the cited row; a key it cannot resolve is listed in `unresolved`, nothing is sized, and no placeholder is used. With `use_placeholders` (or the legacy path with no requirement set) the old value is still used, and every such use is stamped (`RwtSizing.placeholders`, each with the key, the field, the value and the stamp PLACEHOLDER, NOT A REQUIREMENT) and repeated in the messages.
- A tank that does not use a demand (the use is switched off), and the boundary offset when there is no lot to place the tank in, are not needed and are not stamped.
- Test change: `test_sa4_uses_cited_requirements` now passes a fully explicit tank input. Before, unset fields silently took the old defaults even when a requirement set was supplied; that is the behaviour this stage removes.
- The optional "size this tank" action (`POST .../rwt-size`) runs the mass balance only when every input resolves (entered on the tank, or a requirement key). Otherwise it answers UNRESOLVED and lists each missing input. There is no rainfall data source yet, so the twelve monthly totals and the station are entered by the user (basis USER, shown in the answer).

## 6. Retaining wall screening

`wall_screening.py` reuses the SA3 routine `screen` (Coulomb active pressure on a gravity wall, sliding and overturning). The SA3 `WallAssumptions` defaults are not used here: all eight assumptions (soil friction angle, soil and wall unit weight, wall friction ratio, base width ratio, the two minimum factors of safety and the surcharge) come from the wall (a value the user entered) or from their `retaining.*` keys. With any of them UNRESOLVED the wall is NOT EVALUATED and the missing keys are named. The height of a segment is the larger of the end heights (top RL minus bottom RL); a segment with no height is not screened. Groundwater is not modelled. SA3's own pipeline now marks its built in assumptions PLACEHOLDER, NOT A REQUIREMENT.

## 7. Design decisions to review

1. Street setback (tank): the nearest point of the tank is compared with the front building line of the linked or only dwelling, both measured from the assumed kerb line towards the lot. NOT EVALUATED without a kerb line, a lot or an identified dwelling. A tank below ground is reported as INFO because the Gunnedah rule exempts it.
2. Zone qualified keys (`rwt.max_height_m.*`): every row found is compared and the message says the zone of the lot is not checked.
3. Pool barrier setback is the distance from the barrier line to the lot boundary. Pool depth is the water depth below the water level; the coping band is the pool outline pushed outwards by the coping width.
4. Pipe cover is measured to the pipe crown from the nominal diameter (wall thickness is not modelled), at stations every 1 m and at every vertex. The pit snap tolerance is 0.05 m.
5. A tree zone encroachment is blocking when it enters the structural root zone and a warning when it only enters the protection zone.
6. Tree protection zone radius is the multiplier times the trunk diameter, limited by `tree.tpz_min_radius_m` and `tree.tpz_max_radius_m` only when those resolve. The structural root zone is NOT a linear multiplier: it is R = c x D^e (D = trunk diameter in metres, R in metres), not less than the minimum radius, with `tree.srz_coefficient`, `tree.srz_exponent` and `tree.srz_min_radius_m` all registered with no default. The SRZ is computed only when all three resolve from a cited source, so no formula value is built in. The rule you adopt (for example the formula of AS 4970) must be loaded with its citation.
7. Pool and OSD objects now need their new parameters (water level, form) before a model is drawn; objects saved earlier without them are drawn as outlines with DIMENSIONS NOT SET.
8. Limits (`app.design.engine_limits`, 422 `CHECK_INPUT_TOO_LARGE` before any work): a design over 2000 objects; a pipe over 300 m, 200 vertices or 1000 cover stations; all pipes over 2000 m or 2000 vertices in total; more than 250000 tree and object pairs. Tree encroachments are listed up to 200.
9. The golden fixture `backend/tests/fixtures/site_design_v1_frontend.json` was regenerated; it now covers all eighteen types and the new typed parameters.
10. Basis of a parameter (review fix). Every engineering input of the checks, the wall screening and the tank sizing is read through `app/design/param_basis.py`. USER is accepted. An LGA RULE value is accepted only when its reference names a requirement key that the server resolver resolves, for the project's LGA, to the same value (a parameter that has a registered key must name that key); otherwise it is read as UNRESOLVED and the check says LGA RULE REFERENCE NOT VERIFIED. A PLATFORM DEFAULT value is never accepted, except the OSD `psd_l_s` when the resolver gives that same platform default. The true basis is echoed (a verified rule shows LGA RULE or STATE RULE, never USER). A value that is refused is not replaced by the requirement key. The backend model refuses `platform_default` on the parameters of the stage 7 types (rwt, retaining wall, trench, OSD, basin, pit, pipe, barrier, overflow route, tree), with two exceptions: the OSD `psd_l_s` and the Plan Studio size ESTIMATE stamped on an imported tank diameter or height. The checks do not use that estimate: enter the manufacturer size on the tank. `set_param` in the browser refuses `platform_default` and requires a non blank requirement key as the ref of an LGA RULE.
11. Ranges (review fix). A user or requirement value outside its physical bounds is refused with a message and no result is given: soil friction angle 0 to 60 degrees, wall friction ratio 0 to 1, unit weights, base width ratio and the two factors of safety above 0, surcharge not below 0 (wall screening); runoff coefficient 0 to 1, first flush, demands and areas not below 0, tank height above 0, wet day fraction above 0 and at most 1 (tank sizing). A value beyond 1e9 is refused as out of range. These are the limits of what the calculations can take, not requirement values.
12. Tank levels (review fix). The check needs the tank base RL (`base_rl`, entered on the tank) and height: inlet above overflow above outlet, and every level from the base RL up to the base RL plus the height. NOT EVALUATED lists what is missing; a level that is already out of order or outside the body is a FAIL whatever else is missing.
13. Pool barrier link (review fix). A barrier satisfies a pool only when its `pool_id` is that pool. An unlinked barrier belongs to no pool; the pool check says NO LINKED BARRIER and the barrier check asks for the link.
14. Client and server parity (review fix). A pit whose invert is not below the surface shows FAIL in the browser, as on the server. The volume of a slimline or underground tank (L x W x H) and of a round tank is computed on both sides. `backend/tests/fixtures/stage7_parity.json` is run through the Python checks and the browser's computed values.
15. Zone keys (review fix). A zone qualified key (`rwt.max_height_m.<zone>`) takes the unit of its family, and a zone key found in the rules that does not resolve is named in the tank height message instead of being skipped.
16. Tank sizing (review fix). When the run is blocked only by a value the SA4 routine would have replaced with a stamped placeholder, each such field is listed in `missing`. SA4 and the site keys share one dimensionless unit set (`DIMENSIONLESS_UNITS`).

## 8. Tests

Backend: `tests/test_site_objects.py` (key registration, each check with a fake requirement set, NOT EVALUATED when unresolved, the PSD platform default stamp, SA4 placeholders stamped, wall screening refusal, trench volume, pipe grade and cover on a synthetic terrain, endpoints, dash scan). `tests/test_site_objects_review.py` (basis enforcement, the caps, a fuzz of every check with zero, negative and NaN values, ranges, the SRZ keys, the pool link, tank levels, parity, the legacy `pit` alias). Frontend: `tests/site/stage7_objects.test.ts` (parameters, models and markers, wall levels, computed values, the shared list, the check client), `stage7_controller.test.ts` (wiring) and `stage7_review.test.ts` (set_param basis rules, parity).

## 9. Known gaps

- DBYD services are not loaded until stage 8, so offsets and clearances from services are NOT EVALUATED unless a `service_trace` is drawn.
- No rainfall data source exists; the sizing action takes user entered totals.
- The panel does not yet draw the overflow route over the terrain for flow direction checks (only a link check).
