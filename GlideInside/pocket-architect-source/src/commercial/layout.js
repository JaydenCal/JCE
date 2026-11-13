// Rows to unit rectangles. A row is a run of `count` units side by side along its u axis. Local frame: origin o = (row.x, row.y),
// u = (cos, sin) of rotationDeg, v = u turned a quarter turn (y down), so at 0 degrees units run left to right and the FRONT
// (roller doors) faces down the screen. A row with mirrorOf is the back to back partner of that source row: same origin, same
// unit widths and count, v reversed, so its fronts face the other way and the two rear walls are one shared party wall.

import { unitSpec, doorSize, PERSONNEL_DOOR, SLAB_MM, MIN_CLEAR_MM } from './schema.js';

const rad = (d) => (d * Math.PI) / 180;
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });

export const MARGIN_MM = 300;
export const GAP_MM = 300;
export const PARTY_WALL_MM = 200;

/** { o, u, v, f, src, mirrored }: f is the direction the fronts face (v, or -v for a mirrored row). */
export function rowFrame(row, rows) {
  const src = row.mirrorOf ? rows.find((r) => r.id === row.mirrorOf && !r.mirrorOf) : null;
  const base = src || row;
  const a = rad(base.rotationDeg || 0);
  const u = { x: Math.cos(a), y: Math.sin(a) };
  const v = { x: -Math.sin(a), y: Math.cos(a) };
  const mirrored = !!src;
  return { o: { x: base.x, y: base.y }, u, v, f: mirrored ? mul(v, -1) : v, src: src || null, mirrored };
}

/** Unit widths of a row (a mirrored row takes its source's). */
export function unitWidths(row, rows) {
  const src = row.mirrorOf ? rows.find((r) => r.id === row.mirrorOf && !r.mirrorOf) : null;
  const base = src || row;
  return Array.from({ length: base.count }, (_, i) => unitSpec(base, i).widthMm);
}

/**
 * The facade layout of one unit, left to right in u: roller doors, then the personnel door, then the office window or shopfront.
 * Offsets are the centre of each item from the unit's left edge. Returns { doors, personnel, window, highlight, issues }.
 */
export function facadeLayout(spec) {
  const W = spec.widthMm;
  const issues = [];
  const ds = doorSize(spec.doors);
  const count = spec.doors.count === 2 ? 2 : 1;
  let cursor = MARGIN_MM + (Number(spec.doors.offsetMm) || 0);
  const doors = [];
  for (let k = 0; k < count; k++) {
    doors.push({ offset: cursor + ds.w / 2, w: ds.w, h: ds.h });
    cursor += ds.w + GAP_MM;
  }
  let personnel = null;
  if (spec.doors.personnel) {
    personnel = { offset: cursor + PERSONNEL_DOOR.widthMm / 2, w: PERSONNEL_DOOR.widthMm, h: PERSONNEL_DOOR.heightMm };
    cursor += PERSONNEL_DOOR.widthMm + GAP_MM;
  }
  const usedEnd = cursor - GAP_MM;
  if (usedEnd + MARGIN_MM > W + 0.5 || cursor - GAP_MM - ds.w * count < 0) {
    issues.push({ id: 'doorset', text: `Door set is ${((usedEnd + MARGIN_MM) / 1000).toFixed(2)} m wide on a ${(W / 1000).toFixed(2)} m unit, check the unit width and door size` });
  }
  if (doors[0] && doors[0].offset - ds.w / 2 < 0) issues.push({ id: 'dooredge', text: 'Roller door runs past the unit edge, check the door offset' });
  let win = null;
  const kind = spec.windows.front;
  if (kind === 'office' || kind === 'shopfront') {
    const room = W - MARGIN_MM - cursor;
    const want = kind === 'shopfront' ? room : Math.min(spec.windows.widthMm, room);
    if (!spec.office.enabled) issues.push({ id: 'officewin', text: `${kind === 'shopfront' ? 'Shopfront' : 'Office window'} needs the office switched on` });
    if (want < 900) issues.push({ id: 'winfit', text: `No room for the ${kind === 'shopfront' ? 'shopfront' : 'office window'} beside the doors, widen the unit or shrink the door` });
    else if (kind === 'shopfront') win = { kind: 'shopfront', offset: cursor + want / 2, w: want, h: Math.min(2400, spec.heightMm - 600), sill: 150 };
    else win = { kind: 'office', offset: cursor + want / 2, w: want, h: spec.windows.heightMm, sill: spec.windows.sillMm };
  }
  let highlight = null;
  if (kind === 'highlight') {
    const sill = ds.h + 300;
    const h = Math.min(900, spec.heightMm - sill - 250);
    if (h < 300) issues.push({ id: 'highfit', text: 'No room for a high light strip above the roller door at this unit height' });
    else highlight = { kind: 'highlight', offset: W / 2, w: Math.max(1200, W - 2 * 600), h, sill };
  }
  return { doors, personnel, window: win, highlight, issues };
}

