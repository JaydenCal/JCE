# Site lookup ("Find my block")

Type an NSW or QLD street address and the design opens on the real lot: lot boundary, neighbouring lots with lot and plan labels, an aerial image
placed to scale, ground contours, council and zone. The house is then placed on that lot in plan and in 3D.

Status (11/11/2026): the front end runs against recorded-shape sample responses (`CONFIG.siteMock = true`, `src/site/fixtures/`). The live
back end (`server/lib/site.js`, `/api/site/*`) is written and tested against mocked upstreams, but has NOT been run against the real government
services (the build sandbox cannot reach them). Leave `siteMock` true until `/api/site/health` is green and one real lot has been looked at. Setbacks are a separate stage: `site.lot.setbacks` and `site.lot.envelope` are `null` hooks.

## Where things are

| Piece | File |
|---|---|
| Single lot schema, MGA to plan conversion | `src/site/model.js` (`buildSiteLot`) |
| Geometry: MGA zones and projection, polygon helpers | `src/site/geo.js` |
| Contours (marching squares) | `src/site/contours.js` |
| Street frontage | `src/site/frontage.js` |
| Attribution and accuracy wording | `src/site/credits.js` |
| Browser client (search, lot, aerial, contours) | `src/site/client.js` |
| Apply to a project (one undo step) | `src/site/apply.js` |
| Sample responses and their generator | `src/site/fixtures/`, `tools/make-site-fixtures.mjs` |
| Search box, panel section, frontage bar | `src/ui/find-block.js`, `src/ui/panel-site.js`, `src/ui/frontage.js` |
| 2D layers | `src/editor2d/draw-site.js` |
| 3D terrain | `src/viewer3d/terrain.js` |

Feature flags in `src/config.js`: `siteLookupEnabled` (true), `siteMock` (true until the API is deployed), `siteAerialMarginM` (30).

## Coordinates

- Source data is MGA2020 (GDA2020 / MGA zone 54, 55 or 56, EPSG 7854 to 7856), metres. The zone comes from longitude (54: 138 to 144 E, 55: 144 to 150 E, 56: 150 to 156 E).
- The lot centroid, in MGA, is the origin. Everything stored in the project is relative to it.
- Plan millimetres, y down. MGA northing maps to **-y**, easting to +x. Plan up is MGA grid north, so `site.northDeg` is 0 (grid north, not true north).
- Plan `(0, 0)` is the lot centroid. The first lot added moves the existing design so its footprint is centred there.

## Schema 2: `project.site.lot`

`schema` is now 2. `migrate()` loads schema 1 projects with `site.lot = null`. Everything below is plan mm unless stated. `model.js` is the single definition.

| Field | Meaning |
|---|---|
| `source` | `sample`, `nsw` or `qld` |
| `address`, `state`, `srid`, `zone` | Address text as picked, `NSW` or `QLD`, EPSG code, MGA zone number |
| `origin { e, n }` | MGA easting and northing (m) of plan (0, 0) |
| `northRef` | `MGA grid north` |
| `lotLabel`, `lotNumber`, `planLabel` | For example `Lot 24 DP 1234567`, `24`, `DP 1234567` |
| `areaM2`, `registeredAreaM2` | Area from the polygon, and the area the register states |
| `lga`, `zoning { code, name, instrument }`, `zoneNote` | Council. NSW zone from the Planning Portal. QLD zone is `null` with a note (schemes are per council) |
| `boundary [{x, y}]`, `holes` | The lot ring. Edge `i` runs from `boundary[i]` to `boundary[(i + 1) % n]` |
| `frontEdges [i]` | Indices of the street frontage edges (derived, then confirmed by the person) |
| `cornerLot` | True when two front edges meet at a clear bend (45 to 135 degrees) |
| `frontageConfirmed`, `frontageMethod` | Whether the person has confirmed the frontage, and how it was derived (`roads`, `no-lot-beyond`, `longest-edge`) |
| `neighbours [{ id, lotNumber, planLabel, areaM2, isRoad, ring, holes }]` | Lots within about 60 m. `isRoad` marks road parcels (QLD) |
| `roads [{ name, pts }]` | Road centrelines near the lot (NSW, best effort), flat `[x, y, ...]` |
| `contours [{ level, major, closed, pts }]`, `contourInterval` | Flat `[x, y, ...]`, RL in metres. Minor 0.5 m, major 2.5 m |
| `terrain { cols, rows, cellMm, x0, y0, values }` | Elevation grid. Node `(i, j)` is at `(x0 + i * cellMm, y0 + j * cellMm)`, row 0 is the north edge, values are RL metres |
| `aerial { key, source, attribution, captureDate, extent {x0,y0,x1,y1}, mmPerPx }` | The image is in IndexedDB under `key` and is also `site.underlay` (placed to scale, locked, `site: true`) |
| `floorRL`, `floorRLAuto` | Finished floor level (m). Default is the lot centroid RL plus 0.15 m. Editable in the panel |
| `layers { boundary, dimensions, neighbours, labels, aerial, contours }` | Layer visibility (all true by default) |
| `setbacks`, `envelope` | `null` until the setback stage fills them. Shape agreed below. Nothing is invented here |
| `provenance { lot, aerial, elevation }` | Where each layer came from. `elevation` holds source, resolution, datum, accuracy, copyright, note |
| `warnings`, `sample` | Messages from the lookup (for example "No aerial image"), and true for sample data |

