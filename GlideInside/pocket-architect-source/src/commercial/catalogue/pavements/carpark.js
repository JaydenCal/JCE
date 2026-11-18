// Car park fill: the pure side of the Car park tool. A drawn hardstand (project.commercial.pavements, id "hs_...") can carry
// `carpark: { bayAngle, angleDeg, islands, accessible, shifts, removed, ... }`. The bays are NOT stored: carparkLayout() derives them from the
// outline every time, so rotating, resizing or reshaping the hardstand re-flows the bays live. What the person edits by hand (a bay row slid
// along its length, a deleted bay) is kept as small keyed overrides on the same entry.
//
// Layout: bay rows run along the car park angle (the longest edge unless the person sets one). Rows are double loaded modules, bay row,
// aisle, bay row, repeated; the module offset that fits the most bays is used. Standard 90 degree bays are 2.6 x 5.4 m with a 6.2 m aisle;
// 60 and 45 degree bays have one way aisles (direction alternates module by module). Accessible bays come in groups of
// [bay][shared zone][bay] near the entrance. A clear gap is kept where a road, driveway or crossover touches the outline.
// Dimensions are indicative (AS/NZS 2890.1 and 2890.6, check with council). No DOM, plain data in plan mm, y down.

import { polyArea, pointInPoly, convexOverlap } from './geom.js';
import { accessibleRequired } from '../../rules.js';

export const CP_PREFIX = 'hs_';
export const BAY_TYPES = Object.freeze({
  90: { angle: 90, aisleMm: 6200, oneWay: false, label: '90 degree bays, two way aisle' },
  60: { angle: 60, aisleMm: 4200, oneWay: true, label: '60 degree bays, one way aisle' },
  45: { angle: 45, aisleMm: 3800, oneWay: true, label: '45 degree bays, one way aisle' },
});
export const CARPARK_DEFAULTS = Object.freeze({ bayAngle: 90, angleDeg: null, bayW: 2600, bayL: 5400, islands: false, accessible: null, shifts: {}, removed: [], flip: false });
/** The car park being edited right now: its stored bays are not drawn (the tool draws the live layout over it). */
export const liveCarpark = { id: null };
export const CARPARK_NOTE = 'Indicative bay layout to AS/NZS 2890.1 and 2890.6 dimensions. Line marking is designed to AS 1742, check with council.';

const rad = (d) => (d * Math.PI) / 180;
const num = Number.isFinite;

/** The effective settings for a car park entry (defaults filled in, bay angle limited to 90, 60 or 45). */
export function cpConfig(cp = {}) {
  const c = { ...CARPARK_DEFAULTS, ...(cp || {}) };
  c.bayAngle = BAY_TYPES[c.bayAngle] ? Number(c.bayAngle) : 90;
  c.bayW = num(c.bayW) && c.bayW >= 2000 ? c.bayW : 2600;
  c.bayL = num(c.bayL) && c.bayL >= 4500 ? c.bayL : 5400;
  c.angleDeg = num(c.angleDeg) ? c.angleDeg : null;
  c.shifts = c.shifts && typeof c.shifts === 'object' ? c.shifts : {};
  c.removed = Array.isArray(c.removed) ? c.removed : [];
  return c;
}

/** Angle in degrees (0 to 180) of the longest edge of a polygon. */
export function longestEdgeAngle(poly) {
  let best = { l: 0, a: 0 };
  poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length]; const l = Math.hypot(q.x - p.x, q.y - p.y); if (l > best.l) best = { l, a: (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI }; });
  return ((best.a % 180) + 180) % 180;
}

const shrink = (poly, e) => {
  const c = poly.reduce((s, p) => ({ x: s.x + p.x / poly.length, y: s.y + p.y / poly.length }), { x: 0, y: 0 });
  return poly.map((p) => { const d = Math.hypot(c.x - p.x, c.y - p.y) || 1; const k = Math.min(1, e / d); return { x: p.x + (c.x - p.x) * k, y: p.y + (c.y - p.y) * k }; });
};
const mids = (p) => p.map((a, i) => { const b = p[(i + 1) % p.length]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; });
const centroid = (p) => ({ x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length });

/** True when the convex candidate lies inside the polygon (a 20 mm tolerance lets a bay sit against the edge). */
function fitsIn(poly, cand) {
  const s = shrink(cand, 20);
  for (const q of [...s, ...mids(s), centroid(s)]) if (!pointInPoly(q, poly)) return false;
  for (const v of poly) if (pointInPoly(v, s)) return false;
  return true;
}

