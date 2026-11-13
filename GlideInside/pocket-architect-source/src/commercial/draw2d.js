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

/** Points of the commercial site items (the bay rows, the waste enclosure, the hydrant) so the plan is framed around them too. */
export function commercialExtents(project) {
  if (project?.mode !== 'commercial' || !project.commercial) return [];
  const a = analyse(project);
  const c = project.commercial;
  const pts = a ? a.parking.rows.flatMap((pr) => pr.slots.flatMap((sl) => sl.poly)) : [];
  if (c.waste) pts.push({ x: c.waste.x - 3000, y: c.waste.y - 3000 }, { x: c.waste.x + 3000, y: c.waste.y + 3000 });
  if (c.hydrant) pts.push({ x: c.hydrant.x, y: c.hydrant.y });
  return pts;
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
  // Pavement: the aisle between each facade and its bay row, then the bay row itself, so the parking reads as a paved area with an
  // aisle and marked bays (2.4 x 5.4 m by default) and not as loose rectangles. The aisle carries its width and a centre line.
  const { aisleMm, bayW, bayL } = c.parking;
  const lw = Math.max(1.2, Math.min(3, st.view.scale * 100)); // a 100 mm marking line, never under 1.2 px
  const labels = [];
  for (const pr of a.parking.rows) {
    if (!pr.slots.length) continue;
    const fr = pr.frame;
    const L = pr.length;
    const B = pr.slots.length * bayW;
    const pt = (x, d) => ({ x: fr.o.x + fr.u.x * x + fr.f.x * d, y: fr.o.y + fr.u.y * x + fr.f.y * d });
    ctx.beginPath();
    tracePoly(ctx, st, [pt(0, pr.depth), pt(L, pr.depth), pt(L, pr.depth + aisleMm), pt(0, pr.depth + aisleMm)]);
    ctx.fillStyle = 'rgba(96,102,112,0.20)';
    ctx.fill();
    ctx.beginPath();
    tracePoly(ctx, st, [pt(0, pr.depth + aisleMm), pt(B, pr.depth + aisleMm), pt(B, pr.depth + aisleMm + bayL), pt(0, pr.depth + aisleMm + bayL)]);
    ctx.fillStyle = 'rgba(96,102,112,0.11)';
    ctx.fill();
    // Aisle centre line
    const c0 = S(st, pt(0, pr.depth + aisleMm / 2));
    const c1 = S(st, pt(L, pr.depth + aisleMm / 2));
    ctx.beginPath(); ctx.moveTo(c0.x, c0.y); ctx.lineTo(c1.x, c1.y);
    ctx.setLineDash([10, 8]); ctx.strokeStyle = 'rgba(96,102,112,0.55)'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
    // Kerb line along the back of the bays
    const k0 = S(st, pt(0, pr.depth + aisleMm + bayL));
    const k1 = S(st, pt(B, pr.depth + aisleMm + bayL));
    ctx.beginPath(); ctx.moveTo(k0.x, k0.y); ctx.lineTo(k1.x, k1.y);
    ctx.strokeStyle = st.theme.c.line; ctx.lineWidth = lw + 0.6; ctx.stroke();
    const bays = pr.slots.filter((x) => x.kind !== 'zone').length;
    labels.push({ a: c0, b: c1, text: `AISLE ${(aisleMm / 1000).toFixed(1)} m`, off: -8, t: 0.25 }); // a quarter of the way along, clear of the row dimension and the turn handle
    labels.push({ a: k0, b: k1, text: `${bays} BAY${bays === 1 ? '' : 'S'} ${(bayW / 1000).toFixed(1)} x ${(bayL / 1000).toFixed(1)} m, INDICATIVE`, off: null, out: S(st, pt(B / 2, pr.depth + aisleMm + bayL + 1)) });
  }
  // Bays: marked on both sides and open to the aisle, as line marking is.
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
      } else {
        // poly is [aisle left, aisle right, back right, back left]: the two side lines only.
        const q = sl.poly.map((v) => S(st, v));
        ctx.beginPath(); ctx.moveTo(q[0].x, q[0].y); ctx.lineTo(q[3].x, q[3].y); ctx.moveTo(q[1].x, q[1].y); ctx.lineTo(q[2].x, q[2].y);
        ctx.strokeStyle = st.theme.c.line; ctx.lineWidth = lw;
      }
      ctx.stroke();
      if (sl.kind === 'accessible' && st.view.scale > 0.012) {
        const s = S(st, sl.centre);
        ctx.fillStyle = BLUE; ctx.font = `700 ${Math.max(9, Math.min(15, st.view.scale * 700))}px ${st.theme.f.ui}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('A', s.x, s.y);
      }
    }
  }
  // Aisle and bay labels, along the row, where the row is long enough on screen to carry them.
  ctx.font = `600 10px ${st.theme.f.ui}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const l of labels) {
    const len = Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y);
    if (len * (l.t ? 2 * l.t : 1) < ctx.measureText(l.text).width + 24) continue;
    let ang = Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x);
    if (ang > Math.PI / 2) ang -= Math.PI;
    if (ang < -Math.PI / 2) ang += Math.PI;
    const t = l.t ?? 0.5;
    let x = l.a.x + (l.b.x - l.a.x) * t + Math.sin(ang) * (l.off || 0);
    let y = l.a.y + (l.b.y - l.a.y) * t - Math.cos(ang) * (l.off || 0);
    if (l.out) { // just outside the back of the bays: step 10 px away from the bay row
      const mx = (l.a.x + l.b.x) / 2; const my = (l.a.y + l.b.y) / 2;
      const d = Math.hypot(l.out.x - mx, l.out.y - my) || 1;
      x = mx + ((l.out.x - mx) / d) * 10; y = my + ((l.out.y - my) / d) * 10;
    }
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.lineWidth = 3.5; ctx.strokeStyle = st.theme.c.canvas; ctx.globalAlpha = 0.85; ctx.strokeText(l.text, 0, 0); ctx.globalAlpha = 1;
    ctx.fillStyle = st.theme.c.muted; ctx.fillText(l.text, 0, 0);
    ctx.restore();
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
