// 2D plan layers for catalogue buildings: the apron, canopy and other extras, the bay rows, each type's own draw2d symbols, the plan label and
// the selected building's outline with its turn handle. Screen space, derived from the project being drawn.

import { worldToScreen } from '../../editor2d/math.js';
import { buildingsOf, siteWorksOf } from './buildings.js';
import { buildingParking } from './bays.js';
import { toWorld } from './frame.js';
import { panelEnds, panelWallLayout } from './panels.js';
import { pavementAreas } from './pavements/logic.js';
import { drawPavementArea } from './pavements/draw2d.js';

const GOLD = '#c7a256';
const BLUE = '#1b5fbf';
const FILL = { apron: 'rgba(96,102,112,0.20)', canopy: 'rgba(120,130,140,0.28)', 'fuel-canopy': 'rgba(120,130,140,0.28)', 'dock-recess': 'rgba(60,66,76,0.30)', yard: 'rgba(96,102,112,0.14)', landscape: 'rgba(96,160,96,0.20)' };
export const HANDLE_MM = 5000;

const S = (st, p) => worldToScreen(st.view, p);
const trace = (ctx, st, poly) => { poly.forEach((q, i) => { const s = S(st, q); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); }); ctx.closePath(); };

/** The turn handle of a building: 5 m in front of the middle of its front edge (world mm), and its centre. */
export function buildingHandle(b) {
  const xs = b.local.outline.map((q) => q.x);
  const ys = b.local.outline.map((q) => q.y);
  const mx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const y0 = Math.min(...ys);
  return { centre: toWorld(b.place, { x: mx, y: (y0 + Math.max(...ys)) / 2 }), handle: toWorld(b.place, { x: mx, y: y0 - HANDLE_MM }) };
}

/** Points of every building, extra and bay so the plan is framed around them. */
export function buildingExtents(project) {
  const c = project?.commercial;
  if (!c?.buildings?.length) return [];
  const pts = [];
  for (const b of buildingsOf(c)) pts.push(...b.outline, ...b.extras.flatMap((e) => e.polygon));
  for (const r of buildingParking(c).rows) for (const s of r.slots) pts.push(...s.poly);
  return pts;
}

export function drawBuildings(ctx, st) {
  const p = st.project;
  const c = p.commercial;
  if (!c?.buildings?.length) return;
  const bs = buildingsOf(c);
  const lw = Math.max(1.2, Math.min(3, st.view.scale * 100));
  ctx.save();
  ctx.lineJoin = 'round';
  for (const b of bs) {
    for (const e of b.extras) {
      ctx.beginPath(); trace(ctx, st, e.polygon);
      ctx.fillStyle = FILL[e.kind] || FILL.yard; ctx.fill();
      if (e.kind === 'canopy' || e.kind === 'fuel-canopy') { ctx.setLineDash([8, 5]); ctx.strokeStyle = st.theme.c.line; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]); }
    }
    ctx.font = `600 10px ${st.theme.f.ui}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const e of b.extras) {
      if (!e.label) continue;
      const ctr = e.polygon.reduce((a, q) => ({ x: a.x + q.x / e.polygon.length, y: a.y + q.y / e.polygon.length }), { x: 0, y: 0 });
      const s = S(st, ctr);
      ctx.fillStyle = st.theme.c.muted; ctx.fillText(String(e.label).toUpperCase(), s.x, s.y);
    }
  }
  // Bay rows: side lines for plain bays, tinted accessible bays and shared zones.
  for (const r of buildingParking(c).rows) {
    for (const sl of r.slots) {
      ctx.beginPath(); trace(ctx, st, sl.poly);
      if (sl.kind === 'accessible') { ctx.fillStyle = 'rgba(27,95,191,0.22)'; ctx.fill(); ctx.strokeStyle = BLUE; ctx.lineWidth = Math.max(1.4, lw); }
      else if (sl.kind === 'zone') { ctx.fillStyle = 'rgba(27,95,191,0.08)'; ctx.fill(); ctx.strokeStyle = BLUE; ctx.lineWidth = 1; }
      else { ctx.strokeStyle = st.theme.c.line; ctx.lineWidth = lw; }
      ctx.stroke();
      if (sl.kind === 'accessible' && st.view.scale > 0.012) {
        const s = S(st, sl.centre);
        ctx.fillStyle = BLUE; ctx.font = `700 ${Math.max(9, Math.min(15, st.view.scale * 700))}px ${st.theme.f.ui}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('A', s.x, s.y);
      }
    }
  }
  // Each type's own symbols (dock numbers, bollards, fuel islands ...).
  for (const b of bs) {
    if (typeof b.def.draw2d !== 'function') continue;
    const sel = st.selectedBuilding === b.id;
    try {
      b.def.draw2d(b.params, { g: ctx, toScreen: (q) => S(st, q), scale: st.view.scale, place: b.place, selected: sel });
    } catch { /* a symbol that fails must not stop the plan */ }
  }
  // Selected building: gold outline and the turn handle.
  const sb = bs.find((b) => b.id === st.selectedBuilding);
  if (sb) {
    ctx.beginPath(); trace(ctx, st, sb.outline);
    ctx.strokeStyle = GOLD; ctx.lineWidth = 2.4; ctx.setLineDash([8, 5]); ctx.stroke(); ctx.setLineDash([]);
    const { centre, handle } = buildingHandle(sb);
    const a0 = S(st, centre); const a1 = S(st, handle);
    ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y); ctx.strokeStyle = GOLD; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.beginPath(); ctx.arc(a1.x, a1.y, 8, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = GOLD; ctx.lineWidth = 2.4; ctx.stroke();
  }
  ctx.restore();
}

