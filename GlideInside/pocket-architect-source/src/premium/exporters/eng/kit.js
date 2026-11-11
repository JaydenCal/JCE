// Drafting kit for the engineering style plan set: pen colours, text clean up, hatches, clipping, boxed call outs with leaders that
// keep clear of each other, dimension lines and view titles. Pure functions over a jsPDF like `doc` (see pdf.js scaledDoc). Sheet
// units are millimetres on the A3 design sheet. Node compatible.

import * as G from '../../../model/geometry.js';
import { polygon, polyline, fit, ink } from '../pdf.js';

export { polygon, polyline, fit, ink };

// Pens. The site plan follows the JCE site plan sets: green lot boundary, thin grey neighbours, red envelope, blue proposed works.
export const PEN = {
  ink: [18, 20, 24],
  grey: [118, 122, 130],
  light: [200, 203, 209],
  band: [240, 242, 245],
  boundary: [10, 124, 58],
  neighbour: [96, 100, 108],
  envelope: [196, 32, 32],
  dim: [0, 112, 140],
  proposed: [10, 50, 150],
  proposedFill: [214, 226, 248],
  hard: [150, 150, 150],
  contourMinor: [196, 160, 112],
  contourMajor: [150, 98, 40],
  road: [60, 62, 68],
  phantom: [200, 20, 20],
  tag: [196, 32, 32],
  // Existing cadastral boundaries over an aerial are red (owner convention). The setback envelope is magenta so the two never read alike.
  cadRed: [232, 28, 28],
  envelopeAerial: [214, 0, 160],
};

/** Standard PHANTOM line type: one long dash then two short dashes (sheet mm on A3). */
export const PHANTOM = [14, 2, 2, 2, 2, 2];
export const PHANTOM_LEN = 24;

/** Text sizes (pt on A3). Nothing on a drawing is smaller than TXT.min except the footer band. */
export const TXT = { min: 6.5, small: 7, body: 8, label: 9, strong: 10, head: 12, title: 16 };

const FORBIDDEN = [[/\b(non-?)?compliant\b/gi, 'within indicative limits']];

/** Plain text for a sheet: no en or em dashes, no characters the standard PDF fonts cannot print, and never the word "compliant". */
export function clean(s) {
  let t = String(s ?? '')
    .replace(/[‒–—―−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/×/g, 'x')
    .replace(/[   ]/g, ' ')
    .normalize('NFC')
    .replace(/[^\x20-\x7e°±²³·]/g, '')
    .replace(/%%/g, '% %')
    .replace(/\s+/g, ' ')
    .replace(/\bm2\b/g, 'm²')
    .replace(/\bM2\b/g, 'M²')
    .trim();
  for (const [re, to] of FORBIDDEN) t = t.replace(re, to);
  return t;
}

export const wrap = (doc, text, width) => doc.splitTextToSize(clean(text), width);

/** Wrap a doc so every string written through it is cleaned (m2 becomes m², no dashes). Used round code that writes its own text. */
export function cleanedDoc(doc) {
  return new Proxy(doc, {
    get(t, prop) {
      if (prop === 'text') return (s, ...r) => t.text(Array.isArray(s) ? s.map(clean) : clean(s), ...r);
      const v = t[prop];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

/** Text reading upwards, centred on (x, yMid). jsPDF centres rotated text along the wrong axis, so the start point is worked out here. */
export function vtext(doc, text, x, yMid, { size = null, colour = null, bold = false } = {}) {
  const t = clean(text);
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  if (size) doc.setFontSize(size);
  if (colour) doc.setTextColor(...colour);
  doc.text(t, x, yMid + doc.getTextWidth(t) / 2, { angle: 90 });
}

/** Text with a white halo (a thick white stroke under the glyphs), so it reads over an aerial. */
export function haloText(doc, text, x, y, { size = 8, bold = false, colour = PEN.ink, align = 'left', angle = 0, halo = 0.9 } = {}) {
  const t = clean(text);
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  if (halo) {
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(halo);
    doc.text(t, x, y, { align, angle, renderingMode: 'stroke' });
  }
  doc.setTextColor(...colour);
  doc.text(t, x, y, { align, angle });
}

// Boxes ---------------------------------------------------------------------------------------------------------------------
export const boxOfPts = (pts, pad = 0) => {
  const b = G.bbox(pts);
  return { x0: b.minX - pad, y0: b.minY - pad, x1: b.maxX + pad, y1: b.maxY + pad };
};
export const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
export const inflate = (b, d) => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d });
export const segHitsBox = (a, b, r) => {
  // Liang-Barsky against the box; true when any part of the segment is inside.
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - r.x0], [dx, r.x1 - a.x], [-dy, a.y - r.y0], [dy, r.y1 - a.y]]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return true;
};
const segSegHit = (a, b, c, d) => {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(a, b, c);
  const d2 = o(a, b, d);
  const d3 = o(c, d, a);
  const d4 = o(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
};

/** Clip segment a-b to a rectangle { x0, y0, x1, y1 }. Returns [p, q] or null. */
export function clipSegment(a, b, r) {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - r.x0], [dx, r.x1 - a.x], [-dy, a.y - r.y0], [dy, r.y1 - a.y]]) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
    }
  }
  return [{ x: a.x + dx * t0, y: a.y + dy * t0 }, { x: a.x + dx * t1, y: a.y + dy * t1 }];
}

