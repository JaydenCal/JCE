// The merge of the LIVE Pocket Architect API (Worker "pocket-architect-api", 15/10/2026) into the release server.
// Runs the real Worker entry (server/worker.js) against a D1 shaped adapter over node:sqlite and a fake R2 bucket.
//   1. The release migrations apply on top of the live database (live schema.sql + migrations 0002 to 0005), keep every live row,
//      and end in the same shape as server/schema.sql.
//   2. Share links, Plan Pack tokens and PDF sets that the live Worker issued still work on the release server.
//   3. The live test suites for Save and share and for payments, ported (same paths, bodies, codes and rules).

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import worker from '../server/worker.js';
import { createApp } from '../server/lib/app.js';
import { createD1Store, createMemoryStore } from '../server/lib/store.js';
import { createProject } from '../src/model/schema.js';
import { applyOp } from '../src/model/ops.js';

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  /* Node without node:sqlite: these tests are skipped */
}
const opts = { skip: !DatabaseSync && 'node:sqlite is not available' };

const rd = (url) => fs.readFileSync(new URL(url, import.meta.url), 'utf8');
const LIVE = '../../live-v6-reference/server/';
const MIG = '../server/migrations/';
const migrationFiles = () => fs.readdirSync(new URL(MIG, import.meta.url)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();

// The live database as it stands today: live schema.sql, then its migrations 0002 to 0005.
function liveDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(rd(`${LIVE}schema.sql`));
  for (const f of ['0002_exports.sql', '0003_ai.sql', '0004_hardening.sql', '0005_projects.sql']) db.exec(rd(`${LIVE}migrations/${f}`));
  return db;
}
// What `wrangler d1 migrations apply` does: each file once, in order. (0001 to 0005 are repeatable, so the live database re-runs them harmlessly.)
const applyRelease = (db, files = migrationFiles()) => files.forEach((f) => db.exec(rd(MIG + f)));

function d1Of(db, hooks = {}) {
  const statement = (sql) => {
    const st = db.prepare(sql);
    return {
      bind: (...a) => ({
        run: async () => {
          if (hooks.failOn && sql.includes(hooks.failOn)) {
            hooks.failOn = null;
            throw new Error('db down');
          }
          return { success: true, meta: { changes: Number(st.run(...a).changes) } };
        },
        first: async () => st.get(...a) ?? null,
        all: async () => ({ results: st.all(...a) }),
      }),
    };
  };
  return { prepare: statement };
}
function r2() {
  const files = new Map();
  return {
    files,
    get: async (k) => (files.has(k) ? { text: async () => files.get(k).v, body: files.get(k).v, customMetadata: files.get(k).meta } : null),
    put: async (k, v, o) => void files.set(k, { v, meta: o?.customMetadata }),
    delete: async (k) => void files.delete(k),
  };
}

const WHSEC = 'whsec_t';
const SECRET = 's3cret';
function mk(over = {}, { db = liveDb(), migrate = true } = {}) {
  if (migrate) applyRelease(db);
  const hooks = { failOn: null };
  const FILES = r2();
  const env = {
    DB: d1Of(db, hooks), FILES, SITE_URL: 'https://x.test', APP_URL: 'https://x.test/plan-studio/app/', IP_HASH_SALT: 'salt',
    STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_SECRET_KEY: 'sk_test_x', ENTITLEMENT_SECRET: SECRET, ANTHROPIC_API_KEY: 'sk-ant-test',
    EXPORT_PDF_WAIT_MS: '0', ...over,
  };
  const call = (p, o = {}) => worker.fetch(new Request('https://x.test/api' + p, o), env);
  const sign = (raw, t = Math.floor(Date.now() / 1e3), secret = WHSEC) => crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  const hookRaw = (raw, header) => call('/stripe/webhook', { method: 'POST', body: raw, headers: { 'stripe-signature': header } });
  const hook = (ev) => {
    const raw = JSON.stringify(ev);
    const t = Math.floor(Date.now() / 1e3);
    return hookRaw(raw, `t=${t},v1=${sign(raw, t)}`);
  };
  const restore = (email, ref, extra = {}, ip = '1.2.3.4') =>
    call('/entitlement/restore', { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: JSON.stringify({ email, sessionOrReceipt: ref, ...extra }) });
  const rows = () => db.prepare('SELECT * FROM entitlements').all();
  return { db, env, FILES, files: FILES.files, call, hook, hookRaw, sign, restore, rows, hooks };
}
const j = (r) => r.json();

// ---- 1. migrations --------------------------------------------------------------------------------------------------------
const columns = (db) => {
  const out = {};
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
    out[name] = db.prepare(`PRAGMA table_info(${name})`).all().map((c) => `${c.name} ${c.type}${c.notnull ? ' NOT NULL' : ''}${c.pk ? ' PK' : ''} d=${c.dflt_value ?? ''}`).sort();
  }
  return out;
};
const indexes = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);

const LIVE_ENT = {
  id: 'ent_live00000001', project_id: 'p_live0001', email: 'buyer@example.com', stripe_session_id: 'cs_test_live1', payment_intent: 'pi_live1',
  amount_cents: 3500, currency: 'aud', credits_total: 500, credits_used: 120, pdf_used: 1, pdf_allowed: 1, pdf_file: 'pdf/ent_live00000001.pdf',
  status: 'active', created_at: '2026-10-16T01:00:00.000Z', expires_at: '2099-01-01T00:00:00.000Z',
};
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const LIVE_SHARE = 'LiveShareId0000000001';

