import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createProject } from '../src/model/schema.js';
import { applyOp, findEntity } from '../src/model/ops.js';
import { createStore } from '../src/model/store.js';
import * as G from '../src/model/geometry.js';
import { buildModel, disposeModel, modelBounds, floorTypeDefault } from '../src/viewer3d/build.js';
import { createMaterialLibrary, resolveHex } from '../src/viewer3d/materials.js';
import * as F from '../src/viewer3d/footprint.js';
import { computeJoins } from '../src/viewer3d/walls.js';
import { buildColliders, resolveCollisions, chooseSpawn, isPassable, WALK } from '../src/viewer3d/colliders.js';
import { describeHit, operationFor, materialsForTarget, coloursForTarget } from '../src/viewer3d/picker.js';
import { lHouse, twoStorey, shed, extension, bigHouse } from '../src/viewer3d/samples.js';
import * as ST from '../src/viewer3d/stairs.js';
import { TEMPLATES } from '../src/catalogue/templates.js';
import * as furn from '../src/catalogue/furniture.js';
import * as finishes from '../src/catalogue/finishes.js';

const catalogue = { getFurniture: furn.getFurniture, finishes };
const PICKABLE = ['wall', 'roof', 'opening', 'floor', 'tank', 'furniture', 'stair', 'deck'];

// Collect every mesh with its kind, counts and any bad numbers.
function inspect(group) {
  const meshes = [];
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (o.isMesh) meshes.push(o);
  });
  const byKind = {};
  let nan = 0;
  let tris = 0;
  let groups = 0;
  for (const m of meshes) {
    const kind = m.userData.leaf ? 'leaf' : m.userData.kind || (m.userData.ground ? 'ground' : 'decor');
    byKind[kind] = (byKind[kind] || 0) + 1;
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) nan++;
    tris += (m.geometry.index ? m.geometry.index.count : pos.count) / 3;
    groups += m.geometry.groups.length || 1;
  }
  return { meshes, byKind, nan, tris, groups, bounds: modelBounds(group) };
}

const ofKind = (info, kind) => info.meshes.filter((m) => (kind === 'leaf' ? m.userData.leaf : m.userData.kind === kind && !m.userData.leaf));
const sizeOf = (box) => box.getSize(new THREE.Vector3());

test('single storey house: meshes, userData and bounds', () => {
  const p = lHouse();
  const g = buildModel(p, { catalogue });
  const info = inspect(g);
  assert.equal(g.name, 'plan-model');
  assert.equal(info.nan, 0);
  assert.equal(info.byKind.roof, 1);
  assert.equal(info.byKind.ground, 1);
  assert.equal(info.byKind.tank, 1);
  assert.equal(info.byKind.deck, 1);
  assert.equal(info.byKind.furniture >= 11, true, 'one or more meshes per furniture item');
  assert.ok(info.byKind.wall >= p.levels[0].walls.length, 'every wall is built');
  assert.equal(info.byKind.opening, p.levels[0].openings.filter((o) => o.kind !== 'opening').length, 'plain openings have no fittings');
  assert.equal(info.byKind.floor >= 6, true, 'a floor per indoor room');

  for (const m of info.meshes) {
    const u = m.userData;
    if (u.ground || u.decor) continue;
    assert.ok(PICKABLE.includes(u.kind), `kind ${u.kind}`);
    assert.equal(typeof u.id, 'string');
    assert.equal(typeof u.levelId, 'string');
    assert.ok(findEntity(p, u.id) || /:roof$|:floor$/.test(u.id), `id ${u.id} resolves`);
  }
  for (const m of ofKind(info, 'wall')) {
    assert.ok(['outside', 'inside'].includes(m.userData.face));
    assert.equal(m.userData.faceBySlot.length, m.userData.slotKeys.length);
  }
  // house footprint is about 13.5 x 9.2 m, roof overhang 0.45 m, roof peak a little under 4 m
  const size = sizeOf(info.bounds);
  assert.ok(size.x > 14 && size.x < 18.5, `width ${size.x}`);
  assert.ok(size.z > 9.5 && size.z < 12, `depth ${size.z}`);
  assert.ok(info.bounds.max.y > 3.2 && info.bounds.max.y < 4.4, `height ${info.bounds.max.y}`);
  assert.ok(info.bounds.min.y > -0.5 && info.bounds.min.y < 0, 'slab edge sits just under the ground');
});

test('buildModel runs without a catalogue and without a DOM', () => {
  assert.equal(typeof document, 'undefined');
  const p = lHouse();
  const g = buildModel(p);
  const info = inspect(g);
  assert.equal(info.nan, 0);
  assert.ok(ofKind(info, 'furniture').length >= 11, 'unknown catalogue falls back to boxes');
  const f = ofKind(info, 'furniture')[0];
  const box = new THREE.Box3().setFromObject(f);
  assert.ok(sizeOf(box).y > 0.3 && sizeOf(box).y < 3, 'fallback box has a sensible height');
});

test('wall corners close: wall meshes cover the full outer rectangle', () => {
  const p = createProject({ type: 'house' });
  applyOp(p, 'add_room', { type: 'living', x: 0, y: 0, width: 4000, depth: 3000 });
  const g = buildModel(p, { showRoof: false });
  const info = inspect(g);
  const box = new THREE.Box3();
  for (const m of ofKind(info, 'wall')) box.union(new THREE.Box3().setFromObject(m));
  const t = p.settings.extWall / 2000;
  assert.ok(Math.abs(box.min.x + t) < 0.005 && Math.abs(box.max.x - (4 + t)) < 0.005, `x ${box.min.x}..${box.max.x}`);
  assert.ok(Math.abs(box.min.z + t) < 0.005 && Math.abs(box.max.z - (3 + t)) < 0.005, `z ${box.min.z}..${box.max.z}`);
  assert.ok(Math.abs(box.max.y - 2.55) < 0.001, `wall height ${box.max.y}`);
  const joins = computeJoins(p.levels[0].walls);
  assert.equal(joins.size, 4);
});

test('walls face outward: the outside face carries the external finish', () => {
  const p = createProject({ type: 'house' });
  const run = (op, a) => applyOp(p, op, a, {});
  run('add_room', { type: 'living', x: 0, y: 0, width: 4000, depth: 3000 });
  run('set_finish', { target: 'external_walls', material: 'render', colour: '#336699' });
  const lib = createMaterialLibrary({ textures: false });
  const g = buildModel(p, { materials: lib, showRoof: false });
  const want = lib.get('render', '#336699');
  const inside = lib.get('paint', resolveHex(null, p.finishes.internalWalls.colour));
  let outsideFaces = 0;
  for (const m of inspect(g).meshes.filter((x) => x.userData.kind === 'wall')) {
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const keys = m.userData.slotKeys;
    keys.forEach((k, i) => {
      if (k === 'out') {
        assert.equal(mats[i], want);
        outsideFaces++;
      }
      if (k === 'in') assert.equal(mats[i], inside);
    });
    // every wall of a single room has its exterior on the outside: that face must point away from the room centre
    const pos = m.geometry.attributes.position;
    const nor = m.geometry.attributes.normal;
    const gi = keys.indexOf('out');
    if (gi < 0) continue;
    const grp = m.geometry.groups.find((q) => q.materialIndex === gi);
    for (let v = grp.start; v < grp.start + grp.count; v += 3) {
      const dx = pos.getX(v) - 2;
      const dz = pos.getZ(v) - 1.5;
      const dot = nor.getX(v) * dx + nor.getZ(v) * dz;
      if (Math.abs(nor.getY(v)) < 0.5) assert.ok(dot > 0, 'outside face normal points away from the room');
    }
  }
  assert.ok(outsideFaces >= 4);
});

test('a wall with its own finish overrides the house finish on its outside face only', () => {
  const p = createProject({ type: 'house' });
  const run = (op, a) => applyOp(p, op, a, {});
  run('add_room', { type: 'living', x: 0, y: 0, width: 4000, depth: 3000 });
  const w = p.levels[0].walls[0];
  run('update_wall', { id: w.id, finish_material: 'stone', finish_colour: '#8a7a66' });
  const lib = createMaterialLibrary({ textures: false });
  const g = buildModel(p, { materials: lib, showRoof: false });
  const mesh = g.getObjectByName(`wall:${w.id}`);
  const mats = mesh.material;
  const out = mats[mesh.userData.slotKeys.indexOf('out')];
  assert.equal(out, lib.get('stone', '#8a7a66'));
});

