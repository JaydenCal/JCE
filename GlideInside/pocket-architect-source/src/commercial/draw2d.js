// Commercial layers for the 2D plan: aisle strips, parking bays, accessible bays with their shared zones, the accessible path of
// travel, bollards, the waste enclosure, the hydrant and the selected row outline with its turn handle. Derived from the project
// being drawn (a drag preview included). Screen space; nothing here is selectable on its own.

import { worldToScreen } from '../editor2d/math.js';
import { analyse } from './analyse.js';
import { rowFrame, rowLength, rowPoly } from './layout.js';

const GOLD = '#c7a256';
const BLUE = '#1b5fbf';
const BOLLARD = '#e0a800';
export const HANDLE_PX = 16;

const S = (st, p) => worldToScreen(st.view, p);
function tracePoly(ctx, st, poly) {
  poly.forEach((q, i) => { const s = S(st, q); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
  ctx.closePath();
}

/** The turn handle of a row: 5 m out from the middle of its front facade (world mm). */
export function rowHandle(row, rows) {
  const fr = rowFrame(row, rows);
  const L = rowLength(row, rows);
  const d = row.unit.depthMm;
  const mid = { x: fr.o.x + fr.u.x * (L / 2) + fr.f.x * d, y: fr.o.y + fr.u.y * (L / 2) + fr.f.y * d };
  return { centre: { x: fr.o.x + fr.u.x * (L / 2) + fr.f.x * (d / 2), y: fr.o.y + fr.u.y * (L / 2) + fr.f.y * (d / 2) }, handle: { x: mid.x + fr.f.x * 5000, y: mid.y + fr.f.y * 5000 } };
}

export function drawCommercial(ctx, st) {
  const p = st.project;
  if (p.mode !== 'commercial' || !p.commercial) return;
  const a = analyse(p);
  if (!a) return;
  const c = p.commercial;
  const sel = st.selectedRow || null;
  ctx.save();
  ctx.lineJoin = 'round';
  // Aisles: the strip between each facade and its bay row.
  for (const pr of a.parking.rows) {
    if (!pr.slots.length) continue;
    const fr = pr.frame;
    const L = pr.length;
    const pt = (x, d) => ({ x: fr.o.x + fr.u.x * x + fr.f.x * d, y: fr.o.y + fr.u.y * x + fr.f.y * d });
    ctx.beginPath();
    tracePoly(ctx, st, [pt(0, pr.depth), pt(L, pr.depth), pt(L, pr.depth + c.parking.aisleMm), pt(0, pr.depth + c.parking.aisleMm)]);
    ctx.fillStyle = 'rgba(120,126,136,0.10)';
    ctx.fill();
  }
  // Bays
  const lw = Math.max(1, st.view.scale * 30);
  for (const pr of a.parking.rows) {
    for (const sl of pr.slots) {
      ctx.beginPath();
      tracePoly(ctx, st, sl.poly);
      if (sl.kind === 'accessible') { ctx.fillStyle = 'rgba(27,95,191,0.22)'; ctx.fill(); ctx.strokeStyle = BLUE; ctx.lineWidth = Math.max(1.4, lw); }
      else if (sl.kind === 'zone') {
        ctx.fillStyle = 'rgba(27,95,191,0.08)'; ctx.fill();
        ctx.save(); ctx.clip();
        ctx.strokeStyle = 'rgba(27,95,191,0.55)'; ctx.lineWidth = 1;
        const bb = sl.poly.map((q) => S(st, q));
        const xs = bb.map((q) => q.x); const ys = bb.map((q) => q.y);
        const x0 = Math.min(...xs); const y0 = Math.min(...ys); const x1 = Math.max(...xs); const y1 = Math.max(...ys);
        ctx.beginPath();
        for (let k = x0 - (y1 - y0); k < x1; k += 5) { ctx.moveTo(k, y1); ctx.lineTo(k + (y1 - y0), y0); }
        ctx.stroke();
        ctx.restore();
        ctx.beginPath(); tracePoly(ctx, st, sl.poly); ctx.strokeStyle = BLUE; ctx.lineWidth = 1;
      } else { ctx.strokeStyle = st.theme.c.lineSoft; ctx.lineWidth = 1; }
      ctx.stroke();
      if (sl.kind === 'accessible' && st.view.scale > 0.012) {
        const s = S(st, sl.centre);
        ctx.fillStyle = BLUE; ctx.font = `700 ${Math.max(9, Math.min(15, st.view.scale * 700))}px ${st.theme.f.ui}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('A', s.x, s.y);
      }
    }
  }
  // Accessible path of travel
  if (a.parking.path) {
    const [p0, p1] = a.parking.path.map((q) => S(st, q));
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
    ctx.setLineDash([6, 4]); ctx.strokeStyle = BLUE; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(p1.x, p1.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = BLUE; ctx.fill();
  }
  // Waste and hydrant
  if (c.waste) {
    const w = c.waste; const ang = ((w.rotationDeg || 0) * Math.PI) / 180;
    const ux = { x: Math.cos(ang), y: Math.sin(ang) }; const vx = { x: -Math.sin(ang), y: Math.cos(ang) };
    const q = (sx, sy) => ({ x: w.x + ux.x * sx * w.widthMm / 2 + vx.x * sy * w.depthMm / 2, y: w.y + ux.y * sx * w.widthMm / 2 + vx.y * sy * w.depthMm / 2 });
    ctx.beginPath(); tracePoly(ctx, st, [q(-1, -1), q(1, -1), q(1, 1), q(-1, 1)]);
    ctx.fillStyle = 'rgba(90,96,106,0.28)'; ctx.fill(); ctx.strokeStyle = st.theme.c.line; ctx.lineWidth = 1.2; ctx.stroke();
    const s = S(st, w); ctx.fillStyle = st.theme.c.text; ctx.font = `600 10px ${st.theme.f.ui}`; ctx.textAlign = 'center'; ctx.fillText('WASTE', s.x, s.y);
  }
  if (c.hydrant) {
    const s = S(st, c.hydrant);
    ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI * 2); ctx.fillStyle = '#c0392b'; ctx.fill();
    ctx.fillStyle = st.theme.c.text; ctx.font = `600 10px ${st.theme.f.ui}`; ctx.textAlign = 'left'; ctx.fillText('HYD', s.x + 9, s.y + 3);
  }
  // Bollards
  const r = Math.max(2.2, Math.min(5, st.view.scale * 90));
  for (const b of a.bollards) {
    const s = S(st, b);
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fillStyle = BOLLARD; ctx.fill(); ctx.strokeStyle = '#1d2024'; ctx.lineWidth = 0.9; ctx.stroke();
  }
  // Selected row outline and handle
  const row = c.rows.find((x) => x.id === sel);
  if (row) {
    ctx.beginPath(); tracePoly(ctx, st, rowPoly(row, c.rows));
    ctx.strokeStyle = GOLD; ctx.lineWidth = 2.4; ctx.setLineDash([8, 5]); ctx.stroke(); ctx.setLineDash([]);
    if (!row.mirrorOf) {
      const { centre, handle } = rowHandle(row, c.rows);
      const a0 = S(st, centre); const a1 = S(st, handle);
      ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y); ctx.strokeStyle = GOLD; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.beginPath(); ctx.arc(a1.x, a1.y, 8, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = GOLD; ctx.lineWidth = 2.4; ctx.stroke();
    }
  }
  ctx.restore();
}
