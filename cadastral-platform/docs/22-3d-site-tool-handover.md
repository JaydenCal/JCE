# 22. 3D site tool handover (stage 11, final)

Date: 15/10/2026. Status: READY FOR OWNER REVIEW. This document closes the 3D site tool work that began with `docs/13` and `docs/14`. It records what exists, how to run it, the environment variables, every known limitation carried from `docs/15` to `docs/21`, the decisions that remain with the owner, and the test baselines.

## 1. Purpose and status

The 3D site model is a design tool: an imported building is placed on the terrain, site objects and services are added, the engines check and size them, an AI first design is offered, and the result is exported as a GLB, a DXF on the JCS layers and schedules. Every figure comes from a cited rule, a user entry or an engine; anything else reads NOT SET, UNRESOLVED or DATA NOT AVAILABLE.

The tool is a drafting and screening aid. Terrain from the 5 m DEM is INDICATIVE, LiDAR is PENDING, services are UNVERIFIED until the user verifies them, and every export says so. The responsible engineer remains responsible for the design.

## 2. What exists, by stage

| Stage | Content | Where to read |
|---|---|---|
| 1 | Reuse study, scope and the site design proposal | `docs/13`, `docs/14` |
| 2 | Rebranding, the AI GENERATED DRAFT statement, the scene bundle route, LGA lookup, the rules table with the platform default profile, LiDAR and DBYD access study | `docs/15` |
| 3 | Terrain chain (user survey, hosted LiDAR tiles, NSW 5 m DEM), terrain provenance, aerial, contours, boundary, adjoining lots, road and assumed kerb | `docs/15`, `backend/app/agents/sa3_terrain` |
| 4 | Editing core: `site_design.v1`, operation registry with patch undo, point, line and area tools, GET and PUT of the design | `docs/16` |
| 5 | Building import (Plan Studio file with its GLB, PDF, DXF, footprint entry) and placement with FFL | `docs/17` |
| 6 | Driveway drag tool (crossover slides on the assumed kerb line), long section, grading areas, batters, cut and fill | `backend/app/design/driveway_engine.py`, `grading_engine.py`. There is no separate stage 6 document. |
| 7 | Site objects: trees, landscape areas, retaining walls, rainwater tank, infiltration trench, OSD, pits, pipes, with requirement keys and checks | `docs/18` |
| 8 | DBYD services in the model, sewer and water tools, clearance and zone of influence checks, BYDA client | `docs/19` |
| 9 | Stormwater helper: catchments, design rainfall from an uploaded IFD table, OSD sizing, peak flows, infiltration, overland flow | `docs/20` |
| 10 | AI first design and the proposal checklist | `docs/21` |
| 11 | Pipeline integration, exports, viewer polish, first person outdoors, the derived basis rule, the browser test, this document | sections 3 to 9 below |

## 3. Stage 11: pipeline integration

* The SA6 node of the orchestrator is the real scene agent. The stub is gone. Its dependencies are SA1 and ENV; SA3, SA4 and SA7 run before it when they exist, and a failure of those does not stop the scene (`tolerate_after_failure`). The export gate still applies.
* `backend/app/orchestrator/adapters/sa6.py` resolves the terrain chain and the aerial through `backend/app/agents/sa6_site3d/site_data.py`, the same code `scripts/run_site.py` uses, so a scene built through the orchestrator or the API carries the terrain provenance exactly as a script run does. The terrain and aerial modes come from the node input, then from `JCESITE_TERRAIN` and `JCESITE_AERIAL`, then default to `auto`.
* The adapter writes `<output_path>/scene_bundle.json`, the file `GET /projects/{id}/scene-bundle` serves, and returns a small result (path, hash, part count, terrain status, aerial present). The scene is a site scene: no building is invented.
* `POST /projects/{id}/scene/rebuild` (status 202) creates a run that targets SA6 only and returns the run id, the status and the scene bundle URL. The body is `{params, project_title, development_type}` with `params` as for `POST /runs`. The run needs the database; the route is tested with a fake orchestrator.
* A rebuild always recomputes: SA6 is marked `cacheable=False` in the DAG (`NodeSpec.cacheable`), so the orchestrator never answers it from the idempotency cache. Its output depends on live terrain and aerial services that its input does not describe, so a cache hit would hand back a stale scene. The same applies when a full run is resumed: SA6 is rerun, the other nodes stay cache hits.
* One rebuild per project at a time: the route takes a lease (`scene_rebuild.lease` in the project folder, under the file lock, so it holds across worker processes) and answers 409 `REBUILD_ACTIVE` while another rebuild holds it. The lease is given back when the background run ends, whether it succeeded or failed, and expires after 20 minutes so a crashed process cannot block a project (`backend/app/orchestrator/rebuild_lease.py`).
* One base folder: `backend/app/common/bundle_dir.py` (`scene_base_dir`, `project_dir`) decides it, `SCENE_BUNDLE_DIR` when set, else the API `EXPORT_DIR`. The SA6 writer (`orchestrator/inputs.py`), `GET /scene-bundle`, the site design routes, the stormwater store and the exports all call it, so the bundle SA6 writes is the bundle the viewer and the exports read even when the two settings differ.
* The site design is merged into the exports (section 4), so the GLB and the DXF show the placed building, the driveway and the other objects together with the terrain of the saved scene bundle.

