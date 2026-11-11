// "Confirm your street frontage": a bar over the plan while the person clicks boundary edges to mark which ones face the street.
// The editor handles the clicks (store.ui.frontageEdit); this bar explains the step and finishes it.

import { hasPlan } from './view-mode.js';
import { h } from './dom.js';
import { toast } from './toast.js';

export function createFrontageBar(stage, store) {
  const text = h('div', { class: 'ps-frontage-text' });
  const done = h('button', { class: 'ps-btn ps-btn--primary ps-btn--sm', type: 'button', dataset: { action: 'confirm-frontage' }, onclick: confirm }, 'Confirm frontage');
  const bar = h('div', { class: 'ps-frontage', role: 'region', 'aria-label': 'Confirm your street frontage', hidden: true },
    h('div', { style: { flex: 1, minWidth: 0 } }, h('h3', null, 'Confirm your street frontage'), text), done);
  stage.append(bar);

  function describe() {
    const lot = store.project.site?.lot;
    if (!lot) return '';
    const front = lot.frontEdges || [];
    const n = front.length;
    const which = n ? `Front edge${n > 1 ? 's' : ''}: ${front.map((i) => i + 1).join(', ')}.` : 'No front edge chosen.';
    return `${which}${lot.cornerLot ? ' This looks like a corner lot.' : ''} Click an edge of your lot to mark it as street frontage or to clear it. Corner lots have two street edges. A battle-axe lot has its frontage at the end of the handle.`;
  }

  function confirm() {
    const lot = store.project.site?.lot;
    if (lot && !(lot.frontEdges || []).length) {
      toast('Pick at least one edge as the street frontage.', { kind: 'warn' });
      return;
    }
    store.apply('Confirm frontage', (p) => {
      if (p.site.lot) p.site.lot.frontageConfirmed = true;
    });
    store.setUI({ frontageEdit: false });
  }

  function sync() {
    const on = !!store.ui.frontageEdit && hasPlan(store.ui.view) && !!store.project.site?.lot;
    bar.hidden = !on;
    if (on) text.textContent = describe();
  }
  const offs = [store.on('project', sync), store.on('ui', sync)];
  sync();
  return { sync, dispose: () => offs.forEach((o) => o()) };
}
