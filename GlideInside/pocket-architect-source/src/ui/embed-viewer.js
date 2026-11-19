// Embed viewer mode: the app opens as the cinematic single lot 3D view (lot card, design carousel, top view inset) and nothing else.
// Used by the home page frame (?embed=1 or ?view=viewer). Also the shared "find an address and load it" flow, which both modes use
// for ?address= and which the viewer runs for a gi:find-address message from the page around it.
//
//   parent -> app   { type: 'gi:find-address', address, pick? } same origin parent only; pick { label, state, lon, lat } is a suggestion the
//                                                              visitor chose, used as is (no second search)
//   app -> parent   { type: 'gi:ready' }                         the app is listening for gi:find-address
//   app -> parent   { type: 'gi:status', state: 'loading' | 'done' | 'error', message?, address?, retry? }

import { h } from './dom.js';
import { toast } from './toast.js';
import { CONFIG } from '../config.js';
import { migrate } from '../model/schema.js';
import { smartSearch, NOT_FOUND_TEXT } from '../site/address-search.js';
import { applySiteLookup } from '../site/apply.js';
import { demoSite } from '../site/demo-lot.js';
import { publicDesigns } from '../lotcard/designs.js';
import { swapHouse, poseFor } from '../lotcard/swap.js';
import { computeSetbacks } from '../site/setback-stage.js';
import { setbackStatusLine } from '../site/lot-checks.js';
import { defaultEnvelope } from '../site/default-setbacks.js';

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
  // A commercial design keeps its tool in the link, so an address link does not open the residential tool.
  const mode = project?.mode === 'commercial' ? 'mode=commercial&' : '';
  return a ? `${FULL_EDITOR_PATH}?${mode}address=${encodeURIComponent(a)}` : FULL_EDITOR_PATH;
}

/** Whether two address strings name the same place: case, commas, state, country and postcode are ignored, and a link that gives only the street part still matches. */
export const sameAddress = (a, b) => {
  const norm = (x) => String(x || '').toUpperCase().replace(/\b(NSW|QLD|VIC|TAS|SA|WA|NT|ACT|NEW SOUTH WALES|QUEENSLAND|VICTORIA|AUSTRALIA)\b/g, ' ').replace(/\b\d{4}\b$/, ' ').replace(/[^A-Z0-9]+/g, ' ').trim();
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(y + ' ') || y.startsWith(x + ' ');
};

const inFrame = () => { try { return window.parent !== window; } catch { return true; } };
export function postToParent(msg) {
  if (!inFrame()) return;
  if (typeof window !== 'undefined' && window.__ps?.widgetMode) return; // the website widget says nothing to the page around it
  try { window.parent.postMessage(msg, location.origin); } catch { /* the parent is gone or cross origin */ }
}

