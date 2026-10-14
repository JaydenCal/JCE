# JCE Site Planner: system and build brief for the website design session

| Item | Detail |
|---|---|
| Prepared | 14/10/2026 |
| Prepared for | The Claude Code session that will design the website |
| Owner | Jayden Callen, Director, JCE Infrastructure Pty Ltd |
| Repository | `jaydencal/jce`, branch `claude/peaceful-wright-d7itnp`, folder `cadastral-platform/` |
| Read with | `docs/03-decisions.md` (17 numbered decisions), `docs/09-handover.md` (build history), `docs/01-orchestration-topology.md` (agent topology) |
| Status of facts | Checked against the working copy on 14/10/2026 unless marked "not verified" |

## 1. Purpose and how to use this brief

This brief describes the platform so that the website can be designed against what exists, not against assumptions. It records what the system does, what it produces, what the API offers today, what the current frontend mocks, and what is missing.

How the content is organised:

- Sections 2 to 9 and 11 to 16 are statements of fact about the codebase.
- Section 6 also proposes endpoints that do not exist yet.
- Section 10 is a proposal for the information architecture and page specifications. The website session is expected to refine it.
- Section 17 lists decisions that only Jayden can make. Where a design depends on one, state the dependency and proceed with the stated default.

The website is a front end for a backend that is still being completed. Build against the contract in section 6, keep the mock fallback that already exists in `frontend/src/lib/api.ts`, and do not assume that an endpoint marked "missing" is available.

Scope boundary: this brief covers the website (public pages, the authenticated application and the 3D viewer shell). It does not ask the website session to change agent logic, drawing output or report content.

## 2. The product

### 2.1 What it does

JCE Site Planner takes a lot in New South Wales (Queensland partly) and a proposed development, then produces civil plans and development application material. The positioning, recorded as decision 16, is "the full package: civil plans and DA/CDC applications".

For one lot and one proposal the platform produces:

- Lot, boundary, road, easement, zoning and overlay information from public NSW services.
- A constraints screening (flood, bushfire, heritage and other layers) explained in plain English.
- Planning and engineering requirements read from cited council documents. Each value carries its source document, version, page and quote.
- A driveway and crossover check, earthworks (cut and fill), stormwater, rainwater tank sizing and water and sewer connection layouts.
- A multi-sheet civil plan set in PDF and DXF.
- An erosion and sediment control plan.
- A site report in PDF.
- An approval pathway determination (exempt development, complying development certificate or development application), a compliance table and a draft Statement of Environmental Effects.
- An application pack (zip) assembled for lodgement through the NSW Planning Portal.
- A 3D model of the site that can be orbited and walked through, with store items that can be placed in it.

Development types: dwelling house, secondary dwelling (granny flat) and shed or outbuilding (Class 10a). Dual occupancy is selectable but is a stub; it returns its requirements as unresolved.

### 2.2 What it is not

- It certifies nothing. Every output is an indicative draft for a qualified person (registered surveyor, engineer, planner) to check.
- It is not a survey, a structural or geotechnical design, a BASIX certificate or a flood certificate.
- It does not lodge applications for the user.
- It does not hold a live database of buried services. Asset owners answer each Dial Before You Dig enquiry and the user uploads the responses (decision 2).

### 2.3 Audience

No persona or user research document exists. The decisions log implies these audiences:

- People preparing a DA or CDC for a dwelling, secondary dwelling or shed (owners, designers, builders).
- JCE Infrastructure engineers, who receive "Talk to a civil engineer" enquiries (decision 15).
- Customers outside NSW and Queensland who use the custom municipality mode (decision 14, in development).

The primary audience and journey are open decisions (section 17, item 1).

## 3. Rules the website must respect

These rules come from the decisions log and the handover. They are product rules, not style preferences.

| # | Rule | Consequence for the website |
|---|---|---|
| 1 | No hard-coded requirement values | Every requirement shown is cited (document, version, page, quote) or shown as UNRESOLVED. The website never displays a planning or engineering number that has no source. |
| 2 | Never invent data | Levels, services, flood levels and rules appear only when sourced. Missing data is shown as missing and is never estimated for display. |
| 3 | Indicative drafts only | No surface says certified, approved, compliant or checked unless a person did so outside the platform. Every output surface carries a visible "indicative draft" status. |
| 4 | "Not checked" never means "clear" | A layer that could not be queried has its own state and treatment. It never receives a green tick or the wording "no issues". |
| 5 | UNRESOLVED is a first-class state | It has a defined appearance, the reason it is unresolved, and the next step (enter a value, upload a document, ask an engineer). |
| 6 | Legal gate first | Terms are accepted before any project route. Nine acknowledgements are recorded before export outputs are released (section 12). |
| 7 | Provenance is reachable | Every result links to its source and shows the data date. The cached imagery for the Lot 2 sample carries a capture date of 18/10/2011, so dates must be visible. |
| 8 | Australian-region hosting | Decision 4. Any third-party service chosen for the website (authentication, analytics, map tiles, email) must be assessed against this. |
| 9 | Professional validation is stated | The site says that a registered surveyor, engineer and planner must check outputs on real jobs. |

## 4. System architecture

### 4.1 Overview

Browser (Next.js 14, App Router) calls the API (FastAPI). The API starts runs on the orchestrator, which executes the agents in a dependency graph. State is held in PostgreSQL 16 with PostGIS and pgvector. Output files are written to disk; there is no object store yet.

Principles:

- Deterministic code first. A language model is used only in SA2 (reading council documents), SA7 (aligning an uploaded PDF), SA8 and the Design Assistant (layout edits) and the optional, guarded SoEE drafting.
- Payloads between agents pass by reference with a sha256 hash. Runs carry idempotency keys and a token ledger with a budget.
- A citation validator checks that each quoted requirement exists on its source page and that numbers appear in the quote.
- An export gate holds outputs back until the acknowledgements are recorded.

