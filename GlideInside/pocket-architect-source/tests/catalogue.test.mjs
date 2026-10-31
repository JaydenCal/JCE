import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { catalogue } from '../src/catalogue/index.js';
import { DEFAULT_FINISHES, DEFAULT_FINISHES_SHED, DEFAULTS, validate, createProject } from '../src/model/schema.js';
import * as G from '../src/model/geometry.js';
import { lintProject } from '../src/catalogue/tpl/lint.js';

const F = catalogue.finishes;

test('catalogue exports the agreed names', () => {
  for (const k of ['FURNITURE', 'CATEGORIES', 'getFurniture', 'finishes', 'validateFinish', 'openings', 'tanks', 'templates', 'createFromTemplate']) {
    assert.ok(catalogue[k] !== undefined, `catalogue.${k}`);
  }
  for (const k of ['MATERIALS', 'COLOURS', 'getMaterial', 'getColour', 'materialsFor', 'coloursFor', 'findColour', 'validateFinish']) {
    assert.ok(F[k] !== undefined, `finishes.${k}`);
  }
  assert.equal(catalogue.validateFinish, F.validateFinish);
  assert.ok(catalogue.openings.OPENING_PRESETS && typeof catalogue.openings.presetsFor === 'function');
  assert.ok(Array.isArray(catalogue.tanks.TANKS));
});

test('materials: required ids, textures equal ids, every palette has colours', () => {
  const need = {
    wall: ['brick', 'render', 'weatherboard', 'vertical_cladding', 'grooved_cladding', 'stone', 'concrete', 'corrugated', 'trimdek', 'standing_seam', 'paint'],
    roof: ['corrugated', 'trimdek', 'standing_seam', 'concrete_tile', 'terracotta_tile'],
    floor: ['timber', 'tile', 'carpet', 'polished_concrete', 'vinyl', 'decking'],
  };
  for (const [target, ids] of Object.entries(need)) {
    for (const id of ids) {
      const m = F.getMaterial(id);
      assert.ok(m, `material ${id}`);
      assert.ok(m.targets.includes(target), `${id} targets ${target}`);
    }
  }
  for (const m of F.MATERIALS) {
    assert.equal(m.texture, m.id);
    assert.ok(F.COLOURS[m.palette]?.length > 0, `palette ${m.palette} for ${m.id}`);
    assert.ok(F.coloursFor(m.id).length > 0);
  }
  assert.deepEqual(F.getMaterial('paint').targets, ['wall']);
  assert.ok(!F.materialsFor('external_walls').some((m) => m.id === 'paint'), 'paint is internal only');
  assert.ok(F.materialsFor('internal_walls').some((m) => m.id === 'paint'));
  assert.deepEqual(F.materialsFor('fascia'), []);
  assert.deepEqual(F.materialsFor('frames'), []);
});

