# 14. 3D site design tools: stage 1 report and proposal

Date: 14/10/2026. Revision B. Status: PROPOSAL FOR OWNER REVIEW. Nothing in this document has been built.

This document closes stage 1 of `docs/13-3d-site-handover.md`. It reports what can be reused from Plan Studio and from the existing JCESITE code, proposes the site design data contract, and sets out the stages for the expanded scope. Work stops here until the owner gives his go.

## Revision history

| Rev | Date | Change |
|---|---|---|
| A | 14/10/2026 | First issue for review. |
| B | 14/10/2026 | Owner decisions D1 to D5 recorded (section 9). Plan Studio source read and the reuse plan revised (sections 2.1 and 3). House import and placement added (section 6.1). Automatic LGA lookup and the rules database with a platform default profile added (section 7). LiDAR terrain for NSW and QLD added (section 8). JCE drainage conventions removed. Stages renumbered (section 12). Sections changed in this revision are marked REV B. |

## 1. Scope (owner instructions, 14/10/2026)

The 3D site model becomes a design tool, not only a viewer. The owner has asked for:

- Loading of DBYD services into the model.
- Placement of landscaping, retaining walls, rainwater tanks (RWT), infiltration trenches and on site detention (OSD).
- Water and sewer tools.
- The driveway as a drag tool.
- A smarter helper that sizes OSD on the fly, looks up infiltration rates for the area and shows overland flow.
- An AI first pass: the AI takes the site layout the client supplies, the contours and the services, produces a first design, and the end user then works through and adjusts it.
- REV B. The house is designed in Plan Studio, or imported from PDF or DXF, and is then brought into the site model and placed on the LiDAR terrain.
- REV B. The software finds the LGA for the site and pulls that LGA's rules from a database. NSW and QLD. The database is populated later; until then the design assumes OSD applies with a permissible site discharge of 2 L/s.

The standing rules in `docs/13` section 2 apply to all of it: no hard-coded requirement values, no invented data, assumed items labelled, the AI GENERATED DRAFT statement on every view and export, review at every stage. REV B: the `docs/13` rule "no dwelling, no building footprint, no finished floor level" is superseded. The house is still never designed in JCESITE, but a house designed elsewhere is imported and placed.

## 2. Findings

### 2.1 Plan Studio (REV B, read from source)

- Vanilla JavaScript modules with three.js 0.186.1, about 31,600 lines, with a Node test suite (6 files) and a single file esbuild build. No licence file; branded Glide Inside.
- **Model.** One project JSON, units mm, plan y pointing down the screen, rotations clockwise. Levels hold walls, openings, rooms, furniture and stairs; the roof is per level (type, pitch, overhang). FFL is relative to the ground floor, not an absolute RL. The only site object is a round tank.
- **What a house export lacks for site use.** No footprint polygon (it is derived on a 100 mm raster and never vectorised), no roof outline (roof plan area is an approximate raster calculation), no downpipes, no sewer or water exit points, no lot, no ground level.
- **Design file.** `.planstudio.json` is the raw project with migrate and validate on load. The 3D export (GLB, metres, Y up, ground floor at zero, node kinds in userData) is the best ready-made house handoff.
- **Embed.** An iframe postMessage interface with an origin allowlist exists, but has no message that returns the project. A get and return project pair is needed.
- **Operation registry.** Each operation has a label, a JSON schema for its parameters and a run function. The same registry generates the Anthropic tool schemas, so the UI and the AI share one editing path, and an AI turn is one undo step. About 150 lines are generic and port to TypeScript almost unchanged. Undo is a whole project clone, which is unsuitable once terrain sits in the state.
- **3D.** The triangle mesh builder and model utilities are generic. Everything that touches the ground (ground disc, tanks, decks, 3D drag plane, walk eye height, collision) assumes flat ground at the floor level.
- **PDF import** is an image underlay with two point calibration; it does not extract vectors.
- **DXF export** is a clean R12 writer with a layer rename map.
- **AI.** Haiku by default, Messages API, prompt caching on, tool input validation, and a usage guard (pre-flight estimate, daily and monthly spend caps, rate limits, confirmation of large requests, nothing charged on error).

### 2.2 JCESITE (existing code)

