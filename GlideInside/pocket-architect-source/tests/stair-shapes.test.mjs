// L and U stairs with a landing and a turn, a set riser count and height, and a stair void with a balustrade or half high wall in the floor above.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, validate } from '../src/model/schema.js';
import { applyOp, mirrorPlan } from '../src/model/ops.js';
import { stairLayout, shapedParams } from '../src/model/stair-geom.js';
import { placeHouse } from '../src/portal/place-house.js';
import * as G from '../src/model/geometry.js';

// The Keogh stair: 16 risers of 187.5 (3000 floor to floor); 10 rise west from the hall, a flat landing, then 4 rise north, the last riser arrives on the floor.
const KEOGH = { x: 6620, y: 7155, width: 930, rotation: 90, shape: 'L', risers: 16, riser: 187.5, going: 278, landing_at: 11, turn: 'right', landing_depth: 950 };

function twoStorey(extra = {}) {
  const p = createProject({ name: 'Two', type: 'house' });
  p.settings.floorToFloor = 3000;
  const run = (op, a) => applyOp(p, op, a, {});
  const g = p.levels[0].id;
  for (const [x1, y1, x2, y2] of [[0, 0, 12000, 0], [12000, 0, 12000, 9000], [12000, 9000, 0, 9000], [0, 9000, 0, 0]]) run('add_wall', { level: g, x1, y1, x2, y2 });
  const up = run('add_level', { name: 'First', copy_outline: true }).id;
  run('add_room_polygon', { level: g, type: 'hall', name: 'hall', points: [{ x: 0, y: 0 }, { x: 12000, y: 0 }, { x: 12000, y: 9000 }, { x: 0, y: 9000 }], walls: false });
  run('add_room_polygon', { level: up, type: 'living', name: 'living', points: [{ x: 0, y: 0 }, { x: 12000, y: 0 }, { x: 12000, y: 9000 }, { x: 0, y: 9000 }], walls: false });
  const st = run('add_stair', { level: g, ...KEOGH, ...extra });
  return { p, run, g, up, st };
}

test('an L stair has the set riser count and height, a flat landing, and arrives on the floor above', () => {
  const L = stairLayout({ x: 0, y: 0, width: 930, length: 2780, rotation: 90, shape: 'L', risers: 16, riser: 187.5, going: 278, landingAt: 11, turn: 'right', landingDepth: 950 }, 3000);
  assert.equal(L.risers, 16);
  assert.equal(L.riser, 187.5);
  assert.equal(L.going, 278);
  assert.equal(L.treads.length, 15, '10 treads, the landing, 4 treads: the 16th riser arrives on the floor');
  const landing = L.treads.filter((t) => t.landing);
  assert.equal(landing.length, 1);
  assert.equal(landing[0].top, 11 * 187.5);
  assert.equal(L.treads.at(-1).top, 15 * 187.5);
  assert.equal(L.risers * L.riser, 3000);
  assert.equal(L.treads.filter((t) => t.flight === 1 && !t.landing).length, 10);
  assert.equal(L.treads.filter((t) => t.flight === 2).length, 4);
  for (const t of L.treads) assert.ok(Math.abs(t.top - t.k * 187.5) < 1e-9);
});

test('the Keogh stair sits where the plan puts it: west from the hall, landing over the store, then north', () => {
  const L = stairLayout({ x: 6620, y: 7155, width: 930, length: 2780, rotation: 90, shape: 'L', risers: 16, riser: 187.5, going: 278, landingAt: 11, turn: 'right', landingDepth: 950 }, 3000);
  const bb = (poly) => G.bbox(poly);
  const first = bb(L.treads[0].poly);
  const tenth = bb(L.treads[9].poly);
  assert.ok(first.minX > tenth.minX, 'the first tread is east of the tenth: the flight climbs west');
  const land = bb(L.treads.find((t) => t.landing).poly);
  assert.ok(Math.abs(land.w - 950) < 1 && Math.abs(land.h - 930) < 1, 'landing 950 deep and 930 wide');
  assert.ok(land.maxX <= tenth.minX + 1, 'the landing is past the top of the first flight');
  const f2 = L.treads.filter((t) => t.flight === 2).map((t) => bb(t.poly));
  assert.ok(f2.every((b) => Math.abs(b.w - 278) < 1 || Math.abs(b.h - 278) < 1));
  // the second flight leaves the landing to the north (smaller y in the app, which is up the page)
  assert.ok(f2[0].maxY <= land.minY + 1 && f2.at(-1).maxY < f2[0].minY + 1);
});

