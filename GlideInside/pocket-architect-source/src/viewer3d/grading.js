// Automatic grading for the 3D ground. Pure functions, no DOM, plan mm in and metres out.
//   * Building pads stay flat at the floor level (see terrain.js: padHeight).
//   * Car parks, hardstand and driveways each get a design surface: a best fit plane through the natural ground, clamped to a gentle fall
//     (1 to 5 percent for paving, up to 10 percent for a house driveway) and anchored at the building pad level where it meets the pad.
//   * The terrain mesh is flattened to that plane under the footprint (plus a small margin) and runs out in a short 1 in 3 batter to the
//     natural ground, so no terrain or aerial shows through paving and the paving never drapes over bumps.
import * as G from '../model/geometry.js';
import * as S from './site-geom.js';
import { DESIGN } from './grade-limits.js';
import { createFDS, polyDistM, REACH_M } from './fds.js';
import { KERB_UP, KERB_WIDTH, VERGE_RISE, TRANSITION_WING_M } from './levels.js';

export const FALL_MIN = DESIGN.pavingFallMin; // flattest design fall for paving (1 percent)
export const FALL_MAX = DESIGN.pavingFallMax; // steepest design fall for paving (5 percent)
export const DRIVE_FALL_MAX = DESIGN.drivewayFallMax; // steepest design fall for a house driveway
const PROFILE_STEP_M = 12;
const bboxOf = (poly) => G.bbox(poly);

/** Least squares plane Y = c + gx (x - cx) + gz (z - cz) through samples { x, z, y } in metres. */
export function fitPlane(samples) {
  const n = samples.length;
  if (!n) return null;
  const cx = samples.reduce((s, q) => s + q.x, 0) / n;
  const cz = samples.reduce((s, q) => s + q.z, 0) / n;
  const cy = samples.reduce((s, q) => s + q.y, 0) / n;
  let sxx = 0; let sxz = 0; let szz = 0; let sxy = 0; let szy = 0;
  for (const q of samples) {
    const x = q.x - cx; const z = q.z - cz; const y = q.y - cy;
    sxx += x * x; sxz += x * z; szz += z * z; sxy += x * y; szy += z * y;
  }
  const det = sxx * szz - sxz * sxz;
  if (!(Math.abs(det) > 1e-6)) return { cx, cz, cy, gx: 0, gz: 0 };
  return { cx, cz, cy, gx: (sxy * szz - szy * sxz) / det, gz: (szy * sxx - sxy * sxz) / det };
}

/** Clamp a plane gradient to the design fall range. Near flat ground stays flat. */
export function clampFall(gx, gz, max = FALL_MAX, min = FALL_MIN) {
  const m = Math.hypot(gx, gz);
  if (m < 0.002) return { gx: 0, gz: 0 };
  const k = Math.min(max, Math.max(min, m)) / m;
  return { gx: gx * k, gz: gz * k };
}

function samplesIn(polys, rawAt, stepMm = 2000) {
  const out = [];
  for (const poly of polys) {
    const bb = bboxOf(poly);
    for (let x = bb.minX + stepMm / 2; x < bb.maxX; x += stepMm) {
      for (let y = bb.minY + stepMm / 2; y < bb.maxY; y += stepMm) {
        if (G.pointInPolygon({ x, y }, poly)) out.push({ x: x / 1000, z: y / 1000, y: rawAt(x, y) });
      }
    }
    if (out.length > 4000) break;
  }
  return out;
}

/**
 * planGrading({ rawAt, padY, fp, paving: [poly], driveways: [{ polys, from }] }) -> { zones, heightAt(x, y, raw) } | null
 * rawAt(x, y) is the natural ground in metres (the same Y scale as padY); fp is the building pad bbox (plan mm) or null.
 */
export const ROAD_GRADE_MAX = DESIGN.roadGradeMax; // steepest longitudinal grade of the graded road corridor
export const CROSSFALL_MIN = 0.01; // the corridor falls across the road by 1 to 3 percent, never rising towards the far side
export const CROSSFALL_MAX = 0.03;

