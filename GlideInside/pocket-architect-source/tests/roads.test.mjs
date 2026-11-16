// Roads, driveways and pavements drawn by clicking points (roads.js): geometry, editing, snapping, generated items, access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model/store.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { chooseBuilding } from '../src/commercial/catalogue/fit.js';
import { applyBuildingChoice } from '../src/commercial/catalogue/ops.js';
import { commercialEdit } from '../src/commercial/mode.js';
import { siteWorksOf } from '../src/commercial/catalogue/buildings.js';
import { pavementAreas, pavementModel } from '../src/commercial/catalogue/pavements/logic.js';
import { hardstandList, moveHardstand, duplicateHardstand, removeHardstand, areaM2 } from '../src/commercial/catalogue/pavements/hardstand.js';
import * as R from '../src/commercial/catalogue/pavements/roads.js';
import { normaliseCommercial } from '../src/commercial/schema.js';

const lotOf = (p) => p.site.lot;
function station() {
  const store = createStore(commercialProject({ width: 60000, depth: 80000, rows: 'none' }));
  applyBuildingChoice(store, chooseBuilding(store.project, 'service-station'));
  return store;
}

test('corridor of a straight line is a rectangle of the right area', () => {
  const ring = R.corridor([{ x: 0, y: 0 }, { x: 10000, y: 0 }], 6000);
  assert.equal(ring.length, 4);
  assert.ok(Math.abs(areaM2(ring) - 60) < 0.01);
});

test('corridor of a bent line is one simple ring, and a hairpin falls back to the union', () => {
  const bent = R.corridor([{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 10000 }], 4000);
  assert.ok(bent.length >= 6);
  const a = areaM2(bent);
  assert.ok(a > 70 && a < 90, `area ${a}`);
  const hair = R.corridor([{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 0, y: 500 }], 4000);
  assert.ok(hair.length >= 3 && areaM2(hair) > 20);
});

test('addRoad stores centre and width, derives the outline, and shows in the pavement model as hardstand', () => {
  const p = commercialProject({ rows: 'none' });
  const c = p.commercial;
  const r = R.addRoad(c, { kind: 'road', centre: [{ x: 10000, y: 20000 }, { x: 40000, y: 20000 }], lot: lotOf(p).boundary });
  assert.equal(r.ids.length, 1);
  const road = R.roadById(c, r.ids[0]);
  assert.equal(road.widthMm, 7000);
  assert.equal(road.type, 'asphalt-ac10-truck');
  assert.ok(pavementAreas(c).some((a) => a.id === road.id && a.role === 'hardstand'));
  const m = pavementModel(c, lotOf(p));
  assert.ok(m.areas.find((a) => a.id === road.id).areaM2 > 200);
  assert.equal(hardstandList(c)[0].road.kind, 'road');
});

test('default widths and surfaces per kind; width is clamped', () => {
  const c = { pavements: [] };
  for (const [k, w, t] of [['road', 7000, 'asphalt-ac10-truck'], ['driveway', 6000, 'asphalt-ac10-car'], ['pavement', 1500, 'concrete-footpath']]) {
    const id = R.addRoad(c, { kind: k, centre: [{ x: 0, y: 0 }, { x: 8000, y: 0 }] }).ids[0];
    const r = R.roadById(c, id);
    assert.equal(r.widthMm, w); assert.equal(r.type, t);
  }
  const id = R.addRoad(c, { kind: 'pavement', centre: [{ x: 0, y: 0 }, { x: 8000, y: 0 }], widthMm: 99999 }).ids[0];
  assert.equal(R.roadById(c, id).widthMm, 6000);
  assert.throws(() => R.addRoad(c, { kind: 'road', centre: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }));
});

test('road is clipped to the lot', () => {
  const p = commercialProject({ rows: 'none' });
  const c = p.commercial;
  const b = lotOf(p).boundary;
  const minX = Math.min(...b.map((q) => q.x));
  const r = R.addRoad(c, { kind: 'road', centre: [{ x: minX - 20000, y: 30000 }, { x: minX + 20000, y: 30000 }], lot: b });
  const road = R.roadById(c, r.ids[0]);
  assert.ok(r.clipped);
  assert.ok(Math.min(...road.polygon.map((q) => q.x)) >= minX - 1);
  const out = R.addRoad(c, { kind: 'road', centre: [{ x: minX - 40000, y: 30000 }, { x: minX - 20000, y: 30000 }], lot: b });
  assert.ok(out.outside && !out.ids.length);
});

test('setRoad moves a point, changes width and kind; points can be inserted and removed', () => {
  const c = { pavements: [] };
  const id = R.addRoad(c, { kind: 'road', centre: [{ x: 0, y: 0 }, { x: 10000, y: 0 }] }).ids[0];
  const a0 = areaM2(R.roadById(c, id).polygon);
  R.setRoad(c, id, { widthMm: 3500 });
  assert.ok(Math.abs(areaM2(R.roadById(c, id).polygon) - a0 / 2) < 0.01);
  assert.equal(R.insertRoadPoint(c, id, 0), 1);
  assert.equal(R.roadById(c, id).centre.length, 3);
  R.setRoad(c, id, { centre: [{ x: 0, y: 0 }, { x: 5000, y: 3000 }, { x: 10000, y: 0 }] });
  assert.ok(areaM2(R.roadById(c, id).polygon) > a0 / 2);
  R.removeRoadPoint(c, id, 1);
  assert.equal(R.roadById(c, id).centre.length, 2);
  assert.throws(() => R.removeRoadPoint(c, id, 0));
  R.setRoad(c, id, { kind: 'pavement', type: 'unit-pavers-ped' });
  assert.equal(R.roadById(c, id).kind, 'pavement');
  assert.equal(R.roadById(c, id).type, 'unit-pavers-ped');
});

