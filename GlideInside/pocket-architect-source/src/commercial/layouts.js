// Ready-made unit layouts and the auto fit for the commercial lot card (the commercial counterpart of the house designs and chooseDesign).
// A layout is a family (single row, back to back rows, two rows facing a central apron), a unit size and a count. Each is built once in a
// canonical frame (row origin at 0, 0, units running along x with their fronts facing +y), judged for parking once (the counts do not
// change when the block is moved), and then slid and turned over the lot: every position and turn is tried and the first that keeps the
// units inside the setback envelope and the bays inside the lot wins. Pure: no DOM, no three.
//
//   chooseLayout(project, id)      -> { id, label, rows, fits, parkingOk, tooBig, gfa, units, ... }  ('best' searches every family and count)
//   applyLayout(store, choice)     one undo step: rows, layout record, model
//   currentLayoutIndex / stepLayout / layoutPagerText   switcher helpers

import * as G from '../model/geometry.js';
import { lotOf } from '../model/placement.js';
import { defaultRow, normaliseCommercial, isCommercial } from './schema.js';
import { layoutUnits } from './layout.js';
import { parkingLayout } from './parking.js';
import { commercialStats } from './stats.js';
import { materialise } from './materialise.js';
import { setbackStatusLine } from '../site/lot-checks.js';

export const BEST_ID = 'best';
export const TOO_BIG_LAYOUT = 'Too big for this block';

const ROUND_DEG = 1000;
const TOL = 5; // mm
const STEP = 50; // mm, positions snap inward to this grid

/** Unit size classes. Depth is per family: back to back rows share the block depth, so they are shallower. */
export const SIZES = Object.freeze({
  std: { widthMm: 6000, heightMm: 6000, depthMm: { single: 18000, b2b: 15000, court: 15000 }, doors: null },
  // 10 x 30 m, one 4.5 x 5.0 m door, no ground office and no mezzanine: the floor area is the 300 m² in the name.
  large: { widthMm: 10000, heightMm: 8000, depthMm: { single: 30000 }, doors: { presetId: '4.5x5.0', widthMm: 4500, heightMm: 5000 }, plain: true },
});

/** The ready-made layouts the switcher steps through, after Best fit. */
export const TEMPLATES = Object.freeze([
  { id: 'row-6', label: 'Single row, 6 units', family: 'single', size: 'std', count: 6 },
  { id: 'row-10', label: 'Single row, 10 units', family: 'single', size: 'std', count: 10 },
  { id: 'b2b-12', label: 'Back to back, 12 units', family: 'b2b', size: 'std', count: 6 },
  { id: 'b2b-16', label: 'Back to back, 16 units', family: 'b2b', size: 'std', count: 8 },
  { id: 'court-20', label: 'Two rows with central apron, 20 units', family: 'court', size: 'std', count: 10 },
  { id: 'large-6', label: 'Large units, 6 x 300 m²', family: 'single', size: 'large', count: 6 },
]);
export const LAYOUT_LIST = Object.freeze([{ id: BEST_ID, label: 'Best fit' }, ...TEMPLATES]);
export const layoutById = (id) => LAYOUT_LIST.find((l) => l.id === id) || null;

/** The name of a layout built from a family, size and count (Best fit may land on a count no template has). */
export function labelFor(family, size, count) {
  if (size === 'large') return `Large units, ${count} x 300 m²`;
  if (family === 'b2b') return `Back to back, ${count * 2} units`;
  if (family === 'court') return `Two rows with central apron, ${count * 2} units`;
  return `Single row, ${count} unit${count === 1 ? '' : 's'}`;
}

// Switcher ------------------------------------------------------------------------------------------------------------------
/** Index in LAYOUT_LIST of the layout the project was set to (-1 when it has none). */
export function currentLayoutIndex(project) {
  const id = project?.commercial?.layout?.id;
  return LAYOUT_LIST.findIndex((l) => l.id === id);
}
export const stepLayout = (i, dir, n = LAYOUT_LIST.length) => (i < 0 ? (dir > 0 ? 0 : n - 1) : (((i + dir) % n) + n) % n);
/** { name, n, of } for the pager: the name of the layout in place (Best fit shows what it chose), and "1 / 7". */
export function layoutPagerText(project) {
  const c = project?.commercial;
  const i = currentLayoutIndex(project);
  const name = c?.layout?.label || (i >= 0 ? LAYOUT_LIST[i].label : 'Layout');
  return { name, n: i < 0 ? null : i + 1, of: LAYOUT_LIST.length };
}

// Canonical build -----------------------------------------------------------------------------------------------------------
function unitFor(family, size) {
  const s = SIZES[size];
  return { u: { widthMm: s.widthMm, depthMm: s.depthMm[family] ?? s.depthMm.single, heightMm: s.heightMm }, doors: s.doors, plain: !!s.plain };
}

