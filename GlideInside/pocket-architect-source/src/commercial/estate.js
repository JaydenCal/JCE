// The strata unit estate planner: rows of units AND the one connected sealed pavement network that serves them, designed together.
// Everything is worked out in the lot frame (s along the street frontage, t inward from it) and written out as world polygons:
//
//   crossover(s) from the street (layback and splays, ENTRY / EXIT), the entry drive, the car park in front (bays on cross aisles),
//   the main driveway or aisle between the door faces (12 m or more clear), door aprons and footpaths along every facade, a turning
//   head at the end of every dead end, a footpath from the street to the units, a 3 m landscaped frontage and the balance of a huge lot.
//
// Families: single (one row, drive beside it, bays opposite), double (two rows facing a central aisle), b2b (back to back block with a
// loop drive, separate entry and exit crossovers), u (rows on three sides of a court), and the same single row with large units.
// Pure: no DOM, no three. Plan millimetres, y down. Indicative only: swept paths, sight lines and crossover widths are checked with council.

import * as G from '../model/geometry.js';
import { defaultRow } from './schema.js';
import { clipTo } from './catalogue/pavements/polybool.js';

export const ESTATE_VERSION = 1;
export const MAX_UNITS = 40; // one estate: a huge lot is not built out, the rest is balance land
export const FRONT_LANDSCAPE = 3000;
export const ENTRY_DRIVE = 9000;
export const XOVER_W = 9000; // combined entry and exit, 7 to 9 m
export const XOVER_SPLIT_W = 7000; // separate entry and exit crossovers
export const SPLAY = 2000;
export const VERGE = 3000;
export const FOOT_W = 1500;
export const APRON_W = 3000;
export const CARRIAGE_W = 6000; // two way carriageway between the aprons of a double sided aisle
export const SINGLE_CARRIAGE = 7500;
export const AISLE_DOUBLE = 2 * (FOOT_W + APRON_W) + CARRIAGE_W; // 15 m between the door faces
export const AISLE_SINGLE = FOOT_W + APRON_W + SINGLE_CARRIAGE; // 12 m from the door face to the bay ends opposite
export const COURT_W = 2 * (FOOT_W + APRON_W) + 9000; // 18 m
export const TURN_HEAD = 12000;
export const BAY_W = 2400;
export const BAY_L = 5400;
export const CAR_AISLE = 6000;
const BANK = BAY_L + CAR_AISLE + BAY_L;

const r0 = Math.round;

// Frame ---------------------------------------------------------------------------------------------------------------------------------
export function frameOf(lot) {
  const b = lot.boundary;
  const e0 = (lot.frontEdges || [])[0] ?? 0;
  const a = b[e0];
  const c = b[(e0 + 1) % b.length];
  const L = Math.hypot(c.x - a.x, c.y - a.y) || 1;
  const u = { x: (c.x - a.x) / L, y: (c.y - a.y) / L };
  let n = { x: -u.y, y: u.x };
  const cx = b.reduce((s, q) => s + q.x, 0) / b.length;
  const cy = b.reduce((s, q) => s + q.y, 0) / b.length;
  if ((cx - a.x) * n.x + (cy - a.y) * n.y < 0) n = { x: -n.x, y: -n.y };
  return { o: a, u, n };
}
export const toFrame = (f, p) => ({ s: (p.x - f.o.x) * f.u.x + (p.y - f.o.y) * f.u.y, t: (p.x - f.o.x) * f.n.x + (p.y - f.o.y) * f.n.y });
export const toWorld = (f, s, t) => ({ x: r0(f.o.x + f.u.x * s + f.n.x * t), y: r0(f.o.y + f.u.y * s + f.n.y * t) });
const rect = (f, s0, s1, t0, t1) => [toWorld(f, s0, t0), toWorld(f, s1, t0), toWorld(f, s1, t1), toWorld(f, s0, t1)];

