// Build rates per building type key (ESTIMATE, see data/build-rates.json) and the cost lines the feasibility panel adds for catalogue buildings.
import data from './data/build-rates.json' with { type: 'json' };

export const BUILD_RATES = data.rates;
export const BUILD_RATES_NOTE = data.note;
export const STRATA_KEY = 'strata-units';

/** The rate record of a key, or null (the strata key uses the panel's own build rate input). */
export const rateOf = (key) => (key && BUILD_RATES[key]) || null;

/** Lump sums that always go with a type, whatever its costHints say. */
export const EXTRA_KEYS = { 'service-station': ['service-station-canopy'] };

const mid = (r) => (Number.isFinite(r.value) ? r.value : (r.low + r.high) / 2);

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

const sideVal = (r, side) => (side === 'low' ? r.low : side === 'high' ? r.high : mid(r));

/**
 * Wall construction cost lines: the extra of a concrete or block wall over the metal clad already inside the building rate.
 * basis: { system, panelWallM2, wallM2 } from quantities().construction (or rowsWallBasis); spec: constructionSpec(params).
 * override: the person's own system rate per m2 of wall (replaces the system line only). Returns { total, lines }.
 */
export function wallCost(basis, spec, side = 'mid', override = null) {
  const lines = [];
  if (!basis || !(basis.panelWallM2 > 0) || basis.system === 'metal_clad') return { total: 0, lines };
  const area = basis.panelWallM2;
  const sysKey = basis.system === 'precast' ? 'wall-precast' : basis.system === 'blockwork' ? 'wall-blockwork' : 'wall-tilt_up';
  const add = (key, area_, rateOverride) => {
    const r = rateOf(key);
    if (!r) return;
    const v = rateOverride != null ? rateOverride : sideVal(r, side);
    lines.push({ key, label: r.label, rate: v, area: area_, perM2: true, wall: true, amount: v * area_, status: rateOverride != null ? 'EDITED' : r.status });
  };
  add(sysKey, area, override);
  if (basis.system !== 'blockwork') {
    add(`wall-finish-${spec.finish}`, area);
    if (spec.reveals !== 'none' || spec.featureBand) add('wall-reveals', area);
  }
  return { total: lines.reduce((a, l) => a + l.amount, 0), lines };
}
