// Properties forms for the selected element. Every change is one store.run operation.

import * as G from '../model/geometry.js';
import { findEntity, classifyWalls } from '../model/ops.js';
import { ROOM_TYPES, ROOM_LABELS, OUTDOOR_TYPES, WINDOW_STYLES } from '../model/schema.js';
import { patchStair } from '../editor2d/edit.js';
import { getPresets, tankChoices } from '../editor2d/presets.js';
import { OPENING_LABELS, STYLE_LABELS, roomAreaM2, roofPlanAreaM2 } from './schedules.js';
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { numberField, textField, selectField, checkField, button, readout, row, section, formBuilder, presetChips } from './panel-forms.js';
import { WALL_PRESETS } from './wall-presets.js';

const STATUS_OPTIONS = [['new', 'New'], ['existing', 'Existing'], ['demolish', 'Demolish']];
const rotNorm = (r) => ((Math.round(r) % 360) + 360) % 360;
const isRect = (poly) => {
  if (poly.length !== 4) return false;
  const bb = G.bbox(poly);
  return Math.abs(bb.w * bb.h - G.polygonArea(poly)) < 1000;
};

// Material and colour selectors for a finish override. `clear` (optional) adds a "House default" choice.
function finishFields(ctx, fb, { title, target, get, commit, clear: clearFn }) {
  const fin = ctx.catalogue?.finishes;
  if (!fin?.materialsFor) return null;
  const norm = (list) => (list || []).map((m) => (typeof m === 'string' ? { value: m, label: m } : { value: m.id, label: m.name || m.id }));
  const mats = norm(fin.materialsFor(target));
  if (!mats.length) return null;
  const colours = (m) => norm(fin.coloursFor?.(m));
  const matSel = h('select', { class: 'ps-select', id: `psf-m-${Math.random().toString(36).slice(2, 7)}`, 'aria-label': `${title} material` });
  const colSel = h('select', { class: 'ps-select', id: `psf-c-${Math.random().toString(36).slice(2, 7)}`, 'aria-label': `${title} colour` });
  const fillColours = (m, want) => {
    clear(colSel);
    for (const c of colours(m)) colSel.append(h('option', { value: c.value }, c.label));
    if (want && [...colSel.options].some((o) => o.value === want)) colSel.value = want;
  };
  const refresh = () => {
    const f = get();
    clear(matSel);
    if (clearFn) matSel.append(h('option', { value: '' }, 'House default'));
    for (const m of mats) matSel.append(h('option', { value: m.value }, m.label));
    matSel.value = f?.material ?? (clearFn ? '' : mats[0].value);
    if (clearFn && !f?.material) {
      clear(colSel);
      colSel.append(h('option', { value: '' }, 'House default'));
      colSel.disabled = true;
    } else {
      colSel.disabled = false;
      fillColours(matSel.value, f?.colour);
    }
  };
  matSel.addEventListener('change', () => {
    if (!matSel.value) return clearFn();
    const options = colours(matSel.value);
    const keep = options.some((c) => c.value === get()?.colour) ? get().colour : options[0]?.value;
    commit({ material: matSel.value, colour: keep });
  });
  colSel.addEventListener('change', () => commit({ colour: colSel.value }));
  refresh();
  return fb.add({ el: h('div', null, row(`${title}`, matSel, { id: matSel.id }), row('Colour', colSel, { id: colSel.id })), refresh });
}

