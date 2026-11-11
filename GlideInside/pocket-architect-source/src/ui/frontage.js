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
  // After the first view, or on any canvas interaction, the panel folds into a small chip so it never covers the plan.
  const chipLabel = h('button', { class: 'ps-frontage-chip-label', type: 'button', onclick: () => { collapsed = false; sync(); } });
  const chipDone = h('button', { class: 'ps-frontage-chip-done', type: 'button', onclick: confirm }, 'Confirm');
  const chip = h('div', { class: 'ps-frontage-chip', role: 'region', 'aria-label': 'Street frontage', hidden: true }, chipLabel, chipDone);
  stage.append(bar, chip);
  let collapsed = false;
  let seenFor = null;
  let timer = null;
  const collapse = () => { if (!collapsed) { collapsed = true; sync(); } };
  const onStagePointer = (e) => { if (!bar.contains(e.target) && !chip.contains(e.target)) collapse(); };
  stage.addEventListener('pointerdown', onStagePointer, true);

  const COMPASS = ['north', 'north east', 'east', 'south east', 'south', 'south west', 'west', 'north west'];
  function frontLabel() {
    const lot = store.project.site?.lot;
    const front = lot?.frontEdges || [];
    if (!lot || !front.length) return 'Frontage: not set, change';
    const ring = lot.boundary;
    // Plan up is grid north (y runs down the screen). The outward normal of the front edge says which way the street faces.
    const cx = ring.reduce((t, p) => t + p.x, 0) / ring.length;
    const cy = ring.reduce((t, p) => t + p.y, 0) / ring.length;
    const a = ring[front[0]], b = ring[(front[0] + 1) % ring.length];
    let nx = b.y - a.y, ny = a.x - b.x;
    if (nx * ((a.x + b.x) / 2 - cx) + ny * ((a.y + b.y) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
    const bearing = ((Math.atan2(nx, -ny) * 180) / Math.PI + 360) % 360;
    const dir = COMPASS[Math.round(bearing / 45) % 8];
    return `Frontage: ${dir}${front.length > 1 ? ' and more' : ''}, change`;
  }

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
    const lotNow = store.project.site?.lot;
    const on = !!store.ui.frontageEdit && hasPlan(store.ui.view) && !!lotNow && !store.ui.placing;
    // A new lot gets its first view of the full panel; it folds into the chip a few seconds later or on the first canvas click.
    if (on && seenFor !== lotNow) { seenFor = lotNow; collapsed = false; clearTimeout(timer); timer = setTimeout(collapse, 7000); }
    if (!on) { clearTimeout(timer); seenFor = null; }
    bar.hidden = !on || collapsed;
    chip.hidden = !on || !collapsed;
    if (on) { text.textContent = describe(); chipLabel.textContent = frontLabel(); }
  }
  const offs = [store.on('project', sync), store.on('ui', sync)];
  sync();
  return { sync, dispose: () => { offs.forEach((o) => o()); clearTimeout(timer); stage.removeEventListener('pointerdown', onStagePointer, true); } };
}
