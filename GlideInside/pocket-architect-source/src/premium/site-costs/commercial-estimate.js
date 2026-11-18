// Indicative site cost estimator: earthworks (cut and fill from the design surface), driveway, retaining and service connection allowances.
// Pure maths in estimateSiteCost (rates and quantities in, dollars out). siteQuantities reads a project (async, because the terrain model
// lives with the 3D code). Everything here is INDICATIVE: rates are editable allowances, not quotes, and not a bill of quantities.
// Wording rule: never a fixed fee for any consultant; contractor style allowances only, ex GST, in AUD.

import * as G from '../../model/geometry.js';

export const ESTIMATE_NOTE = 'Indicative allowance only, ex GST. Rates are editable placeholders and local costs vary widely. It is not a quote, a bill of quantities or a cost plan. Get a builder or quantity surveyor price before you rely on it.';

/** Default rates. Editable in the card. Placeholders for a regional NSW or QLD site, not a price list. */
export const DEFAULT_RATES = Object.freeze({
  cutPerM3: 28, // excavate and spread or cart on site
  fillPerM3: 45, // imported or won fill, placed and compacted
  cartAwayPerM3: 40, // extra on cut that cannot be reused on site
  reuseCutPct: 60, // share of cut reused as fill on the lot, percent
  drivewayPerM2: 120, // concrete driveway including base
  crossoverPerM2: 220, // crossover and layback in the road reserve
  paveworksPerM2: 95, // commercial hardstand and car park pavement
  retainingPerM2: 480, // retaining wall face area, wall height up to about 1.2 m, engineered
  waterPerM: 90, // water service run
  sewerPerM: 160, // sewer or on-site effluent connection run
  stormwaterPerM: 110, // stormwater pipe to the discharge point
  powerTelcoPerM: 80, // power and telecommunications conduit
  connectionEach: 1800, // meter, tapping and connection allowance per service, five services
  contingencyPct: 15, // percent added over the subtotal
});

export const RATE_FIELDS = [
  { key: 'cutPerM3', label: 'Cut', unit: '$ per m3' },
  { key: 'fillPerM3', label: 'Fill (imported, compacted)', unit: '$ per m3' },
  { key: 'cartAwayPerM3', label: 'Cart away surplus cut', unit: '$ per m3' },
  { key: 'reuseCutPct', label: 'Cut reused as fill on the lot', unit: 'percent' },
  { key: 'drivewayPerM2', label: 'Driveway', unit: '$ per m2' },
  { key: 'crossoverPerM2', label: 'Crossover', unit: '$ per m2' },
  { key: 'paveworksPerM2', label: 'Hardstand and car park', unit: '$ per m2' },
  { key: 'retainingPerM2', label: 'Retaining wall (face area)', unit: '$ per m2' },
  { key: 'waterPerM', label: 'Water service', unit: '$ per m' },
  { key: 'sewerPerM', label: 'Sewer or effluent line', unit: '$ per m' },
  { key: 'stormwaterPerM', label: 'Stormwater line', unit: '$ per m' },
  { key: 'powerTelcoPerM', label: 'Power and telecommunications', unit: '$ per m' },
  { key: 'connectionEach', label: 'Connection allowance, each of 5 services', unit: '$ each' },
  { key: 'contingencyPct', label: 'Contingency', unit: 'percent' },
];

const n0 = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const r2 = (v) => Math.round(v * 100) / 100;
const money = (v) => Math.round(v);

/** Rates with anything missing or invalid taken from the defaults. Percentages are held to 0 to 100. */
export function cleanRates(input = {}) {
  const out = {};
  for (const k of Object.keys(DEFAULT_RATES)) {
    const v = input?.[k];
    out[k] = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : DEFAULT_RATES[k];
  }
  out.reuseCutPct = Math.min(100, out.reuseCutPct);
  out.contingencyPct = Math.min(100, out.contingencyPct);
  return out;
}

/**
 * estimateSiteCost(quantities, rates) -> { lines: [{ id, group, label, qty, unit, rate, amount, note }], groups, subtotal, contingency, total }
 * quantities: { cutM3, fillM3, drivewayM2, crossoverM2, paveworksM2, retainingM2, waterM, sewerM, stormwaterM, powerTelcoM, connections }
 */
