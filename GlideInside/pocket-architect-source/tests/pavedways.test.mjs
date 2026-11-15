// Driveway and road tool: geometry (width, fillets, area), snapping, join and split, material in 2D and 3D, the outside-lot clamp, the
// automatic driveway standing aside, and the area reaching feasibility, the plan set and the commercial pavement quantities.
import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { createProject } from '../src/model/schema.js';
import { createStore } from '../src/model/store.js';
import { catalogue } from '../src/catalogue/index.js';
import { placeHouse } from '../src/portal/place-house.js';
import { lotEnvelope, portalLotToSiteLot } from '../src/portal/envelope.js';
import { autoPose } from '../src/portal/auto-place.js';
import * as L from '../src/site/lotplan.js';
import * as P from '../src/site/pavedways.js';
import * as G from '../src/model/geometry.js';
import { checkSummary } from '../src/flow/res-logic.js';
import { exportPlanSet } from '../src/premium/exporters/planset/index.js';
import { pavementById } from '../src/commercial/catalogue/pavements/pavements.js';
import { drawPavementArea } from '../src/commercial/catalogue/pavements/draw2d.js';
import { addDrawnWays } from '../src/viewer3d/pave3d.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { developedAreaM2 } from '../src/commercial/feasibility.js';
import { pavementModel } from '../src/commercial/catalogue/pavements/logic.js';
import { createPaveController } from '../src/editor2d/pave-controller.js';
import { paveState, setPaveState } from '../src/editor2d/pave-state.js';

function lotProject(w = 15000, d = 35000) {
  const portal = { name: 'T', polygonMm: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }], frontEdgeIndices: [0], picked: { front: { minM: 4.5 }, secondaryFront: { minM: 3 }, side: { minM: 0.9 }, rear: { minM: 3 } }, lot: '7', dp: 'DP 99' };
  const p = createProject({ name: 'Drive' });
  p.site.lot = portalLotToSiteLot(portal, lotEnvelope(portal));
  const h = catalogue.createFromTemplate('house_double');
  placeHouse(p, h, autoPose(p, h).pose);
  return p;
}
const kerbY = (p) => L.roadReserve(p.site.lot)[0].lines.kerb[0].y; // the kerb line of the street frontage (y, since the frontage is edge 0)
const straight = (p, extra = {}) => P.addWay(p, { kind: 'driveway', material: 'concrete', widthMm: 3500, radiusMm: 0, kerbEdge: 0, pts: [{ x: 6000, y: kerbY(p) }, { x: 6000, y: 12000 }], ...extra });

// Geometry --------------------------------------------------------------------------------------------------------------------------
test('width limits: driveway 3.0 to 6.0 m, road 4 to 8 m, in 50 mm steps', () => {
  assert.equal(P.clampWidth('driveway', 1000), 3000);
  assert.equal(P.clampWidth('driveway', 9000), 6000);
  assert.equal(P.clampWidth('driveway', 3520), 3500);
  assert.equal(P.clampWidth('road', 3000), 4000);
  assert.equal(P.clampWidth('road', 12000), 8000);
  assert.equal(P.clampWidth('road', undefined), 5000);
  const p = lotProject();
  const w = straight(p, { widthMm: 7000 });
  assert.equal(w.widthMm, 6000, 'a driveway wider than 6 m is held at 6 m');
});

test('a straight way is a constant width strip and its area is width times length', () => {
  const p = lotProject();
  const w = P.addWay(p, { kind: 'road', material: 'gravel', widthMm: 5000, radiusMm: 0, pts: [{ x: 3000, y: 3000 }, { x: 3000, y: 20000 }] });
  const g = P.wayGeometry(p, w);
  const widths = g.left.map((l, i) => G.dist(l, g.right[i]));
  assert.ok(Math.max(...widths) - Math.min(...widths) < 1);
  assert.ok(Math.abs(widths[0] - 5000) < 1);
  assert.ok(Math.abs(g.lengthMm - 17000) < 1);
  assert.ok(Math.abs(g.areaM2 - 17 * 5) < 0.2, `area ${g.areaM2}`);
});