/**
 * A road corridor as a design plane: a smooth (straight) longitudinal profile along the road, flat across it with a small crossfall that falls
 * from the property side to the far kerb. One plane, so the mesh triangles lie exactly on it and the road strips draped on the mesh never sit
 * below the ground. corridor = { poly: plan mm quad (near footpath to far kerb), u: unit along the road, outward: unit away from the lot }.
 */
export function corridorPlane(corridor, rawAt) {
  const smp = samplesIn([corridor.poly], rawAt, 2000);
  const fit = fitPlane(smp);
  if (!fit) return null;
  const { u, outward } = corridor;
  const gu = Math.max(-ROAD_GRADE_MAX, Math.min(ROAD_GRADE_MAX, fit.gx * u.x + fit.gz * u.y));
  const gc = fit.gx * outward.x + fit.gz * outward.y; // natural fall across the road (negative falls away from the lot)
  const cross = -Math.max(CROSSFALL_MIN, Math.min(CROSSFALL_MAX, gc < 0 ? -gc : CROSSFALL_MIN));
  return { cx: fit.cx, cz: fit.cz, cy: fit.cy, gx: u.x * gu + outward.x * cross, gz: u.y * gu + outward.y * cross, grade: gu, crossfall: cross };
}

/** Cluster polygons whose boxes touch (within gapMm) so each connected paved area gets its own design plane. Sort and sweep, not O(n^2). */
export function clusterPolys(polys, gapMm = 1500) {
  const items = polys.map((poly, i) => ({ poly, bb: bboxOf(poly), i })).sort((p, q) => p.bb.minX - q.bb.minX);
  const parent = items.map((_, k) => k);
  const find = (k) => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
  for (let a = 0; a < items.length; a++) {
    for (let c = a + 1; c < items.length && items[c].bb.minX <= items[a].bb.maxX + gapMm; c++) {
      const A = items[a].bb; const B = items[c].bb;
      if (B.minY <= A.maxY + gapMm && A.minY <= B.maxY + gapMm) parent[find(c)] = find(a);
    }
  }
  const groups = new Map();
  items.forEach((it, k) => { const r = find(k); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(it.poly); });
  return [...groups.values()];
}

/**
 * A road corridor with a smooth longitudinal profile: the natural centre line ground is sampled every PROFILE_STEP_M along the road, smoothed,
 * and limited to ROAD_GRADE_MAX between nodes, so a long street rolls gently instead of being one tilted plane. Across the road the surface is
 * flat with a 1 to 3 percent crossfall. Returns { level(xMm, yMm), grade } or null.
 */
export function corridorProfile(corridor, rawAt) {
  const { u, outward, poly } = corridor;
  const o = poly[0];
  const s = (q) => ((q.x - o.x) * u.x + (q.y - o.y) * u.y) / 1000;
  const t = (q) => ((q.x - o.x) * outward.x + (q.y - o.y) * outward.y) / 1000;
  const s0 = Math.min(...poly.map(s)); const s1 = Math.max(...poly.map(s));
  const t0 = Math.min(...poly.map(t)); const t1 = Math.max(...poly.map(t));
  if (!(s1 > s0) || !(t1 > t0)) return null;
  const n = Math.max(2, Math.ceil((s1 - s0) / PROFILE_STEP_M) + 1);
  const ds = (s1 - s0) / (n - 1);
  const at = (sv, tv) => rawAt(o.x + (u.x * sv + outward.x * tv) * 1000, o.y + (u.y * sv + outward.y * tv) * 1000);
  const tc = (t0 + t1) / 2;
  let h = Array.from({ length: n }, (_, k) => (at(s0 + k * ds, t0 + 0.2 * (t1 - t0)) + at(s0 + k * ds, tc) + at(s0 + k * ds, t1 - 0.2 * (t1 - t0))) / 3);
  for (let pass = 0; pass < 3; pass++) h = h.map((v, k) => (k === 0 || k === n - 1 ? v : (h[k - 1] + 2 * v + h[k + 1]) / 4));
  const lim = ROAD_GRADE_MAX * ds;
  for (let k = 1; k < n; k++) h[k] = Math.max(h[k - 1] - lim, Math.min(h[k - 1] + lim, h[k]));
  for (let k = n - 2; k >= 0; k--) h[k] = Math.max(h[k + 1] - lim, Math.min(h[k + 1] + lim, h[k]));
  // natural fall across the road, outward positive: the road falls from the property side to the far kerb
  const gc = (at(s0 + (s1 - s0) / 2, t1) - at(s0 + (s1 - s0) / 2, t0)) / (t1 - t0);
  const cross = -Math.max(CROSSFALL_MIN, Math.min(CROSSFALL_MAX, gc < 0 ? -gc : CROSSFALL_MIN));
  const level = (x, y) => {
    const q = { x, y };
    const sv = Math.min(s1, Math.max(s0, s(q)));
    const f = (sv - s0) / ds; const k = Math.min(n - 2, Math.floor(f)); const w = f - k;
    return h[k] * (1 - w) + h[k + 1] * w + cross * (t(q) - tc);
  };
  return { level, crossfall: cross, grade: Math.max(...h.slice(1).map((v, k) => Math.abs(v - h[k]) / ds)) };
}