/** Draw a polyline clipped to `rect`, optionally closed. */
export function clippedPolyline(doc, pts, rect, closed = false) {
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const s = clipSegment(pts[i], pts[(i + 1) % pts.length], rect);
    if (s) doc.line(s[0].x, s[0].y, s[1].x, s[1].y);
  }
}

// Hatching --------------------------------------------------------------------------------------------------------------------
/** Hatch segments filling a polygon (sheet mm): parallel lines `spacing` apart at `angleDeg`. Works for any simple polygon. */
export function hatchSegments(poly, angleDeg, spacing) {
  if (!poly || poly.length < 3) return [];
  const th = (angleDeg * Math.PI) / 180;
  const u = { x: Math.cos(th), y: Math.sin(th) }; // along the hatch lines
  const v = { x: -u.y, y: u.x }; // across them
  const vs = poly.map((p) => G.dot(p, v));
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const out = [];
  for (let c = Math.ceil(lo / spacing) * spacing + spacing / 2; c < hi; c += spacing) {
    const xs = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const da = G.dot(a, v) - c;
      const db = G.dot(b, v) - c;
      if ((da < 0) === (db < 0)) continue;
      const t = da / (da - db);
      xs.push(G.dot(G.lerp(a, b, t), u));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) out.push([G.add(G.mul(u, xs[k]), G.mul(v, c)), G.add(G.mul(u, xs[k + 1]), G.mul(v, c))]);
  }
  return out;
}

/** Named hatches: proposed works, hardstand, bitumen, concrete. Each is { angle, spacing, width, colour, cross? }. */
export const HATCH = {
  proposed: { angle: 45, spacing: 1.6, width: 0.09, colour: PEN.proposed },
  hardstand: { angle: 135, spacing: 1.4, width: 0.08, colour: [90, 90, 90], cross: 45 },
  bitumen: { angle: 0, spacing: 1.9, width: 0.08, colour: [90, 92, 98], dots: true },
  concrete: { angle: 45, spacing: 2.4, width: 0.07, colour: [110, 110, 110], dots: true },
  // Road pavement: plain lines along the road alignment (the caller gives the angle), no stipple.
  road: { angle: 0, spacing: 2.6, width: 0.07, colour: [120, 124, 132] },
  roadAerial: { angle: 0, spacing: 4, width: 0.06, colour: [235, 235, 235] },
  footpath: { angle: 90, spacing: 3.2, width: 0.07, colour: [140, 144, 150] },
  poche: { angle: 45, spacing: 1.1, width: 0.12, colour: [18, 20, 24] },
};

