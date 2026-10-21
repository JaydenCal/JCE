/** Small geometry helpers shared by siteScene.ts and earthworksScene.ts (kept apart so the two do not import each other). */
import * as THREE from 'three';

export type V3 = [number, number, number];
export const LIFT = 0.04;            // metres above the terrain for flat things, avoids z fighting
/** Cut / fill colours of the scene bundle (backend sa6_site3d build.py cutfill_rgb): cut orange-red, fill blue, white at zero, saturating at 1.5 m. */
export const CUT_COLOUR = '#d9582b', FILL_COLOUR = '#2b6fd9', CUTFILL_SATURATION_M = 1.5;
/** Colour for cf = FFL minus existing ground, metres: negative is cut (the ground is above the floor), positive is fill. */
export function cutFillColour(cf: number): THREE.Color {
  const t = Math.min(1, Math.abs(cf) / CUTFILL_SATURATION_M);
  return new THREE.Color('#ffffff').lerp(new THREE.Color(cf < 0 ? CUT_COLOUR : FILL_COLOUR), t);
}
export function meshOf(pos: number[], mat: THREE.Material): THREE.Mesh {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.userData.pick = true; return m;
}
/** Strip of quads between two equally long paths. */
export function strip(a: V3[], b: V3[], out: number[]) {
  for (let i = 0; i + 1 < a.length; i++) out.push(...a[i], ...b[i], ...a[i + 1], ...a[i + 1], ...b[i], ...b[i + 1]);
}
export function tessellate(tri: [number, number][], maxEdge: number, out: [number, number][][], depth = 0) {
  const [a, b, c] = tri, e = Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(b[0] - c[0], b[1] - c[1]), Math.hypot(c[0] - a[0], c[1] - a[1]));
  if (e <= maxEdge || depth >= 7) { out.push(tri); return; }
  const m = (p: [number, number], q: [number, number]): [number, number] => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], ab = m(a, b), bc = m(b, c), ca = m(c, a);
  for (const t of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]] as [number, number][][]) tessellate(t, maxEdge, out, depth + 1);
}
