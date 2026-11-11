import test from 'node:test';
import assert from 'node:assert/strict';
import { listRoomTabs, roomViewpoint, tabViewpoint, cutawayPose, roomAtPoint, flyTo, snapToRoom } from '../src/viewer3d/rooms.js';
import { clearanceAt, EYE_HEIGHT, MIN_WALL_CLEAR, ROOM_FOV } from '../src/viewer3d/room-logic.js';
import { SAMPLES } from '../src/viewer3d/samples.js';
import { TEMPLATES } from '../src/catalogue/templates.js';
import * as G from '../src/model/geometry.js';
import { getFurniture } from '../src/catalogue/furniture.js';

const projects = [
  ...Object.entries(SAMPLES).map(([k, f]) => [`sample ${k}`, f()]),
  ...TEMPLATES.map((t) => [`template ${t.id}`, t.create()]),
];
const DASH = /[-‐-―−]/;
const ids = (tabs) => tabs.map((t) => t.id);

test('tab derivation: single storey house with open plan', () => {
  const p = TEMPLATES.find((t) => t.id === 'house_single').create();
  const tabs = listRoomTabs(p);
  assert.deepEqual(ids(tabs), ['living', 'kitchen', 'dining', 'master', 'bed2', 'bed3', 'bed4', 'alfresco', 'garage', 'aerial']);
  const byId = Object.fromEntries(tabs.map((t) => [t.id, t]));
  // the open plan room serves the kitchen, dining and living tabs
  const open = p.levels[0].rooms.find((r) => /Kitchen, dining/.test(r.name));
  for (const id of ['living', 'kitchen', 'dining']) assert.ok(byId[id].roomIds.includes(open.id), id);
  assert.equal(byId.master.roomIds.length, 1);
  assert.equal(p.levels[0].rooms.find((r) => r.id === byId.master.roomIds[0]).name, 'Master');
  assert.equal(byId.aerial.roomIds.length, 0);
  assert.equal(tabs.at(-1).id, 'aerial');
});

test('tab derivation: only rooms that exist, names and types matched', () => {
  const l = SAMPLES.lHouse();
  assert.deepEqual(ids(listRoomTabs(l)), ['living', 'kitchen', 'master', 'alfresco', 'garage', 'aerial']); // Deck is the outdoor tab, Bed 1 the master
  assert.deepEqual(ids(listRoomTabs(SAMPLES.shed())), ['aerial']);
  const big = SAMPLES.bigHouse();
  assert.deepEqual(ids(listRoomTabs(big)), ['living', 'kitchen', 'dining', 'master', 'bed2', 'bed3', 'alfresco', 'garage', 'aerial']);
  const alf = listRoomTabs(big).find((t) => t.id === 'alfresco');
  assert.equal(alf.roomIds.length, 2, 'alfresco and deck share the outdoor tab');
  // bathrooms, ensuites, robes and laundries never become bedroom tabs
  for (const t of listRoomTabs(big)) if (/^(master|bed\d)$/.test(t.id)) for (const rid of t.roomIds) assert.equal(big.levels[0].rooms.find((r) => r.id === rid).type, 'bedroom');
});

test('tab derivation: levels', () => {
  const p = SAMPLES.twoStorey();
  const all = listRoomTabs(p);
  assert.deepEqual(ids(all), ['living', 'kitchen', 'master', 'bed2', 'bed3', 'garage', 'aerial']);
  const upper = p.levels.find((l) => l.name === 'First');
  const up = listRoomTabs(p, upper.id);
  assert.deepEqual(ids(up), ['master', 'bed2', 'bed3', 'aerial']);
  assert.equal(all.find((t) => t.id === 'master').levelId, upper.id);
  const grouped = listRoomTabs(p, upper.id, { groupBedrooms: true });
  assert.deepEqual(ids(grouped), ['bedrooms', 'aerial']);
  assert.equal(grouped[0].roomIds.length, 3);
});

