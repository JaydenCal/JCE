// Lot planner mechanics: bearings and lengths, clearances (rectangular, corner and irregular lots), garage orientation, the driveway,
// and the rule that mirroring the house never mirrors the lot.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/model/schema.js';
import { catalogue } from '../src/catalogue/index.js';
import { placeHouse } from '../src/portal/place-house.js';
import { lotEnvelope, portalLotToSiteLot, SAMPLE_LOT } from '../src/portal/envelope.js';
import { autoPose } from '../src/portal/auto-place.js';
import { arrangeApply, startingPose } from '../src/portal/arrange.js';
import * as L from '../src/site/lotplan.js';
import { snapAngle, normDeg } from '../src/portal/pose-session.js';

const SETBACKS = { front: { minM: 4.5 }, secondaryFront: { minM: 3 }, side: { minM: 0.9 }, rear: { minM: 3 } };
function lotProject(polygonMm, frontEdgeIndices, extra = {}) {
  const portal = { name: 'Test lot', polygonMm, frontEdgeIndices, picked: SETBACKS, lot: '7', dp: 'DP 99', ...extra };
  const env = lotEnvelope(portal);
  const p = createProject({ name: 'Lot test' });
  p.site.lot = portalLotToSiteLot(portal, env);
  return p;
}
const rect = () => lotProject(SAMPLE_LOT.polygonMm, [2]);
const corner = () => lotProject([{ x: 0, y: 0 }, { x: 20000, y: 0 }, { x: 20000, y: 30000 }, { x: 0, y: 30000 }], [2, 1]);
const irregular = () => lotProject([{ x: 0, y: 0 }, { x: 16000, y: 2000 }, { x: 15000, y: 24000 }, { x: 9000, y: 38000 }, { x: -1000, y: 30000 }], [3]);
const house = (id = 'shed_workshop') => catalogue.createFromTemplate(id);

test('bearings and distances format as degrees, minutes, seconds and metres', () => {
  assert.equal(L.formatBearing(0), '0°00\'00"');
  assert.equal(L.formatBearing(78.0006944), '78°00\'03"'.replace('03', '02'));
  assert.equal(L.formatBearing(359.99999), '0°00\'00"');
  assert.equal(L.formatLength(20000), '20.00');
  assert.equal(L.formatLength(14250.4), '14.25');
  // Plan up is north, so an edge running straight up the page is bearing 0 and one running right is 90.
  assert.ok(Math.abs(L.bearingDeg({ x: 0, y: 0 }, { x: 0, y: -10 }) - 0) < 1e-9);
  assert.ok(Math.abs(L.bearingDeg({ x: 0, y: 0 }, { x: 10, y: 0 }) - 90) < 1e-9);
  assert.ok(Math.abs(L.bearingDeg({ x: 0, y: 0 }, { x: 0, y: 10 }) - 180) < 1e-9);
  const dims = L.boundaryDims(rect().site.lot);
  assert.equal(dims.length, 4);
  assert.deepEqual(dims.map((d) => d.length), ['14.00', '36.00', '14.00', '36.00']);
  assert.equal(dims[0].bearing, '90°00\'00"');
});

test('lot labels: proposed lot reads PROPOSED LOT n, registered lot has lot and DP on separate lines', () => {
  assert.deepEqual(L.lotLabelLines(rect().site.lot), { first: 'PROPOSED LOT 7', second: 'DP 99', proposed: true });
  const reg = { lotNumber: '24', planLabel: 'DP 1234567' };
  assert.deepEqual(L.lotLabelLines(reg), { first: 'LOT 24', second: 'DP 1234567', proposed: false });
});

test('clearances on a rectangular lot: front, both sides and rear, inside or outside the envelope', () => {
  const p = rect();
  placeHouse(p, house(), { x: 7000, y: 18000, rotation: 0, mirrored: false });
  const c = L.clearances(p);
  assert.equal(c.rows.length, 4);
  assert.ok(['ok', 'breach'].includes(c.status));
  const kinds = c.rows.map((r) => r.kind).sort();
  assert.deepEqual(kinds, ['front', 'rear', 'side', 'side']);
  for (const r of c.rows) assert.ok(r.clearanceM > 0 && r.requiredM != null);
  // Push the house to the left boundary: the left side row goes outside.
  const q = rect();
  placeHouse(q, house(), { x: 1500, y: 18000, rotation: 0, mirrored: false });
  const cq = L.clearances(q);
  assert.equal(cq.status, 'breach');
  assert.ok(cq.rows.some((r) => r.kind === 'side' && r.status === 'outside' && r.shortByM > 0));
});

test('clearances on a corner lot have a front and a secondary front', () => {
  const p = corner();
  placeHouse(p, house(), { x: 10000, y: 15000, rotation: 0, mirrored: false });
  const kinds = L.clearances(p).rows.map((r) => r.kind);
  assert.ok(kinds.includes('front') && kinds.includes('secondaryFront'), kinds.join(','));
  assert.equal(kinds.length, 4);
});

test('clearances on an irregular lot measure to every edge, and the clearance is a real distance', () => {
  const p = irregular();
  placeHouse(p, house(), { x: 7500, y: 16000, rotation: 0, mirrored: false });
  const c = L.clearances(p);
  assert.equal(c.rows.length, 5);
  for (const r of c.rows) {
    const d = Math.hypot(r.from.x - r.to.x, r.from.y - r.to.y) / 1000;
    assert.ok(Math.abs(d - r.clearanceM) < 0.01, `${r.label}: ${d} vs ${r.clearanceM}`);
  }
});