test('fillets round the bends: the minimum radius reaches the one asked for and the strip stays constant width', () => {
  const p = lotProject(40000, 60000);
  const pts = [{ x: 5000, y: 5000 }, { x: 5000, y: 30000 }, { x: 25000, y: 30000 }];
  const sharp = P.addWay(p, { kind: 'road', material: 'gravel', widthMm: 5000, radiusMm: 0, pts });
  const round = P.addWay(p, { kind: 'road', material: 'gravel', widthMm: 5000, radiusMm: 8000, pts: pts.map((q) => ({ ...q, x: q.x + 8000 })) });
  const gs = P.wayGeometry(p, sharp);
  const gr = P.wayGeometry(p, round);
  assert.ok(gr.centre.length > gs.centre.length + 5, 'an arc has more points than a corner');
  assert.ok(gr.minRadiusM > 7.5 && gr.minRadiusM < 8.6, `min radius ${gr.minRadiusM}`);
  assert.ok(gr.lengthMm < gs.lengthMm, 'cutting the corner shortens the path');
  const w = gr.left.map((l, i) => G.dist(l, gr.right[i]));
  assert.ok(Math.max(...w) - Math.min(...w) < 30);
  // The arc is never tighter than the half width plus 0.2 m, so the inside edge cannot fold over itself.
  const tight = P.addWay(p, { kind: 'road', material: 'gravel', widthMm: 8000, radiusMm: 1000, pts: pts.map((q) => ({ ...q, x: q.x + 16000 })) });
  assert.ok(P.wayGeometry(p, tight).minRadiusM >= 4.1);
});

test('turning heads add area without overlapping the way, and are kept in the lot', () => {
  const p = lotProject(40000, 60000);
  const w = P.addWay(p, { kind: 'road', material: 'gravel', widthMm: 5000, radiusMm: 0, pts: [{ x: 20000, y: 4000 }, { x: 20000, y: 40000 }] });
  const base = P.wayGeometry(p, w).areaM2;
  P.addHead(p, w.id, 'end', 'bulb');
  const bulb = P.wayGeometry(p, P.getWay(p, w.id));
  assert.ok(bulb.headM2 > 60 && bulb.headM2 < 115, `bulb ${bulb.headM2}`);
  assert.ok(Math.abs(bulb.areaM2 - base - bulb.headM2) < 0.01);
  P.addHead(p, w.id, 'end', 'tee');
  assert.equal(P.getWay(p, w.id).heads.length, 1, 'one head per end');
  assert.throws(() => P.addHead(p, straight(p).id, 'start', 'bulb'), /kerb end/);
});

// Snapping --------------------------------------------------------------------------------------------------------------------------
test('snapping: a click in the verge goes to the kerb, with the crossover', () => {
  const p = lotProject();
  const s = P.snapWayPoint(p, { x: 7123, y: -1800 }, { mmPerPx: 10 });
  assert.equal(s.kind, 'kerb');
  assert.equal(s.kerbEdge, 0);
  assert.equal(s.y, kerbY(p));
  const w = P.addWay(p, { kind: 'driveway', widthMm: 3500, kerbEdge: s.kerbEdge, pts: [s, { x: 7000, y: 9000 }] });
  const g = P.wayGeometry(p, w);
  assert.ok(g.crossoverM2 > 10, `crossover ${g.crossoverM2}`);
  assert.equal(w.pts[0].y, kerbY(p));
});

test('snapping: the garage door, the ends of other pavement, the lot boundary and Alt', () => {
  const p = lotProject();
  const door = L.garageDoor(p);
  assert.equal(P.snapWayPoint(p, { x: door.mid.x + 50, y: door.mid.y - 40 }, { mmPerPx: 10 }).kind, 'door');
  const a = P.addWay(p, { kind: 'road', widthMm: 4000, pts: [{ x: 2000, y: 20000 }, { x: 6000, y: 20000 }] });
  const e = P.snapWayPoint(p, { x: 6060, y: 20040 }, { mmPerPx: 10 });
  assert.equal(e.kind, 'end');
  assert.deepEqual({ x: e.x, y: e.y }, { x: 6000, y: 20000 });
  assert.equal(P.snapWayPoint(p, { x: 6060, y: 20040 }, { mmPerPx: 10, exclude: a.id }).kind, 'grid', 'a way does not snap to its own ends');
  const b = P.snapWayPoint(p, { x: 14950, y: 22000 }, { mmPerPx: 10 });
  assert.equal(b.kind, 'boundary');
  assert.equal(b.x, 15000);
  assert.equal(P.snapWayPoint(p, { x: 14950, y: 22000 }, { mmPerPx: 10, alt: true }).kind, 'free');
  assert.equal(P.snapWayPoint(p, { x: 15012, y: 34990 }, { mmPerPx: 10 }).kind, 'corner');
});

