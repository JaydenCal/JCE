/**
 * Stage 7: the parameters, computed values and wording of the site objects (rainwater tank, retaining wall, infiltration trench, OSD, stormwater pit and
 * pipe, pool, pool barrier, footpath, tree, landscape area, overflow route).
 *
 * NOTHING is defaulted here. A field is an input the user may enter (basis USER); an engineering limit is NEVER a field: it comes from a requirement key and is
 * shown by the Checks list from the server answer. A computed value is shown only when everything it needs is set (the calculation is shown with it).
 */
import { polygonArea, polylineLength } from './geom';
import { serviceLabelLines } from './services';
import { FOOTING_TYPES, dimOf, flagOf, levelOf, rwtShape, textOf, wallHeightAt, type ObjectType, type Pos, type SiteObject } from './types';

export type FieldKind = 'number' | 'enum' | 'bool' | 'date' | 'text' | 'link';
export interface FieldSpec {
  key: string; label: string; kind: FieldKind; unit?: string; help?: string;
  /** sub heading in the panel: dimensions, levels, sizing inputs, ... */
  group?: string;
}
const N = (key: string, label: string, unit: string, group?: string, help?: string): FieldSpec => ({ key, label, kind: 'number', unit, group, help });
const E = (key: string, label: string, group?: string, help?: string): FieldSpec => ({ key, label, kind: 'enum', group, help });
const T = (key: string, label: string, group?: string, help?: string): FieldSpec => ({ key, label, kind: 'text', group, help });
const D = (key: string, label: string, group?: string, help?: string): FieldSpec => ({ key, label, kind: 'date', group, help });
const B = (key: string, label: string, group?: string, help?: string): FieldSpec => ({ key, label, kind: 'bool', group, help });

const SIZING_INPUTS: FieldSpec[] = [
  N('runoff_coefficient', 'Roof runoff coefficient', '', 'Sizing inputs (optional)', 'Used only by the optional Size this tank action. Left empty, the action lists it as UNRESOLVED.'),
  N('first_flush_mm', 'First flush diverted', 'mm', 'Sizing inputs (optional)'),
  N('occupants', 'Occupants', 'people', 'Sizing inputs (optional)'),
  N('toilet_l_pp_day', 'Toilet use', 'L/person/day', 'Sizing inputs (optional)'),
  N('laundry_l_pp_day', 'Laundry use', 'L/person/day', 'Sizing inputs (optional)'),
  N('garden_area_m2', 'Garden area watered', 'm2', 'Sizing inputs (optional)'),
  N('garden_l_m2_day', 'Garden use', 'L/m2/day', 'Sizing inputs (optional)'),
  N('wet_day_fraction', 'Wet day fraction', '', 'Sizing inputs (optional)'),
  N('water_target_pct', 'Water saving target', '%', 'Sizing inputs (optional)'),
  N('tank_height_m', 'Tank height for the diameter', 'm', 'Sizing inputs (optional)'),
];

