// Site constraint overlays in the 2D plan (flood planning, bushfire prone land, heritage, easements): hatched, tinted polygons with an
// outline, drawn under the lot, plus a small legend. Off by default; each layer is a switch in the Site panel (site.lot.layers.ov_*).
// Screen space patterns, so the hatch stays the same density at any zoom.

import { worldToScreen } from './math.js';
import { OVERLAY_STYLE, drawableLayers, overlayOn } from '../site/overlays.js';

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
  if (hatch === 'vert') { g.moveTo(6, 0); g.lineTo(6, 12); }
  if (hatch === 'diag2') { g.moveTo(-2, -2); g.lineTo(14, 14); }
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
  drawLegend(ctx, st, on);
  ctx.restore();
}

// A compact legend, bottom left, only for the switched-on layers: swatch, name and the "indicative" caution.
function drawLegend(ctx, st, on) {
  if (st.size.w < 420) return;
  const rowH = 17;
  const w = 232;
  const x = st.size.w - w - 14; // top right, under the north point and the Map data chip
  const h = on.length * rowH + 24;
  let y = 168;
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
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
}
