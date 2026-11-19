// Step 1 of both flows: Find your lot. Address search (NSW and QLD), then a confirm card: boundary map with aerial, area, frontage, zone and
// the setbacks status. The commercial flow adds a zone warning through `extra(project)`.

import { h } from '../ui/dom.js';
import { NOT_FOUND_TEXT, SEARCH_BUSY_TEXT, createLiveSearch } from '../site/address-search.js';
import { applySiteLookup } from '../site/apply.js';
import { demoSite } from '../site/demo-lot.js';
import { runUpload } from '../site/upload/flow.js';
import { confirmFrontage, waitForEnvelope } from '../ui/embed-viewer.js';
import { lotOf } from '../model/placement.js';
import { ensureFlowAerial } from './flow-aerial.js';
import { lotMapSvg, frontageM, aerialOf, setbacksText } from './lot-map.js';

const fmt = (n, d = 0) => (n == null || !Number.isFinite(n) ? 'n/a' : n.toLocaleString('en-AU', { maximumFractionDigits: d, minimumFractionDigits: d }));

/** Zone text for a lot, e.g. "R1 General Residential". */
export const zoneText = (lot) => [lot?.zoning?.code, lot?.zoning?.name].filter(Boolean).join(' ') || 'Not available';

export function mountLotStep(ctx, { extra = null, sampleOptions = { commercial: false } } = {}) {
  const { store } = ctx;
  let loading = false;
  let error = '';
  let list = [];
  let notFound = false;
  let slow = false;
  let disposed = false;
  const app = typeof window !== 'undefined' ? window.__ps : null;

  const input = h('input', { type: 'search', placeholder: 'Search a NSW or QLD street address', 'aria-label': 'Street address in NSW or QLD', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: '120', role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list', dataset: { ps: 'flow-address' } });
  const findBtn = h('button', { class: 'gf-btn gf-btn--primary', type: 'button', dataset: { ps: 'flow-find' } }, 'Find my lot');
  const sugg = h('ul', { class: 'gf-suggest', role: 'listbox', hidden: true, dataset: { ps: 'flow-suggest' } });
  const status = h('p', { class: 'gf-note', role: 'status', 'aria-live': 'polite', dataset: { ps: 'flow-lot-status' } });
  const sample = h('button', { class: 'gf-skip', type: 'button', style: { marginLeft: '0', padding: '0' }, dataset: { ps: 'flow-sample' }, onclick: () => useSample() }, 'No address? Try a sample lot');
  // Not found: the sample lot and the boundary upload are always offered side by side, so the person is never stuck.
  const upload = h('button', { class: 'gf-skip', type: 'button', hidden: true, style: { marginLeft: '12px', padding: '0' }, dataset: { ps: 'flow-upload' }, onclick: () => useUpload() }, 'Upload your own boundary');
  const confirm = h('div', { dataset: { ps: 'flow-lot-confirm' } });
  const search = h('div', { class: 'gf-card' },
    h('label', { class: 'gf-note', style: { margin: '0 0 6px', display: 'block', fontWeight: '600' } }, 'Street address'),
    h('div', { class: 'gf-field' }, input, findBtn, sugg), status, h('p', { class: 'gf-note' }, sample, upload));
  const el = h('div', { class: 'gf-grid', style: { alignItems: 'start' } }, h('div', null, search), confirm);

  const setSugg = (items) => {
    list = items;
    sugg.replaceChildren(...items.map((r, i) => h('li', { role: 'option', 'aria-selected': 'false', dataset: { i: String(i) }, onmousedown: (e) => { e.preventDefault(); choose(r); } }, r.label)));
    sugg.hidden = !items.length;
    input.setAttribute('aria-expanded', String(!!items.length));
  };

  // Suggestions while typing and the Enter search share one debounced, aborting path (createLiveSearch). A busy search clears the stale
  // suggestions and says so in the dropdown.
  const setBusy = (text) => {
    list = [];
    sugg.replaceChildren(h('li', { role: 'status', class: 'gf-suggest-busy', dataset: { ps: 'flow-suggest-busy' } }, text));
    sugg.hidden = false;
    input.setAttribute('aria-expanded', 'false');
  };
  const live = createLiveSearch({ getText: () => input.value, onResults: (r) => { if (!disposed) setSugg(r.slice(0, 5)); }, onError: (t) => { if (!disposed) setBusy(t); } });

  async function choose(pick) {
    if (loading) return;
    setSugg([]);
    input.value = pick.label || input.value;
    loading = true; error = ''; paint(); ctx.refresh();
    try {
      await applySiteLookup(store, pick, {});
      confirmFrontage(store);
      await waitForEnvelope(store, 8000);
    } catch (e) {
      error = e?.message || 'That address could not be loaded.';
    } finally {
      loading = false;
    }
    if (!disposed) { paint(); ctx.refresh(); }
  }

  async function find() {
    if (loading) return; // Enter pressed again while the search is on its way
    const q = input.value.trim();
    if (q.length < 3) { error = 'Type a street address first.'; paint(); return; }
    loading = true; error = ''; notFound = false; slow = false; paint();
    let pick = list.find((r) => String(r.label || '').toLowerCase() === q.toLowerCase()) || null; // a suggestion already shown: no second search
    let failed = false;
    if (!pick) {
      const r = await live.now(); // same debounce-free, aborting path as the suggestions; an identical query is not sent twice
      if (r === null) { loading = false; paint(); return; } // superseded by typing
      pick = r[0] || null;
      failed = !!r.failed;
      if (!pick && failed) { error = SEARCH_BUSY_TEXT; slow = true; }
      else if (!pick && r.error) { error = r.error.message || 'The address search is not available right now.'; slow = r.error.code === 'SLOW'; }
    }
    loading = false;
    if (!pick && !error) { error = NOT_FOUND_TEXT; notFound = true; }
    if (pick) await choose(pick); else paint();
  }

  async function useUpload() {
    if (loading) return;
    await runUpload(store, { viewer: false, after: async () => { try { confirmFrontage(store); await waitForEnvelope(store, 8000); } catch { /* the confirm card shows what is there */ } error = ''; notFound = false; if (!disposed) { paint(); ctx.refresh(); } } });
  }

  async function useSample() {
    if (loading) return;
    loading = true; error = ''; paint(); ctx.refresh();
    try {
      await applySiteLookup(store, { label: '' }, { prefetched: demoSite(sampleOptions) });
      confirmFrontage(store);
      await waitForEnvelope(store, 8000);
    } catch (e) { error = e?.message || 'The sample lot could not be loaded.'; }
    loading = false;
    if (!disposed) { paint(); ctx.refresh(); }
  }

  let aerialFor = null;
  let aerial = null;
  let loadStart = 0;
  let slowT = 0;
  async function paintConfirm() {
    const lot = lotOf(store.project);
    if (!lot) { confirm.replaceChildren(h('div', { class: 'gf-card gf-empty', dataset: { ps: 'flow-lot-empty' } }, 'Your lot will appear here, with its boundary, area, street frontage and setbacks.')); return; }
    // The lot aerial under the boundary: the stored one, else fetched the same way steps 3 and 4 do. A failure leaves the plain background.
    const key = `${lot.aerial?.key || 'none'}:${lot.origin?.e},${lot.origin?.n}`;
    if (aerialFor !== key) {
      aerialFor = key; aerial = null;
      (async () => {
        let a = lot.aerial?.key ? await aerialOf(lot) : null;
        if (!a) { await ensureFlowAerial(store); a = await aerialOf(lotOf(store.project)); }
        if (a && !disposed) { aerial = a; aerialFor = `${lotOf(store.project)?.aerial?.key || 'none'}:${lotOf(store.project)?.origin?.e},${lotOf(store.project)?.origin?.n}`; paintConfirm(); }
      })().catch(() => {});
    }
    const map = h('div', { class: 'gf-map-wrap', html: lotMapSvg(store.project, { aerial }) });
    const fr = frontageM(lot);
    const sb = setbacksText(lot);
    const extraEl = extra ? extra(store.project) : null;
    confirm.replaceChildren(h('div', { class: 'gf-card' },
      h('div', { class: 'gf-row', style: { justifyContent: 'space-between' } }, h('strong', { dataset: { ps: 'flow-lot-label' } }, lot.lotLabel || 'Your lot'), h('span', { class: 'gf-chip gf-chip--ok' }, lot.lotLabel === 'Sample lot' ? 'Sample lot' : 'Lot found')),
      lot.address ? h('div', { class: 'gf-note', style: { margin: '2px 0 10px' } }, lot.address) : null,
      map,
      h('div', { class: 'gf-stats' },
        stat(`${fmt(lot.areaM2)} m2`, 'Lot area'),
        stat(fr == null ? 'n/a' : `${fmt(fr, 1)} m`, 'Street frontage'),
        stat(zoneText(lot), 'Zone')),
      h('p', { class: 'gf-note', dataset: { ps: 'flow-setbacks' } }, h('strong', null, 'Setbacks: '), sb),
      extraEl,
      h('p', { class: 'gf-note' }, 'The blue edge is the street frontage. Dashed green is the indicative building area inside the setbacks. Check the details with council.')));
  }
  const stat = (b, s) => h('div', { class: 'gf-stat' }, h('b', null, b), h('span', null, s));

  function paint() {
    findBtn.disabled = loading;
    upload.hidden = !notFound;
    sample.textContent = notFound ? 'Try a sample lot' : 'No address? Try a sample lot';
    if (loading) {
      if (!loadStart) { loadStart = Date.now(); slowT = setTimeout(() => { if (loading && !disposed) paint(); }, 8000); }
      const long = Date.now() - loadStart >= 8000;
      status.replaceChildren(h('span', { class: 'gf-spin', 'aria-hidden': 'true', dataset: { ps: 'flow-spinner' } }), h('span', { dataset: { ps: 'flow-loading-text' } }, long ? 'Still looking. Council and state map services can be slow.' : 'Finding your lot. This can take a little while for some addresses.'));
    } else {
      loadStart = 0; clearTimeout(slowT);
      status.textContent = error;
    }
    confirm.classList.toggle('gf-dim', loading);
    confirm.setAttribute('aria-busy', String(!!loading));
    if (slow && error && !loading) status.append(' ', h('button', { class: 'gf-skip', type: 'button', style: { padding: '0 0 0 6px', fontWeight: '700' }, dataset: { ps: 'flow-retry' }, onclick: () => find() }, 'Try again'));
    status.className = `gf-note${error && !loading ? ' gf-note--bad' : ''}`;
    paintConfirm();
  }

  input.addEventListener('input', () => { live.trigger(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (list.length) choose(list[0]); else find(); } else if (e.key === 'Escape') setSugg([]); });
  input.addEventListener('blur', () => setTimeout(() => setSugg([]), 150));
  findBtn.addEventListener('click', find);
  const off = store.on('project', (e) => { if (e?.label === 'setbacks' || e?.label === 'Find my block') paintConfirm(); });

  // A lookup that the page started (?address=): show it as it arrives.
  const pre = lotOf(store.project) ? null : app?.addressLoad;
  if (pre) { loading = true; Promise.resolve(pre).catch((e) => { error = e?.message || ''; }).finally(() => { loading = false; if (!disposed) { paint(); ctx.refresh(); } }); }
  const adr = lotOf(store.project)?.address; if (adr) input.value = adr;
  paint();

  return {
    el,
    canNext: () => !!lotOf(store.project) && !loading,
    nextLabel: 'This is my lot',
    dispose() { disposed = true; live.cancel(); clearTimeout(slowT); off?.(); },
  };
}
