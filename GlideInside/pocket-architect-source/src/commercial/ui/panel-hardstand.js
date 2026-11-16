// The Hardstand picker, shown in the right panel while the tool is armed: pavement type, draw mode (Rectangle, Polygon, Fill area, Select and
// edit), the selected area (type, duplicate, delete), the areas drawn so far, and the quantities and cost they add to the layout.

import { h, clear } from '../../ui/dom.js';
import { button } from '../../ui/panel-forms.js';
import { hsState, setHsState, setRoadKind, onHsState, HS_MODES, modeDef } from './hardstand-state.js';
import { ROAD_KINDS, roadKind, roadById, siteItemById, centreLengthM } from '../catalogue/pavements/roads.js';
import { restoreSiteWorksIn } from '../../flow/com-logic.js';
import { hardstandTypes, hardstandSummary, markingPrompts, OVERLAP_RULE } from '../catalogue/pavements/hardstand.js';
import { makeUpShort, pavementById, RATES_CAVEAT } from '../catalogue/pavements/index.js';
import { commercialEdit } from '../mode.js';
import { addPromptMarking } from '../catalogue/pavements/hardstand.js';

const money = (v) => `$${Math.round(v).toLocaleString('en-AU')}`;
const m2 = (v) => `${(Math.round(v * 10) / 10).toLocaleString('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m2`;

