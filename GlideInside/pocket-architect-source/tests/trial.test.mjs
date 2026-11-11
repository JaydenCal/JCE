// Free builder trial (server/lib/trial.js, docs/PORTAL_API.md 14): request form, owner approval, trial rules, read only after the
// trial, card capture through Stripe Checkout (setup mode, mocked fetch, test keys only), the saved card monthly charge and the owner
// notification. Every flow runs on the in-memory store and on D1 (SQLite shim). No real Stripe call and no email is ever sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../server/lib/app.js';
import { createMemoryStore, createD1Store } from '../server/lib/store.js';
import { createMemoryPortalStore, createD1PortalStore } from '../server/lib/portal-store.js';
import { hmacSha256 } from '../server/lib/entitlement.js';
import { abnValid } from '../server/lib/portal.js';
import { orgState, trialEndFor, extendedEnd, notificationText } from '../server/lib/trial.js';
import { sydneyDayStartPlus, ddmmyyyyTime } from '../src/portal/billing.js';

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  /* D1 shim tests are skipped without node:sqlite */
}

const SITE = 'https://site.test';
const ADMIN_TOKEN = 'admin-token-for-tests-0123456789';
const WHSEC = 'whsec_trial_unit';
const T0 = Date.UTC(2026, 10, 11, 1, 0, 0); // 11/11/2026 12:00 Sydney (AEDT)
const DAY = 86400000;
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

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

/** ABNs that pass the ATO checksum: the first n valid 11 digit numbers from a base. */
function validAbns(n, from = 51824753556) {
  const out = [];
  for (let v = from; out.length < n; v += 1) if (abnValid(String(v))) out.push(String(v));
  return out;
}
const ABNS = validAbns(40);

function makeWorld({ d1 = false, env = {} } = {}) {
  const clock = { t: T0 };
  const db = d1 ? makeD1() : null;
  const store = d1 ? createD1Store(db) : createMemoryStore();
  const pstore = d1 ? createD1PortalStore(db) : createMemoryPortalStore();
  const stripe = { calls: [], items: [], invoices: 0, customers: 0, payResult: 'paid', setupStatus: 'succeeded', sessions: {} };
  const resend = { calls: [], fail: false };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.origin === 'https://api.resend.com') {
      resend.calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
      return resend.fail ? jsonRes({ message: 'no' }, 500) : jsonRes({ id: 'em_1' });
    }
    if (u.origin !== 'https://api.stripe.com') throw new Error(`unexpected fetch ${url}`);
    const path = u.pathname.replace('/v1', '');
    const method = init.method || 'GET';
    const form = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : {};
    stripe.calls.push({ method, path, form, headers: init.headers, query: u.search });
    if (method === 'POST' && path === '/customers') return jsonRes({ id: `cus_test_${++stripe.customers}` });
    if (method === 'POST' && /^\/customers\/cus_test_\d+$/.test(path)) return jsonRes({ id: path.split('/')[2] });
    if (method === 'POST' && path === '/tax_rates') return jsonRes({ id: 'txr_test_1' });
    if (method === 'POST' && path === '/checkout/sessions') return jsonRes({ id: 'cs_test_setup1', url: 'https://checkout.stripe.com/c/pay/cs_test_setup1' });
    if (method === 'GET' && path.startsWith('/checkout/sessions/')) return stripe.sessions[path.split('/')[3]] ? jsonRes(stripe.sessions[path.split('/')[3]]) : jsonRes({ error: { message: 'none' } }, 404);
    if (method === 'GET' && path === '/setup_intents/seti_test_1') return jsonRes({ id: 'seti_test_1', status: stripe.setupStatus, payment_method: { id: 'pm_test_1', card: { brand: 'visa', last4: '4242' } } });
    if (method === 'POST' && path === '/invoices') return jsonRes({ id: `in_test_${++stripe.invoices}` });
    if (method === 'POST' && path === '/invoiceitems') {
      stripe.items.push({ invoice: form.invoice });
      return jsonRes({ id: `ii_${stripe.items.length}` });
    }
    if (method === 'GET' && path === '/invoiceitems') return jsonRes({ data: [] });
    if (method === 'POST' && /\/finalize$/.test(path)) return jsonRes({ id: path.split('/')[2], hosted_invoice_url: 'https://invoice.stripe.com/i/test' });
    if (method === 'POST' && /\/send$/.test(path)) return jsonRes({ id: path.split('/')[2], hosted_invoice_url: 'https://invoice.stripe.com/i/test' });
    if (method === 'POST' && /\/pay$/.test(path)) {
      return stripe.payResult === 'paid' ? jsonRes({ id: path.split('/')[2], status: 'paid', hosted_invoice_url: 'https://invoice.stripe.com/i/paid' }) : jsonRes({ error: { message: 'Your card was declined.' } }, 402);
    }
    return jsonRes({ error: { message: 'unhandled' } }, 404);
  };
  const app = createApp({
    store, portalStore: pstore, fetchImpl, now: () => clock.t,
    env: { SITE_URL: SITE, ENTITLEMENT_SECRET: 'unit-test-secret', PORTAL_ENABLED: '1', ADMIN_TOKEN, STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_WEBHOOK_SECRET: WHSEC, ...env },
  });
  const world = { clock, store, pstore, app, stripe, resend, db };

  world.browser = () => {
    const jar = { cookie: null };
    const call = async (method, path, body, { headers = {}, noCsrf = false } = {}) => {
      const h = { ...headers, origin: SITE };
      if (jar.cookie) h.cookie = `gi_session=${jar.cookie}`;
      if (!noCsrf) h['x-gi-request'] = '1';
      if (body !== undefined) h['content-type'] = 'application/json';
      const res = await app.fetch(new Request(`${SITE}/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
      for (const c of res.headers.getSetCookie?.() || []) {
        const m = /^gi_session=([^;]*)/.exec(c);
        if (m) jar.cookie = m[1] || null;
      }
      return { status: res.status, data: await res.json().catch(() => null) };
    };
    return { jar, call, get: (p, o) => call('GET', p, undefined, o), post: (p, b, o) => call('POST', p, b ?? {}, o), put: (p, b, o) => call('PUT', p, b, o), del: (p, o) => call('DELETE', p, undefined, o) };
  };
  world.admin = (method, path, body, token = ADMIN_TOKEN) =>
    app.fetch(new Request(`${SITE}/api${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) })).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
  /** A public request from the For builders form (no cookie, no CSRF header, like the real page). */
  world.request = (over = {}, ip = '203.0.113.5') =>
    app.fetch(new Request(`${SITE}/api/portal/trial-request`, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, origin: SITE }, body: JSON.stringify(formBody(over)) })).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
  /** Request, approve, sign the new admin in and past the forced password change. */
  world.trialOrg = async (over = {}) => {
    const rq = await world.request(over, `198.51.100.${Math.floor(Math.random() * 200)}`);
    assert.ok([200, 201].includes(rq.status), JSON.stringify(rq.data));
    const list = (await world.admin('GET', '/portal/admin/trial-requests?status=pending')).data;
    const q = list.find((x) => x.email === (over.email || 'jo@coastalhomes.example'));
    const ap = await world.admin('POST', `/portal/admin/trial-requests/${q.id}/approve`, {});
    assert.equal(ap.status, 201, JSON.stringify(ap.data));
    const b = world.browser();
    assert.equal((await b.post('/portal/session', { identifier: ap.data.credentials.username, password: ap.data.credentials.password })).status, 200);
    assert.equal((await b.post('/portal/password', { currentPassword: ap.data.credentials.password, newPassword: 'Correct-Horse-Battery-9' })).status, 200);
    return { orgId: ap.data.org.id, admin: b, approval: ap.data, request: q, adminUser: ap.data.admin, relogin: async () => { const nb = world.browser(); assert.equal((await nb.post('/portal/session', { identifier: ap.data.admin.username, password: 'Correct-Horse-Battery-9' })).status, 200); return nb; } };
  };
  world.webhook = async (event) => {
    const raw = JSON.stringify(event);
    const t = Math.floor(clock.t / 1000);
    const sig = hex(await hmacSha256(WHSEC, `${t}.${raw}`));
    const res = await app.fetch(new Request(`${SITE}/api/stripe/webhook`, { method: 'POST', body: raw, headers: { 'stripe-signature': `t=${t},v1=${sig}`, 'content-type': 'application/json' } }));
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return world;
}

