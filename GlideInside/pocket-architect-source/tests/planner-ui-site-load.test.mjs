// Two live bugs: (1) the lot, aerial and design show without waiting for the slow ground levels, which join later and are requested once;
// (2) the first placed design fits the setbacks of that design when any design can (corner lot, late or stricter setbacks), else "Too big".
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogue } from '../src/catalogue/index.js';
import { migrate, createProject } from '../src/model/schema.js';
import { createStore } from '../src/model/store.js';
import { CONFIG } from '../src/config.js';
import { fetchSite, fetchContours } from '../src/site/client.js';
import { applySiteLookup, addContours } from '../src/site/apply.js';
import { fixtureByState } from '../src/site/fixtures/index.js';
import { envelopeOf } from '../src/model/placement.js';
import { setbackStatusLine } from '../src/site/lot-checks.js';
import { chooseDesign, placeChoice } from '../src/ui/embed-viewer.js';
import { publicDesigns } from '../src/lotcard/designs.js';
import { conadillyProject } from './helpers/conadilly-lot.mjs';

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** A fetch that answers the lot at once, has no aerial, and answers the contours only when `release()` is called. Counts every request. */
function slowSite(originE = null) {
  const fx = fixtureByState('NSW');
  const calls = { lot: 0, aerial: 0, contours: 0 };
  let release;
  const gate = new Promise((r) => { release = r; });
  const fetchImpl = async (url, { signal } = {}) => {
    const u = String(url);
    if (u.includes('/site/lot')) { calls.lot += 1; const l = structuredClone(fx.lot); if (originE != null) l.origin = { ...l.origin, e: originE }; return json(l); }
    if (u.includes('/site/aerial')) { calls.aerial += 1; return new Response('{}', { status: 404 }); }
    if (u.includes('/site/contours')) {
      calls.contours += 1;
      await new Promise((resolve, reject) => { gate.then(resolve); signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
      return json(structuredClone(fx.contours));
    }
    return new Response('{}', { status: 404 });
  };
  return { fetchImpl, calls, release: () => release(), fx };
}
const withLive = async (fn) => { const was = CONFIG.siteMock; CONFIG.siteMock = false; try { return await fn(); } finally { CONFIG.siteMock = was; } };

test('load: the lot is on screen before the slow ground levels arrive, which then join it', async () => {
  await withLive(async () => {
    const s = slowSite();
    const store = createStore(migrate(createProject({ name: 'x' })), { autosaveKey: null, opContext: { catalogue } });
    const t0 = Date.now();
    const { lot } = await applySiteLookup(store, { label: '1 Test Street', state: 'NSW', lon: 150.9, lat: -31.1 }, { fetchImpl: s.fetchImpl });
    assert.ok(Date.now() - t0 < 2000, 'did not wait for the contours');
    assert.ok(store.project.site.lot, 'the lot is on the project');
    assert.equal(store.project.site.lot.contours.length, 0, 'no ground levels yet');
    assert.equal(store.project.site.lot.terrain, null);
    let seen = null;
    store.on('project', (e) => { if (e?.label === 'contours') seen = e; });
    s.release();
    await new Promise((r) => setTimeout(r, 50));
    const cur = store.project.site.lot;
    assert.ok(cur.contours.length > 0, 'contours added when they arrive');
    assert.ok(cur.terrain, 'terrain grid added');
    assert.ok(Number.isFinite(cur.floorRL), 'floor level follows the ground');
    assert.ok(seen, 'the views are told to redraw');
    assert.equal(s.calls.contours, 1);
    assert.ok(lot);
  });
});

test('load: contours are requested once however many searches ask for them', async () => {
  await withLive(async () => {
    const s = slowSite(777);
    const a = await fetchSite({ label: 'a', state: 'NSW', lon: 1, lat: 1 }, { fetchImpl: s.fetchImpl, deferContours: true });
    const b = await fetchSite({ label: 'a', state: 'NSW', lon: 1, lat: 1 }, { fetchImpl: s.fetchImpl, deferContours: true });
    assert.equal(s.calls.contours, 1, 'the identical in flight request is shared');
    s.release();
    const [ra, rb] = await Promise.all([a.contoursPromise, b.contoursPromise]);
    assert.ok(ra && ra === rb);
  });
});

test('load: contours that fail or take too long are dropped silently', async () => {
  await withLive(async () => {
    const s = slowSite();
    const lotResp = structuredClone(s.fx.lot);
    lotResp.origin = { e: 1, n: 1 }; // a different request key from the other tests
    const t0 = Date.now();
    const r = await fetchContours(lotResp, { fetchImpl: s.fetchImpl, timeoutMs: 60 });
    assert.equal(r, null, 'timed out: carried on without them');
    assert.ok(Date.now() - t0 < 1500);
    const failing = async () => new Response('{"code":"X"}', { status: 500 });
    const l2 = structuredClone(s.fx.lot);
    l2.origin = { e: 2, n: 2 };
    assert.equal(await fetchContours(l2, { fetchImpl: failing }), null, 'a failed request is null, never a throw');
  });
});

test('load: late contours for a lot that has been replaced are ignored', () => {
  const store = createStore(migrate(createProject({ name: 'x' })), { autosaveKey: null, opContext: { catalogue } });
  const p = conadillyProject();
  store.apply('lot', (q) => { q.site.lot = p.site.lot; });
  const other = { origin: { e: 9, n: 9 }, lotLabel: 'Lot 9' };
  assert.equal(addContours(store, other, { contours: [], grid: null, minor: 1, major: 5 }), false);
});

// ---- setback fit ------------------------------------------------------------------------------------------------------------------

/** Setbacks that depend on the design, as the council rules do: a second storey needs a wider side setback. */
const sideFor = (project) => (project.levels.length > 1 ? 2.5 : 0.9);
const computeFor = (extra = {}) => async (proj, lot) => {
  const setbacks = { front: 6, secondaryFront: lot.cornerLot ? 3 : null, side: sideFor(proj) + (extra.side || 0), rear: 3, edgeKinds: lot.setbacks?.edgeKinds };
  const poly = envelopeOf({ ...lot, setbacks, envelope: null }).polygon;
  return { setbacks, envelope: poly, key: `k:${setbacks.side}`, attempts: [] };
};
const poolFor = (project) => ({ list: publicDesigns(catalogue, project), own: false, empty: false });
const storeFor = (project) => createStore(project, { autosaveKey: null, opContext: { catalogue } });

test('fit: a corner lot with a second road frontage places a design inside both frontage setbacks', async () => {
  const store = storeFor(conadillyProject({ corner: true }));
  const choice = await chooseDesign(store, poolFor(store.project), null, { compute: computeFor() });
  assert.equal(choice.fits, true);
  placeChoice(store, choice);
  assert.equal(setbackStatusLine(store.project).text, 'Fits the setbacks');
  assert.equal(store.project.placedHouse.tooBig, undefined);
});

test('fit: setbacks that arrive stricter later re-fit the design, trying every design in the pool', async () => {
  const store = storeFor(conadillyProject({ corner: true, envelope: null }));
  const pool = poolFor(store.project);
  const first = await chooseDesign(store, pool, null, { compute: computeFor() });
  placeChoice(store, first);
  assert.equal(setbackStatusLine(store.project).state, 'inside');
  // The council rules arrive with a much wider side setback: the placed design no longer fits, another one (or turn) does.
  const stricter = computeFor({ side: 5.2 });
  const again = await chooseDesign(store, pool, store.ui.placedDesign.id, { compute: stricter });
  assert.equal(again.fits, true, 'something still fits');
  placeChoice(store, again);
  assert.equal(setbackStatusLine(store.project).state, 'inside', `${again.pick.name} sits inside the new setbacks`);
});

test('fit: a narrow lot where nothing fits says "Too big for this block"', async () => {
  const store = storeFor(conadillyProject({ corner: true, width: 6000 }));
  const choice = await chooseDesign(store, poolFor(store.project), null, { compute: computeFor() });
  assert.equal(choice.fits, false);
  placeChoice(store, choice);
  assert.equal(setbackStatusLine(store.project).text, 'Too big for this block');
});
