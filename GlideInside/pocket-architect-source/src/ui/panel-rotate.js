// The Rotate panel (right panel while the tool is armed): what is selected, the angle typed in degrees, the two align buttons, the pivot.

import { h, clear } from './dom.js';
import { button as plainButton } from './panel-forms.js';
import { ROTATE_HINT, fmtDeg } from '../editor2d/rotate-controller.js';

const button = (text, onclick, o = {}) => { const b = plainButton(text, onclick, o); if (o.dataset) Object.assign(b.dataset, o.dataset); return b; };
const m2 = (mm) => `${(mm / 1000).toFixed(2)} m`;

export function rotatePanel(ctx) {
  const { store, editor } = ctx;
  const root = h('div', { class: 'ps-form ps-rotate-panel', dataset: { ps: 'rotate-panel' } });
  const ctl = () => editor?.rotate || null;
  let typedValue = '';

  function render() {
    clear(root);
    const c = ctl();
    const t = c?.target();
    root.append(h('div', { class: 'ps-sel-title' }, h('strong', null, 'Rotate')));
    if (!t) {
      const comm = store.project.mode === 'commercial';
      root.append(h('p', { class: 'ps-hint', dataset: { ps: 'rotate-none' } }, comm ? 'Click a building or a unit row on the plan to select it, then turn it.' : 'Place a house on the lot to turn it.'));
      return;
    }
    const pv = c.pivot();
    root.append(h('div', { class: 'ps-sec' },
      h('div', { class: 'ps-sec-title' }, 'Turning'),
      h('p', { class: 'ps-hint', style: { margin: 0 }, dataset: { ps: 'rotate-target' } }, t.label),
      h('p', { class: 'ps-hint', style: { margin: '2px 0 0' }, dataset: { ps: 'rotate-last' } }, c.lastTurn() ? `Last turn ${fmtDeg(c.lastTurn())}.` : 'Drag the gold handle on the plan.')));
    const input = h('input', { class: 'ps-input', type: 'text', inputmode: 'decimal', placeholder: 'degrees, e.g. 15', 'aria-label': 'Angle in degrees, clockwise', autocomplete: 'off', value: typedValue, dataset: { ps: 'rotate-angle' }, style: { width: '110px' } });
    const apply = () => { const r = c.typed(input.value); if (r.ok) { typedValue = ''; render(); } };
    input.addEventListener('input', () => { typedValue = input.value; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } e.stopPropagation(); });
    root.append(h('div', { class: 'ps-sec' },
      h('div', { class: 'ps-sec-title' }, 'Turn by an angle'),
      h('div', { class: 'ps-row', style: { gap: '6px', alignItems: 'center' } }, input, button('Turn', apply, { title: 'Turn by this angle. Positive is clockwise, negative anticlockwise. One undo step.', dataset: { ps: 'rotate-apply' } }))));
    root.append(h('div', { class: 'ps-sec' },
      h('div', { class: 'ps-sec-title' }, 'Align'),
      h('div', { class: 'ps-row', style: { gap: '6px', flexWrap: 'wrap' } },
        button('Street frontage', () => { c.align('frontage'); render(); }, { dataset: { ps: 'rotate-frontage' }, title: 'Turn the building to line up with the street frontage (a garage faces the street square on).' }),
        button('Nearest boundary', () => { c.align('nearest'); render(); }, { dataset: { ps: 'rotate-boundary' }, title: 'Turn the building to run parallel to the boundary closest to it.' }))));
    root.append(h('div', { class: 'ps-sec' },
      h('div', { class: 'ps-sec-title' }, 'Pivot'),
      h('p', { class: 'ps-hint', style: { margin: '0 0 6px' }, dataset: { ps: 'rotate-pivot' } }, `${c.hasCustomPivot() ? 'Moved' : 'Building centre'}: ${m2(pv.x)}, ${m2(pv.y)}.`),
      button('Pivot to centre', () => { c.resetPivot(); render(); }, { title: 'Put the pivot back at the centre of the building.' })));
    root.append(h('p', { class: 'ps-hint', dataset: { ps: 'rotate-hint' } }, ROTATE_HINT));
  }

  render();
  return { el: root, refresh: () => { if (!root.contains(document.activeElement)) render(); }, key: 'tool:rotate' };
}
