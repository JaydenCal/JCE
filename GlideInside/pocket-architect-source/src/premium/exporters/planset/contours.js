// Ground levels on the plan sheets: contours (existing dashed, design solid; minor and major weights), RL labels along the major lines,
// spot levels, finished floor level (FFL) tags. Levels are indicative, interpolated from the state 5 m DEM, never survey.
// One shared helper, drawGroundLayer(), is used by every plan sheet so no sheet has its own version.

import * as G from '../../../model/geometry.js';
import { PEN, haloText, alongLabel, clipSegment } from '../eng/kit.js';
import { contourLines as marchContours, fillGaps } from '../../../site/contours.js';

const fin = (v) => typeof v === 'number' && Number.isFinite(v);

/** True when the lot carries ground data (a contour set or a levels grid). */
export function hasGround(lot) {
  return !!(lot && ((Array.isArray(lot.contours) && lot.contours.some((c) => (c.pts?.length || 0) >= 4)) || (lot.terrain && lot.terrain.values?.length)));
}

/** The contours stored on the lot (older projects with no levels grid), every level, as [{ level, major, pts: [{x, y}] }] in plan mm. */
export function contourLines(lot) {
  const out = [];
  for (const c of lot?.contours || []) {
    if (!fin(c.level)) continue;
    const flat = c.pts || [];
    const pts = [];
    for (let i = 0; i + 1 < flat.length; i += 2) if (fin(flat[i]) && fin(flat[i + 1])) pts.push({ x: flat[i], y: flat[i + 1] });
    if (c.closed && pts.length > 2) pts.push(pts[0]);
    if (pts.length >= 2) out.push({ level: c.level, major: !!c.major, pts });
  }
  return out;
}

// Contour interval ---------------------------------------------------------------------------------------------------------------
/**
 * The finest contour interval (m) a sheet may use. Owner decision 18/11/2026: 0.5 m. Ground with less fall than this shows spot levels
 * instead of contours. Change this one constant and every sheet follows.
 */
export const CONTOUR_FINEST_M = 0.5;
/** More levels than this inside the view steps the interval up one row. */
export const MAX_CONTOUR_LEVELS = 40;
const INTERVAL_ROWS = [
  { upTo: 1.5, minor: 0.25, major: 1, decimals: 2 },
  { upTo: 5, minor: 0.5, major: 2, decimals: 1 },
  { upTo: 15, minor: 1, major: 5, decimals: 1 },
  { upTo: Infinity, minor: 2, major: 10, decimals: 0 },
];

/** { minor, major, decimals } for the relief (m) across the view. */
export function chooseInterval(reliefM, { finest = CONTOUR_FINEST_M, maxLevels = MAX_CONTOUR_LEVELS } = {}) {
  const rows = INTERVAL_ROWS.filter((r) => r.minor >= finest - 1e-9);
  const relief = Math.max(0, Number(reliefM) || 0);
  const count = (m) => Math.floor(relief / m) + 1;
  let k = rows.findIndex((r) => relief < r.upTo);
  if (k < 0) k = rows.length - 1;
  while (k < rows.length - 1 && count(rows[k].minor) > maxLevels) k++;
  let { minor, major, decimals } = rows[k];
  while (count(minor) > maxLevels) { minor *= 2; major *= 2; decimals = 0; }
  return { minor, major, decimals };
}

export const fmtM = (v) => (Math.abs(v * 10 - Math.round(v * 10)) < 1e-9 ? v.toFixed(1) : v.toFixed(2));
/** "0.25 m minor, 1.0 m major". */
export const intervalText = (iv) => `${fmtM(iv.minor)} m minor, ${fmtM(iv.major)} m major`;

// Contours from a levels grid ----------------------------------------------------------------------------------------------------
function chaikin(pts) {
  const closed = pts.length > 3 && Math.hypot(pts[0].x - pts.at(-1).x, pts[0].y - pts.at(-1).y) < 1e-6;
  const mix = (p, q, t) => ({ x: p.x * (1 - t) + q.x * t, y: p.y * (1 - t) + q.y * t });
  const out = [];
  if (closed) {
    const ring = pts.slice(0, -1);
    for (let i = 0; i < ring.length; i++) { const p = ring[i]; const q = ring[(i + 1) % ring.length]; out.push(mix(p, q, 0.25), mix(p, q, 0.75)); }
    out.push(out[0]);
    return out;
  }
  out.push(pts[0]);
  for (let i = 0; i + 1 < pts.length; i++) { out.push(mix(pts[i], pts[i + 1], 0.25), mix(pts[i], pts[i + 1], 0.75)); }
  out.push(pts.at(-1));
  return out;
}

