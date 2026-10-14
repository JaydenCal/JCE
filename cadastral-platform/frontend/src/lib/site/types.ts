/** `site_design.v1` (docs/14 section 5). Mirrors backend/app/design/site_design.py; tests/fixtures/site_design_v1.json is validated by both. */

export const SITE_DESIGN_SCHEMA = 'site_design.v1' as const;

export type ObjectType =
  | 'tree' | 'rwt' | 'stormwater_pit' | 'osd'
  | 'retaining_wall' | 'infiltration_trench' | 'stormwater_pipe' | 'service_trace'
  | 'landscape_area' | 'grading_area' | 'osd_basin'
  | 'building' | 'pool' | 'footpath' | 'furniture'
  | 'driveway'
  | 'pool_barrier' | 'overflow_route'
  | 'service_existing' | 'sewer_drain' | 'service_node' | 'water_service';
/** Stage 7 renamed the stormwater pit from `pit`. A stored document or a caller that still says `pit` is read as `stormwater_pit` (the backend does the same). */
export const LEGACY_TYPES: Record<string, ObjectType> = { pit: 'stormwater_pit' };
export const canonicalType = (t: unknown): unknown => (typeof t === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_TYPES, t) ? LEGACY_TYPES[t] : t);
export type GeometryKind = 'point' | 'polyline' | 'polygon';
export type Status = 'existing' | 'proposed' | 'to_be_removed';
export type Origin = 'user' | 'ai_proposal' | 'imported' | 'dbyd';
export type Accepted = 'pending' | 'accepted' | 'rejected';
export type Basis = 'user' | 'lga_rule' | 'platform_default' | 'unresolved' | 'plan_indicated' | 'derived';
export type Severity = 'blocking' | 'warning' | 'info';

/** MGA metres: [E, N] or [E, N, z]. A missing z means the point is draped on the terrain. */
export type Pos = [number, number] | [number, number, number];

export interface Param {
  /** null when UNRESOLVED */
  value: number | string | boolean | null;
  basis: Basis;
  /** requirement key or stamp text; mandatory for an LGA RULE value */
  ref?: string;
}
export interface Issue { code: string; severity: Severity; message: string }

export interface PointGeometry { kind: 'point'; p: Pos; /** clockwise from grid north, degrees */ yaw_deg?: number }
export interface PolylineGeometry { kind: 'polyline'; pts: Pos[] }
export interface PolygonGeometry { kind: 'polygon'; /** open ring: the first point is not repeated */ ring: Pos[] }
export type Geometry = PointGeometry | PolylineGeometry | PolygonGeometry;

export interface SiteObject {
  id: string;
  type: ObjectType;
  status: Status;
  origin: Origin;
  /** AI proposals only */
  accepted?: Accepted;
  verified: boolean;
  /** ISO date YYYY-MM-DD (shown DD/MM/YYYY) */
  verified_on?: string;
  label?: string;
  geometry: Geometry;
  params: Record<string, Param>;
  issues: Issue[];
  /** buildings only (stage 5): imported, read only geometry; only placement (move, rotate) changes it */
  building?: Building;
  /** retaining walls only (stage 7): the RL of the top and of the bottom of the wall at each vertex; null = NOT SET at that vertex. One entry per vertex. */
  vertex_rls?: VertexRls;
}
export interface VertexRls { top: (number | null)[]; bottom: (number | null)[] }

/** One level of an imported building. `elevation_m` is relative to the datum level (the ground floor) and comes from the source. */
export interface BuildingLevel { name: string; elevation_m?: number; /** outer rings in MGA, largest first */ rings: Pos[][] }
/** Where the building's sewer, water and downpipes leave it (MGA). Empty = none in the source. */
export interface BuildingExits { sewer: Pos[]; water: Pos[]; downpipes: Pos[] }
/** `origin` is the MGA position of the importer's local (0, 0); `yaw_deg` the clockwise rotation applied since import; `north_deg` the Plan Studio north angle already applied. */
export interface BuildingFrame { origin: [number, number]; yaw_deg: number; north_deg?: number }
export interface Building {
  levels: BuildingLevel[];
  /** the ground floor level (the FFL datum); the object geometry is its largest ring */
  datum_index: number;
  roof_outline?: Pos[][];
  exits: BuildingExits;
  frame: BuildingFrame;
  /** name of the Plan Studio GLB shown as the visual (the bytes are not stored in the document) */
  glb_name?: string;
  /** the stored server side import this building came from; the server refuses a saved building that does not match it */
  import_id?: string;
  notes: string[];
}