test('captions: area first, no dashes, a view sentence', () => {
  for (const [name, p] of projects) {
    for (const t of listRoomTabs(p)) {
      assert.ok(!DASH.test(t.caption), `${name} ${t.id}: ${t.caption}`);
      assert.ok(!DASH.test(t.label));
      assert.match(t.caption, /^[A-Z][^·]+ · [A-Z].+\.$/, `${name} ${t.id}: ${t.caption}`);
    }
  }
  const single = listRoomTabs(TEMPLATES.find((t) => t.id === 'house_single').create());
  assert.equal(single.find((t) => t.id === 'living').caption, 'Living area · A view across the family area to the alfresco.');
  assert.match(single.find((t) => t.id === 'kitchen').caption, /^Kitchen · A view across the open plan living area to the kitchen\.$/);
  assert.match(single.find((t) => t.id === 'master').caption, /^Master bedroom · A view across the master bedroom /);
});

const furnitureHit = (level, p) => {
  for (const f of level.furniture) {
    const item = getFurniture(f.item);
    const w = f.w ?? item?.w ?? 600;
    const d = f.d ?? item?.d ?? 600;
    const c = { x: f.x, y: f.y };
    const rect = [{ x: -w / 2, y: -d / 2 }, { x: w / 2, y: -d / 2 }, { x: w / 2, y: d / 2 }, { x: -w / 2, y: d / 2 }].map((q) => G.rotatePoint({ x: c.x + q.x, y: c.y + q.y }, c, f.rotation || 0));
    if (G.pointInPolygon(p, rect)) return f;
  }
  return null;
};

test('viewpoints: inside every room, at eye height, clear of walls and furniture', () => {
  let n = 0;
  const tight = [];
  for (const [name, p] of projects) {
    for (const level of p.levels) {
      for (const room of level.rooms) {
        const vp = roomViewpoint(p, room.id);
        assert.ok(vp, `${name} ${room.name}`);
        n++;
        const pos = { x: vp.position.x * 1000, y: vp.position.z * 1000 };
        assert.ok(G.pointInPolygon(pos, room.polygon), `${name} ${room.name} inside polygon`);
        assert.ok(Math.abs(vp.position.y - (level.elevation / 1000 + EYE_HEIGHT)) < 1e-9, `${name} ${room.name} eye height`);
        assert.equal(vp.levelId, level.id);
        assert.equal(vp.fov, ROOM_FOV);
        for (const v of [vp.position.x, vp.position.y, vp.position.z, vp.target.x, vp.target.y, vp.target.z]) assert.ok(Number.isFinite(v));
        const cl = clearanceAt(level, pos, room.polygon) / 1000;
        if (cl < (/garage/i.test(room.name) ? 0.2 : MIN_WALL_CLEAR) - 1e-9) tight.push(`${name} ${room.name} ${cl.toFixed(2)}`);
        assert.equal(furnitureHit(level, pos), null, `${name} ${room.name} not inside furniture`);
        // looking somewhere: target is not the eye
        assert.ok(Math.hypot(vp.target.x - vp.position.x, vp.target.z - vp.position.z) > 0.5);
      }
    }
  }
  assert.ok(n > 60, `checked ${n} rooms`);
  assert.deepEqual(tight, [], 'every room has a spot at least 0.4 m from walls');
});

test('viewpoints: look across the room, not at the nearest wall', () => {
  const p = TEMPLATES.find((t) => t.id === 'house_single').create();
  const living = p.levels[0].rooms.find((r) => r.name === 'Lounge');
  const vp = roomViewpoint(p, living.id);
  const bb = G.bbox(living.polygon);
  const dist = Math.hypot(vp.target.x - vp.position.x, vp.target.z - vp.position.z);
  assert.ok(dist > Math.min(bb.w, bb.h) / 1000 * 0.8, `look distance ${dist}`);
  // tab viewpoints for the open plan room differ per tab
  const tabs = listRoomTabs(p);
  const a = tabViewpoint(p, tabs.find((t) => t.id === 'kitchen'));
  const b = tabViewpoint(p, tabs.find((t) => t.id === 'dining'));
  assert.notDeepEqual(a.target, b.target);
  assert.equal(tabViewpoint(p, tabs.find((t) => t.id === 'aerial')), null);
  assert.equal(roomViewpoint(p, 'nope'), null);
});

