// Inventory wheel. Hold Q (or tap Q to toggle) to open a radial menu at the pointer:
//   outer ring   8 quick slots, customised in the Inventory panel (localStorage 'ps.wheel.slots')
//   inner ring   furniture categories; hovering one fans its items out beyond the outer ring
//   centre       opens the Inventory panel
// In Walk mode (window.__ps.wheel.open({ mode: 'walk' })) furniture and door or window presets are placed ahead of the player.
// Releasing Q (or clicking) over an item arms placement. Esc closes. Hit testing is geometric,
// so moving the pointer straight out from a category onto its items never loses the category.

import { h, clear, isTyping } from './dom.js';
import { icon } from './icons.js';
import { drawItemPreview } from './preview.js';
import { loadSlots, allEntries, runEntry, runEntryWalk, walkable, entryGlyph } from './inventory.js';
import { toast } from './toast.js';

const TAU = Math.PI * 2;
const R = { hub: 34, catIn: 38, catOut: 98, slotIn: 102, slotOut: 158, fan: 208, tile: 56 };
const SIZE = 2 * (R.fan + R.tile / 2 + 10);
const HOLD_MS = 280;
const SWITCH_MS = 120;
const SVGNS = 'http://www.w3.org/2000/svg';

const polar = (cx, cy, r, a) => ({ x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) });

function sectorPath(cx, cy, rIn, rOut, a0, a1) {
  const p = (r, a) => polar(cx, cy, r, a);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const o0 = p(rOut, a0);
  const o1 = p(rOut, a1);
  const i1 = p(rIn, a1);
  const i0 = p(rIn, a0);
  return `M${o0.x.toFixed(2)} ${o0.y.toFixed(2)}A${rOut} ${rOut} 0 ${large} 1 ${o1.x.toFixed(2)} ${o1.y.toFixed(2)}L${i1.x.toFixed(2)} ${i1.y.toFixed(2)}A${rIn} ${rIn} 0 ${large} 0 ${i0.x.toFixed(2)} ${i0.y.toFixed(2)}Z`;
}