/** Marching squares over a plan grid { cols, rows, cellMm, x0, y0, values } (row 0 at the north, plan y down). Output in plan mm. */
function gridContours(g, { minor, major, smooth = true }) {
  const grid = { cols: g.cols, rows: g.rows, cell: g.cellMm, x0: g.x0, y0: -g.y0, values: Array.from(g.values) };
  try { fillGaps(grid); } catch { return []; }
  const raw = marchContours(grid, { minor, major });
  return raw.map((c) => {
    let pts = c.points.map(([x, y]) => ({ x, y: -y }));
    if (smooth && g.cellMm >= 3000 && pts.length > 2) pts = chaikin(pts);
    return { level: c.level, major: c.major, closed: c.closed, pts };
  }).filter((c) => c.pts.length >= 2);
}

/** The window of a lot terrain grid covering `bbox` (plan mm) plus a margin, as a grid of its own. */
function cropTerrain(t, bbox, padCells = 2) {
  if (!bbox) return t;
  const i0 = Math.max(0, Math.floor((bbox.minX - t.x0) / t.cellMm) - padCells);
  const i1 = Math.min(t.cols - 1, Math.ceil((bbox.maxX - t.x0) / t.cellMm) + padCells);
  const j0 = Math.max(0, Math.floor((bbox.minY - t.y0) / t.cellMm) - padCells);
  const j1 = Math.min(t.rows - 1, Math.ceil((bbox.maxY - t.y0) / t.cellMm) + padCells);
  if (i1 - i0 < 1 || j1 - j0 < 1) return null;
  const cols = i1 - i0 + 1;
  const rows = j1 - j0 + 1;
  const values = new Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) values[j * cols + i] = t.values[(j0 + j) * t.cols + i0 + i];
  return { cols, rows, cellMm: t.cellMm, x0: t.x0 + i0 * t.cellMm, y0: t.y0 + j0 * t.cellMm, values };
}

/**
 * Existing ground contours at `minor` and `major` (m), regenerated from the lot's levels grid so the interval never depends on what the
 * server stored. `bbox` (plan mm) limits the work to the view. A lot with contours but no grid falls back to the stored lines, unfiltered.
 * Output: [{ level, major, closed, pts: [{x, y}] }].
 */
export function terrainContours(lot, { minor = 0.5, major = 2, bbox = null, smooth = true } = {}) {
  const t = lot?.terrain;
  if (t && Array.isArray(t.values) && t.values.length && t.cols > 1 && t.rows > 1 && fin(t.cellMm) && t.cellMm > 0) {
    const g = cropTerrain(t, bbox);
    return g ? gridContours(g, { minor, major, smooth }) : [];
  }
  return contourLines(lot);
}

/**
 * Contours of any RL function `fn({x, y})` (plan mm) over `bbox`, sampled on a grid of `cellMm` (raised to stay under `maxNodes` a side).
 * Used for the design surface.
 */
export function surfaceContours(fn, bbox, { minor = 0.5, major = 2, cellMm = 1000, maxNodes = 300 } = {}) {
  let cell = cellMm;
  while ((bbox.maxX - bbox.minX) / cell + 1 > maxNodes || (bbox.maxY - bbox.minY) / cell + 1 > maxNodes) cell *= 1.25;
  const cols = Math.max(2, Math.ceil((bbox.maxX - bbox.minX) / cell) + 1);
  const rows = Math.max(2, Math.ceil((bbox.maxY - bbox.minY) / cell) + 1);
  const values = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const v = fn({ x: bbox.minX + i * cell, y: bbox.minY + j * cell }); values.push(fin(v) ? v : null); }
  return gridContours({ cols, rows, cellMm: cell, x0: bbox.minX, y0: bbox.minY, values }, { minor, major, smooth: false });
}