export function hatch(doc, poly, kind, over = {}) {
  const h = { ...(HATCH[kind] || HATCH.proposed), ...over };
  doc.setLineWidth(h.width);
  doc.setDrawColor(...h.colour);
  doc.setLineDashPattern([], 0);
  for (const [a, b] of hatchSegments(poly, h.angle, h.spacing)) doc.line(a.x, a.y, b.x, b.y);
  if (h.cross != null) for (const [a, b] of hatchSegments(poly, h.cross, h.spacing)) doc.line(a.x, a.y, b.x, b.y);
  if (h.dots) {
    // Stipple: small dots on a staggered grid, to read as bitumen or concrete rather than lines alone.
    const bb = boxOfPts(poly);
    doc.setFillColor(...h.colour);
    const step = h.spacing * 2.4;
    for (let y = Math.ceil(bb.y0 / step) * step, row = 0; y < bb.y1; y += step, row++) {
      for (let x = Math.ceil(bb.x0 / step) * step + (row % 2 ? step / 2 : 0); x < bb.x1; x += step) {
        if (G.pointInPolygon({ x, y }, poly)) doc.circle(x, y, 0.12, 'F');
      }
    }
  }
}

// Dimensions -------------------------------------------------------------------------------------------------------------------
/** Two arrow ticks, an extension line pair and the text centred on the line (white behind the text). */
export function dimLine(doc, a, b, text, { colour = PEN.dim, size = 6, offset = 0, textSide = 1, whiteBehind = true } = {}) {
  const d = G.norm(G.sub(b, a));
  const n = { x: -d.y, y: d.x };
  const A = G.add(a, G.mul(n, offset));
  const B = G.add(b, G.mul(n, offset));
  doc.setDrawColor(...colour);
  doc.setLineWidth(0.13);
  doc.setLineDashPattern([], 0);
  if (offset) {
    doc.line(a.x, a.y, A.x + n.x * Math.sign(offset) * 1.2, A.y + n.y * Math.sign(offset) * 1.2);
    doc.line(b.x, b.y, B.x + n.x * Math.sign(offset) * 1.2, B.y + n.y * Math.sign(offset) * 1.2);
  }
  doc.line(A.x, A.y, B.x, B.y);
  const tick = (p) => {
    doc.setLineWidth(0.25);
    doc.line(p.x - d.x * 0.9 - n.x * 0.9, p.y - d.y * 0.9 - n.y * 0.9, p.x + d.x * 0.9 + n.x * 0.9, p.y + d.y * 0.9 + n.y * 0.9);
  };
  tick(A);
  tick(B);
  if (!text) return;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(size);
  const w = doc.getTextWidth(text);
  const mid = G.lerp(A, B, 0.5);
  if (Math.hypot(B.x - A.x, B.y - A.y) < w + 3) {
    // Too short to carry its text: the text sits horizontally beside the line, with a halo.
    const side = textSide >= 0 ? 1 : -1;
    const right = n.x * side >= 0;
    const px = mid.x + n.x * side * 1.8 + (right ? 0 : 0);
    const py = mid.y + n.y * side * 1.8 + 1;
    haloText(doc, text, px, py, { size, colour, align: n.x * side >= 0 ? 'left' : 'right', halo: 0.9 });
    const x0 = n.x * side >= 0 ? px : px - w;
    return { x0: x0 - 0.5, y0: py - size * 0.3528 - 0.5, x1: x0 + w + 0.5, y1: py + 0.8 };
  }
  let ang = (Math.atan2(d.y, d.x) * 180) / Math.PI;
  if (ang > 90) ang -= 180;
  if (ang < -90) ang += 180;
  const rad = (ang * Math.PI) / 180;
  const off = textSide * 2.4;
  const tx = mid.x + Math.sin(rad) * off;
  const ty = mid.y - Math.cos(rad) * off;
  const hw = Math.abs(Math.cos(rad)) * w / 2 + Math.abs(Math.sin(rad)) * 1.5;
  const hh = Math.abs(Math.sin(rad)) * w / 2 + Math.abs(Math.cos(rad)) * 1.5;
  if (whiteBehind) { doc.setFillColor(255, 255, 255); doc.rect(tx - hw, ty - hh, 2 * hw, 2 * hh, 'F'); }
  // Written from its start point: jsPDF centres rotated text along the wrong axis.
  const dv = { x: Math.cos(rad), y: Math.sin(rad) };
  const upv = { x: Math.sin(rad), y: -Math.cos(rad) };
  const capH = size * 0.3528 * 0.72;
  doc.setTextColor(...colour);
  doc.text(text, tx - dv.x * w / 2 - upv.x * capH / 2, ty - dv.y * w / 2 - upv.y * capH / 2, { angle: -ang });
  return { x0: tx - hw, y0: ty - hh, x1: tx + hw, y1: ty + hh };
}