/**
 * Entry gaps: where another road, driveway or crossover outline touches the hardstand outline. Returns
 * [{ x, y, nx, ny, widthMm }] with (nx, ny) the unit normal pointing into the hardstand. `others` is a list of rings.
 */
export function entryGaps(polygon, others) {
  const out = [];
  if (!polygon || polygon.length < 3 || !others?.length) return out;
  const step = 250; const tol = 350;
  const dseg = (p, a, b) => { const dx = b.x - a.x; const dy = b.y - a.y; const l2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)); return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t); };
  const near = (p, ring) => { if (pointInPoly(p, ring)) return true; for (let i = 0; i < ring.length; i++) if (dseg(p, ring[i], ring[(i + 1) % ring.length]) <= tol) return true; return false; };
  for (const ring of others) {
    if (!ring || ring.length < 3) continue;
    polygon.forEach((a, i) => {
      const b = polygon[(i + 1) % polygon.length];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L < 1) return;
      const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
      let n = { x: -u.y, y: u.x };
      const mid = { x: (a.x + b.x) / 2 + n.x * 150, y: (a.y + b.y) / 2 + n.y * 150 };
      if (!pointInPoly(mid, polygon)) n = { x: -n.x, y: -n.y };
      let run = null;
      const flush = () => { if (run && run.t1 - run.t0 >= 1000) { const t = (run.t0 + run.t1) / 2; out.push({ x: Math.round(a.x + u.x * t), y: Math.round(a.y + u.y * t), nx: n.x, ny: n.y, widthMm: Math.round(run.t1 - run.t0) }); } run = null; };
      for (let t = 0; t <= L + 1; t += step) {
        const q = { x: a.x + u.x * Math.min(t, L), y: a.y + u.y * Math.min(t, L) };
        if (near(q, ring)) run = run ? { t0: run.t0, t1: Math.min(t, L) } : { t0: Math.min(t, L), t1: Math.min(t, L) }; else flush();
      }
      flush();
    });
  }
  return out;
}

/**
 * carparkLayout(polygon, cfg, { gaps, obstacles, near }) ->
 * { angleDeg, bayAngle, count, accessible, required, zones, bays: [{ key, row, col, kind: 'bay' | 'accessible' | 'zone', poly, centre }],
 *   islands: [poly], rows: [{ row, count, shift, vMid }], arrows: [{ x, y, rotationDeg }], entries: [{ x, y, clear }], aisleMm, dims }
 * `gaps` are entryGaps() results, `obstacles` rings (a road crossing the area, a building) no bay may overlap, `near` the point accessible
 * bays should be close to (the entrance). Bays removed by the person (cfg.removed, keys "row:col") are left out.
 */