/** The rows of a layout in the canonical frame. */
export function canonicalRows(family, size, count, parking) {
  const { u, doors, plain } = unitFor(family, size);
  const mk = (over = {}) => {
    const r = defaultRow({ count, ...over });
    r.unit.widthMm = u.widthMm;
    r.unit.depthMm = u.depthMm;
    r.unit.heightMm = u.heightMm;
    if (doors) Object.assign(r.unit.doors, doors);
    if (plain) { r.unit.office.enabled = false; r.unit.mezzanine.enabled = false; }
    return r;
  };
  const a = mk();
  if (family === 'single') return [a];
  if (family === 'b2b') return [a, mk({ mirrorOf: a.id })];
  // Central apron: a truck apron against each facade and a double banked row of bays between the two aprons, so the fronts stand
  // two (apron + bay depth) apart.
  const off = Math.max(Number(parking?.aisleMm) || 0, Number(parking?.apronMm) || 0);
  const gap = 2 * (off + (Number(parking?.bayL) || 5400));
  const b = mk({ rotationDeg: 180 });
  b.x = count * u.widthMm;
  b.y = 2 * u.depthMm + gap;
  return [a, b];
}

const transformRows = (rows, deg, T) => {
  const a = (deg * Math.PI) / 180;
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  return rows.map((r) => ({
    ...structuredClone(r),
    x: Math.round(r.x * cs - r.y * sn + T.x),
    y: Math.round(r.x * sn + r.y * cs + T.y),
    rotationDeg: Math.round((((r.rotationDeg || 0) + deg) % 360) * ROUND_DEG) / ROUND_DEG,
  }));
};

/** A candidate: the rows, the polygons, and the figures that do not depend on where the block stands. */
function candidate(project, family, size, count) {
  const base = project.commercial;
  const rows = canonicalRows(family, size, count, base.parking);
  const c = normaliseCommercial({ ...base, rows, waste: null, hydrant: null, parking: { ...base.parking, extra: [] } });
  const units = layoutUnits(c);
  const park = parkingLayout(c);
  const stats = commercialStats({ commercial: c, site: project.site });
  const unitPolys = units.map((u) => u.poly);
  const bayPolys = park.rows.flatMap((r) => r.slots.map((s) => s.poly));
  const ub = G.bbox(unitPolys.flat());
  const ab = G.bbox([...unitPolys.flat(), ...bayPolys.flat()]);
  let overlap = false;
  for (const sp of bayPolys) { if (unitPolys.some((up) => G.convexOverlap(sp, up, 100))) { overlap = true; break; } }
  const parkingOk = !overlap && stats.parking.provided >= stats.parking.required && park.accessible.provided >= park.accessible.required;
  return { family, size, count, label: labelFor(family, size, count), rows, unitPolys, bayPolys, ub, ab, stats, gfa: stats.gfaM2, units: units.length, parkingOk, parkingShort: Math.max(0, stats.parking.required - stats.parking.provided) };
}

// Geometry ------------------------------------------------------------------------------------------------------------------
const distToPoly = (p, poly) => {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, G.projectToSegment(p, poly[i], poly[(i + 1) % poly.length]).d);
  return d;
};
const insidePoly = (p, poly, tol = TOL) => G.pointInPolygon(p, poly) || distToPoly(p, poly) <= tol;

/** The turn (degrees) that puts the unit fronts toward the street frontage and the rows parallel to it, as firstRow does. */
export function naturalAngle(lot) {
  const n = lot.boundary.length;
  const e0 = (lot.frontEdges || [])[0] ?? 0;
  const a = lot.boundary[e0];
  const b = lot.boundary[(e0 + 1) % n];
  const el = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const e = { x: (b.x - a.x) / el, y: (b.y - a.y) / el };
  let nrm = { x: -e.y, y: e.x };
  const cx = lot.boundary.reduce((s, q) => s + q.x, 0) / n;
  const cy = lot.boundary.reduce((s, q) => s + q.y, 0) / n;
  if ((cx - a.x) * nrm.x + (cy - a.y) * nrm.y < 0) nrm = { x: -nrm.x, y: -nrm.y };
  const u = { x: -nrm.y, y: nrm.x };
  return Math.round(((Math.atan2(u.y, u.x) * 180) / Math.PI) * ROUND_DEG) / ROUND_DEG;
}

const envelopeOf = (lot) => (Array.isArray(lot.envelope) && lot.envelope.length >= 3 ? lot.envelope : lot.boundary);
const extent = (pts, ax) => { const v = pts.map((q) => q.x * ax.x + q.y * ax.y); return [Math.min(...v), Math.max(...v)]; };

