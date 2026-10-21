# Stage 8 (21/10/2026): typical house on the lot, contour labels, DBYD Phase 0, verification box

Numbering note: this file is `15-stage8-building-dbyd.md`. `15-stage2-status-and-data-access.md` already exists in this folder (the 3D site tool branch), so two documents share the number 15. Neither was renamed; this one is stage 8 of the plan set, report and SoEE (JCESITE).

JCESITE is not affiliated with JCE Infrastructure. These changes supersede the earlier "site only, no dwelling" rule for the plan set, the site report and the SoEE.

## 1. The typical house on the lot

- Source: the Plan Studio (Pocket Architect) `house_single` template, read from `backend/tests/fixtures/planstudio_house_single.planstudio.json` (the fixture was extracted from branch `claude/sweet-meitner-clsyzh`, commit 360c0ed). It is a typical house, not a design for the lot. Every document says so ("PLAN STUDIO TYPICAL HOUSE (INDICATIVE)"). Single storey, 4 bedrooms, indoor area 200.6 m2, attached garage 37.2 m2, roofed alfresco 36.0 m2, hip roof at 22.5 degrees.
- Placement: `app/design/building_place.py` (`load_house`, `cited_setbacks`, `place_house`, `Placement`). Run with `scripts/run_site.py --building <planstudio.json>`; `scripts/run_soee.py` passes the same fixture by default (`--building none` removes it).
- No setback value is typed in code. Each value is read from `knowledge/<lga>/requirements.json` for the lot's zone. A value that is not cited for the zone leaves the building unplaced with the reason. The front setback is applied to every part of the building (garage and alfresco included). Side and rear values are the cited minimums and the building is centred between the side boundaries. The cited garage rule is measured and never adjusted for.
- Lot 2 DP227508 (Gunnedah, R2, frontage 20.23 m): cited values from Gunnedah DCP 2025, C.1.1 Setbacks, Table 2 Building Setbacks, p.37.

| Control | Cited | Provided | Result |
| --- | --- | --- | --- |
| Front boundary | 6.5 m (or the adjoining average, whichever is less; adjoining dwellings not in the data, so 6.5 m is used) | 6.50 m (nearest part is the garage) | Met |
| Side boundary (left, right) | 0.9 m (BCA alternative not applied) | 1.52 m, 1.51 m | Met |
| Rear boundary | 0.9 m (BCA alternative not applied) | 18.84 m | Met |
| Garage 1 m behind the front building line | 1 m behind | 5.99 m forward | NOT MET |

- The template garage projects 6.0 m forward of the dwelling front wall. The layout is not changed to hide this. It is flagged on C000, C101, in the report civil summary and in the SoEE (section 1.5 and the compliance table).
- Finished floor level: TBC. The cited rule sets habitable floor levels at or above the Flood Planning Level (1% AEP flood level plus 0.5 m freeboard). No flood level is in the data and no cited minimum height above ground exists, so no level is assumed. Existing ground under the footprint is RL 264.78 to 265.46 m AHD (5 m DEM, indicative).
- Footprint 280 m2, roof plan area to the eaves 314 m2. The eaves reach into the front setback by 0.4 m (information only: there is no eave rule as such; the cited DCP articulation encroachment of 0.5 m is the allowance the 0.4 m eave falls within, DCP 2025 Table 2, p.38).
- Plan sheets: outline and rows on C000 (cover site plan and BUILDING line), C101 (outline, setback dimensions, "BUILDING SETBACKS (CITED)" table, "SETBACK SOURCES", FFL and flags panels), C200, C300, C310, C400 and C500. C100 stays existing only. The driveway (SA3) is re-planned to the garage door. SA10 (ESC) places stockpiles and laydown outside the footprint (no "NOT DRAWN" schedule on C500).
- Roof water: C300 says the roof catchment area to the eaves (indicative) and "ROOF WATER TO THE LEGAL POINT OF DISCHARGE: NOT DESIGNED". No downpipe, pit or pipe size is drawn. The template rainwater tank is not placed.
- Report: civil summary "Building (indicative typical house)" with the setback table. SoEE: section 1.5 and every section that read "building by others" now describes the dwelling from the building data with the tag TYPICAL HOUSE, INDICATIVE. `app/design/building_place.plain_flags` turns the structured rows into formal sentences.

## 2. Contour labels

`planset/draw.contours` labels each existing contour with its RL (m AHD, two decimals) along the line, upright (never upside down), at the type scale BODY height, never colliding (`View.label` checks reserved boxes and earlier labels). Index contours are labelled first; minor contours are labelled while a view has at most `LABEL_ALL_MAX` of them. Labels avoid the dwelling. They appear on C100, C101, C200, C300, C310, C400 and C500. Contours are faint on purpose (they lie over the aerial). Each plan sheet carries the note CONTOURS ARE 5 m DEM, INDICATIVE.

## 3. Verification box (replaces the AI statement)

