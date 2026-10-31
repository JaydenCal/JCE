import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, validate } from '../src/model/schema.js';
import { applyOp } from '../src/model/ops.js';
import * as G from '../src/model/geometry.js';
import * as M from '../src/editor2d/math.js';
import { moveEndpoint, statusIdsFor, patchStair, exclusiveWalls } from '../src/editor2d/edit.js';
import { parseDesign } from '../src/ui/design-file.js';
import { areaSchedule, openingSchedule, computeWarnings, extensionTotals, roofPlanAreaM2, suggestRoomName, indoorTotalM2 } from '../src/ui/schedules.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

function sample() {
  const p = createProject({ name: 'T' });
  const L = p.levels[0];
  const living = applyOp(p, 'add_room', { type: 'living', x: 0, y: 0, width: 6000, depth: 4000 }).id;
  const bed = applyOp(p, 'add_room', { type: 'bedroom', x: 6000, y: 0, width: 4000, depth: 4000 }).id;
  return { p, L, living, bed };
}

test('view transforms round trip and zoom keeps the pointer fixed', () => {
  const v = { scale: 0.1, ox: 40, oy: -20 };
  const w = { x: 1234, y: 5678 };
  const s = M.worldToScreen(v, w);
  const back = M.screenToWorld(v, s);
  near(back.x, w.x);
  near(back.y, w.y);
  const pointer = { x: 300, y: 200 };
  const before = M.screenToWorld(v, pointer);
  const z = M.zoomAt(v, pointer, 1.8);
  const after = M.screenToWorld(z, pointer);
  near(after.x, before.x, 1e-6);
  near(after.y, before.y, 1e-6);
  assert.ok(z.scale > v.scale);
  assert.equal(M.zoomAt(v, pointer, 1e9).scale, M.MAX_SCALE);
  assert.equal(M.zoomAt(v, pointer, 1e-9).scale, M.MIN_SCALE);
});

test('fitView centres the bounds and falls back for empty plans', () => {
  const b = G.bbox([{ x: 0, y: 0 }, { x: 10000, y: 5000 }]);
  const v = M.fitView(b, { w: 1000, h: 600 }, { padding: 50 });
  const c = M.worldToScreen(v, { x: b.cx, y: b.cy });
  near(c.x, 500);
  near(c.y, 300);
  const tl = M.worldToScreen(v, { x: 0, y: 0 });
  assert.ok(tl.x >= 50 - 1e-6 && tl.y >= 50 - 1e-6);
  const empty = M.fitView(null, { w: 800, h: 600 });
  assert.ok(empty.scale > 0);
});

test('grid spacing coarsens when zoomed out and scale bar uses round lengths', () => {
  assert.deepEqual(M.gridSpec(0.1, 100), { minor: 100, major: 1000 });
  assert.deepEqual(M.gridSpec(0.02, 100), { minor: 1000, major: 10000 });
  assert.equal(M.niceLength(1234), 1000);
  assert.equal(M.niceLength(3700), 2000);
  assert.equal(M.niceLength(7000), 5000);
  const sb = M.scaleBar(0.1, 120);
  assert.equal(sb.mm, 1000);
  near(sb.px, 100);
});

test('status view visibility follows the existing, proposed and both views', () => {
  assert.equal(M.statusVisible('new', 'proposed'), true);
  assert.equal(M.statusVisible('existing', 'proposed'), true);
  assert.equal(M.statusVisible('demolish', 'proposed'), false);
  assert.equal(M.statusVisible('new', 'existing'), false);
  assert.equal(M.statusVisible('existing', 'existing'), true);
  assert.equal(M.statusVisible('demolish', 'existing'), true);
  assert.equal(M.statusVisible('demolish', 'both'), true);
  assert.equal(M.drawStatus('demolish', 'existing'), 'existing');
  assert.equal(M.drawStatus('demolish', 'both'), 'demolish');
});

