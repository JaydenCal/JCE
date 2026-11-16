import test from 'node:test';
import assert from 'node:assert/strict';
import * as X from '../src/viewer3d/explode-logic.js';
import { SAMPLES } from '../src/viewer3d/samples.js';
import { TEMPLATES } from '../src/catalogue/templates.js';

const house = () => TEMPLATES.find((t) => t.id === 'house_single').create();
const two = () => SAMPLES.twoStorey();
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('smooth and easing curves: zero and one at the ends, monotonic, clamped', () => {
  for (const f of [X.smooth, X.easeInOutCubic]) {
    assert.equal(f(0), 0);
    assert.equal(f(1), 1);
    assert.equal(f(-5), 0);
    assert.equal(f(7), 1);
    let last = -1;
    for (let i = 0; i <= 100; i++) {
      const v = f(i / 100);
      assert.ok(v >= last - 1e-12);
      last = v;
    }
  }
  near(X.smooth(0.5), 0.5);
});

test('phases: all start at 0 and end at 1, in the cinematic order', () => {
  const a = X.phases(0);
  const z = X.phases(1);
  for (const k of ['pull', 'roof', 'levels', 'slide', 'fade', 'fly']) {
    assert.equal(a[k], 0, k);
    assert.equal(z[k], 1, k);
  }
  const mid = X.phases(0.3);
  assert.ok(mid.pull > mid.roof && mid.roof > mid.levels && mid.levels > mid.slide, 'camera first, then roof, floors, rooms');
  assert.equal(mid.fly, 0, 'the fly in only starts late');
  assert.equal(X.phases(-1).p, 0);
  assert.equal(X.phases(9).p, 1);
  // every curve is monotonic in p
  for (const k of ['pull', 'roof', 'levels', 'slide', 'fade', 'fly']) {
    let last = 0;
    for (let i = 0; i <= 50; i++) {
      const v = X.phases(i / 50)[k];
      assert.ok(v >= last - 1e-12, k);
      last = v;
    }
  }
});

test('stepProgress: moves at the set speed, never overshoots, jumps for reduced motion', () => {
  near(X.stepProgress(0, 1, 0.6, { up: 2.4 }), 0.25);
  assert.equal(X.stepProgress(0.95, 1, 5), 1);
  assert.equal(X.stepProgress(0.1, 0, 5), 0);
  assert.equal(X.stepProgress(0.4, 1, 0.001, { reduced: true }), 1);
  assert.equal(X.stepProgress(0.4, 0, 0.001, { reduced: true }), 0);
  assert.equal(X.stepProgress(1, 1, 0.1), 1);
  assert.equal(X.stepProgress(0.3, 1, NaN), 1);
  // collapsing is quicker than exploding by default
  assert.ok(1 - X.stepProgress(1, 0, 0.5) > X.stepProgress(0, 1, 0.5));
});

test('explodeTargets: rooms move away from the centre, floors stack, the roof sits above its level', () => {
  const p = house();
  const t = X.explodeTargets(p);
  const centre = t.centre;
  const lvl = p.levels[0];
  assert.equal(t.rooms.size, lvl.rooms.length);
  for (const r of lvl.rooms) {
    const off = t.rooms.get(r.id);
    const c = r.polygon.reduce((s, q) => ({ x: s.x + q.x / r.polygon.length, y: s.y + q.y / r.polygon.length }), { x: 0, y: 0 });
    const dir = { x: c.x - centre.x, y: c.y - centre.y };
    // moves outward: never towards the centre
    assert.ok(off.x * dir.x + off.z * dir.y >= -1, r.name);
  }
  const lv = t.levels.get(lvl.id);
  assert.equal(lv.y, 0);
  assert.ok(lv.roofY > lv.y);
  const t2 = X.explodeTargets(two());
  const ys = [...t2.levels.values()].sort((a, b) => a.index - b.index).map((l) => l.y);
  assert.deepEqual(ys, [0, X.LEVEL_GAP]);
  assert.ok(t2.levels.get([...t2.levels.keys()][1]).roofY > ys[1]);
});

