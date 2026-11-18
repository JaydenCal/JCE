// Plan set review 2 fixes (18/11/2026): one floor level on the engineering set, no ground contours on floor and roof plans,
// legends that list only what is drawn, no road reserve wording, and a scale bar on the elevations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { exportPlanSet } from '../src/premium/exporters/planset/index.js';
import { toEngineeringPDF } from '../src/premium/exporters/eng/index.js';
import { catalogue } from '../src/catalogue/index.js';
import { commercialCase, residentialCase, recordingPDF } from './helpers/planset-fixtures.mjs';

const date = new Date(2026, 10, 18);
const textOf = (page) => page.texts.map((t) => t.s).join('\n');
const codeOf = (s) => s.no.split('-').pop();

async function engSet() {
  const { Rec, pages } = recordingPDF();
  const bytes = await toEngineeringPDF(residentialCase('mid'), { jsPDF: Rec, catalogue, date });
  return { pages, sheets: bytes.layout.sheets };
}

test('engineering set: one floor level on every sheet and no "not set" text', async () => {
  const { pages, sheets } = await engSet();
  pages.forEach((pg, i) => assert.ok(!/not set/i.test(textOf(pg)), `no "not set" on ${sheets[i].number}`));
  const ffl = (n) => { const t = textOf(pages[sheets.findIndex((s) => s.number.endsWith(n))]); return new Set([...t.matchAll(/(?:FFL|RL|Floor level[^\n]*?)\s*(102\.59)/g)].map((m) => m[1])); };
  for (const n of ['A-002', 'A-003', 'A-006', 'A-007', 'A-008']) assert.ok(ffl(n).has('102.59'), `${n} states FFL 102.59`);
  const all = pages.map(textOf).join('\n');
  assert.ok(/NATURAL SURFACE RL/.test(textOf(pages[sheets.findIndex((s) => s.number.endsWith('A-006'))])), 'elevations carry the natural surface');
  assert.ok(/NATURAL SURFACE RL/.test(textOf(pages[sheets.findIndex((s) => s.number.endsWith('A-007'))])), 'the section carries the natural surface');
});

test('floor plans and roof plans carry no ground contours, site plans keep them', async () => {
  const { r, pages } = await (async () => {
    const { Rec, pages: pg } = recordingPDF();
    const r = await exportPlanSet({ project: residentialCase('mid'), kind: 'site', download: false, jsPDF: Rec, fetchSite: null, catalogue, date });
    return { r, pages: pg };
  })();
  const t = (code) => textOf(pages[r.sheets.findIndex((s) => codeOf(s) === code)]);
  for (const code of ['A100', 'A101']) assert.ok(!/contour/i.test(t(code)), `no contour text on ${code}`);
  assert.ok(/contour/i.test(t('C100')), 'the site plan keeps its contours');
  const e = await engSet();
  e.sheets.forEach((s, i) => {
    const x = textOf(e.pages[i]);
    if (s.kind === 'level' || s.kind === 'roof') assert.ok(!/ground contour/i.test(x), `no ground contours on ${s.number}`);
    if (s.kind === 'site') assert.ok(/contour/i.test(x), 'the engineering site plan keeps its contours');
  });
  const { Rec, pages: cp } = recordingPDF();
  const c = await exportPlanSet({ project: commercialCase('warehouse', 'mid'), kind: 'commercial', download: false, jsPDF: Rec, fetchSite: null, catalogue, date });
  c.sheets.forEach((s, i) => { if (codeOf(s).startsWith('C11')) assert.ok(!/contour/i.test(textOf(cp[i])), `no contours on ${codeOf(s)}`); });
});

test('legends list only what is drawn, notes name no road reserve, elevations have a scale bar', async () => {
  const { Rec, pages } = recordingPDF();
  const c = await exportPlanSet({ project: commercialCase('warehouse', 'mid'), kind: 'commercial', download: false, jsPDF: Rec, fetchSite: null, catalogue, date });
  const t101 = textOf(pages[c.sheets.findIndex((s) => codeOf(s) === 'C101')]);
  for (const bad of [/^Personnel door$/m, /^Roller door$/m, /^Bollard$/m, /^Hydrant$/m, /^Waste enclosure$/m]) assert.ok(!bad.test(t101), `C101 legend has no ${bad}`);
  const r = await (async () => { const rec = recordingPDF(); const x = await exportPlanSet({ project: residentialCase('mid'), kind: 'site', download: false, jsPDF: rec.Rec, fetchSite: null, catalogue, date }); return { x, pages: rec.pages }; })();
  r.pages.forEach((pg, i) => assert.ok(!/road reserve/i.test(textOf(pg)), `no road reserve wording on ${r.x.sheets[i].no}`));
  const a200 = textOf(r.pages[r.x.sheets.findIndex((s) => codeOf(s) === 'A200')]);
  assert.ok(/^10$/m.test(a200) && /^m$/m.test(a200), 'A200 has a scale bar with metre labels');
  const e = await engSet();
  e.pages.forEach((pg, i) => assert.ok(!/road reserve/i.test(textOf(pg)), `no road reserve wording on ${e.sheets[i].number}`));
  const site = textOf(e.pages[1]);
  assert.ok(!/^Neighbouring lot boundary$/m.test(site), 'no neighbouring lot legend entry when none is drawn');
});

