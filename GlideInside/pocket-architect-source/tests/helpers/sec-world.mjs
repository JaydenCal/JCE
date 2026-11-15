// Test world for the security regression tests (adapted from the pre-launch security harness): runs the real Worker app (createApp) in process on a SQLite shim of D1, mocked Stripe and Anthropic.
// Nothing here touches the network. Secrets below are throwaway test values.
import fs from 'node:fs';
const SRC = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
const L = (p) => import(`${SRC}/${p}`);
const { createApp } = await L('server/lib/app.js');
const { createD1Store } = await L('server/lib/store.js');
const { createD1PortalStore } = await L('server/lib/portal-store.js');
const { createD1ProfileStore } = await L('server/lib/profile-store.js');
const { signToken, issueToken } = await L('server/lib/entitlement.js');
const { DatabaseSync } = await import('node:sqlite');

export const SITE = 'https://site.test';
export const ADMIN = 'admin-token-for-tests-0123456789';
export const SECRET = 'e'.repeat(40);
export const WH = 'whsec_testsecret';
export const T0 = Date.UTC(2026, 10, 11, 1, 0, 0);
export const PW = 'Correct-horse-battery-9';

export function makeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(`${SRC}/server/schema.sql`, 'utf8'));
  const norm = (a) => a.map((v) => (v === undefined ? null : v));
  const statement = (sql, args = []) => ({
    bind: (...a) => statement(sql, norm(a)),
    run: async () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
  });
  return { prepare: (sql) => statement(sql), _db: db };
}
const jr = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