test('upper level viewpoints use that level floor', () => {
  const p = SAMPLES.twoStorey();
  const tabs = listRoomTabs(p);
  const vp = tabViewpoint(p, tabs.find((t) => t.id === 'master'));
  const upper = p.levels.find((l) => l.name === 'First');
  assert.equal(vp.levelId, upper.id);
  assert.ok(Math.abs(vp.position.y - (upper.elevation / 1000 + 1.6)) < 1e-9);
});

test('cutaway pose: room centred, about 45 degrees, camera outside the room', () => {
  const p = TEMPLATES.find((t) => t.id === 'house_single').create();
  const room = p.levels[0].rooms.find((r) => r.name === 'Master');
  const pose = cutawayPose(p, room.id);
  const bb = G.bbox(room.polygon);
  assert.ok(Math.abs(pose.target.x - bb.cx / 1000) < 1e-6 && Math.abs(pose.target.z - bb.cy / 1000) < 1e-6);
  const dx = pose.position.x - pose.target.x;
  const dz = pose.position.z - pose.target.z;
  const dy = pose.position.y - pose.target.y;
  const pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
  assert.ok(pitch > 40 && pitch < 60, `pitch ${pitch}`);
  assert.ok(Math.hypot(dx, dz, dy) > Math.hypot(bb.w, bb.h) / 1000 / 2, 'far enough to see the room');
  assert.equal(pose.levelId, p.levels[0].id);
});

test('roomAtPoint: floor, wall and level lookups', () => {
  const p = SAMPLES.twoStorey();
  const g = p.levels[0];
  const upper = p.levels.find((l) => l.name === 'First');
  const living = g.rooms.find((r) => r.name === 'Living');
  assert.equal(roomAtPoint(p, 3, 3, g.id).room.id, living.id);
  assert.equal(roomAtPoint(p, 2, 2, upper.id).room.name, 'Bed 1');
  assert.equal(roomAtPoint(p, 2, 2, null, 0.1).room.id, living.id, 'a ground floor hit finds the ground room');
  assert.equal(roomAtPoint(p, 2, 2, null, 3.2).room.name, 'Bed 1', 'an upper floor hit finds the room above');
  assert.equal(roomAtPoint(p, 6.02, 2, g.id).room.name.length > 0, true, 'a point on a wall finds a neighbour');
  assert.equal(roomAtPoint(p, 50, 50, g.id), null);
});

// A stand in viewer: no browser, no three.
function fakeViewer({ mode = 'orbit' } = {}) {
  const canvas = new EventTarget();
  const cam = { position: { x: 20, y: 12, z: 20, set(x, y, z) { Object.assign(this, { x, y, z }); } }, fov: 38, aspect: 1.6, updateProjectionMatrix() {} };
  const controls = { target: { x: 5, y: 1, z: 5, set(x, y, z) { Object.assign(this, { x, y, z }); } }, update() {}, addEventListener() {}, removeEventListener() {} };
  const placed = [];
  const v = {
    mode, camera: cam, controls, canvas, invalidate() {}, stopAnim() {},
    walk: { active: mode === 'walk', yaw: 0.3, pitch: 0, placeAt(a) { placed.push(a); return true; } },
    aerialPose: () => ({ position: { x: 30, y: 25, z: 30 }, target: { x: 6, y: 1, z: 6 } }),
    leaveWalk() { v.mode = 'orbit'; v.walk.active = false; },
  };
  return { v, placed };
}