test('openings: boxes around the hole, fittings per kind, nothing for plain openings', () => {
  const p = createProject({ type: 'house' });
  const run = (op, a) => applyOp(p, op, a, {});
  run('add_room', { type: 'living', x: 0, y: 0, width: 14000, depth: 5000 });
  const kinds = ['window', 'door', 'sliding_door', 'garage_door', 'roller_door', 'opening'];
  const spots = [[1500, 0], [3000, 0], [5500, 0], [9000, 0], [12000, 0], [14000, 2500]];
  kinds.forEach((kind, i) => run('add_opening', { kind, x: spots[i][0], y: spots[i][1], ...(kind === 'garage_door' ? { width: 2400 } : {}), ...(kind === 'roller_door' ? { width: 1500, height: 2400 } : {}) }));
  const info = inspect(buildModel(p, { showRoof: false }));
  const fittings = ofKind(info, 'opening');
  assert.equal(fittings.length, 5);
  const byKind = Object.fromEntries(fittings.map((m) => [m.userData.openingKind, m]));
  assert.ok(byKind.window.userData.slotKeys.includes('frame') && byKind.window.userData.slotKeys.includes('glass'));
  // the moving parts (leaf, sash, rolling panel) are separate meshes so the walk-through can animate them
  assert.ok(byKind.door.userData.slotKeys.includes('frame'));
  assert.ok(byKind.sliding_door.userData.slotKeys.includes('glass'));
  assert.ok(byKind.garage_door.userData.slotKeys.includes('panel'));
  const leaves = Object.fromEntries(ofKind(info, 'leaf').map((m) => [m.userData.openingKind, m]));
  assert.deepEqual(Object.keys(leaves).sort(), ['door', 'garage_door', 'roller_door', 'sliding_door']);
  assert.ok(leaves.door.userData.slotKeys.includes('handle'));
  assert.ok(leaves.roller_door.userData.slotKeys.includes('roller'));
  assert.deepEqual(['hinged', 'slide', 'roll', 'roll'], [leaves.door, leaves.sliding_door, leaves.garage_door, leaves.roller_door].map((m) => m.userData.motion.type));
  assert.equal(info.nan, 0);
});

test('sliding window has two sashes, a fixed window has one pane', () => {
  const make = (style) => {
    const p = createProject({ type: 'house' });
    applyOp(p, 'add_room', { type: 'living', x: 0, y: 0, width: 5000, depth: 4000 }, {});
    applyOp(p, 'add_opening', { kind: 'window', x: 2500, y: 0, width: 1800, style }, {});
    const m = ofKind(inspect(buildModel(p, { showRoof: false })), 'opening')[0];
    return m.geometry.groups.reduce((n, gr) => n + gr.count, 0) / 3;
  };
  assert.ok(make('sliding') > make('fixed'), 'sliding window has more geometry than a fixed one');
});

test('floors: per room finish, garage and deck defaults', () => {
  assert.equal(floorTypeDefault({ type: 'garage' }), 'polished_concrete');
  assert.equal(floorTypeDefault({ type: 'deck' }), 'decking');
  assert.equal(floorTypeDefault({ type: 'bedroom' }), null);
  const p = lHouse({ furniture: false });
  const bed = p.levels[0].rooms.find((r) => r.name === 'Bed 1');
  applyOp(p, 'update_room', { id: bed.id, floor_material: 'carpet', floor_colour: 'floor-oatmeal' }, { catalogue: { validateFinish: finishes.validateFinish } });
  const lib = createMaterialLibrary({ textures: false, catalogue });
  const g = buildModel(p, { materials: lib, catalogue });
  const info = inspect(g);
  const floors = Object.fromEntries(ofKind(info, 'floor').map((m) => [m.userData.id, m.userData.finish]));
  assert.equal(floors[bed.id].material, 'carpet');
  const garage = p.levels[0].rooms.find((r) => r.name === 'Garage');
  assert.equal(floors[garage.id].material, 'polished_concrete');
  const living = p.levels[0].rooms.find((r) => r.name === 'Living');
  assert.equal(floors[living.id].material, p.finishes.floors.material);
  // outdoor unroofed rooms are decks, not floors
  const deck = p.levels[0].rooms.find((r) => r.name === 'Deck');
  assert.ok(!(deck.id in floors));
  assert.equal(ofKind(info, 'deck').length, 1);
});

test('a level with walls and no rooms still gets a floor and a roof', () => {
  const p = shed();
  const g = buildModel(p);
  const info = inspect(g);
  assert.equal(info.byKind.wall, 4);
  assert.equal(info.byKind.floor, 1, 'default floor for the enclosed area');
  assert.equal(info.byKind.roof, 1);
  assert.equal(info.byKind.opening, 3);
  assert.equal(info.nan, 0);
  const floor = ofKind(info, 'floor')[0];
  assert.match(floor.userData.id, /:floor$/);
  assert.equal(floor.userData.finish.material, 'polished_concrete', 'shed default floor');
  const size = sizeOf(info.bounds);
  assert.ok(size.x > 6 && size.x < 7.5 && size.z > 4 && size.z < 5.5, `size ${size.x} x ${size.z}`);
  // gable roof: gable ends are built in the wall finish
  assert.ok(ofKind(info, 'roof')[0].userData.slotKeys.includes('gable'));
});

test('two storeys: upper floor slab, roofs per level, stair and cutaway', () => {
  const p = twoStorey();
  const [ground, first] = [...p.levels].sort((a, b) => a.elevation - b.elevation);
  const info = inspect(buildModel(p, { catalogue }));
  assert.equal(info.nan, 0);
  assert.equal(info.byKind.roof, 2, 'a roof mesh per level');
  assert.equal(ofKind(info, 'stair').length, 1);
  assert.ok(info.bounds.max.y > 6, `top ${info.bounds.max.y}`);
  const upperWalls = ofKind(info, 'wall').filter((m) => m.userData.levelId === first.id);
  assert.ok(upperWalls.length >= first.walls.length);
  // the ground roof does not cover the area under the first floor: its footprint excludes it
  const groundRoof = ofKind(info, 'roof').find((m) => m.userData.levelId === ground.id);
  const gb = new THREE.Box3().setFromObject(groundRoof);
  assert.ok(gb.max.y < first.elevation / 1000 + 1, 'ground roof stays below the first floor roof');

  // cutaway: show the ground level and below, without the roof of that level or anything above
  const cut = inspect(buildModel(p, { catalogue, levelFilter: ground.id }));
  assert.equal(cut.byKind.roof, undefined);
  assert.ok(cut.meshes.every((m) => m.userData.levelId !== first.id), 'nothing from the level above');
  assert.ok(cut.bounds.max.y < 3.2, `cut height ${cut.bounds.max.y}`);
  const cutFirst = inspect(buildModel(p, { catalogue, levelFilter: first.id }));
  assert.equal(cutFirst.byKind.roof, 1, 'ground roof (outside the first floor) remains');
  assert.ok(cutFirst.meshes.some((m) => m.userData.levelId === first.id));
  // everything is shown for 'all'
  assert.ok(info.meshes.length > cutFirst.meshes.length);
});

test('showRoof false removes roofs', () => {
  const info = inspect(buildModel(twoStorey(), { showRoof: false }));
  assert.equal(info.byKind.roof, undefined);
  assert.equal(info.nan, 0);
});

test('roof types and pitch set the roof height', () => {
  const make = (type, pitch, overhang = 450) => {
    const p = createProject({ type: 'house' });
    applyOp(p, 'add_room', { type: 'living', x: 0, y: 0, width: 6000, depth: 4000 }, {});
    applyOp(p, 'set_roof', { type, pitch, overhang }, {});
    const info = inspect(buildModel(p));
    assert.equal(info.byKind.roof, 1, type);
    assert.equal(info.nan, 0);
    return { info, roof: new THREE.Box3().setFromObject(ofKind(info, 'roof')[0]), mesh: ofKind(info, 'roof')[0] };
  };
  const top = 2.55;
  const hip = make('hip', 25);
  assert.ok(Math.abs(hip.roof.max.y - (top + 2.05 * Math.tan((25 * Math.PI) / 180) - 0.0)) < 0.12, `hip ridge ${hip.roof.max.y}`);
  assert.ok(hip.roof.min.y < top, 'eaves are below the wall top line');
  assert.ok(hip.roof.min.x < -0.4 && hip.roof.max.x > 6.4, 'eaves overhang');
  const gable = make('gable', 25);
  assert.ok(gable.mesh.userData.slotKeys.includes('gable'), 'gable ends in the wall finish');
  assert.ok(Math.abs(gable.roof.max.y - hip.roof.max.y) < 0.01, 'same pitch, same ridge height');
  const skillion = make('skillion', 10);
  assert.ok(skillion.roof.max.y > top + 4 * Math.tan((10 * Math.PI) / 180) - 0.1, `skillion high side ${skillion.roof.max.y}`);
  const flat = make('flat', 20);
  assert.ok(flat.roof.max.y < top + 0.45, `flat roof stays low ${flat.roof.max.y}`);
  const steeper = make('hip', 40);
  assert.ok(steeper.roof.max.y > hip.roof.max.y + 0.4, 'steeper pitch is taller');
  const off = make('hip', 25, 0);
  assert.ok(off.roof.min.x > -0.45, 'no overhang when set to zero');
});

test('a square hip roof is a pyramid', () => {
  const p = createProject({ type: 'house' });
  applyOp(p, 'add_room', { type: 'living', x: 0, y: 0, width: 5000, depth: 5000 }, {});
  const m = ofKind(inspect(buildModel(p)), 'roof')[0];
  const pos = m.geometry.attributes.position;
  const apex = new Map();
  const top = new THREE.Box3().setFromObject(m).max.y;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > top - 0.01) apex.set(`${pos.getX(i).toFixed(2)},${pos.getZ(i).toFixed(2)}`, 1);
  assert.equal(apex.size, 1, 'one apex point');
});

