# Setback rules coverage report

Generated 11/11/2026 from `source/setbacks_export.json` (3888 records, 128 councils) by `scripts/build_rules.py`, `scripts/merge_research.py`, `scripts/make_report.py`.

## Summary

| Status | Councils |
|---|---|
| ready | 91 |
| partial | 29 |
| none | 8 |

- Total rules: 2371 (from 3581 extract records; research rules merged: balranald-shire-council, cabonne-council, canada-bay-council-city-of, cobar-shire-council, gwydir-shire-council, hay-shire-council, liverpool-plains-shire-council, north-sydney-council, strathfield-municipal-council, warren-shire-council, willoughby-city-council).
- Fallback sets loaded: NSW, NSW_INLAND, QLD. NSW Housing Code: loaded. QLD QDC: loaded.
- QLD (owner decision 11/11/2026): the QDC default applies to every QLD council, labelled "QDC MP1.1 (default; council planning scheme or the Queensland Housing Code may vary)"; MP1.1 only (lots 450 m2 and under), lots over 450 m2 return null until MP1.2 is verified; no QLD council planning scheme lookups at launch.

- **Final status counts after merging the research for the 11 councils: 91 ready, 29 partial, 8 none (128 councils).** Before the research merge the build gave 90 ready / 24 partial / 14 none; an earlier presence-only build gave 91 / 31 / 6 (it did not set none for councils whose only rules lack a numeric front setback). Research moved 6 of the 14 none councils to partial or ready (see per-council table); the 8 still none are councils with no DCP setback rules found (balranald and the other Inland Code councils listed below keep a Part 3D fallback). Status is presence-based; the zone columns show what is actually determinable.
- Rules marked `flag: "check_with_council"` (needsReview set or confidence low, owner ruling 11/11/2026): 724 of 2371 rules. All rules are still shown; the flag and `flagReason` let the UI print "check with council".
- Every picked setback carries `clause`, `page`, `source_file`, `dcp` (DCP name), `edition` (document edition/date as printed or UNVERIFIED) and `basis`.

### How status and the basis column are determined

- `ready`: numeric front, side and rear exist for each of R1, R2, R5, RU5 that appears in the council data (or via rules whose zone is not stated). `partial`: some rules but at least one of those zones lacks a numeric front, side or rear (text only, NCC/BCA reference, range, averaging only, or absent). `none`: no records, or no rule with a numeric front setback for a dwelling in a residential zone.
- Basis columns come from running `pickRules` (`pocket-architect-source/src/site/setbacks.js`) for a standard lot per zone: single storey, wall height 3.0 m, building height 5.0 m, not a corner lot, no qualifiers, no precinct (R1/R2/R3 15 m x 600 m2; RU5 20 m x 800 m2; R5 60 m x 5000 m2). `DCP` = the council DCP rules give front, side and rear for that lot. `HC` = DCP could not be determined and the NSW Codes SEPP Housing Code fallback gives it; `IC` = the Inland Code (Part 3D) gives it, for the inland councils. `-` = nothing determinable (the app shows nothing). `DCP?` (HC pending) = DCP not determinable and the fallback set has not been loaded yet.
- DCP is "not determinable" for a lot when a value is only an averaging rule (needs neighbour setbacks), is gated by a qualifier the app cannot know (battle-axe, laneway, classified road, established area, precinct), or two rules of equal specificity disagree. The reason for each is in the `why` of `scripts/simulate.mjs` output and in the council rule file `gaps`.

## Zone basis summary (representative lot)

| Zone | DCP | Code fallback (Housing Code, or Inland Code for inland LGAs) | Nothing (no envelope) |
|---|---|---|---|
| R1 | 29 | 99 | 0 |
| R2 | 31 | 97 | 0 |
| R3 | 27 | 101 | 0 |
| R5 | 33 | 6 | 89 |
| RU5 | 24 | 104 | 0 |

## Councils with status none