## 4. Stage 11: exports

`GET /projects/{project_id}/exports/{kind}`. The exports are built from the SAVED scene bundle and the SAVED site design. The browser saves first, then asks. A project without a scene bundle still exports its design and says TERRAIN DATA NOT AVAILABLE.

| Kind | Content |
|---|---|
| `glb` | The whole site: terrain, the aerial (optional, `include_aerial`), every design object, buildings with their stored Plan Studio GLB merged in. Each object is a node named by the object id, with its kind in the node extras. The asset extras carry the status wording. |
| `dxf` | Site design in plan, R2010 by default (text stored as UTF-8), `?version=R2000` and `?version=R12` available (code page 1252: an accent is stored correctly, a letter outside the code page is written as `\U+XXXX`). One layer per object type and status on the JCS scheme, contours, boundary, services (dashed linetype while unverified), upper case labels, MGA coordinates, title note with the terrain status. The layer table is in `docs/11`, section "Stage 11 export layers". |
| `objects.csv`, `objects.json` | Objects with every parameter, its value, unit and basis. An UNRESOLVED parameter has the value `NOT SET` in both, with its `basis` beside it. |
| `checks.csv`, `checks.json` | The rule based checks run on the saved design. |
| `stormwater.csv`, `stormwater.json` | The stormwater summary of the saved design with the saved entries and uploads. |

`PUT /projects/{project_id}/exports/building-glb/{object_id}` stores the Plan Studio GLB of a building (at most 15 MB, glTF version 2) so the GLB export can include it. The Export tab sends it automatically when it is not yet stored.

Review fixes to the exports (section 13):

* CSV formula injection. Every text cell of every CSV (labels, parameter values, refs, check messages, stormwater items) that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading apostrophe (`schedules.safe_cell`). Numbers are left as numbers.
* The building GLB is validated at PUT (`glb.validate_gltf`): the JSON chunk is an object, every index is an integer in range, every buffer view and every accessor lies inside the BIN chunk, an accessor has at most 2,000,000 elements, and the numbers of nodes (20,000), meshes (10,000), primitives and other arrays are capped. A failure is 422 `INVALID_GLB`. The merge into the export works on scratch lists and changes the output only when it succeeded; a stored model that still cannot be merged is skipped with the note `BUILDING MODEL SKIPPED, INVALID` in the node extras and the asset notes, never a 500.
* The GLB, DXF and schedule builds run on the engine pool under the per project gate (`_run_engine`), with a time cap (60 s, checked per object and per part; 504 `EXPORT_TIMEOUT`) and a running byte total (120 MB, counted before each buffer is added, also for the stored building GLBs read from disk): a build that would pass it stops first with 413 `EXPORT_TOO_LARGE`.
* The stored GLB of a building is deleted when the building is no longer in the saved design (checked on every PUT of the site design, `exports/building_store.py`). The platform has no project deletion yet; a delete hook must call `building_store.prune(folder, set())`, or remove the project folder.
* A bundle label without a usable position is skipped in the DXF and the title note says how many (no KeyError).