test('statusView: proposed hides demolish, existing hides new, both tints', () => {
  const p = extension();
  const L = p.levels[0];
  const demolishRoom = L.rooms.find((r) => r.status === 'demolish');
  const newRoom = L.rooms.find((r) => r.status === 'new');
  const demolishWindow = L.openings.find((o) => o.status === 'demolish');
  const newDoor = L.openings.find((o) => o.status === 'new' && o.kind === 'door');
  const demolishWalls = L.walls.filter((w) => w.status === 'demolish');
  assert.ok(demolishRoom && newRoom && demolishWindow && newDoor && demolishWalls.length);

  const ids = (info, kind) => new Set(ofKind(info, kind).map((m) => m.userData.id));
  const proposed = inspect(buildModel(p, { statusView: 'proposed' }));
  assert.ok(!ids(proposed, 'floor').has(demolishRoom.id));
  assert.ok(ids(proposed, 'floor').has(newRoom.id));
  assert.ok(!ids(proposed, 'opening').has(demolishWindow.id));
  for (const w of demolishWalls) assert.ok(!ids(proposed, 'wall').has(w.id));

  const existing = inspect(buildModel(p, { statusView: 'existing' }));
  assert.ok(ids(existing, 'floor').has(demolishRoom.id));
  assert.ok(!ids(existing, 'floor').has(newRoom.id));
  assert.ok(!ids(existing, 'opening').has(newDoor.id));

  const lib = createMaterialLibrary({ textures: false });
  const both = inspect(buildModel(p, { statusView: 'both', materials: lib }));
  assert.ok(ids(both, 'floor').has(demolishRoom.id) && ids(both, 'floor').has(newRoom.id));
  assert.ok(ids(both, 'opening').has(demolishWindow.id));
  const dw = both.meshes.find((m) => m.userData.kind === 'wall' && demolishWalls.some((w) => w.id === m.userData.id));
  const mats = Array.isArray(dw.material) ? dw.material : [dw.material];
  assert.ok(mats.some((m) => m.transparent && m.opacity < 1), 'demolish is translucent');
  const nw = both.meshes.find((m) => m.userData.kind === 'wall' && p.levels[0].walls.find((w) => w.id === m.userData.id)?.status === 'new');
  const nm = Array.isArray(nw.material) ? nw.material : [nw.material];
  assert.ok(nm.every((m) => !m.transparent), 'new work is tinted, not transparent');
  assert.equal(proposed.nan + existing.nan + both.nan, 0);
});

test('walls shared with a hidden room face outdoors in the proposed view', () => {
  const p = extension();
  const L = p.levels[0];
  // the wall between the existing living room and the demolished sunroom is interior in the plan
  const living = L.rooms.find((r) => r.name === 'Living');
  const shared = L.walls.find((w) => w.kind === 'interior' && Math.abs(w.a.y - 4500) < 2 && Math.abs(w.b.y - 4500) < 2 && Math.max(w.a.x, w.b.x) <= 3000 + 1);
  assert.ok(shared && living, 'shared wall exists');
  const g = buildModel(p, { statusView: 'proposed' });
  const mesh = g.getObjectByName(`wall:${shared.id}`);
  assert.ok(mesh, 'wall is built');
  assert.ok(mesh.userData.slotKeys.includes('out'), 'it now has an outside face');
  assert.equal(mesh.userData.face, 'outside');
});

test('walk mode adds ceilings, orbit does not', () => {
  const p = lHouse({ furniture: false });
  const names = (g) => inspect(g).meshes.map((m) => m.name);
  assert.ok(names(buildModel(p, { walk: true })).includes('ceiling'));
  assert.ok(!names(buildModel(p)).includes('ceiling'));
});

test('walk mode roofs do not cast shadows', () => {
  const p = lHouse({ furniture: false });
  const roof = (g) => ofKind(inspect(g), 'roof')[0];
  assert.equal(roof(buildModel(p, { walk: true })).castShadow, false);
  assert.equal(roof(buildModel(p)).castShadow, true);
});

test('furniture is placed at (x, elevation, y) and rotated clockwise', () => {
  const p = createProject({ type: 'house' });
  applyOp(p, 'add_room', { type: 'living', x: 0, y: 0, width: 6000, depth: 5000 }, {});
  applyOp(p, 'add_furniture', { item: 'sofa_3', x: 3000, y: 2000, rotation: 90 }, {});
  for (const cat of [catalogue, null]) {
    const g = buildModel(p, { catalogue: cat });
    const f = g.getObjectByName(`furniture:${p.levels[0].furniture[0].id}`);
    assert.ok(f, 'furniture wrapper');
    assert.ok(Math.abs(f.position.x - 3) < 1e-9 && Math.abs(f.position.z - 2) < 1e-9 && f.position.y === 0);
    assert.ok(Math.abs(f.rotation.y + Math.PI / 2) < 1e-9, 'rotation.y = -rotation');
    assert.equal(f.userData.kind, 'furniture');
  }
});

test('unknown furniture falls back to a box of the given size', () => {
  const p = createProject({ type: 'house' });
  applyOp(p, 'add_room', { type: 'living', x: 0, y: 0, width: 6000, depth: 5000 }, {});
  const f = p.levels[0].furniture;
  f.push({ id: 'f_unknown', item: 'does_not_exist', x: 3000, y: 2000, rotation: 0, w: 1200, d: 800 });
  const g = buildModel(p, { catalogue });
  const box = new THREE.Box3().setFromObject(g.getObjectByName('furniture:f_unknown'));
  const s = sizeOf(box);
  assert.ok(Math.abs(s.x - 1.2) < 0.01 && Math.abs(s.z - 0.8) < 0.01, `${s.x} x ${s.z}`);
});

test('catalogue furniture builds at metre scale', () => {
  const p = lHouse();
  const g = buildModel(p, { catalogue });
  for (const m of inspect(g).meshes.filter((x) => x.userData.kind === 'furniture')) {
    const s = sizeOf(new THREE.Box3().setFromObject(m));
    assert.ok(Math.max(s.x, s.y, s.z) < 6 && Math.max(s.x, s.y, s.z) > 0.05, `${m.userData.id} size ${s.x},${s.y},${s.z}`);
  }
});

test('material library: caching, no textures in Node, shared materials survive disposal', () => {
  const lib = createMaterialLibrary({ textures: true, catalogue });
  assert.equal(lib.hasTextures, false);
  const a = lib.get('brick', '#b9b3a9');
  assert.equal(lib.get('brick', '#b9b3a9'), a, 'cached by key');
  assert.notEqual(lib.get('brick', '#b9b3a8'), a);
  assert.notEqual(lib.get('brick', '#b9b3a9', { tint: 'new' }), a);
  assert.equal(a.map, null);
  assert.ok(lib.frame('#222222') instanceof THREE.MeshStandardMaterial);
  const glass = lib.glass();
  assert.ok(glass.transparent && glass.opacity < 1);
  assert.equal(lib.glass(), glass);
  const demolish = lib.get('brick', '#b9b3a9', { tint: 'demolish' });
  assert.ok(demolish.transparent && demolish.opacity === 0.5 && demolish.depthWrite === false);
  assert.equal(resolveHex(catalogue, 'steel-charcoal'), finishes.getColour('steel-charcoal').hex);
  assert.equal(resolveHex(catalogue, 'no-such-colour'), '#c8c8c8');
  assert.equal(resolveHex(catalogue, '#112233'), '#112233');

  const p = lHouse();
  const g = buildModel(p, { materials: lib, catalogue });
  let sharedDisposed = 0;
  let geoDisposed = 0;
  g.traverse((o) => {
    if (!o.geometry) return;
    o.geometry.addEventListener('dispose', () => geoDisposed++);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.userData.shared) m.addEventListener('dispose', () => sharedDisposed++);
  });
  disposeModel(g);
  assert.equal(sharedDisposed, 0, 'library materials are not disposed with the model');
  assert.ok(geoDisposed > 10, 'geometry is disposed');
  lib.dispose();
});

test('finish changes flow through to materials', () => {
  const p = lHouse({ furniture: false });
  const lib = createMaterialLibrary({ textures: false, catalogue });
  const roofMat = (g) => {
    const m = ofKind(inspect(g), 'roof')[0];
    return m.material[m.userData.slotKeys.indexOf('roof')];
  };
  const before = roofMat(buildModel(p, { materials: lib, catalogue }));
  applyOp(p, 'set_finish', { target: 'roof', material: 'standing_seam', colour: 'steel-dune' }, { catalogue: { validateFinish: finishes.validateFinish } });
  const after = roofMat(buildModel(p, { materials: lib, catalogue }));
  assert.notEqual(before, after);
  assert.equal(after.color.getHexString(), finishes.getColour('steel-dune').hex.replace('#', '').toLowerCase());
});

