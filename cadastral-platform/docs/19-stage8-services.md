# 19. Stage 8: DBYD services in the model, and the sewer and water tools

Date: 15/10/2026. Status: STAGE 8 COMPLETE, AWAITING OWNER REVIEW. Local commit only; nothing is pushed.

## 1. Rules this stage follows

1. No data is invented. A depth, size, owner, tolerance, expiry date, clearance, cover, grade or zone of influence is one of: a value the user entered (basis USER), a value from the requirement resolver (LGA RULE), or NOT SET or UNRESOLVED. Where a value is missing the answer is DATA NOT AVAILABLE or NOT SET, and a check that needs it is NOT EVALUATED and names the missing key.
2. Clearances, minimum cover, minimum grades, maximum depths, inspection opening limits and the zone of influence come only from requirement keys. None has a default. The JCE drainage conventions are not used.
3. The BYDA credentials (client id and client secret) exist only in the server environment. They are never in code, logs, responses or error messages.
4. Plans, enquiries and traced services are private to the project. Nothing is shared across projects or users.
5. Current use of the BYDA connection is a SANDBOX. The owner expects to give consent before any commercial use. Set `BYDA_MODE=commercial` only after that consent. In sandbox mode no call leaves the server unless `BYDA_ALLOW_LIVE=true` (section 8.3).
6. The server is authoritative for checks and route proposals. The browser collects the inputs, shows the answer and applies it through its operation registry (one undo step).
7. User facing strings contain no em or en dash. Labels are upper case. Dates are shown as DD/MM/YYYY and stored as ISO dates.
8. Nothing is sent to anyone on the user's behalf. A real BYDA enquiry is lodged only when the user ticks the confirmation and presses Lodge.

## 2. What was built

| Item | Where |
|---|---|
| Four object types, enumerations, verification rule | `backend/app/design/site_design.py`, `frontend/src/lib/site/types.ts`, `ops.ts` |
| Requirement key table and help text (12 new keys) | `backend/app/design/object_keys.py`, `backend/app/agents/requirements/models.py` (`SERVICE_KEY_HELP`) |
| Rule lookup with selectors (service, diameter, asset owner) | `backend/app/design/site_rules.py` (`get_for`) |
| Existing service model, plan expiry, exclusion buffer | `backend/app/design/service_model.py` |
| Sewer geometry: stations, inverts, cover, location class, inspection openings, route around objects | `backend/app/design/sewer_engine.py` |
| Stage 8 checks and clash checks | `backend/app/design/service_checks.py`, called from `object_checks.py` |
| Route proposals | `backend/app/design/service_route.py`, routes in `backend/app/api/site_design.py` |
| BYDA client package | `backend/app/integrations/byda/` |
| DBYD routes | `backend/app/api/dbyd.py` |
| Operations `set_service_verified`, `add_service_objects` | `frontend/src/lib/site/ops.ts` |
| Labels, colours, dashes, expiry wording | `frontend/src/lib/site/services.ts` |
| Plan underlay and two point calibration | `frontend/src/lib/site/underlay.ts`, `siteScene.ts`, `designController.ts` |
| Form handling | `frontend/src/lib/site/serviceForm.ts` |
| API clients | `frontend/src/lib/site/dbydApi.ts`, `engineApi.ts` |
| Design tab sections | `components/viewer/ServiceTools.tsx` (Trace service, verification), `RouteTools.tsx` (Sewer tool, Water tool), `DbydTools.tsx` (DBYD services) |
| Tests | `backend/tests/test_stage8_services.py`, `test_byda_stage8.py`; `frontend/tests/site/stage8_services.test.ts`, `stage8_panels.test.ts` |

## 3. Object types

Twenty two object types now exist (the four below are new).

