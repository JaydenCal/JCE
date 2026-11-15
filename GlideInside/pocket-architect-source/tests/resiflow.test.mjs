// Residential guided flow: step state and resume, the home list (fit, filters), auto placement facing the street inside the setbacks,
// nudge, turn and mirror, the plain language check summary and that the editor project carries the placed house.
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogue } from '../src/catalogue/index.js';
import { migrate, createProject } from '../src/model/schema.js';
import { demoLotResponse } from '../src/site/demo-lot.js';
import { buildSiteLot } from '../src/site/model.js';
import { createStore } from '../src/model/store.js';
import { RESIDENTIAL_STEPS, COMMERCIAL_STEPS, flowOf, flowInProgress, writeFlow, nextStep, prevStep, resumeStep, EDIT_STEP } from '../src/flow/state.js';
import { shouldStart, kindOf } from '../src/flow/index.js';
import { loadHomes, filterRows, designRows, placeBest, nudgeHouse, turnHouse, mirrorHouse, placementStatus, checkSummary, placedWell, INDICATIVE } from '../src/flow/res-logic.js';
import { garageDoor, garageStreetEdge, buildingHull, clearances } from '../src/site/lotplan.js';
import { lotOf, classifyEdges } from '../src/model/placement.js';
import { inwardNormalOf } from '../src/site/lotplan.js';
import { frontageM } from '../src/flow/lot-map.js';

const ENV = [{ x: 1000, y: 6000 }, { x: 23000, y: 6000 }, { x: 23000, y: 42000 }, { x: 1000, y: 42000 }];
const lotStore = () => {
  const p = migrate(createProject({ name: 'Lot' }));
  p.levels = [];
  p.site.lot = buildSiteLot({ lot: { ...demoLotResponse(), sample: false, demo: false }, address: '14 Sample Street', source: 'sample' });
  p.site.lot.setbacks = { front: 6, side: 0.9, rear: 3 };
  p.site.lot.envelope = ENV;
  p.site.lot.frontageConfirmed = true;
  return createStore(p, { autosaveKey: null, opContext: { catalogue } });
};
const towardFront = (store, mm) => { const lot = lotOf(store.project); const f = classifyEdges(lot).find((e) => e.kind === 'front'); const n = inwardNormalOf(lot, f.index); return [Math.round(-n.x * mm), Math.round(-n.y * mm)]; };
const homes = async (store) => (await loadHomes(store, catalogue, null)).rows;

test('steps: five in each flow, in the owner\'s order, and Back and Next stay inside 1 to 5', () => {
  assert.deepEqual(RESIDENTIAL_STEPS.map((s) => s.title), ['Find your lot', 'Choose a home', 'Place it', 'Check it', 'Edit and export']);
  assert.deepEqual(COMMERCIAL_STEPS.map((s) => s.title), ['Find your lot', 'Choose what to build', 'Place it', 'Check it', 'Edit and export']);
  assert.equal(nextStep(1), 2); assert.equal(nextStep(5), 5); assert.equal(prevStep(1), 1); assert.equal(prevStep(3), 2);
});

test('step transitions are written on the project without an undo step and survive a save and reload', () => {
  const store = lotStore();
  assert.equal(flowOf(store.project), null);
  let events = 0;
  store.on('project', (e) => { if (e?.label === 'flow') events += 1; });
  writeFlow(store, { kind: 'residential', step: 2 });
  writeFlow(store, { step: 3, designId: 'house_single' });
  assert.equal(events, 2);
  assert.equal(store.canUndo(), false, 'flow progress is not an undo step');
  const reloaded = migrate(JSON.parse(JSON.stringify(store.project)));
  assert.deepEqual(flowOf(reloaded), { kind: 'residential', step: 3, designId: 'house_single' });
  assert.equal(resumeStep(reloaded, 'residential'), 3);
  assert.equal(flowInProgress(reloaded), true);
  writeFlow(store, { step: EDIT_STEP });
  assert.equal(flowInProgress(store.project), false, 'step 5 is the editor');
  assert.equal(writeFlow(store, { step: EDIT_STEP }).step, 5);
});

