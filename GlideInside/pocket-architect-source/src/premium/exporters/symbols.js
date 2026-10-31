// Plan symbols and label placement for the drawing exporters (PDF and DXF). Pure, Node compatible.
//
// furnitureStrokes(catalogue, f) runs the catalogue item's own draw2d(ctx, w, d) against a small recording context that
// implements the part of the Canvas 2D API the symbols use, and returns the drawing as world polylines (millimetres):
//   [{ op: 'fill' | 'stroke', paths: [{ pts: [{x, y}], closed }], width, alpha, tint, dash }]
// An item without a symbol (or whose symbol throws) comes back as its outline box, so a sheet never loses furniture.
//
// placeLabel(...) picks a spot for a text block that stays inside a polygon and clear of obstacle boxes.

import * as G from '../../model/geometry.js';
import { furnitureSize, furnitureCorners } from './shared.js';

const TAU = Math.PI * 2;
const PAPER = '#ffffff';
const INK = '#000000';
const STEP = Math.PI / 18; // curve flattening, 10 degree segments

const mult = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

/** A minimal Canvas 2D recorder. Exposed for tests. `base` is the initial transform [a, b, c, d, e, f]. */
export function createRecorder(base = [1, 0, 0, 1, 0, 0]) {
  const ops = [];
  let m = base.slice();
  let paths = [];
  let cur = null; // current sub path (world points)
  let last = null; // last point in local coordinates
  let state = { lineWidth: 1, globalAlpha: 1, fillStyle: PAPER, strokeStyle: INK, dash: [] };
  const stack = [];
  const W = (x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
  const start = (x, y) => {
    cur = { pts: [W(x, y)], closed: false };
    paths.push(cur);
    last = { x, y };
  };
  const to = (x, y) => {
    if (!cur) return start(x, y);
    cur.pts.push(W(x, y));
    last = { x, y };
  };
  const arcPts = (cx, cy, rx, ry, rot, a0, a1, ccw) => {
    let sweep = a1 - a0;
    if (!ccw) {
      while (sweep < 0) sweep += TAU;
      if (a1 - a0 >= TAU) sweep = TAU;
    } else {
      while (sweep > 0) sweep -= TAU;
      if (a0 - a1 >= TAU) sweep = -TAU;
    }
    const n = Math.max(2, Math.ceil(Math.abs(sweep) / STEP));
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    for (let i = 0; i <= n; i++) {
      const a = a0 + (sweep * i) / n;
      const ex = rx * Math.cos(a);
      const ey = ry * Math.sin(a);
      const x = cx + ex * cr - ey * sr;
      const y = cy + ex * sr + ey * cr;
      if (i === 0 && !cur) start(x, y);
      else to(x, y);
    }
  };
  const emit = (op) => {
    const keep = paths.filter((p) => p.pts.length > 1).map((p) => ({ pts: p.pts.slice(), closed: p.closed }));
    if (!keep.length) return;
    ops.push({
      op,
      paths: keep,
      width: state.lineWidth,
      alpha: state.globalAlpha,
      tint: op === 'fill' && state.fillStyle !== PAPER,
      dash: state.dash.slice(),
    });
  };

  const ctx = {
    get lineWidth() { return state.lineWidth; },
    set lineWidth(v) { if (Number.isFinite(v) && v > 0) state.lineWidth = v; },
    get globalAlpha() { return state.globalAlpha; },
    set globalAlpha(v) { if (Number.isFinite(v)) state.globalAlpha = Math.max(0, Math.min(1, v)); },
    get fillStyle() { return state.fillStyle; },
    set fillStyle(v) { state.fillStyle = v; },
    get strokeStyle() { return state.strokeStyle; },
    set strokeStyle(v) { state.strokeStyle = v; },
    lineJoin: 'round',
    lineCap: 'butt',
    save() { stack.push({ m: m.slice(), state: { ...state, dash: state.dash.slice() } }); },
    restore() {
      const s = stack.pop();
      if (s) {
        m = s.m;
        state = s.state;
      }
    },
    translate(x, y) { m = mult(m, [1, 0, 0, 1, x, y]); },
    rotate(a) { m = mult(m, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); },
    scale(x, y) { m = mult(m, [x, 0, 0, y, 0, 0]); },
    setLineDash(d) { state.dash = Array.isArray(d) ? d.slice() : []; },
    getLineDash() { return state.dash.slice(); },
    beginPath() { paths = []; cur = null; last = null; },
    moveTo(x, y) { start(x, y); },
    lineTo(x, y) { to(x, y); },
    closePath() {
      if (cur) {
        cur.closed = true;
        const p0 = cur.pts[0];
        cur = { pts: [p0], closed: false };
        paths.push(cur);
      }
    },
    rect(x, y, w, h) {
      start(x, y);
      to(x + w, y);
      to(x + w, y + h);
      to(x, y + h);
      cur.closed = true;
      cur = null;
    },
    arc(cx, cy, r, a0, a1, ccw = false) { arcPts(cx, cy, r, r, 0, a0, a1, ccw); },
    ellipse(cx, cy, rx, ry, rot, a0, a1, ccw = false) { arcPts(cx, cy, rx, ry, rot, a0, a1, ccw); },
    arcTo(x1, y1, x2, y2, r) {
      if (!last) return start(x1, y1);
      const ux = last.x - x1;
      const uy = last.y - y1;
      const vx = x2 - x1;
      const vy = y2 - y1;
      const lu = Math.hypot(ux, uy);
      const lv = Math.hypot(vx, vy);
      const crs = ux * vy - uy * vx;
      if (!r || !lu || !lv || Math.abs(crs) < 1e-9) return to(x1, y1);
      const theta = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv))));
      const t = r / Math.tan(theta / 2);
      const t1 = { x: x1 + (ux / lu) * t, y: y1 + (uy / lu) * t };
      const t2 = { x: x1 + (vx / lv) * t, y: y1 + (vy / lv) * t };
      const bx = ux / lu + vx / lv;
      const by = uy / lu + vy / lv;
      const bl = Math.hypot(bx, by);
      const k = r / Math.sin(theta / 2);
      const c = { x: x1 + (bx / bl) * k, y: y1 + (by / bl) * k };
      to(t1.x, t1.y);
      const a0 = Math.atan2(t1.y - c.y, t1.x - c.x);
      const a1 = Math.atan2(t2.y - c.y, t2.x - c.x);
      let d = a1 - a0;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      arcPts(c.x, c.y, r, r, 0, a0, a0 + d, d < 0);
    },
    quadraticCurveTo(cx, cy, x, y) {
      const p0 = last || { x: cx, y: cy };
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        const s = 1 - t;
        to(s * s * p0.x + 2 * s * t * cx + t * t * x, s * s * p0.y + 2 * s * t * cy + t * t * y);
      }
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      const p0 = last || { x: c1x, y: c1y };
      for (let i = 1; i <= 10; i++) {
        const t = i / 10;
        const s = 1 - t;
        to(
          s * s * s * p0.x + 3 * s * s * t * c1x + 3 * s * t * t * c2x + t * t * t * x,
          s * s * s * p0.y + 3 * s * s * t * c1y + 3 * s * t * t * c2y + t * t * t * y,
        );
      }
    },
    fill() { emit('fill'); },
    stroke() { emit('stroke'); },
    fillRect(x, y, w, h) { ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); emit('fill'); ctx.restore(); },
    strokeRect(x, y, w, h) { ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); emit('stroke'); ctx.restore(); },
    clip() {},
    fillText() {},
    strokeText() {},
    measureText: (s) => ({ width: String(s).length * 50 }),
  };
  return { ctx, ops };
}

