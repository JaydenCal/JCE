// Room edit mode, pure logic (no three, no DOM): what belongs to a room, what may be touched while it is being edited,
// and what a resize or wall move does to the neighbouring rooms that share the wall.
//
// Locking rule: while a room is being edited only the things that belong to it can be changed: the room itself, the walls on its
// outline, the doors and windows in those walls, and the furniture and stairs inside it. Everything else is locked. The one
// deliberate exception is a wall the room shares with a neighbour: moving it also resizes the neighbour (the model already
// does that, see pushPull in model/ops.js), and planResize() reports how far it goes and warns before a neighbour gets too small.

import * as G from '../model/geometry.js';
import { DEFAULTS } from '../model/schema.js';
import { applyOp } from '../model/ops.js';
import { openingGhost } from './edit-logic.js';
import { isIndoor, wallOwners } from './explode-logic.js';

export const SIDES = ['north', 'south', 'east', 'west'];
export const HARD_MIN_SIDE = 500; // mm: below this a room is not a room, the change is refused
export const HARD_MIN_AREA = 0.25e6; // mm2, the same floor the model uses for a new room

// Comfortable minimum clear width by room type (mm). Under it the change is allowed with a warning.
const SOFT_MIN = {
  bedroom: 2400, living: 3000, family: 3000, kitchen: 2000, dining: 2400, bathroom: 1200, ensuite: 1200, wc: 800, laundry: 1200,
  garage: 2700, carport: 2700, study: 2000, entry: 1000, hall: 900, robe: 700, pantry: 700, media: 3000, rumpus: 3000,
  workshop: 2000, store: 900, deck: 1500, patio: 1500, alfresco: 2000, verandah: 1500, other: 1500,
};
export const softMinSide = (type) => SOFT_MIN[type] ?? 1500;

const dims = (room) => {
  const b = G.bbox(room.polygon);
  return { w: Math.round(b.w), d: Math.round(b.h), area: G.polygonArea(room.polygon) };
};
const fmt = (mm) => `${(mm / 1000).toFixed(2)} m`;
const find = (project, roomId) => {
  for (const level of project.levels) {
    const room = level.rooms.find((r) => r.id === roomId);
    if (room) return { room, level };
  }
  return null;
};
const onBoundary = (p, poly, tol = 60) => G.polygonEdges(poly).some(([a, b]) => G.pointOnSegment(p, a, b, tol));

// Scope ---------------------------------------------------------------------------------------------------------
// Everything that belongs to the room. { room, level, wallIds, sharedWallIds, openingIds, furnitureIds, stairIds, neighbourIds }
export function roomScope(project, roomId) {
  const f = find(project, roomId);
  if (!f) return null;
  const { room, level } = f;
  const wallIds = new Set();
  const sharedWallIds = new Set();
  const neighbourIds = new Set();
  const others = level.rooms.filter((r) => r.id !== room.id && isIndoor(r));
  for (const w of level.walls) {
    if (!(onBoundary(w.a, room.polygon) && onBoundary(w.b, room.polygon))) continue;
    wallIds.add(w.id);
    for (const o of others) {
      if (onBoundary(w.a, o.polygon) && onBoundary(w.b, o.polygon)) {
        sharedWallIds.add(w.id);
        neighbourIds.add(o.id);
      }
    }
  }
  const openingIds = new Set(level.openings.filter((o) => wallIds.has(o.wallId)).map((o) => o.id));
  const furnitureIds = new Set(level.furniture.filter((x) => G.pointInPolygon(x, room.polygon)).map((x) => x.id));
  const stairIds = new Set(level.stairs.filter((x) => G.pointInPolygon(x, room.polygon)).map((x) => x.id));
  return { room, level, roomId, wallIds, sharedWallIds, openingIds, furnitureIds, stairIds, neighbourIds };
}

// May this thing be changed while the room is being edited? found: { kind, item } as store.find returns it.
export function canEditEntity(scope, found) {
  if (!scope || !found) return false;
  const id = found.item?.id ?? found.id;
  switch (found.kind) {
    case 'room': return id === scope.roomId;
    case 'wall': return scope.wallIds.has(id);
    case 'opening': return scope.openingIds.has(id);
    case 'furniture': return scope.furnitureIds.has(id);
    case 'stair': return scope.stairIds.has(id);
    default: return false; // levels, tanks and anything else
  }
}
// The same test for a 3D pick ({ kind, id, wallId }). Floors of the room count as the room. Surfaces of other things are locked.
export function canTouchHit(scope, hit) {
  if (!scope || !hit || hit.ground) return false;
  if (hit.kind === 'floor') return hit.id === scope.roomId;
  if (hit.kind === 'opening') return scope.openingIds.has(hit.id);
  return canEditEntity(scope, { kind: hit.kind, item: { id: hit.id } });
}

