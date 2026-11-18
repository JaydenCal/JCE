// Ground levels on the plan sheets: contour interval, contour generation, the shared ground layer, legend truth (plan PLANSET-PLAN section 10, invariants 8 to 13).
import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { exportPlanSet } from '../src/premium/exporters/planset/index.js';
import { toEngineeringPDF } from '../src/premium/exporters/eng/index.js';
import { catalogue } from '../src/catalogue/index.js';
import { chooseInterval, terrainContours, surfaceContours, CONTOUR_FINEST_M, intervalText } from '../src/premium/exporters/planset/contours.js';
import { levelsModel } from '../src/premium/exporters/planset/levels.js';
import { commercialModel, layoutView } from '../src/premium/exporters/planset/commercial.js';
import { buildingPolys } from '../src/commercial/catalogue/planset.js';
import * as G from '../src/model/geometry.js';
import { commercialCase, residentialCase, withTerrain, recordingPDF, contourChains, rlLabels } from './helpers/planset-fixtures.mjs';

const date = new Date(2026, 10, 18);
const CASES = ['flat', 'mid', 'steep'];


async function commercialSet(type, terrain) {
  const { Rec, pages } = recordingPDF();
  const r = await exportPlanSet({ project: commercialCase(type, terrain), kind: 'commercial', download: false, jsPDF: Rec, fetchSite: null, date });
  return { r, pages };
}
async function residentialSet(terrain) {
  const { Rec, pages } = recordingPDF();
  const r = await exportPlanSet({ project: residentialCase(terrain), kind: 'site', download: false, jsPDF: Rec, fetchSite: null, catalogue, date });
  return { r, pages };
}
async function engSet(terrain) {
  const { Rec, pages } = recordingPDF();
  const bytes = await toEngineeringPDF(residentialCase(terrain), { jsPDF: Rec, catalogue, date });
  return { bytes, pages };
}
const textOf = (page) => page.texts.map((t) => t.s).join('\n');
const codeOf = (s) => s.no.split('-').pop();

test('8: the finest interval is 0.5 m and chooseInterval follows the table', () => {
  assert.equal(CONTOUR_FINEST_M, 0.5);
  const at = (r) => chooseInterval(r);
  assert.deepEqual(at(0.5), { minor: 0.5, major: 2, decimals: 1 });
  assert.deepEqual(at(1.5), { minor: 0.5, major: 2, decimals: 1 });
  assert.deepEqual(at(3), { minor: 0.5, major: 2, decimals: 1 });
  assert.deepEqual(at(5), { minor: 1, major: 5, decimals: 1 });
  assert.deepEqual(at(10), { minor: 1, major: 5, decimals: 1 });
  assert.deepEqual(at(20), { minor: 2, major: 10, decimals: 0 });
  // The table as written before the owner cap is still reachable by the one constant.
  assert.deepEqual(chooseInterval(0.5, { finest: 0.25 }), { minor: 0.25, major: 1, decimals: 2 });
  // More than 40 levels steps the interval up.
  assert.ok(Math.floor(100 / chooseInterval(100).minor) + 1 <= 40);
  assert.equal(intervalText({ minor: 0.5, major: 2 }), '0.5 m minor, 2.0 m major');
});

test('9: terrainContours on a planar grid lie on the analytic contour, at multiples of the interval', () => {
  for (const cellMm of [1000, 5000]) {
    const a = 0.02; const b = -0.01; // m per m in x and y
    const cols = 41; const rows = 41;
    const values = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) values.push(100 + a * i * cellMm / 1000 + b * j * cellMm / 1000);
    const lot = { terrain: { cols, rows, cellMm, x0: 0, y0: 0, values } };
    const lines = terrainContours(lot, { minor: 0.5, major: 2 });
    assert.ok(lines.length > 0);
    const grad = Math.hypot(a, b);
    for (const c of lines) {
      assert.ok(Math.abs(c.level / 0.5 - Math.round(c.level / 0.5)) < 1e-9, `level ${c.level} is a multiple of the minor interval`);
      assert.equal(c.major, Math.abs(c.level / 2 - Math.round(c.level / 2)) < 1e-9);
      for (const p of c.pts) {
        const z = 100 + a * p.x / 1000 + b * p.y / 1000;
        assert.ok(Math.abs(z - c.level) / grad * 1000 < 20, `vertex ${Math.round(p.x)},${Math.round(p.y)} is ${Math.abs(z - c.level) / grad * 1000} mm off the ${c.level} contour`);
      }
    }
  }
});

