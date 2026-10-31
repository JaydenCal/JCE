// Base plan layers: scene geometry, grid, underlay, ghost level, room fills and labels, wall poché.
// Everything is drawn in screen space (CSS px) so line widths and text stay crisp at any zoom.

import * as G from '../model/geometry.js';
import { worldToScreen, screenToWorld, gridSpec, statusVisible, drawStatus } from './math.js';
import { roomTint } from './theme.js';
import { ROOM_LABELS } from '../model/schema.js';

// Scene --------------------------------------------------------------------------------------
// Wall pieces (walls with opening gaps cut out and corner joins filled), keyed to the status view.
export function buildScene(project, level, statusView) {
  const vis = (s) => statusVisible(s, statusView);
  const walls = level.walls.filter((w) => vis(w.status) && G.wallLength(w) > 1);
  const wallById = new Map(walls.map((w) => [w.id, w]));
  const openings = level.openings.filter((o) => vis(o.status) && wallById.has(o.wallId));
  const byWall = new Map();
  for (const o of openings) {
    if (!byWall.has(o.wallId)) byWall.set(o.wallId, []);
    byWall.get(o.wallId).push(o);
  }
  const endExt = (w, end) => {
    let ext = 0;
    for (const o of walls) {
      if (o === w) continue;
      if (G.samePoint(o.a, w[end]) || G.samePoint(o.b, w[end])) ext = Math.max(ext, (o.thickness || 100) / 2);
    }
    return ext;
  };
  const pieces = [];
  for (const w of walls) {
    const L = G.wallLength(w);
    const d = G.wallDir(w);
    const n = G.wallNormal(w);
    const t = w.thickness || 100;
    const e0 = endExt(w, 'a');
    const e1 = endExt(w, 'b');
    const at = (u, v) => ({ x: w.a.x + d.x * u + n.x * v, y: w.a.y + d.y * u + n.y * v });
    const cuts = (byWall.get(w.id) || []).map((o) => [o.offset - o.width / 2, o.offset + o.width / 2]).sort((p, q) => p[0] - q[0]);
    const solids = [];
    let cur = 0;
    for (const [s0, s1] of cuts) {
      if (s0 > cur) solids.push([cur, s0]);
      cur = Math.max(cur, s1);
    }
    if (cur < L) solids.push([cur, L]);
    for (const [s0, s1] of solids) {
      const u0 = s0 <= 0 ? -e0 : s0;
      const u1 = s1 >= L ? L + e1 : s1;
      pieces.push({ wall: w, status: drawStatus(w.status, statusView), poly: [at(u0, -t / 2), at(u1, -t / 2), at(u1, t / 2), at(u0, t / 2)] });
    }
  }
  const rooms = level.rooms.filter((r) => vis(r.status));
  return { walls, wallById, openings, pieces, rooms };
}

export const toScreenPoly = (view, poly) => poly.map((p) => worldToScreen(view, p));
function tracePoly(ctx, pts) {
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

// Grid ----------------------------------------------------------------------------------------
export function drawGrid(ctx, st) {
  const { view, size, theme } = st;
  const { minor, major } = gridSpec(view.scale, st.project.settings?.gridMm || 100);
  const tl = screenToWorld(view, { x: 0, y: 0 });
  const br = screenToWorld(view, { x: size.w, y: size.h });
  const lines = (step, colour) => {
    ctx.strokeStyle = colour;
    ctx.beginPath();
    for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
      if (step === minor && x % major === 0) continue;
      const sx = Math.round(x * view.scale + view.ox) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, size.h);
    }
    for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step) {
      if (step === minor && y % major === 0) continue;
      const sy = Math.round(y * view.scale + view.oy) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(size.w, sy);
    }
    ctx.stroke();
  };
  ctx.lineWidth = 1;
  lines(minor, theme.c.gridMinor);
  lines(major, theme.c.gridMajor);
  // origin cross
  const o = worldToScreen(view, { x: 0, y: 0 });
  if (o.x > -20 && o.x < size.w + 20 && o.y > -20 && o.y < size.h + 20) {
    ctx.strokeStyle = theme.c.gridMajor;
    ctx.beginPath();
    ctx.moveTo(o.x - 9, o.y);
    ctx.lineTo(o.x + 9, o.y);
    ctx.moveTo(o.x, o.y - 9);
    ctx.lineTo(o.x, o.y + 9);
    ctx.stroke();
  }
}

// Underlay -----------------------------------------------------------------------------------------
export function drawUnderlay(ctx, st) {
  const u = st.project.site?.underlay;
  const bmp = st.underlayBitmap;
  if (!u || !bmp) return;
  const c = worldToScreen(st.view, u);
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(((u.rotation || 0) * Math.PI) / 180);
  const k = st.view.scale * u.mmPerPx;
  ctx.scale(k, k);
  ctx.globalAlpha = Math.min(1, Math.max(0.05, u.opacity ?? 0.5));
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp.img, -bmp.w / 2, -bmp.h / 2, bmp.w, bmp.h);
  ctx.restore();
  if (st.tool === 'underlay') {
    const w = bmp.w * u.mmPerPx;
    const h = bmp.h * u.mmPerPx;
    const corners = [
      { x: -w / 2, y: -h / 2 },
      { x: w / 2, y: -h / 2 },
      { x: w / 2, y: h / 2 },
      { x: -w / 2, y: h / 2 },
    ].map((q) => {
      const r = ((u.rotation || 0) * Math.PI) / 180;
      return worldToScreen(st.view, { x: u.x + q.x * Math.cos(r) - q.y * Math.sin(r), y: u.y + q.x * Math.sin(r) + q.y * Math.cos(r) });
    });
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = st.theme.c.accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    tracePoly(ctx, corners);
    ctx.stroke();
    ctx.restore();
  }
}

