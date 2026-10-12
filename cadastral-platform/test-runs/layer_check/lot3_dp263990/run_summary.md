# Run summary: 3//DP263990

- Generated: 2026-10-12T16:39:43+00:00 by `scripts/run_site.py`
- Development type: **dwelling_house**
- Location input: `{'lotplan': '3//DP263990'}`
- Lot: 3//DP263990, , zone RU1, 509264 m2 calculated (registered n/a); SA1 flags ['no_road_data_front_unknown']

| # | Step | Status | Detail |
|---|---|---|---|
| 1 | locate lot | OK | lot identifier 3//DP263990 |
| 2 | SA1 result | OK | 3//DP263990, , 509264 m2, zone RU1; flags ['no_road_data_front_unknown'] |
| 3 | SA2 DCP rules | UNRESOLVED | 0 cited rules for 'dwelling_house'; unresolved: front, side, rear, garage_front, site_cover_max; no DCP document ingested for LGA  (set SA2_DCP_DOCS to ingest a council DCP PDF) |
| 4 | ENV setbacks/driveway | FAILED | NO_FRONT_SEGMENT: no boundary segment flagged is_front |
| 5 | SA3 terrain | SKIPPED | no survey supplied (params.terrain.survey via --params-json); no levels invented |
| 6 | SA4 services/RWT | SKIPPED | needs ENV output |
| 7 | SA5 DXF + PDF plan | SKIPPED | needs ENV and SA4 outputs |
| 8 | SA6 scene bundle | SKIPPED | needs ENV and SA4 outputs |
| 9 | SA9 constraints report | UNRESOLVED | 18 layers: 3 affected, 2 NOT CHECKED (no endpoint in endpoints_nsw.json, SA9_ENDPOINT_<KEY> or --sa9-endpoints); 3 trigger(s); rules with unresolved values: bushfire.habitable, generic, generic |

## Files
- `../test-runs/layer_check/lot3_dp263990/constraints_report.pdf`
- `../test-runs/layer_check/lot3_dp263990/constraints_report.json`
- `../test-runs/layer_check/lot3_dp263990/constraints.geojson`
- `run_summary.md`, `run_steps.json`

## Unresolved (nothing below was defaulted)
- SA2 DCP elements: front, side, rear, garage_front, site_cover_max
- SA9 rules with unresolved values: bushfire.habitable, generic, generic

All outputs are indicative and unverified: the cadastre is not a survey and nothing here is a planning or building approval. Verify setbacks and requirements with the council / certifier.
