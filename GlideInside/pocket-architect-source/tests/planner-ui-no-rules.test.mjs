// 27 Conadilly Street Gunnedah (Lot 1 DP 758492, zone E3): no council setback rule loads. The viewer fits the house against a default
// indicative envelope (front 6, side 0.9, rear 3, secondary front 3), never leaves it over a boundary, shows an amber "not confirmed"
// line unless it truly crosses, and notes that a non residential zone may not permit a dwelling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogue } from '../src/catalogue/index.js';
import { migrate, createProject } from '../src/model/schema.js';
import { createStore } from '../src/model/store.js';
import { demoLotResponse } from '../src/site/demo-lot.js';
import { buildSiteLot } from '../src/site/model.js';
import { setbackStatusLine, lotChecks } from '../src/site/lot-checks.js';
import { attachSetbacks } from '../src/site/setback-stage.js';
import { chooseDesign, placeChoice } from '../src/ui/embed-viewer.js';
import { publicDesigns } from '../src/lotcard/designs.js';
import { zoneDwellingNote, defaultEnvelope } from '../src/site/default-setbacks.js';

// The live lot data: an irregular quadrilateral, front edge 2, no setbacks, not a corner lot.
const BOUNDARY = [{ x: -3246, y: 30264 }, { x: -13347, y: 25337 }, { x: -5794, y: -26980 }, { x: 18391, y: -15234 }];
const noRules = async () => ({ setbacks: null, envelope: null, key: 'no-rule', attempts: [{ basis: null, reason: 'no rule for this zone' }] });

function conadilly(boundary = BOUNDARY) {
  const p = migrate(createProject({ name: 'Lot' }));
  p.levels = [];
  const lot = buildSiteLot({ lot: demoLotResponse(), address: '27 Conadilly Street Gunnedah NSW', source: 'nsw' });
  lot.boundary = boundary.map((q) => ({ ...q }));
  lot.holes = [];
  lot.parts = [];
  lot.neighbours = [];
  lot.lotLabel = 'Lot 1 DP 758492';
  lot.areaM2 = 960;
  lot.zoning = { code: 'E3', name: 'Productivity Support', instrument: 'Gunnedah LEP 2012' };
  lot.frontEdges = [2];
  lot.cornerLot = false;
  lot.frontageConfirmed = true;
  lot.setbacks = null;
  lot.envelope = null;
  lot.setbacksStatus = 'none';
  p.site.lot = lot;
  return p;
}
const storeFor = (p) => createStore(p, { autosaveKey: null, opContext: { catalogue } });
const pool = (p) => ({ list: publicDesigns(catalogue, p), own: false, empty: false });

test('no rules: the default envelope exists for the real lot shape', () => {
  const env = defaultEnvelope(conadilly().site.lot);
  assert.ok(env && env.length >= 3, 'an envelope is built from the boundary and frontage');
});

test('no rules: the first design is fitted inside the lot, never over a boundary, and the card is amber', async () => {
  const store = storeFor(conadilly());
  const choice = await chooseDesign(store, pool(store.project), null, { compute: noRules });
  assert.equal(choice.defaulted, true);
  assert.equal(choice.fits, true, 'some design fits the default envelope on this lot');
  placeChoice(store, choice);
  const lot = store.project.site.lot;
  assert.equal(lot.setbacks, null, 'the default is not presented as a confirmed setback');
  assert.equal(lot.setbacksDefault, true);
  assert.equal(lotChecks(store.project).crossesBoundary, false, 'no wall over the lot boundary');
  assert.deepEqual(setbackStatusLine(store.project), { state: 'check', text: 'Setbacks not confirmed, check with council' });
});

test('no rules: the default envelope stays after the setback stage finds no rule again', async () => {
  const store = storeFor(conadilly());
  placeChoice(store, await chooseDesign(store, pool(store.project), null, { compute: noRules }));
  const stage = attachSetbacks(store, { fetchImpl: async () => { throw new Error('offline'); }, delayMs: 5 });
  await new Promise((r) => setTimeout(r, 400));
  stage.dispose();
  assert.ok(store.project.site.lot.envelope?.length >= 3, 'the envelope was not wiped');
  assert.equal(setbackStatusLine(store.project).state, 'check');
});

test('no rules: a house that truly crosses a boundary reads red, a block that nothing fits says Too big', async () => {
  const store = storeFor(conadilly());
  placeChoice(store, await chooseDesign(store, pool(store.project), null, { compute: noRules }));
  store.apply('push over the boundary', (p) => {
    for (const l of p.levels) { for (const w of l.walls) { w.a.x -= 30000; w.b.x -= 30000; } for (const r of l.rooms) r.polygon.forEach((q) => { q.x -= 30000; }); }
  });
  assert.equal(setbackStatusLine(store.project).state, 'outside');
  const narrow = storeFor(conadilly([{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 12000 }, { x: 0, y: 12000 }]));
  narrow.project.site.lot.frontEdges = [0];
  const c = await chooseDesign(narrow, pool(narrow.project), null, { compute: noRules });
  assert.equal(c.fits, false);
  placeChoice(narrow, c);
  assert.equal(setbackStatusLine(narrow.project).text, 'Too big for this block');
});

test('zone note: a non residential zone may not permit a dwelling, a residential one says nothing', () => {
  const note = 'This zone may not permit a dwelling, check with council';
  for (const code of ['E3', 'E1', 'E4', 'E5', 'IN1', 'B2', 'B4', 'RU1', 'RU4', 'SP2']) assert.equal(zoneDwellingNote({ zoning: { code } }), note, code);
  for (const code of ['R1', 'R2', 'R3', 'R5', 'RU5', 'C4', 'MU1']) assert.equal(zoneDwellingNote({ zoning: { code } }), '', code);
  assert.equal(zoneDwellingNote({ zoning: { code: '', name: 'Low density residential' } }), '');
  assert.equal(zoneDwellingNote({ zoning: null }), '', 'no zone known: no note');
  assert.equal(zoneDwellingNote(conadilly().site.lot), note, 'the Conadilly Street lot is E3');
  assert.ok(!/[–—]|compliant/i.test(note));
});
