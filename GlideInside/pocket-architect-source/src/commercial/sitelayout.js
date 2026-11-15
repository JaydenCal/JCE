// Automatic car park and site layout for a commercial lot. Given the buildings on the lot it makes: driveway crossover(s) from the street
// (separate in and out crossovers for a service station), two-way circulation aisles to every building door, bays in rows along the aisles
// to the indicative rate (accessible bays and a shared zone nearest the main entry), a forecourt under a fuel canopy, truck aprons,
// footpaths to the entries and landscaping along the frontage and boundaries. Pure geometry in plan millimetres, no DOM.
//
// The layout is worked out on a grid in the lot frame (s along the front boundary, t inward from it), then written out as plain
// polygons in world mm. It is indicative only: swept paths, sight lines, crossover width and the parking rate are checked with council.
// The result is stored on commercial.siteWorks so the plan, pavements, quantities and 3D all read the same layout.

import * as G from '../model/geometry.js';
import { lotOf } from '../model/placement.js';
import { buildingsOf, layoutSig } from './catalogue/buildings.js';
import { bayDemand } from './catalogue/bays.js';
import { layoutUnits } from './layout.js';
import { parkingLayout } from './parking.js';
import { accessibleRequired } from './rules.js';
import { clipTo } from './catalogue/pavements/polybool.js';
import { polyArea } from './catalogue/pavements/geom.js';

export const SITEWORKS_VERSION = 1;
export const AISLE_MM = 6000;
export const AISLE_TRUCK_MM = 7500;
export const CROSSOVER_W = 6000;
export const CROSSOVER_TRUCK_W = 9000;
export const VERGE_MM = 3000;
export const FOOTPATH_W = 1500;
export const RE_RUN_LABEL = 'Re-run car park layout';

const DRIVABLE_EXTRAS = new Set(['canopy', 'fuel-canopy', 'truck-canopy', 'apron', 'yard', 'landscape', 'dock-recess', 'entry-canopy']);
const FORECOURT_KINDS = new Set(['fuel-canopy', 'truck-canopy']);
const r0 = (v) => Math.round(v);

// Frame ---------------------------------------------------------------------------------------------------------------------------------

