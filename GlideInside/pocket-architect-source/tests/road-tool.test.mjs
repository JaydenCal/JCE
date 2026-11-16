// Road or pavement tool: per-PI curve geometry, PI edits, the Add curve toggle, snapping to the kerb and to existing pavement, area by
// material reaching feasibility, undo, and the toolbar entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/model/schema.js';
import { createStore } from '../src/model/store.js';
import { catalogue } from '../src/catalogue/index.js';
import { placeHouse } from '../src/portal/place-house.js';
import { lotEnvelope, portalLotToSiteLot } from '../src/portal/envelope.js';
import { autoPose } from '../src/portal/auto-place.js';
import * as L from '../src/site/lotplan.js';
import * as P from '../src/site/pavedways.js';
import { checkSummary } from '../src/flow/res-logic.js';
import { TOOL_DEFS, KEY_TO_TOOL } from '../src/editor2d/tools-meta.js';
import { createPaveController } from '../src/editor2d/pave-controller.js';
import { paveState, setPaveState } from '../src/editor2d/pave-state.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { developedAreaM2 } from '../src/commercial/feasibility.js';
import { pavementModel } from '../src/commercial/catalogue/pavements/logic.js';

function lotProject(w = 30000, d = 50000) {
  const portal = { name: 'T', polygonMm: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }], frontEdgeIndices: [0], picked: { front: { minM: 4.5 }, secondaryFront: { minM: 3 }, side: { minM: 0.9 }, rear: { minM: 3 } }, lot: '7', dp: 'DP 99' };
  const p = createProject({ name: 'Road' });
  p.site.lot = portalLotToSiteLot(portal, lotEnvelope(portal));
  const h = catalogue.createFromTemplate('house_double');
  placeHouse(p, h, autoPose(p, h).pose);
  return p;
}
const kerbY = (p) => L.roadReserve(p.site.lot)[0].lines.kerb[0].y;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const L90 = [{ x: 2000, y: 20000 }, { x: 14000, y: 20000 }, { x: 14000, y: 32000 }]; // a right angle PI at (14000, 20000)

test('toolbar: Road or pavement is its own tool on L, in both modes', () => {
  const def = TOOL_DEFS.find((t) => t.id === 'pave');
  assert.equal(def.label, 'Road or pavement');
  assert.equal(def.key, 'L');
  assert.equal(def.commercialOnly, undefined, 'residential and commercial');
  assert.equal(KEY_TO_TOOL.l, 'pave');
  assert.ok(!/[–—]/.test(def.label + def.tip));
});

test('fillet: tangent points sit one tangent length from the PI and the arc keeps the radius', () => {
  const [a, b, c] = L90;
  const f = P.filletCorner(a, b, c, 5000);
  assert.ok(f);
  assert.ok(Math.abs(f.radius - 5000) < 1);
  assert.ok(Math.abs(f.tangentLen - 5000) < 1, 'a 90 degree bend has tangent length equal to the radius');
  assert.ok(Math.abs(dist(f.A, b) - f.tangentLen) < 1 && Math.abs(dist(f.C, b) - f.tangentLen) < 1);
  assert.ok(Math.abs(f.A.y - 20000) < 1 && Math.abs(f.A.x - 9000) < 1, 'tangent to the incoming leg');
  assert.ok(Math.abs(f.C.x - 14000) < 1 && Math.abs(f.C.y - 25000) < 1, 'tangent to the outgoing leg');
  for (const q of f.pts) assert.ok(Math.abs(dist(q, f.centre) - 5000) < 1, 'every arc point is on the circle');
  assert.ok(Math.abs(dist(f.centre, { x: 9000, y: 25000 })) < 1);
  // the arc is tangent: the radius at A is perpendicular to the incoming leg
  assert.ok(Math.abs((f.A.x - f.centre.x) * 1 + (f.A.y - f.centre.y) * 0) < 1e-6 + 1);
});

