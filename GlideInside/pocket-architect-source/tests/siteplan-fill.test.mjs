// Site plan sheets fill the drawing area: the largest standard scale at which the lot plus a margin fits, turned a quarter turn when that
// allows a larger scale (north arrow follows, text stays upright), larger plan text, preview keeps NOT TO SCALE, paid sets print the scale.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { jsPDF } from 'jspdf';
import { exportPlanSet, planSetSheets } from '../src/premium/exporters/planset/index.js';
import { fitView, siteView, northDegOf, SITE_SCALES, SITE_MARGIN, VP } from '../src/premium/exporters/planset/site.js';
import { layoutView, commercialModel, existingScale, blankProject } from '../src/premium/exporters/planset/commercial.js';
import { toSiteLot } from '../src/premium/exporters/planset/lot.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { createStore } from '../src/model/store.js';

const houses = JSON.parse(fs.readFileSync(new URL('../../golive/builder-houses/hunter-homes.json', import.meta.url), 'utf8'));
const project = houses[0].project;
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const mk = (w, d) => ({ boundaryM: rect(0, 0, w, d), frontEdge: 0, lotNumber: '12', planLabel: 'DP 1234567', address: '12 Sample Street, Thornton NSW 2322', lga: 'Maitland City Council', setbacks: { front: 6, side: 0.9, rear: 3 }, neighbours: [] });
const pagesOf = async (blob) => (Buffer.from(await blob.arrayBuffer()).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

function recorder() {
  const texts = [];
  const sizes = [];
  class Rec extends jsPDF {
    constructor(...a) {
      super(...a);
      const text = this.text.bind(this);
      this.text = (t, ...r) => { texts.push(Array.isArray(t) ? t.join(' ') : String(t)); sizes.push({ t: Array.isArray(t) ? t.join(' ') : String(t), size: this.getFontSize() }); return text(t, ...r); };
    }
  }
  return { Rec, texts, sizes };
}
const run = async (lot, extra = {}) => {
  const { Rec, texts, sizes } = recorder();
  const r = await exportPlanSet({ project, lot, kind: 'site', download: false, jsPDF: Rec, date: new Date(2026, 10, 15), fetchSite: null, ...extra });
  return { r, text: texts.join('\n'), sizes };
};
const siteLotOf = async (w, d) => {
  // The same lot the exporter prepares (plan mm, y down) so the view maths can be checked directly.
  const { prepare } = await import('../src/premium/exporters/planset/lot.js');
  const p = prepare(project, mk(w, d));
  return { project: p.project, lot: p.lot };
};

test('standard scales are the owner list, and a lot beyond 1:2500 still gets a scale', () => {
  assert.deepEqual(SITE_SCALES, [100, 200, 250, 300, 400, 500, 750, 1000, 1250, 1500, 2000, 2500]);
  const huge = fitView([{ x: 0, y: 0 }, { x: 900000, y: 600000 }], VP);
  assert.ok(huge.scale > 2500 && Number.isFinite(huge.scale));
});

test('fitView: the largest standard scale at which the points plus a paper margin fit, in either orientation', () => {
  const vw = VP.x1 - VP.x0;
  const vh = VP.y1 - VP.y0;
  const fits = (w, h, n) => w / n + 2 * SITE_MARGIN[0] <= vw && h / n + 2 * SITE_MARGIN[1] <= vh;
  for (const [w, h] of [[15000, 50000], [36000, 60000], [120000, 60000], [60000, 130000], [20000, 20000], [90000, 20000], [8000, 120000]]) {
    const v = fitView([{ x: 0, y: 0 }, { x: w, y: h }], VP);
    const wanted = SITE_SCALES.find((n) => fits(w, h, n) || fits(h, w, n));
    assert.equal(v.scale, wanted, `${w} x ${h}`);
    const turned = !fits(w, h, v.scale);
    assert.equal(v.turnDeg, turned ? 90 : 0, `${w} x ${h} turns only when that allows a larger scale`);
    // Nothing leaves the viewport.
    for (const p of [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]) {
      const q = v.T(p);
      assert.ok(q.x >= VP.x0 - 1e-6 && q.x <= VP.x1 + 1e-6 && q.y >= VP.y0 - 1e-6 && q.y <= VP.y1 + 1e-6, `${w} x ${h} inside the viewport`);
    }
  }
});

test('fitView: T and Ti are inverses and a quarter turn is a proper rotation (no mirroring)', () => {
  const v = fitView([{ x: 0, y: 0 }, { x: 15000, y: 50000 }], VP);
  assert.equal(v.turnDeg, 90);
  const p = { x: 4000, y: 30000 };
  const back = v.Ti(v.T(p));
  assert.ok(Math.hypot(back.x - p.x, back.y - p.y) < 1e-6);
  // East stays clockwise of north: plan up (north) turned a quarter clockwise points right on the sheet.
  const o = v.T({ x: 0, y: 0 });
  const up = v.T({ x: 0, y: -1000 });
  const right = v.T({ x: 1000, y: 0 });
  assert.ok(up.x > o.x && Math.abs(up.y - o.y) < 1e-9, 'plan up points right on the turned sheet');
  assert.ok(right.y > o.y && Math.abs(right.x - o.x) < 1e-9, 'plan right points down on the turned sheet');
  assert.equal(northDegOf({ site: { northDeg: 10 } }, v), 100);
  assert.equal(northDegOf({ site: {} }, { turnDeg: 0 }), 0);
});

test('residential C100: a narrow deep lot is turned and prints a larger scale than before (1:200, was 1:300)', async () => {
  const { project: wp, lot } = await siteLotOf(15, 50);
  const v = siteView(wp, lot);
  assert.equal(v.turnDeg, 90);
  assert.equal(v.scale, 200);
  assert.equal(siteView(wp, lot, { turn: false }).scale, 250, 'the unturned plan (smaller margins already) needs 1:250');
  const { r, text } = await run(mk(15, 50));
  assert.equal(r.sheets[1].scale, '1:200 @ A3');
  assert.ok(text.includes('1:200 @ A3'), 'the sheet prints the true scale');
  assert.equal(planSetSheets({ project: wp, lot, kind: 'site' })[1].scale, '1:200 @ A3', 'the drawing list agrees with the sheet');
});

test('residential C100: a lot that already fits across the sheet is not turned', async () => {
  const { project: wp, lot } = await siteLotOf(60, 30);
  const v = siteView(wp, lot);
  assert.equal(v.turnDeg, 0);
});

test('preview: same plan size, NOT TO SCALE on every page, no printed ratio, watermark stays', async () => {
  const { r, text } = await run(mk(15, 50), { preview: true });
  assert.ok(r.sheets.every((s) => s.scale === 'NOT TO SCALE'));
  assert.ok(text.includes('NOT TO SCALE'));
  assert.ok(!/\b1:\d+ @ A3/.test(text), 'no scale ratio printed in the free preview');
  assert.ok(/PREVIEW/.test(text), 'preview stamp');
  assert.equal(await pagesOf(r.blob), 3);
});

test('plan text is larger: bearings and setback labels are 8 pt and 7 pt', async () => {
  const { sizes } = await run(mk(36, 60));
  const bearing = sizes.find((s) => /^\d+°\d+'\d+" [\d.]+$/.test(s.t));
  assert.ok(bearing && bearing.size >= 8, 'bearing labels at 8 pt or more');
  const sb = sizes.find((s) => /SB$/.test(s.t));
  assert.ok(sb && sb.size >= 7, 'setback labels at 7 pt or more');
});

// ---- Commercial ----
const cstore = (width, depth) => createStore(commercialProject({ plain: false, width, depth }), { autosaveKey: null });
const cmodelOf = (s) => { const lot = toSiteLot(s.project.site.lot) || s.project.site.lot; return { model: commercialModel(s.project, lot), lot }; };

test('commercial C101 layout: a deep lot is turned and prints 1:500 (was 1:750); a wide lot stays as it is', () => {
  const deep = cstore(60000, 130000);
  const { model, lot } = cmodelOf(deep);
  const lv = layoutView(model);
  assert.equal(lv.turnDeg, 90);
  assert.equal(lv.scale, 500);
  const sheets = planSetSheets({ project: deep.project, lot: deep.project.site.lot, kind: 'commercial' });
  assert.equal(sheets[1].scale, '1:500 @ A3', 'C100');
  assert.equal(sheets[2].scale, '1:500 @ A3', 'C101');
  void lot;
  const wide = cstore(120000, 60000);
  const w = layoutView(cmodelOf(wide).model);
  assert.equal(w.turnDeg, 0);
  assert.equal(w.scale, 400);
});

test('commercial set: C100 and C101 print the true scale when paid and NOT TO SCALE in the preview', async () => {
  const s = cstore(60000, 130000);
  const { Rec, texts } = recorder();
  const paid = await exportPlanSet({ project: s.project, kind: 'commercial', download: false, jsPDF: Rec, fetchSite: null, date: new Date(2026, 10, 15) });
  assert.deepEqual(paid.sheets.slice(1, 3).map((x) => x.scale), ['1:500 @ A3', '1:500 @ A3']);
  assert.ok(texts.join('\n').includes('1:500 @ A3'));
  const rec2 = recorder();
  const prev = await exportPlanSet({ project: s.project, kind: 'commercial', download: false, preview: true, jsPDF: rec2.Rec, fetchSite: null, date: new Date(2026, 10, 15) });
  assert.ok(prev.sheets.every((x) => x.scale === 'NOT TO SCALE'));
  assert.ok(!/\b1:\d+ @ A3/.test(rec2.texts.join('\n')));
  assert.equal(await pagesOf(prev.blob), 6); // cover, C100 to C103 and the C104 elevations sheet of the tilt-up work
});

test('commercial C100 under an aerial keeps north up (the image cannot be turned), and the sheet scale says so', () => {
  const s = cstore(60000, 130000);
  const lot = toSiteLot(s.project.site.lot) || s.project.site.lot;
  const plain = existingScale(s.project, lot);
  const aerial = existingScale(s.project, lot, { aerial: true });
  assert.equal(plain, '1:500 @ A3');
  assert.equal(aerial, '1:750 @ A3');
  const v = siteView(blankProject(s.project, lot), lot, { turn: false });
  assert.equal(v.turnDeg, 0);
});
