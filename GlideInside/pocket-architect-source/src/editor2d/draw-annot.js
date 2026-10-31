// Annotation layers: dimension strings, selection and hover outlines, grips, north arrow, scale bar.

import * as G from '../model/geometry.js';
import { worldToScreen, rectCorners, openingFrame, scaleBar } from './math.js';

export const fmtDim = (mm) => Math.round(mm).toLocaleString('en-AU');

function path(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

// Small label on a panel-coloured pill, anchored at a screen point.
export function drawTag(ctx, st, text, x, y, { colour = null, align = 'center', size = 11.5 } = {}) {
  ctx.save();
  ctx.font = `500 ${size}px ${st.theme.f.mono}`;
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 10;
  const x0 = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  ctx.fillStyle = st.theme.c.panel;
  ctx.globalAlpha = 0.92;
  ctx.beginPath();
  ctx.roundRect(x0, y - 9, w, 18, 4);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = st.theme.c.accentSoft;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = colour || st.theme.c.text;
  ctx.textAlign = 'left';
  ctx.fillText(text, x0 + 5, y + 0.5);
  ctx.restore();
}

// Dimension string between world points A and B, offset by a pixel vector.
export function drawDim(ctx, st, A, B, offPx, text, { colour = null } = {}) {
  const { view, theme } = st;
  const sA = worldToScreen(view, A);
  const sB = worldToScreen(view, B);
  const a2 = { x: sA.x + offPx.x, y: sA.y + offPx.y };
  const b2 = { x: sB.x + offPx.x, y: sB.y + offPx.y };
  const L = Math.hypot(b2.x - a2.x, b2.y - a2.y);
  if (L < 16) return;
  const ux = (b2.x - a2.x) / L;
  const uy = (b2.y - a2.y) / L;
  const c = colour || theme.c.dim;
  ctx.save();
  ctx.strokeStyle = c;
  ctx.fillStyle = c;
  ctx.lineWidth = 1;
  const oLen = Math.hypot(offPx.x, offPx.y) || 1;
  const ex = offPx.x / oLen;
  const ey = offPx.y / oLen;
  ctx.beginPath();
  for (const [s, p] of [[sA, a2], [sB, b2]]) {
    ctx.moveTo(s.x + ex * 4, s.y + ey * 4);
    ctx.lineTo(p.x + ex * 4, p.y + ey * 4);
  }
  ctx.moveTo(a2.x, a2.y);
  ctx.lineTo(b2.x, b2.y);
  const k = Math.SQRT1_2 * 5;
  for (const p of [a2, b2]) {
    ctx.moveTo(p.x - (ux - uy) * k, p.y - (uy + ux) * k);
    ctx.lineTo(p.x + (ux - uy) * k, p.y + (uy + ux) * k);
  }
  ctx.stroke();
  let ang = Math.atan2(uy, ux);
  if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
  ctx.translate((a2.x + b2.x) / 2, (a2.y + b2.y) / 2);
  ctx.rotate(ang);
  ctx.font = `500 11.5px ${theme.f.mono}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 8;
  if (w < L) {
    ctx.fillStyle = theme.c.canvas;
    ctx.fillRect(-w / 2, -8, w, 16);
    ctx.fillStyle = c;
    ctx.fillText(text, 0, 0.5);
  }
  ctx.restore();
}

// Overall exterior width (below the plan) and depth (right of the plan) of the active level.
export function drawOverallDims(ctx, st, scene) {
  const ext = scene.pieces.filter((p) => p.wall.kind === 'exterior');
  const pts = (ext.length ? ext : scene.pieces).flatMap((p) => p.poly);
  const bb = G.bbox(pts);
  if (!bb || bb.w < 500) return;
  drawDim(ctx, st, { x: bb.minX, y: bb.maxY }, { x: bb.maxX, y: bb.maxY }, { x: 0, y: 34 }, fmtDim(bb.w));
  if (bb.h >= 500) drawDim(ctx, st, { x: bb.maxX, y: bb.minY }, { x: bb.maxX, y: bb.maxY }, { x: 34, y: 0 }, fmtDim(bb.h));
}

// Outline of an element, used for hover and selection. Returns the traced screen points.
function shape(ctx, st, scene, hit) {
  const { view } = st;
  const it = hit.item;
  if (hit.kind === 'wall') {
    const d = G.wallDir(it);
    const n = G.wallNormal(it);
    const h = (it.thickness || 100) / 2;
    const pts = [
      { x: it.a.x + n.x * h - d.x * h, y: it.a.y + n.y * h - d.y * h },
      { x: it.b.x + n.x * h + d.x * h, y: it.b.y + n.y * h + d.y * h },
      { x: it.b.x - n.x * h + d.x * h, y: it.b.y - n.y * h + d.y * h },
      { x: it.a.x - n.x * h - d.x * h, y: it.a.y - n.y * h - d.y * h },
    ].map((p) => worldToScreen(view, p));
    path(ctx, pts);
    return pts;
  }
  if (hit.kind === 'opening') {
    const w = scene.wallById.get(it.wallId) || st.level.walls.find((x) => x.id === it.wallId);
    if (!w) return null;
    const f = openingFrame(w, it);
    const h = (w.thickness || 100) / 2 + 40;
    const pts = [f.at(f.u0, -h), f.at(f.u1, -h), f.at(f.u1, h), f.at(f.u0, h)].map((p) => worldToScreen(view, p));
    path(ctx, pts);
    return pts;
  }
  if (hit.kind === 'room') {
    const pts = it.polygon.map((p) => worldToScreen(view, p));
    path(ctx, pts);
    return pts;
  }
  if (hit.kind === 'furniture' || hit.kind === 'stair') {
    const s = hit.kind === 'stair' ? { w: it.width, d: it.length } : st.furnSize(it);
    const pts = rectCorners(it.x, it.y, s.w + 60, s.d + 60, it.rotation || 0).map((p) => worldToScreen(view, p));
    path(ctx, pts);
    return pts;
  }
  if (hit.kind === 'tank') {
    const c = worldToScreen(view, it);
    ctx.beginPath();
    ctx.arc(c.x, c.y, (it.diameter / 2) * view.scale + 3, 0, Math.PI * 2);
    return [c];
  }
  return null;
}

export function drawHover(ctx, st, scene, hit) {
  if (!hit) return;
  ctx.save();
  if (!shape(ctx, st, scene, hit)) {
    ctx.restore();
    return;
  }
  ctx.strokeStyle = st.theme.c.accent;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.25;
  ctx.stroke();
  ctx.restore();
}

export function drawGrips(ctx, st, points) {
  ctx.save();
  ctx.lineWidth = 1.5;
  for (const p of points) {
    const s = worldToScreen(st.view, p);
    ctx.fillStyle = st.theme.c.panel;
    ctx.strokeStyle = st.theme.c.accent;
    ctx.beginPath();
    ctx.rect(Math.round(s.x) - 4.5, Math.round(s.y) - 4.5, 9, 9);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

export function drawSelection(ctx, st, scene, hit) {
  if (!hit) return;
  const { theme } = st;
  ctx.save();
  const pts = shape(ctx, st, scene, hit);
  if (!pts) {
    ctx.restore();
    return;
  }
  ctx.fillStyle = theme.c.accentSoft;
  ctx.globalAlpha = hit.kind === 'room' ? 0.35 : 0.22;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = theme.c.accent;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  const it = hit.item;
  if (hit.kind === 'wall') {
    const L = G.wallLength(it);
    const n = G.wallNormal(it);
    const side = it.outside === 1 ? 1 : it.outside === -1 ? -1 : 1;
    // screen y is down like plan y, so the pixel offset follows the wall normal
    drawDim(ctx, st, it.a, it.b, { x: n.x * side * 26, y: n.y * side * 26 }, fmtDim(L), { colour: theme.c.accent });
    drawGrips(ctx, st, [it.a, it.b]);
  } else if (hit.kind === 'room') {
    const bb = G.bbox(it.polygon);
    drawDim(ctx, st, { x: bb.minX, y: bb.minY }, { x: bb.maxX, y: bb.minY }, { x: 0, y: -24 }, fmtDim(bb.w), { colour: theme.c.accent });
    drawDim(ctx, st, { x: bb.minX, y: bb.minY }, { x: bb.minX, y: bb.maxY }, { x: -24, y: 0 }, fmtDim(bb.h), { colour: theme.c.accent });
  } else if (hit.kind === 'opening') {
    const w = scene.wallById.get(it.wallId);
    if (w) {
      const f = openingFrame(w, it);
      const n = f.n;
      drawDim(ctx, st, f.at(f.u0), f.at(f.u1), { x: n.x * 30, y: n.y * 30 }, fmtDim(it.width), { colour: theme.c.accent });
    }
  }
}

// North arrow and scale bar (screen-fixed) ---------------------------------------------------------
export function drawNorthArrow(ctx, st) {
  const { size, theme } = st;
  if (size.w < 340) return;
  // Sits in the corner that the fit padding keeps free, so it never lands on the plan or its dimension lines.
  const cx = size.w - 32;
  const cy = 40;
  const r = 16;
  const rot = ((st.project.site?.northDeg || 0) * Math.PI) / 180;
  ctx.save();
  ctx.strokeStyle = theme.c.dim;
  ctx.fillStyle = theme.c.dim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(0, -r + 2);
  ctx.lineTo(-6.5, 8);
  ctx.lineTo(0, 3.5);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, -r + 2);
  ctx.lineTo(6.5, 8);
  ctx.lineTo(0, 3.5);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.font = `600 11px ${theme.f.label}`;
  ctx.fillStyle = theme.c.dim;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', cx + Math.sin(rot) * (r + 9), cy - Math.cos(rot) * (r + 9));
  ctx.restore();
}

// Graduated bar: alternating black and white segments, labels in metres at each division, a round length for the zoom.
export function scaleBarLayout(scale, targetPx = 160) {
  const { mm, px } = scaleBar(scale, targetPx);
  const lead = Number(String(mm).replace(/0+$/, '')) || 1; // 1, 2 or 5 (the leading digit of the round length)
  let segs = lead === 5 ? 5 : lead === 2 ? 4 : 2;
  while (segs > 2 && px / segs < 20) segs = Math.max(2, segs === 4 ? 2 : segs - 1);
  const fmt = (v) => {
    const m = v / 1000;
    return String(Math.round(m * 1000) / 1000);
  };
  const stops = Array.from({ length: segs + 1 }, (_, i) => ({ x: (px * i) / segs, label: fmt((mm * i) / segs) }));
  return { mm, px, segs, stops, unit: 'm' };
}

export function drawScaleBar(ctx, st) {
  const { size, theme, view } = st;
  if (size.w < 260) return;
  const { px, segs, stops } = scaleBarLayout(view.scale);
  const x = 18;
  const y = size.h - 24;
  const barH = 6;
  ctx.save();
  ctx.lineWidth = 1;
  for (let i = 0; i < segs; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#1a1d21' : '#ffffff';
    ctx.fillRect(x + (px * i) / segs, y - barH, px / segs, barH);
  }
  ctx.strokeStyle = '#1a1d21';
  ctx.strokeRect(x + 0.5, y - barH + 0.5, px, barH);
  ctx.strokeStyle = theme.c.dim;
  ctx.globalAlpha = 0.5;
  ctx.strokeRect(x - 0.5, y - barH - 0.5, px + 2, barH + 2);
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.c.dim;
  ctx.font = `500 10.5px ${theme.f.mono}`;
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'center';
  stops.forEach((s, i) => {
    ctx.textAlign = i === 0 ? 'left' : i === stops.length - 1 ? 'right' : 'center';
    const tx = x + s.x + (i === 0 ? -1 : i === stops.length - 1 ? 1 : 0);
    ctx.fillText(i === stops.length - 1 ? `${s.label} m` : s.label, tx, y - barH - 4);
  });
  ctx.restore();
}
