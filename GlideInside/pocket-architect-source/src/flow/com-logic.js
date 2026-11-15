// Commercial guided flow logic (no DOM): what can be built, putting a type on the lot, moving and turning buildings, adding and
// duplicating them, the wall system and the plain language check summary. Works on the real project so the editor opens with exactly what was placed.
// Wording: building, layout and site.

import * as G from '../model/geometry.js';
import { lotOf, classifyEdges } from '../model/placement.js';
import { DEFAULT_SETBACKS } from '../site/default-setbacks.js';
import { clearances } from '../site/lotplan.js';
import { setbackStatusLine } from '../site/lot-checks.js';
import { isCommercial } from '../commercial/schema.js';
import { convertToCommercial } from '../commercial/mode.js';
import { effectiveClass, zoneClass, zoneMismatch, RESIDENTIAL_NOTE, ZONE_CLASS_LABEL } from '../commercial/zones.js';
import { applyFinishes, finishesOf } from '../commercial/finishes.js';
import { materialise } from '../commercial/materialise.js';
import { normaliseCommercial } from '../commercial/schema.js';
import { rowFrame, rowLength, rowPoly, layoutUnits } from '../commercial/layout.js';
import { commercialStats } from '../commercial/stats.js';
import { feasibility, summaryRows, headlineRows, CAVEAT } from '../commercial/feasibility.js';
import { commercialStatus } from '../commercial/card-model.js';
import { siteAccess } from '../commercial/access.js';
import { buildingsOf } from '../commercial/catalogue/buildings.js';
import { typesForPicker, typeById, typeIconName, STRATA_ID } from '../commercial/catalogue/types/index.js';
import { switcherList, chooseFor, applyChoice, activeTypeId, switcherIndex } from '../commercial/catalogue/picker.js';
import { BEST_PRESET } from '../commercial/catalogue/fit.js';
import { addBuildingFit, duplicateBuilding, deleteBuilding, moveBuilding, rerunSiteLayout } from '../commercial/catalogue/ops.js';
import { buildingHandle } from '../commercial/catalogue/draw2d.js';
import { stepLayout } from '../commercial/layouts.js';
import { frontRotation } from '../commercial/catalogue/fit.js';

export const ESTIMATES = 'Estimates only, not a valuation or a quote. Check with council, a quantity surveyor and a registered valuer.';
export const INDICATIVE = 'Indicative only. Council makes the final call, so check with council before you rely on this.';
export const WALL_SYSTEMS = Object.freeze([
  { id: 'metal', label: 'Metal clad', blurb: 'Steel frame with profiled metal sheeting. Quicker and lighter.', cladding: 'pale-grey' },
  { id: 'tilt', label: 'Tilt-up concrete', blurb: 'Concrete panels cast on site and tilted up. Heavier and more robust.', cladding: 'tilt-panel-grey' },
]);

// Step 1: zone ----------------------------------------------------------------------------------------------------------------
/** A warning for a lot that is not in an industrial or commercial zone, else null. */
export function zoneWarning(project) {
  const lot = lotOf(project);
  if (!lot) return null;
  if (lot.customRules?.on) return null;
  const z = zoneClass(lot);
  if (!lot.zoning) return null;
  if (zoneMismatch(lot) || (!z.employment && !project.commercial?.zoneClass)) {
    return { text: `${RESIDENTIAL_NOTE}. This lot is zoned ${lot.zoning.code} ${lot.zoning.name}.`, code: lot.zoning.code };
  }
  return null;
}
export const zoneLabel = (project) => { const c = effectiveClass(project); return c ? ZONE_CLASS_LABEL[c] : 'Not an industrial or commercial zone'; };

