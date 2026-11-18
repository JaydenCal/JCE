// Plan set data for catalogue buildings (C101 and C103): pure helpers, the drawing itself is in premium/exporters/planset/commercial.js.

import { buildingsOf } from './buildings.js';
import { buildingParking } from './bays.js';

const KIND_LABEL = { apron: 'TRUCK APRON', canopy: 'CANOPY', 'fuel-canopy': 'FUEL CANOPY', 'dock-recess': 'DOCK RECESS', yard: 'YARD', landscape: 'LANDSCAPE' };
const USE_LABEL = (k) => String(k).replace(/[-_]/g, ' ');

/** Extra label of an extra (its own, else by kind). */
export const extraLabel = (e) => String(e.label || KIND_LABEL[e.kind] || '').toUpperCase();

/** Every polygon of the buildings on the lot that is built or paved: outlines, extras and bays (world mm). Used for coverage and the view. */
export function buildingPolys(c) {
  if (!c?.buildings?.length) return [];
  return [...buildingsOf(c).flatMap((b) => [b.outline, ...b.extras.map((e) => e.polygon)]), ...buildingParking(c).rows.flatMap((r) => r.slots.map((s) => s.poly))];
}

/** The built polygons only (outlines), for the site coverage. */
export const buildingOutlines = (c) => buildingsOf(c).map((b) => b.outline);

/** Dock and canopy extras of a building as short lines for the plan: ["4 DOCKS", "DOCK CANOPY 15.4 x 4.0 m"]. */
export function dockLines(b) {
  const out = [];
  const docks = Number(b.site?.vehicles?.docks) || 0;
  if (docks > 0) out.push(`${docks} DOCK${docks === 1 ? '' : 'S'}`);
  for (const e of b.extras) {
    if (e.kind !== 'canopy' && e.kind !== 'fuel-canopy') continue;
    const xs = e.polygon.map((q) => q.x); const ys = e.polygon.map((q) => q.y);
    const w = Math.hypot(e.polygon[1].x - e.polygon[0].x, e.polygon[1].y - e.polygon[0].y);
    const d = Math.hypot(e.polygon[2].x - e.polygon[1].x, e.polygon[2].y - e.polygon[1].y);
    void xs; void ys;
    out.push(`${extraLabel(e) || 'CANOPY'} ${(w / 1000).toFixed(1)} x ${(d / 1000).toFixed(1)} m`);
  }
  return out;
}

/** C103 rows per building: { n, name, size, ground, upper, total, uses: [[use, m2]], text } and the totals. */
export function buildingScheduleRows(c) {
  const rows = buildingsOf(c).map((b) => {
    const xs = b.local.outline.map((q) => q.x); const ys = b.local.outline.map((q) => q.y);
    const upper = Number(b.q.upperM2) || 0;
    const uses = Object.entries(b.q.perUse || {}).filter(([, v]) => v > 0).map(([k, v]) => [USE_LABEL(k), Math.round(v * 10) / 10]);
    return {
      n: b.n, name: `${b.planLabel} B${b.n}`, size: `${((Math.max(...xs) - Math.min(...xs)) / 1000).toFixed(1)} x ${((Math.max(...ys) - Math.min(...ys)) / 1000).toFixed(1)}`,
      ground: b.groundM2, upper, total: b.gfaM2, uses, text: uses.map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', '), extras: dockLines(b),
    };
  });
  const tot = rows.reduce((s, r) => ({ ground: s.ground + r.ground, upper: s.upper + r.upper, total: s.total + r.total }), { ground: 0, upper: 0, total: 0 });
  return { rows, tot };
}

/**
 * The 3D props of a building (canopies, pump islands, posts, awnings, dock seals, glass bands) as boxes in the building's LOCAL millimetres
 * (x along the frontage, y toward the rear, z up from the floor): [{ x0, y0, x1, y1, z0, z1, slot }]. The same data the 3D module builds from,
 * so the elevations and sections show what the model has. Cylinders and other shapes come out as their bounding box.
 */
export function buildingProps(b) {
  let v = null;
  try { v = b.def?.view3d ? b.def.view3d(b.params, { place: { x: 0, y: 0, rotationDeg: 0 } }) : null; } catch { v = null; }
  if (!v) return [];
  const src = Array.isArray(v.items) ? v.items : Array.isArray(v.boxes) ? v.boxes : [];
  const num = (n) => Number.isFinite(Number(n));
  const boxed = src.map((p) => (p.shape === 'cyl' && num(p.cx) && num(p.cy) && num(p.r) ? { ...p, x0: p.cx - p.r, x1: p.cx + p.r, y0: p.cy - p.r, y1: p.cy + p.r } : p));
  return boxed.filter((p) => num(p.x0) && num(p.x1) && num(p.y0) && num(p.y1) && num(p.z0) && num(p.z1))
    .map((p) => ({ x0: Math.min(p.x0, p.x1), x1: Math.max(p.x0, p.x1), y0: Math.min(p.y0, p.y1), y1: Math.max(p.y0, p.y1), z0: Math.min(p.z0, p.z1), z1: Math.max(p.z0, p.z1), slot: String(p.slot || p.kind || 'steel') }));
}
