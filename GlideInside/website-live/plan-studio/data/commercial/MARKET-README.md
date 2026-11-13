# Market dataset README

File: market.json (schema market.v1). Currency AUD ex GST. Retrieval date 13/11/2026 (all asAt values).

## Status rules
- VERIFIED_LISTING: a live listing showing both price and floor area.
- VERIFIED_REPORT: a figure quoted from a published report or guide.
- ESTIMATE: analyst judgement. All area level ranges (sale, rent, yield, land) are ESTIMATE. Individual comps listed beside them are listing evidence only and are not turned into verified ranges.
- fallbackTo: set where an area had no listing evidence of its own; the estimate then reflects regional tiering relative to the named nearest area.

## Summary table
| Area | Sale $/m2 GFA | Rent $/m2/yr | Net yield % | Land $/m2 | Confidence |
|---|---|---|---|---|---|
| Tamworth | 2200 to 3400 | 120 to 180 | 6.5 to 8 | 70 to 130 | medium |
| Gunnedah | 1400 to 2400 | 90 to 140 | 7 to 9 | 40 to 90 | low |
| Narrabri | 1200 to 2200 | 90 to 140 | 7.5 to 9.5 | 40 to 90 | low (fallback Moree) |
| Moree | 1400 to 2200 | 110 to 160 | 7.5 to 9 | 40 to 90 | low |
| Armidale | 1800 to 2800 | 110 to 160 | 7 to 8.5 | 70 to 130 | low (fallback Tamworth) |
| Glen Innes | 1100 to 1900 | 80 to 120 | 8 to 10 | 35 to 80 | low (fallback Armidale) |
| Inverell | 1300 to 2200 | 90 to 130 | 7.5 to 9.5 | 40 to 90 | low (fallback Armidale) |
| Dubbo | 2200 to 3400 | 130 to 190 | 6.5 to 8 | 90 to 160 | low (fallback Tamworth) |
| Orange | 2400 to 3600 | 130 to 190 | 6.5 to 8 | 120 to 220 | low (fallback Dubbo) |
| Bathurst | 2400 to 3600 | 130 to 190 | 6.5 to 8 | 120 to 220 | low (fallback Orange) |
| Mudgee | 2200 to 3400 | 130 to 190 | 6.5 to 8.2 | 100 to 180 | low (fallback Orange) |
| Wagga Wagga | 2400 to 3600 | 130 to 190 | 6.5 to 8 | 110 to 200 | low (fallback Dubbo) |
| Albury | 2400 to 3600 | 130 to 190 | 6.3 to 7.8 | 140 to 240 | low (fallback Wagga Wagga) |
| Kempsey | 1800 to 2800 | 110 to 160 | 7 to 8.8 | 80 to 150 | low (fallback Port Macquarie) |
| Port Macquarie | 2800 to 4200 | 150 to 220 | 6 to 7.5 | 200 to 380 | low (fallback Coffs Harbour) |
| Coffs Harbour | 2800 to 4200 | 150 to 220 | 6 to 7.5 | 220 to 400 | low (fallback Port Macquarie) |
| Grafton (Clarence Valley) | 1800 to 2800 | 110 to 160 | 7 to 8.8 | 90 to 160 | low (fallback Coffs Harbour) |
| Lismore | 2200 to 3400 | 120 to 170 | 6.8 to 8.5 | 110 to 200 | low (fallback Ballina) |
| Ballina | 3000 to 4800 | 160 to 240 | 5.5 to 7 | 250 to 420 | low |
| Muswellbrook | 1800 to 2800 | 110 to 170 | 7 to 8.8 | 70 to 140 | low (fallback Singleton) |
| Singleton | 2000 to 3000 | 120 to 180 | 6.8 to 8.5 | 90 to 160 | low (fallback Cessnock) |
| Cessnock | 2200 to 3400 | 130 to 190 | 6.5 to 8 | 130 to 230 | low (fallback Maitland) |
| Maitland | 2600 to 3800 | 150 to 220 | 6 to 7.5 | 180 to 300 | low (fallback Lake Macquarie) |
| Lake Macquarie | 2700 to 4200 | 160 to 240 | 5.8 to 7.3 | 220 to 380 | medium |
| Newcastle | 3000 to 4800 | 170 to 260 | 5.5 to 7 | 280 to 500 | low (fallback Lake Macquarie) |
| Regional NSW default | 1800 to 2800 | 100 to 150 | 7 to 9 | 70 to 140 | low |

## Build cost (see buildCost in market.json)
- Regional small strata workshop with mezzanine office: $1,500 to $2,400 per m2 GFA (ESTIMATE, excl fees and site works).
- Reference figures (VERIFIED_REPORT): metal clad large shed Sydney Q4 2025 $1,060 to $1,340; precast $1,160 to $1,740 (Feasly); industrial warehouses $1,300 to $2,800 (Matrix via BSG, 2025); national warehouse $1,150 (Cushman and Wakefield, 28/05/2026).
- Civil site works $120 to $250 per m2 of site (ESTIMATE). Professional fees 8 to 12 percent (ESTIMATE). Contingency 7.5 to 10 percent (ESTIMATE).
- Soft costs combined (demolition, external works, infrastructure charges, fees, contingency, finance) add 30 to 50 percent on multi-unit projects (VERIFIED_REPORT, Feasly).
- Sydney escalation 6.0 percent 2026, 4.5 percent 2027 (Altus). No regional figure found.

## Best evidence found
- Tamworth: Industrial Close strata units 48 to 72 m2 asking $3,264 to $3,646 per m2; whole building 884 m2 at $3,337 per m2 (commercialrealestate.com.au, as at 13/11/2026).
- Lake Macquarie region: Beresfield 60 to 62 m2 at $4,355 to $4,500; Tomago 92 m2 at $3,533; Cameron Park 376 m2 asking above $2,660 per m2.
- Moree: 200 m2 showroom unit at $1,700 per m2, rent about $142 per m2 ex GST, gross 8.3 percent.
- Gunnedah: older 1,012 m2 shed at $568 per m2 (not strata); ARTC 2,240 m2 net rent $107 per m2.
- Byron Bay: 130 m2 unit at $6,154 per m2, stated 5 percent yield (upper bound only).

## Main caveats
1. Asking prices, not sales; listing dates were not shown.
2. Evidence is concentrated in Tamworth and the Newcastle area; most areas have none.
3. No regional NSW yield or land price figures were found in public agency reports (CBRE, Colliers, JLL, Knight Frank, Opteon, HTW cover Sydney or national only; Opteon national median net industrial yield about 4.8 percent, April 2026). Regional yields are assumptions.
4. Rents are estimates except four income figures (Moree, Gunnedah, Cardiff, Thornton), none a small strata unit rent apart from Moree.
5. Serviced industrial land prices are not published (Global Gateway Park and Westview Dubbo are price on application).
6. Search pages for Dubbo, Orange, Wagga Wagga, Port Macquarie, Maitland and Coffs Harbour on commercialrealestate.com.au were blocked by the fetch permission system and not read. These are the first places to improve the dataset.
7. Units under 100 m2 price higher per m2; ranges target 100 to 400 m2 so sit below the small unit comps.
8. Build costs come from secondary guides, not Rawlinsons or Cordell. GST treatment on listings varied (plus GST, going concern, not applicable); all treated as ex GST.
9. Treat as indicative inputs for a feasibility panel, not a valuation.