const distSeg = (p, a, b) => {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
const insidePoly = (p, poly, tol = 5) => G.pointInPolygon(p, poly) || poly.some((a, i) => distSeg(p, a, poly[(i + 1) % poly.length]) <= tol);

/** The lot polygon with the frontage moved in by `front` and every other edge by `side` (the area pavement may use). Convex clip. */
export function yardPoly(lot, front = FRONT_LANDSCAPE, side = 150) {
  let poly = lot.boundary.map((q) => ({ x: q.x, y: q.y }));
  const n = lot.boundary.length;
  const cx = lot.boundary.reduce((t, q) => t + q.x, 0) / n;
  const cy = lot.boundary.reduce((t, q) => t + q.y, 0) / n;
  const fronts = new Set((lot.frontEdges || []).filter((e) => Number.isInteger(e) && e >= 0 && e < n));
  for (let e = 0; e < n; e++) {
    const m = fronts.has(e) ? front : side;
    const a = lot.boundary[e];
    const b = lot.boundary[(e + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = -(b.y - a.y) / len;
    let ny = (b.x - a.x) / len;
    if ((cx - a.x) * nx + (cy - a.y) * ny < 0) { nx = -nx; ny = -ny; }
    const d = (p) => (p.x - a.x) * nx + (p.y - a.y) * ny - m;
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]; const q = poly[(i + 1) % poly.length];
      const dp = d(p); const dq = d(q);
      if (dp >= 0) out.push(p);
      if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }); }
    }
    if (out.length >= 3) poly = out;
  }
  return poly;
}

// Rows ----------------------------------------------------------------------------------------------------------------------------------
/**
 * A row of `count` units of w x d that fills the frame rectangle [s0, s1] x [t0, t1] with its fronts facing `face` ('+s', '-s', '+t', '-t').
 * The row frame turns the front (v) to the facing direction and runs along u = v turned a quarter turn the other way.
 */
function rowFor(f, face, s0, s1, t0, t1, count, spec) {
  const dirs = { '+s': f.u, '-s': { x: -f.u.x, y: -f.u.y }, '+t': f.n, '-t': { x: -f.n.x, y: -f.n.y } };
  const F = dirs[face];
  const u = { x: F.y, y: -F.x }; // v = u turned +90 degrees must equal F
  const corners = [toWorld(f, s0, t0), toWorld(f, s1, t0), toWorld(f, s1, t1), toWorld(f, s0, t1)];
  let o = corners[0];
  // the origin is the corner least along u and least along F (the rear left of the row)
  const key = (c) => [c.x * u.x + c.y * u.y, c.x * F.x + c.y * F.y];
  o = corners.reduce((best, c) => { const a = key(c); const b = key(best); return a[0] < b[0] - 1 || (Math.abs(a[0] - b[0]) <= 1 && a[1] < b[1] - 1) ? c : best; }, corners[0]);
  const row = defaultRow({ count, x: o.x, y: o.y, rotationDeg: Math.round(((Math.atan2(u.y, u.x) * 180) / Math.PI) * 1000) / 1000 });
  row.unit.widthMm = spec.w;
  row.unit.depthMm = spec.d;
  row.unit.heightMm = spec.h || 6000;
  if (spec.doors) Object.assign(row.unit.doors, spec.doors);
  if (spec.plain) { row.unit.office.enabled = false; row.unit.mezzanine.enabled = false; }
  row.bays = false; // the estate places every bay on its own pavement network
  return row;
}

/** A strip of bays in the frame: the rectangle [s0,s1]x[t0,t1] holds the bays (5.4 deep), the aisle lies on the side opposite `face`. */
function bayStrip(f, axis, a0, a1, b0, b1, ext, count) {
  // axis 's': bays run along s over [a0,a1], depth over t [b0,b1] extending toward ext (+1 or -1 along t)
  // axis 't': bays run along t over [a0,a1], depth over s [b0,b1] extending toward ext (+1 or -1 along s)
  const F = axis === 's' ? { x: f.n.x * ext, y: f.n.y * ext } : { x: f.u.x * ext, y: f.u.y * ext };
  const u = { x: F.y, y: -F.x };
  const edge = ext > 0 ? b0 : b1; // the origin line where the bays start (the aisle edge)
  const corners = axis === 's' ? [toWorld(f, a0, edge), toWorld(f, a1, edge)] : [toWorld(f, edge, a0), toWorld(f, edge, a1)];
  const o = (corners[0].x * u.x + corners[0].y * u.y) <= (corners[1].x * u.x + corners[1].y * u.y) ? corners[0] : corners[1];
  return { x: o.x, y: o.y, rotationDeg: Math.round(((Math.atan2(u.y, u.x) * 180) / Math.PI) * 1000) / 1000, count };
}
const nBays = (len) => Math.max(0, Math.floor(len / BAY_W + 1e-9));

// Family builders -----------------------------------------------------------------------------------------------------------------------
// Each returns { elements } in the local frame (a = s relative to the spine at 0, t absolute) as plain descriptions, which the planner
// moves by `sc` (the spine position along the frontage) and writes out.

