// Walk-mode collision and spawn logic. Pure functions, no DOM and no three.js, so they can be
// tested in Node. Plan coordinates are millimetres in the project; everything returned is in
// metres in world X, Z (X = x / 1000, Z = y / 1000).

import * as G from '../model/geometry.js';
import * as F from './footprint.js';

export const WALK = { radius: 0.25, eye: 1.65, speed: 1.4, run: 3.0 };

// A door-like opening can be walked through: it reaches the floor and is at least 1.8 m high.
export const isPassable = (o) => (o.sill ?? 0) <= 5 && (o.height ?? 0) >= 1800 && o.kind !== 'window';

const showStatus = (statusView, status) => {
  const s = status || 'new';
  if (statusView === 'both') return true;
  if (statusView === 'existing') return s !== 'new';
  return s !== 'demolish';
};

// Solid wall pieces as oriented rectangles { cx, cz, ux, uz, hl, ht } (centre, unit direction, half length, half thickness).
export function buildColliders(project, levelId, { statusView = 'proposed', blockingDoor = null } = {}) {
  const level = project.levels.find((l) => l.id === levelId) || project.levels[0];
  const out = [];
  if (!level) return out;
  for (const w of level.walls) {
    if (!showStatus(statusView, w.status)) continue;
    const L = G.wallLength(w);
    if (L < 10) continue;
    const gaps = level.openings
      .filter((o) => o.wallId === w.id && showStatus(statusView, o.status) && isPassable(o))
      .map((o) => [Math.max(0, o.offset - o.width / 2), Math.min(L, o.offset + o.width / 2)])
      .sort((a, b) => a[0] - b[0]);
    const pieces = [];
    let cur = 0;
    for (const [g0, g1] of gaps) {
      if (g0 > cur + 1) pieces.push([cur, g0]);
      cur = Math.max(cur, g1);
    }
    if (L > cur + 1) pieces.push([cur, L]);
    const d = G.wallDir(w);
    const ht = (w.thickness || 100) / 2000;
    for (const [p0, p1] of pieces) {
      const mid = (p0 + p1) / 2;
      out.push({
        cx: (w.a.x + d.x * mid) / 1000, cz: (w.a.y + d.y * mid) / 1000,
        ux: d.x, uz: d.y, hl: (p1 - p0) / 2000, ht, wallId: w.id,
      });
    }
  }
  // closed hinged doors are solid; blockingDoor(opening) says whether one is still closed
  if (blockingDoor) {
    for (const o of level.openings) {
      if (o.kind !== 'door' || !showStatus(statusView, o.status) || !isPassable(o) || !blockingDoor(o)) continue;
      const wall = level.walls.find((w) => w.id === o.wallId);
      if (!wall || !showStatus(statusView, wall.status)) continue;
      const d = G.wallDir(wall);
      const c = G.pointOnWall(wall, o.offset);
      out.push({ cx: c.x / 1000, cz: c.y / 1000, ux: d.x, uz: d.y, hl: Math.max(0.1, o.width / 2000), ht: 0.03, wallId: wall.id, door: o.id });
    }
  }
  return out;
}

// Push a circle of radius r out of every rectangle. Returns the corrected { x, z }.
export function resolveCollisions(pos, colliders, r = WALK.radius) {
  let x = pos.x;
  let z = pos.z;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const c of colliders) {
      const dx = x - c.cx;
      const dz = z - c.cz;
      // local coordinates: u along the wall, v across it
      const u = dx * c.ux + dz * c.uz;
      const v = -dx * c.uz + dz * c.ux;
      const qu = Math.max(-c.hl, Math.min(c.hl, u));
      const qv = Math.max(-c.ht, Math.min(c.ht, v));
      const du = u - qu;
      const dv = v - qv;
      const dist = Math.hypot(du, dv);
      if (dist >= r) continue;
      let pu;
      let pv;
      if (dist > 1e-9) {
        pu = (du / dist) * (r - dist);
        pv = (dv / dist) * (r - dist);
      } else {
        // centre inside the rectangle: leave by the nearest face
        const toU = c.hl - Math.abs(u);
        const toV = c.ht - Math.abs(v);
        if (toV <= toU) {
          pu = 0;
          pv = (v >= 0 ? 1 : -1) * (toV + r);
        } else {
          pu = (u >= 0 ? 1 : -1) * (toU + r);
          pv = 0;
        }
      }
      x += pu * c.ux - pv * c.uz;
      z += pu * c.uz + pv * c.ux;
      moved = true;
    }
    if (!moved) break;
  }
  return { x, z };
}

