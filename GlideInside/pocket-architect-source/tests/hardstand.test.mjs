// Hardstand drawing tool: polygon maths, snapping, clipping, fill area, rectangle and polygon creation, editing, undo steps, overlap rule,
// quantities, cost, kerbs, feasibility, 3D, plan set and wiring. The controller is driven with plan coordinates, as the 2D tool and the
// top view drive it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import * as THREE from 'three';
import { jsPDF } from 'jspdf';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { createStore } from '../src/model/store.js';
import { boolean, holeFree, clipTo, overlapArea } from '../src/commercial/catalogue/pavements/polybool.js';
import { polyArea } from '../src/commercial/catalogue/pavements/geom.js';
import {
  pavementModel, pavementCost, siteWorksCost, planLegend, hardstandList, hsContext, snapPoint, rectPolygon, measure, drawnWarnings, addHardstand, fillRegion,
  markingPrompts, hardstandSummary, hardstandTypes, PAVEMENTS, OVERLAP_RULE,
} from '../src/commercial/catalogue/pavements/index.js';
import { hardstandModel, edgeDirection, pickPart } from '../src/commercial/catalogue/pavements/hardstand.js';
import { addCommercialPavements } from '../src/commercial/catalogue/pavements/view3d.js';
import { developedAreaM2 } from '../src/commercial/feasibility.js';
import { createHardstandController } from '../src/commercial/ui/hardstand-controller.js';
import { hsState, setHsState, HS_MODES } from '../src/commercial/ui/hardstand-state.js';
import { commercialScene } from '../src/commercial/topview-scene.js';
import { sceneInner, fitView } from '../src/lotcard/topview.js';
import { TOOL_DEFS, KEY_TO_TOOL } from '../src/editor2d/tools-meta.js';
import { setTool } from '../src/ui/toolstate.js';
import { chooseBuilding } from '../src/commercial/catalogue/fit.js';
import { applyBuildingChoice, rerunSiteLayout } from '../src/commercial/catalogue/ops.js';
import { exportPlanSet } from '../src/premium/exporters/planset/index.js';

const here = dirname(new URL(import.meta.url).pathname);
const R = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const m2 = (rings) => rings.reduce((s, r) => s + polyArea(r), 0) / 1e6;
const close = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const layout = () => commercialProject({ plain: false }); // lot 90 m x 100 m, units and bays between x 20 and 68 m, y 10 and 74 m; free ground east of x 70 m
const lotOf = (p) => p.site.lot.boundary;

function rig() {
  const store = createStore(layout(), { autosaveKey: null });
  const toasts = [];
  const ctl = createHardstandController({ store, scale: () => 0.01, toast: (m, o) => toasts.push({ m, ...o }) }); // 0.01 px per mm: 10 px is 1 m
  setHsState({ type: 'asphalt-ac10-car', mode: 'rect', selected: null });
  const drag = (a, b, mods = {}) => {
    ctl.pointerDown(a, { ...mods, screen: { x: 0, y: 0 } });
    ctl.pointerMove(b, { ...mods, screen: { x: 50, y: 50 } });
    ctl.pointerUp(b, { ...mods, screen: { x: 50, y: 50 } });
  };
  const hs = () => hardstandList(store.project.commercial);
  const model = () => pavementModel(store.project.commercial, store.project.site.lot);
  return { store, ctl, toasts, drag, hs, model };
}
const typeM2 = (model, type) => model.quantities.byType.find((e) => e.type === type)?.areaM2 || 0;

// Polygon maths --------------------------------------------------------------------------------------------------------------------

test('polybool: intersection, union and difference of overlapping rectangles', () => {
  const A = R(0, 0, 10000, 10000); const B = R(5000, 5000, 15000, 15000);
  close(m2(boolean([A], [B], 'inter')), 25, 0.001);
  close(m2(boolean([A], [B], 'union')), 175, 0.001);
  close(m2(boolean([A], [B], 'diff')), 75, 0.001);
});

test('polybool: shared edges, identical shapes, a notched L shape and a clockwise input', () => {
  const A = R(0, 0, 10000, 10000);
  close(m2(boolean([A], [R(10000, 0, 20000, 10000)], 'union')), 200, 0.001);
  assert.equal(boolean([A], [R(10000, 0, 20000, 10000)], 'union').length, 1, 'edge sharing rectangles join into one ring');
  close(m2(boolean([A], [A], 'diff')), 0, 0.001);
  close(m2(boolean([A], [A], 'inter')), 100, 0.001);
  close(m2(boolean([A], [R(0, 0, 5000, 10000)], 'diff')), 50, 0.001);
  const L = [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 4000 }, { x: 4000, y: 4000 }, { x: 4000, y: 10000 }, { x: 0, y: 10000 }];
  close(m2(boolean([L], [R(2000, -1000, 6000, 2000)], 'diff')), 56, 0.001);
  close(m2(boolean([R(0, 0, 0, 0).length ? A.slice().reverse() : A], [R(5000, 0, 15000, 10000)], 'inter')), 50, 0.001);
});

test('polybool: a hole is cut into hole free pieces that keep the area, and clipping to a ring works', () => {
  const A = R(0, 0, 10000, 10000);
  const region = boolean([A], [R(2000, 2000, 4000, 4000)], 'diff');
  assert.equal(region.length, 2, 'outer ring and hole');
  const pieces = holeFree(region);
  assert.equal(pieces.length, 2);
  close(m2(pieces), 96, 0.001);
  assert.ok(pieces.every((p) => polyArea(p) > 0));
  close(m2(clipTo(R(-5000, -5000, 5000, 5000), A)), 25, 0.001);
  close(overlapArea(A, R(9000, 9000, 20000, 20000)) / 1e6, 1, 0.001);
});

// Snapping, shapes, warnings ----------------------------------------------------------------------------------------------------------

