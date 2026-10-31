// Roof generation: footprint minus the level above, covered with (overlapping) rectangles, each
// rectangle roofed as hip, gable, skillion or flat. Pure geometry, no DOM.
//
// Slots in the returned builder: roof, fascia, gable (gable infill in the external wall finish).

import { GeoBuilder } from './mesh-builder.js';
import { coverRects, disjointRects, maskMinus, cellIndexOf } from './footprint.js';

const RAD = Math.PI / 180;
const OVERLAP_STEP = 0.002; // m, lifts later rectangles to stop z-fighting where planes coincide

// Clip a convex polygon of [u, h, v] points to a half-space: axis 0 (u) or 2 (v); keep >= or <= limit.
function clip(poly, axis, limit, keepAbove) {
  const out = [];
  const inside = (p) => (keepAbove ? p[axis] >= limit - 1e-9 : p[axis] <= limit + 1e-9);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ia = inside(a);
    const ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (limit - a[axis]) / (b[axis] - a[axis]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}

// States of the cells just outside each edge of a rectangle: 0 free, 1 other roof of this level, 2 level above.
function edgeStates(grid, mask, above, r) {
  const state = (i, j) => {
    if (i < 0 || j < 0 || i >= grid.nx || j >= grid.ny) return 0;
    const k = j * grid.nx + i;
    if (above && above[k]) return 2;
    return mask[k] ? 1 : 0;
  };
  const e = { n: [], s: [], w: [], e: [] };
  for (let i = r.i0; i <= r.i1; i++) {
    e.n.push(state(i, r.j0 - 1));
    e.s.push(state(i, r.j1 + 1));
  }
  for (let j = r.j0; j <= r.j1; j++) {
    e.w.push(state(r.i0 - 1, j));
    e.e.push(state(r.i1 + 1, j));
  }
  return e;
}

const share = (arr, v) => arr.filter((x) => x === v).length / Math.max(1, arr.length);

// Runs of free cells along an edge, as [from, to] in mm measured from the start of the edge.
function freeRuns(states, cell) {
  const runs = [];
  let start = -1;
  for (let k = 0; k <= states.length; k++) {
    const free = k < states.length && states[k] === 0;
    if (free && start < 0) start = k;
    if (!free && start >= 0) {
      runs.push([start * cell, k * cell, start === 0, k === states.length]);
      start = -1;
    }
  }
  return runs;
}

// opts: { grid, footprint, above, H0 (m, wall top), roof: { type, pitch, overhang } }
export function buildLevelRoof(opts) {
  const { grid, footprint, above, H0 } = opts;
  const type = opts.roof.type || 'hip';
  const pitchDeg = type === 'flat' ? 2 : Math.max(1, Math.min(60, Number(opts.roof.pitch) || 22.5));
  const th = Math.tan(pitchDeg * RAD);
  const cs = Math.cos(pitchDeg * RAD);
  const o = Math.max(0, Math.min(1.5, (Number(opts.roof.overhang) || 0) / 1000));
  const mask = above ? maskMinus(footprint, above) : footprint;
  // Hips and gables may overlap (the planes intersect in valleys, as real roofs do). Skillion and flat
  // roofs get one plane per wing, so they are split into rectangles that do not overlap.
  const rects = type === 'skillion' || type === 'flat'
    ? disjointRects(grid, mask).filter((r) => (r.x1 - r.x0) * (r.y1 - r.y0) >= 0.5e6 && Math.min(r.x1 - r.x0, r.y1 - r.y0) >= 300)
    : coverRects(grid, mask);
  const b = new GeoBuilder();
  const rectInfo = [];

  rects.forEach((r, index) => {
    const lift = index * OVERLAP_STEP;
    const cx = (r.x0 + r.x1) / 2000;
    const cz = (r.y0 + r.y1) / 2000;
    const Wm = (r.x1 - r.x0) / 1000;
    const Dm = (r.y1 - r.y0) / 1000;
    const alongX = Wm >= Dm;
    const W = alongX ? Wm : Dm; // long side, local u
    const D = alongX ? Dm : Wm; // short side, local v
    const toWorld = (p) => (alongX ? [cx + p[0], p[1] + lift, cz + p[2]] : [cx + p[2], p[1] + lift, cz + p[0]]);
    const states = edgeStates(grid, mask, above, r);
    // local edge -> world edge
    const edgeOf = alongX ? { 'u-': 'w', 'u+': 'e', 'v-': 'n', 'v+': 's' } : { 'u-': 'n', 'u+': 's', 'v-': 'w', 'v+': 'e' };
    const abut = (le) => share(states[edgeOf[le]], 2) >= 0.5;
    const free = (le) => share(states[edgeOf[le]], 0) >= 0.5;
    const eu = W / 2 + o;
    const ev = D / 2 + o;
    // The footprint is rasterised, so the true wall face can sit up to half a cell outside the
    // rectangle. Lift the roof plane so it still clears the wall tops there.
    const Hb = H0 + (grid.cell / 2000) * th;
    const he = Hb - o * th;
    const hr = Hb + (D / 2) * th;

    const emit = (slot, poly, uvFn, hintLocal = [0, 1, 0]) => {
      let p = poly;
      // trim overhang where the roof meets the level above
      if (abut('u-')) p = clip(p, 0, -W / 2, true);
      if (abut('u+')) p = clip(p, 0, W / 2, false);
      if (abut('v-')) p = clip(p, 2, -D / 2, true);
      if (abut('v+')) p = clip(p, 2, D / 2, false);
      if (p.length < 3) return;
      const world = p.map(toWorld);
      const uvs = p.map(uvFn);
      const hint = alongX ? hintLocal : [hintLocal[2], hintLocal[1], hintLocal[0]];
      b.poly(slot, world, uvs, hint);
    };
    // skillion and flat: the high side faces the level above or the roof it adjoins, else the north or west side
    let hs = -1;
    if (abut('v-') && !abut('v+')) hs = -1;
    else if (abut('v+') && !abut('v-')) hs = 1;
    else if (free('v+') && !free('v-')) hs = -1;
    else if (free('v-') && !free('v+')) hs = 1;

    if (type === 'hip') {
      const rl = Math.max(0, (W - D) / 2);
      emit('roof', [[-eu, he, ev], [eu, he, ev], [rl, hr, 0], [-rl, hr, 0]], (p) => [p[0], (ev - p[2]) / cs]);
      emit('roof', [[-eu, he, -ev], [-rl, hr, 0], [rl, hr, 0], [eu, he, -ev]], (p) => [p[0], (p[2] + ev) / cs]);
      emit('roof', [[eu, he, ev], [eu, he, -ev], [rl, hr, 0]], (p) => [p[2], (eu - p[0]) / cs]);
      emit('roof', [[-eu, he, ev], [-rl, hr, 0], [-eu, he, -ev]], (p) => [p[2], (p[0] + eu) / cs]);
    } else if (type === 'gable') {
      emit('roof', [[-eu, he, ev], [eu, he, ev], [eu, hr, 0], [-eu, hr, 0]], (p) => [p[0], (ev - p[2]) / cs]);
      emit('roof', [[-eu, he, -ev], [-eu, hr, 0], [eu, hr, 0], [eu, he, -ev]], (p) => [p[0], (p[2] + ev) / cs]);
      for (const sgn of [-1, 1]) {
        const le = sgn < 0 ? 'u-' : 'u+';
        if (!free(le)) continue;
        const tri = [[sgn * W / 2, H0, D / 2], [sgn * W / 2, H0, -D / 2], [sgn * W / 2, Hb, -D / 2], [sgn * W / 2, hr, 0], [sgn * W / 2, Hb, D / 2]].map(toWorld);
        const w3 = alongX ? [sgn, 0, 0] : [0, 0, sgn];
        const horiz = alongX ? 2 : 0;
        b.poly('gable', tri, tri.map((q) => [q[horiz], q[1]]), w3);
      }
    } else {
      // skillion and flat: slope falls across the short side. The high side faces the level above if any.
      const hLow = Hb;
      const hAt = (v) => hLow + (D / 2 + hs * v) * th;
      const lowV = -hs * ev;
      const highV = hs * Math.min(ev, D / 2 + 0.3);
      const slab = type === 'flat' ? 0.14 : 0;
      const top = [[-eu, hAt(lowV) + slab, lowV], [eu, hAt(lowV) + slab, lowV], [eu, hAt(highV) + slab, highV], [-eu, hAt(highV) + slab, highV]];
      emit('roof', top, (p) => [p[0], Math.abs(p[2] - lowV) / cs]);
      if (type === 'flat') {
        const bot = [[-eu, hAt(lowV), lowV], [eu, hAt(lowV), lowV], [eu, hAt(highV), highV], [-eu, hAt(highV), highV]];
        emit('fascia', bot, (p) => [p[0], p[2]], [0, -1, 0]);
        // slab edge band
        const edge = (a, c, hint) => {
          const q = [[a[0], hAt(a[2]), a[2]], [c[0], hAt(c[2]), c[2]], [c[0], hAt(c[2]) + slab, c[2]], [a[0], hAt(a[2]) + slab, a[2]]];
          emit('fascia', q, (p) => [p[0] + p[2], p[1]], hint);
        };
        const lowEdge = hs > 0 ? 'v-' : 'v+';
        const highEdge = hs > 0 ? 'v+' : 'v-';
        if (free(lowEdge)) edge([-eu, 0, lowV], [eu, 0, lowV], [0, 0, -hs]);
        if (free(highEdge)) edge([-eu, 0, highV], [eu, 0, highV], [0, 0, hs]);
        if (free('u-')) edge([-eu, 0, lowV], [-eu, 0, highV], [-1, 0, 0]);
        if (free('u+')) edge([eu, 0, lowV], [eu, 0, highV], [1, 0, 0]);
      }
      // infill under the high side and at the ends, in the wall finish
      const rise = D * th;
      const lowWall = -hs * D / 2;
      const highWall = hs * D / 2;
      for (const sgn of [-1, 1]) {
        const le = sgn < 0 ? 'u-' : 'u+';
        if (abut(le) || !free(le)) continue;
        const tri = [[sgn * W / 2, H0, lowWall], [sgn * W / 2, H0, highWall], [sgn * W / 2, Hb + rise, highWall], [sgn * W / 2, Hb, lowWall]].map(toWorld);
        const w3 = alongX ? [sgn, 0, 0] : [0, 0, sgn];
        b.poly('gable', tri, tri.map((q) => [q[alongX ? 2 : 0], q[1]]), w3);
      }
      const hiEdge = hs > 0 ? 'v+' : 'v-';
      if (!abut(hiEdge)) {
        const q = [[-W / 2, H0, highWall], [W / 2, H0, highWall], [W / 2, Hb + rise, highWall], [-W / 2, Hb + rise, highWall]].map(toWorld);
        const w3 = alongX ? [0, 0, hs] : [hs, 0, 0];
        b.poly('gable', q, q.map((p) => [p[alongX ? 0 : 2], p[1]]), w3);
      }
    }

    // fascia and gutter along the eave edges, on free runs only
    let eaves;
    if (type === 'hip') eaves = ['u-', 'u+', 'v-', 'v+'];
    else if (type === 'gable') eaves = ['v-', 'v+'];
    else if (type === 'skillion') eaves = [hs > 0 ? 'v-' : 'v+'];
    else eaves = [];
    for (const le of eaves) {
      const we = edgeOf[le];
      const runs = freeRuns(states[we], grid.cell);
      for (const [f0, f1, atStart, atEnd] of runs) {
        const from = f0 / 1000 - (atStart ? o : 0);
        const to = f1 / 1000 + (atEnd ? o : 0);
        const alongWorldX = we === 'n' || we === 's';
        // position of the eave line in world metres
        const base = we === 'n' ? r.y0 / 1000 : we === 's' ? r.y1 / 1000 : we === 'w' ? r.x0 / 1000 : r.x1 / 1000;
        const sgn = we === 'n' || we === 'w' ? -1 : 1;
        const line = base + sgn * o;
        const start = (alongWorldX ? r.x0 : r.y0) / 1000;
        const a = start + from;
        const c = start + to;
        const y0 = he + lift - 0.17;
        const y1 = he + lift + 0.03;
        const face = (outer0, outer1, ya, yb2) => {
          const lo = Math.min(outer0, outer1);
          const hi = Math.max(outer0, outer1);
          // two thin boxes: fascia board then gutter
          if (alongWorldX) {
            addAxisBox(b, a, c, ya, yb2, lo, hi);
          } else {
            addAxisBox(b, lo, hi, ya, yb2, a, c);
          }
        };
        face(line, line + sgn * 0.028, y0, y1);
        face(line + sgn * 0.028, line + sgn * 0.13, y0, y0 + 0.095);
      }
    }
    rectInfo.push({ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, type });
  });
  return { builder: b, rects: rectInfo };
}

function addAxisBox(b, x0, x1, y0, y1, z0, z1) {
  if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
  const s = 'fascia';
  b.quad(s, [x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [[z0, y0], [z1, y0], [z1, y1], [z0, y1]], [1, 0, 0]);
  b.quad(s, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [[z0, y0], [z1, y0], [z1, y1], [z0, y1]], [-1, 0, 0]);
  b.quad(s, [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], [0, 1, 0]);
  b.quad(s, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], [0, -1, 0]);
  b.quad(s, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], [0, 0, 1]);
  b.quad(s, [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], [0, 0, -1]);
}

export { cellIndexOf };