const defOf = (catalogue, id) => {
  try {
    return catalogue?.getFurniture?.(id) || (Array.isArray(catalogue?.FURNITURE) ? catalogue.FURNITURE.find((x) => x.id === id) : null) || null;
  } catch {
    return null;
  }
};

/** The furniture item's plan symbol as world polylines (see the header). */
export function furnitureStrokes(catalogue, f) {
  const size = furnitureSize(catalogue, f);
  const def = defOf(catalogue, f.item);
  if (typeof def?.draw2d === 'function') {
    const a = ((f.rotation || 0) * Math.PI) / 180;
    const { ctx, ops } = createRecorder([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), f.x, f.y]);
    try {
      def.draw2d(ctx, size.w, size.d);
      if (ops.length) return ops;
    } catch {
      // fall through to the outline box
    }
  }
  const corners = furnitureCorners(f, size);
  return [
    { op: 'fill', paths: [{ pts: corners, closed: true }], width: 1, alpha: 1, tint: false, dash: [] },
    { op: 'stroke', paths: [{ pts: corners, closed: true }], width: 1, alpha: 1, tint: false, dash: [] },
  ];
}

// Label placement -----------------------------------------------------------------------------------------------------

/** Axis aligned box { x0, y0, x1, y1 } around points, grown by pad. */
export function boxOf(pts, pad = 0) {
  const b = G.bbox(pts);
  return { x0: b.minX - pad, y0: b.minY - pad, x1: b.maxX + pad, y1: b.maxY + pad };
}

