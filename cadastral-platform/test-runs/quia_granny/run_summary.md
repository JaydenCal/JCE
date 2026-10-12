# Run summary: 3//DP263990

- Generated: 2026-10-12T16:30:37+00:00 by `scripts/run_site.py`
- Development type: **secondary_dwelling**
- Location input: `{'lga': 'Gunnedah', 'address': '756 Quia Road, Gunnedah'}`
- Lot: 3//DP263990, , zone RU1, 509264 m2 calculated (registered n/a); SA1 flags ['no_road_data_front_unknown']

| # | Step | Status | Detail |
|---|---|---|---|
| 1 | locate lot | OK | address '756 Quia Road, Gunnedah' (geocoded by SA1) |
| 2 | SA1 result | OK | 3//DP263990, , 509264 m2, zone RU1; flags ['no_road_data_front_unknown'] |
| 3 | SA2 DCP rules | UNRESOLVED | 0 cited rules for 'secondary_dwelling'; unresolved: front, side, rear, garage_front, site_cover_max, height_max; no DCP document ingested for LGA  (set SA2_DCP_DOCS to ingest a council DCP PDF) |
| 4 | ENV setbacks/driveway | FAILED | NO_FRONT_SEGMENT: no boundary segment flagged is_front |
| 5 | SA3 terrain | SKIPPED | no survey supplied (params.terrain.survey via --params-json); no levels invented |
| 6 | SA4 services/RWT | SKIPPED | needs ENV output |
| 7 | SA5 DXF + PDF plan | SKIPPED | needs ENV and SA4 outputs |
| 8 | SA6 scene bundle | SKIPPED | needs ENV and SA4 outputs |
| 9 | SA9 constraints report | UNRESOLVED | 18 layers: 0 affected, 18 NOT CHECKED (no endpoint: set SA9_ENDPOINT_<KEY> or --sa9-endpoints); 2 trigger(s); rules with unresolved values: pathway.secondary_dwelling, services.secondary_dwelling |

## Files
- `../test-runs/quia_granny/constraints_report.pdf`
- `../test-runs/quia_granny/constraints_report.json`
- `../test-runs/quia_granny/constraints.geojson`
- `run_summary.md`, `run_steps.json`

## Unresolved (nothing below was defaulted)
- SA2 DCP elements: front, side, rear, garage_front, site_cover_max, height_max
- SA9 rules with unresolved values: pathway.secondary_dwelling, services.secondary_dwelling

All outputs are indicative and unverified: the cadastre is not a survey and nothing here is a planning or building approval. Verify setbacks and requirements with the council / certifier.