test('angle lock rounds to 15 degree steps', () => {
  const q = P.lockAngle({ x: 1000, y: 280 }, { x: 0, y: 0 });
  assert.ok(Math.abs(Math.atan2(q.y, q.x) - Math.PI / 12) < 1e-3);
  assert.ok(Math.abs(Math.hypot(q.x, q.y) - Math.hypot(1000, 280)) < 2);
});

// Outside the lot -----------------------------------------------------------------------------------------------------------------------
test('nothing is drawn outside the lot except the crossover', () => {
  const p = lotProject();
  const w = P.addWay(p, { kind: 'road', material: 'gravel', widthMm: 8000, radiusMm: 5000, kerbEdge: 0, pts: [{ x: 7000, y: kerbY(p) }, { x: -9000, y: 10000 }, { x: 30000, y: 20000 }, { x: 14000, y: 80000 }] });
  for (const pt of w.pts.slice(1)) assert.ok(G.pointInPolygon(pt, p.site.lot.boundary) || P.clampToLot(p, pt).x === pt.x, 'every point is inside the lot');
  const g = P.wayGeometry(p, w);
  const reserve = L.roadReserve(p.site.lot)[0];
  const verge = P.vergeQuad(reserve);
  for (const pc of g.pieces) {
    for (const v of pc.ring) {
      const inLot = G.pointInPolygon(v, p.site.lot.boundary) || G.dist(v, P.clampToLot(p, v)) < 2;
      const inVerge = pc.role === 'crossover' && (G.pointInPolygon(v, verge) || G.dist(v, P.clampToLot(p, v)) < 2);
      assert.ok(inLot || inVerge, `${pc.role} point ${v.x},${v.y} is outside the lot`);
    }
  }
  assert.ok(g.pieces.some((pc) => pc.role === 'crossover'));
  const lotM2 = G.polygonArea(p.site.lot.boundary) / 1e6;
  assert.ok(g.bodyM2 < lotM2);
  // a point dragged far outside is pulled back to the boundary
  const m = P.snapWayPoint(p, { x: -5000, y: 15000 }, { mmPerPx: 10, alt: true });
  assert.ok(m.x >= 0);
});

// Join, split and edit ----------------------------------------------------------------------------------------------------------------
test('split makes two ways that share the corner, and join puts them back as one', () => {
  const p = lotProject(40000, 60000);
  const w = P.addWay(p, { kind: 'road', material: 'gravel', widthMm: 5000, radiusMm: 0, pts: [{ x: 5000, y: 5000 }, { x: 5000, y: 20000 }, { x: 20000, y: 20000 }, { x: 20000, y: 40000 }] });
  const [a, b] = P.splitWay(p, w.id, 2);
  assert.equal(a.pts.length, 3);
  assert.equal(b.pts.length, 2);
  assert.deepEqual(a.pts.at(-1), b.pts[0]);
  P.updateWay(p, b.id, { material: 'asphalt', widthMm: 6000 });
  assert.equal(P.getWay(p, b.id).material, 'asphalt');
  assert.deepEqual(P.joinCandidate(p, a.id) && P.joinCandidate(p, a.id).other, b.id);
  const j = P.joinWays(p, a.id, b.id);
  assert.equal(j.pts.length, 4);
  assert.equal(P.getWays(p).length, 1);
  assert.deepEqual(j.pts.map((q) => [q.x, q.y]), [[5000, 5000], [5000, 20000], [20000, 20000], [20000, 40000]]);
});