// Step 2: what to build -------------------------------------------------------------------------------------------------------
const BLURB = {
  'strata-units': 'Rows of units, each with its own roller door. Good for sale or lease in lots.',
  warehouse: 'A warehouse with docks, a small office and a truck apron.',
  'service-station': 'Fuel canopy, kiosk, tanks and a forecourt with separate entry and exit.',
  'portal-shed': 'A simple portal frame shed.',
  office: 'A one to three storey office building.',
  canopy: 'A roof on posts for covered parking, storage or a wash bay.',
  'transport-depot': 'A depot with a truck hardstand, workshop and yard.',
  'cold-store': 'A chilled warehouse with dock doors and a truck apron.',
  'self-storage': 'Rows of lockable storage units with drive-up access.',
  'storage-shed': 'A plain shed for storage or equipment.',
  showroom: 'A large retail showroom with a front car park.',
  'drive-through': 'A food outlet with a drive-through lane and a car park.',
  kiosk: 'A small kiosk, on its own or beside a bigger building.',
  'retail-strip': 'A row of shops with parking out the front.',
  'amenities-block': 'Toilets and showers, on their own or beside a bigger building.',
  'car-wash': 'A car wash bay with a queue lane.',
  'machinery-dealership': 'A showroom, workshop and display yard for machinery.',
  'vehicle-workshop': 'A workshop with service bays and a car park.',
  'community-centre': 'A childcare or medical centre with a drop-off car park.',
};
/** The types the person can choose as the main building, strata first: [{ id, label, category, icon, blurb }]. */
export function commercialTypes() {
  return typesForPicker().map((t) => ({ id: t.id, label: t.id === STRATA_ID ? 'Strata units' : t.label, category: t.category, icon: typeIconName(t), blurb: BLURB[t.id] || '' }));
}

/** Put the project into commercial mode (inside the flow, on the first choice). One undo step. */
export function ensureCommercial(store) {
  if (isCommercial(store.project)) return false;
  store.apply('Commercial layout', (p) => { convertToCommercial(p, { useClass: effectiveClass(p) || 'industrial', name: 'Commercial site' }); });
  return true;
}

/** The buildings beyond the first (the extras added to the mix), as plain records to put back after a layout change. */
const extrasOf = (project) => (project.commercial?.buildings || []).slice(activeTypeId(project) === STRATA_ID ? 0 : 1).map((b) => ({ type: b.type, params: structuredClone(b.params || {}), place: structuredClone(b.place) }));

/**
 * Put the chosen main type on the lot with its Best fit layout, or the layout `layoutId` of its switcher. The extra buildings the person
 * added stay (placed again in free space). Returns the choice, or null when nothing could be chosen.
 */
export function chooseType(store, typeId, layoutId = BEST_PRESET) {
  ensureCommercial(store);
  const extras = extrasOf(store.project);
  const choice = chooseFor(store.project, typeId, layoutId);
  if (!choice) return null;
  applyChoice(store, typeId, choice);
  // A layout choice replaces the buildings, so the extra buildings are added again where they fit.
  for (const e of extras) { try { addBuildingFit(store, e.type, { params: e.params }); } catch { /* skip */ } }
  return choice;
}

/** Step to the next or previous layout of the type on the lot (wraps). Returns the choice. */
export function stepLayoutBy(store, dir) {
  const typeId = activeTypeId(store.project);
  const list = switcherList(typeId);
  const i = switcherIndex(store.project);
  const next = list[stepLayout(i, dir, list.length)];
  if (!next) return null;
  return chooseType(store, typeId, next.id);
}

/** { name, n, of } for the layout pager. */
export function layoutPager(project) {
  const typeId = activeTypeId(project);
  const list = switcherList(typeId);
  const i = switcherIndex(project);
  const lay = project.commercial?.layout;
  return { name: lay?.label || (i >= 0 ? list[i].label : 'Best fit'), n: i < 0 ? null : i + 1, of: list.length };
}

// Walls -----------------------------------------------------------------------------------------------------------------------
export const wallSystemOf = (project) => (isCommercial(project) && finishesOf(project).cladding === 'tilt-panel-grey' ? 'tilt' : 'metal');
export function setWallSystem(store, id) {
  const sys = WALL_SYSTEMS.find((w) => w.id === id);
  if (!sys || !isCommercial(store.project)) return false;
  store.apply(`Wall system, ${sys.label}`, (p) => {
    const cur = finishesOf(p).cladding;
    applyFinishes(p, { cladding: id === 'metal' && cur !== 'tilt-panel-grey' ? cur : sys.cladding });
    p.commercial.wallSystem = id;
    p.commercial = normaliseCommercial(p.commercial);
    materialise(p);
  });
  return true;
}

