// The working of the commercial assistant: buildings, automatic placement, measuring a layout, the best fit search and the options for
// the comparison table. Pure functions over the project (no DOM). Everything that changes the project does so on the object it is given,
// so the caller runs it inside store.apply and gets one undo step.
//
// Measuring never materialises the model: a layout is a "scheme" (rows, extra bays, buildings) that is measured on a light copy of the
// commercial spec, so hundreds can be tried quickly.

import * as G from '../../model/geometry.js';
import { lotOf } from '../../model/placement.js';
import { isCommercial, normaliseCommercial } from '../../commercial/schema.js';
import { materialise } from '../../commercial/materialise.js';
import { layoutUnits } from '../../commercial/layout.js';
import { parkingLayout } from '../../commercial/parking.js';
import { commercialStats, lotAreaM2 } from '../../commercial/stats.js';
import { chooseLayout, naturalAngle, TEMPLATES, BEST_ID, rowsSignature } from '../../commercial/layouts.js';
import { feasibility, unitGfas } from '../../commercial/feasibility.js';
import { typeById, defaultsOf, resolveParams, typeFacts, commercialTypes } from './commercial-catalogue.js';
import { buildingsOf as catalogueBuildings, buildingTotals, newBuilding } from '../../commercial/catalogue/buildings.js';
import { bayDemand, buildingParking } from '../../commercial/catalogue/bays.js';
import { placeBuilding, polysOverlap } from '../../commercial/catalogue/fit.js';

export class CommercialError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OpError'; // store.runBatch reports OpError as a failed step instead of throwing
  }
}
export const fail = (m) => {
  throw new CommercialError(m);
};

const r1 = (v) => Math.round(v * 10) / 10;
const TOL = 5;
const OVERLAP_TOL = 100;
export const MAX_OPTIONS = 3;

// Buildings ----------------------------------------------------------------------------------------------------------------------
export const buildingsOf = (p) => (Array.isArray(p?.commercial?.buildings) ? p.commercial.buildings : []);

/**
 * Everything the assistant needs about one building record, or null when its type is not in the catalogue. The geometry is the catalogue's
 * own (catalogue/buildings.js buildingsOf and bays.js buildingParking): the outline and the extras in world mm, front edge on local y = 0
 * facing the street, bays in front of it. `loose` is every paved or roofed extra and bay that must stay on the lot.
 */
export function buildingGeom(b, c = null) {
  const spec = { ...(c || {}), buildings: [b] };
  const [cb] = catalogueBuildings(spec);
  if (!cb) return null;
  const bays = buildingParking(spec).rows.flatMap((r) => r.slots.map((s) => s.poly));
  const extras = cb.extras.map((e) => e.polygon);
  return {
    b, type: cb.def, cb,
    poly: cb.outline,
    loose: [...extras, ...bays],
    gfaM2: cb.gfaM2,
    groundM2: cb.groundM2,
    perUse: cb.q.perUse && typeof cb.q.perUse === 'object' ? cb.q.perUse : { [cb.def.category || 'building']: cb.gfaM2 },
    spaces: Math.ceil(bayDemand(cb).raw - 1e-9),
  };
}

let seq = 0;
export const newBuildingId = (list) => {
  const used = new Set((list || []).map((b) => b.id));
  let id;
  do { id = `bld_${(++seq).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`; } while (used.has(id));
  return id;
};

/** The catalogue draws a building's bays itself (catalogue/bays.js), so there are no assistant bay strips. This removes any left by an older version. */
export function syncBuildingBays(c) {
  const extra = (c.parking?.extra || []).filter((e) => !e.forBuilding);
  if (extra.length !== (c.parking?.extra || []).length) c.parking = { ...c.parking, extra };
}

// Geometry helpers ---------------------------------------------------------------------------------------------------------------
const distToPoly = (pt, poly) => {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, G.projectToSegment(pt, poly[i], poly[(i + 1) % poly.length]).d);
  return d;
};
const insidePoly = (pt, poly, tol = TOL) => G.pointInPolygon(pt, poly) || distToPoly(pt, poly) <= tol;
const envelopeOf = (lot) => (Array.isArray(lot?.envelope) && lot.envelope.length >= 3 ? lot.envelope : lot?.boundary);
const aabb = (poly) => G.bbox(poly);
const apart = (a, b) => a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY;
const clash = (A, B, tol = OVERLAP_TOL) => !apart(A.bb, B.bb) && G.convexOverlap(A.poly, B.poly, tol);
const shape = (poly) => ({ poly, bb: aabb(poly) });