// A point well inside a polygon (mm): the grid point furthest from the boundary.
export function interiorPoint(poly) {
  const bb = G.bbox(poly);
  const c = G.polygonCentroid(poly);
  const dEdge = (p) => Math.min(...G.polygonEdges(poly).map(([a, b]) => G.projectToSegment(p, a, b).d));
  let best = G.pointInPolygon(c, poly) ? { p: c, d: dEdge(c) } : null;
  const step = Math.max(150, Math.min(bb.w, bb.h) / 24);
  for (let x = bb.minX + step / 2; x < bb.maxX; x += step) {
    for (let y = bb.minY + step / 2; y < bb.maxY; y += step) {
      const p = { x, y };
      if (!G.pointInPolygon(p, poly)) continue;
      const d = dEdge(p);
      if (!best || d > best.d + (best.p === c ? 400 : 0)) best = { p, d };
    }
  }
  return best ? best.p : c;
}

// Free distance from p along unit direction dir to the polygon boundary (mm).
function rayToPolygon(p, dir, poly) {
  let best = Infinity;
  for (const [a, b] of G.polygonEdges(poly)) {
    const e = G.sub(b, a);
    const den = G.cross(dir, e);
    if (Math.abs(den) < 1e-9) continue;
    const ap = G.sub(a, p);
    const t = G.cross(ap, e) / den;
    const s = G.cross(ap, dir) / den;
    if (t > 1 && s >= 0 && s <= 1 && t < best) best = t;
  }
  return best;
}

// Spawn inside the largest indoor room of the level: { x, z, yaw, roomId }. yaw is a three.js camera yaw (radians).
export function chooseSpawn(project, levelId, { statusView = 'proposed' } = {}) {
  const level = project.levels.find((l) => l.id === levelId) || project.levels[0];
  if (!level) return { x: 0, z: 0, yaw: 0, roomId: null };
  const rooms = level.rooms.filter((r) => !r.outdoor && r.polygon.length >= 3 && showStatus(statusView, r.status));
  let p = null;
  let poly = null;
  let roomId = null;
  if (rooms.length) {
    const room = rooms.reduce((a, b) => (G.polygonArea(b.polygon) > G.polygonArea(a.polygon) ? b : a));
    poly = room.polygon;
    p = interiorPoint(poly);
    roomId = room.id;
  } else {
    // walls only: use the enclosed area
    const grid = F.makeGrid(project);
    const ras = F.rasteriseLevel(grid, level, (s) => showStatus(statusView, s));
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let k = 0; k < ras.enclosed.length; k++) {
      if (!ras.enclosed[k]) continue;
      sx += grid.x0 + ((k % grid.nx) + 0.5) * grid.cell;
      sy += grid.y0 + (Math.floor(k / grid.nx) + 0.5) * grid.cell;
      n++;
    }
    if (n) {
      const c = { x: sx / n, y: sy / n };
      let bestD = Infinity;
      for (let k = 0; k < ras.enclosed.length; k++) {
        if (!ras.enclosed[k]) continue;
        const q = { x: grid.x0 + ((k % grid.nx) + 0.5) * grid.cell, y: grid.y0 + (Math.floor(k / grid.nx) + 0.5) * grid.cell };
        const d = G.dist(q, c);
        if (d < bestD) {
          bestD = d;
          p = q;
        }
      }
    } else {
      const bb = G.levelBounds(level);
      p = bb ? { x: bb.cx, y: bb.cy } : { x: 0, y: 0 };
    }
  }
  // Face along the room: pick the axis direction with the most room to look down, then step back
  // from the centre so more of the room is in view.
  let yaw = 0;
  if (poly) {
    let bestT = -1;
    let best = null;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      const dir = { x: Math.sin(a), y: Math.cos(a) };
      const t = rayToPolygon(p, dir, poly);
      if (Number.isFinite(t) && t > bestT + 1) {
        bestT = t;
        best = dir;
      }
    }
    if (best) {
      // camera looks along -Z at yaw 0; plan direction (x, y) maps to world (x, z)
      yaw = Math.atan2(-best.x, -best.y);
      const back = rayToPolygon(p, { x: -best.x, y: -best.y }, poly);
      if (Number.isFinite(back)) {
        const shift = Math.max(0, Math.min(0.2 * (bestT + back), back - 800));
        const q = { x: p.x - best.x * shift, y: p.y - best.y * shift };
        if (shift > 0 && G.pointInPolygon(q, poly)) p = q;
      }
    }
  }
  return { x: p.x / 1000, z: p.y / 1000, yaw, roomId };
}

// Is a world point (metres) inside an indoor room or the walled area of the level?
export function insideLevel(project, levelId, x, z) {
  const level = project.levels.find((l) => l.id === levelId);
  if (!level) return false;
  const p = { x: x * 1000, y: z * 1000 };
  if (level.rooms.some((r) => !r.outdoor && G.pointInPolygon(p, r.polygon))) return true;
  return false;
}
