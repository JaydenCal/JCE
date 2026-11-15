// Free user profiles: sign up validation, hashing, no enumeration, rate limits, consent records, save / list / open / delete, the design limit,
// Plan Pack linking, account deletion, the owner's contact list and exports, the prompt rules, autosave and the migration of the local design.
// Server tests run on the in-memory store and again on D1 (a SQLite shim over server/schema.sql). Client tests use the real Worker app as the fetch.
// No password in these tests is a real one, no email is sent and nothing here touches the network.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../server/lib/app.js';
import { createMemoryStore, createD1Store } from '../server/lib/store.js';
import { createMemoryProfileStore, createD1ProfileStore } from '../server/lib/profile-store.js';
import { verifyPassword } from '../server/lib/password.js';
import { issueToken } from '../server/lib/entitlement.js';
import { csvCell, ddmmyyyy } from '../server/lib/profiles.js';
import { createProfileApi, ProfileError } from '../src/profile/api.js';
import { createProfileController, hasWork, isMeaningfulLabel } from '../src/profile/controller.js';
import { createPromptPolicy } from '../src/profile/policy.js';
import { hasOtherAccount } from '../src/profile/accounts.js';
import { MARKETING_TEXT, MARKETING_TEXT_VERSION, MARKETING_TEXTS, TERMS_VERSION, passwordStrength } from '../src/profile/wording.js';
import { createStore } from '../src/model/store.js';
import { createProject } from '../src/model/schema.js';
import { applyOp } from '../src/model/ops.js';

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  /* D1 shim runs are skipped without node:sqlite */
}

const SITE = 'https://site.test';
const ADMIN = 'admin-token-for-tests-0123456789';
const T0 = Date.UTC(2026, 10, 15, 1, 0, 0);
const MIN = 60000;
const DAY = 86400000;
// Test passwords only. They are typed into the test requests like a person would and never stored in plain text anywhere.
const PW = 'Correct-horse-battery-9';
const PW2 = 'Another-Passphrase-77';

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

function world({ d1 = false, env = {} } = {}) {
  const clock = { t: T0 };
  const db = d1 ? makeD1() : null;
  const store = d1 ? createD1Store(db) : createMemoryStore();
  const pstore = d1 ? createD1ProfileStore(db) : createMemoryProfileStore();
  const app = createApp({
    store, profileStore: pstore, now: () => clock.t,
    env: { SITE_URL: SITE, ENTITLEMENT_SECRET: 'e'.repeat(40), ADMIN_TOKEN: ADMIN, ...env },
    fetchImpl: async () => { throw new Error('no network in tests'); },
  });
  return { clock, store, pstore, app, db };
}

