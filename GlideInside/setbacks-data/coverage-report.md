# Setback rules coverage report

Generated 11/11/2026 from `source/setbacks_export.json` (3888 records, 128 councils) by `scripts/build_rules.py`, `scripts/merge_research.py`, `scripts/make_report.py`.

## Summary

| Status | Councils |
|---|---|
| ready | 91 |
| partial | 29 |
| none | 8 |

- Total rules: 2371 (from 3581 extract records; research rules merged: balranald-shire-council, cabonne-council, canada-bay-council-city-of, cobar-shire-council, gwydir-shire-council, hay-shire-council, liverpool-plains-shire-council, north-sydney-council, strathfield-municipal-council, warren-shire-council, willoughby-city-council).
- Fallback sets loaded: NSW, QLD. NSW Housing Code: loaded. QLD QDC: loaded.
- QLD (owner decision 11/11/2026): the QDC default applies to every QLD council, labelled "QDC (default, council planning scheme may vary)"; no QLD council planning scheme lookups at launch.

- **Final status counts: 91 ready, 29 partial, 8 none (128 councils).** An earlier build that counted a council as none only when it had no usable setback record gave 91 / 31 / 6. The final build also sets none when no rule gives a numeric front setback for a dwelling in a residential zone, which moves 8 partial councils to none (broken-hill, canada-bay, hay, mosman, north-sydney, strathfield, waverley, willoughby) and one more ready council to partial; the extra councils are those with averaging-only or side-only controls. Status is presence-based; the zone columns below show what is actually determinable.
- Rules marked `flag: "check_with_council"` (needsReview set or confidence low, owner ruling 11/11/2026): 724 of 2371 rules. All rules are still shown; the flag and `flagReason` let the UI print "check with council".
- Every picked setback carries `clause`, `page`, `source_file`, `dcp` (DCP name), `edition` (document edition/date as printed or UNVERIFIED) and `basis`.

### How status and the basis column are determined

- `ready`: numeric front, side and rear exist for each of R1, R2, R5, RU5 that appears in the council data (or via rules whose zone is not stated). `partial`: some rules but at least one of those zones lacks a numeric front, side or rear (text only, NCC/BCA reference, range, averaging only, or absent). `none`: no records, or no rule with a numeric front setback for a dwelling in a residential zone.
- Basis columns come from running `pickRules` (`pocket-architect-source/src/site/setbacks.js`) for a standard lot per zone: single storey, wall height 3.0 m, building height 5.0 m, not a corner lot, no qualifiers, no precinct (R1/R2/R3 15 m x 600 m2; RU5 20 m x 800 m2; R5 60 m x 5000 m2). `DCP` = the council DCP rules give front, side and rear for that lot. `HC` = DCP could not be determined and the NSW Housing Code fallback gives it. `-` = nothing determinable (the app shows nothing). `DCP?` (HC pending) = DCP not determinable and the fallback set has not been loaded yet.
- DCP is "not determinable" for a lot when a value is only an averaging rule (needs neighbour setbacks), is gated by a qualifier the app cannot know (battle-axe, laneway, classified road, established area, precinct), or two rules of equal specificity disagree. The reason for each is in the `why` of `scripts/simulate.mjs` output and in the council rule file `gaps`.

## Zone basis summary (representative lot)

| Zone | DCP | Housing Code fallback | Nothing |
|---|---|---|---|
| R1 | 29 | 0 | 99 |
| R2 | 31 | 0 | 97 |
| R3 | 27 | 0 | 101 |
| R5 | 33 | 0 | 95 |
| RU5 | 24 | 0 | 104 |

## Councils with status none