test('colours: palettes, ids, hex values, generic names and aliases', () => {
  const sizes = { steel: [20, 24], brick: [9, 12], paint: [13, 16], stone: [4, 6], tile: [7, 9], floor: [13, 16], frame: [7, 9] };
  const seen = new Set();
  for (const [palette, [lo, hi]] of Object.entries(sizes)) {
    const list = F.COLOURS[palette];
    assert.ok(list.length >= lo && list.length <= hi, `${palette} has ${list.length}`);
    for (const c of list) {
      assert.match(c.id, new RegExp(`^${palette}-[a-z0-9]+(-[a-z0-9]+)*$`));
      assert.match(c.hex, /^#[0-9a-f]{6}$/i);
      assert.ok(Array.isArray(c.aliases));
      assert.ok(c.name && !/[–—]/.test(c.name));
      assert.ok(!seen.has(c.id), `duplicate ${c.id}`);
      seen.add(c.id);
      assert.equal(F.getColour(c.id), c);
    }
  }
  for (const id of ['brick-light-grey', 'paint-white', 'steel-charcoal', 'steel-off-white', 'steel-dune', 'frame-black', 'floor-natural-oak', 'floor-concrete']) {
    assert.ok(F.getColour(id), id);
  }
  // Product colour names are aliases for matching only, never display names.
  const brandy = ['monument', 'surfmist', 'basalt', 'shale grey', 'paperbark', 'woodland grey', 'night sky', 'classic cream', 'colorbond'];
  for (const c of Object.values(F.COLOURS).flat()) {
    for (const b of brandy) assert.ok(!c.name.toLowerCase().includes(b), `${c.id} name ${c.name}`);
  }
});

test('findColour maps product names to catalogue swatches', () => {
  assert.match(F.findColour('monument').id, /^steel-/);
  assert.equal(F.findColour('monument').id, 'steel-charcoal');
  assert.equal(F.findColour('Surfmist').id, 'steel-off-white');
  assert.equal(F.findColour('dark grey', 'roof').palette, 'steel');
  assert.equal(F.findColour('terracotta', 'terracotta_tile').palette, 'tile');
  assert.equal(F.findColour('oak', 'floors').id, 'floor-natural-oak');
  assert.equal(F.findColour('black', 'frames').id, 'frame-black');
  assert.equal(F.findColour('slate').name, 'Slate');
  assert.equal(F.findColour('qzxv'), null);
  assert.equal(F.findColour(''), null);
});

test('validateFinish accepts the project defaults and rejects bad combinations', () => {
  const keys = { externalWalls: 'external_walls', internalWalls: 'internal_walls', roof: 'roof', fascia: 'fascia', frames: 'frames', floors: 'floors' };
  for (const defaults of [DEFAULT_FINISHES, DEFAULT_FINISHES_SHED]) {
    for (const [k, v] of Object.entries(defaults)) assert.ok(F.validateFinish(keys[k], v.material, v.colour), k);
  }
  // Colour-only changes accept any colour a target can use.
  assert.ok(F.validateFinish('roof', undefined, 'tile-terracotta'));
  assert.ok(F.validateFinish('roof', undefined, 'steel-black'));
  assert.ok(F.validateFinish('frames', undefined, 'steel-charcoal'));
  assert.ok(F.validateFinish('floors', 'carpet', 'floor-oatmeal'));
  assert.throws(() => F.validateFinish('roof', 'brick'), /does not suit/);
  assert.throws(() => F.validateFinish('external_walls', 'paint'), /internal walls only/);
  assert.throws(() => F.validateFinish('roof', 'corrugated', 'brick-red'), /not available/);
  assert.throws(() => F.validateFinish('floors', undefined, 'steel-charcoal'), /does not suit/);
  assert.throws(() => F.validateFinish('roof', 'corrugated', 'steel-nope'), /Unknown colour/);
  assert.throws(() => F.validateFinish('fascia', 'trimdek'), /colour only/);
  assert.throws(() => F.validateFinish('sky', 'x', 'y'), /Unknown finish target/);
  assert.throws(() => F.validateFinish('roof', 'thatch'), /Unknown material/);
});

test('opening presets follow Appendix C', () => {
  const P = catalogue.openings.presetsFor;
  const has = (kind, w, h, sill, style) => P(kind).some((p) => p.width === w && p.height === h && p.sill === sill && (!style || p.style === style));
  assert.ok(has('window', 1800, 1200, 900, 'sliding'));
  assert.ok(has('window', 1200, 1200, 900, 'sliding'));
  assert.ok(has('window', 2400, 1200, 900, 'sliding'));
  assert.ok(has('window', 600, 600, 1500, 'awning'));
  assert.ok(has('window', 1200, 600, 1500, 'awning'));
  assert.ok(has('window', 1800, 900, 1200));
  assert.ok(has('window', 900, 2100, 0, 'fixed'));
  assert.ok(has('window', 900, 1500, 600, 'double_hung'));
  assert.ok(has('window', 600, 1200, 900, 'louvre'));
  assert.ok(has('door', 820, 2040, 0) && has('door', 870, 2040, 0) && has('door', 920, 2040, 0));
  assert.ok(P('door').some((p) => p.style === 'cavity'));
  for (const w of [2100, 2400, 3000]) assert.ok(has('sliding_door', w, 2100, 0));
  assert.ok(has('garage_door', 2400, 2100, 0) && has('garage_door', 4800, 2100, 0));
  assert.ok(has('roller_door', 2700, 2400, 0) && has('roller_door', 3000, 3000, 0) && has('roller_door', 3600, 4000, 0));
  for (const p of catalogue.openings.OPENING_PRESETS) {
    assert.deepEqual(Object.keys(p).sort(), ['height', 'id', 'kind', 'name', 'sill', 'style', 'width']);
  }
  assert.deepEqual(P('nothing'), []);
});

test('tanks come from the schema defaults', () => {
  const T = catalogue.tanks.TANKS;
  assert.equal(T.length, DEFAULTS.tanks.length);
  assert.ok(T.some((t) => t.name === '5,000 L round tank' && t.capacityL === 5000 && t.diameter === 1850 && t.height === 2000));
  assert.ok(T.some((t) => t.name === '22,500 L round tank'));
});

// ------------------------------------------------------------------------------------------------
// Furniture
// ------------------------------------------------------------------------------------------------
const IDS = ['bed_single', 'bed_king_single', 'bed_double', 'bed_queen', 'bed_king', 'bedside', 'wardrobe', 'chest_drawers', 'sofa_2', 'sofa_3', 'sofa_l', 'armchair', 'coffee_table', 'tv_unit', 'rug', 'dining_4', 'dining_6', 'dining_8', 'kitchen_bench', 'kitchen_island', 'fridge', 'oven', 'dishwasher', 'pantry_unit', 'toilet', 'vanity_single', 'vanity_double', 'shower_900', 'shower_1200', 'bath', 'bath_freestanding', 'laundry_tub', 'washer', 'dryer', 'desk', 'office_chair', 'bookshelf', 'outdoor_table', 'bbq', 'sun_lounge', 'car_sedan', 'car_ute', 'workbench', 'shelving', 'plant'];

// Canvas 2D stub that throws on non finite numbers and counts drawing calls.
function stubCtx() {
  const calls = { n: 0 };
  const ctx = new Proxy({ calls }, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'symbol') return undefined;
      return (...args) => {
        for (const a of args) if (typeof a === 'number') assert.ok(Number.isFinite(a), `non finite argument to ${String(k)}`);
        calls.n++;
      };
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
  ctx.lineWidth = 2;
  return ctx;
}

test('furniture catalogue lists the agreed items and categories', () => {
  assert.equal(catalogue.FURNITURE.length, IDS.length);
  for (const id of IDS) {
    const it = catalogue.getFurniture(id);
    assert.ok(it, id);
    assert.ok(catalogue.CATEGORIES.includes(it.category), `${id} category ${it?.category}`);
    assert.ok(it.w > 0 && it.d > 0 && it.h > 0);
    assert.equal(typeof it.draw2d, 'function');
    assert.equal(typeof it.build3d, 'function');
    assert.ok(it.name && !/[–—]/.test(it.name));
  }
  assert.deepEqual(catalogue.CATEGORIES, ['Living', 'Dining', 'Kitchen', 'Bedroom', 'Bathroom', 'Laundry', 'Study', 'Outdoor', 'Garage and shed']);
  for (const c of catalogue.CATEGORIES) assert.ok(catalogue.FURNITURE.some((f) => f.category === c), c);
  const sizes = { bed_single: [920, 1880], bed_king_single: [1070, 2030], bed_double: [1380, 1880], bed_queen: [1530, 2030], bed_king: [1830, 2030], car_sedan: [1850, 4800], car_ute: [1900, 5300] };
  for (const [id, [w, d]] of Object.entries(sizes)) assert.deepEqual([catalogue.getFurniture(id).w, catalogue.getFurniture(id).d], [w, d], id);
  assert.equal(catalogue.getFurniture('wardrobe').d, 600);
  assert.equal(catalogue.getFurniture('kitchen_bench').w, 3000);
  assert.equal(catalogue.getFurniture('kitchen_bench').d, 600);
  assert.equal(catalogue.getFurniture('nothing'), null);
});

test('every furniture draw2d runs, also at other sizes', () => {
  for (const it of catalogue.FURNITURE) {
    for (const k of [1, 0.6, 1.5]) {
      const ctx = stubCtx();
      assert.doesNotThrow(() => it.draw2d(ctx, it.w * k, it.d * k), `${it.id} at x${k}`);
      assert.ok(ctx.calls.n > 3, `${it.id} drew something`);
    }
  }
});

test('every furniture build3d returns a low poly group sized to w, d and h', () => {
  const mats = new Set();
  for (const it of catalogue.FURNITURE) {
    const g = it.build3d(THREE, { w: it.w, d: it.d, h: it.h });
    assert.ok(g instanceof THREE.Group, it.id);
    const meshes = [];
    g.traverse((o) => {
      if (o.isMesh) meshes.push(o);
    });
    assert.ok(meshes.length >= 1 && meshes.length <= 12, `${it.id} has ${meshes.length} meshes`);
    for (const m of meshes) {
      assert.equal(m.castShadow, true, `${it.id} castShadow`);
      assert.ok(m.material instanceof THREE.MeshStandardMaterial);
      mats.add(m.material);
    }
    const box = new THREE.Box3().setFromObject(g);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    for (const v of [size.x, size.y, size.z, c.x, c.y, c.z, box.min.y]) assert.ok(Number.isFinite(v), `${it.id} finite`);
    const near = (got, want, what) => assert.ok(Math.abs(got * 1000 - want) <= Math.max(25, want * 0.05), `${it.id} ${what}: ${Math.round(got * 1000)} vs ${want}`);
    near(size.x, it.w, 'width');
    near(size.z, it.d, 'depth');
    near(size.y, it.h, 'height');
    assert.ok(Math.abs(box.min.y) < 0.005, `${it.id} sits on the floor`);
    assert.ok(Math.abs(c.x) < 0.04 * it.w / 1000 + 0.03 && Math.abs(c.z) < 0.04 * it.d / 1000 + 0.03, `${it.id} centred`);
  }
  assert.ok(mats.size < 120, `materials are cached per colour (${mats.size})`);
});

test('furniture models follow resized w and d', () => {
  for (const id of ['sofa_3', 'kitchen_bench', 'dining_6', 'wardrobe', 'bed_queen', 'workbench']) {
    const it = catalogue.getFurniture(id);
    const g = it.build3d(THREE, { w: it.w * 1.3, d: it.d * 1.2, h: it.h });
    const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.x * 1000 - it.w * 1.3) < it.w * 0.07, `${id} width`);
    assert.ok(Math.abs(size.z * 1000 - it.d * 1.2) < it.d * 0.07, `${id} depth`);
  }
});

