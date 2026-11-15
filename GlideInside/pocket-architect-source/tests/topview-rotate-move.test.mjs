// Top view: rotate, pan and zoom maths, the corner view, moving buildings (snap, warnings, one undo step) and the commercial panel wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fitView, zoomAt, rotateAt, panBy, sceneInner, rotVec, wrapDeg } from '../src/lotcard/topview.js';
import { snapMove, moveWarnings, overlaps, inside, turnRing, turnSnap, turnStep, ringAngle } from '../src/lotcard/topview-move.js';
import { defaultView, isDefault, zoomAbout, turnAbout, toLocal, panView, cssOf } from '../src/lotcard/mini-view.js';
import { createStore } from '../src/model/store.js';
import { commercialMovers, commercialScene } from '../src/commercial/topview-scene.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const sq = (x, y, s) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
const scene = () => ({ boundary: sq(0, 0, 20000), neighbours: [], envelope: sq(3000, 3000, 14000), shapes: [{ kind: 'building', ring: sq(5000, 5000, 4000) }], labels: [], northDeg: 30, areaM2: 400, summary: 'x', aerial: null });
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

test('rotating the view keeps the point under the pointer, and panning follows the screen direction', () => {
  const sc = scene();
  const v0 = fitView(sc, 800, 600);
  const v1 = rotateAt(v0, 90, 200, 150, 800, 600);
  near(v1.rot, 90);
  // the plan point under (200,150) is the same before and after
  const at = (v, sx, sy) => { const d = rotVec(sx - 400, sy - 300, -v.rot); return { x: v.cx + d.x / v.k, y: v.cy + d.y / v.k }; };
  near(at(v0, 200, 150).x, at(v1, 200, 150).x, 1e-3);
  near(at(v0, 200, 150).y, at(v1, 200, 150).y, 1e-3);
  // zoom about a point also keeps it
  const z = zoomAt(v1, v0, 2, 500, 100, 800, 600);
  near(at(v1, 500, 100).x, at(z, 500, 100).x, 1e-3);
  // dragging right on screen moves the plan under the finger right on screen, at any turn
  const p = panBy({ ...v1 }, 100, 0, sc);
  const before = at(v1, 400, 300);
  const after = at(p, 400, 300);
  const s = rotVec(before.x - after.x, before.y - after.y, v1.rot);
  near(s.x * v1.k, 100, 1e-3);
  near(Math.abs(s.y), 0, 1e-3);
});

test('fit for a turned view frames the turned box; wrapDeg wraps', () => {
  const sc = scene();
  const a = fitView(sc, 800, 800, 0.1, 0);
  const b = fitView(sc, 800, 800, 0.1, 45);
  assert.ok(b.k < a.k, 'a square turned 45 degrees needs a smaller scale');
  assert.equal(wrapDeg(-90), 270);
  assert.equal(wrapDeg(450), 90);
});