## Setbacks and envelope on site.lot (agreed shape, 11/11/2026)

Three branches meet on `site.lot`: this one writes the lot, `claude/glide-setbacks` (`src/site/setbacks.js`) fills `setbacks` and `envelope`, and
`claude/glide-ai` (`src/model/placement.js`) and the builder fit ranking read them. The shape below is what each side has been made to accept.

| Field | Written by | Shape |
|---|---|---|
| `frontEdges` | `src/site/frontage.js`, confirmed by the person | `number[]`. Every boundary edge that faces a street, primary and secondary together, in index order. Edge `i` runs from `boundary[i]` to `boundary[(i + 1) % n]`. Do not order it "primary first" |
| `cornerLot` | `src/site/frontage.js` | Boolean hint for the panel only. The setback stage works it out again from `frontEdges` |
| `setbacks` | `siteLotSetbacks()` in `src/site/setbacks.js` | `null`, or the `pickRules` result plus `edgeKinds` and `inputs` (below) |
| `envelope` | `siteLotSetbacks()` (it calls `buildEnvelope`) | `null`, or `[{ x, y }]` in plan mm, same axes as `boundary` |

`site.lot.setbacks` when not null:

```
{
  basis,            // "Council DCP" | "Codes SEPP Housing Code (...)" | "Codes SEPP Inland Code (...)" | "QDC MP1.1 (default; council planning scheme or the Queensland Housing Code may vary)"
  state, council,
  source,           // { kind: 'council', dcp, lga_slug } | { kind: 'fallback', name, edition }
  front, side, rear,            // slot objects (below); always present when setbacks is not null
  secondaryFront,               // slot or null (null unless it is a corner lot)
  garage,                       // slot or null; garage.minM may be null with behindBuildingLineM set
  edgeKinds,        // one of 'front' | 'secondaryFront' | 'side' | 'rear' per boundary edge, same order as boundary
  inputs,           // what was asked: { state, zone, lotAreaM2, lotWidthM, cornerLot, use, storeys, wallHeightM, buildingHeightM, streetType, ... }
  flag, flagReason, // 'check_with_council' | null: true when any applied slot is flagged
  ruleIds, warnings, attempts
}
slot = { minM, calc, note, clause, page, dcp, edition, quote, source_file, confidence, ruleIds, sources,
         flag, flagReason,       // 'check_with_council' | null for this rule
         perLevel?, percent?, formula?, rangeM?, derived? }
```

Rules for readers:

- A setback value is `slot.minM` in metres. `placement.js` also still accepts a plain number or `{ value }`.
- The flag is `flag === 'check_with_council'` on the slot. Show every value; mark flagged ones "check with council". Never print "compliant".
- Every applied value carries `clause`, `page` (null for the Codes SEPP and the QDC, which have no page numbers), `dcp` (document name) and `edition`.
- Classify edges from `setbacks.edgeKinds`. Without it, the shortest street frontage is the primary one (both modules now use that rule).
- `envelope` is authoritative when present. When `setbacks` is null show nothing: no values, no envelope.

