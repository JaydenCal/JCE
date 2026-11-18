// 3D for the drawn driveways and roads (residential): each material gets its own crisp surface (the commercial pavement catalogue's
// 1024 px canvas textures, mipmapped with 16x anisotropy, so a long drive stays sharp instead of smearing), draped on the ground by
// subdividing every piece into small triangles, with a fine dark edge line so the kerb and the saw cut at the property line read clearly.
// Commercial layouts get the same ways through the hardstand areas they are mirrored as (commercial/catalogue/pavements/view3d.js).
// Plan mm in, metres out; surf(xMm, yMm) -> Y metres. Safe without a DOM (flat colours), which is how the tests build it.

import * as THREE from 'three';
import { GeoBuilder } from './mesh-builder.js';
import { makeMesh } from './model-util.js';
import { getWays, wayGeometry, MATERIALS } from '../site/pavedways.js';
import { pavementById } from '../commercial/catalogue/pavements/pavements.js';
import { textureFor } from '../commercial/catalogue/pavements/view3d.js';
import { LIFT } from './levels.js';

export const LIFT_M = LIFT.concrete; // drawn ways are the finished design surface itself, kept off the mesh by polygon offset (viewer3d/levels.js)
const MAX_EDGE_M = 2.4; // drape grid

function mat(color, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.93, metalness: 0, envMapIntensity: 0.25, ...opts });
  m.userData.shared = false;
  if (m.map) m.userData.disposeMap = false; // cached textures outlive a rebuild
  return m;
}

// Split a triangle (metres, [x, z]) until no edge is longer than MAX_EDGE_M, longest edge first.
function subdivide(a, b, c, out, depth = 0) {
  const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const ab = d(a, b); const bc = d(b, c); const ca = d(c, a);
  const m = Math.max(ab, bc, ca);
  if (m <= MAX_EDGE_M || depth > 8) { out.push([a, b, c]); return; }
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  if (m === ab) { const n = mid(a, b); subdivide(a, n, c, out, depth + 1); subdivide(n, b, c, out, depth + 1); }
  else if (m === bc) { const n = mid(b, c); subdivide(a, b, n, out, depth + 1); subdivide(a, n, c, out, depth + 1); }
  else { const n = mid(c, a); subdivide(a, b, n, out, depth + 1); subdivide(n, b, c, out, depth + 1); }
}

/** The triangles (metres, [x, z]) of a plan ring, draped-ready: earcut, then subdivided. */
export function drapeTriangles(ringMm) {
  const m = ringMm.map((p) => new THREE.Vector2(p.x / 1000, p.y / 1000));
  let tris = [];
  try { tris = THREE.ShapeUtils.triangulateShape(m, []); } catch { tris = []; }
  const out = [];
  for (const [i, j, k] of tris) subdivide([m[i].x, m[i].y], [m[j].x, m[j].y], [m[k].x, m[k].y], out);
  return out;
}

/**
 * addDrawnWays(project, surf) -> { mesh, stats, centres } | null. `mesh` is one ground mesh with a slot per material (and one for edge lines).
 * stats.byMaterial counts the pieces by material; centres are the centrelines (plan mm) so planting can keep clear of them.
 */
export function addDrawnWays(project, surf) {
  if (project?.mode === 'commercial') return null;
  const ways = getWays(project);
  if (!ways.length) return null;
  const H = (xm, zm) => surf(xm * 1000, zm * 1000);
  const b = new GeoBuilder();
  const mats = {};
  const stats = { ways: ways.length, pieces: 0, triangles: 0, byMaterial: {} };
  const centres = [];
  for (const way of ways) {
    const g = wayGeometry(project, way);
    const def = MATERIALS[way.material];
    const t = pavementById(def.type);
    const slot = way.material;
    if (!mats[slot]) {
      const tex = t ? textureFor(t.texture3d) : null;
      mats[slot] = tex ? mat('#ffffff', { map: tex, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }) : mat(def.colour, { polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
    }
    const tile = t?.texture3d?.tileM || 3;
    // Texture runs along the first leg so joints and pavers line up with the drive.
    const d0 = way.pts.length > 1 ? Math.atan2(way.pts[1].y - way.pts[0].y, way.pts[1].x - way.pts[0].x) : 0;
    const ca = Math.cos(d0); const sa = Math.sin(d0);
    const uv = (xm, zm) => [(xm * ca + zm * sa) / tile, (-xm * sa + zm * ca) / tile];
    const V = (xm, zm) => [xm, H(xm, zm) + LIFT_M, zm];
    const VE = (xm, zm) => [xm, H(xm, zm) + LIFT.edgeLine, zm];
    for (const pc of g.pieces) {
      stats.pieces += 1;
      stats.byMaterial[way.material] = (stats.byMaterial[way.material] || 0) + 1;
      for (const [p, q, r] of drapeTriangles(pc.ring)) {
        b.tri(slot, V(p[0], p[1]), V(q[0], q[1]), V(r[0], r[1]), uv(p[0], p[1]), uv(q[0], q[1]), uv(r[0], r[1]), [0, 1, 0]);
        stats.triangles += 1;
      }
      // Edge line: a 0.07 m dark strip centred on the outline, draped.
      if (!mats.edge) mats.edge = mat('#50545a', { roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -7 });
      const ring = pc.ring;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]; const c = ring[(i + 1) % ring.length];
        const L = Math.hypot(c.x - a.x, c.y - a.y);
        if (L < 50) continue;
        const nx = -(c.y - a.y) / L; const ny = (c.x - a.x) / L; // metres offset of 0.05
        const n = Math.max(1, Math.ceil(L / 1000 / MAX_EDGE_M));
        for (let k = 0; k < n; k++) {
          const p0 = { x: a.x + ((c.x - a.x) * k) / n, y: a.y + ((c.y - a.y) * k) / n };
          const p1 = { x: a.x + ((c.x - a.x) * (k + 1)) / n, y: a.y + ((c.y - a.y) * (k + 1)) / n };
          const E = (p, s) => VE(p.x / 1000 + nx * 0.035 * s, p.y / 1000 + ny * 0.035 * s);
          b.quad('edge', E(p0, -1), E(p1, -1), E(p1, 1), E(p0, 1), [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 1, 0]);
        }
      }
    }
    centres.push(g.centre);
  }
  if (b.empty) return null;
  const mesh = makeMesh(b.build(), mats, { ground: true }, { cast: false, receive: true, name: 'drawn-pavement' });
  if (mesh) { mesh.userData = { ...mesh.userData, ground: true, extras: true, drawnPavement: true }; mesh.renderOrder = 3; }
  return { mesh, stats, centres };
}
