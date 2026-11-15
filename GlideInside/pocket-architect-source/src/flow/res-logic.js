// Residential guided flow logic (no DOM): the design list with fit and filters, placing a design on the lot (best fit, nudge, turn, mirror)
// and the plain language check summary. Everything works on the real project, so the editor opens with exactly what was placed.

import * as G from '../model/geometry.js';
import { lotOf, translateHouse, rotateHouse, houseCentre, classifyEdges, checkSetbacks } from '../model/placement.js';
import { DEFAULT_SETBACKS } from '../site/default-setbacks.js';
import { mirrorPlan } from '../model/ops.js';
import { houseStats, sizeLabel } from '../portal/house-stats.js';
import { buildingHull, clearances, deriveDriveway, garageDoor, garageStreetEdge, roadReserve } from '../site/lotplan.js';
import { chooseDesign, placeChoice, designPool } from '../ui/embed-viewer.js';
import { setbackStatusLine } from '../site/lot-checks.js';
import { rankFor } from '../lotcard/designs.js';
import { moveHouseBy, turnHouseBy, settleSiteItems } from '../site/site-items.js';

export const INDICATIVE = 'Indicative only. Council makes the final call, so check with council before you rely on this.';

// Choose a home ----------------------------------------------------------------------------------------------------------------
/** One row per design for the list: the stats, the size and the fit words. */
export function designRows(list) {
  return list.map((d) => {
    const s = houseStats(d.project);
    const st = d.fit?.status || 'unknown';
    const fitText = st === 'unknown' ? 'Fit not checked' : st === 'too-big' ? 'Does not fit' : d.fit.badge || 'Fits';
    return {
      id: d.id, name: d.name, group: d.group || null, design: d, stats: s, size: sizeLabel(s),
      // Frontage (lot width) in metres: set by the designs data; missing on older data, in which case the design is never filtered out.
      frontageM: Number.isFinite(d.frontageM) ? d.frontageM : Number.isFinite(d.project?.frontageM) ? d.project.frontageM : null,
      fitStatus: st, fitText, fitReason: d.fit?.reason || '', fits: st !== 'too-big' && st !== 'unknown',
    };
  });
}

/** Filter rows by bedrooms (null for any, 4 means 4 or more), lot width (frontage, m) and storeys (null for any, 2 means 2 or more). */
export function filterRows(rows, { bedrooms = null, storeys = null, frontage = null } = {}) {
  return rows.filter((r) => {
    if (bedrooms != null && (bedrooms >= 4 ? r.stats.bedrooms < 4 : r.stats.bedrooms !== bedrooms)) return false;
    if (storeys != null && (storeys >= 2 ? r.stats.storeys < 2 : r.stats.storeys !== storeys)) return false;
    // Lot width: a design suits a lot of that width or wider; 18 means 18 m and wider designs. A design with no frontage stays in.
    if (frontage != null && r.frontageM != null && (frontage >= 18 ? r.frontageM < 18 : r.frontageM > frontage)) return false;
    return true;
  });
}

/** The designs offered for this lot, ranked for fit: the signed in builder's own library, else the generic catalogue. */
export async function loadHomes(store, catalogue, app = typeof window !== 'undefined' ? window.__ps : null) {
  const pool = await designPool(store, catalogue, app);
  const list = pool.list.length && pool.list.every((d) => d.fit === undefined) ? rankFor(store.project, pool.list) : pool.list;
  return { rows: designRows(list), own: pool.own, empty: pool.empty };
}

// Place it ----------------------------------------------------------------------------------------------------------------------
/**
 * Place a design on the lot at the best fit: garage to the street, centred on the frontage behind the front setback, inside the setbacks
 * where it can be. Judged against the setbacks that design would have. One undo step. Returns { fits, tooBig, pick } or null.
 */
export async function placeBest(store, design) {
  const choice = await chooseDesign(store, { list: [design], own: false, empty: false }, design.id);
  if (!choice) return null;
  placeChoice(store, choice);
  return { fits: choice.fits, tooBig: !!store.project.placedHouse?.tooBig, pick: choice.pick };
}

