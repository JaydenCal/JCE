// C102 LEVELS AND GRADING PLAN (INDICATIVE): the existing ground contours (dashed, as C100) and the finished surface contours the 3D model grades to
// (solid teal, only where they differ from the existing ground), the finished floor level of every building and unit row, finished surface spot
// levels on the paving, fall arrows on the graded paving zones (1 to 5 percent), the lowest ground on the boundary for the OSD placeholder and the
// indicative cut and fill. Issued only when the lot has ground data. Levels are indicative, from the state 5 m elevation model, never survey.
// Road surfaces are not drawn: the lot and its buildings only.

import * as G from '../../../model/geometry.js';
import { buildingsOf } from '../../../commercial/catalogue/buildings.js';
import { rowPoly } from '../../../commercial/layout.js';
import { PEN, LabelField, haloText, clean } from '../eng/kit.js';
import { VP } from './site.js';
import { drawGroundLayer, streamMark, outwardSpots, cornersOf, intervalText, drawFflTag } from './contours.js';
import { fflText, rlText } from './levels.js';
import { layoutView, northAndScale, legendBlock } from './commercial.js';

const GREEN = [10, 124, 58];
const TEAL = [11, 122, 133];

/** Indicative cut and fill (m3) over the lot on a 2 m grid: the finished surface against the natural ground. */
export function cutFill(levels, lot) {
  const bb = G.bbox(lot.boundary);
  const step = Math.max(2000, Math.round(Math.max(bb.w, bb.h) / 120 / 500) * 500);
  let cut = 0; let fill = 0;
  for (let y = bb.minY + step / 2; y < bb.maxY; y += step) for (let x = bb.minX + step / 2; x < bb.maxX; x += step) {
    const p = { x, y };
    if (!G.pointInPolygon(p, lot.boundary)) continue;
    const n = levels.natural(p); const d = levels.design(p);
    if (n == null || d == null) continue;
    const dz = d - n;
    const v = Math.abs(dz) * (step / 1000) * (step / 1000);
    if (dz > 0.005) fill += v; else if (dz < -0.005) cut += v;
  }
  return { cutM3: Math.round(cut), fillM3: Math.round(fill) };
}

/** The lowest natural ground on the lot boundary (plan mm and RL m): where the OSD placeholder drains to. */
export function lowestOnBoundary(levels, lot) {
  let best = null;
  const pts = [];
  const b = lot.boundary;
  for (let i = 0; i < b.length; i++) { const a = b[i]; const c = b[(i + 1) % b.length]; for (let k = 0; k < 8; k++) pts.push({ x: a.x + ((c.x - a.x) * k) / 8, y: a.y + ((c.y - a.y) * k) / 8 }); }
  for (const p of pts) { const z = levels.natural(p); if (z != null && (!best || z < best.z)) best = { p, z }; }
  return best;
}

/** The scale of the sheet (the same view as the layout sheet C101). */
export const levelsScaleOf = (model) => `1:${layoutView(model).scale} @ A3`;

