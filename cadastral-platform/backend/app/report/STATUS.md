# app/report status

Entry point: `build_site_report(SiteReportInputs) -> (pdf_bytes, json_dict)`. SA9 (`Sa9Constraints.run`) calls it and writes
constraints_report.pdf/json; `scripts/run_site.py --report` also writes site_report.pdf/json and sa9_input.json.

## Done
- A4 report with running header (logo chip, lot, date), footer (page x of y, disclaimer), embedded Jost / IBM Plex fonts (fonts/, OFL).
- Cover (brand logo on ink band, title block, aerial hero), executive summary (tiles, ranked findings, pathway hint, next actions),
  site and zoning page (facts, two aerial figures, adjoining lots), constraint table, one page per active layer (zoomed figure,
  clipped polygons, buffer ring + distance line, what it is / may trigger / next), cited requirements, civil page, appendix.
- No raw dicts; "No cited rule loaded" shown once; Not checked is not clear callouts; acknowledgements verbatim (acks.py, tested).
- Brand contact/ABN printed only if set on Brand.

## Missing / not wired
- sa11 pathway: accepted via `SiteReportInputs.pathway` (dict with headline/reasons/unresolved) but run_site does not call it (module absent).
- Zone objectives not shown (LEP land use table not ingested). QLD layers use generic wording only.
- Requirements for lots outside Gunnedah need backend/knowledge/<lga>/.
- No .docx.

## Known visual issues
- Layer pages can spill the "may trigger / next" blocks onto a second page.
- Aerial fetch is retried once; a failed fetch shows a vector-only figure with a note (seen once as HTTP 500).
- Whole-lot figures for the 509,264 m2 Quia lot cannot zoom below the lot extent.
- Cover logo is large; requirement quotes are truncated to 150 chars; no PDF bookmarks.
