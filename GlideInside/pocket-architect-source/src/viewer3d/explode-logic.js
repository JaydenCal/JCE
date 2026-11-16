// Exploded view maths for room edit mode. Pure: no three, no DOM, so it runs under node --test.
// Units: the project is in millimetres (plan x, y); every returned offset, pose and extent is in metres in world space
// (X = x / 1000, Z = y / 1000, Y up). explode.js applies these to the meshes and the camera.
//
// One master progress p (0 collapsed .. 1 fully exploded and flown in) drives a staged cinematic:
//   camera pulls back and tilts, the roof lifts, the floors separate, the rooms slide out, the others fade, the camera flies in.
// Collapse is the same curve played backwards, so the two always match.

import * as G from '../model/geometry.js';

export const LEVEL_GAP = 2.4; // m of extra height between floors when fully exploded
export const ROOF_LIFT = 3.6; // m the roof rises above its own (separated) level
export const SLIDE_K = 0.42; // rooms move outward by this fraction of their distance from the building centre
export const MIN_GAP = 0.9; // m: every room that is not at the centre moves out by at least this much
export const FADE_TO = 0.16; // opacity of locked rooms when fully exploded
export const ROOF_FADE_TO = 0.3;
export const DURATION_S = 2.4; // whole explode, seconds
export const COLLAPSE_S = 1.8;

export const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const smooth = (t) => {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10); // smootherstep: zero slope at both ends
};
export const easeInOutCubic = (t) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
export const lerp = (a, b, t) => (t >= 1 ? b : a + (b - a) * t);
export const lerp3 = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });
const phase = (p, a, b) => smooth((p - a) / (b - a));

// The staged curves for master progress p in [0, 1].
export function phases(p) {
  const q = clamp01(p);
  return {
    p: q,
    pull: phase(q, 0, 0.45), // camera pulls back and tilts to the overview
    roof: phase(q, 0.08, 0.5), // roof lifts away
    levels: phase(q, 0.2, 0.65), // floors separate
    slide: phase(q, 0.38, 0.85), // rooms slide outward
    fade: phase(q, 0.6, 0.9), // the other rooms fade back
    fly: phase(q, 0.68, 1), // camera flies in to the selected room
  };
}

// Advance the master progress towards target (0 or 1) by dt seconds. reduced: jump.
export function stepProgress(cur, target, dtSec, { reduced = false, up = DURATION_S, down = COLLAPSE_S } = {}) {
  if (reduced || !Number.isFinite(dtSec)) return target;
  if (cur === target) return cur;
  const dur = target > cur ? up : down;
  const step = dtSec / dur;
  return target > cur ? Math.min(target, cur + step) : Math.max(target, cur - step);
}

// Rooms and levels ------------------------------------------------------------------------------------------
export const sortedLevels = (project) => [...project.levels].sort((a, b) => a.elevation - b.elevation);
export const isIndoor = (r) => !r.outdoor && Array.isArray(r.polygon) && r.polygon.length >= 3 && r.status !== 'demolish';
const hasPoly = (r) => Array.isArray(r.polygon) && r.polygon.length >= 3 && r.status !== 'demolish';

export function findRoom(project, roomId) {
  for (const level of project.levels) {
    const room = level.rooms.find((r) => r.id === roomId);
    if (room) return { room, level };
  }
  return null;
}