/** The fields the panel always lists for an object, in order (shown NOT SET until a value is entered). Parameters the object already has are listed after these. */
export function fieldsFor(o: SiteObject): FieldSpec[] {
  const base = fieldsForType(o);
  return (FOOTING_TYPES as readonly string[]).includes(o.type) ? [...base, N('footing_depth_m', 'Footing depth (optional)', 'm', 'Foundation', 'Metres below ground. Used only by the sewer zone of influence check. Left empty, that check is NOT EVALUATED.')] : base;
}
function fieldsForType(o: SiteObject): FieldSpec[] {
  switch (o.type) {
    case 'rwt': {
      const sh = rwtShape(o);
      const dims = sh === 'slimline' || sh === 'underground' ? [N('length_m', 'Length', 'm', 'Dimensions'), N('width_m', 'Width', 'm', 'Dimensions'), N('height_m', 'Height', 'm', 'Dimensions')]
        : [N('diameter_m', 'Diameter', 'm', 'Dimensions'), N('height_m', 'Height', 'm', 'Dimensions')];
      return [E('shape', 'Shape', 'Dimensions'), ...dims, N('capacity_l', 'Volume', 'L', 'Dimensions'),
        N('base_rl', 'Tank base level', 'm RL', 'Levels', 'Used with the height to check the inlet, overflow and outlet levels are inside the tank body.'), N('inlet_rl', 'Inlet level', 'm RL', 'Levels'), N('overflow_rl', 'Overflow level', 'm RL', 'Levels'), N('outlet_rl', 'Outlet level', 'm RL', 'Levels'),
        { key: 'roof_building_id', label: 'Linked building (roof)', kind: 'link', group: 'Roof and reuse' }, N('connected_roof_area_m2', 'Connected roof area', 'm2', 'Roof and reuse'),
        B('reuse_toilet', 'Supplies toilets', 'Roof and reuse'), B('reuse_laundry', 'Supplies laundry', 'Roof and reuse'), B('reuse_garden', 'Supplies garden', 'Roof and reuse'), ...SIZING_INPUTS];
    }
    case 'retaining_wall':
      return [E('wall_type', 'Wall type', 'Wall'), N('height_m', 'Uniform height (when no vertex levels)', 'm', 'Wall'), N('thickness_m', 'Thickness', 'm', 'Wall'),
        { key: 'surcharge_description', label: 'Surcharge description', kind: 'text', group: 'Wall' },
        N('surcharge_kpa', 'Surcharge load', 'kPa', 'Screening assumptions (optional)', 'Each assumption left empty is read from its requirement key; if that is UNRESOLVED the screening is NOT EVALUATED.'),
        N('soil_friction_angle_deg', 'Soil friction angle', 'deg', 'Screening assumptions (optional)'), N('soil_unit_weight_kn_m3', 'Soil unit weight', 'kN/m3', 'Screening assumptions (optional)'),
        N('wall_friction_ratio', 'Wall friction ratio', '', 'Screening assumptions (optional)'), N('gravity_wall_width_ratio', 'Base width ratio', '', 'Screening assumptions (optional)'),
        N('wall_unit_weight_kn_m3', 'Wall unit weight', 'kN/m3', 'Screening assumptions (optional)'), N('min_fs_sliding', 'Minimum FS sliding', '', 'Screening assumptions (optional)'),
        N('min_fs_overturning', 'Minimum FS overturning', '', 'Screening assumptions (optional)')];
    case 'infiltration_trench':
      return [N('width_m', 'Width', 'm', 'Trench'), N('depth_m', 'Depth', 'm', 'Trench'), N('void_ratio', 'Media void ratio', '', 'Trench', 'Pore volume as a fraction of the media volume, above 0 and at most 1.'),
        N('infiltration_rate_mm_h', 'Design infiltration rate', 'mm/h', 'Infiltration'), E('infiltration_basis', 'Basis of the rate', 'Infiltration'),
        { key: 'test_date', label: 'Site test date', kind: 'date', group: 'Infiltration', help: 'Required when the basis is a site test. Enter YYYY-MM-DD.' }];
    case 'osd':
      return [E('form', 'Form', 'Storage'), N('width_m', 'Width', 'm', 'Storage'), N('length_m', 'Length', 'm', 'Storage'), N('height_m', 'Height', 'm', 'Storage'), N('storage_volume_m3', 'Storage volume', 'm3', 'Storage'),
        N('orifice_diameter_mm', 'Outlet orifice diameter', 'mm', 'Outlet'), N('orifice_invert_rl', 'Orifice invert', 'm RL', 'Outlet'), N('top_water_level_rl', 'Top water level', 'm RL', 'Outlet'),
        N('discharge_coefficient', 'Discharge coefficient Cd (optional)', '', 'Outlet', 'Entered only when you have a value. Otherwise it comes from stormwater.orifice_discharge_coefficient, and the orifice equation is not shown while that is UNRESOLVED.'),
        N('psd_l_s', 'Permissible site discharge (optional)', 'L/s', 'Outlet', 'Entered only to override the rule. Otherwise the LGA rule or the stamped platform default is used.')];
    case 'osd_basin':
      return [E('form', 'Form', 'Storage'), N('depth_m', 'Depth', 'm', 'Storage'), N('storage_volume_m3', 'Storage volume', 'm3', 'Storage'),
        N('orifice_diameter_mm', 'Outlet orifice diameter', 'mm', 'Outlet'), N('orifice_invert_rl', 'Orifice invert', 'm RL', 'Outlet'), N('top_water_level_rl', 'Top water level', 'm RL', 'Outlet'),
        N('discharge_coefficient', 'Discharge coefficient Cd (optional)', '', 'Outlet'), N('psd_l_s', 'Permissible site discharge (optional)', 'L/s', 'Outlet')];
    case 'overflow_route':
      return [{ key: 'osd_id', label: 'Linked OSD', kind: 'link', group: 'Route' }];
    case 'stormwater_pit':
      return [N('width_m', 'Width', 'm', 'Pit'), N('length_m', 'Length', 'm', 'Pit'), N('invert_rl', 'Invert level', 'm RL', 'Pit')];
    case 'stormwater_pipe':
      return [N('diameter_mm', 'Diameter', 'mm', 'Pipe'), { key: 'material', label: 'Material', kind: 'text', group: 'Pipe' },
        N('upstream_invert_rl', 'Upstream invert', 'm RL', 'Pipe'), N('downstream_invert_rl', 'Downstream invert', 'm RL', 'Pipe')];
    case 'pool':
      return [N('depth_m', 'Water depth', 'm', 'Pool'), N('coping_width_m', 'Coping width', 'm', 'Pool'), N('water_level_rl', 'Water level', 'm RL', 'Pool')];
    case 'pool_barrier':
      return [N('height_m', 'Barrier height', 'm', 'Barrier'), { key: 'pool_id', label: 'Linked pool', kind: 'link', group: 'Barrier' }];
    case 'footpath':
      return [...(o.geometry.kind === 'polyline' ? [N('width_m', 'Width', 'm', 'Footpath')] : []), E('surface_kind', 'Surface', 'Footpath'),
        B('impervious', 'Impervious surface', 'Footpath', 'Choose impervious or permeable. It is not guessed from the surface.'),
        N('crossfall_pct', 'Crossfall', '%', 'Footpath', 'Entered value. The limits are rules and are shown in the Checks list.')];
    case 'tree':
      return [N('height_m', 'Height', 'm', 'Tree'), N('canopy_diameter_m', 'Canopy diameter', 'm', 'Tree'), N('trunk_diameter_mm', 'Trunk diameter (DBH)', 'mm', 'Tree', 'Used for the protection zones of an existing tree. The multipliers are requirement keys.')];
    case 'landscape_area':
      return [E('surface_kind', 'Surface', 'Surface')];
    case 'service_existing':
      return [E('service_kind', 'Service kind', 'Service'), T('asset_owner', 'Asset owner', 'Service', 'The owner decides which clearance rules apply. Enter it exactly as the plan gives it.'),
        N('diameter_mm', 'Diameter', 'mm', 'Service'), T('material', 'Material', 'Service'),
        N('depth_m', 'Depth', 'm', 'Depth', 'Metres below ground. Enter only a depth the plan, a pothole or a survey gives. Left empty it is DATA NOT AVAILABLE and the vertical checks are NOT EVALUATED.'),
        E('depth_basis', 'Depth basis', 'Depth'), E('depth_reference', 'Depth is to', 'Depth', 'The top of the asset or its invert. The two differ by the diameter.'),
        N('position_tolerance_m', 'Positional tolerance', 'm', 'Depth', 'The plus or minus the plan or survey states. Left empty, the clearance checks cannot claim a PASS.'),
        T('dbyd_job_number', 'DBYD job number', 'Plan'), T('plan_reference', 'Plan reference', 'Plan'),
        D('plan_date', 'Plan date', 'Plan'), D('plan_expiry_date', 'Plan expiry date', 'Plan', 'Enter the date the plan states. It is never worked out here.'), T('source_file', 'Source file', 'Plan'),
        T('verified_by', 'Verified by', 'Verification', 'Who verified this service (needed to mark it verified).')];
    case 'sewer_drain':
      return [N('diameter_mm', 'Diameter', 'mm', 'Drain'), N('upstream_invert_rl', 'Upstream invert', 'm RL', 'Drain'), N('downstream_invert_rl', 'Downstream invert', 'm RL', 'Drain'),
        { key: 'building_id', label: 'Linked building', kind: 'link', group: 'Drain' }];
    case 'water_service':
      return [N('diameter_mm', 'Diameter', 'mm', 'Service'), N('cover_m', 'Cover (entered)', 'm', 'Service', 'An entered cover. The minimum cover is a requirement key, shown in the Checks list.'),
        { key: 'main_id', label: 'Linked main', kind: 'link', group: 'Service' }, { key: 'rwt_id', label: 'Linked rainwater tank', kind: 'link', group: 'Service' }];
    case 'service_node':
      return [E('node_kind', 'Node kind', 'Node'), N('invert_rl', 'Invert level', 'm RL', 'Node'), { key: 'main_id', label: 'Linked main', kind: 'link', group: 'Node' }];
    default:
      return [];
  }
}

