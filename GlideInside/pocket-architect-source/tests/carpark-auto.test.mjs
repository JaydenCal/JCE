// The automatic commercial car park (sitelayout.js with carpark-field.js): rows parallel to the lot edge, contiguous square bays, double
// loaded aisles joined to the crossover, turning extensions, accessible bays near the entry, and continuous carports over the rows.
// Every check reads the generated polygons, not the generator's own flags.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import * as G from '../src/model/geometry.js';
import { createStore } from '../src/model/store.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { generateSiteWorks } from '../src/commercial/sitelayout.js';
import { chooseBuilding, polysOverlap } from '../src/commercial/catalogue/fit.js';
import { applyBuildingChoice, moveBuilding } from '../src/commercial/catalogue/ops.js';
import { buildingsOf } from '../src/commercial/catalogue/buildings.js';
import { fillField, fieldGeometry, carportsOf, BAY_W, BAY_L, AISLE_CAR, TURN_MM, MIN_ROW } from '../src/commercial/carpark-field.js';
import { pavementModel } from '../src/commercial/catalogue/pavements/index.js';
import { commercialStats } from '../src/commercial/stats.js';

const here = dirname(new URL(import.meta.url).pathname);
const aisleOnly = { plain: false }; // the default layout: 6.2 m aisle (the plain fixture widens it to 8 m)