function frameOfLot(lot) {
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
const toFrame = (f, p) => ({ s: (p.x - f.o.x) * f.u.x + (p.y - f.o.y) * f.u.y, t: (p.x - f.o.x) * f.n.x + (p.y - f.o.y) * f.n.y });
const toWorldF = (f, s, t) => ({ x: r0(f.o.x + f.u.x * s + f.n.x * t), y: r0(f.o.y + f.u.y * s + f.n.y * t) });
const rectWorld = (f, s0, s1, t0, t1) => [toWorldF(f, s0, t0), toWorldF(f, s1, t0), toWorldF(f, s1, t1), toWorldF(f, s0, t1)];

function distSeg(p, a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

// Grid ----------------------------------------------------------------------------------------------------------------------------------

const FREE = 0; const BLOCK = 1; const SOLID = 2; const RESERVED = 3; const AISLE = 4; const BAY = 5;

function makeGrid(f, lot, pts) {
  const fp = lot.boundary.map((q) => toFrame(f, q));
  const sMin = Math.min(...fp.map((q) => q.s)); const sMax = Math.max(...fp.map((q) => q.s));
  const tMin = -VERGE_MM - 500; const tMax = Math.max(...fp.map((q) => q.t));
  void pts;
  let cell = 500;
  const count = () => Math.ceil((sMax - sMin) / cell) * Math.ceil((tMax - tMin) / cell);
  while (count() > 90000) cell *= 2;
  const W = Math.ceil((sMax - sMin) / cell) + 1;
  const H = Math.ceil((tMax - tMin) / cell) + 1;
  return { f, fp, s0: sMin, t0: tMin, cell, W, H, a: new Uint8Array(W * H) };
}
const cellOf = (g, s, t) => ({ i: Math.floor((s - g.s0) / g.cell), j: Math.floor((t - g.t0) / g.cell) });
const centreOf = (g, i, j) => ({ s: g.s0 + (i + 0.5) * g.cell, t: g.t0 + (j + 0.5) * g.cell });
const at = (g, i, j) => (i < 0 || j < 0 || i >= g.W || j >= g.H ? SOLID : g.a[j * g.W + i]);
const setAt = (g, i, j, v) => { if (i >= 0 && j >= 0 && i < g.W && j < g.H) g.a[j * g.W + i] = v; };

/** Mark cells whose centre is inside a world polygon. `only` restricts which existing values may be overwritten. */
function paint(g, worldPoly, v, only = null) {
  const poly = worldPoly.map((q) => toFrame(g.f, q));
  const ss = poly.map((q) => q.s); const tt = poly.map((q) => q.t);
  const a = cellOf(g, Math.min(...ss), Math.min(...tt)); const b = cellOf(g, Math.max(...ss), Math.max(...tt));
  const pp = poly.map((q) => ({ x: q.s, y: q.t }));
  for (let j = Math.max(0, a.j); j <= Math.min(g.H - 1, b.j); j++) for (let i = Math.max(0, a.i); i <= Math.min(g.W - 1, b.i); i++) {
    const c = centreOf(g, i, j);
    if (!G.pointInPolygon({ x: c.s, y: c.t }, pp)) continue;
    if (only && !only.includes(at(g, i, j))) continue;
    setAt(g, i, j, v);
  }
}
const paintRect = (g, s0, s1, t0, t1, v, only = null) => paint(g, rectWorld(g.f, s0, s1, t0, t1), v, only);

/** True when every cell under the (s,t) rectangle satisfies `ok`. */
function rectIs(g, s0, s1, t0, t1, ok) {
  const a = cellOf(g, s0 + 1, t0 + 1); const b = cellOf(g, s1 - 1, t1 - 1);
  for (let j = a.j; j <= b.j; j++) for (let i = a.i; i <= b.i; i++) if (!ok(at(g, i, j))) return false;
  return true;
}

// Inputs --------------------------------------------------------------------------------------------------------------------------------

function sources(project) {
  const c = project.commercial;
  const bs = buildingsOf(c);
  const units = layoutUnits(c);
  const solids = [...bs.map((b) => b.outline), ...units.map((u) => u.poly)];
  const obstacles = bs.flatMap((b) => b.extras.filter((e) => !DRIVABLE_EXTRAS.has(e.kind)).map((e) => e.polygon));
  const reserved = [];
  if (units.length && c.parking?.enabled !== false) {
    const park = parkingLayout(c);
    for (const r of park.rows) for (const s of r.slots) reserved.push(s.poly);
  }
  const waste = c.waste;
  void waste;
  return { bs, units, solids, obstacles, reserved };
}

const OUTSIDE_SHARE = 0.05; // a building with more than 5 percent of its footprint over the boundary does not fit the lot (a small overhang is left to the setback check)
/** The share of a building's footprint (sampled on a grid) that lies outside the lot, 0 to 1. */
function shareOutside(outline, lot) {
  const bb = G.bbox(outline);
  let n = 0; let out = 0;
  for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) {
    const q = { x: bb.minX + ((i + 0.5) / 24) * (bb.maxX - bb.minX), y: bb.minY + ((j + 0.5) / 24) * (bb.maxY - bb.minY) };
    if (!G.pointInPolygon(q, outline)) continue;
    n++;
    if (!G.pointInPolygon(q, lot.boundary)) out++;
  }
  return n ? out / n : 0;
}
const edgeDist = (q, poly) => Math.min(...poly.map((a, i) => distSeg(q, a, poly[(i + 1) % poly.length])));
/** Keep the part of a paving polygon that lies inside the lot (the largest piece). { polygon, clipped, lost } */
function fitToLot(polygon, lot) {
  if (polygon.every((q) => G.pointInPolygon(q, lot.boundary) || edgeDist(q, lot.boundary) <= 5)) return { polygon, clipped: false, lost: false };
  let pieces = [];
  try { pieces = clipTo(polygon, lot.boundary); } catch { pieces = []; }
  const best = pieces.filter((r) => r.length >= 3).sort((a, b) => polyArea(b) - polyArea(a))[0];
  if (!best || polyArea(best) < 1e6) return { polygon: null, clipped: true, lost: true };
  return { polygon: best, clipped: true, lost: false };
}

const isStation = (bs) => bs.some((b) => b.type === 'service-station');
const wantsTruck = (bs) => bs.some((b) => (b.site?.vehicles?.docks || 0) > 0 || (b.site?.vehicles?.apronDepthMm || 0) > 0 || /HRV|AV|MRV/.test(b.site?.vehicles?.design || ''));

/** Where each building is entered: a point in front of its front face (world mm). */
function entryTargets(project, src, g) {
  const out = [];
  const fe = (b) => {
    const xs = b.local.outline.map((q) => q.x); const ys = b.local.outline.map((q) => q.y);
    return { mid: (Math.min(...xs) + Math.max(...xs)) / 2, y0: Math.min(...ys), x0: Math.min(...xs), x1: Math.max(...xs) };
  };
  const toW = (b, p) => {
    const a = (b.place.rotationDeg * Math.PI) / 180;
    return { x: b.place.x + Math.cos(a) * p.x - Math.sin(a) * p.y, y: b.place.y + Math.sin(a) * p.x + Math.cos(a) * p.y };
  };
  for (const b of src.bs) {
    const e = fe(b);
    const canopy = b.extras.find((x) => FORECOURT_KINDS.has(x.kind) && x.kind === 'fuel-canopy');
    const apron = (b.site?.vehicles?.apronDepthMm || 0) > 0 || b.extras.some((x) => x.kind === 'apron');
    const depth = 3500;
    void apron;
    const door = toW(b, { x: e.mid, y: e.y0 });
    const front = toW(b, { x: e.mid, y: e.y0 - depth });
    out.push({ buildingId: b.id, type: b.type, door, point: front, truck: apron || (b.site?.vehicles?.docks || 0) > 0, main: false });
    if (canopy) {
      const cx = canopy.polygon.reduce((s, q) => s + q.x, 0) / canopy.polygon.length;
      const cy = canopy.polygon.reduce((s, q) => s + q.y, 0) / canopy.polygon.length;
      out.push({ buildingId: b.id, type: 'fuel-canopy', door: { x: cx, y: cy }, point: { x: cx, y: cy }, truck: false, main: false, canopy: canopy.polygon });
    }
  }
  for (const u of src.units) {
    const p0 = u.poly;
    const c = p0.reduce((s, q) => ({ x: s.x + q.x / p0.length, y: s.y + q.y / p0.length }), { x: 0, y: 0 });
    out.push({ buildingId: `row:${u.rowId || u.id || out.length}`, type: 'strata', door: c, point: c, truck: true, main: false });
  }
  void g;
  if (out.length) out[0].main = true;
  return out;
}

// Routing -------------------------------------------------------------------------------------------------------------------------------

function erode(g, radius, passable) {
  const n = g.W * g.H;
  const bad = new Uint8Array(n);
  for (let j = 0; j < g.H; j++) for (let i = 0; i < g.W; i++) if (!passable(g.a[j * g.W + i])) bad[j * g.W + i] = 1;
  // Chebyshev erosion by `radius` cells in two passes (rows then columns).
  const pass = (src, horizontal) => {
    const dst = new Uint8Array(n);
    for (let j = 0; j < g.H; j++) for (let i = 0; i < g.W; i++) {
      let hit = 0;
      for (let k = -radius; k <= radius && !hit; k++) {
        const ii = horizontal ? i + k : i; const jj = horizontal ? j : j + k;
        if (ii < 0 || jj < 0 || ii >= g.W || jj >= g.H) { hit = 1; break; }
        if (src[jj * g.W + ii]) hit = 1;
      }
      dst[j * g.W + i] = hit;
    }
    return dst;
  };
  return pass(pass(bad, true), false);
}

/** Dijkstra with a turn penalty over 4-neighbour moves. Returns the cell path from any source to the target, or null. */
function route(g, blocked, sources_, target, costAt) {
  const W = g.W; const H = g.H;
  const idx = (i, j, d) => (j * W + i) * 4 + d;
  const dist = new Float64Array(W * H * 4).fill(Infinity);
  const prev = new Int32Array(W * H * 4).fill(-1);
  const heap = [];
  const push = (k, d) => { heap.push([d, k]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1; const r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  for (const s of sources_) for (let d = 0; d < 4; d++) { if (blocked[s.j * W + s.i]) continue; dist[idx(s.i, s.j, d)] = 0; push(idx(s.i, s.j, d), 0); }
  const DI = [1, 0, -1, 0]; const DJ = [0, 1, 0, -1];
  let end = -1;
  while (heap.length) {
    const [d0, k] = pop();
    if (d0 > dist[k]) continue;
    const d = k % 4; const cellIdx = (k - d) / 4; const i = cellIdx % W; const j = (cellIdx - i) / W;
    if (i === target.i && j === target.j) { end = k; break; }
    for (let nd = 0; nd < 4; nd++) {
      const ni = i + DI[nd]; const nj = j + DJ[nd];
      if (ni < 0 || nj < 0 || ni >= W || nj >= H || blocked[nj * W + ni]) continue;
      const nk = idx(ni, nj, nd);
      const c = d0 + 1 + (nd === d ? 0 : 6) + (costAt ? costAt(ni, nj) : 0);
      if (c < dist[nk]) { dist[nk] = c; prev[nk] = k; push(nk, c); }
    }
  }
  if (end < 0) return null;
  const path = [];
  for (let k = end; k >= 0; k = prev[k]) { const d = k % 4; const ci = (k - d) / 4; const i = ci % W; path.push({ i, j: (ci - i) / W }); }
  return path.reverse();
}

const nearestFree = (g, blocked, i0, j0, maxR = 60) => {
  for (let r = 0; r <= maxR; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
    const i = i0 + di; const j = j0 + dj;
    if (i >= 0 && j >= 0 && i < g.W && j < g.H && !blocked[j * g.W + i]) return { i, j };
  }
  return null;
};

/** Compress a cell path to straight segments of corner points in (s,t). */
function segmentsOf(g, path) {
  if (!path || path.length < 2) return [];
  const pts = path.map((c) => centreOf(g, c.i, c.j));
  const out = [];
  let a = pts[0];
  let dir = null;
  for (let k = 1; k < pts.length; k++) {
    const d = Math.abs(pts[k].s - pts[k - 1].s) > 1 ? 'h' : 'v';
    if (dir && d !== dir) { out.push({ a, b: pts[k - 1], dir }); a = pts[k - 1]; }
    dir = d;
  }
  out.push({ a, b: pts[pts.length - 1], dir });
  return out.filter((s) => Math.hypot(s.b.s - s.a.s, s.b.t - s.a.t) > 1);
}

// Generator -----------------------------------------------------------------------------------------------------------------------------

const centroid = (pts) => ({ x: pts.reduce((s, q) => s + q.x, 0) / pts.length, y: pts.reduce((s, q) => s + q.y, 0) / pts.length });

/**
 * generateSiteWorks(project) -> siteWorks or null (no lot, no buildings, or no street edge).
 * { version, kind: 'service-station'|'general', aisleMm, crossovers: [{ id, x, y, widthMm, role, dir }], aisles: [{ id, polygon, centre: [a, b], widthMm, kind }],
 *   forecourts: [{ id, polygon }], aprons: [{ id, polygon }], footpaths: [{ id, polygon }], landscape: [{ id, polygon }],
 *   bayRows: [{ rowId, buildingId, frame, length, x0, depth, offsetMm, slots: [{ index, kind, poly, centre }] }],
 *   summary: { required, provided, accessibleRequired, accessibleProvided, limited, perBuilding, reachable } }
 */
export function generateSiteWorks(project, opts = {}) {
  const c = project?.commercial;
  const lot = lotOf(project);
  if (!c || !lot || !Array.isArray(lot.boundary) || lot.boundary.length < 3 || !Array.isArray(lot.frontEdges) || !lot.frontEdges.length) return null;
  const src = sources(project);
  if (!src.bs.length && !src.units.length) return null;
  const f = frameOfLot(lot);
  if (!src.bs.length) return rowsOnlyWorks(c, lot, f);
  // A building that is wider or deeper than the lot does not fit: say so and lay out no car park around it.
  const spill = src.bs.filter((b) => shareOutside(b.outline, lot) > OUTSIDE_SHARE);
  if (spill.length) {
    const names = spill.map((b) => b.type.replace(/-/g, ' ')).join(', ');
    return { ...rowsOnlyWorks(c, lot, f), kind: 'does-not-fit', landscape: [], notFit: true, warnings: [`The ${names} does not fit inside the lot boundary, so no car park is laid out. Use a smaller building or a larger lot.`] };
  }
  const g = makeGrid(f, lot);
  const station = isStation(src.bs);
  const truck = wantsTruck(src.bs);
  const aisleW = truck ? AISLE_TRUCK_MM : Math.max(AISLE_MM, Number(c.parking?.aisleMm) || 0);
  const carW = Math.max(AISLE_MM, Number(c.parking?.aisleMm) || 0);
  const xoverW = truck ? CROSSOVER_TRUCK_W : CROSSOVER_W;
  const bayW = Number(c.parking?.bayW) || 2400;
  const bayL = Number(c.parking?.bayL) || 5400;
  const frontLand = Math.min(3000, Math.max(1500, ...src.bs.map((b) => Number(b.site?.landscapeFrontMm) || 0)));
  const sideLand = 1000;
  const frontEdges = new Set(lot.frontEdges);

  // Lot cells, inset from the boundary by the landscape strips (front deeper than sides and rear).
  const edges = lot.boundary.map((a, i) => ({ a, b: lot.boundary[(i + 1) % lot.boundary.length], front: frontEdges.has(i) }));
  for (let j = 0; j < g.H; j++) for (let i = 0; i < g.W; i++) {
    const cc = centreOf(g, i, j);
    const wp = toWorldF(f, cc.s, cc.t);
    if (!G.pointInPolygon(wp, lot.boundary)) { setAt(g, i, j, BLOCK); continue; }
    let bad = false;
    for (const e of edges) if (distSeg(wp, e.a, e.b) < (e.front ? frontLand : sideLand)) { bad = true; break; }
    if (bad) setAt(g, i, j, BLOCK);
  }
  // Reserved (existing paved rows) then solid things on top.
  for (const r of src.reserved) paint(g, r, RESERVED, [FREE]);
  for (const b of src.bs) for (const e of b.extras) {
    if (e.kind === 'apron' || e.kind === 'fuel-canopy' || e.kind === 'truck-canopy') {
      const pf = e.polygon.map((q) => toFrame(f, q));
      const pad = e.kind === 'apron' ? 0 : 1500;
      const ss = pf.map((q) => q.s); const tt = pf.map((q) => q.t);
      paintRect(g, Math.min(...ss) - pad, Math.max(...ss) + pad, Math.min(...tt) - pad, Math.max(...tt) + pad, RESERVED, [FREE]);
    }
  }
  for (const o of src.obstacles) paint(g, o, SOLID);
  for (const s of src.solids) paint(g, s, SOLID);
  // A walkway around each solid (one cell, free cells only).
  const grow = [];
  for (let j = 0; j < g.H; j++) for (let i = 0; i < g.W; i++) if (at(g, i, j) === SOLID) for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (at(g, i + di, j + dj) === FREE) grow.push([i + di, j + dj]);
  for (const [i, j] of grow) setAt(g, i, j, BLOCK);

  // Crossovers -------------------------------------------------------------------------------------------------------------------------
  const targets = entryTargets(project, src, g);
  const fpoly = g.fp;
  const frontLen = Math.max(...fpoly.map((q) => q.s)) - Math.min(...fpoly.map((q) => q.s));
  const sLo = Math.min(...fpoly.map((q) => q.s)); const sHi = Math.max(...fpoly.map((q) => q.s));
  const snap = (s) => g.s0 + (Math.floor((s - g.s0) / g.cell) + 0.5) * g.cell;
  const clampS = (s) => snap(Math.max(sLo + sideLand + xoverW / 2 + 500, Math.min(sHi - sideLand - xoverW / 2 - 500, s)));
  const mainT = targets.find((t) => t.main) || targets[0];
  const mainS = mainT ? toFrame(f, mainT.door).s : (sLo + sHi) / 2;
  const xs = [];
  if (station && frontLen > 2.4 * xoverW + 4000) {
    xs.push({ s: clampS(sLo + frontLen * 0.18), role: 'in' }, { s: clampS(sLo + frontLen * 0.82), role: 'out' });
  } else xs.push({ s: clampS(mainS), role: 'both' });
  // A saved position (user dragged crossover) is kept when it still sits on the frontage.
  const keep = Array.isArray(c.siteWorks?.crossovers) && c.siteWorks.crossovers.every((x) => x.moved) ? c.siteWorks.crossovers : null;
  void keep;
  for (const x of xs) {
    paintRect(g, x.s - xoverW / 2 - 500, x.s + xoverW / 2 + 500, g.t0, frontLand + 500, FREE, [BLOCK, FREE]);
  }
  const crossovers = xs.map((x, k) => {
    const p = toWorldF(f, x.s, 0);
    return { id: `sw:xover:${k}`, x: p.x, y: p.y, widthMm: xoverW, role: x.role, dir: { x: -f.n.x, y: -f.n.y }, s: x.s, polygon: rectWorld(f, x.s - xoverW / 2, x.s + xoverW / 2, -VERGE_MM, 0) };
  });

  // Aisles -----------------------------------------------------------------------------------------------------------------------------
  const rad = Math.max(1, Math.ceil((aisleW / 2) / g.cell - 0.5));
  const blocked = erode(g, rad, (v) => v === FREE || v === RESERVED);
  const blockedNarrow = erode(g, Math.max(1, Math.ceil((4000 / 2) / g.cell - 0.5)), (v) => v === FREE || v === RESERVED);
  const aisleCells = new Set();
  const segs = [];
  const unreachable = [];
  const usable = (b, i, j) => !b[j * g.W + i];
  const entryCell = (x) => {
    const e = nearestFree(g, blocked, ...Object.values(cellOf(g, x.s, 0)).slice(0, 2).concat([]), 40);
    return e;
  };
  void entryCell;
  const startCells = crossovers.map((x) => {
    const cc = cellOf(g, x.s, aisleW / 2 + 200);
    return nearestFree(g, blocked, cc.i, cc.j, 40) || nearestFree(g, blockedNarrow, cc.i, cc.j, 40);
  });
  const routed = [];
  const costAt = (i, j) => (aisleCells.has(j * g.W + i) ? -0.7 : at(g, i, j) === RESERVED ? 0.2 : 0);
  const order = [...targets].sort((p, q) => {
    const a = toFrame(f, p.point); const b = toFrame(f, q.point);
    return a.t - b.t;
  });
  const addPath = (path, kind) => {
    for (const cc of path) aisleCells.add(cc.j * g.W + cc.i);
    for (const sgm of segmentsOf(g, path)) segs.push({ ...sgm, kind });
  };
  const firstStart = startCells[0];
  if (firstStart) {
    for (const tg of order) {
      const tf = toFrame(f, tg.point);
      const tc = cellOf(g, tf.s, tf.t);
      const goal = nearestFree(g, blocked, tc.i, tc.j, 40) || nearestFree(g, blockedNarrow, tc.i, tc.j, 40);
      if (!goal) { unreachable.push(tg.buildingId); continue; }
      const srcCells = routed.length ? routed.map((k) => ({ i: k % g.W, j: Math.floor(k / g.W) })) : [firstStart];
      const path = route(g, blocked, srcCells, goal, costAt) || route(g, blockedNarrow, srcCells, goal, costAt);
      if (!path) { unreachable.push(tg.buildingId); continue; }
      addPath(path, tg.type === 'fuel-canopy' ? 'forecourt' : 'aisle');
      for (const cc of path) routed.push(cc.j * g.W + cc.i);
      tg.cell = goal;
    }
    // Each further crossover joins the network (or the first target when nothing is routed yet).
    for (let k = 1; k < startCells.length; k++) {
      const sc = startCells[k];
      if (!sc) continue;
      const srcCells = [...new Set(routed)].map((q) => ({ i: q % g.W, j: Math.floor(q / g.W) }));
      const path = srcCells.length ? route(g, blocked, [sc], srcCells[0], null) : null;
      // route from this start to the nearest routed cell: run a multi-target search by trying the closest candidates
      let best = null;
      const cands = srcCells.map((q) => ({ q, d: Math.abs(q.i - sc.i) + Math.abs(q.j - sc.j) })).sort((p, q) => p.d - q.d).slice(0, 6);
      for (const cd of cands) {
        const pth = route(g, blocked, [sc], cd.q, costAt) || route(g, blockedNarrow, [sc], cd.q, costAt);
        if (pth && (!best || pth.length < best.length)) best = pth;
      }
      void path;
      if (best) { addPath(best, 'aisle'); for (const cc of best) routed.push(cc.j * g.W + cc.i); }
      else unreachable.push(`crossover:${k}`);
    }
    // Entry run from the boundary to the first path cell.
    for (const [k, sc] of startCells.entries()) {
      if (!sc) continue;
      const cs = centreOf(g, sc.i, sc.j);
      segs.push({ a: { s: crossovers[k].s, t: 0 }, b: { s: cs.s, t: cs.t }, dir: 'v', kind: 'entry' });
      if (Math.abs(cs.s - crossovers[k].s) > 1) segs.push({ a: { s: crossovers[k].s, t: cs.t }, b: { s: cs.s, t: cs.t }, dir: 'h', kind: 'entry' });
      aisleCells.add(sc.j * g.W + sc.i);
    }
  }
  void usable;

  // Paint aisle strips so bays keep clear of them.
  const strip = (sg, w0) => {
    const w = sg.w || w0;
    const h = w / 2;
    const cap = sg.kind === 'rib' ? 0 : h;
    if (sg.dir === 'h') {
      const s0 = Math.min(sg.a.s, sg.b.s) - cap; const s1 = Math.max(sg.a.s, sg.b.s) + cap;
      return { s0, s1, t0: sg.a.t - h, t1: sg.a.t + h };
    }
    const t0 = Math.min(sg.a.t, sg.b.t) - cap; const t1 = Math.max(sg.a.t, sg.b.t) + cap;
    return { s0: sg.a.s - h, s1: sg.a.s + h, t0, t1 };
  };
  const baseKinds = g.a.slice();
  for (const sg of segs) { const r = strip(sg, aisleW); paintRect(g, r.s0, r.s1, r.t0, r.t1, AISLE, [FREE, BLOCK, RESERVED]); }
  // The carved entry corridor stays landscape where the aisle does not use it.
  for (const x of xs) {
    const a = cellOf(g, x.s - xoverW / 2 - 500, g.t0); const b = cellOf(g, x.s + xoverW / 2 + 500, frontLand + 500);
    for (let j = Math.max(0, a.j); j <= Math.min(g.H - 1, b.j); j++) for (let i = Math.max(0, a.i); i <= Math.min(g.W - 1, b.i); i++) if (at(g, i, j) === FREE && centreOf(g, i, j).t < frontLand + 300) setAt(g, i, j, BLOCK);
  }

  // Bays -------------------------------------------------------------------------------------------------------------------------------
  const need = (b) => Math.ceil(bayDemand(b).raw - 1e-9);
  const perBuilding = src.bs.map((b) => ({ id: b.id, required: need(b), provided: 0 }));
  const required = perBuilding.reduce((s, p) => s + p.required, 0);
  const accReq = required >= 2 ? accessibleRequired(required, c.buildingClass || 'class_8') : 0;
  const slotsWanted = required + Math.floor(accReq / 2) + (accReq % 2);
  const mainPt = mainT ? toFrame(f, mainT.door) : { s: (sLo + sHi) / 2, t: 0 };
  const placeBays = (limit, extraSegs) => {
    const rows = [];
    let total = 0;
    const occ = g.a.slice();
    const free = (v) => v === FREE || v === BLOCK + 99;
    const okAt = (s0, s1, t0, t1) => {
      const a = cellOf(g, s0 + 1, t0 + 1); const b = cellOf(g, s1 - 1, t1 - 1);
      for (let j = a.j; j <= b.j; j++) for (let i = a.i; i <= b.i; i++) { const v = i < 0 || j < 0 || i >= g.W || j >= g.H ? SOLID : occ[j * g.W + i]; if (!free(v)) return false; }
      return true;
    };
    const mark = (s0, s1, t0, t1) => {
      const a = cellOf(g, s0 + 1, t0 + 1); const b = cellOf(g, s1 - 1, t1 - 1);
      for (let j = a.j; j <= b.j; j++) for (let i = a.i; i <= b.i; i++) if (i >= 0 && j >= 0 && i < g.W && j < g.H) occ[j * g.W + i] = BAY;
    };
    const all = [...segs, ...extraSegs];
    const ranked = all.map((sg) => ({ sg, d: Math.hypot((sg.a.s + sg.b.s) / 2 - mainPt.s, (sg.a.t + sg.b.t) / 2 - mainPt.t) })).sort((p, q) => p.d - q.d);
    for (const { sg } of ranked) {
      for (const side of [-1, 1]) {
        if (total >= limit) break;
        const slots = [];
        if (sg.dir === 'h') {
          const lo = Math.min(sg.a.s, sg.b.s); const hi = Math.max(sg.a.s, sg.b.s);
          const tNear = sg.a.t + side * (sg.w || aisleW) / 2; const tFar = tNear + side * bayL;
          const tA = Math.min(tNear, tFar); const tB = Math.max(tNear, tFar);
          const ordered = [];
          for (let s = lo; s + bayW <= hi + (sg.w || aisleW) / 2 + 1; s += bayW) ordered.push(s);
          ordered.sort((p, q) => Math.abs(p + bayW / 2 - mainPt.s) - Math.abs(q + bayW / 2 - mainPt.s));
          for (const s of ordered) {
            if (total + slots.length >= limit) break;
            if (!okAt(s, s + bayW, tA, tB)) continue;
            mark(s, s + bayW, tA, tB);
            slots.push({ s, poly: rectWorld(f, s, s + bayW, tA, tB), centre: toWorldF(f, s + bayW / 2, (tA + tB) / 2), sc: s + bayW / 2, tc: (tA + tB) / 2, dir: 'h', side });
          }
        } else {
          const lo = Math.min(sg.a.t, sg.b.t); const hi = Math.max(sg.a.t, sg.b.t);
          const sNear = sg.a.s + side * (sg.w || aisleW) / 2; const sFar = sNear + side * bayL;
          const sA = Math.min(sNear, sFar); const sB = Math.max(sNear, sFar);
          const ordered = [];
          for (let t = lo; t + bayW <= hi + (sg.w || aisleW) / 2 + 1; t += bayW) ordered.push(t);
          ordered.sort((p, q) => Math.abs(p + bayW / 2 - mainPt.t) - Math.abs(q + bayW / 2 - mainPt.t));
          for (const t of ordered) {
            if (total + slots.length >= limit) break;
            if (!okAt(sA, sB, t, t + bayW)) continue;
            mark(sA, sB, t, t + bayW);
            slots.push({ t, poly: rectWorld(f, sA, sB, t, t + bayW), centre: toWorldF(f, (sA + sB) / 2, t + bayW / 2), sc: (sA + sB) / 2, tc: t + bayW / 2, dir: 'v', side });
          }
        }
        if (slots.length) {
          slots.sort((p, q) => (sg.dir === 'h' ? p.s - q.s : p.t - q.t));
          total += slots.length;
          rows.push({ sg, slots });
        }
      }
    }
    return { rows, total };
  };

  // Ribs: extra aisles branching off the spine when the spine alone cannot hold the bays.
  let extraSegs = [];
  let result = placeBays(slotsWanted, extraSegs);
  const ribs = [];
  for (let guard = 0; guard < 14 && result.total < slotsWanted; guard++) {
    let best = null;
    const base = [...segs, ...extraSegs];
    for (const sg of base) {
      const along = sg.dir === 'h' ? [Math.min(sg.a.s, sg.b.s), Math.max(sg.a.s, sg.b.s)] : [Math.min(sg.a.t, sg.b.t), Math.max(sg.a.t, sg.b.t)];
      for (let p = along[0]; p <= along[1] + 1; p += 1500) {
        for (const side of [-1, 1]) {
          const pos = sg.dir === 'h' ? { s: p, t: sg.a.t } : { s: sg.a.s, t: p };
          if (ribs.some((rb) => rb.dir === sg.dir && Math.abs(rb.at - p) < 2 * bayW + 1 && rb.side === side && Math.abs((rb.base) - (sg.dir === 'h' ? sg.a.t : sg.a.s)) < 1)) continue;
          // Run outward from the spine edge while the rib aisle is clear; each side counts the length where its bay row is clear too.
          let run = 0; let extA = 0; let extB = 0; let stA = 0; let stB = 0; let lastA = 0; let lastB = 0;
          const edge = (sg.dir === 'h' ? sg.a.t : sg.a.s) + side * ((sg.w || aisleW) / 2);
          const hw = carW / 2;
          for (let L = 1500; L <= 60000; L += 1500) {
            const lo = edge + (side > 0 ? L - 1500 : -L); const hi = edge + (side > 0 ? L : -L + 1500);
            const strip1 = sg.dir === 'h' ? [pos.s - hw, pos.s + hw, lo, hi] : [lo, hi, pos.t - hw, pos.t + hw];
            if (!rectIs(g, ...strip1, (v) => v === FREE || v === RESERVED)) break;
            run = L;
            const sideStrip = (k) => (sg.dir === 'h' ? [pos.s + k * hw, pos.s + k * (hw + bayL), lo, hi] : [lo, hi, pos.t + k * hw, pos.t + k * (hw + bayL)]);
            const sideRect = (k) => { const r = sideStrip(k); return k > 0 ? r : (sg.dir === 'h' ? [r[1], r[0], r[2], r[3]] : [r[0], r[1], r[3], r[2]]); };
            const okA = rectIs(g, ...sideRect(1), (v) => v === FREE);
            const okB = rectIs(g, ...sideRect(-1), (v) => v === FREE);
            if (okA && stA < 2) { stA = 1; extA += 1500; lastA = L; } else if (stA === 1) stA = 2;
            if (okB && stB < 2) { stB = 1; extB += 1500; lastB = L; } else if (stB === 1) stB = 2;
          }
          const gain = Math.floor(extA / bayW) + Math.floor(extB / bayW);
          if (gain < 2) continue;
          run = Math.max(lastA, lastB);
          const near = Math.hypot(pos.s - mainPt.s, pos.t - mainPt.t);
          const score = gain - near / 8000;
          if (!best || score > best.score) best = { score, sg, side, p, pos, run, edge };
        }
      }
    }
    if (!best) break;
    const { sg, side, pos, run } = best;
    const trim = Math.max(0, run - (run % 1500));
    const far = best.edge + side * trim;
    const rib = sg.dir === 'h'
      ? { a: { s: pos.s, t: sg.a.t }, b: { s: pos.s, t: far }, dir: 'v', kind: 'rib', w: carW }
      : { a: { s: sg.a.s, t: pos.t }, b: { s: far, t: pos.t }, dir: 'h', kind: 'rib', w: carW };
    ribs.push({ dir: sg.dir, at: best.p, side, base: sg.dir === 'h' ? sg.a.t : sg.a.s });
    extraSegs = [...extraSegs, rib];
    const r = strip(rib, aisleW);
    paintRect(g, r.s0, r.s1, r.t0, r.t1, AISLE, [FREE, RESERVED]);
    result = placeBays(slotsWanted, extraSegs);
  }
  // Ribs that carry no bays are dropped again so the lot is not paved for nothing.
  const usedSegs = new Set(result.rows.map((r) => r.sg));
  extraSegs = extraSegs.filter((s) => usedSegs.has(s));

  // Rows, accessible bays and allocation -----------------------------------------------------------------------------------------------
  const rows = [];
  let provided = 0;
  result.rows.forEach((r, k) => {
    const sg = r.sg;
    const slots = r.slots.map((sl, i) => ({ index: i, kind: 'bay', poly: sl.poly, centre: sl.centre, _s: sl.sc, _t: sl.tc }));
    const o = sg.dir === 'h' ? toWorldF(f, r.slots[0].s, r.slots[0].side > 0 ? sg.a.t + (sg.w || aisleW) / 2 : sg.a.t - (sg.w || aisleW) / 2) : toWorldF(f, r.slots[0].side > 0 ? sg.a.s + (sg.w || aisleW) / 2 : sg.a.s - (sg.w || aisleW) / 2, r.slots[0].t);
    const u = sg.dir === 'h' ? { x: f.u.x, y: f.u.y } : { x: f.n.x, y: f.n.y };
    const side = r.slots[0].side;
    const v = sg.dir === 'h' ? { x: f.n.x * side, y: f.n.y * side } : { x: f.u.x * side, y: f.u.y * side };
    // Contiguous runs of bays become one paving rectangle each.
    const runs = [];
    let cur = null;
    for (const sl of r.slots) {
      const key = sg.dir === 'h' ? sl.s : sl.t;
      if (cur && Math.abs(key - cur.last - bayW) < 5) { cur.slots.push(sl); cur.last = key; } else { cur = { slots: [sl], last: key }; runs.push(cur); }
    }
    const bayAreas = runs.map((rn, q) => {
      const pts = rn.slots.flatMap((sl) => sl.poly.map((pt) => toFrame(f, pt)));
      return { id: `sw:bays:${k}:${q}`, polygon: rectWorld(f, Math.min(...pts.map((z) => z.s)), Math.max(...pts.map((z) => z.s)), Math.min(...pts.map((z) => z.t)), Math.max(...pts.map((z) => z.t))) };
    });
    rows.push({ rowId: `sw:bays:${k}`, buildingId: null, bayAreas, frame: { o, u, v, f: { x: -v.x, y: -v.y } }, length: slots.length * bayW, x0: 0, depth: 0, offsetMm: 0, slots, _sg: sg });
    provided += slots.length;
  });
  // Accessible groups [bay][zone][bay] nearest the main entry.
  let accProvided = 0;
  if (accReq > 0) {
    const dist = (sl) => Math.hypot(sl._s - mainPt.s, sl._t - mainPt.t);
    const groups = [];
    for (const row of rows) for (let i = 0; i + 2 < row.slots.length; i++) groups.push({ row, i, d: dist(row.slots[i + 1]) });
    groups.sort((p, q) => p.d - q.d);
    const taken = new Set();
    for (const gr of groups) {
      if (accProvided >= accReq) break;
      const ids = [0, 1, 2].map((k) => `${gr.row.rowId}:${gr.i + k}`);
      if (ids.some((x) => taken.has(x))) continue;
      ids.forEach((x) => taken.add(x));
      gr.row.slots[gr.i].kind = 'accessible'; gr.row.slots[gr.i + 1].kind = 'zone'; gr.row.slots[gr.i + 2].kind = 'accessible';
      accProvided += 2;
    }
    if (accProvided < accReq) {
      for (const row of rows) for (let i = 0; i + 1 < row.slots.length && accProvided < accReq; i++) {
        const a = `${row.rowId}:${i}`; const b = `${row.rowId}:${i + 1}`;
        if (taken.has(a) || taken.has(b)) continue;
        taken.add(a); taken.add(b);
        row.slots[i].kind = 'accessible'; row.slots[i + 1].kind = 'zone'; accProvided += 1;
      }
    }
  }
  const zones = rows.reduce((s, r) => s + r.slots.filter((x) => x.kind === 'zone').length, 0);
  const providedBays = provided - zones;
  // Allocate bays to buildings nearest-first up to each need, the rest to the nearest.
  const allSlots = rows.flatMap((r) => r.slots.map((sl) => ({ sl, row: r }))).filter((x) => x.sl.kind !== 'zone');
  const pool = [...allSlots];
  const doorOf = new Map(targets.filter((t) => t.type !== 'fuel-canopy').map((t) => [t.buildingId, toFrame(f, t.door)]));
  for (const pb of perBuilding) {
    const d = doorOf.get(pb.id);
    if (!d) continue;
    pool.sort((p, q) => Math.hypot(p.sl._s - d.s, p.sl._t - d.t) - Math.hypot(q.sl._s - d.s, q.sl._t - d.t));
    for (let k = 0; k < pb.required && pool.length; k++) { const x = pool.shift(); x.row.buildingId = x.row.buildingId || pb.id; pb.provided += 1; }
  }
  if (perBuilding.length) for (const x of pool) { perBuilding[0].provided += 0; x.row.buildingId = x.row.buildingId || perBuilding[0].id; }
  for (const r of rows) { r.buildingId = r.buildingId || perBuilding[0]?.id || null; delete r._sg; for (const sl of r.slots) { delete sl._s; delete sl._t; } }

  // Disjoint paving rectangles for the aisles: the aisle cells (not the aprons, forecourts or existing rows) merged into runs.
  const mask = new Uint8Array(g.W * g.H);
  for (const sg of [...segs, ...extraSegs]) { const r = strip(sg, aisleW); const a = cellOf(g, r.s0, r.t0); const b = cellOf(g, r.s1, r.t1);
    for (let j = Math.max(0, a.j); j <= Math.min(g.H - 1, b.j); j++) for (let i = Math.max(0, a.i); i <= Math.min(g.W - 1, b.i); i++) {
      const cc = centreOf(g, i, j);
      if (cc.s >= r.s0 && cc.s <= r.s1 && cc.t >= r.t0 && cc.t <= r.t1 && baseKinds[j * g.W + i] !== RESERVED && (baseKinds[j * g.W + i] !== SOLID)) mask[j * g.W + i] = 1;
    } }
  const pavedAisles = [];
  { const open = new Map();
    for (let j = 0; j <= g.H; j++) {
      const runs = [];
      if (j < g.H) for (let i = 0; i < g.W; i++) { if (!mask[j * g.W + i]) continue; let k = i; while (k + 1 < g.W && mask[j * g.W + k + 1]) k++; runs.push([i, k]); i = k; }
      const next = new Map();
      for (const [i0, i1] of runs) { const key = `${i0}:${i1}`; const o = open.get(key); next.set(key, o ? { ...o, j1: j } : { i0, i1, j0: j, j1: j }); open.delete(key); }
      for (const o of open.values()) pavedAisles.push(o);
      open.clear(); for (const [k2, v] of next) open.set(k2, v);
    }
    for (const o of open.values()) pavedAisles.push(o);
  }
  const pavedPolys = pavedAisles.map((o, k) => ({ id: `sw:paved:${k}`, polygon: rectWorld(f, g.s0 + o.i0 * g.cell, g.s0 + (o.i1 + 1) * g.cell, g.t0 + o.j0 * g.cell, g.t0 + (o.j1 + 1) * g.cell) }));

  // Aisle polygons ---------------------------------------------------------------------------------------------------------------------
  const finalSegs = [...segs.filter((s) => s.kind !== 'entry'), ...segs.filter((s) => s.kind === 'entry'), ...extraSegs];
  const aisles = finalSegs.map((sg, k) => {
    const r = strip(sg, aisleW);
    return { id: `sw:aisle:${k}`, polygon: rectWorld(f, r.s0, r.s1, r.t0, r.t1), centre: [toWorldF(f, sg.a.s, sg.a.t), toWorldF(f, sg.b.s, sg.b.t)], widthMm: sg.w || aisleW, kind: sg.kind === 'forecourt' ? 'forecourt' : 'aisle' };
  });

  // Forecourts, aprons, footpaths, landscape --------------------------------------------------------------------------------------------
  const forecourts = [];
  const aprons = [];
  const footpaths = [];
  const warnings = [];
  const trim = (list, id, buildingId, polygon, label) => {
    const r = fitToLot(polygon, lot);
    if (r.clipped) warnings.push(r.lost ? `The ${label} does not fit inside the lot.` : `The ${label} was cut back to the lot boundary.`);
    if (r.polygon) list.push({ id, buildingId, polygon: r.polygon });
    return !!r.polygon;
  };
  for (const b of src.bs) {
    for (const e of b.extras) {
      if (e.kind === 'fuel-canopy' || e.kind === 'truck-canopy') {
        const ptsF = e.polygon.map((q) => toFrame(f, q));
        const s0 = Math.min(...ptsF.map((q) => q.s)) - 1500; const s1 = Math.max(...ptsF.map((q) => q.s)) + 1500;
        const t0 = Math.min(...ptsF.map((q) => q.t)) - 1500; const t1 = Math.max(...ptsF.map((q) => q.t)) + 1500;
        trim(forecourts, `sw:forecourt:${forecourts.length}`, b.id, rectWorld(f, s0, s1, t0, t1), 'forecourt');
      }
      if (e.kind === 'apron') trim(aprons, `sw:apron:${aprons.length}`, b.id, e.polygon, 'truck apron');
    }
    // The footpath along the front face of the building, from the door out to the aisle side.
    const xs = b.local.outline.map((q) => q.x); const ys = b.local.outline.map((q) => q.y);
    const x0 = Math.min(...xs); const x1 = Math.max(...xs); const y0 = Math.min(...ys);
    if (!aprons.some((a) => a.buildingId === b.id)) {
      const a = (b.place.rotationDeg * Math.PI) / 180;
      const tw = (p) => ({ x: r0(b.place.x + Math.cos(a) * p.x - Math.sin(a) * p.y), y: r0(b.place.y + Math.sin(a) * p.x + Math.cos(a) * p.y) });
      footpaths.push({ id: `sw:foot:${footpaths.length}`, buildingId: b.id, polygon: [tw({ x: x0, y: y0 - FOOTPATH_W }), tw({ x: x1, y: y0 - FOOTPATH_W }), tw({ x: x1, y: y0 }), tw({ x: x0, y: y0 })] });
    }
  }
  const landscape = [];
  const inLot = (poly) => poly.every((q) => G.pointInPolygon(q, lot.boundary));
  const gaps = crossovers.map((x) => [x.s - xoverW / 2 - 300, x.s + xoverW / 2 + 300]).sort((p, q) => p[0] - q[0]);
  let cursor = sLo + 0;
  const addStrip = (s0, s1) => { if (s1 - s0 < 1200) return; const poly = rectWorld(f, s0, s1, 0, frontLand - 300); if (inLot(poly)) landscape.push({ id: `sw:land:${landscape.length}`, polygon: poly }); };
  for (const [a, b] of gaps) { addStrip(cursor, a); cursor = Math.max(cursor, b); }
  addStrip(cursor, sHi);
  const tMaxLot = Math.max(...fpoly.map((q) => q.t));
  for (const side of [0, 1]) {
    const s0 = side ? sHi - sideLand : sLo; const s1 = side ? sHi : sLo + sideLand;
    const poly = rectWorld(f, s0, s1, frontLand, tMaxLot);
    if (inLot(poly)) landscape.push({ id: `sw:land:${landscape.length}`, polygon: poly });
  }

  // Reachability of every building (door point within 4 m of an aisle or forecourt) ---------------------------------------------------
  const nearAisle = (p) => {
    const q = toFrame(f, p);
    return finalSegs.some((sg) => {
      const r = strip({ ...sg, w: aisleW + 8000 }, 0);
      return q.s >= r.s0 && q.s <= r.s1 && q.t >= r.t0 && q.t <= r.t1;
    }) || forecourts.some((fc) => G.pointInPolygon(p, fc.polygon)) || aprons.some((ap) => G.pointInPolygon(p, ap.polygon));
  };
  const reachable = {};
  for (const t of targets) if (t.type !== 'fuel-canopy') reachable[t.buildingId] = nearAisle(t.door) && !unreachable.includes(t.buildingId);

  return {
    version: SITEWORKS_VERSION,
    kind: station ? 'service-station' : 'general',
    aisleMm: aisleW,
    crossovers: crossovers.map(({ s, ...x }) => x),
    aisles,
    pavedAisles: pavedPolys,
    forecourts,
    aprons,
    footpaths,
    landscape,
    warnings: [...new Set(warnings)],
    bayRows: rows,
    summary: {
      required, provided: providedBays, accessibleRequired: accReq, accessibleProvided: accProvided,
      limited: providedBays < required, perBuilding, reachable, unreachable,
    },
    generatedAt: opts.stamp ?? 0,
  };
}

/**
 * Strata unit rows already carry their own bays, aprons and aisles (parking.js), so they only get the landscaping from the site layout;
 * the driveway and crossover stay the access line the rows have always had.
 */
function rowsOnlyWorks(c, lot, f) {
  const fp = lot.boundary.map((q) => toFrame(f, q));
  const sLo = Math.min(...fp.map((q) => q.s)); const sHi = Math.max(...fp.map((q) => q.s)); const tHi = Math.max(...fp.map((q) => q.t));
  const inLot = (poly) => G.pointInPolygon(centroid(poly), lot.boundary);
  const landscape = [];
  const add = (poly) => { if (inLot(poly)) landscape.push({ id: `sw:land:${landscape.length}`, polygon: poly }); };
  add(rectWorld(f, sLo, sHi, 0, 2000));
  add(rectWorld(f, sLo, sLo + 1000, 2000, tHi));
  add(rectWorld(f, sHi - 1000, sHi, 2000, tHi));
  void c;
  return { version: SITEWORKS_VERSION, kind: 'rows', aisleMm: 0, crossovers: [], aisles: [], pavedAisles: [], forecourts: [], aprons: [], footpaths: [], landscape, bayRows: [], summary: { required: 0, provided: 0, accessibleRequired: 0, accessibleProvided: 0, limited: false, perBuilding: [], reachable: {}, unreachable: [] }, generatedAt: 0 };
}

/** The key of what a layout depends on: lot, building placements and parameters, strata rows. A change means the layout is out of date. */
export function siteKey(project) {
  const c = project?.commercial;
  const lot = lotOf(project);
  if (!c || !lot) return '';
  const r = (v) => Math.round(Number(v) || 0);
  return JSON.stringify([
    lot.boundary?.map((q) => [r(q.x), r(q.y)]), lot.frontEdges, lot.envelope?.length || 0,
    (c.buildings || []).map((b) => [b.id, b.type, r(b.place?.x), r(b.place?.y), r(b.place?.rotationDeg), b.params]),
    (c.rows || []).map((rw) => [rw.id, r(rw.x), r(rw.y), r(rw.rotationDeg), rw.count]),
    c.parking?.bayW, c.parking?.bayL, c.parking?.aisleMm, c.parking?.enabled, c.buildingClass,
  ]);
}

/** Refresh project.commercial.siteWorks inside an apply (or any mutation). Clears it when there is nothing to lay out. */
export function refreshSiteWorks(p, { force = false } = {}) {
  if (!p?.commercial) return null;
  if (p.commercial.siteAuto === false && !force) return p.commercial.siteWorks || null;
  const key0 = siteKey(p);
  if (!force && p.commercial.siteWorks?.key === key0 && p.commercial.siteWorks.version === SITEWORKS_VERSION) return p.commercial.siteWorks;
  const sw = generateSiteWorks(p);
  if (sw) { sw.key = siteKey(p); sw.bsig = layoutSig(p.commercial); p.commercial.siteWorks = sw; } else delete p.commercial.siteWorks;
  return sw;
}

export { centroid };