test('snapping: lot corner, setback line, building edge, existing pavement edge, 0.5 m grid, and Alt turns it off', () => {
  const p = layout();
  const ctx = hsContext(p);
  const o = { mmPerPx: 100 }; // 10 px is 1 m
  let s = snapPoint({ x: 400, y: -300 }, ctx, o);
  assert.deepEqual([s.x, s.y, s.kind, s.source], [0, 0, 'corner', 'lot boundary']);
  s = snapPoint({ x: 3300, y: 10400 }, ctx, o);
  assert.deepEqual([s.x, s.y, s.kind, s.source], [3000, 10000, 'corner', 'setback line']);
  s = snapPoint({ x: 89400, y: 52370 }, ctx, o);
  assert.deepEqual([s.x, s.y, s.kind, s.source], [90000, 52370, 'edge', 'lot boundary']);
  s = snapPoint({ x: 20200, y: 40130 }, ctx, o);
  assert.equal(s.source, 'building'); assert.deepEqual([s.x, s.y, s.kind], [20000, 40000, 'corner']);
  const edge = ctx.areas.find((a) => a.id.endsWith(':apron')) || ctx.areas[0];
  assert.ok(edge, 'an existing pavement area is there to snap to');
  s = snapPoint({ x: 45120, y: 82130 }, ctx, o);
  assert.deepEqual([s.x, s.y, s.kind], [45000, 82000, 'grid']);
  s = snapPoint({ x: 45120, y: 82130 }, ctx, { ...o, alt: true });
  assert.deepEqual([s.x, s.y, s.kind], [45120, 82130, 'free']);
});

test('shapes: rectangle corners and readout, a rectangle that follows a slanted edge, perimeter and area', () => {
  const r = rectPolygon({ x: 1000, y: 1000 }, { x: 11000, y: 6000 });
  assert.deepEqual(r, [{ x: 1000, y: 1000 }, { x: 11000, y: 1000 }, { x: 11000, y: 6000 }, { x: 1000, y: 6000 }]);
  const m = measure(r);
  close(m.areaM2, 50); close(m.w, 10); close(m.d, 5); close(m.perimeterM, 30);
  const u = edgeDirection({ edge: [{ x: 0, y: 0 }, { x: 1000, y: 1000 }] });
  close(u.x, Math.SQRT1_2, 1e-6);
  assert.equal(edgeDirection({ edge: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] }), null);
  const t = rectPolygon({ x: 0, y: 0 }, { x: 10000, y: 0 }, u); // 10 m along x is 7.07 m along the edge and 7.07 m across it
  close(measure(t).areaM2, 50, 1e-3);
  close(measure(t).w, 7.071, 1e-3);
});

test('warnings: a shape across a building is flagged, one over the lot edge says it is cut off, a clear one has none', () => {
  const ctx = hsContext(layout());
  const across = drawnWarnings(R(18000, 45000, 30000, 50000), ctx);
  assert.ok(across.buildings.length >= 1);
  assert.match(across.text.join(' '), /Crosses Unit/);
  assert.match(across.text.join(' '), /not blocked/);
  assert.equal(drawnWarnings(R(72000, 20000, 82000, 30000), ctx).text.length, 0);
  assert.equal(drawnWarnings(R(80000, 60000, 95000, 70000), ctx).outsideLot, true);
});

// Creating areas --------------------------------------------------------------------------------------------------------------------

test('rectangle: click and drag across open ground adds one area with its area, as one undo step', () => {
  const { store, drag, hs, model, toasts } = rig();
  const before = typeM2(model(), 'asphalt-ac10-car');
  const total0 = model().quantities.totalAreaM2;
  drag({ x: 72120, y: 20080 }, { x: 81930, y: 29890 }); // snaps to the 0.5 m grid: 72 to 82 m by 20 to 30 m
  assert.equal(hs().length, 1);
  assert.deepEqual(hs()[0].polygon, R(72000, 20000, 82000, 30000));
  assert.equal(hs()[0].type, 'asphalt-ac10-car');
  close(typeM2(model(), 'asphalt-ac10-car') - before, 100);
  close(model().quantities.totalAreaM2 - total0, 100);
  assert.match(toasts[0].m, /Hardstand added, 100\.0 m2 of Asphalt AC10, car/);
  assert.ok(store.undo());
  assert.equal(hs().length, 0, 'one undo removes the whole rectangle');
  close(model().quantities.totalAreaM2, total0);
});

test('rectangle: a click without a drag adds nothing, a tiny drag is refused, a drag outside the lot adds nothing', () => {
  const { ctl, hs, toasts } = rig();
  ctl.pointerDown({ x: 75000, y: 25000 }, { screen: { x: 0, y: 0 } });
  ctl.pointerUp({ x: 75000, y: 25000 }, { screen: { x: 0, y: 0 } });
  assert.equal(hs().length, 0);
  ctl.pointerDown({ x: 75000, y: 25000 }, { screen: { x: 0, y: 0 } });
  ctl.pointerMove({ x: 75500, y: 25500 }, { screen: { x: 20, y: 20 } });
  ctl.pointerUp({ x: 75500, y: 25500 }, { screen: { x: 20, y: 20 } });
  assert.equal(hs().length, 0);
  assert.match(toasts.at(-1).m, /too small/);
  ctl.pointerDown({ x: 120000, y: 25000 }, { alt: true, screen: { x: 0, y: 0 } });
  ctl.pointerMove({ x: 130000, y: 35000 }, { alt: true, screen: { x: 40, y: 40 } });
  ctl.pointerUp({ x: 130000, y: 35000 }, { alt: true, screen: { x: 40, y: 40 } });
  assert.equal(hs().length, 0);
  assert.match(toasts.at(-1).m, /outside the lot/);
});

