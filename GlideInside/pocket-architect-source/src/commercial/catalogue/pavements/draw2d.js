// 2D plan drawing for the pavements (screen space, canvas 2D context): hatched pavement areas, kerb symbols with their line weights,
// markings, wheel stops, and legend swatches. `toScreen(p)` maps a plan point (mm) to { x, y } pixels; `scale` is pixels per mm and sets
// the line weights (a marking line is never thinner than 1 px). Takes any object with the canvas 2D methods used, so it runs in tests with a
// recording stub. No DOM access.

import { pavementById } from './pavements.js';
import { kerbById, planLines } from './kerbs.js';
import { markingGeometry, markingById, drawAccessibleIcon } from './markings.js';

function trace(ctx, pts) {
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

/** Hatch pattern lines inside a screen polygon (the context is clipped to it by the caller). Spacing in px. */
function hatchLines(ctx, bounds, h, spacing) {
  const { minX, minY, maxX, maxY } = bounds;
  const lines = (angle) => {
    const a = (angle * Math.PI) / 180;
    const d = { x: Math.cos(a), y: Math.sin(a) };
    const n = { x: -d.y, y: d.x };
    const cx = (minX + maxX) / 2; const cy = (minY + maxY) / 2;
    const R = Math.hypot(maxX - minX, maxY - minY) / 2 + spacing;
    for (let s = -R; s <= R; s += spacing) {
      ctx.moveTo(cx + n.x * s - d.x * R, cy + n.y * s - d.y * R);
      ctx.lineTo(cx + n.x * s + d.x * R, cy + n.y * s + d.y * R);
    }
  };
  ctx.beginPath();
  switch (h.pattern) {
    case 'cross': lines(h.angleDeg); lines(h.angleDeg + 90); break;
    case 'grid': lines(0); lines(90); break;
    case 'brick': lines(0); lines(90); break;
    case 'herringbone': lines(h.angleDeg); lines(h.angleDeg - 90); break;
    case 'diag': lines(h.angleDeg); break;
    case 'dots':
    case 'stipple':
    case 'gravel':
    case 'aggregate': {
      const r = Math.max(0.6, spacing * (h.pattern === 'stipple' ? 0.07 : 0.1));
      for (let y = minY; y <= maxY; y += spacing) {
        for (let x = minX + (((y - minY) / spacing) % 2 ? spacing / 2 : 0); x <= maxX; x += spacing) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); }
      }
      ctx.fill();
      return;
    }
    default: lines(h.angleDeg);
  }
  ctx.stroke();
}

/** Fill one pavement polygon (screen points) with its type's plan fill and hatch. */
export function drawPavementArea(ctx, screenPoly, type, scale = 0.01) {
  const t = pavementById(type);
  if (!t || screenPoly.length < 3) return;
  const h = t.hatch2d;
  ctx.save();
  ctx.beginPath();
  trace(ctx, screenPoly);
  ctx.fillStyle = h.fill;
  ctx.fill();
  ctx.clip();
  const xs = screenPoly.map((p) => p.x); const ys = screenPoly.map((p) => p.y);
  ctx.strokeStyle = h.line;
  ctx.fillStyle = h.line;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 0.8;
  hatchLines(ctx, { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }, h, Math.max(5, h.spacingMm * scale));
  ctx.restore();
}

/** Kerb symbol along a plan polyline: the lines of its profile at their offsets, weights in mm so they scale with the drawing. */
export function drawKerb(ctx, kerb, toScreen, scale = 0.01) {
  const kd = kerbById(kerb.type);
  if (!kd) return;
  ctx.save();
  ctx.strokeStyle = '#2b2b2b';
  ctx.lineCap = 'butt';
  for (const ln of planLines(kd, kerb.polyline)) {
    const a = toScreen(ln.a); const b = toScreen(ln.b);
    ctx.lineWidth = Math.max(0.8, ln.weightMm * scale);
    ctx.setLineDash(ln.dash ? ln.dash.map((d) => Math.max(2, d * scale)) : []);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.restore();
}

/** One marking or fixed item (plan view): its paint polygons, and the wheelchair symbol on the accessible bay. */
export function drawMarking(ctx, item, toScreen, scale = 0.01) {
  if (!markingById(item.type)) return;
  const g = markingGeometry(item);
  ctx.save();
  for (const p of g.polygons) {
    const pts = p.polygon.map(toScreen);
    ctx.beginPath(); trace(ctx, pts);
    ctx.fillStyle = p.colour;
    ctx.fill();
    if (p.kind === 'solid') { ctx.strokeStyle = '#555'; ctx.lineWidth = 0.8; ctx.stroke(); }
  }
  if (g.symbol) {
    const c = toScreen(g.symbol.centre);
    const px = Math.max(8, g.symbol.sizeMm * scale);
    drawAccessibleIcon(ctx, c.x, c.y, px);
  }
  ctx.restore();
}

/** The whole pavement plan from a pavementModel(): areas, then kerbs, then markings and wheel stops. */
export function drawPavementPlan(ctx, model, toScreen, { scale = 0.01 } = {}) {
  for (const a of model.areas) drawPavementArea(ctx, a.polygon.map(toScreen), a.type, scale);
  for (const k of model.kerbs) drawKerb(ctx, k, toScreen, scale);
  for (const it of model.items) drawMarking(ctx, it, toScreen, scale);
}

/** A legend swatch (w by h px at x, y) for a planLegend() item. */
export function drawLegendSwatch(ctx, item, x, y, w, h) {
  const sw = item.swatch;
  ctx.save();
  if (item.kind === 'pavement') {
    drawPavementArea(ctx, [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], item.id, 0.012);
    ctx.strokeStyle = '#555'; ctx.lineWidth = 0.6; ctx.strokeRect(x, y, w, h);
  } else if (item.kind === 'kerb') {
    ctx.strokeStyle = '#2b2b2b';
    const n = sw.lines.length;
    sw.lines.forEach((ln, i) => {
      const yy = y + (h * (i + 0.5)) / n;
      ctx.lineWidth = Math.max(0.8, ln.weightMm / 60);
      ctx.setLineDash(ln.dash ? [4, 2] : []);
      ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke();
    });
  } else {
    ctx.fillStyle = sw.colour;
    ctx.fillRect(x, y + h * 0.2, w, h * 0.6);
    ctx.strokeStyle = '#777'; ctx.lineWidth = 0.5; ctx.strokeRect(x, y + h * 0.2, w, h * 0.6);
  }
  ctx.restore();
}