/** A browser: its own cookie jar and IP address. Returns { fetchImpl, call, cookie } where call(method, path, body) answers { status, body, headers }. */
function browser(w, { ip = '203.0.113.7' } = {}) {
  let cookie = '';
  const fetchImpl = async (url, init = {}) => {
    const headers = new Headers(init.headers || {});
    if (cookie) headers.set('cookie', cookie);
    headers.set('cf-connecting-ip', ip);
    if (!headers.has('origin')) headers.set('origin', SITE);
    const res = await w.app.fetch(new Request(url, { ...init, headers }));
    const sc = res.headers.get('set-cookie');
    if (sc) {
      const kv = sc.split(';')[0];
      cookie = kv.endsWith('=') ? '' : kv;
    }
    return res;
  };
  const call = async (method, path, body, extra = {}) => {
    const res = await fetchImpl(`${SITE}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-gi-request': '1', ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* CSV or empty */ }
    return { status: res.status, body: parsed, text, headers: res.headers };
  };
  return { fetchImpl, call, cookie: () => cookie, clear: () => { cookie = ''; } };
}

const signupBody = (over = {}) => ({ name: 'Sam Builder', email: 'sam@example.com', password: PW, acceptTerms: true, acceptPrivacy: true, ...over });
const sample = (id = 'p_sample01', name = 'Smith residence') => {
  const p = createProject({ id, name });
  applyOp(p, 'add_room', { type: 'living', name: 'Living', x: 0, y: 0, width: 6000, depth: 4500 });
  return p;
};
const admin = (w) => ({ headers: { authorization: `Bearer ${ADMIN}` }, call: (path) => browser(w, { ip: '198.51.100.9' }).call('GET', path, undefined, { authorization: `Bearer ${ADMIN}` }) });

const runs = [['memory', false]];
if (DatabaseSync) runs.push(['d1', true]);

for (const [label, d1] of runs) {
  // ---------------------------------------------------------------------------------------------------------------------------
  test(`[${label}] sign up: validation, hashing, cookie, no password in any answer`, async () => {
    const w = world({ d1 });
    const b = browser(w);
    const bad = async (over, pattern) => {
      const r = await b.call('POST', '/profile/signup', signupBody(over));
      assert.equal(r.status, 400, JSON.stringify(over));
      assert.match(r.body.error.message, pattern);
    };
    await bad({ name: '   ' }, /name/i);
    await bad({ email: 'not-an-email' }, /valid email/i);
    await bad({ password: 'short1' }, /at least 10/i);
    await bad({ password: 'password1234' }, /too common/i);
    await bad({ password: 'aaaaaaaaaaaa' }, /mix of characters/i);
    await bad({ email: 'samuel@example.com', password: 'Samuel-rocks-1234' }, /email/i);
    await bad({ password: 'x'.repeat(201) }, /10 to 200/);
    await bad({ acceptTerms: false }, /terms/i);
    await bad({ acceptPrivacy: undefined }, /privacy/i);
    await bad({ phone: 'abc' }, /phone/i);
    await bad({ postcode: '<script>' }, /postcode/i);
    await bad({ role: 'wizard' }, /I am a/);
    await bad({ marketing: 'yes' }, /true or false/i);
    assert.equal((await w.pstore.getProfileByEmail('sam@example.com')), null, 'nothing was created by the failed attempts');

    const ok = await b.call('POST', '/profile/signup', signupBody({ phone: '0412 345 678', postcode: 'Tamworth 2340', role: 'builder' }));
    assert.equal(ok.status, 201);
    assert.equal(ok.body.profile.name, 'Sam Builder');
    assert.equal(ok.body.profile.marketing, false, 'marketing consent is off unless the box was ticked');
    assert.equal(ok.body.profile.designLimit, 10);
    const cookie = ok.headers.get('set-cookie');
    assert.match(cookie, /^gi_profile=[A-Za-z0-9_-]{40,}; Path=\/api; HttpOnly; Secure; SameSite=Lax/);
    assert.ok(!ok.text.includes(PW) && !/passwordHash|password_hash|pbkdf2/.test(ok.text), 'the answer never carries the password or its hash');

    const stored = await w.pstore.getProfileByEmail('sam@example.com');
    assert.equal(stored.termsVersion, TERMS_VERSION);
    assert.ok(stored.termsAcceptedAt);
    assert.equal(stored.marketingConsent, false);
    assert.equal(stored.marketingConsentAt, null);
    assert.match(stored.passwordHash, /^pbkdf2-sha256\$100000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    assert.ok(!stored.passwordHash.includes(PW));
    assert.equal((await verifyPassword(PW, stored.passwordHash)).ok, true);
    assert.equal((await verifyPassword(`${PW}x`, stored.passwordHash)).ok, false);
    assert.equal(stored.phone, '0412 345 678');
    assert.equal(stored.role, 'builder');
    assert.deepEqual(await w.pstore.listConsentEvents(stored.id), []);

    // the same password gives a different hash (random salt)
    const other = browser(w, { ip: '203.0.113.8' });
    await other.call('POST', '/profile/signup', signupBody({ email: 'two@example.com' }));
    assert.notEqual((await w.pstore.getProfileByEmail('two@example.com')).passwordHash, stored.passwordHash);

    // /me with the cookie, and with none
    const me = await b.call('GET', '/profile/me');
    assert.equal(me.body.profile.email, 'sam@example.com');
    assert.ok(me.body.resetNote.includes('Contact us'));
    const anon = await browser(w).call('GET', '/profile/me');
    assert.equal(anon.status, 200);
    assert.equal(anon.body.profile, null);
  });

  test(`[${label}] marketing consent is opt in, recorded with time and exact wording, and can be withdrawn`, async () => {
    const w = world({ d1 });
    const b = browser(w);
    const r = await b.call('POST', '/profile/signup', signupBody({ marketing: true }));
    assert.equal(r.status, 201);
    assert.equal(r.body.profile.marketing, true);
    const p = await w.pstore.getProfileByEmail('sam@example.com');
    assert.equal(p.marketingConsent, true);
    assert.equal(p.marketingConsentAt, new Date(T0).toISOString());
    assert.equal(p.marketingTextVersion, MARKETING_TEXT_VERSION);
    const [ev] = await w.pstore.listConsentEvents(p.id);
    assert.equal(ev.consent, true);
    assert.equal(ev.text, MARKETING_TEXT, 'the exact words shown beside the tick box are kept');
    assert.equal(ev.textVersion, MARKETING_TEXT_VERSION);
    assert.equal(ev.source, 'signup');
    assert.equal(MARKETING_TEXT, 'Send me occasional Glide Inside updates and offers. You can unsubscribe at any time.');
    assert.equal(MARKETING_TEXTS[MARKETING_TEXT_VERSION], MARKETING_TEXT);

    w.clock.t += MIN;
    const off = await b.call('PUT', '/profile/preferences', { marketing: false });
    assert.equal(off.body.profile.marketing, false);
    const after = await w.pstore.getProfileByEmail('sam@example.com');
    assert.equal(after.marketingConsent, false);
    assert.equal(after.unsubscribed, true);
    assert.ok(after.unsubscribedAt);
    w.clock.t += MIN;
    const on = await b.call('PUT', '/profile/preferences', { marketing: true });
    assert.equal(on.body.profile.marketing, true);
    const again = await w.pstore.getProfileByEmail('sam@example.com');
    assert.equal(again.unsubscribed, false);
    assert.equal(again.marketingConsentAt, new Date(T0 + 2 * MIN).toISOString());
    assert.deepEqual((await w.pstore.listConsentEvents(p.id)).map((e) => [e.consent, e.source]), [[true, 'signup'], [false, 'preferences'], [true, 'preferences']]);
    assert.equal((await b.call('PUT', '/profile/preferences', { marketing: 'on' })).status, 400);
    assert.equal((await browser(w).call('PUT', '/profile/preferences', { marketing: true })).status, 401, 'signed out cannot change preferences');
  });

  test(`[${label}] sign in and out: generic errors, no account enumeration`, async () => {
    const w = world({ d1 });
    await browser(w).call('POST', '/profile/signup', signupBody());
    const b = browser(w, { ip: '203.0.113.50' });
    const wrongPw = await b.call('POST', '/profile/session', { email: 'sam@example.com', password: 'Wrong-password-123' });
    const noUser = await b.call('POST', '/profile/session', { email: 'nobody@example.com', password: 'Wrong-password-123' });
    const empty = await b.call('POST', '/profile/session', { email: '', password: '' });
    for (const r of [wrongPw, noUser, empty]) {
      assert.equal(r.status, 401);
      assert.equal(r.body.error.code, 'INVALID_CREDENTIALS');
    }
    assert.equal(wrongPw.body.error.message, noUser.body.error.message, 'same words whether or not the email has a profile');
    assert.equal(wrongPw.text, noUser.text);
    assert.equal(b.cookie(), '', 'a failed sign in sets no cookie');

    const ok = await b.call('POST', '/profile/session', { email: ' SAM@Example.com ', password: PW });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.profile.email, 'sam@example.com');
    assert.ok(b.cookie().startsWith('gi_profile='));
    assert.equal((await b.call('GET', '/profile/me')).body.profile.name, 'Sam Builder');
    const out = await b.call('DELETE', '/profile/session');
    assert.equal(out.status, 200);
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await b.call('GET', '/profile/me')).body.profile, null);

    // a duplicate sign up gets one fixed answer and is a 409 that does not create a second profile
    const dup = await browser(w, { ip: '203.0.113.60' }).call('POST', '/profile/signup', signupBody({ name: 'Imposter' }));
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'SIGNUP_FAILED');
    assert.match(dup.body.error.message, /could not create a profile with those details/);
    assert.equal((await w.pstore.getProfileByEmail('sam@example.com')).name, 'Sam Builder');
  });

  test(`[${label}] rate limits: sign up per address and per email, sign in per address and per email`, async () => {
    const w = world({ d1 });
    const a = browser(w, { ip: '192.0.2.10' });
    for (let i = 0; i < 5; i += 1) assert.equal((await a.call('POST', '/profile/signup', signupBody({ email: `u${i}@example.com` }))).status, 201);
    const sixth = await a.call('POST', '/profile/signup', signupBody({ email: 'u5@example.com' }));
    assert.equal(sixth.status, 429);
    assert.equal(sixth.body.error.code, 'RATE_LIMITED');
    assert.ok(sixth.headers.get('retry-after'));
    assert.equal(await w.pstore.getProfileByEmail('u5@example.com'), null);
    w.clock.t += 61 * MIN; // a new hour
    assert.equal((await a.call('POST', '/profile/signup', signupBody({ email: 'u5@example.com' }))).status, 201);

    // per email: 8 tries in 15 minutes from a spread of addresses
    const s = world({ d1 });
    await browser(s).call('POST', '/profile/signup', signupBody());
    let last;
    for (let i = 0; i < 9; i += 1) last = await browser(s, { ip: `192.0.2.${100 + i}` }).call('POST', '/profile/session', { email: 'sam@example.com', password: `Wrong-guess-${i}-abc` });
    assert.equal(last.status, 429, 'the ninth try for one email is stopped');
    assert.equal((await browser(s, { ip: '192.0.2.250' }).call('POST', '/profile/session', { email: 'sam@example.com', password: PW })).status, 429, 'even the right password waits');
    s.clock.t += 16 * MIN;
    assert.equal((await browser(s, { ip: '192.0.2.251' }).call('POST', '/profile/session', { email: 'sam@example.com', password: PW })).status, 200);

    // per address: 30 tries in 10 minutes across different emails
    const t = world({ d1 });
    const one = browser(t, { ip: '192.0.2.77' });
    let status = 0;
    for (let i = 0; i < 31; i += 1) status = (await one.call('POST', '/profile/session', { email: `x${i}@example.com`, password: 'Wrong-guess-abc-1' })).status;
    assert.equal(status, 429);
    // the answer is the same for known and unknown emails, so the limit does not reveal accounts either
    assert.equal((await one.call('POST', '/profile/session', { email: 'sam@example.com', password: 'x' })).status, 429);
  });

  test(`[${label}] CSRF: state changing calls need the custom header and a matching origin`, async () => {
    const w = world({ d1 });
    const b = browser(w);
    const raw = (headers) => b.fetchImpl(`${SITE}/api/profile/signup`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(signupBody()) });
    assert.equal((await raw({})).status, 403);
    assert.equal((await raw({ 'x-gi-request': '1', origin: 'https://evil.example' })).status, 403);
    // no Origin header (a non browser client) but the browser says the request came from another site
    const noOrigin = await w.app.fetch(new Request(`${SITE}/api/profile/signup`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-gi-request': '1', 'sec-fetch-site': 'cross-site' }, body: JSON.stringify(signupBody()) }));
    assert.equal(noOrigin.status, 403);
    assert.equal(await w.pstore.getProfileByEmail('sam@example.com'), null);
  });

  test(`[${label}] change password: needs the current one, signs other devices out`, async () => {
    const w = world({ d1 });
    const a = browser(w);
    await a.call('POST', '/profile/signup', signupBody());
    const phone = browser(w, { ip: '203.0.113.99' });
    await phone.call('POST', '/profile/session', { email: 'sam@example.com', password: PW });
    assert.equal((await a.call('POST', '/profile/password', { current: 'wrong-current-pass', next: PW2 })).status, 401);
    assert.equal((await a.call('POST', '/profile/password', { current: PW, next: 'short' })).status, 400);
    assert.equal((await a.call('POST', '/profile/password', { current: PW, next: PW })).status, 400);
    assert.equal((await a.call('POST', '/profile/password', { current: PW, next: PW2 })).status, 200);
    assert.equal((await a.call('GET', '/profile/me')).body.profile.email, 'sam@example.com', 'this device stays signed in');
    assert.equal((await phone.call('GET', '/profile/me')).body.profile, null, 'the other device is signed out');
    assert.equal((await browser(w, { ip: '203.0.113.120' }).call('POST', '/profile/session', { email: 'sam@example.com', password: PW })).status, 401);
    assert.equal((await browser(w, { ip: '203.0.113.121' }).call('POST', '/profile/session', { email: 'sam@example.com', password: PW2 })).status, 200);
    const stored = await w.pstore.getProfileByEmail('sam@example.com');
    assert.ok(!JSON.stringify(stored).includes(PW2));
  });

  test(`[${label}] my designs: save, list, open, rename, duplicate, delete, isolation, limit`, async () => {
    const w = world({ d1, env: { FREE_PROFILE_MAX_DESIGNS: '3' } });
    const b = browser(w);
    await b.call('POST', '/profile/signup', signupBody());
    assert.equal((await browser(w).call('GET', '/profile/designs')).status, 401);

    const resi = sample('p_resi0001', 'Smith residence');
    resi.site = { lot: { address: '12 Example St, Tamworth NSW', lotLabel: '1/DP1' }, underlay: { key: 'big-image' } };
    const thumb = `data:image/jpeg;base64,${Buffer.from('thumb').toString('base64')}`;
    const saved = await b.call('POST', '/profile/designs', { project: resi, thumbnail: thumb });
    assert.equal(saved.status, 201);
    assert.equal(saved.body.design.kind, 'residential');
    assert.equal(saved.body.design.address, '12 Example St, Tamworth NSW');
    assert.equal(saved.body.design.thumbnail, thumb);
    assert.equal(saved.body.created, true);

    const comm = sample('p_comm0001', 'Warehouse units');
    comm.mode = 'commercial';
    assert.equal((await b.call('POST', '/profile/designs', { project: comm })).body.design.kind, 'commercial');

    // the same design saved again is an update, never a second copy, and never counts against the limit
    resi.name = 'Smith residence v2';
    const upd = await b.call('POST', '/profile/designs', { project: resi });
    assert.equal(upd.status, 200);
    assert.equal(upd.body.created, false);
    assert.equal(upd.body.design.thumbnail, thumb, 'the picture is kept when an autosave sends none');
    const list = await b.call('GET', '/profile/designs');
    assert.equal(list.body.count, 2);
    assert.equal(list.body.limit, 3);
    assert.deepEqual(list.body.designs.map((d) => d.name).sort(), ['Smith residence v2', 'Warehouse units']);
    assert.ok(list.body.designs.every((d) => !('project' in d)), 'the list leaves out the design JSON');

    // open
    const open = await b.call('GET', `/profile/designs/${saved.body.design.id}`);
    assert.equal(open.body.project.name, 'Smith residence v2');
    assert.equal(open.body.project.site.underlay, null, 'the tracing underlay is never stored');
    assert.equal(open.body.pack, undefined);

    // rename also renames the design inside the JSON
    const ren = await b.call('PATCH', `/profile/designs/${saved.body.design.id}`, { name: '  Renamed   home ' });
    assert.equal(ren.body.design.name, 'Renamed home');
    assert.equal((await b.call('GET', `/profile/designs/${saved.body.design.id}`)).body.project.name, 'Renamed home');
    assert.equal((await b.call('PATCH', `/profile/designs/${saved.body.design.id}`, { name: '  ' })).status, 400);

    // duplicate gets its own project id
    const dup = await b.call('POST', `/profile/designs/${saved.body.design.id}/duplicate`, {});
    assert.equal(dup.status, 201);
    assert.equal(dup.body.design.name, 'Renamed home (copy)');
    assert.notEqual(dup.body.design.projectId, 'p_resi0001');
    assert.equal((await b.call('GET', `/profile/designs/${dup.body.design.id}`)).body.project.id, dup.body.design.projectId);

    // the limit: three kept, a fourth new design is refused with a plain message, updates still work
    const fourth = await b.call('POST', '/profile/designs', { project: sample('p_four0001', 'Fourth') });
    assert.equal(fourth.status, 409);
    assert.equal(fourth.body.error.code, 'DESIGN_LIMIT_REACHED');
    assert.match(fourth.body.error.message, /up to 3 designs/);
    assert.equal((await b.call('POST', `/profile/designs/${dup.body.design.id}/duplicate`, {})).status, 409, 'a copy counts too');
    assert.equal((await b.call('POST', '/profile/designs', { project: resi })).status, 200);

    // another profile cannot see, change or delete these
    const c = browser(w, { ip: '203.0.113.201' });
    await c.call('POST', '/profile/signup', signupBody({ email: 'other@example.com' }));
    assert.equal((await c.call('GET', `/profile/designs/${saved.body.design.id}`)).status, 404);
    assert.equal((await c.call('DELETE', `/profile/designs/${saved.body.design.id}`)).status, 404);
    assert.equal((await c.call('PATCH', `/profile/designs/${saved.body.design.id}`, { name: 'x' })).status, 404);
    assert.equal((await c.call('GET', '/profile/designs')).body.count, 0);

    // delete frees a place
    assert.equal((await b.call('DELETE', `/profile/designs/${dup.body.design.id}`)).status, 200);
    assert.equal((await b.call('GET', `/profile/designs/${dup.body.design.id}`)).status, 404);
    assert.equal((await b.call('POST', '/profile/designs', { project: sample('p_four0001', 'Fourth') })).status, 201);

    // bad input
    assert.equal((await b.call('POST', '/profile/designs', { project: { name: 'x' } })).status, 400);
    assert.equal((await b.call('POST', '/profile/designs', { project: { ...sample('p_x', 'x'), id: undefined } })).status, 400);
    const put = await b.call('PUT', `/profile/designs/${saved.body.design.id}`, { project: sample('p_other_id', 'wrong') });
    assert.equal(put.status, 400, 'an update must be the same design');
    const putOk = await b.call('PUT', `/profile/designs/${saved.body.design.id}`, { project: { ...resi, name: 'Via put' }, thumbnail: 'data:image/svg+xml;base64,AAAA' });
    assert.equal(putOk.body.design.name, 'Via put');
    assert.equal(putOk.body.design.thumbnail, thumb, 'only small raster pictures are accepted as thumbnails');
  });

  test(`[${label}] a design that is too large is refused`, async () => {
    const w = world({ d1, env: { PORTAL_PROJECT_MAX_BYTES: '5000' } });
    const b = browser(w);
    await b.call('POST', '/profile/signup', signupBody());
    const big = sample('p_big00001', 'Big');
    big.notes = 'x'.repeat(8000);
    const r = await b.call('POST', '/profile/designs', { project: big });
    assert.equal(r.status, 413);
    assert.equal(r.body.error.code, 'PROJECT_TOO_LARGE');
  });

  test(`[${label}] Plan Pack linked to the profile is handed back on another device`, async () => {
    const w = world({ d1 });
    const nowMs = w.clock.t;
    const { entitlement: ent } = await w.store.createEntitlement({
      id: 'ent_test0001', projectId: 'p_pack0001', email: 'sam@example.com', stripeSessionId: 'cs_test_1', amountCents: 3000, currency: 'aud', creditsTotal: 500,
      status: 'active', createdAt: new Date(nowMs).toISOString(), expiresAt: new Date(nowMs + 300 * DAY).toISOString(),
    });
    const cfg = w.app.config;
    const token = await issueToken(ent, cfg, nowMs);
    const laptop = browser(w);
    await laptop.call('POST', '/profile/signup', signupBody());
    await laptop.call('POST', '/profile/designs', { project: sample('p_pack0001', 'Paid design') });
    // a pack token for a different pack, or none, is refused
    assert.equal((await laptop.call('POST', '/profile/packs', {})).status, 401);
    assert.equal((await laptop.call('POST', '/profile/packs', {}, { authorization: 'Bearer nonsense' })).status, 401);
    const linked = await laptop.call('POST', '/profile/packs', {}, { authorization: `Bearer ${token}` });
    assert.equal(linked.status, 200);
    assert.equal(linked.body.linked, true);
    assert.equal((await browser(w).call('POST', '/profile/packs', {}, { authorization: `Bearer ${token}` })).status, 401, 'signed out cannot link');

    const desktop = browser(w, { ip: '203.0.113.31' });
    await desktop.call('POST', '/profile/session', { email: 'sam@example.com', password: PW });
    const [d] = (await desktop.call('GET', '/profile/designs')).body.designs;
    const opened = await desktop.call('GET', `/profile/designs/${d.id}`);
    assert.equal(opened.body.pack.projectId, 'p_pack0001');
    assert.equal(opened.body.pack.receipt, 'ent_test0001');
    assert.match(opened.body.pack.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    // the entitlement model is unchanged: the new token works exactly like the old one
    const credits = await desktop.fetchImpl(`${SITE}/api/credits?project=p_pack0001`, { headers: { authorization: `Bearer ${opened.body.pack.token}` } });
    assert.equal(credits.status, 200);

    // refunded packs are not handed back
    await w.store.setEntitlementStatus('ent_test0001', 'refunded');
    assert.equal((await desktop.call('GET', `/profile/designs/${d.id}`)).body.pack, undefined);
    // testing codes (project *) cannot be linked
    const code = await w.store.createEntitlement({ id: 'ent_code0001', projectId: '*', email: 'x@y.co', stripeSessionId: 'code:x', amountCents: 0, currency: 'aud', creditsTotal: 5, status: 'active', createdAt: new Date(nowMs).toISOString(), expiresAt: new Date(nowMs + DAY).toISOString() });
    const ct = await issueToken(code.entitlement, cfg, nowMs, 'p_pack0001');
    assert.equal((await laptop.call('POST', '/profile/packs', {}, { authorization: `Bearer ${ct}` })).status, 400);
  });

  test(`[${label}] delete my account: password required, removes the profile, designs, sessions, links and consent record`, async () => {
    const w = world({ d1 });
    const b = browser(w);
    const other = browser(w, { ip: '203.0.113.88' });
    await other.call('POST', '/profile/signup', signupBody({ email: 'keeper@example.com' }));
    await other.call('POST', '/profile/designs', { project: sample('p_keep0001', 'Keeper') });
    await b.call('POST', '/profile/signup', signupBody({ marketing: true }));
    const id = (await w.pstore.getProfileByEmail('sam@example.com')).id;
    await b.call('POST', '/profile/designs', { project: sample('p_del00001', 'One') });
    await b.call('POST', '/profile/designs', { project: sample('p_del00002', 'Two') });
    const phone = browser(w, { ip: '203.0.113.89' });
    await phone.call('POST', '/profile/session', { email: 'sam@example.com', password: PW });

    assert.equal((await b.call('DELETE', '/profile', {})).status, 401);
    assert.equal((await b.call('DELETE', '/profile', { password: 'not-my-password-1' })).status, 401);
    assert.equal((await b.call('GET', '/profile/designs')).body.count, 2, 'a wrong password deletes nothing');
    assert.equal((await browser(w).call('DELETE', '/profile', { password: PW })).status, 401);

    const del = await b.call('DELETE', '/profile', { password: PW });
    assert.equal(del.status, 200);
    assert.match(del.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal(await w.pstore.getProfile(id), null);
    assert.equal(await w.pstore.getProfileByEmail('sam@example.com'), null);
    assert.equal(await w.pstore.countDesigns(id), 0);
    assert.deepEqual(await w.pstore.listConsentEvents(id), []);
    assert.deepEqual(await w.pstore.listPacks(id), []);
    assert.equal((await b.call('GET', '/profile/me')).body.profile, null);
    assert.equal((await phone.call('GET', '/profile/me')).body.profile, null, 'every device is signed out');
    assert.equal((await browser(w, { ip: '203.0.113.90' }).call('POST', '/profile/session', { email: 'sam@example.com', password: PW })).status, 401);
    if (d1) {
      for (const t of ['profile_designs', 'profile_sessions', 'profile_consent_events', 'profile_packs']) {
        assert.equal(w.db._db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE profile_id = ?`).get(id).n, 0, `${t} is empty for the deleted profile`);
      }
    }
    // someone else's profile and designs are untouched, and the email can be used again
    assert.equal((await other.call('GET', '/profile/designs')).body.count, 1);
    assert.equal((await browser(w, { ip: '203.0.113.91' }).call('POST', '/profile/signup', signupBody())).status, 201);
  });

  test(`[${label}] owner contacts: token gate, filters, marketing export is consenting only, full export is marked, unsubscribe flag respected`, async () => {
    const w = world({ d1 });
    const mk = async (email, over, ip) => {
      const b = browser(w, { ip });
      const r = await b.call('POST', '/profile/signup', signupBody({ email, name: email.split('@')[0], ...over }));
      assert.equal(r.status, 201, email);
      return b;
    };
    const yes = await mk('yes@example.com', { marketing: true, role: 'builder', postcode: 'Tamworth 2340', name: '=HYPERLINK("x")' }, '10.0.0.1');
    await mk('no@example.com', { marketing: false, role: 'homeowner', postcode: 'Armidale' }, '10.0.0.2');
    const flip = await mk('flip@example.com', { marketing: true, role: 'developer' }, '10.0.0.3');
    await mk('plain@example.com', {}, '10.0.0.4');
    await yes.call('POST', '/profile/designs', { project: sample('p_c_resi', 'R') });
    const c = sample('p_c_comm', 'C');
    c.mode = 'commercial';
    await yes.call('POST', '/profile/designs', { project: c });
    await flip.call('PUT', '/profile/preferences', { marketing: false }); // unsubscribed after consenting

    const A = (path) => admin(w).call(path);
    assert.equal((await browser(w).call('GET', '/profile/admin/contacts')).status, 401);
    assert.equal((await browser(w).call('GET', '/profile/admin/contacts', undefined, { authorization: 'Bearer nope' })).status, 401);
    assert.equal((await browser(w).call('GET', '/profile/admin/contacts.csv')).status, 401);
    assert.equal((await yes.call('GET', '/profile/admin/contacts')).status, 401, 'a signed in profile is not the owner');

    const all = (await A('/profile/admin/contacts')).body;
    assert.equal(all.total, 4);
    assert.equal(all.marketable, 1);
    assert.ok(all.contacts.every((x) => !('passwordHash' in x) && !JSON.stringify(x).includes('pbkdf2')));
    const by = (qs) => A(`/profile/admin/contacts${qs}`).then((r) => r.body.contacts.map((x) => x.email).sort());
    assert.deepEqual(await by('?consent=yes'), ['yes@example.com']);
    assert.deepEqual(await by('?consent=no'), ['flip@example.com', 'no@example.com', 'plain@example.com']);
    assert.deepEqual(await by('?type=builder'), ['yes@example.com']);
    assert.deepEqual(await by('?type=unspecified'), ['plain@example.com']);
    assert.deepEqual(await by('?designs=some'), ['yes@example.com']);
    assert.deepEqual(await by('?designs=none'), ['flip@example.com', 'no@example.com', 'plain@example.com']);
    assert.deepEqual(await by('?mode=commercial'), ['yes@example.com']);
    assert.deepEqual(await by('?mode=both'), ['yes@example.com']);
    assert.deepEqual(await by('?suburb=tamworth'), ['yes@example.com']);
    assert.deepEqual(await by('?suburb=2340'), ['yes@example.com']);
    assert.deepEqual(await by('?from=2026-11-15&to=2026-11-15'), ['flip@example.com', 'no@example.com', 'plain@example.com', 'yes@example.com']);
    assert.deepEqual(await by('?from=2026-11-16'), []);
    assert.deepEqual(await by('?q=plain'), ['plain@example.com']);

    // marketing export: consenting and not unsubscribed only, whatever the filters ask for
    assert.equal((await A('/profile/admin/contacts.csv?scope=marketing&consent=no')).text.replace(/^\ufeff/, '').trim().split('\r\n').length, 1, 'asking for non consenting contacts in the marketing export gives nothing');
    const mkt = await A('/profile/admin/contacts.csv?scope=marketing');
    assert.equal(mkt.status, 200);
    assert.match(mkt.headers.get('content-type'), /text\/csv/);
    assert.match(mkt.headers.get('content-disposition'), /glide-inside-marketing-contacts-15-11-2026\.csv/);
    const lines = mkt.text.replace(/^﻿/, '').trim().split('\r\n');
    assert.equal(lines.length, 2, 'header and the one consenting contact');
    assert.ok(lines[1].includes('yes@example.com'));
    assert.ok(!mkt.text.includes('no@example.com') && !mkt.text.includes('flip@example.com') && !mkt.text.includes('plain@example.com'));
    assert.ok(lines[1].includes(`"'=HYPERLINK(""x"")"`), 'a typed formula is defused in the spreadsheet');
    assert.ok(lines[1].includes('15/11/2026') && lines[1].includes(MARKETING_TEXT_VERSION), 'consent date DD/MM/YYYY and the wording version');
    assert.equal((await A('/profile/admin/contacts.csv')).text, mkt.text, 'marketing is the default scope');

    // full export: everyone, clearly not for marketing
    const full = await A('/profile/admin/contacts.csv?scope=all');
    assert.match(full.headers.get('content-disposition'), /NOT-FOR-MARKETING/);
    const fl = full.text.replace(/^﻿/, '').trim().split('\r\n');
    assert.equal(fl.length, 5);
    assert.ok(fl[0].endsWith(',Note'));
    assert.ok(fl.slice(1).every((l) => l.endsWith(',NOT FOR MARKETING')));
    assert.ok(fl.some((l) => l.includes('unsubscribed')) && fl.some((l) => l.includes('no consent')));

    // the owner flags a consenting contact unsubscribed: the export drops them at once
    const id = (await A('/profile/admin/contacts?q=yes@')).body.contacts[0].id;
    const unsub = await browser(w, { ip: '198.51.100.9' }).call('POST', `/profile/admin/contacts/${id}/unsubscribe`, { unsubscribed: true }, { authorization: `Bearer ${ADMIN}` });
    assert.equal(unsub.status, 200);
    assert.equal(unsub.body.contact.marketingStatus, 'unsubscribed');
    assert.equal(unsub.body.contact.marketable, false);
    assert.equal((await A('/profile/admin/contacts.csv?scope=marketing')).text.replace(/^﻿/, '').trim().split('\r\n').length, 1, 'header only');
    // clearing the flag does not give consent back
    const clear = await browser(w, { ip: '198.51.100.9' }).call('POST', `/profile/admin/contacts/${id}/unsubscribe`, { unsubscribed: false }, { authorization: `Bearer ${ADMIN}` });
    assert.equal(clear.body.contact.marketable, false);
    assert.equal(clear.body.contact.marketingStatus, 'no consent');
    assert.equal((await browser(w).call('POST', `/profile/admin/contacts/${id}/unsubscribe`, { unsubscribed: true })).status, 401);
    // the person opting in again is fresh consent
    const again = await yes.call('PUT', '/profile/preferences', { marketing: true });
    assert.equal(again.body.profile.marketing, true);
    assert.equal((await A('/profile/admin/contacts?consent=yes')).body.contacts.length, 1);
  });

  test(`[${label}] without profiles configured the routes say so and nothing else is affected`, async () => {
    const store = createMemoryStore();
    const app = createApp({ store, profileStore: null, env: { SITE_URL: SITE, ENTITLEMENT_SECRET: 'e'.repeat(40) } });
    const res = await app.fetch(new Request(`${SITE}/api/profile/me`));
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.code, 'PROFILES_NOT_CONFIGURED');
    assert.equal((await app.fetch(new Request(`${SITE}/api/health`))).status, 200);
  });
}

