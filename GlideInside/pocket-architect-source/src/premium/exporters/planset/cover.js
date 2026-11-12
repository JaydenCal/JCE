// Cover sheet (C000): project name and address, drawing index, locality context (DCDB), house thumbnail, revision table and general notes.

import * as G from '../../../model/geometry.js';
import { clean, PEN, ink, wrap, haloText } from '../eng/kit.js';
import { planGeometry } from '../pdf.js';
import { wallShapes } from '../shared.js';
import { groundLevel, areaTotals } from './lot.js';
import { levelContent } from '../drawing.js';
import { AREA, ENTITY, ABN, EMAIL, REV_TEXT, fit } from './frame.js';

const GREY = [120, 124, 132];
/** White wash over the aerial (60 percent): linework, labels and the red boundary read over it. */
export const WASH = 0.6;
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

/**
 * Locality scale for the cover. The plan is zoomed out so the site can be placed in its surroundings: the largest of 1:2000, 1:2500 and
 * 1:5000 that still draws the lot at least 10 mm long and fits the frame. Lots too big for those fall back to the smaller list below.
 */
export function localityScale(lot) {
  if (!lot) return null;
  const bb = G.bbox(lot.boundary);
  const w = LOC.x1 - LOC.x0 - 6;
  const h = LOC.y1 - LOC.y0 - 6;
  const big = Math.max(bb.w, bb.h);
  const fits = (n) => bb.w / n <= w * 0.85 && bb.h / n <= h * 0.85;
  // Prefer the lot about 20 mm or more on paper (so it is easy to find), and never under 10 mm.
  for (const min of [20, 10]) {
    const near = [2000, 2500, 5000].filter((n) => big / n >= min && fits(n));
    if (near.length) return near.at(-1);
  }
  const SC = [250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
  return SC.find((n) => fits(n) && big / n >= 10 && n >= 2000) || SC.find(fits) || 50000;
}

/** The ground the locality plan shows: { scale, c (lot centroid), view: plan mm rectangle } with the lot at the frame centre. */
export function localityView(lot) {
  const scale = localityScale(lot);
  const c = G.polygonCentroid(lot.boundary);
  const hw = ((LOC.x1 - LOC.x0) / 2) * scale;
  const hh = ((LOC.y1 - LOC.y0) / 2) * scale;
  return { scale, c, view: { x0: c.x - hw, y0: c.y - hh, x1: c.x + hw, y1: c.y + hh } };
}

const RED = [200, 24, 28];
const NO_AERIAL = 'Aerial not available for this lot';

/** "Imagery and cadastre ..." line for the locality plan, as in the site footer credits. */
export function localityAttribution(lot, aerial) {
  const qld = (lot.state || aerial?.state) === 'QLD';
  const nsw = (lot.state || aerial?.state) === 'NSW';
  if (aerial) return qld ? 'Imagery and cadastre © State of Queensland (Department of Resources)' : 'Imagery and cadastre © NSW Spatial Services';
  if (qld) return 'Cadastre © State of Queensland (Department of Resources)';
  if (nsw || (lot.neighbours || []).length) return nsw ? 'Cadastre © NSW Spatial Services' : '';
  return '';
}

const niceBar = (metres) => [10, 20, 25, 50, 100, 200, 250, 500, 1000].reduce((b, n) => (n <= metres ? n : b), 10);

function locality(doc, lot, project, loc = {}) {
  frame(doc, LOC, 'LOCALITY PLAN (DCDB CONTEXT)');
  if (!lot) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    doc.text('No lot is attached to this concept, so no locality plan is shown.', (LOC.x0 + LOC.x1) / 2, (LOC.y0 + LOC.y1) / 2, { align: 'center' });
    return null;
  }
  const { scale, c } = localityView(lot);
  const neighbours = loc.neighbours || lot.neighbours || [];
  const roads = loc.roads || lot.roads || [];
  const aerial = loc.aerial || null;
  const mx = (LOC.x0 + LOC.x1) / 2;
  const my = (LOC.y0 + LOC.y1) / 2;
  const T = (p) => ({ x: mx + (p.x - c.x) / scale, y: my + (p.y - c.y) / scale });
  const R = { x0: LOC.x0 + 0.5, y0: LOC.y0 + 0.5, x1: LOC.x1 - 0.5, y1: LOC.y1 - 0.5 };
  const inR = (p, m = 0) => p.x > R.x0 + m && p.x < R.x1 - m && p.y > R.y0 + m && p.y < R.y1 - m;

  // The aerial first, clipped to the frame, then a strong white wash (60 percent) so the linework and labels read over it.
  if (aerial) {
    const e = aerial.extent;
    const a = T({ x: e.x0, y: e.y0 });
    const b = T({ x: e.x1, y: e.y1 });
    doc.saveGraphicsState();
    // Clip to the frame with raw operators (re, W, n): the picture is bigger than the frame.
    const k = doc.internal.scaleFactor;
    const H = doc.internal.pageSize.getHeight();
    const f = (v) => (v * k).toFixed(2);
    doc.internal.write(f(R.x0), f(H - R.y1), f(R.x1 - R.x0), f(R.y1 - R.y0), 're W n');
    try { doc.addImage(aerial.data, aerial.format, a.x, a.y, b.x - a.x, b.y - a.y, undefined, 'FAST'); } catch { /* an unreadable image leaves the plain frame */ }
    doc.setGState(new doc.GState({ opacity: WASH }));
    doc.setFillColor(255, 255, 255);
    doc.rect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0, 'F');
    doc.restoreGraphicsState();
  }
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
  // Surrounding parcels across the whole view.
  doc.setLineWidth(0.18);
  doc.setDrawColor(...(aerial ? [70, 74, 84] : GREY));
  for (const n of neighbours) if (n.ring?.length >= 3) clipPoly(n.ring.map(T));
  // Road lines, then their names along the longest visible stretch.
  const roadPts = (r) => { const pts = []; for (let i = 0; i + 1 < (r.pts || []).length; i += 2) pts.push(T({ x: r.pts[i], y: r.pts[i + 1] })); return pts; };
  for (const r of roads) {
    const pts = roadPts(r);
    if (pts.length > 1) { doc.setLineWidth(0.35); doc.setDrawColor(...(aerial ? [40, 44, 52] : PEN.phantom)); clipPoly(pts, false); }
  }
  // Furniture the labels must keep clear of: the white strip along the bottom, the north point and the scale bar plate.
  const bar = niceBar(40 * scale / 1000);
  const barMm = (bar * 1000) / scale;
  const nxy = { x: LOC.x1 - 12, y: LOC.y0 + 13 };
  const blocked = [
    { x0: R.x0, y0: LOC.y1 - 5.6, x1: R.x1, y1: R.y1 + 1 },
    { x0: nxy.x - 8, y0: nxy.y - 11, x1: nxy.x + 8, y1: nxy.y + 8 },
    { x0: LOC.x0 + 2, y0: LOC.y1 - 17, x1: LOC.x0 + 4 + barMm + 12, y1: LOC.y1 - 6 },
  ];
  const hits = (b, list) => list.some((t) => b.x0 < t.x1 && b.x1 > t.x0 && b.y0 < t.y1 && b.y1 > t.y0);
  // The SITE box goes first: the spot around the lot with the fewest lot centres under it, clear of the north point, bar and strip.
  const lp = lot.boundary.map(T);
  const lc = { x: lp.reduce((a, p) => a + p.x, 0) / lp.length, y: lp.reduce((a, p) => a + p.y, 0) / lp.length };
  const lb = { x0: Math.min(...lp.map((p) => p.x)), x1: Math.max(...lp.map((p) => p.x)), y0: Math.min(...lp.map((p) => p.y)), y1: Math.max(...lp.map((p) => p.y)) };
  const tag = lot.proposed ? `PROPOSED LOT ${lot.lotNumber || ''}`.trim() : lot.lotNumber ? `LOT ${lot.lotNumber}` : 'SUBJECT LOT';
  const centres = neighbours.filter((n) => !n.isRoad && n.lotNumber && n.ring?.length >= 3).map((n) => T(G.polygonCentroid(n.ring)));
  let lab = null;
  let bestScore = Infinity;
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 0], [1, 0], [0, -1], [-1, 1], [1, 1], [0, 1], [-1.8, -1], [1.8, -1], [-1.8, 0.4], [1.8, 0.4], [-1, -1.8], [1, -1.8]]) {
    const cx = dx < 0 ? lb.x0 + 3 + dx * 28 : dx > 0 ? lb.x1 - 3 + dx * 28 : lc.x;
    const cy = dy < 0 ? lb.y0 + 3 + dy * 24 : dy > 0 ? lb.y1 - 3 + dy * 24 : lc.y;
    const box = { x0: cx - 8, x1: cx + 8, y0: cy - 4.2, y1: cy + 5.2 };
    if (box.x0 < R.x0 + 1 || box.x1 > R.x1 - 1 || box.y0 < R.y0 + 1 || box.y1 > R.y1 - 1 || hits(box, blocked)) continue;
    if (box.x0 < lb.x1 && box.x1 > lb.x0 && box.y0 < lb.y1 && box.y1 > lb.y0) continue;
    const score = centres.filter((q) => q.x > box.x0 - 4 && q.x < box.x1 + 4 && q.y > box.y0 - 2 && q.y < box.y1 + 2).length * 10 + Math.hypot(cx - lc.x, cy - lc.y) / 20;
    if (score < bestScore) { bestScore = score; lab = { x: cx, y: cy, box }; }
  }
  if (!lab) lab = { x: Math.max(R.x0 + 10, lb.x0 - 12), y: Math.max(R.y0 + 8, lb.y0 - 10), box: null };
  const start = lp.reduce((b, p) => (Math.hypot(p.x - lab.x, p.y - lab.y) < Math.hypot(b.x - lab.x, b.y - lab.y) ? p : b), lp[0]);
  blocked.push({ x0: lab.x - 8.5, x1: lab.x + 8.5, y0: lab.y - 4.7, y1: lab.y + 5.7 });
  const taken = [];
  // Road names: along the longest clear stretch, shrunk if need be, else left off. Never cut off by the frame, never over another label.
  const named = new Set();
  const roadLabels = [...roads].filter((r) => r.name).sort((a, b) => roadPts(b).length - roadPts(a).length);
  for (const r of roadLabels) {
    const key = r.name.toUpperCase();
    if (named.has(key)) continue;
    const pts = roadPts(r);
    const name = r.name.toUpperCase();
    let done = false;
    for (const size of [5.5, 4.8, 4.2]) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(size);
      const tw = doc.getTextWidth(name);
      const cands = [];
      for (let i = 0; i + 1 < pts.length; i++) {
        const p = pts[i];
        const q = pts[i + 1];
        const len = Math.hypot(q.x - p.x, q.y - p.y);
        if (len < tw + 3) continue;
        const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        const ux = (q.x - p.x) / len;
        const uy = (q.y - p.y) / len;
        const e1 = { x: mid.x - (ux * tw) / 2, y: mid.y - (uy * tw) / 2 };
        const e2 = { x: mid.x + (ux * tw) / 2, y: mid.y + (uy * tw) / 2 };
        const box = { x0: Math.min(e1.x, e2.x) - 1.2, x1: Math.max(e1.x, e2.x) + 1.2, y0: Math.min(e1.y, e2.y) - 2, y1: Math.max(e1.y, e2.y) + 2 };
        if (!inR({ x: box.x0, y: box.y0 }, 1) || !inR({ x: box.x1, y: box.y1 }, 1) || hits(box, blocked) || hits(box, taken)) continue;
        cands.push({ len, mid, ang: Math.atan2(q.y - p.y, q.x - p.x), tw, box });
      }
      cands.sort((a, b) => b.len - a.len);
      const best = cands[0];
      if (!best) continue;
      let deg = (-best.ang * 180) / Math.PI;
      if (deg > 90) deg -= 180;
      if (deg < -90) deg += 180;
      const rad = (deg * Math.PI) / 180;
      taken.push(best.box);
      named.add(key);
      haloText(doc, name, best.mid.x - (Math.cos(rad) * best.tw) / 2, best.mid.y + (Math.sin(rad) * best.tw) / 2 + 0.7, { size, bold: true, colour: [40, 44, 52], angle: deg, halo: 0.8 });
      done = true;
      break;
    }
    void done;
  }
  // Adjoining lot numbers, where the lot data has them: "LOT n" when it fits inside the parcel, else the number alone, else nothing.
  // Labels never overlap one another.
  const sorted = [...neighbours].filter((n) => !n.isRoad && n.lotNumber && n.ring?.length >= 3);
  for (const n of sorted) {
    const cc = T(G.polygonCentroid(n.ring));
    const pb = G.bbox(n.ring.map(T));
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.5);
    let txt = `LOT ${n.lotNumber}`;
    if (doc.getTextWidth(txt) > pb.w - 1.5) txt = String(n.lotNumber);
    const tw = doc.getTextWidth(txt);
    if (tw > pb.w - 1 || pb.h < 3) continue;
    if (cc.x - tw / 2 < R.x0 + 1 || cc.x + tw / 2 > R.x1 - 1 || cc.y < R.y0 + 3 || cc.y > R.y1 - 5) continue;
    const box = { x0: cc.x - tw / 2, x1: cc.x + tw / 2, y0: cc.y - 2.2, y1: cc.y + 0.8 };
    if (hits({ x0: box.x0 - 0.5, x1: box.x1 + 0.5, y0: box.y0, y1: box.y1 }, taken) || hits(box, blocked)) continue;
    taken.push(box);
    haloText(doc, txt, cc.x, cc.y, { size: 5.5, colour: aerial ? [50, 54, 62] : GREY, align: 'center', halo: aerial ? 0.7 : 0 });
  }
  // The subject lot: red boundary (no solid fill over the picture), the house in its fill.
  doc.setDrawColor(...(aerial ? RED : PEN.ink));
  doc.setLineWidth(aerial ? 0.7 : 0.5);
  if (aerial) polyPath(doc, lp, 'S');
  else { doc.setFillColor(255, 236, 140); polyPath(doc, lp, 'FD'); }
  const gl = groundLevel(project);
  if (gl) {
    doc.setFillColor(...PEN.proposed);
    for (const r of gl.rooms) if (!r.outdoor && r.polygon?.length >= 3) polyPath(doc, r.polygon.map(T), 'F');
  }
  // "SITE" label with a leader (the box was placed before any other label, see above).
  doc.setDrawColor(...(aerial ? RED : PEN.ink));
  doc.setLineWidth(0.35);
  doc.line(lab.x + 6, lab.y + 1.2, start.x, start.y);
  doc.setFillColor(255, 255, 255);
  doc.rect(lab.x - 8, lab.y - 4.2, 16, 9.4, 'FD');
  haloText(doc, 'SITE', lab.x, lab.y, { size: 8, bold: true, colour: aerial ? RED : PEN.ink, align: 'center', halo: 0 });
  haloText(doc, tag, lab.x, lab.y + 3.6, { size: 5.5, bold: true, colour: PEN.ink, align: 'center', halo: 0 });
  // scale bar, bottom left on a white plate
  const bx = LOC.x0 + 4;
  const by = LOC.y1 - 11;
  doc.setFillColor(255, 255, 255);
  doc.rect(bx - 2, by - 5.5, barMm + 14, 9.5, 'F');
  doc.setDrawColor(...PEN.ink);
  doc.setLineWidth(0.25);
  for (let i = 0; i < 4; i++) {
    doc.setFillColor(...(i % 2 ? [255, 255, 255] : PEN.ink));
    doc.rect(bx + (i * barMm) / 4, by - 1, barMm / 4, 1.6, 'FD');
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);
  doc.setTextColor(...PEN.ink);
  doc.text('0', bx, by - 2, { align: 'center' });
  doc.text(`${bar / 2}`, bx + barMm / 2, by - 2, { align: 'center' });
  doc.text(`${bar} m`, bx + barMm, by - 2, { align: 'center' });
  // scale text, attribution and the no-aerial note, on a white strip so they never sit on the picture
  doc.setFillColor(255, 255, 255);
  doc.rect(R.x0, LOC.y1 - 5.4, R.x1 - R.x0, 4.9, 'F');
  doc.setFontSize(6.5);
  doc.setTextColor(...GREY);
  doc.text(`Scale 1:${scale} @ A3. Cadastre (DCDB) context only, not a survey.`, LOC.x0 + 2, LOC.y1 - 2);
  const attr = localityAttribution(lot, aerial);
  if (attr) {
    doc.setFontSize(5.5);
    doc.setTextColor(...(aerial ? PEN.ink : GREY));
    doc.text(attr, LOC.x1 - 2, LOC.y1 - 2, { align: 'right' });
  }
  if (!aerial) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(...GREY);
    doc.text(NO_AERIAL, mx, LOC.y1 - 8, { align: 'center' });
  }
  const a = ((Number(project.site?.northDeg) || 0) * Math.PI) / 180;
  const nx = nxy.x;
  const ny = nxy.y;
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

  const locScale = locality(doc, lot, project, ctx.locality || {});
  thumbnail(doc, project, ctx.catalogue, 'HOUSE PLAN (GROUND FLOOR)');
  return { locScale };
}
