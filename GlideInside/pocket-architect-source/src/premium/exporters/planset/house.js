// House plan sheet (A100): floor plan only. Dimensioned walls (overall and running strings), room names and areas, doors and windows with
// swings, area totals (living, garage, alfresco, total), north point and scale bar. 1:100 at A3 where it fits, else 1:200.

import { levelsSorted, ascii } from '../shared.js';
import { levelContent } from '../drawing.js';
import { planGeometry, scaleBar } from '../pdf.js';
import { PEN, viewTitle, ink } from '../eng/kit.js';
import { drawRoomLabels } from '../eng/roomlabels.js';
import { AREA } from './frame.js';
import { areaTotals } from './lot.js';

export const HOUSE_REGION = { x0: AREA.x0 + 6, y0: AREA.y0 + 14, x1: AREA.x1 - 6, y1: AREA.y1 - 24 };
const GAP = 14;

/** Pure layout: scale (100 where it fits, else 200 or smaller) and where each level sits. */
export function houseLayout(project, catalogue = null) {
  const levels = levelsSorted(project);
  const contents = levels.map((l) => levelContent(project, l, false, catalogue));
  const R = HOUSE_REGION;
  const rw = R.x1 - R.x0;
  const rh = R.y1 - R.y0;
  for (const scale of [100, 200, 300, 500]) {
    const sizes = contents.map((c) => ({ w: c.box.w / scale, h: c.box.h / scale }));
    const row = { w: sizes.reduce((a, s) => a + s.w, 0) + GAP * (sizes.length - 1), h: Math.max(...sizes.map((s) => s.h)) };
    const col = { w: Math.max(...sizes.map((s) => s.w)), h: sizes.reduce((a, s) => a + s.h, 0) + GAP * (sizes.length - 1) };
    const mode = row.w <= rw && row.h <= rh ? 'row' : col.w <= rw && col.h <= rh ? 'col' : null;
    if (!mode) continue;
    const total = mode === 'row' ? row : col;
    let cx = R.x0 + (rw - total.w) / 2;
    let cy = R.y0 + (rh - total.h) / 2;
    const items = contents.map((c, i) => {
      const s = sizes[i];
      const it = { level: levels[i], content: c, ox: mode === 'row' ? cx : R.x0 + (rw - s.w) / 2, oy: mode === 'row' ? R.y0 + (rh - s.h) / 2 : cy };
      if (mode === 'row') cx += s.w + GAP; else cy += s.h + GAP;
      return it;
    });
    return { scale, mode, items };
  }
  return { scale: 500, mode: 'row', items: [] };
}

const levelName = (l) => `${ascii(l.name) || 'Level'} floor plan`.toUpperCase();

/** Draws the floor plan(s). `project` should already be squared to the page (alignProject). Returns { scale, totals, scaleLabel }. */
export function drawHouse(doc, project, { catalogue = null, northDeg = 0 } = {}) {
  const lay = houseLayout(project, catalogue);
  const ds = lay.scale;
  for (const it of lay.items) {
    const { content, ox, oy } = it;
    const T = (p) => ({ x: ox + (p.x - content.box.minX) / ds, y: oy + (p.y - content.box.minY) / ds });
    planGeometry(doc, { ...content, scale: ds }, T, true, catalogue);
    drawRoomLabels(doc, { content, T, catalogue, bounds: { x0: AREA.x0 + 2, y0: AREA.y0 + 2, x1: AREA.x1 - 2, y1: AREA.y1 - 8 } });
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
    // View title above the plan.
    const w = content.box.w / ds;
    viewTitle(doc, Math.max(AREA.x0 + 6, ox), HOUSE_REGION.y0 - 4, levelName(it.level), `1:${ds} @ A3`);
    void w;
  }
  const totals = areaTotals(project);
  // Area totals box, bottom right of the drawing area.
  const bx = AREA.x1 - 70;
  const by = AREA.y1 - 52;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...PEN.ink);
  doc.setLineWidth(0.25);
  doc.rect(bx, by, 64, 40, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.setTextColor(...PEN.ink);
  doc.text('AREA TOTALS (INDICATIVE)', bx + 3, by + 5);
  const rows = [['Living', totals.living], ['Garage', totals.garage], ['Alfresco / porch', totals.alfresco], ['Total', totals.total]];
  rows.forEach(([k, v], i) => {
    const y = by + 11.5 + i * 6.4;
    doc.setFont('helvetica', i === 3 ? 'bold' : 'normal');
    doc.setFontSize(8);
    doc.text(k, bx + 3, y);
    doc.text(`${v.toFixed(1)} m²`, bx + 61, y, { align: 'right' });
  });
  doc.setLineWidth(0.2);
  doc.line(bx + 3, by + 27.6, bx + 61, by + 27.6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.8);
  doc.setTextColor(95, 99, 106);
  doc.text('Areas to internal room faces. Roofed outdoor rooms', bx + 3, by + 36);
  doc.text('are counted as alfresco.', bx + 3, by + 38.6);

  // North point and scale bar.
  const nx = AREA.x1 - 18;
  const ny = AREA.y0 + 18;
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
  scaleBar(doc, AREA.x0 + 8, AREA.y1 - 20, ds, ds);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...PEN.ink);
  doc.text(`1:${ds} @ A3`, AREA.x0 + 8, AREA.y1 - 24);
  return { scale: ds, scaleLabel: `1:${ds} @ A3`, totals, kv: [['Living', `${totals.living.toFixed(1)} m²`], ['Garage', `${totals.garage.toFixed(1)} m²`], ['Alfresco / porch', `${totals.alfresco.toFixed(1)} m²`], ['Total', `${totals.total.toFixed(1)} m²`]] };
}