export function estimateSiteCost(q = {}, ratesIn = {}) {
  const rt = cleanRates(ratesIn);
  const cut = n0(q.cutM3);
  const fill = n0(q.fillM3);
  const reused = Math.min(cut * (rt.reuseCutPct / 100), fill); // cut that goes straight into fill on the lot
  const surplus = Math.max(0, cut - reused);
  const lines = [];
  const add = (id, group, label, qty, unit, rate, note = '') => lines.push({ id, group, label, qty: r2(qty), unit, rate, amount: money(qty * rate), note });
  add('cut', 'Earthworks', 'Cut to design surface', cut, 'm3', rt.cutPerM3, 'Natural ground above the design surface');
  add('fill', 'Earthworks', 'Fill to design surface', fill, 'm3', rt.fillPerM3, 'Natural ground below the design surface');
  add('cart', 'Earthworks', 'Cart away surplus cut', surplus, 'm3', rt.cartAwayPerM3, `${rt.reuseCutPct} percent of the cut is assumed reused as fill`);
  add('driveway', 'Driveway and paving', 'Driveway', n0(q.drivewayM2), 'm2', rt.drivewayPerM2);
  add('crossover', 'Driveway and paving', 'Crossover', n0(q.crossoverM2), 'm2', rt.crossoverPerM2);
  if (n0(q.paveworksM2) > 0) add('pave', 'Driveway and paving', 'Hardstand and car park', n0(q.paveworksM2), 'm2', rt.paveworksPerM2);
  add('retaining', 'Retaining', 'Retaining walls', n0(q.retainingM2), 'm2', rt.retainingPerM2, 'Face area, where the pad needs to be held up or cut in');
  add('water', 'Services', 'Water service run', n0(q.waterM), 'm', rt.waterPerM);
  add('sewer', 'Services', 'Sewer or effluent line', n0(q.sewerM), 'm', rt.sewerPerM);
  add('stormwater', 'Services', 'Stormwater line', n0(q.stormwaterM), 'm', rt.stormwaterPerM);
  add('power', 'Services', 'Power and telecommunications', n0(q.powerTelcoM), 'm', rt.powerTelcoPerM);
  add('connections', 'Services', 'Connections (water, sewer, stormwater, power, telco)', n0(q.connections), 'each', rt.connectionEach);
  const groups = [];
  for (const l of lines) {
    let g = groups.find((x) => x.name === l.group);
    if (!g) groups.push(g = { name: l.group, amount: 0 });
    g.amount += l.amount;
  }
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const contingency = money(subtotal * (rt.contingencyPct / 100));
  return { lines, groups, subtotal, contingencyPct: rt.contingencyPct, contingency, total: subtotal + contingency, rates: rt };
}

export const fmtAUD = (v) => `$${Math.round(v).toLocaleString('en-AU')}`;

// Quantities from a project --------------------------------------------------------------------------------------------------------

const RETAIN_MIN_DEPTH_M = 0.9; // a pad edge held more than this above or below natural ground is counted as needing a wall
const SAMPLE_M = 2;

/** Polygons (plan mm) the building pad sits on: the residential building hull or the commercial building outlines. */
async function padPolygons(project) {
  const lp = await import('../../site/lotplan.js');
  if (project.mode === 'commercial' && project.commercial) {
    const { buildingsOf } = await import('../../commercial/catalogue/buildings.js');
    const polys = buildingsOf(project.commercial).map((b) => b.outline).filter((o) => o?.length >= 3);
    if (polys.length) return polys;
  }
  const hull = lp.buildingHull(project);
  return hull.length >= 3 ? [hull] : [];
}

/**
 * Cut and fill (m3) between the natural ground and the design surface (the graded pad, driveway and paving the 3D view uses), sampled over
 * the lot on a grid. Fill is where the design surface is above natural ground. Returns { cutM3, fillM3, cellM, samples, maxCutM, maxFillM, basis }
 * or null when the lot has no ground levels (no contours or grid), because nothing can be worked out then.
 */
export async function earthworksOf(project, { cellM = 1.5, maxSamples = 60000 } = {}) {
  const lot = project?.site?.lot;
  if (!lot?.boundary?.length || !lot.terrain) return null;
  const { terrainModel } = await import('../../viewer3d/terrain.js');
  const tm = terrainModel(project, { cellM: 0.75 });
  if (!tm) return null;
  const poly = lot.boundary;
  const bb = G.bbox(poly);
  let step = cellM * 1000;
  while (((bb.maxX - bb.minX) / step) * ((bb.maxY - bb.minY) / step) > maxSamples) step *= 1.5;
  const holes = lot.holes || [];
  let cut = 0; let fill = 0; let maxCut = 0; let maxFill = 0; let samples = 0;
  const area = (step / 1000) ** 2;
  for (let x = bb.minX + step / 2; x < bb.maxX; x += step) {
    for (let y = bb.minY + step / 2; y < bb.maxY; y += step) {
      const p = { x, y };
      if (!G.pointInPolygon(p, poly) || holes.some((h) => G.pointInPolygon(p, h))) continue;
      samples++;
      const d = tm.heightAt(x, y) - tm.rawAt(x, y);
      if (d > 0.005) { fill += d * area; if (d > maxFill) maxFill = d; } else if (d < -0.005) { cut += -d * area; if (-d > maxCut) maxCut = -d; }
    }
  }
  return { cutM3: Math.round(cut), fillM3: Math.round(fill), cellM: step / 1000, samples, maxCutM: r2(maxCut), maxFillM: r2(maxFill), basis: tm.grading ? 'Graded design surface (pad, driveway and paving) against natural ground' : 'Building pad against natural ground' };
}