/** Keeps only the stretches of design contours where the design surface differs from the natural surface by more than `tol` (m). */
export function whereChanged(lines, natural, design, tol = 0.05) {
  const out = [];
  const differs = (p) => { const a = natural(p); const b = design(p); return fin(a) && fin(b) && Math.abs(a - b) > tol; };
  for (const c of lines) {
    let run = [];
    const flush = () => { if (run.length >= 2) out.push({ ...c, closed: false, pts: run }); run = []; };
    for (let i = 0; i + 1 < c.pts.length; i++) {
      const a = c.pts[i];
      const b = c.pts[i + 1];
      if (differs({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })) { if (!run.length) run.push(a); run.push(b); } else flush();
    }
    flush();
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

/** Contour lines mapped to sheet mm (`S` maps plan mm to sheet mm). */
export function prepareContours(lines, S) {
  return lines.map((c) => ({ ...c, sp: c.pts.map(S) }));
}

const segInter = (a, b, c, d) => {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : null;
};

/** A box as a mask polygon, grown by `pad` mm. */
export const boxMask = (b, pad = 0.6) => [{ x: b.x0 - pad, y: b.y0 - pad }, { x: b.x1 + pad, y: b.y0 - pad }, { x: b.x1 + pad, y: b.y1 + pad }, { x: b.x0 - pad, y: b.y1 + pad }];

// Pens. Existing contours are dashed brown, design contours are solid teal, so the two never share a convention.
const DESIGN_PEN = { minor: [11, 122, 133], major: [8, 96, 106] };
const EXISTING_PEN = { minor: PEN.contourMinor, major: PEN.contourMajor };
const LIGHT_PEN = { minor: [218, 196, 164], major: [196, 158, 108] };
const WIDTH = { existing: { minor: 0.12, major: 0.26 }, design: { minor: 0.13, major: 0.28 } };
const DASH = { minor: [2.2, 1.0], major: [4.5, 1.2] };
/** The pen of a contour: { colour, width, dash }. */
export function contourPen({ design = false, major = false, light = false } = {}) {
  const k = major ? 'major' : 'minor';
  return { colour: design ? DESIGN_PEN[k] : light ? LIGHT_PEN[k] : EXISTING_PEN[k], width: WIDTH[design ? 'design' : 'existing'][k], dash: design ? [] : DASH[k] };
}

/**
 * Strokes the contours with gaps: every part of a line that falls inside a mask polygon (label blocks, dimension text, the house
 * footprint, the driveway) is left out. Lines are first clipped to the viewport `rect`. Consecutive visible pieces are stroked as one
 * path so a dashed line keeps its rhythm. Returns the number of polylines stroked.
 */
export function strokeContours(doc, lines, rect, masks, { light = false } = {}) {
  const bbs = masks.map((m) => G.bbox(m));
  let count = 0;
  for (const design of [false, true]) {
    for (const major of [false, true]) {
      const pen = contourPen({ design, major, light });
      doc.setDrawColor(...pen.colour);
      doc.setLineWidth(pen.width);
      doc.setLineDashPattern(pen.dash, 0);
      for (const c of lines) {
        if (!!c.design !== design || !!c.major !== major) continue;
        let run = null;
        const flush = () => {
          if (run && run.length >= 2) {
            doc.lines(run.slice(1).map((q, i) => [q.x - run[i].x, q.y - run[i].y]), run[0].x, run[0].y, [1, 1], 'S', false);
            count++;
          }
          run = null;
        };
        const piece = (a, b) => {
          if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-4) return;
          if (run && Math.hypot(run.at(-1).x - a.x, run.at(-1).y - a.y) < 1e-3) run.push(b);
          else { flush(); run = [a, b]; }
        };
        for (let i = 0; i + 1 < c.sp.length; i++) {
          const s = clipSegment(c.sp[i], c.sp[i + 1], rect);
          if (!s) { flush(); continue; }
          const [p, q] = s;
          const lo = { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y) };
          const hi = { x: Math.max(p.x, q.x), y: Math.max(p.y, q.y) };
          const near = [];
          masks.forEach((m, k) => { const b = bbs[k]; if (!(hi.x < b.minX || lo.x > b.maxX || hi.y < b.minY || lo.y > b.maxY)) near.push(m); });
          if (!near.length) { piece(p, q); continue; }
          const ts = [0, 1];
          for (const m of near) for (let k = 0; k < m.length; k++) { const t = segInter(p, q, m[k], m[(k + 1) % m.length]); if (t != null) ts.push(t); }
          ts.sort((x, y) => x - y);
          for (let k = 0; k + 1 < ts.length; k++) {
            if (ts[k + 1] - ts[k] < 1e-6) continue;
            const mid = G.lerp(p, q, (ts[k] + ts[k + 1]) / 2);
            if (near.some((m) => G.pointInPolygon(mid, m))) { flush(); continue; }
            piece(G.lerp(p, q, ts[k]), G.lerp(p, q, ts[k + 1]));
          }
        }
        flush();
      }
    }
  }
  doc.setLineDashPattern([], 0);
  return count;
}

