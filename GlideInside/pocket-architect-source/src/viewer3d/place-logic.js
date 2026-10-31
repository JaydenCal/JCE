// Pure logic for placing things in front of the player and for moving the player between levels.
// No DOM and no three.js, so it runs in Node tests. World X, Z are metres; plan x, y are millimetres.

import * as G from '../model/geometry.js';
import * as F from './footprint.js';
import { resolveCollisions, chooseSpawn } from './colliders.js';
import { snapMm, footprintOf, clashingWall } from './edit-logic.js';

export const AHEAD_MM = 1500;
const DEG = 180 / Math.PI;

const showStatus = (statusView, status) => {
  const s = status || 'new';
  if (statusView === 'both') return true;
  if (statusView === 'existing') return s !== 'new';
  return s !== 'demolish';
};

// Test for "is this world point (m) on the floor of the level": inside an indoor room, else inside the
// walled area when the level has no rooms, else anywhere (an open frame such as a carport).
export function footprintTester(project, levelId, { statusView = 'proposed' } = {}) {
  const level = project.levels.find((l) => l.id === levelId) || project.levels[0];
  if (!level) return () => true;
  const rooms = level.rooms.filter((r) => !r.outdoor && r.polygon.length >= 3 && showStatus(statusView, r.status));
  if (rooms.length) {
    const boxes = rooms.map((r) => ({ poly: r.polygon, bb: G.bbox(r.polygon) }));
    return (x, z) => {
      const p = { x: x * 1000, y: z * 1000 };
      return boxes.some((b) => p.x >= b.bb.minX && p.x <= b.bb.maxX && p.y >= b.bb.minY && p.y <= b.bb.maxY && G.pointInPolygon(p, b.poly));
    };
  }
  const grid = F.makeGrid(project);
  const ras = F.rasteriseLevel(grid, level, (s) => showStatus(statusView, s));
  let any = false;
  for (let k = 0; k < ras.enclosed.length; k++) {
    if (ras.enclosed[k]) {
      any = true;
      break;
    }
  }
  if (!any) return () => true;
  return (x, z) => !!F.sampleMask(grid, ras.enclosed, x * 1000, z * 1000);
}

// Keep the player at (x, z) when changing level. If that spot is not on the new level's floor, or is inside a
// wall, return the nearest point (searched outwards in rings) that is both. Falls back to the level's spawn.
// Returns { x, z, moved }.
export function nudgeToFloor(project, levelId, x, z, { statusView = 'proposed', colliders = [], step = 0.1, maxRadius = 12 } = {}) {
  const inFoot = footprintTester(project, levelId, { statusView });
  const valid = (px, pz) => {
    if (!inFoot(px, pz)) return false;
    const f = resolveCollisions({ x: px, z: pz }, colliders);
    return Math.hypot(f.x - px, f.z - pz) < 1e-3;
  };
  if (valid(x, z)) return { x, z, moved: false };
  // A wall push alone may be enough
  const pushed = resolveCollisions({ x, z }, colliders);
  if (valid(pushed.x, pushed.z)) return { x: pushed.x, z: pushed.z, moved: true };
  for (let r = step; r <= maxRadius; r += step) {
    const n = Math.max(12, Math.ceil((2 * Math.PI * r) / step));
    let best = null;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (valid(px, pz)) {
        best = { x: px, z: pz };
        break;
      }
    }
    if (best) return { ...best, moved: true };
  }
  const s = chooseSpawn(project, levelId, { statusView });
  return { x: s.x, z: s.z, moved: true };
}

// Horizontal unit direction (world x, z) for a camera yaw (three.js, 0 looks along -Z).
export const yawToDir = (yaw) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

// Rotation (degrees clockwise, 0..359) that turns an item's front (+y in plan) towards the direction (dx, dy).
export function facingRotation(dx, dy) {
  if (Math.hypot(dx, dy) < 1e-9) return 0;
  const deg = Math.round(Math.atan2(-dx, dy) * DEG);
  return ((deg % 360) + 360) % 360;
}

// Where an item goes when placed `dist` mm along `dir` from `origin` (plan mm, dir a unit vector in plan).
// The item faces back towards the origin. `sizeOf(itemId)` gives { w, d } in mm.
export function aheadPlacement(origin, dir, itemId, { dist = AHEAD_MM, sizeOf = () => null, level = null, size = null } = {}) {
  const rotation = facingRotation(-dir.x, -dir.y);
  const at = (t) => ({ x: snapMm(origin.x + dir.x * t), y: snapMm(origin.y + dir.y * t) });
  const def = size || sizeOf(itemId) || null;
  const probe = { item: itemId, w: def?.w, d: def?.d };
  const clash = (p) => !!level && !!def && !!clashingWall(level, footprintOf('furniture', probe, p.x, p.y, rotation, () => def));
  let p = at(dist);
  let clashes = clash(p);
  if (clashes) {
    // Pull the item back towards the player until it clears the wall
    for (let t = dist - 150; t >= 600; t -= 150) {
      const q = at(t);
      if (!clash(q)) {
        p = q;
        clashes = false;
        break;
      }
    }
    if (clashes) p = at(dist);
  }
  return { x: p.x, y: p.y, rotation, clashes };
}