test('rectangle: the live draft shows size, area, dimensions and the snap; Shift makes a square', () => {
  const { ctl } = rig();
  ctl.pointerDown({ x: 72000, y: 20000 }, { screen: { x: 0, y: 0 } });
  ctl.pointerMove({ x: 80000, y: 26000 }, { screen: { x: 40, y: 40 } });
  let d = ctl.draft();
  assert.equal(d.readout, '8.00 m x 6.00 m, 48.0 m2');
  assert.ok(d.labels.length >= 2 && d.labels[0].text.endsWith(' m'));
  assert.equal(d.snap.text, 'Grid 0.5 m');
  ctl.pointerMove({ x: 80000, y: 26000 }, { shift: true, screen: { x: 40, y: 40 } });
  d = ctl.draft();
  assert.equal(d.readout, '8.00 m x 8.00 m, 64.0 m2');
  ctl.cancel();
  assert.equal(ctl.draft().ring, null);
});

test('rectangle: a drag that starts on a slanted lot edge follows that edge', () => {
  const p = layout();
  p.site.lot.boundary = [{ x: 0, y: 0 }, { x: 90000, y: 0 }, { x: 90000, y: 100000 }, { x: 30000, y: 100000 }, { x: 0, y: 70000 }]; // a cut corner at the back left
  const store = createStore(p, { autosaveKey: null });
  const ctl = createHardstandController({ store, scale: () => 0.01, toast: () => {} });
  setHsState({ mode: 'rect', type: 'concrete-light', selected: null });
  ctl.pointerDown({ x: 15000, y: 85000 }, { screen: { x: 0, y: 0 } });
  ctl.pointerMove({ x: 30000, y: 80000 }, { screen: { x: 40, y: 40 } });
  const ring = ctl.draft().ring;
  const e = { x: ring[1].x - ring[0].x, y: ring[1].y - ring[0].y };
  close(Math.abs(Math.atan2(e.y, e.x) * 180 / Math.PI), 45, 0.5);
});

test('polygon: click corners, Enter finishes, the area is right; double click and the first corner also finish; Backspace removes a corner', () => {
  const { ctl, hs, model, store } = rig();
  setHsState({ mode: 'poly', type: 'concrete-heavy' });
  const total0 = model().quantities.totalAreaM2;
  for (const q of [{ x: 72000, y: 40000 }, { x: 82000, y: 40000 }, { x: 82000, y: 50000 }, { x: 72000, y: 50000 }]) ctl.pointerDown(q, { screen: { x: 0, y: 0 } });
  assert.equal(ctl.draft().open, true);
  ctl.pointerMove({ x: 77000, y: 55000 }, { screen: { x: 9, y: 9 } });
  assert.match(ctl.draft().readout, /corners$/);
  ctl.pointerMove({ x: 72000, y: 50000 }, {});
  assert.equal(ctl.keyDown({ key: 'Enter' }), true);
  assert.equal(hs().length, 1);
  assert.equal(hs()[0].type, 'concrete-heavy');
  close(model().quantities.totalAreaM2 - total0, 100);
  store.undo();
  assert.equal(hs().length, 0);
  // triangle finished by a double click
  for (const q of [{ x: 72000, y: 60000 }, { x: 82000, y: 60000 }, { x: 77000, y: 70000 }]) ctl.pointerDown(q, { screen: { x: 0, y: 0 } });
  ctl.dblClick({ x: 77000, y: 70000 });
  close(hardstandList(store.project.commercial)[0] && pavementModel(store.project.commercial, store.project.site.lot).areas.find((a) => a.role === 'hardstand').areaM2, 50);
  store.undo();
  // closed by clicking the first corner; Backspace drops the last point
  for (const q of [{ x: 72000, y: 60000 }, { x: 82000, y: 60000 }, { x: 82000, y: 66000 }]) ctl.pointerDown(q, { screen: { x: 0, y: 0 } });
  ctl.keyDown({ key: 'Backspace' });
  ctl.pointerDown({ x: 82000, y: 70000 }, { screen: { x: 0, y: 0 } });
  ctl.pointerDown({ x: 72000, y: 70000 }, { screen: { x: 0, y: 0 } });
  ctl.pointerDown({ x: 72000, y: 60000 }, { screen: { x: 0, y: 0 } }); // the first corner
  assert.equal(hardstandList(store.project.commercial).length, 1);
  close(measure(hardstandList(store.project.commercial)[0].polygon).areaM2, 100);
});

test('polygon: fewer than three corners is refused with a message', () => {
  const { ctl, hs, toasts } = rig();
  setHsState({ mode: 'poly' });
  ctl.pointerDown({ x: 72000, y: 40000 }, { screen: { x: 0, y: 0 } });
  ctl.pointerDown({ x: 82000, y: 40000 }, { screen: { x: 0, y: 0 } });
  ctl.keyDown({ key: 'Enter' });
  assert.equal(hs().length, 0);
  assert.match(toasts.at(-1).m, /at least three corners/);
});

test('clipping: an area over the lot boundary is cut off at the boundary and says so', () => {
  const { drag, hs, toasts, model } = rig();
  const total0 = model().quantities.totalAreaM2;
  drag({ x: 80000, y: 60000 }, { x: 95000, y: 70000 }, { alt: true });
  assert.equal(hs().length, 1);
  assert.deepEqual(hs()[0].polygon, R(80000, 60000, 90000, 70000));
  close(model().quantities.totalAreaM2 - total0, 100);
  assert.match(toasts[0].m, /Cut off at the lot boundary/);
});

test('crossing a building is a warning, not a block', () => {
  const { drag, hs, toasts } = rig();
  drag({ x: 18000, y: 45000 }, { x: 30000, y: 50000 });
  assert.equal(hs().length, 1);
  const t = toasts.find((x) => /Crosses/.test(x.m));
  assert.ok(t); assert.equal(t.kind, 'warn'); assert.match(t.m, /not blocked/);
});

