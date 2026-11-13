// Indicative yield and value for a commercial layout. Pure functions, no DOM. Data: market-portal.json (real portal evidence, the
// primary source) and market.json (researched ranges, mostly ESTIMATE; used for yields, land, build costs and as the fallback where the
// portal evidence is missing or weak). Both as at 13/11/2026. All figures are AUD ex GST. Indicative only, not a valuation.

import market from './data/market.json' with { type: 'json' };
import portal from './data/market-portal.json' with { type: 'json' };
import { layoutUnits, mezzanineOf } from './layout.js';
import { lotAreaM2 } from './stats.js';

export const DATA_DATE = '13/11/2026';
export const MIN_N = 4; // portal medians from fewer listings than this are weak evidence and are not used
export const SMALL_UNIT_M2 = 400; // the ranges target 100 to 400 m2 strata units
export const CAVEAT = 'Indicative only, not a valuation. Figures from portal listings and published reports, check with a registered valuer and quantity surveyor.';
export const GST_NOTE = 'All figures are ex GST.';
export const RENT_NOTE = 'Rent is treated as net of recoverable outgoings and is capitalised at the net yield. Stamp duty, finance, holding costs and infrastructure contributions are not included.';
export const SOURCES_TEXT = `Sale and rent rates: commercialrealestate.com.au Factory, Warehouse and Industrial listings and sold statistics, read ${DATA_DATE}. Yields, land values and build costs: published ranges from cost guides and industry reports, mostly analyst estimates, ${DATA_DATE}.`;

/** The areas: key (the portal key), label, the market.json name and the council names (upper case, as the cadastre gives them) that map to it. */
export const AREAS = Object.freeze([
  { key: 'tamworth', label: 'Tamworth', m: 'Tamworth', lga: ['TAMWORTH REGIONAL', 'TAMWORTH'], towns: ['TAMWORTH', 'WESTDALE', 'CALALA', 'OXLEY VALE', 'KOOTINGAL', 'HILLVUE', 'WARREN'] },
  { key: 'gunnedah', label: 'Gunnedah', m: 'Gunnedah', lga: ['GUNNEDAH'], towns: ['GUNNEDAH'] },
  { key: 'narrabri', label: 'Narrabri', m: 'Narrabri', lga: ['NARRABRI'], towns: ['NARRABRI'] },
  { key: 'moree', label: 'Moree', m: 'Moree', lga: ['MOREE PLAINS', 'MOREE'], towns: ['MOREE'] },
  { key: 'armidale', label: 'Armidale', m: 'Armidale', lga: ['ARMIDALE REGIONAL', 'ARMIDALE'], towns: ['ARMIDALE'] },
  { key: 'glen-innes', label: 'Glen Innes', m: 'Glen Innes', lga: ['GLEN INNES SEVERN', 'GLEN INNES'], towns: ['GLEN INNES'] },
  { key: 'inverell', label: 'Inverell', m: 'Inverell', lga: ['INVERELL'], towns: ['INVERELL'] },
  { key: 'dubbo', label: 'Dubbo', m: 'Dubbo', lga: ['DUBBO REGIONAL', 'DUBBO'], towns: ['DUBBO'] },
  { key: 'orange', label: 'Orange', m: 'Orange', lga: ['ORANGE'], towns: ['ORANGE'] },
  { key: 'bathurst', label: 'Bathurst', m: 'Bathurst', lga: ['BATHURST REGIONAL', 'BATHURST'], towns: ['BATHURST'] },
  { key: 'mudgee', label: 'Mudgee', m: 'Mudgee', lga: ['MID WESTERN REGIONAL', 'MID-WESTERN REGIONAL', 'MID WESTERN'], towns: ['MUDGEE'] },
  { key: 'wagga-wagga', label: 'Wagga Wagga', m: 'Wagga Wagga', lga: ['WAGGA WAGGA'], towns: ['WAGGA WAGGA'] },
  { key: 'albury', label: 'Albury', m: 'Albury', lga: ['ALBURY'], towns: ['ALBURY'] },
  { key: 'kempsey', label: 'Kempsey', m: 'Kempsey', lga: ['KEMPSEY'], towns: ['KEMPSEY'] },
  { key: 'port-macquarie', label: 'Port Macquarie', m: 'Port Macquarie', lga: ['PORT MACQUARIE HASTINGS', 'PORT MACQUARIE-HASTINGS', 'PORT MACQUARIE'], towns: ['PORT MACQUARIE'] },
  { key: 'coffs-harbour', label: 'Coffs Harbour', m: 'Coffs Harbour', lga: ['COFFS HARBOUR'], towns: ['COFFS HARBOUR'] },
  { key: 'grafton', label: 'Grafton (Clarence Valley)', m: 'Grafton (Clarence Valley)', lga: ['CLARENCE VALLEY'], towns: ['GRAFTON'] },
  { key: 'lismore', label: 'Lismore', m: 'Lismore', lga: ['LISMORE'], towns: ['LISMORE'] },
  { key: 'ballina', label: 'Ballina', m: 'Ballina', lga: ['BALLINA'], towns: ['BALLINA'] },
  { key: 'muswellbrook', label: 'Muswellbrook', m: 'Muswellbrook', lga: ['MUSWELLBROOK'], towns: ['MUSWELLBROOK'] },
  { key: 'singleton', label: 'Singleton', m: 'Singleton', lga: ['SINGLETON'], towns: ['SINGLETON'] },
  { key: 'cessnock', label: 'Cessnock', m: 'Cessnock', lga: ['CESSNOCK'], towns: ['CESSNOCK'] },
  { key: 'maitland', label: 'Maitland', m: 'Maitland', lga: ['MAITLAND'], towns: ['MAITLAND'] },
  { key: 'lake-macquarie', label: 'Lake Macquarie', m: 'Lake Macquarie', lga: ['LAKE MACQUARIE'], towns: ['LAKE MACQUARIE'] },
  { key: 'newcastle', label: 'Newcastle', m: 'Newcastle', lga: ['NEWCASTLE', 'CITY OF NEWCASTLE'], towns: ['NEWCASTLE'] },
  { key: 'default', label: 'Regional NSW default', m: 'Regional NSW default', lga: [], towns: [] },
]);
const AREA_BY_KEY = new Map(AREAS.map((a) => [a.key, a]));
export const DEFAULT_AREA = 'default';

