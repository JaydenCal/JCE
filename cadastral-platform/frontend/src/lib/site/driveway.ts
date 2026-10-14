/**
 * Driveway tools, pure parts (no three.js, no network): the assumed kerb line and chainage along it, the effective driveway object (end level
 * from a linked building), the lightweight long section PREVIEW used while a handle is dragged, and the data of the long section chart.
 *
 * Rules (nothing is invented):
 *  - Every grade, transition and width limit comes from the server response (`rules`, resolved from the LGA rule, the state rule, a platform
 *    default where one exists, otherwise UNRESOLVED). The preview carries those limits over from the last server response; with none, every
 *    limit is UNRESOLVED and no check is evaluated.
 *  - The preview is the same long section as the server engine (backend app/design/driveway_engine.py): existing ground sampled every 0.5 m
 *    along the centreline, stations at the kerb line (chainage 0), the back of the kerb and gutter band, the property boundary and the driveway
 *    end, the design line a straight interpolation between the stations (the verge is not designed). It is NOT a substitute: the server result
 *    replaces it on release, and the preview is marked PREVIEW until then. The B85 underbody check and the earthworks are server only.
 *  - The existing ground is the survey / DEM ground of the bundle (existing and context parts). The design surface is never ground.
 *  - The gutter band station needs the verge (kerb line to property boundary). With no verge it is UNRESOLVED, as on the server: no band station, and its
 *    change of grade check is listed NOT EVALUATED. No platform default verge is substituted.
 *  - When the end station lies within STATION_MERGE_M of an earlier station it replaces that station (the end level is never dropped), as on the server.
 */
import type { SceneBundle } from '@/lib/viewer/types';
import { dist2, type Pt2 } from './geom';
import { dimOf, levelOf, type Param, type SiteDesign, type SiteObject } from './types';

export const PREVIEW_LABEL = 'PREVIEW';
export const SAMPLE_STEP_M = 0.5;
export const KERB_PART = 'Kerb_line_assumed';
/** the gutter band is the SA3 / plan set value: min(0.5 m, a quarter of the verge); recomputed here only for the preview, the server value replaces it */
export const GUTTER_BAND_MAX_M = 0.5;
/** a station closer than this to the one before it is merged (server STATION_MERGE_M) */
export const STATION_MERGE_M = 0.05;
export const NOT_SET = 'NOT SET';

// ---- the assumed kerb line --------------------------------------------------------------------------------------------------------
/** The assumed kerb line: a straight line in MGA, first point to last (the line the 3D model draws parallel to the front boundary). */
export interface Kerb { a: Pt2; b: Pt2; length: number; /** unit direction a to b */ u: Pt2; /** unit normal towards the lot, null when the lot is not known */ n: Pt2 | null }

export function makeKerb(a: Pt2, b: Pt2, lot: readonly Pt2[] | null): Kerb | null {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(L > 1e-6)) return null;
  const u: Pt2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  let n: Pt2 | null = null;
  if (lot && lot.length >= 3) {
    const c: Pt2 = [lot.reduce((s, p) => s + p[0], 0) / lot.length, lot.reduce((s, p) => s + p[1], 0) / lot.length];
    n = [-u[1], u[0]];
    if ((c[0] - a[0]) * n[0] + (c[1] - a[1]) * n[1] < 0) n = [-n[0], -n[1]];
  }
  return { a, b, length: L, u, n };
}
/** The kerb line from the bundle's `Kerb_line_assumed` line part (first segment start to last segment end, as the server does), or null. */
export function kerbFromBundle(b: Pick<SceneBundle, 'parts' | 'info'>, lot: readonly Pt2[] | null): Kerb | null {
  const part = b.parts.find((p) => p.n === KERB_PART && p.lines && p.lines.length >= 6);
  if (!part?.lines) return null;
  const L = part.lines, O = b.info.origin, n = L.length;
  return makeKerb([L[0] + O[0], L[1] + O[1]], [L[n - 3] + O[0], L[n - 2] + O[1]], lot);
}
/** Chainage along the kerb line from its first point, and the signed offset towards the lot (0 when the lot is not known). */
export function chainageOnKerb(k: Kerb, p: readonly number[]): { chainage: number; offset: number } {
  const dx = p[0] - k.a[0], dy = p[1] - k.a[1];
  return { chainage: dx * k.u[0] + dy * k.u[1], offset: k.n ? dx * k.n[0] + dy * k.n[1] : 0 };
}
export function pointOnKerb(k: Kerb, chainage: number): Pt2 { return [k.a[0] + k.u[0] * chainage, k.a[1] + k.u[1] * chainage]; }
/** The nearest point on the kerb line (clamped to its ends) to an MGA point, with its chainage. */
export function projectToKerb(k: Kerb, p: readonly number[]): { p: Pt2; chainage: number; clamped: boolean } {
  const c = chainageOnKerb(k, p).chainage, ch = Math.min(Math.max(c, 0), k.length);
  return { p: pointOnKerb(k, ch), chainage: ch, clamped: ch !== c };
}

