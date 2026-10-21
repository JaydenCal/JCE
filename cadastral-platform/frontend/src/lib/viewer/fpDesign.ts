/**
 * Collision volumes of the site design for the first person walk (stage 11): buildings, retaining walls, pool barriers, above ground tanks, outdoor furniture and pools.
 * A volume is an oriented box in the local metres of the scene (E and N minus the scene origin). The walker is stopped by a box; a pool is an obstacle whose edge cannot be
 * crossed, and its water surface is never a walkable surface (the surface meshes the walker may stand on carry `userData.walk`, the water does not).
 * Sizes come from the object's own parameters (a building is as high as its height_m). Where a parameter is NOT SET, the display constants of ./fpLimits are used for the COLLISION ONLY,
 * the box says so in its `note` (DISPLAY_HEIGHT_NOTE), and nothing is added to the object.
 */
import type { SiteDesign, SiteObject, Pos } from '../site/types';
import { dimOf, levelOf, rwtShape, textOf } from '../site/types';
import { FP_COLLIDER_BELOW_M, FP_COLLIDER_DEFAULT_HEIGHT_M, FP_COLLIDER_EDGE_M, FP_POOL_EDGE_HEIGHT_M } from './fpLimits';
import type { BoxCollider } from './types';

/** The label of a collider whose height is the display constant because the object's height_m is NOT SET. */
export const DISPLAY_HEIGHT_NOTE = 'HEIGHT NOT SET, COLLISION HEIGHT IS A DISPLAY CONSTANT OF THE WALK';

/** Ground level at an MGA point, or null when the terrain does not reach it. */
export type BaseFn = (e: number, n: number) => number | null;

/** The wall boxes along a path (closed for a ring): a box centred on each edge, as long as the edge plus the thickness so corners close. */
export function edgeBoxes(pts: readonly Pos[], closed: boolean, O: readonly [number, number], zLo: number, zHi: number, thickness: number, kind: string, note?: string): BoxCollider[] {
  const out: BoxCollider[] = [], n = pts.length, last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i], b = pts[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    out.push({ c: [(a[0] + b[0]) / 2 - O[0], (a[1] + b[1]) / 2 - O[1], (zLo + zHi) / 2], s: [len + thickness, thickness, zHi - zLo], yaw: (Math.atan2(dy, dx) * 180) / Math.PI, kind, ...(note ? { note } : {}) });
  }
  return out;
}
const mid = (pts: readonly Pos[]): [number, number] => { let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length]; };

/** A round tank as two boxes (an octagon): axis aligned and turned 45 degrees, each the square inscribed in the circle's circumscribed octagon. */
function roundBoxes(e: number, n: number, r: number, zLo: number, zHi: number, O: readonly [number, number], kind: string): BoxCollider[] {
  const side = 2 * r * Math.cos(Math.PI / 8) * 0.999 / 1;           // the octagon's flat to flat width: both boxes together bound an octagon of that width
  return [0, 45].map((yaw) => ({ c: [e - O[0], n - O[1], (zLo + zHi) / 2] as [number, number, number], s: [side, side, zHi - zLo] as [number, number, number], yaw, kind }));
}

/** The vertical centre of a rectangular tank box that reaches from FP_COLLIDER_BELOW_M under the base to the top of the tank (height h): its height is h + FP_COLLIDER_BELOW_M. */
export const tankCentreZ = (z0: number, h: number): number => z0 + (h - FP_COLLIDER_BELOW_M) / 2;

export function designColliders(doc: SiteDesign, O: readonly [number, number], base: BaseFn): BoxCollider[] {
  const out: BoxCollider[] = [];
  for (const o of doc.objects) {
    if (o.accepted === 'rejected') continue;                           // a rejected proposal is not drawn, so it does not block
    out.push(...objectColliders(o, O, base));
  }
  return out;
}

