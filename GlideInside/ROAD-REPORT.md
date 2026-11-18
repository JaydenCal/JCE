# Road tool restored, automatic roads stay removed (18/11/2026)

Owner decision: "I still want the road tool, just not the automatic roads at the frontage."

## Restored (from 4517f18~1)
Road or pavement tool (key L): tool-pave, pave-controller, pave-state, draw-pave, panel-pave, viewer3d/pave3d, tool def, toolbox button, panel hook, icon, editor wiring, hardstand "Draw (L)" button and road mode, pavedways getWays returning saved ways, driveway PI handling of road tool driveways, road-tool and pavedways tests. User drawn roads and pavements draw in 2D, 3D (addDrawnWays back in site-extras), plan sets and engineering exports.

## Kept removed
- 3D carriageway, centre line, gutter, kerb, footpath, verge (site-extras), corridor flattening (terrain), automatic street trees.
- Step 1 lot preview road and flow map roads (no road, no STREET label).
- 2D editor plan view automatic linework (drawRoad deleted: ROAD CENTRELINE (INDICATIVE), KERB AND GUTTER, FOOTPATH).
- Plan sets (house and commercial): roadModel returns no road. Engineering site plan, locality street and site analysis diagram: automatic road gated off (AUTO_ROAD = false).
- "Road and kerb" layer toggle removed (it only controlled the automatic road).
- Kept: frontage fix (classifyEdges chaining, frontage-chain.test.mjs), frontage edge, setbacks.

## Fan of grey strips guard
- pavedways.fence(): drops NaN points, points more than 50 m from the lot bbox (a way is kept inside its lot), and doubled points; applied inside getWays so every consumer is protected. A way left with fewer than 2 points is dropped.
- pave3d: every piece must have all vertices finite and within wayBufferMm(way) of the way's own polyline (ringWithinBuffer) or it is skipped.
- Test (road-removed.test.mjs): a way with NaN, a point 90 m away, a doubled point and a 9e8 point builds a mesh whose every vertex is inside the polyline buffer.

## Tests
road-removed (rewritten to the new rule), road-tool, pavedways, driveway-pi, hardstand, residential-outbuildings, frontage-chain, grading, planset (site plan no longer expects EXISTING ROAD; scale check relaxed because the fit no longer includes the road).
Full suite: 1999 tests, 1997 pass first run. Failures: grading large lot time budget (load flake, passes alone) and planset site plan (fixed above, passes).

## Screenshots (/home/claude/shots/claude-remove-road/)
house-plan.png (2D, no automatic road linework), house-3d.png (3D, no automatic road), house-plan-drawn-road.png and house-3d-aerial-drawn-road.png (one user drawn road, no fan). Script: tools/road-restored-shots.cjs.

## Left
Hardstand commercial road mode and the pave tool UI were restored as they were; not re-screenshotted. Engineering/plan set PDFs with a drawn road not visually checked (covered by restored pavedways tests).
