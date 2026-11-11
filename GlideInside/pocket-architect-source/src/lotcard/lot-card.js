// The lot card: what a builder sees live is what the sales pitch showed. Sits over the 3D view of a lot with a house on it:
//   header (top left)      lot label and a muted "Builder name · Concept only" line
//   design card (bottom left)  design name, lot line, scheme, stats, colour swatches, actions, setback status
//   design carousel (bottom centre)  "< NAME · 1 / n >" re-places the next design on the lot
//   top view minimap (bottom right)  lot, house and neighbours with a north arrow; click toggles the 2D plan
// Everything is derived from the project (src/lotcard/stats.js, src/model/colour-schemes.js, src/site/lot-checks.js). The card never
// edits the design except through store.apply (colour scheme, change of design), so every change is one undo step and saves with
// the project. The camera is inset so the card does not sit over the lot (viewer.setInset).

import { h } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { lotOf, translateHouse, rotateHouse } from '../model/placement.js';
import * as G from '../model/geometry.js';
import { canMoveHouse, onHouse, turnAngle } from '../editor2d/tool-movehouse.js';
import { ringOf } from '../editor2d/draw-lotplan.js';
import { buildingRings, buildingHull } from '../site/lotplan.js';
import { setbackStatusLine } from '../site/lot-checks.js';
import { SCHEMES, effectiveSchemeId, schemeById, schemeLine, schemeColours } from '../model/colour-schemes.js';
import { cardStats, lotHeading, lotLine, hasBuilding } from './stats.js';
import { publicDesigns, currentIndex, pagerText, stepIndex } from './designs.js';
import { swapHouse } from './swap.js';
import { LOT_CARD_CSS } from './lot-card-css.js';
import { icon } from '../ui/icons.js';
import { listRoomTabs } from '../viewer3d/rooms.js';
import { roomsPlanModel } from './rooms-plan.js';

const STYLE_ID = 'lc-style';
const COMPACT_W = 980;
const PHONE_W = 600;
const DOT = { inside: '#6fd39a', outside: '#ff8a7a', check: '#f2b94b' };

/** The muted header line: "Builder name · Concept only" in the portal, "Concept only" in the public app. */
export const mutedLine = (builderName) => (builderName ? `${builderName} · Concept only` : 'Concept only');

