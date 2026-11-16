// Automatic grading for the 3D ground. Pure functions, no DOM, plan mm in and metres out.
//   * Building pads stay flat at the floor level (see terrain.js: padHeight).
//   * Car parks, hardstand and driveways each get a design surface: a best fit plane through the natural ground, clamped to a gentle fall
//     (1 to 5 percent for paving, up to 10 percent for a house driveway) and anchored at the building pad level where it meets the pad.
//   * The terrain mesh is flattened to that plane under the footprint (plus a small margin) and runs out in a short 1 in 3 batter to the
//     natural ground, so no terrain or aerial shows through paving and the paving never drapes over bumps.
import * as G from '../model/geometry.js';
import * as S from './site-geom.js';

export const FALL_MIN = 0.01; // flattest design fall for paving (1 percent)
export const FALL_MAX = 0.05; // steepest design fall for paving (5 percent)
export const DRIVE_FALL_MAX = 0.1; // steepest design fall for a house driveway
const MARGIN_M = 1.2; // flat band beyond the footprint: wider than a terrain cell so the mesh is on the plane under every pavement vertex
const REACH_M = 36; // a zone only affects ground within this distance (a batter of up to 12 m of cut or fill)

const bboxOf = (poly) => G.bbox(poly);

function polyDistM(p, poly, bb) {
  const dx = Math.max(bb.minX - p.x, 0, p.x - bb.maxX);
  const dy = Math.max(bb.minY - p.y, 0, p.y - bb.maxY);
  const dBox = Math.hypot(dx, dy) / 1000;
  if (dBox > REACH_M) return { d: dBox, q: p };
  if (G.pointInPolygon(p, poly)) return { d: 0, q: p };
  let best = Infinity;
  let bq = p;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x; const ey = b.y - a.y;
    const l2 = ex * ex + ey * ey;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2)) : 0;
    const h = Math.hypot(p.x - a.x - t * ex, p.y - a.y - t * ey);
    if (h < best) { best = h; bq = { x: a.x + t * ex, y: a.y + t * ey }; }
  }
  return { d: best / 1000, q: bq };
}

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
export const ROAD_GRADE_MAX = 0.06; // steepest longitudinal grade of the graded road corridor
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
const PROFILE_STEP_M = 12;
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

/** A uniform bucket index over expanded boxes: query(x, y) -> the items whose box covers the point. */
function buildIndex(items, cellMm = 12000) {
  const map = new Map();
  const key = (i, j) => i * 73856093 + j * 19349663;
  for (const it of items) {
    const i0 = Math.floor(it.box.minX / cellMm); const i1 = Math.floor(it.box.maxX / cellMm);
    const j0 = Math.floor(it.box.minY / cellMm); const j1 = Math.floor(it.box.maxY / cellMm);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = key(i, j); const a = map.get(k); if (a) a.push(it); else map.set(k, [it]); }
  }
  return (x, y) => map.get(key(Math.floor(x / cellMm), Math.floor(y / cellMm))) || EMPTY;
}
const EMPTY = [];

/**
 * planGrading({ rawAt, padY, fp, paving, driveways, corridors, cellM }) -> { zones, heightAt(x, y, raw), band } | null
 * rawAt(x, y) is the natural ground in metres (the same Y scale as padY); fp is the building pad bbox (plan mm) or null; cellM is the mesh
 * cell size in metres: the flat band around every footprint is at least 1.5 cells wide, so every mesh triangle that touches a footprint lies
 * wholly on its design plane (crisp edges, nothing above the surface). Beyond the band a 1 in 3 batter runs back to the natural ground.
 * Zones in priority order (paving, driveways, corridors): a point inside a footprint takes the first zone that contains it.
 */