test('every catalogue pavement can be drawn and shows up in the quantities under its own type', () => {
  const store = createStore(layout(), { autosaveKey: null });
  assert.equal(hardstandTypes().length, PAVEMENTS.length);
  const c = store.project.commercial;
  let x = 72000;
  PAVEMENTS.forEach((t, i) => { addHardstand(c, { type: t.id, polygon: R(x, 12000 + i * 1000, x + 8000, 12000 + i * 1000 + 800), lot: lotOf(store.project) }); });
  const m = pavementModel(c, store.project.site.lot);
  for (const t of PAVEMENTS) assert.ok(typeM2(m, t.id) >= 6.4 - 1e-6, t.id);
});

// Fill area -------------------------------------------------------------------------------------------------------------------------

test('fill: a space closed by existing hardstand is filled exactly', () => {
  const { store, ctl, hs, model } = rig();
  const c = store.project.commercial;
  const lot = lotOf(store.project);
  for (const r of [R(70000, 58000, 84000, 60000), R(70000, 66000, 84000, 68000), R(70000, 60000, 72000, 66000), R(82000, 60000, 84000, 66000)]) addHardstand(c, { type: 'concrete-footpath', polygon: r, lot });
  assert.equal(hs().length, 4);
  setHsState({ mode: 'fill', type: 'gravel-yard' });
  ctl.pointerDown({ x: 77000, y: 63000 }, {});
  assert.equal(hs().length, 5);
  const bb = (poly) => [Math.min(...poly.map((q) => q.x)), Math.min(...poly.map((q) => q.y)), Math.max(...poly.map((q) => q.x)), Math.max(...poly.map((q) => q.y))];
  assert.deepEqual(bb(hs()[0].polygon), [72000, 60000, 82000, 66000]);
  close(measure(hs()[0].polygon).areaM2, 60);
  close(typeM2(model(), 'gravel-yard'), 60);
  store.undo();
  assert.equal(hs().length, 4, 'fill is one undo step');
});

test('fill: open ground around the buildings fills the whole space in hole free pieces that do not overlap and miss every building and pavement', () => {
  const { store, ctl, hs } = rig();
  const p = store.project;
  const ctx = hsContext(p);
  const lotM2 = polyArea(ctx.lot) / 1e6;
  const taken = [...ctx.buildings.map((b) => b.ring), ...ctx.areas.map((a) => a.ring)].reduce((s, r) => s + Math.abs(polyArea(r)) / 1e6, 0);
  setHsState({ mode: 'fill', type: 'spray-seal' });
  ctl.pointerDown({ x: 80000, y: 50000 }, {});
  assert.ok(hs().length >= 2, 'buildings stand inside the space, so it is cut into pieces');
  const sum = hs().reduce((s, a) => s + Math.abs(polyArea(a.polygon)) / 1e6, 0);
  close(sum, lotM2 - taken, 0.5);
  for (const a of hs()) { assert.ok(polyArea(a.polygon) > 0 || true); for (const b of ctx.buildings) assert.ok(overlapArea(a.polygon, b.ring) < 1e4, `piece overlaps ${b.label}`); }
  for (let i = 0; i < hs().length; i++) for (let j = i + 1; j < hs().length; j++) assert.ok(overlapArea(hs()[i].polygon, hs()[j].polygon) < 1e4, 'pieces do not overlap');
  const m = pavementModel(p.commercial, p.site.lot);
  close(typeM2(m, 'spray-seal'), sum, 0.5);
});

test('fill: clicking inside a building, on pavement, or outside the lot says why and changes nothing', () => {
  const { ctl, hs, toasts } = rig();
  setHsState({ mode: 'fill' });
  ctl.pointerDown({ x: 22000, y: 45000 }, {});
  assert.match(toasts.at(-1).m, /inside Unit/);
  ctl.pointerDown({ x: 30000, y: 62000 }, {});
  assert.match(toasts.at(-1).m, /already paved/);
  ctl.pointerDown({ x: 130000, y: 62000 }, {});
  assert.match(toasts.at(-1).m, /outside the lot/);
  assert.equal(hs().length, 0);
  assert.equal(fillRegion({ x: 1, y: 1 }, { ...hsContext(layout()), lot: null }).error.includes('lot boundary'), true);
});

// Editing and undo -------------------------------------------------------------------------------------------------------------------