const norm = (s) => String(s || '').toUpperCase().replace(/\b(CITY|SHIRE|COUNCIL|MUNICIPAL|OF|THE)\b/g, ' ').replace(/-/g, ' ').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** The area key for a looked up lot: the council (LGA) first, then the suburb or town found in the address. Falls back to 'default'. */
export function areaKeyFor(lot) {
  if (!lot) return DEFAULT_AREA;
  const lga = norm(lot.lga);
  if (lga) {
    for (const a of AREAS) if (a.lga.some((n) => norm(n) === lga)) return a.key;
  }
  const hay = ` ${norm([lot.suburb, lot.locality, lot.address].filter(Boolean).join(' '))} `;
  for (const a of AREAS) if (a.towns.some((t) => hay.includes(` ${norm(t)} `))) return a.key;
  return DEFAULT_AREA;
}

const range = (o) => ({ low: o.low, high: o.high });
const mid = (r, step = 1) => Math.round(((r.low + r.high) / 2) / step) * step;
const strong = (v, n) => Number.isFinite(v) && v > 0 && Number.isFinite(n) && n >= MIN_N;
const fmtN = (v) => Math.round(v).toLocaleString('en-AU');

/**
 * The defaults for an area: { areaKey, label, inputs: { saleRate, rentRate, yieldPct, landRate, buildRate, siteRate, feesPct, contPct } }.
 * Every input is { value, low, high, status: 'PORTAL' | 'ESTIMATE', chip, note }. The sale rate for small strata units (average unit GFA
 * up to 400 m2) is the mean of the portal asking and sold medians, each used only with n >= 4; when only one is strong that one is used;
 * when neither is, the middle of the published range (ESTIMATE). Larger units use the sold median when strong.
 */
