/** Pure 2D and 3D geometry helpers on MGA positions (no three.js). Lengths and areas are plan (horizontal) unless stated. */
import type { Pos } from './types';

export type Pt2 = [number, number];
/** Coincidence tolerance, metres. Not an engineering value: it only separates "the same point" from "a different point". */
export const EPS = 1e-6;

export const dist2 = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const samePt = (a: readonly number[], b: readonly number[], tol = EPS) => dist2(a, b) <= tol;

/** Plan length of a polyline. */
export function polylineLength(pts: readonly (readonly number[])[]): number {
  let s = 0; for (let i = 1; i < pts.length; i++) s += dist2(pts[i - 1], pts[i]); return s;
}
/** Length along the surface: every vertex needs a z. */
export function polylineLength3(pts: readonly (readonly number[])[]): number {
  let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], (pts[i][2] ?? 0) - (pts[i - 1][2] ?? 0)); return s;
}
/** Perimeter of an open ring (closing edge included). */
export function ringPerimeter(ring: readonly (readonly number[])[]): number {
  return ring.length < 2 ? 0 : polylineLength(ring) + dist2(ring[ring.length - 1], ring[0]);
}
/** Signed plan area (shoelace): positive for counter-clockwise rings in E, N. */
export function signedArea(ring: readonly (readonly number[])[]): number {
  if (!ring.length) return 0;
  const ox = ring[0][0], oy = ring[0][1];          // relative to the first vertex: MGA coordinates are about 6.6e6 and the raw shoelace loses centimetres of area to cancellation
  let a = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += (p[0] - ox) * (q[1] - oy) - (q[0] - ox) * (p[1] - oy); } return a / 2;
}
export const polygonArea = (ring: readonly (readonly number[])[]) => Math.abs(signedArea(ring));

export function centroid(pts: readonly (readonly number[])[]): Pt2 {
  if (!pts.length) return [0, 0];
  let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length];
}
/** Area centroid of a ring; falls back to the vertex mean for a zero area ring. */
export function ringCentroid(ring: readonly (readonly number[])[]): Pt2 {
  const A = signedArea(ring); if (Math.abs(A) < EPS) return centroid(ring);
  const ox = ring[0][0], oy = ring[0][1];          // relative to the first vertex (MGA magnitudes of 6.6e6 would lose decimetres to cancellation)
  let cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length], px = p[0] - ox, py = p[1] - oy, qx = q[0] - ox, qy = q[1] - oy, k = px * qy - qx * py;
    cx += (px + qx) * k; cy += (py + qy) * k;
  }
  return [ox + cx / (6 * A), oy + cy / (6 * A)];
}

/** Rotate about (cx, cy) by a clockwise angle in degrees (compass sense: east and north, so clockwise seen from above). */
export function rotateClockwise(p: Pos, cx: number, cy: number, deg: number): Pos {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), dx = p[0] - cx, dy = p[1] - cy;
  const x = cx + dx * c + dy * s, y = cy - dx * s + dy * c;
  return p.length === 3 ? [x, y, p[2]] : [x, y];
}

export function pointOnSegmentDist(p: readonly number[], a: readonly number[], b: readonly number[]): { d: number; t: number; q: Pt2 } {
  const abx = b[0] - a[0], aby = b[1] - a[1], L2 = abx * abx + aby * aby;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / L2)) : 0;
  const q: Pt2 = [a[0] + abx * t, a[1] + aby * t];
  return { d: dist2(p, q), t, q };
}

/** Inside or on the ring boundary (within `tol`). Even-odd rule. */
export function pointInRing(p: readonly number[], ring: readonly (readonly number[])[], tol = EPS): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (pointOnSegmentDist(p, a, b).d <= tol) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

const orient = (a: readonly number[], b: readonly number[], c: readonly number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
/** True when the segments cross at a single interior point of both (touching ends and collinear overlaps are not "proper"). */
export function segmentsCrossProperly(a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[]): boolean {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return ((o1 > EPS && o2 < -EPS) || (o1 < -EPS && o2 > EPS)) && ((o3 > EPS && o4 < -EPS) || (o3 < -EPS && o4 > EPS));
}
/** Does any non adjacent pair of edges cross? `closed` treats the list as a ring. */
export function selfIntersects(pts: readonly (readonly number[])[], closed: boolean): boolean {
  const n = pts.length, m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    for (let j = i + 1; j < m; j++) {
      if (j === i + 1 || (closed && i === 0 && j === m - 1)) continue;            // edges that share a vertex
      if (segmentsCrossProperly(a, b, pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}
/** Does the polyline (or ring when `closed`) cross any edge of `ring`? */
export function crossesRing(pts: readonly (readonly number[])[], closed: boolean, ring: readonly (readonly number[])[]): boolean {
  const n = pts.length, m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) for (let j = 0; j < ring.length; j++) if (segmentsCrossProperly(pts[i], pts[(i + 1) % n], ring[j], ring[(j + 1) % ring.length])) return true;
  return false;
}

/** Drop consecutive duplicates (and a repeated closing vertex when `closed`). */
export function dedupe<T extends readonly number[]>(pts: readonly T[], closed: boolean): T[] {
  const out: T[] = [];
  for (const p of pts) if (!out.length || !samePt(out[out.length - 1], p)) out.push(p);
  if (closed && out.length > 1 && samePt(out[0], out[out.length - 1])) out.pop();
  return out;
}

/** Remove vertices lying on the straight line between their neighbours (within `tol` metres). */
export function removeCollinear(ring: readonly Pt2[], tol = 1e-4): Pt2[] {
  let cur = ring.slice(), changed = true;
  while (changed && cur.length > 3) {
    changed = false;
    for (let i = 0; i < cur.length; i++) {
      const p = cur[(i + cur.length - 1) % cur.length], q = cur[i], r = cur[(i + 1) % cur.length];
      if (pointOnSegmentDist(q, p, r).d <= tol) { cur = cur.filter((_, k) => k !== i); changed = true; break; }
    }
  }
  return cur;
}

export type Sampler = (e: number, n: number) => number | null;
/**
 * Sample a polyline along the terrain: the original vertices plus extra points so that no horizontal gap exceeds `step`. Each output
 * point is [E, N, z] with z from the sampler; where the sampler has no terrain, `z` is null (the caller decides how to draw it).
 */
export function drapePolyline(pts: readonly (readonly number[])[], sample: Sampler, step: number, closed = false): { p: [number, number, number | null]; vertex: number | null }[] {
  const out: { p: [number, number, number | null]; vertex: number | null }[] = [];
  const n = pts.length, m = closed ? n : n - 1;
  const z = (e: number, nn: number, own?: number) => (own !== undefined ? own : sample(e, nn));
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % n], L = dist2(a, b), k = Math.max(1, Math.ceil(L / step));
    for (let s = 0; s < k; s++) {
      const t = s / k, e = a[0] + (b[0] - a[0]) * t, nn = a[1] + (b[1] - a[1]) * t;
      out.push({ p: [e, nn, z(e, nn, s === 0 ? a[2] : undefined)], vertex: s === 0 ? i : null });
    }
  }
  if (!closed && n > 0) { const l = pts[n - 1]; out.push({ p: [l[0], l[1], z(l[0], l[1], l[2])], vertex: n - 1 }); }
  return out;
}
