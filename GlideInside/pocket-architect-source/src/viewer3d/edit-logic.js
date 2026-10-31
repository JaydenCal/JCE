// Pure logic for editing in the 3D view (no DOM, no three.js): snapping, drag maths, clash tests and
// the geometry of the ghost opening. Plan coordinates are millimetres, the same as the project.

import * as G from '../model/geometry.js';

export const SNAP_MM = 50;
export const CLASH_INSET = 15; // same tolerance as furnitureClashes in the model
export const MIN_WALL_MM = 100;
export const MIN_ROOM_MM = 500;
export const ENDPOINT_SNAP_MM = 150;
export const ORTHO_SNAP_MM = 100;

export const snapMm = (v, step = SNAP_MM) => {
  const r = Math.round(v / step) * step;
  return r === 0 ? 0 : r; // never -0
};
export const snapPt = (p, step = SNAP_MM) => ({ x: snapMm(p.x, step), y: snapMm(p.y, step) });

// Plan footprint corners of a movable item placed at (x, y) with a rotation (degrees clockwise).
export function footprintOf(kind, item, x, y, rotation, sizeOf = () => null) {
  if (kind === 'furniture') {
    const def = sizeOf(item.item) || {};
    const w = item.w ?? def.w;
    const d = item.d ?? def.d;
    if (!w || !d) return null;
    return G.rectCorners(x, y, w, d, rotation ?? item.rotation ?? 0);
  }
  if (kind === 'tank') return G.rectCorners(x, y, item.diameter, item.diameter, 0);
  if (kind === 'stair') return G.rectCorners(x, y, item.width, item.length, rotation ?? item.rotation ?? 0);
  return null;
}

// Id of the first wall of the level that the corners overlap (by more than the inset), or null.
export function clashingWall(level, corners, inset = CLASH_INSET) {
  if (!corners || !level) return null;
  for (const wall of level.walls) {
    if (wall.status === 'demolish') continue;
    if (G.convexOverlap(corners, G.wallPolygon(wall), inset)) return wall.id;
  }
  return null;
}

// New centre for a dragged item: the start position plus the pointer movement, snapped.
export function dragPosition(start, grab, cur, step = SNAP_MM) {
  return { x: snapMm(start.x + (cur.x - grab.x), step), y: snapMm(start.y + (cur.y - grab.y), step) };
}

// Sideways wall drag: only the component of the pointer movement along the wall normal counts.
export function wallDragMove(wall, grab, cur, step = SNAP_MM) {
  const n = G.wallNormal(wall);
  const s = snapMm((cur.x - grab.x) * n.x + (cur.y - grab.y) * n.y, step);
  return { s, dx: n.x * s || 0, dy: n.y * s || 0, n };
}

// Snap a point for wall drawing: onto a nearby wall end, else to the grid, then square to the previous point.
export function snapWallPoint(level, raw, last = null, { endpoint = ENDPOINT_SNAP_MM, ortho = ORTHO_SNAP_MM, step = SNAP_MM } = {}) {
  let best = null;
  for (const w of level?.walls || []) {
    for (const e of [w.a, w.b]) {
      const d = G.dist(raw, e);
      if (d <= endpoint && (!best || d < best.d)) best = { d, p: { x: e.x, y: e.y } };
    }
  }
  if (best) return { ...best.p, snapped: 'end' };
  const p = snapPt(raw, step);
  if (last) {
    const dx = Math.abs(p.x - last.x);
    const dy = Math.abs(p.y - last.y);
    if (dx > 0 && dx <= ortho && dx <= dy) return { x: last.x, y: p.y, snapped: 'ortho' };
    if (dy > 0 && dy <= ortho && dy < dx) return { x: p.x, y: last.y, snapped: 'ortho' };
  }
  return { ...p, snapped: 'grid' };
}

// Rectangle between two corner points: { x, y, width, depth } with x, y the north-west corner.
export function rectFromPoints(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), depth: Math.abs(a.y - b.y) };
}

// Where a new window or door would go if placed near `offset` along `wall`.
// Returns the clamped offset, its size, world placement and whether it fits without overlapping another opening.
export function openingGhost(level, wall, kind, offset, defaults, { width, height, sill } = {}) {
  const d = defaults[kind] || defaults.window;
  const L = G.wallLength(wall);
  const margin = 100;
  const w = Math.min(width ?? d.width, Math.max(0, L - 2 * margin));
  const h = height ?? d.height;
  const sl = sill ?? d.sill;
  const off = G.clamp(offset, margin + w / 2, Math.max(margin + w / 2, L - margin - w / 2));
  const span = { start: off - w / 2, end: off + w / 2 };
  const clash = level.openings.find((q) => q.wallId === wall.id && G.openingSpan(q).start < span.end && G.openingSpan(q).end > span.start);
  const c = G.pointOnWall(wall, off);
  return {
    wallId: wall.id,
    kind,
    offset: Math.round(off),
    width: w,
    height: h,
    sill: sl,
    centre: c,
    angle: G.wallAngle(wall),
    thickness: wall.thickness || 100,
    fits: L - 2 * margin >= 300 && !clash,
    clashId: clash?.id || null,
  };
}

export const formatDims = (wMm, dMm) => `${(wMm / 1000).toFixed(2)} x ${(dMm / 1000).toFixed(2)} m`;
export const formatSigned = (mm) => `${mm > 0 ? '+' : ''}${Math.round(mm)} mm`;
export const nextRotation = (current, deg) => {
  const r = ((((current || 0) + deg) % 360) + 360) % 360;
  return Math.round(r * 100) / 100;
};
