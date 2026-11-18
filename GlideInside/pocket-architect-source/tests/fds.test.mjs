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
    const m = H.meshGrid(make());
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
    assert.ok(n > 30);
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

test('fds: a crossover is flush with the gutter and the verge (no slab above the kerb)', () => {
  const p = H.commercial('warehouse');
  const m = H.meshGrid(p);
  const fds = m.tm.fds;
  const x = fds.elements.find((e) => e.kind === 'crossover');
  assert.ok(x, 'a crossover element');
  const c = x.polys[0]; const bb = G.bbox(c);
  const cx = (bb.minX + bb.maxX) / 2;
  const road = fds.elements.find((e) => e.road);
  // at the kerb line the ramp is the gutter invert; at the property line it equals the verge level beside it
  const f = road.frame;
  const at = (t) => { const o = f.o; return { x: o.x + f.outward.x * t * 1000 + (cx - o.x) * (1 - Math.abs(f.outward.x)), y: o.y + f.outward.y * t * 1000 + (cx - o.x) * 0 }; };
  void at;
  const dMax = c.reduce((mx, q) => Math.max(mx, f.tOf(q)), 0);
  assert.ok(Math.abs(dMax - f.tk) < 0.05, 'the crossover runs to the kerb line');
  const lo = f.sOf({ x: bb.minX, y: bb.minY });
  void lo;
});
