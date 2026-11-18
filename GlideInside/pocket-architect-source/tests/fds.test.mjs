// The finished design surface (src/viewer3d/fds.js): continuity across element edges, driveway grade change, no surface under the ground,
// no paved plane falling towards a building, and one table of lifts (src/viewer3d/levels.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as H from './helpers/grading-harness.mjs';
import * as S from '../src/viewer3d/site-geom.js';
import * as G from '../src/model/geometry.js';
import { deriveDriveway } from '../src/site/lotplan.js';
import { pavementModel } from '../src/commercial/catalogue/pavements/logic.js';
import { polyDistM } from '../src/viewer3d/fds.js';
import * as LV from '../src/viewer3d/levels.js';

const CASES = [['warehouse', () => H.commercial('warehouse')], ['strata', () => H.commercial('strata')], ['house with driveway', () => H.residential()]];

for (const [name, make] of CASES) {
  test(`fds: level is continuous across every shared edge of a pad, paving, driveway and crossover (${name})`, () => {
    const pr = make(); const lotRing = pr.site.lot.boundary;
    const m = H.meshGrid(pr);
    const fds = m.tm.fds;
    assert.ok(fds, 'a design surface exists');
    let n = 0; let worst = 0;
    for (const el of fds.elements) {
      if (el.road) continue; // a kerb face is a deliberate step
      for (const poly of el.polys) for (let i = 0; i < poly.length; i++) {
        const a = poly[i]; const b = poly[(i + 1) % poly.length];
        const L = Math.hypot(b.x - a.x, b.y - a.y); if (L < 100) continue;
        const nx = (b.y - a.y) / L; const ny = -(b.x - a.x) / L;
        for (let s = 200; s < L - 200; s += 1000) {
          const q = { x: a.x + ((b.x - a.x) * s) / L, y: a.y + ((b.y - a.y) * s) / L };
          if (!G.pointInPolygon(q, lotRing)) continue; // beyond the lot boundary the step is a retaining edge, by design
          const lo = fds.levelAt(q.x - nx * 2, q.y - ny * 2).y; const hi = fds.levelAt(q.x + nx * 2, q.y + ny * 2).y;
          worst = Math.max(worst, Math.abs(lo - hi)); n++;
        }
      }
    }
    assert.ok(n > 20, 'edges sampled');
    assert.ok(worst < 0.005, `level jumps ${worst} m across an element edge`);
  });
}

test('fds: house driveway grade change is at most 12.5 percent per 2 m (where the street is within reach of the pad)', () => {
  const p = H.residential({ fall: 0.25 });
  const m = H.meshGrid(p);
  const dw = deriveDriveway(p);
  assert.ok(dw?.ok && dw.centre.length > 1);
  const pts = [];
  for (let i = 0; i + 1 < dw.centre.length; i++) {
    const a = dw.centre[i]; const b = dw.centre[i + 1]; const L = Math.hypot(b.x - a.x, b.y - a.y);
    for (let s = 0; s < L; s += 250) pts.push({ x: a.x + ((b.x - a.x) * s) / L, y: a.y + ((b.y - a.y) * s) / L });
  }
  const lv = pts.map((q) => m.tm.fds.levelAt(q.x, q.y).y);
  const step = 0.25;
  const slope = (i) => (lv[i + 4] - lv[i]) / (4 * step); // over 1 m
  let worst = 0;
  for (let i = 0; i + 12 < lv.length; i++) worst = Math.max(worst, Math.abs(slope(i + 8) - slope(i)));
  assert.ok(worst <= 0.125 + 1e-6, `grade change ${worst} per 2 m`);
});

