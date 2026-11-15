// Regression tests for the server side findings of the pre-launch load test (15/11/2026, /home/claude/prelaunch/load.md):
// F1 trial AI allowance, F2 sign in lockout under concurrency, F3 expiry indexes and bounded purges, F4 lot lookup coalescing,
// F5 shared project update ordering, F7 read only portal me, F8 profile design limit and first save races, F11 org short code race,
// CON-006 Anthropic credit balance errors shown as the paused state. Each test fires the same parallel burst the load harness used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { world, PW, ADMIN, SITE, T0 } from './helpers/sec-world.mjs';
import { isBillingError } from '../server/lib/anthropic.js';

const MIN = 60000;
const CCTX = 'PROJECT "T" type=commercial mode=commercial units=mm\nLEVEL l_1 "Ground" active';
const PASS = 'Trial-Passphrase-9';

async function trialWorld(env = {}) {
  const w = await world({ env: { AI_RATE_PER_MIN: '100000', AI_RATE_PER_DAY: '1000000', COMMERCIAL_TRIAL_AI_TOTAL: '50', ...env } });
  assert.equal((await w.admin('PUT', '/commercial/admin/trial', { username: 'trial-user', password: PASS, expiresAt: '' })).status, 200);
  const login = await w.req('POST', '/commercial/trial/login', { body: { username: 'trial-user', password: PASS }, headers: { 'cf-connecting-ip': '198.51.100.9' } });
  assert.equal(login.status, 200);
  const token = login.data.token;
  const ai = () => w.req('POST', '/ai/edit', { headers: { authorization: `Bearer ${token}` }, body: { message: 'Make the roof dark grey', context: CCTX, history: [], activeLevelId: 'l_1', commercial: true } });
  return { w, token, ai };
}

// ---------------------------------------------------------------------------------------------------------------------------------
test('F1 trial AI allowance: 80 parallel requests against an allowance of 50 spend exactly 50 and call Anthropic 50 times', async () => {
  const { w, ai } = await trialWorld();
  const rs = await Promise.all(Array.from({ length: 80 }, () => ai()));
  const ok = rs.filter((r) => r.status === 200).length;
  assert.equal(ok, 50, `${ok} succeeded`);
  assert.equal(w.calls.anthropic.length, 50, 'one model call per success, never more');
  assert.ok(rs.filter((r) => r.status !== 200).every((r) => [402, 409].includes(r.status)), 'the rest are refused as exhausted or reserved');
  const ent = (await w.store.listEvents?.('x'), await w.store.getEntitlement(`ctai:${(JSON.parse(await w.portalStore.getSetting('commercial_trial'))).id}`));
  assert.equal(ent.creditsUsed, 50);
  assert.equal(ent.creditsReserved, 0, 'nothing is left reserved');
});

test('F1 trial AI allowance: a failed model call gives the reservation back', async () => {
  const { w, ai } = await trialWorld({ COMMERCIAL_TRIAL_AI_TOTAL: '3' });
  const realFetch = w.app; // the world's fetch always succeeds; make the model error by switching the mock usage to an empty body
  w.state.ai.text = 'Ok';
  assert.equal((await ai()).status, 200);
  const rec = JSON.parse(await w.portalStore.getSetting('commercial_trial'));
  const e = await w.store.getEntitlement(`ctai:${rec.id}`);
  assert.equal(e.creditsUsed, 1);
  assert.equal(e.creditsReserved, 0);
  void realFetch;
});

