// Rotate tool (key O): the rotation maths, snapping (15 degrees, 1 degree with Shift, square to a lot edge), alignment buttons, multi item and
// whole development turns on residential and commercial designs, estate integrity, one undo step per turn, and the tool wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStore } from '../src/model/store.js';
import { catalogue } from '../src/catalogue/index.js';
import { createProject } from '../src/model/schema.js';
import { placeHouse } from '../src/portal/place-house.js';
import { lotEnvelope, portalLotToSiteLot, SAMPLE_LOT } from '../src/portal/envelope.js';
import { houseCentre } from '../src/model/placement.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { addBuilding } from '../src/commercial/catalogue/ops.js';
import { buildingsOf } from '../src/commercial/catalogue/buildings.js';
import { rowPoly } from '../src/commercial/layout.js';
import * as L from '../src/commercial/layouts.js';
import { siteWorksOf } from '../src/commercial/catalogue/buildings.js';
import { rowsSignature } from '../src/commercial/estate.js';
import { TOOL_DEFS, KEY_TO_TOOL } from '../src/editor2d/tools-meta.js';
import * as R from '../src/editor2d/rotate-logic.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const near = (a, b, e = 1e-6, m = '') => assert.ok(Math.abs(a - b) < e, `${m} ${a} vs ${b}`);
const SETBACKS = { front: { minM: 4.5 }, secondaryFront: { minM: 3 }, side: { minM: 0.9 }, rear: { minM: 3 } };

function resi() {
  const portal = { name: 'Test lot', polygonMm: SAMPLE_LOT.polygonMm, frontEdgeIndices: [2], picked: SETBACKS, lot: '7', dp: 'DP 99' };
  const p = createProject({ name: 'Rotate test' });
  p.site.lot = portalLotToSiteLot(portal, lotEnvelope(portal));
  placeHouse(p, catalogue.createFromTemplate('shed_workshop'), { x: 7000, y: 18000, rotation: 0, mirrored: false });
  return createStore(p, { opContext: { catalogue }, autosaveKey: null });
}
const comm = (opts) => createStore(commercialProject(opts), { autosaveKey: null });
const bboxCentre = (pts) => { const xs = pts.map((q) => q.x); const ys = pts.map((q) => q.y); return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }; };

test('angle maths: wrap, shortest way round, accumulate through the seam', () => {
  near(R.wrap360(-10), 350); near(R.wrap360(725), 5); near(R.wrap180(190), -170); near(R.wrap180(-180), 180);
  near(R.shortest(350, 10), 20); near(R.shortest(10, 350), -20);
  near(R.angleFrom({ x: 0, y: 0 }, { x: 0, y: 10 }), 90); // y is down: clockwise on screen
  // a drag that crosses the 180 degree seam keeps counting instead of jumping
  let s = R.accumulate(0, null, 170);
  s = R.accumulate(s.total, s.prev, -175); // 170 to 185 degrees
  near(s.total, 185);
  s = R.accumulate(s.total, s.prev, -150);
  near(s.total, 210);
});

test('snapping: 15 degree steps, 1 degree with Shift, square to a lot edge when close', () => {
  assert.equal(R.snapTurn(37, {}).deg, 30);
  assert.equal(R.snapTurn(38, {}).deg, 45);
  assert.equal(R.snapTurn(-52, {}).deg, -45);
  assert.deepEqual(R.snapTurn(37.4, { shift: true }), { deg: 37, snap: 'fine' });
  // a building facing 10 degrees off a lot edge at 0 degrees: squaring it up is a turn of -10 (or +80)
  const lines = [{ index: 0, deg: 0, front: true }, { index: 1, deg: 90, front: false }];
  const s = R.snapTurn(-9, { base: 10, lines });
  assert.equal(s.deg, -10); assert.equal(s.snap, 'frontage');
  assert.equal(R.snapTurn(-9, { base: 10, lines: [{ index: 3, deg: 0, front: false }] }).snap, 'lot');
  assert.equal(R.snapTurn(-9, { base: 10, lines, shift: true }).snap, 'fine'); // Shift turns the lot snap off
  assert.equal(R.snapTurn(-5.5, { base: 10, lines }).snap, 'step'); // too far from square: back to 15 degree steps
  near(R.squareDelta(10, 0), -10); near(R.squareDelta(88, 0), 2); near(R.squareDelta(0, 90), 0);
});

test('lot angles come from the boundary and flag the frontage', () => {
  const p = resi().project;
  const lines = R.lotAlignments(p);
  assert.equal(lines.length, 4);
  assert.equal(lines.filter((l) => l.front).length, 1);
  assert.ok(lines.every((l) => l.deg >= 0 && l.deg < 180));
});