test('surfaceContours contours any RL function and whereChanged keeps only the stretches that differ', async () => {
  const bb = { minX: 0, minY: 0, maxX: 40000, maxY: 40000 };
  const lines = surfaceContours((p) => 100 + p.x / 10000, bb, { minor: 0.5, major: 2 });
  assert.ok(lines.length >= 7);
  const { whereChanged } = await import('../src/premium/exporters/planset/contours.js');
  const kept = whereChanged(lines, (p) => 100 + p.x / 10000, (p) => 100 + p.x / 10000 + (p.y > 20000 ? 0.3 : 0), 0.05);
  assert.ok(kept.length > 0 && kept.every((c) => c.pts.every((p) => p.y >= 19000)));
});

test('10: every plan sheet draws at least three contour polylines and an RL label, at 0.6, 3 and 9 m of fall', async () => {
  const plan = new Set(['C100', 'C101', 'C102', 'A100', 'A101']);
  for (const terrain of CASES) {
    for (const type of ['warehouse', 'strata']) {
      const { r, pages } = await commercialSet(type, terrain);
      r.sheets.forEach((s, i) => {
        if (!plan.has(codeOf(s))) return;
        assert.ok(contourChains(pages[i]).length >= 3, `${type} ${terrain} ${codeOf(s)} has ${contourChains(pages[i]).length} contour lines`);
        assert.ok(rlLabels(pages[i]).length >= 1, `${type} ${terrain} ${codeOf(s)} has an RL label`);
      });
    }
    const res = await residentialSet(terrain);
    res.r.sheets.forEach((s, i) => {
      if (!plan.has(codeOf(s))) return;
      assert.ok(contourChains(res.pages[i]).length >= 3, `residential ${terrain} ${codeOf(s)}`);
      assert.ok(rlLabels(res.pages[i]).length >= 1, `residential ${terrain} ${codeOf(s)} label`);
    });
    const eng = await engSet(terrain);
    eng.bytes.layout.sheets.forEach((s, i) => {
      if (!['site', 'level', 'roof', 'analysis'].includes(s.kind)) return;
      assert.ok(contourChains(eng.pages[i]).length >= 3, `engineering ${terrain} ${s.kind} ${contourChains(eng.pages[i]).length}`);
      assert.ok(eng.pages[i].texts.some((t) => /^\d{2,4}(\.\d{1,2})?$/.test(t.s)), `engineering ${terrain} ${s.kind} RL label`);
    });
  }
});

test('contour labels are multiples of the interval and no sheet uses an interval finer than 0.5 m', async () => {
  const { r, pages } = await commercialSet('warehouse', 'flat');
  const i = r.sheets.findIndex((s) => codeOf(s) === 'C100');
  const t = textOf(pages[i]);
  assert.match(t, /Contours at 0\.5 m are an interpolation/);
  assert.ok(!/0\.25 m/.test(t));
  const labels = rlLabels(pages[i]).filter((l) => l.size === 5.6 && l.angle !== 0).map((l) => Number(l.s));
  assert.ok(labels.length > 0);
  for (const v of labels) assert.ok(Math.abs(v * 2 - Math.round(v * 2)) < 1e-9, `${v} is a multiple of 0.5`);
});

test('near level ground: no contour lines, spot levels and a note', async () => {
  const p = commercialCase('warehouse', 'none');
  withTerrain(p, { w: 60000, d: 100000, fall: 0.2, cross: 0, bump: 0, base: 100.15 });
  const { Rec, pages } = recordingPDF();
  const r = await exportPlanSet({ project: p, kind: 'commercial', download: false, jsPDF: Rec, fetchSite: null, date });
  const i = r.sheets.findIndex((s) => codeOf(s) === 'C100');
  const hasChains = contourChains(pages[i]).length;
  assert.equal(hasChains, 0, `${hasChains} contour lines on near level ground`);
  assert.ok(rlLabels(pages[i]).length >= 1, 'spot levels are shown');
  assert.match(textOf(pages[i]), /Ground is near level/);
});

