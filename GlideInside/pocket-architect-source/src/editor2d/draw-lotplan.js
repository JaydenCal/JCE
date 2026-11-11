// Lot planning layers in the 2D plan editor: the road in front of the lot (footpath, kerb, red phantom centreline), the dashed
// setback envelope, the driveway with its crossover and, while the person is arranging the house, the clearance to every
// boundary and the rotation ring. Everything is derived from the project being drawn (a drag preview included), so the layers
// stay in step with the house as it is moved, rotated or mirrored. Screen space drawing; nothing here is selectable.

import { worldToScreen } from './math.js';
import { layerOn } from './draw-site.js';
import { roadReserve, deriveDriveway, clearances, buildingHull, orientedBox, garageDoor, inwardNormalOf } from '../site/lotplan.js';
import { lotOf } from '../model/placement.js';
import { lotChecks } from '../site/lot-checks.js';
import * as G from '../model/geometry.js';

export const OK = '#2f7d4f';
export const BAD = '#c0392b';
export const UNKNOWN = '#676b72';
export const GOLD = '#c7a256';
const KERB = '#1d2024';
const ROAD_CL = '#d01010';

const S = (st, p) => worldToScreen(st.view, p);

function halo(ctx, text, x, y, theme) {
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = theme.c.canvas;
  ctx.globalAlpha = 0.85;
  ctx.strokeText(text, x, y);
  ctx.globalAlpha = 1;
  ctx.fillText(text, x, y);
}

function line(ctx, st, a, b) {
  const p = S(st, a);
  const q = S(st, b);
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(q.x, q.y);
}

function alongText(ctx, st, text, a, b, theme, offsetPx = 0) {
  const p = S(st, a);
  const q = S(st, b);
  let ang = Math.atan2(q.y - p.y, q.x - p.x);
  if (ang > Math.PI / 2) ang -= Math.PI;
  if (ang < -Math.PI / 2) ang += Math.PI;
  ctx.save();
  ctx.translate((p.x + q.x) / 2 + Math.sin(ang) * offsetPx, (p.y + q.y) / 2 - Math.cos(ang) * offsetPx);
  ctx.rotate(ang);
  halo(ctx, text, 0, 0, theme);
  ctx.restore();
}

const status = (st) => {
  const key = st.project;
  if (st._clear?.key === key) return st._clear.value;
  const value = clearances(st.project);
  st._clear = { key, value };
  return value;
};

