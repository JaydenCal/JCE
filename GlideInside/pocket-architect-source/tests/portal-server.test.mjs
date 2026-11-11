// Builder and client portal back end (server/lib/portal*.js): auth, sessions, CSRF, roles, every route group, billing in
// Australia/Sydney months and Stripe invoicing with a mocked fetch. Each flow runs on the in-memory store and on D1 (SQLite shim).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../server/lib/app.js';
import { createMemoryStore, createD1Store } from '../server/lib/store.js';
import { createMemoryPortalStore, createD1PortalStore } from '../server/lib/portal-store.js';
import { hashPassword, verifyPassword, sha256Hex, PBKDF2_ITERATIONS, secretEqual } from '../server/lib/password.js';
import { verifyToken, authenticate, issueOrgToken } from '../server/lib/entitlement.js';
import { isMonthlyRunTime, buildSnapshot, priceForNthLoginThisMonth } from '../server/lib/portal-billing.js';
import { abnValid } from '../server/lib/portal.js';
import { topUpExpiry } from '../server/lib/portal-ai.js';
import { createHttpApi } from '../src/portal/api.js';
import { createMockApi, memoryStorage, DEMO_LOGINS } from '../src/portal/mock-api.js';
import { GLIDE_LIBRARY } from '../src/portal/glide-library.generated.js';
import { createFromTemplate } from '../src/catalogue/templates.js';
import { monthKey } from '../src/portal/billing.js';

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  /* D1 shim tests are skipped without node:sqlite */
}

