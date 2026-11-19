// Plan view wide aerial: the lower resolution outer tile (site.lot.aerialWide) is drawn under the sharp inner underlay so zooming out shows
// photograph, not blank grid. Same rules as the 3D view: aerial layer on, surrounds the sharp tile, never beside the person's own aerial.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { catalogue } from '../src/catalogue/index.js';
import { migrate } from '../src/model/schema.js';
import { FIXTURES } from '../src/site/fixtures/index.js';
import { buildSiteLot, underlayFor } from '../src/site/model.js';
import { drawWideAerial, drawUnderlay, wideAerialExtent } from '../src/editor2d/draw-plan.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const f = FIXTURES[0];
// The fixtures carry only the sharp aerial: make the wide one by growing its box by 250 m a side at a quarter of the resolution.
const wideMeta = { ...f.aerial, mmPerPx: f.aerial.mmPerPx * 4, bbox: { minE: f.aerial.bbox.minE - 250, minN: f.aerial.bbox.minN - 250, maxE: f.aerial.bbox.maxE + 250, maxN: f.aerial.bbox.maxN + 250 } };
function project({ wide = true } = {}) {
  const p = migrate(catalogue.createFromTemplate('house_single'));
  const lot = buildSiteLot({ lot: f.lot, aerialMeta: f.aerial, aerialKey: 'k1', aerialWideMeta: wide ? wideMeta : null, aerialWideKey: wide ? 'k1.wide' : null, contours: f.contours, address: f.search[0].label, source: 'sample' });
  p.site.lot = lot;
  p.site.underlay = underlayFor(lot);
  return p;
}
// A recording 2d context: enough of the canvas API for the two draw functions.
function rec() {
  const calls = [];
  const ctx = new Proxy({}, { get: (_, k) => (k === 'calls' ? calls : (...a) => { calls.push([String(k), ...a]); }), set: (_, k, v) => { calls.push(['set:' + String(k), v]); return true; } });
  return ctx;
}
const bmp = (w, h) => ({ img: { id: `${w}x${h}` }, w, h });
const st = (p, scale = 0.002, extra = {}) => ({ project: p, view: { scale, ox: 400, oy: 300 }, size: { w: 800, h: 600 }, theme: { c: {} }, tool: 'select', underlayBitmap: bmp(1000, 1000), wideBitmap: bmp(512, 512), ...extra });
const draws = (ctx) => ctx.calls.filter((c) => c[0] === 'drawImage');

test('the fixture lot carries a wide aerial that surrounds the sharp one', () => {
  const p = project();
  assert.ok(p.site.lot.aerialWide?.key && p.site.lot.aerialWide.extent, 'fixture has aerialWide');
  assert.ok(wideAerialExtent(p));
  const w = p.site.lot.aerialWide.extent; const a = p.site.lot.aerial.extent;
  assert.ok(w.x0 <= a.x0 && w.y0 <= a.y0 && w.x1 >= a.x1 && w.y1 >= a.y1);
});

test('the wide aerial is drawn once, fitted to its extent, with the sharp tile cut out and before the inner underlay', () => {
  const p = project();
  const c = rec();
  assert.equal(drawWideAerial(c, st(p)), true);
  const d = draws(c);
  assert.equal(d.length, 1);
  const w = p.site.lot.aerialWide.extent;
  const [, , x, y, wd, ht] = d[0];
  assert.ok(Math.abs(x - (w.x0 * 0.002 + 400)) < 1e-6 && Math.abs(y - (w.y0 * 0.002 + 300)) < 1e-6);
  assert.ok(Math.abs(wd - (w.x1 - w.x0) * 0.002) < 1e-6 && Math.abs(ht - (w.y1 - w.y0) * 0.002) < 1e-6);
  assert.ok(c.calls.some((q) => q[0] === 'clip' && q[1] === 'evenodd'), 'inner tile cut out so it is not laid over a second layer of photograph');
  // drawn under the inner underlay in the editor
  const ed = read('../src/editor2d/editor.js');
  assert.ok(ed.indexOf('drawWideAerial(ctx, st)') > ed.indexOf('drawGrid(ctx, st)') && ed.indexOf('drawWideAerial(ctx, st)') < ed.indexOf('drawUnderlay(ctx, st)'));
});

test('it fills the plan outside the inner tile when zoomed out, so no blank grid remains inside the wide extent', () => {
  const p = project();
  const w = p.site.lot.aerialWide.extent; const a = p.site.lot.aerial.extent;
  assert.ok(w.x1 - w.x0 > a.x1 - a.x0, 'wide covers more ground');
  const c = rec();
  drawUnderlay(c, st(p, 0.002)); // the inner underlay on its own
  drawWideAerial(c, st(p, 0.002));
  assert.equal(draws(c).length, 2);
});

test('the aerial layer toggle hides both', () => {
  const p = project();
  p.site.lot.layers.aerial = false;
  const c = rec();
  assert.equal(drawWideAerial(c, st(p)), false);
  drawUnderlay(c, st(p));
  assert.equal(draws(c).length, 0);
});

test('nothing is drawn without a bitmap yet (async load), without aerialWide, or with the person own aerial', () => {
  const p = project();
  let c = rec();
  assert.equal(drawWideAerial(c, st(p, 0.002, { wideBitmap: null })), false, 'bitmap still loading: first paint is not blocked');
  assert.equal(draws(c).length, 0);
  assert.equal(wideAerialExtent(project({ wide: false })), null);
  const own = project();
  own.site.lot.aerial.userSupplied = true; // own-aerial.js also clears lot.aerialWide
  assert.equal(wideAerialExtent(own), null);
  const cleared = project();
  cleared.site.lot.aerialWide = null;
  assert.equal(wideAerialExtent(cleared), null);
  const noUnder = project();
  noUnder.site.underlay = null;
  assert.equal(wideAerialExtent(noUnder), null);
});

test('a wide extent that does not surround the sharp tile is ignored, as in the 3D view', () => {
  const p = project();
  const a = p.site.lot.aerial.extent;
  p.site.lot.aerialWide.extent = { x0: a.x0 + 1000, y0: a.y0, x1: a.x1, y1: a.y1 };
  assert.equal(wideAerialExtent(p), null);
});

test('the editor loads the wide bitmap from the underlay store asynchronously and redraws; plan set exporters do not use the editor draw code', () => {
  const ed = read('../src/editor2d/editor.js');
  assert.match(ed, /function syncWide\(\)[\s\S]*loadBitmap\(key\)\.then[\s\S]*requestDraw\(\)/);
  assert.match(ed, /wideBitmap: state\.wideBitmap/);
  for (const file of ['../src/premium/exporters/planset/index.js', '../src/premium/exporters/planset/locality.js']) assert.doesNotMatch(read(file), /drawWideAerial|draw-plan/);
});