test('explodeTargets: the selected room stays put on the plan, the others still slide', () => {
  const p = house();
  const sel = p.levels[0].rooms.find((r) => /Master/.test(r.name));
  const t = X.explodeTargets(p, { selectedId: sel.id });
  assert.deepEqual(t.rooms.get(sel.id), { x: 0, z: 0 });
  const other = p.levels[0].rooms.find((r) => /Garage/.test(r.name));
  assert.ok(Math.hypot(t.rooms.get(other.id).x, t.rooms.get(other.id).z) >= X.MIN_GAP - 1e-9);
  const poses = X.cinematicPoses(p, sel.id, { position: { x: 1, y: 1, z: 1 }, target: { x: 0, y: 0, z: 0 } });
  const c = { x: poses.roomCentre.x * 1000, z: poses.roomCentre.z * 1000 };
  const bb = sel.polygon.reduce((a, q) => ({ x0: Math.min(a.x0, q.x), x1: Math.max(a.x1, q.x), y0: Math.min(a.y0, q.y), y1: Math.max(a.y1, q.y) }), { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 });
  assert.ok(c.x >= bb.x0 && c.x <= bb.x1 && c.z >= bb.y0 && c.z <= bb.y1, 'the camera looks at the room where it is');
});

test('offsetFor: nothing moves at p=0, everything is at its target at p=1, rooms slide only horizontally', () => {
  const p = two();
  const t = X.explodeTargets(p);
  const upper = p.levels.find((l) => l.name === 'First');
  const room = upper.rooms[0];
  const unit = { role: 'room', roomId: room.id, levelId: upper.id };
  assert.deepEqual(X.offsetFor(t, unit, X.phases(0)), { x: 0, y: 0, z: 0 });
  const full = X.offsetFor(t, unit, X.phases(1));
  assert.equal(full.y, X.LEVEL_GAP);
  assert.equal(full.x, t.rooms.get(room.id).x);
  assert.equal(full.z, t.rooms.get(room.id).z);
  // a level unit (slab) only rises
  const slab = X.offsetFor(t, { role: 'level', levelId: upper.id }, X.phases(1));
  assert.deepEqual(slab, { x: 0, y: X.LEVEL_GAP, z: 0 });
  // the roof rises further than the level it covers
  const roof = X.offsetFor(t, { role: 'roof', levelId: upper.id }, X.phases(1));
  assert.ok(roof.y > full.y + X.ROOF_LIFT - 1e-9);
  // mid explode: roof leads the floors
  const early = X.phases(0.3);
  const r0 = X.offsetFor(t, { role: 'roof', levelId: upper.id }, early).y;
  const f0 = X.offsetFor(t, { role: 'level', levelId: upper.id }, early).y;
  assert.ok(r0 > f0);
});

test('opacityFor: the selected room stays solid, the rest fade back, the roof ghosts', () => {
  const sel = { role: 'room', roomId: 'a', levelId: 'l' };
  const other = { role: 'room', roomId: 'b', levelId: 'l' };
  const slab = { role: 'level', levelId: 'l' };
  const roof = { role: 'roof', levelId: 'l' };
  assert.equal(X.opacityFor(other, 'a', X.phases(0)), 1);
  assert.equal(X.opacityFor(sel, 'a', X.phases(1)), 1);
  assert.equal(X.opacityFor(other, 'a', X.phases(1)), X.FADE_TO);
  assert.equal(X.opacityFor(slab, 'a', X.phases(1)), X.FADE_TO);
  assert.equal(X.opacityFor(roof, 'a', X.phases(1)), X.ROOF_FADE_TO);
  assert.equal(X.isLockedUnit(sel, 'a'), false);
  assert.equal(X.isLockedUnit(other, 'a'), true);
  assert.equal(X.isLockedUnit(slab, 'a'), true);
});

test('wallOwners: every wall is owned, the selected room wins a shared wall', () => {
  const p = house();
  const rooms = p.levels[0].rooms;
  const own = X.wallOwners(p);
  for (const w of p.levels[0].walls) assert.ok(own.has(w.id));
  const shared = [...own.entries()].find(([, v]) => v.rooms.length > 1);
  assert.ok(shared, 'the plan has a wall between two rooms');
  const [wid, v] = shared;
  for (const rid of v.rooms) assert.equal(X.wallOwners(p, rid).get(wid).roomId, rid);
  assert.ok(rooms.some((r) => own.get(wid).roomId === r.id));
});