// -------------------------------------------------------------------------------------------------------------------------------
test('csv helpers: formulas are defused and quotes escaped; dates are DD/MM/YYYY in Sydney', () => {
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('+61 400'), "'+61 400");
  assert.equal(csvCell('@x'), "'@x");
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(5), '5');
  assert.equal(ddmmyyyy('2026-11-14T20:00:00Z'), '15/11/2026');
  assert.equal(ddmmyyyy('nonsense'), '');
});

test('migration 0015 is additive, repeatable and matches schema.sql', { skip: !DatabaseSync }, () => {
  const mig = fs.readFileSync(new URL('../server/migrations/0015_free_profiles.sql', import.meta.url), 'utf8');
  assert.ok(!/\b(DROP|ALTER|TRUNCATE)\b|DELETE\s+FROM/i.test(mig.replace(/--.*$/gm, '')), 'no destructive statements');
  const db = new DatabaseSync(':memory:');
  db.exec(mig);
  db.exec(mig); // repeatable
  const shape = (d) => d.prepare("SELECT name, sql FROM sqlite_master WHERE name LIKE 'profile%' OR name LIKE 'idx_profile%' ORDER BY name").all().map((r) => `${r.name}`).join(',');
  const full = new DatabaseSync(':memory:');
  full.exec(fs.readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  assert.equal(shape(db), shape(full));
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name), ['profile_consent_events', 'profile_designs', 'profile_packs', 'profile_sessions', 'profiles']);
});

