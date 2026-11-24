// Subdivision check: a rough lot layout and an indicative lot count for one cadastre lot. Pure, no DOM. Plan millimetres, y down.
//
// Everything is worked out in a frame set by the street frontage: s runs along the frontage, t runs inward from it. Three layouts are tried and
// the one that gives the most lots wins (a tie goes to the simpler layout):
//
//   frontage   lots side by side along the street, each with its own frontage
//   battleaxe  a row of lots on the street, a 4 m access handle beside them, and rear lots reached by the handle
//   road       a new road in from the street with lots either side, a turning head and lots across the end
//
// Rules used: every lot has at least the minimum area and the minimum frontage (the battle-axe handle is not counted in the area of its lot).
// Nothing here knows about flooding, easements, existing buildings, trees, levels or services. It is a count for a first conversation, not a design.

import { clipTo, boolean, orient } from '../commercial/catalogue/pavements/polybool.js';
import { polyArea } from '../commercial/catalogue/pavements/geom.js';

export const ROAD_W_MM = 15000; // new road reserve (a rough width for a quiet street)
export const HANDLE_W_MM = 4000; // battle-axe access handle
export const JUNCTION_CLEAR_MM = 20000; // the new road meets the street at right angles at least this far from a lot corner
export const VERGE_MM = 3500; // footpath and verge strip each side inside a new road reserve (drawn, never printed as a number)
export const HEAD_R_MM = 9000; // turning head radius
export const KINDS = Object.freeze(['frontage', 'battleaxe', 'road']);
export const KIND_TEXT = Object.freeze({
  frontage: 'Lots side by side along the street',
  battleaxe: 'Lots on the street and rear lots by a battle-axe access',
  road: 'New road with lots either side',
  none: 'No further subdivision indicated',
});

const M2 = 1e6;
const PAD = 1000; // a clip edge must sit clear of the lot edge it is meant to pass (the boolean treats edges within 1 mm as touching)
const areaOf = (ring) => Math.abs(polyArea(ring));

// Frame ---------------------------------------------------------------------------------------------------------------------------------
/** Pick the street edge: the longest of the lot's confirmed or detected front edges, else the longest edge. Returns its index. */
export function frontEdgeIndex(lot) {
  const b = lot.boundary;
  const n = b.length;
  const len = (i) => Math.hypot(b[(i + 1) % n].x - b[i].x, b[(i + 1) % n].y - b[i].y);
  const cands = (lot.frontEdges || []).filter((i) => i >= 0 && i < n);
  const pool = cands.length ? cands : b.map((_, i) => i);
  return pool.reduce((best, i) => (len(i) > len(best) ? i : best), pool[0]);
}

/** The frame: origin at the start of the front edge, u along it, n pointing into the lot. */
export function frameOf(lot, edge = frontEdgeIndex(lot)) {
  const b = lot.boundary;
  const a = b[edge];
  const c = b[(edge + 1) % b.length];
  const L = Math.hypot(c.x - a.x, c.y - a.y) || 1;
  const u = { x: (c.x - a.x) / L, y: (c.y - a.y) / L };
  let n = { x: -u.y, y: u.x };
  const cx = b.reduce((s, p) => s + p.x, 0) / b.length;
  const cy = b.reduce((s, p) => s + p.y, 0) / b.length;
  if ((cx - a.x) * n.x + (cy - a.y) * n.y < 0) n = { x: -n.x, y: -n.y };
  const f = { o: { x: a.x, y: a.y }, u, n, edge };
  f.toFrame = (p) => ({ x: (p.x - f.o.x) * u.x + (p.y - f.o.y) * u.y, y: (p.x - f.o.x) * n.x + (p.y - f.o.y) * n.y }); // x is s, y is t
  f.toPlan = (p) => ({ x: Math.round(f.o.x + u.x * p.x + n.x * p.y), y: Math.round(f.o.y + u.y * p.x + n.y * p.y) });
  return f;
}

const rectRing = (s0, t0, s1, t1) => [{ x: s0, y: t0 }, { x: s1, y: t0 }, { x: s1, y: t1 }, { x: s0, y: t1 }];
const circleRing = (cx, cy, r, n = 28) => Array.from({ length: n }, (_, i) => ({ x: Math.round(cx + r * Math.cos((i / n) * 2 * Math.PI)), y: Math.round(cy + r * Math.sin((i / n) * 2 * Math.PI)) }));
const orientOne = (ring) => orient([ring])[0];

/** Clip a rectangle to the lot: the pieces (rings), the largest first. */
function clipRect(lotRing, r) {
  let pieces = [];
  try { pieces = clipTo(orientOne(r), lotRing); } catch { pieces = []; }
  return pieces.filter((p) => p.length >= 3).sort((a, b) => areaOf(b) - areaOf(a));
}