export interface SiteDesign {
  schema: typeof SITE_DESIGN_SCHEMA;
  /** server save counter (optimistic concurrency); never touched by edits or undo */
  version: number;
  project_id?: string;
  updated_at?: string;
  objects: SiteObject[];
}

export interface ObjectKind {
  geometry: GeometryKind;
  /** a second geometry kind the type may also use (a footpath is a line with a width, or an area) */
  alt?: GeometryKind;
  /** upper case, used in 3D labels and tool names */
  label: string;
  /**
   * Parameter keys whose values give the object its dimensions. Placeholders until stage 7: no default value exists for any of
   * them. While one is unset the object is drawn as a marker labelled DIMENSIONS NOT SET.
   */
  dims: string[];
  colour: string;
}
export const OBJECT_KINDS: Record<ObjectType, ObjectKind> = {
  tree: { geometry: 'point', label: 'TREE', dims: ['height_m', 'canopy_diameter_m'], colour: '#3f8f4a' },
  // stage 7: the dimensions depend on the shape (round: diameter and height; slimline and underground: length, width and height), see dimKeys
  rwt: { geometry: 'point', label: 'RAINWATER TANK', dims: ['diameter_m', 'height_m'], colour: '#2d6cdf' },
  stormwater_pit: { geometry: 'point', label: 'STORMWATER PIT', dims: ['width_m', 'length_m'], colour: '#4a4f55' },
  osd: { geometry: 'point', label: 'OSD TANK', dims: ['width_m', 'length_m', 'height_m'], colour: '#7a4fc4' },
  // stage 7: the wall height is per vertex (vertex_rls) or one height_m, so `dims` lists only the thickness; see dimensionsSet
  retaining_wall: { geometry: 'polyline', label: 'RETAINING WALL', dims: ['thickness_m'], colour: '#8c6a43' },
  infiltration_trench: { geometry: 'polyline', label: 'INFILTRATION TRENCH', dims: ['width_m', 'depth_m'], colour: '#2a9d8f' },
  stormwater_pipe: { geometry: 'polyline', label: 'STORMWATER PIPE', dims: ['diameter_mm'], colour: '#1f5fd1' },
  service_trace: { geometry: 'polyline', label: 'SERVICE TRACE', dims: [], colour: '#d9822b' },
  landscape_area: { geometry: 'polygon', label: 'LANDSCAPE AREA', dims: [], colour: '#6aa84f' },
  // stage 6: the target is a level OR a grade with a fall direction (see gradingTargetSet), so there is no single dimension key
  grading_area: { geometry: 'polygon', label: 'GRADING AREA', dims: [], colour: '#b8860b' },
  osd_basin: { geometry: 'polygon', label: 'OSD BASIN', dims: ['depth_m'], colour: '#5b6fd6' },
  // stage 5. A building is imported (never designed here): its footprint is its dimension, so it has no dimension parameters.
  building: { geometry: 'polygon', label: 'BUILDING', dims: [], colour: '#8d7b68' },
  pool: { geometry: 'polygon', label: 'POOL', dims: ['depth_m', 'coping_width_m'], colour: '#29a3c7' },
  footpath: { geometry: 'polyline', alt: 'polygon', label: 'FOOTPATH', dims: ['width_m'], colour: '#b3a58f' },
  furniture: { geometry: 'point', label: 'OUTDOOR FURNITURE', dims: ['width_m', 'depth_m', 'height_m'], colour: '#a0642d' },
  // stage 6. The centreline's FIRST point is the crossover on the assumed kerb line; the last is the garage end. The width is never defaulted.
  driveway: { geometry: 'polyline', label: 'DRIVEWAY', dims: [], colour: '#6b7280' },
  // stage 7. A pool barrier is a fence line with a height; an overflow route is an OSD overflow path (no dimension).
  pool_barrier: { geometry: 'polyline', label: 'POOL BARRIER', dims: ['height_m'], colour: '#c0392b' },
  overflow_route: { geometry: 'polyline', label: 'OVERFLOW ROUTE', dims: [], colour: '#e67e22' },
  // stage 8. An existing service (from a DBYD plan or traced): a line, or a point for a pit, valve or pole. Its colour follows the service kind (see SERVICE_COLOUR).
  service_existing: { geometry: 'polyline', alt: 'point', label: 'EXISTING SERVICE', dims: [], colour: '#d9822b' },
  sewer_drain: { geometry: 'polyline', label: 'SEWER DRAIN', dims: ['diameter_mm'], colour: '#7b5e3b' },
  service_node: { geometry: 'point', label: 'SERVICE NODE', dims: [], colour: '#444444' },
  water_service: { geometry: 'polyline', label: 'WATER SERVICE', dims: ['diameter_mm'], colour: '#1d8fe0' },
};
// ---- stage 8 enumerations (the same lists are in the backend model)
export const SERVICE_KINDS = ['water', 'sewer', 'stormwater', 'gas', 'electricity', 'telecommunications', 'other'] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];
export const SERVICE_KIND_LABEL: Record<ServiceKind, string> = { water: 'WATER', sewer: 'SEWER', stormwater: 'STORMWATER', gas: 'GAS', electricity: 'ELECTRICITY', telecommunications: 'TELECOMMUNICATIONS', other: 'OTHER' };
/** Colours by service kind (a display convention, not a rule). */
export const SERVICE_COLOUR: Record<ServiceKind, string> = { water: '#1d6fe0', sewer: '#2f8f4a', stormwater: '#10a0a0', gas: '#d4b000', electricity: '#d12a2a', telecommunications: '#e07b00', other: '#777777' };
export const DEPTH_BASES = ['plan_indicated', 'potholed', 'surveyed', 'unknown'] as const;
export const DEPTH_BASIS_LABEL: Record<(typeof DEPTH_BASES)[number], string> = { plan_indicated: 'PLAN INDICATED', potholed: 'POTHOLED', surveyed: 'SURVEYED', unknown: 'UNKNOWN' };
export const DEPTH_REFERENCES = ['top', 'invert'] as const;
export const DEPTH_REFERENCE_LABEL: Record<(typeof DEPTH_REFERENCES)[number], string> = { top: 'TOP OF THE ASSET', invert: 'INVERT' };
export const NODE_KINDS = ['inspection_opening', 'inspection_pit', 'sewer_connection', 'water_connection', 'water_meter'] as const;
export const NODE_KIND_LABEL: Record<(typeof NODE_KINDS)[number], string> = { inspection_opening: 'INSPECTION OPENING', inspection_pit: 'INSPECTION PIT', sewer_connection: 'SEWER CONNECTION', water_connection: 'WATER CONNECTION', water_meter: 'WATER METER' };
export const PLAN_EXPIRED = 'PLAN EXPIRED', UNVERIFIED_LABEL = 'UNVERIFIED, INDICATIVE ONLY', UNRESOLVED_LABEL = 'UNRESOLVED';