| Type | Geometry | Parameters |
|---|---|---|
| `service_existing` | polyline, or point (pit, valve, pole) | `service_kind` (water, sewer, stormwater, gas, electricity, telecommunications, other), `asset_owner`, `dbyd_job_number`, `plan_reference`, `plan_date`, `plan_expiry_date`, `source_file`, `diameter_mm`, `material`, `depth_m`, `depth_basis` (plan indicated, potholed, surveyed, unknown), `depth_reference` (top of the asset or invert), `position_tolerance_m`, `verified_by`. The object carries `verified` and `verified_on`. |
| `sewer_drain` | polyline | `diameter_mm`, `upstream_invert_rl`, `downstream_invert_rl`, `building_id` |
| `service_node` | point | `node_kind` (inspection opening, inspection pit, sewer connection, water connection, water meter), `invert_rl`, `main_id` |
| `water_service` | polyline | `diameter_mm`, `cover_m`, `main_id`, `rwt_id` |

Every parameter starts NOT SET. A platform default is refused on all four types (the stage 7 rule). An optional `footing_depth_m` (metres below ground, entered by the user) is accepted on building, retaining wall, rainwater tank, OSD, OSD basin, pool and tree, and is used only by the zone of influence check.

Depth has two parts. The basis says how far the depth can be trusted. The reference says what the depth is measured to (top of the asset or invert). The top and the bottom of an asset differ by its nominal diameter (wall thickness is not modelled). A depth without a reference is not used for a vertical check.

### 3.1 Verification, expiry and display