test('classify: floors, walls, openings, furniture, stairs and roofs go to the right unit; ground stays', () => {
  const p = house();
  const l = p.levels[0];
  const own = X.wallOwners(p);
  const room = l.rooms.find((r) => /Master/.test(r.name));
  assert.deepEqual(X.classify(p, { kind: 'floor', id: room.id, levelId: l.id }, own), { role: 'room', roomId: room.id, levelId: l.id });
  assert.equal(X.classify(p, { ground: true, levelId: l.id }, own), null);
  assert.equal(X.classify(p, { kind: 'wall', id: 'x' }, own), null, 'no level: site element stays');
  assert.equal(X.classify(p, { kind: 'roof', id: `${l.id}:roof`, levelId: l.id }, own).role, 'roof');
  assert.equal(X.classify(p, { decor: true, levelId: l.id }, own).role, 'level');
  const op = l.openings[0];
  assert.equal(X.classify(p, { kind: 'opening', id: op.id, levelId: l.id, wallId: op.wallId }, own).roomId, own.get(op.wallId).roomId);
  const f = l.furniture.find((x) => X.roomOfPoint(l, x));
  const fu = X.classify(p, { kind: 'furniture', id: f.id, levelId: l.id }, own);
  assert.equal(fu.roomId, X.roomOfPoint(l, f));
  assert.equal(X.classify(p, { kind: 'wall', id: l.walls[0].id, levelId: 'nope' }, own), null);
});

test('camera: starts at the base pose, ends in the selected room, the overview is further out and higher', () => {
  const p = house();
  const room = p.levels[0].rooms.find((r) => /Master/.test(r.name));
  const base = { position: { x: 14, y: 10, z: 16 }, target: { x: 5, y: 1.2, z: 4 } };
  const poses = X.cinematicPoses(p, room.id, base, { fov: 38, aspect: 1.6 });
  assert.deepEqual(X.cameraAt(X.phases(0), poses), base);
  const end = X.cameraAt(X.phases(1), poses);
  near(end.position.x, poses.focus.position.x);
  near(end.target.z, poses.focus.target.z);
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const dOver = d(poses.overview.position, poses.overview.target);
  const dFocus = d(poses.focus.position, poses.focus.target);
  assert.ok(dOver > dFocus * 2, 'pulled back far, then flies in close');
  // the focus looks at the displaced room
  near(poses.focus.target.x, poses.roomCentre.x);
  assert.ok(poses.focus.position.y > poses.focus.target.y, 'looks down into the room');
  // half way through the pull the camera is between base and overview
  const mid = X.cameraAt({ ...X.phases(0), pull: 0.5 }, poses);
  near(mid.position.y, (base.position.y + poses.overview.position.y) / 2);
  // the whole exploded building fits the overview view
  const ext = poses.extent;
  assert.ok(ext.radius > 3);
  assert.ok(dOver >= ext.radius, 'camera is outside the exploded bounds');
});

test('camera: an unknown room falls back to the overview, a taller building pulls back further', () => {
  const p = two();
  const base = { position: { x: 0, y: 5, z: 10 }, target: { x: 0, y: 0, z: 0 } };
  const a = X.cinematicPoses(p, 'nope', base);
  assert.deepEqual(a.focus, a.overview);
  const one = X.cinematicPoses(house(), null, base);
  assert.ok(Number.isFinite(one.overview.position.x));
  const fit = X.fitDistance(10, { fov: 38, aspect: 0.5 });
  assert.ok(fit > X.fitDistance(10, { fov: 38, aspect: 2 }), 'a narrow phone screen needs more distance');
});

test('explodedExtent grows with the explosion and covers every level', () => {
  const p = two();
  const t = X.explodeTargets(p);
  const ext = X.explodedExtent(p, t);
  const flat = X.explodedExtent(p, X.explodeTargets(p, { levelGap: 0, roofLift: 0, slideK: 0, minGap: 0 }));
  assert.ok(ext.max.y > flat.max.y + X.LEVEL_GAP - 1e-9);
  assert.ok(ext.max.x - ext.min.x >= flat.max.x - flat.min.x);
  assert.equal(X.explodedExtent({ levels: [] }, { levels: new Map(), rooms: new Map() }).radius, 1);
});

test('every sample and template gives finite targets and poses', () => {
  const all = [...Object.values(SAMPLES).map((f) => f()), ...TEMPLATES.map((t) => t.create())];
  for (const p of all) {
    const t = X.explodeTargets(p);
    for (const o of t.rooms.values()) assert.ok(Number.isFinite(o.x) && Number.isFinite(o.z));
    const rid = p.levels.flatMap((l) => l.rooms)[0]?.id;
    const poses = X.cinematicPoses(p, rid, { position: { x: 1, y: 1, z: 1 }, target: { x: 0, y: 0, z: 0 } });
    for (const v of [poses.overview.position, poses.focus.position, poses.focus.target]) for (const k of 'xyz') assert.ok(Number.isFinite(v[k]));
  }
});
