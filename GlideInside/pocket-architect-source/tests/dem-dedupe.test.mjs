// The NSW DEM service repeats source rows and columns every ~6 pixels in web mercator; the dedupe step must remove the resulting flat strips.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeRaster, reducedIndex } from '../src/site/dem-dedupe.js';

const PX = 4.29; // ground metres per web pixel
const SRC = 5; // ground metres per source cell
const plane = (x, y) => 300 - 0.02 * y - 0.01 * x; // 2 percent fall to the south, 1 percent to the east (y is south positive)

function regrid(n) {
  const data = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const sx = Math.round((i * PX) / SRC); const sy = Math.round((j * PX) / SRC); // nearest neighbour onto the 5 m source
    data[j * n + i] = plane(sx * SRC, sy * SRC);
  }
  return { width: n, height: n, data };
}

// bilinear sample of a raster at fractional index
function bil(r, fx, fy) {
  const x0 = Math.floor(fx); const y0 = Math.floor(fy); const tx = fx - x0; const ty = fy - y0;
  const at = (x, y) => r.data[Math.min(r.height - 1, Math.max(0, y)) * r.width + Math.min(r.width - 1, Math.max(0, x))];
  return at(x0, y0) * (1 - tx) * (1 - ty) + at(x0 + 1, y0) * tx * (1 - ty) + at(x0, y0 + 1) * (1 - tx) * ty + at(x0 + 1, y0 + 1) * tx * ty;
}

test('periodic duplicate rows and columns are collapsed and the profile has no flat run', () => {
  const n = 240;
  const r = regrid(n);
  const d = dedupeRaster(r, -9999);
  assert.ok(d.changed);
  assert.ok(d.height < n && d.width < n, 'duplicates were removed');
  // resample at 5 m ground spacing down a north-south profile and along an east-west profile
  const prof = []; const prof2 = []; let sq = 0; let cnt = 0;
  const maxG = (n - 6) * PX;
  for (let g = 20; g < maxG; g += SRC) {
    const p = g / PX;
    const z = bil(d, reducedIndex(d.xs, 100), reducedIndex(d.ys, p));
    const z2 = bil(d, reducedIndex(d.xs, p), reducedIndex(d.ys, 100));
    prof.push(z); prof2.push(z2);
    sq += (z - plane(100 * PX, g)) ** 2 + (z2 - plane(g, 100 * PX)) ** 2; cnt += 2;
  }
  const check = (v, label) => {
    const diffs = v.slice(1).map((a, i) => Math.abs(a - v[i]));
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const flat = diffs.filter((x) => x < 0.1 * mean).length;
    assert.equal(flat, 0, `${label}: ${flat} flat steps (mean diff ${mean.toFixed(3)})`);
  };
  check(prof, 'north-south'); check(prof2, 'east-west');
  const rms = Math.sqrt(sq / cnt);
  assert.ok(rms < 0.03, `RMS error ${rms.toFixed(4)} m`);
  // and the raw raster really did have flat strips
  const raw = []; for (let j = 4; j < n - 4; j++) raw.push(r.data[j * n + 100]);
  assert.ok(raw.slice(1).some((a, i) => Math.abs(a - raw[i]) < 1e-6), 'input is terraced');
});

test('a raster without duplicates passes through unchanged', () => {
  const w = 40; const h = 30; const data = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = 50 + i * 0.37 + j * 0.51 + Math.sin(i * j);
  const d = dedupeRaster({ width: w, height: h, data }, null);
  assert.equal(d.changed, false);
  assert.equal(d.data, data);
  assert.deepEqual(d.xs, Array.from({ length: w }, (_, i) => i));
  assert.equal(reducedIndex(d.xs, 7.25), 7.25);
});

test('a genuinely flat raster is left alone', () => {
  const d = dedupeRaster({ width: 20, height: 20, data: new Float32Array(400).fill(12.5) }, null);
  assert.equal(d.changed, false);
});

test('reducedIndex interpolates between run centres', () => {
  assert.equal(reducedIndex([0, 1.5, 3, 4.5], 2.25), 1.5);
  assert.equal(reducedIndex([0, 1.5, 3, 4.5], 0.75), 0.5);
});
