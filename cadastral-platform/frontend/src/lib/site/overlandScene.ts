/**
 * Stage 9: the overland flow layer in 3D. Flow paths (lines of the cells at or above the display threshold), ponding polygons (the depressions the server reported) and one
 * label that carries the terrain status and FLOW PATHS INDICATIVE, NOT A FLOOD STUDY. The layer is outside the document, never saved and never pickable.
 *
 * Drawing conventions (display only, not engineering values): a path ribbon is wider where more ground drains through it, on a logarithmic scale; a pond is drawn flat at its
 * spill level.
 */
import * as THREE from 'three';
import type { SwClosedBasin, SwOverland, SwPath, SwPond } from './stormwater';

export const FLOW_COLOUR = '#0b6bcb', POND_COLOUR = '#12a39a', CLOSED_COLOUR = '#c0392b';
export const FLOW_LABEL = 'FLOW PATHS INDICATIVE, NOT A FLOOD STUDY';
const RISE = 0.06;                  // metres above the ground, so the ribbons do not fight with the terrain

/** Ribbon width (m) for a contributing area (m2): 0.12 m at 1 m2, +0.12 m per decade, at most 0.8 m. A drawing convention. */
export const ribbonWidth = (areaM2: number) => Math.min(0.8, 0.12 + 0.12 * Math.max(0, Math.log10(Math.max(areaM2, 1))));
/** The labels of the layer: the terrain status of the model first, then the flow label. */
export function overlandLabelText(o: Pick<SwOverland, 'labels' | 'terrain_status'>): string {
  const lines = o.labels && o.labels.length ? o.labels : [o.terrain_status, FLOW_LABEL];
  return lines.includes(FLOW_LABEL) ? lines.join('\n') : [...lines, FLOW_LABEL].join('\n');
}

function ribbon(path: SwPath, O: readonly [number, number]): THREE.Mesh | null {
  const p = path.points;
  if (p.length < 2) return null;
  const w = ribbonWidth(path.max_area_m2) / 2, pos: number[] = [];
  const side = (i: number): [number, number] => {
    const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    return [(-dy / L) * w, (dx / L) * w];
  };
  const L: [number, number, number][] = [], R: [number, number, number][] = [];
  p.forEach((q, i) => { const [sx, sy] = side(i); L.push([q[0] - O[0] + sx, q[1] - O[1] + sy, q[2] + RISE]); R.push([q[0] - O[0] - sx, q[1] - O[1] - sy, q[2] + RISE]); });
  for (let i = 0; i + 1 < p.length; i++) pos.push(...L[i], ...R[i], ...L[i + 1], ...L[i + 1], ...R[i], ...R[i + 1]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const t = Math.min(1, Math.log10(Math.max(path.max_area_m2, 1)) / 3);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color('#7fb8ee').lerp(new THREE.Color(FLOW_COLOUR), t), side: THREE.DoubleSide, depthWrite: false, transparent: true, opacity: 0.9 }));
  m.userData.flowPath = path.max_area_m2; m.renderOrder = 3; return m;
}
function pond(p: Pick<SwPond, 'outline'> & { spill_level_rl: number }, O: readonly [number, number], colour = POND_COLOUR, flag = 'pond'): THREE.Object3D[] {
  const ring = p.outline.slice(0, -1).map((q) => new THREE.Vector2(q[0] - O[0], q[1] - O[1]));
  if (ring.length < 3) return [];
  const faces = THREE.ShapeUtils.triangulateShape(ring, []), z = p.spill_level_rl + RISE, out: THREE.Object3D[] = [];
  if (faces.length) {
    const pos: number[] = []; for (const f of faces) for (const i of f) pos.push(ring[i].x, ring[i].y, z);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })); m.userData[flag] = true; m.renderOrder = 4; out.push(m);
  }
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([...ring, ring[0]].map((v) => new THREE.Vector3(v.x, v.y, z + 0.01))), new THREE.LineBasicMaterial({ color: colour }));
  line.renderOrder = 5; out.push(line);
  return out;
}
/** The layer for a server answer. `makeLabel` is the sprite maker of the viewer. Returns an empty group when the answer was not evaluated. */
export function buildOverlandLayer(o: SwOverland | null, O: readonly [number, number], makeLabel?: (text: string, scale: number, accent: string) => THREE.Sprite): THREE.Group {
  const g = new THREE.Group(); g.name = 'overland_flow';
  if (!o || o.status !== 'EVALUATED') return g;
  for (const p of o.paths) { const r = ribbon(p, O); if (r) g.add(r); }
  for (const p of o.depressions) for (const x of pond(p, O)) g.add(x);
  // closed basins (no outlet) are drawn in their own colour, flat at their highest ground level so the whole outline is visible on a slope
  for (const b of (o.closed_basins ?? []) as SwClosedBasin[]) for (const x of pond({ outline: b.outline, spill_level_rl: b.highest_rl }, O, CLOSED_COLOUR, 'closedBasin')) g.add(x);
  const pts = [...o.paths.flatMap((p) => p.points), ...o.depressions.map((d) => [d.centroid[0], d.centroid[1], d.spill_level_rl] as [number, number, number])];
  if (makeLabel && pts.length) {
    const top = pts.reduce((a, b) => (b[2] > a[2] ? b : a)), sp = makeLabel(overlandLabelText(o), 1, FLOW_COLOUR);
    sp.position.set(top[0] - O[0], top[1] - O[1], top[2] + 2.5); sp.userData.flowLabel = true; g.add(sp);
  }
  return g;
}
