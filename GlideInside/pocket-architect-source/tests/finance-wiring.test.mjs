// Finance wiring: commercial and residential projects feed the same engine; edits and scenarios round trip through the project; the huge lot rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { largeLot, storeWith } from './helpers/fit-lots.mjs';
import { createStore } from '../src/model/store.js';
import { compute, buildModel, readState, setValue, resetAll, saveScenario, loadScenario, deleteScenario, compareScenarios, snapshot, MAX_SCENARIOS, DISCLAIMER } from '../src/finance/model.js';
import { addBuilding } from '../src/commercial/catalogue/ops.js';
import { feasibility } from '../src/commercial/feasibility.js';
import { stampDuty, run } from '../src/finance/engine.js';
import data from '../src/finance/data/finance-data.json' with { type: 'json' };

const near = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const com = () => createStore(commercialProject({ zoning: { code: 'E4', name: 'General Industrial' }, plain: false }), { autosave: false });
const res = () => storeWith(largeLot());
const desc = (c, key) => c.model.descs.find((d) => d.key === key);

test('commercial is wired: the engine input comes from the feasibility figures, duty by state, every output present', () => {
  const s = com();
  const c = compute(s.project);
  const f = feasibility(s.project.commercial, s.project.site.lot);
  assert.equal(c.model.kind, 'commercial');
  assert.equal(c.model.state, 'NSW');
  near(c.model.input.land, f.mid.land, 0.5);
  near(c.model.input.costs.build, f.mid.build, 0.5);
  near(c.model.input.costs.contributions, f.mid.charges, 0.5);
  assert.equal(c.result.duty, stampDuty('NSW', c.model.input.land));
  for (const k of ['profit', 'marginOnCostPct', 'marginOnGdvPct', 'yieldOnCostPct', 'peakDebt', 'peakEquity', 'totalCost', 'interest']) assert.ok(Number.isFinite(c.result[k]), k);
  assert.ok(c.result.residual && c.result.sensitivity.cells.length === 3 && c.result.sell && c.result.hold);
  assert.ok(c.model.descs.length >= 30);
  for (const d of c.model.descs) { assert.ok(d.label && d.source !== undefined && d.asAt && d.status, `${d.key} has a label, source, date and status`); }
  assert.match(DISCLAIMER, /quantity surveyor, valuer and your accountant/);
});

test('residential is wired: a placed house gives a build cost from its floor area, a value from the area median, duty and a result', () => {
  const s = res();
  const c = compute(s.project);
  assert.equal(c.model.kind, 'residential');
  assert.ok(c.model.gfaM2 > 50, 'the house has a build area');
  near(c.model.input.costs.build, c.model.gfaM2 * desc(c, 'buildRate').value * desc(c, 'costFactor').value, 1);
  assert.ok(c.result && Number.isFinite(c.result.profit) && c.result.residual && c.result.sensitivity);
  assert.equal(c.result.duty, stampDuty(c.model.state, c.model.input.land));
  assert.match(desc(c, 'salePrice').source, /610,037/);
  assert.equal(desc(c, 'salePrice').status, 'ESTIMATE');
  // tiers change the build rate and the value
  const prem = compute(s.project, { ...readState(s.project), fin: { tier: 'premium' } });
  assert.ok(desc(prem, 'buildRate').value > desc(c, 'buildRate').value && desc(prem, 'salePrice').value > desc(c, 'salePrice').value);
});

test('residential with no home placed says so and returns no figures', () => {
  const p = largeLot();
  const c = compute(p);
  assert.equal(c.result, null);
  assert.match(c.notes[0], /Choose a home/);
});

test('edit and reset: a value is stored with the project, drives the result, and Reset returns it to the default', () => {
  const s = com();
  const base = compute(s.project);
  const d = desc(base, 'ratePct');
  s.apply('Set rate', (q) => setValue(q, d, 14));
  const c1 = compute(s.project);
  assert.equal(desc(c1, 'ratePct').value, 14);
  assert.equal(desc(c1, 'ratePct').edited, true);
  assert.ok(c1.result.interest > base.result.interest);
  // a shared key lives in the earlier feasibility overrides, so both panels agree
  const sd = desc(base, 'saleRate');
  assert.equal(sd.store, 'fz');
  s.apply('Set sale', (q) => setValue(q, sd, sd.defaultValue * 2));
  assert.equal(s.project.commercial.feasibility.v.saleRate, sd.defaultValue * 2);
  assert.ok(compute(s.project).result.revenue > base.result.revenue * 1.5);
  s.apply('Reset', (q) => resetAll(q));
  const c2 = compute(s.project);
  near(c2.result.profit, base.result.profit, 0.5);
  assert.equal(desc(c2, 'ratePct').edited, false);
  // a negative or garbage value clears rather than stores
  s.apply('Bad', (q) => setValue(q, d, 'abc'));
  assert.equal(readState(s.project).fin.ratePct, undefined);
});