// ---- stage 5 enumerations (the same lists are in backend/app/design/site_design.py; a value outside a list is refused) ------------
export const BUILDING_USES = ['house', 'granny_flat', 'unit', 'shed', 'other'] as const;
export const BUILDING_USE_LABEL: Record<(typeof BUILDING_USES)[number], string> = { house: 'HOUSE', granny_flat: 'GRANNY FLAT', unit: 'UNIT', shed: 'SHED', other: 'OTHER' };
export const BUILDING_SOURCES = ['plan_studio', 'pdf', 'dxf', 'footprint_entry'] as const;
export const ROOF_AREA_BASES = ['SOURCE VALUE', 'APPROXIMATE (PLAN STUDIO RASTER)', 'NOT SET'] as const;
export const SURFACE_KINDS = ['turf', 'garden_bed', 'mulch', 'gravel', 'permeable_paving', 'impervious_paving'] as const;
export const SURFACE_LABEL: Record<(typeof SURFACE_KINDS)[number], string> = { turf: 'TURF', garden_bed: 'GARDEN BED', mulch: 'MULCH', gravel: 'GRAVEL', permeable_paving: 'PERMEABLE PAVING', impervious_paving: 'IMPERVIOUS PAVING' };
export const FOOTPATH_SURFACES = ['concrete', 'pavers', 'gravel', 'permeable_pavers'] as const;
export const DRIVEWAY_SURFACES = ['concrete', 'asphalt', 'pavers', 'gravel', 'permeable_pavers'] as const;
// ---- stage 7 enumerations (the same lists are in the backend model)
export const RWT_SHAPES = ['round', 'slimline', 'underground'] as const;
export const WALL_TYPES = ['sleeper', 'block', 'concrete', 'other'] as const;
export const INFILTRATION_BASES = ['site_test', 'indicative'] as const;
export const OSD_FORMS = ['tank', 'basin', 'below_ground'] as const;
/** Text parameters limited to a list, by [object type, key]. */
export const PARAM_ENUMS: Record<string, readonly string[]> = {
  'rwt.shape': RWT_SHAPES, 'retaining_wall.wall_type': WALL_TYPES, 'infiltration_trench.infiltration_basis': INFILTRATION_BASES, 'osd.form': OSD_FORMS, 'osd_basin.form': OSD_FORMS,
  'building.building_use': BUILDING_USES, 'building.source': BUILDING_SOURCES, 'building.roof_area_basis': ROOF_AREA_BASES,
  'landscape_area.surface_kind': SURFACE_KINDS, 'footpath.surface_kind': FOOTPATH_SURFACES, 'driveway.surface_kind': DRIVEWAY_SURFACES,
  'service_existing.service_kind': SERVICE_KINDS, 'service_existing.depth_basis': DEPTH_BASES, 'service_existing.depth_reference': DEPTH_REFERENCES, 'service_node.node_kind': NODE_KINDS,
};
/** Parameters that must be numbers when they carry a value. */
export const PARAM_NUMBERS: Record<string, readonly string[]> = {
  building: ['ffl_rl', 'height_m', 'roof_plan_area_m2'], pool: ['depth_m', 'coping_width_m', 'water_level_rl'], footpath: ['width_m', 'crossfall_pct'], furniture: ['width_m', 'depth_m', 'height_m'],
  // stage 6. Batter slopes are H per V (a 1 in 3 batter is 3); a grade is a percentage; a fall direction is a grid bearing in degrees.
  driveway: ['width_m', 'end_level_rl', 'crossover_chainage_m', 'batter_cut_h_per_v', 'batter_fill_h_per_v'],
  grading_area: ['target_level_m', 'target_grade_pct', 'fall_direction_deg', 'pivot_level_m', 'batter_cut_h_per_v', 'batter_fill_h_per_v'],
  // stage 7. Levels (`_rl`) are RLs in metres and may be negative.
  rwt: ['capacity_l', 'diameter_m', 'length_m', 'width_m', 'height_m', 'base_rl', 'inlet_rl', 'overflow_rl', 'outlet_rl', 'connected_roof_area_m2', 'garden_area_m2', 'runoff_coefficient', 'first_flush_mm', 'occupants',
    'toilet_l_pp_day', 'laundry_l_pp_day', 'garden_l_m2_day', 'wet_day_fraction', 'water_target_pct', 'tank_height_m'],
  retaining_wall: ['height_m', 'thickness_m', 'surcharge_kpa', 'soil_friction_angle_deg', 'soil_unit_weight_kn_m3', 'wall_friction_ratio', 'gravity_wall_width_ratio', 'wall_unit_weight_kn_m3', 'min_fs_sliding', 'min_fs_overturning'],
  infiltration_trench: ['width_m', 'depth_m', 'void_ratio', 'infiltration_rate_mm_h'],
  osd: ['width_m', 'length_m', 'height_m', 'storage_volume_m3', 'orifice_diameter_mm', 'orifice_invert_rl', 'top_water_level_rl', 'discharge_coefficient', 'psd_l_s'],
  osd_basin: ['depth_m', 'storage_volume_m3', 'orifice_diameter_mm', 'orifice_invert_rl', 'top_water_level_rl', 'discharge_coefficient', 'psd_l_s'],
  stormwater_pit: ['width_m', 'length_m', 'invert_rl'], stormwater_pipe: ['diameter_mm', 'upstream_invert_rl', 'downstream_invert_rl'],
  pool_barrier: ['height_m'], tree: ['height_m', 'canopy_diameter_m', 'trunk_diameter_mm'],
  // stage 8. Depths are metres below ground at the service; levels are RLs.
  service_existing: ['diameter_mm', 'depth_m', 'position_tolerance_m'], sewer_drain: ['diameter_mm', 'upstream_invert_rl', 'downstream_invert_rl'], water_service: ['diameter_mm', 'cover_m'], service_node: ['invert_rl'],
};
/** The optional founding depth (m below ground) the user enters on the objects a sewer main's zone of influence is checked for. */
export const FOOTING_TYPES: readonly ObjectType[] = ['building', 'retaining_wall', 'rwt', 'osd', 'osd_basin', 'pool', 'tree'];
for (const t of FOOTING_TYPES) PARAM_NUMBERS[t] = Array.from(new Set([...(PARAM_NUMBERS[t] ?? []), 'footing_depth_m']));
/** Parameters that must be true or false when they carry a value. */
export const PARAM_BOOLS: Record<string, readonly string[]> = { rwt: ['reuse_toilet', 'reuse_laundry', 'reuse_garden'], footpath: ['impervious'] };
/** Parameters that must be an ISO date (YYYY-MM-DD) when they carry a value. */
export const PARAM_DATES: Record<string, readonly string[]> = { infiltration_trench: ['test_date'], service_existing: ['plan_date', 'plan_expiry_date'] };
/** Object links: [type, key] -> the object types the linked id must have. */
export const PARAM_LINKS: Record<string, readonly ObjectType[]> = {
  'rwt.roof_building_id': ['building'], 'overflow_route.osd_id': ['osd', 'osd_basin'], 'pool_barrier.pool_id': ['pool'],
  'service_node.main_id': ['service_existing'], 'sewer_drain.building_id': ['building'], 'water_service.main_id': ['service_existing'], 'water_service.rwt_id': ['rwt'],
};
/**
 * Object types whose parameters are stage 7 engineering inputs (the same list is in the backend model). On them a parameter may not have basis platform_default:
 * the only platform defaults are the requirement values of stormwater.osd_required and stormwater.psd_l_s, which the SERVER resolves. Two exceptions, as in the
 * backend: the OSD psd_l_s (the server verifies its value) and the Plan Studio size ESTIMATE the importer stamps on a tank diameter or height.
 */