/** Obstacles of a spec: unit footprints and bay polygons as { poly, bb } shapes. */
function obstaclesOf(c) {
  const units = layoutUnits(c).map((u) => ({ ...shape(u.poly), kind: 'unit', rowId: u.rowId }));
  const bays = parkingLayout(c).rows.flatMap((r) => r.slots.map((s) => ({ ...shape(s.poly), kind: 'bay' })));
  return { units, bays };
}

// Measuring ----------------------------------------------------------------------------------------------------------------------
/**
 * measure(p) -> { valid, issues, units, gfaM2, byUse, groundM2, coveragePct, parking, buildings, value }. p is a project or the light
 * stand-in { commercial, site }. value (indicative realisation, cost, margin) is worked out only when asked for, because it is slower.
 */
export function measure(p, { value = false } = {}) {
  const c = p.commercial;
  const lot = lotOf(p);
  const env = envelopeOf(lot);
  const st = commercialStats({ commercial: c, site: p.site });
  const park = parkingLayout(c);
  const geoms = (c.buildings || []).map((b) => buildingGeom(b, c));
  const issues = [];
  const unitList = layoutUnits(c);
  const units = unitList.map((u) => ({ ...shape(u.poly), rowId: u.rowId, n: u.n }));
  const bays = park.rows.flatMap((r) => r.slots.map((s) => shape(s.poly)));
  if (lot && env) {
    if (units.some((u) => u.poly.some((q) => !insidePoly(q, env)))) issues.push('Units extend outside the indicative setbacks');
    if (bays.some((s) => s.poly.some((q) => !insidePoly(q, lot.boundary)))) issues.push('Bays extend outside the lot');
  }
  for (let i = 0; i < units.length && !issues.includes('Units overlap'); i++) {
    for (let j = i + 1; j < units.length; j++) {
      if (units[i].rowId !== units[j].rowId && !apart(units[i].bb, units[j].bb) && G.convexOverlap(units[i].poly, units[j].poly, OVERLAP_TOL)) { issues.push('Units overlap'); break; }
    }
  }
  if (units.some((u) => bays.some((s) => !apart(u.bb, s.bb) && G.convexOverlap(s.poly, u.poly, OVERLAP_TOL)))) issues.push('Bays overlap units');
  geoms.forEach((g, i) => {
    if (!g) { issues.push(`Building ${c.buildings[i].id} has a type that is not in the catalogue`); return; }
    if (lot && env && g.poly.some((q) => !insidePoly(q, env))) issues.push(`${g.type.label} extends outside the indicative setbacks`);
    if (lot && g.loose.some((poly) => poly.some((q) => !insidePoly(q, lot.boundary)))) issues.push(`${g.type.label}: the apron and bays in front extend outside the lot`);
    if (units.some((u) => polysOverlap(g.poly, u.poly))) issues.push(`${g.type.label} overlaps a unit`);
    if (bays.some((s) => polysOverlap(g.poly, s.poly))) issues.push(`${g.type.label} overlaps bays`);
    geoms.forEach((h, j) => { if (j > i && h && (polysOverlap(g.poly, h.poly) || h.loose.some((q) => polysOverlap(g.poly, q)) || g.loose.some((q) => polysOverlap(h.poly, q)))) issues.push(`${g.type.label} overlaps ${h.type.label}`); });
  });
  const live = geoms.filter(Boolean);
  const bt = buildingTotals(c);
  const bGfa = bt.gfaM2 ?? live.reduce((s, g) => s + g.gfaM2, 0);
  const strataGfa = Math.max(0, st.gfaM2 - bGfa);
  const strataOffice = Math.max(0, st.officeM2 - (bt.perUse?.office || 0));
  const byUse = {};
  const add = (k, v) => { if (v > 0) byUse[k] = r1((byUse[k] || 0) + v); };
  add('strata units', strataGfa - strataOffice);
  add('office', strataOffice);
  for (const g of live) for (const [k, v] of Object.entries(g.perUse)) add(k, Number(v) || 0);
  const lotM2 = lotAreaM2(lot) || st.lotM2 || null;
  // The catalogue stats already hold the buildings: floor area, ground area, bays required and provided, accessible bays.
  const ground = st.footprintM2;
  const required = st.parking.required;
  const provided = st.parking.provided;
  const acc = st.parking.accessible;
  const parking = { required, provided, unitsRequired: required - (st.parking.buildingRequired || 0), accessible: { required: acc.required, provided: acc.provided }, ratePerM2: st.parking.ratePerM2 };
  const needBays = Number(p.__parkingMin) || 0;
  // With buildings the bays come from the automatic site layout, which reports a shortfall itself (a warning on the check step), so it is not a placement fault here.
  if (units.length + live.length && provided < required && !(live.length && p.commercial?.siteWorks)) issues.push(`Bays shown (${provided}) are fewer than the ${required} indicated`);
  if (provided < needBays) issues.push(`Bays shown (${provided}) are fewer than the ${needBays} asked for`);
  if (acc.required > 0 && acc.provided < acc.required) issues.push(`Accessible bays ${acc.provided} of ${acc.required}`);
  const out = {
    valid: issues.length === 0, issues,
    units: st.units, unitMix: st.mix, strataGfaM2: r1(strataGfa), gfaM2: r1(st.gfaM2), byUse, groundM2: r1(ground),
    coveragePct: lotM2 ? r1((ground / lotM2) * 100) : null, lotM2, parking,
    buildings: live.map((g) => ({ id: g.b.id, type: g.type.id, label: g.type.label, gfaM2: r1(g.gfaM2), groundM2: r1(g.groundM2), spaces: g.spaces })),
    unitAreas: unitGfas(c).map((u) => r1(u.gfa)),
    value: null,
  };
  if (value) out.value = indicative(p);
  return out;
}

