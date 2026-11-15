// Address search fixes from live review (15/11/2026): state-free cache key, timeout retry, "slow" not "not found", street only probe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSite, searchWords } from '../server/lib/site.js';

const LON = 150.9301;
const LAT = -31.0902;
const j = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
const feat = (a) => ({ attributes: { address: a }, geometry: { x: LON, y: LAT } });
const hang = (init) => new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('timeout'))));
const mk = (impl, searchMs = { prefix: 80, fallback: 80 }) => createSite({ fetchImpl: impl, searchMs });
const ask = (site, q) => site.search(new Request('https://x.test/api/site/search?q=' + encodeURIComponent(q)), new URL('https://x.test/api/site/search?q=' + encodeURIComponent(q))).then(async (r) => ({ r, b: await r.json() }));
const isQld = (u) => /qld/i.test(new URL(u).host) && !/six\.nsw/i.test(u);

test('state, postcode and "New South Wales" never reach the where clause', () => {
  const tk = (q) => q.toUpperCase().split(/\s+/);
  const bare = searchWords(tk('756 Quia Road Gunnedah'), null);
  assert.deepEqual(searchWords(tk('756 Quia Road Gunnedah NSW'), 'NSW'), bare);
  assert.deepEqual(searchWords(tk('756 Quia Rd Gunnedah NSW 2380'), 'NSW'), bare);
  assert.deepEqual(searchWords(tk('756 Quia Road Gunnedah New South Wales'), 'NSW'), bare);
  assert.deepEqual(searchWords(tk('12 New Street Tamworth'), null), ['12', 'NEW', 'STREET', 'TAMWORTH']);
});

test('label with NSW is a cache hit on the bare query, with no second upstream call', async () => {
  let calls = 0;
  const wheres = [];
  const site = mk(async (input) => { const u = new URL(String(input)); if (isQld(u.href)) return j({ features: [] }); calls++; wheres.push(u.searchParams.get('where')); return j({ features: [feat('756 QUIA ROAD GUNNEDAH')] }); });
  const a = await ask(site, '756 Quia Road Gunnedah');
  assert.equal(a.b.results[0].label, '756 Quia Road Gunnedah NSW');
  const n = calls;
  const b = await ask(site, '756 Quia Road Gunnedah NSW');
  assert.equal(b.r.headers.get('x-search-cache'), 'memory');
  assert.equal(calls, n);
  assert.equal(b.b.results.length, 1);
  const c = await ask(site, '756 Quia Rd, Gunnedah NSW 2380');
  assert.equal(c.r.headers.get('x-search-cache'), 'memory');
  assert.ok(wheres.every((w) => w === "address LIKE '756 QUIA ROAD GUNNEDAH%'"));
});

test('a prefix query that times out once is retried and the answer returned', async () => {
  let n = 0;
  const site = mk(async (input, init) => { const u = String(input); if (isQld(u)) return j({ features: [] }); n++; if (n === 1) return hang(init); return j({ features: [feat('756 QUIA ROAD GUNNEDAH')] }); });
  const { b } = await ask(site, '756 Quia Road Gunnedah NSW');
  assert.equal(n, 2);
  assert.equal(b.results.length, 1);
  assert.equal(b.unavailable, undefined);
});

test('an upstream that keeps timing out answers "unavailable", not an empty not found, and is never cached', async () => {
  let slow = true;
  const site = mk(async (input, init) => { const u = String(input); if (isQld(u)) return j({ features: [] }); if (slow) return hang(init); return j({ features: [feat('756 QUIA ROAD GUNNEDAH')] }); });
  const a = await ask(site, '756 Quia Rd Gunnedah NSW');
  assert.equal(a.b.unavailable, true);
  assert.deepEqual(a.b.results, []);
  assert.equal(a.r.headers.get('cache-control'), 'no-store');
  slow = false;
  const b = await ask(site, '756 Quia Rd Gunnedah NSW');
  assert.equal(b.b.results.length, 1, 'the timeout was not remembered');
});

test('an address that truly does not exist still answers an empty list without "unavailable"', async () => {
  const site = mk(async () => j({ features: [] }));
  const { b } = await ask(site, '9999 Nowhere Road Gunnedah');
  assert.deepEqual(b.results, []);
  assert.equal(b.unavailable, undefined);
});

test('street only query probes numbers on that street and carries the hint', async () => {
  const site = mk(async (input) => { const u = new URL(String(input)); if (isQld(u.href)) return j({ features: [] }); const m = /^address LIKE '(\d+) QUIA ROAD GUNNEDAH%'$/.exec(u.searchParams.get('where') || ''); return j({ features: m && [2, 10].includes(Number(m[1])) ? [feat(`${m[1]} QUIA ROAD GUNNEDAH`)] : [] }); });
  const { b } = await ask(site, 'Quia Road Gunnedah');
  assert.equal(b.hint, 'number');
  assert.deepEqual(b.results.map((r) => r.label), ['2 Quia Road Gunnedah NSW', '10 Quia Road Gunnedah NSW']);
});
