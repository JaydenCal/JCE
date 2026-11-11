// Site layers drawn under the plan when the project has a lot (site.lot): contours, neighbouring lots, the lot boundary,
// boundary lengths and lot labels. Screen space drawing so lines and text stay crisp at any zoom.
// Each layer can be turned off in the panel (site.lot.layers). Nothing here is selectable or editable.

import { worldToScreen } from './math.js';
import { boundaryEdges } from '../site/model.js';
import { ringCentroid, signedArea } from '../site/geo.js';
import { siteCredits } from '../site/credits.js';
import { boundaryDims, lotLabelLines, buildingHull } from '../site/lotplan.js';
import { drawLotPlan } from './draw-lotplan.js';

const BOUNDARY = '#d62828'; // red, so the lot reads clearly over an aerial and is never mistaken for proposed work
const CONTOUR_MINOR = 'rgba(150,102,48,0.6)';
const CONTOUR_MAJOR = 'rgba(128,78,22,0.95)';

export const layerOn = (lot, id) => !!lot && lot.layers?.[id] !== false;

const toScreen = (view, p) => worldToScreen(view, p);

function tracePoly(ctx, view, ring) {
  ring.forEach((p, i) => {
    const s = toScreen(view, p);
    if (i) ctx.lineTo(s.x, s.y);
    else ctx.moveTo(s.x, s.y);
  });
  ctx.closePath();
}

function halo(ctx, text, x, y, theme) {
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = theme.c.canvas;
  ctx.globalAlpha = 0.85;
  ctx.strokeText(text, x, y);
  ctx.globalAlpha = 1;
  ctx.fillText(text, x, y);
}

// A thin, light halo for the many neighbour labels: readable over the aerial without a heavy blurred smudge round each one.
function softHalo(ctx, text, x, y, theme, dark = false) {
  ctx.lineWidth = dark ? 2.4 : 2;
  ctx.strokeStyle = dark ? 'rgba(18,22,28,0.8)' : theme.c.canvas;
  ctx.globalAlpha = dark ? 0.7 : 0.55;
  ctx.strokeText(text, x, y);
  ctx.globalAlpha = 1;
  ctx.fillText(text, x, y);
}