test('performance: a 300 m2 house builds quickly with a modest draw call count', () => {
  const p = bigHouse();
  const area = p.levels[0].rooms.reduce((s, r) => s + G.polygonArea(r.polygon), 0) / 1e6;
  assert.ok(area > 250, `area ${area}`);
  buildModel(p); // warm up
  const t0 = performance.now();
  const g = buildModel(p, { catalogue });
  const ms = performance.now() - t0;
  const info = inspect(g);
  assert.equal(info.nan, 0);
  assert.ok(ms < 400, `build took ${ms.toFixed(0)} ms`);
  assert.ok(info.groups <= 250, `draw calls ${info.groups}`);
  console.log(`  300 m2 house: ${ms.toFixed(0)} ms, ${info.meshes.length} meshes, ${info.groups} draw calls, ${info.tris} triangles`);
});

test('every sample builds without NaN and with sensible bounds', () => {
  for (const [name, make] of Object.entries({ lHouse, twoStorey, shed, extension, bigHouse })) {
    for (const opts of [{}, { walk: true }, { statusView: 'both' }, { statusView: 'existing' }]) {
      const info = inspect(buildModel(make(), opts));
      assert.equal(info.nan, 0, `${name} ${JSON.stringify(opts)}`);
      if (opts.statusView === 'existing') continue; // new work is hidden, so most samples are nearly empty
      const s = sizeOf(info.bounds);
      assert.ok(s.x > 2 && s.x < 40 && s.y > 1 && s.y < 12 && s.z > 2 && s.z < 40, `${name} ${JSON.stringify(opts)} size ${s.x},${s.y},${s.z}`);
    }
  }
});

test('an empty project builds an empty model without throwing', () => {
  const p = createProject({ type: 'house' });
  const g = buildModel(p);
  const info = inspect(g);
  assert.equal(info.nan, 0);
  assert.equal(info.byKind.wall, undefined);
  assert.equal(modelBounds(g), null);
});

// Footprint rasters ------------------------------------------------------------------------------------------

test('footprint rectangles: cover rects reach every cell, disjoint rects tile it exactly', () => {
  const p = lHouse({ furniture: false });
  const level = p.levels[0];
  const grid = F.makeGrid(p);
  const ras = F.rasteriseLevel(grid, level, () => true);
  assert.ok(ras.any);
  const cells = F.maskCount(ras.footprint);
  assert.ok(cells * 0.01 > 85 && cells * 0.01 < 120, `footprint ${cells * 0.01} m2`);

  const disjoint = F.disjointRects(grid, ras.footprint);
  const seen = new Uint8Array(ras.footprint.length);
  let total = 0;
  for (const r of disjoint) {
    for (let j = r.j0; j <= r.j1; j++) {
      for (let i = r.i0; i <= r.i1; i++) {
        const k = j * grid.nx + i;
        assert.equal(seen[k], 0, 'rects do not overlap');
        seen[k] = 1;
        total++;
      }
    }
  }
  assert.equal(total, cells);

  const cover = F.coverRects(grid, ras.footprint);
  assert.ok(cover.length >= 2 && cover.length <= 48);
  const hit = new Uint8Array(ras.footprint.length);
  for (const r of cover) {
    assert.ok((r.x1 - r.x0) * (r.y1 - r.y0) >= 0.5e6, 'slivers are dropped');
    for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) hit[j * grid.nx + i] = 1;
  }
  let covered = 0;
  for (let k = 0; k < hit.length; k++) if (ras.footprint[k] && hit[k]) covered++;
  assert.ok(covered / cells > 0.97, `covered ${covered}/${cells}`);
  // a cover rectangle never leaves the footprint
  for (let k = 0; k < hit.length; k++) assert.ok(!hit[k] || ras.footprint[k], 'cover stays inside the footprint');
});

test('footprint: enclosed area comes from walls when there are no rooms', () => {
  const p = shed();
  const grid = F.makeGrid(p);
  const ras = F.rasteriseLevel(grid, p.levels[0], () => true);
  const area = F.maskCount(ras.enclosed) * 0.01;
  assert.ok(area > 18 && area < 26, `enclosed ${area} m2`);
  assert.equal(F.maskCount(ras.rooms), 0);
});

// Walk mode logic ------------------------------------------------------------------------------------------------

test('walk colliders: doors are passable, windows are not', () => {
  assert.equal(isPassable({ kind: 'door', sill: 0, height: 2040 }), true);
  assert.equal(isPassable({ kind: 'garage_door', sill: 0, height: 2100 }), true);
  assert.equal(isPassable({ kind: 'window', sill: 0, height: 2100 }), false);
  assert.equal(isPassable({ kind: 'window', sill: 900, height: 1200 }), false);
  assert.equal(isPassable({ kind: 'door', sill: 0, height: 1500 }), false, 'too low to walk through');

  const p = lHouse({ furniture: false });
  const level = p.levels[0];
  const colliders = buildColliders(p, level.id);
  assert.ok(colliders.length > level.walls.length, 'walls split around door openings');

  // west wall x = 0 with a door centred at y = 2.6
  const door = level.openings.find((o) => o.kind === 'door' && Math.abs(o.offset) > 0 && level.walls.find((w) => w.id === o.wallId).a.x === 0 && level.walls.find((w) => w.id === o.wallId).b.x === 0);
  assert.ok(door, 'west door exists');
  const w = level.walls.find((x) => x.id === door.wallId);
  const dy = (w.a.y + (w.b.y - w.a.y) * (door.offset / G.wallLength(w))) / 1000;
  const through = resolveCollisions({ x: 0, z: dy }, colliders);
  assert.ok(Math.abs(through.x) < 1e-6 && Math.abs(through.z - dy) < 1e-6, 'a point in the doorway is not pushed');
  const beside = resolveCollisions({ x: 0, z: dy + 1.2 }, colliders);
  assert.ok(Math.abs(beside.x) >= 0.125 + WALK.radius - 1e-6, 'beside the door the wall pushes out');

  // window on the north wall at x = 2.75, sill 900: solid
  const blocked = resolveCollisions({ x: 2.75, z: 0.1 }, colliders);
  assert.ok(blocked.z >= 0.125 + WALK.radius - 1e-6, `pushed into the room ${blocked.z}`);
  const blockedOut = resolveCollisions({ x: 2.75, z: -0.1 }, colliders);
  assert.ok(blockedOut.z <= -(0.125 + WALK.radius) + 1e-6, `pushed outside ${blockedOut.z}`);
  // clear space is untouched
  const free = resolveCollisions({ x: 2.75, z: 2.5 }, colliders);
  assert.deepEqual(free, { x: 2.75, z: 2.5 });
});

test('walk colliders ignore hidden walls', () => {
  const p = extension();
  const L = p.levels[0];
  const demolish = L.walls.filter((w) => w.status === 'demolish').map((w) => w.id);
  assert.ok(demolish.length);
  const proposed = buildColliders(p, L.id, { statusView: 'proposed' });
  assert.ok(proposed.every((c) => !demolish.includes(c.wallId)));
  const existing = buildColliders(p, L.id, { statusView: 'existing' });
  assert.ok(existing.some((c) => demolish.includes(c.wallId)));
});

test('spawn: inside the largest indoor room, or the walled area when there are no rooms', () => {
  const p = lHouse({ furniture: false });
  const level = p.levels[0];
  const s = chooseSpawn(p, level.id);
  const living = level.rooms.find((r) => r.name === 'Living');
  assert.equal(s.roomId, living.id);
  assert.ok(G.pointInPolygon({ x: s.x * 1000, y: s.z * 1000 }, living.polygon));
  assert.ok(Number.isFinite(s.yaw));
  const colliders = buildColliders(p, level.id);
  const fixed = resolveCollisions({ x: s.x, z: s.z }, colliders);
  assert.ok(Math.hypot(fixed.x - s.x, fixed.z - s.z) < 1e-6, 'the spawn point is clear of walls');

  const sp = shed();
  const t = chooseSpawn(sp, sp.levels[0].id);
  assert.equal(t.roomId, null);
  assert.ok(t.x > 0.5 && t.x < 5.5 && t.z > 0.5 && t.z < 3.5, `shed spawn ${t.x}, ${t.z}`);

  const up = twoStorey();
  const first = up.levels.find((l) => l.name === 'First');
  const u = chooseSpawn(up, first.id);
  assert.ok(first.rooms.some((r) => r.id === u.roomId), 'spawn on the first floor uses a first floor room');
});

// Finish picker logic -----------------------------------------------------------------------------------------------