// Call outs --------------------------------------------------------------------------------------------------------------------
/**
 * Boxed call outs with leaders. items: [{ id, lines: [string] (first line bold), at: {x,y} (what it points to), colour, size }].
 * obstacles: boxes the box and its leader should avoid. area: the sheet rectangle the boxes must stay inside.
 * Returns [{ ...item, box, anchor, leaderTo }] placed so that boxes do not overlap each other or the obstacles, and leaders do not
 * cross each other or other boxes. Greedy: biggest first, each takes the best of many candidate spots round its target.
 */
export function placeCallouts(doc, items, { obstacles = [], avoid = [], area, size = 6.4 } = {}) {
  const placed = [];
  const taken = [...obstacles];
  const leaders = [];
  const measured = items.map((it) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(it.size || size);
    const lines = it.lines.map(clean);
    const wBold = doc.getTextWidth(lines[0] || '');
    doc.setFont('helvetica', 'normal');
    const wRest = Math.max(0, ...lines.slice(1).map((l) => doc.getTextWidth(l)));
    const sz = (it.size || size) * 0.3528;
    const w = Math.max(wBold, wRest) + 4.4;
    const h = lines.length * sz * 1.35 + 2.4;
    return { ...it, lines, w, h, sz };
  });
  measured.sort((a, b) => b.w * b.h - a.w * a.h);
  for (const it of measured) {
    const dirs = 16;
    let best = null;
    for (let ring = 0; ring < 9; ring++) {
      const dist = 7 + ring * 7 + Math.max(it.w, it.h) / 2;
      for (let k = 0; k < dirs; k++) {
        const th = (k / dirs) * Math.PI * 2;
        const cx = it.at.x + Math.cos(th) * dist;
        const cy = it.at.y + Math.sin(th) * dist * 0.8;
        const box = { x0: cx - it.w / 2, y0: cy - it.h / 2, x1: cx + it.w / 2, y1: cy + it.h / 2 };
        if (area && (box.x0 < area.x0 + 1 || box.y0 < area.y0 + 1 || box.x1 > area.x1 - 1 || box.y1 > area.y1 - 1)) continue;
        let score = ring * 4;
        for (const o of taken) score += overlap(inflate(box, 0.6), o) * 80;
        for (const sg of avoid) if (segHitsBox(sg[0], sg[1], inflate(box, 0.4))) score += 500;
        // The leader runs from the nearest point on the box to the target.
        const a = { x: G.clamp(it.at.x, box.x0, box.x1), y: G.clamp(it.at.y, box.y0, box.y1) };
        if (Math.hypot(a.x - it.at.x, a.y - it.at.y) < 1.5) score += 200;
        for (const L of leaders) if (segSegHit(a, it.at, L.a, L.b)) score += 400;
        for (const o of placed) if (segHitsBox(a, it.at, inflate(o.box, 0.3))) score += 400;
        for (const o of taken.slice(obstacles.length)) if (segHitsBox(a, it.at, inflate(o, 0.3))) score += 300;
        score += Math.hypot(a.x - it.at.x, a.y - it.at.y) * 0.4;
        if (!best || score < best.score) best = { score, box, a };
      }
      if (best && best.score < ring * 4 + 4 && ring >= 1) break;
    }
    if (!best) {
      const box = { x0: it.at.x + 6, y0: it.at.y - it.h / 2, x1: it.at.x + 6 + it.w, y1: it.at.y + it.h / 2 };
      best = { box, a: { x: box.x0, y: it.at.y }, score: 1e9 };
    }
    placed.push({ ...it, box: best.box, anchor: best.a, leaderTo: it.at });
    taken.push(best.box);
    leaders.push({ a: best.a, b: it.at });
  }
  return placed;
}

