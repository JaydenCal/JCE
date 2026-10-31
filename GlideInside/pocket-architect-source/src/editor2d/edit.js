// Project edits the registry has no operation for. Each helper mutates the project it is given,
// so the editor can run it inside store.apply(label, fn) or on a clone for a live drag preview.

import * as G from '../model/geometry.js';
import { normaliseWalls, classifyWalls } from '../model/ops.js';

export const MIN_WALL = 10;

export function endpointsAt(level, point, tol = G.TOL) {
  const hits = [];
  for (const w of level.walls) for (const end of ['a', 'b']) if (G.samePoint(w[end], point, tol)) hits.push({ wall: w, end });
  return hits;
}

// Keep every opening inside its wall; drop those whose wall has become too short.
export function refitOpenings(level) {
  level.openings = level.openings.filter((o) => {
    const w = level.walls.find((x) => x.id === o.wallId);
    if (!w) return false;
    const L = G.wallLength(w);
    if (L < 500) return false;
    o.width = Math.min(o.width, L - 200);
    o.offset = G.clamp(o.offset, 100 + o.width / 2, L - 100 - o.width / 2);
    return true;
  });
}

// Drag a wall end: every wall end and room corner at `from` moves to `to`.
export function moveEndpoint(project, level, from, to) {
  const target = { x: Math.round(to.x), y: Math.round(to.y) };
  const hits = endpointsAt(level, from);
  if (!hits.length) throw new Error('There is no wall end at that point');
  const before = new Map(hits.map((h) => [h.wall.id, G.wallLength(h.wall)]));
  for (const h of hits) h.wall[h.end] = { ...target };
  for (const h of hits) {
    if (h.end !== 'a') continue;
    const dl = G.wallLength(h.wall) - before.get(h.wall.id);
    for (const o of level.openings) if (o.wallId === h.wall.id) o.offset += dl;
  }
  for (const r of level.rooms) r.polygon = r.polygon.map((q) => (G.samePoint(q, from) ? { ...target } : q));
  level.walls = level.walls.filter((w) => G.wallLength(w) >= MIN_WALL);
  normaliseWalls(level);
  refitOpenings(level);
  classifyWalls(project, level);
  return target;
}

// Walls whose both ends lie on the room outline and on no other indoor room outline.
export function exclusiveWalls(level, room) {
  const onOutline = (w, poly) => G.polygonEdges(poly).some(([p, q]) => G.pointOnSegment(w.a, p, q) && G.pointOnSegment(w.b, p, q));
  const others = level.rooms.filter((r) => r !== room && !r.outdoor);
  return level.walls.filter((w) => onOutline(w, room.polygon) && !others.some((r) => onOutline(w, r.polygon)));
}

export function wallsOfRoom(level, room) {
  const onOutline = (w) => G.polygonEdges(room.polygon).some(([p, q]) => G.pointOnSegment(w.a, p, q) && G.pointOnSegment(w.b, p, q));
  return level.walls.filter(onOutline);
}

// Ids to mark when the status brush hits something.
export function statusIdsFor(level, kind, item) {
  if (kind === 'wall') return [item.id, ...level.openings.filter((o) => o.wallId === item.id).map((o) => o.id)];
  if (kind === 'room') {
    if (item.outdoor) return [item.id];
    const walls = exclusiveWalls(level, item);
    const wallIds = new Set(walls.map((w) => w.id));
    return [item.id, ...walls.map((w) => w.id), ...level.openings.filter((o) => wallIds.has(o.wallId)).map((o) => o.id)];
  }
  return [item.id];
}

// There is no update_stair operation, so stairs are edited here (inside store.apply).
export function patchStair(project, id, patch) {
  for (const l of project.levels) {
    const s = l.stairs.find((x) => x.id === id);
    if (!s) continue;
    if (patch.x != null) s.x = Math.round(patch.x);
    if (patch.y != null) s.y = Math.round(patch.y);
    if (patch.width != null) s.width = G.clamp(Number(patch.width), 600, 3000);
    if (patch.length != null) s.length = G.clamp(Number(patch.length), 1000, 8000);
    if (patch.rotation != null) s.rotation = ((Number(patch.rotation) % 360) + 360) % 360;
    return s;
  }
  throw new Error(`No stair with id ${id}`);
}

export function setNorth(project, deg) {
  project.site.northDeg = ((Math.round(Number(deg) || 0) % 360) + 360) % 360;
}