Filling them (the setback stage, after the person confirms the frontage and whenever the design height or storeys change):

```js
import { siteLotSetbacks } from './site/setbacks.js';
const { setbacks, envelope, attempts } = siteLotSetbacks(lot, ruleSet, { storeys, wallHeightM, buildingHeightM, streetType });
lot.setbacks = setbacks;   // null when nothing can be determined; attempts says why
lot.envelope = envelope;
```

`ruleSet` is `GlideInside/setbacks-data/setback-rules.json` (5 MB, 128 councils). Load one council on demand in production (`rules/<lga_slug>.json`
plus the three `fallback/*.json` files) instead of shipping the whole file to the browser. `findCouncil(councils, lot.lga)` matches the cadastre's LGA
name to the rule file.

Open points for the merge:

- Queensland lots have `zoning: null`; the QDC default does not need a zone but it does need `streetType` (`"access"` or `"collector"`), so the
  panel has to ask that one question for a Queensland lot, and it only covers lots up to 450 m2.
- `lotWidthM` is taken as the length of the primary street frontage. A battle-axe lot (frontage is the handle) therefore gets no code fallback and
  usually no envelope; that is the intended safe result until battle-axe rules are modelled.
- The builder fit ranking on `claude/glide-accounts` should call `buildEnvelope` (or read `lot.envelope`) instead of its own offset.

"levels": the design's own `levels[]` are unchanged. A level's `elevation` is relative to the ground floor; the ground floor sits at `floorRL`.

## Street frontage ("Confirm your street frontage")

After a lookup the plan shows the derived front edges in blue and a bar asks the person to confirm. Clicking an edge toggles it (corner lots have two,
a battle-axe lot has its frontage at the end of the handle). "Confirm frontage" sets `frontageConfirmed`. Derivation (`src/site/frontage.js`):

1. An edge is front when most of the ground just outside it is not another lot (the cadastre lots do not include the road), or is a neighbouring road parcel.
2. When road centrelines are known and an edge runs within 15 m of one for half its length, only those edges are kept (drops rear boundaries on reserves and creeks).
3. If nothing qualifies, the longest edge is suggested.

## 3D

`src/viewer3d/terrain.js` builds the ground from `site.lot.terrain`: a mesh draped with the aerial (full resolution, mipmapped, no blur when magnified), a flat pad
under the house blended into the natural ground over 3 m, and the lot boundary as a red ribbon on the ground. The house sits at `floorRL`. Without a lot, or without
an elevation grid, the old flat ground is used. The terrain does not model cut and fill; it is for placement, not earthworks.

## Attribution, licences and accuracy (checked 11/11/2026)

The credits are printed on the plan (bottom right), in the panel and in the footer of every PDF sheet (`src/site/credits.js`). Contour source and accuracy always
read "... indicative only; detailed survey required". Boundaries are always labelled indicative.

| Layer | Licence found | Notes |
|---|---|---|
| NSW cadastre | CC BY (data.nsw.gov.au). LPI statement: CC BY 3.0 Australia for the DCDB and NSW Imagery | Version on the data.nsw page not stated; 3.0 AU is from the LPI statement quoted on the OpenStreetMap wiki |
| NSW imagery | LPI lists CC BY 3.0 AU | Service metadata says it includes third party imagery (AAM, Jacobs Group Ausimage, Landsat) and states no licence. Credit text is kept. Verify terms before commercial use |
| NSW 5 m DEM | Not stated (copyright "DFSI 2019") | Accuracy not stated by the service |
| NSW land zoning | Not checked | Attributed to the Planning Portal |
| QLD cadastral parcels | CC BY 4.0 (Queensland Spatial Catalogue, "Cadastral data - Queensland series") | The service layer used is the same dataset family; not separately confirmed |
| QLD imagery (`LatestStateProgram_AllUsers`) | Service states CC BY-SA | It includes Planet satellite fill "reproduced under licence from Planet and Geoplex, all rights reserved", which is NOT openly licensed. Only SISP aerial three years or older is open. The server must use QLD imagery only where the displayed item is such aerial |
| QLD DEM (`QldDem`) | Not stated by the service | CC BY-SA is the owner's instruction in the earlier JCE site work. The mosaic includes SRTM and bathymetry (deepreef.org) |