export const STAGE7_TYPES: readonly ObjectType[] = ['rwt', 'retaining_wall', 'infiltration_trench', 'osd', 'osd_basin', 'stormwater_pit', 'stormwater_pipe', 'pool_barrier', 'overflow_route', 'tree', 'service_existing', 'sewer_drain', 'service_node', 'water_service'];
export const PS_ESTIMATE_REF = 'PLAN STUDIO ESTIMATE';
export function platformDefaultRefused(type: ObjectType, key: string, ref: string | undefined): boolean {
  if (!STAGE7_TYPES.includes(type) || (ref ?? '').startsWith(PS_ESTIMATE_REF)) return false;
  return !((type === 'osd' || type === 'osd_basin') && key === 'psd_l_s');
}
/**
 * (type, parameter) pairs that may carry basis plan_indicated (read from a DBYD plan: a plan's statement, not a measurement) and basis derived (computed by the server from a
 * requirement key given as the ref). The same lists are in the backend model, which refuses the basis anywhere else.
 */
export const PLAN_INDICATED_PARAMS: readonly string[] = ['service_kind', 'diameter_mm', 'material', 'depth_m', 'depth_basis', 'source_file'].map((k) => `service_existing.${k}`);
export const DERIVED_PARAMS: readonly string[] = ['sewer_drain.upstream_invert_rl', 'sewer_drain.downstream_invert_rl', 'service_node.invert_rl'];
/** The issue added when an edit voids a service's verification. Unlike the geometry issues it is not recomputed: it stays until the service is verified again. */
export const VERIFICATION_CLEARED_CODE = 'VERIFICATION_CLEARED_BY_EDIT';
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const WIDTH_NOT_SET = 'WIDTH NOT SET', END_LEVEL_NOT_SET = 'END LEVEL NOT SET', TARGET_NOT_SET = 'TARGET NOT SET';
/** Parameter keys the panel always lists for a type (shown NOT SET until a value is entered), besides the keys the object already has. */
export const PANEL_KEYS: Partial<Record<ObjectType, string[]>> = {
  driveway: ['width_m', 'end_level_rl', 'surface_kind', 'batter_cut_h_per_v', 'batter_fill_h_per_v'],
  grading_area: ['target_level_m', 'target_grade_pct', 'fall_direction_deg', 'pivot_level_m', 'batter_cut_h_per_v', 'batter_fill_h_per_v'],
  service_existing: ['service_kind', 'asset_owner', 'dbyd_job_number', 'plan_reference', 'plan_date', 'plan_expiry_date', 'source_file', 'diameter_mm', 'material', 'depth_m', 'depth_basis', 'depth_reference', 'position_tolerance_m', 'verified_by'],
  sewer_drain: ['diameter_mm', 'upstream_invert_rl', 'downstream_invert_rl'],
  water_service: ['diameter_mm', 'cover_m'],
  service_node: ['node_kind', 'invert_rl'],
};
export const FFL_NOT_SET = 'FFL NOT SET', HEIGHT_NOT_SET = 'HEIGHT NOT SET', NOT_SET = 'NOT SET';
export const POOL_BARRIER_LABEL = 'POOL BARRIER REQUIREMENTS: SEE RULES';
export const OBJECT_TYPES = Object.keys(OBJECT_KINDS) as ObjectType[];
export const STATUSES: Status[] = ['existing', 'proposed', 'to_be_removed'];
export const ORIGINS: Origin[] = ['user', 'ai_proposal', 'imported', 'dbyd'];
export const BASES: Basis[] = ['user', 'lga_rule', 'platform_default', 'unresolved', 'plan_indicated', 'derived'];
/** Bases the system sets and a person cannot choose by hand (set_param refuses them): a platform default, a value read from a DBYD plan, a value derived from a requirement. */
export const SYSTEM_BASES: readonly Basis[] = ['platform_default', 'plan_indicated', 'derived'];

