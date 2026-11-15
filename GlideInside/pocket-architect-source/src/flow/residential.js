// The residential guided flow: 1 Find your lot, 2 Choose a home, 3 Place it, 4 Check it, then the full editor (step 5).
// The steps work on the real project, so the editor opens with exactly the home that was placed.

import { h } from '../ui/dom.js';
import * as G from '../model/geometry.js';
import { lotOf, translateHouse, rotateHouse, houseCentre } from '../model/placement.js';
import { buildingHull, clearances, deriveDriveway, garageDoor } from '../site/lotplan.js';
import { projectToSvg, svgDataUri } from '../portal/thumbnail.js';
import { mountLotStep, zoneText } from './lot-step.js';
import { lotMapSvg, mapBox, roadSvg, aerialOf } from './lot-map.js';
import { writeFlow, flowOf } from './state.js';
import { loadHomes, filterRows, placeBest, nudgeHouse, turnHouse, mirrorHouse, previewCopy, placementStatus, checkSummary, INDICATIVE } from './res-logic.js';
import { mount3dPreview } from './preview3d.js';

export const RESIDENTIAL_BRAND = 'Glide Inside Residential';

// Step 2 ----------------------------------------------------------------------------------------------------------------------
function mountHomeStep(ctx, { getHomes }) {
  const { store } = ctx;
  let rows = [];
  let selected = flowOf(store.project)?.designId || store.project.placedHouse?.id || null;
  const filter = { bedrooms: null, storeys: null };
  let disposed = false;
  const grid = h('div', { class: 'gf-homes', dataset: { ps: 'flow-homes' } }, h('p', { class: 'gf-empty' }, 'Loading homes'));
  const note = h('p', { class: 'gf-note', dataset: { ps: 'flow-homes-note' } });
  const sel = (label, key, opts) => {
    const s = h('select', { 'aria-label': label, dataset: { ps: `flow-filter-${key}` }, onchange: () => { const v = s.value; filter[key] = v === '' ? null : Number(v); paint(); } }, ...opts.map(([v, t]) => h('option', { value: v }, t)));
    return h('label', null, label, s);
  };
  const filters = h('div', { class: 'gf-filters' },
    sel('Bedrooms', 'bedrooms', [['', 'Any'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4 or more']]),
    sel('Storeys', 'storeys', [['', 'Any'], ['1', 'Single storey'], ['2', 'Two storeys']]));
  const el = h('div', null, filters, grid, note);

  function card(r) {
    const thumb = (() => { try { return svgDataUri(projectToSvg(r.design.project)); } catch { return ''; } })();
    const s = r.stats;
    const chipCls = r.fitStatus === 'too-big' ? 'gf-chip gf-chip--warn' : r.fits ? 'gf-chip gf-chip--ok' : 'gf-chip';
    return h('button', { class: 'gf-home', type: 'button', 'aria-pressed': String(selected === r.id), dataset: { ps: 'flow-home', id: r.id, fit: r.fitStatus }, onclick: () => { selected = r.id; writeFlow(store, { designId: r.id }); paint(); ctx.refresh(); }, ondblclick: () => { selected = r.id; ctx.next(); } },
      thumb ? h('img', { src: thumb, alt: `Plan of ${r.name}`, loading: 'lazy' }) : null,
      h('div', { class: 'gf-home-b' },
        h('strong', null, r.name),
        h('div', { class: 'gf-home-s' }, `${r.size}, ${s.floorAreaM2} m2 living`),
        h('div', { class: 'gf-home-s' }, `${s.bedrooms} bed, ${s.bathrooms} bath${s.garage ? `, ${s.garage} car` : ''}, ${s.storeys === 1 ? 'single storey' : `${s.storeys} storeys`}`),
        h('div', null, h('span', { class: chipCls }, r.fitText), r.fitReason && r.fitStatus !== 'fits' ? h('span', { class: 'gf-home-s', style: { marginLeft: '8px' } }, r.fitReason) : null)));
  }

  function paint() {
    const shown = filterRows(rows, filter);
    grid.replaceChildren(...(shown.length ? shown.map(card) : [h('p', { class: 'gf-empty', dataset: { ps: 'flow-homes-empty' } }, rows.length ? 'No homes match those filters. Try Any.' : 'No homes are available yet.')]));
  }

  (async () => {
    try {
      const r = await getHomes();
      if (disposed) return;
      rows = r.rows;
      if (!rows.some((x) => x.id === selected)) selected = null;
      const lot = lotOf(store.project);
      note.textContent = r.empty ? 'Your builder has not added house designs yet, so these are the Glide Inside sample homes.' : r.own ? 'Homes are ranked by how well they fit your lot. Designs that do not fit can still be placed.' : lot && lot.envelope ? 'Homes are ranked by how well they fit your lot and its setbacks. Designs that do not fit can still be placed.' : 'Setbacks are not loaded for this lot, so fit is not checked.';
      paint();
      ctx.refresh();
    } catch (e) {
      if (!disposed) grid.replaceChildren(h('p', { class: 'gf-empty gf-note--bad' }, e?.message || 'The homes could not be loaded.'));
    }
  })();

  return {
    el,
    canNext: () => !!selected && rows.some((r) => r.id === selected),
    nextLabel: 'Place this home',
    dispose() { disposed = true; },
  };
}

// Step 3 ----------------------------------------------------------------------------------------------------------------------
const STATUS_COLOUR = { inside: '#17724a', outside: '#c77700', unknown: '#1b4fd1', none: '#1b4fd1' };

function mountPlaceStep(ctx, { getHomes }) {
  let homes = null;
  const { store } = ctx;
  const NS = 'http://www.w3.org/2000/svg';
  let disposed = false;
  let touched = false;
  let refits = 0;
  let nudgeMm = 100;
  let handleDeg = -90;
  let drag = null;
  let aerial = null;
  let busy = false;

  const stage = h('div', { class: 'gf-stage', tabindex: '0', role: 'application', 'aria-label': 'Placement plan. Drag the home to move it. Arrow keys nudge it.', dataset: { ps: 'flow-stage' } });
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  stage.append(svg);
  const busyEl = h('div', { class: 'gf-empty', style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,.6)' }, dataset: { ps: 'flow-placing' }, role: 'status' }, 'Placing your home');

  const statusEl = h('div', { class: 'gf-status', role: 'status', 'aria-live': 'polite', dataset: { ps: 'flow-place-status' } });
  const nameEl = h('div', { class: 'gf-note', style: { margin: '0' } });
  const mk = (label, fn, ps, cls = '') => h('button', { class: `gf-btn ${cls}`, type: 'button', dataset: { ps }, onclick: fn }, label);
  const stepSel = h('select', { 'aria-label': 'Nudge step', dataset: { ps: 'flow-nudge-step' }, onchange: () => { nudgeMm = Number(stepSel.value); } }, h('option', { value: '100' }, '0.1 m'), h('option', { value: '500' }, '0.5 m'), h('option', { value: '1000' }, '1 m'));
  const arrow = (t, dx, dy, ps) => mk(t, () => nudge(dx, dy), ps, 'gf-btn--sm');
  const pad = h('div', { class: 'gf-pad', role: 'group', 'aria-label': 'Nudge the home' },
    h('span'), arrow('↑', 0, -1, 'flow-nudge-up'), h('span'),
    arrow('←', -1, 0, 'flow-nudge-left'), h('span', { class: 'gf-mid' }, 'nudge'), arrow('→', 1, 0, 'flow-nudge-right'),
    h('span'), arrow('↓', 0, 1, 'flow-nudge-down'), h('span'));
  const side = h('div', { class: 'gf-side' },
    h('div', { class: 'gf-card' }, nameEl, h('div', { style: { height: '8px' } }), statusEl),
    h('div', { class: 'gf-card' },
      h('div', { class: 'gf-ctl' },
        mk('Turn left 90°', () => turn(-90), 'flow-rot-left'),
        mk('Turn right 90°', () => turn(90), 'flow-rot-right'),
        mk('Mirror', () => { touched = true; mirrorHouse(store); }, 'flow-mirror')),
      h('div', { style: { height: '10px' } }),
      pad,
      h('label', { class: 'gf-note', style: { display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center' } }, 'Nudge step', stepSel),
      h('div', { style: { height: '8px' } }),
      mk('Best fit', () => bestFit(), 'flow-bestfit', 'gf-btn--primary'),
      h('p', { class: 'gf-note' }, 'Best fit puts the home back square to the street, garage facing the street, inside the setbacks. You can also drag the home, or drag the round handle to turn it.')),
    h('p', { class: 'gf-note' }, INDICATIVE));
  const el = h('div', { class: 'gf-place' }, stage, side);

  // Geometry ---------------------------------------------------------------------------------------------------------------
  let box = null;
  const lotNow = () => lotOf(store.project);
  const mmPerPx = () => (box ? box.w / Math.max(1, Math.min(stage.clientWidth, stage.clientHeight * (box.w / box.h))) : 1);
  const toMm = (ev) => { const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; const m = svg.getScreenCTM(); return m ? p.matrixTransform(m.inverse()) : { x: 0, y: 0 }; };

  const poly = (pts, attrs) => { const e = document.createElementNS(NS, 'polygon'); e.setAttribute('points', pts.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ')); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const line = (a, b, attrs) => { const e = document.createElementNS(NS, 'line'); e.setAttribute('x1', Math.round(a.x)); e.setAttribute('y1', Math.round(a.y)); e.setAttribute('x2', Math.round(b.x)); e.setAttribute('y2', Math.round(b.y)); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const text = (p, t, px, attrs = {}) => { const e = document.createElementNS(NS, 'text'); e.setAttribute('x', Math.round(p.x)); e.setAttribute('y', Math.round(p.y)); e.setAttribute('font-size', Math.round(px * mmPerPx())); e.setAttribute('font-family', 'system-ui,sans-serif'); e.setAttribute('font-weight', '700'); e.setAttribute('text-anchor', 'middle'); e.setAttribute('dominant-baseline', 'middle'); e.setAttribute('stroke', '#fff'); e.setAttribute('stroke-width', Math.round(3 * mmPerPx())); e.setAttribute('paint-order', 'stroke'); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.textContent = t; return e; };
  const group = (attrs = {}) => { const g = document.createElementNS(NS, 'g'); for (const [k, v] of Object.entries(attrs)) g.setAttribute(k, v); return g; };

  function ground(project) { return [...project.levels].sort((a, b) => a.elevation - b.elevation)[0]; }

  let houseG = null;
  let handleG = null;
  let liveProject = null; // the project drawn (a preview copy while dragging)

  function draw(project = store.project) {
    const lot = lotNow();
    if (!lot) return;
    liveProject = project;
    if (!box) box = mapBox(lot, { margin: 0.12, roadM: 12 });
    svg.setAttribute('viewBox', `${Math.round(box.x)} ${Math.round(box.y)} ${Math.round(box.w)} ${Math.round(box.h)}`);
    const px = mmPerPx();
    const st = placementStatus(project);
    const col = STATUS_COLOUR[st.state] || STATUS_COLOUR.unknown;
    svg.replaceChildren();
    const bg = document.createElementNS(NS, 'rect');
    for (const [k, v] of Object.entries({ x: box.x, y: box.y, width: box.w, height: box.h, fill: '#e3ead9' })) bg.setAttribute(k, v);
    svg.append(bg);
    if (aerial?.href && aerial.extent) {
      const im = document.createElementNS(NS, 'image');
      const e = aerial.extent;
      for (const [k, v] of Object.entries({ href: aerial.href, x: e.x0, y: e.y0, width: e.x1 - e.x0, height: e.y1 - e.y0, preserveAspectRatio: 'none', opacity: '0.85' })) im.setAttribute(k, v);
      svg.append(im);
    }
    const roads = document.createElementNS(NS, 'g'); roads.innerHTML = roadSvg(lot, px); svg.append(roads);
    svg.append(poly(lot.boundary, { fill: 'rgba(255,255,255,.22)', stroke: '#d11f1f', 'stroke-width': Math.round(3 * px) }));
    const env = Array.isArray(lot.envelope) && lot.envelope.length >= 3 ? lot.envelope : null;
    if (env) svg.append(poly(env, { fill: st.state === 'outside' ? 'rgba(199,119,0,.10)' : 'rgba(23,114,74,.10)', stroke: col, 'stroke-width': Math.round(3 * px), 'stroke-dasharray': `${Math.round(10 * px)} ${Math.round(6 * px)}`, 'data-ps': 'flow-envelope' }));
    const dw = (() => { try { return deriveDriveway(project); } catch { return null; } })();
    if (dw?.ok) svg.append(poly(dw.polygon, { fill: '#9a9da3', stroke: '#6b6f76', 'stroke-width': Math.round(1.5 * px), opacity: '0.95' }));
    // clearances: short lines from the house to each boundary with the distance, in the status colour
    for (const r of clearances(project).rows) {
      if (!r.from || !r.to || r.clearanceM > 25) continue;
      const bad = r.status === 'outside' || r.clearanceM < 0;
      const c = bad ? STATUS_COLOUR.outside : STATUS_COLOUR.inside;
      svg.append(line(r.from, r.to, { stroke: c, 'stroke-width': Math.round(2 * px) }));
      svg.append(text(G.lerp(r.from, r.to, 0.5), `${r.clearanceM.toFixed(1)} m`, 12, { fill: c, 'data-ps': 'flow-clearance' }));
    }
    houseG = group({ class: 'gf-house', 'data-ps': 'flow-house' });
    const g0 = ground(project);
    for (const r of g0?.rooms || []) {
      if (r.status === 'demolish' || !r.polygon?.length) continue;
      houseG.append(poly(r.polygon, { fill: r.outdoor ? 'rgba(120,170,110,.55)' : r.type === 'garage' ? '#c9ccc7' : '#f4efe4', stroke: '#2c2f36', 'stroke-width': Math.round(1.2 * px) }));
    }
    for (const w of g0?.walls || []) { if (w.status !== 'demolish') houseG.append(line(w.a, w.b, { stroke: '#2c2f36', 'stroke-width': Math.max(Math.round(w.thickness || 150), Math.round(1.6 * px)), 'stroke-linecap': 'square' })); }
    const door = garageDoor(project);
    if (door) houseG.append(line(door.mid, G.add(door.mid, G.mul(door.normal, 1800)), { stroke: '#1b4fd1', 'stroke-width': Math.round(4 * px), 'marker-end': '', 'stroke-linecap': 'round', 'data-ps': 'flow-garage-door' }));
    svg.append(houseG);
    // rotate handle
    const hull = buildingHull(project);
    if (hull.length >= 3) {
      const c = houseCentre(project);
      const R = Math.max(...hull.map((p) => G.dist(p, c))) + 2200;
      const hp = { x: c.x + R * Math.cos((handleDeg * Math.PI) / 180), y: c.y + R * Math.sin((handleDeg * Math.PI) / 180) };
      handleG = group({ class: 'gf-handle', 'data-ps': 'flow-handle' });
      handleG.append(line(c, hp, { stroke: '#1b4fd1', 'stroke-width': Math.round(1.5 * px), 'stroke-dasharray': `${Math.round(5 * px)} ${Math.round(4 * px)}` }));
      const dot = document.createElementNS(NS, 'circle');
      for (const [k, v] of Object.entries({ cx: Math.round(hp.x), cy: Math.round(hp.y), r: Math.round(11 * px), fill: '#ffc83d', stroke: '#1b4fd1', 'stroke-width': Math.round(2 * px) })) dot.setAttribute(k, v);
      handleG.append(dot);
      svg.append(handleG);
    }
    svg.append(text({ x: box.x + box.w / 2, y: box.y + box.h - 9 * px }, 'Drag the home to move it', 11, { fill: '#3b3f46', opacity: '0.8' }));
    paintStatus(st);
  }

  function paintStatus(st = placementStatus(liveProject || store.project)) {
    statusEl.dataset.state = st.state;
    statusEl.replaceChildren(h('span', { 'aria-hidden': 'true' }, st.state === 'inside' ? '✓' : st.state === 'outside' ? '!' : 'i'), h('span', null, st.state === 'inside' ? 'Inside the setbacks. Good position.' : st.text));
    const ph = store.project.placedHouse;
    nameEl.textContent = ph?.name ? `Home: ${ph.name}` : '';
  }

  // Actions ----------------------------------------------------------------------------------------------------------------
  function nudge(sx, sy) { touched = true; nudgeHouse(store, sx * nudgeMm, sy * nudgeMm); }
  function turn(deg) { touched = true; handleDeg += deg; turnHouse(store, deg); }
  async function bestFit() {
    const d = currentDesign();
    if (!d || busy) return;
    busy = true; stage.append(busyEl);
    try {
      touched = false; handleDeg = -90;
      await placeBest(store, d);
    } finally { busy = false; busyEl.remove(); draw(); ctx.refresh(); }
  }
  const currentDesign = () => {
    const want = flowOf(store.project)?.designId || store.project.placedHouse?.id || null;
    return homes?.rows.find((r) => r.id === want)?.design || null;
  };

  // Pointer: drag the house, or the handle to turn it
  const onDown = (ev) => {
    if (ev.button != null && ev.button !== 0) return;
    const onHandle = ev.target.closest?.('[data-ps="flow-handle"]');
    const onHouse = ev.target.closest?.('[data-ps="flow-house"]');
    if (!onHandle && !onHouse) return;
    ev.preventDefault();
    stage.setPointerCapture?.(ev.pointerId);
    const p = toMm(ev);
    const centre = houseCentre(store.project);
    if (onHandle) drag = { mode: 'turn', centre, a0: Math.atan2(p.y - centre.y, p.x - centre.x), deg: 0, total: 0, prev: 0 };
    else drag = { mode: 'move', start: p, dx: 0, dy: 0 };
    stage.focus({ preventScroll: true });
  };
  const onMove = (ev) => {
    if (!drag) return;
    const p = toMm(ev);
    const prev = previewCopy(store.project);
    if (drag.mode === 'move') {
      drag.dx = Math.round((p.x - drag.start.x) / 50) * 50; drag.dy = Math.round((p.y - drag.start.y) / 50) * 50;
      translateHouse(prev, drag.dx, drag.dy);
    } else {
      let d = ((Math.atan2(p.y - drag.centre.y, p.x - drag.centre.x) - drag.a0) * 180) / Math.PI;
      d = ((d + 540) % 360) - 180;
      drag.deg = ev.shiftKey ? Math.round(d / 15) * 15 : Math.round(d);
      rotateHouse(prev, drag.deg, drag.centre);
    }
    draw(prev);
    if (drag.mode === 'turn') { const hd = handleDeg; handleDeg += drag.deg; draw(prev); handleDeg = hd; }
  };
  const onUp = () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.mode === 'move' && (d.dx || d.dy)) { touched = true; nudgeHouse(store, d.dx, d.dy); }
    else if (d.mode === 'turn' && d.deg) { touched = true; handleDeg += d.deg; turnHouse(store, d.deg); }
    else draw();
  };
  svg.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 1000 : nudgeMm;
    const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (k) { e.preventDefault(); touched = true; nudgeHouse(store, k[0] * step, k[1] * step); }
    else if (e.key === 'm' || e.key === 'M') { touched = true; mirrorHouse(store); }
    else if (e.key === 'q' || e.key === 'Q') turn(-90);
    else if (e.key === 'e' || e.key === 'E') turn(90);
  });
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (!drag) draw(); }) : null;
  ro?.observe(stage);

  const off = store.on('project', (e) => {
    if (disposed || drag) return;
    draw();
    // Late setbacks (the design's own storeys and heights change the council envelope): a home the person has not touched is fitted again.
    if (e?.label === 'setbacks' && !touched && refits < 2 && !busy && placementStatus(store.project).state === 'outside') { refits += 1; bestFit(); }
  });

  return {
    el,
    nextLabel: 'Check it',
    canNext: () => !busy && !!lotNow() && !!store.project.placedHouse,
    async onEnter() {
      const lot = lotNow();
      if (!lot) return;
      aerialOf(lot).then((a) => { if (a && !disposed) { aerial = a; draw(); } });
      try { homes = await getHomes(); } catch { homes = null; }
      const d = currentDesign();
      const placed = store.project.placedHouse;
      const want = d?.id || flowOf(store.project)?.designId || null;
      // The home already on the lot stays where it is (a refresh, or Back and Next); a different choice is placed fresh.
      if (d && (!placed || (want && placed.id !== want) || !buildingHull(store.project).length)) {
        busy = true; stage.append(busyEl);
        try { await placeBest(store, d); } finally { busy = false; busyEl.remove(); }
      }
      draw();
      ctx.refresh();
    },
    dispose() { disposed = true; off?.(); ro?.disconnect(); },
  };
}

// Step 4 ----------------------------------------------------------------------------------------------------------------------
function mountCheckStep(ctx, { catalogue }) {
  const { store } = ctx;
  const card = h('div', { class: 'gf-card', dataset: { ps: 'flow-summary' } });
  const view = h('div', { class: 'gf-3d', dataset: { ps: 'flow-3d' } });
  const el = h('div', { class: 'gf-check' }, card, view);
  let preview = null;
  let disposed = false;

  function paint() {
    const s = checkSummary(store.project);
    if (!s.ok) { card.replaceChildren(h('p', null, s.lines[0])); return; }
    const verdictChip = s.verdict === 'met' ? h('span', { class: 'gf-chip gf-chip--ok' }, 'Setbacks met') : s.verdict === 'not-met' ? h('span', { class: 'gf-chip gf-chip--warn' }, 'Setbacks not met') : h('span', { class: 'gf-chip' }, 'Setbacks not checked');
    card.replaceChildren(
      h('div', { class: 'gf-row', style: { justifyContent: 'space-between' } }, h('strong', { style: { fontSize: '18px' } }, store.project.placedHouse?.name || 'Your home'), verdictChip),
      h('table', { class: 'gf-table', dataset: { ps: 'flow-setback-table' } },
        h('thead', null, h('tr', null, h('th', null, 'Boundary'), h('th', null, 'Distance'), h('th', null, 'Needed'), h('th', null, ''))),
        h('tbody', null, ...s.rows.map((r) => h('tr', { dataset: { met: String(r.met) } }, h('td', null, r.label), h('td', null, `${r.clearanceM.toFixed(2)} m`), h('td', null, r.requiredM != null ? `${r.requiredM.toFixed(1)} m` : 'n/a'), h('td', null, r.met === true ? 'Met' : r.met === false ? 'Not met' : 'Not checked'))))),
      h('div', { class: 'gf-stats' },
        stat(`${Math.round(s.coverageM2)} m2`, `Site coverage${s.coveragePct != null ? `, ${Math.round(s.coveragePct)} percent` : ''}`),
        s.openSpaceM2 != null ? stat(`${Math.round(s.openSpaceM2)} m2`, `Open space${s.openSpacePct != null ? `, ${Math.round(s.openSpacePct)} percent` : ''}`) : null,
        stat(s.garage.has ? (s.garage.facesStreet ? 'Faces street' : 'Not to street') : 'No garage', s.garage.distanceM != null ? `Garage, ${s.garage.distanceM.toFixed(1)} m from street` : 'Garage'),
        stat(s.driveway.state === 'ok' ? `${s.driveway.lengthM.toFixed(1)} m` : s.driveway.state === 'none' ? 'None' : 'Not linked', 'Driveway to frontage')),
      h('ul', { class: 'gf-lines', dataset: { ps: 'flow-lines' } }, ...s.lines.map((t) => h('li', null, t))),
      h('p', { class: 'gf-note' }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); ctx.go(3); } }, 'Back to placement'), ' to move or turn the home.'));
  }
  const stat = (b, s) => h('div', { class: 'gf-stat' }, h('b', null, b), h('span', null, s));
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
export function residentialSteps({ catalogue, store }) {
  // The ranked homes are worked out once per lot visit (step 1 clears them, a different lot changes the ranking).
  let cache = null;
  const getHomes = () => (cache ||= loadHomes(store, catalogue).catch((e) => { cache = null; throw e; }));
  return [
    { id: 'lot', title: 'Find your lot', intro: 'Search your address. Check that the boundary, street frontage and setbacks look right.', mount: (ctx) => { cache = null; return mountLotStep(ctx); } },
    { id: 'home', title: 'Choose a home', intro: 'Pick a home that suits your lot. The best fits come first.', mount: (ctx) => mountHomeStep(ctx, { getHomes }) },
    { id: 'place', title: 'Place it', intro: 'The home is placed square to the street with the driveway to the frontage. Move, turn or mirror it as you like.', mount: (ctx) => mountPlaceStep(ctx, { getHomes }) },
    { id: 'check', title: 'Check it', intro: 'A quick check of setbacks, site coverage and the driveway, and a 3D look at your lot.', mount: (ctx) => mountCheckStep(ctx, { catalogue }) },
  ];
}
export { zoneText };
