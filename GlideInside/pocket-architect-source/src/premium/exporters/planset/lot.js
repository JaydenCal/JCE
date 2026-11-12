// Prepares the project and lot for the plan set: accepts the lot the viewer holds (project.site.lot, plan millimetres, y down) or a plain
// metre lot, puts the house on it, and derives the numbers the sheets quote. Pure, Node compatible.

import * as G from '../../../model/geometry.js';
import { footprint, houseCentre, translateHouse, rotateHouse, envelopeOf, lotOf } from '../../../model/placement.js';
import { deriveFrontage, isCorner } from '../../../site/frontage.js';
import { autoPose } from '../../../portal/auto-place.js';
import { placeHouse } from '../../../portal/place-house.js';
import { faceGarageAngle } from '../../../site/lotplan.js';
import { levelsSorted } from '../shared.js';

/**
 * @typedef {Object} PlanSetLot
 * The lot as the viewer holds it. Either the schema 2 `site.lot` (preferred, used as is) or the metre form below.
 *
 * Schema 2 form (src/site/model.js): { boundary: [{x, y}] plan mm with y down and plan up = grid north, holes, neighbours: [{ lotNumber,
 *   planLabel, isRoad, ring }], roads, frontEdges: [edge index], setbacks: { front, side, rear, secondaryFront } (metres or { minM }),
 *   envelope: [{x, y}] | null, lotNumber, planLabel, lotLabel, address, areaM2, lga, zoning, state, proposed }.
 *
 * Metre form: the same names, but `boundaryM: [{x, y}]` (or [[x, y]]) in metres with x east and y NORTH, and optional
 *   `neighbours[].ringM`. Extras: `frontEdge` (index of the street edge; default the southern most edge), `lot` / `lotNumber`,
 *   `dp` / `plan` / `planLabel` (DP 123456, or QLD "RP 12345"), `council`, `northDeg` (degrees clockwise from plan up to true north),
 *   `roadName`, `setbacks: { front, side, rear }` in metres.
 *
 * Both forms: `house: { x, y, rotation }` places the project's house: x, y is the centre of the footprint (plan mm for the schema 2
 *   form, metres east and north for the metre form) and rotation is degrees clockwise on the plan. Without `house` the house is used where
 *   the project has it when that is on the lot, otherwise it is centred, turned to face the street and pushed to the front of the envelope.
 *   `lotId` (or lot number plus plan) feeds the drawing numbers: GI-<short id>-C000.
 */

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const ptOf = (p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y });
const fromM = (p) => { const q = ptOf(p); return { x: Math.round(q.x * 1000), y: Math.round(-q.y * 1000) }; };

/** The lot in schema 2 form (plan mm) from either input form. Returns null when there is no usable boundary. */
export function toSiteLot(l) {
  if (!l) return null;
  const metres = Array.isArray(l.boundaryM) && l.boundaryM.length >= 3;
  const mm = Array.isArray(l.boundary) && l.boundary.length >= 3;
  if (!metres && !mm) return null;
  const out = { ...l };
  if (metres) {
    out.boundary = l.boundaryM.map(fromM);
    delete out.boundaryM;
    out.neighbours = (l.neighbours || []).map((n, i) => ({ id: n.id || `n_${i}`, ...n, ring: n.ringM ? n.ringM.map(fromM) : n.ring || [] }));
    if (l.envelopeM) out.envelope = l.envelopeM.map(fromM);
    if (l.roads) out.roads = l.roads.map((r) => ({ name: r.name || '', pts: r.ptsM ? r.ptsM.flatMap((p) => { const q = fromM(p); return [q.x, q.y]; }) : r.pts }));
  } else {
    out.boundary = l.boundary.map(ptOf);
  }
  out.planLabel = out.planLabel || l.dp || l.plan || '';
  out.lotNumber = out.lotNumber ?? l.lot ?? '';
  if (!out.lotLabel && out.lotNumber) out.lotLabel = `Lot ${out.lotNumber}${out.planLabel ? ` ${out.planLabel}` : ''}`;
  out.address = out.address || '';
  out.lga = out.lga || l.council || '';
  const area = G.polygonArea(out.boundary) / 1e6;
  if (!num(out.areaM2)) out.areaM2 = Math.round(area * 10) / 10;
  if (out.setbacks && !out.setbacks.edgeKinds) {
    const s = out.setbacks;
    out.setbacks = { ...s, front: s.front ?? null, side: s.side ?? null, rear: s.rear ?? null };
  }
  if (!Array.isArray(out.frontEdges) || !out.frontEdges.length) {
    if (Number.isInteger(l.frontEdge)) out.frontEdges = [l.frontEdge];
    else if (out.neighbours?.some((n) => n.isRoad) || out.roads?.length) out.frontEdges = deriveFrontage(out).frontEdges;
    else {
      // The southern most edge (largest y on the plan) is the street edge.
      let best = 0;
      let by = -Infinity;
      out.boundary.forEach((p, i) => { const q = out.boundary[(i + 1) % out.boundary.length]; const y = (p.y + q.y) / 2; if (y > by) { by = y; best = i; } });
      out.frontEdges = [best];
    }
  }
  out.cornerLot = isCorner(out, out.frontEdges);
  return out;
}

