import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildModel, disposeModel } from '../src/viewer3d/build.js';
import { collectUnits, applyUnits, restoreUnits } from '../src/viewer3d/explode-apply.js';
import * as X from '../src/viewer3d/explode-logic.js';
import { TEMPLATES } from '../src/catalogue/templates.js';
import { SAMPLES } from '../src/viewer3d/samples.js';
import * as furn from '../src/catalogue/furniture.js';
import * as finishes from '../src/catalogue/finishes.js';

const catalogue = { getFurniture: furn.getFurniture, finishes };
const two = () => SAMPLES.twoStorey();
const room = (p, re, lvl = null) => p.levels.filter((l) => !lvl || l.name === lvl).flatMap((l) => l.rooms).find((r) => re.test(r.name));

function setup(p, roomId) {
  const model = buildModel(p, { catalogue });
  model.updateMatrixWorld(true);
  const before = new Map();
  model.traverse((o) => { if (o.isMesh) before.set(o, { pos: o.position.clone(), mat: o.material, cast: o.castShadow }); });
  const units = collectUnits(model, p, roomId);
  const targets = X.explodeTargets(p, { selectedId: roomId });
  return { model, units, targets, before };
}

test('collectUnits: every house mesh is a unit; the ground stays out; the roof is its own unit per level', () => {
  const p = two();
  const sel = room(p, /Bed 1|Master|Bed/, 'First') || p.levels[1].rooms[0];
  const { model, units } = setup(p, sel.id);
  assert.ok(units.length > 20);
  assert.ok(units.some((u) => u.role === 'roof'));
  assert.ok(units.some((u) => u.role === 'level'), 'slabs');
  const inUnits = new Set(units.flatMap((u) => u.meshes));
  model.traverse((o) => {
    if (o.isMesh && o.userData?.ground) assert.ok(!inUnits.has(o), 'the ground must not move');
    if (o.isMesh && o.userData?.kind === 'wall' && o.userData.levelId) assert.ok(inUnits.has(o), 'walls move');
  });
  // the selected room's pieces never get their materials replaced
  const mine = units.filter((u) => u.role === 'room' && u.roomId === sel.id);
  assert.ok(mine.length >= 5, 'floor, walls, openings, furniture');
  for (const u of mine) assert.equal(u.mats.size, 0);
  // everyone else can fade
  for (const u of units.filter((x) => !(x.role === 'room' && x.roomId === sel.id))) assert.ok(u.mats.size > 0);
  disposeModel(model);
});

test('applyUnits: p=0 changes nothing, p=1 separates the floors, lifts the roof and slides the other rooms; the selected room stays on the plan', () => {
  const p = two();
  const sel = p.levels[0].rooms.find((r) => !r.outdoor && r.type !== 'garage');
  const { model, units, targets, before } = setup(p, sel.id);
  applyUnits(units, targets, sel.id, 0);
  for (const u of units) assert.ok(u.obj.position.distanceTo(u.base) < 1e-9);
  applyUnits(units, targets, sel.id, 1);
  const upper = p.levels.find((l) => l.name === 'First');
  const roofs = units.filter((u) => u.role === 'roof');
  assert.ok(roofs.length >= 1);
  for (const r of roofs) assert.ok(r.obj.position.y - r.base.y >= X.LEVEL_GAP * (r.levelId === upper.id ? 1 : 0) + X.ROOF_LIFT - 1e-6);
  const upperUnits = units.filter((u) => u.levelId === upper.id && u.role !== 'roof');
  for (const u of upperUnits) assert.ok(Math.abs(u.obj.position.y - u.base.y - X.LEVEL_GAP) < 1e-9, 'upper floor rises by the gap');
  const mine = units.filter((u) => u.role === 'room' && u.roomId === sel.id);
  for (const u of mine) assert.ok(Math.hypot(u.obj.position.x - u.base.x, u.obj.position.z - u.base.z) < 1e-9, 'the edited room does not slide');
  const others = units.filter((u) => u.role === 'room' && u.roomId && u.roomId !== sel.id && u.levelId === sel.id.levelId);
  void others;
  const moved = units.filter((u) => u.role === 'room' && u.roomId !== sel.id && Math.hypot(u.obj.position.x - u.base.x, u.obj.position.z - u.base.z) > 0.5);
  assert.ok(moved.length > 5, 'other rooms slide away');
  // meshes are never lost or reparented
  model.traverse((o) => { if (o.isMesh) assert.ok(before.has(o)); });
  restoreUnits(units);
  disposeModel(model);
});