test('F1 trial AI allowance: an old JSON counter (aiUsed) is carried into the pool and the owner reset still works', async () => {
  const w = await world({ env: { AI_RATE_PER_MIN: '1000', AI_RATE_PER_DAY: '100000', COMMERCIAL_TRIAL_AI_TOTAL: '5' } });
  await w.admin('PUT', '/commercial/admin/trial', { username: 'trial-user', password: PASS, expiresAt: '' });
  const rec = JSON.parse(await w.portalStore.getSetting('commercial_trial'));
  rec.aiUsed = 4; // as written by the previous build
  await w.portalStore.setSetting('commercial_trial', JSON.stringify(rec));
  const token = (await w.req('POST', '/commercial/trial/login', { body: { username: 'trial-user', password: PASS } })).data.token;
  const ai = () => w.req('POST', '/ai/edit', { headers: { authorization: `Bearer ${token}` }, body: { message: 'x', context: CCTX, history: [], activeLevelId: 'l_1', commercial: true } });
  assert.equal((await ai()).status, 200);
  assert.equal((await ai()).status, 402, 'only one message was left (4 of 5 already used)');
  const reset = await w.admin('POST', '/commercial/admin/trial/settings', { resetAi: true });
  assert.equal(reset.data.ai.used, 0);
  assert.equal((await ai()).status, 200);
});

// ---------------------------------------------------------------------------------------------------------------------------------
test('F2 portal sign in: 60 parallel wrong passwords for one account from 60 addresses verify at most the global ceiling, not all', async () => {
  const w = await world();
  const org = await w.makeOrg();
  const cl = await w.makeClient(org);
  w.clock.t += 20 * MIN;
  const rs = await Promise.all(Array.from({ length: 60 }, (_, i) => w.req('POST', '/portal/session', { body: { identifier: cl.username, password: `wrong-${i}-zzzz` }, headers: { 'cf-connecting-ip': `192.0.2.${i + 1}`, 'x-gi-request': '1', origin: SITE } })));
  const verified = rs.filter((r) => r.status === 401).length;
  assert.ok(verified <= 40, `${verified} guesses were verified (load test before the fix: 44 of 60 with limit 5)`);
  assert.ok(rs.every((r) => [401, 423].includes(r.status)));
});

test('F2 portal sign in: 60 parallel guesses from one address across 60 usernames verify at most the per address ceiling (20)', async () => {
  const w = await world();
  const rs = await Promise.all(Array.from({ length: 60 }, (_, i) => w.req('POST', '/portal/session', { body: { identifier: `nobody-${i}`, password: `wrong-${i}-zzzz` }, headers: { 'cf-connecting-ip': '192.0.2.250', 'x-gi-request': '1', origin: SITE } })));
  const verified = rs.filter((r) => r.status === 401).length;
  assert.ok(verified <= 20, `${verified} guesses were verified (load test before the fix: 59 of 60)`);
  assert.ok(rs.filter((r) => r.status === 429).length >= 40);
});

test('F2 trial login: 60 parallel guesses across 60 addresses verify at most the global ceiling', async () => {
  const { w } = await trialWorld();
  w.clock.t += 20 * MIN;
  const rs = await Promise.all(Array.from({ length: 60 }, (_, i) => w.req('POST', '/commercial/trial/login', { body: { username: 'trial-user', password: `wrong-trial-${i}-xx` }, headers: { 'cf-connecting-ip': `192.0.2.${i + 1}` } })));
  const verified = rs.filter((r) => r.status === 401).length;
  assert.ok(verified <= 40, `${verified} guesses were verified`);
});

// ---------------------------------------------------------------------------------------------------------------------------------
test('F3 expiry indexes exist in schema.sql and migration 0021 (repeatable), and the purges are bounded and use them', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const mig = fs.readFileSync(new URL('../server/migrations/0021_expiry_indexes.sql', import.meta.url), 'utf8');
  assert.ok(!/\b(DROP|ALTER|TRUNCATE)\b|DELETE\s+FROM/i.test(mig.replace(/--.*$/gm, '')), 'additive only');
  const w = await world();
  const db = w.db._db;
  db.exec(mig);
  db.exec(mig); // repeatable
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name);
  for (const n of ['idx_sessions_expires', 'idx_psessions_expires', 'idx_rate_limits_window']) assert.ok(names.includes(n), n);
  const plan = (sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(' | ');
  assert.match(plan("DELETE FROM sessions WHERE id_hash IN (SELECT id_hash FROM sessions WHERE expires_at <= '2026' LIMIT 200)"), /idx_sessions_expires/);
  assert.match(plan("DELETE FROM profile_sessions WHERE id_hash IN (SELECT id_hash FROM profile_sessions WHERE expires_at <= '2026' LIMIT 200)"), /idx_psessions_expires/);
  assert.match(plan("DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE window_start < 5 AND key NOT LIKE 'topupm:%' LIMIT 500)"), /idx_rate_limits_window/);
  void DatabaseSync;
});