### 4.2 Agents

| ID | Name | Job | In the API run graph | Uses an LLM |
|---|---|---|---|---|
| SA1 | Cadastre and zoning | Lot, boundary segments, roads, easements, zones and overlays from NSW services | Yes (stage A) | No |
| SA7 | PDF aligner | Ingests an architect PDF and aligns it to the lot | Yes (stage A, only when a plan is uploaded) | Yes |
| SA2 | DCP retrieval | Reads council documents and returns setback rules with citations | Yes (stage B) | Yes |
| ENV | Envelope builder (inside SA3) | Building envelope from the resolved setbacks | Yes (stage C) | No |
| SA3 | Geometry, terrain and driveway | Terrain TIN, cut and fill, retaining walls, crossover and driveway checks, flood floor level | Yes (stage D) | No |
| SA4 | Hydraulics and services | Dial Before You Dig parsing, conflicts, rainwater tank sizing, connections | Yes (stage E) | No |
| SA5 | CAD export | DXF and PDF. One sheet through the run graph; the 12-sheet plan set through the `planset/` package | Yes (stage F, export gate) | No |
| SA6 | 3D scene | Scene bundle for the viewer | Yes (stage F, export gate) | No |
| SA8 | Layout model and Design Assistant | Parametric building model, 25 typed edit operations, natural-language edits | No (design API) | Yes |
| SA9 | Constraints | Screening against 18 NSW layer types, including buffer-type layers | No (command-line runner only) | No |
| SA10 | Erosion and sediment control | ESC plan | No (command-line runner only) | No |
| SA11 | Pathway and application pack | Pathway, compliance table, draft SoEE, pack zip | No (command-line runner only) | Optional and guarded |

### 4.3 The run graph

Stages A to F, in order:

- A: SA1 lot context, and SA7 when a plan is uploaded.
- B: SA2 rules.
- C: ENV envelope.
- D: SA3 terrain, cut and fill, walls, crossover.
- E: SA4 services, conflicts, rainwater tank.
- F: SA5 CAD export and SA6 3D scene, both behind the export gate.

### 4.4 Important gap: an API run does not yet produce everything

The orchestrator and the API do not reference SA9, SA10, SA11, the 12-sheet plan set, the site report or the pack (searched on 14/10/2026). Those outputs are produced today only by the command-line runner `backend/scripts/run_site.py`.

The website therefore cannot obtain the constraints report, ESC plan, plan set, site report, pathway or application pack through the API until the backend wraps them into the orchestrated run. This is a backend task that the website depends on (section 6.5, first P0 item).

### 4.5 Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11 or later, FastAPI, pydantic |
| Database | PostgreSQL 16, PostGIS, pgvector (embedding dimension 1536, decision 3) |
| Geometry and drawing | shapely, pyproj, scipy, ezdxf (DXF R2018 with paper-space layouts and viewports), reportlab (PDF), pdfplumber, pymupdf, opencv |
| Frontend | Next.js 14.2.15, React 18.3.1, TypeScript 5.5.4, Tailwind 3.4.10, three.js 0.160.1, vitest 2.0.5 |
| Language model | Anthropic API, only in the places listed in 4.1; never called in tests |

## 5. What a run produces

| Artefact | Files | Producer | Available through the API today | Notes |
|---|---|---|---|---|
| Single-sheet plan | `plan.pdf`, `plan.dxf` | SA5 | Produced by the run graph; no download route | Older style, superseded by the plan set |
| Civil plan set | `planset.pdf`, `planset.dxf` | `planset/` package | No (runner only) | 12 sheets: C000 cover, index and locality; C100 existing site conditions; C101 proposed site; C200 earthworks; C300 stormwater; C310 water and sewer; C400 driveway and crossover plan; C410 driveway long section; C420 crossover details; C500 erosion and sediment control; C600 typical sections and details; C700 general notes |
| ESC plan | `escp_<lot>.pdf`, `.dxf`, `.geojson`, `_report.md`, `_scene_parts.json` | SA10 | No (runner only) | Cites the Blue Book and the 2024 Building Sites guidelines |
| Site report | `site_report.pdf`, `site_report.json` | `app/report/` | No (runner only) | A4, 16 to 17 pages today: cover, executive summary, zoning, constraint pages, cited requirements, civil page, appendix |
| Constraints report | `constraints_report.pdf`, `constraints_report.json`, `constraints.geojson` | SA9 | No (runner only) | GeoJSON is suitable for map overlays |
| 3D scene bundle | `scene_bundle.json` | SA6 | Produced by the run graph; no download route | Format in section 11 |
| Application pack | zip containing a numbered index, cover sheet, checklist, cited Planning Portal guidance, `manifest.json` (sha256 per file), `pack.json` (data for the UI), and the SoEE as DOCX and PDF with a DRAFT watermark | `app/pack/` | No (runner and samples only) | SoEE lines that cannot be known are marked TO BE COMPLETED |
| Run records | `run_steps.json`, `run_summary.md` | Runner | `GET /runs/{id}` returns the invocations | |

Notes for the website:

- The plan set is being restyled to match Jayden's reference sheet JCE-004-CV-1100 (56 Inglis Street, Mudgee): A1 landscape, zone grid references, boxed call-outs, named hatch patterns, proper crossovers. Do not copy the look of the current A3 sheets into the web design. Use real output once the restyle is delivered.
- No page-image or thumbnail route exists. The website needs page previews of PDFs (server-side with PyMuPDF, or client-side with pdf.js).
- Sheet status text reads "PRELIMINARY: NOT FOR CONSTRUCTION". The CHECKED and APPROVED fields on sheets are left blank on purpose. The website must never imply that they are signed.

