// Bring your own aerial (file route): a generated georeferenced sample picture lands on the right lot pixels; nothing is uploaded; Nearmap is not offered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseWorldFile, placeOnLot, similarityFromPairs, crsChoices, classifyFiles } from '../src/site/own-aerial.js';

const lot = { zone: 56, origin: { e: 500000, n: 6400000 }, boundary: [{ x: 0, y: 0 }, { x: 20000, y: 0 }, { x: 20000, y: 30000 }, { x: 0, y: 30000 }] };
// 800 x 800 picture at 0.25 m a pixel, top left at E 499900, N 6400100. Red is the column and green the row, so every pixel says where it is.
const W = 800;
const data = new Uint8ClampedArray(W * W * 4);
for (let r = 0; r < W; r++) for (let c = 0; c < W; c++) { const i = (r * W + c) * 4; data[i] = Math.round((c * 255) / W); data[i + 1] = Math.round((r * 255) / W); data[i + 2] = 40; data[i + 3] = 255; }
const src = { width: W, height: W, data };
const px = (res, x, y) => { const cx = Math.round((x - res.extent.x0) / res.mmPerPx); const cy = Math.round((y - res.extent.y0) / res.mmPerPx); const i = (cy * res.outW + cx) * 4; return [res.rgba[i], res.rgba[i + 1]]; };

test('world file and MGA zone: the lot centre shows the picture pixels that sit over it', () => {
  const affine = parseWorldFile('0.25\n0\n0\n-0.25\n499900.125\n6400099.875');
  const ids = crsChoices().map((c) => c.id);
  assert.ok(ids.includes('mga2020:56') && ids.includes('mga94:56') && ids.includes('webmerc'));
  const res = placeOnLot({ lot, src, how: { kind: 'georef', affine, crsId: 'mga2020:56' } });
  // plan (10000, 15000) is E 500010, N 6399985: column 440, row 460
  const [r, g] = px(res, 10000, 15000);
  assert.ok(Math.abs(r - (440 * 255) / W) < 4, `red ${r}`);
  assert.ok(Math.abs(g - (460 * 255) / W) < 4, `green ${g}`);
});

test('a picture that does not cover the lot is refused with a readable message', () => {
  const affine = parseWorldFile('0.25\n0\n0\n-0.25\n510000\n6410000');
  assert.throws(() => placeOnLot({ lot, src, how: { kind: 'georef', affine, crsId: 'mga2020:56' } }), /does not cover your lot/);
});

test('two control points on lot corners fit a plain picture', () => {
  // The same picture, but with no geo data: pin picture (400,600) on corner 0 and picture (800-?) on corner 2.
  const img = [{ x: 400, y: 400 }, { x: 480, y: 520 }];
  const plan = [{ x: 0, y: 0 }, { x: 20000, y: 30000 }];
  const sim = similarityFromPairs(img, plan);
  assert.ok(Math.abs(sim.scale - 250) < 1, String(sim.scale));
  const [x, y] = sim.to(440, 460);
  assert.ok(Math.abs(x - 10000) < 5 && Math.abs(y - 15000) < 5);
  const res = placeOnLot({ lot, src, how: { kind: 'points', img, plan } });
  const [r, g] = px(res, 10000, 15000);
  assert.ok(Math.abs(r - (440 * 255) / W) < 4 && Math.abs(g - (460 * 255) / W) < 4);
});

test('files are classified as picture and world file', () => {
  const f = (name) => ({ name, type: '' });
  const c = classifyFiles([f('site.jpg'), f('site.jgw')]);
  assert.ok(c.image && c.world);
  assert.equal(classifyFiles([f('site.tif')]).kind, 'tiff');
});

test('the file route stays in the browser and the Nearmap key route is not offered', () => {
  const own = readFileSync(new URL('../src/site/own-aerial.js', import.meta.url), 'utf8');
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon/.test(own), 'own-aerial.js must not send anything');
  const ui = readFileSync(new URL('../src/ui/aerial-source.js', import.meta.url), 'utf8');
  assert.match(ui, /filter\(\(\[id\]\) => id !== 'nearmap'\)/);
  assert.match(ui, /never uploaded to our server/);
  assert.match(ui, /hold the rights to this imagery/);
  assert.match(readFileSync(new URL('../src/flow/residential.js', import.meta.url), 'utf8'), /createAerialSourceButton/);
  assert.match(readFileSync(new URL('../src/app.js', import.meta.url), 'utf8'), /createAerialSourceButton/);
});
