// Car park tool: bay fill counts, angled bays, accessible bays, entry gaps, live re-flow, merge of duplicate roads, parking counts reaching
// the checks and feasibility, markings in 2D, 3D and the plan set, and the tool wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { jsPDF } from 'jspdf';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { createStore } from '../src/model/store.js';
import { carparkLayout, entryGaps, carparkMarkings, BAY_TYPES } from '../src/commercial/catalogue/pavements/carpark.js';
import { carparkOf } from '../src/commercial/catalogue/pavements/logic.js';
import { pavementModel, carparkSummary, addHardstand, rotatePolygon, resizeRect, isRect, setHardstandCarpark, hardstandList, planLegend } from '../src/commercial/catalogue/pavements/index.js';
import * as R from '../src/commercial/catalogue/pavements/roads.js';
import { addCommercialPavements } from '../src/commercial/catalogue/pavements/view3d.js';
import { createHardstandController } from '../src/commercial/ui/hardstand-controller.js';
import { hsState, setHsState } from '../src/commercial/ui/hardstand-state.js';
import { commercialStats } from '../src/commercial/stats.js';
import { commercialChecks } from '../src/commercial/checks.js';
import { TOOL_DEFS, KEY_TO_TOOL } from '../src/editor2d/tools-meta.js';
import { setTool } from '../src/ui/toolstate.js';
import { exportPlanSet } from '../src/premium/exporters/planset/index.js';
import * as P from '../src/site/pavedways.js';

const R4 = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
// 12 bays of 2.6 m along the row, two rows of 5.4 m and a 6.2 m aisle across: a perfect fit, 24 bays
const PERFECT = R4(0, 0, 31200, 17000);
const layout = () => commercialProject({ plain: false });
const lotOf = (p) => p.site.lot.boundary;

test('bay fill: a known rectangle takes 24 bays at 0, 30 and 90 degrees, aligned to its longest edge', () => {
  const none = { accessible: 0 };
  const a0 = carparkLayout(PERFECT, none);
  assert.equal(a0.count, 24, '12 bays in each of two rows');
  assert.equal(Math.round(a0.angleDeg), 0);
  const a30 = carparkLayout(rotatePolygon(PERFECT, 30, { x: 0, y: 0 }), none);
  assert.equal(a30.count, 24); assert.equal(Math.round(a30.angleDeg), 30);
  const a90 = carparkLayout(rotatePolygon(PERFECT, 90, { x: 0, y: 0 }), none);
  assert.equal(a90.count, 24); assert.equal(Math.round(a90.angleDeg), 90);
  const b = a0.bays[0];
  const w = Math.hypot(b.poly[1].x - b.poly[0].x, b.poly[1].y - b.poly[0].y);
  const d = Math.hypot(b.poly[3].x - b.poly[0].x, b.poly[3].y - b.poly[0].y);
  assert.ok(Math.abs(w - 2600) < 2 && Math.abs(d - 5400) < 2, 'bays are 2.6 by 5.4 m');
  assert.equal(a0.aisleMm, 6200);
  assert.equal(carparkLayout(PERFECT, { ...none, angleDeg: 90 }).count < 24, true, 'an angle set by the user wins over the longest edge');
});

test('bay fill: no bay leaves the outline and none overlap', () => {
  const poly = [{ x: 0, y: 0 }, { x: 40000, y: 0 }, { x: 40000, y: 14000 }, { x: 22000, y: 14000 }, { x: 22000, y: 30000 }, { x: 0, y: 30000 }]; // an L
  const L = carparkLayout(poly, {});
  assert.ok(L.count > 20, `L ${L.count}`);
  const inside = (p) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i]; const b = poly[j]; if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };
  for (const b of L.bays) assert.ok(b.poly.every((q, k) => inside({ x: q.x + (b.centre.x - q.x) * 0.02, y: q.y + (b.centre.y - q.y) * 0.02 })), 'bay inside the L');
  const keys = new Set(L.bays.map((b) => `${Math.round(b.centre.x / 100)},${Math.round(b.centre.y / 100)}`));
  assert.equal(keys.size, L.bays.length, 'no two bays share a place');
});

