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
  await ensureFlowAerial(store, { fetchImpl: async () => { n++; return new Response('x', { status: 500 }); }, retryMs: 1 });
  assert.equal(n, 2);
});