/** The road: footpath, kerb and gutter lines, and the centreline as a red phantom line. */
export function drawRoad(ctx, st) {
  const lot = lotOf(st.project);
  if (!lot || !layerOn(lot, 'road')) return;
  const reserves = roadReserve(lot);
  if (!reserves.length) return;
  const { theme } = st;
  ctx.save();
  ctx.lineJoin = 'round';
  for (const r of reserves) {
    const L = r.lines;
    // Footpath
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(120,124,132,0.8)';
    ctx.lineWidth = 1;
    line(ctx, st, ...L.footpathNear);
    line(ctx, st, ...L.footpathFar);
    ctx.stroke();
    // Kerb and gutter, far kerb and gutter
    ctx.beginPath();
    ctx.strokeStyle = KERB;
    ctx.lineWidth = 2;
    line(ctx, st, ...L.kerb);
    line(ctx, st, ...L.farKerb);
    ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(29,32,36,0.55)';
    ctx.lineWidth = 1;
    line(ctx, st, ...L.gutter);
    line(ctx, st, ...L.farGutter);
    ctx.stroke();
    // Centreline: red phantom (long, short, short)
    ctx.beginPath();
    ctx.strokeStyle = ROAD_CL;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([22, 5, 4, 5, 4, 5]);
    line(ctx, st, ...L.centreline);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `600 10.5px ${theme.f.ui}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ROAD_CL;
    const mid = (l, k) => ({ x: l[0].x * (1 - k) + l[1].x * k, y: l[0].y * (1 - k) + l[1].y * k });
    alongText(ctx, st, 'ROAD CENTRELINE (INDICATIVE)', mid(L.centreline, 0.35), mid(L.centreline, 0.65), theme, -9);
    ctx.fillStyle = theme.c.muted;
    ctx.font = `500 10px ${theme.f.ui}`;
    alongText(ctx, st, 'KERB AND GUTTER', mid(L.kerb, 0.2), mid(L.kerb, 0.5), theme, 10);
    alongText(ctx, st, 'FOOTPATH', mid(L.footpathNear, 0.8), mid(L.footpathFar, 0.95), theme, 0);
  }
  ctx.restore();
}

/** The setback envelope, dashed: blue inside, red when the building is over it, grey when no rule is loaded. */
export function drawEnvelope(ctx, st) {
  const lot = lotOf(st.project);
  if (!lot || !layerOn(lot, 'setbacks') || !Array.isArray(lot.envelope) || lot.envelope.length < 3) return;
  const c = status(st);
  const colour = c.status === 'breach' ? BAD : c.status === 'ok' ? '#1f5f8b' : UNKNOWN;
  ctx.save();
  ctx.beginPath();
  lot.envelope.forEach((p, i) => {
    const s = S(st, p);
    if (i) ctx.lineTo(s.x, s.y);
    else ctx.moveTo(s.x, s.y);
  });
  ctx.closePath();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.8;
  ctx.setLineDash([9, 6]);
  ctx.stroke();
  ctx.setLineDash([]);
  // Edge labels with the required distance, only where a rule is loaded for the kind of edge.
  if (lot.setbacks) {
    const names = { front: 'FRONT', secondaryFront: 'SECONDARY FRONT', side: 'SIDE', rear: 'REAR' };
    ctx.font = `600 10px ${st.theme.f.ui}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colour;
    for (const row of c.rows || []) {
      if (row.requiredM == null) continue;
      const e = lot.boundary;
      const a = e[row.edge];
      const b = e[(row.edge + 1) % e.length];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // Label sits just inside the boundary edge, half way between the boundary and the envelope.
      const inward = inwardNormalOf(lot, row.edge);
      const at = { x: mid.x + inward.x * (row.requiredM * 500), y: mid.y + inward.y * (row.requiredM * 500) };
      const s = S(st, at);
      if (Math.hypot(S(st, a).x - S(st, b).x, S(st, a).y - S(st, b).y) < 90) continue;
      halo(ctx, `${names[row.kind] || ''} ${row.requiredM.toFixed(1)} m${row.flagged ? ' (check)' : ''}`, s.x, s.y, st.theme);
    }
  }
  ctx.restore();
}

function polyPath(ctx, st, pts) {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const s = S(st, p);
    if (i) ctx.lineTo(s.x, s.y);
    else ctx.moveTo(s.x, s.y);
  });
  ctx.closePath();
}

