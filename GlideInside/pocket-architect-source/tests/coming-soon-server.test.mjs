// Migration 0025 and the routes behind the website widget, the lead inbox with its signed webhook and retries, the builder site cost defaults and
// the engineering order requests. Memory store and the SQLite shim of D1 (the same schema.sql the migration mirrors). Nothing is ever emailed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../server/lib/app.js';
import { createMemoryStore, createD1Store } from '../server/lib/store.js';
import { createMemoryPortalStore, createD1PortalStore } from '../server/lib/portal-store.js';
import { createD1LeadsStore, createMemoryLeadsStore } from '../server/lib/leads-store.js';
import { createProject } from '../src/model/schema.js';
import { signWebhook, webhookUrlProblem, originAllowed, cleanOrigin, leadsToCsv, WEBHOOK_MAX_ATTEMPTS } from '../server/lib/leads.js';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* D1 shim skipped */ }
const SITE = 'https://site.test';
const ADMIN_TOKEN = 'admin-token-for-tests-0123456789';
const T0 = Date.UTC(2026, 10, 19, 1, 0, 0);
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const HOUSE = createProject({ name: 'Sample' });

function makeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(read('../server/schema.sql'));
  const norm = (a) => a.map((v) => (v === undefined ? null : v));
  const statement = (sql, args = []) => ({ bind: (...a) => statement(sql, norm(a)), run: async () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...args).changes) } }), first: async () => db.prepare(sql).get(...args) ?? null, all: async () => ({ results: db.prepare(sql).all(...args) }) });
  return { prepare: (sql) => statement(sql), _db: db };
}