test('add_stair makes an L stair and an invalid number is refused in plain words', () => {
  const { p, g, st } = twoStorey();
  const s = p.levels[0].stairs.find((q) => q.id === st.id);
  assert.equal(s.shape, 'L');
  assert.equal(s.risers, 16);
  assert.equal(s.landingAt, 11);
  assert.equal(s.turn, 'right');
  assert.equal(s.length, 10 * 278);
  assert.deepEqual(validate(p), []);
  assert.throws(() => applyOp(p, 'add_stair', { level: g, x: 0, y: 0, shape: 'L', risers: 16, riser: 400, going: 278 }, {}), /riser/);
  assert.throws(() => applyOp(p, 'add_stair', { level: g, x: 0, y: 0, shape: 'L', risers: 16, going: 100 }, {}), /going/);
  assert.throws(() => applyOp(p, 'add_stair', { level: g, x: 0, y: 0, shape: 'L', risers: 14, landing_at: 13 }, {}), /landing/);
});

test('a stair with void_rail cuts a void in the floor above; half_wall makes half high walls on the open edges', () => {
  const none = twoStorey({ void_rail: 'none' });
  assert.equal(none.p.levels[1].voids.length, 1);
  assert.equal(none.p.levels[1].walls.filter((w) => w.height === 1000).length, 0);
  const half = twoStorey({ void_rail: 'half_wall' });
  const v = half.p.levels[1].voids[0];
  assert.equal(v.rail, 'half_wall');
  assert.equal(v.stairId, half.st.id);
  const halves = half.p.levels[1].walls.filter((w) => w.height === 1000);
  assert.ok(halves.length >= 2, 'half high walls along the open edges');
  assert.ok(halves.every((w) => w.thickness === 90));
  const bal = twoStorey({ void_rail: 'balustrade' });
  assert.equal(bal.p.levels[1].voids[0].rail, 'balustrade');
  assert.deepEqual(validate(half.p), []);
});

test('add_void and update_void edit a void by hand, and a bad void fails validation', () => {
  const { p, run, up } = twoStorey();
  const { id } = run('add_void', { level: up, points: [{ x: 1000, y: 1000 }, { x: 3000, y: 1000 }, { x: 3000, y: 2000 }, { x: 1000, y: 2000 }], rail: 'balustrade' });
  run('update_void', { id, rail: 'none' });
  assert.equal(p.levels[1].voids[0].rail, 'none');
  assert.deepEqual(validate(p), []);
  assert.throws(() => run('add_void', { level: up, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }), /3 corner points/);
  p.levels[1].voids[0].polygon = [{ x: 0, y: 0 }];
  assert.ok(validate(p).some((m) => /void/i.test(m)));
});

test('a U stair returns beside the first flight and has the set riser count', () => {
  const L = stairLayout({ x: 0, y: 0, width: 900, length: 2000, rotation: 0, shape: 'U', risers: 16, riser: 187.5, going: 250, landingAt: 9, turn: 'left', gap: 100, landingDepth: 1000 }, 3000);
  assert.equal(L.treads.length, 15);
  const land = L.treads.find((t) => t.landing);
  const f1 = L.treads.filter((t) => t.flight === 1 && !t.landing);
  const f2 = L.treads.filter((t) => t.flight === 2);
  assert.equal(f1.length, 8);
  assert.equal(f2.length, 6);
  const lb = G.bbox(land.poly);
  assert.ok(lb.w >= 900 * 2 + 100 - 1, 'the landing spans both flights');
  const c1 = G.polygonCentroid(f1[0].poly).x;
  const c2 = G.polygonCentroid(f2[0].poly).x;
  assert.ok(Math.abs(Math.abs(c2 - c1) - 1000) < 1, 'the second flight runs beside the first, one width plus the gap away');
  assert.equal(L.treads.at(-1).top, 15 * 187.5);
});

test('shapedParams fills defaults from the floor to floor height', () => {
  const P = shapedParams({ shape: 'L', width: 1000 }, 3000);
  assert.equal(P.risers, 16);
  assert.equal(P.riser, 187.5);
  assert.equal(P.landingAt, 8);
});