const extentOf = (ring, key) => { let lo = Infinity; let hi = -Infinity; for (const p of ring) { lo = Math.min(lo, p[key]); hi = Math.max(hi, p[key]); } return { lo, hi, span: hi - lo }; };
/** Width (mm) of the piece measured along `along` for the points within `band` of its `edgeKey` extreme (lo or hi). */
function widthNear(ring, along, across, side, band = 900) {
  const ex = extentOf(ring, across);
  const near = ring.filter((p) => (side === 'lo' ? p[across] <= ex.lo + band : p[across] >= ex.hi - band));
  if (!near.length) return 0;
  return extentOf(near, along).span;
}

// A candidate lot is one piece. Its area and frontage must both pass.
function lotFrom(lotRing, rect, c, { frontAxis = 'x', frontSide = 'lo', frontAcross = 'y' } = {}) {
  const pieces = clipRect(lotRing, rect);
  if (!pieces.length) return null;
  const ring = pieces[0];
  const area = pieces.reduce((s, p) => s + areaOf(p), 0);
  if (area < c.minArea) return null;
  const front = widthNear(ring, frontAxis, frontAcross, frontSide);
  if (front < c.minFront) return null;
  return { ring, areaMm2: area, frontMm: front };
}

function splitAcross(lotRing, s0, s1, t0, t1, n, c, opts) {
  const w = (s1 - s0) / n;
  const out = [];
  for (let i = 0; i < n; i++) {
    const l = lotFrom(lotRing, rectRing(s0 + i * w, t0, s0 + (i + 1) * w, t1), c, opts);
    if (!l) return null;
    out.push(l);
  }
  return out;
}

const maxN = (span, c) => Math.max(1, Math.min(40, Math.floor(span / Math.max(1, c.minFront))));

// Strategy A: frontage ---------------------------------------------------------------------------------------------------------------------
function tryFrontage(lotRing, bb, c) {
  for (let n = maxN(bb.s1 - bb.s0, c); n >= 1; n--) {
    const lots = splitAcross(lotRing, bb.s0, bb.s1, bb.t0 - PAD, bb.t1 + PAD, n, c, { frontAxis: 'x', frontSide: 'lo', frontAcross: 'y' });
    if (lots) return { kind: 'frontage', lots, road: null, handle: null };
  }
  return null;
}

// Strategy B: battle-axe -------------------------------------------------------------------------------------------------------------------
function tryBattleAxe(lotRing, bb, c) {
  const W = bb.s1 - bb.s0;
  const D = bb.t1;
  if (W < c.minFront * 1.2 + HANDLE_W_MM || D < 2 * Math.sqrt(c.minArea) * 0.9) return null;
  let best = null;
  for (const side of ['lo', 'hi']) {
    const fs0 = side === 'lo' ? bb.s0 + HANDLE_W_MM + PAD : bb.s0;
    const fs1 = side === 'lo' ? bb.s1 : bb.s1 - HANDLE_W_MM - PAD;
    const hs0 = side === 'lo' ? bb.s0 : bb.s1 - HANDLE_W_MM - PAD; // the handle is 4 m of lot (the outer strip edge sits PAD clear of the lot edge)
    const hs1 = side === 'lo' ? bb.s0 + HANDLE_W_MM + PAD : bb.s1;
    for (let df = 14000; df <= D - 12000; df += 2000) {
      // front row
      let front = null;
      for (let n = maxN(fs1 - fs0, c); n >= 1 && !front; n--) front = splitAcross(lotRing, fs0, fs1, bb.t0 - PAD, df, n, c, { frontAxis: 'x', frontSide: 'lo', frontAcross: 'y' });
      if (!front) continue;
      // rear row (no frontage needed: it needs width)
      let rear = null;
      for (let n = maxN(W, c); n >= 1 && !rear; n--) rear = splitAcross(lotRing, bb.s0, bb.s1, df, bb.t1 + PAD, n, c, { frontAxis: 'x', frontSide: 'lo', frontAcross: 'y' });
      if (!rear) continue;
      // the handle must lie inside the lot along its whole length
      const handlePieces = clipRect(lotRing, rectRing(hs0, bb.t0 - PAD, hs1, df));
      const handleArea = handlePieces.reduce((s, p) => s + areaOf(p), 0);
      if (handleArea < 0.85 * HANDLE_W_MM * df) continue;
      // The rear lot at the handle end carries the handle. The rear lot nearest the handle is the first (lo) or last (hi) of the row.
      const k = side === 'lo' ? 0 : rear.length - 1;
      const total = front.length + rear.length;
      const minA = Math.min(...front.map((l) => l.areaMm2), ...rear.map((l) => l.areaMm2));
      if (!best || total > best.total || (total === best.total && minA > best.minA)) {
        best = { total, minA, kind: 'battleaxe', lots: [...front, ...rear], handle: { ring: handlePieces[0], lotIndex: front.length + k }, road: null };
      }
    }
  }
  return best;
}