/** Indicative realisation, cost and margin (ex GST). The catalogue feasibility already prices the buildings at their own type rates. */
export function indicative(p) {
  let f;
  try { f = feasibility(p.commercial, p.site?.lot); } catch { return null; }
  if (!f) return null;
  const m = f.mid;
  return {
    realisation: m.realisation, cost: m.cost, grossRent: m.grossRent, endValue: m.endValue, margin: m.realisation - m.cost, marginPct: m.cost > 0 ? ((m.realisation - m.cost) / m.cost) * 100 : 0,
    areaLabel: f.areaLabel, confidence: f.confidence, f,
  };
}

// Schemes ------------------------------------------------------------------------------------------------------------------------
/** A scheme is what a layout changes: { rows, extra, buildings, layout:{id,label}, label }. */
export const specOf = (p, scheme) => normaliseCommercial({
  ...p.commercial, rows: scheme.rows, waste: null, hydrant: null, buildings: scheme.buildings || [],
  parking: { ...p.commercial.parking, extra: scheme.extra || [] },
});

const standIn = (p, scheme, parkingMin = 0) => {
  const c = specOf(p, scheme);
  syncBuildingBays(c);
  return { commercial: c, site: p.site, __parkingMin: parkingMin };
};

export const schemeSignature = (s) => `${rowsSignature(s.rows)}|${(s.buildings || []).map((b) => `${b.type}@${Math.round(b.place.x)},${Math.round(b.place.y)}`).join(';')}`;

/** Put a scheme on the project (inside store.apply). Buildings keep their bay strips; the model is rebuilt. */
export function applyScheme(p, scheme) {
  if (!isCommercial(p)) fail('This design is not in commercial mode.');
  p.commercial.rows = structuredClone(scheme.rows);
  p.commercial.buildings = structuredClone(scheme.buildings || []);
  p.commercial.parking = { ...p.commercial.parking, extra: structuredClone(scheme.extra || []) };
  p.commercial.layout = { id: scheme.layout?.id || 'custom', label: scheme.label || scheme.layout?.label || 'Layout', tooBig: false, envKey: scheme.envKey ?? p.commercial.layout?.envKey ?? null, sig: rowsSignature(p.commercial.rows) };
  p.commercial = normaliseCommercial(p.commercial);
  syncBuildingBays(p.commercial);
  p.commercial = normaliseCommercial(p.commercial);
  materialise(p);
  p.name = scheme.label || p.name;
  return true;
}