Status wording carried by every export, in upper case: TERRAIN: INDICATIVE 5 m DEM, LIDAR PENDING, NOT SURVEY (or whatever the bundle states for the terrain actually used), TERRAIN SOURCE, DATA STATUS, SERVICES: n OF m UNVERIFIED, INDICATIVE ONLY, AI PROPOSALS PENDING REVIEW, and the indicative statement.

Limits of the exports: the GLB is for viewing and coordination, not for construction. The DXF is a plan view of the design objects, not the plan set (the plan set is produced by SA5). DXF text is upper case by construction and is tested.

## 5. Stage 11: viewer polish and first person outdoors

Layer toggles are grouped: terrain, context, design objects (by object type), services (by kind), stormwater results (overland flow). A group box switches its members. Top view toggles with `T` and shows a north arrow and a scale bar. The measurement tool (`M`) measures distance, area and level difference on the terrain, in plan and along the slope, and says INDICATIVE with the terrain status. `H` or `?` opens the shortcut list. In first person the minimap shows the lot boundary, the design objects and the player.

First person outdoors walks on the terrain and on design surfaces (driveway, footpath, grading surface, pool coping). It collides with buildings, retaining walls, tanks, pools and furniture. The pool water surface is not walkable. The limits are named display constants in `frontend/src/lib/viewer/fpLimits.ts`: step up 0.4 m, slope limit 45 degrees, eye height 1.6 m, collider edge 0.3 m, default collider height 3.0 m, pool edge height 1.2 m, collider base 1.0 m below the surface. They are display settings of the walk. They are NOT requirements and say nothing about access or trafficability. The Walk panel states this.

## 6. Stage 11: the derived basis rule (closes the stage 10 loophole)

The parameter basis `derived` marks a value produced by an engine. Only the server side AI first design batch may write engine derived parameters.

* Client: the `set_param` and `add_object` operations refuse the basis `derived` for the engine parameters unless the call is part of a first design batch (`engine: true` in `runBatch`). The design assistant and the user cannot write it.
* The first design route computes from the SAVED design. The page saves first (`FirstDesignSession.flush`, wired to the autosave), and the route compares the design in the request with the saved one (`derived_ledger.inputs_hash`: every object without its engine derived parameters and its accepted state). A design that is not the saved one is 409 `DESIGN_NOT_SAVED` and nothing is computed or recorded. The candidates are built from the design read from storage, not from the one in the request.
* Server: every first design response records a RECORD in `<base>/<project_id>/first_design_ledger.json` (`backend/app/design/derived_ledger.py`, schema `first_design_ledger.v2`): the saved version it was computed from, a fingerprint of every object of that saved design (the inputs) and the derived values (object id, key, value). On PUT of the site design, an engine derived parameter that is not unchanged from the design already saved must be in a record whose version is not after the saved version AND whose inputs are all present in the design being saved, unchanged (the parameters the batch itself set or removed, the engine derived parameters and the accepted state are left out of the fingerprint). Otherwise the PUT is 422 `DERIVED_NOT_FROM_FIRST_DESIGN` with the parameters listed. So a fake depth of a main saved to make the engine derive a level cannot be followed by a PUT of the real design with those derived values: the real design is not the design they were computed from. The user runs AI first design again.
* A derived value that is unchanged from the design already saved is accepted, so an accepted proposal can be saved again after a reload. A parameter the user edits changes its basis to `user` and leaves the rule. The ledger keeps the last 100 records. A ledger written before this change (schema v1) backs nothing; run AI first design again.
* Every first design run counts against a per project limit of runs per minute and per day (`ai_guard.run_rate_limit`, the same numbers as the AI limits, counted apart), also with `use_ai` false. An estimate is not a run.

## 7. How to run

From `cadastral-platform/backend`:

```
python3 scripts/run_site.py --check-network
python3 scripts/run_site.py --offline lot2 --lotplan 2//DP227508 --development-type dwelling_house --levels nsw --rules-json <rules.json> --acknowledge --out <dir>
python3 -m pytest -q -p no:cacheprovider
```

The API: `DATABASE_URL` set, then `uvicorn --factory app.api.app:create_app --port 8000`. The scene bundle of a project is read from `SCENE_BUNDLE_DIR/<project_id>/scene_bundle.json` (else `EXPORT_DIR`). Without a database, only the harness in section 9 serves the routes.

