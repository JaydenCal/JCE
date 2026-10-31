// Furniture catalogue drawer: category tabs, search and tiles with a small preview drawn by each item's own 2D symbol.

import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { drawItemPreview } from './preview.js';
import { setTool } from './toolstate.js';
import { onTheme } from './theme.js';

const titleCase = (s) => String(s || '').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

function normaliseCategories(raw, items) {
  const list = Array.isArray(raw) && raw.length ? raw : [...new Set(items.map((i) => i.category).filter(Boolean))];
  return list
    .map((c) => (typeof c === 'string' ? { id: c, label: titleCase(c) } : { id: c.id ?? c.key ?? c.name, label: c.label ?? c.name ?? titleCase(c.id ?? c.key) }))
    .filter((c) => c.id != null);
}

export function createDrawer(el, store, { catalogue, onInventory } = {}) {
  const items = () => {
    const f = catalogue?.FURNITURE;
    return Array.isArray(f) ? f : f && typeof f === 'object' ? Object.values(f) : [];
  };
  let cat = 'all';
  let query = '';
  let isOpen = false;
  const narrow = () => window.matchMedia?.('(max-width: 899.98px)').matches;

  const search = h('input', { class: 'ps-input', type: 'search', placeholder: 'Search furniture', 'aria-label': 'Search furniture', autocomplete: 'off', spellcheck: 'false' });
  const closeBtn = h('button', { class: 'ps-btn ps-btn--ghost ps-btn--icon', type: 'button', 'aria-label': 'Close furniture catalogue', title: 'Close', onclick: () => close() }, icon('close', { size: 18 }));
  const cats = h('div', { class: 'ps-cats', role: 'group', 'aria-label': 'Furniture categories' });
  const tiles = h('div', { class: 'ps-tiles', role: 'list' });
  el.append(
    h('div', { class: 'ps-drawer-head' }, h('h3', null, 'Furniture'),
      onInventory ? h('button', { class: 'ps-btn ps-btn--sm', type: 'button', title: 'Choose the quick slots of the Q wheel (I)', dataset: { action: 'inventory' }, onclick: () => onInventory() }, icon('wheel', { size: 16 }), 'Inventory') : null,
      closeBtn),
    h('div', { class: 'ps-drawer-search' }, search),
    cats,
    tiles);

  function match(item) {
    const q = query.trim().toLowerCase();
    if (cat !== 'all' && item.category !== cat) return false;
    if (!q) return true;
    return `${item.name} ${item.id} ${titleCase(item.category)}`.toLowerCase().includes(q);
  }

  function renderCats() {
    clear(cats);
    const defs = [{ id: 'all', label: 'All' }, ...normaliseCategories(catalogue?.CATEGORIES, items())];
    for (const c of defs) {
      cats.append(h('button', { class: 'ps-cat', type: 'button', 'aria-pressed': String(cat === c.id), onclick: () => {
        cat = c.id;
        renderCats();
        renderTiles();
      } }, c.label));
    }
  }

  function renderTiles() {
    clear(tiles);
    const all = items();
    if (!all.length) {
      tiles.append(h('div', { class: 'ps-empty', style: { gridColumn: '1 / -1' } }, 'The furniture catalogue is not available in this session.'));
      return;
    }
    const shown = all.filter(match);
    if (!shown.length) {
      tiles.append(h('div', { class: 'ps-empty', style: { gridColumn: '1 / -1' } }, 'Nothing matches that search. Try a shorter word or choose All.'));
      return;
    }
    const armed = store.ui.tool === 'furniture' ? store.ui.toolArg : null;
    const pending = [];
    for (const item of shown) {
      const canvas = h('canvas', { 'aria-hidden': 'true' });
      const tile = h('button', {
        class: 'ps-tile',
        type: 'button',
        role: 'listitem',
        title: `${item.name}, ${item.w} × ${item.d} mm`,
        'aria-pressed': String(armed === item.id),
        dataset: { item: item.id },
        onclick: () => {
          setTool(store, 'furniture', item.id);
          if (narrow()) close();
        },
      }, canvas, h('span', null, item.name));
      tiles.append(tile);
      pending.push([canvas, item]);
    }
    // Draw after the tiles are in the page so the previews pick up the theme colours.
    for (const [canvas, item] of pending) drawItemPreview(canvas, item, 64);
  }

  function syncArmed() {
    const armed = store.ui.tool === 'furniture' ? store.ui.toolArg : null;
    for (const t of tiles.querySelectorAll('.ps-tile')) t.setAttribute('aria-pressed', String(t.dataset.item === armed));
  }

  function open() {
    if (store.ui.view !== '2d') return;
    if (!isOpen) {
      isOpen = true;
      el.hidden = false;
      renderCats();
      renderTiles();
    }
    if (!narrow() && window.matchMedia?.('(pointer: fine)').matches) search.focus({ preventScroll: true });
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    el.hidden = true;
  }

  search.addEventListener('input', () => {
    query = search.value;
    renderTiles();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  });

  const offs = [
    store.on('plan:open-drawer', open),
    store.on('ui', (patch = {}) => {
      if (('tool' in patch && store.ui.tool !== 'furniture') || ('view' in patch && store.ui.view !== '2d')) close();
      if (isOpen && ('toolArg' in patch || 'tool' in patch)) syncArmed();
    }),
    onTheme(() => {
      if (isOpen) renderTiles();
    }),
  ];
  el.hidden = true;
  return { open, close, isOpen: () => isOpen, dispose: () => offs.forEach((o) => o?.()) };
}
