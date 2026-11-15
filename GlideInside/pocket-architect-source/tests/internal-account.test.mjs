// Internal test account (owner only): an org flagged internal is never charged, never invoiced, has no trial or pause, gets the commercial
// assistant on its own generous AI pool, carries "INTERNAL TEST" on PDFs, and its logins browse every builder's designs read only.
// Strict isolation the other way: ordinary builders never see another org's designs. Memory stores, fake Stripe that must stay untouched.
import { sheetNote } from '../src/legal/plan-terms.js';
import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createApp } from '../server/lib/app.js';
import { createMemoryStore, createD1Store } from '../server/lib/store.js';
import { createMemoryPortalStore, createD1PortalStore } from '../server/lib/portal-store.js';
import { verifyPassword } from '../server/lib/password.js';
import { runMonth } from '../server/lib/portal-billing.js';
import { GLIDE_LIBRARY } from '../src/portal/glide-library.generated.js';
import { createProject } from '../src/model/schema.js';
import { applyOp } from '../src/model/ops.js';
import { catalogue } from '../src/catalogue/index.js';

const SITE = 'https://site.test';
const ADMIN = 'admin-token-for-tests-0123456789';
const T0 = Date.UTC(2026, 10, 11, 1, 0, 0);
const PW = 'Owner-Typed-Pass-2026-x';
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const USAGE = { input_tokens: 5200, output_tokens: 180, cache_creation_input_tokens: 1000, cache_read_input_tokens: 5800 };

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* D1 shim test skipped */ }
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
  return { prepare: (sql) => statement(sql) };
}

