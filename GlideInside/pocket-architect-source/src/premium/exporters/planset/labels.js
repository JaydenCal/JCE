// Room labels for the house plan sheet. Every label is tested against the walls, door swings, furniture, dimension strings, stairs and the
// labels already placed. Order of attempts: name with area, name only, smaller type, abbreviated name, then a numbered tag in the room with the name in a room schedule.
// Rooms under 3 m2 carry no area. Nothing is ever drawn across a wall.

import * as G from '../../../model/geometry.js';
import { wallShapes, doorGeometry, furnitureSize, furnitureCorners, stairGeometry } from '../shared.js';
import { dimensionBoxes } from '../pdf.js';
import { PEN, LabelField, boxOfPts, haloText } from '../eng/kit.js';

const SIZES = [[9, 8], [8, 7.2], [7, 6.4], [6, 5.4], [5.2, 4.8]];
const MIN_AREA_TEXT_M2 = 3;

const hit = (b, list) => list.some((o) => !(b.x1 < o.x0 || b.x0 > o.x1 || b.y1 < o.y0 || b.y0 > o.y1));

/** "Linen 1" gives "LIN 1", "Walk in robe" gives "WAL ROB". */
export function abbreviate(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 5).toUpperCase();
  return parts.map((p, i) => (/^\d+$/.test(p) ? p : p.slice(0, i === 0 ? 3 : 3).toUpperCase())).slice(0, 3).join(' ');
}

/**
 * Draws the labels of one level. `T` maps plan mm to sheet mm. `bounds` is the sheet rectangle labels must stay inside.
 * `extra` are further sheet boxes to keep clear (area totals, title).
 */