/** The rear window of a unit, or null. High light strip or a small office window. */
export function rearWindow(spec) {
  const kind = spec.windows.rear;
  const W = spec.widthMm;
  if (kind === 'highlight') return { kind: 'highlight', offset: W / 2, w: Math.max(1200, W - 1200), h: 600, sill: Math.min(spec.heightMm - 900, 3000) };
  if (kind === 'office') return { kind: 'office', offset: W / 2, w: Math.min(spec.windows.widthMm, W - 1200), h: spec.windows.heightMm, sill: spec.windows.sillMm };
  return null;
}

/** The mezzanine of a unit: { enabled, areaM2, depthMm, level, clearBelow, clearAbove, stair } (nothing when off). */
export function mezzanineOf(spec) {
  const m = spec.mezzanine;
  if (!m.enabled) return { enabled: false };
  const D = spec.depthMm;
  const depthMm = m.mode === 'percent' ? Math.round((D * Math.min(90, Math.max(5, m.percent))) / 100) : Math.min(D, m.depthMm);
  const areaM2 = (spec.widthMm * depthMm) / 1e6;
  const stair = m.stairType === 'L' ? { type: 'L', widthMm: 1000, lengthMm: 2400, runMm: 2400 } : { type: 'straight', widthMm: 1000, lengthMm: 3600, runMm: 3600 };
  return {
    enabled: true, depthMm, areaM2, position: m.position, level: m.levelMm,
    clearBelow: m.levelMm - (m.slabMm ?? SLAB_MM), clearAbove: spec.heightMm - m.levelMm, minClear: m.minClearMm ?? MIN_CLEAR_MM, stair,
  };
}

/**
 * All units of all rows in plan order. Each unit:
 * { n, rowId, index, row, spec, x0, w, d, poly (rear left, rear right, front right, front left), frontA, frontB, rearA, rearB,
 *   first, last, mirrored, frame, officeDepth }.
 * Unit numbers run through the rows in order.
 */
export function layoutUnits(commercial) {
  const rows = commercial?.rows || [];
  const out = [];
  let n = 0;
  for (const row of rows) {
    const fr = rowFrame(row, rows);
    const widths = unitWidths(row, rows);
    const count = widths.length;
    let x0 = 0;
    for (let i = 0; i < count; i++) {
      const spec = unitSpec(row, i);
      spec.widthMm = widths[i];
      spec.depthMm = row.unit.depthMm; // one depth per row so the front and rear walls are straight
      const w = widths[i];
      const d = spec.depthMm;
      const at = (x, depth) => add(add(fr.o, mul(fr.u, x)), mul(fr.f, depth));
      const rl = at(x0, 0);
      const rr = at(x0 + w, 0);
      const frr = at(x0 + w, d);
      const fl = at(x0, d);
      out.push({ n: ++n, rowId: row.id, index: i, row, spec, x0, w, d, poly: [rl, rr, frr, fl], frontA: fl, frontB: frr, rearA: rl, rearB: rr, first: i === 0, last: i === count - 1, mirrored: fr.mirrored, frame: fr, officeDepth: spec.office.enabled ? spec.office.depthMm : 0 });
      x0 += w;
    }
  }
  return out;
}

/** Total length of a row along u. */
export const rowLength = (row, rows) => unitWidths(row, rows).reduce((a, b) => a + b, 0);

/** Point at distance `along` on u and `depth` on f from a row's origin. */
export function rowPoint(fr, along, depth) {
  return add(add(fr.o, mul(fr.u, along)), mul(fr.f, depth));
}

/** Row footprint (rectangle) of a row; a mirrored row's own rectangle. */
export function rowPoly(row, rows) {
  const fr = rowFrame(row, rows);
  const L = rowLength(row, rows);
  const d = unitSpec(row, 0).depthMm;
  return [rowPoint(fr, 0, 0), rowPoint(fr, L, 0), rowPoint(fr, L, d), rowPoint(fr, 0, d)];
}
