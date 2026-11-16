// The automatic car park and site layout (src/commercial/sitelayout.js): crossovers, aisles to every building, bays to the indicative rate,
// no overlaps with buildings, and the wiring into bays, pavements, add and duplicate. Geometry checks do not trust the generator's own flags.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import * as G from '../src/model/geometry.js';
import { createStore } from '../src/model/store.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { generateSiteWorks, siteKey, AISLE_MM, RE_RUN_LABEL } from '../src/commercial/sitelayout.js';
import { chooseBuilding, polysOverlap } from '../src/commercial/catalogue/fit.js';
import { applyBuildingChoice, addBuildingFit, duplicateBuilding, moveBuilding, rerunSiteLayout } from '../src/commercial/catalogue/ops.js';
import { buildingsOf, siteWorksOf } from '../src/commercial/catalogue/buildings.js';
import { buildingParking, bayDemand } from '../src/commercial/catalogue/bays.js';
import { pavementModel, pavementAreas } from '../src/commercial/catalogue/pavements/index.js';
import { typesForPicker, STRATA_ID } from '../src/commercial/catalogue/types/index.js';
const addableTypes = () => typesForPicker().filter((t) => t.id !== STRATA_ID);
import { typeById } from '../src/commercial/catalogue/types/index.js';

const here = dirname(new URL(import.meta.url).pathname);

function site(typeId, { width = 65000, depth = 90000 } = {}) {
  const p = commercialProject({ width, depth, rows: 'none' });
  const store = createStore(p);
  if (typeId) applyBuildingChoice(store, chooseBuilding(store.project, typeId));
  return store;
}

/** Union of the paved polygons that connect to a street crossover: crossover pads, aisles, forecourts and aprons that touch each other. */
function connected(sw) {
  const nodes = [...sw.crossovers.map((x) => ({ poly: x.polygon, root: true })), ...sw.pavedAisles.map((a) => ({ poly: a.polygon })), ...sw.forecourts.map((a) => ({ poly: a.polygon })), ...sw.aprons.map((a) => ({ poly: a.polygon }))];
  const grow = (poly) => { const c = poly.reduce((s, q) => ({ x: s.x + q.x / poly.length, y: s.y + q.y / poly.length }), { x: 0, y: 0 }); return poly.map((q) => ({ x: q.x + Math.sign(q.x - c.x) * 150, y: q.y + Math.sign(q.y - c.y) * 150 })); };
  const seen = new Set(nodes.map((n, i) => (n.root ? i : -1)).filter((i) => i >= 0));
  let grew = true;
  while (grew) {
    grew = false;
    nodes.forEach((n, i) => {
      if (seen.has(i)) return;
      for (const j of seen) if (polysOverlap(grow(n.poly), grow(nodes[j].poly))) { seen.add(i); grew = true; return; }
    });
  }
  return [...seen].map((i) => nodes[i].poly);
}
const distToPoly = (pt, poly) => (G.pointInPolygon(pt, poly) ? 0 : Math.min(...poly.map((a, i) => { const b = poly[(i + 1) % poly.length]; const dx = b.x - a.x; const dy = b.y - a.y; const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(pt.x - a.x - t * dx, pt.y - a.y - t * dy); })));
const doorPoint = (b) => { const xs = b.local.outline.map((q) => q.x); const ys = b.local.outline.map((q) => q.y); const l = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.min(...ys) - 1000 }; const a = (b.place.rotationDeg * Math.PI) / 180; return { x: b.place.x + Math.cos(a) * l.x - Math.sin(a) * l.y, y: b.place.y + Math.sin(a) * l.x + Math.cos(a) * l.y }; };

