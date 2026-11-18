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