export function carparkLayout(polygon, cfgIn = {}, { gaps = [], obstacles = [], near = null } = {}) {
  const cfg = cpConfig(cfgIn);
  const empty = { angleDeg: 0, bayAngle: cfg.bayAngle, count: 0, accessible: 0, required: 0, zones: 0, bays: [], islands: [], rows: [], arrows: [], entries: [], aisleMm: BAY_TYPES[cfg.bayAngle].aisleMm, dims: null };
  if (!Array.isArray(polygon) || polygon.length < 3 || Math.abs(polyArea(polygon)) < 2e7) return empty;
  const bt = BAY_TYPES[cfg.bayAngle];
  const ang = cfg.angleDeg != null ? cfg.angleDeg : longestEdgeAngle(polygon);
  const u = { x: Math.cos(rad(ang)), y: Math.sin(rad(ang)) };
  const v = { x: -u.y, y: u.x };
  const toL = (p) => ({ x: p.x * u.x + p.y * u.y, y: p.x * v.x + p.y * v.y });
  const toP = (p) => ({ x: Math.round(p.x * u.x + p.y * v.x), y: Math.round(p.x * u.y + p.y * v.y) });
  const L = polygon.map(toL);
  const minU = Math.min(...L.map((p) => p.x)); const maxU = Math.max(...L.map((p) => p.x));
  const minV = Math.min(...L.map((p) => p.y)); const maxV = Math.max(...L.map((p) => p.y));
  const a = rad(cfg.bayAngle);
  const D = cfg.bayL * Math.sin(a); // depth across the row
  const pitch = cfg.bayW / Math.sin(a); // bay to bay along the row
  const lean = D / Math.tan(a); // sideways shift between the aisle edge and the back of an angled bay
  const A = bt.aisleMm;
  const obsL = (obstacles || []).filter((r) => r?.length >= 3).map((r) => r.map(toL));
  const clearL = (gaps || []).map((g) => {
    const n = toL({ x: g.nx, y: g.ny }); const o = toL({ x: 0, y: 0 });
    const nl = { x: n.x - o.x, y: n.y - o.y }; const tl = { x: -nl.y, y: nl.x };
    const c = toL(g); const half = Math.max(1500, Math.min(3500, (g.widthMm || 6000) / 2)); const len = D + A + 600;
    const poly = [{ x: c.x - tl.x * half - nl.x * 400, y: c.y - tl.y * half - nl.y * 400 }, { x: c.x + tl.x * half - nl.x * 400, y: c.y + tl.y * half - nl.y * 400 }, { x: c.x + tl.x * half + nl.x * len, y: c.y + tl.y * half + nl.y * len }, { x: c.x - tl.x * half + nl.x * len, y: c.y - tl.y * half + nl.y * len }];
    return { g, poly, plan: poly.map(toP) };
  });

  function build(v0) {
    const rows = [];
    let k = 0; let m = 0;
    for (let vv = v0; vv < maxV; vv += 2 * D + A, m++) {
      rows.push({ row: k++, va: vv, vb: vv + D, face: 1, m });
      rows.push({ row: k++, va: vv + D + A, vb: vv + 2 * D + A, face: -1, m });
    }
    const bays = [];
    const info = [];
    for (const r of rows) {
      const shift = Number(cfg.shifts[r.row]) || 0;
      const sg = (r.m % 2 ? -1 : 1) * (cfg.flip ? -1 : 1);
      const N = Math.ceil((maxU - minU) / pitch) + 6;
      const back = r.face === 1 ? r.va : r.vb;
      const faceV = r.face === 1 ? r.vb : r.va;
      const reach = r.face === 1 ? [faceV, faceV + A] : [faceV - A, faceV];
      let cnt = 0;
      for (let i = -3 - Math.ceil(Math.abs(shift) / pitch); i < N; i++) {
        const u0 = minU + shift + i * pitch;
        const off = cfg.bayAngle === 90 ? 0 : sg * lean;
        const poly = [{ x: u0, y: back }, { x: u0 + pitch, y: back }, { x: u0 + pitch + off, y: faceV }, { x: u0 + off, y: faceV }];
        if (cfg.bayAngle === 90) { poly[2].x = u0 + cfg.bayW; poly[1].x = u0 + cfg.bayW; }
        const aisle = [{ x: u0 + off, y: reach[0] }, { x: u0 + pitch + off, y: reach[0] }, { x: u0 + pitch + off, y: reach[1] }, { x: u0 + off, y: reach[1] }];
        const lo = Math.min(...poly.map((p) => p.x)); const hi = Math.max(...poly.map((p) => p.x));
        if (hi < minU || lo > maxU) continue;
        const strip = [poly[3], poly[2], { x: poly[2].x, y: poly[2].y + r.face * A }, { x: poly[3].x, y: poly[3].y + r.face * A }];
        if (!fitsIn(L, poly) || !fitsIn(L, strip)) continue;
        if (obsL.some((o) => convexOverlapAny(poly, o))) continue;
        if (clearL.some((c) => convexOverlap(poly, c.poly, 1))) continue;
        bays.push({ key: `${r.row}:${i}`, row: r.row, col: i, kind: 'bay', lpoly: poly });
        cnt++;
      }
      info.push({ row: r.row, shift, vMid: (r.va + r.vb) / 2, count: cnt, m: r.m, sg });
    }
    return { bays, info, rows };
  }

  let best = null;
  const period = 2 * D + A;
  for (let o = 0; o < period; o += 250) {
    const b = build(minV - o);
    const n = b.bays.filter((x) => !cfg.removed.includes(x.key)).length;
    if (!best || n > best.n) best = { n, b, o };
  }
  const { bays: all, info, rows } = best.b;
  let work = all.filter((b) => !cfg.removed.includes(b.key));

  // runs of consecutive bays in a row (islands and accessible groups work along a run)
  const runsOf = (list) => {
    const byRow = new Map();
    for (const b of list) { if (!byRow.has(b.row)) byRow.set(b.row, []); byRow.get(b.row).push(b); }
    const runs = [];
    for (const arr of byRow.values()) {
      arr.sort((p, q) => p.col - q.col);
      let cur = [];
      for (const b of arr) { if (cur.length && b.col !== cur[cur.length - 1].col + 1) { runs.push(cur); cur = []; } cur.push(b); }
      if (cur.length) runs.push(cur);
    }
    return runs;
  };
  const islandsL = [];
  if (cfg.islands) {
    const drop = new Set();
    for (const run of runsOf(work)) {
      if (run.length < 4) continue;
      run.forEach((b, j) => { if (j === 0 || j === run.length - 1 || (j % 11 === 10 && j < run.length - 2)) { drop.add(b.key); islandsL.push(b.lpoly); } });
    }
    work = work.filter((b) => !drop.has(b.key));
  }

  // accessible bays: [bay][zone][bay] groups nearest the entrance
  const nearL = near ? toL(near) : (clearL[0] ? toL(clearL[0].g) : { x: minU, y: minV });
  const dist2 = (b) => { const c = centroid(b.lpoly); return Math.hypot(c.x - nearL.x, c.y - nearL.y); };
  const baysTotal = work.length;
  let req = baysTotal >= 2 ? 1 : 0;
  const zonesFor = (n) => Math.floor(n / 2) + (n % 2);
  const table = cfg.buildingClass || 'class_8';
  for (let t = 0; t < 6 && req > 0; t++) { const nx = accessibleRequired(baysTotal - zonesFor(req), table); if (nx === req) break; req = nx; }
  const want = num(cfg.accessible) ? Math.max(0, Math.round(cfg.accessible)) : req;
  const kindOf = new Map();
  let provided = 0;
  if (want > 0) {
    const runs = runsOf(work);
    let left = want;
    const used = new Set();
    const pick = (size) => {
      let bestG = null;
      for (const run of runs) for (let i = 0; i + size <= run.length; i++) {
        const grp = run.slice(i, i + size);
        if (grp.some((b) => used.has(b.key))) continue;
        const d = dist2(grp[0]);
        if (!bestG || d < bestG.d) bestG = { d, grp };
      }
      return bestG?.grp || null;
    };
    while (left > 0) {
      const g = (left >= 2 && pick(3)) || pick(2);
      if (!g) break;
      g.forEach((b) => used.add(b.key));
      if (g.length === 3) { kindOf.set(g[0].key, 'accessible'); kindOf.set(g[1].key, 'zone'); kindOf.set(g[2].key, 'accessible'); provided += 2; left -= 2; } else { kindOf.set(g[0].key, 'accessible'); kindOf.set(g[1].key, 'zone'); provided += 1; left -= 1; }
    }
  }
  const outBays = work.map((b) => ({ key: b.key, row: b.row, col: b.col, kind: kindOf.get(b.key) || 'bay', poly: b.lpoly.map(toP), centre: toP(centroid(b.lpoly)) }));
  const zones = outBays.filter((b) => b.kind === 'zone').length;

  // one way arrows along the aisles of angled bays, and the aisle direction
  const arrows = [];
  if (bt.oneWay) {
    for (const r of rows) {
      if (r.face !== 1) continue;
      const row = info.find((x) => x.row === r.row);
      const next = info.find((x) => x.row === r.row + 1);
      if (!row?.count && !next?.count) continue;
      const vm = r.vb + A / 2;
      const dir = (r.m % 2 ? -1 : 1) * (cfg.flip ? -1 : 1);
      const rowBays = outBays.filter((b) => b.row === r.row || b.row === r.row + 1);
      if (!rowBays.length) continue;
      const us = rowBays.map((b) => toL(b.centre).x);
      for (let uu = Math.min(...us) + 3000; uu <= Math.max(...us) - 1500; uu += 12000) {
        const c = toP({ x: uu, y: vm });
        arrows.push({ x: c.x, y: c.y, rotationDeg: ang + (dir > 0 ? 0 : 180) });
      }
    }
  }

  return {
    angleDeg: ang, bayAngle: cfg.bayAngle, count: outBays.length - zones, accessible: provided, required: req, zones,
    bays: outBays, islands: islandsL.map((p) => p.map(toP)), arrows, aisleMm: A,
    rows: info.filter((x) => x.count > 0).map((x) => ({ row: x.row, count: x.count, shift: x.shift, vMid: x.vMid })),
    entries: clearL.map((c) => ({ x: c.g.x, y: c.g.y, clear: c.plan })),
    dims: { bayW: cfg.bayW, bayL: cfg.bayL, aisleMm: A, depthMm: Math.round(D), pitchMm: Math.round(pitch), uAxis: u, vAxis: v },
  };
}