test('copy has no em or en dashes and never says compliant; no new Pocket Architect strings', () => {
  const files = ['src/profile/api.js', 'src/profile/controller.js', 'src/profile/policy.js', 'src/profile/ui.js', 'src/profile/wording.js', 'src/profile/index.js', 'src/profile/accounts.js', 'server/lib/profiles.js'];
  for (const f of files) {
    const text = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.ok(!/[–—]/.test(text), `${f} has a long dash`);
    assert.ok(!/complian/i.test(text), `${f} uses a banned word`);
    assert.ok(!/Pocket Architect/i.test(text), `${f} names the old product`);
  }
  const privacy = fs.readFileSync(new URL('../../website-live/privacy.html', import.meta.url), 'utf8');
  const section = privacy.slice(privacy.indexOf('<h2>3. Free profiles</h2>'), privacy.indexOf('<h2>4. How we use it</h2>'));
  assert.ok(section.length > 500);
  assert.ok(!/[–—]/.test(section) && !/complian/i.test(section));
  assert.match(section, /Marketing is opt in/);
  assert.match(section, /Delete my account/);
  assert.match(privacy, /Last updated 15\/11\/2026/);
});

test('password strength hint', () => {
  assert.equal(passwordStrength('').score, 0);
  assert.ok(passwordStrength('abc').score <= 1);
  assert.ok(passwordStrength('Correct-horse-battery-9').score >= 3);
  assert.ok(passwordStrength('aaaaaaaaaaaa').score < passwordStrength('Correct-horse-battery-9').score);
});