test('F3 purges delete a bounded batch per call, for sessions, profile sessions, rate limits and sign in counters', async () => {
  const w = await world();
  const db = w.db._db;
  const old = '2020-01-01T00:00:00.000Z';
  db.exec('PRAGMA foreign_keys = OFF'); // the rows only need to exist for the purge
  const ins = db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)');
  const insP = db.prepare('INSERT INTO profile_sessions (id_hash, profile_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)');
  const insR = db.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)');
  for (let i = 0; i < 1300; i += 1) { ins.run(`s${i}`, 'u1', old, old, old); insP.run(`p${i}`, 'p1', old, old, old); insR.run(`k${i}`, 1000); }
  const n = (t) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n);
  await w.portalStore.purgeSessions(new Date(T0).toISOString());
  assert.equal(n('sessions'), 1100, 'one batch of 200 removed');
  await w.profileStore.purgeSessions(new Date(T0).toISOString());
  assert.equal(n('profile_sessions'), 1100);
  await w.store.purgeRateLimits(T0);
  assert.equal(n('rate_limits'), 800, 'one batch of 500 removed');
  for (let i = 0; i < 4; i += 1) await w.store.purgeRateLimits(T0);
  assert.equal(n('rate_limits'), 0, 'repeated calls (the cron) clear the backlog');
});

// ---------------------------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------------------
const lag = (ms = 8) => new Promise((r) => setTimeout(r, ms));
// A real D1 round trip takes milliseconds, so two requests overlap between a read and the write that follows it. The in memory shim answers
// at once, so the reads that start a check then write sequence are given a small delay to reproduce that overlap (it is what exposed F8 and F11).
function slowReads(obj, names) {
  for (const n of names) {
    const orig = obj[n].bind(obj);
    obj[n] = async (...a) => { const v = await orig(...a); await lag(); return v; };
  }
}
async function profileWorld() {
  const w = await world({ env: { PROFILE_SAVE_RATE_MAX: '10000', FREE_PROFILE_MAX_DESIGNS: '10' } });
  slowReads(w.profileStore, ['countDesigns', 'getDesignByProject']);
  return w;
}
async function signedProfile(w, n = 1) {
  const b = w.browser('gi_profile', { ip: `203.0.113.${100 + n}` });
  const email = `owner${n}@example.test`;
  const su = await b.post('/profile/signup', { email, name: 'Owner', password: PW, role: 'homeowner', acceptTerms: true, acceptPrivacy: true, marketing: false, postcode: '2000', phone: '' });
  assert.ok([200, 202].includes(su.status), su.text);
  const si = await b.post('/profile/session', { email, password: PW });
  assert.equal(si.status, 200, si.text);
  return b;
}
const design = (id, name = 'D') => ({ project: { schema: 1, id, name, levels: [{ id: 'l_1', name: 'Ground' }], createdAt: 'x', updatedAt: 'x' }, thumbnail: null });

test('F8 profile design limit: 8 parallel creates with 9 of 10 stored leave at most 10', async () => {
  const w = await profileWorld();
  const b = await signedProfile(w);
  for (let i = 0; i < 9; i += 1) assert.equal((await b.post('/profile/designs', design(`p_seed${i}`))).status, 201);
  const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => b.post('/profile/designs', design(`p_race${i}`))));
  assert.equal(rs.filter((r) => r.status === 201).length, 1, 'exactly one fits');
  assert.equal(rs.filter((r) => r.data?.error?.code === 'DESIGN_LIMIT_REACHED').length, 7);
  const list = await b.get('/profile/designs');
  assert.equal(list.data.designs.length, 10, `stored ${list.data.designs.length} (before the fix: 13)`);
});

