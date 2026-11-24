// Subdivision check: draw the lot and the rough layout over the aerial onto a canvas. Used for the screen preview and, at a higher size, for the
// one page PDF, so both look the same. Browser only (canvas). Plan millimetres in, pixels out.
//
// Conventions (JCE site plan drafting):
//   existing lot boundary      yellow, dashed
//   proposed lot boundaries    red, solid
//   surrounding cadastre       thin white, lot number and DP on separate lines (DP one size larger)
//   new road                   reserve outlined in red, verges inside the reserve (green), carriageway (grey), centreline red phantom line
// No pipe sizes, levels or other design numbers are drawn.

import { labelPoint } from './layout.js';

export const COLOURS = Object.freeze({ existing: '#ffd400', proposed: '#e5231b', cadastre: 'rgba(255,255,255,0.85)', verge: 'rgba(120,200,110,0.55)', carriage: 'rgba(70,72,78,0.78)' });
const PHANTOM = [18, 4, 4, 4, 4, 4]; // long dash, short dash, short dash (scaled by the line unit)

const bboxOf = (pts) => ({ x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) });

/** The view in plan mm for a canvas of the given aspect (w / h): the lot (and its layout) with a margin, widened to fit the aspect. */
export function viewFor(lot, layout, aspect, padFrac = 0.22) {
  const pts = [...lot.boundary, ...(layout?.road?.ring || []), ...(layout?.road?.head || [])];
  const b = bboxOf(pts);
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const pad = Math.max(12000, Math.max(w, h) * padFrac);
  let vw = w + 2 * pad;
  let vh = h + 2 * pad;
  if (vw / vh < aspect) vw = vh * aspect; else vh = vw / aspect;
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  return { x0: cx - vw / 2, y0: cy - vh / 2, w: vw, h: vh };
}