// ---- the driveway object, with its end level resolved --------------------------------------------------------------------------------
export const unresolved = (): Param => ({ value: null, basis: 'unresolved' });
/** The building a driveway end is linked to (`end_building_id`), or null when there is no link or the building is gone. */
export function linkedBuilding(doc: SiteDesign, o: SiteObject): SiteObject | null {
  const id = o.params.end_building_id?.value;
  return typeof id === 'string' ? doc.objects.find((x) => x.id === id && x.type === 'building') ?? null : null;
}
/**
 * The driveway as the engine must see it. When the end is linked to a building the link is the source of truth: the end level IS that building's finished
 * floor level (read now, so it follows later changes) and nothing is written into the object. A linked building with no FFL, or a link to a building that
 * is no longer in the design, leaves the end level NOT SET (a level typed earlier or copied before is never used while a link exists, so it can never be
 * stale; the server resolves the link the same way). With no link the object is returned as it is.
 */
export function effectiveDriveway(doc: SiteDesign, o: SiteObject): SiteObject {
  if (o.type !== 'driveway' || typeof o.params.end_building_id?.value !== 'string') return o;
  const b = linkedBuilding(doc, o);
  const ffl = b ? levelOf(b, 'ffl_rl') : null;
  const param: Param = !b || ffl === null ? unresolved() : { value: ffl, basis: 'user', ref: `FFL OF ${b.label ? b.label.toUpperCase() : b.id}` };
  return { ...o, params: { ...o.params, end_level_rl: param } };
}
/** Why the driveway cannot be drawn or checked, as short upper case labels (empty when it has a width and an end level). */
export function drivewayGaps(doc: SiteDesign, o: SiteObject): string[] {
  const e = effectiveDriveway(doc, o), out: string[] = [];
  if (dimOf(e, 'width_m') === null) out.push('WIDTH NOT SET');
  if (levelOf(e, 'end_level_rl') === null) {
    const linked = typeof o.params.end_building_id?.value === 'string';
    out.push(linked ? (linkedBuilding(doc, o) ? 'LINKED BUILDING HAS NO FFL, END LEVEL NOT SET' : 'LINKED BUILDING NOT FOUND, END LEVEL NOT SET') : 'END LEVEL NOT SET');
  }
  return out;
}