function convexOverlapAny(a, b) {
  // b may be concave or convex: test against its bounding box first, then by sampling the candidate corners and centre inside b
  const s = shrink(a, 20);
  for (const q of [...s, centroid(s)]) if (pointInPoly(q, b)) return true;
  for (const p of b) if (pointInPoly(p, s)) return true;
  return false;
}

// Entries in the spec -----------------------------------------------------------------------------------------------------------------

const isDrawn = (o) => o && String(o.id || '').startsWith(CP_PREFIX) && Array.isArray(o.polygon) && o.polygon.length >= 3 && o.carpark && !o.road;

/** The drawn hardstand entries that carry a car park. */
export const carparkEntries = (c) => (Array.isArray(c?.pavements) ? c.pavements.filter(isDrawn) : []);

const isEntrySource = (a) => !!(a.road || /:pad$/.test(String(a.id)) || /driveway|crossover|entry/i.test(String(a.id)));

/**
 * The laid out car parks of a commercial spec: [{ id, polygon, layout, cfg }]. `areas` is pavementAreas(c) (other roads and crossovers that
 * touch a car park leave an entry gap and keep the bays clear); `buildings` is a list of building rings the bays may not cover.
 */
export function carparkAreas(c, { areas = [], buildings = [] } = {}) {
  return carparkEntries(c).map((o) => {
    const cfg = cpConfig(o.carpark);
    const others = areas.filter((a) => a.id !== o.id && !String(a.id).startsWith(`${o.id}~`) && isEntrySource(a) && a.polygon?.length >= 3);
    const rings = others.map((a) => a.polygon);
    const gaps = entryGaps(o.polygon, rings);
    const layout = carparkLayout(o.polygon, cfg, { gaps, obstacles: [...buildings, ...rings], near: cfg.near || null });
    return { id: o.id, type: o.type, polygon: o.polygon, layout, cfg };
  });
}

