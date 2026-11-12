// Review fixes for the lot viewer: a signed in builder or client gets their own designs (and the builder name) in the viewer layout, the
// design list is cached per session, the editor handoff never overwrites the visitor's autosave, and the wiring of the other fixes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogue } from '../src/catalogue/index.js';
import { migrate, createProject } from '../src/model/schema.js';
import { demoLotResponse } from '../src/site/demo-lot.js';
import { buildSiteLot } from '../src/site/model.js';
import { designsFor } from '../src/lotcard/designs.js';
import { createDesignSource } from '../src/portal/design-source.js';
import { initPortalViewer } from '../src/portal/viewer-mode.js';
import { takeHandoff, HANDOFF_KEY } from '../src/ui/embed-viewer.js';
import { CONFIG } from '../src/config.js';

const emptyLot = () => {
  const p = migrate(createProject({ name: 'Lot' }));
  p.levels = [];
  p.site.lot = buildSiteLot({ lot: demoLotResponse(), address: '', source: 'sample' });
  p.site.lot.setbacks = { front: 6, side: 0.9, rear: 3 };
  p.site.lot.envelope = null;
  return p;
};
const library = (id) => migrate(catalogue.createFromTemplate(id));
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const fakeApi = ({ me, houses = [], glide = [] } = {}) => {
  const calls = { listHouses: 0, getHouse: 0, listGlideLibrary: 0 };
  return {
    calls,
    me: async () => { if (!me) throw new Error('not signed in'); return me; },
    listHouses: async () => { calls.listHouses += 1; return houses.map((x) => ({ id: x.id, name: x.name })); },
    getHouse: async (id) => { calls.getHouse += 1; return { project: houses.find((x) => x.id === id).project }; },
    listGlideLibrary: async () => { calls.listGlideLibrary += 1; return glide.map((x) => ({ id: x.id, name: x.name })); },
    getGlideModel: async (id) => ({ project: glide.find((x) => x.id === id).project }),
  };
};
const orgMe = (role = 'staff', extra = {}) => ({ user: { id: 'u1', role, name: 'U' }, org: { name: 'Own Builder Pty', branding: { displayName: 'Own Builder' }, ...extra } });
const ownHouses = () => [{ id: 'h1', name: 'Own One', project: library('house_single') }, { id: 'h2', name: 'Own Two', project: library('house_double') }];

test('signed in: the design source fetches the library once and re-ranks it on every lot change', async () => {
  const api = fakeApi({ me: orgMe(), houses: ownHouses() });
  const src = createDesignSource({ api, me: orgMe(), clientLike: false });
  const a = emptyLot();
  const b = emptyLot();
  b.site.lot.lotLabel = 'Lot 9';
  await src.lotDesigns(a);
  await src.lotDesigns(b);
  await src.lotDesigns(a);
  assert.equal(api.calls.listHouses, 1, 'listHouses once for the session');
  assert.equal(api.calls.getHouse, 2, 'each house fetched once');
  src.invalidate();
  await src.lotDesigns(a);
  assert.equal(api.calls.listHouses, 2, 'a save to the library invalidates the cache');
});

test('signed in: the viewer gets the organisation designs and the builder name, anonymous stays generic', async () => {
  const was = CONFIG.portalEnabled;
  CONFIG.portalEnabled = true;
  try {
    const api = fakeApi({ me: orgMe('client', { showGlideToClients: false }), houses: ownHouses(), glide: [{ id: 'g1', name: 'Glide Generic', project: library('house_single') }] });
    const app = {};
    const r = await initPortalViewer(app, { api });
    assert.ok(r, 'a portal session is picked up in the viewer');
    assert.equal(app.builder.name, 'Own Builder', 'the builder name feeds the card line and the PDF watermark');
    const list = await designsFor({ catalogue, project: emptyLot(), provider: app.lotDesigns });
    assert.deepEqual(list.map((d) => d.id).sort(), ['h1', 'h2'], 'only the organisation library, no Glide or public designs');
    assert.equal(api.calls.listGlideLibrary, 0, 'a client does not even load the Glide library');

    const anon = {};
    assert.equal(await initPortalViewer(anon, { api: fakeApi({ me: null }) }), null);
    assert.equal(anon.lotDesigns, undefined, 'no provider: the public viewer uses the generic samples');
    assert.equal(anon.builder, undefined, 'no builder name without a login');
  } finally { CONFIG.portalEnabled = was; }
});

const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), has: (k) => m.has(k), keys: () => [...m.keys()] };
};

test('handoff: the editor reads the viewer design once, clears it and never overwrites the visitor autosave', () => {
  const mine = library('house_single');
  mine.name = 'My earlier plan';
  const handed = library('house_double');
  handed.name = 'From the viewer';
  const st = memStorage({
    [CONFIG.autosaveKey]: JSON.stringify(mine),
    [HANDOFF_KEY]: JSON.stringify({ at: Date.now(), project: handed }),
  });
  const r = takeHandoff(st);
  assert.equal(r.project.name, 'From the viewer');
  assert.equal(r.previous.name, 'My earlier plan', 'the earlier design is handed back so it can be offered');
  assert.equal(st.has(HANDOFF_KEY), false, 'one shot: cleared after reading');
  assert.equal(JSON.parse(st.getItem(CONFIG.autosaveKey)).name, 'My earlier plan', 'the autosave slot is untouched');
  assert.ok(st.keys().some((k) => k !== CONFIG.autosaveKey && JSON.parse(st.getItem(k)).name === 'My earlier plan'), 'and kept as a backup');
  assert.equal(takeHandoff(st), null, 'a second read finds nothing');
  const stale = memStorage({ [HANDOFF_KEY]: JSON.stringify({ at: Date.now() - 3600e3, project: handed }) });
  assert.equal(takeHandoff(stale), null, 'a stale handoff is ignored');
  assert.equal(stale.has(HANDOFF_KEY), false);
  const none = memStorage({ [HANDOFF_KEY]: JSON.stringify({ at: Date.now(), project: handed }) });
  assert.equal(takeHandoff(none).previous, null, 'no earlier design: nothing to keep');
});

test('viewer wiring (review fixes): no double download, one PDF row, search feedback, top view label, deferred step', () => {
  const lc = read('../src/lotcard/lot-card.js');
  const ev = read('../src/ui/embed-viewer.js');
  const app = read('../src/app.js');
  assert.match(lc, /exportPlanSet\(\{[^}]*download: false/, 'the exporter must not download as well');
  assert.match(lc, /Enlarge top view/);
  assert.match(lc, /Shrink top view/);
  assert.match(lc, /lc-links/);
  assert.match(lc, /requestAnimationFrame\(\(\) => setTimeout\(run/, 'poseFor runs a frame later');
  assert.match(lc, /Placing design/);
  assert.match(ev, /if \(notify\) toast\(message/, 'a failed pill search is shown in the viewer');
  assert.match(app, /initPortalViewer/, 'portal session in the viewer');
  assert.doesNotMatch(ev, /setItem\(CONFIG\.autosaveKey/, 'the viewer never writes the visitor autosave');
});
