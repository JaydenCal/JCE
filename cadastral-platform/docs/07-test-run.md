# 07 Real test run (`backend/scripts/run_site.py`)

Runs the real agents for one NSW location, writes the deliverables and a step log. It needs network access to the NSW
spatial services; the sandbox used for development has none, so the script is only dry-run tested with mocked HTTP
(`backend/tests/test_run_site.py`). Nothing is fabricated: a step with no endpoint, document or requirement is reported
`UNRESOLVED`, `SKIPPED`, `BLOCKED` or `FAILED`.

## Commands (from `cadastral-platform/backend`)

```
python scripts/run_site.py --check-network          # probe every configured host
python scripts/run_site.py --lga Gunnedah --address "756 Quia Road, Gunnedah" \
    --development-type shed --acknowledge --out out/gunnedah
python scripts/run_site.py --lotplan 12//DP345678 --development-type secondary_dwelling --acknowledge
python scripts/run_site.py --random-vacant --lga Gunnedah --seed 7 --buildings-url <footprint layer> --acknowledge
```

`--development-type` is `dwelling_house` (default), `secondary_dwelling`, `shed` or `dual_occupancy` (stub).

## Inputs and configuration

- SA1 endpoints: defaults in `app/agents/sa1_cadastre/clients.py` are UNVERIFIED; override with `SA1_NSW_LOT_URL`,
  `SA1_NSW_ZONING_URL`, `SA1_NSW_GEOCODER_URL`, `SA1_ROADS_URL_NSW` (needed to find the front boundary), etc.
- SA2: `SA2_DCP_DOCS` = JSON list of `{path, lga, title?}` council DCP PDFs. Without it every setback rule is UNRESOLVED.
- SA9: `SA9_ENDPOINT_<LAYER_KEY>` or `--sa9-endpoints file.json`. Layers without an endpoint are reported NOT CHECKED.
- `--random-vacant`: needs `--centre lon,lat` (or `--lga`/`--address` the geocoder can resolve). The cadastre layer does not
  expose land use or valuation data, so vacancy cannot be determined from it. Give `--buildings-url` (or
  `RUN_SITE_BUILDINGS_URL`) for a building-footprint layer; only then is "no building footprint" reported. Otherwise the
  lot is random and vacancy is reported UNVERIFIED. The zone is whatever SA1 returns for the chosen lot.
- `--params-json`: extra run params (`terrain.survey`, `dbyd.*`, `dbyd.occupants`, `dbyd.rwt`). Without a survey, SA3
  terrain is SKIPPED and the scene has no terrain.
- `--acknowledge`: the operator confirms the nine export acknowledgements; without it SA5 is BLOCKED by the export gate.

## Outputs (`--out`, default `out/run_site`)

`plan.dxf`, `plan.pdf` (SA5), `constraints_report.pdf/json` and `constraints.geojson` (SA9), `scene_bundle.json` (SA6),
`run_summary.md`, `run_steps.json`.

## Differences from the orchestrator

The agents are resolved through `default_registry` and the orchestrator's input builders, but there is no Postgres run
ledger. SA4 is built without the orchestrator's SA3 dependency, and SA6 (a stub in the registry) is called directly.
Shed / granny-flat preset dimensions are editable drawing defaults, not compliance limits.