## 6. The API: what exists and what is missing

### 6.1 Conventions

- Application: `create_app(settings, pool, orchestrator)` in `backend/app/api/app.py`. No Makefile or requirements file exists; dependencies are in `backend/pyproject.toml`. No documented production start command exists.
- Authentication is a development stub: the `X-User-Id` header (`deps.current_user_id`). Dependencies `require_terms` and `require_project` exist.
- Errors are JSON: `{code, message, ...extra}`.

| Status | Code | Meaning |
|---|---|---|
| 403 | `TERMS_NOT_ACCEPTED` | Terms not accepted; the client redirects to `/legal/terms` |
| 403 | gate code, with a `missing` list | Export gate: acknowledgements are missing |
| 404 | `RUN_NOT_FOUND` | Unknown run |
| 409 | `INVALID_RUN_STATE` | For example cancelling a finished run |

### 6.2 Endpoints that exist

| Method and path | Purpose | Notes |
|---|---|---|
| `GET /legal/terms/current` | Current Terms version | Returns `terms_version_id`, `version_label`, `effective_from`, `body_markdown`, `body_sha256`, `accepted` |
| `POST /legal/accept` | Record acceptance | Body: `terms_version_id`, `body_sha256`, `scrolled_to_end`. Returns 201 |
| `POST /runs` | Start a run | Returns 202. Body in 6.3 |
| `GET /runs/{run_id}` | Run detail | Shape in 6.3 |
| `POST /runs/{run_id}/cancel` | Cancel a run | 409 when the state does not allow it |
| `POST /projects/{project_id}/plans` | Upload an architect PDF | Multipart: `file`, `upload_rights_warranty`, `development_type`. Returns 201 with `upload_id`, `run_id`, `page_count`. The PDF is checked for type, size, magic bytes, parseability and active content. The size limit is a setting (`max_bytes`) |
| `POST /projects/{project_id}/acknowledgements` | Record acknowledgements | Body: `kinds[]`. Returns 201 with `recorded` and `export_gate_missing[]` |
| `GET /catalogue` | Store item catalogue | |
| `POST /catalogue/import` | Import a store item by URL | Limited by `DESIGN_RETAILER_ALLOWLIST` |
| `GET` and `POST /projects/{id}/items` | List and place items | |
| `PATCH` and `DELETE /projects/{id}/items/{item_id}` | Move, rotate, remove | |
| `GET /projects/{id}/shopping-list` | Totals for placed items | Prices are "as at" the capture time |
| `GET /projects/{id}/design/model` | Parametric building model | |
| `POST /projects/{id}/design/assistant` | Natural-language edit | Body: `message` (at most 2000 characters), `selected_element_id`, `history_token`. Needs `ANTHROPIC_API_KEY`. Never called against the real API so far |
| `POST /projects/{id}/design/undo` and `/redo` | History | |
| `POST /enquiries` | "Talk to a civil engineer" | Returns 201. Rate limited per IP per hour. Fields in 6.4 |
| `POST /enquiries/retry` | Retry route | Purpose and access control not verified in this brief |
| `GET /enquiries/{reference}/attachments/{index}` | Enquiry attachment | Protected by a partner token |

### 6.3 Runs

`POST /runs` body (`extra` fields are rejected):

| Field | Type | Default |
|---|---|---|
| `project_id` | UUID | required |
| `params` | object, handed to SA1 (lot identifier, jurisdiction) | `{}` |
| `upload_id` | UUID, adds SA7 | none |
| `targets` | list of node IDs, restricts the run (with required ancestors) | all |
| `token_budget` | integer greater than 0 | none |
| `drawing_scale_denominator` | integer | 100 |
| `export_formats` | list | `["dxf", "pdf"]` |
| `project_title` | string | none |
| `development_type` | `dwelling_house`, `secondary_dwelling`, `shed`, `dual_occupancy` | `dwelling_house` |

Run status values: `queued`, `running`, `waiting_user`, `succeeded`, `failed`, `cancelled`, `blocked_by_gate`.

`GET /runs/{id}` returns `run_id`, `project_id`, `status`, `tokens_used`, `invocations[]` (`invocation_id`, `agent`, `attempt`, `status`, `error_code`, `error_detail`) and `plan[]`. The frontend type also expects an `alignment` object from SA7 (scale used and its source, confidence, RMSE, residual, reflection flag, outcome of `accepted_unverified`, `needs_user_confirmation` or `refused`, and messages); the orchestrator is documented to surface it but this is not verified.

A lot is identified in NSW form as lot, section and plan, for example `2//DP227508`.

### 6.4 Enquiry fields

`name`, `email`, `phone`, `company`, `role`, `enquiry_types`, `message`, `address`, `lot_plan`, `preferred_contact`, `timeframe`, `project_id`, `share_context`, `consent`, `consent_version`. Delivery uses SMTP or a webhook, configured by `ENQUIRY_TO` and related settings. The privacy policy page is a placeholder.

### 6.5 Gaps and proposed contract

Priority: P0 is needed for the core journey, P1 for a credible launch, P2 later. These are proposals. They are backend work, to be sequenced with Jayden.