"TO BE VERIFIED BY A SUITABLY QUALIFIED PERSON", a tick box and a signature box (NAME, SIGNATURE, DATE), on the FRONT of each document only: plan set cover C000 (large block plus a small block in the cover title block area), site report cover, SoEE cover (PDF and DOCX). The AI draft statement is removed from every footer and every other sheet and page (`app/common/statement.py` holds both constants). The report and SoEE limitations sections keep a factual sentence that the document is to be verified by a suitably qualified person. The 3D scene bundle, the API payloads and `first_design` keep `AI_DRAFT_STATEMENT` (they have no cover page; not changed in this stage). The drawing layer `JCS-FRAM-AICK-*` keeps its code (it now carries the verification block).

## 4. DBYD Phase 0 (manual path of docs/12-dbyd-integration-plan.md)

Modules: `app/integrations/byda/folder_import.py` (importer), `traces.py` (trace store), `view.py` (what the documents say), `app/agents/sa5_cad_dxf/planset/dbyd_draw.py` (sheets), `scripts/dbyd_import.py` (command line).

Command (writes only to `<project>/dbyd/`):

    python3 scripts/dbyd_import.py import --project <project>            # BYDA folder -> <project>/dbyd
    python3 scripts/dbyd_import.py import --project <project> --dry-run                           # read and report only
    python3 scripts/dbyd_import.py trace  --project <project> --owner "Essential Energy" --service electricity --pts "E,N;E,N" --by "Name" --page 87
    python3 scripts/dbyd_import.py verify --project <project> --id <id> --by "Name"
    python3 scripts/dbyd_import.py reject --project <project> --id <id> --by "Name" --reason "..."
    python3 scripts/dbyd_import.py list   --project <project>
    python3 scripts/run_site.py ... --dbyd-project <project>          # plan set, report; run_soee.py takes the same option

- Input layouts: `<project>/BYDA/plans/<combined BYDA responses>.pdf`, `<project>/BYDA/<owner>/<files>` and an optional `byda_status.md`.
- The combined PDF is split per owner from the table parsed from page 1 (owner, status, start page), then each owner's cover page (referral, response date, file table with start pages or Excluded). Nothing is hard coded. Each page is measured (vector path count, raster coverage, text, embedded georeferencing) so the registry says whether each file is vector, raster or text and whether it carries a GeoPDF measure.
- Each owner is registered with job number, referral, plan date (the owner's response date), the validity period stated in the owner's pages (shortest if several, every statement kept with its page) and the date the enquiry plans expire (page 1). Nothing is defaulted: a missing value is stored as null and printed NOT STATED.
- Tracing never promotes by itself. `trace` creates a DRAFT. Only `verify` with a person's name (names such as auto, system, claude, importer are refused) makes a service drawable; `reject` needs a name and a reason. Depths are never inferred.
- Sheets: C100 and C310 draw VERIFIED services only, each labelled with the owner, the plan date and LOCATION INDICATIVE, CONFIRM BY POTHOLING (C300 draws verified stormwater). C310 carries the "EXISTING SERVICES STATUS (BYDA)" table (owner, response status, plans received and what they are made of, draft and verified counts, valid until, expired in red) and a summary panel with an expiry warning (expired, or within `NEAR_DAYS` = 7). The cover SERVICES line, the report (Services and rainwater tank) and the SoEE (sections 2.2 and 3.7.1) state the same counts. With no registry the sheets say EXISTING SERVICES NOT CONFIRMED; with responses but nothing verified they say how many responses were received and that none is drawn.
- Plans are project only. Split plans are stored by `DbydStore` in `<project>/dbyd/plans` and are never written to outputs, the repository or another site; `.gitignore` is not relied on (the project folder is outside the repository). The registry holds no enquirer contact details.
- Real enquiry (local only): one real combined BYDA response was split in a dry run on the developer's machine. Its details (job number, owners' page spans, plan file names, georeference coordinates) are deliberately not recorded here or in the tests. What it showed: five owners were split from the parsed page table; the plans were a mix of vector pages, raster pages and one excluded file (text only); one council plan was vector with an embedded GeoPDF whose coordinate system text did not match its own coordinates (use the embedded latitude and longitude and check before any use). Nothing was traced or verified: all traced counts were zero and no service was drawn from the real plans. The plans stay in the project folder, outside the repository.
- Tests use SYNTHETIC data only (`tests/byda_synthetic.py`: invented owners, job 99000001, stamped "SYNTHETIC TEST DATA"; every drawing, status table and document built from it says SYNTHETIC DEMO DATA). No test reads a real BYDA file.

## 5. Tests

`tests/test_stage8_building_dbyd.py` (25 tests): placement values and sources, footprint clearance by geometry, unmet garage rule and TBC floor level stated, setback dimensions and sources on C101, outline on the building sheets and none on C100, no dwelling without a building, SA10 outside the footprint, contour labels on every plan sheet with no text collisions, verification box on the covers only, DBYD import, split, idempotence, dry run, validity and expiry, trace and verify rules, drawn and undrawn services, status table, synthetic multi-owner splits. Existing tests that asserted the old AI statement were updated.

## 6. Known weaknesses

See `planset/STATUS.md`, `report/STATUS.md` and `pack/STATUS.md` for the current list (garage rule fails for the template, 5 m DEM, no flood level, Telstra DWF excluded, raster plans not auto traceable, 3D scene and API statements unchanged, template rainwater tank not placed, small contour labels).
