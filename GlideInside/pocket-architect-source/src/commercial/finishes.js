// Cladding and roller door colours for the commercial lot card. Generic names only (no product or brand names). The choice is kept in
// project.commercial.finishes ({ cladding, door } ids) and written to project.finishes, which the 3D view, the plan and the exports read.

import { isCommercial } from './schema.js';
import { liftDarkHex } from '../model/colour-lift.js';

/** Wall and roof cladding. `material` is the wall finish (concrete for the tilt panel look, else corrugated steel), `roof` the roof colour. */
export const CLADDING = Object.freeze([
  { id: 'tilt-panel-grey', name: 'Tilt panel grey', hex: '#a7a8a3', material: 'concrete', roof: '#c9cbcb' },
  { id: 'pale-grey', name: 'Pale grey', hex: '#cdd0d0', material: 'corrugated', roof: '#cdd0d0' },
  { id: 'warm-white', name: 'Warm white', hex: '#e8e5da', material: 'corrugated', roof: '#e8e5da' },
  { id: 'sand', name: 'Sand', hex: '#c8bb9c', material: 'corrugated', roof: '#c8bb9c' },
  { id: 'sage', name: 'Sage green', hex: '#9fa995', material: 'corrugated', roof: '#9fa995' },
  { id: 'dark-grey', name: 'Dark grey', hex: '#6c7074', material: 'corrugated', roof: '#6c7074' },
  { id: 'charcoal', name: 'Charcoal', hex: '#464a4f', material: 'corrugated', roof: '#6c7074' },
]);

export const DOORS = Object.freeze([
  { id: 'dark-grey', name: 'Dark grey', hex: '#5b6064' },
  { id: 'pale-grey', name: 'Pale grey', hex: '#cdd0d0' },
  { id: 'warm-white', name: 'Warm white', hex: '#e8e5da' },
  { id: 'charcoal', name: 'Charcoal', hex: '#3d4146' },
  { id: 'forest-green', name: 'Forest green', hex: '#3f5a48' },
  { id: 'deep-blue', name: 'Deep blue', hex: '#35506b' },
  { id: 'brick-red', name: 'Brick red', hex: '#8c3f30' },
]);

export const DEFAULT_FINISH = Object.freeze({ cladding: 'warm-white', door: 'dark-grey' });

export const claddingById = (id) => CLADDING.find((c) => c.id === id) || CLADDING.find((c) => c.id === DEFAULT_FINISH.cladding);
export const doorById = (id) => DOORS.find((c) => c.id === id) || DOORS.find((c) => c.id === DEFAULT_FINISH.door);

/** The ids in force: the saved choice, else the defaults. */
export function finishesOf(project) {
  const f = project?.commercial?.finishes || {};
  return { cladding: claddingById(f.cladding).id, door: doorById(f.door).id };
}

/**
 * The colour a building takes on the top view and the lot card mini map. Seen from above a building shows its roof, so this is the roof
 * colour the 3D model shows (project.finishes.roof once set, else the cladding's own roof colour, dark ones lifted as the model does), never the wall colour.
 */
export function topViewFill(project) {
  const set = project?.finishes?.roof?.colour;
  const hex = typeof set === 'string' && /^#[0-9a-f]{6}$/i.test(set) ? set : claddingById(finishesOf(project).cladding).roof;
  return liftDarkHex(hex, 0.27); // the 3D model lifts very dark roofs the same way (src/viewer3d/build.js)
}

/** One line for the card: "Warm white cladding, Dark grey doors". */
export const finishLine = (project) => {
  const f = finishesOf(project);
  return `${claddingById(f.cladding).name} cladding, ${doorById(f.door).name} doors`;
};

/** Write the choice onto a project (inside store.apply): the commercial record and the finishes the model is built from. */
export function applyFinishes(p, { cladding, door } = {}) {
  if (!isCommercial(p)) return p;
  const cur = finishesOf(p);
  const cl = claddingById(cladding || cur.cladding);
  const dr = doorById(door || cur.door);
  p.commercial.finishes = { cladding: cl.id, door: dr.id };
  const fin = p.finishes || (p.finishes = {});
  fin.externalWalls = { ...(fin.externalWalls || {}), material: cl.material, colour: cl.hex };
  fin.internalWalls = { ...(fin.internalWalls || {}), material: 'corrugated', colour: cl.hex };
  fin.roof = { ...(fin.roof || {}), material: 'corrugated', colour: cl.roof };
  fin.fascia = { ...(fin.fascia || {}), colour: '#464a4f' };
  fin.frames = { ...(fin.frames || {}), colour: '#464a4f' };
  fin.rollerDoor = { colour: dr.hex };
  return p;
}