export function drawRoomLabels(doc, { content, T, catalogue, bounds, extra = [] }) {
  const { level, shapes = wallShapes(level), dims } = content;
  const field = new LabelField(bounds);
  const furnBoxes = [];
  const doorBoxes = [];
  for (const f of level.furniture || []) furnBoxes.push(boxOfPts(furnitureCorners(f, furnitureSize(catalogue, f)).map(T), 0.3));
  for (const sh of shapes) {
    for (const pc of sh.pieces) field.addRing(pc.poly.map(T));
    for (const sp of sh.spans || []) {
      if (sp.opening.kind !== 'door') continue;
      const g = doorGeometry(sh, sp.opening);
      const far = { x: g.F.x + g.O.x - g.H.x, y: g.F.y + g.O.y - g.H.y };
      doorBoxes.push(boxOfPts([g.H, g.F, g.O, far].map(T), 0.5));
    }
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  for (const b of dimensionBoxes(doc, dims || [], T)) field.addBox(b);
  for (const d of dims || []) field.addSeg(T(d.a), T(d.b));
  for (const st of level.stairs || []) field.addBox(boxOfPts(stairGeometry(st).corners.map(T), 0.4));
  for (const b of extra) field.addBox(b);
  for (const b of doorBoxes) field.addBox(b);
  const rooms = [...(level.rooms || [])].filter((r) => r.polygon?.length >= 3 && r.status !== 'demolish').sort((p, q) => G.polygonArea(p.polygon) - G.polygonArea(q.polygon));
  const polys = rooms.map((r) => r.polygon.map(T));
  const tags = [];
  const schedule = [];

  const drawIn = (spec, c, ink = PEN.ink) => {
    doc.setTextColor(...ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(spec.ns);
    if (spec.halo) {
      haloText(doc, spec.name, c.x, spec.y0 + 0.5 + spec.nameH * 0.8, { size: spec.ns, bold: true, align: 'center', halo: 0.8 });
      if (spec.area) haloText(doc, spec.area, c.x, spec.y0 + 0.5 + spec.nameH + spec.as * 0.3528 * 0.95, { size: spec.as, bold: false, align: 'center', halo: 0.8 });
      return;
    }
    doc.text(spec.name, c.x, spec.y0 + 0.5 + spec.nameH * 0.8, { align: 'center' });
    if (spec.area) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(spec.as);
      doc.text(spec.area, c.x, spec.y0 + 0.5 + spec.nameH + spec.as * 0.3528 * 0.95, { align: 'center' });
    }
  };

  rooms.forEach((r, ri) => {
    const poly = polys[ri];
    const bb = G.bbox(poly);
    const full = String(r.name || r.type || '').replace(/^./, (c) => c.toUpperCase());
    const m2 = G.polygonArea(r.polygon) / 1e6;
    const area = m2 >= MIN_AREA_TEXT_M2 ? `${m2.toFixed(2)} m²` : '';
    const cen = T(G.polygonCentroid(r.polygon));
    const inRoom = (b) => [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].every(([x, y]) => G.pointInPolygon({ x, y }, poly));
    const variants = [{ name: full, area }, { name: full, area: '' }, { name: abbreviate(full), area: '' }];
    const attempts = [];
    for (const furn of [true, false]) for (const v of variants) for (const sz of SIZES) attempts.push({ furn, v, sz });
    // Order: full label at 9 to 7 pt, name only at 9 to 7 pt, full label at small type, name only at small type, abbreviation.
    const rank = (a) => { const vi = variants.indexOf(a.v); const si = SIZES.indexOf(a.sz); return (vi === 2 ? 4 : vi + (si >= 3 ? 2 : 0)) * 100 + si * 10 + (a.furn ? 0 : 1); };
    attempts.sort((a, b) => rank(a) - rank(b));
    for (const at of attempts) {
      const [ns, as] = at.sz;
      if (!at.v.name) continue;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(ns);
      const nw = doc.getTextWidth(at.v.name);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(as);
      const aw = at.v.area ? doc.getTextWidth(at.v.area) : 0;
      const w = Math.max(nw, aw) + 1.2;
      const nameH = ns * 0.3528 * 1.15;
      const h = nameH + (at.v.area ? as * 0.3528 * 1.2 : 0) + 0.8;
      if (w > bb.w - 1 || h > bb.h - 1) continue;
      const cands = [];
      for (let y = bb.minY + h / 2 + 0.4; y <= bb.maxY - h / 2 - 0.4; y += 1.1) for (let x = bb.minX + w / 2 + 0.4; x <= bb.maxX - w / 2 - 0.4; x += 1.1) cands.push({ x, y, d: Math.hypot(x - cen.x, y - cen.y) });
      cands.sort((p, q) => p.d - q.d);
      for (const c of cands) {
        const b = { x0: c.x - w / 2, y0: c.y - h / 2, x1: c.x + w / 2, y1: c.y + h / 2 };
        const bi = { x0: b.x0 - 0.5, y0: b.y0 - 0.4, x1: b.x1 + 0.5, y1: b.y1 + 0.4 };
        if (!inRoom(bi) || !field.free(bi)) continue;
        if (at.furn && hit(b, furnBoxes)) continue;
        field.addBox(b);
        drawIn({ ns, as, name: at.v.name, area: at.v.area, y0: b.y0, nameH, halo: !at.furn }, c);
        return;
      }
    }
    // No fit: a numbered tag inside the room (never a leader across a wall). The name goes in the room schedule in the strip.
    const n = tags.length + 1;
    const rad = 1.9;
    const tcands = [];
    for (let y = bb.minY + rad + 0.3; y <= bb.maxY - rad - 0.3; y += 0.8) for (let x = bb.minX + rad + 0.3; x <= bb.maxX - rad - 0.3; x += 0.8) tcands.push({ x, y, d: Math.hypot(x - cen.x, y - cen.y) });
    tcands.sort((p, q) => p.d - q.d);
    let tc = tcands.find((c) => {
      const b2 = { x0: c.x - rad, y0: c.y - rad, x1: c.x + rad, y1: c.y + rad };
      return inRoom(b2) && field.free(b2);
    });
    if (!tc) tc = { x: cen.x, y: cen.y };
    field.addBox({ x0: tc.x - rad, y0: tc.y - rad, x1: tc.x + rad, y1: tc.y + rad });
    tags.push({ n, x: tc.x, y: tc.y, rad });
    schedule.push({ n, name: full, area });
  });

  for (const t of tags) {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...PEN.ink);
    doc.setLineWidth(0.15);
    doc.circle(t.x, t.y, t.rad, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.6);
    doc.setTextColor(...PEN.ink);
    doc.text(String(t.n), t.x, t.y + 0.75, { align: 'center' });
  }
  field.schedule = schedule;
  return field;
}