| Priority | Proposed endpoint or change | Purpose |
|---|---|---|
| P0 | Real authentication replacing `X-User-Id` | Sign in, sessions, per-user data. Provider is an open decision (section 17) |
| P0 | `POST /projects`, `GET /projects`, `GET /projects/{id}`, `PATCH /projects/{id}`, `DELETE /projects/{id}` | Project records. The client already calls `GET /projects` and falls back to mock data on 404 |
| P0 | `GET /lots/search?q=` and `GET /lots/{lotplan}` | Address or lot and plan lookup with boundary geometry and basic facts for the confirm step. Backed by SA1 (NSW_Property layers 1 to 4 and NSW_Cadastre layer 9, verified live on 12/10/2026) |
| P0 | Wrap SA9, SA10, SA11, the plan set, the site report and the pack into the orchestrated run | Without this the API cannot produce most outputs (section 4.4) |
| P0 | `GET /projects/{id}/results` | The summary behind the workspace. The client type `ProjectResults` exists (lot, setbacks, driveway, services, rainwater tank) and is extended in section 10 |
| P0 | `GET /projects/{id}/artifacts` and `GET /artifacts/{id}/download` | File registry and gated download (all nine acknowledgements recorded). Replaces the documented `POST /projects/{id}/export`, which the client mocks today |
| P0 | `GET /projects/{id}/scene` | Scene bundle for the viewer |
| P1 | `GET /projects/{id}/constraints`, `/requirements`, `/pathway`, `/compliance`, `/soee` | Structured data for the web views, not only PDFs |
| P1 | `GET /artifacts/{id}/pages/{n}.png` | Page images for previews and sheet browsing |
| P1 | `GET /runs/{id}/events` (server-sent events) and `GET /projects/{id}/runs` | Live progress and run history. Polling `GET /runs/{id}` every 2 seconds is acceptable until then |
| P1 | A route to upload Dial Before You Dig response PDFs, and a route to enter a user-confirmed requirement value | Resolving UNRESOLVED items |
| P1 | A route to upload survey data (DXF, LandXML, CSV, LAS) | Overrides public terrain data (decision 17). Ingest code exists in `sa3_terrain/ingest.py`; no route does |
| P1 | Custom municipality routes: profile, documents, parcel, requirement entry | Code exists in `backend/app/jurisdiction/`; no routes do |
| P2 | Billing, plan limits, organisations and members, account export and deletion | Not designed |
| P2 | An inbox for enquiries | Enquiries are emailed or sent to a webhook only |

## 7. Data model

SQL scripts are in `db/001` to `db/006`. Scripts 001 to 004 were loaded and smoke-tested on a scratch PostgreSQL; 005 and 006 were not loaded. Row-level security is used.

| Schema | Tables |
|---|---|
| `core` | `mga_zones`, `organisations`, `users`, `projects`, `project_members`, `enquiries`, `jurisdiction_profiles` |
| `legal` | `terms_versions`, `terms_acceptances`, `project_acknowledgements` |
| `cadastre` | `source_snapshots`, `lots`, `lot_boundary_segments`, `roads`, `easements` |
| `planning` | `zones`, `lot_zoning`, `lot_overlays`, `dcp_documents`, `dcp_chunks`, `setback_rules`, `building_envelopes`, `requirements` |
| `terrain` | `contour_sets`, `contours`, `tin_surfaces`, `cut_fill_runs`, `retaining_walls`, `crossover_checks` |
| `utilities` | `dbyd_enquiries`, `service_assets`, `exclusion_buffers`, `conflicts`, `rwt_sizing` |
| `plans` | `plan_uploads`, `plan_vector_entities`, `plan_raster_layers`, `alignment_control_points`, `plan_overlays` |
| `annotations` | `dxf_layers`, `text_annotations`, `export_jobs` |
| `agents` | `payloads`, `runs`, `invocations`, `state_log`, `token_ledger`, `prompt_cache_registry` |
| `design` | `layouts`, `levels`, `materials`, `rooms`, `walls`, `openings`, `roofs`, `catalogue_items`, `placed_items`, `item_checks` |

There is no artefact registry for the report, plan set or pack. `annotations.export_jobs` exists; whether it can serve as that registry is a backend decision.

## 8. The existing frontend

### 8.1 Routes

| Route | Purpose | State |
|---|---|---|
| `/` | Marketing page: hero ("Civil plans and DA/CDC applications, in one package"), pipeline, example plan, 3D teaser, custom municipality ("In development"), honesty section, pricing placeholder, FAQ | Built. Static content; the hero uses a real Gunnedah plan |
| `/projects` | Project list | Calls `GET /projects`, which does not exist; shows mock data (Hornsby sample in `src/lib/mock.ts`) |
| `/projects/[id]` | Workspace in three numbered sections: development type and plan upload; results; acknowledge and export | Upload and acknowledgements are real. Results and export are mocked |
| `/projects/[id]/viewer` | Viewer shell with review, first-person, place and assistant panels | Not wired to a real project bundle |
| `/legal/terms` | Terms click-wrap with scroll to end | Real against the API |
| `/engineer` | "Talk to a civil engineer" enquiry form | Real against `POST /enquiries` |
| `/viewer-demo` | Viewer with a built-in sample site | Demo |
| `/site-model/[name]` | Loads `public/samples/bundles/<name>.json` | Demo and test runs |

`src/middleware.ts` protects `/projects/*`. A request without the `jce_terms` cookie is redirected to `/legal/terms?next=...`. The API remains the source of truth.

### 8.2 Components and libraries

- `Shell.tsx`: header, footer, theme toggle, `Logo`, "Talk to an engineer" and "Start free trial" buttons, skip link.
- `Acknowledgements.tsx`, `DevelopmentTypeSelector.tsx`, `PlanUpload.tsx`, `Results.tsx`, `Markdown.tsx`.
- `enquiry/`: button, modal and form, with its own README.
- `home/`: `AppWindow`, `Pipeline`, `PlanShowcase`, `Status`, `data.ts`.
- `viewer/`: `ViewerShell`, `ReviewPanel`, `PlacePanel`, `AssistantPanel`, `FpOverlay`, `viewer.css`.
- `lib/`: `api.ts` (client with mock fallbacks), `acks.ts`, `terms.ts`, `enquiry.ts`, `assistant.ts`, `mock.ts`, and `lib/viewer/` (engine, scene builder, bundle loader, first-person and placement controllers, snapping, movement, minimap, textures, item models, catalogue, sample bundle, types).
- Tests: `assistant`, `enquiry`, `legal`, `viewer` (vitest).
- No component library is used. Styling is Tailwind over CSS variable tokens.

