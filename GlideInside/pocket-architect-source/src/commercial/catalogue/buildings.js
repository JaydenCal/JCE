// The catalogue building model: project.commercial.buildings = [{ id, type, params, place: { x, y, rotationDeg } }] beside the strata rows.
// Pure: no DOM, no three. Everything else (materialise, stats, parking, checks, feasibility, plans, 3D) reads buildings through buildingsOf.

import { TYPES, typeById, STRATA_ID } from './types/index.js';
import { paramsOf } from './params.js';
import { frameOf, polyToWorld, toWorld, polyAreaM2, bboxOf } from './frame.js';

let seq = 0;
export const buildingId = () => `bld_${Date.now().toString(36)}${(seq++).toString(36)}`;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Structural clean up of a stored building list (safe on partial data). Params are completed and clamped at read time, see buildingsOf. */
export function cleanBuildings(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((b) => isObj(b) && typeof b.type === 'string').map((b) => ({
    id: b.id || buildingId(),
    type: b.type,
    params: isObj(b.params) ? { ...b.params } : {},
    place: { x: Number(b.place?.x) || 0, y: Number(b.place?.y) || 0, rotationDeg: Number(b.place?.rotationDeg) || 0 },
  }));
}

/** A short signature of what the automatic site layout depends on (the buildings and the strata rows). A layout whose signature differs is stale. */
export function layoutSig(c) {
  const r = (v) => Math.round(Number(v) || 0);
  return JSON.stringify([(c?.buildings || []).map((b) => [b.id, b.type, r(b.place?.x), r(b.place?.y), Math.round((Number(b.place?.rotationDeg) || 0) * 10), b.params]), (c?.rows || []).map((w) => [w.id, r(w.x), r(w.y), r(w.rotationDeg), w.count, w.mirrorOf || 0, w.unit?.widthMm, w.unit?.depthMm]), c?.parking?.bayW, c?.parking?.bayL, c?.parking?.aisleMm, c?.parking?.enabled]);
}

/** The automatic site layout (commercial.siteWorks) when it matches the buildings as they stand now, else null. Never a stale layout. */
export function siteWorksOf(c) {
  const sw = c?.siteWorks;
  return sw && sw.bsig === layoutSig(c) ? sw : null;
}

export const hasBuildings = (c) => Array.isArray(c?.buildings) && c.buildings.length > 0;

/** A new building record of a type with default params (or the given preset or params) at a place. */
export function newBuilding(typeId, { params = {}, place = {}, presetId = null } = {}) {
  const def = typeById(typeId);
  if (!def) throw new Error(`Unknown building type: ${typeId}`);
  const preset = presetId ? presetsOf(def).find((x) => x.id === presetId) : null;
  return { id: buildingId(), type: typeId, params: paramsOf(def, { ...(preset?.params || {}), ...params }), place: { x: Number(place.x) || 0, y: Number(place.y) || 0, rotationDeg: Number(place.rotationDeg) || 0 } };
}

/** The size presets of a type: its own list, or one "Standard" preset of the default params. */
export function presetsOf(def) {
  return Array.isArray(def.presets) && def.presets.length ? def.presets : [{ id: 'standard', label: 'Standard', params: {} }];
}

const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

/**
 * Every building of the project, resolved: { n, id, type, def, label, planLabel, params, place, outline (world), extras [{ kind, polygon (world), ... }],
 * q (quantities), site, groundM2, gfaM2, buildRateKey, bbox (world) }. Buildings of an unknown type are skipped.
 */
export function buildingsOf(c) {
  const out = [];
  let n = 0;
  for (const b of c?.buildings || []) {
    const def = typeById(b.type);
    if (!def) continue;
    const params = paramsOf(def, b.params);
    const place = { x: Number(b.place?.x) || 0, y: Number(b.place?.y) || 0, rotationDeg: Number(b.place?.rotationDeg) || 0 };
    const fp = safe(() => def.footprint(params), null);
    if (!fp?.outline?.length) continue;
    const outline = polyToWorld(place, fp.outline);
    const extras = (fp.extras || []).map((e) => ({ ...e, polygon: polyToWorld(place, e.polygon) }));
    const q = safe(() => def.quantities(params), {}) || {};
    const site = safe(() => def.site(params), {}) || {};
    n += 1;
    out.push({
      n, id: b.id, type: b.type, def, label: def.label, planLabel: def.planLabel || def.label.toUpperCase(), params, place, local: fp,
      outline, extras, q, site, groundM2: Number(q.groundM2) || polyAreaM2(outline), gfaM2: Number(q.gfaM2) || 0,
      buildRateKey: def.costHints?.buildRateKey || null, bbox: bboxOf([...outline, ...extras.flatMap((e) => e.polygon)]), frame: frameOf(place),
    });
  }
  return out;
}

/** Totals over all buildings: gfa, ground, upper and the GFA by use. */
export function buildingTotals(c) {
  const bs = buildingsOf(c);
  const perUse = {};
  let gfa = 0;
  let ground = 0;
  let upper = 0;
  for (const b of bs) {
    gfa += b.gfaM2;
    ground += b.groundM2;
    upper += Number(b.q.upperM2) || 0;
    for (const [k, v] of Object.entries(b.q.perUse || {})) perUse[k] = (perUse[k] || 0) + (Number(v) || 0);
  }
  return { count: bs.length, gfaM2: gfa, groundM2: ground, upperM2: upper, perUse, buildings: bs };
}

/** The building under a world point (its outline, or any extra such as a canopy), or null. */
export function buildingAt(c, p, pointInPolygon) {
  for (const b of buildingsOf(c)) if (pointInPolygon(p, b.outline)) return b;
  return null;
}

export { TYPES, typeById, STRATA_ID, toWorld };
