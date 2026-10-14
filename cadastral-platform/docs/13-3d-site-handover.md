# JCESITE: 3D site model handover

Date: 14/10/2026. Written for a new session that will develop the 3D tool for JCESITE, basing it on another tool the owner (Jayden Callen) has built.

## 1. Scope (owner decisions, latest wins)

- Site only. No dwelling, no building footprint, no finished floor level. The owner has a separate tool for the house. Setback dimensions appear only as labelled placeholders.
- Content: terrain from survey or DEM points, cadastral boundary, adjoining lots with LOT and DP labels, road and assumed kerb line (labelled as platform default, not surveyed), driveway and crossover (layover), cut and fill, batters, contours, existing services only when verified (DBYD plan, docs/12), ESC items if useful.
- The product brand is JCESITE (AI-assisted site planning). It is NOT affiliated with JCE Infrastructure. No JCE logo or JCE branding anywhere. Old SA6 text that says "GlideInside" or "JCE" must be rebranded.
- Every view and export carries the statement: AI GENERATED DRAFT, NOT CHECKED OR CERTIFIED, MUST BE CHECKED AND VERIFIED BY A QUALIFIED PERSON BEFORE ANY USE.
- Review at every stage: stop at the end of each stage, deliver output, wait for the owner's go.

## 2. Rules that must not be broken

- No hard-coded requirement values. Every requirement is cited (requirements resolver or rules JSON) or shown UNRESOLVED.
- Never invent data: levels, services, flood levels, rules, kerb or road geometry. Missing data is shown as DATA NOT AVAILABLE.
- "Not checked" never means "clear".
- Assumed or defaulted items are labelled (for example ASSUMED KERB LINE, PLATFORM DEFAULT, NOT SURVEYED).
- Outputs are indicative drafts, never certified.
- Formal register, no dashes in report text, DD/MM/YYYY dates, uppercase on drawings.

## 3. What already exists

- Backend 3D agent: `backend/app/agents/sa6_glide3d/` (`agent.py`, `build.py` terrain and element builders, `geom.py` deterministic triangle-soup meshes, `models.py` SceneRequest and SceneBundle, `scene.py`, `presets.py` shed and granny flat presets (not wanted now), `sample.py` sample scene). Deterministic, no model calls. Contract documented in `docs/05-viewer-reference.md` and `docs/06-play-mode.md`.
- Runner: `backend/scripts/run_site.py` builds a scene at about line 515 (`Sa6Glide3d().run(SceneRequest(...))`).
- Frontend viewer: `frontend/src/components/viewer/`, logic in `frontend/src/lib/viewer/` (three.js, Next.js 14). Pages `/viewer-demo` and `/site-model/[name]`. First person walk was only partly confirmed in headless Chromium.
- Plan set (finished stage 3b): `backend/app/agents/sa5_cad_dxf/planset/` (A1 sheets C000 to C600). The 3D scene should use the same lot, driveway, crossover and kerb data so the model and plans agree.
- Contracts: `backend/app/common/contracts.py` (LotContext, DrivewayDesign incl. `kerb_to_boundary_user_supplied`, ServiceLine, OverlayPolygon).
- Docs to read first: `docs/09-handover.md` (platform overview), `docs/03-decisions.md` (owner decisions), `docs/05-viewer-reference.md`, `docs/06-play-mode.md`, `docs/11-jcesite-layer-and-drawing-codes.md`, `docs/12-dbyd-integration-plan.md`, `backend/app/agents/sa5_cad_dxf/planset/STATUS.md`.

## 4. The owner's other tool

The owner will base the 3D tool on another tool he has built. I (the session writing this) have not seen it. He must attach it or give its folder before work starts. The new session must read that tool first, state what it will reuse and what it will not, and confirm with the owner before copying any code. No dwelling content from that tool is to be carried across.

## 5. Test data and commands

- Real offline test lot: Lot 2 DP227508, Gunnedah (rotated lot about 45 x 49 m, 956 m2, R2). Rules JSON: `out/rules/R2_dwelling_house.json` (also `backend/tests/fixtures/R2_dwelling_house_rules.json`).
- Regenerate plan set, from `backend/`: `python3 scripts/run_site.py --offline lot2 --lotplan 2//DP227508 --development-type dwelling_house --levels nsw --rules-json <rules.json> --acknowledge --planset --planset-only --planset-style ref --out <dir>`
- Tests, from `backend/`: `python3 -m pytest tests/test_planset.py tests/test_planset_ref.py tests/test_planset_ref_stage3.py tests/test_planset_ref_stage3b.py tests/test_planset_ref_round2.py -q` (96 passed at handover).
- Known data limits: DEM is 5 m (coarse for small lots, flag it); the offline fixture holds only three adjoining lots; no pavement type is cited in the Gunnedah data, so pavement shows as not selected.

## 6. Known weaknesses at handover (plan set, relevant to 3D)

- Driveway profile falls from kerb toward the lot at about 3.3% (flagged on C400 and C410). The 3D scene should show the same fall.
- DXF has never been opened in AutoCAD or Civil 3D.
- Aerial imagery is low resolution at large scales.
- Sandbox changes are not in the repo `jaydencal/jce`. No commit or push has been made. Pushing needs the owner's explicit go.

## 7. Suggested stages for the 3D work (stop and review after each)

1. Read the owner's other tool and the SA6 code. Report what can be reused. Propose the scene data contract (site only).
2. Terrain, boundary, adjoining lots with labels, road and assumed kerb, with the AI-generated banner.
3. Driveway, crossover, cut and fill, batters, contours, matching the plan set.
4. Viewer polish: orbit, top view, labels, layer toggles matching `JCS-` layers, measurement, screenshots, first person.
5. Exports (glTF or equivalent) and integration with the run pipeline and tests.

## 8. Process the new session should follow

- Cheap subagents (Sonnet) build, a larger subagent (Opus) reviews, before anything is handed back. Keep usage low and report the weekly usage meter after each agent.
- Read-only on services: do not call live paid services without asking.
- Never email or message anyone on the owner's behalf.
