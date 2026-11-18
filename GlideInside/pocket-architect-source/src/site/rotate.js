// The Rotate tool's maths, with no DOM: what is being turned (the house, a commercial building or a unit row), the pivot, angle snapping and
// typed angles, the two align buttons (street frontage, nearest boundary) and the rotation itself. Every function that changes a project
// mutates the one it is given, so the caller wraps it in store.apply for one undo step.
//
// Angles are degrees, clockwise on screen (plan y points down), the same sense as rotateHouse in src/model/placement.js.
// The driveway follows the house: the stored driveway's PIs (see drivepi.js) turn about the same pivot, and settleSiteItems then keeps the
// driveway only if it still works for the new position, otherwise the automatic route takes over. Either way it starts at the garage door.

import * as G from '../model/geometry.js';
import { lotOf, rotateHouse, classifyEdges, footprint } from '../model/placement.js';
import { settleSiteItems } from './site-items.js';
import { buildingHull, orientedBox, storedDriveway, setStoredDriveway, faceGarageAngle, roadReserve } from './lotplan.js';
import { buildingsOf } from '../commercial/catalogue/buildings.js';
import { buildingHandle } from '../commercial/catalogue/draw2d.js';
import { rowPoly } from '../commercial/layout.js';
import { regenerate, isCommercial } from '../commercial/mode.js';

export const SNAP_STEP = 15;
const RING_MARGIN_MM = 1500;

/** Wrap to (-180, 180]. */
export const wrap180 = (deg) => { const d = ((((deg + 180) % 360) + 360) % 360) - 180; return d === -180 ? 180 : d; };
/** Wrap to [0, 360). */
export const wrap360 = (deg) => ((deg % 360) + 360) % 360;
const r1 = (d) => Math.round(d * 10) / 10;

/** Angle snap: free to 0.1 degree by default, 15 degree steps with Shift (the same as the Move house ring). */
export function snapTurn(deg, shift = false) {
  return shift ? Math.round(deg / SNAP_STEP) * SNAP_STEP || 0 : r1(deg) || 0;
}

/**
 * A typed angle in degrees: "37.5", "-12", "12 deg", "45°", a comma as the decimal mark. Returns the angle wrapped to (-180, 180], or null when it is not a number.
 * Positive turns clockwise. 360 and its multiples are a full turn, i.e. 0.
 */
export function parseAngle(text) {
  if (typeof text === 'number') return Number.isFinite(text) ? r1(wrap180(text)) || 0 : null;
  const s = String(text ?? '').trim().replace(',', '.').replace(/(°|degrees?|deg)\s*$/i, '').trim();
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? r1(wrap180(n)) || 0 : null;
}

// What is being turned -------------------------------------------------------------------------------------------------------------
const rowSource = (c, id) => { const r = c.rows.find((x) => x.id === id); return r?.mirrorOf && c.rows.some((x) => x.id === r.mirrorOf) ? r.mirrorOf : id; };

/**
 * The thing the Rotate tool turns: { kind: 'house' | 'building' | 'row', id, label, centre, ring[] (outline, plan mm), orientDeg }.
 * Residential: the house. Commercial: the selected building (ui.commercialBuilding) or unit row (ui.commercialRow), else null.
 * centre is the default pivot.
 */
export function rotateTarget(project, ui = {}) {
  if (isCommercial(project) && project.commercial) {
    const c = project.commercial;
    if (ui.commercialBuilding) {
      const b = buildingsOf(c).find((x) => x.id === ui.commercialBuilding);
      if (b) return { kind: 'building', id: b.id, label: `Building ${b.n}, ${b.label}`, centre: buildingHandle(b).centre, ring: b.outline, orientDeg: b.place.rotationDeg };
    }
    if (ui.commercialRow) {
      const id = rowSource(c, ui.commercialRow);
      const row = c.rows.find((x) => x.id === id);
      if (row) {
        const ring = rowPoly(row, c.rows);
        return { kind: 'row', id, label: 'Unit row', centre: G.polygonCentroid(ring), ring, orientDeg: row.rotationDeg || 0 };
      }
    }
    return null;
  }
  if (!footprint(project)) return null;
  const hull = buildingHull(project);
  const box = orientedBox(hull);
  if (!box) return null;
  return { kind: 'house', id: 'house', label: 'House', centre: box.centre, ring: hull, orientDeg: box.angleDeg };
}

/** Radius of the turning ring about a pivot: out to the furthest corner of the building plus a margin. */
export const ringRadius = (target, pivot) => Math.max(...target.ring.map((p) => G.dist(p, pivot))) + RING_MARGIN_MM;

