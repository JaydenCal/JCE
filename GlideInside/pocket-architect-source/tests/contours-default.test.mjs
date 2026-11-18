// Contours: refetched on a restored project, on by default in 3D and 2D, labelled readably in 2D.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { refreshRestoredSite } from '../src/site/restore-site.js';
import { layerOn, drawContours } from '../src/editor2d/draw-site.js';

const lot = (extra = {}) => ({ state: 'NSW', srid: 7856, source: 'nsw', lotLabel: 'Lot 1', origin: { e: 400000, n: 6400000 }, boundary: [{ x: -10000, y: -20000 }, { x: 10000, y: -20000 }, { x: 10000, y: 20000 }, { x: -10000, y: 20000 }], aerial: { userSupplied: true }, contours: [], terrain: null, ...extra });
const store = (l, id) => ({ project: { id, site: { lot: l } }, emit() {}, on() { return () => {}; } });

test('a restored lot with empty or missing contours asks /site/contours, even with a terrain grid stored', async () => {
  for (const [i, l] of [lot(), lot({ contours: undefined }), lot({ terrain: { w: 1 } })].entries()) {
    const urls = [];
    await refreshRestoredSite(store(l, `c${i}`), { fetchImpl: async (u) => { urls.push(String(u)); return new Response('x', { status: 500 }); } });
    assert.ok(urls.some((u) => u.includes('/site/contours?')), `case ${i}`);
  }
  const urls = [];
  await refreshRestoredSite(store(lot({ contours: [{ level: 1, pts: [0, 0, 1, 1] }] }), 'has'), { fetchImpl: async (u) => { urls.push(String(u)); return new Response('x', { status: 500 }); } });
  assert.ok(!urls.some((u) => u.includes('/site/contours?')), 'stored contours are not fetched again');
});

test('the contours layer is on unless the person turned it off, including old projects with no layer flags', () => {
  assert.equal(layerOn({ layers: undefined }, 'contours'), true);
  assert.equal(layerOn({ layers: {} }, 'contours'), true);
  assert.equal(layerOn({ layers: { contours: false } }, 'contours'), false);
  assert.match(fs.readFileSync(new URL('../src/viewer3d/viewer.js', import.meta.url), 'utf8'), /const layers = \{ contours: true \}/);
});

test('2D contour RL labels: major lines labelled at 12.5 px, minor lines when long enough on screen', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (_, k) => (k === 'font' ? '' : (...a) => { if (k === 'fillText') calls.push(a[0]); }), set: (_, k, v) => { if (k === 'font') calls.font = v; return true; } });
  const line = (level, major, y) => ({ level, major, closed: false, pts: Array.from({ length: 10 }, (_, i) => [i * 4000, y]).flat() });
  const project = { site: { lot: { layers: {}, contours: [line(397.5, true, 0), line(397.0, false, 3000)] } } };
  drawContours(ctx, { project, view: { scale: 0.05, ox: 50, oy: 200 }, size: { w: 1000, h: 600 }, theme: { c: { canvas: '#fff' }, f: { ui: 'sans' } } });
  assert.ok(calls.includes('397.5'), 'major labelled');
  assert.ok(calls.includes('397.0'), 'minor labelled');
  assert.match(calls.font, /12\.5px/);
});
