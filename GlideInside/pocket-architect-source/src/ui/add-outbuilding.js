// Residential Add building: pick a garage, shed, carport, machinery shed or granny flat. It is merged into the plan beside the house,
// clear of the other buildings, as one undo step, ready to drag with Move house.

import { h } from './dom.js';
import { openModal } from './modal.js';
import { icon } from './icons.js';
import { OUTBUILDINGS, addOutbuilding } from '../catalogue/tpl/outbuildings.js';

export function openAddOutbuilding({ store, onAdded } = {}) {
  const body = (close) => h('div', { dataset: { ps: 'add-outbuilding-dialog' }, style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: '8px' } },
    ...OUTBUILDINGS.map((o) => h('button', { type: 'button', class: 'ps-btn', style: { display: 'flex', gap: '8px', alignItems: 'center', textAlign: 'left', minHeight: '48px' }, dataset: { ps: 'add-outbuilding-pick', type: o.id },
      onclick: () => { try { addOutbuilding(store, o.id); onAdded?.(o); close?.('picked'); } catch (e) { console.warn(e); } } },
    icon(o.icon, { size: 22 }), h('span', null, o.label, h('br'), h('small', null, o.footprint)))));
  return openModal({ title: 'Add building', body, size: 'md' });
}
