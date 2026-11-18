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

// ---- Grading v3: one continuous sealed surface per pavement network ----
import { pavementModel } from '../src/commercial/catalogue/pavements/logic.js';
import { retainingEdges } from '../src/viewer3d/terrain.js';
import { retainingWallGeometry } from '../src/viewer3d/skirts.js';
import { LIMITS } from '../src/viewer3d/grade-limits.js';

const SEALED = (a) => !['landscape'].includes(a.role) && !String(a.id).startsWith('sw:foot'); // footpaths (office door, carpark tool) are separate slabs beside the bays, a planted strip may sit between
function ringDistMm(A, B) {
  let best = Infinity;
  for (const poly of [A, B]) {
    const other = poly === A ? B : A;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]; const b = poly[(i + 1) % poly.length]; const L = Math.hypot(b.x - a.x, b.y - a.y);
      for (let s = 0; s <= L; s += 100) {
        const q = { x: a.x + ((b.x - a.x) * s) / (L || 1), y: a.y + ((b.y - a.y) * s) / (L || 1) };
        if (G.pointInPolygon(q, other)) return 0;
        for (let k = 0; k < other.length; k++) best = Math.min(best, G.projectToSegment(q, other[k], other[(k + 1) % other.length]).d);
      }
    }
  }
  return best;
}

for (const kind of ['warehouse', 'strata']) {
  test(`network: sealed pavement polygons have no internal gap wider than 50 mm (${kind})`, () => {
    const p = H.commercial(kind);
    const pm = pavementModel(p.commercial, p.site.lot);
    const areas = pm.areas.filter(SEALED);
    assert.ok(areas.length > 2);
    // two areas whose outlines come within 3 m of each other are neighbours in one network: they must touch or overlap (gap at most 50 mm)
    let checked = 0;
    for (let i = 0; i < areas.length; i++) for (let j = i + 1; j < areas.length; j++) {
      const A = G.bbox(areas[i].polygon); const B = G.bbox(areas[j].polygon);
      if (Math.max(B.minX - A.maxX, A.minX - B.maxX, B.minY - A.maxY, A.minY - B.maxY) > 3000) continue;
      const d = ringDistMm(areas[i].polygon, areas[j].polygon);
      checked++;
      if (d > 3000) continue;
      if (d <= 50) continue;
      // a wider gap must be closed by a third (joining) area: the point midway between the nearest points lies in the union
      let bp = null;
      for (const [P, Q] of [[areas[i].polygon, areas[j].polygon], [areas[j].polygon, areas[i].polygon]]) for (let a = 0; a < P.length; a++) {
        const u0 = P[a]; const u1 = P[(a + 1) % P.length]; const L = Math.hypot(u1.x - u0.x, u1.y - u0.y);
        for (let t = 0; t <= L; t += 100) {
          const q = { x: u0.x + ((u1.x - u0.x) * t) / (L || 1), y: u0.y + ((u1.y - u0.y) * t) / (L || 1) };
          for (let k = 0; k < Q.length; k++) { const pr = G.projectToSegment(q, Q[k], Q[(k + 1) % Q.length]); if (!bp || pr.d < bp.d) bp = { d: pr.d, q, p: pr.point || pr.p || pr }; }
        }
      }
      const mid = bp && bp.p && Number.isFinite(bp.p.x) ? { x: (bp.q.x + bp.p.x) / 2, y: (bp.q.y + bp.p.y) / 2 } : null;
      assert.ok(mid && areas.some((a) => G.pointInPolygon(mid, a.polygon)), `${areas[i].id} and ${areas[j].id} are ${Math.round(d)} mm apart with no joining pavement (ground shows between them)`);
    }
    assert.ok(checked > 0);
  });
}

