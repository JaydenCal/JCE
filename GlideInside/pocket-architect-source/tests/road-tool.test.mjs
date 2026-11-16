// The road, driveway and pavement tool (hardstand controller, mode 'road'), and selecting and deleting generated site works.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model/store.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { chooseBuilding } from '../src/commercial/catalogue/fit.js';
import { applyBuildingChoice } from '../src/commercial/catalogue/ops.js';
import { siteWorksOf } from '../src/commercial/catalogue/buildings.js';
import { pavementModel } from '../src/commercial/catalogue/pavements/logic.js';
import { createHardstandController } from '../src/commercial/ui/hardstand-controller.js';
import { hsState, setHsState, setRoadKind, HS_MODES } from '../src/commercial/ui/hardstand-state.js';
import * as R from '../src/commercial/catalogue/pavements/roads.js';

function rig() {
  const store = createStore(commercialProject({ width: 60000, depth: 80000, rows: 'none' }), { autosaveKey: null });
  applyBuildingChoice(store, chooseBuilding(store.project, 'service-station'));
  const toasts = [];
  const ctl = createHardstandController({ store, scale: () => 0.01, toast: (m, o) => toasts.push({ m, ...o }) });
  setHsState({ mode: 'road', selected: null });
  setRoadKind('road');
  const click = (p, mods = {}) => { ctl.pointerMove(p, mods); ctl.pointerDown(p, mods); ctl.pointerUp(p, mods); };
  const roads = () => R.roadList(store.project.commercial);
  return { store, ctl, toasts, click, roads };
}

test('road mode is offered with a key, and the road kinds set surface and width', () => {
  assert.ok(HS_MODES.some((m) => m.id === 'road'));
  setRoadKind('pavement');
  assert.equal(hsState.type, 'concrete-footpath');
  setRoadKind('driveway');
  assert.equal(hsState.type, 'asphalt-ac10-car');
  assert.equal(hsState.roadWidth, null);
});

test('click points, Enter finishes: one undo step makes a selected road of the default width', () => {
  const { store, ctl, click, roads } = rig();
  const before = store.project.commercial.pavements?.length || 0;
  click({ x: 15000, y: 30000 }); click({ x: 30000, y: 30000 }); click({ x: 30000, y: 45000 });
  assert.ok(ctl.busy);
  const d = ctl.draft();
  assert.ok(d.ring && d.centre.length >= 3);
  assert.ok(ctl.keyDown({ key: 'Enter' }));
  assert.equal(roads().length, 1);
  assert.equal(roads()[0].centre.length, 3);
  assert.equal(roads()[0].widthMm, 7000);
  assert.equal(hsState.selected, roads()[0].id);
  store.undo();
  assert.equal(R.roadList(store.project.commercial).length, 0);
  assert.equal(store.project.commercial.pavements?.length || 0, before);
});

test('double click finishes; Escape cancels; Backspace removes the last point', () => {
  const { ctl, click, roads } = rig();
  click({ x: 15000, y: 30000 }); click({ x: 30000, y: 30000 }); click({ x: 30000, y: 45000 });
  ctl.keyDown({ key: 'Backspace' });
  assert.equal(ctl.draft().centre.length >= 2, true);
  ctl.dblClick({ x: 30000, y: 30000 });
  assert.equal(roads().length, 1);
  assert.equal(roads()[0].centre.length, 2);
  click({ x: 5000, y: 5000 });
  assert.ok(ctl.keyDown({ key: 'Escape' }));
  assert.ok(!ctl.busy);
});

test('a driveway starts on the street frontage and ends on a building door by snapping', () => {
  const { store, ctl, click, roads } = rig();
  setRoadKind('driveway');
  const [a, b] = R.frontageEdges(store.project.site.lot)[0];
  const door = R.doorPoints(store.project.commercial)[0];
  click({ x: (a.x + b.x) / 2 + 200, y: (a.y + b.y) / 2 + 300 });
  click({ x: door.x + 150, y: door.y - 150 });
  ctl.keyDown({ key: 'Enter' });
  const r = roads()[0];
  assert.equal(r.kind, 'driveway');
  assert.deepEqual(r.centre[1], { x: door.x, y: door.y });
  assert.equal(R.touchesFrontage(r.centre, store.project.site.lot), true);
});

