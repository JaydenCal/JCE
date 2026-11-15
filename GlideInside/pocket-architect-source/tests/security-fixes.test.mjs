// Regression tests for the pre-launch security review (15/11/2026): each test reproduces the reported issue and holds the fix.
// M1 atomic login lockout, M2 revocable org AI tokens, M3 profile sign up (no enumeration, unverified consent), M4 per username plus IP lockout,
// M5 security headers, and the quick Lows (L2 L5 L6 L7 L8 L10 L11 L12 L13 L16 L17).
import test from 'node:test';
import assert from 'node:assert/strict';
import { world, PW, ADMIN, SITE, T0 } from './helpers/sec-world.mjs';
import { generatePassword, PASSWORD_ALPHABET, PASSWORD_LENGTH, passwordEntropyBits } from '../src/portal/credentials.js';
import { clientIp } from '../server/lib/http.js';
import { zipSync, strToU8 } from '../src/lib/fflate.js';
import { parseKMZ, parseShapefileZip, UploadError } from '../src/site/upload/parsers.js';

const MIN = 60000;
const cctx = 'PROJECT "T" type=house units=mm\nLEVEL l_1 "Ground" active';

// ---------------------------------------------------------------------------------------------------------------------------------
// M1 and M4: sign in lockout
// ---------------------------------------------------------------------------------------------------------------------------------
test('M1 portal: 60 parallel guesses from one address cannot exceed the lockout limit (counted before the password is checked)', async () => {
  const w = await world();
  const org = await w.makeOrg();
  const cl = await w.makeClient(org);
  w.clock.t += 20 * MIN;
  const attempts = Array.from({ length: 60 }, (_, i) => w.browser('gi_session', { ip: '203.0.113.200' }).post('/portal/session', { identifier: cl.username, password: i === 55 ? cl.password : `wrong-guess-${i}-xx` }));
  const rs = await Promise.all(attempts);
  assert.equal(rs.filter((r) => r.status === 200).length, 0, 'the correct password at position 55 must not get in once the limit is used up');
  assert.ok(rs.filter((r) => r.status === 401).length <= 5, `only the first 5 attempts may reach the password check (got ${rs.filter((r) => r.status === 401).length})`);
  assert.ok(rs.every((r) => [401, 423, 429].includes(r.status)));
});

test('M1 portal: a correct password still signs in when the guesses are within the limit, and gives the attempt back', async () => {
  const w = await world();
  const org = await w.makeOrg();
  const cl = await w.makeClient(org);
  const b = w.browser('gi_session', { ip: '203.0.113.201' });
  for (let i = 0; i < 3; i += 1) assert.equal((await b.post('/portal/session', { identifier: cl.username, password: `bad-guess-${i}-zz` })).status, 401);
  assert.equal((await b.post('/portal/session', { identifier: cl.username, password: cl.password })).status, 200);
  // the success cleared the counter: four more wrong guesses are still all answered 401, not 423
  for (let i = 0; i < 4; i += 1) assert.equal((await w.browser('gi_session', { ip: '203.0.113.201' }).post('/portal/session', { identifier: cl.username, password: `bad-again-${i}-zz` })).status, 401);
});

test('M1 trial login: 60 parallel guesses from one address cannot exceed the lockout limit', async () => {
  const w = await world();
  assert.equal((await w.admin('PUT', '/commercial/admin/trial', { username: 'trial-user', password: 'Trial-Passphrase-9', expiresAt: '' })).status, 200);
  const rs = await Promise.all(Array.from({ length: 60 }, (_, i) => w.req('POST', '/commercial/trial/login', { body: { username: 'trial-user', password: i === 55 ? 'Trial-Passphrase-9' : `wrong-trial-${i}-xx` }, headers: { 'cf-connecting-ip': '203.0.113.202' } })));
  assert.equal(rs.filter((r) => r.status === 200).length, 0);
  assert.ok(rs.filter((r) => r.status === 401).length <= 5, `only 5 may reach the password check (got ${rs.filter((r) => r.status === 401).length})`);
});

