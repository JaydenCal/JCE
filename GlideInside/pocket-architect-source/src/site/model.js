// Turns the /api/site responses into the project's `site.lot` (plan millimetres, y down) and back.
//
// site.lot (schema 2)
//   source, address, state, srid, zone, origin {e, n}   MGA2020 point that plan (0, 0) refers to (the lot centroid)
//   northRef: 'MGA grid north'                            plan up = grid north, so site.northDeg is 0
//   lotLabel, lotNumber, planLabel, areaM2, lga, zoning {code, name, instrument} | null, zoneNote
//   boundary [{x, y}], holes [[{x, y}]]                   the lot, plan mm (MGA northing maps to -y)
//   neighbours [{ id, lotNumber, planLabel, ring, holes }]
//   contours [{ level, major, closed, pts: [x0, y0, x1, y1, ...] }]   plan mm, flat arrays to keep the project small
//   terrain { cols, rows, cellMm, x0, y0, values[] }      node (i, j) at x0 + i * cellMm, y0 + j * cellMm; row 0 is the north edge
//   aerial { key, source, attribution, captureDate, extent {x0, y0, x1, y1}, mmPerPx }  the image itself lives in IndexedDB (site.underlay)
//   floorRL, floorRLAuto                                  finished floor level in metres (default: lot centroid RL + 0.15)
//   layers { boundary, neighbours, aerial, contours, labels, dimensions }
//   setbacks: null, envelope: null                        hooks for the setback stage. Nothing is invented here.
//   provenance { lot, aerial, elevation }                 what each layer came from and how far to trust it

import { siteToPlan, planToSite, ringEdges, round } from './geo.js';

export const FLOOR_ABOVE_GROUND_M = 0.15;
export const DEFAULT_LAYERS = { boundary: true, neighbours: true, aerial: true, contours: true, labels: true, dimensions: true };

const polyOf = (resp) => resp?.polygons?.[0] || { outer: [], holes: [] };
const ringToPlan = (ring) => ring.map(siteToPlan);

// Height of the terrain grid (plan mm coordinates) at a plan point, or null outside it.
export function terrainAt(terrain, x, y) {
  if (!terrain) return null;
  const fi = (x - terrain.x0) / terrain.cellMm;
  const fj = (y - terrain.y0) / terrain.cellMm;
  if (fi < 0 || fj < 0 || fi > terrain.cols - 1 || fj > terrain.rows - 1) return null;
  const i = Math.min(terrain.cols - 2, Math.floor(fi));
  const j = Math.min(terrain.rows - 2, Math.floor(fj));
  const tx = fi - i;
  const ty = fj - j;
  const v = (a, b) => terrain.values[b * terrain.cols + a];
  return (v(i, j) * (1 - tx) + v(i + 1, j) * tx) * (1 - ty) + (v(i, j + 1) * (1 - tx) + v(i + 1, j + 1) * tx) * ty;
}

export function buildTerrain(grid) {
  if (!grid?.values?.length) return null;
  const p = siteToPlan([grid.x0, grid.y0]); // north west node
  return { cols: grid.cols, rows: grid.rows, cellMm: Math.round(grid.cell * 1000), x0: p.x, y0: p.y, values: grid.values.map((v) => round(v, 2)) };
}

export function buildContours(resp) {
  return (resp?.contours || []).map((c) => ({
    level: c.level,
    major: !!c.major,
    closed: !!c.closed,
    pts: c.points.flatMap((p) => {
      const q = siteToPlan(p);
      return [Math.round(q.x), Math.round(q.y)];
    }),
  }));
}

/**
 * buildSiteLot({ lot, aerialMeta, aerialKey, contours, address, source }) -> site.lot
 * `lot` is the /api/site/lot response, `contours` the /api/site/contours response (or null).
 */
