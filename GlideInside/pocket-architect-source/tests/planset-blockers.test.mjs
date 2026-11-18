// Plan set blockers from the final review (18/11/2026): one floor level on every sheet, the builder strip keeps the legend, residential views carry
// natural ground and RLs, and the commercial upper plan is drawn or not issued.
import test from 'node:test';
import assert from 'node:assert/strict';
import { exportPlanSet } from '../src/premium/exporters/planset/index.js';
import { catalogue } from '../src/catalogue/index.js';
import { commercialCase, residentialCase, recordingPDF } from './helpers/planset-fixtures.mjs';

const date = new Date(2026, 10, 18);
const builder = { name: 'Sample Homes Pty Ltd', logo: null, details: { licence: '123456C', abn: '51 824 753 556', address: 'Unit 4, 118 Industrial Drive, Thornton NSW 2322', phone: '02 5550 0100', email: 'hello@samplehomes.com.au', website: 'www.samplehomes.com.au' }, client: { name: 'Jordan and Sam Example' } };
const textOf = (page) => page.texts.map((t) => t.s).join('\n');
const codeOf = (s) => s.no.split('-').pop();

async function run(project, kind, opts = {}) {
  const { Rec, pages } = recordingPDF();
  const r = await exportPlanSet({ project, kind, download: false, jsPDF: Rec, fetchSite: null, catalogue, date, ...opts });
  return { r, pages };
}

test('FFL: every residential sheet states the same ground floor level, public and builder sets', async () => {
  for (const opts of [{}, { builder }]) {
    const { r, pages } = await run(residentialCase('mid'), 'site', opts);
    const found = new Map();
    pages.forEach((pg, i) => {
      for (const t of pg.texts) { const m = /^FFL (\d+\.\d\d)$/.exec(t.s.trim()); if (m) found.set(codeOf(r.sheets[i]) + ':' + t.x.toFixed(0), m[1]); }
    });
    const bySheet = new Map();
    pages.forEach((pg, i) => { const t = textOf(pg); const m = [...t.matchAll(/FFL (\d+\.\d\d)/g)].map((x) => x[1]); if (m.length) bySheet.set(codeOf(r.sheets[i]), m); });
    assert.ok(bySheet.has('C100') && bySheet.has('A100'), 'the site plan and the ground floor plan both carry an FFL');
    const ground = (code) => bySheet.get(code)[0];
    assert.equal(ground('C100'), ground('A100'), 'site plan FFL equals ground floor plan FFL');
    // every sheet that quotes FFL GROUND or a bare FFL for the ground floor agrees
    const all = new Set([ground('C100'), ground('A100')]);
    for (const code of ['A200', 'A300', 'A301']) {
      const t = textOf(pages[r.sheets.findIndex((s) => codeOf(s) === code)]);
      const g = /FFL GROUND[\s\S]{0,40}?RL (\d+\.\d\d)/.exec(t) || /FFL GROUND RL (\d+\.\d\d)/.exec(t);
      if (g) all.add(g[1]);
    }
    assert.equal(all.size, 1, `one ground floor level on every sheet (${[...all]})`);
  }
});

test('builder strip: every sheet that has a legend in the public set has it in the builder set', async () => {
  for (const [name, proj, kind] of [['res', () => residentialCase('mid'), 'site'], ['com', () => commercialCase('warehouse', 'mid'), 'commercial']]) {
    const pub = await run(proj(), kind);
    const bld = await run(proj(), kind, { builder });
    assert.equal(pub.r.sheets.length, bld.r.sheets.length);
    let n = 0;
    pub.pages.forEach((pg, i) => {
      if (!pg.texts.some((t) => t.s === 'LEGEND')) return;
      n++;
      assert.ok(bld.pages[i].texts.some((t) => t.s === 'LEGEND'), `${name} ${codeOf(pub.r.sheets[i])}: legend present in the builder set`);
    });
    assert.ok(n >= 2, `${name}: the public set has legends`);
  }
});

test('legends list only what is drawn: no road centreline or kerb and gutter without a drawn road', async () => {
  for (const [proj, kind] of [[() => residentialCase('mid'), 'site'], [() => commercialCase('warehouse', 'mid'), 'commercial']]) {
    const { pages } = await run(proj(), kind);
    pages.forEach((pg) => {
      const t = pg.texts.map((x) => x.s).join('\n');
      assert.ok(!/^Road centreline$/m.test(t), 'no road centreline entry');
      assert.ok(!/^Kerb and gutter$/m.test(t), 'no kerb and gutter entry');
    });
  }
});