export const BASIS_LABEL: Record<Basis, string> = { user: 'USER', lga_rule: 'LGA RULE', platform_default: 'PLATFORM DEFAULT', unresolved: 'UNRESOLVED', plan_indicated: 'PLAN INDICATED', derived: 'DERIVED' };
export const STATUS_LABEL: Record<Status, string> = { existing: 'EXISTING', proposed: 'PROPOSED', to_be_removed: 'TO BE REMOVED' };
export const ORIGIN_LABEL: Record<Origin, string> = { user: 'USER', ai_proposal: 'AI PROPOSAL', imported: 'IMPORTED', dbyd: 'DBYD' };
export const DIMENSIONS_NOT_SET = 'DIMENSIONS NOT SET';

export function emptyDesign(projectId?: string): SiteDesign {
  return { schema: SITE_DESIGN_SCHEMA, version: 0, ...(projectId ? { project_id: projectId } : {}), objects: [] };
}

/** A numeric dimension that is set: finite, above zero and not UNRESOLVED. Anything else is "not set". */
export function dimOf(o: SiteObject, key: string): number | null {
  const p = o.params[key];
  return p && p.basis !== 'unresolved' && typeof p.value === 'number' && Number.isFinite(p.value) && p.value > 0 ? p.value : null;
}
/** The shape of a rainwater tank when it is set, else null (a tank with no shape is a marker: its dimensions depend on the shape). */
export function rwtShape(o: SiteObject): (typeof RWT_SHAPES)[number] | null {
  const v = o.params.shape;
  return v && v.basis !== 'unresolved' && (RWT_SHAPES as readonly unknown[]).includes(v.value) ? (v.value as (typeof RWT_SHAPES)[number]) : null;
}
/** A text parameter that is set (non empty), else null. */
export function textOf(o: SiteObject, key: string): string | null {
  const p = o.params[key];
  return p && p.basis !== 'unresolved' && typeof p.value === 'string' && p.value.trim() !== '' ? p.value : null;
}
/** A true or false parameter that is set, else null. */
export function flagOf(o: SiteObject, key: string): boolean | null {
  const p = o.params[key];
  return p && p.basis !== 'unresolved' && typeof p.value === 'boolean' ? p.value : null;
}
/** Dimension parameters that apply to this object (a footpath drawn as an area has no width; a tank's depend on its shape). */
export function dimKeys(o: SiteObject): string[] {
  const k = OBJECT_KINDS[o.type];
  if (o.type === 'rwt') { const sh = rwtShape(o); return sh === 'slimline' || sh === 'underground' ? ['length_m', 'width_m', 'height_m'] : ['diameter_m', 'height_m']; }
  return k.alt && o.geometry.kind === k.alt ? [] : k.dims;
}
/**
 * The retained height of a wall at vertex `i`: the top RL minus the bottom RL when both are set (and the top is above the bottom), else the uniform
 * `height_m` when it is set, else null (NOT SET). Nothing is defaulted.
 */
