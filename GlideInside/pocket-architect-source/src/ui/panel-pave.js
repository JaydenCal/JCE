// The Driveway and road panel, shown in the right panel while the tool is armed (residential and commercial): what to draw (driveway or
// road), the material, the width and bend radius, the selected way (split, join, turning heads, delete) and the pavement drawn so far by material.

import { h, clear } from './dom.js';
import { button } from './panel-forms.js';
import { paveState, setPaveState, onPaveState, PAVE_MODES, currentWidth } from '../editor2d/pave-state.js';
import { KINDS, MATERIALS, MATERIAL_IDS, HEADS, defaultMaterial, pavedSummary, getWay, wayGeometry, clampWidth } from '../site/pavedways.js';
import { garageDoor } from '../site/lotplan.js';

const m2 = (v) => `${(Math.round(v * 10) / 10).toLocaleString('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m2`;
const m1 = (v) => `${(Math.round(v * 10) / 10).toFixed(1)} m`;
const RADII = [[0, 'Sharp'], [4000, '4 m'], [6000, '6 m'], [10000, '10 m']];

export function pavePanel(ctx) {
  const { store, editor } = ctx;
  const root = h('div', { class: 'ps-form ps-pave-panel', dataset: { ps: 'pave-panel' } });
  const ctl = () => editor?.pave || null;
  const lotOn = () => !!store.project.site?.lot?.boundary?.length;
  const sel = () => (paveState.selected ? getWay(store.project, paveState.selected) : null);

  function kindSeg() {
    const wrap = h('div', { class: 'ps-seg ps-seg--sm', role: 'group', 'aria-label': 'What to draw', dataset: { ps: 'pave-kind' } });
    for (const k of Object.values(KINDS)) {
      wrap.append(h('button', { class: 'ps-seg-btn', type: 'button', 'aria-pressed': String((sel()?.kind || paveState.kind) === k.id), dataset: { ps: `pave-kind-${k.id}`, value: k.id }, onclick: () => ctl()?.setKind(k.id) }, k.label));
    }
    return wrap;
  }

  function materials() {
    const cur = sel()?.material || paveState.material || defaultMaterial(store.project, sel()?.kind || paveState.kind);
    const wrap = h('div', { class: 'ps-radio-row', role: 'group', 'aria-label': 'Material', dataset: { ps: 'pave-materials' } });
    for (const id of MATERIAL_IDS) {
      const mt = MATERIALS[id];
      wrap.append(h('button', { class: 'ps-radio', type: 'button', 'aria-pressed': String(cur === id), dataset: { ps: `pave-mat-${id}`, value: id }, onclick: () => ctl()?.setMaterial(id) },
        h('span', { style: { width: '16px', height: '16px', borderRadius: '3px', background: mt.swatch, border: '1px solid rgba(0,0,0,0.35)', flex: 'none' }, 'aria-hidden': 'true' }),
        h('span', { style: { flex: 1 } }, mt.label)));
    }
    return wrap;
  }

  function widthControl() {
    const k = sel()?.kind || paveState.kind;
    const def = KINDS[k];
    const now = sel()?.widthMm ?? paveState.widthMm[k] ?? def.defMm;
    const out = h('span', { class: 'ps-mono', style: { fontWeight: '700' }, dataset: { ps: 'pave-width-out' } }, m1(now / 1000));
    const input = h('input', { type: 'range', min: String(def.minMm), max: String(def.maxMm), step: '250', value: String(now), 'aria-label': 'Width', dataset: { ps: 'pave-width' }, style: { width: '100%' } });
    input.addEventListener('input', () => { out.textContent = m1(Number(input.value) / 1000); });
    input.addEventListener('change', () => ctl()?.setWidth(Number(input.value)));
    return h('div', null, h('div', { class: 'ps-row', style: { justifyContent: 'space-between', margin: '0 0 4px' } }, h('span', { class: 'ps-hint', style: { margin: 0 } }, `${m1(def.minMm / 1000)} to ${m1(def.maxMm / 1000)}`), out), input);
  }

  function radiusControl() {
    const now = sel()?.radiusMm ?? paveState.radiusMm;
    const wrap = h('div', { class: 'ps-chips', role: 'group', 'aria-label': 'Bend radius', dataset: { ps: 'pave-radius' } });
    for (const [v, label] of RADII) wrap.append(h('button', { class: 'ps-chip', type: 'button', 'aria-pressed': String(now === v), dataset: { value: v }, onclick: () => ctl()?.setRadius(v) }, label));
    return wrap;
  }

  function modes() {
    const wrap = h('div', { class: 'ps-seg ps-seg--sm', role: 'group', 'aria-label': 'Mode', dataset: { ps: 'pave-modes' } });
    for (const m of PAVE_MODES) wrap.append(h('button', { class: 'ps-seg-btn', type: 'button', title: `${m.label} (${m.key === 'D' ? 'A' : 'E'}). ${m.hint}`, 'aria-pressed': String(paveState.mode === m.id), dataset: { ps: `pave-mode-${m.id}`, value: m.id }, onclick: () => { ctl()?.cancel?.(); setPaveState({ mode: m.id, selected: m.id === 'draw' ? null : paveState.selected }); } }, m.id === 'draw' ? 'Draw new (A)' : 'Select and edit (E)'));
    return wrap;
  }

  function selected() {
    const w = sel();
    if (!w) return null;
    const g = wayGeometry(store.project, w);
    const kerb = w.kerbEdge != null;
    const rows = [];
    rows.push(h('p', { style: { margin: '0 0 6px' }, dataset: { ps: 'pave-selected-line' } }, `${MATERIALS[w.material].label} ${KINDS[w.kind].label.toLowerCase()}, ${m1(w.widthMm / 1000)} wide, ${m1(g.lengthMm / 1000)} long, ${m2(g.areaM2)}${g.crossoverM2 > 0 ? ` (crossover ${m2(g.crossoverM2)})` : ''}.`));
    rows.push(h('div', { class: 'ps-row', style: { gap: '6px', flexWrap: 'wrap' } },
      button('Split at corner', () => ctl()?.splitAtActive(), { title: 'Click a corner on the line, then split the way in two there' }),
      button('Join touching', () => ctl()?.joinTouching(), { title: 'Join this to another driveway or road that meets its end' }),
      button('Delete', () => ctl()?.remove(w.id), { cls: 'ps-btn--danger', title: 'Delete this driveway or road (Delete)' })));
    const heads = h('div', { class: 'ps-sec-body', dataset: { ps: 'pave-heads' }, style: { marginTop: '8px' } });
    heads.append(h('div', { class: 'ps-sec-title' }, 'Turning head'));
    const far = w.heads.find((x) => x.end === 'end');
    const row = h('div', { class: 'ps-row', style: { gap: '6px', flexWrap: 'wrap' } });
    for (const t of Object.values(HEADS)) row.append(h('button', { class: 'ps-btn', type: 'button', 'aria-pressed': String(far?.type === t.id), dataset: { ps: `pave-head-${t.id}` }, onclick: () => ctl()?.addHead('end', t.id), title: `${t.label} at the far end, for vehicles to turn round` }, t.label));
    if (far) row.append(h('button', { class: 'ps-btn', type: 'button', dataset: { ps: 'pave-head-none' }, onclick: () => ctl()?.removeHead('end') }, 'Remove'));
    heads.append(row);
    rows.push(heads);
    if (!kerb && w.kind === 'driveway') rows.push(h('p', { class: 'ps-hint', style: { margin: '8px 0 0' } }, 'This does not start at the kerb, so it has no crossover. Drag its first point into the verge to add one.'));
    return h('div', { class: 'ps-sec', dataset: { ps: 'pave-selected' } }, h('div', { class: 'ps-sec-title' }, 'Selected'), ...rows);
  }

  function schedule() {
    const sum = pavedSummary(store.project);
    const wrap = h('div', { class: 'ps-sec', dataset: { ps: 'pave-schedule' } }, h('div', { class: 'ps-sec-title' }, `Drawn pavement (${sum.ways.length})`));
    if (!sum.ways.length) { wrap.append(h('p', { class: 'ps-hint', style: { margin: 0 } }, 'Nothing drawn yet. Click along the route to draw a driveway or road.')); return wrap; }
    const list = h('div', { class: 'ps-radio-row', dataset: { ps: 'pave-list' } });
    for (const w of sum.ways) list.append(h('button', { class: 'ps-radio', type: 'button', 'aria-pressed': String(w.id === paveState.selected), dataset: { id: w.id }, onclick: () => setPaveState({ selected: w.id, mode: 'edit' }) }, h('span', { style: { flex: 1 } }, w.label), h('span', { class: 'ps-mono', style: { fontSize: '12px', color: 'var(--ps-muted)' } }, m2(w.areaM2))));
    wrap.append(list);
    const t = h('table', { class: 'ps-table', dataset: { ps: 'pave-by-material' }, style: { width: '100%', fontSize: '12px', borderCollapse: 'collapse', marginTop: '6px' } });
    for (const e of sum.byMaterial) t.append(h('tr', null, h('td', null, e.label), h('td', { style: { textAlign: 'right' } }, m2(e.areaM2))));
    t.append(h('tr', { style: { fontWeight: '700' } }, h('td', null, 'Total drawn'), h('td', { style: { textAlign: 'right' } }, m2(sum.totalM2))));
    wrap.append(t);
    return wrap;
  }

  function render() {
    clear(root);
    const w = sel();
    root.append(h('div', { class: 'ps-sel-title' }, h('strong', null, 'Driveway and road')));
    root.append(h('div', { class: 'ps-sec' }, h('div', { class: 'ps-sec-title' }, 'Mode'), modes()));
    root.append(h('div', { class: 'ps-sec' }, h('div', { class: 'ps-sec-title' }, w ? 'This one is a' : 'Draw a'), kindSeg()));
    root.append(h('div', { class: 'ps-sec' }, h('div', { class: 'ps-sec-title' }, 'Material'), materials(), h('p', { class: 'ps-hint', style: { margin: '6px 0 0' } }, 'Each material has its own plan hatch and 3D surface.')));
    root.append(h('div', { class: 'ps-sec' }, h('div', { class: 'ps-sec-title' }, 'Width'), widthControl()));
    root.append(h('div', { class: 'ps-sec' }, h('div', { class: 'ps-sec-title' }, 'Bend radius'), radiusControl(), h('p', { class: 'ps-hint', style: { margin: '6px 0 0' } }, 'Rounds every bend with an arc. Sharp keeps straight corners.')));
    if (!lotOn()) root.append(h('p', { class: 'ps-hint' }, 'Load a lot first so the driveway can start at the street and stay inside the boundary.'));
    if (paveState.mode === 'draw') {
      const door = garageDoor(store.project);
      root.append(h('div', { class: 'ps-row', style: { gap: '6px', flexWrap: 'wrap', margin: '0 0 8px' } },
        door && store.project.mode !== 'commercial' ? button('Start at garage door', () => ctl()?.startAtDoor(), { title: 'Place the first point at the garage door, then click along the route to the street' }) : null));
    }
    root.append(h('p', { class: 'ps-hint', dataset: { ps: 'pave-hint' } }, ctl()?.hint?.() || PAVE_MODES[0].hint));
    root.append(h('p', { class: 'ps-hint' }, 'Snaps to the kerb, the garage door, the ends of other pavement, the lot boundary and building edges. Nothing is drawn outside the lot except the crossover. Hold Alt to turn snapping off.'));
    const s = selected();
    if (s) root.append(s);
    root.append(schedule());
  }

  render();
  const off = onPaveState(() => { if (!root.isConnected) { off(); return; } render(); });
  return { el: root, refresh: render, key: 'tool:pave' };
}
void currentWidth; void clampWidth;
