// The automatic car park generator, checked on three lots (small, deep and narrow, large) from the generated polygons only:
// one connected sealed network from the street crossover to every building door, no paving or bay outside the lot or over a building,
// bay counts against the indicative rate, accessible bays with a shared zone near the entry, and a rebuild when a building is moved.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/model/geometry.js';
import { createStore } from '../src/model/store.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { chooseBuilding, polysOverlap } from '../src/commercial/catalogue/fit.js';
import { applyBuildingChoice, moveBuilding } from '../src/commercial/catalogue/ops.js';
import { buildingsOf } from '../src/commercial/catalogue/buildings.js';
import { typeById } from '../src/commercial/catalogue/types/index.js';
import { AISLE_MM } from '../src/commercial/sitelayout.js';

const LOTS = [
  { name: 'small', width: 40000, depth: 60000, type: 'office' },
  { name: 'deep narrow', width: 30000, depth: 120000, type: 'warehouse' },
  { name: 'large', width: 100000, depth: 140000, type: 'warehouse' },
];
const SQ = 5000; // mm of slack for rounding in the polygon tests

function lotSite({ width, depth, type }) {
  const store = createStore(commercialProject({ width, depth, rows: 'none', plain: false }));
  if (type && typeById(type)) applyBuildingChoice(store, chooseBuilding(store.project, type));
  return store;
}
const shrink = (poly, k) => { const c = poly.reduce((s, q) => ({ x: s.x + q.x / poly.length, y: s.y + q.y / poly.length }), { x: 0, y: 0 }); return poly.map((q) => ({ x: c.x + (q.x - c.x) * k, y: c.y + (q.y - c.y) * k })); };
const segDist = (p, a, b) => { const dx = b.x - a.x; const dy = b.y - a.y; const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); };
const distToPoly = (pt, poly) => (G.pointInPolygon(pt, poly) ? 0 : Math.min(...poly.map((a, i) => segDist(pt, a, poly[(i + 1) % poly.length]))));
const insideLot = (pt, lot) => G.pointInPolygon(pt, lot) || distToPoly(pt, lot) <= SQ;
const doorPoint = (b) => { const xs = b.local.outline.map((q) => q.x); const ys = b.local.outline.map((q) => q.y); const l = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.min(...ys) - 1000 }; const a = (b.place.rotationDeg * Math.PI) / 180; return { x: b.place.x + Math.cos(a) * l.x - Math.sin(a) * l.y, y: b.place.y + Math.sin(a) * l.x + Math.cos(a) * l.y }; };
const allBays = (sw) => sw.bayRows.flatMap((r) => r.slots.map((s) => ({ ...s, row: r })));
const sealed = (sw) => [...sw.crossovers.map((x) => ({ poly: x.polygon, root: true })), ...sw.pavedAisles.map((a) => ({ poly: a.polygon })), ...sw.forecourts.map((a) => ({ poly: a.polygon })), ...sw.aprons.map((a) => ({ poly: a.polygon }))];

/** Indices of the sealed polygons reachable from a crossover through touching polygons (grown 200 mm so abutting rectangles join). */
function reach(nodes) {
  const grow = (poly) => { const c = poly.reduce((s, q) => ({ x: s.x + q.x / poly.length, y: s.y + q.y / poly.length }), { x: 0, y: 0 }); return poly.map((q) => ({ x: q.x + Math.sign(q.x - c.x) * 200, y: q.y + Math.sign(q.y - c.y) * 200 })); };
  const seen = new Set(nodes.map((n, i) => (n.root ? i : -1)).filter((i) => i >= 0));
  let grew = true;
  while (grew) { grew = false; nodes.forEach((n, i) => { if (seen.has(i)) return; for (const j of seen) if (polysOverlap(grow(n.poly), grow(nodes[j].poly))) { seen.add(i); grew = true; return; } }); }
  return seen;
}

