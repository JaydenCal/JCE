# Handover: JCE Site Planner (cadastral and civil site planning platform)

Written 2026-10-12 at the end of the first build session. Branch: `claude/peaceful-wright-d7itnp` (repo `jaydencal/jce`, folder `cadastral-platform/`). Read this first, then `docs/03-decisions.md` (16+ numbered decisions, the source of truth for what the user asked for).

## 1. What this is
An Australian (NSW first, QLD partial) platform that takes a lot and produces **civil plans + DA/CDC application material**: cadastre and zoning lookup, constraints (flood, bushfire, heritage...), requirements read from cited council documents, driveway/crossover and swept path, earthworks and floor level above flood level, services/RWT, erosion and sediment control plan, multi-sheet plan set (PDF and DXF) with aerial underlay and company logo, a constraints/site report, 3D model with first-person walk and placeable store items, a design assistant, a "Talk to a civil engineer" enquiry to JCE Infrastructure, and a custom-municipality mode (any council or country: load engineering documents, set units). Marketing: "the full package: civil plans and DA/CDC applications".

**Design rules that must not be broken:** no hard-coded requirement values (every requirement comes from a cited document or is shown UNRESOLVED); never invent data (levels, services, flood levels, rules); outputs are indicative drafts for a qualified person, never certified; "Not checked" never means "clear".

## 2. Repo map
- `db/001..006_*.sql`: PostgreSQL 16 + PostGIS + pgvector schemas (core, legal, cadastre, planning, terrain, utilities, plans, annotations, agents; design; requirements; enquiries; ESC layers; jurisdictions). 001 and 002 and 003, 004 were loaded and smoke-tested on a scratch database; 005 and 006 were NOT executed against Postgres.
- `backend/app/`: `orchestrator/` (DAG, adapters, idempotency, token budget, export gate), `api/` (FastAPI: runs, legal gate, uploads, enquiries, design, assistant), `agents/` (SA1 cadastre, SA2 DCP RAG, SA3 terrain + driveway, SA4 hydro/DBYD, SA5 CAD/PDF export + planset, SA6 3D scene, SA7 PDF aligner, SA8 layout model, SA9 constraints, SA10 ESC, SA11 pathway, `requirements/` resolver), `imagery/`, `flood/`, `jurisdiction/`, `design/` (+assistant), `notify/`, `branding/`, `pack/`, `report/`.
- `backend/knowledge/`: cited requirement sets (`gunnedah/` 113 requirements, `esc/` 98, `pathway/`); raw downloaded PDFs are gitignored; `scripts/fetch_docs.py` re-downloads.
- `backend/scripts/run_site.py`: the end-to-end test runner (see section 5). `rules_from_knowledge.py` converts cited requirements to the runner's rules JSON.
- `frontend/`: Next.js 14 + Tailwind + three.js. Pages: `/` (marketing, drawing-office look), `/projects`, `/projects/[id]`, `/legal/terms`, `/engineer`, `/viewer-demo`, `/site-model/[name]`. Viewer in `src/components/viewer/`, logic in `src/lib/viewer/`.
- `legal/`: Terms and Conditions (draft v1.0.0) + addenda (design, constraints, referral). ALL need solicitor review; `[BRACKETS]` and `[solicitor to confirm]` mark gaps.
- `test-runs/`: real outputs on real NSW data (Lot 2 DP227508 Gunnedah vacant R2 lot, 956 m2; 756 Quia Road = Lot 3 DP263990, RU1, 50.9 ha): plans, reports, scene bundles, ESCP, packs. Illustrative only.

