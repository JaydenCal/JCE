// Ground levels on the site plan (C100): contours (minor and major), RL labels along the major lines, spot levels at the lot and house
// corners. Levels are indicative, from the state 5 m DEM, never survey, and no floor level is stated.

import * as G from '../../../model/geometry.js';
import { PEN, clippedPolyline, haloText, alongLabel, clipSegment } from '../eng/kit.js';

const fin = (v) => typeof v === 'number' && Number.isFinite(v);

/** True when the lot carries ground data (a contour set or a levels grid). */
export function hasGround(lot) {
  return !!(lot && ((Array.isArray(lot.contours) && lot.contours.some((c) => (c.pts?.length || 0) >= 4)) || (lot.terrain && lot.terrain.values?.length)));
}

/** Contours at whole metres only (the 5 m DEM does not support finer), as [{ level, major, pts: [{x, y}] }] in plan mm. */
export function contourLines(lot) {
  const out = [];
  for (const c of lot?.contours || []) {
    if (!fin(c.level) || Math.abs(c.level - Math.round(c.level)) > 1e-6) continue;
    const flat = c.pts || [];
    const pts = [];
    for (let i = 0; i + 1 < flat.length; i += 2) if (fin(flat[i]) && fin(flat[i + 1])) pts.push({ x: flat[i], y: flat[i + 1] });
    if (c.closed && pts.length > 2) pts.push(pts[0]);
    if (pts.length >= 2) out.push({ level: c.level, major: !!c.major, pts });
  }
  return out;
}

/** Ground level (m) at a plan point: the levels grid by bilinear interpolation, else inverse distance from the contour vertices. */
export function groundLevelFn(lot) {
  const t = lot?.terrain;
  if (t && Array.isArray(t.values) && t.cols > 1 && t.rows > 1 && fin(t.cellMm) && t.cellMm > 0) {
    const at = (c, r) => t.values[Math.min(Math.max(r, 0), t.rows - 1) * t.cols + Math.min(Math.max(c, 0), t.cols - 1)];
    return (p) => {
      const fc = (p.x - t.x0) / t.cellMm;
      const fr = (p.y - t.y0) / t.cellMm;
      const c0 = Math.floor(fc);
      const r0 = Math.floor(fr);
      const a = at(c0, r0);
      const b = at(c0 + 1, r0);
      const c = at(c0, r0 + 1);
      const d = at(c0 + 1, r0 + 1);
      if (![a, b, c, d].every(fin)) return null;
      const u = Math.min(Math.max(fc - c0, 0), 1);
      const v = Math.min(Math.max(fr - r0, 0), 1);
      return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
    };
  }
  const pts = [];
  for (const c of contourLines(lot)) for (const p of c.pts) pts.push({ x: p.x, y: p.y, z: c.level });
  if (pts.length < 3) return () => null;
  return (p) => {
    const near = pts.map((q) => ({ d: Math.hypot(q.x - p.x, q.y - p.y), z: q.z })).sort((a, b) => a.d - b.d).slice(0, 8);
    if (near[0].d < 1) return near[0].z;
    let sw = 0;
    let s = 0;
    for (const n of near) { const w = 1 / (n.d * n.d); sw += w; s += w * n.z; }
    return s / sw;
  };
}

/** Draws the contours under everything else. `S` maps plan mm to sheet mm; `rect` is the viewport. Returns the lines for labelling. */
export function drawContours(doc, lot, S, rect) {
  const lines = contourLines(lot).map((c) => ({ ...c, sp: c.pts.map(S) }));
  doc.setLineDashPattern([], 0);
  for (const major of [false, true]) {
    doc.setDrawColor(...(major ? PEN.contourMajor : PEN.contourMinor));
    doc.setLineWidth(major ? 0.26 : 0.12);
    for (const c of lines) if (c.major === major) clippedPolyline(doc, c.sp, rect, false);
  }
  return lines;
}

