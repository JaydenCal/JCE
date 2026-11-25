// Touch move and turn for the house (src/phone/house-gesture.js): grab offset, no orbit during a drag, snapping with a haptic, twist angle,
// 15 degree steps, and one commit (one undo step) per gesture. Pure: a fake canvas and fake orbit controls stand in for the viewer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { grabOffset, centreFor, moveFor, smoothMove, snapToSetbacks, haptic, pairAngle, angleDelta, twistTotal, stepRotation, stepTurn, createHouseGestures, SNAP_TOL_MM, STEP_DEG, HANDLE_PX } from '../src/phone/house-gesture.js';
import { SRC } from './helpers/phone-harness.mjs';

const square = (x, y, s = 10000) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];

test('grab offset: a finger that lands off centre keeps its place on the house, so the first move does not jump', () => {
  const centre = { x: 10000, y: 20000 };
  const grab = { x: 12500, y: 19000 }; // landed 2.5 m right and 1 m above the centre
  const off = grabOffset(centre, grab);
  assert.deepEqual(off, { x: 2500, y: -1000 });
  // finger has not moved: the house has not moved
  assert.deepEqual(moveFor({ centre, offset: off, pointer: grab }), { dx: 0, dy: 0 });
  // finger moves 1 m right and 0.5 m down: the house moves exactly that far, and the centre is not pulled to the finger
  assert.deepEqual(moveFor({ centre, offset: off, pointer: { x: 13500, y: 19500 } }), { dx: 1000, dy: 500 });
  assert.deepEqual(centreFor({ x: 13500, y: 19500 }, off), { x: 11000, y: 20500 });
});

test('smoothing is light: it follows the finger and never overshoots', () => {
  let shown = { dx: 0, dy: 0 };
  const want = { dx: 1000, dy: -400 };
  for (let i = 0; i < 12; i++) { shown = smoothMove(shown, want, 0.55); assert.ok(shown.dx <= 1000 && shown.dy >= -400); }
  assert.ok(Math.abs(shown.dx - 1000) < 5 && Math.abs(shown.dy + 400) < 3);
  assert.deepEqual(smoothMove({ dx: 0, dy: 0 }, want, 1), want);
});

test('snapping: a corner within 0.3 m of a setback line is pulled onto it; further away it is only rounded to 50 mm', () => {
  const setback = square(0, 0, 30000); // the setback polygon
  const house = [square(5000, 5000, 8000)];
  // the house's west edge is at x=5000; moving it to x=-... no: move the east edge (13000) toward the line x=30000 is far, use the west edge toward x=0
  const near = snapToSetbacks(house, { dx: -4900, dy: 120 }, [setback], SNAP_TOL_MM); // west edge would be at 100 mm from the line
  assert.equal(near.snapped, true);
  assert.equal(near.dx, -5000, 'the west wall lands on the setback line');
  const far = snapToSetbacks(house, { dx: -4000, dy: 130 }, [setback], SNAP_TOL_MM); // 1 m away
  assert.equal(far.snapped, false);
  assert.equal(far.dx, -4000);
  assert.equal(far.dy, 150, 'rounded to 50 mm');
  assert.equal(SNAP_TOL_MM, 300);
});

test('haptic: a 10 ms tick where navigator.vibrate exists, silent where it does not', () => {
  const calls = [];
  assert.equal(haptic({ vibrate: (ms) => { calls.push(ms); return true; } }), true);
  assert.deepEqual(calls, [10]);
  assert.equal(haptic({}), false);
  assert.equal(haptic({ vibrate() { throw new Error('blocked'); } }), false);
});

test('twist angle: the turn between two finger pairs, shortest way round, summed so crossing the top does not jump', () => {
  const a0 = pairAngle({ x: 0, y: 0 }, { x: 100, y: 0 });
  assert.equal(a0, 0);
  assert.ok(Math.abs(pairAngle({ x: 0, y: 0 }, { x: 0, y: 100 }) - 90) < 1e-9, 'clockwise on screen is positive');
  assert.equal(angleDelta(170, -170), 20, 'across the 180 line it is 20, not -340');
  assert.equal(angleDelta(-170, 170), -20);
  let total = 0; let prev = 170;
  for (const next of [175, -180, -175, -170]) { total = twistTotal(total, prev, next); prev = next; }
  assert.equal(total, 20);
});

