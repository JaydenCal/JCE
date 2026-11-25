// Keeps the orbit camera from getting lost (all 3D views). Pure: works on plain { x, y, z } points, so it is tested without WebGL.
//  - the orbit target stays inside the model bounds plus a margin (a two finger pan cannot throw it off the lot),
//  - the camera stays above the ground, and the zoom distance stays between a minimum and a maximum.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The limits for a model box { min, max }: the target margin grows with the lot, the zoom range follows its size. */
export function orbitLimits(box) {
  const sx = Math.max(1, box.max.x - box.min.x); const sz = Math.max(1, box.max.z - box.min.z);
  const size = Math.hypot(sx, sz);
  return {
    margin: Math.max(12, size * 0.35),
    minDist: 1.2,
    maxDist: Math.max(40, (size / 2) * 4 + 20),
    maxY: Math.max(4, box.max.y + 2),
    minCamY: 0.4,
  };
}

/** clampOrbit(target, position, box) -> { target, position, changed }. The camera moves with the target, so a clamped pan does not change the view angle. */
export function clampOrbit(target, position, box, limits = orbitLimits(box)) {
  const t = {
    x: clamp(target.x, box.min.x - limits.margin, box.max.x + limits.margin),
    y: clamp(target.y, 0, limits.maxY),
    z: clamp(target.z, box.min.z - limits.margin, box.max.z + limits.margin),
  };
  const p = { x: position.x + (t.x - target.x), y: position.y + (t.y - target.y), z: position.z + (t.z - target.z) };
  let ox = p.x - t.x; let oy = p.y - t.y; let oz = p.z - t.z;
  const len = Math.hypot(ox, oy, oz) || 1;
  const want = clamp(len, limits.minDist, limits.maxDist);
  if (want !== len) { const k = want / len; ox *= k; oy *= k; oz *= k; }
  let py = t.y + oy;
  if (py < limits.minCamY) { // never below the ground: lift to the ground line and keep the distance
    py = limits.minCamY;
    const h = Math.hypot(ox, oz) || 1; const need = Math.sqrt(Math.max(0, want * want - (py - t.y) ** 2));
    ox *= need / h; oz *= need / h;
  }
  const out = { x: t.x + ox, y: py, z: t.z + oz };
  const changed = Math.abs(out.x - position.x) + Math.abs(out.y - position.y) + Math.abs(out.z - position.z) + Math.abs(t.x - target.x) + Math.abs(t.y - target.y) + Math.abs(t.z - target.z) > 1e-6;
  return { target: t, position: out, changed };
}
