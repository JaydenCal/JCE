// Grading phase 2: no gaps under the exact surfaces (edge skirts), the incremental terrain rebuild, its timing, and the slow rebuild watchdog.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from './helpers/grading-harness.mjs';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import * as S from '../src/viewer3d/site-geom.js';
import * as G from '../src/model/geometry.js';
import { buildModel, disposeModel } from '../src/viewer3d/build.js';
import { terrainStats, resetTerrainCache } from '../src/viewer3d/terrain.js';
import { skirtGeometry, SKIRT_MIN_M } from '../src/viewer3d/skirts.js';
import { createWatchdog } from '../src/viewer3d/watchdog.js';

const CASES = [['warehouse', () => H.commercial('warehouse')], ['strata', () => H.commercial('strata')], ['house with driveway', () => H.residential()]];

for (const [name, make] of CASES) {
  test(`continuity: every exact surface edge meets the ground or has a skirt down to the mesh (${name})`, () => {
    const p = make();
    const mg = H.meshGrid(p); const fds = mg.tm.fds;
    const ext = S.terrainExtent(p.site.lot, 30);
    const meshAt = (x, y) => S.surfaceAt(mg.grid, x, y);
    const levelAt = (x, y) => fds.levelAt(x, y).y;
    const inExtent = (x, y) => x >= ext.x0 && x <= ext.x1 && y >= ext.y0 && y <= ext.y1;
    const sk = skirtGeometry({ elements: fds.elements, levelAt, meshAt, inExtent });
    // every skirt quad reaches below the mesh at both its edge ends and starts at the surface level
    for (let q = 0; q < sk.positions.length; q += 12) {
      for (const e of [0, 6]) {
        const top = sk.positions[q + e + 1]; const bot = sk.positions[q + e + 4]; const x = sk.positions[q + e] * 1000; const z = sk.positions[q + e + 2] * 1000;
        assert.ok(bot <= top, 'a skirt does not point up');
        if (bot < top) assert.ok(bot <= meshAt(x, z) - 0.04, `skirt foot ${bot} is under the mesh ${meshAt(x, z)}`);
      }
    }
    // no gap left: along every edge of an exact surface the surface minus the lowest mesh within reach is covered by a skirt column
    let gaps = 0; let n = 0;
    const cols = new Set();
    for (let q = 0; q < sk.positions.length; q += 12) cols.add(`${Math.round(sk.positions[q] * 2.5)}:${Math.round(sk.positions[q + 2] * 2.5)}`);
    for (const el of fds.elements) {
      if (!['road', 'crossover', 'paving', 'drive'].includes(el.kind)) continue;
      for (const poly of el.polys) for (let i = 0; i < poly.length; i++) {
        const a = poly[i]; const b = poly[(i + 1) % poly.length]; const L = Math.hypot(b.x - a.x, b.y - a.y); if (L < 100) continue;
        for (let s = 0; s <= L; s += 400) {
          const x = a.x + ((b.x - a.x) * s) / L; const y = a.y + ((b.y - a.y) * s) / L;
          if (!inExtent(x, y)) continue;
          n++;
          const gap = levelAt(x, y) - meshAt(x, y);
          if (gap > 0.07 && !cols.has(`${Math.round((x / 1000) * 2.5)}:${Math.round((y / 1000) * 2.5)}`)) gaps++;
        }
      }
    }
    assert.ok(n > 40, 'edges sampled');
    assert.equal(gaps, 0, `${gaps} edge points stand over a gap with no skirt`);
  });
}

test('continuity: the built 3D model carries the edge skirts mesh for a warehouse on a slope', () => {
  const m = buildModel(H.commercial('warehouse'), {});
  let sk = null; m.traverse((o) => { if (o.name === 'edge-skirts') sk = o; });
  disposeModel(m);
  assert.ok(sk && sk.geometry.attributes.position.count > 12, 'edge-skirts mesh present');
});

function terrainOf(m) { let t = null; m.traverse((o) => { if (o.name === 'site-terrain') t = o; }); return t.geometry.attributes.position.array.slice(); }