test('scenario save, load, compare and delete round trip (commercial), max three', () => {
  const s = com();
  const d = (k) => desc(compute(s.project), k);
  s.apply('Sell', (q) => saveScenario(q, 'Sell'));
  s.apply('Hold', (q) => { setValue(q, d('mode'), 'hold'); });
  s.apply('Save hold', (q) => saveScenario(q, 'Hold'));
  s.apply('Staged', (q) => { setValue(q, d('mode'), 'sell'); setValue(q, d('buildMonths'), 18); setValue(q, d('ratePct'), 11); });
  s.apply('Save staged', (q) => saveScenario(q, 'Staged'));
  assert.deepEqual(readState(s.project).scenarios.map((x) => x.name), ['Sell', 'Hold', 'Staged']);
  let ok = true;
  s.apply('Fourth', (q) => { ok = saveScenario(q, 'Fourth'); });
  assert.equal(ok, false);
  assert.equal(readState(s.project).scenarios.length, MAX_SCENARIOS);
  // JSON round trip through the saved project
  const copy = JSON.parse(JSON.stringify(s.project));
  const cols = compareScenarios(copy);
  assert.deepEqual(cols.map((x) => x.name), ['Current', 'Sell', 'Hold', 'Staged']);
  const [cur, sell, hold, staged] = cols;
  assert.equal(sell.result.mode, 'sell'); assert.equal(hold.result.mode, 'hold');
  assert.ok(staged.result.interest > sell.result.interest, 'longer programme at a higher rate costs more interest');
  near(cur.result.profit, staged.result.profit, 0.5);
  // loading Hold makes it the working values
  const id = readState(s.project).scenarios[1].id;
  s.apply('Load', (q) => loadScenario(q, id));
  assert.equal(compute(s.project).result.mode, 'hold');
  // saving the same name replaces instead of adding
  s.apply('Replace', (q) => saveScenario(q, 'hold'));
  assert.equal(readState(s.project).scenarios.length, 3);
  s.apply('Delete', (q) => deleteScenario(q, id));
  assert.equal(readState(s.project).scenarios.length, 2);
  // the snapshot is a copy, not a reference
  const snap = snapshot(s.project); snap.fin.mode = 'x';
  assert.notEqual(readState(s.project).fin.mode, 'x');
});

test('scenario round trip also works for a residential project (stored on project.finance)', () => {
  const s = res();
  s.apply('Save', (q) => saveScenario(q, 'Budget'));
  s.apply('Tier', (q) => { const c = compute(q); setValue(q, desc(c, 'tier'), 'premium'); });
  s.apply('Save', (q) => saveScenario(q, 'Premium'));
  assert.equal(s.project.finance.scenarios.length, 2);
  const cols = compareScenarios(JSON.parse(JSON.stringify(s.project)));
  assert.equal(cols.length, 3);
  assert.ok(cols[2].result.revenue > cols[1].result.revenue);
});

test('huge lot rule: a lot over 20,000 m2 is costed on the development area only, and the engine receives that land', () => {
  const small = com();
  const huge = createStore(commercialProject({ width: 250000, depth: 250000, zoning: { code: 'E4', name: 'General Industrial' }, plain: false }), { autosave: false });
  const f = feasibility(huge.project.commercial, huge.project.site.lot);
  assert.equal(f.hugeLot, true);
  assert.ok(f.landM2 < f.lotM2);
  const c = compute(huge.project);
  assert.equal(c.model.hugeLot, true);
  near(c.model.input.land, f.landM2 * f.inputs.landRate.value, 1);
  assert.ok(c.model.input.land < f.lotM2 * f.inputs.landRate.value * 0.5, 'not the whole lot');
  assert.ok(c.model.notes.some((t) => /development area only/.test(t)));
  assert.equal(compute(small.project).model.hugeLot, false);
});

test('building types: an office and a service station use their own sale and rent rates, not the strata rate', () => {
  const s = com();
  const base = compute(s.project);
  const strata = desc(base, 'saleRate').value;
  addBuilding(s, 'office');
  addBuilding(s, 'service-station');
  const c = compute(s.project);
  const lines = c.result.revenueLines;
  const off = lines.find((l) => /office/i.test(l.label));
  const ss = lines.find((l) => /service station/i.test(l.label));
  assert.ok(off && ss, lines.map((l) => l.label).join(', '));
  assert.notEqual(Math.round(off.saleRate), strata);
  assert.ok(ss.rentRate > lines[0].rentRate, 'service station rent per m2 is above strata units');
  assert.ok(ss.capRatePct < lines[0].capRatePct, 'service station cap rate is lower');
  assert.ok(off.capRatePct > lines[0].capRatePct, 'office cap rate is higher');
  // an entered sale rate is used for every line
  s.apply('Sale', (q) => setValue(q, desc(c, 'saleRate'), 2000));
  for (const l of compute(s.project).result.revenueLines) assert.equal(l.saleRate, 2000);
});

test('data: every default and source row carries a status and an as-at date in DD/MM/YYYY, and no dashes or banned words', () => {
  const dd = /^\d{2}\/\d{2}\/\d{4}$/;
  const walk = (o, path) => {
    if (o && typeof o === 'object') {
      if (typeof o.asAt === 'string') assert.match(o.asAt, dd, path);
      for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
    }
  };
  walk(data, 'data');
  const text = JSON.stringify(data);
  assert.ok(!/[–—]/.test(text), 'no en or em dashes in the data');
  assert.ok(!/compliant/i.test(text));
  assert.equal(run({ state: 'QLD', mode: 'sell', land: 0, costs: {}, a: {}, revenue: [] }).duty, 0);
});
