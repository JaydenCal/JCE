// The commercial guided flow: 1 Find your lot, 2 Choose what to build, 3 Place it, 4 Check it, then the full editor (step 5).
// Works on the real project, so the editor opens with exactly the buildings and site that were laid out. Wording: building, layout, site.

import { confirmBreach } from './breach.js';
import { h } from '../ui/dom.js';
import * as G from '../model/geometry.js';
import { lotOf } from '../model/placement.js';
import { icon } from '../ui/icons.js';
import { mountLotStep } from './lot-step.js';
import { mapBox, roadSvg, aerialOf } from './lot-map.js';
import { writeFlow, flowOf } from './state.js';
import { mount3dPreview } from './preview3d.js';
const openAddBuilding = (opts) => import('../commercial/ui/add-building.js').then((m) => m.openAddBuilding(opts)); // loaded when asked, so the step logic stays importable without a document
import { RE_RUN_LABEL } from '../commercial/sitelayout.js';
import { buildingHandle } from '../commercial/catalogue/draw2d.js';
import { pavementAreas } from '../commercial/catalogue/pavements/logic.js';
import { isCommercial } from '../commercial/schema.js';
import { STRATA_ID } from '../commercial/catalogue/types/index.js';
import {
  commercialTypes, chooseType, stepLayoutBy, layoutPager, WALL_SYSTEMS, wallSystemOf, setWallSystem, placeables, moveBy, turnBy, mirrorLayout, bestFitAgain,
  duplicateBuilding, deleteBuilding, rerunSiteLayout, placementStatus, checkSummary, zoneWarning, zoneLabel, activeTypeId, INDICATIVE,
} from './com-logic.js';
import { moveBuilding } from '../commercial/catalogue/ops.js';
import { parkingLayout, doorStrips } from '../commercial/parking.js';
import { siteAccess } from '../commercial/access.js';
import { commercialStats } from '../commercial/stats.js';
import { baysText, offsetAlongFront, editAccessIn } from './com-logic.js';

export const COMMERCIAL_BRAND = 'Glide Inside Commercial';
const STATUS_COLOUR = { inside: '#17724a', outside: '#c77700', unknown: '#1b4fd1', none: '#1b4fd1' };

// Step 1 ----------------------------------------------------------------------------------------------------------------------
function zoneExtra(project) {
  const w = zoneWarning(project);
  return w ? h('p', { class: 'gf-note gf-note--bad', role: 'alert', dataset: { ps: 'flow-zone-warning' } }, w.text) : h('p', { class: 'gf-note', dataset: { ps: 'flow-zone-ok' } }, `Zone use: ${zoneLabel(project)}.`);
}

