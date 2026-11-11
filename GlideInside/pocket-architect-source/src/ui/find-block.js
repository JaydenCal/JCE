// "Find my block": address search box with suggestions. Used in the welcome card, the Site section of the panel and the
// dialog opened from the top bar. Picking an address looks the lot up and puts it in the project (src/site/apply.js).

import { h, clear, debounce } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { openModal } from './modal.js';
import { CONFIG } from '../config.js';
import { searchAddresses } from '../site/client.js';
import { applySiteLookup } from '../site/apply.js';

const STEPS = { lot: 'Finding the lot', aerial: 'Loading the aerial image', contours: 'Loading ground levels' };
let seq = 0;

export function createFindBlock(store, { onDone, autofocus = false, compact = false, large = false } = {}) {
  const id = `ps-find-${++seq}`;
  const input = h('input', {
    class: 'ps-input ps-find-input', type: 'search', id, role: 'combobox', 'aria-expanded': 'false', 'aria-controls': `${id}-list`, 'aria-autocomplete': 'list',
    placeholder: 'Street address in NSW or QLD', autocomplete: 'off', spellcheck: 'false', maxlength: '120', 'aria-label': 'Street address', dataset: { ps: 'find-block-input' },
  });
  const list = h('ul', { class: 'ps-find-list', id: `${id}-list`, role: 'listbox', hidden: true });
  const status = h('div', { class: 'ps-find-status', role: 'status', 'aria-live': 'polite' });
  const wrap = h('div', { class: `ps-find${compact ? ' ps-find--compact' : ''}${large ? ' ps-find--large' : ''}`, dataset: { ps: 'find-block' } },
    h('div', { class: 'ps-find-box' }, icon('search', { size: large ? 22 : 16 }), input),
    list,
    status,
    CONFIG.siteMock ? h('p', { class: 'ps-hint ps-find-mock' }, 'Sample mode: example lots are shown until the live address lookup is switched on.') : null);

  let results = [];
  let active = -1;
  let controller = null;
  let busy = false;
  let disposed = false;

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

  async function search() {
    const q = input.value.trim();
    controller?.abort();
    if (q.length < 3) {
      results = [];
      paint();
      say('');
      return;
    }
    controller = new AbortController();
    say('Searching');
    try {
      results = await searchAddresses(q, { signal: controller.signal });
      active = -1;
      paint();
      say(results.length ? '' : 'No matching address found. Check the spelling, or try the street name and suburb.', results.length ? '' : 'warn');
    } catch (e) {
      if (e?.name === 'AbortError') return;
      results = [];
      paint();
      say(e?.message || 'The address search failed. You can keep drawing without a lot.', 'warn');
    }
  }
  const debounced = debounce(search, 300);

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
      if (!disposed) onDone?.(lot);
    } catch (e) {
      if (e?.name === 'AbortError') return;
      say(e?.message || 'The lookup failed. You can keep drawing without a lot.', 'warn');
    } finally {
      busy = false;
      input.disabled = false;
    }
  }

  input.addEventListener('input', debounced);
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
      else if (results.length === 1) choose(0);
      else search();
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
export function openFindBlock(store) {
  let box = null;
  const modal = openModal({
    title: 'Find my block',
    size: 'find',
    body: () => {
      box = createFindBlock(store, { autofocus: true, large: true, onDone: () => modal.close('done') });
      return h('div', null,
        h('p', { class: 'ps-hint', style: { margin: '0 0 8px' } }, 'Type your street address. The lot boundary, neighbouring lots, an aerial image and ground contours are drawn to scale so you can place the house on the real block.'),
        box.el);
    },
    onClose: () => box?.dispose(),
  });
  return modal;
}
