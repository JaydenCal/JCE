// Inventory: every catalogue item and every opening, tank and stair preset, plus the 8 quick slots of the Q wheel.
// Slots are saved in localStorage 'ps.wheel.slots' as an array of 8 entry keys (or null).
//   item:<furniture id>   opening:<kind>:<preset id>   tank:<capacity L>   stairs

import { h, clear, storage } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { drawItemPreview } from './preview.js';
import { setTool } from './toolstate.js';
import { getPresets, tankChoices } from '../editor2d/presets.js';
import { DOOR_FAMILY, KIND_LABEL } from '../editor2d/tools-meta.js';

export const SLOT_COUNT = 8;
export const SLOTS_KEY = 'ps.wheel.slots';
const titleCase = (s) => String(s || '').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
const KIND_ICON = { door: 'door', window: 'window', sliding_door: 'door', garage_door: 'door', roller_door: 'door', opening: 'door' };

export function furnitureOf(catalogue) {
  const f = catalogue?.FURNITURE;
  return Array.isArray(f) ? f : f && typeof f === 'object' ? Object.values(f) : [];
}

// All entries, grouped. Each: { key, type, label, group, icon, def?, kind?, preset?, capacityL? }
export function buildEntries(catalogue) {
  const out = [];
  const cats = new Map((Array.isArray(catalogue?.CATEGORIES) ? catalogue.CATEGORIES : []).map((c) => (typeof c === 'string' ? [c, titleCase(c)] : [c.id ?? c.name, c.label ?? c.name ?? titleCase(c.id)])));
  for (const def of furnitureOf(catalogue)) {
    out.push({ key: `item:${def.id}`, type: 'item', label: def.name || titleCase(def.id), group: cats.get(def.category) || titleCase(def.category) || 'Furniture', category: def.category, icon: 'furniture', def });
  }
  for (const kind of DOOR_FAMILY) {
    for (const preset of getPresets(catalogue, kind)) {
      out.push({ key: `opening:${kind}:${preset.id}`, type: 'opening', kind, preset, label: preset.name || `${KIND_LABEL[kind]} ${preset.width}`, group: kind === 'window' ? 'Windows' : 'Doors and openings', icon: KIND_ICON[kind] || 'door' });
    }
  }
  for (const t of tankChoices(catalogue)) out.push({ key: `tank:${t.capacityL}`, type: 'tank', capacityL: t.capacityL, label: `Tank ${t.name}`, group: 'Tanks and stairs', icon: 'tank' });
  out.push({ key: 'stairs', type: 'stairs', label: 'Stairs', group: 'Tanks and stairs', icon: 'stairs' });
  return out;
}
// Windows are not in DOOR_FAMILY, so add them explicitly (kept out of the loop above to preserve group order).
export function allEntries(catalogue) {
  const base = buildEntries(catalogue);
  const wins = getPresets(catalogue, 'window').map((preset) => ({ key: `opening:window:${preset.id}`, type: 'opening', kind: 'window', preset, label: preset.name || `Window ${preset.width}`, group: 'Windows', icon: 'window' }));
  const at = base.findIndex((e) => e.type === 'tank');
  base.splice(at < 0 ? base.length : at, 0, ...wins);
  return base;
}

export function defaultSlots(catalogue) {
  const first = (kind) => `opening:${kind}:${getPresets(catalogue, kind)[0]?.id}`;
  const tank = tankChoices(catalogue).find((t) => t.capacityL === 5000) || tankChoices(catalogue)[0];
  return [first('door'), first('window'), first('sliding_door'), tank ? `tank:${tank.capacityL}` : null, 'stairs', null, null, null];
}

export function loadSlots(catalogue) {
  try {
    const raw = storage.get(SLOTS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        const out = arr.slice(0, SLOT_COUNT).map((k) => (typeof k === 'string' ? k : null));
        while (out.length < SLOT_COUNT) out.push(null);
        return out;
      }
    }
  } catch {
    /* fall back to the defaults */
  }
  return defaultSlots(catalogue);
}