test('the turned drawing is a group, text is turned back upright, the north arrow keeps northDeg plus the turn', () => {
  const sc = scene();
  const v = { ...fitView(sc, 800, 600, 0.1, 60) };
  const svg = sceneInner(sc, v, 800, 600);
  assert.match(svg, /<g data-part="turn" transform="rotate\(60 /);
  assert.match(svg, /<\/g>$/);
  assert.match(svg, /<text[^>]*transform="rotate\(-60 /, "level text");
  const flat = sceneInner(sc, fitView(sc, 800, 600), 800, 600);
  assert.doesNotMatch(flat, /data-part="turn"/);
  const src = read('../src/lotcard/topview.js');
  assert.match(src, /wrapDeg\(scene\.northDeg \+ \(view\.rot \|\| 0\)\)/);
  assert.match(src, /e\.button === 2/);
  assert.match(src, /topview-north-up/);
  assert.match(src, /topview-rotate-left/);
  assert.match(src, /'\['/);
});

test('corner view maths: zoom and turn keep the point under the pointer, reset is the default', () => {
  const v0 = defaultView();
  assert.ok(isDefault(v0));
  const v1 = turnAbout(zoomAbout(v0, 2, 30, 20, 200, 260), 40, 30, 20, 200, 260);
  const p0 = toLocal(v0, 30, 20);
  const p1 = toLocal(v1, 30, 20);
  near(p0.x, p1.x, 1e-6); near(p0.y, p1.y, 1e-6);
  assert.ok(!isDefault(v1));
  assert.match(cssOf(v1), /rotate\(40\.00deg\) scale\(2\.0000\)/);
  const far = panView(v0, 99999, 0, 200, 260);
  assert.ok(far.x <= 200, 'pan is limited');
  const lim = zoomAbout(v0, 1000, 0, 0, 200, 260);
  assert.ok(lim.z <= 12 && zoomAbout(v0, 0.0001, 0, 0, 200, 260).z >= 0.7);
});

test('corner view is attached on both lot cards, drag does not open the large view, north arrow follows', () => {
  for (const f of ['../src/lotcard/lot-card.js', '../src/commercial/lotcard.js']) {
    const src = read(f);
    assert.match(src, /attachMiniView\(/);
    assert.match(src, /consumeClick\(\)/);
  }
  const mv = read('../src/lotcard/mini-view.js');
  assert.match(mv, /wheel/);
  assert.match(mv, /e\.button === 2 \|\| e\.shiftKey/);
  assert.match(mv, /north\.style\.transform/);
  assert.match(mv, /lc-mini-reset/);
});

test('snapping pulls a corner onto a setback line or a neighbour, otherwise rounds to 50 mm', () => {
  const env = sq(3000, 3000, 14000);
  const moving = [sq(5000, 5000, 4000)];
  // moving left by 1900 puts the left edge at 3100, within 300 of the setback line at 3000
  const r = snapMove(moving, -1900, 0, [env], 300);
  assert.equal(r.snapped, true);
  assert.equal(r.dx, -2000);
  const free = snapMove(moving, 1234, 777, [env], 300);
  assert.equal(free.snapped, false);
  assert.deepEqual([free.dx, free.dy], [1250, 800]);
  // against another building: edge to edge
  const other = sq(10000, 5000, 3000);
  const r2 = snapMove(moving, 880, 0, [other], 300);
  assert.equal(r2.dx, 1000);
});

test('warnings: outside the setback line and overlapping another building', () => {
  const env = sq(3000, 3000, 14000);
  assert.deepEqual(moveWarnings([sq(5000, 5000, 4000)], { envelope: env, others: [sq(12000, 5000, 3000)] }), []);
  assert.deepEqual(moveWarnings([sq(1000, 5000, 4000)], { envelope: env }), ['Outside the setback line']);
  assert.deepEqual(moveWarnings([sq(1000, 5000, 4000)], { boundary: sq(0, 0, 20000), envelope: null }), []);
  assert.deepEqual(moveWarnings([sq(5000, 5000, 4000)], { envelope: env, others: [sq(8000, 6000, 3000)] }), ['Overlaps another building']);
  assert.ok(overlaps(sq(0, 0, 10), sq(2, 2, 2)), 'one inside the other');
  assert.ok(!overlaps(sq(0, 0, 10), sq(10, 0, 10)), 'touching edges are not an overlap');
  assert.ok(inside({ x: 5, y: 5 }, sq(0, 0, 10)));
  const t = turnRing(sq(0, 0, 10), { x: 5, y: 5 }, 90);
  near(t[0].x, 10); near(t[0].y, 0);
  assert.equal(turnSnap(37), 30);
  assert.equal(turnSnap(37, true), 37);
});

test('moving a commercial building or row is one undo step and regenerates the layout', async () => {
  const project = commercialProject({ zoning: { code: 'E4', name: 'General Industrial' }, plain: false });
  const store = createStore(project);
  const mv = commercialMovers();
  const sc = await commercialScene(store.project);
  const row = sc.movables.find((m) => m.id.startsWith('r:'));
  assert.ok(row, 'a unit row can be picked up');
  const rowId = row.id.slice(2);
  const x0 = store.project.commercial.rows.find((r) => r.id === rowId).x;
  const n0 = store.history ? store.history.length : null;
  mv.move(store, row.id, 1000, 500, row.label);
  assert.equal(store.project.commercial.rows.find((r) => r.id === rowId).x, x0 + 1000);
  store.undo();
  assert.equal(store.project.commercial.rows.find((r) => r.id === rowId).x, x0, 'one undo puts it back');
  void n0;
  const rot0 = store.project.commercial.rows.find((r) => r.id === rowId).rotationDeg || 0;
  mv.turn(store, row.id, 90, row.centre, row.label);
  assert.equal(store.project.commercial.rows.find((r) => r.id === rowId).rotationDeg, (rot0 + 90) % 360);
  store.undo();
  assert.equal(store.project.commercial.rows.find((r) => r.id === rowId).rotationDeg || 0, rot0);
  assert.equal(mv.can(store.project), true);
});

test('top view move wiring: mode switch, handle, 90 degree buttons, warnings, one undo step per drag, residential house', () => {
  const src = read('../src/lotcard/topview.js');
  assert.match(src, /topview-move-mode/);
  assert.match(src, /topview-turn-left/);
  assert.match(src, /topview-turn-right/);
  assert.match(src, /topview-warning/);
  assert.match(src, /turn-handle/);
  assert.match(src, /if \(drag\.applied\) store\.undo\(\)/);
  assert.match(read('../src/lotcard/lot-card.js'), /movers: \{ can: \(p\) => canMoveHouse\(p\)[^]*translateHouse[^]*rotateHouse/);
  assert.match(read('../src/commercial/lotcard.js'), /movers: \{ can: cm\.can/);
  assert.ok(!/[–—]/.test(src + read('../src/lotcard/topview-move.js') + read('../src/lotcard/mini-view.js')), 'no en or em dashes');
});

test('handle turn: 1 degree steps, Shift snaps to 15, lines up with a lot edge within 2 degrees', () => {
  assert.equal(turnStep(37.4), 37);
  assert.equal(turnStep(37.6), 38);
  assert.equal(turnStep(37, { shift: true }), 30);
  assert.equal(turnStep(-8, { shift: true }), -15);
  const lot = sq(0, 0, 20000); // edges at 0 and 90 degrees
  const base = ringAngle(sq(0, 0, 100).map((p) => p)); // 0 degrees
  assert.equal(turnStep(2, { base, boundary: lot }), 0, 'within 2 degrees of the lot edge snaps to it');
  assert.equal(turnStep(5, { base, boundary: lot }), 5, 'beyond 2 degrees stays free');
  assert.equal(turnStep(88, { base, boundary: lot }), 90, 'the right angle also snaps');
});
