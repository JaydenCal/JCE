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
  const c = normaliseCommercial({ ...base, rows, waste: null, hydrant: null });
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
    t.commercial = normaliseCommercial(t.commercial);
    materialise(t);
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
  return { id, label: cand.label, family: cand.family, size: cand.size, count: cand.count, rows: transformRows(cand.rows, pose.deg, pose.T), fits, tooBig: !fits, parkingOk: cand.parkingOk, parkingShort: cand.parkingShort, gfa: cand.gfa, units: cand.units, deg: pose.deg };
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
  return !!l && l.sig === rowsSignature(project.commercial.rows);
}

/** True when the council setbacks have changed since the layout was placed, so the choice should be made again. */
export function setbacksMoved(project) {
  const lot = lotOf(project);
  const l = project?.commercial?.layout;
  return !!(lot && l && l.envKey !== envKeyOf(lot));
}