// ---- computed values -----------------------------------------------------------------------------------------------------------------
export interface Computed {
  key: string; label: string; value: string; /** the calculation, with the numbers */ calc?: string;
  /** the number behind `value` (parity with the server values, tests/fixtures/stage7_parity.json) */ amount?: number;
  /** FAIL when the computed value is itself a failed check (the server reports the same FAIL) */ status?: 'FAIL';
}
const f = (v: number, d = 2) => v.toFixed(d);
const planLength = (pts: readonly Pos[]) => polylineLength(pts);

/** Storage volume of an infiltration trench, V = L x W x D x n, with the calculation. Null while any input is NOT SET (void ratio must be above 0 and at most 1). */
export function trenchStorage(o: SiteObject): { m3: number; length: number; calc: string } | null {
  if (o.type !== 'infiltration_trench' || o.geometry.kind !== 'polyline') return null;
  const L = planLength(o.geometry.pts), W = dimOf(o, 'width_m'), D = dimOf(o, 'depth_m'), n = dimOf(o, 'void_ratio');
  if (!(L > 0) || W === null || D === null || n === null || n > 1) return null;
  const v = L * W * D * n;
  return { m3: v, length: L, calc: `V = L x W x D x n = ${f(L)} x ${f(W)} x ${f(D)} x ${f(n)} = ${f(v, 3)} m3` };
}
/** Volume of the tank body from its dimensions (litres), with the calculation. Null while the shape or a dimension is NOT SET. */
export function tankGeometricVolume(o: SiteObject): { litres: number; calc: string } | null {
  if (o.type !== 'rwt') return null;
  const sh = rwtShape(o);
  if (sh === 'round') {
    const d = dimOf(o, 'diameter_m'), h = dimOf(o, 'height_m'); if (d === null || h === null) return null;
    const v = Math.PI * d * d / 4 * h * 1000; return { litres: v, calc: `V = pi x D^2 / 4 x H = pi x ${f(d)}^2 / 4 x ${f(h)} = ${f(v, 0)} L` };
  }
  if (sh === 'slimline' || sh === 'underground') {
    const l = dimOf(o, 'length_m'), w = dimOf(o, 'width_m'), h = dimOf(o, 'height_m'); if (l === null || w === null || h === null) return null;
    const v = l * w * h * 1000; return { litres: v, calc: `V = L x W x H = ${f(l)} x ${f(w)} x ${f(h)} = ${f(v, 0)} L` };
  }
  return null;
}
/** Grade of a pipe, computed from the inverts and the plan length: (upstream - downstream) / length. Null while an invert is NOT SET. */
export function pipeGrade(o: SiteObject): { pct: number; length: number; calc: string } | null {
  if (o.type !== 'stormwater_pipe' || o.geometry.kind !== 'polyline') return null;
  const up = levelOf(o, 'upstream_invert_rl'), dn = levelOf(o, 'downstream_invert_rl'), L = planLength(o.geometry.pts);
  if (up === null || dn === null || !(L > 0)) return null;
  const g = (up - dn) / L * 100;
  return { pct: g, length: L, calc: `grade = (${f(up, 3)} - ${f(dn, 3)}) / ${f(L)} x 100 = ${f(g)} %` };
}
/** Smallest cover to the pipe crown (terrain level minus invert minus diameter) at stations every `step` metres, ends and vertices. Null while an input is NOT SET or no terrain reaches. */
export function pipeCover(o: SiteObject, sample: (e: number, n: number) => number | null, step = 1): { min: number; missing: number; calc: string } | null {
  if (o.type !== 'stormwater_pipe' || o.geometry.kind !== 'polyline') return null;
  const up = levelOf(o, 'upstream_invert_rl'), dn = levelOf(o, 'downstream_invert_rl'), d = dimOf(o, 'diameter_mm');
  if (up === null || dn === null || d === null) return null;
  const pts = o.geometry.pts, cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1]; if (!(L > 0)) return null;
  const ts = new Set<number>([0, L, ...cum]); for (let t = step; t < L; t += step) ts.add(t);
  let min = Infinity, at = 0, missing = 0;
  for (const t of [...ts].sort((a, b) => a - b)) {
    let i = 1; while (i < cum.length - 1 && cum[i] < t) i++;
    const a = pts[i - 1], b = pts[i], u = (t - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1), x = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * u;
    const z = sample(x, y); if (z === null) { missing++; continue; }
    const c = z - (up + (dn - up) * t / L + d / 1000); if (c < min) { min = c; at = t; }
  }
  return Number.isFinite(min) ? { min, missing, calc: `cover = terrain - invert - diameter, least ${f(min)} m at chainage ${f(at, 1)} m (to the crown, nominal diameter)` } : null;
}
export function polygonAreaOf(o: SiteObject): number | null {
  return o.geometry.kind === 'polygon' && o.geometry.ring.length >= 3 ? polygonArea(o.geometry.ring) : null;
}