// Step 2 ----------------------------------------------------------------------------------------------------------------------
function mountTypeStep(ctx) {
  const { store } = ctx;
  let disposed = false;
  let busy = false;
  const types = commercialTypes();
  const chosen = () => (isCommercial(store.project) && (store.project.commercial.rows?.length || store.project.commercial.buildings?.length) ? activeTypeId(store.project) : null);
  const grid = h('div', { class: 'gf-types', dataset: { ps: 'flow-types' } });
  const busyEl = h('p', { class: 'gf-note', role: 'status', dataset: { ps: 'flow-choosing' } }, '');
  const mix = h('div', { class: 'gf-card', dataset: { ps: 'flow-mix' } });
  const wall = h('div', { class: 'gf-seg', role: 'group', 'aria-label': 'Wall system', dataset: { ps: 'flow-wall' } });

  async function pick(t) {
    if (busy) return;
    busy = true; busyEl.textContent = 'Laying out the site'; paint();
    try { await new Promise((r) => setTimeout(r, 20)); chooseType(store, t.id); writeFlow(store, { designId: t.id }); }
    catch (e) { busyEl.textContent = e?.message || 'That could not be placed.'; }
    finally { busy = false; if (!disposed) { if (busyEl.textContent === 'Laying out the site') busyEl.textContent = ''; paint(); ctx.refresh(); } }
  }
  function paint() {
    const cur = chosen();
    grid.replaceChildren(...types.map((t) => h('button', { class: 'gf-typecard gf-type', type: 'button', 'aria-pressed': String(cur === t.id), disabled: busy, dataset: { ps: 'flow-type', type: t.id }, onclick: () => pick(t) },
      h('div', { class: 'gf-typecard-b' }, h('div', { class: 'gf-row' }, icon(t.icon, { size: 22 }), h('strong', null, t.label)), t.blurb ? h('div', { class: 'gf-typecard-s' }, t.blurb) : null))));
    wall.replaceChildren(...WALL_SYSTEMS.map((w) => h('button', { class: 'gf-btn', type: 'button', 'aria-pressed': String(isCommercial(store.project) && wallSystemOf(store.project) === w.id), disabled: !cur || busy, title: w.blurb, dataset: { ps: `flow-wall-${w.id}` }, onclick: () => { setWallSystem(store, w.id); paint(); } }, w.label)));
    const bs = (store.project.commercial?.buildings || []).slice(cur && cur !== STRATA_ID ? 1 : 0);
    mix.replaceChildren(
      h('div', { class: 'gf-row', style: { justifyContent: 'space-between' } }, h('strong', null, 'Add to the mix'), h('button', { class: 'gf-btn', type: 'button', disabled: !cur || busy, dataset: { ps: 'flow-add-building' }, onclick: () => openAddBuilding({ store, onAdded: () => { paint(); ctx.refresh(); } }) }, 'Add building')),
      h('p', { class: 'gf-note' }, cur ? 'Add an amenities block, office, workshop, canopy, car wash, shed or kiosk beside the main building.' : 'Choose the main building first.'),
      ...(bs.length ? [h('ul', { class: 'gf-lines', dataset: { ps: 'flow-mix-list' } }, ...bs.map((b) => h('li', null, `${(store.project.commercial.buildings || []).indexOf(b) + 1}. ${b.type.replace(/-/g, ' ')} `, h('button', { class: 'gf-btn gf-btn--sm', type: 'button', onclick: () => { deleteBuilding(store, b.id); paint(); } }, 'Remove'))))] : []));
  }
  paint();
  const el = h('div', null, grid, busyEl,
    h('div', { class: 'gf-grid', style: { marginTop: '14px' } },
      h('div', { class: 'gf-card' }, h('strong', null, 'Wall system'), h('p', { class: 'gf-note' }, 'Metal clad or tilt-up concrete. You can change this in the editor.'), wall),
      mix));
  return { el, canNext: () => !busy && !!chosen(), nextLabel: 'Place it', dispose() { disposed = true; } };
}

