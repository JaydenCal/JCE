// Cross account leak (round 7): two tabs of ONE browser (one shared cookie jar) signed in as two different builders must each keep their own
// account, in every portal call, and signing out in one tab must not change the other. Builder separation on the owner import is checked too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers/portal-lite.mjs';
import { createFromTemplate } from '../src/catalogue/templates.js';
import { createHttpApi } from '../src/portal/api.js';
import { getTabKey, setTabKey, clearTabKey } from '../src/portal/tab-session.js';

const sample = (name) => { const p = createFromTemplate('house_single'); p.name = name; return p; };
async function twoBuilders() {
  const w = makeWorld();
  const tim = await w.makeOrg('Hastings Valley Sheds', 'Tim');
  const greg = await w.makeOrg('Cole Building Group', 'Greg');
  return { w, tim, greg };
}
const importHouses = (w, orgId, names, extra = {}) => w.admin('POST', `/portal/admin/orgs/${orgId}/houses`, { houses: names.map((n) => ({ name: n, project: sample(n) })), ...extra });

test('two tabs signed in as two builders each keep their own library, whichever signed in last', async () => {
  const { w, tim, greg } = await twoBuilders();
  assert.equal((await importHouses(w, tim.id, ['Shed A', 'Shed B', 'Shed C'])).data.created, 3);
  assert.equal((await importHouses(w, greg.id, ['Fischer', 'Watters'])).data.created, 2);
  const b = w.browser();
  const tabTim = b.tab(); const tabGreg = b.tab();
  await tim.signIn(tabTim);
  await greg.signIn(tabGreg); // the shared cookie now holds Greg
  assert.ok(tabTim.key && tabGreg.key && tabTim.key !== tabGreg.key, 'each tab has its own session key');
  const t = await tabTim.get('/portal/houses'); const g = await tabGreg.get('/portal/houses');
  assert.deepEqual(t.data.map((h) => h.name).sort(), ['Shed A', 'Shed B', 'Shed C'], 'Tim still sees his own 3 designs');
  assert.deepEqual(g.data.map((h) => h.name).sort(), ['Fischer', 'Watters']);
  assert.equal((await tabTim.get('/portal/me')).data.org.id, tim.id);
  assert.equal((await tabGreg.get('/portal/me')).data.org.id, greg.id);
  // the old behaviour, for contrast: a request with no tab key follows the cookie, i.e. the most recent sign in
  assert.equal((await tabTim.call('GET', '/portal/me', undefined, { sendKey: false })).data.org.id, greg.id);
});

test('signing out in one tab does not change the other tab, and a bad tab key is never replaced by the shared cookie', async () => {
  const { w, tim, greg } = await twoBuilders();
  const b = w.browser(); const a = b.tab(); const c = b.tab();
  await tim.signIn(a); await greg.signIn(c);
  assert.equal((await c.del('/portal/session')).status, 200); // Greg signs out in his tab
  assert.equal((await c.get('/portal/me')).status, 401, 'Greg\'s tab is signed out');
  assert.equal((await a.get('/portal/me')).data.org.id, tim.id, 'Tim\'s tab is untouched');
  assert.equal((await a.get('/portal/houses')).status, 200);
  // Tim signs out too: his tab ends, and a tab with a stale key does NOT fall back to whatever the cookie holds
  await greg.signIn(c);
  const stale = b.tab(); stale.key = a.key;
  assert.equal((await a.del('/portal/session')).status, 200);
  assert.equal((await stale.get('/portal/me')).status, 401);
  assert.equal((await c.get('/portal/me')).data.org.id, greg.id, 'Greg signed in again in his tab and is unaffected by Tim signing out');
  const fake = b.tab(); fake.key = 'not-a-real-session-key';
  assert.equal((await fake.get('/portal/houses')).status, 401, 'an unknown key is refused, never replaced by the cookie');
});

test('a tab opened with no key adopts its own new session for the account the cookie holds, and signing out there leaves other tabs alone', async () => {
  const { w, tim, greg } = await twoBuilders();
  const b = w.browser(); const a = b.tab();
  await tim.signIn(a);
  const fresh = b.tab(); // a new tab: no key yet
  const adopt = await fresh.post('/portal/session/tab');
  assert.equal(adopt.status, 200); assert.equal(adopt.data.org.id, tim.id);
  assert.ok(fresh.key && fresh.key !== a.key, 'a separate session for the same login');
  const g = b.tab(); await greg.signIn(g);
  assert.equal((await fresh.get('/portal/me')).data.org.id, tim.id, 'the adopted tab stays on Tim after Greg signs in elsewhere');
  await fresh.del('/portal/session');
  assert.equal((await a.get('/portal/me')).data.org.id, tim.id, 'the first tab is still signed in');
});