export function planGrading({ rawAt, padY, fp = null, pads = null, paving = [], driveways = [], corridors = [], cellM = 0.75 }) {
  const zones = [];
  // Building pads: each building outline is its own flat pad (a U shaped group does not pad its court). A residential fp box is one pad.
  const padPolys = (pads && pads.length ? pads : fp ? [[{ x: fp.minX, y: fp.minY }, { x: fp.maxX, y: fp.minY }, { x: fp.maxX, y: fp.maxY }, { x: fp.minX, y: fp.maxY }]] : []).filter((q) => Array.isArray(q) && q.length >= 3);
  const padDist = (q) => { let d = Infinity; for (const poly of padPolys) d = Math.min(d, polyDistM(q, poly, bboxOf(poly)).d); return d; };
  const band = Math.max(MARGIN_M, 1.5 * cellM);
  const padBand = Math.max(S.PAD_MARGIN_M, 1.5 * cellM);
  const nearPad = (polys) => {
    let best = null;
    for (const poly of polys) for (const q of poly) {
      const d = padPolys.length ? padDist(q) : 0;
      if (!best || d < best.d) best = { d, q };
    }
    return best;
  };
  const corridorLevels = [];
  const roadLevelAt = (x, y) => { for (const c of corridorLevels) if (G.pointInPolygon({ x, y }, c.poly)) return c.level(x, y); return null; };
  const addZone = (polys, { max, dir = null }) => {
    const ps = polys.filter((p) => Array.isArray(p) && p.length >= 3);
    if (!ps.length) return;
    let area = 0;
    for (const p of ps) { const b = bboxOf(p); area += (b.maxX - b.minX) * (b.maxY - b.minY) / 1e6; }
    const smp = samplesIn(ps, rawAt, Math.max(2000, Math.sqrt(area / 1500) * 1000));
    const fit = fitPlane(smp);
    if (!fit) return;
    const np = padPolys.length ? nearPad(ps) : null;
    const anchored = !!np && np.d <= 12; // only paving beside the building is pinned to its pad level; a far car park keeps its own level
    let g;
    if (dir) {
      const along = (q) => (q.x - dir.o.x) / 1000 * dir.u.x + (q.y - dir.o.y) / 1000 * dir.u.y;
      const far = ps.flat().reduce((a, q) => (along(q) > along(a) ? q : a), ps[0][0]);
      const run = Math.max(1, along(far));
      const target = roadLevelAt(far.x, far.y) ?? rawAt(far.x, far.y);
      const sl = Math.max(-max, Math.min(max, (target - padY) / run));
      g = { gx: dir.u.x * sl, gz: dir.u.y * sl };
    } else {
      g = clampFall(fit.gx, fit.gz, max);
      // Paving that meets the road is pinned to the road level there (so there is no step at the crossover) while it keeps the pad level at the
      // building: the fall between the two is solved along the natural fall direction, then clamped to the design range.
      let rq = null;
      for (const cr of corridorLevels) for (const poly of ps) for (const q of poly) {
        const r = polyDistM(q, cr.poly, cr.bb);
        if (r.d <= 6 && (!rq || r.d < rq.d)) rq = { d: r.d, x: q.x, y: q.y, lvl: cr.level(q.x, q.y) };
      }
      if (rq && np && anchored) {
        const m0 = Math.hypot(g.gx, g.gz);
        const ux = m0 ? g.gx / m0 : 0; const uz = m0 ? g.gz / m0 : 1;
        const den = ((rq.x - np.q.x) / 1000) * ux + ((rq.y - np.q.y) / 1000) * uz;
        if (Math.abs(den) > 5) { const mm = Math.max(-max, Math.min(max, (rq.lvl - padY) / den)); g = { gx: ux * mm, gz: uz * mm }; }
      }
    }
    const anchor = dir ? dir.o : anchored ? np.q : null;
    const ax = anchor ? anchor.x / 1000 : fit.cx;
    const az = anchor ? anchor.y / 1000 : fit.cz;
    const ay = anchor ? padY : fit.cy;
    zones.push({ polys: ps, boxes: ps.map(bboxOf), level: (x, y) => ay + g.gx * (x / 1000 - ax) + g.gz * (y / 1000 - az), fall: Math.hypot(g.gx, g.gz) });
  };
  // Corridors are planned first (so a driveway can aim at the road level) but ranked last.
  const corridorZones = [];
  for (const cr of corridors) {
    const pr = corridorProfile(cr, rawAt);
    if (!pr) continue;
    corridorLevels.push({ poly: cr.poly, bb: bboxOf(cr.poly), level: pr.level });
    corridorZones.push({ polys: [cr.poly], boxes: [bboxOf(cr.poly)], level: pr.level, fall: pr.grade, road: true, crossfall: pr.crossfall });
  }
  // Paving that reaches into a road corridor (a crossover pad) is cut back to the property side of the corridor: the rest is road surface.
  const clipHalf = (poly, o, n) => {
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
  const offRoad = paving.filter((p) => Array.isArray(p) && p.length >= 3).map((poly) => {
    let q = poly;
    for (const cr of corridors) { if (q.length >= 3) q = clipHalf(q, cr.poly[0], cr.outward); }
    return q;
  }).filter((q) => q.length >= 3 && G.polygonArea(q) > 1e5);
  if (offRoad.length) for (const grp of clusterPolys(offRoad)) addZone(grp, { max: FALL_MAX });
  for (const d of driveways) {
    const cut = d.polys.filter((p) => Array.isArray(p) && p.length >= 3).map((poly) => { let q = poly; for (const cr of corridors) if (q.length >= 3) q = clipHalf(q, cr.poly[0], cr.outward); return q; }).filter((q) => q.length >= 3 && G.polygonArea(q) > 1e5);
    addZone(cut, { max: DRIVE_FALL_MAX, dir: d.dir });
  }
  zones.push(...corridorZones);
  if (!zones.length) return null;
  const padZones = padPolys.map((poly) => ({ polys: [poly], boxes: [bboxOf(poly)], level: () => padY, fall: 0, pad: true }));
  zones.unshift(...padZones);
  zones.forEach((z, k) => { z.rank = k; z.band = z.pad ? padBand : band; });
  const items = [];
  zones.forEach((z) => z.polys.forEach((poly, pi) => {
    const b = z.boxes[pi]; const r = (REACH_M + z.band) * 1000;
    items.push({ z, poly, bb: b, box: { minX: b.minX - r, maxX: b.maxX + r, minY: b.minY - r, maxY: b.maxY + r } });
  }));
  const query = buildIndex(items);
  const heightAt = (x, y, raw) => {
    const p = { x, y };
    let bz = null; let bd = Infinity; let bq = p; let bk = Infinity; // winning zone: a containing zone by rank, else the nearest
    for (const it of query(x, y)) {
      const lx = Math.max(it.bb.minX - x, 0, x - it.bb.maxX); const ly = Math.max(it.bb.minY - y, 0, y - it.bb.maxY);
      const lb = Math.hypot(lx, ly) / 1000; // the distance to the box bounds the distance to the polygon from below
      if (lb > REACH_M + it.z.band || (bk < 0 ? lb > 0 : lb >= bk)) continue;
      const r = polyDistM(p, it.poly, it.bb);
      if (r.d > REACH_M + it.z.band) continue;
      const key = r.d === 0 ? -1 + it.z.rank * 1e-6 : r.d + it.z.rank * 1e-9;
      if (key < bk) { bk = key; bz = it.z; bd = r.d; bq = r.q; }
    }
    if (!bz) return raw;
    const bnd = bz.band;
    if (bd <= bnd) return bz.level(x, y); // flat band: the design plane carried outward
    if (bd > REACH_M + bnd) return raw;
    const k = bnd / bd; // the batter starts from the plane at the band edge, so it is a clean 1 in 3 band
    const lvl = bz.level(bq.x + (x - bq.x) * k, bq.y + (y - bq.y) * k);
    return S.padHeight(raw, lvl, bd - bnd + S.PAD_MARGIN_M);
  };
  return { zones, heightAt, band };
}

/** Indicative cut and fill (m3) between the natural ground and the graded surface over a height grid. */
export function earthworks(grid, rawAt, cellAreaM2) {
  let cut = 0; let fill = 0;
  for (let j = 0; j < grid.rows; j++) for (let i = 0; i < grid.cols; i++) {
    const x = grid.x0 + i * grid.dx; const y = grid.y0 + j * grid.dy;
    const d = grid.heights[j * grid.cols + i] - rawAt(x, y);
    if (d > 0.005) fill += d * cellAreaM2; else if (d < -0.005) cut += -d * cellAreaM2;
  }
  return { cutM3: Math.round(cut), fillM3: Math.round(fill) };
}