const niceId = (s) => String(s || '').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function buildElementForm(ctx, found) {
  const { store } = ctx;
  const id = found.item.id;
  const kind = found.kind;
  const cur = () => store.find(id)?.item;
  const fb = formBuilder();
  const root = h('div', { class: 'ps-form' });
  const add = (f) => root.append(fb.add(f));
  const num = (label, get, commit, extra = {}) => add(numberField({ label, get, commit, ...extra }));
  const status = (label = 'Status') =>
    add(selectField({ label, options: STATUS_OPTIONS, get: () => cur()?.status || 'new', commit: (v) => ctx.run('set_status', { ids: [id], status: v }) }));
  const remove = (what) =>
    root.append(h('div', { class: 'ps-sec' }, button(`Delete ${what}`, () => ctx.remove(id, what), { cls: 'ps-btn--danger', icon: icon('trash', { size: 16 }) })));
  const title = (a, b) => root.append(h('div', { class: 'ps-sel-title' }, h('strong', null, a), b ? h('span', null, b) : null));

  if (kind === 'room') {
    const r = found.item;
    title(r.name || ROOM_LABELS[r.type], r.outdoor ? 'Outdoor area' : 'Room');
    add(textField({ label: 'Name', get: () => cur()?.name, commit: (v) => ctx.run('update_room', { id, name: v }) }));
    const types = (r.outdoor ? OUTDOOR_TYPES : ROOM_TYPES.filter((t) => !OUTDOOR_TYPES.includes(t))).map((t) => [t, ROOM_LABELS[t]]);
    add(selectField({ label: 'Type', options: types, get: () => cur()?.type, commit: (v) => ctx.run('update_room', { id, type: v }) }));
    status();
    const a = readout('Area', '');
    const area = { el: a.el, refresh() { const c = cur(); if (c) a.set(`${roomAreaM2(c).toFixed(2)} m²`); } };
    add(area);
    const rect = isRect(r.polygon);
    const bb = () => G.bbox(cur().polygon);
    if (rect) {
      num('Width', () => cur() && bb().w, (n) => ctx.run('resize_room', { id, side: 'east', delta: n - bb().w }), { min: 300 });
      num('Depth', () => cur() && bb().h, (n) => ctx.run('resize_room', { id, side: 'south', delta: n - bb().h }), { min: 300 });
    } else {
      add(readout('Bounds', `${Math.round(G.bbox(r.polygon).w)} × ${Math.round(G.bbox(r.polygon).h)} mm`));
    }
    if (r.outdoor) {
      add(checkField({ label: 'Balustrade', get: () => cur()?.balustrade, commit: (v) => ctx.run('update_room', { id, balustrade: v }) }));
      add(checkField({ label: 'Roofed (under the main roof)', get: () => cur()?.roofed, commit: (v) => ctx.run('update_room', { id, roofed: v }) }));
    }
    const floorFinish = finishFields(ctx, fb, {
      title: 'Material',
      target: 'floors',
      get: () => cur()?.floor,
      commit: (f) => ctx.run('update_room', { id, ...(f.material ? { floor_material: f.material } : {}), ...(f.colour ? { floor_colour: f.colour } : {}) }),
      clear: () => ctx.apply('Clear floor finish', () => { cur().floor = null; }),
    });
    if (floorFinish) root.append(h('div', { class: 'ps-sec-title', style: { margin: '12px 0 6px' } }, 'Floor finish'), floorFinish);
    remove('room');
  } else if (kind === 'wall') {
    const w = found.item;
    title('Wall', w.kind === 'interior' ? 'Interior' : 'Exterior');
    const len = readout('Length', '');
    add({ el: len.el, refresh() { const c = cur(); if (c) len.set(`${Math.round(G.wallLength(c)).toLocaleString('en-AU')} mm`); } });
    num('Thickness', () => cur()?.thickness, (n) => ctx.run('update_wall', { id, thickness: n }), { min: 50, max: 600, step: 10 });
    root.append(h('div', { class: 'ps-field ps-field--chips' }, h('span', { class: 'ps-field-label' }, 'Presets'),
      fb.add(presetChips({ label: 'Wall thickness presets', values: WALL_PRESETS, get: () => cur()?.thickness, commit: (n) => ctx.run('update_wall', { id, thickness: n }) }))));
    root.append(h('div', { style: { margin: '-2px 0 8px 104px' } },
      button('Use automatic thickness', () => ctx.apply('Automatic wall thickness', (p) => {
        const e = findEntity(p, id);
        e.item.auto = true;
        classifyWalls(p, e.level);
      }), { cls: 'ps-btn--sm', title: 'Interior and exterior walls take the project defaults' })));
    num('Height', () => cur()?.height, (n) => ctx.run('update_wall', { id, height: n }), { min: 300, max: 9000, step: 50, allowBlank: true, placeholder: 'Level height' });
    status();
    const wallFinish = finishFields(ctx, fb, {
      title: 'Material',
      target: w.kind === 'interior' ? 'internal_walls' : 'external_walls',
      get: () => cur()?.finish,
      commit: (f) => ctx.run('update_wall', { id, ...(f.material ? { finish_material: f.material } : {}), ...(f.colour ? { finish_colour: f.colour } : {}) }),
      clear: () => ctx.run('update_wall', { id, clear_finish: true }),
    });
    if (wallFinish) root.append(h('div', { class: 'ps-sec-title', style: { margin: '12px 0 6px' } }, 'Finish for this wall only'), wallFinish);
    const n = found.level.openings.filter((o) => o.wallId === id).length;
    root.append(h('p', { class: 'ps-hint' }, n ? `${n} opening${n > 1 ? 's' : ''} on this wall.` : 'No openings on this wall.'));
    remove('wall');
  } else if (kind === 'opening') {
    const o = found.item;
    title(OPENING_LABELS[o.kind] || 'Opening', o.kind === 'window' ? STYLE_LABELS[o.style] : null);
    num('Width', () => cur()?.width, (n) => ctx.run('update_opening', { id, width: n }), { min: 300, max: 12000, step: 10 });
    num('Height', () => cur()?.height, (n) => ctx.run('update_opening', { id, height: n }), { min: 300, max: 6000, step: 10 });
    if (o.kind === 'window') num('Sill height', () => cur()?.sill, (n) => ctx.run('update_opening', { id, sill: n }), { min: 0, max: 3000, step: 10 });
    num('Offset', () => cur()?.offset, (n) => ctx.run('update_opening', { id, offset: n }), { step: 10 });
    if (o.kind === 'window') {
      add(selectField({ label: 'Style', options: WINDOW_STYLES.map((s) => [s, STYLE_LABELS[s]]), get: () => cur()?.style, commit: (v) => ctx.run('update_opening', { id, style: v }) }));
    }
    const presets = getPresets(ctx.catalogue, o.kind);
    if (presets.length > 1) {
      const apply = (pid) => {
        const p = presets.find((x) => x.id === pid);
        if (p) ctx.run('update_opening', { id, width: p.width, height: p.height, sill: p.sill, style: p.style });
      };
      add(selectField({ label: 'Size preset', options: [['', 'Choose a preset'], ...presets.map((p) => [p.id, p.name])], get: () => '', commit: apply }));
    }
    if (o.kind === 'door') {
      root.append(h('div', { class: 'ps-row', style: { margin: '4px 0 8px' } },
        button('Flip swing', () => ctx.run('update_opening', { id, side: cur().side === -1 ? 1 : -1 }), { icon: icon('flip', { size: 16 }), title: 'Tab' }),
        button('Flip hinge', () => ctx.run('update_opening', { id, hinge: cur().hinge === 'b' ? 'a' : 'b' }), { icon: icon('flip', { size: 16 }), title: 'Shift and Tab' })));
    }
    status();
    remove(OPENING_LABELS[o.kind]?.toLowerCase() || 'opening');
  } else if (kind === 'furniture') {
    const f = found.item;
    const def = ctx.catalogue?.getFurniture?.(f.item);
    title(def?.name || niceId(f.item), def?.category ? niceId(def.category) : 'Furniture');
    num('X', () => cur()?.x, (n) => ctx.run('update_furniture', { id, x: n }), { step: 50 });
    num('Y', () => cur()?.y, (n) => ctx.run('update_furniture', { id, y: n }), { step: 50 });
    num('Rotation', () => cur()?.rotation, (n) => ctx.run('update_furniture', { id, rotation: rotNorm(n) }), { unit: '°', min: 0, max: 359 });
    root.append(h('div', { class: 'ps-row', style: { margin: '0 0 8px' } },
      button('Rotate left', () => ctx.run('update_furniture', { id, rotation: rotNorm((cur().rotation || 0) - 90) }), { icon: icon('rotate', { size: 16 }), title: 'Comma' }),
      button('Rotate right', () => ctx.run('update_furniture', { id, rotation: rotNorm((cur().rotation || 0) + 90) }), { icon: icon('rotate', { size: 16 }), title: 'Full stop' })));
    num('Width', () => cur()?.w ?? def?.w, (n) => ctx.run('update_furniture', { id, w: n }), { min: 100, max: 20000, step: 50 });
    num('Depth', () => cur()?.d ?? def?.d, (n) => ctx.run('update_furniture', { id, d: n }), { min: 100, max: 20000, step: 50 });
    if (f.w != null || f.d != null) root.append(h('div', { class: 'ps-sec' }, button('Reset to catalogue size', () => ctx.apply('Reset size', () => { const c = cur(); c.w = null; c.d = null; }))));
    remove('item');
  } else if (kind === 'stair') {
    title('Stairs', 'Straight flight');
    const edit = (patch) => ctx.apply('Edit stairs', (p) => patchStair(p, id, patch));
    num('X', () => cur()?.x, (n) => edit({ x: n }), { step: 50 });
    num('Y', () => cur()?.y, (n) => edit({ y: n }), { step: 50 });
    num('Width', () => cur()?.width, (n) => edit({ width: n }), { min: 600, max: 3000, step: 50 });
    num('Run length', () => cur()?.length, (n) => edit({ length: n }), { min: 1000, max: 8000, step: 50 });
    num('Rotation', () => cur()?.rotation, (n) => edit({ rotation: n }), { unit: '°', min: 0, max: 359 });
    root.append(h('div', { class: 'ps-row', style: { margin: '0 0 8px' } },
      button('Rotate left', () => edit({ rotation: (cur().rotation || 0) - 90 }), { icon: icon('rotate', { size: 16 }), title: 'Comma' }),
      button('Rotate right', () => edit({ rotation: (cur().rotation || 0) + 90 }), { icon: icon('rotate', { size: 16 }), title: 'Full stop' })));
    root.append(h('p', { class: 'ps-hint' }, 'The arrow points up the run, from the bottom step.'));
    remove('stairs');
  } else if (kind === 'tank') {
    const t = found.item;
    title('Rainwater tank', `${t.capacityL.toLocaleString('en-AU')} L`);
    add(selectField({
      label: 'Capacity',
      options: tankChoices(ctx.catalogue).map((c) => [String(c.capacityL), c.name]),
      get: () => String(cur()?.capacityL),
      commit: (v) => ctx.run('update_tank', { id, capacity_l: Number(v) }),
    }));
    const dims = readout('Size', '');
    add({ el: dims.el, refresh() { const c = cur(); if (c) dims.set(`Ø${c.diameter} × ${c.height} mm`); } });
    num('X', () => cur()?.x, (n) => ctx.run('update_tank', { id, x: n }), { step: 50 });
    num('Y', () => cur()?.y, (n) => ctx.run('update_tank', { id, y: n }), { step: 50 });
    status();
    const roof = roofPlanAreaM2(store.project);
    root.append(h('div', { class: 'ps-note-box' },
      h('div', { class: 'ps-label' }, 'Connected roof area'),
      h('div', { class: 'ps-mono', style: { fontSize: '15px', color: 'var(--ps-text)', margin: '2px 0' } }, `${roof.toFixed(1)} m² on plan`),
      'Approximate plan area of all roofs including eaves. The area that drains to this tank depends on gutters and downpipes.'));
    remove('tank');
  }

  fb.refresh();
  return { el: root, refresh: () => fb.refresh() };
}