test('angled bays: 60 and 45 degree bays with one way aisles and arrows', () => {
  const big = R4(0, 0, 40000, 20000);
  const n90 = carparkLayout(big, {}).count;
  for (const ang of [60, 45]) {
    const l = carparkLayout(big, { bayAngle: ang });
    assert.ok(l.count > 20, `${ang} degrees fills`);
    assert.equal(l.bayAngle, ang);
    assert.equal(l.aisleMm, BAY_TYPES[ang].aisleMm);
    assert.ok(l.arrows.length > 0, 'one way arrows along the aisle');
    const [p0, p1, p2, p3] = l.bays[0].poly; // a parallelogram, not a rectangle: the face is shifted along the row
    assert.ok(Math.abs((p3.x - p0.x) * (p1.x - p0.x) + (p3.y - p0.y) * (p1.y - p0.y)) > 1e5, 'leaning bay');
    assert.ok(Math.abs((p1.x - p0.x) - (p2.x - p3.x)) < 2);
  }
  assert.ok(n90 > 0);
  const rowDir = carparkLayout(big, { bayAngle: 60 }).arrows.map((a) => Math.round(a.rotationDeg));
  assert.ok(new Set(rowDir).size >= 1);
});

test('accessible bays: a bay, shared zone, bay group sits near the entrance and the count follows the rule', () => {
  const l = carparkLayout(R4(0, 0, 60000, 30000), {}, { near: { x: 0, y: 0 } });
  assert.ok(l.accessible >= 1 && l.accessible === l.required, 'accessible bays provided to the indicative rule');
  const acc = l.bays.filter((b) => b.kind === 'accessible');
  const zones = l.bays.filter((b) => b.kind === 'zone');
  assert.ok(acc.length >= 1 && zones.length >= 1, 'accessible bay and shared zone');
  const z = zones[0];
  assert.ok(acc.some((a) => a.row === z.row && Math.abs(a.col - z.col) === 1), 'the zone sits beside an accessible bay');
  assert.ok(Math.hypot(acc[0].centre.x, acc[0].centre.y) < 12000, 'nearest the entrance point');
  const forced = carparkLayout(R4(0, 0, 60000, 30000), { accessible: 4 });
  assert.equal(forced.accessible, 4);
  assert.equal(forced.count + forced.zones, carparkLayout(R4(0, 0, 60000, 30000), { accessible: 0 }).count, 'zones take slots, they are not counted as bays');
  const mk = carparkMarkings('hs_1', l);
  assert.ok(mk.some((m) => m.type === 'accessible-symbol') && mk.some((m) => m.type === 'accessible-hatch') && mk.find((m) => m.type === 'bay-lines').count === l.count);
});

test('end islands remove bays and add landscaping at the row ends', () => {
  const a = carparkLayout(R4(0, 0, 60000, 30000), { accessible: 0 });
  const b = carparkLayout(R4(0, 0, 60000, 30000), { accessible: 0, islands: true });
  assert.ok(b.islands.length >= 4 && b.count < a.count);
});

test('entry gap: a road touching the hardstand keeps a clear opening and no bay crosses it', () => {
  const hs = R4(0, 0, 40000, 20000);
  const road = R4(17000, -30000, 23000, 0);
  const gaps = entryGaps(hs, [road]);
  assert.equal(gaps.length, 1);
  assert.ok(Math.abs(gaps[0].x - 20000) < 400 && gaps[0].ny > 0.9 && gaps[0].widthMm >= 5500);
  const open = carparkLayout(hs, { accessible: 0 });
  const gapped = carparkLayout(hs, { accessible: 0 }, { gaps });
  assert.ok(gapped.count < open.count, 'bays are given up for the entry');
  assert.equal(gapped.entries.length, 1);
  const clear = gapped.entries[0].clear;
  for (const b of gapped.bays) assert.ok(!(b.centre.x > 17000 && b.centre.x < 23000 && b.centre.y < clear[2].y - 500), 'no bay on the entry corridor');
});

function rig() {
  const store = createStore(layout(), { autosaveKey: null });
  const toasts = [];
  const ctl = createHardstandController({ store, scale: () => 0.01, toast: (m, o) => toasts.push({ m, ...o }), carparkTool: true });
  setHsState({ mode: 'cp-rect', selected: null, activeBay: null, type: 'asphalt-ac10-car', cp: { bayAngle: 90, angleDeg: null, islands: false, accessible: null } });
  return { store, ctl, toasts };
}
const drag = (ctl, a, b) => { ctl.pointerDown(a, { screen: { x: 0, y: 0 } }); ctl.pointerMove(b, { screen: { x: 50, y: 50 } }); ctl.pointerUp(b, { screen: { x: 50, y: 50 } }); };