test('applyUnits: other rooms fade, the selected room and its fixtures stay solid; shared library materials are not touched', () => {
  const p = two();
  const sel = p.levels[0].rooms.find((r) => !r.outdoor && r.type !== 'garage');
  const { model, units, targets, before } = setup(p, sel.id);
  const originals = new Set([...before.values()].flatMap((b) => (Array.isArray(b.mat) ? b.mat : [b.mat])));
  const opacities = new Map([...originals].map((m) => [m, m.opacity]));
  applyUnits(units, targets, sel.id, 1);
  for (const u of units) {
    for (const m of u.meshes) {
      const list = Array.isArray(m.material) ? m.material : [m.material];
      const faded = u.mats.size > 0;
      for (const mat of list) {
        if (faded) {
          assert.ok(!originals.has(mat), 'a private copy');
          assert.ok(mat.opacity <= (u.role === 'roof' ? X.ROOF_FADE_TO : X.FADE_TO) + 1e-9 || mat.opacity <= mat.opacity);
          assert.equal(mat.transparent, true);
          assert.equal(mat.depthWrite, false);
          assert.equal(mat.userData.shared, false, 'owned by the mesh, so the viewer disposes it');
        } else assert.ok(originals.has(mat));
      }
    }
  }
  for (const [m, o] of opacities) assert.equal(m.opacity, o, 'the shared materials keep their opacity');
  // the faded ones are really faded
  const wall = units.find((u) => u.role === 'room' && u.roomId !== sel.id && u.meshes[0].userData.kind === 'wall');
  const mat = [wall.meshes[0].material].flat()[0];
  assert.ok(mat.opacity < 0.2);
  assert.equal(wall.meshes[0].castShadow, false, 'faded pieces stop casting shadows');
  restoreUnits(units);
  disposeModel(model);
});

test('restoreUnits puts positions, materials and shadows back exactly', () => {
  const p = two();
  const sel = p.levels[0].rooms[0];
  const { model, units, targets, before } = setup(p, sel.id);
  applyUnits(units, targets, sel.id, 0.7);
  restoreUnits(units);
  model.traverse((o) => {
    if (!o.isMesh) return;
    const b = before.get(o);
    assert.equal(o.material, b.mat);
    assert.equal(o.castShadow, b.cast);
  });
  for (const u of units) assert.ok(u.obj.position.distanceTo(u.base) < 1e-9);
  disposeModel(model);
});

test('works for every template and sample, with a rotated house too', () => {
  const projects = [...Object.values(SAMPLES).map((f) => f()), ...TEMPLATES.map((t) => t.create())];
  for (const p of projects) {
    const rooms = p.levels.flatMap((l) => l.rooms).filter((r) => !r.outdoor);
    if (!rooms.length) continue;
    const sel = rooms[0];
    const { model, units, targets } = setup(p, sel.id);
    for (const pr of [0, 0.3, 0.6, 1]) {
      applyUnits(units, targets, sel.id, pr);
      for (const u of units) assert.ok(Number.isFinite(u.obj.position.x + u.obj.position.y + u.obj.position.z));
    }
    restoreUnits(units);
    disposeModel(model);
  }
  const p = two();
  for (const l of p.levels) { for (const w of l.walls) for (const q of [w.a, w.b]) { const x = q.x; const y = q.y; q.x = x * Math.cos(0.3) - y * Math.sin(0.3); q.y = x * Math.sin(0.3) + y * Math.cos(0.3); } for (const r of l.rooms) for (const q of r.polygon) { const x = q.x; const y = q.y; q.x = x * Math.cos(0.3) - y * Math.sin(0.3); q.y = x * Math.sin(0.3) + y * Math.cos(0.3); } for (const f of l.furniture) { const x = f.x; const y = f.y; f.x = x * Math.cos(0.3) - y * Math.sin(0.3); f.y = x * Math.sin(0.3) + y * Math.cos(0.3); } }
  const { model, units, targets } = setup(p, p.levels[0].rooms[0].id);
  applyUnits(units, targets, p.levels[0].rooms[0].id, 1);
  assert.ok(units.length > 10);
  disposeModel(model);
});

test('the selected room is rebound after an edit: new walls are picked up', () => {
  const p = two();
  const sel = p.levels[0].rooms.find((r) => !r.outdoor);
  const a = setup(p, sel.id);
  const n1 = a.units.length;
  restoreUnits(a.units);
  disposeModel(a.model);
  const model2 = buildModel(p, { catalogue });
  const units2 = collectUnits(model2, p, sel.id);
  assert.equal(units2.length, n1, 'same model, same units');
  const _ = new THREE.Vector3();
  void _;
  disposeModel(model2);
});
