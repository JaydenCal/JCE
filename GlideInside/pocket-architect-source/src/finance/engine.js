// Development feasibility engine. Pure functions, no DOM, no project access: it takes one input object and returns every line and total.
// Used by the commercial and the residential tools (adapters.js builds the input). All amounts are AUD. Indicative, not a valuation:
// check with a quantity surveyor, valuer and your accountant.
import data from './data/finance-data.json' with { type: 'json' };

export const INDICATIVE = 'Indicative only, not a valuation or advice. Check with a quantity surveyor, valuer and your accountant.';

// Transfer duty ------------------------------------------------------------------------------------------------------------------
/** Transfer (stamp) duty on a price, by state, from the band table in finance-data.json. Indicative: no concessions, no premium duty. */
export function stampDuty(state, price) {
  const scale = data.duty[state] || data.duty.NSW;
  const p = Math.max(0, Number(price) || 0);
  let band = scale.bands[0];
  for (const b of scale.bands) if (p >= b.from) band = b;
  let duty = band.base + (band.per100 * (p - band.from)) / 100;
  if (band.min != null && p > 0) duty = Math.max(duty, band.min);
  return Math.round(duty);
}

// S-curve drawdown ---------------------------------------------------------------------------------------------------------------
const smooth = (t) => 3 * t * t - 2 * t * t * t;
/** Monthly weights (sum 1) of a smoothstep S-curve over n months: slow start, fast middle, slow finish. n = 4 gives 15.625, 34.375, 34.375, 15.625 per cent. */
export function sCurveWeights(n) {
  const m = Math.max(1, Math.round(n));
  const w = [];
  for (let i = 1; i <= m; i++) w.push(smooth(i / m) - smooth((i - 1) / m));
  return w;
}

/**
 * Funding by month. costs[m] is the cost incurred at the start of month m (m = 0 is settlement of the land). Equity pays first until it
 * has paid `equity` dollars, then the loan. Interest accrues monthly on the drawn balance and is capitalised, so the closing balance
 * after the last month is the peak debt. rate is a percentage a year.
 */
export function fund(costs, { facility, ratePct }) {
  const total = costs.reduce((a, c) => a + c, 0);
  const equity = Math.max(0, total - Math.max(0, Math.min(facility, total)));
  let cum = 0; let bal = 0; let interest = 0; let equityPaid = 0;
  const rows = [];
  costs.forEach((c, m) => {
    const before = Math.max(0, cum - equity);
    cum += c;
    const draw = Math.max(0, cum - equity) - before;
    equityPaid += c - draw;
    bal += draw;
    const int = m === 0 ? 0 : (bal * (ratePct / 100)) / 12;
    interest += int;
    bal += int;
    rows.push({ month: m, cost: c, draw, interest: int, balance: bal });
  });
  return { equity, interest, peakDebt: bal, drawn: total - equityPaid, rows };
}

// The run -------------------------------------------------------------------------------------------------------------------------
const n0 = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * run(input) -> { lines, totals ... }. input:
 *   state 'NSW' | 'QLD', mode 'sell' | 'hold', gstMode 'none' | 'margin' | 'full', pricesIncGst (bool)
 *   land (price), dutyOverride (number | null)
 *   costs { build, siteWorks, earthworks, landscape, contributions }   dollars, ex GST
 *   a { legalPct, ratesPct, insurancePct, professionalPct, contPct, daFeePct, approvalsFixed, approvalMonths, buildMonths, tailMonths,
 *       lcrPct, ratePct, feePct, agentPct, marketingPct, sellLegalPerUnit, units, leasingMonths, vacancyPct, outgoingsPct, targetMarginPct }
 *   revenue [{ label, qty, saleRate, rentRate, capRatePct }]   qty x saleRate is the sale price; qty x rentRate a year of gross rent
 *   mult { price, cost } optional multipliers (the sensitivity table)
 */
