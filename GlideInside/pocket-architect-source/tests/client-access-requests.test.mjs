// Live review item 13: the "Have a local builder in mind?" finder. Public search of builders who opted in (name, region, logo only),
// a client access request into THAT builder's queue, approve (issues the login through the normal flow and its billing gates) and decline,
// the owner's admin view, the abuse controls (CSRF header, honeypot, rate limits) and that nothing is ever emailed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../server/lib/app.js';
import { createMemoryStore, createD1Store } from '../server/lib/store.js';
import { createMemoryPortalStore, createD1PortalStore } from '../server/lib/portal-store.js';
import { cleanQuery, requestBody, formProblem, sentText, FOR_BUILDERS_URL, NOT_LISTED } from '../src/flow/builder-finder.js';
import { createMockApi, memoryStorage, DEMO_LOGINS } from '../src/portal/mock-api.js';
import { createHttpApi, CALLS } from '../src/portal/api.js';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* D1 shim skipped */ }

const SITE = 'https://site.test';
const ADMIN_TOKEN = 'admin-token-for-tests-0123456789';
const T0 = Date.UTC(2026, 10, 11, 1, 0, 0);
const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]).toString('base64')}`;
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

function makeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(read('../server/schema.sql'));
  const norm = (a) => a.map((v) => (v === undefined ? null : v));
  const statement = (sql, args = []) => ({
    bind: (...a) => statement(sql, norm(a)),
    run: async () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
  });
  return { prepare: (sql) => statement(sql), _db: db };
}

function world({ d1 = false } = {}) {
  const clock = { t: T0 };
  const db = d1 ? makeD1() : null;
  const store = d1 ? createD1Store(db) : createMemoryStore();
  const pstore = d1 ? createD1PortalStore(db) : createMemoryPortalStore();
  const outbound = [];
  const fetchImpl = async (url) => { outbound.push(String(url)); throw new Error(`unexpected network call ${url}`); };
  const app = createApp({ store, portalStore: pstore, fetchImpl, now: () => clock.t, env: { SITE_URL: SITE, ENTITLEMENT_SECRET: 'unit-test-secret', PORTAL_ENABLED: '1', ADMIN_TOKEN } });
  const w = { clock, app, outbound, pstore };
  w.browser = (ip = '203.0.113.5') => {
    const jar = { cookie: null };
    const call = async (method, path, body, { noCsrf = false, headers = {} } = {}) => {
      const h = { origin: SITE, 'cf-connecting-ip': ip, ...headers };
      if (jar.cookie) h.cookie = `gi_session=${jar.cookie}`;
      if (!noCsrf) h['x-gi-request'] = '1';
      if (body !== undefined) h['content-type'] = 'application/json';
      const res = await app.fetch(new Request(`${SITE}/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
      for (const c of res.headers.getSetCookie?.() || []) { const m = /^gi_session=([^;]*)/.exec(c); if (m) jar.cookie = m[1] || null; }
      return { status: res.status, data: await res.json().catch(() => null) };
    };
    return { call, get: (p, o) => call('GET', p, undefined, o), post: (p, b, o) => call('POST', p, b ?? {}, o), patch: (p, b, o) => call('PATCH', p, b, o), put: (p, b, o) => call('PUT', p, b, o) };
  };
  w.admin = async (method, path, body) => { const r = await app.fetch(new Request(`${SITE}/api${path}`, { method, headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) })); return { status: r.status, data: await r.json().catch(() => null) }; };
  w.makeOrg = async (name, first, { billing = true } = {}) => {
    const r = await w.admin('POST', '/portal/admin/orgs', { name, adminFirstName: first, adminEmail: `${first.toLowerCase()}@${name.split(' ')[0].toLowerCase()}.example` });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const b = w.browser('198.51.100.7');
    assert.equal((await b.post('/portal/session', { identifier: r.data.credentials.username, password: r.data.credentials.password })).status, 200);
    assert.equal((await b.post('/portal/password', { currentPassword: r.data.credentials.password, newPassword: 'Correct-Horse-Battery-9' })).status, 200);
    if (billing) assert.equal((await b.put('/portal/billing/contact', { name: first, email: `accounts@${name.split(' ')[0].toLowerCase()}.example`, phone: '', legalName: name, abn: '51824753556' })).status, 200);
    return { id: r.data.org.id, admin: b };
  };
  return w;
}