/** The ground level: lowest elevation. */
export const groundLevel = (project) => levelsSorted(project)[0] || null;

/** Room groups for the area totals (m2): living is every indoor room except the garage, alfresco is any roofed outdoor room. */
export function areaTotals(project) {
  let living = 0;
  let garage = 0;
  let alfresco = 0;
  for (const l of project.levels || []) {
    for (const r of l.rooms || []) {
      if (r.status === 'demolish' || !Array.isArray(r.polygon) || r.polygon.length < 3) continue;
      const a = G.polygonArea(r.polygon) / 1e6;
      if (r.outdoor) { if (r.roofed) alfresco += a; } else if (r.type === 'garage') garage += a;
      else living += a;
    }
  }
  return { living, garage, alfresco, total: living + garage + alfresco };
}

/** Footprint of the ground level in m2 (indoor and roofed rooms), for site coverage. */
export function groundFootprintM2(project) {
  const l = groundLevel(project);
  let a = 0;
  for (const r of l?.rooms || []) if (r.status !== 'demolish' && (!r.outdoor || r.roofed) && r.polygon?.length >= 3) a += G.polygonArea(r.polygon) / 1e6;
  return a;
}

/**
 * Working copy of the project with the lot written to project.site.lot and the house placed. Returns { project, lot, placed }.
 * The caller's project is never changed.
 */
export function prepare(project, lotIn) {
  const p = structuredClone(project);
  p.site = { ...(p.site || {}) };
  const given = toSiteLot(lotIn);
  const lot = given || (lotOf(p) ? p.site.lot : null);
  const out = { project: p, lot: null, placed: 'none' };
  if (!lot) return out;
  p.site.lot = lot;
  if (num(lotIn?.northDeg)) p.site.northDeg = lotIn.northDeg;
  const hasHouse = !!footprint(p);
  if (!hasHouse) { out.lot = lot; return out; }
  const metres = !!(lotIn && Array.isArray(lotIn.boundaryM));
  const pose = lotIn?.house;
  if (pose && num(pose.x) && num(pose.y)) {
    if (num(pose.rotation) && pose.rotation) rotateHouse(p, pose.rotation, houseCentre(p));
    const c = houseCentre(p);
    const tgt = metres ? fromM(pose) : { x: pose.x, y: pose.y };
    translateHouse(p, tgt.x - c.x, tgt.y - c.y);
    out.placed = 'pose';
  } else {
    const c0 = houseCentre(p);
    const fp = footprint(p);
    const inside = fp.points.every((q) => G.pointInPolygon(q, lot.boundary));
    if (inside && G.pointInPolygon(c0, lot.boundary)) out.placed = 'project';
    else {
      // The portal's first placement (garage to the street, centred on the frontage, behind the front setback). It works from the
      // envelope polygon, so it stays quick on a 300 x 420 m block where a grid search would not.
      let done = false;
      try {
        const scratch = structuredClone(p);
        scratch.levels = [];
        scratch.site = { ...scratch.site, tanks: [] };
        const r = autoPose(scratch, p);
        if (r?.pose) {
          placeHouse(scratch, p, r.pose);
          p.levels = scratch.levels;
          done = true;
        }
      } catch {
        done = false;
      }
      if (!done) {
        const cen = G.polygonCentroid(lot.boundary);
        translateHouse(p, cen.x - c0.x, cen.y - c0.y);
        const turn = faceGarageAngle(p);
        if (turn) rotateHouse(p, turn, houseCentre(p));
      }
      out.placed = 'auto';
    }
  }
  out.lot = lot;
  return out;
}

/** Envelope polygon (plan mm) or null. */
export function envelopePoly(lot) {
  try {
    const e = envelopeOf(lot);
    return e.polygon && e.polygon.length >= 3 ? e.polygon : null;
  } catch {
    return null;
  }
}