// Step 3: placing -------------------------------------------------------------------------------------------------------------
/** What can be selected on the stage: every catalogue building and every base strata row. */
export function placeables(project) {
  const c = project.commercial;
  if (!c) return [];
  const out = [];
  for (const b of buildingsOf(c)) out.push({ kind: 'building', id: b.id, label: b.label, outline: b.outline, extras: b.extras, planLabel: b.planLabel });
  for (const r of c.rows || []) {
    if (r.mirrorOf) continue;
    const polys = [rowPoly(r, c.rows), ...c.rows.filter((x) => x.mirrorOf === r.id).map((x) => rowPoly(x, c.rows))];
    out.push({ kind: 'row', id: r.id, label: 'Strata units', outline: polys[0], extras: [], more: polys.slice(1), planLabel: 'STRATA UNITS' });
  }
  return out;
}

const rowCentre = (r, rows) => { const fr = rowFrame(r, rows); const L = rowLength(r, rows); const d = r.unit.depthMm; return { x: fr.o.x + fr.u.x * (L / 2) + fr.f.x * (d / 2), y: fr.o.y + fr.u.y * (L / 2) + fr.f.y * (d / 2) }; };
const regen = (p) => { p.commercial = normaliseCommercial(p.commercial); materialise(p); };

/** Move a building or a base row by (dx, dy) mm. One undo step. */
export function moveBy(store, sel, dx, dy) {
  if (!sel) return;
  if (sel.kind === 'building') {
    const b = store.project.commercial.buildings.find((x) => x.id === sel.id);
    if (b) moveBuilding(store, sel.id, { x: b.place.x + dx, y: b.place.y + dy });
    return;
  }
  store.apply('Move units', (p) => { const r = p.commercial.rows.find((x) => x.id === sel.id); if (r) { r.x = Math.round(r.x + dx); r.y = Math.round(r.y + dy); } regen(p); });
}

/** Turn a building or a base row by `deg` about its own centre. One undo step. */
export function turnBy(store, sel, deg) {
  if (!sel) return;
  const norm = (d) => Math.round((((d % 360) + 360) % 360) * 100) / 100;
  if (sel.kind === 'building') {
    const b = buildingsOf(store.project.commercial).find((x) => x.id === sel.id);
    if (!b) return;
    const ctr = buildingHandle(b).centre;
    const rot = norm(b.place.rotationDeg + deg);
    // Keep the centre of the building where it is: turn the origin about the centre.
    const a = (deg * Math.PI) / 180;
    const o = { x: b.place.x - ctr.x, y: b.place.y - ctr.y };
    moveBuilding(store, sel.id, { x: Math.round(ctr.x + o.x * Math.cos(a) - o.y * Math.sin(a)), y: Math.round(ctr.y + o.x * Math.sin(a) + o.y * Math.cos(a)), rotationDeg: rot });
    return;
  }
  store.apply('Turn units', (p) => {
    const r = p.commercial.rows.find((x) => x.id === sel.id);
    if (!r) return;
    const c0 = rowCentre(r, p.commercial.rows);
    r.rotationDeg = norm((r.rotationDeg || 0) + deg);
    const c1 = rowCentre(r, p.commercial.rows);
    r.x = Math.round(r.x + c0.x - c1.x); r.y = Math.round(r.y + c0.y - c1.y);
    regen(p);
  });
}

/**
 * Mirror the layout left to right across the middle of the lot (the street stays at the front): every building and row moves to
 * the mirrored spot and faces the street the same way. Each building keeps its own handing.
 */