- SA6 (`backend/app/agents/sa6_glide3d/`) builds a deterministic scene bundle: terrain from TIN or survey points, cut and fill, contours, boundary, road, retaining walls, driveway, services and pits, one tank, overlays and placed items, in local metres from an MGA origin.
- The Next.js viewer already has orbit, layer toggles, picking (E, N, RL, cut or fill), first person with gravity, slope limit and collision on terrain, a minimap, and a placement controller with ghost preview and raycast snapping onto terrain.
- `backend/app/design/placement.py` validates placed items against the lot, DBYD exclusion buffers and the driveway.
- `sa4_hydro` parses vector DBYD PDFs, georeferences them, builds clearance buffers, proposes sewer and water connections and sizes a rainwater tank by daily mass balance.
- REV B. House importers already exist: SA7 aligns an architectural PDF to the lot and returns a footprint in MGA (refused above 0.30 m RMSE); SA8 builds a building model from a footprint or from a plan DXF. Neither is exposed through an API, and neither places the result on the lot.
- The requirements resolver represents every value as a cited `Requirement` or raises `UnresolvedRequirement`.

Defects and gaps found:

| Item | Finding |
|---|---|
| Statement | The AI GENERATED DRAFT statement is not in SA6 or the viewer. SA6 carries only "Illustrative only". |
| Branding | "GlideInside" remains in SA6 docstrings, `AgentCode.SA6_GLIDE3D`, the orchestrator and the database schema. |
| Contract mismatches | The viewer requests `/projects/{id}/scene-bundle`, which does not exist, and silently falls back to the demo bundle. Bundle `items` have a different shape in backend and viewer. The backend layer is `services`, the viewer expects `dbyd`. |
| Hard-coded values | Default service depths, road width 8.0 m, RWT runoff coefficient, first flush, demands and candidate sizes, connection grade and cover placeholders, retaining wall soil parameters, a 2.7 m ceiling height. |
| Authoring | Placement is one point per item. There is no polyline or polygon drawing. |
| DBYD | `docs/12` is plan only. `ServiceLine` drops the asset owner, plan date, source file, depth basis, material and verified status before SA6. |
| Stormwater | No IFD, runoff coefficients per surface, catchments, OSD, infiltration or flow routing. |
| REV B. LGA | No automatic state or LGA lookup. The caller supplies the state; the LGA is a free text by-product of the lot query. No LGA boundary layer or LGA code. |
| REV B. QLD | Lot lookup only (unverified). No QLD geocoder, zoning, council rules or terrain. |
| REV B. Rules store | Rules are JSON per LGA folder (Gunnedah only). The database table `planning.requirements` exists but nothing loads from it, and its check constraint rejects a value that is neither cited nor user entered, so a platform default cannot be stored without a schema change. No OSD or PSD keys exist. |
| REV B. Terrain | NSW 5 m DEM only. No LiDAR code, no LAS or LAZ library, no QLD elevation source, no contour generation from a surface. ELVIS downloads returned 403 when last tried. |
| Assistant | The design assistant edits dwelling walls, windows and roofs only, and defaults to an Opus model. |

## 3. Recommendation on the base (REV B)

Build on the JCESITE viewer and SA6, and port the generic Plan Studio modules into it as TypeScript. Plan Studio remains the house design tool and talks to JCESITE through its design file, its GLB export and its embed interface.

| Port to JCESITE (TypeScript) | Adapt | Leave in Plan Studio |
|---|---|---|
| Operation registry, `applyOp`, `toolSchemas`, parameter helpers (`model/ops.js` generic part) | Store: patch based undo, terrain kept outside the undo state | Walls, rooms, openings, roofs, stairs, doors, finishes, templates |
| Geometry helpers (`model/geometry.js`) | `site.js` builders: ground height from a terrain provider | Walk, colliders, ahead placement, picker (JCESITE has terrain versions) |
| Mesh builder and model utilities | 3D drag: raycast against terrain instead of a flat plane | 2D house editor and UI |
| AI tool validation and the usage guard (spend caps, rate limits, Haiku default) | AI context and prompt rewritten for site objects | Paywall, entitlement and Stripe plumbing |
| R12 DXF writer and layer map | DXF layers mapped to JCS codes | Title block PDF exporters |

Changes needed inside Plan Studio itself (small):

- A `site_export` block in the design file: footprint polygon per level (vectorised from the existing raster), roof outline and plan area, downpipe points, sewer and water exit points, FFL above ground floor.
- New point objects in the 2D editor for downpipes and sewer and water exit points.
- Embed messages to return the project and the GLB to a host page.

