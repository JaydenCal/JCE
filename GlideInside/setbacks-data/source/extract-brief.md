# Council parameter extraction brief (schema v2)

You extract engineering and development parameters for ONE NSW council from that council's own documents.

## Inputs
* Schema: /home/claude/db/schema-v2.json. Read it fully first. It defines the record fields, rules and the controlled parameter dictionary (185 parameters in 12 categories).
* Council text: /home/claude/db/text/<council>/ . One .txt per saved PDF, same relative path as the PDF (DCP/... or Engineering/...). Each file starts with "### FILE: <relative pdf path>" and pages are marked "=== PAGE n ===" (n is the PDF page number).

## Method
1. List the files (find, wc -c) and identify the engineering manuals/specifications, standard drawings, subdivision and residential DCP chapters, parking, flood, stormwater and earthworks chapters. Skim tables of contents.
2. For each category, search with grep (case insensitive, with context, e.g. grep -n -i -E "kerb return|radius" -r) and read the surrounding page text to get the exact value, condition and clause. Use Python to locate the page number: the nearest preceding "=== PAGE n ===" line.
3. Record every value you can evidence. Prefer the engineering manual for civil parameters and the DCP for development controls and setbacks. Where a road or stormwater table gives values per class or AEP, create one record per row.
4. Aim for depth: road hierarchy tables, kerb return radii, cul-de-sac dimensions, pipe minimum diameters, grades, cover, pit spacing, blockage factors, freeboards, OSD, WSUD targets, driveway rules, setbacks, lot sizes, parking rates, sewer and water parameters where the council is the authority.
5. Never use numbers from your own knowledge of Austroads, AUS-SPEC, QUDM or ARR. If the council document only says "in accordance with AUS-SPEC D5", record basis "adopted standard" with value_text naming the standard and clause, and no number.
6. source_file is the relative path from the "### FILE:" line. page is the PDF page number. quote must be copied verbatim from the text (25 words or fewer).
7. If the text of a key file is empty (scanned PDF), list it in gaps as "scanned, no text: <file>".

## Rules added after the pilot review (mandatory)
1. Keys commonly misused: a single traffic lane width goes to roads.traffic_lane_width, never carriageway_width. A table of percentage of theoretical inlet capacity allowed goes to stormwater.inlet_capacity_allowed; inlet_blockage_factor holds the blockage percentage only. Authority, design code, location, basis and method keys hold text only, never numbers. Cover, storage, depth and width keys hold only that quantity. If no key fits, use other:<name> rather than the nearest key.
2. Tables: read table pages with whitespace preserved (do not collapse spaces). Map the column headers first, then write one record per cell with the row label and column label in condition. Never collapse columns into a range and never take only one column. If the columns cannot be resolved, list the table in gaps instead of writing a record.
3. Shared regional documents (e.g. Northern Rivers manuals): record only this council's row or the general rule, never another council's row. Councils with more than one DCP or precinct plan: start condition with the DCP area or precinct name (e.g. "Gloucester DCP area: ...").
4. The quote must contain the recorded number, plus the row label for a table cell.
5. Normalise: for design events also set aep_pct (convert 1 in n year ARI using AEP = 1 - exp(-1/ARI), record both); convert "1 in n" grades to percent in value_num and keep the printed form in value_text; parking rates normalised to spaces per single unit (per 1 dwelling, per 1 child) or per 100 m2 of the stated floor area basis, with the printed form kept in value_text as "printed: ..."; the number is never in the unit field; "2 x 5.5" is 5.5 per side with the condition saying each side.
6. If the council prints the number itself, basis is "stated" even when a standard is cited beside it.
7. Run the validator before finishing: python3 /home/claude/db/validate.py /home/claude/db/out/<council>.json and fix every error it reports.

## Output
Write /home/claude/db/out/<council>.json :
{
 "meta": { council_meta_fields from the schema },
 "records": [ records ]
}
Validate with python (json.load) and check that every record has category, parameter, source_file, page and quote, and that every parameter key exists in the schema dictionary (or starts with "other:"). Spot check 10 of your own records by re-reading the page text and fix any mistakes.

Reply briefly: record count by category, documents used, main gaps.