test('catalogue source avoids em and en dashes in names', () => {
  const texts = [
    ...catalogue.FURNITURE.map((f) => f.name),
    ...catalogue.openings.OPENING_PRESETS.map((p) => p.name),
    ...catalogue.tanks.TANKS.map((t) => t.name),
    ...F.MATERIALS.map((m) => m.name),
    ...Object.values(F.COLOURS).flat().flatMap((c) => [c.name, ...c.aliases]),
    ...catalogue.templates.flatMap((t) => [t.name, t.description]),
  ];
  for (const s of texts) assert.ok(!/[–—]/.test(s), s);
});

// ------------------------------------------------------------------------------------------------
// Templates
// ------------------------------------------------------------------------------------------------
const TEMPLATE_IDS = ['blank', 'shed_workshop', 'shed_farm', 'granny_flat', 'house_single', 'house_double', 'duplex', 'extension_starter'];
const indoorArea = (p, skip = []) => p.levels.reduce((s, l) => s + l.rooms.filter((r) => !r.outdoor && !skip.includes(r.type)).reduce((a, r) => a + G.roomAreaM2(r), 0), 0);

test('templates list and createFromTemplate', () => {
  assert.deepEqual(catalogue.templates.map((t) => t.id), TEMPLATE_IDS);
  for (const t of catalogue.templates) {
    assert.ok(t.name && t.description && ['house', 'unit', 'shed', 'extension'].includes(t.type), t.id);
    assert.equal(typeof t.create, 'function');
  }
  assert.throws(() => catalogue.createFromTemplate('nope'), /Unknown template/);
  const a = catalogue.createFromTemplate('house_single');
  const b = catalogue.createFromTemplate('house_single');
  assert.notEqual(a.id, b.id);
  assert.notEqual(a, b);
});