/** Front car park: `nb` banks of bay row, cross aisle, bay row, from the landscape strip inward. Returns { t1, paved, bays }. */
function frontZone(nb, aL, aR, gapL, gapR, opts = {}) {
  const paved = [];
  const bays = [];
  for (let k = 0; k < nb; k++) {
    const t0 = FRONT_LANDSCAPE + k * BANK;
    const tAisle0 = t0 + BAY_L;
    const tAisle1 = tAisle0 + CAR_AISLE;
    paved.push({ role: 'aisle', a0: aL, a1: aR, t0: tAisle0, t1: tAisle1, id: `xaisle:${k}` });
    // bay rows north (against the aisle's near side) and south (far side), either side of the spine
    for (const [side, from, to] of [['W', aL, gapL], ['E', gapR, aR]]) {
      const len = to - from;
      const c = nBays(len);
      if (c < 1) continue;
      const a0 = side === 'W' ? to - c * BAY_W : from;
      const a1 = a0 + c * BAY_W;
      bays.push({ axis: 's', a0, a1, b0: t0, b1: tAisle0, ext: -1, count: c, zone: `W${k}n`, side });
      bays.push({ axis: 's', a0, a1, b0: tAisle1, b1: tAisle1 + BAY_L, ext: +1, count: c, zone: `W${k}s`, side });
    }
  }
  return { t1: nb ? FRONT_LANDSCAPE + nb * BANK : FRONT_LANDSCAPE, paved, bays, ...opts };
}

