// Commercial pre-launch fixes: strata step 3 and step 4 agree, paving stays inside the lot, a building wider than the lot is flagged,
// the feasibility headline shows margin, a zero yield is guarded, inputs are bounded and wording reads correctly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model/store.js';
import { conadillyProject } from './helpers/conadilly-lot.mjs';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import * as C from '../src/flow/com-logic.js';
import * as G from '../src/model/geometry.js';
import { feasibility, summaryRows, headlineRows, effectiveInputs, areaDefaults, INPUT_MAX, NEED_YIELD } from '../src/commercial/feasibility.js';
import { commercialStats } from '../src/commercial/stats.js';

const inside = (poly, lot) => poly.every((q) => G.pointInPolygon(q, lot) || lot.some((a, i) => G.projectToSegment(q, a, lot[(i + 1) % lot.length]).d <= 10));

test('paving: truck apron and forecourt stay inside small, narrow and corner lots', () => {
  for (const [w, d, corner] of [[30000, 50000, false], [26900, 50600, true], [20000, 40000, false]]) {
    for (const t of ['warehouse', 'showroom', 'service-station']) {
      const store = createStore(conadillyProject({ corner, width: w, depth: d }), { autosaveKey: null });
      C.chooseType(store, t);
      const lot = store.project.site.lot.boundary;
      const sw = store.project.commercial.siteWorks;
      for (const a of [...(sw?.aprons || []), ...(sw?.forecourts || [])]) assert.ok(inside(a.polygon, lot), `${t} ${w}x${d} paving inside the lot`);
    }
  }
});

test('fit: a 20 m building on an 18 m lot is flagged as not fitting and gets no bays', () => {
  const store = createStore(conadillyProject({ corner: false, width: 18000, depth: 60000 }), { autosaveKey: null });
  C.chooseType(store, 'warehouse');
  const sw = store.project.commercial.siteWorks;
  assert.equal(sw.notFit, true);
  assert.equal((sw.bayRows || []).length, 0);
  assert.match(sw.warnings[0], /does not fit inside the lot/);
  const s = C.checkSummary(store.project);
  assert.equal(s.verdict, 'not-met');
  assert.match(s.lines[0], /does not fit inside the lot/);
});

test('strata units: step 3 and step 4 read the same parking numbers and the truck access is linked', () => {
  const store = createStore(commercialProject({ rows: 'pair' }), { autosaveKey: null });
  const park = commercialStats(store.project).parking;
  const text = C.baysText(park);
  assert.ok(text.startsWith(`${park.provided} bays laid out for ${park.required} indicated`), text);
  const s = C.checkSummary(store.project);
  assert.equal(s.parking.provided, park.provided);
  assert.equal(s.parking.required, park.required);
  assert.equal(s.truck.ok, true);
});

test('wording: one bay is not "1 bays"', () => {
  assert.equal(C.bayWord(1), '1 bay');
  assert.equal(C.bayWord(0), '0 bays');
  assert.equal(C.bayWord(14), '14 bays');
  assert.match(C.baysText({ provided: 1, required: 1, accessible: { provided: 0 } }), /^1 bay laid out/);
});

test('feasibility: the headline carries profit and margin on cost', () => {
  const p = commercialProject({ plain: false });
  const f = feasibility(p.commercial, p.site.lot);
  const rows = headlineRows(f);
  assert.match(rows[0][0], /profit, sell/);
  assert.match(rows[0][1], /% on cost/);
  assert.match(rows[1][1], /% on cost/);
});

test('feasibility: a zero yield asks for a yield and never shows $0 or -100 percent', () => {
  const p = commercialProject({ plain: false });
  const c = { ...p.commercial, feasibility: { area: null, v: { yieldPct: 0 } } };
  const f = feasibility(c, p.site.lot);
  assert.equal(headlineRows(f)[1][1], NEED_YIELD);
  const txt = summaryRows(f).map((r) => r.join(' ')).join('|');
  assert.match(txt, /Enter a yield/);
  assert.ok(!/-100\.0%/.test(txt));
});