### 8.3 What the client mocks

`projects()`, `results()` and `exportFiles()` in `api.ts` fall back to mock data on 404 or 405 (or on a network error). Setting `NEXT_PUBLIC_MOCK=1` forces the mocks. Mock data must be replaced as the endpoints in 6.5 arrive; no mock value may reach production.

## 9. Visual identity

Direction (decision 15): a "drawing office" look in paper and gold that matches Jayden's Inglis Street reference sheet. White panels read as sheets on a paper ground. Hairline rules, title-block grids, monospaced uppercase eyebrows, and one gold accent. The quality bar is planningai.com.au, but not its dark and teal mood. Their branding and text must not be copied (deferred requirement D1).

Fonts: Jost (display), IBM Plex Sans (body), IBM Plex Mono (labels), loaded with `next/font/google`. JCE print documents use Century Gothic; Jost is the web equivalent in use. The logo comes from jceinfrastructure.com.au and is in `backend/app/branding/`. ABN, contact details and registrations are blank on purpose and must stay configurable until Jayden supplies them.

Tokens (defined as `r g b` CSS variables in `src/app/globals.css`, consumed by `tailwind.config.ts`):

| Token | Light | Dark |
|---|---|---|
| `bg` (paper) | #F1F0EC | #1A1B1D |
| `surface` | #FFFFFF | #232528 |
| `subtle` | #E9E7E0 | #2E3135 |
| `scene` (3D background) | #E3E6E8 | #25282C |
| `ink` | #1E2024 | #E9E7E0 |
| `muted` | #676B72 | #9A9DA3 |
| `line` | #D8D6CF | #35383D |
| `brand` (gold) | #A8842F | #C7A256 |
| `brand-strong` | #84651C | #D6B266 |
| `brand-soft` | #F0E8D4 | #3A3220 |
| `gold` (text) | #80621C | #D6B266 |
| `warn` | #9A5A0A | #E6AA46 |
| `danger` | #B3322A | #E5645A |
| `ok` | #247842 | #6EC882 |

Dark mode follows `prefers-color-scheme` and the `data-theme` attribute (stored under `theme` in local storage). Shared classes: `.btn`, `.btn-primary`, `.btn-gold`, `.btn-ghost`, `.card`, `.input`, `.h-eyebrow`, `.h-display`, `.accent`, `.sheet`, `.grid-paper`, `.ticks`, `.titleblock`, `.pill`, `.prose-terms`. Radius `xl2` is 0.75rem. Shadows: `card` and `paper`. The skip link, focus ring and reduced-motion handling already exist. The target should be WCAG 2.2 AA.

Gaps in the system: no tokens exist for UNRESOLVED or NOT CHECKED. Define them (section 10.3). Status must always be carried by words and icons as well as colour.

## 10. Proposed information architecture and page specification

This section is a proposal.

### 10.1 Principles

- Evidence beside every value. A value shows a source chip that opens the document, page and quote.
- The outputs are the product. The web views preview them faithfully (sheets, report pages) and do not re-skin them into something else.
- Everything is a draft. A persistent "Indicative draft" status sits on result views and next to every download.
- Summary first, detail on demand. Calm, formal copy inside the application; marketing language stays on public pages.
- Honest gaps. UNRESOLVED and NOT CHECKED are designed states, not error states.

### 10.2 Site map

Public:

- Home.
- How it works (stages A to F in plain language, with what the user receives).
- Example output (real sheets, report pages, the 3D demo).
- What it does not know (limits, data sources, unresolved items, who must check what).
- Pricing (placeholder until decided).
- FAQ.
- Talk to a civil engineer (`/engineer`).
- Legal: Terms (exists), Privacy (placeholder), acknowledgements explained.
- Custom municipality (in development).

Application (signed in, Terms accepted):

- Projects list.
- New project: find the lot, choose development type, optional architect PDF or design from scratch, confirm and run.
- Run progress.
- Project workspace with tabs: Overview, Constraints, Requirements, Plans, Services and driveway, Report, Pathway and compliance, Application pack, 3D model, Design, Activity.
- Acknowledge and download.
- Settings: account, jurisdiction profile and units (custom municipality).

### 10.3 Status vocabulary

| Domain | Values | Suggested treatment |
|---|---|---|
| Run | `queued`, `running`, `waiting_user`, `succeeded`, `failed`, `cancelled`, `blocked_by_gate` | Timeline per stage; `waiting_user` shows the question; `blocked_by_gate` links to the acknowledgements |
| Constraint layer | `affected`, `not_affected`, `not_checked` | Affected: danger. Not affected: neutral wording "No overlap found in this screened layer", never "clear". Not checked: hatched neutral with the reason (source unavailable) |
| Requirement | resolved with citation, user confirmed, UNRESOLVED | Citation chip; "You entered this" marker; amber with next step |
| Compliance row | `PASS`, `FAIL`, `UNRESOLVED`, `NOT_APPLICABLE` | PASS and FAIL appear only from a numeric comparison with a cited value |
| Pathway | `ELIGIBLE`, `NOT_ELIGIBLE`, `UNRESOLVED`, `NOT_APPLICABLE`; pills Required, Possible, Not applicable, Unresolved | Show the failing criterion and its citation |
| Plan alignment (SA7) | `accepted_unverified`, `needs_user_confirmation`, `refused` | Overlay preview with scale confirmation controls |

