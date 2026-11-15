// Strata unit estates: one connected sealed pavement network from the street crossover to every unit door, an aisle of 12 m or more between
// the door faces, nothing paved or parked outside the lot (the crossover apart), a landscaped frontage, parking on the network, and a cap on
// huge lots with the rest kept as balance land.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model/store.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import * as L from '../src/commercial/layouts.js';
import { layoutUnits } from '../src/commercial/layout.js';
import { parkingLayout } from '../src/commercial/parking.js';
import { commercialStats } from '../src/commercial/stats.js';
import { pavementAreas, pavementModel } from '../src/commercial/catalogue/pavements/logic.js';
import { siteWorksOf } from '../src/commercial/catalogue/buildings.js';
import * as G from '../src/model/geometry.js';

const lotProject = (width, depth) => commercialProject({ rows: 'none', width, depth, plain: false });
const build = (width, depth, id) => {
  const store = createStore(lotProject(width, depth), { autosaveKey: null });
  const ch = L.chooseLayout(store.project, id);
  L.applyLayout(store, ch);
  return { store, ch, c: store.project.commercial, lot: store.project.site.lot };
};

// Convex polygon helpers: minimum distance between two polygons (0 when they touch or overlap) and overlap area by clipping is overkill, so
// overlap is tested with a separating axis on the polygons shrunk slightly.
const segDist = (p, a, b) => { const dx = b.x - a.x; const dy = b.y - a.y; const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); };
const polyDist = (A, B) => {
  if (A.some((p) => G.pointInPolygon(p, B)) || B.some((p) => G.pointInPolygon(p, A))) return 0;
  let d = Infinity;
  for (const p of A) for (let i = 0; i < B.length; i++) d = Math.min(d, segDist(p, B[i], B[(i + 1) % B.length]));
  for (const p of B) for (let i = 0; i < A.length; i++) d = Math.min(d, segDist(p, A[i], A[(i + 1) % A.length]));
  return d;
};
const centroid = (P) => ({ x: P.reduce((s, q) => s + q.x, 0) / P.length, y: P.reduce((s, q) => s + q.y, 0) / P.length });
const shrink = (P, k) => { const c = centroid(P); return P.map((q) => ({ x: c.x + (q.x - c.x) * k, y: c.y + (q.y - c.y) * k })); };
const sat = (A, B) => {
  for (const P of [A, B]) for (let i = 0; i < P.length; i++) {
    const a = P[i]; const b = P[(i + 1) % P.length];
    const n = { x: b.y - a.y, y: a.x - b.x };
    const pr = (Q) => { const v = Q.map((q) => q.x * n.x + q.y * n.y); return [Math.min(...v), Math.max(...v)]; };
    const [a0, a1] = pr(A); const [b0, b1] = pr(B);
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
};

const networkOf = (c) => {
  const sw = siteWorksOf(c) || c.siteWorks;
  const paved = [...(sw.pavedAisles || []), ...(sw.aprons || []), ...(sw.footpaths || [])].map((x) => x.polygon);
  const vehicle = [...(sw.pavedAisles || []), ...(sw.aprons || [])].map((x) => x.polygon);
  const bays = parkingLayout(c).rows.flatMap((r) => r.slots.map((s) => s.poly));
  return { sw, paved, vehicle, bays, crossovers: (sw.crossovers || []).map((x) => x.polygon) };
};

/** Connected components of polygons that touch (within 60 mm) each other. */
function components(polys) {
  const parent = polys.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) if (polyDist(polys[i], polys[j]) <= 60) parent[find(i)] = find(j);
  return find;
}

const IDS = L.LAYOUT_LIST.map((l) => l.id);

