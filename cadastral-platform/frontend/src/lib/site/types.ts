/** `site_design.v1` (docs/14 section 5). Mirrors backend/app/design/site_design.py; tests/fixtures/site_design_v1.json is validated by both. */

export const SITE_DESIGN_SCHEMA = 'site_design.v1' as const;

export type ObjectType =
  | 'tree' | 'rwt' | 'pit' | 'osd'
  | 'retaining_wall' | 'infiltration_trench' | 'stormwater_pipe' | 'service_trace'
  | 'landscape_area' | 'grading_area' | 'osd_basin'
  | 'building' | 'pool' | 'footpath' | 'furniture';
export type GeometryKind = 'point' | 'polyline' | 'polygon';
export type Status = 'existing' | 'proposed' | 'to_be_removed';
export type Origin = 'user' | 'ai_proposal' | 'imported' | 'dbyd';
export type Accepted = 'pending' | 'accepted' | 'rejected';
export type Basis = 'user' | 'lga_rule' | 'platform_default' | 'unresolved';
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
}

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
  rwt: { geometry: 'point', label: 'RAINWATER TANK', dims: ['diameter_m', 'height_m'], colour: '#2d6cdf' },
  pit: { geometry: 'point', label: 'STORMWATER PIT', dims: ['width_m', 'length_m'], colour: '#4a4f55' },
  osd: { geometry: 'point', label: 'OSD TANK', dims: ['width_m', 'length_m', 'height_m'], colour: '#7a4fc4' },
  retaining_wall: { geometry: 'polyline', label: 'RETAINING WALL', dims: ['height_m', 'thickness_m'], colour: '#8c6a43' },
  infiltration_trench: { geometry: 'polyline', label: 'INFILTRATION TRENCH', dims: ['width_m'], colour: '#2a9d8f' },
  stormwater_pipe: { geometry: 'polyline', label: 'STORMWATER PIPE', dims: ['diameter_mm'], colour: '#1f5fd1' },
  service_trace: { geometry: 'polyline', label: 'SERVICE TRACE', dims: [], colour: '#d9822b' },
  landscape_area: { geometry: 'polygon', label: 'LANDSCAPE AREA', dims: [], colour: '#6aa84f' },
  grading_area: { geometry: 'polygon', label: 'GRADING AREA', dims: ['target_level_m'], colour: '#b8860b' },
  osd_basin: { geometry: 'polygon', label: 'OSD BASIN', dims: ['depth_m'], colour: '#5b6fd6' },
  // stage 5. A building is imported (never designed here): its footprint is its dimension, so it has no dimension parameters.
  building: { geometry: 'polygon', label: 'BUILDING', dims: [], colour: '#8d7b68' },
  pool: { geometry: 'polygon', label: 'POOL', dims: ['depth_m'], colour: '#29a3c7' },
  footpath: { geometry: 'polyline', alt: 'polygon', label: 'FOOTPATH', dims: ['width_m'], colour: '#b3a58f' },
  furniture: { geometry: 'point', label: 'OUTDOOR FURNITURE', dims: ['width_m', 'depth_m', 'height_m'], colour: '#a0642d' },
};

// ---- stage 5 enumerations (the same lists are in backend/app/design/site_design.py; a value outside a list is refused) ------------
export const BUILDING_USES = ['house', 'granny_flat', 'unit', 'shed', 'other'] as const;
export const BUILDING_USE_LABEL: Record<(typeof BUILDING_USES)[number], string> = { house: 'HOUSE', granny_flat: 'GRANNY FLAT', unit: 'UNIT', shed: 'SHED', other: 'OTHER' };
export const BUILDING_SOURCES = ['plan_studio', 'pdf', 'dxf', 'footprint_entry'] as const;
export const ROOF_AREA_BASES = ['SOURCE VALUE', 'APPROXIMATE (PLAN STUDIO RASTER)', 'NOT SET'] as const;
export const SURFACE_KINDS = ['turf', 'garden_bed', 'mulch', 'gravel', 'permeable_paving', 'impervious_paving'] as const;
export const SURFACE_LABEL: Record<(typeof SURFACE_KINDS)[number], string> = { turf: 'TURF', garden_bed: 'GARDEN BED', mulch: 'MULCH', gravel: 'GRAVEL', permeable_paving: 'PERMEABLE PAVING', impervious_paving: 'IMPERVIOUS PAVING' };
export const FOOTPATH_SURFACES = ['concrete', 'pavers', 'gravel', 'permeable_pavers'] as const;
/** Text parameters limited to a list, by [object type, key]. */
export const PARAM_ENUMS: Record<string, readonly string[]> = {
  'building.building_use': BUILDING_USES, 'building.source': BUILDING_SOURCES, 'building.roof_area_basis': ROOF_AREA_BASES,
  'landscape_area.surface_kind': SURFACE_KINDS, 'footpath.surface_kind': FOOTPATH_SURFACES,
};
/** Parameters that must be numbers when they carry a value. */
export const PARAM_NUMBERS: Record<string, readonly string[]> = {
  building: ['ffl_rl', 'height_m', 'roof_plan_area_m2'], pool: ['depth_m', 'coping_width_m'], footpath: ['width_m'], furniture: ['width_m', 'depth_m', 'height_m'],
};
export const FFL_NOT_SET = 'FFL NOT SET', HEIGHT_NOT_SET = 'HEIGHT NOT SET', NOT_SET = 'NOT SET';
export const POOL_BARRIER_LABEL = 'POOL BARRIER REQUIREMENTS: SEE RULES';
export const OBJECT_TYPES = Object.keys(OBJECT_KINDS) as ObjectType[];
export const STATUSES: Status[] = ['existing', 'proposed', 'to_be_removed'];
export const ORIGINS: Origin[] = ['user', 'ai_proposal', 'imported', 'dbyd'];
export const BASES: Basis[] = ['user', 'lga_rule', 'platform_default', 'unresolved'];

export const BASIS_LABEL: Record<Basis, string> = { user: 'USER', lga_rule: 'LGA RULE', platform_default: 'PLATFORM DEFAULT', unresolved: 'UNRESOLVED' };
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
/** Dimension parameters that apply to this object (a footpath drawn as an area has no width). */
export function dimKeys(o: SiteObject): string[] {
  const k = OBJECT_KINDS[o.type];
  return k.alt && o.geometry.kind === k.alt ? [] : k.dims;
}
export function dimensionsSet(o: SiteObject): boolean {
  const k = dimKeys(o);
  return k.length === 0 || k.every((key) => dimOf(o, key) !== null);
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
    if (typeof src.id !== 'string' || !(src.type as string in OBJECT_KINDS) || !src.geometry) throw new Error('Invalid site design object');
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) if (v !== null && v !== undefined) out[k] = v;
    out.verified = !!src.verified; out.params = src.params ?? {}; out.issues = src.issues ?? [];
    out.status = src.status ?? 'proposed'; out.origin = src.origin ?? 'user';
    return out as unknown as SiteObject;
  });
  return { schema: SITE_DESIGN_SCHEMA, version: Number(j.version ?? 0), ...(j.project_id ? { project_id: j.project_id } : {}), ...(j.updated_at ? { updated_at: j.updated_at } : {}), objects };
}
