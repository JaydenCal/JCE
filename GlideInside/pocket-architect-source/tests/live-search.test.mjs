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

import { SEARCH_BUSY_TEXT } from '../src/site/address-search.js';
test('Enter (now) aborts the previous search and an identical query is sent once', async () => {
  let calls = 0; const signals = [];
  let text = '12 smith street';
  const got = [];
  const ls = createLiveSearch({ getText: () => text, onResults: (r) => got.push(r.length), search: (q, { signal }) => { calls++; signals.push(signal); return new Promise((res) => setTimeout(() => res([{ label: q }]), 15)); } });
  const ps = []; for (let i = 0; i < 20; i++) ps.push(ls.now());
  await Promise.all(ps);
  assert.equal(calls, 1, '20 Enter presses on one query make one call');
  await ls.now(); // just answered
  assert.equal(calls, 1, 'the answered query is not repeated');
  text = '12 smith street tamworth';
  const p1 = ls.now(); text = '14 smith street tamworth'; const p2 = ls.now();
  assert.equal(signals.at(-2).aborted, true, 'the earlier query was aborted');
  assert.equal(await p1, null, 'its answer is dropped');
  assert.equal((await p2).length, 1);
  assert.equal(calls, 3);
});
test('a 429 or 500 clears the stale suggestions and shows the busy message', async () => {
  const text = '12 smith street'; const rows = []; const msgs = [];
  for (const code of ['HTTP_429', 'HTTP_500']) {
    let n = 0;
    const ls = createLiveSearch({ getText: () => text, onResults: (r) => rows.push(r.length), onError: (t) => msgs.push(t), search: async () => { if (n++ === 0) return [{ label: 'old' }]; throw Object.assign(new Error('x'), { code }); } });
    await ls.now(); text.length; // first answer: one stale row
    await ls.cancel();
    const out = await createLiveSearch({ getText: () => text, onResults: (r) => rows.push(r.length), onError: (t) => msgs.push(t), search: async () => { throw Object.assign(new Error('x'), { code }); } }).now();
    assert.equal(out.failed, true);
  }
  assert.deepEqual(msgs, [SEARCH_BUSY_TEXT, SEARCH_BUSY_TEXT]);
  assert.equal(SEARCH_BUSY_TEXT, 'The address search is busy. Try again in a moment.');
  assert.ok(rows.includes(0), 'results were emptied');
  // a rate limited empty answer (the client's quiet retry also failed) is reported as busy too
  const m2 = [];
  const rl = Object.assign([], { rateLimited: true });
  await createLiveSearch({ getText: () => text, onResults() {}, onError: (t) => m2.push(t), search: async () => rl }).now();
  assert.deepEqual(m2, [SEARCH_BUSY_TEXT]);
});

test('a failure carrying only an HTTP status (any body code) is told as busy', async () => {
  const msgs = [];
  await createLiveSearch({ getText: () => '12 smith street', onResults() {}, onError: (t) => msgs.push(t), search: async () => { throw Object.assign(new Error('x'), { code: 'X', status: 500 }); } }).now();
  await createLiveSearch({ getText: () => '12 smith street', onResults() {}, onError: (t) => msgs.push(t), search: async () => { throw Object.assign(new Error('x'), { code: 'WHATEVER', status: 429 }); } }).now();
  await createLiveSearch({ getText: () => '12 smith street', onResults() {}, onError: (t) => msgs.push(t), search: async () => { throw Object.assign(new Error('x'), { code: 'NOT_FOUND', status: 404 }); } }).now();
  assert.deepEqual(msgs, [SEARCH_BUSY_TEXT, SEARCH_BUSY_TEXT]);
});
