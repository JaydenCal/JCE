/**
 * three.js parts for the stage 6 objects, drawn from engine results (never from numbers made up here):
 *  - a driveway ribbon at the DESIGN level along its centreline (level across the width, as the engine's platform), coloured by cut / fill against
 *    the EXISTING ground, with the failing chainages overlaid in red (hover text = requirement key, limit and value);
 *  - batter surfaces from the platform edge down (fill) or up (cut) to the existing ground at the slope the engine used (H per V), same colours;
 *  - a grading area: the design plane over the area, coloured by cut / fill, with its batters.
 * The existing ground is the survey / DEM ground (existing and context parts). Without it the surfaces are grey: nothing is invented.
 */
import * as THREE from 'three';
import { dist2, type Pt2 } from './geom';
import { cutFillColour, LIFT, meshOf, tessellate, type V3 } from './meshUtil';
import { parseWkt, pointAtChainage, polylineChainages, type Earthworks, type FailingSpan, type GradingResult, type ProfileView } from './driveway';
import type { Pos, SiteObject } from './types';

export interface EwCtx { O: readonly [number, number]; /** existing ground (never the design surface), MGA in, metres out */ existing: (e: number, n: number) => number | null }
export const FAIL_COLOUR = '#d11d1d';
const GREY = new THREE.Color('#9aa0a6');
const DESIGN_LIFT = 0.02;

type LevelAt = (x: number, y: number) => number;

function distToRing(p: Pt2, ring: readonly Pt2[]): { d: number; q: Pt2 } {
  let best = Infinity, bq: Pt2 = ring[0];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 < 1e-18 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
    const q: Pt2 = [a[0] + dx * t, a[1] + dy * t], d = dist2(p, q);
    if (d < best) { best = d; bq = q; }
  }
  return { d: best, q: bq };
}

/** Level of the design line at a chainage from the engine's samples (linear between samples). */
export function levelAtChainage(chainage: readonly number[], design: readonly number[], t: number): number {
  if (t <= chainage[0]) return design[0];
  const n = chainage.length;
  if (t >= chainage[n - 1]) return design[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (chainage[m] <= t) lo = m; else hi = m; }
  return design[lo] + ((design[hi] - design[lo]) * (t - chainage[lo])) / (chainage[hi] - chainage[lo] || 1);
}
/** Chainage of the nearest point of a polyline to a point (plan), clamped to the polyline. */
export function chainageAlong(pts: readonly (readonly number[])[], cum: readonly number[], p: Pt2): number {
  let best = Infinity, bt = 0;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0], ay = pts[i - 1][1], dx = pts[i][0] - ax, dy = pts[i][1] - ay, L2 = dx * dx + dy * dy;
    const f = L2 < 1e-18 ? 0 : Math.min(1, Math.max(0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2));
    const d = Math.hypot(p[0] - ax - dx * f, p[1] - ay - dy * f);
    if (d < best) { best = d; bt = cum[i - 1] + f * (cum[i] - cum[i - 1]); }
  }
  return bt;
}