// Centre of the building on the plan (mm): the middle of the box round every room with an outline.
export function buildingCentre(project) {
  const pts = [];
  for (const l of project.levels) for (const r of l.rooms) if (hasPoly(r)) pts.push(...r.polygon);
  if (!pts.length) for (const l of project.levels) for (const w of l.walls) pts.push(w.a, w.b);
  if (!pts.length) return { x: 0, y: 0 };
  const b = G.bbox(pts);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

// Where every room goes when fully exploded (selectedId, the room being edited, stays put): { centre, levels: Map(levelId -> {index, y, roofY}), rooms: Map(roomId -> {x, z}) } in metres.
export function explodeTargets(project, { levelGap = LEVEL_GAP, roofLift = ROOF_LIFT, slideK = SLIDE_K, minGap = MIN_GAP, selectedId = null } = {}) {
  const centre = buildingCentre(project);
  const levels = new Map();
  const rooms = new Map();
  sortedLevels(project).forEach((l, i) => {
    const y = i * levelGap;
    levels.set(l.id, { index: i, y, roofY: y + levelGap * 0.5 + roofLift });
    for (const r of l.rooms) {
      if (!hasPoly(r)) continue;
      const c = G.polygonCentroid(r.polygon);
      const dx = (c.x - centre.x) / 1000;
      const dz = (c.y - centre.y) / 1000;
      const d = Math.hypot(dx, dz);
      const ux = d > 0.05 ? dx / d : 0;
      const uz = d > 0.05 ? dz / d : 0;
      const push = d > 0.05 ? minGap : 0;
      // the room being edited stays where it is (its level still lifts): the others slide away from it
      rooms.set(r.id, r.id === selectedId ? { x: 0, z: 0 } : { x: dx * slideK + ux * push, z: dz * slideK + uz * push });
    }
  });
  return { centre, levels, rooms, levelGap, roofLift };
}

// Metre offset of a unit (a group of meshes) at stage `ph`. unit: { role: 'room'|'level'|'roof', roomId?, levelId }.
export function offsetFor(targets, unit, ph) {
  const lv = targets.levels.get(unit.levelId) || { y: 0, roofY: 0 };
  let x = 0;
  let z = 0;
  if (unit.role === 'room' && unit.roomId) {
    const r = targets.rooms.get(unit.roomId);
    if (r) { x = r.x * ph.slide; z = r.z * ph.slide; }
  }
  let y = lv.y * ph.levels;
  if (unit.role === 'roof') y = lv.y * ph.levels + (lv.roofY - lv.y) * ph.roof;
  return { x: x || 0, y: y || 0, z: z || 0 };
}

// Opacity of a unit at stage `ph` while `selectedId` is being edited.
export function opacityFor(unit, selectedId, ph) {
  if (unit.role === 'roof') return lerp(1, ROOF_FADE_TO, ph.fade);
  if (unit.role === 'room' && unit.roomId === selectedId) return 1;
  return lerp(1, FADE_TO, ph.fade);
}
export const isLockedUnit = (unit, selectedId) => !(unit.role === 'room' && unit.roomId === selectedId);

// Who owns which wall, opening, furniture item: the room it belongs to --------------------------------------------
const onBoundary = (p, poly, tol = 60) => G.polygonEdges(poly).some(([a, b]) => G.pointOnSegment(p, a, b, tol));
const distToPoly = (p, poly) => Math.min(...G.polygonEdges(poly).map(([a, b]) => G.projectToSegment(p, a, b).d));

// A wall lies on the boundary of a room when both ends are on its outline. Walls shared by two rooms go to the selected room if
// it is one of them, otherwise to the first. A free wall goes to the nearest room within 1.5 m, else to no room (it stays with its level).
export function wallOwners(project, selectedId = null) {
  const out = new Map();
  for (const level of project.levels) {
    const rooms = level.rooms.filter(isIndoor);
    for (const w of level.walls) {
      const on = rooms.filter((r) => onBoundary(w.a, r.polygon) && onBoundary(w.b, r.polygon));
      let owner = on.find((r) => r.id === selectedId) || on[0] || null;
      if (!owner) {
        const m = G.wallMid(w);
        let best = 1500;
        for (const r of rooms) {
          const d = distToPoly(m, r.polygon);
          if (d < best) { best = d; owner = r; }
        }
      }
      out.set(w.id, { roomId: owner ? owner.id : null, levelId: level.id, rooms: on.map((r) => r.id) });
    }
  }
  return out;
}

// The room an item (furniture, stair) at a plan point sits in, or the nearest room within 1.5 m.
export function roomOfPoint(level, p) {
  const rooms = level.rooms.filter(hasPoly);
  const inside = rooms.filter((r) => G.pointInPolygon(p, r.polygon));
  if (inside.length) return inside.sort((a, b) => G.polygonArea(a.polygon) - G.polygonArea(b.polygon))[0].id; // the smallest holds it
  let best = 1500;
  let id = null;
  for (const r of rooms) {
    const d = distToPoly(p, r.polygon);
    if (d < best) { best = d; id = r.id; }
  }
  return id;
}

// Classify one mesh from its userData (kind, id, levelId) into a unit: { role, roomId, levelId } or null when it stays put (ground, site).
export function classify(project, data, owners = wallOwners(project)) {
  if (!data || data.ground) return null;
  const levelId = data.levelId;
  if (!levelId) return null;
  const level = project.levels.find((l) => l.id === levelId);
  if (!level) return null;
  switch (data.kind) {
    case 'roof': return { role: 'roof', roomId: null, levelId };
    case 'floor':
    case 'deck': {
      const r = level.rooms.find((x) => x.id === data.id);
      return { role: 'room', roomId: r ? r.id : null, levelId };
    }
    case 'wall': return { role: 'room', roomId: owners.get(data.id)?.roomId ?? null, levelId };
    case 'opening': {
      const w = data.wallId || level.openings.find((o) => o.id === data.id)?.wallId;
      return { role: 'room', roomId: owners.get(w)?.roomId ?? null, levelId };
    }
    case 'furniture': {
      const f = level.furniture.find((x) => x.id === data.id);
      return { role: 'room', roomId: f ? roomOfPoint(level, f) : null, levelId };
    }
    case 'stair': {
      const s = level.stairs.find((x) => x.id === data.id);
      return { role: 'room', roomId: s ? roomOfPoint(level, s) : null, levelId };
    }
    default: return { role: 'level', roomId: null, levelId }; // slab, ceilings and other decor of the level
  }
}

// Camera --------------------------------------------------------------------------------------------------------
const RAD = Math.PI / 180;
export function poseAround(target, dist, azimuthDeg, elevationDeg) {
  const az = azimuthDeg * RAD;
  const el = elevationDeg * RAD;
  return {
    position: { x: target.x + Math.sin(az) * Math.cos(el) * dist, y: target.y + Math.sin(el) * dist, z: target.z + Math.cos(az) * Math.cos(el) * dist },
    target: { ...target },
  };
}
// Distance at which a sphere of `radius` fits the narrower of the two fields of view, with a margin.
export function fitDistance(radius, { fov = 38, aspect = 1.6, margin = 1.12 } = {}) {
  const v = Math.tan((fov * RAD) / 2);
  const h = v * Math.max(0.2, aspect);
  return (radius / Math.min(v, h)) * margin;
}

// Box (metres) round the exploded building at full explode: { min, max, centre, radius }.
export function explodedExtent(project, targets = explodeTargets(project)) {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  const grow = (x, y, z) => {
    min.x = Math.min(min.x, x); min.y = Math.min(min.y, y); min.z = Math.min(min.z, z);
    max.x = Math.max(max.x, x); max.y = Math.max(max.y, y); max.z = Math.max(max.z, z);
  };
  for (const l of project.levels) {
    const lv = targets.levels.get(l.id);
    const base = l.elevation / 1000;
    const top = base + l.height / 1000;
    const pts = l.rooms.filter(hasPoly).flatMap((r) => r.polygon.map((q) => ({ q, o: targets.rooms.get(r.id) || { x: 0, z: 0 } })));
    for (const w of l.walls) for (const q of [w.a, w.b]) pts.push({ q, o: { x: 0, z: 0 } });
    for (const { q, o } of pts) {
      grow(q.x / 1000 + o.x, base + lv.y, q.y / 1000 + o.z);
      grow(q.x / 1000 + o.x, top + lv.roofY, q.y / 1000 + o.z);
    }
  }
  if (!Number.isFinite(min.x)) return { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 }, centre: { x: 0.5, y: 0.5, z: 0.5 }, radius: 1 };
  const centre = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
  return { min, max, centre, radius: Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z) / 2 };
}