export function drawLevelsPlan(doc, model, levels) {
  const { lot, c } = model;
  const view = layoutView(model);
  const { T, scale } = view;
  const field = new LabelField(VP);
  const gmark = streamMark(doc);
  doc.setLineDashPattern([], 0);
  // Lot boundary
  doc.setDrawColor(...GREEN); doc.setLineWidth(0.7);
  const b = lot.boundary.map(T);
  for (let i = 0; i < b.length; i++) { const p = b[i]; const q = b[(i + 1) % b.length]; doc.line(p.x, p.y, q.x, q.y); }
  field.addRing(b);
  // Graded paving zones, lightly filled, with a fall arrow on each (down slope of the finished surface)
  const zones = (levels.grading?.zones || []).filter((z) => !z.pad && !z.road);
  let arrows = 0;
  for (const z of zones) {
    for (const poly of z.polys) {
      if (!poly || poly.length < 3) continue;
      const sp = poly.map(T);
      doc.setFillColor(236, 240, 244); doc.setDrawColor(...PEN.light); doc.setLineWidth(0.12);
      const [p0, ...rest] = sp;
      doc.lines(rest.map((p, i) => [p.x - (i ? rest[i - 1].x : p0.x), p.y - (i ? rest[i - 1].y : p0.y)]), p0.x, p0.y, [1, 1], 'FD', true);
    }
  }
  // Buildings and unit rows
  const outlines = [];
  for (const bd of buildingsOf(c)) outlines.push({ poly: bd.outline, key: bd.outline });
  for (const r of c.rows || []) if (!r.mirrorOf) outlines.push({ poly: rowPoly(r, c.rows), key: rowPoly(r, c.rows) });
  for (const r of c.rows || []) if (r.mirrorOf) outlines.push({ poly: rowPoly(r, c.rows), key: null });
  for (const o of outlines) {
    const sp = o.poly.map(T);
    doc.setFillColor(246, 240, 222); doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.35);
    const [p0, ...rest] = sp;
    doc.lines(rest.map((p, i) => [p.x - (i ? rest[i - 1].x : p0.x), p.y - (i ? rest[i - 1].y : p0.y)]), p0.x, p0.y, [1, 1], 'FD', true);
    field.addRing(sp);
  }
  // Fall arrows after the buildings so they sit on the paving
  for (const z of zones) {
    const poly = z.polys.slice().sort((p, q) => Math.abs(G.polygonArea ? G.polygonArea(q) : 0) - Math.abs(G.polygonArea ? G.polygonArea(p) : 0))[0];
    if (!poly || poly.length < 3 || arrows >= 8 || !(z.fall > 0.004)) continue;
    const cen = G.polygonCentroid(poly);
    const h = 1500;
    const gx = (z.level(cen.x + h, cen.y) - z.level(cen.x - h, cen.y)) / (2 * h);
    const gy = (z.level(cen.x, cen.y + h) - z.level(cen.x, cen.y - h)) / (2 * h);
    const g = Math.hypot(gx, gy);
    if (g < 1e-4) continue;
    const dir = { x: -gx / g, y: -gy / g };
    const a = T({ x: cen.x - dir.x * 5000, y: cen.y - dir.y * 5000 });
    const e = T({ x: cen.x + dir.x * 5000, y: cen.y + dir.y * 5000 });
    doc.setDrawColor(...TEAL); doc.setLineWidth(0.3); doc.line(a.x, a.y, e.x, e.y);
    const d = G.norm(G.sub(e, a)); const n = { x: -d.y, y: d.x };
    doc.setFillColor(...TEAL); doc.triangle(e.x, e.y, e.x - d.x * 2.2 + n.x * 0.9, e.y - d.y * 2.2 + n.y * 0.9, e.x - d.x * 2.2 - n.x * 0.9, e.y - d.y * 2.2 - n.y * 0.9, 'F');
    haloText(doc, `${(z.fall * 100).toFixed(1)}%`, (a.x + e.x) / 2 + n.x * 2.4, (a.y + e.y) / 2 + n.y * 2.4 + 0.8, { size: 5.6, colour: TEAL, align: 'center', halo: 0.9 });
    field.addBox({ x0: Math.min(a.x, e.x) - 3, y0: Math.min(a.y, e.y) - 3, x1: Math.max(a.x, e.x) + 3, y1: Math.max(a.y, e.y) + 3 });
    arrows += 1;
  }
  // FFL tags
  const ffl = outlines.filter((o) => o.key).map((o) => ({ poly: o.poly.map(T), text: fflText(levels, levels.fflOf(o.key)) }));
  const rect = { x0: VP.x0, y0: VP.y0, x1: VP.x1, y1: VP.y1 };
  const masks = outlines.map((o) => o.poly.map(T));
  const spots = outwardSpots(cornersOf(lot.boundary), T);
  const natural = drawGroundLayer(doc, { lot, levels, S: T, Si: view.Ti, rect, field, masks, light: true, spots, ffl, mark: gmark });
  const design = levels.hasDesign ? drawGroundLayer(doc, { lot, levels, S: T, Si: view.Ti, rect, field, masks, design: true, mark: gmark, labelSize: 5.6, ffl: [], spots: [] }) : null;
  // Finished surface spot levels at the corners of the graded zones (the most outward four of the first zones)
  let fsl = 0;
  if (levels.hasDesign) {
    for (const z of zones.slice(0, 3)) for (const poly of z.polys.slice(0, 1)) for (const p of poly.slice(0, 4)) {
      const rl = levels.design(p);
      if (rl == null) continue;
      const q = T(p);
      doc.setFillColor(...TEAL); doc.circle(q.x, q.y, 0.45, 'F');
      const bx = { x0: q.x + 0.8, y0: q.y - 3, x1: q.x + 16, y1: q.y + 0.4 };
      if (field.free(bx, { lines: false })) { haloText(doc, `FSL ${rlText(rl)}`, q.x + 1, q.y - 0.6, { size: 5.6, bold: true, colour: TEAL, halo: 0.9 }); field.addBox(bx); fsl += 1; }
    }
  }
  // The lowest ground on the boundary (where the OSD placeholder drains to)
  const low = lowestOnBoundary(levels, lot);
  if (low) {
    const q = T(low.p);
    doc.setDrawColor(...PEN.tag); doc.setLineWidth(0.3); doc.circle(q.x, q.y, 1.1, 'S');
    const bx = { x0: q.x + 2, y0: q.y - 3.4, x1: q.x + 46, y1: q.y + 1 };
    if (field.free(bx, { lines: false })) { haloText(doc, `LOWEST GROUND RL ${rlText(low.z)}`, q.x + 2.4, q.y + 0.6, { size: 5.6, bold: true, colour: PEN.tag, halo: 0.9 }); field.addBox(bx); }
  }
  northAndScale(doc, field, model.project, scale, view);
  const cf = cutFill(levels, lot);
  const iv = natural.interval;
  const kv = [
    ['Contours', iv ? intervalText(iv) : 'None at this view'],
    ['Floor levels', outlines.filter((o) => o.key).map((o, i) => `${i + 1}: RL ${rlText(levels.fflOf(o.key))}`).slice(0, 4).join(', ') || 'n/a'],
    ['Ground relief', `${levels.reliefM.toFixed(1)} m`],
    ['Cut and fill (indicative)', `${cf.cutM3.toLocaleString('en-AU')} / ${cf.fillM3.toLocaleString('en-AU')} m³`],
    ['Paving falls', '1 to 5 percent'],
  ];
  const notes = [
    'Concept only. The finished surface is the grading the 3D model uses: flat building pads at floor level, paving at 1 to 5 percent fall, batters at 1 in 3.',
    natural.note || 'Levels are indicative, interpolated from the state 5 m elevation model, not survey. A registered surveyor must confirm levels.',
    'Cut and fill volumes are indicative and exclude topsoil, pavement build up and footings.',
  ];
  const legend = [...(natural.legend || []), ...(design?.legend || [])];
  void fsl; void clean;
  return { scale, kv, notes, blocks: [legendBlock([
    ['Lot boundary (existing)', (d, a, y) => { d.setDrawColor(...GREEN); d.setLineWidth(0.7); d.line(a, y, a + 12, y); }],
    ['PROPOSED BUILDING', (d, a, y) => { d.setFillColor(246, 240, 222); d.setDrawColor(...PEN.ink); d.setLineWidth(0.35); d.rect(a, y - 1.4, 12, 2.8, 'FD'); }],
    ['Graded paving and fall', (d, a, y) => { d.setFillColor(236, 240, 244); d.setDrawColor(...PEN.light); d.rect(a, y - 1.4, 12, 2.8, 'FD'); d.setDrawColor(...TEAL); d.setLineWidth(0.3); d.line(a + 1, y, a + 11, y); }],
    ...legend,
  ])] };
}
