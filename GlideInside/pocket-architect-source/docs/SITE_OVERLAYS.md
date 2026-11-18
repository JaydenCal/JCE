# Site constraint overlays (indicative)

Read only route `GET /api/site/overlays?state=NSW|QLD&srid=785x&bbox=minE,minN,maxE,maxN&origin=e,n` (server/lib/site.js, config table in
server/lib/site-overlay-sources.js). No keys. Same rate limiting (12 per minute per IP) and 24 h cache as the other site routes; a partial
answer (any service down) is returned with HTTP 200, `warnings`, and `cache-control: no-store`, and is never cached. The lot load never waits
for it: the app asks after the lot is on screen (`refreshOverlays` in src/site/apply.js) and a failure leaves the lot as it was.

Response: `layers[]` of `{ id: flood|bushfire|heritage|easement, label, source, attribution, date, status: ok|unavailable|error, note, features[] }`,
each feature `{ label, detail, polygons: [{ outer, holes }] }`, in metres relative to `origin` (the lot origin), clipped to the box.

## Sources and credit

The NSW layer list, endpoints, key fields, currency fields, where clauses, statewide counts and notes come from the JCESite constraints agent:
branch `claude/jcesite-stage8`, `cadastral-platform/backend/app/agents/sa9_constraints/endpoints_nsw.json` ("date_verified": 2026-10-12: each layer's
metadata read live, a statewide count query returned features, and a point query over Lot 3 DP263990 Gunnedah returned valid JSON). The trigger rules
(what a constraint may mean, next steps, the s10.7 and council report instruction) come from `rules_nsw_qld.json` in the same folder, ported to
src/site/overlay-rules.js. JCESite marks those rules as unresolved skeletons ("never treat as fact"), so every line is worded as "may", with
"check with council", and the card repeats the s10.7 planning certificate instruction (NSW). The table itself is server/lib/site-overlay-sources.js.

NSW overlays (host `https://mapprod3.environment.nsw.gov.au/arcgis/rest/services`), all verified by JCESite on 12/10/2026 unless marked:

| Overlay id | Layer | Statewide | Note kept from JCESite |
|---|---|---|---|
| flood | Planning/Hazard/MapServer/1 (fallback ePlanning/Planning_Portal_Hazard/MapServer/230) | 629 | LEP flood planning maps only; council flood studies NOT covered, so none mapped is not flood free |
| bushfire | Fire/BFPL/MapServer/0 (fallback Planning_Portal_Hazard/229) | 229,946 | RFS Bush Fire Prone Land, vegetation Category 1, 2, 3 and buffer, collated from council maps |
| heritage_item | Planning/EPI_Primary_Planning_Layers/MapServer/0, where LAY_CLASS NOT LIKE 'Conservation Area%' AND LAY_CLASS <> 'Heritage Conservation Area' | 39,217 | LEP heritage items, state and local |
| heritage_conservation | same layer, where LAY_CLASS LIKE 'Conservation Area%' OR LAY_CLASS = 'Heritage Conservation Area' | 1,123 | conservation area classes |
| acid_sulfate | Planning/Protection/MapServer/1 | 9,089 | LEP ASS class maps |
| biodiversity | ePlanning/BiodiversityValuesMap/MapServer/1 | 600,625 | Biodiversity Values Map (BC Act) |
| coastal | Planning/SEPP_Resilience_and_Hazards_2021/MapServer/3 | 7,795 | Coastal wetlands only |
| coastal_env | SEPP_Resilience_and_Hazards_2021/MapServer/6 | n/a | JCESite verified alternate; field names not recorded (label read from LABEL, LAY_CLASS or MAP_NAME) |
| riparian | Planning/Protection/MapServer/7 | 95,500 | LEP riparian lands and watercourses |
| land_reservation | Planning/EPI_Primary_Planning_Layers/MapServer/3 | 5,462 | LEP land reservation acquisition |
| airport | Planning/Protection/MapServer/2 | 29 | LEP airport noise (ANEF) |
| ols | Planning/Protection/MapServer/6 | n/a | JCESite verified alternate, obstacle limitation surface; field names not recorded |
| mine_subsidence | ePlanning/Planning_Portal_Subsidence_Advisory/MapServer/248 | 30 | Subsidence Advisory NSW districts |
| sepp_area | SEPP_Resilience_and_Hazards_2021/MapServer/1 | 14,889 | Resilience and Hazards SEPP land application map only |
| urban_release | Planning/Development_Control/MapServer/7 | 570 | LEP urban release area |
| landslide | Planning/Hazard/MapServer/2 | n/a | JCESite verified alternate |
| lot_size, height, fsr | EPI_Primary_Planning_Layers/MapServer/4, 5, 1 | 42,648 / 41,532 / 40,432 | Planning control maps: values in the card from a point query at the lot centre, never hatched |

Not found by JCESite (reported "Not available", not guessed): NSW contaminated land (the EPA record is not an ArcGIS layer), statewide transport corridors
(only Sydney interim rail corridor maps). NSW easements are not an open layer either.

This session also read the same flood, heritage and bushfire layer descriptions on 18/11/2026 and ran one live point query on heritage (Sydney Opera House
returned I1712) and flood (empty at Sydney CBD and Lismore). The first-pass BFPL point queries from the fetch tool errored, which is why the Planning Portal
copy is a fallback.

Queensland: JCESite has no verified QLD endpoint (every QLD entry in its layers.py has endpoint None). The only QLD layer here is easements,
`spatial-gis.information.qld.gov.au/.../PlanningCadastre/LandParcelPropertyFramework/MapServer/9`, schema read 18/11/2026. Flood, bushfire, heritage, acid
sulfate, biodiversity and landslide stay "Not available, check the council overlay map" (the State Planning Policy mapping host refuses automated access).

## Still to confirm on the first live call after deploy

- Envelope queries with `inSR`/`outSR` 7854/7855/7856 against the layers stored in 4283, and `maxAllowableOffset=0.5`.
- The `where` clauses combined with a geometry filter.
- Field names of coastal_env, ols and landslide (labels fall back to whichever of LABEL, LAY_CLASS, LAY_NAME, MAP_NAME is present).
- Licence text for the NSW Planning Portal and RFS layers (attribution says "licence to be confirmed").
- 20 upstream queries per lot: watch latency and the 12 per minute rate limit in practice. Riparian and biodiversity have very many polygons statewide, so a dense area may hit the 1000 record cap (reported as a warning, result not cached).

## App

- Layers panel: "Flood planning area (overlay)" etc. for every area layer with features, off by default, offered only when that layer has features. Stored as `site.lot.layers.ov_<id> === true`.
- 2D plan: hatched, tinted polygons with an outline under the lot (src/editor2d/draw-overlays.js) and a small legend.
- 3D: unlit 26 % tint draped on the ground (src/viewer3d/site-constraints.js), flagged `ground` so it never changes the framing.
- Site panel card "Site constraints (indicative)": affected constraints in full (what was found, what it may mean, next steps, the s10.7 certificate or council report instruction), planning control values (lot size, height, FSR), then one compact row for everything else with the source, data date and JCESite coverage caveat, and the check with council wording. Never claims anything about compliance and says an area with none mapped is not an all clear.
- Plan set site sheet: hook only (src/premium/exporters/planset/overlays.js): outlines of switched on layers, one legend row each, one note.
- Sample mode (CONFIG.siteMock) serves invented overlays from src/site/fixtures/overlays.js, labelled SAMPLE DATA.