Buffer-type layers (bushfire 100 m, coastal 100 m, riparian 40 m, transport corridor 60 m) use screening distances set in the platform. They are not legal thresholds. The web view must say so, and must show the distance used.

### 10.4 Page specifications

| Page | Data | Key elements | States to design |
|---|---|---|---|
| Find the lot | `GET /lots/search`, `GET /lots/{lotplan}` (proposed) | Search by address or lot and plan; candidate list; map with boundary; facts (area, council area, zone); "Indicative, not a survey" label; NSW live, Queensland unverified | No match, several matches, source unavailable, outside supported area (offer the custom municipality path) |
| New project details | Development type, optional PDF | `DevelopmentTypeSelector`, `PlanUpload` with the rights warranty, scale entry | Dual occupancy stub warning, upload errors (type, size, active content) |
| Run progress | `GET /runs/{id}` | Stage timeline A to F, per-agent status, tokens not shown to customers, cancel | Failed agent with `error_code`, `waiting_user`, `blocked_by_gate`, partial success |
| Overview | Results | Key facts, status chips per area, next actions, enquiry button | Run not yet complete, outputs stale after a change |
| Constraints | Constraints data and GeoJSON | Layer list with three states, map overlays, plain-English "what it is, may trigger, next", distance and buffer used | Not checked layers, no endpoint for a layer, QLD with no layers |
| Requirements | Requirements data | Table with citation chips, quote drawer, document link, page; UNRESOLVED rows with an entry control or upload prompt | Many unresolved (council not loaded), user-confirmed values |
| Plans | Plan set artefacts | Sheet browser with thumbnails, zoom, sheet index, PDF and DXF downloads, status line "PRELIMINARY: NOT FOR CONSTRUCTION" | Sheet with DATA NOT AVAILABLE panels, generation in progress, gate not satisfied |
| Services and driveway | SA3 and SA4 results | Crossover and driveway check (grade, width, design vehicle), services conflicts, rainwater tank size and regime, connections | No Dial Before You Dig data uploaded, rural lot with no connection point |
| Report | `site_report.pdf` and JSON | PDF viewer with outline, download | Report pending |
| Pathway and compliance | Pathway and compliance data | Three pathway cards (exempt, CDC, DA), compliance table, list of unresolved rules | Mostly UNRESOLVED (expected today) |
| Application pack | `pack.json` | Index, checklist, SoEE draft status, download zip, link to Planning Portal guidance | SoEE contains TO BE COMPLETED lines |
| 3D model | Scene bundle | Viewer (section 11) | Bundle without terrain or dwelling, WebGL unavailable, mobile |
| Design | Design API | Layout summary, assistant panel, catalogue, placed items, shopping list | No API key configured, retailer import blocked |
| Acknowledge and download | Acknowledgements | Nine statements with one control each, gate status, per-file download | Partly ticked, API rejects with `missing` list |
| Activity | Runs, acknowledgements | History with dates (DD/MM/YYYY) | Empty |
| Talk to a civil engineer | `POST /enquiries` | Form with consent, optional share of project context | Rate limited, delivery failed (reference shown) |

## 11. The 3D viewer

The viewer is custom three.js code in `src/lib/viewer/` and `src/components/viewer/`. It follows a reference review tool for the Inglis Street model (330 parts, about 5 MB), described in `docs/05-viewer-reference.md`, and the play mode plan in `docs/06-play-mode.md`.

Modes:

| Mode | Behaviour |
|---|---|
| Review | Orbit, saved camera views, layer toggles, display options (cut and fill colouring, see-through buildings), pick readout (E, N, RL in AHD, depth to existing ground), compass, hover tag, light and dark theme |
| First person | Pointer lock, WASD and mouse look, eye height 1.6 m (adjustable), gravity and ground following from the terrain TIN, floor following inside the house, collision with walls and fences, touch joysticks on mobile |
| Place | Pick a catalogue item, ghost preview, snap to ground, floor or wall, rotate in 15 degree steps, real dimensions, move, duplicate, delete, undo and redo |

Scene bundle (`SceneBundle` in `src/lib/viewer/types.ts`):

- `info`: `title`, `subtitle`, `FFL`, `origin` (local metres relative to a Map Grid of Australia origin), `z0`.
- `layers[]`: `c` (id), `n` (name), `on`.
- `parts[]`: `n`, `c` (layer), `col`, `a` (alpha), `ro`, `me`, `f` (triangle indices) or `v` (triangle soup), `lines`, `vc`, `uv`, `cs`, `tex`, `eml`, `ds`.
- `labels[]`, `views`, `summary[]`, `notes[]`.
- `walkable`: `terrain` (names of parts that can be walked), `colliders` (oriented boxes), `floors` (planes at a height), `spawn`.
- `items[]` (placed items with warnings such as "over DBYD buffer") and an optional embedded `catalogue`.

Cautions:

- Bundle contents vary. The earlier Lot 2 bundle had five parts, no terrain and no dwelling. The viewer must render whatever is present and say what is absent. Terrain and dwelling massing are being added in the backend (section 16).
- First person was only partly confirmed (headless Chromium showed the panel but the camera did not move). Mouse look and touch are untested.
- Open issues for store items: retailer terms and licensing for images and 3D assets, trademark use, price accuracy, and a Terms addendum stating that renders are illustrative.
- Placed items are checked against the same envelope, setback and service buffer rules. Warnings must be shown.

## 12. Legal and acknowledgement flow