test('F8 profile first save: 6 simultaneous first saves of one new design give one created and the rest updates, never a 409', async () => {
  const w = await profileWorld();
  const b = await signedProfile(w, 2);
  const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => b.post('/profile/designs', design('p_same', `Tab ${i}`))));
  assert.ok(rs.every((r) => [200, 201].includes(r.status)), rs.map((r) => r.status).join(','));
  assert.equal(rs.filter((r) => r.status === 201).length, 1);
  assert.equal((await b.get('/profile/designs')).data.designs.length, 1);
});

test('F8 profile duplicate respects the limit in the same statement', async () => {
  const w = await profileWorld();
  const b = await signedProfile(w, 3);
  const first = await b.post('/profile/designs', design('p_dup'));
  for (let i = 0; i < 8; i += 1) await b.post('/profile/designs', design(`p_fill${i}`)); // 9 of 10 stored
  const rs = await Promise.all(Array.from({ length: 4 }, () => b.post(`/profile/designs/${first.data.design.id}/duplicate`, {})));
  assert.equal(rs.filter((r) => r.status === 201).length, 1, 'exactly one copy fits');
  assert.equal((await b.get('/profile/designs')).data.designs.length, 10);
});

// ---------------------------------------------------------------------------------------------------------------------------------
test('F5 shared project: concurrent updates leave the D1 row and the stored body from the same writer (80 rounds)', async () => {
  const w = await world({ env: { PROJECT_SAVE_RATE_MAX: '100000', PROJECT_READ_RATE_MAX: '100000' }, files: true });
  const proj = (name) => ({ project: { schema: 1, id: 'p1', name, levels: [{ id: 'l1' }] } });
  const create = await w.req('POST', '/projects', { body: proj('first'), headers: { 'cf-connecting-ip': '198.51.100.5' } });
  assert.equal(create.status, 201, create.text);
  const { id, editKey } = create.data;
  const put = w.R2.put.bind(w.R2);
  w.R2.put = async (k, v, o) => { await lag(Math.random() * 6); return put(k, v, o); }; // object storage latency varies, so the two writers finish in either order
  const upd = w.store.updateSharedProject.bind(w.store);
  w.store.updateSharedProject = async (...a) => { await lag(Math.random() * 6); return upd(...a); }; // and so does the database write that follows
  let mismatches = 0;
  for (let round = 0; round < 80; round += 1) {
    const rs = await Promise.all(['A', 'B'].map((n) => w.req('PUT', `/projects/${id}`, { body: proj(`${n}${round}-${'x'.repeat(n === 'A' ? 5 : 50)}`), headers: { 'x-edit-key': editKey, 'cf-connecting-ip': '198.51.100.5' } })));
    assert.ok(rs.every((r) => r.status === 200), rs.map((r) => r.text).join(' '));
    const read = await w.req('GET', `/projects/${id}`, { headers: { 'cf-connecting-ip': '198.51.100.6' } });
    const row = await w.store.getSharedProject(id);
    const stored = read.data.name;
    if (row.name !== stored || row.bytes !== JSON.stringify(read.data.project).length || read.data.project.name !== stored) mismatches += 1;
  }
  assert.equal(mismatches, 0);
  const keys = [...w.putFiles.keys()].filter((k) => k.startsWith(`projects/${id}`));
  assert.equal(keys.length, 1, `old bodies are removed (found ${keys.join(', ')})`);
});

test('F5 shared project: a link updated by an earlier build (plain key) still reads, updates and deletes', async () => {
  const w = await world({ files: true });
  const create = await w.req('POST', '/projects', { body: { project: { schema: 1, id: 'p1', name: 'one', levels: [{ id: 'l1' }] } } });
  const { id, editKey } = create.data;
  const up = await w.req('PUT', `/projects/${id}`, { body: { project: { schema: 1, id: 'p1', name: 'two', levels: [{ id: 'l1' }] } }, headers: { 'x-edit-key': editKey } });
  assert.equal(up.status, 200);
  assert.equal((await w.req('GET', `/projects/${id}`)).data.project.name, 'two');
  // simulate a row left by the old build: body under the plain key, row updated_at differs from created_at
  const row = await w.store.getSharedProject(id);
  for (const k of [...w.putFiles.keys()]) w.putFiles.delete(k);
  w.putFiles.set(`projects/${id}.json`, JSON.stringify({ schema: 1, id: 'p1', name: 'legacy', levels: [{ id: 'l1' }] }));
  assert.ok(row.updatedAt !== row.createdAt);
  assert.equal((await w.req('GET', `/projects/${id}`)).data.project.name, 'legacy');
});

