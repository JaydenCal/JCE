# Terrain smoothing (claude/terrain-smooth)

Cause: the ground is the elevation grid from the DEM, drawn bilinear. When the source heights sit on a step (whole or half metres, as in the owner's 756 Quia Road lot) every gentle slope arrives as flat plateaus with a full step between them, which the mesh draws as terraces.

Fix: src/site/contours.js quantStep detects a stepped grid and smoothTerraces rebuilds the ground between step edges (each cell sits between the step below and the step above in proportion to distance from each, then a small blur). Applied in the server (buildContours) and in the browser (buildTerrain), so cached API responses are fixed too. Grids that are not stepped are untouched. About 0.3 s for 160,000 nodes; the viewer grid cap is unchanged so large lots stay fast.

Tests: tests/terrain-smooth.test.mjs (800 x 500 m, 2 percent fall, 1 m and 0.5 m steps). Screenshots: /home/claude/shots/terrain (tools/terrain-shots.cjs, before and after, AERIAL=off shows the lawn).

Not verified: the live NSW DEM could not be fetched from this machine, so the step in the live data is inferred from the symptom.
