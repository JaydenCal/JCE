// Room names and areas for the engineering plan set's floor plans. Each label is set in the largest type that finds a clear spot inside
// its room: clear of walls, furniture, door swings, dimension strings, stairs, the section line and the labels already placed.
import * as G from '../../../model/geometry.js';
import { wallShapes, doorGeometry, furnitureSize, furnitureCorners, stairGeometry } from '../shared.js';
import { dimensionBoxes } from '../pdf.js';
import { PEN, LabelField, boxOfPts, wrap } from './kit.js';

const SIZES = [[10, 8.8], [9, 8], [8, 7.2], [7, 6.4]];

/** Draws the room labels of one level. `T` maps plan mm to sheet mm; `section` is an optional [A, B] sheet segment to keep clear. */
export function drawRoomLabels(doc, { content, T, catalogue, section = null, bounds, extra = [] }) {
  const { level, shapes = wallShapes(level), dims } = content;
  const field = new LabelField(bounds);
  const furnBoxes = [];
  const doorBoxes = [];
  for (const f of level.furniture || []) {
    const pts = furnitureCorners(f, furnitureSize(catalogue, f)).map(T);
    furnBoxes.push(boxOfPts(pts, 0.3));
  }
  for (const sh of shapes) {
    for (const pc of sh.pieces) field.addRing(pc.poly.map(T));
    for (const sp of sh.spans || []) {
      if (sp.opening.kind !== 'door') continue;
      const g = doorGeometry(sh, sp.opening);
      const far = { x: g.F.x + g.O.x - g.H.x, y: g.F.y + g.O.y - g.H.y };
      doorBoxes.push(boxOfPts([g.H, g.F, g.O, far].map(T), 0.6));
    }
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  for (const b of dimensionBoxes(doc, dims || [], T)) field.addBox(b);
  for (const st of level.stairs || []) field.addBox(boxOfPts(stairGeometry(st).corners.map(T), 0.4));
  for (const b of extra) field.addBox(b);
  if (section) {
    const [a, b] = section;
    field.addBox(boxOfPts([a, b], 1.6));
  }
  const rooms = [...(level.rooms || [])].sort((p, q) => G.polygonArea(p.polygon) - G.polygonArea(q.polygon));
  for (const r of rooms) {
    const poly = r.polygon.map(T);
    const bb = G.bbox(poly);
    const name = String(r.name || r.type || '').replace(/^./, (c) => c.toUpperCase());
    const area = `${(G.polygonArea(r.polygon) / 1e6).toFixed(2)} m²`;
    const cen = T(G.polygonCentroid(r.polygon));
    let placed = false;
    for (const [furn, door] of [[true, true], [false, true], [true, false], [false, false]]) {
      for (const [ns, as] of SIZES) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(ns);
        const lines = ns === SIZES.at(-1)[0] ? wrap(doc, name, Math.max(bb.w - 3, 10)).slice(0, 2) : [name];
        const nw = Math.max(...lines.map((l) => doc.getTextWidth(l)));
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(as);
        const aw = doc.getTextWidth(area);
        const w = Math.max(nw, aw) + 1.2;
        const lh = ns * 0.3528 * 1.15;
        const h = lines.length * lh + as * 0.3528 * 1.2 + 0.8;
        if (w > bb.w - 1 || h > bb.h - 1) continue;
        const cands = [];
        for (let y = bb.minY + h / 2 + 0.5; y <= bb.maxY - h / 2 - 0.5; y += 1.2) for (let x = bb.minX + w / 2 + 0.5; x <= bb.maxX - w / 2 - 0.5; x += 1.2) cands.push({ x, y, d: Math.hypot(x - cen.x, y - cen.y) });
        cands.sort((p, q) => p.d - q.d);
        for (const c of cands) {
          const b = { x0: c.x - w / 2, y0: c.y - h / 2, x1: c.x + w / 2, y1: c.y + h / 2 };
          const cs = [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
          if (!cs.every((q) => G.pointInPolygon(q, poly))) continue;
          if (!field.free(b)) continue;
          const hit = (list) => list.some((fb) => !(b.x1 < fb.x0 || b.x0 > fb.x1 || b.y1 < fb.y0 || b.y0 > fb.y1));
          if (door && hit(doorBoxes)) continue;
          if (furn && furnBoxes.some((fb) => !(b.x1 < fb.x0 || b.x0 > fb.x1 || b.y1 < fb.y0 || b.y0 > fb.y1))) continue;
          field.addBox(b);
          doc.setTextColor(...PEN.ink);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(ns);
          lines.forEach((l, i) => doc.text(l, c.x, b.y0 + 0.4 + (i + 0.8) * lh, { align: 'center' }));
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(as);
          doc.text(area, c.x, b.y0 + 0.4 + lines.length * lh + as * 0.3528 * 0.95, { align: 'center' });
          placed = true;
          break;
        }
        if (placed) break;
      }
      if (placed) break;
    }
    if (!placed) {
      doc.setTextColor(...PEN.ink);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.text(name, cen.x, cen.y - 0.6, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.text(area, cen.x, cen.y + 2.6, { align: 'center' });
    }
  }
}