// The poses of the cinematic: where the camera starts, the pulled back overview, and the close view of the selected room.
export function cinematicPoses(project, roomId, base, { fov = 38, aspect = 1.6, azimuthDeg = 38 } = {}) {
  const targets = explodeTargets(project, { selectedId: roomId });
  const ext = explodedExtent(project, targets);
  const overview = poseAround(ext.centre, fitDistance(ext.radius, { fov, aspect }), azimuthDeg, 30);
  const found = findRoom(project, roomId);
  let focus = overview;
  let roomRadius = 2;
  let roomCentre = { ...ext.centre };
  if (found) {
    const lv = targets.levels.get(found.level.id);
    const off = targets.rooms.get(roomId) || { x: 0, z: 0 };
    const c = G.polygonCentroid(found.room.polygon);
    const bb = G.bbox(found.room.polygon);
    roomRadius = Math.max(1.2, Math.hypot(bb.w, bb.h) / 2000);
    roomCentre = { x: c.x / 1000 + off.x, y: found.level.elevation / 1000 + lv.y + 0.6, z: c.y / 1000 + off.z };
    focus = poseAround(roomCentre, fitDistance(roomRadius * 1.15, { fov, aspect, margin: 1.0 }), azimuthDeg, 50);
  }
  return { base, overview, focus, targets, extent: ext, roomCentre, roomRadius };
}

// Camera pose at stage ph: pull back and tilt first, then fly in.
export function cameraAt(ph, poses) {
  const a = {
    position: lerp3(poses.base.position, poses.overview.position, ph.pull),
    target: lerp3(poses.base.target, poses.overview.target, ph.pull),
  };
  return {
    position: lerp3(a.position, poses.focus.position, ph.fly),
    target: lerp3(a.target, poses.focus.target, ph.fly),
  };
}
