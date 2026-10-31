// Walking on stairs. Pure functions (no DOM, no three.js) so they run in Node tests.
// Plan coordinates are millimetres; everything returned is in metres in world X, Z (X = x / 1000, Z = y / 1000).
//
// A stair belongs to the level it starts on and climbs along its local +y (plan direction (-sin r, cos r), r the
// plan rotation in degrees clockwise) to the next level above. Its footprint is length x width, centred on (x, y).
// The bottom end is at local v = 0 and the top end at v = length.
//
// How the player uses it:
//  - on the lower level, walking into the footprint near its bottom end starts the climb;
//  - on the upper level, walking down into the top end of the footprint starts the descent;
//  - along the middle two side rails keep the player on the steps, the two ends stay open;
//  - the eye follows the surface (a ramp through the treads), and the active level changes near the top or bottom.

import { resolveCollisions } from './colliders.js';

const DEG = Math.PI / 180;

export const STAIR = {
  rail: 0.04, // half thickness of a side rail
  railOffset: 0.15, // rails sit this far outside the footprint edge, so the walkway is a little wider than the stair
  reach: 2.6, // m: how close the player must be to use the stair with a key press
  lookDeg: 60, // the stair must be roughly in view
  landing: 0.85, // m beyond the end of the stair where the player is placed
  mouth: 0.6, // m at each end where the player can step on or off from the side
  foot: 0.45, // m at the bottom with no rail, so the climb can be joined slightly off line
  switchLow: 0.15, // fraction of the climb below which the active level is the lower one again
};

const levelsSorted = (project) => [...project.levels].sort((a, b) => a.elevation - b.elevation);

// Every stair with the level it starts on, the level it reaches (null when there is none) and its rise in metres.
export function stairInfos(project) {
  const levels = levelsSorted(project);
  const floorToFloor = (project.settings?.floorToFloor || 3000) / 1000;
  const out = [];
  levels.forEach((level, i) => {
    const upper = levels[i + 1] || null;
    for (const s of level.stairs || []) {
      const rise = upper ? (upper.elevation - level.elevation) / 1000 : floorToFloor;
      const a = (s.rotation || 0) * DEG;
      const length = s.length / 1000;
      const width = s.width / 1000;
      const mouth = Math.min(STAIR.mouth, length * 0.25);
      out.push({
        stair: s,
        level,
        upper,
        base: level.elevation / 1000,
        rise,
        cx: s.x / 1000,
        cz: s.y / 1000,
        dx: -Math.sin(a), // climb direction
        dz: Math.cos(a),
        ax: Math.cos(a), // across the stair
        az: Math.sin(a),
        length,
        width,
        mouth,
        connects: !!upper,
        // the active level becomes the upper one before the player reaches the end of the rails, clear of the
        // block on the lower level at the top mouth (the player's radius is 0.25 m)
        switchHigh: Math.max(0.4, (length - mouth - 0.4) / length),
        switchLow: STAIR.switchLow,
      });
    }
  });
  return out;
}

// Position along (v, 0 at the bottom end) and across (u, from the centre line) the stair, in metres.
export function stairLocal(info, x, z) {
  const rx = x - info.cx;
  const rz = z - info.cz;
  return { u: rx * info.ax + rz * info.az, v: rx * info.dx + rz * info.dz + info.length / 2 };
}

// Plan point (m) at local (u, v).
export function stairPoint(info, u, v) {
  const a = v - info.length / 2;
  return { x: info.cx + info.dx * a + info.ax * u, z: info.cz + info.dz * a + info.az * u };
}

// Height of the walking surface above the stair's own level (m) at distance v from the bottom end.
// The surface is a ramp that follows the treads, so the eye rises smoothly with the steps. It levels out over the
// top mouth, which is the landing where the player steps on and off.
export function stairHeight(info, v) {
  const run = Math.max(0.5, info.length - info.mouth);
  return info.rise * Math.max(0, Math.min(1, v / run));
}

// The stair whose footprint contains the point (x, z), among the stairs that touch `levelId` (the level the
// stair starts on, or the level it reaches). Returns { info, u, v, h, frac } or null.
export function stairZoneAt(infos, levelId, x, z, margin = 0) {
  for (const info of infos) {
    if (!info.connects || (info.level.id !== levelId && info.upper.id !== levelId)) continue;
    const { u, v } = stairLocal(info, x, z);
    if (Math.abs(u) <= info.width / 2 + margin && v >= -margin && v <= info.length + margin) {
      const vv = Math.max(0, Math.min(info.length, v));
      return { info, u, v: vv, h: stairHeight(info, vv), frac: vv / info.length };
    }
  }
  return null;
}

// May the player start using the stair here? From the lower level only near its bottom end; from the upper level
// only when stepping down into its top end (the step is the horizontal move this frame, metres).
export function canJoinStair(zone, levelId, step = { x: 0, z: 0 }) {
  const { info } = zone;
  if (levelId === info.level.id) return zone.v <= STAIR.mouth;
  if (levelId === info.upper?.id) {
    const along = step.x * info.dx + step.z * info.dz;
    return zone.v >= info.length - info.mouth && along < -1e-6;
  }
  return false;
}

// The level the player belongs to while on the stair, with hysteresis so the level does not flicker.
export function levelOnStair(info, frac, currentId) {
  if (!info.upper) return info.level.id;
  if (currentId === info.level.id && frac >= info.switchHigh) return info.upper.id;
  if (currentId === info.upper.id && frac <= info.switchLow) return info.level.id;
  return currentId === info.upper.id ? info.upper.id : info.level.id;
}

