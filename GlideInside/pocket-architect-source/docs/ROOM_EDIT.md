# Room edit mode (3D viewer)

Pick one room, the building explodes in a short cinematic, every other room fades and locks, the camera flies in, and only that room can be edited.

## Using it

- 3D view, top right: **Edit room**. If a room (or a fixture in a room) is already selected it starts at once; otherwise tap a room (a floor, a wall, a fixture, or the roof from above).
- 2D plan: select a room and press **Edit in 3D, building opened up** in the properties panel.
- Code: `const v = await window.__ps.getViewer.ensure(); v.roomEdit.start(roomId)`.
- **Done** or **Esc** collapses the building with the edits applied (one undo step per edit, the usual Undo works). **Explode**, **Collapse**, **Replay**, **Reset view**, **Labels** are in the panel, with Undo and Redo.
- The panel edits the room's name and type, size (width and depth, or push a wall in or out by 100 mm), doors and windows (list, delete, add), fixtures (list, rotate, delete, add, drag in 3D), and floor finish. The Move, Window and Door tools of the normal Edit mode also work, limited to this room.
- Phones: the panel folds to a one line bar (Done and Tools). Reduced motion: no animation, the building jumps to each state.

## What is locked

Only the room itself, the walls on its outline, the doors and windows in those walls, and the furniture and stairs inside it can be changed. Everything else (other rooms, their walls, openings and fixtures, tanks, levels) is refused: a tap shows "locked", a drag is refused. Fixtures cannot be dragged out of the room.

## Shared walls

A wall the room shares with a neighbour moves the neighbour too (this is what `pushPull` in `model/ops.js` already did). `planResize` and `planWallMove` simulate the change on a copy first and report every room it touches:

- a neighbour that would drop under 500 mm on a side or under 0.25 m2 blocks the change with a message;
- a room that would fall under the comfortable minimum for its type (`softMinSide`, for example 2.4 m for a bedroom, 1.2 m for a bathroom) is allowed with a warning;
- the panel and the drag tell the person which neighbours were resized.

## Code map

| File | What |
| --- | --- |
| `src/viewer3d/explode-logic.js` | pure: staged progress curves, room and level offsets, fade, ownership of walls and fixtures, cinematic camera poses, reduced motion step |
| `src/viewer3d/explode-apply.js` | applies the maths to a built model (moves units, fades private copies of materials, restores); no DOM, tested in node |
| `src/viewer3d/room-edit-logic.js` | pure: room scope, lock rules, shared wall resize plans and warnings, opening placement, room description |
| `src/viewer3d/room-edit.js` | thin three.js and DOM layer: animation loop, camera, labels, panel, picking, keys |
| `src/viewer3d/edit.js` | takes a `guard` (canTouch, checkWallMove, checkItemMove, lift) so the existing tools respect the lock |
| `src/viewer3d/viewer.js` | creates the guard and `viewer.roomEdit`, rebinds after a model rebuild |

Tests: `tests/explode-logic.test.mjs`, `tests/explode-apply.test.mjs`, `tests/room-edit-logic.test.mjs`.

## Clip export hook (not built)

`viewer.roomEdit.renderAt(p)` applies the stage and the camera for progress `p` in 0..1 with no timing. A clip exporter can step `p` from 0 to 1, read each frame from `viewer.canvas` and encode it. See the header of `room-edit.js`.