From `cadastral-platform/frontend`:

```
npm install
npx tsc --noEmit -p . && npx vitest run
NEXT_PUBLIC_API_BASE=http://localhost:8000 npx next build && npx next start
```

`next build` needs Google Fonts. In a sandbox without network set `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` to a JS file (kept outside the repository) that exports the Google Fonts CSS answers for the three font URLs of `src/app/layout.tsx`. Use a separate `NEXT_DIST` and port for each build, and never use `pkill -f` with a pattern that is in your own command line.

The viewer route is `/projects/{id}/viewer`. It needs the `jce_terms` cookie. The demo page `/viewer-demo` needs no server.

## 8. Environment variables

AI first design and the assistant (`docs/21`, section 5):

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Without it the rules decide and no model call is made |
| `JCESITE_AI_MODEL` | `claude-haiku-5-5` | Model for first design and the assistant |
| `JCESITE_AI_PRICE_IN_PER_MTOK_USD`, `JCESITE_AI_PRICE_OUT_PER_MTOK_USD` | 0.1 and 0.5 | PLACEHOLDER prices for the estimate and the caps |
| `JCESITE_AI_MAX_OUTPUT_TOKENS`, `JCESITE_AI_TIMEOUT_S`, `JCESITE_AI_MAX_TURNS` | 1500, 30, 3 | Bounds of one call and one round |
| `JCESITE_AI_DAILY_CAP_USD`, `JCESITE_AI_MONTHLY_CAP_USD` | 5, 50 | Spending caps |
| `JCESITE_AI_RATE_PER_MIN`, `JCESITE_AI_RATE_PER_DAY` | 6, 150 | Per project rate limits |
| `JCESITE_AI_GLOBAL_RATE_PER_MIN`, `JCESITE_AI_GLOBAL_RATE_PER_DAY` | 20, 1000 | All projects |
| `JCESITE_AI_CONFIRM_USD` | 0.01 | Worst case cost above which the user must confirm |

BYDA (`docs/19`, section 8):

| Variable | Meaning |
|---|---|
| `BYDA_CLIENT_ID`, `BYDA_CLIENT_SECRET` | Credentials held by the owner. Without them lodging answers BYDA_NOT_CONFIGURED. |
| `BYDA_BASE_URL` | Default `https://smarterwx.byda.com.au` |
| `BYDA_MODE` | `sandbox` (default) or `commercial` |
| `BYDA_ALLOW_LIVE` | `true` lets sandbox mode make live calls. Default off. |
| `BYDA_WEBHOOK_SECRET`, `BYDA_WEBHOOK_HMAC_HEADER` | Webhook protection. With no secret the webhook refuses every call. |
| `BYDA_RATE_MAX`, `BYDA_RATE_WINDOW_S`, `BYDA_TOKEN_FALLBACK_S` | 90, 900 and 60 by default |

Terrain, scene and files:

| Variable | Meaning |
|---|---|
| `JCESITE_LIDAR_TILE_DIR` | A local directory holding `index.json` and the hosted LiDAR tiles (cloud optimised GeoTIFF). Unset: the tile library is skipped and the run falls back to the labelled 5 m DEM. |
| `JCESITE_TERRAIN` | `auto` (default), `nsw` or `none`. Used when the node input names no mode. |
| `JCESITE_AERIAL` | `auto` (default) or `none`. |
| `JCESITE_OFFLINE_FIXTURE` | `lot2`: the scene is built from the saved offline fixture of Lot 2 DP227508. Never live data, and labelled so. Honoured ONLY when `JCESITE_ENV=test`; anywhere else it is ignored and a warning is logged. |
| `JCESITE_ENV` | `test` in test runs (the e2e harness, the unit tests). It switches on the offline fixture. Leave it unset in every real deployment. |
| `JCESITE_LGA_URL_NSW`, `JCESITE_LGA_URL_QLD` | Override the LGA layer endpoints. |
| `SCENE_BUNDLE_DIR` | Where scene bundles (and the site design, imports, stormwater files, first design ledger and building GLBs) are read and written, per project. Default the API `EXPORT_DIR`. One helper decides it (section 3). |
| `DATABASE_URL`, `UPLOAD_DIR`, `EXPORT_DIR`, `MAX_UPLOAD_BYTES`, `DEFAULT_TOKEN_BUDGET`, `DB_POOL_MAX` | API settings (`backend/app/api/settings.py`). |
| `NEXT_PUBLIC_API_BASE` | Frontend: the API base URL, fixed at build time. |
| `NEXT_PUBLIC_DEV_USER_ID` | Frontend: the user id sent as `X-User-Id` in development. |
| `NEXT_DIST` | Frontend: the build folder (use a unique one per build). |
| `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` | Build only: font stub for a sandbox without network. |

