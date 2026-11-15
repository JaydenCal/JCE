// Editable driveway: a stored end point and bends replace the automatic curve, keep a constant width, follow the house, and reset.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/model/schema.js';
import { catalogue } from '../src/catalogue/index.js';
import { placeHouse } from '../src/portal/place-house.js';
import { lotEnvelope, portalLotToSiteLot, SAMPLE_LOT } from '../src/portal/envelope.js';
import { autoPose } from '../src/portal/auto-place.js';
import * as L from '../src/site/lotplan.js';

function setup() {
  const portal = { name: 'T', polygonMm: SAMPLE_LOT.polygonMm, frontEdgeIndices: [2], picked: { front: { minM: 4.5 }, secondaryFront: { minM: 3 }, side: { minM: 0.9 }, rear: { minM: 3 } }, lot: '7', dp: 'DP 99' };
  const p = createProject({ name: 'Drive' });
  p.site.lot = portalLotToSiteLot(portal, lotEnvelope(portal));
  const h = catalogue.createFromTemplate('house_double');
  placeHouse(p, h, autoPose(p, h).pose);
  return p;
}
const widths = (d) => d.left.map((l, i) => Math.hypot(l.x - d.right[i].x, l.y - d.right[i].y));

test('no stored driveway: automatic, not edited', () => {
  const d = L.deriveDriveway(setup());
  assert.equal(d.ok, true);
  assert.equal(d.edited, false);
});

test('moving the end handle along the frontage moves the kerb point, keeps width and the door end', () => {
  const p = setup();
  const a = L.deriveDriveway(p);
  const target = a.endOffsetMm + 3000 < a.edgeLenMm - 2500 ? a.endOffsetMm + 3000 : a.endOffsetMm - 3000;
  L.setStoredDriveway(p, { endOffsetMm: target, pis: [], radiusM: 6 });
  const b = L.deriveDriveway(p);
  assert.equal(b.edited, true);
  assert.ok(Math.abs(b.endOffsetMm - target) < 5, `${b.endOffsetMm} vs ${target}`);
  assert.ok(Math.hypot(b.doorMid.x - a.doorMid.x, b.doorMid.y - a.doorMid.y) < 1, 'door end moved');
  const w = widths(b);
  assert.ok(Math.max(...w) - Math.min(...w) < 5);
  assert.ok(b.crossover.polygon.length >= 4);
});

test('a bend point shapes the centreline with a radius curve and the end stays attached to the door when the house moves', () => {
  const p = setup();
  const a = L.deriveDriveway(p);
  const mid = a.centre[Math.floor(a.centre.length / 2)];
  L.setStoredDriveway(p, { endOffsetMm: a.endOffsetMm, pis: [{ x: mid.x + 2500, y: mid.y }], radiusM: 5 });
  const b = L.deriveDriveway(p);
  assert.equal(b.pis.length, 1);
  assert.ok(b.minRadiusM != null && b.minRadiusM > 1);
  // Move the house 1 m sideways: the driveway's first point follows the garage door.
  for (const lv of p.levels) { for (const w of lv.walls) { w.a.x += 1000; w.b.x += 1000; } for (const o of lv.openings || []) void o; }
  const c = L.deriveDriveway(p);
  assert.ok(Math.hypot(c.centre[0].x - c.doorMid.x, c.centre[0].y - c.doorMid.y) < 1);
  assert.ok(Math.abs(c.centre[0].x - b.centre[0].x - 1000) < 5);
});

test('width is editable and reset removes the stored edit', () => {
  const p = setup();
  const a = L.deriveDriveway(p);
  L.setStoredDriveway(p, { endOffsetMm: a.endOffsetMm, pis: [], radiusM: 6, widthMm: 4000 });
  assert.equal(L.deriveDriveway(p).widthMm, 4000);
  L.setStoredDriveway(p, null);
  assert.equal(p.site.driveway, undefined);
  assert.equal(L.deriveDriveway(p).edited, false);
});

test('filletPath rounds a right angle with the given radius', () => {
  const pts = L.filletPath([{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 10000 }], 3000);
  assert.ok(pts.length > 5);
  const mid = pts[Math.floor(pts.length / 2)];
  assert.ok(Math.abs(Math.hypot(mid.x - 7000, mid.y - 3000) - 3000) < 5);
});
