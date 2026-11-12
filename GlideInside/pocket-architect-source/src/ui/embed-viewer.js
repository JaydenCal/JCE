// Embed viewer mode: the app opens as the cinematic single lot 3D view (lot card, design carousel, top view inset) and nothing else.
// Used by the home page frame (?embed=1 or ?view=viewer). Also the shared "find an address and load it" flow, which both modes use
// for ?address= and which the viewer runs for a gi:find-address message from the page around it.
//
//   parent -> app   { type: 'gi:find-address', address }       same origin parent only
//   app -> parent   { type: 'gi:ready' }                         the app is listening for gi:find-address
//   app -> parent   { type: 'gi:status', state: 'loading' | 'done' | 'error', message?, address? }

import { h } from './dom.js';
import { toast } from './toast.js';
import { CONFIG } from '../config.js';
import { migrate } from '../model/schema.js';
import { searchAddresses } from '../site/client.js';
import { applySiteLookup } from '../site/apply.js';
import { demoSite } from '../site/demo-lot.js';
import { publicDesigns } from '../lotcard/designs.js';
import { swapHouse, poseFor } from '../lotcard/swap.js';
import { computeSetbacks } from '../site/setback-stage.js';
import { setbackStatusLine } from '../site/lot-checks.js';

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

export const EMPTY_LIBRARY = 'Your builder has not added house designs yet. Ask them to add one, or draw your own with Edit floor plan.';
const PORTAL_WAIT_MS = 5000;

/**
 * The designs the first placement chooses from. A signed in builder or client gets their own library, so the viewer opens on their own
 * first design (it waits for the sign in check and the library before placing anything). An empty library falls back to the generic
 * samples (`empty: true`, the caller says so). Anonymous visitors get the generic samples at once.
 */
export async function designPool(store, catalogue, app = typeof window !== 'undefined' ? window.__ps : null) {
  if (app?.portalReady) {
    let t;
    await Promise.race([Promise.resolve(app.portalReady).catch(() => null), new Promise((r) => { t = setTimeout(r, PORTAL_WAIT_MS); })]);
    clearTimeout(t);
  }
  if (app?.lotDesigns) {
    try {
      const own = await app.lotDesigns(store.project);
      if (Array.isArray(own) && own.length) return { list: own, own: true, empty: false };
      return { list: publicDesigns(catalogue, store.project), own: false, empty: true };
    } catch (e) { console.warn('[embed] the design library could not be loaded', e?.message); }
  }
  return { list: publicDesigns(catalogue, store.project), own: false, empty: false };
}

/** The design to place first from a ranked list: the one named by `wantId` when it sits inside the setbacks, else the best that does. */
export function pickFirstDesign(project, list, wantId = null) {
  if (!list.length) return null;
  const ok = (d) => !d.fit || d.fit.status !== 'too-big';
  const sits = (d) => { try { return poseFor(project, d.project).fits === true; } catch { return false; } };
  const order = [...(wantId ? [wantId] : []), ...PREFER, ...list.map((d) => d.id)].map((id) => list.find((d) => d.id === id)).filter(Boolean);
  return order.find((d) => ok(d) && sits(d)) || order.find(ok) || list[0];
}

const orderOf = (list, wantId) => [...(wantId ? [wantId] : []), ...PREFER, ...list.map((d) => d.id)].map((id) => list.find((d) => d.id === id)).filter((d, i, a) => d && a.indexOf(d) === i);

/**
 * The design to place first, judged against the setbacks it would actually have. The setbacks depend on the design (storeys, wall and
 * building height), so a design is tried against its own envelope, not the one computed for whatever was on the lot before. Every design
 * in the pool is tried (the one asked for first), each with every turn and position autoPose searches; the first that fits wins. When
 * none fits the best ranked one is chosen and the card reads "Too big for this block".
 * Returns { pick, fits, setbacks, envelope, key } (setbacks null when they cannot be worked out, then the placement is judged on what the
 * lot already carries), or null for an empty pool.
 */
export async function chooseDesign(store, pool, wantId = null, { compute = computeSetbacks } = {}) {
  const list = pool.list;
  if (!list.length) return null;
  const lot = store.project.site?.lot;
  const ok = (d) => !d.fit || d.fit.status !== 'too-big';
  const order = orderOf(list, wantId);
  const ranked = [...order.filter(ok), ...order.filter((d) => !ok(d))];
  const own = !!(lot && lot.source !== 'builder' && lot.frontageConfirmed && (lot.frontEdges || []).length);
  if (!own) return { pick: pickFirstDesign(store.project, list, wantId), fits: null, setbacks: null, envelope: null, key: null };
  let first = null;
  for (const d of ranked) {
    let r = null;
    try { r = await compute({ ...store.project, levels: d.project.levels }, lot); } catch { r = null; }
    if (!r?.setbacks || !r.envelope) { first = first || { pick: d, fits: null, setbacks: null, envelope: null, key: null }; continue; }
    const tmp = { ...store.project, site: { ...store.project.site, lot: { ...lot, setbacks: r.setbacks, envelope: r.envelope, setbacksKey: r.key } } };
    let fits = null;
    try { fits = poseFor(tmp, d.project).fits; } catch { fits = null; }
    const cand = { pick: d, fits, setbacks: r.setbacks, envelope: r.envelope, key: r.key, attempts: r.attempts };
    if (fits === true) return cand;
    first = first || cand;
  }
  return first || { pick: ranked[0], fits: null, setbacks: null, envelope: null, key: null };
}

