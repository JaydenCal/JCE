// Clean site plan (owner request 19/11/2026): a second site plan sheet straight after the aerial one, the same plan with no aerial image.
// Residential public and builder sets and the commercial set carry C100A, the engineering set carries a second SITE PLAN sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { jsPDF } from 'jspdf';
import { exportPlanSet, planSetSheets } from '../src/premium/exporters/planset/index.js';
import { toEngineeringPDF, engineeringSheets } from '../src/premium/exporters/eng/index.js';
import { catalogue } from '../src/catalogue/index.js';
import { commercialCase, residentialCase, recordingPDF } from './helpers/planset-fixtures.mjs';

const date = new Date(2026, 10, 19);
const textOf = (page) => page.texts.map((t) => t.s).join('\n');
const codeOf = (s) => s.no.split('-').pop();
const builder = { name: 'Sample Homes Pty Ltd', logo: null, details: { licence: '123456C', abn: '51 824 753 556', address: 'Unit 4, 118 Industrial Drive, Thornton NSW 2322', phone: '02 5550 0100', email: 'hello@samplehomes.com.au', website: 'www.samplehomes.com.au' }, client: { name: 'Jordan and Sam Example' } };
const resSet = async (extra = {}) => { const { Rec, pages } = recordingPDF(); const r = await exportPlanSet({ project: residentialCase('mid'), kind: 'site', download: false, jsPDF: Rec, fetchSite: null, catalogue, date, ...extra }); return { r, pages }; };