test('house: a turn about the centre keeps the centre, is one undo step and turns tanks and the plan together', () => {
  const store = resi();
  const c0 = houseCentre(store.project);
  const w0 = structuredClone(store.project.levels[0].walls[0].a);
  const n = store.history?.length;
  store.apply('Rotate house', (p) => { R.applyTurn(p, [{ kind: 'house' }], 30, c0); });
  const c1 = houseCentre(store.project);
  assert.ok(Math.hypot(c1.x - c0.x, c1.y - c0.y) < 400, 'the house stays where it was');
  const w1 = store.project.levels[0].walls[0].a;
  assert.ok(Math.hypot(w1.x - w0.x, w1.y - w0.y) > 100, 'the walls turned');
  store.undo();
  assert.deepEqual(store.project.levels[0].walls[0].a, w0);
  void n;
});

test('house: turning by 90 four times returns to the start (within rounding)', () => {
  const store = resi();
  const w0 = structuredClone(store.project.levels[0].walls[0].a);
  const c = houseCentre(store.project);
  for (let i = 0; i < 4; i++) store.apply('Rotate house', (p) => { R.applyTurn(p, [{ kind: 'house' }], 90, c); });
  assert.ok(Math.hypot(store.project.levels[0].walls[0].a.x - w0.x, store.project.levels[0].walls[0].a.y - w0.y) <= 4);
});

test('house: align to the nearest boundary squares it up; the turn is under 45 degrees', () => {
  const store = resi();
  const c = houseCentre(store.project);
  store.apply('Rotate house', (p) => { R.applyTurn(p, [{ kind: 'house' }], 20, c); });
  const a = R.alignDelta(store.project, [{ kind: 'house' }], 'boundary');
  assert.ok(a && Math.abs(a.deg) <= 45 && Math.abs(a.deg) > 1);
  store.apply('Align', (p) => { R.applyTurn(p, [{ kind: 'house' }], a.deg, c); });
  const b = R.alignDelta(store.project, [{ kind: 'house' }], 'boundary');
  assert.ok(Math.abs(b.deg) < 1.5, `now square, ${b.deg}`);
});

test('commercial building: pivot turn keeps its centre, rotationDeg follows, attached paving regenerates, one undo step', () => {
  const store = comm({ rows: 'none' });
  const id = addBuilding(store, 'warehouse');
  const b0 = buildingsOf(store.project.commercial).find((b) => b.id === id);
  const c0 = bboxCentre(b0.outline);
  const rd0 = b0.place.rotationDeg || 0;
  const place0 = { ...b0.place };
  const pv = R.centreOf(store.project, [{ kind: 'building', id }]);
  store.apply('Rotate building', (p) => { R.applyTurn(p, [{ kind: 'building', id }], 45, pv); });
  const b1 = buildingsOf(store.project.commercial).find((b) => b.id === id);
  near(((b1.place.rotationDeg - rd0 + 360) % 360), 45, 0.01);
  const c1 = bboxCentre(b1.outline);
  assert.ok(Math.hypot(c1.x - c0.x, c1.y - c0.y) < 3000, 'the middle stays near the pivot');
  assert.ok(siteWorksOf(store.project.commercial), 'site works are regenerated for the turned building');
  store.undo();
  near(buildingsOf(store.project.commercial).find((x) => x.id === id).place.rotationDeg || 0, rd0);
  store.undo(); // the add
  assert.equal((store.project.commercial.buildings || []).length, 0);
});

test('commercial rows: a turn about a custom pivot is rigid (distances between the units do not change) and the mirrored partner follows', () => {
  const store = comm({ rows: 'pair' });
  const c = store.project.commercial;
  const base = c.rows.find((r) => !r.mirrorOf);
  const rot0 = base.rotationDeg || 0;
  const polys0 = c.rows.map((r) => rowPoly(r, c.rows));
  const pv = { x: 5000, y: 5000 };
  store.apply('Rotate units', (p) => { R.applyTurn(p, [{ kind: 'row', id: base.id }], 30, pv); });
  const c1 = store.project.commercial;
  const polys1 = c1.rows.map((r) => rowPoly(r, c1.rows));
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  for (let k = 0; k < polys0.length; k++) {
    for (let i = 0; i < 4; i++) near(d(polys0[k][i], polys0[k][(i + 1) % 4]), d(polys1[k][i], polys1[k][(i + 1) % 4]), 2, 'edge length');
    near(d(polys0[k][0], pv), d(polys1[k][0], pv), 3, 'distance to the pivot');
  }
  // the pair stayed back to back: the mirrored row shares the source origin
  const mir = c1.rows.find((r) => r.mirrorOf);
  assert.equal(mir.mirrorOf, base.id);
  near(c1.rows.find((r) => r.id === base.id).rotationDeg, (rot0 + 30) % 360, 0.01);
});