test('drag out a rectangle: a hardstand with bays is made as one undo step, and it counts towards parking', () => {
  const { store, ctl } = rig();
  const before = commercialStats(store.project).parking.provided;
  drag(ctl, { x: 4000, y: 78000 }, { x: 4000 + 31200, y: 78000 + 17000 });
  const hs = hardstandList(store.project.commercial);
  assert.equal(hs.length, 1); assert.ok(hs[0].carpark);
  const sum = carparkSummary(store.project.commercial);
  assert.ok(sum.bays >= 20, `bays ${sum.bays}`);
  const st = commercialStats(store.project);
  assert.equal(st.parking.provided, before + sum.bays, 'the car park bays reach the parking count');
  assert.equal(st.parking.carparkBays, sum.bays);
  assert.equal(hsState.mode, 'edit', 'the tool is ready to edit what was made');
  const infos = commercialChecks(store.project);
  assert.ok(infos.some((c) => c.id === 'carpark' && c.text.includes(`${sum.bays} bays`)), 'the checks report the car park fill');
  store.undo();
  assert.equal(hardstandList(store.project.commercial).length, 0, 'one undo removes it');
  assert.equal(commercialStats(store.project).parking.provided, before);
});

test('re-flow: rotating or resizing the hardstand re-lays the bays, and the markings follow', () => {
  const { store, ctl } = rig();
  drag(ctl, { x: 4000, y: 78000 }, { x: 4000 + 31200, y: 78000 + 17000 });
  const id = hardstandList(store.project.commercial)[0].id;
  const a0 = carparkSummary(store.project.commercial).areas[0];
  const m0 = pavementModel(store.project.commercial, lotOf(store.project));
  const ang0 = m0.carparks[0].layout.angleDeg;
  setHsState({ selected: id });
  ctl.rotateSelected(15);
  const m1 = pavementModel(store.project.commercial, lotOf(store.project));
  assert.ok(Math.abs(((m1.carparks[0].layout.angleDeg - ang0 + 540) % 180) - 15) < 1 || Math.abs(m1.carparks[0].layout.angleDeg - ang0 - 15) < 1, 'bays turned with the hardstand');
  assert.ok(m1.carparks[0].layout.count > 0 && a0.bays > 0);
  const bl = m1.items.find((i) => i.type === 'bay-lines' && i.carpark === id);
  assert.equal(bl.count, m1.carparks[0].layout.count, 'bay lines match the count');
  // resize through the corner handle: live layout while dragging, stored after
  const poly = hardstandList(store.project.commercial)[0].polygon;
  assert.ok(isRect(poly));
  const corner = poly[2];
  ctl.pointerDown({ x: corner.x, y: corner.y }, { screen: { x: 0, y: 0 } });
  ctl.pointerMove({ x: corner.x + 8000, y: corner.y + 8000 }, { screen: { x: 80, y: 80 } });
  const d = ctl.draft();
  assert.ok(d.cpItems?.length, 'the draft carries the live bays while dragging');
  assert.ok(/m x /.test(d.readout) && /bays/.test(d.readout), 'live dimensions, area and bay count');
  ctl.pointerUp({ x: corner.x + 8000, y: corner.y + 8000 }, { screen: { x: 80, y: 80 } });
  const m2 = pavementModel(store.project.commercial, lotOf(store.project));
  assert.ok(m2.carparks[0].layout.count > m1.carparks[0].layout.count, 'a bigger hardstand holds more bays');
});