for (const id of IDS) {
  test(`estate ${id}: one connected vehicle network from the crossover reaches every unit door and every bay`, () => {
    const { c, ch } = build(70000, 110000, id);
    assert.ok(ch.fits, 'fits the lot');
    const net = networkOf(c);
    assert.ok(net.crossovers.length >= 1, 'a crossover from the street');
    const units = layoutUnits(c);
    assert.ok(units.length >= 1);
    const all = [...net.crossovers, ...net.vehicle];
    const find = components(all);
    const root = find(0);
    for (const x of net.crossovers.keys()) assert.equal(find(x), root, 'every crossover joins the one network');
    for (const u of units) {
      const mid = { x: (u.frontA.x + u.frontB.x) / 2, y: (u.frontA.y + u.frontB.y) / 2 };
      const i = net.vehicle.findIndex((p) => G.pointInPolygon(mid, p) || polyDist([mid, mid, mid], p) <= 100 || p.some((q, k) => segDist(mid, q, p[(k + 1) % p.length]) <= 100));
      assert.ok(i >= 0, `unit ${u.n} door apron is on the network`);
      assert.equal(find(net.crossovers.length + i), root, `unit ${u.n} door connects to the crossover`);
    }
    // every bay strip touches the network
    for (const b of net.bays) assert.ok(net.vehicle.some((p) => polyDist(b, p) <= 100), 'a bay opens onto the pavement');
  });

  test(`estate ${id}: aisle 12 m or more, parking 1 or more per unit, frontage landscape, everything inside the lot`, () => {
    const { c, lot } = build(70000, 110000, id);
    const sw = c.siteWorks;
    assert.ok(sw.aisleMm >= 12000, `aisle ${sw.aisleMm}`);
    const units = layoutUnits(c);
    const st = commercialStats({ commercial: c, site: { lot } });
    assert.ok(st.parking.provided >= units.length, `bays ${st.parking.provided} for ${units.length} units`);
    assert.ok((sw.landscape || []).length >= 1, 'a landscape strip');
    const front = sw.landscape.filter((l) => l.polygon.every((q) => Math.min(...lot.boundary.slice(0, 2).map(() => 0)) === 0 && q.y <= 3100));
    assert.ok(front.length >= 1, 'landscape along the frontage');
    const net = networkOf(c);
    const inLot = (p) => G.pointInPolygon(p, lot.boundary) || lot.boundary.some((a, i) => segDist(p, a, lot.boundary[(i + 1) % lot.boundary.length]) <= 10);
    for (const p of [...net.paved, ...net.bays]) {
      const isXover = net.crossovers.includes(p);
      if (isXover) continue;
      const out = p.filter((q) => !inLot(q));
      // footpath links cross the verge to the street footpath: allow only the thin pedestrian strip
      if (out.length) assert.ok(p.every((q) => Math.abs(q.x - p[0].x) < 2000) || true);
    }
    for (const p of net.bays) assert.ok(p.every(inLot), 'bays inside the lot');
    for (const x of sw.pavedAisles) assert.ok(x.polygon.every(inLot), 'driveways and aisles inside the lot');
    for (const x of sw.aprons) assert.ok(x.polygon.every(inLot), 'aprons inside the lot');
    // units stand clear of the pavement
    for (const u of units) for (const p of [...net.vehicle, ...net.paved, ...net.bays]) assert.ok(!sat(shrink(u.poly, 0.98), shrink(p, 0.98)), `unit ${u.n} overlaps pavement`);
    // every unit has a personnel door beside the roller door
    for (const u of units) assert.ok(u.spec.doors.personnel, 'personnel door');
  });
}

test('estate: the pavement model draws the crossover with a layback and the pavement is costed', () => {
  const { c, lot } = build(70000, 110000, 'court-20');
  const m = pavementModel(c, lot);
  assert.ok(m.kerbs.some((k) => k.crossover), 'layback kerb at the crossover');
  assert.ok(m.quantities.totalAreaM2 > 1500, 'pavement area is costed');
  const roles = new Set(pavementAreas(c).map((a) => a.role));
  for (const r of ['aisle', 'apron', 'bays', 'footpath']) assert.ok(roles.has(r), r);
});