test('site layout: a service station gets separate entry and exit crossovers, a forecourt and a way to the building door', () => {
  const store = site('service-station');
  const sw = store.project.commercial.siteWorks;
  assert.ok(sw, 'the layout is stored on the project');
  assert.deepEqual(sw.crossovers.map((x) => x.role).sort(), ['in', 'out']);
  assert.ok(Math.abs(sw.crossovers[0].x - sw.crossovers[1].x) > 12000, 'the two crossovers are well apart');
  assert.equal(sw.forecourts.length, 1, 'a forecourt under the fuel canopy');
  const net = connected(sw);
  for (const b of buildingsOf(store.project.commercial)) assert.ok(net.some((poly) => distToPoly(doorPoint(b), poly) <= 4000), `the door of ${b.label} is on the network`);
  const fc = sw.forecourts[0].polygon;
  assert.ok(net.some((poly) => poly === fc), 'the forecourt is joined to the crossovers');
});

test('site layout: a warehouse is reachable from the street, bays meet the indicative rate and sit clear of the building', () => {
  const store = site('warehouse');
  const c = store.project.commercial;
  const sw = c.siteWorks;
  const [b] = buildingsOf(c);
  assert.equal(sw.crossovers.length, 1);
  assert.ok(connected(sw).some((poly) => distToPoly(doorPoint(b), poly) <= 4000), 'the door is joined to the crossover');
  const need = Math.ceil(bayDemand(b).raw - 1e-9);
  const bays = sw.bayRows.flatMap((r) => r.slots).filter((s) => s.kind !== 'zone');
  assert.ok(bays.length >= need, `${bays.length} bays for ${need} required`);
  assert.equal(sw.summary.limited, false);
  assert.ok(sw.summary.accessibleProvided >= sw.summary.accessibleRequired, 'accessible bays are provided');
  for (const s of bays) {
    assert.ok(!polysOverlap(s.poly, b.outline), 'a bay overlaps the building');
    assert.ok(s.poly.every((q) => G.pointInPolygon(q, store.project.site.lot.boundary)), 'a bay is outside the lot');
  }
  for (let i = 0; i < bays.length; i++) for (let j = i + 1; j < bays.length; j++) assert.ok(!polysOverlap(shrink(bays[i].poly), shrink(bays[j].poly)), 'two bays overlap');
  // The accessible bay has its shared zone beside it.
  assert.ok(sw.bayRows.some((r) => r.slots.some((s) => s.kind === 'zone')));
});
const shrink = (poly) => { const c = poly.reduce((s, q) => ({ x: s.x + q.x / poly.length, y: s.y + q.y / poly.length }), { x: 0, y: 0 }); return poly.map((q) => ({ x: c.x + (q.x - c.x) * 0.9, y: c.y + (q.y - c.y) * 0.9 })); };

test('site layout: the bays are the ones the counts, checks and 3D read (buildingParking) and aisles stay clear of buildings', () => {
  const store = site('warehouse');
  const c = store.project.commercial;
  const bp = buildingParking(c);
  assert.equal(bp.siteWorks, true);
  assert.equal(bp.totalBays, c.siteWorks.summary.provided);
  assert.ok(bp.rows.every((r) => r.buildingId && r.slots.length));
  for (const b of buildingsOf(c)) for (const a of c.siteWorks.pavedAisles) assert.ok(!polysOverlap(shrink(a.polygon), b.outline), 'an aisle crosses a building');
  assert.ok(c.siteWorks.pavedAisles.length >= 1 && c.siteWorks.landscape.length >= 1, 'aisles and landscaping are laid out');
});

test('site layout: it does not pave the whole lot, only the aisles and bays that are needed', () => {
  const store = site('warehouse');
  const paved = store.project.commercial.siteWorks.pavedAisles.reduce((s, a) => s + Math.abs(G.polygonArea(a.polygon)), 0) / 1e6;
  const lot = Math.abs(G.polygonArea(store.project.site.lot.boundary)) / 1e6;
  assert.ok(paved < lot * 0.25, `${paved.toFixed(0)} m2 of aisle on ${lot.toFixed(0)} m2`);
});

