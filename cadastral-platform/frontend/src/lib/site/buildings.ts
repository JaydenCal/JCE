/**
 * Buildings (stage 5). A building is never designed here: it arrives as a `building_import.v1` payload from the import route
 * (Plan Studio file, PDF, DXF or a footprint entry) in LOCAL plan coordinates and is placed on the terrain with `place_building`.
 * Nothing is invented: a finished floor level, a height, a roof area the source does not give stay NOT SET.
 */
import { fail } from './errors';
import { ringCentroid, rotateClockwise } from './geom';
import { normDeg } from './snap';
import { BUILDING_USES, type Building, type BuildingLevel, type Param, type Pos } from './types';

export const IMPORT_SCHEMA = 'building_import.v1';
const MAX_LEVELS = 16, MAX_RINGS = 64, MAX_RING_VERTICES = 10000, MAX_EXITS = 256, MAX_NOTES = 30;

export type Pt = [number, number];
export interface ImportedLevel { name: string; elevation_m?: number; rings: Pt[][] }
export interface ImportedExtra { type: 'rwt'; p: Pt; yaw_deg?: number; status?: 'existing' | 'proposed'; label?: string; params?: Record<string, Param> }
export interface ImportPayload {
  schema: typeof IMPORT_SCHEMA;
  source: 'plan_studio' | 'pdf' | 'dxf' | 'footprint_entry';
  source_file: string;
  used_site_export?: boolean;
  building: {
    levels: ImportedLevel[]; datum_index: number; roof_outline?: Pt[][];
    exits: { sewer: Pt[]; water: Pt[]; downpipes: Pt[] };
    north_deg?: number; notes: string[]; params: Record<string, Param>;
  };
  /** local point that goes under the cursor when the building is placed */
  ref: Pt;
  aligned_at?: Pt;
  extras: ImportedExtra[];
  warnings: string[];
  requires_confirmation: boolean;
  alignment?: { outcome: string; rmse_m: number; max_residual_m: number; scale_denominator: number; scale_source: string; reflection_applied: boolean };
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
function pt(v: unknown, what: string): Pt {
  if (!Array.isArray(v) || v.length < 2 || !fin(v[0]) || !fin(v[1])) return fail(`${what}: a point must be [x, y] numbers`);
  return [v[0], v[1]];
}
function pts(v: unknown, what: string, max: number): Pt[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > max) return fail(`${what}: expected a list of at most ${max} points`);
  return v.map((p) => pt(p, what));
}
function rings(v: unknown, what: string, min = 1): Pt[][] {
  if (!Array.isArray(v) || v.length < min || v.length > MAX_RINGS) return fail(`${what}: expected between ${min} and ${MAX_RINGS} outlines`);
  return v.map((r) => {
    if (!Array.isArray(r) || r.length < 3 || r.length > MAX_RING_VERTICES) return fail(`${what}: an outline needs 3 to ${MAX_RING_VERTICES} points`);
    return r.map((p) => pt(p, what));
  });
}