for (const id of TEMPLATE_IDS) {
  test(`template ${id}: valid project with rooms, openings and furniture`, () => {
    const t = catalogue.templates.find((x) => x.id === id);
    const p = t.create();
    assert.deepEqual(validate(p), []);
    assert.equal(p.type, t.type);
    assert.equal(p.levels.length, t.levels);
    assert.equal(p.name, t.name);
    if (id === 'blank') {
      assert.equal(p.levels[0].rooms.length, 0);
      return;
    }
    const all = (key) => p.levels.flatMap((l) => l[key]);
    assert.ok(all('rooms').length >= 1, 'rooms');
    assert.ok(all('openings').length >= 3, 'openings');
    assert.ok(all('furniture').length >= 3, 'furniture');
    for (const f of all('furniture')) assert.ok(catalogue.getFurniture(f.item), `furniture ${f.item}`);
    // Coordinates are positive from the north west corner.
    const bb = G.projectBounds(p);
    assert.ok(bb.minX >= 0 && bb.minY >= 0, `positive coordinates (${bb.minX}, ${bb.minY})`);
    // Every opening sits on a wall and inside it; none overlap.
    for (const l of p.levels) {
      for (const o of l.openings) {
        const w = l.walls.find((x) => x.id === o.wallId);
        assert.ok(w, 'opening wall');
        const L = G.wallLength(w);
        assert.ok(o.offset - o.width / 2 >= 99 && o.offset + o.width / 2 <= L - 99, `opening ${o.id} fits its wall`);
      }
    }
    // A believable plan: doors into rooms, windows on habitable rooms, nothing clashing.
    assert.deepEqual(lintProject(p, catalogue), []);
    // Finishes are in the catalogue.
    const keys = { externalWalls: 'external_walls', internalWalls: 'internal_walls', roof: 'roof', fascia: 'fascia', frames: 'frames', floors: 'floors' };
    for (const [k, v] of Object.entries(p.finishes)) assert.ok(catalogue.validateFinish(keys[k], v.material, v.colour), k);
    for (const tk of p.site.tanks) assert.ok(F.getColour(tk.colour), tk.colour);
  });
}