test('site layout: moving a building lays the site out again and the building is still reachable', () => {
  const store = site('warehouse', { width: 80000, depth: 110000 });
  const k0 = store.project.commercial.siteWorks.bsig;
  const b0 = buildingsOf(store.project.commercial)[0];
  moveBuilding(store, b0.id, { x: b0.place.x + 6000, y: b0.place.y + 4000 });
  const c = store.project.commercial;
  assert.notEqual(c.siteWorks.bsig, k0, 'a new layout for the new position');
  assert.ok(siteWorksOf(c), 'the layout matches the buildings');
  const b = buildingsOf(c)[0];
  assert.ok(connected(c.siteWorks).some((poly) => distToPoly(doorPoint(b), poly) <= 4000));
  store.undo();
  assert.equal(store.project.commercial.siteWorks.bsig, k0, 'undo brings the earlier layout back');
});

test('site layout: a stale layout is never used (the buildings changed behind its back)', () => {
  const store = site('warehouse');
  const c = structuredClone(store.project.commercial);
  c.buildings[0].place.x += 9000;
  assert.equal(siteWorksOf(c), null);
  assert.equal(buildingParking(c).siteWorks, undefined);
});

test('add building: lands in free space clear of the setbacks, buildings and aisles, and is draggable', () => {
  const store = site('warehouse', { width: 90000, depth: 120000 });
  const before = buildingsOf(store.project.commercial)[0];
  const res = addBuildingFit(store, 'amenities-block');
  assert.equal(res.fitted, true);
  const c = store.project.commercial;
  assert.equal(c.buildings.length, 2);
  const added = buildingsOf(c).find((b) => b.id === res.id);
  assert.ok(!polysOverlap(added.outline, before.outline), 'it overlaps the first building');
  const env = store.project.site.lot.envelope;
  if (Array.isArray(env)) assert.ok(added.outline.every((q) => G.pointInPolygon(q, env)), 'it is inside the setbacks');
  assert.ok(connected(c.siteWorks).some((poly) => distToPoly(doorPoint(added), poly) <= 4000), 'the new building is reachable too');
  moveBuilding(store, res.id, { x: added.place.x + 2000 });
  assert.equal(store.project.commercial.buildings[1].place.x, added.place.x + 2000);
});

test('duplicate building: a copy of the same type and settings, in free space, as one undo step', () => {
  const store = site('warehouse', { width: 110000, depth: 130000 });
  const id = addBuildingFit(store, 'kiosk').id;
  const n = store.project.commercial.buildings.length;
  const res = duplicateBuilding(store, id);
  const c = store.project.commercial;
  assert.equal(c.buildings.length, n + 1);
  const a = c.buildings.find((b) => b.id === id); const b = c.buildings.find((x) => x.id === res.id);
  assert.equal(b.type, a.type);
  assert.deepEqual(b.params, a.params);
  const bs = buildingsOf(c);
  assert.ok(!polysOverlap(bs.find((x) => x.id === id).outline, bs.find((x) => x.id === res.id).outline), 'the copy does not sit on the original');
  store.undo();
  assert.equal(store.project.commercial.buildings.length, n);
});

test('the Add building picker offers the small types: amenities block, canopy, car wash, kiosk, shed, with the rest of the catalogue', () => {
  const ids = addableTypes().map((t) => t.id);
  for (const id of ['amenities-block', 'canopy', 'car-wash', 'kiosk', 'storage-shed', 'office', 'warehouse', 'vehicle-workshop', 'service-station']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('strata-units'));
  for (const id of ['amenities-block', 'canopy', 'car-wash', 'kiosk', 'storage-shed']) {
    const def = typeById(id);
    const d = def.defaults(null);
    assert.deepEqual(def.validate(d), []);
    assert.ok(def.footprint(d).outline.length >= 3 && def.quantities(d).gfaM2 > 0, id);
  }
});