/** RL labels along the major contours (and the minor ones when no major reaches the view), in the clear spaces of `field`. */
export function placeContourLabels(doc, field, lines, rect, { size = 5.2, spacingMm = 70 } = {}) {
  const majors = lines.filter((c) => c.major);
  const use = majors.length ? majors : lines;
  for (const c of use) {
    // The visible stretches of the line as one chain of points with their distance along it.
    const chain = [];
    let total = 0;
    for (let i = 0; i + 1 < c.sp.length; i++) {
      const s = clipSegment(c.sp[i], c.sp[i + 1], rect);
      if (!s) continue;
      if (!chain.length || Math.hypot(chain.at(-1).x - s[0].x, chain.at(-1).y - s[0].y) > 0.5) chain.push({ ...s[0], d: total });
      total += Math.hypot(s[1].x - s[0].x, s[1].y - s[0].y);
      chain.push({ ...s[1], d: total });
    }
    if (total < 22) continue;
    const pointAt = (d) => {
      for (let i = 0; i + 1 < chain.length; i++) {
        if (d >= chain[i].d && d <= chain[i + 1].d) {
          const span = chain[i + 1].d - chain[i].d;
          if (span < 1e-6) continue;
          return G.lerp(chain[i], chain[i + 1], (d - chain[i].d) / span);
        }
      }
      return null;
    };
    const want = Math.max(1, Math.min(3, Math.round(total / spacingMm)));
    let placed = 0;
    const txt = Number(c.level).toFixed(1);
    const fracs = [0.5, 0.3, 0.7, 0.18, 0.82, 0.4, 0.6, 0.1, 0.9, 0.25, 0.75, 0.35, 0.65];
    for (const strict of [true, false]) {
      for (const f of fracs) {
        if (placed >= want) break;
        const d0 = total * f;
        const mid = pointAt(d0);
        const p1 = pointAt(Math.max(0, d0 - 4));
        const p2 = pointAt(Math.min(total, d0 + 4));
        if (!mid || !p1 || !p2) continue;
        const dir = G.norm(G.sub(p2, p1));
        const l = alongLabel(doc, txt, mid, dir, -size * 0.3528 / 2, { size, bold: c.major, colour: c.major ? PEN.contourMajor : [150, 108, 50], halo: 0.9 });
        if (field.free(l.box, { soft: strict })) {
          l.draw();
          field.addBox(l.box);
          placed++;
        }
      }
      if (placed) break;
    }
  }
}

/** Corners worth a spot level: vertices that turn by more than 25 degrees (a curved frontage does not get one per segment). */
export function cornersOf(poly) {
  const n = poly.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n];
    const b = poly[i];
    const c = poly[(i + 1) % n];
    const u = G.norm(G.sub(b, a));
    const v = G.norm(G.sub(c, b));
    const turn = (Math.acos(Math.min(1, Math.max(-1, G.dot(u, v)))) * 180) / Math.PI;
    if (turn > 25) out.push(b);
  }
  return out.length ? out : poly.slice();
}

/** The hull vertex nearest each corner of its bounding box (at most four). */
export function houseCorners(hull) {
  if (!hull?.length) return [];
  const bb = G.bbox(hull);
  const picks = [];
  for (const c of [{ x: bb.minX, y: bb.minY }, { x: bb.maxX, y: bb.minY }, { x: bb.maxX, y: bb.maxY }, { x: bb.minX, y: bb.maxY }]) {
    const p = hull.reduce((a, b) => (Math.hypot(b.x - c.x, b.y - c.y) < Math.hypot(a.x - c.x, a.y - c.y) ? b : a));
    if (!picks.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 500)) picks.push(p);
  }
  return picks;
}

/**
 * Spot levels (to 0.1 m) at the lot corners and the house corners: a small cross and the level beside it, placed in clear space.
 * `outward(p)` gives the sheet direction away from the figure (so the text goes outside the lot or the house).
 */
export function drawSpotLevels(doc, field, spots, zAt, S, { size = 5.2 } = {}) {
  const seen = [];
  for (const sp of spots) {
    const z = zAt(sp.p);
    if (!fin(z)) continue;
    const q = S(sp.p);
    if (seen.some((o) => Math.hypot(o.x - q.x, o.y - q.y) < 2)) continue;
    seen.push(q);
    const txt = z.toFixed(1);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    const w = doc.getTextWidth(txt);
    const h = size * 0.3528;
    const d = sp.out || { x: 1, y: -1 };
    const tries = [];
    for (const k of [1.6, 2.6]) {
      tries.push({ x: q.x + d.x * (k + w / 2), y: q.y + d.y * (k + h / 2) });
      tries.push({ x: q.x - d.x * (k + w / 2), y: q.y + d.y * (k + h / 2) });
      tries.push({ x: q.x + d.x * (k + w / 2), y: q.y - d.y * (k + h / 2) });
    }
    for (const strict of [true, false]) {
      let done = false;
      for (const t of tries) {
        const box = { x0: t.x - w / 2 - 0.4, y0: t.y - h / 2 - 0.5, x1: t.x + w / 2 + 0.4, y1: t.y + h / 2 + 0.5 };
        if (!field.free(box, { soft: strict })) continue;
        doc.setDrawColor(...PEN.ink);
        doc.setLineWidth(0.12);
        doc.line(q.x - 0.9, q.y, q.x + 0.9, q.y);
        doc.line(q.x, q.y - 0.9, q.x, q.y + 0.9);
        haloText(doc, txt, t.x, t.y + h * 0.36, { size, colour: [60, 66, 90], align: 'center', halo: 0.8 });
        field.addBox(box);
        done = true;
        break;
      }
      if (done) break;
    }
  }
}