// ---- server response (driveway_profile.v1) ---------------------------------------------------------------------------------------------
export interface RuleInfo { key: string; value: number | null; unit: string; basis: string; ref: string | null }
export type CheckStatus = 'PASS' | 'FAIL' | 'NOT EVALUATED';
export interface ProfileCheck {
  id: string; title: string; requirement_key: string | null; status: CheckStatus; value: number | null; limit: number | null; unit: string; basis: string; ref: string | null; note?: string;
  chainage_from_m: number | null; chainage_to_m: number | null;
}
export interface ProfileStation {
  name: string; chainage_m: number; existing_rl: number | null; design_rl: number | null; grade_in_pct: number | null; grade_out_pct: number | null; change_pct: number | null; kind: 'SUMMIT' | 'SAG' | null; transition: string;
}
export interface ProfileSegment { from_m: number; to_m: number; grade_pct: number | null; failing: boolean }
export interface ProfileSamples { chainage: number[]; existing: (number | null)[]; design: number[] | null; grade_pct: number[] | null; transition: string[] | null }
export interface FailingSpan { id: string; title: string; requirement_key: string | null; value: number; limit: number; unit: string; basis: string; ref: string | null; chainage_from_m: number; chainage_to_m: number; message: string }
export interface Zone { kind: 'cut' | 'fill'; min_depth_m: number; max_depth_m: number; area_m2: number; wkt: string }
export interface BatterInfo { h_per_v: number | null; basis: string; ref: string | null; requirement_key: string }
export interface Earthworks {
  label: string; terrain_status: string; grid_m: number; cut_m3: number; fill_m3: number; net_m3: number; cut_area_m2: number; fill_area_m2: number;
  uncertainty_m3: number | null; uncertainty_note: string | null; batters_computed: boolean;
  batters: { cut: BatterInfo; fill: BatterInfo; cut_wkt: string | null; fill_wkt: string | null };
  platform_wkt: string; zones: Zone[]; notes: string[];
}
export interface DrivewayProfile {
  schema: 'driveway_profile.v1'; object_id: string; detail: 'profile' | 'full';
  terrain: { status: string; source: string };
  rules: Record<string, RuleInfo>; rules_for: string; length_m: number; notes: string[];
  crossover: { available: boolean; chainage_m: number | null; offset_from_kerb_m: number | null; kerb_length_m: number | null; frontage_offset_note: string };
  width: { value: number | null; basis: string; ref: string | null };
  end_level: { value: number | null; basis: string; ref: string | null; building_id: string | null; link_note?: string };
  checks: ProfileCheck[]; failing: FailingSpan[];
  geometry?: { boundary_chainage_m: number | null; boundary_point: [number, number] | null; verge_m: number | null; gutter_band_m: number | null; gutter_band_status?: 'RESOLVED' | 'UNRESOLVED'; start: [number, number]; end: [number, number] };
  /** stations that could not be placed (the gutter band when the verge is unknown): left out of `stations`, listed here with the reason */
  unresolved_stations?: { name: string; status: string; reason: string }[];
  stations: ProfileStation[]; segments: ProfileSegment[]; samples: ProfileSamples;
  status: string; earthworks: Earthworks | null; timing_ms?: number;
}
export interface GradingResult {
  schema: 'grading.v1'; object_id: string; status: string; label: string;
  terrain: { status: string; source: string };
  design: { mode: 'level' | 'grade' | 'not_set' | 'no_terrain'; target_level_m: number | null; target_grade_pct?: number; fall_direction_deg?: number; pivot_level_m: number | null; pivot_basis: string | null } | null;
  design_patch?: [number, number, number][]; earthworks: Earthworks | null; checks: ProfileCheck[]; notes: string[]; rules: Record<string, RuleInfo>; timing_ms?: number;
}

/** A long section as the panel and the scene use it: a server result, or the preview computed while dragging. */
export type ProfileView = (DrivewayProfile | DrivewayPreview) & { preview?: boolean };
export interface DrivewayPreview extends Omit<DrivewayProfile, 'earthworks' | 'schema' | 'detail'> { schema: 'driveway_profile.preview'; detail: 'preview'; earthworks: null; preview: true }

// ---- the lightweight preview -------------------------------------------------------------------------------------------------------------
export interface PreviewInput {
  /** centreline vertices in MGA (the crossover first) */
  pts: readonly (readonly number[])[];
  width: number | null;
  endLevel: number | null;
  endLevelBasis: string;
  /** existing ground at an MGA point, or null where the survey / DEM does not reach (never the design surface) */
  existing: (e: number, n: number) => number | null;
  lot: readonly Pt2[] | null;
  kerb: Kerb | null;
  /** limits of the last server response (the same resolved requirements); null = none yet, every limit is UNRESOLVED */
  rules: Record<string, RuleInfo> | null;
  rulesFor?: string;
  terrainStatus: string;
  objectId: string;
}
const KEY_GRADE = 'driveway.max_grade_pct', KEY_CHANGE = 'driveway.max_grade_change_pct', KEY_MIN_W = 'driveway.min_width_m', KEY_MAX_W = 'driveway.max_width_m';
const NO_RULES = 'NO REQUIREMENT HAS BEEN RESOLVED YET (WAITING FOR THE SERVER)';
const GUTTER_UNRESOLVED_WHY = 'THE VERGE (KERB LINE TO PROPERTY BOUNDARY) IS NOT KNOWN IN THE 3D MODEL, SO THE GUTTER BAND STATION IS UNRESOLVED AND LEFT OUT OF THE LONG SECTION';

