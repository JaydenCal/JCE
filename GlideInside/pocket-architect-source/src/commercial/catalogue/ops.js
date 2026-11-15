// Catalogue building operations on a store: add, move, rotate, set a param, delete, or put one type on the lot. One undo step each.

import * as S from '../../model/schema.js'; // eslint-disable-line no-unused-vars
import { lotOf } from '../../model/placement.js';
import { isCommercial, normaliseCommercial } from '../schema.js';
import { materialise } from '../materialise.js';
import { newBuilding, buildingsOf } from './buildings.js';
import { paramsOf } from './params.js';
import { typeById } from './types/index.js';
import { placeBuilding } from './fit.js';
import { refreshSiteWorks } from '../sitelayout.js';

const guard = (p) => { if (!isCommercial(p)) throw new Error('This design is not in commercial mode.'); };
const redo = (p) => { p.commercial = normaliseCommercial(p.commercial); materialise(p); };
const find = (p, id) => p.commercial.buildings.find((b) => b.id === id);

/** Add a building of a type. Placed where it fits when no place is given (else at the lot centre). Returns the new id. */
export function addBuilding(store, typeId, opts = {}) {
  return addBuildingFit(store, typeId, opts).id;
}

/**
 * Add a building and report whether it found free space: { id, fitted }. Placed in free space clear of the setbacks, the other buildings
 * and the aisles when no place is given; with no free space it stands at the lot centre (fitted false) so it can be dragged to a better spot.
 */
export function addBuildingFit(store, typeId, { params, place, presetId } = {}) {
  let id = null;
  let fitted = !!place;
  store.apply('Add building', (p) => {
    guard(p);
    const rec = newBuilding(typeId, { params, presetId, place });
    if (!place) {
      const fit = lotOf(p) ? (placeBuilding(p, rec, null, true) || placeBuilding(p, rec)) : null;
      if (fit) { rec.place = fit; fitted = true; }
      else if (lotOf(p)) { const l = lotOf(p).boundary; rec.place = { x: l.reduce((s, q) => s + q.x, 0) / l.length, y: l.reduce((s, q) => s + q.y, 0) / l.length, rotationDeg: 0 }; }
    }
    p.commercial.buildings = [...(p.commercial.buildings || []), rec];
    id = rec.id;
    redo(p);
  });
  return { id, fitted };
}

/** A copy of a building (same type and settings) placed in free space; beside the original when there is none. Returns { id, fitted } or null. */
export function duplicateBuilding(store, id) {
  const src = (store.project.commercial?.buildings || []).find((b) => b.id === id);
  if (!src) return null;
  const res = addBuildingFit(store, src.type, { params: structuredClone(src.params || {}) });
  if (!res.fitted) {
    // No free space: stand the copy beside the original (a building width along its own frontage) for the person to drag.
    const b = buildingsOf(store.project.commercial).find((x) => x.id === id);
    const w = b ? Math.max(...b.local.outline.map((q) => q.x)) - Math.min(...b.local.outline.map((q) => q.x)) : 10000;
    const a = ((src.place?.rotationDeg || 0) * Math.PI) / 180;
    moveBuilding(store, res.id, { x: src.place.x + Math.cos(a) * (w + 3000), y: src.place.y + Math.sin(a) * (w + 3000), rotationDeg: src.place.rotationDeg || 0 });
  }
  return res;
}

/** Re-run the automatic car park and site layout from scratch (one undo step). Clears hand edits to the generated paving. Hardstand areas the person drew (hs_ ids) are theirs and are kept. */
export function rerunSiteLayout(store) {
  store.apply('Re-run car park layout', (p) => {
    guard(p);
    delete p.commercial.siteWorks;
    p.commercial.pavements = (p.commercial.pavements || []).filter((o) => !String(o?.id || '').startsWith('sw:'));
    p.commercial.siteAuto = true;
    refreshSiteWorks(p, { force: true });
  });
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

/** Set settings on the strata units of every row (or one row), for example the wall construction. One undo step. */
export function setRowsUnit(store, patch, rowId = null) {
  store.apply('Change units', (p) => {
    guard(p);
    for (const r of p.commercial.rows || []) if (!rowId || r.id === rowId) Object.assign(r.unit, patch);
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
