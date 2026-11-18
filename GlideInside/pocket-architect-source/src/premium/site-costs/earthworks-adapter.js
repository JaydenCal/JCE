// The ONE place the site cost estimate reads the grading engine (src/viewer3d/grading.js and terrain.js).
// The grading engine is being rewritten on another branch: when it lands, re-point readEarthworks below and nothing else changes.
//
//   readEarthworks(project) -> {
//     available,            false when the lot has no ground levels (cut and fill cannot be read)
//     cutM3, fillM3,        indicative volumes inside the lot boundary, whole m3
//     padAreaM2,            building footprint plus a working margin
//     slopePct,             natural ground fall across the building pad, percent
//     retaining: { lengthM, faceM2, tallFaceM2, maxHeightM },  where the graded surface steps from natural ground at a side or rear boundary
//     maxCutM, maxFillM,    deepest cut and fill inside the lot, metres
//     driveGradePct,        fall along the graded driveway, percent (null with no driveway)
//     source                text for the report
// opts.tallM sets the wall height above which a wall counts as tall (the council's trigger where known).
//   }
// Pure and Node compatible. Never throws: any failure gives { available: false }.

import * as G from '../../model/geometry.js';
import * as S from '../../viewer3d/site-geom.js';
import { terrainModel, footprintBox } from '../../viewer3d/terrain.js';
import { earthworks, fitPlane } from '../../viewer3d/grading.js';
import { buildingHull, inwardNormalOf, deriveDriveway } from '../../site/lotplan.js';

export const STEP_THRESHOLD_M = 0.25; // a step between graded and natural ground at the boundary bigger than this needs a wall
export const TALL_WALL_M = 1.0;
const WORK_MARGIN_M = 1.5;

export const EARTHWORKS_SOURCE = 'Cut and fill from the 3D site grading (natural ground from the lot elevation data), indicative.';

const none = (padAreaM2 = 0) => ({ available: false, cutM3: 0, fillM3: 0, padAreaM2, slopePct: null, maxCutM: 0, maxFillM: 0, driveGradePct: null, retaining: { lengthM: 0, faceM2: 0, tallFaceM2: 0, maxHeightM: 0 }, source: '' });

function padArea(project) {
  try {
    const hull = buildingHull(project);
    if (!hull?.length) return 0;
    let perim = 0;
    for (let i = 0; i < hull.length; i++) perim += G.dist(hull[i], hull[(i + 1) % hull.length]) / 1000;
    return G.polygonArea(hull) / 1e6 + perim * WORK_MARGIN_M;
  } catch { return 0; }
}

