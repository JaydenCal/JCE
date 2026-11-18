// Builds the engine input and the assumption list (every value with its default, source and edited flag) for a commercial or a residential
// project. Pure: reads the project, never writes. Overrides: { fz, fin, area } where fz is the commercial feasibility override map
// (project.commercial.feasibility.v, shared with the earlier panel), fin is this model's own override map, area the chosen area key.
import data from './data/finance-data.json' with { type: 'json' };
import { stampDuty } from './engine.js';
import market from '../commercial/data/market.json' with { type: 'json' };
import { feasibility, AREAS, resolveArea, stateOf } from '../commercial/feasibility.js';
import { lotOf } from '../model/placement.js';
import { lotAreaM2 } from '../commercial/stats.js';
import * as G from '../model/geometry.js';
import { deriveDriveway } from '../site/lotplan.js';
import { extraPavedInLotM2 } from '../site/pavedways.js';

export const GROUPS = Object.freeze([
  ['revenue', 'Value and rent'], ['land', 'Land and acquisition'], ['costs', 'Construction and site works'], ['fees', 'Fees, approvals and contingency'],
  ['programme', 'Programme'], ['finance', 'Finance'], ['selling', 'Selling, GST and target'],
]);

const D = data.defaults;
const TYPICAL_HOUSE_M2 = 190;
const num = (v) => (v !== '' && v != null && Number.isFinite(Number(v)) ? Number(v) : null);
const round = (v, s = 1) => Math.round(v / s) * s;

/** One assumption row. kind 'number' or 'select' (options [[value, label]]). */
function desc(key, store, group, label, o) {
  return { key, store, group, label, kind: 'number', step: 1, min: 0, status: 'ESTIMATE', asAt: data.generated, source: '', ...o };
}
/** Applies the overrides map to a descriptor: value, edited, defaultValue. */
function withValue(d, ov) {
  const raw = ov?.[d.key];
  if (d.kind === 'select') {
    const ok = d.options.some(([v]) => v === raw);
    return { ...d, value: ok ? raw : d.defaultValue, edited: ok && raw !== d.defaultValue };
  }
  const n = num(raw);
  const edited = n != null && n >= 0;
  const max = d.max ?? Infinity;
  return { ...d, value: edited ? Math.min(max, n) : d.defaultValue, edited };
}
/** A descriptor from a finance-data.json default row. */
function fromData(key, group, row, step = 1, extra = {}) {
  const max = /Pct$/.test(key) ? 100 : Math.max(row.high * 10, 1);
  return desc(key, 'fin', group, row.label, { defaultValue: row.value, low: row.low, high: row.high, unit: row.unit, status: row.status, asAt: row.asAt, source: row.source, step, max, ...extra });
}
const MODE = (note) => desc('mode', 'fin', 'selling', 'Exit', { kind: 'select', options: [['sell', 'Sell'], ['hold', 'Hold and lease']], defaultValue: 'sell', unit: '', source: note || 'Sell the completed project, or hold it and value it by capitalising the net rent.' });
const GST = () => desc('gstMode', 'fin', 'selling', 'GST on the sale', { kind: 'select', options: [['none', 'Ignore GST (ex GST figures)'], ['margin', 'Margin scheme'], ['full', 'Full GST']], defaultValue: 'none', unit: '', source: data.gst.note, status: 'ESTIMATE' });

const commonDescs = (kind) => {
  const c = D.common; const k = D[kind];
  return [
    fromData('legalPct', 'land', c.legalPct, 0.1), fromData('ratesPct', 'land', c.ratesPct, 0.1),
    fromData('insurancePct', 'fees', c.insurancePct, 0.1), fromData('daFeePct', 'fees', c.daFeePct, 0.05),
    fromData('approvalsFixed', 'fees', k.approvalsFixed, 1000),
    fromData('approvalMonths', 'programme', k.approvalMonths), fromData('buildMonths', 'programme', k.buildMonths), fromData('tailMonths', 'programme', k.tailMonths),
    fromData('lcrPct', 'finance', c.lcrPct, 5), fromData('ratePct', 'finance', c.ratePct, 0.25), fromData('feePct', 'finance', c.feePct, 0.25),
    fromData('agentPct', 'selling', k.agentPct, 0.25), fromData('marketingPct', 'selling', k.marketingPct, 0.1),
    fromData('sellLegalPerUnit', 'selling', k.sellLegalPerUnit, 100), fromData('leasingMonths', 'selling', k.leasingMonths, 0.5),
    fromData('vacancyPct', 'revenue', k.vacancyPct, 1),
    fromData('cutRate', 'costs', k.cutRate), fromData('fillRate', 'costs', k.fillRate),
    desc('cutM3', 'fin', 'costs', 'Cut to remove', { defaultValue: 0, unit: 'm3', step: 10, max: 1e7, source: 'Enter the cut volume from the grading tool or a survey. Zero until set.' }),
    desc('fillM3', 'fin', 'costs', 'Fill to import', { defaultValue: 0, unit: 'm3', step: 10, max: 1e7, source: 'Enter the fill volume from the grading tool or a survey. Zero until set.' }),
    fromData('targetMarginPct', 'selling', c.targetMarginPct, 1),
    MODE(), GST(),
  ];
};

