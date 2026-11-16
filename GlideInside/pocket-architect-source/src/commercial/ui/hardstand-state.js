// The Hardstand tool's own state, shared by the 2D plan, the top view and the panel: the pavement type being drawn, the draw mode and the
// selected drawn area. Ephemeral (not saved with the design).

import { hardstandTypes } from '../catalogue/pavements/hardstand.js';
import { roadKind } from '../catalogue/pavements/roads.js';

export const HS_MODES = Object.freeze([
  { id: 'road', key: 'L', label: 'Road or path', hint: 'Click each point of the road, driveway or footpath. Double click or Enter finishes, Backspace removes the last point, Escape cancels. Ends snap to the street frontage, building doors and other roads. Shift locks to 15 degree steps, Alt turns snapping off.' },
  { id: 'rect', key: 'R', label: 'Rectangle', hint: 'Click and drag across the area. Shift makes a square. A drag that starts on a slanted edge follows that edge.' },
  { id: 'poly', key: 'P', label: 'Polygon', hint: 'Click each corner. Double click, Enter or a click on the first corner finishes. Backspace removes the last corner. Shift locks to 15 degree steps.' },
  { id: 'fill', key: 'F', label: 'Fill area', hint: 'Click open ground inside a space bounded by buildings, existing pavement and the lot boundary to fill it.' },
  { id: 'edit', key: 'V', label: 'Select and edit', hint: 'Click a road, area or generated road, aisle or footpath to select it. Delete removes it. For a road, drag a point to reshape it, drag a midpoint dot to add a point, drag the width dot to set the width. For an area: Drag it to move it, drag a corner to reshape it, drag a midpoint dot or double click an edge to add a corner, double click or right click a corner to remove it.' },
]);

export const DEFAULT_TYPE = 'asphalt-ac10-car';

const listeners = new Set();
export const hsState = { type: DEFAULT_TYPE, mode: 'rect', selected: null, roadKind: 'road', roadWidth: null };

/** Pick the kind of road to draw: its default surface and width come with it. */
export function setRoadKind(id) { const k = roadKind(id); return setHsState({ roadKind: k.id, roadWidth: null, type: k.type }); }

export function setHsState(patch) {
  let changed = false;
  for (const [k, v] of Object.entries(patch)) if (k in hsState && hsState[k] !== v) { hsState[k] = v; changed = true; }
  if (changed) for (const fn of [...listeners]) fn(hsState);
  return hsState;
}
export function onHsState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const modeDef = (id) => HS_MODES.find((m) => m.id === id) || HS_MODES[0];
export const typeLabel = (id) => hardstandTypes().find((t) => t.id === id)?.short || id;