function world({ d1 = false } = {}) {
  const clock = { t: T0 };
  const db = d1 ? makeD1() : null;
  const store = d1 ? createD1Store(db) : createMemoryStore();
  const pstore = d1 ? createD1PortalStore(db) : createMemoryPortalStore();
  const w = { clock, store, pstore, stripe: [], anthropic: [], logs: [] };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.origin === 'https://api.stripe.com') { w.stripe.push(u.pathname); return jsonRes({ id: 'x' }); }
    if (u.href === 'https://api.anthropic.com/v1/messages') {
      w.anthropic.push(JSON.parse(init.body));
      return jsonRes({ id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn', usage: USAGE });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of Object.keys(orig)) console[k] = (...a) => { w.logs.push(a.map(String).join(' ')); };
  w.restoreConsole = () => Object.assign(console, orig);
  w.app = createApp({
    store, portalStore: pstore, fetchImpl, now: () => clock.t, catalogue, loadJsPDF: async () => (await import('jspdf')).jsPDF,
    env: { SITE_URL: SITE, ENTITLEMENT_SECRET: 'unit-test-secret', PORTAL_ENABLED: "1", ADMIN_TOKEN: ADMIN, STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_WEBHOOK_SECRET: 'whsec_x', ANTHROPIC_API_KEY: 'sk-ant', AI_RATE_PER_MIN: '1000', AI_RATE_PER_DAY: '1000', TRIAL_NOTIFY: '0', TERMS_REQUIRED: '0' },
  });
  w.browser = () => {
    const jar = { cookie: null };
    const call = async (method, path, body) => {
      const h = { origin: SITE, 'x-gi-request': '1' };
      if (jar.cookie) h.cookie = `gi_session=${jar.cookie}`;
      if (body !== undefined) h['content-type'] = 'application/json';
      const res = await w.app.fetch(new Request(`${SITE}/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
      for (const c of res.headers.getSetCookie?.() || []) { const m = /^gi_session=([^;]*)/.exec(c); if (m) jar.cookie = m[1] || null; }
      const type = res.headers.get('content-type') || '';
      return { status: res.status, res, data: type.includes('json') ? await res.clone().json() : null };
    };
    return { call, get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), patch: (p, b) => call('PATCH', p, b) };
  };
  w.admin = (method, path, body, token = ADMIN) => w.app.fetch(new Request(`${SITE}/api${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) })).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
  w.builder = async (name, first, { noBilling = false } = {}) => {
    const r = await w.admin('POST', '/portal/admin/orgs', { name, adminFirstName: first, adminEmail: `${first.toLowerCase()}@${name.split(' ')[0].toLowerCase()}.example` });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const b = w.browser();
    assert.equal((await b.post('/portal/session', { identifier: r.data.credentials.username, password: r.data.credentials.password })).status, 200);
    assert.equal((await b.post('/portal/password', { currentPassword: r.data.credentials.password, newPassword: 'Correct-Horse-Battery-9' })).status, 200);
    if (!noBilling) assert.equal((await b.call('PUT', '/portal/billing/contact', { name: first, email: `accounts@${name.split(' ')[0].toLowerCase()}.example`, phone: '', legalName: name, abn: '51824753556' })).status, 200);
    return { orgId: r.data.org.id, b };
  };
  w.internal = async (extra = {}) => {
    const r = await w.admin('POST', '/portal/admin/internal-orgs', { username: 'internal.test', password: PW, ...extra });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const b = w.browser();
    const s = await b.post('/portal/session', { identifier: 'internal.test', password: PW });
    assert.equal(s.status, 200, JSON.stringify(s.data));
    return { orgId: r.data.org.id, b, created: r.data };
  };
  return w;
}
const house = () => {
  const p = createProject({ id: 'p_int001', name: 'Test house' });
  applyOp(p, 'add_room', { type: 'living', name: 'Living', x: 0, y: 0, width: 6000, depth: 4500 });
  return p;
};
const commercialCtx = 'PROJECT "T" type=commercial mode=commercial units=mm\nLEVEL l_1 "Ground" active';

test('admin creates an internal test account: default name, flagged internal, password hashed and never returned or logged', async () => {
  const w = world();
  try {
    const i = await w.internal();
    assert.equal(i.created.org.name, 'Glide Inside Internal Test');
    assert.equal(i.created.org.internal, true);
    assert.ok(!JSON.stringify(i.created).includes(PW), 'the password is never in a response');
    const me = (await i.b.get('/portal/me')).data;
    assert.equal(me.org.internal, true);
    assert.equal(me.account.status, 'active');
    assert.equal(me.account.internal, true);
    assert.equal(me.exportWatermark, false);
    const user = (await w.pstore.listUsers(i.orgId, true))[0];
    assert.ok(user.passwordHash && user.passwordHash !== PW && !user.passwordHash.includes(PW), 'stored hashed');
    assert.equal((await verifyPassword(PW, user.passwordHash)).ok, true);
    assert.equal(user.mustChangePassword, false);
    assert.ok(!w.logs.some((l) => l.includes(PW)), 'never logged');
    assert.equal((await w.admin('POST', '/portal/admin/internal-orgs', { username: 'internal.test', password: PW })).status, 409, 'username taken');
    assert.equal((await w.admin('POST', '/portal/admin/internal-orgs', { username: 'x.two', password: 'short' })).status, 400, 'a weak password is refused, not replaced');
    assert.equal((await w.admin('POST', '/portal/admin/internal-orgs', { username: 'x.three' })).status, 400, 'a password is required: none is generated');
    assert.equal((await w.admin('GET', '/portal/admin/orgs')).data.find((o) => o.id === i.orgId).internal, true);
  } finally { w.restoreConsole(); }
});

test('creation and the flag are admin only: no token, a wrong token, and a builder session are all refused', async () => {
  const w = world();
  try {
    const org = await w.builder('Coastal Homes Pty Ltd', 'Jo');
    assert.equal((await w.admin('POST', '/portal/admin/internal-orgs', { username: 'a.b.c', password: PW }, null)).status, 401);
    assert.equal((await w.admin('POST', '/portal/admin/internal-orgs', { username: 'a.b.c', password: PW }, 'wrong-token-wrong-token-1234')).status, 401);
    assert.ok([401, 403, 404].includes((await org.b.post('/portal/admin/internal-orgs', { username: 'a.b.c', password: PW })).status));
    assert.ok([401, 403, 404].includes((await org.b.post(`/portal/admin/orgs/${org.orgId}/internal`, { internal: true })).status));
    assert.equal((await org.b.call('PATCH', '/portal/org/settings', { internal: true })).status, 200, 'unknown keys are ignored');
    assert.equal((await w.pstore.getOrg(org.orgId)).internal, false, 'a builder cannot flag itself');
    const t = await w.admin('POST', `/portal/admin/orgs/${org.orgId}/internal`, { internal: true });
    assert.equal(t.status, 200);
    assert.equal(t.data.internal, true);
    assert.equal((await w.admin('POST', `/portal/admin/orgs/${org.orgId}/internal`, { internal: false })).data.internal, false);
    assert.equal((await w.admin('POST', `/portal/admin/orgs/${org.orgId}/internal`, { internal: 'yes' })).status, 400);
  } finally { w.restoreConsole(); }
});

test('client login issues for an internal org are 0 cents, labelled, and the issue response says no charge', async () => {
  const w = world();
  try {
    const i = await w.internal();
    const r = await i.b.post('/portal/clients', { firstName: 'Sarah', email: 'sarah@x.example' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.charge.amountCents, 0);
    assert.match(r.data.charge.note, /Internal test, no charge/);
    const c = w.browser();
    assert.equal((await c.post('/portal/session', { identifier: r.data.credentials.username, password: r.data.credentials.password })).status, 200);
    const rows = await w.pstore.listLoginIssues(i.orgId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amountCents, 0, 'recorded at 0 cents');
    const month = '2026-11';
    const usage = (await i.b.get(`/portal/billing/usage?month=${month}`)).data;
    assert.equal(usage.totals.totalCents, 0);
    assert.equal(usage.logins[0].label, 'internal test, no charge');
    // an ordinary org is still charged
    const ord = await w.builder('Ordinary Homes Pty Ltd', 'Pat');
    await w.admin('POST', `/portal/admin/orgs/${ord.orgId}/convert`, {});
    const r2 = await ord.b.post('/portal/clients', { firstName: 'Bob', email: 'bob@x.example' });
    assert.equal(r2.data.charge.amountCents, 3000);
  } finally { w.restoreConsole(); }
});

test('no invoice and no Stripe call for an internal org: month run skips it (reason internal), setup is refused, no customer exists', async () => {
  const w = world();
  try {
    const i = await w.internal();
    const r = await i.b.post('/portal/clients', { firstName: 'Sarah', email: 'sarah@x.example' });
    const c = w.browser();
    await c.post('/portal/session', { identifier: r.data.credentials.username, password: r.data.credentials.password });
    await i.b.call('PUT', '/portal/billing/contact', { legalName: 'Glide Inside Internal Test', abn: '51824753556', billingEmail: 'a@b.example' });
    w.clock.t = Date.UTC(2026, 11, 2, 1, 0, 0); // December: November is now complete
    const run = await w.admin('POST', '/billing/run-month', { month: '2026-11', orgId: i.orgId });
    assert.equal(run.status, 200, JSON.stringify(run.data));
    assert.deepEqual(run.data.results.map((x) => [x.status, x.reason]), [['skipped', 'internal']]);
    assert.equal((await w.admin('POST', '/billing/run-month', { month: '2026-11' })).data.results.find((x) => x.orgId === i.orgId).reason, 'internal', 'also in the all org run');
    assert.equal((await i.b.post('/portal/billing/setup')).status, 400, 'no setup session');
    assert.equal((await w.pstore.listInvoices(i.orgId)).length, 0);
    assert.equal((await w.pstore.getOrg(i.orgId)).stripeCustomerId ?? null, null);
    const direct = await runMonth({ pstore: w.pstore, store: w.store, config: { stripeSecretKey: 'sk_test_x' }, fetchImpl: async () => { throw new Error('Stripe was called'); }, now: () => w.clock.t, month: '2026-11', orgId: i.orgId });
    assert.equal(direct.results[0].reason, 'internal');
    assert.deepEqual(w.stripe, [], 'the fake Stripe saw nothing');
  } finally { w.restoreConsole(); }
});

test('trial expiry and pause do not apply: an internal org stays active and writable even if flagged trial_ended or read_only', async () => {
  const w = world();
  try {
    const i = await w.internal();
    await w.pstore.saveOrgAccount(i.orgId, { status: 'read_only' });
    assert.equal((await i.b.post('/portal/houses', { fromGlideId: GLIDE_LIBRARY[0].id })).status, 200);
    await w.pstore.saveOrgAccount(i.orgId, { status: 'trial', trialEndsAt: new Date(T0 - 86400000).toISOString() });
    assert.equal((await i.b.get('/portal/me')).data.account.status, 'active');
    assert.equal((await i.b.post('/portal/clients', { firstName: 'Sam', email: 's@x.example' })).status, 201, 'client logins are never locked');
    const ai = await i.b.post('/portal/ai/token');
    assert.equal(ai.status, 200);
  } finally { w.restoreConsole(); }
});

test('AI: internal logins get the INTERNAL_AI_MONTHLY pool (default 1000), no top-ups, no charge events', async () => {
  const w = world();
  try {
    const i = await w.internal();
    const bal = (await i.b.get('/portal/ai')).data;
    assert.equal(bal.monthlyCap, 1000);
    const top = await i.b.post('/portal/ai/top-up');
    assert.ok([403].includes(top.status), `top-ups refused, got ${top.status}`);
    assert.equal((await w.store.listEvents('ai_topup')).length, 0);
    const token = (await i.b.post('/portal/ai/token')).data.token;
    const credits = await w.app.fetch(new Request(`${SITE}/api/credits`, { headers: { authorization: `Bearer ${token}` } }));
    const snap = await credits.json();
    assert.equal(snap.total, 1000);
    assert.equal(snap.topUp.allowed, false);
    // a client of the internal org gets the same pool
    const r = await i.b.post('/portal/clients', { firstName: 'Sarah', email: 'sarah@x.example' });
    const c = w.browser();
    await c.post('/portal/session', { identifier: r.data.credentials.username, password: r.data.credentials.password });
    await c.post('/portal/password', { currentPassword: r.data.credentials.password, newPassword: 'Another-Long-Pass-77' });
    assert.equal((await c.get('/portal/ai')).data.monthlyCap, 1000);
    assert.equal((await c.post('/portal/ai/top-up')).status, 403);
    // an ordinary org keeps its own cap
    const ord = await w.builder('Ordinary Homes Pty Ltd', 'Pat');
    assert.equal((await ord.b.get('/portal/ai')).data.monthlyCap, 300);
  } finally { w.restoreConsole(); }
});

test('AI cap env INTERNAL_AI_MONTHLY is honoured', async () => {
  const w = world();
  try {
    const app = createApp({ store: createMemoryStore(), portalStore: createMemoryPortalStore(), fetchImpl: async () => { throw new Error('x'); }, now: () => T0, env: { SITE_URL: SITE, ENTITLEMENT_SECRET: 's', PORTAL_ENABLED: '1', ADMIN_TOKEN: ADMIN, INTERNAL_AI_MONTHLY: '40' } });
    const adm = (m, p, b) => app.fetch(new Request(`${SITE}/api${p}`, { method: m, headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: JSON.stringify(b) })).then((r) => r.json());
    const o = await adm('POST', '/portal/admin/internal-orgs', { username: 'cap.test', password: PW });
    assert.equal(o.org.ai.monthlyCap, 300, 'the stored org cap is unchanged');
    const res = await app.fetch(new Request(`${SITE}/api/portal/session`, { method: 'POST', headers: { origin: SITE, 'x-gi-request': '1', 'content-type': 'application/json' }, body: JSON.stringify({ identifier: 'cap.test', password: PW }) }));
    const cookie = /gi_session=([^;]*)/.exec(res.headers.getSetCookie().join(';'))[1];
    const ai = await (await app.fetch(new Request(`${SITE}/api/portal/ai`, { headers: { origin: SITE, 'x-gi-request': '1', cookie: `gi_session=${cookie}` } }))).json();
    assert.equal(ai.monthlyCap, 40);
  } finally { w.restoreConsole(); }
});

test('commercial access without a subscription: the commercial assistant runs on the commercial model, one message each, nothing logged as commercial usage', async () => {
  const w = world();
  try {
    const i = await w.internal();
    const token = (await i.b.post('/portal/ai/token')).data.token;
    const call = (extra = {}) => w.app.fetch(new Request(`${SITE}/api/ai/edit`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Make the roof dark grey', context: commercialCtx, history: [], activeLevelId: 'l_1', commercial: true, ...extra }) }));
    const res = await call();
    const out = await res.json();
    assert.equal(res.status, 200, JSON.stringify(out));
    assert.equal(out.credits.charged, 1, 'one message');
    assert.equal(out.credits.total, 1000);
    assert.match(w.anthropic.at(-1).model, /sonnet/i, 'the commercial (Sonnet) model');
    assert.equal((await w.store.listEvents('commercial_ai_use')).length, 0, 'not in the commercial usage report');
    assert.equal(w.stripe.length, 0);
    // housing mode still works on the same login
    const house = await w.app.fetch(new Request(`${SITE}/api/ai/edit`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Make the roof dark grey', context: 'PROJECT "T" type=house units=mm\nLEVEL l_1 "Ground" active', history: [], activeLevelId: 'l_1' }) }));
    assert.equal(house.status, 200);
    const ord = await w.builder('Ordinary Homes Pty Ltd', 'Pat');
    const ot = (await ord.b.post('/portal/ai/token')).data.token;
    const cres = await w.app.fetch(new Request(`${SITE}/api/ai/edit`, { method: 'POST', headers: { authorization: `Bearer ${ot}`, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'x', context: commercialCtx, history: [], activeLevelId: 'l_1', commercial: true }) }));
    assert.equal(cres.status === 200 && (await cres.json()).credits.total === 1000, false, 'an ordinary builder gets no internal pool');
  } finally { w.restoreConsole(); }
});

let pdfjs = null;
async function pdfText(bytes) {
  pdfjs ||= await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) pages.push((await (await doc.getPage(n)).getTextContent()).items.map((x) => x.str).join(' '));
  return pages;
}

test('PDFs carry a small INTERNAL TEST footer, no TRIAL watermark, and never another builder\'s title block', async () => {
  const w = world();
  try {
    const b = await w.builder('Rival Homes Pty Ltd', 'Rex');
    const rivalProject = house();
    rivalProject.titleBlock = { ...rivalProject.titleBlock, company: 'Rival Homes Pty Ltd', drawnBy: 'Rex Rival' };
    assert.equal((await b.b.post('/portal/houses', { name: 'Rival Two Storey', project: rivalProject })).status, 200);
    const i = await w.internal();
    const list = (await i.b.get('/portal/houses')).data;
    const rival = list.find((h) => h.name === 'Rival Two Storey');
    const got = (await i.b.get(`/portal/houses/${rival.id}`)).data;
    assert.equal(got.project.titleBlock.company, '', 'branding stripped before it reaches the internal account');
    assert.equal(got.project.titleBlock.drawnBy, '');
    // even if the title block is sent back, the export blanks it
    const sent = structuredClone(rivalProject);
    const r = await i.b.call('POST', '/portal/export/pdf', { project: sent });
    assert.equal(r.status, 200);
    // every plan set carries the plan terms note (src/legal), which says "NOT FOR CONSTRUCTION OR APPROVAL": take it out before looking for the old stamps
    const text = (await pdfText(new Uint8Array(await r.res.arrayBuffer()))).join(' ').split(sheetNote).join('');
    assert.match(text, /INTERNAL TEST/);
    assert.doesNotMatch(text, /TRIAL|NOT FOR CONSTRUCTION/);
    assert.doesNotMatch(text, /Rival Homes|Rex Rival/);
    // an ordinary builder's PDF has no INTERNAL TEST note
    const ro = await b.b.call('POST', '/portal/export/pdf', { project: house() });
    const rt = (await pdfText(new Uint8Array(await ro.res.arrayBuffer()))).join(' ');
    assert.doesNotMatch(rt, /INTERNAL TEST/);
  } finally { w.restoreConsole(); }
});

test('designs: internal sees every builder grouped, an ordinary builder sees only its own and gets 404 on another org\'s design', async () => {
  const w = world();
  try {
    const a = await w.builder('Alpha Homes Pty Ltd', 'Amy');
    const c = await w.builder('Coastal Homes Pty Ltd', 'Cal');
    const ha = (await a.b.post('/portal/houses', { name: 'Alpha Villa', project: house() })).data;
    const hc = (await c.b.post('/portal/houses', { name: 'Coastal Cottage', project: house() })).data;
    const i = await w.internal();
    const own = (await i.b.post('/portal/houses', { name: 'Internal Own', project: house() })).data;
    const list = (await i.b.get('/portal/houses')).data;
    assert.deepEqual(list.map((h) => [h.builder.name, h.name, h.readOnly]), [
      ['Alpha Homes Pty Ltd', 'Alpha Villa', true], ['Coastal Homes Pty Ltd', 'Coastal Cottage', true], ['Glide Inside Internal Test', 'Internal Own', false],
    ], 'grouped by builder, read only flags');
    assert.equal((await i.b.get(`/portal/houses/${hc.id}`)).status, 200);
    // ordinary builders never see another org's designs, and never the internal org's
    assert.deepEqual((await a.b.get('/portal/houses')).data.map((h) => h.name), ['Alpha Villa']);
    assert.deepEqual((await c.b.get('/portal/houses')).data.map((h) => h.name), ['Coastal Cottage']);
    assert.equal((await a.b.get(`/portal/houses/${hc.id}`)).status, 404);
    assert.equal((await a.b.get(`/portal/houses/${own.id}`)).status, 404, 'nothing from the internal org leaks');
    assert.equal((await a.b.post(`/portal/houses/${hc.id}/duplicate`, {})).status, 404);
    assert.equal((await a.b.post('/portal/houses', { id: hc.id, name: 'Stolen' })).status, 404);
    // a client of an ordinary builder sees only that builder's designs
    const cl = await a.b.post('/portal/clients', { firstName: 'Sarah', email: 's@x.example', houseAccess: 'all' });
    const cb = w.browser();
    await cb.post('/portal/session', { identifier: cl.data.credentials.username, password: cl.data.credentials.password });
    await cb.post('/portal/password', { currentPassword: cl.data.credentials.password, newPassword: 'Another-Long-Pass-77' });
    assert.deepEqual((await cb.get('/portal/houses')).data.map((h) => h.name), ['Alpha Villa']);
    assert.equal((await cb.get(`/portal/houses/${hc.id}`)).status, 404);
    assert.ok(ha.id);
  } finally { w.restoreConsole(); }
});

test('internal cannot modify or archive another org\'s design; duplicate lands in the internal org only, original untouched', async () => {
  const w = world();
  try {
    const a = await w.builder('Alpha Homes Pty Ltd', 'Amy');
    const ha = (await a.b.post('/portal/houses', { name: 'Alpha Villa', project: house() })).data;
    const i = await w.internal();
    assert.equal((await i.b.post('/portal/houses', { id: ha.id, name: 'Hijacked' })).status, 404);
    assert.equal((await i.b.post(`/portal/houses/${ha.id}/archive`, {})).status, 404);
    const dup = await i.b.post(`/portal/houses/${ha.id}/duplicate`, {});
    assert.equal(dup.status, 200, JSON.stringify(dup.data));
    assert.equal(dup.data.orgId, i.orgId, 'the copy belongs to the internal org');
    assert.equal(dup.data.name, 'Alpha Villa copy');
    assert.equal((await w.pstore.getHouse(i.orgId, dup.data.id)).orgId, i.orgId);
    assert.equal(await w.pstore.getHouse(a.orgId, dup.data.id), null, 'not in the builder\'s account');
    assert.deepEqual((await a.b.get('/portal/houses')).data.map((h) => h.name), ['Alpha Villa'], 'the builder\'s library is unchanged');
    assert.equal((await w.pstore.getHouse(a.orgId, ha.id)).name, 'Alpha Villa');
    assert.equal((await w.pstore.getHouse(a.orgId, ha.id)).archived, false);
    const mine = (await i.b.get('/portal/houses')).data.filter((h) => h.readOnly === false);
    assert.deepEqual(mine.map((h) => h.name), ['Alpha Villa copy']);
    // the copy can be edited by the internal org (it is its own)
    assert.equal((await i.b.post('/portal/houses', { id: dup.data.id, name: 'Internal Villa' })).status, 200);
  } finally { w.restoreConsole(); }
});

test('internal orgs are left out of reporting and the admin list marks them; marking an ordinary org internal stops invoicing', async () => {
  const w = world();
  try {
    const i = await w.internal();
    const list = (await w.admin('GET', '/portal/admin/orgs')).data;
    const row = list.find((o) => o.id === i.orgId);
    assert.equal(row.internal, true);
    assert.deepEqual([row.ai.creditsUsed, row.ai.topUps, row.invoices.length], [0, 0, 0]);
    assert.equal((await w.admin('POST', `/portal/admin/orgs/${i.orgId}/extend-trial`, {})).status, 400, 'trials do not apply');
    assert.equal((await w.admin('POST', `/portal/admin/orgs/${i.orgId}/reset-admin`, {})).status, 400, 'no generated password for the internal login');
    const ord = await w.builder('Ordinary Homes Pty Ltd', 'Pat');
    await w.admin('POST', `/portal/admin/orgs/${ord.orgId}/convert`, {});
    await w.admin('POST', `/portal/admin/orgs/${ord.orgId}/internal`, { internal: true });
    assert.equal((await ord.b.get('/portal/me')).data.org.internal, true);
    assert.equal((await ord.b.get('/portal/me')).data.account.status, 'active');
  } finally { w.restoreConsole(); }
});

test('on D1 (SQLite shim): the internal flag persists, designs are isolated, copies land in the internal org, billing skips it', { skip: !DatabaseSync }, async () => {
  const w = world({ d1: true });
  try {
    const a = await w.builder('Alpha Homes Pty Ltd', 'Amy');
    const ha = (await a.b.post('/portal/houses', { name: 'Alpha Villa', project: house() })).data;
    const i = await w.internal();
    assert.equal((await w.pstore.getOrg(i.orgId)).internal, true);
    assert.equal((await w.pstore.getOrg(a.orgId)).internal, false);
    assert.deepEqual((await i.b.get('/portal/houses')).data.map((h) => [h.builder.name, h.readOnly]), [['Alpha Homes Pty Ltd', true]]);
    assert.equal((await a.b.get(`/portal/houses/${ha.id}`)).status, 200);
    const dup = await i.b.post(`/portal/houses/${ha.id}/duplicate`, {});
    assert.equal(dup.data.orgId, i.orgId);
    assert.equal(await w.pstore.getHouse(a.orgId, dup.data.id), null);
    assert.equal((await i.b.post('/portal/houses', { id: ha.id, name: 'Hijacked' })).status, 404);
    const r = await i.b.post('/portal/clients', { firstName: 'Sarah', email: 's@x.example' });
    assert.equal(r.data.charge.amountCents, 0);
    w.clock.t = Date.UTC(2026, 11, 2, 1, 0, 0);
    assert.equal((await w.admin('POST', '/billing/run-month', { month: '2026-11', orgId: i.orgId })).data.results[0].reason, 'internal');
    assert.deepEqual(w.stripe, []);
    assert.equal((await w.admin('POST', `/portal/admin/orgs/${i.orgId}/internal`, { internal: false })).data.internal, false);
    assert.equal((await w.pstore.getOrg(i.orgId)).internal, false);
  } finally { w.restoreConsole(); }
});

test('H6: builder, client and internal logins each get an AI token the credits endpoint accepts; no token without a session', async () => {
  const w = world();
  try {
    const org = await w.builder('Coastal Homes Pty Ltd', 'Jo');
    const bTok = (await org.b.post('/portal/ai/token')).data;
    assert.equal(bTok.role, 'builder');
    const call = (t) => w.app.fetch(new Request(`${SITE}/api/credits`, { headers: { authorization: `Bearer ${t}` } }));
    assert.equal((await call(bTok.token)).status, 200);
    assert.equal((await org.b.call('POST', '/portal/ai/token', undefined)).status, 200);
    const anon = w.browser();
    assert.ok([401, 403].includes((await anon.post('/portal/ai/token')).status), 'no session, no token');
    assert.equal((await call('not-a-token')).status >= 400, true);
    const i = await w.internal();
    assert.equal((await call((await i.b.post('/portal/ai/token')).data.token)).status, 200);
  } finally { w.restoreConsole(); }
});

test('H6: the assistant never shows a Dev badge or Plan Pack wording to a signed-in login (source guard)', () => {
  const a = fs.readFileSync(new URL('../src/premium/ui/assistant.js', import.meta.url), 'utf8');
  assert.match(a, /st\.token \|\| !st\.devUnlock\) \? null/, 'the Dev badge needs devUnlock and no token');
  assert.match(a, /Sign in again to use the AI design assistant/);
  const p = fs.readFileSync(new URL('../src/premium/premium.js', import.meta.url), 'utf8');
  assert.match(p, /const dev = \(\) => !!cfg\.devUnlock && isLocalHost\(\)/);
  const c = fs.readFileSync(new URL('../src/portal/client-mode.js', import.meta.url), 'utf8');
  assert.match(c, /api\.aiToken/);
});

test('H7: an active builder needs billing details or a card before issuing client logins; internal is exempt; admin sees who month end will skip', async () => {
  const w = world();
  try {
    const org = await w.builder('Nobill Homes Pty Ltd', 'Ned', { noBilling: true });
    const refused = await org.b.post('/portal/clients', { firstName: 'Sarah' });
    assert.equal(refused.status, 409);
    assert.equal(refused.data.error?.code || refused.data.code, 'BILLING_DETAILS_REQUIRED');
    assert.match(JSON.stringify(refused.data), /legal business name, ABN and billing email/);
    assert.equal((await w.pstore.listUsers(org.orgId, false)).length, 0, 'no login was created');
    // a card on file also unlocks it
    await w.pstore.updateOrg(org.orgId, { paymentMethodId: 'pm_test' });
    assert.equal((await org.b.post('/portal/clients', { firstName: 'Sarah' })).status, 201);
    await w.pstore.updateOrg(org.orgId, { paymentMethodId: null });
    const view = (await w.admin('GET', '/portal/admin/orgs')).data.find((o) => o.id === org.orgId);
    assert.equal(view.billingSkipRisk, true, 'issued a login this month with no contact details');
    assert.equal(view.billingReady, false);
    // saving the details clears it
    assert.equal((await org.b.call('PUT', '/portal/billing/contact', { name: 'Ned', email: 'n@nobill.example', phone: '', legalName: 'Nobill Homes Pty Ltd', abn: '51824753556' })).status, 200);
    const after = (await w.admin('GET', '/portal/admin/orgs')).data.find((o) => o.id === org.orgId);
    assert.equal(after.billingSkipRisk, false);
    assert.equal(after.billingReady, true);
    // internal accounts never need billing details
    const i = await w.internal();
    assert.equal((await i.b.post('/portal/clients', { firstName: 'Tess' })).status, 201);
    assert.equal((await w.admin('GET', '/portal/admin/orgs')).data.find((o) => o.id === i.orgId).billingSkipRisk, false);
  } finally { w.restoreConsole(); }
});