// Step 3 ----------------------------------------------------------------------------------------------------------------------
function mountPlaceStep(ctx) {
  const { store } = ctx;
  const NS = 'http://www.w3.org/2000/svg';
  let disposed = false;
  let nudgeMm = 500;
  let drag = null;
  let aerial = null;
  let busy = false;
  let box = null;
  let selected = null; // { kind, id }
  let notice = '';

  const stage = h('div', { class: 'gf-stage', tabindex: '0', role: 'application', 'aria-label': 'Site layout plan. Drag a building to move it. Arrow keys nudge it.', dataset: { ps: 'flow-stage' } });
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  stage.append(svg);
  const busyEl = h('div', { class: 'gf-empty', style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,.6)' }, dataset: { ps: 'flow-placing' }, role: 'status' }, 'Laying out the site');
  const statusEl = h('div', { class: 'gf-status', role: 'status', 'aria-live': 'polite', dataset: { ps: 'flow-place-status' } });
  const parkEl = h('p', { class: 'gf-note', style: { margin: '0' }, dataset: { ps: 'flow-park-status' } });
  const noticeEl = h('p', { class: 'gf-note', role: 'status', dataset: { ps: 'flow-notice' } });
  const nameEl = h('div', { class: 'gf-note', style: { margin: '0' }, dataset: { ps: 'flow-selected' } });
  const pagerEl = h('span', { class: 'gf-note', style: { margin: '0', textAlign: 'center', flex: '1' }, dataset: { ps: 'flow-layout-name' } });
  const mk = (label, fn, ps, cls = '', attrs = {}) => h('button', { class: `gf-btn ${cls}`, type: 'button', dataset: { ps }, onclick: fn, ...attrs }, label);
  const stepSel = h('select', { 'aria-label': 'Nudge step', dataset: { ps: 'flow-nudge-step' }, onchange: () => { nudgeMm = Number(stepSel.value); } }, h('option', { value: '500' }, '0.5 m'), h('option', { value: '100' }, '0.1 m'), h('option', { value: '1000' }, '1 m'));
  const arrow = (t, dx, dy, ps) => mk(t, () => nudge(dx, dy), ps, 'gf-btn--sm');
  const pad = h('div', { class: 'gf-pad', role: 'group', 'aria-label': 'Nudge the selected building' }, h('span'), arrow('↑', 0, -1, 'flow-nudge-up'), h('span'), arrow('←', -1, 0, 'flow-nudge-left'), h('span', { class: 'gf-mid' }, 'nudge'), arrow('→', 1, 0, 'flow-nudge-right'), h('span'), arrow('↓', 0, 1, 'flow-nudge-down'), h('span'));
  const dupBtn = mk('Duplicate', () => duplicate(), 'flow-duplicate', '', { title: 'A copy of the selected building, placed in free space' });
  const delBtn = mk('Remove', () => remove(), 'flow-remove', '', { title: 'Remove the selected building' });
  const side = h('div', { class: 'gf-side' },
    h('div', { class: 'gf-card' }, nameEl, h('div', { style: { height: '8px' } }), statusEl, parkEl),
    h('div', { class: 'gf-card' },
      h('div', { class: 'gf-row', style: { gap: '6px' } }, mk('Previous layout', () => layoutBy(-1), 'flow-layout-prev', 'gf-btn--sm'), pagerEl, mk('Next layout', () => layoutBy(1), 'flow-layout-next', 'gf-btn--sm')),
      h('div', { style: { height: '8px' } }),
      mk('Best fit', () => bestFit(), 'flow-bestfit', 'gf-btn--primary'),
      h('p', { class: 'gf-note' }, 'Best fit lays out the buildings square to the street, inside the setbacks, with the driveway and car park.'),
      h('div', { style: { height: '8px' } }),
      h('div', { class: 'gf-note', style: { fontWeight: '600' } }, 'Entry and exit'),
      h('div', { class: 'gf-row', style: { gap: '6px', flexWrap: 'wrap' } },
        h('label', { class: 'gf-note' }, 'Width ', h('select', { dataset: { ps: 'flow-access-width' }, onchange: (e) => editAccessIn(store, { widthMm: Number(e.target.value) }) }, ...[4000, 6000, 8000, 10000].map((w) => h('option', { value: String(w) }, `${(w / 1000).toFixed(1)} m`)))),
        mk('Reset entry and exit', () => editAccessIn(store, null, 'Reset entry and exit'), 'flow-access-reset', 'gf-btn--sm')),
      h('p', { class: 'gf-note' }, 'Drag a white dot to slide the entry or exit along the street frontage.')),
    h('div', { class: 'gf-card' },
      h('div', { class: 'gf-ctl' }, mk('Add building', () => addBuilding(), 'flow-add-building', 'gf-btn--primary'), dupBtn, delBtn),
      h('div', { style: { height: '10px' } }),
      h('div', { class: 'gf-ctl' }, mk('Turn left 90°', () => turn(-90), 'flow-rot-left'), mk('Turn right 90°', () => turn(90), 'flow-rot-right'), mk('Mirror layout', () => mirror(), 'flow-mirror')),
      h('div', { style: { height: '10px' } }),
      pad,
      h('label', { class: 'gf-note', style: { display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center' } }, 'Nudge step', stepSel),
      h('div', { style: { height: '8px' } }),
      mk(RE_RUN_LABEL, () => rerun(), 'flow-rerun-carpark'),
      noticeEl),
    h('p', { class: 'gf-note' }, INDICATIVE));
  const el = h('div', { class: 'gf-place' }, stage, side);

  const lotNow = () => lotOf(store.project);
  const mmPerPx = () => (box ? box.w / Math.max(1, Math.min(stage.clientWidth, stage.clientHeight * (box.w / box.h))) : 1);
  const toMm = (ev) => { const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; const m = svg.getScreenCTM(); return m ? p.matrixTransform(m.inverse()) : { x: 0, y: 0 }; };
  const set = (e, attrs) => { for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const poly = (pts, attrs) => set(document.createElementNS(NS, 'polygon'), { points: pts.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' '), ...attrs });
  const line = (a, b, attrs) => set(document.createElementNS(NS, 'line'), { x1: Math.round(a.x), y1: Math.round(a.y), x2: Math.round(b.x), y2: Math.round(b.y), ...attrs });
  const text = (p, t, px, attrs = {}) => { const e = set(document.createElementNS(NS, 'text'), { x: Math.round(p.x), y: Math.round(p.y), 'font-size': Math.round(px * mmPerPx()), 'text-anchor': 'middle', 'font-family': 'system-ui,sans-serif', 'font-weight': '600', ...attrs }); e.textContent = t; return e; };
  const group = (attrs = {}) => set(document.createElementNS(NS, 'g'), attrs);
  const centroid = (pts) => ({ x: pts.reduce((s, q) => s + q.x, 0) / pts.length, y: pts.reduce((s, q) => s + q.y, 0) / pts.length });

  function draw(project = store.project, dragOffset = null) {
    const lot = lotNow();
    if (!lot || disposed) return;
    if (!box) box = mapBox(lot, { margin: 0.12, roadM: 12 });
    svg.setAttribute('viewBox', `${Math.round(box.x)} ${Math.round(box.y)} ${Math.round(box.w)} ${Math.round(box.h)}`);
    const px = mmPerPx();
    const st = placementStatus(project);
    const col = STATUS_COLOUR[st.state] || STATUS_COLOUR.unknown;
    svg.replaceChildren();
    svg.append(set(document.createElementNS(NS, 'rect'), { x: box.x, y: box.y, width: box.w, height: box.h, fill: '#e3ead9' }));
    if (aerial?.href && aerial.extent) { const e = aerial.extent; svg.append(set(document.createElementNS(NS, 'image'), { href: aerial.href, x: e.x0, y: e.y0, width: e.x1 - e.x0, height: e.y1 - e.y0, preserveAspectRatio: 'none', opacity: '0.85' })); }
    const roads = document.createElementNS(NS, 'g'); roads.innerHTML = roadSvg(lot, px); svg.append(roads);
    svg.append(poly(lot.boundary, { fill: 'rgba(255,255,255,.22)', stroke: '#d11f1f', 'stroke-width': Math.round(3 * px) }));
    const env = Array.isArray(lot.envelope) && lot.envelope.length >= 3 ? lot.envelope : null;
    if (env) svg.append(poly(env, { fill: st.state === 'outside' ? 'rgba(199,119,0,.10)' : 'rgba(23,114,74,.10)', stroke: col, 'stroke-width': Math.round(3 * px), 'stroke-dasharray': `${Math.round(10 * px)} ${Math.round(6 * px)}`, 'data-ps': 'flow-envelope' }));
    const c = project.commercial;
    const sw = c?.siteWorks;
    if (sw) {
      for (const l of sw.landscape || []) svg.append(poly(l.polygon, { fill: 'rgba(96,160,96,.45)', stroke: 'none', 'data-ps': 'flow-landscape' }));
      for (const bp of sw.balance?.polygons || []) {
        svg.append(poly(bp, { fill: 'rgba(120,130,110,.22)', stroke: '#8a917f', 'stroke-width': Math.round(1.5 * px), 'stroke-dasharray': `${Math.round(8 * px)} ${Math.round(6 * px)}`, 'data-ps': 'flow-balance' }));
        svg.append(text(centroid(bp), 'Balance of lot', 12, { fill: '#4a5142', 'data-ps': 'flow-balance-label' }));
      }
      const fills = { aisle: '#8f9298', apron: '#a9a69b', bays: '#b7babf', footpath: '#d8cfba' };
      for (const a of pavementAreas(c).filter((x) => String(x.id).startsWith('sw:'))) svg.append(poly(a.polygon, { fill: fills[a.role] || '#999', stroke: 'none', 'data-ps': `flow-paved-${a.role}` }));
      for (const r of sw.bayRows || []) for (const s of r.slots) svg.append(poly(s.poly, { fill: s.kind === 'accessible' ? 'rgba(27,95,191,.55)' : s.kind === 'zone' ? 'rgba(27,95,191,.2)' : 'rgba(255,255,255,.35)', stroke: '#ffffff', 'stroke-width': Math.round(1.2 * px), 'data-ps': 'flow-bay' }));
      for (const x of sw.crossovers || []) {
        const m = centroid(x.polygon);
        svg.append(poly(x.polygon, { fill: '#6b6f76', stroke: 'none' }));
        svg.append(text({ x: m.x, y: m.y - 5 * px }, x.role === 'in' ? 'ENTRY' : x.role === 'out' ? 'EXIT' : 'ENTRY / EXIT', 10, { fill: '#1d2024', 'data-ps': 'flow-crossover' }));
        // A draggable end: slides along the street frontage.
        const knob = document.createElementNS(NS, 'circle');
        const kp = drag?.mode === 'access' && drag.role === (x.role === 'both' ? 'in' : x.role) && drag.at ? drag.at : { x: x.x, y: x.y };
        for (const [k, v] of Object.entries({ cx: Math.round(kp.x), cy: Math.round(kp.y), r: Math.round(9 * px), fill: '#fff', stroke: '#1b4fd1', 'stroke-width': Math.round(2 * px), 'data-ps': 'flow-access-handle', 'data-role': x.role === 'both' ? 'in' : x.role, style: 'cursor:grab' })) knob.setAttribute(k, v);
        svg.append(knob);
      }
      for (const a of sw.aisles || []) svg.append(line(a.centre[0], a.centre[1], { stroke: 'rgba(255,255,255,.8)', 'stroke-width': Math.round(1.4 * px), 'stroke-dasharray': `${Math.round(8 * px)} ${Math.round(6 * px)}` }));
    }
    if (c?.rows?.length && !(sw?.bayRows || []).length) {
      // Strata rows carry their own bays and truck aprons (parking.js), the same result step 4 and the editor count.
      const acc = siteAccess(c, lot);
      for (const q of [acc?.driveway, acc?.crossover]) if (q) svg.append(poly(q, { fill: '#6b6f76', opacity: '0.55', stroke: 'none', 'data-ps': 'flow-crossover' }));
      const park = parkingLayout(c);
      for (const d of doorStrips(c, park)) svg.append(poly(d.poly, { fill: '#a9a69b', stroke: 'none', 'data-ps': 'flow-paved-apron' }));
      for (const r of park.rows) for (const sl of r.slots) svg.append(poly(sl.poly, { fill: sl.kind === 'accessible' ? 'rgba(27,95,191,.55)' : sl.kind === 'zone' ? 'rgba(27,95,191,.2)' : 'rgba(255,255,255,.35)', stroke: '#ffffff', 'stroke-width': Math.round(1.2 * px), 'data-ps': 'flow-bay' }));
    }
    for (const it of placeables(project)) {
      const isSel = selected && selected.kind === it.kind && selected.id === it.id;
      const g = group({ class: 'gf-bld', 'data-ps': 'flow-building', 'data-kind': it.kind, 'data-id': it.id });
      if (isSel && dragOffset) g.setAttribute('transform', `translate(${Math.round(dragOffset.dx)} ${Math.round(dragOffset.dy)})`);
      for (const e of it.extras || []) g.append(poly(e.polygon, { fill: 'rgba(120,130,140,.22)', stroke: '#5c6570', 'stroke-width': Math.round(1.2 * px), 'stroke-dasharray': `${Math.round(6 * px)} ${Math.round(4 * px)}` }));
      for (const o of [it.outline, ...(it.more || [])]) g.append(poly(o, { fill: isSel ? '#e9d9a8' : '#d8d5cc', stroke: isSel ? '#b8860b' : '#2c2f36', 'stroke-width': Math.round((isSel ? 3 : 1.6) * px) }));
      const cc = centroid(it.outline);
      g.append(text({ x: cc.x, y: cc.y }, it.label, 11, { fill: '#2c2f36', 'pointer-events': 'none' }));
      svg.append(g);
    }
    // turn handle for the selected catalogue building
    const sb = selected?.kind === 'building' ? (c?.buildings || []).find((b) => b.id === selected.id) : null;
    if (sb && !dragOffset) {
      const bl = placeables(project).find((x) => x.id === sb.id);
      if (bl) {
        const bld = buildingHandleOf(project, sb.id);
        if (bld) {
          const hg = group({ class: 'gf-handle', 'data-ps': 'flow-handle' });
          hg.append(line(bld.centre, bld.handle, { stroke: '#1b4fd1', 'stroke-width': Math.round(1.5 * px), 'stroke-dasharray': `${Math.round(5 * px)} ${Math.round(4 * px)}` }));
          hg.append(set(document.createElementNS(NS, 'circle'), { cx: Math.round(bld.handle.x), cy: Math.round(bld.handle.y), r: Math.round(11 * px), fill: '#ffc83d', stroke: '#1b4fd1', 'stroke-width': Math.round(2 * px) }));
          svg.append(hg);
        }
      }
    }
    svg.append(text({ x: box.x + box.w / 2, y: box.y + box.h - 9 * px }, 'Drag a building to move it. Select one to turn it.', 11, { fill: '#3b3f46', opacity: '0.8' }));
    paintPanel(st);
  }

  const buildingHandleOf = (project, id) => { const b = placeablesBuilding(project, id); return b ? buildingHandle(b) : null; };

  function paintPanel(st = placementStatus(store.project)) {
    statusEl.dataset.state = st.state;
    statusEl.replaceChildren(h('span', { 'aria-hidden': 'true' }, st.state === 'inside' ? '✓' : st.state === 'outside' ? '!' : 'i'), h('span', null, st.state === 'inside' ? 'Inside the setbacks. Good position.' : st.text));
    const c = store.project.commercial;
    parkEl.textContent = baysText(commercialStats(store.project).parking);
    const sel = selectedItem();
    nameEl.textContent = sel ? `Selected: ${sel.label}` : 'Select a building to turn or duplicate it.';
    dupBtn.disabled = !sel || sel.kind !== 'building';
    delBtn.disabled = !sel || sel.kind !== 'building' || (c?.buildings || [])[0]?.id === sel.id && activeTypeId(store.project) !== STRATA_ID;
    const pg = layoutPager(store.project);
    pagerEl.textContent = `${pg.name}${pg.n ? `  ${pg.n} of ${pg.of}` : ''}`;
    noticeEl.textContent = [notice, ...(c?.siteWorks?.warnings || [])].filter(Boolean).join(' ');
  }
  const selectedItem = () => (selected ? placeables(store.project).find((x) => x.kind === selected.kind && x.id === selected.id) || null : null);
  const ensureSelected = () => { if (!selectedItem()) { const first = placeables(store.project)[0]; selected = first ? { kind: first.kind, id: first.id } : null; } return selectedItem(); };

  // Actions ----------------------------------------------------------------------------------------------------------------
  const run = async (fn) => { if (busy) return; busy = true; stage.append(busyEl); try { await new Promise((r) => setTimeout(r, 15)); fn(); } finally { busy = false; busyEl.remove(); draw(); ctx.refresh(); } };
  function nudge(sx, sy) { const s = ensureSelected(); if (s) moveBy(store, s, sx * nudgeMm, sy * nudgeMm); }
  function turn(deg) { const s = ensureSelected(); if (s) turnBy(store, s, deg); }
  function mirror() { mirrorLayout(store); notice = 'The layout is mirrored left to right.'; }
  function layoutBy(dir) { run(() => { stepLayoutBy(store, dir); selected = null; notice = ''; }); }
  function bestFit() { run(() => { bestFitAgain(store); selected = null; notice = ''; }); }
  function rerun() { run(() => { rerunSiteLayout(store); notice = 'The car park layout was laid out again.'; }); }
  function addBuilding() {
    openAddBuilding({ store, onAdded: (res) => { selected = { kind: 'building', id: res.id }; notice = res.fitted ? 'Building added in free space. Drag it to move it.' : 'There was no free space, so it stands in the middle of the lot. Drag it where you want it.'; draw(); ctx.refresh(); } });
  }
  function duplicate() { const s = selectedItem(); if (!s || s.kind !== 'building') return; const r = duplicateBuilding(store, s.id); if (r) { selected = { kind: 'building', id: r.id }; notice = r.fitted ? 'Copied into free space.' : 'There was no free space, so the copy stands beside the original.'; } draw(); }
  function remove() { const s = selectedItem(); if (!s || s.kind !== 'building') return; deleteBuilding(store, s.id); selected = null; notice = 'Building removed.'; }

  // Pointer: drag a building, or the handle to turn the selected one
  const onDown = (ev) => {
    if (ev.button != null && ev.button !== 0) return;
    const ah = ev.target.closest?.('[data-ps="flow-access-handle"]');
    if (ah) {
      ev.preventDefault();
      stage.setPointerCapture?.(ev.pointerId);
      drag = { mode: 'access', role: ah.getAttribute('data-role'), off: null, at: null };
      return;
    }
    const onHandle = ev.target.closest?.('[data-ps="flow-handle"]');
    const g = ev.target.closest?.('[data-ps="flow-building"]');
    if (!onHandle && !g) return;
    ev.preventDefault();
    stage.setPointerCapture?.(ev.pointerId);
    const p = toMm(ev);
    if (g) { selected = { kind: g.getAttribute('data-kind'), id: g.getAttribute('data-id') }; }
    const sel = selectedItem();
    if (!sel) return;
    if (onHandle && sel.kind === 'building') { const hd = buildingHandleOf(store.project, sel.id); drag = { mode: 'turn', centre: hd.centre, a0: Math.atan2(p.y - hd.centre.y, p.x - hd.centre.x), deg: 0 }; }
    else drag = { mode: 'move', start: p, dx: 0, dy: 0, sel };
    stage.focus({ preventScroll: true });
    draw();
  };
  const onMove = (ev) => {
    if (!drag) return;
    const p = toMm(ev);
    if (drag.mode === 'access') {
      const lot0 = lotOf(store.project);
      const b0 = lot0.boundary; const e0 = (lot0.frontEdges || [])[0] ?? 0;
      const a0 = b0[e0]; const c0 = b0[(e0 + 1) % b0.length];
      const L0 = Math.hypot(c0.x - a0.x, c0.y - a0.y) || 1;
      drag.off = offsetAlongFront(lot0, p);
      const t = Math.max(0, Math.min(L0, drag.off));
      drag.at = { x: a0.x + ((c0.x - a0.x) * t) / L0, y: a0.y + ((c0.y - a0.y) * t) / L0 };
      draw();
      return;
    }
    if (drag.mode === 'move') { drag.dx = Math.round((p.x - drag.start.x) / 50) * 50; drag.dy = Math.round((p.y - drag.start.y) / 50) * 50; draw(store.project, { dx: drag.dx, dy: drag.dy }); }
    else {
      let d = ((Math.atan2(p.y - drag.centre.y, p.x - drag.centre.x) - drag.a0) * 180) / Math.PI;
      d = ((d + 540) % 360) - 180;
      drag.deg = ev.shiftKey ? Math.round(d / 15) * 15 : Math.round(d / 5) * 5;
    }
  };
  const onUp = () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.mode === 'access') { if (d.off != null) { notice = ''; editAccessIn(store, { role: d.role, offsetMm: d.off }); } else draw(); return; }
    if (d.mode === 'move' && (d.dx || d.dy)) { notice = ''; moveBy(store, d.sel, d.dx, d.dy); }
    else if (d.mode === 'turn' && d.deg) { const s = selectedItem(); if (s) turnBy(store, s, d.deg); }
    else draw();
  };
  svg.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 1000 : nudgeMm;
    const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (k) { e.preventDefault(); const s = ensureSelected(); if (s) moveBy(store, s, k[0] * step, k[1] * step); }
    else if (e.key === 'm' || e.key === 'M') mirror();
    else if (e.key === 'q' || e.key === 'Q') turn(-90);
    else if (e.key === 'e' || e.key === 'E') turn(90);
  });
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (!drag) draw(); }) : null;
  ro?.observe(stage);
  const off = store.on('project', () => { if (!disposed && !drag) draw(); });

  return {
    el,
    nextLabel: 'Check it',
    canNext: () => !busy && !!lotNow() && isCommercial(store.project) && placeables(store.project).length > 0,
    beforeNext: () => confirmBreach(placementStatus(store.project), { what: 'building' }),
    async onEnter() {
      const lot = lotNow();
      if (!lot) return;
      aerialOf(lot).then((a) => { if (a && !disposed) { aerial = a; draw(); } });
      const want = flowOf(store.project)?.designId;
      // Nothing on the lot yet (a refresh, or a flow that skipped step 2): lay out the chosen type, else the one already there.
      if (!placeables(store.project).length && want) { busy = true; stage.append(busyEl); try { await new Promise((r) => setTimeout(r, 15)); chooseType(store, want); } finally { busy = false; busyEl.remove(); } }
      ensureSelected();
      draw();
      ctx.refresh();
    },
    dispose() { disposed = true; off?.(); ro?.disconnect(); },
  };
}

