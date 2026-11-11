// Embed viewer mode: the app opens as the cinematic single lot 3D view (lot card, design carousel, top view inset) and nothing else.
// Used by the home page frame (?embed=1 or ?view=viewer). Also the shared "find an address and load it" flow, which both modes use
// for ?address= and which the viewer runs for a gi:find-address message from the page around it.
//
//   parent -> app   { type: 'gi:find-address', address }       same origin parent only
//   app -> parent   { type: 'gi:ready' }                         the demo lot is on screen
//   app -> parent   { type: 'gi:status', state: 'loading' | 'done' | 'error', message?, address? }

import { h } from './dom.js';
import { searchAddresses } from '../site/client.js';
import { applySiteLookup } from '../site/apply.js';
import { demoSite } from '../site/demo-lot.js';
import { publicDesigns } from '../lotcard/designs.js';
import { swapHouse, poseFor } from '../lotcard/swap.js';

export const FULL_EDITOR_PATH = '/plan-studio/app/';
const PREFER = ['house_single', 'house_double', 'duplex', 'granny_flat'];

/** True for ?embed=1 or ?view=viewer (not the older ?embed=demo teaser, which keeps the full editor). */
export function viewerEmbedRequested(search = typeof location !== 'undefined' ? location.search : '') {
  const p = new URLSearchParams(search);
  return p.get('embed') === '1' || p.get('view') === 'viewer';
}

export const addressFromSearch = (search = typeof location !== 'undefined' ? location.search : '') => (new URLSearchParams(search).get('address') || '').trim().slice(0, 160);

/** The full editor URL, carrying the address of a loaded real lot (the demo lot has none). */
export function fullEditorUrl(project) {
  const lot = project?.site?.lot;
  const a = lot && lot.lotLabel !== 'Sample lot' ? String(lot.address || '').trim() : '';
  return a ? `${FULL_EDITOR_PATH}?address=${encodeURIComponent(a)}` : FULL_EDITOR_PATH;
}

const inFrame = () => { try { return window.parent !== window; } catch { return true; } };
export function postToParent(msg) {
  if (!inFrame()) return;
  try { window.parent.postMessage(msg, location.origin); } catch { /* the parent is gone or cross origin */ }
}

function waitForEnvelope(store, ms = 5000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      const l = store.project.site?.lot;
      if (!l || (Array.isArray(l.envelope) && l.envelope.length >= 3) || l.setbacksStatus === 'error' || l.setbacksStatus === 'none' || Date.now() - t0 > ms) { resolve(); return; }
      setTimeout(tick, 100);
    };
    setTimeout(tick, 300);
  });
}

// viewer: the clean cinematic look (no site labels over the view, neighbouring houses shown), as on the concept models.
function confirmFrontage(store, viewer = false) {
  if (store.project.site?.lot) {
    store.apply('Confirm frontage', (p) => {
      const lot = p.site.lot;
      if (!lot) return;
      lot.frontageConfirmed = true;
      if (viewer) lot.layers = { ...(lot.layers || {}), labels: false, dimensions: false, houses: true };
    });
  }
  store.setUI({ frontageEdit: false });
}

const hasEnvelope = (store) => { const e = store.project.site?.lot?.envelope; return Array.isArray(e) && e.length >= 3; };
const lotId = (store) => { const l = store.project.site?.lot; return l ? `${l.origin?.e}|${l.origin?.n}|${l.lotLabel}` : null; };

/** Put a Glide library design on the lot: the one named by `wantId` when it sits inside the setbacks, else the first house, duplex or granny flat that does. */
function placeOnce(store, catalogue, wantId) {
  const list = publicDesigns(catalogue, store.project);
  if (!list.length) return null;
  const ok = (d) => !d.fit || d.fit.status !== 'too-big';
  const sits = (d) => { try { return poseFor(store.project, d.project).fits === true; } catch { return false; } };
  const order = [...(wantId ? [wantId] : []), ...PREFER, ...list.map((d) => d.id)].map((id) => list.find((d) => d.id === id)).filter(Boolean);
  const pick = order.find((d) => ok(d) && sits(d)) || order.find(ok) || list[0];
  swapHouse(store, pick.project, { id: pick.id, name: pick.name });
  store.setUI({ placedDesign: { id: pick.id, name: pick.name } });
  return pick;
}

/**
 * Place a design now so the first frame has a house, then, once the council setbacks have loaded (they arrive a moment later),
 * place it again so it sits inside them. The second pass is skipped when the lot has been replaced in the meantime.
 */
export async function placeBestDesign(store, catalogue, wantId = null, { after = null } = {}) {
  const first = placeOnce(store, catalogue, wantId);
  if (hasEnvelope(store)) return first;
  const id = lotId(store);
  waitForEnvelope(store, 25000).then(() => {
    if (lotId(store) !== id || !hasEnvelope(store)) return;
    try { placeOnce(store, catalogue, store.ui.placedDesign?.id || wantId); after?.(); } catch (e) { console.warn('[embed] placement failed', e); }
  });
  return first;
}