export function saveSlots(slots) {
  try {
    storage.set(SLOTS_KEY, JSON.stringify(slots.slice(0, SLOT_COUNT)));
  } catch {
    /* storage blocked: the slots last for this session only */
  }
}

// What choosing an entry does in the plan view. Returns true when something was armed.
export function runEntry(store, entry) {
  if (!entry) return false;
  if (entry.type === 'item') setTool(store, 'furniture', entry.def.id);
  else if (entry.type === 'opening') setTool(store, entry.kind, entry.preset.id);
  else if (entry.type === 'tank') setTool(store, 'tank', entry.capacityL);
  else if (entry.type === 'stairs') setTool(store, 'stairs');
  else return false;
  return true;
}

// What choosing an entry does while walking. Only furniture and openings can be placed ahead of the player.
export const walkable = (entry) => !!entry && (entry.type === 'item' || (entry.type === 'opening' && (entry.kind === 'door' || entry.kind === 'window' || entry.kind === 'sliding_door')));
export function runEntryWalk(getViewer, entry) {
  if (!walkable(entry)) return false;
  const v = getViewer?.();
  if (entry.type === 'item') v?.placeItemAhead?.(entry.def.id);
  else v?.armOpeningAhead?.(entry.preset);
  return !!v;
}

// Small picture for an entry: the furniture symbol, or a line icon.
export function entryGlyph(entry, size = 34) {
  if (entry?.type === 'item') {
    const canvas = h('canvas', { 'aria-hidden': 'true' });
    // Drawn after the node is in the page, so theme colours resolve.
    requestAnimationFrame(() => drawItemPreview(canvas, entry.def, size));
    drawItemPreview(canvas, entry.def, size);
    return canvas;
  }
  return icon(entry?.icon || 'info', { size: Math.round(size * 0.62) });
}

