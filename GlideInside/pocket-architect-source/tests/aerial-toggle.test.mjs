// Aerial on/off: the remembered choice, the builder default, one undo step, new lots, PDF export option, builder portal setting, wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { jsPDF } from 'jspdf';
import { catalogue } from '../src/catalogue/index.js';
import { migrate } from '../src/model/schema.js';
import { createStore } from '../src/model/store.js';
import { FIXTURES } from '../src/site/fixtures/index.js';
import { buildSiteLot } from '../src/site/model.js';
import { aerialOn, hasAerial, setAerial, setAerialDefault, initialAerial, readAerialChoice, writeAerialChoice, clearAerialChoice, withoutAerial, aerialDefault } from '../src/site/aerial-pref.js';
import { exportPayload } from '../src/premium/export-client.js';
import { aerialLabel } from '../src/ui/aerial-toggle.js';
import { createMockApi, memoryStorage, DEMO_LOGINS } from '../src/portal/mock-api.js';
import { exportPlanSet } from '../src/premium/exporters/planset/index.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const withStorage = async (ls, fn) => {
  const d = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true });
  try { await fn(); } finally { if (d) Object.defineProperty(globalThis, 'localStorage', d); else delete globalThis.localStorage; }
};
const lotProject = () => {
  const p = migrate(catalogue.createFromTemplate('house_single'));
  const f = FIXTURES[0];
  p.site.lot = buildSiteLot({ lot: f.lot, aerialMeta: f.aerial, aerialKey: 'k1', contours: f.contours, address: f.search[0].label, source: 'sample' });
  return p;
};

test('remembered choice: stored per browser, read back, and a blocked or throwing storage never breaks anything', async () => {
  await withStorage(mem(), () => {
    assert.equal(readAerialChoice(), null);
    writeAerialChoice(false);
    assert.equal(readAerialChoice(), false);
    writeAerialChoice(true);
    assert.equal(readAerialChoice(), true);
    clearAerialChoice();
    assert.equal(readAerialChoice(), null);
  });
  const bad = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  await withStorage(bad, () => {
    assert.equal(readAerialChoice(), null);
    assert.doesNotThrow(() => writeAerialChoice(false));
    assert.equal(initialAerial(), aerialDefault());
  });
  assert.equal(readAerialChoice(), null, 'no storage at all (node): null, not a throw');
});

test('builder default: on unless the builder turns it off; the person own choice wins over it', async () => {
  await withStorage(mem(), () => {
    setAerialDefault(undefined);
    assert.equal(initialAerial(), true, 'on by default');
    setAerialDefault(false);
    assert.equal(initialAerial(), false, 'builder default off');
    writeAerialChoice(true);
    assert.equal(initialAerial(), true, 'the client turned it on and the browser remembers');
    clearAerialChoice();
    setAerialDefault(true);
  });
});

test('a newly loaded lot opens with the remembered choice or the builder default', async () => {
  await withStorage(mem(), () => {
    assert.equal(lotProject().site.lot.layers.aerial, true);
    setAerialDefault(false);
    assert.equal(lotProject().site.lot.layers.aerial, false, 'builder default off');
    writeAerialChoice(true);
    assert.equal(lotProject().site.lot.layers.aerial, true, 'own choice wins');
    clearAerialChoice();
    setAerialDefault(true);
  });
});

test('setAerial: flips the lot layer as one undo step, remembers the choice, does nothing twice, and keeps boundary, neighbours and setbacks', async () => {
  await withStorage(mem(), () => {
    const s = createStore(lotProject(), { autosaveKey: null });
    assert.ok(hasAerial(s.project) && aerialOn(s.project));
    const before = JSON.stringify({ b: s.project.site.lot.boundary, n: s.project.site.lot.neighbours, c: s.project.site.lot.contours });
    assert.equal(setAerial(s, false), true);
    assert.equal(aerialOn(s.project), false);
    assert.equal(readAerialChoice(), false);
    assert.equal(JSON.stringify({ b: s.project.site.lot.boundary, n: s.project.site.lot.neighbours, c: s.project.site.lot.contours }), before, 'the linework data is untouched');
    assert.equal(setAerial(s, false), false, 'already off');
    s.undo();
    assert.equal(aerialOn(s.project), true, 'one undo step');
    assert.equal(setAerial(s, true, { remember: false }), false);
    assert.equal(aerialLabel(true), 'Aerial: On');
    assert.equal(aerialLabel(false), 'Aerial: Off');
  });
});