test('shed templates', () => {
  const s = catalogue.createFromTemplate('shed_workshop');
  const L = s.levels[0];
  assert.equal(s.type, 'shed');
  const bb = G.bbox(L.rooms[0].polygon);
  assert.deepEqual([bb.w, bb.h], [9000, 7000]);
  const rollers = L.openings.filter((o) => o.kind === 'roller_door');
  assert.equal(rollers.length, 2);
  assert.ok(rollers.every((o) => o.width === 2700));
  assert.equal(L.openings.filter((o) => o.kind === 'door').length, 1);
  assert.equal(L.openings.filter((o) => o.kind === 'window').length, 1);
  assert.deepEqual(L.furniture.map((f) => f.item).sort(), ['car_sedan', 'shelving', 'shelving', 'workbench']);
  assert.equal(s.levels[0].roof.type, 'gable');
  assert.equal(s.levels[0].roof.pitch, 11);

  const f = catalogue.createFromTemplate('shed_farm');
  const FL = f.levels[0];
  const fb = G.bbox(FL.rooms[0].polygon);
  assert.deepEqual([fb.w, fb.h], [15000, 9000]);
  assert.equal(FL.height, 4200);
  const fr = FL.openings.filter((o) => o.kind === 'roller_door');
  assert.equal(fr.length, 3);
  assert.ok(fr.every((o) => o.width === 3600 && o.height === 4000));
  assert.equal(FL.openings.filter((o) => o.kind === 'door').length, 1);
  assert.equal(f.site.tanks.length, 1);
  assert.equal(f.site.tanks[0].capacityL, 22500);
});

