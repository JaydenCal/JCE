# Website build log (14/10/2026)

Built against `JCE-Site-Planner-website-brief.md`. Frontend only; no backend, agent or drawing changes.

## Added
- **Status vocabulary** (`frontend/src/components/ui/Status.tsx`, tokens in `globals.css`): layer, requirement, compliance, pathway and run states, each with words and a glyph as well as colour. NOT CHECKED is hatched neutral and is never green. UNRESOLVED shows its reason and next step.
- **Rules as tested code** (`src/lib/status.ts`, `tests/status.test.ts`): "not affected" is never worded as clear; a requirement value shows only if cited or user-entered; PASS/FAIL only from a numeric comparison with a cited value; buffer layers state the screening distance is not a legal threshold.
- **Public pages:** `/how-it-works`, `/example-output`, `/limits`, `/pricing`, `/faq`, `/privacy` (placeholder), `/custom-municipality`. Home claims corrected (coverage is NSW first; council rules loaded for Gunnedah only; the pack is assembled, not lodged).
- **Application:** `/projects/new` (find lot, type, confirm), project workspace with tabs (`(workspace)` route group: overview, constraints, requirements, plans, services, report, pathway, pack, activity, download) and run progress at `/projects/[id]/runs/[runId]` (stages A to F, polls every 2 s).
- **Contract** (`src/lib/types.ts`, `src/lib/api.ts`): the proposed endpoints from brief 6.5. Each returns `{data, sample}`; on 404/405/network failure it falls back to `src/lib/sample.ts` and the page shows a **Sample data** banner.
- Removed the old mock export (it produced fake PDF/DXF blobs).

## Not done (needs backend or a decision from Jayden)
- Every endpoint marked proposed in `api.ts` is missing server-side; until they exist all tabs show sample data. P0: auth, projects CRUD, lot search, wrapping SA9/SA10/SA11/plan set/report/pack into the run, results, artifacts and download, scene.
- Page thumbnails need `/artifacts/{id}/pages/{n}.png`; until then a placeholder is shown.
- Map: `LotMap` draws a plain SVG outline. Basemap provider is open (decision 11).
- Design tab is hidden (feature flag, decision 7). Survey upload and DBYD upload routes have no UI yet.
- Home "Available / In development" step labels need confirming once SA9 to SA11 are in the API run.
- Open decisions that affect copy: 1, 3, 4, 5 (hero uses a real third-party Gunnedah lot), 6, 9.