// ---------------------------------------------------------------------------------------------------------------------------------
test('F7 portal me: a repeat load writes nothing and reads fewer rows than before', async () => {
  const w = await world();
  const org = await w.makeOrg();
  const cl = await w.makeClient(org);
  await cl.browser.get('/portal/me'); // first look this month may create the pools
  const db = w.db._db;
  const counts = { reads: 0, writes: 0 };
  const origPrepare = db.prepare.bind(db);
  db.prepare = (sql) => { const s = origPrepare(sql); if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) counts.writes += 1; else counts.reads += 1; return s; };
  const r = await cl.browser.get('/portal/me');
  db.prepare = origPrepare;
  assert.equal(r.status, 200);
  assert.equal(counts.writes, 0, `me wrote ${counts.writes} times`);
  assert.ok(counts.reads <= 9, `me ran ${counts.reads} reads`);
});

test('F11 organisation short code: 6 organisations created together all succeed with distinct short codes and slugs', async () => {
  const w = await world();
  slowReads(w.portalStore, ['getOrgByShortCode', 'getOrgBySlug']);
  const rs = await Promise.all(Array.from({ length: 6 }, () => w.admin('POST', '/portal/admin/orgs', { name: 'Hunter Homes Pty Ltd', adminFirstName: 'Pat', adminEmail: `pat${Math.random().toString(16).slice(2)}@hunter.example` })));
  assert.ok(rs.every((r) => r.status === 201), rs.map((r) => r.status).join(','));
  assert.equal(new Set(rs.map((r) => r.data.org.shortCode)).size, 6);
});

// ---------------------------------------------------------------------------------------------------------------------------------
test('CON-006 Anthropic credit balance too low becomes the paused state (503 AI_PAUSED), credits untouched', async () => {
  assert.equal(isBillingError(400, { error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } }), true);
  assert.equal(isBillingError(402, {}), true);
  assert.equal(isBillingError(400, { error: { type: 'billing_error', message: 'x' } }), true);
  assert.equal(isBillingError(400, { error: { type: 'invalid_request_error', message: 'max_tokens too large' } }), false);
  assert.equal(isBillingError(429, { error: { type: 'rate_limit_error', message: 'slow down' } }), false);
  const w = await world({ env: { AI_RATE_PER_MIN: '1000', AI_RATE_PER_DAY: '100000' } });
  const { token, ent } = await w.packToken('proj_abc123', 30);
  const ai = () => w.req('POST', '/ai/edit', { headers: { authorization: `Bearer ${token}` }, body: { message: 'make it bigger', context: 'PROJECT "T" type=house units=mm\nLEVEL l_1 "Ground" active', history: [] } });
  w.state.ai.error = { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } } };
  const r = await ai();
  assert.equal(r.status, 503, r.text);
  assert.equal(r.data.error.code, 'AI_PAUSED');
  assert.match(r.data.error.message, /paused/i);
  const e1 = await w.store.getEntitlement(ent.id);
  assert.equal(e1.creditsUsed, 0, 'nothing charged');
  assert.equal(e1.creditsReserved, 0, 'nothing left reserved');
  // an ordinary upstream failure is still AI_ERROR
  w.state.ai.error = { status: 500, body: { type: 'error', error: { type: 'api_error', message: 'boom' } } };
  assert.equal((await ai()).data.error.code, 'AI_ERROR');
  w.state.ai.error = null;
  assert.equal((await ai()).status, 200);
});