/** Every pose of a candidate over the lot, in the order they are preferred: [{ deg, rank, T }]. Bounding box pruning only. */
function* poses(cand, lot, env, natural) {
  const fs = [0.5, 0, 1, 0.25, 0.75]; // along the frontage: centred first
  const fb = [0, 1, 0.5, 0.25, 0.75]; // from the rear: against the rear setback first
  for (const [rank, k] of [0, 2, 1, 3].entries()) {
    const deg = Math.round((((natural + k * 90) % 360) * ROUND_DEG)) / ROUND_DEG;
    const a = (deg * Math.PI) / 180;
    const u = { x: Math.cos(a), y: Math.sin(a) };
    const f = { x: -Math.sin(a), y: Math.cos(a) };
    const [es0, es1] = extent(env, u);
    const [et0, et1] = extent(env, f);
    const [ls0, ls1] = extent(lot.boundary, u);
    const [lt0, lt1] = extent(lot.boundary, f);
    const sLo = Math.max(es0 - cand.ub.minX, ls0 - cand.ab.minX);
    const sHi = Math.min(es1 - cand.ub.maxX, ls1 - cand.ab.maxX);
    const tLo = Math.max(et0 - cand.ub.minY, lt0 - cand.ab.minY);
    const tHi = Math.min(et1 - cand.ub.maxY, lt1 - cand.ab.maxY);
    if (sLo > sHi + 1 || tLo > tHi + 1) continue;
    const snapIn = (lo, hi, fx) => {
      const lo2 = Math.ceil(lo / STEP) * STEP;
      const hi2 = Math.floor(hi / STEP) * STEP;
      if (lo2 > hi2) return [Math.round((lo + hi) / 2)];
      return [...new Set(fx.map((t) => Math.round((lo2 + (hi2 - lo2) * t) / STEP) * STEP))];
    };
    for (const B of snapIn(tLo, tHi, fb)) for (const A of snapIn(sLo, sHi, fs)) yield { deg, rank, T: { x: u.x * A + f.x * B, y: u.y * A + f.y * B } };
  }
}

const place = (pts, deg, T) => {
  const a = (deg * Math.PI) / 180;
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  return pts.map((q) => ({ x: q.x * cs - q.y * sn + T.x, y: q.x * sn + q.y * cs + T.y }));
};

/** Units wholly inside the setback envelope and every bay inside the lot. */
function fitsAt(cand, lot, env, pose) {
  for (const poly of cand.unitPolys) for (const q of place(poly, pose.deg, pose.T)) if (!insidePoly(q, env)) return false;
  for (const poly of cand.bayPolys) for (const q of place(poly, pose.deg, pose.T)) if (!insidePoly(q, lot.boundary)) return false;
  return true;
}

/** The first pose, in order of preference, at which the candidate fits. */
function bestPose(cand, lot, env, natural, verify = null) {
  for (const pose of poses(cand, lot, env, natural)) if (fitsAt(cand, lot, env, pose) && (!verify || verify(cand, pose))) return pose;
  return null;
}

/** The same test the card's setback line makes (walls included), so a layout is never placed where the card would read "Outside the setbacks". */
const verifier = (project) => (cand, pose) => {
  try {
    const t = structuredClone(project);
    t.commercial.rows = transformRows(cand.rows, pose.deg, pose.T);
    t.commercial.parking = { ...t.commercial.parking, extra: [] };
    t.commercial = normaliseCommercial(t.commercial);
    materialise(t, { site: false });
    return setbackStatusLine(t).state !== 'outside';
  } catch { return true; }
};

/** Where a block that does not fit stands: the natural turn, centred on the envelope, so the card can show it red. */
function fallbackPose(cand, env, natural) {
  const a = (natural * Math.PI) / 180;
  const u = { x: Math.cos(a), y: Math.sin(a) };
  const f = { x: -Math.sin(a), y: Math.cos(a) };
  const [s0, s1] = extent(env, u);
  const [t0, t1] = extent(env, f);
  const A = (s0 + s1) / 2 - (cand.ub.minX + cand.ub.maxX) / 2;
  const B = (t0 + t1) / 2 - (cand.ub.minY + cand.ub.maxY) / 2;
  return { deg: natural, rank: 0, T: { x: Math.round(u.x * A + f.x * B), y: Math.round(u.y * A + f.y * B) } };
}

const envKeyOf = (lot) => JSON.stringify((lot.envelope || []).map((q) => [Math.round(q.x / 10), Math.round(q.y / 10)]));
export const rowsSignature = (rows) => JSON.stringify((rows || []).map((r) => [r.x, r.y, r.rotationDeg, r.count, r.mirrorOf ? 1 : 0, r.unit?.widthMm, r.unit?.depthMm]));

function result(cand, pose, id, fits) {
  return { id, label: cand.label, family: cand.family, size: cand.size, count: cand.count, rows: transformRows(cand.rows, pose.deg, pose.T), extra: [], fits, tooBig: !fits, parkingOk: cand.parkingOk, parkingShort: cand.parkingShort, gfa: cand.gfa, units: cand.units, deg: pose.deg };
}


