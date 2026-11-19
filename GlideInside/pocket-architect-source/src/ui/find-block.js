// "Find my block": address search box with suggestions. Used in the welcome card, the Site section of the panel and the
// dialog opened from the top bar. Picking an address looks the lot up and puts it in the project (src/site/apply.js).

import { h, clear, debounce } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { openModal } from './modal.js';
import { CONFIG } from '../config.js';
import { smartSearch, NOT_FOUND_TEXT, SEARCH_DEBOUNCE_MS, SEARCH_BUSY_TEXT, isBusyFailure } from '../site/address-search.js';
import { demoSite } from '../site/demo-lot.js';
import { applySiteLookup } from '../site/apply.js';
import { runUpload } from '../site/upload/flow.js';
import { arrangeOnLoadWatching } from '../flow/arrange-on-load.js';

const STEPS = { lot: 'Finding the lot', aerial: 'Loading the aerial image', contours: 'Loading ground levels', busy: 'Busy, trying again' };
let seq = 0;
const searchCache = new Map(); // normalised query -> results, for this page view

export function createFindBlock(store, { onDone, autofocus = false, compact = false, large = false } = {}) {
  const id = `ps-find-${++seq}`;
  const input = h('input', {
    class: 'ps-input ps-find-input', type: 'search', id, role: 'combobox', 'aria-expanded': 'false', 'aria-controls': `${id}-list`, 'aria-autocomplete': 'list',
    placeholder: 'Street address in NSW or QLD', autocomplete: 'off', spellcheck: 'false', maxlength: '120', 'aria-label': 'Street address', dataset: { ps: 'find-block-input' },
  });
  const list = h('ul', { class: 'ps-find-list', id: `${id}-list`, role: 'listbox', hidden: true });
  const status = h('div', { class: 'ps-find-status', role: 'status', 'aria-live': 'polite' });
  // Shown with the "not found" message: a sample lot is always a way forward, and the boundary upload sits beside it.
  const sample = h('button', { class: 'ps-btn ps-btn--ghost ps-find-sample', type: 'button', hidden: true, dataset: { ps: 'find-sample' }, onclick: () => useSample() }, 'Try a sample lot');
  const wrap = h('div', { class: `ps-find${compact ? ' ps-find--compact' : ''}${large ? ' ps-find--large' : ''}`, dataset: { ps: 'find-block' } },
    h('div', { class: 'ps-find-box' }, icon('search', { size: large ? 22 : 16 }), input),
    list,
    status,
    sample,
    h('button', { class: 'ps-btn ps-btn--ghost ps-find-upload', type: 'button', dataset: { ps: 'find-upload' }, title: 'Use your own lot boundary, in Australia or anywhere in the world', onclick: () => runUpload(store, { viewer: false, after: (lot) => onDone?.(lot) }) }, 'Upload your own boundary'),
    CONFIG.siteMock ? h('p', { class: 'ps-hint ps-find-mock' }, 'Sample mode: example lots are shown until the live address lookup is switched on.') : null);

  let results = [];
  let active = -1;
  let controller = null;
  let busy = false;
  let disposed = false;
  const cache = searchCache;

  const say = (text, kind = '') => {
    status.textContent = text || '';
    status.dataset.kind = kind;
  };

  function closeList() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function paint() {
    clear(list);
    results.slice(0, 8).forEach((r, i) => {
      const li = h('li', { class: 'ps-find-item', role: 'option', id: `${id}-o${i}`, 'aria-selected': String(i === active), dataset: { index: i },
        onpointerdown: (e) => { e.preventDefault(); choose(i); } },
      h('span', { class: 'ps-find-label' }, r.label), h('span', { class: 'ps-tag' }, r.state));
      list.append(li);
    });
    list.hidden = !results.length;
    input.setAttribute('aria-expanded', String(!!results.length));
    if (active >= 0) input.setAttribute('aria-activedescendant', `${id}-o${active}`);
  }

  let flightQ = null; // the query being searched now: an identical one (Enter pressed again) joins it instead of calling again
  let flight = null;
  function search() {
    const q = input.value.trim();
    if (flight && flightQ === q.toLowerCase().replace(/\s+/g, ' ')) return flight;
    flight = searchNow();
    return flight;
  }
  async function searchNow() {
    const q = input.value.trim();
    controller?.abort();
    const key = q.toLowerCase().replace(/\s+/g, ' ');
    flightQ = key;
    try { await searchOnce(q); } finally { if (flightQ === key) { flightQ = null; flight = null; } }
  }
  async function searchOnce(q) {
    if (q.length < 3) {
      results = [];
      paint();
      say('');
      return;
    }
    const ck = q.toLowerCase().replace(/\s+/g, ' ');
    if (cache.has(ck)) { results = cache.get(ck); active = -1; paint(); say(''); return; }
    controller = new AbortController();
    say('Searching...'); // the previous suggestions stay up meanwhile
    try {
      results = await smartSearch(q, { signal: controller.signal, onRetry: () => say('Busy, trying again') });
      if (results.length) cache.set(ck, results);
      if (!results.length && results.rateLimited) { active = -1; paint(); say(SEARCH_BUSY_TEXT, 'warn'); return; } // still rate limited after the quiet retry: say it is busy, not "not found"
      active = -1;
      paint();
      say(results.length ? '' : NOT_FOUND_TEXT, results.length ? '' : 'warn');
      sample.hidden = !!results.length;
    } catch (e) {
      if (e?.name === 'AbortError') return;
      results = [];
      paint();
      say(isBusyFailure(e) ? SEARCH_BUSY_TEXT : e?.message || 'The address search failed. You can keep drawing without a lot.', 'warn');
      if (e?.code === 'SLOW') status.append(' ', h('button', { class: 'ps-btn ps-btn--ghost', type: 'button', dataset: { ps: 'find-retry' }, onclick: () => search() }, 'Try again'));
    }
  }
  const debounced = debounce(search, SEARCH_DEBOUNCE_MS);

  // Enter before any suggestion came back: search now and take the top match, or say it was not found.
  async function enterSearch() {
    await search();
    if (results.length) choose(0);
  }

  async function useSample() {
    if (busy) return;
    busy = true;
    closeList();
    try {
      const { lot, warnings } = await applySiteLookup(store, { label: '' }, { prefetched: demoSite({ commercial: store.project?.mode === 'commercial' }) });
      say('');
      sample.hidden = true;
      toast(`${lot.lotLabel} added to your design (${Math.round(lot.areaM2)} m²).`, { kind: 'ok' });
      for (const w of warnings) toast(w, { kind: 'warn', timeout: 6000 });
      arrangeOnLoadWatching(store, { swap: false }).catch(() => {}); // the sample lot opens with the house fitting inside its setbacks
      if (!disposed) onDone?.(lot);
    } catch (e) {
      say(e?.message || 'The sample lot could not be loaded.', 'warn');
    } finally {
      busy = false;
    }
  }

  async function choose(i) {
    const pick = results[i];
    if (!pick || busy) return;
    busy = true;
    closeList();
    input.value = pick.label;
    input.disabled = true;
    controller?.abort();
    controller = new AbortController();
    try {
      const { lot, warnings } = await applySiteLookup(store, pick, { signal: controller.signal, onStep: (s) => say(`${STEPS[s] || s}`) });
      say('');
      toast(`${lot.lotLabel} added to your design (${Math.round(lot.areaM2)} m²).`, { kind: 'ok' });
      for (const w of warnings) toast(w, { kind: 'warn', timeout: 6000 });
      arrangeOnLoadWatching(store, { swap: false }).catch(() => {});
      if (!disposed) onDone?.(lot);
    } catch (e) {
      if (e?.name === 'AbortError') return;
      say(e?.message || 'The lookup failed. You can keep drawing without a lot.', 'warn');
    } finally {
      busy = false;
      input.disabled = false;
    }
  }

  input.addEventListener('input', () => { controller?.abort(); flightQ = null; flight = null; debounced(); }); // every keystroke aborts the request in flight
  input.addEventListener('focus', () => { if (results.length) paint(); });
  input.addEventListener('blur', () => setTimeout(closeList, 120));
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // typing must never trigger the editor's shortcuts
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!results.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      paint();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0) choose(active);
      else if (results.length) choose(0); // Enter takes the top match (exact house number first)
      else enterSearch();
    } else if (e.key === 'Escape' && !list.hidden) {
      e.preventDefault();
      closeList();
    }
  });
  if (autofocus) setTimeout(() => input.focus({ preventScroll: true }), 0);

  return {
    el: wrap,
    input,
    focus: () => input.focus({ preventScroll: true }),
    dispose() {
      disposed = true;
      controller?.abort();
    },
  };
}

// The dialog opened from the top bar.
export function openFindBlock(store, { onDone } = {}) {
  let box = null;
  let found = null;
  const modal = openModal({
    title: 'Find my block',
    size: 'find',
    body: () => {
      box = createFindBlock(store, { autofocus: true, large: true, onDone: (lot) => { found = lot; modal.close('done'); } });
      return h('div', null,
        h('p', { class: 'ps-hint', style: { margin: '0 0 8px' } }, `Type your street address. The lot boundary, neighbouring lots, an aerial image and ground contours are drawn to scale so you can place the ${store.project?.mode === 'commercial' ? 'units' : 'house'} on the real block.`),
        box.el);
    },
    onClose: (reason) => { box?.dispose(); if (reason === 'done' && found) onDone?.(found); },
  });
  return modal;
}