/** The local description of an estate. `p` = { family, w, d, n, nb, h, doors, plain, widthCap }. */
export function describe(p) {
  const { family, w, d, n, nb } = p;
  const L = n * w;
  const E = { units: [], paved: [], aprons: [], foot: [], bays: [], aisles: [], landscape: [], xovers: [], head: null, aisleMm: 0, notes: [] };
  const cpHalf = (p.cpWidth || 64000) / 2;
  const gapW = -(ENTRY_DRIVE / 2);
  const gapE = ENTRY_DRIVE / 2 + FOOT_W;
  const zone = (aL, aR, gl, gr) => frontZone(nb, aL, aR, gl, gr);
  let T0;
  if (family === 'double') {
    const half = AISLE_DOUBLE / 2;
    const fz = zone(-cpHalf, cpHalf, gapW, gapE);
    T0 = fz.t1 + (nb ? FOOT_W : 0);
    E.aisleMm = AISLE_DOUBLE;
    E.xovers.push({ role: 'both', a: 0, w: XOVER_W });
    E.units.push({ face: '+s', a0: -(half + d), a1: -half, t0: T0, t1: T0 + L, n });
    E.units.push({ face: '-s', a0: half, a1: half + d, t0: T0, t1: T0 + L, n });
    E.paved.push({ role: 'aisle', a0: -ENTRY_DRIVE / 2, a1: ENTRY_DRIVE / 2, t0: -0, t1: T0, id: 'entry' });
    E.paved.push({ role: 'aisle', a0: -CARRIAGE_W / 2, a1: CARRIAGE_W / 2, t0: T0, t1: T0 + L, id: 'carriage' });
    E.aprons.push({ a0: -half, a1: -CARRIAGE_W / 2, t0: T0, t1: T0 + L, id: 'apron:w' });
    E.aprons.push({ a0: CARRIAGE_W / 2, a1: half, t0: T0, t1: T0 + L, id: 'apron:e' });
    E.paved.push({ role: 'aisle', a0: -half - 6000, a1: half + 6000, t0: T0 + L, t1: T0 + L + TURN_HEAD, id: 'head' });
    E.head = { t0: T0 + L, t1: T0 + L + TURN_HEAD };
    E.aisles.push({ a: 0, t0: 0, t1: T0 + L });
    E.span = [-(half + d), half + d];
    E.tEnd = T0 + L + TURN_HEAD;
    E.fz = fz;
    E.pedA = ENTRY_DRIVE / 2 + FOOT_W / 2;
    E.cross = { a0: -half, a1: half, t0: T0 - FOOT_W, t1: T0 };
  } else if (family === 'single' || family === 'large') {
    const big = family === 'large';
    const aisle = big ? 15000 : AISLE_SINGLE; // large units: a 15 m aisle for bigger trucks
    const aF = -ENTRY_DRIVE / 2 + aisle; // the facade
    const fz = zone(-cpHalf, cpHalf, gapW, gapE);
    T0 = fz.t1 + (nb ? FOOT_W : 0);
    E.aisleMm = aisle;
    E.xovers.push({ role: 'both', a: 0, w: XOVER_W });
    E.units.push({ face: '-s', a0: aF, a1: aF + d, t0: T0, t1: T0 + L, n });
    E.paved.push({ role: 'aisle', a0: -ENTRY_DRIVE / 2, a1: ENTRY_DRIVE / 2, t0: 0, t1: T0, id: 'entry' });
    E.paved.push({ role: 'aisle', a0: -ENTRY_DRIVE / 2, a1: aF - FOOT_W - APRON_W, t0: T0, t1: T0 + L, id: 'carriage' });
    E.aprons.push({ a0: aF - FOOT_W - APRON_W, a1: aF, t0: T0, t1: T0 + L, id: 'apron' });
    // bays opposite the doors, along the whole row
    const c = nBays(L);
    if (c > 0) E.bays.push({ axis: 't', a0: T0, a1: T0 + c * BAY_W, b0: -ENTRY_DRIVE / 2 - BAY_L, b1: -ENTRY_DRIVE / 2, ext: -1, count: c, zone: 'opp', side: 'W' });
    E.paved.push({ role: 'aisle', a0: -ENTRY_DRIVE / 2 - BAY_L - 1000, a1: aF, t0: T0 + L, t1: T0 + L + TURN_HEAD, id: 'head' });
    E.head = { t0: T0 + L, t1: T0 + L + TURN_HEAD };
    E.aisles.push({ a: 0, t0: 0, t1: T0 + L });
    E.span = [-ENTRY_DRIVE / 2 - BAY_L - 1000, aF + d];
    E.tEnd = T0 + L + TURN_HEAD;
    E.fz = fz;
    E.pedA = ENTRY_DRIVE / 2 + FOOT_W / 2;
    E.cross = { a0: ENTRY_DRIVE / 2, a1: aF, t0: T0 - FOOT_W, t1: T0 };
  } else if (family === 'b2b') {
    // Back to back block with a 12 m drive down each side and a loop round the rear: entry on the west drive, exit on the east.
    const dr = AISLE_SINGLE;
    const aw = -d - dr + 3750; // centre of the west carriageway
    const ae = d + dr - 3750;
    const gl = aw + XOVER_SPLIT_W / 2;
    const gr = ae - XOVER_SPLIT_W / 2;
    const fz = nb ? frontZone(nb, gl, gr, gl, gl) : frontZone(0, gl, gr, gl, gl); // one run between the two drives
    // frontZone puts bays either side of a gap; here the car park sits between the drives with no gap
    const fz2 = { t1: nb ? FRONT_LANDSCAPE + nb * BANK : FRONT_LANDSCAPE, paved: [], bays: [] };
    for (let k = 0; k < nb; k++) {
      const t0 = FRONT_LANDSCAPE + k * BANK;
      const c = nBays(gr - gl - FOOT_W);
      fz2.paved.push({ role: 'aisle', a0: gl - 2000, a1: gr + 2000, t0: t0 + BAY_L, t1: t0 + BAY_L + CAR_AISLE, id: `xaisle:${k}` });
      if (c > 0) {
        const a0 = gl + FOOT_W;
        fz2.bays.push({ axis: 's', a0, a1: a0 + c * BAY_W, b0: t0, b1: t0 + BAY_L, ext: -1, count: c, zone: `m${k}n`, side: 'E' });
        fz2.bays.push({ axis: 's', a0, a1: a0 + c * BAY_W, b0: t0 + BAY_L + CAR_AISLE, b1: t0 + BANK, ext: +1, count: c, zone: `m${k}s`, side: 'E' });
      }
    }
    void fz;
    T0 = fz2.t1 + (nb ? FOOT_W : 0);
    E.aisleMm = dr;
    E.xovers.push({ role: 'in', a: aw, w: XOVER_SPLIT_W });
    E.xovers.push({ role: 'out', a: ae, w: XOVER_SPLIT_W });
    E.units.push({ face: '-s', a0: -d, a1: 0, t0: T0, t1: T0 + L, n });
    E.units.push({ face: '+s', a0: 0, a1: d, t0: T0, t1: T0 + L, n });
    for (const sgn of [-1, 1]) {
      const aF = sgn * d; // the facade
      const nm = sgn < 0 ? 'w' : 'e';
      const lo = (x) => Math.min(x, x);
      void lo;
      E.aprons.push({ a0: sgn < 0 ? aF - FOOT_W - APRON_W : aF, a1: sgn < 0 ? aF : aF + FOOT_W + APRON_W, t0: T0, t1: T0 + L, id: `apron:${nm}` });
      E.paved.push({ role: 'aisle', a0: sgn < 0 ? aF - dr : aF + FOOT_W + APRON_W, a1: sgn < 0 ? aF - FOOT_W - APRON_W : aF + dr, t0: T0, t1: T0 + L, id: `carriage:${nm}` });
      E.paved.push({ role: 'aisle', a0: (sgn < 0 ? aw : ae) - XOVER_SPLIT_W / 2, a1: (sgn < 0 ? aw : ae) + XOVER_SPLIT_W / 2, t0: 0, t1: T0, id: `entry:${nm}` });
      E.aisles.push({ a: sgn < 0 ? aw : ae, t0: 0, t1: T0 + L });
    }
    E.paved.push({ role: 'aisle', a0: aw - XOVER_SPLIT_W / 2, a1: ae + XOVER_SPLIT_W / 2, t0: T0 + L, t1: T0 + L + TURN_HEAD, id: 'rear' });
    E.rearAisle = { a0: aw, a1: ae, t: T0 + L + TURN_HEAD / 2 };
    E.span = [aw - XOVER_SPLIT_W / 2, ae + XOVER_SPLIT_W / 2];
    E.tEnd = T0 + L + TURN_HEAD;
    E.fz = fz2;
    E.pedA = aw + XOVER_SPLIT_W / 2 + FOOT_W / 2;
    E.cross = { a0: aw + XOVER_SPLIT_W / 2, a1: ae - XOVER_SPLIT_W / 2, t0: T0 - FOOT_W, t1: T0 };
    E.crossFull = { a0: -d - FOOT_W, a1: d + FOOT_W };
  } else if (family === 'wide') {
    // A row ACROSS the frontage for a narrow lot, where a drive beside the row (the single family needs about 18 m plus the unit depth) cannot
    // fit: the car park bank(s) at the front, the one entry drive, a cross aisle with the door apron and footpath, then the units with their
    // fronts to the street. The cross aisle runs on past the row to a turning area at its east end.
    const half = L / 2;
    const fz = zone(-cpHalf, cpHalf, gapW, gapE);
    T0 = fz.t1 + (nb ? FOOT_W : 0);
    const tF = T0 + AISLE_SINGLE; // the facade
    const aEast = Math.max(half, ENTRY_DRIVE / 2) + TURN_HEAD / 2;
    const aWest = -Math.max(half, ENTRY_DRIVE / 2);
    E.aisleMm = SINGLE_CARRIAGE;
    E.xovers.push({ role: 'both', a: 0, w: XOVER_W });
    E.units.push({ face: '-t', a0: -half, a1: half, t0: tF, t1: tF + d, n });
    E.paved.push({ role: 'aisle', a0: -ENTRY_DRIVE / 2, a1: ENTRY_DRIVE / 2, t0: 0, t1: T0, id: 'entry' });
    E.paved.push({ role: 'aisle', a0: aWest, a1: aEast, t0: T0, t1: T0 + SINGLE_CARRIAGE, id: 'cross' });
    E.aprons.push({ a0: -half, a1: half, t0: T0 + SINGLE_CARRIAGE, t1: tF - FOOT_W, id: 'apron' });
    E.foot.push({ a0: -half, a1: half, t0: tF - FOOT_W, t1: tF });
    E.head = { t0: T0, t1: T0 + SINGLE_CARRIAGE };
    E.aisles.push({ a: 0, t0: 0, t1: T0 + SINGLE_CARRIAGE / 2 });
    E.span = [aWest, aEast];
    E.tEnd = tF + d;
    E.fz = fz;
    E.pedA = ENTRY_DRIVE / 2 + FOOT_W / 2;
    E.cross = null;
  } else if (family === 'u') {
    const cw = Math.ceil(COURT_W / w) * w; // the rear row fills the court between the two side rows
    const half = cw / 2;
    const fz = zone(-cpHalf, cpHalf, gapW, gapE);
    T0 = fz.t1 + (nb ? FOOT_W : 0);
    const nr = cw / w;
    const Wr = cw;
    E.aisleMm = cw;
    E.xovers.push({ role: 'both', a: 0, w: XOVER_W });
    E.units.push({ face: '+s', a0: -(half + d), a1: -half, t0: T0, t1: T0 + L, n });
    E.units.push({ face: '-s', a0: half, a1: half + d, t0: T0, t1: T0 + L, n });
    E.units.push({ face: '-t', a0: -Wr / 2, a1: Wr / 2, t0: T0 + L, t1: T0 + L + d, n: nr });
    E.paved.push({ role: 'aisle', a0: -ENTRY_DRIVE / 2, a1: ENTRY_DRIVE / 2, t0: 0, t1: T0, id: 'entry' });
    E.paved.push({ role: 'aisle', a0: -(half - FOOT_W - APRON_W), a1: half - FOOT_W - APRON_W, t0: T0, t1: T0 + L - FOOT_W - APRON_W, id: 'court' });
    E.aprons.push({ a0: -half, a1: -(half - FOOT_W - APRON_W), t0: T0, t1: T0 + L - FOOT_W - APRON_W, id: 'apron:w' });
    E.aprons.push({ a0: half - FOOT_W - APRON_W, a1: half, t0: T0, t1: T0 + L - FOOT_W - APRON_W, id: 'apron:e' });
    E.aprons.push({ a0: -half, a1: half, t0: T0 + L - FOOT_W - APRON_W, t1: T0 + L, id: 'apron:r' });
    E.head = { t0: T0, t1: T0 + L };
    E.aisles.push({ a: 0, t0: 0, t1: T0 + L - FOOT_W - APRON_W });
    E.span = [-(half + d), half + d];
    E.tEnd = T0 + L + d;
    E.fz = fz;
    E.pedA = ENTRY_DRIVE / 2 + FOOT_W / 2;
    E.cross = { a0: -half, a1: half, t0: T0 - FOOT_W, t1: T0 };
  }
  E.T0 = T0;
  E.cpHalf = cpHalf;
  E.unitCount = E.units.reduce((s, r) => s + r.n, 0);
  return E;
}

