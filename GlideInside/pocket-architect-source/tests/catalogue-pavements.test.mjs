// Commercial pavement catalogue (src/commercial/catalogue/pavements): make-ups, kerbs, markings, rates, auto assignment, kerb lengths,
// quantities, golden cost, the site works export, plan set blocks, the 3D build and a wording lint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import * as THREE from 'three';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import {
  PAVEMENTS, KERBS, MARKINGS, ROLE_DEFAULTS, MAKEUP_NOTE, RATES, pavementById, kerbById, markingById, totalThicknessMm, makeUpShort, planLines, profileArea, markingGeometry,
  defaultAreas, pavementAreas, netAreasM2, pavementModel, pavementCost, siteWorksCost, planLegend, pavementSchedule, WHEEL_STOP,
} from '../src/commercial/catalogue/pavements/index.js';
import { drawPavementPlan, drawLegendSwatch } from '../src/commercial/catalogue/pavements/draw2d.js';
import { addCommercialPavements, textureFor } from '../src/commercial/catalogue/pavements/view3d.js';
import { parkingLayout } from '../src/commercial/parking.js';
import { developedAreaM2 } from '../src/commercial/feasibility.js';

const here = dirname(new URL(import.meta.url).pathname);
const DIR = join(here, '../src/commercial/catalogue/pavements');
const single = () => commercialProject({ rows: 'single', plain: true }); // one row of 8 units, 8 m aisle, no apron
const pair = () => commercialProject({ plain: false }); // two rows, 12 m truck apron (6.2 m in front of the 5.8 m aisle)
const close = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

// Make-ups -------------------------------------------------------------------------------------------------------------------------

test('pavements: every type has positive layers, a rate, colour, hatch and 3D texture, labelled indicative', () => {
  const ids = PAVEMENTS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['concrete-heavy', 'concrete-light', 'asphalt-ac10-car', 'asphalt-ac14-car', 'asphalt-ac10-truck', 'asphalt-ac14-truck', 'spray-seal', 'gravel-yard', 'permeable-pavers', 'concrete-footpath', 'unit-pavers-ped', 'exposed-aggregate']) assert.ok(ids.includes(id), id);
  for (const p of PAVEMENTS) {
    assert.ok(p.layers.length >= 2, p.id);
    for (const l of p.layers) { assert.ok(l.thicknessMm > 0 && Number.isFinite(l.thicknessMm), `${p.id} ${l.material}`); assert.ok(l.material.length > 3); }
    assert.ok(totalThicknessMm(p) > 0);
    assert.ok(p.use.length && p.use.every((u) => ['car', 'truck', 'pedestrian', 'yard'].includes(u)), p.id);
    assert.ok(RATES.pavements[p.rateKey], `rate for ${p.id}`);
    assert.match(p.colour, /^#[0-9a-f]{6}$/i);
    assert.ok(p.hatch2d.pattern && p.hatch2d.spacingMm > 0 && p.hatch2d.fill && p.hatch2d.line, p.id);
    assert.ok(p.texture3d.kind && p.texture3d.tileM > 0 && p.texture3d.base, p.id);
    assert.equal(p.note, 'Indicative make-up, design to AGPT02 by a suitably qualified engineer');
    assert.equal(p.indicative, true);
  }
  assert.equal(MAKEUP_NOTE, 'Indicative make-up, design to AGPT02 by a suitably qualified engineer');
  assert.equal(makeUpShort('asphalt-ac10-car'), '40 + 150 + 150 mm (340 mm total)');
});

test('pavements: heavy duty concrete is thicker than light duty, truck asphalt thicker than car asphalt', () => {
  const t = (id) => totalThicknessMm(pavementById(id));
  assert.ok(t('concrete-heavy') > t('concrete-light'));
  assert.ok(t('asphalt-ac10-truck') > t('asphalt-ac10-car'));
  assert.ok(t('asphalt-ac14-truck') > t('asphalt-ac14-car'));
  assert.equal(pavementById('concrete-heavy').layers[0].thicknessMm, 200);
});

test('pavements: texture3d kinds all have a canvas drawer (no DOM here, so the texture is null but the kind is known)', () => {
  const kinds = new Set(PAVEMENTS.map((p) => p.texture3d.kind));
  assert.deepEqual([...kinds].sort(), ['aggregate', 'asphalt', 'concrete', 'gravel', 'pavers', 'permeable', 'seal']);
  for (const p of PAVEMENTS) assert.equal(textureFor(p.texture3d), null); // no document in node
});