test('pavements: the automatic layout feeds the quantities (aisles, bays, forecourt, footpaths) and a changed type shows', () => {
  const store = site('service-station');
  const c = store.project.commercial;
  const model = pavementModel(c, store.project.site.lot);
  const sw = model.areas.filter((a) => a.id.startsWith('sw:'));
  assert.ok(sw.length >= 4, 'site layout areas are in the model');
  assert.ok(sw.some((a) => a.role === 'aisle') && sw.some((a) => a.role === 'bays') && sw.some((a) => a.role === 'apron'));
  assert.ok(model.quantities.totalAreaM2 > 100);
  assert.ok(model.markings.some((m) => m.type === 'bay-lines'), 'bay line marking is counted');
  assert.equal(model.kerbs.some((k) => k.crossover), true, 'layback kerb at the crossover');
  const aisle = sw.find((a) => a.role === 'aisle');
  c.pavements = [{ id: aisle.id, type: 'concrete-heavy' }];
  assert.equal(pavementAreas(c).find((a) => a.id === aisle.id).type, 'concrete-heavy');
});

test('re-run car park layout: clears hand edits to the generated paving and lays the site out again (one undo step)', () => {
  const store = site('warehouse');
  const aisle = pavementAreas(store.project.commercial).find((a) => a.id.startsWith('sw:paved'));
  store.apply('Edit paving', (p) => { p.commercial.pavements = [{ id: aisle.id, type: 'concrete-heavy' }]; });
  assert.equal(pavementAreas(store.project.commercial).find((a) => a.id === aisle.id).type, 'concrete-heavy');
  rerunSiteLayout(store);
  assert.equal(pavementAreas(store.project.commercial).find((a) => a.id === aisle.id).type, 'asphalt-ac10-car');
  assert.ok(siteWorksOf(store.project.commercial));
  assert.equal(RE_RUN_LABEL, 'Re-run car park layout');
});

test('a strata unit complex keeps its own bays, aprons and access line, and gets landscaping only', () => {
  const p = commercialProject({ plain: false });
  const sw = generateSiteWorks(p);
  assert.equal(sw.kind, 'rows');
  assert.equal(sw.bayRows.length, 0);
  assert.equal(sw.pavedAisles.length, 0);
  assert.ok(sw.landscape.length >= 1);
});

test('site layout: a tight lot says the bays are short (limited) instead of paving past the boundary', () => {
  const store = site('warehouse', { width: 45000, depth: 60000 });
  const sw = store.project.commercial.siteWorks;
  for (const r of sw.bayRows) for (const s of r.slots) assert.ok(s.poly.every((q) => G.pointInPolygon(q, store.project.site.lot.boundary)));
  assert.equal(typeof sw.summary.limited, 'boolean');
  assert.ok(AISLE_MM >= 6000);
  assert.ok(siteKey(store.project).length > 10);
});

test('wording: the new commercial files say building, layout and site, with no dashes and no banned words', () => {
  const files = ['../src/commercial/sitelayout.js', '../src/commercial/ui/add-building.js', '../src/flow/commercial.js', '../src/flow/com-logic.js', '../src/commercial/catalogue/types/small.js'];
  for (const f of files) {
    const src = readFileSync(join(here, f), 'utf8');
    assert.ok(!/\b(house|houses|home|homes)\b/i.test(src), `${f} says house or home`);
    assert.ok(!/[–—]/.test(src), `${f} has an em or en dash`);
    assert.ok(!/compliant|pocket architect/i.test(src), `${f} has a banned phrase`);
  }
  void readdirSync;
});