- **Broken Hill City Council** (`broken-hill-city-council`): R1: no numeric side/rear setback rule (printed as text, BCA/NCC reference, range, or absent); No secondary (corner lot) frontage setback rule; No garage setback rule; Extraction gaps noted for this council (verbatim, may be partly unrelated to setbacks): DCP has no numeric residential setbacks, lot sizes, site coverage or private open space (merit based; minimum lot size by LEP
- **Cabonne Council** (`cabonne-council`): No rules tagged to R1, R2, R5 or RU5 and none with an unstated residential zone; only other zones or precinct-level text; 6 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, gates): ids 6877, 6878, 6879, 6880, 6881, 6897; Extraction gaps noted for this council (verbatim, ma
- **Cobar Shire Council** (`cobar-shire-council`): No setback records in the extract (no front, side, rear, garage, rural, commercial, industrial or classified road setback values found in the saved council documents).; Extraction gaps noted for this council (verbatim): No DCP, subdivision code or engineering design specification saved for Cobar: dev_controls, setbacks, roads, access, earthworks, water, sewer, services, contrib
- **Gwydir Shire Council** (`gwydir-shire-council`): No setback records in the extract (no front, side, rear, garage, rural, commercial, industrial or classified road setback values found in the saved council documents).; Extraction gaps noted for this council (verbatim): No DCP: no residential setbacks, parking rates, flood planning level, site coverage, OSD, WSUD; Research: No DCP residential setback controls located; dwellings
- **Hay Shire Council** (`hay-shire-council`): No secondary (corner lot) frontage setback rule; No garage setback rule; Extraction gaps noted for this council (verbatim, may be partly unrelated to setbacks): no DCP and no engineering manual or standard drawings saved or in force: the two saved files are the Hay Structure Plan and a Council meeting Business Paper with DA reports | access: driveway width, grade, setbacks and 
- **Mosman Municipal Council** (`mosman-municipal-council`): No secondary (corner lot) frontage setback rule; No garage setback rule; 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, gates): ids 23059, 23088; Extraction gaps noted for this council (verbatim, may be partly unrelated to setbacks): roads: no road hierarchy, reserve o
- **Waverley Council** (`waverley-council`): No secondary (corner lot) frontage setback rule; No garage setback rule; Extraction gaps noted for this council (verbatim, may be partly unrelated to setbacks): DCP B5.2 Table 2 flood planning controls matrix not resolved to cells (layout garbled) | Table 6 loading rates and Table 4 bicycle rates other than residential visitors not recorded
- **Willoughby City Council** (`willoughby-city-council`): No secondary (corner lot) frontage setback rule; No garage setback rule; Extraction gaps noted for this council (verbatim, may be partly unrelated to setbacks): Part B development control tables are images or stripped from the text: RFB site coverage by height, side and rear setbacks, open space, adaptable dwelling numbers, SRI values; the Attachment 1 R2 checklist (setbacks, s

What would be needed for each: the council DCP residential chapter (or a text-extractable copy) with front, side and rear setback tables, or a decision to rely on the NSW Housing Code fallback (the app then labels the result "SEPP Housing Code"). Councils with no extract records at all (balranald, cobar, gwydir, liverpool-plains) have no saved DCP text; councils with records that are not usable (cabonne, warren: rural buffer values only; canada-bay, hay, willoughby: a single non-front value; mosman, north-sydney, strathfield, waverley, broken-hill: averaging or side-only controls without a numeric front) need the front setback table or a streetscape rule the app can evaluate.

## Per council

Zone cells: basis for the representative lot per zone. Counts: extract records used / rules built.

| Council | Status | R1 | R2 | R3 | R5 | RU5 | Records/Rules | Precinct-only | Main gaps |
|---|---|---|---|---|---|---|---|---|---|
| Albury City Council | ready | - | - | - | - | - | 34/16 |  | No garage setback rule; 9 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Armidale Regional Council | partial | DCP | DCP | - | - | - | 24/15 |  | RU5: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent) |
| Ballina Shire Council | ready | - | - | - | - | - | 15/14 |  |  |
| Balranald Shire Council | partial | - | - | - | - | - | 0/1 |  | No setback records in the extract (no front, side, rear, garage, rural, commercial, industrial or classified road setback values found in the saved council docu |
| Bathurst Regional Council | ready | - | - | - | - | - | 17/10 |  | 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Bayside Council | ready | - | DCP | - | - | - | 15/11 |  |  |
| Bega Valley Shire Council | partial | - | - | DCP | - | - | 8/4 |  | R2: no numeric side setback rule (printed as text, BCA/NCC reference, range, or absent); RU5: no numeric side setback rule (printed as text, BCA/NCC reference,  |
| Bellingen Shire Council | partial | - | - | - | - | - | 10/7 |  | R1: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent); R5: no numeric front setback rule (printed as text, BCA/NCC reference,  |
| Berrigan Shire Council | ready | - | - | - | - | - | 18/7 |  | No garage setback rule; 3 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Blacktown City Council | ready | - | - | - | - | - | 73/54 |  | 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Bland Shire Council | partial | - | - | - | - | - | 19/12 |  | R1: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent); R5: no numeric rear setback rule (printed as text, BCA/NCC reference, r |
| Blayney Shire Council | ready | - | - | - | DCP | - | 29/15 |  | 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Blue Mountains City Council | ready | - | - | - | - | - | 18/12 |  | No garage setback rule; 3 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Bogan Shire Council | ready | - | - | - | - | - | 23/14 |  |  |
| Bourke Shire Council | partial | - | - | - | - | - | 12/12 |  | R1: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent); R5: no numeric rear setback rule (printed as text, BCA/NCC reference, r |
| Brewarrina Shire Council | partial | - | - | - | DCP | - | 24/13 |  | RU5: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent); No secondary (corner lot) frontage setback rule; 1 records not modelle |
| Broken Hill City Council | none | - | - | - | - | - | 2/2 |  | R1: no numeric side/rear setback rule (printed as text, BCA/NCC reference, range, or absent); No secondary (corner lot) frontage setback rule; No garage setback |
| Burwood Council | ready | - | - | - | - | - | 18/12 |  | No secondary (corner lot) frontage setback rule; No garage setback rule |
| Byron Shire Council | ready | DCP | DCP | DCP | DCP | DCP | 30/23 |  | No garage setback rule; 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Cabonne Council | none | - | - | - | - | - | 6/0 |  | No rules tagged to R1, R2, R5 or RU5 and none with an unstated residential zone; only other zones or precinct-level text; 6 records not modelled as lot-boundary |
| Camden Council | ready | DCP | DCP | DCP | - | DCP | 46/35 |  | No garage setback rule |
| Campbelltown City Council | ready | - | DCP | DCP | - | - | 39/21 |  | 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| City of Canada Bay | ready | DCP | DCP | - | - | - | 2/3 |  | No secondary (corner lot) frontage setback rule; Research: Side setbacks given by storey only, not lot width or wall height.; Research: Corner-lot rear-dwelling |
| Canterbury-Bankstown Council | ready | - | - | - | - | - | 37/27 |  | No garage setback rule; 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Carrathool Shire Council | partial | - | - | - | - | - | 2/1 |  | RU5: no numeric side/rear setback rule (printed as text, BCA/NCC reference, range, or absent); No garage setback rule |
| Central Coast Council | partial | DCP | DCP | DCP | - | DCP | 24/20 |  | R5: no numeric side/rear setback rule (printed as text, BCA/NCC reference, range, or absent); No garage setback rule; 2 records not modelled as lot-boundary set |
| Central Darling Shire Council | ready | - | - | - | DCP | - | 47/18 |  | 15 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, g |
| Cessnock City Council | ready | - | - | - | - | - | 26/17 |  | No garage setback rule |
| Clarence Valley Council | ready | DCP | DCP | DCP | DCP | - | 24/14 |  | No garage setback rule |
| Cobar Shire Council | none | - | - | - | - | - | 0/0 |  | No setback records in the extract (no front, side, rear, garage, rural, commercial, industrial or classified road setback values found in the saved council docu |
| City of Coffs Harbour (Coffs Harbour City Council) | ready | - | DCP | - | - | - | 18/10 |  | No secondary (corner lot) frontage setback rule; No garage setback rule; 4 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garag |
| Coolamon Shire Council | ready | DCP | DCP | DCP | - | DCP | 22/12 |  | No garage setback rule |
| Coonamble Shire Council | partial | - | - | - | - | - | 18/13 |  | No garage setback rule; 3 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Cootamundra-Gundagai Regional Council | partial | - | - | - | - | - | 10/10 |  | R1: no numeric side/rear setback rule (printed as text, BCA/NCC reference, range, or absent); R5: no numeric side/rear setback rule (printed as text, BCA/NCC re |
| Cowra Council | ready | DCP | DCP | DCP | - | DCP | 31/19 |  | No garage setback rule; 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Cumberland Council | ready | DCP | DCP | DCP | DCP | DCP | 22/14 |  | No garage setback rule |
| Dubbo Regional Council | ready | - | - | - | - | - | 47/36 |  | 4 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Dungog Shire Council | ready | DCP | - | - | - | DCP | 30/17 |  | No garage setback rule; 5 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Edward River Council | partial | - | - | - | - | - | 8/4 |  | No garage setback rule; 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Eurobodalla Shire Council | partial | - | - | - | - | - | 23/20 |  | R5: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent); No garage setback rule; 2 records not modelled as lot-boundary setbacks |
| Fairfield City Council | ready | DCP | DCP | DCP | DCP | DCP | 36/29 |  | 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Federation Council | ready | - | - | - | - | - | 14/7 | yes | All residential rules are tied to named precincts or DCP areas (2); the app must supply the precinct for a lot; 1 records not modelled as lot-boundary setbacks  |
| Forbes Shire Council | ready | - | - | - | - | - | 25/16 |  | No garage setback rule; 3 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Georges River Council | ready | DCP | DCP | DCP | DCP | DCP | 26/22 |  |  |
| Gilgandra Shire Council | partial | - | - | - | DCP | - | 15/11 |  | R1: no numeric side/rear setback rule (printed as text, BCA/NCC reference, range, or absent); RU5: no numeric side/rear setback rule (printed as text, BCA/NCC r |
| Glen Innes Severn Council | partial | - | - | - | - | - | 10/8 |  | R1: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent); R5: no numeric rear setback rule (printed as text, BCA/NCC reference, r |
| Goulburn Mulwaree Council | ready | DCP | DCP | DCP | DCP | DCP | 10/6 |  | No garage setback rule; 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Greater Hume Shire Council | ready | - | - | - | DCP | - | 16/7 |  | No garage setback rule; 5 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Griffith City Council | ready | - | - | - | - | - | 34/19 |  | No garage setback rule; 6 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Gunnedah Shire Council | ready | - | DCP | DCP | - | - | 21/10 |  | 5 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Gwydir Shire Council | none | - | - | - | - | - | 0/0 |  | No setback records in the extract (no front, side, rear, garage, rural, commercial, industrial or classified road setback values found in the saved council docu |
| Hawkesbury City Council | ready | DCP | DCP | DCP | DCP | DCP | 21/13 |  | No garage setback rule; 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Hay Shire Council | none | - | - | - | - | - | 1/1 |  | No secondary (corner lot) frontage setback rule; No garage setback rule; Research: No DCP residential setback controls located; dwellings rely on the LEP and th |
| Hilltops Council | ready | - | - | - | DCP | - | 12/6 |  | No garage setback rule; 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Hornsby Shire Council | ready | - | - | - | - | - | 16/12 |  |  |
| Hunters Hill Council (The Council of the Municipality of Hunters Hill) | ready | - | - | DCP | - | - | 10/9 |  | No secondary (corner lot) frontage setback rule; No garage setback rule |
| Inner West Council | ready | - | - | - | - | - | 21/19 | yes | No garage setback rule; All residential rules are tied to named precincts or DCP areas (2); the app must supply the precinct for a lot |
| Inverell Shire Council | partial | - | - | - | DCP | - | 18/12 |  | R1: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent); RU5: no numeric rear setback rule (printed as text, BCA/NCC reference,  |
| Junee Shire Council | ready | - | - | - | - | - | 42/22 |  | No garage setback rule |
| Kempsey Shire Council | ready | DCP | DCP | DCP | - | - | 52/35 |  | 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Kiama Municipal Council | ready | DCP | DCP | DCP | DCP | - | 30/18 |  | 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Ku-ring-gai Council | ready | - | - | - | - | - | 29/24 |  | No garage setback rule; 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Kyogle Council | ready | - | - | - | DCP | - | 43/29 |  | No garage setback rule; 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Lachlan Shire Council | partial | - | - | - | - | - | 13/9 |  | R5: no numeric side/rear setback rule (printed as text, BCA/NCC reference, range, or absent); RU5: no numeric side/rear setback rule (printed as text, BCA/NCC r |
| Lake Macquarie City Council | ready | - | DCP | DCP | - | - | 13/9 |  | No garage setback rule |
| Lane Cove Municipal Council | ready | - | - | - | - | - | 14/11 |  | No garage setback rule |
| Leeton Shire Council | ready | DCP | DCP | DCP | DCP | - | 27/18 |  | No garage setback rule; 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Lismore City Council | partial | - | - | - | - | - | 8/6 |  | R1: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent); R2: no numeric rear setback rule (printed as text, BCA/NCC reference, r |
| Lithgow City Council | ready | - | - | - | - | - | 51/35 |  | No garage setback rule; 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Liverpool City Council | ready | DCP | DCP | DCP | - | DCP | 127/62 |  | 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Liverpool Plains Shire Council | partial | - | - | - | DCP | - | 0/6 |  | No setback records in the extract (no front, side, rear, garage, rural, commercial, industrial or classified road setback values found in the saved council docu |
| Lockhart Shire Council | ready | - | - | - | DCP | - | 30/10 |  | No garage setback rule; 17 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, |
| Maitland City Council | ready | - | - | - | - | - | 42/29 |  | No garage setback rule |
| MidCoast Council | ready | - | - | - | - | - | 76/32 | yes | All residential rules are tied to named precincts or DCP areas (3); the app must supply the precinct for a lot; 1 records not modelled as lot-boundary setbacks  |
| Mid-Western Regional Council | ready | - | - | - | - | - | 39/25 |  | No garage setback rule |
| Moree Plains Shire Council | ready | DCP | DCP | - | DCP | DCP | 13/10 |  | No garage setback rule |
| Mosman Municipal Council | none | - | - | - | - | - | 12/10 |  | No secondary (corner lot) frontage setback rule; No garage setback rule; 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garag |
| Murray River Council | ready | - | - | - | - | - | 32/25 | yes | No garage setback rule; All residential rules are tied to named precincts or DCP areas (2); the app must supply the precinct for a lot; 1 records not modelled a |
| Murrumbidgee Council | ready | - | - | - | - | - | 36/25 | yes | No garage setback rule; All residential rules are tied to named precincts or DCP areas (2); the app must supply the precinct for a lot; 1 records not modelled a |
| Muswellbrook Shire Council | ready | - | - | - | - | - | 21/15 |  | No garage setback rule; 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Nambucca Valley Council | ready | - | - | - | - | - | 19/11 |  | No garage setback rule; 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Narrabri Shire Council | ready | DCP | DCP | DCP | DCP | DCP | 11/11 |  | No garage setback rule |
| Narrandera Shire Council | ready | - | - | - | - | - | 18/10 |  | No garage setback rule; 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Narromine Shire Council | partial | - | - | - | - | DCP | 22/17 |  | RU5: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent); No garage setback rule; 1 records not modelled as lot-boundary setback |
| City of Newcastle (Newcastle City Council) | ready | - | - | - | - | - | 10/9 |  | No garage setback rule |
| North Sydney Council | partial | - | - | - | - | - | 24/25 |  | R2: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent); No secondary (corner lot) frontage setback rule; No garage setback rule |
| Northern Beaches Council | partial | - | - | - | - | - | 3/2 | yes | No secondary (corner lot) frontage setback rule; No garage setback rule; All residential rules are tied to named precincts or DCP areas (1); the app must supply |
| Oberon Council | partial | - | - | - | - | - | 5/5 |  | No secondary (corner lot) frontage setback rule; No garage setback rule |
| Orange City Council | ready | - | - | - | - | - | 18/13 |  | 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Parkes Shire Council | ready | - | - | - | - | - | 57/39 |  | 6 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| City of Parramatta Council (Parramatta Council of the City of) | ready | DCP | DCP | DCP | DCP | DCP | 32/17 |  | 3 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Penrith City Council | ready | DCP | DCP | DCP | DCP | DCP | 40/26 |  | 6 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Port Macquarie-Hastings Council | ready | DCP | DCP | DCP | DCP | DCP | 23/15 |  | 3 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Port Stephens Council | ready | - | - | - | DCP | - | 28/19 |  | 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Queanbeyan-Palerang Regional Council | ready | - | - | - | - | - | 229/159 | yes | All residential rules are tied to named precincts or DCP areas (5); the app must supply the precinct for a lot; 9 records not modelled as lot-boundary setbacks  |
| Randwick City Council | ready | - | - | - | - | - | 22/18 |  | No secondary (corner lot) frontage setback rule; No garage setback rule |
| Richmond Valley Council | ready | DCP | - | - | - | DCP | 35/23 |  | 6 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| City of Ryde Council | ready | - | - | - | - | - | 17/12 |  |  |
| Shellharbour City Council | ready | DCP | DCP | DCP | DCP | DCP | 22/20 |  | No garage setback rule |
| Shoalhaven City Council | ready | - | - | - | - | - | 51/35 |  | 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Singleton Council | ready | DCP | DCP | - | DCP | DCP | 13/9 |  | No garage setback rule |
| Snowy Monaro Regional Council | ready | - | - | - | - | - | 83/38 | yes | All residential rules are tied to named precincts or DCP areas (4); the app must supply the precinct for a lot; 3 records not modelled as lot-boundary setbacks  |
| Snowy Valleys Council | ready | - | - | - | DCP | - | 22/15 |  | 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Strathfield Municipal Council | partial | - | DCP | - | - | - | 8/7 |  | R1: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent); R2: no numeric front/side setback rule (printed as text, BCA/NCC refere |
| Sutherland Shire Council | ready | - | - | - | - | - | 21/16 |  | No garage setback rule |
| City of Sydney Council | ready | - | - | - | - | - | 9/8 |  | No secondary (corner lot) frontage setback rule; No garage setback rule |
| Tamworth Regional Council | ready | - | - | DCP | - | - | 59/24 |  | 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Temora Shire Council | ready | - | - | - | DCP | - | 12/9 |  | No secondary (corner lot) frontage setback rule; No garage setback rule |
| Tenterfield Shire Council | ready | - | - | - | - | - | 16/10 |  | No garage setback rule |
| The Hills Shire Council | ready | - | - | - | - | - | 45/36 |  | No garage setback rule; 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Tweed Shire Council | ready | - | - | - | - | - | 24/14 |  | No garage setback rule |
| Upper Hunter Shire Council | ready | - | - | - | - | - | 34/25 |  | No garage setback rule; 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Upper Lachlan Shire Council | ready | DCP | DCP | DCP | DCP | - | 28/16 |  | No garage setback rule; 4 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Uralla Shire Council | ready | DCP | - | - | - | DCP | 17/12 |  | No garage setback rule |
| Wagga Wagga City Council | ready | - | - | - | - | - | 43/34 |  | 5 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Walcha Council | partial | - | - | - | DCP | - | 15/8 |  | R1: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent); RU5: no numeric rear setback rule (printed as text, BCA/NCC reference,  |
| Walgett Shire Council | partial | - | - | - | - | - | 11/9 |  | R1: no numeric side/rear setback rule (printed as text, BCA/NCC reference, range, or absent); R5: no numeric rear setback rule (printed as text, BCA/NCC referen |
| Warren Shire Council | partial | - | - | - | DCP | - | 4/1 |  | No rules tagged to R1, R2, R5 or RU5 and none with an unstated residential zone; only other zones or precinct-level text; 4 records not modelled as lot-boundary |
| Warrumbungle Shire Council | ready | DCP | - | - | - | DCP | 17/13 |  |  |
| Waverley Council | none | - | - | - | - | - | 10/9 |  | No secondary (corner lot) frontage setback rule; No garage setback rule |
| Weddin Shire Council | partial | - | - | - | - | - | 15/10 |  | No garage setback rule |
| Wentworth Shire Council | ready | - | - | - | DCP | DCP | 22/17 |  | No garage setback rule; 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Willoughby City Council | none | - | - | - | - | - | 1/1 |  | No secondary (corner lot) frontage setback rule; No garage setback rule; Research: Part B Residential development PDF (13MB) exists but its URL was not exposed  |
| Wingecarribee Shire Council | ready | - | - | - | - | - | 330/223 |  | 41 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, g |
| Wollondilly Shire Council | partial | - | - | - | - | - | 8/6 |  | No secondary (corner lot) frontage setback rule; No garage setback rule; 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garag |
| Wollongong City Council | ready | - | - | - | - | - | 38/24 |  | No garage setback rule; 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Woollahra Municipal Council | ready | - | - | - | - | - | 22/20 |  | No secondary (corner lot) frontage setback rule; No garage setback rule |
| Yass Valley Council | ready | - | - | - | - | - | 41/34 |  | No garage setback rule; 3 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |

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

