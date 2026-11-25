// 3D renders in the plan sets: a large render on the cover and a "3D VIEWS" sheet (A400) of four captioned views, from the app's 3D scene. Without pictures
// (no WebGL, or a server build that was sent none) the sheet and the cover picture are left out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { exportPlanSet, planSetSheets } from '../src/premium/exporters/planset/index.js';
import { cleanViews3d } from '../src/premium/exporters/planset/views3d-clean.js';
import { viewSizes, SHEET_VIEWS } from '../src/premium/exporters/planset/views3d.js';
import { createProject } from '../src/model/schema.js';
import { applyOp } from '../src/model/ops.js';
import { recordingPDF } from './helpers/planset-fixtures.mjs';
import { hvsShedProject, syntheticAerial } from './helpers/hvs-shed-fixture.mjs';
import { renderPlanSet, SKIP } from './helpers/planset3d-browser.mjs';

// A 4 x 3 pixel PNG (valid header and size), as a data URL.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAAFklEQVR4nGP4z8Dwn4GBgYGBgYEBABAKAQE5Y1uBAAAAAElFTkSuQmCC';
const pics = () => ({ cover: PNG, views: SHEET_VIEWS.map((v) => ({ key: v.key, label: v.label, image: PNG })) });
const date = new Date(2026, 10, 25);
const run = async (o = {}) => {
  const { Rec, pages } = recordingPDF();
  const r = await exportPlanSet({ project: hvsShedProject(), kind: 'commercial', download: false, jsPDF: Rec, fetchSite: null, aerial: [syntheticAerial()], date, ...o });
  return { r, pages, codes: r.sheets.map((s) => s.no.split('-').pop()) };
};
const all = (page) => (page?.texts || []).map((t) => t.s).join(' | ');

test('sheet plans: A400 3D VIEWS follows the elevations and sections, only when there are pictures', () => {
  const p = hvsShedProject();
  const lot = p.site.lot;
  const off = planSetSheets({ project: p, lot, kind: 'commercial' }).map((s) => s.code);
  const on = planSetSheets({ project: p, lot, kind: 'commercial', has3d: true }).map((s) => s.code);
  assert.ok(!off.includes('A400'));
  assert.ok(on.includes('A400'));
  assert.equal(on.indexOf('A400'), on.length - 1, 'the shed set ends with the 3D views, after the sections');
  assert.ok(on.indexOf('A300') < on.indexOf('A400'));
});

test('cleanViews3d keeps only checked image data URLs and at most four views', () => {
  assert.equal(cleanViews3d(null), null);
  assert.equal(cleanViews3d({ cover: 'http://x/y.png', views: [{ image: '<script>' }] }), null);
  const ok = cleanViews3d({ cover: PNG, views: [...pics().views, { key: 'x', label: 'extra', image: PNG }, { key: 'bad', label: 'bad', image: 'nope' }] });
  assert.equal(ok.cover, PNG);
  assert.equal(ok.views.length, 4);
  assert.ok(cleanViews3d({ cover: PNG, views: [] }).cover);
});

test('render sizes: the cover picture is at least 2400 px wide, 2048 on a phone', () => {
  assert.ok(viewSizes({ phone: false }).cover.width >= 2400);
  assert.equal(viewSizes({ phone: true }).cover.width, 2048);
  assert.ok(viewSizes({ phone: true }).view.width <= 2048);
});

test('with pictures: the cover carries the render, A400 has four captioned views, the index lists it and the title block is unchanged', async () => {
  const { r, pages, codes } = await run({ views3d: pics() });
  assert.ok(codes.includes('A400'));
  const i = codes.indexOf('A400');
  assert.equal(pages[i].images.filter((im) => im.w > 100).length, 4, 'four large pictures on the sheet');
  const text = all(pages[i]);
  for (const v of SHEET_VIEWS) assert.ok(text.includes(v.label), v.label);
  assert.match(text, /3D VIEWS/);
  assert.match(text, /CONCEPT ONLY/);
  const cover = pages[0];
  assert.ok(cover.images.some((im) => im.w > 100), 'the cover has a large picture');
  assert.match(all(cover), /3D VIEW, FRONT THREE QUARTER/);
  assert.match(all(cover), /A400/);
  assert.equal(r.pages, codes.length);
});

test('without pictures the sheet and the cover picture are left out', async () => {
  const { codes, pages } = await run({ views3d: null });
  assert.ok(!codes.includes('A400'));
  assert.ok(!/3D VIEW, FRONT/.test(all(pages[0])));
  const none = await run();
  assert.ok(!none.codes.includes('A400'), 'a Node build with no browser and no pictures has no 3D sheet');
});

test('the same pictures work for the commercial layout set (C400) and the house set (A400)', async () => {
  const { planSetSheets: sheets } = await import('../src/premium/exporters/planset/index.js');
  assert.ok(sheets({ project: hvsShedProject(), lot: hvsShedProject().site.lot, kind: 'commercial', has3d: true }).some((s) => s.id === 'views3d'));
  const house = createProject({ id: 'p_3d', name: 'House' });
  applyOp(house, 'add_room', { type: 'living', name: 'Living', x: 0, y: 0, width: 6000, depth: 4500 });
  const codes = sheets({ project: house, lot: null, kind: 'house', has3d: true }).map((s) => s.code);
  assert.ok(codes.includes('A400'));
});

test('browser: the real viewer3d scene renders the cover picture and four views into the HVS shed set', { skip: SKIP, timeout: 300000 }, async () => {
  const r = await renderPlanSet(hvsShedProject(), { aerial: syntheticAerial() });
  const codes = r.sheets.map((s) => s.no.split('-').pop());
  assert.ok(codes.includes('A400'), `sheets: ${codes.join(' ')}`);
  assert.deepEqual(r.errs, []);
  assert.ok(r.bytes.length > 400000, 'the PDF holds the renders');
  assert.equal(r.pages, codes.length);
});
