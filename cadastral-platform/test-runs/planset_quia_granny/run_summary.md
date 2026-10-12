# Run summary: 3//DP263990

- Generated: 2026-10-12T17:29:52+00:00 by `scripts/run_site.py`
- Development type: **secondary_dwelling**
- Location input: `{'lotplan': '3//DP263990'}`
- Lot: 3//DP263990, , zone RU1, 509264 m2 calculated (registered n/a); SA1 flags ['road_tolerance_widened_to_25m']

| # | Step | Status | Detail |
|---|---|---|---|
| 1 | locate lot | OK | lot identifier 3//DP263990 |
| 2 | SA1 result | OK | 3//DP263990, , 509264 m2, zone RU1; flags ['road_tolerance_widened_to_25m'] |
| 3 | levels (NSW 5 m DEM) | UNRESOLVED | 1848 points, NSW_5M_Elevation ImageServer exportImage, DFSI 2019 (as stated by service copyrightText; no licence text published in service metadata); coarse sampling: every 4th cell used (cap 2000 points) - about 17.1 m mean spacing; vertical accuracy UNKNOWN: not stated in NSW_5M_Elevation metadata; 5.0 m placeholder used only so uncertainty is not understated (not a stated figure) |
| 4 | SA2 DCP rules | UNRESOLVED | 3 rule(s) USER ENTERED from ../test-runs/rules/RU1_secondary_dwelling.json (not extracted from a DCP; unverified); not supplied: garage_front, site_cover_max |
| 5 | ENV result | UNRESOLVED | envelope 470608 m2; unresolved rules: site_cover_max, height_max; 0 unresolved driveway requirement(s) |
| 6 | FFL (flood) | UNRESOLVED | Obtain the flood level / flood planning level certificate from the council or enter it; dwelling FFL not set from flood. Freeboard: UNRESOLVED |
| 7 | SA3 terrain/earthworks | OK | TIN built from the supplied survey |
| 8 | SA4 result | OK | 0 service assets, 0 connections; 0 unresolved requirement(s); no DBYD/RWT inputs supplied; No service assets supplied; results contain no existing-service constraints.; Depths are never inferred; unknown depths must be confirmed by potholing. All outputs unverified. |
| 9 | SA5 result | OK | 13 annotations |
| 10 | SA5 plan set | OK | 12 sheets; font Liberation Sans Narrow (metric-compatible substitute for the proprietary Arial Narrow; DXF text style 'ARIAL NARROW' -> arialn.ttf); DXF audit errors 0 |

## Files
- `../test-runs/planset_quia_granny/plan.dxf`
- `../test-runs/planset_quia_granny/plan.pdf`
- `../test-runs/planset_quia_granny/planset.pdf`
- `../test-runs/planset_quia_granny/planset.dxf`
- `run_summary.md`, `run_steps.json`

## Unresolved (nothing below was defaulted)
- Envelope rules: site_cover_max, height_max

All outputs are indicative and unverified: the cadastre is not a survey and nothing here is a planning or building approval. Verify setbacks and requirements with the council / certifier.