export async function world({ env = {}, files = false } = {}) {
  const clock = { t: T0 };
  const db = makeD1();
  const store = createD1Store(db), portalStore = createD1PortalStore(db), profileStore = createD1ProfileStore(db);
  const calls = { stripe: [], anthropic: [], other: [] };
  const state = { stripeSessions: {}, ai: { usage: { input_tokens: 1000, output_tokens: 100 }, text: 'Ok <img src=x onerror=alert(1)>' } };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.origin === 'https://api.anthropic.com') {
      calls.anthropic.push(JSON.parse(init.body)); if (state.ai.delay) await new Promise((r) => setTimeout(r, state.ai.delay));
      return jr({ content: [{ type: 'text', text: state.ai.text }], usage: state.ai.usage, stop_reason: 'end_turn' });
    }
    if (u.origin === 'https://api.stripe.com') {
      const path = u.pathname.replace('/v1', '');
      calls.stripe.push({ method: init.method || 'GET', path });
      const m = /^\/checkout\/sessions\/(.+)$/.exec(path);
      if (m && state.stripeSessions[m[1]]) return jr(state.stripeSessions[m[1]]);
      if (init.method === 'POST' && path === '/checkout/sessions') return jr({ id: 'cs_test_x', url: 'https://checkout.stripe.test/x' });
      if (init.method === 'POST' && path === '/customers') return jr({ id: 'cus_1' });
      return jr({ error: { message: 'nf' } }, 404);
    }
    calls.other.push(String(url));
    throw new Error('unexpected fetch ' + url); // SSRF canary: anything else is a failure
  };
  const putFiles = new Map();
  const R2 = files ? { async put(k, v) { putFiles.set(k, v); }, async get(k) { const v = putFiles.get(k); return v == null ? null : { text: async () => v, body: v }; }, async delete(k) { putFiles.delete(k); } } : null;
  const app = createApp({
    store, portalStore, profileStore, fetchImpl, now: () => clock.t, files: R2,
    catalogue: () => import(`${SRC}/src/catalogue/index.js`).then((m) => m.catalogue ?? m.default ?? m),
    loadJsPDF: () => import(`${SRC}/node_modules/jspdf/dist/jspdf.node.min.js`).then((m) => m.jsPDF || m.default?.jsPDF || m.default),
    env: { SITE_URL: SITE, ENTITLEMENT_SECRET: SECRET, PORTAL_ENABLED: '1', ADMIN_TOKEN: ADMIN, STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_WEBHOOK_SECRET: WH, ANTHROPIC_API_KEY: 'ak-test', IP_HASH_SALT: 'salt', ...env },
  });
  const w = { clock, db, store, portalStore, profileStore, app, calls, state, R2, putFiles };
  w.req = async (method, path, { body, headers = {}, raw } = {}) => {
    const res = await app.fetch(new Request(`${SITE}/api${path}`, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }));
    const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch {}
    return { status: res.status, data, text, headers: res.headers, cookies: res.headers.getSetCookie?.() || [] };
  };
  let ipSeq = 1;
  w.browser = (cookieName = 'gi_session', base = {}) => {
    const jar = { v: null }; const ip = base.ip || `203.0.113.${(ipSeq++ % 250) + 1}`;
    const call = async (method, path, body, { headers = {}, csrf = true, origin = SITE, secFetch } = {}) => {
      const h = { 'cf-connecting-ip': ip, ...headers };
      if (jar.v) h.cookie = `${cookieName}=${jar.v}`;
      if (csrf) h['x-gi-request'] = '1';
      if (origin) h.origin = origin;
      if (secFetch) h['sec-fetch-site'] = secFetch;
      const r = await w.req(method, path, { body, headers: h });
      for (const c of r.cookies) { const m = new RegExp(`^${cookieName}=([^;]*)`).exec(c); if (m) jar.v = m[1] || null; }
      return r;
    };
    return { jar, call, get: (p, o) => call('GET', p, undefined, o), post: (p, b, o) => call('POST', p, b ?? {}, o), put: (p, b, o) => call('PUT', p, b, o), patch: (p, b, o) => call('PATCH', p, b, o), del: (p, o, b) => call('DELETE', p, b, o) };
  };
  w.admin = (method, path, body, token = ADMIN) => w.req(method, path, { body: method === 'GET' ? undefined : body ?? {}, headers: { authorization: `Bearer ${token}` } });
  w.makeOrg = async (name = 'Sample Homes Pty Ltd', first = 'Priya', extra = {}) => {
    const r = await w.admin('POST', '/portal/admin/orgs', { name, adminFirstName: first, adminEmail: `${first.toLowerCase()}@${name.split(' ')[0].toLowerCase()}.example`, ...extra });
    if (r.status !== 201) throw new Error('makeOrg ' + r.text);
    const b = w.browser();
    await b.post('/portal/session', { identifier: r.data.credentials.username, password: r.data.credentials.password });
    await b.post('/portal/password', { currentPassword: r.data.credentials.password, newPassword: PW });
    await b.put('/portal/billing/contact', { name: first, email: `acc@${name.split(' ')[0].toLowerCase()}.example`, phone: '', legalName: name, abn: '51824753556' });
    return { orgId: r.data.org.id, admin: b, user: r.data.admin, username: r.data.credentials.username };
  };
  w.makeClient = async (org, first = 'Sarah', body = {}) => {
    const r = await org.admin.post('/portal/clients', { firstName: first, ...body });
    if (r.status !== 201) throw new Error('makeClient ' + r.text);
    const b = w.browser();
    await b.post('/portal/session', { identifier: r.data.credentials.username, password: r.data.credentials.password });
    await b.post('/portal/password', { currentPassword: r.data.credentials.password, newPassword: 'Another-Long-Pass-77' });
    return { browser: b, client: r.data.client, username: r.data.credentials.username, password: 'Another-Long-Pass-77' };
  };
  w.stripeSig = async (body, { t = Math.floor(w.clock.t / 1000), secret = WH } = {}) => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`)))].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `t=${t},v1=${sig}`;
  };
  w.webhook = async (event, opts) => { const body = JSON.stringify(event); return w.req('POST', '/stripe/webhook', { raw: body, headers: { 'stripe-signature': await w.stripeSig(body, opts), 'content-type': 'application/json' } }); };
  w.packToken = async (projectId = 'proj_abc123', credits = 500) => {
    const id = 'ent_' + Math.random().toString(16).slice(2, 12);
    const { entitlement } = await store.createEntitlement({ id, projectId, email: 'buyer@example.com', stripeSessionId: 'cs_' + id, amountCents: 3000, currency: 'aud', creditsTotal: credits, status: 'active', createdAt: new Date(w.clock.t).toISOString(), expiresAt: new Date(w.clock.t + 365 * 86400000).toISOString() });
    return { token: await issueToken(entitlement, { entitlementSecret: SECRET, entitlementDays: 365 }, w.clock.t), ent: entitlement };
  };
  return w;
}

export { signToken, issueToken };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
