// Layout of a typical house on each neighbouring lot, shared by the sample aerial (src/site/mock-aerial.js) and the 3D view
// (src/viewer3d/site-extras.js) so the roofs in the picture and the massing models line up. Pure: rings are arrays of [x, y]
// in any one unit (the caller scales), and every length returned is in the same unit as `unitsPerM` says.

export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const inRing = (pt, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

// Roof colours as seen from above [lit slope, shaded slope] and as Colorbond style sheet colours for the 3D roof.
export const ROOFS = [['#8f4b3a', '#a65a45'], ['#5d6266', '#72787c'], ['#3d4348', '#51585d'], ['#7a3f33', '#93503f'], ['#6c7a6a', '#7f8e7c']];
export const WALLS = ['#d8d2c4', '#c9b79a', '#b7a58c', '#e3dfd6', '#a9a79f', '#cfc3ae'];

/**
 * Frame of one lot: its street edge, with a along the edge, b into the lot (n is the inward normal), the middle of the street edge
 * `fm`, the street frontage length W and the lot depth. The street edge faces outwards to a point that is inside no lot.
 */
export function frontFrame(rings, li, probeM = 3) {
  const ring = rings[li];
  let front = null;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < 1e-6) continue;
    const mx = (p[0] + q[0]) / 2;
    const my = (p[1] + q[1]) / 2;
    const nx = (q[1] - p[1]) / len;
    const ny = -(q[0] - p[0]) / len;
    for (const sg of [1, -1]) {
      const probe = [mx + nx * sg * probeM, my + ny * sg * probeM];
      if (inRing([mx - nx * sg * probeM, my - ny * sg * probeM], ring) && !rings.some((r2, k) => k !== li && inRing(probe, r2))) {
        if (!front || len > front.len) front = { p, q, len };
      }
    }
  }
  if (!front) front = { p: ring[0], q: ring[1], len: Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1]) };
  const ux = (front.q[0] - front.p[0]) / front.len;
  const uy = (front.q[1] - front.p[1]) / front.len;
  let nx = -uy;
  let ny = ux;
  const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length;
  const cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  const fm = [(front.p[0] + front.q[0]) / 2, (front.p[1] + front.q[1]) / 2];
  if ((cx - fm[0]) * nx + (cy - fm[1]) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const depth = Math.max(...ring.map((p) => (p[0] - fm[0]) * nx + (p[1] - fm[1]) * ny));
  return { fm, ux, uy, nx, ny, W: front.len, depth };
}

/** Local frame (a, b) in metres to the ring's units: world = fm + a * u + b * n. */
export const toWorld = (f, a, b) => [f.fm[0] + a * f.ux + b * f.nx, f.fm[1] + a * f.uy + b * f.ny];

/** The house on a lot with W and depth in metres: size, set back from the street, which side the driveway is, colours. */
export function houseSpec(W, depth, li) {
  const r = rng(9100 + li * 31);
  const hw = Math.min(W * 0.55, 17);
  const hd = Math.min(depth * 0.3, 12.5);
  const setback = Math.max(5.5, Math.min(depth * 0.22, 12));
  return {
    hw, hd, setback,
    side: r() > 0.5 ? 1 : -1,
    roofIdx: Math.floor(r() * ROOFS.length),
    wallIdx: Math.floor(r() * WALLS.length),
    hasPool: r() > 0.72,
    storeys: r() > 0.85 ? 2 : 1,
    seed: li,
  };
}

/**
 * Street trees: for each lot, on the verge 3.2 m outside the street edge, about every 11 m and clear of the corners. Same units as
 * the rings (metres here: pass `unitsPerM`). Returns [{ x, y, r (canopy radius, metres), h (height, metres), seed }].
 */
export function streetTreeSpots(rings, unitsPerM = 1) {
  const out = [];
  rings.forEach((ring, li) => {
    const f = frontFrame(rings, li, 3 * unitsPerM);
    const n = Math.max(1, Math.round(f.W / unitsPerM / 11));
    const r = rng(77 + li);
    for (let k = 0; k < n; k++) {
      const a = ((k + 0.5) / n - 0.5) * f.W + (r() - 0.5) * 2 * unitsPerM;
      // The first ring is the person's own lot: keep its street view clear (the neighbours' trees frame it).
      if (li === 0) continue;
      const b = -3.2 * unitsPerM;
      out.push({ x: f.fm[0] + a * f.ux + b * f.nx, y: f.fm[1] + a * f.uy + b * f.ny, r: 1.9 + r() * 0.9, h: 5 + r() * 2.5, seed: li * 10 + k });
    }
  });
  return out;
}
