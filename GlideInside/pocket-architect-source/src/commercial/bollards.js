// Automatic bollard placement. Indicative only: bollard locations are for concept layout, to be confirmed in design.
// Rules (each bollard carries the rule that placed it):
//   door       each side of every roller door opening, in front of the facade
//   corner     in front of each exposed front corner of a row (the corners face the aisle)
//   downpipe   in front of a downpipe facing the aisle (a downpipe every Nth party wall, spec.bollards.downpipeEvery)
//   parkingEnd at the end of a parking row that sits next to a building (within 3 m of a unit)
//   waste      around the waste enclosure
//   hydrant    around the hydrant or booster
//   accessible protecting the aisle end of each accessible shared zone

import { layoutUnits, rowFrame, rowLength, rowPoint, facadeLayout } from './layout.js';
import { parkingLayout } from './parking.js';

export const BOLLARD_NOTE = 'Bollard locations, indicative';
export const BOLLARD_KINDS = Object.freeze({
  door: 'Roller door opening',
  corner: 'Exposed building corner',
  downpipe: 'Downpipe facing the aisle',
  parkingEnd: 'End of parking row next to a building',
  waste: 'Waste enclosure',
  hydrant: 'Hydrant or booster',
  accessible: 'Accessible parking shared zone',
});
export const OFFSET_MM = 700; // out from the facade
export const DOOR_SIDE_MM = 450; // out from the door jamb
export const NEAR_BUILDING_MM = 3000;
export const MERGE_MM = 350;

const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });

function distToPoly(p, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** bollardsFor(commercial) -> [{ id, x, y, kind, label }] (merged where two sit within 350 mm). Empty when bollards are off. */
export function bollardsFor(commercial) {
  if (!commercial || commercial.bollards?.enabled === false || !commercial.rows?.length) return [];
  const rows = commercial.rows;
  const units = layoutUnits(commercial);
  const list = [];
  const push = (p, kind) => list.push({ x: Math.round(p.x), y: Math.round(p.y), kind });
  for (const row of rows) {
    const fr = rowFrame(row, rows);
    const us = units.filter((u) => u.rowId === row.id);
    if (!us.length) continue;
    const d = us[0].d;
    const L = rowLength(row, rows);
    for (const u of us) {
      const fl = facadeLayout(u.spec);
      for (const dr of fl.doors) {
        for (const s of [-1, 1]) push(rowPoint(fr, u.x0 + dr.offset + s * (dr.w / 2 + DOOR_SIDE_MM), d + OFFSET_MM), 'door');
      }
    }
    push(rowPoint(fr, -DOOR_SIDE_MM, d + OFFSET_MM), 'corner');
    push(rowPoint(fr, L + DOOR_SIDE_MM, d + OFFSET_MM), 'corner');
    const every = Number(commercial.bollards?.downpipeEvery) || 0;
    if (every > 0) {
      for (let i = every; i < us.length; i += every) push(rowPoint(fr, us[i].x0, d + OFFSET_MM), 'downpipe');
    }
  }
  // Parking row ends next to a building.
  const park = parkingLayout(commercial);
  for (const pr of park.rows) {
    if (!pr.slots.length) continue;
    const fr = pr.frame;
    const mid = pr.depth + commercial.parking.aisleMm + commercial.parking.bayL / 2;
    for (const [along, s] of [[0, -1], [pr.slots.length * commercial.parking.bayW, 1]]) {
      const p = rowPoint(fr, along + s * 300, mid);
      const nearEdge = rowPoint(fr, along, pr.depth + commercial.parking.aisleMm); // the end of the row at the aisle side
      if (units.some((u) => distToPoly(nearEdge, u.poly) < NEAR_BUILDING_MM)) push(p, 'parkingEnd');
    }
    for (const sl of pr.slots) if (sl.kind === 'zone') push(sl.aisleEnd, 'accessible');
  }
  const w = commercial.waste;
  if (w) {
    const a = ((w.rotationDeg || 0) * Math.PI) / 180;
    const ux = { x: Math.cos(a), y: Math.sin(a) };
    const vx = { x: -Math.sin(a), y: Math.cos(a) };
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) push(add(add({ x: w.x, y: w.y }, mul(ux, sx * (w.widthMm / 2 + 450))), mul(vx, sy * (w.depthMm / 2 + 450))), 'waste');
  }
  const hy = commercial.hydrant;
  if (hy) for (const [dx, dy] of [[900, 0], [-900, 0], [0, 900], [0, -900]]) push({ x: hy.x + dx, y: hy.y + dy }, 'hydrant');
  // Merge near duplicates, keeping the first (the door rule wins), then number.
  const out = [];
  for (const b of list) if (!out.some((o) => Math.hypot(o.x - b.x, o.y - b.y) < MERGE_MM)) out.push(b);
  return out.map((b, i) => ({ id: `bol_${i + 1}`, ...b, label: BOLLARD_KINDS[b.kind] }));
}

/** The schedule: { total, byKind: [{ kind, label, count }], note }. */
export function bollardSchedule(list) {
  const kinds = Object.keys(BOLLARD_KINDS);
  const byKind = kinds.map((k) => ({ kind: k, label: BOLLARD_KINDS[k], count: list.filter((b) => b.kind === k).length })).filter((r) => r.count);
  return { total: list.length, byKind, note: BOLLARD_NOTE };
}

/** Data for the 3D stage: the bollards as plain points with a kind. */
export const bollardsFor3d = (commercial) => bollardsFor(commercial).map(({ x, y, kind }) => ({ x, y, kind, heightMm: 1100, diameterMm: 140 }));
