import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/viewer3d/room-edit-logic.js';
import { TEMPLATES } from '../src/catalogue/templates.js';
import { SAMPLES } from '../src/viewer3d/samples.js';
import { createStore } from '../src/model/store.js';
import * as G from '../src/model/geometry.js';

const house = () => TEMPLATES.find((t) => t.id === 'house_single').create();
const byName = (p, re) => p.levels.flatMap((l) => l.rooms).find((r) => re.test(r.name));

test('roomScope: walls, openings, furniture and neighbours of one room', () => {
  const p = house();
  const bed = byName(p, /Master/);
  const s = R.roomScope(p, bed.id);
  assert.equal(s.roomId, bed.id);
  assert.ok(s.wallIds.size >= 4);
  assert.ok(s.openingIds.size >= 1);
  for (const id of s.openingIds) assert.ok(s.wallIds.has(p.levels[0].openings.find((o) => o.id === id).wallId));
  for (const id of s.furnitureIds) assert.ok(G.pointInPolygon(p.levels[0].furniture.find((f) => f.id === id), bed.polygon));
  assert.ok(s.neighbourIds.size >= 1);
  assert.ok(!s.neighbourIds.has(bed.id));
  for (const id of s.sharedWallIds) assert.ok(s.wallIds.has(id));
  assert.equal(R.roomScope(p, 'missing'), null);
});

test('locking: only things in the room can be edited, everything else is locked', () => {
  const p = house();
  const l = p.levels[0];
  const bed = byName(p, /Master/);
  const garage = byName(p, /Garage/);
  const s = R.roomScope(p, bed.id);
  const g = R.roomScope(p, garage.id);
  const store = createStore(p);
  const find = (id) => store.find(id);
  // own things
  for (const id of s.wallIds) assert.ok(R.canEditEntity(s, find(id)), id);
  for (const id of s.openingIds) assert.ok(R.canEditEntity(s, find(id)), id);
  for (const id of s.furnitureIds) assert.ok(R.canEditEntity(s, find(id)), id);
  assert.ok(R.canEditEntity(s, find(bed.id)));
  // things that belong to the garage only
  const garageOnly = [...g.wallIds].filter((id) => !s.wallIds.has(id));
  assert.ok(garageOnly.length);
  for (const id of garageOnly) assert.equal(R.canEditEntity(s, find(id)), false);
  for (const id of [...g.openingIds].filter((id) => !s.openingIds.has(id))) assert.equal(R.canEditEntity(s, find(id)), false);
  for (const id of g.furnitureIds) assert.equal(R.canEditEntity(s, find(id)), false);
  assert.equal(R.canEditEntity(s, find(garage.id)), false, 'another room');
  assert.equal(R.canEditEntity(s, find(l.id)), false, 'levels are locked');
  assert.equal(R.canEditEntity(s, null), false);
  assert.equal(R.canEditEntity(null, find(bed.id)), false);
});

test('canTouchHit: picks in 3D follow the same rule', () => {
  const p = house();
  const bed = byName(p, /Master/);
  const kitchen = byName(p, /Kitchen/);
  const s = R.roomScope(p, bed.id);
  assert.equal(R.canTouchHit(s, { kind: 'floor', id: bed.id }), true);
  assert.equal(R.canTouchHit(s, { kind: 'floor', id: kitchen.id }), false);
  const w = [...s.wallIds][0];
  assert.equal(R.canTouchHit(s, { kind: 'wall', id: w }), true);
  assert.equal(R.canTouchHit(s, { kind: 'roof', id: 'x' }), false);
  assert.equal(R.canTouchHit(s, { ground: true }), false);
  assert.equal(R.canTouchHit(s, null), false);
  const op = [...s.openingIds][0];
  assert.equal(R.canTouchHit(s, { kind: 'opening', id: op }), true);
});

test('planResize: a free side changes only the room', () => {
  const p = house();
  const bed = byName(p, /Master/);
  const pl = R.planResize(p, bed.id, 'north', 400);
  assert.equal(pl.ok, true);
  assert.equal(pl.neighbours.length, 0);
  assert.equal(pl.selected.after.d, pl.selected.before.d + 400);
  // the real project is untouched by a plan
  assert.equal(G.bbox(bed.polygon).h, pl.selected.before.d);
});

test('planResize: a shared wall resizes the neighbour with it', () => {
  const p = house();
  const bed = byName(p, /Master/);
  const pl = R.planResize(p, bed.id, 'east', -300);
  assert.equal(pl.ok, true);
  assert.ok(pl.neighbours.length >= 1, 'the rooms on that wall follow');
  const ens = pl.neighbours.find((n) => /Ensuite/.test(n.name));
  assert.ok(ens);
  assert.equal(ens.after.w, ens.before.w + 300);
  assert.equal(ens.state, 'ok');
  // applying the same op for real gives the same result as the plan
  const store = createStore(p);
  store.run(pl.op.name, pl.op.args);
  const e2 = store.project.levels[0].rooms.find((r) => r.id === ens.roomId);
  assert.equal(Math.round(G.bbox(e2.polygon).w), ens.after.w);
  assert.ok(store.undo());
  assert.equal(Math.round(G.bbox(store.project.levels[0].rooms.find((r) => r.id === ens.roomId).polygon).w), ens.before.w);
});

