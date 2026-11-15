// The residential guided flow: 1 Find your lot, 2 Choose a home, 3 Place it, 4 Check it, then the full editor (step 5).
// The steps work on the real project, so the editor opens with exactly the home that was placed.

import { confirmBreach } from './breach.js';
import { h } from '../ui/dom.js';
import * as G from '../model/geometry.js';
import { lotOf, translateHouse, rotateHouse, houseCentre } from '../model/placement.js';
import { buildingHull, clearances, deriveDriveway, garageDoor, setStoredDriveway, storedDriveway } from '../site/lotplan.js';
import { projectToSvg, svgDataUri } from '../portal/thumbnail.js';
import { mountLotStep, zoneText } from './lot-step.js';
import { lotMapSvg, mapBox, roadSvg, aerialOf } from './lot-map.js';
import { writeFlow, flowOf } from './state.js';
import { loadHomes, filterRows, placeBest, nudgeHouse, turnHouse, mirrorHouse, previewCopy, placementStatus, checkSummary, INDICATIVE } from './res-logic.js';
import { mount3dPreview } from './preview3d.js';
import { mountBuilderFinder } from './builder-finder.js';
import { ensureFlowAerial, NO_AERIAL } from './flow-aerial.js';

export const RESIDENTIAL_BRAND = 'Glide Inside Residential';

