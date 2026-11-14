// 2D plan layers for catalogue buildings: the apron, canopy and other extras, the bay rows, each type's own draw2d symbols, the plan label and
// the selected building's outline with its turn handle. Screen space, derived from the project being drawn.

import { worldToScreen } from '../../editor2d/math.js';
import { buildingsOf } from './buildings.js';
import { buildingParking } from './bays.js';
import { toWorld } from './frame.js';

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