// Placement -----------------------------------------------------------------------------------------------------------------------------
const cornersOf = (E, sc, r) => [[r.a0, r.t0], [r.a1, r.t0], [r.a1, r.t1], [r.a0, r.t1]].map(([a, t]) => ({ s: sc + a, t }));

/** Does the estate fit with its spine at `sc`: units in the envelope, pavement and bays in the yard (frame check on the polygons). */
export function fitsAt(E, sc, f, env, yard, lot) {
  const w = (s, t) => toWorld(f, s, t);
  for (const r of E.units) {
    const depthAx = r.face === '-t' ? 't' : 's';
    void depthAx;
    for (const q of cornersOf(E, sc, r)) if (!insidePoly(w(q.s, q.t), env)) return false;
  }
  const pave = [...E.paved, ...E.aprons, ...E.foot, ...(E.fz?.paved || [])];
  for (const r of pave) {
    const inFront = r.t0 < FRONT_LANDSCAPE - 1; // the entry drive and the pedestrian path cross the landscaped frontage
    for (const q of cornersOf(E, sc, r)) if (!insidePoly(w(q.s, q.t), inFront ? lot.boundary : yard, inFront ? 5 : 200)) return false;
  }
  for (const b of [...E.bays, ...(E.fz?.bays || [])]) {
    const a0 = b.axis === 's' ? sc + b.a0 : sc + b.b0;
    const a1 = b.axis === 's' ? sc + b.a1 : sc + b.b1;
    const t0 = b.axis === 's' ? b.b0 : b.a0;
    const t1 = b.axis === 's' ? b.b1 : b.a1;
    for (const q of [[a0, t0], [a1, t0], [a1, t1], [a0, t1]]) if (!insidePoly(w(q[0], q[1]), yard, 200)) return false;
  }
  return true;
}

