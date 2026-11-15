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