Embed hosts (Plan Studio, `docs/17`, section 8): `PS_EMBED_HOSTS` is read when Plan Studio is built and written into `<meta name="ps-embed-hosts">`. The Plan Studio server variable `EMBED_HOSTS` sends `Content-Security-Policy: frame-ancestors 'self' <hosts>` on every response. The host list is fixed at build time and is never read from the URL. A host serving the HTML itself must send the same header.

## 9. End to end browser test

Folder `cadastral-platform/e2e/`:

* `run.sh` runs everything: it starts the built frontend on port 3100 and a fresh backend harness on port 8765, runs the browser, stops both. It does not download a browser: Chromium comes from `PLAYWRIGHT_BROWSERS_PATH`.
* `harness.py` serves the real API with the offline Lot 2 scene bundle built by the real SA6 adapter.
* `run_e2e.mjs` drives Chromium (playwright core, software WebGL). Only 127.0.0.1 is reachable; every other host is aborted.
* `make_fixtures.py` writes the synthetic inputs into `e2e/fixtures/`.

Build the frontend once with `NEXT_DIST=.next-e2e NEXT_PUBLIC_API_BASE=http://127.0.0.1:8765` (and the font stub when offline), then run `e2e/run.sh`.

What is FAKED, and nothing else:

1. The database pool is a bare object. The three access dependencies (`site_design_access`, `scene_access`, `site_rules_dep`) are overridden, so there is no login, no terms acceptance and no project row. The browser sets the `jce_terms` cookie itself.
2. The council rules are `fake_rules()` from `backend/tests/ai_support.py`: SYNTHETIC values, not any council's rules.
3. The scene bundle is built from the offline Lot 2 fixture: synthetic terrain, no network, labelled OFFLINE FIXTURE.
4. The catalogue and placed items routes answer 401 (they need the database). The viewer carries on without a catalogue. Furniture and Place items are therefore not exercised.
5. There is no `ANTHROPIC_API_KEY`: AI first design runs in rules mode, and the test asserts zero model calls.
6. CORS is added to the app in the harness only, because the page and the API are on different ports. The production API has no CORS middleware.
7. The Plan Studio building is the SYNTHETIC fixture `planstudio_synthetic.planstudio.json` with a generated box GLB. The IFD table is a SYNTHETIC CSV and is not Bureau of Meteorology data.
8. The scene folder (`SCENE_BUNDLE_DIR`) and the API `EXPORT_DIR` are DIFFERENT folders in the run, so a route or an export that reads the wrong base finds no bundle. `JCESITE_ENV=test` is set in the harness because the offline fixture is honoured only then.

Steps and screenshots (`cadastral-platform/test-runs/e2e/`, about 3 MB with the two exports):

| File | Step |
|---|---|
| `01_load_scene_bundle.png` | Load the project scene bundle; status labels INDICATIVE 5 m DEM and LIDAR PENDING are on the page |
| `02_layer_groups.png` | Grouped layer toggles |
| `03_plan_view_north_arrow_scale.png` | Plan view with the north arrow and the scale bar |
| `04_open_design_tab_and_import_building.png` | Import the Plan Studio building and its GLB |
| `05_place_building.png` | Place it on the terrain |
| `06_set_ffl.png` | Set the finished floor level |
| `07_draw_driveway.png` | Draw a driveway from the kerb |
| `08_drag_crossover.png` | Drag the crossover 4 m along the kerb line |
| `09_add_tank.png`, `10_add_infiltration_trench.png` | Add a rainwater tank and an infiltration trench |
| `11_run_checks.png` | Run the checks |
| `12_stormwater_with_uploaded_ifd.png` | Upload the synthetic IFD table and run the stormwater analysis |
| `13_ai_first_design_rules_mode.png` | AI first design in rules mode |
| `14_accept_a_proposal.png` | Accept a proposal |
| `15_measure_distance_area_level.png` | Measure distance, level difference and area |
| `16_first_person_collision.png` | First person: the walker is stopped by the building and stands on the ground; the minimap is shown |
| `17_export_tab_glb.png`, `18_export_dxf.png` | Export GLB and DXF; the files are read back (GLB nodes named by object id, DXF layers on the JCS scheme, all text upper case, status labels present) |

