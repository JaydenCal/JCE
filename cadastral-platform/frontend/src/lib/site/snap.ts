/**
 * Terrain aware snapping, pure functions. The caller turns a camera ray into a point on the terrain mesh (never a flat plane) and
 * passes the E, N of that hit here; the snapped E, N is then lifted back onto the terrain by the caller (height field sample).
 *
 * Priority: boundary or object VERTEX, then EDGE (boundary or object), then GRID. Alt (snapping off) is handled by the caller.
 */
import { dist2, pointOnSegmentDist, type Pt2 } from './geom';

export type SnapKind = 'vertex' | 'edge' | 'grid' | 'none';
export type SnapSource = 'boundary' | 'object';
export interface SnapTargets {
  vertices: { p: Pt2; source: SnapSource; ref?: string }[];
  edges: { a: Pt2; b: Pt2; source: SnapSource; ref?: string }[];
}
export interface SnapOptions {
  /** capture radius in metres (the caller converts a pixel radius at the hit distance) */
  tol: number;
  /** grid spacing in metres; 0 or undefined = grid off (default) */
  grid?: number;
}
export interface SnapResult { p: Pt2; kind: SnapKind; source?: SnapSource; ref?: string; label: string }

export function snapGrid(p: readonly number[], size: number): Pt2 {
  return size > 0 ? [Math.round(p[0] / size) * size, Math.round(p[1] / size) * size] : [p[0], p[1]];
}

export function snapPoint(p: readonly number[], targets: SnapTargets, o: SnapOptions): SnapResult {
  let best: SnapResult | null = null, bd = o.tol;
  for (const v of targets.vertices) {
    const d = dist2(p, v.p);
    if (d <= bd) { bd = d; best = { p: [v.p[0], v.p[1]], kind: 'vertex', source: v.source, ref: v.ref, label: v.source === 'boundary' ? 'BOUNDARY VERTEX' : 'OBJECT VERTEX' }; }
  }
  if (best) return best;
  bd = o.tol;
  for (const e of targets.edges) {
    const r = pointOnSegmentDist(p, e.a, e.b);
    if (r.d <= bd) { bd = r.d; best = { p: r.q, kind: 'edge', source: e.source, ref: e.ref, label: e.source === 'boundary' ? 'BOUNDARY EDGE' : 'OBJECT EDGE' }; }
  }
  if (best) return best;
  if (o.grid && o.grid > 0) return { p: snapGrid(p, o.grid), kind: 'grid', label: `GRID ${o.grid} M` };
  return { p: [p[0], p[1]], kind: 'none', label: '' };
}

/** Targets from a lot ring and the vertices and edges of other objects. */
export function buildTargets(lot: readonly Pt2[] | null, others: { id: string; closed: boolean; pts: readonly (readonly number[])[] }[]): SnapTargets {
  const t: SnapTargets = { vertices: [], edges: [] };
  const addRing = (pts: readonly (readonly number[])[], closed: boolean, source: SnapSource, ref?: string) => {
    pts.forEach((p) => t.vertices.push({ p: [p[0], p[1]], source, ref }));
    const m = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < m; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; t.edges.push({ a: [a[0], a[1]], b: [b[0], b[1]], source, ref }); }
  };
  if (lot && lot.length >= 3) addRing(lot, true, 'boundary');
  for (const o of others) addRing(o.pts, o.closed, 'object', o.id);
  return t;
}

/** Metres per screen pixel at a point `distance` metres in front of a perspective camera (vertical fov in degrees). */
export const metresPerPixelPerspective = (distance: number, fovDeg: number, viewportH: number) => (2 * distance * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, viewportH);
/** Metres per screen pixel for an orthographic camera (frustum height in metres divided by zoom). */
export const metresPerPixelOrtho = (frustumH: number, zoom: number, viewportH: number) => frustumH / Math.max(1e-9, zoom) / Math.max(1, viewportH);

export const ROT_STEP_DEG = 15;
export const normDeg = (d: number) => ((d % 360) + 360) % 360;
/** Step a yaw to the next multiple of 15 degrees in the given direction (clockwise = +1). */
export const stepYaw15 = (yaw: number, dir: 1 | -1) => normDeg(Math.round((yaw + dir * ROT_STEP_DEG) / ROT_STEP_DEG) * ROT_STEP_DEG);
