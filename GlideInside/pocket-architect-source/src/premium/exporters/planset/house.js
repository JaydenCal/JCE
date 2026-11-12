// House plan sheets (A100, A101 ...): one level per sheet. Dimensioned walls (overall and running strings), room names and areas, doors and
// windows with swings, area totals (living, garage, alfresco, total), north point and scale bar. 1:100 at A3 where it fits, else 1:200.
// Dimension strings stand clear of roofed outdoor rooms. The totals box, north point and scale bar sit in reserved space.

import * as G from '../../../model/geometry.js';
import { levelsSorted, ascii, outlineBox, wallShapes } from '../shared.js';
import { levelContent } from '../drawing.js';
import { planGeometry, scaleBar } from '../pdf.js';
import { PEN, viewTitle, ink } from '../eng/kit.js';
import { drawRoomLabels } from './labels.js';
import { AREA } from './frame.js';
import { areaTotals } from './lot.js';

// Plan region above a reserved bottom band that carries the scale bar (left), north point (middle) and area totals (right).
export const HOUSE_REGION = { x0: AREA.x0 + 6, y0: AREA.y0 + 16, x1: AREA.x1 - 6, y1: AREA.y1 - 42 };
const BAND_Y = AREA.y1 - 38;
const NORTH_RECT = { x0: 150, y0: BAND_Y, x1: 190, y1: AREA.y1 - 8 };
const BAR_RECT = { x0: AREA.x0 + 4, y0: BAND_Y, x1: AREA.x0 + 76, y1: AREA.y1 - 8 };
const TOT_W = 64;
const TOT_H = 35;
const TOT_SLOT = { x0: AREA.x1 - TOT_W - 6, y0: AREA.y1 - TOT_H - 8, x1: AREA.x1 - 6, y1: AREA.y1 - 8 };

/**
 * Plan content of a level, with every dimension string moved out past any roofed outdoor room that stands proud of the walls (an
 * alfresco or porch), so no string runs through one. The box that has to fit the sheet is grown to match.
 */
export function levelSheetContent(project, level, catalogue = null) {
  const c = levelContent(project, level, false, catalogue);
  const shapes = c.shapes || wallShapes(level);
  const ob = outlineBox(level, shapes);
  const outdoor = (level.rooms || []).filter((r) => r.outdoor && r.polygon?.length >= 3);
  if (!ob || !outdoor.length || !c.dims?.length) return c;
  const ob2 = G.bbox(outdoor.flatMap((r) => r.polygon));
  const proud = { top: Math.max(0, ob.minY - ob2.minY), bottom: Math.max(0, ob2.maxY - ob.maxY), left: Math.max(0, ob.minX - ob2.minX), right: Math.max(0, ob2.maxX - ob.maxX) };
  const cur = (d) => (d.side === 'top' ? ob.minY - d.a.y : d.side === 'bottom' ? d.a.y - ob.maxY : d.side === 'left' ? ob.minX - d.a.x : d.a.x - ob.maxX);
  const shift = {};
  for (const side of ['top', 'bottom', 'left', 'right']) {
    if (!proud[side]) continue;
    const on = c.dims.filter((d) => d.side === side);
    shift[side] = Math.max(0, ...on.map((d) => proud[side] + 500 - cur(d)));
  }
  const mv = (side, p, amt) => (side === 'top' ? { x: p.x, y: p.y - amt } : side === 'bottom' ? { x: p.x, y: p.y + amt } : side === 'left' ? { x: p.x - amt, y: p.y } : { x: p.x + amt, y: p.y });
  const dims = c.dims.map((d) => {
    const amt = shift[d.side] || 0;
    if (!amt) return d;
    const m = (p) => mv(d.side, p, amt);
    return { ...d, a: m(d.a), b: m(d.b), ext: d.ext.map(([p, q]) => [p, m(q)]), ticks: d.ticks.map(([p, q]) => [m(p), m(q)]), textAt: m(d.textAt) };
  });
  const pts = [{ x: c.box.minX, y: c.box.minY }, { x: c.box.maxX, y: c.box.maxY }];
  for (const d of dims) pts.push(d.a, d.b, { x: d.textAt.x - 250, y: d.textAt.y - 200 }, { x: d.textAt.x + 250, y: d.textAt.y + 200 });
  return { ...c, dims, box: G.bbox(pts) };
}

/** Pure layout: one entry per level { level, content, scale, ox, oy, slot }. 1:100 where it fits the plan region, else 1:200, 1:300, 1:500. */
export function houseSheets(project, catalogue = null) {
  const R = HOUSE_REGION;
  const rw = R.x1 - R.x0;
  const rh = R.y1 - R.y0;
  return levelsSorted(project).map((level) => {
    const content = levelSheetContent(project, level, catalogue);
    const scale = [100, 200, 300, 500].find((n) => content.box.w / n <= rw && content.box.h / n <= rh) || 500;
    const w = content.box.w / scale;
    const h = content.box.h / scale;
    return { level, content, scale, ox: R.x0 + (rw - w) / 2, oy: R.y0 + (rh - h) / 2, slot: TOT_SLOT };
  });
}

const levelName = (l) => `${ascii(l.name) || 'Level'} floor plan`.toUpperCase();

