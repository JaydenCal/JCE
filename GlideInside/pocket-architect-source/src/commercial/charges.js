// Council infrastructure charges for the feasibility panel (pure, no DOM). Data: market.json "charges" block (15/11/2026).
// NSW: s7.12 local infrastructure contribution, a percent of the cost of development above a threshold (the statutory maximum is the default,
// ESTIMATE). Queensland: base charge per m2 GFA by use, with stormwater per m2 impervious area where the council lists it. Townsville, Mackay
// and Toowoomba are read from the council resolution (VERIFIED_REPORT); every other Queensland council uses the prescribed base amounts that
// Mackay and Toowoomba adopt (ESTIMATE). The result is the default of the editable "Council charges" input; the person can type their own.
import market from './data/market.json' with { type: 'json' };

const C = market.charges;
export const CHARGES_DATE = C.NSW_s7_12.asAt;
const QLD_NAMED = Object.freeze({ townsville: 'Townsville', mackay: 'Mackay', toowoomba: 'Toowoomba' });
const STATUS_LABEL = Object.freeze({ VERIFIED_LISTING: 'Listing', VERIFIED_REPORT: 'Report', ESTIMATE: 'Estimate' });
export const statusLabel = (s) => STATUS_LABEL[s] || 'Estimate';

/** The use a building type is charged as. */
const USE_OF = Object.freeze({ 'strata-units': 'industry', warehouse: 'industry', depot: 'industry', shed: 'industry', workshop: 'industry', 'self-storage': 'industry', 'cold-store': 'industry', showroom: 'showroom', dealership: 'showroom', office: 'office', community: 'office', retail: 'shop', 'drive-through': 'shop', 'service-station': 'shop', 'service-station-kiosk': 'shop' });
export const useOf = (key) => USE_OF[key] || 'industry';

const fix = (v) => (Math.round(v * 100) / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The charge rule for an area: { model, label, short, status, asAt, sources, ...rates }.
 * model 'pctOfCost' (NSW) or 'perM2GFA' (Queensland). `state` is 'NSW' or 'QLD'.
 */
export function chargeRule(areaKey, state) {
  if (state === 'QLD') {
    const name = QLD_NAMED[areaKey];
    const c = name ? C.QLD.councils[name] : C.QLD.estimateDefault;
    const label = name ? c.label : 'Queensland prescribed base amounts (council schedule not read)';
    return {
      model: 'perM2GFA', council: name || null, label, short: name ? `${name} charges resolution` : 'prescribed base amounts, council not read',
      status: c.status, asAt: c.asAt, sources: c.sources.slice(), note: c.note,
      industry: c.industry, showroom: c.showroom, office: c.office, shop: c.shop, stormwaterPerM2Impervious: c.stormwaterPerM2Impervious ?? 0,
      basis: `${label}. Per m² GFA: industry ${fix(c.industry)}, showroom and office ${fix(c.showroom)}, shop ${fix(c.shop)}${c.stormwaterPerM2Impervious ? `; stormwater ${fix(c.stormwaterPerM2Impervious)} per m² of developed area` : ''}. Base charges, unindexed, ex GST not confirmed.`,
    };
  }
  const n = C.NSW_s7_12;
  return {
    model: 'pctOfCost', council: null, label: 'NSW s7.12 local infrastructure contribution', short: `s7.12 at ${n.pct}% above $${n.threshold.toLocaleString('en-AU')}`,
    status: n.status, asAt: n.asAt, sources: n.sources.slice(), note: n.note, pct: n.pct, threshold: n.threshold,
    basis: `NSW s7.12 levy: ${n.pct}% of the cost of development (building and site works) when it is above $${n.threshold.toLocaleString('en-AU')}. Statutory maximum used because the council plan rate was not read. Confirm the council plan.`,
  };
}

/**
 * The default charge in AUD. ctx: { constructionCost, rowsGroundM2, rowsMezzM2, buildings: [{ buildRateKey, gfaM2 }], devM2 }.
 * Strata rows are charged at the industry rate on the ground floor and at the office rate on the mezzanine.
 */
export function computeCharges(rule, ctx) {
  if (!rule) return 0;
  if (rule.model === 'pctOfCost') {
    const cost = Math.max(0, ctx.constructionCost || 0);
    return cost > rule.threshold ? (cost * rule.pct) / 100 : 0;
  }
  let total = (ctx.rowsGroundM2 || 0) * rule.industry + (ctx.rowsMezzM2 || 0) * rule.office;
  for (const b of ctx.buildings || []) if (!b.lumpSumOnly) total += (b.gfaM2 || 0) * rule[useOf(b.buildRateKey)];
  total += (ctx.devM2 || 0) * (rule.stormwaterPerM2Impervious || 0);
  return total;
}