test('snapping: grid, endpoint within 10 px, Alt and snap-off bypass', () => {
  const { L } = sample();
  const base = { level: L, scale: 0.1, snapMm: 50, snapOn: true };
  assert.deepEqual(M.snapPoint({ x: 1234, y: 777 }, { ...base, endpoints: false }), { x: 1250, y: 800, kind: 'grid' });
  // 10 px at 0.1 px/mm is 100 mm
  const e = M.snapPoint({ x: 6040, y: 3960 }, base);
  assert.equal(e.kind, 'endpoint');
  assert.deepEqual([e.x, e.y], [6000, 4000]);
  const far = M.snapPoint({ x: 6300, y: 4300 }, base);
  assert.equal(far.kind, 'grid');
  assert.equal(M.snapPoint({ x: 6040.4, y: 3960.2 }, { ...base, alt: true }).kind, 'free');
  const off = M.snapPoint({ x: 1234.4, y: 777.6 }, { ...base, snapOn: false });
  assert.deepEqual([off.x, off.y, off.kind], [1234, 778, 'free']);
});

test('constrainPoint locks to 15 degree steps and rounds the length', () => {
  const a = { x: 0, y: 0 };
  const h = M.constrainPoint(a, { x: 3012, y: 200 }, { snapMm: 50 });
  assert.equal(h.y, 0);
  assert.equal(h.x, 3000);
  const d = M.constrainPoint(a, { x: 2000, y: 2100 }, { snapMm: 0 });
  near(Math.atan2(d.y, d.x), Math.PI / 4, 0.01);
  const v = M.constrainPoint(a, { x: 40, y: -2975 }, { snapMm: 50 });
  assert.deepEqual([v.x, v.y], [0, -3000]);
});

test('rotated rectangles: corners and point tests follow clockwise rotation', () => {
  const c0 = M.rectCorners(1000, 1000, 400, 200, 0);
  assert.deepEqual(c0.map((p) => [p.x, p.y]), [[800, 900], [1200, 900], [1200, 1100], [800, 1100]]);
  // 90 degrees clockwise on a y-down plan: local +x points to +y
  const q = M.toWorld({ x: 100, y: 0 }, 0, 0, 90);
  near(q.x, 0, 1e-9);
  near(q.y, 100, 1e-9);
  assert.equal(M.pointInRotatedRect({ x: 1000, y: 1150 }, 1000, 1000, 400, 200, 0), false);
  assert.equal(M.pointInRotatedRect({ x: 1000, y: 1150 }, 1000, 1000, 400, 200, 90), true);
  assert.equal(M.pointInRotatedRect({ x: 1190, y: 1000 }, 1000, 1000, 400, 200, 90), false);
});

test('hit test priority: opening, furniture, tank, stair, wall, room', () => {
  const { p, L, living } = sample();
  const north = L.walls.find((w) => G.samePoint(w.a, { x: 0, y: 0 }) && G.samePoint(w.b, { x: 6000, y: 0 }));
  const win = applyOp(p, 'add_opening', { wall: north.id, kind: 'window', offset: 3000, width: 1800 }).id;
  const furn = applyOp(p, 'add_furniture', { item: 'sofa_3', x: 3000, y: 100 }).id;
  const tank = applyOp(p, 'add_tank', { x: 3000, y: 100, capacity_l: 2000 }).id;
  const stair = applyOp(p, 'add_stair', { x: 3000, y: 100 }).id;
  const o = { scale: 0.1, furnSize: (f) => ({ w: f.w ?? 2000, d: f.d ?? 900 }) };
  const at = (pt, extra = {}) => M.hitTest(p, L, pt, { ...o, ...extra });
  assert.equal(at({ x: 3000, y: 0 }).id, win);
  assert.equal(at({ x: 3000, y: 100 }, { kinds: ['furniture', 'tank', 'stair', 'wall', 'room'] }).id, furn);
  assert.equal(at({ x: 3000, y: 100 }, { kinds: ['tank', 'stair', 'wall', 'room'] }).id, tank);
  assert.equal(at({ x: 3000, y: 100 }, { kinds: ['stair', 'wall', 'room'] }).id, stair);
  assert.equal(at({ x: 3000, y: 100 }, { kinds: ['wall', 'room'] }).kind, 'wall');
  assert.equal(at({ x: 1000, y: 2000 }).id, living);
  assert.equal(at({ x: 1000, y: 2000 }, { kinds: ['wall'] }), null);
  assert.equal(at({ x: 20000, y: 20000 }), null);
  assert.equal(at({ x: 3000, y: 100 }, { kinds: ['tank'], tanks: false }), null);
  // demolished walls are not hit in the proposed view
  L.walls[0].status = 'demolish';
  const w0 = L.walls[0];
  const mid = G.wallMid(w0);
  const hit = M.hitTest(p, L, mid, { ...o, kinds: ['wall'], visible: (s) => M.statusVisible(s, 'proposed') });
  assert.notEqual(hit?.id, w0.id);
});