interface PolyMeshOpts { colourAt: (x: number, y: number, z: number) => THREE.Color; zAt: (x: number, y: number) => number; maxEdge?: number; opacity?: number; offset?: number }
/** A polygon with holes as a vertex coloured mesh (plan triangulation, subdivided, each vertex given its height by `zAt`). */
function polyMesh(rings: readonly (readonly Pt2[])[], c: EwCtx, o: PolyMeshOpts): THREE.Mesh | null {
  const loc = rings.map((r) => r.map((p) => new THREE.Vector2(p[0] - c.O[0], p[1] - c.O[1])));
  const faces = THREE.ShapeUtils.triangulateShape(loc[0], loc.slice(1));
  if (!faces.length) return null;
  const all = loc.flat();
  let area = 0; for (const f of faces) { const [a, b, d] = f.map((i) => all[i]); area += Math.abs((b.x - a.x) * (d.y - a.y) - (d.x - a.x) * (b.y - a.y)) / 2; }
  const maxEdge = o.maxEdge ?? Math.max(0.75, Math.sqrt(area / 6000)), tris: [number, number][][] = [];
  for (const f of faces) tessellate(f.map((i) => [all[i].x, all[i].y] as [number, number]) as [number, number][], maxEdge, tris);
  const pos: number[] = [], col: number[] = [];
  for (const t of tris) for (const v of t) {
    const x = v[0] + c.O[0], y = v[1] + c.O[1], z = o.zAt(x, y), k = o.colourAt(x, y, z);
    pos.push(v[0], v[1], z + (o.offset ?? DESIGN_LIFT)); col.push(k.r, k.g, k.b);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: (o.opacity ?? 1) < 1, opacity: o.opacity ?? 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  m.userData.pick = true; return m;
}
const cfColour = (c: EwCtx) => (x: number, y: number, z: number): THREE.Color => { const g = c.existing(x, y); return g === null ? GREY : cutFillColour(z - g); };

/** Batter surfaces of an engine result: from the platform edge level at `slope` H per V until the existing ground. */
function batterMeshes(ew: Earthworks, platform: readonly Pt2[], platformLevel: LevelAt, c: EwCtx): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const kind of ['cut', 'fill'] as const) {
    const wkt = kind === 'cut' ? ew.batters.cut_wkt : ew.batters.fill_wkt, hv = ew.batters[kind].h_per_v;
    if (!wkt || hv === null || hv <= 0) continue;
    for (const poly of parseWkt(wkt)) {
      const m = polyMesh(poly, c, {
        zAt: (x, y) => {
          const { d, q } = distToRing([x, y], platform), zp = platformLevel(q[0], q[1]), ground = c.existing(x, y);
          const z = kind === 'cut' ? zp + d / hv : zp - d / hv;
          return ground === null ? z : kind === 'cut' ? Math.min(z, ground) : Math.max(z, ground);        // the batter ends where it meets the existing ground
        },
        colourAt: cfColour(c), offset: 0.015,
      });
      if (m) { m.userData.batter = kind; out.push(m); }
    }
  }
  return out;
}

