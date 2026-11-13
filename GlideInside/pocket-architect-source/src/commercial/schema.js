// project.commercial: the parametric spec, the source of truth for commercial mode. Additive: SCHEMA_VERSION stays 2 and a project
// without project.mode is a normal housing project. Lengths in millimetres, angles in degrees, plan y down.

import { DEFAULT_PARKING_RATE } from './rules.js';

export const COMMERCIAL_VERSION = 1;

/** Roller door presets, width x height in mm. 'custom' uses the typed size. */
export const DOOR_PRESETS = Object.freeze([
  { id: '3.0x3.5', w: 3000, h: 3500 },
  { id: '3.6x4.0', w: 3600, h: 4000 },
  { id: '4.0x4.5', w: 4000, h: 4500 },
  { id: '4.5x5.0', w: 4500, h: 5000 },
]);
export const FRONT_WINDOWS = Object.freeze(['none', 'highlight', 'office', 'shopfront']);
export const REAR_WINDOWS = Object.freeze(['none', 'highlight', 'office']);
export const STAIR_TYPES = Object.freeze(['straight', 'L']);

export const PERSONNEL_DOOR = Object.freeze({ widthMm: 920, heightMm: 2040 });
export const SLAB_MM = 150;
export const MIN_CLEAR_MM = 2400;

export const defaultUnit = () => ({
  widthMm: 6000,
  depthMm: 18000,
  heightMm: 6000,
  doors: { count: 1, presetId: '3.6x4.0', widthMm: 3600, heightMm: 4000, offsetMm: 0, motorised: true, rear: false, personnel: true },
  windows: { front: 'none', rear: 'none', widthMm: 1800, heightMm: 1200, sillMm: 900, side: false },
  office: { enabled: false, depthMm: 3000, accessibleWc: false },
  mezzanine: { enabled: false, mode: 'depth', depthMm: 6000, percent: 40, position: 'rear', stairType: 'straight', stairSide: 'left', balustrade: true, levelMm: 3000, slabMm: SLAB_MM, minClearMm: MIN_CLEAR_MM },
  roof: 'skillion',
  cladding: 'metal',
});

export const defaultCommercial = (useClass = 'industrial') => ({
  v: COMMERCIAL_VERSION,
  useClass,
  zoneClass: null, // the person's choice (needed for Queensland lots); null follows the looked up zone
  rows: [],
  parking: { enabled: true, bayW: 2400, bayL: 5400, aisleMm: 8000, accessibleOverride: null },
  bollards: { enabled: true, downpipeEvery: 4 },
  waste: null, // { x, y, widthMm, depthMm, rotationDeg }
  hydrant: null, // { x, y }
  rates: { parkingPerM2Gfa: DEFAULT_PARKING_RATE, source: 'Indicative default of 1 space per 100 m2 of GFA, check with council' },
});

let n = 0;
export const rowId = () => `row_${Date.now().toString(36)}${(n++).toString(36)}`;

export const defaultRow = (over = {}) => ({ id: over.id || rowId(), x: 0, y: 0, rotationDeg: 0, count: 6, mirrorOf: null, unit: defaultUnit(), perUnit: {}, ...over });

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
/** Deep merge of plain objects; arrays and scalars in `over` replace. */
export function deepMerge(base, over) {
  if (!isObj(base)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}

/** The spec of unit `i` (0 based) of a row: the row's unit settings with the per unit overrides on top. */
export function unitSpec(row, i) {
  return deepMerge(row.unit || defaultUnit(), (row.perUnit || {})[i] || {});
}

/** The roller door size in use for a doors block. */
export function doorSize(doors) {
  const p = DOOR_PRESETS.find((x) => x.id === doors.presetId);
  return p ? { w: p.w, h: p.h } : { w: Number(doors.widthMm) || 3600, h: Number(doors.heightMm) || 4000 };
}

const num = (v, lo, hi, fallback) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : fallback);

/** Fill defaults and clamp a stored spec. Safe on partial or older data. */
export function normaliseCommercial(c) {
  const base = defaultCommercial(c?.useClass);
  const out = deepMerge(base, c || {});
  out.v = COMMERCIAL_VERSION;
  out.rows = (Array.isArray(c?.rows) ? c.rows : []).map((r) => {
    const row = { ...defaultRow({ id: r.id || rowId() }), ...r };
    row.unit = deepMerge(defaultUnit(), r.unit || {});
    row.perUnit = isObj(r.perUnit) ? r.perUnit : {};
    row.count = Math.round(num(row.count, 1, 40, 4));
    row.x = Number(row.x) || 0;
    row.y = Number(row.y) || 0;
    row.rotationDeg = Number(row.rotationDeg) || 0;
    row.mirrorOf = row.mirrorOf || null;
    const u = row.unit;
    u.widthMm = num(u.widthMm, 2500, 30000, 6000);
    u.depthMm = num(u.depthMm, 4000, 80000, 18000);
    u.heightMm = num(u.heightMm, 3000, 15000, 6000);
    return row;
  });
  return out;
}

export const isCommercial = (project) => project?.mode === 'commercial' && !!project.commercial;