## 3. Status by component
| Component | State |
|---|---|
| Orchestrator + API + legal gate | Built, tested (mock agents + scratch DB). Login is a dev stub (`X-User-Id`): replace with real auth |
| SA1 NSW lots, zoning, roads, address | Live-verified endpoints (see 4). QLD not verified |
| SA2 DCP RAG | Table parser is weak (discarded its own output on the Gunnedah DCP); real extraction was done by reading + the citation validator |
| Requirements Resolver | Built; citation validator enforces quote-in-page and number-in-quote. Gunnedah knowledge base 113 requirements, 19 groups UNRESOLVED |
| SA3 terrain / driveway / flood FFL | Built and tested on synthetic data and live 5 m DEM (too coarse for cut/fill on small lots; flagged) |
| SA4 DBYD / RWT / connections | Built; vector DBYD PDFs only; no real BYDA data tested; clearances come from requirements (placeholders only behind an explicit flag) |
| SA5 plans | Single sheet built. **12-sheet civil plan set built** (`sa5_cad_dxf/planset/`, samples in `test-runs/planset_*`): cover, existing site, proposed site, earthworks, stormwater, water+sewer, driveway plan, long section, crossover details, ESC, details, notes; JCE logo in every title block (also vectorised in DXF); aerial underlay; adjoining lot labels. **Not yet engineer-grade**: heavy aerial, dense DEM spot labels (C100), crowded labels (C400/C500), low chart on C410, tiny key plan, Quia sets had no aerial (NSW imagery HTTP 500) and Quia C410/C420/C600 pages were never reviewed. See `planset/STATUS.md` |
| SA6 3D scene, viewer, first person, placement | Built. First-person was only partly confirmed in headless Chromium (screenshot showed the panel but camera did not move; mouse look and touch untested) |
| SA7 PDF aligner | 40 synthetic tests; never run on a real architect plan; no OCR for raster pages |
| SA8 layout model + 25 edit ops, Design Assistant | Built, tested with a fake LLM. **Never called the real Anthropic API.** Needs `ANTHROPIC_API_KEY`; not wired into real project pages (demo only); site-context hook not supplied |
| SA9 constraints | 16 of 18 NSW layer types live-verified; contamination and transport corridors have no public layer; QLD none |
| SA10 ESC | **Built and revised** (fences at stockpile toes and along the low side of works, bordered symbol legend, DXF symbol blocks). 15 tests. Fall direction comes from the 5 m DEM: confirm on site |
| SA11 pathway + pack + SoEE | **Built** (46 tests; sample packs in `test-runs/pack_*`): 65 cited rules resolved from Dept of Planning Inland/Housing Code summary tables and Gunnedah checklists, 16 UNRESOLVED; Codes SEPP, Housing SEPP, EP&A Regulation and Gunnedah LEP were blocked (Cloudflare). CDC is UNRESOLVED for all three test cases. See `backend/app/pack/STATUS.md` |
| Site report | **Rebuilt** (`backend/app/report/`, 16 to 17 pages: cover with logo, executive summary, zoomed aerial figures, plain-English constraint pages, cited requirements, appendix). Pathway section not wired to SA11 yet; some pages spill; quotes cut at 150 chars |
| Enquiry to JCE Infrastructure | Built (`/engineer`, `/enquiries`, DB 004, SMTP/webhook notifier). Needs `ENQUIRY_TO` + SMTP/webhook settings; privacy policy page is a placeholder |
| Custom municipality | Built (profiles, units, custom parcels, document-driven requirements); db/006 untested on Postgres |
| Branding | JCE logo (from jceinfrastructure.com.au) in `backend/app/branding/`; ABN/contact/registrations are blank by design |
| Frontend site | Redesigned (paper/gold drawing-office look); hero uses real Gunnedah plan; some sections labelled "In development"; mock data still in `src/lib/mock.ts` |

## 4. Live data verified on 2026-10-12 (NSW)
- Lots: `maps.six.nsw.gov.au/.../NSW_Cadastre/MapServer/9`; address to property: `.../NSW_Property/MapServer/1-4` (`housenumber`, `address`); zoning/lot size/FSR/height: `mapprod3.environment.nsw.gov.au/.../Planning/EPI_Primary_Planning_Layers/MapServer/{2,4,1,5}`; roads: `portal.spatial.nsw.gov.au/server/rest/services/NSW_Transport_Theme/MapServer/5`; 5 m DEM: `maps.six.nsw.gov.au/.../NSW_5M_Elevation/ImageServer` (exportImage); imagery: `.../NSW_Imagery/MapServer/export` (1000 px requests 500: use 700) and `NSW_Imagery_Dates`. Constraint layer endpoints: `backend/app/agents/sa9_constraints/endpoints_nsw.json`.
- Blocked from this sandbox: legislation.nsw.gov.au (Cloudflare), rfs.nsw.gov.au, flooddata.ses.nsw.gov.au, AustLII. The user may need to download LEP/SEPP/PBP PDFs and upload them.
- The NSW imagery metadata states no licence: "verify terms before commercial use". The sampled imagery capture date read 2011: verify.

