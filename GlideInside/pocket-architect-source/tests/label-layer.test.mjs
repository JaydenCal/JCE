// Commercial 2D labels: stacked labels are separated, leader lines are flagged, fixed labels only reserve space, and the canvas wrapper
// collects upright text and draws it clear of the others.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLabels, createLabelLayer } from '../src/editor2d/label-layer.js';

const L = (x, y, w = 80, h = 12, extra = {}) => ({ x, y, w, h, align: 'center', base: 'middle', ...extra });
const box = (r, it) => ({ x0: r.x - it.w / 2, x1: r.x + it.w / 2, y0: r.y - it.h / 2, y1: r.y + it.h / 2 });
const hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

test('three labels stacked on one spot (underground tanks) end up apart, the first stays put', () => {
  const items = [L(300, 200), L(300, 200), L(300, 200)];
  const r = resolveLabels(items, { w: 800, h: 600 });
  assert.equal(r[0].moved, false);
  assert.equal(r[1].moved, true);
  assert.equal(r[2].moved, true);
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(!hit(box(r[i], items[i]), box(r[j], items[j])), `labels ${i} and ${j} are apart`);
});

test('a long canopy label over pump text is moved clear', () => {
  const items = [L(400, 300, 160, 12), L(420, 304, 40, 12), L(380, 296, 40, 12)];
  const r = resolveLabels(items, { w: 800, h: 600 });
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) assert.ok(!hit(box(r[i], items[i]), box(r[j], items[j])));
});

test('labels that do not collide are not moved, and fixed labels only reserve their space', () => {
  const r = resolveLabels([L(100, 100), L(400, 400)], { w: 800, h: 600 });
  assert.ok(r.every((x) => !x.moved));
  const f = resolveLabels([L(300, 200, 80, 12, { fixed: true }), L(300, 200)], { w: 800, h: 600 });
  assert.equal(f[0].moved, false);
  assert.equal(f[1].moved, true);
});

test('labels stay inside the canvas', () => {
  const items = [L(40, 8), L(40, 8), L(40, 8)];
  const r = resolveLabels(items, { w: 800, h: 600 });
  for (let i = 0; i < items.length; i++) { const b = box(r[i], items[i]); assert.ok(b.x0 >= 0 && b.y0 >= 0 || !r[i].moved); }
});

test('the canvas wrapper collects upright text and draws it apart with a leader line; other calls pass through', () => {
  const calls = [];
  const g = {
    font: '600 10px sans-serif', fillStyle: '#000', strokeStyle: '#fff', lineWidth: 1, textAlign: 'center', textBaseline: 'middle', globalAlpha: 1,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    measureText: (t) => ({ width: t.length * 6 }),
    save() {}, restore() {}, setTransform() {}, beginPath() { calls.push('beginPath'); }, moveTo() { calls.push('moveTo'); }, lineTo() { calls.push('lineTo'); }, stroke() { calls.push('stroke'); }, arc() {}, fill() {},
    fillText(t, x, y) { calls.push(['fill', t, x, y]); }, strokeText(t, x, y) { calls.push(['stroke', t, x, y]); },
  };
  const lay = createLabelLayer(g);
  lay.ctx.fillText('UNDERGROUND TANK 1', 200, 100);
  lay.ctx.strokeText('UNDERGROUND TANK 2', 200, 100);
  lay.ctx.fillText('UNDERGROUND TANK 2', 200, 100);
  lay.ctx.beginPath();
  assert.equal(lay.count(), 2);
  assert.ok(calls.includes('beginPath'), 'non text calls pass through at once');
  assert.ok(!calls.some((c) => Array.isArray(c)), 'text waits for the flush');
  const { moved } = lay.flush({ w: 800, h: 600 });
  assert.equal(moved, 1);
  const fills = calls.filter((c) => Array.isArray(c) && c[0] === 'fill');
  assert.equal(fills.length, 2);
  assert.notEqual(fills[0][3], fills[1][3], 'the second label sits on another line');
  assert.ok(calls.includes('lineTo'), 'a leader line joins the moved label');
});