test('fillet: a 60 degree deflection gets tangent length r tan(deflection / 2) and a smaller radius when the legs are short', () => {
  const pts = [{ x: 0, y: 0 }, { x: 20000, y: 0 }, { x: 30000, y: 17320 }];
  const f = P.filletCorner(pts[0], pts[1], pts[2], 8000);
  const defl = Math.PI - f.interior;
  assert.ok(Math.abs(defl - Math.PI / 3) < 0.01);
  assert.ok(Math.abs(f.tangentLen - 8000 * Math.tan(defl / 2)) < 2);
  const tight = P.filletCorner(pts[0], { x: 1000, y: 0 }, { x: 1000, y: 1000 }, 20000);
  assert.ok(tight.radius < 20000, 'the radius is cut back so the tangent points stay on the legs');
  assert.equal(P.filletCorner(pts[0], pts[1], { x: 40000, y: 0 }, 5000), null, 'a straight run has no curve');
  assert.equal(P.filletCorner(pts[0], pts[1], pts[2], 0), null, 'radius 0 is sharp');
});

test('per-PI radius: each PI keeps its own, the way radius is the fallback, and the strip stays constant width', () => {
  const p = lotProject();
  const way = P.addWay(p, { kind: 'road', material: 'asphalt', widthMm: 5000, radiusMm: 0, pts: [{ x: 3000, y: 18000 }, { x: 15000, y: 18000 }, { x: 15000, y: 30000, r: 4000 }, { x: 25000, y: 30000, r: 3000 }, { x: 25000, y: 40000 }] });
  assert.equal(way.pts[1].r, undefined);
  assert.equal(way.pts[2].r, 4000);
  const arcs = P.wayArcs(P.getWay(p, way.id));
  assert.deepEqual(arcs.map((a) => a.index), [2, 3], 'PI 1 is sharp, PI 2 and 3 curve');
  assert.ok(Math.abs(arcs[0].radius - 4000) < 1 && arcs[1].radius >= 3000 - 1);
  const g = P.wayGeometry(p, P.getWay(p, way.id));
  assert.ok(g.minRadiusM > 2.9, `minimum ${g.minRadiusM}`);
  P.updateWay(p, way.id, { radiusMm: 4000 });
  const w2 = P.getWay(p, way.id);
  assert.equal(P.wayArcs(w2).length, 3, 'the way radius now rounds PI 1 too');
  assert.equal(w2.pts[2].r, 4000, 'a PI with its own radius keeps it');
  // moving a PI keeps its radius
  P.moveVertex(p, way.id, 2, { x: 15500, y: 30500 });
  assert.equal(P.getWay(p, way.id).pts[2].r, 4000);
});

test('curve handle: dragging it to the arc midpoint gives back the radius', () => {
  const way = { id: 'w', kind: 'road', material: 'asphalt', widthMm: 5000, radiusMm: 0, pts: [L90[0], { ...L90[1], r: 5000 }, L90[2]], kerbEdge: null, heads: [] };
  const h = P.curveHandle(way, 1);
  assert.ok(h && Math.abs(h.radiusMm - 5000) < 1);
  assert.ok(Math.abs(P.radiusFromHandle(way, 1, h) - 5000) <= 100);
  const far = { x: h.x - 600, y: h.y + 600 };
  assert.ok(P.radiusFromHandle(way, 1, far) > 5000, 'dragging away from the PI grows the radius');
  assert.equal(P.radiusFromHandle(way, 1, L90[1]), 0, 'a handle on the PI is sharp');
  assert.equal(P.curveHandle(way, 0), null);
});

test('PI insert and delete: points are added on a segment and removed, ends are kept', () => {
  const p = lotProject();
  const w = P.addWay(p, { kind: 'driveway', widthMm: 3500, pts: [{ x: 5000, y: 15000 }, { x: 5000, y: 30000 }] });
  P.insertVertex(p, w.id, 0, { x: 9000, y: 22000 });
  let cur = P.getWay(p, w.id);
  assert.equal(cur.pts.length, 3);
  assert.equal(cur.pts[1].x, 9000);
  P.setVertexRadius(p, w.id, 1, 4000);
  assert.equal(P.getWay(p, w.id).pts[1].r, 4000);
  assert.throws(() => P.setVertexRadius(p, w.id, 0, 4000), /between the two ends/);
  P.removeVertex(p, w.id, 1);
  cur = P.getWay(p, w.id);
  assert.equal(cur.pts.length, 2);
  assert.throws(() => P.removeVertex(p, w.id, 0), /at least two points/);
});