// Best fit: multi row search --------------------------------------------------------------------------------------------------
// Rows are stacked along the canonical y axis. Each row faces +y (dir +1) or -y (dir -1). Two rows back to back share a wall (gap 0);
// two rows facing each other share one truck apron (gap 2 x apron, each row keeps its own 12 m); rows facing the same way have one apron
// between them. A row whose front looks out of the block has its own bay row beyond the apron; inner rows have no bays of their own, and
// the bays still needed go in strips along boundaries and in spare areas (parking.extra), each with a 5.8 m aisle. Nothing is placed
// within 3 m of the frontage (landscaping strip). Unit widths 6, 7.5, 9, 12 m and depths 12, 15, 18, 20 m; the highest floor area that
// passes the setbacks and parks wins, preferring site coverage at or under 45%.
const BF_WIDTHS = [6000, 7500, 9000, 12000];
const BF_DEPTHS = [12000, 15000, 18000, 20000];
const FRONT_STRIP = 3000;
const COVER_CAP = 45;
const BF_BUDGET_MS = 1300;
const BF_MAX_EVALS = 140;

const toLocal = (p, deg) => { const a = (deg * Math.PI) / 180; return { x: p.x * Math.cos(a) + p.y * Math.sin(a), y: -p.x * Math.sin(a) + p.y * Math.cos(a) }; };
const rectPts = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

/** The lot polygon with every frontage edge moved in by `mm` (a landscaping strip). Convex clip, which is what a lot almost always is. */
export function yardOf(lot, mm = FRONT_STRIP) {
  let poly = lot.boundary.map((q) => ({ x: q.x, y: q.y }));
  const n = lot.boundary.length;
  const cx = lot.boundary.reduce((t, q) => t + q.x, 0) / n;
  const cy = lot.boundary.reduce((t, q) => t + q.y, 0) / n;
  const fronts = new Set((lot.frontEdges || []).filter((e) => Number.isInteger(e) && e >= 0 && e < n));
  for (let e = 0; e < n; e++) {
    const mmE = fronts.has(e) ? mm : 150; // every boundary keeps a small margin, the frontage a landscaping strip
    const a = lot.boundary[e];
    const b = lot.boundary[(e + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = -(b.y - a.y) / len;
    let ny = (b.x - a.x) / len;
    if ((cx - a.x) * nx + (cy - a.y) * ny < 0) { nx = -nx; ny = -ny; }
    const d = (p) => (p.x - a.x) * nx + (p.y - a.y) * ny - mmE;
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const dp = d(p);
      const dq = d(q);
      if (dp >= 0) out.push(p);
      if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }); }
    }
    if (out.length >= 3) poly = out;
  }
  return poly;
}

function sequences() {
  const out = [];
  for (let k = 1; k <= 4; k++) {
    for (let m = 0; m < 1 << k; m++) {
      const s = Array.from({ length: k }, (_, i) => ((m >> i) & 1 ? '+' : '-')).join('');
      const nr = [...s].reverse().map((c) => (c === '+' ? '-' : '+')).join('');
      if (s <= nr) out.push(s); // the other is the same block turned half a turn
    }
  }
  return out;
}
const SEQS = sequences();

const gapFor = (a, b, off) => (a === '-' && b === '+' ? 0 : a === '+' && b === '-' ? 2 * off : off);

/** The rows of a block of `n` units of w x d in the canonical frame, with the rectangles the search tests. */
function blockOf(seq, n, w, d, parking) {
  const off = Math.max(Number(parking.aisleMm) || 0, Number(parking.apronMm) || 0);
  const bayL = Number(parking.bayL) || 5400;
  const bayW = Number(parking.bayW) || 2400;
  const L = n * w;
  const Lb = Math.floor(L / bayW) * bayW;
  const rows = [];
  const unitRects = [];
  const apronRects = [];
  const bayRects = [];
  const zoneRects = [];
  let y = 0;
  [...seq].forEach((c, i) => {
    const ya = y;
    const yb = ya + d;
    const dir = c === '+' ? 1 : -1;
    const bays = (i === 0 && dir === -1) || (i === seq.length - 1 && dir === 1);
    rows.push({ dir, ya, yb, bays });
    unitRects.push([0, ya, L, yb]);
    if (bays && dir === 1) { apronRects.push([0, yb, L, yb + off]); bayRects.push([0, yb + off, Lb, yb + off + bayL]); zoneRects.push([0, yb, L, yb + off + bayL]); }
    if (bays && dir === -1) { apronRects.push([0, ya - off, L, ya]); bayRects.push([L - Lb, ya - off - bayL, L, ya - off]); zoneRects.push([0, ya - off - bayL, L, ya]); }
    y = yb + (i < seq.length - 1 ? gapFor(c, seq[i + 1], off) : 0);
    if (i < seq.length - 1) { const g = gapFor(c, seq[i + 1], off); if (g > 0) apronRects.push([0, yb, L, yb + g]); }
  });
  const vmin = Math.min(...unitRects.map((r) => r[1]), ...zoneRects.map((r) => r[1]));
  const vmax = Math.max(...unitRects.map((r) => r[3]), ...zoneRects.map((r) => r[3]));
  const rowBays = rows.reduce((t, r) => t + (r.bays ? Math.floor(L / bayW) : 0), 0);
  return { rows, L, unitRects, apronRects, bayRects, zoneRects, vmin, vmax, rowBays, off, bayL, bayW };
}