/** RL labels along the major contours (and the minor ones when no major reaches the view), in the clear spaces of `field`. Returns the labels drawn. */
export function placeContourLabels(doc, field, lines, rect, { size = 5.6, spacingMm = 70, decimals = 1, avoid = [] } = {}) {
  const bbs = avoid.map((m) => G.bbox(m));
  const drawn = [];
  for (const design of [false, true]) {
    const mine = lines.filter((c) => !!c.design === design);
    const majors = mine.filter((c) => c.major);
    const use = majors.length ? majors : mine;
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
      const txt = Number(c.level).toFixed(decimals);
      const colour = design ? DESIGN_PEN.major : c.major ? PEN.contourMajor : [150, 108, 50];
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
          const l = alongLabel(doc, txt, mid, dir, -size * 0.3528 / 2, { size, bold: c.major, colour, halo: 0.9 });
          const b = l.box;
          const pts = [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }, mid];
          if (avoid.some((m, k) => !(b.x1 < bbs[k].minX || b.x0 > bbs[k].maxX || b.y1 < bbs[k].minY || b.y0 > bbs[k].maxY) && pts.some((q) => G.pointInPolygon(q, m)))) continue;
          if (field.free(l.box, { soft: strict })) {
            l.draw();
            field.addBox(l.box);
            drawn.push(txt);
            placed++;
          }
        }
        if (placed) break;
      }
    }
  }
  return drawn;
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
 * Spot levels at the given plan points: existing ones are a small cross with the level beside it, design ones (FSL) a filled dot with a
 * bold teal level. The text goes in clear space. `outward(p)` gives the sheet direction away from the figure (so the text goes outside
 * the lot or the house). Returns the number drawn.
 */
export function drawSpotLevels(doc, field, spots, zAt, S, { size = 5.6, decimals = 1, design = false, prefix = '' } = {}) {
  const seen = [];
  let drawn = 0;
  for (const sp of spots) {
    const z = zAt(sp.p);
    if (!fin(z)) continue;
    const q = S(sp.p);
    if (seen.some((o) => Math.hypot(o.x - q.x, o.y - q.y) < 2)) continue;
    seen.push(q);
    const txt = `${prefix}${z.toFixed(decimals)}`;
    doc.setFont('helvetica', design ? 'bold' : 'normal');
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
        if (design) {
          doc.setFillColor(...DESIGN_PEN.major);
          doc.circle(q.x, q.y, 0.55, 'F');
        } else {
          doc.setDrawColor(...PEN.ink);
          doc.setLineWidth(0.12);
          doc.setLineDashPattern([], 0);
          doc.line(q.x - 0.9, q.y, q.x + 0.9, q.y);
          doc.line(q.x, q.y - 0.9, q.x, q.y + 0.9);
        }
        haloText(doc, txt, t.x, t.y + h * 0.36, { size, bold: design, colour: design ? DESIGN_PEN.major : [60, 66, 90], align: 'center', halo: 0.8 });
        field.addBox(box);
        done = true;
        drawn++;
        break;
      }
      if (done) break;
    }
  }
  return drawn;
}

/**
 * A boxed finished floor level tag ("FFL 103.25") for a building or row whose outline on the sheet is `poly`. Goes inside the outline when
 * the box fits in clear space, else just outside it. Returns the box or null.
 */
