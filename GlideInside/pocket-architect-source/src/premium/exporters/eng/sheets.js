// Cover, site analysis and schedules sheets of the engineering style plan set.

import * as G from '../../../model/geometry.js';
import { fallAcross, lotDimensions } from '../../../model/placement.js';
import { scheduleData, levelsSorted } from '../shared.js';
import { buildingRings, roadReserve, deriveDriveway, clearances, lotLabelLines } from '../../../site/lotplan.js';
import { northArrow, placeImage, imageInfo } from '../pdf.js';
import { PEN, TXT, clean, wrap, fit, ink, polygon, viewTitle, clippedPolyline, clipPolygon, labelOn, hatch, haloText } from './kit.js';
import { BODY } from './frame.js';
import { drawLocality, siteFacts, lotBounds, chooseSiteScale, makeT, paletteFor } from './siteplan.js';

const cap = (t) => { const x = String(t ?? ''); return x ? x[0].toUpperCase() + x.slice(1) : x; };
import { ddmmyyyy, normDate } from './brand.js';
import { compassWord } from './views.js';

/** Generic ruled table with wrapped cells. cols: [{ w, head, align }], rows: [[string]] | { cells, bold, fill }. Returns the bottom y. */
export function table(doc, x, y, cols, rows, { size = 7.4, head = true, pad = 1.5, lineH = 3.2, maxY = BODY.y1 } = {}) {
  const total = cols.reduce((a, c) => a + c.w, 0);
  doc.setLineWidth(0.15);
  let cy = y;
  if (head) {
    doc.setFillColor(...PEN.band);
    ink(doc, PEN.ink);
    doc.rect(x, cy, total, 6.6, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(size);
    let cx = x;
    for (const c of cols) {
      doc.setTextColor(...PEN.ink);
      if (c.align === 'right') doc.text(clean(c.head), cx + c.w - pad, cy + 4.4, { align: 'right' });
      else doc.text(clean(c.head), cx + pad, cy + 4.4);
      cx += c.w;
    }
    cy += 6.6;
  }
  let drawn = 0;
  for (const rowIn of rows) {
    const row = Array.isArray(rowIn) ? { cells: rowIn } : rowIn;
    const cells = row.cells.map((v) => String(v ?? ''));
    doc.setFont('helvetica', row.bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    const wrapped = cells.map((v, i) => wrap(doc, v, cols[i].w - 2 * pad));
    const lines = Math.max(1, ...wrapped.map((w) => w.length));
    const h = lines * lineH + 2 * pad - 0.4;
    if (cy + h > maxY) break;
    if (row.fill) { doc.setFillColor(...row.fill); doc.rect(x, cy, total, h, 'F'); }
    let cx = x;
    wrapped.forEach((w, i) => {
      doc.setFont('helvetica', row.bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      doc.setTextColor(...(row.colours?.[i] || PEN.ink));
      w.forEach((l, j) => {
        if (cols[i].align === 'right') doc.text(l, cx + cols[i].w - pad, cy + pad + 2.1 + j * lineH, { align: 'right' });
        else doc.text(l, cx + pad, cy + pad + 2.1 + j * lineH);
      });
      cx += cols[i].w;
    });
    doc.setDrawColor(...PEN.light);
    doc.line(x, cy + h, x + total, cy + h);
    cy += h;
    drawn++;
  }
  doc.setDrawColor(...PEN.ink);
  doc.rect(x, y, total, cy - y);
  let vx = x;
  for (const c of cols.slice(0, -1)) { vx += c.w; doc.setDrawColor(...PEN.light); doc.line(vx, y, vx, cy); }
  return { y: cy, drawn };
}

export const heading = (doc, text, x, y) => {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(TXT.strong);
  ink(doc, PEN.ink);
  doc.text(clean(text).toUpperCase(), x, y);
  doc.setDrawColor(...PEN.tag);
  doc.setLineWidth(0.5);
  doc.line(x, y + 1.3, x + doc.getTextWidth(clean(text).toUpperCase()), y + 1.3);
};

// Cover ----------------------------------------------------------------------------------------------------------------------
/** The locality map box on the cover (sheet mm). With a perspective image supplied the map is shorter and the image sits under it. */
export const COVER_BOX = (ctx) => ({ x0: 212, y0: BODY.y0 + 18, x1: BODY.x1 - 2, y1: ctx?.image ? BODY.y0 + 124 : BODY.y1 - 20 });

export function drawCover(doc, ctx, list) {
  const { project, brand } = ctx;
  const tb = project.titleBlock || {};
  const lot = project.site?.lot || null;
  const x0 = BODY.x0 + 2;
  let y = BODY.y0 + 14;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(TXT.head);
  ink(doc, PEN.tag);
  doc.text('CONCEPT PLAN SET', x0, y);
  y += 14;
  doc.setFontSize(30);
  ink(doc, PEN.ink);
  const name = clean(tb.projectName || project.name || 'Untitled design').toUpperCase();
  const nameLines = wrap(doc, name, 190).slice(0, 2);
  nameLines.forEach((l, i) => doc.text(l, x0, y + i * 12.5));
  y += nameLines.length * 12.5 + 3;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(14);
  const addr = clean(tb.address || lot?.address || '');
  if (addr) { doc.text(addr, x0, y); y += 7.4; }
  const ll = lot ? lotLabelLines(lot) : null;
  const lotdp = clean(tb.lotDp || (ll ? `${ll.first} ${ll.second}`.trim() : ''));
  if (lotdp) { doc.text(lotdp, x0, y); y += 7.4; }
  doc.setFontSize(TXT.strong);
  ink(doc, PEN.grey);
  const facts = [];
  if (tb.client) facts.push(`Client: ${tb.client}`);
  if (tb.council || lot?.lga) facts.push(`Council: ${cap(String(tb.council || lot.lga).toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()))}`);
  if (lot?.zoning?.code) facts.push(`Zone: ${lot.zoning.code} ${lot.zoning.name || ''}`.trim());
  if (lot?.areaM2) facts.push(`Site area: ${Math.round(lot.areaM2)} m²`);
  facts.push(`Issue: ${clean(tb.issuePurpose || 'Concept')}, revision ${clean(tb.revision || 'A')}, ${tb.date ? normDate(tb.date) : ddmmyyyy(ctx.date)}`);
  y += 2;
  facts.forEach((f) => { doc.text(clean(f), x0, y); y += 5.6; });
  y += 5;

  // Drawing list
  heading(doc, 'Drawing list', x0, y);
  y += 5;
  const rows = list.map((s) => ({ cells: [s.number, cap(s.title.toLowerCase()), s.scale] }));
  const cols = [{ w: 46, head: 'DRAWING NUMBER' }, { w: 96, head: 'TITLE' }, { w: 44, head: 'SCALE' }];
  table(doc, x0, y, cols, rows, { size: 8.2, lineH: 3.7, pad: 1.5, maxY: BODY.y1 - 20 });

  // Locality: aerial and cadastre, zoomed out to show where the site is
  const lx = 212;
  heading(doc, 'Locality', lx, BODY.y0 + 12);
  const box = COVER_BOX(ctx);
  drawLocality(doc, box, ctx);
  doc.setDrawColor(...PEN.ink);
  doc.setLineWidth(0.5);
  doc.rect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
  doc.setFillColor(255, 255, 255);
  doc.circle(box.x1 - 14, box.y0 + 16, 11.5, 'F');
  northArrow(doc, box.x1 - 14, box.y0 + 17, project.site?.northDeg || 0);
  if (ctx.image) {
    const img = imageInfo(ctx.image);
    if (img) {
      heading(doc, 'Perspective', lx, box.y1 + 10);
      placeImage(doc, img, { x: lx, y: box.y1 + 13, w: box.x1 - lx, h: BODY.y1 - (box.y1 + 13) - 16 });
    }
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(TXT.small);
  ink(doc, PEN.grey);
  const note = 'This is a concept design for discussion. Setbacks, levels and boundaries are indicative and have not been checked by a surveyor, certifier or council. Where a council rule is marked check with council it has not been confirmed.';
  wrap(doc, note, 190).forEach((l, i) => doc.text(l, x0, BODY.y1 - 10 + i * 3.3));
  doc.text(clean(brand.mode === 'builder' ? brand.credit : brand.name ? `Prepared by ${brand.name}` : 'Prepared with Glide Inside'), x0, BODY.y1 - 0.5);
}

// Site analysis and setback table -----------------------------------------------------------------------------------------
/** The one true scale of the analysis diagram, so the sheet title, the title block and the diagram say the same thing. */
export function analysisScale(project, k = 1) {
  const facts = siteFacts(project);
  if (!facts?.lot) return null;
  const left = { x0: BODY.x0, y0: BODY.y0, x1: 206, y1: BODY.y1 };
  const vp = { x0: left.x0 + 2, y0: left.y0 + 14, x1: left.x1 - 2, y1: left.y1 - 2 };
  const b = lotBounds(project, facts);
  return chooseSiteScale([{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }], vp, k).n;
}

export function drawAnalysis(doc, ctx) {
  const { project } = ctx;
  const facts = siteFacts(project);
  const lot = facts?.lot || null;
  const left = { x0: BODY.x0, y0: BODY.y0, x1: 206, y1: BODY.y1 };
  doc.setDrawColor(...PEN.ink);
  doc.setLineWidth(0.35);
  doc.rect(left.x0, left.y0, left.x1 - left.x0, left.y1 - left.y0);
  const rx = 211;
  const rw = BODY.x1 - rx;
  if (!lot) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(TXT.label);
    ink(doc, PEN.grey);
    doc.text('No lot is loaded. Use Find my block to analyse the site.', (left.x0 + left.x1) / 2, (left.y0 + left.y1) / 2, { align: 'center' });
    heading(doc, 'Setbacks', rx, BODY.y0 + 8);
    return;
  }
  // Diagram
  const vp = { x0: left.x0 + 2, y0: left.y0 + 14, x1: left.x1 - 2, y1: left.y1 - 2 };
  const bounds = lotBounds(project, facts);
  const { n, ds } = chooseSiteScale([{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }], vp, ctx.k || 1);
  const pal = paletteFor(!!ctx.hasAerial);
  viewTitle(doc, left.x0 + 3, left.y0 + 8.4, 'Site analysis', `1:${n} @ ${ctx.paper || 'A3'}`, { size: TXT.title });
  const T = makeT(bounds, vp, ds);
  const rect = { x0: vp.x0, y0: vp.y0, x1: vp.x1, y1: vp.y1 };
  const line = (pts, closed = true) => clippedPolyline(doc, pts.map(T), rect, closed);
  doc.setDrawColor(...pal.neighbour);
  doc.setLineWidth(pal.neighbourW);
  for (const nb of lot.neighbours || []) if (!nb.isRoad) line(nb.ring);
  for (const r of facts.reserve) {
    const L = r.lines;
    const bit = clipPolygon([L.gutter[0], L.gutter[1], L.farGutter[1], L.farGutter[0]].map(T), rect);
    if (bit.length > 2) { doc.setFillColor(226, 228, 232); polygon(doc, bit, 'F'); }
    doc.setDrawColor(...PEN.road);
    doc.setLineWidth(0.25);
    clippedPolyline(doc, L.kerb.map(T), rect, false);
    doc.setDrawColor(...PEN.phantom);
    doc.setLineWidth(0.3);
    doc.setLineDashPattern([8, 1.5, 1.5, 1.5], 0);
    clippedPolyline(doc, L.centreline.map(T), rect, false);
    doc.setLineDashPattern([], 0);
  }
  const own = clipPolygon(lot.boundary.map(T), rect);
  if (own.length > 2) { doc.setFillColor(226, 240, 230); polygon(doc, own, 'F'); }
  doc.setDrawColor(...pal.boundary);
  doc.setLineWidth(0.8);
  line(lot.boundary);
  if (lot.envelope?.length > 2) {
    doc.setDrawColor(...pal.envelope);
    doc.setLineWidth(0.5);
    doc.setLineDashPattern([4, 2], 0);
    line(lot.envelope);
    doc.setLineDashPattern([], 0);
  }
  for (const ring of (project.levels.length ? [project.levels.sort((a, b) => a.elevation - b.elevation)[0]] : []).flatMap((l) => l.rooms || []).filter((r) => r.status !== 'demolish' && (!r.outdoor || r.roofed)).map((r) => r.polygon)) {
    doc.setFillColor(...PEN.proposedFill);
    doc.setDrawColor(...PEN.proposed);
    doc.setLineWidth(0.3);
    polygon(doc, ring.map(T), 'FD');
  }
  // Fall arrow and frontage tags
  const fall = fallAcross(project);
  const centre = T(G.polygonCentroid(lot.boundary));
  if (fall?.bearingDeg != null) {
    const th = (((fall.bearingDeg - (project.site?.northDeg || 0)) * Math.PI) / 180);
    const d = { x: Math.sin(th), y: -Math.cos(th) };
    const a = { x: centre.x - d.x * 14, y: centre.y - d.y * 14 };
    const b = { x: centre.x + d.x * 14, y: centre.y + d.y * 14 };
    doc.setDrawColor(...PEN.contourMajor);
    doc.setLineWidth(0.7);
    doc.line(a.x, a.y, b.x, b.y);
    doc.setFillColor(...PEN.contourMajor);
    const px = -d.y;
    const py = d.x;
    polygon(doc, [{ x: b.x + d.x * 3, y: b.y + d.y * 3 }, { x: b.x + px * 2, y: b.y + py * 2 }, { x: b.x - px * 2, y: b.y - py * 2 }], 'F');
    labelOn(doc, `FALL ${fall.slopePct}% ${compassWord(fall.direction || '')}`.trim(), b.x + d.x * 3, b.y + d.y * 3 + (d.y >= 0 ? 5.5 : -2.5), { size: TXT.body, bold: true, colour: PEN.contourMajor });
  }
  // Frontage tag
  const dim = lotDimensions(lot);
  for (const r of facts.reserve) {
    const e0 = lot.boundary[r.edge];
    const e1 = lot.boundary[(r.edge + 1) % lot.boundary.length];
    const mid = T(G.lerp(e0, e1, 0.5));
    const out = { x: r.outward.x, y: r.outward.y };
    labelOn(doc, `STREET FRONTAGE ${dim.frontageM ? dim.frontageM.toFixed(1) : ''} m`, mid.x + out.x * 11, mid.y + out.y * 11, { size: TXT.body, bold: true, colour: PEN.road });
  }
  const ll = lotLabelLines(lot);
  labelOn(doc, `${ll.first} ${ll.second}`.trim(), centre.x, T({ x: G.bbox(lot.boundary).minX, y: G.bbox(lot.boundary).minY }).y + 7, { size: TXT.strong, bold: true, colour: pal.boundary });
  northArrow(doc, left.x1 - 14, left.y0 + 24, project.site?.northDeg || 0);
  labelOn(doc, 'Diagram only, not a survey', left.x0 + 4, left.y1 - 4, { size: TXT.body, align: 'left', colour: PEN.grey });

  // Facts
  let y = BODY.y0 + 8;
  heading(doc, 'Site facts', rx, y);
  y += 4.5;
  const z = lot.zoning;
  const fRows = [
    ['Address', lot.address || ''],
    ['Lot and DP', `${ll.first} ${ll.second}`.trim()],
    ['Council', cap(String(lot.lga || project.titleBlock?.council || 'Not stated').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()))],
    ['Zone', z ? `${z.code || ''} ${z.name || ''}`.trim() : 'Not stated'],
    ['Site area', lot.areaM2 ? `${Math.round(lot.areaM2)} m²${lot.registeredAreaM2 ? (Math.round(lot.registeredAreaM2) === Math.round(lot.areaM2) ? '' : ` (registered ${Math.round(lot.registeredAreaM2)} m²)`) : ' (from the cadastre)'}` : 'Not stated'],
    ['Frontage and depth', `${dim.frontageM ? dim.frontageM.toFixed(1) : '-'} m by ${dim.depthM ? dim.depthM.toFixed(1) : '-'} m`],
    ['Corner lot', lot.cornerLot ? 'Yes' : 'No'],
    ['Ground fall', fall ? `${fall.fallM} m across the lot, ${fall.slopePct}%${fall.direction ? ` towards the ${compassWord(fall.direction)}` : ''}` : 'Not available'],
    ['Floor level', lot.floorRL != null ? `FFL ${lot.floorRL.toFixed(2)} m AHD${lot.floorRLAuto ? ' (assumed)' : ''}` : 'Not set'],
    ['Overlays', 'Bushfire, flood, heritage and easements not checked'],
  ];
  const t1 = table(doc, rx, y, [{ w: 40, head: 'ITEM' }, { w: rw - 40, head: 'DETAIL' }], fRows, { size: 7.6, lineH: 3.3, pad: 1.3 });
  y = t1.y + 9;

  // Setbacks
  heading(doc, 'Setbacks: required and provided', rx, y);
  y += 4.5;
  const cols = [{ w: 28, head: 'BOUNDARY' }, { w: 20, head: 'REQUIRED', align: 'right' }, { w: 20, head: 'PROVIDED', align: 'right' }, { w: 50, head: 'RESULT' }, { w: rw - 118, head: 'SOURCE AND CHECK' }];
  const tbc = (t) => String(t || '').replace(/\bcl\.?\s*[0-9][\w.()-]*(\s*(?:to|and|-)\s*\(?[\w.()-]+\)?)?/gi, '(clause to be confirmed)').replace(/\(\(clause to be confirmed\)/g, '(clause to be confirmed');
  const topMm = Math.max(0, ...project.levels.map((l) => (l.elevation || 0) + (l.height || 0)));
  const tall = topMm > 4500; // parts of the building more than 4.5 m above ground
  const AMBER = [176, 104, 0];
  const rows = facts.clear.rows.map((r) => {
    const side = /side/i.test(r.label || '') || r.kind === 'side';
    const check = side && tall && r.status !== 'unknown';
    let res = r.status === 'inside' ? 'Inside the indicative setback envelope' : r.status === 'outside' ? `Outside the indicative setback envelope by ${r.shortByM.toFixed(2)} m` : 'No setback rule loaded';
    if (check) res = r.status === 'outside' ? `CHECK. Outside the table minimum by ${r.shortByM.toFixed(2)} m. Parts over 4.5 m high need a larger side setback.` : 'CHECK. Table minimum met. Parts over 4.5 m high need a larger side setback that is not captured.';
    const src = r.requiredM == null ? 'Council rule not loaded. Check with council.' : `${tbc(clean(r.source || 'Source not stated'))}${r.flagged || check ? '. Check with council.' : ''}`;
    return { cells: [r.label.replace(/^./, (c) => c.toUpperCase()), r.requiredM != null ? `${r.requiredM.toFixed(2)} m` : '-', `${r.clearanceM.toFixed(2)} m`, res, src], colours: [PEN.ink, PEN.ink, PEN.ink, check ? AMBER : r.status === 'outside' ? PEN.envelope : r.status === 'inside' ? PEN.boundary : PEN.grey, PEN.ink] };
  });
  if (!rows.length) rows.push(['No building on the lot', '', '', '', '']);
  const t2 = table(doc, rx, y, cols, rows, { size: 7, lineH: 3.0, pad: 1.2 });
  y = t2.y + 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(TXT.min);
  ink(doc, PEN.grey);
  const sb = lot.setbacks;
  const basis = sb ? `Rule set: ${clean(sb.council || '')}, ${clean(sb.basis || '')}. ${clean(sb.source?.name || '')} (${clean(sb.source?.edition || '')}).` : 'No council setback rule set is loaded for this lot.';
  const note = wrap(doc, `${basis} Provided distances are the least distance from the building to each boundary, measured from the walls and rooms. A result here is not an approval.`, rw).slice(0, 7);
  note.forEach((l, i) => doc.text(l, rx, y + i * 2.9));
  y += note.length * 2.9 + 7;

  // Items to confirm before this design is used for anything but discussion.
  heading(doc, 'Items to confirm', rx, y);
  y += 4.5;
  const confirm = [];
  const plain = (t) => cap(tbc(clean(t)).replace(/flagged for review by the research agent/gi, 'not yet confirmed with council'));
  for (const w of sb?.warnings || []) confirm.push([plain(typeof w === 'string' ? w : w.text || w.message || ''), 'Council']);
  if (!(sb?.warnings || []).length && sb?.flag) confirm.push([plain(sb.flagReason || 'Setback figures are not yet confirmed with council'), 'Council']);
  confirm.push(['Bushfire attack level, flood, heritage and other overlays', 'Council or certifier']);
  confirm.push(['Easements, sewer and stormwater connection points, Before You Dig Australia plans', 'Surveyor and authorities']);
  confirm.push(['Registered survey: boundaries, levels, trees and existing structures', 'Registered surveyor']);
  confirm.push(['Crossover location, width and levels; driveway grade', 'Council']);
  confirm.push(['Structure, bracing and footings', 'Structural engineer']);
  table(doc, rx, y, [{ w: rw - 44, head: 'ITEM' }, { w: 44, head: 'WHO CONFIRMS' }], confirm.filter((r) => r[0]), { size: 7, lineH: 3.0, pad: 1.2 });
}

// Schedules ------------------------------------------------------------------------------------------------------------------
export function areaFigures(project, roofM2 = null) {
  const lot = project.site?.lot || null;
  const levels = levelsSorted(project);
  const data = scheduleData(project);
  const ground = levels[0];
  const footprint = (ground?.rooms || []).filter((r) => r.status !== 'demolish' && (!r.outdoor || r.roofed)).reduce((a, r) => a + G.polygonArea(r.polygon) / 1e6, 0);
  const drive = project.site?.lot ? deriveDriveway(project) : null;
  const inLot = drive?.ok && lot?.boundary?.length > 2 ? clipConvex(drive.polygon, lot.boundary) : drive?.ok ? drive.polygon : [];
  const driveM2 = drive?.ok ? (inLot.length > 2 ? G.polygonArea(inLot) / 1e6 : 0) : 0;
  const crossM2 = drive?.ok && drive.crossover?.polygon ? G.polygonArea(drive.crossover.polygon) / 1e6 : 0;
  const total = data.totals.reduce((a, t) => a + t.indoor, 0);
  const outdoor = data.totals.reduce((a, t) => a + t.outdoor, 0);
  const garage = data.rooms.filter((r) => r.type === 'Garage').reduce((a, r) => a + r.area, 0);
  const site = lot?.areaM2 || null;
  return { footprint, driveM2, crossM2, total, outdoor, garage, site, coverage: site ? (footprint / site) * 100 : null, roofM2, perLevel: data.totals, data };
}

/** Subject polygon clipped to a convex polygon (Sutherland-Hodgman), in either winding. */
export function clipConvex(subject, clip) {
  const area2 = clip.reduce((a, p, i) => { const q = clip[(i + 1) % clip.length]; return a + (p.x * q.y - q.x * p.y); }, 0);
  const sgn = area2 >= 0 ? 1 : -1;
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const side = (p) => sgn * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
    const inp = out;
    out = [];
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j];
      const q = inp[(j + 1) % inp.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }); }
    }
  }
  return out;
}