const rowsOf = (blk, w, d) => blk.rows.map((r) => {
  const row = defaultRow({ count: Math.round(blk.L / w) });
  row.unit.widthMm = w;
  row.unit.depthMm = d;
  row.unit.heightMm = 6000;
  if (r.dir === 1) { row.x = 0; row.y = r.ya; row.rotationDeg = 0; } else { row.x = blk.L; row.y = r.yb; row.rotationDeg = 180; }
  if (!r.bays) row.bays = false;
  return row;
});

/** Free stretches along u of the band [y0, y1] inside the polygon (convex scan at three lines), before obstacles. */
function spanAt(poly, y) {
  const xs = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
  }
  return xs.length >= 2 ? [Math.min(...xs), Math.max(...xs)] : null;
}

/**
 * Bay strips in spare areas: scan both orientations (rows' own axes and a quarter turn), every 600 mm across the lot, for the longest
 * stretch where a row of bays and its 5.8 m aisle fit inside the yard and clear of units, aprons and other bays. Returns [{ x, y, rotationDeg, count }]
 * in plan coordinates, or null when `need` bays cannot be found.
 */
function findExtras(need, ctx) {
  const { deg, yard, hard, aprons, bayR, bayW, bayL, aisle } = ctx;
  const chosen = [];
  const bays = [...bayR];
  const aisles = [];
  let left = need;
  for (let it = 0; it < 8 && left > 0; it++) {
    let best = null;
    for (const phi of [deg, deg + 90]) {
      const frame = (poly) => poly.map((q) => toLocal(q, phi));
      const Y = frame(yard);
      const box = (poly) => { const l = frame(poly); return { x0: Math.min(...l.map((q) => q.x)), x1: Math.max(...l.map((q) => q.x)), y0: Math.min(...l.map((q) => q.y)), y1: Math.max(...l.map((q) => q.y)) }; };
      const H = hard.map(box);
      const AP = aprons.map(box);
      const BR = bays.map(box);
      const AI = aisles.map(box);
      const ymin = Math.min(...Y.map((q) => q.y));
      const ymax = Math.max(...Y.map((q) => q.y));
      const total = bayL + aisle;
      for (let y0 = Math.ceil(ymin / 600) * 600; y0 + total <= ymax; y0 += 600) {
        const sp = [spanAt(Y, y0 + 1), spanAt(Y, y0 + total / 2), spanAt(Y, y0 + total - 1)];
        if (sp.some((q) => !q)) continue;
        const lo = Math.max(...sp.map((q) => q[0]));
        const hi = Math.min(...sp.map((q) => q[1]));
        if (hi - lo < bayW) continue;
        for (const s of [1, -1]) {
          const by0 = s === 1 ? y0 : y0 + aisle;
          const by1 = by0 + bayL;
          const ay0 = s === 1 ? y0 + bayL : y0;
          const ay1 = ay0 + aisle;
          const cuts = [];
          const hit = (r, a0, a1) => r.y0 < a1 && r.y1 > a0;
          for (const r of [...H, ...BR]) { if (hit(r, by0, by1) || hit(r, ay0, ay1)) cuts.push([r.x0, r.x1]); }
          for (const r of [...AP, ...AI]) { if (hit(r, by0, by1)) cuts.push([r.x0, r.x1]); }
          cuts.sort((a, b) => a[0] - b[0]);
          let cur = lo;
          const free = [];
          for (const [c0, c1] of cuts) { if (c0 > cur) free.push([cur, Math.min(c0, hi)]); cur = Math.max(cur, c1); if (cur >= hi) break; }
          if (cur < hi) free.push([cur, hi]);
          for (const [f0, f1] of free) {
            const cnt = Math.floor((f1 - f0) / bayW);
            if (cnt >= Math.min(3, left) && (!best || cnt > best.cnt)) best = { cnt, phi, s, y0, f0 };
          }
        }
      }
    }
    if (!best) return null;
    const cnt = Math.min(best.cnt, left);
    const a = (best.phi * Math.PI) / 180;
    const U = { x: Math.cos(a), y: Math.sin(a) };
    const F = { x: -Math.sin(a), y: Math.cos(a) };
    const wp = (x, y) => ({ x: Math.round(U.x * x + F.x * y), y: Math.round(U.y * x + F.y * y) });
    const x0 = best.f0;
    const x1 = x0 + cnt * bayW;
    if (best.s === 1) {
      chosen.push({ ...wp(x1, best.y0 + bayL), rotationDeg: Math.round(((best.phi + 180) % 360) * ROUND_DEG) / ROUND_DEG, count: cnt });
      bays.push(rectPts(x0, best.y0, x1, best.y0 + bayL).map((q) => wp(q.x, q.y)));
      aisles.push(rectPts(x0, best.y0 + bayL, x1, best.y0 + bayL + aisle).map((q) => wp(q.x, q.y)));
    } else {
      chosen.push({ ...wp(x0, best.y0 + aisle), rotationDeg: Math.round((best.phi % 360) * ROUND_DEG) / ROUND_DEG, count: cnt });
      bays.push(rectPts(x0, best.y0 + aisle, x1, best.y0 + aisle + bayL).map((q) => wp(q.x, q.y)));
      aisles.push(rectPts(x0, best.y0, x1, best.y0 + aisle).map((q) => wp(q.x, q.y)));
    }
    left -= cnt;
  }
  return left > 0 ? null : chosen;
}