export function run(input) {
  const a = input.a || {};
  const mult = { price: 1, cost: 1, ...(input.mult || {}) };
  const sell = input.mode !== 'hold';
  const gstMode = sell ? input.gstMode || 'none' : 'none';
  const land = n0(input.land);
  const c = input.costs || {};
  const construction = (n0(c.build) + n0(c.siteWorks) + n0(c.earthworks) + n0(c.landscape)) * mult.cost;
  const contributions = n0(c.contributions);
  const duty = input.dutyOverride != null && Number.isFinite(Number(input.dutyOverride)) ? Number(input.dutyOverride) : stampDuty(input.state, land);
  const acquisition = (land * n0(a.legalPct)) / 100;
  const professional = (construction * n0(a.professionalPct)) / 100;
  const contingency = (construction * n0(a.contPct)) / 100;
  const approvals = (construction * n0(a.daFeePct)) / 100 + n0(a.approvalsFixed);
  const pre = Math.max(0, Math.round(n0(a.approvalMonths)));
  const build = Math.max(1, Math.round(n0(a.buildMonths) || 1));
  const tail = Math.max(0, Math.round(n0(a.tailMonths)));
  const months = pre + build + tail;
  const holding = ((land * n0(a.ratesPct)) / 100 + (construction * n0(a.insurancePct)) / 100) * (months / 12);

  // Revenue
  const lines = (input.revenue || []).map((r) => {
    const qty = n0(r.qty);
    const gross = qty * n0(r.saleRate) * mult.price;
    const rent = qty * n0(r.rentRate) * mult.price;
    const net = rent * (1 - n0(a.vacancyPct) / 100) * (1 - n0(a.outgoingsPct) / 100);
    const cap = n0(r.capRatePct);
    return { label: r.label, qty, saleRate: n0(r.saleRate), rentRate: n0(r.rentRate), capRatePct: cap, gross, rent, netRent: net, value: cap > 0 ? net / cap * 100 : 0 };
  });
  const gdvQuoted = lines.reduce((s, l) => s + l.gross, 0);
  const grossRent = lines.reduce((s, l) => s + l.rent, 0);
  const netRent = lines.reduce((s, l) => s + l.netRent, 0);
  const endValue = lines.reduce((s, l) => s + l.value, 0);
  // GST on the sale (sell only). Costs are ex GST and their GST is a credit, so only the sale side changes the profit.
  let saleNet = gdvQuoted; let gstPayable = 0;
  if (gstMode !== 'none') {
    const rate = data.gst.rate;
    const inc = input.pricesIncGst ? gdvQuoted : gdvQuoted * (1 + rate);
    gstPayable = gstMode === 'margin' ? Math.max(0, inc - land) * rate / (1 + rate) : (inc * rate) / (1 + rate);
    saleNet = inc - gstPayable;
  }
  const revenue = sell ? saleNet : endValue;
  const unitsN = Math.max(1, n0(a.units) || 1);
  const selling = sell ? (revenue * (n0(a.agentPct) + n0(a.marketingPct))) / 100 + n0(a.sellLegalPerUnit) * unitsN
    : (grossRent * (1 - n0(a.vacancyPct) / 100) * n0(a.leasingMonths)) / 12;

  // Finance
  const costExFinance = land + duty + acquisition + construction + contributions + professional + contingency + approvals + holding;
  const lcr = Math.max(0, Math.min(100, n0(a.lcrPct))) / 100;
  const facility = lcr * costExFinance;
  const fee = (facility * n0(a.feePct)) / 100;
  // Timeline: month 0 land, duty, acquisition and the loan fee; months 1..pre the approvals and half the professional fees; contributions at the
  // start of construction; construction, contingency and the other half of the professional fees on the S-curve; holding evenly.
  const T = months;
  const cost = new Array(T + 1).fill(0);
  cost[0] += land + duty + acquisition + fee;
  const preSpan = Math.max(1, pre);
  for (let m = 1; m <= preSpan; m++) cost[Math.min(m, T)] += (approvals + professional * 0.5) / preSpan;
  const w = sCurveWeights(build);
  const start = pre; // construction months are pre+1 .. pre+build
  cost[Math.min(start + 1, T)] += contributions;
  w.forEach((x, i) => { cost[start + 1 + i] += (construction + contingency + professional * 0.5) * x; });
  for (let m = 1; m <= T; m++) cost[m] += holding / T;
  // The loan fee is part of the funded cost but not of the facility basis.
  const f = fund(cost, { facility: facility + fee, ratePct: n0(a.ratePct) });
  const financeCost = fee + f.interest;
  const totalCost = costExFinance + financeCost + selling;
  const profit = revenue - totalCost;
  const out = {
    mode: input.mode === 'hold' ? 'hold' : 'sell', state: input.state, gstMode,
    land, duty, acquisition, construction, build: n0(c.build) * mult.cost, siteWorks: n0(c.siteWorks) * mult.cost, earthworks: n0(c.earthworks) * mult.cost, landscape: n0(c.landscape) * mult.cost,
    contributions, professional, contingency, approvals, holding,
    costExFinance, facility, fee, interest: f.interest, financeCost, selling, totalCost,
    gdvQuoted, gstPayable, saleNet, grossRent, netRent, endValue, revenue,
    profit,
    marginOnCostPct: totalCost > 0 ? (profit / totalCost) * 100 : 0,
    marginOnGdvPct: revenue > 0 ? (profit / revenue) * 100 : 0,
    yieldOnCostPct: totalCost > 0 ? (netRent / totalCost) * 100 : 0,
    peakDebt: f.peakDebt, peakEquity: f.equity, months, programme: { pre, build, tail },
    drawdown: f.rows, revenueLines: lines,
  };
  return out;
}

