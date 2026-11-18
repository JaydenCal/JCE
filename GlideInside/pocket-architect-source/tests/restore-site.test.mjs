// A restored project with a lot and no aerial picture asks for the aerial (and ground levels) again, once.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { refreshRestoredSite, watchRestoredSite } from '../src/site/restore-site.js';

const mkLot = (extra = {}) => ({ state: 'NSW', srid: 7856, source: 'nsw', lotLabel: 'Lot 79 DP 707719', address: '39 River Drive, Karabar', origin: { e: 400000, n: 6400000 }, boundary: [{ x: -10000, y: -20000 }, { x: 10000, y: -20000 }, { x: 10000, y: 20000 }, { x: -10000, y: 20000 }], aerial: null, contours: [], terrain: null, layers: { aerial: true }, ...extra });
const mkStore = (lot, id = 'p1') => { const l = {}; return { project: { id, site: { lot } }, emit() {}, on(e, cb) { (l[e] ||= []).push(cb); return () => {}; }, fire(e, d) { (l[e] || []).forEach((cb) => cb(d)); } }; };
const recorder = () => { const urls = []; return { urls, fetchImpl: async (u) => { urls.push(String(u)); return new Response('x', { status: 500 }); } }; };

test('a restored lot with no aerial image requests /site/aerial and the contours once, with the steps shown', async () => {
  const r = recorder();
  const steps = [];
  const store = mkStore(mkLot());
  await refreshRestoredSite(store, { fetchImpl: r.fetchImpl, onStep: (s) => steps.push(s) });
  assert.ok(r.urls.some((u) => u.includes('/site/aerial?')), 'aerial requested');
  assert.ok(r.urls.some((u) => u.includes('/site/contours?')), 'contours requested');
  assert.deepEqual(steps, ['aerial', 'contours']);
  const n = r.urls.length;
  await refreshRestoredSite(store, { fetchImpl: r.fetchImpl });
  assert.equal(r.urls.length, n, 'only once per lot');
});

test('no request for a sample lot, an uploaded boundary, a user supplied aerial or no lot', async () => {
  for (const [i, lot] of [mkLot({ sample: true }), mkLot({ source: 'upload' }), mkLot({ aerial: { userSupplied: true }, contours: [{}] }), null].entries()) {
    const r = recorder();
    await refreshRestoredSite(mkStore(lot, `q${i}`), { fetchImpl: r.fetchImpl });
    assert.equal(r.urls.filter((u) => u.includes('/site/aerial?')).length, 0, `case ${i}`);
  }
});

test('opening a project into the store triggers the refetch; the app wires the watcher', async () => {
  const r = recorder();
  const store = mkStore(null, 'w1');
  watchRestoredSite(store, { fetchImpl: r.fetchImpl });
  store.project.site.lot = mkLot();
  store.fire('project', { label: 'Open project' });
  await new Promise((res) => setTimeout(res, 50));
  assert.ok(r.urls.some((u) => u.includes('/site/aerial?')));
  assert.match(fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8'), /watchRestoredSite\(store\)/);
});