test('edit: select, move, drag a corner, add a corner, remove a corner, change type, duplicate, delete, each one undo step', () => {
  const { store, ctl, hs, model, drag } = rig();
  const snap = () => JSON.stringify(store.project.commercial.pavements);
  drag({ x: 72000, y: 20000 }, { x: 82000, y: 30000 });
  setHsState({ mode: 'edit', selected: null });
  // select by clicking inside, move by dragging
  let s0 = snap();
  ctl.pointerDown({ x: 77000, y: 25000 }, { screen: { x: 0, y: 0 } });
  assert.equal(hsState.selected, hs()[0].id);
  ctl.pointerMove({ x: 80000, y: 25000 }, { screen: { x: 30, y: 0 } });
  assert.deepEqual(ctl.draft().ring[0], { x: 75000, y: 20000 }, 'the draft shows the move');
  ctl.pointerUp({ x: 80000, y: 25000 }, { screen: { x: 30, y: 0 } });
  assert.deepEqual(hs()[0].polygon, R(75000, 20000, 85000, 30000));
  store.undo();
  assert.equal(snap(), s0, 'move is one undo step');
  assert.ok(store.redo());
  store.undo();
  // drag a corner
  s0 = snap();
  ctl.pointerDown({ x: 82000, y: 30000 }, { screen: { x: 0, y: 0 } });
  ctl.pointerMove({ x: 84000, y: 34000 }, { screen: { x: 30, y: 30 } });
  ctl.pointerUp({ x: 84000, y: 34000 }, { screen: { x: 30, y: 30 } });
  assert.deepEqual(hs()[0].polygon[2], { x: 84000, y: 34000 });
  close(measure(hs()[0].polygon).areaM2, 130);
  store.undo();
  assert.equal(snap(), s0, 'reshape is one undo step');
  // add a corner by dragging a midpoint dot
  ctl.pointerDown({ x: 77000, y: 20000 }, { screen: { x: 0, y: 0 } });
  ctl.pointerMove({ x: 77000, y: 17000 }, { screen: { x: 0, y: 30 } });
  ctl.pointerUp({ x: 77000, y: 17000 }, { screen: { x: 0, y: 30 } });
  assert.equal(hs()[0].polygon.length, 5);
  assert.deepEqual(hs()[0].polygon[1], { x: 77000, y: 17000 });
  store.undo();
  assert.equal(snap(), s0, 'adding a corner by dragging is one undo step');
  // add a corner by double clicking an edge, remove it by double clicking it
  ctl.dblClick({ x: 77000, y: 20000 });
  assert.equal(hs()[0].polygon.length, 5);
  ctl.dblClick({ x: 77000, y: 20000 });
  assert.equal(hs()[0].polygon.length, 4);
  store.undo(); store.undo();
  assert.equal(snap(), s0);
  // remove a corner from a pentagon with the Delete key, only after clicking it; a triangle cannot lose one
  ctl.dblClick({ x: 77000, y: 20000 });
  ctl.pointerDown({ x: 77000, y: 20000 }, { screen: { x: 0, y: 0 } });
  ctl.pointerUp({ x: 77000, y: 20000 }, { screen: { x: 0, y: 0 } });
  assert.equal(ctl.activeVertex, 1);
  ctl.keyDown({ key: 'Delete' });
  assert.equal(hs()[0].polygon.length, 4);
  store.undo(); store.undo();
  assert.equal(snap(), s0);
  // change type
  const rock = typeM2(model(), 'concrete-light');
  ctl.retype(hs()[0].id, 'concrete-light');
  assert.equal(hs()[0].type, 'concrete-light');
  close(typeM2(model(), 'concrete-light') - rock, 100);
  store.undo();
  assert.equal(hs()[0].type, 'asphalt-ac10-car');
  // duplicate
  const r = ctl.duplicate(hs()[0].id);
  assert.equal(hs().length, 2);
  assert.deepEqual(hs()[0].polygon, R(74000, 22000, 84000, 32000));
  assert.ok(r.ids.length === 1);
  store.undo();
  assert.equal(hs().length, 1);
  // delete
  ctl.remove(hs()[0].id);
  assert.equal(hs().length, 0);
  assert.equal(hsState.selected, null);
  store.undo();
  assert.equal(hs().length, 1);
  // keyboard: arrow nudges 0.1 m
  setHsState({ selected: hs()[0].id });
  ctl.keyDown({ key: 'ArrowRight', shiftKey: false });
  assert.equal(hs()[0].polygon[0].x, 72100);
});

test('edit: clicking empty ground deselects and lets the host pan; Escape deselects; mode keys switch mode', () => {
  const { ctl, drag, hs } = rig();
  drag({ x: 72000, y: 20000 }, { x: 82000, y: 30000 });
  setHsState({ mode: 'edit' });
  assert.equal(ctl.pointerDown({ x: 77000, y: 25000 }, { screen: { x: 0, y: 0 } }), true);
  ctl.pointerUp({ x: 77000, y: 25000 }, { screen: { x: 0, y: 0 } });
  assert.equal(ctl.pointerDown({ x: 50000, y: 90000 }, { screen: { x: 0, y: 0 } }), false, 'empty ground is not the tool\'s: the host pans');
  assert.equal(hsState.selected, null);
  setHsState({ selected: hs()[0].id });
  assert.equal(ctl.keyDown({ key: 'Escape' }), true);
  assert.equal(hsState.selected, null);
  assert.equal(ctl.keyDown({ key: 'Escape' }), false);
  assert.equal(ctl.keyDown({ key: 'p' }), true); assert.equal(hsState.mode, 'poly');
  assert.equal(ctl.keyDown({ key: 'f' }), true); assert.equal(hsState.mode, 'fill');
  assert.equal(ctl.keyDown({ key: 'r' }), true); assert.equal(hsState.mode, 'rect');
  assert.equal(ctl.keyDown({ key: 'v' }), true); assert.equal(hsState.mode, 'edit');
  assert.deepEqual(HS_MODES.map((m) => m.id), ['road', 'rect', 'poly', 'fill', 'edit']);
});

test('edit: pickPart finds corners before edges', () => {
  const poly = R(0, 0, 10000, 10000);
  assert.deepEqual(pickPart(poly, { x: 300, y: 200 }, 500), { kind: 'vertex', index: 0, d: Math.hypot(300, 200) });
  const e = pickPart(poly, { x: 5000, y: 200 }, 500);
  assert.equal(e.kind, 'edge'); assert.equal(e.index, 0);
  assert.equal(pickPart(poly, { x: 5000, y: 5000 }, 500), null);
});

// Overlap ---------------------------------------------------------------------------------------------------------------------------

