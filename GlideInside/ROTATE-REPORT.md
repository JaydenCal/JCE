# Rotate tool (branch claude/rotate-tool-v2)

## What it is
A Rotate tool (key O, left tool rail, residential and commercial editors). It is the earlier agent's multi-item tool (src/editor2d/tool-rotate.js, rotate-logic.js, merged from origin/claude/rotate-tool-v2) with these additions made in this pass:

- Live turn: the project itself turns while the handle is dragged, so the split and 3D views follow. Each update undoes the previous update of the same drag and applies the new angle from the same start (no drift). The whole drag is one undo step, Escape cancels it and leaves nothing on the stack.
- Draggable pivot: press on the pivot cross and drag it (it snaps to building points and lot corners). Alt and click and the Pick pivot button still work. The pivot starts at the building centre.
- Driveway stays attached: turnHouseBy (src/site/site-items.js) now turns the stored driveway PIs (Driveway PI tool data, project.site.driveway) about the pivot, keeps the kerb end, then settleSiteItems keeps the edit only if it still works, otherwise the automatic route takes over. Either way it starts at the garage door and ends on the kerb. The Move house ring gets the same behaviour.
- Existing in the tool: protractor ticks and swept arc, live angle readout, 15 degree snap (1 degree with Shift, square to lot edges when close), typed angle box, -90/-15/+15/+90, Align to frontage, Align to nearest boundary, multi-item and whole development turns.

Removed from my first take (duplicates of the merged tool): rotate-controller.js, panel-rotate.js, site/rotate.js. They are in history (commit "Rotate tool v2 (first take)").

## Tests
tests/rotate-tool.test.mjs, 19 tests: the earlier agent's 16 plus driveway automatic attach, stored PI edit turns about the pivot and one undo restores it exactly, and live/pivot-drag wiring. Related files (driveway-pi, hardstand, residential-outbuildings, road-tool, panel-controls) pass.

## Screenshots
/home/claude/shots/claude-rotate-tool-v2/ (script: tools/rotate-shots.cjs): armed with house selected, free drag with arc and readout, after drag with driveway attached, Shift snap, pivot dragged to a corner, typed 28, align to frontage, align to nearest boundary, split view with live 3D.

## Left
- No setback "go back" prompt after a house turn (the Move house ring has one).
- A large turn drops a PI edit for the automatic route (by design, same as moving the house).
- Commercial screenshots not taken (covered by the earlier agent's tests).