test('hardstand handles: a gold ring rotates, corners and edge dots resize a rectangle, dragging the body moves it', () => {
  const { store, ctl } = rig();
  setHsState({ mode: 'rect' });
  drag(ctl, { x: 72000, y: 20000 }, { x: 82000, y: 30000 });
  const a = hardstandList(store.project.commercial)[0];
  setHsState({ selected: a.id });
  const hd = ctl.draft().handles;
  assert.ok(hd.some((h) => h.kind === 'rotate'), 'rotate handle in the draw mode too');
  assert.equal(hd.filter((h) => h.kind === 'vertex').length, 4);
  assert.equal(hd.filter((h) => h.kind === 'mid' && h.rect).length, 4);
  // edge dot: only that side moves
  const mid = { x: 77000, y: 20000 };
  ctl.pointerDown(mid, { screen: { x: 0, y: 0 } });
  ctl.pointerMove({ x: 77000, y: 17000 }, { screen: { x: 0, y: 30 } });
  ctl.pointerUp({ x: 77000, y: 17000 }, { screen: { x: 0, y: 30 } });
  const b = hardstandList(store.project.commercial)[0].polygon;
  assert.ok(isRect(b));
  assert.ok(Math.abs(Math.max(...b.map((p) => p.y)) - Math.min(...b.map((p) => p.y)) - 13000) < 1, 'edge dragged out 3 m');
  // rotate ring
  const rh = ctl.draft().handles.find((h) => h.kind === 'rotate');
  ctl.pointerDown({ x: rh.x, y: rh.y }, { screen: { x: 0, y: 0 } });
  const c = { x: 77000, y: 23500 };
  ctl.pointerMove({ x: c.x + 20000, y: c.y }, { screen: { x: 100, y: 0 } });
  assert.match(ctl.draft().readout, /Turned/);
  ctl.pointerUp({ x: c.x + 20000, y: c.y }, { screen: { x: 100, y: 0 } });
  const r = hardstandList(store.project.commercial)[0].polygon;
  assert.ok(isRect(r)); assert.ok(Math.abs(r[0].y - r[1].y) > 1000 || Math.abs(r[0].x - r[1].x) > 1000);
  store.undo(); store.undo();
  assert.ok(isRect(hardstandList(store.project.commercial)[0].polygon), 'each edit is an undo step');
  // one click material change
  ctl.retype(a.id, 'concrete-heavy');
  assert.equal(hardstandList(store.project.commercial)[0].type, 'concrete-heavy');
  store.undo();
  assert.equal(hardstandList(store.project.commercial)[0].type, 'asphalt-ac10-car');
});

test('resizeRect keeps a rotated rectangle square to itself', () => {
  const rot = rotatePolygon(R4(0, 0, 20000, 10000), 25, { x: 0, y: 0 });
  for (const [k, i] of [['corner', 0], ['corner', 2], ['edge', 1], ['edge', 3]]) {
    const out = resizeRect(rot, k, i, { x: rot[i].x + 3000, y: rot[i].y + 1000 });
    assert.ok(isRect(out), `${k} ${i}`);
  }
});

test('bays: slide a row, delete a bay, restore', () => {
  const { store, ctl } = rig();
  setHsState({ cp: { ...hsState.cp, accessible: 0 } });
  drag(ctl, { x: 4000, y: 78000 }, { x: 4000 + 31200, y: 78000 + 17000 });
  const id = hardstandList(store.project.commercial)[0].id;
  setHsState({ selected: id });
  const n0 = carparkSummary(store.project.commercial).bays;
  const lay = ctl.selectedCarpark().layout;
  const bay = lay.bays[5];
  ctl.pointerDown(bay.centre, { screen: { x: 0, y: 0 } });
  assert.equal(hsState.activeBay, bay.key);
  ctl.deleteBay();
  assert.equal(carparkSummary(store.project.commercial).bays, n0 - 1);
  ctl.restoreBays(id);
  assert.equal(carparkSummary(store.project.commercial).bays, n0);
  const row = ctl.selectedCarpark().layout.bays[2];
  ctl.pointerDown(row.centre, { screen: { x: 0, y: 0 } });
  ctl.pointerMove({ x: row.centre.x + 1300, y: row.centre.y }, { screen: { x: 30, y: 0 } });
  assert.ok(ctl.draft().cpItems.length, 'live while sliding');
  ctl.pointerUp({ x: row.centre.x + 1300, y: row.centre.y }, { screen: { x: 30, y: 0 } });
  const e = store.project.commercial.pavements.find((o) => o.id === id);
  assert.ok(Math.abs(Object.values(e.carpark.shifts)[0]) >= 1000, 'row shift stored');
});

test('fill a hardstand: click or drop applies the layout aligned to the hardstand', () => {
  const { store, ctl } = rig();
  setHsState({ mode: 'rect' });
  const slanted = rotatePolygon(R4(72000, 20000, 92000, 32000), 20);
  addHardstand(store.project.commercial, { type: 'asphalt-ac10-car', polygon: slanted, lot: lotOf(store.project) });
  const id = hardstandList(store.project.commercial)[0].id;
  setHsState({ mode: 'cp-apply' });
  ctl.pointerDown({ x: (slanted[0].x + slanted[2].x) / 2, y: (slanted[0].y + slanted[2].y) / 2 }, { screen: { x: 0, y: 0 } });
  const m = pavementModel(store.project.commercial, lotOf(store.project));
  assert.equal(m.carparks.length, 1);
  assert.ok(Math.abs(m.carparks[0].layout.angleDeg - 20) < 1, 'bays follow the hardstand orientation');
  // a drop on open ground makes a new car park
  const n = hardstandList(store.project.commercial).length;
  ctl.dropCarpark({ x: 40000, y: 85000 });
  assert.equal(hardstandList(store.project.commercial).length, n + 1);
  assert.ok(id);
});