/**
 * Write the estate out in world coordinates: { rows, extra (parking.extra), network } where network holds the polygons siteWorks uses.
 * `sc` is the spine position along the frontage (frame s).
 */
export function realise(E, sc, f, spec, lot) {
  const W = (s, t) => toWorld(f, s, t);
  const R = (r, id) => ({ id, polygon: rect(f, sc + r.a0, sc + r.a1, r.t0, r.t1) });
  const rows = E.units.map((r) => rowFor(f, r.face, sc + r.a0, sc + r.a1, r.t0, r.t1, r.n, spec));
  const extra = [];
  const bayPolys = [];
  for (const b of [...(E.fz?.bays || []), ...E.bays]) {
    const shift = { ...b };
    if (b.axis === 's') { shift.a0 = sc + b.a0; shift.a1 = sc + b.a1; } else { shift.b0 = sc + b.b0; shift.b1 = sc + b.b1; }
    extra.push(bayStrip(f, b.axis, shift.a0, shift.a1, shift.b0, shift.b1, b.ext, b.count));
    bayPolys.push({ id: `bays:${extra.length}`, polygon: b.axis === 's' ? rect(f, shift.a0, shift.a1, b.ext > 0 ? shift.b0 : shift.b0, shift.b1) : rect(f, shift.b0, shift.b1, shift.a0, shift.a1) });
  }
  // order the bay strips nearest the entrance first (the accessible bays go on the first strip with room)
  const order = extra.map((e, i) => ({ e, i, d: Math.hypot(toFrame(f, e).s - sc, toFrame(f, e).t) }));
  order.sort((p, q) => p.d - q.d);
  const extraSorted = order.map((x) => x.e);
  const paved = [];
  let k = 0;
  for (const r of [...(E.fz?.paved || []), ...E.paved]) paved.push({ id: `sw:paved:${k++}`, polygon: R(r).polygon, role: r.role, name: r.id });
  const aprons = E.aprons.map((r, i) => ({ id: `sw:apron:${i}`, buildingId: null, polygon: R(r).polygon }));
  const foot = E.foot.map((r, i) => ({ id: `sw:foot:${i}`, buildingId: null, polygon: R(r).polygon }));
  // the pedestrian link: street footpath edge, down beside the entry drive, across to the facade footpaths
  const pa = sc + E.pedA;
  const pedW = FOOT_W;
  const T0 = E.T0;
  foot.push({ id: `sw:foot:${foot.length}`, buildingId: null, pedestrian: true, polygon: rect(f, pa - pedW / 2, pa + pedW / 2, -VERGE, T0 - 0) });
  if (E.cross) foot.push({ id: `sw:foot:${foot.length}`, buildingId: null, polygon: rect(f, sc + E.cross.a0, sc + E.cross.a1, E.cross.t0, E.cross.t1) });
  // crossovers
  const crossovers = E.xovers.map((x, i) => {
    const s = sc + x.a;
    const half = x.w / 2;
    const polygon = [W(s - half - SPLAY, -VERGE), W(s + half + SPLAY, -VERGE), W(s + half, 0), W(s - half, 0)];
    const p = W(s, 0);
    return { id: `sw:xover:${i}`, x: p.x, y: p.y, widthMm: x.w, role: x.role, dir: { x: -f.n.x, y: -f.n.y }, polygon, splayMm: SPLAY, laybackMm: x.w + 2 * SPLAY };
  });
  // aisle centre lines (two way arrows)
  const aisles = E.aisles.map((a, i) => ({ id: `sw:aisle:${i}`, polygon: rect(f, sc + a.a - 100, sc + a.a + 100, a.t0, a.t1), centre: [W(sc + a.a, a.t0), W(sc + a.a, a.t1)], widthMm: E.aisleMm, kind: 'aisle' }));
  if (E.rearAisle) aisles.push({ id: `sw:aisle:${aisles.length}`, polygon: rect(f, sc + E.rearAisle.a0, sc + E.rearAisle.a1, E.rearAisle.t - 100, E.rearAisle.t + 100), centre: [W(sc + E.rearAisle.a0, E.rearAisle.t), W(sc + E.rearAisle.a1, E.rearAisle.t)], widthMm: TURN_HEAD, kind: 'aisle' });
  // landscape: the frontage strip either side of the crossover(s), and the ground beside the entry drive when there is no car park
  const land = [];
  const gaps = E.xovers.map((x) => [sc + x.a - x.w / 2 - SPLAY - 500, sc + x.a + x.w / 2 + SPLAY + 500]).sort((p, q) => p[0] - q[0]);
  const sA = sc + E.span[0] - 3000; const sB = sc + E.span[1] + 3000;
  const fp = lot.boundary.map((q) => toFrame(f, q));
  const sLo = Math.max(Math.min(...fp.map((q) => q.s)), sA); const sHi = Math.min(Math.max(...fp.map((q) => q.s)), sB);
  let cur = sLo;
  const strip = (s0, s1) => { if (s1 - s0 > 1200) land.push({ id: `sw:land:${land.length}`, polygon: rect(f, s0, s1, 0, FRONT_LANDSCAPE - 300) }); };
  for (const [a, b] of gaps) { strip(cur, Math.min(a, sHi)); cur = Math.max(cur, b); }
  strip(cur, sHi);
  // the front ground between the strip and the units (no car park, or the part beside the spine) is landscaped
  const frontLen = E.fz?.t1 ?? FRONT_LANDSCAPE;
  void frontLen;
  const window = { s0: sc + E.span[0], s1: sc + E.span[1], t1: E.tEnd };
  return { rows, extra: extraSorted, network: { paved, aprons, foot, crossovers, aisles, landscape: land, bayPolys, window } };
}

