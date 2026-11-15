// The Driveway and road tool's own state, shared by the 2D plan, the panel and the status bar: what is being drawn (driveway or road),
// the material, the width and corner radius, the mode and the selected way. Ephemeral (not saved with the design).

import { KINDS, MATERIAL_IDS } from '../site/pavedways.js';

export const PAVE_MODES = Object.freeze([
  { id: 'draw', key: 'D', label: 'Draw', hint: 'Click each point along the driveway or road. Start on the street side: a click in the verge snaps to the kerb and adds the crossover. Double click or Enter finishes, Backspace removes the last point, Esc cancels. [ and ] change the width, Shift locks 15 degree steps, Alt turns snapping off.' },
  { id: 'edit', key: 'V', label: 'Edit', hint: 'Click a driveway or road to select it. Drag a square to move a point, drag a dot or double click the line to add a point, double click a point to remove it. Delete removes the point or the whole way.' },
]);

const listeners = new Set();
export const paveState = { kind: 'driveway', material: null, widthMm: { driveway: 3500, road: 5000 }, radiusMm: 4000, mode: 'draw', selected: null };

export function setPaveState(patch) {
  let changed = false;
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in paveState)) continue;
    if (k === 'widthMm' && v && typeof v === 'object') { paveState.widthMm = { ...paveState.widthMm, ...v }; changed = true; continue; }
    if (paveState[k] !== v) { paveState[k] = v; changed = true; }
  }
  if (changed) for (const fn of [...listeners]) fn(paveState);
  return paveState;
}
export function onPaveState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const paveMode = (id) => PAVE_MODES.find((m) => m.id === id) || PAVE_MODES[0];
export const currentWidth = () => paveState.widthMm[paveState.kind] || KINDS[paveState.kind].defMm;
export const validMaterial = (m) => (MATERIAL_IDS.includes(m) ? m : null);
