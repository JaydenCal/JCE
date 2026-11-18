// Ground context for floor plan sheets (the house plan at 1:100 and the engineering set's floor and roof plans): the existing ground
// contours and RL labels outside the walls and dimension strings, through the shared drawGroundLayer(). Pure drawing, Node compatible.

import { LabelField, PEN } from '../eng/kit.js';
import { drawGroundLayer } from './contours.js';
import { fflText } from './levels.js';

/**
 * ground: { lot, levels, align, unalign }  (align / unalign turn the lot's plan to and from the squared house plan; null when not turned)
 * T, Ti: squared plan mm to sheet mm and back.   rect: where the plan may draw.
 * keepOut: sheet boxes { x0, y0, x1, y1 } the contours must not enter (the plan with its dimension strings, totals, north, scale bar).
 * Returns the ground layer result, or null when the lot has no ground data.
 */
export function drawPlanGround(doc, { ground, T, Ti, rect, keepOut = [], mark = null, light = true }) {
  if (!ground?.lot || !ground.levels?.has) return null;
  const { lot, levels, align, unalign } = ground;
  const S = (p) => T(align ? align(p) : p);
  const Si = (q) => { const p = Ti(q); return unalign ? unalign(p) : p; };
  const field = new LabelField(rect);
  const masks = [];
  for (const b of keepOut) {
    field.addBox(b);
    masks.push([{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }]);
  }
  return drawGroundLayer(doc, { lot, levels, S, Si, rect, field, masks, light, mark });
}

/** The finished floor level of a level as a small boxed tag at (x, y) on the sheet: "FFL 100.62", or on an assumed datum. */
export function drawLevelFfl(doc, levels, elevationMm, x, y) {
  const rl = levels.floorRL + (Number(elevationMm) || 0) / 1000;
  const text = fflText(levels, rl);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  const w = doc.getTextWidth(text) + 2.4;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...PEN.ink);
  doc.setLineWidth(0.2);
  doc.setLineDashPattern([], 0);
  doc.rect(x, y, w, 4.2, 'FD');
  doc.setTextColor(...PEN.ink);
  doc.text(text, x + 1.2, y + 3.05);
  return { x0: x, y0: y, x1: x + w, y1: y + 4.2 };
}