/** Where the estate is: a rectangle in the lot frame, for the balance of lot. */
export function balanceOf(window, f, lot) {
  const fp = lot.boundary.map((q) => toFrame(f, q));
  const sLo = Math.min(...fp.map((q) => q.s)); const sHi = Math.max(...fp.map((q) => q.s)); const tHi = Math.max(...fp.map((q) => q.t));
  const m = 10000;
  const polys = [];
  const w0 = window.s0 - m; const w1 = window.s1 + m; const wt = window.t1 + m;
  const add = (s0, s1, t0, t1) => {
    if (s1 - s0 <= 5000 || t1 - t0 <= 5000) return;
    let pieces = [];
    try { pieces = clipTo(rect(f, s0, s1, t0, t1), lot.boundary); } catch { pieces = [rect(f, s0, s1, t0, t1)]; }
    for (const pc of pieces) if (pc.length >= 3) polys.push(pc);
  };
  add(sLo, sHi, wt, tHi); // behind the estate
  add(sLo, w0, 0, wt); // beside it
  add(w1, sHi, 0, wt);
  let area = 0;
  for (const p of polys) area += Math.abs(G.polygonArea(p)) / 1e6;
  return { polygons: polys, areaM2: Math.round(area), label: 'BALANCE OF LOT' };
}

