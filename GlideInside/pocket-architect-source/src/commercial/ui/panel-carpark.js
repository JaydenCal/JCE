// The Car park panel: the layout card to drag onto a hardstand, the bay type (90, 60 or 45 degrees), options (end islands, accessible bays, angle),
// and the selected car park (bay count, rotate, change material, remove). The behaviour is in hardstand-controller.js, shared with the Hardstand tool.

import { h, clear } from '../../ui/dom.js';
import { button } from '../../ui/panel-forms.js';
import { hsState, setHsState, setCpDefaults, onHsState, CP_MODES } from './hardstand-state.js';
import { BAY_TYPES, CARPARK_NOTE, cpConfig } from '../catalogue/pavements/carpark.js';
import { hardstandTypes, areaM2 } from '../catalogue/pavements/hardstand.js';
import { pavementById } from '../catalogue/pavements/pavements.js';
import { stats as commercialStats } from '../stats.js';

const QUICK_TYPES = ['asphalt-ac10-car', 'concrete-heavy', 'gravel-yard', 'permeable-pavers'];

export function carparkPanel(ctx) {
  const { store, editor } = ctx;
  const root = h('div', { class: 'ps-form ps-cp-panel', dataset: { ps: 'carpark-panel' } });
  const ctl = () => editor?.carpark || editor?.hardstand || null;
  const comm = () => store.project.mode === 'commercial' && !!store.project.commercial;

  /** Settings shown: the selected car park's own when one is selected, else the defaults for the next one. */
  const current = () => { const a = ctl()?.selectedArea?.(); return a?.carpark ? { ...hsState.cp, ...a.carpark } : hsState.cp; };
  const change = (patch) => {
    const a = ctl()?.selectedArea?.();
    if (a?.carpark) ctl().applyCarpark(a.id, patch);
    setCpDefaults(patch);
  };

  function seg(label, items, value, onPick, ps) {
    const wrap = h('div', { class: 'ps-seg ps-seg--sm', role: 'group', 'aria-label': label, style: { flexWrap: 'wrap' } });
    for (const it of items) wrap.append(h('button', { class: 'ps-seg-btn', type: 'button', title: it.title || it.label, 'aria-pressed': String(value === it.id), dataset: { ps: `${ps}-${it.id}` }, onclick: () => onPick(it.id) }, it.label));
    return wrap;
  }

  function render() {
    clear(root);
    if (!comm()) { root.append(h('p', { class: 'ps-hint' }, 'The car park tool is for commercial layouts.')); return; }
    const c = store.project.commercial;
    const cfg = current();
    const sel = ctl()?.selectedArea?.() || null;
    const sc = sel?.carpark ? ctl()?.selectedCarpark?.() : null;
    root.append(h('div', { class: 'ps-sel-title' }, h('strong', null, 'Car park')));

    const card = h('div', { class: 'ps-cp-card', draggable: 'true', title: 'Drag onto a hardstand, or onto open ground for a new car park', dataset: { ps: 'carpark-card' }, style: { border: '1.5px dashed #c7a256', borderRadius: '8px', padding: '10px', cursor: 'grab', background: 'rgba(199,162,86,0.08)' } },
      h('strong', null, `${BAY_TYPES[cfg.bayAngle].label}`),
      h('div', { class: 'ps-hint', style: { margin: '4px 0 0' } }, `Bays ${(cfg.bayW / 1000).toFixed(1)} x ${(cfg.bayL / 1000).toFixed(1)} m, aisle ${(BAY_TYPES[cfg.bayAngle].aisleMm / 1000).toFixed(1)} m. Drag this onto a hardstand.`));
    card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-ps-carpark', JSON.stringify(hsState.cp)); e.dataTransfer.setData('text/plain', 'car park'); e.dataTransfer.effectAllowed = 'copy'; });
    root.append(h('div', { class: 'ps-sec' }, card));

    root.append(h('div', { class: 'ps-sec' }, h('div', { class: 'ps-sec-title' }, 'Mode'),
      seg('Mode', CP_MODES.map((m) => ({ id: m.id, label: `${m.label} (${m.key})`, title: m.hint })), hsState.mode, (id) => { ctl()?.cancel?.(); setHsState({ mode: id }); }, 'carpark-mode'),
      h('p', { class: 'ps-hint', dataset: { ps: 'carpark-hint' } }, CP_MODES.find((m) => m.id === hsState.mode)?.hint || '')));

    root.append(h('div', { class: 'ps-sec' }, h('div', { class: 'ps-sec-title' }, 'Bays'),
      seg('Bay angle', Object.values(BAY_TYPES).map((b) => ({ id: String(b.angle), label: `${b.angle} degrees`, title: b.label })), String(cfg.bayAngle), (id) => change({ bayAngle: Number(id) }), 'carpark-angle'),
      h('label', { class: 'ps-hint', style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '8px 0 0' } },
        h('input', { type: 'checkbox', checked: !!cfg.islands, dataset: { ps: 'carpark-islands' }, onchange: (e) => change({ islands: e.target.checked }) }), 'End islands and landscaping'),
      h('label', { class: 'ps-hint', style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '6px 0 0' } }, 'Accessible bays',
        (() => { const inp = h('input', { class: 'ps-input', type: 'number', min: '0', step: '1', placeholder: 'auto', value: cfg.accessible == null ? '' : String(cfg.accessible), dataset: { ps: 'carpark-accessible' }, style: { width: '70px' } }); inp.addEventListener('change', () => change({ accessible: inp.value === '' ? null : Math.max(0, Math.round(Number(inp.value))) })); return inp; })()),
      h('label', { class: 'ps-hint', style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '6px 0 0' } }, 'Bay direction (degrees)',
        (() => { const inp = h('input', { class: 'ps-input', type: 'number', step: '1', placeholder: 'longest edge', value: cfg.angleDeg == null ? '' : String(Math.round(cfg.angleDeg)), dataset: { ps: 'carpark-dir' }, style: { width: '90px' } }); inp.addEventListener('change', () => change({ angleDeg: inp.value === '' ? null : Number(inp.value) })); return inp; })(),
        button('Follow hardstand', () => change({ angleDeg: null }), { title: 'Bays run along the longest edge of the hardstand again' }))));

    if (sel && !sel.road) {
      const lay = sc?.layout;
      const rows = [];
      if (lay) rows.push(h('p', { style: { margin: '0 0 6px' }, dataset: { ps: 'carpark-count' } }, h('strong', null, `${lay.count} bays`), `, ${lay.accessible} accessible (${lay.required} indicated), bays at ${Math.round(lay.angleDeg)} degrees, ${areaM2(sel.polygon).toFixed(0)} m2`));
      else rows.push(h('p', { class: 'ps-hint', style: { margin: '0 0 6px' } }, `${pavementById(sel.type)?.short || 'Hardstand'}, ${areaM2(sel.polygon).toFixed(0)} m2. Not filled with bays yet.`));
      const acts = [];
      if (!lay) acts.push(button('Fill with bays', () => ctl()?.applyCarpark?.(sel.id), { title: 'Fill this hardstand with bays and aisles aligned to its orientation' }));
      else {
        acts.push(button('Re-flow', () => ctl()?.applyCarpark?.(sel.id, { shifts: {}, removed: [] }), { title: 'Clear slid rows and deleted bays and lay the bays out again' }));
        if (hsState.activeBay) acts.push(button('Delete bay', () => ctl()?.deleteBay?.(), { cls: 'ps-btn--danger', title: 'Delete the picked bay (Delete)' }));
        acts.push(button('Restore bays', () => ctl()?.restoreBays?.(sel.id)));
        acts.push(button('Remove bays', () => ctl()?.clearCarpark?.(sel.id), { cls: 'ps-btn--danger', title: 'Keep the hardstand, take the bays off it' }));
      }
      acts.push(button('Turn 90', () => ctl()?.rotateSelected?.(90), { title: 'Rotate 90 degrees (. key). Shift and . turns 15 degrees. The gold ring on the plan turns it freely.' }));
      const chips = h('div', { class: 'ps-seg ps-seg--sm', role: 'group', 'aria-label': 'Surface', style: { flexWrap: 'wrap', marginTop: '6px' } });
      for (const t of hardstandTypes().filter((x) => QUICK_TYPES.includes(x.id) || x.id === sel.type)) chips.append(h('button', { class: 'ps-seg-btn', type: 'button', 'aria-pressed': String(sel.type === t.id), title: t.where, dataset: { ps: `carpark-type-${t.id}` }, onclick: () => ctl()?.retype?.(sel.id, t.id) }, t.short));
      root.append(h('div', { class: 'ps-sec', dataset: { ps: 'carpark-selected' } }, h('div', { class: 'ps-sec-title' }, 'Selected'), ...rows, h('div', { class: 'ps-row', style: { gap: '6px', flexWrap: 'wrap' } }, ...acts), chips));
    }

    const st = commercialStats(store.project);
    root.append(h('div', { class: 'ps-sec' }, h('div', { class: 'ps-sec-title' }, 'Parking in the checks'),
      h('p', { style: { margin: 0 }, dataset: { ps: 'carpark-parking' } }, `${st.parking.provided} bays provided, ${st.parking.required} indicated`, st.parking.carparkBays ? `, ${st.parking.carparkBays} from car parks` : ''),
      h('p', { class: 'ps-hint', style: { margin: '6px 0 0' } }, 'Snaps to the lot boundary, setbacks, buildings and other pavement. Hold Alt to turn snapping off. A clear entry gap is kept where a road or driveway meets the car park.'),
      h('p', { class: 'ps-hint', style: { margin: '6px 0 0' } }, CARPARK_NOTE)));
  }

  render();
  const off = onHsState(() => { if (!root.isConnected) { off(); return; } render(); });
  const offStore = store.on?.('project', () => { if (!root.isConnected) { offStore?.(); return; } render(); });
  return { el: root, refresh: render, key: 'tool:carpark' };
}