/** Everything the panel can compute for an object without a rule, with the calculation. */
export function computedFor(o: SiteObject, sample: ((e: number, n: number) => number | null) | null = null): Computed[] {
  const out: Computed[] = [];
  const area = polygonAreaOf(o);
  if (area !== null) out.push({ key: 'area_m2', label: 'AREA', value: `${f(area)} m2` });
  if (o.geometry.kind === 'polyline') out.push({ key: 'length_m', label: 'LENGTH (PLAN)', value: `${f(planLength(o.geometry.pts))} m` });
  switch (o.type) {
    case 'infiltration_trench': { const t = trenchStorage(o); out.push(t ? { key: 'storage_volume_m3', label: 'STORAGE VOLUME', value: `${f(t.m3, 3)} m3`, calc: t.calc, amount: t.m3 } : { key: 'storage_volume_m3', label: 'STORAGE VOLUME', value: 'NOT SET', calc: 'Needs the width, depth and void ratio.' }); break; }
    case 'rwt': { const v = tankGeometricVolume(o); if (v) out.push({ key: 'geometric_volume_l', label: 'VOLUME FROM THE DIMENSIONS', value: `${f(v.litres, 0)} L`, calc: v.calc, amount: v.litres }); break; }
    case 'stormwater_pipe': {
      const g = pipeGrade(o); out.push(g ? { key: 'grade_pct', label: 'GRADE', value: `${f(g.pct)} %`, calc: g.calc, amount: g.pct } : { key: 'grade_pct', label: 'GRADE', value: 'NOT SET', calc: 'Needs both inverts.' });
      if (sample) { const c = pipeCover(o, sample); if (c) out.push({ key: 'min_cover_m', label: 'LEAST COVER', value: `${f(c.min)} m`, calc: c.calc + (c.missing ? `. ${c.missing} station(s) have no terrain.` : ''), amount: c.min }); }
      break;
    }
    case 'stormwater_pit': {
      const inv = levelOf(o, 'invert_rl'), p = o.geometry.kind === 'point' ? o.geometry.p : null, z = p && sample ? sample(p[0], p[1]) : null;
      if (z !== null) {
        out.push({ key: 'surface_rl', label: 'SURFACE LEVEL (TERRAIN)', value: `${f(z, 3)} m RL`, amount: z });
        // the same rule as the server: an invert that is not below the surface is a FAIL, not a depth
        if (inv !== null) out.push(z - inv > 0 ? { key: 'depth_m', label: 'DEPTH TO INVERT', value: `${f(z - inv, 3)} m`, calc: `depth = ${f(z, 3)} - ${f(inv, 3)}`, amount: z - inv }
          : { key: 'depth_m', label: 'DEPTH TO INVERT', value: 'FAIL', status: 'FAIL', calc: `THE INVERT ${f(inv, 3)} RL IS NOT BELOW THE SURFACE ${f(z, 3)} RL` });
      }
      break;
    }
    case 'retaining_wall': {
      const n = o.geometry.kind === 'polyline' ? o.geometry.pts.length : 0, hs = Array.from({ length: n }, (_, i) => wallHeightAt(o, i));
      const set = hs.filter((h): h is number => h !== null);
      out.push({ key: 'max_height_m', label: 'GREATEST RETAINED HEIGHT', value: set.length ? `${f(Math.max(...set))} m` : 'NOT SET', calc: set.length < n ? `${n - set.length} of ${n} vertices have no height.` : undefined });
      break;
    }
    case 'osd': {
      const w = dimOf(o, 'width_m'), l = dimOf(o, 'length_m'), h = dimOf(o, 'height_m');
      if (w !== null && l !== null && h !== null) out.push({ key: 'box_volume_m3', label: 'VOLUME FROM THE DIMENSIONS', value: `${f(w * l * h, 3)} m3`, calc: `V = W x L x H = ${f(w)} x ${f(l)} x ${f(h)}` });
      break;
    }
    default: break;
  }
  return out;
}