const clampSnap = (lo, hi, f) => (lo > hi ? null : Math.round((lo + (hi - lo) * f) / STEP) * STEP);

/** Stage 1: every (turn, row stack, unit size) with the largest count that stands inside the envelope with its aprons and bays in the yard. */
function enumerate(project, lot, env, yard, angles, info, deadline) {
  const lotM2 = Math.abs(G.polygonArea ? G.polygonArea(lot.boundary) : 0) / 1e6 || (lot.areaM2 || 1);
  const out = [];
  for (const deg of angles) {
    const E = env.map((q) => toLocal(q, deg));
    const Yd = yard.map((q) => toLocal(q, deg));
    const eb = G.bbox(E);
    const yb = G.bbox(Yd);
    for (const seq of SEQS) {
      for (const d of BF_DEPTHS) {
        for (const w of BF_WIDTHS) {
          const g1 = info(w, d);
          const blk1 = blockOf(seq, 1, w, d, project.commercial.parking);
          if (blk1.vmax - blk1.vmin > Math.min(eb.maxY - eb.minY + 2 * blk1.off + 2 * blk1.bayL, yb.maxY - yb.minY) + 1) continue;
          if (blk1.unitRects.at(-1)[3] - blk1.unitRects[0][1] > eb.maxY - eb.minY + 1) continue;
          const nBound = Math.min(40, Math.floor(Math.min(eb.maxX - eb.minX, yb.maxX - yb.minX) / w));
          let found = 0;
          for (let n = nBound; n >= 1 && found < 3; n--) {
            const blk = blockOf(seq, n, w, d, project.commercial.parking);
            const uy0 = blk.unitRects[0][1];
            const uy1 = blk.unitRects.at(-1)[3];
            const aLo = Math.max(eb.minX, yb.minX); // zones are never wider than the rows, so the yard bound is the same
            const aHi = Math.min(eb.maxX, yb.maxX) - blk.L;
            const bLo = Math.max(eb.minY - uy0, yb.minY - blk.vmin);
            const bHi = Math.min(eb.maxY - uy1, yb.maxY - blk.vmax);
            if (aLo > aHi + 1 || bLo > bHi + 1) continue;
            let ok = null;
            for (const fb of [0, 1, 0.5]) {
              for (const fa of [0.5, 0, 1]) {
                const A = clampSnap(aLo, aHi, fa) ?? Math.round((aLo + aHi) / 2);
                const B = clampSnap(bLo, bHi, fb) ?? Math.round((bLo + bHi) / 2);
                const inside = (r, poly) => rectPts(r[0] + A, r[1] + B, r[2] + A, r[3] + B).every((q) => insidePoly(q, poly));
                if (blk.unitRects.every((r) => inside(r, E)) && blk.zoneRects.every((r) => inside(r, Yd))) { ok = { A, B }; break; }
              }
              if (ok) break;
            }
            if (!ok) continue;
            found += 1;
            const units = n * seq.length;
            const cover = (units * w * d) / 1e6 / lotM2 * 100;
            // The coverage cap trims the count; the full count stays as a fallback entry.
            const nCap = Math.floor((COVER_CAP / 100) * lotM2 * 1e6 / (seq.length * w * d));
            const mk = (nn) => ({ deg, seq, w, d, n: nn, pose: ok, gfa: nn * seq.length * g1, cover: (nn * seq.length * w * d) / 1e6 / lotM2 * 100 });
            for (let k = 0; k <= 8 && n - k >= 1; k++) out.push(mk(n - k));
            if (nCap >= 1 && nCap < n - 8) { out.push(mk(nCap)); if (nCap > 1) out.push(mk(nCap - 1)); }
            void cover;
          }
          if (Date.now() > deadline) return out;
        }
      }
    }
  }
  return out;
}