## 4. Architecture

1. **One site design document is the source of truth.** It holds every object the user or the AI places. The scene bundle is derived from it.
2. **Every edit is an operation.** The same registry serves the mouse tools, the AI and any later API. Undo stores operation patches, not whole copies.
3. **Engines compute, the AI decides and explains.** All numbers come from deterministic Python engines with cited parameters. The language model never produces a number itself.
4. **Rules come from the LGA.** Every engine asks the resolver, which answers from the site's LGA rules, then the platform default profile, then UNRESOLVED (section 7).
5. **Checks rerun on every edit.** Each object carries its issues (blocking, warning, PLATFORM DEFAULT, UNRESOLVED, DATA NOT AVAILABLE), shown in the model and in a checklist panel.
6. **Incremental rebuild.** Only the changed object and its dependants are rebuilt in the viewer.

## 5. Proposed data contract: `site_design.v1`

Every object carries these common fields:

| Field | Meaning |
|---|---|
| `id`, `type` | Identity and object type |
| `status` | existing, proposed, to be removed |
| `origin` | user, ai_proposal, imported, dbyd |
| `accepted` | For AI proposals: pending, accepted, rejected |
| `verified` | For imported and DBYD data: unverified, verified by user (with date) |
| `geometry` | Point, polyline or polygon in MGA metres with RL where relevant |
| `params` | Each parameter is user entered, LGA rule (requirement key), platform default (stamped) or UNRESOLVED |
| `issues` | Results of the latest checks |

Object types:

| Type | Geometry | Key parameters |
|---|---|---|
| `site_context` (REV B) | None | State, LGA name and code, how the LGA was found, rules profile in use |
| `terrain_source` | Grid or TIN | Source (LiDAR, survey, DEM), tile or project ID, capture date, resolution, stated accuracy, indicative label |
| `house` (REV B) | Footprint polygon per level, roof outline | Source (Plan Studio file, PDF, DXF), position and rotation, absolute FFL set at placement, roof area, downpipe and service exit points, GLB reference. Read only except for placement |
| `grading_area` | Polygon | Target level or grade, batter slopes, cut and fill result |
| `driveway` | Polyline with draggable control points, crossover on kerb | Width, levels per chainage, grades and transitions checked against the rules; same data as the plan set |
| `retaining_wall` | Polyline with top and bottom RL per vertex | Wall type, height per segment, screening result marked NOT STRUCTURAL |
| `landscape_area` | Polygon | Surface kind (turf, garden bed, mulch, gravel, permeable or impervious paving), which sets its runoff behaviour |
| `tree` | Point | Existing, proposed or to be removed; height, canopy diameter, trunk diameter; protection zones from the rules |
| `rwt` | Point | Volume, shape, dimensions, inlet, overflow and outlet RLs, connected roof area, reuse and detention portions |
| `infiltration_trench` | Polygon or polyline with width | Length, width, depth, media void ratio, design infiltration rate and its basis (site test or indicative), offsets from the rules |
| `osd` | Point or polygon | Form (tank, basin, below ground), storage volume, outlet orifice, permissible site discharge, top water level, overflow route |
| `stormwater_pit`, `stormwater_pipe` | Nodes and links | Size, invert levels, grade, cover |
| `sewer_drain` | Nodes and links | House drain from the house exit point to the connection point, inspection openings, invert levels, grade, cover |
| `water_service` | Polyline | Connection at the main, meter position, size, cover |
| `service_existing` | Polyline or point | Asset owner, DBYD plan reference, plan date and expiry, source file, diameter, material, depth and depth basis, positional tolerance, verified flag, exclusion buffer |
| `overland_flow` | Computed, not editable | Flow paths, contributing area, ponding areas, and the terrain and resolution they were computed on |

## 6. Tools

### 6.1 House import and placement (REV B)

- **Sources.** A Plan Studio design file (or a live hand-over from Plan Studio embedded in JCESITE), an architectural PDF (SA7 alignment), or a plan DXF (SA8 import).
- **Placement.** Drag to move, handles to rotate, snap to setbacks shown as labelled placeholders, set the FFL as an absolute RL. The house sits on the LiDAR terrain and the model shows cut and fill under the slab.
- **Outputs to other tools.** Roof area and outline to the stormwater helper, downpipe points to the RWT and pipe tools, exit points to the sewer and water tools, the footprint to clash checks.
- Coordinates: Plan Studio plan y points down and rotations are clockwise, so the import applies a handedness flip and the north angle before converting to MGA.