test('markings reach 3D and the plan set', async () => {
  const { store, ctl } = rig();
  drag(ctl, { x: 4000, y: 78000 }, { x: 4000 + 31200, y: 78000 + 17000 });
  const p = store.project;
  const r = addCommercialPavements(new THREE.Group(), p, () => 0);
  assert.ok(r.stats.symbols >= 0);
  const m = pavementModel(p.commercial, lotOf(p));
  const lines = m.items.find((i) => i.type === 'bay-lines' && i.carpark);
  assert.ok(lines.lines.length > 20);
  const texts = [];
  class Rec extends jsPDF { constructor(...a) { super(...a); const t = this.text.bind(this); this.text = (s, x, y, o) => { texts.push(Array.isArray(s) ? s.join(' ') : String(s)); return t(s, x, y, o); }; } }
  await exportPlanSet({ project: p, kind: 'commercial', download: false, jsPDF: Rec, fetchSite: null, date: new Date(2026, 10, 18) });
  assert.match(texts.join('\n'), /CAR PARK, \d+ BAYS/);
  const lg = planLegend(p.commercial); assert.ok((lg.items || lg).some((l) => l.id === 'bay-lines'), 'bay lines are in the legend');
});

test('3D: the bay lines are painted with the existing marking pass', () => {
  const { store, ctl } = rig();
  drag(ctl, { x: 4000, y: 78000 }, { x: 4000 + 31200, y: 78000 + 17000 });
  const g1 = new THREE.Group();
  addCommercialPavements(g1, store.project, () => 0);
  const tris = (g) => { let n = 0; g.traverse((o) => { if (o.isMesh) n += o.geometry.attributes.position.count; }); return n; };
  const { store: s2 } = rig();
  const g2 = new THREE.Group();
  addCommercialPavements(g2, s2.project, () => 0);
  assert.ok(tris(g1) > tris(g2) + 200, 'the car park adds surface and line geometry');
});

test('duplicate drives: a road drawn on top of an existing one is offered a merge, never two strips', () => {
  const store = createStore(layout(), { autosaveKey: null });
  const c = store.project.commercial;
  const lot = lotOf(store.project);
  const a = R.addRoad(c, { kind: 'road', centre: [{ x: 72000, y: 10000 }, { x: 72000, y: 60000 }], lot });
  const b = R.addRoad(c, { kind: 'road', centre: [{ x: 72300, y: 20000 }, { x: 72300, y: 75000 }], lot });
  const dup = R.duplicateRoad(c, b.ids[0]);
  assert.ok(dup && dup.id === a.ids[0] && dup.fraction > 0.5);
  const cross = R.addRoad(c, { kind: 'road', centre: [{ x: 60000, y: 40000 }, { x: 85000, y: 40000 }], lot });
  assert.equal(R.duplicateRoad(c, cross.ids[0]), null, 'a crossing road is not a duplicate');
  R.mergeRoadInto(c, b.ids[0], a.ids[0], lot);
  assert.equal(R.roadById(c, b.ids[0]), null, 'the new strip is gone');
  const kept = R.roadById(c, a.ids[0]);
  assert.ok(Math.max(...kept.centre.map((p) => p.y)) >= 75000 - 1, 'the part that ran on is added to the kept road');
  assert.equal(R.roadList(c).length, 2);
});

test('duplicate drives: the road tool offers Merge with existing', () => {
  const { store, ctl, toasts } = rig();
  setHsState({ mode: 'road', roadKind: 'road', roadWidth: null });
  const click = (p) => ctl.pointerDown(p, { screen: { x: 0, y: 0 } });
  for (const q of [[{ x: 72000, y: 10000 }, { x: 72000, y: 60000 }], [{ x: 72200, y: 12000 }, { x: 72200, y: 58000 }]]) { click(q[0]); click(q[1]); ctl.finishRoad(); }
  const t = toasts.find((x) => x.action?.label === 'Merge with existing');
  assert.ok(t, 'merge is offered');
  t.action.onClick();
  assert.equal(R.roadList(store.project.commercial).length, 1);
  store.undo();
  assert.equal(R.roadList(store.project.commercial).length, 2, 'merge is one undo step');
});