export function wallHeightAt(o: SiteObject, i: number): number | null {
  const r = o.vertex_rls;
  if (r && r.top[i] != null && r.bottom[i] != null) { const h = (r.top[i] as number) - (r.bottom[i] as number); return h > 0 ? h : null; }
  return dimOf(o, 'height_m');
}
export function dimensionsSet(o: SiteObject): boolean {
  if (o.type === 'grading_area') return gradingTargetSet(o);
  if (o.type === 'driveway') return dimOf(o, 'width_m') !== null;
  const k = dimKeys(o);
  if (!(k.length === 0 || k.every((key) => dimOf(o, key) !== null))) return false;
  switch (o.type) {
    case 'rwt': return rwtShape(o) !== null;
    case 'osd': case 'osd_basin': return textOf(o, 'form') !== null;
    case 'pool': return levelOf(o, 'water_level_rl') !== null;
    case 'stormwater_pipe': case 'sewer_drain': return levelOf(o, 'upstream_invert_rl') !== null && levelOf(o, 'downstream_invert_rl') !== null;
    case 'retaining_wall': return o.geometry.kind === 'polyline' && o.geometry.pts.every((_, i) => wallHeightAt(o, i) !== null);
    default: return true;
  }
}
/** A grading area has a target when it has a level, or a grade together with its fall direction. Anything else is "not set". */
export function gradingTargetSet(o: SiteObject): boolean {
  return levelOf(o, 'target_level_m') !== null || (levelOf(o, 'target_grade_pct') !== null && levelOf(o, 'fall_direction_deg') !== null);
}
/** A numeric level (an RL may be zero or negative) that is set: finite and not UNRESOLVED. */
export function levelOf(o: SiteObject, key: string): number | null {
  const p = o.params[key];
  return p && p.basis !== 'unresolved' && typeof p.value === 'number' && Number.isFinite(p.value) ? p.value : null;
}

