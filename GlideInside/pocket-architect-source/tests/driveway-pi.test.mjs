// Driveway PI tool (residential): add, move and delete PIs on the stored driveway, the end points staying attached, reset to auto, undo,
// persistence, and the controller that the plan tool drives.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/model/schema.js';
import { createStore } from '../src/model/store.js';
import { catalogue } from '../src/catalogue/index.js';
import { placeHouse } from '../src/portal/place-house.js';
import { lotEnvelope, portalLotToSiteLot, SAMPLE_LOT } from '../src/portal/envelope.js';
import { autoPose } from '../src/portal/auto-place.js';
import * as L from '../src/site/lotplan.js';
import * as D from '../src/site/drivepi.js';
import { createDrivePIController } from '../src/editor2d/drivepi-controller.js';
import { TOOL_DEFS, ALL_TOOLS, KEY_TO_TOOL } from '../src/editor2d/tools-meta.js';
import * as P from '../src/site/pavedways.js';
import { parseDesign } from '../src/ui/design-file.js';

function setup() {
  const portal = { name: 'T', polygonMm: SAMPLE_LOT.polygonMm, frontEdgeIndices: [2], picked: { front: { minM: 4.5 }, secondaryFront: { minM: 3 }, side: { minM: 0.9 }, rear: { minM: 3 } }, lot: '7', dp: 'DP 99' };
  const p = createProject({ name: 'Drive' });
  p.site.lot = portalLotToSiteLot(portal, lotEnvelope(portal));
  const h = catalogue.createFromTemplate('house_double');
  placeHouse(p, h, autoPose(p, h).pose);
  return p;
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const midOf = (d) => d.centre[Math.floor(d.centre.length / 2)];
const widths = (d) => d.left.map((l, i) => dist(l, d.right[i]));

test('the tool is on the residential rail with a tooltip', () => {
  const def = TOOL_DEFS.find((t) => t.id === 'drivepi');
  assert.ok(def, 'drivepi tool defined');
  assert.ok(def.tip && def.tip.length > 20);
  assert.equal(def.residentialOnly, true);
  assert.ok(ALL_TOOLS.includes('drivepi'));
  assert.equal(KEY_TO_TOOL.i, 'drivepi');
  assert.ok(!/[–—]/.test(JSON.stringify(def)), 'no dashes');
  assert.ok(!/compliant/i.test(JSON.stringify(def)));
});

test('add a PI on the centreline: stored, driveway follows it, ends stay attached', () => {
  const p = setup();
  const a = L.deriveDriveway(p);
  assert.equal(a.edited, false);
  const m = midOf(a);
  const r = D.addDrivewayPI(p, { x: m.x + 2500, y: m.y });
  assert.equal(r.ok, true, r.reason);
  const b = L.deriveDriveway(p);
  assert.equal(b.edited, true);
  assert.equal(b.pis.length, 1);
  assert.ok(dist(b.doorMid, a.doorMid) < 1);
  assert.ok(dist(b.centre[0], b.doorMid) < 1, 'starts at the garage door');
  assert.ok(dist(b.centre.at(-1), b.kerbPoint) < 1, 'ends on the kerb');
  assert.ok(Math.abs(b.endOffsetMm - a.endOffsetMm) < 5, 'kerb end did not move');
  const w = widths(b);
  assert.ok(Math.max(...w) - Math.min(...w) < 5, 'constant width');
  assert.ok(b.crossover.polygon.length >= 4);
});

test('move a PI: only that PI moves and both ends stay attached', () => {
  const p = setup();
  const a = L.deriveDriveway(p);
  const m = midOf(a);
  D.addDrivewayPI(p, { x: m.x, y: m.y });
  const before = L.deriveDriveway(p);
  const to = { x: before.pis[0].x + 1200, y: before.pis[0].y };
  const r = D.moveDrivewayPI(p, 0, to);
  assert.equal(r.ok, true, r.reason);
  const after = L.deriveDriveway(p);
  assert.ok(dist(after.pis[0], to) < 2);
  assert.ok(dist(after.centre[0], after.doorMid) < 1);
  assert.ok(dist(after.kerbPoint, before.kerbPoint) < 1);
  assert.ok(dist(after.centre.at(-1), after.kerbPoint) < 1);
});

test('delete a PI removes it and keeps the ends; a bad index is refused', () => {
  const p = setup();
  const m = midOf(L.deriveDriveway(p));
  D.addDrivewayPI(p, { x: m.x + 1500, y: m.y });
  assert.equal(L.deriveDriveway(p).pis.length, 1);
  assert.equal(D.deleteDrivewayPI(p, 5).ok, false);
  const r = D.deleteDrivewayPI(p, 0);
  assert.equal(r.ok, true);
  const d = L.deriveDriveway(p);
  assert.equal(d.pis.length, 0);
  assert.equal(d.ok, true);
  assert.ok(dist(d.centre[0], d.doorMid) < 1);
});

test('PIs are inserted in order along the driveway', () => {
  const p = setup();
  const a = L.deriveDriveway(p);
  const c = a.centre;
  const nearStart = c[Math.floor(c.length * 0.25)];
  const nearEnd = c[Math.floor(c.length * 0.75)];
  assert.equal(D.addDrivewayPI(p, { x: nearEnd.x + 800, y: nearEnd.y }).ok, true);
  const r = D.addDrivewayPI(p, { x: nearStart.x - 800, y: nearStart.y });
  assert.equal(r.ok, true, r.reason);
  const d = L.deriveDriveway(p);
  assert.equal(d.pis.length, 2);
  assert.ok(dist(d.pis[0], d.doorMid) < dist(d.pis[1], d.doorMid), 'first PI is the one nearer the door');
});

test('a PI that puts the driveway off the lot or on the house is refused and nothing changes', () => {
  const p = setup();
  const a = L.deriveDriveway(p);
  const m = midOf(a);
  D.addDrivewayPI(p, { x: m.x, y: m.y });
  const keep = structuredClone(p.site.driveway);
  const off = D.moveDrivewayPI(p, 0, { x: -30000, y: m.y });
  assert.equal(off.ok, false);
  assert.ok(off.reason.length > 10);
  assert.deepEqual(p.site.driveway, keep);
  const onHouse = D.moveDrivewayPI(p, 0, { x: 82 + 1700, y: 20775 }); // inside the first room
  assert.equal(onHouse.ok, false);
  assert.deepEqual(p.site.driveway, keep);
});

test('reset to auto drops the edit and the automatic route comes back', () => {
  const p = setup();
  const a = L.deriveDriveway(p);
  const m = midOf(a);
  D.addDrivewayPI(p, { x: m.x + 2000, y: m.y });
  assert.equal(L.deriveDriveway(p).edited, true);
  assert.equal(D.resetDrivewayToAuto(p), true);
  assert.equal(p.site.driveway, undefined);
  const b = L.deriveDriveway(p);
  assert.equal(b.edited, false);
  assert.ok(dist(b.kerbPoint, a.kerbPoint) < 1);
  assert.equal(D.resetDrivewayToAuto(p), false, 'nothing to reset the second time');
});

test('the kerb end slides along the frontage and stays on the kerb', () => {
  const p = setup();
  const a = L.deriveDriveway(p);
  const target = a.endOffsetMm + 3000 < a.edgeLenMm - 2500 ? 3000 : -3000;
  const to = { x: a.kerbPoint.x + a.edgeU.x * target, y: a.kerbPoint.y + a.edgeU.y * target + 5000 };
  const r = D.moveDrivewayEnd(p, to);
  assert.equal(r.ok, true, r.reason);
  const b = L.deriveDriveway(p);
  assert.ok(Math.abs(b.endOffsetMm - (a.endOffsetMm + target)) < 5);
  assert.ok(dist(b.centre[0], b.doorMid) < 1);
});

test('edit survives a JSON round trip and a design file load', () => {
  const p = setup();
  const m = midOf(L.deriveDriveway(p));
  D.addDrivewayPI(p, { x: m.x + 2000, y: m.y });
  const stored = structuredClone(p.site.driveway);
  const copy = JSON.parse(JSON.stringify(p));
  assert.deepEqual(copy.site.driveway, stored);
  assert.equal(L.deriveDriveway(copy).pis.length, 1);
  const parsed = parseDesign(JSON.stringify(p));
  const proj = parsed.project || parsed;
  assert.deepEqual(proj.site.driveway, stored);
});

test('controller: click the line adds a PI, drag moves it, Delete removes it, one undo step each', () => {
  const store = createStore(setup());
  const ctl = createDrivePIController({ store, scale: () => 0.05, toast: () => {}, redraw: () => {} });
  const d0 = L.deriveDriveway(store.project);
  const m = midOf(d0);
  const undo0 = store.canUndo();
  // Add by clicking on the centreline
  ctl.pointerDown({ x: m.x, y: m.y }, { screen: { x: 0, y: 0 } });
  ctl.pointerUp({ x: m.x, y: m.y }, { screen: { x: 0, y: 0 } });
  assert.equal(L.deriveDriveway(store.project).pis.length, 1);
  assert.equal(ctl.selectedPI(), 0);
  // Drag it
  const pi = L.deriveDriveway(store.project).pis[0];
  ctl.pointerDown({ x: pi.x, y: pi.y }, { screen: { x: 0, y: 0 } });
  ctl.pointerMove({ x: pi.x + 1500, y: pi.y }, { screen: { x: 40, y: 0 } });
  assert.equal(L.deriveDriveway(store.project).pis[0].x, pi.x, 'not committed until release');
  ctl.pointerUp({ x: pi.x + 1500, y: pi.y }, { screen: { x: 40, y: 0 } });
  assert.ok(Math.abs(L.deriveDriveway(store.project).pis[0].x - (pi.x + 1500)) < 2);
  // Delete key on the selected PI
  assert.equal(ctl.keyDown({ key: 'Delete' }), true);
  assert.equal(L.deriveDriveway(store.project).pis.length, 0);
  // Undo, undo, undo walks back to the automatic driveway
  assert.equal(store.undo(), true);
  assert.equal(L.deriveDriveway(store.project).pis.length, 1);
  assert.equal(store.undo(), true);
  assert.ok(Math.abs(L.deriveDriveway(store.project).pis[0].x - pi.x) < 2);
  assert.equal(store.undo(), true);
  assert.equal(L.deriveDriveway(store.project).edited, false);
  assert.equal(store.canUndo(), undo0);
  assert.equal(store.redo(), true);
  assert.equal(L.deriveDriveway(store.project).pis.length, 1);
});

test('controller: right click deletes the PI under it, double click adds one, Reset to auto is one undo step', () => {
  const store = createStore(setup());
  const ctl = createDrivePIController({ store, scale: () => 0.05, toast: () => {}, redraw: () => {} });
  const m = midOf(L.deriveDriveway(store.project));
  ctl.dblClick({ x: m.x, y: m.y });
  const pi = L.deriveDriveway(store.project).pis[0];
  assert.ok(pi);
  assert.equal(ctl.rightClick({ x: 0, y: 0 }), false, 'right click away from a PI is not used');
  assert.equal(ctl.rightClick({ x: pi.x, y: pi.y }), true);
  assert.equal(L.deriveDriveway(store.project).pis.length, 0);
  ctl.dblClick({ x: m.x, y: m.y });
  assert.equal(ctl.reset(), true);
  assert.equal(store.project.site.driveway, undefined);
  assert.equal(L.deriveDriveway(store.project).edited, false);
  assert.equal(store.undo(), true);
  assert.equal(L.deriveDriveway(store.project).pis.length, 1);
});

test('controller: end points cannot be dragged off the door or the kerb', () => {
  const store = createStore(setup());
  const ctl = createDrivePIController({ store, scale: () => 0.05, toast: () => {}, redraw: () => {} });
  const d = L.deriveDriveway(store.project);
  const m = midOf(d);
  ctl.dblClick({ x: m.x, y: m.y });
  // Dragging the door end does nothing: it is not a handle
  ctl.pointerDown({ x: d.doorMid.x, y: d.doorMid.y }, { screen: { x: 0, y: 0 } });
  ctl.pointerMove({ x: d.doorMid.x + 3000, y: d.doorMid.y + 3000 }, { screen: { x: 50, y: 0 } });
  ctl.pointerUp({ x: d.doorMid.x + 3000, y: d.doorMid.y + 3000 }, { screen: { x: 50, y: 0 } });
  const a = L.deriveDriveway(store.project);
  assert.ok(dist(a.centre[0], d.doorMid) < 1);
  // Dragging the kerb end moves it along the kerb only
  const k = a.kerbPoint;
  ctl.pointerDown({ x: k.x, y: k.y }, { screen: { x: 0, y: 0 } });
  ctl.pointerMove({ x: k.x + a.edgeU.x * -3000, y: k.y + a.edgeU.y * -3000 + 4000 }, { screen: { x: 50, y: 0 } });
  ctl.pointerUp({ x: k.x + a.edgeU.x * -3000, y: k.y + a.edgeU.y * -3000 + 4000 }, { screen: { x: 50, y: 0 } });
  const b = L.deriveDriveway(store.project);
  assert.ok(dist(b.centre.at(-1), b.kerbPoint) < 1);
  assert.ok(dist(b.kerbPoint, k) > 1000);
});

test('a driveway drawn with the Road or pavement tool is left to that tool, with a clear message', () => {
  const store = createStore(setup());
  const a = L.deriveDriveway(store.project);
  P.addWay(store.project, { kind: 'driveway', material: 'concrete', widthMm: 3500, radiusMm: 0, kerbEdge: a.edge, pts: [{ x: a.kerbPoint.x, y: a.kerbPoint.y }, { x: a.doorMid.x, y: a.doorMid.y }] });
  const st = D.driveEditState(store.project);
  assert.equal(st.ok, false);
  assert.equal(st.manual, true);
  assert.match(D.driveEditBlock(st), /Road or pavement tool/);
  const ctl = createDrivePIController({ store, scale: () => 0.05, toast: () => {}, redraw: () => {} });
  const m = a.centre[Math.floor(a.centre.length / 2)];
  assert.equal(ctl.pointerDown(m, {}), false);
  assert.equal(store.project.site.driveway, undefined);
});

test('copy has no dashes and never says compliant', async () => {
  const fs = await import('node:fs');
  for (const f of ['src/site/drivepi.js', 'src/editor2d/drivepi-controller.js', 'src/editor2d/tool-drivepi.js', 'src/ui/panel-drivepi.js']) {
    const strings = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').match(/'[^'\n]{12,}'|`[^`\n]{12,}`/g) || [];
    for (const t of strings) { assert.ok(!/[\u2013\u2014]/.test(t), `${f}: dash in ${t}`); assert.ok(!/compliant/i.test(t), `${f}: ${t}`); }
  }
});
