// A large gently falling lot whose elevation source is stepped (whole or half metre levels) must give a smooth slope, not terraces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { quantStep, smoothTerraces } from '../src/site/contours.js';
import { buildTerrain } from '../src/site/model.js';

// 800 m x 500 m, 2 percent fall to the south-east with a gentle swale, cell 3 m, values stepped to q.
function stepped(q, { cell = 3, w = 800, h = 500, swale = 1.5 } = {}) {
  const cols = Math.round(w / cell) + 1; const rows = Math.round(h / cell) + 1;
  const truth = new Array(cols * rows); const values = new Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = i * cell; const y = j * cell;
    const t = 100 - 0.02 * x - 0.012 * y + swale * Math.sin(x / 140) * Math.cos(y / 110);
    truth[j * cols + i] = t;
    values[j * cols + i] = Math.round(t / q) * q;
  }
  return { grid: { cols, rows, cell, x0: 0, y0: 0, values }, truth };
}

const flatRuns = (v, cols, rows, eps = 1e-3) => {
  // the longest run of consecutive nodes along a row that sit at one height, in nodes
  let worst = 0;
  for (let j = 0; j < rows; j += 5) { let run = 0; for (let i = 1; i < cols; i++) { if (Math.abs(v[j * cols + i] - v[j * cols + i - 1]) < eps) { run++; worst = Math.max(worst, run); } else run = 0; } }
  return worst;
};
const maxJump = (v, cols, rows) => { let m = 0; for (let j = 0; j < rows; j++) for (let i = 1; i < cols; i++) m = Math.max(m, Math.abs(v[j * cols + i] - v[j * cols + i - 1])); return m; };

for (const q of [1, 0.5]) {
  test(`stepped ${q} m source is detected and smoothed`, () => {
    const { grid, truth } = stepped(q);
    assert.equal(quantStep(grid.values), q);
    const before = { run: flatRuns(grid.values, grid.cols, grid.rows), jump: maxJump(grid.values, grid.cols, grid.rows) };
    assert.ok(before.run > 5 && before.jump >= q - 1e-9, 'the input really is terraced');
    const t0 = Date.now();
    const out = smoothTerraces(grid);
    const ms = Date.now() - t0;
    assert.ok(ms < 4000, `smoothing took ${ms} ms`);
    const run = flatRuns(out, grid.cols, grid.rows);
    const jump = maxJump(out, grid.cols, grid.rows);
    assert.ok(run <= 2, `flat run ${run} nodes`);
    assert.ok(jump < 0.2 * q + 0.03 * 3 * 1.5, `largest step between neighbours ${jump}`);
    let err = 0; for (let n = 0; n < out.length; n++) err = Math.max(err, Math.abs(out[n] - truth[n]));
    assert.ok(err < 0.5 * q + 0.05, `max error against the true surface ${err} (largest at the crests and hollows, where a step source holds no detail)`);
    let rms = 0; for (let n = 0; n < out.length; n++) rms += (out[n] - truth[n]) ** 2; rms = Math.sqrt(rms / out.length);
    assert.ok(rms < 0.15 * q, `rms error ${rms}`);
  });
}

test('a smooth (not stepped) grid is left alone', () => {
  const { grid } = stepped(0.001);
  const g = { ...grid, values: grid.values.map((v, n) => v + 0.0137 * Math.sin(n)) };
  assert.equal(quantStep(g.values), 0);
  assert.strictEqual(smoothTerraces(g), g.values);
});

test('buildTerrain smooths a stepped API grid', () => {
  const { grid } = stepped(1, { w: 300, h: 300, swale: 0 });
  const t = buildTerrain({ ...grid, cell: 3 });
  assert.ok(flatRuns(t.values, t.cols, t.rows, 0.011) <= 2);
});
