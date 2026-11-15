// Polygon boolean operations for plan geometry (plan mm, y down). Pure, no DOM.
//
// A region is a list of rings: outer rings run counter clockwise (positive shoelace area), holes run clockwise, so the inside is always on
// the left of an edge. boolean(A, B, op) with op 'union', 'inter' or 'diff' (A minus B) works edge by edge: every edge is split where the
// other region crosses or touches it, each piece is kept or dropped from where it lies (inside, outside, or on the other boundary with the
// same or the opposite direction), and the kept pieces are joined back into rings. Coordinates are rounded to 1 mm so the pieces join.
// The area helpers hardstand uses (hole free pieces, clip to a ring, subtract many) sit on top of it.

import { polyArea, pointInPoly, bbox } from './geom.js';

const TOL = 1; // mm, a point this close to an edge is on it
const MIN_AREA = 1e4; // mm2, rings smaller than 0.01 m2 are dropped

const r1 = (v) => Math.round(v);
const rp = (p) => ({ x: r1(p.x), y: r1(p.y) });
const key = (p) => `${p.x},${p.y}`;
const same = (a, b) => a.x === b.x && a.y === b.y;

/** A clean ring: rounded to 1 mm, repeated points and spikes removed, collinear points dropped. Returns [] when under 3 points are left. */
export function cleanRing(ring) {
  let pts = ring.map(rp);
  for (let pass = 0; pass < 4; pass++) {
    const out = [];
    for (const p of pts) if (!out.length || !same(out[out.length - 1], p)) out.push(p);
    while (out.length > 1 && same(out[0], out[out.length - 1])) out.pop();
    const n = out.length;
    if (n < 3) return [];
    const keep = [];
    for (let i = 0; i < n; i++) {
      const a = out[(i + n - 1) % n];
      const b = out[i];
      const c = out[(i + 1) % n];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      const l = Math.hypot(c.x - a.x, c.y - a.y) || 1;
      if (Math.abs(cross) / l < 0.75) continue; // b lies on the line a to c (a straight run or a spike)
      keep.push(b);
    }
    if (keep.length === pts.length) { pts = keep; break; }
    pts = keep;
    if (pts.length < 3) return [];
  }
  return pts.length >= 3 ? pts : [];
}

/** Rings turned into a region: outer rings counter clockwise, holes clockwise (an outer ring with a hole is given as the two rings). */
export function orient(rings, hole = false) {
  return rings.map((r) => { const a = polyArea(r); return (hole ? a > 0 : a < 0) ? r.slice().reverse() : r; });
}

export const inRegion = (p, rings) => { let n = 0; for (const r of rings) if (pointInPoly(p, r)) n++; return n % 2 === 1; };