// A wall can take a window only when it is not shared with a neighbour (those are inside walls); doors can go anywhere on the outline.
export function wallsFor(scope, kind) {
  const ids = [...scope.wallIds].filter((id) => kind === 'door' || kind === 'opening' || !scope.sharedWallIds.has(id));
  return scope.level.walls.filter((w) => ids.includes(w.id));
}

// Which side of the room's box a wall is on, or null.
export function sideOfWall(project, roomId, wallId) {
  const f = find(project, roomId);
  if (!f) return null;
  const w = f.level.walls.find((x) => x.id === wallId);
  if (!w) return null;
  const b = G.bbox(f.room.polygon);
  const tol = 30;
  const horiz = Math.abs(w.a.y - w.b.y) <= tol;
  const vert = Math.abs(w.a.x - w.b.x) <= tol;
  if (horiz && Math.abs(w.a.y - b.minY) <= tol) return 'north';
  if (horiz && Math.abs(w.a.y - b.maxY) <= tol) return 'south';
  if (vert && Math.abs(w.a.x - b.maxX) <= tol) return 'east';
  if (vert && Math.abs(w.a.x - b.minX) <= tol) return 'west';
  return null;
}

// Simulating a change -----------------------------------------------------------------------------------------------
// Run `fn(clone)` on a copy of the project and report what happened to the rooms of that level.
function simulate(project, roomId, fn) {
  const f = find(project, roomId);
  if (!f) return { ok: false, error: 'That room no longer exists.' };
  const before = new Map(f.level.rooms.filter(isIndoor).map((r) => [r.id, { name: r.name, type: r.type, poly: JSON.stringify(r.polygon), ...dims(r) }]));
  const clone = structuredClone(project);
  try {
    fn(clone);
  } catch (e) {
    return { ok: false, error: e.message || 'That change could not be made.' };
  }
  const level = clone.levels.find((l) => l.id === f.level.id);
  const affected = [];
  const warnings = [];
  let blocked = null;
  for (const r of level.rooms.filter(isIndoor)) {
    const b = before.get(r.id);
    if (!b || JSON.stringify(r.polygon) === b.poly) continue;
    const a = dims(r);
    const selected = r.id === roomId;
    const name = r.name || r.type;
    const minSide = Math.min(a.w, a.d);
    let state = 'ok';
    let message = '';
    if (minSide < HARD_MIN_SIDE || a.area < HARD_MIN_AREA) {
      state = 'blocked';
      message = selected ? `That would make ${name} too small (${fmt(a.w)} by ${fmt(a.d)}).` : `That would squash ${name} to ${fmt(a.w)} by ${fmt(a.d)}. Move the wall less.`;
      blocked = blocked || message;
    } else if (minSide < softMinSide(r.type) && minSide < Math.min(b.w, b.d)) {
      state = 'warn';
      message = selected ? `${name} would be only ${fmt(minSide)} wide.` : `${name} next door would shrink to ${fmt(a.w)} by ${fmt(a.d)}, which is tight for a ${r.type === 'other' ? 'room' : r.type}.`;
      warnings.push(message);
    }
    affected.push({ roomId: r.id, name, selected, before: { w: b.w, d: b.d }, after: { w: a.w, d: a.d }, state, message });
  }
  // A neighbour that vanished (merged away) would be a surprise: refuse.
  for (const [id, b] of before) {
    if (!level.rooms.some((r) => r.id === id)) blocked = blocked || `${b.name} would disappear.`;
  }
  const neighbours = affected.filter((x) => !x.selected);
  return {
    ok: !blocked,
    error: blocked,
    affected,
    neighbours,
    warnings,
    selected: affected.find((x) => x.selected) || null,
    result: clone,
  };
}

// Push or pull one side of the room by delta mm (positive grows it). Shared walls resize the neighbour.
export function planResize(project, roomId, side, delta) {
  if (!SIDES.includes(side)) return { ok: false, error: 'Unknown side.', affected: [], neighbours: [], warnings: [] };
  const sim = simulate(project, roomId, (p) => applyOp(p, 'resize_room', { id: roomId, side, delta }));
  return { ...sim, op: { name: 'resize_room', args: { id: roomId, side, delta } } };
}

