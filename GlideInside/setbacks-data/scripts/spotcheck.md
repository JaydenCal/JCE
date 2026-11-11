## Spot check log (15 councils, checked by hand against the record quotes)

Method: for each council, rules were sampled, the parsed zones, uses, storey, lot size and qualifier fields were compared with the original `condition` and `quote`, and the numeric value with the quote. Defects found were fixed in the parsers and the build was rerun; the table records what was found.

| Council | Checked | Result |
|---|---|---|
| Tamworth Regional | R1, R2 (LSM-U, V, AA1), R5 front/side/rear/secondary values against quotes | Values correct. R1 and RU5 side/rear are "BCA" text only (basis ncc, no number). Land size map conditions captured. |
| Albury | R2/R5 zone rules, dwelling-house wall height bands | Values correct. Genuine overlap: zone rules (R2 side 2.5 m) and wall-height rules (side 0.9 m) are different DCP divisions; the picker reports a conflict instead of choosing. |
| Newcastle | lot area and lot width bands | Two defects fixed: "300 m2 or more" was read as "2 or more storeys"; "10.5 m or greater" was not read as a width. Height plane (4:1) tagged as a qualifier. |
| Wagga Wagga | rural and Staunton Estate rules | Correct; precinct and level (first storey / second storey) captured. |
| Blacktown | Growth Centre tables by frontage band | Defect fixed: nested ranges ("9 m to 15 m ... 12.5 m to 15 m") now take the later (narrower) band; "road reserve 18 m" no longer read as a lot width. |
| Liverpool | Edmondson Park tables, garage rules | Defects fixed: "Park" and "Table 5: 1" wrongly created open-space and height-plane qualifiers; "garage behind main face" was stored as a boundary setback. Table values are as extracted (column order not verifiable here). |
| Penrith | storey-based rear setbacks, RU lot-size rules | Correct. |
| Dubbo Regional | business zones, established area averaging | Correct; averaging stored as basis average_neighbours with the established_area qualifier. |
| Orange | Ploughmans Valley and Shiralee DCP areas | Defect fixed: "Ploughmans Lane" street name was read as a laneway qualifier. "Garage projection in front of facade" is no longer treated as a setback behind the facade. |
| Cessnock | Huntlee lot types | Correct; level (second storey) and secondary street values captured. Huntlee lot types are not a field in the schema, so they sit in conditionText only and the rules show as unspecific. Needs owner ruling (see report). |
| Hawkesbury | Jacaranda DCP area, Vineyard Precinct | Correct. The Jacaranda quote prints R2 and R5 values side by side; the extract assigned 8 m to R2 and 10 m to R5. |
| Wollondilly | Menangle heritage area, industrial arterial road | Correct; heritage and classified_road qualifiers keep these out of generic matches. |
| Kiama | South Kiama URA, eaves rule, rural private road | Correct; eaves/gutter rule excluded via building_element qualifier. |
| Port Macquarie-Hastings | garage rules, sheds and pools | Garage rules depend on the dwelling setback (4.5 m threshold) which is not a structured condition; both variants merged into one rule with needsReview flag raised via conditionText. Treat as medium confidence. |
| Bega Valley | Table 3.2 | Two defects fixed: "Medium Density Residential" (zone name) and "Village" were read as multi-dwelling use. |
