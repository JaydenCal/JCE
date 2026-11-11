// Street frontage of a lot, derived from the cadastre and then confirmed by the person (needed for setbacks: corner and battle-axe lots
// cannot be told from the boundary alone). Plan millimetres, y down. Pure functions, no DOM.
//
// Rules, in order
//   1. An edge is FRONT when most of the ground just outside it is not another lot (cadastre lots do not include the road),
//      or is a neighbour flagged as a road parcel (isRoad, set by the server from the parcel type).
//   2. When road centrelines are known (NSW road layer, best effort) and at least one edge runs within ROAD_TOL_MM of one for at least
//      half its length, only those edges are kept. This drops rear boundaries on reserves and creeks.
//   3. If nothing qualifies the longest edge is suggested, so the person always starts from something.
// lot.frontEdges are indices into lot.boundary: edge i runs from boundary[i] to boundary[i + 1] (the ring closes).

import { pointInRing, ringEdges } from './geo.js';

export const ROAD_TOL_MM = 15000;
const PROBE_MM = 600; // how far outside the edge the test points sit
const STEP_MM = 1000;

const toPts = (ring) => ring.map((p) => [p.x, p.y]);

function outsideSign(ring) {
  // Sign that makes the left normal of travel point outside: for a clockwise ring in y-up terms this differs, so test it.
  const r = toPts(ring);
  const e = ringEdges(r)[0];
  const dx = (e.b[0] - e.a[0]) / e.length;
  const dy = (e.b[1] - e.a[1]) / e.length;
  const test = [e.mid[0] - dy * 50, e.mid[1] + dx * 50];
  return pointInRing(test, r) ? -1 : 1;
}

function distToPolyline(p, pts) {
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i];
    const ay = pts[i + 1];
    const bx = pts[i + 2];
    const by = pts[i + 3];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy)));
  }
  return best;
}

// Per edge facts: length (mm), fraction of the outside that is another lot, fraction that is a road parcel, fraction near a road centreline.
export function edgeFacts(lot) {
  const ring = lot.boundary;
  const sign = outsideSign(ring);
  const lots = (lot.neighbours || []).filter((n) => !n.isRoad).map((n) => toPts(n.ring));
  const roadParcels = (lot.neighbours || []).filter((n) => n.isRoad).map((n) => toPts(n.ring));
  const lines = lot.roads || [];
  return ringEdges(toPts(ring)).map((e, index) => {
    const dx = (e.b[0] - e.a[0]) / e.length;
    const dy = (e.b[1] - e.a[1]) / e.length;
    const n = Math.max(1, Math.round(e.length / STEP_MM));
    let inLot = 0;
    let inRoadParcel = 0;
    let nearRoad = 0;
    for (let s = 0; s < n; s++) {
      const t = (s + 0.5) / n;
      const base = [e.a[0] + (e.b[0] - e.a[0]) * t, e.a[1] + (e.b[1] - e.a[1]) * t];
      const out = [base[0] - dy * PROBE_MM * sign, base[1] + dx * PROBE_MM * sign];
      if (roadParcels.some((r) => pointInRing(out, r))) inRoadParcel++;
      else if (lots.some((r) => pointInRing(out, r))) inLot++;
      if (lines.some((l) => distToPolyline(base, l.pts) <= ROAD_TOL_MM)) nearRoad++;
    }
    return { index, length: e.length, lot: inLot / n, roadParcel: inRoadParcel / n, nearRoad: nearRoad / n, dir: [dx, dy] };
  });
}

// Corner lot: two front edges that meet at a vertex with a clear change of direction (45 to 135 degrees).
export function isCorner(lot, front) {
  const k = lot.boundary.length;
  const set = new Set(front);
  const facts = edgeFacts(lot);
  for (const i of front) {
    const j = (i + 1) % k;
    if (!set.has(j)) continue;
    const a = facts[i].dir;
    const b = facts[j].dir;
    const ang = (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]))) * 180) / Math.PI;
    if (ang >= 45 && ang <= 135) return true;
  }
  return false;
}

/** deriveFrontage(lot) -> { frontEdges: number[], cornerLot: boolean, method: 'roads' | 'no-lot-beyond' | 'longest-edge' } */
export function deriveFrontage(lot) {
  if (!lot?.boundary || lot.boundary.length < 3) return { frontEdges: [], cornerLot: false, method: 'none' };
  const facts = edgeFacts(lot);
  let front = facts.filter((f) => f.roadParcel >= 0.5 || f.lot < 0.5).map((f) => f.index);
  let method = 'no-lot-beyond';
  const near = facts.filter((f) => f.nearRoad >= 0.5).map((f) => f.index);
  if (near.length) {
    const kept = front.filter((i) => near.includes(i));
    if (kept.length) {
      front = kept;
      method = 'roads';
    } else {
      front = near;
      method = 'roads';
    }
  }
  if (!front.length) {
    const longest = facts.reduce((a, b) => (b.length > a.length ? b : a));
    front = [longest.index];
    method = 'longest-edge';
  }
  front.sort((a, b) => a - b);
  return { frontEdges: front, cornerLot: isCorner(lot, front), method };
}

// Toggle one edge (the person's click). Returns the new sorted list.
export function toggleEdge(front, index) {
  const s = new Set(front);
  if (s.has(index)) s.delete(index);
  else s.add(index);
  return [...s].sort((a, b) => a - b);
}

// Index of the boundary edge nearest a plan point, or -1 when none is within tolMm.
export function nearestEdge(boundary, p, tolMm) {
  let best = -1;
  let bestD = tolMm;
  ringEdges(toPts(boundary)).forEach((e, i) => {
    const dx = e.b[0] - e.a[0];
    const dy = e.b[1] - e.a[1];
    const t = Math.max(0, Math.min(1, ((p.x - e.a[0]) * dx + (p.y - e.a[1]) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(p.x - (e.a[0] + t * dx), p.y - (e.a[1] + t * dy));
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}