export const overlapArea = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

const insidePoly = (r, poly) =>
  [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1], [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2]].every(([x, y]) => G.pointInPolygon({ x, y }, poly));

/**
 * Centre for a w by h label. Candidates on a grid over the polygon's box (all in the same units as the inputs, sheet mm
 * for the PDF). A candidate must sit wholly inside `poly` (shrunk by `inset`); among those the least overlap with
 * `obstacles` wins, then the one nearest `prefer` (the centroid). Returns { x, y, overlap } or null when nothing fits.
 */
export function placeLabel({ poly, w, h, obstacles = [], prefer, inset = 0.8, step = 0.8 }) {
  const b = boxOf(poly);
  const hw = w / 2 + inset;
  const hh = h / 2 + inset;
  let best = null;
  const nx = Math.max(1, Math.ceil((b.x1 - b.x0) / step));
  const ny = Math.max(1, Math.ceil((b.y1 - b.y0) / step));
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const x = b.x0 + (i * (b.x1 - b.x0)) / nx;
      const y = b.y0 + (j * (b.y1 - b.y0)) / ny;
      const r = { x0: x - hw, y0: y - hh, x1: x + hw, y1: y + hh };
      if (!insidePoly(r, poly)) continue;
      const lab = { x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 };
      let ov = 0;
      for (const o of obstacles) ov += overlapArea(lab, o);
      const dist = Math.hypot(x - prefer.x, y - prefer.y);
      const score = ov * 10 + dist * 0.15;
      if (!best || score < best.score) best = { x, y, overlap: ov, score };
    }
  }
  return best && { x: best.x, y: best.y, overlap: best.overlap };
}

/**
 * Spot for a short label beside a circle (a tank): inside it when it fits clear of obstacles, otherwise left, right,
 * below or above, whichever is clear first, else the least overlap. Returns the label centre.
 */
export function placeBeside({ c, r, w, h, obstacles = [], gap = 1 }) {
  const cands = [
    { x: c.x, y: c.y, inside: true },
    { x: c.x - r - gap - w / 2, y: c.y },
    { x: c.x + r + gap + w / 2, y: c.y },
    { x: c.x, y: c.y + r + gap + h / 2 },
    { x: c.x, y: c.y - r - gap - h / 2 },
  ];
  let best = null;
  for (const k of cands) {
    if (k.inside && w > 2 * r * 0.9) continue;
    const lab = { x0: k.x - w / 2, y0: k.y - h / 2, x1: k.x + w / 2, y1: k.y + h / 2 };
    let ov = 0;
    for (const o of obstacles) ov += overlapArea(lab, o);
    if (ov === 0) return { x: k.x, y: k.y };
    if (!best || ov < best.ov) best = { x: k.x, y: k.y, ov };
  }
  return best || { x: c.x, y: c.y };
}