test('the client api keeps the account per tab (sessionStorage key sent as X-GI-Tab on every call)', async () => {
  const { w, tim, greg } = await twoBuilders();
  await importHouses(w, tim.id, ['Shed A', 'Shed B']); await importHouses(w, greg.id, ['Fischer']);
  const jar = { cookie: null };
  const ls = new Map();
  globalThis.localStorage = { getItem: (k) => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
  const fetchImpl = async (url, init = {}) => {
    const h = { ...(init.headers || {}), origin: 'https://site.test' }; if (jar.cookie) h.cookie = `gi_session=${jar.cookie}`;
    const res = await w.app.fetch(new Request(`https://site.test${url}`, { method: init.method, headers: h, body: init.body }));
    for (const c of res.headers.getSetCookie?.() || []) { const m = /^gi_session=([^;]*)/.exec(c); if (m) jar.cookie = m[1] || null; }
    return res;
  };
  const api = createHttpApi({ base: '/api', fetchImpl });
  const tabs = { tim: new Map(), greg: new Map() };
  const inTab = async (name, fn) => { globalThis.sessionStorage = { getItem: (k) => tabs[name].get(k) ?? null, setItem: (k, v) => tabs[name].set(k, String(v)), removeItem: (k) => tabs[name].delete(k) }; return fn(); };
  await inTab('tim', () => api.signIn({ identifier: tim.username, password: tim.password }));
  await inTab('greg', () => api.signIn({ identifier: greg.username, password: greg.password }));
  assert.ok(tabs.tim.get('gi.portal.tab') && tabs.greg.get('gi.portal.tab') && tabs.tim.get('gi.portal.tab') !== tabs.greg.get('gi.portal.tab'));
  assert.deepEqual((await inTab('tim', () => api.listHouses())).map((h) => h.name).sort(), ['Shed A', 'Shed B']);
  assert.deepEqual((await inTab('greg', () => api.listHouses())).map((h) => h.name), ['Fischer']);
  assert.equal((await inTab('tim', () => api.me())).org.id, tim.id);
  await inTab('greg', () => api.signOut());
  assert.equal(tabs.greg.get('gi.portal.tab'), undefined, 'the signed out tab forgets its key');
  assert.equal((await inTab('tim', () => api.me())).org.id, tim.id, 'Tim\'s tab still shows Tim after Greg signed out');
  // a brand new tab (no key) pins itself to the account the cookie shows when it first asks who is signed in
  tabs.third = new Map();
  await inTab('tim', () => api.signIn({ identifier: tim.username, password: tim.password }));
  const third = await inTab('third', () => api.me());
  assert.equal(third.org.id, tim.id); assert.ok(tabs.third.get('gi.portal.tab'));
  delete globalThis.sessionStorage; delete globalThis.localStorage;
  clearTabKey(); assert.equal(getTabKey(), '', 'no key without sessionStorage'); setTabKey('x'); assert.equal(getTabKey(), 'x'); clearTabKey(); assert.equal(getTabKey(), '');
});

test('builder separation: the import writes only the org in the URL, the library lists only that org, and exclusive leaves exactly the imported designs', async () => {
  const { w, tim, greg } = await twoBuilders();
  await importHouses(w, tim.id, ['Shed A', 'Shed B']);
  await importHouses(w, greg.id, ['Old Design', 'Other Old']);
  const b = w.browser(); const tg = b.tab(); await greg.signIn(tg); const tt = b.tab(); await tim.signIn(tt);
  const four = ['Fischer', 'Watters', 'Watson Duplex', 'Keogh'];
  const r = await importHouses(w, greg.id, four, { exclusive: true });
  assert.equal(r.status, 200); assert.equal(r.data.created, 4); assert.equal(r.data.archived, 2);
  assert.deepEqual((await tg.get('/portal/houses')).data.map((h) => h.name).sort(), [...four].sort(), 'Cole holds only the four designs');
  assert.deepEqual((await tt.get('/portal/houses')).data.map((h) => h.name).sort(), ['Shed A', 'Shed B'], 'the other builder is untouched');
  assert.deepEqual((await tg.get('/portal/glide-library')).data, [], 'no Glide library for a builder');
  assert.equal((await tg.get('/portal/glide-library/anything')).status, 404);
  // importing again replaces by name inside this org only
  const again = await importHouses(w, greg.id, ['Keogh']);
  assert.equal(again.data.replaced, 1);
  assert.equal((await tg.get('/portal/houses')).data.length, 4);
  assert.equal((await w.admin('POST', '/portal/admin/orgs/does-not-exist/houses', { houses: [{ name: 'x', project: sample('x') }] })).status, 404);
});