function seedLive(db) {
  const e = LIVE_ENT;
  db.prepare('INSERT INTO entitlements(id,project_id,email,stripe_session_id,payment_intent,amount_cents,currency,credits_total,credits_used,pdf_used,pdf_allowed,pdf_file,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(e.id, e.project_id, e.email, e.stripe_session_id, e.payment_intent, e.amount_cents, e.currency, e.credits_total, e.credits_used, e.pdf_used, e.pdf_allowed, e.pdf_file, e.status, e.created_at, e.expires_at);
  db.prepare("INSERT INTO entitlements(id,project_id,email,stripe_session_id,credits_total,pdf_allowed,status,created_at,expires_at) VALUES('ent_livecode0001','*','f@x.com','code:PA-FRIENDS-4818BD73:f@x.com',500,20,'active','2026-10-16T01:00:00.000Z','2099-01-01T00:00:00.000Z')").run();
  db.prepare("INSERT INTO entitlements(id,project_id,email,stripe_session_id,payment_intent,credits_total,status,created_at) VALUES('ent_liverefund01','p_refunded1','r@x.com','cs_test_ref','pi_ref',500,'refunded','2026-10-16T01:00:00.000Z')").run();
  db.prepare("INSERT INTO webhook_events(id,type,received_at) VALUES('evt_old','checkout.session.completed','2026-10-16T01:00:00.000Z'),('refund:pi_ref','refund-marker','2026-10-16T02:00:00.000Z')").run();
  db.prepare('INSERT INTO projects(id,edit_key_hash,name,email,bytes,created_at,updated_at,expires_at,ip_hash) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(LIVE_SHARE, sha256('live-edit-key'), 'Live house', 'lead@example.com', 100, '2026-10-16T03:00:00.000Z', '2026-10-16T03:00:00.000Z', '2099-01-01T00:00:00.000Z', 'abc');
  db.prepare("INSERT INTO ai_usage(entitlement_id,model,credits,status,created_at) VALUES('ent_live00000001','claude-haiku-5-5',3,'ok','2026-10-16T04:00:00.000Z')").run();
  db.prepare("INSERT INTO export_log(entitlement_id,type,created_at) VALUES('ent_live00000001','pdf','2026-10-16T04:00:00.000Z')").run();
}

test('migrations: the release migrations apply on top of the live database and keep every live row', opts, () => {
  const db = liveDb();
  seedLive(db);
  const before = {
    ent: db.prepare('SELECT * FROM entitlements ORDER BY id').all(),
    proj: db.prepare('SELECT * FROM projects').all(),
    hooks: db.prepare('SELECT * FROM webhook_events ORDER BY id').all(),
    usage: db.prepare('SELECT * FROM ai_usage').all(),
    log: db.prepare('SELECT * FROM export_log').all(),
  };
  const liveCols = columns(db);
  applyRelease(db);
  // every live row, column for column
  for (const [i, row] of before.ent.entries()) {
    const now = db.prepare('SELECT * FROM entitlements WHERE id = ?').get(row.id);
    for (const k of Object.keys(row)) assert.equal(now[k], row[k], `entitlements.${k} of ${row.id} unchanged`);
    assert.equal(now.credits_reserved, 0, `credits_reserved starts at 0 (row ${i})`);
  }
  assert.deepEqual(db.prepare('SELECT * FROM projects').all(), before.proj);
  assert.deepEqual(db.prepare('SELECT * FROM webhook_events ORDER BY id').all(), before.hooks);
  assert.deepEqual(db.prepare('SELECT * FROM ai_usage').all(), before.usage);
  assert.deepEqual(db.prepare('SELECT * FROM export_log').all(), before.log);
  // nothing live lost or changed: every live column is still there with the same type, default and constraint
  const after = columns(db);
  for (const [table, cols] of Object.entries(liveCols)) for (const c of cols) assert.ok(after[table]?.includes(c), `live column kept: ${table}.${c}`);
  // the only change to a live table is the one added column
  assert.deepEqual(after.entitlements.filter((c) => !liveCols.entitlements.includes(c)), ['credits_reserved INTEGER NOT NULL d=0']);
  for (const t of Object.keys(liveCols)) if (t !== 'entitlements') assert.deepEqual(after[t], liveCols[t], `${t} untouched`);
  // the live "projects" table is not shadowed by the portal's projects
  assert.ok(after.projects.some((c) => c.startsWith('edit_key_hash')));
  assert.ok(after.portal_projects.some((c) => c.startsWith('owner_id')));
});

test('migrations: a fresh database built by the migrations has the same shape as schema.sql, and both are repeatable', opts, () => {
  const chain = new DatabaseSync(':memory:');
  applyRelease(chain);
  const flat = new DatabaseSync(':memory:');
  flat.exec(rd('../server/schema.sql'));
  assert.deepEqual(columns(chain), columns(flat), 'tables and columns');
  assert.deepEqual(indexes(chain), indexes(flat), 'indexes');
  // schema.sql on top of the migrated live database changes nothing and does not fail
  const live = liveDb();
  seedLive(live);
  applyRelease(live);
  const shape = JSON.stringify([columns(live), indexes(live)]);
  live.exec(rd('../server/schema.sql'));
  assert.equal(JSON.stringify([columns(live), indexes(live)]), shape);
  // 0001 to 0005 and 0007 are repeatable (the live database has run 0001 to 0005 already); 0006 and 0008 add a column, so each is applied once
  for (const f of migrationFiles()) if (!['0006_release.sql', '0008_trial_volume.sql'].includes(f)) live.exec(rd(MIG + f));
  assert.equal(JSON.stringify([columns(live), indexes(live)]), shape);
  assert.throws(() => live.exec(rd(`${MIG}0006_release.sql`)), /duplicate column/i, '0006 is not repeatable, which is why it is applied with "d1 migrations apply"');
  assert.throws(() => live.exec(rd(`${MIG}0008_trial_volume.sql`)), /duplicate column/i, '0008 adds orgs.custom_login_cents once');
  // numbering is continuous, so "d1 migrations apply" runs them in the intended order
  assert.deepEqual(migrationFiles().map((f) => f.slice(0, 4)), ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009']);
});

test('migrations: nothing destructive in any release migration', opts, () => {
  for (const f of ['0001_base.sql', '0006_release.sql', '0007_portal.sql', '0008_trial_volume.sql']) {
    const sql = rd(MIG + f).replace(/--.*$/gm, '');
    assert.ok(!/\bDROP\b|\bDELETE\s+FROM\b|\bRENAME\b|\bTRUNCATE\b|\bUPDATE\b/i.test(sql), `${f} has no DROP, DELETE, RENAME or UPDATE`);
    const alters = sql.match(/ALTER TABLE[^;]*;/gi) || [];
    for (const a of alters) assert.match(a, /ADD COLUMN/i, `${f}: ${a.trim()}`);
  }
  // every CREATE in the release files is IF NOT EXISTS
  for (const f of migrationFiles()) {
    const creates = rd(MIG + f).replace(/--.*$/gm, '').match(/CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\s+(?!IF NOT EXISTS)/gi);
    assert.equal(creates, null, `${f} only uses CREATE ... IF NOT EXISTS`);
  }
});

test('the release store runs its queries on the migrated live database', opts, async () => {
  const db = liveDb();
  seedLive(db);
  applyRelease(db);
  const store = createD1Store(d1Of(db));
  const ent = await store.getEntitlement('ent_live00000001');
  assert.equal(ent.stripePaymentIntent, 'pi_live1');
  assert.equal(ent.creditsUsed, 120);
  assert.equal(ent.pdfFile, 'pdf/ent_live00000001.pdf');
  assert.equal((await store.getEntitlementByPaymentIntent('pi_live1')).id, ent.id);
  assert.equal((await store.findForRestore('BUYER@example.com', 'cs_test_live1')).id, ent.id);
  assert.equal(await store.reserveCredits(ent.id, 100, '2026-11-12T00:00:00.000Z'), true);
  assert.equal(await store.reserveCredits(ent.id, 300, '2026-11-12T00:00:00.000Z'), false, '120 used + 100 reserved + 300 > 500');
  await store.settleCredits(ent.id, 100, 40);
  const after = await store.getEntitlement(ent.id);
  assert.deepEqual([after.creditsUsed, after.creditsReserved], [160, 0]);
  assert.equal(await store.claimPdfSet(ent.id), false, 'the live PDF set is already issued');
  await store.logAiRequest({ id: 'req_1', entitlementId: ent.id, createdAt: 'x', status: 'ok' });
  await store.addSpend('d:2026-11-12', 5);
  assert.equal(await store.getSpend('d:2026-11-12'), 5);
  assert.equal(await store.hitRate('k', 60, Date.now()), 1);
  await store.putSiteCache('k', 'v', 60, Date.now());
  assert.equal(await store.getSiteCache('k', Date.now()), 'v');
  await store.saveEnquiry({ id: 'e1', reference: 'GI-AAAAA', createdAt: 'x', name: 'n', phone: 'p', email: 'e@x.co', need: 'da', lot: {} });
  assert.equal((await store.listEnquiries()).length, 1);
  assert.equal((await store.getSharedProject(LIVE_SHARE)).editKeyHash, sha256('live-edit-key'));
  assert.equal(await store.hasWebhookEvent('refund:pi_ref'), true);
});

// ---- 2. what the live Worker issued still works -----------------------------------------------------------------------------
// The token algorithm is the live one, written out independently of the release code.
const b64u = (b) => Buffer.from(b).toString('base64url');
const liveToken = (eid, pid, exp = Math.floor(Date.now() / 1e3) + 86400) => {
  const p = b64u(JSON.stringify({ eid, pid, exp }));
  return `${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('base64url')}`;
};
function sampleProject(id) {
  const p = createProject({ id, name: 'Smith residence' });
  applyOp(p, 'add_room', { type: 'living', name: 'Living', x: 0, y: 0, width: 6000, depth: 4500 });
  return p;
}

test('live links and purchases keep working on the release server', opts, async () => {
  const db = liveDb();
  seedLive(db);
  const m = mk({}, { db });
  // a share link handed out before the release
  m.files.set(`projects/${LIVE_SHARE}.json`, { v: JSON.stringify({ schema: 1, id: 'p_x1', name: 'Live house', levels: [{ id: 'l1' }] }) });
  const g = await m.call(`/projects/${LIVE_SHARE}`);
  assert.equal(g.status, 200);
  const gb = await j(g);
  assert.equal(gb.project.name, 'Live house');
  assert.equal(gb.name, 'Live house');
  assert.equal(gb.expiresAt, '2099-01-01T00:00:00.000Z');
  // its edit key (the browser that saved still holds it) still updates it
  const up = await m.call(`/projects/${LIVE_SHARE}`, {
    method: 'PUT', headers: { 'x-edit-key': 'live-edit-key', 'content-type': 'application/json' },
    body: JSON.stringify({ project: { schema: 1, id: 'p_x1', name: 'Renamed', levels: [{ id: 'l1' }] } }),
  });
  assert.equal(up.status, 200);
  assert.equal(db.prepare('SELECT name FROM projects WHERE id = ?').get(LIVE_SHARE).name, 'Renamed');
  assert.equal(db.prepare('SELECT email FROM projects WHERE id = ?').get(LIVE_SHARE).email, 'lead@example.com', 'the lead email is kept');
  // a token the live Worker signed (same ENTITLEMENT_SECRET) is still accepted, and the live credits are read as they were
  const A = { authorization: `Bearer ${liveToken('ent_live00000001', 'p_live0001')}` };
  const cr = await j(await m.call('/credits', { headers: A }));
  assert.deepEqual([cr.total, cr.used, cr.remaining], [500, 120, 380]);
  // the purchase screen after paying, and Restore purchase, by email + session, payment intent or receipt
  const ent = await m.call('/entitlement?session_id=cs_test_live1&project=p_live0001');
  assert.equal(ent.status, 200);
  const eb = await j(ent);
  assert.equal(eb.receipt, 'ent_live00000001');
  assert.deepEqual([eb.credits.total, eb.credits.used, eb.credits.remaining], [500, 120, 380]);
  for (const ref of ['cs_test_live1', 'pi_live1', 'ent_live00000001']) {
    const r = await m.restore(' Buyer@Example.com ', ref);
    assert.equal(r.status, 200, ref);
    const b = await j(r);
    assert.equal(b.projectId, 'p_live0001');
    assert.equal(b.project, 'p_live0001', 'the live field name is still there');
  }
  // the live friends code, set as the TEST_CODES secret
  const code = await m.restore('f@x.com', 'PA-FRIENDS-4818BD73');
  assert.equal(code.status, 403, 'with no TEST_CODES secret the code is refused (NOT_ENTITLED), as on the live Worker');
  const m2 = mk({ TEST_CODES: 'PA-FRIENDS-4818BD73' }, { db, migrate: false });
  const c2 = await m2.restore('f@x.com', 'PA-FRIENDS-4818BD73', { projectId: 'p_mine0001' });
  assert.equal(c2.status, 200);
  const c2b = await j(c2);
  assert.equal(c2b.projectId, 'p_mine0001');
  assert.equal((await m2.call('/credits', { headers: { authorization: `Bearer ${c2b.token}` } })).status, 200);
  // PDF_SET_LIMIT is "0" by default (owner decision 11/11/2026): a migrated live purchase re-exports its current design as a new build.
  m.files.set('pdf/ent_live00000001.pdf', { v: new TextEncoder().encode('%PDF-live'), meta: { filename: 'plans.pdf' } });
  const pdf = await m.call('/export/pdf', { method: 'POST', headers: { ...A, 'content-type': 'application/json' }, body: JSON.stringify({ project: sampleProject('p_live0001') }) });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  const rebuilt = Buffer.from(await pdf.arrayBuffer()).toString('latin1');
  assert.ok(rebuilt.startsWith('%PDF-1') && !rebuilt.startsWith('%PDF-live'), 'a fresh PDF of the current design, not the stored set');
  assert.equal(db.prepare('SELECT pdf_used FROM entitlements WHERE id = ?').get('ent_live00000001').pdf_used, 1, 'no set is claimed');
  // with PDF_SET_LIMIT=1 the live rule comes back: the issued set is handed back (not rebuilt, not a second set)
  const locked = mk({ PDF_SET_LIMIT: '1' }, { db, migrate: false });
  locked.files.set('pdf/ent_live00000001.pdf', { v: new TextEncoder().encode('%PDF-live'), meta: { filename: 'plans.pdf' } });
  const again = await locked.call('/export/pdf', { method: 'POST', headers: { ...A, 'content-type': 'application/json' }, body: JSON.stringify({ project: sampleProject('p_live0001') }) });
  assert.equal(again.status, 200);
  assert.equal(Buffer.from(await again.arrayBuffer()).toString(), '%PDF-live');
  // a refunded live purchase stays refunded
  const refunded = await m.call('/entitlement?session_id=cs_test_ref&project=p_refunded1');
  assert.equal(refunded.status, 403);
  // health: the live body, with sharing true
  const h = await j(await m.call('/health'));
  assert.deepEqual(h, { ok: true, sharing: true, aiPaused: false, paymentsConfigured: true });
});

test('the AI assistant reserves and settles credits on a migrated live purchase', opts, async () => {
  const db = liveDb();
  seedLive(db);
  const m = mk({}, { db });
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => {
    if (String(u) === 'https://api.anthropic.com/v1/messages') {
      return new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Done.' }, { type: 'tool_use', id: 'toolu_1', name: 'set_finish', input: { target: 'roof', colour: 'steel-charcoal' } }], stop_reason: 'end_turn', usage: { input_tokens: 5200, output_tokens: 180, cache_read_input_tokens: 5800 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  try {
    const A = { authorization: `Bearer ${liveToken('ent_live00000001', 'p_live0001')}`, 'content-type': 'application/json' };
    const body = JSON.stringify({ message: 'Make the roof dark grey', context: 'PROJECT "T" type=house units=mm\nLEVEL l_1 "Ground" active', history: [], activeLevelId: 'l_1' });
    const r = await m.call('/ai/edit', { method: 'POST', headers: A, body });
    assert.equal(r.status, 200, await r.clone().text());
    const b = await j(r);
    assert.ok(b.credits.charged >= 1);
    const row = db.prepare('SELECT credits_used, credits_reserved FROM entitlements WHERE id = ?').get('ent_live00000001');
    assert.equal(row.credits_reserved, 0, 'nothing left reserved');
    assert.equal(row.credits_used, 120 + b.credits.charged);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM ai_requests').get().n, 1);
  } finally {
    globalThis.fetch = real;
  }
});

test('tokens: a token signed by the live algorithm is accepted, and one issued here verifies with the live algorithm', opts, async () => {
  const { signToken, verifyToken } = await import('../server/lib/entitlement.js');
  const exp = Math.floor(Date.now() / 1e3) + 3600;
  const live = liveToken('ent_a', 'p_a', exp);
  assert.deepEqual(await verifyToken(live, SECRET, Math.floor(Date.now() / 1e3)), { eid: 'ent_a', pid: 'p_a', exp });
  const ours = await signToken({ eid: 'ent_a', pid: 'p_a', exp }, SECRET);
  assert.equal(ours, live, 'byte for byte the live format, so a rolled back Worker still accepts what this one issued');
  // the first release build's format (HMAC over the decoded bytes) is still read
  const body = Buffer.from(JSON.stringify({ eid: 'ent_a', pid: 'p_a', exp }));
  const raw = `${body.toString('base64url')}.${crypto.createHmac('sha256', SECRET).update(body).digest('base64url')}`;
  assert.ok(await verifyToken(raw, SECRET, Math.floor(Date.now() / 1e3)));
  assert.equal(await verifyToken(live, 'other-secret', Math.floor(Date.now() / 1e3)), null);
  assert.equal(await verifyToken(`${live.split('.')[0]}.${'A'.repeat(43)}`, SECRET, Math.floor(Date.now() / 1e3)), null);
});

// ---- 3a. Save and share: the live projects.test.mjs, ported -----------------------------------------------------------------
const project = (over = {}) => ({ schema: 1, id: 'p_abc12345', name: 'My house', levels: [{ id: 'l1', name: 'Ground', walls: [], rooms: [] }], site: { northDeg: 0, underlay: { key: 'x', data: 'data:image/png;base64,AAAA' }, tanks: [] }, ...over });
function share(over = {}) {
  const m = mk(over);
  const post = (body, ip = '1.1.1.1') => m.call('/projects', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, origin: 'https://x.test' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const put = (id, body, key, ip = '1.1.1.1') => m.call(`/projects/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(key ? { 'x-edit-key': key } : {}) }, body: JSON.stringify(body) });
  return { ...m, post, put };
}

test('share: create returns id, editKey and a share url; the key is stored only as a hash', opts, async () => {
  const m = share();
  const r = await m.post({ project: project(), email: 'Lead@Example.com' });
  assert.equal(r.status, 201);
  const b = await j(r);
  assert.match(b.id, /^[\w-]{16,}$/);
  assert.ok(b.editKey.length >= 24);
  assert.equal(b.url, `https://x.test/plan-studio/app/?share=${b.id}`);
  const row = m.db.prepare('SELECT * FROM projects').get();
  assert.equal(row.id, b.id);
  assert.notEqual(row.edit_key_hash, b.editKey);
  assert.match(row.edit_key_hash, /^[0-9a-f]{64}$/);
  assert.equal(row.email, 'lead@example.com', 'email stored as a lead');
  assert.ok(!JSON.stringify(row).includes('1.1.1.1'), 'raw IP never stored');
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://x.test');
  assert.equal(JSON.stringify(b).includes('lead@'), false, 'email never echoed');
  assert.ok(m.files.has(`projects/${b.id}.json`), 'the design is in R2 under projects/<id>.json');
});

test('share: read returns the project read only, with the underlay stripped', opts, async () => {
  const m = share();
  const { id } = await j(await m.post({ project: project() }));
  const r = await m.call(`/projects/${id}`);
  assert.equal(r.status, 200);
  const b = await j(r);
  assert.equal(b.project.name, 'My house');
  assert.equal(b.project.site.underlay, null);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Object.keys(b).sort(), ['createdAt', 'expiresAt', 'id', 'name', 'project', 'updatedAt'], 'the live response body');
  assert.equal((await m.call(`/projects/${id}`, { method: 'DELETE' })).status, 405, 'no delete route');
  assert.equal((await m.call('/projects/nope')).status, 404);
  assert.equal((await m.call(`/projects/${'a'.repeat(20)}`)).status, 404);
});

test('share: update needs the edit key', opts, async () => {
  const m = share();
  const { id, editKey } = await j(await m.post({ project: project() }));
  assert.equal((await m.put(id, { project: project({ name: 'New' }) })).status, 403, 'no key');
  const wrong = await m.put(id, { project: project({ name: 'New' }) }, 'wrong-key');
  assert.equal(wrong.status, 403, 'wrong key');
  assert.equal((await j(wrong)).error.code, 'BAD_EDIT_KEY');
  assert.equal((await j(await m.call(`/projects/${id}`))).project.name, 'My house', 'unchanged after refused updates');
  assert.equal((await m.put(id, { project: project({ name: 'New' }) }, editKey)).status, 200);
  assert.equal((await j(await m.call(`/projects/${id}`))).project.name, 'New');
  assert.equal(m.db.prepare('SELECT name FROM projects').get().name, 'New');
  assert.equal((await m.put('a'.repeat(22), { project: project() }, editKey)).status, 404);
  assert.equal(m.db.prepare('SELECT email FROM projects').get().email, null, 'no email given, none stored');
  await m.put(id, { project: project(), email: 'a@b.co' }, editKey);
  await m.put(id, { project: project() }, editKey);
  assert.equal(m.db.prepare('SELECT email FROM projects').get().email, 'a@b.co', 'a later save without an email keeps it');
});

test('share: size cap is 2 MB by default, PROJECT_MAX_BYTES overrides it, same cap on update', opts, async () => {
  const big = (n) => project({ notes: 'x'.repeat(n) });
  const m = share();
  const refused = await m.post({ project: big(2_100_000) });
  assert.equal(refused.status, 413);
  const e = await j(refused);
  assert.equal(e.error.code, 'PROJECT_TOO_LARGE');
  assert.equal(e.error.maxBytes, 2e6);
  assert.equal((await m.post({ project: big(1_500_000) })).status, 201);
  const s = share({ PROJECT_MAX_BYTES: '5000' });
  assert.equal((await s.post({ project: big(6000) })).status, 413);
  const { id, editKey } = await j(await s.post({ project: big(100) }));
  assert.equal((await s.put(id, { project: big(6000) }, editKey)).status, 413);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM projects').get().n, 1);
  assert.equal(s.files.size, 1, 'nothing stored for refused saves');
  const huge = await s.call('/projects', { method: 'POST', headers: { 'content-length': '99999999' }, body: '{}' });
  assert.equal(huge.status, 413);
});

test('share: bad input is refused', opts, async () => {
  const m = share();
  assert.equal((await m.post('not json')).status, 400);
  assert.equal((await m.post({})).status, 400);
  assert.equal((await m.post({ project: { schema: 1 } })).status, 400);
  const nope = await m.post({ project: [] });
  assert.equal(nope.status, 400);
  assert.equal((await j(nope)).error.code, 'BAD_PROJECT');
  const mail = await m.post({ project: project(), email: 'nope' });
  assert.equal(mail.status, 400);
  assert.equal((await j(mail)).error.code, 'BAD_EMAIL');
  assert.equal(m.files.size, 0);
});

test('share: rate limit per IP on saves (20 an hour by default), other IPs unaffected', opts, async () => {
  const m = share({ PROJECT_SAVE_RATE_MAX: '3' });
  for (let i = 0; i < 3; i++) assert.equal((await m.post({ project: project() }, '9.9.9.9')).status, 201);
  const r = await m.post({ project: project() }, '9.9.9.9');
  assert.equal(r.status, 429);
  assert.equal((await j(r)).error.code, 'RATE_LIMITED');
  assert.ok(r.headers.get('retry-after'));
  assert.equal((await m.post({ project: project() }, '8.8.8.8')).status, 201);
  const d = share();
  const rs = await Promise.all(Array.from({ length: 25 }, () => d.post({ project: project() }, '7.7.7.7')));
  assert.equal(rs.filter((x) => x.status === 201).length, 20);
  const stored = d.db.prepare('SELECT key FROM rate_limits').all().map((x) => x.key).join();
  assert.ok(!stored.includes('7.7.7.7'), 'raw IP never stored in the rate counters');
});

test('share: expiry follows PROJECT_TTL_DAYS, a save extends it, expired links are 410 and cleaned up', opts, async () => {
  const m = share({ PROJECT_TTL_DAYS: '10' });
  const { id, editKey, expiresAt } = await j(await m.post({ project: project() }));
  const days = (Date.parse(expiresAt) - Date.now()) / 864e5;
  assert.ok(days > 9.99 && days <= 10);
  assert.ok((await j(await share().post({ project: project() }))).expiresAt > new Date(Date.now() + 360 * 864e5).toISOString(), 'default 365 days');
  m.db.prepare('UPDATE projects SET expires_at=?').run(new Date(Date.now() + 1000).toISOString());
  assert.equal((await m.put(id, { project: project() }, editKey)).status, 200);
  assert.ok(Date.parse(m.db.prepare('SELECT expires_at e FROM projects').get().e) - Date.now() > 9 * 864e5, 'save extends the expiry');
  m.db.prepare('UPDATE projects SET expires_at=?').run(new Date(Date.now() - 1000).toISOString());
  const g = await m.call(`/projects/${id}`);
  assert.equal(g.status, 410);
  assert.equal((await j(g)).error.code, 'EXPIRED');
  assert.equal(m.db.prepare('SELECT COUNT(*) n FROM projects').get().n, 0);
  assert.equal(m.files.size, 0, 'row and file removed');
  const { id: id2, editKey: k2 } = await j(await m.post({ project: project() }));
  m.db.prepare('UPDATE projects SET expires_at=?').run(new Date(Date.now() - 1000).toISOString());
  assert.equal((await m.put(id2, { project: project() }, k2)).status, 410, 'an expired design cannot be updated');
});

test('share: CORS preflight, health report, unavailable without storage', opts, async () => {
  const m = share();
  const pre = await m.call('/projects/abc', { method: 'OPTIONS', headers: { origin: 'https://x.test' } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers'), /x-edit-key/);
  assert.match(pre.headers.get('access-control-allow-methods'), /PUT/);
  assert.equal((await j(await m.call('/health'))).sharing, true);
  const bare = share();
  delete bare.env.FILES;
  const r = await bare.post({ project: project() });
  assert.equal(r.status, 503);
  assert.equal((await j(r)).error.code, 'SHARING_UNAVAILABLE');
  assert.equal((await j(await bare.call('/health'))).sharing, false);
});

test('share: the share code sends no email and calls no service', () => {
  const src = rd('../server/lib/projects.js').replace(/\/\/.*$/gm, '');
  assert.ok(!/fetch\(|sendmail|smtp|mailgun|resend|sendgrid/i.test(src));
});

test('share: a share created on the live Worker and read by the release server share the same R2 key and row format', opts, async () => {
  const m = share();
  const { id } = await j(await m.post({ project: project() }));
  assert.deepEqual([...m.files.keys()], [`projects/${id}.json`]);
  const row = m.db.prepare('SELECT * FROM projects').get();
  assert.deepEqual(Object.keys(row).sort(), ['bytes', 'created_at', 'edit_key_hash', 'email', 'expires_at', 'id', 'ip_hash', 'name', 'updated_at']);
});

// ---- 3b. payments: the live payments.test.mjs and hardening.test.mjs rules, ported ---------------------------------------------
const done = (id = 'evt_1', o = {}) => ({
  id, type: 'checkout.session.completed',
  data: { object: { id: 'cs_1', mode: 'payment', payment_status: 'paid', client_reference_id: 'p_job1', metadata: { projectId: 'p_job1', app: 'pocket-architect' }, payment_intent: 'pi_1', amount_total: 3000, currency: 'aud', customer_details: { email: 'Buyer@Example.com' }, ...o } },
});
const refund = (id, o = {}) => ({ id, type: 'charge.refunded', data: { object: { payment_intent: 'pi_1', amount: 3000, amount_refunded: 3000, refunded: true, ...o } } });
const dispute = (id, type, o = {}) => ({ id, type, data: { object: { payment_intent: 'pi_1', ...o } } });

test('payments: which Checkout sessions grant a Plan Pack', opts, async () => {
  const m = mk();
  let n = 0;
  const go = async (o, type = 'checkout.session.completed') => {
    n += 1;
    const ev = done(`evt_g${n}`, { id: `cs_g${n}`, payment_intent: `pi_g${n}`, ...o });
    ev.type = type;
    await m.hook(ev);
    return m.rows().length;
  };
  assert.equal(await go({ payment_status: 'unpaid' }), 0, 'unpaid (delayed method) waits');
  assert.equal(await go({}, 'checkout.session.async_payment_succeeded'), 1, 'async payment succeeded grants');
  assert.equal(await go({ currency: 'usd' }), 1, 'wrong currency');
  assert.equal(await go({ amount_total: 500 }), 1, 'A$5 add-on payment is not a plan');
  assert.equal(await go({ amount_total: 2999 }), 1);
  assert.equal(await go({ client_reference_id: undefined, metadata: {} }), 1, 'other product, no project');
  assert.equal(await go({ client_reference_id: 'bad id!' }), 1, 'invalid project id');
  assert.equal(await go({ client_reference_id: 'p_job9', metadata: { projectId: 'p_other', app: 'pocket-architect' } }), 1, 'project mismatch');
  assert.equal(await go({ metadata: { projectId: 'p_job1', app: 'fly-through' } }), 1, 'other app');
  assert.equal(await go({ mode: 'subscription' }), 1, 'not a one-off payment');
  assert.equal(await go({}, 'checkout.session.expired'), 1);
  assert.equal(await go({ amount_total: 4000, currency: 'AUD' }), 2, 'higher amount, upper case currency');
  const r = m.rows().at(-1);
  assert.deepEqual([r.currency, r.credits_total, r.status, r.pdf_allowed, r.credits_reserved], ['AUD', 500, 'active', 1, 0]);
  assert.match(r.id, /^ent_/);
  assert.equal(r.payment_intent, 'pi_g12', 'the payment intent goes in the live column payment_intent');
  const m2 = mk({ PLAN_PRICE_CENTS: '4900' });
  await m2.hook(done());
  assert.equal(m2.rows().length, 0, 'the configured price (live name PLAN_PRICE_CENTS) is enforced');
  const m3 = mk();
  await m3.hook(done('e', { customer_details: undefined, customer_email: 'Alt@X.com' }));
  assert.equal(m3.rows()[0].email, 'alt@x.com');
});

test('payments: duplicates, concurrent deliveries and a retryable failure', opts, async () => {
  const m = mk();
  assert.equal((await j(await m.hook(done('evt_a')))).duplicate, undefined);
  assert.equal((await j(await m.hook(done('evt_a')))).duplicate, true);
  assert.equal((await m.hook(done('evt_b'))).status, 200);
  assert.equal(m.rows().length, 1, 'same session twice under two event ids');
  const m2 = mk();
  const res = await Promise.all(Array.from({ length: 30 }, (_, i) => m2.hook(done(`evt_c${i % 5}`, { id: `cs_${i % 3}`, payment_intent: `pi_${i % 3}`, client_reference_id: `p_job${i % 3}`, metadata: { projectId: `p_job${i % 3}`, app: 'pocket-architect' } }))));
  assert.ok(res.every((r) => r.status === 200));
  assert.equal(m2.rows().length, 3, 'one entitlement per session');
  const m3 = mk();
  m3.hooks.failOn = 'INSERT OR IGNORE INTO entitlements';
  assert.equal((await m3.hook(done('evt_r'))).status, 500);
  assert.equal(m3.rows().length, 0);
  assert.equal(m3.db.prepare('SELECT COUNT(*) n FROM webhook_events').get().n, 0, 'no marker after a failed write');
  assert.equal((await m3.hook(done('evt_r'))).status, 200);
  assert.equal(m3.rows().length, 1, 'Stripe retry grants access');
});

test('payments: refunds, in either order', opts, async () => {
  const m = mk();
  await m.hook(done());
  await m.hook(refund('evt_p', { refunded: false, amount_refunded: 1000 }));
  assert.equal(m.rows()[0].status, 'active', 'partial refund keeps access');
  await m.hook(refund('evt_f1', { refunded: false, amount_refunded: 3000 }));
  assert.equal(m.rows()[0].status, 'refunded', 'amount_refunded >= amount');
  const m3 = mk();
  await m3.hook(refund('evt_early'));
  await m3.hook(done());
  assert.equal(m3.rows()[0].status, 'refunded', 'a refund that arrives before the payment stays revoked');
  assert.equal((await m3.call('/entitlement?session_id=cs_1&project=p_job1')).status, 403);
  assert.equal((await mk().hook(refund('evt_n', { payment_intent: null }))).status, 200);
});

test('payments: disputes hold access, a won dispute restores it, a lost one does not', opts, async () => {
  const m = mk();
  await m.hook(done());
  const status = () => m.rows()[0].status;
  await m.hook(dispute('e2', 'charge.dispute.created', { status: 'needs_response' }));
  assert.equal(status(), 'disputed');
  assert.equal((await m.call('/entitlement?session_id=cs_1&project=p_job1')).status, 403);
  await m.hook(dispute('e3', 'charge.dispute.closed', { status: 'lost' }));
  assert.equal(status(), 'disputed', 'lost stays revoked');
  await m.hook(dispute('e4', 'charge.dispute.closed', { status: 'won' }));
  assert.equal(status(), 'active', 'won restores access');
  const r = mk();
  await r.hook(done());
  await r.hook(refund('e3', {}));
  await r.hook(dispute('e4', 'charge.dispute.closed', { status: 'won' }));
  assert.equal(r.rows()[0].status, 'refunded', 'a won dispute never revives a refund');
  const early = mk();
  await early.hook(dispute('e1', 'charge.dispute.created'));
  await early.hook(done('e2'));
  assert.equal(early.rows()[0].status, 'disputed', 'dispute arriving before the grant');
  await early.hook(dispute('e3', 'charge.dispute.closed', { status: 'won' }));
  assert.equal(early.rows()[0].status, 'active');
});

test('payments: restore purchase and the friends code', opts, async () => {
  const m = mk();
  await m.hook(done('evt_1', { id: 'cs_restore1', payment_intent: 'pi_restore1' }));
  const id = m.rows()[0].id;
  for (const ref of [id, 'pi_restore1', 'cs_restore1']) {
    const r = await m.restore('  BUYER@example.com ', ref);
    assert.equal(r.status, 200, ref);
    const b = await j(r);
    assert.deepEqual([b.project, b.projectId, b.receipt], ['p_job1', 'p_job1', id]);
  }
  assert.equal((await m.restore('other@example.com', 'pi_restore1')).status, 403, 'wrong email');
  assert.equal((await m.restore('', 'pi_restore1')).status, 400);
  const c = mk({ TEST_CODES: 'PA-FRIENDS-TEST, OTHER-CODE', TEST_CODE_MAX_USES: '2' });
  assert.equal((await c.restore('f@x.com', 'WRONGCODE')).status, 403);
  const a = await c.restore('f1@x.com', 'PA-FRIENDS-TEST');
  assert.equal(a.status, 200);
  const aj = await j(a);
  assert.equal(aj.projectId, '*');
  assert.equal(aj.credits.remaining, 500);
  assert.equal((await c.call('/credits', { headers: { authorization: `Bearer ${aj.token}` } })).status, 200);
  const bound = await j(await c.restore('f1@x.com', 'PA-FRIENDS-TEST', { projectId: 'p_mine1' }));
  assert.equal(bound.projectId, 'p_mine1');
  assert.equal(c.rows().length, 1, 'same friend, no extra use');
  assert.equal(c.rows()[0].pdf_allowed, 20, 'TEST_CODE_PDF_SETS default');
  const rest = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((x) => c.restore(`${x}@x.com`, 'PA-FRIENDS-TEST', {}, `5.5.5.${x.charCodeAt(0)}`)));
  assert.equal(rest.filter((r) => r.status === 200).length, 1, 'cap of 2 people holds');
  const full = rest.find((r) => r.status === 403);
  assert.equal((await j(full)).error.code, 'CODE_EXHAUSTED');
  assert.equal((await c.restore('g@x.com', 'OTHER-CODE')).status, 200, 'second code has its own cap');
  c.db.prepare("UPDATE entitlements SET expires_at=? WHERE email='f1@x.com'").run(new Date(Date.now() - 1000).toISOString());
  const again = await c.restore('f1@x.com', 'PA-FRIENDS-TEST');
  assert.equal(again.status, 200);
  assert.equal((await c.call('/credits', { headers: { authorization: `Bearer ${(await j(again)).token}` } })).status, 200, 'an expired friend is renewed while the code is live');
});

test('payments: the code pack covers any project for exports', opts, async () => {
  const m = mk({ TEST_CODES: 'FRIENDS' });
  const t = (await j(await m.restore('f@x.com', 'FRIENDS', { projectId: 'p_any0001' }))).token;
  const r = await m.call('/export/dxf', { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify({ project: sampleProject('p_any0001') }) });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(r.headers.get('content-type'), 'application/dxf');
});

test('payments: checkout sends the live Stripe parameters and is limited per IP', opts, async () => {
  const m = mk({ CHECKOUT_RATE_MAX: '3' });
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (u, o) => {
    seen.push({ u: String(u), form: Object.fromEntries(new URLSearchParams(String(o.body))) });
    return new Response(JSON.stringify({ id: 'cs_x', url: 'https://checkout.stripe.com/c/pay/cs_x' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const co = (b, ip = '4.4.4.4') => m.call('/checkout', { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: JSON.stringify(b) });
    const r = await co({ projectId: 'p_job1', projectName: 'x'.repeat(200), email: 'a@b.com' });
    assert.equal(r.status, 200);
    assert.equal((await j(r)).url, 'https://checkout.stripe.com/c/pay/cs_x');
    const f = seen[0].form;
    assert.equal(seen[0].u, 'https://api.stripe.com/v1/checkout/sessions');
    assert.deepEqual([f.mode, f['line_items[0][price_data][unit_amount]'], f['line_items[0][price_data][currency]'], f['line_items[0][price_data][tax_behavior]']], ['payment', '3000', 'aud', 'inclusive']);
    assert.deepEqual([f.client_reference_id, f['metadata[projectId]'], f['metadata[app]'], f['invoice_creation[enabled]'], f.customer_creation], ['p_job1', 'p_job1', 'pocket-architect', 'true', 'always']);
    assert.equal(f.success_url, 'https://x.test/plan-studio/app/?checkout=success&session_id={CHECKOUT_SESSION_ID}&project=p_job1');
    assert.equal(f.cancel_url, 'https://x.test/plan-studio/app/?checkout=cancel');
    assert.equal(f.customer_email, 'a@b.com');
    seen.length = 0;
    await co({ projectId: 'p_job1', email: 'not an email' });
    assert.equal(seen[0].form.customer_email, undefined);
    m.env.STRIPE_PRICE_ID = 'price_123';
    seen.length = 0;
    const m2 = mk({ CHECKOUT_RATE_MAX: '3', STRIPE_PRICE_ID: 'price_123' });
    await m2.call('/checkout', { method: 'POST', body: JSON.stringify({ projectId: 'p_job1' }) });
    assert.equal(seen[0].form['line_items[0][price]'], 'price_123');
    assert.equal(seen[0].form['line_items[0][price_data][unit_amount]'], undefined);
    // the third call is the last allowed for this address in the hour (the first two above used two)
    assert.equal((await co({ projectId: 'p_job1' })).status, 200);
    const limited = await co({ projectId: 'p_job1' });
    assert.equal(limited.status, 429);
    assert.equal((await j(limited)).error.code, 'RATE_LIMITED');
    assert.equal((await co({ projectId: 'p_job1' }, '6.6.6.6')).status, 200, 'another address is unaffected');
  } finally {
    globalThis.fetch = real;
  }
});

test('health: the live body (ok, sharing, aiPaused, paymentsConfigured)', opts, async () => {
  const h = await j(await mk().call('/health'));
  assert.deepEqual(h, { ok: true, sharing: true, aiPaused: false, paymentsConfigured: true });
  const bare = await j(await mk({ ANTHROPIC_API_KEY: undefined, STRIPE_SECRET_KEY: undefined }).call('/health'));
  assert.deepEqual(bare, { ok: true, sharing: true, aiPaused: true, paymentsConfigured: false });
});

// ---- 3c. exports: PDF re-exports (the one-set-per-job rule is off by default, PDF_SET_LIMIT=1 restores it) ------------------
test('exports: a paid job can re-export its PDF as often as the hourly limit allows (PDF_SET_LIMIT 0 by default)', opts, async () => {
  const db = new DatabaseSync(':memory:');
  applyRelease(db);
  const files = r2();
  let builds = 0;
  let fail = false;
  const loadExporters = async () => ({
    buildExport: async (type) => {
      if (fail) throw new Error('boom');
      builds += 1;
      return { bytes: new TextEncoder().encode(`%PDF-build-${builds}`), mime: 'application/pdf', filename: 'plans.pdf' };
    },
  });
  const app = createApp({ store: createD1Store(d1Of(db)), env: { ENTITLEMENT_SECRET: SECRET, SITE_URL: 'https://x.test', EXPORT_PDF_WAIT_MS: '0', EXPORT_RATE_PER_HOUR: '4' }, files, loadExporters });
  const store = createD1Store(d1Of(db));
  const { entitlement } = await store.createEntitlement({ id: 'ent_pdf000002', projectId: 'p_pdf0002', email: 'a@b.co', stripeSessionId: 'cs_pdf2', creditsTotal: 500, status: 'active', createdAt: new Date().toISOString(), expiresAt: '2099-01-01T00:00:00.000Z' });
  const A = { authorization: `Bearer ${liveToken(entitlement.id, 'p_pdf0002')}`, 'content-type': 'application/json' };
  const post = (type = 'pdf') => app.fetch(new Request(`https://x.test/api/export/${type}`, { method: 'POST', headers: A, body: JSON.stringify({ project: sampleProject('p_pdf0002') }) }));
  const first = await post();
  assert.equal(first.status, 200);
  assert.equal(await first.text(), '%PDF-build-1');
  const second = await post();
  assert.equal(second.status, 200);
  assert.equal(await second.text(), '%PDF-build-2', 'a re-export is a new build of the current design');
  assert.equal(builds, 2);
  assert.deepEqual({ ...db.prepare('SELECT pdf_used, pdf_file FROM entitlements').get() }, { pdf_used: 0, pdf_file: null }, 'no set is claimed or stored');
  assert.equal(files.files.has('pdf/ent_pdf000002.pdf'), false);
  fail = true;
  assert.equal((await post()).status, 503, 'a failed build is an error and changes nothing');
  fail = false;
  const last = await post();
  assert.equal(last.status, 200);
  // the per Plan Pack hourly limit still applies (4 allowed above; the 5th request is refused)
  const limited = await post();
  assert.equal(limited.status, 429);
  assert.equal((await j(limited)).error.code, 'RATE_LIMITED');
});

test('exports: PDF_SET_LIMIT=1 restores ONE PDF plan set per job, the same file back on a repeat, given back on a failed build', opts, async () => {
  const db = new DatabaseSync(':memory:');
  applyRelease(db);
  const files = r2();
  let builds = 0;
  let fail = false;
  const loadExporters = async () => ({
    buildExport: async (type) => {
      if (fail) throw new Error('boom');
      builds += 1;
      return { bytes: new TextEncoder().encode(`%PDF-build-${builds}`), mime: 'application/pdf', filename: 'plans.pdf' };
    },
  });
  const app = createApp({ store: createD1Store(d1Of(db)), env: { ENTITLEMENT_SECRET: SECRET, SITE_URL: 'https://x.test', EXPORT_PDF_WAIT_MS: '0', EXPORT_RATE_PER_HOUR: '50', PDF_SET_LIMIT: '1' }, files, loadExporters });
  const store = createD1Store(d1Of(db));
  const { entitlement } = await store.createEntitlement({ id: 'ent_pdf000001', projectId: 'p_pdf0001', email: 'a@b.co', stripeSessionId: 'cs_pdf', creditsTotal: 500, status: 'active', createdAt: new Date().toISOString(), expiresAt: '2099-01-01T00:00:00.000Z' });
  const A = { authorization: `Bearer ${liveToken(entitlement.id, 'p_pdf0001')}`, 'content-type': 'application/json' };
  const post = (type = 'pdf') => app.fetch(new Request(`https://x.test/api/export/${type}`, { method: 'POST', headers: A, body: JSON.stringify({ project: sampleProject('p_pdf0001') }) }));
  fail = true;
  assert.equal((await post()).status, 503);
  assert.equal(db.prepare('SELECT pdf_used FROM entitlements').get().pdf_used, 0, 'a failed build gives the set back');
  fail = false;
  const first = await post();
  assert.equal(first.status, 200);
  assert.equal(await first.text(), '%PDF-build-1');
  assert.equal(db.prepare('SELECT pdf_used, pdf_file FROM entitlements').get().pdf_file, 'pdf/ent_pdf000001.pdf');
  assert.ok(files.files.has('pdf/ent_pdf000001.pdf'), 'the set is stored in R2 under pdf/<entitlement>.pdf');
  const second = await post();
  assert.equal(second.status, 200);
  assert.equal(await second.text(), '%PDF-build-1', 'the same file, not a new build');
  assert.equal(builds, 1);
  const dxf = await post('dxf');
  assert.equal(dxf.status, 200, 'other formats are not limited to one');
  // a claimed set whose file is missing (a simultaneous first request still building) is refused, not rebuilt
  db.prepare('UPDATE entitlements SET pdf_file = NULL').run();
  const gone = await post();
  assert.equal(gone.status, 403);
  assert.equal((await j(gone)).error.code, 'PDF_LIMIT_REACHED');
});

test('exports: rate limit per Plan Pack, as on the live Worker', opts, async () => {
  const store = createMemoryStore();
  const loadExporters = async () => ({ buildExport: async () => ({ bytes: new Uint8Array([1, 2]), mime: 'application/dxf', filename: 'a.dxf' }) });
  const app = createApp({ store, env: { ENTITLEMENT_SECRET: SECRET, SITE_URL: 'https://x.test', EXPORT_RATE_PER_HOUR: '3' }, loadExporters });
  const { entitlement } = await store.createEntitlement({ id: 'ent_rate00001', projectId: 'p_rate0001', stripeSessionId: 'cs_r', creditsTotal: 500, status: 'active', createdAt: new Date().toISOString(), expiresAt: '2099-01-01T00:00:00.000Z' });
  const A = { authorization: `Bearer ${liveToken(entitlement.id, 'p_rate0001')}`, 'content-type': 'application/json' };
  const post = () => app.fetch(new Request('https://x.test/api/export/dxf', { method: 'POST', headers: A, body: JSON.stringify({ project: sampleProject('p_rate0001') }) }));
  for (let i = 0; i < 3; i++) assert.equal((await post()).status, 200);
  const r = await post();
  assert.equal(r.status, 429);
  assert.equal((await j(r)).error.code, 'RATE_LIMITED');
});

test('the release Worker has the live bindings and route, and no secret in wrangler.toml', () => {
  const toml = rd('../wrangler.toml').replace(/^\s*#.*$/gm, '');
  assert.match(toml, /^name = "pocket-architect-api"/m);
  assert.match(toml, /pattern = "glideinside\.com\.au\/api\/\*"/);
  assert.match(toml, /binding = "DB"[\s\S]*database_name = "pocket-architect"[\s\S]*database_id = "fccdf1f7-e48c-4c72-8723-b343b3f2fad4"/);
  assert.match(toml, /binding = "FILES"[\s\S]*bucket_name = "pocket-architect-files"/);
  assert.match(toml, /migrations_dir = "server\/migrations"/);
  assert.doesNotMatch(toml, /REPLACE-WITH/);
  assert.doesNotMatch(toml, /sk_(live|test)_|whsec_|re_[A-Za-z0-9]{10}|sk-ant-/);
  // a plain variable with a secret's name would replace the secret on deploy
  const vars = toml.split('[vars]')[1].split(/\n\[/)[0];
  for (const secret of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ID', 'ENTITLEMENT_SECRET', 'ANTHROPIC_API_KEY', 'IP_HASH_SALT', 'TEST_CODES', 'RESEND_API_KEY', 'ADMIN_TOKEN']) {
    assert.doesNotMatch(vars, new RegExp(`^${secret}\\s*=`, 'm'), `${secret} must not be a [vars] entry`);
  }
  assert.match(toml, /PDF_SET_LIMIT = "0"/, 'PDF re-exports are allowed (owner decision 11/11/2026)');
  assert.match(rd('../server/wrangler.toml.example').replace(/^\s*#.*$/gm, ''), /PDF_SET_LIMIT = "0"/);
  assert.match(toml, /PORTAL_ENABLED = "1"/);
  assert.doesNotMatch(toml, /^crons\s*=/m, 'the billing cron is off while the portal is off');
  for (const name of ['SITE_URL', 'APP_URL', 'ENQUIRY_TO', 'ENQUIRY_FROM', 'SELLER_NAME', 'SELLER_ABN', 'PLAN_PACK_PRICE_CENTS', 'PLAN_PACK_CREDITS', 'ENTITLEMENT_DAYS']) assert.match(toml, new RegExp(`^${name} = `, 'm'), name);
});

// ---- 4. Save and share, client side: the real browser client against the real Worker -----------------------------------------
import { createCloud, saveShared, readShare, writeShare, shareKey, CloudError, shareIdFromSearch } from '../src/ui/cloud.js';

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), map: m };
};

test('share client against the Worker: create, update with the stored edit key, load, and a live link and key keep working', opts, async () => {
  const db = liveDb();
  seedLive(db);
  const m = mk({}, { db });
  const cloud = createCloud({ base: '/api', fetchImpl: (url, init) => worker.fetch(new Request(`https://x.test${url}`, init), m.env) });
  const storage = memStorage();
  const project = sampleProject('p_client01');
  project.site.underlay = { key: 'big-image' };

  // create: the link is <page>?share=<id>, the key is kept under ps.share.<project id> and never shown in the link
  const first = await saveShared(cloud, project, { storage, email: 'a@b.co' });
  assert.equal(first.created, true);
  assert.match(first.url, /^https:\/\/x\.test\/plan-studio\/app\/\?share=[A-Za-z0-9_-]{16,40}$/);
  assert.equal(shareIdFromSearch(new URL(first.url).search), first.id);
  const kept = JSON.parse(storage.map.get('ps.share.p_client01'));
  assert.deepEqual(Object.keys(kept).sort(), ['editKey', 'expiresAt', 'id', 'savedAt', 'url']);
  assert.ok(!first.url.includes(kept.editKey));
  assert.equal(db.prepare('SELECT email FROM projects WHERE id = ?').get(first.id).email, 'a@b.co');

  // view link: loads read only data, without the tracing underlay
  const loaded = await cloud.load(first.id);
  assert.equal(loaded.project.name, 'Smith residence');
  assert.equal(loaded.project.site.underlay, null);

  // update: same link, edit key sent in x-edit-key
  project.name = 'Smith residence v2';
  const second = await saveShared(cloud, project, { storage });
  assert.equal(second.created, false);
  assert.equal(second.id, first.id);
  assert.equal(second.url, first.url);
  assert.equal((await cloud.load(first.id)).project.name, 'Smith residence v2');

  // another browser (no key) cannot update it, and a wrong key is refused with BAD_EDIT_KEY
  await assert.rejects(() => cloud.update(first.id, 'not-the-key', project), (e) => e instanceof CloudError && e.code === 'BAD_EDIT_KEY' && e.status === 403);
  // a refused key makes a new link instead of failing
  writeShare('p_client01', { ...kept, editKey: 'stale-key' }, storage);
  const third = await saveShared(cloud, project, { storage });
  assert.equal(third.created, true);
  assert.notEqual(third.id, first.id);
  assert.equal(readShare('p_client01', storage).id, third.id);

  // a link and edit key handed out by the live app (15/10/2026) still work: key stored in the live format, live row in D1
  writeShare('p_x1', { id: LIVE_SHARE, editKey: 'live-edit-key', url: `https://x.test/plan-studio/app/?share=${LIVE_SHARE}`, savedAt: '2026-10-16T03:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z' }, storage);
  m.files.set(`projects/${LIVE_SHARE}.json`, { v: JSON.stringify({ schema: 1, id: 'p_x1', name: 'Live house', levels: [{ id: 'l1' }] }) });
  assert.equal((await cloud.load(LIVE_SHARE)).project.name, 'Live house');
  const liveProject = sampleProject('p_x1');
  liveProject.name = 'Live house, edited';
  const upd = await saveShared(cloud, liveProject, { storage });
  assert.deepEqual([upd.created, upd.id], [false, LIVE_SHARE]);
  assert.equal(db.prepare('SELECT name FROM projects WHERE id = ?').get(LIVE_SHARE).name, 'Live house, edited');
  assert.equal(shareKey('p_x1'), 'ps.share.p_x1');
});

test('share client errors: not found, expired, rate limited, too large and offline give clear messages', async () => {
  const { saveErrorMessage, loadErrorMessage } = await import('../src/ui/cloud.js');
  const reply = (status, body, headers = {}) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const err = async (fetchImpl, f) => f(createCloud({ fetchImpl })).catch((e) => e);
  const notFound = await err(reply(404, { error: { code: 'NOT_FOUND', message: 'That shared design was not found.' } }), (c) => c.load('nope'));
  assert.equal(notFound.code, 'NOT_FOUND');
  assert.match(loadErrorMessage(notFound), /not found.*copied in full/);
  const gone = await err(reply(410, { error: { code: 'EXPIRED', message: 'x' } }), (c) => c.load('old'));
  assert.equal(loadErrorMessage(gone), 'That shared link has expired.');
  const limited = await err(reply(429, { error: { code: 'RATE_LIMITED', message: 'x', retryAfter: 600 } }, { 'retry-after': '600' }), (c) => c.create({ schema: 1, levels: [1] }));
  assert.equal(limited.retryAfter, 600);
  assert.match(saveErrorMessage(limited), /lot of saves.*about 10 minutes/);
  const big = await err(reply(413, { error: { code: 'PROJECT_TOO_LARGE', message: 'x', maxBytes: 2e6 } }), (c) => c.create({ schema: 1, levels: [1] }));
  assert.match(saveErrorMessage(big), /too large.*2 MB.*Use Save/);
  const offline = await err(async () => { throw new TypeError('Failed to fetch'); }, (c) => c.load('x'));
  assert.equal(offline.code, 'NETWORK');
  assert.match(saveErrorMessage(offline), /offline|cannot be reached/);
  const html502 = await err(async () => new Response('<html>bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }), (c) => c.load('x'));
  assert.equal(html502.code, 'SERVER_UNAVAILABLE');
  assert.match(saveErrorMessage(html502), /not available right now/);
  // blocked storage never breaks a save: the link still comes back
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  const ok = createCloud({ fetchImpl: async () => new Response(JSON.stringify({ id: 'abcdefghijklmnop', editKey: 'k', url: 'https://x.test/?share=abcdefghijklmnop', expiresAt: '2099-01-01T00:00:00.000Z' }), { status: 201, headers: { 'content-type': 'application/json' } }) });
  const out = await saveShared(ok, { id: 'p_blocked1', schema: 1, levels: [{}], site: {} }, { storage: blocked });
  assert.equal(out.created, true);
  assert.equal(out.keyKept, false);
  assert.equal(readShare('p_blocked1', blocked), null);
});