Terms are a draft (version 1.0.0) with addenda for design, constraints and referral. All need solicitor review; bracketed text marks gaps. The page renders `body_markdown` from the API and records acceptance with `body_sha256` and `scrolled_to_end`. The `jce_terms` cookie is set after acceptance.

The nine acknowledgements (`src/lib/acks.ts`), each recorded per project:

| ID | Kind | Subject |
|---|---|---|
| A1 | `dbyd_physical_verification` | Underground service information is indicative; current Dial Before You Dig plans and physical location are required before excavation |
| A2 | `setback_user_verification` | Setbacks and controls were extracted automatically and may be wrong or out of date |
| A3 | `cut_fill_indicative_only` | Cut and fill volumes are indicative and not for pricing or ordering |
| A4 | `retaining_wall_not_structural` | Retaining wall outputs are not structural or geotechnical design |
| A5 | `crossover_not_certified` | Crossover check is a preliminary screening, not certified compliance with AS/NZS 2890.1 |
| A6 | `cadastre_not_survey` | Boundaries are indicative; an identification survey is required |
| A7 | `uploaded_plan_accuracy` | Alignment of uploaded plans is only as accurate as the plans supplied |
| A8 | `upload_rights_warranty` | The user holds the rights to upload the material (also captured at upload) |
| A9 | `hydrology_not_certified` | Rainwater tank and hydrology outputs are indicative; BASIX or QDC compliance is separate |

Guidance:

- Show the full text of each statement. Do not pre-tick.
- Whether a single "tick all" control is acceptable is an open decision for the solicitor (section 17).
- The runner flag `--acknowledge` ticks all nine for test runs only. The website must never do this.

## 13. Data sources, coverage and limits

- Live NSW sources verified on 12/10/2026: cadastre (`NSW_Cadastre` layer 9), address to property (`NSW_Property` layers 1 to 4), zoning, lot size, floor space ratio and height (`EPI_Primary_Planning_Layers`), road centreline (`NSW_Transport_Theme` layer 5), and a 5 m DEM (`NSW_5M_Elevation`).
- The 5 m DEM is too coarse for cut and fill on small lots. Every sheet using it carries an "indicative, detail survey required" label. The planned upgrade is LiDAR from Geoscience Australia ELVIS (decision 17); it is not built.
- NSW imagery metadata states no licence ("verify terms before commercial use"), and capture dates can be old.
- Dial Before You Dig: there is no public database. Vector PDF responses are parsed; no real BYDA data has been tested.
- Constraints: 16 of 18 NSW layer types are live-verified. Contamination and transport corridors have no public layer. Queensland has none.
- Council knowledge exists for Gunnedah only: 113 cited requirements with 19 groups unresolved. The ESC set has 98 requirements. The pathway rules have 65 resolved and 16 unresolved. Any other council area returns mostly UNRESOLVED until documents are loaded. The website must state this coverage honestly.
- Blocked from the build environment: NSW data hosts returned HTTP 403 through the egress proxy on 14/10/2026, and legislation.nsw.gov.au, rfs.nsw.gov.au, SES flood data and AustLII were blocked on 12/10/2026. A production deployment must be checked separately. Any failed upstream call must surface as NOT CHECKED, never as clear.
- Test lots: Lot 2 DP227508 Gunnedah (956 m2, zone R2, appears vacant) and 756 Quia Road Gunnedah (Lot 3 DP263990, zone RU1, 50.9 ha). Outputs are illustrative only.

## 14. Status by component

| Component | State |
|---|---|
| Orchestrator, API, legal gate | Built and tested with mock agents and a scratch database. Authentication is a development stub |
| SA1 lots, zoning, roads, address | NSW endpoints live-verified. Queensland not verified |
| SA2 council document retrieval | Table parser is weak. Real extraction was done by reading, with the citation validator |
| Requirements resolver | Built. Gunnedah knowledge base only |
| SA3 terrain, driveway, flood floor level | Built and tested on synthetic data and the live 5 m DEM |
| SA4 services, rainwater tank | Built. Vector Dial Before You Dig PDFs only. Clearances come from requirements |
| SA5 plan set | 12 sheets built. Restyle to the reference sheet planned (section 5) |
| SA6 scene and viewer | Built. First person partly confirmed |
| SA7 PDF aligner | 40 synthetic tests. Never run on a real architect plan. No OCR for raster pages |
| SA8 layout model and Design Assistant | Built and tested with a fake language model. Never called the real API. Not wired into project pages |
| SA9 constraints | 16 of 18 NSW layers live |
| SA10 erosion and sediment control | Built and revised. 15 tests. Fall direction from the 5 m DEM must be confirmed on site |
| SA11 pathway, compliance, SoEE, pack | Built. 46 tests. Layout-derived inputs are not wired from SA8, so real runs show mostly UNRESOLVED |
| Site report | Rebuilt, 16 to 17 pages. Explanatory content (what buffers mean, glossary) is being added. Pathway section is not wired in |
| Enquiry to JCE | Built. Needs `ENQUIRY_TO` and SMTP or webhook settings |
| Custom municipality | Built (profiles, units, parcels, document-driven requirements). `db/006` untested on PostgreSQL |
| Frontend | Redesigned. Mock data remains in `src/lib/mock.ts` |
| Tests | 466 passed and 44 skipped (non-database) on 12/10/2026; one row-level security test errored once and passed earlier. Re-run after the changes in section 16 |

## 15. Environment and commands