// Strategy C: road -------------------------------------------------------------------------------------------------------------------------
function rowsAlong(lotRing, colS0, colS1, tFrom, tTo, roadSide, c) {
  // Lots in one column beside the road. Each lot fronts the road: its frontage is its thickness along the road.
  const out = [];
  const colW = colS1 - colS0;
  if (colW < Math.max(9000, c.minFront * 0.6)) return out;
  let t = tFrom;
  const hMin = Math.max(c.minFront, 9000);
  while (tTo - t >= hMin * 0.999) {
    let lot = null;
    let end = t;
    for (let h = hMin; h <= Math.min(tTo - t, hMin * 3); h += 1000) {
      end = Math.min(t + h, tTo);
      if (tTo - end < hMin) end = tTo; // never leave a sliver at the end
      const probe = clipRect(lotRing, rectRing(colS0, t, colS1, end));
      const area = probe.reduce((s, p) => s + areaOf(p), 0);
      if (!probe.length || area < c.minArea) { if (end === tTo) break; continue; }
      const front = widthNear(probe[0], 'y', 'x', roadSide === 'hi' ? 'hi' : 'lo');
      if (front < c.minFront) { if (end === tTo) break; continue; }
      lot = { ring: probe[0], areaMm2: area, frontMm: front };
      break;
    }
    if (!lot) break;
    out.push(lot);
    t = end;
  }
  return out;
}

function tryRoad(lotRing, bb, c) {
  const W = bb.s1 - bb.s0;
  const D = bb.t1;
  const rw = c.roadW;
  if (W < 2 * Math.max(9000, c.minFront * 0.6) + rw || D < 40000) return null;
  let best = null;
  const cuts = [0.3, 0.4, 0.5, 0.6, 0.7];
  for (const f of cuts) {
    const sc = bb.s0 + W * f;
    if (sc - bb.s0 < JUNCTION_CLEAR_MM || bb.s1 - sc < JUNCTION_CLEAR_MM) continue; // the junction keeps clear of the lot corners (side street and driveway spacing)
    for (let tEnd = 30000; tEnd <= D - 12000; tEnd += 4000) {
      const limit = tEnd + HEAD_R_MM;
      const left = rowsAlong(lotRing, bb.s0, sc - rw / 2, bb.t0, limit, 'hi', c);
      const right = rowsAlong(lotRing, sc + rw / 2, bb.s1, bb.t0, limit, 'lo', c);
      const cap = limit < D - 8000 ? (() => {
        for (let n = maxN(W, c); n >= 1; n--) {
          const lots = splitAcross(lotRing, bb.s0, bb.s1, limit, bb.t1 + PAD, n, c, { frontAxis: 'x', frontSide: 'lo', frontAcross: 'y' });
          if (lots) return lots;
        }
        return [];
      })() : [];
      const lots = [...left, ...right, ...cap];
      if (!left.length || !right.length) continue; // lots on both sides of any new road
      if (!best || lots.length > best.lots.length) {
        best = { kind: 'road', lots, road: { sc, tEnd, rw }, handle: null };
      }
    }
  }
  if (!best) return null;
  // Trim lots that the turning head overlaps (it is a little wider than the road).
  const head = orientOne(circleRing(best.road.sc, best.road.tEnd, HEAD_R_MM));
  best.lots = best.lots.map((l) => {
    try {
      const parts = boolean([orientOne(l.ring)], [head], 'diff').filter((r) => r.length >= 3).sort((a, b) => areaOf(b) - areaOf(a));
      if (parts.length) return { ...l, ring: parts[0], areaMm2: parts.reduce((s, p) => s + areaOf(p), 0) };
    } catch { /* keep the lot as it was */ }
    return l;
  }).filter((l) => l.areaMm2 >= c.minArea * 0.97);
  return best;
}

// Whole layout ------------------------------------------------------------------------------------------------------------------------------
/**
 * layoutSubdivision(lot, { minM2, minFrontM, roadW, areaFactor, frontExtraM }) -> { kind, count, lots, road, handle, frame, ... }
 * `lot` is site.lot (boundary in plan mm). Returns kind 'none' with count 1 when the lot cannot be divided under these limits.
 */