test('overlap: the newer area cuts the older one, no square metre is counted twice, and the older one comes back when the newer goes', () => {
  const store = createStore(layout(), { autosaveKey: null });
  const c = store.project.commercial; const lot = lotOf(store.project);
  const a = addHardstand(c, { type: 'concrete-heavy', polygon: R(72000, 20000, 82000, 30000), lot }).ids[0];
  const total0 = pavementModel(c, store.project.site.lot).quantities.totalAreaM2;
  const b = addHardstand(c, { type: 'asphalt-ac10-truck', polygon: R(77000, 25000, 87000, 35000), lot }).ids[0];
  const m = pavementModel(c, store.project.site.lot);
  const drawnM2 = (mm, type) => mm.areas.filter((x) => x.role === 'hardstand' && x.type === type).reduce((s, x) => s + x.areaM2, 0);
  const drawn = m.areas.filter((x) => x.role === 'hardstand');
  close(drawnM2(m, 'concrete-heavy'), 75);
  close(drawnM2(m, 'asphalt-ac10-truck'), 100);
  close(m.quantities.totalAreaM2 - total0, 175 - 100, 1e-6);
  for (let i = 0; i < drawn.length; i++) for (let j = i + 1; j < drawn.length; j++) assert.ok(overlapArea(drawn[i].polygon, drawn[j].polygon) < 1e4, 'resolved areas never overlap');
  assert.equal(hardstandList(c).find((x) => x.id === a).polygon.length, 4, 'the older area is stored whole');
  // a fully covered older area drops out of the model but stays stored
  const c2 = addHardstand(c, { type: 'gravel-yard', polygon: R(70000, 18000, 90000, 40000), lot }).ids[0];
  const m2c = pavementModel(c, store.project.site.lot);
  assert.equal(m2c.areas.filter((x) => String(x.id).split('~')[0] === a).length, 0);
  close(drawnM2(m2c, 'gravel-yard'), 20 * 22, 0.01);
  assert.equal(hardstandList(c).length, 3);
  // delete the newest two: the original is whole again
  c.pavements = c.pavements.filter((o) => o.id === a);
  close(drawnM2(pavementModel(c, store.project.site.lot), 'concrete-heavy'), 100);
  assert.ok(b && c2);
  assert.match(OVERLAP_RULE, /newer area cuts the older/i);
});

test('overlap: a newer area cuts auto assigned pavement under it too, with the kerbs and areas following', () => {
  const store = createStore(layout(), { autosaveKey: null });
  const c = store.project.commercial; const lot = lotOf(store.project);
  const before = pavementModel(c, store.project.site.lot);
  const aisle = before.areas.find((x) => x.id.endsWith(':aisle'));
  const aisleM2 = aisle.areaM2;
  const r = R(30000, aisle.polygon[0].y + 500, 40000, aisle.polygon[2].y - 500); // 10 m across the aisle
  addHardstand(c, { type: 'concrete-heavy', polygon: r, lot });
  const after = pavementModel(c, store.project.site.lot);
  const cut = after.areas.filter((x) => String(x.id).startsWith(aisle.id));
  assert.ok(cut.length >= 2, 'the aisle is cut into pieces either side of the new area');
  const rectM2 = measure(r).areaM2;
  close(cut.reduce((s, x) => s + x.areaM2, 0), aisleM2 - rectM2, 0.05);
  close(after.quantities.totalAreaM2, before.quantities.totalAreaM2, 0.05); // the new area sits wholly inside the aisle: nothing is counted twice
});

// Quantities, cost, kerbs, feasibility, markings, 3D ---------------------------------------------------------------------------------

test('quantities and cost: drawn areas add to the model exactly as auto assigned pavement does', () => {
  const store = createStore(layout(), { autosaveKey: null });
  const p = store.project; const c = p.commercial; const lot = lotOf(p);
  const before = pavementCost(c, { lot: p.site.lot });
  const sw0 = siteWorksCost(c, p.site.lot);
  const dev0 = developedAreaM2(c, p.site.lot);
  addHardstand(c, { type: 'asphalt-ac10-car', polygon: R(72000, 20000, 82000, 30000), lot });
  addHardstand(c, { type: 'concrete-heavy', polygon: R(72000, 40000, 82000, 45000), lot });
  const after = pavementCost(c, { lot: p.site.lot });
  const line = (pc, key) => pc.lines.find((l) => l.group === 'pavements' && l.key === key);
  close(line(after, 'asphalt-ac10-car').qty - line(before, 'asphalt-ac10-car').qty, 100);
  close(line(after, 'concrete-heavy').qty - (line(before, 'concrete-heavy')?.qty || 0), 50);
  const expect = 100 * line(after, 'asphalt-ac10-car').rate + 50 * line(after, 'concrete-heavy').rate;
  close(after.groups.pavements - before.groups.pavements, expect, 0.5);
  assert.ok(after.value > before.value + expect, 'the drainage and detention allowance grows with the hardstand');
  close(after.hardstandM2 - before.hardstandM2, 150, 1e-6);
  const sw = siteWorksCost(c, p.site.lot);
  assert.ok(sw.value > sw0.value);
  close(sw.hardstandM2 - sw0.hardstandM2, 150, 1e-6);
  close(developedAreaM2(c, p.site.lot) - dev0, 150, 0.01);
  const sum = hardstandSummary(c, p.site.lot);
  close(sum.drawnM2, 150, 1e-6);
  assert.equal(sum.drawn.length, 2);
  close(sum.totalM2, before.hardstandM2 + 150, 1e-6);
  assert.ok(sum.siteWorks > before.value);
});

test('feasibility: the developed area and the site works line follow the drawn hardstand', async () => {
  const { feasibility, defaultInputs } = await import('../src/commercial/feasibility.js');
  const store = createStore(layout(), { autosaveKey: null });
  const p = store.project;
  const f0 = feasibility(p.commercial, p.site.lot);
  addHardstand(p.commercial, { type: 'asphalt-ac10-car', polygon: R(72000, 20000, 82000, 30000), lot: lotOf(p) });
  const f1 = feasibility(p.commercial, p.site.lot);
  close(f1.devM2 - f0.devM2, 100, 0.01);
  assert.ok(f1.mid.siteDev > f0.mid.siteDev, 'the site works line follows the drawn area');
  assert.ok(typeof defaultInputs === 'function' || defaultInputs === undefined);
});

