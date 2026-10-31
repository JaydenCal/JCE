# Plan Studio: Website Integration and Build Scope

Brief for Claude Code

| Item | Detail |
|---|---|
| Document | PS-SCOPE-001 |
| Revision | A |
| Date | 14/10/2026 |
| Owner | Jayden Callen, JCE Infrastructure Pty Ltd |
| Status | For implementation. Prototype build in progress (see section 18) |
| Working name | Plan Studio (final name and route to be confirmed, decision 17.2) |

---

## 0. Instructions to Claude Code

- Read sections 1 to 4 for intent, sections 5 to 11 for the tool and its back end, and section 12 for the website changes. Section 15 sets the order of work and section 16 the acceptance tests.
- Start with Step 0 (section 12.1). Inspect the website repository and record the stack in `docs/INTEGRATION_NOTES.md` before changing anything.
- The tool is supplied as a self-contained code package (`plan-studio/`). Integrate it rather than rewriting it. Where the package and this brief disagree, follow this brief and log the difference in `docs/INTEGRATION_NOTES.md`.
- Keep every price, credit allowance, threshold and limit in configuration (section 11.6). Do not hard-code them in page copy or components.
- Stripe stays in test mode until Jayden approves live mode in writing.
- Do not send email or messages on Jayden's behalf. Customer receipts are sent by Stripe only.
- Ask Jayden before: enabling live payments, changing the price, publishing to production, adding a new third-party service, or removing existing site content.

---

## 1. Purpose

Add a browser-based home design tool to the website. Visitors draw a floor plan in a game-like 2D editor, see it immediately as a 3D model, walk through it in first person, furnish it and change finishes.

- The core tool is free and needs no account and no AI.
- A paid **Plan Pack (A$30 per project)** unlocks the AI design assistant and the exports: PDF plans, DXF and a 3D model.

Business goals:

- Lead generation: a genuinely useful free tool that brings home owners, owner builders and small builders to the site.
- Direct revenue: Plan Pack sales.
- Cross-sell: engineering services (footings, slabs, stormwater, sheds, extensions) and 3D fly-throughs, through configurable call-to-action links.

---

## 2. Product summary

### 2.1 Reference

The interaction model follows the Design Studio and Walkthrough demonstrations on planningai.com.au (viewed 14/10/2026): level tabs, a roof-off toggle, click any wall, roof or window to change its finish, and an AI panel that edits the model from plain English. PlanningAI is a professional NSW planning subscription (Individual plans from A$250 + GST per month). Plan Studio is a per-project consumer and small-builder product.

- Borrow interaction ideas only. Do not copy its code, text, images, colour names or brand.

### 2.2 What the tool does

- Draw rooms and walls on a snapping grid like a building game, then drop doors, windows, furniture, stairs, decks and rainwater tanks onto the plan.
- See the plan as a 3D model at any time, take the roof off, isolate a level, click surfaces to change materials and colours.
- Walk through the model in first person (keyboard and mouse, or touch joystick).
- Model extensions: trace an existing plan from a photo or scan, mark existing, new and demolished work, and view existing or proposed.
- Plan Pack: describe changes in plain English and the AI applies them; export PDF plans, DXF and a 3D model.

### 2.3 Building types

- Single storey house
- Double storey house
- Units: secondary dwelling (granny flat), dual occupancy (duplex), attached villa units
- Sheds: garage, workshop, farm or machinery shed (portal frame style with roller doors)
- Extensions to an existing building
- Site items: rainwater tanks (RWT), decks, patios and alfresco areas

### 2.4 Out of scope for version 1

- Site boundaries, setbacks, contours and planning compliance checks
- Structural, stormwater or BASIX outputs, and any certification
- Cost estimating, photoreal rendering, multi-user editing

Phase 2 candidates are listed in section 15.

---

## 3. Users and key journeys

Users:

- Home owner planning a new home, granny flat or extension
- Owner builder or farmer planning a shed
- Small builder or designer preparing a quick concept for a client

Journeys:

1. Pick a template, edit it, view in 3D, walk through, save. (Free)
2. Upload a photo of an existing plan, trace it, mark it existing, add an extension. (Free)
3. Buy a Plan Pack, make changes with the AI assistant, export PDF, DXF and 3D model. (Paid)
4. From inside the tool, request engineering or a fly-through. (Lead)

---

## 4. Tiers and pricing

### 4.1 Free tier

- Full 2D editor, all building types and templates, furniture, doors and windows, stairs, decks, rainwater tanks, extension mode and tracing underlay
- 3D view, finish picker, roof toggle, level isolation and first person walk-through
- Autosave in the browser, plus save and open of the project file (`.json`)
- Room area schedule on screen
- AI panel visible but locked, with example prompts and an unlock button
- Export menu visible but locked

The free tier makes no AI calls, so it costs nothing to run beyond static hosting.

### 4.2 Plan Pack (premium)

- Price: **A$30 per project**, displayed as "A$30 incl. GST" if the selling entity is GST registered (decision 17.3)
- AI design assistant on Claude Haiku 5.5 with an allowance of **500 AI credits** (section 7.4)
- PDF plan set, DXF and 3D model (GLB and OBJ) for that project
- Unlimited re-export of the same project for 12 months (decision 17.4)

### 4.3 Enforcement rules

- Paid exports are generated on the server after an entitlement check. The production client never generates paid formats.
- AI calls go only through the server proxy. The Anthropic API key never reaches the browser.
- The development flag `?dev=1` unlocks client-side exports for testing and is honoured on `localhost` only. Strip it from production builds.

### 4.4 Unit economics per Plan Pack

Inputs (current published rates, check before launch):

- Stripe standard pricing in Australia, domestic online cards from 01/10/2026: 1.65% + A$0.30
- Stripe international online cards: 3.50% + A$0.30, reducing to 2.80% + A$0.30 from 01/04/2027
- Claude Haiku 5.5 (prompts up to 100,000 tokens): US$0.10 per million input tokens, US$0.50 per million output tokens, US$0.125 per million for 5-minute cache writes, US$0.01 per million for cache reads. Above 100,000 input tokens the rates rise to US$0.50 and US$2.50 per million, so every request is capped well below that (section 7.3).

**Stripe fee, domestic card**

$$\text{fee} = 0.0165 \times 30.00 + 0.30 = 0.495 + 0.30 = \text{A}\$0.80$$

**Stripe fee, international card (until 01/04/2027)**

$$\text{fee} = 0.035 \times 30.00 + 0.30 = 1.05 + 0.30 = \text{A}\$1.35$$

**GST component (only if registered)**

$$\text{GST} = \frac{30.00}{11} = \text{A}\$2.73$$

