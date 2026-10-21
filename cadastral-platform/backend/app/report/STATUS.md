# app/report status

Entry point: `build_site_report(SiteReportInputs) -> (pdf_bytes, json_dict)`. SA9 (`Sa9Constraints.run`) calls it and writes
constraints_report.pdf/json; `scripts/run_site.py --report` also writes site_report.pdf/json and sa9_input.json.

## Stage 4 (14/10/2026): JCESITE companion report
- Brand is JCESITE only (`planset.codes.PlatformBrand`, plain text wordmark and tagline as in the plan set title block). A JCE Infrastructure
  Brand object passed as `inputs.brand` is ignored. ABN and contacts print only if the PlatformBrand fields are set (blank by default).
- AI statement (`explain.AI_STATEMENT`) is on the cover (banner and footer) and in the footer of every page.
- New explanatory text lives in `explain.py` (how to read, buffers, per layer WHAT / WHY / NEXT for every key in layers.py REGISTRY, glossary,
  sign off). No requirement value, clause number, Act section or standard number is hard coded there. Generic, widely used terms (section 10.7 planning certificate, BAL, GDA2020, MGA, AHD, DEM, DBYD/BYDA) are named where a reader needs them. Publisher text comes only from the layer's own endpoint
  metadata (`endpoints_nsw.json`); where none is recorded the report prints SOURCE NOT RECORDED.
- Sections, in order: cover, How to read this report, Buffers explained (schematic diagram in `diagrams.py`), What matters, Site and zoning,
  Constraint summary, constraint pages (one per INTERSECTS or WITHIN BUFFER layer), Layer guide (all other layers, same four parts),
  Council requirements for the site, Civil summary, Glossary, Data sources and limitations (sign off, acknowledgements, legal).
- Result vocabulary: INTERSECTS, WITHIN BUFFER (distance), NOT INTERSECTED BY THE DATA LOADED, NOT CHECKED, UNRESOLVED, ASSUMED / PLATFORM DEFAULT.
- Every constraint page carries a "Buffer." caption: screening distance used and its status (SCREENING SETTING from layers.py, CITED RULE only if a
  requirement key containing "buffer" exists for the layer, or UNRESOLVED if the layer is not in the registry). Nothing is hard coded.
- Site only: no footprint is drawn, floor level, setback, outbuilding, parking, secondary dwelling and BASIX requirements and trigger items are
  filtered out (`sections.is_building_key`, `BUILDING_ITEMS`), the dwelling pathway and servicing checks block is removed. Development type is
  recorded only as a run setting.
- Layout: heading styles and spacers use keepWithNext, blocks are KeepTogether, PDF bookmarks (outline, two levels) added, quotes cut at a word
  boundary (`fmt.shorten_quote`), cover logo replaced by the small wordmark, layer pages fit one page in the test set.
- em and en dashes are removed from all text at the `fmt.clean` choke point (numeric ranges become "a to b").
- Tests: tests/test_report_stage4.py (31 tests).

## Review fixes (final2)
- Bookmarks: recorded by `blocks.Bookmark` in a log and replayed on the correct page by `build._Numbered.save` (they all pointed at page 1 before).
- Checkbox drawn as a vector square (`blocks.CheckBox`); test checks every printed character has a glyph in the bundled fonts.
- Requirements: only keys in `sections.REQ_LABELS` are printed (readable labels, unmapped keys dropped); the not found table uses
  `sections.UNRESOLVED_TOPICS` (site level topics only, fixed wording, the knowledge file `reason` text is never printed). Council quotes are still
  printed verbatim from the cited documents (they can contain terms such as AEP).
- Figures: if the aerial has blank bands the window is shrunk to the covered part (`figures._fit_window_to_coverage`), captions state the true extent,
  the scale bar sits on a dark panel, the d label is offset from the line.
- `meta["synthetic_demo"]=True` stamps SYNTHETIC DEMO DATA on the cover, footer, every figure, caption and source line and removes service, host and date provenance.
- Method statement reworded; driveway width, design vehicle and the AS/NZS 2890.1 default are labelled ASSUMED / PLATFORM DEFAULT unless a council standard label is present.
- Glossary corrected (section 10.7, BYDA, layover and layback, BAL, declared districts). Lead sentence says how many layers could not be checked.
- AI-assisted casing fixed, no repository paths in client text, the NOT INTERSECTED chip is neutral grey (not green).
- Acknowledgement A4 contains "any wall over 1.0 m" and other building wording. It is verbatim from the Terms and Conditions (acks.py) and is left unchanged on purpose.

## Missing / not wired
- sa11 pathway: accepted via `SiteReportInputs.pathway` (dict with headline/reasons/unresolved). `scripts/run_site.py` and SA9 do not call
  sa11 (`app/agents/sa11_pathway` exists, is building oriented and is not run in the pipeline), so the report says APPROVAL PATHWAY NOT ASSESSED.
- Zone objectives not shown (LEP land use table not ingested). QLD layers use generic wording only (QLD layer text exists but is untested on a real run).
- Requirements for lots outside Gunnedah need backend/knowledge/<lga>/.
- Acknowledgements (acks.py) are printed verbatim from the Terms and Conditions and some mention building matters (setbacks, retaining walls, FFL).
- No .docx.