const SITE = 'https://site.test';
const ADMIN_TOKEN = 'admin-token-for-tests-0123456789';
const T0 = Date.UTC(2026, 10, 11, 1, 0, 0); // 11/11/2026 12:00 Sydney
const MIN = 60000;
const DAY = 86400000;
const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]).toString('base64')}`;

function makeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  const norm = (a) => a.map((v) => (v === undefined ? null : v));
  const statement = (sql, args = []) => ({
    bind: (...a) => statement(sql, norm(a)),
    run: async () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
  });
  return { prepare: (sql) => statement(sql), _db: db };
}

const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function makeWorld({ d1 = false, env = {} } = {}) {
  const clock = { t: T0 };
  const db = d1 ? makeD1() : null;
  const store = d1 ? createD1Store(db) : createMemoryStore();
  const pstore = d1 ? createD1PortalStore(db) : createMemoryPortalStore();
  const stripe = { calls: [], items: [], fail: null, invoices: 0 };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.origin !== 'https://api.stripe.com') throw new Error(`unexpected fetch ${url}`);
    const path = u.pathname.replace('/v1', '');
    const method = init.method || 'GET';
    const form = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : {};
    stripe.calls.push({ method, path, form, headers: init.headers, query: u.search });
    if (stripe.fail?.(method, path)) return jsonRes({ error: { message: 'boom' } }, 500);
    if (method === 'POST' && path === '/customers') return jsonRes({ id: 'cus_test_1' });
    if (method === 'POST' && path === '/tax_rates') return jsonRes({ id: 'txr_test_1' });
    if (method === 'POST' && path === '/invoices') return jsonRes({ id: `in_test_${++stripe.invoices}` });
    if (method === 'POST' && path === '/invoiceitems') {
      stripe.items.push({ invoice: form.invoice, metadata: { line: form['metadata[line]'] } });
      return jsonRes({ id: `ii_${stripe.items.length}` });
    }
    if (method === 'GET' && path === '/invoiceitems') return jsonRes({ data: stripe.items.filter((i) => i.invoice === u.searchParams.get('invoice')) });
    if (method === 'POST' && /\/finalize$/.test(path)) return jsonRes({ id: path.split('/')[2], hosted_invoice_url: 'https://invoice.stripe.com/i/test' });
    if (method === 'POST' && /\/send$/.test(path)) return jsonRes({ id: path.split('/')[2], hosted_invoice_url: 'https://invoice.stripe.com/i/test' });
    return jsonRes({ error: { message: 'unhandled' } }, 404);
  };
  const app = createApp({
    store, portalStore: pstore, fetchImpl, now: () => clock.t,
    env: { SITE_URL: SITE, ENTITLEMENT_SECRET: 'unit-test-secret', PORTAL_ENABLED: '1', ADMIN_TOKEN, STRIPE_SECRET_KEY: 'sk_test_abc', ...env },
  });
  const world = { clock, store, pstore, app, stripe, db };

  /** A browser: keeps the gi_session cookie like a cookie jar and sends the headers the real front end sends. */
  world.browser = () => {
    const jar = { cookie: null, raw: [] };
    const call = async (method, path, body, { headers = {}, noCsrf = false, origin = SITE } = {}) => {
      const h = { ...headers };
      if (jar.cookie) h.cookie = `gi_session=${jar.cookie}`;
      if (!noCsrf) h['x-gi-request'] = '1';
      if (origin) h.origin = origin;
      if (body !== undefined) h['content-type'] = 'application/json';
      const res = await app.fetch(new Request(`${SITE}/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
      for (const c of res.headers.getSetCookie?.() || []) {
        jar.raw.push(c);
        const m = /^gi_session=([^;]*)/.exec(c);
        if (m) jar.cookie = m[1] || null;
      }
      const data = await res.json().catch(() => null);
      return { status: res.status, data, headers: res.headers };
    };
    return { jar, call, get: (p, o) => call('GET', p, undefined, o), post: (p, b, o) => call('POST', p, b ?? {}, o), put: (p, b, o) => call('PUT', p, b, o), patch: (p, b, o) => call('PATCH', p, b, o), del: (p, o) => call('DELETE', p, undefined, o) };
  };
  world.admin = (method, path, body, token = ADMIN_TOKEN) =>
    app.fetch(new Request(`${SITE}/api${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));

  /** Creates an org through the admin endpoint and signs the admin in, past the forced password change. */
  world.makeOrg = async (name = 'Sample Homes Pty Ltd', adminFirst = 'Priya', extra = {}) => {
    const r = await world.admin('POST', '/portal/admin/orgs', { name, adminFirstName: adminFirst, adminEmail: `${adminFirst.toLowerCase()}@${name.split(' ')[0].toLowerCase()}.example`, ...extra });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const b = world.browser();
    const me = await b.post('/portal/session', { identifier: r.data.credentials.username, password: r.data.credentials.password });
    assert.equal(me.status, 200, JSON.stringify(me.data));
    const ch = await b.post('/portal/password', { currentPassword: r.data.credentials.password, newPassword: 'Correct-Horse-Battery-9' });
    assert.equal(ch.status, 200, JSON.stringify(ch.data));
    const out = { orgId: r.data.org.id, admin: b, adminUser: r.data.admin, adminPassword: 'Correct-Horse-Battery-9', shortCode: r.data.org.shortCode };
    out.relogin = async () => {
      out.admin = world.browser();
      assert.equal((await out.admin.post('/portal/session', { identifier: out.adminUser.username, password: out.adminPassword })).status, 200);
      return out.admin;
    };
    return out;
  };
  /** Admin issues a client; the client signs in and sets a password. Returns the client's browser. */
  world.makeClient = async (org, firstName = 'Sarah', body = {}, { signIn = true } = {}) => {
    const r = await org.admin.post('/portal/clients', { firstName, ...body });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const b = world.browser();
    if (signIn) {
      const s = await b.post('/portal/session', { identifier: r.data.credentials.username, password: r.data.credentials.password });
      assert.equal(s.status, 200, JSON.stringify(s.data));
      const c = await b.post('/portal/password', { currentPassword: r.data.credentials.password, newPassword: 'Another-Long-Pass-77' });
      assert.equal(c.status, 200, JSON.stringify(c.data));
    }
    const relogin = async () => {
      const nb = world.browser();
      const x = await nb.post('/portal/session', { identifier: r.data.credentials.username, password: 'Another-Long-Pass-77' });
      assert.equal(x.status, 200, JSON.stringify(x.data));
      out.browser = nb;
      return nb;
    };
    const out = { browser: b, client: r.data.client, credentials: r.data.credentials, relogin };
    return out;
  };
  world.makeDesigner = async (org, firstName = 'Tom') => {
    const r = await org.admin.post('/portal/team', { firstName, role: 'designer', email: `${firstName.toLowerCase()}@x.example` });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const b = world.browser();
    await b.post('/portal/session', { identifier: r.data.credentials.username, password: r.data.credentials.password });
    await b.post('/portal/password', { currentPassword: r.data.credentials.password, newPassword: 'Designer-Pass-Phrase-55' });
    return { browser: b, user: r.data.user, credentials: r.data.credentials };
  };
  return world;
}

const stores = [['memory', false]];
if (DatabaseSync) stores.push(['D1 (SQLite shim)', true]);

// Pure helpers -----------------------------------------------------------------------------------------------------------------
test('PBKDF2: stored format, 100,000 iterations, per-user 16 byte salt, verify and rehash flag', async () => {
  assert.equal(PBKDF2_ITERATIONS, 100000, 'the Workers maximum');
  const a = await hashPassword('river-maple-47');
  const b = await hashPassword('river-maple-47');
  const [scheme, iters, salt, hash] = a.split('$');
  assert.equal(scheme, 'pbkdf2-sha256');
  assert.equal(iters, '100000');
  assert.equal(Buffer.from(salt, 'base64').length, 16);
  assert.equal(Buffer.from(hash, 'base64').length, 32);
  assert.notEqual(a, b, 'a new random salt every time');
  assert.deepEqual(await verifyPassword('river-maple-47', a), { ok: true, needsRehash: false });
  assert.equal((await verifyPassword('river-maple-48', a)).ok, false);
  const old = await hashPassword('river-maple-47', { iterations: 1000 });
  assert.deepEqual(await verifyPassword('river-maple-47', old), { ok: true, needsRehash: true }, 'old hashes are upgraded at next sign in');
  for (const bad of ['', 'plain', 'pbkdf2-sha256$x$y$z', 'pbkdf2-sha256$100000$!!$!!', null, undefined]) assert.equal((await verifyPassword('x', bad)).ok, false);
  assert.equal(await secretEqual('abc', 'abc'), true);
  assert.equal(await secretEqual('abc', 'abd'), false);
  assert.equal(await secretEqual('abc', 'abcd'), false);
});

test('ABN checksum', () => {
  assert.equal(abnValid('29 699 165 663'), true, 'the seller ABN');
  assert.equal(abnValid('51 824 753 556'), true);
  assert.equal(abnValid('51 824 753 557'), false);
  assert.equal(abnValid('123'), false);
});

test('month end runs at 06:00 on the 1st, Sydney time, in both daylight saving and standard time', () => {
  assert.equal(isMonthlyRunTime(Date.UTC(2026, 9, 31, 19, 0)), true, '06:00 AEDT on 01/11/2026 (UTC+11)');
  assert.equal(isMonthlyRunTime(Date.UTC(2026, 9, 31, 20, 0)), false, '07:00 AEDT');
  assert.equal(isMonthlyRunTime(Date.UTC(2026, 5, 30, 20, 0)), true, '06:00 AEST on 01/07/2026 (UTC+10)');
  assert.equal(isMonthlyRunTime(Date.UTC(2026, 5, 30, 19, 0)), false, '05:00 AEST');
  assert.equal(isMonthlyRunTime(Date.UTC(2026, 10, 11, 20, 0)), false, 'not the 1st');
});

test('top-ups expire 12 months after purchase', () => {
  assert.equal(topUpExpiry('2026-03-15T00:00:00.000Z'), '2027-03-15T00:00:00.000Z');
});

test('issueOrgToken output is accepted by the AI branch contract: { oid, lid, role, cap, exp }', async () => {
  const cfg = { entitlementSecret: 's3cret' };
  const token = await issueOrgToken({ orgId: 'org_1', loginId: 'u_1', role: 'client', cap: 300 }, cfg, T0);
  const p = await verifyToken(token, 's3cret', Math.floor(T0 / 1000));
  assert.equal(p.oid, 'org_1', 'verifyToken accepts a signed org token; authenticate() refuses it for Plan Pack routes');
  await assert.rejects(authenticate(new Request('https://x/api/credits', { headers: { authorization: `Bearer ${token}` } }), { store: {}, config: cfg, now: () => T0 }), /Plan Pack/);
  const [body] = token.split('.');
  const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  assert.deepEqual(Object.keys(payload).sort(), ['cap', 'exp', 'lid', 'oid', 'role']);
});

test('the browser API (src/portal/api.js) and the mock agree on the shape of me()', async () => {
  const w = makeWorld();
  const org = await w.makeOrg();
  const real = (await org.admin.get('/portal/me')).data;
  const mock = createMockApi({ storage: memoryStorage(), now: () => T0 });
  await mock.signIn(DEMO_LOGINS.admin);
  const m = await mock.me();
  assert.deepEqual(Object.keys(real).sort(), Object.keys(m).sort());
  assert.deepEqual(Object.keys(real.user).sort(), Object.keys(m.user).sort());
  assert.deepEqual(Object.keys(real.ai).sort(), Object.keys(m.ai).sort().concat(['monthResetsOn']).sort());
  assert.deepEqual(real.permissions.slice().sort(), m.permissions.concat(['team.read']).sort());
});

// Per store flows ---------------------------------------------------------------------------------------------------------------
for (const [label, d1] of stores) {
  const t = (name, fn) => test(`${label}: ${name}`, () => fn());

  t('admin token jobs: creating an organisation needs ADMIN_TOKEN, and nothing else answers without PORTAL_ENABLED', async () => {
    const w = makeWorld({ d1 });
    assert.equal((await w.admin('POST', '/portal/admin/orgs', { name: 'X', adminFirstName: 'A' }, 'wrong')).status, 401);
    assert.equal((await new Response(null) && (await w.app.fetch(new Request(`${SITE}/api/portal/admin/orgs`, { method: 'POST', body: '{}' })))).status, 401);
    const ok = await w.admin('POST', '/portal/admin/orgs', { name: 'Sample Homes Pty Ltd', adminFirstName: 'Priya', adminEmail: 'priya@sample.example' });
    assert.equal(ok.status, 201);
    assert.match(ok.data.credentials.username, /^priya-[2-9]{4}$/);
    assert.match(ok.data.credentials.password, /^[a-z]+-[a-z]+-[2-9]{2}$/);
    assert.equal(ok.data.org.shortCode, 'SAM');
    const again = await w.admin('POST', '/portal/admin/orgs', { name: 'Sample Other', adminFirstName: 'Q' });
    assert.equal(again.data.org.shortCode, 'SAM2', 'short codes are unique');
    // Without a configured token the endpoint is closed.
    const w2 = makeWorld({ d1, env: { ADMIN_TOKEN: '' } });
    assert.equal((await w2.admin('POST', '/portal/admin/orgs', { name: 'X', adminFirstName: 'A' })).status, 503);
    // Logins stay closed until PORTAL_ENABLED=1.
    const w3 = makeWorld({ d1, env: { PORTAL_ENABLED: '' } });
    const b = w3.browser();
    const r = await b.post('/portal/session', { identifier: 'a', password: 'b' });
    assert.equal(r.status, 503);
    assert.equal(r.data.error.code, 'PORTAL_NOT_CONFIGURED');
    assert.equal((await w3.admin('POST', '/portal/admin/orgs', { name: 'Y', adminFirstName: 'B' })).status, 201, 'setup is still possible');
  });

  t('sign in: cookie flags, forced change, password rules, other sessions revoked, sign out', async () => {
    const w = makeWorld({ d1 });
    const org = await w.admin('POST', '/portal/admin/orgs', { name: 'Sample Homes', adminFirstName: 'Priya', adminEmail: 'priya@sample.example' });
    const { username, password } = org.data.credentials;
    const b = w.browser();
    const r = await b.post('/portal/session', { identifier: username.toUpperCase(), password });
    assert.equal(r.status, 200);
    const cookie = b.jar.raw[0];
    for (const part of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/api', `Max-Age=${30 * 86400}`]) assert.ok(cookie.includes(part), `${part} in ${cookie}`);
    assert.equal(r.data.user.mustChangePassword, true);
    assert.equal(r.data.user.role, 'admin');
    assert.ok(!JSON.stringify(r.data).includes('passwordHash') && !JSON.stringify(r.data).includes(password));
    // The cookie holds the token; only its SHA-256 is stored.
    const token = b.jar.cookie;
    assert.ok(token.length >= 43, '32 random bytes, base64url');
    const stored = w.pstore._tables ? [...w.pstore._tables.sessions.keys()] : [(await w.pstore.getSession(await sha256Hex(token))).idHash];
    assert.deepEqual(stored, [await sha256Hex(token)]);
    // Forced change: everything but me, password and sign out is refused.
    assert.equal((await b.get('/portal/houses')).data.error.code, 'PASSWORD_CHANGE_REQUIRED');
    assert.equal((await b.get('/portal/me')).status, 200);
    for (const [pw, why] of [['short', /at least 10/], ['password123', /too common/], [`${username}-secret`, /username/], [password, /new password|too common|temporary/]]) {
      const bad = await b.post('/portal/password', { currentPassword: password, newPassword: pw });
      assert.equal(bad.status, 400, pw);
      assert.match(bad.data.error.message, why);
    }
    assert.equal((await b.post('/portal/password', { currentPassword: 'wrong-wrong', newPassword: 'Fresh-Long-Pass-12' })).data.error.code, 'INVALID_CREDENTIALS');
    // A second browser signs in with the temporary password too, so it has a session to be signed out.
    const other = w.browser();
    await other.post('/portal/session', { identifier: username, password });
    assert.equal((await b.post('/portal/password', { currentPassword: password, newPassword: 'Fresh-Long-Pass-12' })).status, 200);
    assert.equal((await b.get('/portal/houses')).status, 200, 'this session continues');
    assert.equal((await other.get('/portal/me')).status, 401, 'the other session was signed out');
    assert.equal((await w.browser().post('/portal/session', { identifier: username, password })).data.error.code, 'INVALID_CREDENTIALS', 'the temporary password no longer works');
    // Sign out deletes the session; the old cookie is dead.
    const saved = b.jar.cookie;
    assert.equal((await b.del('/portal/session')).status, 200);
    assert.match(b.jar.raw.at(-1), /Max-Age=0/);
    const replay = w.browser();
    replay.jar.cookie = saved;
    assert.equal((await replay.get('/portal/me')).status, 401);
  });

  t('errors are generic: unknown user and wrong password answer the same', async () => {
    const w = makeWorld({ d1 });
    const org = await w.makeOrg();
    const a = await w.browser().post('/portal/session', { identifier: org.adminUser.username, password: 'not-the-password-1' });
    const b = await w.browser().post('/portal/session', { identifier: 'nobody-2222', password: 'not-the-password-1' });
    assert.equal(a.status, 401);
    assert.deepEqual(a.data, b.data);
    assert.equal(a.data.error.code, 'INVALID_CREDENTIALS');
    assert.equal((await w.browser().post('/portal/session', { identifier: '', password: 'x' })).status, 400);
    assert.equal((await w.browser().post('/portal/session', { identifier: org.adminUser.username })).status, 401);
    // Password reset is not enumerable either.
    const r1 = await w.browser().post('/portal/password/reset-request', { email: 'priya@sample.example' });
    const r2 = await w.browser().post('/portal/password/reset-request', { email: 'nobody@nowhere.example' });
    assert.deepEqual(r1.data, { ok: true });
    assert.deepEqual(r2.data, r1.data);
  });

  t('lockout: 5 failures per username for 15 minutes (even for unknown names), correct password does not unlock, success clears the count', async () => {
    const w = makeWorld({ d1 });
    const org = await w.makeOrg();
    const id = org.adminUser.username;
    const attempt = (pw, who = id) => w.browser().post('/portal/session', { identifier: who, password: pw });
    for (let i = 0; i < 4; i += 1) assert.equal((await attempt('bad-password-1')).data.error.code, 'INVALID_CREDENTIALS');
    assert.equal((await attempt(org.adminPassword)).status, 200, 'a success before the 5th failure clears the counter');
    for (let i = 0; i < 4; i += 1) await attempt('bad-password-1');
    const fifth = await attempt('bad-password-1');
    assert.equal(fifth.status, 423);
    assert.equal(fifth.data.error.code, 'ACCOUNT_LOCKED');
    assert.equal(fifth.data.error.retryAfter, 900);
    const locked = await attempt(org.adminPassword);
    assert.equal(locked.data.error.code, 'ACCOUNT_LOCKED', 'the right password is refused while locked');
    w.clock.t += 14 * MIN;
    assert.equal((await attempt(org.adminPassword)).status, 423);
    w.clock.t += 2 * MIN;
    assert.equal((await attempt(org.adminPassword)).status, 200, 'unlocked after 15 minutes');
    // An unknown username locks in exactly the same way, so locking reveals nothing.
    for (let i = 0; i < 4; i += 1) assert.equal((await attempt('x-y-z-123', 'ghost-2345')).data.error.code, 'INVALID_CREDENTIALS');
    assert.equal((await attempt('x-y-z-123', 'ghost-2345')).data.error.code, 'ACCOUNT_LOCKED');
  });

  t('lockout per IP address: 20 failures across usernames', async () => {
    const w = makeWorld({ d1 });
    const attempt = async (n) => {
      const res = await w.app.fetch(new Request(`${SITE}/api/portal/session`, { method: 'POST', headers: { 'x-gi-request': '1', origin: SITE, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify({ identifier: `user${n}-2222`, password: 'wrong-pass-1' }) }));
      return { status: res.status, data: await res.json() };
    };
    for (let i = 0; i < 19; i += 1) assert.equal((await attempt(i)).status, 401);
    assert.equal((await attempt(19)).status, 401, 'the 20th failure triggers the lock');
    const blocked = await attempt(99);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.data.error.code, 'RATE_LIMITED');
  });

  t('temporary passwords expire after 7 days unused; a reset issues a new one', async () => {
    const w = makeWorld({ d1 });
    const org = await w.makeOrg();
    const issued = await org.admin.post('/portal/clients', { firstName: 'Mei' });
    const { username, password } = issued.data.credentials;
    w.clock.t += 7 * DAY + MIN;
    const r = await w.browser().post('/portal/session', { identifier: username, password });
    assert.equal(r.status, 401);
    assert.equal(r.data.error.code, 'PASSWORD_EXPIRED');
    const reset = await org.admin.post(`/portal/clients/${issued.data.client.id}/reset-password`);
    assert.equal(reset.status, 200);
    assert.equal(reset.data.credentials.username, username);
    assert.notEqual(reset.data.credentials.password, password);
    assert.equal((await w.browser().post('/portal/session', { identifier: username, password: reset.data.credentials.password })).status, 200);
    assert.equal((await w.browser().post('/portal/session', { identifier: username, password })).status, 401, 'the old temporary password is dead');
  });

  t('sessions: sliding 30 day expiry, idle expiry, 90 day absolute cap', async () => {
    const w = makeWorld({ d1 });
    const org = await w.makeOrg();
    const b = org.admin;
    w.clock.t += 20 * DAY;
    assert.equal((await b.get('/portal/me')).status, 200, 'still inside 30 days');
    assert.match(b.jar.raw.at(-1), /Max-Age=2592000/, 'the cookie is refreshed when the session slides');
    w.clock.t += 20 * DAY;
    assert.equal((await b.get('/portal/me')).status, 200, '40 days after sign in, 20 after last use: the expiry slid');
    w.clock.t += 31 * DAY;
    assert.equal((await b.get('/portal/me')).status, 401, 'idle for 31 days');
    // Absolute cap: used every 20 days it still ends at 90 days.
    const c = w.browser();
    await c.post('/portal/session', { identifier: org.adminUser.username, password: org.adminPassword });
    for (let i = 0; i < 4; i += 1) {
      w.clock.t += 20 * DAY;
      assert.equal((await c.get('/portal/me')).status, 200, `day ${(i + 1) * 20}`);
    }
    w.clock.t += 20 * DAY;
    assert.equal((await c.get('/portal/me')).status, 401, 'day 100 is past the 90 day cap');
  });

  t('CSRF: state changing calls need X-GI-Request and a matching Origin; reads do not', async () => {
    const w = makeWorld({ d1 });
    const org = await w.makeOrg();
    const b = org.admin;
    assert.equal((await b.post('/portal/houses', { fromGlideId: GLIDE_LIBRARY[0].id }, { noCsrf: true })).status, 403, 'no custom header');
    assert.equal((await b.post('/portal/houses', { fromGlideId: GLIDE_LIBRARY[0].id }, { origin: 'https://evil.example' })).status, 403, 'wrong Origin');
    assert.equal((await b.post('/portal/houses', { fromGlideId: GLIDE_LIBRARY[0].id }, { origin: null, headers: { 'sec-fetch-site': 'cross-site' } })).status, 403, 'no Origin but a cross-site fetch');
    assert.equal((await b.del('/portal/session', { noCsrf: true })).status, 403, 'sign out is protected too');
    assert.equal((await w.browser().post('/portal/session', { identifier: 'a', password: 'b' }, { noCsrf: true })).status, 403, 'sign in is protected (login CSRF)');
    assert.equal((await b.get('/portal/houses', { noCsrf: true, origin: 'https://evil.example' })).status, 200, 'safe methods are not blocked (and CORS stops the response being read)');
    assert.equal((await b.post('/portal/houses', { fromGlideId: GLIDE_LIBRARY[0].id })).status, 200 + 0 === 200 ? (await b.get('/portal/houses')).status && 200 : 200);
  });

  t('CORS: credentials only for the configured site origin', async () => {
    const w = makeWorld({ d1 });
    const ok = await w.app.fetch(new Request(`${SITE}/api/portal/me`, { method: 'OPTIONS', headers: { origin: SITE } }));
    assert.equal(ok.headers.get('access-control-allow-credentials'), 'true');
    assert.match(ok.headers.get('access-control-allow-headers'), /x-gi-request/);
    assert.match(ok.headers.get('access-control-allow-methods'), /PATCH/);
    const bad = await w.app.fetch(new Request(`${SITE}/api/portal/me`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
    assert.equal(bad.headers.get('access-control-allow-credentials'), null);
  });

  t('role permissions: designers cannot issue logins or see billing, team, branding or settings; clients see none of it', async () => {
    const w = makeWorld({ d1 });
    const org = await w.makeOrg();
    const des = await w.makeDesigner(org);
    const cl = await w.makeClient(org);
    const d = des.browser;
    assert.equal((await d.get('/portal/clients')).status, 200, 'designers read clients');
    assert.equal((await d.post('/portal/clients', { firstName: 'Zed' })).status, 403);
    assert.equal((await d.get('/portal/billing/usage')).status, 403);
    assert.equal((await d.get('/portal/billing/invoices')).status, 403);
    assert.equal((await d.get('/portal/billing/contact')).status, 403);
    assert.equal((await d.get('/portal/team')).status, 403);
    assert.equal((await d.post('/portal/team', { firstName: 'Zed', role: 'admin' })).status, 403);
    assert.equal((await d.put('/portal/org/branding', { displayName: 'X' })).status, 403);
    assert.equal((await d.patch('/portal/org/settings', { allowClientTopUps: false })).status, 403);
    assert.equal((await d.post(`/portal/clients/${cl.client.id}/reset-password`)).status, 403);
    assert.equal((await d.del(`/portal/clients/${cl.client.id}`)).status, 403);
    assert.equal((await d.post('/portal/houses', { fromGlideId: GLIDE_LIBRARY[0].id })).status, 200, 'designers write houses');
    const me = (await d.get('/portal/me')).data;
    assert.equal(me.org.billingContact, undefined, 'billing contact is not sent to designers');
    assert.deepEqual(me.permissions, ['houses.write', 'clients.read', 'projects.read']);
    const c = cl.browser;
    for (const [m, p] of [['get', '/portal/clients'], ['get', '/portal/team'], ['get', '/portal/billing/usage'], ['get', '/portal/billing/contact']]) assert.equal((await c[m](p)).status, 403, p);
    assert.equal((await c.post('/portal/houses', { fromGlideId: GLIDE_LIBRARY[0].id })).status, 403);
    assert.equal((await c.post('/portal/admin/orgs', { name: 'x', adminFirstName: 'y' })).status, 401, 'the admin endpoint takes a bearer token only');
    const cme = (await c.get('/portal/me')).data;
    assert.deepEqual(cme.permissions, []);
    assert.equal(cme.exports.join(), 'pdf');
    assert.equal(cme.org.billingContact, undefined);
    assert.equal((await w.browser().get('/portal/houses')).status, 401, 'signed out');
  });

  t('clients: generate, list (no secrets), update, reset, disable, enable, delete, export', async () => {
    const w = makeWorld({ d1 });
    const org = await w.makeOrg();
    const issued = await org.admin.post('/portal/clients', { firstName: 'Sarah-Jane', email: 'Sarah.T@Example.com', lotAddress: 'Lot 14 Banksia Rise', houseAccess: 'all' });
    assert.equal(issued.status, 201);
    assert.match(issued.data.credentials.username, /^sarah-[2-9]{4}$/);
    assert.match(issued.data.credentials.password, /^[a-z]+-[a-z]+-[2-9]{2}$/);
    assert.deepEqual(issued.data.charge, { amountCents: 3000, trigger: 'first_sign_in', note: 'A$30 incl. GST is charged on your monthly invoice once your client first signs in.' });
    assert.equal(issued.data.client.billed, false);
    assert.equal(issued.data.client.mustChangePassword, true);
    assert.ok(issued.data.client.tempPasswordExpiresAt);
    const id = issued.data.client.id;
    const list = (await org.admin.get('/portal/clients')).data;
    assert.equal(list.length, 1);
    assert.equal(list[0].email, 'sarah.t@example.com');
    assert.equal(list[0].ai.monthlyCap, 300);
    const text = JSON.stringify(list);
    assert.ok(!text.includes(issued.data.credentials.password) && !/passwordHash|pbkdf2/.test(text), 'a password is shown once and never again');
    assert.equal((await org.admin.post('/portal/clients', { firstName: 'Other', email: 'sarah.t@example.com' })).status, 409, 'email already has a login');
    assert.equal((await org.admin.post('/portal/clients', { firstName: '' })).status, 400);
    assert.equal((await org.admin.post('/portal/clients', { firstName: 'X', email: 'not-an-email' })).status, 400);
    assert.equal((await org.admin.patch(`/portal/clients/${id}`, { firstName: 'Sarah', lotAddress: 'Lot 15', email: '' })).data.lotAddress, 'Lot 15');
    // Reset gives a new temporary password and signs the client out.
    const cl = w.browser();
    await cl.post('/portal/session', { identifier: issued.data.credentials.username, password: issued.data.credentials.password });
    const reset = await org.admin.post(`/portal/clients/${id}/reset-password`);
    assert.equal(reset.status, 200);
    assert.equal((await cl.get('/portal/me')).status, 401, 'reset ends the client\'s sessions');
    // Disable ends sessions at once and blocks sign in; enable restores it.
    const cl2 = w.browser();
    await cl2.post('/portal/session', { identifier: issued.data.credentials.username, password: reset.data.credentials.password });
    assert.equal((await org.admin.post(`/portal/clients/${id}/disable`)).data.status, 'disabled');
    assert.equal((await cl2.get('/portal/me')).status, 401);
    const blocked = await w.browser().post('/portal/session', { identifier: issued.data.credentials.username, password: reset.data.credentials.password });
    assert.equal(blocked.data.error.code, 'ACCOUNT_DISABLED');
    assert.equal((await org.admin.post(`/portal/clients/${id}/enable`)).data.status, 'active');
    assert.equal((await w.browser().post('/portal/session', { identifier: issued.data.credentials.username, password: reset.data.credentials.password })).status, 200);
    // Another organisation cannot touch this client.
    const other = await w.makeOrg('Other Builders', 'Olga');
    for (const [m, p] of [['patch', `/portal/clients/${id}`], ['post', `/portal/clients/${id}/reset-password`], ['post', `/portal/clients/${id}/disable`], ['del', `/portal/clients/${id}`], ['get', `/portal/clients/${id}/export`]]) {
      assert.equal((await other.admin[m](p, m === 'patch' ? {} : undefined)).status, 404, `${m} ${p}`);
    }
    assert.equal((await other.admin.get('/portal/clients')).data.length, 0);
  });

  t('delete client: removes projects, a billed login keeps its charge, an unused login is free', async () => {
    const w = makeWorld({ d1 });
    const org = await w.makeOrg();
    const used = await w.makeClient(org, 'Used');
    const proj = createFromTemplate('house_single');
    assert.equal((await used.browser.post('/portal/projects', { name: 'Used lot', project: proj })).status, 200);
    const unused = await w.makeClient(org, 'Idle', {}, { signIn: false });
    const exp = (await org.admin.get(`/portal/clients/${used.client.id}/export`)).data;
    assert.equal(exp.projects.length, 1);
    assert.equal(exp.client.username, used.client.username);
    assert.ok(exp.projects[0].project.levels);
    const d1r = await org.admin.del(`/portal/clients/${used.client.id}`);
    assert.deepEqual(d1r.data, { ok: true, removedProjects: 1, charged: true });
    const d2r = await org.admin.del(`/portal/clients/${unused.client.id}`);
    assert.deepEqual(d2r.data, { ok: true, removedProjects: 0, charged: false });
    assert.equal((await org.admin.get('/portal/projects')).data.length, 0);
    const usage = (await org.admin.get('/portal/billing/usage')).data;
    assert.equal(usage.totals.loginsCount, 1, 'the billed login stays on the month; the unused one never appears');
    assert.equal((await org.admin.del(`/portal/clients/${used.client.id}`)).status, 404);
  });

  t('houses and the Glide library: library, saved designs, access filtering, archive, duplicate, tenant isolation', async () => {
    const w = makeWorld({ d1 });
    const org = await w.makeOrg();
    const glide = (await org.admin.get('/portal/glide-library')).data;
    assert.equal(glide.length, GLIDE_LIBRARY.length);
    assert.ok(!glide.some((g) => g.project), 'no project JSON in the list');
    const model = (await org.admin.get(`/portal/glide-library/${encodeURIComponent(glide[0].id)}`)).data;
    assert.ok(model.project.levels.length >= 1, 'built from the src/catalogue/tpl templates');
    assert.equal((await org.admin.get('/portal/glide-library/glide:nope')).status, 404);
    const a = await org.admin.post('/portal/houses', { fromGlideId: 'glide:house_single', name: 'Banksia 25' });
    assert.equal(a.status, 200);
    assert.equal(a.data.source.type, 'glide');
    assert.equal(a.data.stats.bedrooms, a.data.bedrooms);
    assert.ok(a.data.thumbnail.startsWith('<svg'));
    const opened = (await org.admin.get(`/portal/houses/${a.data.id}`)).data;
    assert.equal(opened.project.name, 'Banksia 25');
    const saved = await org.admin.post('/portal/houses', { name: 'My own', project: createFromTemplate('granny_flat') });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.source.type, 'saved');
    assert.equal(saved.data.hasProject, true);
    assert.equal((await org.admin.post('/portal/houses', { name: 'my own', project: createFromTemplate('granny_flat') })).status, 409, 'names are unique within the org');
    assert.equal((await org.admin.post('/portal/houses', { name: 'Junk', project: { nonsense: true } })).status, 400);
    assert.equal((await org.admin.post('/portal/houses', { name: 'Nothing' })).status, 400);
    assert.equal((await org.admin.post('/portal/houses', { fromGlideId: 'glide:nope' })).status, 404);
    const dup = (await org.admin.post(`/portal/houses/${saved.data.id}/duplicate`)).data;
    assert.equal(dup.name, 'My own copy');
    // Client access: only the houses on their list, never archived ones.
    const cl = await w.makeClient(org, 'Sarah', { houseAccess: [a.data.id, saved.data.id] });
    assert.deepEqual((await cl.browser.get('/portal/houses')).data.map((h) => h.id).sort(), [a.data.id, saved.data.id].sort());
    assert.equal((await cl.browser.get(`/portal/houses/${dup.id}`)).status, 404, 'not on the list');
    assert.equal((await cl.browser.get(`/portal/houses/${a.data.id}`)).status, 200);
    await org.admin.post(`/portal/houses/${saved.data.id}/archive`, { archived: true });
    assert.equal((await cl.browser.get('/portal/houses')).data.length, 1, 'archived houses are hidden from clients');
    assert.equal((await org.admin.get('/portal/houses')).data.some((h) => h.id === saved.data.id), false);
    assert.equal((await org.admin.get('/portal/houses?includeArchived=true')).data.some((h) => h.id === saved.data.id), true);
    assert.equal((await org.admin.post(`/portal/houses/${saved.data.id}/archive`, { archived: false })).data.archived, false);
    // The Glide Inside sample designs are hidden from client logins by default; the builder can turn them on.
    assert.equal((await org.admin.get('/portal/org')).data.showGlideToClients ?? false, false, 'off by default');
    assert.deepEqual((await cl.browser.get('/portal/glide-library')).data, []);
    assert.equal((await cl.browser.get('/portal/glide-library/glide:house_single')).status, 404);
    assert.equal((await org.admin.patch('/portal/org/settings', { showGlideToClients: true })).data.showGlideToClients, true);
    assert.equal((await cl.browser.get('/portal/glide-library')).data.length, GLIDE_LIBRARY.length);
    assert.equal((await org.admin.patch('/portal/org/settings', { showGlideLibrary: false })).data.showGlideToClients, false);
    assert.deepEqual((await cl.browser.get('/portal/glide-library')).data, []);
    assert.equal((await cl.browser.get('/portal/glide-library/glide:house_single')).status, 404);
    assert.equal((await org.admin.get('/portal/glide-library')).data.length, GLIDE_LIBRARY.length, 'staff still see it');
    // Another org sees none of this.
    const other = await w.makeOrg('Other Builders', 'Olga');
    assert.deepEqual((await other.admin.get('/portal/houses')).data, []);
    assert.equal((await other.admin.get(`/portal/houses/${a.data.id}`)).status, 404);
    assert.equal((await other.admin.post(`/portal/houses/${a.data.id}/archive`, {})).status, 404);
  });

  t('projects: save, load, update, size cap, owner and org isolation, staff see all in their org', async () => {
    const w = makeWorld({ d1 });
    const org = await w.makeOrg();
    const s1 = await w.makeClient(org, 'Sarah');
    const s2 = await w.makeClient(org, 'Daniel');
    const p = await s1.browser.post('/portal/projects', { name: 'Thornton', project: createFromTemplate('house_single'), lotAddress: 'Lot 14', houseNames: ['Banksia'] });
    assert.equal(p.status, 200);
    assert.equal(p.data.ownerName, 'Sarah');
    const id = p.data.id;
    const upd = await s1.browser.post('/portal/projects', { id, name: 'Thornton v2', project: createFromTemplate('house_double') });
    assert.equal(upd.data.id, id);
    assert.equal(upd.data.name, 'Thornton v2');
    assert.equal(upd.data.lotAddress, 'Lot 14', 'unsent fields are kept');
    const open = (await s1.browser.get(`/portal/projects/${id}`)).data;
    assert.ok(open.project.levels.length);
    assert.equal((await s2.browser.get(`/portal/projects/${id}`)).status, 404, 'another client cannot open it');
    assert.equal((await s2.browser.post('/portal/projects', { id, name: 'hijack', project: createFromTemplate('house_single') })).status, 404);
    assert.equal((await s2.browser.get('/portal/projects')).data.length, 0, 'a client lists only their own');
    assert.equal((await org.admin.get('/portal/projects')).data.length, 1, 'staff see all');
    assert.equal((await org.admin.get(`/portal/projects/${id}`)).status, 200);
    assert.equal((await org.admin.get(`/portal/projects?clientId=${s2.client.id}`)).data.length, 0);
    assert.equal((await org.admin.get(`/portal/projects?clientId=${s1.client.id}`)).data.length, 1);
    const other = await w.makeOrg('Other Builders', 'Olga');
    assert.equal((await other.admin.get(`/portal/projects/${id}`)).status, 404, 'tenant isolation');
    assert.equal((await other.admin.get('/portal/projects')).data.length, 0);
    assert.equal((await s1.browser.post('/portal/projects', { name: 'Bad', project: { nope: 1 } })).status, 400);
    const big = createFromTemplate('house_single');
    big.underlay = { image: 'x'.repeat(2_000_000) };
    const tooBig = await s1.browser.post('/portal/projects', { name: 'Huge', project: big });
    assert.equal(tooBig.status, 413);
    assert.equal(tooBig.data.error.code, 'PAYLOAD_TOO_LARGE');
  });

  t('billing: A$30 once at the first sign in, staff are free, month boundary follows Sydney time, GST is one eleventh', async () => {
    const w = makeWorld({ d1 });
    w.clock.t = Date.UTC(2026, 9, 31, 12, 30); // 31/10/2026 23:30 Sydney (AEDT)
    const org = await w.makeOrg();
    const issued = await org.admin.post('/portal/clients', { firstName: 'Late' });
    assert.equal((await org.admin.get('/portal/billing/usage?month=2026-10')).data.totals.loginsCount, 0, 'generating a login is free');
    const cl = w.browser();
    w.clock.t = Date.UTC(2026, 9, 31, 12, 59); // 23:59 on 31/10 Sydney
    await cl.post('/portal/session', { identifier: issued.data.credentials.username, password: issued.data.credentials.password });
    // A second client signs in just after midnight on 01/11 Sydney (13:00 UTC).
    w.clock.t = Date.UTC(2026, 9, 31, 13, 0);
    const second = await org.admin.post('/portal/clients', { firstName: 'Next' });
    await w.browser().post('/portal/session', { identifier: second.data.credentials.username, password: second.data.credentials.password });
    const oct = (await org.admin.get('/portal/billing/usage?month=2026-10')).data;
    const nov = (await org.admin.get('/portal/billing/usage?month=2026-11')).data;
    assert.equal(oct.totals.loginsCount, 1);
    assert.equal(nov.totals.loginsCount, 1);
    assert.equal(oct.logins[0].clientName, 'Late');
    assert.equal(oct.logins[0].amountCents, 3000);
    assert.equal(nov.timezone, 'Australia/Sydney');
    assert.deepEqual(oct.totals, { loginsCount: 1, loginsCents: 3000, topUpsCount: 0, topUpsCents: 0, totalCents: 3000, gstCents: 273 });
    // Signing in again (or after a password change) never creates a second charge, and later months stay empty.
    const again = w.browser();
    w.clock.t += 2 * DAY;
    assert.equal((await again.post('/portal/session', { identifier: issued.data.credentials.username, password: issued.data.credentials.password })).status, 200, 'second sign in');
    w.clock.t += 40 * DAY;
    await org.relogin();
    assert.equal((await org.admin.get('/portal/billing/usage?month=2026-10')).data.totals.loginsCount, 1);
    assert.equal((await org.admin.get('/portal/billing/usage?month=2026-12')).data.totals.loginsCount, 0);
    assert.equal((await org.admin.get('/portal/billing/usage?month=2026-13')).status, 400);
    assert.equal((await org.admin.get('/portal/billing/usage?month=nope')).status, 400);
    // Staff sign in (admin above) were not charged: only client rows exist.
    assert.equal(nov.logins.every((l) => l.loginId !== org.adminUser.id), true);
    // The default month is the current Sydney month.
    assert.equal((await org.admin.get('/portal/billing/usage')).data.month, monthKey(w.clock.t));
    // Another org cannot see these charges.
    const other = await w.makeOrg('Other Builders', 'Olga');
    assert.equal((await other.admin.get('/portal/billing/usage?month=2026-10')).data.totals.totalCents, 0);
  });

  t('volume pricing: logins 1 to 15 A$30, 16 to 50 A$25, over 50 flagged, a custom rate applies to the whole month and can be cleared', async () => {
    const w = makeWorld({ d1 });
    const org = await w.makeOrg();
    const month = monthKey(w.clock.t);
    const seed = async (from, to) => {
      for (let n = from; n <= to; n += 1) {
        assert.equal(await w.pstore.addLoginIssue({ loginId: `seed${n}`, id: `li_seed${n}`, orgId: org.orgId, clientName: `C${n}`, issuedAt: new Date(w.clock.t + n * 1000).toISOString(), month, amountCents: priceForNthLoginThisMonth(n) }), true);
      }
    };
    await seed(1, 14);
    await w.makeClient(org, 'Fifteenth'); // 15th: A$30
    const u1 = (await org.admin.get(`/portal/billing/usage?month=${month}`)).data;
    assert.equal(u1.totals.loginsCount, 15);
    assert.equal(u1.logins.find((l) => l.clientName === 'Fifteenth').amountCents, 3000);
    assert.deepEqual([u1.loginPricing.count, u1.loginPricing.currentRateCents, u1.loginPricing.customRateCents, u1.loginPricing.over50NeedsCustomRate], [15, 2500, null, false], 'the next login is the 16th');
    const gen = await org.admin.post('/portal/clients', { firstName: 'Sixteenth' });
    assert.equal(gen.data.charge.amountCents, 2500, 'the Generate screen shows the rate the next login will be charged');
    w.clock.t += 60000;
    const s16 = await w.browser().post('/portal/session', { identifier: gen.data.credentials.username, password: gen.data.credentials.password });
    assert.equal(s16.status, 200);
    const u2 = (await org.admin.get(`/portal/billing/usage?month=${month}`)).data;
    assert.equal(u2.logins.find((l) => l.clientName === 'Sixteenth').amountCents, 2500, 'the 16th is A$25');
    await seed(17, 50);
    await w.makeClient(org, 'Fiftyfirst'); // 51st, no custom rate: still A$25 and flagged
    const u3 = (await org.admin.get(`/portal/billing/usage?month=${month}`)).data;
    assert.equal(u3.logins.find((l) => l.clientName === 'Fiftyfirst').amountCents, 2500);
    assert.equal(u3.loginPricing.over50NeedsCustomRate, true);
    assert.equal(u3.totals.loginsCents, 15 * 3000 + 36 * 2500);
    const row = async () => (await w.admin('POST', `/portal/admin/orgs/${org.orgId}/login-rate`, { cents: undefined })).status;
    assert.equal(await row(), 400, 'cents is required');
    assert.equal((await w.admin('POST', `/portal/admin/orgs/${org.orgId}/login-rate`, { cents: 50 })).status, 400, 'below A$1');
    assert.equal((await w.admin('POST', `/portal/admin/orgs/${org.orgId}/login-rate`, { cents: 2000 }, 'wrong-token')).status, 401, 'admin token needed');
    const list0 = (await w.admin('POST', '/portal/admin/orgs/none/login-rate', { cents: 2000 }));
    assert.equal(list0.status, 404);
    // Custom rate: applies to every login this month, including those already charged; the flag clears.
    const set = await w.admin('POST', `/portal/admin/orgs/${org.orgId}/login-rate`, { cents: 2000 });
    assert.equal(set.status, 200, JSON.stringify(set.data));
    assert.equal(set.data.loginPricing.customRateCents, 2000);
    assert.equal(set.data.loginPricing.over50Flag, null);
    const u4 = (await org.admin.get(`/portal/billing/usage?month=${month}`)).data;
    assert.equal(u4.logins.every((l) => l.amountCents === 2000), true);
    assert.equal(u4.totals.loginsCents, 51 * 2000);
    assert.equal(u4.loginPricing.currentRateCents, 2000);
    // Clearing goes back to the tiers for this month.
    const clr = await w.admin('POST', `/portal/admin/orgs/${org.orgId}/login-rate`, { cents: null });
    assert.equal(clr.status, 200);
    assert.equal(clr.data.loginPricing.over50Flag, 'over 50 this month, set custom rate');
    const u5 = (await org.admin.get(`/portal/billing/usage?month=${month}`)).data;
    assert.equal(u5.totals.loginsCents, 15 * 3000 + 36 * 2500);
    // The invoice has one line per distinct unit price.
    const snap = buildSnapshot({ org: { id: org.orgId, shortCode: 'X', legalName: 'X', abn: '' }, config: { topUpCredits: 300, topUpCents: 1000, sellerName: 's', sellerAbn: 'a' }, month, usage: u5, number: 'N', issuedAtMs: w.clock.t });
    assert.deepEqual(snap.lines.map((l) => [l.quantity, l.unitCents, l.totalCents]), [[15, 3000, 45000], [36, 2500, 90000]]);
  });

  t('AI credits: 300 a month per login, hard numbers after a top-up, top-up setting, token for the AI endpoints', async () => {
    const w = makeWorld({ d1 });
    const org = await w.makeOrg();
    const cl = await w.makeClient(org);
    const ai = (await cl.browser.get('/portal/ai')).data;
    assert.deepEqual([ai.monthlyCap, ai.used, ai.monthlyRemaining, ai.topUpBalance, ai.remaining, ai.total], [300, 0, 300, 0, 300, 300]);
    assert.equal(ai.month, '2026-11');
    assert.equal(ai.monthResetsOn, '2026-12-01');
    const top = await cl.browser.post('/portal/ai/top-up');
    assert.equal(top.status, 200);
    assert.equal(top.data.topUp.credits, 300);
    assert.equal(top.data.topUp.amountCents, 1000);
    assert.equal(top.data.ai.topUpBalance, 300);
    assert.equal(top.data.ai.remaining, 600);
    const events = await w.store.listEvents('ai_topup');
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].detail, { orgId: org.orgId, loginId: cl.client.id, credits: 300, amountCents: 1000, currency: 'aud', gstInclusive: true, createdAt: new Date(T0).toISOString(), role: 'client' });
    // The pool rows follow the AI branch naming, so its endpoints and this code share them.
    assert.ok(await w.store.getEntitlement(`orgtop:${org.orgId}:${cl.client.id}`));
    assert.ok(await w.store.getEntitlement(`org:${org.orgId}:${cl.client.id}:2026-11`));
    // Used credits come from the monthly pool first.
    await w.store.settleCredits(`org:${org.orgId}:${cl.client.id}:2026-11`, 0, 120);
    assert.deepEqual(((await cl.browser.get('/portal/ai')).data), { ...(await cl.browser.get('/portal/ai')).data, used: 120, monthlyRemaining: 180, remaining: 480 });
    // Token for the AI endpoints.
    const tok = (await cl.browser.post('/portal/ai/token')).data;
    assert.equal(tok.role, 'client');
    const payload = JSON.parse(Buffer.from(tok.token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    assert.deepEqual([payload.oid, payload.lid, payload.role, payload.cap], [org.orgId, cl.client.id, 'client', 300]);
    assert.equal((await org.admin.post('/portal/ai/token')).data.role, 'builder', 'staff are builder tokens');
    // Rate limit and the builder's switch.
    assert.equal((await org.admin.patch('/portal/org/settings', { allowClientTopUps: false })).data.allowClientTopUps, false);
    const off = await cl.browser.post('/portal/ai/top-up');
    assert.equal(off.status, 403);
    assert.equal(off.data.error.code, 'TOPUPS_DISABLED');
    assert.equal((await cl.browser.get('/portal/me')).data.canTopUp, false);
    assert.equal((await org.admin.post('/portal/ai/top-up')).status, 200, 'staff may always top up');
    assert.equal((await org.admin.get('/portal/me')).data.canTopUp, true);
    await org.admin.patch('/portal/org/settings', { allowClientTopUps: true });
    for (let i = 0; i < 9; i += 1) assert.equal((await cl.browser.post("/portal/ai/top-up")).status, 200);
    assert.equal((await cl.browser.post('/portal/ai/top-up')).status, 429, 'more than 10 top-ups an hour');
  });

  t('top-up credits carry over for 12 months, oldest first, then the unused part expires', async () => {
    const w = makeWorld({ d1 });
    const org = await w.makeOrg();
    const cl = await w.makeClient(org);
    const topId = `orgtop:${org.orgId}:${cl.client.id}`;
    await cl.browser.post('/portal/ai/top-up'); // 11/11/2026, 300
    w.clock.t += 100 * DAY;
    await cl.relogin();
    await cl.browser.post('/portal/ai/top-up'); // 19/02/2027, 300
    await w.store.settleCredits(topId, 0, 250); // 250 used: all from the oldest purchase
    let ai = (await cl.browser.get('/portal/ai')).data;
    assert.equal(ai.topUpBalance, 350);
    w.clock.t = Date.UTC(2027, 10, 12); // first purchase is now over 12 months old
    await cl.relogin();
    ai = (await cl.browser.get('/portal/ai')).data;
    assert.equal(ai.topUpBalance, 300, 'the unused 50 of the old purchase expired; the newer purchase is whole');
    assert.equal((await cl.browser.get('/portal/ai')).data.topUpBalance, 300, 'idempotent');
    w.clock.t = Date.UTC(2028, 1, 20);
    await cl.relogin();
    assert.equal((await cl.browser.get('/portal/ai')).data.topUpBalance, 0, 'the second purchase has expired too');
    const ent = await w.store.getEntitlement(topId);
    assert.equal(ent.creditsTotal - ent.creditsUsed, 0);
  });

  t('builder colour scheme: saved on the org, returned to staff and clients at sign in, validated, cleared, never writable by designers', async () => {
    const w = makeWorld({ d1 });
    const org = await w.makeOrg();
    const b = org.admin;
    assert.equal((await b.get('/portal/me')).data.org.branding.colours, null, 'Glide Inside look until chosen');
    const put = await b.put('/portal/org/branding', { displayName: 'Sample', colours: { primary: '#1F4D3A', accent: '#d9822b', darkInk: '#e8f0ec', darkBg: '#0e1a14' } });
    assert.equal(put.status, 200, JSON.stringify(put.data));
    assert.deepEqual(put.data.colours, { primary: '#1f4d3a', accent: '#d9822b', darkInk: '#e8f0ec', darkBg: '#0e1a14' });
    assert.deepEqual((await b.get('/portal/me')).data.org.branding.colours, put.data.colours);
    const client = await w.makeClient(org);
    assert.deepEqual((await client.browser.get('/portal/me')).data.org.branding.colours, put.data.colours, 'client sees the builder colours');
    assert.equal((await b.put('/portal/org/branding', { displayName: 'Sample' })).data.colours.primary, '#1f4d3a', 'colours kept when not sent');
    assert.equal((await b.put('/portal/org/branding', { displayName: 'Sample', colours: { primary: 'green' } })).status, 400);
    assert.equal((await b.put('/portal/org/branding', { displayName: 'Sample', colours: { primary: '#fff;}</style>' } })).status, 400, 'no CSS injection through the colour fields');
    assert.equal((await b.put('/portal/org/branding', { displayName: 'Sample', colours: { accent: '#d9822b' } })).status, 400, 'accent needs a primary');
    const d = await w.makeDesigner(org);
    assert.equal((await d.browser.put('/portal/org/branding', { displayName: 'X', colours: { primary: '#000000' } })).status, 403);
    assert.equal((await b.put('/portal/org/branding', { displayName: 'Sample', colours: null })).data.colours, null);
    assert.equal((await b.get('/portal/me')).data.org.branding.colours, null);
  });

  t('owner admin route sets and clears an org colour scheme with validation and the admin token', async () => {
    const w = makeWorld({ d1 });
    const org = await w.makeOrg();
    const url = `/portal/admin/orgs/${org.orgId}/brand-colours`;
    assert.equal((await w.admin('POST', url, { colours: { primary: '#14305a', accent: '#F07A1A' } })).status, 200);
    assert.equal((await org.admin.get('/portal/me')).data.org.branding.colours.accent, '#f07a1a');
    assert.equal((await w.admin('POST', url, { colours: { primary: 'navy' } })).status, 400);
    assert.equal((await w.admin('POST', url, {})).status, 400);
    assert.equal((await w.admin('POST', url, { colours: { primary: '#000000' } }, 'wrong-token')).status, 401);
    assert.equal((await w.admin('POST', url, { colours: null })).status, 200);
    assert.equal((await org.admin.get('/portal/me')).data.org.branding.colours, null);
  });

  t('public brand route: only name, logo and colours for an existing org; 404 otherwise; slug set by the admin route and unique', async () => {
    const w = makeWorld({ d1 });
    const org = await w.makeOrg('Hunter Homes Pty Ltd');
    const anon = w.browser();
    const base = (await anon.get('/portal/brand/hunter-homes-pty-ltd', { noCsrf: true }));
    assert.equal(base.status, 200, 'new orgs get a slug from their name');
    assert.deepEqual(Object.keys(base.data).sort(), ['colours', 'logoUrl', 'name']);
    assert.equal(base.data.colours, null);
    assert.equal((await anon.get('/portal/brand/mojo', { noCsrf: true })).status, 404);
    assert.equal((await anon.get('/portal/brand/Not%20A%20Slug', { noCsrf: true })).status, 404);
    const url = `/portal/admin/orgs/${org.orgId}/slug`;
    assert.equal((await w.admin('POST', url, { slug: 'hunter-homes' })).status, 200);
    assert.equal((await w.admin('POST', url, { slug: 'Bad Slug' })).status, 400);
    assert.equal((await w.admin('POST', url, { slug: 'x' }, 'wrong-token')).status, 401);
    await w.admin('POST', `/portal/admin/orgs/${org.orgId}/brand-colours`, { colours: { primary: '#14305a', accent: '#F07A1A' } });
    const got = (await anon.get('/portal/brand/hunter-homes', { noCsrf: true }));
    assert.equal(got.data.name, 'Hunter Homes Pty Ltd');
    assert.equal(got.data.colours.accent, '#f07a1a');
    assert.equal((await anon.get('/portal/brand/hunter-homes-pty-ltd', { noCsrf: true })).status, 404, 'the old slug no longer resolves');
    const other = await w.makeOrg('Hotondo Homes Pty Ltd', 'Sam');
    assert.equal((await w.admin('POST', `/portal/admin/orgs/${other.orgId}/slug`, { slug: 'hunter-homes' })).status, 409);
  });

  t('admin house import: token only, validated like saveHouse, idempotent by name, never touches another org', async () => {
    const w = makeWorld({ d1 });
    const a = await w.makeOrg('Alpha Homes Pty Ltd', 'Priya');
    const b = await w.makeOrg('Beta Homes Pty Ltd', 'Quinn');
    const url = (o) => `/portal/admin/orgs/${o.orgId}/houses`;
    const mk = (name, tpl = 'house_single') => ({ name, description: 'Imported', project: createFromTemplate(tpl) });
    assert.equal((await w.admin('POST', url(a), { houses: [mk('One')] }, 'wrong-token')).status, 401, 'admin token needed');
    assert.equal((await a.admin.post(url(a), { houses: [mk('One')] })).status, 401, 'a signed in builder admin cannot use it');
    assert.equal((await w.admin('POST', '/portal/admin/orgs/nope/houses', { houses: [mk('One')] })).status, 404);
    assert.equal((await w.admin('POST', url(a), { houses: [] })).status, 400);
    assert.equal((await w.admin('POST', url(a), {})).status, 400);

    const first = await w.admin('POST', url(a), { houses: [mk('Banksia 200'), mk('Wattle 180', 'granny_flat')] });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.deepEqual([first.data.created, first.data.replaced, first.data.failed], [2, 0, 0]);
    const list = (await a.admin.get('/portal/houses')).data;
    assert.deepEqual(list.map((h) => h.name).sort(), ['Banksia 200', 'Wattle 180']);
    assert.ok(list.every((h) => h.widthMm > 0 && h.bedrooms >= 0), 'stats are filled like saveHouse');
    const id = list.find((h) => h.name === 'Banksia 200').id;
    const opened = (await a.admin.get(`/portal/houses/${id}`)).data;
    assert.equal(opened.project.name, 'Banksia 200');
    assert.ok(opened.thumbnail, 'thumbnail is filled like saveHouse');
    assert.equal((await b.admin.get('/portal/houses')).data.length, 0, 'the other org got nothing');

    // Re-run: replaced in place (same id, any case), no duplicates.
    const again = await w.admin('POST', url(a), { houses: [mk('banksia 200', 'granny_flat'), mk('Wattle 180', 'granny_flat')] });
    assert.deepEqual([again.data.created, again.data.replaced, again.data.failed], [0, 2, 0]);
    const list2 = (await a.admin.get('/portal/houses')).data;
    assert.equal(list2.length, 2);
    assert.equal(list2.find((h) => h.name === 'banksia 200').id, id, 'same id after replace');

    // The same name in another org is a separate house, and an archived one comes back when replaced.
    assert.equal((await w.admin('POST', url(b), { houses: [mk('Banksia 200')] })).data.created, 1);
    assert.equal((await a.admin.get('/portal/houses')).data.length, 2, 'org A untouched by the import into org B');
    assert.equal((await a.admin.post(`/portal/houses/${id}/archive`)).status, 200);
    const back = await w.admin('POST', url(a), { houses: [mk('Banksia 200')] });
    assert.equal(back.data.replaced, 1);
    assert.equal((await a.admin.get('/portal/houses')).data.find((h) => h.id === id).archived, false);

    // Bad houses fail alone with a reason; good ones in the same request still import.
    const bad = createFromTemplate('house_single');
    bad.levels[0].openings.push({ id: 'o_bad', wallId: 'missing', kind: 'door', offset: 0, width: 800, height: 2000, sill: 0, style: 'hinged', hinge: 'a', side: 1, status: 'new' });
    const mixed = await w.admin('POST', url(a), { houses: [{ name: 'Broken', project: bad }, { name: 'NoProject' }, { project: { nope: 1 }, name: 'Junk' }, mk('Fine one')] });
    assert.equal(mixed.status, 200);
    assert.deepEqual([mixed.data.created, mixed.data.failed], [1, 3]);
    assert.match(mixed.data.results.find((x) => x.name === 'Broken').error, /problems/);
    assert.ok((await a.admin.get('/portal/houses')).data.some((h) => h.name === 'Fine one'));
    assert.equal((await a.admin.get('/portal/houses')).data.some((h) => h.name === 'Broken'), false);

    // A client login is not touched and sees only the houses it is allowed to.
    const c = await w.makeClient(a, 'Sarah');
    assert.ok(Array.isArray((await c.browser.get('/portal/houses')).data));
  });

  t('admin house import: the shipped builder-houses files import cleanly, each builder only gets its own', async () => {
    const dir = new URL('../../golive/builder-houses/', import.meta.url);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    assert.deepEqual(files.sort(), ['hotondo.json', 'hunter-homes.json', 'mcdonald-jones.json', 'mojo.json', 'montgomery.json', 'tulliplan.json']);
    const w = makeWorld({ d1 });
    const orgs = {};
    for (const f of files) orgs[f] = await w.makeOrg(`${f.replace('.json', '')} Homes`, 'Priya');
    for (const f of files) {
      const houses = JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'));
      const res = await w.admin('POST', `/portal/admin/orgs/${orgs[f].orgId}/houses`, { houses });
      assert.equal(res.status, 200, f);
      assert.deepEqual([res.data.created, res.data.failed], [houses.length, 0], `${f}: ${JSON.stringify(res.data.results.filter((x) => x.error))}`);
    }
    for (const f of files) {
      const names = (await orgs[f].admin.get('/portal/houses')).data.map((h) => h.name).sort();
      assert.deepEqual(names, JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8')).map((h) => h.name).sort(), `${f} holds exactly its own designs`);
    }
  });

  t('public brand route is rate limited', async () => {
    const w = makeWorld({ d1 });
    const anon = w.browser();
    let last = 0;
    for (let i = 0; i < 125; i += 1) last = (await anon.get('/portal/brand/mojo', { noCsrf: true })).status;
    assert.equal(last, 429);
  });

  t('billing contact needs the legal name and a valid ABN; branding and settings validate input', async () => {
    const w = makeWorld({ d1 });
    const org = await w.makeOrg();
    const b = org.admin;
    assert.deepEqual((await b.get('/portal/billing/contact')).data, { name: '', email: '', phone: '', legalName: '', abn: '' });
    const good = { name: 'Accounts', email: 'Accounts@Sample.example', phone: '02 5550 0100', legalName: 'Sample Homes Pty Ltd', abn: '51824753556' };
    assert.equal((await b.put('/portal/billing/contact', { ...good, abn: '51 824 753 557' })).status, 400, 'checksum');
    assert.equal((await b.put('/portal/billing/contact', { ...good, legalName: '' })).status, 400);
    assert.equal((await b.put('/portal/billing/contact', { ...good, email: 'nope' })).status, 400);
    const saved = await b.put('/portal/billing/contact', good);
    assert.equal(saved.status, 200);
    assert.equal(saved.data.abn, '51 824 753 556');
    assert.equal(saved.data.email, 'accounts@sample.example');
    assert.equal((await b.get('/portal/me')).data.org.billingContact.legalName, 'Sample Homes Pty Ltd');
    // Branding
    assert.equal((await b.put('/portal/org/branding', { displayName: 'Sample', logoDataUrl: PNG })).data.logoDataUrl, PNG);
    assert.equal((await b.get('/portal/me')).data.org.branding.logoDataUrl, PNG);
    assert.equal((await b.put('/portal/org/branding', { displayName: 'Sample 2' })).data.logoDataUrl, PNG, 'logo kept when not sent');
    assert.equal((await b.put('/portal/org/branding', { displayName: 'Sample', logoDataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' })).status, 400, 'SVG is refused (script risk)');
    assert.equal((await b.put('/portal/org/branding', { displayName: 'Sample', logoDataUrl: `data:image/png;base64,${Buffer.from('not a png at all').toString('base64')}` })).status, 400, 'magic bytes are checked');
    assert.equal((await b.put('/portal/org/branding', { displayName: 'Sample', logoDataUrl: `data:image/png;base64,${'A'.repeat(401000)}` })).status, 413);
    assert.equal((await b.put('/portal/org/branding', { displayName: '', logoDataUrl: null })).status, 400);
    assert.equal((await b.put('/portal/org/branding', { displayName: 'Sample', logoDataUrl: null })).data.logoDataUrl, null);
    // Settings
    const s = (await b.patch('/portal/org/settings', { allowClientCadExports: true, allowClientEnquiries: false })).data;
    assert.equal(s.allowClientCadExports, true);
    assert.equal(s.allowClientEnquiries, false);
    assert.equal((await b.patch('/portal/org/settings', { allowClientTopUps: 'yes' })).status, 400);
    const cl = await w.makeClient(org);
    const me = (await cl.browser.get('/portal/me')).data;
    assert.deepEqual(me.exports, ['pdf', 'dxf', 'glb', 'obj', 'html']);
    assert.equal(me.enquiry, false);
    assert.deepEqual((await org.admin.get('/portal/me')).data.exports, ['pdf', 'dxf', 'glb', 'obj', 'html']);
  });

  t('team: admin invites staff, resets their passwords, guards the last admin, role changes apply at once', async () => {
    const w = makeWorld({ d1 });
    const org = await w.makeOrg();
    const des = await w.makeDesigner(org, 'Tom');
    assert.equal((await org.admin.get('/portal/team')).data.length, 2);
    assert.equal((await org.admin.post('/portal/team', { firstName: 'X', role: 'client' })).status, 400);
    assert.equal((await org.admin.post('/portal/team', { firstName: 'Tom2', role: 'designer', email: 'tom@x.example' })).status, 409, 'email already used');
    const reset = await org.admin.post(`/portal/team/${des.user.id}/reset-password`);
    assert.equal(reset.status, 200);
    assert.match(reset.data.credentials.password, /^[a-z]+-[a-z]+-[2-9]{2}$/);
    assert.equal((await des.browser.get('/portal/me')).status, 401, 'their sessions ended');
    const back = w.browser();
    const s = await back.post('/portal/session', { identifier: des.user.username, password: reset.data.credentials.password });
    assert.equal(s.data.user.mustChangePassword, true);
    // Staff are never billed.
    assert.equal((await org.admin.get('/portal/billing/usage')).data.totals.totalCents, 0);
    // Last admin guards.
    assert.equal((await org.admin.post(`/portal/team/${org.adminUser.id}/disable`)).status, 409, 'cannot disable yourself');
    assert.equal((await org.admin.patch(`/portal/team/${org.adminUser.id}`, { role: 'designer' })).status, 409, 'there must be an admin');
    const cl = await w.makeClient(org, 'Cee', {}, { signIn: false });
    const promoted = await org.admin.patch(`/portal/team/${des.user.id}`, { role: 'admin' });
    assert.equal(promoted.data.role, 'admin');
    assert.equal((await org.admin.patch(`/portal/team/${org.adminUser.id}`, { role: 'designer' })).status, 200, 'now another admin exists');
    assert.equal((await org.admin.get('/portal/team')).status, 401, 'demoted: the old admin sessions were ended, so the change applies at once');
    // A client id is not a team member.
    const newAdmin = w.browser();
    await newAdmin.post('/portal/session', { identifier: des.user.username, password: reset.data.credentials.password });
    await newAdmin.post('/portal/password', { currentPassword: reset.data.credentials.password, newPassword: 'Promoted-Admin-Pass-31' });
    assert.equal((await newAdmin.post(`/portal/team/${cl.client.id}/reset-password`)).status, 404);
    assert.equal((await newAdmin.patch(`/portal/team/${cl.client.id}`, { role: 'admin' })).status, 404);
  });

  t('stripe month end: invoices the previous month per org, GST inclusive, send_invoice, idempotent', async () => {
    const w = makeWorld({ d1 });
    // October: two client first sign ins and one top-up for org A; org B has nothing.
    w.clock.t = Date.UTC(2026, 9, 10, 1, 0);
    const a = await w.makeOrg('Alpha Builders Pty Ltd', 'Priya');
    await a.admin.put('/portal/billing/contact', { name: 'Accounts', email: 'accounts@alpha.example', phone: '', legalName: 'Alpha Builders Pty Ltd', abn: '51 824 753 556' });
    const c1 = await w.makeClient(a, 'Sarah');
    await w.makeClient(a, 'Daniel');
    await c1.browser.post('/portal/ai/top-up');
    const b = await w.makeOrg('Bravo Homes', 'Bob');
    await w.makeClient(b, 'Nobody', {}, { signIn: false });
    // November: one more sign in that must NOT be on the October invoice.
    w.clock.t = Date.UTC(2026, 10, 11, 1, 0);
    await a.relogin();
    await b.relogin();
    await w.makeClient(a, 'Later');
    assert.equal((await w.admin('POST', '/billing/run-month', { month: '2026-11' })).status, 400, 'the current month is not finished');
    assert.equal((await w.admin('POST', '/billing/run-month', { month: '2027-05' })).status, 400, 'a future month');
    assert.equal((await w.admin('POST', '/billing/run-month', { month: 'bad' })).status, 400);
    assert.equal((await w.admin('POST', '/billing/run-month', {}, 'wrong')).status, 401);
    assert.equal((await w.app.fetch(new Request(`${SITE}/api/billing/run-month`, { method: 'POST', body: '{}' }))).status, 401);
    assert.equal((await w.app.fetch(new Request(`${SITE}/api/billing/run-month`, { method: 'GET' }))).status, 405);
    // The cookie of a signed in admin is no substitute for the token.
    assert.equal((await a.admin.post('/billing/run-month', { month: '2026-10' })).status, 401);
    assert.equal(w.stripe.calls.length, 0);

    const run = await w.admin('POST', '/billing/run-month', { month: '2026-10' });
    assert.equal(run.status, 200, JSON.stringify(run.data));
    assert.equal(run.data.month, '2026-10');
    const byOrg = Object.fromEntries(run.data.results.map((r) => [r.orgId, r]));
    assert.equal(byOrg[a.orgId].status, 'issued');
    assert.equal(byOrg[a.orgId].totalCents, 7000, '2 logins x A$30 + 1 top-up x A$10');
    assert.equal(byOrg[b.orgId].status, 'skipped');
    assert.equal(byOrg[b.orgId].reason, 'billing_contact_incomplete');
    const paths = w.stripe.calls.map((c) => `${c.method} ${c.path}`);
    assert.deepEqual(paths, ['POST /customers', 'POST /tax_rates', 'POST /invoices', 'POST /invoiceitems', 'POST /invoiceitems', 'POST /invoices/in_test_1/finalize', 'POST /invoices/in_test_1/send']);
    const [cust, rate, inv, item1, item2] = w.stripe.calls;
    assert.equal(cust.form.name, 'Alpha Builders Pty Ltd');
    assert.equal(cust.form.email, 'accounts@alpha.example');
    assert.equal(cust.form['metadata[org_id]'], a.orgId);
    assert.deepEqual([rate.form.percentage, rate.form.inclusive, rate.form.country, rate.form.display_name], ['10', 'true', 'AU', 'GST']);
    assert.equal(inv.form.collection_method, 'send_invoice');
    assert.equal(inv.form.days_until_due, '14');
    assert.equal(inv.form.currency, 'aud');
    assert.equal(inv.form.customer, 'cus_test_1');
    assert.equal(inv.form['default_tax_rates[0]'], 'txr_test_1');
    assert.equal(inv.form.pending_invoice_items_behavior, 'exclude');
    assert.match(inv.form.footer, /JCE Infrastructure Pty Ltd trading as Glide Inside, ABN 29 699 165 663/);
    assert.equal(inv.form['custom_fields[0][value]'], '29 699 165 663');
    assert.equal(inv.form['custom_fields[1][value]'], '51 824 753 556');
    assert.equal(inv.form['metadata[month]'], '2026-10');
    assert.deepEqual([item1.form.quantity, item1.form.unit_amount, item1.form['tax_rates[0]'], item1.form.invoice], ['2', '3000', 'txr_test_1', 'in_test_1']);
    assert.deepEqual([item2.form.quantity, item2.form.unit_amount], ['1', '1000']);
    assert.match(item1.form.description, /New client logins first signed in during 2026-10/);
    assert.match(item2.form.description, /AI credit top-ups of 300 credits/);
    for (const c of w.stripe.calls) assert.match(c.headers.authorization, /^Bearer sk_test_/);
    assert.ok(w.stripe.calls.filter((c) => c.method === 'POST').every((c) => c.headers['idempotency-key']), 'every write carries an idempotency key');
    // The builder sees the tax invoice.
    const list = (await a.admin.get('/portal/billing/invoices')).data;
    assert.equal(list.length, 1);
    assert.equal(list[0].number, `GI-${a.shortCode}-202610`);
    assert.equal(list[0].status, 'due');
    assert.equal(list[0].totalCents, 7000);
    const full = (await a.admin.get(`/portal/billing/invoices/${list[0].id}`)).data;
    assert.equal(full.title, 'Tax invoice');
    assert.deepEqual(full.seller, { name: 'JCE Infrastructure Pty Ltd trading as Glide Inside', abn: '29 699 165 663' });
    assert.equal(full.buyer.legalName, 'Alpha Builders Pty Ltd');
    assert.equal(full.buyer.abn, '51 824 753 556');
    assert.deepEqual([full.subtotalExGstCents, full.gstCents, full.totalInclGstCents], [6364, 636, 7000]);
    assert.deepEqual(full.lines.map((l) => [l.quantity, l.unitCents, l.totalCents]), [[2, 3000, 6000], [1, 1000, 1000]]);
    assert.equal(full.dueAt.slice(0, 10), '2026-11-25', 'due 14 days after issue');
    assert.equal(full.hostedInvoiceUrl, 'https://invoice.stripe.com/i/test');
    // Tenant isolation.
    assert.equal((await b.admin.get('/portal/billing/invoices')).data.length, 0);
    assert.equal((await b.admin.get(`/portal/billing/invoices/${list[0].id}`)).status, 404);
    // Idempotent: running the month again creates nothing at Stripe.
    w.stripe.calls.length = 0;
    const again = await w.admin('POST', '/billing/run-month', { month: '2026-10' });
    assert.equal(again.data.results.find((r) => r.orgId === a.orgId).status, 'exists');
    assert.equal(w.stripe.calls.length, 0);
    // Once Bravo has a billing contact it is skipped for having no charges, not invoiced for nothing.
    await b.admin.put('/portal/billing/contact', { name: 'B', email: 'b@bravo.example', phone: '', legalName: 'Bravo Homes Pty Ltd', abn: '29 699 165 663' });
    const none = await w.admin('POST', '/billing/run-month', { month: '2026-10', orgId: b.orgId });
    assert.equal(none.data.results[0].reason, 'no_charges');
    assert.equal((await w.admin('POST', '/billing/run-month', { month: '2026-10', orgId: 'org_missing' })).status, 404);
    assert.equal(w.stripe.calls.length, 0);
  });

  t('stripe month end: default is last month, the Worker cron acts only at 06:00 on the 1st Sydney time, and a failure resumes without duplicating', async () => {
    const w = makeWorld({ d1 });
    w.clock.t = Date.UTC(2026, 9, 20, 1, 0);
    const a = await w.makeOrg('Alpha Builders Pty Ltd', 'Priya');
    await a.admin.put('/portal/billing/contact', { name: 'Accounts', email: 'accounts@alpha.example', phone: '', legalName: 'Alpha Builders Pty Ltd', abn: '51 824 753 556' });
    const sarah = await w.makeClient(a, 'Sarah');
    await w.makeClient(a, 'Daniel');
    await sarah.browser.post('/portal/ai/top-up');
    w.clock.t = Date.UTC(2026, 10, 1, 0, 0); // 11:00 on 01/11/2026 Sydney: not the run time
    assert.equal(await w.app.scheduled(), null, 'cron at the wrong Sydney hour does nothing');
    assert.equal(w.stripe.calls.length, 0);
    w.clock.t = Date.UTC(2026, 9, 31, 19, 0); // 06:00 on 01/11/2026 Sydney (AEDT)
    // First attempt: Stripe fails on the second item.
    let n = 0;
    w.stripe.fail = (m, p) => p === '/invoiceitems' && m === 'POST' && ++n === 2;
    const first = await w.app.scheduled();
    assert.equal(first.month, '2026-10', 'the previous Sydney month');
    assert.equal(first.results[0].status, 'failed');
    assert.equal((await a.admin.get('/portal/billing/invoices')).data.length, 0, 'a failed invoice is not shown to the builder');
    assert.equal(w.stripe.invoices, 1);
    // Retry: the draft invoice is reused (not created again), only the missing item is added, then it is finalized and sent.
    w.stripe.fail = null;
    w.stripe.calls.length = 0;
    w.clock.t += 20 * MIN; // past the 15 minute in-progress window
    await a.relogin();
    const manual = await w.admin('POST', '/billing/run-month', { month: '2026-10' });
    assert.equal(manual.data.results[0].status, 'issued');
    assert.ok(w.stripe.calls.some((c) => c.method === 'GET' && c.path === '/invoiceitems'), 'a resume checks which items are already on the draft');
    assert.equal(w.stripe.invoices, 1, 'no second Stripe invoice');
    assert.ok(!w.stripe.calls.some((c) => c.method === 'POST' && c.path === '/invoices'));
    assert.equal(w.stripe.items.length, 2, 'each line exists once');
    assert.deepEqual(w.stripe.calls.filter((c) => c.method === 'POST').map((c) => c.path), ['/invoiceitems', '/invoices/in_test_1/finalize', '/invoices/in_test_1/send']);
    assert.equal((await a.admin.get('/portal/billing/invoices')).data.length, 1);
  });

  t('stripe: live keys are refused without the owner go-ahead, and a missing key fails cleanly', async () => {
    const w = makeWorld({ d1, env: { STRIPE_SECRET_KEY: 'sk_live_abc' } });
    w.clock.t = Date.UTC(2026, 9, 20, 1, 0);
    const a = await w.makeOrg('Alpha Builders Pty Ltd', 'Priya');
    await a.admin.put('/portal/billing/contact', { name: 'A', email: 'a@alpha.example', phone: '', legalName: 'Alpha Builders Pty Ltd', abn: '51 824 753 556' });
    await w.makeClient(a, 'Sarah');
    w.clock.t = Date.UTC(2026, 10, 11, 1, 0);
    const r = await w.admin('POST', '/billing/run-month', { month: '2026-10' });
    assert.equal(r.data.results[0].status, 'failed');
    assert.match(r.data.results[0].reason, /live billing has not been approved/);
    assert.equal(w.stripe.calls.length, 0, 'nothing reached Stripe');
    const w2 = makeWorld({ d1, env: { STRIPE_SECRET_KEY: '' } });
    assert.equal(await w2.app.scheduled(), null);
  });

  t('the real browser client (createHttpApi) works against these routes end to end', async () => {
    const w = makeWorld({ d1 });
    const org = await w.makeOrg();
    let cookie = null;
    const fetchImpl = async (url, init) => {
      const headers = new Headers(init.headers);
      headers.set('origin', SITE);
      if (cookie) headers.set('cookie', `gi_session=${cookie}`);
      const res = await w.app.fetch(new Request(url, { ...init, headers }));
      for (const c of res.headers.getSetCookie()) cookie = /^gi_session=([^;]*)/.exec(c)?.[1] || null;
      return res;
    };
    const api = createHttpApi({ base: `${SITE}/api`, fetchImpl });
    assert.equal(await api.me(), null, 'me resolves null on 401');
    const me = await api.signIn({ identifier: org.adminUser.username, password: org.adminPassword });
    assert.equal(me.user.role, 'admin');
    const house = await api.saveHouse({ fromGlideId: GLIDE_LIBRARY[0].id });
    assert.deepEqual((await api.listHouses()).map((h) => h.id), [house.id]);
    assert.equal((await api.archiveHouse(house.id)).archived, true);
    assert.equal((await api.archiveHouse(house.id, false)).archived, false);
    const issued = await api.issueClientLogin({ firstName: 'Sarah' });
    assert.ok(issued.credentials.password);
    assert.equal((await api.listClients()).length, 1);
    assert.equal((await api.monthUsage()).totals.totalCents, 0);
    assert.equal((await api.aiBalance()).monthlyCap, 300);
    await assert.rejects(() => api.getHouse('h_missing'), (e) => e.code === 'NOT_FOUND');
    assert.deepEqual(await api.signOut(), { ok: true });
    assert.equal(await api.me(), null);
  });
}

if (DatabaseSync) {
  test('D1 store: unique usernames and emails, one login charge per login, cascade delete keeps the billing row', async () => {
    const db = makeD1();
    const ps = createD1PortalStore(db);
    const org = { id: 'o1', name: 'O', shortCode: 'O', createdAt: 'x', aiMonthlyCap: 300, allowClientTopUps: true, allowClientEnquiries: true, showGlideToClients: true, allowClientCadExports: false };
    assert.equal(await ps.createOrg(org), true);
    assert.equal(await ps.createOrg({ ...org, id: 'o2' }), false, 'short code is unique');
    const user = (id, username, email) => ({ id, orgId: 'o1', role: 'client', name: 'N', email, username, passwordHash: 'h', mustChangePassword: true, status: 'active', houseAccess: 'all', createdAt: 'x' });
    assert.equal(await ps.createUser(user('u1', 'a-2222', 'a@x.example')), true);
    assert.equal(await ps.createUser(user('u2', 'a-2222', null)), false, 'username unique');
    assert.equal(await ps.createUser(user('u3', 'b-2222', 'a@x.example')), false, 'email unique');
    assert.equal(await ps.createUser(user('u4', 'c-2222', null)), true);
    assert.equal(await ps.createUser(user('u5', 'd-2222', null)), true, 'several users without an email');
    assert.deepEqual((await ps.getUser('u1')).houseAccess, 'all');
    await ps.updateUser('u1', { houseAccess: ['h1', 'h2'], mustChangePassword: false });
    const u1 = await ps.getUser('u1');
    assert.deepEqual([u1.houseAccess, u1.mustChangePassword], [['h1', 'h2'], false]);
    assert.equal(await ps.addLoginIssue({ loginId: 'u1', id: 'li1', orgId: 'o1', clientName: 'N', issuedAt: 't', month: '2026-11', amountCents: 2000 }), true);
    assert.equal(await ps.addLoginIssue({ loginId: 'u1', id: 'li2', orgId: 'o1', clientName: 'N', issuedAt: 't2', month: '2026-12', amountCents: 2000 }), false, 'once per login');
    await ps.saveProject({ id: 'p1', orgId: 'o1', ownerId: 'u1', name: 'P', project: { a: 1 }, createdAt: 'x', updatedAt: 'x' });
    await ps.createSession({ idHash: 's1', userId: 'u1', createdAt: 'x', lastSeenAt: 'x', expiresAt: 'z' });
    assert.deepEqual(await ps.deleteUser('o1', 'u1'), { removedProjects: 1 });
    assert.equal(await ps.getSession('s1'), null);
    assert.equal((await ps.getLoginIssue('u1')).month, '2026-11', 'the billing row stays');
    assert.equal(await ps.deleteUser('other-org', 'u4').then((r) => r.removedProjects), 0);
    assert.ok(await ps.getUser('u4'), 'deleting through the wrong org does nothing');
    // Failure counters
    const lim = { windowMs: 900000, max: 3, lockMs: 900000 };
    assert.deepEqual(await ps.addFailure('k', 1000, lim), { count: 1, lockedUntil: null });
    await ps.addFailure('k', 2000, lim);
    assert.deepEqual(await ps.addFailure('k', 3000, lim), { count: 3, lockedUntil: 903000 });
    assert.equal((await ps.getFailure('k')).lockedUntil, 903000);
    await ps.clearFailure('k');
    assert.equal(await ps.getFailure('k'), null);
    // Two invoices for one org and month cannot exist.
    const inv = { id: 'i1', orgId: 'o1', month: '2026-10', number: 'N1', issuedAt: 'a', dueAt: 'b', loginsCount: 1, topUpsCount: 0, totalCents: 2000, status: 'pending', snapshot: { a: 1 } };
    assert.equal(await ps.insertInvoice(inv), true);
    assert.equal(await ps.insertInvoice({ ...inv, id: 'i2', number: 'N2' }), false);
    assert.equal(await ps.insertInvoice({ ...inv, id: 'i3', month: '2026-11' }), false, 'number is unique');
  });
}

test('buildSnapshot carries the seller from config and GST of one eleventh', () => {
  const config = { sellerName: 'JCE Infrastructure Pty Ltd trading as Glide Inside', sellerAbn: '29 699 165 663', topUpCredits: 300, topUpCents: 1000 };
  const usage = { logins: [], topUps: [], totals: { loginsCount: 3, loginsCents: 6000, topUpsCount: 1, topUpsCents: 1000, totalCents: 7000 } };
  const s = buildSnapshot({ org: { legalName: 'B Pty Ltd', abn: '51 824 753 556', billingEmail: 'b@x.example' }, config, month: '2026-10', usage, number: 'GI-B-202610', issuedAtMs: T0 });
  assert.deepEqual([s.subtotalExGstCents, s.gstCents, s.totalInclGstCents], [6364, 636, 7000]);
  assert.equal(s.seller.name, 'JCE Infrastructure Pty Ltd trading as Glide Inside');
  assert.equal(s.title, 'Tax invoice');
});
