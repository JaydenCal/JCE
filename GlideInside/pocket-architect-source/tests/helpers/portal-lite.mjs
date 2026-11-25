// A small in memory portal for tests: the real app (server/lib/app.js) over the memory stores, an admin helper, orgs with a signed in admin,
// and a browser with ONE shared cookie jar that can open several tabs (each tab keeps its own session key, as src/portal/tab-session.js does).
import assert from 'node:assert/strict';
import { createApp } from '../../server/lib/app.js';
import { createMemoryStore } from '../../server/lib/store.js';
import { createMemoryPortalStore } from '../../server/lib/portal-store.js';

export const SITE = 'https://site.test';
export const ADMIN_TOKEN = 'admin-token-for-tests-0123456789';
const T0 = Date.UTC(2026, 10, 25, 1, 0, 0);

export function makeWorld(env = {}, fetchImpl = async () => { throw new Error('no network in tests'); }) {
  const clock = { t: T0 };
  const store = createMemoryStore();
  const pstore = createMemoryPortalStore();
  const app = createApp({ store, portalStore: pstore, fetchImpl, now: () => clock.t, env: { SITE_URL: SITE, ENTITLEMENT_SECRET: 'unit-test-secret', PORTAL_ENABLED: '1', ADMIN_TOKEN, ...env } });
  const world = { clock, store, pstore, app };
  let ip = 1;
  world.raw = (method, path, body, headers = {}) => app.fetch(new Request(`${SITE}/api${path}`, { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${ip++ % 250}`, ...headers }, body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body) }));
  world.admin = (method, path, body) => world.raw(method, path, body ?? {}, { authorization: `Bearer ${ADMIN_TOKEN}` }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
  /** A browser: one cookie jar shared by all its tabs. Each tab keeps the X-GI-Tab key a sign in returned, like sessionStorage does. */
  world.browser = () => {
    const jar = { cookie: null };
    const tab = () => {
      const t = { key: '' };
      t.call = async (method, path, body, { sendKey = true } = {}) => {
        const h = { 'x-gi-request': '1', origin: SITE };
        if (jar.cookie) h.cookie = `gi_session=${jar.cookie}`;
        if (sendKey && t.key) h['x-gi-tab'] = t.key;
        const res = await world.raw(method, path, body, h);
        for (const c of res.headers.getSetCookie?.() || []) { const m = /^gi_session=([^;]*)/.exec(c); if (m) jar.cookie = m[1] || null; }
        const k = res.headers.get('x-gi-tab');
        if (k) t.key = k;
        return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
      };
      t.get = (p) => t.call('GET', p); t.post = (p, b) => t.call('POST', p, b ?? {}); t.patch = (p, b) => t.call('PATCH', p, b); t.put = (p, b) => t.call('PUT', p, b); t.del = (p) => t.call('DELETE', p);
      return t;
    };
    return { jar, tab };
  };
  /** Creates an org and signs its admin in on a fresh browser tab, past the forced password change. */
  world.makeOrg = async (name, first = 'Priya', extra = {}) => {
    const r = await world.admin('POST', '/portal/admin/orgs', { name, adminFirstName: first, adminEmail: `${first.toLowerCase()}@${name.split(' ')[0].toLowerCase()}.example`, ...extra });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const org = { id: r.data.org.id, name, username: r.data.admin.username, password: 'Correct-Horse-Battery-9', first: r.data.credentials.password };
    const b = world.browser();
    const t = b.tab();
    assert.equal((await t.post('/portal/session', { identifier: r.data.credentials.username, password: r.data.credentials.password })).status, 200);
    assert.equal((await t.post('/portal/password', { currentPassword: r.data.credentials.password, newPassword: org.password })).status, 200);
    org.signIn = async (tab) => { const s = await tab.post('/portal/session', { identifier: org.username, password: org.password }); assert.equal(s.status, 200, JSON.stringify(s.data)); return s; };
    return org;
  };
  return world;
}

export const saveEnquiry = (world, body) => world.raw('POST', '/enquiry/jce', body, { 'x-gi-request': '1', origin: SITE }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