/** Check an import payload (from the server, or a test) and return a typed copy. Throws OpError. */
export function parseImportPayload(raw: unknown): ImportPayload {
  if (!raw || typeof raw !== 'object') return fail('the building import is missing');
  const r = raw as Record<string, unknown>;
  if (r.schema !== IMPORT_SCHEMA) fail(`the building import must be ${IMPORT_SCHEMA}`);
  if (!['plan_studio', 'pdf', 'dxf', 'footprint_entry'].includes(r.source as string)) fail('the building import has an unknown source');
  const b = r.building as Record<string, unknown> | undefined;
  if (!b || typeof b !== 'object') return fail('the building import has no building');
  if (!Array.isArray(b.levels) || !b.levels.length || b.levels.length > MAX_LEVELS) return fail(`a building has 1 to ${MAX_LEVELS} levels`);
  const levels: ImportedLevel[] = b.levels.map((l, i) => {
    const o = l as Record<string, unknown>;
    if (!o || typeof o !== 'object' || typeof o.name !== 'string' || !o.name) return fail(`level ${i + 1} needs a name`);
    if (o.elevation_m !== undefined && o.elevation_m !== null && !fin(o.elevation_m)) fail(`level ${i + 1}: elevation must be a number`);
    return { name: o.name.slice(0, 60), ...(fin(o.elevation_m) ? { elevation_m: o.elevation_m } : {}), rings: rings(o.rings, `level ${i + 1}`) };
  });
  const datum = b.datum_index === undefined ? 0 : Number(b.datum_index);
  if (!Number.isInteger(datum) || datum < 0 || datum >= levels.length) fail('datum_index is outside the levels');
  const ex = (b.exits ?? {}) as Record<string, unknown>;
  const params: Record<string, Param> = {};
  for (const [k, p] of Object.entries((b.params ?? {}) as Record<string, Param>)) params[k] = p;
  const extras = (Array.isArray(r.extras) ? r.extras : []).slice(0, 64).map((e): ImportedExtra => {
    const o = e as Record<string, unknown>;
    if (!o || o.type !== 'rwt') return fail('only rainwater tanks come with a building');
    return { type: 'rwt', p: pt(o.p, 'tank'), yaw_deg: fin(o.yaw_deg) ? o.yaw_deg : 0, status: o.status === 'existing' ? 'existing' : 'proposed', ...(typeof o.label === 'string' ? { label: o.label.slice(0, 120) } : {}), params: (o.params ?? {}) as Record<string, Param> };
  });
  return {
    schema: IMPORT_SCHEMA, source: r.source as ImportPayload['source'], source_file: typeof r.source_file === 'string' ? r.source_file.slice(0, 200) : 'import',
    used_site_export: r.used_site_export === true,
    building: {
      levels, datum_index: datum, ...(b.roof_outline ? { roof_outline: rings(b.roof_outline, 'roof outline') } : {}),
      exits: { sewer: pts(ex.sewer, 'sewer exit', MAX_EXITS), water: pts(ex.water, 'water exit', MAX_EXITS), downpipes: pts(ex.downpipes, 'downpipe', MAX_EXITS) },
      ...(fin(b.north_deg) ? { north_deg: b.north_deg } : {}),
      notes: (Array.isArray(b.notes) ? b.notes : []).filter((n): n is string => typeof n === 'string').slice(0, MAX_NOTES).map((n) => n.slice(0, 400)), params,
    },
    ref: pt(r.ref, 'ref'), ...(Array.isArray(r.aligned_at) ? { aligned_at: pt(r.aligned_at, 'aligned_at') } : {}), extras,
    warnings: (Array.isArray(r.warnings) ? r.warnings : []).filter((n): n is string => typeof n === 'string').slice(0, 30).map((n) => n.slice(0, 400)),
    requires_confirmation: r.requires_confirmation === true,
    ...(r.alignment && typeof r.alignment === 'object' ? { alignment: r.alignment as ImportPayload['alignment'] } : {}),
  };
}

/** Parameters an import may set. Anything else in a payload is ignored. */
export const IMPORT_PARAM_KEYS = ['building_use', 'source', 'source_file', 'roof_area_basis', 'roof_plan_area_m2', 'height_m', 'ffl_rl'] as const;
/** Imported source facts that cannot be edited by hand (change the source and import again). */
export const READ_ONLY_BUILDING_PARAMS = new Set(['source', 'source_file', 'roof_area_basis', 'roof_plan_area_m2']);

export function isBuildingUse(v: unknown): boolean { return (BUILDING_USES as readonly unknown[]).includes(v); }

/** local (x, y) of the importer -> MGA, for a building placed with `ref` at `at` and turned clockwise by `yaw`. */
export function localToMga(p: readonly number[], ref: Pt, at: Pt, yaw: number): Pos {
  const q = rotateClockwise([p[0] - ref[0], p[1] - ref[1]], 0, 0, yaw);
  return [at[0] + q[0], at[1] + q[1]];
}

export function levelsToMga(levels: ImportedLevel[], f: (p: Pt) => Pos): BuildingLevel[] {
  return levels.map((l) => ({ name: l.name, ...(l.elevation_m !== undefined ? { elevation_m: l.elevation_m } : {}), rings: l.rings.map((r) => r.map(f)) }));
}

/** Apply `f` to every position of a building (outlines, roof, exits). The frame is handled by the caller. */
export function mapBuildingPositions(b: Building, f: (p: Pos) => Pos): Building {
  return {
    ...b,
    levels: b.levels.map((l) => ({ ...l, rings: l.rings.map((r) => r.map(f)) })),
    ...(b.roof_outline ? { roof_outline: b.roof_outline.map((r) => r.map(f)) } : {}),
    exits: { sewer: b.exits.sewer.map(f), water: b.exits.water.map(f), downpipes: b.exits.downpipes.map(f) },
  };
}
export function moveBuilding(b: Building, dx: number, dy: number): Building {
  const sh = (p: Pos): Pos => (p.length === 3 ? [p[0] + dx, p[1] + dy, p[2]] : [p[0] + dx, p[1] + dy]);
  return { ...mapBuildingPositions(b, sh), frame: { ...b.frame, origin: [b.frame.origin[0] + dx, b.frame.origin[1] + dy] } };
}
export function rotateBuilding(b: Building, cx: number, cy: number, deg: number): Building {
  const o = rotateClockwise(b.frame.origin, cx, cy, deg);
  return { ...mapBuildingPositions(b, (p) => rotateClockwise(p, cx, cy, deg)), frame: { ...b.frame, origin: [o[0], o[1]], yaw_deg: normDeg(b.frame.yaw_deg + deg) } };
}

/** The datum level's footprint: its largest outline. */
export function datumRing(b: Building): Pos[] { return b.levels[b.datum_index].rings[0]; }
export function footprintCentre(b: Building): [number, number] { return ringCentroid(datumRing(b)); }
