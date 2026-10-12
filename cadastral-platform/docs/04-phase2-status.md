# Phase 2 status (2026-10-12): implemented, tested on synthetic data

| Component | Tests | Notes |
|---|---|---|
| Orchestrator + DB layer + API | 62 pass without a DB; agent reports 89 pass with a live Postgres (27 DB tests skipped unless `TEST_DATABASE_URL` is set). One test runs a full run under real RLS as a non-superuser | Login is a dev stub (`X-User-Id`); replace with real auth. Timed-out agent threads cannot be killed; cancellation is cooperative |
| SA7 PDF ingestor and aligner | 40 pass on synthetic reportlab sheets | Not yet tried on real architect or scanned plans. No OCR for raster pages (scale must be user-entered). Slab ranking weights are untuned |
| SA5 DXF and PDF plan export | 13 pass; PDF rendered and inspected | See below |

## SA5 sample sheet (checked by eye)
Shows lot boundary with bearings and distances, building envelope and setback dimensions, slab, driveway and crossover with width/grade note, turning circle with radius, services with exclusion buffers, RWT, council overlay, title block, north arrow, scale bar, legend and the acknowledgement list. Known visual issues: some labels touch linework in dense areas (for example the sewer label and "Garage setback" text), fixed-vs-fixed label overlaps are not resolved, and the sample driveway turning circle (R3.00 m) is test data, not a computed swept path. Real swept-path geometry comes from SA3 in Phase 3.

## Carried into Phase 3
- Schema: `agents.invocations.node_id`; make `agents.state_log.run_id` nullable or add `legal.gate_events` (refused runs are only logged to Python logging today); add `terms_version_id` and `acknowledgements_present` to `plans.plan_uploads`; add the new SA5 layers to `annotations.dxf_layers` (`LAYER_INSERT_SQL` in `layers.py`).
- Contracts: pydantic models for `setback_ruleset`, `building_envelope`, `earthworks_result`, `services_result`, `scene_request`, `scene_bundle`; `level_spots` on `CadRequest`; `warnings`, `fits_sheet`, `suggested_scale_denominator` on `CadResult`; optional control-point residuals and `solver` on `PlanOverlay`.
- Agents: SA1, SA2, SA3 (envelope, TIN, cut/fill, driveway and swept path, retaining walls), SA4 (DBYD parse, sewer/water connections, RWT sizing), SA6 are still stubs.
