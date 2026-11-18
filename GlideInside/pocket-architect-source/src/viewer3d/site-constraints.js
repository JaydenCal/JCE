// Site constraint overlays in 3D: a subtle tint draped on the ground (flood, bushfire, heritage, easements), only for the layers switched on
// in the Site panel. Plan mm in, metres out; surf(xMm, yMm) -> ground Y in metres. Flat shaded, unlit, no texture, so it never blurs the aerial.

import * as THREE from 'three';
import { OVERLAY_STYLE, drawableLayers, overlayOn } from '../site/overlays.js';

const LIFT_M = 0.09; // above the ground, under the lot boundary line (0.15) and above the aerial
const MAX_EDGE_M = 5; // triangles longer than this are split so the tint follows the terrain
const MAX_TRIS = 60000;

function subdivide(tri, out) {
  // tri: three [x, z] points in metres. Split the longest edge until every edge is short.
  const stack = [tri];
  while (stack.length && out.length < MAX_TRIS) {
    const t = stack.pop();
    let li = 0;
    let ll = 0;
    for (let i = 0; i < 3; i++) {
      const a = t[i];
      const b = t[(i + 1) % 3];
      const l = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (l > ll) { ll = l; li = i; }
    }
    if (ll <= MAX_EDGE_M) { out.push(t); continue; }
    const a = t[li]; const b = t[(li + 1) % 3]; const c = t[(li + 2) % 3];
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    stack.push([a, m, c], [m, b, c]);
  }
}

/** Triangles (each three [x, z] metres) covering one overlay polygon { outer, holes } in plan mm. */
export function trianglesFor(poly) {
  const v2 = (r) => r.map((p) => new THREE.Vector2(p.x / 1000, p.y / 1000));
  const contour = v2(poly.outer);
  const holes = (poly.holes || []).map(v2);
  let faces;
  try {
    faces = THREE.ShapeUtils.triangulateShape(contour, holes);
  } catch {
    return [];
  }
  const verts = contour.concat(...holes);
  const out = [];
  for (const f of faces) subdivide(f.map((i) => [verts[i].x, verts[i].y]), out);
  return out;
}

export function addConstraintTint(root, lot, surf) {
  if (!lot?.overlays) return null;
  const on = drawableLayers(lot).filter((l) => overlayOn(lot, l.id));
  if (!on.length) return null;
  const group = new THREE.Group();
  group.name = 'site-constraints';
  root.add(group);
  for (const layer of on) {
    const pos = [];
    for (const f of layer.features) for (const poly of f.rings) for (const t of trianglesFor(poly)) for (const p of t) pos.push(p[0], surf(p[0] * 1000, p[1] * 1000) + LIFT_M, p[1]);
    if (!pos.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const [r, gr, b] = OVERLAY_STYLE[layer.id].rgb;
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(r / 255, gr / 255, b / 255), transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    m.userData.shared = false;
    const mesh = new THREE.Mesh(g, m);
    mesh.name = `constraint-${layer.id}`;
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    mesh.userData = { ground: true, extras: true, constraint: layer.id };
    group.add(mesh);
  }
  return group;
}