### 6.2 Driveway drag tool

- Drag the crossover along the kerb line, drag control points of the centreline, drag the width handles.
- On every drag the SA3 driveway engine recomputes the long section, grades and transitions and redraws the driveway draped on the design surface, with batters.
- Failing grades, transitions or crossover offsets show in red at the chainage concerned, with the rule they fail.
- The result is the same driveway object the plan set uses, so the plans and the model always agree.

### 6.3 Sewer tool

- Start at the house sewer exit point and end at the connection point (verified DBYD data, or user entered and labelled).
- The tool proposes a route, computes inverts, grade and cover, and checks them against the LGA or authority rules.
- Checks crossings and clearances against other services and flags placed objects within the authority's zone of influence of sewer mains.

### 6.4 Water tool

- Pick the main connection and meter position. The tool draws the service, checks cover and clearances, and records the RWT connection where reuse applies.

### 6.5 Placement tools

- Point tools: tank, tree, pit, OSD tank.
- Line tools: retaining wall, trench, pipe, service trace.
- Area tools: landscape area, grading area, OSD basin.
- All snap to terrain, boundary, kerb, house and other objects, and all are terrain aware.

## 7. LGA lookup and rules database (REV B)

### 7.1 LGA lookup

- The site point (lot centroid or geocoded address) is tested against the NSW and QLD local government area boundaries. The result sets the state, the LGA name and a normalised LGA code.
- Boundary layers come from NSW Spatial Services and the Queensland spatial catalogue, cached as an offline file so the lookup still works without a live service. Both sources are to be confirmed in stage 2.
- The user no longer has to pick the state first. The lookup result and its source are shown in the model and on outputs.

### 7.2 Rules database

- Rules live in the existing `planning.requirements` table, keyed by requirement key and selectors (state, LGA code, zone, authority).
- Resolution order for every value:
  1. Project value entered by the user.
  2. LGA rule (cited).
  3. State rule (cited).
  4. Platform default profile (stamped PLATFORM DEFAULT on every view and output).
  5. UNRESOLVED.
- Schema change needed: a `platform_default` status, allowed by the check constraint only with a stamp and a profile name. The existing JSON knowledge (Gunnedah) is loaded into the table.
- New keys: `stormwater.osd_required`, `stormwater.psd_l_s`, `stormwater.osd_method`, `stormwater.ssr_m3`, infiltration, tree protection and retaining wall keys as the tools need them.

### 7.3 Platform default profile (until LGA rules are loaded)

| Key | Default | Label |
|---|---|---|
| `stormwater.osd_required` | Yes | PLATFORM DEFAULT, LGA RULE NOT LOADED |
| `stormwater.psd_l_s` | 2 L/s (permissible site discharge) | PLATFORM DEFAULT, LGA RULE NOT LOADED |
| All other keys | No default | UNRESOLVED |

The JCE drainage conventions are not used. Design values come only from the LGA rules or the platform default profile.

The default applies only when the caller's jurisdiction is known and matches the default row (NSW or QLD), and LGA rows match only when the caller names a matching LGA (the state is compared too, so `qld-gunnedah` never matches `nsw-gunnedah`). The stamp says why the default applies:

| Situation | Stamp |
|---|---|
| No rules loaded for the caller's LGA | PLATFORM DEFAULT, LGA RULE NOT LOADED |
| The LGA's rules are loaded but hold no row for the key | PLATFORM DEFAULT, LGA VALUE NOT FOUND |
| The LGA has an explicit unresolved entry for the key (its prompt and notes are carried alongside) | PLATFORM DEFAULT, LGA VALUE UNRESOLVED |
| The LGA has a conflict entry for the key | Raised as unresolved, never defaulted |

## 8. Terrain (REV B)

- LiDAR first, in both states: ELVIS (Geoscience Australia) 1 m DEM tiles or point clouds, with QLD and NSW state DEMs as fallbacks and the NSW 5 m DEM as the last resort, labelled indicative.
- New capability: tile discovery and download, ground classification where point clouds are used, TIN build, contour generation from the surface, provenance (source, capture date, accuracy) stored with the terrain.
- Risk: ELVIS downloads returned 403 from this environment when last tried. Stage 3 starts by confirming access; if it is still blocked, the user supplies the tiles and the tool ingests them.
- MGA zones 54, 55 and 56 cover NSW and QLD. Far North Queensland zone handling is to be tested.