export function polylineChainages(pts: readonly (readonly number[])[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return out;
}
export function pointAtChainage(pts: readonly (readonly number[])[], cum: readonly number[], t: number): Pt2 {
  const L = cum[cum.length - 1];
  const x = Math.min(Math.max(t, 0), L);
  let i = 1; while (i < cum.length - 1 && cum[i] < x) i++;
  const seg = cum[i] - cum[i - 1] || 1, f = (x - cum[i - 1]) / seg;
  return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
}
/** Chainage of the first crossing of a polyline with a closed ring (the property boundary station), or null. */
export function crossingChainage(pts: readonly (readonly number[])[], ring: readonly Pt2[]): number | null {
  const cum = polylineChainages(pts);
  let best: number | null = null;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
    for (let j = 0; j < ring.length; j++) {
      const [x3, y3] = ring[j], [x4, y4] = ring[(j + 1) % ring.length];
      const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
      if (Math.abs(d) < 1e-12) continue;
      const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d, u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
      if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) continue;
      const c = cum[i - 1] + t * (cum[i] - cum[i - 1]);
      if (best === null || c < best) best = c;
    }
  }
  return best;
}
const interp = (xs: readonly number[], ys: readonly number[], x: number): number => {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let i = 1; while (xs[i] < x) i++;
  return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1] || 1);
};
const r2 = (v: number) => Math.round(v * 100) / 100, r3 = (v: number) => Math.round(v * 1000) / 1000;
const ruleOf = (rules: Record<string, RuleInfo> | null, key: string): RuleInfo =>
  rules?.[key] ?? { key, value: null, unit: '', basis: 'UNRESOLVED', ref: rules ? 'NO REQUIREMENT FOUND' : NO_RULES };

