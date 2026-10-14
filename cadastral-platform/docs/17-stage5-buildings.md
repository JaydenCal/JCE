# 17. Stage 5: buildings import and placement

Date: 15/10/2026. Status: STAGE 5 COMPLETE, REVIEW FIXES APPLIED (section 8), AWAITING OWNER REVIEW. Local commits only; nothing pushed.

Owner decisions applied: the house is designed in Plan Studio (or imported from a PDF or DXF) and then placed on the LiDAR terrain here. A building is never designed in JCESITE. Pools, sheds, granny flats, units, gardens, footpaths and lawn furniture are placeable.

## 1. What was built

| Item | Where |
|---|---|
| Object types `building`, `pool`, `footpath`, `furniture`; surface kinds on `landscape_area` | `frontend/src/lib/site/types.ts`, `backend/app/design/site_design.py` |
| Operations `place_building`, `set_catalogue_item`; building aware `move_object`, `rotate_object`, `duplicate_object`; typed parameter checks | `frontend/src/lib/site/ops.ts`, `buildings.ts` |
| Importers (Plan Studio, footprint entry, DXF via SA8, PDF via SA7) | `backend/app/design/building_import.py` |
| Route `POST /projects/{id}/site-design/import-building` (multipart) | `backend/app/api/site_design.py` |
| API client | `frontend/src/lib/site/buildingImport.ts` |
| Scene drawing, cut and fill slab, GLB placement | `frontend/src/lib/site/siteScene.ts` |
| Placement tools | `frontend/src/lib/site/designController.ts` |
| Design tab: Import building, site features, building properties | `components/viewer/BuildingTools.tsx`, `DesignPanel.tsx`, `ViewerShell.tsx` |
| Plan Studio side: `site_export`, site points, embed messages | `ps-src/plan-studio/src/ui/site-export.js` and the files listed in section 6 |

## 2. The building object

