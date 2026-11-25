// Openings sit where the plan puts them: a small margin at a free wall end, none where the wall meets another wall, and an exact mode
// that reports a problem instead of moving or narrowing an opening.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/model/schema.js';
import { applyOp, endMargins, FREE_END_MARGIN } from '../src/model/ops.js';

function box() {
  const p = createProject({ name: 'Box', type: 'house' });
  const run = (op, a) => applyOp(p, op, a, {});
  // a 6000 x 4000 room walled on all sides, plus a free standing wall stub that touches nothing
  for (const [x1, y1, x2, y2] of [[0, 0, 6000, 0], [6000, 0, 6000, 4000], [6000, 4000, 0, 4000], [0, 4000, 0, 0]]) run('add_wall', { x1, y1, x2, y2 });
  run('add_wall', { x1: 10000, y1: 0, x2: 12000, y2: 0 });
  const lvl = p.levels[0];
  const wallAt = (x, y) => lvl.walls.find((w) => Math.min(w.a.x, w.b.x) <= x && Math.max(w.a.x, w.b.x) >= x && Math.min(w.a.y, w.b.y) <= y && Math.max(w.a.y, w.b.y) >= y);
  return { p, run, lvl, wallAt };
}
const win = (wall, offset, width, extra = {}) => ({ wall: wall.id, offset, width, kind: 'window', height: 1200, sill: 900, style: 'sliding', ...extra });

test('the end margin is 0 where the wall meets another wall and small at a free end', () => {
  const { lvl, wallAt } = box();
  const south = wallAt(3000, 0);
  assert.deepEqual(endMargins(lvl, south), [0, 0]);
  const stub = wallAt(11000, 0);
  assert.deepEqual(endMargins(lvl, stub), [FREE_END_MARGIN, FREE_END_MARGIN]);
  assert.ok(FREE_END_MARGIN <= 50);
});

test('an opening can fill a wall from one junction to the other', () => {
  const { run, lvl, wallAt } = box();
  const south = wallAt(3000, 0);
  const { id } = run('add_opening', win(south, 3000, 6000));
  const o = lvl.openings.find((q) => q.id === id);
  assert.equal(o.width, 6000);
  assert.equal(o.offset, 3000);
});

test('a free end keeps its small margin when the opening is nudged', () => {
  const { run, lvl, wallAt } = box();
  const stub = wallAt(11000, 0);
  const { id } = run('add_opening', win(stub, 100, 1200));
  const o = lvl.openings.find((q) => q.id === id);
  assert.equal(o.offset - o.width / 2, FREE_END_MARGIN);
});

test('exact mode places the opening where it was asked, to the millimetre', () => {
  const { run, lvl, wallAt } = box();
  const south = wallAt(3000, 0);
  const { id } = run('add_opening', win(south, 755, 1510, { exact: true }));
  const o = lvl.openings.find((q) => q.id === id);
  assert.equal(o.offset, 755);
  assert.equal(o.width, 1510);
});

test('exact mode reports an opening that does not fit instead of moving or narrowing it', () => {
  const { run, lvl, wallAt } = box();
  const south = wallAt(3000, 0);
  const before = JSON.stringify(lvl.openings);
  assert.throws(() => run('add_opening', win(south, 400, 1510, { exact: true })), /does not fit the wall/);
  assert.throws(() => run('add_opening', win(south, 5400, 1510, { exact: true })), /does not fit the wall/);
  const stub = wallAt(11000, 0);
  assert.throws(() => run('add_opening', win(stub, 20, 1500, { exact: true })), /does not fit the wall/);
  assert.equal(JSON.stringify(lvl.openings), before, 'a refused opening leaves the plan as it was');
});

test('exact mode reports an opening that overlaps another, where the default mode would have moved it', () => {
  const { run, lvl, wallAt } = box();
  const south = wallAt(3000, 0);
  run('add_opening', win(south, 2000, 1000, { exact: true }));
  assert.throws(() => run('add_opening', win(south, 2800, 1000, { exact: true })), /overlaps/);
  assert.equal(lvl.openings.length, 1);
  // touching edges are not an overlap
  run('add_opening', win(south, 3000, 1000, { exact: true }));
  assert.equal(lvl.openings.length, 2);
});

test('moving a wall keeps the margin rule when openings are refitted', () => {
  const { run, lvl, wallAt } = box();
  const south = wallAt(3000, 0);
  run('add_opening', win(south, 3000, 6000));
  // shorten the south wall by moving the east wall in: the opening is refitted to the shorter wall, still junction to junction
  const east = wallAt(6000, 2000);
  run('move_wall', { id: east.id, dx: -1000, dy: 0 });
  const s2 = lvl.walls.find((w) => w.id === south.id);
  const o = lvl.openings[0];
  const L = Math.hypot(s2.b.x - s2.a.x, s2.b.y - s2.a.y);
  assert.ok(o.width <= L + 0.5);
  assert.ok(o.offset - o.width / 2 >= -0.5 && o.offset + o.width / 2 <= L + 0.5);
});