export function objectColliders(o: SiteObject, O: readonly [number, number], base: BaseFn): BoxCollider[] {
  const g = o.geometry;
  if (g.kind === 'point') {
    const z0 = base(g.p[0], g.p[1]); if (z0 === null) return [];
    const yaw = -(g.yaw_deg ?? 0);
    if (o.type === 'rwt') {
      const shape = rwtShape(o), h = dimOf(o, 'height_m'); if (!shape || shape === 'underground' || h === null) return [];
      if (shape === 'round') { const d = dimOf(o, 'diameter_m'); return d === null ? [] : roundBoxes(g.p[0], g.p[1], d / 2, z0 - FP_COLLIDER_BELOW_M, z0 + h, O, 'tank'); }
      const w = dimOf(o, 'width_m'), l = dimOf(o, 'length_m'); if (w === null || l === null) return [];
      return [{ c: [g.p[0] - O[0], g.p[1] - O[1], tankCentreZ(z0, h)], s: [w, l, h + FP_COLLIDER_BELOW_M], yaw, kind: 'tank' }];
    }
    if (o.type === 'osd') {
      const w = dimOf(o, 'width_m'), l = dimOf(o, 'length_m'), h = dimOf(o, 'height_m');
      if (w === null || l === null || h === null || textOf(o, 'form') !== 'tank') return [];      // an underground OSD is below the surface: nothing to walk into
      return [{ c: [g.p[0] - O[0], g.p[1] - O[1], tankCentreZ(z0, h)], s: [w, l, h + FP_COLLIDER_BELOW_M], yaw, kind: 'tank' }];
    }
    if (o.type === 'furniture') {
      const w = dimOf(o, 'width_m'), d = dimOf(o, 'depth_m'), h = dimOf(o, 'height_m'); if (w === null || d === null || h === null) return [];
      return [{ c: [g.p[0] - O[0], g.p[1] - O[1], z0 + h / 2], s: [w, d, h], yaw, kind: 'furniture' }];
    }
    return [];
  }
  if (g.kind === 'polygon') {
    const ring = g.ring, m = mid(ring), zm = base(m[0], m[1]);
    if (o.type === 'building') {
      const ffl = levelOf(o, 'ffl_rl') ?? zm; if (ffl === null) return [];
      const bh = dimOf(o, 'height_m');                                  // the building's own height when it is set, else the display constant (and the box says so)
      return edgeBoxes(ring, true, O, ffl - FP_COLLIDER_BELOW_M, ffl + (bh ?? FP_COLLIDER_DEFAULT_HEIGHT_M), FP_COLLIDER_EDGE_M, 'building', bh === null ? DISPLAY_HEIGHT_NOTE : undefined);
    }
    if (o.type === 'pool') {
      const wl = levelOf(o, 'water_level_rl') ?? zm; if (wl === null) return [];
      return edgeBoxes(ring, true, O, wl - FP_COLLIDER_BELOW_M, wl + FP_POOL_EDGE_HEIGHT_M, FP_COLLIDER_EDGE_M, 'pool');
    }
    return [];
  }
  const pts = g.pts;
  if (o.type === 'retaining_wall') {
    const m = mid(pts), z0 = base(m[0], m[1]); if (z0 === null) return [];
    const hs = dimOf(o, 'height_m'), h = hs ?? FP_COLLIDER_DEFAULT_HEIGHT_M, t = dimOf(o, 'thickness_m') ?? FP_COLLIDER_EDGE_M;
    return edgeBoxes(pts, false, O, z0 - FP_COLLIDER_BELOW_M, z0 + h, t, 'wall', hs === null ? DISPLAY_HEIGHT_NOTE : undefined);
  }
  if (o.type === 'pool_barrier') {
    const m = mid(pts), z0 = base(m[0], m[1]), h = dimOf(o, 'height_m'); if (z0 === null || h === null) return [];
    return edgeBoxes(pts, false, O, z0 - FP_COLLIDER_BELOW_M, z0 + h, FP_COLLIDER_EDGE_M, 'barrier');
  }
  return [];
}