// Rectangles (the collider shape used by resolveCollisions) that keep the player on the stair: two side rails
// along the middle, leaving both ends open. On the lower level the top end is blocked, because the steps meet the
// floor above there. A stair that reaches no level is a solid block.
export function stairColliders(project, levelId, infos = stairInfos(project)) {
  const out = [];
  for (const info of infos) {
    const isLower = info.level.id === levelId;
    if (!isLower && info.upper?.id !== levelId) continue;
    const base = { ux: info.dx, uz: info.dz, wallId: null, stair: info.stair.id };
    if (!info.connects) {
      out.push({ ...base, cx: info.cx, cz: info.cz, hl: info.length / 2, ht: info.width / 2 });
      continue;
    }
    const v0 = Math.min(STAIR.foot, info.length / 4);
    const v1 = info.length - info.mouth;
    const mid = stairPoint(info, 0, (v0 + v1) / 2);
    for (const side of [-1, 1]) {
      const off = side * (info.width / 2 + STAIR.railOffset);
      out.push({ ...base, cx: mid.x + info.ax * off, cz: mid.z + info.az * off, hl: (v1 - v0) / 2, ht: STAIR.rail });
    }
    if (isLower) {
      // top mouth is not for walking on from this level
      const top = stairPoint(info, 0, info.length - info.mouth / 2);
      out.push({ ...base, cx: top.x, cz: top.z, hl: info.mouth / 2, ht: info.width / 2 + STAIR.railOffset });
    }
  }
  return out;
}

// Candidate places to stand after taking the stair, best first, each with the way to face.
// side 'top' is past the top end (on the upper level), 'bottom' past the bottom end (on the lower level).
function landingCandidates(info, side) {
  const k = side === 'top' ? 1 : -1;
  const vEnd = side === 'top' ? info.length : 0;
  const vIn = side === 'top' ? info.length - 0.3 : 0.3;
  const anchor = stairPoint(info, 0, vIn);
  const out = [];
  const add = (u, v) => {
    const p = stairPoint(info, u, v);
    out.push({ x: p.x, z: p.z, anchor });
  };
  add(0, vEnd + k * STAIR.landing);
  add(0, vEnd + k * (STAIR.landing + 0.5));
  const off = info.width / 2 + 0.75;
  for (const su of [1, -1]) add(su * off, vIn);
  for (const su of [1, -1]) add(su * (off + 0.6), vIn);
  add(0, vEnd + k * 0.45);
  return out;
}

const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

// Where the player ends up after taking the stair. `valid(x, z)` says whether a point is a good place to stand on
// the target level (on its floor, clear of walls); `colliders` are that level's walls, so the route from the
// stair to the spot does not pass through one. Falls back to the first candidate.
export function chooseLanding(info, side, { valid = () => true, colliders = [] } = {}) {
  const levelId = side === 'top' ? info.upper?.id : info.level.id;
  const cands = landingCandidates(info, side);
  const clear = (a, b) => {
    const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1));
    for (let i = 1; i <= n; i++) {
      const x = a.x + ((b.x - a.x) * i) / n;
      const z = a.z + ((b.z - a.z) * i) / n;
      const f = resolveCollisions({ x, z }, colliders.filter((c) => !c.stair), 0.05);
      if (Math.hypot(f.x - x, f.z - z) > 1e-3) return false;
    }
    return true;
  };
  let pick = cands.find((c) => valid(c.x, c.z) && clear(c.anchor, c));
  if (!pick) pick = cands.find((c) => valid(c.x, c.z));
  if (!pick) pick = cands[0];
  // face away from the stair when stepping off it
  const fx = pick.x - pick.anchor.x;
  const fz = pick.z - pick.anchor.z;
  const l = Math.hypot(fx, fz);
  const yaw = l > 1e-6 ? yawTo(fx / l, fz / l) : yawTo(info.dx * (side === 'top' ? 1 : -1), info.dz * (side === 'top' ? 1 : -1));
  return { x: pick.x, z: pick.z, yaw, levelId };
}

// The stair the player is near and roughly facing, on level `levelId`, or null. `goes` says whether it leads up or
// down from this level. pos: { x, z } metres, yaw: camera yaw (radians, 0 looks down -Z).
export function findStairTarget(infos, levelId, pos, yaw, { reach = STAIR.reach, lookDeg = STAIR.lookDeg } = {}) {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const cosMin = Math.cos(lookDeg * DEG);
  let best = null;
  for (const info of infos) {
    if (!info.connects || (info.level.id !== levelId && info.upper.id !== levelId)) continue;
    const { u, v } = stairLocal(info, pos.x, pos.z);
    // distance from the player to the footprint rectangle
    const du = Math.max(0, Math.abs(u) - info.width / 2);
    const dv = Math.max(0, -v, v - info.length);
    const near = Math.hypot(du, dv);
    if (near > reach) continue;
    const dx = info.cx - pos.x;
    const dz = info.cz - pos.z;
    const dist = Math.hypot(dx, dz);
    const cosA = near < 0.05 ? 1 : (dx * fx + dz * fz) / Math.max(dist, 1e-6);
    if (cosA < cosMin) continue;
    if (!best || near < best.dist) best = { info, dist: near, goes: levelId === info.level.id ? 'up' : 'down' };
  }
  return best;
}