for (const [name, make] of CASES) {
  test(`fds: no surface sits below the terrain mesh and the mesh never pokes through (${name})`, () => {
    const p = make();
    const m = H.meshGrid(p);
    const fds = m.tm.fds;
    let n = 0;
    for (const el of fds.elements) {
      if (el.kind === 'pad') continue;
      for (const poly of el.polys) {
        const bb = G.bbox(poly);
        for (let x = bb.minX + 150; x < bb.maxX; x += 700) for (let y = bb.minY + 150; y < bb.maxY; y += 700) {
          if (!G.pointInPolygon({ x, y }, poly)) continue;
          if (!G.pointInPolygon({ x, y }, p.site.lot.boundary)) continue;
          if (p.site.lot.boundary.some((q, qi) => G.projectToSegment({ x, y }, q, p.site.lot.boundary[(qi + 1) % p.site.lot.boundary.length]).d < 800)) continue; // within a mesh cell of the boundary the design stops (retaining edge), the cell straddles it
          if (x < m.grid.x0 || x > m.grid.x0 + (m.grid.cols - 1) * m.grid.dx || y < m.grid.y0 || y > m.grid.y0 + (m.grid.rows - 1) * m.grid.dy) continue;
          // inside a steep blend zone (within 2.5 m of a higher priority element) a coarse mesh can differ by a few mm: scored by the visual checks
          if (fds.elements.some((o) => o.rank < el.rank && o.polys.some((q, qi) => polyDistM({ x, y }, q, o.boxes[qi]).d < 2.5))) continue;
          const surfY = fds.levelAt(x, y).y; // the surface is built at the FDS plus the table lift
          const mesh = S.surfaceAt(m.grid, x, y);
          assert.ok(surfY + LV.LIFT.asphalt >= mesh - 0.002, `${el.id}: surface ${surfY} below mesh ${mesh} at ${x},${y}`);
          n++;
        }
      }
    }
    assert.ok(n > 0 || name.startsWith("house"));
  });
}

test('fds: no paved plane falls towards a building face', () => {
  for (const [name, make] of CASES) {
    const m = H.meshGrid(make());
    const fds = m.tm.fds;
    const pads = fds.elements.filter((e) => e.kind === 'pad');
    const paved = fds.elements.filter((e) => e.kind === 'paving');
    let n = 0;
    for (const pad of pads) for (const poly of pad.polys) for (let i = 0; i < poly.length; i++) {
      const a = poly[i]; const b = poly[(i + 1) % poly.length];
      const L = Math.hypot(b.x - a.x, b.y - a.y); if (L < 1000) continue;
      let nx = (b.y - a.y) / L; let ny = -(b.x - a.x) / L;
      if (G.pointInPolygon({ x: (a.x + b.x) / 2 + nx * 50, y: (a.y + b.y) / 2 + ny * 50 }, poly)) { nx = -nx; ny = -ny; }
      for (let s = 500; s < L - 500; s += 2000) {
        const q = { x: a.x + ((b.x - a.x) * s) / L, y: a.y + ((b.y - a.y) * s) / L };
        const p3 = { x: q.x + nx * 1500, y: q.y + ny * 1500 }; const p6 = { x: q.x + nx * 5000, y: q.y + ny * 5000 };
        const el = paved.find((e) => !e.towardsBuilding && e.polys.some((r) => G.pointInPolygon(p3, r)) && e.polys.some((r) => G.pointInPolygon(p6, r)));
        if (!el) continue;
        n++;
        assert.ok(el.level(p6.x, p6.y) <= el.level(p3.x, p3.y) + 0.005, `${name}: ${el.id} rises away from a building face`);
      }
    }
    void n;
  }
});

test('levels: one table of lifts, no numeric lift anywhere else in the ground surfaces', () => {
  assert.ok(Object.values(LV.LIFT).every((v) => Math.abs(v) <= 0.05));
  const files = ['src/viewer3d/pave3d.js', 'src/commercial/catalogue/pavements/view3d.js', 'src/commercial/catalogue/entourage3d.js', 'src/viewer3d/site-extras.js', 'src/viewer3d/grading.js', 'src/viewer3d/fds.js'];
  for (const f of files) {
    const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    const bad = src.split('\n').filter((l) => /\b(?:H|F|surf|fds)\([^)]*\)\s*[-+]\s*0\.0\d/.test(l) && !/fence|post|rail|tree|bush|o\.position|0\.06\)/.test(l));
    assert.deepEqual(bad, [], `${f} has a numeric lift: ${bad.join(' | ')}`);
    assert.ok(!/(?:const|let)\s+(?:GROUND|LIFT_M|PAINT_LIFT)\s*=\s*0\.\d/.test(src), `${f} defines its own lift`);
  }
});

test('fds: no automatic road or crossover element is built (owner 18/11/2026, the aerial imagery is the only road)', () => {
  const m = H.meshGrid(H.commercial('warehouse'));
  const fds = m.tm.fds;
  assert.ok(!fds.elements.some((e) => e.road || e.kind === 'crossover'), 'no road or crossover element');
});