test('controller: Add curve fillets each new PI, the radius box and handle edit it, and every change is one undo step', () => {
  const p = lotProject();
  const store = createStore(p, { autosave: false });
  const ctl = createPaveController({ store, scale: () => 0.1, toast: () => {} });
  setPaveState({ kind: 'road', mode: 'draw', material: 'asphalt', selected: null, curve: false, curveMm: null, radiusMm: 0, vertex: null });
  ctl.reset();
  ctl.pointerDown({ x: 3000, y: 18000 }, { alt: true });
  ctl.pointerDown({ x: 15000, y: 18000 }, { alt: true }); // sharp
  ctl.keyDown({ key: 'c' });
  assert.equal(paveState.curve, true);
  ctl.pointerDown({ x: 15000, y: 32000 }, { alt: true }); // curved with the road default, 10 m
  ctl.pointerDown({ x: 28000, y: 32000 }, { alt: true });
  ctl.keyDown({ key: 'Enter' });
  const way = store.project.site.paved[0];
  assert.equal(way.pts[1].r, undefined, 'the PI dropped before Add curve stays sharp');
  assert.equal(way.pts[2].r, 10000, 'road default radius 10 m');
  ctl.keyDown({ key: 'c' });
  assert.equal(paveState.curve, false);
  // radius box on the PI
  setPaveState({ vertex: 1 });
  ctl.pointerDown({ x: 15000, y: 18000 }, {}); // click the PI: it becomes the active one
  ctl.pointerUp();
  assert.equal(paveState.vertex, 1);
  ctl.setVertexRadius(5000);
  assert.equal(store.project.site.paved[0].pts[1].r, 5000);
  store.undo();
  assert.equal(store.project.site.paved[0].pts[1].r, undefined, 'one undo reverts the radius change');
  // the handle: drag it outwards
  const w = P.getWay(store.project, way.id);
  const h = P.curveHandle(w, 2);
  ctl.pointerDown({ x: 15000, y: 32000 }, {}); ctl.pointerUp();
  assert.equal(paveState.vertex, 2);
  ctl.pointerDown({ x: h.x, y: h.y }, { screen: { x: 0, y: 0 } });
  ctl.pointerMove({ x: h.x - 400, y: h.y + 400 }, { screen: { x: 30, y: 30 } });
  ctl.pointerUp();
  assert.notEqual(store.project.site.paved[0].pts[2].r, 10000);
  store.undo();
  assert.equal(store.project.site.paved[0].pts[2].r, 10000);
  store.undo();
  assert.equal(store.project.site.paved, undefined, 'and one more removes the whole road');
});

test('snapping: the start goes to the kerb and the crossover is created; ends and edges of existing pavement join cleanly', () => {
  const p = lotProject();
  const s = P.snapWayPoint(p, { x: 9000, y: -1500 }, { mmPerPx: 10 });
  assert.equal(s.kind, 'kerb');
  const a = P.addWay(p, { kind: 'driveway', widthMm: 3500, kerbEdge: s.kerbEdge, pts: [s, { x: 9000, y: 14000 }] });
  assert.ok(P.wayGeometry(p, a).crossoverM2 > 5, 'automatic crossover');
  const end = P.snapWayPoint(p, { x: 9060, y: 14080 }, { mmPerPx: 10 });
  assert.equal(end.kind, 'end');
  const b = P.addWay(p, { kind: 'driveway', widthMm: 3500, pts: [end, { x: 20000, y: 14000 }] });
  const j = P.joinCandidate(p, b.id);
  assert.equal(j.other, a.id);
  P.joinWays(p, a.id, b.id);
  assert.equal(P.getWays(p).length, 1);
  assert.equal(P.getWays(p)[0].kerbEdge, 0, 'the kerb end stays first');
  // the edge of a drawn way
  const g = P.wayGeometry(p, P.getWays(p)[0]);
  const onEdge = g.left[1];
  const near = P.snapWayPoint(p, { x: onEdge.x, y: onEdge.y - 70 }, { mmPerPx: 10 });
  assert.ok(['edge', 'end', 'door'].includes(near.kind), near.kind);
  const solo = lotProject();
  P.addWay(solo, { kind: 'road', widthMm: 5000, pts: [{ x: 4000, y: 30000 }, { x: 4000, y: 44000 }] });
  const e = P.snapWayPoint(solo, { x: 6600, y: 37000 }, { mmPerPx: 10 });
  assert.equal(e.kind, 'edge');
  assert.ok(Math.abs(e.x - 6500) < 2, `x ${e.x}`);
});

