// Commercial roads and paving can be removed and restored without touching the generated layout (item 8, 16/11/2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model/store.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { chooseBuilding } from '../src/commercial/catalogue/fit.js';
import { applyBuildingChoice } from '../src/commercial/catalogue/ops.js';
import { siteWorksOf } from '../src/commercial/catalogue/buildings.js';
import { toggleSiteKind, removeSiteItem, restoreSiteWorks, removedKinds } from '../src/flow/com-logic.js';
import { siteAccess } from '../src/commercial/access.js';

function station() {
  const store = createStore(commercialProject({ width: 60000, depth: 80000, rows: 'none' }));
  applyBuildingChoice(store, chooseBuilding(store.project, 'service-station'));
  return store;
}

test('removing a kind empties it from siteWorksOf but not from the stored layout; restore brings it back', () => {
  const s = station();
  const p = s.project;
  const raw = p.commercial.siteWorks;
  assert.ok(raw.aisles.length > 0 && raw.crossovers.length > 0);
  assert.equal(toggleSiteKind(p, 'aisles'), true);
  assert.deepEqual(removedKinds(p), ['aisles']);
  assert.equal(siteWorksOf(p.commercial).aisles.length, 0);
  assert.equal(siteWorksOf(p.commercial).pavedAisles.length, 0);
  assert.ok(siteWorksOf(p.commercial).crossovers.length > 0, 'other kinds stay');
  assert.ok(p.commercial.siteWorks.aisles.length > 0, 'the generated layout is untouched');
  assert.equal(toggleSiteKind(p, 'aisles'), false);
  assert.equal(p.commercial.siteRemoved, undefined);
  assert.equal(siteWorksOf(p.commercial).aisles.length, raw.aisles.length);
});

test('one road or paved area can be removed by id, and restore clears everything', () => {
  const p = station().project;
  const id = p.commercial.siteWorks.aisles[0].id;
  const before = siteWorksOf(p.commercial).aisles.length;
  removeSiteItem(p, id);
  assert.equal(siteWorksOf(p.commercial).aisles.length, before - 1);
  assert.ok(!siteWorksOf(p.commercial).aisles.some((a) => a.id === id));
  toggleSiteKind(p, 'footpaths');
  restoreSiteWorks(p);
  assert.equal(siteWorksOf(p.commercial).aisles.length, before);
});

test('removing the entries and exits drops the crossover pads from the site access too', () => {
  const p = station().project;
  toggleSiteKind(p, 'crossovers');
  const a = siteAccess(p.commercial, p.site.lot);
  assert.ok(!a?.siteWorks, 'no generated crossover is used once removed');
});

test('removing the driveway turns off the long access driveway', () => {
  const p = commercialProject({ width: 60000, depth: 80000, rows: 'none' });
  const lot = p.site.lot;
  p.commercial.siteRemoved = { kinds: ['driveway'], ids: [] };
  const a = siteAccess(p.commercial, lot);
  assert.ok(!a || a.driveway === null);
});