function world({ d1 = false, hook = null } = {}) {
  const clock = { t: T0 };
  const db = d1 ? makeD1() : null;
  const outbound = [];
  const fetchImpl = async (url, init) => { outbound.push({ url: String(url), init }); if (hook) return hook(String(url), init, outbound.length); throw new Error(`unexpected network call ${url}`); };
  const lstore = d1 ? createD1LeadsStore(db) : createMemoryLeadsStore();
  const app = createApp({ store: d1 ? createD1Store(db) : createMemoryStore(), portalStore: d1 ? createD1PortalStore(db) : createMemoryPortalStore(), leadsStore: lstore, fetchImpl, now: () => clock.t, env: { SITE_URL: SITE, ENTITLEMENT_SECRET: 'unit-test-secret', PORTAL_ENABLED: '1', ADMIN_TOKEN } });
  const w = { clock, app, outbound, db, lstore };
  w.browser = (ip = '203.0.113.5') => {
    const jar = { cookie: null };
    const call = async (method, path, body, { noCsrf = false, headers = {}, raw = false } = {}) => {
      const h = { origin: SITE, 'cf-connecting-ip': ip, ...headers };
      if (jar.cookie) h.cookie = `gi_session=${jar.cookie}`;
      if (!noCsrf) h['x-gi-request'] = '1';
      if (body !== undefined) h['content-type'] = 'application/json';
      const res = await app.fetch(new Request(`${SITE}/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
      for (const c of res.headers.getSetCookie?.() || []) { const m = /^gi_session=([^;]*)/.exec(c); if (m) jar.cookie = m[1] || null; }
      return { status: res.status, data: raw ? await res.text() : await res.json().catch(() => null), headers: res.headers };
    };
    return { call, get: (p, o) => call('GET', p, undefined, o), post: (p, b, o) => call('POST', p, b ?? {}, o), put: (p, b, o) => call('PUT', p, b, o), patch: (p, b, o) => call('PATCH', p, b, o), del: (p, o) => call('DELETE', p, undefined, o) };
  };
  w.admin = async (method, path, body) => { const r = await app.fetch(new Request(`${SITE}/api${path}`, { method, headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) })); return { status: r.status, data: await r.json().catch(() => null) }; };
  w.makeOrg = async (name, first) => {
    const r = await w.admin('POST', '/portal/admin/orgs', { name, adminFirstName: first, adminEmail: `${first.toLowerCase()}@${name.split(' ')[0].toLowerCase()}.example` });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const b = w.browser('198.51.100.7');
    assert.equal((await b.post('/portal/session', { identifier: r.data.credentials.username, password: r.data.credentials.password })).status, 200);
    assert.equal((await b.post('/portal/password', { currentPassword: r.data.credentials.password, newPassword: 'Correct-Horse-Battery-9' })).status, 200);
    assert.equal((await b.put('/portal/billing/contact', { name: first, email: `accounts@${name.split(' ')[0].toLowerCase()}.example`, phone: '', legalName: name, abn: '51824753556' })).status, 200);
    return { id: r.data.org.id, admin: b };
  };
  return w;
}

async function seedHouse(o, name = 'Banksia 25') {
  const r = await o.admin.post('/portal/houses', { name, project: { ...HOUSE, name } });
  assert.ok(r.status === 200 || r.status === 201, JSON.stringify(r.data));
  return r.data.id;
}

const lead = (extra = {}) => ({ host: 'https://www.builder.example', name: 'Sarah Jones', email: 'Sarah@Example.com', phone: '0412 345 678', address: '22 Banksia Rise, Thornton NSW', lotLabel: 'Lot 14 DP 1234', consent: true, ...extra });

test('migration 0025 is additive and schema.sql carries the same tables', () => {
  const m = read('../server/migrations/0025_widget_leads_orders.sql');
  for (const t of ['widget_settings', 'leads', 'lead_webhooks', 'webhook_deliveries', 'site_cost_defaults', 'engineering_orders']) {
    assert.match(m, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`));
    assert.match(read('../server/schema.sql'), new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`));
  }
  assert.doesNotMatch(m, /DROP|DELETE FROM|UPDATE |ALTER TABLE/i);
});

test('helpers: origins, webhook address rules, signature and CSV formula guard', async () => {
  assert.equal(cleanOrigin('https://www.Example.com.au/page?x=1'), 'https://www.example.com.au');
  assert.equal(cleanOrigin('http://example.com'), null);
  assert.equal(originAllowed(['https://builder.example'], 'https://www.builder.example/x', SITE), true);
  assert.equal(originAllowed(['https://builder.example'], 'https://evil.example', SITE), false);
  assert.equal(originAllowed([], SITE, SITE), true);
  assert.match(webhookUrlProblem('http://hooks.zapier.com/x'), /https/);
  assert.match(webhookUrlProblem('https://127.0.0.1/x'), /public/);
  assert.match(webhookUrlProblem('https://localhost/x'), /public/);
  assert.match(webhookUrlProblem('https://hooks.example.com:8443/x'), /port/);
  assert.equal(webhookUrlProblem('https://hooks.zapier.com/hooks/catch/123/abc/'), null);
  assert.match(await signWebhook('s', 1700000000, '{"a":1}'), /^[0-9a-f]{64}$/);
  const csv = leadsToCsv([{ createdAt: '2026-11-19T01:00:00Z', name: '=HYPERLINK("x")', email: 'a@b.co', phone: '', address: 'A, B', lotLabel: '', houseName: 'H', hostOrigin: '', status: 'new', note: 'line\nbreak', consentAt: '2026-11-19T01:00:00Z', id: 'lead_1' }]);
  assert.match(csv, /^Date,Name,Email/);
  assert.match(csv, /19\/11\/2026,"?'=HYPERLINK/);
  assert.match(csv, /"A, B"/);
  assert.match(csv, /"line\nbreak"/);
});

for (const [label, d1] of [['memory', false], ...(DatabaseSync ? [['D1 (SQLite shim)', true]] : [])]) {
  test(`${label}: widget settings, public config and designs honour the allowed websites`, async () => {
    const w = world({ d1 });
    const o = await w.makeOrg('Hunter Homes', 'Sam');
    const hid = await seedHouse(o);
    const me = (await o.admin.get('/portal/me')).data;
    assert.ok(me.org.id);
    let s = await o.admin.get('/portal/widget');
    assert.equal(s.status, 200);
    assert.equal(s.data.enabled, false);
    const id = s.data.id;
    const anon = w.browser('192.0.2.10');
    assert.equal((await anon.get(`/widget/${id}/config?host=${encodeURIComponent('https://www.builder.example')}`, { noCsrf: true })).status, 404); // off
    assert.equal((await o.admin.put('/portal/widget', { enabled: true, origins: ['www.builder.example', 'not a url ::'] })).status, 400);
    s = await o.admin.put('/portal/widget', { enabled: true, origins: ['https://www.builder.example'], houseIds: [hid, 'house_other'] });
    assert.equal(s.status, 200);
    assert.deepEqual(s.data.origins, ['https://www.builder.example']);
    assert.deepEqual(s.data.houseIds, [hid]);
    const cfg = await anon.get(`/widget/${id}/config?host=${encodeURIComponent('https://builder.example')}`, { noCsrf: true });
    assert.equal(cfg.status, 200, JSON.stringify(cfg.data));
    assert.equal(cfg.data.name, 'Hunter Homes');
    assert.equal(cfg.data.designs.length, 1);
    assert.match(cfg.data.consentText, /Hunter Homes contacting me/);
    assert.equal(cfg.data.designs[0].project, undefined);
    assert.equal((await anon.get(`/widget/${id}/config?host=${encodeURIComponent('https://evil.example')}`, { noCsrf: true })).status, 403);
    assert.equal((await anon.get(`/widget/${id}/config`, { noCsrf: true })).status, 403);
    const des = await anon.get(`/widget/${id}/designs?host=${encodeURIComponent('https://www.builder.example')}`, { noCsrf: true });
    assert.equal(des.status, 200);
    assert.equal(des.data.designs[0].project.name, 'Banksia 25');
    assert.equal((await anon.get('/widget/nobody-here/config?host=https%3A%2F%2Fwww.builder.example', { noCsrf: true })).status, 404);
    // the preview from the Glide Inside site itself is always allowed
    assert.equal((await anon.get(`/widget/${id}/config?host=${encodeURIComponent(SITE)}`, { noCsrf: true })).status, 200);
    assert.deepEqual(w.outbound, []); // nothing sent anywhere
  });

  test(`${label}: a visitor lead is validated, stored against the builder, deduplicated and visible only to that builder`, async () => {
    const w = world({ d1 });
    const a = await w.makeOrg('Hunter Homes', 'Sam');
    const hid = await seedHouse(a);
    const idA = (await a.admin.get('/portal/widget')).data.id;
    await a.admin.put('/portal/widget', { enabled: true, origins: ['https://www.builder.example'], houseIds: [] });
    const anon = w.browser('192.0.2.11');
    const post = (body, id = idA) => anon.post(`/widget/${id}/lead`, body);
    assert.equal((await anon.post(`/widget/${idA}/lead`, lead(), { noCsrf: true })).status, 403); // needs the custom header: no cross site form post
    assert.equal((await post(lead({ consent: false }))).status, 400);
    assert.equal((await post(lead({ email: 'nope' }))).status, 400);
    assert.equal((await post(lead({ name: '' }))).status, 400);
    assert.equal((await post(lead({ phone: 'abc' }))).status, 400);
    assert.equal((await post(lead({ designId: 'house_missing' }))).status, 400);
    assert.equal((await post(lead({ host: 'https://evil.example' }))).status, 403);
    const ok = await post(lead({ designId: hid }));
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.match(ok.data.reference, /^lead_/);
    const again = await post(lead({ designId: hid }));
    assert.equal(again.data.reference, ok.data.reference); // a double press returns the first lead's real reference
    assert.equal(again.data.duplicate, true);
    assert.equal((await post(lead({ website: 'http://spam', email: 'bot@example.com' }))).status, 200); // honeypot: silently dropped
    const inbox = await a.admin.get('/portal/leads');
    assert.equal(inbox.data.total, 1);
    const l = inbox.data.leads[0];
    assert.equal(l.email, 'sarah@example.com');
    assert.equal(l.houseName, 'Banksia 25');
    assert.equal(l.status, 'new');
    assert.equal(l.hostOrigin, 'https://www.builder.example');
    // consent record
    if (d1) { const row = w.db._db.prepare('SELECT consent_text, consent_at FROM leads').get(); assert.match(row.consent_text, /Hunter Homes contacting me/); assert.ok(row.consent_at); }
    // a second builder never sees it
    const b = await w.makeOrg('Other Builders', 'Pat');
    assert.equal((await b.admin.get('/portal/leads')).data.total, 0);
    assert.equal((await b.admin.patch(`/portal/leads/${l.id}`, { status: 'closed' })).status, 404);
    assert.equal((await b.admin.del(`/portal/leads/${l.id}`)).status, 404);
    // status, note, csv, delete
    assert.equal((await a.admin.patch(`/portal/leads/${l.id}`, { status: 'contacted', note: 'Rang back' })).data.status, 'contacted');
    assert.equal((await a.admin.patch(`/portal/leads/${l.id}`, { status: 'weird' })).status, 400);
    const csv = await a.admin.call('GET', '/portal/leads/export', undefined, { raw: true });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.match(csv.data, /sarah@example.com/);
    assert.match(csv.data, /Banksia 25/);
    assert.equal((await anon.get('/portal/leads')).status, 401);
    assert.equal((await a.admin.del(`/portal/leads/${l.id}`)).status, 200);
    assert.equal((await a.admin.get('/portal/leads')).data.total, 0);
    assert.deepEqual(w.outbound, []); // no email, no webhook (none set)
  });

  test(`${label}: widget leads are rate limited per address`, async () => {
    const w = world({ d1 });
    const a = await w.makeOrg('Hunter Homes', 'Sam');
    const id = (await a.admin.get('/portal/widget')).data.id;
    await a.admin.put('/portal/widget', { enabled: true, origins: ['https://www.builder.example'] });
    const anon = w.browser('192.0.2.12');
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await anon.post(`/widget/${id}/lead`, lead({ email: `p${i}@example.com` }))).status;
    assert.equal(last, 429);
  });

  test(`${label}: a new lead is POSTed signed to the webhook, a failure is retried then given up, and Zapier style hooks work`, async () => {
    let mode = 'ok';
    const w = world({ d1, hook: () => (mode === 'ok' ? new Response('{"status":"success"}', { status: 200 }) : mode === 'down' ? new Response('no', { status: 500 }) : Promise.reject(new Error('net'))) });
    const a = await w.makeOrg('Hunter Homes', 'Sam');
    const id = (await a.admin.get('/portal/widget')).data.id;
    await a.admin.put('/portal/widget', { enabled: true, origins: ['https://www.builder.example'] });
    assert.equal((await a.admin.put('/portal/webhook', { url: 'http://insecure.example/h' })).status, 400);
    const saved = await a.admin.put('/portal/webhook', { url: 'https://hooks.zapier.com/hooks/catch/123/abc/', enabled: true });
    assert.equal(saved.status, 200);
    const secret = saved.data.secret; // the first save shows the secret once
    assert.equal((await a.admin.get('/portal/webhook')).data.secret, undefined); // never again with the settings
    assert.match(secret, /^whsec_[0-9a-f]{48}$/);
    // staff designers cannot read the secret
    const test1 = await a.admin.post('/portal/webhook/test');
    assert.equal(test1.data.ok, true);
    assert.equal(w.outbound.at(-1).url, 'https://hooks.zapier.com/hooks/catch/123/abc/');
    const anon = w.browser('192.0.2.13');
    assert.equal((await anon.post(`/widget/${id}/lead`, lead())).status, 200);
    const call = w.outbound.at(-1);
    const body = call.init.body;
    const payload = JSON.parse(body);
    assert.equal(payload.event, 'lead.created');
    assert.equal(payload.lead.email, 'sarah@example.com');
    assert.equal(payload.builder.name, 'Hunter Homes');
    const sig = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(call.init.headers['x-glideinside-signature']);
    assert.ok(sig);
    assert.equal(sig[2], await signWebhook(secret, Number(sig[1]), body));
    assert.equal(call.init.headers['x-glideinside-event'], 'lead.created');
    assert.equal(call.init.redirect, 'manual');
    let hv = (await a.admin.get('/portal/webhook')).data;
    assert.equal(hv.deliveries[0].status, 'delivered');
    // the endpoint goes down: retried on the schedule, then failed after the fifth attempt
    mode = 'down';
    w.clock.t += 5000;
    assert.equal((await anon.post(`/widget/${id}/lead`, lead({ email: 'two@example.com' }))).status, 200);
    hv = (await a.admin.get('/portal/webhook')).data;
    assert.equal(hv.deliveries[0].status, 'pending');
    assert.equal(hv.deliveries[0].attempts, 1);
    for (const mins of [2, 10, 60, 240]) { w.clock.t += mins * 60000; await w.app.scheduled(); } // the cron does the retries; opening the portal does not
    hv = (await a.admin.get('/portal/webhook')).data;
    assert.equal(hv.deliveries[0].status, 'failed');
    assert.equal(hv.deliveries[0].attempts, WEBHOOK_MAX_ATTEMPTS);
    assert.match(hv.deliveries[0].lastError, /500/);
    // it comes back: a manual retry delivers it
    mode = 'ok';
    const retried = await a.admin.post(`/portal/webhook/deliveries/${hv.deliveries[0].id}/retry`);
    assert.equal(retried.data.deliveries[0].status, 'delivered');
    // network error is reported without leaking details
    mode = 'throw';
    const t2 = await a.admin.post('/portal/webhook/test');
    assert.equal(t2.data.ok, false);
    assert.match(t2.data.error, /could not be reached/);
    // rotate secret changes the signature key; delete removes the hook so a later lead sends nothing
    const rot = await a.admin.post('/portal/webhook/rotate-secret');
    assert.notEqual(rot.data.secret, secret);
    assert.equal((await a.admin.post('/portal/webhook/reveal-secret')).data.secret, rot.data.secret);
    await a.admin.del('/portal/webhook');
    const n = w.outbound.length;
    await anon.post(`/widget/${id}/lead`, lead({ email: 'three@example.com' }));
    assert.equal(w.outbound.length, n);
    // the cron retry path exists
    assert.equal(typeof w.app.scheduled, 'function');
  });

  test(`${label}: builder site cost defaults are saved per builder`, async () => {
    const w = world({ d1 });
    const a = await w.makeOrg('Hunter Homes', 'Sam');
    const b = await w.makeOrg('Other Builders', 'Pat');
    assert.equal((await a.admin.get('/portal/site-costs')).data.settings, null);
    const put = await a.admin.put('/portal/site-costs', { settings: { region: 'qld', rates: { cut_excavate: { nsw: 40, qld: 41 }, bad_ID: { nsw: 1 }, fill_place: { nsw: -5 } }, rock: { enabled: true, fractionOfCut: 5 } } });
    assert.equal(put.status, 200);
    assert.deepEqual(put.data.settings.rates, { cut_excavate: { nsw: 40, qld: 41 } });
    assert.equal(put.data.settings.rock.fractionOfCut, 1);
    assert.equal((await a.admin.get('/portal/site-costs')).data.settings.region, 'qld');
    assert.equal((await b.admin.get('/portal/site-costs')).data.settings, null);
    assert.equal((await a.admin.put('/portal/site-costs', { settings: 'x' })).status, 400);
    assert.equal((await a.admin.del('/portal/site-costs')).status, 200);
    assert.equal((await a.admin.get('/portal/site-costs')).data.settings, null);
  });

  test(`${label}: engineering order requests are validated, saved, listed for the owner only, and never emailed`, async () => {
    const w = world({ d1 });
    const anon = w.browser('192.0.2.20');
    const good = { services: ['stormwater-concept', 'site-classification'], name: 'Sarah Jones', email: 'sarah@example.com', phone: '0412 345 678', address: '22 Banksia Rise, Thornton NSW', lotLabel: 'Lot 14 DP 1234', designName: 'Banksia 25', designLink: `${SITE}/plan-studio/app/?share=abc`, notes: 'Sloping block', consent: true };
    assert.equal((await anon.post('/order/engineering', { ...good, consent: false })).status, 400);
    assert.equal((await anon.post('/order/engineering', { ...good, services: ['made-up'] })).status, 400);
    assert.equal((await anon.post('/order/engineering', { ...good, email: 'x' })).status, 400);
    const ok = await anon.post('/order/engineering', { ...good, designLink: 'https://evil.example/x' });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.match(ok.data.reference, /^EO-/);
    assert.equal((await anon.post('/order/engineering', good)).status, 200);
    assert.equal((await anon.get('/portal/admin/engineering-orders')).status, 401);
    const list = await w.admin('GET', '/portal/admin/engineering-orders');
    assert.equal(list.status, 200);
    assert.equal(list.data.orders.length, 2);
    const first = list.data.orders.find((o) => o.designLink === '') || list.data.orders[0];
    assert.equal(first.status, 'new');
    assert.ok(first.serviceLabels.length >= 1);
    assert.equal(list.data.orders.find((o) => o.designLink).designLink, good.designLink);
    assert.equal((await w.admin('POST', `/portal/admin/engineering-orders/${first.id}/status`, { status: 'seen' })).status, 200);
    assert.equal((await w.admin('POST', `/portal/admin/engineering-orders/${first.id}/status`, { status: 'bad' })).status, 400);
    assert.deepEqual(w.outbound, []);
  });
}

// Review fixes (19/11/2026) --------------------------------------------------------------------------------------------------------
test('webhook address rules: trailing dot, own host, workers.dev, wildcard DNS names, numeric and private forms', () => {
  const bad = ['https://localhost./x', 'https://foo.localhost./x', 'https://LOCALHOST/x', 'https://127.0.0.1.nip.io/x', 'https://10.0.0.1.sslip.io/x', 'https://a.localtest.me/x', 'https://x.lvh.me/x', 'https://evil.workers.dev/x',
    'https://2130706433/x', 'https://0x7f.1/x', 'https://017700000001/x', 'https://[::1]/x', 'https://169.254.169.254/x', 'https://192.168.1.1./x', 'https://intranet.corp./x', 'https://printer.lan/x', 'https://10.1.2.3.example.com/x'];
  for (const u of bad) assert.ok(webhookUrlProblem(u, SITE), `${u} must be refused`);
  assert.match(webhookUrlProblem('https://site.test/x', SITE), /Glide Inside itself/);
  assert.match(webhookUrlProblem('https://site.test./x', SITE), /Glide Inside itself/);
  assert.equal(webhookUrlProblem('https://hooks.zapier.com/hooks/catch/1/a/', SITE), null);
  assert.equal(webhookUrlProblem('https://hook.eu1.make.com/abc', SITE), null);
});

for (const [label, d1] of [['memory', false], ...(DatabaseSync ? [['D1 (SQLite shim)', true]] : [])]) {
  test(`${label}: the webhook secret is never in a GET, a PUT update or a delete, only on first save, rotate and reveal`, async () => {
    const w = world({ d1, hook: () => new Response('ok', { status: 200 }) });
    const a = await w.makeOrg('Hunter Homes', 'Sam');
    const first = await a.admin.put('/portal/webhook', { url: 'https://hooks.zapier.com/hooks/catch/1/a/' });
    assert.match(first.data.secret, /^whsec_/);
    const second = await a.admin.put('/portal/webhook', { url: 'https://hooks.zapier.com/hooks/catch/1/b/', enabled: true });
    assert.equal('secret' in second.data, false);
    const get = await a.admin.get('/portal/webhook');
    assert.equal('secret' in get.data, false);
    assert.equal(get.data.secretHint, `${first.data.secret.slice(0, 10)}...`);
    assert.equal(JSON.stringify(get.data).includes(first.data.secret.slice(12)), false);
    const rev = await a.admin.post('/portal/webhook/reveal-secret');
    assert.equal(rev.data.secret, first.data.secret);
    assert.equal((await a.admin.call('POST', '/portal/webhook/reveal-secret', {}, { noCsrf: true })).status, 403); // CSRF header required
    assert.equal((await w.browser('192.0.2.77').post('/portal/webhook/reveal-secret')).status, 401);
    const rot = await a.admin.post('/portal/webhook/rotate-secret');
    assert.match(rot.data.secret, /^whsec_/);
    const del = await a.admin.del('/portal/webhook');
    assert.equal('secret' in del.data, false);
  });

  test(`${label}: a webhook delivery runs after the response (waitUntil), and the cron retries every builder, capped per run`, async () => {
    let release; const gate = new Promise((r) => { release = r; });
    let mode = 'down';
    const w = world({ d1, hook: async () => { if (mode === 'gate') { await gate; } return new Response('x', { status: mode === 'down' ? 500 : 200 }); } });
    const pending = [];
    const ctx = { waitUntil: (p) => pending.push(p) };
    const orgs = [];
    for (const [n, f] of [['Hunter Homes', 'Sam'], ['Other Builders', 'Pat'], ['Third Builders', 'Lee']]) {
      const o = await w.makeOrg(n, f);
      const id = (await o.admin.get('/portal/widget')).data.id;
      await o.admin.put('/portal/widget', { enabled: true, origins: ['https://www.builder.example'] });
      await o.admin.put('/portal/webhook', { url: `https://hooks.zapier.com/hooks/catch/${f}/a/` });
      orgs.push({ o, id });
    }
    // 1. the visitor's response returns while the delivery is still waiting on the endpoint
    mode = 'gate';
    const post = (id, email, ip) => w.app.fetch(new Request(`${SITE}/api/widget/${id}/lead`, { method: 'POST', headers: { origin: SITE, 'x-gi-request': '1', 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify(lead({ email })) }), ctx);
    const res = await post(orgs[0].id, 'a@example.com', '192.0.2.31');
    assert.equal(res.status, 200);
    assert.equal(pending.length, 1);
    let hv = (await orgs[0].o.admin.get('/portal/webhook')).data;
    assert.equal(hv.deliveries[0].attempts, 0); // not attempted yet from the visitor's point of view
    release(); await Promise.all(pending); pending.length = 0;
    hv = (await orgs[0].o.admin.get('/portal/webhook')).data;
    assert.equal(hv.deliveries[0].status, 'delivered');
    // 2. an endpoint that is down for all three builders: one cron run retries all of them, not only the first
    mode = 'down';
    for (const [i, x] of orgs.entries()) await post(x.id, `b${i}@example.com`, `192.0.2.4${i}`).then(async () => { await Promise.all(pending); pending.length = 0; });
    for (const x of orgs) assert.equal((await x.o.admin.get('/portal/webhook')).data.deliveries.filter((d) => d.status === 'pending').length >= 1, true);
    const before = w.outbound.length;
    w.clock.t += 2 * 60000;
    await w.app.scheduled();
    const hit = new Set(w.outbound.slice(before).map((c) => c.url));
    assert.equal(hit.size, 3, 'every builder is retried in one run');
    // opening the portal no longer calls out
    const n = w.outbound.length;
    w.clock.t += 60 * 60000;
    await orgs[0].o.admin.get('/portal/webhook'); await orgs[0].o.admin.get('/portal/leads');
    assert.equal(w.outbound.length, n, 'GET has no outbound side effects');
  });

  test(`${label}: the cron cap is 25 deliveries per run`, async () => {
    const w = world({ d1, hook: () => new Response('no', { status: 500 }) });
    const a = await w.makeOrg('Hunter Homes', 'Sam');
    await a.admin.put('/portal/webhook', { url: 'https://hooks.zapier.com/hooks/catch/1/a/' });
    const org = (await a.admin.get('/portal/me')).data.org.id;
    const at = new Date(w.clock.t).toISOString();
    for (let i = 0; i < 30; i++) {
      const lid = `lead_cap${i}`;
      await w.lstore.insertLead({ id: lid, orgId: org, createdAt: at, source: 'widget', name: 'N', email: `n${i}@example.com`, consentAt: at, consentText: 'c', status: 'new' });
      await w.lstore.insertDelivery({ id: `dlv_cap${i}`, orgId: org, leadId: lid, createdAt: at, attempts: 0, status: 'pending', nextAttemptAt: at });
    }
    w.outbound.length = 0;
    w.clock.t += 1000;
    await w.app.scheduled();
    assert.equal(w.outbound.length, 25);
  });

  test(`${label}: lead status and notes, and the full CSV, need the builder admin; a designer can read the inbox only`, async () => {
    const w = world({ d1 });
    const a = await w.makeOrg('Hunter Homes', 'Sam');
    const id = (await a.admin.get('/portal/widget')).data.id;
    await a.admin.put('/portal/widget', { enabled: true, origins: ['https://www.builder.example'] });
    await w.browser('192.0.2.51').post(`/widget/${id}/lead`, lead());
    const lid = (await a.admin.get('/portal/leads')).data.leads[0].id;
    const r = await a.admin.post('/portal/team', { firstName: 'Tom', role: 'designer', email: 'tom@hunter.example' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const d = w.browser('198.51.100.9');
    await d.post('/portal/session', { identifier: r.data.credentials.username, password: r.data.credentials.password });
    await d.post('/portal/password', { currentPassword: r.data.credentials.password, newPassword: 'Designer-Pass-Phrase-55' });
    assert.equal((await d.get('/portal/leads')).status, 200);
    assert.equal((await d.patch(`/portal/leads/${lid}`, { status: 'closed' })).status, 403);
    assert.equal((await d.del(`/portal/leads/${lid}`)).status, 403);
    assert.equal((await d.call('GET', '/portal/leads/export', undefined, { raw: true })).status, 403);
    assert.equal((await d.get('/portal/webhook')).status, 403);
    assert.equal((await d.post('/portal/webhook/reveal-secret')).status, 403);
    assert.equal((await a.admin.patch(`/portal/leads/${lid}`, { status: 'closed' })).status, 200);
  });

  test(`${label}: lead posts need this site's Origin, and only designs the widget offers`, async () => {
    const w = world({ d1 });
    const a = await w.makeOrg('Hunter Homes', 'Sam');
    const h1 = await seedHouse(a, 'Banksia 25'); const h2 = await seedHouse(a, 'Wattle 30');
    const id = (await a.admin.get('/portal/widget')).data.id;
    await a.admin.put('/portal/widget', { enabled: true, origins: ['https://www.builder.example'], houseIds: [h1] });
    const anon = w.browser('192.0.2.61');
    const raw = (origin) => anon.post(`/widget/${id}/lead`, lead({ designId: h1 }), { headers: origin === null ? { origin: '' } : { origin } });
    assert.equal((await raw('https://evil.example')).status, 403);
    assert.equal((await raw('https://www.builder.example')).status, 403, 'the builder site posts via the iframe, whose origin is this site');
    assert.equal((await anon.post(`/widget/${id}/lead`, lead({ designId: h2 }))).status, 400, 'a design the widget does not offer');
    assert.equal((await anon.post(`/widget/${id}/lead`, lead({ designId: h1 }))).status, 200);
  });

  test(`${label}: consent version and time are stored with each lead and order, and the config tells the widget the version`, async () => {
    const w = world({ d1 });
    const a = await w.makeOrg('Hunter Homes', 'Sam');
    const id = (await a.admin.get('/portal/widget')).data.id;
    await a.admin.put('/portal/widget', { enabled: true, origins: ['https://www.builder.example'] });
    const anon = w.browser('192.0.2.71');
    await anon.post(`/widget/${id}/lead`, lead());
    await anon.post('/order/engineering', { services: ['stormwater-concept'], name: 'S J', email: 's@example.com', consent: true });
    const { LEAD_CONSENT_VERSION } = await import('../server/lib/leads.js');
    const { ORDER_CONSENT_VERSION } = await import('../server/lib/orders.js');
    if (d1) {
      const l = w.db._db.prepare('SELECT consent_version, consent_at FROM leads').get();
      const o = w.db._db.prepare('SELECT consent_version, consent_at FROM engineering_orders').get();
      assert.equal(l.consent_version, LEAD_CONSENT_VERSION); assert.ok(l.consent_at);
      assert.equal(o.consent_version, ORDER_CONSENT_VERSION); assert.ok(o.consent_at);
    }
    assert.equal((await w.admin('GET', '/portal/admin/engineering-orders')).data.orders[0].consentVersion, ORDER_CONSENT_VERSION);
  });

  test(`${label}: engineering orders refuse a cross site post, a foreign Origin, and a flood; and the owner can delete one`, async () => {
    const w = world({ d1 });
    const good = { services: ['stormwater-concept'], name: 'Sarah Jones', email: 'sarah@example.com', consent: true };
    const anon = w.browser('192.0.2.81');
    assert.equal((await anon.post('/order/engineering', good, { noCsrf: true })).status, 403, 'no x-gi-request header (a text/plain no-cors post)');
    assert.equal((await anon.post('/order/engineering', good, { headers: { origin: 'https://evil.example' } })).status, 403);
    const ok = await anon.post('/order/engineering', good);
    assert.equal(ok.status, 200);
    assert.match(ok.data.reference, /^EO-[A-HJ-NP-Z2-9]{6}$/);
    // 6 per hour per address
    for (let i = 0; i < 5; i++) await anon.post('/order/engineering', good);
    assert.equal((await anon.post('/order/engineering', good)).status, 429);
    // a global cap across all addresses (200 a day)
    let last = 200;
    for (let i = 0; i < 210; i++) last = (await w.browser(`198.18.${Math.floor(i / 250)}.${(i % 250) + 1}`).post('/order/engineering', good)).status;
    assert.equal(last, 429, 'the global daily cap');
    // delete
    const list = (await w.admin('GET', '/portal/admin/engineering-orders')).data.orders;
    const id = list[0].id;
    assert.equal((await w.browser('192.0.2.82').del(`/portal/admin/engineering-orders/${id}`)).status, 401);
    assert.equal((await w.admin('DELETE', `/portal/admin/engineering-orders/${id}`)).status, 200);
    assert.equal((await w.admin('DELETE', `/portal/admin/engineering-orders/${id}`)).status, 404);
    assert.equal((await w.admin('GET', '/portal/admin/engineering-orders')).data.orders.some((o) => o.id === id), false);
  });

  test(`${label}: retention purge removes delivery logs after 90 days and leads and orders after 24 months`, async () => {
    const w = world({ d1, hook: () => new Response('ok', { status: 200 }) });
    const a = await w.makeOrg('Hunter Homes', 'Sam');
    const id = (await a.admin.get('/portal/widget')).data.id;
    await a.admin.put('/portal/widget', { enabled: true, origins: ['https://www.builder.example'] });
    await a.admin.put('/portal/webhook', { url: 'https://hooks.zapier.com/hooks/catch/1/a/' });
    await w.browser('192.0.2.91').post(`/widget/${id}/lead`, lead());
    await w.browser('192.0.2.92').post('/order/engineering', { services: ['stormwater-concept'], name: 'S J', email: 's@example.com', consent: true });
    const org = (await a.admin.get('/portal/me')).data.org.id; // sessions lapse over this much time, so the store is read directly from here on
    assert.equal((await w.lstore.listDeliveries(org)).length, 1);
    w.clock.t += 91 * 86400e3; await w.app.scheduled();
    assert.equal((await w.lstore.listDeliveries(org)).length, 0, 'delivery log gone after 90 days');
    assert.equal(await w.lstore.countLeads(org), 1, 'the lead stays');
    w.clock.t += 24 * 31 * 86400e3; await w.app.scheduled();
    assert.equal(await w.lstore.countLeads(org), 0, 'lead gone after 24 months');
    assert.equal((await w.lstore.listOrders()).length, 0);
  });
}

test('before migration 0025 the routes say so plainly instead of a generic 500', async () => {
  if (!DatabaseSync) return;
  const w = world({ d1: true });
  const a = await w.makeOrg('Hunter Homes', 'Sam');
  const id = (await a.admin.get('/portal/widget')).data.id;
  for (const t of ['webhook_deliveries', 'leads', 'lead_webhooks', 'widget_settings', 'site_cost_defaults', 'engineering_orders']) w.db._db.exec(`DROP TABLE ${t}`);
  for (const r of [await a.admin.get('/portal/leads'), await a.admin.get('/portal/widget'), await a.admin.get('/portal/site-costs'), await w.browser('192.0.2.99').get(`/widget/${id}/config?host=${encodeURIComponent(SITE)}`, { noCsrf: true }), await w.browser('192.0.2.98').post('/order/engineering', { services: ['stormwater-concept'], name: 'S J', email: 's@example.com', consent: true })]) {
    assert.equal(r.status, 503, JSON.stringify(r.data));
    assert.match(r.data.error.message, /0025 database update/);
  }
});