export function readEarthworks(project, { tallM = TALL_WALL_M } = {}) {
  const lot = project?.site?.lot;
  const padAreaM2 = Math.round(padArea(project));
  if (!lot?.terrain || !lot.boundary?.length) return none(padAreaM2);
  try {
    const ext = S.terrainExtent(lot, 30);
    if (!ext) return none(padAreaM2);
    const dims = S.gridDims(ext);
    const tm = terrainModel(project, { cellM: Math.max(dims.dx, dims.dy) / 1000 });
    if (!tm || !tm.grading) return none(padAreaM2);
    const heights = new Float32Array(dims.cols * dims.rows);
    for (let j = 0; j < dims.rows; j++) for (let i = 0; i < dims.cols; i++) heights[j * dims.cols + i] = tm.heightAt(dims.x0 + i * dims.dx, dims.y0 + j * dims.dy);
    const grid = { ...dims, heights };
    // Volumes inside the lot only: outside the boundary the natural ground is reported as the graded height, so nothing is counted there.
    const inLot = (x, y) => G.pointInPolygon({ x, y }, lot.boundary);
    const masked = (x, y) => {
      if (inLot(x, y)) return tm.rawAt(x, y);
      const i = Math.round((x - grid.x0) / grid.dx); const j = Math.round((y - grid.y0) / grid.dy);
      return heights[Math.min(grid.rows - 1, Math.max(0, j)) * grid.cols + Math.min(grid.cols - 1, Math.max(0, i))];
    };
    // The engine's earthworks() reads the grid at the cell centres it visits, so outside cells (d = 0) add nothing.
    const w = earthworks(grid, masked, (dims.dx / 1000) * (dims.dy / 1000));

    let maxCutM = 0; let maxFillM = 0;
    for (let j = 0; j < dims.rows; j++) for (let i = 0; i < dims.cols; i++) {
      const x = dims.x0 + i * dims.dx; const y = dims.y0 + j * dims.dy;
      if (!inLot(x, y)) continue;
      const d = heights[j * dims.cols + i] - tm.rawAt(x, y);
      if (d > maxFillM) maxFillM = d; else if (-d > maxCutM) maxCutM = -d;
    }
    let driveGradePct = null;
    try {
      const dw = deriveDriveway(project);
      if (dw?.ok && dw.centre?.length > 1 && dw.lengthMm > 1000) {
        const a = dw.centre[0]; const b = dw.centre[dw.centre.length - 1];
        driveGradePct = Math.round((Math.abs(tm.heightAt(b.x, b.y) - tm.heightAt(a.x, a.y)) / (dw.lengthMm / 1000)) * 1000) / 10;
      }
    } catch { driveGradePct = null; }

    // Slope across the pad from the natural ground over the building footprint
    const fp = footprintBox(project);
    let slopePct = null;
    if (fp) {
      const smp = [];
      const step = Math.max(500, Math.max(fp.maxX - fp.minX, fp.maxY - fp.minY) / 12);
      for (let x = fp.minX; x <= fp.maxX; x += step) for (let y = fp.minY; y <= fp.maxY; y += step) smp.push({ x: x / 1000, z: y / 1000, y: tm.rawAt(x, y) });
      const f = fitPlane(smp);
      if (f) slopePct = Math.round(Math.hypot(f.gx, f.gz) * 1000) / 10;
    }

    // Retaining: walk the side and rear boundaries, 0.3 m inside the lot; a step bigger than the threshold needs a wall.
    const front = new Set(lot.frontEdges || []);
    let lengthM = 0; let faceM2 = 0; let tallFaceM2 = 0; let maxHeightM = 0;
    for (let e = 0; e < lot.boundary.length; e++) {
      if (front.has(e)) continue;
      const a = lot.boundary[e]; const b = lot.boundary[(e + 1) % lot.boundary.length];
      const len = G.dist(a, b);
      if (!(len > 0)) continue;
      const n = inwardNormalOf(lot, e);
      const steps = Math.max(1, Math.round(len / 1000));
      for (let k = 0; k < steps; k++) {
        const t = (k + 0.5) / steps;
        const x = a.x + (b.x - a.x) * t + n.x * 300; const y = a.y + (b.y - a.y) * t + n.y * 300;
        const h = Math.abs(tm.heightAt(x, y) - tm.rawAt(x, y));
        if (h > STEP_THRESHOLD_M) {
          const seg = len / 1000 / steps;
          lengthM += seg; faceM2 += h * seg; if (h > tallM) tallFaceM2 += h * seg; if (h > maxHeightM) maxHeightM = h;
        }
      }
    }
    const r1 = (v) => Math.round(v * 10) / 10;
    return { available: true, cutM3: w.cutM3, fillM3: w.fillM3, padAreaM2, slopePct, maxCutM: Math.round(maxCutM * 100) / 100, maxFillM: Math.round(maxFillM * 100) / 100, driveGradePct, tallM, retaining: { lengthM: r1(lengthM), faceM2: r1(faceM2), tallFaceM2: r1(tallFaceM2), maxHeightM: Math.round(maxHeightM * 100) / 100 }, source: EARTHWORKS_SOURCE };
  } catch (e) {
    console.warn('[site-costs] earthworks not read', e?.message);
    return none(padAreaM2);
  }
}