test('move, duplicate and delete follow the centre line', () => {
  const c = { pavements: [] };
  const id = R.addRoad(c, { kind: 'driveway', centre: [{ x: 0, y: 0 }, { x: 10000, y: 0 }] }).ids[0];
  moveHardstand(c, id, 0, 5000);
  assert.deepEqual(R.roadById(c, id).centre[0], { x: 0, y: 5000 });
  const d = duplicateHardstand(c, id);
  assert.ok(R.roadById(c, d.ids[0]));
  removeHardstand(c, id);
  assert.equal(R.roadById(c, id), null);
});

test('width handle and drag width', () => {
  const road = { kind: 'road', widthMm: 7000, centre: [{ x: 0, y: 0 }, { x: 10000, y: 0 }] };
  const h = R.roadHandles(road);
  assert.equal(h.filter((x) => x.kind === 'point').length, 2);
  const w = h.find((x) => x.kind === 'width');
  assert.equal(Math.abs(w.y), 3500);
  assert.equal(R.widthFromPoint(road, 0, { x: 5000, y: 5000 }), 10000);
  assert.equal(R.widthFromPoint(road, 0, { x: 5000, y: 100 }), 3000);
});

test('snapping: frontage, door, other road end, other road line, alt off', () => {
  const store = station();
  const p = store.project;
  const edges = R.frontageEdges(lotOf(p));
  assert.ok(edges.length >= 1);
  const [a, b] = edges[0];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const rc = R.roadSnapContext(p);
  const f = R.snapRoadPoint({ x: mid.x + 30, y: mid.y + 30 }, rc, { mmPerPx: 10 });
  assert.equal(f.kind, 'frontage');
  const doors = R.doorPoints(p.commercial);
  assert.ok(doors.length >= 1);
  const d = R.snapRoadPoint({ x: doors[0].x + 40, y: doors[0].y - 40 }, rc, { mmPerPx: 10 });
  assert.equal(d.kind, 'door');
  assert.deepEqual([d.x, d.y], [doors[0].x, doors[0].y]);
  commercialEdit(store, 't', (c) => R.addRoad(c, { kind: 'road', centre: [{ x: 20000, y: 20000 }, { x: 30000, y: 20000 }], lot: lotOf(store.project).boundary }));
  const rc2 = R.roadSnapContext(store.project);
  assert.equal(R.snapRoadPoint({ x: 30040, y: 20030 }, rc2, { mmPerPx: 10 }).kind, 'road-end');
  assert.equal(R.snapRoadPoint({ x: 25000, y: 20050 }, rc2, { mmPerPx: 10 }).kind, 'road');
  const free = R.snapRoadPoint({ x: 25001.4, y: 20050 }, rc2, { alt: true });
  assert.equal(free.kind, 'free');
  assert.equal(R.roadSnapContext(store.project, { exclude: store.project.commercial.pavements[0].id }).ends.length, 0);
});

test('generated aisles and footpaths can be picked and removed one at a time; paved aisle takes its centre lines', () => {
  const store = station();
  const c = store.project.commercial;
  const sw = siteWorksOf(c);
  const paved = sw.pavedAisles[0];
  const mid = { x: paved.polygon.reduce((s, q) => s + q.x, 0) / paved.polygon.length, y: paved.polygon.reduce((s, q) => s + q.y, 0) / paved.polygon.length };
  const hit = R.siteItemAt(c, mid);
  assert.ok(hit && hit.id);
  const count = (s) => s.pavedAisles.length + s.aisles.length + s.footpaths.length + s.aprons.length + s.forecourts.length + s.crossovers.length;
  const nBefore = count(siteWorksOf(c));
  store.apply('rm', (p) => { R.removeGenerated(p, hit.id); });
  const s2 = siteWorksOf(store.project.commercial);
  assert.ok(!R.siteItemById(store.project.commercial, hit.id));
  assert.ok(count(s2) < nBefore);
  assert.ok(!pavementAreas(store.project.commercial).some((a) => a.id === hit.id || a.id === `${hit.id}:pad`));
});

test('makeEditable swaps a generated aisle for a drawn road of the same width', () => {
  const store = station();
  const c = store.project.commercial;
  const aisle = siteWorksOf(c).aisles[0];
  let res;
  commercialEdit(store, 'edit', (cc) => { res = R.makeEditable(cc, aisle.id, lotOf(store.project).boundary); });
  assert.ok(res?.id);
  const road = R.roadById(store.project.commercial, res.id);
  assert.equal(road.widthMm, aisle.widthMm);
  assert.ok(!siteWorksOf(store.project.commercial).aisles.some((a) => a.id === aisle.id));
});

test('roads survive normalisation; access report sees a driveway from the street to a door', () => {
  const store = station();
  const p = store.project;
  const [a, b] = R.frontageEdges(lotOf(p))[0];
  const door = R.doorPoints(p.commercial)[0];
  const start = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  commercialEdit(store, 'drive', (c) => R.addRoad(c, { kind: 'driveway', centre: [start, door], lot: lotOf(store.project).boundary }));
  const c = normaliseCommercial(store.project.commercial);
  assert.equal(R.roadList(c).length, 1);
  const acc = R.roadAccess(c, lotOf(store.project));
  assert.equal(acc.fromStreet.length, 1);
  assert.equal(acc.widthMm, 6000);
  assert.ok(acc.doorsServed.length >= 1);
  assert.equal(R.roadAccess(normaliseCommercial({}), lotOf(store.project)).widthMm, null);
});