/** Nudge the whole house by (dx, dy) mm: one undo step. */
export function nudgeHouse(store, dx, dy) {
  store.apply('Move house', (p) => { moveHouseBy(p, Math.round(dx), Math.round(dy)); });
}

/** Turn the house clockwise by `deg` about its centre. One undo step. */
export function turnHouse(store, deg) {
  store.apply('Rotate house', (p) => { turnHouseBy(p, deg, houseCentre(p)); });
}

/** Flip the house left to right, in place. One undo step. */
export function mirrorHouse(store) {
  store.apply('Mirror house', (p) => { mirrorPlan(p, 'left_right'); settleSiteItems(p); });
}

/** A cheap copy for live previews while dragging: the levels are copied, the lot is shared (never edited). */
export const previewCopy = (project) => ({ ...project, levels: structuredClone(project.levels), site: { ...project.site, tanks: structuredClone(project.site?.tanks || []) } });

/** Live placement status: 'inside' (green), 'outside' (amber) or 'unknown', the worst shortfall and plain words. */
export function placementStatus(project) {
  const lot = lotOf(project);
  if (!lot) return { state: 'none', text: 'Find your lot first.', rows: [] };
  const c = clearances(project);
  if (c.status === 'no_building') return { state: 'none', text: 'No home is placed yet.', rows: [] };
  const crossed = c.rows.filter((r) => r.clearanceM < -0.005);
  if (crossed.length) return { state: 'outside', text: 'The home crosses the lot boundary.', rows: c.rows, worst: crossed[0], breaches: [] };
  // The setback envelope decides (the council one, or the default indicative one while the council rules are not loaded).
  const chk = checkSetbacks(project);
  if (chk.status === 'breach' && chk.breaches?.length) {
    const w = chk.breaches[0];
    return { state: 'outside', text: `Too close to the ${edgeName(w.kind)} boundary by ${w.breachM.toFixed(2)} m.`, rows: c.rows, worst: w, breaches: chk.breaches };
  }
  if (chk.status === 'breach') return { state: 'outside', text: chk.message, rows: c.rows, breaches: [] };
  if (chk.status === 'ok') return { state: 'inside', text: 'Inside the setbacks.', rows: c.rows, breaches: [] };
  return { state: 'unknown', text: 'Setbacks are not loaded for this lot, so the position is not checked.', rows: c.rows, breaches: [] };
}

const edgeName = (kind) => ({ front: 'front', secondaryFront: 'side street', rear: 'rear', side: 'side' }[kind] || 'lot');
const KIND_TITLE = { front: 'Front', secondaryFront: 'Side street', rear: 'Rear', side: 'Side', unknown: 'Edge' };

// Check it ----------------------------------------------------------------------------------------------------------------------
const lowest = (project) => [...project.levels].sort((a, b) => a.elevation - b.elevation)[0];

/** Roofed ground floor area of the house in m2 (indoor, garage and roofed outdoor rooms), the site coverage figure. */
export function coverageM2(project) {
  const g = lowest(project);
  if (!g) return 0;
  let a = 0;
  for (const r of g.rooms) if (r.status !== 'demolish' && !(r.outdoor && !r.roofed) && r.polygon?.length >= 3) a += G.polygonArea(r.polygon);
  return a / 1e6;
}