/**
 * The existing road as a FIXED design element: a smooth longitudinal profile along the road (the natural ground sampled along the carriageway,
 * smoothed and limited to ROAD_GRADE_MAX), a 1 to 3 percent crossfall, and the verge cross section by offset t from the property line:
 *   carriageway (gutter to gutter) at the crossfall, flat gutter at the gutter invert, the kerb top KERB_UP above the invert, then the verge and
 *   footpath rising VERGE_RISE (2.5 percent) from the back of the kerb to the property line. Held at these levels: never counted as earthworks.
 * corridor = { poly (property line to far kerb, plan mm), u, outward, meta: { vergeM, gutterM, carriagewayM } }.
 */
export function roadElement(cr, rawAt, id = 'road') {
  const m = cr.meta;
  const { u, outward, poly } = cr;
  if (!m) {
    const pr = corridorProfile(cr, rawAt);
    return pr ? { id, kind: 'road', polys: [poly], level: pr.level, fall: pr.grade, road: true, crossfall: pr.crossfall } : null;
  }
  const o = poly[0];
  const sOf = (q) => ((q.x - o.x) * u.x + (q.y - o.y) * u.y) / 1000;
  const tOf = (q) => ((q.x - o.x) * outward.x + (q.y - o.y) * outward.y) / 1000;
  const s0 = Math.min(...poly.map(sOf)); const s1 = Math.max(...poly.map(sOf));
  if (!(s1 > s0)) return null;
  const tk = m.vergeM; const tg0 = tk + m.gutterM; const tg1 = tg0 + m.carriagewayM; const tfar = tg1 + m.gutterM; const tc = (tg0 + tg1) / 2; const tb = tk - KERB_WIDTH;
  const n = Math.max(2, Math.ceil((s1 - s0) / PROFILE_STEP_M) + 1);
  const ds = (s1 - s0) / (n - 1);
  const at = (sv, tv) => rawAt(o.x + (u.x * sv + outward.x * tv) * 1000, o.y + (u.y * sv + outward.y * tv) * 1000);
  const cw = m.carriagewayM;
  let h = Array.from({ length: n }, (_, k) => (at(s0 + k * ds, tg0 + 0.2 * cw) + at(s0 + k * ds, tc) + at(s0 + k * ds, tg1 - 0.2 * cw)) / 3);
  for (let pass = 0; pass < 3; pass++) h = h.map((v, k) => (k === 0 || k === n - 1 ? v : (h[k - 1] + 2 * v + h[k + 1]) / 4));
  const lim = ROAD_GRADE_MAX * ds;
  for (let k = 1; k < n; k++) h[k] = Math.max(h[k - 1] - lim, Math.min(h[k - 1] + lim, h[k]));
  for (let k = n - 2; k >= 0; k--) h[k] = Math.max(h[k + 1] - lim, Math.min(h[k + 1] + lim, h[k]));
  const sm = s0 + (s1 - s0) / 2;
  const gc = (at(sm, tg1) - at(sm, tg0)) / cw; // natural fall across the road, outward positive
  const cross = -Math.max(CROSSFALL_MIN, Math.min(CROSSFALL_MAX, gc < 0 ? -gc : CROSSFALL_MIN)); // the road falls from the property side to the far kerb
  const hAt = (sv) => { const sc = Math.min(s1, Math.max(s0, sv)); const f = (sc - s0) / ds; const k = Math.min(n - 2, Math.floor(f)); const w = f - k; return h[k] * (1 - w) + h[k + 1] * w; };
  const gutter0 = (sv) => hAt(sv) + cross * (tg0 - tc); // near gutter invert
  const verge0 = (sv) => gutter0(sv) + KERB_UP; // top of kerb, and the verge level at the back of the kerb
  const level = (x, y) => {
    const q = { x, y }; const sv = sOf(q); const t = tOf(q);
    if (t >= tg0) {
      if (t <= tg1) return hAt(sv) + cross * (t - tc); // carriageway
      const g1 = hAt(sv) + cross * (tg1 - tc);
      return g1; // far gutter, flat at its invert and carried on beyond the far kerb face (the kerb itself is a section standing on it)
    }
    const g0 = gutter0(sv);
    if (t >= tk) return g0; // near gutter strip
    if (t >= tb) return g0 + KERB_UP; // top of kerb
    return g0 + KERB_UP + VERGE_RISE * (tb - Math.max(0, t)); // verge and footpath: rises to the property line, flat beyond it
  };
  const frame = { o, u, outward, sOf, tOf, tk, tg0, tg1, tfar, tc, tb, cross, hAt, gutter0, verge0 };
  return { id, kind: 'road', polys: [poly], level, fall: Math.max(...h.slice(1).map((v, k) => Math.abs(v - h[k]) / ds)), road: true, crossfall: cross, frame };
}