test('granny flat is about 60 m2 with a 2.4 m deck', () => {
  const p = catalogue.createFromTemplate('granny_flat');
  const area = indoorArea(p);
  assert.ok(area > 55 && area < 68, `indoor ${area}`);
  const types = p.levels[0].rooms.map((r) => r.type);
  assert.equal(types.filter((t) => t === 'bedroom').length, 2);
  for (const t of ['bathroom', 'laundry', 'kitchen', 'living', 'deck']) assert.ok(types.includes(t) || p.levels[0].rooms.some((r) => /kitchen|living/i.test(r.name)), t);
  const deck = p.levels[0].rooms.find((r) => r.type === 'deck');
  assert.equal(G.bbox(deck.polygon).h, 2400);
  assert.ok(p.levels[0].furniture.filter((f) => f.item === 'wardrobe').length >= 2, 'robes');
});

test('single storey house: about 200 m2 plus garage, L shaped, tank', () => {
  const p = catalogue.createFromTemplate('house_single');
  const L = p.levels[0];
  const garage = L.rooms.find((r) => r.type === 'garage');
  const area = indoorArea(p, ['garage']);
  assert.ok(area > 185 && area < 235, `indoor ${area}`);
  assert.ok(G.roomAreaM2(garage) > 30);
  assert.ok(L.openings.some((o) => o.kind === 'garage_door' && o.width === 4800), 'double garage door');
  // L shaped: the garage projects beyond the main block.
  const main = L.rooms.filter((r) => !r.outdoor && r.type !== 'garage');
  const mainMaxY = Math.max(...main.flatMap((r) => r.polygon.map((q) => q.y)));
  assert.ok(Math.max(...garage.polygon.map((q) => q.y)) > mainMaxY + 3000);
  assert.equal(L.rooms.filter((r) => r.type === 'bedroom').length, 4);
  for (const t of ['ensuite', 'robe', 'bathroom', 'wc', 'laundry', 'alfresco', 'living', 'entry', 'hall']) assert.ok(L.rooms.some((r) => r.type === t), t);
  assert.equal(L.rooms.find((r) => r.type === 'alfresco').roofed, true);
  assert.equal(L.roof.type, 'hip');
  assert.equal(p.site.tanks.length, 1);
  assert.equal(p.site.tanks[0].capacityL, 5000);
  assert.ok(L.openings.some((o) => o.kind === 'door' && o.width === 870), 'entry door');
});

test('double storey house: two levels, smaller upper floor, stairs', () => {
  const p = catalogue.createFromTemplate('house_double');
  assert.equal(p.levels.length, 2);
  const [g, u] = p.levels;
  assert.equal(u.elevation, 3000);
  const gb = G.bbox(g.walls.flatMap((w) => [w.a, w.b]));
  const ub = G.bbox(u.walls.flatMap((w) => [w.a, w.b]));
  assert.ok(ub.w < gb.w, 'first floor is narrower than the ground floor');
  assert.ok(ub.minX > gb.minX + 1000, 'lower roof shows on the west side');
  assert.ok(g.rooms.some((r) => r.type === 'garage'));
  assert.ok(g.stairs.length >= 1);
  assert.ok(u.rooms.filter((r) => r.type === 'bedroom').length >= 3, 'upper bedrooms');
  for (const t of ['ensuite', 'robe', 'bathroom', 'rumpus']) assert.ok(u.rooms.some((r) => r.type === t), t);
  assert.ok(u.rooms.some((r) => /stair void/i.test(r.name)));
  assert.ok(g.rooms.some((r) => r.type === 'bedroom' || r.type === 'study'));
  assert.ok(g.rooms.some((r) => r.type === 'wc') && g.rooms.some((r) => r.type === 'laundry'));
});