for (const lotSpec of LOTS) {
  test(`car park generator, ${lotSpec.name} lot: one connected network reaching the crossover and every building door`, () => {
    const store = lotSite(lotSpec);
    const c = store.project.commercial; const sw = c.siteWorks;
    assert.ok(sw && sw.crossovers.length >= 1, 'a crossover at the lot frontage');
    const nodes = sealed(sw); const seen = reach(nodes);
    nodes.forEach((n, i) => assert.ok(seen.has(i), `${lotSpec.name}: sealed area ${i} is cut off from the crossover`));
    const net = [...seen].map((i) => nodes[i].poly);
    // A door is reached by the sealed network, or on foot across the bay row and footpath that front it (every bay opens onto a network aisle, see below).
    const foot = [...sw.footpaths.map((f) => f.polygon), ...sw.bayRows.flatMap((r) => r.bayAreas.map((a) => a.polygon))];
    for (const b of buildingsOf(c)) {
      assert.ok(net.some((p) => distToPoly(doorPoint(b), p) <= 4000) || foot.some((p) => distToPoly(doorPoint(b), p) <= 1500), `${lotSpec.name}: the door of ${b.label} is not reached`);
    }
    // The crossover sits on the frontage edge of the lot.
    const lot = store.project.site.lot;
    const front = lot.boundary[lot.frontEdges[0]]; const front2 = lot.boundary[(lot.frontEdges[0] + 1) % lot.boundary.length];
    for (const x of sw.crossovers) assert.ok(x.polygon.some((q) => segDist(q, front, front2) < 1500), `${lotSpec.name}: a crossover is off the frontage`);
    // Aisles are at least 5.8 m wide (two way).
    assert.ok(sw.aisles.length >= 1);
    for (const a of sw.aisles) { const [p0, p1, , p3] = a.polygon; const w = Math.min(Math.hypot(p1.x - p0.x, p1.y - p0.y), Math.hypot(p3.x - p0.x, p3.y - p0.y)); assert.ok(a.widthMm >= 5800 && w >= 5800 - 5, `${lotSpec.name}: an aisle is ${Math.round(w)} mm wide (stated ${a.widthMm})`); }
    assert.ok(AISLE_MM >= 5800);
  });

  test(`car park generator, ${lotSpec.name} lot: nothing outside the lot or over a building, bays do not overlap`, () => {
    const store = lotSite(lotSpec);
    const c = store.project.commercial; const sw = c.siteWorks;
    const lot = store.project.site.lot.boundary;
    const bs = buildingsOf(c);
    const polys = [...sw.pavedAisles.map((a) => a.polygon), ...allBays(sw).map((b) => b.poly), ...sw.bayRows.flatMap((r) => r.bayAreas.map((a) => a.polygon))];
    assert.ok(polys.length > 0);
    for (const p of polys) {
      for (const q of p) assert.ok(insideLot(q, lot), `${lotSpec.name}: a corner is outside the lot`);
      for (const b of bs) assert.ok(!polysOverlap(shrink(p, 0.97), shrink(b.outline, 0.99)), `${lotSpec.name}: paving over ${b.label}`);
    }
    const bays = allBays(sw);
    for (let i = 0; i < bays.length; i++) for (let j = i + 1; j < bays.length; j++) assert.ok(!polysOverlap(shrink(bays[i].poly, 0.9), shrink(bays[j].poly, 0.9)), `${lotSpec.name}: two bays overlap`);
    for (const b of bays) for (const a of sw.pavedAisles) assert.ok(!polysOverlap(shrink(b.poly, 0.95), shrink(a.polygon, 0.98)), `${lotSpec.name}: a bay is over an aisle`);
  });

  test(`car park generator, ${lotSpec.name} lot: bay counts follow the rate, accessible bays have a shared zone and sit near the entry`, () => {
    const store = lotSite(lotSpec);
    const c = store.project.commercial; const sw = c.siteWorks;
    const s = sw.summary;
    const bays = allBays(sw);
    const usable = bays.filter((b) => b.kind !== 'zone').length;
    assert.equal(s.provided, usable, `${lotSpec.name}: summary matches the drawn bays`);
    assert.ok(s.required > 0, 'the rate asks for bays');
    if (!s.limited) assert.ok(s.provided >= s.required, `${lotSpec.name}: ${s.provided} bays for ${s.required} required`);
    else assert.ok(s.provided > 0, `${lotSpec.name}: a limited lot still gets bays`);
    assert.ok(s.provided <= Math.ceil(s.required * 1.6) + 12, `${lotSpec.name}: ${s.provided} bays is far over the ${s.required} required`);
    const acc = bays.filter((b) => b.kind === 'accessible');
    assert.equal(acc.length, s.accessibleProvided, 'accessible count matches the summary');
    assert.ok(acc.length >= 1, `${lotSpec.name}: at least one accessible bay`);
    for (const a of acc) {
      const r = a.row; const i = r.slots.indexOf(r.slots.find((x) => x.index === a.index));
      assert.ok([r.slots[i - 1], r.slots[i + 1]].some((x) => x?.kind === 'zone'), `${lotSpec.name}: an accessible bay has no shared zone beside it`);
    }
    const [b] = buildingsOf(c); const d = doorPoint(b);
    const dist = (p) => Math.hypot(p.centre.x - d.x, p.centre.y - d.y);
    const nearestAcc = Math.min(...acc.map(dist));
    const median = bays.map(dist).sort((p, q) => p - q)[Math.floor(bays.length / 2)];
    assert.ok(nearestAcc <= median, `${lotSpec.name}: the accessible bay (${Math.round(nearestAcc)}) is not in the nearer half of the bays (median ${Math.round(median)})`);
  });
}