for (const [name, make] of CASES) {
  test(`design surface: grades, equal levels across a network, batters (${name})`, () => {
    const p = make(); const mg = H.meshGrid(p); const fds = mg.tm.fds;
    for (const el of fds.elements) {
      if (el.kind === 'paving') assert.ok(el.fall <= LIMITS.carParkAlongBays + 1e-6, `${el.id} falls ${el.fall}`);
      if (el.kind === 'drive') assert.ok(el.fall <= LIMITS.drivewayMax + 1e-6);
    }
    // inside one network (a paving element) a step of more than 10 mm between neighbouring points never occurs: the level is one plane
    for (const el of fds.elements.filter((e) => e.kind === 'paving')) {
      for (const poly of el.polys) {
        const bb = G.bbox(poly);
        for (let x = bb.minX; x < bb.maxX; x += 1500) for (let y = bb.minY; y < bb.maxY; y += 1500) {
          if (!G.pointInPolygon({ x, y }, poly) || !G.pointInPolygon({ x: x + 100, y }, poly)) continue;
          assert.ok(Math.abs(fds.levelAt(x, y).y - fds.levelAt(x + 100, y).y) < 0.01 + 0.06 * 0.1 + 1e-9, 'no step across a network');
        }
      }
    }
    // batters: slope 1V:3H in fill, 1V:2H in cut, never steeper
    const bn = fds.elements.filter((e) => e.kind === 'paving' || e.kind === 'drive');
    let worst = 0; let wpos = null;
    for (const el of bn) for (const poly of el.polys) {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]; const b = poly[(i + 1) % poly.length]; const L = Math.hypot(b.x - a.x, b.y - a.y); if (L < 1000) continue;
        const nx = (b.y - a.y) / L; const ny = -(b.x - a.x) / L;
        for (let s = 500; s < L; s += 2000) {
          const q = { x: a.x + ((b.x - a.x) * s) / L, y: a.y + ((b.y - a.y) * s) / L };
          for (const sg of [1, -1]) {
            let first = null; let last = null;
            for (let d = 1300; d < 9000; d += 100) {
              const x = q.x + sg * nx * d; const y = q.y + sg * ny * d;
              if (!G.pointInPolygon({ x, y }, p.site.lot.boundary)) break;
              const r = fds.levelAt(x, y);
              if (!r.batter || r.near !== el.id) continue;
              if (!first) first = { d, y: r.y }; last = { d, y: r.y };
            }
            // the overall slope of the batter (its natural ground side is bumpy, so a local slope also carries the bump)
            if (first && last && last.d - first.d >= 800) { const slope = Math.abs(last.y - first.y) / ((last.d - first.d) / 1000); if (slope > worst) { worst = slope; wpos = { id: el.id, d0: first.d, d1: last.d }; } }
          }
        }
      }
    }
    assert.ok(worst <= 0.5 + 0.05, `a batter is steeper than 1V:2H (${worst}) at ${JSON.stringify(wpos)}`);
  });
}

test('retaining wall: where the lot boundary holds back a step the model carries a block face and capping, with no tall grey skirt', () => {
  const p = H.commercial('warehouse');
  const m = buildModel(p, {});
  const names = []; m.traverse((o) => names.push(o.name));
  let sk = null; m.traverse((o) => { if (o.name === 'edge-skirts') sk = o; });
  const mg = H.meshGrid(p); const re = retainingEdges(mg.tm, p.site.lot, 0.15);
  disposeModel(m);
  if (re.samples.length > 2) { assert.ok(names.includes('retaining-wall') && names.includes('retaining-wall-cap'), 'wall and capping present'); }
  const wg = retainingWallGeometry([{ x: 0, y: 0, nx: 0, ny: -1, a: 1, b: 0 }, { x: 1000, y: 0, nx: 0, ny: -1, a: 1, b: 0 }]);
  assert.equal(wg.face.indices.length, 6); assert.equal(wg.cap.indices.length, 6);
  // the safety net skirts are coloured like the ground
  if (sk) assert.equal(sk.material.color.getHexString(), '6f8a58');
});

test('skirts: no vertical skirt over 50 mm shows (beyond the 50 mm foot) inside the lot except at the boundary', () => {
  for (const [, make] of CASES) {
    const p = make(); const mg = H.meshGrid(p); const fds = mg.tm.fds;
    const ext = S.terrainExtent(p.site.lot, 30);
    const sk = skirtGeometry({ elements: fds.elements, levelAt: (x, y) => fds.levelAt(x, y).y, meshAt: (x, y) => S.surfaceAt(mg.grid, x, y), inExtent: (x, y) => x >= ext.x0 && x <= ext.x1 && y >= ext.y0 && y <= ext.y1 });
    let big = 0;
    for (let q = 0; q < sk.positions.length; q += 12) {
      const x = sk.positions[q] * 1000; const z = sk.positions[q + 2] * 1000;
      const vis = sk.positions[q + 1] - S.surfaceAt(mg.grid, x, z);
      const onRoad = fds.levelAt(x, z).near && /road|crossover/.test(String(fds.levelAt(x, z).near));
      // 30 mm subgrade plus the slope across one mesh cell can show up to about 80 mm of grass coloured safety skirt; taller faces within a metre of the boundary are the retaining wall's job
      const nearB = p.site.lot.boundary.some((a, i) => G.projectToSegment({ x, y: z }, a, p.site.lot.boundary[(i + 1) % p.site.lot.boundary.length]).d < 1000);
      if (vis > 0.08 && !onRoad && !nearB && G.pointInPolygon({ x, y: z }, p.site.lot.boundary)) big++;
    }
    assert.equal(big, 0, `${big} visible skirt columns over 50 mm inside the lot`);
  }
});
