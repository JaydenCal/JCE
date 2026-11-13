// Client retry for address search and lot lookup: one retry after about 1.5 s, "Busy, trying again" instead of "no match".
import test from 'node:test';
import assert from 'node:assert/strict';
import { searchAddresses, getLot, fetchSite, RETRY_DELAY_MS, BUSY_MESSAGE } from '../src/site/client.js';

const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
const status = (n) => new Response(JSON.stringify({ message: 'x' }), { status: n, headers: { 'content-type': 'application/json' } });
const R = { results: [{ label: '12 Smith Street Tamworth NSW', state: 'NSW', lon: 150.9, lat: -31.1 }] };
const seq = (...responses) => {
  const calls = [];
  const f = async (url) => { calls.push(String(url)); const r = responses.shift(); if (r instanceof Error) throw r; return r; };
  return { f, calls };
};
const fastSleep = () => { const d = []; return { d, sleepImpl: (ms) => { d.push(ms); return Promise.resolve(); } }; };

test('retry constants: about 1.5 s and the "Busy, trying again" wording', () => {
  assert.equal(RETRY_DELAY_MS, 1500);
  assert.equal(BUSY_MESSAGE, 'Busy, trying again');
});

test('search: an empty answer is retried once after 1.5 s and the second answer is used', async () => {
  const { f, calls } = seq(ok({ results: [] }), ok(R));
  const { d, sleepImpl } = fastSleep();
  let busy = 0;
  const out = await searchAddresses('12 smith street', { fetchImpl: f, sleepImpl, onRetry: () => busy++ });
  assert.equal(out.length, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(d, [1500]);
  assert.equal(busy, 1);
});

test('search: two empty answers is a genuine no match (one retry only)', async () => {
  const { f, calls } = seq(ok({ results: [] }), ok({ results: [] }), ok(R));
  const { sleepImpl } = fastSleep();
  assert.deepEqual(await searchAddresses('zzz qqq', { fetchImpl: f, sleepImpl }), []);
  assert.equal(calls.length, 2);
});

test('search: a good first answer does not retry', async () => {
  const { f, calls } = seq(ok(R));
  let busy = 0;
  await searchAddresses('12 smith street', { fetchImpl: f, onRetry: () => busy++ });
  assert.equal(calls.length, 1);
  assert.equal(busy, 0);
});

test('search: a 5xx or network failure is retried once, then succeeds or throws', async () => {
  const a = seq(status(503), ok(R));
  const { sleepImpl } = fastSleep();
  assert.equal((await searchAddresses('12 smith street', { fetchImpl: a.f, sleepImpl })).length, 1);
  const b = seq(new TypeError('net'), status(500));
  await assert.rejects(searchAddresses('12 smith street', { fetchImpl: b.f, sleepImpl }), /took|not responding|reached/i);
  assert.equal(b.calls.length, 2);
});

test('search: a timeout counts as a retryable failure', async () => {
  let n = 0;
  const f = (url, { signal }) => (++n === 1 ? new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' })))) : Promise.resolve(ok(R)));
  const { sleepImpl } = fastSleep();
  const out = await searchAddresses('12 smith street', { fetchImpl: f, sleepImpl, timeoutMs: 20 });
  assert.equal(out.length, 1);
  assert.equal(n, 2);
});

test('search: a rate limit (429) is not retried', async () => {
  const { f, calls } = seq(status(429), ok(R));
  await assert.rejects(searchAddresses('12 smith street', { fetchImpl: f }), /Too many/);
  assert.equal(calls.length, 1);
});

test('search: aborting during the retry wait rejects with AbortError', async () => {
  const { f } = seq(ok({ results: [] }), ok(R));
  const ctl = new AbortController();
  const p = searchAddresses('12 smith street', { fetchImpl: f, signal: ctl.signal, sleepImpl: () => new Promise(() => {}) });
  setTimeout(() => ctl.abort(), 10);
  await assert.rejects(p, (e) => e.name === 'AbortError');
});

test('lot lookup: one retry on 5xx with a busy notice; 404 is not retried', async () => {
  const a = seq(status(502), ok({ lot: 1 }));
  const { sleepImpl, d } = fastSleep();
  let busy = 0;
  assert.deepEqual(await getLot({ lon: 1, lat: 2 }, { fetchImpl: a.f, sleepImpl, onRetry: () => busy++ }), { lot: 1 });
  assert.equal(busy, 1);
  assert.deepEqual(d, [1500]);
  const b = seq(status(404), ok({ lot: 1 }));
  await assert.rejects(getLot({ lon: 1, lat: 2 }, { fetchImpl: b.f, sleepImpl }));
  assert.equal(b.calls.length, 1);
});

test('fetchSite reports step "busy" while the lot lookup retries', async () => {
  const steps = [];
  const f = async (url) => { if (/\/lot\?/.test(String(url))) { if (!steps.includes('busy')) return status(503); } throw new TypeError('stop here'); };
  const { sleepImpl } = fastSleep();
  await fetchSite({ lon: 1, lat: 2, state: 'NSW' }, { fetchImpl: f, sleepImpl, onStep: (s) => steps.push(s) }).catch(() => {});
  assert.deepEqual(steps.slice(0, 2), ['lot', 'busy']);
});

test('jsPDF loader uses the sibling file URL the page sets (window.__PS_JSPDF__)', async () => {
  const appended = [];
  globalThis.window = { __PS_JSPDF__: 'https://x.test/plan-studio/app/ps-jspdf.js' };
  globalThis.document = { createElement: () => ({}), head: { append: (s) => { appended.push(s.src); s.onerror(); } } };
  try {
    const { loadJsPDF } = await import('../src/premium/export-client.js');
    await assert.rejects(loadJsPDF(), /could not be loaded/);
    assert.deepEqual(appended, ['https://x.test/plan-studio/app/ps-jspdf.js']);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
});