// -------------------------------------------------------------------------------------------------------------------------------
// The prompt: when it shows, and when it never does.
function policyKit(over = {}) {
  const shown = [];
  const timers = [];
  const mem = new Map();
  const session = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const state = { status: 'out', other: false, busy: false };
  const policy = createPromptPolicy({
    status: () => state.status, otherAccount: () => state.other, isBusy: () => state.busy, show: (r) => shown.push(r), session,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {}, ...over,
  });
  const tick = () => { const t = timers.splice(0); t.forEach((x) => x.fn()); };
  return { policy, shown, state, tick, timers, mem };
}

test('prompt: shows once per session after the first meaningful edit, never for trivial edits', () => {
  const k = policyKit();
  k.policy.noteEdit('Open project');
  k.policy.noteEdit('Title block');
  k.policy.noteEdit('Undo Add room');
  k.policy.noteEdit('Project details');
  assert.deepEqual(k.shown, [], 'opening a design or changing settings is not an edit worth a prompt');
  k.policy.noteEdit('Move house');
  assert.deepEqual(k.shown, ['edit']);
  k.policy.closed();
  k.policy.noteEdit('Add room');
  k.policy.noteEdit('Add wall');
  assert.deepEqual(k.shown, ['edit'], 'once per session');
  assert.equal(k.mem.get('ps.profile.prompt.edit'), '1');
  // a page reload in the same session does not show it again
  const reload = policyKit();
  reload.mem.set('ps.profile.prompt.edit', '1');
  const p2 = createPromptPolicy({ status: () => 'out', show: (r) => reload.shown.push(r), session: { getItem: (x) => reload.mem.get(x) ?? null, setItem: (x, v) => reload.mem.set(x, v) } });
  p2.noteEdit('Add room');
  assert.deepEqual(reload.shown, []);
  assert.equal(isMeaningfulLabel('Add room'), true);
  assert.equal(isMeaningfulLabel('Open project'), false);
  assert.equal(isMeaningfulLabel(''), false);
});

