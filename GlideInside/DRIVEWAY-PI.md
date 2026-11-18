# Driveway PI tool (residential)

Request: "there should be a driveway PI tool/delete in the resi please similar to our road tool".

## What it does

In the residential plan editor the driveway can now be edited by its PIs (bend points), the same way the Road or pavement tool edits a road.

- Add a PI: click the driveway centreline (a dot and "Click to add a PI" shows under the pointer). Double click also adds one.
- Move a PI: drag its square handle. The driveway, edges, crossover and the 3D view update live and commit as one undo step.
- Delete a PI: select it and press Delete or Backspace, right click on it, or use the Delete PI button in the panel.
- Slide the kerb end: drag the green diamond. It stays on the kerb and is kept clear of the frontage corners.
- Bend radius: 3, 6 or 10 m chips in the panel round every PI.
- Reset to auto: drops the edit so the automatic route comes back (panel button, Site panel button). One undo step.
- Undo and redo work for every change.

The garage door end and the kerb end are never free. Only interior PIs move. A change that would take the driveway off the lot or through the house is refused with a plain message and the project is left unchanged.

A driveway drawn with the Road or pavement tool belongs to that tool. The Driveway PIs tool says so and does nothing to it.

Handle style, hint text style and keyboard behaviour mirror the road tool (white squares with a gold edge, gold selected PI, green kerb diamond, dark readout pill).

## Where it is

- Left tool rail, residential only: "Driveway PIs" (key I), next to Road or pavement. Hidden in commercial mode.
- Right panel while the tool is armed: status, Delete PI, Reset to auto, bend radius, hint.
- Site panel (residential): a Driveway card with "Edit driveway PIs" and "Reset to auto".

## Data model and persistence

The edit is stored in `project.site.driveway` (already used by the guided Place step): `{ endOffsetMm, pis[{x,y}], radiusM, widthMm }`. It is part of the project JSON, so it saves, reloads and exports with the design, and the 3D model, plan set and fit checks follow it because they all call `deriveDriveway`.

When an automatic route goes round the house, the first edit seeds the stored PIs from the route's own bends (`autoPis`, new on the `deriveDriveway` result), so the edit starts from what the person sees. The limit is now 12 PIs (was 6, `MAX_DRIVE_PIS`).

## Files

New:
- `pocket-architect-source/src/site/drivepi.js` site logic: add, move, delete PI, slide end, radius, reset, hit test, validation and rollback.
- `pocket-architect-source/src/editor2d/drivepi-controller.js` pointer, key, right click behaviour, one undo step per change.
- `pocket-architect-source/src/editor2d/tool-drivepi.js` canvas tool and overlay drawing.
- `pocket-architect-source/src/ui/panel-drivepi.js` right panel and the Site panel card.
- `pocket-architect-source/tests/driveway-pi.test.mjs` 14 tests.

Changed:
- `src/site/lotplan.js` (PI limit, `autoPis`), `src/editor2d/editor.js` (register tool, right click hook), `src/editor2d/tools-meta.js` (tool def and tooltip), `src/ui/toolbox.js`, `src/ui/toolstate.js`, `src/ui/panel-tool.js`, `src/ui/panel-site.js`, `src/ui/icons.js`.
- Built bundle under `website-live/plan-studio/app/`.

## Not done

- No browser click through was possible in this environment. Behaviour is covered by controller level tests, not a canvas test.
- Width is not editable in this tool (the guided Place step has a width control).
