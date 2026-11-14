// Build rates per building type key (ESTIMATE, see data/build-rates.json) and the cost lines the feasibility panel adds for catalogue buildings.
import data from './data/build-rates.json' with { type: 'json' };

export const BUILD_RATES = data.rates;
export const BUILD_RATES_NOTE = data.note;
export const STRATA_KEY = 'strata-units';

/** The rate record of a key, or null (the strata key uses the panel's own build rate input). */
export const rateOf = (key) => (key && BUILD_RATES[key]) || null;

/** Lump sums that always go with a type, whatever its costHints say. */
export const EXTRA_KEYS = { 'service-station': ['service-station-canopy'] };

const mid = (r) => (r.low + r.high) / 2;

/**
 * The cost of one building at a side of the range. side: 'mid', 'low' (cheap end) or 'high' (dear end). A per m2 rate is multiplied by the GFA, a
 * lump sum stands once. extraKeys (costHints.extraKeys) add further lump sums or per m2 rates on the GFA.
 */
export function buildingCost(b, side = 'mid') {
  const keys = [b.buildRateKey, ...((b.def?.costHints?.extraKeys) || EXTRA_KEYS[b.buildRateKey] || [])].filter(Boolean);
  const lines = [];
  let total = 0;
  for (const key of keys) {
    const r = rateOf(key);
    if (!r) continue;
    const v = side === 'low' ? r.low : side === 'high' ? r.high : mid(r);
    const amount = r.lumpSum ? v : v * (b.gfaM2 || 0);
    total += amount;
    lines.push({ key, label: r.label || key, rate: v, perM2: !r.lumpSum, amount, status: r.status });
  }
  return { total, lines };
}