## 5. How to run
```
cd cadastral-platform/backend
python scripts/run_site.py --check-network
python scripts/rules_from_knowledge.py --zone R2 --dwelling-type dwelling_house --out ../test-runs/rules/R2_dwelling_house.json
python scripts/run_site.py --lotplan 2//DP227508 --development-type dwelling_house --levels nsw \
   --rules-json ../test-runs/rules/R2_dwelling_house.json --acknowledge --out ../test-runs/lot2_dwelling
python scripts/run_site.py --lotplan 3//DP263990 --development-type secondary_dwelling|shed --levels nsw --rules-json ../test-runs/rules/RU1_*.json --acknowledge --out ...
python -m pytest tests -q            # DB tests skip unless TEST_DATABASE_URL is set
cd ../frontend && npm install && npm run typecheck && npm test && npm run build
NEXT_DIST=.next-dev npx next dev -p 3200     # then /, /projects, /legal/terms, /viewer-demo, /site-model/lot2_dwelling
```
`--acknowledge` auto-ticks the nine acknowledgements for test runs only: real users must tick them. Scratch Postgres for DB tests: PG16 + PostGIS 3.4 + pgvector installed via apt in the sandbox (needs re-creating in a new sandbox).
Environment variables: `ANTHROPIC_API_KEY`, `ASSISTANT_MODEL` and cost caps, `ENQUIRY_TO`, `ENQUIRY_SMTP_*`/`ENQUIRY_WEBHOOK_URL`, `ENQUIRY_PARTNER_TOKEN`, `IMAGERY_PROVIDER=nsw`, `IMAGERY_CACHE_DIR`, `SA1_*`, `SA2_*`, `SA9_ENDPOINT_*`, `BRAND_*`, `DESIGN_RETAILER_ALLOWLIST`, `TEST_DATABASE_URL`.

## 6. Known issues
- Tests: final non-DB run on 2026-10-12: **466 passed, 44 skipped** (`--deselect tests/test_orch_rls.py`). `test_orch_rls.py::test_orchestrator_under_rls` errored at DB pool setup in one run (passed earlier): re-check with a scratch Postgres. DB tests (about 45) only run with `TEST_DATABASE_URL`; db/005 and db/006 were never loaded into Postgres.
- Parallel agents sometimes `pkill` each other's `next dev` servers: use unique `NEXT_DIST` and ports, and never `pkill -f "next dev"` from a command containing that text.
- Do not commit build output (`.next*/` is ignored now; an early commit added about 30 MB of `.next-dev`, so `.git` is large; consider `git filter-repo` if size matters).
- The 51 ha Quia Road plan was nearly empty at plan scale: the plan set needs a key plan + site window for large lots (assigned; verify).
- The marketing site used a synthetic sample earlier; it now uses the real Gunnedah plan: check no synthetic imagery remains (`src/lib/mock.ts` still has Hornsby data).
- Arial Narrow is proprietary: PDFs use Liberation Sans Narrow; DXF names Arial Narrow.