test('15 degree steps: the Rotate buttons always turn by one step, and land on a multiple of 15', () => {
  assert.equal(STEP_DEG, 15);
  assert.equal(stepTurn(1), 15); assert.equal(stepTurn(-1), -15);
  assert.equal(stepRotation(0, 1), 15);
  assert.equal(stepRotation(0, -1), -15);
  assert.equal(stepRotation(10, 1), 15, 'from 10 degrees the next step up is 15');
  assert.equal(stepRotation(10, -1), 0);
  assert.equal(stepRotation(15, 1), 30);
  assert.equal(stepRotation(15, -1), 0);
  assert.equal(stepRotation(-7, -1), -15);
  assert.equal(HANDLE_PX, 44, 'the rotate handle is a 44 px target');
});

// ---- the state machine ------------------------------------------------------------------------------------------------
function rig({ onHouse = (x, y) => x < 500, plan = (x, y) => ({ x: x * 20, y: y * 20 }), enabled = true, nav = { vibrate: (ms) => { rig.buzz.push(ms); } } } = {}) {
  rig.buzz = [];
  const canvas = { style: { touchAction: 'pan-x' } };
  const controls = { enabled: true };
  const log = { preview: [], commit: [], select: [], stops: 0 };
  const centre = { x: 5000, y: 5000 };
  const g = createHouseGestures({
    canvas, controls, nav,
    hitHouse: onHouse, planPoint: plan, enabled: () => enabled,
    state: () => ({ centre, rings: [square(0, 0, 10000)], targets: [] }),
    preview: (p) => log.preview.push(p), commit: (c) => log.commit.push(c), select: (s) => log.select.push(s),
  });
  const ev = (id, x, y) => ({ pointerId: id, pointerType: 'touch', clientX: x, clientY: y, stopImmediatePropagation() { log.stops++; }, preventDefault() {} });
  return { g, canvas, controls, log, ev };
}

test('one finger on the house drags it: orbit is off and touch-action is none while it drags, and both come back after', () => {
  const { g, canvas, controls, log, ev } = rig();
  assert.equal(g.down(ev(1, 250, 250)), true);
  assert.equal(controls.enabled, false, 'orbit is off from the first touch');
  assert.equal(canvas.style.touchAction, 'none');
  assert.ok(log.stops > 0, 'the orbit controls never see the touch');
  g.move(ev(1, 252, 250)); // under the 4 px threshold: nothing yet
  assert.equal(log.preview.length, 0);
  g.move(ev(1, 270, 262));
  g.move(ev(1, 300, 280));
  assert.ok(log.preview.length >= 2);
  assert.equal(controls.enabled, false);
  g.up(ev(1, 300, 280));
  assert.equal(controls.enabled, true, 'orbit is back');
  assert.equal(canvas.style.touchAction, 'pan-x', 'the canvas gets its own touch-action back');
  assert.equal(log.commit.length, 1, 'one commit for the whole drag: one undo step');
  assert.deepEqual(log.commit[0], { kind: 'move', dx: 1000, dy: 600 }, '50 px right and 30 px down at 20 mm per px, grab offset kept');
  assert.equal(log.preview.at(-1), null, 'the preview is cleared');
});

test('a finger that starts off the house is left to the camera: orbit stays on and nothing is committed', () => {
  const { g, controls, canvas, log, ev } = rig();
  assert.equal(g.down(ev(1, 800, 300)), false, 'not taken');
  assert.equal(controls.enabled, true);
  assert.equal(canvas.style.touchAction, 'pan-x');
  g.move(ev(1, 850, 340));
  g.up(ev(1, 850, 340));
  assert.equal(log.commit.length, 0);
  assert.equal(log.stops, 0, 'no event was stopped');
  assert.equal(controls.enabled, true);
});

test('a tap on the house selects it and commits nothing; a tap away from it puts it away', () => {
  const { g, log, ev } = rig();
  g.down(ev(1, 250, 250)); g.up(ev(1, 250, 250));
  assert.deepEqual(log.select, [true]);
  assert.equal(log.commit.length, 0);
  g.down(ev(2, 900, 250)); g.up(ev(2, 900, 250));
  assert.deepEqual(log.select, [true, false]);
});

