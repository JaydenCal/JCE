/**
 * Geometry checks (stage 4). Engineering rules (clearances, setbacks, sizes) are NOT checked here; they arrive with the rules
 * resolver in later stages. Three checks only:
 *   DEGENERATE_GEOMETRY  blocking  non finite coordinates, repeated vertices, zero length or area, self intersection
 *   OUTSIDE_LOT          warning   a vertex lies outside the lot boundary, or an edge crosses it
 *   TERRAIN_UNAVAILABLE  warning   TERRAIN DATA NOT AVAILABLE (no terrain at all, or none under part of the object)
 * Issues are derived data: they are recomputed after every change and are never part of an undo step.
 */
import { crossesRing, dedupe, EPS, pointInRing, polygonArea, polylineLength, selfIntersects, type Pt2 } from './geom';
import { verticesOf, type Issue, type SiteObject } from './types';

export interface CheckEnv {
  /** lot ring in MGA (open ring); null when the bundle has no closed boundary */
  lot: Pt2[] | null;
  /** terrain: `available` is false for a placeholder ground; `sample` returns null where the terrain mesh does not reach */
  terrain: { available: boolean; sample(e: number, n: number): number | null } | null;
}
export const NO_ENV: CheckEnv = { lot: null, terrain: null };

export const CODE_DEGENERATE = 'DEGENERATE_GEOMETRY';
export const CODE_OUTSIDE_LOT = 'OUTSIDE_LOT';
export const CODE_TERRAIN = 'TERRAIN_UNAVAILABLE';

export function degenerateReason(o: SiteObject): string | null {
  const g = o.geometry, v = verticesOf(g);
  if (!v.length || v.some((p) => p.length < 2 || p.slice(0, 3).some((x) => typeof x !== 'number' || !Number.isFinite(x)))) return 'non finite or missing coordinates';
  if (g.kind === 'point') return null;
  const closed = g.kind === 'polygon', d = dedupe(v, closed);
  if (d.length !== v.length) return 'repeated vertices';
  if (g.kind === 'polyline') {
    if (d.length < 2 || polylineLength(d) < EPS) return 'zero length';
    if (selfIntersects(d, false)) return 'the line crosses itself';
    return null;
  }
  if (d.length < 3) return 'fewer than three distinct vertices';
  if (selfIntersects(d, true)) return 'the outline crosses itself';         // first: a bow tie also has zero net area
  if (polygonArea(d) < EPS) return 'zero area';
  return null;
}

export function checkObject(o: SiteObject, env: CheckEnv): Issue[] {
  const issues: Issue[] = [];
  const bad = degenerateReason(o);
  if (bad) { issues.push({ code: CODE_DEGENERATE, severity: 'blocking', message: `DEGENERATE GEOMETRY: ${bad}` }); return issues; }   // later checks need sound geometry
  const v = verticesOf(o.geometry);
  if (env.lot && env.lot.length >= 3) {
    const out = v.filter((p) => !pointInRing(p, env.lot!)).length;
    const closed = o.geometry.kind === 'polygon';
    const crosses = o.geometry.kind !== 'point' && crossesRing(v, closed, env.lot);
    if (out > 0) issues.push({ code: CODE_OUTSIDE_LOT, severity: 'warning', message: `OUTSIDE LOT: ${out} OF ${v.length} ${v.length === 1 ? 'POINT LIES' : 'VERTICES LIE'} OUTSIDE THE LOT BOUNDARY` });
    else if (crosses) issues.push({ code: CODE_OUTSIDE_LOT, severity: 'warning', message: 'OUTSIDE LOT: AN EDGE CROSSES THE LOT BOUNDARY' });
  }
  if (!env.terrain || !env.terrain.available) issues.push({ code: CODE_TERRAIN, severity: 'warning', message: 'TERRAIN DATA NOT AVAILABLE' });
  else {
    const miss = v.filter((p) => env.terrain!.sample(p[0], p[1]) === null).length;
    if (miss > 0) issues.push({ code: CODE_TERRAIN, severity: 'warning', message: `TERRAIN DATA NOT AVAILABLE: NO TERRAIN UNDER ${miss} OF ${v.length} ${v.length === 1 ? 'POINT' : 'VERTICES'}` });
  }
  return issues;
}

/** Worst severity of an object's issues, for colouring. */
export function worstSeverity(issues: readonly Issue[]): 'blocking' | 'warning' | 'info' | null {
  return issues.some((i) => i.severity === 'blocking') ? 'blocking' : issues.some((i) => i.severity === 'warning') ? 'warning' : issues.length ? 'info' : null;
}
export const sameIssues = (a: readonly Issue[], b: readonly Issue[]) => a.length === b.length && a.every((x, i) => x.code === b[i].code && x.severity === b[i].severity && x.message === b[i].message);
