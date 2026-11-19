import test from 'node:test';
import assert from 'node:assert/strict';
import { setbacksText } from '../src/flow/lot-map.js';

test('flow setbacks text reads rule objects and never prints NaN', () => {
  const t = setbacksText({ setbacks: { front: { minM: 4.5 }, side: 0.9, rear: { value: 3 } } });
  assert.equal(t, 'Indicative setbacks loaded. Front 4.5 m, side 0.9 m, rear 3.0 m');
  const u = setbacksText({ setbacks: { front: { rule: 'see council' }, side: null, rear: 2 } });
  assert.ok(!/NaN/.test(u));
  assert.match(u, /Front check with council/);
});