export function areaDefaults(areaKey, { avgUnitGfaM2 = 0 } = {}) {
  const area = AREA_BY_KEY.get(areaKey) || AREA_BY_KEY.get(DEFAULT_AREA);
  const m = market.areas[area.m] || market.areas['Regional NSW default'];
  const p = portal.areas[area.key] || {};
  const bc = market.buildCost;
  const est = (r, step, note, extra = {}) => ({ value: mid(r, step), ...range(r), status: 'ESTIMATE', chip: `Estimate, published range ${fmtN(r.low)} to ${fmtN(r.high)}`, note, ...extra });

  // Sale rate
  const sr = range(m.saleRatePerM2GFA);
  const askOk = strong(p.askMedPsm, p.askN);
  const soldOk = strong(p.soldMedPsm, p.soldN);
  const small = !(avgUnitGfaM2 > SMALL_UNIT_M2);
  let saleRate;
  const evidence = { askMedPsm: p.askMedPsm ?? null, askN: p.askN ?? 0, soldMedPsm: p.soldMedPsm ?? null, soldN: p.soldN ?? 0, askUsed: false, soldUsed: false };
  if (small && askOk && soldOk) {
    evidence.askUsed = evidence.soldUsed = true;
    saleRate = { value: Math.round((p.askMedPsm + p.soldMedPsm) / 2), ...sr, status: 'PORTAL', chip: `Portal data ${DATA_DATE} (n ${p.askN} asking, n ${p.soldN} sold)`, note: `Blend of the asking median $${fmtN(p.askMedPsm)} per m² and the sold median $${fmtN(p.soldMedPsm)} per m².` };
  } else if (!small && soldOk) {
    evidence.soldUsed = true;
    saleRate = { value: Math.round(p.soldMedPsm), ...sr, status: 'PORTAL', chip: `Portal data ${DATA_DATE} (n ${p.soldN} sold)`, note: `Sold median $${fmtN(p.soldMedPsm)} per m² (larger units).` };
  } else if (askOk || soldOk) {
    const v = askOk ? p.askMedPsm : p.soldMedPsm;
    const n = askOk ? p.askN : p.soldN;
    evidence[askOk ? 'askUsed' : 'soldUsed'] = true;
    saleRate = { value: Math.round(v), ...sr, status: 'PORTAL', chip: `Portal data ${DATA_DATE} (n ${n} ${askOk ? 'asking' : 'sold'})`, note: `${askOk ? 'Asking' : 'Sold'} median only, the other portal figure has fewer than ${MIN_N} listings.` };
  } else {
    const weak = [p.askN ? `n ${p.askN} asking` : null, p.soldN ? `n ${p.soldN} sold` : null].filter(Boolean).join(', ');
    saleRate = est(sr, 50, weak ? `Portal evidence is weak (${weak}), the published range is used.` : 'No portal listings for this area, the published range is used.');
  }
  saleRate.evidence = evidence;

  // Rent
  const rr = range(m.grossRentPerM2PerYr);
  const rentRate = strong(p.rentMedPsmPa, p.rentN)
    ? { value: Math.round(p.rentMedPsmPa), ...rr, status: 'PORTAL', chip: `Portal data ${DATA_DATE} (n ${p.rentN} listings)`, note: `Median advertised rent $${fmtN(p.rentMedPsmPa)} per m² per year.` }
    : est(rr, 5, p.rentN ? `Portal rent evidence is weak (n ${p.rentN}), the published range is used.` : 'No portal rent listings, the published range is used.');

  const yr = range(m.netYieldPct);
  const lr = range(m.industrialLandPerM2);
  const bR = range(bc.constructionPerM2GFA_regionalNSW_strataWorkshopWithMezzanineOffice);
  const sw = range(bc.civilSiteWorksPerM2Site);
  const fe = range(bc.professionalFeesPct);
  const co = range(bc.contingencyPct);
  const inputs = {
    saleRate,
    rentRate,
    yieldPct: { value: Math.round(((yr.low + yr.high) / 2) * 100) / 100, ...yr, status: 'ESTIMATE', chip: `Estimate, published range ${yr.low} to ${yr.high}`, note: 'No regional NSW net yield was published, the range is an assumption.' },
    landRate: est(lr, 5, 'Serviced industrial land prices are not published for most areas.'),
    buildRate: est(bR, 50, 'Secondary cost guides, not a quantity survey. Excludes fees and site works.'),
    siteRate: est(sw, 5, 'Pavements, drainage, services, landscaping and detention, per m² of site.'),
    feesPct: { value: Math.round(((fe.low + fe.high) / 2) * 100) / 100, ...fe, status: 'ESTIMATE', chip: `Estimate, published range ${fe.low} to ${fe.high}`, note: 'Percent of construction cost (build plus site works).' },
    contPct: { value: Math.round(((co.low + co.high) / 2) * 100) / 100, ...co, status: 'ESTIMATE', chip: `Estimate, published range ${co.low} to ${co.high}`, note: 'Percent of construction cost (build plus site works).' },
  };
  return { areaKey: area.key, label: area.label, confidence: m.confidence || null, inputs };
}