/** Long section of a driveway, computed in the browser from the existing ground height field. Same stations and same limits as the server. */
export function previewProfile(inp: PreviewInput): DrivewayPreview | null {
  if (inp.pts.length < 2) return null;
  const cum = polylineChainages(inp.pts), L = cum[cum.length - 1];
  if (!(L > 0)) return null;
  const ts: number[] = [];
  for (let t = 0; t < L; t += SAMPLE_STEP_M) ts.push(t);
  ts.push(L);
  const ex: { t: number; z: number | null }[] = ts.map((t) => { const p = pointAtChainage(inp.pts, cum, t); return { t, z: inp.existing(p[0], p[1]) }; });
  const ok = ex.filter((e): e is { t: number; z: number } => e.z !== null);
  const rules = inp.rules, notes: string[] = ['PREVIEW: THE SERVER CHECKS REPLACE THIS WHEN THE DRAG ENDS'];
  const base = {
    schema: 'driveway_profile.preview' as const, detail: 'preview' as const, object_id: inp.objectId, terrain: { status: inp.terrainStatus, source: 'existing ground height field' },
    rules: rules ?? {}, rules_for: inp.rulesFor ?? 'REQUIREMENTS NOT YET RESOLVED', length_m: r3(L), notes, earthworks: null, preview: true as const,
  };
  const cross = inp.kerb ? (() => { const c = chainageOnKerb(inp.kerb, inp.pts[0]); return { available: true, chainage_m: r3(c.chainage), offset_from_kerb_m: r3(Math.abs(c.offset)), kerb_length_m: r3(inp.kerb.length), frontage_offset_note: '' }; })()
    : { available: false, chainage_m: null, offset_from_kerb_m: null, kerb_length_m: null, frontage_offset_note: 'ASSUMED KERB LINE NOT AVAILABLE IN THE 3D MODEL' };
  const wr = ruleOf(rules, KEY_MIN_W), wx = ruleOf(rules, KEY_MAX_W);
  const staticChecks: ProfileCheck[] = [['width_min', 'DRIVEWAY WIDTH, MINIMUM', wr, 'min'], ['width_max', 'DRIVEWAY WIDTH, MAXIMUM', wx, 'max']].map(([id, title, r, kind]) => {
    const rr = r as RuleInfo, w = inp.width;
    const status: CheckStatus = w === null || rr.value === null ? 'NOT EVALUATED' : (kind === 'min' ? w >= rr.value - 1e-9 : w <= rr.value + 1e-9) ? 'PASS' : 'FAIL';
    return { id: id as string, title: title as string, requirement_key: rr.key, status, value: w, limit: rr.value, unit: 'm', basis: rr.basis, ref: rr.ref, chainage_from_m: null, chainage_to_m: null };
  });
  const head = {
    ...base, crossover: cross, width: { value: inp.width, basis: inp.width === null ? 'UNRESOLVED' : 'USER', ref: null },
    end_level: { value: inp.endLevel, basis: inp.endLevel === null ? NOT_SET : inp.endLevelBasis, ref: null, building_id: null },
  };
  if (ok.length < 3) {
    return { ...head, checks: staticChecks, failing: [], stations: [], segments: [], samples: { chainage: ts.map(r3), existing: ex.map((e) => (e.z === null ? null : r3(e.z))), design: null, grade_pct: null, transition: null },
      status: 'TERRAIN DATA NOT AVAILABLE: FEWER THAN THREE EXISTING GROUND LEVELS ALONG THE DRIVEWAY' };
  }
  const tt = ok.map((e) => e.t), zz = ok.map((e) => e.z), exz = (t: number) => interp(tt, zz, t);
  const sb = inp.lot ? crossingChainage(inp.pts, inp.lot) : null;
  let verge: number | null = null;
  if (sb !== null && inp.kerb) { const bp = pointAtChainage(inp.pts, cum, sb); verge = Math.abs(chainageOnKerb(inp.kerb, bp).offset); } else if (sb !== null) verge = sb;
  const gw: number | null = verge === null ? null : Math.min(GUTTER_BAND_MAX_M, verge * 0.25);           // no verge: the band station is UNRESOLVED (no default verge)
  const sbv = sb ?? 0;
  const unresolvedStations = gw === null ? [{ name: 'GUTTER BAND', status: 'UNRESOLVED', reason: GUTTER_UNRESOLVED_WHY }] : [];
  if (gw === null) notes.push(`GUTTER BAND UNRESOLVED: ${GUTTER_UNRESOLVED_WHY}`);
  const raw: [number, number, string][] = [[0, exz(0), 'KERB LINE']];
  if (gw !== null) raw.push([gw, exz(gw), 'GUTTER BAND']);
  raw.push([sbv, exz(sbv), 'PROPERTY BOUNDARY']);
  const designed = inp.endLevel !== null;
  if (designed) raw.push([L, inp.endLevel!, 'DRIVEWAY END']);
  raw.sort((a, b) => a[0] - b[0]);
  const st: [number, number, string][] = [];
  for (const s of raw) {
    const prev = st[st.length - 1];
    if (prev && s[0] - prev[0] < STATION_MERGE_M) {
      if (s[2] === 'DRIVEWAY END' && prev[2] !== 'KERB LINE') {                                           // the end level is never lost: the earlier station is dropped
        st[st.length - 1] = s;
        notes.push(`THE ${prev[2]} STATION IS WITHIN ${STATION_MERGE_M} M OF THE DRIVEWAY END AND IS MERGED INTO IT; THE END LEVEL IS KEPT`);
      } else if (s[2] === 'DRIVEWAY END') notes.push(`THE DRIVEWAY END IS WITHIN ${STATION_MERGE_M} M OF THE KERB LINE: THE END LEVEL CANNOT BE USED AND NO DESIGN LINE IS COMPUTED`);
      continue;
    }
    st.push(s);
  }
  const grades = st.slice(1).map((s, i) => (100 * (s[1] - st[i][1])) / (s[0] - st[i][0]));
  const full = designed && st.some((s) => s[2] === 'DRIVEWAY END') && (st.length >= 3 || (gw === null && st.length >= 2));
  const rg = ruleOf(rules, KEY_GRADE), rc = ruleOf(rules, KEY_CHANGE);
  const stations: ProfileStation[] = st.map(([t, z, name], i) => {
    const gin = i > 0 ? grades[i - 1] : null, gout = i < grades.length ? grades[i] : null, ch = gin === null || gout === null ? null : gout - gin;
    const kind = ch === null || Math.abs(ch) <= 0.05 ? null : ch < 0 ? 'SUMMIT' : 'SAG';
    const tr = !full || ch === null ? '' : rc.value === null ? (Math.abs(ch) > 0.05 ? 'UNRESOLVED' : '') : Math.abs(ch) > rc.value + 1e-9 ? 'TRANSITION REQUIRED' : '';
    return { name, chainage_m: r3(t), existing_rl: r3(exz(t)), design_rl: full ? r3(z) : null, grade_in_pct: gin === null ? null : r2(gin), grade_out_pct: gout === null ? null : r2(gout), change_pct: ch === null ? null : r2(Math.abs(ch)), kind, transition: tr };
  });
  const segments: ProfileSegment[] = st.slice(1).map((s, i) => ({ from_m: r3(st[i][0]), to_m: r3(s[0]), grade_pct: full ? r2(grades[i]) : null, failing: full && rg.value !== null && Math.abs(grades[i]) > rg.value + 1e-9 }));
  const dz = (t: number) => interp(st.map((s) => s[0]), st.map((s) => s[1]), t);
  const segOf = (t: number) => { let i = 0; while (i < st.length - 2 && t >= st[i + 1][0]) i++; return i; };
  const samples: ProfileSamples = {
    chainage: ts.map(r3), existing: ex.map((e) => (e.z === null ? null : r3(e.z))),
    design: full ? ts.map((t) => r3(dz(t))) : null, grade_pct: full ? ts.map((t) => r2(grades[segOf(t)])) : null, transition: null,
  };
  const checks: ProfileCheck[] = [];
  const failing: FailingSpan[] = [];
  if (full) {
    const mg = Math.max(...grades.map(Math.abs)), lim = rg.value, bad = lim === null ? [] : grades.map((g, i) => [g, i] as const).filter(([g]) => Math.abs(g) > lim + 1e-9);
    const status: CheckStatus = lim === null ? 'NOT EVALUATED' : bad.length ? 'FAIL' : 'PASS';
    const c: ProfileCheck = { id: 'max_grade', title: 'STEEPEST GRADE', requirement_key: KEY_GRADE, status, value: r2(mg), limit: lim, unit: '%', basis: rg.basis, ref: rg.ref, chainage_from_m: bad.length ? st[Math.min(...bad.map(([, i]) => i))][0] : null, chainage_to_m: bad.length ? st[Math.max(...bad.map(([, i]) => i)) + 1][0] : null };
    checks.push(c);
    for (let i = 1; i < st.length - 1; i++) {
      const d = Math.abs(grades[i] - grades[i - 1]), lm = rc.value, s2: CheckStatus = lm === null ? 'NOT EVALUATED' : d > lm + 1e-9 ? 'FAIL' : 'PASS';
      checks.push({ id: `change_of_grade@${st[i][2]}`, title: `CHANGE OF GRADE AT ${st[i][2]}`, requirement_key: KEY_CHANGE, status: s2, value: r2(d), limit: lm, unit: '%', basis: rc.basis, ref: rc.ref, chainage_from_m: s2 === 'FAIL' ? st[i][0] : null, chainage_to_m: s2 === 'FAIL' ? st[i][0] : null });
    }
    checks.push({ id: 'b85_scraping_clearance', title: 'B85 UNDERBODY CLEARANCE, FORWARD AND REVERSE', requirement_key: null, status: 'NOT EVALUATED', value: null, limit: null, unit: 'm', basis: 'PLATFORM SCREENING TEMPLATE (B85), NOT A COUNCIL REQUIREMENT', ref: null, note: 'SERVER ONLY: NOT COMPUTED IN THE PREVIEW', chainage_from_m: null, chainage_to_m: null });
    if (gw === null) checks.push({ id: 'change_of_grade@GUTTER BAND', title: 'CHANGE OF GRADE AT GUTTER BAND', requirement_key: KEY_CHANGE, status: 'NOT EVALUATED', value: null, limit: null, unit: '%', basis: 'UNRESOLVED', ref: rc.ref, note: 'GUTTER BAND STATION UNRESOLVED: THE VERGE IS NOT KNOWN IN THE 3D MODEL', chainage_from_m: null, chainage_to_m: null });
  } else {
    checks.push({ id: 'profile', title: 'LONG SECTION CHECKS', requirement_key: null, status: 'NOT EVALUATED', value: null, limit: null, unit: '', basis: 'UNRESOLVED', ref: null, note: designed ? 'NO DESIGN LINE' : 'END LEVEL NOT SET', chainage_from_m: null, chainage_to_m: null });
    notes.push('END LEVEL NOT SET: THE DESIGN LINE AND THE CHECKS ARE NOT COMPUTED');
  }
  checks.push(...staticChecks);
  for (const c of checks) if (c.status === 'FAIL' && c.chainage_from_m !== null && c.chainage_to_m !== null && c.value !== null && c.limit !== null) {
    failing.push({ id: c.id, title: c.title, requirement_key: c.requirement_key, value: c.value, limit: c.limit, unit: c.unit, basis: c.basis, ref: c.ref, chainage_from_m: c.chainage_from_m, chainage_to_m: c.chainage_to_m, message: failMessage(c) });
  }
  return {
    ...head, checks, failing, stations, segments, samples, status: full ? 'OK' : 'END LEVEL NOT SET', unresolved_stations: unresolvedStations,
    geometry: { boundary_chainage_m: sb === null ? null : r3(sb), boundary_point: sb === null ? null : (pointAtChainage(inp.pts, cum, sb) as [number, number]), verge_m: verge === null ? null : r3(verge), gutter_band_m: gw === null ? null : r3(gw), gutter_band_status: gw === null ? 'UNRESOLVED' as const : 'RESOLVED' as const, start: [inp.pts[0][0], inp.pts[0][1]], end: [inp.pts[inp.pts.length - 1][0], inp.pts[inp.pts.length - 1][1]] },
  };
}

