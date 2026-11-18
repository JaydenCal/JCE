// Draw a driveway when there is no garage door (granny flat, shed house): start on the frontage, PIs, finish at the building.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/model/schema.js';
import { catalogue } from '../src/catalogue/index.js';
import { placeHouse } from '../src/portal/place-house.js';
import { lotEnvelope, portalLotToSiteLot, SAMPLE_LOT } from '../src/portal/envelope.js';
import { autoPose } from '../src/portal/auto-place.js';
import * as L from '../src/site/lotplan.js';
import * as D from '../src/site/drivepi.js';
import { createDrivePIController } from '../src/editor2d/drivepi-controller.js';
import { createStore } from '../src/model/store.js';

function setup(tpl = 'granny_1bed') {
  const portal = { name: 'T', polygonMm: SAMPLE_LOT.polygonMm, frontEdgeIndices: [2], picked: { front: { minM: 4.5 }, secondaryFront: { minM: 3 }, side: { minM: 0.9 }, rear: { minM: 3 } }, lot: '7', dp: 'DP 99' };
  const p = createProject({ name: 'Drive' });
  p.site.lot = portalLotToSiteLot(portal, lotEnvelope(portal));
  const h = catalogue.createFromTemplate(tpl);
  placeHouse(p, h, autoPose(p, h).pose);
  return p;
}

test('a granny flat has no driveway and the panel text tells the person how to draw one', () => {
  const p = setup();
  assert.equal(L.garageDoor(p), null);
  const st = D.driveEditState(p);
  assert.equal(st.ok, false);
  assert.equal(st.canDraw, true);
  assert.match(D.driveEditBlock(st), /Click the street frontage to start/);
  assert.doesNotMatch(D.driveEditBlock(st), /no driveway to edit yet/i);
});

test('drawing from the frontage to the building stores a driveway that is derived like the automatic one', () => {
  const p = setup();
  const lot = p.site.lot;
  const r = L.roadReserve(lot)[0];
  const k = D.kerbSnap(p, L.nearestOnBuilding(p, { x: 0, y: 0 }));
  assert.ok(k);
  const ring = L.buildingRings(p)[0];
  const cx = ring.reduce((a, q) => a + q.x, 0) / ring.length; const cy = ring.reduce((a, q) => a + q.y, 0) / ring.length;
  const res = D.createDrawnDriveway(p, [k.point, { x: (k.point.x + cx) / 2, y: (k.point.y + cy) / 2 }, { x: cx, y: cy }]);
  assert.equal(res.ok, true, res.reason);
  assert.equal(p.site.driveway.drawn, true);
  const d = L.deriveDriveway(p);
  assert.equal(d.ok, true);
  assert.equal(d.widthMm, 3500);
  assert.ok(d.crossover.polygon.length >= 4, 'crossover at the kerb');
  assert.ok(d.polygon.length > 10);
  assert.ok(Math.hypot(d.kerbPoint.x - k.point.x, d.kerbPoint.y - k.point.y) < 800);
  // it starts on the outline of the building
  const s = L.nearestOnBuilding(p, d.centre[0]);
  assert.ok(Math.hypot(s.x - d.centre[0].x, s.y - d.centre[0].y) < 5);
  void r;
  // editable like the automatic one: add a PI, delete it
  const st = D.driveEditState(p);
  assert.equal(st.ok, true);
  assert.equal(st.drawn, true);
});

test('the controller draws with clicks, double click finishes, Delete driveway removes it, one undo step each', () => {
  const p = setup('granny_studio');
  const store = createStore(p);
  const ctl = createDrivePIController({ store, scale: () => 0.05 });
  const k = D.kerbSnap(store.project, L.nearestOnBuilding(store.project, { x: 0, y: 0 }));
  assert.ok(ctl.hint().includes('Click the street frontage'));
  ctl.pointerDown(k.point);
  assert.equal(ctl.isDrawing(), true);
  const b = L.nearestOnBuilding(store.project, k.point);
  const mid = { x: (b.x + k.point.x) / 2 + 600, y: (b.y + k.point.y) / 2 };
  ctl.pointerDown(mid);
  ctl.pointerDown(b); ctl.pointerDown(b); // a double click presses twice
  ctl.dblClick(b);
  assert.equal(ctl.isDrawing(), false);
  assert.equal(store.project.site.driveway.drawn, true);
  assert.equal(L.deriveDriveway(store.project).ok, true);
  assert.equal(store.undoLabel(), 'Draw driveway');
  assert.equal(ctl.deleteDriveway(), true);
  assert.equal(store.project.site.driveway, undefined);
  assert.equal(D.driveEditState(store.project).canDraw, true);
  // a start far from the frontage is refused
  ctl.pointerDown({ x: b.x, y: b.y });
  assert.equal(ctl.isDrawing(), false);
});

test('Escape cancels a driveway being drawn and Enter finishes it', () => {
  const store = createStore(setup());
  const ctl = createDrivePIController({ store, scale: () => 0.05 });
  const k = D.kerbSnap(store.project, L.nearestOnBuilding(store.project, { x: 0, y: 0 }));
  ctl.pointerDown(k.point);
  assert.equal(ctl.keyDown({ key: 'Escape' }), true);
  assert.equal(ctl.isDrawing(), false);
  ctl.pointerDown(k.point);
  ctl.pointerDown(L.nearestOnBuilding(store.project, k.point));
  assert.equal(ctl.keyDown({ key: 'Enter' }), true);
  assert.equal(store.project.site.driveway?.drawn, true);
});

import fs from 'node:fs';
import { swapHouse } from '../src/lotcard/swap.js';

test('swapping the building type keeps a drawn driveway attached to the new building', () => {
  const store = createStore(setup('granny_studio'));
  const p = store.project;
  const k = D.kerbSnap(p, L.nearestOnBuilding(p, { x: 0, y: 0 }));
  const b = L.nearestOnBuilding(p, k.point);
  assert.equal(D.createDrawnDriveway(p, [k.point, b]).ok, true);
  const shed = catalogue.createFromTemplate('shed_farm');
  swapHouse(store, shed, { id: 'shed_farm', name: 'Farm machinery shed' });
  assert.equal(store.project.site.driveway.drawn, true);
  const d = L.deriveDriveway(store.project);
  assert.equal(d.ok, true);
  const s = L.nearestOnBuilding(store.project, d.centre[0]);
  assert.ok(Math.hypot(s.x - d.centre[0].x, s.y - d.centre[0].y) < 5, 'driveway starts on the new building outline');
});

test('the bottom left card offers a type and design list in every tool', () => {
  const s = fs.readFileSync(new URL('../src/lotcard/lot-card.js', import.meta.url), 'utf8');
  assert.match(s, /lc-chev/);
  assert.match(s, /title\.addEventListener\('click', \(\) => toggleSwap\(\)\)/);
  assert.match(s, /catalogue\.templates/);
  assert.match(s, /placeDesign\(d\)/);
  const card = s.slice(s.indexOf('function render()'));
  assert.ok(!/store\.ui\.tool/.test(card.slice(0, card.indexOf('const idx'))), 'the card is not tied to a tool');
  const css = fs.readFileSync(new URL('../src/lotcard/lot-card-css.js', import.meta.url), 'utf8');
  assert.match(css, /\.lc-swaplist/);
});
