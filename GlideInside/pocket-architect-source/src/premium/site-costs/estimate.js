// Indicative site cost estimate for a house on its lot. Low, likely and high figures, every line with its quantity, rate and note.
//   estimateSiteCosts(project, { settings, earthworks }) -> { ok, region, lines, subtotal, surcharges, contingency, total, ... }
// Ground quantities come from the grading engine through readEarthworks (earthworks-adapter.js) only. The finance tool calls
// estimateSiteCosts(project) and reads .total.likely (also on window.__ps.estimateSiteCosts). Indicative only, not a quote, GST excluded.
// Pure and Node compatible. No dashes in text.

import * as G from '../../model/geometry.js';
import { deriveDriveway, clearances, boundaryDims } from '../../site/lotplan.js';
import { siteAreaOf } from '../exporters/eng/area.js';
import { readEarthworks } from './earthworks-adapter.js';
import { councilRules, metres, citation, NOT_FOUND } from './council.js';
import { loadSettings, rateOf, regionOf, isCustomised, anyCustomised, RATE_BY_ID, REGIONS, RATES_DATE, SLOPE_BANDS, ACCESS_BANDS } from './rates.js';

export const DISCLAIMER = 'Indicative site cost estimate only. Not a quote. Allowances from the 3D grading and default rates, GST excluded. Confirm with a site survey, a geotechnical report, the council and the utilities before pricing a contract.';

const STUB_M = 2; // from the boundary to the connection in the street verge
export const RURAL_M2 = 4000;
const r0 = (n) => Math.round(n);
const round50 = (n) => Math.round(n / 50) * 50;

function isRural(lot, areaM2) {
  const code = String(lot?.zoning?.code || '');
  return areaM2 >= RURAL_M2 || /^(RU|RLQ|E[1-4]|RUR)/i.test(code);
}

/** Distance (m) from the building to the nearest street frontage, or null. */
export function distanceToStreetM(project) {
  try {
    const c = clearances(project);
    const rows = c.rows.filter((r) => r.kind === 'front' || r.kind === 'secondaryFront');
    if (!rows.length) return null;
    return Math.min(...rows.map((r) => r.clearanceM));
  } catch { return null; }
}

/** Width (m) of the street frontage: the sum of the front edges. */
export function frontageM(lot) {
  const dims = boundaryDims(lot);
  const idx = Array.isArray(lot?.frontEdges) ? lot.frontEdges : [];
  const v = idx.map((i) => dims[i]?.lengthM || 0).reduce((a, b) => a + b, 0);
  return v > 0 ? Math.round(v * 10) / 10 : null;
}

export function slopeBand(pct) {
  if (!Number.isFinite(pct)) return 0;
  return SLOPE_BANDS.findIndex((b) => pct < b.upToPct);
}

/** Access band: 0 standard, 1 restricted (narrow frontage or a drive over 30 m), 2 difficult (battle axe frontage or a drive over 60 m). */
export function accessBand({ frontage, driveLengthM }) {
  if ((frontage != null && frontage < 5) || driveLengthM > 60) return 2;
  if ((frontage != null && frontage < 10) || driveLengthM > 30) return 1;
  return 0;
}