test('duplex: two mirror image units sharing a party wall', () => {
  const p = catalogue.createFromTemplate('duplex');
  const L = p.levels[0];
  assert.equal(p.type, 'unit');
  assert.equal(L.rooms.filter((r) => r.type === 'garage').length, 2);
  assert.equal(L.rooms.filter((r) => r.type === 'bedroom').length, 6);
  assert.equal(L.rooms.filter((r) => r.type === 'ensuite').length, 2);
  assert.equal(L.rooms.filter((r) => r.type === 'bathroom').length, 2);
  assert.equal(L.rooms.filter((r) => r.type === 'laundry').length, 2);
  assert.equal(L.rooms.filter((r) => r.type === 'patio').length, 2);
  const bb = G.bbox(L.rooms.filter((r) => !r.outdoor).flatMap((r) => r.polygon));
  const cx = bb.cx;
  // Mirror symmetry of the room outlines about the party wall.
  const key = (r, flip) => {
    const b = G.bbox(r.polygon);
    const x0 = flip ? 2 * cx - b.maxX : b.minX;
    return `${r.type}|${Math.round(x0)}|${Math.round(b.minY)}|${Math.round(b.w)}|${Math.round(b.h)}`;
  };
  const left = L.rooms.filter((r) => G.bbox(r.polygon).cx < cx).map((r) => key(r, false)).sort();
  const right = L.rooms.filter((r) => G.bbox(r.polygon).cx > cx).map((r) => key(r, true)).sort();
  assert.deepEqual(left, right);
  // One thick wall runs the full depth of the building on the centre line.
  const party = L.walls.filter((w) => Math.abs(w.a.x - cx) < 2 && Math.abs(w.b.x - cx) < 2);
  assert.ok(party.length >= 1);
  assert.ok(party.every((w) => w.thickness === 250));
  assert.ok(party.reduce((s, w) => s + G.wallLength(w), 0) > 15000);
  assert.equal(L.openings.filter((o) => o.kind === 'garage_door').length, 2);
});

test('extension: existing, new and demolished work', () => {
  const p = catalogue.createFromTemplate('extension_starter');
  const L = p.levels[0];
  assert.equal(p.type, 'extension');
  const count = (list, s) => list.filter((e) => e.status === s).length;
  assert.ok(count(L.walls, 'existing') > 8);
  assert.ok(count(L.walls, 'new') >= 3);
  assert.equal(count(L.walls, 'demolish'), 1);
  assert.ok(count(L.rooms, 'existing') >= 8);
  assert.ok(L.rooms.filter((r) => r.status === 'new').some((r) => r.type === 'family'));
  assert.ok(L.rooms.filter((r) => r.status === 'new').some((r) => r.type === 'deck'));
  assert.ok(count(L.openings, 'new') >= 2 && count(L.openings, 'existing') >= 10);
  assert.equal(count(L.rooms.filter((r) => r.type === 'bedroom'), 'existing'), 3);
  assert.equal(p.site.tanks[0].status, 'existing');
  // The demolished section lies on the shared edge of the existing kitchen and the new family room.
  const wall = L.walls.find((w) => w.status === 'demolish');
  const kitchen = L.rooms.find((r) => r.type === 'kitchen');
  const family = L.rooms.find((r) => r.type === 'family');
  const mid = G.wallMid(wall);
  const kb = G.bbox(kitchen.polygon);
  const fb = G.bbox(family.polygon);
  assert.ok(Math.abs(mid.y - kb.minY) < 3 && Math.abs(mid.y - fb.maxY) < 3);
  assert.ok(G.wallLength(wall) >= 2500);
  assert.equal(L.openings.filter((o) => o.wallId === wall.id).length, 0);
});

test('templates build through applyOp only and in good time', () => {
  const t0 = performance.now();
  for (const t of catalogue.templates) t.create();
  assert.ok(performance.now() - t0 < 2000, 'all templates build in under 2 s');
  // A fresh project passes the same validation the editor applies on open.
  assert.deepEqual(validate(createProject({ type: 'house' })), []);
});