export function drawFflTag(doc, field, poly, text, { size = 6.5 } = {}) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(size);
  const w = doc.getTextWidth(text) + 2.4;
  const h = size * 0.3528 + 1.8;
  const bb = G.bbox(poly);
  const c = G.polygonCentroid(poly);
  const cands = [];
  const inside = (b) => [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].every(([x, y]) => G.pointInPolygon({ x, y }, poly));
  for (let r = 0; r <= Math.max(bb.w, bb.h) / 2; r += 2.5) {
    for (let k = 0; k < (r === 0 ? 1 : 12); k++) {
      const a = (k / 12) * Math.PI * 2;
      const q = { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
      cands.push({ x0: q.x - w / 2, y0: q.y - h / 2, x1: q.x + w / 2, y1: q.y + h / 2 });
    }
  }
  const out = [];
  for (const side of [-1, 1]) {
    out.push({ x0: c.x - w / 2, y0: side < 0 ? bb.minY - h - 0.8 : bb.maxY + 0.8, x1: c.x + w / 2, y1: side < 0 ? bb.minY - 0.8 : bb.maxY + h + 0.8 });
    out.push({ x0: side < 0 ? bb.minX - w - 0.8 : bb.maxX + 0.8, y0: c.y - h / 2, x1: side < 0 ? bb.minX - 0.8 : bb.maxX + w + 0.8, y1: c.y + h / 2 });
  }
  for (const strict of [true, false]) {
    for (const b of [...cands.filter(inside), ...out]) {
      if (!field.free(b, { soft: strict, lines: false })) continue;
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...PEN.ink);
      doc.setLineWidth(0.2);
      doc.setLineDashPattern([], 0);
      doc.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(size);
      doc.setTextColor(...PEN.ink);
      doc.text(text, (b.x0 + b.x1) / 2, b.y1 - 0.95, { align: 'center' });
      field.addBox(b);
      return b;
    }
  }
  return null;
}

// The shared ground layer ----------------------------------------------------------------------------------------------------------
/** { stream, at } for the page being drawn: the strokes can be moved back to `at` so they sit under the linework. */
export function streamMark(doc) {
  const d = doc.raw || doc;
  const stream = d.internal.pages[d.internal.getCurrentPageInfo().pageNumber];
  return { stream, at: stream.length };
}

const reliefOver = (fn, bb, n = 24) => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const z = fn({ x: bb.minX + ((bb.maxX - bb.minX) * i) / n, y: bb.minY + ((bb.maxY - bb.minY) * j) / n });
    if (fin(z)) { if (z < lo) lo = z; if (z > hi) hi = z; }
  }
  return hi >= lo ? { min: lo, max: hi, relief: hi - lo } : { min: 0, max: 0, relief: 0 };
};

/** The lot centre and a unit step outward, for spot levels at the corners of a polygon (sheet space). */
export function outwardSpots(points, S) {
  if (!points.length) return [];
  const q = points.map(S);
  const c = { x: q.reduce((s, p) => s + p.x, 0) / q.length, y: q.reduce((s, p) => s + p.y, 0) / q.length };
  return points.map((p, i) => { const d = G.sub(q[i], c); const l = Math.hypot(d.x, d.y) || 1; return { p, out: { x: d.x / l, y: d.y / l } }; });
}

/** "Levels are indicative ..." note for every sheet that carries levels. */
export function levelsNote(lot, interval) {
  const dem = `${lot?.state === 'QLD' ? 'Queensland' : 'NSW'} 5 m elevation model`;
  return `Levels are indicative, interpolated from the ${dem}, not survey. Contours at ${fmtM(interval?.minor ?? 0.5)} m are an interpolation and show the fall only. A registered surveyor must confirm levels.`;
}

/** Legend entries [text, draw(doc, x, y)] for what the layer drew. Same shape the sheet legends use. */
export function contourLegendEntries(interval, { design = false, light = false } = {}) {
  const sample = (d, major, x0, x1, y) => (doc) => {
    const pen = contourPen({ design: d, major, light });
    doc.setDrawColor(...pen.colour);
    doc.setLineWidth(pen.width);
    doc.setLineDashPattern(pen.dash, 0);
    doc.line(x0, y, x1, y);
    doc.setLineDashPattern([], 0);
  };
  const entry = (text, d) => [text, (doc, a, b) => { sample(d, false, a, a + 5.5, b - 0.7)(doc); sample(d, true, a + 6.5, a + 12, b + 0.7)(doc); }];
  return [entry(`${design ? 'Design' : 'Existing'} contour, ${fmtM(interval.minor)} m`, design)];
}

/**
 * The one ground layer every plan sheet uses. In order: FFL tags, spot levels, RL labels along the contours, then the contour strokes with
 * gaps at every label, the masks (buildings, paving) and the viewport edge; the strokes are moved back to `mark` so they sit under the
 * linework. Nothing is drawn when the levels model has no ground data.
 *
 *   lot, levels   the lot (plan mm) and levelsModel()
 *   S, Si         plan mm to sheet mm and its inverse (Si gives the plan window of `rect` for the interval)
 *   rect, field   the viewport and its LabelField
 *   masks         sheet mm polygons the contours must not enter
 *   design        draw the design surface (solid) instead of the existing ground (dashed)
 *   light         paler pens (sheets where the ground is context only)
 *   spots         [{ p, out }] plan points for spot levels
 *   ffl           [{ poly, text }] sheet mm outlines and tag text
 *   reserve       boxes added to the field after the spots and before the RL labels (e.g. the house, flagged nomask)
 *   mark          streamMark(doc) taken before the linework
 * Returns { drawn, lines, interval, note, legend, stroked, labels, spots, ffl }.
 */