import { buildingsOf } from '../commercial/catalogue/buildings.js';
const placeablesBuilding = (project, id) => buildingsOf(project.commercial).find((b) => b.id === id) || null;

// Step 4 ----------------------------------------------------------------------------------------------------------------------
function mountCheckStep(ctx, { catalogue }) {
  const { store } = ctx;
  const card = h('div', { class: 'gf-card', dataset: { ps: 'flow-summary' } });
  const view = h('div', { class: 'gf-3d', dataset: { ps: 'flow-3d' } });
  const el = h('div', { class: 'gf-check' }, card, view);
  let preview = null;
  let disposed = false;
  const stat = (b, s) => h('div', { class: 'gf-stat' }, h('b', null, b), h('span', null, s));

  function paint() {
    const s = checkSummary(store.project);
    if (!s.ok) { card.replaceChildren(h('p', null, s.lines[0])); return; }
    const chip = s.verdict === 'met' ? h('span', { class: 'gf-chip gf-chip--ok' }, 'Setbacks met') : s.verdict === 'not-met' ? h('span', { class: 'gf-chip gf-chip--warn' }, 'Setbacks not met') : h('span', { class: 'gf-chip' }, 'Setbacks to check');
    card.replaceChildren(
      h('div', { class: 'gf-row', style: { justifyContent: 'space-between' } }, h('strong', { style: { fontSize: '18px' } }, s.typeLabel), chip),
      s.summary ? h('p', { class: `gf-note gf-note--${s.summary.tone === 'ok' ? 'ok' : 'plain'}`, style: { fontWeight: '600' }, dataset: { ps: 'flow-summary-line' } }, s.summary.text) : null,
      h('table', { class: 'gf-table', dataset: { ps: 'flow-setback-table' } },
        h('thead', null, h('tr', null, h('th', null, 'Boundary'), h('th', null, 'Distance'), h('th', null, 'Needed'), h('th', null, ''))),
        h('tbody', null, ...s.rows.map((r) => h('tr', { dataset: { met: String(r.met) } }, h('td', null, r.label), h('td', null, `${r.clearanceM.toFixed(2)} m`), h('td', null, r.requiredM != null ? `${r.requiredM.toFixed(1)} m` : 'Not set'), h('td', null, r.met === true ? 'Met' : r.met === false ? 'Not met' : 'Check'))))),
      h('div', { class: 'gf-stats' },
        stat(`${Math.round(s.coverageM2)} m2`, `Site coverage${s.coverageText ? `, ${s.coverageText}` : ''}`),
        stat(`${s.parking.provided} of ${s.parking.required}`, 'Car bays against the indicative rate'),
        stat(s.accessibleText, 'Accessible bays'),
        stat(s.truck.has ? (s.truck.ok ? 'Linked' : 'Check') : 'Not applicable', 'Truck access to loading')),
      s.yield ? h('div', { class: 'gf-stats', dataset: { ps: 'flow-yield' } },
        stat(s.yield.profitSell || 'n/a', 'Indicative profit, sell the units'),
        stat(s.yield.profitHold || 'n/a', 'Indicative profit, hold and lease'),
        stat(s.yield.value || 'n/a', 'Indicative end value'),
        stat(s.yield.grossRent || 'n/a', 'Indicative gross rent a year'),
        stat(s.yield.yieldPct || 'n/a', 'Indicative gross yield on cost')) : null,
      h('p', { class: 'gf-note', dataset: { ps: 'flow-estimates' } }, s.caveat),
      h('ul', { class: 'gf-lines', dataset: { ps: 'flow-lines' } }, ...s.lines.map((t) => h('li', null, t))),
      h('p', { class: 'gf-note' }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); ctx.go(3); } }, 'Back to placement'), ' to move, add or turn a building.'));
  }
  paint();
  const off = store.on('project', () => { if (!disposed) paint(); });
  return {
    el,
    nextLabel: 'Open the editor',
    async onEnter() { preview = await mount3dPreview(view, store, catalogue); if (disposed) preview?.dispose?.(); },
    dispose() { disposed = true; off?.(); preview?.dispose?.(); },
  };
}

// The flow -------------------------------------------------------------------------------------------------------------------
export function commercialSteps({ catalogue } = {}) {
  return [
    { id: 'lot', title: 'Find your lot', intro: 'Search the address of the site. Check the boundary, street frontage, zone and setbacks.', mount: (ctx) => mountLotStep(ctx, { extra: zoneExtra, sampleOptions: { commercial: true } }) },
    { id: 'build', title: 'Choose what to build', intro: 'Pick the main building, then add more buildings to the mix if you like. Choose the wall system too.', mount: (ctx) => mountTypeStep(ctx) },
    { id: 'place', title: 'Place it', intro: 'The buildings are laid out square to the street with the driveway, aisles and car park. Move, turn, add or mirror them.', mount: (ctx) => mountPlaceStep(ctx) },
    { id: 'check', title: 'Check it', intro: 'A quick check of setbacks, site coverage, parking, truck access and an indicative value, and a 3D look at the site.', mount: (ctx) => mountCheckStep(ctx, { catalogue }) },
  ];
}
void G; void moveBuilding;
