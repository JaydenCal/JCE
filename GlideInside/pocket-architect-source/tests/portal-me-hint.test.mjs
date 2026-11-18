// /portal/me is only requested when a session hint (set at sign in) exists, so anonymous public pages log no 401.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpApi, SESSION_HINT_KEY } from '../src/portal/api.js';

const withStorage = (initial, fn) => async () => {
  const data = new Map(Object.entries(initial));
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) } });
  try { await fn(data); } finally { if (prev) Object.defineProperty(globalThis, 'localStorage', prev); else delete globalThis.localStorage; }
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('no hint: me() resolves null with no request', withStorage({}, async () => {
  let calls = 0;
  const api = createHttpApi({ fetchImpl: async () => { calls++; return json(401, {}); } });
  assert.equal(await api.me(), null);
  assert.equal(calls, 0);
}));

test('sign in sets the hint, me() then asks the server; a 401 clears it', withStorage({}, async (data) => {
  let n = 0;
  const api = createHttpApi({ fetchImpl: async (url) => { n++; return /session/.test(url) ? json(200, { user: { id: 1 } }) : json(401, {}); } });
  await api.signIn({ identifier: 'a', password: 'b' });
  assert.equal(data.get(SESSION_HINT_KEY), '1');
  assert.equal(await api.me(), null);
  assert.equal(n, 2);
  assert.equal(data.has(SESSION_HINT_KEY), false);
  assert.equal(await api.me(), null);
  assert.equal(n, 2, 'hint cleared: no more requests');
}));

test('sign out clears the hint; a hinted me() with a user keeps it', withStorage({ [SESSION_HINT_KEY]: '1' }, async (data) => {
  const api = createHttpApi({ fetchImpl: async (url, o) => (o.method === 'DELETE' ? json(200, {}) : json(200, { user: { id: 1 } })) });
  assert.ok((await api.me()).user);
  await api.signOut();
  assert.equal(data.has(SESSION_HINT_KEY), false);
}));