`results.json` records the outcome of each step. The run exits with code 1 when a step fails.

## 10. Known limitations, consolidated

Items marked RESOLVED were closed in stage 11 and are kept so the history is clear.

Data and terrain (`docs/15`)

1. Live endpoints (LGA layers, terrain services) have not been called from the backend host; the build sandbox blocks them. A first live run is needed.
2. RESOLVED: the orchestrator and API now carry the terrain provenance and the aerial (section 3).
3. The tile library gives priority by tile footprint, not by valid cells. A newer tile that is all no data over the lot shuts out a valid older tile and the run falls back to the labelled 5 m DEM. It should fill cell by cell when real ELVIS tiles are loaded.
4. Offline fixture runs still show licence and datum rows quoted from the NSW service metadata although no service was called.
5. An LGA rule row without a state matches by name only. The loader must keep a state on every row. A state is inferred from an LGA code prefix when none is passed.
6. Gunnedah has cited OSD rules but no PSD value, so Gunnedah sites show 2 L/s stamped PLATFORM DEFAULT, LGA VALUE NOT FOUND.
7. The NSW imagery metadata states no licence. The sampled capture date was 2011. Verify before commercial use.

Editing core and buildings (`docs/16`, `docs/17`)

8. Objects sit on the terrain that first person walks on. Choosing existing ground for existing objects and the design surface for proposed ones was left for the grading stage.
9. The lot ring comes from the boundary line part of the scene bundle. Without one the outside lot check is not run and the panel says so.
10. The PUT lock is per process. Several API workers need a file or database lock.
11. A rejected AI proposal is hidden in the model but kept in the list. There is no toggle to show rejected proposals.
12. Labels are world sized sprites. In first person near a label they can fill the screen (visible in `16_first_person_collision.png`).
13. GLB bytes are not stored in the design document (5 MB cap). RESOLVED for export: the GLB is stored beside the project through `PUT exports/building-glb`. After a page reload the properties panel still asks for the file again until it is sent.
14. Drawing and importing need the server. On the demo page the import box is disabled.
15. A rotated house vectorises to many vertices at 0.05 m. Courtyards cannot be represented and are reported, not kept.
16. Roof height and pitch are not in a Plan Studio file, so the overall height stays NOT SET until entered.
17. The embed transport (`ps:get-project`) is built and tested in Plan Studio, but no host page calls it. The file picker is the working path.
18. Three Plan Studio premium UI tests (of 44) fail in this environment before and after the changes (browser driven).

Site objects, services and stormwater (`docs/18`, `docs/19`, `docs/20`)

19. The BYDA endpoint names and field names are UNCONFIRMED (section 11). No live call has been made.
20. The enquiry rate limiter is in memory per process.
21. The plan underlay and its calibration are not saved with the design. A browser loaded image is not uploaded. Upload a plan as a DBYD plan (PDF, DWF or DXF) to keep it on the server.
22. A DWF or DXF plan is not read or rendered. Export a page image and use the Trace service tool. The plan parser reads vector PDFs by the colours of the SA4 parser; a scan returns a message to trace manually.
23. A route proposal is computed against the design as sent. If the design changes before the user presses Add, an id clash refuses the step and the proposal is run again.
24. The zone of influence is a common geometric line. The asset owner's guideline governs.
25. The rate and validity rules have no default. Until rows are loaded for an authority the related checks are NOT EVALUATED and name the key that is UNRESOLVED.
26. The live BoM request format is UNCONFIRMED and no live request is made. The IFD CSV layout is read tolerantly and is not confirmed against a live download.
27. The ARR Data Hub export is recorded, not used in the sizing (no losses or temporal patterns).
28. No pipe or pit hydraulics, no major or minor system design, no hydrograph routing. Overland flow does not apply batters, kerbs, pipes or building overflow and is not a flood study. Tc is never estimated; it must be supplied.
29. The driveway design level is not designed beyond the stations: no vertical curve, crossfall or verge design. The B85 scraping check is a vehicle template screening, not a council requirement.