/** Best fit: highest floor area that stands inside the setbacks, parks, and keeps the frontage strip. Null when nothing is found in time. */
function bestFit(project, lot, env, natural, stamp) {
  const t0 = Date.now();
  const base = project.commercial;
  const yard = yardOf(lot);
  const cache = new Map();
  const info = (w, d) => {
    const key = `${w}x${d}`;
    if (!cache.has(key)) {
      const rows = [defaultRow({ count: 1 })];
      rows[0].unit.widthMm = w; rows[0].unit.depthMm = d; rows[0].unit.heightMm = 6000;
      const c = normaliseCommercial({ ...base, rows, waste: null, hydrant: null, parking: { ...base.parking, extra: [] } });
      const st1 = commercialStats({ commercial: c, site: project.site });
      cache.set(key, st1.gfaM2);
      cache.set(`${key}r`, st1.gfaM2 > 0 ? (st1.parking.split.officeSpaces + st1.parking.split.otherSpaces) / st1.gfaM2 : 0);
    }
    return cache.get(key);
  };
  const yardM2 = G.polygonArea(yard) / 1e6;
  const rect2 = (q) => ((q[2] - q[0]) * (q[3] - q[1])) / 1e6;
  // Turns: rows parallel to the frontage (as firstRow places them), parallel to the longest boundary edge, and a quarter turn of each.
  let lng = 0;
  let longest = natural;
  const bd = lot.boundary;
  for (let i = 0; i < bd.length; i++) {
    const a = bd[i];
    const b = bd[(i + 1) % bd.length];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l > lng) { lng = l; longest = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI; }
  }
  const angles = [];
  for (const base0 of [natural, longest]) for (const q of [0, 90]) {
    const deg = Math.round((((base0 + q) % 360) + 360) % 360 * ROUND_DEG) / ROUND_DEG;
    if (!angles.some((x) => Math.abs(((x - deg + 540) % 360) - 180) < 0.5)) angles.push(deg);
  }
  const cands = enumerate(project, lot, env, yard, angles, info, t0 + BF_BUDGET_MS * 0.5);
  if (!cands.length) return null;
  cands.sort((x, y) => (x.cover <= COVER_CAP ? 0 : 1) - (y.cover <= COVER_CAP ? 0 : 1) || y.gfa - x.gfa);
  const verify = verifier(project);
  const park = base.parking;
  const aisle = Number(park.aisleMm) || 5800;
  const seen = new Set();
  let evals = 0;
  for (const c of cands) {
    if (evals >= BF_MAX_EVALS || Date.now() - t0 > BF_BUDGET_MS) break;
    const key = `${c.deg}|${c.seq}|${c.w}|${c.d}|${c.n}|${c.pose.A}|${c.pose.B}`;
    if (seen.has(key)) continue;
    seen.add(key);
    evals += 1;
    const blk = blockOf(c.seq, c.n, c.w, c.d, park);
    // Cheap bound: the bays the rows cannot hold must fit in the yard that is left, at about 14 m2 of paving each plus its share of aisle.
    const reqEst = Math.ceil(c.gfa * cache.get(`${c.w}x${c.d}r`)) - 1;
    const deficitEst = reqEst - blk.rowBays;
    const spare = yardM2 - c.seq.length * c.n * c.w * c.d / 1e6 - blk.apronRects.reduce((t, q) => t + rect2(q), 0) - blk.bayRects.reduce((t, q) => t + rect2(q), 0);
    if (deficitEst > 0 && deficitEst * (park.bayW || 2400) * ((park.bayL || 5400) + aisle) / 1e6 > 0.85 * spare) continue;
    const a = (c.deg * Math.PI) / 180;
    const T = { x: Math.cos(a) * c.pose.A - Math.sin(a) * c.pose.B, y: Math.sin(a) * c.pose.A + Math.cos(a) * c.pose.B };
    const rows = transformRows(rowsOf(blk, c.w, c.d), c.deg, T);
    const mk = (extra) => normaliseCommercial({ ...base, rows, waste: null, hydrant: null, parking: { ...park, extra } });
    const evalStats = (extra) => { const cc = mk(extra); return { cc, st: commercialStats({ commercial: cc, site: project.site }), pk: parkingLayout(cc) }; };
    let extra = [];
    let r = evalStats(extra);
    let tries = 0;
    while (r.st.parking.provided < r.st.parking.required && tries < 3) {
      const need = r.st.parking.required - r.st.parking.provided + 1 + tries;
      const ctx = {
        deg: c.deg, yard, aisle, bayW: park.bayW || 2400, bayL: park.bayL || 5400,
        hard: blk.unitRects.map((q) => place(rectPts(...q), c.deg, T)),
        aprons: blk.apronRects.map((q) => place(rectPts(...q), c.deg, T)),
        bayR: blk.bayRects.map((q) => place(rectPts(...q), c.deg, T)),
      };
      const more = findExtras(need, ctx);
      if (!more) break;
      extra = [...extra, ...more];
      r = evalStats(extra);
      tries += 1;
    }
    if (r.st.parking.provided < r.st.parking.required || r.pk.accessible.provided < r.pk.accessible.required) continue;
    const bayPolys = r.pk.rows.flatMap((x) => x.slots.map((s) => s.poly));
    const unitPolys = layoutUnits(r.cc).map((u) => u.poly);
    if (bayPolys.some((sp) => unitPolys.some((up) => G.convexOverlap(sp, up, 100)))) continue;
    if (bayPolys.some((sp) => sp.some((q) => !insidePoly(q, yard)))) continue;
    if (!verify({ rows }, { deg: 0, T: { x: 0, y: 0 } }) ) continue;
    return {
      id: BEST_ID, label: labelBest(c.seq, units(c)), family: 'multi', size: 'std', count: c.n, rows: r.cc.rows, extra, fits: true, tooBig: false, parkingOk: true, parkingShort: 0,
      gfa: r.st.gfaM2, units: r.st.units, coveragePct: r.st.coveragePct, parking: { provided: r.st.parking.provided, required: r.st.parking.required }, deg: c.deg, unitW: c.w, unitD: c.d, rowCount: c.seq.length, ...stamp,
    };
  }
  return null;
}
const units = (c) => c.n * c.seq.length;
function labelBest(seq, n) {
  const k = seq.length;
  const pairs = (seq.match(/-\+/g) || []).length;
  if (k === 1) return `Single row, ${n} units`;
  if (k === 2 && pairs === 1) return `Back to back, ${n} units`;
  if (k === 2 && seq === '+-') return `Two rows with central apron, ${n} units`;
  return `${k} rows, ${n} units`;
}