export function mirrorLayout(store) {
  const lot = lotOf(store.project);
  if (!lot) return false;
  const e0 = (lot.frontEdges || [])[0] ?? 0;
  const a = lot.boundary[e0]; const b = lot.boundary[(e0 + 1) % lot.boundary.length];
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  const n = { x: -u.y, y: u.x };
  const ss = lot.boundary.map((q) => (q.x - a.x) * u.x + (q.y - a.y) * u.y);
  const mid = (Math.min(...ss) + Math.max(...ss)) / 2;
  const refl = (p) => { const s = (p.x - a.x) * u.x + (p.y - a.y) * u.y; const t = (p.x - a.x) * n.x + (p.y - a.y) * n.y; const s2 = 2 * mid - s; return { x: a.x + u.x * s2 + n.x * t, y: a.y + u.y * s2 + n.y * t }; };
  const lotAng = (Math.atan2(u.y, u.x) * 180) / Math.PI;
  const norm = (d) => Math.round((((d % 360) + 360) % 360) * 100) / 100;
  store.apply('Mirror layout', (p) => {
    const c = p.commercial;
    const bs = buildingsOf(c);
    for (const rec of c.buildings || []) {
      const bl = bs.find((x) => x.id === rec.id);
      if (!bl) continue;
      const ctr = buildingHandle(bl).centre;
      const ctr2 = refl(ctr);
      // New turn: the facing is reflected about the lot's side axis, so the angle relative to the frontage direction is negated.
      const rel = rec.place.rotationDeg - lotAng;
      const rot = norm(lotAng - rel);
      // Place the origin so the centre of the footprint lands on the mirrored centre.
      const loc = bl.local.outline;
      const cx = (Math.min(...loc.map((q) => q.x)) + Math.max(...loc.map((q) => q.x))) / 2;
      const cy = (Math.min(...loc.map((q) => q.y)) + Math.max(...loc.map((q) => q.y))) / 2;
      const ar = (rot * Math.PI) / 180;
      rec.place = { x: Math.round(ctr2.x - (Math.cos(ar) * cx - Math.sin(ar) * cy)), y: Math.round(ctr2.y - (Math.sin(ar) * cx + Math.cos(ar) * cy)), rotationDeg: rot };
    }
    for (const r of c.rows || []) {
      if (r.mirrorOf) continue;
      const ctr = rowCentre(r, c.rows);
      const ctr2 = refl(ctr);
      const rel = (r.rotationDeg || 0) - lotAng;
      r.rotationDeg = norm(lotAng - rel);
      const c1 = rowCentre(r, c.rows);
      r.x = Math.round(r.x + ctr2.x - c1.x); r.y = Math.round(r.y + ctr2.y - c1.y);
    }
    regen(p);
  });
  return true;
}

/** Add another building of a type (the mix) in free space. Returns { id, fitted }. */
export const addToMix = (store, typeId) => addBuildingFit(store, typeId);
export { duplicateBuilding, deleteBuilding, rerunSiteLayout, frontRotation };

/** Best fit again: the main type's Best fit layout, extras kept. */
export function bestFitAgain(store) {
  return chooseType(store, activeTypeId(store.project), BEST_PRESET);
}

// Placement status ------------------------------------------------------------------------------------------------------------
/** { state: 'inside' | 'outside' | 'unknown' | 'none', text } for the setbacks, from the same line the lot card shows. */
export function placementStatus(project) {
  if (!isCommercial(project) || !lotOf(project)) return { state: 'none', text: '' };
  if (!(commercialStats(project).units + (project.commercial.buildings || []).length)) return { state: 'none', text: '' };
  const s = setbackStatusLine(project);
  return { state: s.state === 'inside' ? 'inside' : s.state === 'outside' ? 'outside' : 'unknown', text: s.text || 'Setbacks not confirmed, check with council' };
}

// Step 4: the check ------------------------------------------------------------------------------------------------------------
const KIND_TITLE = { front: 'Front', secondaryFront: 'Side street', side: 'Side', rear: 'Rear', unknown: 'Edge' };