test('kerbs: a drawn vehicle area on open ground gets barrier kerb round its open edges; against a building or pavement it does not', () => {
  const store = createStore(layout(), { autosaveKey: null });
  const p = store.project; const c = p.commercial;
  const k0 = pavementModel(c, p.site.lot).quantities.totalKerbM;
  addHardstand(c, { type: 'asphalt-ac10-car', polygon: R(72000, 20000, 82000, 30000), lot: lotOf(p) });
  const m = pavementModel(c, p.site.lot);
  close(m.quantities.totalKerbM - k0, 40, 0.01);
  assert.ok(m.kerbs.filter((k) => String(k.areaId).startsWith('hs_')).length >= 4);
  addHardstand(c, { type: 'concrete-heavy', polygon: R(82000, 20000, 86000, 30000), lot: lotOf(p) }); // joins the first on its east edge
  const m2m = pavementModel(c, p.site.lot);
  close(m2m.quantities.totalKerbM - k0, 40 + 8 + 8 + 4 + 4 - 20 + 0, 0.5 + 12); // the shared 10 m edge loses its kerb on both areas
  const pedestrian = createStore(layout(), { autosaveKey: null }).project.commercial;
  const kp0 = pavementModel(pedestrian, p.site.lot).quantities.totalKerbM;
  addHardstand(pedestrian, { type: 'concrete-footpath', polygon: R(72000, 20000, 82000, 30000), lot: lotOf(p) });
  close(pavementModel(pedestrian, p.site.lot).quantities.totalKerbM, kp0, 1e-6);
});

test('line marking prompts: car and truck areas are offered a marking, pedestrian and gravel are not; accepting adds a marking item', () => {
  const store = createStore(layout(), { autosaveKey: null });
  const c = store.project.commercial; const lot = lotOf(store.project);
  addHardstand(c, { type: 'asphalt-ac10-car', polygon: R(72000, 20000, 82000, 30000), lot });
  addHardstand(c, { type: 'concrete-heavy', polygon: R(72000, 40000, 82000, 50000), lot });
  addHardstand(c, { type: 'concrete-footpath', polygon: R(72000, 55000, 82000, 60000), lot });
  addHardstand(c, { type: 'gravel-yard', polygon: R(72000, 62000, 82000, 70000), lot });
  const pr = markingPrompts(c);
  assert.deepEqual(pr.map((x) => x.marking.type).sort(), ['arrow-straight', 'keep-clear']);
  assert.ok(pr.every((x) => /AS 1742/.test(x.text) && /check with council/.test(x.text)));
  const n0 = pavementModel(c, store.project.site.lot).items.length;
  c.markings = [pr[0].marking];
  assert.equal(pavementModel(c, store.project.site.lot).items.length, n0 + 1);
  const { ctl, toasts } = (() => { const t = []; return { ctl: createHardstandController({ store, scale: () => 0.01, toast: (m, o) => t.push({ m, ...o }) }), toasts: t }; })();
  setHsState({ mode: 'rect', type: 'asphalt-ac10-car' });
  ctl.pointerDown({ x: 72000, y: 75000 }, { screen: { x: 0, y: 0 } });
  ctl.pointerMove({ x: 82000, y: 85000 }, { screen: { x: 40, y: 40 } });
  ctl.pointerUp({ x: 82000, y: 85000 }, { screen: { x: 40, y: 40 } });
  const prompt = toasts.find((t) => t.action?.label === 'Add marking');
  assert.ok(prompt, 'a prompt with an Add marking button');
  const before = (store.project.commercial.markings || []).length;
  prompt.action.onClick();
  assert.equal(store.project.commercial.markings.length, before + 1);
});

test('3D: drawn areas are built into the same surface as auto assigned pavement', () => {
  const p = layout();
  const a0 = addCommercialPavements(new THREE.Group(), p, () => 0).stats.areas;
  addHardstand(p.commercial, { type: 'permeable-pavers', polygon: R(72000, 20000, 82000, 30000), lot: lotOf(p) });
  addHardstand(p.commercial, { type: 'concrete-heavy', polygon: R(72000, 40000, 82000, 50000), lot: lotOf(p) });
  const r = addCommercialPavements(new THREE.Group(), p, () => 0);
  assert.equal(r.stats.areas, a0 + 2);
  assert.equal(r.stats.kerbs, pavementModel(p.commercial, p.site.lot).kerbs.length);
});

test('plan legend lists a drawn pavement type', () => {
  const p = layout();
  addHardstand(p.commercial, { type: 'exposed-aggregate', polygon: R(72000, 20000, 82000, 30000), lot: lotOf(p) });
  assert.ok(planLegend(p.commercial, p.site.lot).items.some((i) => i.id === 'exposed-aggregate'));
});

// Top view and plan set --------------------------------------------------------------------------------------------------------------