/** A driveway crossover over the verge: a ramp from the gutter invert at the kerb line (the layback) to the verge level at the property line. */
function crossoverElement(road, poly, id) {
  const f = road.frame;
  const level = (x, y) => {
    const q = { x, y }; const sv = f.sOf(q); const t = f.tOf(q);
    const g0 = f.gutter0(sv); const lb = f.verge0(sv) + VERGE_RISE * f.tb;
    if (t >= f.tk) return g0;
    if (t <= 0) return lb;
    return g0 + (lb - g0) * ((f.tk - t) / f.tk);
  };
  return { id, kind: 'crossover', polys: [poly], level, fall: 0, T: TRANSITION_WING_M };
}

/** The unit outward normal (x, z) of the polygon edge nearest to q, pointing away from the polygon's inside. */
function outwardNormal(q, poly) {
  let best = Infinity; let n = { x: 0, z: 1 };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    const d = G.projectToSegment(q, a, b).d;
    if (d < best) {
      best = d;
      const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      n = { x: (b.y - a.y) / L, z: -(b.x - a.x) / L };
      const mid = { x: (a.x + b.x) / 2 + n.x * 50, y: (a.y + b.y) / 2 + n.z * 50 };
      if (G.pointInPolygon(mid, poly)) n = { x: -n.x, z: -n.z };
    }
  }
  return n;
}
const unit = (v) => { const l = Math.hypot(v.x, v.z) || 1; return { x: v.x / l, z: v.z / l }; };
const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

/**
 * A paving cluster as one design plane. Natural ground fixes the direction of fall; ties (the building pads it meets and the road it leaves by)
 * fix the level where they meet; the fall is limited to 1 to 5 percent and never rises away from a building face. Where the limits leave a
 * residual at a tie, the plane blends to the neighbour over the transition width (fds.js), so the residual is a ramp and never a step.
 */