/** Draw placed call outs: white box with a coloured outline, bold first line, a leader and a dot on the target. */
export function drawCallouts(doc, placed) {
  for (const c of placed) {
    const col = c.colour || PEN.ink;
    doc.setDrawColor(...col);
    doc.setLineWidth(0.15);
    doc.setLineDashPattern([], 0);
    doc.line(c.anchor.x, c.anchor.y, c.leaderTo.x, c.leaderTo.y);
    doc.setFillColor(...col);
    doc.circle(c.leaderTo.x, c.leaderTo.y, 0.55, 'F');
    doc.setFillColor(255, 255, 255);
    doc.setLineWidth(0.22);
    doc.rect(c.box.x0, c.box.y0, c.box.x1 - c.box.x0, c.box.y1 - c.box.y0, 'FD');
    let y = c.box.y0 + 1.2 + c.sz * 0.95;
    c.lines.forEach((l, i) => {
      doc.setFont('helvetica', i === 0 ? 'bold' : 'normal');
      doc.setFontSize(c.size || 6.4);
      doc.setTextColor(...col);
      doc.text(l, c.box.x0 + 1.6, y);
      y += c.sz * 1.35;
    });
  }
}

// View title -------------------------------------------------------------------------------------------------------------------
/** "SITE PLAN" in bold with a red underline and "1:200 @ A3" beside it. Returns the box it occupies. */
export function viewTitle(doc, x, y, title, scaleLabel, { size = 11 } = {}) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(size);
  ink(doc, PEN.ink);
  const t = clean(title).toUpperCase();
  doc.text(t, x, y);
  const w = doc.getTextWidth(t);
  doc.setDrawColor(...PEN.tag);
  doc.setLineWidth(0.7);
  doc.line(x, y + 1.3, x + w, y + 1.3);
  let right = x + w;
  if (scaleLabel) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size * 0.72);
    ink(doc, PEN.grey);
    doc.text(clean(scaleLabel), x + w + 3, y);
    right += 3 + doc.getTextWidth(clean(scaleLabel));
  }
  return { x0: x, y0: y - size * 0.36, x1: right, y1: y + 2 };
}

/** Text with a white rectangle behind it, so it reads over linework. Returns its box. */
export function labelOn(doc, text, x, y, { size = 6, bold = false, colour = PEN.ink, align = 'center', angle = 0, pad = 0.5 } = {}) {
  const t = clean(text);
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  const w = doc.getTextWidth(t);
  const h = size * 0.3528;
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  if (!angle) {
    doc.setFillColor(255, 255, 255);
    doc.rect(x0 - pad, y - h - pad + 0.3, w + 2 * pad, h + 2 * pad, 'F');
  }
  doc.setTextColor(...colour);
  doc.text(t, x, y, { align, angle });
  return { x0: x0 - pad, y0: y - h - pad, x1: x0 + w + pad, y1: y + pad };
}