function path(ctx, ring, tf) {
  ring.forEach((p, i) => { const q = tf(p); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
  ctx.closePath();
}

function niceScale(mPerPx, targetPx) {
  const want = mPerPx * targetPx;
  const steps = [5, 10, 20, 25, 50, 100, 200, 500];
  return steps.reduce((b, s) => (Math.abs(s - want) < Math.abs(b - want) ? s : b), steps[0]);
}

function outlinedText(ctx, text, x, y, size, { weight = '700', fill = '#fff', stroke = 'rgba(0,0,0,0.85)', align = 'center' } = {}) {
  ctx.font = `${weight} ${size}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size * 0.22);
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/**
 * drawCheck(ctx, { lot, bitmap, layout, width, height, showLayout, legend })
 *   showLayout false draws the aerial and the existing boundary only. showLabels false leaves out the PROPOSED LOT labels and areas (the locked preview). `layout` is the result of layoutSubdivision.
 * Returns { mPerPx } for the caller.
 */
export function drawCheck(ctx, { lot, bitmap = null, layout = null, width, height, showLayout = true, showLabels = true, legend = true, attribution = '' }) {
  const view = viewFor(lot, layout, width / height);
  const sc = width / view.w; // px per mm
  const tf = (p) => ({ x: (p.x - view.x0) * sc, y: (p.y - view.y0) * sc });
  const k = width / 1000; // one design unit: 1000 across
  // ground
  ctx.fillStyle = '#2b3a2a';
  ctx.fillRect(0, 0, width, height);
  if (bitmap && lot.aerial?.extent) {
    const e = lot.aerial.extent;
    const a = tf({ x: e.x0, y: e.y0 });
    const b = tf({ x: e.x1, y: e.y1 });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, a.x, a.y, b.x - a.x, b.y - a.y);
  } else {
    ctx.fillStyle = '#d9ded5';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#6b7480';
    ctx.font = `${12 * k}px Arial, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText('Aerial not available', 12 * k, 22 * k);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  ctx.fillRect(0, 0, width, height);

  // surrounding cadastre (DCDB)
  ctx.save();
  ctx.lineWidth = Math.max(1, 1.1 * k);
  ctx.strokeStyle = COLOURS.cadastre;
  for (const n of lot.neighbours || []) {
    if (!n.ring?.length) continue;
    ctx.beginPath();
    path(ctx, n.ring, tf);
    ctx.stroke();
  }
  ctx.restore();
  for (const n of lot.neighbours || []) {
    if (n.isRoad || !n.ring?.length || !n.lotNumber) continue;
    const lp = labelPoint(n.ring.map(tf));
    const room = lp.d * 2;
    const size = Math.min(11 * k, room / 5.2);
    if (size < 5.5 * k * 0.7) continue;
    const q = { x: lp.x, y: lp.y };
    if (q.x < 0 || q.y < 0 || q.x > width || q.y > height) continue;
    outlinedText(ctx, `Lot ${n.lotNumber}`, q.x, q.y - size * 0.62, size * 0.9, { weight: '600', fill: 'rgba(255,255,255,0.95)' });
    if (n.planLabel) outlinedText(ctx, n.planLabel, q.x, q.y + size * 0.62, size * 1.1, { weight: '700', fill: 'rgba(255,255,255,0.95)' }); // DP one size larger
  }

  // proposed layout
  if (layout && showLayout) {
    const road = layout.road;
    if (road) {
      ctx.save();
      // reserve: verges inside it
      ctx.beginPath(); path(ctx, road.ring, tf); ctx.fillStyle = COLOURS.verge; ctx.fill();
      ctx.beginPath(); path(ctx, road.head, tf); ctx.fill();
      ctx.beginPath(); path(ctx, road.carriage, tf); ctx.fillStyle = COLOURS.carriage; ctx.fill();
      ctx.beginPath(); path(ctx, road.carriageHead, tf); ctx.fill();
      // reserve edges and turning head in red (proposed boundaries)
      ctx.strokeStyle = COLOURS.proposed; ctx.lineWidth = 2.4 * k; ctx.lineJoin = 'round';
      ctx.beginPath(); path(ctx, road.ring, tf); ctx.stroke();
      ctx.beginPath(); path(ctx, road.head, tf); ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.fillStyle = 'rgba(229,35,27,0.13)';
    ctx.strokeStyle = COLOURS.proposed;
    ctx.lineWidth = 3 * k;
    ctx.lineJoin = 'round';
    for (const l of layout.lots) {
      ctx.beginPath(); path(ctx, l.ring, tf); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
    if (road) { // the centreline sits on top, in red phantom line type
      ctx.save();
      ctx.setLineDash(PHANTOM.map((v) => v * k * 0.9));
      ctx.strokeStyle = '#ff2a1f'; ctx.lineWidth = 2 * k;
      const [a, b] = road.centre.map(tf);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.restore();
    }
    if (showLabels) for (const l of layout.lots) {
      const lp = labelPoint(l.ring.map(tf));
      const w = lp.d * 2 * 0.95; // clear width at the label point, px
      const one = w / 9.8;
      if (one >= 9 * k) {
        const size = Math.min(15 * k, one);
        outlinedText(ctx, `PROPOSED LOT ${l.n}`, lp.x, lp.y - size * 0.62, size, { fill: '#fff' });
        outlinedText(ctx, `${l.areaM2.toLocaleString('en-AU')} m\u00b2`, lp.x, lp.y + size * 0.72, size * 0.92, { weight: '600', fill: '#ffe9a8' });
      } else { // narrow lot: three short lines
        const size = Math.max(6.5 * k, Math.min(13 * k, w / 4.8));
        outlinedText(ctx, 'PROPOSED', lp.x, lp.y - size * 1.25, size, { fill: '#fff' });
        outlinedText(ctx, `LOT ${l.n}`, lp.x, lp.y, size, { fill: '#fff' });
        outlinedText(ctx, `${l.areaM2.toLocaleString('en-AU')} m\u00b2`, lp.x, lp.y + size * 1.25, size * 0.9, { weight: '600', fill: '#ffe9a8' });
      }
    }
  }

  // existing lot boundary on top (yellow dashed)
  ctx.save();
  ctx.setLineDash([12 * k, 7 * k]);
  ctx.strokeStyle = COLOURS.existing;
  ctx.lineWidth = 3.2 * k;
  ctx.beginPath(); path(ctx, lot.boundary, tf); ctx.stroke();
  ctx.restore();

  // north point and scale bar
  const mPerPx = 1 / (sc * 1000);
  const bar = niceScale(mPerPx, 140 * k);
  const barPx = bar / mPerPx;
  const bx = width - 18 * k - barPx;
  const by = height - 24 * k;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(bx - 10 * k, by - 20 * k, barPx + 20 * k, 40 * k);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.2 * k;
  ctx.beginPath(); ctx.moveTo(bx, by + 3 * k); ctx.lineTo(bx, by - 3 * k); ctx.moveTo(bx, by); ctx.lineTo(bx + barPx, by); ctx.moveTo(bx + barPx, by + 3 * k); ctx.lineTo(bx + barPx, by - 3 * k); ctx.stroke();
  ctx.restore();
  outlinedText(ctx, `${bar} m`, bx + barPx / 2, by - 11 * k, 10 * k, { weight: '600' });
  // north arrow (grid north is up)
  const nx = width - 34 * k; const ny = 44 * k;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(nx, ny, 24 * k, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(nx, ny - 17 * k); ctx.lineTo(nx + 8 * k, ny + 10 * k); ctx.lineTo(nx, ny + 5 * k); ctx.lineTo(nx - 8 * k, ny + 10 * k); ctx.closePath(); ctx.fill();
  ctx.restore();
  outlinedText(ctx, 'N', nx, ny + 1 * k, 9 * k, { weight: '700', stroke: 'rgba(0,0,0,0)' });

  if (legend) drawLegend(ctx, { x: 14 * k, y: height - 14 * k, k, layout, showLayout });
  if (attribution) {
    ctx.save();
    ctx.font = `${7.5 * k}px Arial, sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const w = ctx.measureText(attribution).width;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, w + 14 * k, 15 * k);
    ctx.fillStyle = '#fff'; ctx.fillText(attribution, 7 * k, 10.5 * k);
    ctx.restore();
  }
  return { mPerPx };
}

function drawLegend(ctx, { x, y, k, layout, showLayout }) {
  const rows = [['dash', COLOURS.existing, 'Existing lot boundary'], ['solid', COLOURS.proposed, 'Proposed lot boundaries (concept)'], ['thin', '#fff', 'Surrounding cadastre']];
  if (layout?.road && showLayout) { rows.push(['phantom', '#ff2a1f', 'New road centreline']); rows.push(['verge', COLOURS.verge, 'New road reserve with verges']); }
  const rowH = 15 * k;
  const w = 188 * k;
  const h = rows.length * rowH + 12 * k;
  ctx.save();
  ctx.fillStyle = 'rgba(10,14,20,0.72)';
  ctx.fillRect(x, y - h, w, h);
  rows.forEach(([kind, col, label], i) => {
    const cy = y - h + 6 * k + rowH * i + rowH / 2;
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2.4 * k; ctx.setLineDash([]);
    if (kind === 'dash') ctx.setLineDash([6 * k, 3.5 * k]);
    if (kind === 'phantom') ctx.setLineDash(PHANTOM.map((v) => v * k * 0.45));
    if (kind === 'thin') ctx.lineWidth = 1.2 * k;
    if (kind === 'verge') ctx.fillRect(x + 8 * k, cy - 4 * k, 26 * k, 8 * k);
    else { ctx.beginPath(); ctx.moveTo(x + 8 * k, cy); ctx.lineTo(x + 34 * k, cy); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.fillStyle = '#fff'; ctx.font = `${8.6 * k}px Arial, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 42 * k, cy);
  });
  ctx.restore();
}