**AI cost ceiling per Plan Pack** (1 credit = US$0.001 of model cost; FX assumption A$1 = US$0.60, set conservatively in configuration)

$$500 \times 0.001 = \text{US}\$0.50 = \frac{0.50}{0.60} = \text{A}\$0.83$$

**Net per Plan Pack, domestic card, GST registered, AI allowance fully used**

$$30.00 - 2.73 - 0.80 - 0.83 = \text{A}\$25.64$$

before hosting and income tax.

**Typical cost of one AI edit**

- Cached system prompt and tools: 6,000 tokens × US$0.01 per million = US$0.00006
- Plan context: 5,000 tokens × US$0.10 per million = US$0.00050
- Message and recent history: 500 tokens × US$0.10 per million = US$0.00005
- Output (tool calls and reply): 1,000 tokens × US$0.50 per million = US$0.00050

$$0.00006 + 0.00050 + 0.00005 + 0.00050 = \text{US}\$0.00111 \Rightarrow 2 \text{ credits (rounded up)}$$

The first request in each 5-minute cache window adds a cache write of 6,000 × US$0.125 per million = US$0.00075 (1 credit). A Plan Pack of 500 credits therefore covers roughly 170 to 500 edits depending on the size of each change.

---

## 5. 2D plan editor (free)

### 5.1 Canvas and navigation

- Units: millimetres. Grid 100 mm minor and 1,000 mm major. Snap 50 mm by default (toggle, hold Alt to bypass).
- Zoom with wheel or pinch about the pointer; pan with middle mouse, Space plus drag, or two-finger drag; Zoom to fit with F.
- Plan coordinates: x to the right, y down the screen. North arrow shown and rotatable (`site.northDeg`).

### 5.2 Tools

| Tool | Key | Behaviour |
|---|---|---|
| Select | V | Click to select; drag furniture, tanks and stairs; drag an opening along its wall; drag a wall to move it (connected walls stretch); drag wall endpoints; Delete removes |
| Room | R | Drag a rectangle to create a room and its walls; shared walls merge; name and type prompt after drawing |
| Wall | W | Click to click polyline; double click or Esc to finish; live length; Shift locks to 15 degree steps |
| Door | D | Hover a wall to preview; click to place; Tab flips swing; types: single, sliding, garage, roller, plain opening |
| Window | N | As for doors; styles: sliding, awning, fixed, double hung, louvre; preset sizes |
| Furniture | F | Catalogue drawer; drag onto plan; Q and E rotate 90 degrees, Shift with Q or E rotates 15 degrees |
| Stairs | S | Drag a rectangle; links to the level above |
| Deck or patio | K | Drag a rectangle for an outdoor area (deck, patio, alfresco) with no walls; balustrade and roofed toggles |
| Rainwater tank | T | Click to place; capacity picker (2,000, 5,000, 10,000 and 22,500 L) |
| Measure | M | Click two points to show a distance (not saved) |
| Underlay | U | Upload PNG or JPG; calibrate by clicking two points and entering the true distance; opacity; lock |
| Status brush | X | Extension mode: click walls or rooms to set existing, new or demolish |

### 5.3 Elements

- Rooms: name, type, floor finish, area in m² (two decimals) at the centroid, dimensions when selected.
- Walls: thickness set automatically (external 250 mm, internal 100 mm, shed 100 mm) and editable; height inherits the level; external or internal classification is automatic; dimension strings on the selected wall and overall dimensions on the outside.
- Openings: width, height, sill (windows), position along the wall, hinge end and swing side; clamped inside the wall, at least 100 mm from wall ends, no overlaps.
- Levels: tabs; Add level copies the external walls of the level below as a starting outline; ceiling height and floor-to-floor height; the level below shows as a faint ghost.
- Decks: outdoor rooms with no walls; balustrade toggle; `roofed` includes the area under the main roof (alfresco).
- Rainwater tanks: capacity, diameter, height and colour; the connected roof area (m², plan projection) is shown on selection.

### 5.4 Extension mode

- Every wall, room, opening and tank carries `status`: `new`, `existing` or `demolish`.
- Drafting convention in 2D: existing walls solid grey; new walls solid dark; demolished walls dashed red outline.
- Bulk action: "Mark everything as existing" (used after tracing an existing plan).
- View switch: Existing, Proposed (existing plus new, demolished removed), Both.

### 5.5 Schedules panel

- Rooms with areas; totals per level for indoor floor area, garage and outdoor areas.
- Extension totals: existing, new and demolished floor area.
- Door and window schedule: counts and sizes.

### 5.6 History, persistence and templates

- Undo and redo, 100 steps (Ctrl or Cmd with Z and Y).
- Autosave to `localStorage` (debounced 1 s). Underlay images go to IndexedDB, not the project JSON.
- Save and open the project file (`.json`, schema versioned and migrated on open).
- New project dialog with templates: Blank, Shed (single garage or workshop), Farm shed, Granny flat (about 60 m²), Single storey 4 bedroom house, Double storey 4 bedroom house, Duplex (two attached units), Extension starter (existing house marked existing).

### 5.7 Soft validation

Non-blocking warning badges for overlapping rooms, openings outside walls and enclosed rooms with no door.

---

## 6. 3D view and walk-through (free)

### 6.1 Model build

- Walls extruded at their thickness, with openings formed by building piers, sills and lintels around each opening (no CSG). External faces take the external finish; internal faces are painted.
- Floors per room with the room's finish; ground slab edge; ceilings shown in walk mode only.
- Roofs per level (6.3), fascia and gutter as simple profiles.
- Decks with posts and optional balustrade; tanks as cylinders with lids; stairs as stepped blocks; furniture as procedural low-poly models.
- Every pickable mesh carries `userData = { kind, id, levelId, face }`.

### 6.2 Orbit view

- Drag to rotate, right drag to pan, wheel to zoom, double click to focus.
- Level tabs: All, then each level. Selecting a lower level hides the levels above (cutaway).
- Roof on and off toggle.

### 6.3 Roof generation

- Roof footprint per level: indoor rooms (plus outdoor rooms flagged `roofed`) of that level, minus the footprint of the level above.
- The footprint is rasterised at 100 mm and decomposed into rectangles. Each rectangle receives a roof of the level's type (hip, gable, skillion or flat) at the level's pitch and eave overhang, with its ridge along the longer side. Overlapping rectangles intersect to form valleys.
- Limitation: non-rectilinear walls are approximated. Phase 2: straight skeleton roofs for arbitrary outlines.

### 6.4 Finish picker

Click any wall, roof, window or floor to open a popup with material chips and colour swatches, as in the reference.

