// The Add building picker: a dialog of building types (amenities block, office, warehouse, workshop, canopy, car wash, shed, kiosk and
// the rest of the catalogue). Picking one adds it in free space clear of the setbacks, the other buildings and the aisles, selects it and
// leaves it ready to drag. Shared by the placement step, the toolbox and the Site panel.

import { h } from '../../ui/dom.js';
import { openModal } from '../../ui/modal.js';
import { icon } from '../../ui/icons.js';
import { typesForPicker, typeIconName, CATEGORIES, STRATA_ID } from '../catalogue/types/index.js';
import { addBuildingFit } from '../catalogue/ops.js';

export const ADD_BUILDING_LABEL = 'Add building';
export const NOT_FITTED = 'There was no free space clear of the setbacks, the buildings and the aisles, so the new building stands in the middle of the lot. Drag it where you want it.';

/** The types offered: the whole catalogue except the strata unit rows (those are the layout itself). */
export const addableTypes = () => typesForPicker().filter((t) => t.id !== STRATA_ID);

/** Add one building of a type, select it and report: { id, fitted }. */
export function addAndSelect(store, typeId) {
  const res = addBuildingFit(store, typeId);
  store.setUI({ commercialBuilding: res.id, commercialRow: null });
  return res;
}

export function openAddBuilding({ store, onAdded } = {}) {
  const types = addableTypes();
  const groups = CATEGORIES.map((c) => ({ ...c, items: types.filter((t) => t.category === c.id) })).filter((g) => g.items.length);
  const note = h('p', { class: 'ab-note', role: 'status', dataset: { ps: 'add-building-note' } });
  let closeFn = null;
  const pick = (t) => {
    let res;
    try { res = addAndSelect(store, t.id); } catch (e) { note.textContent = e.message || 'Could not add that building.'; return; }
    if (!res.fitted) { note.textContent = NOT_FITTED; }
    onAdded?.(res, t);
    if (res.fitted) closeFn?.('picked');
  };
  const body = (close) => {
    closeFn = close;
    return h('div', { class: 'ab-body', dataset: { ps: 'add-building-dialog' } },
      h('style', null, `.ab-body{display:flex;flex-direction:column;gap:14px;max-height:70vh;overflow:auto}.ab-body h4{margin:0 0 6px;font:600 12px var(--ps-font-ui,system-ui);letter-spacing:.04em;text-transform:uppercase;color:var(--ps-muted,#666)}.ab-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.ab-card{display:flex;align-items:center;gap:8px;text-align:left;padding:10px;border:1px solid var(--ps-line,#d4d4d0);border-radius:10px;background:var(--ps-surface,#fff);color:inherit;font:500 13px var(--ps-font-ui,system-ui);cursor:pointer;min-height:44px}.ab-card:hover{border-color:var(--ps-accent,#1b5fbf)}.ab-note{margin:0;font-size:12px;color:var(--ps-muted,#555)}`),
      h('p', { class: 'ab-note' }, 'Pick a building. It is placed in free space and you can drag it from there.'),
      ...groups.map((g) => h('section', null, h('h4', null, g.label),
        h('div', { class: 'ab-grid' }, ...g.items.map((t) => h('button', { type: 'button', class: 'ab-card', dataset: { ps: 'add-building-pick', type: t.id }, onclick: () => pick(t) }, icon(typeIconName(t), { size: 22 }), h('span', null, t.label)))))),
      note);
  };
  return openModal({ title: ADD_BUILDING_LABEL, body, size: 'md' });
}