- **Broken Hill City Council** (`broken-hill-city-council`): R1: no numeric side/rear setback rule (printed as text, BCA/NCC reference, range, or absent); No secondary (corner lot) frontage setback rule; No garage setback rule; Extraction gaps noted for this council (verbatim, may be partly unrelated to setbacks): DCP has no numeric residential setbacks, lot sizes, site coverage or private open space (merit based; minimum lot size by LEP
- **Cabonne Council** (`cabonne-council`): No rules tagged to R1, R2, R5 or RU5 and none with an unstated residential zone; only other zones or precinct-level text; 6 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, gates): ids 6877, 6878, 6879, 6880, 6881, 6897; Extraction gaps noted for this council (verbatim, ma
- **Cobar Shire Council** (`cobar-shire-council`): No setback records in the extract (no front, side, rear, garage, rural, commercial, industrial or classified road setback values found in the saved council documents).; Extraction gaps noted for this council (verbatim): No DCP, subdivision code or engineering design specification saved for Cobar: dev_controls, setbacks, roads, access, earthworks, water, sewer, services, contrib
- **Gwydir Shire Council** (`gwydir-shire-council`): No setback records in the extract (no front, side, rear, garage, rural, commercial, industrial or classified road setback values found in the saved council documents).; Extraction gaps noted for this council (verbatim): No DCP: no residential setbacks, parking rates, flood planning level, site coverage, OSD, WSUD; Research: No DCP residential setback controls located; dwellings
- **Hay Shire Council** (`hay-shire-council`): No secondary (corner lot) frontage setback rule; No garage setback rule; Extraction gaps noted for this council (verbatim, may be partly unrelated to setbacks): no DCP and no engineering manual or standard drawings saved or in force: the two saved files are the Hay Structure Plan and a Council meeting Business Paper with DA reports | access: driveway width, grade, setbacks and 
- **Mosman Municipal Council** (`mosman-municipal-council`): No secondary (corner lot) frontage setback rule; No garage setback rule; 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, gates): ids 23059, 23088; Extraction gaps noted for this council (verbatim, may be partly unrelated to setbacks): roads: no road hierarchy, reserve o
- **Waverley Council** (`waverley-council`): No secondary (corner lot) frontage setback rule; No garage setback rule; Extraction gaps noted for this council (verbatim, may be partly unrelated to setbacks): DCP B5.2 Table 2 flood planning controls matrix not resolved to cells (layout garbled) | Table 6 loading rates and Table 4 bicycle rates other than residential visitors not recorded
- **Willoughby City Council** (`willoughby-city-council`): No secondary (corner lot) frontage setback rule; No garage setback rule; Extraction gaps noted for this council (verbatim, may be partly unrelated to setbacks): Part B development control tables are images or stripped from the text: RFB site coverage by height, side and rear setbacks, open space, adaptable dwelling numbers, SRI values; the Attachment 1 R2 checklist (setbacks, s

Research for the 11 originally expected councils is merged (flagged check_with_council); those still none have no usable DCP setbacks. The Inland Code list has only 8 of 69 LGAs (TODO: add the rest in merge_research.py INLAND). What would be needed for each: the council DCP residential chapter (or a text-extractable copy) with front, side and rear setback tables, or a decision to rely on the NSW Housing Code fallback (the app then labels the result "SEPP Housing Code"). Councils with no extract records at all (balranald, cobar, gwydir, liverpool-plains) have no saved DCP text; councils with records that are not usable (cabonne, warren: rural buffer values only; canada-bay, hay, willoughby: a single non-front value; mosman, north-sydney, strathfield, waverley, broken-hill: averaging or side-only controls without a numeric front) need the front setback table or a streetscape rule the app can evaluate.

## Per council

Zone cells: basis for the representative lot per zone. Counts: extract records used / rules built.

| Council | Status | R1 | R2 | R3 | R5 | RU5 | Records/Rules | Precinct-only | Main gaps |
|---|---|---|---|---|---|---|---|---|---|
| Albury City Council | ready | HC | HC | HC | - | HC | 34/16 |  | No garage setback rule; 9 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Armidale Regional Council | partial | DCP | DCP | HC | - | HC | 24/15 |  | RU5: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent) |
| Ballina Shire Council | ready | HC | HC | HC | - | HC | 15/14 |  |  |
| Balranald Shire Council | partial | IC | IC | IC | IC | IC | 0/1 |  | No setback records in the extract (no front, side, rear, garage, rural, commercial, industrial or classified road setback values found in the saved council docu |
| Bathurst Regional Council | ready | HC | HC | HC | - | HC | 17/10 |  | 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Bayside Council | ready | HC | DCP | HC | - | HC | 15/11 |  |  |
| Bega Valley Shire Council | partial | HC | HC | DCP | - | HC | 8/4 |  | R2: no numeric side setback rule (printed as text, BCA/NCC reference, range, or absent); RU5: no numeric side setback rule (printed as text, BCA/NCC reference,  |
| Bellingen Shire Council | partial | HC | HC | HC | - | HC | 10/7 |  | R1: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent); R5: no numeric front setback rule (printed as text, BCA/NCC reference,  |
| Berrigan Shire Council | ready | HC | HC | HC | - | HC | 18/7 |  | No garage setback rule; 3 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Blacktown City Council | ready | HC | HC | HC | - | HC | 73/54 |  | 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Bland Shire Council | partial | HC | HC | HC | - | HC | 19/12 |  | R1: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent); R5: no numeric rear setback rule (printed as text, BCA/NCC reference, r |
| Blayney Shire Council | ready | HC | HC | HC | DCP | HC | 29/15 |  | 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Blue Mountains City Council | ready | HC | HC | HC | - | HC | 18/12 |  | No garage setback rule; 3 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Bogan Shire Council | ready | HC | HC | HC | - | HC | 23/14 |  |  |
| Bourke Shire Council | partial | HC | HC | HC | - | HC | 12/12 |  | R1: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent); R5: no numeric rear setback rule (printed as text, BCA/NCC reference, r |
| Brewarrina Shire Council | partial | HC | HC | HC | DCP | HC | 24/13 |  | RU5: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent); No secondary (corner lot) frontage setback rule; 1 records not modelle |
| Broken Hill City Council | none | HC | HC | HC | - | HC | 2/2 |  | R1: no numeric side/rear setback rule (printed as text, BCA/NCC reference, range, or absent); No secondary (corner lot) frontage setback rule; No garage setback |
| Burwood Council | ready | HC | HC | HC | - | HC | 18/12 |  | No secondary (corner lot) frontage setback rule; No garage setback rule |
| Byron Shire Council | ready | DCP | DCP | DCP | DCP | DCP | 30/23 |  | No garage setback rule; 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Cabonne Council | none | IC | IC | IC | IC | IC | 6/0 |  | No rules tagged to R1, R2, R5 or RU5 and none with an unstated residential zone; only other zones or precinct-level text; 6 records not modelled as lot-boundary |
| Camden Council | ready | DCP | DCP | DCP | - | DCP | 46/35 |  | No garage setback rule |
| Campbelltown City Council | ready | HC | DCP | DCP | - | HC | 39/21 |  | 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| City of Canada Bay | ready | DCP | DCP | HC | - | HC | 2/3 |  | No secondary (corner lot) frontage setback rule; Research: Side setbacks given by storey only, not lot width or wall height.; Research: Corner-lot rear-dwelling |
| Canterbury-Bankstown Council | ready | HC | HC | HC | - | HC | 37/27 |  | No garage setback rule; 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Carrathool Shire Council | partial | IC | IC | IC | IC | IC | 2/1 |  | RU5: no numeric side/rear setback rule (printed as text, BCA/NCC reference, range, or absent); No garage setback rule |
| Central Coast Council | partial | DCP | DCP | DCP | - | DCP | 24/20 |  | R5: no numeric side/rear setback rule (printed as text, BCA/NCC reference, range, or absent); No garage setback rule; 2 records not modelled as lot-boundary set |
| Central Darling Shire Council | ready | HC | HC | HC | DCP | HC | 47/18 |  | 15 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, g |
| Cessnock City Council | ready | HC | HC | HC | - | HC | 26/17 |  | No garage setback rule |
| Clarence Valley Council | ready | DCP | DCP | DCP | DCP | HC | 24/14 |  | No garage setback rule |
| Cobar Shire Council | none | IC | IC | IC | IC | IC | 0/0 |  | No setback records in the extract (no front, side, rear, garage, rural, commercial, industrial or classified road setback values found in the saved council docu |
| City of Coffs Harbour (Coffs Harbour City Council) | ready | HC | DCP | HC | - | HC | 18/10 |  | No secondary (corner lot) frontage setback rule; No garage setback rule; 4 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garag |
| Coolamon Shire Council | ready | DCP | DCP | DCP | - | DCP | 22/12 |  | No garage setback rule |
| Coonamble Shire Council | partial | HC | HC | HC | - | HC | 18/13 |  | No garage setback rule; 3 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Cootamundra-Gundagai Regional Council | partial | HC | HC | HC | - | HC | 10/10 |  | R1: no numeric side/rear setback rule (printed as text, BCA/NCC reference, range, or absent); R5: no numeric side/rear setback rule (printed as text, BCA/NCC re |
| Cowra Council | ready | DCP | DCP | DCP | - | DCP | 31/19 |  | No garage setback rule; 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Cumberland Council | ready | DCP | DCP | DCP | DCP | DCP | 22/14 |  | No garage setback rule |
| Dubbo Regional Council | ready | HC | HC | HC | - | HC | 47/36 |  | 4 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Dungog Shire Council | ready | DCP | HC | HC | - | DCP | 30/17 |  | No garage setback rule; 5 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Edward River Council | partial | HC | HC | HC | - | HC | 8/4 |  | No garage setback rule; 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Eurobodalla Shire Council | partial | HC | HC | HC | - | HC | 23/20 |  | R5: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent); No garage setback rule; 2 records not modelled as lot-boundary setbacks |
| Fairfield City Council | ready | DCP | DCP | DCP | DCP | DCP | 36/29 |  | 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Federation Council | ready | HC | HC | HC | - | HC | 14/7 | yes | All residential rules are tied to named precincts or DCP areas (2); the app must supply the precinct for a lot; 1 records not modelled as lot-boundary setbacks  |
| Forbes Shire Council | ready | HC | HC | HC | - | HC | 25/16 |  | No garage setback rule; 3 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Georges River Council | ready | DCP | DCP | DCP | DCP | DCP | 26/22 |  |  |
| Gilgandra Shire Council | partial | HC | HC | HC | DCP | HC | 15/11 |  | R1: no numeric side/rear setback rule (printed as text, BCA/NCC reference, range, or absent); RU5: no numeric side/rear setback rule (printed as text, BCA/NCC r |
| Glen Innes Severn Council | partial | HC | HC | HC | - | HC | 10/8 |  | R1: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent); R5: no numeric rear setback rule (printed as text, BCA/NCC reference, r |
| Goulburn Mulwaree Council | ready | DCP | DCP | DCP | DCP | DCP | 10/6 |  | No garage setback rule; 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Greater Hume Shire Council | ready | HC | HC | HC | DCP | HC | 16/7 |  | No garage setback rule; 5 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Griffith City Council | ready | HC | HC | HC | - | HC | 34/19 |  | No garage setback rule; 6 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Gunnedah Shire Council | ready | HC | DCP | DCP | - | HC | 21/10 |  | 5 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Gwydir Shire Council | none | IC | IC | IC | IC | IC | 0/0 |  | No setback records in the extract (no front, side, rear, garage, rural, commercial, industrial or classified road setback values found in the saved council docu |
| Hawkesbury City Council | ready | DCP | DCP | DCP | DCP | DCP | 21/13 |  | No garage setback rule; 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Hay Shire Council | none | IC | IC | IC | IC | IC | 1/1 |  | No secondary (corner lot) frontage setback rule; No garage setback rule; Research: No DCP residential setback controls located; dwellings rely on the LEP and th |
| Hilltops Council | ready | HC | HC | HC | DCP | HC | 12/6 |  | No garage setback rule; 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Hornsby Shire Council | ready | HC | HC | HC | - | HC | 16/12 |  |  |
| Hunters Hill Council (The Council of the Municipality of Hunters Hill) | ready | HC | HC | DCP | - | HC | 10/9 |  | No secondary (corner lot) frontage setback rule; No garage setback rule |
| Inner West Council | ready | HC | HC | HC | - | HC | 21/19 | yes | No garage setback rule; All residential rules are tied to named precincts or DCP areas (2); the app must supply the precinct for a lot |
| Inverell Shire Council | partial | HC | HC | HC | DCP | HC | 18/12 |  | R1: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent); RU5: no numeric rear setback rule (printed as text, BCA/NCC reference,  |
| Junee Shire Council | ready | HC | HC | HC | - | HC | 42/22 |  | No garage setback rule |
| Kempsey Shire Council | ready | DCP | DCP | DCP | - | HC | 52/35 |  | 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Kiama Municipal Council | ready | DCP | DCP | DCP | DCP | HC | 30/18 |  | 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Ku-ring-gai Council | ready | HC | HC | HC | - | HC | 29/24 |  | No garage setback rule; 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Kyogle Council | ready | HC | HC | HC | DCP | HC | 43/29 |  | No garage setback rule; 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Lachlan Shire Council | partial | HC | HC | HC | - | HC | 13/9 |  | R5: no numeric side/rear setback rule (printed as text, BCA/NCC reference, range, or absent); RU5: no numeric side/rear setback rule (printed as text, BCA/NCC r |
| Lake Macquarie City Council | ready | HC | DCP | DCP | - | HC | 13/9 |  | No garage setback rule |
| Lane Cove Municipal Council | ready | HC | HC | HC | - | HC | 14/11 |  | No garage setback rule |
| Leeton Shire Council | ready | DCP | DCP | DCP | DCP | HC | 27/18 |  | No garage setback rule; 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Lismore City Council | partial | HC | HC | HC | - | HC | 8/6 |  | R1: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent); R2: no numeric rear setback rule (printed as text, BCA/NCC reference, r |
| Lithgow City Council | ready | HC | HC | HC | - | HC | 51/35 |  | No garage setback rule; 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Liverpool City Council | ready | DCP | DCP | DCP | - | DCP | 127/62 |  | 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Liverpool Plains Shire Council | partial | IC | IC | IC | DCP | IC | 0/6 |  | No setback records in the extract (no front, side, rear, garage, rural, commercial, industrial or classified road setback values found in the saved council docu |
| Lockhart Shire Council | ready | HC | HC | HC | DCP | HC | 30/10 |  | No garage setback rule; 17 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, |
| Maitland City Council | ready | HC | HC | HC | - | HC | 42/29 |  | No garage setback rule |
| MidCoast Council | ready | HC | HC | HC | - | HC | 76/32 | yes | All residential rules are tied to named precincts or DCP areas (3); the app must supply the precinct for a lot; 1 records not modelled as lot-boundary setbacks  |
| Mid-Western Regional Council | ready | HC | HC | HC | - | HC | 39/25 |  | No garage setback rule |
| Moree Plains Shire Council | ready | DCP | DCP | HC | DCP | DCP | 13/10 |  | No garage setback rule |
| Mosman Municipal Council | none | HC | HC | HC | - | HC | 12/10 |  | No secondary (corner lot) frontage setback rule; No garage setback rule; 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garag |
| Murray River Council | ready | HC | HC | HC | - | HC | 32/25 | yes | No garage setback rule; All residential rules are tied to named precincts or DCP areas (2); the app must supply the precinct for a lot; 1 records not modelled a |
| Murrumbidgee Council | ready | HC | HC | HC | - | HC | 36/25 | yes | No garage setback rule; All residential rules are tied to named precincts or DCP areas (2); the app must supply the precinct for a lot; 1 records not modelled a |
| Muswellbrook Shire Council | ready | HC | HC | HC | - | HC | 21/15 |  | No garage setback rule; 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Nambucca Valley Council | ready | HC | HC | HC | - | HC | 19/11 |  | No garage setback rule; 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Narrabri Shire Council | ready | DCP | DCP | DCP | DCP | DCP | 11/11 |  | No garage setback rule |
| Narrandera Shire Council | ready | HC | HC | HC | - | HC | 18/10 |  | No garage setback rule; 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Narromine Shire Council | partial | HC | HC | HC | - | DCP | 22/17 |  | RU5: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent); No garage setback rule; 1 records not modelled as lot-boundary setback |
| City of Newcastle (Newcastle City Council) | ready | HC | HC | HC | - | HC | 10/9 |  | No garage setback rule |
| North Sydney Council | partial | HC | HC | HC | - | HC | 24/25 |  | R2: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent); No secondary (corner lot) frontage setback rule; No garage setback rule |
| Northern Beaches Council | partial | HC | HC | HC | - | HC | 3/2 | yes | No secondary (corner lot) frontage setback rule; No garage setback rule; All residential rules are tied to named precincts or DCP areas (1); the app must supply |
| Oberon Council | partial | HC | HC | HC | - | HC | 5/5 |  | No secondary (corner lot) frontage setback rule; No garage setback rule |
| Orange City Council | ready | HC | HC | HC | - | HC | 18/13 |  | 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Parkes Shire Council | ready | HC | HC | HC | - | HC | 57/39 |  | 6 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| City of Parramatta Council (Parramatta Council of the City of) | ready | DCP | DCP | DCP | DCP | DCP | 32/17 |  | 3 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Penrith City Council | ready | DCP | DCP | DCP | DCP | DCP | 40/26 |  | 6 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Port Macquarie-Hastings Council | ready | DCP | DCP | DCP | DCP | DCP | 23/15 |  | 3 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Port Stephens Council | ready | HC | HC | HC | DCP | HC | 28/19 |  | 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Queanbeyan-Palerang Regional Council | ready | HC | HC | HC | - | HC | 229/159 | yes | All residential rules are tied to named precincts or DCP areas (5); the app must supply the precinct for a lot; 9 records not modelled as lot-boundary setbacks  |
| Randwick City Council | ready | HC | HC | HC | - | HC | 22/18 |  | No secondary (corner lot) frontage setback rule; No garage setback rule |
| Richmond Valley Council | ready | DCP | HC | HC | - | DCP | 35/23 |  | 6 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| City of Ryde Council | ready | HC | HC | HC | - | HC | 17/12 |  |  |
| Shellharbour City Council | ready | DCP | DCP | DCP | DCP | DCP | 22/20 |  | No garage setback rule |
| Shoalhaven City Council | ready | HC | HC | HC | - | HC | 51/35 |  | 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Singleton Council | ready | DCP | DCP | HC | DCP | DCP | 13/9 |  | No garage setback rule |
| Snowy Monaro Regional Council | ready | HC | HC | HC | - | HC | 83/38 | yes | All residential rules are tied to named precincts or DCP areas (4); the app must supply the precinct for a lot; 3 records not modelled as lot-boundary setbacks  |
| Snowy Valleys Council | ready | HC | HC | HC | DCP | HC | 22/15 |  | 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Strathfield Municipal Council | partial | HC | DCP | HC | - | HC | 8/7 |  | R1: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent); R2: no numeric front/side setback rule (printed as text, BCA/NCC refere |
| Sutherland Shire Council | ready | HC | HC | HC | - | HC | 21/16 |  | No garage setback rule |
| City of Sydney Council | ready | HC | HC | HC | - | HC | 9/8 |  | No secondary (corner lot) frontage setback rule; No garage setback rule |
| Tamworth Regional Council | ready | HC | HC | DCP | - | HC | 59/24 |  | 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Temora Shire Council | ready | HC | HC | HC | DCP | HC | 12/9 |  | No secondary (corner lot) frontage setback rule; No garage setback rule |
| Tenterfield Shire Council | ready | HC | HC | HC | - | HC | 16/10 |  | No garage setback rule |
| The Hills Shire Council | ready | HC | HC | HC | - | HC | 45/36 |  | No garage setback rule; 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Tweed Shire Council | ready | HC | HC | HC | - | HC | 24/14 |  | No garage setback rule |
| Upper Hunter Shire Council | ready | HC | HC | HC | - | HC | 34/25 |  | No garage setback rule; 1 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Upper Lachlan Shire Council | ready | DCP | DCP | DCP | DCP | HC | 28/16 |  | No garage setback rule; 4 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Uralla Shire Council | ready | DCP | HC | HC | - | DCP | 17/12 |  | No garage setback rule |
| Wagga Wagga City Council | ready | HC | HC | HC | - | HC | 43/34 |  | 5 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, ga |
| Walcha Council | partial | HC | HC | HC | DCP | HC | 15/8 |  | R1: no numeric rear setback rule (printed as text, BCA/NCC reference, range, or absent); RU5: no numeric rear setback rule (printed as text, BCA/NCC reference,  |
| Walgett Shire Council | partial | HC | HC | HC | - | HC | 11/9 |  | R1: no numeric side/rear setback rule (printed as text, BCA/NCC reference, range, or absent); R5: no numeric rear setback rule (printed as text, BCA/NCC referen |
| Warren Shire Council | partial | IC | IC | IC | DCP | IC | 4/1 |  | No rules tagged to R1, R2, R5 or RU5 and none with an unstated residential zone; only other zones or precinct-level text; 4 records not modelled as lot-boundary |
| Warrumbungle Shire Council | ready | DCP | HC | HC | - | DCP | 17/13 |  |  |
| Waverley Council | none | HC | HC | HC | - | HC | 10/9 |  | No secondary (corner lot) frontage setback rule; No garage setback rule |
| Weddin Shire Council | partial | HC | HC | HC | - | HC | 15/10 |  | No garage setback rule |
| Wentworth Shire Council | ready | HC | HC | HC | DCP | DCP | 22/17 |  | No garage setback rule; 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Willoughby City Council | none | HC | HC | HC | - | HC | 1/1 |  | No secondary (corner lot) frontage setback rule; No garage setback rule; Research: Part B Residential development PDF (13MB) exists but its URL was not exposed  |
| Wingecarribee Shire Council | ready | HC | HC | HC | - | HC | 330/223 |  | 41 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, g |
| Wollondilly Shire Council | partial | HC | HC | HC | - | HC | 8/6 |  | No secondary (corner lot) frontage setback rule; No garage setback rule; 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garag |
| Wollongong City Council | ready | HC | HC | HC | - | HC | 38/24 |  | No garage setback rule; 2 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |
| Woollahra Municipal Council | ready | HC | HC | HC | - | HC | 22/20 |  | No secondary (corner lot) frontage setback rule; No garage setback rule |
| Yass Valley Council | ready | HC | HC | HC | - | HC | 41/34 |  | No garage setback rule; 3 records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls,  |

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