export function waitForEnvelope(store, ms = 5000) {
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
export function confirmFrontage(store, viewer = false) {
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
const WIDGET_WAIT_MS = 15000;

/**
 * The designs the first placement chooses from. A signed in builder or client gets their own library, so the viewer opens on their own
 * first design (it waits for the sign in check and the library before placing anything). An empty library falls back to the generic
 * samples (`empty: true`, the caller says so). Anonymous visitors get the generic samples at once.
 */
export async function designPool(store, catalogue, app = typeof window !== 'undefined' ? window.__ps : null) {
  if (app?.portalReady) {
    let t;
    await Promise.race([Promise.resolve(app.portalReady).catch(() => null), new Promise((r) => { t = setTimeout(r, app.widgetMode ? WIDGET_WAIT_MS : PORTAL_WAIT_MS); })]);
    clearTimeout(t);
  }
  // The website widget never falls back to the Glide Inside samples: the builder's designs, or nothing (the widget says it is not available).
  if (app?.widgetMode) {
    try { const own = await app.lotDesigns?.(store.project); return { list: Array.isArray(own) ? own : [], own: true, empty: false, widget: true }; } catch { return { list: [], own: true, empty: false, widget: true }; }
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
    // No council rule loaded (none for the zone, or the data would not read): fit against the default indicative envelope instead, so the
    // house is never left over a boundary. It is flagged `defaulted` and never shown as a confirmed setback.
    const defaulted = !r?.setbacks || !r.envelope;
    const envelope = defaulted ? defaultEnvelope(lot) : r.envelope;
    if (!envelope) { first = first || { pick: d, fits: null, setbacks: null, envelope: null, key: null }; continue; }
    const setbacks = defaulted ? null : r.setbacks;
    const key = r?.key || null;
    const tmp = { ...store.project, site: { ...store.project.site, lot: { ...lot, setbacks, envelope, setbacksKey: key } } };
    let fits = null;
    try { fits = poseFor(tmp, d.project).fits; } catch { fits = null; }
    const cand = { pick: d, fits, setbacks, envelope, key, defaulted, attempts: r?.attempts || [] };
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
  lot.setbacksDefault = !!choice.defaulted;
  lot.setbacksStatus = choice.defaulted ? 'none' : 'ok';
  lot.setbacksAttempts = choice.defaulted ? (choice.attempts || []).map((a) => ({ basis: a.basis || null, reason: String(a.reason || '').slice(0, 400) })) : [];
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
  // The widget opens on the builder's own first design when it sits on the block.
  const want = wantId || (pool.widget ? pool.list[0]?.id || null : null);
  try { choice = await chooseDesign(store, pool, want); } catch (e) { console.warn('[embed] design choice failed', e); }
  if (lotId(store) !== id0) return null;
  if (!choice) return null;
  const first = placeChoice(store, choice);
  if (choice.envelope || hasEnvelope(store)) return first;
  const id = lotId(store);
  waitForEnvelope(store, 25000).then(async () => {
    if (lotId(store) !== id || !hasEnvelope(store)) return;
    try {
      const again = await chooseDesign(store, await designPool(store, catalogue), store.ui.placedDesign?.id || want);
      if (again && lotId(store) === id) { placeChoice(store, again); after?.(); }
    } catch (e) { console.warn('[embed] placement failed', e); }
  });
  return first;
}

export const validPick = (p) => !!p && typeof p === 'object' && Number.isFinite(p.lon) && Number.isFinite(p.lat) && typeof p.label === 'string' && p.label.length > 0;

/**
 * Find my block without any dialogs: look the address up, take the first result, load the lot, accept the detected frontage and
 * place the current design. Throws a readable Error when the address is not found.
 */
export async function loadAddress(store, catalogue, address, { onStep, viewer = false, after = null, place = true, pick: given = null } = {}) {
  const q = String(address || '').trim();
  if (q.length < 3) throw new Error('Type a street address first.');
  // A suggestion the visitor already chose carries its coordinates: use it directly, no second search.
  const pick = validPick(given) ? given : (await smartSearch(q, { onRetry: () => onStep?.('busy') }))[0];
  if (!pick) throw Object.assign(new Error(NOT_FOUND_TEXT), { notFound: true });
  const wantId = store.ui.placedDesign?.id || null;
  const { lot, warnings } = await applySiteLookup(store, pick, { onStep });
  confirmFrontage(store, viewer);
  if (place) await placeBestDesign(store, catalogue, wantId, { after });
  return { lot, warnings, pick };
}

/** Commercial: look the address up, load the lot, accept the frontage, convert and place the Best fit layout (src/commercial/place.js). */
export async function loadAddressCommercial(store, address, { onStep, pick: given = null } = {}) {
  const q = String(address || '').trim();
  if (q.length < 3) throw new Error('Type a street address first.');
  // A suggestion the visitor already chose carries its coordinates: use it directly (as the residential viewer does), no second search.
  const pick = validPick(given) ? given : (await smartSearch(q, { onRetry: () => onStep?.('busy') }))[0];
  if (!pick) throw Object.assign(new Error(NOT_FOUND_TEXT), { notFound: true });
  const { lot, warnings } = await applySiteLookup(store, pick, { onStep });
  // The residential guided flow fetches the aerial again when the lookup left none (ensureFlowAerial); the commercial viewer never did, so a
  // lookup whose imagery request failed once stayed on the striped lawn with a greyed Aerial pill. Same recovery here.
  if (!store.project.site?.lot?.aerial?.extent) { try { const { ensureFlowAerial } = await import('../flow/flow-aerial.js'); await ensureFlowAerial(store); } catch { /* the lawn stays */ } }
  confirmFrontage(store, true);
  const { placeCommercial } = await import('../commercial/place.js');
  await placeCommercial(store);
  return { lot, warnings, pick };
}

/** Commercial demo: a sample E4 lot with the Best fit layout placed. */
export async function loadDemoCommercial(store) {
  await applySiteLookup(store, { label: '' }, { prefetched: demoSite({ commercial: true }) });
  confirmFrontage(store, true);
  const { placeCommercial } = await import('../commercial/place.js');
  return placeCommercial(store, { wait: 1500 });
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
export function initEmbedViewer({ store, catalogue, shell, viewerMode, getViewer = () => null, commercial = false }) {
  let busy = false;
  let pending = null;
  let pendingNotify = false;
  let pendingPick = null;
  let off = null;

  const settle = () => {
    busy = false;
    delete shell.dataset.embedBusy;
    // The widget shows nothing of the app's own sample house: the view stays covered until the builder's design is on the block.
    if (window.__ps?.widgetMode && store.ui.placedDesign) document.body.classList.remove('gw-widget-wait');
    if (pending != null) { const a = pending; const n = pendingNotify; const pk = pendingPick; pending = null; pendingNotify = false; pendingPick = null; run(a, { notify: n, pick: pk }); }
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
  async function run(address, { notify = false, pick = null } = {}) {
    if (busy) { pending = address; pendingNotify = notify; pendingPick = pick; return null; }
    busy = true;
    shell.dataset.embedBusy = '1';
    postToParent({ type: 'gi:status', state: 'loading', address });
    try {
      const r = commercial ? await loadAddressCommercial(store, address, { onStep: null, pick }) : await loadAddress(store, catalogue, address, { viewer: viewerMode, after: viewerMode ? settleAerial : null, pick });
      if (viewerMode) { store.setUI({ view: '3d' }); await aerial(); }
      postToParent({ type: 'gi:status', state: 'done', address: r.lot?.address || address });
      return true;
    } catch (e) {
      const message = e?.message || 'The address could not be loaded.';
      postToParent({ type: 'gi:status', state: 'error', message, address, retry: e?.code === 'SLOW' });
      // Not found: a sample lot is always offered, so the pill never just reverts.
      if (notify) toast(message, e?.notFound ? { kind: 'warn', timeout: 14000, action: { label: 'Try a sample lot', onClick: () => startDemo() } } : { kind: 'error' });
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
      if (commercial) await loadDemoCommercial(store); else await loadDemo(store, catalogue, { after: settleAerial });
      store.setUI({ view: '3d' });
      await aerial();
    } catch (e) {
      console.warn('[embed] demo lot failed', e);
    } finally {
      settle();
    }
  }

  const onMessage = (ev) => {
    if (window.__ps?.widgetMode) return; // and takes nothing from it
    if (ev.origin !== location.origin || ev.source !== window.parent) return;
    const m = ev.data;
    if (!m || typeof m !== 'object' || m.type !== 'gi:find-address' || typeof m.address !== 'string') return;
    const pk = m.pick && typeof m.pick === 'object' ? { label: String(m.pick.label || '').slice(0, 160), state: m.pick.state === 'QLD' ? 'QLD' : 'NSW', lon: Number(m.pick.lon), lat: Number(m.pick.lat) } : null;
    run(m.address.slice(0, 160), { pick: validPick(pk) ? pk : null });
  };
  window.addEventListener('message', onMessage);
  postToParent({ type: 'gi:ready' }); // the listener is on: a search sent now waits its turn behind the lot that is loading

  // Late setbacks (the council rules, or heights that changed): while the lot is new and the person has not touched it, a house that ends up
  // outside them is fitted again, at most twice per lot.
  let refitOff = null;
  if (viewerMode && commercial) {
    refitOff = null;
    import('../commercial/place.js').then((m) => { refitOff = m.watchRefit(store, { isBusy: () => busy }); });
  } else if (viewerMode) {
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
import { HANDOFF_KEY, PREV_AUTOSAVE_KEY } from '../toolmode.js';
export { HANDOFF_KEY };

const HANDOFF_MAX_AGE_MS = 10 * 60 * 1000;

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
  if (typeof window !== 'undefined' && window.__ps?.widgetMode) return; // the website widget has no route to the editor
  let url = fullEditorUrl(project);
  try {
    if (project?.site?.lot && project.levels?.length) {
      localStorage.setItem(HANDOFF_KEY, JSON.stringify({ at: Date.now(), project }));
      url = project.mode === 'commercial' ? `${FULL_EDITOR_PATH}?mode=commercial` : FULL_EDITOR_PATH;
    }
  } catch { /* storage blocked: the address link still brings the lot */ }
  try {
    (window.top || window).location.assign(url);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

/** The "Open full editor" link (top right) and a small loading note, over the 3D view. */
export function mountViewerChrome(stage, store, { widget = false } = {}) {
  // The builder's website widget never carries the link (not even hidden): it has no way to the full editor.
  if (widget || inFrame()) return { link: null, busy: stage.appendChild(h('div', { class: 'ps-embed-busy', role: 'status', 'aria-live': 'polite' }, 'Loading your block')) };
  const link = h('a', { class: 'ps-embed-full', href: FULL_EDITOR_PATH, target: '_top', dataset: { ps: 'embed-full' }, onclick: (e) => { e.preventDefault(); openFullEditor(store.project); } }, 'Open full editor', h('span', { 'aria-hidden': 'true' }, ' \u2197'));
  const busy = h('div', { class: 'ps-embed-busy', role: 'status', 'aria-live': 'polite' }, 'Loading your block');
  stage.append(link, busy);
  const sync = () => { link.href = fullEditorUrl(store.project); };
  store.on('project', sync);
  sync();
  return { link, busy };
}