/** Totals over every car park: { bays, accessible, required, zones, areas: [{ id, bays, accessible }] }. */
export function carparkTotals(list) {
  const t = { bays: 0, accessible: 0, required: 0, zones: 0, areas: [] };
  for (const a of list) { t.bays += a.layout.count; t.accessible += a.layout.accessible; t.required += a.layout.required; t.zones += a.layout.zones; t.areas.push({ id: a.id, bays: a.layout.count, accessible: a.layout.accessible }); }
  return t;
}

/** Marking items for the layout, in the shape pavement markings use: bay lines, accessible symbols, shared zone hatch and arrows. */
export function carparkMarkings(id, layout) {
  const items = [];
  if (!layout?.bays.length) return items;
  const lines = [];
  const seen = new Set();
  const key = (p) => `${Math.round(p.x / 20)},${Math.round(p.y / 20)}`;
  const add = (p, q) => { const k = [key(p), key(q)].sort().join('|'); if (seen.has(k)) return; seen.add(k); lines.push([p, q]); };
  const ang = layout.angleDeg;
  for (const b of layout.bays) {
    const [p0, p1, p2, p3] = b.poly; // back edge p0 p1, face edge p3 p2
    add(p0, p3); add(p1, p2);
    if (b.kind === 'zone') continue;
    add(p0, p1);
  }
  items.push({ id: `baylines:${id}`, type: 'bay-lines', lines, count: layout.count, rowId: id, carpark: id });
  for (const b of layout.bays) {
    if (b.kind === 'accessible') items.push({ id: `access:${id}:${b.key}`, type: 'accessible-symbol', x: b.centre.x, y: b.centre.y, rotationDeg: ang, rowId: id, carpark: id });
    else if (b.kind === 'zone') items.push({ id: `zone:${id}:${b.key}`, type: 'accessible-hatch', polygon: b.poly, x: b.centre.x, y: b.centre.y, rotationDeg: ang, rowId: id, carpark: id });
  }
  layout.arrows.forEach((a, i) => items.push({ id: `arrow:${id}:${i}`, type: 'arrow-straight', x: a.x, y: a.y, rotationDeg: a.rotationDeg, rowId: id, carpark: id }));
  return items;
}

/** The bay under a plan point, or null. */
export const bayAt = (layout, p) => layout?.bays.find((b) => pointInPoly(p, b.poly)) || null;

/** Layout for one entry's polygon with a settings patch applied (a live drag), using the same gaps and obstacles as the stored layout. */
export function carparkFor(entryObj, polygon, patch, { areas = [], buildings = [] } = {}) {
  const cfg = cpConfig({ ...(entryObj.carpark || {}), ...(patch || {}) });
  const rings = areas.filter((a) => a.id !== entryObj.id && !String(a.id).startsWith(`${entryObj.id}~`) && isEntrySource(a) && a.polygon?.length >= 3).map((a) => a.polygon);
  return carparkLayout(polygon, cfg, { gaps: entryGaps(polygon, rings), obstacles: [...buildings, ...rings], near: cfg.near || null });
}
