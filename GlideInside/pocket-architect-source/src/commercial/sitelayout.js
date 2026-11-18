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
import { trueFrontEdges } from '../site/frontage.js';
import { buildingsOf, layoutSig } from './catalogue/buildings.js';
import { bayDemand } from './catalogue/bays.js';
import { layoutUnits } from './layout.js';
import { parkingLayout } from './parking.js';
import { accessibleRequired } from './rules.js';
import { clipTo, boolean, holeFree, overlapArea } from './catalogue/pavements/polybool.js';
import { fillField, betterField, fieldGeometry, markAccessible, carportsOf, BAY_W, BAY_L } from './carpark-field.js';
import { sideField, sideGeometry, QUEUE_MM } from './carpark-side.js';
import { polyArea } from './catalogue/pavements/geom.js';
import { rowsSignature } from './estate.js';
import { orientedWorks, isSkewed } from './sitelayout-oriented.js';

export const SITEWORKS_VERSION = 5; // 5: the car park is a spine aisle with double loaded cross aisles and contiguous bays (carpark-field.js); 4: 4: a building turned off the lot grid gets a car park, aisle, bays, hardstand lane and one drive laid out in its own frame (sitelayout-oriented.js)
export const AISLE_MM = 6200;
export const AISLE_TRUCK_MM = 7500;
export const CROSSOVER_W = 6000;
export const CROSSOVER_TRUCK_W = 9000;
export const VERGE_MM = 3000;
export const FOOTPATH_W = 1500;
export const RE_RUN_LABEL = 'Re-run car park layout';

const DRIVABLE_EXTRAS = new Set(['canopy', 'fuel-canopy', 'truck-canopy', 'apron', 'yard', 'landscape', 'dock-recess', 'entry-canopy', 'dock-apron', 'display-yard']);
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

