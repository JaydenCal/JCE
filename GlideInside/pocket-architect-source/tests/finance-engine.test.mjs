// Finance engine: duty, the S-curve and interest drawdown, GST, residual land value, the sensitivity grid. Worked examples checked by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stampDuty, sCurveWeights, fund, run, residualLand, sensitivity, analyse, sanityNotes } from '../src/finance/engine.js';

const near = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const ZERO = { legalPct: 0, ratesPct: 0, insurancePct: 0, professionalPct: 0, contPct: 0, daFeePct: 0, approvalsFixed: 0, approvalMonths: 0, buildMonths: 1, tailMonths: 0, lcrPct: 0, ratePct: 0, feePct: 0, agentPct: 0, marketingPct: 0, sellLegalPerUnit: 0, units: 1, leasingMonths: 0, vacancyPct: 0, outgoingsPct: 0, targetMarginPct: 20 };

test('duty: NSW and QLD scales by hand', () => {
  assert.equal(stampDuty('NSW', 1000000), 11152 + (4.5 * (1000000 - 372000)) / 100); // 39,412
  assert.equal(stampDuty('NSW', 1000000), 39412);
  assert.equal(stampDuty('NSW', 500000), 16912);
  assert.equal(stampDuty('NSW', 2000000), 50212 + (5.5 * 760000) / 100); // 92,012
  assert.equal(stampDuty('NSW', 10000), 125);
  assert.equal(stampDuty('NSW', 1), 20); // minimum duty
  assert.equal(stampDuty('QLD', 1000000), 38025);
  assert.equal(stampDuty('QLD', 2000000), 38025 + 57500); // 95,525: 5.75 per 100 on the 1,000,000 over the top threshold
});

test('S-curve weights sum to one and are symmetric (n = 4: 15.625, 34.375, 34.375, 15.625)', () => {
  const w = sCurveWeights(4);
  near(w[0], 0.15625, 1e-9); near(w[1], 0.34375, 1e-9); near(w[2], 0.34375, 1e-9); near(w[3], 0.15625, 1e-9);
  for (const n of [1, 2, 7, 12]) near(sCurveWeights(n).reduce((a, b) => a + b, 0), 1, 1e-9);
});

test('interest drawdown: 1,000,000 drawn at month 0 at 12 percent for 3 months compounds monthly to 30,301', () => {
  const f = fund([1000000, 0, 0, 0], { facility: 1000000, ratePct: 12 });
  near(f.interest, 10000 + 10100 + 10201, 0.01);
  near(f.peakDebt, 1030301, 0.01);
  assert.equal(f.equity, 0);
});

test('equity pays first: 50 percent loan to cost, 1,000,000 of cost in month 0 and 1,000,000 in month 1', () => {
  const f = fund([1000000, 1000000], { facility: 1000000, ratePct: 12 });
  assert.equal(f.equity, 1000000);
  near(f.rows[0].draw, 0); // month 0 is all equity
  near(f.rows[1].draw, 1000000); // month 1 all debt
  near(f.interest, 10000, 0.01); // one month on 1,000,000
});

test('GST: margin scheme against full GST on an 11,000,000 sale with land at 2,000,000', () => {
  const base = { state: 'NSW', mode: 'sell', pricesIncGst: true, land: 2000000, dutyOverride: 0, costs: {}, a: ZERO, revenue: [{ label: 'x', qty: 1, saleRate: 11000000 }] };
  const full = run({ ...base, gstMode: 'full' });
  const margin = run({ ...base, gstMode: 'margin' });
  const none = run({ ...base, gstMode: 'none' });
  near(full.gstPayable, 1000000, 0.5); near(full.saleNet, 10000000, 0.5);
  near(margin.gstPayable, (11000000 - 2000000) / 11, 0.5); // 818,181.82
  near(margin.saleNet, 10181818.18, 0.5);
  near(none.saleNet, 11000000, 0.5);
  assert.ok(margin.profit > full.profit);
  // prices quoted ex GST get GST added first: 10,000,000 ex GST is 11,000,000 inc
  near(run({ ...base, pricesIncGst: false, gstMode: 'full', revenue: [{ label: 'x', qty: 1, saleRate: 10000000 }] }).saleNet, 10000000, 0.5);
});

test('totals: a plain project with duty, legal costs, contingency and selling costs, summed by hand', () => {
  const a = { ...ZERO, legalPct: 1, contPct: 10, professionalPct: 8, agentPct: 2, marketingPct: 0.5, sellLegalPerUnit: 1500, units: 4 };
  const r = run({ state: 'NSW', mode: 'sell', land: 1000000, costs: { build: 3000000, siteWorks: 500000, contributions: 100000 }, a, revenue: [{ label: 'Units', qty: 1, saleRate: 6500000 }] });
  assert.equal(r.duty, 39412);
  near(r.acquisition, 10000);
  near(r.construction, 3500000); near(r.professional, 280000); near(r.contingency, 350000);
  near(r.costExFinance, 1000000 + 39412 + 10000 + 3500000 + 100000 + 280000 + 350000);
  near(r.selling, 6500000 * 0.025 + 1500 * 4);
  near(r.totalCost, 5279412 + 168500);
  near(r.profit, 6500000 - 5447912);
  near(r.marginOnCostPct, ((6500000 - 5447912) / 5447912) * 100, 1e-6);
  near(r.marginOnGdvPct, ((6500000 - 5447912) / 6500000) * 100, 1e-6);
  assert.equal(r.interest, 0);
});