// Best fit works with the standard unit (6 x 15 or 18 m, ground office and mezzanine); Large units is its own layout in the switcher.
const BEST_SETS = [
  { family: 'single', size: 'std', max: 16 },
  { family: 'b2b', size: 'std', max: 10 },
  { family: 'court', size: 'std', max: 10 },
];

/**
 * The layout to put on the lot: `id` is 'best' (the most floor area that passes the setbacks, with the bays provided at least the bays
 * needed and the accessible bays met, over every family, unit count and turn) or a template id. When nothing fits the layout is placed
 * centred on the lot and flagged tooBig, so the card reads "Too big for this block". Returns null when there is no lot or no commercial spec.
 */
export function chooseLayout(project, id = BEST_ID) {
  const lot = lotOf(project);
  if (!lot || !isCommercial(project) || !Array.isArray(lot.boundary) || lot.boundary.length < 3 || !(lot.frontEdges || []).length) return null;
  const env = envelopeOf(lot);
  const natural = naturalAngle(lot);
  const tpl = TEMPLATES.find((t) => t.id === id);
  const stamp = { envKey: envKeyOf(lot) };
  const verify = verifier(project);
  if (tpl) {
    const cand = candidate(project, tpl.family, tpl.size, tpl.count);
    cand.label = tpl.label;
    const pose = bestPose(cand, lot, env, natural, verify);
    return { ...result(cand, pose || fallbackPose(cand, env, natural), tpl.id, !!pose), ...stamp };
  }
  const smart = bestFit(project, lot, env, natural, stamp);
  if (smart) return smart;
  const found = [];
  for (const set of BEST_SETS) {
    for (let n = set.max; n >= 1; n--) {
      const cand = candidate(project, set.family, set.size, n);
      if (!cand.parkingOk) continue;
      const pose = bestPose(cand, lot, env, natural, verify);
      if (pose) { found.push({ cand, pose }); break; }
    }
  }
  if (found.length) {
    // The natural turn is kept unless another turn gives clearly more floor area.
    const score = (x) => x.cand.gfa * (x.pose.rank === 0 ? 1 : 0.95);
    found.sort((a, b) => score(b) - score(a) || b.cand.units - a.cand.units);
    return { ...result(found[0].cand, found[0].pose, BEST_ID, true), ...stamp };
  }
  const small = candidate(project, 'single', 'std', 2);
  return { ...result(small, fallbackPose(small, env, natural), BEST_ID, false), ...stamp };
}

/**
 * Put the chosen layout on the project as one undo step. The rows replace the old ones; parking, rates, finishes and every other
 * setting stay. The choice is remembered (c.layout) so the card can say which layout it is and refit when the council setbacks arrive.
 */
export function applyLayout(store, choice) {
  if (!choice) return false;
  store.apply('Change layout', (p) => {
    if (!isCommercial(p)) throw new Error('This design is not in commercial mode.');
    const lot = lotOf(p);
    p.commercial.rows = choice.rows;
    p.commercial.buildings = []; // a strata layout replaces any catalogue building the card put on the lot
    p.commercial.parking = { ...p.commercial.parking, extra: choice.extra || [] };
    p.commercial.layout = { id: choice.id, label: choice.label, tooBig: !!choice.tooBig, envKey: lot ? envKeyOf(lot) : null, sig: rowsSignature(choice.rows) };
    p.commercial = normaliseCommercial(p.commercial);
    materialise(p);
    p.name = choice.label;
  });
  return true;
}

/** True when the rows are still the ones the layout choice put there (nothing was moved or edited since). */
export function layoutUntouched(project) {
  const l = project?.commercial?.layout;
  return !!l && !l.typeId && l.sig === rowsSignature(project.commercial.rows);
}

/** True when the council setbacks have changed since the layout was placed, so the choice should be made again. */
export function setbacksMoved(project) {
  const lot = lotOf(project);
  const l = project?.commercial?.layout;
  return !!(lot && l && l.envKey !== envKeyOf(lot));
}
