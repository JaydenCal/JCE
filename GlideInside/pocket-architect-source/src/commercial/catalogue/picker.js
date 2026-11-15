// The lot card's building type picker and its layout switcher, as pure helpers over the project: which type is on the lot, the switcher list
// for it (strata: the six ready-made layouts; every other type: Best fit and its presets), and putting one on the lot.

import { LAYOUT_LIST, BEST_ID, chooseLayout, applyLayout } from '../layouts.js';
import { typesForPicker, typeById, typeIconName, STRATA_ID } from './types/index.js';
import { presetsOf } from './buildings.js';
import { chooseBuilding, BEST_PRESET } from './fit.js';
import { applyBuildingChoice } from './ops.js';

/** The type on the lot (the layout's type, strata units when none is recorded). */
export const activeTypeId = (project) => project?.commercial?.layout?.typeId || STRATA_ID;

/** Entries for the Building type picker: { id, label, icon, category, active }. */
export function typeChoices(project) {
  const cur = activeTypeId(project);
  return typesForPicker().map((t) => ({ id: t.id, label: t.id === STRATA_ID ? 'Strata units' : t.label, icon: typeIconName(t), category: t.category, active: t.id === cur }));
}

/** The switcher list for a type: [{ id, label }], Best fit first. Strata keeps LAYOUT_LIST. */
export function switcherList(typeId) {
  if (!typeId || typeId === STRATA_ID) return LAYOUT_LIST;
  const def = typeById(typeId);
  if (!def) return LAYOUT_LIST;
  return [{ id: BEST_PRESET, label: 'Best fit' }, ...presetsOf(def).map((p) => ({ id: p.id, label: p.label }))];
}

/** Index of the layout in place within the switcher list of the project's type (-1 for none). */
export function switcherIndex(project) {
  const l = project?.commercial?.layout;
  const list = switcherList(activeTypeId(project));
  if (activeTypeId(project) === STRATA_ID) return list.findIndex((x) => x.id === l?.id);
  return list.findIndex((x) => x.id === l?.presetId);
}

/** { title, name, n, of } for the card: the title (the type, or the layout of strata units), the switcher name (preset, "edited" once params differ). */
export function pagerText(project) {
  const t = activeTypeId(project);
  const list = switcherList(t);
  const i = switcherIndex(project);
  const lay = project?.commercial?.layout;
  if (t === STRATA_ID) {
    const name = lay?.label || (i >= 0 ? list[i].label : 'Layout');
    return { title: name, name, n: i < 0 ? null : i + 1, of: list.length };
  }
  const def = typeById(t);
  const preset = presetsOf(def).find((p) => p.id === lay?.presetId);
  const b = project.commercial?.buildings?.[0];
  const edited = !!(preset && b && Object.entries(preset.params || {}).some(([k, v]) => b.params?.[k] !== undefined && b.params[k] !== v));
  const name = lay?.presetId === undefined ? def.label : `${preset?.label || def.label}${edited ? ' (edited)' : ''}`;
  return { title: def.label, name, n: i < 0 ? null : i + 1, of: list.length };
}

/** Choose a layout (strata) or a building (other types) by switcher id. */
export function chooseFor(project, typeId, id) {
  if (!typeId || typeId === STRATA_ID) return chooseLayout(project, id || BEST_ID);
  return chooseBuilding(project, typeId, id || BEST_PRESET);
}

export function applyChoice(store, typeId, choice) {
  if (!choice) return false;
  if (!typeId || typeId === STRATA_ID) return applyLayout(store, choice);
  return applyBuildingChoice(store, choice);
}