const f1 = (n) => (Math.round(n * 10) / 10).toString();
/** The council's rules set against this design: within, exceeds, information only, or not found (default used). */
export function councilChecks(council, { eng, driveWidthM, lot }) {
  const get = (k) => council.items.find((i) => i.key === k);
  const out = [];
  const push = (it, status, text) => out.push({ key: it.key, label: it.label, area: it.area, status, text, council: it.found ? it.text : NOT_FOUND, cite: it.cite, quote: it.quote });
  for (const it of council.items) {
    if (!it.found) { push(it, 'not_found', NOT_FOUND); continue; }
    const m = metres(it.rec);
    if (it.key === 'cut_fill_max_dcp' && m?.v > 0 && eng?.available) {
      const deep = Math.max(eng.maxCutM || 0, eng.maxFillM || 0);
      push(it, deep > m.v ? 'exceeds' : 'within', deep > m.v ? `Cut or fill up to ${f1(deep)} m, over the council figure of ${f1(m.v)} m: a batter, retaining wall or geotechnical advice is likely to be asked for.` : `Cut and fill up to ${f1(deep)} m, within the council figure of ${f1(m.v)} m.`);
    } else if (it.key === 'retaining_wall_max_height_exempt' && m?.v > 0 && eng?.available) {
      const h = eng.retaining?.maxHeightM || 0;
      push(it, h > m.v ? 'exceeds' : 'within', h > m.v ? `Retaining up to ${f1(h)} m, over the council trigger of ${f1(m.v)} m: engineering details are likely to be asked for.` : `Retaining, if any, up to ${f1(h)} m, within the council trigger of ${f1(m.v)} m.`);
    } else if (it.key === 'driveway_width_residential' && m && driveWidthM) {
      const lo = m.lo ?? m.v; const hi = m.hi ?? m.v;
      const ok = driveWidthM >= (lo ?? 0) - 0.01 && driveWidthM <= (hi ?? 99) + 0.01;
      push(it, ok ? 'within' : 'exceeds', ok ? `Driveway ${f1(driveWidthM)} m wide, within the council range.` : `Driveway ${f1(driveWidthM)} m wide, outside the council range ${f1(lo ?? 0)} to ${f1(hi ?? 0)} m: the crossing width is to be confirmed with the council.`);
    } else if (it.key === 'driveway_grade_max' && it.rec.u === '%' && it.rec.v > 0 && eng?.driveGradePct != null) {
      const g = eng.driveGradePct;
      push(it, g > it.rec.v ? 'exceeds' : 'within', g > it.rec.v ? `Driveway grade about ${f1(g)} percent, over the council figure of ${f1(it.rec.v)} percent.` : `Driveway grade about ${f1(g)} percent, within the council figure of ${f1(it.rec.v)} percent.`);
    } else push(it, 'info', it.key === 'driveway_distance_from_intersection' && !lot?.cornerLot ? 'Applies on a corner lot. Not a corner lot as drawn.' : 'For the council to confirm for this development.');
  }
  void get;
  return out;
}