/** GFA of every unit including its mezzanine, in m2, in plan order: [{ n, ground, mezz, gfa }]. */
export function unitGfas(commercial) {
  return layoutUnits(commercial).map((u) => {
    const ground = (u.w * u.d) / 1e6;
    const mz = mezzanineOf(u.spec);
    const mezz = mz.enabled ? mz.areaM2 : 0;
    return { n: u.n, ground, mezz, gfa: ground + mezz };
  });
}

const INPUT_KEYS = ['saleRate', 'rentRate', 'yieldPct', 'landRate', 'buildRate', 'siteRate', 'feesPct', 'contPct'];

/** The effective values: the person's overrides (project.commercial.feasibility.v) on top of the defaults. */
export function effectiveInputs(defaults, overrides = {}) {
  const out = {};
  for (const k of INPUT_KEYS) {
    const d = defaults.inputs[k];
    const o = overrides[k];
    const edited = Number.isFinite(o) && o >= 0;
    out[k] = { ...d, value: edited ? o : d.value, edited, defaultValue: d.value, status: edited ? 'EDITED' : d.status, chip: edited ? 'Edited by you' : d.chip };
  }
  const price = Number(overrides.landPrice);
  out.landPrice = { value: Number.isFinite(price) && price > 0 ? price : null };
  return out;
}

const r0 = (v) => Math.round(v);

/** One scenario. side: 'mid' (the values in use), 'low' (low revenue, high cost) or 'high' (high revenue, low cost). */
function scenario(inp, { gfa, siteM2, lotM2 }, side) {
  const pick = (k, revenue) => {
    const x = inp[k];
    if (side === 'mid') return x.value;
    const lo = Math.min(x.low ?? x.value, x.value);
    const hi = Math.max(x.high ?? x.value, x.value);
    const wantHigh = side === 'high' ? revenue : !revenue; // revenue items are high in the high case, costs are high in the low case
    return wantHigh ? hi : lo;
  };
  const sale = pick('saleRate', true);
  const rent = pick('rentRate', true);
  const yieldPct = side === 'mid' ? inp.yieldPct.value : (side === 'high' ? Math.min(inp.yieldPct.low ?? inp.yieldPct.value, inp.yieldPct.value) : Math.max(inp.yieldPct.high ?? inp.yieldPct.value, inp.yieldPct.value));
  const landFixed = inp.landPrice.value;
  const land = landFixed != null ? landFixed : (lotM2 || 0) * pick('landRate', false);
  const build = gfa * pick('buildRate', false);
  const site = siteM2 * pick('siteRate', false);
  const construction = build + site;
  const fees = (construction * pick('feesPct', false)) / 100;
  const contingency = (construction * pick('contPct', false)) / 100;
  const cost = land + construction + fees + contingency;
  const realisation = gfa * sale;
  const grossRent = gfa * rent;
  const endValue = yieldPct > 0 ? grossRent / (yieldPct / 100) : 0;
  const marginSale = realisation - cost;
  const marginHold = endValue - cost;
  return {
    saleRate: sale, rentRate: rent, yieldPct, land, build, siteWorks: site, fees, contingency, cost,
    realisation, grossRent, endValue, marginSale, marginHold,
    marginSalePct: cost > 0 ? (marginSale / cost) * 100 : 0,
    marginHoldPct: cost > 0 ? (marginHold / cost) * 100 : 0,
    grossYieldOnCostPct: cost > 0 ? (grossRent / cost) * 100 : 0,
  };
}

