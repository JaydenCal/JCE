// Cover sheet (C000): project name and address, drawing index, locality context (DCDB), house thumbnail, revision table and general notes.

import * as G from '../../../model/geometry.js';
import { clean, PEN, ink, wrap } from '../eng/kit.js';
import { planGeometry } from '../pdf.js';
import { wallShapes } from '../shared.js';
import { groundLevel, areaTotals } from './lot.js';
import { levelContent } from '../drawing.js';
import { AREA, ENTITY, ABN, EMAIL, REV_TEXT, fit } from './frame.js';

const GREY = [120, 124, 132];
const LOC = { x0: 206, y0: 24, x1: AREA.x1 - 5, y1: 150 };
const THUMB = { x0: 206, y0: 156, x1: AREA.x1 - 5, y1: 262 };

const frame = (doc, r, title) => {
  doc.setDrawColor(...PEN.ink);
  doc.setLineWidth(0.3);
  doc.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...PEN.ink);
  doc.text(title, r.x0, r.y0 - 2.2);
};

const polyPath = (doc, pts, style) => { doc.lines(pts.slice(1).map((p, i) => [p.x - pts[i].x, p.y - pts[i].y]), pts[0].x, pts[0].y, [1, 1], style, true); };

/** Locality scale for the cover: from the lot extent, rounded up to a standard scale. */
export function localityScale(lot) {
  if (!lot) return null;
  const bb = G.bbox(lot.boundary);
  const w = LOC.x1 - LOC.x0 - 6;
  const h = LOC.y1 - LOC.y0 - 6;
  const SC = [250, 500, 1000, 2000, 2500, 5000, 10000, 20000];
  const big = Math.max(bb.w, bb.h);
  // Largest scale that still draws the lot at least 30 mm long on the sheet (so it is clearly visible), as long as it fits the frame.
  const fits = (n) => bb.w / n <= w * 0.85 && bb.h / n <= h * 0.85;
  const clear = SC.filter((n) => big / n >= 30 && fits(n));
  if (clear.length) return clear.at(-1);
  return SC.find(fits) || 20000;
}