test('feasibility: inputs are bounded', () => {
  const d = areaDefaults('tamworth');
  const e = effectiveInputs(d, { saleRate: 99999999, yieldPct: 500, landPrice: 9e12 });
  assert.equal(e.saleRate.value, INPUT_MAX.saleRate);
  assert.equal(e.yieldPct.value, INPUT_MAX.yieldPct);
  assert.equal(e.landPrice.value, INPUT_MAX.landPrice);
  const p = commercialProject({ plain: false });
  const f = feasibility({ ...p.commercial, feasibility: { area: null, v: { saleRate: 99999999 } } }, p.site.lot);
  assert.ok(f.mid.marginSalePct < 5000);
});

// Plan set wording ----------------------------------------------------------------------------------------------------------------
import { jsPDF } from 'jspdf';
import { exportPlanSet } from '../src/premium/exporters/planset/index.js';
import { sheetListText, COMMERCIAL_SHEET_LIST } from '../src/commercial/sheet-list.js';
import { COMMERCIAL_SHEETS, commercialNotes } from '../src/premium/exporters/planset/commercial.js';

async function pdfText(project) {
  const texts = [];
  class Rec extends jsPDF { constructor(...a) { super(...a); const t = this.text.bind(this); this.text = (s, x, y, o) => { texts.push(Array.isArray(s) ? s.join(' ') : String(s)); return t(s, x, y, o); }; } }
  await exportPlanSet({ project, kind: 'commercial', download: false, jsPDF: Rec, fetchSite: null, date: new Date(2026, 10, 15) });
  return texts.join('\n');
}

test('plan set list: the copy names the pages that are really in the set', () => {
  assert.equal(COMMERCIAL_SHEETS, COMMERCIAL_SHEET_LIST);
  assert.equal(sheetListText(), 'C000 and C100 to C103');
  assert.equal(sheetListText([{ code: 'C000' }, { code: 'C100' }, { code: 'C101' }]), 'C000 and C100 and C101');
});

test('plan set: a warehouse set says site layout, hides a zero unit count and prints the terms once on the cover', async () => {
  const store = createStore(conadillyProject({ corner: false }), { autosaveKey: null });
  C.chooseType(store, 'warehouse');
  const text = await pdfText(store.project);
  assert.ok(!/commercial unit layout/i.test(text), 'no unit wording for a warehouse');
  assert.ok(!/\bUnits\b\s*\n?\s*0\b/.test(text) && !/\b0 units\b/.test(text), 'no zero unit count');
  assert.ok(!/\b1 bays\b/.test(text));
  assert.match(text, /commercial site layout/i);
  const notes = commercialNotes({ units: 0, buildingCount: 1 });
  assert.ok(notes.every((n) => !/^Unit areas/.test(n)));
  assert.ok(commercialNotes({ units: 16, buildingCount: 0 })[0].includes('commercial unit layout'));
});

test('plan set: the terms note is not followed by a second Terms of use stamp when nothing was accepted', async () => {
  const p = commercialProject({ plain: false });
  const text = await pdfText(p);
  assert.ok(!/ABN 29 699 165 663\.\s*Terms of use v/.test(text.replace(/\n/g, ' ')));
});

test('step 4 repeats the zone warning for a residential zone', () => {
  const res = createStore(commercialProject({ rows: 'none', zoning: { code: 'R2', name: 'Low Density Residential' } }), { autosaveKey: null });
  C.chooseType(res, 'warehouse');
  assert.ok(C.checkSummary(res.project).lines.some((l) => /R2/.test(l)));
  const ind = createStore(commercialProject({ rows: 'none' }), { autosaveKey: null });
  C.chooseType(ind, 'warehouse');
  assert.ok(!C.checkSummary(ind.project).lines.some((l) => /R2/.test(l)));
});

test('anonymous commercial export says Commercial Developer, not Plan Pack', async () => {
  const { runExport } = await import('../src/premium/export-client.js');
  const p = commercialProject({ plain: false });
  await assert.rejects(runExport('pdf', p, { api: {}, token: null, config: {}, catalogue: null }), /Commercial Developer/);
});