test('prompt: never interrupts a drag or another dialog, waits and then shows', () => {
  const k = policyKit();
  k.state.busy = true; // pointer down, a dialog open, or walking
  k.policy.noteEdit('Move house');
  assert.deepEqual(k.shown, []);
  k.tick();
  k.tick();
  assert.deepEqual(k.shown, [], 'still dragging');
  k.state.busy = false;
  k.tick();
  assert.deepEqual(k.shown, ['edit'], 'shown at the first calm moment');
  // gives up quietly after a long time
  const g = policyKit({ maxIdleTries: 3 });
  g.state.busy = true;
  g.policy.noteEdit('Add room');
  for (let i = 0; i < 6; i += 1) g.tick();
  g.state.busy = false;
  g.tick();
  assert.deepEqual(g.shown, []);
});

test('prompt: Not now suppresses the automatic prompts for the session, the Save to profile button still opens it', () => {
  const k = policyKit();
  k.policy.noteEdit('Add room');
  assert.deepEqual(k.shown, ['edit']);
  k.policy.dismiss();
  assert.equal(k.policy.suppressed(), true);
  assert.equal(k.policy.onSaveOrShare('save'), false);
  assert.equal(k.policy.onSaveOrShare('share'), false);
  const ev = { preventDefault() { this.prevented = true; }, returnValue: undefined };
  assert.equal(k.policy.onBeforeUnload(ev), false);
  assert.equal(ev.prevented, undefined);
  assert.equal(k.policy.openFromButton(), true, 'the person asked for it');
  assert.deepEqual(k.shown, ['edit', 'button']);
});

