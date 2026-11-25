// Plan symbols: openings, stairs, furniture and tanks.

import { stairLayout, isShaped } from '../model/stair-geom.js';
import { worldToScreen, openingFrame, doorGeometry, toWorld, drawStatus, furnitureSize } from './math.js';

const strokeFor = (theme, status) => (status === 'demolish' ? theme.c.demolish : status === 'existing' ? theme.c.lineSoft : theme.c.line);

function polyPath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

// Draw one opening symbol. `tint` overrides the stroke colour (used by placement ghosts).
export function drawOpeningSymbol(ctx, view, theme, wall, o, { status = 'new', tint = null } = {}) {
  const f = openingFrame(wall, o);
  const t = wall.thickness || 100;
  const h = t / 2;
  const P = (u, v = 0) => worldToScreen(view, f.at(u, v));
  const colour = tint || strokeFor(theme, status);
  const { u0, u1 } = f;
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = theme.c.canvas;
  ctx.lineWidth = 1.2;
  ctx.lineJoin = 'round';
  if (status === 'demolish') ctx.setLineDash([5, 3]);
  const line = (a, b) => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };
  const box = (a0, a1, v0, v1) => {
    polyPath(ctx, [P(a0, v0), P(a1, v0), P(a1, v1), P(a0, v1)]);
    ctx.fill();
    ctx.stroke();
  };
  line(P(u0, -h), P(u0, h));
  line(P(u1, -h), P(u1, h));
  const span = o.width;
  switch (o.kind) {
    case 'window': {
      line(P(u0, -h), P(u1, -h));
      line(P(u0, h), P(u1, h));
      if (o.style === 'sliding') {
        const sw = span * 0.56;
        box(u0, u0 + sw, -t * 0.34, -t * 0.04);
        box(u1 - sw, u1, t * 0.04, t * 0.34);
      } else if (o.style === 'fixed') {
        line(P(u0, -t * 0.09), P(u1, -t * 0.09));
        line(P(u0, t * 0.09), P(u1, t * 0.09));
      } else {
        line(P(u0, 0), P(u1, 0));
      }
      break;
    }
    case 'door': {
      const g = doorGeometry(wall, o);
      const hs = worldToScreen(view, g.hinge);
      const tip = worldToScreen(view, g.openTip);
      ctx.save();
      ctx.lineWidth = Math.max(2, 40 * view.scale);
      line(hs, tip);
      ctx.restore();
      ctx.save();
      ctx.lineWidth = 0.9;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(hs.x, hs.y, o.width * view.scale, g.a0, g.a1, g.anticlockwise);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'sliding_door': {
      const pw = span * 0.55;
      box(u0, u0 + pw, -t * 0.34, -t * 0.04);
      box(u1 - pw, u1, t * 0.04, t * 0.34);
      break;
    }
    case 'garage_door':
    case 'roller_door': {
      ctx.setLineDash(o.kind === 'garage_door' ? [9, 5] : [3, 4]);
      ctx.lineWidth = 1.5;
      line(P(u0, 0), P(u1, 0));
      break;
    }
    default:
      break; // plain opening: jambs only
  }
  ctx.restore();
}

export function drawOpenings(ctx, st, scene) {
  for (const o of scene.openings) {
    const wall = scene.wallById.get(o.wallId);
    if (!wall) continue;
    drawOpeningSymbol(ctx, st.view, st.theme, wall, o, { status: drawStatus(o.status, st.statusView) });
  }
}

