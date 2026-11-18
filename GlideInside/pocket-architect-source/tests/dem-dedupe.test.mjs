// The NSW DEM service repeats a source cell every ~7 pixels in web mercator, along lines slanted by grid convergence. The per pixel run repair must remove the flat pairs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dedupeRaster, reconstructLine } from '../src/site/dem-dedupe.js';

const PX = 4.29; // ground metres per web pixel
const SRC = 5; // ground metres per source cell
const ROT = (1 * Math.PI) / 180; // source grid rotated 1 degree against web mercator
const plane = (x, y) => 300 - 0.02 * y - 0.01 * x; // MGA-like frame, y south positive: 2 percent fall south, 1 percent east
const toMga = (x, y) => ({ x: x * Math.cos(ROT) - y * Math.sin(ROT), y: x * Math.sin(ROT) + y * Math.cos(ROT) });

function regrid(n) {
  const data = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const m = toMga(i * PX, j * PX);
    data[j * n + i] = plane(Math.round(m.x / SRC) * SRC, Math.round(m.y / SRC) * SRC); // nearest neighbour onto the rotated 5 m source
  }
  return { width: n, height: n, data };
}

function bil(r, fx, fy) {
  const x0 = Math.floor(fx); const y0 = Math.floor(fy); const tx = fx - x0; const ty = fy - y0;
  const at = (x, y) => r.data[Math.min(r.height - 1, Math.max(0, y)) * r.width + Math.min(r.width - 1, Math.max(0, x))];
  return at(x0, y0) * (1 - tx) * (1 - ty) + at(x0 + 1, y0) * tx * (1 - ty) + at(x0, y0 + 1) * (1 - tx) * ty + at(x0 + 1, y0 + 1) * tx * ty;
}

const flatPairs = (v) => {
  const diffs = v.slice(1).map((a, i) => Math.abs(a - v[i]));
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  return { flat: diffs.filter((x) => x < 0.15 * mean).length, mean };
};

test('slanted periodic duplicates on a rotated source grid are repaired', () => {
  const n = 260;
  const r = regrid(n);
  const d = dedupeRaster(r, -9999);
  assert.ok(d.changed);
  assert.equal(d.data.length, r.data.length);
  const prof = []; const prof2 = []; const rawProf = []; let sq = 0; let cnt = 0;
  const lo = 12; const hi = (n - 12) * PX;
  for (let g = lo * PX; g < hi; g += 2.5) { // 2.5 m output cell
    const p = g / PX;
    const z = bil(d, 100, p); const z2 = bil(d, p, 100);
    prof.push(z); prof2.push(z2); rawProf.push(bil(r, 100, p));
    const t1 = toMga(100 * PX, g); const t2 = toMga(g, 100 * PX);
    sq += (z - plane(t1.x, t1.y)) ** 2 + (z2 - plane(t2.x, t2.y)) ** 2; cnt += 2;
  }
  const before = flatPairs(rawProf).flat;
  const a = flatPairs(prof); const b = flatPairs(prof2);
  console.log(`synthetic flat pairs before ${before}, after N-S ${a.flat}, E-W ${b.flat}; RMS ${Math.sqrt(sq / cnt).toFixed(4)} m`);
  assert.ok(before > 3, 'input has flat pairs');
  // a profile that crosses a rotated source row boundary can keep one near flat step (a ~3 mm reversal), so allow at most one per axis (34 before)
  assert.ok(a.flat <= 1, `north-south flat pairs ${a.flat}`);
  assert.ok(b.flat <= 1, `east-west flat pairs ${b.flat}`);
  const rms = Math.sqrt(sq / cnt);
  assert.ok(rms < 0.03, `RMS error ${rms.toFixed(4)} m`);
});

test('a raster without duplicates passes through unchanged', () => {
  const w = 40; const h = 30; const data = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = 50 + i * 0.37 + j * 0.51 + Math.sin(i * j * 0.7 + 0.3);
  const d = dedupeRaster({ width: w, height: h, data }, null);
  assert.equal(d.changed, false);
  assert.equal(d.data, data);
});

test('a genuinely flat raster and long flat runs are left alone', () => {
  const d = dedupeRaster({ width: 20, height: 20, data: new Float32Array(400).fill(12.5) }, null);
  assert.equal(d.changed, false);
  const line = [1, 2, 3, 3, 3, 3, 3, 3, 4, 5];
  const res = reconstructLine(line);
  assert.deepEqual(res.out, line);
});

test('nodata cells stay nodata and are not interpolated across', () => {
  const line = [1, 1.5, 1.5, 2, -9999, 5, 5, 6];
  const res = reconstructLine(line, line, -9999);
  assert.equal(res.out[4], -9999);
  assert.ok(Math.abs(res.out[1] - 1.5) < 1e-9 || res.out[1] > 1);
  assert.ok(res.out[5] < 5.5 && res.out[5] > 4.9);
});

test('real profile, 756 Quia Road: flat pairs before and after', () => {
  const text = fs.existsSync('/home/claude/terrain-real/quia-col-profile.txt') ? fs.readFileSync('/home/claude/terrain-real/quia-col-profile.txt', 'utf8') : null;
  if (!text) return;
  const lines = text.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  let before = 0; let after = 0; let total = 0;
  for (const l of lines) {
    const v = l.trim().split(/\s+/).map(Number);
    const res = reconstructLine(v);
    const pairs = (a) => a.slice(1).filter((x, i) => Math.abs(x - a[i]) < 1e-6).length;
    before += pairs(v); after += pairs(res.out); total += v.length - 1;
  }
  console.log(`real profile: ${total} steps, flat pairs before ${before} (one per ${(total / before).toFixed(1)}), after ${after}`);
  assert.ok(before >= 8);
  // the 4 pixel run 288.96 x4 is genuine flat ground (longer than 3) and is deliberately kept: 3 flat steps remain
  assert.ok(after <= 3 && after < before / 5, `flat pairs after ${after}`);
});