test('PDF option "Include aerial underlay": default on; off strips the aerial layer from the export payload and the project is not changed', () => {
  const p = lotProject();
  assert.equal(exportPayload(p).site.lot.layers.aerial, true);
  const st = createStore(structuredClone(p), { autosaveKey: null });
  st.run('set_drawing', { includeAerial: false });
  const q = st.project;
  assert.equal(q.drawing.includeAerial, false);
  assert.equal(exportPayload(q).site.lot.layers.aerial, false);
  assert.equal(q.site.lot.layers.aerial, true, 'the design itself still shows the aerial');
  const w = withoutAerial(p);
  assert.equal(w.site.lot.layers.aerial, false);
  assert.equal(p.site.lot.layers.aerial, true);
  st.run('set_drawing', { includeAerial: true });
  assert.equal(exportPayload(st.project).site.lot.layers.aerial, true);
});

test('PDF option: exportPlanSet draws the locality aerial by default and leaves it out with includeAerial false', async () => {
  const houses = JSON.parse(read('../../golive/builder-houses/hunter-homes.json'));
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const lot = { boundaryM: rect(0, 0, 36, 60), frontEdge: 0, lotNumber: '12', planLabel: 'DP 1234567', address: '12 Sample Street', lga: 'Maitland City Council', setbacks: { front: 6, side: 0.9, rear: 3 }, neighbours: [] };
  const aerial = { image: new Uint8Array(fs.readFileSync(new URL('./fixtures/aerial-test.jpg', import.meta.url))), extentM: { minE: -282, minN: -270, maxE: 318, maxN: 330 }, state: 'NSW' };
  const images = async (blob) => (Buffer.from(await blob.arrayBuffer()).toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length;
  const go = (extra) => exportPlanSet({ project: houses[0].project, lot, kind: 'site', download: false, jsPDF, fetchSite: null, aerial, date: new Date(2026, 10, 15), ...extra });
  const on = await go({});
  const off = await go({ includeAerial: false });
  assert.equal((await images(on.blob)) - (await images(off.blob)), 1, 'one aerial picture fewer');
  assert.equal(off.pages, on.pages);
});

test('builder portal: "Show aerial by default" is on by default, saved by the mock API, and shown in the client settings', async () => {
  const api = createMockApi({ storage: memoryStorage(), latency: 0 });
  await api.signIn(DEMO_LOGINS.admin || DEMO_LOGINS.owner || Object.values(DEMO_LOGINS)[0]);
  assert.equal((await api.me()).org.showAerialDefault, true, 'on by default');
  assert.equal((await api.setOrgSettings({ showAerialDefault: false })).showAerialDefault, false);
  assert.equal((await api.me()).org.showAerialDefault, false);
  assert.equal((await api.setOrgSettings({ showAerialDefault: true })).showAerialDefault, true);
  const src = read('../src/portal/ui/clients-tab.js');
  assert.match(src, /'showAerialDefault', 'Show aerial by default'/);
  assert.match(read('../src/portal/client-mode.js'), /setAerialDefault\(me\.org\?\.showAerialDefault !== false\)/);
  assert.match(read('../server/migrations/0017_org_show_aerial_default.sql'), /ADD COLUMN show_aerial_default INTEGER NOT NULL DEFAULT 1/);
  assert.match(read('../server/schema.sql'), /show_aerial_default INTEGER NOT NULL DEFAULT 1/);
  assert.match(read('../server/lib/portal-store.js'), /showAerialDefault: 'show_aerial_default:b'/);
});

test('wiring: the toggle is on both lot cards, over the 2D plan and 3D view, in the enlarged top view; the top view draws the aerial only when on', async () => {
  for (const f of ['../src/lotcard/lot-card.js', '../src/commercial/lotcard.js']) {
    const src = read(f);
    assert.match(src, /createAerialToggle\(/);
    assert.match(src, /includeAerial: aerialOn\(store\.project\)/, 'the plan set follows the toggle');
  }
  assert.match(read('../src/app.js'), /createAerialToggle\(\{ store, className: 'ps-aerial-fab'/);
  assert.match(read('../src/lotcard/topview.js'), /createAerialToggle\(\{ store, dataPs: 'topview-aerial' \}\)/);
  assert.match(read('../src/premium/pdf-preview.js'), /Include aerial underlay/);
  const { housingScene, sceneInner, fitView } = await import('../src/lotcard/topview.js');
  const p = lotProject();
  const sc = housingScene(p);
  assert.ok(sc.aerial, 'on: the scene carries the aerial');
  sc.aerial.href = 'blob:test';
  const fit = fitView(sc, 800, 500);
  assert.match(sceneInner(sc, fit, 800, 500), /data-part="aerial"/);
  p.site.lot.layers.aerial = false;
  const off = housingScene(p);
  assert.equal(off.aerial, null, 'off: no aerial in the scene');
  const out = sceneInner(off, fit, 800, 500);
  assert.ok(!/<image/.test(out));
  assert.match(out, /data-part="boundary"/);
  assert.match(out, /fill="#ffffff"/, 'clean light ground with the boundary, neighbours and setbacks still drawn');
});
