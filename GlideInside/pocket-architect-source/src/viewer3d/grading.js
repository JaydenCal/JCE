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
const REACH_M = 60; // a zone only affects ground within this distance

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
export function planGrading({ rawAt, padY, fp = null, paving = [], driveways = [] }) {
  const zones = [];
  const padRef = fp ? { x: (fp.minX + fp.maxX) / 2, y: (fp.minY + fp.maxY) / 2 } : null;
  const nearPad = (polys) => {
    let best = null;
    for (const poly of polys) for (const q of poly) {
      const d = fp ? S.distToBox(fp, q.x, q.y) : 0;
      if (!best || d < best.d) best = { d, q };
    }
    return best?.q || null;
  };
  const addZone = (polys, { max, dir = null }) => {
    const ps = polys.filter((p) => Array.isArray(p) && p.length >= 3);
    if (!ps.length) return;
    const smp = samplesIn(ps, rawAt);
    const fit = fitPlane(smp);
    if (!fit) return;
    let g;
    if (dir) {
      // A driveway falls along its own direction only (no crossfall): the slope from the house end to the street end, clamped.
      const along = (q) => (q.x / 1000 - dir.o.x / 1000) * dir.u.x + (q.y / 1000 - dir.o.y / 1000) * dir.u.y;
      const far = ps.flat().reduce((a, q) => (along(q) > along(a) ? q : a), ps[0][0]);
      const run = Math.max(1, along(far));
      const s = Math.max(-max, Math.min(max, (rawAt(far.x, far.y) - padY) / run));
      g = { gx: dir.u.x * s, gz: dir.u.y * s };
    } else g = clampFall(fit.gx, fit.gz, max);
    // Anchor: the plane meets the pad level where the paving is nearest the building; with no building it passes through the mean ground.
    const anchor = padRef ? (dir ? dir.o : nearPad(ps)) : null;
    const ax = anchor ? anchor.x / 1000 : fit.cx;
    const az = anchor ? anchor.y / 1000 : fit.cz;
    const ay = anchor ? padY : fit.cy;
    zones.push({ polys: ps, boxes: ps.map(bboxOf), level: (x, y) => ay + g.gx * (x / 1000 - ax) + g.gz * (y / 1000 - az), fall: Math.hypot(g.gx, g.gz) });
  };
  if (paving.length) addZone(paving, { max: FALL_MAX });
  for (const d of driveways) addZone(d.polys, { max: DRIVE_FALL_MAX, dir: d.dir });
  if (!zones.length) return null;
  const heightAt = (x, y, raw) => {
    const p = { x, y };
    const dPad = fp ? S.distToBox(fp, x, y) : Infinity;
    if (dPad <= S.PAD_MARGIN_M) return padY;
    let best = { d: dPad, level: padY };
    for (const z of zones) {
      let near = { d: Infinity, q: p };
      for (let i = 0; i < z.polys.length; i++) { const r = polyDistM(p, z.polys[i], z.boxes[i]); if (r.d < near.d) near = r; }
      const d = Math.max(0, near.d - (MARGIN_M - S.PAD_MARGIN_M));
      if (d < best.d) best = { d, level: z.level(near.q.x, near.q.y) }; // the batter starts from the design level at the footprint edge
    }
    if (best.d === Infinity || best.d > REACH_M) return raw;
    return S.padHeight(raw, best.level, best.d);
  };
  return { zones, heightAt };
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