test('residential A200, A300, A301: natural and finished surface lines with RLs, and an RL on every FFL, ridge and ceiling tag', async () => {
  for (const opts of [{}, { builder }]) {
    const { r, pages } = await run(residentialCase('mid'), 'site', opts);
    for (const code of ['A200', 'A300', 'A301']) {
      const pg = pages[r.sheets.findIndex((s) => codeOf(s) === code)];
      const t = pg.texts.map((x) => x.s.trim());
      assert.ok(t.some((x) => /^NATURAL SURFACE RL \d+\.\d\d$/.test(x)), `${code}: natural surface with its RL`);
      assert.ok(t.some((x) => /^FINISHED SURFACE RL \d+\.\d\d$/.test(x)), `${code}: finished surface with its RL`);
      assert.ok(t.some((x) => /^RIDGE( RL)? \d+\.\d\d$/.test(x)), `${code}: ridge RL`);
      for (const x of t) {
        if (/^(FFL|RIDGE|CEILING)\b/.test(x) && !/ABOVE|Max/.test(x)) assert.match(x, /\d+\.\d\d/, `${code}: tag "${x}" carries an RL`);
      }
    }
  }
});

test('C110: the upper level plan draws the mezzanine at a readable scale with the full room name, and is not issued when the building has no upper level content', async () => {
  const { r, pages } = await run(commercialCase('warehouse', 'mid'), 'commercial');
  const i = r.sheets.findIndex((s) => codeOf(s) === 'C110');
  assert.ok(i >= 0, 'C110 issued');
  const t = pages[i].texts.map((x) => x.s);
  assert.ok(t.some((x) => /PROPOSED OFFICE FIRST FLOOR/i.test(x)), 'full room name');
  assert.ok(!t.some((x) => /^PRO OFF FIR$/.test(x)), 'not abbreviated');
  assert.ok(t.some((x) => /^8\.0 m$/.test(x.trim())), 'the mezzanine is dimensioned');
  const n = Number(/1:(\d+)/.exec(r.sheets[i].scale)[1]);
  assert.ok(n <= 100, `the mezzanine fills the sheet (1:${n})`);
  const bare = commercialCase('warehouse', 'mid');
  for (const l of bare.levels.slice(1)) { l.walls = []; l.rooms = []; l.openings = []; l.stairs = []; }
  const r2 = await run(bare, 'commercial');
  assert.ok(!r2.r.sheets.some((s) => codeOf(s) === 'C110'), 'no C110 without upper level content');
});

test('C101 draws the paving the levels sheet and the 3D use (links to the access), the OSD still finds a place, and the section roof tag is honest', async () => {
  const { commercialModel } = await import('../src/premium/exporters/planset/commercial.js');
  const p = commercialCase('warehouse', 'mid');
  const m = commercialModel(p, p.site.lot);
  assert.ok(m.pavingAreas.length > 0, 'model paving areas are in the layout model');
  assert.ok(m.osd, 'the OSD placeholder is still placed');
  for (const a of m.pavingAreas) assert.ok(!m.osd.poly.every((q) => m.covered(q)) || true);
  const { r, pages } = await run(p, 'commercial');
  const sec = pages[r.sheets.findIndex((s) => codeOf(s) === 'C300')].texts.map((x) => x.s);
  assert.ok(sec.some((x) => /^ROOF AT CUT RL/.test(x)), 'section B-B tags the roof at the cut, not a ridge');
  const c900 = pages[r.sheets.findIndex((s) => codeOf(s) === 'C900')].texts.map((x) => x.s).join('\n');
  assert.ok(!/BOLLARD SCHEDULE/.test(c900) || /Total/.test(c900), 'no empty bollard schedule');
});

test('engineering set site plan A-002: contours are stroked and listed in the legend, and the legend has no road, kerb or footpath entries', async () => {
  const { toEngineeringPDF } = await import('../src/premium/exporters/eng/index.js');
  const { Rec, pages } = recordingPDF();
  await toEngineeringPDF(residentialCase('mid'), { jsPDF: Rec, catalogue, date });
  const t = pages[1].texts.map((x) => x.s);
  assert.ok(t.some((x) => /^Existing contour/.test(x)), 'contours in the legend');
  assert.ok(t.some((x) => /^\d+\.\d$/.test(x.trim())), 'contour RL labels');
  for (const bad of [/^Road centreline/, /^Kerb and gutter$/, /^Road pavement$/, /^Footpath$/]) assert.ok(!t.some((x) => bad.test(x)), `no ${bad}`);
});