CC BY-SA on the QLD imagery and DEM has a share-alike effect on anything derived from them. Decision needed on whether plan sets that embed the QLD aerial are acceptable under that.

## Back end (`server/lib/site.js`)

Endpoints (all GET, no auth, rate limited per IP with `store.hitRate`: search 60/min, lot and aerial 20/min, contours 12/min, 800 lookups a day):

- `/api/site/search?q=` up to 8 `{ label, state, lon, lat }`. NSW: NSW_Geocoded_Addressing_Theme FeatureServer layer 1 (AddressPoint, upper case `address`): `address LIKE 'QUERY%'` first, then `address LIKE '%WORD%'` per word if that is empty, outSR 4326. NSW_Property layers 1 to 4 reject attribute queries live and are not used. The query is upper cased, street type abbreviations expanded (ST, RD, AVE, DR, CRES, PL, CT, LN, HWY, PDE, TCE), commas, the state and a postcode dropped. A query naming NSW or QLD searches only that state. QLD: LandParcelPropertyFramework layer 0 (Addresses), `UPPER(address) LIKE '%WORD%'` per word (a street number range such as 419-433 may miss a query for 421).
- `/api/site/lot?lon=&lat=&state=` parcel at the point (largest parcel if strata lots stack), neighbours within 60 m (road parcels flagged `isRoad`), LGA, zoning (NSW only), road centrelines (NSW only), `origin` (MGA centroid), all coordinates relative to the origin in metres.
- `/api/site/aerial?state=&srid=&bbox=` image bytes plus `x-site-meta` (URL encoded JSON: georef, bbox, size, source, attribution, capture date). If the service refuses an MGA export the server returns a web mercator image (`georef: 'web-mercator'`) and the browser re-samples it (`src/site/warp.js`).
- `/api/site/contours?state=&srid=&bbox=&buffer=&origin=` DEM grid on an MGA grid (NSW 2 m, QLD 1 m, at most about 160k nodes), marching squares contours (minor 0.5 m, major 2.5 m, `minor` and `major` configurable), provenance.
- `/api/site/health` probes 14 upstream services with an 8 s timeout (memoised 60 s). `ok` is false if a required service (lot or address) is down; NSW_Property is optional.

NSW aerial request that works live (11/11/2026): `NSW_Imagery/MapServer/export?bbox=302768,6558142,302888,6558262&bboxSR=7856&imageSR=7856&size=512,512&format=jpg&f=image` (200, image/jpeg, about 80 kB); `imageSR=3857` also works. The server tries the full size, then half size, in MGA, then web mercator (3857). Any non-image reply (ArcGIS often answers 200 with a JSON error) is logged with the URL and status and counts as a failure.

Raster format: the DEM is requested as TIFF F32 (`exportImage`, `noData=-9999`) in web mercator and decoded by `src/site/tiff.js`, a small pure JS reader
(uncompressed, LZW, Deflate, strips or tiles, predictors 1, 2, 3). No LERC and no `getSamples` (about 30 s for 40 points in earlier work). Cells are resampled bilinearly onto the MGA grid.

Caching: lot and search JSON in D1 table `site_cache` (`server/schema.sql`, TTL 7 days and 1 hour); aerial and contours in the Worker Cache API with an in-memory fallback (7 days).
Run `wrangler d1 execute <db> --file=server/schema.sql` once to add the table. Stores without `getSiteCache` (file, Upstash) simply skip the cache.

Not confirmed against live services (see the header of `server/lib/site.js` for the full list with the confirmation date): the actual query behaviour of every layer
(point query with `inSR=7844`, `outSR=785x`), the NSW address text format, MGA `imageSR` on NSW_Imagery export, the TIFF produced by `exportImage`, and the field names of
QLD imagery catalogue items used to reject Planet fill. If the QLD open-imagery check cannot establish that the imagery is open aerial the aerial is withheld and the app carries on without it.