- Default scope is the whole house; "This wall only" applies an override.
- Roof materials: corrugated, trimdek, standing seam, concrete tile, terracotta tile.
- Wall materials: brick, render, weatherboard, vertical cladding, grooved cladding, stone, concrete, corrugated, trimdek, standing seam.
- Floor materials: timber, tile, carpet, polished concrete, vinyl, decking.
- Window and door frames: colour only.
- Colours use generic display names (for example "Charcoal Matt"). Each colour carries alias keys so the AI can map common Australian steel and brick colour names to the nearest swatch (decision 17.7).

### 6.5 First person walk-through

- Pointer lock; W, A, S, D or arrow keys; mouse look; Shift to run; Esc to exit.
- Eye height 1.65 m; walk 1.4 m/s; run 3.0 m/s.
- Collision with walls; doorways and openings at least 1.8 m high are passable.
- Level change with on-screen Up and Down buttons and Page Up and Page Down (phase 2: walk the stairs).
- Touch devices: left thumb joystick to move, drag on the right to look.

### 6.6 Visual quality and performance

- Hemisphere light plus a directional sun with soft shadows (shadows switch off automatically on low-end devices), ACES tone mapping, sRGB output, sky gradient and a ground plane.
- Optional thin edge lines on walls and roofs for an architectural model look.
- Targets: 60 fps orbit on a mid-range laptop for a 300 m² house with 50 furniture items; fewer than 250 draw calls (geometry merged per material); rebuild under 150 ms after an edit.

---

## 7. AI design assistant (Plan Pack)

### 7.1 Behaviour

- Panel available in the 2D and 3D views, styled like the reference: example prompt chips, input box, short history.
- The assistant replies in one or two sentences and applies the change. The whole change is one undo step, listed as a summary (for example "Roof colour set to Charcoal; deck extended 2.0 m south"), with an Undo button.
- If the request is unclear it asks one short question.
- It never claims compliance with codes, planning controls or approvals, and declines requests unrelated to the design.

### 7.2 Request flow

1. Browser estimates the cost (7.4) and asks for confirmation if the request is large.
2. Browser sends `POST /api/ai/edit` with the message, a compact plan context (7.6), the active level and the last four turns.
3. Server checks entitlement, rate limits, the credit balance and the global spend caps, then reserves the estimated credits.
4. Server calls the Anthropic Messages API: cached system prompt, cached tool definitions, then the context and message.
5. Server validates every `tool_use` block against the operation schemas, settles credits from the actual usage, logs the request and returns `{ reply, ops[], credits }`.
6. Browser applies the operations through the same operations layer the editor uses, as one undo step, and reports any operation that failed.

One model call per request keeps the cost low. An automatic repair round when operations fail is available behind a setting and is off by default.

### 7.3 Model settings

- Model: Claude Haiku 5.5, the cheapest current Claude model, API ID `claude-haiku-5-5` (confirm on the Anthropic models overview before go-live). Set in `ANTHROPIC_MODEL`.
- `max_tokens` 1,500; `tool_choice` auto; prompt caching on the system prompt and tools (5-minute cache).
- Plan context capped at 40,000 input tokens. Above the cap, furniture and finish detail is summarised before sending. Requests must never reach the 100,000 token pricing tier.

### 7.4 Credits, warnings and the hard stop

- 1 credit = US$0.001 of model cost (`CREDIT_USD`).
- Cost of a request from the API `usage` fields:

$$\text{cost} = I \times p_{in} + O \times p_{out} + W \times 1.25\,p_{in} + R \times 0.1\,p_{in}$$

where I is uncached input tokens, O output tokens, W cache write tokens, R cache read tokens, and p is the price per token.

$$\text{credits charged} = \max\left(1, \left\lceil \frac{\text{cost}}{\text{CREDIT\_USD}} \right\rceil\right)$$

- Allowance: 500 credits per Plan Pack (`PLAN_PACK_CREDITS`).
- Warnings at 50%, 80% and 95% used (`WARN_THRESHOLDS`): a non-blocking banner in the panel, shown once per threshold, plus a permanent meter ("312 of 500 credits left").
- Pre-flight estimate before each request: tokens estimated as characters ÷ 3.5 for context and message, plus `max_tokens` for output. If the estimate exceeds `LARGE_REQUEST_CREDITS` (default 10), the user confirms: "This change may use about N credits. M credits remain. Continue?"
- Hard stop: the server refuses a request when the remaining credits are below its estimate or the allowance is used (HTTP 402, code `CREDITS_EXHAUSTED`). The panel becomes read-only with a clear message. Manual editing and exports keep working.
- Reservation: estimated credits are reserved before the model call and settled to the actual cost after it, so parallel requests cannot overspend.
- Global protection across all customers: `AI_DAILY_CAP_USD` and `AI_MONTHLY_CAP_USD`. When reached, AI pauses for everyone (HTTP 503, code `AI_PAUSED`) and the event is logged for review.
- Rate limits: 6 requests per minute and 150 per day per project.
- Top-ups: off by default (decision 17.4). If enabled, a second Stripe price (suggested A$10 for 500 credits).
- Logging: tokens, cost, credits, number of operations, latency and status for every request. Plan content is not retained beyond 30 days.

### 7.5 Tools the AI can call

The AI's tools are generated from the operations registry in `src/model/ops.js` (Appendix A), the same functions the editor uses. Catalogue enumerations (furniture IDs, material IDs, colour IDs) are injected into the tool schemas from `src/catalogue/`.

### 7.6 Compact plan context

Plain text rather than JSON to save tokens, for example:

```
PROJECT "Smith residence" type=house units=mm x=right y=down(south)
FINISH ext_walls=brick/light-grey roof=corrugated/charcoal frames=black
LEVEL L0 "Ground" ffl=0 ceiling=2550 roof=hip 22.5deg eaves=450
ROOM r1 "Living" living rect x=0..6000 y=0..4500 area=27.00
ROOM r2 "Deck" deck outdoor rect x=6000..9000 y=0..3000
WALL w1 (0,0)-(6000,0) ext t=250 new
OPEN o1 window on w1 centre=3000 w=1800 h=1200 sill=900 sliding
FURN f1 sofa_3 at (2000,2000) rot=0 in r1
TANK t1 5000L at (9600,500)
```

### 7.7 System prompt outline

- Role: edit a house, unit or shed concept model using the tools only; make the smallest set of changes that satisfies the request.
- Coordinates and units as above; north is up unless `northDeg` says otherwise; "deeper" or "bigger" means growing outward.
- Use existing IDs from the context; never invent IDs except for new elements returned by tools.
- Map colour and material words to the nearest catalogue entry.
- No compliance, approval, structural or cost claims. Decline unrelated requests.
- Reply in one or two plain sentences.

---

## 8. Exports (Plan Pack)

### 8.1 PDF plan set