function distSeg(p, a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function crossPoint(a, b, c, d) {
  const rx = b.x - a.x; const ry = b.y - a.y; const sx = d.x - c.x; const sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  const e = 1e-9;
  if (t < -e || t > 1 + e || u < -e || u > 1 + e) return null;
  return { x: a.x + rx * t, y: a.y + ry * t };
}

const edgesOf = (rings) => { const out = []; rings.forEach((r) => r.forEach((a, i) => out.push([a, r[(i + 1) % r.length]]))); return out; };

/** Every edge of `mine` cut into pieces at the crossings and touches with `theirs`: [{ a, b }]. */
function splitEdges(mine, theirs, crossings) {
  const pieces = [];
  const tv = theirs.flat();
  for (const [a, b] of mine) {
    const dx = b.x - a.x; const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    if (l2 < 1) continue;
    const ts = [0, 1];
    for (const v of tv) if (distSeg(v, a, b) < TOL) { const t = ((v.x - a.x) * dx + (v.y - a.y) * dy) / l2; if (t > 0 && t < 1) ts.push(t); }
    for (const c of crossings.get(a) || []) ts.push(c.t);
    ts.sort((p, q) => p - q);
    let prev = a;
    for (let i = 1; i < ts.length; i++) {
      const p = i === ts.length - 1 ? b : rp({ x: a.x + dx * ts[i], y: a.y + dy * ts[i] });
      if (!same(p, prev)) { pieces.push({ a: prev, b: p }); prev = p; }
    }
  }
  return pieces;
}

/** Where each edge of A is crossed by an edge of B, as rounded points (the same point is used for both edges). */
function crossingsOf(ea, eb) {
  const mapA = new Map();
  const mapB = new Map();
  for (const [a, b] of ea) {
    for (const [c, d] of eb) {
      const q = crossPoint(a, b, c, d);
      if (!q) continue;
      const p = rp(q);
      const ta = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (((b.x - a.x) ** 2 + (b.y - a.y) ** 2) || 1);
      const tb = ((p.x - c.x) * (d.x - c.x) + (p.y - c.y) * (d.y - c.y)) / (((d.x - c.x) ** 2 + (d.y - c.y) ** 2) || 1);
      if (!mapA.has(a)) mapA.set(a, []);
      if (!mapB.has(c)) mapB.set(c, []);
      mapA.get(a).push({ t: Math.min(1, Math.max(0, ta)), p });
      mapB.get(c).push({ t: Math.min(1, Math.max(0, tb)), p });
    }
  }
  return { mapA, mapB };
}

function locate(piece, other, otherEdges) {
  const m = { x: (piece.a.x + piece.b.x) / 2, y: (piece.a.y + piece.b.y) / 2 };
  for (const [c, d] of otherEdges) {
    if (distSeg(m, c, d) < TOL) {
      const dot = (piece.b.x - piece.a.x) * (d.x - c.x) + (piece.b.y - piece.a.y) * (d.y - c.y);
      return dot >= 0 ? 'same' : 'opp';
    }
  }
  return inRegion(m, other) ? 'in' : 'out';
}

function join(edges) {
  // cancel an edge against its exact opposite
  const live = new Map();
  for (const e of edges) live.set(`${key(e.a)}>${key(e.b)}`, e);
  for (const [k, e] of [...live]) {
    const back = `${key(e.b)}>${key(e.a)}`;
    if (live.has(back) && live.has(k)) { live.delete(k); live.delete(back); }
  }
  const out = new Map();
  for (const e of live.values()) { const k = key(e.a); if (!out.has(k)) out.set(k, []); out.get(k).push(e); }
  const rings = [];
  for (const list of out.values()) {
    for (const first of list) {
      if (first.used) continue;
      const ring = [first.a];
      let cur = first;
      cur.used = true;
      let guard = 0;
      while (guard++ < 100000) {
        ring.push(cur.b);
        if (same(cur.b, first.a)) break;
        const next = (out.get(key(cur.b)) || []).filter((e) => !e.used);
        if (!next.length) break;
        let best = next[0];
        if (next.length > 1) {
          // several ways on (the region touches itself): take the sharpest right turn so each loop stays simple
          const din = { x: cur.b.x - cur.a.x, y: cur.b.y - cur.a.y };
          let bestAng = Infinity;
          for (const e of next) {
            const dout = { x: e.b.x - e.a.x, y: e.b.y - e.a.y };
            const ang = Math.atan2(din.x * dout.y - din.y * dout.x, din.x * dout.x + din.y * dout.y);
            if (ang < bestAng) { bestAng = ang; best = e; }
          }
        }
        best.used = true;
        cur = best;
      }
      if (same(ring[ring.length - 1], first.a)) { ring.pop(); const c = cleanRing(ring); if (c.length >= 3 && Math.abs(polyArea(c)) >= MIN_AREA) rings.push(c); }
    }
  }
  return rings;
}

/** A region cleaned: rings rounded and simplified; a region given wholly clockwise is turned round (so one ring may come in either way). */
function norm(region) {
  let rings = region.map(cleanRing).filter((r) => r.length >= 3);
  if (rings.length && !rings.some((r) => polyArea(r) > 0)) rings = rings.map((r) => r.slice().reverse());
  return rings;
}

/** A op B on regions (lists of rings, outer counter clockwise and holes clockwise). The result is a region in the same convention. */
export function boolean(A, B, op) {
  const a = norm(A);
  const b = norm(B);
  if (!a.length) return op === 'union' ? b : [];
  if (!b.length) return op === 'inter' ? [] : a;
  const ea = edgesOf(a);
  const eb = edgesOf(b);
  const { mapA, mapB } = crossingsOf(ea, eb);
  const pa = splitEdges(ea, b, mapA);
  const pb = splitEdges(eb, a, mapB);
  const keep = [];
  for (const p of pa) {
    const w = locate(p, b, eb);
    if (op === 'diff') { if (w === 'out' || w === 'opp') keep.push(p); }
    else if (op === 'inter') { if (w === 'in' || w === 'same') keep.push(p); }
    else if (w === 'out' || w === 'same') keep.push(p);
  }
  for (const p of pb) {
    const w = locate(p, a, ea);
    if (op === 'diff') { if (w === 'in') keep.push({ a: p.b, b: p.a }); }
    else if (op === 'inter') { if (w === 'in') keep.push(p); }
    else if (w === 'out') keep.push(p);
  }
  return join(keep);
}

const split = (region) => {
  const rings = region.filter((r) => r.length >= 3);
  return { outers: rings.filter((r) => polyArea(r) > 0), holes: rings.filter((r) => polyArea(r) < 0) };
};

// A point on the hole's own outline: it lies in the ring that holds the hole and outside any island inside the hole.
const holeProbe = (h) => ({ x: h[0].x, y: h[0].y });

/** Group a region into [{ outer, holes }]. */
export function groups(region) {
  const { outers, holes } = split(region);
  const out = outers.map((outer) => ({ outer, holes: [] }));
  for (const h of holes) {
    const p = holeProbe(h);
    let best = null;
    for (const g of out) if (pointInPoly(p, g.outer) && (!best || Math.abs(polyArea(g.outer)) < Math.abs(polyArea(best.outer)))) best = g;
    if (best) best.holes.push(h);
  }
  return out;
}

/**
 * A region as simple rings with no holes (the form a pavement area is stored in): an outer ring with a hole is cut in two along a line
 * through the hole, so each half has a notch where the hole was.
 */
export function holeFree(region, depth = 0) {
  const out = [];
  for (const { outer, holes } of groups(region)) {
    if (!holes.length || depth > 6) { out.push(outer); continue; }
    const h = holes[0];
    const bb = bbox(h);
    const cy = r1((bb.minY + bb.maxY) / 2);
    const ob = bbox(outer);
    const pad = 1000;
    const top = [{ x: ob.minX - pad, y: ob.minY - pad }, { x: ob.maxX + pad, y: ob.minY - pad }, { x: ob.maxX + pad, y: cy }, { x: ob.minX - pad, y: cy }];
    const bottom = [{ x: ob.minX - pad, y: cy }, { x: ob.maxX + pad, y: cy }, { x: ob.maxX + pad, y: ob.maxY + pad }, { x: ob.minX - pad, y: ob.maxY + pad }];
    for (const half of [top, bottom]) {
      const part = boolean([outer], [half], 'inter');
      out.push(...subtractPieces(part, holes, depth + 1));
    }
  }
  return out;
}

/** The region minus each ring of `cut`, as hole free rings. */
export function subtractPieces(region, cut, depth = 0) {
  let pieces = holeFree(region, depth);
  for (const c of cut) {
    const next = [];
    for (const p of pieces) next.push(...holeFree(boolean([p], [c], 'diff'), depth));
    pieces = next;
  }
  return pieces;
}

/** `ring` clipped to the ring `to` (any simple outline): hole free pieces. */
export const clipTo = (ring, to) => holeFree(boolean([ring], [to], 'inter'));

/** Area of the overlap of two simple rings, mm2. */
export const overlapArea = (a, b) => boolean([a], [b], 'inter').reduce((s, r) => s + polyArea(r), 0);