/** The area key and label for a residential lot. */
export function residentialArea(lot, areaKey) {
  const r = data.residential;
  const key = areaKey || resolveArea(lot).key;
  const alias = r.areaAlias[key] || key;
  const st = stateOf(lot) || AREAS.find((a) => a.key === key)?.state || 'NSW';
  if (r.areas[alias]) return { key: alias, ...r.areas[alias], status: r.areaStatus, asAt: r.areaAsAt, sourceDate: r.areaSourceDate, source: r.areaSource };
  const d = r.defaults[st] || r.defaults.NSW;
  return { key: `default-${st.toLowerCase()}`, label: d.label, state: st, medianDwelling: d.medianDwelling, status: d.status, asAt: r.areaAsAt, sourceDate: null, source: d.note };
}

// Commercial ----------------------------------------------------------------------------------------------------------------------
function marketArea(areaKey) {
  const a = AREAS.find((x) => x.key === areaKey);
  return a ? market.areas[a.m] : null;
}
/** Sale and rent rate and cap rate of a building type: the area's strata rates scaled by the type factor, the area's own showroom, office or retail rent when it has one. */
export function typeRates(areaKey, typeId, base) {
  const T = data.commercialTypes;
  const cat = T.typeOf[typeId] || 'strata';
  const t = T.types[cat];
  const m = marketArea(areaKey);
  const fld = t.rentField && m?.[t.rentField];
  const rentFromArea = fld && Number.isFinite(fld.low) && Number.isFinite(fld.high) ? (fld.low + fld.high) / 2 : null;
  const rent = base.rentEdited ? base.rent : rentFromArea ?? base.rent * t.rentF;
  const cap = base.yieldPct + t.capAdd;
  const sale = base.saleEdited ? base.sale : t.saleF != null ? base.sale * t.saleF : (rent * (1 - base.outgoingsPct / 100)) / (cap / 100);
  return { cat, label: t.label, sale, rent, capRatePct: cap, rentFromArea: rentFromArea != null && !base.rentEdited, note: t.note || '' };
}