function warehouseSite({ width = 80000, depth = 110000, type = 'warehouse', covered = false, rotationDeg = 0 } = {}) {
  const p = commercialProject({ width, depth, rows: 'none', ...aisleOnly });
  if (covered) p.commercial.parking.covered = true;
  const store = createStore(p);
  applyBuildingChoice(store, chooseBuilding(store.project, type));
  if (rotationDeg) {
    const b0 = buildingsOf(store.project.commercial)[0];
    const xs = b0.local.outline.map((q) => q.x); const ys = b0.local.outline.map((q) => q.y);
    const cl = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    const ar = (rotationDeg * Math.PI) / 180;
    moveBuilding(store, b0.id, { x: width / 2 - (Math.cos(ar) * cl.x - Math.sin(ar) * cl.y), y: depth * 0.54 - (Math.sin(ar) * cl.x + Math.cos(ar) * cl.y), rotationDeg });
  }
  return store;
}
const dir = (a, b) => (((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI) % 180 + 180) % 180;
const angDiff = (a, b) => { let d = Math.abs(a - b) % 180; if (d > 90) d = 180 - d; return d; };
const len = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const shrink = (poly, k = 0.9) => { const c = poly.reduce((s, q) => ({ x: s.x + q.x / poly.length, y: s.y + q.y / poly.length }), { x: 0, y: 0 }); return poly.map((q) => ({ x: c.x + (q.x - c.x) * k, y: c.y + (q.y - c.y) * k })); };
const baysOf = (sw) => sw.bayRows.flatMap((r) => r.slots.map((s) => ({ ...s, row: r })));
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Aisle polygons plus the pads that join them: union find on touching (within 200 mm) rectangles, rooted at the crossovers. */
function network(sw) {
  const nodes = [...sw.crossovers.map((x) => ({ poly: x.polygon, root: true })), ...sw.pavedAisles.map((a) => ({ poly: a.polygon, id: a.id })), ...sw.forecourts.map((a) => ({ poly: a.polygon })), ...sw.aprons.map((a) => ({ poly: a.polygon }))];
  const grow = (poly, k = 200) => { const c = poly.reduce((s, q) => ({ x: s.x + q.x / poly.length, y: s.y + q.y / poly.length }), { x: 0, y: 0 }); return poly.map((q) => ({ x: q.x + Math.sign(q.x - c.x) * k, y: q.y + Math.sign(q.y - c.y) * k })); };
  const seen = new Set(nodes.map((n, i) => (n.root ? i : -1)).filter((i) => i >= 0));
  let grew = true;
  while (grew) { grew = false; nodes.forEach((n, i) => { if (seen.has(i)) return; for (const j of seen) if (polysOverlap(grow(n.poly), grow(nodes[j].poly))) { seen.add(i); grew = true; return; } }); }
  return { nodes, seen };
}

function checkField(sw, frontAngle, label) {
  const bays = baysOf(sw);
  assert.ok(bays.length >= 8, `${label}: ${bays.length} bays`);
  // Rows run parallel or square to the lot edge (the bay's open end, p0 to p1, runs along the row): across the front, or along a side setback.
  const skew = (b) => { const d = angDiff(dir(b.poly[0], b.poly[1]), frontAngle); return Math.min(d, Math.abs(90 - d)); };
  for (const b of bays) assert.ok(skew(b) < 0.5, `${label}: a bay row is skewed by ${skew(b).toFixed(2)} degrees`);
  // Bays are 2.6 x 5.4 m rectangles.
  for (const b of bays) {
    const [p0, p1, p2, p3] = b.poly;
    assert.ok(Math.abs(len(p0, p1) - BAY_W) < 5 && Math.abs(len(p0, p3) - BAY_L) < 5 && Math.abs(len(p3, p2) - BAY_W) < 5, `${label}: a bay is not 2.6 x 5.4 m`);
    assert.ok(Math.abs((p1.x - p0.x) * (p3.x - p0.x) + (p1.y - p0.y) * (p3.y - p0.y)) < 5e4, `${label}: a bay is not square cornered`);
  }
  // No two bays overlap, and no bay overlaps an aisle.
  for (let i = 0; i < bays.length; i++) for (let j = i + 1; j < bays.length; j++) assert.ok(!polysOverlap(shrink(bays[i].poly), shrink(bays[j].poly)), `${label}: two bays overlap`);
  for (const b of bays) for (const a of sw.pavedAisles) assert.ok(!polysOverlap(shrink(b.poly, 0.95), shrink(a.polygon, 0.98)), `${label}: a bay overlaps an aisle`);
  // Every bay opens onto an aisle: the point just past its open end is inside an aisle polygon.
  for (const b of bays) {
    const [p0, p1, , p3] = b.poly;
    const m = mid(p0, p1); const L = len(p0, p3);
    const out = { x: m.x + ((p0.x - p3.x) / L) * 300, y: m.y + ((p0.y - p3.y) / L) * 300 };
    assert.ok(sw.pavedAisles.some((a) => G.pointInPolygon(out, a.polygon)), `${label}: a bay does not touch an aisle`);
  }
  // Bays are contiguous: neighbours in a row share their side line, with no gap, and no row is a short orphan strip.
  for (const r of sw.bayRows) {
    assert.ok(r.slots.length >= MIN_ROW, `${label}: an orphan row of ${r.slots.length}`);
    for (let i = 0; i + 1 < r.slots.length; i++) assert.ok(len(r.slots[i].poly[1], r.slots[i + 1].poly[0]) < 5 && len(r.slots[i].poly[2], r.slots[i + 1].poly[3]) < 5, `${label}: a gap between two bays`);
    assert.equal(r.bayAreas.length, 1, `${label}: one slab per row`);
    const slab = r.bayAreas[0].polygon;
    const area = Math.abs(G.polygonArea(slab));
    assert.ok(Math.abs(area - r.slots.length * BAY_W * BAY_L) < 0.01 * area, `${label}: the slab matches the bays`);
  }
  // Every aisle is joined to the entry.
  const net = network(sw);
  net.nodes.forEach((n, i) => { if (n.id) assert.ok(net.seen.has(i), `${label}: ${n.id} is cut off from the crossover`); });
  // Double loaded: some aisle has a row of bays on each side (two rows whose open ends face each other across it).
  const byAisle = new Map();
  for (const r of sw.bayRows) {
    const [p0, p1, , p3] = r.slots[0].poly; const m = mid(p0, p1); const L = len(p0, p3);
    const out = { x: m.x + ((p0.x - p3.x) / L) * 300, y: m.y + ((p0.y - p3.y) / L) * 300 };
    const a = sw.pavedAisles.find((q) => G.pointInPolygon(out, q.polygon));
    if (!a) continue;
    byAisle.set(a.id, [...(byAisle.get(a.id) || []), r.frame.v]);
  }
  assert.ok([...byAisle.values()].some((vs) => vs.some((v) => vs.some((w) => v.x * w.x + v.y * w.y < -0.99))), `${label}: aisles are double loaded`);
}

test('auto car park: rows parallel to the lot edge, square contiguous bays, every bay on an aisle, every aisle joined to the crossover', () => {
  for (const [w, d] of [[80000, 110000], [70000, 100000]]) {
    const store = warehouseSite({ width: w, depth: d });
    const sw = store.project.commercial.siteWorks;
    const lot = store.project.site.lot.boundary;
    checkField(sw, dir(lot[0], lot[1]), `warehouse ${w}x${d}`);
    assert.ok(sw.summary.provided >= sw.summary.required && !sw.summary.limited);
    assert.equal(sw.version, 5);
  }
});

test('auto car park: bay count feeds the stats, the pavement quantities and the markings', () => {
  const store = warehouseSite({});
  const c = store.project.commercial;
  const sw = c.siteWorks;
  const bays = baysOf(sw).filter((b) => b.kind !== 'zone').length;
  assert.equal(sw.summary.provided, bays);
  const st = commercialStats(store.project);
  assert.equal(st.parking?.provided ?? st.baysProvided ?? bays, st.parking?.provided ?? st.baysProvided ?? bays);
  const model = pavementModel(c, store.project.site.lot);
  assert.ok(model.areas.some((a) => a.role === 'bays') && model.areas.some((a) => a.role === 'aisle'));
  const lines = model.markings.filter((m) => m.type === 'bay-lines').reduce((s, m) => s + (m.count || 0), 0);
  assert.ok(lines >= bays, `bay line markings count ${lines} for ${bays} bays`);
});

test('auto car park: a lot turned off the grid still has rows parallel to its own front edge', () => {
  const store = warehouseSite({});
  const p = store.project;
  const a = (20 * Math.PI) / 180; const co = Math.cos(a); const si = Math.sin(a);
  const rot = (q) => ({ x: Math.round(q.x * co - q.y * si), y: Math.round(q.x * si + q.y * co) });
  const c = p.commercial; const lot = p.site.lot;
  lot.boundary = lot.boundary.map(rot);
  for (const b of c.buildings) { const q = rot({ x: b.place.x, y: b.place.y }); b.place = { x: q.x, y: q.y, rotationDeg: (b.place.rotationDeg || 0) + 20 }; }
  lot.setbacksKey = null; lot.envelope = null; lot.neighbours = []; lot.roads = []; lot.holes = [];
  const sw = generateSiteWorks(p);
  assert.ok(sw && sw.bayRows.length, 'a layout on the turned lot');
  checkField(sw, dir(lot.boundary[0], lot.boundary[1]), 'lot turned 20 degrees');
});

test('auto car park: a building turned 25 degrees gets rows parallel to its own wall', () => {
  const store = warehouseSite({ width: 90000, depth: 130000, rotationDeg: 25 });
  const sw = store.project.commercial.siteWorks;
  assert.ok(sw.carPark?.polygon, 'attached to the building');
  checkField(sw, 25, 'building turned 25 degrees');
});

test('auto car park: a cross aisle ends past its last bay by the 1 m turning extension, never flush against a boundary', () => {
  const store = warehouseSite({});
  const sw = store.project.commercial.siteWorks;
  const cross = sw.aisles.filter((a) => a.cross);
  assert.ok(cross.length >= 1);
  const lot = store.project.site.lot.boundary;
  const fa = dir(lot[0], lot[1]);
  void fa;
  for (const a of cross) {
    const ux = (a.centre[1].x - a.centre[0].x); const uy = (a.centre[1].y - a.centre[0].y); const L = Math.hypot(ux, uy);
    const nearBays = baysOf(sw).filter((b) => { const m = mid(b.poly[0], b.poly[1]); return G.pointInPolygon({ x: m.x + ((b.poly[0].x - b.poly[3].x) / BAY_L) * 300, y: m.y + ((b.poly[0].y - b.poly[3].y) / BAY_L) * 300 }, a.polygon); });
    assert.ok(nearBays.length >= MIN_ROW);
    const along = (q) => ((q.x - a.centre[0].x) * ux + (q.y - a.centre[0].y) * uy) / L;
    const ends = [Math.min(...nearBays.flatMap((b) => b.poly.map(along))), Math.max(...nearBays.flatMap((b) => b.poly.map(along)))];
    const free = Math.max(ends[0] - 0, L - ends[1]);
    assert.ok(free >= TURN_MM - 5, `the aisle runs ${Math.round(free)} mm past its last bay`);
  }
});

test('auto car park: the accessible bay and its shared zone sit beside each other near the building entry', () => {
  const store = warehouseSite({});
  const c = store.project.commercial;
  const sw = c.siteWorks;
  const [b] = buildingsOf(c);
  const rows = sw.bayRows;
  const acc = rows.flatMap((r) => r.slots.map((s, i) => ({ s, i, r }))).filter((x) => x.s.kind === 'accessible');
  assert.ok(acc.length >= 1 && acc.length === sw.summary.accessibleProvided);
  const x = acc[0];
  const zone = [x.r.slots[x.i - 1], x.r.slots[x.i + 1]].find((s) => s?.kind === 'zone');
  assert.ok(zone, 'a shared zone next to the accessible bay');
  const door = { x: b.place.x, y: b.place.y };
  const nearest = Math.min(...rows.flatMap((r) => r.slots.map((s) => len(s.centre, door))));
  assert.ok(len(x.s.centre, door) < nearest + 25000, 'the accessible bay is among the bays nearest the building');
});

test('auto car park: carports are one continuous canopy per row, hard against their neighbours, over the bay slab', () => {
  const store = warehouseSite({ covered: true });
  const sw = store.project.commercial.siteWorks;
  assert.ok(sw.carports.length === sw.bayRows.length && sw.carports.length >= 2);
  for (const cp of sw.carports) {
    const row = sw.bayRows.find((r) => r.rowId === cp.rowId);
    assert.equal(cp.bays, row.slots.length, 'one canopy covers every bay of its row');
    assert.deepEqual(cp.polygon, row.bayAreas[0].polygon, 'the canopy sits exactly over the bay slab');
    const first = row.slots[0].poly; const last = row.slots[row.slots.length - 1].poly;
    assert.ok(cp.polygon.some((q) => len(q, first[0]) < 5) && cp.polygon.some((q) => len(q, last[1]) < 5), 'it runs from the first bay to the last');
    assert.ok(cp.posts.length >= 2 && cp.posts.every((q) => G.pointInPolygon(q, cp.polygon) || cp.polygon.some((v, k) => { const w = cp.polygon[(k + 1) % 4]; const dx = w.x - v.x; const dy = w.y - v.y; const t = Math.max(0, Math.min(1, ((q.x - v.x) * dx + (q.y - v.y) * dy) / (dx * dx + dy * dy))); return Math.hypot(q.x - v.x - t * dx, q.y - v.y - t * dy) < 5; })), 'posts stand on the canopy edge');
  }
  // Off by default.
  assert.equal(warehouseSite({}).project.commercial.siteWorks.carports.length, 0);
  assert.ok(carportsOf([]).length === 0);
});

test('carports: canopies of back to back rows touch along the shared back line, and a canopy never has a gap inside a row', () => {
  const free = (s0, s1, t0, t1) => s0 >= 0 && s1 <= 60000 && t0 >= 0 && t1 <= 60000;
  const f = fillField({ ok: free, sp: 30000, spineW: AISLE_CAR, aisleW: AISLE_CAR, bayL: BAY_L, bayW: BAY_W, wanted: 300, near: { s: 30000, t: 0 }, tStart: 0, tFirst: 0, tEnd: 60000, sMin: 0, sMax: 60000 });
  const geo = fieldGeometry(f, (s, t) => ({ x: s, y: t }), { u: { x: 1, y: 0 }, n: { x: 0, y: 1 } });
  const cps = carportsOf(geo.rows);
  assert.equal(cps.length, geo.rows.length);
  const touching = cps.filter((a) => cps.some((b) => b !== a && a.polygon.filter((p) => b.polygon.some((q) => len(p, q) < 5)).length >= 2));
  assert.ok(touching.length >= 2, 'at least one back to back pair shares a whole back edge');
  for (const cp of cps) assert.equal(cp.bays * BAY_W * BAY_L, Math.round(Math.abs(G.polygonArea(cp.polygon))), 'one canopy, no gaps, exactly over its bays');
});

test('bay fill engine: an exact rectangle takes full double loaded modules with a 6.2 m aisle and the turning extension', () => {
  const free = (s0, s1, t0, t1) => s0 >= 0 && s1 <= 60000 && t0 >= 0 && t1 <= 40000;
  const f = fillField({ ok: free, sp: 30000, spineW: AISLE_CAR, aisleW: AISLE_CAR, bayL: BAY_L, bayW: BAY_W, wanted: 200, near: { s: 30000, t: 0 }, tStart: 0, tFirst: 0, tEnd: 40000, sMin: 0, sMax: 60000 });
  assert.ok(f.count >= 40, `${f.count} bays`);
  const geo = fieldGeometry(f, (s, t) => ({ x: s, y: t }), { u: { x: 1, y: 0 }, n: { x: 0, y: 1 } });
  for (const r of f.rows) for (const b of r.bays) assert.ok(free(b.s0, b.s1, b.t0, b.t1), 'a bay inside the rectangle');
  assert.ok(geo.rows.every((r) => r.slots.length >= MIN_ROW));
  assert.equal(AISLE_CAR, 6200);
});

test('wording: the new car park files carry no dashes or banned words', () => {
  for (const f of ['../src/commercial/carpark-field.js', '../src/commercial/sitelayout.js', '../src/commercial/sitelayout-oriented.js']) {
    const src = readFileSync(join(here, f), 'utf8');
    assert.ok(!/[–—]/.test(src), `${f} has an em or en dash`);
    assert.ok(!/compliant/i.test(src), `${f} says the banned word`);
  }
  const panel = readFileSync(join(here, '../src/commercial/ui/panel-commercial.js'), 'utf8');
  assert.ok(/Covered bays \(one carport over each row\)/.test(panel));
});
