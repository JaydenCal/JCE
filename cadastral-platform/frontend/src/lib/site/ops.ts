/**
 * Operation registry for the site design document, ported from Plan Studio's `model/ops.js` (generic part: the P schema helpers,
 * `num`, `oneOf`, `OpError`, the registry shape, `applyOp`, `toolSchemas`).
 *
 * Differences from Plan Studio: `run(doc, args, ctx)` does not mutate; it returns a PATCH (JSON Patch operations) plus a result, so the
 * store can record an exact inverse instead of cloning the whole document. The same registry serves the mouse tools and, from stage 10,
 * the AI (`toolSchemas()` emits Anthropic tool definitions).
 */
import { centroid, dedupe, ringCentroid, rotateClockwise } from './geom';
import { READ_ONLY_BUILDING_PARAMS, IMPORT_PARAM_KEYS, IMPORT_ID_RE, levelsToMga, localToMga, moveBuilding, parseImportPayload, rotateBuilding } from './buildings';
import { applyPatch, ptr, type Patch } from './patch';
import { normDeg } from './snap';
import {
  BASES, ISO_DATE_RE, OBJECT_KINDS, OBJECT_TYPES, ORIGINS, PARAM_BOOLS, PARAM_DATES, PARAM_ENUMS, PARAM_LINKS, PARAM_NUMBERS, STATUSES, canonicalType, minVertices, platformDefaultRefused, verticesOf,
  type Basis, type Building, type Geometry, type GeometryKind, type ObjectType, type Origin, type Param, type Pos, type SiteDesign, type SiteObject, type Status,
} from './types';

import { OpError, fail } from './errors';
export { OpError };

/** The assumed kerb line as the operations need it: first point, unit direction and length, in MGA metres. */
export interface KerbRef { a: readonly number[]; u: readonly number[]; length: number }
/** How close to the kerb line (metres) a crossover point must be for `set_driveway_crossover`; also the slack allowed at the ends of the line. */
export const KERB_TOL_M = 0.05;
export interface OpCtx {
  /** id generator; ops fall back to a unique id when it returns one already in use */
  newId(type: ObjectType): string;
  /** the assumed kerb line of the 3D model, or null/absent when the model has none (the crossover is then not constrained and no chainage is stored) */
  kerb?: () => KerbRef | null;
}
let seq = 0;
export const defaultCtx: OpCtx = { newId: (t) => `${t}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}` };

export interface OpOutcome { patch: Patch; result: Record<string, unknown> }
export interface JsonSchema { type?: string; description?: string; enum?: unknown[]; items?: JsonSchema; properties?: Record<string, JsonSchema>; required?: string[]; additionalProperties?: boolean | JsonSchema; minItems?: number }
export interface OpDef {
  label: string;
  description: string;
  params: Record<string, JsonSchema>;
  required: string[];
  /** false: the operation is for the person at the keyboard only and is NOT offered to the AI (`toolSchemas` leaves it out) */
  ai?: false;
  run(doc: SiteDesign, args: Record<string, unknown>, ctx: OpCtx): OpOutcome;
}

// ---- parameter helpers (Plan Studio: num, oneOf) ------------------------------------------------------------------------------
export function num(v: unknown, name: string, { min = -1e9, max = 1e9, optional = false } = {}): number {
  if (v === undefined || v === null || v === '') { if (optional) return undefined as unknown as number; return fail(`${name} is required`); }
  const n = Number(v);
  if (!Number.isFinite(n)) fail(`${name} must be a number`);
  if (n < min || n > max) fail(`${name} must be between ${min} and ${max}`);
  return n;
}
export function oneOf<T extends string>(v: unknown, list: readonly T[], name: string, optional = false): T {
  if (v === undefined || v === null) { if (optional) return undefined as unknown as T; return fail(`${name} is required`); }
  if (!(list as readonly unknown[]).includes(v)) fail(`${name} must be one of: ${list.join(', ')}`);
  return v as T;
}
const P = {
  num: (description: string): JsonSchema => ({ type: 'number', description }),
  int: (description: string): JsonSchema => ({ type: 'integer', description }),
  str: (description: string): JsonSchema => ({ type: 'string', description }),
  enm: (values: readonly string[], description: string): JsonSchema => ({ type: 'string', enum: [...values], description }),
  pos: (description: string): JsonSchema => ({
    type: 'object', description, properties: { e: { type: 'number', description: 'MGA easting, metres' }, n: { type: 'number', description: 'MGA northing, metres' }, z: { type: 'number', description: 'Optional RL in metres. Omit to drape on the terrain.' } }, required: ['e', 'n'],
  }),
  points: (description: string): JsonSchema => ({
    type: 'array', description, minItems: 1, items: { type: 'object', properties: { e: { type: 'number' }, n: { type: 'number' }, z: { type: 'number' } }, required: ['e', 'n'] },
  }),
  params: (description: string): JsonSchema => ({
    type: 'object', description, additionalProperties: {
      type: 'object', properties: { value: { description: 'number, text or true/false; omit or null for UNRESOLVED' }, basis: { type: 'string', enum: [...BASES] }, ref: { type: 'string', description: 'Requirement key or stamp text. Required for LGA RULE.' } }, required: ['basis'],
    },
  }),
};
const ID = P.str('Object id');
const MAX_VERTICES = 10000;