export function estimateSiteCosts(project, opts = {}) {
  const lot = project?.site?.lot;
  if (!lot?.boundary?.length) return { ok: false, reason: 'no_lot', disclaimer: DISCLAIMER };
  const settings = opts.settings || loadSettings();
  const region = regionOf(lot, settings);
  const rate = (id) => rateOf(settings, id, region);
  // The council's own retaining trigger (where the council database has one) sets the height above which a wall is priced as engineered.
  const council = councilRules(lot);
  const trig = metres(council.items.find((i) => i.key === 'retaining_wall_max_height_exempt')?.rec);
  const tallM = trig?.v > 0.3 && trig.v < 3 ? trig.v : 1.0;
  const eng = opts.earthworks || readEarthworks(project, { tallM });
  const area = siteAreaOf(lot);
  const rural = isRural(lot, area.m2);
  const lines = [];
  const assumptions = [];
  const add = (id, label, qty, unit, note = '', extra = {}) => {
    const def = RATE_BY_ID[id];
    const rt = rate(id);
    const likely = qty * rt;
    lines.push({ id, group: def.group, label, qty: Math.round(qty * 100) / 100, unit, rate: rt, low: likely * def.lowF, likely, high: likely * def.highF, note, custom: isCustomised(settings, id, region), ...extra });
  };

  // Earthworks ------------------------------------------------------------------------------------------------------
  const pad = eng.padAreaM2 || 0;
  if (pad > 0) add('site_prep', 'Site preparation', pad, 'm2', 'Footprint plus a 1.5 m working margin.');
  if (eng.available) {
    if (eng.cutM3 > 0) add('cut_excavate', 'Excavate cut', eng.cutM3, 'm3', 'From the 3D grading, inside the lot.');
    if (eng.fillM3 > 0) add('fill_place', 'Place and compact fill', eng.fillM3, 'm3', 'From the 3D grading, inside the lot.');
    const net = eng.cutM3 - eng.fillM3;
    if (net > 0) add('export_spoil', 'Cart surplus spoil off site', net * rate('bulking'), 'm3', `Surplus ${net} m3 in the ground, bulked by ${rate('bulking')}.`);
    else if (net < 0) add('import_fill', 'Import fill', -net, 'm3', `Shortfall of ${-net} m3 to be brought in.`);
    if (settings.rock?.enabled && eng.cutM3 > 0) add('rock_extra', 'Rock excavation allowance', eng.cutM3 * settings.rock.fractionOfCut, 'm3', `${Math.round(settings.rock.fractionOfCut * 100)} percent of the cut assumed to be rock. A geotechnical report decides.`);
  } else if (pad > 0) {
    add('flat_allowance', 'Earthworks allowance', pad, 'm2', 'No ground levels are loaded for this lot, so cut and fill could not be read.');
    assumptions.push('No ground levels are loaded for this lot. Earthworks and retaining use a flat allowance and may be understated.');
  }

  // Retaining -------------------------------------------------------------------------------------------------------
  const ret = eng.retaining || { faceM2: 0, tallFaceM2: 0, lengthM: 0, maxHeightM: 0 };
  const lowWall = Math.max(0, ret.faceM2 - ret.tallFaceM2);
  if (lowWall > 0) add('retain_face', `Retaining wall to ${tallM} m`, lowWall, 'm2', `Where the batter does not fit inside the boundary. About ${ret.lengthM} m of boundary.`);
  if (ret.tallFaceM2 > 0) {
    const def = RATE_BY_ID.retain_face;
    const rt = rate('retain_face') * rate('retain_tall_factor');
    const likely = ret.tallFaceM2 * rt;
    lines.push({ id: 'retain_tall', group: 'Retaining', label: `Retaining wall over ${tallM} m (engineered)`, qty: ret.tallFaceM2, unit: 'm2', rate: rt, low: likely * def.lowF, likely, high: likely * def.highF, note: `Highest step about ${ret.maxHeightM} m. Needs engineering.${trig?.v === tallM ? ' The height is the council trigger.' : ''}`, custom: isCustomised(settings, 'retain_face', region) || isCustomised(settings, 'retain_tall_factor', region) });
  }

  // Driveway and crossover --------------------------------------------------------------------------------------------
  let driveLengthM = 0; let driveWidthM = null;
  try {
    const dw = deriveDriveway(project);
    if (dw?.ok) {
      const total = G.polygonArea(dw.polygon) / 1e6;
      const cross = dw.crossover?.polygon?.length > 2 ? G.polygonArea(dw.crossover.polygon) / 1e6 : 0;
      driveLengthM = Math.round(dw.lengthMm / 100) / 10;
      driveWidthM = dw.widthMm / 1000;
      const body = Math.max(0, total - cross);
      if (body > 0) add('drive_slab', 'Driveway', body, 'm2', `About ${driveLengthM} m long, ${Math.round(dw.widthMm) / 1000} m wide, including the crossover run.`);
      if (cross > 0) add('crossover', 'Kerb crossover', cross, 'm2', 'The council sets the standard and any fee.');
    } else assumptions.push('No driveway is drawn, so no driveway or crossover is included.');
  } catch { assumptions.push('The driveway could not be read, so none is included.'); }

  // Services by distance from the street --------------------------------------------------------------------------------
  const dist = distanceToStreetM(project);
  const runM = dist == null ? null : Math.max(0, dist) + STUB_M;
  if (runM != null) {
    const runs = [['water', 'Water service'], ['storm', 'Stormwater line to the street'], ['power', 'Underground power'], ['comms', 'Telecommunications conduit']];
    if (!rural) runs.push(['sewer', 'Sewer line']);
    for (const [k, label] of runs) {
      add(`${k}_run`, label, runM, 'm', `Building to the street ${Math.round(dist * 10) / 10} m plus ${STUB_M} m to the connection.`);
      add(`${k}_conn`, `${label.replace(/ line| service| conduit/, '')} connection`, 1, 'each', 'To the main in the street. The utility sets its own charges.');
    }
    if (rural) {
      add('onsite_wastewater', 'On site wastewater system', 1, 'each', 'Rural lot: sewer is not assumed.');
      assumptions.push('Rural lot: sewer is not assumed, an on site wastewater system is allowed instead. Water, power and telecommunications runs are priced from the street and may be much longer.');
    }
  } else assumptions.push('The building distance to the street could not be read, so service runs are not included.');

  // Surcharge bands -------------------------------------------------------------------------------------------------------
  const base = { low: 0, likely: 0, high: 0 };
  for (const l of lines) { base.low += l.low; base.likely += l.likely; base.high += l.high; }
  const surcharges = [];
  const frontage = frontageM(lot);
  const sb = slopeBand(eng.slopePct);
  const ab = accessBand({ frontage, driveLengthM });
  const band = (list, i, label, detail) => {
    const idOf = (k) => list[Math.max(0, Math.min(list.length - 1, k))].id;
    const pct = (k) => { const id = idOf(k); return id ? rate(id) : 0; };
    const lowP = pct(i - 1); const likP = pct(i); const highP = pct(i + 1);
    if (!likP && !highP) return;
    surcharges.push({ id: list[i].id || `${label}_none`, group: 'Surcharges', label: `${label}: ${list[i].label.toLowerCase()}`, qty: likP, unit: '% of works', rate: likP, low: base.low * lowP / 100, likely: base.likely * likP / 100, high: base.high * highP / 100, note: detail, custom: list[i].id ? isCustomised(settings, list[i].id, region) : false });
  };
  band(SLOPE_BANDS, sb, 'Slope', eng.slopePct == null ? 'Slope not read.' : `Natural ground falls about ${eng.slopePct} percent across the pad.`);
  band(ACCESS_BANDS, ab, 'Access', `Frontage ${frontage ?? 'not known'} m, driveway ${driveLengthM} m.`);
  const surchargeSum = { low: 0, likely: 0, high: 0 };
  for (const s of surcharges) { surchargeSum.low += s.low; surchargeSum.likely += s.likely; surchargeSum.high += s.high; }
  const sub = { low: base.low + surchargeSum.low, likely: base.likely + surchargeSum.likely, high: base.high + surchargeSum.high };

  // Contingency ---------------------------------------------------------------------------------------------------------
  const cdef = RATE_BY_ID.contingency;
  const cp = rate('contingency');
  const contingency = { id: 'contingency', group: 'Contingency', label: 'Contingency', qty: cp, unit: '% of works', rate: cp, low: sub.low * cp * cdef.lowF / 100, likely: sub.likely * cp / 100, high: sub.high * cp * cdef.highF / 100, note: 'Allowance for items not yet known.', custom: isCustomised(settings, 'contingency', region) };
  const total = { low: sub.low + contingency.low, likely: sub.likely + contingency.likely, high: sub.high + contingency.high };

  if (settings.rock?.enabled !== true) assumptions.push('Rock is not allowed for. Turn on the rock option if the site is known to have shallow rock.');
  assumptions.push('Footings, slab and the house build are not part of this estimate. It covers site works only.');

  const checks = councilChecks(council, { eng, driveWidthM, lot });
  const rounded = (t) => ({ low: round50(t.low), likely: round50(t.likely), high: round50(t.high) });
  return {
    ok: true, region, regionLabel: REGIONS[region], ratesDate: RATES_DATE, ratesCustomised: anyCustomised(settings), rural,
    inputs: { cutM3: eng.cutM3, fillM3: eng.fillM3, earthworksRead: eng.available, padAreaM2: eng.padAreaM2, slopePct: eng.slopePct, retaining: ret, driveLengthM, serviceRunM: runM, frontageM: frontage, siteAreaM2: area.m2, rockOn: settings.rock?.enabled === true },
    council, checks, lines, surcharges, subtotal: rounded(sub), contingency, total: rounded(total), totalExact: total, assumptions, disclaimer: DISCLAIMER,
  };
}

/** The same figures for the finance tool: whole dollars, low, likely and high. null when there is no lot. */
export function siteCostsForFinance(project, opts = {}) {
  const e = estimateSiteCosts(project, opts);
  return e.ok ? { lowAud: e.total.low, likelyAud: e.total.likely, highAud: e.total.high, region: e.region, ratesDate: e.ratesDate, indicative: true } : null;
}

export const fmtAud = (n) => `$${r0(n).toLocaleString('en-AU')}`;