/** Re-run the model and keep building bays in step after any edit to rows or buildings (inside store.apply). */
export function regen(p) {
  p.commercial = normaliseCommercial(p.commercial);
  syncBuildingBays(p.commercial);
  p.commercial = normaliseCommercial(p.commercial);
  materialise(p);
}

// Automatic placement ------------------------------------------------------------------------------------------------------------
/**
 * Where a building goes: the catalogue's own placement (catalogue/fit.js placeBuilding), turned to face the street, inside the setbacks, with
 * its apron, extras and bays on the lot and clear of the units, bays and other buildings. Returns { x, y, rotationDeg } or null when there is no room.
 */
export function autoPlace(p, type, params) {
  const lot = lotOf(p);
  if (!lot || !(lot.frontEdges || []).length) return null;
  try { return placeBuilding(p, newBuilding(type.id, { params })); } catch { return null; }
}

// Best fit search ----------------------------------------------------------------------------------------------------------------
const WIDTHS = [null, 4000, 5000, 6000, 8000, 10000, 12000];

/** The strata layouts worth trying: the named layouts and Best fit, each at several unit widths, trimmed until they fit. */
function strataCandidates(p, parkingMin) {
  const out = [];
  const seen = new Set();
  for (const id of [BEST_ID, ...TEMPLATES.map((t) => t.id)]) {
    const base = chooseLayout(p, id);
    if (!base || base.tooBig) continue;
    const top = Math.max(...base.rows.map((r) => r.count));
    for (const w of WIDTHS) {
      for (let count = top; count >= Math.max(1, top - 6); count--) {
        const rows = structuredClone(base.rows);
        for (const r of rows) {
          if (w) r.unit.widthMm = w;
          r.count = Math.min(r.count, count);
        }
        const scheme = { rows, extra: structuredClone(base.extra || []), buildings: [], layout: { id: base.id, label: base.label }, label: base.label, envKey: base.envKey };
        const key = schemeSignature(scheme);
        if (seen.has(key)) continue;
        seen.add(key);
        const m = measure(standIn(p, scheme, parkingMin));
        if (m.valid) { out.push({ scheme, m }); break; }
      }
    }
  }
  return out;
}

const FAMILY = (id, rows) => (id?.startsWith('b2b') ? 'Back to back' : id?.startsWith('court') ? 'Two rows with central apron' : id?.startsWith('large') ? 'Large units' : rows <= 1 ? 'Single row' : `${rows} rows`);

/** A name for a scheme that says what it is: "Back to back, 12 units of about 108 m2", or the buildings added to the units. */
const labelOf = (scheme, m) => {
  const avg = m.units ? Math.round(m.strataGfaM2 / m.units) : 0;
  const units = `${m.units} unit${m.units === 1 ? '' : 's'} of about ${avg} m\u00b2`;
  if (scheme.buildings?.length) {
    const counts = new Map();
    for (const b of scheme.buildings) counts.set(b.type, (counts.get(b.type) || 0) + 1);
    const names = [...counts].map(([id, n]) => `${n > 1 ? `${n} x ` : ''}${typeById(id)?.label || id}`);
    return m.units ? `${units} and ${names.join(', ')}` : names.join(', ');
  }
  return `${FAMILY(scheme.layout?.id, scheme.rows.length)}, ${units}`;
};

/** Resolve a request for building types into [{ type, params, count }]. Throws CommercialError for an unknown type. */
export function wantedBuildings(constraints = {}, lot = null) {
  const want = [];
  const add = (id, count, params) => {
    const t = typeById(id);
    if (!t) fail(commercialTypes().length ? `There is no building type ${id}. Types available: ${commercialTypes().map((x) => x.id).join(', ')}.` : 'Building types are not available in this version, so only strata units can be planned.');
    const r = resolveParams(t, params || {}, null, lot);
    if (!r.ok) fail(r.error);
    const have = want.find((w) => w.type.id === id && !params);
    if (have) have.count = Math.max(have.count, count);
    else want.push({ type: t, params: r.params, count });
  };
  for (const m of Array.isArray(constraints.mix) ? constraints.mix : []) add(String(m.type), Math.max(1, Math.min(4, Math.round(Number(m.count) || 1))), m.params);
  for (const id of Array.isArray(constraints.mustInclude) ? constraints.mustInclude : []) add(String(id), 1);
  return want;
}