test('a mirrored plan swaps the turn of a shaped stair and mirrors its void', () => {
  const { p, up } = twoStorey({ void_rail: 'none' });
  const before = G.bbox(p.levels[1].voids[0].polygon);
  const turn = p.levels[0].stairs[0].turn;
  mirrorPlan(p, 'left_right');
  assert.notEqual(p.levels[0].stairs[0].turn, turn);
  const after = G.bbox(p.levels[1].voids[0].polygon);
  assert.ok(Math.abs(after.w - before.w) < 2 && Math.abs(after.minX - before.minX) > 100);
  void up;
});

test('placing a house copies its voids (new ids, moved and turned with the house) and keeps the stair they belong to', () => {
  const { p } = twoStorey({ void_rail: 'half_wall' });
  const lot = createProject({ name: 'Lot', type: 'house' });
  placeHouse(lot, p, { x: 20000, y: 20000, rotation: 90 });
  const up = lot.levels.find((l) => l.elevation > 0);
  assert.equal(up.voids.length, 1);
  const v = up.voids[0];
  assert.notEqual(v.id, p.levels[1].voids[0].id);
  const stair = lot.levels[0].stairs[0];
  assert.equal(v.stairId, stair.id, 'the void points at the placed stair');
  const c = G.polygonCentroid(v.polygon);
  assert.ok(Math.abs(c.x - 20000) < 6000 && Math.abs(c.y - 20000) < 6000, 'the void moved with the house');
  assert.deepEqual(validate(lot), []);
});

test('the 3D model has stair treads and no floor over the stair void', async () => {
  const { buildModel } = await import('../src/viewer3d/build.js');
  const { catalogue } = await import('../src/catalogue/index.js');
  const { collectTriangles } = await import('../src/premium/exporters/eng/views.js');
  const { p } = twoStorey({ void_rail: 'balustrade' });
  const g = buildModel(p, { catalogue, showRoof: false, statusView: 'proposed', levelFilter: 'all' });
  assert.ok(g, 'the model builds with a shaped stair and a void');
  const tris = await collectTriangles(p, catalogue);
  const stairTris = tris.filter((t) => t.kind === 'stair');
  assert.ok(stairTris.length >= 15, 'every tread is in the model');
  const heights = new Set(stairTris.filter((t) => t.n.z > 0.9).map((t) => Math.round(t.p[0].z)));
  assert.ok(heights.has(Math.round(11 * 187.5)), 'the landing is at tread 11 height');
  // a point in the middle of the void: no upward facing slab or floor triangle at the upper floor level covers it
  const vp = G.polygonCentroid(p.levels[1].voids[0].polygon);
  const covers = (t) => { const [a, b, c] = t.p; const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y); if (!d) return false; const l1 = ((b.y - c.y) * (vp.x - c.x) + (c.x - b.x) * (vp.y - c.y)) / d; const l2 = ((c.y - a.y) * (vp.x - c.x) + (a.x - c.x) * (vp.y - c.y)) / d; return l1 > 0 && l2 > 0 && 1 - l1 - l2 > 0; };
  const floorsOverVoid = tris.filter((t) => (t.kind === 'slab' || t.kind === 'floor') && t.n.z > 0.9 && t.p.every((q) => q.z > 2800 && q.z < 3400) && covers(t));
  assert.equal(floorsOverVoid.length, 0, 'the first floor is open over the stair');
});

test('the plan set draws the void and the stair (plan, and the section through it)', async () => {
  const { exportPlanSet } = await import('../src/premium/exporters/planset/index.js');
  const { catalogue } = await import('../src/catalogue/index.js');
  const { recordingPDF, residentialCase } = await import('./helpers/planset-fixtures.mjs');
  const { p } = twoStorey({ void_rail: 'half_wall' });
  const proj = residentialCase('none');
  const { placeHouse: place } = await import('../src/portal/place-house.js');
  proj.levels.forEach((l) => { l.walls = []; l.rooms = []; l.openings = []; l.furniture = []; l.stairs = []; });
  place(proj, p, { x: 15000, y: 25000, rotation: 0 });
  const rec = recordingPDF();
  const r = await exportPlanSet({ project: proj, kind: 'site', download: false, jsPDF: rec.Rec, fetchSite: null, catalogue, date: new Date(2026, 10, 25) });
  assert.ok(r.sheets.some((s) => /A101/.test(s.no)), 'a first floor plan sheet is made');
  const texts = rec.texts();
  assert.ok(texts.some((t) => /VOID/.test(t)), 'the void is labelled on the first floor plan');
  assert.ok(texts.some((t) => /FIRST FLOOR PLAN/i.test(t)));
  assert.ok(texts.some((t) => /SECTION/i.test(t)), 'a section sheet is made');
});