/** Sutherland-Hodgman: polygon clipped to a rectangle. Returns [] when nothing is left. */
export function clipPolygon(poly, r) {
  const edges = [
    [(p) => p.x >= r.x0, (a, b) => ({ x: r.x0, y: a.y + ((b.y - a.y) * (r.x0 - a.x)) / (b.x - a.x) })],
    [(p) => p.x <= r.x1, (a, b) => ({ x: r.x1, y: a.y + ((b.y - a.y) * (r.x1 - a.x)) / (b.x - a.x) })],
    [(p) => p.y >= r.y0, (a, b) => ({ y: r.y0, x: a.x + ((b.x - a.x) * (r.y0 - a.y)) / (b.y - a.y) })],
    [(p) => p.y <= r.y1, (a, b) => ({ y: r.y1, x: a.x + ((b.x - a.x) * (r.y1 - a.y)) / (b.y - a.y) })],
  ];
  let out = poly;
  for (const [inside, cut] of edges) {
    const inp = out;
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i];
      const b = inp[(i + 1) % inp.length];
      if (inside(b)) {
        if (!inside(a)) out.push(cut(a, b));
        out.push(b);
      } else if (inside(a)) out.push(cut(a, b));
    }
    if (!out.length) return [];
  }
  return out;
}

/** Text running along a direction (unit vector in sheet space), offset to one side. Returns its axis aligned box. */
export function alongText(doc, text, mid, dir, offset, { size = 5.6, colour = PEN.ink, bold = false } = {}) {
  const t = clean(text);
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  const w = doc.getTextWidth(t);
  let d = dir;
  let ang = (Math.atan2(d.y, d.x) * 180) / Math.PI;
  if (ang > 90) ang -= 180;
  if (ang <= -90) ang += 180;
  const rad = (ang * Math.PI) / 180;
  d = { x: Math.cos(rad), y: Math.sin(rad) };
  const n = { x: d.y, y: -d.x }; // up the page side
  const p = { x: mid.x + n.x * offset, y: mid.y + n.y * offset };
  const base = { x: p.x - d.x * w / 2, y: p.y - d.y * w / 2 };
  doc.setTextColor(...colour);
  doc.text(t, base.x, base.y, { angle: -ang });
  const h = size * 0.3528;
  const ends = [base, { x: base.x + d.x * w, y: base.y + d.y * w }];
  const pts = [...ends, ...ends.map((e) => ({ x: e.x + n.x * h, y: e.y + n.y * h }))];
  return boxOfPts(pts, 0.4);
}


/**
 * Text running along an edge, measured before it is drawn: { box, draw() }. `dir` is the edge direction in sheet space, `offset` the
 * distance from the edge to the text baseline (positive is the up the page side of the reading direction).
 */
export function alongLabel(doc, text, mid, dir, offset, { size = 8, colour = PEN.ink, bold = false, halo = 0 } = {}) {
  const t = clean(text);
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  const w = doc.getTextWidth(t);
  let ang = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
  if (ang > 90) ang -= 180;
  if (ang <= -90) ang += 180;
  const rad = (ang * Math.PI) / 180;
  const d = { x: Math.cos(rad), y: Math.sin(rad) };
  const n = { x: d.y, y: -d.x };
  const p = { x: mid.x + n.x * offset, y: mid.y + n.y * offset };
  const base = { x: p.x - d.x * w / 2, y: p.y - d.y * w / 2 };
  const h = size * 0.3528;
  const ends = [base, { x: base.x + d.x * w, y: base.y + d.y * w }];
  const pts = [...ends, ...ends.map((e) => ({ x: e.x + n.x * h, y: e.y + n.y * h }))];
  return {
    box: boxOfPts(pts, 0.5),
    up: n,
    draw: () => haloText(doc, t, base.x, base.y, { size, bold, colour, angle: -ang, halo }),
  };
}

