// createLiveSearch: debounce about 300 ms, abort the previous request on each keystroke, ignore stale answers, never report a failure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveSearch, SEARCH_DEBOUNCE_MS } from '../src/site/address-search.js';

const manual = () => { const q = []; return { q, setT: (fn, ms) => { const t = { fn, ms }; q.push(t); return t; }, clearT: (t) => { if (t) t.dead = true; }, fire: () => { const t = q.filter((x) => !x.dead).pop(); if (t) { t.dead = true; return t.fn(); } } }; };

test('debounce is 300 ms', () => assert.equal(SEARCH_DEBOUNCE_MS, 300));

test('each keystroke cancels the pending timer and aborts the request in flight', async () => {
  const m = manual();
  const signals = [];
  let text = '12 smi';
  const got = [];
  const ls = createLiveSearch({ getText: () => text, onResults: (r) => got.push(r), delay: 300, setT: m.setT, clearT: m.clearT,
    search: (q, { signal }) => { signals.push(signal); return new Promise((res, rej) => { signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))); setTimeout(() => res([{ label: q }]), 20); }); } });
  ls.trigger(); assert.equal(m.q[0].ms, 300);
  const p1 = m.fire();
  text = '12 smit'; ls.trigger(); // aborts the first request
  assert.equal(signals[0].aborted, true);
  await p1;
  const p2 = m.fire(); await p2;
  assert.deepEqual(got, [[{ label: '12 smit' }]], 'only the latest answer is shown');
});

test('a failure or a 429 never reaches the UI as an error; short text clears', async () => {
  const m = manual(); const got = []; let busy = 0;
  let text = '12 smith';
  const ls = createLiveSearch({ getText: () => text, onResults: (r) => got.push(r.length), onBusy: () => busy++, setT: m.setT, clearT: m.clearT, search: async (q, { onRetry }) => { onRetry(); throw new Error('boom'); } });
  ls.trigger(); await m.fire();
  assert.deepEqual(got, [0]); assert.equal(busy, 1);
  text = '12'; ls.trigger(); await m.fire(); assert.deepEqual(got, [0, 0]);
});