test('join works end to end whichever way round the ways were drawn, keeps the kerb end first, and refuses two kerb ends', () => {
  const p = lotProject(40000, 60000);
  const k = P.addWay(p, { kind: 'road', widthMm: 5000, kerbEdge: 0, pts: [{ x: 10000, y: kerbY(p) }, { x: 10000, y: 15000 }] });
  const far = P.addWay(p, { kind: 'road', widthMm: 5000, pts: [{ x: 10000, y: 40000 }, { x: 10000, y: 15000 }] }); // drawn towards the kerb path
  const j = P.joinWays(p, far.id, k.id);
  assert.equal(P.getWays(p).length, 1);
  assert.equal(j.kerbEdge, 0);
  assert.equal(j.pts[0].y, kerbY(p), 'kerb end first');
  assert.equal(j.pts.at(-1).y, 40000);
  const k2 = P.addWay(p, { kind: 'road', widthMm: 5000, kerbEdge: 0, pts: [{ x: 20000, y: kerbY(p) }, { x: 20000, y: 15000 }] });
  const k3 = P.addWay(p, { kind: 'road', widthMm: 5000, kerbEdge: 0, pts: [{ x: 30000, y: kerbY(p) }, { x: 20000, y: 15000 }] });
  assert.throws(() => P.joinWays(p, k2.id, k3.id), /kerb/);
  assert.throws(() => P.joinWays(p, j.id, k2.id), /not touching/);
});

test('add, move and remove corners; a way keeps at least two points', () => {
  const p = lotProject();
  const w = P.addWay(p, { kind: 'road', widthMm: 4000, pts: [{ x: 3000, y: 5000 }, { x: 3000, y: 20000 }] });
  P.insertVertex(p, w.id, 0, { x: 5000, y: 12000 });
  assert.equal(P.getWay(p, w.id).pts.length, 3);
  P.moveVertex(p, w.id, 1, { x: 6000, y: 13000 });
  assert.deepEqual(P.getWay(p, w.id).pts[1], { x: 6000, y: 13000 });
  P.removeVertex(p, w.id, 1);
  assert.throws(() => P.removeVertex(p, w.id, 0), /at least two/);
  P.removeWay(p, w.id);
  assert.equal(P.getWays(p).length, 0);
  assert.equal(p.site.paved, undefined);
});

// Materials -------------------------------------------------------------------------------------------------------------------------
test('four materials, each with its own plan hatch and 3D surface', () => {
  const types = P.MATERIAL_IDS.map((m) => pavementById(P.MATERIALS[m].type));
  assert.equal(P.MATERIAL_IDS.length, 4);
  assert.deepEqual(P.MATERIAL_IDS, ['concrete', 'asphalt', 'gravel', 'pavers']);
  assert.equal(new Set(types.map((t) => t.hatch2d.pattern)).size, 4, 'four different plan hatches');
  assert.equal(new Set(types.map((t) => t.texture3d.kind)).size, 4, 'four different 3D surfaces');
  assert.equal(new Set(types.map((t) => t.texture3d.base)).size, 4);
  // 2D: the hatch is drawn, and differs, for each material
  const sq = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }];
  const calls = {};
  for (const m of P.MATERIAL_IDS) {
    const log = [];
    const ctx = new Proxy({}, { get: (_, k) => (k in { fillStyle: 1, strokeStyle: 1 } ? undefined : (...a) => { log.push(k); return undefined; }), set: () => true });
    drawPavementArea(ctx, sq, P.MATERIALS[m].type, 0.02);
    calls[m] = log.join(',');
    assert.ok(log.includes('fill') && (log.includes('stroke') || log.includes('arc')), `${m} draws a hatch`);
  }
  assert.equal(new Set(Object.values(calls)).size >= 3, true, 'the drawing calls differ between hatches');
  assert.equal(P.defaultMaterial(lotProject(), 'driveway'), 'concrete');
  assert.equal(P.defaultMaterial(lotProject(), 'road'), 'asphalt');
  assert.equal(P.defaultMaterial(lotProject(100000, 100000), 'driveway'), 'gravel', 'a rural lot defaults to gravel');
});

test('3D: each material becomes its own surface, draped on small triangles, with an edge line', () => {
  const p = lotProject(40000, 60000);
  P.addWay(p, { kind: 'road', material: 'gravel', widthMm: 5000, radiusMm: 6000, kerbEdge: 0, pts: [{ x: 10000, y: kerbY(p) }, { x: 10000, y: 25000 }, { x: 25000, y: 40000 }] });
  P.addWay(p, { kind: 'driveway', material: 'pavers', widthMm: 3500, pts: [{ x: 30000, y: 10000 }, { x: 30000, y: 30000 }] });
  P.addWay(p, { kind: 'driveway', material: 'asphalt', widthMm: 3500, pts: [{ x: 36000, y: 10000 }, { x: 36000, y: 30000 }] });
  const r = addDrawnWays(p, () => 0);
  assert.ok(r?.mesh);
  assert.deepEqual(Object.keys(r.stats.byMaterial).sort(), ['asphalt', 'gravel', 'pavers']);
  assert.ok(r.stats.triangles > 80, `triangles ${r.stats.triangles}`);
  const mats = [].concat(r.mesh.material);
  const colours = new Set(mats.map((m) => m.color.getHexString()));
  assert.ok(colours.size >= 4, 'gravel, pavers, asphalt and the edge line each have their own material');
  // every vertex is on the lifted ground (sharp, no sinking into the aerial)
  const pos = r.mesh.geometry.attributes.position;
  for (let i = 0; i < pos.count; i += 17) assert.ok(Math.abs(pos.getY(i) - 0.075) < 1e-6);
  assert.equal(r.centres.length, 3);
});