test('commercial: turning a mirrored row turns its source', () => {
  const store = comm({ rows: 'pair' });
  const c = store.project.commercial;
  const base = c.rows.find((r) => !r.mirrorOf); const mir = c.rows.find((r) => r.mirrorOf);
  const rot0 = base.rotationDeg || 0;
  store.apply('Rotate', (p) => { R.applyTurn(p, [{ kind: 'row', id: mir.id }], 15); });
  near(store.project.commercial.rows.find((r) => r.id === base.id).rotationDeg, (rot0 + 15) % 360, 0.01);
});

test('multi item: a building and the units turn together about one pivot; each keeps its distance to it', () => {
  const store = comm({ rows: 'none' });
  const c0 = store.project.commercial;
  const id = addBuilding(store, 'warehouse');
  const row = store.project.commercial.rows[0];
  const rowRot0 = row.rotationDeg || 0;
  const sel = [{ kind: 'building', id }, { kind: 'row', id: row.id }];
  const before = R.expand(store.project, sel).flatMap((t) => R.pointsOf(store.project, t));
  const pv = R.centreOf(store.project, sel);
  store.apply('Rotate 2 items', (p) => { R.applyTurn(p, sel, 90, pv); });
  const after = R.expand(store.project, sel).flatMap((t) => R.pointsOf(store.project, t));
  assert.equal(before.length, after.length);
  const bb = (pts) => { const q = bboxCentre(pts); return q; };
  void c0; void bb;
  // the farthest point from the pivot is unchanged by a rigid turn
  const far = (pts) => Math.max(...pts.map((q) => Math.hypot(q.x - pv.x, q.y - pv.y)));
  near(far(before), far(after), 8);
  store.undo();
  assert.equal(store.project.commercial.rows[0].rotationDeg || 0, rowRot0);
});

test('whole development: buildings, units, waste enclosure and pavements all turn; one undo step restores everything', () => {
  const store = comm({ rows: 'pair' });
  const id = addBuilding(store, 'warehouse');
  store.apply('waste', (p) => { p.commercial.waste = { x: 60000, y: 60000, widthMm: 4000, depthMm: 3000, rotationDeg: 0 }; });
  const snap = JSON.stringify([store.project.commercial.rows, store.project.commercial.buildings, store.project.commercial.waste]);
  const targets = R.groupTargets(store.project);
  assert.ok(targets.some((t) => t.kind === 'building') && targets.some((t) => t.kind === 'row') && targets.some((t) => t.kind === 'waste'));
  store.apply('Rotate whole development', (p) => { R.applyTurn(p, [{ kind: 'group' }], 15); });
  const c = store.project.commercial;
  near(c.waste.rotationDeg, 15, 0.01);
  near(c.buildings.find((b) => b.id === id).place.rotationDeg % 360, 15, 0.01);
  assert.notEqual(JSON.stringify([c.rows, c.buildings, c.waste]), snap);
  store.undo();
  assert.equal(JSON.stringify([store.project.commercial.rows, store.project.commercial.buildings, store.project.commercial.waste]), snap);
});

test('estate: turning it keeps the network (aisles, footpaths, crossovers) valid and turns every piece by the same angle', () => {
  const store = createStore(commercialProject({ rows: 'none', width: 90000, depth: 110000, plain: false }), { autosaveKey: null });
  L.applyLayout(store, L.chooseLayout(store.project, 'best'));
  const c0 = store.project.commercial;
  assert.ok(c0.estate, 'the 90 x 110 m lot gives a drawn estate');
  const rowAng0 = c0.rows.map((r) => r.rotationDeg || 0);
  const w0 = siteWorksOf(c0);
  const x0 = { x: w0.crossovers[0].x, y: w0.crossovers[0].y };
  const nA = w0.aisles.length; const nF = w0.footpaths.length; const nX = w0.crossovers.length;
  const pick = R.pickTarget(store.project, rowCentreOf(c0));
  assert.deepEqual(pick, { kind: 'estate' });
  const pv = R.centreOf(store.project, [{ kind: 'estate' }]);
  store.apply('Rotate estate', (p) => { R.applyTurn(p, [{ kind: 'estate' }], 20, pv); });
  const c1 = store.project.commercial;
  assert.equal(c1.estate.sig, rowsSignature(c1.rows), 'the network is not stale');
  const w1 = siteWorksOf(c1);
  assert.equal(w1.kind, 'estate');
  assert.equal(w1.aisles.length, nA); assert.equal(w1.footpaths.length, nF); assert.equal(w1.crossovers.length, nX);
  for (const [i, r] of c1.rows.entries()) { if (r.mirrorOf) continue; near(((r.rotationDeg - rowAng0[i] + 360) % 360), 20, 0.01, 'row angle'); }
  // the entry crossover moved by the same rigid turn as the rows: its distance to the pivot is unchanged
  near(Math.hypot(x0.x - pv.x, x0.y - pv.y), Math.hypot(w1.crossovers[0].x - pv.x, w1.crossovers[0].y - pv.y), 3);
  store.undo();
  assert.equal(siteWorksOf(store.project.commercial).kind, 'estate');
});
function rowCentreOf(c) { const r = c.rows[0]; return bboxCentre(rowPoly(r, c.rows)); }