/** Areas and coverage, the room schedule and the door and window schedule, laid out in three columns that fill the sheet. */
export function drawSchedules(doc, ctx, page, extra = {}) {
  const { project } = ctx;
  const f = areaFigures(project, extra.roofM2 ?? null);
  // Room areas come from the same polygons the plans label, so the schedule and the plan always round alike
  if (extra.alignedProject) f.data = { ...f.data, rooms: scheduleData(extra.alignedProject).rooms };
  const gap = 8;
  const wA = 132;
  const wC = 128;
  const colA = BODY.x0;
  const colB = colA + wA + gap;
  const wB = BODY.x1 - wC - gap - colB;
  const colC = BODY.x1 - wC;
  const per = 34;
  const top = BODY.y0 + 9;
  const opt = { size: 9.2, lineH: 4.2, pad: 1.9 };
  if (page.index === 0) {
    heading(doc, 'Areas and site coverage', colA, BODY.y0 + 6);
    const rows = [];
    for (const t of f.perLevel) rows.push([`${cap(t.level)} floor area`, `${t.indoor.toFixed(1)} m²`]);
    rows.push({ cells: ['Total internal floor area', `${f.total.toFixed(1)} m²`], bold: true, fill: PEN.band });
    if (f.outdoor > 0) rows.push(['Outdoor areas', `${f.outdoor.toFixed(1)} m²`]);
    if (f.garage > 0) rows.push(['Garage (included above)', `${f.garage.toFixed(1)} m²`]);
    rows.push(['Building footprint (ground level)', `${f.footprint.toFixed(1)} m²`]);
    if (f.site) rows.push(['Site area', `${Math.round(f.site)} m²`]);
    if (f.coverage != null) rows.push({ cells: ['Site coverage (footprint over site area)', `${f.coverage.toFixed(1)} %`], bold: true, fill: PEN.band });
    if (f.roofM2 != null) rows.push(['Roof area (from the model, sloped)', `${f.roofM2.toFixed(1)} m²`]);
    if (f.driveM2 > 0) rows.push(['Driveway within the lot (indicative)', `${f.driveM2.toFixed(1)} m²`]);
    if (f.crossM2 > 0) rows.push(['Crossover in the road reserve (indicative)', `${f.crossM2.toFixed(1)} m²`]);
    if (f.site && f.driveM2 > 0) rows.push(['Remaining site area (soft and other hard)', `${Math.max(0, f.site - f.footprint - f.driveM2).toFixed(0)} m²`]);
    const t = table(doc, colA, top, [{ w: wA - 32, head: 'ITEM' }, { w: 32, head: 'AREA', align: 'right' }], rows, opt);
    let y = t.y + 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(TXT.small);
    ink(doc, PEN.grey);
    const note = wrap(doc, 'Areas are measured from the room polygons in the design. Site coverage uses the cadastre area unless a registered area is stated. Council definitions of floor area and coverage can differ: check with council.', wA);
    note.forEach((l, i) => doc.text(l, colA, y + i * 3.3));
    y += note.length * 3.3 + 9;
    // Where the site area goes: a bar of footprint, driveway and the remainder
    if (f.site) {
      heading(doc, 'Site area breakdown', colA, y);
      y += 6;
      const parts = [
        ['Building footprint', f.footprint, PEN.proposed],
        ['Driveway within the lot', f.driveM2, [150, 150, 150]],
        ['Remaining site area', Math.max(0, f.site - f.footprint - f.driveM2), PEN.proposedFill],
      ].filter((q) => q[1] > 0);
      let bx = colA;
      const bh = 12;
      for (const [, v, col] of parts) {
        const w = (v / f.site) * wA;
        doc.setFillColor(...col);
        doc.setDrawColor(...PEN.ink);
        doc.setLineWidth(0.25);
        doc.rect(bx, y, w, bh, 'FD');
        bx += w;
      }
      y += bh + 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(TXT.body);
      for (const [name, v, col] of parts) {
        doc.setFillColor(...col);
        doc.setDrawColor(...PEN.ink);
        doc.rect(colA, y - 3, 5, 3.6, 'FD');
        doc.setTextColor(...PEN.ink);
        doc.text(`${name}: ${v.toFixed(0)} m² (${((v / f.site) * 100).toFixed(0)} %)`, colA + 8, y);
        y += 5.6;
      }
    }
  }
  // Room schedule (paged)
  const rowsAll = f.data.rooms.map((r) => ({ cells: [cap(r.level), cap(r.name), cap(r.type), r.area.toFixed(2)] }));
  const i0 = page.index * per;
  heading(doc, `Room schedule${page.count > 1 ? ` (${page.index + 1} of ${page.count})` : ''}`, colB, BODY.y0 + 6);
  const rt = table(doc, colB, top, [{ w: 26, head: 'LEVEL' }, { w: wB - 26 - 40 - 26, head: 'ROOM' }, { w: 40, head: 'TYPE' }, { w: 26, head: 'M²', align: 'right' }], rowsAll.slice(i0, i0 + per), opt);
  if (page.index === page.count - 1 && rowsAll.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(TXT.small);
    ink(doc, PEN.grey);
    doc.text(`${rowsAll.length} rooms. Areas in square metres to two places.`, colB, rt.y + 5);
  }
  if (page.index === 0) {
    heading(doc, 'Door and window schedule', colC, BODY.y0 + 6);
    const openName = (o) => {
      const t = String(o.type || '').toLowerCase();
      const st = String(o.style || '').toLowerCase();
      if (!st || t.includes(st)) return cap(t);
      return /^(window|door)$/.test(t) ? cap(`${st} ${t}`) : cap(`${t} ${st}`);
    };
    const rowsO = f.data.openings.map((o) => ({ cells: [openName(o), `${o.width} x ${o.height}`, o.sill ? String(o.sill) : '', String(o.count)] }));
    const ot = table(doc, colC, top, [{ w: wC - 70, head: 'TYPE' }, { w: 30, head: 'W x H (MM)' }, { w: 20, head: 'SILL', align: 'right' }, { w: 20, head: 'QTY', align: 'right' }], rowsO, opt);
    let y = ot.y + 8;
    const total = f.data.openings.reduce((a, o) => a + (Number(o.count) || 0), 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(TXT.body);
    ink(doc, PEN.ink);
    doc.text(`Total openings: ${total}`, colC, y);
    y += 9;
    heading(doc, 'Schedule notes', colC, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(TXT.small);
    ink(doc, PEN.grey);
    for (const n of [
      'Sizes are the nominal opening width and height in millimetres. The sill is the height of the sill above the finished floor level.',
      'Glazing, frame and hardware are to be selected by the builder. Window and door energy ratings, bushfire and wind rating requirements are not assessed here.',
      'Room names and types are those in the design. Areas are internal, measured to the face of the wall.',
    ]) {
      const lines = wrap(doc, `· ${n}`, wC);
      lines.forEach((l, i) => doc.text(l, colC + (i ? 2.5 : 0), y + i * 3.3));
      y += lines.length * 3.3 + 2.4;
    }
  }
}

export const scheduleCount = (project) => Math.max(1, Math.ceil(scheduleData(project).rooms.length / 34));

// Floor plan side panel --------------------------------------------------------------------------------------------------------
/** Notes and the room areas of one level, in the free space to the left of the plan. `planLeft` is the sheet x where the plan starts. */
export function drawLevelPanel(doc, ctx, level, planLeft, { sectionSheet = null } = {}) {
  const x0 = BODY.x0;
  const w = planLeft - 14 - x0;
  if (w < 70) return;
  const lot = ctx.project.site?.lot;
  const floor = lot?.floorRL;
  let y = BODY.y0 + 6;
  heading(doc, 'Notes', x0, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(TXT.small);
  ink(doc, PEN.ink);
  const notes = [
    'Dimensions are in millimetres, between wall faces as drawn. Wall construction is not designed here.',
    floor != null ? `Floor level of this storey: RL ${(floor + level.elevation / 1000).toFixed(2)} m AHD${lot.floorRLAuto ? ' (assumed from the ground level at the house)' : ''}.` : 'Floor level is not set: load the lot to give RLs.',
    `Ceiling height ${(level.height / 1000).toFixed(2)} m.`,
    sectionSheet ? `Section A-A is cut where the red chain line crosses the plan: see sheet ${sectionSheet}.` : 'Section A-A is cut where the red chain line crosses the plan.',
    'Furniture is indicative and is not part of the design.',
  ];
  notes.forEach((n, i) => {
    const lines = wrap(doc, `${i + 1}. ${n}`, w);
    lines.forEach((l, j) => doc.text(l, x0 + (j ? 3 : 0), y + j * 3.4));
    y += lines.length * 3.4 + 1.8;
  });
  y += 5;
  heading(doc, 'Room areas', x0, y);
  y += 4.5;
  const rooms = (level.rooms || []).filter((r) => r.status !== 'demolish' && (!r.outdoor || r.roofed) && r.polygon?.length > 2);
  const rows = rooms.map((r) => ({ cells: [cap(r.name || r.type), (G.polygonArea(r.polygon) / 1e6).toFixed(2)] }));
  const total = rooms.reduce((a, r) => a + G.polygonArea(r.polygon) / 1e6, 0);
  rows.push({ cells: ['Total', total.toFixed(2)], bold: true, fill: PEN.band });
  table(doc, x0, y, [{ w: w - 28, head: 'ROOM' }, { w: 28, head: 'M²', align: 'right' }], rows, { size: 7.4, lineH: 3.2, pad: 1.3, maxY: 213 });
}