- A3 landscape, vector. One sheet per level at 1:100 (automatically 1:50 or 1:200 to fit).
- Walls poched by status, door swings, windows, room names and areas, overall and wall dimension strings, north arrow and scale bar.
- Extra sheets: door and window schedule, area schedule, and a cover with a 3D snapshot.
- Title block: project name, date (DD/MM/YYYY), sheet number, scale, seller name and ABN, and the disclaimer: "Concept design only. Not for construction. Not a development application drawing. Verify all dimensions on site."

### 8.2 DXF

- ASCII DXF R12 (AC1009) for the widest compatibility (AutoCAD, Civil 3D, BricsCAD, DraftSight, LibreCAD).
- Units millimetres (stated in a note on the drawing), DXF Y = minus plan y so the plan reads the same way up.
- All levels in one file, placed side by side with titles.
- Entities: LINE, ARC, CIRCLE, POLYLINE and TEXT on the layers in Appendix B. The layer names are held in a configurable map so they can be aligned with JCE-STD-CAD-001 later.

### 8.3 3D model

- GLB (glTF 2.0 binary, metres, Y up) as the primary format: opens in Windows 3D Viewer, Blender, Twinmotion, game engines and web viewers.
- OBJ with MTL (zipped) as a secondary format.
- Phase 2: USDZ for iPhone AR Quick Look.

### 8.4 Generation

All paid files are generated on the server from the posted project JSON with the same modules the browser uses (`src/premium/exporters/` and `src/viewer3d/build.js`, which has no DOM dependency). File names: `<project-slug>-plans.pdf`, `<project-slug>.dxf`, `<project-slug>.glb`, `<project-slug>-obj.zip`.

---

## 9. Data model (project JSON, schema 1)

```jsonc
{
  "schema": 1,
  "id": "p_k3j9x2ab",
  "name": "Smith residence",
  "type": "house",                         // house | unit | shed | extension
  "createdAt": "2026-10-14T05:00:00.000Z",
  "updatedAt": "2026-10-14T05:00:00.000Z",
  "settings": { "gridMm": 100, "snapMm": 50, "extWall": 250, "intWall": 100, "floorToFloor": 3000 },
  "finishes": {
    "externalWalls": { "material": "brick", "colour": "brick-light-grey" },
    "internalWalls": { "material": "paint", "colour": "paint-white" },
    "roof":   { "material": "corrugated", "colour": "steel-charcoal" },
    "fascia": { "colour": "steel-charcoal" },
    "frames": { "colour": "frame-black" },
    "floors": { "material": "timber", "colour": "floor-natural-oak" }
  },
  "site": {
    "northDeg": 0,
    "underlay": null,                     // { key, x, y, mmPerPx, rotation, opacity, locked } image held in IndexedDB
    "tanks": [ { "id": "t_1", "x": 12000, "y": 500, "capacityL": 5000, "diameter": 1850, "height": 2000, "colour": "steel-dune", "status": "new" } ]
  },
  "levels": [ {
    "id": "l_ground", "name": "Ground", "elevation": 0, "height": 2550,
    "roof": { "enabled": true, "type": "hip", "pitch": 22.5, "overhang": 450 },
    "walls": [ { "id": "w_1", "a": { "x": 0, "y": 0 }, "b": { "x": 6000, "y": 0 },
                 "thickness": 250, "height": null, "kind": "exterior", "outside": 1, "auto": true,
                 "status": "new", "finish": null } ],
    "openings": [ { "id": "o_1", "wallId": "w_1", "kind": "window", "offset": 3000, "width": 1800,
                    "height": 1200, "sill": 900, "style": "sliding", "hinge": null, "side": 1, "status": "new" } ],
    "rooms": [ { "id": "r_1", "name": "Living", "type": "living",
                 "polygon": [ { "x": 0, "y": 0 }, { "x": 6000, "y": 0 }, { "x": 6000, "y": 4500 }, { "x": 0, "y": 4500 } ],
                 "floor": null, "outdoor": false, "roofed": false, "balustrade": false, "status": "new" } ],
    "furniture": [ { "id": "f_1", "item": "sofa_3", "x": 2000, "y": 2000, "rotation": 0, "w": null, "d": null } ],
    "stairs": [ { "id": "s_1", "x": 3000, "y": 1500, "width": 1000, "length": 3600, "rotation": 0 } ]
  } ]
}
```

Field rules:

- All lengths in millimetres; angles in degrees; plan y increases down the screen.
- Wall normal: with unit direction d from `a` to `b`, the normal is n = (−d.y, d.x). `outside` is `1` when the outdoor side is on +n, `-1` when on −n, `0` when unknown (both sides indoors or free standing). `auto: true` means kind, outside and thickness are maintained automatically; editing thickness sets it to `false`.
- Opening `offset`: distance from wall end `a` to the opening centre. `hinge`: `"a"` or `"b"` (the end of the opening nearest wall end a or b); `side`: `1` or `-1` (the normal side the door swings into).
- Furniture `x, y`: centre of the item; `rotation`: degrees clockwise as seen on the plan. In 3D, rotation about Y is the negative of this.
- Stairs: rectangle centred on `x, y`; `width` across, `length` along the run; rotation as for furniture; rises from local −y to local +y.
- `finish` on a wall and `floor` on a room are optional overrides of the project finishes.
- Level `elevation`: finished floor level relative to the ground floor (mm); `height`: ceiling height.
- 3D mapping: X = x ÷ 1000, Z = y ÷ 1000, Y = elevation ÷ 1000 (metres).

---

## 10. Architecture and code package

### 10.1 Stack

- Plain ES modules with no framework and no build step for the prototype.
- three.js 0.186.1 for 3D; jsPDF 4.2.1 for the PDF export (server and dev only).
- The prototype loads both through an import map pointing at jsDelivr. For production, bundle with the site's bundler (or Vite) and self-host the vendor files; remove the CDN import map.

### 10.2 Folder layout

```
plan-studio/
  index.html                 app shell, import map
  styles.css                 tool styles; all colours as --ps-* tokens
  src/
    app.js                   wiring, view switching, embed API
    model/   schema.js  geometry.js  ops.js  store.js
    editor2d/                2D editor (canvas)
    viewer3d/  build.js  materials.js  roof.js  viewer.js  walk.js
    catalogue/ furniture.js  finishes.js  openings.js  tanks.js  templates.js  index.js
    premium/   premium.js  credits.js  ai/  exporters/
  server/      worker.js  lib/  schema.sql  wrangler.toml.example  README.md
  tests/       node --test suites
  docs/        SCOPE.md (this file)
```

### 10.3 Module contracts