// Stairs ---------------------------------------------------------------------------------------------
// An L or U stair: an outline for each flight and the landing, a line at every nosing, the walking line with its arrow and UP.
function drawShapedStairSymbol(ctx, view, theme, s, alpha, label) {
  const L = stairLayout(s);
  const S = (p) => worldToScreen(view, p);
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const o of L.outlines) {
    polyPath(ctx, o.map(S));
    ctx.fillStyle = theme.c.canvas;
    ctx.fill();
    ctx.strokeStyle = theme.c.line;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  ctx.strokeStyle = theme.c.lineSoft;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const t of L.treads) {
    if (!t.nose) continue;
    const a = S(t.nose[0]);
    const b = S(t.nose[1]);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  // walking line with an arrow head at the top
  const pts = L.walk.map(S);
  ctx.strokeStyle = theme.c.line;
  ctx.fillStyle = theme.c.line;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
  ctx.stroke();
  const tip = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const d = Math.hypot(tip.x - prev.x, tip.y - prev.y) || 1;
  const ux = (tip.x - prev.x) / d;
  const uy = (tip.y - prev.y) / d;
  const hs = Math.max(5, Math.min(11, view.scale * L.width * 0.2));
  polyPath(ctx, [tip, { x: tip.x - ux * hs * 1.5 - uy * hs, y: tip.y - uy * hs * 1.5 + ux * hs }, { x: tip.x - ux * hs * 1.5 + uy * hs, y: tip.y - uy * hs * 1.5 - ux * hs }]);
  ctx.fill();
  const lp = S(L.walk[0]);
  if (view.scale * s.width > 26) {
    ctx.font = `600 10px ${theme.f.label}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width + 6;
    ctx.fillStyle = theme.c.canvas;
    ctx.fillRect(lp.x - tw / 2, lp.y - 6, tw, 12);
    ctx.fillStyle = theme.c.text;
    ctx.fillText(label, lp.x, lp.y + 0.5);
  }
  ctx.restore();
}

// A floor void: dashed outline with the corner to corner cross of a stair well, and VOID in the middle.
export function drawVoidSymbol(ctx, view, theme, v, { alpha = 1 } = {}) {
  if (!v.polygon || v.polygon.length < 3) return;
  const pts = v.polygon.map((p) => worldToScreen(view, p));
  ctx.save();
  ctx.globalAlpha = alpha;
  polyPath(ctx, pts);
  ctx.fillStyle = theme.c.canvas;
  ctx.fill();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = theme.c.line;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.save();
  polyPath(ctx, pts);
  ctx.clip();
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  ctx.strokeStyle = theme.c.lineSoft;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = -(y1 - y0); k < x1 - x0; k += 14) { ctx.moveTo(x0 + k, y1); ctx.lineTo(x0 + k + (y1 - y0), y0); }
  ctx.stroke();
  ctx.restore();
  if ((x1 - x0) > 50 && (y1 - y0) > 22) {
    ctx.font = `600 10px ${theme.f.label}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const tw = ctx.measureText('VOID').width + 6;
    ctx.fillStyle = theme.c.canvas;
    ctx.fillRect(cx - tw / 2, cy - 6, tw, 12);
    ctx.fillStyle = theme.c.text;
    ctx.fillText('VOID', cx, cy + 0.5);
  }
  ctx.restore();
}

export function drawStairSymbol(ctx, view, theme, s, { alpha = 1, label = 'UP' } = {}) {
  if (isShaped(s)) { drawShapedStairSymbol(ctx, view, theme, s, alpha, label); return; }
  const rot = s.rotation || 0;
  const hw = s.width / 2;
  const hl = s.length / 2;
  const W = (x, y) => worldToScreen(view, toWorld({ x, y }, s.x, s.y, rot));
  ctx.save();
  ctx.globalAlpha = alpha;
  polyPath(ctx, [W(-hw, -hl), W(hw, -hl), W(hw, hl), W(-hw, hl)]);
  ctx.fillStyle = theme.c.canvas;
  ctx.fill();
  ctx.strokeStyle = theme.c.line;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  const n = Math.max(3, Math.round(s.length / 250));
  ctx.strokeStyle = theme.c.lineSoft;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < n; i++) {
    const y = -hl + (i * s.length) / n;
    const a = W(-hw, y);
    const b = W(hw, y);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  // arrow up the run (local -y to +y)
  const y0 = -hl + s.length * 0.2;
  const y1 = hl - s.length * 0.08;
  const head = Math.min(s.width * 0.28, s.length * 0.12);
  ctx.strokeStyle = theme.c.line;
  ctx.fillStyle = theme.c.line;
  ctx.lineWidth = 1.3;
  const a = W(0, y0);
  const b = W(0, y1);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  const h1 = W(-head, y1 - head * 1.5);
  const h2 = W(head, y1 - head * 1.5);
  polyPath(ctx, [b, h1, h2]);
  ctx.fill();
  // label
  const lab = W(0, -hl + s.length * 0.1);
  const bbw = Math.abs(W(hw, 0).x - W(-hw, 0).x) + Math.abs(W(hw, 0).y - W(-hw, 0).y);
  if (view.scale * Math.min(s.width, s.length) > 26) {
    ctx.font = `600 10px ${theme.f.label}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width + 6;
    if (bbw > tw) {
      ctx.fillStyle = theme.c.canvas;
      ctx.fillRect(lab.x - tw / 2, lab.y - 6, tw, 12);
      ctx.fillStyle = theme.c.text;
      ctx.fillText(label, lab.x, lab.y + 0.5);
    }
  }
  ctx.restore();
}

export function drawStairs(ctx, st, level, below = null) {
  for (const v of level.voids || []) drawVoidSymbol(ctx, st.view, st.theme, v);
  // the stair of the level below, where it arrives on this floor (L and U stairs only, so the top flight and the void read together)
  for (const s of below?.stairs || []) if (isShaped(s)) drawStairSymbol(ctx, st.view, st.theme, s, { alpha: 0.55, label: 'DN' });
  for (const s of level.stairs) drawStairSymbol(ctx, st.view, st.theme, s);
}

// Furniture ---------------------------------------------------------------------------------------------
const warned = new Set();
export function drawFurnitureSymbol(ctx, view, theme, def, f, { alpha = 1, tint = null } = {}) {
  const { w, d } = furnitureSize(f, def);
  const c = worldToScreen(view, f);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(c.x, c.y);
  ctx.rotate(((f.rotation || 0) * Math.PI) / 180);
  ctx.scale(view.scale, view.scale);
  ctx.strokeStyle = tint || theme.c.line;
  ctx.fillStyle = theme.c.canvas;
  ctx.lineWidth = 1.3 / view.scale;
  ctx.lineJoin = 'round';
  let ok = false;
  if (def && typeof def.draw2d === 'function') {
    try {
      def.draw2d(ctx, w, d);
      ok = true;
    } catch (e) {
      if (!warned.has(f.item)) {
        warned.add(f.item);
        console.warn(`[plan] draw2d failed for ${f.item}`, e);
      }
    }
  }
  if (!ok) {
    ctx.beginPath();
    ctx.rect(-w / 2, -d / 2, w, d);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
  if (!ok) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = theme.c.muted;
    ctx.font = `500 10px ${theme.f.ui}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (Math.min(w, d) * view.scale > 22) ctx.fillText(def?.name || f.item, c.x, c.y);
    ctx.restore();
  }
}