const stores = [['memory', false]];
if (DatabaseSync) stores.push(['D1 (SQLite shim)', true]);

const goodBody = (ref, extra = {}) => ({ builder: ref, name: 'Sarah Jones', email: 'sarah@example.com', phone: '0412 345 678', lotAddress: 'Lot 14, 22 Banksia Rise, Thornton NSW 2322', designName: 'Banksia 25', designId: 'h_1', consent: true, ...extra });

test('migration 0022 is additive and schema.sql has the same columns and table', () => {
  const m = read('../server/migrations/0022_client_access_requests.sql');
  assert.match(m, /ALTER TABLE orgs ADD COLUMN directory_listed INTEGER NOT NULL DEFAULT 0;/);
  assert.match(m, /ALTER TABLE orgs ADD COLUMN directory_region TEXT;/);
  assert.match(m, /CREATE TABLE IF NOT EXISTS client_access_requests/);
  assert.doesNotMatch(m, /DROP|DELETE|UPDATE/i);
  const s = read('../server/schema.sql');
  assert.match(s, /directory_listed INTEGER NOT NULL DEFAULT 0/);
  assert.match(s, /directory_region TEXT/);
  assert.match(s, /CREATE TABLE IF NOT EXISTS client_access_requests/);
  assert.match(s, /idx_car_org/);
});

test('finder helpers: query cleaning, request body, form checks and the visitor text', () => {
  assert.equal(cleanQuery('  a '), '');
  assert.equal(cleanQuery('  Hunter   Homes '), 'Hunter Homes');
  const b = requestBody({ builder: { ref: 'r1' }, name: ' Sarah ', email: 'sarah@example.com', phone: '0412 345 678', lotAddress: 'x', design: { id: 'h', name: 'Banksia' }, consent: true });
  assert.equal(b.builder, 'r1'); assert.equal(b.name, 'Sarah'); assert.equal(b.designName, 'Banksia'); assert.equal(b.consent, true);
  assert.match(formProblem({ ...b, name: '' }), /name/i);
  assert.match(formProblem({ ...b, email: 'nope' }), /email/i);
  assert.match(formProblem({ ...b, phone: '12' }), /phone/i);
  assert.match(formProblem({ ...b, consent: false }), /Tick the box/);
  assert.equal(formProblem(b), '');
  assert.equal(sentText('Sample Homes'), 'Request sent to Sample Homes. They will contact you.');
  assert.equal(FOR_BUILDERS_URL, 'https://glideinside.com.au/for-builders/');
  assert.equal(NOT_LISTED, 'Not listed yet');
});

test('the browser API and the mock expose the same finder calls', () => {
  for (const n of ['searchBuilders', 'requestClientAccess', 'listClientRequests', 'approveClientRequest', 'declineClientRequest']) {
    assert.ok(CALLS.includes(n), n);
    assert.equal(typeof createMockApi({ storage: memoryStorage() })[n], 'function', n);
    assert.equal(typeof createHttpApi({ fetchImpl: async () => new Response('{}') })[n], 'function', n);
  }
});

test('mock api: search lists the opted in builder with name, region and logo only; a request reaches that builder queue; approve issues a login', async () => {
  const api = createMockApi({ storage: memoryStorage() });
  assert.deepEqual((await api.searchBuilders({ q: 'x' })).builders, []);
  const hit = (await api.searchBuilders({ q: 'sample' })).builders;
  assert.equal(hit.length, 1);
  assert.deepEqual(Object.keys(hit[0]).sort(), ['logoUrl', 'name', 'ref', 'region']);
  assert.equal((await api.searchBuilders({ q: 'nobody' })).builders.length, 0);
  await assert.rejects(() => api.requestClientAccess({ ...goodBody(hit[0].ref), consent: false }), /tick the box/i);
  const sent = await api.requestClientAccess(goodBody(hit[0].ref));
  assert.equal(sent.builderName, 'Sample Homes');
  await api.signIn(DEMO_LOGINS.admin);
  const list = await api.listClientRequests({ status: 'pending' });
  assert.equal(list.length, 1);
  const ok = await api.approveClientRequest(list[0].id);
  assert.ok(ok.credentials.username && ok.credentials.password);
  assert.equal((await api.listClientRequests({ status: 'pending' })).length, 0);
});