test('loan: facility is the loan to cost ratio, interest is capitalised and peak debt is facility plus interest', () => {
  const a = { ...ZERO, lcrPct: 60, ratePct: 10, feePct: 1, approvalMonths: 2, buildMonths: 4, tailMonths: 2 };
  const r = run({ state: 'NSW', mode: 'sell', land: 1000000, dutyOverride: 0, costs: { build: 2000000 }, a, revenue: [{ label: 'x', qty: 1, saleRate: 4500000 }] });
  near(r.costExFinance, 3000000);
  near(r.facility, 1800000);
  near(r.fee, 18000);
  assert.ok(r.interest > 0);
  near(r.peakDebt, r.facility + r.fee + r.interest, 1); // the loan funds the facility share of cost plus the fee, and interest is capitalised on top
  near(r.peakEquity, 1200000, 1);
  near(r.financeCost, r.fee + r.interest, 0.01);
  assert.equal(r.months, 8);
  // more interest as the rate rises
  assert.ok(run({ state: 'NSW', mode: 'sell', land: 1000000, dutyOverride: 0, costs: { build: 2000000 }, a: { ...a, ratePct: 12 }, revenue: [{ label: 'x', qty: 1, saleRate: 4500000 }] }).interest > r.interest);
});

test('residual land value at a 20 percent margin on cost, solved against the hand formula', () => {
  // revenue 10,000,000, construction 5,000,000, no other cost. Cost at 20 percent margin = 10,000,000 / 1.2, so land plus duty = 3,333,333.33.
  // NSW top band: duty = 50,212 + 0.055 x (L - 1,240,000), so 1.055 L = 3,333,333.33 + 68,200 - 50,212 and L = 3,351,321.33 / 1.055 = 3,176,608.4
  const input = { state: 'NSW', mode: 'sell', land: 0, costs: { build: 5000000 }, a: ZERO, revenue: [{ label: 'x', qty: 1, saleRate: 10000000 }] };
  const rl = residualLand(input);
  assert.equal(rl.viable, true);
  near(rl.value, 3176608, 2);
  const check = run({ ...input, land: rl.value, dutyOverride: null });
  near(check.marginOnCostPct, 20, 0.001);
  // not viable when free land still misses the target
  const bad = residualLand({ ...input, costs: { build: 9000000 } });
  assert.deepEqual([bad.value, bad.viable], [0, false]);
});

test('sensitivity grid: price and cost at -10, 0 and +10 percent, centre equals the base run', () => {
  const input = { state: 'NSW', mode: 'sell', land: 1000000, dutyOverride: 0, costs: { build: 4000000 }, a: ZERO, revenue: [{ label: 'x', qty: 1, saleRate: 6000000 }] };
  const g = sensitivity(input);
  assert.deepEqual(g.steps, [-10, 0, 10]);
  assert.equal(g.cells.length, 3); assert.equal(g.cells[0].length, 3);
  const base = run(input);
  near(g.cells[1][1].margin, base.marginOnCostPct, 1e-9);
  // price +10, cost 0: revenue 6,600,000 against cost 5,000,000
  near(g.cells[2][1].profit, 6600000 - 5000000, 0.5);
  // price 0, cost +10: construction 4,400,000, total 5,400,000
  near(g.cells[1][2].profit, 6000000 - 5400000, 0.5);
  assert.ok(g.cells[2][0].margin > g.cells[1][1].margin && g.cells[0][2].margin < g.cells[1][1].margin);
});

test('hold: end value is net rent over the cap rate, with vacancy and outgoings; yield on cost; leasing fee', () => {
  const a = { ...ZERO, vacancyPct: 5, outgoingsPct: 10, leasingMonths: 1.5 };
  const r = run({ state: 'NSW', mode: 'hold', land: 1000000, dutyOverride: 0, costs: { build: 3000000 }, a, revenue: [{ label: 'x', qty: 1000, saleRate: 0, rentRate: 200, capRatePct: 7 }] });
  near(r.grossRent, 200000); near(r.netRent, 200000 * 0.95 * 0.9);
  near(r.endValue, (200000 * 0.95 * 0.9) / 0.07, 0.5);
  near(r.selling, (200000 * 0.95 * 1.5) / 12, 0.01);
  near(r.yieldOnCostPct, (r.netRent / r.totalCost) * 100, 1e-9);
  const both = analyse({ state: 'NSW', mode: 'sell', land: 1000000, dutyOverride: 0, costs: { build: 3000000 }, a, revenue: [{ label: 'x', qty: 1000, saleRate: 5000, rentRate: 200, capRatePct: 7 }] });
  assert.equal(both.sell.mode, 'sell'); assert.equal(both.hold.mode, 'hold'); assert.ok(both.residual && both.sensitivity);
});

test('sanity notes: a plain note when the margin is very negative', () => {
  const r = run({ state: 'NSW', mode: 'sell', land: 5000000, costs: { build: 9000000 }, a: ZERO, revenue: [{ label: 'x', qty: 1, saleRate: 4000000 }] });
  assert.ok(sanityNotes(r).some((t) => /below -50%/.test(t)));
});
