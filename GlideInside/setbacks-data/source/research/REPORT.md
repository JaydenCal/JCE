# Residential setback research (11/11/2026)

All values were read through the WebFetch extraction tool, which paraphrases; most rules are therefore `needsReview: true`. Primary legislation.nsw.gov.au was not reachable, so statewide values come from AustLII (index marked "As at 5 July 2024") and currency is NOT verified. Several fetches (Cabonne DCP-5, Queensland MP 1.2 and the Queensland Housing Code PDF) were blocked by permission timeouts.

## Key finding
For the western councils, CDC dwellings fall under the **Part 3D Inland Code** (cl 3D.1), not Part 3 Housing Code. Balranald, Cabonne, Cobar, Gwydir, Hay, Liverpool Plains, Warren (and Carrathool) are in its inland LGA list. Canada Bay, North Sydney, Strathfield and Willoughby are not (Part 3 Housing Code applies). Fallback file added: `fallback/nsw-inland-code.json`.

## Councils
| Council | Status | Finding | Source |
|---|---|---|---|
| Liverpool Plains | partial | DCP Amdt 4 (26/02/2020) was readable. R1 front 4.5m, garage 1m behind dwelling line (5.5m if dwelling under 4.5m); RU5 6m; RU1 and R5 20m street, 10m side/rear. Side/rear for R1 and RU5 are "BCA Requirements" (no metres). | [PDF](https://shared-drupal-s3fs.s3-ap-southeast-2.amazonaws.com/master-test/fapub_pdf/DCP-CP/LIVERPOOL+PLAINS/Development+Control+Plan+-+Amdt+No.+4+-+Adopted+26+February+2020_S-1407.pdf) cl 3.1.1 pp 11-12 |
| Balranald | partial | No DCP. Council Building Setback Policy: front 6m; secondary 2m (200-600m2), 3m (>600-1,500), 5m (>1,500); cul-de-sac 4m/3m. No side/rear. | [Policy](https://balranald.nsw.gov.au/wp-content/uploads/2025/09/Policy-Building-Setback-Policy-2025.pdf) |
| Warren | partial | DCP (24/01/2013) has no general dwelling setbacks. R5 only: 20m from all boundaries (cl 18 p 5). Rest falls to Inland Code. | [PDF](https://www.warren.nsw.gov.au/__media_downloads/Warren%20Shire%20Council%20DCP.pdf?downloadable=1) |
| Cabonne | none | No residential DCP (12 DCPs listed, rural/industrial/special). DCP-5 General Rural Zones (1992) unread (blocked). Inland Code. | [Council page](https://www.cabonne.nsw.gov.au/Development/Development-Plans-Policies-Maps-Strategies) |
| Cobar | none | No DCP linked; LEP only. Council policy register unread. Inland Code. | [page](https://www.cobar.nsw.gov.au/services/building-and-development/planning-and-development/planning-policies-and-resources/) |
| Hay | none | Planning page cites LEP 2011 and "relevant policies"; no DCP. Inland Code. | [page](https://www.hay.nsw.gov.au/Building-Planning-Environment/Planning) |
| Gwydir | none | Planning framework page lists LEP, CPP, Local Housing Strategy; no DCP. Inland Code. | [page](https://www.gwydir.nsw.gov.au/Council/Building-and-Development/Planning-Framework-for-Gwydir-Shire) |
| Strathfield | partial | SCDCP 2005 Part A (1/9/2020), R2: front 9m (variation by predominant setback), battle-axe 4.5m; side 20% of width combined, min 1.2m each; rear 6m; garage 0.5m. Secondary 3m only when entrance is on secondary frontage. R3 not covered. | [Part A](https://www.strathfield.nsw.gov.au/files/assets/public/v/1/develop/part-a-of-scdcp-2005-dwelling-houses-and-ancillary-structures-adopted-by-council-010920.pdf) cl 4.2.3 pp 14-17 |
| North Sydney | partial | NSDCP 2025 Part E s1: front = adjoining alignment/average; side R2/R3/C4 0.9m (to 4m), 1.5m (to 7m), 2.5m (above 7m); R4 1.5m plus 45 degree plane from 3.5m; rear matches adjoining (R4 1.5m). No corner or street garage figure. | [Part E](https://www.northsydney.nsw.gov.au/downloads/file/4342/nsdcp-2025-part-e---development-types) |
| Canada Bay | ready | DCP Amdt 14 (eff. 26/08/2022) Part E E4.2: front greater of 4.5m and prevailing (average of five adjoining each side); secondary 2m for first 25m; side 0.9m single storey, 1.5m second storey; rear 6m (9m upper living). R1/R2 only. | [DCP](https://shared-drupal-s3fs.s3.ap-southeast-2.amazonaws.com/master-test/fapub_pdf/NSW+Planning+Portal+Exhibitions/City+of+Canada+Bay+Development+Control+Plan+-+as+amended+26+August+2022_S-5314.pdf) pp E-18 to E-22 |
| Willoughby | none extracted | DCP 2023 (effective 04/10/2023) Part B Residential (13MB) exists; its URL could not be obtained. Nothing recorded; Housing Code fallback. | [page](https://willoughby.nsw.gov.au/Development/Plan/Planning-Rules/WDCP) |

## Fallback: NSW Housing Code (Part 3), cl 3.10 (zones R1, R2, R3, R4, RU5 per cl 3.1(3)(a); min lot 200m2, width 6m)
Front: average of 2 nearest dwellings (within 40m, same side); else by lot area:
| Lot area | Front |
|---|---|
| 200-300m2 | 3m |
| >300-900m2 | 4.5m |
| >900-1,500m2 | 6.5m |
| >1,500m2 | 10m |

Secondary road (cl 3.10(11)): 200-600m2 2m; >600-1,500m2 3m; >1,500m2 5m. Parallel road 3m; classified road 9m if no other EPI value; public reserve 3m; battle-axe 3m from rear boundary of lot in front.

Side (cl 3.10(4)), per side boundary:
| Lot width | Height 0 to limit | Height above |
|---|---|---|
| 6-10m | 0-5.5m: 0.9m | >5.5-8.5m: (h-5.5)/4+0.9 |
| >10-18m | 0-4.5m: 0.9m | >4.5-8.5m: (h-4.5)/4+0.9 |
| >18-24m | 0-4.5m: 1.5m | >4.5-8.5m: (h-4.5)/4+1.5 |
| >24m | 0-8.5m: 2.5m | n/a |

Rear (cl 3.10(10)):
| Lot area | 0-4.5m | >4.5-8.5m |
|---|---|---|
| 200-300m2 | 3m | 10m or average of 2 adjoining rear setbacks, lesser |
| >300-900m2 | 3m | 8m |
| >900-1,500m2 | 5m | 12m |
| >1,500m2 | 10m | 15m |

Built-to-boundary (cl 3.10(5)-(8)) summarised in the JSON. Part 3A Rural Housing Code (R5/RU, cl 3A.15-3A.17) text could not be fetched: no values recorded.

## Fallback: NSW Inland Code (Part 3D), cl 3D.21 (RU1-RU6, R1-R5 in inland LGAs)
Front: average of 2 nearest; else 200-300m2 3m, >300-1,500m2 4.5m, >1,500m2 10m. Secondary: 2m / 3m / 5m (as Housing Code). Side by lot width at building line: 6-18m 0.9m, >18-24m 1.5m, >24m 2.5m (height formula above 4.5m is an image, not extracted). Rear: same table as Housing Code. Parallel road 3m, reserve 3m, battle-axe 3m.

## Fallback: Queensland (QDC)
The 2010 MP 1.1/1.2 are superseded by the Queensland Housing Code (listed 14/08/2026, commenced 01/09/2026) but continue to apply in a council area until its scheme is amended or 01/09/2029. MP 1.1 (lots 450m2 and under, 11/03/2010):
- Front: access place/street 3.0m; collector 4.0m (neighbour averaging rules A1(a)(ii)-(iii)). Side to corner street 1.0m / 2.0m.
- Side and rear: part height up to 4.5m 1.5m; 4.5-7.5m 2.0m; above 7.5m 2m plus 0.5m per 3m. Frontage 15m or less: Table A2 (0.75m at 10.5m or less to 1.425m at 14.501-15m for up to 4.5m height; 1.0m to 1.9m for 4.5-7.5m).
- Class 10a: within clearance if height up to 4.5m (mean 3.5m), length up to 9m per boundary, 1.5m from adjoining habitable window.
MP 1.2 and the QHC were unreadable: the "6m general / 3m secondary" figures are NOT recorded. Trade-blog claims about QHC numbers are listed as unverified leads only.
Councils can vary these through planning schemes.