test('picker: what a click on each surface can change', () => {
  const p = lHouse({ furniture: false });
  const find = (id) => findEntity(p, id);
  const L = p.levels[0];
  const ext = L.walls.find((w) => w.kind === 'exterior');
  const int = L.walls.find((w) => w.kind === 'interior');

  const outside = describeHit(p, { kind: 'wall', id: ext.id, levelId: L.id, face: 'outside', slot: 'out' }, catalogue, find);
  assert.equal(outside.title, 'Walls');
  assert.equal(outside.target, 'external_walls');
  assert.equal(outside.current.material, p.finishes.externalWalls.material);
  assert.equal(outside.scope.label, 'This wall only');
  assert.equal(outside.scope.checked, false);

  const inside = describeHit(p, { kind: 'wall', id: ext.id, levelId: L.id, face: 'inside', slot: 'in' }, catalogue, find);
  assert.equal(inside.target, 'internal_walls');
  assert.equal(inside.scope, null, 'inside faces of external walls follow the house');

  const interior = describeHit(p, { kind: 'wall', id: int.id, levelId: L.id, face: 'inside', slot: 'in' }, catalogue, find);
  assert.equal(interior.target, 'internal_walls');
  assert.ok(interior.scope);

  assert.equal(describeHit(p, { kind: 'roof', id: `${L.id}:roof`, levelId: L.id, slot: 'roof' }, catalogue, find).target, 'roof');
  assert.equal(describeHit(p, { kind: 'roof', id: `${L.id}:roof`, levelId: L.id, slot: 'gable' }, catalogue, find).target, 'external_walls');
  const fascia = describeHit(p, { kind: 'roof', id: `${L.id}:roof`, levelId: L.id, slot: 'fascia' }, catalogue, find);
  assert.equal(fascia.target, 'fascia');
  assert.equal(fascia.hasMaterial, false);

  const win = L.openings.find((o) => o.kind === 'window');
  const frames = describeHit(p, { kind: 'opening', id: win.id, levelId: L.id }, catalogue, find);
  assert.equal(frames.title, 'Window frames');
  assert.equal(frames.target, 'frames');
  const gd = L.openings.find((o) => o.kind === 'garage_door');
  assert.equal(describeHit(p, { kind: 'opening', id: gd.id, levelId: L.id }, catalogue, find).target, 'fascia');

  const room = L.rooms.find((r) => r.name === 'Living');
  const floor = describeHit(p, { kind: 'floor', id: room.id, levelId: L.id, finish: { material: 'timber', colour: 'floor-natural-oak' } }, catalogue, find);
  assert.equal(floor.title, 'Floor');
  assert.equal(floor.scope.op, 'update_room');
  const tank = describeHit(p, { kind: 'tank', id: p.site.tanks[0].id, levelId: L.id }, catalogue, find);
  assert.equal(tank.title, 'Tank');
  assert.equal(tank.apply, 'tank');
});