// Red outline and tint over an item that clips a wall.
export function drawClashOverlay(ctx, view, theme, def, f) {
  const { w, d } = furnitureSize(f, def);
  const c = worldToScreen(view, f);
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(((f.rotation || 0) * Math.PI) / 180);
  ctx.scale(view.scale, view.scale);
  ctx.beginPath();
  ctx.rect(-w / 2, -d / 2, w, d);
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = theme.c.danger;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2 / view.scale;
  ctx.strokeStyle = theme.c.danger;
  ctx.stroke();
  ctx.restore();
}

// `clashes` is an optional Set of furniture ids that clip a wall.
export function drawFurniture(ctx, st, level, catalogue, clashes = null) {
  for (const f of level.furniture) {
    const def = catalogue?.getFurniture?.(f.item);
    const bad = clashes?.has(f.id);
    drawFurnitureSymbol(ctx, st.view, st.theme, def, f, bad ? { tint: st.theme.c.danger } : {});
    if (bad) drawClashOverlay(ctx, st.view, st.theme, def, f);
  }
}

// Tanks ----------------------------------------------------------------------------------------------------
export function tankLabel(t) {
  return `RWT ${Number(t.capacityL).toLocaleString('en-AU')} L`;
}
export function drawTank(ctx, st, t, { alpha = 1, tint = null } = {}) {
  const { view, theme } = st;
  const c = worldToScreen(view, t);
  const r = (t.diameter / 2) * view.scale;
  const status = drawStatus(t.status, st.statusView);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = theme.c.canvas;
  ctx.strokeStyle = tint || strokeFor(theme, status);
  ctx.lineWidth = 1.5;
  if (status === 'demolish') ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
  ctx.globalAlpha = alpha * 0.6;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r * 0.8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = theme.c.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (r > 26) {
    ctx.font = `500 10.5px ${theme.f.mono}`;
    ctx.fillText(tankLabel(t), c.x, c.y);
  } else if (r > 11) {
    ctx.font = `600 9px ${theme.f.mono}`;
    ctx.fillText('RWT', c.x, c.y);
  }
  ctx.restore();
}

// `tanks` are already filtered for the status view; ghost draws them faintly on upper levels.
export function drawTanks(ctx, st, tanks, { ghost = false } = {}) {
  for (const t of tanks) drawTank(ctx, st, t, { alpha: ghost ? 0.3 : 1 });
}