test('site layout: crossovers sit on the edge that abuts the road, not on a boundary shared with another lot', () => {
  const store = site('service-station', { width: 80000, depth: 90000 });
  const lot = store.project.site.lot;
  const b = lot.boundary;
  // A neighbouring lot beyond edge 1 (the east side boundary, x = 80 m).
  const beyond = () => [{ x: 80000, y: 0 }, { x: 80000, y: 90000 }, { x: 100000, y: 90000 }, { x: 100000, y: 0 }];
  lot.neighbours = [{ ring: beyond() }];
  lot.roads = [{ name: 'MAIN ST', pts: [-50000, -8000, 150000, -8000] }];
  lot.frontEdges = [1, 0];
  const sw = generateSiteWorks(store.project);
  assert.ok(sw && sw.crossovers.length);
  const dEdge = (p, a, c) => { const dx = c.x - a.x; const dy = c.y - a.y; const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))); return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); };
  for (const x of sw.crossovers) assert.ok(dEdge(x, b[0], b[1]) < 1500, 'crossover on edge 0 (' + Math.round(dEdge(x, b[0], b[1])) + ')');
});

test('site layout: a warehouse turned 25 degrees gets one connected car park, aisle, bays and drive in its own frame', () => {
  for (const type of ['warehouse', 'warehouse-docks'].filter((t) => typeById(t))) {
    const store = site(type, { width: 90000, depth: 130000 });
    const b0 = buildingsOf(store.project.commercial)[0];
    const xs = b0.local.outline.map((q) => q.x); const ys = b0.local.outline.map((q) => q.y);
    const cl = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    const ar = (25 * Math.PI) / 180;
    // Turn it 25 degrees about its centre, with the centre in the middle of the lot.
    moveBuilding(store, b0.id, { x: 45000 - (Math.cos(ar) * cl.x - Math.sin(ar) * cl.y), y: 70000 - (Math.sin(ar) * cl.x + Math.cos(ar) * cl.y), rotationDeg: 25 });
    const sw = store.project.commercial.siteWorks;
    assert.ok(sw, 'regenerated after the rotation');
    assert.equal(sw.version, 4);
    assert.ok(sw.carPark?.polygon, `${type}: the car park is attached to the building`);
    const b = buildingsOf(store.project.commercial)[0];
    const inside = (pt, poly) => G.pointInPolygon(pt, poly) || distToPoly(pt, poly) <= 5;
    const bays = sw.bayRows.flatMap((r) => r.slots);
    assert.ok(bays.length > 0);
    for (const s of bays) for (const q of s.poly) assert.ok(inside(q, sw.carPark.polygon), `${type}: bay corner inside the paved car park`);
    // The bays are turned with the building (parallel to its walls), not left in the street frame.
    const s0 = bays[0].poly; const ang = (Math.atan2(s0[1].y - s0[0].y, s0[1].x - s0[0].x) * 180) / Math.PI;
    assert.ok(Math.abs((((ang - 25) % 90) + 90) % 90) < 1 || Math.abs((((ang - 25) % 90) + 90) % 90 - 90) < 1, `${type}: bays follow the building angle`);
    const touchPads = [b.outline, ...sw.aprons.map((a) => a.polygon)];
    assert.ok(touchPads.some((pad) => sw.carPark.polygon.some((q) => distToPoly(q, pad) < 400) || pad.some((q) => distToPoly(q, sw.carPark.polygon) < 400)), `${type}: the car park touches the pad or apron`);
    const net = connected(sw);
    assert.ok(net.some((poly) => poly === sw.pavedAisles[0].polygon), `${type}: the aisle is joined to the crossover`);
    for (const a of sw.aprons) assert.ok(net.some((poly) => poly === a.polygon), `${type}: the hardstand is joined to the crossover`);
    assert.equal(sw.summary.limited, false);
    // Moving it again changes the layout (the pose is part of the key).
    const k1 = siteKey(store.project);
    moveBuilding(store, b.id, { x: b.place.x + 3000, y: b.place.y, rotationDeg: 40 });
    assert.notEqual(siteKey(store.project), k1);
    assert.ok(store.project.commercial.siteWorks.carPark, 'regenerated for the new pose');
  }
});