// Kerbs and markings ----------------------------------------------------------------------------------------------------------------

test('kerbs: closed profiles with area, heights, plan lines and a rate', () => {
  assert.deepEqual(KERBS.map((k) => k.id), ['barrier-kg', 'layback-kg', 'mountable', 'flush-edge', 'kerb-only-b', 'dish-drain']);
  for (const k of KERBS) {
    assert.ok(k.profile.length >= 4, k.id);
    assert.ok(Math.abs(profileArea(k.profile)) > 5000, `${k.id} profile area`);
    assert.ok(RATES.kerbs[k.rateKey], k.id);
    assert.ok(k.plan.lines.length >= 2);
    assert.ok(k.widthMm >= Math.max(...k.profile.map((p) => p.x)) - 1);
  }
  assert.equal(kerbById('barrier-kg').heightMm, 180);
  assert.ok(kerbById('dish-drain').heightMm < 0, 'a dish drain is below the pavement surface');
  assert.ok(kerbById('layback-kg').profile.some((p) => p.y > 100 && p.x > 450), 'roll top rises over the back of the gutter');
  const lines = planLines('barrier-kg', [{ x: 0, y: 0 }, { x: 10000, y: 0 }]);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((l) => l.a.y), [0, 450, 600]); // n = (-dy, dx) = (0, 1) for travel along +x
});

test('markings: every type has a rate and geometry, the wheelchair symbol, wheel stop and hump carry their own data', () => {
  const ids = MARKINGS.map((m) => m.id);
  for (const id of ['bay-lines', 'accessible-symbol', 'accessible-hatch', 'arrow-straight', 'arrow-left', 'arrow-right', 'ped-crossing', 'give-way', 'stop-bar', 'wheel-stop', 'speed-hump', 'loading-zone-hatch', 'keep-clear']) assert.ok(ids.includes(id), id);
  for (const m of MARKINGS) {
    assert.ok(RATES.markings[m.rateKey], m.id);
    const item = { type: m.id, x: 1000, y: 2000, rotationDeg: 20, lines: [[{ x: 0, y: 0 }, { x: 0, y: 5400 }]], polygon: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 5400 }, { x: 0, y: 5400 }] };
    const g = markingGeometry(item);
    assert.ok(g.polygons.length > 0, m.id);
    for (const p of g.polygons) assert.ok(p.polygon.length >= 3 && p.polygon.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)));
  }
  assert.equal(markingGeometry({ type: 'accessible-symbol', x: 0, y: 0 }).symbol.type, 'accessible');
  const ws = markingGeometry({ type: 'wheel-stop', x: 0, y: 0, rotationDeg: 0 }).solid;
  assert.deepEqual([ws.uMm, ws.vMm, ws.heightMm], [150, 1800, 100]);
  assert.equal(markingGeometry({ type: 'speed-hump', x: 0, y: 0 }).solid.type, 'hump');
  assert.ok(markingGeometry({ type: 'ped-crossing', x: 0, y: 0, lengthMm: 5800 }).stripes >= 5);
});

// Rates -----------------------------------------------------------------------------------------------------------------------------

