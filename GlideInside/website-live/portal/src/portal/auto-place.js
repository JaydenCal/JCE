// First placement of a library house on a lot, the way a builder does it: turn the house so the garage door faces the street
// frontage square on, centre it on the frontage with its front wall a little behind the front setback, and keep it inside the
// setback envelope. When that cannot be done (no garage, no setbacks, a lot too tight) the caller falls back to the fit ranking
// in fit.js. The person then fine tunes with the drag, the rotation ring, mirror and arrow keys.
//
//   const r = autoPose(project, house)    // project holds site.lot; house is a library design (project JSON)
//   r = { pose: { x, y, rotation, mirrored }, facing: true|false, fits: true|false|null, reason }

import * as G from '../model/geometry.js';
import { lotOf, envelopeOf, footprint, worstEncroachment, requiredFor, classifyEdges } from '../model/placement.js';
import { faceGarageAngle, buildingHull, garageDoor, inwardNormalOf } from '../site/lotplan.js';
import { placeHouse, houseBounds } from './place-house.js';

/** Distance (mm) the front wall sits behind the front setback line, so the house is not hard on it. */
export const FRONT_EASE_MM = 500;

function scratchProject(project) {
  const p = structuredClone(project);
  p.levels = [];
  p.site = { ...(p.site || {}), tanks: [] };
  return p;
}

const placed = (project, house, pose) => {
  const p = scratchProject(project);
  placeHouse(p, house, pose);
  return p;
};

const normDeg = (d) => {
  const v = (((d % 360) + 540) % 360) - 180; // -180 up to (not including) 180
  return v === -180 ? 180 : v;
};

/**
 * Best pose for the garage facing the street. Tries the house as drawn, then mirrored. Returns the first that fits the envelope,
 * or the first one that faces the street when none fits (fits false). Returns { pose: null, reason } when it cannot be decided.
 */
export function autoPose(project, house) {
  const lot = lotOf(project);
  if (!lot) return { pose: null, facing: false, fits: null, reason: 'no_lot' };
  const b = houseBounds(house);
  const centre = lot.boundary.length ? G.polygonCentroid(lot.boundary) : { x: 0, y: 0 };
  const edges = classifyEdges(lot);
  const front = edges.find((e) => e.kind === 'front');
  if (!front) return { pose: null, facing: false, fits: null, reason: 'no_frontage' };
  const hasGarage = !!garageDoor(placed(project, house, { x: 0, y: 0, rotation: 0 }));
  const env = envelopeOf(lot);
  const envPoly = env.polygon && env.polygon.length >= 3 ? env.polygon : null;
  const frontReq = requiredFor('front', lot.setbacks);
  const tried = [];
  for (const mirrored of [false, true]) {
    const base = { x: 0, y: 0, rotation: 0, mirrored };
    const at0 = placed(project, house, base);
    let angle = hasGarage ? faceGarageAngle(at0) : null;
    if (angle == null) angle = 0;
    const pose0 = { ...base, rotation: normDeg(angle) };
    const trial = placed(project, house, pose0);
    const hull = buildingHull(trial);
    if (hull.length < 3) continue;
    const n = inwardNormalOf(lot, front.index);
    const u = G.norm(G.sub(front.b, front.a));
    const mid = G.lerp(front.a, front.b, 0.5);
    const hc = G.polygonCentroid(hull);
    // Depth: the front most hull point (smallest distance in from the front boundary) sits at the setback plus a little.
    const depthIn = Math.min(...hull.map((p) => G.dot(G.sub(p, front.a), n)));
    const wantDepth = frontReq != null ? frontReq * 1000 + FRONT_EASE_MM : G.dot(G.sub(centre, front.a), n) - (Math.max(...hull.map((p) => G.dot(G.sub(p, front.a), n))) - depthIn) / 2;
    const acrossNow = G.dot(G.sub(hc, mid), u);
    const candidates = [];
    const step = 250;
    for (let k = 0; k <= 60; k++) {
      const off = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * step; // 0, +250, -250, +500 ...
      candidates.push(off);
    }
    let pick = null;
    let bestScore = Infinity;
    for (const off of candidates) {
      const dx = G.dot(G.sub(mid, hc), u) + off;
      const move = G.add(G.mul(u, dx), G.mul(n, wantDepth - depthIn));
      const pose = { ...pose0, x: Math.round(move.x), y: Math.round(move.y) };
      const moved = hull.map((p) => ({ x: p.x + move.x, y: p.y + move.y }));
      let fitsEnv = null;
      if (envPoly) {
        // Solids matter for an L shaped envelope; the hull is the safe measure here.
        fitsEnv = worstEncroachment(moved, [], envPoly) <= 5;
      }
      if (fitsEnv === true) { pick = { pose, fits: true }; break; }
      // Nothing fits (yet): keep the house inside the lot boundary where possible, then as far inside the setbacks as it can be.
      const overBoundary = lot.boundary.length >= 3 ? worstEncroachment(moved, [], lot.boundary) : 0;
      const overEnv = envPoly ? worstEncroachment(moved, [], envPoly) : 0;
      const score = Math.max(0, overBoundary) * 100 + Math.max(0, overEnv);
      if (score < bestScore) { bestScore = score; pick = { pose, fits: envPoly ? false : null }; }
    }
    void acrossNow;
    if (!pick) continue;
    tried.push({ ...pick, mirrored, facing: hasGarage });
    if (pick.fits !== false) break;
  }
  if (!tried.length) return { pose: null, facing: false, fits: null, reason: 'no_footprint' };
  const best = tried.find((t) => t.fits === true) || tried[0];
  if (best.fits === false && envPoly) {
    // The garage to the street pose does not fit. Search every position and the four square turns, mirrored or not, for a pose that does.
    const found = searchFit(project, house, lot, envPoly, front, frontReq, hasGarage);
    if (found) return { pose: found.pose, facing: found.facing, fits: true, reason: '', size: { widthMm: b.width, depthMm: b.depth } };
    return { pose: best.pose, facing: best.facing, fits: false, tooBig: true, reason: 'too_big', size: { widthMm: b.width, depthMm: b.depth } };
  }
  return { pose: best.pose, facing: best.facing, fits: best.fits, reason: best.fits === false ? 'does_not_fit_envelope' : '', size: { widthMm: b.width, depthMm: b.depth } };
}