- `src/model/schema.js`: `SCHEMA_VERSION`, `DEFAULTS`, enums, `uid(prefix)`, `createProject()`, `createLevel()`, `createWall()`, `createOpening()`, `createRoom()`, `createFurniture()`, `createStair()`, `createTank()`, `migrate(project)`, `validate(project)`.
- `src/model/geometry.js`: vector helpers, `wallLength`, `wallDir`, `wallNormal`, `pointOnWall`, `projectToSegment`, `nearestWall`, `polygonArea`, `polygonCentroid`, `pointInPolygon`, `bbox`, `rectPolygon`, `snap`, `openingSpan`.
- `src/model/ops.js`: `OPS` registry (name, description, parameter schema, run function), `applyOp(project, name, args, ctx)`, `OpError`, `classifyWalls(level)`, `findEntity(project, id)`. Every edit made by the editor, the templates and the AI goes through these operations.
- `src/model/store.js`: `createStore(project, { autosaveKey })` returning `project`, `ui`, `apply(label, fn)`, `run(opName, args)`, `runBatch(label, steps)`, `undo()`, `redo()`, `replace(project)`, `setUI(patch)`, `select(id)` and `on(event, callback)`. Events: `project`, `ui`, `selection`, `history`.
- `src/editor2d/editor.js`: `createEditor2D(element, store, { catalogue })` returning `setActive(bool)`, `zoomToFit()`, `dispose()`.
- `src/viewer3d/build.js`: `buildModel(project, { THREE, materials, levelFilter, showRoof, statusView, catalogue })` returning a `THREE.Group`. No DOM access.
- `src/viewer3d/viewer.js`: `createViewer3D(element, store, { catalogue })` returning `setActive(bool)`, `setMode('orbit' | 'walk')`, `resetCamera()`, `getModel()`, `snapshot({ width, height })`, `dispose()`.
- `src/catalogue/index.js`: `catalogue` object with furniture, finishes, openings presets, tanks and templates.
- `src/premium/premium.js`: `createPremium(store, { mounts, apiBase, catalogue, viewer })` returning `isEntitled()`, `openUpgrade()`, `openExports()`, `dispose()`.

### 10.4 Theming

All tool colours are CSS custom properties prefixed `--ps-` (background, panel, text, muted, accent, accent ink, border, warning, danger) with light and dark values. The host site sets these to its brand colours without editing the tool.

### 10.5 Embed API (iframe postMessage)

Messages are objects `{ type, ...payload }`. Both sides check `event.origin` against an allowlist.

| Direction | Type | Payload | Purpose |
|---|---|---|---|
| Host to app | `ps:load-template` | `{ id }` | Start the teaser on a given template |
| Host to app | `ps:set-mode` | `{ mode: "demo" or "full" }` | Demo mode hides file and premium controls |
| Host to app | `ps:set-theme` | `{ theme: "light" or "dark" }` | Match the host page |
| App to host | `ps:ready` | `{}` | App loaded |
| App to host | `ps:open-full` | `{ projectId }` | User asked for the full screen app |
| App to host | `ps:upgrade` | `{ projectId }` | User clicked Unlock |
| App to host | `ps:analytics` | `{ event, props }` | Forward events to the site's analytics |

---

## 11. Back end

### 11.1 Platform

The server is written as Web-standard handlers (`Request` in, `Response` out) using `fetch` and WebCrypto, with no vendor SDKs, so it runs on Cloudflare Workers, Vercel or Netlify functions, Deno or Node 20+.

- Reference implementation: Cloudflare Workers with D1 (SQLite).
- If the site is already hosted on Vercel or Netlify, wrap the same handlers in that platform's functions and implement the small `Store` interface on its database.