/** Everything the Check it card says, as data. Distances in metres. Indicative only. */
export function checkSummary(project) {
  const lot = lotOf(project);
  if (!lot || !isCommercial(project)) return { ok: false, lines: ['Find your lot and choose a building first.'] };
  const stats = commercialStats(project);
  if (!stats.units && !stats.buildingCount) return { ok: false, lines: ['Choose what to build first.'] };
  const c = clearances(project);
  const st = placementStatus(project);
  const hasEnv = Array.isArray(lot.envelope) && lot.envelope.length >= 3;
  const rows = c.rows.map((r) => {
    const req = r.requiredM != null ? r.requiredM : hasEnv ? (DEFAULT_SETBACKS[r.kind] ?? null) : null;
    const met = r.clearanceM < -0.005 ? false : r.status === 'inside' ? true : r.status === 'outside' ? false : null;
    return { edge: r.edge, kind: r.kind, label: `${KIND_TITLE[r.kind] || 'Edge'} boundary`, clearanceM: r.clearanceM, requiredM: req, met };
  });
  const verdict = project.commercial.siteWorks?.notFit ? 'not-met' : st.state === 'inside' ? 'met' : st.state === 'outside' ? 'not-met' : 'unknown';
  const lotArea = Number(lot.areaM2) || G.polygonArea(lot.boundary) / 1e6;
  const sw = project.commercial.siteWorks;
  const park = stats.parking;
  const status = commercialStatus(project);
  const bs = buildingsOf(project.commercial);
  const truckBuildings = bs.filter((b) => (b.site?.vehicles?.docks || 0) > 0 || b.extras.some((e) => e.kind === 'apron'));
  const rowsTruck = layoutUnits(project.commercial).length > 0;
  const xo = sw?.crossovers || [];
  const rowsAccess = rowsTruck && !xo.length ? siteAccess(project.commercial, lot) : null;
  const truck = truckBuildings.length || rowsTruck
    ? { has: true, ok: (!!xo.length || !!rowsAccess) && xo.every((x) => x.widthMm >= 6000) && (!sw?.summary || Object.values(sw.summary.reachable || {}).every(Boolean)), crossoverM: xo.length ? Math.max(...xo.map((x) => x.widthMm)) / 1000 : rowsAccess ? rowsAccess.widthMm / 1000 : null }
    : { has: false, ok: true, crossoverM: null };
  let feas = null;
  try { feas = feasibility(project.commercial, lot); } catch { feas = null; }
  const rowsF = feas ? summaryRows(feas) : [];
  const pick = (label) => rowsF.find((r) => r[0].startsWith(label));
  const yieldRow = pick('Gross yield on cost');
  const headline = feas ? headlineRows(feas) : [];
  const yieldOk = feas ? feas.mid.yieldOk !== false : true;
  const valueRow = pick('End value by capitalisation');
  const costRow = pick('Total development cost');
  const rentRow = pick('Gross rent per year');
  const lines = [];
  for (const w of sw?.warnings || []) lines.push(w);
  const zw = zoneWarning(project);
  if (zw) lines.push(zw.text);
  if (verdict === 'met') lines.push('Every building sits inside the setbacks on every boundary.');
  else if (verdict === 'not-met') lines.push(`${st.text} Move or turn a building, or try another layout.`);
  else lines.push(st.text || 'Setbacks are not confirmed. Check with council.');
  lines.push(`The buildings cover about ${Math.round(stats.groundGfaM2 || 0)} m2 of the ${Math.round(lotArea)} m2 lot${stats.coveragePct != null ? ` (${Math.round(stats.coveragePct)} percent)` : ''}.`);
  lines.push(status.parking.text || 'Parking is not set out yet.');
  if (truck.has) lines.push(truck.ok ? `Trucks reach the loading area through a ${truck.crossoverM ? truck.crossoverM.toFixed(0) : '6'} m crossover and apron (indicative, swept paths still to be checked).` : 'Check truck access: the loading area is not clearly linked to a crossover.');
  if (lot.setbacksDefault) lines.push('Council setbacks could not be loaded for this lot, so a standard indicative envelope was used.');
  lines.push(INDICATIVE);
  return {
    ok: true, verdict, rows, lotAreaM2: lotArea, status: st, lines,
    coverageM2: stats.groundGfaM2 || 0, coveragePct: stats.coveragePct ?? (lotArea ? ((stats.groundGfaM2 || 0) / lotArea) * 100 : null),
    gfaM2: stats.gfaM2 ?? null,
    parking: { required: park.required, provided: park.provided, accessibleRequired: park.accessible.required, accessibleProvided: park.accessible.provided, text: status.parking.text, state: status.parking.state },
    truck,
    yield: yieldRow ? { headline, profitSell: headline[0]?.[1] || null, profitHold: headline[1]?.[1] || null, loss: feas ? feas.mid.marginSale < 0 : false, yieldOk, cost: costRow?.[1] || null, grossRent: rentRow?.[1] || null, rentBand: rentRow?.[2] || '', value: yieldOk ? valueRow?.[1] || null : 'Enter a yield', valueBand: valueRow?.[2] || '', yieldPct: yieldRow[1], yieldBand: yieldRow[2] || '' } : null,
    caveat: ESTIMATES,
    feasibilityCaveat: CAVEAT,
    wallSystem: wallSystemOf(project),
    typeLabel: project.commercial.layout?.label || project.name || 'Your site',
  };
}

/** Singular or plural: 1 bay, 2 bays. */
export const bayWord = (n) => `${n} ${n === 1 ? 'bay' : 'bays'}`;
/** One sentence for step 3, from the same parking numbers step 4 shows (stats.parking). */
export function baysText(park) {
  if (!park || (!park.provided && !park.required)) return '';
  return `${bayWord(park.provided)} laid out for ${park.required} indicated, ${park.accessible?.provided ?? 0} accessible${park.provided < park.required ? '. Space is short, so check with council.' : '.'}`;
}

export { typeById, activeTypeId, switcherList };