/** Length (m) and face area (m2) of pad edge held more than RETAIN_MIN_DEPTH_M above or below natural ground. */
export async function retainingOf(project) {
  const lot = project?.site?.lot;
  if (!lot?.terrain) return { lengthM: 0, faceM2: 0, avgHeightM: 0 };
  const polys = await padPolygons(project);
  if (!polys.length) return { lengthM: 0, faceM2: 0, avgHeightM: 0 };
  const { terrainModel } = await import('../../viewer3d/terrain.js');
  const tm = terrainModel(project, { cellM: 0.75 });
  let length = 0; let face = 0;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]; const b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y) / 1000;
      const n = Math.max(1, Math.round(len / SAMPLE_M));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const x = a.x + (b.x - a.x) * t; const y = a.y + (b.y - a.y) * t;
        const depth = Math.abs(tm.heightAt(x, y) - tm.rawAt(x, y));
        if (depth >= RETAIN_MIN_DEPTH_M) { length += len / n; face += (len / n) * depth; }
      }
    }
  }
  return { lengthM: r2(length), faceM2: r2(face), avgHeightM: length ? r2(face / length) : 0 };
}

/** Driveway, crossover and paving areas (m2). */
export async function pavingOf(project) {
  const lp = await import('../../site/lotplan.js');
  const out = { drivewayM2: 0, crossoverM2: 0, paveworksM2: 0, source: 'none' };
  if (project.mode === 'commercial' && project.commercial) {
    try {
      const { pavementModel } = await import('../../commercial/catalogue/pavements/logic.js');
      const m = pavementModel(project.commercial, project.site.lot);
      out.paveworksM2 = r2(m.quantities?.totalAreaM2 ?? m.areas.reduce((s, a) => s + (a.areaM2 || 0), 0));
      out.source = 'commercial pavements';
    } catch { /* no pavements */ }
    return out;
  }
  const dw = lp.deriveDriveway(project);
  if (dw?.ok && dw.polygon?.length >= 3) {
    const cross = dw.crossover?.polygon?.length >= 3 ? G.polygonArea(dw.crossover.polygon) / 1e6 : 0;
    const total = G.polygonArea(dw.polygon) / 1e6;
    out.crossoverM2 = r2(cross);
    out.drivewayM2 = r2(Math.max(0, total - 0)); // the driveway polygon is the on-lot part; the crossover is separate
    out.source = 'driveway';
  }
  return out;
}

/** Service run length (m): the nearest building edge to the nearest street boundary, plus 3 m inside the building. 12 m when it cannot be told. */
export async function serviceRunOf(project) {
  const lp = await import('../../site/lotplan.js');
  const lot = project?.site?.lot;
  const fallback = 12;
  if (!lot?.boundary?.length) return fallback;
  try {
    const c = lp.clearances(project);
    const front = c.byKind?.front?.clearanceM;
    if (Number.isFinite(front)) return r2(Math.max(5, front + 3));
  } catch { /* use fallback */ }
  return fallback;
}

/**
 * Everything the estimator needs from a project: { quantities, earthworks, retaining, paving, notes }.
 * Quantities the design cannot give (no ground levels, no driveway) are 0 and the notes say why, so nothing is quietly invented.
 */
export async function siteQuantities(project) {
  const notes = [];
  const earthworks = await earthworksOf(project);
  if (!earthworks) notes.push('No ground levels for this lot, so cut and fill could not be worked out. Add the lot from an address to get contours.');
  const retaining = await retainingOf(project);
  const paving = await pavingOf(project);
  if (paving.source === 'none') notes.push('No driveway or paving is drawn yet.');
  const run = await serviceRunOf(project);
  const quantities = {
    cutM3: earthworks?.cutM3 || 0, fillM3: earthworks?.fillM3 || 0,
    drivewayM2: paving.drivewayM2, crossoverM2: paving.crossoverM2, paveworksM2: paving.paveworksM2,
    retainingM2: retaining.faceM2,
    waterM: run, sewerM: run, stormwaterM: run, powerTelcoM: run, connections: 5,
  };
  return { quantities, earthworks, retaining, paving, serviceRunM: run, notes };
}

/** One call: quantities from the project, then the estimate. The person's edited quantities and rates (overrides) win. */
export async function estimateForProject(project, { rates = {}, overrides = {} } = {}) {
  const sq = await siteQuantities(project);
  const quantities = { ...sq.quantities, ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v >= 0)) };
  return { ...sq, quantities, estimate: estimateSiteCost(quantities, rates) };
}