test('placeOpening snaps to the nearest wall, clamps and flags overlaps', () => {
  const { p, L } = sample();
  const north = L.walls.find((w) => G.samePoint(w.a, { x: 0, y: 0 }) && G.samePoint(w.b, { x: 6000, y: 0 }));
  const spec = { kind: 'window', width: 1800 };
  const r = M.placeOpening(L, { x: 2030, y: 80 }, spec, { snapMm: 50, snapOn: true });
  assert.equal(r.wall.id, north.id);
  assert.equal(r.valid, true);
  assert.equal(r.offset, 2050);
  const edge = M.placeOpening(L, { x: 20, y: 0 }, spec, { snapMm: 50, snapOn: true });
  assert.equal(edge.offset, 1000, 'clamped 100 mm from the end plus half the width');
  assert.equal(M.placeOpening(L, { x: 3000, y: 2000 }, spec, { snapOn: false }), null, 'nothing near the point');
  applyOp(p, 'add_opening', { wall: north.id, kind: 'window', offset: 3000, width: 1800 });
  const clash = M.placeOpening(L, { x: 3200, y: 0 }, spec, { snapOn: false });
  assert.equal(clash.valid, false);
  assert.match(clash.reason, /Overlaps/);
  const ignoring = M.placeOpening(L, { x: 3200, y: 0 }, spec, { snapOn: false, ignoreId: L.openings[0].id });
  assert.equal(ignoring.valid, true);
  const wide = M.placeOpening(L, { x: 3000, y: 0 }, { kind: 'window', width: 7000 }, { snapOn: false });
  assert.equal(wide.valid, false);
  assert.match(wide.reason, /fit/);
});

test('door geometry: hinge end, swing side and arc direction', () => {
  const wall = { a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } }; // runs east, normal points south (+y)
  const o = { offset: 1000, width: 800, hinge: 'a', side: 1 };
  const g = M.doorGeometry(wall, o);
  assert.deepEqual([g.hinge.x, g.hinge.y], [600, 0]);
  assert.deepEqual([g.closedTip.x, g.closedTip.y], [1400, 0]);
  assert.deepEqual([g.openTip.x, g.openTip.y], [600, 800]);
  assert.equal(g.anticlockwise, false, 'east to south is increasing angle on a y-down canvas');
  const b = M.doorGeometry(wall, { ...o, hinge: 'b', side: -1 });
  assert.deepEqual([b.hinge.x, b.hinge.y], [1400, 0]);
  assert.deepEqual([b.openTip.x, b.openTip.y], [1400, -800]);
  assert.deepEqual([b.closedTip.x, b.closedTip.y], [600, 0]);
  // west then north: atan2 goes from pi to -pi/2, an increasing turn is clockwise on screen
  assert.equal(b.anticlockwise, G.cross(b.closedDir, b.openDir) < 0);
});

test('slideOffset projects along the wall and snaps', () => {
  const wall = { a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } };
  assert.equal(M.slideOffset(wall, { x: 1010, y: 300 }, 0, { snapMm: 50, snapOn: true }), 1000);
  assert.equal(M.slideOffset(wall, { x: 1010, y: 300 }, 100, { snapOn: false }), 910);
});

test('calibrating an underlay scales about the first point', () => {
  const u = { key: 'k', x: 5000, y: 3000, mmPerPx: 10, rotation: 0, opacity: 0.5, locked: false };
  const c = M.calibrateUnderlay(u, { x: 1000, y: 1000 }, { x: 3000, y: 1000 }, 5000);
  near(c.mmPerPx, 25);
  assert.equal(c.x, 1000 + (5000 - 1000) * 2.5);
  // a 10 m reference measured on the plan now reads within 1 percent
  const measured = 2000 * (c.mmPerPx / u.mmPerPx);
  assert.ok(Math.abs(measured - 5000) / 5000 < 0.01);
  assert.throws(() => M.calibrateUnderlay(u, { x: 1, y: 1 }, { x: 1, y: 1 }, 100));
  assert.throws(() => M.calibrateUnderlay(u, { x: 1, y: 1 }, { x: 9, y: 1 }, 0));
});