test('11: no ground data, no contours, no contour legend, and the data block says so', async () => {
  const c = await commercialSet('warehouse', 'none');
  c.r.sheets.forEach((s, i) => {
    assert.equal(contourChains(c.pages[i]).length, 0, codeOf(s));
    assert.ok(!/Existing contour|Contours at|interpolat/i.test(textOf(c.pages[i])), `${codeOf(s)} mentions contours`);
  });
  for (const code of ['C100', 'C101']) {
    const i = c.r.sheets.findIndex((s) => codeOf(s) === code);
    assert.match(textOf(c.pages[i]), /None for this lot|No ground levels/);
    if (code === 'C101') assert.match(textOf(c.pages[i]), /ASSUMED DATUM/, 'floor level is on an assumed datum');
  }
  const res = await residentialSet('none');
  res.r.sheets.forEach((s, i) => { assert.equal(contourChains(res.pages[i]).length, 0); assert.ok(!/Existing contour|Contours at|interpolat/i.test(textOf(res.pages[i]))); });
  assert.match(textOf(res.pages[1]), /No ground levels for this lot/);
  const eng = await engSet('none');
  eng.pages.forEach((pg, i) => { assert.equal(contourChains(pg).length, 0, `eng page ${i + 1}`); assert.ok(!/Existing (ground )?contour/i.test(textOf(pg))); });
});

test('12: the legend lists contours if and only if contour lines were stroked on that sheet', async () => {
  for (const terrain of ['none', 'mid']) {
    const sets = [];
    const c = await commercialSet('warehouse', terrain);
    c.r.sheets.forEach((s, i) => sets.push([`com ${codeOf(s)}`, c.pages[i]]));
    const res = await residentialSet(terrain);
    res.r.sheets.forEach((s, i) => sets.push([`res ${codeOf(s)}`, res.pages[i]]));
    const eng = await engSet(terrain);
    eng.bytes.layout.sheets.forEach((s, i) => sets.push([`eng ${s.kind} ${i}`, eng.pages[i]]));
    for (const [name, pg] of sets) {
      const stroked = contourChains(pg).length > 0;
      const listed = /Existing (ground )?contour|Design contour|existing ground contours/.test(textOf(pg));
      assert.equal(listed, stroked, `${name} (${terrain}): legend ${listed}, strokes ${stroked}`);
    }
  }
});

test('13: no contour segment is stroked inside a building or unit outline on C101', async () => {
  for (const type of ['warehouse', 'strata', 'service-station']) {
    const p = commercialCase(type, 'mid');
    const { Rec, pages } = recordingPDF();
    const r = await exportPlanSet({ project: p, kind: 'commercial', download: false, jsPDF: Rec, fetchSite: null, date });
    const i = r.sheets.findIndex((s) => codeOf(s) === 'C101');
    const lot = p.site.lot;
    const model = commercialModel(structuredClone(p), lot, { levels: levelsModel(p, lot) });
    const view = layoutView(model);
    const outlines = [...model.units.map((u) => u.poly), ...buildingPolys(model.c)].map((q) => q.map(view.T));
    let checked = 0;
    for (const ch of contourChains(pages[i])) {
      for (let k = 0; k + 1 < ch.length; k++) {
        const a = ch[k]; const b = ch[k + 1];
        if (Math.hypot(a.x - b.x, a.y - b.y) < 0.05) continue;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        checked++;
        assert.ok(!outlines.some((o) => G.pointInPolygon(mid, o)), `${type}: a contour segment at ${mid.x.toFixed(1)},${mid.y.toFixed(1)} is inside a building`);
      }
    }
    assert.ok(checked > 20);
  }
});

test('levels model: floor level is the design surface at the building plus the slab, and an assumed datum without ground', () => {
  const p = commercialCase('warehouse', 'mid');
  const lv = levelsModel(p, p.site.lot);
  assert.ok(lv.has && lv.source === 'dem');
  const fl = lv.fflOf('B1') ?? lv.floorRL;
  assert.ok(Number.isFinite(fl));
  const none = levelsModel(commercialCase('warehouse', 'none'), commercialCase('warehouse', 'none').site.lot);
  assert.equal(none.has, false);
  assert.equal(none.floorRL, 100);
  assert.equal(none.natural({ x: 0, y: 0 }), null);
});

test('wording on the sheets with levels: no forbidden word, no dashes, dates DD/MM/YYYY', async () => {
  const c = await commercialSet('warehouse', 'mid');
  const res = await residentialSet('mid');
  const eng = await engSet('mid');
  for (const pg of [...c.pages, ...res.pages, ...eng.pages]) {
    const t = textOf(pg);
    assert.ok(!/compliant/i.test(t));
    assert.ok(!/[–—]/.test(t));
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(t));
  }
});
