import type { BoxCollider, FloorPlane } from './types';

export interface MoveSettings {
  eyeHeight: number; radius: number; height: number; crouchHeight: number;
  walk: number; sprint: number; gravity: number; jump: number; stepUp: number; slopeDeg: number;
}
export const MOVE_DEFAULTS: MoveSettings = {
  eyeHeight: 1.6, radius: 0.3, height: 1.8, crouchHeight: 1.1, walk: 2.8, sprint: 5.2,
  gravity: 18, jump: 5.2, stepUp: 0.4, slopeDeg: 45,
};
export interface PlayerState { x: number; y: number; z: number; vx: number; vy: number; vz: number; grounded: boolean; crouch: number }
export interface MoveInput { fwd: number; right: number; sprint: boolean; jump: boolean; crouch: boolean; yaw: number }
/** highest walkable surface at (x,y) not above zLimit, or null */
export type GroundFn = (x: number, y: number, zLimit: number) => number | null;
export interface MoveWorld { colliders: BoxCollider[]; ground: GroundFn }

export const newPlayer = (x: number, y: number, z: number): PlayerState => ({ x, y, z, vx: 0, vy: 0, vz: 0, grounded: false, crouch: 0 });
export const playerHeight = (s: PlayerState, c: MoveSettings) => c.height + (c.crouchHeight - c.height) * s.crouch;
export const eyeOffset = (s: PlayerState, c: MoveSettings) => c.eyeHeight * (1 - 0.4 * s.crouch);

/** forward unit vector for yaw (radians, clockwise from +Y) */
export const forwardXY = (yaw: number): [number, number] => [Math.sin(yaw), Math.cos(yaw)];

/** Push a circle (x,y,r) out of any collider whose z-range overlaps [zLo,zHi]. */
export function resolveColliders(x: number, y: number, r: number, zLo: number, zHi: number, cols: BoxCollider[]): { x: number; y: number; hit: boolean } {
  let hit = false;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const b of cols) {
      const zmin = b.c[2] - b.s[2] / 2, zmax = b.c[2] + b.s[2] / 2;
      if (zmax <= zLo || zmin >= zHi) continue;
      const a = ((b.yaw ?? 0) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
      const dx = x - b.c[0], dy = y - b.c[1];
      const lx = dx * ca + dy * sa, ly = -dx * sa + dy * ca; // into box frame
      const hx = b.s[0] / 2, hy = b.s[1] / 2;
      const px = Math.max(-hx, Math.min(hx, lx)), py = Math.max(-hy, Math.min(hy, ly));
      let nx = lx - px, ny = ly - py; let d2 = nx * nx + ny * ny;
      if (d2 >= r * r) continue;
      if (d2 > 1e-12) { const d = Math.sqrt(d2), k = (r - d) / d; nx *= k; ny *= k; }
      else { // centre inside box: exit by shallowest axis
        const ox = hx - Math.abs(lx), oy = hy - Math.abs(ly);
        if (ox < oy) { nx = (lx >= 0 ? 1 : -1) * (ox + r); ny = 0; } else { ny = (ly >= 0 ? 1 : -1) * (oy + r); nx = 0; }
      }
      x += nx * ca - ny * sa; y += nx * sa + ny * ca; hit = moved = true;
    }
    if (!moved) break;
  }
  return { x, y, hit };
}

/** Analytic ground from floor planes: highest floor under (x,y) not above zLimit. */
export function floorGround(floors: FloorPlane[], x: number, y: number, zLimit: number): number | null {
  let best: number | null = null;
  for (const f of floors) if (x >= f.min[0] && x <= f.max[0] && y >= f.min[1] && y <= f.max[1] && f.z <= zLimit && (best === null || f.z > best)) best = f.z;
  return best;
}
export const maxGround = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));