// ---- validation ---------------------------------------------------------------------------------------------------------------
const KEY = /^[a-z][a-z0-9_]{0,63}$/;
/** Keys that would reach the prototype chain of a plain object. Never accepted as a parameter key. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export const MAX_PARAMS = 64;
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function parsePos(v: unknown, name: string): Pos {
  if (!v || typeof v !== 'object') return fail(`${name} must be an object {e, n, z?}`);
  const o = v as Record<string, unknown>;
  const e = num(o.e, `${name}.e`), n = num(o.n, `${name}.n`);
  const z = num(o.z, `${name}.z`, { optional: true });
  return z === undefined ? [e, n] : [e, n, z];
}
function parsePoints(v: unknown, name: string): Pos[] {
  if (!Array.isArray(v)) return fail(`${name} must be a list of {e, n, z?}`);
  if (v.length > MAX_VERTICES) fail(`${name} has too many points`);
  return v.map((p, i) => parsePos(p, `${name}[${i}]`));
}
export function parseParam(key: string, raw: unknown): Param {
  if (FORBIDDEN_KEYS.has(key)) fail(`parameter key ${key} is reserved`);
  if (!KEY.test(key)) fail(`parameter key ${key} must be lower case letters, digits and underscores, starting with a letter`);
  if (!raw || typeof raw !== 'object') return fail(`parameter ${key} must be {value, basis, ref?}`);
  const r = raw as Record<string, unknown>;
  const basis = oneOf<Basis>(r.basis, BASES, `${key}.basis`);
  const value = r.value === undefined ? null : r.value;
  const ref = r.ref === undefined || r.ref === null || String(r.ref).trim() === '' ? undefined : String(r.ref).trim().slice(0, 200);
  if (basis === 'unresolved') {
    if (value !== null) fail(`${key} is UNRESOLVED and cannot carry a value`);
    return { value: null, basis };
  }
  if (value === null) fail(`${key} needs a value for basis ${basis}`);
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail(`${key} must be a finite number`); }
  else if (typeof value === 'string') { if (value.length > 200) fail(`${key} text is too long`); }
  else if (typeof value !== 'boolean') fail(`${key} must be a number, text or true/false`);
  if (basis === 'lga_rule' && !ref) fail(`${key}: an LGA RULE value needs its requirement reference (ref)`);
  return { value: value as Param['value'], basis, ...(ref ? { ref } : {}) };
}
/** The stage 5 typed parameters: text limited to a list, numbers that must be numbers (the backend model refuses the same). */
export function checkTypedParam(type: ObjectType, key: string, p: Param): Param {
  const allowed = PARAM_ENUMS[`${type}.${key}`];
  if (allowed && p.value !== null && !allowed.includes(p.value as string)) fail(`${key} must be one of: ${allowed.join(', ')}`);
  if ((PARAM_NUMBERS[type] ?? []).includes(key) && p.value !== null && typeof p.value !== 'number') fail(`${key} must be a number`);
  if ((PARAM_BOOLS[type] ?? []).includes(key) && p.value !== null && typeof p.value !== 'boolean') fail(`${key} must be true or false`);
  if ((PARAM_DATES[type] ?? []).includes(key) && p.value !== null && !(typeof p.value === 'string' && ISO_DATE_RE.test(p.value))) fail(`${key} must be a date written YYYY-MM-DD`);
  if (p.basis === 'platform_default' && platformDefaultRefused(type, key, p.ref)) fail(`${key}: a platform default is not accepted for a ${type.replace(/_/g, ' ')} parameter; enter a value (basis user) or cite the requirement key (basis lga_rule with its key as ref)`);
  return p;
}
function parseParams(v: unknown, type?: ObjectType): Record<string, Param> {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) return fail('params must be an object');
  const out: Record<string, Param> = {};
  for (const [k, p] of Object.entries(v as Record<string, unknown>)) { out[k] = parseParam(k, p); if (type) checkTypedParam(type, k, out[k]); }
  if (Object.keys(out).length > MAX_PARAMS) fail('too many parameters');
  return out;
}
const UNRESOLVED: Param = { value: null, basis: 'unresolved' };
/**
 * Parameters a new object of a stage 5 type starts with. They are all UNRESOLVED (NOT SET): no depth, width, level or surface is ever defaulted.
 * Stage 4 types start with no parameters.
 */
function startingParams(type: ObjectType, shape: GeometryKind): Record<string, Param> {
  const keys: string[] = type === 'pool' ? ['depth_m', 'coping_width_m', 'water_level_rl', 'barrier_requirements']
    : type === 'footpath' ? (shape === 'polyline' ? ['width_m', 'surface_kind'] : ['surface_kind'])
    : type === 'furniture' ? ['catalogue_item', 'width_m', 'depth_m', 'height_m']
    // stage 6: a driveway starts with no width, end level, surface or batter slope (all NOT SET). A grading area keeps starting with NO parameters
    // (stage 4 contract): an absent target or batter slope is NOT SET, and the panel lists the keys it can take (PANEL_KEYS).
    : type === 'driveway' ? ['width_m', 'end_level_rl', 'surface_kind', 'batter_cut_h_per_v', 'batter_fill_h_per_v'] : [];
  return Object.fromEntries(keys.map((k) => [k, { ...UNRESOLVED }]));
}

function find(doc: SiteDesign, id: unknown): { o: SiteObject; i: number } {
  const i = doc.objects.findIndex((x) => x.id === id);
  if (i < 0) return fail(`No object with id ${String(id)}`);
  return { o: doc.objects[i], i };
}
const objPath = (i: number, ...rest: (string | number)[]) => ptr('objects', i, ...rest);