test('moveEndpoint drags a corner with its neighbours, the room and keeps the plan valid', () => {
  const { p, L, living } = sample();
  moveEndpoint(p, L, { x: 6000, y: 0 }, { x: 6000, y: -1000 });
  assert.ok(L.walls.some((w) => G.samePoint(w.a, { x: 6000, y: -1000 }) || G.samePoint(w.b, { x: 6000, y: -1000 })));
  const room = L.rooms.find((r) => r.id === living);
  assert.ok(room.polygon.some((q) => q.x === 6000 && q.y === -1000));
  assert.ok(room.polygon.every((q) => !(q.x === 6000 && q.y === 0)));
  assert.deepEqual(validate(p), []);
  assert.throws(() => moveEndpoint(p, L, { x: 123, y: 456 }, { x: 0, y: 0 }), /no wall end/i);
});

test('moveEndpoint keeps openings inside shortened walls and drops them when too short', () => {
  const p = createProject();
  const L = p.levels[0];
  applyOp(p, 'add_room', { type: 'living', x: 0, y: 0, width: 6000, depth: 4000 });
  const north = L.walls.find((w) => G.samePoint(w.a, { x: 0, y: 0 }) && G.samePoint(w.b, { x: 6000, y: 0 }));
  applyOp(p, 'add_opening', { wall: north.id, kind: 'window', offset: 4500, width: 1800 });
  moveEndpoint(p, L, { x: 6000, y: 0 }, { x: 5200, y: 0 });
  const o = L.openings[0];
  const w = L.walls.find((x) => x.id === o.wallId);
  const span = G.openingSpan(o);
  assert.ok(span.start >= 100 - 1e-6 && span.end <= G.wallLength(w) - 100 + 1e-6);
  assert.deepEqual(validate(p), []);
});

test('status brush targets a room with its exclusive walls and openings', () => {
  const { p, L, living, bed } = sample();
  const shared = L.walls.find((w) => G.samePoint(w.a, { x: 6000, y: 0 }) && G.samePoint(w.b, { x: 6000, y: 4000 }));
  const door = applyOp(p, 'add_opening', { wall: shared.id, kind: 'door', offset: 2000 }).id;
  const livingRoom = L.rooms.find((r) => r.id === living);
  const ids = statusIdsFor(L, 'room', livingRoom);
  assert.ok(ids.includes(living));
  assert.ok(!ids.includes(shared.id) || exclusiveWalls(L, livingRoom).every((w) => w.id !== shared.id), 'the shared wall belongs to both rooms');
  assert.ok(!ids.includes(door));
  assert.ok(!ids.includes(bed));
  const north = L.walls.find((w) => G.samePoint(w.a, { x: 0, y: 0 }));
  assert.ok(ids.includes(north.id));
  assert.deepEqual(statusIdsFor(L, 'wall', shared).sort(), [shared.id, door].sort());
  applyOp(p, 'set_status', { ids, status: 'existing' });
  assert.equal(L.rooms.find((r) => r.id === living).status, 'existing');
  assert.equal(L.rooms.find((r) => r.id === bed).status, 'new');
});

test('patchStair clamps sizes and normalises rotation', () => {
  const p = createProject();
  const id = applyOp(p, 'add_stair', { x: 1000, y: 1000 }).id;
  const s = patchStair(p, id, { width: 100, length: 99999, rotation: -90, x: 2000.4 });
  assert.equal(s.width, 600);
  assert.equal(s.length, 8000);
  assert.equal(s.rotation, 270);
  assert.equal(s.x, 2000);
  assert.throws(() => patchStair(p, 'nope', {}));
});

test('area schedule totals indoor, garage and outdoor areas per level', () => {
  const p = createProject();
  applyOp(p, 'add_room', { type: 'living', name: 'Living', x: 0, y: 0, width: 5000, depth: 4000 });
  applyOp(p, 'add_room', { type: 'garage', name: 'Garage', x: 5000, y: 0, width: 6000, depth: 6000 });
  applyOp(p, 'add_room', { type: 'deck', name: 'Deck', x: 0, y: 4000, width: 3000, depth: 3000 });
  const s = areaSchedule(p);
  assert.equal(s.length, 1);
  near(s[0].indoor, 20);
  near(s[0].garage, 36);
  near(s[0].outdoor, 9);
  near(indoorTotalM2(p), 20);
  applyOp(p, 'set_status', { ids: p.levels[0].rooms.filter((r) => r.type === 'garage').map((r) => r.id), status: 'demolish' });
  const t = extensionTotals(p);
  near(t.demolish, 36);
  near(t.new, 20);
  near(t.existing, 0);
});

