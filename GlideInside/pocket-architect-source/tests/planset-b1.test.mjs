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