/** Hover text of a failing span: the requirement key, its limit and the value, with the basis. */
export function failMessage(c: Pick<ProfileCheck, 'requirement_key' | 'limit' | 'value' | 'unit' | 'basis'>): string {
  return `${c.requirement_key} ${c.limit} ${c.unit} (${c.basis}): ${c.value} ${c.unit}`;
}

// ---- long section chart ------------------------------------------------------------------------------------------------------------------
export interface ChartBox { width: number; height: number; padLeft: number; padRight: number; padTop: number; padBottom: number }
export const CHART_BOX: ChartBox = { width: 560, height: 220, padLeft: 44, padRight: 12, padTop: 14, padBottom: 34 };
export interface ChartSegment { x0: number; x1: number; fromM: number; toM: number; gradePct: number | null; label: string; failing: boolean; /** hover text for a failing segment */ title: string }
export interface ChartStation { x: number; yDesign: number | null; yExisting: number | null; name: string; transition: string; kind: string | null }
export interface ChartModel {
  box: ChartBox; preview: boolean;
  /** SVG path data */
  existing: string; design: string | null;
  /** failing spans drawn over the design line, as path data with the hover text */
  failing: { d: string; title: string }[];
  segments: ChartSegment[]; stations: ChartStation[];
  xTicks: { x: number; label: string }[]; yTicks: { y: number; label: string }[];
  /** chainage and level ranges drawn */
  range: { t0: number; t1: number; z0: number; z1: number };
  /** why nothing is drawn, or null */
  empty: string | null;
}
const gradeLabel = (g: number | null) => (g === null ? 'GRADE NOT SET' : `${g > 0 ? '+' : ''}${g.toFixed(1)}%`);
const niceStep = (span: number, n: number) => { const raw = span / n, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; };

