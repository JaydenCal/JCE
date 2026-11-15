// Auto grading: paving sits on a gently graded plane, the mesh is flattened under it and nothing shows through.
import test from 'node:test';
import assert from 'node:assert/strict';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { terrainModel } from '../src/viewer3d/terrain.js';
import { pavementModel } from '../src/commercial/catalogue/pavements/logic.js';
import { fitPlane, clampFall, planGrading, FALL_MAX } from '../src/viewer3d/grading.js';
import { createStore } from '../src/model/store.js';
import { applyBuildingChoice } from '../src/commercial/catalogue/ops.js';
import { chooseBuilding } from '../src/commercial/catalogue/fit.js';

function sloped({ slope = 0.08, bumps = 0.6 } = {}) {
  const p = commercialProject({ width: 80000, depth: 90000, rows: 'none' });
  const store = createStore(p);
  applyBuildingChoice(store, chooseBuilding(store.project, 'warehouse'));
  const pr = store.project;
  const cols = 90; const rows = 100; const cellMm = 1000;
  const x0 = -5000; const y0 = -5000;
  const values = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) values.push(100 + slope * (y0 + j * cellMm) / 1000 + bumps * Math.sin(i * 0.9) * Math.cos(j * 0.7));
  pr.site.lot.terrain = { cols, rows, cellMm, x0, y0, values };
  return pr;
}

test('grading: plane fit and fall clamp', () => {
  const pts = [];
  for (let x = 0; x < 10; x++) for (let z = 0; z < 10; z++) pts.push({ x, z, y: 2 + 0.03 * x - 0.02 * z });
  const f = fitPlane(pts);
  assert.ok(Math.abs(f.gx - 0.03) < 1e-9 && Math.abs(f.gz + 0.02) < 1e-9);
  const c = clampFall(0.2, 0);
  assert.ok(Math.abs(Math.hypot(c.gx, c.gz) - FALL_MAX) < 1e-9);
  assert.deepEqual(clampFall(0.0005, 0), { gx: 0, gz: 0 });
  const g = clampFall(0.004, 0);
  assert.ok(Math.abs(Math.hypot(g.gx, g.gz) - 0.01) < 1e-9);
});

test('grading: a sloping, bumpy lot gets paving on one plane (fall 1 to 5 percent) with the mesh flattened under it', () => {
  const pr = sloped();
  const tm = terrainModel(pr);
  assert.ok(tm.grading, 'grading planned');
  const areas = pavementModel(pr.commercial, pr.site.lot).areas;
  assert.ok(areas.length);
  const pts = [];
  for (const a of areas) { const bb = { x0: Math.min(...a.polygon.map((q) => q.x)), x1: Math.max(...a.polygon.map((q) => q.x)), y0: Math.min(...a.polygon.map((q) => q.y)), y1: Math.max(...a.polygon.map((q) => q.y)) }; for (const [fx, fy] of [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7], [0.5, 0.5]]) pts.push({ x: bb.x0 + (bb.x1 - bb.x0) * fx, y: bb.y0 + (bb.y1 - bb.y0) * fy }); }
  const inside = pts.filter((q) => areas.some((a) => a.polygon.length >= 3 && require_in(q, a.polygon)));
  assert.ok(inside.length > 6);
  const f = fitPlane(inside.map((q) => ({ x: q.x / 1000, z: q.y / 1000, y: tm.heightAt(q.x, q.y) })));
  const fall = Math.hypot(f.gx, f.gz);
  assert.ok(fall <= FALL_MAX + 1e-6 && fall >= 0.01 - 1e-6, `fall ${fall}`);
  for (const q of inside) {
    const planeY = f.cy + f.gx * (q.x / 1000 - f.cx) + f.gz * (q.y / 1000 - f.cz);
    assert.ok(Math.abs(tm.heightAt(q.x, q.y) - planeY) < 0.01, 'on the plane');
  }
  // The natural ground is bumpy (more than 0.2 m about its own plane) so the flattening is real
  const raw = fitPlane(inside.map((q) => ({ x: q.x / 1000, z: q.y / 1000, y: tm.rawAt(q.x, q.y) })));
  const dev = Math.max(...inside.map((q) => Math.abs(tm.rawAt(q.x, q.y) - (raw.cy + raw.gx * (q.x / 1000 - raw.cx) + raw.gz * (q.y / 1000 - raw.cz)))));
  assert.ok(dev > 0.2, `natural ground deviation ${dev}`);
});

test('grading: a batter of about 1 in 3 runs back to natural ground and far ground is untouched', () => {
  const zone = [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 10000 }, { x: 0, y: 10000 }];
  const rawAt = (x) => 4 + x / 1000 * 0.2; // a steep 20 percent natural slope, so the design plane is well away from the ground
  const g = planGrading({ rawAt, padY: 0, fp: null, paving: [zone] });
  assert.ok(g);
  const at = (x) => g.heightAt(x, 5000, rawAt(x));
  assert.equal(g.heightAt(500000, 500000, 7), 7);
  let steepest = 0;
  for (let x = 11000; x < 40000; x += 500) steepest = Math.max(steepest, Math.abs(at(x + 500) - at(x)) / 0.5);
  assert.ok(steepest > 0.2 && steepest <= 1 / 3 + 1e-6, `batter slope ${steepest}`);
  assert.ok(Math.abs(at(60000) - rawAt(60000)) < 1e-9, 'natural ground beyond the batter');
});

function require_in(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if ((poly[i].y > p.y) !== (poly[j].y > p.y) && p.x < ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) c = !c;
  }
  return c;
}
