// Drawing tools work in the house's local axes: rectangle corners land on the rotated grid.
import test from 'node:test';
import assert from 'node:assert/strict';
import { localAxis, snapToRotatedGrid, rotatedRect } from '../src/editor2d/local-axes.js';

const turnedLevel = (deg) => {
  const r = (deg * Math.PI) / 180;
  const c = (x, y) => ({ x: Math.round(x * Math.cos(r) - y * Math.sin(r)), y: Math.round(x * Math.sin(r) + y * Math.cos(r)) });
  const pts = [c(0, 0), c(10000, 0), c(10000, 8000), c(0, 8000)];
  return { walls: pts.map((a, i) => ({ a, b: pts[(i + 1) % 4] })) };
};

test('near a house turned 45 degrees the axis is the wall angle; Alt gives square to the screen', () => {
  const lv = turnedLevel(30);
  const near = { x: 4000, y: 2300 };
  const ax = localAxis({}, lv, near);
  assert.equal(ax.source, 'house');
  assert.ok(Math.abs(ax.deg - 30) < 0.2, String(ax.deg));
  assert.equal(localAxis({}, lv, near, { alt: true }).deg, 0);
});

test('far from the house the lot frontage angle is used, else north', () => {
  const lot = { boundary: [{ x: 0, y: 0 }, { x: 20000, y: 5000 }, { x: 18000, y: 30000 }, { x: -2000, y: 25000 }], frontEdges: [0] };
  const ax = localAxis({ site: { lot } }, { walls: [] }, { x: 9000, y: 9000 });
  assert.equal(ax.source, 'frontage');
  assert.ok(Math.abs(ax.deg - 14) < 0.2, String(ax.deg));
  assert.deepEqual(localAxis({}, { walls: [] }, { x: 0, y: 0 }), { deg: 0, source: 'north' });
});

test('rectangle corners land on the rotated grid and are right angles', () => {
  const a = { x: 1000, y: 1000 };
  const b = snapToRotatedGrid(a, { x: 5733, y: 4211 }, 45);
  const rr = rotatedRect(a, b, 45);
  const [p0, p1, p2, p3] = rr.points;
  const dot = (u, v) => u.x * v.x + u.y * v.y;
  const e1 = { x: p1.x - p0.x, y: p1.y - p0.y };
  const e2 = { x: p3.x - p0.x, y: p3.y - p0.y };
  assert.ok(Math.abs(dot(e1, e2)) < 200, 'not square');
  assert.ok(Math.abs(Math.atan2(e1.y, e1.x) * 180 / Math.PI - 45) < 0.5);
  assert.ok(Math.abs(rr.w % 50) < 2 || Math.abs((rr.w % 50) - 50) < 2);
});