export function createWheel({ store, catalogue, host, getViewer, openInventory }) {
  const items = () => {
    const f = catalogue?.FURNITURE;
    return Array.isArray(f) ? f : f && typeof f === 'object' ? Object.values(f) : [];
  };
  const categories = () => {
    const all = items();
    const names = Array.isArray(catalogue?.CATEGORIES) && catalogue.CATEGORIES.length ? catalogue.CATEGORIES : [...new Set(all.map((i) => i.category).filter(Boolean))];
    return names.map((c) => (typeof c === 'string' ? { id: c, label: c } : { id: c.id ?? c.name, label: c.label ?? c.name ?? c.id })).filter((c) => all.some((i) => i.category === c.id));
  };

  let root = null;
  let ring = null;
  let fanLayer = null;
  let hub = null;
  let cats = [];
  let SLOTS = [];
  let mode = 'plan'; // 'plan' | 'walk'
  let entryList = [];
  let centre = { x: 0, y: 0 };
  let active = null; // category id whose items are fanned out
  let hover = null; // { type: 'cat' | 'slot' | 'item', id }
  let tiles = []; // { id, x, y, el }
  let heldSince = 0;
  let holding = false;
  let pending = null;
  let pendingTimer = 0;
  let pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const isOpen = () => !!root;

  // Drawing ------------------------------------------------------------------------------------------------
  function buildRing() {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
    svg.setAttribute('width', String(SIZE));
    svg.setAttribute('height', String(SIZE));
    svg.setAttribute('class', 'ps-wheel-svg');
    svg.setAttribute('aria-hidden', 'true');
    const c = SIZE / 2;
    const add = (rIn, rOut, list, kind) => {
      const n = list.length;
      const step = TAU / n;
      list.forEach((entry, i) => {
        const mid = i * step;
        const path = document.createElementNS(SVGNS, 'path');
        path.setAttribute('d', sectorPath(c, c, rIn, rOut, mid - step / 2 + 0.012, mid + step / 2 - 0.012));
        path.setAttribute('class', `ps-wheel-seg ps-wheel-seg--${kind}`);
        path.dataset.kind = kind;
        path.dataset.id = entry.id;
        svg.append(path);
        entry.path = path;
        entry.mid = mid;
        entry.step = step;
      });
    };
    if (cats.length) add(R.catIn, R.catOut, cats, 'cat');
    add(R.slotIn, R.slotOut, SLOTS, 'slot');
    const hubCircle = document.createElementNS(SVGNS, 'circle');
    hubCircle.setAttribute('cx', String(c));
    hubCircle.setAttribute('cy', String(c));
    hubCircle.setAttribute('r', String(R.hub));
    hubCircle.setAttribute('class', 'ps-wheel-hub-bg');
    svg.append(hubCircle);
    return svg;
  }

  function labels() {
    const layer = h('div', { class: 'ps-wheel-labels' });
    const c = SIZE / 2;
    const catMid = (R.catIn + R.catOut) / 2;
    const arc = cats.length ? Math.max(30, (TAU * catMid) / cats.length - 6) : 60;
    for (const cat of cats) {
      const p = polar(c, c, catMid, cat.mid);
      layer.append(h('span', { class: 'ps-wheel-cat', style: { left: `${p.x}px`, top: `${p.y}px`, maxWidth: `${arc}px` } }, cat.label));
    }
    for (const s of SLOTS) {
      const p = polar(c, c, (R.slotIn + R.slotOut) / 2, s.mid);
      const off = mode === 'walk' && s.entry && !walkable(s.entry);
      layer.append(h('span', { class: `ps-wheel-slot${s.entry ? '' : ' is-empty'}${off ? ' is-off' : ''}`, style: { left: `${p.x}px`, top: `${p.y}px` } }, s.entry ? entryGlyph(s.entry, 36) : icon('plus', { size: 16 })));
    }
    return layer;
  }

  function showFan() {
    clear(fanLayer);
    tiles = [];
    const cat = cats.find((x) => x.id === active);
    if (!cat) return;
    const list = items().filter((i) => i.category === cat.id);
    const c = SIZE / 2;
    const stepA = Math.min(0.42, (R.tile + 6) / R.fan);
    const start = cat.mid - ((list.length - 1) * stepA) / 2;
    list.forEach((item, i) => {
      const p = polar(c, c, R.fan, start + i * stepA);
      const canvas = h('canvas', { 'aria-hidden': 'true' });
      const el = h('div', { class: 'ps-wheel-tile', style: { left: `${p.x}px`, top: `${p.y}px` }, dataset: { item: item.id } }, canvas);
      fanLayer.append(el);
      drawItemPreview(canvas, item, R.tile - 12);
      tiles.push({ id: item.id, x: p.x, y: p.y, el, item });
    });
  }

  function paint() {
    for (const cat of cats) {
      cat.path.classList.toggle('is-active', cat.id === active);
      cat.path.classList.toggle('is-hover', hover?.type === 'cat' && hover.id === cat.id);
    }
    for (const s of SLOTS) s.path.classList.toggle('is-hover', hover?.type === 'slot' && hover.id === s.id);
    for (const t of tiles) t.el.classList.toggle('is-hover', hover?.type === 'item' && hover.id === t.id);
    let title = 'Inventory';
    let sub = mode === 'walk' ? 'Walk' : 'Edit slots';
    if (hover?.type === 'item') {
      const it = items().find((i) => i.id === hover.id);
      title = it?.name || hover.id;
      sub = it ? `${it.w} × ${it.d}` : '';
    } else if (hover?.type === 'slot') {
      const slot = SLOTS.find((s) => s.id === hover.id);
      title = slot?.entry?.label || 'Empty slot';
      sub = !slot?.entry ? 'Click to fill' : mode === 'walk' && !walkable(slot.entry) ? 'Plan only' : 'Slot';
    } else if (active) {
      title = cats.find((c) => c.id === active)?.label || title;
      sub = `${items().filter((i) => i.category === active).length} items`;
    }
    hub.replaceChildren(h('strong', null, title), h('span', null, sub));
  }

  // Hit testing --------------------------------------------------------------------------------------------------
  function indexAt(angle, n) {
    const step = TAU / n;
    return Math.floor((((angle + step / 2) % TAU) + TAU) % TAU / step) % n;
  }

  function locate(clientX, clientY) {
    const dx = clientX - centre.x;
    const dy = clientY - centre.y;
    const dist = Math.hypot(dx, dy);
    const angle = (Math.atan2(dx, -dy) + TAU) % TAU;
    if (dist < R.hub) return { type: 'hub', id: 'hub' };
    if (dist >= R.slotIn - 2 && dist < R.slotOut + 2) return { type: 'slot', id: SLOTS[indexAt(angle, SLOTS.length)].id };
    if (cats.length && dist >= R.catIn - 2 && dist < R.slotIn - 2) return { type: 'cat', id: cats[indexAt(angle, cats.length)].id };
    if (dist > R.slotOut + 4) {
      const lx = dx + SIZE / 2;
      const ly = dy + SIZE / 2;
      let best = null;
      let bestD = R.tile / 2 + 6;
      for (const t of tiles) {
        const d = Math.hypot(t.x - lx, t.y - ly);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      if (best) return { type: 'item', id: best.id };
    }
    return null;
  }

  function track(clientX, clientY) {
    const next = locate(clientX, clientY);
    if (next?.type === 'cat' && next.id !== active) {
      // The first category opens at once. Later switches wait a moment so a straight path from a category
      // out to one of its items does not flick through the neighbouring categories on the way.
      if (!active) {
        active = next.id;
        showFan();
      } else if (pending !== next.id) {
        pending = next.id;
        clearTimeout(pendingTimer);
        pendingTimer = setTimeout(() => {
          if (root && hover?.type === 'cat' && hover.id === pending) {
            active = pending;
            showFan();
            paint();
          }
        }, SWITCH_MS);
      }
    } else if (next?.type !== 'cat') {
      pending = null;
      clearTimeout(pendingTimer);
    }
    hover = next;
    paint();
  }

  // Actions -----------------------------------------------------------------------------------------------------------
  function commit({ fromKey = false } = {}) {
    const pick = hover;
    const walking = mode === 'walk';
    close();
    if (!pick) return false;
    if (pick.type === 'hub') {
      // Releasing Q with the pointer still in the centre only closes the wheel; a click opens the Inventory.
      if (!fromKey) openInventory?.();
      return !fromKey;
    }
    let entry = null;
    if (pick.type === 'item') entry = entryList.find((e) => e.type === 'item' && e.def.id === pick.id);
    else if (pick.type === 'slot') {
      const slot = SLOTS.find((s) => s.id === pick.id);
      entry = slot?.entry || null;
      if (!entry) {
        openInventory?.();
        return true;
      }
    } else return false;
    if (walking) {
      if (!walkable(entry)) toast('Stairs and tanks are placed from the plan view.', { kind: 'info' });
      else runEntryWalk(getViewer, entry);
      return true;
    }
    return runEntry(store, entry);
  }

  function open({ x, y, tap = false, mode: wanted } = {}) {
    mode = wanted === 'walk' ? 'walk' : 'plan';
    if (root || (mode === 'plan' && store.ui.view !== '2d')) return false;
    cats = categories().map((c) => ({ ...c }));
    entryList = allEntries(catalogue);
    const byKey = new Map(entryList.map((e) => [e.key, e]));
    SLOTS = loadSlots(catalogue).map((key, i) => ({ id: `slot${i}`, key, entry: key ? byKey.get(key) || null : null }));
    // In Walk mode the pointer is not tracked (it was locked), so the wheel opens in the middle of the screen.
    const px = x ?? (mode === 'walk' ? window.innerWidth / 2 : pointer.x);
    const py = y ?? (mode === 'walk' ? window.innerHeight / 2 : pointer.y);
    const half = SIZE / 2;
    centre = {
      x: Math.max(Math.min(half, window.innerWidth / 2), Math.min(window.innerWidth - half, px)),
      y: Math.max(Math.min(half, window.innerHeight / 2), Math.min(window.innerHeight - half, py)),
    };
    active = null;
    hover = null;
    ring = buildRing();
    fanLayer = h('div', { class: 'ps-wheel-fan' });
    hub = h('div', { class: 'ps-wheel-hub' });
    const face = h('div', { class: 'ps-wheel', style: { left: `${centre.x - half}px`, top: `${centre.y - half}px`, width: `${SIZE}px`, height: `${SIZE}px` } }, ring, labels(), fanLayer, hub);
    root = h('div', { class: 'ps-wheel-scrim', role: 'dialog', 'aria-label': 'Inventory wheel', dataset: { ps: 'wheel', mode } }, face);
    root.addEventListener('pointermove', (e) => track(e.clientX, e.clientY));
    root.addEventListener('click', (e) => {
      track(e.clientX, e.clientY);
      if (!commit()) close();
    });
    root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      close();
    });
    host.append(root);
    paint();
    track(px, py);
    holding = !tap;
    heldSince = performance.now();
    return true;
  }

  function close() {
    if (!root) return;
    clearTimeout(pendingTimer);
    pending = null;
    root.remove();
    root = null;
    tiles = [];
    active = null;
    hover = null;
    holding = false;
  }

  // Keys ----------------------------------------------------------------------------------------------------------------
  const modalOpen = () => !!document.querySelector('.ps-modal, .ps-popover');
  function onKeyDown(e) {
    if (root) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if ((e.key === 'q' || e.key === 'Q') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        // A tap toggled the wheel open; the next tap closes it. Holding (auto repeat) does nothing.
        if (!e.repeat && !holding) close();
        return;
      }
      if (!e.ctrlKey && !e.metaKey && e.key !== 'Shift') {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if ((e.key !== 'q' && e.key !== 'Q') || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (isTyping(e.target) || modalOpen() || e.defaultPrevented) return;
    if (store.ui.view !== '2d') return; // in Walk mode the 3D viewer opens the wheel itself
    e.preventDefault();
    open();
  }
  function onKeyUp(e) {
    if ((e.key !== 'q' && e.key !== 'Q') || !root || !holding) return;
    holding = false;
    if (performance.now() - heldSince >= HOLD_MS) {
      if (!commit({ fromKey: true })) close();
    }
    // A short tap leaves the wheel open until an item is clicked, Q is tapped again or Esc is pressed.
  }
  const onPointer = (e) => {
    pointer = { x: e.clientX, y: e.clientY };
  };
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('pointermove', onPointer, { passive: true, capture: true });
  const off = store.on('ui', (patch = {}) => {
    if ('view' in patch && store.ui.view !== (mode === 'walk' ? 'walk' : '2d')) close();
  });
  window.addEventListener('blur', close);

  return {
    open,
    close,
    isOpen,
    dispose() {
      close();
      off?.();
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('pointermove', onPointer, true);
      window.removeEventListener('blur', close);
    },
  };
}
