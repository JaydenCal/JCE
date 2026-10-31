// Finish picker: a small card shown when a surface is clicked in the 3D view. The description of what
// can be changed (describeHit) is pure logic; the card itself is a DOM overlay inside the viewer.

import { DEFAULT_FINISHES } from '../model/schema.js';
import { resolveFloorFinish } from './build.js';
import { resolveHex } from './materials.js';

const WALL_MATERIALS = ['brick', 'render', 'weatherboard', 'vertical_cladding', 'grooved_cladding', 'stone', 'concrete', 'corrugated', 'trimdek', 'standing_seam'];
const BUILTIN_MATERIALS = {
  external_walls: WALL_MATERIALS,
  internal_walls: ['paint'],
  roof: ['corrugated', 'trimdek', 'standing_seam', 'concrete_tile', 'terracotta_tile'],
  floors: ['timber', 'tile', 'carpet', 'polished_concrete', 'vinyl', 'decking'],
  fascia: [],
  frames: [],
  tank: [],
};
// Used only when no catalogue is available. Ids are hex codes, which the viewer also understands.
const BUILTIN_SWATCHES = [
  ['#f2efe8', 'White'], ['#d9d4c7', 'Cream'], ['#b8b2a7', 'Light grey'], ['#8c8f91', 'Grey'],
  ['#5a5f63', 'Slate'], ['#3c4045', 'Charcoal'], ['#1f2123', 'Black'], ['#9b6a4a', 'Terracotta'],
  ['#6e4b34', 'Brown'], ['#b99b6b', 'Sand'], ['#5c7a5a', 'Green'], ['#4d6a8a', 'Blue'],
].map(([id, name]) => ({ id, name, hex: id }));

const titleCase = (id) => String(id || '').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

function norm(item, kind, catalogue) {
  if (item == null) return null;
  const id = typeof item === 'string' ? item : item.id;
  if (!id) return null;
  let name = typeof item === 'object' ? item.name : null;
  let hex = typeof item === 'object' ? item.hex : null;
  try {
    if (kind === 'colour') {
      const c = catalogue?.finishes?.getColour?.(id);
      name = name || c?.name;
      hex = hex || c?.hex;
    } else {
      name = name || catalogue?.finishes?.getMaterial?.(id)?.name;
    }
  } catch {
    /* use fallbacks */
  }
  return { id, name: name || titleCase(id), hex: hex || (kind === 'colour' ? resolveHex(catalogue, id) : null) };
}

