// One levels model for the plan sheets: ground (natural) and finished (design) surface levels, the floor level of each building, and the
// assumed datum used when the lot has no ground data. Levels are indicative, from the state 5 m DEM, never survey. Pure, Node compatible.
//
//   const tm = await loadTerrainModel(project);          // optional: the 3D terrain model, so sheets and 3D can never disagree
//   const levels = levelsModel(project, lot, { tm });
//   levels.natural({ x, y }) -> RL m | null,  levels.design({ x, y }) -> RL m | null,  levels.fflOf(polygonOrKey) -> RL m

import * as G from '../../../model/geometry.js';
import { buildingHull } from '../../../site/lotplan.js';
import { buildingsOf } from '../../../commercial/catalogue/buildings.js';
import { hasGround, groundLevelFn } from './contours.js';

/** The datum a sheet states when the lot has no ground data. */
export const ASSUMED_RL = 100;
/** Floor level above the design surface (the slab), as the 3D pad: terrainModel padY = base - 0.15. */
export const SLAB_M = 0.15;

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const r2 = (v) => Math.round(v * 100) / 100;

/** The 3D terrain model for the project (or null), loaded on demand so the synchronous sheet code never imports the 3D builder. */
export async function loadTerrainModel(project) {
  if (!project?.site?.lot?.terrain) return null;
  try {
    const mod = await import('../../../viewer3d/terrain.js');
    return mod.terrainModel(project);
  } catch {
    return null;
  }
}

/** "103.25" or "100.00". */
export const rlText = (rl, decimals = 2) => (fin(rl) ? Number(rl).toFixed(decimals) : '');

/** The tag text for a finished floor level: "FFL 103.25", or "FFL 100.00 (ASSUMED DATUM)" when the lot has no ground data. */
export function fflText(levels, rl) {
  return levels?.has || levels?.floorSet ? `FFL ${rlText(rl)}` : `FFL ${rlText(rl)} (ASSUMED DATUM)`;
}

/**
 * @returns {{ has: boolean, source: 'dem'|'assumed', datumNote: string, floorSet: boolean, natural: Function, design: Function,
 *   floorRL: number, fflOf: Function, reliefM: number, minRL: number|null, maxRL: number|null, interval: null }}
 */
export function levelsModel(project, lot, { tm = null } = {}) {
  const has = hasGround(lot);
  const zNat = has ? groundLevelFn(lot) : null;
  const natural = has ? (p) => { const z = zNat(p); return fin(z) ? z : null; } : () => null;
  // Design surface: the 3D model's graded surface (pads, paving planes, batters) re-expressed as RL; the natural ground where there is none.
  const design = has && tm?.heightAt ? (p) => { const y = tm.heightAt(p.x, p.y); return fin(y) ? y - tm.base + tm.floorRL : natural(p); } : natural;
  const floorSet = fin(lot?.floorRL);
  let floorRL = ASSUMED_RL;
  if (tm && fin(tm.floorRL) && has) floorRL = tm.floorRL;
  else if (floorSet) floorRL = lot.floorRL;
  else if (has) {
    const hull = buildingHull(project || { levels: [] });
    const c = hull.length >= 3 ? G.polygonCentroid(hull) : G.polygonCentroid(lot.boundary);
    const z = natural(c);
    if (fin(z)) floorRL = r2(z + SLAB_M);
  }
  // Natural surface over the lot and a 5 m margin.
  let minRL = null;
  let maxRL = null;
  if (has && lot?.boundary?.length) {
    const bb = G.bbox(lot.boundary);
    for (let j = 0; j <= 20; j++) for (let i = 0; i <= 20; i++) {
      const z = natural({ x: bb.minX - 5000 + ((bb.w + 10000) * i) / 20, y: bb.minY - 5000 + ((bb.h + 10000) * j) / 20 });
      if (fin(z)) { if (minRL == null || z < minRL) minRL = z; if (maxRL == null || z > maxRL) maxRL = z; }
    }
  }
  const polyOfKey = (key) => {
    if (Array.isArray(key)) return key;
    if (key === 'house') { const h = buildingHull(project); return h.length >= 3 ? h : null; }
    const b = project?.commercial ? buildingsOf(project.commercial).find((x) => x.id === key) : null;
    return b?.outline?.length >= 3 ? b.outline : null;
  };
  /** Finished floor level (RL m) of a building or row: the design surface at the centre of its outline plus the slab. */
  const fflOf = (key) => {
    if (!has && !floorSet) return ASSUMED_RL;
    const poly = polyOfKey(key);
    if (!poly) return floorRL;
    const c = poly.length >= 3 ? G.polygonCentroid(poly) : poly[0];
    const z = design(c);
    return fin(z) && has ? r2(z + SLAB_M) : floorRL;
  };
  const datumNote = has ? `Indicative, from the ${lot?.state === 'QLD' ? 'Queensland' : 'NSW'} 5 m DEM` : `Assumed RL ${rlText(ASSUMED_RL)}`;
  return { has, source: has ? 'dem' : 'assumed', datumNote, floorSet, natural, design, floorRL, fflOf, reliefM: has && minRL != null ? maxRL - minRL : 0, minRL, maxRL, hasDesign: !!(has && tm?.heightAt) };
}