const SEARCH_STEP_MM = 500;

/**
 * Exhaustive fallback for autoPose: every turn that is square to the front edge (and the garage facing turn), mirrored or not, and every
 * position on a 500 mm grid over the envelope. Returns the pose that fits the envelope nearest the front and the middle of the frontage,
 * preferring a garage that faces the street, or null when the house cannot fit at all (too big for this block).
 */
export function searchFit(project, house, lot, envPoly, front, frontReq, hasGarage) {
  const n = inwardNormalOf(lot, front.index);
  const u = G.norm(G.sub(front.b, front.a));
  const mid = G.lerp(front.a, front.b, 0.5);
  const eb = G.bbox(envPoly);
  const frontAngle = (Math.atan2(u.y, u.x) * 180) / Math.PI;
  let best = null;
  for (const mirrored of [false, true]) {
    const at0 = placed(project, house, { x: 0, y: 0, rotation: 0, mirrored });
    const face = hasGarage ? faceGarageAngle(at0) : null;
    const turns = [...(face != null ? [face, face + 90, face + 180, face + 270] : [0, 90, 180, 270]), frontAngle, frontAngle + 90].map(normDeg);
    for (const [ti, rotation] of turns.entries()) {
      const hull = buildingHull(placed(project, house, { x: 0, y: 0, rotation, mirrored }));
      if (hull.length < 3) continue;
      const hb = G.bbox(hull);
      if (hb.maxX - hb.minX > eb.maxX - eb.minX + 1 || hb.maxY - hb.minY > eb.maxY - eb.minY + 1) continue;
      for (let y = eb.minY - hb.minY; y <= eb.maxY - hb.maxY + 1; y += SEARCH_STEP_MM) {
        for (let x = eb.minX - hb.minX; x <= eb.maxX - hb.maxX + 1; x += SEARCH_STEP_MM) {
          const moved = hull.map((p) => ({ x: p.x + x, y: p.y + y }));
          if (worstEncroachment(moved, [], envPoly) > 5) continue;
          const hc = G.polygonCentroid(moved);
          const depth = G.dot(G.sub(hc, front.a), n);
          const across = Math.abs(G.dot(G.sub(hc, mid), u));
          const faces = face != null && ti < 4 && ti === 0 ? 0 : face != null ? 1 : 0;
          const score = faces * 1e6 + (mirrored ? 5e4 : 0) + ti * 1e5 + Math.abs(depth - ((frontReq || 0) * 1000 + 4000)) * 0.5 + across;
          if (!best || score < best.score) best = { score, pose: { x: Math.round(x), y: Math.round(y), rotation, mirrored }, facing: faces === 0 && face != null };
        }
      }
    }
  }
  return best;
}

/** The footprint points of a placed design, for callers that want to check it themselves. */
export const footprintAt = (project, house, pose) => footprint(placed(project, house, pose));
