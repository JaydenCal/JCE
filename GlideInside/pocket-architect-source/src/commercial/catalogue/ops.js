// Catalogue building operations on a store: add, move, rotate, set a param, delete, or put one type on the lot. One undo step each.

import * as S from '../../model/schema.js'; // eslint-disable-line no-unused-vars
import { lotOf } from '../../model/placement.js';
import { isCommercial, normaliseCommercial } from '../schema.js';
import { materialise } from '../materialise.js';
import { newBuilding, buildingsOf } from './buildings.js';
import { paramsOf } from './params.js';
import { typeById } from './types/index.js';
import { placeBuilding } from './fit.js';

const guard = (p) => { if (!isCommercial(p)) throw new Error('This design is not in commercial mode.'); };
const redo = (p) => { p.commercial = normaliseCommercial(p.commercial); materialise(p); };
const find = (p, id) => p.commercial.buildings.find((b) => b.id === id);

/** Add a building of a type. Placed where it fits when no place is given (else at the lot centre). Returns the new id. */
export function addBuilding(store, typeId, { params, place, presetId } = {}) {
  let id = null;
  store.apply('Add building', (p) => {
    guard(p);
    const rec = newBuilding(typeId, { params, presetId, place });
    if (!place) {
      const fit = lotOf(p) ? placeBuilding(p, rec) : null;
      if (fit) rec.place = fit;
      else if (lotOf(p)) { const l = lotOf(p).boundary; rec.place = { x: l.reduce((s, q) => s + q.x, 0) / l.length, y: l.reduce((s, q) => s + q.y, 0) / l.length, rotationDeg: 0 }; }
    }
    p.commercial.buildings = [...(p.commercial.buildings || []), rec];
    id = rec.id;
    redo(p);
  });
  return id;
}

export function moveBuilding(store, id, place) {
  store.apply('Move building', (p) => {
    guard(p);
    const b = find(p, id);
    if (!b) return;
    b.place = { x: Number(place.x ?? b.place.x), y: Number(place.y ?? b.place.y), rotationDeg: Number(place.rotationDeg ?? b.place.rotationDeg) };
    redo(p);
  });
}

export function setBuildingParam(store, id, key, value) {
  store.apply('Change building', (p) => {
    guard(p);
    const b = find(p, id);
    const def = b && typeById(b.type);
    if (!def) return;
    b.params = paramsOf(def, { ...b.params, [key]: value });
    redo(p);
  });
}

export function deleteBuilding(store, id) {
  store.apply('Delete building', (p) => {
    guard(p);
    p.commercial.buildings = (p.commercial.buildings || []).filter((b) => b.id !== id);
    redo(p);
  });
}

/** Put one chosen type on the lot (from fit.js chooseBuilding): the strata rows go, the building stays. */
export function applyBuildingChoice(store, choice) {
  if (!choice) return false;
  store.apply('Change building type', (p) => {
    guard(p);
    p.commercial.rows = [];
    p.commercial.buildings = choice.buildings;
    p.commercial.parking = { ...p.commercial.parking, extra: [] };
    p.commercial.layout = { id: choice.id, label: choice.label, tooBig: !!choice.tooBig, typeId: choice.typeId, presetId: choice.presetId };
    redo(p);
    p.name = typeById(choice.typeId)?.label || choice.label;
  });
  return true;
}

export { buildingsOf };
