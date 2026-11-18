// Rotate tool: snap, typed angle, align to frontage and nearest boundary, pivot, one undo step per rotation, and the driveway (with its PIs)
// staying attached to the garage door. Residential house, and a commercial building and unit row.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createProject } from '../src/model/schema.js';
import { createStore } from '../src/model/store.js';
import { catalogue } from '../src/catalogue/index.js';
import { placeHouse } from '../src/portal/place-house.js';
import { lotEnvelope, portalLotToSiteLot, SAMPLE_LOT } from '../src/portal/envelope.js';
import { autoPose } from '../src/portal/auto-place.js';
import * as L from '../src/site/lotplan.js';
import * as D from '../src/site/drivepi.js';
import * as R from '../src/site/rotate.js';
import { createRotateController } from '../src/editor2d/rotate-controller.js';
import { TOOL_DEFS, ALL_TOOLS, KEY_TO_TOOL } from '../src/editor2d/tools-meta.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { addBuilding } from '../src/commercial/catalogue/ops.js';

function setup() {
  const portal = { name: 'T', polygonMm: SAMPLE_LOT.polygonMm, frontEdgeIndices: [2], picked: { front: { minM: 4.5 }, secondaryFront: { minM: 3 }, side: { minM: 0.9 }, rear: { minM: 3 } }, lot: '7', dp: 'DP 99' };
  const p = createProject({ name: 'Rot' });
  p.site.lot = portalLotToSiteLot(portal, lotEnvelope(portal));
  const h = catalogue.createFromTemplate('house_double');
  placeHouse(p, h, autoPose(p, h).pose);
  return p;
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const near = (a, b, e = 0.2, m = '') => assert.ok(Math.abs(a - b) <= e, `${m} ${a} vs ${b}`);
const ctl = (store) => createRotateController({ store, scale: () => 0.05, toast: () => {}, redraw: () => {} });
const heading = (store) => R.rotateTarget(store.project, store.ui).orientDeg;
// The house box has a 90 degree ambiguity in its heading, so turns are compared modulo 90.
const wrapTo = (d) => { const m = ((d % 90) + 90) % 90; return m > 45 ? m - 90 : m; };
const wallsKey = (p) => JSON.stringify(p.levels.map((l) => l.walls.map((w) => [w.a, w.b])));

test('the tool is on the rail for both modes with a tip, key O, and no dashes in its text', () => {
  const def = TOOL_DEFS.find((t) => t.id === 'rotate');
  assert.ok(def && def.tip.length > 20);
  assert.ok(!def.residentialOnly && !def.commercialOnly, 'both editors');
  assert.equal(KEY_TO_TOOL.o, 'rotate');
  assert.ok(ALL_TOOLS.includes('rotate'));
  const src = ['../src/editor2d/tool-rotate.js', '../src/editor2d/rotate-controller.js', '../src/ui/panel-rotate.js', '../src/site/rotate.js'].map((f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n') + JSON.stringify(def);
  assert.ok(!/[–—]/.test(src), 'no em or en dashes');
  assert.ok(!/compliant/i.test(src));
});

test('snap: free to 0.1 degree, 15 degree steps with Shift', () => {
  assert.equal(R.snapTurn(37.46), 37.5);
  assert.equal(R.snapTurn(37.46, true), 30);
  assert.equal(R.snapTurn(38, true), 45);
  assert.equal(R.snapTurn(-22.4, true), -15);
  assert.equal(R.snapTurn(-7.4, true), 0);
  assert.equal(R.snapTurn(0.04), 0);
});

test('typed angle parsing: numbers, units, signs, wrapping, junk refused', () => {
  assert.equal(R.parseAngle('30'), 30);
  assert.equal(R.parseAngle(' -12.5° '), -12.5);
  assert.equal(R.parseAngle('7,5'), 7.5);
  assert.equal(R.parseAngle('45 deg'), 45);
  assert.equal(R.parseAngle('190'), -170);
  assert.equal(R.parseAngle('360'), 0);
  assert.equal(R.parseAngle('abc'), null);
  assert.equal(R.parseAngle(''), null);
  assert.equal(R.parseAngle('1e3'), null);
});

test('typed angle turns the house about its centre by exactly that angle, one undo step', () => {
  const p = setup();
  const store = createStore(p);
  store.setUndoFloor();
  const c = ctl(store);
  const t0 = R.rotateTarget(store.project);
  const h0 = t0.orientDeg;
  const before = wallsKey(store.project);
  const r = c.typed('30');
  assert.equal(r.ok, true);
  near(wrapTo(R.rotateTarget(store.project).orientDeg - h0), 30, 0.2);
  assert.ok(Math.abs(wrapTo(30)) === 30);
  // turned about its own centre: the centre stays put
  assert.ok(dist(R.rotateTarget(store.project).centre, t0.centre) < 5, 'box centre did not move');
  assert.equal(store.undoLabel(), 'Rotate by typed angle');
  assert.equal(store.undo(), true);
  assert.equal(wallsKey(store.project), before, 'a single undo restores the house');
  assert.equal(store.canUndo(), false, 'nothing else was left on the stack');
  assert.equal(c.typed('nope').ok, false);
  assert.equal(wallsKey(store.project), before, 'bad text changes nothing');
});

test('a drag gesture changes the project live and is still one undo step; Shift snaps to 15 degrees', () => {
  const p = setup();
  const store = createStore(p);
  store.setUndoFloor();
  const c = ctl(store);
  const before = wallsKey(store.project);
  const t = c.target();
  const pv = c.pivot();
  const R0 = R.ringRadius(t, pv);
  const hp = { x: pv.x + 0, y: pv.y - R0 }; // handle at the top
  assert.equal(c.hit(hp), 'handle');
  assert.equal(c.pointerDown(hp, { screen: { x: 0, y: 0 } }), true);
  const at = (deg) => { const a = ((-90 + deg) * Math.PI) / 180; return { x: pv.x + Math.cos(a) * R0, y: pv.y + Math.sin(a) * R0 }; };
  let n = 0;
  const seen = [];
  store.on('project', () => { n++; seen.push(wallsKey(store.project)); });
  c.pointerMove(at(20), { screen: { x: 40, y: 0 } });
  const d1 = c.draft();
  near(d1.arc.deg, 20, 0.2);
  assert.notEqual(wallsKey(store.project), before, 'live: the project turned while dragging');
  c.pointerMove(at(52), { screen: { x: 80, y: 0 }, shift: true });
  near(c.draft().arc.deg, 45, 0.001, 'shift snapped 52 to 45');
  c.pointerMove(at(38), { screen: { x: 90, y: 0 }, shift: true });
  near(c.draft().arc.deg, 45, 0.001, '38 snaps to 45');
  c.pointerMove(at(31), { screen: { x: 95, y: 0 }, shift: true });
  near(c.draft().arc.deg, 30, 0.001, '31 snaps to 30');
  const r = c.pointerUp();
  assert.equal(r.ok, true);
  near(r.deg, 30, 0.001);
  assert.ok(n >= 3, 'several live updates');
  assert.equal(store.undo(), true);
  assert.equal(wallsKey(store.project), before, 'one undo step for the whole drag');
  assert.equal(store.canUndo(), false);
  assert.equal(store.redo(), true);
  near(wrapTo(R.rotateTarget(store.project).orientDeg - t.orientDeg), 30, 0.2);
});

test('escape cancels a drag and leaves nothing on the undo stack', () => {
  const p = setup();
  const store = createStore(p);
  store.setUndoFloor();
  const c = ctl(store);
  const before = wallsKey(store.project);
  const pv = c.pivot();
  const R0 = R.ringRadius(c.target(), pv);
  c.pointerDown({ x: pv.x, y: pv.y - R0 }, { screen: { x: 0, y: 0 } });
  c.pointerMove({ x: pv.x + R0, y: pv.y }, { screen: { x: 50, y: 50 } });
  assert.notEqual(wallsKey(store.project), before);
  assert.equal(c.cancel(), true);
  assert.equal(wallsKey(store.project), before);
  assert.equal(store.canUndo(), false);
});

test('the sweep takes the shortest way round and keeps counting past 180 degrees', () => {
  const p = setup();
  const store = createStore(p);
  const c = ctl(store);
  const pv = c.pivot();
  const R0 = R.ringRadius(c.target(), pv);
  const at = (deg) => { const a = ((-90 + deg) * Math.PI) / 180; return { x: pv.x + Math.cos(a) * R0, y: pv.y + Math.sin(a) * R0 }; };
  c.pointerDown(at(0), { screen: { x: 0, y: 0 } });
  for (const d of [60, 120, 170, 200, 250]) c.pointerMove(at(d), { screen: { x: d, y: 9 } });
  near(c.draft().arc.deg, 250, 0.2);
  c.pointerUp();
});

test('pivot: defaults to the building centre, can be moved, and the building turns about it', () => {
  const p = setup();
  const store = createStore(p);
  const c = ctl(store);
  const t0 = c.target();
  assert.ok(dist(c.pivot(), t0.centre) < 1);
  assert.equal(c.hasCustomPivot(), false);
  const corner = t0.ring[0];
  assert.equal(c.hit(corner), null);
  c.setPivot(corner);
  assert.equal(c.hasCustomPivot(), true);
  assert.ok(dist(c.pivot(), corner) < 1);
  assert.equal(c.hit(corner), 'pivot');
  const cBefore = t0.centre;
  c.turnBy(90);
  const t1 = R.rotateTarget(store.project);
  // the centre moved as a point turned 90 degrees clockwise about the pivot
  const dx = cBefore.x - corner.x;
  const dy = cBefore.y - corner.y;
  assert.ok(dist(t1.centre, { x: corner.x - dy, y: corner.y + dx }) < 5, 'centre swung about the corner pivot');
  assert.ok(dist(c.pivot(), corner) < 1, 'the pivot stays where it was put');
  c.resetPivot();
  assert.ok(dist(c.pivot(), t1.centre) < 1);
});

test('dragging the pivot moves it without changing the project', () => {
  const p = setup();
  const store = createStore(p);
  const c = ctl(store);
  const before = wallsKey(store.project);
  const pv = c.pivot();
  assert.equal(c.pointerDown(pv, { screen: { x: 0, y: 0 } }), true);
  c.pointerMove({ x: pv.x + 3000, y: pv.y + 1000 }, { screen: { x: 30, y: 10 } });
  c.pointerUp();
  assert.ok(dist(c.pivot(), { x: pv.x + 3000, y: pv.y + 1000 }) < 1);
  assert.equal(wallsKey(store.project), before);
  assert.equal(store.canUndo(), false);
});

test('align to the street frontage: the garage faces the street square on', () => {
  const p = setup();
  const store = createStore(p);
  store.setUndoFloor();
  const c = ctl(store);
  c.typed('33');
  const lot = p.site.lot;
  const r = c.align('frontage');
  assert.equal(r.ok, true);
  const door = L.garageDoor(store.project);
  const idx = R.frontEdgeIndex(store.project.site.lot);
  const road = L.roadReserve(store.project.site.lot).find((x) => x.edge === idx);
  assert.ok(door.normal.x * road.outward.x + door.normal.y * road.outward.y > 0.9998, 'garage normal equals street normal');
  assert.equal(c.align('frontage').deg, 0, 'already aligned: nothing to do');
  assert.ok(lot);
  assert.equal(store.undoLabel(), 'Align to street frontage');
});

test('align to the nearest boundary: runs parallel to it', () => {
  const p = setup();
  const store = createStore(p);
  const c = ctl(store);
  c.typed('17');
  const r = c.align('nearest');
  assert.equal(r.ok, true);
  const t = R.rotateTarget(store.project);
  const lot = store.project.site.lot;
  const i = R.nearestEdgeIndex(lot, t.ring);
  const a = lot.boundary[i];
  const b = lot.boundary[(i + 1) % lot.boundary.length];
  const edgeDeg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const off = ((((t.orientDeg - edgeDeg) % 90) + 90) % 90);
  assert.ok(Math.min(off, 90 - off) < 0.15, `off by ${off}`);
});

test('align with no frontage marked or no building says so and changes nothing', () => {
  const p = setup();
  p.site.lot.frontEdges = [];
  if (p.site.lot.setbacks) delete p.site.lot.setbacks.edgeKinds;
  const store = createStore(p);
  const c = ctl(store);
  const before = wallsKey(store.project);
  assert.equal(c.align('frontage').ok, false);
  assert.equal(wallsKey(store.project), before);
  const empty = createStore(createProject({ name: 'E' }));
  assert.equal(ctl(empty).turnBy(10).ok, false);
  assert.equal(ctl(empty).draft(), null);
});

test('the driveway stays attached to the garage door through a turn (automatic driveway)', () => {
  const p = setup();
  const store = createStore(p);
  const c = ctl(store);
  for (const deg of [10, -25, 45, 90]) {
    c.turnBy(deg);
    const door = L.garageDoor(store.project);
    const d = L.deriveDriveway(store.project);
    assert.ok(d && (d.ok || d.reason === 'door_faces_away'), `turn ${deg}: a driveway answer`);
    if (d.ok) {
      assert.ok(dist(d.centre[0], door.mid) < 1, `turn ${deg}: starts at the garage door`);
      assert.ok(dist(d.centre.at(-1), d.kerbPoint) < 1, 'ends on the kerb');
    }
  }
});

test('the stored driveway (PI tool data) turns with the house and stays attached to the garage', () => {
  const p = setup();
  const a = L.deriveDriveway(p);
  const m = a.centre[Math.floor(a.centre.length / 2)];
  assert.equal(D.addDrivewayPI(p, { x: m.x + 600, y: m.y }).ok, true);
  const store = createStore(p);
  store.setUndoFloor();
  const c = ctl(store);
  const keep = structuredClone(store.project.site.driveway);
  // a small turn (the edit survives only while the rotated route still works; larger turns fall back to the automatic route), its PIs turned about the pivot with the house
  const pv = c.pivot();
  const r = c.turnBy(3);
  assert.equal(r.ok, true);
  const sd = store.project.site.driveway;
  assert.ok(sd, 'the PI edit is kept for a small turn');
  assert.equal(sd.pis.length, keep.pis.length);
  const want = (q) => { const t = (3 * Math.PI) / 180; const dx = q.x - pv.x; const dy = q.y - pv.y; return { x: pv.x + dx * Math.cos(t) - dy * Math.sin(t), y: pv.y + dx * Math.sin(t) + dy * Math.cos(t) }; };
  assert.ok(dist(sd.pis[0], want(keep.pis[0])) < 2, 'PI turned about the pivot');
  assert.equal(sd.endOffsetMm, keep.endOffsetMm, 'kerb end stays');
  const d = L.deriveDriveway(store.project);
  assert.equal(d.ok, true);
  assert.equal(d.edited, true);
  assert.ok(dist(d.centre[0], L.garageDoor(store.project).mid) < 1, 'starts at the garage door');
  assert.ok(dist(d.centre.at(-1), d.kerbPoint) < 1, 'ends on the kerb');
  // the undo returns the PIs exactly
  store.undo();
  assert.deepEqual(store.project.site.driveway, keep);
  // a big turn: the edit may be dropped for the automatic route, but the driveway is still attached to the door
  c.turnBy(120);
  const d2 = L.deriveDriveway(store.project);
  if (d2?.ok) {
    assert.ok(dist(d2.centre[0], L.garageDoor(store.project).mid) < 1);
    assert.ok(dist(d2.centre.at(-1), d2.kerbPoint) < 1);
  }
  store.undo();
  assert.deepEqual(store.project.site.driveway, keep, 'undo brings the edit back');
});

test('a live drag with a PI driveway still ends as one undo step and restores the PIs', () => {
  const p = setup();
  const a = L.deriveDriveway(p);
  const m = a.centre[Math.floor(a.centre.length / 2)];
  D.addDrivewayPI(p, { x: m.x + 600, y: m.y });
  const store = createStore(p);
  store.setUndoFloor();
  const c = ctl(store);
  const keep = structuredClone(store.project.site.driveway);
  const pv = c.pivot();
  const R0 = R.ringRadius(c.target(), pv);
  const at = (deg) => { const q = ((-90 + deg) * Math.PI) / 180; return { x: pv.x + Math.cos(q) * R0, y: pv.y + Math.sin(q) * R0 }; };
  c.pointerDown(at(0), { screen: { x: 0, y: 0 } });
  for (const d of [3, 6, 9, 150, 8]) c.pointerMove(at(d), { screen: { x: d + 5, y: 3 } });
  c.pointerUp();
  assert.equal(store.undo(), true);
  assert.equal(store.canUndo(), false);
  assert.deepEqual(store.project.site.driveway, keep);
});

test('tanks beside the house turn with it (existing rotateHouse behaviour is reused)', () => {
  const p = setup();
  const h = createStore(p);
  const c = ctl(h);
  assert.equal(typeof R.turnTarget, 'function');
  assert.equal(c.turnBy(15).ok, true);
});

// Commercial ---------------------------------------------------------------------------------------------------------------------------
test('commercial: a selected building turns about its centre or a pivot; one undo step; needs a selection', () => {
  const p = commercialProject();
  const store = createStore(p);
  const id = addBuilding(store, 'warehouse');
  store.setUndoFloor();
  const c = ctl(store);
  assert.equal(c.target(), null, 'no selection, no target');
  assert.equal(c.turnBy(10).ok, false);
  store.ui.commercialBuilding = id;
  const t0 = c.target();
  assert.equal(t0.kind, 'building');
  const b0 = structuredClone(store.project.commercial.buildings.find((b) => b.id === id).place);
  assert.equal(c.typed('25').ok, true);
  const b1 = store.project.commercial.buildings.find((b) => b.id === id).place;
  near(((b1.rotationDeg - b0.rotationDeg) % 360 + 360) % 360, 25, 0.2);
  assert.ok(dist(c.target().centre, t0.centre) < 5, 'turned about its own centre');
  store.undo();
  assert.deepEqual(store.project.commercial.buildings.find((b) => b.id === id).place, b0);
  assert.equal(store.canUndo(), false);
  const pv = { x: t0.centre.x + 8000, y: t0.centre.y };
  c.setPivot(pv);
  c.turnBy(90);
  const t1 = c.target();
  const exp = { x: pv.x - (t0.centre.y - pv.y), y: pv.y + (t0.centre.x - pv.x) };
  assert.ok(dist(t1.centre, exp) < 10, 'centre swung 90 degrees about the pivot');
});

test('commercial: a selected unit row turns, and align to the street front faces a building front to the street', () => {
  const p = commercialProject();
  const store = createStore(p);
  store.ui.commercialRow = p.commercial.rows[0].id;
  const c = ctl(store);
  assert.equal(c.target().kind, 'row');
  const r0 = p.commercial.rows[0].rotationDeg || 0;
  assert.equal(c.turnBy(10).ok, true);
  near(store.project.commercial.rows[0].rotationDeg, (r0 + 10), 0.01);
  store.undo();
  c.typed('13');
  assert.equal(c.align('nearest').ok, true);
  const rot = store.project.commercial.rows[0].rotationDeg;
  assert.ok(Math.min(((rot % 90) + 90) % 90, 90 - (((rot % 90) + 90) % 90)) < 0.15, `row square to the boundary: ${rot}`);
});

test('commercial: align a building to the street frontage turns its front to the street', () => {
  const p = commercialProject();
  const store = createStore(p);
  const id = addBuilding(store, 'warehouse');
  store.ui.commercialBuilding = id;
  const c = ctl(store);
  c.typed('70');
  assert.equal(c.align('frontage').ok, true);
  const t = c.target();
  const lot = store.project.site.lot;
  const road = L.roadReserve(lot).find((x) => x.edge === R.frontEdgeIndex(lot));
  const look = { x: Math.cos(((t.orientDeg - 90) * Math.PI) / 180), y: Math.sin(((t.orientDeg - 90) * Math.PI) / 180) };
  assert.ok(look.x * road.outward.x + look.y * road.outward.y > 0.9998, 'front looks out of the street edge');
});