/** The signature of a set of rows: what an estate network was drawn for. A moved or edited row makes the network stale. */
export const rowsSignature = (rows) => JSON.stringify((rows || []).map((r) => [r.x, r.y, r.rotationDeg, r.count, r.mirrorOf ? 1 : 0, r.unit?.widthMm, r.unit?.depthMm]));

// Planner -------------------------------------------------------------------------------------------------------------------------------
const envelopeOf = (lot) => (Array.isArray(lot.envelope) && lot.envelope.length >= 3 ? lot.envelope : lot.boundary);
const CP_WIDTHS = [64000, 52000, 40000, 30000, 24000, 20000]; // the narrowest banks serve a narrow lot

/**
 * Find where the estate described by `p` ({ family, w, d, n, nb, ... }) stands on the lot: the spine position `sc` (frame s) at which the
 * units are inside the setback envelope and every pavement and bay is inside the lot, centred first. `edit` is project.commercial.accessEdit
 * (a dragged entry offset wins). Returns { E, sc, f } or null.
 */
export function placeEstate(lot, p, edit = null) {
  const f = frameOf(lot);
  const env = envelopeOf(lot);
  const yard = yardPoly(lot);
  const fp = env.map((q) => toFrame(f, q));
  const e0 = Math.min(...fp.map((q) => q.s)); const e1 = Math.max(...fp.map((q) => q.s));
  const widths = p.nb > 0 && p.family !== 'b2b' ? CP_WIDTHS : [64000];
  for (const cpWidth of widths) {
    const E = describe({ ...p, cpWidth });
    const lo = e0 - E.span[0] - 3000; const hi = e1 - E.span[1] + 3000;
    if (lo > hi) continue;
    const cands = [];
    const edited = Number.isFinite(edit?.in?.offsetMm) ? edit.in.offsetMm - (E.xovers[0]?.a || 0) : null;
    if (edited != null) cands.push(edited);
    for (const k of [0.5, 0, 1, 0.25, 0.75]) cands.push(Math.round((lo + (hi - lo) * k) / 50) * 50);
    for (const sc of cands) if (fitsAt(E, sc, f, env, yard, lot)) return { E, sc, f, cpWidth };
  }
  return null;
}

/** The unit spec an estate row takes: the standard unit (ground office and mezzanine) or the large plain unit. */
export const SPECS = Object.freeze({
  std: (w, d) => ({ w, d, h: 6000 }),
  large: () => ({ w: 10000, d: 30000, h: 8000, doors: { presetId: '4.5x5.0', widthMm: 4500, heightMm: 5000 }, plain: true }),
});
