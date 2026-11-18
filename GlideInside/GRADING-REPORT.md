# Grading phase 2 report (18/11/2026)

Branch claude/grading-v2, worktree /home/claude/wt-grading-v2. Merged claude/release-6 first, and the earlier snapshot 65ff2b2 is already part of the branch.

## 1. Warehouse low oblique: floating strips and missing ground

Cause. The exact surfaces (road, crossover, car park and driveway paving) are drawn at the finished design level. The terrain mesh is a coarse grid (0.75 m or more) set a little under them, and it follows the natural ground just outside each edge. On a slope the surface edge therefore stands over the mesh with air beneath it. Measured on the test lots (4 m fall), by sampling every edge of every exact surface against the mesh:
- warehouse: paving edges up to 0.45 m over the mesh, crossover edges up to 0.43 m, road edges up to 0.54 m
- strata row: paving edges up to 1.9 m at the lot boundary
- house: crossover 0.43 m, driveway 0.19 m
From a low camera these read as floating strips with no ground under them.

Fix. New src/viewer3d/skirts.js: a vertical skirt from the edge of every exact surface down to 5 cm under the mesh, only where the gap exceeds 15 mm. It is built in addSiteTerrain (mesh name edge-skirts, about 5 ms). Batters already stop at the lot boundary (phase 1 work), so where the design meets neighbouring land the skirt reads as the retaining face.

Not fixed. The grey strips and slivers at the kerb view (green sliver along the carriageway edge where an asphalt area crosses the verge, the footpath corner at the layback) are overlapping exact surfaces of different elements, not gaps; they are unchanged. The mesh is still not cut along element edges (the plan's cut cells).

## 2. Terrain rebuild speed

- natural ground RL cached per node layout (per elevation grid)
- triangle index buffer cached per grid size
- incremental node update: after an edit only nodes within reach of a changed design element are recomputed (element signature = outline plus levels in RL terms, so a floor RL change does not dirty the grid). The result equals a full rebuild exactly (tested to 1e-6 m)
- per phase timing in terrainStats (terrain.js)

Medians of 7 edits (building moved 0.4 m), warm Node, machine at load average 18 so absolute numbers are noisy:

| Lot | before, terrain ms | after, terrain ms | nodes recomputed |
|---|---|---|---|
| house, 100 x 129 grid | 254 | 192 | about 78 percent |
| warehouse, 161 x 215 grid | 557 | 473 | about 41 percent |
| large 250 x 400 m | 649 | 468 | about 8 percent |

Targets (under 300 ms residential, under 1 s large commercial) are met for the terrain part. The whole build is still 400 ms (house) to 800 ms (warehouse): the remaining cost is site extras (100 to 250 ms), the wide aerial ground, geometry and normals, which were not touched. A quiet machine and a browser were not measured.

## 3. Watchdog

src/viewer3d/watchdog.js holds the logic, viewer.js uses it. A full build over 2 s drops to low detail as before. The full build time is estimated from the ratio seen at the drop; after 2 fast low builds in a row (estimate under 60 percent of the limit) it returns to full detail and hides the note. A recovery that is slow again doubles the streak needed (up to 16), and a fast full build resets it.

## Tests
tests/grading-v2.test.mjs (9 tests): skirt continuity on warehouse, strata and house; the model carries the skirts; incremental equals full on a large lot and after a pad level change; generous timing budget; watchdog degrade, recover and back off.

## Screenshots (/home/claude/shots/claude-grading-v2/)
before-* and after-*: warehouse kerb, lowB, oblique, 3d and house kerb, oblique. after-house-kerb shows the gap beside the crossover now closed. after-warehouse-lowH shows the skirts under the car park edge. Warehouse and house before and after at the oblique are visually close; the gap is only visible at edges.

## Left
Cut cells (mesh split along element edges), in-lot raised kerb and footpath elements, a retaining wall colour for skirts at the boundary, overlapping surfaces at the verge, extras phase speed.

# Grading phase 3 (18/11/2026): one continuous sealed surface

Owner feedback on after-warehouse-lowH.png: a staircase of terraces with grey skirts, grass between the pavements, a tall wall at the boundary.

## Cause found
The design surface was already one plane per connected pavement cluster (5 percent max, fds.js and grading.js: paving:0 was a single plane, no steps). The terraces were not levels. They were gaps in the pavement polygons: a bay row was split into runs (one 2.4 m bay, then a 2.4 m gap for the accessible shared zone, and so on), and the bay rows stood 400 mm short of the apron. The gaps were grass, and the edge skirts (phase 2) drew a grey wall down every run edge.

## Changes
- src/commercial/catalogue/pavements/logic.js: each bay row is now one rectangle in its own frame (runs and gaps paved together); joinNetwork() adds a joining area wherever two automatic site layout areas are 50 mm to 600 mm apart and do not overlap (hull of the facing edge samples only, so no large infill). One network is one sealed surface with no ground showing between apron, aisles, bays and crossover. Planted islands (landscape) are unchanged and are not paved.
- src/viewer3d/skirts.js: skirts are skipped where the outward side is another exact surface at an equal level (within 30 mm); skirt colour is now the grass colour (safety net only). New retainingWallGeometry(): a block coloured wall face (#9c9a93) with a 0.3 m capping (#cfcdc6) along the lot boundary wherever a batter cannot fit (retainingEdges, step over 150 mm), built in terrain.js as retaining-wall and retaining-wall-cap.
- src/viewer3d/site-geom.js padHeight: batter 1V:3H in fill, 1V:2H in cut (was 3 for both). Batters already stop at the lot boundary, where the wall takes over.
- House driveway and pad: same code path (driveway plane limited to 20 percent, grass batters); no skirt walls remain in the house views.

## Tests (tests/grading-v2.test.mjs, 17 tests, plus grading.test.mjs cut batter now 1V:2H)
- network gap test: no gap over 50 mm between sealed pavement polygons within 3 m of each other (a wider gap must be covered by a joining area), warehouse and strata
- paving falls within 5 percent, drives within 25 percent, no step across a network, overall batter slope within 1V:2H, on warehouse, strata and house
- retaining wall and capping meshes present, skirts coloured like the ground
- no visible skirt over 80 mm inside the lot away from the boundary (30 mm subgrade plus one cell of slope can show 50 to 65 mm of grass coloured net; the 50 mm target is not met exactly)
Not done: aisles up to 8 percent (the plane is limited to 5 percent everywhere), a flagged steeper ramp, and a best fit warped (non planar) surface. A cluster is still one plane.

## Screenshots (/home/claude/shots/claude-grading-v2/)
v3-warehouse-lowA to lowH, v3-house-kerb, oblique, street, crossover. v3-warehouse-lowH shows one smooth sloping sealed surface, bay lines on it, no grass strips, no terraces. v3-warehouse-lowB shows the car park from the far end as one surface.