/** Everything the Check it card says, as data. All distances in metres. */
export function checkSummary(project) {
  const lot = lotOf(project);
  if (!lot) return { ok: false, lines: ['Find your lot first.'] };
  const c = clearances(project);
  const st = placementStatus(project);
  const lotArea = Number(lot.areaM2) || G.polygonArea(lot.boundary) / 1e6;
  const cover = coverageM2(project);
  const edges = classifyEdges(lot);
  const hasEnv = Array.isArray(lot.envelope) && lot.envelope.length >= 3;
  const breached = new Set((st.breaches || []).map((b) => b.kind));
  const rows = c.rows.map((r) => {
    const req = r.requiredM != null ? r.requiredM : hasEnv ? (DEFAULT_SETBACKS[r.kind] ?? null) : null;
    const met = r.clearanceM < -0.005 ? false : r.status === 'inside' ? true : r.status === 'outside' ? false : hasEnv ? !breached.has(r.kind) : null;
    return { edge: r.edge, kind: r.kind, label: `${KIND_TITLE[r.kind] || 'Edge'} boundary`, clearanceM: r.clearanceM, requiredM: req, met };
  });
  const dw = deriveDriveway(project);
  const door = garageDoor(project);
  const frontIdx = edges.find((e) => e.kind === 'front')?.index;
  const streetEdge = garageStreetEdge(project);
  let garage = { has: !!door, facesStreet: false, distanceM: null };
  if (door) {
    const roads = roadReserve(lot);
    const r = roads.find((x) => x.edge === (streetEdge ?? frontIdx)) || roads[0];
    garage = { has: true, facesStreet: !!(dw?.ok) && !dw.routed, distanceM: r ? Math.round(G.dot(G.sub(door.mid, r.lines.property[0]), { x: -r.outward.x, y: -r.outward.y })) / 1000 : null };
  }
  const driveway = !door ? { state: 'none' } : dw?.ok ? { state: 'ok', lengthM: Math.round(dw.lengthMm / 100) / 10, widthM: Math.round(dw.widthMm / 100) / 10 } : { state: 'blocked', reason: dw?.reason || 'no_street' };
  const drivewayArea = dw?.ok ? G.polygonArea(dw.polygon) / 1e6 : 0;
  const open = lotArea > 0 ? Math.max(0, lotArea - cover - drivewayArea) : null;
  const verdict = st.state === 'inside' ? 'met' : st.state === 'outside' ? 'not-met' : 'unknown';
  const lines = [];
  if (verdict === 'met') lines.push('The home sits inside the setbacks on every boundary.');
  else if (verdict === 'not-met') lines.push(`${st.text} Move or turn the home, or try another design.`);
  else lines.push(st.text);
  lines.push(`The home covers about ${Math.round(cover)} m2 of the ${Math.round(lotArea)} m2 lot (${lotArea ? Math.round((cover / lotArea) * 100) : 0} percent).`);
  if (open != null) lines.push(`About ${Math.round(open)} m2 of open space is left (${Math.round((open / lotArea) * 100)} percent), after the home and the driveway.`);
  if (garage.has) lines.push(dw?.ok && dw.routed ? 'The garage faces away from the street, so the driveway runs round the house to the frontage.' : garage.facesStreet ? `The garage faces the street${garage.distanceM != null ? `, about ${garage.distanceM.toFixed(1)} m back from the boundary` : ''}.` : 'The garage door does not face the street, so there is no driveway to the frontage yet.');
  if (driveway.state === 'ok') lines.push(`The driveway runs about ${driveway.lengthM.toFixed(1)} m to the street.`);
  if (lot.setbacksDefault) lines.push('Council setbacks could not be loaded for this lot, so a standard indicative envelope was used.');
  lines.push(INDICATIVE);
  return {
    ok: true, verdict, rows, hasSetbacks: c.hasSetbacks, lotAreaM2: lotArea, coverageM2: cover, coveragePct: lotArea ? (cover / lotArea) * 100 : null,
    openSpaceM2: open, openSpacePct: open != null && lotArea ? (open / lotArea) * 100 : null, garage, driveway, status: setbackStatusLine(project), lines,
  };
}

/** True when the placed house faces the street (garage door to a street edge, or no garage at all) and sits inside the setbacks. */
export function placedWell(project) {
  const st = placementStatus(project);
  const door = garageDoor(project);
  return st.state !== 'outside' && (!door || garageStreetEdge(project) != null);
}

export { buildingHull };