test('rates: low <= value <= high, status ESTIMATE, a basis, sources with their own status and url, dates as DD/MM/YYYY', () => {
  assert.match(RATES._meta.asAt, /^\d{2}\/\d{2}\/\d{4}$/);
  let n = 0;
  for (const group of ['pavements', 'kerbs', 'markings', 'allowances']) {
    for (const [k, r] of Object.entries(RATES[group])) {
      n++;
      assert.ok(r.low > 0 && r.low <= r.value && r.value <= r.high, `${group}.${k}`);
      assert.equal(r.status, 'ESTIMATE', `${group}.${k}`);
      assert.ok(r.basis.length > 20 && r.unit, `${group}.${k}`);
      for (const s of r.sources || []) { assert.match(s.url, /^https:\/\//); assert.ok(['VERIFIED_PRIMARY', 'VERIFIED_SECONDARY', 'UNVERIFIED'].includes(s.status)); assert.ok(s.figure && s.date); }
    }
  }
  assert.ok(n >= 30);
  assert.equal(RATES.kerbs['barrier-kg'].sources[0].figure.includes('$150 per metre'), true);
  for (const m of MARKINGS) assert.ok(RATES.markings[m.rateKey]);
});

// Auto assignment -------------------------------------------------------------------------------------------------------------------

test('auto assignment: apron to heavy concrete, aisle and bays to AC10, footpath to concrete, waste pad to heavy concrete, yard to gravel', () => {
  const p = pair();
  p.commercial.waste = { x: 5000, y: 5000, widthMm: 6000, depthMm: 4000, rotationDeg: 0 };
  p.commercial.yards = [{ polygon: [{ x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 6000 }, { x: 0, y: 6000 }] }];
  const areas = pavementAreas(p.commercial);
  const byRole = (r) => areas.filter((a) => a.role === r);
  assert.equal(byRole('apron').length, 2);
  assert.ok(byRole('apron').every((a) => a.type === 'concrete-heavy'));
  assert.ok(byRole('aisle').every((a) => a.type === 'asphalt-ac10-car') && byRole('aisle').length === 2);
  assert.ok(byRole('bays').every((a) => a.type === 'asphalt-ac10-car') && byRole('bays').length === 2);
  assert.ok(byRole('footpath').every((a) => a.type === 'concrete-footpath') && byRole('footpath').length === 2);
  assert.equal(byRole('waste')[0].type, 'concrete-heavy');
  assert.equal(byRole('yard')[0].type, 'gravel-yard');
  // every area gets a valid type, a polygon and an id
  assert.equal(new Set(areas.map((a) => a.id)).size, areas.length);
  for (const a of areas) { assert.ok(pavementById(a.type), a.id); assert.ok(a.polygon.length >= 3); assert.equal(ROLE_DEFAULTS[a.role], a.type); }
  // the defaults cover every area the layout has: apron + aisle + bays together are the hardstand developedAreaM2 counts
  const model = pavementModel(p.commercial, p.site.lot);
  const roles = new Set(model.areas.map((a) => a.role));
  for (const r of ['apron', 'aisle', 'bays']) assert.ok(roles.has(r));
});

test('auto assignment: the apron is the depth by which the truck apron exceeds the car aisle, the aisle keeps its width', () => {
  const p = pair();
  const row = parkingLayout(p.commercial).rows[0];
  const m = pavementModel(p.commercial, p.site.lot);
  const net = Object.fromEntries(m.areas.filter((x) => x.rowId === p.commercial.rows[0].id).map((x) => [x.role, x.areaM2]));
  close(net.apron, (row.length / 1000) * 6.2);
  close(net.aisle, (row.length / 1000) * 5.8);
  close(net.bays, ((row.slots.length * 2400) / 1000) * 5.4);
  assert.equal(defaultAreas(single().commercial).some((x) => x.role === 'apron'), false, 'no apron when the aisle is the wider');
});

test('overrides: project.commercial.pavements changes a type, hides an area (none), adds an area, ignores unknown types', () => {
  const p = single();
  const base = pavementAreas(p.commercial);
  const aisleId = base.find((a) => a.role === 'aisle').id;
  const bayId = base.find((a) => a.role === 'bays').id;
  p.commercial.pavements = [
    { id: aisleId, type: 'asphalt-ac14-truck' },
    { id: bayId, type: 'not-a-type' },
    { id: base.find((a) => a.role === 'footpath').id, type: 'none' },
    { id: 'plaza', type: 'exposed-aggregate', polygon: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }] },
  ];
  const areas = pavementAreas(p.commercial);
  assert.equal(areas.find((a) => a.id === aisleId).type, 'asphalt-ac14-truck');
  assert.equal(areas.find((a) => a.id === bayId).type, 'asphalt-ac10-car');
  assert.equal(areas.some((a) => a.role === 'footpath'), false);
  assert.equal(areas.find((a) => a.id === 'plaza').type, 'exposed-aggregate');
  const m = pavementModel(p.commercial, p.site.lot);
  assert.equal(m.wheelStops.length, 0, 'no footpath behind the bays, so no wheel stops');
  const q = Object.fromEntries(m.quantities.byType.map((e) => [e.type, e.areaM2]));
  close(q['exposed-aggregate'], 12);
  close(q['asphalt-ac14-truck'], 384);
});