// The automatic driveway stands aside ------------------------------------------------------------------------------------------------------
test('a drawn driveway stands in for the automatic one, the auto router can still ask for its own', () => {
  const p = lotProject();
  const auto = L.deriveDriveway(p);
  assert.equal(auto.manual, undefined);
  assert.equal(P.drivewayIsDrawn(p), false);
  const door = L.garageDoor(p);
  const w = P.addWay(p, { kind: 'driveway', material: 'pavers', widthMm: 4000, radiusMm: 3000, kerbEdge: 0, pts: [{ x: door.mid.x, y: kerbY(p) }, { x: door.mid.x, y: door.mid.y - 400 }, door.mid] });
  assert.equal(P.drivewayIsDrawn(p), true);
  const d = L.deriveDriveway(p);
  assert.equal(d.ok, true);
  assert.equal(d.manual, true);
  assert.equal(d.material, 'pavers');
  assert.equal(d.widthMm, 4000);
  assert.ok(d.crossover.polygon.length >= 4);
  assert.ok(d.lengthMm > 4000);
  const own = L.deriveDriveway(p, { ignoreManual: true });
  assert.equal(own.manual, undefined, 'ignoreManual gives the automatic driveway');
  assert.equal(own.edited, false);
  assert.equal(P.getWays(p)[0].id, w.id);
  // a drawn road is not a driveway
  const q = lotProject();
  P.addWay(q, { kind: 'road', widthMm: 5000, kerbEdge: 0, pts: [{ x: 3000, y: kerbY(q) }, { x: 3000, y: 20000 }] });
  assert.equal(L.deriveDriveway(q).manual, undefined);
});

// Area flows to feasibility, the plan set and the commercial quantities -------------------------------------------------------------------------
test('area by material reaches the residential check and the open space figure', () => {
  const p = lotProject(40000, 60000);
  const before = checkSummary(p);
  P.addWay(p, { kind: 'road', material: 'gravel', widthMm: 5000, radiusMm: 0, pts: [{ x: 4000, y: 4000 }, { x: 4000, y: 44000 }] });
  P.addWay(p, { kind: 'driveway', material: 'concrete', widthMm: 3500, radiusMm: 0, pts: [{ x: 30000, y: 4000 }, { x: 30000, y: 24000 }] });
  const sum = P.pavedSummary(p);
  assert.deepEqual(sum.byMaterial.map((e) => e.material), ['concrete', 'gravel']);
  assert.ok(Math.abs(sum.byMaterial.find((e) => e.material === 'gravel').areaM2 - 200) < 1);
  assert.ok(Math.abs(sum.byMaterial.find((e) => e.material === 'concrete').areaM2 - 70) < 1);
  const after = checkSummary(p);
  assert.ok(Math.abs(before.openSpaceM2 - after.openSpaceM2 - 270) < 1.5, `open space ${before.openSpaceM2} to ${after.openSpaceM2}`);
  assert.deepEqual(after.pavedByMaterial.map((e) => e.material), ['concrete', 'gravel']);
  assert.ok(after.lines.some((l) => /Drawn paving: concrete 70 m2, gravel 200 m2/.test(l)), after.lines.join(' | '));
});