/**
 * feasibility(commercial, lot, { areaKey, overrides }) -> everything the panel and the C103 section show.
 * Outputs are unrounded numbers; the UI rounds for display. Per unit price and rent use each unit's own GFA.
 */
export function feasibility(commercial, lot, opts = {}) {
  const fz = commercial?.feasibility || {};
  const detected = areaKeyFor(lot);
  const areaKey = opts.areaKey || fz.area || detected;
  const units = unitGfas(commercial);
  const gfa = units.reduce((s, u) => s + u.gfa, 0);
  const lotM2 = lotAreaM2(lot) || 0;
  const defaults = areaDefaults(areaKey, { avgUnitGfaM2: units.length ? gfa / units.length : 0 });
  const inputs = effectiveInputs(defaults, opts.overrides || fz.v || {});
  const ctx = { gfa, siteM2: lotM2, lotM2 };
  const mid_ = scenario(inputs, ctx, 'mid');
  const low = scenario(inputs, ctx, 'low');
  const high = scenario(inputs, ctx, 'high');
  const perUnit = units.map((u) => ({ n: u.n, gfa: u.gfa, price: u.gfa * mid_.saleRate, rent: u.gfa * mid_.rentRate }));
  return { areaKey, detectedKey: detected, areaLabel: defaults.label, confidence: defaults.confidence, units, perUnit, gfa, lotM2, inputs, defaults, mid: mid_, low, high, landFromPrice: inputs.landPrice.value != null, dataDate: DATA_DATE };
}

// Formatting, shared by the panel and the C103 section --------------------------------------------------------------------------
const m2 = (v) => (Math.round(v * 10) / 10).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
export const money = (v) => `${v < 0 ? '-' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-AU')}`;
export const pct1 = (v) => `${(Math.round(v * 10) / 10).toFixed(1)}%`;
export const band = (a, b, f = money) => (r0(a) === r0(b) ? f(a) : `${f(Math.min(a, b))} to ${f(Math.max(a, b))}`);

/** The summary lines [label, value, band] for the panel and for C103. Same wording in both. */
export function summaryRows(f) {
  const { mid: m, low: l, high: h } = f;
  return [
    ['GFA incl. mezzanine', `${m2(f.gfa)} m²`, ''],
    ['Gross realisation (GFA x sale rate)', money(m.realisation), band(l.realisation, h.realisation)],
    ['Gross rent per year', money(m.grossRent), band(l.grossRent, h.grossRent)],
    ['End value by capitalisation (net rent / yield)', money(m.endValue), band(l.endValue, h.endValue)],
    ['Total development cost', money(m.cost), band(h.cost, l.cost)],
    ['Gross yield on cost', pct1(m.grossYieldOnCostPct), band(l.grossYieldOnCostPct, h.grossYieldOnCostPct, pct1)],
    ['Indicative margin, sell the units', `${money(m.marginSale)} (${pct1(m.marginSalePct)} on cost)`, `${band(l.marginSale, h.marginSale)} (${band(l.marginSalePct, h.marginSalePct, pct1)})`],
    ['Indicative margin, hold and lease', `${money(m.marginHold)} (${pct1(m.marginHoldPct)} on cost)`, `${band(l.marginHold, h.marginHold)} (${band(l.marginHoldPct, h.marginHoldPct, pct1)})`],
  ];
}

/** The cost build up lines [label, value] at the values in use. */
export function costRows(f) {
  const m = f.mid;
  return [
    [f.landFromPrice ? 'Land (listing or purchase price)' : `Land (${money(f.inputs.landRate.value)} per m² x ${Math.round(f.lotM2).toLocaleString('en-AU')} m²)`, money(m.land)],
    [`Building (${money(f.inputs.buildRate.value)} per m² x ${m2(f.gfa)} m² GFA)`, money(m.build)],
    [`Site works (${money(f.inputs.siteRate.value)} per m² x ${Math.round(f.lotM2).toLocaleString('en-AU')} m² site)`, money(m.siteWorks)],
    [`Fees (${f.inputs.feesPct.value}% of building and site works)`, money(m.fees)],
    [`Contingency (${f.inputs.contPct.value}% of building and site works)`, money(m.contingency)],
    ['Total development cost', money(m.cost)],
  ];
}
