// The viewer opens on a signed in builder or client's OWN first design (it waits for the library), never the generic one.
// An empty library falls back to the generic designs and says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogue } from '../src/catalogue/index.js';
import { migrate, createProject } from '../src/model/schema.js';
import { demoLotResponse } from '../src/site/demo-lot.js';
import { buildSiteLot } from '../src/site/model.js';
import { createStore } from '../src/model/store.js';
import { designPool, placeBestDesign, EMPTY_LIBRARY } from '../src/ui/embed-viewer.js';
import { PUBLIC_TEMPLATE_IDS } from '../src/lotcard/designs.js';

const lotProject = () => {
  const p = migrate(createProject({ name: 'Lot' }));
  p.levels = [];
  p.site.lot = buildSiteLot({ lot: demoLotResponse(), address: '', source: 'sample' });
  p.site.lot.setbacks = { front: 6, side: 0.9, rear: 3 };
  p.site.lot.envelope = [{ x: 1000, y: 6000 }, { x: 23000, y: 6000 }, { x: 23000, y: 42000 }, { x: 1000, y: 42000 }];
  return p;
};
const own = (id, name, tpl) => ({ id, name, group: 'builder', project: migrate(catalogue.createFromTemplate(tpl)) });
const withApp = async (app, fn) => {
  const had = globalThis.window;
  globalThis.window = { __ps: app };
  try { return await fn(); } finally { if (had === undefined) delete globalThis.window; else globalThis.window = had; }
};

test('first design: a signed in viewer waits for the library and places the person\'s own first design', async () => {
  const store = createStore(lotProject(), { autosaveKey: null, opContext: { catalogue } });
  let ready;
  const app = { portalReady: new Promise((r) => { ready = r; }) };
  const placing = withApp(app, () => placeBestDesign(store, catalogue, null));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(store.ui.placedDesign, undefined, 'nothing is placed while the library is still coming in');
  app.lotDesigns = async () => [own('h9', 'Banksia 22', 'house_single'), own('h10', 'Coastal 28', 'house_double')];
  ready({});
  await placing;
  assert.equal(store.ui.placedDesign.id, 'h9', 'the person\'s own design, not a generic one');
  assert.ok(!PUBLIC_TEMPLATE_IDS.includes(store.ui.placedDesign.id));
  assert.equal(store.project.placedHouse.name, 'Banksia 22');
});

test('first design: an empty library falls back to the generic designs and says so', async () => {
  const store = createStore(lotProject(), { autosaveKey: null, opContext: { catalogue } });
  const app = { portalReady: Promise.resolve({}), lotDesigns: async () => [] };
  const pool = await withApp(app, () => designPool(store, catalogue, app));
  assert.equal(pool.empty, true);
  assert.equal(pool.own, false);
  assert.ok(pool.list.length && pool.list.every((d) => PUBLIC_TEMPLATE_IDS.includes(d.id)));
  assert.match(EMPTY_LIBRARY, /not added house designs yet/);
  await withApp(app, () => placeBestDesign(store, catalogue, null));
  assert.ok(PUBLIC_TEMPLATE_IDS.includes(store.ui.placedDesign.id), 'a generic design is placed so the lot is not empty');
});

test('first design: an anonymous visitor gets the generic designs at once', async () => {
  const store = createStore(lotProject(), { autosaveKey: null, opContext: { catalogue } });
  const app = { portalReady: Promise.resolve(null) };
  const pool = await designPool(store, catalogue, app);
  assert.equal(pool.empty, false);
  assert.ok(pool.list.every((d) => PUBLIC_TEMPLATE_IDS.includes(d.id)));
});