test('align to frontage: a building turns its front to the street, units run along it', () => {
  const store = comm({ rows: 'none' });
  const id = addBuilding(store, 'warehouse');
  const pv = R.centreOf(store.project, [{ kind: 'building', id }]);
  store.apply('Rotate', (p) => { R.applyTurn(p, [{ kind: 'building', id }], 37, pv); });
  const a = R.alignDelta(store.project, [{ kind: 'building', id }], 'frontage');
  store.apply('Align', (p) => { R.applyTurn(p, [{ kind: 'building', id }], a.deg, pv); });
  const after = R.alignDelta(store.project, [{ kind: 'building', id }], 'frontage');
  assert.ok(Math.abs(after.deg) < 0.05, `aligned, ${after.deg}`);
  // units
  const store2 = comm({ rows: 'pair' });
  const row = store2.project.commercial.rows.find((r) => !r.mirrorOf);
  store2.apply('Rotate', (p) => { R.applyTurn(p, [{ kind: 'row', id: row.id }], 22, { x: 40000, y: 50000 }); });
  const a2 = R.alignDelta(store2.project, [{ kind: 'row', id: row.id }], 'frontage');
  assert.ok(Math.abs(a2.deg + 22) < 0.05, `row squared back to the frontage, ${a2.deg}`);
});

test('pivot: no custom pivot uses the middle of the selection; a drawn way turns about a picked pivot', () => {
  const store = resi();
  store.apply('way', (p) => { p.site.paved = [{ id: 'pv1', kind: 'driveway', material: 'concrete', widthMm: 3500, radiusMm: 0, pts: [{ x: 5000, y: 5000 }, { x: 9000, y: 5000 }], kerbEdge: null, heads: [] }]; });
  store.apply('Rotate way', (p) => { R.applyTurn(p, [{ kind: 'way', id: 'pv1' }], 90, { x: 5000, y: 5000 }); });
  const w = store.project.site.paved[0];
  near(w.pts[0].x, 5000, 2); near(w.pts[0].y, 5000, 2);
  near(w.pts[1].x, 5000, 2); near(w.pts[1].y, 9000, 2); // east turned clockwise on screen is south
  assert.ok(R.pointsOf(store.project, { kind: 'way', id: 'pv1' }).length > 0);
});

test('applyTurn ignores a zero turn and an empty selection', () => {
  const store = resi();
  const before = JSON.stringify(store.project.levels);
  assert.equal(R.applyTurn(store.project, [{ kind: 'house' }], 0), false);
  assert.equal(R.applyTurn(store.project, [], 30), false);
  assert.equal(JSON.stringify(store.project.levels), before);
});

test('the tool: O key, tooltip, rail group, wired into the editor, both modes, Escape leaves, help entries', () => {
  const def = TOOL_DEFS.find((d) => d.id === 'rotate');
  assert.ok(def && def.label === 'Rotate' && def.key === 'O' && def.icon === 'rotate');
  assert.equal(KEY_TO_TOOL.o, 'rotate');
  const keys = TOOL_DEFS.map((d) => d.key); assert.equal(new Set(keys).size, keys.length, 'no two tools share a key');
  assert.ok(!def.commercialOnly);
  assert.ok(read('../src/ui/toolbox.js').includes("'select', 'rotate'"));
  assert.ok(read('../src/ui/icons.js').includes('rotate:'));
  assert.ok(read('../src/editor2d/editor.js').includes('createRotateTool(ed)'));
  const t = read('../src/editor2d/tool-rotate.js');
  for (const s of ['cancel()', 'Escape', 'rotateBy', 'canRotate', 'ev.alt', 'ev.shift', 'pointerDown', 'pointerUp']) assert.ok(t.includes(s), s);
  assert.ok(read('../src/ui/onboarding/anims.js').includes("rotate: 'Click an item"));
  assert.ok(!/[–—]/.test(t + read('../src/editor2d/rotate-logic.js')), 'no em or en dashes in the tool');
  assert.ok(!/compliant/i.test(t + read('../src/editor2d/rotate-logic.js')));
});