export function buildGeometry(kind: Geometry['kind'], pts: Pos[], yaw?: number): Geometry {
  if (kind === 'point') {
    if (pts.length !== 1) fail('a point object needs exactly one point');
    return { kind, p: pts[0], ...(yaw !== undefined ? { yaw_deg: normDeg(yaw) } : {}) };
  }
  const d = kind === 'polygon' ? dedupe(pts, true) : pts;               // a repeated closing vertex is dropped; other repeats are kept and flagged by the checks
  if (d.length < minVertices(kind)) fail(`a ${kind} needs at least ${minVertices(kind)} points`);
  return kind === 'polyline' ? { kind, pts: d } : { kind, ring: d };
}
function withVertices(g: Geometry, v: Pos[]): Geometry {
  return g.kind === 'point' ? { ...g, p: v[0] } : g.kind === 'polyline' ? { kind: 'polyline', pts: v } : { kind: 'polygon', ring: v };
}
const shift = (p: Pos, dx: number, dy: number): Pos => (p.length === 3 ? [p[0] + dx, p[1] + dy, p[2]] : [p[0] + dx, p[1] + dy]);
const BUILDING_FOOTPRINT = 'a building footprint is read only: it comes from the import. Move or rotate the building, or import it again.';

// ---- registry -----------------------------------------------------------------------------------------------------------------
export const OPS: Record<string, OpDef> = {
  add_object: {
    label: 'Add object',
    description: 'Add a site object. Point objects (tree, rwt, stormwater_pit, osd, furniture) take one point; polyline objects (retaining_wall, infiltration_trench, stormwater_pipe, service_trace, footpath, driveway, pool_barrier, overflow_route) take two or more; polygon objects (landscape_area, grading_area, osd_basin, pool) take three or more; a footpath may be drawn as an area with shape polygon. A building cannot be added here: it is imported (place_building). Points are MGA metres. No dimension is defaulted: an object without dimensions is shown as a marker labelled DIMENSIONS NOT SET.',
    params: {
      type: P.enm(OBJECT_TYPES.filter((t) => t !== 'building'), 'Object type'),
      shape: P.enm(['polyline', 'polygon'], 'Footpath only: polyline (a line with a width, default) or polygon (an area)'),
      points: P.points('Vertices in MGA metres (E, N, optional z). One point for point objects.'),
      yaw_deg: P.num('Point objects only: clockwise from grid north, degrees'),
      status: P.enm(STATUSES, 'existing, proposed or to_be_removed. Default proposed.'),
      origin: P.enm(['user', 'ai_proposal'], 'user (default) or ai_proposal (starts as pending acceptance)'),
      label: P.str('Optional label'),
      params: P.params('Parameters keyed by name, each {value, basis, ref?}'),
      id: P.str('Optional id (letters, digits, underscore, hyphen). Generated when omitted.'),
    },
    required: ['type', 'points'],
    run(doc, a, ctx) {
      const type = oneOf<ObjectType>(canonicalType(a.type), OBJECT_TYPES, 'type');
      if (type === 'building') fail('a building cannot be added here: it is imported from Plan Studio, a PDF, a DXF or a footprint (place_building)');
      const shape = oneOf<GeometryKind>(a.shape ?? OBJECT_KINDS[type].geometry, [OBJECT_KINDS[type].geometry, ...(OBJECT_KINDS[type].alt ? [OBJECT_KINDS[type].alt!] : [])], 'shape');
      const kind = shape;
      const yaw = num(a.yaw_deg, 'yaw_deg', { optional: true });
      if (yaw !== undefined && kind !== 'point') fail('yaw_deg applies to point objects only');
      const geometry = buildGeometry(kind, parsePoints(a.points, 'points'), yaw);
      const origin = oneOf<Origin>(a.origin ?? 'user', ['user', 'ai_proposal'], 'origin');
      const taken = new Set(doc.objects.map((o) => o.id));
      let id: string;
      if (a.id !== undefined && a.id !== null) {
        id = String(a.id); if (!ID_RE.test(id)) fail('id must be 1 to 64 letters, digits, underscores or hyphens'); if (taken.has(id)) fail(`id ${id} is already in use`);
      } else { id = ctx.newId(type); while (taken.has(id)) id = ctx.newId(type); }
      const obj: SiteObject = {
        id, type, status: oneOf<Status>(a.status ?? 'proposed', STATUSES, 'status'), origin, ...(origin === 'ai_proposal' ? { accepted: 'pending' as const } : {}),
        verified: false, ...(a.label ? { label: String(a.label).slice(0, 120) } : {}), geometry, params: { ...startingParams(type, kind), ...parseParams(a.params, type) }, issues: [],
      };
      return { patch: [{ op: 'add', path: ptr('objects', '-'), value: obj }], result: { id } };
    },
  },
  move_object: {
    label: 'Move object',
    description: 'Move a whole object by an offset in metres (dx east, dy north). Vertex RLs that were set are kept.',
    params: { id: ID, dx: P.num('Metres east'), dy: P.num('Metres north') },
    required: ['id', 'dx', 'dy'],
    run(doc, a) {
      const { o, i } = find(doc, a.id), dx = num(a.dx, 'dx'), dy = num(a.dy, 'dy');
      if (dx === 0 && dy === 0) return { patch: [], result: { id: o.id } };
      const mv: Patch = [{ op: 'replace', path: objPath(i, 'geometry'), value: withVertices(o.geometry, verticesOf(o.geometry).map((p) => shift(p, dx, dy))) }];
      if (o.building) mv.push({ op: 'replace', path: objPath(i, 'building'), value: moveBuilding(o.building, dx, dy) });
      return { patch: mv, result: { id: o.id } };
    },
  },
  rotate_object: {
    label: 'Rotate object',
    description: 'Rotate an object clockwise (seen from above) by an angle in degrees about a pivot. The pivot defaults to the point itself for point objects (its yaw changes) and to the centre of the vertices for lines and areas.',
    params: { id: ID, angle_deg: P.num('Clockwise degrees (negative is anticlockwise)'), about: P.pos('Optional pivot (E, N)') },
    required: ['id', 'angle_deg'],
    run(doc, a) {
      const { o, i } = find(doc, a.id), ang = num(a.angle_deg, 'angle_deg');
      if (ang === 0) return { patch: [], result: { id: o.id } };
      const g = o.geometry, about = a.about === undefined || a.about === null ? null : parsePos(a.about, 'about');
      if (g.kind === 'point') {
        const yaw = normDeg((g.yaw_deg ?? 0) + ang);
        const p = about ? rotateClockwise(g.p, about[0], about[1], ang) : g.p;
        return { patch: [{ op: 'replace', path: objPath(i, 'geometry'), value: { ...g, p, yaw_deg: yaw } }], result: { id: o.id, yaw_deg: yaw } };
      }
      const v = verticesOf(g), c = about ? [about[0], about[1]] : g.kind === 'polygon' ? ringCentroid(v) : centroid(v);
      const rt: Patch = [{ op: 'replace', path: objPath(i, 'geometry'), value: withVertices(g, v.map((p) => rotateClockwise(p, c[0], c[1], ang))) }];
      if (o.building) rt.push({ op: 'replace', path: objPath(i, 'building'), value: rotateBuilding(o.building, c[0], c[1], ang) });
      return { patch: rt, result: { id: o.id } };
    },
  },
  edit_vertices: {
    label: 'Edit vertices',
    description: 'Insert, move or delete one vertex of a polyline or polygon object. index is zero based: insert places the new vertex at that index (0 to the vertex count); move and delete act on the vertex at that index.',
    params: { id: ID, action: P.enm(['insert', 'move', 'delete'], 'insert, move or delete'), index: P.int('Vertex index (whole number, zero based)'), point: P.pos('New position (insert and move)') },
    required: ['id', 'action', 'index'],
    run(doc, a) {
      const { o, i } = find(doc, a.id), g = o.geometry;
      if (g.kind === 'point') return fail('a point object has no vertices; use move_object');
      if (o.building) fail(BUILDING_FOOTPRINT);
      const action = oneOf(a.action, ['insert', 'move', 'delete'] as const, 'action');
      const key = g.kind === 'polyline' ? 'pts' : 'ring', n = verticesOf(g).length, idx = num(a.index, 'index', { min: 0, max: n });
      if (!Number.isInteger(idx)) fail('index must be a whole number');
      const at = objPath(i, 'geometry', key, idx), rls = o.vertex_rls;
      if (action === 'insert') {
        if (n >= MAX_VERTICES) fail('too many vertices');
        // a wall's levels stay one per vertex: the new vertex starts with NOT SET levels (never interpolated)
        const sync: Patch = rls ? [{ op: 'add', path: objPath(i, 'vertex_rls', 'top', idx), value: null }, { op: 'add', path: objPath(i, 'vertex_rls', 'bottom', idx), value: null }] : [];
        return { patch: [{ op: 'add', path: at, value: parsePos(a.point, 'point') }, ...sync], result: { id: o.id, index: idx } };
      }
      if (idx >= n) return fail(`index ${idx} is out of range (the object has ${n} vertices)`);
      if (action === 'move') return { patch: [{ op: 'replace', path: at, value: parsePos(a.point, 'point') }], result: { id: o.id, index: idx } };
      if (n - 1 < minVertices(g.kind)) return fail(`a ${g.kind} needs at least ${minVertices(g.kind)} vertices; delete the object instead`);
      const drop: Patch = rls ? [{ op: 'remove', path: objPath(i, 'vertex_rls', 'top', idx) }, { op: 'remove', path: objPath(i, 'vertex_rls', 'bottom', idx) }] : [];
      return { patch: [{ op: 'remove', path: at }, ...drop], result: { id: o.id, index: idx } };
    },
  },
  set_param: {
    label: 'Set parameter',
    description: 'Set one parameter with its basis: user (entered by the user), lga_rule (needs the requirement key as ref; the server checks it resolves to this value, otherwise the value is not used) or unresolved (no value). A platform default cannot be set. Dimension parameters are never defaulted.',
    params: { id: ID, key: P.str('Parameter key, e.g. height_m'), value: { description: 'number, text or true/false; omit or null for UNRESOLVED' }, basis: P.enm(BASES.filter((b) => b !== 'platform_default'), 'Default user, or unresolved when value is empty'), ref: P.str('Requirement key or stamp') },
    required: ['id', 'key'],
    run(doc, a) {
      const { o, i } = find(doc, a.id), key = String(a.key ?? '');
      if (o.type === 'building' && READ_ONLY_BUILDING_PARAMS.has(key)) fail(`${key} is a fact from the import and cannot be edited; import the building again`);
      if (a.basis === 'platform_default') fail(`${key}: a platform default cannot be set. Enter a value (basis user), cite the requirement key (basis lga_rule with its key as ref) or leave it unresolved`);
      const empty = a.value === undefined || a.value === null || a.value === '';
      const param = checkTypedParam(o.type, key, parseParam(key, { value: empty ? null : a.value, basis: a.basis ?? (empty ? 'unresolved' : 'user'), ref: a.ref }));
      const links = PARAM_LINKS[`${o.type}.${key}`];
      if (links && param.value !== null) {
        const t = doc.objects.find((x) => x.id === param.value);
        if (!t || !links.includes(t.type)) fail(`${key} must be the id of an object in this design of type ${links.join(' or ')}`);
      }
      const exists = hasOwn(o.params, key);
      if (!exists && Object.keys(o.params).length >= MAX_PARAMS) fail(`an object can have at most ${MAX_PARAMS} parameters`);
      return { patch: [{ op: exists ? 'replace' : 'add', path: objPath(i, 'params', key), value: param }], result: { id: o.id, key } };
    },
  },
  remove_param: {
    label: 'Remove parameter',
    description: 'Remove one parameter from an object. The parameter returns to NOT SET (a dimension is never defaulted). Undo restores it.',
    params: { id: ID, key: P.str('Parameter key to remove') },
    required: ['id', 'key'],
    run(doc, a) {
      const { o, i } = find(doc, a.id), key = String(a.key ?? '');
      if (FORBIDDEN_KEYS.has(key) || !hasOwn(o.params, key)) return fail(`${o.id} has no parameter ${key}`);
      if (o.type === 'building' && READ_ONLY_BUILDING_PARAMS.has(key)) fail(`${key} is a fact from the import and cannot be removed`);
      return { patch: [{ op: 'remove', path: objPath(i, 'params', key) }], result: { id: o.id, key } };
    },
  },
  set_status: {
    label: 'Set status',
    description: 'Set an object to existing, proposed or to_be_removed. A building can be set to to_be_removed only when it is existing.',
    params: { id: ID, status: P.enm(STATUSES, 'New status') },
    required: ['id', 'status'],
    run(doc, a) {
      const { o, i } = find(doc, a.id), status = oneOf<Status>(a.status, STATUSES, 'status');
      // A building is never placed as to_be_removed (place_building refuses it), so only an EXISTING building may become one: a proposed
      // building that is not wanted is deleted, not "removed". Existing and to_be_removed may be switched back and forth.
      if (o.type === 'building' && status === 'to_be_removed' && o.status !== 'existing' && o.status !== 'to_be_removed') fail('only an existing building can be set to be removed; delete a proposed building instead');
      return { patch: status === o.status ? [] : [{ op: 'replace', path: objPath(i, 'status'), value: status }], result: { id: o.id } };
    },
  },
  delete_object: {
    label: 'Delete object',
    description: 'Delete an object.',
    params: { id: ID },
    required: ['id'],
    run(doc, a) {
      const { o, i } = find(doc, a.id);
      return { patch: [{ op: 'remove', path: objPath(i) }], result: { id: o.id } };
    },
  },
  duplicate_object: {
    label: 'Duplicate object',
    description: 'Copy an object with its parameters, offset by dx, dy metres (default 0). The copy is a user object, unverified, with no issues until checked.',
    params: { id: ID, dx: P.num('Metres east (default 0)'), dy: P.num('Metres north (default 0)'), new_id: P.str('Optional id for the copy') },
    required: ['id'],
    run(doc, a, ctx) {
      const { o } = find(doc, a.id), dx = num(a.dx ?? 0, 'dx'), dy = num(a.dy ?? 0, 'dy');
      const taken = new Set(doc.objects.map((x) => x.id));
      let id: string;
      if (a.new_id !== undefined && a.new_id !== null) { id = String(a.new_id); if (!ID_RE.test(id)) fail('new_id must be 1 to 64 letters, digits, underscores or hyphens'); if (taken.has(id)) fail(`id ${id} is already in use`); }
      else { id = ctx.newId(o.type); while (taken.has(id)) id = ctx.newId(o.type); }
      const copy: SiteObject = structuredClone(o);
      copy.id = id; copy.origin = 'user'; delete copy.accepted; copy.verified = false; delete copy.verified_on; copy.issues = [];
      copy.geometry = withVertices(copy.geometry, verticesOf(copy.geometry).map((p) => shift(p, dx, dy)));
      if (copy.building) copy.building = moveBuilding(copy.building, dx, dy);
      return { patch: [{ op: 'add', path: ptr('objects', '-'), value: copy }], result: { id } };
    },
  },
  place_building: {
    label: 'Place building',
    description: 'Place an imported building (a building_import.v1 payload from the import route) on the site. `import_id` is the id the import route stored the payload under; the server only accepts a saved building that matches that stored import (its levels, outlines, roof outline, exits and source facts), so a payload that was edited here is refused when the design is saved. `at` is the MGA position that the payload reference point goes to, yaw_deg a clockwise turn in degrees. The footprint, levels, roof outline and exit points are copied as given (read only). Finished floor level and height start NOT SET unless the source gave them; a building use the source does not give starts NOT SET. A rainwater tank that came with the building is added as an rwt object in the same step. Nothing is designed here. Not offered to the AI: it may only move buildings that exist.',
    ai: false,
    params: {
      import_id: P.str('The import_id returned by the import route (32 hex characters)'),
      payload: { type: 'object', description: 'The building_import.v1 document returned by the import route' },
      at: P.pos('MGA position (E, N) for the reference point of the import'),
      yaw_deg: P.num('Clockwise rotation in degrees (default 0: true north up)'),
      status: P.enm(STATUSES, 'existing or proposed. Default proposed. (A placed building is never to_be_removed; set an existing building to to_be_removed afterwards.)'),
      label: P.str('Optional label'), glb_name: P.str('Name of the Plan Studio GLB shown as the visual'), id: P.str('Optional id for the building'),
    },
    required: ['import_id', 'payload', 'at'],
    run(doc, a, ctx) {
      const pl = parseImportPayload(a.payload), at = parsePos(a.at, 'at'), yaw = num(a.yaw_deg ?? 0, 'yaw_deg');
      const importId = typeof a.import_id === 'string' ? a.import_id : '';
      if (!IMPORT_ID_RE.test(importId)) fail('import_id is missing or invalid: a building can only be placed from an import made by the server (import the file or footprint again)');
      if (pl.import_id !== undefined && pl.import_id !== importId) fail('import_id does not match the payload');
      const status = oneOf<Status>(a.status ?? 'proposed', STATUSES, 'status');
      if (status === 'to_be_removed') fail('a building is placed as existing or proposed');
      const A: [number, number] = [at[0], at[1]], f = (p: readonly number[]) => localToMga(p, pl.ref, A, yaw);
      const levels = levelsToMga(pl.building.levels, (p) => f(p));
      const ring = levels[pl.building.datum_index].rings[0];
      const geometry = buildGeometry('polygon', ring);
      const taken = new Set(doc.objects.map((o) => o.id));
      const fresh = (type: ObjectType, want?: unknown): string => {
        if (want !== undefined && want !== null) { const id = String(want); if (!ID_RE.test(id)) fail('id must be 1 to 64 letters, digits, underscores or hyphens'); if (taken.has(id)) fail(`id ${id} is already in use`); taken.add(id); return id; }
        let id = ctx.newId(type); while (taken.has(id)) id = ctx.newId(type); taken.add(id); return id;
      };
      const params: Record<string, Param> = { ffl_rl: { ...UNRESOLVED }, height_m: { ...UNRESOLVED } };
      for (const k of IMPORT_PARAM_KEYS) {
        const raw = pl.building.params[k];
        if (raw !== undefined) params[k] = checkTypedParam('building', k, parseParam(k, raw));
      }
      if (!params.building_use || params.building_use.value === null) params.building_use = { ...UNRESOLVED };          // the use is NOT SET until the user chooses it; never defaulted
      const origin = f([0, 0]);
      const building: Building = {
        levels, datum_index: pl.building.datum_index,
        ...(pl.building.roof_outline ? { roof_outline: pl.building.roof_outline.map((r) => r.map((p) => f(p))) } : {}),
        exits: { sewer: pl.building.exits.sewer.map((p) => f(p)), water: pl.building.exits.water.map((p) => f(p)), downpipes: pl.building.exits.downpipes.map((p) => f(p)) },
        frame: { origin: [origin[0], origin[1]], yaw_deg: ((yaw % 360) + 360) % 360, ...(pl.building.north_deg !== undefined ? { north_deg: pl.building.north_deg } : {}) },
        ...(a.glb_name ? { glb_name: String(a.glb_name).slice(0, 200) } : {}), import_id: importId, notes: pl.building.notes,
      };
      const bid = fresh('building', a.id);
      const obj: SiteObject = {
        id: bid, type: 'building', status, origin: 'imported', verified: false, ...(a.label ? { label: String(a.label).slice(0, 120) } : {}),
        geometry, params, issues: [], building,
      };
      const patch: Patch = [{ op: 'add', path: ptr('objects', '-'), value: obj }];
      const tanks: string[] = [];
      for (const t of pl.extras) {
        const tid = fresh('rwt'), p = f(t.p);
        const tp: Record<string, Param> = {};
        for (const [k, v] of Object.entries(t.params ?? {})) if (['capacity_l', 'diameter_m', 'height_m'].includes(k)) tp[k] = parseParam(k, v);
        patch.push({ op: 'add', path: ptr('objects', '-'), value: { id: tid, type: 'rwt', status: t.status ?? 'proposed', origin: 'imported', verified: false, ...(t.label ? { label: t.label } : {}), geometry: { kind: 'point', p: [p[0], p[1]], yaw_deg: ((((t.yaw_deg ?? 0) + yaw) % 360) + 360) % 360 }, params: tp, issues: [] } satisfies SiteObject });
        tanks.push(tid);
      }
      return { patch, result: { id: bid, tanks } };
    },
  },
  set_catalogue_item: {
    label: 'Set furniture item',
    description: 'Set the catalogue item of a furniture object. The size comes from the catalogue dimensions only (width_m, depth_m, height_m in metres, each above 0); a dimension the catalogue does not give is left NOT SET and the object is shown as DIMENSIONS NOT SET. source_ref names where the dimensions come from.',
    params: {
      id: ID, item_id: P.str('Catalogue item id'), source_ref: P.str('Where the dimensions come from, e.g. RETAIL CATALOGUE or PLAN STUDIO CATALOGUE'),
      width_m: P.num('Catalogue width, metres'), depth_m: P.num('Catalogue depth, metres'), height_m: P.num('Catalogue height, metres'),
    },
    required: ['id', 'item_id'],
    run(doc, a) {
      const { o, i } = find(doc, a.id);
      if (o.type !== 'furniture') fail(`${o.id} is not a furniture object`);
      const item = String(a.item_id ?? '').trim();
      if (!item || item.length > 200) fail('item_id must be 1 to 200 characters');
      const ref = String(a.source_ref ?? 'CATALOGUE').slice(0, 160);
      const patch: Patch = [];
      const put = (key: string, p: Param) => patch.push({ op: hasOwn(o.params, key) ? 'replace' : 'add', path: objPath(i, 'params', key), value: p });
      put('catalogue_item', { value: item, basis: 'user', ref });
      for (const k of ['width_m', 'depth_m', 'height_m']) {
        const v = a[k];
        if (v === undefined || v === null || v === '') { put(k, { ...UNRESOLVED }); continue; }
        const n = Number(v);
        put(k, Number.isFinite(n) && n > 0 ? { value: n, basis: 'platform_default', ref: `${ref}: ${item}`.slice(0, 200) } : { ...UNRESOLVED });
      }
      return { patch, result: { id: o.id } };
    },
  },
  set_driveway_crossover: {
    label: 'Move crossover',
    description: 'Move the crossover of a driveway: its FIRST centreline point, which lies on the assumed kerb line. With translate true the whole centreline moves by the same offset (the driveway slides along the frontage); otherwise only the first point moves and the rest of the centreline stays where it is. The point must lie on the assumed kerb line of the 3D model (within 0.05 m, and not beyond its ends) or the operation fails; its chainage along the kerb line from the first point of the line is stored as crossover_chainage_m. When the 3D model has no kerb line the point is not constrained and no chainage is stored.',
    params: { id: ID, point: P.pos('New crossover position (E, N) on the assumed kerb line'), translate: { type: 'boolean', description: 'Move every centreline point by the same offset (default false)' } },
    required: ['id', 'point'],
    run(doc, a, ctx) {
      const { o, i } = find(doc, a.id);
      const g = o.geometry;
      if (o.type !== 'driveway' || g.kind !== 'polyline') return fail(`${o.id} is not a driveway`);
      const p = parsePos(a.point, 'point'), v = g.pts, dx = p[0] - v[0][0], dy = p[1] - v[0][1];
      const kerb = ctx.kerb?.() ?? null;
      let chainage: number | null = null;
      if (kerb) {
        const rx = p[0] - kerb.a[0], ry = p[1] - kerb.a[1];
        chainage = rx * kerb.u[0] + ry * kerb.u[1];
        const off = Math.abs(-rx * kerb.u[1] + ry * kerb.u[0]);
        if (off > KERB_TOL_M) fail(`the crossover point is ${off.toFixed(2)} m off the assumed kerb line; it must lie on the kerb line (within ${KERB_TOL_M} m)`);
        if (chainage < -KERB_TOL_M || chainage > kerb.length + KERB_TOL_M) fail(`the crossover point is beyond the ends of the assumed kerb line (chainage ${chainage.toFixed(2)} m of ${kerb.length.toFixed(2)} m)`);
        chainage = Math.round(Math.min(Math.max(chainage, 0), kerb.length) * 1000) / 1000;
      }
      const patch: Patch = [];
      if (dx !== 0 || dy !== 0) {
        const pts = a.translate === true ? v.map((q) => shift(q, dx, dy)) : [p.length === 3 ? p : ([p[0], p[1]] as Pos), ...v.slice(1)];
        patch.push({ op: 'replace', path: objPath(i, 'geometry', 'pts'), value: pts });
      }
      const has = hasOwn(o.params, 'crossover_chainage_m');
      if (chainage !== null) {
        const cur = has ? o.params.crossover_chainage_m.value : undefined;
        if (cur !== chainage) patch.push({ op: has ? 'replace' : 'add', path: objPath(i, 'params', 'crossover_chainage_m'), value: { value: chainage, basis: 'user', ref: 'CHAINAGE ALONG THE ASSUMED KERB LINE FROM ITS FIRST POINT (3D MODEL)' } as Param });
      } else if (has && patch.length) patch.push({ op: 'remove', path: objPath(i, 'params', 'crossover_chainage_m') });          // no kerb line to vouch for it any more: a stale chainage is not kept
      return { patch, result: { id: o.id } };
    },
  },
  link_driveway_end: {
    label: 'Link driveway end',
    description: 'Link the end of a driveway to a placed building, so the design end level is that building\'s finished floor level (ffl_rl, entered by the user or read from the import). building_id null removes the link. The level is read when the driveway is checked, so it follows later changes to the building; a building with no FFL leaves the end level NOT SET. Nothing is defaulted.',
    params: { id: ID, building_id: { type: 'string', description: 'Id of a building object, or null to remove the link' } },
    required: ['id'],
    run(doc, a) {
      const { o, i } = find(doc, a.id);
      if (o.type !== 'driveway') fail(`${o.id} is not a driveway`);
      const has = hasOwn(o.params, 'end_building_id');
      if (a.building_id === undefined || a.building_id === null || a.building_id === '') {
        return { patch: has ? [{ op: 'remove', path: objPath(i, 'params', 'end_building_id') }] : [], result: { id: o.id } };
      }
      const bid = String(a.building_id), b = doc.objects.find((x) => x.id === bid);
      if (!b || b.type !== 'building') fail(`${bid} is not a building in this design`);
      const param: Param = { value: bid, basis: 'user', ref: 'END SNAPPED TO THE BUILDING; END LEVEL IS ITS FFL' };
      if (has && o.params.end_building_id.value === bid) return { patch: [], result: { id: o.id } };
      return { patch: [{ op: has ? 'replace' : 'add', path: objPath(i, 'params', 'end_building_id'), value: param }], result: { id: o.id } };
    },
  },
  set_vertex_rl: {
    label: 'Set wall levels',
    description: 'Set the RL of the top and/or the bottom of a retaining wall at one vertex (index is zero based). A value of null makes that level NOT SET again. The retained height at a vertex is the top RL minus the bottom RL. Levels are never interpolated or defaulted.',
    params: { id: ID, index: P.int('Vertex index (whole number, zero based)'), top: { description: 'RL of the top of the wall in metres, or null for NOT SET. Omit to leave unchanged.' }, bottom: { description: 'RL of the bottom of the wall in metres, or null for NOT SET. Omit to leave unchanged.' } },
    required: ['id', 'index'],
    run(doc, a) {
      const { o, i } = find(doc, a.id);
      if (o.type !== 'retaining_wall' || o.geometry.kind !== 'polyline') return fail(`${o.id} is not a retaining wall`);
      const n = o.geometry.pts.length, idx = num(a.index, 'index', { min: 0, max: n - 1 });
      if (!Number.isInteger(idx)) fail('index must be a whole number');
      const lvl = (v: unknown, name: string): number | null | undefined => (v === undefined ? undefined : v === null || v === '' ? null : num(v, name));
      const top = lvl(a.top, 'top'), bottom = lvl(a.bottom, 'bottom');
      if (top === undefined && bottom === undefined) fail('give top, bottom or both');
      const cur = o.vertex_rls ?? { top: Array<number | null>(n).fill(null), bottom: Array<number | null>(n).fill(null) };
      const next = { top: [...cur.top], bottom: [...cur.bottom] };
      if (top !== undefined) next.top[idx] = top;
      if (bottom !== undefined) next.bottom[idx] = bottom;
      if (next.top.every((x) => x === null) && next.bottom.every((x) => x === null)) {
        return { patch: o.vertex_rls ? [{ op: 'remove', path: objPath(i, 'vertex_rls') }] : [], result: { id: o.id } };       // nothing set: the field is absent (NOT SET)
      }
      return { patch: [{ op: o.vertex_rls ? 'replace' : 'add', path: objPath(i, 'vertex_rls'), value: next }], result: { id: o.id, index: idx } };
    },
  },
  clear_vertex_rls: {
    label: 'Clear wall levels',
    description: 'Remove the per vertex levels of a retaining wall. The retained height then comes from the uniform height_m parameter, or is NOT SET.',
    params: { id: ID },
    required: ['id'],
    run(doc, a) {
      const { o, i } = find(doc, a.id);
      return { patch: o.vertex_rls ? [{ op: 'remove', path: objPath(i, 'vertex_rls') }] : [], result: { id: o.id } };
    },
  },
  accept_proposal: {
    label: 'Accept proposal',
    description: 'Accept an AI proposal.',
    params: { id: ID },
    required: ['id'],
    run(doc, a) { return decide(doc, a.id, 'accepted'); },
  },
  reject_proposal: {
    label: 'Reject proposal',
    description: 'Reject an AI proposal. The object is kept, marked rejected and hidden in the model.',
    params: { id: ID },
    required: ['id'],
    run(doc, a) { return decide(doc, a.id, 'rejected'); },
  },
};
function decide(doc: SiteDesign, id: unknown, to: 'accepted' | 'rejected'): OpOutcome {
  const { o, i } = find(doc, id);
  if (o.origin !== 'ai_proposal') fail(`${o.id} is not an AI proposal`);
  if (o.accepted === to) return { patch: [], result: { id: o.id } };
  return { patch: [{ op: o.accepted === undefined ? 'add' : 'replace', path: objPath(i, 'accepted'), value: to }], result: { id: o.id } };
}