AI first design (`docs/21`)

30. The checklist state is kept for the session. After a reload the objects keep their accepted, pending or rejected state but the proposal list, the reasons and the link edit markers are not stored.
31. Rejecting a proposal that others depend on leaves the references in place. The panel warns and the checks show the consequence.
32. A tank position marks the downpipe; its size is a required input. The driveway ends at the nearest point of the building footprint because no garage data exists.
33. The reason redaction removes digits only. A number written in words would not be detected. The reason is text beside the proposal and is never used as data.
34. It is not confirmed that the default model accepts reasoning or effort settings. The client sends neither.
35. The estimate for stage 2 uses the sets built on the working design chosen by the rules; if the model chooses differently in stage 1 the stage 2 sets can differ from the estimate. The worst case cost is bounded.
36. RESOLVED: the design assistant could label a value derived (stage 10 limitation 9). See section 6.
37. The candidates are not an optimisation. They are a small, explainable set of alternatives.

Stage 11

38. The DXF export is a plan view of the design objects. It does not replace the plan set.
39. The e2e run fakes the database, the council rules and the catalogue (section 9). Place items, the catalogue and the database backed routes are not covered by it.
40. In the e2e run software WebGL runs at a few frames per second, so the walk test compares distances in equal times rather than asserting speeds.
41. The Plan view button stays highlighted while first person is on. The camera is the walker's.

Review fixes after stage 11 (section 13)

42. AI first design computes from the SAVED design. The page saves first; when it cannot save (conflict, error) it does not ask and says why. A client that sends a design that is not the saved one gets 409 `DESIGN_NOT_SAVED`.
43. A first design result backs a derived value only while the objects the engine read are unchanged in the design being saved. Editing any of them before the first save of the batch means running AI first design again. A value already saved stays saveable.
44. The export time cap is cooperative: a build stops at its next check (per object, per bundle part, per buffer). One long numpy call is not interrupted, and the thread of a build that timed out may run until its next check.
45. The rebuild lease expires after 20 minutes. A crashed worker blocks rebuilds of that one project for up to that long.
46. There is no project deletion in the platform. When one is added it must remove the project folder, or call `building_store.prune(folder, set())`, so the stored building GLBs go with it.
47. DXF R2000 and R12 hold a code page, not UTF-8. An accent is stored correctly; a letter outside the code page is written as `\U+XXXX`. R2010 is the default for this reason.
48. A GLB building model is merged without its extensions, skins, sparse accessors and external buffers; one that needs them is skipped with the note `BUILDING MODEL SKIPPED, INVALID` and the building is drawn as a block.

## 11. Open decisions for the owner

1. Council rules database. The rules table holds the platform default profile (OSD, 2 L/s) and the Gunnedah JSON. Every other council needs rows loaded from its own cited documents. Until then checks for those councils read UNRESOLVED or PLATFORM DEFAULT. Decide the sources, who loads them and how they are reviewed.
2. ELVIS LiDAR tiles. NSW has no automatic 1 m service. Is a hosted tile library from manual ELVIS orders acceptable, and for which areas first? Tiles are converted to cloud optimised GeoTIFF and set in `JCESITE_LIDAR_TILE_DIR`. The QLD terrain licence (CC BY SA) needs a decision on its effect on outputs.
3. BYDA. The endpoint names and fields are UNCONFIRMED (the specification pages were blocked: `help.byda.com.au/article/api-integration/`, `/api-spec/enquiries`, `/api-spec/system`). Only the token exchange is CONFIRMED. All paths and field names are in `backend/app/integrations/byda/mapping.py` and must be checked against the specification before any live call. Also open: the existing BYDA membership and key, whether plan files can be fetched through the API, and written consent from BYDA and the asset owners before any shared digitised dataset.
4. BoM IFD. The live request format is UNCONFIRMED. Until it is confirmed the user uploads the IFD CSV from the Bureau's 2016 IFD page, and the parser records its assumptions. A confirmed format would let a client be injected through the `live_ifd_client` dependency.
5. Price placeholders. `JCESITE_AI_PRICE_IN_PER_MTOK_USD` and `JCESITE_AI_PRICE_OUT_PER_MTOK_USD` are placeholders. Set them to the current published prices. Confirm the caps and the confirm level.
6. First live run. Call the LGA and terrain endpoints once from a machine or server that can reach them, and record the result.
7. The orchestrator database. Several routes (scene rebuild, catalogue, items) need a Postgres with the schema loaded. The e2e harness does not cover them.
8. Plan Studio embed. Decide whether a host page will call `ps:get-project`, and set `PS_EMBED_HOSTS` and `EMBED_HOSTS` accordingly.