/** Vertex list of any geometry (a point is a one-vertex list). */
export function verticesOf(g: Geometry): Pos[] { return g.kind === 'point' ? [g.p] : g.kind === 'polyline' ? g.pts : g.ring; }
export const minVertices = (k: GeometryKind) => (k === 'point' ? 1 : k === 'polyline' ? 2 : 3);

/** Validate a loaded document enough to refuse a wrong one; nulls from the server are turned into absent optional fields. */
export function parseDesign(raw: unknown): SiteDesign {
  const j = raw as Partial<SiteDesign> | null;
  if (!j || typeof j !== 'object' || j.schema !== SITE_DESIGN_SCHEMA || !Array.isArray(j.objects)) throw new Error('Not a site_design.v1 document');
  const objects = j.objects.map((o): SiteObject => {
    const src = o as unknown as Record<string, unknown>;
    const type = canonicalType(src.type);
    if (typeof src.id !== 'string' || typeof type !== 'string' || !(type in OBJECT_KINDS) || !src.geometry) throw new Error('Invalid site design object');
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) if (v !== null && v !== undefined) out[k] = v;
    out.type = type;
    out.verified = !!src.verified; out.params = src.params ?? {}; out.issues = src.issues ?? [];
    out.status = src.status ?? 'proposed'; out.origin = src.origin ?? 'user';
    return out as unknown as SiteObject;
  });
  return { schema: SITE_DESIGN_SCHEMA, version: Number(j.version ?? 0), ...(j.project_id ? { project_id: j.project_id } : {}), ...(j.updated_at ? { updated_at: j.updated_at } : {}), objects };
}
