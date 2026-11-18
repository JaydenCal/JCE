// The Driveway PIs panel (right panel while the tool is armed): what the tool does, the selected PI, the bend radius, delete and Reset to auto.

import { h, clear } from './dom.js';
import { button } from './panel-forms.js';
import { setTool } from './toolstate.js';
import { driveEditState, driveEditBlock } from '../site/drivepi.js';
import { DRIVEPI_HINT } from '../editor2d/drivepi-controller.js';

const RADII = [3, 6, 10];
const m1 = (v) => `${(Math.round(v * 10) / 10).toFixed(1)} m`;

export function drivePIPanel(ctx) {
  const { store, editor } = ctx;
  const root = h('div', { class: 'ps-form ps-drivepi-panel', dataset: { ps: 'drivepi-panel' } });
  const ctl = () => editor?.drivepi || null;

  function render() {
    clear(root);
    const st = driveEditState(store.project);
    root.append(h('div', { class: 'ps-sel-title' }, h('strong', null, 'Driveway PIs')));
    if (!st.ok) {
      root.append(h('p', { class: 'ps-hint', dataset: { ps: 'drivepi-block' } }, driveEditBlock(st)));
      return;
    }
    root.append(h('div', { class: 'ps-sec' },
      h('div', { class: 'ps-sec-title' }, st.edited ? 'Edited driveway' : 'Automatic driveway'),
      h('p', { class: 'ps-hint', style: { margin: 0 } }, `${m1(st.d.lengthMm / 1000)} long, ${m1(st.d.widthMm / 1000)} wide, ${st.pis.length} PI${st.pis.length === 1 ? '' : 's'}.`)));
    root.append(h('div', { class: 'ps-sec' },
      h('div', { class: 'ps-row', style: { gap: '6px', flexWrap: 'wrap' } },
        button('Delete PI', () => { ctl()?.deleteSelected(); render(); }, { title: 'Delete the selected PI (Delete or Backspace). A right click on a PI does the same.', dataset: { ps: 'drivepi-delete' } }),
        button('Reset to auto', () => { ctl()?.reset(); render(); }, { title: 'Drop your changes and bring the automatic driveway route back. The garage door and kerb ends stay attached either way.', dataset: { ps: 'drivepi-reset' } }))));
    const radius = h('div', { class: 'ps-chips', role: 'group', 'aria-label': 'Bend radius', dataset: { ps: 'drivepi-radius' } });
    for (const r of RADII) radius.append(h('button', { class: 'ps-chip', type: 'button', 'aria-pressed': String(Math.abs((st.radiusM || 6) - r) < 0.01 && st.edited), dataset: { value: r }, onclick: () => { ctl()?.setRadius(r); render(); } }, `${r} m`));
    root.append(h('div', { class: 'ps-sec' }, h('div', { class: 'ps-sec-title' }, 'Bend radius at every PI'), radius));
    root.append(h('p', { class: 'ps-hint', dataset: { ps: 'drivepi-hint' } }, DRIVEPI_HINT));
  }

  render();
  return { el: root, refresh: render, key: 'tool:drivepi' };
}

/** A small card for the Site panel: opens the tool, or resets to auto. */
export function driveSiteCard(ctx) {
  const { store } = ctx;
  return h('div', { class: 'ps-sec', dataset: { ps: 'drivepi-site-card' } },
    h('div', { class: 'ps-sec-title' }, 'Driveway'),
    h('div', { class: 'ps-row', style: { gap: '6px', flexWrap: 'wrap' } },
      button('Edit driveway PIs', () => setTool(store, 'drivepi'), { title: 'Add, move or delete the bend points (PIs) of the driveway. The garage door and kerb ends stay attached.' }),
      button('Reset to auto', () => { if (store.project.site?.driveway) store.apply('Reset driveway to auto', (p) => { delete p.site.driveway; }); }, { title: 'Drop your changes and bring the automatic driveway route back.' })));
}