test('dragging snaps to a setback line within 0.3 m with one short haptic, and not again while it stays snapped', () => {
  const nav = { vibrate: (ms) => { buzz.push(ms); } };
  const buzz = [];
  const canvas = { style: {} }; const controls = { enabled: true };
  const commits = [];
  const g = createHouseGestures({
    canvas, controls, nav, hitHouse: () => true, planPoint: (x, y) => ({ x: x * 10, y: y * 10 }), enabled: () => true,
    state: () => ({ centre: { x: 5000, y: 5000 }, rings: [square(0, 0, 10000)], targets: [square(-12000, -3000, 40000)] }), // a setback line 12 m left of the house
    commit: (c) => commits.push(c),
  });
  const ev = (x, y) => ({ pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, stopImmediatePropagation() {}, preventDefault() {} });
  g.down(ev(500, 500));
  g.move(ev(400, 500)); // 1 m left: free
  assert.equal(buzz.length, 0);
  g.move(ev(-700, 500)); // 12.0 m left would put the west wall on the line, 150 mm short of exactly: within tolerance
  g.move(ev(-705, 500)); // a pixel more, still snapped
  assert.equal(buzz.length, 1, 'one tick on arriving at the line');
  assert.deepEqual(buzz, [10]);
  g.up(ev(-705, 500));
  assert.equal(commits[0].dx, -12000 + 0, 'the wall sits exactly on the line');
});

test('two fingers on the house turn it, with orbit off while both are down; one commit when they lift', () => {
  const { g, controls, log, ev } = rig();
  g.down(ev(1, 200, 300)); // lands on the house: a drag has begun
  assert.equal(g.down(ev(2, 300, 300)), true, 'the second finger joins: a twist');
  assert.equal(g.mode, 'twist');
  assert.equal(controls.enabled, false);
  // turn the pair a quarter turn clockwise: from horizontal to vertical
  g.move(ev(1, 250, 250));
  g.move(ev(2, 250, 350));
  assert.ok(log.preview.some((p) => p && p.deg === 90), 'the preview reaches 90 degrees');
  g.up(ev(2, 250, 350));
  assert.deepEqual(log.commit.at(-1), { kind: 'turn', deg: 90 });
  assert.equal(controls.enabled, false, 'still one finger down: the camera does not take it over');
  g.up(ev(1, 250, 250));
  assert.equal(controls.enabled, true);
  assert.equal(log.commit.filter((c) => c.kind === 'turn').length, 1, 'one undo step for the turn');
});

test('two fingers that both start off the house keep pinching the camera', () => {
  const { g, controls, log, ev } = rig();
  g.down(ev(1, 800, 300));
  assert.equal(g.down(ev(2, 900, 300)), false);
  assert.equal(controls.enabled, true);
  g.up(ev(1, 800, 300)); g.up(ev(2, 900, 300));
  assert.equal(log.commit.length, 0);
});

test('mouse and pen are left alone, and nothing happens when the gestures are switched off', () => {
  const off = rig({ enabled: false });
  assert.equal(off.g.down(off.ev(1, 250, 250)), false);
  assert.equal(off.controls.enabled, true);
  const on = rig();
  assert.equal(on.g.down({ ...on.ev(1, 250, 250), pointerType: 'mouse' }), false);
});

test('wiring: the 3D viewer, the plan tool and the dock use the gesture module, copy follows the rules', () => {
  const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
  assert.match(read('src/viewer3d/viewer.js'), /createHouseDrag/);
  assert.match(read('src/viewer3d/house-drag.js'), /createHouseGestures/);
  assert.match(read('src/editor2d/tool-movehouse.js'), /twistStart/);
  assert.match(read('src/editor2d/editor.js'), /twistStart/);
  for (const f of ['src/phone/house-gesture.js', 'src/viewer3d/house-drag.js', 'src/phone/menu-extras.js', 'src/phone/export-entry.js']) assert.ok(!/[–—]/.test(read(f).replace(/\/\/.*$/gm, '')), `${f} has no dashes in code strings`);
});