/** Draws one floor plan sheet. `project` is squared to the page (alignProject). Returns { scale, scaleLabel, totals, kv }. */
export function drawHouseSheet(doc, project, sh, { catalogue = null, northDeg = 0 } = {}) {
  const { content, ox, oy, scale: ds, level } = sh;
  const T = (p) => ({ x: ox + (p.x - content.box.minX) / ds, y: oy + (p.y - content.box.minY) / ds });
  planGeometry(doc, { ...content, scale: ds }, T, true, catalogue);
  const lf = drawRoomLabels(doc, { content, T, catalogue, bounds: { x0: AREA.x0 + 2, y0: AREA.y0 + 2, x1: AREA.x1 - 2, y1: AREA.y1 - 8 }, extra: [sh.slot, NORTH_RECT, BAR_RECT] });
  // Dimension strings: overall and running.
  doc.setLineDashPattern([], 0);
  doc.setLineWidth(0.12);
  ink(doc, [60, 66, 90]);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  for (const d of content.dims || []) {
    for (const e of d.ext) doc.line(T(e[0]).x, T(e[0]).y, T(e[1]).x, T(e[1]).y);
    doc.line(T(d.a).x, T(d.a).y, T(d.b).x, T(d.b).y);
    doc.setLineWidth(0.25);
    for (const t of d.ticks) {
      const a = T(t[0]);
      const b = T(t[1]);
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const ux = ((b.x - a.x) / len) * 1.1;
      const uy = ((b.y - a.y) / len) * 1.1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      doc.line(mid.x - ux, mid.y - uy, mid.x + ux, mid.y + uy);
    }
    doc.setLineWidth(0.12);
    const at = T(d.textAt);
    if (d.textRot) doc.text(d.text, at.x, at.y, { align: 'center', angle: 90 });
    else doc.text(d.text, at.x, at.y, { align: 'center' });
  }
  viewTitle(doc, AREA.x0 + 6, AREA.y0 + 11, levelName(level), `1:${ds} @ A3`);

  // Area totals box in its reserved slot.
  const totals = areaTotals(project);
  const { x0: bx, y0: by } = sh.slot;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...PEN.ink);
  doc.setLineWidth(0.25);
  doc.rect(bx, by, TOT_W, TOT_H, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.setTextColor(...PEN.ink);
  doc.text('AREA TOTALS (INDICATIVE)', bx + 3, by + 5);
  [['Living', totals.living], ['Garage', totals.garage], ['Alfresco / porch', totals.alfresco], ['Total', totals.total]].forEach(([k, v], i) => {
    const y = by + 10 + i * 4.7;
    doc.setFont('helvetica', i === 3 ? 'bold' : 'normal');
    doc.setFontSize(8);
    doc.text(k, bx + 3, y);
    doc.text(`${v.toFixed(1)} m²`, bx + TOT_W - 3, y, { align: 'right' });
  });
  doc.setLineWidth(0.2);
  doc.line(bx + 3, by + 21.2, bx + TOT_W - 3, by + 21.2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.8);
  doc.setTextColor(95, 99, 106);
  doc.text('Whole house. Areas to internal room faces.', bx + 3, by + 29);
  doc.text('Roofed outdoor rooms count as alfresco.', bx + 3, by + 32.2);

  // North point (reserved top right) and scale bar (reserved bottom left).
  const nx = (NORTH_RECT.x0 + NORTH_RECT.x1) / 2;
  const ny = NORTH_RECT.y0 + 19;
  const a = (northDeg * Math.PI) / 180;
  const d = { x: Math.sin(a), y: -Math.cos(a) };
  const p = { x: -d.y, y: d.x };
  ink(doc, PEN.ink);
  doc.setLineWidth(0.3);
  doc.circle(nx, ny, 8.5, 'S');
  doc.setFillColor(...PEN.ink);
  doc.triangle(nx + d.x * 7.5, ny + d.y * 7.5, nx - d.x * 3 + p.x * 2.6, ny - d.y * 3 + p.y * 2.6, nx - d.x * 3 - p.x * 2.6, ny - d.y * 3 - p.y * 2.6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...PEN.ink);
  doc.text('N', nx + d.x * 12.1, ny + d.y * 12.1 + 1.2, { align: 'center' });
  ink(doc, PEN.ink);
  scaleBar(doc, BAR_RECT.x0 + 4, BAR_RECT.y1 - 15, ds, ds);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...PEN.ink);
  doc.text(`1:${ds} @ A3`, BAR_RECT.x0 + 4, BAR_RECT.y1 - 19.5);
  const rows = lf.schedule || [];
  const blocks = rows.length ? [{
    title: 'ROOM SCHEDULE',
    h: 4 + rows.length * 3.4 + 1.5,
    draw(d, x, y, w) {
      d.setFont('helvetica', 'normal');
      d.setFontSize(6.4);
      d.setTextColor(...PEN.ink);
      rows.forEach((r, i) => { d.text(String(r.n), x + 3, y + 2.6 + i * 3.4); d.text(r.name, x + 8, y + 2.6 + i * 3.4); if (r.area) d.text(r.area, x + w - 3, y + 2.6 + i * 3.4, { align: 'right' }); });
    },
  }] : [];
  return { blocks, scale: ds, scaleLabel: `1:${ds} @ A3`, totals, kv: [['Living', `${totals.living.toFixed(1)} m²`], ['Garage', `${totals.garage.toFixed(1)} m²`], ['Alfresco / porch', `${totals.alfresco.toFixed(1)} m²`], ['Total', `${totals.total.toFixed(1)} m²`]] };
}
