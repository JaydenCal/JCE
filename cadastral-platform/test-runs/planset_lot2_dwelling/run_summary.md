# Run summary: 2//DP227508

- Generated: 2026-10-12T17:27:22+00:00 by `scripts/run_site.py`
- Development type: **dwelling_house**
- Location input: `{'lotplan': '2//DP227508'}`
- Lot: 2//DP227508, , zone R2, 956 m2 calculated (registered n/a); SA1 flags ['multi_zone']

| # | Step | Status | Detail |
|---|---|---|---|
| 1 | locate lot | OK | lot identifier 2//DP227508 |
| 2 | SA1 result | OK | 2//DP227508, , 956 m2, zone R2; flags ['multi_zone'] |
| 3 | levels (NSW 5 m DEM) | UNRESOLVED | 144 points, NSW_5M_Elevation ImageServer exportImage, DFSI 2019 (as stated by service copyrightText; no licence text published in service metadata); 5 m DEM (144 points, derived from stereo imagery) is too coarse for detailed cut/fill on a 956 m2 lot; commission a detail survey before relying on earthworks quantities; vertical accuracy UNKNOWN: not stated in NSW_5M_Elevation metadata; 5.0 m placeholder used only so uncertainty is not understated (not a stated figure) |
| 4 | SA2 DCP rules | UNRESOLVED | 4 rule(s) USER ENTERED from ../test-runs/rules/R2_dwelling_house.json (not extracted from a DCP; unverified); not supplied: garage_front, site_cover_max |
| 5 | ENV result | UNRESOLVED | envelope 734 m2; unresolved rules: site_cover_max, height_max; 0 unresolved driveway requirement(s) |
| 6 | FFL (flood) | UNRESOLVED | Obtain the flood level / flood planning level certificate from the council or enter it; dwelling FFL not set from flood. Freeboard: UNRESOLVED |
| 7 | SA3 terrain/earthworks | OK | TIN built from the supplied survey |
| 8 | SA4 result | OK | 0 service assets, 0 connections; 0 unresolved requirement(s); no DBYD/RWT inputs supplied; No service assets supplied; results contain no existing-service constraints.; Depths are never inferred; unknown depths must be confirmed by potholing. All outputs unverified. |
| 9 | SA5 result | OK | 12 annotations |
| 10 | SA5 plan set | OK | 12 sheets; font Liberation Sans Narrow (metric-compatible substitute for the proprietary Arial Narrow; DXF text style 'ARIAL NARROW' -> arialn.ttf); DXF audit errors 0 |
| 11 | SA6 scene bundle | UNRESOLVED | 5 parts; no terrain (no survey) |
| 12 | SA9 constraints report | UNRESOLVED | 18 layers: 4 affected, 2 NOT CHECKED (no endpoint in endpoints_nsw.json, SA9_ENDPOINT_<KEY> or --sa9-endpoints); 4 trigger(s); rules with unresolved values: bushfire.habitable, generic, generic, generic |

## Files
- `../test-runs/planset_lot2_dwelling/plan.dxf`
- `../test-runs/planset_lot2_dwelling/plan.pdf`
- `../test-runs/planset_lot2_dwelling/planset.pdf`
- `../test-runs/planset_lot2_dwelling/planset.dxf`
- `../test-runs/planset_lot2_dwelling/scene_bundle.json`
- `../test-runs/planset_lot2_dwelling/constraints_report.pdf`
- `../test-runs/planset_lot2_dwelling/constraints_report.json`
- `../test-runs/planset_lot2_dwelling/constraints.geojson`
- `run_summary.md`, `run_steps.json`

## Unresolved (nothing below was defaulted)
- Envelope rules: site_cover_max, height_max
- SA9 rules with unresolved values: bushfire.habitable, generic, generic, generic

All outputs are indicative and unverified: the cadastre is not a survey and nothing here is a planning or building approval. Verify setbacks and requirements with the council / certifier.