// Step 2 ----------------------------------------------------------------------------------------------------------------------
function mountHomeStep(ctx, { getHomes }) {
  const { store } = ctx;
  let rows = [];
  let selected = flowOf(store.project)?.designId || store.project.placedHouse?.id || null;
  const filter = { bedrooms: null, storeys: null, frontage: null };
  let disposed = false;
  const grid = h('div', { class: 'gf-homes', dataset: { ps: 'flow-homes' } }, h('p', { class: 'gf-empty' }, 'Loading homes'));
  const note = h('p', { class: 'gf-note', dataset: { ps: 'flow-homes-note' } });
  const sel = (label, key, opts) => {
    const s = h('select', { 'aria-label': label, dataset: { ps: `flow-filter-${key}` }, onchange: () => { const v = s.value; filter[key] = v === '' ? null : Number(v); paint(); } }, ...opts.map(([v, t]) => h('option', { value: v }, t)));
    return h('label', null, label, s);
  };
  const filters = h('div', { class: 'gf-filters' },
    sel('Bedrooms', 'bedrooms', [['', 'Any'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4 or more']]),
    sel('Storeys', 'storeys', [['', 'Any'], ['1', 'Single storey'], ['2', 'Two storeys']]),
    sel('Lot width', 'frontage', [['', 'Any'], ['10', '10 m'], ['12.5', '12.5 m'], ['14', '14 m'], ['18', '18 m and wider']]));
  // "Have a local builder in mind?": find a listed builder and ask them for a client login to their own homes.
  const finder = mountBuilderFinder({ getLot: () => lotOf(store.project)?.address || '', getDesign: () => { const r = rows.find((x) => x.id === selected); return r ? { id: r.id, name: r.name } : null; } });
  const el = h('div', null, finder.el, filters, grid, note);

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
    dispose() { disposed = true; finder.dispose(); },
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
  // Zoom and pan: `view` is the visible box in plan mm (same shape as `box`); null means the whole lot. Aerial on/off is remembered.
  let view = null;
  let aerialOn = true;
  let aerialState = 'loading'; // loading | done
  try { aerialOn = localStorage.getItem('gi.flow.aerial') !== '0'; } catch { /* default on */ }

  const stage = h('div', { class: 'gf-stage', tabindex: '0', role: 'application', 'aria-label': 'Placement plan. Drag the home to move it. Arrow keys nudge it.', dataset: { ps: 'flow-stage' } });
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  stage.append(svg);
  const zbtn = (label, text, fn, ps, cls = '') => h('button', { class: `gf-zb ${cls}`, type: 'button', 'aria-label': label, title: label, dataset: { ps }, onclick: (e) => { e.stopPropagation(); fn(); } }, text);
  const aerialBtn = zbtn('Show or hide the aerial photo', 'Aerial: On', () => { aerialOn = !aerialOn; try { localStorage.setItem('gi.flow.aerial', aerialOn ? '1' : '0'); } catch { /* not remembered */ } draw(liveProject || store.project); }, 'flow-aerial-toggle', 'gf-zb--wide');
  const srcBtn = { el: zbtn('Use my own aerial (image or GeoTIFF file). It stays in this browser.', 'Use my own aerial', () => { import('../ui/aerial-source.js').then((m) => m.openAerialSource({ store })); }, 'flow-aerial-source', 'gf-zb--wide'), dispose() {} };
  const zoomBar = h('div', { class: 'gf-zoom', role: 'group', 'aria-label': 'Zoom the plan' },
    zbtn('Zoom in', '+', () => zoomBy(1 / 1.5), 'flow-zoom-in'), zbtn('Zoom out', '\u2212', () => zoomBy(1.5), 'flow-zoom-out'),
    zbtn('Fit the whole lot', 'Fit lot', () => { view = null; draw(liveProject || store.project); }, 'flow-fit-lot', 'gf-zb--wide'),
    zbtn('Zoom to the building', 'Zoom to building', () => zoomHome(3000), 'flow-zoom-home', 'gf-zb--wide'),
    zbtn('Zoom to the whole development: buildings and driveway', 'Zoom to development', () => zoomDev(), 'flow-zoom-dev', 'gf-zb--wide'), aerialBtn, srcBtn.el);
  stage.append(zoomBar);
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
      h('div', { style: { height: '8px' } }),
      h('div', { class: 'gf-note', style: { fontWeight: '600' } }, 'Driveway'),
      h('div', { class: 'gf-row', style: { gap: '6px', justifyContent: 'center', flexWrap: 'wrap' } },
        mk('Add bend', () => addBend(), 'flow-drive-bend'), mk('Reset driveway', () => resetDriveway(), 'flow-drive-reset'),
        h('label', { class: 'gf-note' }, 'Width ', h('select', { dataset: { ps: 'flow-drive-width' }, onchange: (e) => setDriveWidth(Number(e.target.value)) }, ...[3000, 3500, 4000, 5000, 6000].map((w) => h('option', { value: String(w) }, `${(w / 1000).toFixed(1)} m`))))),
      h('p', { class: 'gf-note' }, 'Drag the white dot to slide the driveway along the street. Drag a yellow dot to bend it.'),
      h('p', { class: 'gf-note' }, 'Best fit puts the home back square to the street, garage facing the street, inside the setbacks. You can also drag the home, or drag the round handle to turn it.')),
    h('p', { class: 'gf-note' }, INDICATIVE));
  const el = h('div', { class: 'gf-place' }, stage, side);

  // Geometry ---------------------------------------------------------------------------------------------------------------
  let box = null;
  const lotNow = () => lotOf(store.project);
  const vb = () => view || box;
  const mmPerPx = () => { const b = vb(); return b ? b.w / Math.max(1, Math.min(stage.clientWidth, stage.clientHeight * (b.w / b.h))) : 1; };
  const clampView = (v) => {
    const w = Math.min(box.w, Math.max(5000, v.w));
    const h2 = w * (box.h / box.w);
    return { x: Math.min(box.x + box.w - w, Math.max(box.x, v.x)), y: Math.min(box.y + box.h - h2, Math.max(box.y, v.y)), w, h: h2 };
  };
  function zoomBy(f, at = null) {
    if (!box) return;
    const b = vb();
    const c = at || { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const w = Math.min(box.w, Math.max(5000, b.w * f));
    const k = w / b.w;
    const next = clampView({ x: c.x - (c.x - b.x) * k, y: c.y - (c.y - b.y) * k, w, h: b.h * k });
    view = next.w >= box.w - 1 ? null : next;
    draw(liveProject || store.project);
  }
  // Frame the home with 20 m of ground around it (the whole lot when that is nearly as big).
  function zoomHome(marginMm = 20000) {
    const hl = buildingHull(store.project);
    if (!box || hl.length < 3) return;
    const hb = G.bbox(hl);
    const w = Math.min(box.w, Math.max(30000, Math.max(hb.w, hb.h * (box.w / box.h)) + 2 * marginMm));
    const c = houseCentre(store.project);
    view = w >= box.w - 1 ? null : clampView({ x: c.x - w / 2, y: c.y - (w * (box.h / box.w)) / 2, w, h: w * (box.h / box.w) });
    draw(liveProject || store.project);
  }
  function zoomDev() {
    const hl = buildingHull(store.project);
    if (!box || hl.length < 3) return;
    let pts = hl;
    try { const d = deriveDriveway(store.project); if (d?.ok) pts = [...hl, ...d.polygon]; } catch { /* none */ }
    const bb = G.bbox(pts);
    const w = Math.min(box.w, Math.max(30000, Math.max(bb.w, bb.h * (box.w / box.h)) + 2 * 6000));
    const cx = (bb.minX + bb.maxX) / 2; const cy = (bb.minY + bb.maxY) / 2;
    view = w >= box.w - 1 ? null : clampView({ x: cx - w / 2, y: cy - (w * (box.h / box.w)) / 2, w, h: w * (box.h / box.w) });
    draw(liveProject || store.project);
  }
  const shoelace = (pts) => Math.abs(pts.reduce((t, p, i) => { const q = pts[(i + 1) % pts.length]; return t + p.x * q.y - q.x * p.y; }, 0)) / 2;
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
    const V = vb();
    svg.setAttribute('viewBox', `${Math.round(V.x)} ${Math.round(V.y)} ${Math.round(V.w)} ${Math.round(V.h)}`);
    aerialBtn.textContent = aerial?.href ? `Aerial: ${aerialOn ? 'On' : 'Off'}` : aerialState === 'loading' ? 'Aerial: loading' : NO_AERIAL;
    aerialBtn.disabled = !aerial?.href;
    const px = mmPerPx();
    const st = placementStatus(project);
    const col = STATUS_COLOUR[st.state] || STATUS_COLOUR.unknown;
    svg.replaceChildren();
    const bg = document.createElementNS(NS, 'rect');
    for (const [k, v] of Object.entries({ x: box.x, y: box.y, width: box.w, height: box.h, fill: '#e3ead9' })) bg.setAttribute(k, v);
    svg.append(bg);
    if (aerialOn && aerial?.href && aerial.extent) {
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
    if (dw?.ok) {
      const knob = (pt, kind, idx, fill) => {
        const c = document.createElementNS(NS, 'circle');
        for (const [k, v] of Object.entries({ cx: Math.round(pt.x), cy: Math.round(pt.y), r: Math.round(9 * px), fill, stroke: '#1b4fd1', 'stroke-width': Math.round(2 * px), 'data-ps': 'flow-drive-handle', 'data-kind': kind, 'data-idx': String(idx), style: 'cursor:grab' })) c.setAttribute(k, v);
        svg.append(c);
      };
      knob(dw.kerbPoint, 'end', 0, '#ffffff');
      (dw.pis || []).forEach((q, i) => knob(q, 'pi', i, '#ffc83d'));
    }
    // clearances: short lines from the house to each boundary with the distance, in the status colour
    // Labels that would land on each other (several edges of a battle axe or irregular lot close together) are stepped apart.
    const taken = [];
    for (const r of clearances(project).rows) {
      if (!r.from || !r.to || r.clearanceM > 25) continue;
      const bad = r.status === 'outside' || r.clearanceM < 0;
      const c = bad ? STATUS_COLOUR.outside : STATUS_COLOUR.inside;
      svg.append(line(r.from, r.to, { stroke: c, 'stroke-width': Math.round(2 * px) }));
      const label = `${r.clearanceM.toFixed(1)} m`;
      const at = G.lerp(r.from, r.to, 0.5);
      const w = label.length * 7.4 * px;
      const hh = 15 * px;
      const hit = (q) => taken.some((t) => Math.abs(t.x - q.x) < (t.w + w) / 2 && Math.abs(t.y - q.y) < hh);
      let pos = { x: at.x, y: at.y };
      for (let k = 1; k <= 6 && hit(pos); k++) pos = { x: at.x, y: at.y + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * hh };
      taken.push({ x: pos.x, y: pos.y, w });
      svg.append(text(pos, label, 12, { fill: c, 'data-ps': 'flow-clearance' }));
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
    svg.append(text({ x: V.x + V.w / 2, y: V.y + V.h - 9 * px }, 'Drag the home to move it, scroll to zoom', 11, { fill: '#3b3f46', opacity: '0.8' }));
    paintStatus(st);
  }

  function paintStatus(st = placementStatus(liveProject || store.project)) {
    statusEl.dataset.state = st.state;
    statusEl.replaceChildren(h('span', { 'aria-hidden': 'true' }, st.state === 'inside' ? '✓' : st.state === 'outside' ? '!' : 'i'), h('span', null, st.state === 'inside' ? 'Inside the setbacks. Good position.' : st.text),
      st.state === 'outside' ? h('span', { class: 'gf-note', dataset: { ps: 'flow-too-tight' }, style: { display: 'block', marginTop: '4px' } }, 'Too tight? Choose a narrower design in step 2 to fit the setbacks. ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); ctx.go(2); } }, 'Show narrower designs')) : null);
    const ph = store.project.placedHouse;
    nameEl.textContent = ph?.name ? `Home: ${ph.name}` : '';
  }

  // A bend point stays inside the lot: a point outside is pulled back toward the house.
  function clampInLot(pt) {
    const lot = lotNow();
    if (!lot || G.pointInPolygon(pt, lot.boundary)) return pt;
    const c = houseCentre(store.project);
    let q = pt;
    for (let i = 0; i < 24 && !G.pointInPolygon(q, lot.boundary); i++) q = { x: q.x + (c.x - q.x) * 0.1, y: q.y + (c.y - q.y) * 0.1 };
    return q;
  }
  function addBend() {
    const dw = deriveDriveway(store.project);
    if (!dw?.ok || (dw.pis || []).length >= 4) return;
    const m = dw.centre[Math.floor(dw.centre.length / 2)];
    touched = true;
    store.apply('Edit driveway', (pr) => { const st = storedDriveway(pr) || { radiusM: 6, widthMm: null }; setStoredDriveway(pr, { endOffsetMm: dw.endOffsetMm, pis: [...(dw.pis || []), { x: m.x, y: m.y }], radiusM: st.radiusM, widthMm: st.widthMm }); });
  }
  function setDriveWidth(mm) {
    const dw = deriveDriveway(store.project);
    if (!dw?.ok) return;
    touched = true;
    store.apply('Edit driveway', (pr) => { const st = storedDriveway(pr) || { radiusM: 6 }; setStoredDriveway(pr, { endOffsetMm: dw.endOffsetMm, pis: dw.pis || [], radiusM: st.radiusM, widthMm: mm }); });
  }
  function resetDriveway() { touched = true; store.apply('Reset driveway', (pr) => { setStoredDriveway(pr, null); }); }

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
  // Pinch to zoom (two pointers): both fingers zoom about their midpoint and moving the midpoint pans. A drag in progress is abandoned
  // (the home is not moved) the moment the second finger lands.
  const ptrs = new Map();
  let pinch = null;
  const pinchDist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const pinchMid = () => { const [a, b] = [...ptrs.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  stage.addEventListener('pointerdown', (ev) => {
    if (ev.target.closest?.('.gf-zoom')) return;
    if (ev.isPrimary) { ptrs.clear(); pinch = null; } // a new gesture starts with the primary pointer: a lost pointerup never leaves a stale finger
    ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (ptrs.size === 2) {
      if (drag) { drag = null; draw(store.project); }
      pinch = { d: pinchDist(), mid: pinchMid() };
    }
  }, true);
  function doPinch() {
    if (!box || ptrs.size < 2 || !pinch) return;
    const d = pinchDist();
    const mid = pinchMid();
    if (d > 0 && pinch.d > 0) zoomBy(pinch.d / d, toMm({ clientX: mid.x, clientY: mid.y }));
    const m = svg.getScreenCTM();
    const sc = m ? m.a : 1;
    if (view && (mid.x !== pinch.mid.x || mid.y !== pinch.mid.y)) {
      view = clampView({ ...view, x: view.x - (mid.x - pinch.mid.x) / sc, y: view.y - (mid.y - pinch.mid.y) / sc });
      draw(liveProject || store.project);
    }
    pinch = { d, mid };
  }
  const endPointer = (ev) => { ptrs.delete(ev.pointerId); if (ptrs.size < 2) pinch = null; };
  const onDown = (ev) => {
    if (ev.button != null && ev.button !== 0) return;
    if (ptrs.size > 1) return; // a pinch, not a drag
    const dh = ev.target.closest?.('[data-ps="flow-drive-handle"]');
    if (dh) {
      ev.preventDefault();
      stage.setPointerCapture?.(ev.pointerId);
      drag = { mode: 'drive', kind: dh.getAttribute('data-kind'), idx: Number(dh.getAttribute('data-idx')), value: null };
      return;
    }
    const onHandle = ev.target.closest?.('[data-ps="flow-handle"]');
    const onHouse = ev.target.closest?.('[data-ps="flow-house"]');
    if (!onHandle && !onHouse) {
      // Empty ground: drag to pan (only useful when zoomed in)
      if (!view) return;
      ev.preventDefault();
      stage.setPointerCapture?.(ev.pointerId);
      const m = svg.getScreenCTM();
      drag = { mode: 'pan', sx: ev.clientX, sy: ev.clientY, v0: { ...view }, scale: m ? m.a : 1 };
      return;
    }
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
    if (drag.mode === 'pan') {
      view = clampView({ ...drag.v0, x: drag.v0.x - (ev.clientX - drag.sx) / drag.scale, y: drag.v0.y - (ev.clientY - drag.sy) / drag.scale });
      draw(liveProject || store.project);
      return;
    }
    const p = toMm(ev);
    const prev = previewCopy(store.project);
    if (drag.mode === 'drive') {
      const cur = deriveDriveway(prev);
      if (!cur?.ok) return;
      const base = storedDriveway(prev) || { pis: [], radiusM: 6, widthMm: null };
      const val = { endOffsetMm: cur.endOffsetMm, pis: cur.pis.map((q) => ({ ...q })), radiusM: base.radiusM, widthMm: base.widthMm };
      if (drag.kind === 'end') val.endOffsetMm = (p.x - cur.edgeStart.x) * cur.edgeU.x + (p.y - cur.edgeStart.y) * cur.edgeU.y;
      else val.pis[drag.idx] = clampInLot({ x: p.x, y: p.y });
      setStoredDriveway(prev, val);
      drag.value = val;
      draw(prev);
      return;
    }
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
    if (d.mode === 'pan') return;
    if (d.mode === 'drive') { if (d.value) { touched = true; store.apply('Edit driveway', (pr) => { setStoredDriveway(pr, d.value); }); } else draw(); return; }
    if (d.mode === 'move' && (d.dx || d.dy)) { touched = true; nudgeHouse(store, d.dx, d.dy); }
    else if (d.mode === 'turn' && d.deg) { touched = true; handleDeg += d.deg; turnHouse(store, d.deg); }
    else draw();
  };
  svg.addEventListener('pointerdown', onDown);
  stage.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), toMm(e)); }, { passive: false });
  stage.addEventListener('pointermove', (ev) => {
    if (ptrs.has(ev.pointerId)) ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch) { ev.preventDefault(); doPinch(); return; }
    onMove(ev);
  });
  stage.addEventListener('pointerup', (ev) => { endPointer(ev); onUp(); });
  stage.addEventListener('pointercancel', (ev) => { endPointer(ev); onUp(); });
  stage.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 1000 : nudgeMm;
    const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (k) { e.preventDefault(); touched = true; nudgeHouse(store, k[0] * step, k[1] * step); }
    else if (e.key === 'm' || e.key === 'M') { touched = true; mirrorHouse(store); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1 / 1.5); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1.5); }
    else if (e.key === '[' || e.key === ']') { e.preventDefault(); turn((e.key === '[' ? -1 : 1) * (e.shiftKey ? 15 : 1)); }
    else if (e.key === 'q' || e.key === 'Q') turn(-90);
    else if (e.key === 'e' || e.key === 'E') turn(90);
  });
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (!drag) draw(); }) : null;
  ro?.observe(stage);

  let aerialKey = lotNow()?.aerial?.key || null;
  const off = store.on('project', (e) => {
    if (disposed || drag) return;
    // The aerial source changed (a picture of the person's own, or back to standard): load the new image.
    const k = lotNow()?.aerial?.key || null;
    if (k !== aerialKey) { aerialKey = k; aerial = null; aerialOf(lotNow()).then((a) => { if (!disposed) { aerial = a; draw(); } }); }
    draw();
    // Late setbacks (the design's own storeys and heights change the council envelope): a home the person has not touched is fitted again.
    if (e?.label === 'setbacks' && !touched && refits < 2 && !busy && placementStatus(store.project).state === 'outside') { refits += 1; bestFit(); }
  });

  return {
    el,
    nextLabel: 'Check it',
    canNext: () => !busy && !!lotNow() && !!store.project.placedHouse,
    beforeNext: () => confirmBreach(placementStatus(store.project), { what: 'home' }),
    async onEnter() {
      const lot = lotNow();
      if (!lot) return;
      aerialOf(lot).then(async (a) => {
        if (!a && !disposed) { await ensureFlowAerial(store); a = await aerialOf(lotNow()); } // step 1 did not leave one: fetch it as the editor does
        aerialState = 'done';
        if (!disposed) { if (a) aerial = a; draw(); }
      });
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
      // A large lot makes the home a speck: when the lot is more than 4 times the home's footprint, open framed on the home.
      try {
        const hl = buildingHull(store.project);
        if (box && hl.length >= 3 && !view && shoelace(lot.boundary) / Math.max(shoelace(hl), 1) > 4) zoomHome();
      } catch { /* the whole lot stays in view */ }
      ctx.refresh();
    },
    dispose() { disposed = true; off?.(); ro?.disconnect(); srcBtn.dispose(); },
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
      h('p', { class: 'gf-note' }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); ctx.go(3); } }, 'Back to placement'), ' to move or turn the home.',
        s.verdict === 'not-met' ? h('span', { dataset: { ps: 'flow-too-tight' } }, ' Too tight? ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); ctx.go(2); } }, 'Show narrower designs'), ' to find a home that fits the setbacks.') : null));
  }
  const stat = (b, s) => h('div', { class: 'gf-stat' }, h('b', null, b), h('span', null, s));
  paint();
  const off = store.on('project', () => { if (!disposed) paint(); });
  return {
    el,
    nextLabel: 'Open the editor',
    async onEnter() { await ensureFlowAerial(store); preview = await mount3dPreview(view, store, catalogue); if (disposed) preview?.dispose?.(); },
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
