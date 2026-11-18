// Shared fixtures and mesh probes for the grading tests: a sloping, bumpy lot and the same grid the 3D viewer meshes.
import { commercialProject } from './commercial-fixture.mjs';
import { createProject } from '../../src/model/schema.js';
import { catalogue } from '../../src/catalogue/index.js';
import { placeHouse } from '../../src/portal/place-house.js';
import { lotEnvelope, portalLotToSiteLot, SAMPLE_LOT } from '../../src/portal/envelope.js';
import { autoPose } from '../../src/portal/auto-place.js';
import { createStore } from '../../src/model/store.js';
import { applyBuildingChoice } from '../../src/commercial/catalogue/ops.js';
import { chooseBuilding } from '../../src/commercial/catalogue/fit.js';
import * as S from '../../src/viewer3d/site-geom.js';
import { terrainModel, nodeHeights } from '../../src/viewer3d/terrain.js';
import * as G from '../../src/model/geometry.js';

/** Natural ground: a fall (m) down the lot depth, a cross slope, and bumps. Written as the lot elevation grid (metres RL). */
export function injectTerrain(p, { w, d, fall = 4, cross = 0.02, bump = 0.35, cellMm = 1000 } = {}) {
  const x0 = -30000; const y0 = -30000;
  const cols = Math.ceil((w + 60000) / cellMm) + 1; const rows = Math.ceil((d + 60000) / cellMm) + 1;
  const values = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = (x0 + i * cellMm) / 1000; const y = (y0 + j * cellMm) / 1000;
    values.push(100 + (fall / (d / 1000)) * y + cross * x + bump * Math.sin(x * 0.9) * Math.cos(y * 0.7));
  }
  p.site.lot.terrain = { cols, rows, cellMm, x0, y0, values };
  return p;
}

export function commercial(kind = 'warehouse', opts = {}) {
  const p = commercialProject({ width: 60000, depth: 100000, rows: kind === 'strata' ? 'pair' : 'none' });
  if (kind !== 'strata') { const store = createStore(p); applyBuildingChoice(store, chooseBuilding(store.project, kind)); return injectTerrain(store.project, { w: 60000, d: 100000, ...opts }); }
  return injectTerrain(p, { w: 60000, d: 100000, ...opts });
}

export function residential(opts = {}) {
  const portal = { name: 'T', polygonMm: SAMPLE_LOT.polygonMm, frontEdgeIndices: [2], picked: { front: { minM: 4.5 }, secondaryFront: { minM: 3 }, side: { minM: 0.9 }, rear: { minM: 3 } }, lot: '7', dp: 'DP 99' };
  const p = createProject({ name: 'Drive' });
  p.site.lot = portalLotToSiteLot(portal, lotEnvelope(portal));
  const h = catalogue.createFromTemplate('house_double');
  placeHouse(p, h, autoPose(p, h).pose);
  const xs = p.site.lot.boundary.map((q) => q.x); const ys = p.site.lot.boundary.map((q) => q.y);
  const d = Math.max(...ys);
  return injectTerrain(p, { w: Math.max(...xs), d, fall: 4 * (d / 100000), bump: 0.12, ...opts });
}

/** The viewer mesh grid, built exactly as addSiteTerrain does. */
export function meshGrid(p) {
  const ext = S.terrainExtent(p.site.lot, 30);
  const dims = S.gridDims(ext);
  const tm = terrainModel(p, { cellM: Math.max(dims.dx, dims.dy) / 1000 });
  const heights = new Float32Array(dims.cols * dims.rows); const design = new Float32Array(dims.cols * dims.rows);
  const cellM = Math.max(dims.dx, dims.dy) / 1000;
  for (let j = 0; j < dims.rows; j++) for (let i = 0; i < dims.cols; i++) { const nh = nodeHeights(tm, dims.x0 + i * dims.dx, dims.y0 + j * dims.dy, cellM); heights[j * dims.cols + i] = nh.mesh; design[j * dims.cols + i] = nh.design; }
  return { tm, dims, grid: { ...dims, heights }, design: { ...dims, heights: design } };
}

/**
 * Over every footprint zone, the worst mesh height above (poke) and below (sunk) its design surface. A sample counts only where this zone is the
 * first (highest ranked) to contain it and it is at least one cell clear of every other zone, so two different planes meeting is not scored.
 */
export function probeZones({ tm, grid, dims }, step = 400) {
  const zs = tm.grading.zones;
  const clear = Math.max(dims.dx, dims.dy) * 1.6;
  const out = [];
  zs.forEach((z, zi) => {
    let poke = 0; let sunk = 0; let n = 0;
    for (let k = 0; k < z.polys.length; k++) {
      const bb = z.boxes[k];
      for (let x = bb.minX + 100; x < bb.maxX; x += step) for (let y = bb.minY + 100; y < bb.maxY; y += step) {
        if (!G.pointInPolygon({ x, y }, z.polys[k])) continue;
        if (x < grid.x0 || x > grid.x0 + (grid.cols - 1) * grid.dx || y < grid.y0 || y > grid.y0 + (grid.rows - 1) * grid.dy) continue;
        let skip = false;
        zs.forEach((o, oi) => {
          if (oi === zi || skip) return;
          if (o.polys.some((q, qi) => G.pointInPolygon({ x, y }, q) || nearPoly({ x, y }, q, o.boxes[qi], clear + 2200))) skip = true; // beyond the 2 m transition to a neighbour
        });
        if (skip) continue;
        const dz = S.surfaceAt(grid, x, y) - z.level(x, y);
        n++; if (dz > poke) poke = dz; if (-dz > sunk) sunk = -dz;
      }
    }
    out.push({ road: !!z.road, poke, sunk, n });
  });
  return out;
}

function nearPoly(p, poly, bb, d) {
  if (p.x < bb.minX - d || p.x > bb.maxX + d || p.y < bb.minY - d || p.y > bb.maxY + d) return false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x; const ey = b.y - a.y; const l2 = ex * ex + ey * ey;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2)) : 0;
    if (Math.hypot(p.x - a.x - t * ex, p.y - a.y - t * ey) < d) return true;
  }
  return false;
}