* An existing service is UNVERIFIED until the user verifies it. A verified service needs `verified_by` and `verified_on` (the model refuses a verified service without them). Verification is the user's statement; it is never set automatically.
* An unverified service is drawn as a dashed line and labelled UNVERIFIED, INDICATIVE ONLY. A verified service is drawn solid and labelled VERIFIED with its date.
* A plan whose expiry date has passed is labelled PLAN EXPIRED. The expiry date is the one entered with the plan. When none is entered, the server works it out as the plan date plus `dbyd.plan_validity_days`; when that key is UNRESOLVED the check says so. The browser never works out an expiry date.
* Editing a verified service voids the verification. A change to its geometry (edit vertices, move, rotate, including a point's yaw), or to `depth_m`, `depth_reference`, `asset_owner`, `service_kind`, `diameter_mm` or `material`, clears `verified`, `verified_on` and `verified_by` and adds the issue VERIFICATION CLEARED BY EDIT (it stays until the service is verified again). `verified_by` cannot be edited while the service is verified. The server applies the same rule on every save of the design by comparing with the stored version (`service_model.enforce_verification`); an attempt to change `verified_by` of a service that stays verified is refused with VERIFIED_BY_LOCKED. Rotating always clears, because a rotation moves the geometry.
* "Today" for the plan expiry check is the date in Australia/Sydney, on the server (`zoneinfo`) and in the browser (`Intl.DateTimeFormat` with that time zone), so both agree around midnight.
* The exclusion buffer of a service is the clearance from `util.clearance_m` (read with the service kind, diameter and asset owner) plus the stated positional tolerance. If the kind, owner, clearance rule or tolerance is missing the buffer is shown UNRESOLVED.
* Colour follows the service kind (a display convention). A stated tolerance is drawn as a faint band either side of the line.

## 4. Requirement keys

All keys are registered with help text. None has a default. Unless a rule row exists for the authority, the key is UNRESOLVED and the checks that need it are NOT EVALUATED.

New in stage 8:

| Key | Unit | Kind | Used by |
|---|---|---|---|
| `sewer.min_cover_m.open_ground` | m | number | DRAIN_COVER under open ground |
| `sewer.min_cover_m.footpath` | m | number | DRAIN_COVER under a footpath or paved area |
| `sewer.min_cover_m.driveway` | m | number | DRAIN_COVER under a driveway or trafficable area |
| `sewer.max_connection_depth_m` | m | number | DRAIN_CONNECTION_DEPTH |
| `sewer.min_clearance_to_building_m` | m | number | DRAIN_BUILDING_CLEARANCE |
| `sewer.inspection_opening_max_spacing_m` | m | number | DRAIN_INSPECTION, and where the route places openings |
| `sewer.inspection_opening_max_deflection_deg` | deg | number | DRAIN_INSPECTION, and where the route places openings |
| `sewer.zone_of_influence.angle_deg` | deg | number | ZONE_OF_INFLUENCE (angle from horizontal) |
| `sewer.zone_of_influence.offset_m` | m | number | ZONE_OF_INFLUENCE (offset from the centreline at the invert) |
| `util.min_vertical_clearance_m` | m | number | CLASH_CROSSING |
| `rwt.mains_backup_required` | true or false | bool | RWT_MAINS_BACKUP |
| `dbyd.plan_validity_days` | days | number | SVC_PLAN_EXPIRY |

Existing keys that stage 8 reads with selectors:

| Key | Selectors | Used by |
|---|---|---|
| `util.clearance_m` | service kind, diameter, asset owner (as authority) | SVC_EXCLUSION, CLASH_HORIZONTAL |
| `util.build_over_allowed` (now declared true or false, with help text) | service kind, asset owner | CLASH_OBJECT |
| `sewer.min_grade_pct` | diameter | DRAIN_GRADE, and the grade of a proposal when the user gives none |
| `water.min_cover_m` | diameter | WATER_COVER |

An existing service is always read with its asset owner. A service with no owner has an UNRESOLVED clearance; no other authority is used in its place.

## 5. Checks

All checks are part of `POST /projects/{id}/site-design/check` and appear in the Checks list with their requirement keys.

| Code | What it checks |
|---|---|
| SVC_VERIFIED | The service is verified; otherwise UNVERIFIED, INDICATIVE ONLY |
| SVC_PLAN_EXPIRY | PLAN EXPIRED, or NOT EVALUATED when no plan date, expiry date or validity rule exists |
| SVC_DEPTH | The depth, its basis and its reference are set; otherwise DATA NOT AVAILABLE |
| SVC_EXCLUSION | The exclusion buffer resolves (`util.clearance_m` plus tolerance) |
| DRAIN_GRADE | Grade from the inverts and plan length against `sewer.min_grade_pct` for the diameter |
| DRAIN_COVER | Cover to the crown (terrain minus invert minus nominal diameter) at stations every 1 m, ends and vertices, against the key for the location (open ground, footpath, driveway) |
| DRAIN_CONNECTION_DEPTH | Depth of the invert at the connection against `sewer.max_connection_depth_m` |
| DRAIN_ENDS | The ends meet a building sewer exit, a node, another drain or a main (0.05 m drawing tolerance) |
| DRAIN_BUILDING_CLEARANCE | Horizontal clearance to buildings against `sewer.min_clearance_to_building_m` |
| DRAIN_INSPECTION | An inspection opening or pit where a change of direction or the spacing exceeds the two rules |
| NODE_CONNECTION | A connection node lies on a service of the right kind in the model (within 0.05 m) and that service is verified; a point entered by the user is flagged NOT VERIFIED |
| WATER_COVER, WATER_SIZE, WATER_MAIN, WATER_METER | Cover against `water.min_cover_m`; size set; the connection is tied to a service in the model (otherwise NOT VERIFIED); the meter position |
| WATER_RWT_LINK, RWT_MAINS_BACKUP | The link to a rainwater tank with reuse; the mains backup rule |
| ZONE_OF_INFLUENCE | Footings of objects against the zone of a sewer main (section 5.1) |
| CLASH_HORIZONTAL | Horizontal separation of non crossing services against `util.clearance_m` |
| CLASH_CROSSING | Vertical gap at a crossing against `util.min_vertical_clearance_m`; NOT EVALUATED where a depth is unknown |
| CLASH_OBJECT, CLASH_OBJECT_DEPTH | Services against objects (buildings, tanks, walls, pools, trees and others), including `util.build_over_allowed` |

### 5.1 Zone of influence

The footing of an object at depth F (the user's `footing_depth_m`) is inside the zone of a sewer main whose invert is at depth P when its plan distance to the sewer is less than

    half width = offset + (P - F) / tan(angle)

where `offset` is `sewer.zone_of_influence.offset_m` and `angle` is `sewer.zone_of_influence.angle_deg`. When F is at or below the invert (F >= P) the half width is the offset alone. The positional tolerance of the existing sewer is added. The check is NOT EVALUATED when the footing depth, the sewer depth or either key is missing, and a PASS is withheld while the sewer's tolerance is not set. This is a common line from the invert out and up at an angle; the asset owner's own guideline governs and is not replaced by this check.

### 5.2 Clash checks

Two lines that cross in plan are checked vertically at the crossing (gap between the underside of the upper asset and the top of the lower asset). Lines that do not cross are checked horizontally by the shortest plan distance. Where either depth is unknown the vertical check is NOT EVALUATED and says which depth is missing.

A crossing is counted only when the two lines meet in each other's interiors. An end to end touch between consecutive links of one drain, and the touch between a drain end and the main it connects to (same service kind, an end within 0.05 m of the other line), are connections, not crossings and not clearance clashes. The zone of influence check skips the drain's own linked building (`building_id`), as the clash and clearance checks do.

Two proposed lines whose clearance rule does not resolve (`util.clearance_m` for the service kinds and diameters) are NOT EVALUATED, naming the missing keys; they are never skipped silently.

Known limitation: a proposed line that both runs beside and crosses an existing service is judged at the crossing only.

## 6. Sewer tool and Water tool

Both are sections of the Design tab. The server proposes; the page shows the label PROPOSAL, the route, the checks and any notes, and the user adds the objects to the design (one undo step) or discards them. The route is a proposal to adjust, not the only or the best route.

### 6.1 Sewer tool

* Start: a sewer exit of an imported (stage 5) building.
* End: a connection point. Either an existing sewer service in the design, or a point the user enters, labelled NOT VERIFIED.
* Inputs the user must enter: start invert (m RL) and diameter. Grade is the user's entry, or the minimum grade rule for the diameter when left empty; with neither, the inverts stay unset.
* The route is the shortest plan path around the footprints of the placed objects (a visibility graph over their corners). Inspection openings are placed only where the two inspection rules require them; if a rule is UNRESOLVED none is placed and the answer says so.
* The invert at the connection comes from the user's entry, or from the depth of a main when its depth, basis and reference are set. Otherwise the arrival is NOT EVALUATED.
* Output: ready to apply `sewer_drain` links and `service_node` objects, the cover profile (invert, crown, terrain and cover per station), and every check for the new objects.

### 6.2 Water tool

* Inputs the user enters: the main connection (an existing service, or a point labelled NOT VERIFIED), the meter position, the size and the cover.
* Output: a `water_service` polyline from the main through the meter to the building water exit, a connection node and a meter node, with the checks. A rainwater tank with reuse can be linked, which adds the mains backup check (`rwt.mains_backup_required`).

### 6.3 Limits

A route proposal goes around at most 400 objects and the straight line distance from start to end is at most 300 m (`ROUTE_INPUT_TOO_LARGE`). A whole design check accepts at most 20 000 service vertices and 250 000 service and object pairs (`CHECK_TOO_LARGE`). These are sanity limits, not engineering values.

## 7. Trace service tool

For a plan that cannot be read automatically (a scan, an image, a DWF or DXF), the user traces the services by hand.

1. Load a plan page: a PNG or JPEG image (kept in the browser, up to 25 MB and 8000 pixels a side), or one page of an uploaded PDF plan (rendered to a PNG by the server).
2. Calibrate with two points: click two points on the plan image, and give the two model points they stand for (typed, picked in the model, or snapped to two lot boundary corners). The plan is then scaled, rotated and moved (no shear, no mirror) and shown draped on the terrain. The scale (metres per pixel) and rotation are shown. Points that are too close together are refused. Opacity is adjustable.
3. Enter the service details (only what the plan states; an empty field stays NOT SET) and draw the service line, or place a service point, using the stage 4 drawing tool with its snaps.

The underlay is a tracing aid for the session. It is not saved with the design. Every traced service is UNVERIFIED, INDICATIVE ONLY.

## 8. DBYD routes

| Route | Purpose |
|---|---|
| `POST /projects/{id}/dbyd/enquiry` | Lodge an enquiry for the lot plus a margin. Needs `confirm` true and `margin_m` (no default). The lot is converted from MGA to WGS84 using the SRID of the scene bundle. In sandbox mode it answers 403 BYDA_LIVE_OFF unless `BYDA_ALLOW_LIVE=true`. A PENDING record with a client reference is written before the call (section 8.4). |
| `POST /projects/{id}/dbyd/enquiries/{client_ref}/resolve` | The user records what the BYDA portal shows for a lodgement whose outcome is unknown: `outcome` `lodged` (with the job number) or `not_lodged`. Nothing is sent to BYDA. |
| `GET /projects/{id}/dbyd/enquiries` | The project's enquiries, with `mode`, `live_calls` and `unresolved_lodgement`; `?refresh=true` asks BYDA for the latest status (all pages, at most 20), only when live calls are on. |
| `POST /projects/{id}/dbyd/plans` | Private upload of a PDF, DWF or DXF plan: 25 MB (enforced while the body streams, so an oversize upload is cut off with 413 before it is held in memory), 100 plans a project, content type and first bytes checked, name sanitised. |
| `GET /projects/{id}/dbyd/plans` | The uploaded plans. |
| `GET /projects/{id}/dbyd/plans/{plan}/page` | One PDF page as a PNG for the underlay. Rendering has a 15 second limit (422 PDF_TIMEOUT). |
| `POST /projects/{id}/dbyd/plans/{plan}/parse` | Read a vector PDF with the SA4 parser and return draft `service_existing` objects (origin dbyd, verified false). A scan, DWF or DXF returns a message to trace it manually with the Trace service tool. Parsing has a 15 second limit (422 PDF_TIMEOUT); both PDF jobs run in a separate process that is killed on timeout. Nothing is saved; the page adds the drafts. |
| `POST /integrations/byda/webhook/{project_id}` | BYDA webhook. Header `X-JCE-Webhook-Secret` must equal `BYDA_WEBHOOK_SECRET` (constant time compare). `X-JCE-Webhook-Timestamp` (epoch seconds or ISO 8601 with a zone) must be within 5 minutes of the server clock, and `X-JCE-Webhook-Delivery-Id` is required; a repeated delivery id is refused with 409 WEBHOOK_REPLAY (recent ids are stored for an hour). An optional HMAC SHA256 header is checked when `BYDA_WEBHOOK_HMAC_HEADER` names it; it signs `<timestamp>.<delivery id>.<body>` so the replay headers cannot be altered. Events are accepted only for a project that has lodged an enquiry. |

Drafts carry only what the plan or the request states. No owner, tolerance, expiry date or depth reference is invented; a plan depth is recorded with basis plan indicated and its reference stays NOT SET until the user chooses it.

Enquiries are limited to 90 per user in 15 minutes (the figure the owner stated; configurable). The limiter is held in the memory of one server process; with more than one process the limit applies to each process separately.

### 8.1 Environment variables

| Variable | Meaning |
|---|---|
| `BYDA_CLIENT_ID`, `BYDA_CLIENT_SECRET` | Credentials. Held by the owner. Required to lodge an enquiry; without them the route answers BYDA_NOT_CONFIGURED. |
| `BYDA_BASE_URL` | Default `https://smarterwx.byda.com.au` |
| `BYDA_MODE` | `sandbox` (default) or `commercial` |
| `BYDA_ALLOW_LIVE` | `true` lets sandbox mode make live calls. Default `false`: lodging is refused (BYDA_LIVE_OFF) and list or refresh read only the stored records. Commercial mode is always live. |
| `BYDA_WEBHOOK_SECRET`, `BYDA_WEBHOOK_HMAC_HEADER` | Webhook protection. With no secret the webhook refuses every call. |
| `BYDA_RATE_MAX`, `BYDA_RATE_WINDOW_S` | Defaults 90 and 900 |
| `BYDA_TOKEN_FALLBACK_S` | Token lifetime assumed when the token response states none. Default 60. A 401 always forces a new token. |

### 8.2 Confirmed and UNCONFIRMED BYDA items

The BYDA documentation could not be read during this stage. These pages were blocked and were not retried:

* https://help.byda.com.au/article/api-integration/
* https://help.byda.com.au/api-spec/enquiries
* https://help.byda.com.au/api-spec/system

Everything except the token exchange therefore comes from the best reading of the endpoint family and MUST be checked against the specification before use against the live service. The client treats an unexpected response as an error (BYDA_UNEXPECTED_RESPONSE), never as data. All paths and field names are in one file, `backend/app/integrations/byda/mapping.py`.

| Item | Status |
|---|---|
| Token: `POST https://smarterwx.byda.com.au/api/community/auth/tokens`, body `{clientId, clientSecret}`, response field `access_token`, sent as a Bearer token | CONFIRMED (owner, 15/10/2026) |
| Token lifetime field (`expires_in`, seconds) | UNCONFIRMED; the fallback lifetime applies when it is absent |
| Lodge enquiry `POST /api/community/enquiries`, body field names (`geometry` GeoJSON polygon, `workDescription`, `startDate`, `endDate`) | UNCONFIRMED |
| List enquiries `GET /api/community/enquiries`, list envelope names | UNCONFIRMED |
| Get enquiry `GET /api/community/enquiries/{id}` | UNCONFIRMED |
| List responses `GET /api/community/enquiries/{id}/responses` | UNCONFIRMED |
| Download response file `GET .../responses/{response_id}/files/{file_id}` | UNCONFIRMED |
| Enquiry, response and file field names (id, job number, status, dates, owner, files) | UNCONFIRMED |
| Webhook payload shape, signature scheme and event names | UNCONFIRMED; the shared secret header is this service's own scheme |
| The rate limit of 90 in 15 minutes | Stated by the owner; not checked against BYDA |

The list paging fields (`page` and `cursor` parameters, `next` and `nextCursor` envelope names, `totalPages`) are UNCONFIRMED and are set in `mapping.py`; `list_enquiries` follows them for at most 20 pages and stops on an empty or repeated page. The field that would carry our client reference to BYDA (`CLIENT_REFERENCE_FIELD`) is UNCONFIRMED and unset, so the reference is kept only in our record.

Calls to byda.com.au were blocked in the build sandbox, so every BYDA call goes through an injectable client and the tests use fakes. No live call has been made.

### 8.3 Sandbox and live calls

`BYDA_MODE=sandbox` does not by itself keep the server from calling BYDA, so a second switch exists. With `BYDA_ALLOW_LIVE` unset or not `true`, sandbox mode makes no call at all: the real transport raises BYDA_LIVE_OFF (token and API calls), the lodge route refuses with a clear message, and list or refresh return the stored records with the same message. The panel states the mode and whether live calls are on (a commercial connection is no longer described as a sandbox).

### 8.4 Lodgement records and unknown outcomes

* Before the call, a record with a client reference is written with `lodge_state` pending. A second lodgement is refused (409 LODGEMENT_IN_PROGRESS) while one is pending; a pending record older than 2 minutes becomes unknown.
* A definite failure (a 4xx answer, a refused redirect, a rate limit) marks the record failed.
* An ambiguous outcome (a timeout or connection loss after the request was sent, a 5xx answer, or a 2xx answer with no enquiry id) keeps the record marked LODGEMENT OUTCOME UNKNOWN, CHECK BYDA PORTAL and answers 502 LODGEMENT_OUTCOME_UNKNOWN. No automatic re-lodge is made for that project (409 LODGEMENT_OUTCOME_UNKNOWN) until the user records the portal's answer with the resolve route; the panel shows buttons for it.
* Authenticated requests never follow a redirect: a 3xx answer is an error (BYDA_REDIRECT_REFUSED), so the bearer token cannot be sent to another host.

### 8.5 Stores

The project's JSON stores (enquiries, events, webhook delivery ids, the site design file) are written atomically (temporary file, fsync, rename) under a per file lock that holds across processes (`fcntl` lock file next to the data file), so two writers cannot lose each other's update or leave a torn file.

### 8.6 Parameter bases added

* `plan_indicated` (PLAN INDICATED): a value read from a DBYD plan (service kind, diameter, material, depth, depth basis, source file). It is accepted by checks only where the check allows plan indicated values, is shown as such, and is refused by `set_param`.
* `derived` (DERIVED): a proposal's inverts computed from a rule grade, with `ref` the requirement key (for example `sewer.min_grade_pct`). A user entered grade keeps `user`. The first upstream invert is the user's own and stays `user`.

Both are in the closed basis list of the Pydantic model, the TypeScript types and the parameter reader, and the golden file covers them.

## 9. Operations (frontend)

* `add_object` accepts the four new types (`service_existing` also as a point).
* `set_service_verified` marks a service verified by a named person on a date (YYYY-MM-DD), or removes the verification. `verified_by` cannot be edited while the service is verified, and verifying an already verified service is refused. Move, rotate, vertex edits and the parameters listed in section 3.1 clear the verification.
* `add_service_objects` adds the objects of a route proposal or the drafts read from a DBYD plan in one undo step. It accepts only the four stage 8 types, origin user or dbyd, unused ids, and always adds them unverified.
* Neither new operation is offered to the AI.

## 10. Test results

| Suite | Result |
|---|---|
| Backend (`python3 -m pytest -q -p no:cacheprovider` in `cadastral-platform/backend`) | 1231 passed, 46 skipped, 3 known failures in `tests/test_soee_site.py` (before the review fixes: 1187 passed; the review fixes add `test_stage8_review_fixes.py` with 16 tests and `test_byda_review_fixes.py` with 28) |
| Frontend (`npx tsc --noEmit -p . && npx vitest run` in `cadastral-platform/frontend`) | 431 passed (before the review fixes: 419; `stage8_review_fixes.test.ts` adds 12) |

The golden file `backend/tests/fixtures/site_design_v1_frontend.json` was regenerated by the frontend test (`UPDATE_SITE_FIXTURE=1`) and now covers all twenty two types, a verified service and DBYD drafts. The backend validates it with the Pydantic model.

`frontend/vitest.config.ts` now sets the esbuild JSX runtime to automatic so the panel markup tests can render the components.

## 11. Limitations and open items

1. The BYDA endpoint names and field names are UNCONFIRMED (section 8.2). No live call was made.
2. The enquiry rate limiter is in memory per process.
3. The plan underlay and its calibration are not saved with the design. Reloading the page loses them; the traced services remain.
4. A browser loaded image is not uploaded. To keep a plan on the server, upload it as a DBYD plan (PDF, DWF or DXF).
5. A DWF or DXF plan is not read or rendered. Export a page image and use the Trace service tool.
6. The plan parser reads vector PDFs by the colours of the SA4 parser. A scan returns a message to trace manually.
7. A route proposal is computed against the design as sent. If the design changes before the user presses Add, an id clash refuses the step and the proposal is run again.
8. The zone of influence is a common geometric line; the asset owner's guideline governs.
9. The rate and validity rules have no default. Until rows are loaded for the authority, the related checks are NOT EVALUATED and say which key is UNRESOLVED.