// Kerbs -----------------------------------------------------------------------------------------------------------------------------

test('kerbs: lengths match the pavement edges that meet landscaping on a fixture (single row, 8 units of 6 m)', () => {
  const p = single();
  const m = pavementModel(p.commercial, p.site.lot);
  // The aisle (48 m x 8 m) has its building side on the facade (no kerb) and two 8 m ends; the bays (48 m x 5.4 m) have two 5.4 m ends,
  // their long edge meets the aisle on one side and the footpath on the other (no kerb). The footpath is not kerbed.
  const expected = 8 + 8 + 5.4 + 5.4;
  close(m.quantities.totalKerbM, expected, 1e-6);
  close(m.kerbs.reduce((s, k) => s + k.lengthMm, 0) / 1000, expected, 1e-6);
  for (const k of m.kerbs) {
    const [a, b] = k.polyline;
    close(Math.hypot(b.x - a.x, b.y - a.y), k.lengthMm, 1e-6);
  }
  // kerbs only on end edges (x = 20000 or x = 68000), none along the facade at y = 55000 or the footpath
  for (const k of m.kerbs) assert.ok(k.polyline.every((q) => Math.abs(q.x - 20000) < 1 || Math.abs(q.x - 68000) < 1), JSON.stringify(k.polyline));
});

test('kerbs: barrier everywhere, layback only at the crossover (one, 6 m wide, on the run nearest the front boundary)', () => {
  const p = single();
  const m = pavementModel(p.commercial, p.site.lot);
  const lay = m.kerbs.filter((k) => k.type === 'layback-kg');
  assert.equal(lay.length, 1);
  close(lay[0].lengthMm, 6000, 1e-6);
  assert.ok(m.kerbs.filter((k) => k.type !== 'layback-kg').every((k) => k.type === 'barrier-kg'));
  // an explicit empty list means no crossover; explicit crossovers are used as given
  p.commercial.crossovers = [];
  assert.equal(pavementModel(p.commercial, p.site.lot).kerbs.some((k) => k.type === 'layback-kg'), false);
  p.commercial.crossovers = [{ x: 68000, y: 60000, widthMm: 4000 }];
  const m2 = pavementModel(p.commercial, p.site.lot);
  close(m2.kerbs.filter((k) => k.type === 'layback-kg').reduce((s, k) => s + k.lengthMm, 0), 4000, 1e-6);
  close(m2.quantities.totalKerbM, 26.8, 1e-6);
});

test('kerbs: the polyline normal (-dy, dx) points to the landscaping side, away from the pavement', () => {
  const p = pair();
  const m = pavementModel(p.commercial, p.site.lot);
  assert.ok(m.kerbs.length > 8);
  for (const k of m.kerbs) {
    const [a, b] = k.polyline;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const out = { x: mid.x + (-(b.y - a.y) / l) * 100, y: mid.y + ((b.x - a.x) / l) * 100 };
    const inn = { x: mid.x - (-(b.y - a.y) / l) * 100, y: mid.y - ((b.x - a.x) / l) * 100 };
    const inside = (pt) => m.areas.some((ar) => { let c = false; const q = ar.polygon; for (let i = 0, j = q.length - 1; i < q.length; j = i++) if (q[i].y > pt.y !== q[j].y > pt.y && pt.x < ((q[j].x - q[i].x) * (pt.y - q[i].y)) / (q[j].y - q[i].y) + q[i].x) c = !c; return c; });
    assert.equal(inside(out), false, 'outside the pavement');
    assert.equal(inside(inn), true, 'pavement on the other side');
  }
});

test('kerbs: overrides change a kerb type, remove one and add one', () => {
  const p = single();
  const m0 = pavementModel(p.commercial, p.site.lot);
  const [k1, k2] = m0.kerbs;
  p.commercial.kerbs = [{ id: k1.id, type: 'mountable' }, { id: k2.id, type: 'none' }, { type: 'dish-drain', polyline: [{ x: 0, y: 0 }, { x: 5000, y: 0 }] }];
  const m = pavementModel(p.commercial, p.site.lot);
  assert.equal(m.kerbs.find((k) => k.id === k1.id).type, 'mountable');
  assert.equal(m.kerbs.some((k) => k.id === k2.id), false);
  assert.equal(m.quantities.kerbByType.find((e) => e.type === 'dish-drain').lengthM, 5);
});