/**
 * Registry of what is already on a drawing: label boxes and linework segments. Labels are tried at several places and the first
 * that fits inside the viewport and clear of everything else is drawn; otherwise it is dropped (or the caller falls back).
 */
export class LabelField {
  constructor(rect) { this.rect = rect; this.boxes = []; this.segs = []; }
  addBox(b) { if (b) this.boxes.push(b); return b; }
  addSeg(a, b, soft = false) { const s = [a, b]; if (soft) s.soft = true; this.segs.push(s); }
  addRing(pts, closed = true, soft = false) { const n = closed ? pts.length : pts.length - 1; for (let i = 0; i < n; i++) this.addSeg(pts[i], pts[(i + 1) % pts.length], soft); }
  inside(b) { const r = this.rect; return b.x0 >= r.x0 + 0.8 && b.y0 >= r.y0 + 0.8 && b.x1 <= r.x1 - 0.8 && b.y1 <= r.y1 - 0.8; }
  free(b, { lines = true, soft = true, ignoreSegs = [] } = {}) {
    if (!this.inside(b)) return false;
    for (const o of this.boxes) if (overlap(inflate(b, 0.3), o) > 0) return false;
    if (lines) for (const sg of this.segs) if (!ignoreSegs.includes(sg) && (soft || !sg.soft) && segHitsBox(sg[0], sg[1], b)) return false;
    return true;
  }
  /** Try `cands` (functions or label specs returning { box, draw }) in order. Returns the placed one or null. */
  place(cands, opts) {
    for (const c of cands) {
      const l = typeof c === 'function' ? c() : c;
      if (l && this.free(l.box, opts)) { l.draw(); this.boxes.push(l.box); return l; }
    }
    return null;
  }
}

/**
 * Superscript digits. Some PDF viewers lack the superscript glyphs of the standard fonts, so "m²" would show as "m". Strings with ²
 * or ³ are written as the text, then the digit at 62 percent size, raised. Widths (alignment, wrapping, fitting) count the same way.
 */
export function withSuperscripts(doc) {
  let size = 10;
  const SUP = { '²': '2', '³': '3' };
  const widthOf = (t, s) => {
    const parts = String(s).split(/([²³])/);
    let w = 0;
    for (const p of parts) {
      if (SUP[p]) { doc.setFontSize(size * 0.62); w += doc.getTextWidth(SUP[p]); doc.setFontSize(size); } else if (p) w += doc.getTextWidth(p);
    }
    return w;
  };
  return new Proxy(doc, {
    get(t, prop) {
      if (prop === 'setFontSize') return (n) => { size = n; return t.setFontSize(n); };
      if (prop === 'getTextWidth') return (s) => (/[²³]/.test(String(s)) ? widthOf(t, s) : t.getTextWidth(s));
      if (prop === 'text') {
        return (s, x, y, o = {}) => {
          if (typeof s !== 'string' || !/[²³]/.test(s)) return t.text(s, x, y, o);
          const a = ((o.angle || 0) * Math.PI) / 180;
          const d = { x: Math.cos(a), y: -Math.sin(a) };
          const up = { x: -Math.sin(a), y: -Math.cos(a) };
          const W = widthOf(t, s);
          let off = o.align === 'center' ? -W / 2 : o.align === 'right' ? -W : 0;
          const { align, ...rest } = o;
          void align;
          for (const p of s.split(/([²³])/)) {
            if (!p) continue;
            if (SUP[p]) {
              const raise = size * 0.3528 * 0.38;
              t.setFontSize(size * 0.62);
              t.text(SUP[p], x + d.x * off + up.x * raise, y + d.y * off + up.y * raise, rest);
              off += t.getTextWidth(SUP[p]);
              t.setFontSize(size);
            } else {
              t.text(p, x + d.x * off, y + d.y * off, rest);
              off += t.getTextWidth(p);
            }
          }
          return undefined;
        };
      }
      const v = t[prop];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}