export function hardstandPanel(ctx) {
  const { store, editor } = ctx;
  const root = h('div', { class: 'ps-form ps-hs-panel', dataset: { ps: 'hardstand-panel' } });
  const ctl = () => editor?.hardstand || null;
  const comm = () => store.project.mode === 'commercial' && !!store.project.commercial;

  function typeSelect() {
    const sel = h('select', { class: 'ps-select ps-input', 'aria-label': 'Pavement type', dataset: { ps: 'hardstand-type' } });
    for (const t of hardstandTypes()) sel.append(h('option', { value: t.id }, `${t.short} (${t.use.join(', ')})`));
    sel.value = hsState.type;
    sel.addEventListener('change', () => {
      const type = sel.value;
      const picked = ctl()?.selectedArea?.();
      if (picked && hsState.mode === 'edit') ctl().retype(picked.id, type);
      setHsState({ type });
    });
    return sel;
  }

  function modes() {
    const wrap = h('div', { class: 'ps-seg ps-seg--sm ps-hs-modes', role: 'group', 'aria-label': 'Draw mode', style: { flexWrap: 'wrap' } });
    for (const m of HS_MODES) {
      wrap.append(h('button', { class: 'ps-seg-btn', type: 'button', title: `${m.label} (${m.key}). ${m.hint}`, 'aria-pressed': String(hsState.mode === m.id), dataset: { ps: `hardstand-mode-${m.id}`, value: m.id }, onclick: () => { ctl()?.cancel?.(); setHsState({ mode: m.id }); } }, `${m.label} (${m.key})`));
    }
    return wrap;
  }

  function roadKinds() {
    const wrap = h('div', { class: 'ps-seg ps-seg--sm', role: 'group', 'aria-label': 'Road kind', style: { flexWrap: 'wrap' } });
    for (const k of ROAD_KINDS) wrap.append(h('button', { class: 'ps-seg-btn', type: 'button', title: k.hint, 'aria-pressed': String(hsState.roadKind === k.id), dataset: { ps: `hardstand-kind-${k.id}`, value: k.id }, onclick: () => { setRoadKind(k.id); setHsState({ mode: 'road' }); } }, k.label));
    wrap.append(h('button', { class: 'ps-seg-btn', type: 'button', title: 'A car park or hardstand is an area: drag a rectangle or click a polygon', dataset: { ps: 'hardstand-kind-area' }, onclick: () => setHsState({ mode: 'rect', type: 'asphalt-ac10-car' }) }, 'Car park or hardstand'));
    return wrap;
  }
  function widthInput(value, onCommit, min, max, ps) {
    const inp = h('input', { class: 'ps-input', type: 'number', step: '0.1', min: String(min / 1000), max: String(max / 1000), value: String(value / 1000), 'aria-label': 'Width in metres', dataset: { ps }, style: { width: '80px' } });
    inp.addEventListener('change', () => { const v = Math.round(Number(inp.value) * 1000); if (Number.isFinite(v) && v > 0) onCommit(v); });
    return h('label', { class: 'ps-hint', style: { display: 'inline-flex', gap: '6px', alignItems: 'center', margin: 0 } }, 'Width (m)', inp);
  }

  function render() {
    clear(root);
    if (!comm()) { root.append(h('p', { class: 'ps-hint' }, 'Hardstand is drawn in commercial layouts.')); return; }
    const c = store.project.commercial;
    const lot = store.project.site?.lot || null;
    const sum = hardstandSummary(c, lot);
    root.append(h('div', { class: 'ps-sel-title' }, h('strong', null, 'Hardstand')));
    const kd = roadKind(hsState.roadKind);
    root.append(h('div', { class: 'ps-sec', dataset: { ps: 'hardstand-roads' } }, h('div', { class: 'ps-sec-title' }, 'Road, driveway, pavement'), roadKinds(),
      h('div', { class: 'ps-row', style: { gap: '8px', marginTop: '6px' } }, widthInput(hsState.roadWidth || kd.widthMm, (v) => setHsState({ roadWidth: v }), kd.minMm, kd.maxMm, 'hardstand-road-width'),
        button('Draw', () => { ctl()?.cancel?.(); setHsState({ mode: 'road' }); }, { title: 'Click points on the plan. Double click or Enter finishes.' })),
      h('p', { class: 'ps-hint', style: { margin: '6px 0 0' } }, `${kd.hint}. The surface below is used for what you draw next.`)));
    root.append(h('div', { class: 'ps-sec' }, h('div', { class: 'ps-sec-title' }, 'Draw mode'), modes()));
    const t = pavementById(hsState.type);
    root.append(h('div', { class: 'ps-sec' }, h('div', { class: 'ps-sec-title' }, 'Pavement type'), typeSelect(),
      t ? h('p', { class: 'ps-hint', style: { margin: '6px 0 0' } }, `${t.where}. Make-up ${makeUpShort(t.id)}, indicative.`) : null));
    root.append(h('p', { class: 'ps-hint', dataset: { ps: 'hardstand-hint' } }, modeDef(hsState.mode).hint));
    root.append(h('p', { class: 'ps-hint' }, 'Snaps to the lot boundary, setbacks, building edges, existing pavement and a 0.5 m grid. Hold Alt to turn snapping off. Areas are cut off at the lot boundary; one that crosses a building is flagged but not blocked. Areas you draw are kept when the car park layout is re-run.'));

    // Selected generated item (a road, aisle, footpath, apron or entry the site layout made)
    const gen = hsState.selected && String(hsState.selected).startsWith('sw:') ? siteItemById(c, hsState.selected) : null;
    if (gen) {
      root.append(h('div', { class: 'ps-sec', dataset: { ps: 'hardstand-generated' } }, h('div', { class: 'ps-sec-title' }, 'Selected, from the site layout'),
        h('p', { style: { margin: '0 0 6px' } }, gen.label),
        h('div', { class: 'ps-row', style: { gap: '6px', flexWrap: 'wrap' } },
          button('Remove', () => ctl()?.removeGenerated?.(gen.id), { cls: 'ps-btn--danger', title: 'Take it off the plan (Delete). Restore all brings it back.' }),
          button('Make editable', () => ctl()?.makeEditable?.(gen.id), { title: 'Turn it into a road you can reshape and resize' }))));
    }
    // Selected road
    const road = hsState.selected ? roadById(c, hsState.selected) : null;
    if (road) {
      root.append(h('div', { class: 'ps-sec', dataset: { ps: 'hardstand-road-selected' } }, h('div', { class: 'ps-sec-title' }, 'Selected road'),
        h('p', { style: { margin: '0 0 6px' } }, `${roadKind(road.kind).label}, ${centreLengthM(road.centre).toFixed(1)} m long, ${road.centre.length} points`),
        h('div', { class: 'ps-seg ps-seg--sm', role: 'group', 'aria-label': 'Change kind', style: { flexWrap: 'wrap', marginBottom: '6px' } }, ...ROAD_KINDS.map((k) => h('button', { class: 'ps-seg-btn', type: 'button', 'aria-pressed': String(road.kind === k.id), dataset: { ps: `hardstand-road-kind-${k.id}` }, onclick: () => ctl()?.setRoadKind?.(road.id, k.id) }, k.label))),
        widthInput(road.widthMm, (v) => ctl()?.setRoadWidth?.(road.id, v), roadKind(road.kind).minMm, roadKind(road.kind).maxMm, 'hardstand-selected-width')));
    }
    // Selected area
    const picked = ctl()?.selectedArea?.() || sum.drawn.find((d) => d.id === hsState.selected) || null;
    if (picked) {
      const info = sum.drawn.find((d) => d.id === picked.id);
      const prompts = markingPrompts(c, [picked.id]);
      root.append(h('div', { class: 'ps-sec', dataset: { ps: 'hardstand-selected' } }, h('div', { class: 'ps-sec-title' }, 'Selected area'),
        h('p', { style: { margin: '0 0 6px' } }, `${info ? info.label : pavementById(picked.type)?.short}, ${info ? m2(info.areaM2) : ''}`),
        h('div', { class: 'ps-row', style: { gap: '6px', flexWrap: 'wrap' } },
          button('Duplicate', () => ctl()?.duplicate?.(picked.id), { title: 'Copy this area 2 m across and down (D)' }),
          button('Delete area', () => ctl()?.remove?.(picked.id), { cls: 'ps-btn--danger', title: 'Delete the whole area (Delete)' }),
          button('Edit corners', () => setHsState({ mode: 'edit' }), { title: 'Drag a corner, drag a midpoint dot to add one, double click a corner to remove it' })),
        prompts[0] ? h('p', { class: 'ps-hint', style: { margin: '8px 0 0' }, dataset: { ps: 'hardstand-marking-prompt' } }, prompts[0].text, ' ', button('Add marking', () => commercialEdit(store, 'Add line marking', (cc) => addPromptMarking(cc, prompts[0])), { title: 'Adds one arrow or keep clear box to the plan' })) : null));
    }

    const removed = (c.siteRemoved?.ids?.length || 0) + (c.siteRemoved?.kinds?.length || 0);
    if (removed) root.append(h('p', { class: 'ps-hint', dataset: { ps: 'hardstand-restore' } }, `${removed} generated item${removed === 1 ? '' : 's'} removed. `, button('Restore all', () => restoreSiteWorksIn(store), { title: 'Bring back every generated road, aisle, footpath and apron' })));
    // Drawn areas
    const list = h('div', { class: 'ps-radio-row', dataset: { ps: 'hardstand-list' } });
    if (!sum.drawn.length) list.append(h('p', { class: 'ps-hint', style: { margin: 0 } }, 'Nothing drawn yet. Pick a mode and drag across the plan.'));
    for (const d of sum.drawn) {
      list.append(h('button', { class: 'ps-radio', type: 'button', 'aria-pressed': String(d.id === hsState.selected), dataset: { id: d.id }, onclick: () => setHsState({ selected: d.id, mode: 'edit' }) }, h('span', { style: { flex: 1 } }, d.label), h('span', { class: 'ps-mono', style: { fontSize: '12px', color: 'var(--ps-muted)' } }, m2(d.areaM2))));
    }
    root.append(h('div', { class: 'ps-sec' }, h('div', { class: 'ps-sec-title' }, `Drawn areas (${sum.drawn.length})`), list,
      h('p', { class: 'ps-hint', title: OVERLAP_RULE, tabindex: '0', dataset: { ps: 'hardstand-overlap' }, style: { margin: 0, cursor: 'help', textDecoration: 'underline dotted' } }, 'Overlapping areas: the newer one cuts the older one. Hover for how it works.')));

    // Quantities and cost
    const q = h('table', { class: 'ps-table', dataset: { ps: 'hardstand-quantities' }, style: { width: '100%', fontSize: '12px', borderCollapse: 'collapse' } });
    for (const e of sum.byType) q.append(h('tr', null, h('td', null, e.label), h('td', { style: { textAlign: 'right' } }, m2(e.areaM2))));
    q.append(h('tr', { style: { fontWeight: '700' } }, h('td', null, 'Total hardstand'), h('td', { style: { textAlign: 'right' } }, m2(sum.totalM2))));
    root.append(h('div', { class: 'ps-sec' }, h('div', { class: 'ps-sec-title' }, 'Quantities, all pavement'), q,
      h('p', { class: 'ps-hint', style: { margin: '6px 0 0' }, dataset: { ps: 'hardstand-cost' } }, `Pavement ${money(sum.pavementCost)}, site works ${money(sum.siteWorks)} with drainage, detention and building pad allowances. ${RATES_CAVEAT}`)));
  }

  render();
  const off = onHsState(() => { if (!root.isConnected) { off(); return; } render(); });
  return { el: root, refresh: render, key: 'tool:hardstand' };
}