function formBody(over = {}) {
  return {
    companyLegalName: 'Coastal Homes Pty Ltd', abn: ABNS[0], tradingName: 'Coastal Homes', firstName: 'Jo', lastName: 'Marsh', email: 'jo@coastalhomes.example',
    mobile: '0412 345 678', region: 'Mid North Coast', homesPerYear: 24, howHeard: 'Google', consent: true, website: '', ...over,
  };
}
/** A completed setup session for the org's Stripe customer (the org must have started the setup, which creates the customer). */
const setupSession = async (w, orgId, over = {}) => ({ id: 'cs_test_setup1', mode: 'setup', status: 'complete', customer: (await w.pstore.getOrg(orgId)).stripeCustomerId, setup_intent: 'seti_test_1', client_reference_id: orgId, metadata: { org_id: orgId, purpose: 'gi_card_setup' }, customer_details: { name: 'Jo Marsh', email: 'jo@coastalhomes.example', phone: '+61412345678' }, ...over });

// Pure helpers ------------------------------------------------------------------------------------------------------------------
test('trial end is 00:00 Sydney on approval date + 14 days, also across daylight saving', () => {
  assert.equal(ddmmyyyyTime(Date.parse(trialEndFor(T0))), '25/11/2026 00:00');
  // Approved 25/09/2026 (AEST). 09/10/2026 is after daylight saving starts on 04/10/2026: midnight is 13:00 UTC the day before.
  const across = Date.UTC(2026, 8, 25, 3, 0, 0);
  assert.equal(trialEndFor(across), '2026-10-08T13:00:00.000Z');
  assert.equal(ddmmyyyyTime(Date.parse(trialEndFor(across))), '09/10/2026 00:00');
  // Approved at 23:50 Sydney on 31/03/2027 (AEDT, 12:50 UTC): the Sydney date is 31/03, so the end is 14/04/2027 00:00 (after AEST began on 04/04).
  assert.equal(ddmmyyyyTime(Date.parse(trialEndFor(Date.UTC(2027, 2, 31, 12, 50)))), '14/04/2027 00:00');
  // Approved 00:10 Sydney on 12/11/2026 (13:10 UTC on 11/11) counts as 12/11, not 11/11.
  assert.equal(ddmmyyyyTime(Date.parse(trialEndFor(Date.UTC(2026, 10, 11, 13, 10)))), '26/11/2026 00:00');
  assert.equal(ddmmyyyyTime(sydneyDayStartPlus(T0, 0)), '11/11/2026 00:00');
});

test('orgState: trial, the last minute, trial_ended, extension and legacy orgs', () => {
  const org = { status: 'trial', trialEndsAt: trialEndFor(T0) };
  const end = Date.parse(org.trialEndsAt);
  assert.equal(orgState(org, T0).status, 'trial');
  assert.equal(orgState(org, T0).daysLeft, 14);
  assert.equal(orgState(org, end - 60000).status, 'trial', 'the last minute is still the trial');
  assert.equal(orgState(org, end - 60000).daysLeft, 1);
  assert.equal(orgState(org, end - 60000).lastTrialDay, '24/11/2026');
  const over = orgState(org, end);
  assert.equal(over.status, 'trial_ended');
  assert.equal(over.readOnly, true);
  assert.equal(over.canExport, false);
  assert.ok(over.dataKeptUntil.startsWith('2027-02-22'), over.dataKeptUntil);
  assert.equal(orgState({ status: 'active' }, end + 400 * DAY).readOnly, false);
  assert.equal(orgState({}, T0).status, 'active', 'an org created before trials existed is active');
  assert.equal(orgState({ status: 'read_only' }, T0).readOnly, true);
  assert.equal(ddmmyyyyTime(Date.parse(extendedEnd(org, T0))), '02/12/2026 00:00', 'a running trial moves on by 7 days');
  assert.equal(ddmmyyyyTime(Date.parse(extendedEnd(org, end + 3 * DAY + 5 * 3600000))), '05/12/2026 00:00', 'an ended trial restarts from today (28/11 + 7)');
});