// ---- running ------------------------------------------------------------------------------------------------------------------
export interface ApplyResult { doc: SiteDesign; patch: Patch; inverse: Patch; result: Record<string, unknown> }

/** Run one operation. Throws OpError (document untouched) on invalid arguments. */
export function applyOp(doc: SiteDesign, name: string, args: Record<string, unknown> = {}, ctx: OpCtx = defaultCtx): ApplyResult {
  const op = OPS[name];
  if (!op) fail(`Unknown operation ${name}`);
  const out = op.run(doc, args ?? {}, ctx);
  const r = applyPatch(doc, out.patch);
  return { doc: r.doc, patch: out.patch, inverse: r.inverse, result: out.result };
}

export interface BatchStep { op: string; args?: Record<string, unknown> }
export type BatchOutcome = { ok: true; op: string; result: Record<string, unknown> } | { ok: false; op: string; error: string };
export interface BatchResult { doc: SiteDesign; patch: Patch; inverse: Patch; results: BatchOutcome[]; /** atomic batches only: a step failed and nothing was applied */ rolledBack?: boolean }

/**
 * Run several operations against the evolving document and return ONE combined patch and inverse (one undo step). By default a failing step (any
 * error) is reported and skipped; it changes nothing and never aborts the batch (the AI's batch). With `atomic` the batch is all or nothing: at the
 * first failing step the batch stops, the ORIGINAL document is returned with an empty patch (`rolledBack` true) and `results` ends with the failure.
 */