test('door and window schedule groups identical openings and skips demolished', () => {
  const { p, L } = sample();
  const north = L.walls.find((w) => G.samePoint(w.a, { x: 0, y: 0 }) && G.samePoint(w.b, { x: 6000, y: 0 }));
  const south = L.walls.find((w) => G.samePoint(w.a, { x: 6000, y: 4000 }) && G.samePoint(w.b, { x: 0, y: 4000 }));
  applyOp(p, 'add_opening', { wall: north.id, kind: 'window', offset: 1500 });
  applyOp(p, 'add_opening', { wall: north.id, kind: 'window', offset: 4500 });
  const gone = applyOp(p, 'add_opening', { wall: south.id, kind: 'window', offset: 3000, width: 1200 }).id;
  applyOp(p, 'add_opening', { wall: south.id, kind: 'door', offset: 1000 });
  applyOp(p, 'set_status', { ids: [gone], status: 'demolish' });
  const rows = openingSchedule(p);
  const windows = rows.filter((r) => r.kind === 'window');
  assert.equal(windows.length, 1);
  assert.equal(windows[0].count, 2);
  assert.equal(windows[0].mark, 'W1');
  assert.equal(rows.find((r) => r.kind === 'door').mark, 'D1');
});

test('soft warnings: overlapping rooms, openings past walls, rooms without a door', () => {
  const { p, L, bed } = sample();
  const first = computeWarnings(p);
  assert.ok(first.some((w) => w.kind === 'nodoor' && /Living/.test(w.message)));
  assert.ok(!first.some((w) => w.kind === 'overlap'));
  const shared = L.walls.find((w) => G.samePoint(w.a, { x: 6000, y: 0 }) && G.samePoint(w.b, { x: 6000, y: 4000 }));
  applyOp(p, 'add_opening', { wall: shared.id, kind: 'door', offset: 2000 });
  const second = computeWarnings(p);
  assert.ok(!second.some((w) => w.kind === 'nodoor' && /Living/.test(w.message)), 'a door on the shared wall serves both rooms');
  // an overlapping room, added without walls
  applyOp(p, 'add_room', { type: 'study', name: 'Study', x: 5000, y: 1000, width: 2000, depth: 2000, walls: false });
  assert.ok(computeWarnings(p).some((w) => w.kind === 'overlap'));
  // an opening pushed off its wall by editing the data directly
  L.openings[0].offset = 5990;
  assert.ok(computeWarnings(p).some((w) => w.kind === 'opening'));
  assert.ok(bed);
});

test('roof plan area adds the eave overhang to the building footprint', () => {
  const p = createProject();
  applyOp(p, 'add_room', { type: 'living', x: 0, y: 0, width: 10000, depth: 8000 });
  const plain = roofPlanAreaM2(p) - 0;
  // 10 x 8 m plus a 450 mm overhang each side is about 10.9 x 8.9 m, with 500 mm cells (4 cells each side at 100 mm rounding)
  assert.ok(plain > 80 && plain < 110, `roof area ${plain}`);
  p.levels[0].roof.enabled = false;
  assert.equal(roofPlanAreaM2(p), 0);
});

test('suggested room names are unique per level', () => {
  const p = createProject();
  assert.equal(suggestRoomName(p.levels[0], 'bedroom'), 'Bedroom');
  applyOp(p, 'add_room', { type: 'bedroom', name: 'Bedroom', x: 0, y: 0, width: 3000, depth: 3000 });
  assert.equal(suggestRoomName(p.levels[0], 'bedroom'), 'Bedroom 2');
});

test('design files: a valid file opens, bad files give plain messages', () => {
  const { p } = sample();
  const ok = parseDesign(JSON.stringify(p));
  assert.ok(ok.project && !ok.error, 'saved project round trips');
  assert.equal(ok.project.levels[0].rooms.length, 2);

  assert.match(parseDesign('not json at all').error, /could not be read as JSON/);
  assert.match(parseDesign('{"hello":1}').error, /Not a Plan Studio project file/);
  assert.match(parseDesign('[]').error, /Plan Studio/);
  assert.match(parseDesign(JSON.stringify({ ...p, schema: 99 })).error, /newer version/);

  // structural problems are listed, not thrown
  const broken = structuredClone(p);
  broken.levels[0].openings.push({ id: 'o_x', wallId: 'missing', kind: 'door', offset: 100, width: 800, height: 2000, sill: 0 });
  const bad = parseDesign(JSON.stringify(broken));
  assert.ok(bad.error && bad.problems.some((m) => /not on a wall/.test(m)));
});