export function drawContours(ctx, st) {
  const lot = st.project.site?.lot;
  if (!layerOn(lot, 'contours') || !lot.contours?.length) return;
  const { view, size } = st;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const labels = [];
  for (const major of [false, true]) {
    ctx.beginPath();
    ctx.strokeStyle = major ? CONTOUR_MAJOR : CONTOUR_MINOR;
    ctx.lineWidth = major ? 1.5 : 0.7;
    for (const c of lot.contours) {
      if (c.major !== major) continue;
      const pts = c.pts;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < pts.length; i += 2) {
        const sx = pts[i] * view.scale + view.ox;
        const sy = pts[i + 1] * view.scale + view.oy;
        if (sx < minX) minX = sx;
        if (sx > maxX) maxX = sx;
        if (sy < minY) minY = sy;
        if (sy > maxY) maxY = sy;
      }
      if (maxX < 0 || minX > size.w || maxY < 0 || minY > size.h) continue;
      for (let i = 0; i < pts.length; i += 2) {
        const sx = pts[i] * view.scale + view.ox;
        const sy = pts[i + 1] * view.scale + view.oy;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      if (c.closed) ctx.closePath();
      if (major && pts.length >= 8) {
        // label at the middle vertex, turned along the line and kept upright
        const k = Math.floor(pts.length / 4) * 2;
        const a = { x: pts[Math.max(0, k - 2)] * view.scale + view.ox, y: pts[Math.max(0, k - 1)] * view.scale + view.oy };
        const b = { x: pts[Math.min(pts.length - 2, k + 2)] * view.scale + view.ox, y: pts[Math.min(pts.length - 1, k + 3)] * view.scale + view.oy };
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len > 6) labels.push({ x: pts[k] * view.scale + view.ox, y: pts[k + 1] * view.scale + view.oy, ang: Math.atan2(b.y - a.y, b.x - a.x), text: c.level.toFixed(1) });
      }
    }
    ctx.stroke();
  }
  ctx.font = `600 10.5px ${st.theme.f.ui}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = CONTOUR_MAJOR;
  for (const l of labels) {
    if (l.x < 10 || l.y < 10 || l.x > size.w - 10 || l.y > size.h - 10) continue;
    let ang = l.ang;
    if (ang > Math.PI / 2) ang -= Math.PI;
    if (ang < -Math.PI / 2) ang += Math.PI;
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.rotate(ang);
    halo(ctx, l.text, 0, 0, st.theme);
    ctx.restore();
  }
  ctx.restore();
}

// Neighbouring lots (thin) with the lot number and, on its own line, the plan (DP) in a larger size.
export function drawNeighbours(ctx, st) {
  const lot = st.project.site?.lot;
  if (!layerOn(lot, 'neighbours') || !lot.neighbours?.length) return;
  const { view, theme } = st;
  const overAerial = layerOn(lot, 'aerial') && !!st.underlayBitmap;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1;
  ctx.strokeStyle = overAerial ? 'rgba(255,236,170,0.95)' : theme.c.lineSoft;
  ctx.beginPath();
  for (const n of lot.neighbours) tracePoly(ctx, view, n.ring);
  ctx.stroke();
  if (layerOn(lot, 'labels')) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = overAerial ? '#ffffff' : theme.c.muted;
    for (const n of lot.neighbours) {
      const xs = n.ring.map((p) => p.x * view.scale + view.ox);
      const ys = n.ring.map((p) => p.y * view.scale + view.oy);
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      if (w < 44 || h < 34) continue;
      const c = ringCentroid(n.ring.map((p) => [p.x, p.y]));
      const s = toScreen(view, { x: c[0], y: c[1] });
      const lotSize = 11;
      ctx.font = `500 ${lotSize}px ${theme.f.ui}`;
      softHalo(ctx, n.lotNumber ? `Lot ${n.lotNumber}` : '', s.x, s.y - 7, theme, overAerial);
      ctx.font = `600 ${lotSize + 1}px ${theme.f.ui}`; // DP one size larger
      softHalo(ctx, n.planLabel || '', s.x, s.y + 7, theme, overAerial);
    }
  }
  ctx.restore();
}

// The lot itself: faint fill, bold boundary, lengths, and its own label.
export function drawLot(ctx, st) {
  const lot = st.project.site?.lot;
  if (!layerOn(lot, 'boundary') || !lot.boundary?.length) return;
  const { view, theme } = st;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.beginPath();
  tracePoly(ctx, view, lot.boundary);
  for (const h of lot.holes || []) tracePoly(ctx, view, h);
  ctx.fillStyle = 'rgba(214,40,40,0.07)';
  ctx.fill('evenodd');
  ctx.strokeStyle = BOUNDARY;
  ctx.lineWidth = 2.6;
  ctx.stroke();

  // Street frontage: the confirmed front edges in blue, with the edge numbers while the person is confirming them.
  const front = new Set(lot.frontEdges || []);
  const editing = !!st.frontageEdit;
  if (front.size || editing) {
    const edges = boundaryEdges(lot);
    ctx.lineCap = 'round';
    edges.forEach((e, i) => {
      const a = toScreen(view, e.a);
      const b = toScreen(view, e.b);
      const isFront = front.has(i);
      if (isFront) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = theme.c.accent;
        ctx.lineWidth = 5;
        ctx.stroke();
      }
      if (editing) {
        const m = toScreen(view, e.mid);
        ctx.beginPath();
        ctx.arc(m.x, m.y, 11, 0, Math.PI * 2);
        ctx.fillStyle = isFront ? theme.c.accent : theme.c.canvas;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = isFront ? theme.c.accent : BOUNDARY;
        ctx.stroke();
        ctx.fillStyle = isFront ? '#fff' : BOUNDARY;
        ctx.font = `700 11px ${theme.f.ui}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(isFront ? 'F' : String(i + 1), m.x, m.y + 0.5);
      }
    });
  }

  if (layerOn(lot, 'dimensions')) {
    const area = signedArea(lot.boundary.map((p) => [p.x, p.y]));
    ctx.font = `600 11.5px ${theme.f.ui}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = BOUNDARY;
    const bearings = boundaryDims(lot);
    for (const [ei, e] of boundaryEdges(lot).entries()) {
      const a = toScreen(view, e.a);
      const b = toScreen(view, e.b);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 56) continue;
      let ang = Math.atan2(b.y - a.y, b.x - a.x);
      // Outside of the lot: with y down and a positive signed area (counter clockwise on screen terms) the outside is to the right of travel.
      const dirSign = area > 0 ? 1 : -1;
      const nx = -Math.sin(ang) * dirSign;
      const ny = Math.cos(ang) * dirSign;
      const m = toScreen(view, e.mid);
      const x = m.x + nx * 13;
      const y = m.y + ny * 13;
      if (ang > Math.PI / 2) ang -= Math.PI;
      if (ang < -Math.PI / 2) ang += Math.PI;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      // Survey style: bearing then distance. The bearing is dropped when the edge is too short on screen for both.
      const bd = bearings[ei];
      halo(ctx, bd && len > 100 ? `${bd.bearing}  ${e.label} m` : `${e.label} m`, 0, 0, theme);
      ctx.restore();
    }
  }

  if (layerOn(lot, 'labels')) {
    const c = ringCentroid(lot.boundary.map((p) => [p.x, p.y]));
    let s = toScreen(view, { x: c[0], y: c[1] });
    // Keep the label block clear of the house (walls and room text): take the first spot over the lot, nearest the centre, that
    // misses the house outline; if none, put the block just below the lot.
    const hull = buildingHull(st.project).map((p) => toScreen(view, p));
    if (hull.length > 2) {
      const sb = lot.boundary.map((p) => toScreen(view, p));
      const xs = sb.map((p) => p.x); const ys = sb.map((p) => p.y);
      const hx = hull.map((p) => p.x); const hy = hull.map((p) => p.y);
      const hb = { x0: Math.min(...hx) - 8, x1: Math.max(...hx) + 8, y0: Math.min(...hy) - 8, y1: Math.max(...hy) + 8 };
      const inside = (q) => { let o = false; for (let i = 0, j = sb.length - 1; i < sb.length; j = i++) { if ((sb[i].y > q.y) !== (sb[j].y > q.y) && q.x < ((sb[j].x - sb[i].x) * (q.y - sb[i].y)) / (sb[j].y - sb[i].y) + sb[i].x) o = !o; } return o; };
      const W = 44; const H = 34;
      const cands = [];
      for (let fx = 0.08; fx <= 0.92; fx += 0.12) for (let fy = 0.06; fy <= 0.94; fy += 0.08) cands.push({ x: Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * fx, y: Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * fy });
      cands.sort((p, q) => Math.hypot(p.x - s.x, p.y - s.y) - Math.hypot(q.x - s.x, q.y - s.y));
      const ok = cands.find((q) => [[-W, -H], [W, -H], [W, H], [-W, H]].every(([dx, dy]) => inside({ x: q.x + dx, y: q.y + dy })) && (q.x + W < hb.x0 || q.x - W > hb.x1 || q.y + H < hb.y0 || q.y - H > hb.y1));
      s = ok || { x: s.x, y: Math.max(...ys) + 26 };
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = BOUNDARY;
    ctx.font = `500 12px ${theme.f.ui}`;
    const names = lotLabelLines(lot);
    halo(ctx, names.proposed ? names.first : lot.lotNumber ? `Lot ${lot.lotNumber}` : '', s.x, s.y - 9, theme);
    ctx.font = `600 13px ${theme.f.ui}`;
    halo(ctx, names.second, s.x, s.y + 6, theme);
    ctx.font = `500 11px ${theme.f.ui}`;
    halo(ctx, `${Math.round(lot.areaM2).toLocaleString('en-AU')} m²`, s.x, s.y + 21, theme);
  }
  ctx.restore();
}

// Attribution and contour accuracy, small, bottom right. Required wherever the data is shown.
export function drawCredits(ctx, st) {
  // The credit is a small "Map data" chip in the stage now (src/ui/stage-ui.js createMapCredit); canvas export keeps the full text.
  if (!st.printCredits) return;
  const lot = st.project.site?.lot;
  if (!lot || st.size.w < 520) return;
  const lines = siteCredits(lot).filter((c) => c.id !== 'zoning' && c.id !== 'setbacks' && (c.id !== 'aerial' || layerOn(lot, 'aerial')) && (c.id !== 'contours' || layerOn(lot, 'contours')));
  if (!lines.length) return;
  ctx.save();
  ctx.font = `10px ${st.theme.f.ui}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = st.theme.c.muted;
  const maxW = Math.min(st.size.w - 40, 560);
  let y = st.size.h - 10;
  for (const c of lines.slice().reverse()) {
    // wrap to maxW
    const words = c.text.split(' ');
    const rows = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(t).width > maxW && cur) {
        rows.push(cur);
        cur = w;
      } else cur = t;
    }
    rows.push(cur);
    for (const r of rows.reverse()) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = st.theme.c.canvas;
      ctx.strokeText(r, st.size.w - 12, y);
      ctx.fillText(r, st.size.w - 12, y);
      y -= 12;
    }
  }
  ctx.restore();
}

// All site layers in drawing order (called after the aerial underlay, before the plan).
export function drawSite(ctx, st) {
  if (!st.project.site?.lot) return;
  drawContours(ctx, st);
  drawNeighbours(ctx, st);
  drawLot(ctx, st);
  // Road, setback envelope (status coloured, edge labelled) and driveway come from the lot planner layers.
  drawLotPlan(ctx, st);
}