### 11.2 Endpoints

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/checkout` | none | `{ projectId, projectName }` | `{ url }` Stripe Checkout URL |
| `POST /api/stripe/webhook` | Stripe signature | Stripe event | `200` |
| `GET /api/entitlement?session_id=&project=` | none | | `{ token, credits }` once paid |
| `POST /api/entitlement/restore` | none, rate limited | `{ email, sessionOrReceipt }` | `{ token }` |
| `GET /api/credits?project=` | Bearer token | | `{ total, used, remaining, warnLevel }` |
| `POST /api/ai/estimate` | Bearer token | `{ message, context }` | `{ estimatedCredits, remaining, requiresConfirm }` (no model call) |
| `POST /api/ai/edit` | Bearer token | `{ message, context, history, activeLevelId, confirmLarge }` | `{ reply, ops, credits, warning }` |
| `POST /api/export/:type` | Bearer token | `{ project }` (type: pdf, dxf, glb, obj) | file download |
| `GET /api/health` | none | | `{ ok, aiPaused }` |

Error codes: `UNAUTHORISED`, `NOT_ENTITLED`, `CREDITS_EXHAUSTED`, `INSUFFICIENT_CREDITS`, `CONFIRM_REQUIRED`, `RATE_LIMITED`, `AI_PAUSED`, `PAYLOAD_TOO_LARGE`, `BAD_REQUEST`.

### 11.3 Data store

```sql
CREATE TABLE entitlements (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, email TEXT,
  stripe_session_id TEXT UNIQUE, amount_cents INTEGER, currency TEXT,
  credits_total INTEGER NOT NULL, credits_used INTEGER NOT NULL DEFAULT 0, credits_reserved INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,            -- active | refunded | expired
  created_at TEXT NOT NULL, expires_at TEXT
);
CREATE INDEX idx_entitlements_project ON entitlements(project_id);
CREATE TABLE ai_requests (
  id TEXT PRIMARY KEY, entitlement_id TEXT NOT NULL, created_at TEXT NOT NULL, model TEXT,
  input_tokens INTEGER, output_tokens INTEGER, cache_write_tokens INTEGER, cache_read_tokens INTEGER,
  cost_usd_micros INTEGER, credits INTEGER, ops_count INTEGER, latency_ms INTEGER, status TEXT
);
CREATE TABLE spend (period TEXT PRIMARY KEY, cost_usd_micros INTEGER NOT NULL DEFAULT 0); -- 'd:2026-10-14', 'm:2026-10'
CREATE TABLE webhook_events (id TEXT PRIMARY KEY, type TEXT, received_at TEXT);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, window_start INTEGER, count INTEGER);
```

### 11.4 Stripe flow

1. The Unlock button calls `POST /api/checkout`. The server creates a Checkout Session through the Stripe REST API: mode `payment`, currency `aud`, the Plan Pack price (`STRIPE_PRICE_ID`, or inline price data of 3000 cents), `metadata.projectId`, `client_reference_id = projectId`, success URL `<APP_URL>?checkout=success&session_id={CHECKOUT_SESSION_ID}&project=<projectId>` and cancel URL `<APP_URL>?checkout=cancel`.
2. The webhook verifies the `Stripe-Signature` header (HMAC-SHA256 of `timestamp.body` with `STRIPE_WEBHOOK_SECRET`, 300 s tolerance), records the event ID for idempotency, and on `checkout.session.completed` with `payment_status = paid` creates the entitlement. `charge.refunded` sets the entitlement to `refunded`.
3. On return, the app calls `GET /api/entitlement` with the session ID and stores the token in `localStorage` (`ps.ent.<projectId>`). If the webhook has not arrived yet, it retries for up to 30 s.
4. Receipts are sent by Stripe. Enable "Successful payments" emails in the Stripe dashboard and show GST on receipts if registered.

### 11.5 Entitlement token

- Compact signed token `base64url(payload).base64url(HMAC-SHA256(payload, ENTITLEMENT_SECRET))`, payload `{ eid, pid, exp }`.
- The server re-checks the database on every request (status, expiry, credits). The token alone grants nothing.

### 11.6 Configuration

| Variable | Default | Purpose |
|---|---|---|
| `SITE_URL` | | Site origin, used for CORS and embed allowlist |
| `APP_URL` | `<SITE_URL>/floor-plan-designer/app/` | Return URL after checkout |
| `ANTHROPIC_API_KEY` | | Secret |
| `ANTHROPIC_MODEL` | `claude-haiku-5-5` | Cheapest current Claude model |
| `PRICE_IN_PER_MTOK_USD` | `0.10` | Haiku 5.5 input price |
| `PRICE_OUT_PER_MTOK_USD` | `0.50` | Haiku 5.5 output price |
| `AI_MAX_OUTPUT_TOKENS` | `1500` | Per request |
| `AI_MAX_CONTEXT_TOKENS` | `40000` | Context cap |
| `CREDIT_USD` | `0.001` | Value of one credit |
| `PLAN_PACK_CREDITS` | `500` | Allowance per Plan Pack |
| `WARN_THRESHOLDS` | `0.5,0.8,0.95` | Warning points |
| `LARGE_REQUEST_CREDITS` | `10` | Confirmation threshold |
| `AI_RATE_PER_MIN` / `AI_RATE_PER_DAY` | `6` / `150` | Per project |
| `AI_DAILY_CAP_USD` / `AI_MONTHLY_CAP_USD` | `5` / `50` | Global circuit breakers |
| `FX_AUD_PER_USD` | `1.67` | Conservative conversion for reporting |
| `STRIPE_SECRET_KEY` | | Secret (test key until approved) |
| `STRIPE_WEBHOOK_SECRET` | | Secret |
| `STRIPE_PRICE_ID` | | Plan Pack price, A$30 |
| `PLAN_PACK_PRICE_CENTS` | `3000` | Used if no price ID |
| `ENTITLEMENT_SECRET` | | Secret for tokens |
| `ENTITLEMENT_DAYS` | `365` | Re-export window |
| `EXPORT_MAX_PROJECT_BYTES` | `2000000` | Request size limit |

### 11.7 Security

- Secrets only in the platform's secret store. Never in the repository or the client.
- CORS limited to `SITE_URL`. JSON body size limits on every endpoint.
- Validate the project JSON with `validate()` before export or AI use.
- Log no card data (Stripe hosts the payment page). Log no plan content beyond 30 days.

---

## 12. Website changes

### 12.1 Step 0: inspect the repository

Record in `docs/INTEGRATION_NOTES.md`:

- Framework and build (static HTML, Astro, Next.js, other), routing, styling system, hosting platform and how functions or APIs are deployed.
- Existing navigation, footer, analytics, consent banner, CSP and security headers, sitemap generation, brand tokens (colours, fonts, logo files).
- Whether the site is a single-page site with sections. If it is, keep the main page single and add the tool as its own application route (12.2). The application route is software, not a content page.

### 12.2 Placement

- Application route: `/floor-plan-designer/app/` (full screen, no site header, its own minimal top bar with a link back to the site). Serve the `plan-studio` package here.
- Landing: either a dedicated page `/floor-plan-designer/` or, on a single-page site, a new section with the anchor `#floor-plan-designer`, plus the same content on the app route's start screen for search engines.
- Legal: `/floor-plan-designer/terms/` (tool terms and Plan Pack terms) and an addition to the existing privacy policy.

### 12.3 Landing content

Plain, professional wording. No AI hype.

1. Hero: heading "Design your home, granny flat or shed in 3D", one line of support copy, buttons "Start designing free" and "See what the Plan Pack includes". A live teaser of the tool loads only when the visitor clicks "Try it here" (lazy iframe in demo mode).
2. How it works: draw rooms like a game; see it in 3D and walk through; furnish and pick finishes; export with a Plan Pack.
3. What you can design: houses (single and double storey), granny flats and units, sheds, extensions, decks and rainwater tanks.
4. Free versus Plan Pack comparison table (from section 4).
5. Pricing card: Plan Pack A$30 per project, what is included, the credit allowance explained in one line.
6. FAQ: Are these plans approved? (No, concept only.) Can I lodge them with council? (No, a designer or certifier must prepare DA or CDC documentation.) Do I need an account? What is an AI credit? What happens when credits run out? Can I get engineering? Refunds?
7. Disclaimer block (section 13).
8. Cross-sell: "Need engineering for your design?" and "Want a cinematic fly-through?" with configurable links.

### 12.4 Navigation and footer

- Add "Plan Designer" (final label per decision 17.2) to the main navigation and footer, pointing to the landing page or section.
- Add a call-to-action tile on the home page if one exists for services.

### 12.5 Loading and performance

- The landing page must not load three.js or the app until the visitor interacts.
- The teaser iframe uses `loading="lazy"`, a poster image and a fixed aspect ratio box to avoid layout shift.
- Targets: landing page Lighthouse performance 90 or better on mobile; app interactive within 3 s on a mid-range laptop on 4G.

### 12.6 SEO

- Title and description for the landing page, Open Graph image (a 3D screenshot), canonical URL.
- Structured data: `SoftwareApplication` (applicationCategory DesignApplication, operatingSystem Web, offers price 30 AUD) and `FAQPage` for the FAQ.
- Add the landing URL to the sitemap; keep the app route `noindex`.
- Keywords to cover naturally: floor plan designer, house plan maker, granny flat floor plan, shed design tool, home extension planner, 3D house walkthrough, rainwater tank placement.

### 12.7 Analytics events

`ps_open`, `ps_template_selected`, `ps_view_3d`, `ps_walk_start`, `ps_project_saved`, `ps_upgrade_click`, `ps_checkout_started`, `ps_checkout_completed`, `ps_ai_request`, `ps_ai_credits_warning`, `ps_ai_credits_exhausted`, `ps_export` (with type), `ps_crosssell_click`. Send through the site's existing analytics and consent mechanism; none before consent where consent is required.