## Known visual issues
- Layer pages with many cited requirements or very long feature tables can still run to a second page (clean break between blocks, no split block).
- Aerial fetch is retried once; a failed fetch shows a vector-only figure with a note.
- Whole-lot figures for very large lots cannot zoom below the lot extent.
- The Council requirements section is long for councils with many cited site rules (3 pages for Gunnedah).

## Stage 7 (21/10/2026): planning map extracts
- `maps.py` builds one `PlanMap` per planning control or constraint: the land zoning, then every SA9 layer screened (minimum lot size, height of buildings, floor space ratio, flood, bush fire prone land, heritage item and conservation area, acid sulfate soils, biodiversity, riparian, coastal, land reservation, airport, mine subsidence, contaminated land, road and rail corridors, SEPP land application, urban release). A layer with no entry in `MAP_TITLES` is titled "<short name> Map". `sections_maps.py` is the "Planning maps" section (how to read, map index table, two figures per row, keep-with-next captions). The same `draw_block` draws the figure in the PDF and the PNG written to `planning_maps/` (the SoEE appendix reads those PNGs and `planning_maps` in the JSON).
- Each figure: bold lot outline, adjoining lots, category fills clipped to the extent with tags (zone code, class), legend with the share of the lot per class, north point, scale bar, banners, source line (dataset or instrument, service and layer, data date, retrieval date, copyright text only where the endpoint metadata records it, else LICENCE NOT RECORDED, CONFIRM ATTRIBUTION). Aerial base only if the run has an imagery provider (offline Lot 2 has one).
- Honesty states (`PlanMap.state`): `map`, `no_features` (NOT INTERSECTED BY THE DATA LOADED, never "clear"), `not_checked` (panel "MAP NOT AVAILABLE: LAYER NOT CHECKED (NOT CLEAR)", no map), `attribute_only` (zone attribute only: "ZONE POLYGONS NOT AVAILABLE IN THIS RUN; ZONE FROM ATTRIBUTE, SIMPLIFIED", no boundary drawn), `no_geometry` (result reported but no geometry kept: panel). Area outside the loaded data window is hatched. Offline fixture runs are bannered. `meta["synthetic_demo"]` stamps every figure, panel and PNG.
- Data plumbing: SA9 `LayerResult.map_features` (clipped to the search window, capped at 400, `map_window`, `map_features_truncated`); SA1 `Sa1Result.zone_polygons` (live zoning polygons in a 250 m window, `on_lot` flag) and `zone_source` (service snapshot); `maps.zone_map_from_sa1` makes the JSON safe `Sa9Input.zone_map` / `SiteReportInputs.zone_map`. A multi-zone lot is flagged on the figure ("MULTI-ZONE LOT") and, when only the attribute exists, the saved live run flag `multi_zone_in_saved_live_run` shows "MULTI-ZONE POSSIBLE".
- References: site page (zone, lot size, FSR, height), constraint table ("Map: refer Figure n, Title."), constraint pages, layer guide and the "how a constraint page is laid out" list. Figures 1 to 3 are the cover and site page figures, the planning maps start at Figure 4.
- Synthetic variant: `app/report/demo.py` and `scripts/demo_maps.py --out DIR [--soee-from-run RUN]` (polygons, multi-zone, RU1 and R2 labels, not checked panels). SYNTHETIC DEMO DATA only.
- Tests: tests/test_report_maps.py (27 tests). Fixed on review: the extra bookmark "Planning maps (figures)" pointed at a page without the heading (removed).
- Weaknesses: the offline Lot 2 run has no zone polygons (attribute only) and approximate fixture layer geometry, so only live runs prove polygon zoning and the multi-zone flag on real data. Live SA1 polygon retention is tested with a mock service only. Legend share is the area share of the loaded polygons. A thin class (e.g. 1 percent of the lot) can be too small to see. Each figure is half width, so long source lines wrap to 4 lines. QLD layers have no titles or colours (generic "Map" titles, base colour from the palette).


## Stage 8 (21/10/2026)
- The cover carries the verification block (TO BE VERIFIED BY A SUITABLY QUALIFIED PERSON, tick box, name, signature, date; `sections.py`, `app.common.statement`). `explain.AI_STATEMENT` is now None: no AI statement in any footer or page. The limitations section keeps a factual sentence that the report is to be verified by a suitably qualified person. `build.py` writes the sidecar `verification` object.
- Scope line reads "Site works, with an indicative typical house". The civil summary has a "Building (indicative typical house)" block (source, house, footprint, FFL, cited setback table with provided values and Met or Not met, flags as formal sentences from `building_place.plain_flags`).
- Report maps use the placed footprint when a building is supplied.
- Services and rainwater tank: when a BYDA registry is supplied (`run_site.py --dbyd-project`) the page shows the job, responses, plan validity, the status table, the verified or draft counts, the expiry warning and the project-only note (`dbyd_block`). SYNTHETIC data print a SYNTHETIC DEMO DATA callout.
- Tests: `tests/test_report_stage4.py` (verification on the cover only, no AI statement on any page), `tests/test_report_maps.py`.
- Weakness: the Lot 2 report has no BYDA data, so existing services are "not confirmed".
