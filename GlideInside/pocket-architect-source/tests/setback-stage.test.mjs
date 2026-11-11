// Setback stage: per-council static files, design heights, and the computed result on a lot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadRuleSet, clearSetbackCache } from '../src/site/setback-data.js';
import { computeSetbacks, designHeights, setbackInputsFor } from '../src/site/setback-stage.js';

const dir = fileURLToPath(new URL('../../website-live/plan-studio/data/setbacks/', import.meta.url));
const have = existsSync(dir + 'index.json');
const fetchImpl = async (url) => {
  const f = dir + decodeURIComponent(String(url).split('/').pop());
  return existsSync(f) ? { ok: true, status: 200, json: async () => JSON.parse(readFileSync(f, 'utf8')) } : { ok: false, status: 404, json: async () => ({}) };
};
const sq = (w, d) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }];
const lot = (over) => ({ state: 'NSW', lga: 'TAMWORTH REGIONAL', boundary: sq(15000, 40000), frontEdges: [0], frontageConfirmed: true, areaM2: 600, zoning: { code: 'R2' }, origin: { e: 1, n: 2 }, lotLabel: 'Lot 1', ...over });
const wall = (x1, y1, x2, y2) => ({ a: { x: x1, y: y1 }, b: { x: x2, y: y2 } });
const project = { levels: [{ elevation: 0, height: 2550, walls: [wall(0, 0, 10000, 0), wall(10000, 0, 10000, 8000), wall(10000, 8000, 0, 8000), wall(0, 8000, 0, 0)], roof: { enabled: true, type: 'hip', pitch: 22.5 } }] };

test('setback files: one file per council, an index and the fallbacks', { skip: !have }, async () => {
  clearSetbackCache();
  const rs = await loadRuleSet(lot(), { fetchImpl, base: 'http://x/data/setbacks/' });
  assert.equal(rs.councils.length, 1);
  assert.equal(rs.councils[0].lga_slug, 'tamworth-regional-council');
  assert.deepEqual(Object.keys(rs.fallbacks).sort(), ['NSW', 'NSW_INLAND', 'QLD']);
  const q = await loadRuleSet(lot({ state: 'QLD', lga: 'Townsville City' }), { fetchImpl, base: 'http://x/data/setbacks/' });
  assert.equal(q.councils.length, 0);
});

test('design heights come from the drawn walls and roof', () => {
  const h = designHeights(project);
  assert.equal(h.storeys, 1);
  assert.equal(h.wallHeightM, 2.55);
  assert.ok(h.buildingHeightM > 3.5 && h.buildingHeightM < 4.5, String(h.buildingHeightM));
  assert.equal(designHeights({ levels: [{ walls: [] }] }), null);
  assert.equal(setbackInputsFor(project, { setbackInputs: { buildingHeightM: 5 } }).buildingHeightM, 5);
});

test('computeSetbacks: Tamworth lot gets a basis, a source and an envelope; errors never throw', { skip: !have }, async () => {
  clearSetbackCache();
  const r = await computeSetbacks(project, lot(), { fetchImpl, base: 'http://x/data/setbacks/' });
  assert.ok(r.setbacks, JSON.stringify(r.attempts).slice(0, 300));
  assert.match(r.setbacks.basis, /Council DCP|Inland Code/);
  assert.ok(r.setbacks.source);
  assert.ok(Array.isArray(r.envelope) && r.envelope.length >= 3);
  clearSetbackCache();
  const bad = await computeSetbacks(project, lot(), { fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }), base: 'http://x/data/setbacks/' });
  assert.equal(bad.setbacks, null);
  assert.ok(bad.error);
});