test('snapping: the lot boundary and the garage door', () => {
  const p = lotProject();
  const b = P.snapWayPoint(p, { x: 90, y: 30000 }, { mmPerPx: 10 });
  assert.ok(b.kind === 'boundary' && b.x === 0, `${b.kind} ${b.x}`);
  const door = L.garageDoor(p);
  assert.equal(P.snapWayPoint(p, { x: door.mid.x + 30, y: door.mid.y + 30 }, { mmPerPx: 10 }).kind, 'door');
});

test('area by material, curved or not, reaches the residential check and the commercial pavement quantities', () => {
  const p = lotProject(40000, 60000);
  const before = checkSummary(p);
  P.addWay(p, { kind: 'road', material: 'gravel', widthMm: 5000, radiusMm: 0, pts: [{ x: 4000, y: 8000 }, { x: 4000, y: 30000 }, { x: 16000, y: 30000, r: 6000 }, { x: 16000, y: 44000 }] });
  P.addWay(p, { kind: 'pavement', material: 'pavers', widthMm: 1500, pts: [{ x: 30000, y: 8000 }, { x: 30000, y: 28000 }] });
  const sum = P.pavedSummary(p);
  assert.deepEqual(sum.byMaterial.map((e) => e.material), ['gravel', 'pavers']);
  const pav = sum.byMaterial.find((e) => e.material === 'pavers');
  assert.ok(Math.abs(pav.areaM2 - 30) < 0.5, `pavers ${pav.areaM2}`);
  const after = checkSummary(p);
  assert.ok(after.pavedByMaterial.some((e) => e.material === 'gravel'));
  assert.ok(before.openSpaceM2 - after.openSpaceM2 > sum.totalM2 - 2);
  const c = commercialProject();
  const d0 = developedAreaM2(c.commercial, c.site.lot);
  P.addWay(c, { kind: 'road', material: 'asphalt', widthMm: 6000, pts: [{ x: 5000, y: 20000 }, { x: 5000, y: 60000 }, { x: 25000, y: 60000, r: 8000 }] });
  P.addWay(c, { kind: 'pavement', material: 'pavers', widthMm: 2000, pts: [{ x: 40000, y: 20000 }, { x: 40000, y: 50000 }] });
  const model = pavementModel(c.commercial, c.site.lot);
  const types = model.quantities.byType.map((e) => e.type);
  assert.ok(types.includes('asphalt-ac10-car') && types.includes('unit-pavers-ped'), types.join(','));
  assert.ok(developedAreaM2(c.commercial, c.site.lot) > d0 + 250);
});

test('3D: the pavement follows the surface function with nothing floating', async () => {
  const { addDrawnWays, LIFT_M } = await import('../src/viewer3d/pave3d.js');
  const p = lotProject();
  P.addWay(p, { kind: 'road', material: 'asphalt', widthMm: 5000, pts: [{ x: 4000, y: 18000 }, { x: 14000, y: 18000, r: 5000 }, { x: 14000, y: 30000 }] });
  const surf = (x, y) => 0.5 + x * 0.0001 + y * 0.00005; // a gently falling ground, mm in, metres out
  const r = addDrawnWays(p, surf);
  const pos = r.mesh.geometry.getAttribute('position');
  assert.ok(LIFT_M <= 0.05);
  for (let i = 0; i < pos.count; i += 7) {
    const x = pos.getX(i); const z = pos.getZ(i);
    assert.ok(Math.abs(pos.getY(i) - (surf(x * 1000, z * 1000) + LIFT_M)) < 1e-6, 'every vertex is the ground plus the lift');
  }
});