test('prompt: Save or Share while signed out offers it once at a time and the action carries on', () => {
  const k = policyKit();
  assert.equal(k.policy.onSaveOrShare('save'), true);
  assert.equal(k.policy.onSaveOrShare('save'), false, 'not stacked while it is open');
  k.policy.closed();
  assert.equal(k.policy.onSaveOrShare('share'), true);
  assert.deepEqual(k.shown, ['save', 'share']);
});

test('prompt: leaving with unsaved work asks the browser, and offers the prompt if the person stays', () => {
  const k = policyKit();
  const ev = () => ({ preventDefault() { this.prevented = true; }, returnValue: undefined });
  const none = ev();
  assert.equal(k.policy.onBeforeUnload(none), false, 'nothing edited: leave freely');
  assert.equal(none.prevented, undefined);
  k.policy.noteEdit('Add room');
  k.policy.closed();
  const e = ev();
  assert.equal(k.policy.onBeforeUnload(e), true);
  assert.equal(e.prevented, true);
  assert.equal(e.returnValue, '');
  assert.deepEqual(k.shown, ['edit']);
  k.tick(); // the timer only fires if the page was not closed
  assert.deepEqual(k.shown, ['edit', 'leave']);
  // a browser that refuses (throws) is left alone
  const k2 = policyKit();
  k2.policy.noteEdit('Add room');
  k2.policy.closed();
  assert.equal(k2.policy.onBeforeUnload({ preventDefault() { throw new Error('not allowed'); } }), false);
});

test('prompt: never for signed in people, builder and client logins, subscribers, trial and internal accounts, or when profiles are unavailable', () => {
  for (const status of ['in', 'none']) {
    const k = policyKit();
    k.state.status = status;
    k.policy.noteEdit('Add room');
    assert.equal(k.policy.onSaveOrShare('save'), false);
    assert.equal(k.policy.openFromButton(), false);
    assert.equal(k.policy.onBeforeUnload({ preventDefault() {} }), false);
    assert.deepEqual(k.shown, [], status);
  }
  const k = policyKit();
  k.state.other = true;
  k.policy.noteEdit('Add room');
  assert.equal(k.policy.onSaveOrShare('share'), false);
  assert.equal(k.policy.openFromButton(), false);
  assert.deepEqual(k.shown, []);
  // how the app recognises those accounts
  assert.equal(hasOtherAccount({ premium: { state: {} } }), false);
  assert.equal(hasOtherAccount({}), false);
  assert.equal(hasOtherAccount({ portal: { setLot() {} } }), true, 'builder or client login (internal accounts are builder logins)');
  assert.equal(hasOtherAccount({ premium: { state: { portal: { orgName: 'Acme' } } } }), true);
  assert.equal(hasOtherAccount({ premium: { state: { csub: { kind: 'subscription' } } } }), true, 'Commercial subscriber');
  assert.equal(hasOtherAccount({ premium: { state: { csub: { kind: 'trial' } } } }), true, 'Commercial trial login');
  assert.equal(hasOtherAccount({ premium: { state: { portalPending: true } } }), true, 'wait until the builder sign in check is done');
});

// -------------------------------------------------------------------------------------------------------------------------------
// Controller: autosave and migration of the local design, against the real Worker app.
function clientKit({ env = {}, ip = '203.0.113.5', debounceMs = 2500 } = {}) {
  const w = world({ env });
  const b = browser(w, { ip });
  const api = createProfileApi({ base: `${SITE}/api`, fetchImpl: b.fetchImpl });
  const store = createStore(sample('p_local001', 'My local design'));
  const timers = [];
  const packs = { tokens: {}, accepted: [] };
  const controller = createProfileController({
    api, store, debounceMs, thumbnail: async () => null,
    packToken: (pid) => packs.tokens[pid] || null, acceptPack: (p) => packs.accepted.push(p),
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {},
  });
  const fire = async () => { const t = timers.splice(0); for (const x of t) await x.fn(); await new Promise((r) => setTimeout(r, 5)); };
  return { w, b, api, store, controller, timers, fire, packs };
}

test('migration: creating a profile saves the design that is open straight away', async () => {
  const k = clientKit();
  assert.equal(await k.controller.init(), 'out');
  const out = await k.controller.signUp({ name: 'Sam', email: 'sam@example.com', password: PW, acceptTerms: true, acceptPrivacy: true, marketing: false });
  assert.equal(out.saved.ok, true);
  assert.equal(out.saved.created, true);
  assert.equal(k.controller.state.status, 'in');
  assert.equal(k.controller.state.saveState, 'saved');
  const list = (await k.b.call('GET', '/profile/designs')).body;
  assert.equal(list.count, 1);
  assert.equal(list.designs[0].projectId, 'p_local001');
  assert.equal(list.designs[0].name, 'My local design');
  const open = await k.b.call('GET', `/profile/designs/${list.designs[0].id}`);
  assert.equal(open.body.project.levels[0].rooms.length, 1, 'the whole design came across');
  // a design with nothing in it is not saved
  const empty = clientKit({ ip: '203.0.113.6' });
  empty.store.replace(createProject({ id: 'p_empty001', name: 'Untitled design' }));
  await empty.controller.init();
  const r = await empty.controller.signUp({ name: 'Sam', email: 'sam2@example.com', password: PW, acceptTerms: true, acceptPrivacy: true });
  assert.equal(r.saved.code, 'NOTHING_TO_SAVE');
  assert.equal((await empty.b.call('GET', '/profile/designs')).body.count, 0);
  assert.equal(hasWork(createProject({ id: 'p_x' })), false);
  assert.equal(hasWork(sample()), true);
  assert.equal(hasWork({ levels: [{ rooms: [], walls: [] }], site: { lot: { address: 'x' } } }), true);
});

test('migration: signing in on a device with unsaved edits keeps them as a new design, nothing saved is overwritten', async () => {
  const k = clientKit();
  await k.controller.init();
  await k.controller.signUp({ name: 'Sam', email: 'sam@example.com', password: PW, acceptTerms: true, acceptPrivacy: true });
  await k.controller.signOut();
  assert.equal(k.controller.state.status, 'out');
  assert.equal((await k.b.call('GET', '/profile/me')).body.profile, null);
  // a different design is open and edited, then the person signs in
  k.store.replace(sample('p_other001', 'Other design'));
  k.store.run('add_room', { type: 'bedroom', name: 'Bed', x: 7000, y: 0, width: 3000, depth: 3000 });
  const r = await k.controller.signIn({ email: 'sam@example.com', password: PW });
  assert.equal(r.saved.ok, true);
  const names = (await k.b.call('GET', '/profile/designs')).body.designs.map((d) => d.name).sort();
  assert.deepEqual(names, ['My local design', 'Other design']);
  // a wrong password signs nobody in
  await assert.rejects(() => k.controller.signIn({ email: 'sam@example.com', password: 'Wrong-pass-12345' }), (e) => e instanceof ProfileError && e.code === 'INVALID_CREDENTIALS');
});