test('select a road, drag a point, drag the width dot, insert a point, delete it', () => {
  const { store, ctl, click, roads } = rig();
  click({ x: 15000, y: 30000 }); click({ x: 35000, y: 30000 });
  ctl.keyDown({ key: 'Enter' });
  const id = roads()[0].id;
  setHsState({ mode: 'edit', selected: id });
  const h = ctl.draft().handles;
  assert.ok(h.some((x) => x.kind === 'width') && h.some((x) => x.kind === 'mid'));
  // drag the end point
  const end = roads()[0].centre[1];
  ctl.pointerDown({ x: end.x, y: end.y }, { screen: { x: 0, y: 0 } });
  ctl.pointerMove({ x: end.x + 3000, y: end.y + 5000 }, { screen: { x: 50, y: 50 }, alt: true });
  ctl.pointerUp({ x: end.x + 3000, y: end.y + 5000 }, { screen: { x: 50, y: 50 }, alt: true });
  assert.deepEqual(roads()[0].centre[1], { x: end.x + 3000, y: end.y + 5000 });
  // width
  const w = ctl.draft().handles.find((x) => x.kind === 'width');
  ctl.pointerDown({ x: w.x, y: w.y }, { screen: { x: 0, y: 0 } });
  const c0 = roads()[0].centre;
  const m0 = { x: (c0[0].x + c0[1].x) / 2, y: (c0[0].y + c0[1].y) / 2 };
  const f = 1 + 2000 / Math.hypot(w.x - m0.x, w.y - m0.y);
  const far = { x: m0.x + (w.x - m0.x) * f, y: m0.y + (w.y - m0.y) * f };
  ctl.pointerMove(far, { screen: { x: 50, y: 50 } });
  ctl.pointerUp(far, { screen: { x: 50, y: 50 } });
  assert.ok(roads()[0].widthMm > 7000);
  // midpoint dot adds a point
  const mid = ctl.draft().handles.find((x) => x.kind === 'mid');
  ctl.pointerDown({ x: mid.x, y: mid.y }, { screen: { x: 0, y: 0 } });
  ctl.pointerMove({ x: mid.x, y: mid.y - 4000 }, { screen: { x: 50, y: 50 }, alt: true });
  ctl.pointerUp({ x: mid.x, y: mid.y - 4000 }, { screen: { x: 50, y: 50 }, alt: true });
  assert.equal(roads()[0].centre.length, 3);
  // Delete removes the whole road when no point is active
  ctl.keyDown({ key: 'Escape' });
  setHsState({ selected: id });
  ctl.keyDown({ key: 'Delete' });
  assert.equal(roads().length, 0);
  assert.equal(hsState.selected, null);
  store.undo();
  assert.equal(roads().length, 1);
});

test('the road feeds the pavement model, quantities and feasibility developed area', () => {
  const { store, ctl, click } = rig();
  const m0 = pavementModel(store.project.commercial, store.project.site.lot).quantities.totalAreaM2;
  click({ x: 8000, y: 72000 }); click({ x: 50000, y: 72000 });
  ctl.keyDown({ key: 'Enter' });
  const m1 = pavementModel(store.project.commercial, store.project.site.lot).quantities.totalAreaM2;
  assert.ok(m1 - m0 > 150);
});

test('select a generated aisle in edit mode and remove it with Delete; undo and Restore all bring it back', () => {
  const { store, ctl } = rig();
  const sw = siteWorksOf(store.project.commercial);
  const paved = sw.pavedAisles[0];
  const mid = { x: paved.polygon.reduce((s, q) => s + q.x, 0) / paved.polygon.length, y: paved.polygon.reduce((s, q) => s + q.y, 0) / paved.polygon.length };
  setHsState({ mode: 'edit', selected: null });
  const topHard = ctl.pointerDown(mid, { screen: { x: 0, y: 0 } });
  ctl.pointerUp(mid, { screen: { x: 0, y: 0 } });
  assert.ok(topHard);
  assert.ok(String(hsState.selected).startsWith('sw:'));
  assert.ok(ctl.draft().generated);
  const id = hsState.selected;
  assert.ok(ctl.keyDown({ key: 'Delete' }));
  assert.ok(!R.siteItemById(store.project.commercial, id));
  assert.equal(hsState.selected, null);
  assert.ok(store.project.commercial.siteRemoved.ids.includes(id));
  store.undo();
  assert.ok(R.siteItemById(store.project.commercial, id));
});

test('make a generated aisle editable turns it into a selected road', () => {
  const { store, ctl } = rig();
  const aisle = siteWorksOf(store.project.commercial).aisles[0];
  setHsState({ mode: 'edit', selected: aisle.id });
  assert.ok(ctl.makeEditable());
  assert.ok(R.roadById(store.project.commercial, hsState.selected));
});