export function runBatch(doc: SiteDesign, steps: BatchStep[], ctx: OpCtx = defaultCtx, opts: { atomic?: boolean } = {}): BatchResult {
  let cur = doc;
  const patch: Patch = [], inverses: Patch[] = [], results: BatchOutcome[] = [];
  for (const s of steps) {
    try {
      const r = applyOp(cur, s.op, s.args ?? {}, ctx);
      cur = r.doc; patch.push(...r.patch); inverses.push(r.inverse); results.push({ ok: true, op: s.op, result: r.result });
    } catch (e) {
      // OpError (bad arguments), PatchError (a patch that does not fit the document) or any other failure of ONE step: report it and
      // carry on. The step changed nothing (applyOp never mutates), so the rest of the batch still runs against `cur`.
      results.push({ ok: false, op: s.op, error: e instanceof Error ? e.message : String(e) });
      if (opts.atomic) return { doc, patch: [], inverse: [], results, rolledBack: true };
    }
  }
  return { doc: cur, patch, inverse: inverses.reverse().flat(), results };
}

/** Anthropic tool definitions generated from the registry (stage 10 hands these to the model). Operations marked `ai: false` (place_building) are left out. */
export function toolSchemas(): { name: string; description: string; input_schema: { type: 'object'; properties: Record<string, JsonSchema>; required: string[] } }[] {
  return Object.entries(OPS).filter(([, op]) => op.ai !== false).map(([name, op]) => ({
    name, description: op.description, input_schema: { type: 'object' as const, properties: structuredClone(op.params), required: [...op.required] },
  }));
}