function locality(doc, lot, project) {
  frame(doc, LOC, 'LOCALITY PLAN (DCDB CONTEXT)');
  if (!lot) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    doc.text('No lot is attached to this concept, so no locality plan is shown.', (LOC.x0 + LOC.x1) / 2, (LOC.y0 + LOC.y1) / 2, { align: 'center' });
    return null;
  }
  const scale = localityScale(lot);
  const c = G.polygonCentroid(lot.boundary);
  const mx = (LOC.x0 + LOC.x1) / 2;
  const my = (LOC.y0 + LOC.y1) / 2;
  const T = (p) => ({ x: mx + (p.x - c.x) / scale, y: my + (p.y - c.y) / scale });
  const R = { x0: LOC.x0 + 0.5, y0: LOC.y0 + 0.5, x1: LOC.x1 - 0.5, y1: LOC.y1 - 0.5 };
  const clipPoly = (pts, closed = true) => {
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      // Liang Barsky against R
      let t0 = 0;
      let t1 = 1;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      let ok = true;
      for (const [p, q] of [[-dx, a.x - R.x0], [dx, R.x1 - a.x], [-dy, a.y - R.y0], [dy, R.y1 - a.y]]) {
        if (p === 0) { if (q < 0) ok = false; } else { const t = q / p; if (p < 0) { if (t > t1) ok = false; else if (t > t0) t0 = t; } else if (t < t0) ok = false; else if (t < t1) t1 = t; }
      }
      if (ok) doc.line(a.x + dx * t0, a.y + dy * t0, a.x + dx * t1, a.y + dy * t1);
    }
  };
  doc.setLineWidth(0.15);
  doc.setDrawColor(...GREY);
  for (const n of lot.neighbours || []) if (n.ring?.length >= 3) clipPoly(n.ring.map(T));
  // Adjoining lot numbers, where the lot data has them and the ring centre is on the plan.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(...GREY);
  for (const n of lot.neighbours || []) {
    if (n.isRoad || !n.lotNumber || !(n.ring?.length >= 3)) continue;
    const cc = T(G.polygonCentroid(n.ring));
    const txt = `LOT ${n.lotNumber}`;
    const tw = doc.getTextWidth(txt);
    if (cc.x - tw / 2 < R.x0 + 1 || cc.x + tw / 2 > R.x1 - 1 || cc.y < R.y0 + 3 || cc.y > R.y1 - 5) continue;
    doc.text(txt, cc.x, cc.y, { align: 'center' });
  }
  doc.setTextColor(...GREY);
  for (const r of lot.roads || []) {
    const pts = [];
    for (let i = 0; i + 1 < (r.pts || []).length; i += 2) pts.push(T({ x: r.pts[i], y: r.pts[i + 1] }));
    if (pts.length > 1) { doc.setLineWidth(0.3); doc.setDrawColor(...PEN.phantom); clipPoly(pts, false); }
  }
  const lp = lot.boundary.map(T);
  doc.setFillColor(255, 236, 140);
  doc.setDrawColor(...PEN.ink);
  doc.setLineWidth(0.5);
  polyPath(doc, lp, 'FD');
  const gl = groundLevel(project);
  if (gl) {
    doc.setFillColor(...PEN.proposed);
    for (const r of gl.rooms) if (!r.outdoor && r.polygon?.length >= 3) polyPath(doc, r.polygon.map(T), 'F');
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...PEN.ink);
  doc.text(lot.proposed ? `PROPOSED LOT ${lot.lotNumber || ''}`.trim() : lot.lotNumber ? `LOT ${lot.lotNumber}` : 'SUBJECT LOT', lp.reduce((a, p) => a + p.x, 0) / lp.length, Math.min(...lp.map((p) => p.y)) - 2, { align: 'center' });
  // north point and scale text
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...GREY);
  doc.text(`Scale 1:${scale} @ A3. Cadastre (DCDB) context only, not a survey.`, LOC.x0 + 2, LOC.y1 - 2);
  const a = ((Number(project.site?.northDeg) || 0) * Math.PI) / 180;
  const nx = LOC.x1 - 12;
  const ny = LOC.y0 + 13;
  const d = { x: Math.sin(a), y: -Math.cos(a) };
  const p = { x: -d.y, y: d.x };
  doc.setFillColor(255, 255, 255);
  ink(doc, PEN.ink);
  doc.setLineWidth(0.3);
  doc.circle(nx, ny, 7, 'FD');
  doc.setFillColor(...PEN.ink);
  doc.triangle(nx + d.x * 6, ny + d.y * 6, nx - d.x * 2.4 + p.x * 2.1, ny - d.y * 2.4 + p.y * 2.1, nx - d.x * 2.4 - p.x * 2.1, ny - d.y * 2.4 - p.y * 2.1, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...PEN.ink);
  doc.text('N', nx + d.x * 10, ny + d.y * 10 + 1, { align: 'center' });
  return scale;
}

function thumbnail(doc, project, catalogue, title) {
  frame(doc, THUMB, title);
  const gl = groundLevel(project);
  if (!gl) return;
  const content = levelContent(project, gl, false, catalogue);
  const bw = THUMB.x1 - THUMB.x0 - 10;
  const bh = THUMB.y1 - THUMB.y0 - 26;
  const ds = [100, 150, 200, 250, 300, 400, 500].find((n) => content.box.w / n <= bw && content.box.h / n <= bh) || 600;
  const ox = THUMB.x0 + (THUMB.x1 - THUMB.x0 - content.box.w / ds) / 2;
  const oy = THUMB.y0 + 8 + (bh - content.box.h / ds) / 2;
  const T = (p) => ({ x: ox + (p.x - content.box.minX) / ds, y: oy + (p.y - content.box.minY) / ds });
  const shapes = wallShapes(gl);
  planGeometry(doc, { level: gl, shapes, scale: ds }, T, false, catalogue);
  const t = areaTotals(project);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...PEN.ink);
  [['Living', t.living], ['Garage', t.garage], ['Alfresco', t.alfresco], ['Total', t.total]].forEach(([k, v], i) => doc.text(`${k} ${v.toFixed(1)} m²`, THUMB.x0 + 4 + i * 28, THUMB.y1 - 4));
}