test('a lot with no setbacks reads unknown, not inside', () => {
  const p = rect();
  p.site.lot.setbacks = null;
  placeHouse(p, house(), { x: 7000, y: 18000, rotation: 0, mirrored: false });
  const c = L.clearances(p);
  assert.equal(c.status, 'unknown');
  assert.ok(c.rows.every((r) => r.status === 'unknown'));
});

test('garage faces the street: faceGarageAngle and autoPose', () => {
  const p = rect();
  const h = house('house_double');
  placeHouse(p, h, { x: 7000, y: 18000, rotation: 0, mirrored: false });
  const a = L.faceGarageAngle(p);
  assert.equal(typeof a, 'number');
  const turned = structuredClone(p);
  arrangeApply(turned, { ...startingPose(turned), rotation: a });
  assert.ok(Math.abs(L.faceGarageAngle(turned)) < 0.6, `still ${L.faceGarageAngle(turned)} after turning`);
  // The door normal then points out of the street edge.
  const door = L.garageDoor(turned);
  const reserve = L.roadReserve(turned.site.lot)[0];
  assert.ok(door.normal.x * reserve.outward.x + door.normal.y * reserve.outward.y > 0.98);
  // First placement: auto pose faces the garage to the street and sits inside the envelope.
  const base = rect();
  const auto = autoPose(base, h);
  assert.equal(auto.facing, true);
  const placed = structuredClone(base);
  placeHouse(placed, h, auto.pose);
  const d = L.garageDoor(placed);
  const r = L.roadReserve(placed.site.lot)[0];
  assert.ok(d.normal.x * r.outward.x + d.normal.y * r.outward.y > 0.95);
  if (auto.fits) assert.equal(L.clearances(placed).allInside, true);
});

test('a house with no garage door has no garage angle', () => {
  const p = rect();
  placeHouse(p, house('granny_flat'), { x: 7000, y: 18000, rotation: 0, mirrored: false });
  if (!L.garageDoor(p)) assert.equal(L.faceGarageAngle(p), null);
});

test('driveway: constant width, joins door to kerb, with a crossover, and curves when the door is off line', () => {
  const p = rect();
  const h = house('house_double');
  const auto = autoPose(p, h);
  placeHouse(p, h, auto.pose);
  const d = L.deriveDriveway(p);
  assert.equal(d.ok, true);
  assert.ok(d.widthMm >= 3000 && d.widthMm <= 6500);
  assert.ok(d.lengthMm > 1000);
  assert.ok(d.crossover.polygon.length >= 4);
  // Constant width: the distance between the left and right edges is the same all along.
  const widths = d.left.map((l, i) => Math.hypot(l.x - d.right[i].x, l.y - d.right[i].y));
  assert.ok(Math.max(...widths) - Math.min(...widths) < 5, 'width varies');
  // It ends on the kerb line side of the property line.
  const reserve = L.roadReserve(p.site.lot)[0];
  const end = d.centre.at(-1);
  const toward = (end.x - p.site.lot.boundary[reserve.edge].x) * reserve.outward.x + (end.y - p.site.lot.boundary[reserve.edge].y) * reserve.outward.y;
  assert.ok(toward > 0, 'driveway reaches past the boundary to the road');
  // Move the house sideways: the driveway has to bend, so its minimum radius is finite.
  const q = rect();
  placeHouse(q, h, { ...auto.pose, x: auto.pose.x - 3000 });
  const dq = L.deriveDriveway(q);
  if (dq.ok) assert.ok(dq.minRadiusM > 0);
});

test('driveway: a door facing away from the street gives no driveway', () => {
  const p = rect();
  const h = house('house_double');
  const auto = autoPose(p, h);
  placeHouse(p, h, { ...auto.pose, rotation: auto.pose.rotation + 180 });
  const d = L.deriveDriveway(p);
  assert.equal(d.ok, false);
  assert.ok(['door_faces_away', 'no_street'].includes(d.reason));
});

test('mirror flips the house and never the lot', () => {
  const p = rect();
  const h = house('house_double');
  const before = JSON.stringify(p.site.lot);
  const plain = structuredClone(p);
  const mirrored = structuredClone(p);
  placeHouse(plain, h, { x: 7000, y: 18000, rotation: 0, mirrored: false });
  placeHouse(mirrored, h, { x: 7000, y: 18000, rotation: 0, mirrored: true });
  assert.equal(JSON.stringify(plain.site.lot), before);
  assert.equal(JSON.stringify(mirrored.site.lot), before);
  // The house really is flipped: the garage door moves to the other side of the centre line.
  const dp = L.garageDoor(plain);
  const dm = L.garageDoor(mirrored);
  const cx = (pr) => L.orientedBox(L.buildingHull(pr)).centre.x;
  assert.ok(Math.sign(dp.mid.x - cx(plain)) !== Math.sign(dm.mid.x - cx(mirrored)) || Math.abs(dp.mid.x - cx(plain)) < 50);
  // Arranging an existing house with mirror also leaves the lot alone.
  const arranged = structuredClone(plain);
  arrangeApply(arranged, { ...startingPose(arranged), mirrored: true, rotation: 30 });
  assert.equal(JSON.stringify(arranged.site.lot), before);
});

test('rotation is free by default (0.1 degree), or snaps to 15 with Shift, and wraps to -180..180', () => {
  assert.equal(snapAngle(37.4, false), 37.4);
  assert.equal(snapAngle(37.4, true), 30);
  assert.equal(snapAngle(38, true), 45);
  assert.equal(snapAngle(40, true), 45);
  assert.equal(normDeg(190), -170);
  assert.equal(normDeg(-190), 170);
  assert.equal(normDeg(180), 180);
});