test('M1 generated temporary passwords carry at least 72 bits from a readable alphabet', () => {
  assert.ok(passwordEntropyBits() >= 72, `entropy ${passwordEntropyBits()} bits`);
  const seen = new Set();
  for (let i = 0; i < 300; i += 1) {
    const pw = generatePassword();
    const letters = pw.replace(/-/g, '');
    assert.equal(letters.length, PASSWORD_LENGTH);
    for (const ch of letters) assert.ok(PASSWORD_ALPHABET.includes(ch), `unexpected character ${ch}`);
    assert.ok(!/[01oOiIlL]/.test(letters), 'no look alike characters');
    seen.add(pw);
  }
  assert.equal(seen.size, 300, 'no repeats in 300 draws');
});

test('M4 portal: bad guesses from one address do not lock the real user out from their own address', async () => {
  const w = await world();
  const org = await w.makeOrg();
  const cl = await w.makeClient(org);
  w.clock.t += 20 * MIN;
  let last;
  for (let i = 0; i < 6; i += 1) last = await w.browser('gi_session', { ip: '198.51.100.50' }).post('/portal/session', { identifier: cl.username, password: `attacker-guess-${i}-x` });
  assert.equal(last.status, 423, 'the attacker address is locked for this username');
  assert.equal((await w.browser('gi_session', { ip: '203.0.113.77' }).post('/portal/session', { identifier: cl.username, password: cl.password })).status, 200, 'the real user, from another address, signs in');
});

test('M4 portal: distributed guessing (one guess from many addresses) is capped by a higher per username ceiling', async () => {
  const w = await world({ env: { LOGIN_IP_MAX_FAILURES: '1000' } });
  const org = await w.makeOrg();
  const cl = await w.makeClient(org);
  w.clock.t += 20 * MIN;
  const rs = await Promise.all(Array.from({ length: 120 }, (_, i) => w.browser('gi_session', { ip: `192.0.2.${(i % 250) + 1}` }).post('/portal/session', { identifier: cl.username, password: i === 110 ? cl.password : `spread-guess-${i}-x` })));
  const reached = rs.filter((r) => r.status === 401).length;
  assert.ok(reached <= 60, `at most the per username ceiling may reach the password check (got ${reached})`);
  assert.equal(rs.filter((r) => r.status === 200).length, 0);
});

test('M4 trial login: a stranger cannot lock the trial user out from another address', async () => {
  const w = await world();
  await w.admin('PUT', '/commercial/admin/trial', { username: 'trial-user', password: 'Trial-Passphrase-9', expiresAt: '' });
  let last;
  for (let i = 0; i < 6; i += 1) last = await w.req('POST', '/commercial/trial/login', { body: { username: 'trial-user', password: `bad-${i}-trial-xx` }, headers: { 'cf-connecting-ip': '198.51.100.60' } });
  assert.equal(last.status, 423);
  assert.equal((await w.req('POST', '/commercial/trial/login', { body: { username: 'trial-user', password: 'Trial-Passphrase-9' }, headers: { 'cf-connecting-ip': '203.0.113.61' } })).status, 200);
});

