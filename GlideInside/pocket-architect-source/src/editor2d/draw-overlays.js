// Site constraint overlays in the 2D plan (flood planning, bushfire prone land, heritage, easements): hatched, tinted polygons with an
// outline, drawn under the lot, plus a small legend. Off by default; each layer is a switch in the Site panel (site.lot.layers.ov_*).
// Screen space patterns, so the hatch stays the same density at any zoom.

import { worldToScreen } from './math.js';
import { OVERLAY_STYLE, drawableLayers, overlayOn, creditLines, legendEntries } from '../site/overlays.js';

const patterns = new Map();

function hatchPattern(ctx, id) {
  if (typeof document === 'undefined' || !ctx.createPattern) return null;
  if (patterns.has(id)) return patterns.get(id);
  const { rgb, hatch } = OVERLAY_STYLE[id];
  const c = document.createElement('canvas');
  c.width = c.height = 12;
  const g = c.getContext('2d');
  if (!g) return null;
  g.strokeStyle = `rgba(${rgb.join(',')},0.75)`;
  g.fillStyle = `rgba(${rgb.join(',')},0.75)`;
  g.lineWidth = 1.2;
  g.beginPath();
  if (hatch === 'diag' || hatch === 'cross') { g.moveTo(-2, 14); g.lineTo(14, -2); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(10, 14); g.lineTo(14, 10); }
  if (hatch === 'cross') { g.moveTo(-2, -2); g.lineTo(14, 14); }
  if (hatch === 'horiz') { g.moveTo(0, 6); g.lineTo(12, 6); }
  g.stroke();
  if (hatch === 'dots') { g.beginPath(); g.arc(6, 6, 1.6, 0, Math.PI * 2); g.fill(); }
  const p = ctx.createPattern(c, 'repeat');
  patterns.set(id, p);
  return p;
}

function trace(ctx, view, ring) {
  ring.forEach((p, i) => {
    const s = worldToScreen(view, p);
    if (i) ctx.lineTo(s.x, s.y);
    else ctx.moveTo(s.x, s.y);
  });
  ctx.closePath();
}

export function drawOverlays(ctx, st) {
  const lot = st.project.site?.lot;
  if (!lot?.overlays) return;
  const on = drawableLayers(lot).filter((l) => overlayOn(lot, l.id));
  if (!on.length) return;
  const { view } = st;
  ctx.save();
  ctx.lineJoin = 'round';
  for (const layer of on) {
    const { rgb } = OVERLAY_STYLE[layer.id];
    const pat = hatchPattern(ctx, layer.id);
    for (const f of layer.features) {
      for (const poly of f.rings) {
        ctx.beginPath();
        trace(ctx, view, poly.outer);
        for (const h of poly.holes) trace(ctx, view, h);
        ctx.fillStyle = `rgba(${rgb.join(',')},0.14)`;
        ctx.fill('evenodd');
        if (pat) { ctx.fillStyle = pat; ctx.fill('evenodd'); }
        ctx.strokeStyle = `rgba(${rgb.join(',')},0.9)`;
        ctx.lineWidth = 1.2;
        ctx.setLineDash(layer.id === 'easement' ? [6, 3] : []);
        ctx.stroke();
      }
    }
  }
  ctx.setLineDash([]);
  ctx.restore();
}

export const LEGEND_W = 252;
export const legendHeight = (rows, credits) => rows * 17 + 24 + credits * 11 + 26;

/** Where the legend goes: top right under the north point and the Map data chip, else bottom left, else bottom right, the first spot that does not sit over the lot. */
export function legendPlacement(size, lotBox, h, w = LEGEND_W, { cardLeft = false } = {}) {
  const hit = (b) => !!lotBox && b.x < lotBox.maxX && b.x + w > lotBox.minX && b.y < lotBox.maxY && b.y + h > lotBox.minY;
  // The design card (HTML, over the canvas) is docked bottom left when cardLeft (the scale bar then moves right): never put the legend under it.
  const spots = [{ x: size.w - w - 14, y: 168 }, ...(cardLeft ? [] : [{ x: 14, y: size.h - h - 104 }]), { x: size.w - w - 14, y: size.h - h - 104 }];
  return spots.find((b) => b.y >= 14 && !hit(b)) || spots[0];
}

/** The legend is drawn in its own pass after every plan layer (editor.js), so the house, driveway and labels can never cover it. */
export function drawOverlayLegend(ctx, st) {
  const lot = st.project.site?.lot;
  if (!lot?.overlays) return;
  const on = drawableLayers(lot).filter((l) => overlayOn(lot, l.id));
  if (!on.length || st.size.w < 420) return;
  const credits = creditLines(legendEntries(lot));
  const h = legendHeight(on.length, credits.length);
  let lotBox = null;
  if (Array.isArray(lot.boundary) && lot.boundary.length) {
    const pts = lot.boundary.map((p) => worldToScreen(st.view, p));
    lotBox = { minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)) };
  }
  ctx.save();
  drawLegend(ctx, st, on, credits, legendPlacement(st.size, lotBox, h, LEGEND_W, { cardLeft: !!st.scaleRight }));
  ctx.restore();
}

// A compact legend, only for the switched-on layers: swatch, name and the "indicative" caution.
function drawLegend(ctx, st, on, credits = [], at = { x: st.size.w - LEGEND_W - 14, y: 168 }) {
  const rowH = 17;
  const w = LEGEND_W;
  const x = at.x;
  const h = legendHeight(on.length, credits.length);
  let y = at.y;
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.font = `600 10.5px ${st.theme.f.ui}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#333';
  ctx.fillText('Site constraints (indicative)', x + 8, y + 10);
  y += 22;
  for (const l of on) {
    const { rgb } = OVERLAY_STYLE[l.id];
    ctx.fillStyle = `rgba(${rgb.join(',')},0.25)`;
    ctx.fillRect(x + 8, y - 5, 18, 10);
    const pat = hatchPattern(ctx, l.id);
    if (pat) { ctx.fillStyle = pat; ctx.fillRect(x + 8, y - 5, 18, 10); }
    ctx.strokeStyle = `rgba(${rgb.join(',')},0.9)`;
    ctx.strokeRect(x + 8.5, y - 4.5, 18, 10);
    ctx.fillStyle = '#333';
    ctx.font = `500 10.5px ${st.theme.f.ui}`;
    ctx.fillText(l.label, x + 34, y);
    y += rowH;
  }
  // Source and data date per layer, then the caution. Long source names are cut to fit the box.
  ctx.fillStyle = '#555';
  ctx.font = `400 9px ${st.theme.f.ui}`;
  const fit = (t) => { let o = t; while (o.length > 4 && (ctx.measureText?.(o)?.width ?? 0) > w - 16) o = `${o.slice(0, -4)}...`; return o; };
  for (const c of credits) { ctx.fillText(fit(c), x + 8, y); y += 11; }
  ctx.fillText('Indicative only. Check with council.', x + 8, y + 2);
  ctx.fillText('Open government mapping, not a survey.', x + 8, y + 13);
}