export function commercialModel(project, ov = {}) {
  const c = project.commercial;
  const lot = project.site?.lot;
  const fz = ov.fz || c?.feasibility?.v || {};
  const fin = ov.fin || c?.finance?.v || {};
  const f = feasibility(c, lot, { overrides: fz, ...(ov.area !== undefined ? { areaKey: ov.area || undefined } : {}) });
  const state = f.areaState || 'NSW';
  const inp = f.inputs;
  const A = {};
  const descs = [];
  const add = (d) => { const e = withValue(d, d.store === 'fz' ? fz : fin); descs.push(e); A[e.key] = e.value; return e; };

  // Shared with the earlier panel: stored in feasibility.v.
  const fzDesc = (key, group, label, unit, step, extra = {}) => {
    const i = inp[key];
    return desc(key, 'fz', group, label, { defaultValue: i.defaultValue ?? i.value, low: i.low, high: i.high, unit, step, max: i.max, status: i.dataStatus || (i.status === 'PORTAL' ? 'VERIFIED_REPORT' : i.status), asAt: i.asAt || data.generated, source: `${i.chip}. ${i.note || ''}`.trim(), ...extra });
  };
  add(MODE()); add(GST());
  add(fzDesc('saleRate', 'revenue', 'Sale rate (strata units)', '$/m2 GFA', 50));
  add(fzDesc('rentRate', 'revenue', 'Gross rent (strata units)', '$/m2 a year', 5));
  add(fzDesc('yieldPct', 'revenue', 'Net yield (strata units)', '%', 0.25));
  add(fzDesc('outgoingsPct', 'revenue', 'Outgoings', '% of gross rent', 1));
  add(fzDesc('mezzFactor', 'revenue', 'Mezzanine value factor', 'x', 0.05));
  commonDescs('commercial').filter((d) => d.key === 'vacancyPct').forEach(add);
  const landEdited = fz.landPrice != null && Number(fz.landPrice) > 0;
  const landDefault = Math.round(f.landM2 * inp.landRate.value);
  add(desc('landPrice', 'fz', 'land', f.hugeLot ? 'Land price (development area only)' : 'Land price', { defaultValue: landDefault, unit: '$', step: 10000, max: 5e8, source: `Listing or purchase price. The default is the land rate times ${Math.round(f.landM2).toLocaleString('en-AU')} m2${f.hugeLot ? ' (huge lot rule: land is costed on the development area only)' : ''}.`, status: inp.landRate.dataStatus || 'ESTIMATE', asAt: inp.landRate.asAt || data.generated }));
  add(fzDesc('landRate', 'land', 'Land rate', '$/m2', 5));
  commonDescs('commercial').filter((d) => d.group === 'land').forEach(add);
  add(desc('dutyOverride', 'fin', 'land', 'Transfer duty (leave blank for the state scale)', { defaultValue: stampDuty(state, landEdited ? Number(fz.landPrice) : landDefault), unit: '$', step: 500, max: 1e8, source: `${data.duty[state].name}, scale from ${data.duty[state].scaleFrom}. ${data.duty[state].note}`, status: data.duty[state].status, asAt: data.duty[state].asAt, blankOk: true }));
  add(fzDesc('buildRate', 'costs', 'Build rate (GFA)', '$/m2', 50));
  add(fzDesc('costFactor', 'costs', 'Regional cost factor', 'x', 0.01));
  add(fzDesc('siteRate', 'costs', 'Site works (developed area)', '$/m2', 5));
  add(fzDesc('landscapeRate', 'costs', 'Clearing and landscaping (rest of lot)', '$/m2', 1));
  commonDescs('commercial').filter((d) => d.group === 'costs').forEach(add);
  add(fzDesc('councilCharges', 'costs', 'Council and infrastructure contributions', '$', 1000, { source: `${inp.councilCharges.chip}. ${inp.councilCharges.note || ''} Per lot, unit or m2 rates are in the council row. Editable as a total.` }));
  add(fzDesc('feesPct', 'fees', 'Design and professional fees', '% of construction', 0.5));
  add(fzDesc('contPct', 'fees', 'Contingency', '% of construction', 0.5));
  commonDescs('commercial').filter((d) => d.group === 'fees' || d.group === 'programme' || d.group === 'finance' || (d.group === 'selling' && d.key !== 'mode' && d.key !== 'gstMode')).forEach(add);

  // Revenue lines
  const mezzM2 = f.units.reduce((s, u) => s + u.mezz, 0);
  const rowsRev = Math.max(0, f.rowsGfa - mezzM2 * (1 - f.mid.mezzFactor));
  const base = { sale: A.saleRate, rent: A.rentRate, yieldPct: A.yieldPct, outgoingsPct: A.outgoingsPct, saleEdited: !!inp.saleRate.edited, rentEdited: !!inp.rentRate.edited };
  const revenue = [];
  if (rowsRev > 0) revenue.push({ label: 'Strata units', qty: rowsRev, saleRate: A.saleRate, rentRate: A.rentRate, capRatePct: A.yieldPct });
  for (const b of f.buildings) {
    const t = typeRates(f.areaKey, b.type, base);
    revenue.push({ label: `${b.label}`, qty: b.gfaM2, saleRate: Math.round(t.sale), rentRate: Math.round(t.rent * 10) / 10, capRatePct: t.capRatePct, cat: t.cat, note: t.note });
  }
  const earth = A.cutM3 * A.cutRate + A.fillM3 * A.fillRate;
  const input = {
    state, mode: A.mode, gstMode: A.gstMode, pricesIncGst: false,
    land: f.landFromPrice ? Number(fz.landPrice) : f.mid.land,
    dutyOverride: fin.dutyOverride != null && num(fin.dutyOverride) != null ? Number(fin.dutyOverride) : null,
    costs: { build: f.mid.build, siteWorks: f.mid.siteDev, earthworks: earth, landscape: f.mid.siteRest, contributions: f.mid.charges },
    a: { ...A, professionalPct: A.feesPct, units: f.units.length + f.buildings.length },
    revenue,
  };
  const notes = [];
  if (f.hugeLot) notes.push(`The lot is ${Math.round(f.lotM2).toLocaleString('en-AU')} m2, so land and clearing are costed on the development area only (${Math.round(f.landM2).toLocaleString('en-AU')} m2).`);
  return { kind: 'commercial', input, descs, notes, state, areaLabel: f.areaLabel, areaKey: f.areaKey, hugeLot: f.hugeLot, landM2: f.landM2, gfaM2: f.gfa, feas: f, units: input.a.units };
}