// The Inventory panel -------------------------------------------------------------------------------------------------------------
export function createInventory({ store, catalogue, onChange } = {}) {
  let handle = null;

  function open() {
    if (handle) return handle;
    const entries = allEntries(catalogue);
    const byKey = new Map(entries.map((e) => [e.key, e]));
    let slots = loadSlots(catalogue);
    let picked = null; // entry key chosen by click, waiting for a slot
    let query = '';
    const list = h('div', { class: 'ps-inv-list' });
    const diagram = h('div', { class: 'ps-inv-wheel', role: 'group', 'aria-label': 'Quick slots' });
    const hint = h('p', { class: 'ps-hint ps-inv-hint' });
    const search = h('input', { class: 'ps-input', type: 'search', placeholder: 'Search the inventory', 'aria-label': 'Search the inventory', autocomplete: 'off', spellcheck: 'false' });

    const commitSlots = () => {
      saveSlots(slots);
      onChange?.(slots);
    };
    const assign = (i, key) => {
      if (!byKey.has(key)) return;
      slots[i] = key;
      picked = null;
      commitSlots();
      renderAll();
    };
    const clearSlot = (i) => {
      slots[i] = null;
      commitSlots();
      renderAll();
    };

    function renderList() {
      clear(list);
      const q = query.trim().toLowerCase();
      const groups = new Map();
      for (const e of entries) {
        if (q && !`${e.label} ${e.group}`.toLowerCase().includes(q)) continue;
        if (!groups.has(e.group)) groups.set(e.group, []);
        groups.get(e.group).push(e);
      }
      if (!groups.size) list.append(h('div', { class: 'ps-empty' }, 'Nothing matches that search.'));
      for (const [group, items] of groups) {
        const grid = h('div', { class: 'ps-inv-grid' });
        for (const e of items) {
          const used = slots.includes(e.key);
          grid.append(h('button', {
            class: `ps-inv-item${used ? ' is-used' : ''}`, type: 'button', draggable: 'true', title: e.label, 'aria-pressed': String(picked === e.key), dataset: { key: e.key },
            onclick: () => {
              picked = picked === e.key ? null : e.key;
              renderList();
              renderHint();
            },
            ondragstart: (ev) => {
              try {
                ev.dataTransfer.setData('text/plain', e.key);
                ev.dataTransfer.effectAllowed = 'copy';
              } catch {
                /* synthetic events may have no dataTransfer */
              }
              picked = e.key;
              diagram.classList.add('is-dragging');
            },
            ondragend: () => diagram.classList.remove('is-dragging'),
          }, entryGlyph(e, 36), h('span', null, e.label)));
        }
        list.append(h('div', { class: 'ps-inv-group' }, h('h4', null, group), grid));
      }
    }

    function renderHint() {
      const e = picked ? byKey.get(picked) : null;
      hint.textContent = e ? `${e.label} selected. Choose a slot on the wheel to put it there.` : 'Drag an item onto a slot, or click an item and then a slot. Slots appear in the outer ring of the Q wheel.';
    }

    function renderDiagram() {
      clear(diagram);
      const R = 112;
      const c = 150;
      slots.forEach((key, i) => {
        const entry = key ? byKey.get(key) : null;
        const a = (i / SLOT_COUNT) * Math.PI * 2;
        const slot = h('div', { class: `ps-inv-slot${entry ? ' is-filled' : ''}`, style: { left: `${c + R * Math.sin(a)}px`, top: `${c - R * Math.cos(a)}px` }, dataset: { slot: String(i) } });
        const btn = h('button', {
          class: 'ps-inv-slot-btn', type: 'button', title: entry ? `Slot ${i + 1}: ${entry.label}` : `Slot ${i + 1}: empty`, 'aria-label': entry ? `Slot ${i + 1}, ${entry.label}` : `Slot ${i + 1}, empty`, dataset: { slotBtn: String(i) },
          onclick: () => {
            if (picked) assign(i, picked);
          },
          ondragover: (ev) => {
            ev.preventDefault();
            btn.classList.add('is-over');
          },
          ondragleave: () => btn.classList.remove('is-over'),
          ondrop: (ev) => {
            ev.preventDefault();
            btn.classList.remove('is-over');
            let key2 = null;
            try {
              key2 = ev.dataTransfer?.getData('text/plain');
            } catch {
              key2 = null;
            }
            assign(i, key2 && byKey.has(key2) ? key2 : picked);
          },
        }, entry ? entryGlyph(entry, 34) : h('span', { class: 'ps-inv-slot-n' }, String(i + 1)));
        slot.append(btn);
        if (entry) slot.append(h('button', { class: 'ps-inv-slot-x', type: 'button', 'aria-label': `Clear slot ${i + 1}`, title: 'Clear this slot', dataset: { clearSlot: String(i) }, onclick: () => clearSlot(i) }, icon('close', { size: 10 })));
        diagram.append(slot);
      });
      diagram.append(h('div', { class: 'ps-inv-centre' }, icon('wheel', { size: 26 }), h('span', null, 'Q wheel')));
    }

    function renderAll() {
      renderList();
      renderDiagram();
      renderHint();
    }

    search.addEventListener('input', () => {
      query = search.value;
      renderList();
    });
    renderAll();

    handle = openModal({
      title: 'Inventory',
      size: 'lg',
      body: h('div', { class: 'ps-inv' },
        h('div', { class: 'ps-inv-left' }, search, list),
        h('div', { class: 'ps-inv-right' }, diagram, hint,
          h('button', { class: 'ps-btn ps-btn--sm', type: 'button', dataset: { action: 'reset-slots' }, onclick: () => {
            slots = defaultSlots(catalogue);
            picked = null;
            commitSlots();
            renderAll();
          } }, 'Reset slots'))),
      footer: (close) => h('button', { class: 'ps-btn ps-btn--primary', type: 'button', onclick: () => close('done') }, 'Done'),
      onClose: () => {
        handle = null;
      },
    });
    return handle;
  }

  return { open, close: () => handle?.close('dismiss'), isOpen: () => !!handle, slots: () => loadSlots(catalogue), entries: () => allEntries(catalogue) };
}
