// Room labels for the house plan sheet. Every label is tested against the walls, door swings, furniture, dimension strings, stairs and the
// labels already placed. Order of attempts: name with area, name only, smaller type, abbreviated name, then a leader out into clear space.
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
  const leaders = [];

  const drawIn = (spec, c, ink = PEN.ink) => {
    doc.setTextColor(...ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(spec.ns);
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
        if (!inRoom(b) || !field.free(b)) continue;
        if (at.furn && hit(b, furnBoxes)) continue;
        field.addBox(b);
        drawIn({ ns, as, name: at.v.name, area: at.v.area, y0: b.y0, nameH }, c);
        return;
      }
    }
    // Leader out: the abbreviation (or name) in clear space close to the room, joined to it by a thin line.
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    const text = abbreviate(full) || full;
    const w = doc.getTextWidth(text) + 1.2;
    const h = 6 * 0.3528 * 1.3 + 0.6;
    const ring = [];
    for (let rad = 6; rad <= 34; rad += 4) for (let a = 0; a < 360; a += 22.5) ring.push({ x: cen.x + rad * Math.cos((a * Math.PI) / 180), y: cen.y + rad * Math.sin((a * Math.PI) / 180), rad });
    for (const c of ring) {
      const b = { x0: c.x - w / 2, y0: c.y - h / 2, x1: c.x + w / 2, y1: c.y + h / 2 };
      if (polys.some((pl) => [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].some(([x, y]) => G.pointInPolygon({ x, y }, pl)))) continue;
      if (!field.free(b)) continue;
      const seg = [cen, { x: Math.min(Math.max(cen.x, b.x0), b.x1), y: Math.min(Math.max(cen.y, b.y0), b.y1) }];
      if (field.segs.some((s) => !s.soft && segCross(s[0], s[1], seg[0], seg[1])) && c.rad < 30) continue;
      field.addBox(b);
      leaders.push({ seg, text, b });
      return;
    }
    // Last resort: the abbreviation on a white patch, so it is at least legible.
    const b = { x0: cen.x - w / 2, y0: cen.y - h / 2, x1: cen.x + w / 2, y1: cen.y + h / 2 };
    field.addBox(b);
    leaders.push({ seg: null, text, b });
  });

  for (const l of leaders) {
    if (l.seg) {
      doc.setDrawColor(...PEN.grey);
      doc.setLineWidth(0.12);
      doc.line(l.seg[0].x, l.seg[0].y, l.seg[1].x, l.seg[1].y);
      doc.setFillColor(...PEN.grey);
      doc.circle(l.seg[0].x, l.seg[0].y, 0.45, 'F');
    }
    haloText(doc, l.text, (l.b.x0 + l.b.x1) / 2, l.b.y1 - 0.9, { size: 6, bold: true, align: 'center', halo: 0.9 });
  }
  return field;
}

function segCross(a, b, c, d) {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(a, b, c);
  const d2 = o(a, b, d);
  const d3 = o(c, d, a);
  const d4 = o(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