`type: "building"`, geometry a polygon: the largest ring of the ground floor (datum) level, so snapping, the lot check and the area readout work as for any polygon. A `building` block (read only) carries `levels` (a name, an elevation relative to the ground floor from the source, outer rings in MGA), `datum_index`, `roof_outline`, `exits` (sewer, water, downpipes), `frame` (`origin` = MGA of the importer's local (0, 0), `yaw_deg` = clockwise turn since import, `north_deg` = Plan Studio north angle already applied), `glb_name` and the import `notes`.

Parameters: `building_use` (house, granny_flat, unit, shed, other), `source`, `source_file`, `roof_plan_area_m2` and `roof_area_basis` (`SOURCE VALUE`, `APPROXIMATE (PLAN STUDIO RASTER)` or `NOT SET`), `ffl_rl` (absolute RL, set by the user) and `height_m`. `ffl_rl` and `height_m` start UNRESOLVED. The source facts (`source`, `source_file`, roof area and basis) cannot be edited by hand; import again.

Operations: `place_building` copies an import payload through one transform (the payload reference point goes to the clicked position, turned clockwise by `yaw_deg`) and adds any tank that came with it as an `rwt`, all in one undo step. `move_object` and `rotate_object` move the footprint, levels, roof outline, exits and frame together. `edit_vertices` and `add_object` refuse a building. `set_param` checks types: `ffl_rl`, `height_m`, pool depth and furniture dimensions must be numbers; `building_use`, the surface kinds and the roof area basis must be in their lists. The backend model refuses the same.

## 3. Importers

All return one `building_import.v1` payload in LOCAL plan coordinates (metres, x east, y north, origin arbitrary but stated by `ref`). The route answers 422 for a bad file (code and message in the body), 415 for an unsupported type, 413 above 15 MB, 401 without a user.

**Plan Studio (`.planstudio.json`).** The file is checked the way Plan Studio's own `migrate` and `validate` check it (schema 1 or 2; a newer schema is refused). When the file has a `site_export` block that agrees with the project (level count, elevations) it is used; otherwise everything is derived by a port of Plan Studio's raster code (`viewer3d/footprint.js` `rasteriseLevel`, `ui/schedules.js` `roofPlanAreaM2`) to numpy. Both paths give the same footprint and the same roof area (a test compares them with Plan Studio's own JavaScript value for the fixture).

- *Vectorisation and tolerance.* The 100 mm raster is merged into polygons and simplified with Douglas-Peucker at 0.05 m (half a cell, so a one cell feature survives). The area change is at most the perimeter times 0.05 m. Only outer rings are kept; courtyards are reported in the notes. A house turned off the grid gives many vertices at this tolerance.
- *Handedness, units, north.* Plan Studio plan y points down the sheet and its north arrow is rotated clockwise by `site.northDeg`. A plan point (px, py) in mm becomes (E, N) = (px cos n + py sin n, px sin n - py cos n) / 1000: a rotation composed with a flip. Rings are re-oriented counter clockwise. With the default yaw the building is true-north oriented.
- *Roof.* The roof outline is the dilated footprint only where the source gives an eave overhang (otherwise the note says ROOF OVERHANG NOT IN SOURCE). The plan area is Plan Studio's raster value labelled `APPROXIMATE (PLAN STUDIO RASTER)`. Overhang rounding follows JavaScript `Math.round` (halves up), not Python's banker's rounding; a test pins it.
- *Tanks.* Site tanks become `rwt` objects with `capacity_l`, `diameter_m` and `height_m` from the file (at most 64; more is a 422). A non standard capacity has a Plan Studio ESTIMATE for its diameter and height, not a manufacturer dimension: those two parameters carry the basis `platform_default` with the reference `PLAN STUDIO ESTIMATE: ...` (the basis list is closed). Inlet, overflow and outlet levels are NOT SET.
- *Not in a Plan Studio file:* the roof ridge height and the absolute floor level. Both stay NOT SET and the notes say so (the ceiling height of the top level is quoted as information only).

**Footprint entry.** Width and depth (or a drawn polygon) plus the use. Height, FFL and roof area NOT SET.

**DXF.** SA8 `from_dxf`; the footprint is the union of the enclosed rooms it infers. SA8 confidence and notes are carried; a confidence below 0.6 sets `requires_confirmation` and the page asks the user to confirm. The DXF position on the site is not known, so the footprint is placed by the user.

**PDF.** SA7 aligns the sheet to the lot (the page sends the lot ring and the CRS). SA7's refusal stands: above 0.30 m RMSE (or no scale, no slab, no control points) the route answers 422 with SA7's code (`ALIGN_REFUSED`). Between 0.10 and 0.30 m the page asks the user to confirm before placing. `aligned_at` gives the MGA position of the aligned footprint.

## 4. Design tab

- **Import building.** A file picker (`.planstudio.json`, `.pdf`, `.dxf`, and a `.glb` alongside a Plan Studio file), a use selector, a width and depth entry, and a "Draw footprint" polygon tool (needs a use). The result follows the cursor on the terrain (the outline is re-draped on every move) until it is clicked; R, Q and E turn it by 15 degrees. After that it is dragged, rotated and moved like any object. The import needs a saved project (the demo page has no server).
- **Rendering.** Always a draped footprint outline and fill. With `ffl_rl` set: a slab at the FFL coloured by cut / fill against the terrain, in the scene bundle colours (cut `#d9582b`, fill `#2b6fd9`, white at zero, saturating at 1.5 m; cf = FFL minus ground). With `ffl_rl` and `height_m` set: walls from the FFL to FFL + height, and the roof outline at the top. With either missing the label says FFL NOT SET and HEIGHT NOT SET and nothing is drawn above the ground. A Plan Studio GLB (GLTFLoader) replaces the block as the visual and is placed at the FFL; its axes (metres, Y up, X = plan x, Z = plan y) are mapped with the Plan Studio north angle and the placement yaw (a proper rotation, no mirroring).
- **Properties.** Roof plan area and its basis (with a note that an approximate value is not a measured area), FFL, height, exits, floor level against the ground at the footprint corners (vertices only, not a volume), the levels with their elevations above the ground floor, the import notes and the GLB state.
- **Site features.** Pool (polygon; depth and coping width NOT SET; the label POOL BARRIER REQUIREMENTS: SEE RULES with the parameter `barrier_requirements` UNRESOLVED), footpath (a line with a width, or an area; surface kind concrete, pavers, gravel or permeable pavers, NOT SET by default), garden (a `landscape_area` with surface kind `garden_bed`; the kinds are turf, garden_bed, mulch, gravel, permeable_paving, impervious_paving) and outdoor furniture (a point; the catalogue item id; sized from catalogue dimensions only: the retail catalogue item's `dims`, or the Plan Studio default sizes for BBQ, outdoor table and sun lounge as proxies; otherwise DIMENSIONS NOT SET). Sheds, granny flats and units are buildings with a `building_use`.

## 5. Tests and checks

- Backend `tests/test_building_import.py` (35 tests): flip, rotation and units against an independent statement of the mapping, vectorisation area within tolerance, courtyard reporting, roof basis and missing overhang, overhang rounding, tanks to rwt, two storeys, bad files (422), migrate of schema 1, the DXF and PDF paths reusing the SA8 and SA7 fixtures (including SA7's refusal), and the route (auth 401, 413, 415, 422, success paths). The golden payload `backend/tests/fixtures/building_import_planstudio.json` is compared with the importer output (`UPDATE_BUILDING_PAYLOAD=1` regenerates it). The Plan Studio files are marked SYNTHETIC TEST FIXTURE.
- Frontend `tests/site/buildings.test.ts`, `buildings_scene.test.ts`, `building_import_client.test.ts`: the operations (transform, undo, read only rules, typed parameters), the scene (labels, slab colours, walls, GLB matrix), the placement tool, the client. `fixture_export.test.ts` now covers all fifteen types and the golden file `site_design_v1_frontend.json` is validated by the Pydantic model.
- Plan Studio `tests/site-export.test.mjs` (9 tests): vectorisation, the site_export block, schema 2 back-fill, the embed messages.

## 6. Plan Studio changes (`ps-src/plan-studio`, local git, commit "JCESITE site export")

- `src/ui/site-export.js`: `buildSiteExport(project)` writes the `site_export` block (`planstudio.site_export.v1`): per level the vectorised footprint (mm, plan frame), `ffl_above_ground_floor_mm`, the roof outline and `plan_area_m2` with `area_basis: "approximate_raster"`, downpipes, sewer exits and water exits. Saved design files carry it (`saveDesign`); loading ignores and drops it, so it is always rebuilt on the next save.
- Schema version 2: `site.points` (kinds `downpipe`, `sewer_exit`, `water_exit`) with a back-fill for version 1 files; ops `add_site_point` and `update_site_point`; a Site point tool in the 2D editor (key P, draw, hit test, panel, move, status).
- Embed: `ps:get-project` (optional `requestId`, `glb: true`) is answered with `ps:project` carrying the project (with `site_export`) and, on request, the GLB as a transferred ArrayBuffer. The origin allowlist is unchanged.

## 7. Known gaps

- **GLB bytes are not stored in the design** (5 MB document cap). The document keeps `glb_name`; after a reload the properties panel asks for the file again.
- **Drawing and importing need the server.** On the demo page the import box is disabled and says so. The footprint entry also goes through the route (one code path for validation).
- **Rotated houses vectorise to many vertices** at 0.05 m. A tighter or looser tolerance is a one line change; the area difference is bounded as stated above.
- **Roof height and pitch are not in a Plan Studio file**, so the overall height stays NOT SET until the user enters it.
- Courtyards are not representable in a footprint and are reported, not kept.
- The embed transport (`ps:get-project`) is built and tested in Plan Studio, but this stage has no host page that calls it; the file picker is the working path. It answers only a host in Plan Studio's fixed list, after the user confirms (section 8).
- The PS premium UI tests (3 of 44) fail in this environment both before and after the changes (browser driven).

## 8. Review fixes

1. **Embed host allowlist (Plan Studio).** The host list is no longer read from `?host=` (any site could frame the app and name itself). `CONFIG.embedHosts` is fixed at build time (`PS_EMBED_HOSTS` writes `<meta name="ps-embed-hosts">`). `ps:get-project` is answered only to an origin in that list AND after the user agrees in a visible prompt, once per session per host. The server (`EMBED_HOSTS`) sends `Content-Security-Policy: frame-ancestors 'self' <hosts>` on every response, and `worker.js` adds it to HTML served from the assets binding; any other host that serves the HTML must send the same header (`tools/build-single.mjs` writes `dist/_headers`).
2. **Exit limits.** More than 64 sewer or 64 water exits (or 256 downpipes) is a 422 `TOO_MANY_EXITS`; model construction is wrapped so a limit of the site design model is a 422 `IMPORT_EXCEEDS_LIMITS`, never a 500. Nothing is dropped.
3. **CPU budget (Plan Studio importer).** Limits: 2,000 vertices per room, 100,000 vertices per file, a work estimate (grid cells per level, room bounding box cells times vertices, a cost per wall, the roof dilation) of at most 300 million, 20,000 row runs per level mask, a roof overhang of at most 5,000 mm, and a 10 s wall clock for rasterise and derive. Any of them is a 422 `IMPORT_TOO_COMPLEX` ("IMPORT TOO COMPLEX: ..."). The estimate is checked before rasterising.
4. **PDF alignment.** A payload with `aligned_at` is placed at that MGA position with yaw 0 (SA7 returns the footprint in MGA orientation), labelled `PLACED BY PDF ALIGNMENT, CHECK`. It is an ordinary building afterwards: drag and turn it as usual.
5. **Stored imports.** The import route saves each payload under `<project dir>/imports/<import_id>.json` (200 per project, the oldest unused first) and returns `import_id`. `place_building` takes `import_id` plus the payload and the building carries `building.import_id`. On every PUT the server compares each building with its stored import: levels, rings, roof outline, exits, datum, north angle, notes, the footprint polygon and the read only facts (`source`, `source_file`, `roof_area_basis`, `roof_plan_area_m2`), through the building's placement (`MGA = frame.origin + R(yaw) . local`, to 1 mm). Only placement, label, status, `building_use`, `ffl_rl`, `height_m` and `glb_name` may differ. Otherwise 422 `BUILDING_NOT_FROM_IMPORT` or `BUILDING_IMPORT_MISMATCH`, and the page shows the message. `place_building` is marked `ai: false` and is not in `toolSchemas()`: the AI (stage 10) may move existing buildings only.
6. **Building use.** A use the file or the user does not give is NOT SET (unresolved), never `other` with a user basis.
7. **Tank estimates.** See section 3. Plan Studio writes `sizeBasis` ("standard" or "estimate") on each tank; an older file is judged by the standard size table.
8. **Tank cap.** 64 tanks with one building, enforced by the server (422 `TOO_MANY_TANKS`) and by the client parser (an error, no truncation); the server message is shown.
9. **GLB vertical datum.** `glbMatrix` subtracts the datum level's elevation, so when no level is at 0 and the lowest level is the datum, the GLB slab meets the footprint slab at `ffl_rl`. A test pushes one plan point through `place_building` and `glbMatrix` with a non zero north angle and yaw.
10. **Upload cap.** The import route cuts a chunked upload off with 413 as soon as the bytes received pass the cap (15 MB plus 64 KB of framing), before the multipart parser has spooled the body.
11. **Drawn footprints.** A ring that crosses itself is a 422 "FOOTPRINT RING SELF INTERSECTS, REDRAW" (no repair, so the centroid the page places at is the drawn one).
12. **to_be_removed.** A building is never placed as `to_be_removed`; `set_status` allows it for an EXISTING building only (a proposed building is deleted instead).