## 9. Owner decisions (REV B)

| No. | Decision (14/10/2026) |
|---|---|
| D1 | Plan Studio source supplied. Reuse plan revised in section 3. |
| D2 | The house is designed in Plan Studio, or imported from PDF or DXF, then placed on the LiDAR terrain in JCESITE. |
| D3 | The software finds the LGA and pulls its rules from a database, NSW and QLD. The database is built later. Until then: OSD applies, permissible site discharge 2 L/s. |
| D4 | LiDAR contours are the terrain basis. |
| D5 | The JCE drainage conventions are not used. The specific LGA's rules govern. |

## 10. Stormwater helper

| Function | Method | Inputs and data |
|---|---|---|
| Catchments | Areas by surface kind from the placed house roof, driveway, paving and landscape areas | Runoff behaviour per surface from the rules or UNRESOLVED |
| Design rainfall | Lookup for the site location | Bureau of Meteorology 2016 IFD and the ARR 2019 Data Hub, access to be confirmed |
| OSD sizing | Recomputed on every edit, method from the rules | Permissible site discharge from the LGA rule, otherwise the 2 L/s platform default, stamped |
| RWT | Existing SA4 mass balance, with its placeholder values moved into the rules | Monthly rainfall source to be confirmed; BASIX target from the certificate in NSW |
| Infiltration | Indicative rate for the area, replaced by a site test result when entered | Soil landscape mapping in each state (candidate sources, to be confirmed). Always labelled indicative, site testing required |
| Overland flow | Flow direction and accumulation on the combined LiDAR and design surface, with ponding detection | LiDAR terrain plus placed objects |

The helper explains each result, shows the calculation and its sources, and flags PLATFORM DEFAULT and UNRESOLVED values. The language model only writes the explanation and suggestions.

## 11. AI first design

1. **Ingest.** The placed house, the client's site layout (image or PDF underlay with two point calibration, or DXF), the LiDAR terrain, the verified services and the LGA rules.
2. **Generate.** The engines produce candidates: driveway alignment and crossover, tank location, sewer and water routes, roof water to RWT then overflow to OSD or trench then to the point of discharge, retaining walls where grading requires them, landscape areas from what remains.
3. **Choose.** The language model chooses among the candidates against the checks and writes a short reason for each.
4. **Propose.** The design is applied as one batch of operations tagged `ai_proposal`, a single undo step.
5. **Work through.** The end user steps through a checklist of the proposals, accepts, edits or rejects each one, and all checks rerun.

Model use: Haiku by default with the Plan Studio usage guard (spend caps, rate limits, confirmation of large requests), stepping up only where Haiku proves unreliable. The current JCESITE assistant default (`claude-opus-5-5` in `llm.py`) is changed accordingly.

## 12. Stages (REV B, stop and review after each)

| Stage | Content |
|---|---|
| 2 | Base and rules: rebrand, AI GENERATED DRAFT statement on every view, fix the three contract mismatches and add the scene bundle route; automatic state and LGA lookup for NSW and QLD; rules table with the platform default profile (OSD, 2 L/s) and the Gunnedah JSON loaded. |
| 3 | Terrain: LiDAR access and ingest, contours from the surface, boundary, adjoining lots with labels, road and assumed kerb. |
| 4 | Editing core: `site_design.v1`, operation registry ported from Plan Studio with patch undo, point, line and area tools, terrain aware snapping, incremental rebuild. |
| 5 | House import and placement: Plan Studio design file and embed hand-over, PDF and DXF import, placement with FFL, roof catchments and exit points. Small Plan Studio changes (section 3). |
| 6 | Driveway drag tool, grading areas, cut and fill, batters, matching the plan set. |
| 7 | Site objects: landscaping, trees, retaining walls, RWT, infiltration trench, OSD, stormwater pits and pipes. |
| 8 | Services: DBYD phase 0, `service_existing` with full provenance, sewer and water tools, clearance and zone of influence checks. |
| 9 | Stormwater helper. |
| 10 | AI first design and the proposal checklist. |
| 11 | Viewer polish, first person outdoors, exports (GLB and DXF on JCS layers), pipeline integration and tests. |
