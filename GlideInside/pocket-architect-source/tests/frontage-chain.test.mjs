// An irregular frontage made of several gently bending street edges is one frontage; a corner is not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEdges } from '../src/model/placement.js';
import { frontageM, lotMapSvg } from '../src/flow/lot-map.js';
import { createProject } from '../src/model/schema.js';

// Street along the bottom (y large): three consecutive edges bend gently (a splay at each end), the short one is the middle edge.
const lot = () => ({
  boundary: [{ x: 0, y: 0 }, { x: 0, y: 30000 }, { x: 9000, y: 34000 }, { x: 11900, y: 34500 }, { x: 24000, y: 31000 }, { x: 24000, y: 0 }],
  frontEdges: [1, 2, 3, 4],
});
const len = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('a multi segment frontage reports the whole street side, not the shortest edge', () => {
  const l = lot();
  const kinds = classifyEdges(l).map((e) => e.kind);
  assert.deepEqual(kinds.slice(1, 4), ['front', 'front', 'front']);
  assert.equal(kinds[4], 'secondaryFront', 'a sharp turn is not part of the chain');
  const b = l.boundary;
  const want = [1, 2, 3].reduce((t, i) => t + len(b[i], b[i + 1]), 0) / 1000;
  assert.ok(Math.abs(frontageM(l) - want) < 1e-6, `frontage ${frontageM(l)} m, want ${want} m`);
  assert.ok(frontageM(l) > 20, 'not the 2.9 m short segment');
});

test('a corner lot keeps its secondary frontage separate (a 90 degree turn is not a chain)', () => {
  const l = { boundary: [{ x: 0, y: 0 }, { x: 0, y: 30000 }, { x: 15000, y: 30000 }, { x: 15000, y: 0 }], frontEdges: [0, 1] };
  const k = classifyEdges(l).map((e) => e.kind);
  assert.equal(k.filter((x) => x === 'front').length, 1);
  assert.equal(k.filter((x) => x === 'secondaryFront').length, 1);
});

test('the lot map draws no road, kerb or street label', () => {
  const p = createProject();
  p.site.lot = lot();
  const svg = lotMapSvg(p);
  assert.ok(!svg.includes('#6b6f76') && !svg.includes('#f3e08a') && !/STREET/.test(svg));
  assert.ok(svg.includes('#1b4fd1') && svg.includes('#d11f1f'));
});