export function createLotCard({ store, host, viewerHost = host, catalogue = null, getApp = () => (typeof window !== 'undefined' ? window.__ps : null), getViewer = () => null, onEdit = null, onMini = null, embed = false }) {
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = LOT_CARD_CSS;
    document.head.append(st);
  }
  const E = (cls, tag = 'div', attrs = {}, ...kids) => h(tag, { class: cls, ...attrs }, ...kids);

  const headT = E('lc-head-t', 'b');
  const headS = E('lc-head-s', 'span');
  const head = E('lc-head', 'div', { dataset: { ps: 'lot-head' } }, headT, headS);

  const title = E('lc-title', 'h2');
  const sub = E('lc-sub');
  const stats = E('lc-stats');
  const chips = E('lc-strip', 'div', { role: 'group', 'aria-label': 'Colour schemes' });
  const bWalk = h('button', { class: 'lc-btn lc-pri', type: 'button', dataset: { ps: 'lc-walk' }, onclick: () => store.setUI({ view: 'walk' }) }, 'Walk inside');
  const bEdit = h('button', { class: 'lc-btn', type: 'button', dataset: { ps: 'lc-edit' }, onclick: () => (onEdit ? onEdit() : store.setUI({ view: '2d' })) }, 'Edit floor plan');
  const bPdf = h('button', { class: 'lc-btn lc-gh', type: 'button', dataset: { ps: 'lc-pdf' }, onclick: () => sitePlanPdf() }, 'Plan set PDF');
  const fit = E('lc-fit', 'div', { role: 'status', 'aria-live': 'polite', dataset: { ps: 'lc-fit' } });
  const more = h('button', { class: 'lc-more', type: 'button', 'aria-expanded': 'false', onclick: () => { card.classList.toggle('is-open'); more.setAttribute('aria-expanded', String(card.classList.contains('is-open'))); sizeInset(); } }, 'Details');
  const tabsEl = E('lc-tabs', 'div', { role: 'tablist', 'aria-label': 'Rooms', dataset: { ps: 'lc-tabs' } });
  const body = E('lc-body', 'div', null, stats, E('lc-sp', 'div', null, E('lc-k', 'span', null, 'Colours'), chips), E('lc-sp lc-sp-rooms', 'div', null, E('lc-k', 'span', null, 'Rooms'), tabsEl), E('lc-acts', 'div', null, bWalk, bEdit, bPdf), fit);
  const card = E('lc-card lc-glass', 'section', { 'aria-label': 'House design', dataset: { ps: 'lot-card' } }, E('lc-hd', 'div', null, E('lc-hd-in', 'div', null, title, sub), more), body);

  const pgP = h('button', { type: 'button', 'aria-label': 'Previous design', onclick: () => step(-1) }, '‹');
  const pgN = h('button', { type: 'button', 'aria-label': 'Next design', onclick: () => step(1) }, '›');
  const pgT = E('lc-pgt', 'span', { dataset: { ps: 'lc-pager-text' }, 'aria-live': 'polite' });
  const pager = E('lc-pager lc-glass', 'div', { dataset: { ps: 'lc-pager' } }, pgP, pgT, pgN);

  // Rooms: tab pills, a one line caption and a small floor plan with the chosen room highlighted (rooms on it are clickable).
  const tabsCompact = E('lc-tabs', 'div', { role: 'tablist', 'aria-label': 'Rooms', dataset: { ps: 'lc-tabs-compact' } });
  const cap = E('lc-cap', 'p', { dataset: { ps: 'lc-caption' }, 'aria-live': 'polite' });
  const plan = (() => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'lc-plan'); svg.setAttribute('role', 'group'); svg.setAttribute('aria-label', 'Floor plan'); return svg; })();
  const rooms = E('lc-rooms lc-glass', 'div', { dataset: { ps: 'lc-rooms' } }, tabsCompact, E('lc-rooms-row', 'div', null, cap, plan));

  const cv = h('canvas', { width: 300, height: 400, 'aria-hidden': 'true' });
  const north = (() => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '-20 -20 40 40');
    svg.setAttribute('class', 'lc-north');
    svg.innerHTML = '<circle r="17" fill="rgba(10,10,12,.72)" stroke="rgba(255,255,255,.5)"/><path d="M0-14 L4 2 L0 -1 L-4 2Z" fill="#ffc83d"/><path d="M0 14 L4 2 L0 5 L-4 2Z" fill="rgba(255,255,255,.5)"/><text x="0" y="-6" font-size="0" fill="#000">N</text>';
    return svg;
  })();
  const northLabel = E('lc-nlabel', 'i', null, 'N');
  const mini = h('button', { class: 'lc-mini', type: 'button', title: 'Show or hide the 2D plan', 'aria-label': 'Top view. Click to show or hide the 2D plan', dataset: { ps: 'lc-mini' }, onclick: () => { if (suppressClick) { suppressClick = false; return; } toggle2d(); } }, cv, h('span', { class: 'lc-mini-t' }, 'TOP VIEW'), north, northLabel, h('span', { class: 'lc-mini-hint', 'aria-hidden': 'true' }, 'Drag to move, handle to rotate'));
  let suppressClick = false;

  const findPill = h('button', { class: 'lc-find lc-glass', type: 'button', dataset: { ps: 'lc-find' }, 'aria-label': 'Find another block', onclick: () => import('../ui/find-block.js').then((m) => m.openFindBlock(store)) }, icon('search', { size: 16 }), h('span', null, ''));
  const root = E('lc-root', 'div', { dataset: { ps: 'lot-card-root' } }, head, findPill, card, rooms, pager, mini);
  host.append(root);

  // State -------------------------------------------------------------------------------------------------------------------------
  let designs = [];
  let designsKey = null;
  let loading = false;
  let raf = 0;
  let disposed = false;

  const app = () => getApp() || {};
  const builderName = () => app().builder?.name || '';
  const uiPlaced = () => store.ui.placedDesign || null;

  function lotKey() {
    const lot = lotOf(store.project);
    if (!lot) return null;
    return `${lot.lotLabel}|${lot.areaM2}|${(lot.envelope || []).length}|${(lot.frontEdges || []).join(',')}|${lot.setbacksKey || ''}|${app().lotDesigns ? 'p' : 'c'}`;
  }

  async function loadDesigns() {
    const key = lotKey();
    if (!key || key === designsKey || loading) return;
    loading = true;
    try {
      const provider = app().lotDesigns;
      const list = provider ? await provider(store.project) : publicDesigns(catalogue, store.project);
      if (disposed) return;
      designs = Array.isArray(list) ? list : [];
      designsKey = key;
    } catch (e) {
      console.warn('[lotcard] designs unavailable', e?.message);
      designs = [];
      designsKey = key;
    } finally {
      loading = false;
    }
    schedule();
  }

  function step(dir) {
    if (designs.length < 2) return;
    const i = stepIndex(designs.length, currentIndex(designs, store.project, uiPlaced()), dir);
    const d = designs[i];
    selTab = 'aerial';
    bedI = 0;
    go('aerial');
    try {
      const { fits } = swapHouse(store, d.project, { id: d.id, name: d.name });
      store.setUI({ placedDesign: { id: d.id, name: d.name } });
      if (fits === false) toast(`${d.name} does not fit inside the setbacks on this lot.`, { kind: 'info' });
    } catch (e) {
      toast(e?.message || 'That design could not be placed.', { kind: 'error' });
    }
  }

  function setScheme(id) {
    if (effectiveSchemeId(store.project) === id) return;
    store.apply('Colour scheme', (p) => { p.colourScheme = id; });
  }

  // The PDF button opens the whole plan set (the engineering exporter has no single sheet output). It goes through the same PDF plan set, entitlement and paywall as the top bar: builder staff are entitled, a client
  // only when the builder allows PDF exports, the public app needs the Plan Pack (the preview shows the sheets, Unlock opens the offer).
  function sitePlanPdf() {
    const prem = app().premium;
    if (!prem?.previewPdf) { toast('The plan set PDF comes with the Plan Pack.', { kind: 'info' }); return; }
    const portal = prem.state?.portal;
    if (portal && Array.isArray(portal.exports) && !portal.exports.includes('pdf')) { toast('Your builder provides the PDF plans. Ask them if you need one.', { kind: 'info' }); return; }
    prem.previewPdf();
  }

  // Tabs come from the room engine (one grouped Bedrooms tab). Bedrooms cycles through the individual bedrooms: master first, then the
  // others, one per click. The engine's own per bedroom tab (master, bed2 ...) supplies the pose and the caption.
  let tabs = [];
  let selTab = 'aerial';
  let bedI = 0;
  const bedTabs = () => listRoomTabs(store.project, null).filter((t) => t.bedN > 0);
  const viewerNow = async () => getViewer() || (await getViewer.ensure?.().catch(() => null)) || null;
  const targetTab = () => (selTab === 'bedrooms' ? bedTabs()[bedI] : tabs.find((t) => t.id === selTab));
  async function go(id) {
    const v = await viewerNow();
    if (v?.snapToRoom) await v.snapToRoom(id, { duration: 1.1, site: id === 'aerial' }).catch(() => {});
  }
  function pickTab(id) {
    if (id === 'bedrooms') {
      const beds = bedTabs();
      bedI = selTab === 'bedrooms' ? (bedI + 1) % Math.max(1, beds.length) : 0;
      selTab = 'bedrooms';
      schedule();
      if (beds[bedI]) go(beds[bedI].id);
      return;
    }
    selTab = id;
    schedule();
    go(id);
  }
  function pickRoom(roomId) {
    const beds = bedTabs();
    const bi = beds.findIndex((t) => t.roomIds.includes(roomId));
    if (bi >= 0) { selTab = 'bedrooms'; bedI = bi; schedule(); go(beds[bi].id); return; }
    const tab = tabs.find((x) => x.roomIds.includes(roomId));
    if (tab) pickTab(tab.id);
    else { selTab = 'aerial'; schedule(); go(roomId); }
  }

  function toggle2d() { if (embed) { mini.classList.toggle('is-big'); setTimeout(sizeInset, 50); return; } if (onMini) { onMini(); return; } store.setUI({ view: store.ui.view === 'split' ? '3d' : 'split' }); }

  // Rendering ---------------------------------------------------------------------------------------------------------------------
  const schemeChip = (s) => {
    const sw = h('span', { class: 'lc-sw' });
    sw.style.setProperty('--r', s.roof);
    sw.style.setProperty('--w', s.wall || '#cfc9bd');
    return h('button', { class: 'lc-chip', type: 'button', title: s.id === 'standard' ? 'Standard colours' : `${s.roofName} roof, ${s.wallName} walls`, 'aria-label': s.name, 'aria-pressed': 'false', dataset: { scheme: s.id }, onclick: () => setScheme(s.id) }, sw);
  };
  for (const s of SCHEMES) chips.append(schemeChip(s));

  function render() {
    raf = 0;
    if (disposed) return;
    const p = store.project;
    const lot = lotOf(p);
    const view = store.ui.view;
    // Not while the placement panel is open (it uses the bottom of the stage), nor in walk mode.
    const show = !!lot && hasBuilding(p) && view !== 'walk' && !host.querySelector('.pas-pose');
    root.hidden = !show;
    root.dataset.view = view;
    viewerHost.classList.toggle('lc-on', show && (view === '3d' || view === 'split'));
    viewerHost.classList.toggle('lc-full', show && view === '3d');
    layoutClasses();
    if (!show) { getViewer()?.setInset?.({}); app().editor?.setInset?.({}); return; }
    loadDesigns();

    const idx = currentIndex(designs, p, uiPlaced());
    const placed = uiPlaced() || p.placedHouse || null;
    const name = (designs.length && designs[idx]?.name) || placed?.name || p.name || 'House design';
    const sid = effectiveSchemeId(p);
    const scheme = schemeById(sid);
    headT.textContent = lotHeading(lot);
    headS.textContent = mutedLine(builderName());
    title.textContent = name;
    sub.replaceChildren(h('span', null, lotLine(lot)), h('span', { class: 'lc-sc' }, schemeLine(scheme)));
    stats.replaceChildren(...cardStats(p).map((c) => h('div', { dataset: { stat: c.key } }, h('b', null, c.value), h('i', null, c.label))));
    for (const b of chips.children) b.setAttribute('aria-pressed', String(b.dataset.scheme === sid));

    const line = setbackStatusLine(p);
    fit.hidden = line.state === 'none';
    fit.dataset.state = line.state;
    fit.replaceChildren(h('span', { class: 'lc-dot', style: { background: DOT[line.state] || 'transparent' } }), line.text);

    tabs = listRoomTabs(p, null, { groupBedrooms: true });
    if (!tabs.some((t) => t.id === selTab)) selTab = 'aerial';
    root.dataset.room = selTab === 'aerial' ? '0' : '1';
    const mkTab = (t) => h('button', { class: 'lc-tab', type: 'button', role: 'tab', title: t.caption || '', 'aria-selected': String(t.id === selTab), dataset: { tab: t.id }, onclick: () => pickTab(t.id) }, t.label);
    tabsEl.replaceChildren(...tabs.map(mkTab));
    tabsCompact.replaceChildren(...tabs.map(mkTab));
    findPill.lastChild.textContent = `${lot.address || lot.lotLabel || 'Find my block'}${lot.areaM2 ? ` · ${Math.round(lot.areaM2).toLocaleString('en-AU')} m²` : ''}`;
    const cur = targetTab() || tabs.find((t) => t.id === 'aerial');
    cap.textContent = cur?.caption || '';
    rooms.hidden = tabs.length < 2;
    drawPlan(p, cur);

    pager.hidden = designs.length < 2;
    pgT.textContent = pagerText(designs, idx, placed?.name || p.name || '');
    drawMini(p, lot);
    sizeInset();
  }
  function layoutClasses() {
    const w = host.clientWidth;
    const compact = w < COMPACT_W;
    root.classList.toggle('is-compact', compact);
    root.classList.toggle('is-phone', w < PHONE_W);
    viewerHost.classList.toggle('lc-compact', compact);
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(render); }

  function drawPlan(p, cur) {
    const m = roomsPlanModel(p, 150, 100);
    plan.setAttribute('viewBox', `0 0 ${m.w} ${m.h}`);
    const ns = 'http://www.w3.org/2000/svg';
    const on = new Set(cur?.roomIds || []);
    plan.replaceChildren(...m.rooms.map((r) => {
      const el = document.createElementNS(ns, 'polygon');
      el.setAttribute('points', r.points);
      el.setAttribute('class', `lc-room${on.has(r.id) ? ' is-on' : ''}`);
      el.dataset.room = r.id;
      const t = document.createElementNS(ns, 'title');
      t.textContent = r.name;
      el.append(t);
      el.addEventListener('click', () => pickRoom(r.id));
      return el;
    }));
  }

  // Real aerial under the lot when the lot has one stored in the browser (same image the 3D ground uses); otherwise a light schematic.
  let miniAerial = { key: null, img: null, loading: null };
  function ensureMiniAerial(p, lot) {
    const key = lot?.aerial?.extent && lot.aerial.key && lot.layers?.aerial !== false ? lot.aerial.key : null;
    if (!key) { miniAerial = { key: null, img: null, loading: null }; return null; }
    if (miniAerial.key === key) return miniAerial.img;
    miniAerial = { key, img: null, loading: key };
    import('../editor2d/underlay.js')
      .then((m) => m.loadImageBlob(key))
      .then((blob) => (blob && typeof createImageBitmap === 'function' ? createImageBitmap(blob) : null))
      .then((bmp) => { if (disposed || miniAerial.key !== key) return; miniAerial.img = bmp || null; miniAerial.loading = null; if (bmp) drawMini(p, lot); })
      .catch(() => { if (miniAerial.key === key) miniAerial.loading = null; });
    return null;
  }

  function drawMini(p, lot) {
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const W = cv.width;
    const H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#e8ece7';
    ctx.fillRect(0, 0, W, H);
    const pts = lot.boundary || [];
    if (pts.length < 3) return;
    const xs = pts.map((q) => q.x);
    const ys = pts.map((q) => q.y);
    const pad = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.32;
    const minX = Math.min(...xs) - pad; const maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad; const maxY = Math.max(...ys) + pad;
    const k = Math.min(W / (maxX - minX), H / (maxY - minY));
    const ox = (W - (maxX - minX) * k) / 2 - minX * k;
    const oy = (H - (maxY - minY) * k) / 2 - minY * k;
    const path = (ring) => { ctx.beginPath(); ring.forEach((q, i) => (i ? ctx.lineTo(q.x * k + ox, q.y * k + oy) : ctx.moveTo(q.x * k + ox, q.y * k + oy))); ctx.closePath(); };
    miniT = { k, ox, oy };
    const img = ensureMiniAerial(p, lot);
    const ex = lot.aerial?.extent;
    const hasImg = !!(img && ex);
    if (hasImg) {
      try { ctx.drawImage(img, ex.x0 * k + ox, ex.y0 * k + oy, (ex.x1 - ex.x0) * k, (ex.y1 - ex.y0) * k); } catch { /* fall through to the schematic look */ }
    }
    for (const n of lot.neighbours || []) {
      if (!Array.isArray(n.ring) || n.ring.length < 3) continue;
      path(n.ring);
      if (!hasImg) { ctx.fillStyle = n.isRoad ? '#cfd4d8' : '#f6f7f4'; ctx.fill(); }
      ctx.strokeStyle = hasImg ? 'rgba(255,255,255,.55)' : 'rgba(60,70,80,.28)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    if (!hasImg) { path(pts); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fill(); }
    if (Array.isArray(lot.envelope) && lot.envelope.length >= 3) {
      path(lot.envelope);
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = hasImg ? 'rgba(255,255,255,.95)' : 'rgba(40,50,60,.7)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    path(pts);
    ctx.strokeStyle = '#e53935';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const col = schemeColours(p);
    for (const ring of buildingRings(p)) {
      if (ring.length < 3) continue;
      path(ring);
      ctx.fillStyle = col?.roof || '#6b7178';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (canMoveHouse(p)) {
      const ring = ringOf(p, miniRot);
      if (ring) {
        ctx.beginPath();
        ctx.arc(ring.centre.x * k + ox, ring.centre.y * k + oy, ring.radius * k, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(199,162,86,.8)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ring.handle.x * k + ox, ring.handle.y * k + oy, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#c7a256';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
  }

  // Top view: drag the house to move it (kept inside the lot), drag the gold handle to turn it (Shift snaps to 15 degrees); two fingers twist.
  // The 3D view follows live: each step replaces the previous one, so the whole drag is one undo step. Same moves as the 2D Move house tool.
  let miniT = null;
  let miniRot = 0;
  const ptrs = new Map();
  let md = null;
  const canvasPt = (e) => {
    const r = cv.getBoundingClientRect();
    const sx = ((e.clientX - r.left) * cv.width) / Math.max(1, r.width);
    const sy = ((e.clientY - r.top) * cv.height) / Math.max(1, r.height);
    return miniT ? { sx, sy, x: (sx - miniT.ox) / miniT.k, y: (sy - miniT.oy) / miniT.k } : null;
  };
  const handleHit = (pt) => {
    const ring = ringOf(store.project, miniRot);
    if (!ring || !pt) return null;
    const hx = ring.handle.x * miniT.k + miniT.ox;
    const hy = ring.handle.y * miniT.k + miniT.oy;
    return Math.hypot(hx - pt.sx, hy - pt.sy) <= 14 ? ring : null;
  };
  const onHouseHull = (pt) => {
    if (onHouse(store.project, pt)) return true;
    const hull = buildingHull(store.project);
    return hull.length >= 3 && G.pointInPolygon(pt, hull);
  };
  const insideLot = (hull, boundary, dx, dy) => hull.every((q) => G.pointInPolygon({ x: q.x + dx, y: q.y + dy }, boundary));
  let flushT = 0;
  function applyDrag(final = false) {
    if (!md) return;
    const now = performance.now();
    if (!final && now - flushT < 70) { if (!md.raf) md.raf = setTimeout(() => { md && (md.raf = 0); applyDrag(); }, 70); return; }
    flushT = now;
    const key = md.mode === 'move' ? `${md.dx}|${md.dy}` : `${md.deg}`;
    if (key === md.key) return;
    md.key = key;
    if (md.applied) store.undo();
    md.applied = false;
    if (md.mode === 'move' ? (!md.dx && !md.dy) : !md.deg) return;
    if (md.mode === 'move') store.apply('Move house', (q) => translateHouse(q, md.dx, md.dy));
    else store.apply('Rotate house', (q) => rotateHouse(q, md.deg, md.centre));
    md.applied = true;
  }
  function endDrag() {
    if (!md) return;
    clearTimeout(md.raf);
    applyDrag(true);
    if (md.mode !== 'move' && md.applied) miniRot = (((miniRot + md.deg) % 360) + 360) % 360;
    if (md.moved) suppressClick = true;
    md = null;
    schedule();
  }
  function beginTwist() {
    endDrag();
    const [a, b] = [...ptrs.values()];
    const ring = ringOf(store.project, miniRot);
    if (!ring) return;
    md = { mode: 'turn', centre: ring.centre, a0: (Math.atan2(b.sy - a.sy, b.sx - a.sx) * 180) / Math.PI, total: 0, prev: null, deg: 0, moved: true, twist: true, key: '', applied: false, raf: 0 };
  }
  mini.style.touchAction = 'none';
  mini.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || !miniT || !canMoveHouse(store.project)) return;
    const pt = canvasPt(e);
    ptrs.set(e.pointerId, pt);
    if (ptrs.size === 2 && e.pointerType === 'touch') { beginTwist(); e.preventDefault(); return; }
    if (ptrs.size > 1) return;
    const ring = handleHit(pt);
    if (ring) md = { mode: 'turn', centre: ring.centre, a0: (Math.atan2(pt.sy - (ring.centre.y * miniT.k + miniT.oy), pt.sx - (ring.centre.x * miniT.k + miniT.ox)) * 180) / Math.PI, total: 0, prev: null, deg: 0, moved: false, sx: pt.sx, sy: pt.sy, key: '', applied: false, raf: 0 };
    else if (onHouseHull(pt)) md = { mode: 'move', x0: pt.x, y0: pt.y, dx: 0, dy: 0, moved: false, sx: pt.sx, sy: pt.sy, hull: buildingHull(store.project), key: '', applied: false, raf: 0 };
    else return;
    try { mini.setPointerCapture(e.pointerId); } catch { /* no capture */ }
    e.preventDefault();
  });
  mini.addEventListener('pointermove', (e) => {
    const pt = canvasPt(e);
    if (!pt) return;
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, pt);
    if (!md) {
      if (canMoveHouse(store.project) && e.pointerType !== 'touch') mini.style.cursor = handleHit(pt) ? 'grab' : onHouseHull(pt) ? 'move' : '';
      return;
    }
    if (md.twist) {
      if (ptrs.size < 2) return;
      const [a, b] = [...ptrs.values()];
      let d = (Math.atan2(b.sy - a.sy, b.sx - a.sx) * 180) / Math.PI - md.a0;
      d = ((d + 540) % 360) - 180;
      md.total = md.prev == null ? d : md.total + (((d - md.prev + 540) % 360) - 180);
      md.prev = d;
      md.deg = turnAngle(md.total, false);
      applyDrag();
      return;
    }
    if (!md.moved) { if (Math.hypot(pt.sx - md.sx, pt.sy - md.sy) < 3) return; md.moved = true; mini.style.cursor = 'grabbing'; }
    if (md.mode === 'move') {
      const snap = (v) => Math.round(v / 50) * 50;
      const dx = snap(pt.x - md.x0);
      const dy = snap(pt.y - md.y0);
      const lot = lotOf(store.project);
      const b = lot?.boundary;
      const startsInside = !b || insideLot(md.hull, b, 0, 0);
      let nx = md.dx; let ny = md.dy;
      if (!b || !startsInside || insideLot(md.hull, b, dx, dy)) { nx = dx; ny = dy; }
      else if (insideLot(md.hull, b, dx, md.dy)) nx = dx;
      else if (insideLot(md.hull, b, md.dx, dy)) ny = dy;
      md.dx = nx; md.dy = ny;
    } else {
      const c = { x: md.centre.x * miniT.k + miniT.ox, y: md.centre.y * miniT.k + miniT.oy };
      let d = (Math.atan2(pt.sy - c.y, pt.sx - c.x) * 180) / Math.PI - md.a0;
      d = ((d + 540) % 360) - 180;
      md.total = md.prev == null ? d : md.total + (((d - md.prev + 540) % 360) - 180);
      md.prev = d;
      md.deg = turnAngle(md.total, e.shiftKey);
    }
    applyDrag();
  });
  const up = (e) => { ptrs.delete(e.pointerId); if (!md || !(md.twist ? ptrs.size < 2 : true)) return; endDrag(); mini.style.cursor = ''; };
  mini.addEventListener('pointerup', up);
  mini.addEventListener('pointercancel', up);


  // The camera frames the lot in the clear area: card on the left and minimap on the right when there is room, else the card height
  // at the bottom (phone width, where the card collapses to a title and the actions).
  function insetOver(target, els) {
    const vr = target.getBoundingClientRect();
    const inset = { left: 0, right: 0, bottom: 0, top: 0 };
    if (target.hidden || vr.width < 2 || vr.height < 2) return inset;
    for (const el of els) {
      if (el === head || el.hidden || getComputedStyle(el).display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.right <= vr.left || r.left >= vr.right || r.bottom <= vr.top || r.top >= vr.bottom) continue;
      const cx = (r.left + r.right) / 2 - vr.left;
      const nearTop = r.top - vr.top < vr.height / 3;
      if (nearTop) inset.top = Math.max(inset.top, r.bottom - vr.top + 6);
      else if (cx < vr.width * 0.3 && r.width < vr.width * 0.6) inset.left = Math.max(inset.left, r.right - vr.left + 16);
      else if (cx > vr.width * 0.75 && r.width < vr.width * 0.4) inset.right = Math.max(inset.right, vr.right - r.left + 16);
      else inset.bottom = Math.max(inset.bottom, vr.bottom - r.top + 8);
    }
    return inset;
  }
  function sizeInset() {
    const v = getViewer();
    const ed = app().editor;
    if (root.hidden) { ed?.setInset?.({}); return; }
    const els = [card, rooms, pager, mini, head];
    // 3D: framed in what the cards leave clear. 2D and split: the plan is framed the same way, so the lot is not under the card.
    if (v?.setInset) v.setInset(root.dataset.view === '2d' ? {} : insetOver(viewerHost, els));
    const view = root.dataset.view;
    ed?.setInset?.(ed.element && (view === '2d' || view === 'split') ? insetOver(ed.element, els) : {});
  }

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { layoutClasses(); sizeInset(); }) : null;
  ro?.observe(host);
  ro?.observe(viewerHost);
  layoutClasses();
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(() => schedule()) : null;
  mo?.observe(host, { childList: true });
  const offs = [store.on('project', schedule), store.on('ui', (patch = {}) => { schedule(); if ('view' in patch) setTimeout(sizeInset, 700); })];
  const onAerial = () => { selTab = 'aerial'; bedI = 0; schedule(); };
  window.addEventListener('ps:room-aerial', onAerial);
  schedule();
  return {
    el: root, render, step, setScheme, sitePlanPdf,
    get designs() { return designs; },
    dispose() { disposed = true; window.removeEventListener('ps:room-aerial', onAerial); offs.forEach((o) => o?.()); ro?.disconnect(); mo?.disconnect(); root.remove(); },
  };
}