test('picker: choices become store operations that validate and apply', () => {
  const p = lHouse({ furniture: false });
  const store = createStore(p, { opContext: { catalogue: { validateFinish: finishes.validateFinish } } });
  const find = (id) => store.find(id);
  const L = store.project.levels[0];
  const ext = L.walls.find((w) => w.kind === 'exterior');

  const desc = describeHit(store.project, { kind: 'wall', id: ext.id, levelId: L.id, face: 'outside', slot: 'out' }, catalogue, find);
  const mats = materialsForTarget(catalogue, desc.target);
  assert.ok(mats.some((m) => m.id === 'weatherboard'));
  assert.ok(!mats.some((m) => m.id === 'paint'), 'paint is not offered for external walls');
  const cols = coloursForTarget(catalogue, desc.target, 'weatherboard');
  assert.ok(cols.length > 4 && cols.every((c) => /^#[0-9a-f]{6}$/i.test(c.hex)));

  let step = operationFor(desc, { material: 'weatherboard', colour: cols[0].id }, false);
  assert.equal(step.op, 'set_finish');
  store.run(step.op, step.args);
  assert.equal(store.project.finishes.externalWalls.material, 'weatherboard');

  step = operationFor(desc, { material: 'render', colour: coloursForTarget(catalogue, desc.target, 'render')[0].id }, true);
  assert.equal(step.op, 'update_wall');
  store.run(step.op, step.args);
  assert.equal(store.find(ext.id).item.finish.material, 'render');
  assert.equal(store.project.finishes.externalWalls.material, 'weatherboard', 'house finish unchanged by a one wall change');

  const room = L.rooms.find((r) => r.name === 'Bed 1');
  const fdesc = describeHit(store.project, { kind: 'floor', id: room.id, levelId: L.id, finish: { material: 'timber', colour: 'floor-natural-oak' } }, catalogue, find);
  const fcol = coloursForTarget(catalogue, 'floors', 'carpet')[0].id;
  step = operationFor(fdesc, { material: 'carpet', colour: fcol }, true);
  assert.equal(step.op, 'update_room');
  store.run(step.op, step.args);
  assert.equal(store.find(room.id).item.floor.material, 'carpet');
  step = operationFor(fdesc, { material: 'tile', colour: coloursForTarget(catalogue, 'floors', 'tile')[0].id }, false);
  assert.equal(step.op, 'set_finish');
  store.run(step.op, step.args);
  assert.equal(store.project.finishes.floors.material, 'tile');

  const tankDesc = describeHit(store.project, { kind: 'tank', id: store.project.site.tanks[0].id, levelId: L.id }, catalogue, find);
  step = operationFor(tankDesc, { colour: 'steel-dune' }, false);
  assert.equal(step.op, 'update_tank');
  store.run(step.op, step.args);
  assert.equal(store.project.site.tanks[0].colour, 'steel-dune');

  // the model rebuilds with the changes and stays valid
  const info = inspect(buildModel(store.project, { catalogue }));
  assert.equal(info.nan, 0);
});

test('picker works without a catalogue using built in lists', () => {
  const mats = materialsForTarget(null, 'roof');
  assert.ok(mats.length >= 3);
  const cols = coloursForTarget(null, 'external_walls', null);
  assert.ok(cols.length >= 6 && cols.every((c) => /^#[0-9a-f]{6}$/i.test(c.hex)));
});

// ---- Wave 2: doors in the walk-through, collisions and 3D editing logic ----------------------------------

import { applyDoorPose, createDoors, findDoorTarget, DOOR } from '../src/viewer3d/doors.js';
import * as EL from '../src/viewer3d/edit-logic.js';
import { DEFAULTS } from '../src/model/schema.js';

function doorHouse(opening = {}) {
  const p = createProject({ type: 'house' });
  applyOp(p, 'add_room', { type: 'living', x: 0, y: 0, width: 6000, depth: 4000 }, {});
  const o = applyOp(p, 'add_opening', { kind: 'door', x: 3000, y: 0, ...opening }, {});
  return { p, o: p.levels[0].openings.find((q) => q.id === o.id) };
}
const leafOf = (g, id) => {
  let m = null;
  g.traverse((x) => {
    if (x.isMesh && x.userData.leaf && x.userData.id === id) m = x;
  });
  return m;
};

test('door leaf is its own mesh with its pivot at the hinge and swings 90 degrees to the chosen side', () => {
  for (const hinge of ['a', 'b']) {
    for (const side of [1, -1]) {
      const { p, o } = doorHouse({ hinge, side });
      const wall = p.levels[0].walls.find((w) => w.id === o.wallId);
      const g = buildModel(p, { showRoof: false });
      g.updateMatrixWorld(true);
      const leaf = leafOf(g, o.id);
      assert.ok(leaf, 'leaf mesh exists');
      assert.equal(leaf.userData.motion.type, 'hinged');
      const d = G.wallDir(wall);
      const n = G.wallNormal(wall);
      const c0 = G.pointOnWall(wall, o.offset);
      // pivot sits at the hinge end of the opening, on the wall centre line
      const hingeSign = hinge === 'a' ? -1 : 1;
      const expect = { x: c0.x / 1000 + (d.x * hingeSign * (o.width / 2 - 50)) / 1000, z: c0.y / 1000 + (d.y * hingeSign * (o.width / 2 - 50)) / 1000 };
      assert.ok(Math.hypot(leaf.position.x - expect.x, leaf.position.z - expect.z) < 0.002, `pivot at the hinge (${hinge})`);
      const mid = () => {
        leaf.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(leaf);
        const c = b.getCenter(new THREE.Vector3());
        return { u: (c.x - c0.x / 1000) * d.x + (c.z - c0.y / 1000) * d.y, v: (c.x - c0.x / 1000) * n.x + (c.z - c0.y / 1000) * n.y };
      };
      const closed = mid();
      assert.ok(Math.abs(closed.v) < 0.05, 'closed leaf lies in the wall');
      applyDoorPose(leaf, 1);
      const open = mid();
      assert.ok(Math.abs(open.u - (hingeSign * (o.width / 2000 - 0.05))) < 0.06, 'open leaf stands at the hinge end');
      assert.ok(open.v * side > 0.3, `leaf opens to side ${side}, got v=${open.v.toFixed(2)}`);
      applyDoorPose(leaf, 0);
      assert.ok(Math.abs(mid().v) < 0.05, 'closes again');
    }
  }
});

test('sliding doors slide and garage doors roll up', () => {
  const p = createProject({ type: 'house' });
  applyOp(p, 'add_room', { type: 'living', x: 0, y: 0, width: 9000, depth: 4000 }, {});
  const sd = applyOp(p, 'add_opening', { kind: 'sliding_door', x: 2000, y: 0 }, {});
  const gd = applyOp(p, 'add_opening', { kind: 'garage_door', x: 6500, y: 0, width: 2400 }, {});
  const g = buildModel(p, { showRoof: false });
  const slider = leafOf(g, sd.id);
  const x0 = slider.position.clone();
  applyDoorPose(slider, 1);
  assert.ok(slider.position.distanceTo(x0) > 0.5, 'sash slides across');
  applyDoorPose(slider, 0);
  assert.ok(slider.position.distanceTo(x0) < 1e-6);
  const roll = leafOf(g, gd.id);
  const top = new THREE.Box3().setFromObject(roll).max.y;
  applyDoorPose(roll, 1);
  const b = new THREE.Box3().setFromObject(roll);
  assert.ok(Math.abs(b.max.y - top) < 0.01, 'rolls up towards the head');
  assert.ok(b.max.y - b.min.y < 0.3);
});

test('doors manager: animation over 0.4 s, state kept across rebuilds', () => {
  const { p, o } = doorHouse();
  const doors = createDoors();
  let g = buildModel(p, { showRoof: false });
  doors.attach(g);
  assert.equal(doors.blocks(o.id), true, 'closed doors block');
  doors.set(o.id, true);
  doors.update(0.1);
  assert.ok(doors.openness(o.id) > 0.2 && doors.openness(o.id) < 0.3);
  assert.equal(doors.blocks(o.id), true, 'still blocking while barely open');
  doors.update(0.1);
  doors.update(0.1);
  assert.equal(doors.blocks(o.id), false);
  doors.update(0.2);
  assert.equal(doors.openness(o.id), 1);
  assert.equal(doors.busy, false);
  // rebuild: the new leaf mesh starts open
  g = buildModel(p, { showRoof: false });
  doors.attach(g);
  assert.ok(Math.abs(leafOf(g, o.id).rotation.y) > 1.5);
  doors.toggle(o.id);
  for (let i = 0; i < 6; i++) doors.update(0.1);
  assert.equal(doors.openness(o.id), 0);
  assert.ok(Math.abs(leafOf(g, o.id).rotation.y) < 1e-9);
  assert.equal(DOOR.time, 0.4);
});

test('closed hinged doors are walls for the player, open ones are not, sliding doors stay passable', () => {
  const { p, o } = doorHouse();
  const L = p.levels[0];
  const open = new Set();
  const blocking = (q) => !open.has(q.id);
  const cols = buildColliders(p, L.id, { blockingDoor: blocking });
  const door = cols.find((c) => c.door === o.id);
  assert.ok(door, 'closed door has a collider');
  const wall = L.walls.find((w) => w.id === o.wallId);
  const c = G.pointOnWall(wall, o.offset);
  const inside = { x: c.x / 1000, z: c.y / 1000 + 1.2 };
  const through = resolveCollisions({ x: c.x / 1000, z: c.y / 1000 + 0.1 }, cols);
  assert.ok(through.z - c.y / 1000 > 0.2, 'pushed back out of the doorway');
  void inside;
  open.add(o.id);
  const free = buildColliders(p, L.id, { blockingDoor: blocking });
  assert.ok(!free.some((x) => x.door === o.id));
  const spot = resolveCollisions({ x: c.x / 1000, z: c.y / 1000 }, free);
  assert.ok(Math.abs(spot.z - c.y / 1000) < 1e-6, 'open door lets the player stand in the gap');
  // without the option colliders are as before
  assert.ok(!buildColliders(p, L.id).some((x) => x.door));
  const q = createProject({ type: 'house' });
  applyOp(q, 'add_room', { type: 'living', x: 0, y: 0, width: 6000, depth: 4000 }, {});
  const sd = applyOp(q, 'add_opening', { kind: 'sliding_door', x: 3000, y: 0 }, {});
  assert.ok(!buildColliders(q, q.levels[0].id, { blockingDoor: () => true }).some((x) => x.door === sd.id));
});

test('door target: within 1.5 m and roughly in view', () => {
  const { p, o } = doorHouse();
  const L = p.levels[0];
  const wall = L.walls.find((w) => w.id === o.wallId);
  const c = G.pointOnWall(wall, o.offset);
  const cx = c.x / 1000;
  const cz = c.y / 1000;
  const yawToward = Math.PI; // facing -Z? camera looks down -Z at yaw 0, so yaw PI looks down +Z
  // stand 1.0 m inside (z larger than the wall at z=0) and look at the door (towards -Z, yaw 0)
  const near = findDoorTarget(p, L.id, { x: cx, z: cz + 1.0 }, 0);
  assert.equal(near?.opening.id, o.id);
  assert.equal(findDoorTarget(p, L.id, { x: cx, z: cz + 1.0 }, yawToward), null, 'looking away');
  assert.equal(findDoorTarget(p, L.id, { x: cx, z: cz + 2.2 }, 0), null, 'too far');
  assert.equal(findDoorTarget(p, L.id, { x: cx, z: cz + 1.2 }, Math.PI / 4)?.opening.id, o.id, 'a little off axis is fine');
  assert.equal(findDoorTarget(p, L.id, { x: cx, z: cz + 1.2 }, Math.PI / 2), null, 'side on');
});

test('edit: snapping, dragging and clash detection', () => {
  assert.equal(EL.snapMm(1224), 1200);
  assert.equal(EL.snapMm(1226), 1250);
  assert.equal(Object.is(EL.snapMm(-10), 0), true);
  const pos = EL.dragPosition({ x: 1000, y: 2000 }, { x: 500, y: 500 }, { x: 790, y: 380 });
  assert.deepEqual(pos, { x: 1300, y: 1900 });
  // furniture against the wall turns red, away from it does not
  const p = lHouse();
  const L = p.levels[0];
  const f = L.furniture[0];
  const here = EL.footprintOf('furniture', f, f.x, f.y, f.rotation, (id) => furn.getFurniture(id));
  const clashes = new Set(EL.clashingWall(L, here) ? [f.id] : []);
  const model = new Set(applyClash(p).map((c) => c.furnitureId));
  assert.equal(clashes.has(f.id), model.has(f.id), 'agrees with furnitureClashes');
  const wall = L.walls[0];
  const mid = G.wallMid(wall);
  const onWall = EL.footprintOf('furniture', f, mid.x, mid.y, 0, (id) => furn.getFurniture(id));
  assert.equal(EL.clashingWall(L, onWall) != null, true);
});
function applyClash(p) {
  return clashList(p);
}
import { furnitureClashes as clashList } from '../src/model/ops.js';

test('edit: sideways wall drag keeps only the normal component', () => {
  const wall = { id: 'w', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 100 };
  const m = EL.wallDragMove(wall, { x: 1000, y: 0 }, { x: 1700, y: 524 });
  assert.equal(m.dx, 0);
  assert.equal(Math.abs(m.dy), 500);
  const diag = EL.wallDragMove({ ...wall, b: { x: 3000, y: 3000 } }, { x: 0, y: 0 }, { x: 0, y: 0 });
  assert.equal(diag.s, 0);
});

test('edit: wall points snap to ends, the grid, and square to the previous point', () => {
  const p = lHouse();
  const L = p.levels[0];
  const w = L.walls[0];
  assert.deepEqual(EL.snapWallPoint(L, { x: w.a.x + 60, y: w.a.y - 80 }), { x: w.a.x, y: w.a.y, snapped: 'end' });
  const far = { x: -20000, y: -20000 };
  assert.deepEqual(EL.snapWallPoint({ walls: [] }, { x: far.x + 13, y: far.y + 37 }), { x: -20000, y: -20000 + 50 * 1, snapped: 'grid' });
  assert.equal(EL.snapWallPoint({ walls: [] }, { x: 1040, y: 3000 }, { x: 1000, y: 0 }).snapped, 'ortho');
  assert.equal(EL.snapWallPoint({ walls: [] }, { x: 1040, y: 3000 }, { x: 1000, y: 0 }).x, 1000);
  assert.deepEqual(EL.rectFromPoints({ x: 3000, y: 100 }, { x: 1000, y: 2100 }), { x: 1000, y: 100, width: 2000, depth: 2000 });
});

test('edit: ghost opening is clamped inside the wall and flags overlaps', () => {
  const { p, o } = doorHouse();
  const L = p.levels[0];
  const wall = L.walls.find((w) => w.id === o.wallId);
  const g = EL.openingGhost(L, wall, 'window', 10, DEFAULTS.openings);
  assert.equal(g.offset, 100 + g.width / 2);
  assert.equal(g.fits, true);
  const over = EL.openingGhost(L, wall, 'window', o.offset, DEFAULTS.openings);
  assert.equal(over.fits, false);
  assert.equal(over.clashId, o.id);
});

test('edit: the operations the 3D editor uses commit as single undo steps', () => {
  const p = lHouse();
  const store = createStore(p, { opContext: { catalogue: { getFurniture: furn.getFurniture, validateFinish: finishes.validateFinish } } });
  const L = store.project.levels[0];
  const f = L.furniture[0];
  const x0 = f.x;
  store.run('update_furniture', { id: f.id, x: x0 + 300, y: f.y });
  assert.equal(store.find(f.id).item.x, x0 + 300);
  assert.ok(store.undo());
  assert.equal(store.find(f.id).item.x, x0);
  const s2 = createStore(twoStorey());
  const stair = s2.project.levels[0].stairs[0];
  s2.run('update_stair', { id: stair.id, x: stair.x + 100, y: stair.y, rotation: 90 });
  assert.equal(s2.find(stair.id).item.rotation, 90);
  assert.equal(EL.nextRotation(0, -90), 270);
  assert.equal(EL.nextRotation(350, 15), 5);
  // walls and rooms drawn in 3D
  const st = createStore(createProject({ type: 'house' }));
  st.run('add_wall', { x1: 0, y1: 0, x2: 3000, y2: 0 });
  st.run('add_wall', { x1: 3000, y1: 0, x2: 3000, y2: 2000 });
  assert.equal(st.project.levels[0].walls.length, 2);
  const r = st.run('add_room', { type: 'other', x: 5000, y: 5000, width: 3000, depth: 2500 });
  assert.ok(st.find(r.id));
});

// ---- Wave 3: level changes while walking, placing things ahead ----------------------------------------------

import { nudgeToFloor, footprintTester, aheadPlacement, facingRotation, yawToDir, AHEAD_MM } from '../src/viewer3d/place-logic.js';

test('level change keeps x and z when the spot is on the new floor and clear of walls', () => {
  const p = twoStorey();
  const first = p.levels.find((l) => l.name === 'First');
  const ground = p.levels[0];
  const spawn = chooseSpawn(p, first.id);
  const cols = buildColliders(p, first.id);
  const same = nudgeToFloor(p, first.id, spawn.x, spawn.z, { colliders: cols });
  assert.equal(same.moved, false);
  assert.equal(same.x, spawn.x);
  assert.equal(same.z, spawn.z);
  assert.ok(first.elevation > ground.elevation, 'eye height follows the level elevation');
});

test('level change nudges a point outside the footprint to the nearest valid point', () => {
  const p = twoStorey();
  const first = p.levels.find((l) => l.name === 'First');
  const cols = buildColliders(p, first.id);
  const inFoot = footprintTester(p, first.id);
  const bb = G.levelBounds(first);
  const out = { x: bb.minX / 1000 - 3, z: bb.cy / 1000 };
  assert.equal(inFoot(out.x, out.z), false);
  const fixed = nudgeToFloor(p, first.id, out.x, out.z, { colliders: cols });
  assert.equal(fixed.moved, true);
  assert.ok(inFoot(fixed.x, fixed.z), 'inside the footprint');
  const again = resolveCollisions({ x: fixed.x, z: fixed.z }, cols);
  assert.ok(Math.hypot(again.x - fixed.x, again.z - fixed.z) < 1e-3, 'clear of walls');
  assert.ok(Math.hypot(fixed.x - out.x, fixed.z - out.z) < 3 + 2.5, 'close to where the player was');
});

test('level change nudges a point inside a wall out of it', () => {
  const p = twoStorey();
  const first = p.levels.find((l) => l.name === 'First');
  const w = first.walls.find((x) => G.wallLength(x) > 2000);
  const mid = G.wallMid(w);
  const cols = buildColliders(p, first.id);
  const fixed = nudgeToFloor(p, first.id, mid.x / 1000, mid.y / 1000, { colliders: cols });
  assert.equal(fixed.moved, true);
  const r = resolveCollisions({ x: fixed.x, z: fixed.z }, cols);
  assert.ok(Math.hypot(r.x - fixed.x, r.z - fixed.z) < 1e-3);
});

test('level change on a level without rooms uses the walled area', () => {
  const p = shed();
  const L = p.levels[0];
  const cols = buildColliders(p, L.id);
  const s = chooseSpawn(p, L.id);
  const ok = nudgeToFloor(p, L.id, s.x, s.z, { colliders: cols });
  assert.equal(ok.moved, false);
  const far = nudgeToFloor(p, L.id, s.x + 20, s.z, { colliders: cols });
  assert.ok(far.x < s.x + 20);
});

test('facing rotation turns the front (+y in plan) towards the player', () => {
  assert.equal(facingRotation(0, 1), 0);
  assert.equal(facingRotation(0, -1), 180);
  assert.equal(facingRotation(-1, 0), 90);
  assert.equal(facingRotation(1, 0), 270);
  // the item's front after rotating is the direction to the player
  for (const [dx, dy] of [[0.6, 0.8], [-0.8, 0.6], [0.3, -0.95]]) {
    const r = facingRotation(dx, dy);
    const f = G.rotatePoint({ x: 0, y: 1 }, { x: 0, y: 0 }, r);
    assert.ok(f.x * dx + f.y * dy > 0.99, `facing ${dx}, ${dy} at ${r}`);
  }
  const d = yawToDir(0);
  assert.ok(Math.abs(d.x) < 1e-9 && Math.abs(d.z + 1) < 1e-9, 'yaw 0 looks along -Z');
});

test('placement ahead: 1.5 m in front, snapped to 50 mm, facing back', () => {
  const origin = { x: 2013, y: 4021 };
  const dir = { x: 0, y: -1 };
  const a = aheadPlacement(origin, dir, 'sofa_3', { sizeOf: (id) => furn.getFurniture(id) });
  assert.equal(a.x % 50, 0);
  assert.equal(a.y % 50, 0);
  assert.ok(Math.abs(a.y - (4021 - AHEAD_MM)) <= 25 && Math.abs(a.x - 2013) <= 25);
  assert.equal(a.rotation, 0, 'the item is north of the player, so its front (south) faces the player');
  const east = aheadPlacement(origin, { x: 1, y: 0 }, 'sofa_3', { sizeOf: (id) => furn.getFurniture(id) });
  assert.equal(east.rotation, 90, 'the item is east of the player, so its front faces west');
});

test('placement ahead is pulled back when it would sit in a wall', () => {
  const p = lHouse({ furniture: false });
  const level = p.levels[0];
  const w = level.walls.find((x) => x.a.y === 0 && x.b.y === 0 && G.wallLength(x) > 4000);
  const size = { w: 1800, d: 900 };
  const origin = { x: (w.a.x + w.b.x) / 2, y: w.a.y + 1800 };
  const dir = { x: 0, y: -1 };
  const a = aheadPlacement(origin, dir, 'sofa_3', { level, size, sizeOf: () => size });
  const corners = G.rectCorners(a.x, a.y, size.w, size.d, a.rotation);
  assert.equal(a.clashes, false);
  assert.equal(a.rotation, 0);
  assert.equal(EL.clashingWall(level, corners), null);
  assert.ok(origin.y - a.y < AHEAD_MM, 'pulled in towards the player');
});

test('add_furniture from a spot ahead of the player validates and is one undo step', () => {
  const store = createStore(lHouse({ furniture: false }), { opContext: { catalogue: { getFurniture: furn.getFurniture, validateFinish: finishes.validateFinish } } });
  const level = store.level();
  const a = aheadPlacement({ x: 3000, y: 3000 }, { x: 1, y: 0 }, 'sofa_3', { sizeOf: (id) => furn.getFurniture(id), level });
  const res = store.run('add_furniture', { level: level.id, item: 'sofa_3', x: a.x, y: a.y, rotation: a.rotation });
  const f = store.find(res.id);
  assert.equal(f.item.x, a.x);
  assert.equal(f.item.rotation, a.rotation);
  store.undo();
  assert.equal(store.find(res.id), null);
  assert.throws(() => store.run('add_furniture', { level: level.id, item: 'nope', x: 0, y: 0 }));
});

// Stairs -------------------------------------------------------------------------------------------------
const houseDouble = () => TEMPLATES.find((t) => t.id === 'house_double').create();

test('stairs: infos give the climb direction, rise and both ends', () => {
  const p = houseDouble();
  const [info] = ST.stairInfos(p);
  assert.ok(info.connects);
  assert.equal(info.level.name, 'Ground');
  assert.equal(info.upper.name, 'First');
  assert.ok(Math.abs(info.rise - 3) < 1e-9);
  // rotation 180 climbs towards -y (north on the plan)
  assert.ok(Math.abs(info.dx) < 1e-9 && Math.abs(info.dz + 1) < 1e-9);
  const bottom = ST.stairPoint(info, 0, 0);
  const top = ST.stairPoint(info, 0, info.length);
  assert.ok(bottom.z > top.z, 'the bottom end is south of the top end');
  assert.ok(Math.abs(bottom.z - top.z - info.length) < 1e-9);
  // the model puts the first step at the bottom end: stairLocal agrees
  const { v } = ST.stairLocal(info, bottom.x, bottom.z);
  assert.ok(Math.abs(v) < 1e-9);
});

test('stairs: the walking surface rises with the climb and levels out at the top landing', () => {
  const [info] = ST.stairInfos(houseDouble());
  assert.equal(ST.stairHeight(info, 0), 0);
  let last = -1;
  for (let v = 0; v <= info.length; v += 0.1) {
    const h = ST.stairHeight(info, v);
    assert.ok(h >= last - 1e-12);
    last = h;
  }
  assert.ok(Math.abs(ST.stairHeight(info, info.length - info.mouth) - info.rise) < 1e-9);
  assert.ok(Math.abs(ST.stairHeight(info, info.length) - info.rise) < 1e-9);
  assert.ok(ST.stairHeight(info, info.length / 2) > 0.5 && ST.stairHeight(info, info.length / 2) < info.rise);
});

test('stairs: joining from the bottom of the lower level or the top of the upper level, and level hysteresis', () => {
  const [info] = ST.stairInfos(houseDouble());
  const lower = info.level.id;
  const upper = info.upper.id;
  const zoneAt = (v, level) => {
    const p = ST.stairPoint(info, 0, v);
    return ST.stairZoneAt([info], level, p.x, p.z);
  };
  assert.ok(ST.canJoinStair(zoneAt(0.2, lower), lower, { x: 0, z: 0 }), 'from the lower level at the bottom end');
  assert.ok(!ST.canJoinStair(zoneAt(2, lower), lower, { x: 0, z: 0 }), 'not from the middle');
  assert.ok(!ST.canJoinStair(zoneAt(info.length - 0.2, lower), lower, { x: 0, z: 0 }), 'not at the top mouth from the lower level');
  const down = { x: -info.dx * 0.05, z: -info.dz * 0.05 };
  const up = { x: info.dx * 0.05, z: info.dz * 0.05 };
  assert.ok(ST.canJoinStair(zoneAt(info.length - 0.2, upper), upper, down), 'stepping down into the top end');
  assert.ok(!ST.canJoinStair(zoneAt(info.length - 0.2, upper), upper, up), 'walking along the top of the stair is not a descent');
  assert.ok(!ST.canJoinStair(zoneAt(info.length - 0.2, upper), upper, { x: 0, z: 0 }), 'standing still is not a descent');
  assert.equal(ST.levelOnStair(info, 0.5, lower), lower);
  assert.equal(ST.levelOnStair(info, info.switchHigh + 0.01, lower), upper);
  assert.equal(ST.levelOnStair(info, 0.5, upper), upper, 'stays on the upper level through the middle');
  assert.equal(ST.levelOnStair(info, info.switchLow - 0.01, upper), lower);
});

test('stairs: the player can walk in at the bottom end, is held between the rails, and can leave at the top', () => {
  const p = houseDouble();
  const infos = ST.stairInfos(p);
  const [info] = infos;
  const cols = [...buildColliders(p, info.level.id), ...ST.stairColliders(p, info.level.id, infos)];
  const at = (u, v) => ST.stairPoint(info, u, v);
  const same = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) < 1e-6;
  // up the centre line from the bottom landing: never pushed
  for (let v = -0.9; v <= info.length - info.mouth - 0.3; v += 0.1) {
    const q = at(0, v);
    assert.ok(same(resolveCollisions(q, cols), q), `free at v=${v.toFixed(1)}`);
  }
  // pushing sideways in the middle of the stair: stopped by the rail
  let q = at(0, info.length / 2);
  for (let i = 0; i < 40; i++) {
    const l = ST.stairLocal(info, q.x, q.z);
    q = resolveCollisions(ST.stairPoint(info, l.u + 0.05, l.v), cols);
  }
  const held = ST.stairLocal(info, q.x, q.z);
  assert.ok(held.u < info.width / 2, `held inside, u=${held.u.toFixed(2)}`);
  // the top mouth is closed on the lower level (the steps meet the floor above), open on the upper level
  const mouth = at(0, info.length - info.mouth / 2);
  assert.ok(!same(resolveCollisions(mouth, cols), mouth), 'blocked from below');
  const upperCols = [...buildColliders(p, info.upper.id), ...ST.stairColliders(p, info.upper.id, infos)];
  const rails = upperCols.filter((c) => c.stair);
  assert.equal(rails.length, 2, 'two rails on the upper level as well');
  const sideMouth = at(info.width / 2 + 0.3, info.length - 0.2);
  assert.ok(same(resolveCollisions(sideMouth, rails), sideMouth), 'free to step off sideways at the top mouth');
});

test('stairs: a climb ends on the upper level and a descent on the lower level', () => {
  const p = houseDouble();
  const infos = ST.stairInfos(p);
  const [info] = infos;
  const sim = (startV, dirSign, startLevel) => {
    let level = startLevel;
    let pos = ST.stairPoint(info, 0, startV);
    let joined = false;
    for (let i = 0; i < 400; i++) {
      const cols = [...buildColliders(p, level), ...ST.stairColliders(p, level, infos)];
      const prev = pos;
      pos = resolveCollisions({ x: pos.x + info.dx * dirSign * 0.05, z: pos.z + info.dz * dirSign * 0.05 }, cols);
      let zone = joined ? ST.stairZoneAt([info], level, pos.x, pos.z, 0.1) : ST.stairZoneAt(infos, level, pos.x, pos.z);
      if (zone && !joined && !ST.canJoinStair(zone, level, { x: pos.x - prev.x, z: pos.z - prev.z })) zone = null;
      if (!zone) {
        if (joined) break;
        continue;
      }
      joined = true;
      level = ST.levelOnStair(info, zone.frac, level);
    }
    return { level, pos, joined };
  };
  const up = sim(-0.7, 1, info.level.id);
  assert.ok(up.joined);
  assert.equal(up.level, info.upper.id, 'climbing reaches the upper level');
  const down = sim(info.length + 0.2, -1, info.upper.id);
  assert.ok(down.joined);
  assert.equal(down.level, info.level.id, 'descending reaches the lower level');
});

test('stairs: the landing is on the floor, clear of walls and not behind one', () => {
  const p = houseDouble();
  const infos = ST.stairInfos(p);
  const [info] = infos;
  for (const side of ['top', 'bottom']) {
    const id = side === 'top' ? info.upper.id : info.level.id;
    const cols = [...buildColliders(p, id), ...ST.stairColliders(p, id, infos)];
    const inFoot = footprintTester(p, id);
    const valid = (x, z) => inFoot(x, z) && Math.hypot(...Object.values(resolveCollisions({ x, z }, cols)).map((c, i) => c - [x, z][i])) < 1e-3;
    const land = ST.chooseLanding(info, side, { valid, colliders: cols });
    assert.equal(land.levelId, id);
    assert.ok(valid(land.x, land.z), `${side} landing is a good place to stand`);
  }
  // the First floor robe sits just beyond the top end: the landing must not be on the far side of its wall
  const top = ST.chooseLanding(info, 'top', {
    valid: footprintTester(p, info.upper.id),
    colliders: buildColliders(p, info.upper.id),
  });
  const robeSide = ST.stairPoint(info, 0, info.length + 0.85);
  assert.ok(Math.hypot(top.x - robeSide.x, top.z - robeSide.z) > 0.5, 'not through the wall at the end of the stair');
});

test('stairs: the stair target is found within reach and in front, and says up or down', () => {
  const p = houseDouble();
  const infos = ST.stairInfos(p);
  const [info] = infos;
  const bottom = ST.stairPoint(info, 0, -1.2);
  const facing = Math.atan2(-info.dx, -info.dz);
  const t = ST.findStairTarget(infos, info.level.id, { x: bottom.x, z: bottom.z }, facing);
  assert.equal(t.goes, 'up');
  assert.equal(ST.findStairTarget(infos, info.level.id, { x: bottom.x, z: bottom.z }, facing + Math.PI), null, 'not when facing away');
  const far = ST.stairPoint(info, 0, -6);
  assert.equal(ST.findStairTarget(infos, info.level.id, { x: far.x, z: far.z }, facing), null, 'not from far away');
  const top = ST.stairPoint(info, 0, info.length - 0.2);
  const t2 = ST.findStairTarget(infos, info.upper.id, { x: top.x, z: top.z }, facing + Math.PI);
  assert.equal(t2.goes, 'down');
});

test('stairs: a stair with no level above is a solid block, not a way up', () => {
  const p = createProject({ levels: 1 });
  applyOp(p, 'add_stair', { x: 3000, y: 3000, width: 1000, length: 3600, rotation: 0 }, {});
  const infos = ST.stairInfos(p);
  assert.equal(infos[0].connects, false);
  assert.equal(ST.stairZoneAt(infos, p.levels[0].id, 3, 3), null);
  const cols = ST.stairColliders(p, p.levels[0].id, infos);
  assert.equal(cols.length, 1);
  const f = resolveCollisions({ x: 3, z: 3 }, cols);
  assert.ok(Math.hypot(f.x - 3, f.z - 3) > 0.3, 'pushed out of the block');
});

test('stairs and furniture: update_stair and delete are single undo steps for the 3D editor', () => {
  const store = createStore(houseDouble(), { opContext: { catalogue: { getFurniture: furn.getFurniture } } });
  const s = store.project.levels[0].stairs[0];
  store.run('update_stair', { id: s.id, x: s.x + 500, y: s.y - 250 });
  assert.equal(store.find(s.id).item.x, 9750);
  assert.equal(store.find(s.id).item.y, 11300);
  store.undo();
  assert.equal(store.find(s.id).item.x, 9250);
  store.run('delete', { id: s.id });
  assert.equal(store.find(s.id), null);
  store.undo();
  assert.ok(store.find(s.id));
});