/** Add the wanted buildings to a strata scheme by automatic placement. Returns the new scheme, or null when one does not fit. */
function withBuildings(p, scheme, want) {
  const s = { ...scheme, buildings: [] };
  // The biggest buildings are placed first: they are the hardest to fit.
  const list = want.flatMap((w) => Array.from({ length: w.count }, () => w)).sort((a, b) => (typeFacts(b.type, b.params).quantities?.groundM2 || 0) - (typeFacts(a.type, a.params).quantities?.groundM2 || 0));
  for (const w of list) {
    const probe = standIn(p, s);
    const place = autoPlace(probe, w.type, w.params);
    if (!place) return null;
    s.buildings.push({ id: newBuildingId(s.buildings), type: w.type.id, params: structuredClone(w.params), place });
  }
  return s;
}

const unitFilter = (constraints) => (m) => {
  const lo = Number(constraints.minUnitM2) || 0;
  const hi = Number(constraints.maxUnitM2) || Infinity;
  return m.unitAreas.every((a) => a >= lo && a <= hi);
};

/**
 * Every valid scheme for the lot with its measures: the strata candidates, and with building types asked for, those candidates with the
 * buildings added. Indicative values are worked out for the most promising ones only.
 */
export function searchSchemes(p, constraints = {}) {
  if (!isCommercial(p)) fail('This design is not in commercial mode.');
  const lot = lotOf(p);
  if (!lot || !(lot.frontEdges || []).length) fail('A lot with its street frontage set is needed first.');
  const parkingMin = Math.max(0, Math.round(Number(constraints.parkingMin) || 0));
  const want = wantedBuildings(constraints, lot);
  const keep = unitFilter(constraints);
  let pool = strataCandidates(p, parkingMin).filter((x) => keep(x.m));
  if (want.length) {
    // Buildings are larger than a row of units, so each candidate is tried as it is and then with fewer units until the buildings fit.
    // Candidates are spread over the whole range of floor areas, and a buildings only scheme closes the list.
    const sorted = [...pool].sort((a, b) => a.m.gfaM2 - b.m.gfaM2);
    const stride = Math.max(1, Math.floor(sorted.length / 24));
    const spaced = sorted.filter((_, i) => i % stride === 0).slice(0, 24);
    const bare = { rows: [], extra: [], buildings: [], layout: { id: 'buildings', label: 'Buildings only' }, label: 'Buildings only', envKey: spaced[0]?.scheme.envKey ?? null };
    const starts = spaced.reverse().map((x) => x.scheme);
    const mixed = [];
    const seen = new Set();
    for (const base of starts) {
      let s = null;
      for (let drop = 0; drop <= 12 && !s; drop += 2) {
        const rows = structuredClone(base.rows);
        for (const r of rows) r.count = Math.max(1, r.count - drop);
        s = withBuildings(p, { ...base, rows, extra: structuredClone(base.extra || []) }, want);
        if (!rows.length || rows.every((r) => r.count === 1)) break;
      }
      if (!s) continue;
      const sig = schemeSignature(s);
      if (seen.has(sig)) continue;
      seen.add(sig);
      const m = measure(standIn(p, s, parkingMin));
      if (m.valid && keep(m)) mixed.push({ scheme: s, m });
    }
    // Buildings only is the fallback when no scheme keeps any units.
    if (!mixed.length) {
      const s = withBuildings(p, bare, want);
      const m = s ? measure(standIn(p, s, parkingMin)) : null;
      if (m && m.valid && keep(m)) mixed.push({ scheme: s, m });
    }
    pool = mixed;
  }
  for (const x of pool) x.scheme.label = labelOf(x.scheme, x.m);
  // Values: the top candidates by floor area and by unit count (a margin follows floor area closely).
  const budget = Number(constraints.budgetAud) || 0;
  const top = new Set([...pool].sort((a, b) => b.m.gfaM2 - a.m.gfaM2).slice(0, 14));
  for (const x of [...pool].sort((a, b) => b.m.units - a.m.units).slice(0, 8)) top.add(x);
  for (const x of pool) {
    if (budget > 0 || top.has(x)) x.m.value = indicative(standIn(p, x.scheme), x.m.gfaM2 - x.m.strataGfaM2); // a budget needs the cost of every candidate
  }
  if (budget > 0) pool = pool.filter((x) => x.m.value && x.m.value.cost <= budget);
  return pool;
}