test('rebuild: an incremental terrain rebuild after moving a building equals a full rebuild exactly, and touches fewer nodes on a large lot', () => {
  const p = commercialProject({ width: 250000, depth: 400000, rows: 'pair', plain: false });
  H.injectTerrain(p, { w: 250000, d: 400000, fall: 12, cellMm: 5000, bump: 1 });
  disposeModel(buildModel(p, {}));
  const b = p.commercial.buildings[0]; const row = p.commercial.rows?.[0];
  if (b) b.place.x += 3000; else row.x += 3000;
  const m = buildModel(p, {}); const inc = terrainOf(m); const st = { ...terrainStats }; disposeModel(m);
  assert.equal(st.mode, 'incremental');
  assert.ok(st.nodesComputed < st.nodesTotal * 0.5, `${st.nodesComputed} of ${st.nodesTotal} nodes recomputed`);
  resetTerrainCache();
  const m2 = buildModel(p, {}); const full = terrainOf(m2); disposeModel(m2);
  assert.equal(inc.length, full.length);
  let worst = 0; for (let i = 0; i < inc.length; i++) worst = Math.max(worst, Math.abs(inc[i] - full[i]));
  assert.ok(worst < 1e-6, `incremental differs from full by ${worst} m`);
});

test('rebuild: raising a pad level (grading control) rebuilds incrementally and matches a full rebuild', () => {
  const p = H.commercial('warehouse');
  disposeModel(buildModel(p, {}));
  p.site.grading = { ...(p.site.grading || {}), pads: { 'pad:0': 0.2 } };
  const m = buildModel(p, {}); const inc = terrainOf(m); const st = { ...terrainStats }; disposeModel(m);
  assert.notEqual(st.mode, 'cached');
  resetTerrainCache(); const m2 = buildModel(p, {}); const full = terrainOf(m2); disposeModel(m2);
  let worst = 0; for (let i = 0; i < inc.length; i++) worst = Math.max(worst, Math.abs(inc[i] - full[i]));
  assert.ok(worst < 1e-6, `incremental differs from full by ${worst} m`);
});

test('timing: a terrain rebuild after an edit stays inside a generous budget (residential 1.5 s, large commercial 4 s; targets 0.3 s and 1 s on a quiet machine)', () => {
  const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
  const house = H.residential();
  disposeModel(buildModel(house, {}));
  const shift = () => { for (const l of house.levels) { for (const w of l.walls) { w.a.x += 500; w.b.x += 500; } for (const r of l.rooms) r.polygon.forEach((q) => { q.x += 500; }); } };
  shift(); disposeModel(buildModel(house, {}));
  shift(); const c0 = cpu(); disposeModel(buildModel(house, {}));
  assert.ok(terrainStats.ms < 1500, `residential terrain rebuild ${Math.round(terrainStats.ms)} ms (cpu ${Math.round(cpu() - c0)} ms for the whole build)`);
  const big = commercialProject({ width: 250000, depth: 400000, rows: 'pair', plain: false });
  H.injectTerrain(big, { w: 250000, d: 400000, fall: 12, cellMm: 5000, bump: 1 });
  disposeModel(buildModel(big, {}));
  const bb = big.commercial.buildings[0]; if (bb) bb.place.x += 2000; else big.commercial.rows[0].x += 2000;
  disposeModel(buildModel(big, {}));
  assert.ok(terrainStats.ms < 4000, `large commercial terrain rebuild ${Math.round(terrainStats.ms)} ms`);
});

test('watchdog: a slow full build degrades, fast low detail builds recover full detail, and a slow recovery backs off', () => {
  const w = createWatchdog(2000);
  assert.equal(w.record(300, 'full'), null);
  assert.equal(w.record(5000, 'full'), 'degrade');
  assert.equal(w.record(900, 'low'), null, 'still slow: 900 ms low is about 5 s full');
  assert.equal(w.record(200, 'low'), null, 'first fast low build');
  assert.equal(w.record(190, 'low'), 'recover', 'second fast low build in a row: back to full');
  assert.equal(w.record(4500, 'full'), 'degrade', 'the recovery was slow: degrade again');
  assert.equal(w.state.need, 4, 'a slow recovery doubles the streak needed');
  assert.equal(w.record(700, 'low'), null, 'the first low build after a degrade only sets the ratio');
  for (let i = 0; i < 3; i++) assert.equal(w.record(150, 'low'), null);
  assert.equal(w.record(150, 'low'), 'recover', 'four fast builds in a row after a slow recovery');
  assert.equal(w.record(400, 'full'), null, 'a fast full build keeps full detail');
  assert.equal(w.state.need, 2, 'and resets the backoff');
});

test('watchdog: a single fast build among slow ones does not recover', () => {
  const w = createWatchdog(2000);
  w.record(6000, 'full');
  w.record(1500, 'low'); w.record(100, 'low');
  assert.equal(w.record(1400, 'low'), null);
  assert.equal(w.state.streak, 0);
});
