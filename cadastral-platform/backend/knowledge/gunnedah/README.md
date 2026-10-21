# Gunnedah Shire (NSW) knowledge base

Purpose: let test runs for (a) a granny flat and (b) a shed on 756 Quia Road (Lot 3 DP263990, 50.9 ha, RU1) and (c) a new
dwelling on Lot 2 DP227508 (956 m2, R2) resolve requirements from cited sources. Nothing here is defaulted: every value in
`requirements.json` carries an exact quote, PDF page, section reference, source URL, retrieval time and file sha256.

## Files

| File | What |
|---|---|
| `../manifest.json` | Sources: URL, title, version/currency, `retrieved_at`, `sha256`, status (`obtained` / `blocked` + reason) |
| `../raw/` | Downloaded PDFs / HTML / text. **Git-ignored** (`../.gitignore`). Rebuild with `python -m scripts.fetch_docs` |
| `candidates.json` | 113 hand-read candidate rules (exact `quote`, `page`, `section_ref`, `doc`) |
| `build_requirements.py` | Ingests with the SA2 pipeline, runs the SA2 table parser first, validates candidates, writes outputs |
| `requirements.json` | Validated `Requirement` objects (`RequirementSet`-loadable) |
| `unresolved.json` | Everything not resolved, with where it was looked for |
| `validation_report.json` | Candidates validated/rejected, table-parser output, chunk counts |

Rebuild: `python -m scripts.fetch_docs && python -I knowledge/gunnedah/build_requirements.py`
(offline check of downloads: `python -m scripts.fetch_docs --verify`).

## Method and validation

1. `ingest_pdf` (SA2) chunks the PDFs; HTML pages are converted to text by `fetch_docs.html_to_text` and chunked the same way (page 1).
2. SA2's deterministic `parse_setback_table` ran first over every DCP table. It produced 2 rules, both wrong for the requested label:
   Table 5 (outbuilding max height 4.8 m) was parsed as `height_max` for a *dwelling house*. They were discarded. The DCP lays
   zones out as table columns (Table 2) which the parser does not handle, so everything was read manually.
3. Each candidate was kept only if it passed the Requirements Resolver / SA2 rules: the quote is found (after SA2 `norm`) in a chunk
   of the cited document, the cited page lies in that chunk's page range, and for numeric values the number (or its mm/m
   equivalent) appears in the quote. Categorical values (booleans / short text) need the verbatim quote only. `also_quotes`
   (e.g. the zone sentence for a fact-sheet number) must also be found. 113 of 113 candidates passed (one earlier candidate failed
   because the ingester treats short numbered lines as headings, and was dropped).
4. All are `extraction_method="llm"` (read by a model, not the table parser), confidence capped at 0.85. Lower confidence (0.6-0.8) and a
   `prompt` are set where interpretation is involved.

Totals: **113 requirements resolved with citations (83 numeric, 30 categorical)**: DCP 2025 (73), Engineering Standards (18), NSW fact
sheets/pages (22). **19 unresolved groups** in `unresolved.json`. No requirement is in `conflict` status.

Pages: for PDFs `source.page` is the PDF page index. DCP printed page = PDF page - 6 (e.g. Table 2 is PDF p.37, printed p.31).
Engineering Standards PDF page = printed "Page n of 166". HTML sources use page 1.

Key naming: `<topic>.<dwelling_type>.<element>`; selectors carry `lga`, `zone`, `service`. Conditional variants are separate keys
(e.g. `outbuilding.max_cumulative_area_m2.lot_gt_900m2`) so that `RequirementSet.get` never sees equal-specificity conflicts.
Existing registry keys reused: `driveway.min_width_m`, `driveway.max_width_m`, `driveway.min_separation_m`, `water.min_cover_m`.

## What the three test runs can resolve

**R2 dwelling house (Lot 2 DP227508, 956 m2)** (DCP 2025 Table 2 / C.4 / Table 1):
front 6.5 m or neighbours' average if less; side and rear 0.9 m (or BCA); secondary frontage 3 m wall / 5.5 m attached garage; garage
1 m behind building line; parking 2 spaces, one behind the building line; flood: floor at/above FPL (1% AEP + 0.5 m); crossing 3.0-4.5 m wide,
6 m from corner, 2 m between crossings; stormwater per Engineering Standards, OSD where post-development flow exceeds existing; BASIX certificate required.
Lot is above 900 m2, so outbuildings: 100 m2 cumulative, 4.8 m high, 5.5 m from frontages.