// ---- NB1: heights must not depend on the floor level ---------------------------------------------------------------------------
const topOf = async (p) => {
  const { collectTriangles } = await import('../src/premium/exporters/eng/views.js');
  const t = await collectTriangles(p, catalogue);
  return Math.round(Math.max(...t.flatMap((q) => q.p.map((v) => v.z))));
};

test('model top above the ground floor is identical with and without a floor level (two storey and a second house type)', async () => {
  for (const make of [() => residentialCase('mid'), () => residentialCase('steep'), () => residentialCase('flat')]) {
    const heights = [];
    for (const fl of [null, 102.59, 110]) { const p = make(); p.site.lot.floorRL = fl; heights.push(await topOf(p)); }
    assert.equal(new Set(heights).size, 1, `top ${heights}`);
  }
});

test('3D build: a floor level the person set puts the house at that level (not moved to the natural ground)', async () => {
  const { buildModel } = await import('../src/viewer3d/build.js');
  const minWallY = (p) => { const g = buildModel(p, { catalogue, showRoof: true, statusView: 'proposed', levelFilter: 'all' }); g.updateMatrixWorld(true); let mn = 1e9; g.traverse((o) => { if (!o.isMesh || !/^wall:/.test(o.name || '')) return; const pos = o.geometry.attributes.position; for (let i = 0; i < pos.count; i++) mn = Math.min(mn, pos.getY(i) * o.matrixWorld.elements[5] + o.matrixWorld.elements[13]); }); return mn; };
  const p = residentialCase('mid'); p.site.lot.floorRL = 102.59; p.site.lot.floorRLAuto = false;
  assert.ok(Math.abs(minWallY(p)) < 1e-6, 'walls start at the ground floor level (Y 0)');
});

test('engineering ridge RL and height above FFL match the residential sheets A200 and A300', async () => {
  const eng = await engSet();
  const { Rec, pages } = recordingPDF();
  const r = await exportPlanSet({ project: residentialCase('mid'), kind: 'site', download: false, jsPDF: Rec, fetchSite: null, catalogue, date });
  const ridge = (t) => [...new Set([...t.replace(/\n/g, " ").matchAll(/RIDGE (?:RL )?(\d+\.\d\d)/g)].map((m) => m[1]))];
  const above = (t) => [...t.replace(/\n/g, " ").matchAll(/(\d+\.\d\d) m ABOVE FFL/g)].map((m) => m[1]);
  const resText = (c) => textOf(pages[r.sheets.findIndex((s) => codeOf(s) === c)]);
  const engText = (n) => textOf(eng.pages[eng.sheets.findIndex((s) => s.number.endsWith(n))]);
  const want = ridge(resText('A200'));
  assert.equal(want.length, 1);
  for (const t of [engText('A-006'), engText('A-007'), resText('A300')]) assert.deepEqual(ridge(t), want);
  const hp = /(\d+\.\d\d) m above FFL, RL (\d+\.\d\d)/.exec(engText('A-005').replace(/\n/g, ' '));
  assert.ok(hp, 'roof plan highest point');
  assert.equal(hp[2], want[0]);
  assert.equal(hp[1], above(resText('A300'))[0]);
  assert.deepEqual(above(engText('A-007')), above(resText('A300')), 'height above FFL on the section');
});

test('a floor level the person set moves only the first pad: a second commercial building keeps its own level', async () => {
  const { terrainModel } = await import('../src/viewer3d/terrain.js');
  const make = () => {
    const p = commercialCase('warehouse', 'steep');
    const b2 = structuredClone(p.commercial.buildings[0]);
    b2.id = 'bld_second';
    b2.params = { ...b2.params, spanMm: 12000, depthMm: 15000, docks: 1, apronDepthMm: 12000 };
    b2.place = { ...b2.place, y: 6000 }; // at the other end of the lot, well clear of the first building
    p.commercial.buildings.push(b2);
    return p;
  };
  const auto = terrainModel(make());
  const set = make();
  set.site.lot.floorRL = auto.floorRL;
  set.site.lot.floorRLAuto = false;
  const person = terrainModel(set);
  assert.equal(auto.pads.length, 2, 'two building pads');
  assert.equal(person.pads.length, 2);
  assert.ok(Math.abs(auto.pads[1].dy) > 0.1, `the second building has its own level on the steep lot (${auto.pads[1].dy})`);
  assert.equal(person.pads[0].dy, 0, 'the first building sits at the level the person set');
  assert.equal(person.pads[1].dy, auto.pads[1].dy, 'the second building keeps the shift it gets with the automatic level');
});