test('resume after refresh: a flow part way through reopens, a returning visitor with no flow record goes to the editor', () => {
  const store = lotStore();
  const base = { project: store.project, search: '', viewer: false, demo: false, shareId: null };
  assert.equal(shouldStart({ ...base, fromAutosave: false }), true, 'a fresh open starts the flow');
  assert.equal(shouldStart({ ...base, fromAutosave: true }), false, 'a returning visitor with a saved design is not interrupted');
  writeFlow(store, { kind: 'residential', step: 3 });
  assert.equal(shouldStart({ ...base, fromAutosave: true }), true, 'a saved design part way through the flow resumes');
  writeFlow(store, { step: 5 });
  assert.equal(shouldStart({ ...base, fromAutosave: true }), false, 'once in the editor the flow does not reopen');
  assert.equal(shouldStart({ ...base, fromAutosave: false, viewer: true }), false);
  assert.equal(shouldStart({ ...base, fromAutosave: false, demo: true }), false);
  assert.equal(shouldStart({ ...base, fromAutosave: false, shareId: 'abc' }), false);
  assert.equal(shouldStart({ ...base, fromAutosave: false, search: '?flow=0' }), false);
  assert.equal(shouldStart({ ...base, fromAutosave: false, search: '?template=house_single' }), false);
  assert.equal(kindOf({ mode: 'commercial' }), 'commercial');
  assert.equal(kindOf({}, true), 'commercial');
  assert.equal(kindOf({ flow: { kind: 'commercial', step: 2 } }), 'commercial');
  assert.equal(kindOf({}), 'residential');
});

test('choose a home: rows carry size, beds, baths and a fit status, and the filters narrow by bedrooms and storeys', async () => {
  const store = lotStore();
  const rows = await homes(store);
  assert.ok(rows.length >= 3);
  for (const r of rows) {
    assert.ok(r.size && /x/.test(r.size));
    assert.equal(typeof r.stats.bedrooms, 'number');
    assert.equal(typeof r.stats.bathrooms, 'number');
    assert.ok(['fits', 'rotated', 'mirrored', 'rotated-mirrored', 'too-big', 'unknown'].includes(r.fitStatus));
    assert.ok(r.fitText);
  }
  const ranks = rows.map((r) => (r.fitStatus === 'too-big' ? 4 : r.fitStatus === 'unknown' ? 5 : 0));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'designs that fit come before those that do not');
  const beds = [...new Set(rows.map((r) => r.stats.bedrooms))];
  for (const b of beds) assert.ok(filterRows(rows, { bedrooms: b >= 4 ? 4 : b }).every((r) => (b >= 4 ? r.stats.bedrooms >= 4 : r.stats.bedrooms === b)));
  assert.ok(filterRows(rows, { storeys: 1 }).every((r) => r.stats.storeys === 1));
  assert.ok(filterRows(rows, { storeys: 2 }).every((r) => r.stats.storeys >= 2));
  assert.ok(filterRows(rows, { bedrooms: 0 }).every((r) => r.stats.bedrooms === 0), 'only studios have no bedroom');
  assert.equal(filterRows(rows, {}).length, rows.length);
});

test('choose a home: a signed in builder\'s library is offered, never the generic catalogue', async () => {
  const store = lotStore();
  const own = (id, name, tpl) => ({ id, name, group: 'builder', project: migrate(catalogue.createFromTemplate(tpl)) });
  const app = { lotDesigns: async () => [own('h1', 'Banksia 22', 'house_single'), own('h2', 'Coastal 28', 'house_double')] };
  const r = await loadHomes(store, catalogue, app);
  assert.equal(r.own, true);
  assert.deepEqual(r.rows.map((x) => x.name).sort(), ['Banksia 22', 'Coastal 28']);
});

test('place it: the home is auto placed facing the street, inside the setbacks, with the driveway to the frontage', async () => {
  for (const id of ['house_single', 'house_double']) {
    const store = lotStore();
    const row = (await homes(store)).find((r) => r.id === id);
    const res = await placeBest(store, row.design);
    assert.ok(res, `${id} placed`);
    const p = store.project;
    assert.equal(p.placedHouse.id, id);
    const st = placementStatus(p);
    assert.equal(st.state, 'inside', `${id}: ${st.text}`);
    assert.ok(clearances(p).rows.every((r) => r.status !== 'outside'));
    const door = garageDoor(p);
    if (door) assert.notEqual(garageStreetEdge(p), null, `${id}: the garage door faces the street and the driveway reaches the frontage`);
    assert.ok(placedWell(p));
    // the house is inside the lot, between the front setback and the rear of the lot
    const lot = lotOf(p);
    const hull = buildingHull(p);
    assert.ok(hull.length >= 3);
    for (const q of hull) assert.ok(q.x > lot.boundary[0].x - 1 && q.x < 24000 + 12000 + 1, 'inside the lot across');
  }
});