// Wheel stops and markings ----------------------------------------------------------------------------------------------------------

test('wheel stops: one at every bay (not the shared zone) whose far end meets the footpath, 600 mm from the end of the bay', () => {
  const p = single();
  const park = parkingLayout(p.commercial);
  const bays = park.rows[0].slots.filter((s) => s.kind !== 'zone').length;
  const m = pavementModel(p.commercial, p.site.lot);
  assert.equal(m.wheelStops.length, bays);
  assert.equal(m.quantities.wheelStops, bays);
  // the first stop sits 600 mm inside the far end of the first bay: y = 40000 + 15000 + 8000 + 5400 - 600
  const first = m.wheelStops[0];
  close(first.y, 40000 + 15000 + 8000 + 5400 - WHEEL_STOP.fromBayEndMm, 1e-6);
  close(first.x, 20000 + 1200, 1e-6);
  p.commercial.pavementOptions = { footpathMm: 0 };
  assert.equal(pavementModel(p.commercial, p.site.lot).wheelStops.length, 0);
});

test('markings: bay lines per bay, accessible symbol and hatch from the parking layout, a crossing over the aisle, manual items added', () => {
  const p = single();
  const park = parkingLayout(p.commercial);
  const m = pavementModel(p.commercial, p.site.lot);
  const q = Object.fromEntries(m.quantities.markings.map((e) => [e.type, e.count]));
  assert.equal(q['bay-lines'], park.totalBays);
  assert.equal(q['accessible-symbol'], park.accessible.provided);
  assert.equal(q['accessible-hatch'], park.rows[0].slots.filter((s) => s.kind === 'zone').length);
  assert.equal(q['ped-crossing'], 1);
  p.commercial.markings = [{ type: 'arrow-left', x: 30000, y: 58000, rotationDeg: 0 }, { type: 'speed-hump', x: 40000, y: 58000 }, { type: 'bogus', x: 0, y: 0 }, { type: 'stop-bar', x: 1 }];
  const m2 = pavementModel(p.commercial, p.site.lot);
  const q2 = Object.fromEntries(m2.quantities.markings.map((e) => [e.type, e.count]));
  assert.equal(q2['arrow-left'], 1);
  assert.equal(q2['speed-hump'], 1);
  assert.equal(q2.bogus, undefined);
  assert.equal(q2['stop-bar'], undefined);
});

// Quantities, cost and the feasibility export ------------------------------------------------------------------------------------------

test('quantities: area by type, overlapping areas are counted once', () => {
  const sq = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  const net = netAreasM2([{ id: 'a', polygon: sq(0, 0, 10000, 10000) }, { id: 'b', polygon: sq(5000, 0, 10000, 10000) }]);
  close(net.get('a'), 100, 0.5);
  close(net.get('b'), 50, 0.5); // the part of b already in a is not counted again
  const net2 = netAreasM2([{ id: 'a', polygon: sq(0, 0, 10000, 10000) }, { id: 'b', polygon: sq(10000, 0, 10000, 10000) }]);
  assert.deepEqual([net2.get('a'), net2.get('b')], [100, 100], 'touching edges do not overlap and are exact');
});

test('cost: golden totals for the single row fixture', () => {
  const p = single();
  const c = pavementCost(p.commercial, { lot: p.site.lot });
  const by = (g, k) => c.lines.find((l) => l.group === g && l.key === k);
  close(by('pavements', 'asphalt-ac10-car').qty, 643.2, 1e-6);
  assert.equal(Math.round(by('pavements', 'asphalt-ac10-car').cost), 57888);
  assert.equal(Math.round(by('pavements', 'concrete-footpath').cost), 7200);
  assert.equal(Math.round(by('kerbs', 'barrier-kg').cost), 3432);
  assert.equal(Math.round(by('kerbs', 'layback-kg').cost), 960);
  assert.equal(Math.round(by('markings', 'bay-lines').cost), 266);
  assert.equal(Math.round(by('markings', 'wheel-stop').cost), 1900);
  assert.equal(Math.round(c.groups.pavements), 65088);
  assert.equal(Math.round(c.groups.kerbs), 4392);
  assert.equal(Math.round(c.groups.markings), 3216);
  assert.equal(Math.round(c.groups.allowances), 147144);
  assert.equal(Math.round(c.value), 219840);
  assert.equal(Math.round(c.low), 153130);
  assert.equal(Math.round(c.high), 312406);
  assert.ok(c.lines.every((l) => l.status === 'ESTIMATE' && l.costLow <= l.cost && l.cost <= l.costHigh));
  // a rate override is used and marked EDITED
  const e = pavementCost(p.commercial, { lot: p.site.lot, rates: { 'asphalt-ac10-car': 100 } });
  assert.equal(e.lines.find((l) => l.key === 'asphalt-ac10-car').status, 'EDITED');
  close(e.value - c.value, 643.2 * 10, 0.01);
});

