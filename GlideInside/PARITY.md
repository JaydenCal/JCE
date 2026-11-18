# Model parity: one design, the same everywhere (18/11/2026)

A change to a design has to look the same in the residential and commercial tools, the lot card embed (`?embed=1`), the full editor, the interactive HTML export (offline 3D viewer) and the plan set. This page lists what is built where, how it is checked, and what was fixed.

## How it is built

There is one 3D builder, `src/viewer3d/build.js` (`buildModel`). The editor, the embed, the guided flow preview and the HTML export all call it, so a feature added there reaches all of them. What differs is the options and what happens after the build:

| Place | Entry | Options and post steps |
|---|---|---|
| Full editor | `viewer.js` `uiOptions()` | textures on, level filter, roof toggle, status view, aerial texture, contours, then breach overlay and door animation |
| Lot card embed | same viewer, `?embed=1` | same options. `confirmFrontage(viewer)` turns labels and dimensions off and neighbour houses on (a display choice stored in `lot.layers`, kept when the project is handed to the full editor) |
| HTML export and GLB | `exporters/model3d.js` | flat colours (no textures, a server has no canvas), ground disc removed, ground baked into vertex colours (`bakeGround`), site terrain kept, GLB then read back by the inlined viewer, lot labels drawn by the viewer from `pa-labels` |
| Plan set (PDF, DXF, HTML plan) | `exporters/shared.js` `wallShapes`, `openingLines`, `scheduleData`, `planset/*`, `eng/*` | 2D from the same project data |
| Lot card top view and mini map | `lotcard/topview.js` `housingScene`, `commercial/topview-scene.js`, `commercial/lotcard.js` | 2D from the project data and the colour schemes |

## Feature matrix

"Test" is the case in `tests/model-parity.test.mjs` that guards it. Samples: residential single storey, double storey, granny flat, commercial warehouse (named cladding and door colour), strata units (default colours), strata units with brick red doors.

| Feature | Editor | Embed | HTML export | Plan set | Top view | Test |
|---|---|---|---|---|---|---|
| Walls, openings (door, window, sliding, garage, roller), floors, slab, roof, ceiling, stairs, furniture | yes | yes | yes | yes (same ids) | footprint | inventory and plan tests |
| Roller door colour (`finishes.rollerDoor`), default dark grey for strata | yes | yes | yes | schedule | n/a | colour test |
| Cladding, roof, fascia and gutter colour | yes | yes | yes | n/a | roof colour | colour test, top view test |
| Downpipes, awnings, hood, base course (`trim`) | yes | yes | yes | n/a | n/a | colour test |
| Driveway, crossover, front path, letterbox, fence, garden beds, bushes | yes | yes | yes | driveway label | driveway | residential test |
| Rainwater tank | yes | yes | yes | yes | yes | plan and top view tests |
| Trees, street, kerb, pavement, markings, parked cars (commercial) | yes | yes | yes | pavement and parking | bays | commercial test |
| Catalogue building extras (dock canopy, dock recess) | yes | yes | yes | yes (text) | yes | plan set test |
| Lot boundary, setback envelope, street frontage | yes | yes | yes | yes | yes | inventory test |
| Lot and neighbour labels | yes | optional (layer) | yes (viewer labels) | yes | n/a | existing html test |
| Aerial photo on the ground | yes | yes | no (see below) | yes | yes | n/a |
| Textures (brick, corrugated, timber) | yes | yes | no (see below) | n/a | n/a | n/a |
| Neighbour houses and street trees on a real lot | layer, default off | layer, on | as the project's layers say | n/a | n/a | n/a |

## Differences that are deliberate

- Textures: a server cannot make canvas textures, so the export is flat colour with the same colours as the editor. The test compares colours, not maps.
- Aerial photo: the picture is not embedded in the model file (size and licence). The export bakes the lawn and paddock colours instead.
- Embed layers: the embed shows neighbour houses and no labels, as the concept models do. The project carries the layer choice, so "Open full editor" shows the same.

## Mismatches found and fixed

1. Commercial top view and lot card mini map drew the building in the cladding (wall) colour. From above a building shows its roof, and for Tilt panel grey and Charcoal the roof colour differs from the wall colour. Both now use `topViewFill()` in `src/commercial/finishes.js`, which is the roof colour the 3D model shows.
2. Dark roofs: the 3D model lifts very dark roof colours (Night Sky, Monument, Charcoal) so the form reads, but the plan, top view and mini map drew the unlifted colour. The lift is now one pure function, `src/model/colour-lift.js`, used by `build.js`, `schemeColours()` and `topViewFill()`. A test checks it against the three.js maths.
3. A commercial layout straight from the card (strata units, `convertToCommercial`) carried the shed default colours (steel off white, steel charcoal fascia) while the card said Warm white cladding and Dark grey doors, and the 3D changed colour the first time the same defaults were picked. `convertToCommercial` now writes the card defaults, so the layout looks the same before and after a pick, and the top view agrees.
4. Carried from the earlier session on this branch: lawn and paddock baked into the GLB terrain, commercial crossover kerbs dropped in 3D, lot labels in the HTML viewer.

## Checked and found equal

For all six samples and all 16 public designs: mesh inventory (kind, count, triangles, bounds to 2 cm, material colours) is identical between the editor, the embed (same layers), the HTML export through a real GLB round trip (client path and server path with JSON and `migrate`) and a project handed to the full editor. Wall, opening, room, furniture and stair ids in the 3D model equal those the plan set draws, and the wall outline is within the wall thickness of the plan. Every unit and building label the model has is in the commercial plan set, and every room name in the residential engineering plan set.

## Open items

- The downpipe colour (`#cfd2d3`) is fixed and does not follow the colour scheme trim colour. It is the same in every place, so it is consistent, but it is not a chosen colour.
- The road surface (`road` mesh) is being removed on `claude/remove-road`. The tests do not require it.
- A browser export keeps flat colours too (the builder is called without a texture library). Passing one when a DOM exists would make the local export textured, but the paid server export cannot, so they would differ.