test('design files: an older file with missing sections is brought up to date', () => {
  const { p } = sample();
  const thin = { schema: p.schema, id: p.id, name: 'Thin', type: 'house', levels: [{ id: 'l1', name: 'Ground', elevation: 0, height: 2550, walls: [], rooms: [] }] };
  const res = parseDesign(JSON.stringify(thin));
  assert.ok(res.project, res.error);
  assert.deepEqual(res.project.levels[0].openings, []);
  assert.deepEqual(res.project.site.tanks, []);
  assert.equal(validate(res.project).length, 0);
});

// Wave 2 ------------------------------------------------------------------------------------------------
import { rotationStep } from '../src/editor2d/tools-meta.js';
import { clashIds, clashList, createClashNotifier } from '../src/editor2d/clash.js';
import { WALL_PRESETS } from '../src/ui/wall-presets.js';

test('rotation keys: comma left, full stop right, Shift gives 15 degrees, Q and E do nothing', () => {
  assert.equal(rotationStep({ key: ',', code: 'Comma', shiftKey: false }), -90);
  assert.equal(rotationStep({ key: '.', code: 'Period', shiftKey: false }), 90);
  assert.equal(rotationStep({ key: '<', code: 'Comma', shiftKey: true }), -15);
  assert.equal(rotationStep({ key: '>', code: 'Period', shiftKey: true }), 15);
  assert.equal(rotationStep({ key: 'q', code: 'KeyQ', shiftKey: false }), 0);
  assert.equal(rotationStep({ key: 'e', code: 'KeyE', shiftKey: false }), 0);
});

test('furniture that clips a wall is listed, shown in the summary warnings and announced once', () => {
  const { p, L } = sample();
  const cat = { getFurniture: (id) => (id === 'sofa' ? { id, name: 'Sofa', w: 1800, d: 900 } : null) };
  const wall = L.walls.find((w) => w.a.y === 0 && w.b.y === 0) || L.walls[0];
  const mid = G.wallMid(wall);
  const id = applyOp(p, 'add_furniture', { item: 'sofa', x: mid.x, y: mid.y, rotation: 0 }).id;
  assert.ok(clashIds(p, cat).has(id));
  assert.equal(clashList(p, cat)[0].name, 'Sofa');
  const warn = computeWarnings(p, { catalogue: cat }).find((w) => w.kind === 'clash');
  assert.equal(warn.message, 'Sofa clips a wall');
  assert.equal(warn.target, id);
  assert.ok(!computeWarnings(p).some((w) => w.kind === 'clash'), 'without a catalogue the size is unknown');
  // moved clear of every wall it no longer clashes
  applyOp(p, 'update_furniture', { id, x: 3000, y: 2000 });
  assert.equal(clashIds(p, cat).size, 0);
  // notifier: once per newly clashing item, forgotten when it stops clashing
  const n = createClashNotifier();
  const seen = [];
  n.silent(['a']);
  n.notify(new Set(['a', 'b']), (ids) => seen.push(ids));
  n.notify(new Set(['a', 'b']), (ids) => seen.push(ids));
  n.notify(new Set(['a']), (ids) => seen.push(ids));
  n.notify(new Set(['a', 'b']), (ids) => seen.push(ids));
  assert.deepEqual(seen, [['b'], ['b']]);
});

test('wall thickness: per wall presets and project defaults go through the operations', () => {
  assert.deepEqual(WALL_PRESETS, [90, 110, 150, 200, 250, 270, 300]);
  const { p, L } = sample();
  const wall = L.walls.find((w) => w.kind === 'exterior');
  applyOp(p, 'update_wall', { id: wall.id, thickness: 150 });
  assert.equal(L.walls.find((w) => w.id === wall.id).thickness, 150);
  applyOp(p, 'set_wall_defaults', { external: 300, internal: 110 });
  assert.equal(p.settings.extWall, 300);
  assert.equal(p.settings.intWall, 110);
  assert.equal(L.walls.find((w) => w.id === wall.id).thickness, 150, 'a wall with its own thickness keeps it');
  const other = L.walls.find((w) => w.kind === 'exterior' && w.id !== wall.id);
  assert.equal(other.thickness, 300);
});