test('car park generator: bays are 90 degree and square, and every bay opens onto an aisle', () => {
  const store = lotSite(LOTS[2]); const sw = store.project.commercial.siteWorks;
  for (const b of allBays(sw)) {
    const [p0, p1, p2, p3] = b.poly;
    assert.ok(Math.abs((p1.x - p0.x) * (p3.x - p0.x) + (p1.y - p0.y) * (p3.y - p0.y)) < 5e4, 'a bay is not square cornered');
    const m = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }; const L = Math.hypot(p0.x - p3.x, p0.y - p3.y);
    const out = { x: m.x + ((p0.x - p3.x) / L) * 300, y: m.y + ((p0.y - p3.y) / L) * 300 };
    assert.ok(sw.pavedAisles.some((a) => G.pointInPolygon(out, a.polygon)), 'a bay does not open onto an aisle');
  }
});

test('car park generator: moving a building rebuilds the layout, still connected, inside the lot and clear of the building', () => {
  const store = lotSite(LOTS[2]);
  const b0 = buildingsOf(store.project.commercial)[0];
  const before = JSON.stringify(store.project.commercial.siteWorks.pavedAisles.map((a) => a.polygon));
  moveBuilding(store, b0.id, { x: b0.place.x + 10000, y: b0.place.y - 20000, rotationDeg: b0.place.rotationDeg || 0 });
  const c = store.project.commercial; const sw = c.siteWorks;
  assert.notEqual(JSON.stringify(sw.pavedAisles.map((a) => a.polygon)), before, 'the layout changed with the building');
  const nodes = sealed(sw); const seen = reach(nodes);
  nodes.forEach((n, i) => assert.ok(seen.has(i), 'every sealed area is still joined to the crossover'));
  const lot = store.project.site.lot.boundary;
  const b = buildingsOf(c)[0];
  for (const bay of allBays(sw)) {
    for (const q of bay.poly) assert.ok(insideLot(q, lot), 'a bay corner is outside the lot after the move');
    assert.ok(!polysOverlap(shrink(bay.poly, 0.97), shrink(b.outline, 0.99)), 'a bay is over the moved building');
  }
  assert.ok([...seen].map((i) => nodes[i].poly).some((p) => distToPoly(doorPoint(b), p) <= 4000), 'the moved door is on the network');
});

test('car park generator: the car park meets the lot frontage at a crossover, with no dependency on the road tool', () => {
  const store = lotSite(LOTS[0]);
  const sw = store.project.commercial.siteWorks;
  assert.ok(sw.crossovers.length >= 1);
  assert.ok(sw.pavedAisles.length >= 1 && !JSON.stringify(sw).includes('roadId'), 'the layout stores no road tool reference');
});