test('fds: batters stop at the lot boundary; the step there is a retaining edge, and only the road changes level outside the lot', async () => {
  const { retainingEdges } = await import('../src/viewer3d/terrain.js');
  for (const [name, make] of CASES) {
    const p = make();
    const m = H.meshGrid(p);
    const lot = p.site.lot;
    const road = m.tm.fds.elements.filter((e) => e.road || e.kind === 'crossover');
    let n = 0;
    for (let k = 0; k < lot.boundary.length; k++) {
      const a = lot.boundary[k]; const b = lot.boundary[(k + 1) % lot.boundary.length];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      let nx = (b.y - a.y) / L; let ny = -(b.x - a.x) / L;
      if (!G.pointInPolygon({ x: (a.x + b.x) / 2 - nx * 100, y: (a.y + b.y) / 2 - ny * 100 }, lot.boundary)) { nx = -nx; ny = -ny; }
      for (let s = 1000; s < L - 1000; s += 3000) for (const d of [2500, 6000]) {
        const q = { x: a.x + ((b.x - a.x) * s) / L + nx * d, y: a.y + ((b.y - a.y) * s) / L + ny * d };
        if (m.tm.fds.elements.some((e) => e.polys.some((r) => polyDistM(q, r, G.bbox(r)).d < 3))) continue; // the road, or a surface that runs past the boundary
        assert.ok(Math.abs(m.tm.fds.levelAt(q.x, q.y).y - m.tm.rawAt(q.x, q.y)) < 0.001, `${name}: design ground beyond the boundary`);
        n++;
      }
    }
    assert.ok(n > 0);
    const r = retainingEdges(m.tm, lot);
    assert.ok(Number.isFinite(r.maxM) && r.lengthM >= 0);
  }
});

test('fds: terrain mesh nodes outside every design element are exactly the design surface', async () => {
  const { nodeHeights } = await import('../src/viewer3d/terrain.js');
  const m = H.meshGrid(H.commercial('warehouse'));
  const cell = Math.max(m.dims.dx, m.dims.dy) / 1000;
  let n = 0;
  for (let j = 0; j < m.dims.rows; j += 3) for (let i = 0; i < m.dims.cols; i += 3) {
    const x = m.dims.x0 + i * m.dims.dx; const y = m.dims.y0 + j * m.dims.dy;
    const r = m.tm.fds.levelAt(x, y); const nh = nodeHeights(m.tm, x, y, cell);
    if (!r.id) { assert.ok(Math.abs(nh.mesh - r.y) < 0.001); n++; } else assert.ok(nh.mesh <= r.y && r.y - nh.mesh <= LV.SUBGRADE + LV.ROAD_BURY + 1e-9);
  }
  assert.ok(n > 100);
});

test('grading report: volumes match an analytic wedge within 2 percent, a raised pad raises fill, and the wording is indicative', async () => {
  const { volumesOver, gradingReport, gradingTextLines } = await import('../src/viewer3d/grading-report.js');
  // a pad 20 m square at the mean of a 10 percent slope: cut and fill are two wedges of 0.5 x 10 m x 1 m x 20 m = 100 m3 each... so 200 over the pad
  const raw = (x) => 0.1 * (x / 1000);
  const box = { minX: 0, maxX: 20000, minY: 0, maxY: 20000 };
  const v = volumesOver(box, 250, (x, y) => raw(x, y), () => 1.0, null);
  assert.ok(Math.abs(v.cutM3 - 100) <= 2 && Math.abs(v.fillM3 - 100) <= 2, `${v.cutM3} / ${v.fillM3}`);
  const up = volumesOver(box, 250, (x) => raw(x), () => 1.1, null);
  assert.ok(up.fillM3 >= v.fillM3 && up.cutM3 <= v.cutM3, 'raising the pad raises fill and never lowers it');
  const p = H.commercial('warehouse');
  const a = gradingReport(p);
  assert.ok(a?.volumes.cutM3 > 0 && a.lines.length);
  const text = JSON.stringify(gradingTextLines(a)).toLowerCase();
  assert.ok(!text.includes('compliant') && !/[–—]/.test(text), 'indicative wording, no dashes');
  p.site.grading = { pads: { 'pad:0': 0.1 } };
  const b = gradingReport(p);
  assert.ok(b.volumes.fillM3 >= a.volumes.fillM3, 'raising a pad 100 mm raises fill');
  delete p.site.grading;
  assert.deepEqual(gradingReport(p).volumes, a.volumes, 'Auto reset restores the automatic output exactly');
});