test('autosave: every change is saved after a pause and the status says so; opening a design is not a change', async () => {
  const k = clientKit();
  await k.controller.init();
  await k.controller.signUp({ name: 'Sam', email: 'sam@example.com', password: PW, acceptTerms: true, acceptPrivacy: true });
  const seen = [];
  k.controller.subscribe((s) => seen.push(s.saveState));
  k.store.on('project', ({ label } = {}) => k.controller.noteChange(label));
  k.store.run('add_room', { type: 'bedroom', name: 'Bed', x: 7000, y: 0, width: 3000, depth: 3000 });
  k.store.run('add_room', { type: 'bathroom', name: 'Bath', x: 11000, y: 0, width: 2000, depth: 3000 });
  assert.equal(k.controller.state.saveState, 'saving');
  assert.equal(k.timers.length, 2);
  assert.ok(k.timers.every((t) => t.ms === 2500), 'debounced by 2.5 seconds');
  await k.fire();
  assert.equal(k.controller.state.saveState, 'saved');
  assert.ok(seen.includes('saving') && seen.includes('saved'));
  const [d] = (await k.b.call('GET', '/profile/designs')).body.designs;
  const saved = (await k.b.call('GET', `/profile/designs/${d.id}`)).body.project;
  assert.equal(saved.levels[0].rooms.length, 3, 'the latest state is what was saved');
  assert.equal((await k.b.call('GET', '/profile/designs')).body.count, 1, 'autosave updates the same design');
  // opening a design replaces the project but is not a change that needs saving
  k.timers.length = 0;
  k.store.replace(sample('p_opened01', 'Opened'));
  assert.equal(k.timers.length, 0);
  // read only shared designs are never saved
  k.store.readOnly = true;
  k.controller.noteChange('Add room');
  assert.equal(k.timers.length, 0);
  k.store.readOnly = false;
  // signed out: nothing is saved
  await k.controller.signOut();
  k.controller.noteChange('Add room');
  assert.equal(k.timers.length, 0);
});

test('autosave: a full profile says so plainly and keeps the design in the browser', async () => {
  const k = clientKit({ env: { FREE_PROFILE_MAX_DESIGNS: '1' } });
  await k.controller.init();
  await k.controller.signUp({ name: 'Sam', email: 'sam@example.com', password: PW, acceptTerms: true, acceptPrivacy: true });
  k.store.on('project', ({ label } = {}) => k.controller.noteChange(label));
  k.store.replace(sample('p_second01', 'Second design'));
  k.store.run('add_room', { type: 'bedroom', name: 'Bed', x: 7000, y: 0, width: 3000, depth: 3000 });
  await k.fire();
  assert.equal(k.controller.state.saveState, 'limit');
  assert.match(k.controller.state.message, /up to 1 designs/);
  assert.equal(k.timers.length, 0, 'no retry loop on a limit');
});

test('profile service missing: the controller reports unavailable and the app shows nothing', async () => {
  const api = { me: async () => { throw new ProfileError('SERVER_UNAVAILABLE', 'x', { status: 404 }); } };
  const c = createProfileController({ api, store: createStore(sample()) });
  assert.equal(await c.init(), 'unavailable');
  const offline = createProfileController({ api: { me: async () => { throw new ProfileError('NETWORK', 'offline'); } }, store: createStore(sample()) });
  assert.equal(await offline.init(), 'out', 'a flaky connection is not the same as no service');
});

test('Plan Pack: a pack held for the saved design is linked after the save, and a linked pack is stored before the design opens', async () => {
  const k = clientKit();
  const nowMs = k.w.clock.t;
  const { entitlement: ent } = await k.w.store.createEntitlement({
    id: 'ent_client001', projectId: 'p_local001', email: 'sam@example.com', stripeSessionId: 'cs_c_1', amountCents: 3000, currency: 'aud', creditsTotal: 500,
    status: 'active', createdAt: new Date(nowMs).toISOString(), expiresAt: new Date(nowMs + 300 * DAY).toISOString(),
  });
  k.packs.tokens.p_local001 = await issueToken(ent, k.w.app.config, nowMs);
  await k.controller.init();
  await k.controller.signUp({ name: 'Sam', email: 'sam@example.com', password: PW, acceptTerms: true, acceptPrivacy: true });
  assert.deepEqual((await k.w.pstore.listPacks((await k.w.pstore.getProfileByEmail('sam@example.com')).id)).map((p) => p.entitlementId), ['ent_client001']);
  // another device: open the design and receive the pack token
  const b2 = browser(k.w, { ip: '203.0.113.30' });
  const api2 = createProfileApi({ base: `${SITE}/api`, fetchImpl: b2.fetchImpl });
  const store2 = createStore(createProject({ id: 'p_blank', name: 'x' }));
  const accepted = [];
  const c2 = createProfileController({ api: api2, store: store2, acceptPack: (p) => accepted.push(p) });
  await c2.signIn({ email: 'sam@example.com', password: PW });
  const [d] = (await c2.listDesigns()).designs;
  const opened = await c2.openDesign(d.id, { replaceProject: (p) => { store2.replace(p); return true; } });
  assert.equal(opened.name, 'My local design');
  assert.equal(store2.project.id, 'p_local001');
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].projectId, 'p_local001');
});

test('sign out flushes pending work first, delete account clears the state', async () => {
  const k = clientKit();
  await k.controller.init();
  await k.controller.signUp({ name: 'Sam', email: 'sam@example.com', password: PW, acceptTerms: true, acceptPrivacy: true });
  k.store.on('project', ({ label } = {}) => k.controller.noteChange(label));
  k.store.run('add_room', { type: 'bedroom', name: 'Bed', x: 7000, y: 0, width: 3000, depth: 3000 });
  await k.controller.signOut(); // the change was still waiting for its pause
  await k.b.call('POST', '/profile/session', { email: 'sam@example.com', password: PW });
  const [d] = (await k.b.call('GET', '/profile/designs')).body.designs;
  assert.equal((await k.b.call('GET', `/profile/designs/${d.id}`)).body.project.levels[0].rooms.length, 2);
  await k.controller.signIn({ email: 'sam@example.com', password: PW });
  await assert.rejects(() => k.controller.deleteAccount('Wrong-password-1'), (e) => e.code === 'INVALID_CREDENTIALS');
  assert.equal(k.controller.state.status, 'in');
  await k.controller.deleteAccount(PW);
  assert.equal(k.controller.state.status, 'out');
  assert.equal(k.controller.state.profile, null);
  assert.equal((await k.b.call('GET', '/profile/me')).body.profile, null);
  assert.equal(await k.w.pstore.getProfileByEmail('sam@example.com'), null);
});