// Move one wall of the room by (dx, dy). The wall must belong to the room.
export function planWallMove(project, roomId, wallId, dx, dy) {
  const scope = roomScope(project, roomId);
  if (!scope || !scope.wallIds.has(wallId)) return { ok: false, error: 'That wall belongs to another room, which is locked.', affected: [], neighbours: [], warnings: [] };
  const sim = simulate(project, roomId, (p) => applyOp(p, 'move_wall', { id: wallId, dx, dy }));
  return { ...sim, op: { name: 'move_wall', args: { id: wallId, dx, dy } }, shared: scope.sharedWallIds.has(wallId) };
}

// Set the size of the room directly (new width east of its west edge, new depth south of its north edge).
export function planSetSize(project, roomId, { width, depth }) {
  const f = find(project, roomId);
  if (!f) return { ok: false, error: 'That room no longer exists.', affected: [], neighbours: [], warnings: [] };
  const b = G.bbox(f.room.polygon);
  const steps = [];
  if (width != null && Math.round(width) !== Math.round(b.w)) steps.push({ side: 'east', delta: Math.round(width - b.w) });
  if (depth != null && Math.round(depth) !== Math.round(b.h)) steps.push({ side: 'south', delta: Math.round(depth - b.h) });
  if (!steps.length) return { ok: true, affected: [], neighbours: [], warnings: [], steps, result: project };
  const sim = simulate(project, roomId, (p) => { for (const s of steps) applyOp(p, 'resize_room', { id: roomId, ...s }); });
  return { ...sim, steps };
}

// Doors and windows ------------------------------------------------------------------------------------------------
// Where a new opening of this kind fits in the room: { wallId, offset } or null. side: limit to one side of the room.
export function suggestOpening(project, roomId, kind, side = null) {
  const scope = roomScope(project, roomId);
  if (!scope) return null;
  let walls = wallsFor(scope, kind);
  if (side) walls = walls.filter((w) => sideOfWall(project, roomId, w.id) === side);
  walls = [...walls].sort((a, b) => G.wallLength(b) - G.wallLength(a));
  for (const w of walls) {
    const L = G.wallLength(w);
    for (const k of [0.5, 0.3, 0.7, 0.2, 0.8]) {
      const g = openingGhost(scope.level, w, kind, L * k, DEFAULTS.openings);
      if (g.fits) return { wallId: w.id, offset: g.offset, width: g.width };
    }
  }
  return null;
}

// What the panel shows about the room.
export function describeRoom(project, roomId) {
  const scope = roomScope(project, roomId);
  if (!scope) return null;
  const { room, level } = scope;
  const d = dims(room);
  const openings = level.openings.filter((o) => scope.openingIds.has(o.id)).map((o) => ({
    id: o.id, kind: o.kind, width: o.width, shared: scope.sharedWallIds.has(o.wallId), side: sideOfWall(project, roomId, o.wallId),
  }));
  const fixtures = level.furniture.filter((x) => scope.furnitureIds.has(x.id)).map((x) => ({ id: x.id, item: x.item, rotation: x.rotation || 0 }));
  const neighbours = [...scope.neighbourIds].map((id) => ({ id, name: find(project, id)?.room.name || id }));
  return {
    id: room.id, name: room.name, type: room.type, levelId: level.id, ...d, rect: isRect(room.polygon), floor: room.floor || null,
    openings, fixtures, neighbours, walls: scope.wallIds.size, sharedWalls: scope.sharedWallIds.size,
  };
}
export function isRect(poly) {
  if (poly.length !== 4) return false;
  const b = G.bbox(poly);
  return poly.every((p) => (Math.abs(p.x - b.minX) < 2 || Math.abs(p.x - b.maxX) < 2) && (Math.abs(p.y - b.minY) < 2 || Math.abs(p.y - b.maxY) < 2));
}

// Which room is at a 3D point (world metres) on the level at that height: uses the plan point, so a wall or furniture pick resolves too.
export function roomAtPlanPoint(project, xMm, yMm, levelId = null) {
  const levels = levelId ? project.levels.filter((l) => l.id === levelId) : project.levels;
  let best = null;
  for (const l of levels) {
    for (const r of l.rooms) {
      if (!isIndoor(r) || !G.pointInPolygon({ x: xMm, y: yMm }, r.polygon)) continue;
      const a = G.polygonArea(r.polygon);
      if (!best || a < best.area) best = { room: r, level: l, area: a };
    }
  }
  return best;
}

// Rooms that can be edited at all: indoor rooms (and covered outdoor rooms) with an outline and not demolished.
export const editableRooms = (project) => project.levels.flatMap((l) => l.rooms.filter((r) => Array.isArray(r.polygon) && r.polygon.length >= 3 && r.status !== 'demolish').map((r) => ({ room: r, level: l })));

export { wallOwners };