function planeFor(ps, { rawAt, pads, roads, max }) {
  let area = 0;
  for (const p of ps) { const b = bboxOf(p); area += (b.maxX - b.minX) * (b.maxY - b.minY) / 1e6; }
  const smp = samplesIn(ps, rawAt, Math.max(2000, Math.sqrt(area / 1500) * 1000));
  const fit = fitPlane(smp);
  if (!fit) return null;
  // Tie points: where the cluster meets a pad or the road (samples along its edges within 1.5 m of it), else its nearest vertex within reach.
  const cb = ps.map(bboxOf).reduce((a, q) => ({ minX: Math.min(a.minX, q.minX), minY: Math.min(a.minY, q.minY), maxX: Math.max(a.maxX, q.maxX), maxY: Math.max(a.maxY, q.maxY) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const tiesWith = (target, maxFar) => {
    const gx = Math.max(target.bb.minX - cb.maxX, cb.minX - target.bb.maxX, 0); const gy = Math.max(target.bb.minY - cb.maxY, cb.minY - target.bb.maxY, 0);
    if (Math.hypot(gx, gy) / 1000 > maxFar) return [];
    const near = []; let best = null;
    for (const poly of ps) for (let i = 0; i < poly.length; i++) {
      const a = poly[i]; const b = poly[(i + 1) % poly.length];
      const L = Math.hypot(b.x - a.x, b.y - a.y); const n = Math.max(1, Math.ceil(L / 3000));
      for (let k = 0; k <= n; k++) {
        const q = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n };
        const r = polyDistM(q, target.poly, target.bb);
        if (r.d <= 1.5) near.push({ q, e: r.q, n: target.pad ? outwardNormal(q, target.poly) : null });
        if (!best || r.d < best.d) best = { d: r.d, q, e: r.q, n: target.pad ? outwardNormal(q, target.poly) : null };
      }
    }
    if (near.length) { const step = Math.max(1, Math.ceil(near.length / 10)); return near.filter((_, k) => k % step === 0); }
    return best && best.d <= maxFar ? [best] : [];
  };
  const ties = [];
  for (const pd of pads) for (const t of tiesWith({ ...pd, pad: true }, 12)) ties.push({ x: t.q.x / 1000, z: t.q.y / 1000, y: pd.y, w: 40, n: t.n, pad: true });
  for (const rd of roads) for (const t of tiesWith(rd, 6)) ties.push({ x: t.q.x / 1000, z: t.q.y / 1000, y: rd.level(t.q.x, t.q.y), w: 40, road: true });
  const wn = 1 / Math.max(1, smp.length);
  // weighted least squares of c + gx (x - cx) + gz (z - cz) through the natural samples (total weight 1) and the ties
  let g = { gx: fit.gx, gz: fit.gz };
  if (ties.length) {
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; const bv = [0, 0, 0];
    const add = (x, z, y, w) => {
      const f = [1, x - fit.cx, z - fit.cz];
      for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) A[i][j] += w * f[i] * f[j]; bv[i] += w * f[i] * y; }
    };
    for (const q of smp) add(q.x, q.z, q.y, wn);
    for (const t of ties) add(t.x, t.z, t.y, t.w);
    const det = det3(A);
    if (Math.abs(det) > 1e-9) {
      const repl = (col) => A.map((row, i) => row.map((x, j) => (j === col ? bv[i] : x)));
      g = { gx: det3(repl(1)) / det, gz: det3(repl(2)) / det };
    }
  }
  g = clampFall(g.gx, g.gz, max);
  // Residual at the ties (best level for a given fall): used to decide whether the fall can be kept off the building.
  const resid = (gg) => {
    let sw = 0; let sy = 0;
    for (const t of ties) { sw += t.w; sy += t.w * (t.y - (gg.gx * (t.x - fit.cx) + gg.gz * (t.z - fit.cz))); }
    const c0 = sw ? sy / sw : fit.cy; let e = 0;
    for (const t of ties) e += t.w * (t.y - (c0 + gg.gx * (t.x - fit.cx) + gg.gz * (t.z - fit.cz))) ** 2;
    return sw ? Math.sqrt(e / sw) : 0;
  };
  // Never fall towards a building face: remove any component that rises away from a pad (a flat plane satisfies every face). When that cannot
  // meet the road (the street is above the pad) the fall is kept and the plane is flagged: it drains towards the building, check with an engineer.
  const rises = (gg) => ties.some((t) => t.pad && gg.gx * t.n.x + gg.gz * t.n.z > 1e-9);
  let towardsBuilding = false;
  if (rises(g)) {
    let h = { ...g };
    for (let it = 0; it < 4 && rises(h); it++) for (const t of ties) { if (!t.pad) continue; const r = h.gx * t.n.x + h.gz * t.n.z; if (r > 0) h = { gx: h.gx - r * t.n.x, gz: h.gz - r * t.n.z }; }
    if (rises(h)) h = { gx: 0, gz: 0 };
    if (resid(h) <= resid(g) + 0.15) g = h; else towardsBuilding = true;
  }
  const m = Math.hypot(g.gx, g.gz);
  if (m > max) g = { gx: g.gx * max / m, gz: g.gz * max / m };
  // the level: through the ties in the least squares sense (the natural centre when there are none)
  let sw = 0; let sy = 0;
  for (const t of ties) { sw += t.w; sy += t.w * (t.y - (g.gx * (t.x - fit.cx) + g.gz * (t.z - fit.cz))); }
  const c = sw ? sy / sw : fit.cy;
  return { c, gx: g.gx, gz: g.gz, cx: fit.cx, cz: fit.cz, ties, towardsBuilding };
}