## 12. Test baselines

From `cadastral-platform/backend`: `python3 -m pytest -q -p no:cacheprovider`.

| Date | Result |
|---|---|
| Before stage 11 | 1417 passed, 3 failed (known, `tests/test_soee_site.py`), 46 skipped |
| After stage 11 | 1446 passed, the same 3 known failures in `tests/test_soee_site.py`, 46 skipped |
| After the stage 11 review fixes | 1471 passed, the same 3 known failures, 46 skipped |

From `cadastral-platform/frontend`: `npx tsc --noEmit -p . && npx vitest run`.

| Date | Result |
|---|---|
| Before stage 11 | 497 passed |
| After stage 11 | 523 passed |
| After the stage 11 review fixes | 527 passed |

End to end: `e2e/run.sh`, 18 of 18 steps passed on 15/10/2026, and again after the review fixes (section 9).

The three known failures in `tests/test_soee_site.py` are unrelated to the 3D site tool and were failing before stage 11.

## 13. Review fixes after stage 11

Twelve findings of the stage 11 review, each with a test that fails on the earlier code (`backend/tests/test_stage11_review.py`, `test_derived_ledger.py`, `frontend/tests/viewer/stage11_review.test.ts`, `frontend/tests/site/first_design.test.ts`).

| # | Finding | Fix |
|---|---|---|
| 1 | CSV formula injection (blocker) | A text cell that starts with `=`, `+`, `-`, `@`, tab or carriage return gets a leading apostrophe in every CSV (section 4). |
| 2 | Building GLB trusted | Validated at PUT (422 `INVALID_GLB`), merged into scratch lists and committed only on success, a bad stored model is skipped with `BUILDING MODEL SKIPPED, INVALID` (section 4). |
| 3 | Export builds on the event loop, unbounded | Pool and per project gate, 60 s cap (504), running 120 MB total checked before each buffer (413) (section 4). |
| 4 | Two base folders | One helper, `app/common/bundle_dir.py` (section 3). |
| 5 | SA6 cached, parallel rebuilds | SA6 `cacheable=False`, one rebuild per project (409 `REBUILD_ACTIVE`) (section 3). |
| 6 | Derived ledger forgeable | Computed from the saved design, records tied to the saved version and the inputs, run rate limit (section 6). |
| 7 | DXF text encoding | R2010 default (UTF-8), R2000 and R12 encoded for their code page (section 4). |
| 8 | DXF label without a position | Skipped, counted in the title note. |
| 9 | JSON schedule `null` against CSV `NOT SET` | `NOT SET` in both, with `basis`. |
| 10 | Stored building GLBs never deleted | Removed when the building leaves the saved design (section 4). |
| 11 | First person colliders | A building box uses its `height_m`, the display constant only when it is NOT SET (the box carries the note `HEIGHT NOT SET, COLLISION HEIGHT IS A DISPLAY CONSTANT OF THE WALK`); a rectangular tank box spans from 1.0 m under the base to the top of the tank. |
| 12 | Offline fixture in production | Honoured only with `JCESITE_ENV=test` (section 8). |

Changes that other code must know about: the DXF default version is R2010 (the Export tab offers R2010, R2000 and R12); AI first design needs the saved design (the page saves first); the unit tests that post to the first design route use `ai_support.SavingClient`, which saves the design in the body first as the page does; a test that builds the offline scene sets `JCESITE_ENV=test`.
