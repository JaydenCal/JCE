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