function makeGrid(f, lot, win) {
  const fp = lot.boundary.map((q) => toFrame(f, q));
  const sMin = win ? win.s0 : Math.min(...fp.map((q) => q.s)); const sMax = win ? win.s1 : Math.max(...fp.map((q) => q.s));
  const tMin = -VERGE_MM - 500; const tMax = win ? win.t1 : Math.max(...fp.map((q) => q.t));
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

export const DEV_MARGIN_MM = 30000;
/** The working window in the lot frame, { s0, s1, t1 }: the buildings and bays with a margin, from the frontage inward, clipped to the lot. */
function developableWindow(f, lot, src) {
  const fp = lot.boundary.map((q) => toFrame(f, q));
  const lo = { s: Math.min(...fp.map((q) => q.s)), t: Math.max(...fp.map((q) => q.t)) };
  const hi = { s: Math.max(...fp.map((q) => q.s)) };
  const pts = [...src.solids.flat(), ...src.reserved.flat(), ...src.bs.flatMap((b) => b.extras.flatMap((e) => e.polygon))].map((q) => toFrame(f, q));
  if (!pts.length) return { s0: lo.s, s1: hi.s, t1: lo.t };
  const m = DEV_MARGIN_MM;
  const s0 = Math.max(lo.s, Math.min(...pts.map((q) => q.s)) - m);
  const s1 = Math.min(hi.s, Math.max(...pts.map((q) => q.s)) + m);
  const t1 = Math.min(lo.t, Math.max(...pts.map((q) => q.t)) + m);
  return { s0, s1, t1 };
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
    // A building with a car zone beside its truck apron (a warehouse with an office pod) is entered on foot at the pod door, not at the middle of the front.
    const z = b.site?.parking?.zone;
    const hasApron = apron || (b.site?.vehicles?.docks || 0) > 0;
    const podDoor = hasApron && Number.isFinite(z?.x0) && Number.isFinite(z?.x1);
    const dx = podDoor ? (z.x0 <= e.x0 + 1 ? z.x0 + 1500 : z.x1 - 1500) : e.mid;
    const door = toW(b, { x: dx, y: e.y0 });
    const front = toW(b, { x: dx, y: e.y0 - depth });
    out.push({ buildingId: b.id, type: b.type, door, point: front, truck: hasApron, ped: podDoor, main: false });
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

/** Up to `n` free cells nearest (i0, j0), nearest first, so a goal that cannot be routed to can fall back to the next one. */
const nearestFreeList = (g, blocked, i0, j0, n = 12, maxR = 40) => {
  const out = [];
  for (let r = 0; r <= maxR && out.length < n; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
    const i = i0 + di; const j = j0 + dj;
    if (i >= 0 && j >= 0 && i < g.W && j < g.H && !blocked[j * g.W + i]) out.push({ i, j });
  }
  return out.slice(0, n);
};

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
  const lot0 = lotOf(project);
  if (!c || !lot0 || !Array.isArray(lot0.boundary) || lot0.boundary.length < 3 || !Array.isArray(lot0.frontEdges) || !lot0.frontEdges.length) return null;
  // Entries, exits and crossovers sit only on an edge that really abuts a road, never on a boundary shared with another lot.
  const lot = { ...lot0, frontEdges: trueFrontEdges(lot0) };
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
  // The working window: on a huge lot only the ground around the buildings is laid out (the developable envelope); the rest is balance land.
  const win = developableWindow(f, lot, src);
  const g = makeGrid(f, lot, win);
  const station = isStation(src.bs);
  const truck = wantsTruck(src.bs);
  const aisleW = truck ? AISLE_TRUCK_MM : Math.max(AISLE_MM, Number(c.parking?.aisleMm) || 0);
  const carW = Math.max(AISLE_MM, Number(c.parking?.aisleMm) || 0);
  const ae = c.accessEdit && typeof c.accessEdit === 'object' ? c.accessEdit : null;
  const xoverW = Number.isFinite(ae?.widthMm) ? Math.min(12000, Math.max(3000, ae.widthMm)) : truck ? CROSSOVER_TRUCK_W : CROSSOVER_W;
  const bayW = Math.max(BAY_W, Number(c.parking?.bayW) || 0);
  const bayL = Math.max(BAY_L, Number(c.parking?.bayL) || 0);
  const frontLand = Math.min(3000, Math.max(1500, ...src.bs.map((b) => Number(b.site?.landscapeFrontMm) || 0)));
  const sideLand = 1000;
  const frontEdges = new Set(lot.frontEdges);
  // A single building turned off the lot's grid: lay the whole car park out in the building's own frame as one connected design.
  if (src.bs.length === 1 && !station && isSkewed(src.bs[0].place.rotationDeg, f) && !src.units.length) {
    const ow = orientedWorks({ c, lot, f, b: src.bs[0], toFrame, toWorldF, fitToLot, frontLand, sideLand, truck, xoverW, aisleTruck: AISLE_TRUCK_MM });
    if (ow) return { version: SITEWORKS_VERSION, ...ow, generatedAt: opts.stamp ?? 0 };
  }

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
  // The crossovers sit on the first frontage edge only: never beyond its ends (a corner lot's lot extent is longer than the edge), and a corner
  // clear of the next street when the neighbouring edge is also a frontage.
  const nB = lot.boundary.length;
  const e0 = (lot.frontEdges || [])[0] ?? 0;
  const edgeLen = Math.hypot(lot.boundary[(e0 + 1) % nB].x - lot.boundary[e0].x, lot.boundary[(e0 + 1) % nB].y - lot.boundary[e0].y);
  const CORNER = 6000;
  const sLo = Math.max(win.s0, Math.min(...fpoly.map((q) => q.s)), 0) + (frontEdges.has((e0 - 1 + nB) % nB) ? CORNER : 0);
  const sHi = Math.min(win.s1, Math.max(...fpoly.map((q) => q.s)), edgeLen) - (frontEdges.has((e0 + 1) % nB) ? CORNER : 0);
  const frontLen = sHi - sLo;
  const snap = (s) => g.s0 + (Math.floor((s - g.s0) / g.cell) + 0.5) * g.cell;
  const clampS = (s) => snap(Math.max(sLo + sideLand + xoverW / 2 + 500, Math.min(sHi - sideLand - xoverW / 2 - 500, s)));
  const mainT = targets.find((t) => t.main) || targets[0];
  // A building with a truck apron is entered by trucks straight in from the street: the crossover lines up with the middle of the apron.
  const apronBoxF = src.bs.flatMap((b) => b.extras.filter((e) => e.kind === 'apron').map((e) => { const p = e.polygon.map((q) => toFrame(f, q)); return { s0: Math.min(...p.map((q) => q.s)), s1: Math.max(...p.map((q) => q.s)), t0: Math.min(...p.map((q) => q.t)), t1: Math.max(...p.map((q) => q.t)) }; }));
  const truckLot = !station && apronBoxF.length > 0;
  const apronMid = truckLot ? apronBoxF.reduce((sum, a) => sum + (a.s0 + a.s1) / 2, 0) / apronBoxF.length : null;
  const mainS = truckLot ? apronMid : mainT ? toFrame(f, mainT.door).s : (sLo + sHi) / 2;
  const xs = [];
  if (station && frontLen > 2.4 * xoverW + 4000) {
    const sIn = Number.isFinite(ae?.in?.offsetMm) ? ae.in.offsetMm : sLo + frontLen * 0.18;
    const sOut = Number.isFinite(ae?.out?.offsetMm) ? ae.out.offsetMm : sLo + frontLen * 0.82;
    xs.push({ s: clampS(sIn), role: 'in' }, { s: clampS(sOut), role: 'out' });
  } else xs.push({ s: clampS(Number.isFinite(ae?.in?.offsetMm) ? ae.in.offsetMm : mainS), role: 'both' });
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

  // Demand -----------------------------------------------------------------------------------------------------------------------------
  const need = (b) => Math.ceil(bayDemand(b).raw - 1e-9);
  const perBuilding = src.bs.map((b) => ({ id: b.id, required: need(b), provided: 0 }));
  const required = perBuilding.reduce((s, p) => s + p.required, 0);
  const accReq = required >= 2 ? accessibleRequired(required, c.buildingClass || 'class_8') : 0;
  const slotsWanted = required + Math.floor(accReq / 2) + (accReq % 2);
  const mainPt = mainT ? toFrame(f, mainT.door) : { s: (sLo + sHi) / 2, t: 0 };

  // Car park field: one spine from the crossover and double loaded cross aisles off it (carpark-field.js), laid in the lot frame so every
  // row is parallel to the frontage. The checks below are exact (no grid), the grid is only used afterwards to route to other doors.
  const aabb = (poly, pad) => { const p = poly.map((q) => toFrame(f, q)); return { s0: Math.min(...p.map((q) => q.s)) - pad, s1: Math.max(...p.map((q) => q.s)) + pad, t0: Math.min(...p.map((q) => q.t)) - pad, t1: Math.max(...p.map((q) => q.t)) + pad }; };
  const blockers = [];
  // 1.5 m clear round a building (the footpath along its face), 0.5 m round anything else solid; an entry canopy is not parked under.
  for (const b of src.bs) blockers.push(aabb(b.outline, FOOTPATH_W));
  for (const u of src.units) blockers.push(aabb(u.poly, 500));
  for (const s of src.obstacles) blockers.push(aabb(s, 500));
  for (const b of src.bs) for (const e of b.extras) if (e.kind === 'canopy' || e.kind === 'entry-canopy') blockers.push(aabb(e.polygon, 0));
  for (const r of src.reserved) blockers.push(aabb(r, 0));
  for (const b of src.bs) for (const e of b.extras) if (e.kind === 'apron' || e.kind === 'fuel-canopy' || e.kind === 'truck-canopy') blockers.push({ ...aabb(e.polygon, e.kind === 'apron' ? 0 : 1500), apron: e.kind === 'apron' });
  let apronPad = 0; // clear ground kept round a truck apron (the swing of the trucks): tried first, dropped when the lot is too tight for it
  const fpF = g.fp.map((q) => ({ x: q.s, y: q.t }));
  const edgesF = lot.boundary.map((a, i) => ({ a: toFrame(f, a), b: toFrame(f, lot.boundary[(i + 1) % lot.boundary.length]), m: frontEdges.has(i) ? frontLand : sideLand, front: frontEdges.has(i) }));
  const dSegF = (p, a, b) => { const dx = b.s - a.s; const dy = b.t - a.t; const t = Math.max(0, Math.min(1, ((p.x - a.s) * dx + (p.y - a.t) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(p.x - a.s - t * dx, p.y - a.t - t * dy); };
  const pointOk = (s, t, spine) => {
    if (!G.pointInPolygon({ x: s, y: t }, fpF)) return false;
    for (const e of edgesF) { if (spine && e.front) continue; if (dSegF({ x: s, y: t }, e.a, e.b) < e.m - 1) return false; }
    return true;
  };
  const okRect = (s0, s1, t0, t1, spine) => {
    if (spine) t0 = Math.max(t0, 60);
    if (s1 - s0 < 1 || t1 - t0 < 1) return false;
    if (s0 < win.s0 - 1 || s1 > win.s1 + 1 || t1 > win.t1 + 1) return false;
    for (const a of blockers) { const pd = a.apron ? apronPad : 0; const pt = spine ? 0 : pd; if (s0 < a.s1 + pd && s1 > a.s0 - pd && t0 < a.t1 + pt && t1 > a.t0 - pt) return false; }
    const ss = [s0, (s0 + s1) / 2, s1]; const tt = [t0, (t0 + t1) / 2, t1];
    for (let x = s0 + 1500; x < s1; x += 1500) ss.push(x);
    for (let y = t0 + 1500; y < t1; y += 1500) tt.push(y);
    for (const s of ss) for (const t of tt) if (!pointOk(s, t, spine)) return false;
    for (const q of fpF) if (q.x > s0 && q.x < s1 && q.y > t0 && q.y < t1) return false;
    return true;
  };
  // The truck route: a drive as wide as the crossover from the street straight to the apron. It is a no-bay zone like the apron itself.
  const driveApron = truckLot ? (apronBoxF.filter((a) => xs[0].s >= a.s0 - 1 && xs[0].s <= a.s1 + 1).sort((p, q) => p.t0 - q.t0)[0] || apronBoxF[0]) : null;
  const corridor = driveApron ? { s0: xs[0].s - xoverW / 2, s1: xs[0].s + xoverW / 2, t0: 0, t1: driveApron.t0 } : null;
  const queueOk = (s0, s1, t0, t1, spine) => (spine || t0 >= QUEUE_MM - 1) && okRect(s0, s1, t0, t1, spine);
  const clearOfCorridor = (s0, s1, t0, t1, spine) => queueOk(s0, s1, t0, t1, spine) && !(corridor && s0 < corridor.s1 - 1 && s1 > corridor.s0 + 1 && t0 < corridor.t1 - 1 && t1 > corridor.t0 + 1);
  const tryField = (sp) => fillField({ spineFromStart: true, ok: clearOfCorridor, sp, spineW: carW, aisleW: carW, bayL, bayW, wanted: slotsWanted, near: mainPt, tStart: Math.abs(sp - xs[0].s) < 1 ? 0 : frontLand, tFirst: Math.max(frontLand, QUEUE_MM), tEnd: win.t1, sMin: win.s0, sMax: win.s1 });
  let field = null;
  if (slotsWanted > 0) {
    // First choice: one side aisle (or an aisle across the front) with rows facing the building, beside the drive and clear of the apron.
    if (!station) {
      // Kept 1.5 m clear of the apron when the lot allows it; hard against the apron only when that puts the bays much nearer the door.
      for (const pad of truckLot ? [1500, 0] : [0]) {
        apronPad = pad;
        const cand = sideField({
          ok: okRect, gate: xs[0].s, driveW: xoverW, driveEnd: corridor ? corridor.t1 : null, A: carW, D: bayL, bayW, wanted: slotsWanted, door: mainPt, win,
          faces: blockers, tFaces: blockers.flatMap((a) => [a.t0, a.t1]), queue: QUEUE_MM,
        });
        if (!cand) continue;
        const met = cand.count >= slotsWanted;
        if (!field) { field = cand; continue; }
        const fMet = field.count >= slotsWanted;
        if ((met && !fMet) || (met === fMet && cand.cost + 25 < field.cost)) field = cand;
      }
      apronPad = 0;
    }
    if (!field || field.count < slotsWanted) {
      let comb = tryField(xs[0].s);
      if (!comb || comb.count < slotsWanted || !comb.double) {
        // The crossover line cannot carry enough bays, or only a single loaded aisle: try the spine elsewhere along the frontage (a drive joins
        // it to the crossover) and keep the better layout.
        let bestAlt = comb;
        const lo = sLo + sideLand + carW / 2 + 500; const hi = sHi - sideLand - carW / 2 - 500;
        const cand = [];
        for (let k = 1; k <= 14; k++) for (const sg of [-1, 1]) { const s = xs[0].s + sg * k * 3000; if (s >= lo && s <= hi) cand.push(s); }
        // Flush with a building, apron or the lot margin: a spine that sits hard against its neighbour leaves no sliver of ground between them.
        for (const a of blockers) for (const s of [a.s0 - carW / 2, a.s1 + carW / 2]) if (s >= lo && s <= hi) cand.push(s);
        cand.sort((p, q) => Math.abs(p - xs[0].s) - Math.abs(q - xs[0].s));
        for (const s of cand.slice(0, 30)) {
          const alt = tryField(s);
          if (betterField(alt, bestAlt, slotsWanted)) bestAlt = alt;
        }
        comb = bestAlt;
      }
      if (comb && (!field || comb.count > field.count)) field = comb;
    }
  }
  const world = (s, t) => toWorldF(f, s, t);
  const geo = field ? (field.kind === 'side' ? sideGeometry(field, world, { u: f.u, n: f.n }) : fieldGeometry(field, world, { u: f.u, n: f.n })) : { aisles: [], rows: [], paved: [] };
  const fieldRects = !field ? [] : field.kind === 'side' ? field.rects.map((r) => ({ s0: r.s0, s1: r.s1, t0: r.t0, t1: r.t1 })) : [{ s0: field.spine.s0, s1: field.spine.s1, t0: field.spine.t0, t1: field.spine.t1 }, ...field.aisles.flatMap((a) => a.sides.map((sd) => ({ s0: sd.s0, s1: sd.s1, t0: a.qa - carW / 2, t1: a.qa + carW / 2 })))];
  const spineAtCrossover = !!field && Math.abs((field.spine.s0 + field.spine.s1) / 2 - xs[0].s) < 1;

  // Accessible groups [bay][zone][bay] nearest the main entry, then the allocation of bays to buildings.
  const frameDist = (sl) => { const q = toFrame(f, sl.centre); return Math.hypot(q.s - mainPt.s, q.t - mainPt.t); };
  const rows = geo.rows;
  const accProvided = markAccessible(rows, accReq, frameDist);
  const zones = rows.reduce((s, r) => s + r.slots.filter((x) => x.kind === 'zone').length, 0);
  const provided = rows.reduce((s, r) => s + r.slots.length, 0);
  const providedBays = provided - zones;
  const allSlots = rows.flatMap((r) => r.slots.map((sl) => { const q = toFrame(f, sl.centre); return { sl, row: r, _s: q.s, _t: q.t }; })).filter((x) => x.sl.kind !== 'zone');
  const pool = [...allSlots];
  const doorOf = new Map(targets.filter((t) => t.type !== 'fuel-canopy').map((t) => [t.buildingId, toFrame(f, t.door)]));
  for (const pb of perBuilding) {
    const d = doorOf.get(pb.id);
    if (!d) continue;
    pool.sort((p, q) => Math.hypot(p._s - d.s, p._t - d.t) - Math.hypot(q._s - d.s, q._t - d.t));
    for (let k = 0; k < pb.required && pool.length; k++) { const x = pool.shift(); x.row.buildingId = x.row.buildingId || pb.id; pb.provided += 1; }
  }
  for (const x of pool) x.row.buildingId = x.row.buildingId || perBuilding[0]?.id || null;
  for (const r of rows) { r.buildingId = r.buildingId || perBuilding[0]?.id || null; delete r._fr; }

  // Paint the field on the grid, then route to every door and crossover the field does not already serve.
  const baseKinds = g.a.slice();
  for (const a of geo.aisles) paint(g, a.polygon, AISLE, [FREE, BLOCK, RESERVED]);
  for (const r of rows) for (const ba of r.bayAreas) paint(g, ba.polygon, BAY, [FREE, BLOCK, RESERVED]);
  const passable = (v) => v === FREE || v === RESERVED || v === AISLE;
  const rad = Math.max(1, Math.ceil((aisleW / 2) / g.cell - 0.5));
  const blocked = erode(g, rad, passable);
  const blockedNarrow = erode(g, Math.max(1, Math.ceil((4000 / 2) / g.cell - 0.5)), passable);
  const aisleCells = new Set();
  const segs = [];
  const unreachable = [];
  const routed = [];
  for (let j = 0; j < g.H; j++) for (let i = 0; i < g.W; i++) if (g.a[j * g.W + i] === AISLE) aisleCells.add(j * g.W + i);
  // Routes start from the field's centre lines only (a few hundred cells, not every paved cell).
  for (const r of fieldRects) {
    const wide = r.s1 - r.s0 > r.t1 - r.t0;
    const n = Math.ceil((wide ? r.s1 - r.s0 : r.t1 - r.t0) / g.cell);
    for (let k = 0; k <= n; k++) {
      const cc = wide ? cellOf(g, r.s0 + k * g.cell, (r.t0 + r.t1) / 2) : cellOf(g, (r.s0 + r.s1) / 2, r.t0 + k * g.cell);
      if (cc.i >= 0 && cc.j >= 0 && cc.i < g.W && cc.j < g.H) routed.push(cc.j * g.W + cc.i);
    }
  }
  const startCells = crossovers.map((x) => {
    const cc = cellOf(g, x.s, aisleW / 2 + 200);
    return nearestFree(g, blocked, cc.i, cc.j, 40) || nearestFree(g, blockedNarrow, cc.i, cc.j, 40);
  });
  const costAt = (i, j) => (aisleCells.has(j * g.W + i) ? -0.7 : at(g, i, j) === RESERVED ? 0.2 : 0);
  const addPath = (path, kind) => {
    for (const cc of path) aisleCells.add(cc.j * g.W + cc.i);
    for (const sgm of segmentsOf(g, path)) segs.push({ ...sgm, kind });
  };
  const nearField = (p, d) => fieldRects.some((r) => p.s >= r.s0 - d && p.s <= r.s1 + d && p.t >= r.t0 - d && p.t <= r.t1 + d);
  const fromCell = (k) => ({ i: k % g.W, j: Math.floor(k / g.W) });
  const order = [...targets].sort((p, q) => toFrame(f, p.point).t - toFrame(f, q.point).t);
  const firstStart = startCells[spineAtCrossover ? 1 : 0] || startCells[0];
  if (!routed.length && startCells[0]) routed.push(startCells[0].j * g.W + startCells[0].i);
  if (routed.length || firstStart) {
    for (const tg of order) {
      const tf = toFrame(f, tg.point);
      if (tg.ped && field) { tg.cell = null; continue; } // an office door beside a truck apron is reached by a footpath from the car park, never by an aisle through the apron
      if (field && tg.type !== 'fuel-canopy' && nearField(tf, 3500)) { tg.cell = null; continue; } // the field already passes the door
      const tc = cellOf(g, tf.s, tf.t);
      const goal = nearestFree(g, blocked, tc.i, tc.j, 40) || nearestFree(g, blockedNarrow, tc.i, tc.j, 40);
      if (!goal) { unreachable.push(tg.buildingId); continue; }
      const srcCells = [...new Set(routed)].map(fromCell).map((q) => ({ q, d: Math.abs(q.i - goal.i) + Math.abs(q.j - goal.j) })).sort((p, q) => p.d - q.d).slice(0, 16).map((x) => x.q); // the nearest few network cells are the only sensible starts
      let path = route(g, blocked, srcCells, goal, costAt) || route(g, blockedNarrow, srcCells, goal, costAt);
      let used = goal;
      if (!path) { // the nearest free cell can sit in a pocket cut off from the network: try the next few
        for (const alt of [...nearestFreeList(g, blocked, tc.i, tc.j, 24), ...nearestFreeList(g, blockedNarrow, tc.i, tc.j, 24)]) {
          const wide = srcCells.length ? [...new Set(routed)].map(fromCell).sort((p, q) => (Math.abs(p.i - alt.i) + Math.abs(p.j - alt.j)) - (Math.abs(q.i - alt.i) + Math.abs(q.j - alt.j))).slice(0, 16) : srcCells;
          path = route(g, blocked, wide, alt, costAt) || route(g, blockedNarrow, wide, alt, costAt);
          if (path) { used = alt; break; }
        }
      }
      if (!path) { unreachable.push(tg.buildingId); continue; }
      addPath(path, tg.type === 'fuel-canopy' ? 'forecourt' : 'aisle');
      for (const cc of path) routed.push(cc.j * g.W + cc.i);
      tg.cell = used;
    }
    // Each crossover the spine does not sit on joins the network, with an entry run from the boundary to its first cell.
    for (let k = 0; k < startCells.length; k++) {
      const sc = startCells[k];
      if (!sc || (k === 0 && spineAtCrossover)) continue;
      const net = [...new Set(routed)].map(fromCell);
      let best = null;
      let cands = net.map((q) => ({ q, d: Math.abs(q.i - sc.i) + Math.abs(q.j - sc.j) })).sort((p, q) => p.d - q.d).slice(0, 6);
      if (k === 0 && field) { // the main crossover runs to the mouth of the spine first
        const mc = cellOf(g, (field.spine.s0 + field.spine.s1) / 2, field.spine.t0 + 1500);
        const goal = nearestFree(g, blocked, mc.i, mc.j, 12) || nearestFree(g, blockedNarrow, mc.i, mc.j, 12);
        if (goal) cands = [{ q: goal, d: Math.abs(goal.i - sc.i) + Math.abs(goal.j - sc.j) }, ...cands];
      }
      for (const cd of cands) {
        if (cd.q.i === sc.i && cd.q.j === sc.j) { best = [sc]; break; }
        const pth = route(g, blocked, [sc], cd.q, costAt) || route(g, blockedNarrow, [sc], cd.q, costAt);
        if (pth && (!best || pth.length < best.length)) best = pth;
        if (best && k === 0 && field) break; // the spine mouth is the one place the main crossover has to reach
      }
      if (best) { addPath(best, 'aisle'); for (const cc of best) routed.push(cc.j * g.W + cc.i); } else if (net.length) unreachable.push(`crossover:${k}`);
      const cs = centreOf(g, sc.i, sc.j);
      segs.push({ a: { s: crossovers[k].s, t: 0 }, b: { s: cs.s, t: cs.t }, dir: 'v', kind: 'entry' });
      if (Math.abs(cs.s - crossovers[k].s) > 1) segs.push({ a: { s: crossovers[k].s, t: cs.t }, b: { s: cs.s, t: cs.t }, dir: 'h', kind: 'entry' });
    }
  }
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
  const extraSegs = [];

  // Disjoint paving rectangles for the routed links (the grid cells of the connectors merged into runs), cut back where the field already paves.
  const mask = new Uint8Array(g.W * g.H);
  for (const sg of segs) { const r = strip(sg, aisleW); const a = cellOf(g, r.s0, r.t0); const b = cellOf(g, r.s1, r.t1);
    for (let j = Math.max(0, a.j); j <= Math.min(g.H - 1, b.j); j++) for (let i = Math.max(0, a.i); i <= Math.min(g.W - 1, b.i); i++) {
      const cc = centreOf(g, i, j);
      if (cc.s >= r.s0 && cc.s <= r.s1 && cc.t >= r.t0 && cc.t <= r.t1 && baseKinds[j * g.W + i] !== RESERVED && baseKinds[j * g.W + i] !== SOLID) mask[j * g.W + i] = 1;
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
  const fieldPolys = [...geo.aisles.map((a) => a.polygon), ...rows.map((r) => r.bayAreas[0].polygon)]; // connectors are cut back where the field already paves or holds bays
  const cutField = (poly) => {
    let pieces = [poly];
    for (const fp of fieldPolys) {
      const next = [];
      for (const pc of pieces) {
        const ov = overlapArea(pc, fp);
        if (ov < 1) next.push(pc); else next.push(...holeFree(boolean([pc], [fp], 'diff')).filter((r) => polyArea(r) > 2e6));
      }
      pieces = next;
    }
    return pieces;
  };
  const bayPolys = rows.flatMap((r) => r.slots.map((sl) => sl.poly));
  const pavedPolys = [...geo.paved];
  let pk = 0;
  for (const o of pavedAisles) {
    const rect = rectWorld(f, g.s0 + o.i0 * g.cell, g.s0 + (o.i1 + 1) * g.cell, g.t0 + o.j0 * g.cell, g.t0 + (o.j1 + 1) * g.cell);
    for (const pc of cutField(rect)) {
      if (bayPolys.some((bp) => overlapArea(pc, bp) > 1e5)) continue; // a connector never runs over a bay
      pavedPolys.push({ id: `sw:paved:r${pk++}`, polygon: pc });
    }
  }

  // Aisle polygons ---------------------------------------------------------------------------------------------------------------------
  const finalSegs = [...segs.filter((s) => s.kind !== 'entry'), ...segs.filter((s) => s.kind === 'entry')];
  const routedAisles = finalSegs.map((sg, k) => {
    const r = strip(sg, aisleW);
    return { id: `sw:aisle:r${k}`, polygon: rectWorld(f, r.s0, r.s1, r.t0, r.t1), centre: [toWorldF(f, sg.a.s, sg.a.t), toWorldF(f, sg.b.s, sg.b.t)], widthMm: sg.w || aisleW, kind: sg.kind === 'forecourt' ? 'forecourt' : 'aisle' };
  });
  const aisles = [...geo.aisles, ...routedAisles];
  const carports = c.parking?.covered ? carportsOf(rows) : [];

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
  // The footpath from the car park to an office door beside a truck apron: along the building face, then across to the nearest aisle.
  const pedFoot = [];
  for (const tg of targets) {
    if (!tg.ped || !field) continue;
    const d = toFrame(f, tg.door);
    const W = FOOTPATH_W;
    const aisleRects = (field.kind === 'side' ? field.rectsInfo.filter((r) => !r.truckDrive) : fieldRects);
    const box = (poly) => { const p = poly.map((q) => toFrame(f, q)); return { s0: Math.min(...p.map((q) => q.s)), s1: Math.max(...p.map((q) => q.s)), t0: Math.min(...p.map((q) => q.t)), t1: Math.max(...p.map((q) => q.t)) }; };
    const noGo = [...rows.flatMap((r) => r.bayAreas.map((ba) => box(ba.polygon))), ...apronBoxF, ...src.bs.map((b) => box(b.outline))];
    const hits = (r) => noGo.some((a) => r.s0 < a.s1 - 1 && r.s1 > a.s0 + 1 && r.t0 < a.t1 - 1 && r.t1 > a.t0 + 1);
    // The leg that crosses from the car park to the building face: as close to the door as it can be without crossing a bay row or the apron.
    const xsC = new Set([d.s]);
    for (const a of noGo) { xsC.add(a.s0 - W / 2 - 250); xsC.add(a.s1 + W / 2 + 250); }
    for (const r of aisleRects) { xsC.add(r.s0 + W / 2); xsC.add(r.s1 - W / 2); }
    let plan = null;
    for (const sl of [...xsC].sort((p, q) => Math.abs(p - d.s) - Math.abs(q - d.s))) {
      for (const r of aisleRects) {
        if (sl - W / 2 < r.s0 - 1 || sl + W / 2 > r.s1 + 1 || r.t1 > d.t) continue;
        const leg = { s0: sl - W / 2, s1: sl + W / 2, t0: r.t1, t1: d.t - W };
        const along = { s0: Math.min(sl, d.s) - W / 2, s1: Math.max(sl, d.s) + W / 2, t0: d.t - W, t1: d.t };
        const len = Math.abs(sl - d.s) + (d.t - W - r.t1);
        if (leg.t1 - leg.t0 > 1 && hits(leg)) continue;
        if (!plan || len < plan.len) plan = { leg, along, sl, len };
      }
      if (plan) break;
    }
    if (!plan) continue;
    const legs = [];
    if (Math.abs(plan.sl - d.s) > 500) legs.push(rectWorld(f, Math.min(plan.sl, d.s), Math.max(plan.sl, d.s), d.t - W, d.t));
    if (plan.leg.t1 - plan.leg.t0 > 500) legs.push(rectWorld(f, plan.leg.s0, plan.leg.s1, plan.leg.t0, plan.leg.t1));
    for (const poly of legs) pedFoot.push({ id: `sw:foot:${footpaths.length + pedFoot.length}`, buildingId: tg.buildingId, polygon: poly, pedestrian: true });
    tg.footReached = true;
  }
  footpaths.push(...pedFoot);
  const landscape = [];
  const inLot = (poly) => poly.every((q) => G.pointInPolygon(q, lot.boundary));
  const gaps = crossovers.map((x) => [x.s - xoverW / 2 - 300, x.s + xoverW / 2 + 300]).sort((p, q) => p[0] - q[0]);
  let cursor = sLo + 0;
  const addStrip = (s0, s1) => { if (s1 - s0 < 1200) return; const poly = rectWorld(f, s0, s1, 0, frontLand - 300); if (inLot(poly)) landscape.push({ id: `sw:land:${landscape.length}`, polygon: poly }); };
  for (const [a, b] of gaps) { addStrip(cursor, a); cursor = Math.max(cursor, b); }
  addStrip(cursor, sHi);
  const tMaxLot = win.t1;
  for (const side of [0, 1]) {
    const s0 = side ? sHi - sideLand : sLo; const s1 = side ? sHi : sLo + sideLand;
    const poly = rectWorld(f, s0, s1, frontLand, tMaxLot);
    if (inLot(poly)) landscape.push({ id: `sw:land:${landscape.length}`, polygon: poly });
  }

  // Reachability of every building (door point within 4 m of an aisle or forecourt) ---------------------------------------------------
  const nearAisle = (p) => {
    const q = toFrame(f, p);
    return nearField(q, 4000) || finalSegs.some((sg) => {
      const r = strip({ ...sg, w: aisleW + 8000 }, 0);
      return q.s >= r.s0 && q.s <= r.s1 && q.t >= r.t0 && q.t <= r.t1;
    }) || forecourts.some((fc) => G.pointInPolygon(p, fc.polygon)) || aprons.some((ap) => G.pointInPolygon(p, ap.polygon));
  };
  const reachable = {};
  for (const t of targets) if (t.type !== 'fuel-canopy') reachable[t.buildingId] = (t.footReached || nearAisle(t.door)) && !unreachable.includes(t.buildingId);

  return {
    version: SITEWORKS_VERSION,
    kind: station ? 'service-station' : 'general',
    aisleMm: aisleW,
    crossovers: crossovers.map(({ s, ...x }) => x),
    aisles,
    carports,
    field: field ? { spineS: Math.round((field.spine.s0 + field.spine.s1) / 2), cols: field.cols, count: field.count, aisleMm: carW, bayW, bayL } : null,
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
  const est = estateWorks(c, lot);
  if (est) return est;
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

/**
 * A strata estate (estate.js) carries its own connected pavement network: the crossover(s), entry drive, car park aisles, the driveway or
 * aisle between the door faces, door aprons, footpaths, turning heads, frontage landscaping and the balance of a huge lot. It is only valid
 * for the rows it was drawn for (a moved row makes it stale and the plain row layout applies).
 */
function estateWorks(c, lot) {
  const e = c?.estate;
  if (!e || !e.network || e.sig !== rowsSignature(c.rows)) return null;
  const n = e.network;
  const provided = (c.parking?.extra || []).reduce((t, x) => t + (x.count || 0), 0);
  return {
    version: SITEWORKS_VERSION, kind: 'estate', family: e.family, aisleMm: e.aisleMm,
    crossovers: n.crossovers, aisles: n.aisles, pavedAisles: n.paved.map(({ id, polygon }) => ({ id, polygon })), forecourts: [], aprons: n.aprons, footpaths: n.foot, landscape: n.landscape,
    pedestrianEntries: n.foot.filter((x) => x.pedestrian).map((x) => x.id),
    balance: e.balance || null, estateWindow: n.window, warnings: [], bayRows: [],
    summary: { required: 0, provided, accessibleRequired: 0, accessibleProvided: 0, limited: false, perBuilding: [], reachable: {}, unreachable: [] }, generatedAt: 0,
  };
}

/** The key of what a layout depends on: lot, building placements and parameters, strata rows. A change means the layout is out of date. */
export function siteKey(project) {
  const c = project?.commercial;
  const lot = lotOf(project);
  if (!c || !lot) return '';
  const r = (v) => Math.round(Number(v) || 0);
  return JSON.stringify([
    lot.boundary?.map((q) => [r(q.x), r(q.y)]), lot.frontEdges, lot.envelope?.length || 0,
    (c.buildings || []).map((b) => [b.id, b.type, r(b.place?.x), r(b.place?.y), Math.round((Number(b.place?.rotationDeg) || 0) * 10), b.params]),
    (c.rows || []).map((rw) => [rw.id, r(rw.x), r(rw.y), r(rw.rotationDeg), rw.count]),
    c.estate?.sig || null, (c.parking?.extra || []).length,
    c.parking?.bayW, c.parking?.bayL, c.parking?.aisleMm, c.parking?.enabled, c.parking?.covered, c.buildingClass,
    c.accessEdit ? [c.accessEdit.in?.offsetMm, c.accessEdit.out?.offsetMm, c.accessEdit.widthMm] : null,
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
