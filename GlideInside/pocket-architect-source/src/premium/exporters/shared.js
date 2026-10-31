// Geometry shared by the DXF and PDF exporters. Pure functions, no DOM, Node compatible.
// Plan coordinates: mm, x right, y down the screen.

import * as G from '../../model/geometry.js';
import { ROOM_LABELS } from '../../model/schema.js';

const add = G.add;
const mul = G.mul;
const NODE_TOL = 3;

export const levelsSorted = (project) => [...project.levels].sort((a, b) => a.elevation - b.elevation);

/** Plain ASCII text safe for DXF and for standard PDF fonts: no dashes, no control codes. */
export function ascii(s) {
  return String(s ?? '')
    .replace(/[–—−]/g, '-')
    .replace(/²/g, '2')
    .replace(/×/g, 'x')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/%%/g, '% %')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugify(name, fallback = 'design') {
  const s = String(name ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || fallback;
}

export const levelTitle = (level) => `${ascii(level.name) || 'Level'} floor plan`;

// Wall outlines ----------------------------------------------------------------
function cornerPoint(P, e1, e2) {
  const p1 = add(P, mul(e1.nu, e1.h));
  const p2 = add(P, mul(e2.nu, -e2.h));
  const denom = G.cross(e1.u, e2.u);
  if (Math.abs(denom) < 1e-3) return { plus: p1, minus: p2 };
  const s = G.cross(G.sub(p2, p1), e2.u) / denom;
  const c = add(p1, mul(e1.u, s));
  if (G.dist(c, P) > (e1.h + e2.h) * 8) return { plus: p1, minus: p2 };
  return { plus: c, minus: c };
}

/**
 * Outline geometry of every wall of a level, joined at corners and junctions.
 * Returns an array of { wall, d, n, h, L, start, end, spans, pieces, doors, windows... }:
 *  - pieces: solid parts between openings, each { plus: [p, q], minus: [p, q], poly: [4 points], jambStart, jambEnd }
 *  - caps: free wall end lines
 *  - spans: opening spans along the wall [{ opening, s0, s1 }]
 */
export function wallShapes(level) {
  const walls = level.walls.filter((w) => G.wallLength(w) > 1);
  const info = new Map();
  for (const w of walls) {
    const d = G.wallDir(w);
    info.set(w.id, { wall: w, d, n: { x: -d.y, y: d.x }, h: (w.thickness || 100) / 2, L: G.wallLength(w), A: null, B: null, freeA: false, freeB: false });
  }
  const nodes = [];
  const nodeFor = (p) => {
    let node = nodes.find((q) => G.dist(q.p, p) <= NODE_TOL);
    if (!node) {
      node = { p: { x: p.x, y: p.y }, ends: [] };
      nodes.push(node);
    }
    return node;
  };
  for (const w of walls) {
    nodeFor(w.a).ends.push({ w, end: 'a' });
    nodeFor(w.b).ends.push({ w, end: 'b' });
  }
  for (const node of nodes) {
    const es = node.ends.map((e) => {
      const inf = info.get(e.w.id);
      const u = e.end === 'a' ? inf.d : { x: -inf.d.x, y: -inf.d.y };
      return { ...e, inf, u, nu: { x: -u.y, y: u.x }, h: inf.h, ang: Math.atan2(u.y, u.x), plus: null, minus: null };
    });
    if (es.length === 1) {
      const e = es[0];
      e.plus = add(node.p, mul(e.nu, e.h));
      e.minus = add(node.p, mul(e.nu, -e.h));
    } else {
      es.sort((p, q) => p.ang - q.ang);
      es.forEach((e1, i) => {
        const e2 = es[(i + 1) % es.length];
        const c = cornerPoint(node.p, e1, e2);
        e1.plus = c.plus;
        e2.minus = c.minus;
      });
    }
    for (const e of es) {
      // entry "plus" is the +nu side; at end b the wall's +n side is the entry's minus side
      if (e.end === 'a') {
        e.inf.A = { plus: e.plus, minus: e.minus };
        e.inf.freeA = es.length === 1;
      } else {
        e.inf.B = { plus: e.minus, minus: e.plus };
        e.inf.freeB = es.length === 1;
      }
    }
  }
  const out = [];
  for (const inf of info.values()) {
    const { wall: w, d, n, h, L } = inf;
    const at = (s, side) => add(add(w.a, mul(d, s)), mul(n, side * h));
    const sOf = (p) => G.dot(G.sub(p, w.a), d);
    const sStart = Math.min(sOf(inf.A.plus), sOf(inf.A.minus));
    const sEnd = Math.max(sOf(inf.B.plus), sOf(inf.B.minus));
    const spans = level.openings
      .filter((o) => o.wallId === w.id)
      .map((o) => ({ opening: o, s0: o.offset - o.width / 2, s1: o.offset + o.width / 2 }))
      .sort((p, q) => p.s0 - q.s0);
    const solids = [];
    let cur = sStart;
    for (const sp of spans) {
      if (sp.s0 > cur + 1) solids.push([cur, Math.min(sp.s0, sEnd)]);
      cur = Math.max(cur, sp.s1);
    }
    if (sEnd > cur + 1) solids.push([cur, sEnd]);
    const pieces = solids.map(([s0, s1]) => {
      const first = Math.abs(s0 - sStart) < 0.5;
      const last = Math.abs(s1 - sEnd) < 0.5;
      const pS = first ? inf.A.plus : at(s0, 1);
      const mS = first ? inf.A.minus : at(s0, -1);
      const pE = last ? inf.B.plus : at(s1, 1);
      const mE = last ? inf.B.minus : at(s1, -1);
      return {
        plus: [pS, pE],
        minus: [mS, mE],
        poly: [pS, pE, mE, mS],
        jambStart: first ? null : [mS, pS],
        jambEnd: last ? null : [pE, mE],
      };
    });
    const caps = [];
    if (inf.freeA) caps.push([inf.A.plus, inf.A.minus]);
    if (inf.freeB) caps.push([inf.B.plus, inf.B.minus]);
    out.push({ wall: w, d, n, h, L, spans, pieces, caps, at: (s, side = 0) => at(s, side) });
  }
  return out;
}

// Openings ---------------------------------------------------------------------
/** Hinged door: hinge point H, closed free end F and open leaf end O (all plan coordinates). */
export function doorGeometry(shape, o) {
  const w = shape.wall;
  const s0 = o.offset - o.width / 2;
  const s1 = o.offset + o.width / 2;
  const hingeS = o.hinge === 'b' ? s1 : s0;
  const freeS = o.hinge === 'b' ? s0 : s1;
  const H = G.pointOnWall(w, hingeS);
  const F = G.pointOnWall(w, freeS);
  const sign = o.side === -1 ? -1 : 1;
  const O = add(H, mul(shape.n, sign * o.width));
  return { H, F, O, radius: o.width };
}

/** Line pairs that draw an opening in plan (excluding the wall jambs). */
export function openingLines(shape, o) {
  const s0 = o.offset - o.width / 2;
  const s1 = o.offset + o.width / 2;
  const line = (sa, sb, side) => [shape.at(sa, side), shape.at(sb, side)];
  switch (o.kind) {
    case 'window':
      return { layer: 'win', lines: [line(s0, s1, 1), line(s0, s1, 0), line(s0, s1, -1)] };
    case 'sliding_door': {
      const mid = (s0 + s1) / 2;
      const ov = o.width / 10;
      return { layer: 'door', lines: [line(s0, mid + ov, 0.4), line(mid - ov, s1, -0.4)] };
    }
    case 'garage_door':
    case 'roller_door':
      return { layer: 'door', lines: [line(s0, s1, 0)] };
    default:
      return { layer: 'door', lines: [] };
  }
}

// Stairs -----------------------------------------------------------------------
export function stairGeometry(stair) {
  const c = { x: stair.x, y: stair.y };
  const loc = (lx, ly) => G.rotatePoint({ x: c.x + lx, y: c.y + ly }, c, stair.rotation || 0);
  const w2 = stair.width / 2;
  const l2 = stair.length / 2;
  const n = Math.max(2, Math.round(stair.length / 250));
  const treads = [];
  for (let i = 1; i < n; i++) {
    const ly = -l2 + (stair.length * i) / n;
    treads.push([loc(-w2, ly), loc(w2, ly)]);
  }
  const tip = loc(0, l2 - 150);
  const arrow = [
    [loc(0, -l2 + 250), tip],
    [tip, loc(-120, l2 - 450)],
    [tip, loc(120, l2 - 450)],
  ];
  return { corners: [loc(-w2, -l2), loc(w2, -l2), loc(w2, l2), loc(-w2, l2)], treads, arrow, start: loc(0, -l2) };
}

// Furniture --------------------------------------------------------------------
const pickNumber = (...vals) => vals.find((v) => typeof v === 'number' && v > 0);

export function furnitureSize(catalogue, f) {
  let def = null;
  try {
    def = catalogue?.getFurniture?.(f.item) || null;
  } catch {
    def = null;
  }
  if (!def && Array.isArray(catalogue?.FURNITURE)) def = catalogue.FURNITURE.find((x) => x.id === f.item) || null;
  const size = def?.size;
  const w = pickNumber(f.w, def?.w, def?.width, Array.isArray(size) ? size[0] : size?.w, size?.width) || 600;
  const d = pickNumber(f.d, def?.d, def?.depth, Array.isArray(size) ? size[1] : size?.d, size?.depth) || 600;
  return { w, d };
}

export function furnitureCorners(f, size) {
  const c = { x: f.x, y: f.y };
  const loc = (lx, ly) => G.rotatePoint({ x: c.x + lx, y: c.y + ly }, c, f.rotation || 0);
  return [loc(-size.w / 2, -size.d / 2), loc(size.w / 2, -size.d / 2), loc(size.w / 2, size.d / 2), loc(-size.w / 2, size.d / 2)];
}

// Extents, eaves and dimensions ---------------------------------------------------
export function outlineBox(level, shapes = wallShapes(level)) {
  const pts = [];
  for (const s of shapes) for (const p of s.pieces) pts.push(...p.poly);
  if (!pts.length) for (const r of level.rooms) pts.push(...r.polygon);
  return pts.length ? G.bbox(pts) : null;
}

/** Bounding eaves outline of the roofed rooms of a level, or null. */
export function eavesBox(level) {
  if (level.roof?.enabled === false) return null;
  const pts = [];
  for (const r of level.rooms) if (!r.outdoor || r.roofed) pts.push(...r.polygon);
  if (!pts.length) return null;
  const bb = G.bbox(pts);
  const o = Math.max(0, Number(level.roof?.overhang) || 0);
  return { minX: bb.minX - o, minY: bb.minY - o, maxX: bb.maxX + o, maxY: bb.maxY + o };
}

/**
 * Dimension strings for a level: overall width and depth plus chains where exterior walls
 * have junctions. Each dimension: { a, b, ext: [[p, q], [p, q]], ticks: [[p, q], [p, q]], text, textAt, textRot }
 * where a and b are the ends of the dimension line.
 */
export function dimensionsFor(level, shapes = wallShapes(level)) {
  const box = outlineBox(level, shapes);
  if (!box) return [];
  const dims = [];
  const GAP = 100;
  const OVER = 150;
  const TICK = 85;
  const make = (side, v1, v2, off, edge) => {
    const horizontal = side === 'top' || side === 'bottom';
    const sign = side === 'top' || side === 'left' ? -1 : 1;
    const base = edge;
    const lineAt = base + sign * off;
    const P = (v, c) => (horizontal ? { x: v, y: c } : { x: c, y: v });
    const a = P(v1, lineAt);
    const b = P(v2, lineAt);
    const ext = [
      [P(v1, base + sign * GAP), P(v1, lineAt + sign * OVER)],
      [P(v2, base + sign * GAP), P(v2, lineAt + sign * OVER)],
    ];
    const tick = (p) => [
      { x: p.x - TICK, y: p.y + TICK },
      { x: p.x + TICK, y: p.y - TICK },
    ];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const textAt = horizontal ? { x: mid.x, y: mid.y - 70 } : { x: mid.x - 70, y: mid.y };
    return { a, b, ext, ticks: [tick(a), tick(b)], text: String(Math.round(Math.abs(v2 - v1))), textAt, textRot: horizontal ? 0 : 90, side };
  };
  const nodePositions = (side) => {
    const horizontal = side === 'top' || side === 'bottom';
    const lo = horizontal ? box.minX : box.minY;
    const hi = horizontal ? box.maxX : box.maxY;
    const near = (p) => {
      if (side === 'top') return p.y <= box.minY + 400;
      if (side === 'bottom') return p.y >= box.maxY - 400;
      if (side === 'left') return p.x <= box.minX + 400;
      return p.x >= box.maxX - 400;
    };
    const vals = new Set();
    for (const s of shapes) {
      const w = s.wall;
      const isH = Math.abs(w.a.y - w.b.y) <= 2;
      const isV = Math.abs(w.a.x - w.b.x) <= 2;
      if (horizontal ? !isH : !isV) continue;
      if (w.kind === 'interior' || !near(w.a) || !near(w.b)) continue;
      for (const p of [w.a, w.b]) {
        const v = horizontal ? p.x : p.y;
        if (v > lo + 200 && v < hi - 200) vals.add(Math.round(v));
      }
    }
    return [lo, ...[...vals].sort((p, q) => p - q), hi];
  };
  const edgeOf = { top: box.minY, bottom: box.maxY, left: box.minX, right: box.maxX };
  for (const side of ['top', 'bottom', 'left', 'right']) {
    const pos = nodePositions(side);
    const overallOnly = pos.length === 2;
    // A plain rectangle gets overall dimensions on the top and left only. Sides with junctions get a chain too.
    if (overallOnly && (side === 'bottom' || side === 'right')) continue;
    if (!overallOnly) {
      for (let i = 0; i < pos.length - 1; i++) if (pos[i + 1] - pos[i] >= 200) dims.push(make(side, pos[i], pos[i + 1], 700, edgeOf[side]));
    }
    dims.push(make(side, pos[0], pos.at(-1), overallOnly ? 900 : 1500, edgeOf[side]));
  }
  return dims;
}

// Schedules ----------------------------------------------------------------------
const OPENING_LABELS = {
  window: 'Window',
  door: 'Door',
  sliding_door: 'Sliding door',
  garage_door: 'Garage door',
  roller_door: 'Roller door',
  opening: 'Opening',
};

export function scheduleData(project) {
  const levels = levelsSorted(project);
  const rooms = [];
  const totals = [];
  const openingMap = new Map();
  for (const level of levels) {
    let indoor = 0;
    let outdoor = 0;
    for (const r of level.rooms) {
      const area = G.polygonArea(r.polygon) / 1e6;
      if (r.outdoor) outdoor += area;
      else indoor += area;
      rooms.push({ level: ascii(level.name), name: ascii(r.name) || ROOM_LABELS[r.type] || 'Room', type: ROOM_LABELS[r.type] || 'Room', area, outdoor: !!r.outdoor, status: r.status || 'new' });
    }
    totals.push({ level: ascii(level.name), indoor, outdoor });
    for (const o of level.openings) {
      const style = o.style && !['none', 'hinged', 'panel'].includes(o.style) ? String(o.style).replace(/_/g, ' ') : '';
      const key = `${o.kind}|${style}|${Math.round(o.width)}|${Math.round(o.height)}|${Math.round(o.sill)}`;
      const row = openingMap.get(key) || { type: OPENING_LABELS[o.kind] || 'Opening', style, width: Math.round(o.width), height: Math.round(o.height), sill: Math.round(o.sill), count: 0 };
      row.count += 1;
      openingMap.set(key, row);
    }
  }
  const openings = [...openingMap.values()].sort((a, b) => a.type.localeCompare(b.type) || a.width - b.width);
  return { rooms, totals, openings };
}