function listOf(fn) {
  try {
    const r = fn();
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}

export function materialsForTarget(catalogue, target) {
  let items = listOf(() => catalogue?.finishes?.materialsFor?.(target));
  if (!items.length && !catalogue?.finishes?.materialsFor) items = BUILTIN_MATERIALS[target] || [];
  return items.map((m) => norm(m, 'material', catalogue)).filter(Boolean);
}

export function coloursForTarget(catalogue, target, materialId) {
  const tries = [];
  if (materialId) tries.push(materialId);
  tries.push(target);
  if (target === 'frames') tries.push('frame');
  if (target === 'fascia') tries.push('steel', 'corrugated');
  if (target === 'tank') tries.push('steel', 'corrugated');
  for (const key of tries) {
    const items = listOf(() => catalogue?.finishes?.coloursFor?.(key));
    if (items.length) return items.map((c) => norm(c, 'colour', catalogue)).filter(Boolean);
  }
  return catalogue?.finishes?.coloursFor ? [] : BUILTIN_SWATCHES;
}

const mergeFinish = (base, over) => ({ material: over?.material ?? base?.material ?? null, colour: over?.colour ?? base?.colour ?? null });

// What a click on this hit can change. hit: { kind, id, levelId, face, slot }.
export function describeHit(project, hit, catalogue = null, find = () => null) {
  const fin = project.finishes || DEFAULT_FINISHES;
  const found = find(hit.id);
  const item = found?.item || null;
  switch (hit.kind) {
    case 'wall': {
      const interior = item?.kind === 'interior';
      const inside = interior || hit.face === 'inside';
      const target = inside ? 'internal_walls' : 'external_walls';
      const base = inside ? fin.internalWalls : fin.externalWalls;
      const own = interior || !inside ? item?.finish : null;
      return {
        title: inside ? 'Inside walls' : 'Walls',
        target,
        apply: 'set',
        current: mergeFinish(base, own),
        hasMaterial: true,
        scope: item && (interior || !inside) ? { label: 'This wall only', checked: !!item.finish, id: item.id, op: 'update_wall' } : null,
        item,
      };
    }
    case 'roof': {
      if (hit.slot === 'gable') {
        return { title: 'Walls', target: 'external_walls', apply: 'set', current: mergeFinish(DEFAULT_FINISHES.externalWalls, fin.externalWalls), hasMaterial: true, scope: null, item: null };
      }
      if (hit.slot === 'fascia') {
        return { title: 'Fascia and gutters', target: 'fascia', apply: 'set', current: { material: null, colour: fin.fascia?.colour ?? null }, hasMaterial: false, scope: null, item: null };
      }
      return { title: 'Roof', target: 'roof', apply: 'set', current: mergeFinish(DEFAULT_FINISHES.roof, fin.roof), hasMaterial: true, scope: null, item: null };
    }
    case 'opening': {
      const door = item?.kind === 'garage_door' || item?.kind === 'roller_door';
      return {
        title: door ? 'Garage door' : 'Window frames',
        target: door ? 'fascia' : 'frames',
        apply: 'set',
        current: { material: null, colour: (door ? fin.fascia : fin.frames)?.colour ?? null },
        hasMaterial: false,
        scope: null,
        item,
      };
    }
    case 'floor':
    case 'deck': {
      const room = found?.kind === 'room' ? item : null;
      // Prefer the live room over the finish recorded when the mesh was built, so the card stays current after a change.
      const base = mergeFinish(DEFAULT_FINISHES.floors, fin.floors);
      const eff = room ? resolveFloorFinish(room, base, catalogue) : hit.finish || base;
      return {
        title: hit.kind === 'deck' ? 'Deck' : 'Floor',
        target: 'floors',
        apply: room ? 'room' : 'set',
        current: { material: eff.material ?? null, colour: eff.colour ?? null },
        hasMaterial: true,
        scope: room ? { label: 'This room only', checked: true, id: room.id, op: 'update_room' } : null,
        item: room,
      };
    }
    case 'tank': {
      return { title: 'Tank', target: 'tank', apply: 'tank', current: { material: null, colour: item?.colour ?? null }, hasMaterial: false, scope: null, item };
    }
    default:
      return null;
  }
}

// The store operation for a choice. scopeOn: the checkbox state. Returns { op, args }.
export function operationFor(desc, choice, scopeOn) {
  const { material, colour } = choice;
  if (desc.apply === 'tank') return { op: 'update_tank', args: { id: desc.item.id, colour } };
  if (desc.scope && scopeOn) {
    if (desc.scope.op === 'update_wall') return { op: 'update_wall', args: { id: desc.scope.id, ...(material ? { finish_material: material } : {}), ...(colour ? { finish_colour: colour } : {}) } };
    if (desc.scope.op === 'update_room') return { op: 'update_room', args: { id: desc.scope.id, ...(material ? { floor_material: material } : {}), ...(colour ? { floor_colour: colour } : {}) } };
  }
  return { op: 'set_finish', args: { target: desc.target, ...(material ? { material } : {}), ...(colour ? { colour } : {}) } };
}

// DOM card ------------------------------------------------------------------------------------------
export function createPicker({ container, store, catalogue }) {
  const card = document.createElement('div');
  card.className = 'ps3d-picker';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Change finish');
  card.tabIndex = -1;
  card.hidden = true;
  container.appendChild(card);
  let hit = null;
  let pos = { x: 0, y: 0 };
  let scopeOn = false;
  let message = '';
  let open = false;

  const on = (el, ev, fn) => el.addEventListener(ev, fn);

  function currentDesc() {
    return hit ? describeHit(store.project, hit, catalogue, (id) => store.find(id)) : null;
  }

  function render() {
    const desc = currentDesc();
    if (!desc) {
      close();
      return;
    }
    const mats = desc.hasMaterial ? materialsForTarget(catalogue, desc.target) : [];
    const curMat = desc.current.material;
    const colours = coloursForTarget(catalogue, desc.target, desc.hasMaterial ? curMat : null);
    const matName = curMat ? norm(curMat, 'material', catalogue).name : null;
    const colName = desc.current.colour ? norm(desc.current.colour, 'colour', catalogue).name : null;
    card.textContent = '';
    const head = document.createElement('div');
    head.className = 'ps3d-picker-head';
    const title = document.createElement('strong');
    title.textContent = desc.title;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'ps3d-x';
    x.setAttribute('aria-label', 'Close');
    x.textContent = '×';
    on(x, 'click', close);
    head.append(title, x);
    const cur = document.createElement('div');
    cur.className = 'ps3d-picker-cur';
    cur.textContent = [matName, colName].filter(Boolean).join(', ') || 'Current finish';
    card.append(head, cur);

    if (mats.length > 1) {
      const row = document.createElement('div');
      row.className = 'ps3d-chips';
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', 'Material');
      for (const m of mats) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ps3d-chipbtn';
        b.textContent = m.name;
        b.setAttribute('aria-pressed', String(m.id === curMat));
        on(b, 'click', () => choose(desc, { material: m.id, colour: pickColourFor(desc, m.id, desc.current.colour) }));
        row.appendChild(b);
      }
      card.appendChild(row);
    }
    if (colours.length) {
      const row = document.createElement('div');
      row.className = 'ps3d-swatches';
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', 'Colour');
      for (const c of colours) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ps3d-swatch';
        b.style.background = c.hex || '#c8c8c8';
        b.title = c.name;
        b.setAttribute('aria-label', c.name);
        b.setAttribute('aria-pressed', String(c.id === desc.current.colour));
        on(b, 'click', () => choose(desc, { material: desc.hasMaterial ? curMat : null, colour: c.id }));
        row.appendChild(b);
      }
      card.appendChild(row);
    }
    if (desc.scope) {
      const lab = document.createElement('label');
      lab.className = 'ps3d-check';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = scopeOn;
      on(cb, 'change', () => {
        scopeOn = cb.checked;
      });
      lab.append(cb, document.createTextNode(` ${desc.scope.label}`));
      card.appendChild(lab);
    }
    const msg = document.createElement('div');
    msg.className = 'ps3d-msg';
    msg.setAttribute('role', 'status');
    msg.textContent = message;
    card.appendChild(msg);
    place();
  }

  function pickColourFor(desc, materialId, currentColour) {
    const list = coloursForTarget(catalogue, desc.target, materialId);
    if (!list.length) return currentColour;
    if (list.some((c) => c.id === currentColour)) return currentColour;
    let preferred = null;
    try {
      preferred = materialId ? catalogue?.finishes?.defaultColour?.(materialId) : null;
    } catch {
      preferred = null;
    }
    return preferred && list.some((c) => c.id === preferred) ? preferred : list[0].id;
  }

  function choose(desc, choice) {
    const { op, args } = operationFor(desc, choice, scopeOn);
    try {
      store.run(op, args);
      message = '';
    } catch (e) {
      message = e?.message || 'That change could not be applied.';
    }
    render();
  }

  function place() {
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const w = card.offsetWidth || 260;
    const h = card.offsetHeight || 220;
    const narrow = cw < 560;
    if (narrow) {
      card.style.width = 'auto';
      card.style.left = '8px';
      card.style.right = '8px';
      card.style.top = 'auto';
      card.style.bottom = '8px';
    } else {
      card.style.width = '';
      card.style.right = 'auto';
      card.style.bottom = 'auto';
      card.style.left = `${Math.max(8, Math.min(cw - w - 8, pos.x + 14))}px`;
      card.style.top = `${Math.max(8, Math.min(ch - h - 8, pos.y + 14))}px`;
    }
  }

  function onDocDown(e) {
    if (open && !card.contains(e.target)) close();
  }
  function onKey(e) {
    if (open && e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  }
  const offProject = store.on('project', () => {
    if (open) render();
  });

  function show(h, x, y) {
    hit = h;
    pos = { x, y };
    message = '';
    const desc = currentDesc();
    if (!desc) return false;
    scopeOn = desc.scope ? desc.scope.checked : false;
    open = true;
    card.hidden = false;
    render();
    document.addEventListener('pointerdown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
    return true;
  }

  function close() {
    if (!open && card.hidden) return;
    open = false;
    card.hidden = true;
    hit = null;
    document.removeEventListener('pointerdown', onDocDown, true);
    document.removeEventListener('keydown', onKey, true);
  }

  return {
    open: show,
    close,
    isOpen: () => open,
    dispose() {
      close();
      offProject?.();
      card.remove();
    },
  };
}
