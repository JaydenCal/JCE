/**
 * The measurement tool of the viewer (stage 11): distance, area and level difference on the terrain. Pure maths and a small state holder; the picking of points on the
 * terrain and the drawing are done by the engine. A point is an MGA easting and northing and an RL (AHD) read from the terrain mesh, or null where the terrain does not reach.
 * Every result is a reading from the model as drawn: it carries the terrain status of the scene (INDICATIVE 5 m DEM, LIDAR PENDING, NOT SURVEY and the like) and is not a survey.
 */
export interface MeasurePoint { e: number; n: number; rl: number | null }
export type MeasureMode = 'distance' | 'area' | 'level';
export const MEASURE_MODES: readonly MeasureMode[] = ['distance', 'area', 'level'];
export const MEASURE_LABEL: Record<MeasureMode, string> = { distance: 'Distance', area: 'Area', level: 'Level difference' };
/** The most points a measurement holds (a limit of the tool, not a rule). */
export const MEASURE_MAX_POINTS = 60;

export const horizontalDistance = (a: MeasurePoint, b: MeasurePoint): number => Math.hypot(b.e - a.e, b.n - a.n);
/** Straight line distance in space, or null when either level is not available. */
export function slopeDistance(a: MeasurePoint, b: MeasurePoint): number | null {
  return a.rl === null || b.rl === null ? null : Math.hypot(b.e - a.e, b.n - a.n, b.rl - a.rl);
}
/** Length along a path of points, in plan. */
export function pathLength(pts: readonly MeasurePoint[], closed = false): number {
  let s = 0;
  for (let i = 0; i + 1 < pts.length; i++) s += horizontalDistance(pts[i], pts[i + 1]);
  if (closed && pts.length > 2) s += horizontalDistance(pts[pts.length - 1], pts[0]);
  return s;
}
/** Length along a path in space, or null when a level is missing. */
export function pathSlopeLength(pts: readonly MeasurePoint[]): number | null {
  let s = 0;
  for (let i = 0; i + 1 < pts.length; i++) { const d = slopeDistance(pts[i], pts[i + 1]); if (d === null) return null; s += d; }
  return s;
}
/** Plan area of a polygon (shoelace), square metres, always positive. Fewer than three points give 0. */
export function polygonArea(pts: readonly MeasurePoint[]): number {
  if (pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.e * q.n - q.e * p.n; }
  return Math.abs(a) / 2;
}
export interface LevelDifference { dz: number; horizontal: number; /** rise over run as a percentage; null for a zero run */ gradePct: number | null; direction: 'rise' | 'fall' | 'level' }
/** From the first point to the second: positive dz is a rise. Null when either level is not available. */
export function levelDifference(a: MeasurePoint, b: MeasurePoint): LevelDifference | null {
  if (a.rl === null || b.rl === null) return null;
  const dz = b.rl - a.rl, h = horizontalDistance(a, b);
  return { dz, horizontal: h, gradePct: h > 1e-9 ? (dz / h) * 100 : null, direction: Math.abs(dz) < 0.0005 ? 'level' : dz > 0 ? 'rise' : 'fall' };
}

const f = (v: number, nd = 2) => v.toFixed(nd);
export interface MeasureResult {
  mode: MeasureMode; points: number;
  /** the headline value, with its unit, or the reason there is none */
  headline: string;
  /** further lines (uppercase wording for statuses) */
  lines: string[];
  /** a value could not be given because a level is missing (the terrain does not reach a point) */
  missingLevel: boolean;
}
export const NO_POINTS = 'CLICK THE TERRAIN TO PLACE THE FIRST POINT';