test('the plan set carries the drawn pavement by material in its schedule', async () => {
  const p = lotProject(20000, 40000);
  P.addWay(p, { kind: 'road', material: 'gravel', widthMm: 5000, radiusMm: 0, pts: [{ x: 3000, y: 20000 }, { x: 3000, y: 36000 }] });
  P.addWay(p, { kind: 'driveway', material: 'pavers', widthMm: 3500, kerbEdge: 0, pts: [{ x: 15000, y: kerbY(p) }, { x: 15000, y: 14000 }] });
  const texts = [];
  class Rec extends jsPDF {
    constructor(...a) { super(...a); const t = this.text.bind(this); this.text = (s, ...r) => (texts.push(Array.isArray(s) ? s.join(' ') : String(s)), t(s, ...r)); }
  }
  const r = await exportPlanSet({ project: p, kind: 'site', download: false, jsPDF: Rec, catalogue, date: new Date(2026, 10, 12) });
  assert.ok(r.pages >= 2);
  const text = texts.join('\n');
  assert.match(text, /Gravel paving, \d+ m/, 'legend by material with the area');
  assert.match(text, /Pavers paving, \d+ m/);
  assert.match(text, /PAVERS DRIVEWAY/, 'plan label');
  assert.ok(!/compliant/i.test(text));
});

test('commercial: a drawn way is mirrored as hardstand, so quantities and developed area pick it up, and it is removed with the way', () => {
  const p = commercialProject();
  const dev0 = developedAreaM2(p.commercial, p.site.lot);
  const w = P.addWay(p, { kind: 'road', material: 'gravel', widthMm: 6000, radiusMm: 0, kerbEdge: 0, pts: [{ x: 5000, y: kerbY(p) }, { x: 5000, y: 90000 }] });
  const mirrors = p.commercial.pavements.filter((o) => o.way === w.id);
  assert.ok(mirrors.length >= 2, 'body and crossover');
  assert.ok(mirrors.every((o) => o.type === 'gravel-yard' && o.id.startsWith('hs_w')));
  const model = pavementModel(p.commercial, p.site.lot);
  const gravel = model.quantities.byType.find((e) => e.type === 'gravel-yard');
  assert.ok(gravel && gravel.areaM2 > 400, `gravel ${gravel?.areaM2}`);
  assert.ok(developedAreaM2(p.commercial, p.site.lot) > dev0 + 300);
  P.removeWay(p, w.id);
  assert.equal(p.commercial.pavements.filter((o) => o.way).length, 0);
  assert.ok(Math.abs(developedAreaM2(p.commercial, p.site.lot) - dev0) < 5);
});

// The controller: draw, undo, Escape, Enter ------------------------------------------------------------------------------------------------------
test('controller: click points, Enter finishes as one undo step, Escape cancels, undo removes it', () => {
  const p = lotProject();
  const store = createStore(p, { autosave: false });
  const msgs = [];
  const ctl = createPaveController({ store, scale: () => 0.1, toast: (m) => msgs.push(m) });
  setPaveState({ kind: 'driveway', mode: 'draw', material: 'asphalt', selected: null });
  const R = (y) => ({ x: 6500, y });
  ctl.pointerDown(R(-2000), {});
  ctl.pointerDown(R(9000), {});
  assert.equal(ctl.draftPoints.length, 2);
  assert.ok(ctl.draft().readout.includes('Asphalt'), ctl.draft().readout);
  assert.ok(/m long/.test(ctl.draft().readout), 'live length');
  assert.ok(/m2/.test(ctl.draft().readout), 'live area');
  ctl.keyDown({ key: 'Escape' });
  assert.equal(ctl.draftPoints.length, 0);
  assert.equal(store.project.site.paved, undefined);
  ctl.pointerDown(R(-2000), {});
  ctl.pointerDown(R(9000), {});
  ctl.keyDown({ key: ']' });
  ctl.keyDown({ key: 'Enter' });
  assert.equal(store.project.site.paved.length, 1);
  assert.equal(store.project.site.paved[0].material, 'asphalt');
  assert.equal(store.project.site.paved[0].kerbEdge, 0);
  assert.ok(msgs.some((m) => /replaces the automatic driveway/.test(m)));
  assert.equal(paveState.mode, 'edit');
  assert.equal(paveState.selected, store.project.site.paved[0].id);
  ctl.setWidth(5000);
  assert.equal(store.project.site.paved[0].widthMm, 5000);
  store.undo();
  assert.equal(store.project.site.paved[0].widthMm, 3750, 'the width it was drawn at');
  store.undo();
  assert.equal(store.project.site.paved, undefined, 'one undo removes the whole way');
  setPaveState({ mode: 'draw', selected: null });
});