/**
 * Find my block without any dialogs: look the address up, take the first result, load the lot, accept the detected frontage and
 * place the current design. Throws a readable Error when the address is not found.
 */
export async function loadAddress(store, catalogue, address, { onStep, viewer = false, after = null } = {}) {
  const q = String(address || '').trim();
  if (q.length < 3) throw new Error('Type a street address first.');
  const results = await searchAddresses(q);
  const pick = results[0];
  if (!pick) throw new Error('No matching address found. Check the spelling, or try the street name and suburb.');
  const wantId = store.ui.placedDesign?.id || null;
  const { lot, warnings } = await applySiteLookup(store, pick, { onStep });
  confirmFrontage(store, viewer);
  await placeBestDesign(store, catalogue, wantId, { after });
  return { lot, warnings, pick };
}

/** The demo lot with a Glide design placed: what the home page frame shows first. */
export async function loadDemo(store, catalogue, { after = null } = {}) {
  await applySiteLookup(store, { label: '' }, { prefetched: demoSite() });
  confirmFrontage(store, true);
  return placeBestDesign(store, catalogue, null, { after });
}

/**
 * Wire the viewer mode. `ctx`: { store, catalogue, shell, viewerMode }. Returns { run(address), dispose }.
 * In viewer mode the view is pinned to 3D and walk, and the page may send gi:find-address.
 */
export function initEmbedViewer({ store, catalogue, shell, viewerMode, getViewer = () => null }) {
  let busy = false;
  let pending = null;
  let off = null;

  const settle = () => {
    busy = false;
    delete shell.dataset.embedBusy;
    if (pending != null) { const a = pending; pending = null; run(a); }
  };

  // The whole lot from above (the lot card's Aerial pill), the first frame of the cinematic view.
  async function aerial() {
    try {
      const v = getViewer() || (await getViewer.ensure?.());
      await v?.snapToRoom?.('aerial', { duration: 0.01, site: true });
    } catch { /* the viewer keeps its own framing */ }
  }

  const settleAerial = () => setTimeout(aerial, 900);

  async function run(address) {
    if (busy) { pending = address; return; }
    busy = true;
    shell.dataset.embedBusy = '1';
    postToParent({ type: 'gi:status', state: 'loading', address });
    try {
      const r = await loadAddress(store, catalogue, address, { viewer: viewerMode, after: viewerMode ? settleAerial : null });
      if (viewerMode) { store.setUI({ view: '3d' }); await aerial(); }
      postToParent({ type: 'gi:status', state: 'done', address: r.lot?.address || address });
    } catch (e) {
      postToParent({ type: 'gi:status', state: 'error', message: e?.message || 'The address could not be loaded.', address });
    } finally {
      settle();
    }
  }

  /** Load the demo lot (viewer mode, no ?address=). A search sent meanwhile waits and then replaces it. */
  async function startDemo() {
    busy = true;
    shell.dataset.embedBusy = '1';
    try {
      await loadDemo(store, catalogue, { after: settleAerial });
      store.setUI({ view: '3d' });
      await aerial();
      postToParent({ type: 'gi:ready' });
    } catch (e) {
      console.warn('[embed] demo lot failed', e);
      postToParent({ type: 'gi:ready' });
    } finally {
      settle();
    }
  }

  const onMessage = (ev) => {
    if (ev.origin !== location.origin || ev.source !== window.parent) return;
    const m = ev.data;
    if (!m || typeof m !== 'object' || m.type !== 'gi:find-address' || typeof m.address !== 'string') return;
    run(m.address.slice(0, 160));
  };
  window.addEventListener('message', onMessage);

  if (viewerMode) {
    // The cinematic view is the whole app here: the plan and split views are not reachable.
    off = store.on('ui', (patch = {}) => {
      if ('view' in patch && patch.view !== '3d' && patch.view !== 'walk') store.setUI({ view: '3d' });
    });
  }
  return { run, startDemo, dispose: () => { window.removeEventListener('message', onMessage); off?.(); } };
}

/** Open the full editor in the top window (a new tab when the frame is not allowed to navigate the page). */
export function openFullEditor(project) {
  const url = fullEditorUrl(project);
  try {
    (window.top || window).location.assign(url);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

/** The "Open full editor" link (top right) and a small loading note, over the 3D view. */
export function mountViewerChrome(stage, store) {
  const link = h('a', { class: 'ps-embed-full', href: FULL_EDITOR_PATH, target: '_top', dataset: { ps: 'embed-full' }, onclick: (e) => { e.preventDefault(); openFullEditor(store.project); } }, 'Open full editor', h('span', { 'aria-hidden': 'true' }, ' \u2197'));
  const busy = h('div', { class: 'ps-embed-busy', role: 'status', 'aria-live': 'polite' }, 'Loading your block');
  stage.append(link, busy);
  const sync = () => { link.href = fullEditorUrl(store.project); };
  store.on('project', sync);
  sync();
  return { link, busy };
}