for (const [label, d1] of stores) {
  test(`server (${label}): only opted in builders are found, and only name, region and logo are shown`, async () => {
    const w = world({ d1 });
    const a = await w.makeOrg('Hunter Homes Pty Ltd', 'Priya');
    const visitor = w.browser();
    assert.deepEqual((await visitor.get('/portal/builders/search?q=hunter', { noCsrf: true })).data.builders, [], 'not listed until the builder opts in');
    assert.equal((await a.admin.patch('/portal/org/settings', { directoryListed: true, directoryRegion: 'Hunter Valley NSW' })).status, 200);
    assert.equal((await a.admin.patch('/portal/org/settings', { directoryListed: 'yes' })).status, 400);
    const r = await visitor.get('/portal/builders/search?q=HUNTER', { noCsrf: true });
    assert.equal(r.status, 200);
    assert.equal(r.data.builders.length, 1);
    assert.deepEqual(Object.keys(r.data.builders[0]).sort(), ['logoUrl', 'name', 'ref', 'region']);
    assert.equal(r.data.builders[0].region, 'Hunter Valley NSW');
    assert.ok(!JSON.stringify(r.data).includes(a.id), 'no organisation id leaks');
    assert.deepEqual((await visitor.get('/portal/builders/search?q=h', { noCsrf: true })).data.builders, [], 'at least two letters');
    assert.deepEqual((await visitor.get('/portal/builders/search?q=zzzz', { noCsrf: true })).data.builders, []);
    const me = await a.admin.get('/portal/me');
    assert.equal(me.data.org.directoryListed, true);
    assert.equal(me.data.org.directoryRegion, 'Hunter Valley NSW');
    assert.equal((await a.admin.patch('/portal/org/settings', { directoryListed: false })).status, 200);
    assert.deepEqual((await visitor.get('/portal/builders/search?q=hunter', { noCsrf: true })).data.builders, [], 'opting out removes the listing');
  });

  test(`server (${label}): a request goes to that builder queue only, with the abuse controls, and nothing is emailed`, async () => {
    const w = world({ d1 });
    const a = await w.makeOrg('Hunter Homes Pty Ltd', 'Priya');
    const b = await w.makeOrg('Coastal Builders Pty Ltd', 'Dan');
    for (const o of [a, b]) await o.admin.patch('/portal/org/settings', { directoryListed: true });
    const v = w.browser();
    const ref = (await v.get('/portal/builders/search?q=hunter', { noCsrf: true })).data.builders[0].ref;
    assert.equal((await v.post('/portal/client-access-request', goodBody(ref), { noCsrf: true })).status, 403, 'the CSRF header is required');
    assert.equal((await v.post('/portal/client-access-request', goodBody(ref, { consent: false }))).status, 400);
    assert.equal((await v.post('/portal/client-access-request', goodBody(ref, { email: 'bad' }))).status, 400);
    assert.equal((await v.post('/portal/client-access-request', goodBody(ref, { phone: '12' }))).status, 400);
    assert.equal((await v.post('/portal/client-access-request', goodBody('nope'))).status, 404);
    const bot = await v.post('/portal/client-access-request', goodBody(ref, { website: 'http://spam.example' }));
    assert.equal(bot.status, 200);
    assert.equal((await a.admin.get('/portal/client-requests')).data.length, 0, 'a honeypot request is not stored');
    const ok = await v.post('/portal/client-access-request', goodBody(ref));
    assert.equal(ok.status, 201);
    assert.equal(ok.data.builderName, 'Hunter Homes Pty Ltd');
    assert.equal((await v.post('/portal/client-access-request', goodBody(ref))).status, 200, 'a repeat is accepted without a duplicate row');
    const mine = await a.admin.get('/portal/client-requests');
    assert.equal(mine.data.length, 1);
    assert.equal(mine.data[0].name, 'Sarah Jones');
    assert.equal(mine.data[0].designName, 'Banksia 25');
    assert.equal(mine.data[0].lotAddress, 'Lot 14, 22 Banksia Rise, Thornton NSW 2322');
    assert.equal((await b.admin.get('/portal/client-requests')).data.length, 0, 'the other builder sees nothing');
    assert.equal((await b.admin.post(`/portal/client-requests/${mine.data[0].id}/approve`)).status, 404, 'and cannot approve it');
    assert.equal((await b.admin.post(`/portal/client-requests/${mine.data[0].id}/decline`, {})).status, 404);
    assert.equal((await v.get('/portal/client-requests')).status, 401, 'a visitor cannot read the queue');
    // rate limit: the sixth request in an hour from one address is refused
    let last = null;
    for (let i = 0; i < 8; i++) last = await v.post('/portal/client-access-request', goodBody(ref, { email: `p${i}@example.com` }));
    assert.equal(last.status, 429);
    assert.deepEqual(w.outbound, [], 'no email or any outbound call');
  });

  test(`server (${label}): approve issues the client login through the normal flow, decline closes it, approval is free of charge`, async () => {
    const w = world({ d1 });
    const a = await w.makeOrg('Hunter Homes Pty Ltd', 'Priya');
    const nb = await w.makeOrg('Nobill Builders Pty Ltd', 'Noel', { billing: false });
    for (const o of [a, nb]) await o.admin.patch('/portal/org/settings', { directoryListed: true });
    const v = w.browser();
    for (const [q, who, mail] of [['hunter', 'Sarah Jones', 'sarah@example.com'], ['hunter', 'Tim Cook', 'tim@example.com'], ['nobill', 'Ann Lee', 'ann@example.com']]) {
      const ref = (await v.get(`/portal/builders/search?q=${q}`, { noCsrf: true })).data.builders[0].ref;
      assert.equal((await v.post('/portal/client-access-request', goodBody(ref, { name: who, email: mail }))).status, 201);
    }
    const [req1, req2] = (await a.admin.get('/portal/client-requests?status=pending')).data.slice().sort((x, y) => x.name.localeCompare(y.name));
    // client logins are free (18/11/2026), so a builder with no billing details can approve too, and nothing is charged
    const nbReq = (await nb.admin.get('/portal/client-requests')).data[0];
    const free = await nb.admin.post(`/portal/client-requests/${nbReq.id}/approve`);
    assert.equal(free.status, 201, JSON.stringify(free.data));
    assert.deepEqual(free.data.charge, { amountCents: 0, trigger: 'none', note: 'No charge for client logins.' });
    assert.equal((await nb.admin.get('/portal/client-requests?status=pending')).data.length, 0);
    // approve
    const ap = await a.admin.post(`/portal/client-requests/${req1.id}/approve`);
    assert.equal(ap.status, 201, JSON.stringify(ap.data));
    assert.ok(ap.data.credentials.username && ap.data.credentials.password);
    assert.equal(ap.data.client.email, 'sarah@example.com');
    assert.equal(ap.data.client.lotAddress, 'Lot 14, 22 Banksia Rise, Thornton NSW 2322');
    assert.equal(ap.data.request.status, 'approved');
    assert.equal((await a.admin.post(`/portal/client-requests/${req1.id}/approve`)).status, 409, 'cannot approve twice');
    const clients = (await a.admin.get('/portal/clients')).data;
    assert.ok(clients.some((c) => c.email === 'sarah@example.com'));
    // the issued login works
    const c = w.browser('192.0.2.9');
    assert.equal((await c.post('/portal/session', { identifier: ap.data.credentials.username, password: ap.data.credentials.password })).status, 200);
    // decline
    const dec = await a.admin.post(`/portal/client-requests/${req2.id}/decline`, { note: 'Outside our area' });
    assert.equal(dec.status, 200);
    assert.equal(dec.data.status, 'declined');
    assert.equal((await a.admin.get('/portal/client-requests?status=pending')).data.length, 0);
    assert.equal((await a.admin.get('/portal/client-requests?status=declined')).data.length, 1);
    assert.equal((await a.admin.post(`/portal/client-requests/${req2.id}/approve`)).status, 409);
    // a client login cannot read or decide requests
    assert.equal((await c.get('/portal/client-requests')).status, 403);
    // the owner sees every request with the builder name
    const adm = await w.admin('GET', '/portal/admin/client-requests');
    assert.equal(adm.status, 200);
    assert.equal(adm.data.length, 3);
    assert.ok(adm.data.some((q) => q.builderName === 'Hunter Homes Pty Ltd' && q.status === 'approved'));
    assert.equal((await w.admin('GET', '/portal/admin/orgs')).data.find((o) => o.name === 'Hunter Homes Pty Ltd').pendingClientRequests, 0);
    assert.deepEqual(w.outbound, []);
  });
}