// The title block wordmark is a small image on every sheet (right strip on the planset sheets, bottom left on the engineering sheets). Any other image is on the drawing.
const onDrawing = (page, eng) => page.images.filter((im) => !(eng ? im.y >= 245 && im.h < 12 : im.x >= 330 && im.h < 12));
function assertClean(page, label, eng = false) {
  assert.equal(onDrawing(page, eng).length, 0, `${label}: no image draw calls on the drawing`);
  const t = textOf(page);
  assert.ok(/NO AERIAL/.test(t.replace(/\s+/g, ' ')), `${label}: titled NO AERIAL`);
  assert.ok(/\d+°\d\d'\d\d"/.test(t), `${label}: bearings`);
  assert.ok(!/compliant/i.test(t) && !/[–—]/.test(t), `${label}: owner wording rules`);
  assert.ok(/N/.test(t) && /@ A3/.test(t), `${label}: scale and north`);
}

test('residential public set: C100A SITE PLAN NO AERIAL sits straight after C100, with no image and the Glide Inside block', async () => {
  const { r, pages } = await resSet();
  const codes = r.sheets.map(codeOf);
  assert.deepEqual(codes, ['C000', 'C100', 'C100A', 'A100', 'A101', 'A200', 'A300', 'A301']);
  const i = codes.indexOf('C100A');
  assert.equal(r.sheets[i].title, 'SITE PLAN NO AERIAL');
  assertClean(pages[i], 'public C100A');
  const t = textOf(pages[i]);
  assert.ok(/Glide Inside, ABN 11 549 431 925|ABN 11 549 431 925/.test(t), 'public title block');
  assert.ok(!/Powered by Glide Inside/.test(t));
  assert.ok(/FFL/.test(t) && /contour/i.test(t), 'levels and contours as on C100');
  // the cover drawing list names it and the page count agrees
  assert.ok(textOf(pages[0]).includes('GI-L7DP99-C100A') && textOf(pages[0]).includes('SITE PLAN NO AERIAL'));
  assert.equal(r.pages, pages.length);
  assert.deepEqual(planSetSheets({ project: residentialCase('mid'), lot: null, kind: 'site' }).map((s) => s.code).slice(0, 3), ['C000', 'C100', 'C100A']);
});

test('residential builder set: C100A carries the builder title block and Powered by Glide Inside, no image', async () => {
  const { r, pages } = await resSet({ builder });
  const i = r.sheets.map(codeOf).indexOf('C100A');
  assert.equal(i, 2);
  assertClean(pages[i], 'builder C100A');
  const t = textOf(pages[i]);
  assert.ok(t.includes('Sample Homes Pty Ltd') && t.includes('Powered by Glide Inside'));
  pages.forEach((pg, k) => assert.ok(/Powered by Glide Inside/.test(textOf(pg)), `credit on sheet ${k + 1}`));
});

test('the recorder sees aerial pictures: a lot with a real aerial draws one on the cover locality plan but none on C100A', async () => {
  const houses = JSON.parse(fs.readFileSync(new URL('../../golive/builder-houses/hunter-homes.json', import.meta.url), 'utf8'));
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const lot = { boundaryM: rect(0, 0, 36, 60), frontEdge: 0, lotNumber: '12', planLabel: 'DP 1234567', address: '12 Sample Street', lga: 'Maitland City Council', setbacks: { front: 6, side: 0.9, rear: 3 }, neighbours: [] };
  const aerial = { image: new Uint8Array(fs.readFileSync(new URL('./fixtures/aerial-test.jpg', import.meta.url))), extentM: { minE: -282, minN: -270, maxE: 318, maxN: 330 }, state: 'NSW' };
  const { Rec, pages } = recordingPDF();
  const r = await exportPlanSet({ project: houses[0].project, lot, kind: 'site', download: false, jsPDF: Rec, fetchSite: null, aerial, date });
  const i = r.sheets.map(codeOf).indexOf('C100A');
  assert.ok(onDrawing(pages[0]).length >= 1, 'the cover draws the aerial');
  assert.equal(onDrawing(pages[i]).length, 0, 'C100A draws none');
});

test('commercial set: C100A EXISTING SITE AND LEVELS NO AERIAL follows C100, no image, later codes unchanged', async () => {
  const { Rec, pages } = recordingPDF();
  const r = await exportPlanSet({ project: commercialCase('warehouse', 'mid'), kind: 'commercial', download: false, jsPDF: Rec, fetchSite: null, date });
  const codes = r.sheets.map(codeOf);
  assert.deepEqual(codes.slice(0, 5), ['C000', 'C100', 'C100A', 'C101', 'C102']);
  assert.deepEqual(codes.slice(-2), ['C900', 'C910']);
  const i = codes.indexOf('C100A');
  assert.equal(r.sheets[i].title, 'EXISTING SITE AND LEVELS NO AERIAL');
  assertClean(pages[i], 'commercial C100A');
  assert.ok(textOf(pages[i]).includes('ABN 11 549 431 925'));
  assert.equal(r.pages, pages.length);
  assert.ok(textOf(pages[0]).includes('C100A'), 'cover drawing list');
});

test('engineering set: a second SITE PLAN NO AERIAL sheet follows the site plan, numbers run on, no image, public and builder blocks', async () => {
  const plan = engineeringSheets(residentialCase('mid'), { catalogue });
  assert.deepEqual(plan.list.slice(0, 3).map((s) => s.title), ['COVER SHEET AND DRAWING LIST', 'SITE PLAN', 'SITE PLAN NO AERIAL']);
  for (const opts of [{}, { builder }]) {
    const { Rec, pages } = recordingPDF();
    const bytes = await toEngineeringPDF(residentialCase('mid'), { jsPDF: Rec, catalogue, date, ...opts });
    const sheets = bytes.layout.sheets;
    assert.equal(sheets.length, pages.length);
    assert.deepEqual(sheets.map((s) => Number(s.number.slice(-3))), sheets.map((_, k) => k + 1), 'numbers run on');
    const t = textOf(pages[2]);
    assert.equal(sheets[2].title, 'SITE PLAN NO AERIAL');
    assertClean(pages[2], 'eng A-003', true);
    assert.ok(opts.builder ? t.includes('Powered by Glide Inside') : t.includes('ABN 11 549 431 925'));
    assert.ok(/contour/i.test(t) && /FFL/.test(t));
    assert.ok(/site plan no aerial/i.test(textOf(pages[0])), 'drawing list');
  }
});

// ---- C100 on the aerial, C100A clean ----
const aerialCase = () => {
  const houses = JSON.parse(fs.readFileSync(new URL('../../golive/builder-houses/hunter-homes.json', import.meta.url), 'utf8'));
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const lot = { boundaryM: rect(0, 0, 36, 60), frontEdge: 0, lotNumber: '12', planLabel: 'DP 1234567', address: '12 Sample Street', lga: 'Maitland City Council', setbacks: { front: 6, side: 0.9, rear: 3 }, neighbours: [] };
  const aerial = { image: new Uint8Array(fs.readFileSync(new URL('./fixtures/aerial-test.jpg', import.meta.url))), extentM: { minE: -282, minN: -270, maxE: 318, maxN: 330 }, state: 'NSW' };
  return { project: houses[0].project, lot, aerial };
};

test('residential C100 draws the lot aerial once under the plan, C100A none, and the cover list agrees', async () => {
  const c = aerialCase();
  for (const extra of [{}, { builder }]) {
    const { Rec, pages } = recordingPDF();
    const r = await exportPlanSet({ project: c.project, lot: c.lot, kind: 'site', download: false, jsPDF: Rec, fetchSite: null, aerial: c.aerial, date, ...extra });
    const codes = r.sheets.map(codeOf);
    const a = codes.indexOf('C100');
    const b = codes.indexOf('C100A');
    assert.equal(onDrawing(pages[a]).length, 1, 'C100: one aerial image');
    assert.equal(onDrawing(pages[b]).length, 0, 'C100A: none');
    assert.ok(!/Aerial not available for this sheet/.test(textOf(pages[a])));
    assert.match(r.sheets[a].scale, /^1:\d+ @ A3$/);
  }
});

test('residential C100 without an aerial falls back to the clean look and says so in the credits', async () => {
  const { r, pages } = await resSet();
  const a = r.sheets.map(codeOf).indexOf('C100');
  assert.equal(onDrawing(pages[a]).length, 0);
  assert.match(textOf(pages[a]), /Aerial not available for this sheet/);
  assert.ok(!/Aerial not available for this sheet/.test(textOf(pages[a + 1])));
});
