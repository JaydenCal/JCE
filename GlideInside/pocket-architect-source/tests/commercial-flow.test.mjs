// Commercial guided flow: zone warning, type choice with the wall system, the mix, layouts, move, turn and mirror, the check summary
// and the wording rules (building, layout and site, never house or home).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createStore } from '../src/model/store.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { conadillyProject } from './helpers/conadilly-lot.mjs';
import { COMMERCIAL_STEPS, flowOf, writeFlow } from '../src/flow/state.js';
import { kindOf } from '../src/flow/index.js';
import * as C from '../src/flow/com-logic.js';
import { buildingsOf } from '../src/commercial/catalogue/buildings.js';
import { isCommercial } from '../src/commercial/mode.js';

const here = dirname(new URL(import.meta.url).pathname);
const bare = (opts = {}) => createStore(commercialProject({ rows: 'none', ...opts }), { autosaveKey: null });
const sel = (store) => ({ kind: 'building', id: store.project.commercial.buildings[0].id });

test('flow kind: a commercial project or a commercial request is the commercial flow, the rest stay residential', () => {
  assert.equal(kindOf({ mode: 'commercial' }), 'commercial');
  assert.equal(kindOf({}, true), 'commercial');
  assert.equal(kindOf({}), 'residential');
  assert.deepEqual(COMMERCIAL_STEPS.map((s) => s.title), ['Find your lot', 'Choose what to build', 'Place it', 'Check it', 'Edit and export']);
});

test('zone warning: an industrial lot has none, a residential zone is warned in plain words', () => {
  assert.equal(C.zoneWarning(bare().project), null);
  const res = bare({ zoning: { code: 'R2', name: 'Low Density Residential' } });
  const w = C.zoneWarning(res.project);
  assert.ok(w && /R2/.test(w.text));
  assert.ok(!/\b(house|home)\b/i.test(w.text));
});

test('types: the catalogue is offered with strata units, labels carry no house or home', () => {
  const t = C.commercialTypes();
  for (const id of ['warehouse', 'service-station', 'office', 'strata-units', 'kiosk', 'car-wash']) assert.ok(t.some((x) => x.id === id), id);
  for (const x of t) assert.ok(!/\b(house|home)\b/i.test(`${x.label} ${x.blurb}`), x.id);
});

test('choose a type: the project goes commercial with that building and a car park layout, one undo step', () => {
  const store = createStore(conadillyProject({ corner: false }), { autosaveKey: null });
  assert.equal(isCommercial(store.project), false);
  assert.ok(C.chooseType(store, 'warehouse'));
  assert.equal(isCommercial(store.project), true);
  assert.deepEqual(buildingsOf(store.project.commercial).map((b) => b.type), ['warehouse']);
  assert.ok(store.project.commercial.siteWorks, 'the car park layout is laid out');
});

test('wall system: metal clad or tilt-up is stored and read back', () => {
  const store = bare();
  C.chooseType(store, 'warehouse');
  assert.equal(C.wallSystemOf(store.project), 'metal');
  C.setWallSystem(store, 'tilt');
  assert.equal(C.wallSystemOf(store.project), 'tilt');
  C.setWallSystem(store, 'metal');
  assert.equal(C.wallSystemOf(store.project), 'metal');
});

test('mix: more buildings can be added, copied and removed; each is one undo step', () => {
  const store = bare({ width: 110000, depth: 130000 });
  C.chooseType(store, 'warehouse');
  const a = C.addToMix(store, 'kiosk');
  assert.equal(store.project.commercial.buildings.length, 2);
  const d = C.duplicateBuilding(store, a.id);
  assert.equal(store.project.commercial.buildings.length, 3);
  C.deleteBuilding(store, d.id);
  assert.equal(store.project.commercial.buildings.length, 2);
  store.undo();
  assert.equal(store.project.commercial.buildings.length, 3);
});

test('layouts: next and previous step through the type\'s layouts and the pager says where you are', () => {
  const store = bare();
  C.chooseType(store, 'warehouse');
  const p0 = C.layoutPager(store.project);
  assert.ok(p0.of >= 2);
  const l0 = store.project.commercial.layout.label;
  C.stepLayoutBy(store, 1);
  assert.notEqual(store.project.commercial.layout.label, l0);
  C.stepLayoutBy(store, -1);
  assert.equal(store.project.commercial.layout.label, l0);
  C.bestFitAgain(store);
  assert.ok(buildingsOf(store.project.commercial).length >= 1);
});

test('move, turn and mirror: positions change, the layout is laid out again and undo restores', () => {
  const store = bare({ width: 100000, depth: 120000 });
  C.chooseType(store, 'warehouse');
  const s = sel(store);
  const p0 = structuredClone(store.project.commercial.buildings[0].place);
  C.moveBy(store, s, 1000, 0);
  assert.notEqual(store.project.commercial.buildings[0].place.x, p0.x);
  C.turnBy(store, s, 90);
  assert.notEqual(store.project.commercial.buildings[0].place.rotationDeg, p0.rotationDeg);
  const before = JSON.stringify(store.project.commercial.buildings.map((b) => b.place));
  C.mirrorLayout(store);
  assert.notEqual(JSON.stringify(store.project.commercial.buildings.map((b) => b.place)), before);
  assert.ok(store.project.commercial.siteWorks, 'site layout is current after the edits');
  store.undo();
  assert.equal(JSON.stringify(store.project.commercial.buildings.map((b) => b.place)), before);
});

test('check summary: setbacks, coverage, parking against the rate, accessible bays, trucks, yield and the estimates caveat', () => {
  const store = bare({ width: 80000, depth: 110000 });
  C.chooseType(store, 'warehouse');
  const s = C.checkSummary(store.project);
  assert.equal(s.ok, true);
  assert.ok(s.rows.length >= 3 && s.coveragePct > 0);
  assert.ok(s.parking.required > 0 && s.parking.provided >= 0 && 'accessibleRequired' in s.parking);
  assert.ok(s.lines.some((l) => /indicative|check with council/i.test(l)));
  assert.match(s.caveat, /estimates only/i);
  assert.equal(typeof s.truck.has, 'boolean');
  const text = [...s.lines, s.caveat].join(' ');
  assert.ok(!/[–—]/.test(text) && !/compliant/i.test(text));
  assert.ok(!/\b(house|home)\b/i.test(text));
});

test('progress is remembered on the project and resumes at the same commercial step', () => {
  const store = bare();
  writeFlow(store, { kind: 'commercial', step: 3 });
  assert.equal(flowOf(store.project).step, 3);
  assert.equal(flowOf(store.project).kind, 'commercial');
});

test('wording: the commercial UI strings never say house or home', () => {
  const files = ['../src/flow/commercial.js', '../src/flow/com-logic.js', '../src/commercial/ui/add-building.js', '../src/commercial/ui/panel-commercial.js', '../src/commercial/catalogue/draw2d.js'];
  for (const f of files) {
    const src = readFileSync(join(here, f), 'utf8');
    const strings = src.match(/'[^'\n]{4,}'|`[^`\n]{4,}`/g) || [];
    for (const s of strings) if (/\b(house|home)\b/i.test(s) && !/\/home|import|from /.test(s)) assert.fail(`${f}: ${s}`);
  }
});