/** Map a profile (server result or preview) to the SVG chart: existing and design lines, segment grade labels and failing spans. */
export function chartModel(pf: Pick<DrivewayProfile, 'samples' | 'stations' | 'segments' | 'failing' | 'status'> & { preview?: boolean }, box: ChartBox = CHART_BOX): ChartModel {
  const empty = (why: string): ChartModel => ({ box, preview: !!pf.preview, existing: '', design: null, failing: [], segments: [], stations: [], xTicks: [], yTicks: [], range: { t0: 0, t1: 0, z0: 0, z1: 0 }, empty: why });
  const s = pf.samples;
  if (!s || s.chainage.length < 2) return empty('NO PROFILE');
  const known = s.existing.map((z, i) => [s.chainage[i], z] as const).filter((e): e is readonly [number, number] => e[1] !== null);
  if (known.length < 2) return empty('TERRAIN DATA NOT AVAILABLE ALONG THE DRIVEWAY');
  const zs = [...known.map((e) => e[1]), ...(s.design ?? [])];
  const t0 = s.chainage[0], t1 = s.chainage[s.chainage.length - 1];
  let z0 = Math.min(...zs), z1 = Math.max(...zs);
  if (z1 - z0 < 0.5) { const m = (z0 + z1) / 2; z0 = m - 0.25; z1 = m + 0.25; }                     // a level profile still gets a readable axis (display only)
  const pad = (z1 - z0) * 0.08; z0 -= pad; z1 += pad;
  const w = box.width - box.padLeft - box.padRight, h = box.height - box.padTop - box.padBottom;
  const X = (t: number) => box.padLeft + ((t - t0) / (t1 - t0 || 1)) * w, Y = (z: number) => box.padTop + (1 - (z - z0) / (z1 - z0)) * h;
  const path = (pts: readonly (readonly [number, number])[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join(' ');
  const design = s.design ? s.chainage.map((t, i) => [t, s.design![i]] as const) : null;
  const dAt = (t: number): number | null => {
    if (!design) return null;
    let i = 1; while (i < design.length - 1 && design[i][0] < t) i++;
    const a = design[i - 1], b = design[i]; return a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0] || 1);
  };
  const failing = pf.failing.map((f) => {
    const a = f.chainage_from_m, b = f.chainage_to_m;
    const pts: [number, number][] = [[a, dAt(a) ?? 0]];
    for (let i = 0; i < s.chainage.length; i++) if (s.chainage[i] > a && s.chainage[i] < b && s.design) pts.push([s.chainage[i], s.design[i]]);
    pts.push([b, dAt(b) ?? 0]);
    return { d: pts.length > 1 && a !== b ? path(pts) : `M${(X(a) - 3).toFixed(1)} ${Y(dAt(a) ?? z0).toFixed(1)} L${(X(a) + 3).toFixed(1)} ${Y(dAt(a) ?? z0).toFixed(1)}`, title: f.message };
  });
  const failFor = (a: number, b: number) => pf.failing.filter((f) => f.id === 'max_grade' && f.chainage_from_m <= a + 1e-6 && f.chainage_to_m >= b - 1e-6);
  const segments = pf.segments.map((g): ChartSegment => {
    const fl = g.failing ? failFor(g.from_m, g.to_m)[0] : undefined;
    return { x0: X(g.from_m), x1: X(g.to_m), fromM: g.from_m, toM: g.to_m, gradePct: g.grade_pct, label: gradeLabel(g.grade_pct), failing: g.failing, title: fl ? fl.message : '' };
  });
  const stations = pf.stations.map((q): ChartStation => ({ x: X(q.chainage_m), yDesign: q.design_rl === null ? null : Y(q.design_rl), yExisting: q.existing_rl === null ? null : Y(q.existing_rl), name: q.name, transition: q.transition, kind: q.kind }));
  const xs = niceStep(t1 - t0, 6), ys = niceStep(z1 - z0, 4), xTicks: ChartModel['xTicks'] = [], yTicks: ChartModel['yTicks'] = [];
  for (let t = Math.ceil(t0 / xs) * xs; t <= t1 + 1e-9; t += xs) xTicks.push({ x: X(t), label: `${+t.toFixed(2)}` });
  for (let z = Math.ceil(z0 / ys) * ys; z <= z1 + 1e-9; z += ys) yTicks.push({ y: Y(z), label: z.toFixed(ys < 1 ? 1 : 0) });
  return { box, preview: !!pf.preview, existing: path(known), design: design ? path(design) : null, failing, segments, stations, xTicks, yTicks, range: { t0, t1, z0, z1 }, empty: null };
}

