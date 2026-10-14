# Run summary: no lot resolved

- Generated: 2026-10-14T23:19:53+00:00 by `scripts/run_site.py`
- Development type: **dwelling_house**
- Location input: `{'lotplan': '2//DP227508'}`

| # | Step | Status | Detail |
|---|---|---|---|
| 1 | locate lot | OK | lot identifier 2//DP227508 |
| 2 | SA1 cadastre/zoning | FAILED | SA1_UPSTREAM_UNAVAILABLE: https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Cadastre/MapServer/9/query: <urlopen error Tunnel connection failed: 403 Forbidden> |
| 3 | SA2 DCP rules | SKIPPED | upstream SA1 did not produce a lot |
| 4 | ENV setbacks/driveway | SKIPPED | upstream SA1 did not produce a lot |
| 5 | SA3 terrain | SKIPPED | upstream SA1 did not produce a lot |
| 6 | SA4 services/RWT | SKIPPED | upstream SA1 did not produce a lot |
| 7 | SA5 DXF + PDF plan | SKIPPED | upstream SA1 did not produce a lot |
| 8 | SA6 scene bundle | SKIPPED | upstream SA1 did not produce a lot |
| 9 | SA9 constraints | SKIPPED | upstream SA1 did not produce a lot |

## Files
- `run_summary.md`, `run_steps.json`

## Unresolved (nothing below was defaulted)

All outputs are indicative and unverified: the cadastre is not a survey and nothing here is a planning or building approval. Verify setbacks and requirements with the council / certifier.
