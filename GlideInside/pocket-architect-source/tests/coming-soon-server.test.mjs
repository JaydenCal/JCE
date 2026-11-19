// Migration 0025 and the routes behind the website widget, the lead inbox with its signed webhook and retries, the builder site cost defaults and
// the engineering order requests. Memory store and the SQLite shim of D1 (the same schema.sql the migration mirrors). Nothing is ever emailed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../server/lib/app.js';
import { createMemoryStore, createD1Store } from '../server/lib/store.js';
import { createMemoryPortalStore, createD1PortalStore } from '../server/lib/portal-store.js';
import { createD1LeadsStore } from '../server/lib/leads-store.js';
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
  const app = createApp({ store: d1 ? createD1Store(db) : createMemoryStore(), portalStore: d1 ? createD1PortalStore(db) : createMemoryPortalStore(), ...(d1 ? { leadsStore: createD1LeadsStore(db) } : {}), fetchImpl, now: () => clock.t, env: { SITE_URL: SITE, ENTITLEMENT_SECRET: 'unit-test-secret', PORTAL_ENABLED: '1', ADMIN_TOKEN } });
  const w = { clock, app, outbound, db };
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
    assert.equal((await post(lead({ designId: hid }))).data.reference, 'duplicate');
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
    const secret = saved.data.secret;
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
    for (const mins of [2, 10, 60, 240]) { w.clock.t += mins * 60000; await a.admin.get('/portal/webhook'); }
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
    assert.equal((await anon.post('/order/engineering', { ...good, consent: false }, { noCsrf: true })).status, 400);
    assert.equal((await anon.post('/order/engineering', { ...good, services: ['made-up'] }, { noCsrf: true })).status, 400);
    assert.equal((await anon.post('/order/engineering', { ...good, email: 'x' }, { noCsrf: true })).status, 400);
    const ok = await anon.post('/order/engineering', { ...good, designLink: 'https://evil.example/x' }, { noCsrf: true });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.match(ok.data.reference, /^EO-/);
    assert.equal((await anon.post('/order/engineering', good, { noCsrf: true })).status, 200);
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
