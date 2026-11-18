// The commercial lot as the enlarged top view draws it (see src/lotcard/topview.js): lot, setback line, parking bays, buildings, extras and
// units in the cladding colour, with the unit numbers. Same data as the mini map on the commercial lot card.

import { baseScene, ringPts } from '../lotcard/topview.js';
import { boxCentre, rotPoint } from '../lotcard/topview-move.js';
import { commercialEdit } from './mode.js';
import { layoutUnits } from './layout.js';
import { buildingsOf } from './catalogue/buildings.js';
import { topViewFill } from './finishes.js';
import { parkingLayout } from './parking.js';
import { buildingParking } from './catalogue/bays.js';
import { hardstandModel } from './catalogue/pavements/hardstand.js';
import { pavementById } from './catalogue/pavements/pavements.js';

export async function commercialScene(project) {
  const c = project?.commercial;
  if (!c) return null;
  const shapes = [];
  const labels = [];
  try {
    for (const r of [...parkingLayout(c).rows, ...buildingParking(c).rows]) for (const s of r.slots) shapes.push({ kind: s.kind === 'bay' ? 'bay' : 'accessible', ring: ringPts(s.poly) });
  } catch { /* parking is decoration here */ }
  try {
    // Hardstand drawn with the Hardstand tool, as it stands once the newer areas have cut the older ones.
    const m = hardstandModel(project);
    for (const a of m?.areas || []) if (a.role === 'hardstand') shapes.push({ kind: 'hardstand', ring: ringPts(a.polygon), fill: pavementById(a.type)?.colour || '#bdb9ae', type: a.type });
  } catch { /* hardstand is decoration here */ }
  const fill = topViewFill(project);
  const blds = buildingsOf(c);
  for (const b of blds) {
    for (const e of b.extras || []) shapes.push({ kind: e.kind === 'canopy' || e.kind === 'fuel-canopy' ? 'canopy' : 'extra', ring: ringPts(e.polygon) });
    shapes.push({ kind: 'building', ring: ringPts(b.outline), fill });
  }
  const units = layoutUnits(c);
  for (const u of units) {
    const ring = ringPts(u.poly);
    shapes.push({ kind: 'unit', ring, fill });
    if (ring.length >= 3) labels.push({ x: ring.reduce((a, q) => a + q.x, 0) / ring.length, y: ring.reduce((a, q) => a + q.y, 0) / ring.length, text: String(u.n), widthMm: Math.min(u.w || 1e9, u.d || 1e9) });
  }
  const parts = [];
  if (units.length) parts.push(`${units.length} ${units.length === 1 ? 'unit' : 'units'}`);
  if (blds.length) parts.push(`${blds.length} ${blds.length === 1 ? 'building' : 'buildings'}`);
  const sc = baseScene(project, shapes, labels, parts.join(' and ') || 'no buildings placed');
  if (sc) {
    // What can be picked up and moved: each catalogue building, and each unit row together with its back to back partner.
    const movables = [];
    const byRow = new Map();
    for (const u of units) { const key = u.row?.mirrorOf || u.rowId; if (!byRow.has(key)) byRow.set(key, []); byRow.get(key).push(ringPts(u.poly)); }
    const rowNo = new Map(c.rows.filter((r) => !r.mirrorOf).map((r, i) => [r.id, i + 1]));
    for (const [id, rings] of byRow) if (rowNo.has(id)) movables.push({ id: `r:${id}`, label: `Row ${rowNo.get(id)}`, rings, centre: boxCentre(rings) });
    for (const b of blds) { const rings = [ringPts(b.outline), ...(b.extras || []).map((e) => ringPts(e.polygon))].filter((r) => r.length >= 3); movables.push({ id: `b:${b.id}`, label: `B${b.n} ${b.label}`, rings, centre: boxCentre([rings[0]]) }); }
    sc.movables = movables;
  }
  return sc;
}

/**
 * The movers the top view uses on a commercial lot. A building moves by its place, a unit row (with its mirrored partner) by the row origin;
 * a turn is about the item's centre. Each call is one store.apply that regenerates the model, so the 2D plan, 3D view, stats and parking follow.
 */
export function commercialMovers() {
  const r0 = (v) => Math.round(v);
  const find = (c, id) => (id.startsWith('b:') ? { b: c.buildings.find((b) => `b:${b.id}` === id) } : { r: c.rows.find((r) => `r:${r.id}` === id && !r.mirrorOf) });
  return {
    can: (p) => p?.mode === 'commercial' && !!p.commercial,
    move(store, id, dx, dy, label) {
      commercialEdit(store, `Move ${label}`, (c) => {
        const { b, r } = find(c, id);
        const o = b ? b.place : r;
        if (!o) return;
        o.x = r0(o.x + dx); o.y = r0(o.y + dy);
      });
    },
    turn(store, id, deg, centre, label) {
      commercialEdit(store, `Turn ${label}`, (c) => {
        const { b, r } = find(c, id);
        const o = b ? b.place : r;
        if (!o) return;
        const q = rotPoint({ x: o.x, y: o.y }, centre, deg);
        o.x = r0(q.x); o.y = r0(q.y);
        o.rotationDeg = ((((Number(o.rotationDeg) || 0) + deg) % 360) + 360) % 360;
      });
    },
  };
}