// Turning ---------------------------------------------------------------------------------------------------------------------------
/** Turn the stored driveway edit (project.site.driveway PIs) about the pivot, so it keeps its shape against the house. The kerb end stays. */
function turnStoredDriveway(project, deg, pivot) {
  const d = storedDriveway(project);
  if (!d) return;
  setStoredDriveway(project, { ...d, pis: d.pis.map((q) => G.rotatePoint(q, pivot, deg)) });
}

/**
 * Turn the target by deg about the pivot on `project` (mutates). Returns { driveRerouted, tanksMoved } for a house.
 * House: walls, rooms, furniture and tanks (rotateHouse), the stored driveway PIs, then settleSiteItems. Building and row: their placement.
 */
export function turnTarget(project, target, deg, pivot = target.centre) {
  if (!Number.isFinite(deg) || !target) return {};
  if (target.kind === 'house') {
    rotateHouse(project, deg, pivot);
    turnStoredDriveway(project, deg, pivot);
    const res = settleSiteItems(project, { quiet: true });
    return { driveRerouted: res.drivewayRerouted, tanksMoved: res.tanksMoved };
  }
  const c = project.commercial;
  if (!c) return {};
  if (target.kind === 'building') {
    const b = c.buildings.find((x) => x.id === target.id);
    if (b) {
      const o = G.rotatePoint({ x: Number(b.place?.x) || 0, y: Number(b.place?.y) || 0 }, pivot, deg);
      b.place = { x: Math.round(o.x), y: Math.round(o.y), rotationDeg: r1(wrap360((Number(b.place?.rotationDeg) || 0) + deg)) };
    }
  } else {
    const r = c.rows.find((x) => x.id === target.id);
    if (r) {
      const o = G.rotatePoint({ x: r.x, y: r.y }, pivot, deg);
      r.x = Math.round(o.x);
      r.y = Math.round(o.y);
      r.rotationDeg = r1(wrap360((r.rotationDeg || 0) + deg));
    }
  }
  regenerate(project);
  return {};
}

// Align -----------------------------------------------------------------------------------------------------------------------------
const dirDeg = (a, b) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
/** Smallest turn (-45, 45] that makes an axis at `from` parallel to or square with one at `to`. */
const toSquare = (to, from) => { const d = ((((to - from + 45) % 90) + 90) % 90) - 45; return d === -45 ? 45 : d; };

/** The primary frontage edge index of the lot (the street edge the building should face), or -1. */
export function frontEdgeIndex(lot) {
  const edges = classifyEdges(lot);
  let i = edges.findIndex((e) => e.kind === 'front');
  if (i < 0) i = edges.findIndex((e) => e.kind === 'secondaryFront');
  return i;
}

/** Index of the boundary edge nearest the building outline, or -1. */
export function nearestEdgeIndex(lot, ring) {
  let best = -1;
  let bd = Infinity;
  lot.boundary.forEach((a, i) => {
    const b = lot.boundary[(i + 1) % lot.boundary.length];
    let d = Infinity;
    for (const p of ring) d = Math.min(d, G.projectToSegment(p, a, b).d);
    if (d < bd - 1e-6) { bd = d; best = i; }
  });
  return best;
}

/**
 * The turn (degrees, rounded to 0.1) that lines the target up with a boundary edge, or null when it cannot be worked out.
 * which: 'frontage' | 'nearest'. A house with a garage door turns to face the street square on; a catalogue building turns its front to the
 * street; anything else (and the nearest boundary) turns the least needed to run parallel to the edge.
 */
export function alignAngle(project, target, which = 'frontage') {
  const lot = lotOf(project);
  if (!lot || !target) return null;
  const idx = which === 'nearest' ? nearestEdgeIndex(lot, target.ring) : frontEdgeIndex(lot);
  if (idx < 0) return null;
  const a = lot.boundary[idx];
  const b = lot.boundary[(idx + 1) % lot.boundary.length];
  const edgeDeg = dirDeg(a, b);
  if (which === 'frontage') {
    if (target.kind === 'house') {
      const faced = faceGarageAngle(project, { edge: idx });
      if (faced != null && roadReserve(lot).some((r) => r.edge === idx)) return r1(faced) || 0;
    }
    if (target.kind === 'building') {
      // The front of a building looks along its local -y, at orientDeg - 90. Turn it to look out of the street edge.
      const r = roadReserve(lot).find((x) => x.edge === idx);
      if (r) return r1(wrap180(dirDeg({ x: 0, y: 0 }, r.outward) - (target.orientDeg - 90))) || 0;
    }
  }
  return r1(toSquare(edgeDeg, target.orientDeg)) || 0;
}