// Panel joints along the wall line: a short tick across the wall at every vertical joint between concrete panels (tilt-up, precast and the
// concrete dado). Layouts are cached per wall object, so a redraw costs nothing until the model changes.
const JOINT_CACHE = new WeakMap();
export function wallJointPoints(w, openings, ends, wallHeightMm) {
  const key = `${ends?.a}|${ends?.b}|${wallHeightMm}|${openings.map((o) => `${o.offset},${o.width},${o.sill},${o.height}`).join(';')}`;
  const hit = JOINT_CACHE.get(w);
  if (hit && hit.key === key) return hit.pts;
  const { span, layout } = panelWallLayout(w, openings, { ends, wallHeightMm });
  const dx = w.b.x - w.a.x; const dy = w.b.y - w.a.y; const L = Math.hypot(dx, dy) || 1;
  const d = { x: dx / L, y: dy / L }; const n = { x: -d.y, y: d.x };
  const half = (w.thickness || 200) / 2;
  const pts = layout.joints.map((x) => { const u = span.start + x; const c = { x: w.a.x + d.x * u, y: w.a.y + d.y * u }; return [{ x: c.x + n.x * half, y: c.y + n.y * half }, { x: c.x - n.x * half, y: c.y - n.y * half }]; });
  JOINT_CACHE.set(w, { key, pts });
  return pts;
}

export function drawPanelJoints(ctx, st) {
  const p = st.project;
  if (st.view.scale < 0.003) return; // too small to read
  const level = p.levels?.[0];
  const walls = (level?.walls || []).filter((w) => w.panel && w.kind !== 'interior');
  if (!walls.length) return;
  const ends = panelEnds(walls);
  ctx.save();
  ctx.strokeStyle = st.theme.c.line; ctx.lineWidth = 1; ctx.setLineDash([]);
  for (const w of walls) {
    const ops = (level.openings || []).filter((o) => o.wallId === w.id);
    for (const [a, b] of wallJointPoints(w, ops, ends.get(w.id), w.height ?? level.height)) {
      const sa = S(st, a); const sb = S(st, b);
      ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
    }
  }
  ctx.restore();
}

const arrow = (ctx, a, b, size) => {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.beginPath();
  ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - size * Math.cos(ang - 0.45), b.y - size * Math.sin(ang - 0.45));
  ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - size * Math.cos(ang + 0.45), b.y - size * Math.sin(ang + 0.45));
  ctx.stroke();
};

/**
 * The automatic site layout (sitelayout.js) under the buildings: landscaping, the paved areas with their pavement hatch (aisles, forecourt,
 * apron, bay rows, footpaths, so a changed pavement type shows), crossovers marked ENTRY and EXIT, and two-way arrows on the aisle centre lines.
 */
export function drawSiteWorks(ctx, st) {
  const c = st.project.commercial;
  const sw = siteWorksOf(c);
  if (!sw) return;
  ctx.save();
  ctx.lineJoin = 'round';
  for (const l of sw.landscape || []) {
    ctx.beginPath(); trace(ctx, st, l.polygon);
    ctx.fillStyle = 'rgba(96,160,96,0.20)'; ctx.fill();
    ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(70,130,70,0.7)'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
  }
  const areas = pavementAreas(c).filter((a) => String(a.id).startsWith('sw:'));
  for (const a of areas) drawPavementArea(ctx, a.polygon.map((q) => S(st, q)), a.type, st.view.scale);
  // Crossovers, entry and exit.
  ctx.font = `700 10px ${st.theme.f.ui}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const x of sw.crossovers || []) {
    const q = x.polygon.map((p0) => S(st, p0));
    const m = { x: q.reduce((a, p0) => a + p0.x, 0) / q.length, y: q.reduce((a, p0) => a + p0.y, 0) / q.length };
    ctx.strokeStyle = st.theme.c.line; ctx.lineWidth = 1.6; ctx.fillStyle = st.theme.c.text;
    const lab = x.role === 'in' ? 'ENTRY' : x.role === 'out' ? 'EXIT' : 'ENTRY AND EXIT';
    const into = S(st, { x: x.x - (x.dir?.x || 0) * -2500, y: x.y - (x.dir?.y || 0) * -2500 });
    const edge = S(st, { x: x.x + (x.dir?.x || 0) * 2500, y: x.y + (x.dir?.y || 0) * 2500 });
    if (x.role !== 'out') arrow(ctx, edge, into, 8);
    if (x.role !== 'in') arrow(ctx, into, edge, 8);
    ctx.save(); ctx.lineWidth = 3.5; ctx.strokeStyle = st.theme.c.canvas; ctx.globalAlpha = 0.85; ctx.strokeText(lab, m.x, m.y - 14); ctx.restore();
    ctx.fillText(lab, m.x, m.y - 14);
  }
  // Aisle centre lines with a two-way arrow at each end of a long run.
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.2; ctx.setLineDash([9, 7]);
  for (const a of sw.aisles || []) {
    const p0 = S(st, a.centre[0]); const p1 = S(st, a.centre[1]);
    if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 4) continue;
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const a of sw.aisles || []) {
    const p0 = S(st, a.centre[0]); const p1 = S(st, a.centre[1]);
    const L = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    if (L < 60) continue;
    const u = { x: (p1.x - p0.x) / L, y: (p1.y - p0.y) / L };
    const m = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.4;
    arrow(ctx, { x: m.x - u.x * 10, y: m.y - u.y * 10 }, { x: m.x + u.x * 10, y: m.y + u.y * 10 }, 6);
    arrow(ctx, { x: m.x + u.x * 10, y: m.y + u.y * 10 }, { x: m.x - u.x * 10, y: m.y - u.y * 10 }, 6);
  }
  ctx.restore();
}
