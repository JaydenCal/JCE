// Council quotes never show an en dash: loaded data, computed setbacks and the displayed or printed citation text are cleaned.
import test from 'node:test';
import assert from 'node:assert/strict';
import { plainDashes, plainDeep } from '../src/site/plain-text.js';
import { loadRuleSet, clearSetbackCache } from '../src/site/setback-data.js';

test('plainDashes turns en dash, em dash and minus into a hyphen and leaves other text', () => {
  assert.equal(plainDashes('LSM –AA1 and 3–4 m — rear −1'), 'LSM -AA1 and 3-4 m - rear -1');
  assert.equal(plainDashes(null), null);
  assert.deepEqual(plainDeep({ a: ['x–y', { b: 'p—q' }], n: 3 }), { a: ['x-y', { b: 'p-q' }], n: 3 });
});

test('council data is cleaned as it loads', async () => {
  clearSetbackCache();
  const files = {
    'fallbacks.json': { sets: [] },
    'index.json': { councils: [{ lga: 'TAMWORTH REGIONAL', lga_slug: 'tamworth-regional-council', name: 'Tamworth Regional Council' }] },
    'tamworth-regional-council.json': { rules: [{ id: 'r1', quote: 'zone LSM –AA1 setback' }] },
  };
  const fetchImpl = async (url) => { const f = Object.keys(files).find((k) => String(url).endsWith(k)); return { ok: !!f, status: f ? 200 : 404, json: async () => files[f] }; };
  const set = await loadRuleSet({ state: 'NSW', lga: 'TAMWORTH REGIONAL' }, { fetchImpl, base: 'http://x/data/setbacks/' });
  assert.equal(set.councils[0].rules[0].quote, 'zone LSM -AA1 setback');
  clearSetbackCache();
});