**R2 secondary dwelling**: setbacks as dwelling house (C.2.1 refers to C.1.1); 15 m2 private open space min depth 3 m; floor area
60 m2 or 25% of principal, whichever greater (DCP's summary of LEP cl 5.4, so a secondary citation); no extra parking under Housing SEPP, but the
principal dwelling must keep its required spaces; CDC needs lot >= 450 m2; no subdivision.

**RU1 granny flat and shed (Lot 3 DP263990, 50.9 ha)**: DCP D.2 Table 6 setbacks 25 m front/secondary (sealed road) and 10 m side/rear for
"dwelling houses and ancillary structures" (applied to secondary dwelling at confidence 0.6, confirm with Council); farm buildings D.3: 25 m / 10 m, 7 m height cap only
for sites < 10 ha (does not bite at 50.9 ha); 10 m from hilltop/ridge; alternative all-weather access material allowed in RU1; design vehicle 12.5 m HRV, gates recessed,
450 mm minimum rural culvert; unserviced lot needs 60,000 L tank (excluding firefighting water); flood and 15% slope geotech triggers; RWT exempt rules (10 m from
boundary in RU1).

## Conflicts, tensions and quality flags

* No formal `conflict` status. Tension: Engineering Standards Table 2-H allows 2 crossings per frontage, DCP C.1.4(d) says multiple access points are not
  permitted unless the lot has two frontages. Flagged via `prompt` on `driveway.max_crossings_per_frontage`.
* DCP Table 6 lists **200 m** for unsealed roads in RU1 (sealed 25 m). Recorded verbatim at confidence 0.7 with a confirm prompt; probably a typo, not altered.
* The NSW rainwater-tank fact sheet says "zoned rather than RU1 ..." (garbled "other than"). Recorded at confidence 0.7.
* Fact sheets are dated 2022; the Codes SEPP has been amended since. Treat `carport.exempt.*` and `rwt.exempt.*` as indicative until checked against the SEPP.
* `carport.exempt.*` is **not** shed data. No exempt shed numbers (area, height, setbacks) could be sourced.
* `basix.water.max_reduction_target_pct` is the 0-40% ceiling, not Gunnedah's climate-zone target.

## Documents that could not be obtained

| Document | Why / attempt | Substitute |
|---|---|---|
| Gunnedah LEP 2012 (legislation.nsw.gov.au epi-2012-0304) | Cloudflare 403 for curl and headless Chromium (waited 30 s); AustLII same 403; web.archive.org connection reset | none; only DCP's mentions of cl 5.4, 5.21 |
| SEPP (Housing) 2021 | same Cloudflare block | NSW Planning secondary dwellings FAQ page |
| SEPP (Exempt and Complying Development Codes) 2008 | same | NSW fact sheets (2022): carports, rainwater tanks; shed sheet has no numbers |
| Planning for Bush Fire Protection 2019 | rfs.nsw.gov.au Cloudflare 403; not mirrored on planning.nsw.gov.au / planningportal | NSW 10/50 page only |
| Gunnedah Floodplain Management Plan 1999 (2014 update) | downloaded but scanned image PDF, no text layer; needs OCR | DCP B.5 |
| Council On-site sewage policy, Building over Sewer Policy, standard drawings | not found on council site | none |

The bot-blocked sources are recorded as `status: blocked` in the manifest with the reason. `fetch_docs.py --try-blocked` retries them (a
different network or a manually saved copy in `raw/` + manifest edit would unblock them; then add candidates and rerun the builder).

## Council typical details (stage 8b)

`typicals.json` holds the council TYPICAL DETAIL values the plan set draws (SD-107 Rev A vehicle crossover, Engineering Standards crossings, driveway, verge corridors, drainage,
OSD, DCP driveway statements). It is generated, not typed: `typicals_candidates.json` (the research output plus Table 2-I rows) goes through `build_typicals.py`, which checks every
entry against the council PDFs and writes `typicals.json` and `typicals_validation.json`.

    cd knowledge/gunnedah && python3 -I build_typicals.py --pdf-dir <folder with the council PDFs>

Entry: key, value, unit, numeric, doc (documents table: title, edition, URL, short and tag), clause (or the SD-107 drawing view), page (Engineering Standards: printed "Page n of 166";
DCP: PDF index, printed number is that minus 6; SD-107 is a single sheet), quote (normalised text found in the cited page), confidence, verify (true at 0.7 or lower), status.
`NOT FOUND` entries (RD003 kerb and gutter profile, RD0010 and RD011 layback drawings, RD007 and RD008, pavement design 2.12 and 2.13, G001 and G002 and others) carry a label and no value:
the drawings print "NOT PUBLISHED, OBTAIN FROM COUNCIL". Python reader: `app/agents/sa5_cad_dxf/planset/typicals.py`.