/** The readout for a measurement. `terrainStatus` is the scene's terrain status; without one the readout says DATA NOT AVAILABLE. */
export function measureResult(mode: MeasureMode, pts: readonly MeasurePoint[], terrainStatus: string | null | undefined): MeasureResult {
  const status = terrainStatus && terrainStatus.trim() ? terrainStatus.trim().toUpperCase() : 'TERRAIN STATUS DATA NOT AVAILABLE';
  const base = { mode, points: pts.length, missingLevel: pts.some((p) => p.rl === null) };
  const tail = [`LEVELS: ${status}`, 'A READING FROM THE MODEL, NOT A SURVEY'];
  if (mode === 'distance') {
    if (pts.length < 2) return { ...base, headline: pts.length ? 'CLICK THE NEXT POINT' : NO_POINTS, lines: [], missingLevel: false };
    const plan = pathLength(pts), sl = pathSlopeLength(pts);
    return { ...base, headline: `${f(plan)} m in plan`, lines: [sl === null ? 'SLOPE DISTANCE: DATA NOT AVAILABLE (A LEVEL IS MISSING)' : `Slope distance ${f(sl)} m`, `${pts.length - 1} segment${pts.length === 2 ? '' : 's'}`, ...tail] };
  }
  if (mode === 'area') {
    if (pts.length < 3) return { ...base, headline: pts.length ? `CLICK ${3 - pts.length} MORE POINT${pts.length === 2 ? '' : 'S'} AT LEAST` : NO_POINTS, lines: [], missingLevel: false };
    return { ...base, headline: `${f(polygonArea(pts))} m² in plan`, lines: [`Perimeter ${f(pathLength(pts, true))} m`, ...tail] };
  }
  if (pts.length < 2) return { ...base, headline: pts.length ? 'CLICK THE SECOND POINT' : NO_POINTS, lines: [], missingLevel: false };
  const d = levelDifference(pts[0], pts[1]);
  if (!d) return { ...base, headline: 'LEVEL DIFFERENCE: DATA NOT AVAILABLE (THE TERRAIN DOES NOT REACH A POINT)', lines: tail };
  const word = d.direction === 'level' ? 'level' : d.direction === 'rise' ? 'rise' : 'fall';
  return { ...base, headline: d.direction === 'level' ? '0.00 m (level)' : `${f(Math.abs(d.dz))} m ${word}`,
    lines: [`RL ${f(pts[0].rl!, 3)} to RL ${f(pts[1].rl!, 3)} (AHD)`, `Horizontal distance ${f(d.horizontal)} m`, d.gradePct === null ? 'Grade: no horizontal run' : `Average grade ${f(Math.abs(d.gradePct), 1)} %`, ...tail] };
}

/** Holds the points of one measurement. The level mode keeps two points: a third click starts again from it. */
export class MeasureState {
  mode: MeasureMode = 'distance';
  pts: MeasurePoint[] = [];
  setMode(m: MeasureMode) { if (m !== this.mode) { this.mode = m; this.pts = []; } }
  add(p: MeasurePoint): void {
    if (this.mode === 'level' && this.pts.length >= 2) this.pts = [];
    if (this.pts.length >= MEASURE_MAX_POINTS) return;
    this.pts = [...this.pts, p];
  }
  undo(): void { this.pts = this.pts.slice(0, -1); }
  clear(): void { this.pts = []; }
  result(terrainStatus: string | null | undefined): MeasureResult { return measureResult(this.mode, this.pts, terrainStatus); }
}

/** A round length for a scale bar: 1, 2 or 5 times a power of ten that fits `targetPx` pixels at `metresPerPixel`. Returns the metres, the pixels and the label. */
export function niceScaleBar(metresPerPixel: number, targetPx = 110): { metres: number; px: number; label: string } | null {
  if (!(metresPerPixel > 0) || !Number.isFinite(metresPerPixel)) return null;
  const raw = metresPerPixel * targetPx, pow = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / pow;
  const metres = (m >= 5 ? 5 : m >= 2 ? 2 : 1) * pow;
  return { metres, px: metres / metresPerPixel, label: metres >= 1000 ? `${metres / 1000} km` : metres >= 1 ? `${metres} m` : `${Math.round(metres * 100)} cm` };
}