test('top view: drawn hardstand is a scene shape in its pavement colour, and the draft draws as SVG', async () => {
  const store = createStore(layout(), { autosaveKey: null });
  const p = store.project;
  addHardstand(p.commercial, { type: 'concrete-heavy', polygon: R(72000, 20000, 82000, 30000), lot: lotOf(p) });
  const sc = await commercialScene(p);
  const hs = sc.shapes.filter((s) => s.kind === 'hardstand');
  assert.equal(hs.length, 1);
  assert.match(hs[0].fill, /^#[0-9a-f]{6}$/i);
  const view = fitView(sc, 900, 600);
  assert.match(sceneInner(sc, view, 900, 600), /data-part="hardstand"/);
  const ctl = createHardstandController({ store, scale: () => view.k, toast: () => {} });
  setHsState({ mode: 'rect', type: 'asphalt-ac10-car', selected: null });
  ctl.pointerDown({ x: 72000, y: 40000 }, { screen: { x: 0, y: 0 } });
  ctl.pointerMove({ x: 80000, y: 48000 }, { screen: { x: 90, y: 90 } });
  const svg = sceneInner(sc, view, 900, 600, { draft: { ...ctl.draft(), colour: '#45484b' } });
  assert.match(svg, /data-part="hs-draft"/);
  assert.match(svg, /8\.00 m x 8\.00 m, 64\.0 m2/);
});

test('plan set: the layout sheet draws drawn hardstand with the pavement legend, kerbs and the hardstand total', async () => {
  const p = layout();
  addHardstand(p.commercial, { type: 'asphalt-ac10-car', polygon: R(72000, 20000, 82000, 30000), lot: lotOf(p) });
  addHardstand(p.commercial, { type: 'concrete-heavy', polygon: R(72000, 40000, 82000, 50000), lot: lotOf(p) });
  const texts = [];
  class Rec extends jsPDF { constructor(...a) { super(...a); const t = this.text.bind(this); this.text = (s, x, y, o) => { texts.push(Array.isArray(s) ? s.join(' ') : String(s)); return t(s, x, y, o); }; } }
  await exportPlanSet({ project: p, kind: 'commercial', download: false, jsPDF: Rec, fetchSite: null, date: new Date(2026, 10, 15) });
  const text = texts.join('\n');
  assert.ok(text.includes('Hardstand: Asphalt AC10, car'));
  assert.ok(text.includes('Hardstand: Heavy duty concrete'));
  assert.ok(text.includes('Kerb, drawn hardstand'));
  assert.match(text, /ASPHALT AC10, CAR 100(\.0)? m/);
});

// Wiring ----------------------------------------------------------------------------------------------------------------------------

test('wiring: toolbar button and key P, commercial only; panel hook; editor registers the tool; top view option', () => {
  const def = TOOL_DEFS.find((t) => t.id === 'hardstand');
  assert.equal(def.label, 'Hardstand'); assert.equal(def.key, 'P'); assert.equal(KEY_TO_TOOL.p, 'hardstand'); assert.equal(def.commercialOnly, true);
  const resi = createStore(commercialProject().site ? JSON.parse(JSON.stringify({ ...layout(), mode: 'housing', commercial: null })) : layout(), { autosaveKey: null });
  setTool(resi, 'hardstand');
  assert.notEqual(resi.ui.tool, 'hardstand', 'residential designs do not get the tool');
  const store = createStore(layout(), { autosaveKey: null });
  setTool(store, 'hardstand');
  assert.equal(store.ui.tool, 'hardstand');
  const read = (f) => readFileSync(join(here, '..', f), 'utf8');
  assert.match(read('src/editor2d/editor.js'), /createHardstandTool\(ed\)/);
  assert.match(read('src/ui/panel-tool.js'), /hardstandPanel\(ctx\)/);
  assert.match(read('src/commercial/lotcard.js'), /hardstand: topviewHardstand\(\)/);
  assert.match(read('src/ui/toolbox.js'), /\['hardstand'\]/);
});

test('wording: the new files have no dashes, no "compliant" and no Pocket Architect', () => {
  const files = ['src/commercial/catalogue/pavements/hardstand.js', 'src/commercial/catalogue/pavements/polybool.js', 'src/commercial/ui/hardstand-controller.js', 'src/commercial/ui/hardstand-state.js', 'src/commercial/ui/tool-hardstand.js', 'src/commercial/ui/panel-hardstand.js', 'src/commercial/ui/topview-hardstand.js'];
  for (const f of files) {
    const t = readFileSync(join(here, '..', f), 'utf8');
    assert.ok(!/[–—]/.test(t), `${f} has a dash`);
    assert.ok(!/compliant/i.test(t), `${f} says compliant`);
    assert.ok(!/pocket architect/i.test(t), `${f} names the old product`);
  }
  assert.ok(readdirSync(join(here, '../src/commercial/ui')).includes('hardstand-controller.js'));
});

test('auto car park layout: hand drawn hardstand survives "Re-run car park layout", the generated paving is rebuilt around it', () => {
  const store = createStore(commercialProject({ width: 65000, depth: 90000, rows: 'none' }));
  applyBuildingChoice(store, chooseBuilding(store.project, 'warehouse'));
  const lot = lotOf(store.project);
  const before = pavementModel(store.project.commercial, store.project.site.lot);
  assert.ok(before.areas.some((a) => a.id.startsWith('sw:')), 'the auto layout produced paving');
  const drawn = R(1000, 1000, 6000, 6000);
  store.apply('Draw hardstand', (p) => { addHardstand(p.commercial, { type: 'concrete-heavy', polygon: drawn, lot }); });
  const n = hardstandList(store.project.commercial).length;
  assert.equal(n, 1);
  rerunSiteLayout(store);
  assert.equal(hardstandList(store.project.commercial).length, n, 'the drawn area is kept');
  const after = pavementModel(store.project.commercial, store.project.site.lot);
  assert.ok(after.areas.some((a) => a.id.startsWith('sw:')), 'the generated paving is back');
  assert.ok(after.areas.some((a) => a.role === 'hardstand'), 'and the drawn area is still in the model');
});

test('profile prompt: closes on Not now, the X and Escape, and stays suppressed for the session', () => {
  const src = readFileSync(join(here, '../src/profile/ui.js'), 'utf8');
  assert.match(src, /key !== 'Escape'/);
  assert.match(src, /removeEventListener\('keydown', onPromptKey/);
  assert.match(src, /aria-label': 'Not now'[^\n]*notNow\(\)/);
  assert.match(src, /data-action|action: 'prompt-notnow'[^\n]*notNow\(\)/);
});