Backend settings: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `ASSISTANT_MODEL`, `ASSISTANT_EFFORT`, `ASSISTANT_FALLBACKS`, `DESIGN_RETAILER_ALLOWLIST`, `ENQUIRY_TO`, `ENQUIRY_SMTP_*`, `ENQUIRY_WEBHOOK_URL`, `ENQUIRY_PARTNER_TOKEN`, `ENQUIRY_PUBLIC_BASE_URL`, `ENQUIRY_TRUST_XFF`, `ENQUIRY_UPLOAD_DIR`, `ENQUIRY_MAX_PER_IP_HOUR`, `IMAGERY_PROVIDER`, `IMAGERY_CACHE_DIR`, `QLD_IMAGERY_URL`, `SA2_EMBEDDING_API_KEY`, `SA2_EMBEDDING_MODEL`, `SA9_ENDPOINT_*`, `PLANSET_FONT_DIR`, `BRAND_*`.

Frontend settings: `NEXT_PUBLIC_API_BASE` (default `http://localhost:8000`), `NEXT_PUBLIC_DEV_USER_ID`, `NEXT_PUBLIC_MOCK`.

Commands:

```
# backend tests (database tests skip unless TEST_DATABASE_URL is set)
cd cadastral-platform/backend && python -m pytest tests -q

# end-to-end test run on a live NSW lot (needs network access to NSW services)
python scripts/run_site.py --check-network
python scripts/run_site.py --lotplan 2//DP227508 --development-type dwelling_house --levels nsw \
  --rules-json ../test-runs/rules/R2_dwelling_house.json --acknowledge --out ../test-runs/lot2_dwelling

# frontend
cd ../frontend && npm install && npm run typecheck && npm test && npm run build
NEXT_DIST=.next-dev npx next dev -p 3200
```

Cautions:

- Use a unique `NEXT_DIST` and port for each dev server. Parallel sessions have killed each other's servers.
- Never commit build output (`.next*/`). An early commit added about 30 MB of `.next-dev`, so `.git` is large.
- Pages worth opening after `next dev`: `/`, `/projects`, `/legal/terms`, `/engineer`, `/viewer-demo`, `/site-model/lot2_dwelling`.

## 16. Changes not yet in the repository

Work done in the sandbox copy on 13/10/2026 and 14/10/2026 is not in `jaydencal/jce`:

- An offline fixture for Lot 2 DP227508 (`backend/app/offline/`), an `offline_lot2` imagery provider and a `--offline lot2` option in `run_site.py`. This allows a full run without access to NSW services.
- Groundwork in the 3D scene code (`sa6_glide3d/geom.py` and `models.py`: terrain drape, boundary posts, kerb and verge options). Not verified by tests.
- Small changes to report formatting helpers (`report/fmt.py`).
- Planned and not yet built: the plan set restyle, the explanatory report content, terrain and dwelling massing in the scene bundle.

The website session should work from the repository as it stands and treat these as pending. Sample outputs that Jayden holds were generated before the restyle.

## 17. Open decisions for Jayden

| # | Decision | Default to assume in the meantime |
|---|---|---|
| 1 | Primary audience and journey (owners and owner-builders, designers and builders, or both) | Design for a first-time applicant, with a faster path for repeat users |
| 2 | Authentication provider and Australian data residency; organisation accounts | Email sign-in, single user per account |
| 3 | Pricing, billing, and what "Start free trial" means | Pricing page stays "coming soon"; the button leads to sign-up |
| 4 | Hosting, object storage, retention of uploads and outputs, privacy policy content | Unspecified; design with a retention notice placeholder |
| 5 | Whether public examples may show a real third-party lot (the hero uses a real Gunnedah plan) | Keep until decided, then replace with JCE-owned or anonymised examples |
| 6 | Whether one "tick all" control is acceptable for the nine acknowledgements | Nine separate controls |
| 7 | Whether design from scratch and DXF import are in the first release | Hidden behind a feature flag |
| 8 | How enquiries are handled by JCE (inbox, response time, paid review) | Form only, no promised response time |
| 9 | First-release coverage: NSW only, Gunnedah knowledge only, or wider | State coverage plainly on every result |
| 10 | Product name, domain and logo use ("JCE Site Planner" is the working name) | Working name |
| 11 | Map provider and basemap licensing for the lot confirm step | Provider-agnostic map component |
| 12 | Who builds the backend gaps in section 6.5, and in what order | P0 items first |

## 18. Glossary (for interface copy and tooltips)

| Term | Meaning |
|---|---|
| Lot and plan | Parcel identifier such as Lot 2 DP227508. DP means Deposited Plan |
| LGA | Local government area (the council area) |
| LEP | Local Environmental Plan; sets zoning and many development standards |
| DCP | Development Control Plan; council detail controls such as setbacks |
| SEPP | State Environmental Planning Policy |
| DA | Development application, assessed by council |
| CDC | Complying development certificate; a faster approval when strict standards are met |
| SoEE | Statement of Environmental Effects; part of a DA |
| ESC or ESCP | Erosion and sediment control (plan) |
| DBYD or BYDA | Dial Before You Dig; the service that asks asset owners for buried service plans |
| RWT | Rainwater tank |
| FFL | Finished floor level |
| TIN | Triangulated irregular network; a terrain surface made of triangles |
| DEM | Digital elevation model; a grid of ground heights |
| LiDAR and ELVIS | Laser-scanned elevation data; ELVIS is Geoscience Australia's source for it |
| MGA | Map Grid of Australia; the metre-based coordinate system used for the drawings |
| RL and AHD | Reduced level, measured against the Australian Height Datum |
| Crossover | The driveway link between the road edge and the property boundary |
| Kerb and gutter | The concrete edge and drainage channel of the road |
| Buffer | A distance around a mapped feature within which the platform flags a possible effect. It is a screening setting, not a legal threshold |
| UNRESOLVED | The platform could not find a cited source for the value, so it shows none |
| NOT CHECKED | The platform could not query the source, so it makes no statement either way |