### 12.8 Headers and CSP

- App route: `script-src 'self'` (plus the CDN only while the prototype import map is in use), `connect-src 'self'`, `img-src 'self' data: blob:`, `worker-src 'self' blob:`, `frame-ancestors 'self'`.
- Checkout redirects to `checkout.stripe.com`; no Stripe script is required for hosted Checkout.

### 12.9 Accessibility and responsive behaviour

- Toolbar buttons are real buttons with labels and visible focus states; full keyboard use in the 2D editor; colour contrast AA; respect `prefers-reduced-motion` for camera animations.
- Below 900 px wide: toolbox becomes a bottom bar, properties become a bottom sheet, the 3D view is the default on phones. The landing page notes that the editor works best on a desktop or tablet.

### 12.10 Brand configuration

A single file `plan-studio/brand.config.js` (or the site's equivalent) holds: product name, seller legal name and ABN, logo path, `--ps-*` colour tokens, fonts, support email, engineering enquiry URL, fly-through URL, terms URL and privacy URL.

---

## 13. Legal and risk

- Disclaimer on the landing page, in the app footer, on every exported sheet and in the terms: "Plan Studio produces concept designs only. They are not construction drawings, not development application or complying development documentation, and have not been checked against planning controls, the National Construction Code, BASIX or any standard. Engage a qualified designer, engineer or certifier before building."
- Terms of use: licence to use the tool; ownership of user designs stays with the user; Plan Pack is a digital service per project; credits have no cash value and expire with the Plan Pack; fair use.
- Refunds: comply with the Australian Consumer Law guarantees for digital services. State a simple policy (for example, refund on request within 14 days if no paid export has been downloaded) and handle major failures as the law requires.
- Privacy: plans and AI prompts are processed by Anthropic to provide the AI feature; payments are processed by Stripe; state retention (AI logs 30 days, entitlements kept for tax records).
- GST: if the seller is registered, prices include GST and Stripe receipts show it.
- Trading entity: decide which entity sells the Plan Pack (decision 17.1).
- Trademarks: use generic colour names in the interface (aliases are for matching only). Do not use the reference product's name or branding.

---

## 14. Non-functional requirements

- Browsers: latest two versions of Chrome, Edge, Safari and Firefox; WebGL2 required for 3D (2D works without it, with a notice).
- Project JSON limit 2 MB (underlay images excluded). Autosave failures shown as a warning, never silent.
- Server: p95 under 300 ms for non-AI endpoints; AI endpoint timeout 30 s with a friendly retry message.
- Monitoring: error logging for the app (console errors posted to `/api/log` in production, rate limited) and the server; daily summary of AI spend available to Jayden on request.
- Backups: daily D1 export (or the platform equivalent) of entitlements and request logs.

---

## 15. Delivery phases and task list

### Phase 1: free tool live

1. Step 0 inspection and `INTEGRATION_NOTES.md`.
2. Copy the `plan-studio` package into the repository; serve it at the app route; self-host three.js.
3. Apply brand tokens; add the landing section or page, navigation, footer, SEO, analytics and the disclaimer.
4. Premium controls show the locked state with "Coming soon" until Phase 2 is live (configuration flag `PREMIUM_ENABLED=false`).
5. Acceptance tests 16.1 to 16.6.

### Phase 2: payments and exports

1. Deploy the server (Workers and D1, or the platform equivalent); create the database tables.
2. Stripe test mode: product "Plan Pack", price A$30; webhook endpoint; Checkout flow; entitlement token; restore purchase.
3. Server-side PDF, DXF, GLB and OBJ exports behind entitlement.
4. Terms page and privacy update.
5. Acceptance tests 16.7 to 16.10.

### Phase 3: AI assistant and credits

1. AI endpoints, tool generation from the operations registry, compact context, system prompt.
2. Credit ledger with reservation, warnings, pre-flight confirmation, hard stop, global caps and rate limits.
3. Acceptance tests 16.11 to 16.15.

### Phase 4: launch and polish

1. Jayden approves live Stripe keys and the final price display.
2. Optional: accounts and cloud save, top-ups, USDZ, straight skeleton roofs, walking stairs, connected roof area yield estimate for tanks.

---

## 16. Acceptance tests

1. A visitor can open the app, pick each template and see a correct 2D plan and 3D model with no console errors.
2. Rooms, walls, doors, windows, furniture, stairs, decks and tanks can be added, moved, edited and deleted; undo and redo work across 100 steps.
3. Walk mode works with keyboard and mouse on desktop and with the joystick on a tablet; walls block movement and doorways do not.
4. Finish picker changes roof, wall, frame and floor finishes, and the change survives a reload.
5. Extension mode: tracing underlay calibrates to within 1% over 10 m; existing, new and demolish display correctly in 2D and 3D.
6. Landing page loads no three.js until interaction; Lighthouse mobile performance 90 or better.
7. Locked exports cannot be produced from the free build: export endpoints return `NOT_ENTITLED` without a valid token, and no client code path produces the files in production.
8. Stripe test payment of A$30 creates an entitlement; a repeated webhook does not create a duplicate; a refund marks it refunded and exports stop.
9. PDF opens in Acrobat with correct scale (a 10,000 mm wall measures 100 mm on paper at 1:100); DXF opens in AutoCAD and a 10,000 mm wall measures 10000; GLB opens in Blender at the correct size.
10. Restore purchase returns access on a second browser.
11. "Make the roof dark grey" changes the roof colour as one undo step and charges 1 to 3 credits.
12. Warnings appear at 50%, 80% and 95% of the allowance (test with `PLAN_PACK_CREDITS=20`).
13. At the allowance the server refuses further AI requests (402) and the panel is read-only while manual editing still works.
14. A request estimated above 10 credits asks for confirmation first.
15. With `AI_DAILY_CAP_USD` set very low, AI pauses for all projects (503) and logs the event.

---

## 17. Open decisions for Jayden

| No. | Decision | Recommendation |
|---|---|---|
| 17.1 | Which website hosts the tool, and which entity sells the Plan Pack | Brand fit favours Glide Inside (3D homes for builders and owners). Liability containment favours selling through JCE Infrastructure Pty Ltd, since Glide Inside currently trades under the sole trader ABN. Option: host on Glide Inside and contract as the Pty Ltd, or move Glide Inside into the Pty Ltd first. The JCE site would take a teaser section and link. |
| 17.2 | Product name, nav label and route | Working name Plan Studio; route `/floor-plan-designer/` for search value. |
| 17.3 | GST registration of the selling entity | Display "A$30 incl. GST" if registered. |
| 17.4 | Plan Pack terms | Per project, 500 credits, 12 months re-export, no top-ups at launch. |
| 17.5 | Accounts | No accounts at launch (token plus restore). Accounts need login emails, so defer. |
| 17.6 | Free tier limits | No limits except AI and exports. |
| 17.7 | Colour naming | Generic display names with aliases for matching. |
| 17.8 | Hosting for the API | Use the site's current host if it runs functions; otherwise Cloudflare Workers and D1. |
| 17.9 | Refund wording | 14 days if no paid export downloaded, plus Australian Consumer Law rights. |
| 17.10 | DXF layer names | Plan Studio defaults now; map to JCE-STD-CAD-001 later if wanted. |

---

## 18. Build status

To be updated by each build wave. See the end of this file.

---

## Appendix A: Operations registry (editor, templates and AI tools)

| Operation | Purpose | Key arguments |
|---|---|---|
| `add_room` | Rectangular room, walls created on uncovered edges | `level, name, type, x, y, width, depth, walls` |
| `add_room_polygon` | Polygon room | `level, name, type, points, walls` |
| `update_room` | Rename, retype, floor finish, deck flags | `id, name, type, floor_material, floor_colour, roofed, balustrade` |
| `resize_room` | Push or pull one side of a room; walls on that side move, connected walls stretch | `id, side (north, south, east, west), delta (positive grows)` |
| `add_wall` | Single wall | `level, x1, y1, x2, y2, thickness, status` |
| `update_wall` | Thickness, height, status, finish override | `id, thickness, height, status, finish_material, finish_colour` |
| `move_wall` | Move a wall; points lying on it move with it | `id, dx, dy` |
| `add_opening` | Door, window, garage or roller door, plain opening | `level, wall or (x, y), kind, width, height, sill, offset, style, hinge, side` |
| `update_opening` | Edit an opening | `id, width, height, sill, offset, style, hinge, side` |
| `add_furniture` | Place a catalogue item | `level, item, x, y or room, rotation` |
| `update_furniture` | Move, rotate, resize | `id, x, y, rotation, w, d` |
| `move` | Move furniture, tank, stair, opening (along its wall) or wall-less room | `id, dx, dy` |
| `delete` | Delete any element; deleting a room removes walls that bound only that room | `id` |
| `set_finish` | Project finishes | `target (external_walls, internal_walls, roof, fascia, frames, floors), material, colour` |
| `set_roof` | Roof for a level | `level, type, pitch, overhang, enabled` |
| `add_tank` / `update_tank` | Rainwater tank | `x, y, capacity_l, colour` |
| `mirror_plan` | Flip the whole design | `axis (left_right, top_bottom)` |
| `add_level` / `update_level` | Levels | `name, copy_outline` / `id, name, ceiling_height, elevation` |
| `add_stair` | Stairs | `level, x, y, width, length, rotation` |
| `set_status` | Extension status | `ids, status (existing, new, demolish)` |
| `set_project` | Project name and type | `name, type` |

## Appendix B: DXF layers

| Layer | Content | Colour (ACI) | Linetype |
|---|---|---|---|
| `PS-WALL-NEW` | New walls | 7 | CONTINUOUS |
| `PS-WALL-EXIST` | Existing walls | 8 | CONTINUOUS |
| `PS-WALL-DEMO` | Walls to be demolished | 1 | DASHED |
| `PS-DOOR` | Door leaves and swings | 3 | CONTINUOUS |
| `PS-WIN` | Windows | 4 | CONTINUOUS |
| `PS-ROOM` | Room outlines | 9 | CONTINUOUS |
| `PS-TEXT` | Room names and areas, titles | 2 | CONTINUOUS |
| `PS-DIM` | Dimension lines and text | 6 | CONTINUOUS |
| `PS-FURN` | Furniture | 8 | CONTINUOUS |
| `PS-STAIR` | Stairs | 5 | CONTINUOUS |
| `PS-SITE` | Tanks and decks | 30 | CONTINUOUS |
| `PS-ROOF` | Roof outline at eaves | 1 | DASHED |
| `PS-ANNO` | Notes, north arrow, level titles | 7 | CONTINUOUS |

## Appendix C: Default dimensions (typical Australian practice, editable)

- Walls: external 250 mm (brick veneer), internal 100 mm, shed 100 mm
- Ceiling height 2,550 mm; floor to floor 3,000 mm
- Doors: internal 820 × 2,040; entry 870 × 2,040; sliding 2,100, 2,400 or 3,000 × 2,100; garage 2,400 or 4,800 × 2,100; shed roller 3,000 × 3,000; personal access door 820 × 2,040
- Windows: head height 2,100 mm; default 1,800 × 1,200 at sill 900; bathroom 1,200 × 600 at sill 1,500; kitchen 1,800 × 900 at sill 1,200
- Roofs: houses hip 22.5 degrees with 450 mm eaves; sheds gable 11 degrees with 150 mm overhang; skillion 5 degrees
- Tanks (round): 2,000 L at Ø1,350 × 1,600; 5,000 L at Ø1,850 × 2,000; 10,000 L at Ø2,400 × 2,400; 22,500 L at Ø3,600 × 2,400
- Walk mode: eye height 1,650 mm; walk 1.4 m/s; run 3.0 m/s

---

## Build status log

### 14/10/2026, wave 1 (complete)

- Core model, operations registry (24 operations) and store with undo: done, tested.
- 2D editor and app shell: all SCOPE 5.2 tools, schedules, extension mode, tracing underlay, embed API, light and dark themes, phone layout. Fit to view is Shift+F (F is Furniture).
- 3D viewer: walls with openings, floors, hip, gable, skillion and flat roofs, decks, tanks, stairs, furniture, finish picker, level cutaway, status views, first person walk with collision and touch controls.
- Catalogue: 45 furniture items, finish palettes with alias matching, opening presets, tanks, 8 templates (blank, workshop shed, farm shed, granny flat, single storey, double storey, duplex, extension starter).
- Premium: upgrade flow, AI panel with credit meter, warnings, confirmation and hard stop; DXF R12, PDF A3 and GLB/OBJ exporters; Cloudflare Worker with Stripe Checkout, webhook verification, entitlement tokens, Anthropic proxy with credit reservation, global caps and rate limits. CONFIG.premiumEnabled is false.
- Tests: 141 passing (node --test tests/*.test.mjs). Integrated headless smoke test clean apart from blocked web fonts in the sandbox.
- Not yet verified: Worker on the Cloudflare runtime, live Stripe test mode, live Anthropic calls, real-GPU frame rate and pointer lock, GLB textures from the server export.
- Requested core additions: update_stair operation; operations for site.northDeg and site.underlay (currently direct store.apply).