test('flyTo: eases the camera to the pose and sets the field of view', async () => {
  const { v } = fakeViewer();
  const pose = { position: { x: 1, y: 1.6, z: 2 }, target: { x: 4, y: 1.2, z: 5 }, fov: 70 };
  const r = await flyTo(v, pose, { duration: 0.06 });
  assert.equal(r.completed, true);
  assert.deepEqual([v.camera.position.x, v.camera.position.y, v.camera.position.z], [1, 1.6, 2]);
  assert.deepEqual([v.controls.target.x, v.controls.target.y, v.controls.target.z], [4, 1.2, 5]);
  assert.equal(v.camera.fov, 70);
});

test('flyTo: user input cancels where it is', async () => {
  const { v } = fakeViewer();
  const pose = { position: { x: 1, y: 1.6, z: 2 }, target: { x: 4, y: 1.2, z: 5 } };
  const p = flyTo(v, pose, { duration: 0.5 });
  await new Promise((r) => setTimeout(r, 120));
  v.canvas.dispatchEvent(new Event('pointerdown'));
  const r = await p;
  assert.equal(r.completed, false);
  assert.ok(v.camera.position.x > 1 && v.camera.position.x < 20, 'stopped part way');
});

test('flyTo: a second flight replaces the first', async () => {
  const { v } = fakeViewer();
  const a = flyTo(v, { position: { x: 0, y: 1, z: 0 }, target: { x: 1, y: 1, z: 1 } }, { duration: 0.4 });
  const b = flyTo(v, { position: { x: 3, y: 1.6, z: 3 }, target: { x: 4, y: 1, z: 4 } }, { duration: 0.05 });
  assert.equal((await a).completed, false);
  assert.equal((await b).completed, true);
  assert.equal(v.camera.position.x, 3);
});

test('flyTo in walk mode moves the walker, level set at the end', async () => {
  const { v, placed } = fakeViewer({ mode: 'walk' });
  const pose = { position: { x: 2, y: 4.6, z: 3 }, target: { x: 2, y: 4.2, z: -3 }, levelId: 'L2' };
  const r = await flyTo(v, pose, { duration: 0.05 });
  assert.equal(r.completed, true);
  assert.ok(placed.length >= 2);
  assert.ok(placed.slice(0, -1).every((a) => !a.levelId));
  const last = placed.at(-1);
  assert.equal(last.levelId, 'L2');
  assert.ok(Math.abs(last.x - 2) < 1e-9 && Math.abs(last.y - 4.6) < 1e-9 && Math.abs(last.z - 3) < 1e-9);
  assert.ok(Math.abs(Math.abs(last.yaw) % (2 * Math.PI)) < 1e-6 || Math.abs(Math.abs(last.yaw) - 2 * Math.PI) < 1e-6, 'looking along minus Z');
});

test('snapToRoom: tab ids, room ids, aerial and unknown ids', async () => {
  const p = TEMPLATES.find((t) => t.id === 'house_single').create();
  const { v } = fakeViewer();
  const r = await snapToRoom(v, p, 'kitchen', { duration: 0 });
  assert.equal(r.completed, true);
  assert.equal(v.camera.position.y, 1.6);
  assert.equal(v.camera.fov, ROOM_FOV);
  const roomId = p.levels[0].rooms.find((x) => x.name === 'Bed 2').id;
  const r2 = await snapToRoom(v, p, roomId, { duration: 0 });
  assert.equal(r2.pose.roomId, roomId);
  const r3 = await snapToRoom(v, p, 'aerial', { duration: 0 });
  assert.equal(v.camera.position.y, 25);
  assert.equal(v.camera.fov, 38, 'the aerial view restores the orbit field of view');
  assert.equal(r3.completed, true);
  assert.equal(await snapToRoom(v, p, 'no-such-tab', { duration: 0 }), null);
  const w = fakeViewer({ mode: 'walk' });
  await snapToRoom(w.v, p, 'aerial', { duration: 0 });
  assert.equal(w.v.mode, 'orbit', 'the aerial view leaves walk mode');
});