export function drawGroundLayer(doc, { lot, levels, S, Si = null, rect, field, masks = [], design = false, light = false, spots = [], ffl = [], mark = null, bbox = null, interval = null, labelSize = 5.6, spotSize = 5.6, labels = true, only = null, reserve = [] } = {}) {
  const none = { drawn: false, lines: [], interval: null, note: null, legend: [], stroked: 0, labels: [], spots: 0, ffl: 0 };
  // The FFL tags state the floor level, with or without ground data (an assumed datum is said so).
  let fflDrawn = 0;
  for (const t of ffl) if (drawFflTag(doc, field, t.poly, t.text)) fflDrawn++;
  if (!levels?.has) return { ...none, ffl: fflDrawn };
  const natural = levels.natural;
  const win = bbox || (Si ? G.bbox([{ x: rect.x0, y: rect.y0 }, { x: rect.x1, y: rect.y0 }, { x: rect.x1, y: rect.y1 }, { x: rect.x0, y: rect.y1 }].map(Si)) : G.bbox(lot.boundary));
  const view = { minX: win.minX, minY: win.minY, maxX: win.maxX, maxY: win.maxY };
  const { relief } = reliefOver(natural, view);
  const iv = interval || (lot.terrain ? chooseInterval(relief) : { minor: Number(lot.contourInterval) > 0 ? Number(lot.contourInterval) : 0.5, major: 2.5, decimals: 1 });
  let lines = design ? surfaceContours(levels.design, view, { minor: iv.minor, major: iv.major }).map((c) => ({ ...c, design: true })) : terrainContours(lot, { minor: iv.minor, major: iv.major, bbox: view }).map((c) => ({ ...c, design: false }));
  if (design) lines = whereChanged(lines, natural, levels.design).map((c) => ({ ...c, design: true }));
  if (only) lines = lines.filter(only);
  const sp = prepareContours(lines, S);
  // Spot levels first (they are the figures people read), then the RL labels in the space that is left.
  const nSpots = drawSpotLevels(doc, field, spots, design ? levels.design : natural, S, { size: spotSize, decimals: Math.max(1, iv.decimals), design, prefix: design ? 'FSL ' : '' });
  for (const b of reserve) field.addBox(b);
  const labelTxt = labels ? placeContourLabels(doc, field, sp, rect, { size: labelSize, decimals: iv.decimals, avoid: masks }) : [];
  const m = field.boxes.filter((b) => !b.nomask).map((b) => boxMask(b));
  const stroked = (() => {
    const before = mark ? mark.stream.length : 0;
    const n = strokeContours(doc, sp, rect, [...m, ...masks], { light });
    if (mark) {
      const added = mark.stream.splice(before);
      mark.stream.splice(mark.at, 0, 'q', ...added, 'Q');
      mark.at += added.length + 2;
    }
    return n;
  })();
  const legend = stroked ? contourLegendEntries(iv, { design, light }) : [];
  const flat = !lines.length && !!lot.terrain ? `Ground is near level, no contour crosses the site at ${fmtM(iv.minor)} m, so spot levels are shown. ` : '';
  return { drawn: stroked > 0, lines: sp, interval: iv, note: `${flat}${levelsNote(lot, iv)}`, legend, stroked, labels: labelTxt, spots: nSpots, ffl: fflDrawn };
}

/** A small legend block for the title strip holding only the ground entries a sheet drew (none when nothing was stroked). */
export function groundLegendBlock(ground) {
  const items = ground?.legend || [];
  if (!items.length) return null;
  return {
    title: 'LEGEND',
    h: 4 + items.length * 4 + 2,
    draw(doc, x, y) {
      items.forEach(([t, draw], i) => {
        const ly = y + 2.4 + i * 4;
        draw(doc, x + 3, ly);
        doc.setLineDashPattern([], 0);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.2);
        doc.setTextColor(...PEN.ink);
        doc.text(t, x + 18, ly + 0.8);
      });
    },
  };
}