// ---- WKT (the polygons the server returns, MGA) -------------------------------------------------------------------------------------------
type Nest = string | Nest[];
function nest(s: string): Nest[] {
  const root: Nest[] = [], stack: Nest[][] = [root];
  let text = '';
  const flush = () => { const t = text.trim(); if (t) stack[stack.length - 1].push(t); text = ''; };
  for (const ch of s) {
    if (ch === '(') { flush(); const n: Nest[] = []; stack[stack.length - 1].push(n); stack.push(n); }
    else if (ch === ')') { flush(); if (stack.length > 1) stack.pop(); }
    else if (ch === ',') flush();
    else text += ch;
  }
  flush();
  return root;
}
const asRing = (n: Nest): Pt2[] | null => {
  if (!Array.isArray(n)) return null;
  const pts = n.filter((x): x is string => typeof x === 'string').map((x) => x.split(/\s+/).map(Number)).filter((v) => v.length >= 2 && v.every(Number.isFinite)).map((v): Pt2 => [v[0], v[1]]);
  if (pts.length > 1 && dist2(pts[0], pts[pts.length - 1]) < 1e-9) pts.pop();
  return pts.length >= 3 ? pts : null;
};
/** Polygons of a POLYGON or MULTIPOLYGON WKT: each polygon is a list of rings (outer first); a ring is an open list of points (the closing point dropped). */
export function parseWkt(wkt: string | null | undefined): Pt2[][][] {
  if (!wkt) return [];
  const t = wkt.trim().toUpperCase();
  if (t.includes('EMPTY')) return [];
  const multi = t.startsWith('MULTIPOLYGON');
  if (!multi && !t.startsWith('POLYGON')) return [];
  const tree = nest(t.slice(t.indexOf('('))), top = tree[0];
  if (!Array.isArray(top)) return [];
  const polys: Nest[][] = multi ? top.filter(Array.isArray) as Nest[][] : [top];
  return polys.map((pg) => pg.map(asRing).filter((r): r is Pt2[] => r !== null)).filter((rings) => rings.length > 0);
}