/** Put the chosen design's own setbacks on the lot (derived data, no undo step), so the placement and the card agree with them. */
function writeSetbacks(store, choice) {
  const lot = store.project.site?.lot;
  if (!lot || !choice?.envelope) return;
  lot.setbacks = choice.setbacks;
  lot.envelope = choice.envelope;
  lot.setbacksKey = choice.key;
  lot.setbacksStatus = 'ok';
  lot.setbacksAttempts = [];
  store.emit('project', { label: 'setbacks' });
}

/** Put the chosen design on the lot. */
export function placeChoice(store, choice) {
  const pick = choice?.pick;
  if (!pick) return null;
  writeSetbacks(store, choice);
  swapHouse(store, pick.project, { id: pick.id, name: pick.name });
  store.setUI({ placedDesign: { id: pick.id, name: pick.name } });
  return pick;
}

/**
 * Place a design now so the first frame has a house that fits, judged against the setbacks of each design (see chooseDesign). When the
 * setbacks could not be worked out yet (they arrive a moment later), place one now and again once they have loaded. The second pass is
 * skipped when the lot has been replaced in the meantime.
 */
export async function placeBestDesign(store, catalogue, wantId = null, { after = null } = {}) {
  const id0 = lotId(store);
  const pool = await designPool(store, catalogue);
  if (lotId(store) !== id0) return null; // another lot was loaded while the library came in
  if (pool.empty) toast(EMPTY_LIBRARY, { kind: 'warn', timeout: 7000 });
  let choice = null;
  try { choice = await chooseDesign(store, pool, wantId); } catch (e) { console.warn('[embed] design choice failed', e); }
  if (lotId(store) !== id0) return null;
  if (!choice) return null;
  const first = placeChoice(store, choice);
  if (choice.envelope || hasEnvelope(store)) return first;
  const id = lotId(store);
  waitForEnvelope(store, 25000).then(async () => {
    if (lotId(store) !== id || !hasEnvelope(store)) return;
    try {
      const again = await chooseDesign(store, await designPool(store, catalogue), store.ui.placedDesign?.id || wantId);
      if (again && lotId(store) === id) { placeChoice(store, again); after?.(); }
    } catch (e) { console.warn('[embed] placement failed', e); }
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
  let pendingNotify = false;
  let off = null;

  const settle = () => {
    busy = false;
    delete shell.dataset.embedBusy;
    if (pending != null) { const a = pending; const n = pendingNotify; pending = null; pendingNotify = false; run(a, { notify: n }); }
  };

  // The whole lot from above (the lot card's Aerial pill), the first frame of the cinematic view.
  async function aerial() {
    try {
      const v = getViewer() || (await getViewer.ensure?.());
      v?.setEmbedFraming?.(true);
      await v?.snapToRoom?.('aerial', { duration: 0.01, site: true });
    } catch { /* the viewer keeps its own framing */ }
  }

  const settleAerial = () => setTimeout(aerial, 900);

  /** Load an address. Resolves true when it loaded, false when it failed, null when it was queued behind a lookup in progress.
   *  `notify`: the search came from the viewer's own pill, so a failure is shown here (a search sent by the page around it is reported to that page). */
  async function run(address, { notify = false } = {}) {
    if (busy) { pending = address; pendingNotify = notify; return null; }
    busy = true;
    shell.dataset.embedBusy = '1';
    postToParent({ type: 'gi:status', state: 'loading', address });
    try {
      const r = await loadAddress(store, catalogue, address, { viewer: viewerMode, after: viewerMode ? settleAerial : null });
      if (viewerMode) { store.setUI({ view: '3d' }); await aerial(); }
      postToParent({ type: 'gi:status', state: 'done', address: r.lot?.address || address });
      return true;
    } catch (e) {
      const message = e?.message || 'The address could not be loaded.';
      postToParent({ type: 'gi:status', state: 'error', message, address });
      if (notify) toast(message, { kind: 'error' });
      return false;
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
    } catch (e) {
      console.warn('[embed] demo lot failed', e);
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
  postToParent({ type: 'gi:ready' }); // the listener is on: a search sent now waits its turn behind the lot that is loading

  // Late setbacks (the council rules, or heights that changed): while the lot is new and the person has not touched it, a house that ends up
  // outside them is fitted again, at most twice per lot.
  let refitOff = null;
  if (viewerMode) {
    let refitLot = null;
    let refits = 0;
    let since = 0;
    let t = 0;
    const refit = async () => {
      const id = lotId(store);
      if (id !== refitLot) { refitLot = id; refits = 0; since = Date.now(); }
      if (busy || refits >= 2 || Date.now() - since > 40000 || !store.ui.placedDesign || store.project.placedHouse?.tooBig) return;
      if (setbackStatusLine(store.project).state !== 'outside') return;
      refits += 1;
      try { await placeBestDesign(store, catalogue, store.ui.placedDesign.id); } catch (e) { console.warn('[embed] refit failed', e); }
    };
    refitOff = store.on('project', (e) => { if (e?.label === 'setbacks') { clearTimeout(t); t = setTimeout(refit, 400); } });
  }

  if (viewerMode) {
    Promise.resolve(getViewer.ensure?.()).then((v) => v?.setEmbedFraming?.(true)).catch(() => {});
    // The cinematic view is the whole app here: the plan and split views are not reachable.
    off = store.on('ui', (patch = {}) => {
      if ('view' in patch && patch.view !== '3d' && patch.view !== 'walk') store.setUI({ view: '3d' });
    });
  }
  return { run, startDemo, dispose: () => { window.removeEventListener('message', onMessage); off?.(); refitOff?.(); } };
}

/** One-shot handoff slot: the viewer leaves the design here and the editor reads it once and clears it (src/app.js). The visitor's own autosave is never touched. */
export const HANDOFF_KEY = 'ps.handoff.v1';

const HANDOFF_MAX_AGE_MS = 10 * 60 * 1000;
const PREV_AUTOSAVE_KEY = 'ps.autosave.prev.v1';

/**
 * The design the home page viewer left for this editor (Edit floor plan, Open full editor). Read once and cleared. It never replaces the
 * visitor's own autosave silently: an earlier design with content is kept under PREV_AUTOSAVE_KEY and offered back in a toast.
 */
export function takeHandoff(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage) return null;
  let raw = null;
  try {
    raw = storage.getItem(HANDOFF_KEY);
    if (raw == null) return null;
    storage.removeItem(HANDOFF_KEY);
    const { at, project } = JSON.parse(raw);
    if (!project || !Array.isArray(project.levels) || Date.now() - Number(at || 0) > HANDOFF_MAX_AGE_MS) return null;
    const incoming = migrate(project);
    let previous = null;
    try {
      const old = storage.getItem(CONFIG.autosaveKey);
      if (old) {
        const prev = migrate(JSON.parse(old));
        if (prev.levels.some((l) => l.rooms.length || l.walls.length)) { storage.setItem(PREV_AUTOSAVE_KEY, old); previous = prev; }
      }
    } catch { /* an unreadable earlier autosave is not worth keeping */ }
    return { project: incoming, previous };
  } catch {
    try { storage?.removeItem(HANDOFF_KEY); } catch { /* storage blocked */ }
    return null;
  }
}

/** Open the full editor in the top window (a new tab when the frame is not allowed to navigate the page). */
export function openFullEditor(project) {
  let url = fullEditorUrl(project);
  try {
    if (project?.site?.lot && project.levels?.length) {
      localStorage.setItem(HANDOFF_KEY, JSON.stringify({ at: Date.now(), project }));
      url = FULL_EDITOR_PATH;
    }
  } catch { /* storage blocked: the address link still brings the lot */ }
  try {
    (window.top || window).location.assign(url);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

/** The "Open full editor" link (top right) and a small loading note, over the 3D view. */
export function mountViewerChrome(stage, store) {
  if (inFrame()) return { link: null, busy: stage.appendChild(h('div', { class: 'ps-embed-busy', role: 'status', 'aria-live': 'polite' }, 'Loading your block')) };
  const link = h('a', { class: 'ps-embed-full', href: FULL_EDITOR_PATH, target: '_top', dataset: { ps: 'embed-full' }, onclick: (e) => { e.preventDefault(); openFullEditor(store.project); } }, 'Open full editor', h('span', { 'aria-hidden': 'true' }, ' \u2197'));
  const busy = h('div', { class: 'ps-embed-busy', role: 'status', 'aria-live': 'polite' }, 'Loading your block');
  stage.append(link, busy);
  const sync = () => { link.href = fullEditorUrl(store.project); };
  store.on('project', sync);
  sync();
  return { link, busy };
}