/** Advance the player by dt seconds. Pure: returns a new state. */
export function stepPlayer(s0: PlayerState, inp: MoveInput, cfg: MoveSettings, world: MoveWorld, dt: number): PlayerState {
  const s = { ...s0 };
  dt = Math.min(dt, 0.05);
  s.crouch += ((inp.crouch ? 1 : 0) - s.crouch) * Math.min(1, dt * 10);
  const crouching = s.crouch > 0.5;
  const speed = (inp.sprint && !crouching && inp.fwd > 0 ? cfg.sprint : cfg.walk) * (crouching ? 0.5 : 1);
  const [fx, fy] = forwardXY(inp.yaw); const rx = fy, ry = -fx;
  let wx = fx * inp.fwd + rx * inp.right, wy = fy * inp.fwd + ry * inp.right;
  const wl = Math.hypot(wx, wy); if (wl > 1) { wx /= wl; wy /= wl; }
  const tx = wx * speed, ty = wy * speed;
  const k = Math.min(1, dt * (s.grounded ? 14 : 3));
  s.vx += (tx - s.vx) * k; s.vy += (ty - s.vy) * k;

  const tanMax = Math.tan((cfg.slopeDeg * Math.PI) / 180);
  const h = playerHeight(s, cfg);
  const g = (x: number, y: number, zl: number) => world.ground(x, y, zl);
  const canStand = (nx: number, ny: number, dx: number, dy: number): boolean => {
    if (!s.grounded) return true;
    const lim = s.z + cfg.stepUp + 0.05;
    const g1 = g(nx, ny, lim);
    if (g1 === null) return false; // no walking off the map / into terrain walls
    const rise = g1 - s.z; if (rise <= 0.02) return true;
    const run = Math.hypot(dx, dy) || 1e-6; const ux = dx / run, uy = dy / run;
    const ga = g(nx + ux * 0.25, ny + uy * 0.25, lim + 0.3), gb = g(nx - ux * 0.25, ny - uy * 0.25, lim);
    if (ga !== null && gb !== null && (ga - gb) / 0.5 > tanMax) return false;
    return rise <= cfg.stepUp + 1e-6;
  };
  const dist = Math.hypot(s.vx, s.vy) * dt; const n = Math.max(1, Math.ceil(dist / (cfg.radius * 0.5)));
  const sdx = (s.vx * dt) / n, sdy = (s.vy * dt) / n;
  for (let i = 0; i < n; i++) {
    let nx = s.x + sdx, ny = s.y + sdy;
    if (!canStand(nx, ny, sdx, sdy)) {
      if (canStand(s.x + sdx, s.y, sdx, 0)) { nx = s.x + sdx; ny = s.y; }
      else if (canStand(s.x, s.y + sdy, 0, sdy)) { nx = s.x; ny = s.y + sdy; }
      else { nx = s.x; ny = s.y; }
    }
    const r = resolveColliders(nx, ny, cfg.radius, s.z + cfg.stepUp, s.z + h, world.colliders);
    if (r.hit && !canStand(r.x, r.y, r.x - s.x, r.y - s.y)) { /* pushed into unwalkable spot: stay */ } else { s.x = r.x; s.y = r.y; }
    if (s.grounded) {
      const gz = g(s.x, s.y, s.z + cfg.stepUp + 0.05);
      if (gz === null || s.z - gz > 0.06) { s.grounded = false; if (gz !== null && s.z - gz <= cfg.stepUp) { s.z = gz; s.grounded = true; } }
      else s.z = gz;
    }
  }
  if (s.grounded && inp.jump) { s.vz = cfg.jump; s.grounded = false; }
  if (!s.grounded) {
    const zPrev = s.z; s.vz -= cfg.gravity * dt; const zNew = zPrev + s.vz * dt;
    const gz = g(s.x, s.y, zPrev + 0.02);
    if (gz !== null && zNew <= gz && s.vz <= 0) { s.z = gz; s.vz = 0; s.grounded = true; } else s.z = zNew;
  } else s.vz = 0;
  return s;
}
