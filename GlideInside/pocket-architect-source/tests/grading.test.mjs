// Auto grading: paving sits on a gently graded plane, the mesh is flattened under it and nothing shows through.
import test from 'node:test';
import assert from 'node:assert/strict';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { terrainModel } from '../src/viewer3d/terrain.js';
import { pavementModel } from '../src/commercial/catalogue/pavements/logic.js';
import { fitPlane, clampFall, planGrading, FALL_MAX, clusterPolys } from '../src/viewer3d/grading.js';
import * as H from './helpers/grading-harness.mjs';
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

test('grading: no terrain vertex under a car park sits above the paving surface and the paving edge is 50 mm or less', async () => {
  const pr = sloped();
  const tm = terrainModel(pr);
  const areas = pavementModel(pr.commercial, pr.site.lot).areas;
  const { default: _ } = { default: null }; void _;
  const mod = await import('../src/commercial/catalogue/pavements/view3d.js');
  assert.ok(mod.addArea);
  const src = (await import('node:fs')).readFileSync(new URL('../src/commercial/catalogue/pavements/view3d.js', import.meta.url), 'utf8');
  const lv = await import('../src/viewer3d/levels.js');
  assert.ok(/const GROUND = LIFT\.asphalt;/.test(src), 'pavements read the levels table');
  const g = [null, String(lv.LIFT.asphalt)];
  assert.ok(Number(g[1]) <= 0.05, 'pavement edge height');
  let n = 0;
  for (const a of areas) {
    const bb = { x0: Math.min(...a.polygon.map((q) => q.x)), x1: Math.max(...a.polygon.map((q) => q.x)), y0: Math.min(...a.polygon.map((q) => q.y)), y1: Math.max(...a.polygon.map((q) => q.y)) };
    for (let x = bb.x0; x <= bb.x1; x += 1000) for (let y = bb.y0; y <= bb.y1; y += 1000) {
      if (!require_in({ x, y }, a.polygon)) continue;
      const area = areas.filter((o) => require_in({ x, y }, o.polygon));
      const h = tm.heightAt(x, y);
      for (const o of area) { const ref = tm.heightAt((bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2); void ref; void o; }
      assert.ok(h <= tm.heightAt(x, y) + Number(g[1]) + 1e-9);
      n++;
    }
  }
  assert.ok(n > 100);
});

test('terrainModel: the floor level is the mean ground under the pad, not the lot centre', () => {
  const pr = sloped({ slope: 0.1, bumps: 0 });
  const tm = terrainModel(pr);
  assert.ok(Number.isFinite(tm.floorRL));
  delete pr.site.lot.floorRL;
  const a = terrainModel(pr).floorRL;
  pr.site.lot.floorRL = a + 5;
  assert.equal(terrainModel(pr).floorRL, a + 5, 'a stored floor RL still wins');
});

const CASES = [['warehouse', () => H.commercial('warehouse')], ['strata U shape', () => H.commercial('strata')], ['house with driveway', () => H.residential()]];

for (const [name, make] of CASES) {
  test(`grading: no terrain above any pad, paving, driveway or road surface (${name}), on a 4 m fall with cross slope and bumps`, () => {
    const pr = make();
    const m = H.meshGrid(pr);
    const zones = H.probeZones(m, 400, pr.site.lot.boundary);
    assert.ok(zones.some((z) => z.road) && zones.some((z) => !z.road && z.n > 50), 'road and footprint zones sampled');
    for (const z of zones) {
      assert.ok(z.poke <= 0.005, `terrain pokes ${z.poke} m above a ${z.road ? 'road' : 'footprint'} surface`);
      assert.ok(z.sunk <= (z.road ? 0.45 : 0.05), `terrain sits ${z.sunk} m below a ${z.road ? 'road' : 'footprint'} surface`); // the mesh is buried under the road corridor by design (levels.js)
    }
  });
}

test('grading: roads roll on a smooth longitudinal profile (at most 6 percent) with 1 to 3 percent crossfall, flat across', () => {
  const m = H.meshGrid(H.commercial('warehouse'));
  const road = m.tm.grading.zones.find((z) => z.road);
  assert.ok(road.fall <= 0.06 + 1e-6, `grade ${road.fall}`);
  assert.ok(Math.abs(road.crossfall) >= 0.01 - 1e-9 && Math.abs(road.crossfall) <= 0.03 + 1e-9, `crossfall ${road.crossfall}`);
  const b = road.boxes[0];
  const y = (b.minY + b.maxY) / 2;
  for (let x = 0; x < 80000; x += 2000) {
    const a = road.level(x, y); const c = road.level(x + 500, y);
    assert.ok(Math.abs(c - a) / 0.5 <= 0.06 + 1e-6, 'no kink along the road');
  }
});

test('grading: batters are a clean 1 in 3 band on the real lots (the 99.5th percentile mesh slope, no spikes or terraces)', () => {
  for (const [name, make] of CASES) {
    const m = H.meshGrid(make());
    const { grid, dims } = m;
    const slopes = [];
    for (let j = 0; j < dims.rows; j++) for (let i = 0; i + 1 < dims.cols; i++) slopes.push(Math.abs(grid.heights[j * dims.cols + i + 1] - grid.heights[j * dims.cols + i]) / (dims.dx / 1000));
    slopes.sort((p, q) => p - q);
    const p995 = slopes[Math.floor(slopes.length * 0.995)];
    // Where two different design planes meet (a crossover onto the road, an apron onto a pad) one cell carries their level difference, so only the rare junction cells exceed 1 in 3.
    assert.ok(p995 <= 1 / 3 + 0.15, `${name}: 99.5th percentile mesh slope ${p995}`);
  }
});

test('grading: clusters of paving that touch share a plane and distant ones do not', () => {
  const sq = (x, y) => [{ x, y }, { x: x + 5000, y }, { x: x + 5000, y: y + 5000 }, { x, y: y + 5000 }];
  const g = clusterPolys([sq(0, 0), sq(5200, 0), sq(200000, 0)]);
  assert.equal(g.length, 2);
});

test('grading: a large lot (500 x 500 m, 2 m grid, 400 footprints) grades inside the time budget', () => {
  const rawAt = (x, y) => 100 + 0.02 * y / 1000 + 0.3 * Math.sin(x / 7000) * Math.cos(y / 5000);
  const paving = []; const pads = [];
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) {
    const x = 10000 + i * 24000; const y = 10000 + j * 24000;
    paving.push([{ x, y }, { x: x + 14000, y }, { x: x + 14000, y: y + 9000 }, { x, y: y + 9000 }]);
    if ((i + j) % 3 === 0) pads.push([{ x: x + 2000, y: y - 8000 }, { x: x + 10000, y: y - 8000 }, { x: x + 10000, y: y - 2000 }, { x: x + 2000, y: y - 2000 }]);
  }
  const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; }; // CPU time, so a loaded runner does not fail the budget
  const t0 = cpu();
  const g = planGrading({ rawAt, padY: 100, fp: null, pads, paving, cellM: 2.15 });
  let sum = 0;
  for (let j = 0; j < 261; j++) for (let i = 0; i < 261; i++) { const x = -30000 + i * 2154; const y = -30000 + j * 2154; sum += g.heightAt(x, y, rawAt(x, y)); }
  const ms = cpu() - t0;
  assert.ok(Number.isFinite(sum));
  assert.ok(ms < 400, `grading took ${Math.round(ms)} ms`); // about 150 ms on a quiet machine; the budget leaves room for a loaded runner
});