// Residual land value ------------------------------------------------------------------------------------------------------------
/**
 * The land price at which the margin on cost equals the target (default a.targetMarginPct). Solved by bisection on the land price, with
 * duty, legal costs, rates and interest all moving with it. Returns { value, viable, targetPct }. value is 0 and viable false when even free
 * land does not reach the target.
 */
export function residualLand(input, targetPct) {
  const target = targetPct != null ? targetPct : n0(input.a?.targetMarginPct);
  const at = (L) => run({ ...input, land: L, dutyOverride: null }).marginOnCostPct - target;
  if (at(0) < 0) return { value: 0, viable: false, targetPct: target };
  const base = run({ ...input, land: 0, dutyOverride: null });
  let lo = 0; let hi = Math.max(1, base.revenue);
  while (at(hi) > 0 && hi < 1e11) hi *= 2;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) > 0) lo = mid; else hi = mid;
  }
  return { value: Math.round(lo), viable: true, targetPct: target };
}

// Sensitivity ---------------------------------------------------------------------------------------------------------------------
export const SENS_STEPS = Object.freeze([-10, 0, 10]);
/** Price (rows) against cost (columns) at -10, 0 and +10 per cent. Each cell { margin (on cost, %), profit }. */
export function sensitivity(input, steps = SENS_STEPS) {
  const cells = steps.map((p) => steps.map((k) => {
    const r = run({ ...input, mult: { price: 1 + p / 100, cost: 1 + k / 100 } });
    return { price: p, cost: k, margin: r.marginOnCostPct, profit: r.profit };
  }));
  return { steps, cells };
}

/** Everything the panels need in one call: the run at the chosen mode, both modes, the residual land value and the sensitivity grid. */
export function analyse(input) {
  const main = run(input);
  const sell = input.mode === 'sell' || !input.mode ? main : run({ ...input, mode: 'sell' });
  const hold = input.mode === 'hold' ? main : run({ ...input, mode: 'hold' });
  return { ...main, sell, hold, residual: residualLand(input), sensitivity: sensitivity(input) };
}

/** A plain note for a very poor or odd result, '' when there is nothing to say. */
export function sanityNotes(r) {
  const out = [];
  if (r.marginOnCostPct < -50) out.push('The margin is below -50%. Costs are far above the value at the rates used. Check the land price, the sale rate and the number of units before relying on it.');
  else if (r.marginOnCostPct < 0) out.push('A loss at these values.');
  if (r.mode === 'hold' && !(r.endValue > 0)) out.push('Enter a net yield to value the hold case.');
  if (r.peakEquity > 0 && r.peakDebt > 0 && r.profit < 0) out.push('Lenders usually look for a positive margin, so funding is uncertain at these values.');
  return out;
}

export { data as FINANCE_DATA };
