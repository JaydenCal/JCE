// Steps 3 and 4 fetch the lot's aerial themselves when step 1 left none (same /site/aerial request as the editor), and only say "No aerial for this lot" when that fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lotBboxMga, ensureFlowAerial, NO_AERIAL } from '../src/flow/flow-aerial.js';

const lot = { state: 'NSW', srid: 7856, origin: { e: 400000, n: 6400000 }, boundary: [{ x: -10000, y: -20000 }, { x: 10000, y: -20000 }, { x: 10000, y: 20000 }, { x: -10000, y: 20000 }] };
test('lot box in MGA metres', () => {
  assert.deepEqual(lotBboxMga(lot), { minE: 399990, maxE: 400010, maxN: 6400020, minN: 6399980 });
});
test('no lot, outside NSW/QLD or a failing service: false and never throws', async () => {
  assert.equal(await ensureFlowAerial({ project: { id: 'a', site: {} } }), false);
  assert.equal(await ensureFlowAerial({ project: { id: 'b', site: { lot: { ...lot, state: 'VIC' } } } }), false);
  const failing = { project: { id: 'c', site: { lot: { ...lot } } }, emit() {} };
  assert.equal(await ensureFlowAerial(failing, { fetchImpl: async () => new Response('x', { status: 500 }) }), false);
  assert.equal(NO_AERIAL, 'No aerial for this lot');
});
test('step 3 wiring: fetches when missing, labels, and frames the home by lot area', () => {
  const s = fs.readFileSync(new URL('../src/flow/residential.js', import.meta.url), 'utf8');
  assert.match(s, /ensureFlowAerial\(store\)/);
  assert.match(s, /shoelace\(lot\.boundary\) \/ Math\.max\(shoelace\(hl\), 1\) > 4/);
  assert.match(s, /marginMm = 20000/);
  assert.doesNotMatch(s, /Aerial: none/);
});

import { filterRows } from '../src/flow/res-logic.js';
test('lot width filter tolerates a missing frontage and filters by frontage when present', () => {
  const rows = [{ stats: { bedrooms: 3, storeys: 1 }, frontageM: 10 }, { stats: { bedrooms: 3, storeys: 1 }, frontageM: 14 }, { stats: { bedrooms: 3, storeys: 1 }, frontageM: 20 }, { stats: { bedrooms: 3, storeys: 1 }, frontageM: null }];
  assert.equal(filterRows(rows, {}).length, 4);
  assert.equal(filterRows(rows, { frontage: 12.5 }).length, 2); // 10 m and the unknown
  assert.equal(filterRows(rows, { frontage: 18 }).length, 2); // 20 m and the unknown
});

test('the commercial viewer recovers a missing aerial like the residential flow and uses the chosen suggestion', () => {
  const s = fs.readFileSync(new URL('../src/ui/embed-viewer.js', import.meta.url), 'utf8');
  const fn = s.slice(s.indexOf('export async function loadAddressCommercial'), s.indexOf('export async function loadDemoCommercial'));
  assert.match(fn, /ensureFlowAerial\(store\)/);
  assert.match(fn, /pick: given/);
  assert.match(s, /loadAddressCommercial\(store, address, \{ onStep: null, pick \}\)/);
  const t = fs.readFileSync(new URL('../src/viewer3d/terrain.js', import.meta.url), 'utf8');
  assert.match(t, /realAerial: !!texture \|\| !!\(lot\.aerial\?\.extent/);
});

test('ensureFlowAerial retries the imagery request once before giving up', async () => {
  let n = 0;
  const store = { project: { id: 'r', site: { lot: { ...lot } } }, emit() {} };
  await ensureFlowAerial(store, { fetchImpl: async (u) => { if (String(u).includes('/site/aerial?')) n++; return new Response('x', { status: 500 }); }, retryMs: 1 }); // NSW also tries the tile fallback, which is not an export retry
  assert.equal(n, 2);
});

import { saveImage } from '../src/editor2d/underlay.js';
import { aerialOf } from '../src/flow/lot-map.js';
test('step 3 draws the stored aerial: aerialOf reads the decoded bitmap ({ img, w, h }) and returns a picture with the lot extent', async () => {
  const drawn = [];
  globalThis.createImageBitmap = async () => ({ width: 2048, height: 1024, close() {} });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: (...a) => drawn.push(a) }), toDataURL: () => 'data:image/jpeg;base64,AAAA' }) };
  const key = 'ps.underlay.test.site.1';
  await saveImage(key, new Blob(['x'], { type: 'image/png' }));
  const extent = { x0: -1, y0: -2, x1: 3, y1: 4 };
  const a = await aerialOf({ aerial: { key, extent } });
  assert.ok(a?.href?.startsWith('data:image/jpeg'), 'a stored aerial gives a picture');
  assert.deepEqual(a.extent, extent);
  assert.equal(drawn.length, 1);
  assert.equal(drawn[0][1] + drawn[0][2], 0);
  assert.equal(drawn[0][3], 1024, 'scaled to 1024 px on the long side');
  assert.equal(drawn[0][4], 512);
  assert.equal(await aerialOf({ aerial: { key: 'missing', extent } }), null);
  assert.equal(await aerialOf({ aerial: null }), null);
  delete globalThis.createImageBitmap; delete globalThis.document;
});
