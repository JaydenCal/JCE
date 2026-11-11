// Cover, site analysis and schedules sheets of the engineering style plan set.

import * as G from '../../../model/geometry.js';
import { fallAcross, lotDimensions } from '../../../model/placement.js';
import { scheduleData, levelsSorted } from '../shared.js';
import { buildingRings, roadReserve, deriveDriveway, clearances, lotLabelLines } from '../../../site/lotplan.js';
import { northArrow, placeImage, imageInfo } from '../pdf.js';
import { PEN, clean, wrap, fit, ink, polygon, viewTitle, clippedPolyline, clipPolygon, labelOn, hatch } from './kit.js';
import { BODY } from './frame.js';
import { drawLocality, siteFacts, lotBounds, chooseSiteScale, makeT } from './siteplan.js';
import { ddmmyy, drawingNo } from './brand.js';

/** Generic ruled table with wrapped cells. cols: [{ w, head, align }], rows: [[string]] | { cells, bold, fill }. Returns the bottom y. */
export function table(doc, x, y, cols, rows, { size = 6.2, head = true, pad = 1.3, lineH = 2.7, maxY = BODY.y1 } = {}) {
  const total = cols.reduce((a, c) => a + c.w, 0);
  doc.setLineWidth(0.15);
  let cy = y;
  if (head) {
    doc.setFillColor(...PEN.band);
    ink(doc, PEN.ink);
    doc.rect(x, cy, total, 5.6, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(size);
    let cx = x;
    for (const c of cols) {
      doc.setTextColor(...PEN.ink);
      if (c.align === 'right') doc.text(clean(c.head), cx + c.w - pad, cy + 3.8, { align: 'right' });
      else doc.text(clean(c.head), cx + pad, cy + 3.8);
      cx += c.w;
    }
    cy += 5.6;
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
        if (cols[i].align === 'right') doc.text(l, cx + cols[i].w - pad, cy + pad + 2 + j * lineH, { align: 'right' });
        else doc.text(l, cx + pad, cy + pad + 2 + j * lineH);
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

const heading = (doc, text, x, y) => {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  ink(doc, PEN.ink);
  doc.text(clean(text).toUpperCase(), x, y);
  doc.setDrawColor(...PEN.tag);
  doc.setLineWidth(0.5);
  doc.line(x, y + 1.1, x + doc.getTextWidth(clean(text).toUpperCase()), y + 1.1);
};

// Cover ----------------------------------------------------------------------------------------------------------------------
export function drawCover(doc, ctx, list) {
  const { project, brand } = ctx;
  const tb = project.titleBlock || {};
  const lot = project.site?.lot || null;
  const x0 = BODY.x0 + 2;
  let y = BODY.y0 + 12;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  ink(doc, PEN.tag);
  doc.text('CONCEPT PLAN SET', x0, y);
  y += 11;
  doc.setFontSize(24);
  ink(doc, PEN.ink);
  const name = clean(tb.projectName || project.name || 'Untitled design').toUpperCase();
  const nameLines = wrap(doc, name, 190).slice(0, 2);
  nameLines.forEach((l, i) => doc.text(l, x0, y + i * 10));
  y += nameLines.length * 10 + 2;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  const addr = clean(tb.address || lot?.address || '');
  if (addr) { doc.text(addr, x0, y); y += 6; }
  const ll = lot ? lotLabelLines(lot) : null;
  const lotdp = clean(tb.lotDp || (ll ? `${ll.first} ${ll.second}`.trim() : ''));
  if (lotdp) { doc.text(lotdp, x0, y); y += 6; }
  doc.setFontSize(8);
  ink(doc, PEN.grey);
  const facts = [];
  if (tb.client) facts.push(`Client: ${tb.client}`);
  if (tb.council || lot?.lga) facts.push(`Council: ${tb.council || lot.lga}`);
  if (lot?.zoning?.code) facts.push(`Zone: ${lot.zoning.code} ${lot.zoning.name || ''}`.trim());
  if (lot?.areaM2) facts.push(`Site area: ${Math.round(lot.areaM2)} m2`);
  facts.push(`Issue: ${clean(tb.issuePurpose || 'Concept')}, revision ${clean(tb.revision || 'A')}, ${tb.date ? clean(tb.date) : ddmmyy(ctx.date)}`);
  y += 2;
  facts.forEach((f) => { doc.text(clean(f), x0, y); y += 4.6; });
  y += 4;

  // Drawing list
  heading(doc, 'Drawing list', x0, y);
  y += 4;
  const rows = list.map((s) => ({ cells: [s.number, s.title, s.scale] }));
  const cols = [{ w: 40, head: 'DRAWING NUMBER' }, { w: 100, head: 'TITLE' }, { w: 38, head: 'SCALE' }];
  table(doc, x0, y, cols, rows, { size: 6.8, lineH: 3, pad: 1.2, maxY: BODY.y1 - 14 });

  // Locality: aerial when supplied, else the cadastre schematic.
  const lx = 212;
  heading(doc, 'Locality', lx, BODY.y0 + 12);
  const box = { x0: lx, y0: BODY.y0 + 16, x1: BODY.x1 - 2, y1: ctx.image ? BODY.y0 + 118 : BODY.y1 - 18 };
  drawLocality(doc, box, ctx);
  doc.setDrawColor(...PEN.ink);
  doc.setLineWidth(0.3);
  doc.rect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
  northArrow(doc, box.x1 - 10, box.y0 + 12, project.site?.northDeg || 0);
  if (ctx.image) {
    const img = imageInfo(ctx.image);
    if (img) {
      heading(doc, 'Perspective', lx, box.y1 + 9);
      placeImage(doc, img, { x: lx, y: box.y1 + 12, w: box.x1 - lx, h: BODY.y1 - (box.y1 + 12) - 14 });
    }
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  ink(doc, PEN.grey);
  const note = 'This is a concept design for discussion. Setbacks, levels and boundaries are indicative and have not been checked by a surveyor, certifier or council. Where a council rule is marked check with council it has not been confirmed.';
  wrap(doc, note, 190).forEach((l, i) => doc.text(l, x0, BODY.y1 - 9 + i * 2.8));
  if (brand.mode === 'builder') doc.text(clean(brand.credit), x0, BODY.y1 - 1);
}

// Site analysis and setback table -----------------------------------------------------------------------------------------
export function drawAnalysis(doc, ctx) {
  const { project } = ctx;
  const facts = siteFacts(project);
  const lot = facts?.lot || null;
  const left = { x0: BODY.x0, y0: BODY.y0, x1: 206, y1: BODY.y1 };
  doc.setDrawColor(...PEN.ink);
  doc.setLineWidth(0.35);
  doc.rect(left.x0, left.y0, left.x1 - left.x0, left.y1 - left.y0);
  viewTitle(doc, left.x0 + 3, left.y0 + 6, 'Site analysis', 'NTS');
  const rx = 211;
  const rw = BODY.x1 - rx;
  if (!lot) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    ink(doc, PEN.grey);
    doc.text('No lot is loaded. Use Find my block to analyse the site.', (left.x0 + left.x1) / 2, (left.y0 + left.y1) / 2, { align: 'center' });
    heading(doc, 'Setbacks', rx, BODY.y0 + 6);
    return;
  }
  // Diagram
  const vp = { x0: left.x0 + 2, y0: left.y0 + 10, x1: left.x1 - 2, y1: left.y1 - 2 };
  const bounds = lotBounds(project, facts);
  const { n, ds } = chooseSiteScale([{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }], vp, ctx.k || 1);
  const T = makeT(bounds, vp, ds);
  const rect = { x0: vp.x0, y0: vp.y0, x1: vp.x1, y1: vp.y1 };
  const line = (pts, closed = true) => clippedPolyline(doc, pts.map(T), rect, closed);
  doc.setDrawColor(...PEN.neighbour);
  doc.setLineWidth(0.12);
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
  doc.setDrawColor(...PEN.boundary);
  doc.setLineWidth(0.8);
  line(lot.boundary);
  if (lot.envelope?.length > 2) {
    doc.setDrawColor(...PEN.envelope);
    doc.setLineWidth(0.4);
    doc.setLineDashPattern([3, 1.6], 0);
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
    labelOn(doc, `FALL ${fall.slopePct}% ${fall.direction || ''}`.trim(), b.x + d.x * 3, b.y + d.y * 3 + (d.y >= 0 ? 4.5 : -2), { size: 6, bold: true, colour: PEN.contourMajor });
  }
  // Frontage tag
  const dim = lotDimensions(lot);
  for (const r of facts.reserve) {
    const e0 = lot.boundary[r.edge];
    const e1 = lot.boundary[(r.edge + 1) % lot.boundary.length];
    const mid = T(G.lerp(e0, e1, 0.5));
    const out = { x: r.outward.x, y: r.outward.y };
    labelOn(doc, `STREET FRONTAGE ${dim.frontageM ? dim.frontageM.toFixed(1) : ''} m`, mid.x + out.x * 9, mid.y + out.y * 9, { size: 6.4, bold: true, colour: PEN.road });
  }
  const ll = lotLabelLines(lot);
  labelOn(doc, `${ll.first} ${ll.second}`.trim(), centre.x, T({ x: G.bbox(lot.boundary).minX, y: G.bbox(lot.boundary).minY }).y + 6, { size: 7, bold: true, colour: PEN.boundary });
  northArrow(doc, left.x1 - 12, left.y0 + 20, project.site?.northDeg || 0);
  labelOn(doc, `Diagram only, 1:${n} @ ${ctx.paper || 'A3'}`, left.x0 + 4, left.y1 - 4, { size: 6.4, align: 'left', colour: PEN.grey });

  // Facts
  let y = BODY.y0 + 6;
  heading(doc, 'Site facts', rx, y);
  y += 3.5;
  const z = lot.zoning;
  const fRows = [
    ['Address', lot.address || ''],
    ['Lot and DP', `${ll.first} ${ll.second}`.trim()],
    ['Council', lot.lga || project.titleBlock?.council || 'Not stated'],
    ['Zone', z ? `${z.code || ''} ${z.name || ''}`.trim() : 'Not stated'],
    ['Site area', lot.areaM2 ? `${Math.round(lot.areaM2)} m2${lot.registeredAreaM2 ? ` (registered ${Math.round(lot.registeredAreaM2)} m2)` : ' (from the cadastre)'}` : 'Not stated'],
    ['Frontage and depth', `${dim.frontageM ? dim.frontageM.toFixed(1) : '-'} m by ${dim.depthM ? dim.depthM.toFixed(1) : '-'} m`],
    ['Corner lot', lot.cornerLot ? 'Yes' : 'No'],
    ['Ground fall', fall ? `${fall.fallM} m across the lot, ${fall.slopePct}%${fall.direction ? ` towards the ${fall.direction.toLowerCase()}` : ''}` : 'Not available'],
    ['Floor level', lot.floorRL != null ? `FFL ${lot.floorRL.toFixed(2)} m AHD${lot.floorRLAuto ? ' (assumed)' : ''}` : 'Not set'],
    ['Overlays', 'Bushfire, flood, heritage and easements not checked'],
  ];
  const t1 = table(doc, rx, y, [{ w: 34, head: 'ITEM' }, { w: rw - 34, head: 'DETAIL' }], fRows, { size: 6.2, lineH: 2.6, pad: 1.1 });
  y = t1.y + 7;

  // Setbacks
  heading(doc, 'Setbacks: required and provided', rx, y);
  y += 3.5;
  const cols = [{ w: 28, head: 'BOUNDARY' }, { w: 15, head: 'REQUIRED', align: 'right' }, { w: 15, head: 'PROVIDED', align: 'right' }, { w: 38, head: 'RESULT' }, { w: rw - 96, head: 'SOURCE AND CHECK' }];
  const rows = facts.clear.rows.map((r) => {
    const res = r.status === 'inside' ? 'Inside the indicative setback envelope' : r.status === 'outside' ? `Outside the indicative setback envelope by ${r.shortByM.toFixed(2)} m` : 'No setback rule loaded';
    const src = r.requiredM == null ? 'Council rule not loaded. Check with council.' : `${clean(r.source || 'Source not stated')}${r.flagged ? '. Check with council.' : ''}`;
    return { cells: [r.label.replace(/^./, (c) => c.toUpperCase()), r.requiredM != null ? `${r.requiredM.toFixed(2)} m` : '-', `${r.clearanceM.toFixed(2)} m`, res, src], colours: [PEN.ink, PEN.ink, PEN.ink, r.status === 'outside' ? PEN.envelope : r.status === 'inside' ? PEN.boundary : PEN.grey, PEN.ink] };
  });
  if (!rows.length) rows.push(['No building on the lot', '', '', '', '']);
  const t2 = table(doc, rx, y, cols, rows, { size: 6, lineH: 2.5, pad: 1.1 });
  y = t2.y + 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.6);
  ink(doc, PEN.grey);
  const sb = lot.setbacks;
  const basis = sb ? `Rule set: ${clean(sb.council || '')}, ${clean(sb.basis || '')}. ${clean(sb.source?.name || '')} (${clean(sb.source?.edition || '')}).` : 'No council setback rule set is loaded for this lot.';
  const note = wrap(doc, `${basis} Provided distances are the least distance from the building to each boundary, measured from the walls and rooms. A pass here is not an approval.`, rw).slice(0, 7);
  note.forEach((l, i) => doc.text(l, rx, y + i * 2.5));
  y += note.length * 2.5 + 6;

  // Items to confirm before this design is used for anything but discussion.
  heading(doc, 'Items to confirm', rx, y);
  y += 3.5;
  const confirm = [];
  const plain = (t) => clean(t).replace(/flagged for review by the research agent/gi, 'not yet confirmed with council');
  for (const w of sb?.warnings || []) confirm.push([plain(typeof w === 'string' ? w : w.text || w.message || ''), 'Council']);
  if (!(sb?.warnings || []).length && sb?.flag) confirm.push([plain(sb.flagReason || 'Setback figures are not yet confirmed with council'), 'Council']);
  confirm.push(['Bushfire attack level, flood, heritage and other overlays', 'Council or certifier']);
  confirm.push(['Easements, sewer and stormwater connection points, Dial Before You Dig plans', 'Surveyor and authorities']);
  confirm.push(['Registered survey: boundaries, levels, trees and existing structures', 'Registered surveyor']);
  confirm.push(['Crossover location, width and levels; driveway grade', 'Council']);
  confirm.push(['Structure, bracing and footings', 'Structural engineer']);
  table(doc, rx, y, [{ w: rw - 44, head: 'ITEM' }, { w: 44, head: 'WHO CONFIRMS' }], confirm.filter((r) => r[0]), { size: 6, lineH: 2.5, pad: 1.1 });
}

// Schedules ------------------------------------------------------------------------------------------------------------------
export function areaFigures(project, roofM2 = null) {
  const lot = project.site?.lot || null;
  const levels = levelsSorted(project);
  const data = scheduleData(project);
  const ground = levels[0];
  const footprint = (ground?.rooms || []).filter((r) => r.status !== 'demolish' && (!r.outdoor || r.roofed)).reduce((a, r) => a + G.polygonArea(r.polygon) / 1e6, 0);
  const drive = project.site?.lot ? deriveDriveway(project) : null;
  const driveM2 = drive?.ok ? G.polygonArea(drive.polygon) / 1e6 : 0;
  const total = data.totals.reduce((a, t) => a + t.indoor, 0);
  const outdoor = data.totals.reduce((a, t) => a + t.outdoor, 0);
  const garage = data.rooms.filter((r) => r.type === 'Garage').reduce((a, r) => a + r.area, 0);
  const site = lot?.areaM2 || null;
  return { footprint, driveM2, total, outdoor, garage, site, coverage: site ? (footprint / site) * 100 : null, roofM2, perLevel: data.totals, data };
}

export function drawSchedules(doc, ctx, page, extra = {}) {
  const { project } = ctx;
  const f = areaFigures(project, extra.roofM2 ?? null);
  const colA = BODY.x0;
  const wA = 126;
  const colB = colA + wA + 6;
  const wB = 150;
  const colC = colB + wB + 6;
  const wC = BODY.x1 - colC;
  const per = 34;
  if (page.index === 0) {
    let y = BODY.y0 + 6;
    heading(doc, 'Areas and site coverage', colA, y);
    y += 3.5;
    const rows = [];
    for (const t of f.perLevel) rows.push([`${t.level} floor area`, `${t.indoor.toFixed(1)} m2`]);
    rows.push({ cells: ['Total internal floor area', `${f.total.toFixed(1)} m2`], bold: true, fill: PEN.band });
    if (f.outdoor > 0) rows.push(['Outdoor areas', `${f.outdoor.toFixed(1)} m2`]);
    if (f.garage > 0) rows.push(['Garage (included above)', `${f.garage.toFixed(1)} m2`]);
    rows.push(['Building footprint (ground level)', `${f.footprint.toFixed(1)} m2`]);
    if (f.site) rows.push(['Site area', `${Math.round(f.site)} m2`]);
    if (f.coverage != null) rows.push({ cells: ['Site coverage (footprint over site area)', `${f.coverage.toFixed(1)} %`], bold: true, fill: PEN.band });
    if (f.roofM2 != null) rows.push(['Roof area (from the model, sloped)', `${f.roofM2.toFixed(1)} m2`]);
    if (f.driveM2 > 0) rows.push(['Driveway (indicative)', `${f.driveM2.toFixed(1)} m2`]);
    if (f.site && f.driveM2 > 0) rows.push(['Remaining site area (soft and other hard)', `${Math.max(0, f.site - f.footprint - f.driveM2).toFixed(0)} m2`]);
    const t = table(doc, colA, y, [{ w: wA - 28, head: 'ITEM' }, { w: 28, head: 'AREA', align: 'right' }], rows, { size: 6.6, lineH: 2.8 });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.6);
    ink(doc, PEN.grey);
    wrap(doc, 'Areas are measured from the room polygons in the design. Site coverage uses the cadastre area unless a registered area is stated. Council definitions of floor area and coverage can differ: check with council.', wA).forEach((l, i) => doc.text(l, colA, t.y + 4 + i * 2.5));
  }
  // Room schedule (paged)
  const rowsAll = f.data.rooms.map((r) => ({ cells: [r.level, r.name, r.type, r.area.toFixed(2)] }));
  const i0 = page.index * per;
  heading(doc, `Room schedule${page.count > 1 ? ` (${page.index + 1} of ${page.count})` : ''}`, colB, BODY.y0 + 6);
  table(doc, colB, BODY.y0 + 9.5, [{ w: 32, head: 'LEVEL' }, { w: 56, head: 'ROOM' }, { w: 36, head: 'TYPE' }, { w: wB - 124, head: 'M2', align: 'right' }], rowsAll.slice(i0, i0 + per), { size: 6.4, lineH: 2.6, pad: 1.1 });
  if (page.index === 0) {
    heading(doc, 'Door and window schedule', colC, BODY.y0 + 6);
    const rowsO = f.data.openings.map((o) => ({ cells: [o.type + (o.style ? ` ${o.style}` : ''), `${o.width} x ${o.height}`, o.sill ? String(o.sill) : '-', String(o.count)] }));
    table(doc, colC, BODY.y0 + 9.5, [{ w: wC - 52, head: 'TYPE' }, { w: 24, head: 'W x H MM' }, { w: 14, head: 'SILL', align: 'right' }, { w: 14, head: 'QTY', align: 'right' }], rowsO, { size: 6, lineH: 2.5, pad: 1 });
  }
}

export const scheduleCount = (project) => Math.max(1, Math.ceil(scheduleData(project).rooms.length / 34));