// Residential ---------------------------------------------------------------------------------------------------------------------
/** The built area of the home in m2 for costing: indoor rooms in full, garage at 0.6, roofed outdoor rooms at 0.5, and the footprint and paving. */
export function homeAreas(project) {
  let built = 0; let footprint = 0; let living = 0;
  const lv = [...(project.levels || [])].sort((a, b) => a.elevation - b.elevation);
  lv.forEach((l, i) => {
    let fp = 0;
    for (const r of l.rooms || []) {
      if (r.status === 'demolish' || !(r.polygon?.length >= 3)) continue;
      const a = G.polygonArea(r.polygon) / 1e6;
      if (r.type === 'garage') { built += a * 0.6; fp += a; continue; }
      if (r.type === 'carport') { built += a * 0.4; fp += a; continue; }
      if (r.outdoor) { if (r.roofed) { built += a * 0.5; fp += a; } continue; }
      built += a; living += a; fp += a;
    }
    if (i === 0) footprint = fp;
  });
  let paved = 0;
  try {
    const dw = deriveDriveway(project);
    paved = (dw?.ok ? G.polygonArea(dw.polygon) / 1e6 : 0) + extraPavedInLotM2(project);
  } catch { paved = 0; }
  return { built, living, footprint, paved };
}

export function residentialModel(project, ov = {}) {
  const lot = lotOf(project);
  const fin = ov.fin || project.finance?.v || {};
  const area = residentialArea(lot, ov.area !== undefined ? ov.area : project.finance?.area);
  const state = stateOf(lot) || area.state || 'NSW';
  const R = data.residential;
  const A = {};
  const descs = [];
  const add = (d) => { const e = withValue(d, fin); descs.push(e); A[e.key] = e.value; return e; };
  const lotM2 = Number(lot?.areaM2) || (lot?.boundary ? G.polygonArea(lot.boundary) / 1e6 : 0);
  const eff = lotM2 <= 1500 ? lotM2 : 1500 + (lotM2 - 1500) * 0.15;
  const h = homeAreas(project);

  add(MODE()); add(GST());
  add(desc('tier', 'fin', 'revenue', 'Finish and value tier', { kind: 'select', options: Object.entries(R.build.tiers).map(([k, v]) => [k, v.label]), defaultValue: 'standard', unit: '', source: `Tiers from the published build cost bands. ${R.build.source}`, status: R.build.status, asAt: R.build.asAt }));
  const tier = A.tier;
  // Value: the median dwelling value, scaled by tier, with the land share following the lot size and the rest following the floor area (about 190 m2 is a typical house).
  const lotF = Math.max(0.5, Math.min(4, eff / R.typicalLotM2));
  const sizeF = h.built > 0 ? Math.max(0.6, Math.min(2.2, (h.built / TYPICAL_HOUSE_M2) ** 0.75)) : 1;
  const ls = R.landShareOfValue.value;
  const valueDefault = round(area.medianDwelling * R.valueTierFactor[tier].value * (ls * lotF + (1 - ls) * sizeF), 5000);
  add(desc('salePrice', 'fin', 'revenue', 'Completed home and land value', { defaultValue: valueDefault, unit: '$', step: 10000, max: 5e8, source: `${area.label} median dwelling value $${area.medianDwelling.toLocaleString('en-AU')} (${area.status === 'VERIFIED_REPORT' ? `Cotality, data to April 2026, ${area.source}` : area.source}) times a tier factor of ${R.valueTierFactor[tier].value}, with the land share (${Math.round(ls * 100)} per cent) following the lot size and the rest following the floor area against a typical ${TYPICAL_HOUSE_M2} m2 house (ESTIMATE). A median of existing houses and units, not a valuation of this home.`, status: area.status === 'VERIFIED_REPORT' ? 'ESTIMATE' : area.status, asAt: area.asAt }));
  add(fromData('grossYieldPct', 'revenue', D.residential.grossYieldPct, 0.1));
  add(fromData('capRatePct', 'revenue', D.residential.capRatePct, 0.1));
  add(fromData('outgoingsPct', 'revenue', D.residential.outgoingsPct, 1));
  add(fromData('vacancyPct', 'revenue', D.residential.vacancyPct, 1));
  const landDefault = round(area.medianDwelling * ls * lotF, 5000);
  add(desc('landPrice', 'fin', 'land', 'Land price', { defaultValue: landDefault, unit: '$', step: 10000, max: 5e8, source: `${Math.round(R.landShareOfValue.value * 100)} per cent of the ${area.label} median dwelling value for a ${R.typicalLotM2} m2 lot, scaled by lot size (lots over 1,500 m2 count the excess at 15 per cent). ESTIMATE. Enter the actual price when known.`, status: 'ESTIMATE', asAt: data.generated }));
  add(desc('dutyOverride', 'fin', 'land', 'Transfer duty (leave blank for the state scale)', { defaultValue: stampDuty(state, landDefault), unit: '$', step: 500, max: 1e8, source: `${data.duty[state].name}, scale from ${data.duty[state].scaleFrom}. ${data.duty[state].note}`, status: data.duty[state].status, asAt: data.duty[state].asAt, blankOk: true }));
  commonDescs('residential').filter((d) => d.group === 'land').forEach(add);
  const tb = R.build.tiers[tier];
  add(desc('buildRate', 'fin', 'costs', 'Build rate', { defaultValue: tb.value, low: tb.low, high: tb.high, unit: '$/m2 of floor area', step: 50, max: 20000, status: R.build.status, asAt: R.build.asAt, source: `${tb.label}, ${R.build.source}. ${R.build.note}` }));
  add(desc('costFactor', 'fin', 'costs', 'Regional cost factor', { defaultValue: 1, unit: 'x', step: 0.01, max: 3, status: 'ESTIMATE', source: R.build.note }));
  add(fromData('pavingRate', 'costs', D.residential.pavingRate, 5)); add(fromData('servicesLump', 'costs', D.residential.servicesLump, 1000)); add(fromData('prepRate', 'costs', D.residential.prepRate, 5));
  commonDescs('residential').filter((d) => d.group === 'costs').forEach(add);
  const cDef = data.contributions.residentialPerDwelling[state] || data.contributions.residentialPerDwelling.NSW;
  add(desc('contributions', 'fin', 'costs', 'Council and infrastructure contributions', { defaultValue: cDef.value, low: cDef.low, high: cDef.high, unit: '$ per dwelling', step: 1000, max: 5e6, status: cDef.status, asAt: cDef.asAt, source: cDef.source }));
  add(fromData('professionalPct', 'fees', D.residential.professionalPct, 0.5)); add(fromData('contPct', 'fees', D.residential.contPct, 0.5));
  commonDescs('residential').filter((d) => d.group === 'fees' || d.group === 'programme' || d.group === 'finance' || (d.group === 'selling' && d.key !== 'mode' && d.key !== 'gstMode')).forEach(add);

  const earth = A.cutM3 * A.cutRate + A.fillM3 * A.fillRate;
  const build = h.built * A.buildRate * A.costFactor;
  const site = h.paved * A.pavingRate + (h.built > 0 ? A.servicesLump : 0) + h.footprint * A.prepRate;
  const input = {
    state, mode: A.mode, gstMode: A.gstMode, pricesIncGst: true,
    land: A.landPrice,
    dutyOverride: fin.dutyOverride != null && num(fin.dutyOverride) != null ? Number(fin.dutyOverride) : null,
    costs: { build, siteWorks: site, earthworks: earth, landscape: 0, contributions: h.built > 0 ? A.contributions : 0 },
    a: { ...A, units: 1 },
    revenue: h.built > 0 ? [{ label: 'Completed home and land', qty: 1, saleRate: A.salePrice, rentRate: A.salePrice * (A.grossYieldPct / 100), capRatePct: A.capRatePct }] : [],
  };
  const notes = [];
  if (h.built <= 0) notes.push('Choose a home first, so the build area and cost can be worked out.');
  return { kind: 'residential', input, descs, notes, state, areaLabel: area.label, areaKey: area.key, landM2: lotM2, gfaM2: h.built, areas: h, units: 1 };
}