const byGoal = {
  max_gfa: (a, b) => b.m.gfaM2 - a.m.gfaM2 || b.m.units - a.m.units,
  max_units: (a, b) => b.m.units - a.m.units || b.m.gfaM2 - a.m.gfaM2,
  max_margin: (a, b) => (b.m.value?.margin ?? -Infinity) - (a.m.value?.margin ?? -Infinity) || b.m.gfaM2 - a.m.gfaM2,
};

/** The best scheme in a pool for a goal, or null. min_cost is the lowest cost per m2 among those with at least 60% of the most floor area. */
export function pickBest(pool, goal, skip = new Set()) {
  const list = pool.filter((x) => !skip.has(schemeSignature(x.scheme)));
  if (!list.length) return null;
  if (goal === 'min_cost') {
    const most = Math.max(...list.map((x) => x.m.gfaM2));
    const rated = list.filter((x) => x.m.value && x.m.gfaM2 >= 0.6 * most);
    if (!rated.length) return [...list].sort(byGoal.max_gfa)[0];
    return rated.sort((a, b) => a.m.value.cost / a.m.gfaM2 - b.m.value.cost / b.m.gfaM2)[0];
  }
  return [...list].sort(byGoal[goal] || byGoal.max_gfa)[0];
}

/**
 * Three (or two) different options for the comparison table: most floor area, most units, and a third that differs again (a building mix
 * when the catalogue has types, else the largest units). Each is { id, label, scheme, m }.
 */
export function compareOptions(p, n = MAX_OPTIONS) {
  const count = Math.max(2, Math.min(MAX_OPTIONS, Math.round(Number(n) || MAX_OPTIONS)));
  const lot = lotOf(p);
  const strata = searchSchemes(p, {});
  if (!strata.length) fail('No layout fits this lot inside the indicative setbacks and bay count.');
  const chosen = [];
  const seen = new Set();
  const take = (x, label) => { if (x && !seen.has(schemeSignature(x.scheme))) { seen.add(schemeSignature(x.scheme)); chosen.push({ ...x, label: label || x.scheme.label }); return true; } return false; };
  take(pickBest(strata, 'max_gfa'), null);
  take(pickBest(strata, 'max_units', seen), null);
  if (count >= 3) {
    let third = null;
    const types = commercialTypes();
    if (types.length) {
      // The warehouse first, then the other industrial types, then the rest, until one of them fits the lot with units.
      const order = [...types].sort((a, b) => (b.id === 'warehouse') - (a.id === 'warehouse') || (b.category === 'industrial') - (a.category === 'industrial'));
      for (const t of order.slice(0, 5)) {
        third = pickBest(searchSchemes(p, { mix: [{ type: t.id, count: 1 }] }), 'max_gfa', seen);
        if (third) break;
      }
    }
    if (!third) {
      // Large units: the layout with the largest average unit that has not been picked yet.
      third = [...strata].filter((x) => !seen.has(schemeSignature(x.scheme))).sort((a, b) => (b.m.gfaM2 / Math.max(1, b.m.units)) - (a.m.gfaM2 / Math.max(1, a.m.units)) || b.m.gfaM2 - a.m.gfaM2)[0];
    }
    take(third, null);
  }
  // Pad with the best remaining margins so the table has the number asked for.
  for (const x of [...strata].sort(byGoal.max_margin)) { if (chosen.length >= count) break; take(x, null); }
  const ids = ['A', 'B', 'C'];
  return chosen.slice(0, count).map((x, i) => {
    if (!x.m.value) x.m.value = indicative(standIn(p, x.scheme), x.m.gfaM2 - x.m.strataGfaM2);
    return { id: ids[i], label: x.label, scheme: x.scheme, m: x.m, lotM2: lot ? lotAreaM2(lot) : null };
  });
}