test('planResize: warns when a neighbour gets tight, refuses when it would collapse', () => {
  const p = house();
  const bed = byName(p, /Master/);
  // the ensuite sits on the east side of the master and is 2400 wide: shrinking it by a lot should warn, then block
  const ens = byName(p, /Ensuite/);
  const w0 = G.bbox(ens.polygon).w;
  const warn = R.planResize(p, bed.id, 'east', w0 - 1000);
  assert.equal(warn.ok, true);
  const n = warn.neighbours.find((x) => x.roomId === ens.id);
  assert.equal(n.state, 'warn');
  assert.match(n.message, /Ensuite/);
  assert.ok(warn.warnings.length >= 1);
  const block = R.planResize(p, bed.id, 'east', w0 - 300);
  assert.equal(block.ok, false);
  assert.match(block.error, /squash/i);
});

test('planResize: refuses to make the room itself tiny, rejects a bad side', () => {
  const p = house();
  const bed = byName(p, /Master/);
  const tiny = R.planResize(p, bed.id, 'north', -(G.bbox(bed.polygon).h - 200));
  assert.equal(tiny.ok, false);
  assert.ok(tiny.error);
  assert.equal(R.planResize(p, bed.id, 'up', 100).ok, false);
  assert.equal(R.planResize(p, 'missing', 'north', 100).ok, false);
  const small = R.planResize(p, bed.id, 'north', -(G.bbox(bed.polygon).h - 2000));
  assert.equal(small.ok, true);
  assert.equal(small.selected.state, 'warn', 'a bedroom 2000 deep is allowed with a warning');
});

test('planWallMove: only walls of the room, shared walls report the neighbour', () => {
  const p = house();
  const bed = byName(p, /Master/);
  const s = R.roomScope(p, bed.id);
  const wallId = [...s.sharedWallIds][0];
  assert.ok(wallId);
  const w = p.levels[0].walls.find((x) => x.id === wallId);
  const n = G.wallNormal(w);
  const pl = R.planWallMove(p, bed.id, wallId, n.x * 100, n.y * 100);
  assert.equal(pl.shared, true);
  assert.ok(pl.affected.length >= 1);
  const other = p.levels[0].walls.find((x) => !s.wallIds.has(x.id));
  const bad = R.planWallMove(p, bed.id, other.id, 100, 0);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /locked/);
});

test('planSetSize: width and depth in one go', () => {
  const p = house();
  const bed = byName(p, /Master/);
  const b = G.bbox(bed.polygon);
  const pl = R.planSetSize(p, bed.id, { width: b.w + 200, depth: b.h + 100 });
  assert.equal(pl.ok, true);
  assert.equal(pl.selected.after.w, b.w + 200);
  assert.equal(pl.selected.after.d, b.h + 100);
  assert.equal(R.planSetSize(p, bed.id, { width: b.w, depth: b.h }).ok, true);
  assert.equal(R.planSetSize(p, bed.id, { width: 100 }).ok, false);
});

test('sideOfWall and suggestOpening', () => {
  const p = house();
  const bed = byName(p, /Master/);
  const s = R.roomScope(p, bed.id);
  const sides = new Set([...s.wallIds].map((id) => R.sideOfWall(p, bed.id, id)));
  assert.ok(sides.has('north') && sides.has('south') && sides.has('east') && sides.has('west'));
  const win = R.suggestOpening(p, bed.id, 'window');
  if (win) {
    assert.ok(s.wallIds.has(win.wallId));
    assert.ok(!s.sharedWallIds.has(win.wallId), 'windows only go on outside walls');
  }
  const door = R.suggestOpening(p, bed.id, 'door');
  assert.ok(door);
  assert.ok(s.wallIds.has(door.wallId));
  assert.equal(R.suggestOpening(p, 'missing', 'door'), null);
  // adding it through the store works and the new opening is then part of the room
  const store = createStore(p);
  const res = store.run('add_opening', { level: s.level.id, wall: door.wallId, kind: 'door', offset: door.offset });
  assert.ok(R.roomScope(store.project, bed.id).openingIds.has(res.id));
});

test('describeRoom: sizes, openings, fixtures', () => {
  const p = house();
  const bed = byName(p, /Master/);
  const d = R.describeRoom(p, bed.id);
  assert.equal(d.name, bed.name);
  assert.equal(d.w, 4800);
  assert.equal(d.rect, true);
  assert.ok(d.openings.length >= 1 && d.fixtures.length >= 1);
  assert.ok(d.neighbours.length >= 1);
  assert.equal(R.describeRoom(p, 'x'), null);
  assert.equal(R.isRect(byName(p, /Hall/).polygon), false);
});

test('roomAtPlanPoint and editableRooms', () => {
  const p = house();
  const bed = byName(p, /Master/);
  const c = G.polygonCentroid(bed.polygon);
  assert.equal(R.roomAtPlanPoint(p, c.x, c.y).room.id, bed.id);
  assert.equal(R.roomAtPlanPoint(p, -99999, 0), null);
  assert.ok(R.editableRooms(p).length >= 10);
});

test('the soft minimums are sensible and every room in every sample plans a harmless nudge', () => {
  assert.ok(R.softMinSide('bedroom') > R.softMinSide('wc'));
  assert.ok(R.softMinSide('nonsense') > 0);
  for (const f of Object.values(SAMPLES)) {
    const p = f();
    for (const { room } of R.editableRooms(p)) {
      if (room.outdoor) continue;
      for (const side of R.SIDES) {
        const pl = R.planResize(p, room.id, side, 100);
        assert.equal(typeof pl.ok, 'boolean');
        if (!pl.ok) assert.ok(pl.error);
      }
    }
  }
});