/** Draws the cover. ctx: { project, lot, projectTitle, address, lotDp, builderName, dateStr, catalogue, index: [{ no, title, scale }] }. Returns { locScale }. */
export function drawCover(doc, ctx) {
  const { project, lot } = ctx;
  const X = AREA.x0 + 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(11, 122, 133);
  doc.text('CONCEPT PLAN SET', X, AREA.y0 + 14);
  doc.setFontSize(24);
  doc.setTextColor(...PEN.ink);
  let y = AREA.y0 + 27;
  wrap(doc, ctx.projectTitle.toUpperCase(), 185).slice(0, 2).forEach((l) => { doc.text(l, X, y); y += 10; });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  for (const t of [ctx.address, ctx.lotDp, [lot?.lga, lot?.zoning?.code && `Zone ${lot.zoning.code}`, lot?.areaM2 && `${Math.round(lot.areaM2).toLocaleString('en-AU')} m²`].filter(Boolean).join('   |   ')]) {
    if (!t) continue;
    doc.text(fit(doc, clean(t), 185), X, y);
    y += 6;
  }
  doc.setFontSize(9);
  doc.setTextColor(...GREY);
  doc.text(`Issue for review, ${ctx.dateStr}`, X, y + 1);
  if (ctx.builderName) { doc.setFont('helvetica', 'bold'); doc.text(`Prepared for ${ctx.builderName}`, X, y + 6.5); }

  // Drawing index.
  const iy = 86;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...PEN.ink);
  doc.text('DRAWING INDEX', X, iy);
  const cols = [X, X + 40, X + 150];
  doc.setLineWidth(0.3);
  doc.setDrawColor(...PEN.ink);
  doc.line(X, iy + 2.2, X + 185, iy + 2.2);
  doc.setFontSize(7);
  doc.setTextColor(...GREY);
  ['DRAWING NO.', 'SHEET TITLE', 'SCALE'].forEach((t, i) => doc.text(t, cols[i], iy + 6.6));
  doc.line(X, iy + 8.4, X + 185, iy + 8.4);
  let ry = iy + 14.4;
  for (const r of ctx.index) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...PEN.ink);
    doc.text(r.no, cols[0], ry);
    doc.setFont('helvetica', 'normal');
    doc.text(r.title, cols[1], ry);
    doc.text(r.scale, cols[2], ry);
    doc.setLineWidth(0.12);
    doc.setDrawColor(200, 203, 209);
    doc.line(X, ry + 2.4, X + 185, ry + 2.4);
    ry += 7;
  }

  // Revision table.
  const vy = ry + 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...PEN.ink);
  doc.text('REVISIONS', X, vy);
  const rc = [X, X + 16, X + 50, X + 160, X + 185];
  doc.setDrawColor(...PEN.ink);
  doc.setLineWidth(0.25);
  doc.rect(X, vy + 2.5, 185, 14);
  doc.line(X, vy + 9.5, X + 185, vy + 9.5);
  rc.slice(1, -1).forEach((c) => doc.line(c, vy + 2.5, c, vy + 16.5));
  doc.setFontSize(7);
  doc.setTextColor(...GREY);
  ['REV', 'DATE', 'DESCRIPTION', 'BY'].forEach((t, i) => doc.text(t, rc[i] + 1.5, vy + 7.4));
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...PEN.ink);
  ['A', ctx.dateStr, clean(ctx.project.titleBlock?.issuePurpose) || REV_TEXT, 'GI'].forEach((t, i) => doc.text(t, rc[i] + 1.5, vy + 14));

  // General notes.
  const ny = vy + 26;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('GENERAL NOTES', X, ny);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.6);
  const notes = [
    'Concept only. This set shows a house design sited on a lot for discussion. It is not a development application or construction drawing set.',
    'Boundaries are from the cadastre (DCDB) and are not a survey. Dimensions and areas must be confirmed by a registered surveyor.',
    'Setbacks and planning controls shown are indicative. They must be checked with the council and a suitably qualified person.',
    'Room areas are measured to internal wall faces. Roofed outdoor rooms are counted as alfresco.',
    'Driveway, kerb and road reserve widths are typical values and not the council standard for the street.',
    `${ENTITY}, ${ABN}, ${EMAIL}.`,
  ];
  let yy = ny + 6;
  notes.forEach((n, i) => {
    wrap(doc, `${i + 1}. ${n}`, 185).forEach((l, j) => { doc.text(j ? `   ${l}` : l, X, yy); yy += 3.6; });
    yy += 0.8;
  });

  const locScale = locality(doc, lot, project);
  thumbnail(doc, project, ctx.catalogue, 'HOUSE PLAN (GROUND FLOOR)');
  return { locScale };
}