test('siteWorksCost: the export feasibility can call, built up from quantities, in the range of the flat site works rate', () => {
  const p = single();
  const s = siteWorksCost(p.commercial, p.site.lot);
  assert.equal(s.available, true);
  assert.equal(Math.round(s.value), 219840);
  assert.ok(s.low < s.value && s.value < s.high);
  assert.equal(s.status, 'ESTIMATE');
  close(s.hardstandM2, 715.2, 1e-6);
  close(s.footprintM2, 720, 1e-6);
  // per m2 of the developed area (footprint plus hardstand) it sits inside market.json's civilSiteWorksPerM2Site range 120 to 250
  assert.ok(s.perM2 > 120 && s.perM2 < 250, String(s.perM2));
  // feasibility's developed area is the footprint plus the aisle and bays; the footpath behind the bays is extra hardstand here
  const dev = developedAreaM2(p.commercial, p.site.lot);
  assert.ok(dev > 1350 && dev < 1400 + 280, String(dev)); // 720 footprint + 643 aisle and bays, plus the site access driveway to the front boundary; the footpath is extra
  assert.equal(siteWorksCost({ ...p.commercial, rows: [], waste: null }, p.site.lot).available, false);
  assert.equal(siteWorksCost(null).available, false);
});

test('cost: the truck apron layout costs more per m2 of pavement than the car only layout', () => {
  const a = pavementCost(single().commercial);
  const b = pavementCost(pair().commercial);
  assert.ok(b.lines.some((l) => l.key === 'concrete-heavy'));
  assert.ok(b.groups.pavements / b.hardstandM2 > a.groups.pavements / a.hardstandM2);
});

// Plan set blocks --------------------------------------------------------------------------------------------------------------------

test('plan legend and schedule: types in use, quantities, cost columns, the make-up note', () => {
  const p = pair();
  const lg = planLegend(p.commercial, p.site.lot);
  assert.equal(lg.title, 'PAVEMENT LEGEND');
  assert.equal(lg.note, MAKEUP_NOTE);
  const kinds = new Set(lg.items.map((i) => i.kind));
  assert.deepEqual([...kinds].sort(), ['kerb', 'marking', 'pavement']);
  assert.ok(lg.items.some((i) => i.id === 'concrete-heavy') && lg.items.some((i) => i.id === 'barrier-kg') && lg.items.some((i) => i.id === 'wheel-stop'));
  const s = pavementSchedule(p.commercial, p.site.lot);
  assert.equal(s.title, 'PAVEMENT SCHEDULE');
  assert.deepEqual(s.sections.map((x) => x.id), ['pavements', 'kerbs', 'markings']);
  assert.equal(s.sections[0].head.length, 3);
  assert.ok(s.sections[0].rows.every((r) => r.length === 3));
  assert.ok(s.notes[0].startsWith(MAKEUP_NOTE));
  const c = pavementSchedule(p.commercial, p.site.lot, { costs: true });
  assert.deepEqual(c.sections.map((x) => x.id), ['pavements', 'kerbs', 'markings', 'allowances']);
  assert.equal(c.sections[0].head.length, 5);
  assert.ok(c.sections[0].rows[0][4].startsWith('$'));
  assert.ok(c.cost.value > 0 && c.notes.some((n) => /ESTIMATE/.test(n)));
  assert.ok(c.sections.at(-1).total[3].startsWith('$'));
});

// 2D and 3D --------------------------------------------------------------------------------------------------------------------------

