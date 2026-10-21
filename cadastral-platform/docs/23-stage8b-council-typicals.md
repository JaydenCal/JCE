# 23. Stage 8b: council typical details loaded as data

Date: 21/10/2026. Local commit only; nothing is pushed.

## 1. Rule

Every dimension, note and clause on a typical detail comes from `knowledge/<council>/typicals.json` through `Typicals.get(key)` and prints with its citation (document, drawing or clause, page).
An entry at confidence 0.7 or lower prints "VERIFY AGAINST SD-107". A key that is NOT FOUND returns nothing and the sheet says so. A council without the file keeps PLATFORM DEFAULT.

## 2. What was built

| Item | Where |
|---|---|
| Data, builder, validator, README | `backend/knowledge/gunnedah/typicals.json`, `typicals_candidates.json`, `typicals_validation.json`, `build_typicals.py`, `README.md` |
| Reader | `planset/typicals.py` (`Typical`, `Typicals`, `Cites.typ`) |
| Cited crossing geometry (C101, C400, C410, C420) | `planset/crossover.py` (`cited_crossing`, `build_crossover(cited=)`) |
| Detail drawings and C600 cells | `planset/typical_details.py`, `sheets_ref2.c600`, `sheets_ref2.c420` |
| Contours | `planset/draw.py` (`CONTOUR_*`) |
| Orientation study | `app/design/building_place.py` (`orient_house`, `orientation_study`), `scripts/run_site.py --building-mirror --building-orientation-study` |

## 3. Citation validation

Quotes are found in the cited document after normalisation (curly quotes, wrapped table text, page footers), the page is inside the document, the numeric value appears in the quote or page.
For SD-107 the number check is a presence check only: each number must appear somewhere on the sheet text, and the check does not test where the number sits on the drawing or that it labels the dimension it is used for. The dimensions are read off the drawing (the clause names the view, confidence 0.7 to 0.9) and a person must confirm them against the PDF; its notes 1 to 15 are verbatim. Table check marks are read from the rendered page. 132 entries, 0 failures.

## 4. Known conflicts and gaps

- DCP C.1.4 does not allow multiple crossings unless the lot has two road frontages; Engineering Standards Table 2-H allows a maximum of 2 per street frontage. One crossing is drawn and C420 and C600 state the conflict.
- SD-107 sheet label says "SL82 FABRIC - SEE NOTE 7" but Note 9 specifies SL82; Note 9 is used.
- NOT PUBLISHED: RD003 (kerb and gutter profile), RD0010 and RD011 (layback), RD007 and RD008, SW009 and SW010, G001 and G002, and any on-lot driveway pavement design. No value is invented.
- OSD: Standards 3.10.4 rules only (BASIX tank, dedicated detention tank, 88B instrument); no L/s is given by the council and none is drawn.

## 5. Orientation study

Eight orientations (as drawn, mirrored, front turned 90, 180, 270, each mirrored) are placed to the cited setbacks and measured against the cited garage rule. Lot 2: none meets the rule with the garage
door to the street. The template stays as drawn and the honest FAIL stays on C101.