// Faint ghost of the level below ---------------------------------------------------------------------
export function drawGhostLevel(ctx, st, below) {
  if (!below) return;
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = st.theme.c.lineSoft;
  ctx.beginPath();
  for (const w of below.walls) {
    if (!statusVisible(w.status, st.statusView) || G.wallLength(w) < 1) continue;
    const d = G.wallDir(w);
    const n = G.wallNormal(w);
    const h = (w.thickness || 100) / 2;
    const p = [
      { x: w.a.x + n.x * h - d.x * h, y: w.a.y + n.y * h - d.y * h },
      { x: w.b.x + n.x * h + d.x * h, y: w.b.y + n.y * h + d.y * h },
      { x: w.b.x - n.x * h + d.x * h, y: w.b.y - n.y * h + d.y * h },
      { x: w.a.x - n.x * h - d.x * h, y: w.a.y - n.y * h - d.y * h },
    ];
    tracePoly(ctx, toScreenPoly(st.view, p));
  }
  ctx.fill();
  ctx.restore();
}

// Rooms -----------------------------------------------------------------------------------------------
const hatchCache = new Map();
function hatch(ctx, colour, cache = hatchCache) {
  if (cache.has(colour)) return cache.get(colour);
  const c = document.createElement('canvas');
  c.width = c.height = 10;
  const g = c.getContext('2d');
  g.strokeStyle = colour;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(-1, 11);
  g.lineTo(11, -1);
  g.moveTo(-1, 1);
  g.lineTo(1, -1);
  g.moveTo(9, 11);
  g.lineTo(11, 9);
  g.stroke();
  const p = ctx.createPattern(c, 'repeat');
  cache.set(colour, p);
  return p;
}

export function drawRooms(ctx, st, scene) {
  const { view, theme } = st;
  for (const r of scene.rooms) {
    const pts = toScreenPoly(view, r.polygon);
    ctx.beginPath();
    tracePoly(ctx, pts);
    ctx.fillStyle = roomTint(theme, r.type);
    ctx.fill();
    if (r.outdoor) {
      ctx.fillStyle = hatch(ctx, theme.c.outdoor);
      ctx.fill();
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = theme.c.lineSoft;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    } else if (r.status === 'demolish') {
      ctx.fillStyle = hatch(ctx, theme.c.demolish);
      ctx.fill();
    }
  }
}

// Room names and areas. Drawn after furniture so a bed or a car never hides the name; a thin halo keeps it readable.
export function drawRoomLabels(ctx, st, scene) {
  const { view, theme } = st;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = theme.c.canvas;
  const say = (text, x, y) => {
    ctx.globalAlpha = 0.8;
    ctx.strokeText(text, x, y);
    ctx.globalAlpha = 1;
    ctx.fillText(text, x, y);
  };
  for (const r of scene.rooms) {
    const bb = G.bbox(toScreenPoly(view, r.polygon));
    if (bb.w < 34 || bb.h < 22) continue;
    const c = worldToScreen(view, G.polygonCentroid(r.polygon));
    const name = r.name || ROOM_LABELS[r.type] || 'Room';
    const area = `${(G.polygonArea(r.polygon) / 1e6).toFixed(2)} m²`;
    let size = 12.5;
    ctx.font = `500 ${size}px ${theme.f.ui}`;
    const avail = bb.w * 0.92;
    const w = ctx.measureText(name).width;
    if (w > avail) size = Math.max(9, size * (avail / w));
    ctx.font = `500 ${size}px ${theme.f.ui}`;
    const fits = ctx.measureText(name).width <= avail;
    ctx.fillStyle = r.status === 'existing' ? theme.c.muted : theme.c.text;
    if (fits && bb.h >= 34) {
      say(name, c.x, c.y - 7);
      ctx.font = `400 11px ${theme.f.mono}`;
      ctx.fillStyle = theme.c.muted;
      say(area, c.x, c.y + 8);
    } else if (fits) {
      say(name, c.x, c.y);
    } else if (bb.w >= 56) {
      ctx.font = `400 10.5px ${theme.f.mono}`;
      ctx.fillStyle = theme.c.muted;
      say(area, c.x, c.y);
    }
  }
  ctx.restore();
}

// Wall poché: new = ink, existing = grey, demolish = dashed red outline with no fill ------------------------
export function drawWalls(ctx, st, scene) {
  const { view, theme } = st;
  const groups = { new: [], existing: [], demolish: [] };
  for (const p of scene.pieces) groups[p.status === 'existing' ? 'existing' : p.status === 'demolish' ? 'demolish' : 'new'].push(toScreenPoly(view, p.poly));
  for (const [key, colour] of [['existing', theme.c.existing], ['new', theme.c.ink]]) {
    if (!groups[key].length) continue;
    ctx.beginPath();
    for (const poly of groups[key]) tracePoly(ctx, poly);
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.strokeStyle = colour;
    ctx.lineWidth = 0.75;
    ctx.stroke();
  }
  if (groups.demolish.length) {
    ctx.save();
    ctx.beginPath();
    for (const poly of groups.demolish) tracePoly(ctx, poly);
    ctx.fillStyle = theme.c.canvas;
    ctx.globalAlpha = 0.55;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = theme.c.demolish;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }
}