test('M4 profile sign in: bad guesses from one address do not throttle the owner on another address', async () => {
  const w = await world();
  const a = w.browser('gi_profile', { ip: '203.0.113.70' });
  await a.post('/profile/signup', { name: 'Alice', email: 'alice@example.com', password: PW, acceptTerms: true, acceptPrivacy: true });
  for (let i = 0; i < 10; i += 1) await w.browser('gi_profile', { ip: '198.51.100.70' }).post('/profile/session', { email: 'alice@example.com', password: `wrong-pass-${i}-xyz` });
  assert.equal((await w.browser('gi_profile', { ip: '203.0.113.71' }).post('/profile/session', { email: 'alice@example.com', password: PW })).status, 200);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// M2: org AI bearer tokens
// ---------------------------------------------------------------------------------------------------------------------------------
async function aiWorld() {
  const w = await world({ env: { AI_RATE_PER_MIN: '1000', AI_RATE_PER_DAY: '100000' } });
  const A = await w.makeOrg('Alpha Homes Pty Ltd', 'Priya');
  const ai = (token) => w.req('POST', '/ai/edit', { headers: { authorization: `Bearer ${token}` }, body: { message: 'make it bigger', context: cctx, history: [] } });
  const top = (token) => w.req('POST', '/ai/topup', { headers: { authorization: `Bearer ${token}` }, body: {} });
  const tokOf = async (b) => (await b.post('/portal/ai/token')).data.token;
  return { w, A, ai, top, tokOf };
}

test('M2 org AI token stops working at once when the client is disabled', async () => {
  const { w, A, ai, top, tokOf } = await aiWorld();
  const cl = await w.makeClient(A, 'Carl');
  const tok = await tokOf(cl.browser);
  assert.equal((await ai(tok)).status, 200);
  await A.admin.post(`/portal/clients/${cl.client.id}/disable`);
  assert.equal((await ai(tok)).status, 401);
  assert.equal((await top(tok)).status, 401);
});

test('M2 org AI token stops working when the client is deleted', async () => {
  const { w, A, ai, tokOf } = await aiWorld();
  const cl = await w.makeClient(A, 'Dana');
  const tok = await tokOf(cl.browser);
  await A.admin.del(`/portal/clients/${cl.client.id}`);
  assert.equal((await ai(tok)).status, 401);
});

test('M2 org AI token stops working after sign out', async () => {
  const { w, A, ai, tokOf } = await aiWorld();
  const cl = await w.makeClient(A, 'Evan');
  const tok = await tokOf(cl.browser);
  assert.equal((await ai(tok)).status, 200);
  await cl.browser.del('/portal/session');
  assert.equal((await ai(tok)).status, 401);
});

test('M2 org AI token stops working after a password change; a fresh token works', async () => {
  const { w, A, ai, tokOf } = await aiWorld();
  const cl = await w.makeClient(A, 'Fay');
  const tok = await tokOf(cl.browser);
  assert.equal((await cl.browser.post('/portal/password', { currentPassword: cl.password, newPassword: 'Brand-New-Passphrase-31' })).status, 200);
  assert.equal((await ai(tok)).status, 401);
  assert.equal((await ai(await tokOf(cl.browser))).status, 200);
});

test('M2 org AI token follows the org: a read only (lapsed) org and an unknown user are refused; an untouched token keeps working', async () => {
  const { w, A, ai, tokOf } = await aiWorld();
  const cl = await w.makeClient(A, 'Gus');
  const tok = await tokOf(cl.browser);
  assert.equal((await ai(tok)).status, 200);
  assert.equal((await ai(tok)).status, 200, 'unchanged token keeps working');
  w.db._db.prepare('DELETE FROM sessions').run();
  w.db._db.prepare('UPDATE users SET status = ? WHERE id = ?').run('disabled', cl.client.id);
  assert.equal((await ai(tok)).status, 401, 'a status change made straight in the database is still seen on the next call');
});

// ---------------------------------------------------------------------------------------------------------------------------------
// M3: free profile sign up
// ---------------------------------------------------------------------------------------------------------------------------------
const signupBody = (over = {}) => ({ name: 'Alice', email: 'alice@example.com', password: PW, acceptTerms: true, acceptPrivacy: true, marketing: false, ...over });

test('M3 sign up answers a new and an existing email identically (no 409, same body, no session cookie)', async () => {
  const w = await world();
  const fresh = await w.browser('gi_profile', { ip: '203.0.113.80' }).post('/profile/signup', signupBody());
  const again = await w.browser('gi_profile', { ip: '203.0.113.81' }).post('/profile/signup', signupBody({ name: 'Someone Else', password: 'Different-Passphrase-44' }));
  assert.equal(fresh.status, again.status);
  assert.notEqual(again.status, 409);
  assert.equal(fresh.text, again.text, 'identical body');
  assert.deepEqual(fresh.cookies, []);
  assert.deepEqual(again.cookies, []);
  assert.equal((await w.profileStore.getProfileByEmail('alice@example.com')).name, 'Alice', 'the existing profile is untouched');
  // the new profile can sign in with its own password; the second request created nothing and gave no access
  assert.equal((await w.browser('gi_profile', { ip: '203.0.113.82' }).post('/profile/session', { email: 'alice@example.com', password: PW })).status, 200);
  assert.equal((await w.browser('gi_profile', { ip: '203.0.113.83' }).post('/profile/session', { email: 'alice@example.com', password: 'Different-Passphrase-44' })).status, 401);
});

test('M3 marketing consent from sign up is stored as unverified and left out of the marketing CSV by default', async () => {
  const w = await world();
  await w.browser('gi_profile', { ip: '203.0.113.84' }).post('/profile/signup', signupBody({ email: 'victim@example.com', name: 'Victim', marketing: true }));
  const p = await w.profileStore.getProfileByEmail('victim@example.com');
  assert.equal(p.marketingConsent, true, 'the tick is recorded');
  assert.equal(p.marketingConsentVerified, false, 'but it is not verified');
  const csv = await w.req('GET', '/profile/admin/contacts.csv?scope=marketing', { headers: { authorization: `Bearer ${ADMIN}` } });
  assert.equal(csv.status, 200);
  assert.ok(!csv.text.includes('victim@example.com'), 'unverified contacts are not exported for marketing');
  assert.equal(csv.headers.get('x-contact-count'), '0');
  const inc = await w.req('GET', '/profile/admin/contacts.csv?scope=marketing&includeUnverified=1', { headers: { authorization: `Bearer ${ADMIN}` } });
  assert.ok(inc.text.includes('victim@example.com'), 'the explicit filter includes them');
  assert.match(inc.headers.get('content-disposition'), /UNVERIFIED/);
  assert.match(inc.headers.get('x-spam-act-warning') || '', /Spam Act/);
  const list = await w.req('GET', '/profile/admin/contacts', { headers: { authorization: `Bearer ${ADMIN}` } });
  assert.equal(list.data.marketable, 0);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// M5: headers
// ---------------------------------------------------------------------------------------------------------------------------------
test('M5 API responses carry nosniff, Referrer-Policy and a conservative CSP (JSON, errors, preflight)', async () => {
  const w = await world();
  for (const r of [await w.req('GET', '/health'), await w.req('GET', '/nope'), await w.req('POST', '/portal/session', { body: {} })]) {
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    const csp = r.headers.get('content-security-policy') || '';
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
  }
  const pre = await w.app.fetch(new Request(`${SITE}/api/health`, { method: 'OPTIONS', headers: { origin: SITE } }));
  assert.equal(pre.headers.get('x-content-type-options'), 'nosniff');
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Lows
// ---------------------------------------------------------------------------------------------------------------------------------
test('L11 /ai/estimate is rate limited per account', async () => {
  const w = await world();
  const { token } = await w.packToken('proj_est001', 500);
  let limited = 0;
  let ok = 0;
  for (let i = 0; i < 40; i += 1) {
    const r = await w.req('POST', '/ai/estimate', { headers: { authorization: `Bearer ${token}` }, body: { message: 'make it bigger', context: cctx, history: [] } });
    if (r.status === 200) ok += 1;
    if (r.status === 429) limited += 1;
  }
  assert.ok(ok >= 10 && ok <= 30, `some estimates are served (${ok})`);
  assert.ok(limited > 0, 'then the limit applies');
});

test('L12 test codes: the right code works, a near miss does not (constant time compare)', async () => {
  const w = await world({ env: { TEST_CODES: 'FRIENDS-CODE-2026' } });
  const good = await w.req('POST', '/entitlement/restore', { body: { email: 'a@example.com', sessionOrReceipt: 'FRIENDS-CODE-2026', projectId: 'proj_code001' } });
  assert.equal(good.status, 200);
  const near = await w.req('POST', '/entitlement/restore', { body: { email: 'a@example.com', sessionOrReceipt: 'FRIENDS-CODE-2027', projectId: 'proj_code001' } });
  assert.notEqual(near.status, 200);
});

test('L13 client address: X-Forwarded-For and X-Real-IP are ignored unless the host is configured to trust them', () => {
  const req = (h) => new Request('https://x.test/api/health', { headers: h });
  assert.equal(clientIp(req({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '9.9.9.9' })), '1.1.1.1');
  assert.equal(clientIp(req({ 'x-forwarded-for': '9.9.9.9' })), 'unknown');
  assert.equal(clientIp(req({ 'x-real-ip': '9.9.9.9' })), 'unknown');
});

test('L5 html, glb and obj exports are behind the plan set terms gate as well as pdf and dxf', async () => {
  const w = await world();
  const { token } = await w.packToken('proj_terms01', 500);
  const project = { schema: 2, id: 'proj_terms01', name: 'T', levels: [{ id: 'l1', name: 'G', rooms: [], walls: [] }] };
  for (const type of ['pdf', 'dxf', 'html', 'glb', 'obj']) {
    const r = await w.req('POST', `/export/${type}`, { headers: { authorization: `Bearer ${token}`, 'x-gi-request': '1' }, body: { project } });
    assert.equal(r.status, 409, type);
    assert.equal(r.data?.error?.code, 'TERMS_REQUIRED', type);
  }
});

test('L7 the scheduled cleanup purges old rate limit and auth failure rows and keeps current ones', async () => {
  const w = await world();
  const db = w.db._db;
  const old = T0 - 10 * 86400000;
  db.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)').run('old:key', old, 3);
  db.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)').run('fresh:key', T0 - 1000, 3);
  db.prepare('INSERT INTO auth_failures (key, count, window_start, locked_until) VALUES (?, ?, ?, NULL)').run('u:old|1.1.1.1', 2, old);
  db.prepare('INSERT INTO auth_failures (key, count, window_start, locked_until) VALUES (?, ?, ?, NULL)').run('u:fresh|1.1.1.1', 2, T0 - 1000);
  await w.app.scheduled();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM rate_limits WHERE key = 'old:key'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM rate_limits WHERE key = 'fresh:key'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM auth_failures WHERE key = 'u:old|1.1.1.1'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM auth_failures WHERE key = 'u:fresh|1.1.1.1'").get().n, 1);
});

test('L6 deleting a profile keeps an anonymised consent record (no email, no name) and drops the identifiable rows', async () => {
  const w = await world();
  const b = w.browser('gi_profile', { ip: '203.0.113.90' });
  await b.post('/profile/signup', signupBody({ email: 'gone@example.com', name: 'Gone Person', marketing: true }));
  await b.post('/profile/session', { email: 'gone@example.com', password: PW });
  await b.put('/profile/preferences', { marketing: false });
  assert.equal((await b.del('/profile', undefined, { password: PW })).status, 200);
  const rows = w.db._db.prepare('SELECT * FROM consent_archive').all();
  assert.ok(rows.length >= 2, 'consent events survive');
  const dump = JSON.stringify(rows);
  assert.ok(!/gone@example\.com|Gone Person/.test(dump), 'nothing identifiable is kept');
  assert.ok(rows.every((r) => /^[0-9a-f]{64}$/.test(r.email_hash)));
  assert.equal(w.db._db.prepare('SELECT COUNT(*) n FROM profile_consent_events').get().n, 0);
});

test('L8 anonymous share storage is capped per address per day (bytes)', async () => {
  const w = await world({ files: true, env: { PROJECT_DAILY_BYTES_PER_IP: '6000', PROJECT_SAVE_RATE_MAX: '1000' } });
  const proj = (i) => ({ schema: 2, id: `p_cap${i}`, name: `Design ${i}`, levels: [{ id: 'l1', name: 'G', rooms: [], walls: [] }], pad: 'x'.repeat(1500) });
  const statuses = [];
  for (let i = 0; i < 8; i += 1) statuses.push((await w.req('POST', '/projects', { body: { project: proj(i) }, headers: { 'cf-connecting-ip': '203.0.113.99', origin: SITE, 'x-gi-request': '1' } })).status);
  assert.ok(statuses.slice(0, 3).every((s) => s === 201), `the first saves fit (${statuses})`);
  assert.ok(statuses.includes(429), `a later save is refused (${statuses})`);
  const other = await w.req('POST', '/projects', { body: { project: proj(99) }, headers: { 'cf-connecting-ip': '203.0.113.100', origin: SITE, 'x-gi-request': '1' } });
  assert.equal(other.status, 201, 'another address is not affected');
});

test('L2 client self top-ups are off by default for a new org, and capped per month when the builder switches them on', async () => {
  const { w, A, tokOf } = await aiWorld();
  const org = (await A.admin.get('/portal/me')).data.org;
  assert.equal(org.allowClientTopUps, false, 'off by default');
  const cl = await w.makeClient(A, 'Hugo');
  assert.equal((await cl.browser.post('/portal/ai/top-up')).status, 403);
  const tok = await tokOf(cl.browser);
  assert.equal((await w.req('POST', '/ai/topup', { headers: { authorization: `Bearer ${tok}` }, body: {} })).status, 403);
  await A.admin.patch('/portal/org/settings', { allowClientTopUps: true });
  let ok = 0;
  let last;
  for (let i = 0; i < 6; i += 1) {
    last = await cl.browser.post('/portal/ai/top-up');
    if (last.status === 200) ok += 1;
  }
  assert.equal(ok, 3, 'at most CLIENT_TOPUP_MONTHLY_MAX (3) top-ups per client login per month');
  assert.equal(last.status, 429);
  const staff = await A.admin.post('/portal/ai/top-up');
  assert.equal(staff.status, 200, 'a builder login is not subject to the client cap');
});

test('L17 the site lookup log does not keep the address text', async () => {
  const w = await world();
  const lines = [];
  const orig = console.warn;
  console.warn = (...a) => lines.push(a.join(' '));
  try {
    await w.req('GET', '/site/search?q=' + encodeURIComponent('12 Secret Street Tamworth'), { headers: { 'cf-connecting-ip': '203.0.113.120' } });
  } finally {
    console.warn = orig;
  }
  assert.ok(lines.length > 0, 'the upstream failure is still logged');
  assert.ok(!lines.join('\n').toLowerCase().includes('secret'), 'the search text is not in the log');
});

// ---------------------------------------------------------------------------------------------------------------------------------
// L16: upload parser caps (client side)
// ---------------------------------------------------------------------------------------------------------------------------------
test('L16 a zip bomb in a KMZ or a zipped shapefile is refused before it is inflated', () => {
  const big = new Uint8Array(60 * 1024 * 1024); // 60 MB of zeros compresses to about 60 KB
  const kmz = zipSync({ 'doc.kml': big }, { level: 9 });
  assert.ok(kmz.length < 1024 * 1024, 'the bomb is small on the wire');
  assert.throws(() => parseKMZ(kmz), (e) => e instanceof UploadError && e.code === 'TOO_LARGE');
  const shpzip = zipSync({ 'a.shp': big, 'a.dbf': new Uint8Array(10) }, { level: 9 });
  assert.throws(() => parseShapefileZip(shpzip), (e) => e instanceof UploadError && e.code === 'TOO_LARGE');
  const many = {};
  for (let i = 0; i < 3000; i += 1) many[`f${i}.txt`] = strToU8('x');
  assert.throws(() => parseKMZ(zipSync(many)), (e) => e instanceof UploadError && e.code === 'TOO_LARGE', 'an entry count cap applies too');
});

test('L16 a zip that LIES about its uncompressed size is still stopped while inflating', () => {
  const bomb = zipSync({ 'doc.kml': new Uint8Array(80 * 1024 * 1024) }, { level: 9 });
  const dv = new DataView(bomb.buffer, bomb.byteOffset, bomb.byteLength);
  dv.setUint32(22, 100, true); // local header: uncompressed size
  for (let i = 0; i + 4 < bomb.length; i += 1) if (dv.getUint32(i, true) === 0x02014b50) dv.setUint32(i + 24, 100, true); // central directory copy
  assert.throws(() => parseKMZ(bomb), (e) => e instanceof UploadError && ['TOO_LARGE', 'BAD_ZIP'].includes(e.code));
});

test('L16 a normal small KMZ still opens', () => {
  const kml = '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Lot</name><Polygon><outerBoundaryIs><LinearRing><coordinates>150,-31,0 150.001,-31,0 150.001,-31.001,0 150,-31.001,0 150,-31,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>';
  const out = parseKMZ(zipSync({ 'doc.kml': strToU8(kml) }));
  assert.equal(out.polygons.length, 1);
});