/** The driveway, light grey with a darker crossover. */
export function drawDriveway(ctx, st) {
  const lot = lotOf(st.project);
  if (!lot || !layerOn(lot, 'driveway')) return;
  const d = deriveDriveway(st.project);
  if (!d?.ok) return;
  ctx.save();
  polyPath(ctx, st, d.polygon);
  ctx.fillStyle = 'rgba(205,205,205,0.9)';
  ctx.fill();
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  polyPath(ctx, st, d.crossover.polygon);
  ctx.fillStyle = 'rgba(160,160,160,0.7)';
  ctx.fill();
  ctx.stroke();
  const m = d.centre[Math.floor(d.centre.length * 0.45)];
  const s = S(st, m);
  ctx.font = `600 10px ${st.theme.f.ui}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#444';
  if (d.lengthMm * st.view.scale > 70) halo(ctx, 'DRIVEWAY', s.x, s.y, st.theme);
  ctx.restore();
}

/** Layers that go under the plan: road, envelope, driveway. Called from drawSite. */
export function drawLotPlan(ctx, st) {
  if (!lotOf(st.project)) return;
  drawRoad(ctx, st);
  drawEnvelope(ctx, st);
  drawDriveway(ctx, st);
}

// Breaching walls ---------------------------------------------------------------------------------------------------------
const checksOf = (st) => {
  if (st._lotChecks?.key === st.project) return st._lotChecks.value;
  let value;
  try { value = lotChecks(st.project); } catch { value = { breachWallIds: new Set(), messages: [] }; }
  st._lotChecks = { key: st.project, value };
  return value;
};

/** Exterior walls over the lot boundary or inside the setback, drawn red over the plan (same wall bodies as the 3D tint). */
export function drawBreachWalls(ctx, st) {
  if (!lotOf(st.project)) return;
  const c = checksOf(st);
  if (!c.breachWallIds.size) return;
  ctx.save();
  ctx.fillStyle = 'rgba(192,57,43,0.78)';
  ctx.strokeStyle = BAD;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  for (const level of st.project.levels || []) {
    for (const w of level.walls || []) {
      if (!c.breachWallIds.has(w.id)) continue;
      let ring;
      try { ring = G.wallPolygon(w); } catch { continue; }
      ctx.beginPath();
      ring.forEach((p, i) => { const q = S(st, p); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Rotation ring -----------------------------------------------------------------------------------------------------------
/** Centre, radius and handle position (plan mm) of the rotation ring for the building as it stands. */
export function ringOf(project, rotationDeg = 0) {
  const hull = buildingHull(project);
  const box = orientedBox(hull);
  if (!box) return null;
  const centre = box.centre;
  const radius = Math.max(...hull.map((p) => Math.hypot(p.x - centre.x, p.y - centre.y))) + 1500;
  const a = ((rotationDeg - 90) * Math.PI) / 180; // the handle starts at the top of the ring and turns with the house
  return { centre, radius, handle: { x: centre.x + Math.cos(a) * radius, y: centre.y + Math.sin(a) * radius } };
}

/** Clearance dimension lines to every boundary, the rotation ring and its handle. Only while arranging (st.overlay.arrange). */
export function drawArrangeOverlay(ctx, st) {
  const ov = st.overlay;
  if (!ov?.arrange || !lotOf(st.project)) return;
  const c = status(st);
  ctx.save();
  ctx.font = `700 11px ${st.theme.f.ui}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const row of c.rows || []) {
    if (!row.from || !row.to) continue;
    const col = row.status === 'outside' ? BAD : row.status === 'inside' ? OK : UNKNOWN;
    const a = S(st, row.from);
    const b = S(st, row.to);
    const len = Math.hypot(a.x - b.x, a.y - b.y);
    ctx.beginPath();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.6;
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    for (const p of [a, b]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
    }
    const label = `${row.clearanceM.toFixed(2)} m`;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const w = ctx.measureText(label).width + 10;
    const off = len < 26 ? 14 : 0;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(mx - w / 2, my - 9 + off, w, 18, 5) : ctx.rect(mx - w / 2, my - 9 + off, w, 18);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(label, mx, my + off + 0.5);
  }
  const ring = ringOf(st.project, ov.rotation || 0);
  if (ring) {
    const cs = S(st, ring.centre);
    const r = ring.radius * st.view.scale;
    ctx.beginPath();
    ctx.arc(cs.x, cs.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(199,162,86,0.75)';
    ctx.lineWidth = 3;
    ctx.stroke();
    const h = S(st, ring.handle);
    ctx.beginPath();
    ctx.arc(h.x, h.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = GOLD;
    ctx.fill();
    ctx.strokeStyle = '#1b1b1b';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = '#1b1b1b';
    ctx.font = `700 12px ${st.theme.f.ui}`;
    ctx.fillText('⟳', h.x, h.y + 0.5);
    ctx.font = `600 11px ${st.theme.f.ui}`;
    ctx.fillStyle = '#6a5421';
    halo(ctx, `${Math.round(((ov.rotation || 0) % 360 + 360) % 360)}°`, h.x, h.y - 18, st.theme);
    // The garage door, marked so it is clear which way the garage faces.
    const door = garageDoor(st.project);
    if (door) {
      const p = S(st, door.mid);
      const q = S(st, { x: door.mid.x + door.normal.x * 900, y: door.mid.y + door.normal.y * 900 });
      ctx.beginPath();
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 3;
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}