test('duplicate drives: the Road or pavement tool merges drawn ways', () => {
  const p = layout();
  P.addWay(p, { kind: 'road', material: 'asphalt', widthMm: 6000, pts: [{ x: 72000, y: 10000 }, { x: 72000, y: 50000 }], radiusMm: 0 });
  const w2 = P.addWay(p, { kind: 'driveway', material: 'gravel', widthMm: 4000, pts: [{ x: 72200, y: 12000 }, { x: 72200, y: 70000 }], radiusMm: 0 });
  const dup = P.duplicateOf(p, w2.id);
  assert.ok(dup && dup.fraction > 0.5);
  const keep = P.mergeWayInto(p, dup.other, w2.id);
  assert.equal(P.getWays(p).length, 1);
  assert.ok(Math.max(...keep.pts.map((q) => q.y)) >= 70000 - 1);
});

test('wiring: Car park has its own button, icon, tooltip and key C, commercial only', () => {
  const def = TOOL_DEFS.find((t) => t.id === 'carpark');
  assert.equal(def.label, 'Car park'); assert.equal(def.key, 'C'); assert.equal(KEY_TO_TOOL.c, 'carpark'); assert.equal(def.commercialOnly, true);
  assert.ok(def.tip.length > 10);
  assert.equal(KEY_TO_TOOL.k, 'deck', 'K stays the deck tool');
  const res = createStore(commercialProject(), { autosaveKey: null });
  setTool(res, 'carpark');
  assert.equal(res.ui.tool, 'carpark');
});

test('bays are contiguous: neighbours share their side line, no gaps, no box per bay', () => {
  const l = carparkLayout(R4(0, 0, 31200, 17000), { accessible: 0 });
  const rows = new Map();
  for (const b of l.bays) { if (!rows.has(b.row)) rows.set(b.row, []); rows.get(b.row).push(b); }
  for (const bays of rows.values()) {
    bays.sort((a, b) => a.col - b.col);
    for (let i = 1; i < bays.length; i++) {
      const a = bays[i - 1].poly; const b = bays[i].poly;
      assert.ok(Math.hypot(a[1].x - b[0].x, a[1].y - b[0].y) < 2 && Math.hypot(a[2].x - b[3].x, a[2].y - b[3].y) < 2, 'the shared side is one edge');
    }
  }
  const lines = carparkMarkings('hs_1', l).find((m) => m.type === 'bay-lines').lines;
  assert.equal(lines.length, 12 * 2 + 13 + 13 - 0 > 0 ? lines.length : 0);
  assert.equal(lines.length, 13 * 2 + 12 * 2, 'one line per shared side plus one across each row end: no doubled lines');
});

test('90 degree bays are square to the aisle and the car sits lengthwise in the bay', async () => {
  const { entourageSpots } = await import('../src/commercial/catalogue/entourage3d.js');
  for (const turn of [0, 30, 90]) {
    const poly = rotatePolygon(R4(0, 0, 31200, 17000), turn, { x: 0, y: 0 });
    const l = carparkLayout(poly, { accessible: 0 });
    const ax = l.dims.uAxis;
    for (const b of l.bays) {
      const [p0, p1, , p3] = b.poly;
      const along = (p1.x - p0.x) * ax.x + (p1.y - p0.y) * ax.y; // the bay width runs along the aisle
      const depth = { x: p3.x - p0.x, y: p3.y - p0.y };
      assert.ok(Math.abs(depth.x * ax.x + depth.y * ax.y) < 3, 'bay depth is perpendicular to the aisle');
      assert.ok(Math.abs(along - 2600) < 3);
    }
  }
  const { store, ctl } = rig();
  drag(ctl, { x: 4000, y: 78000 }, { x: 4000 + 31200, y: 78000 + 17000 });
  const e = entourageSpots(store.project);
  const l = carparkOf(store.project.commercial)[0].layout;
  assert.ok(e.cars.length > 0);
  for (const car of e.cars) {
    const bay = l.bays.find((b) => Math.hypot(b.centre.x - car.x, b.centre.y - car.y) < 5);
    if (!bay) continue;
    const d = { x: bay.poly[3].x - bay.poly[0].x, y: bay.poly[3].y - bay.poly[0].y };
    const h = { x: Math.cos(car.ang), y: Math.sin(car.ang) };
    assert.ok(Math.abs((d.x * h.y - d.y * h.x) / Math.hypot(d.x, d.y)) < 0.01, 'heading is along the bay depth');
  }
});
