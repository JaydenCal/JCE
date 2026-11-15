// Hardstand drawing in the enlarged top view: the options createTopView() takes as `hardstand`. The controller is the same one the 2D plan
// tool uses (hardstand-controller.js), so snapping, clipping, warnings and undo steps are identical; this file only builds the controls bar.

import { h, clear } from '../../ui/dom.js';
import { toast } from '../../ui/toast.js';
import { createHardstandController } from './hardstand-controller.js';
import { hsState, setHsState, onHsState, HS_MODES, modeDef } from './hardstand-state.js';
import { pavementById } from '../catalogue/pavements/pavements.js';
import { hardstandTypes, hardstandSummary, OVERLAP_RULE } from '../catalogue/pavements/hardstand.js';

const m2 = (v) => `${(Math.round(v * 10) / 10).toFixed(1)} m2`;

export function topviewHardstand() {
  return {
    colour: () => pavementById(hsState.type)?.colour || null,
    can: (p) => p?.mode === 'commercial' && !!p.commercial,
    create: ({ store, scale, redraw }) => createHardstandController({ store, scale, redraw, toast: (m, o) => toast(m, o) }),
    /** The controls row: draw mode, pavement type, the selected area's actions, and the hint. Re-builds itself when the tool state or design changes. */
    bar(ctl, { store, onChange = () => {} }) {
      const root = h('div', { class: 'tv-hs', role: 'group', 'aria-label': 'Hardstand', dataset: { ps: 'topview-hardstand-bar' } });
      const render = () => {
        clear(root);
        const sel = h('select', { class: 'tv-hs-type', 'aria-label': 'Pavement type', dataset: { ps: 'topview-hardstand-type' } });
        for (const t of hardstandTypes()) sel.append(h('option', { value: t.id }, t.short));
        sel.value = hsState.type;
        sel.addEventListener('change', () => {
          const picked = ctl.selectedArea();
          if (picked && hsState.mode === 'edit') ctl.retype(picked.id, sel.value);
          setHsState({ type: sel.value });
        });
        const modes = HS_MODES.map((m) => h('button', { class: 'tv-btn tv-mode', type: 'button', title: `${m.label} (${m.key}). ${m.hint}`, 'aria-pressed': String(hsState.mode === m.id), dataset: { ps: `topview-hardstand-${m.id}` }, onclick: () => { ctl.cancel(); setHsState({ mode: m.id }); } }, m.label));
        const picked = ctl.selectedArea();
        const sum = hardstandSummary(store.project.commercial, store.project.site?.lot || null);
        root.append(...modes, sel,
          h('button', { class: 'tv-btn tv-mode', type: 'button', disabled: !picked, title: 'Copy the selected area 2 m across and down (D)', dataset: { ps: 'topview-hardstand-duplicate' }, onclick: () => ctl.duplicate() }, 'Duplicate'),
          h('button', { class: 'tv-btn tv-mode', type: 'button', disabled: !picked, title: 'Delete the selected area (Delete)', dataset: { ps: 'topview-hardstand-delete' }, onclick: () => ctl.remove() }, 'Delete'),
          h('span', { class: 'tv-hs-note', title: OVERLAP_RULE, tabindex: '0' }, `${sum.drawn.length} drawn, ${m2(sum.drawnM2)}. Newer cuts older.`),
          h('span', { class: 'tv-hs-hint', dataset: { ps: 'topview-hardstand-hint' } }, modeDef(hsState.mode).hint));
        onChange();
      };
      render();
      const offState = onHsState(() => { if (!root.isConnected) return; render(); });
      const offProject = store.on('project', () => { if (root.isConnected) render(); });
      root.dispose = () => { offState(); offProject?.(); };
      return root;
    },
  };
}
