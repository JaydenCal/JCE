# Site constraint overlays (indicative)

Read only route `GET /api/site/overlays?state=NSW|QLD&srid=785x&bbox=minE,minN,maxE,maxN&origin=e,n` (server/lib/site.js, config table in
server/lib/site-overlay-sources.js). No keys. Same rate limiting (12 per minute per IP) and 24 h cache as the other site routes; a partial
answer (any service down) is returned with HTTP 200, `warnings`, and `cache-control: no-store`, and is never cached. The lot load never waits
for it: the app asks after the lot is on screen (`refreshOverlays` in src/site/apply.js) and a failure leaves the lot as it was.

Response: `layers[]` of `{ id: flood|bushfire|heritage|easement, label, source, attribution, date, status: ok|unavailable|error, note, features[] }`,
each feature `{ label, detail, polygons: [{ outer, holes }] }`, in metres relative to `origin` (the lot origin), clipped to the box.

## Endpoints checked 18/11/2026

The build container cannot open the government hosts directly (egress proxy refuses them). Service descriptions and test queries were read
through WebFetch. "Live" means the layer description AND one real query returned the expected JSON shape.

| Overlay | State | Endpoint | Verified |
|---|---|---|---|
| Flood planning | NSW | `https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/Hazard/MapServer/1` (Flood Planning; fields EPI_NAME, LGA_NAME, LAY_CLASS, EPI_TYPE, COMMENCED_DATE, CURRENCY_DATE; polygon, SR 4283, max 1000) | Live: description plus a point query at Sydney CBD returned `features: []` with the right field aliases. No hit case seen. |
| Flood planning (fallback) | NSW | `.../services/ePlanning/Planning_Portal_Hazard/MapServer/230` (Flood Planning Map) | Schema only |
| Bushfire prone land | NSW | `.../services/Fire/BFPL/MapServer/0` (fields Category, d_Category, Guideline, d_Guidelin, LastUpdate, VerDate; polygon, SR 4283, max 1000) | Schema only. Two point queries to it errored from the fetch tool (server error), so SUSPECTED OK for envelope queries. |
| Bushfire (fallback) | NSW | `.../services/ePlanning/Planning_Portal_Hazard/MapServer/229` (Bushfire Prone Land) | Schema only |
| Heritage | NSW | `.../services/Planning/EPI_Primary_Planning_Layers/MapServer/0` (fields H_ID, H_NAME, SIG, LAY_CLASS, EPI_NAME, LGA_NAME, CURRENCY_DATE; polygon, SR 4283, max 10000) | Live: a point query at the Sydney Opera House returned `H_ID I1712, H_NAME Sydney Opera House, SIG State` |
| Zoning | NSW | already used by /api/site/lot (EPI_Primary_Planning_Layers layer 2) | Existing, not repeated |
| Easements | NSW | none: not published as an open layer | Reported as "Not available" with a note |
| Easements | QLD | `https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/9` (Easement Parcels Only; lot, plan, lotplan, feat_name, lot_area, parcel_typ; polygon, max 4000) | Schema only |
| Flood, bushfire, heritage | QLD | none verified. The QSpatial directory (spatial-gis.information.qld.gov.au) has no state hazard or heritage register layer in the folders read (PlanningCadastre, FloodCheck, Environment, Boundaries, Society, Location, EventsIncidents). FloodCheck/FloodStudies holds study extents, not a flood planning overlay. The SPP interactive mapping host refuses automated access (robots). In Queensland these overlays belong to each council planning scheme. | Reported "Not available, check the council overlay map". No URL is guessed. |

Not wired (zoning context is already in the lot card for NSW; Queensland has no open statewide zoning service).

## Still to confirm on the first live call after deploy

- Envelope query with `inSR`/`outSR` = 7854/7855/7856 against the 4283 layers (the cadastre code already relies on the same transform on other layers).
- `LAY_CLASS` values in the heritage layer: the conservation area rule (text containing "Conservation" and no H_ID) is a guess.
- BFPL `Category` codes: shown as "Vegetation Category n" or "Vegetation buffer".
- Licence text for the NSW Planning Portal and RFS layers (attribution says "licence to be confirmed").
- `maxAllowableOffset=0.5` generalisation is accepted by these services.

## App

- Layers panel: "Flood planning area (overlay)" etc., off by default, offered only when that layer has features. Stored as `site.lot.layers.ov_<id> === true`.
- 2D plan: hatched, tinted polygons with an outline under the lot (src/editor2d/draw-overlays.js) and a small legend.
- 3D: unlit 26 % tint draped on the ground (src/viewer3d/site-constraints.js), flagged `ground` so it never changes the framing.
- Site panel card "Site constraints (indicative)": Yes, No mapped, Not available or Not checked for flood, bushfire, heritage and easements, with source and data date, and the check with council wording. Never claims anything about compliance and says an area with none mapped is not an all clear.
- Plan set site sheet: hook only (src/premium/exporters/planset/overlays.js): outlines of switched on layers, one legend row each, one note.
- Sample mode (CONFIG.siteMock) serves invented overlays from src/site/fixtures/overlays.js, labelled SAMPLE DATA.