test('place it: nudge, turn and mirror change the live status and are undoable; Best fit puts the home back', async () => {
  const store = lotStore();
  const row = (await homes(store)).find((r) => r.id === 'house_single');
  await placeBest(store, row.design);
  const c0 = JSON.stringify(buildingHull(store.project));
  nudgeHouse(store, 100, 0);
  assert.notEqual(JSON.stringify(buildingHull(store.project)), c0);
  store.undo();
  assert.equal(JSON.stringify(buildingHull(store.project)), c0, 'one undo step per nudge');
  nudgeHouse(store, ...towardFront(store, 9000)); // far forward: over the front setback
  const st = placementStatus(store.project);
  assert.equal(st.state, 'outside');
  assert.match(st.text, /Too close to the (front|side|rear|side street) boundary by \d+\.\d\d m/);
  turnHouse(store, 90);
  mirrorHouse(store);
  assert.ok(buildingHull(store.project).length >= 3);
  await placeBest(store, row.design);
  assert.equal(placementStatus(store.project).state, 'inside', 'Best fit recovers a good position');
});

test('check it: a plain language summary with distances, coverage, open space, garage and driveway, and the indicative caveat', async () => {
  const store = lotStore();
  const row = (await homes(store)).find((r) => r.id === 'house_single');
  await placeBest(store, row.design);
  const s = checkSummary(store.project);
  assert.equal(s.verdict, 'met');
  assert.ok(s.rows.length >= 3 && s.rows.every((r) => typeof r.clearanceM === 'number' && r.met !== false));
  assert.ok(s.coverageM2 > 50 && s.coveragePct > 5 && s.coveragePct < 70);
  assert.ok(s.openSpaceM2 > 0 && s.openSpaceM2 < s.lotAreaM2);
  assert.equal(s.garage.has, true);
  assert.equal(s.garage.facesStreet, true);
  assert.equal(s.driveway.state, 'ok');
  assert.ok(s.lines.some((l) => /indicative/i.test(l) && /check with council/i.test(l)));
  assert.equal(s.lines.at(-1), INDICATIVE);
  const text = s.lines.join(' ');
  assert.ok(!/[–—]/.test(text), 'no em or en dashes');
  assert.ok(!/compliant/i.test(text), 'never the word compliant');
  nudgeHouse(store, ...towardFront(store, 9000));
  const bad = checkSummary(store.project);
  assert.equal(bad.verdict, 'not-met');
  assert.ok(bad.rows.some((r) => r.met === false));
});

test('edit and export: the editor project carries the placed house, the lot and the flow record', async () => {
  const store = lotStore();
  const row = (await homes(store)).find((r) => r.id === 'house_double');
  writeFlow(store, { kind: 'residential', step: 3, designId: row.id });
  await placeBest(store, row.design);
  writeFlow(store, { step: 5 });
  const reloaded = migrate(JSON.parse(JSON.stringify(store.project)));
  assert.equal(reloaded.placedHouse.id, 'house_double');
  assert.ok(reloaded.levels.some((l) => l.rooms.length && l.walls.length), 'rooms and walls are in the editor project');
  assert.ok(lotOf(reloaded));
  assert.equal(flowOf(reloaded).step, 5);
  assert.equal(placementStatus(reloaded).state, 'inside');
});

test('lot step helpers: frontage length of the lot', () => {
  const store = lotStore();
  assert.ok(Math.abs(frontageM(lotOf(store.project)) - 24) < 0.5);
});

test('wording: no em or en dashes, no "compliant", no Pocket Architect in the flow files', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('../src/flow/', import.meta.url);
  for (const f of readdirSync(dir)) {
    const t = readFileSync(new URL(f, dir), 'utf8');
    assert.ok(!/[–—]/.test(t), `${f}: no em or en dashes`);
    assert.ok(!/compliant/i.test(t.replace(/never the word compliant/gi, '')), `${f}: never compliant`);
    assert.ok(!/pocket architect/i.test(t), `${f}: no Pocket Architect`);
  }
});