## 7. What the user asked for that is not done yet (priority order)
1. Polish the multi-sheet plan set (generator exists; see planset/STATUS.md for visual issues; review every page of the Quia sets). Original requirements: cover, existing conditions (aerial, adjoining lot labels, existing contours), proposed site plan (proposed structure, FFL), earthworks (existing and proposed contours, cut/fill), stormwater, water and sewer, driveway plan + **longitudinal section**, **crossover details**, ESC, sections/details, notes; Arial Narrow; **company logo in every title block**.
2. Wire SA11 pathway/compliance into the report, fix page spills, add zone objectives once the LEP is obtained.
3. (done) ESCP legend and fence fixes.
4. Application engine: pathway (exempt/CDC/DA), compliance table, draft SoEE, application pack (needs the Codes SEPP etc.: ask the user to upload).
5. Connect real data: SA9 loader for QLD, DBYD (BYDA API agreement, if lodgement for users is permitted), council flood certificate/levels, survey/LiDAR for cut/fill.
6. Wire Design Assistant and viewer to real projects (`/site-model` loads scene bundles; first person needs a proper test in a real browser).
7. Subdivision tool (decision 10, not started). Store-product import is built but needs retailer terms/licensing review.
8. Production: real auth, billing, hosting in an Australian region, managed Postgres/PostGIS/pgvector, object storage, workers, CI/CD, virus scanning, monitoring.
9. Legal: solicitor review of all Terms documents; confirm referral arrangement and insurance statements; privacy policy page.
10. Professional validation: registered surveyor, engineer and planner must check outputs on real jobs.

## 9. Drawing data quality: LiDAR and roads (user requirement, decision 17)
The user wants the **best-quality LiDAR** in all drawings from now on, and **roads and road details** shown properly. Today the plans use the NSW 5 m DEM (indicative only, accuracy unstated) and road centrelines only.
What was checked on 2026-10-12:
- NSW `NSW_Elevation_and_Depth_Theme` (portal.spatial.nsw.gov.au) offers only SpotHeight, RelativeHeight and Contour layers: topographic contours, not LiDAR.
- NSW `maps.six.nsw.gov.au` has no 1 m LiDAR DEM service (NSW_Elevation is a footprint layer; NSW_5M_Elevation is a 5 m stereo-derived DEM).
- The national source is **ELVIS (Geoscience Australia, elevation.fsdf.org.au)**: LiDAR point clouds (LAS/LAZ) and 1 m DEM tiles by project. The portal front page answers (200) from the sandbox; `elevation-direct-downloads` (S3) returned 403 and `api.elvis.ga.gov.au` was unreachable, so tile downloads were NOT tested. Allow those hosts (or download tiles manually and upload) and re-test.
What to build next:
1. ELVIS integration: find the newest, densest LiDAR project covering the lot (record project name, capture date, point density, stated vertical/horizontal accuracy and licence from its metadata: never assume), fetch tiles, classify ground, build a ground DEM/TIN and contours (0.1 to 0.5 m intervals by use), store provenance, and prefer it over the 5 m DEM automatically. Keep the 5 m fallback with its warning.
2. Replace the "5 m DEM" caveat on plans with the real accuracy statement when LiDAR is used; cut/fill uncertainty must use the stated accuracy.
3. Roads on the drawings: road centreline (NSW_Transport_Theme layer 5 verified), road reserve width from cadastre/council, kerb and road edge lines from LiDAR/imagery or supplied survey, pavement width, crossfall, levels along kerb and gutter at the frontage and across the crossover, adjoining driveways and street furniture where known, chainage, and cross-sections for driveway tie-in. Mark anything inferred from imagery as indicative.
4. Allow customers to upload their own survey (DXF/LandXML/CSV/LAS) which overrides public data; the ingest code for DXF/CSV exists in `sa3_terrain/ingest.py`.

## 8. Start prompt for the next chat
> Continue the JCE Site Planner build. NOTE the user wants best-quality LiDAR (ELVIS) and proper roads in all drawings (section 9). Repo `jaydencal/jce`, branch `claude/peaceful-wright-d7itnp`, folder `cadastral-platform/`. Read `docs/09-handover.md` and `docs/03-decisions.md` first. Run the backend tests and fix failures, then review `test-runs/` outputs (plan set, report, ESCP, pack) against the user's feedback in section 7 and finish them. Be token-frugal: use subagents for independent work, grep instead of reading whole files, commit and push after each piece. Never invent requirement values: cite or mark UNRESOLVED.