/** Offsets of a centreline at the given chainages: left and right points at `half` metres (plan), level at the design height. */
function ribbon(pts: readonly Pos[], cum: readonly number[], ts: readonly number[], zs: readonly number[], half: number, c: EwCtx, a = -Infinity, b = Infinity, lift = DESIGN_LIFT, colourAt?: (x: number, y: number, z: number) => THREE.Color, solid?: THREE.Color): THREE.Mesh | null {
  const idx = ts.map((t, i) => [t, i] as const).filter(([t]) => t >= a - 1e-9 && t <= b + 1e-9);
  const sel: { t: number; z: number }[] = idx.map(([t, i]) => ({ t, z: zs[i] }));
  if (a > -Infinity && (!sel.length || sel[0].t > a + 1e-6)) sel.unshift({ t: a, z: zAtSamples(ts, zs, a) });
  if (b < Infinity && (!sel.length || sel[sel.length - 1].t < b - 1e-6)) sel.push({ t: b, z: zAtSamples(ts, zs, b) });
  if (sel.length < 2) return null;
  const pos: number[] = [], col: number[] = [], L: V3[] = [], R: V3[] = [], cl: THREE.Color[] = [], cr: THREE.Color[] = [];
  for (const s of sel) {
    const p = pointAtChainage(pts, cum, s.t), p0 = pointAtChainage(pts, cum, s.t - 0.2), p1 = pointAtChainage(pts, cum, s.t + 0.2);
    let dx = p1[0] - p0[0], dy = p1[1] - p0[1]; const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
    const lx = p[0] - dy * half, ly = p[1] + dx * half, rx = p[0] + dy * half, ry = p[1] - dx * half;
    L.push([lx - c.O[0], ly - c.O[1], s.z + lift]); R.push([rx - c.O[0], ry - c.O[1], s.z + lift]);
    cl.push(solid ?? colourAt!(lx, ly, s.z)); cr.push(solid ?? colourAt!(rx, ry, s.z));
  }
  for (let i = 0; i + 1 < L.length; i++) {
    const quad: [V3, V3, V3, V3, THREE.Color, THREE.Color, THREE.Color, THREE.Color] = [L[i], R[i], L[i + 1], R[i + 1], cl[i], cr[i], cl[i + 1], cr[i + 1]];
    const [l0, r0, l1, r1, c0, c1, c2, c3] = quad;
    for (const [v, k] of [[l0, c0], [r0, c1], [l1, c2], [l1, c2], [r0, c1], [r1, c3]] as [V3, THREE.Color][]) { pos.push(...v); col.push(k.r, k.g, k.b); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.userData.pick = true; return m;
}
const zAtSamples = (ts: readonly number[], zs: readonly number[], t: number) => levelAtChainage(ts, zs, t);

/**
 * Parts of a driveway for its group. `width` must be set (the caller draws only the centreline outline otherwise). A profile with no design line
 * (end level NOT SET) draws a ribbon on the existing ground, grey, with no cut / fill shading and no batters.
 */
export function drivewayParts(o: SiteObject, width: number, view: ProfileView | null, c: EwCtx): THREE.Object3D[] {
  if (o.geometry.kind !== 'polyline') return [];
  const pts = o.geometry.pts, cum = polylineChainages(pts), L = cum[cum.length - 1], half = width / 2;
  const out: THREE.Object3D[] = [];
  const ts: number[] = []; for (let t = 0; t < L; t += 0.5) ts.push(t); ts.push(L);
  const s = view?.samples;
  if (!view || !s || !s.design || s.design.length !== s.chainage.length) {
    const zs = ts.map((t) => { const p = pointAtChainage(pts, cum, t); return c.existing(p[0], p[1]) ?? 0; });
    const known = ts.some((t) => { const p = pointAtChainage(pts, cum, t); return c.existing(p[0], p[1]) !== null; });
    const m = known ? ribbon(pts, cum, ts, zs, half, c, -Infinity, Infinity, LIFT, undefined, GREY) : null;
    if (m) { m.userData.noDesign = true; out.push(m); }
    return out;
  }
  const design = s.design, cf = cfColour(c);
  const base = ribbon(pts, cum, s.chainage, design, half, c, -Infinity, Infinity, DESIGN_LIFT, cf);
  if (base) { base.userData.design = true; base.userData.walk = true; out.push(base); }
  for (const f of view.failing) out.push(...failingRibbon(f, pts, cum, s.chainage, design, half, c));
  const ew = view.earthworks;
  if (ew && !view.preview) {
    const plat = parseWkt(ew.platform_wkt)[0]?.[0];
    if (plat) out.push(...batterMeshes(ew, plat, (x, y) => levelAtChainage(s.chainage, design, chainageAlong(pts, cum, [x, y])), c));
  }
  return out;
}
function failingRibbon(f: FailingSpan, pts: readonly Pos[], cum: readonly number[], ts: readonly number[], zs: readonly number[], half: number, c: EwCtx): THREE.Object3D[] {
  const a = Math.max(0, f.chainage_from_m), b = Math.min(cum[cum.length - 1], f.chainage_to_m);
  // a failure at a single chainage (a change of grade) is drawn as a short cross band either side of it
  const span = b - a < 0.5 ? [Math.max(0, a - 0.5), Math.min(cum[cum.length - 1], a + 0.5)] : [a, b];
  const m = ribbon(pts, cum, ts, zs, half + 0.05, c, span[0], span[1], DESIGN_LIFT + 0.02, undefined, new THREE.Color(FAIL_COLOUR));
  if (!m) return [];
  m.userData.failing = f.message; m.userData.requirementKey = f.requirement_key; m.userData.pick = false;
  return [m];
}

/** Plane through the design patch corners of a grading result: a level for a target level, an inclined plane for a grade. */
export function planeFromPatch(patch: readonly [number, number, number][]): LevelAt | null {
  if (patch.length < 3) return null;
  const z0 = patch[0][2];
  if (patch.every((p) => Math.abs(p[2] - z0) < 1e-6)) return () => z0;
  const a = patch[0];
  for (let i = 1; i < patch.length; i++) for (let j = i + 1; j < patch.length; j++) {
    const b = patch[i], d = patch[j], ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const det = ux * vy - uy * vx;
    if (Math.abs(det) < 1e-9) continue;
    const gx = (uz * vy - uy * vz) / det, gy = (ux * vz - uz * vx) / det;           // dz/dx, dz/dy
    return (x, y) => a[2] + gx * (x - a[0]) + gy * (y - a[1]);
  }
  return () => z0;
}

/** Parts of a grading area: the design plane over the outline coloured by cut / fill, and its batters. */
export function gradingParts(o: SiteObject, res: GradingResult | null, c: EwCtx): THREE.Object3D[] {
  if (o.geometry.kind !== 'polygon' || !res || res.status !== 'OK' || !res.design_patch) return [];
  const level = planeFromPatch(res.design_patch);
  if (!level) return [];
  const ring: Pt2[] = o.geometry.ring.map((p): Pt2 => [p[0], p[1]]);
  const out: THREE.Object3D[] = [];
  const m = polyMesh([ring], c, { zAt: (x, y) => level(x, y), colourAt: cfColour(c) });
  if (m) { m.userData.design = true; m.userData.walk = true; out.push(m); }
  if (res.earthworks) out.push(...batterMeshes(res.earthworks, ring, level, c));
  return out;
}