test('notification text goes to the owner, links the admin page and says nothing was sent to the builder', () => {
  const t = notificationText({ companyLegalName: 'Coastal Homes Pty Ltd', abn: '51 824 753 556', firstName: 'Jo', lastName: 'Marsh', email: 'jo@x.example', mobile: '0412 345 678', region: 'Mid North Coast', homesPerYear: 24, howHeard: '', tradingName: '' }, { siteUrl: 'https://glideinside.com.au' });
  assert.match(t, /https:\/\/glideinside\.com\.au\/portal\/admin\//);
  assert.match(t, /Nothing has been sent to the builder/);
  assert.ok(!/[–—]/.test(t), 'no em or en dashes');
});

const stores = [['memory', false]];
if (DatabaseSync) stores.push(['D1 (SQLite shim)', true]);

for (const [label, d1] of stores) {
  const t = (name, fn) => test(`${label}: ${name}`, () => fn());

  t('trial request: validation, ABN checksum, honeypot, duplicate ABN, stored as pending, no email to the builder', async () => {
    const w = makeWorld({ d1 });
    const bad = async (over, re) => {
      const r = await w.request(over);
      assert.equal(r.status, 400, JSON.stringify(over));
      assert.match(r.data.error.message, re);
    };
    await bad({ consent: false }, /tick the box/);
    await bad({ consent: undefined }, /tick the box/);
    await bad({ abn: '51 824 753 557' }, /ABN/);
    await bad({ abn: '' }, /ABN/);
    await bad({ abn: 'abc' }, /ABN/);
    await bad({ companyLegalName: ' ' }, /legal name is required/);
    await bad({ firstName: '' }, /First name is required/);
    await bad({ lastName: '' }, /Last name is required/);
    await bad({ email: 'nope' }, /email/);
    await bad({ mobile: '12' }, /mobile/);
    await bad({ region: '' }, /Region is required/);
    await bad({ homesPerYear: 'lots' }, /whole number/);
    await bad({ homesPerYear: -4 }, /whole number/);
    await bad({ companyLegalName: 'x'.repeat(200) }, /too long/);
    assert.equal((await w.admin('GET', '/portal/admin/trial-requests')).data.length, 0, 'nothing is stored for a bad request');

    const ok = await w.request({ homesPerYear: '', tradingName: '', howHeard: '' });
    assert.equal(ok.status, 201);
    assert.equal(ok.data.message, 'Thanks, we will be in touch within one business day.');
    const [q] = (await w.admin('GET', '/portal/admin/trial-requests')).data;
    assert.equal(q.status, 'pending');
    assert.equal(q.abn, '51 824 753 556');
    assert.equal(q.email, 'jo@coastalhomes.example');
    assert.equal(q.homesPerYear, null);
    assert.equal(q.termsVersion, '11/11/2026');
    assert.ok(q.consentAt);
    assert.ok(!('ipHash' in q), 'the IP hash is not sent to the admin page');
    assert.equal(w.resend.calls.length, 0, 'no email without RESEND_API_KEY');

    // Honeypot: a filled hidden field looks like success and stores nothing.
    const bot = await w.request({ website: 'http://spam.example', abn: ABNS[1], email: 'bot@x.example' });
    assert.equal(bot.status, 200);
    assert.equal((await w.admin('GET', '/portal/admin/trial-requests')).data.length, 1);
    // The same ABN while a request is open: answered the same way, no second row.
    const dup = await w.request({ email: 'other@coastalhomes.example' });
    assert.equal(dup.status, 200);
    assert.equal((await w.admin('GET', '/portal/admin/trial-requests')).data.length, 1);
    // Works while the portal is still closed (requests are collected before logins open).
    const closed = makeWorld({ d1, env: { PORTAL_ENABLED: '' } });
    assert.equal((await closed.request()).status, 201);
  });

  t('trial request: rate limited per address (5 an hour) and per email (3 a day)', async () => {
    const w = makeWorld({ d1 });
    for (let i = 0; i < 5; i += 1) assert.equal((await w.request({ abn: ABNS[i], email: `p${i}@x.example` }, '203.0.113.9')).status, 201);
    const sixth = await w.request({ abn: ABNS[5], email: 'p5@x.example' }, '203.0.113.9');
    assert.equal(sixth.status, 429);
    assert.equal(sixth.data.error.code, 'RATE_LIMITED');
    assert.equal((await w.request({ abn: ABNS[6], email: 'p6@x.example' }, '203.0.113.10')).status, 201, 'another address is unaffected');
    const w2 = makeWorld({ d1 });
    for (let i = 0; i < 3; i += 1) assert.equal((await w2.request({ abn: ABNS[10 + i], email: 'same@x.example' }, `203.0.113.${20 + i}`)).status, 201);
    assert.equal((await w2.request({ abn: ABNS[14], email: 'same@x.example' }, '203.0.113.99')).status, 429, 'the fourth for one email in a day');
    w2.clock.t += DAY + 60000;
    assert.equal((await w2.request({ abn: ABNS[15], email: 'same@x.example' }, '203.0.113.98')).status, 201, 'the window passes');
  });

  t('owner notification: only to TRIAL_NOTIFY_TO through Resend, silent when unset or off, a failure never loses the request', async () => {
    // Unset RESEND_API_KEY: skipped.
    const none = makeWorld({ d1 });
    await none.request();
    assert.equal(none.resend.calls.length, 0);
    assert.equal((await none.admin('GET', '/portal/admin/trial-requests')).data[0].notifyStatus, 'skipped');
    // Key set, default recipient.
    const w = makeWorld({ d1, env: { RESEND_API_KEY: 're_test', ENQUIRY_FROM: 'Glide Inside <plans@glideinside.com.au>' } });
    assert.equal((await w.request()).status, 201);
    assert.equal(w.resend.calls.length, 1);
    const c = w.resend.calls[0].body;
    assert.deepEqual(c.to, ['hello@glideinside.com.au']);
    assert.equal(c.subject, 'Trial request: Coastal Homes Pty Ltd');
    assert.match(c.text, /Review and approve or decline: https:\/\/site\.test\/portal\/admin\//);
    assert.match(c.text, /51 824 753 556/);
    assert.ok(!JSON.stringify(c).includes('jo@coastalhomes.example') || !c.to.includes('jo@coastalhomes.example'), 'the builder is not a recipient');
    assert.equal(c.reply_to, undefined);
    assert.equal((await w.admin('GET', '/portal/admin/trial-requests')).data[0].notifyStatus, 'sent');
    // Custom recipient; empty recipient and TRIAL_NOTIFY=0 skip silently.
    const custom = makeWorld({ d1, env: { RESEND_API_KEY: 're_test', TRIAL_NOTIFY_TO: 'owner@jce.example' } });
    await custom.request();
    assert.deepEqual(custom.resend.calls[0].body.to, ['owner@jce.example']);
    const empty = makeWorld({ d1, env: { RESEND_API_KEY: 're_test', TRIAL_NOTIFY_TO: '' } });
    assert.equal((await empty.request()).status, 201);
    assert.equal(empty.resend.calls.length, 0);
    const off = makeWorld({ d1, env: { RESEND_API_KEY: 're_test', TRIAL_NOTIFY: '0' } });
    assert.equal((await off.request()).status, 201);
    assert.equal(off.resend.calls.length, 0);
    // Resend down: the request is still saved and the visitor still sees success.
    const down = makeWorld({ d1, env: { RESEND_API_KEY: 're_test' } });
    down.resend.fail = true;
    assert.equal((await down.request()).status, 201);
    const [q] = (await down.admin('GET', '/portal/admin/trial-requests')).data;
    assert.equal(q.status, 'pending');
    assert.equal(q.notifyStatus, 'failed');
  });

  t('approve: needs ADMIN_TOKEN, creates the org and its first admin once, trial 14 days, decline keeps a note, double approve refused', async () => {
    const w = makeWorld({ d1 });
    await w.request();
    const [q] = (await w.admin('GET', '/portal/admin/trial-requests?status=pending')).data;
    assert.equal((await w.admin('POST', `/portal/admin/trial-requests/${q.id}/approve`, {}, 'wrong')).status, 401);
    assert.equal((await w.admin('GET', '/portal/admin/trial-requests', undefined, '')).status, 401);
    const ap = await w.admin('POST', `/portal/admin/trial-requests/${q.id}/approve`, {});
    assert.equal(ap.status, 201, JSON.stringify(ap.data));
    assert.match(ap.data.credentials.username, /^jo-[2-9]{4}$/);
    assert.match(ap.data.credentials.password, /^[a-z]+-[a-z]+-[2-9]{2}$/);
    assert.equal(ap.data.admin.role, 'admin');
    assert.equal(ap.data.org.account.status, 'trial');
    assert.equal(ap.data.org.account.trialEndsAt, '2026-11-24T13:00:00.000Z', '25/11/2026 00:00 Sydney');
    assert.equal(ap.data.org.account.daysLeft, 14);
    assert.equal(ap.data.org.legalName, 'Coastal Homes Pty Ltd');
    assert.equal(ap.data.org.abn, '51 824 753 556');
    assert.equal(ap.data.org.name, 'Coastal Homes');
    assert.equal(ap.data.org.billingContact.email, 'jo@coastalhomes.example');
    assert.ok(!JSON.stringify(ap.data).includes('passwordHash'));
    // The credentials are shown once: the listings never carry them.
    const lists = JSON.stringify([(await w.admin('GET', '/portal/admin/trial-requests')).data, (await w.admin('GET', '/portal/admin/orgs')).data]);
    assert.ok(!lists.includes(ap.data.credentials.password));
    const [approved] = (await w.admin('GET', '/portal/admin/trial-requests?status=approved')).data;
    assert.equal(approved.orgId, ap.data.org.id);
    assert.equal((await w.admin('POST', `/portal/admin/trial-requests/${q.id}/approve`, {})).status, 409, 'approving twice is refused');
    assert.equal((await w.admin('POST', `/portal/admin/trial-requests/${q.id}/decline`, { note: 'x' })).status, 409);
    // The new admin signs in with the temporary password and must change it.
    const b = w.browser();
    const me = await b.post('/portal/session', { identifier: ap.data.credentials.username, password: ap.data.credentials.password });
    assert.equal(me.data.user.mustChangePassword, true);
    assert.equal(me.data.account.status, 'trial');
    assert.equal(me.data.account.daysLeft, 14);
    // Decline.
    await w.request({ abn: ABNS[2], email: 'dee@other.example', companyLegalName: 'Other Builders' });
    const pending = (await w.admin('GET', '/portal/admin/trial-requests?status=pending')).data;
    assert.equal(pending.length, 1);
    const dec = await w.admin('POST', `/portal/admin/trial-requests/${pending[0].id}/decline`, { note: 'Not building in our regions' });
    assert.equal(dec.status, 200);
    assert.equal(dec.data.status, 'declined');
    assert.equal(dec.data.decisionNote, 'Not building in our regions');
    assert.equal((await w.admin('GET', '/portal/admin/trial-requests?status=declined')).data.length, 1);
    assert.equal((await w.admin('GET', '/portal/admin/orgs')).data.length, 1, 'declining creates no org');
    // An email address that already has a login blocks the approval and leaves the request pending.
    await w.request({ abn: ABNS[3], email: 'jo@coastalhomes.example', companyLegalName: 'Third Pty Ltd' }, '203.0.113.77');
    const third = (await w.admin('GET', '/portal/admin/trial-requests?status=pending')).data[0];
    const clash = await w.admin('POST', `/portal/admin/trial-requests/${third.id}/approve`, {});
    assert.equal(clash.status, 409);
    assert.equal((await w.admin('GET', '/portal/admin/trial-requests?status=pending')).data.length, 1);
  });

  t('during the trial: staff use everything, client logins and top-ups are refused with a clear message', async () => {
    const w = makeWorld({ d1 });
    const org = await w.trialOrg();
    const me = (await org.admin.get('/portal/me')).data;
    assert.deepEqual(me.exports, ['pdf', 'dxf', 'glb', 'obj', 'html'], 'PDF and DXF exports are allowed');
    assert.equal(me.enquiry, true, 'Send to JCE is allowed');
    assert.equal(me.canTopUp, false);
    assert.equal(me.account.status, 'trial');
    assert.equal(me.account.canIssueClients, false);
    assert.equal(me.ai.monthlyCap, 300, 'the monthly AI allowance applies');
    // Everything else works: house library, Glide library, branding, projects.
    assert.equal((await org.admin.get('/portal/glide-library')).status, 200);
    const glide = (await org.admin.get('/portal/glide-library')).data[0];
    assert.equal((await org.admin.post('/portal/houses', { fromGlideId: glide.id })).status, 200);
    assert.equal((await org.admin.get('/portal/houses')).data.length, 1);
    assert.equal((await org.admin.put('/portal/org/branding', { displayName: 'Coastal Homes' })).status, 200);
    assert.equal((await org.admin.post('/portal/ai/token')).status, 200);
    // Client logins: refused.
    const issue = await org.admin.post('/portal/clients', { firstName: 'Sarah' });
    assert.equal(issue.status, 403);
    assert.equal(issue.data.error.code, 'TRIAL_NO_CLIENTS');
    assert.match(issue.data.error.message, /Client logins unlock when you add billing details/);
    // A client row that exists (for example moved across) cannot be reset or enabled either.
    const cu = { id: 'u_c1', orgId: org.orgId, role: 'client', name: 'Sam', email: null, username: 'sam-2222', passwordHash: 'x', mustChangePassword: true, status: 'disabled', houseAccess: 'all', createdAt: new Date(w.clock.t).toISOString() };
    assert.equal(await w.pstore.createUser(cu), true);
    for (const path of ['/portal/clients/u_c1/reset-password', '/portal/clients/u_c1/enable']) {
      const r = await org.admin.post(path);
      assert.equal(r.status, 403, path);
      assert.equal(r.data.error.code, 'TRIAL_NO_CLIENTS', path);
    }
    // AI top-ups are disabled in the trial, in both places they exist.
    const top = await org.admin.post('/portal/ai/top-up');
    assert.equal(top.status, 403);
    assert.equal(top.data.error.code, 'TRIAL_NO_TOPUPS');
    const token = (await org.admin.post('/portal/ai/token')).data.token;
    const legacy = await w.app.fetch(new Request(`${SITE}/api/ai/topup`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' }));
    assert.equal(legacy.status, 403);
    assert.equal((await legacy.json()).error.code, 'TRIAL_NO_TOPUPS');
    assert.equal((await w.store.listEvents('ai_topup')).length, 0, 'no top-up was recorded or billed');
    // Billing tab data is readable and the org shows as a trial to the owner.
    const [row] = (await w.admin('GET', '/portal/admin/orgs')).data;
    assert.equal(row.account.status, 'trial');
    assert.equal(row.clientLogins.issued, 0);
    assert.equal(row.admin.username, org.adminUser.username);
  });

  t('after the trial: read only (reads work, writes 403 READ_ONLY), sign in and billing details still work, exports and AI stop', async () => {
    const w = makeWorld({ d1 });
    const org = await w.trialOrg();
    const glide = (await org.admin.get('/portal/glide-library')).data[0];
    const house = (await org.admin.post('/portal/houses', { fromGlideId: glide.id })).data;
    const token = (await org.admin.post('/portal/ai/token')).data.token;
    const end = Date.parse(org.approval.org.account.trialEndsAt);
    // One minute before the end it is still the trial.
    w.clock.t = end - 60000;
    assert.equal((await org.admin.get('/portal/me')).data.account.status, 'trial');
    assert.equal((await org.admin.post('/portal/houses', { fromGlideId: glide.id, name: 'Second' })).status, 200);
    // At the end (00:00 on 25/11/2026 Sydney) it is read only. The session is still valid, so nobody is signed out.
    w.clock.t = end;
    const me = (await org.admin.get('/portal/me')).data;
    assert.equal(me.account.status, 'trial_ended');
    assert.equal(me.account.readOnly, true);
    assert.deepEqual(me.exports, [], 'no new exports');
    assert.equal(me.enquiry, false);
    assert.equal(me.canTopUp, false);
    // Reads work.
    assert.equal((await org.admin.get('/portal/houses')).status, 200);
    assert.equal((await org.admin.get(`/portal/houses/${house.id}`)).status, 200);
    assert.equal((await org.admin.get('/portal/projects')).status, 200);
    assert.equal((await org.admin.get('/portal/billing/usage')).status, 200);
    assert.equal((await org.admin.get('/portal/team')).status, 200);
    assert.equal((await org.admin.get('/portal/ai')).status, 200);
    // Every state changing route is refused.
    const blocked = [
      ['post', '/portal/houses', { fromGlideId: glide.id, name: 'Third' }], ['post', `/portal/houses/${house.id}/duplicate`], ['post', `/portal/houses/${house.id}/archive`, { archived: true }],
      ['post', '/portal/projects', { name: 'x', project: {} }], ['post', '/portal/clients', { firstName: 'Sarah' }], ['post', '/portal/team', { firstName: 'Tom', role: 'designer' }],
      ['put', '/portal/org/branding', { displayName: 'X' }], ['post', '/portal/ai/top-up'], ['post', '/portal/ai/token'],
    ];
    for (const [m, path, body] of blocked) {
      const r = await org.admin[m](path, ...(body === undefined ? [] : [body]));
      assert.equal(r.status, 403, `${m} ${path}`);
      assert.equal(r.data.error.code, 'READ_ONLY', `${m} ${path}`);
    }
    const patch = await org.admin.call('PATCH', '/portal/org/settings', { allowClientTopUps: false });
    assert.equal(patch.data.error.code, 'READ_ONLY');
    assert.match((await org.admin.post('/portal/houses', { fromGlideId: glide.id })).data.error.message, /free trial has ended.*read only/);
    // The AI helper endpoints refuse the org token that was issued earlier.
    const ai = await w.app.fetch(new Request(`${SITE}/api/ai/edit`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'hi', context: '{}' }) }));
    assert.ok([403, 503].includes(ai.status));
    const aiErr = await ai.json();
    assert.ok(['READ_ONLY', 'AI_NOT_CONFIGURED'].includes(aiErr.error.code), aiErr.error.code);
    // Signing in, changing the password and saving billing details are still possible.
    const nb = await org.relogin();
    assert.equal((await nb.get('/portal/me')).status, 200);
    assert.equal((await nb.post('/portal/password', { currentPassword: 'Correct-Horse-Battery-9', newPassword: 'Another-Long-Pass-77' })).status, 200);
    const contact = { name: 'Jo Marsh', email: 'jo@coastalhomes.example', phone: '0412 345 678', legalName: 'Coastal Homes Pty Ltd', abn: ABNS[0] };
    assert.equal((await nb.put('/portal/billing/contact', contact)).status, 200);
    // The owner sees it as trial ended, with the data retention date.
    const [row] = (await w.admin('GET', '/portal/admin/orgs')).data;
    assert.equal(row.account.status, 'trial_ended');
    assert.ok(row.account.dataKeptUntil.startsWith('2027-02-22'));
    // The Sydney date maths hold for a trial approved before daylight saving began.
    const w2 = makeWorld({ d1 });
    w2.clock.t = Date.UTC(2026, 8, 25, 3, 0, 0);
    const o2 = await w2.trialOrg();
    w2.clock.t = Date.UTC(2026, 9, 8, 12, 59);
    assert.equal((await o2.admin.get('/portal/me')).data.account.status, 'trial', '09/10/2026 23:59 AEST/AEDT boundary: 12:59 UTC on 08/10 is 23:59 on 08/10 Sydney');
    w2.clock.t = Date.UTC(2026, 9, 8, 13, 0);
    assert.equal((await o2.admin.get('/portal/me')).data.account.status, 'trial_ended');
  });

  t('extend by 7 days and convert manually', async () => {
    const w = makeWorld({ d1 });
    const org = await w.trialOrg();
    const end = Date.parse(org.approval.org.account.trialEndsAt);
    w.clock.t = end + 3 * DAY + 5 * 3600000; // 28/11/2026 Sydney, trial over
    assert.equal((await org.admin.post('/portal/houses', { fromGlideId: (await org.admin.get('/portal/glide-library')).data[0].id })).data.error.code, 'READ_ONLY');
    const ex = await w.admin('POST', `/portal/admin/orgs/${org.orgId}/extend-trial`, {});
    assert.equal(ex.status, 200);
    assert.equal(ex.data.account.status, 'trial');
    assert.equal(ddmmyyyyTime(Date.parse(ex.data.account.trialEndsAt)), '05/12/2026 00:00');
    assert.equal(ex.data.trialExtendedDays, 7);
    assert.equal((await org.admin.post('/portal/houses', { fromGlideId: (await org.admin.get('/portal/glide-library')).data[0].id })).status, 200, 'writable again');
    const ex2 = await w.admin('POST', `/portal/admin/orgs/${org.orgId}/extend-trial`, {});
    assert.equal(ddmmyyyyTime(Date.parse(ex2.data.account.trialEndsAt)), '12/12/2026 00:00', 'a running trial moves on from its end date');
    // Convert to paid manually: client logins unlock, no card needed.
    assert.equal((await org.admin.post('/portal/clients', { firstName: 'Sarah' })).status, 403);
    const cv = await w.admin('POST', `/portal/admin/orgs/${org.orgId}/convert`, { note: 'Paid by bank transfer' });
    assert.equal(cv.status, 200);
    assert.equal(cv.data.account.status, 'active');
    assert.equal(cv.data.convertedHow, 'manual');
    assert.equal((await org.admin.post('/portal/clients', { firstName: 'Sarah' })).status, 201);
    assert.equal((await org.admin.post('/portal/ai/top-up')).status, 200);
    assert.equal((await w.admin('POST', `/portal/admin/orgs/${org.orgId}/extend-trial`, {})).status, 409, 'an active org has no trial to extend');
    assert.equal((await w.admin('POST', '/portal/admin/orgs/org_nope/convert', {})).status, 404);
    // Reset the first admin's password (the first one is shown once).
    const rp = await w.admin('POST', `/portal/admin/orgs/${org.orgId}/reset-admin`, {});
    assert.equal(rp.status, 200);
    assert.match(rp.data.credentials.password, /^[a-z]+-[a-z]+-[2-9]{2}$/);
    assert.equal((await w.browser().post('/portal/session', { identifier: rp.data.credentials.username, password: rp.data.credentials.password })).status, 200);
  });

  t('card capture: Checkout session in setup mode, webhook activates the org and stores the card, then client logins unlock', async () => {
    const w = makeWorld({ d1 });
    const org = await w.trialOrg();
    // Billing details were prefilled from the request, so the builder can go straight to Stripe.
    const start = await org.admin.post('/portal/billing/setup');
    assert.equal(start.status, 200, JSON.stringify(start.data));
    assert.equal(start.data.url, 'https://checkout.stripe.com/c/pay/cs_test_setup1');
    const cust = w.stripe.calls.find((c) => c.path === '/customers');
    assert.equal(cust.form.name, 'Coastal Homes Pty Ltd');
    assert.equal(cust.form['metadata[abn]'], '51 824 753 556');
    const sess = w.stripe.calls.find((c) => c.path === '/checkout/sessions');
    assert.equal(sess.form.mode, 'setup');
    assert.equal(sess.form.customer, 'cus_test_1');
    assert.equal(sess.form['payment_method_types[0]'], 'card');
    assert.equal(sess.form['metadata[org_id]'], org.orgId);
    assert.equal(sess.form.success_url, `${SITE}/portal/?billing=success&session_id={CHECKOUT_SESSION_ID}#/billing`);
    assert.equal(sess.form.cancel_url, `${SITE}/portal/?billing=cancel#/billing`);
    assert.match(sess.headers.authorization, /^Bearer sk_test_/);
    assert.equal((await org.admin.post('/portal/clients', { firstName: 'Sarah' })).status, 403, 'still a trial until Stripe confirms the card');
    // Staff other than an admin cannot start it; a read only org still can.
    const bad = await w.browser().post('/portal/billing/setup');
    assert.equal(bad.status, 401);

    const event = { id: 'evt_setup_1', type: 'checkout.session.completed', data: { object: await setupSession(w, org.orgId) } };
    const hook = await w.webhook(event);
    assert.equal(hook.status, 200, JSON.stringify(hook.data));
    const si = w.stripe.calls.find((c) => c.path === '/setup_intents/seti_test_1');
    assert.match(si.query, /expand\[\]=payment_method/);
    const def = w.stripe.calls.find((c) => c.method === 'POST' && c.path === '/customers/cus_test_1');
    assert.equal(def.form['invoice_settings[default_payment_method]'], 'pm_test_1', 'the card is stored as the customer default');
    const me = (await org.admin.get('/portal/me')).data;
    assert.equal(me.account.status, 'active');
    assert.equal(me.account.cardOnFile, true);
    assert.deepEqual(me.account.card, { brand: 'visa', last4: '4242' });
    assert.ok(!JSON.stringify(me).includes('pm_test_1'), 'the payment method id is never sent to the browser');
    assert.equal(me.canTopUp, true);
    assert.equal((await org.admin.get('/portal/billing/contact')).data.email, 'jo@coastalhomes.example', 'the saved billing contact is kept');
    assert.equal((await org.admin.post('/portal/clients', { firstName: 'Sarah' })).status, 201, 'client logins unlock');
    assert.equal((await w.admin('GET', '/portal/admin/orgs')).data[0].convertedHow, 'card');
    // Stripe retries are harmless.
    const again = await w.webhook(event);
    assert.equal(again.data.duplicate, true);
    // A setup session for another organisation or an unfinished intent changes nothing.
    const other = await w.trialOrg({ abn: ABNS[7], email: 'ann@other.example', companyLegalName: 'Other Pty Ltd' });
    assert.equal((await other.admin.post('/portal/billing/setup')).status, 200);
    w.stripe.setupStatus = 'requires_payment_method';
    assert.equal((await w.webhook({ id: 'evt_setup_2', type: 'checkout.session.completed', data: { object: await setupSession(w, other.orgId) } })).status, 200);
    assert.equal((await other.admin.get('/portal/me')).data.account.status, 'trial');
    w.stripe.setupStatus = 'succeeded';
    assert.equal((await w.webhook({ id: 'evt_setup_3', type: 'checkout.session.completed', data: { object: await setupSession(w, other.orgId, { customer: 'cus_someone_else' }) } })).status, 200);
    assert.equal((await other.admin.get('/portal/me')).data.account.status, 'trial', 'a customer that is not this organisation is ignored');
    // The Plan Pack webhook path still ignores unpaid sessions.
    assert.equal((await w.webhook({ id: 'evt_pp_1', type: 'checkout.session.completed', data: { object: { id: 'cs_x', mode: 'payment', payment_status: 'unpaid' } } })).status, 200);
  });

  t('card capture also completes through the return page (confirm) when the webhook is slow, and unlocks a read only account', async () => {
    const w = makeWorld({ d1 });
    const org = await w.trialOrg();
    w.clock.t = Date.parse(org.approval.org.account.trialEndsAt) + DAY;
    assert.equal((await org.admin.get('/portal/me')).data.account.status, 'trial_ended');
    await org.admin.post('/portal/billing/setup'); // allowed while read only
    assert.equal((await org.admin.post('/portal/billing/setup/confirm', { sessionId: 'cs_test_setup1' })).status, 404, 'unknown session');
    w.stripe.sessions.cs_test_setup1 = await setupSession(w, org.orgId);
    assert.equal((await org.admin.post('/portal/billing/setup/confirm', { sessionId: 'not-a-session' })).status, 400);
    const ok = await org.admin.post('/portal/billing/setup/confirm', { sessionId: 'cs_test_setup1' });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.account.status, 'active');
    assert.equal((await org.admin.post('/portal/houses', { fromGlideId: (await org.admin.get('/portal/glide-library')).data[0].id })).status, 200, 'writes work again');
    // Another org cannot confirm this session.
    const other = await w.trialOrg({ abn: ABNS[8], email: 'bo@other.example', companyLegalName: 'Bo Pty Ltd' });
    assert.equal((await other.admin.post('/portal/billing/setup/confirm', { sessionId: 'cs_test_setup1' })).status, 404);
  });

  t('billing details are required before Checkout starts', async () => {
    const w = makeWorld({ d1 });
    const org = await w.trialOrg();
    await w.pstore.updateOrg(org.orgId, { abn: null });
    const r = await org.admin.post('/portal/billing/setup');
    assert.equal(r.status, 400);
    assert.match(r.data.error.message, /legal business name, ABN and billing email/);
    assert.equal(w.stripe.calls.length, 0);
  });

  t('monthly charge with a saved card: charge_automatically invoice paid at once, tax invoice keeps seller and buyer ABN, no email from Stripe', async () => {
    const w = makeWorld({ d1 });
    const org = await w.trialOrg();
    await org.admin.post('/portal/billing/setup');
    await w.webhook({ id: 'evt_c1', type: 'checkout.session.completed', data: { object: await setupSession(w, org.orgId) } });
    const issued = await org.admin.post('/portal/clients', { firstName: 'Sarah' });
    assert.equal(issued.status, 201);
    assert.equal((await w.browser().post('/portal/session', { identifier: issued.data.credentials.username, password: issued.data.credentials.password })).status, 200);
    await org.admin.post('/portal/ai/top-up');
    // 01/12/2026 06:00 Sydney: the cron handler runs the month end job.
    w.clock.t = Date.UTC(2026, 10, 30, 19, 0);
    w.stripe.calls.length = 0;
    const run = await w.app.scheduled();
    assert.equal(run.month, '2026-11');
    assert.equal(run.results[0].status, 'issued');
    assert.equal(run.results[0].payment, 'card_paid');
    const create = w.stripe.calls.find((c) => c.method === 'POST' && c.path === '/invoices');
    assert.equal(create.form.collection_method, 'charge_automatically');
    assert.equal(create.form.default_payment_method, 'pm_test_1');
    assert.equal(create.form.days_until_due, undefined);
    assert.equal(create.form['custom_fields[0][value]'], '29 699 165 663', 'seller ABN');
    assert.equal(create.form['custom_fields[1][value]'], '51 824 753 556', 'buyer ABN');
    const pay = w.stripe.calls.find((c) => c.path === '/invoices/in_test_1/pay');
    assert.equal(pay.form.payment_method, 'pm_test_1');
    assert.equal(pay.form.off_session, 'true');
    assert.equal(w.stripe.calls.some((c) => /\/send$/.test(c.path)), false, 'a card invoice is not sent by Stripe');
    const items = w.stripe.calls.filter((c) => c.path === '/invoiceitems' && c.method === 'POST');
    assert.equal(items.length, 2);
    const [inv] = (await org.admin.get('/portal/billing/invoices')).data;
    assert.equal(inv.status, 'paid');
    assert.equal(inv.totalCents, 4500);
    const full = (await org.admin.get(`/portal/billing/invoices/${inv.id}`)).data;
    assert.equal(full.seller.name, 'JCE Infrastructure Pty Ltd trading as Glide Inside');
    assert.equal(full.seller.abn, '29 699 165 663');
    assert.equal(full.buyer.legalName, 'Coastal Homes Pty Ltd');
    assert.equal(full.buyer.abn, '51 824 753 556');
    assert.deepEqual(full.payment, { method: 'card', brand: 'visa', last4: '4242' });
    assert.equal(full.gstCents, 409);
    // Running the month again changes nothing.
    w.stripe.calls.length = 0;
    assert.equal((await w.app.scheduled()).results[0].status, 'exists');
    assert.equal(w.stripe.calls.length, 0);
    // The owner sees client logins issued, AI use and the invoice.
    const [row] = (await w.admin('GET', '/portal/admin/orgs')).data;
    assert.deepEqual(row.clientLogins, { generated: 1, issued: 1, firstSignedIn: 1 });
    assert.equal(row.ai.topUps, 0, 'the top-up was last month, so none is counted for December');
    assert.equal(row.invoices[0].status, 'paid');
  });

  t('a declined card leaves the invoice due with the reason, and an org with no card is still invoiced by Stripe as before', async () => {
    const w = makeWorld({ d1 });
    const org = await w.trialOrg();
    await org.admin.post('/portal/billing/setup');
    await w.webhook({ id: 'evt_c2', type: 'checkout.session.completed', data: { object: await setupSession(w, org.orgId) } });
    const issued = await org.admin.post('/portal/clients', { firstName: 'Sarah' });
    await w.browser().post('/portal/session', { identifier: issued.data.credentials.username, password: issued.data.credentials.password });
    w.clock.t = Date.UTC(2026, 10, 30, 19, 0);
    w.stripe.payResult = 'declined';
    const run = await w.app.scheduled();
    assert.equal(run.results[0].status, 'issued');
    assert.equal(run.results[0].payment, 'card_failed');
    const [inv] = (await org.admin.get('/portal/billing/invoices')).data;
    assert.equal(inv.status, 'due');
    const [row] = (await w.admin('GET', '/portal/admin/orgs')).data;
    assert.match(row.invoices[0].error, /Card payment did not go through: Your card was declined/);
    // Manually converted org (no card): send_invoice, as before.
    const w2 = makeWorld({ d1 });
    const o2 = await w2.trialOrg();
    await w2.admin('POST', `/portal/admin/orgs/${o2.orgId}/convert`, {});
    const c2 = await o2.admin.post('/portal/clients', { firstName: 'Tim' });
    await w2.browser().post('/portal/session', { identifier: c2.data.credentials.username, password: c2.data.credentials.password });
    w2.clock.t = Date.UTC(2026, 10, 30, 19, 0);
    assert.equal((await w2.app.scheduled()).results[0].status, 'issued');
    const create = w2.stripe.calls.find((c) => c.method === 'POST' && c.path === '/invoices');
    assert.equal(create.form.collection_method, 'send_invoice');
    assert.equal(create.form.days_until_due, '14');
    assert.ok(w2.stripe.calls.some((c) => /\/send$/.test(c.path)));
    assert.equal((await o2.admin.get('/portal/billing/invoices')).data[0].status, 'due');
  });

  t('legacy orgs made with the ADMIN_TOKEN job are unaffected: active, client logins allowed', async () => {
    const w = makeWorld({ d1 });
    const r = await w.admin('POST', '/portal/admin/orgs', { name: 'Old Builders', adminFirstName: 'Olga' });
    assert.equal(r.status, 201);
    const b = w.browser();
    await b.post('/portal/session', { identifier: r.data.credentials.username, password: r.data.credentials.password });
    await b.post('/portal/password', { currentPassword: r.data.credentials.password, newPassword: 'Correct-Horse-Battery-9' });
    const me = (await b.get('/portal/me')).data;
    assert.equal(me.account.status, 'active');
    assert.equal(me.account.trialEndsAt, null);
    assert.equal((await b.post('/portal/clients', { firstName: 'Sarah' })).status, 201);
    // Years later it is still active: there is no trial to expire.
    w.clock.t += 20 * DAY;
    assert.equal((await w.browser().get('/portal/me')).status, 401, 'a new browser has no session, but the org has no read only state');
    assert.equal((await b.post('/portal/clients', { firstName: 'Late' })).status, 201);
  });
}
