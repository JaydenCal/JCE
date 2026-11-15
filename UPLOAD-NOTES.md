# Boundary upload and worldwide aerial: owner notes

Branch: claude/boundary-upload (from claude/commercial-m1). Nothing has been deployed or uploaded. No key or token is stored anywhere in the repository.

## What you need to set

| Name | Where | What it is |
| --- | --- | --- |
| MAPBOX_PUBLIC_TOKEN | Build time environment variable, read by tools/build-single.mjs | Public Mapbox token (starts with pk.). It is written into the built app page as window.__PS_MAPBOX_TOKEN__. |
| MAPBOX_PUBLIC_TOKEN | Worker environment variable (alternative) | The same token. The Worker returns it from /api/health as mapboxToken, and the app asks for it the first time it needs overseas imagery. |

Use one or the other. Only a token starting with pk. is accepted. A secret token (sk.) is refused by the build, the Worker and the app, and is never sent anywhere.

Without a token everything still works. A site outside NSW and Queensland shows a plain grey ground with the words "Aerial not available for this location".

## Steps you do yourself in Mapbox

1. Sign in to your Mapbox account and open Access tokens.
2. Create a new public token (pk.). Give it only the default public scopes. Do not tick any secret scope.
3. Under URL restrictions add glideinside.com.au (and www.glideinside.com.au if the app is served from it). Add the preview host too if you want to test there.
4. Check the plan, the free monthly allowance for raster tile requests, and set a usage alert. One uploaded lot fetches up to 49 tiles (usually 4 to 20), then they are cached in memory for the session.
5. Read the Mapbox terms on storing imagery. The app stitches the tiles into one picture and keeps it in the visitor's own browser storage (the same place the NSW and Queensland aerials go) so the 2D underlay, 3D ground and plan set can use it. If the terms do not allow that, tell me and I will make it session only.
6. Put the token in the build environment (for example `MAPBOX_PUBLIC_TOKEN=pk.xxxx node tools/build-single.mjs --out ../website-live/plan-studio/app/index.html`) or set it as a Worker variable, then deploy as usual.

## What was built

- Upload boundary on the lot card (menu item and button) and in the site finder, in housing and commercial modes.
- Files: KML, KMZ, GeoJSON, zipped shapefile, DXF (closed polylines, old style polylines, closed line loops, arcs), CSV and pasted coordinates (lat,lon or E,N). DWG shows an instruction to save as DXF. A bearings and distances entry shows the misclose and can adjust it.
- Coordinate systems: WGS84 for KML and GeoJSON, the .prj for shapefiles, and for E,N data a searchable list (MGA94 and GDA2020 zones 49 to 56, UTM zones 1 to 60 north and south, or a custom proj4 string). Otherwise place it by hand: drag and rotate the outline on the map, scale fixed from the file units (m, mm, ft).
- The uploaded lot is a normal lot (source upload) so layouts, Best fit, checks, 2D, 3D and the plan set all work. It carries "Boundary supplied by user, not checked against title" on screen and on the plan set sheets.
- Outside NSW and Queensland, or with Custom rules ticked, there is no council lookup. A Site rules panel holds the setbacks, site coverage, landscape %, parking rate and accessible bay rate, each labelled "Australian default, set your local rule" until you change it, and a currency selector (symbol only, no conversion).
- Aerial: NSW and Queensland keep their own imagery. Elsewhere Mapbox Satellite at 512 @2x is used for the 2D underlay, 3D ground and plan set, with the zoom chosen from the site size. Attribution reads "© Mapbox © OpenStreetMap" on screen and on the sheets.

## Files changed

New (GlideInside/pocket-architect-source):
- src/lib/proj4.cjs, src/lib/fflate.js, src/lib/README.md (vendored, MIT, no CDN)
- src/site/upload/ (crs.js, frame.js, parsers.js, bearings.js, units.js, lot.js, place-map.js, dialog.js, css.js, apply-upload.js, flow.js, rules-panel.js, sheet-text.js)
- src/site/mapbox-aerial.js, src/site/custom-rules.js
- tests/boundary-upload.test.mjs, tests/helpers/shp.mjs, tests/fixtures/upload/
- tools/upload-shots.cjs

Changed:
- server/lib/app.js, server/lib/config.js (health returns the public token when set)
- src/config.js, tools/build-single.mjs (token handling)
- src/site/apply.js, src/site/setback-stage.js, src/site/lot-checks.js
- src/commercial/checks.js, feasibility.js, lotcard.js, mode.js, parking.js, setbacks.js
- src/lotcard/lot-card.js, src/lotcard/stats.js, src/ui/embed-viewer.js, src/ui/find-block.js
- src/viewer3d/terrain.js (grey ground)
- src/premium/exporters/planset/commercial.js, cover.js, index.js, locality.js
- src/premium/exporters/eng/brand.js, eng/siteplan.js
- tests/planner-ui.test.mjs (the foot line now lives in the shared upload module)
- Rebuilt bundle in website-live/plan-studio/app and the portal mirror (website-live/portal/src)
