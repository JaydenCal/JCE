// Door animation for the walk-through. Open and closed state is per door, lives only in the viewer
// (never in the project) and survives model rebuilds. A door leaf is its own mesh (see build.js)
// whose userData.motion says how it moves:
//   hinged: rotates about a vertical axis at its hinge, mesh.position is the hinge
//   slide:  moves along a horizontal direction by a distance
//   roll:   garage and roller doors roll up into the head: scale.y towards the top pivot

import * as G from '../model/geometry.js';

export const DOOR = { time: 0.4, reach: 1.5, lookDeg: 50, rollMin: 0.04 };
const DOOR_KINDS = ['door', 'sliding_door', 'garage_door', 'roller_door'];
export const isOperable = (o) => DOOR_KINDS.includes(o.kind);

const ease = (t) => t * t * (3 - 2 * t);

// Put a leaf mesh in the pose for open fraction t (0 closed, 1 open).
export function applyDoorPose(mesh, t) {
  const m = mesh.userData?.motion;
  if (!m) return;
  const e = ease(Math.max(0, Math.min(1, t)));
  if (m.type === 'hinged') {
    mesh.rotation.y = m.angle * e;
  } else if (m.type === 'slide') {
    if (!mesh.userData.base) mesh.userData.base = mesh.position.toArray();
    const b = mesh.userData.base;
    mesh.position.set(b[0] + m.dir[0] * m.distance * e, b[1], b[2] + m.dir[2] * m.distance * e);
  } else if (m.type === 'roll') {
    mesh.scale.y = 1 - (1 - DOOR.rollMin) * e;
  }
  mesh.updateMatrix();
}

export function createDoors({ invalidate = () => {} } = {}) {
  const state = new Map(); // opening id -> { t, target }
  let leaves = new Map(); // opening id -> [mesh]
  let version = 0;
  let moving = 0;

  const get = (id) => {
    let s = state.get(id);
    if (!s) {
      s = { t: 0, target: 0 };
      state.set(id, s);
    }
    return s;
  };
  const blockedNow = (s) => s.t < 0.55;

  return {
    // Find the leaf meshes of a freshly built model and give them their saved pose.
    attach(model) {
      leaves = new Map();
      model?.traverse((o) => {
        if (o.isMesh && o.userData?.leaf && o.userData.motion) {
          const id = o.userData.id;
          if (!leaves.has(id)) leaves.set(id, []);
          leaves.get(id).push(o);
          const s = state.get(id);
          if (s) applyDoorPose(o, s.t);
        }
      });
      version++;
    },
    leavesOf: (id) => leaves.get(id) || [],
    isOpen: (id) => (state.get(id)?.target ?? 0) === 1,
    openness: (id) => state.get(id)?.t ?? 0,
    // A closed (or still closing) door blocks the player.
    blocks: (id) => blockedNow(get(id)),
    set(id, open) {
      const s = get(id);
      s.target = open ? 1 : 0;
      moving++;
      version++;
      invalidate();
    },
    toggle(id) {
      const s = get(id);
      this.set(id, s.target === 0);
      return s.target === 1;
    },
    // Advance animations. Returns true while anything is moving.
    update(dt) {
      if (!moving) return false;
      let any = false;
      for (const [id, s] of state) {
        if (s.t === s.target) continue;
        const before = blockedNow(s);
        const step = dt / DOOR.time;
        s.t = s.target > s.t ? Math.min(s.target, s.t + step) : Math.max(s.target, s.t - step);
        for (const m of leaves.get(id) || []) applyDoorPose(m, s.t);
        if (blockedNow(s) !== before) version++;
        if (s.t !== s.target) any = true;
      }
      if (!any) moving = 0;
      invalidate();
      return true;
    },
    get version() {
      return version;
    },
    get busy() {
      return moving > 0;
    },
    reset() {
      state.clear();
      version++;
    },
  };
}

// Operable door nearest to the player's eye and roughly in view, on one level.
// pos: { x, z } metres; yaw: camera yaw (radians, three.js, 0 looks down -Z). Returns { opening, wall, dist } or null.
export function findDoorTarget(project, levelId, pos, yaw, { statusView = 'proposed', reach = DOOR.reach, lookDeg = DOOR.lookDeg } = {}) {
  const level = project.levels.find((l) => l.id === levelId);
  if (!level) return null;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const cosMin = Math.cos((lookDeg * Math.PI) / 180);
  let best = null;
  for (const o of level.openings) {
    if (!isOperable(o)) continue;
    const s = o.status || 'new';
    if (statusView === 'proposed' ? s === 'demolish' : statusView === 'existing' ? s === 'new' : false) continue;
    const wall = level.walls.find((w) => w.id === o.wallId);
    if (!wall) continue;
    const c = G.pointOnWall(wall, o.offset);
    const dx = c.x / 1000 - pos.x;
    const dz = c.y / 1000 - pos.z;
    const dist = Math.hypot(dx, dz);
    // the door is wide: measure to the nearest point of the opening span, not only its centre
    const d = G.wallDir(wall);
    const half = o.width / 2000;
    const along = (pos.x - c.x / 1000) * d.x + (pos.z - c.y / 1000) * d.y;
    const clamped = Math.max(-half, Math.min(half, along));
    const nx = c.x / 1000 + d.x * clamped - pos.x;
    const nz = c.y / 1000 + d.y * clamped - pos.z;
    const near = Math.hypot(nx, nz);
    if (near > reach) continue;
    const cosA = near < 0.05 ? 1 : (dx * fx + dz * fz) / Math.max(dist, 1e-6);
    if (cosA < cosMin) continue;
    if (!best || near < best.dist) best = { opening: o, wall, dist: near };
  }
  return best;
}
