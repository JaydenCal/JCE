// Residential outbuildings for the "Add building" picker: garages, shed, carport, machinery shed and a granny flat. Each builds a small
// design that is merged into the lot with placeHouse, so the house and the outbuilding share one plan.

import { plan } from './kit.js';
import { shedFarm } from './sheds.js';
import { grannyFlat } from './granny.js';
import { placeHouse } from '../../portal/place-house.js';

function garage(name, w, doors) {
  const b = plan({ name, type: 'shed' });
  const r = b.room('garage', name, 0, 0, w, 6000);
  doors.forEach((x) => b.opening('roller_door_2700', r, 's', x));
  b.opening('door_personal_access', r, 'e', 3000);
  b.finish('roof', 'corrugated', 'steel-off-white');
  return b.done();
}
function garden() {
  const b = plan({ name: 'Garden shed', type: 'shed' });
  const r = b.room('workshop', 'Garden shed', 0, 0, 3000, 2400);
  b.opening('door_personal_access', r, 's', 1500);
  b.opening('window_fixed_900', r, 'n', 1500);
  b.finish('external_walls', 'corrugated', 'steel-light-grey');
  b.finish('roof', 'corrugated', 'steel-gum-green');
  return b.done();
}
function carport() {
  const b = plan({ name: 'Carport', type: 'shed' });
  b.room('carport', 'Carport', 0, 0, 3600, 6000, { walls: false });
  return b.done();
}

/** The outbuildings residential lots can add. footprint is the nominal size in metres, for the picker. */
export const OUTBUILDINGS = [
  { id: 'garage-single', label: 'Single garage', footprint: '3.6 x 6.0 m', icon: 'bt-garage', create: () => garage('Single garage', 3600, [1800]) },
  { id: 'garage-double', label: 'Double garage', footprint: '6.0 x 6.0 m', icon: 'bt-garage', create: () => garage('Double garage', 6000, [1500, 4500]) },
  { id: 'shed', label: 'Garden shed', footprint: '3.0 x 2.4 m', icon: 'bt-shed', create: garden },
  { id: 'carport', label: 'Carport', footprint: '3.6 x 6.0 m', icon: 'bt-carport', create: carport },
  { id: 'machinery-shed', label: 'Machinery shed', footprint: '15 x 9 m', icon: 'bt-shed', create: shedFarm },
  { id: 'granny-flat', label: 'Granny flat', footprint: '9.6 x 8.8 m', icon: 'bt-home', create: grannyFlat },
];
export const outbuildingById = (id) => OUTBUILDINGS.find((o) => o.id === id) || null;

export function addOutbuilding(store, id) {
  const def = outbuildingById(id);
  if (!def) throw new Error('Unknown building type.');
  const house = def.create();
  store.apply(`Add ${def.label.toLowerCase()}`, (p) => { placeHouse(p, house); });
  return def;
}