export function layoutSubdivision(lot, { minM2 = 600, minFrontM = 15, roadW = ROAD_W_MM, areaFactor = 1, frontExtraM = 0 } = {}) {
  const frame = frameOf(lot);
  const ring = orientOne(lot.boundary.map((p) => frame.toFrame(p)).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })));
  const sE = extentOf(ring, 'x');
  const tE = extentOf(ring, 'y');
  const bb = { s0: sE.lo - PAD, s1: sE.hi + PAD, t0: tE.lo, t1: tE.hi }; // outer strip edges sit just clear of the lot edges
  const c = { minArea: minM2 * areaFactor * M2, minFront: (minFrontM + frontExtraM) * 1000, roadW };
  const lotAreaMm2 = areaOf(ring);
  const none = { kind: 'none', count: 1, lots: [], road: null, handle: null, frame, minM2, minFrontM, lotAreaM2: lotAreaMm2 / M2 };
  if (lotAreaMm2 < 2 * c.minArea) return none;
  const found = [tryFrontage(ring, bb, c), tryBattleAxe(ring, bb, c), tryRoad(ring, bb, c)].filter(Boolean);
  let best = null;
  for (const r of found) {
    const n = r.lots.length;
    if (n >= 2 && (!best || n > best.lots.length)) best = r; // strict: a tie keeps the earlier, simpler layout
  }
  if (!best) return none;
  const toPlanRing = (r) => r.map((p) => frame.toPlan(p));
  // The rear lot at the end of a battle-axe handle is drawn as one outline with its handle (its area still leaves the handle out).
  if (best.handle?.ring && best.lots[best.handle.lotIndex]) {
    try {
      const joined = boolean([orientOne(best.lots[best.handle.lotIndex].ring)], [orientOne(best.handle.ring)], 'union').filter((r) => r.length >= 3).sort((x, y) => areaOf(y) - areaOf(x));
      if (joined.length === 1 || (joined.length > 1 && areaOf(joined[1]) < 1e6)) best.lots[best.handle.lotIndex] = { ...best.lots[best.handle.lotIndex], ring: joined[0], hasHandle: true };
    } catch { /* the handle stays a separate outline */ }
  }
  const sorted = best.lots
    .map((l) => ({ ...l, c: centroid(l.ring) }))
    .sort((a, b) => (Math.abs(a.c.y - b.c.y) > 4000 ? a.c.y - b.c.y : a.c.x - b.c.x)); // street row first, left to right, then the rows behind
  const lots = sorted.map((l, i) => ({ n: i + 1, ring: toPlanRing(l.ring), areaM2: Math.round(l.areaMm2 / M2), frontM: Math.round(l.frontMm / 100) / 10, hasHandle: !!l.hasHandle }));
  let road = null;
  if (best.road) {
    const { sc, tEnd, rw } = best.road;
    const t0 = bb.t0 - 2000;
    const cw = rw / 2 - VERGE_MM; // half the carriageway
    road = {
      ring: toPlanRing(rectRing(sc - rw / 2, t0, sc + rw / 2, tEnd)), head: toPlanRing(circleRing(sc, tEnd, HEAD_R_MM)),
      carriage: toPlanRing(rectRing(sc - cw, t0, sc + cw, tEnd)), carriageHead: toPlanRing(circleRing(sc, tEnd, HEAD_R_MM - VERGE_MM)),
      centre: [frame.toPlan({ x: sc, y: t0 }), frame.toPlan({ x: sc, y: tEnd })],
    };
  }
  return { kind: best.kind, count: lots.length, lots, road, handle: best.handle ? { lotNo: lots.find((l) => l.hasHandle)?.n || null } : null, frame, minM2, minFrontM, lotAreaM2: Math.round(lotAreaMm2 / M2) };
}

function centroid(ring) { return { x: ring.reduce((s, p) => s + p.x, 0) / ring.length, y: ring.reduce((s, p) => s + p.y, 0) / ring.length }; }

/**
 * The indicative yield: `high` from the limits as given, `low` from tighter limits (15% more area, 4 m more frontage, a wider road), so the
 * range says how sensitive the count is. The drawn layout is the `high` one.
 */
export function indicativeYield(lot, rules) {
  const base = layoutSubdivision(lot, { minM2: rules.minM2, minFrontM: rules.minFrontM });
  const tight = layoutSubdivision(lot, { minM2: rules.minM2, minFrontM: rules.minFrontM, areaFactor: 1.15, frontExtraM: 4, roadW: 18000 });
  const high = base.count;
  const low = Math.max(1, Math.min(tight.count, high));
  return { layout: base, low, high };
}

/** Pole of inaccessibility, roughly: the grid point of a ring that is furthest from its edges. Used to place a label. */
export function labelPoint(ring) {
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  const x0 = Math.min(...xs); const x1 = Math.max(...xs); const y0 = Math.min(...ys); const y1 = Math.max(...ys);
  let best = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, d: -1 };
  const N = 18;
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < N; j++) {
      const p = { x: x0 + ((x1 - x0) * i) / N, y: y0 + ((y1 - y0) * j) / N };
      if (!inside(p, ring)) continue;
      const d = edgeDist(p, ring);
      if (d > best.d) best = { ...p, d };
    }
  }
  return best;
}
function inside(p, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]; const b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
function edgeDist(p, ring) {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x; const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    d = Math.min(d, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return d;
}