// ---- wording shared by the 3D labels and the panel ------------------------------------------------------------------------------------
export const SCREENING_LABEL = 'SCREENING ONLY, NOT STRUCTURAL DESIGN';
export const TPZ_LABEL = 'TREE PROTECTION ZONE', SRZ_LABEL = 'STRUCTURAL ROOT ZONE';
export const TREE_STATUS_LABEL: Record<string, string> = { existing: 'EXISTING', proposed: 'PROPOSED', to_be_removed: 'REMOVE' };

/** Extra 3D label lines for the stage 7 types (upper case). The caller adds DIMENSIONS NOT SET. */
export function extraLabelLines(o: SiteObject): string[] {
  const L: string[] = [], t = o.type as ObjectType;
  const lv = (key: string, name: string) => { const v = levelOf(o, key); if (v !== null) L.push(`${name} ${f(v)} RL`); };
  if (t === 'rwt') {
    const sh = rwtShape(o); if (sh) L.push(sh.toUpperCase());
    const cap = dimOf(o, 'capacity_l'); if (cap !== null) L.push(`${f(cap, 0)} L`);
    lv('inlet_rl', 'INLET'); lv('overflow_rl', 'OVERFLOW'); lv('outlet_rl', 'OUTLET');
  } else if (t === 'retaining_wall') {
    L.push(SCREENING_LABEL); const w = textOf(o, 'wall_type'); if (w) L.push(`${w.toUpperCase()} WALL`);
  } else if (t === 'infiltration_trench') {
    const tr = trenchStorage(o); if (tr) L.push(`STORAGE ${f(tr.m3, 2)} M3`);
  } else if (t === 'osd' || t === 'osd_basin') {
    const fm = textOf(o, 'form'); if (fm) L.push(fm.replace(/_/g, ' ').toUpperCase());
    const v = dimOf(o, 'storage_volume_m3'); if (v !== null) L.push(`${f(v, 1)} M3`);
    lv('top_water_level_rl', 'TWL');
  } else if (t === 'stormwater_pit') {
    lv('invert_rl', 'INVERT');
  } else if (t === 'stormwater_pipe') {
    const d = dimOf(o, 'diameter_mm'); if (d !== null) L.push(`DIA ${f(d, 0)} MM`);
    const g = pipeGrade(o); if (g) L.push(`GRADE ${f(g.pct)} %`);
  } else if (t === 'pool') {
    lv('water_level_rl', 'WATER LEVEL');
  } else if (t === 'pool_barrier') {
    const h = dimOf(o, 'height_m'); if (h !== null) L.push(`HEIGHT ${f(h)} M`);
  } else if (t === 'tree') {
    L.push(TREE_STATUS_LABEL[o.status] ?? o.status.toUpperCase());
  } else if (t === 'footpath') {
    const im = flagOf(o, 'impervious'); L.push(im === null ? 'IMPERVIOUS OR PERMEABLE NOT SET' : im ? 'IMPERVIOUS' : 'PERMEABLE');
  } else if (t === 'landscape_area') {
    const a = polygonAreaOf(o); if (a !== null) L.push(`AREA ${f(a, 1)} M2`);
  } else if (t === 'service_existing' || t === 'sewer_drain' || t === 'service_node' || t === 'water_service') {
    L.push(...serviceLabelLines(o));
  }
  return L;
}
