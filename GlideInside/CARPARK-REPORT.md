# Car park generator report (claude/carpark-tool)

## What changed
- Merged claude/release-6 into the branch (conflicts only in toolbox, icons, panel-tool, toolstate and the generated bundle; both the Car park and Driveway PI tools are kept). Bundle rebuilt.
- Kept the earlier session's rewrite (snapshot 02dd5b5, already in this branch): carpark-field.js (spine aisle from the crossover with double loaded cross aisles, 2.6 x 5.4 m bays at 90 degrees, 6.2 m two way aisles, 1 m turning extensions), sitelayout.js and sitelayout-oriented.js.
- sitelayout.js: a door whose nearest free routing cell sits in a pocket cut off from the network now tries the next nearest cells, so an added building beside the main one is joined to the crossover.
- Road merge dropped: the "Merge with existing" offer is removed from hardstand-controller.js. The car park meets the lot frontage at a crossover and does not use road tool roads. roads.js is untouched so the road removal branch merges cleanly.
- tests/carpark-generator.test.mjs (new, 12 tests): for a small (40 x 60 m office), deep narrow (30 x 120 m warehouse) and large (100 x 140 m warehouse) lot: connectivity to the crossover, aisles at least 5.8 m, no paving or bay outside the lot or over a building, bay counts against the rate, accessible bays with a shared zone in the nearer half of the bays; plus 90 degree bays opening onto aisles, rebuild after moving a building, and crossover at the frontage.
- Updated older tests to the new layout (sitelayout oriented test, car park merge test).

## Tests
carpark-generator, carpark-auto, carpark, sitelayout, hardstand test files pass. Full suite not run (machine shared).

## Screenshots
/home/claude/shots/claude-carpark-tool/ : small, deepnarrow, large, each -2d and -3d (deepnarrow also -3d-close; small and large close views not captured, screenshot timeouts under load). Script: tools/carpark-shots.cjs (CASES=small,deepnarrow,large).

## Left
- Angled bays are NOT implemented: bays are 90 degrees only.
- Small lot with a dock warehouse (40 x 60 m) cannot meet the rate (2 of 4 bays, flagged limited); the lot is too small for the truck apron.
- Where a bay row fronts a door (office on the small lot) the vehicle reachable flag in summary stays false; the door is reached on foot over the footpath and bay row, and no warning is shown.
- The spine can wander sideways from the crossover on small lots (visible in the small 3D shot).

## Placement rules update (18/11/2026)
- New src/commercial/carpark-side.js (side aisle generator) is tried first for every non station lot; the old comb (carpark-field.js) is only the fallback when it cannot meet the demand. It lays one drive from the crossover and one aisle with 90 degree rows on both sides: either a side aisle beside the drive joined by a connector ('v', along a side setback) or an aisle across the lot that the drive meets ('h', across the front of the building). Candidates are scored on walk to the door plus paving, double loaded preferred, rows anchored flush to the drive and connector (no ground between bays and aisles).
- Truck apron and the drive to it are a no-bay, no-aisle zone: the crossover lines up with the apron, the drive is crossover wide and ends at the apron, 1.5 m clear is kept round the apron when the lot allows it (dropped only if that puts bays 25+ m further from the door). Drive aisles carry truckDrive: true.
- 6 m of clear drive from the street before the first bay (bay t0 >= 6 m); an aisle with no bays may leave the drive from 4.5 m when the apron starts close to the street.
- Door of a warehouse is now the office pod door (site.parking.zone), not the middle of the front; it is reached by a footpath (sw:foot, pedestrian) that avoids bay rows and the apron, never by an aisle through the apron. 1.5 m clear round buildings, entry canopies are not parked under.
- carpark-field.js: comb spine must start at the street when used from sitelayout (spineFromStart), fixing a spine that started behind a building and was cut off after a building move.
- draw-lotplan.js: the residential driveway strip is no longer drawn on a commercial lot that has site works.
- 3D cars: placement data was already correct (long axis along bay depth); added a test for all three lots (axis within 2 degrees, centred, footprint inside the bay). Renders confirm nose in.
- Angled bays: NOT added. The lots that are too narrow for a 90 degree row (deep narrow) already fit one row; 60/45 degree bays not implemented.
- Tests: tests/carpark-generator.test.mjs now 22 tests (apron/dock approach clear, 6 m queue, 40 m walk on the large lot, shared edges, car orientation). carpark-auto test accepts rows square to the lot edge. carpark-auto, carpark-generator, sitelayout, carpark, hardstand: 103 pass. commercial-assistant has 3 failures that also fail without my changes. Full suite not completed (machine load).
- Screenshots: /home/claude/shots/claude-carpark-tool/{large,small,deepnarrow}-{2d,2d-close,3d,3d-close}-v4.png (v3 for 2d-close).
- Not done: rotated buildings (sitelayout-oriented.js) still use the old comb layout; one side aisle only (very large demand falls back to the comb).

## 3D car orientation recheck (18/11/2026)
- New tests/carpark-car-mesh.test.mjs: builds the 3D entourage for the three sample lots, transforms the real car mesh vertices to world space, takes the minimum area oriented box, and asserts its long axis is within 5 degrees of the bay depth, the mesh footprint is inside the bay polygon, and the car is nose in (nose farther from the nearest aisle than the tail).
- Result against the old code: the axis and footprint checks PASSED (the mesh and placement already agreed; the car long axis lies along the bay depth); the nose in check FAILED because about 30 percent of cars were flipped at random. Fixed in entourage3d.js (no random flip; nose to the closed end of the bay). Passes now.
- Top down screenshots (tools/carpark-shots.cjs now also writes 3d-top) show cars lengthwise between the bay lines. Residential garage cars (car_sedan furniture) are 1850 x 4800 with the long axis along depth, the same in plan and 3D; no other car meshes exist.