export const clipHalf = (poly, o, n) => {
  const side = (q) => (q.x - o.x) * n.x + (q.y - o.y) * n.y; // > 0 is on the road side
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    const sa = side(a); const sb = side(b);
    if (sa <= 0) out.push(a);
    if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) { const t = sa / (sa - sb); out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); }
  }
  return out;
};

/**
 * planGrading({ rawAt, padY, fp, pads, paving, driveways, corridors, crossovers, cellM }) -> { elements, zones, fds, heightAt(x, y, raw), band, pads } | null
 * rawAt(x, y) is the natural ground in metres (the same Y scale as padY). pads: building outlines, each a ring (level padY) or { id, poly, y }
 * with its own level; fp is the residential pad box (plan mm) when there are no pads. paving: rings. driveways: [{ polys, dir }]. corridors: the
 * existing road, see roadElement. crossovers: rings over the verge (a ramp from the layback to the verge level). cellM: terrain cell in metres.
 * Elements in priority order (the road and its crossovers are fixed): crossovers, roads, pads, then paving and driveways, solved to meet them.
 */
export function planGrading({ rawAt, padY, fp = null, pads = null, paving = [], driveways = [], corridors = [], crossovers = [], cellM = 0.75, lot = null, batterRun = 3 }) {
  const padSrc = pads && pads.length ? pads : fp ? [[{ x: fp.minX, y: fp.minY }, { x: fp.maxX, y: fp.minY }, { x: fp.maxX, y: fp.maxY }, { x: fp.minX, y: fp.maxY }]] : [];
  const padList = padSrc.map((q, i) => (Array.isArray(q) ? { id: `pad:${i}`, poly: q, y: padY } : { id: q.id || `pad:${i}`, poly: q.poly, y: Number.isFinite(q.y) ? q.y : padY }))
    .filter((q) => Array.isArray(q.poly) && q.poly.length >= 3).map((q) => ({ ...q, bb: bboxOf(q.poly) }));
  const roads = [];
  corridors.forEach((cr, i) => { const r = roadElement(cr, rawAt, `road:${i}`); if (r) { r.bb = bboxOf(cr.poly); r.poly = cr.poly; r.cr = cr; roads.push(r); } });
  const roadNear = (x, y, within = 6) => {
    let best = null;
    for (const r of roads) { const d = polyDistM({ x, y }, r.poly, r.bb).d; if (d <= within && (!best || d < best.d)) best = { d, lvl: r.level(x, y), road: r }; }
    return best;
  };
  const cross = [];
  crossovers.forEach((poly, i) => {
    if (!Array.isArray(poly) || poly.length < 3) return;
    const c = poly.reduce((a, q) => ({ x: a.x + q.x / poly.length, y: a.y + q.y / poly.length }), { x: 0, y: 0 });
    const road = roads.find((r) => r.frame && polyDistM(c, r.poly, r.bb).d === 0);
    if (road) cross.push(crossoverElement(road, poly, `crossover:${i}`));
  });
  const padEls = padList.map((q) => ({ id: q.id, kind: 'pad', pad: true, polys: [q.poly], level: () => q.y, y: q.y, fall: 0 }));
  const toLot = (poly) => { let q = poly; for (const r of roads) { if (q.length >= 3) q = clipHalf(q, r.cr.poly[0], r.cr.outward); } return q; };
  const roadTies = roads.map((r) => ({ poly: r.poly, bb: r.bb, level: r.level }));
  const padTies = padList.map((q) => ({ poly: q.poly, bb: q.bb, y: q.y }));
  const planes = [];
  const offRoad = paving.filter((p) => Array.isArray(p) && p.length >= 3).map(toLot).filter((q) => q.length >= 3 && G.polygonArea(q) > 1e5);
  let nPave = 0;
  if (offRoad.length) {
    for (const grp of clusterPolys(offRoad)) {
      const pl = planeFor(grp, { rawAt, pads: padTies, roads: roadTies, max: FALL_MAX });
      if (!pl) continue;
      planes.push({ id: `paving:${nPave++}`, kind: 'paving', polys: grp, level: (x, y) => pl.c + pl.gx * (x / 1000 - pl.cx) + pl.gz * (y / 1000 - pl.cz), fall: Math.hypot(pl.gx, pl.gz), ties: pl.ties.length, towardsBuilding: pl.towardsBuilding });
    }
  }
  let nDrive = 0;
  for (const d of driveways) {
    const cut = d.polys.filter((p) => Array.isArray(p) && p.length >= 3).map(toLot).filter((q) => q.length >= 3 && G.polygonArea(q) > 1e5);
    if (!cut.length) continue;
    const dir = d.dir;
    const along = (q) => (q.x - dir.o.x) / 1000 * dir.u.x + (q.y - dir.o.y) / 1000 * dir.u.y;
    const far = cut.flat().reduce((a, q) => (along(q) > along(a) ? q : a), cut[0][0]);
    const run = Math.max(1, along(far));
    let nearPad = null; let nd = Infinity;
    for (const q of padList) { const r = polyDistM(dir.o, q.poly, q.bb).d; if (r < nd) { nd = r; nearPad = q; } }
    const ay = nearPad && nd <= 12 ? nearPad.y : padY;
    const rn = roadNear(far.x, far.y, 8);
    const target = rn ? rn.lvl : rawAt(far.x, far.y);
    const sl = Math.max(-DRIVE_FALL_MAX, Math.min(DRIVE_FALL_MAX, (target - ay) / run));
    const g = { gx: dir.u.x * sl, gz: dir.u.y * sl };
    const ax = dir.o.x / 1000; const az = dir.o.y / 1000;
    planes.push({ id: `drive:${nDrive++}`, kind: 'drive', polys: cut, level: (x, y) => ay + g.gx * (x / 1000 - ax) + g.gz * (y / 1000 - az), fall: Math.abs(sl), dir });
  }
  const elements = [...cross, ...roads.map((r) => ({ id: r.id, kind: 'road', polys: [r.poly], level: r.level, fall: r.fall, road: true, crossfall: r.crossfall, frame: r.frame })), ...padEls, ...planes];
  if (!planes.length && !roads.length && !cross.length) return null;
  const fds = createFDS({ rawAt, elements, cellM, padBand: Math.max(S.PAD_MARGIN_M, 1.5 * cellM), lot, batterRun });
  return { elements: fds.elements, zones: fds.elements, fds, heightAt: fds.heightAt, band: fds.band, pads: padList };
}

/** Indicative cut and fill (m3) between the natural ground and the graded surface over a height grid. exclude(x, y) skips cells (the existing road is held, not graded). */
export function earthworks(grid, rawAt, cellAreaM2, exclude = null) {
  let cut = 0; let fill = 0;
  for (let j = 0; j < grid.rows; j++) for (let i = 0; i < grid.cols; i++) {
    const x = grid.x0 + i * grid.dx; const y = grid.y0 + j * grid.dy;
    if (exclude && exclude(x, y)) continue;
    const d = grid.heights[j * grid.cols + i] - rawAt(x, y);
    if (d > 0.005) fill += d * cellAreaM2; else if (d < -0.005) cut += -d * cellAreaM2;
  }
  return { cutM3: Math.round(cut), fillM3: Math.round(fill) };
}