test('draw2d: draws areas, kerbs, markings and legend swatches with a recording context', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (_, k) => (typeof k === 'string' && k !== 'then' ? (...a) => { calls.push(k); } : undefined), set: () => true });
  const p = pair();
  const model = pavementModel(p.commercial, p.site.lot);
  drawPavementPlan(ctx, model, (q) => ({ x: q.x * 0.01, y: q.y * 0.01 }), { scale: 0.01 });
  assert.ok(calls.filter((c) => c === 'fill').length > model.areas.length);
  assert.ok(calls.includes('clip') && calls.includes('stroke') && calls.includes('setLineDash'));
  for (const it of planLegend(p.commercial, p.site.lot, model).items) drawLegendSwatch(ctx, it, 0, 0, 40, 12);
});

test('3D: pavement areas, kerbs, paint, wheel stops build as one ground group (no DOM, flat colours)', () => {
  const p = pair();
  const root = new THREE.Group();
  const r = addCommercialPavements(root, p, () => 0);
  assert.ok(r);
  assert.equal(root.children[0].name, 'commercial-pavements');
  assert.equal(r.stats.areas, 8);
  assert.equal(r.stats.kerbs, pavementModel(p.commercial, p.site.lot).kerbs.length);
  assert.equal(r.stats.stops, 39);
  assert.equal(r.stats.symbols, 1);
  const names = r.group.children.map((c) => c.name).sort();
  assert.deepEqual(names, ['pavement-areas', 'pavement-kerbs', 'pavement-markings']);
  for (const m of r.group.children) { assert.equal(m.userData.ground, true); assert.ok(m.geometry.attributes.position.count > 100); }
  // heights follow the surface function
  const root2 = new THREE.Group();
  const r2 = addCommercialPavements(root2, p, (x) => x / 1000 * 0.01);
  const ys = new Set();
  const pos = r2.group.children[0].geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) ys.add(Math.round(pos.getY(i) * 1000));
  assert.ok(ys.size > 5, 'the area is draped over a sloping surface');
  // not a commercial project, or nothing to draw
  assert.equal(addCommercialPavements(new THREE.Group(), { mode: null }, () => 0), null);
  assert.equal(addCommercialPavements(new THREE.Group(), { ...p, commercial: { ...p.commercial, rows: [], parking: { ...p.commercial.parking, enabled: false } } }, () => 0), null);
});

test('hook: the 3D terrain calls the pavement module once, guarded by the commercial mode', () => {
  const src = readFileSync(join(here, '../src/viewer3d/terrain.js'), 'utf8');
  assert.equal((src.match(/addCommercialPavements\(/g) || []).length, 1);
  assert.equal((src.match(/catalogue\/pavements\/view3d\.js/g) || []).length, 1);
  assert.match(src, /project\.mode === 'commercial'\) addCommercialPavements/);
});

// Wording ---------------------------------------------------------------------------------------------------------------------------

test('wording lint: no em or en dashes, never "compliant", no brand names, check with council present', () => {
  const files = readdirSync(DIR).filter((f) => /\.(js|json)$/.test(f));
  assert.ok(files.length >= 8);
  const BRANDS = /\b(boral|holcim|hanson|adbri|austral bricks|pavetech|urbanstone|bluescope|colorbond|stramit|bunnings|reece|humes|rocla|stegbar|kingspan|lysaght)\b/i;
  let text = '';
  for (const f of files) {
    let t = readFileSync(join(DIR, f), 'utf8');
    if (f === 'rates.json') { const j = JSON.parse(t); for (const g of ['pavements', 'kerbs', 'markings', 'allowances']) for (const r of Object.values(j[g])) delete r.sources; t = JSON.stringify(j); }
    assert.ok(!/[–—]/.test(t), `${f} has an em or en dash`);
    assert.ok(!/compliant/i.test(t), `${f} says compliant`);
    assert.ok(!BRANDS.test(t), `${f} names a brand: ${t.match(BRANDS)?.[0]}`);
    text += t;
  }
  assert.ok(/check with council/i.test(text));
  assert.ok(/suitably qualified engineer/.test(text));
  const src = readFileSync(join(here, '../src/viewer3d/terrain.js'), 'utf8');
  assert.ok(!/[–—]/.test(src.slice(src.indexOf('addCommercialPavements'))));
});