export function buildSiteLot({ lot, aerialMeta = null, aerialKey = null, contours = null, address = '', source = 'api', warnings = [] }) {
  if (!lot?.lot) throw new Error('No lot in the response');
  const poly = polyOf(lot.lot);
  const terrain = buildTerrain(contours?.grid);
  const out = {
    source,
    address: address || '',
    state: lot.state,
    srid: lot.srid,
    zone: lot.zone,
    origin: { e: lot.origin.e, n: lot.origin.n },
    northRef: 'MGA grid north',
    lotLabel: lot.lot.lotLabel,
    lotNumber: lot.lot.lotNumber,
    planLabel: lot.lot.planLabel,
    areaM2: lot.lot.areaM2,
    registeredAreaM2: lot.lot.registeredAreaM2 ?? null,
    lga: lot.lga || '',
    zoning: lot.zoning || null,
    zoneNote: lot.zoneNote || null,
    boundary: ringToPlan(poly.outer),
    holes: (poly.holes || []).map(ringToPlan),
    neighbours: (lot.neighbours || []).map((n, i) => {
      const np = polyOf(n);
      return { id: `n_${i}`, lotNumber: n.lotNumber, planLabel: n.planLabel, areaM2: n.areaM2, ring: ringToPlan(np.outer), holes: (np.holes || []).map(ringToPlan) };
    }),
    contours: buildContours(contours),
    contourInterval: contours ? { minor: contours.minor, major: contours.major } : null,
    terrain,
    aerial: aerialMeta && aerialKey ? {
      key: aerialKey,
      source: aerialMeta.source || '',
      attribution: aerialMeta.attribution || '',
      captureDate: aerialMeta.captureDate || null,
      mmPerPx: aerialMeta.mmPerPx,
      extent: aerialExtentPlan(aerialMeta.bbox, lot.origin),
    } : null,
    floorRL: null,
    floorRLAuto: true,
    layers: { ...DEFAULT_LAYERS },
    setbacks: null,
    envelope: null,
    provenance: {
      lot: { attribution: lot.attribution || '', retrieved: lot.retrieved || null },
      aerial: aerialMeta ? { source: aerialMeta.source, attribution: aerialMeta.attribution, captureDate: aerialMeta.captureDate || null } : null,
      elevation: contours?.provenance || null,
    },
    warnings,
    sample: !!lot.sample,
  };
  out.floorRL = defaultFloorRL(out);
  return out;
}

export function aerialExtentPlan(bbox, origin) {
  // MGA bbox to plan mm. Northing maps to -y, so max northing is the top edge.
  return {
    x0: Math.round((bbox.minE - origin.e) * 1000),
    y0: Math.round(-(bbox.maxN - origin.n) * 1000),
    x1: Math.round((bbox.maxE - origin.e) * 1000),
    y1: Math.round(-(bbox.minN - origin.n) * 1000),
  };
}

// RL (metres) of the lot centroid, or null when there is no terrain.
export function centroidRL(lot) {
  const v = terrainAt(lot.terrain, 0, 0);
  return v == null ? null : v;
}

export function defaultFloorRL(lot) {
  const c = centroidRL(lot);
  return c == null ? null : round(c + FLOOR_ABOVE_GROUND_M, 2);
}

// The floor RL that applies: the stored value, else centroid RL + 0.15, else 0 (no terrain).
export function floorRLOf(lot) {
  if (!lot) return 0;
  if (Number.isFinite(lot.floorRL)) return lot.floorRL;
  return defaultFloorRL(lot) ?? 0;
}

// The underlay entry (plan mm, centred) for the aerial image, placed to scale and locked.
export function underlayFor(lot) {
  const a = lot.aerial;
  if (!a) return null;
  return {
    key: a.key,
    x: Math.round((a.extent.x0 + a.extent.x1) / 2),
    y: Math.round((a.extent.y0 + a.extent.y1) / 2),
    mmPerPx: a.mmPerPx,
    rotation: 0,
    opacity: 0.85,
    locked: true,
    site: true,
  };
}

// Boundary edge labels: length in metres to 2 decimals, midpoint and angle (plan mm and radians).
export function boundaryEdges(lot) {
  if (!lot?.boundary?.length) return [];
  return ringEdges(lot.boundary.map((p) => [p.x, p.y])).map((e) => ({
    a: { x: e.a[0], y: e.a[1] }, b: { x: e.b[0], y: e.b[1] },
    mid: { x: e.mid[0], y: e.mid[1] },
    lengthM: e.length / 1000,
    label: (e.length / 1000).toFixed(2),
  }));
}

export const lotPlanPoints = (lot) => (lot ? [...lot.boundary, ...lot.neighbours.flatMap((n) => n.ring)].map((p) => ({ x: p.x, y: p.y })) : []);
export const planToSitePoint = planToSite;
