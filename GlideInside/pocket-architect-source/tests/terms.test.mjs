// Plan set terms: the acceptance gate (modal, memory per version), the server record and 409, the migration, the public page and the sheet note.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createApp } from '../server/lib/app.js';
import { createMemoryStore, createD1Store } from '../server/lib/store.js';
import { issueToken } from '../server/lib/entitlement.js';
import { createTermsGate, createAcceptanceMemory } from '../src/legal/terms-gate.js';
import { PLAN_TERMS, version, checkboxLabel, sheetNote, bodyHtml } from '../src/legal/plan-terms.js';
import { termsStamp, termsLines } from '../src/legal/sheet-note.js';
import { syncPage } from '../tools/sync-plan-terms.mjs';
import { catalogue } from '../src/catalogue/index.js';
import { migrate } from '../src/model/schema.js';
import { toDXF } from '../src/premium/exporters/dxf.js';
import { buildExport } from '../src/premium/exporters/index.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* skipped without node:sqlite */ }

const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

// ---- data file ---------------------------------------------------------------------------------------------------------------
test('plan-terms.js: exports the fields, no dashes, never "compliant"', () => {
  for (const k of ['version', 'effectiveDate', 'title', 'bodyHtml', 'checkboxLabel', 'sheetNote']) assert.ok(PLAN_TERMS[k], k);
  const all = JSON.stringify(PLAN_TERMS);
  assert.ok(!/[–—]/.test(all));
  assert.ok(!/compliant/i.test(all));
  assert.equal(version, '1.0');
});

// ---- gate logic (Node) ---------------------------------------------------------------------------------------------------------
test('gate: asks once per version, remembers, and a new version asks again', async () => {
  const memory = createAcceptanceMemory({ storage: memStorage() });
  let asked = 0;
  const openDialog = async ({ onConfirm }) => { asked += 1; await onConfirm(); return true; };
  const mk = (v) => createTermsGate({ terms: { ...PLAN_TERMS, version: v }, memory, openDialog });
  const g1 = mk('1.0');
  assert.equal(g1.isAccepted(), false);
  const a = await g1.require({ context: 'x' });
  assert.equal(a.version, '1.0');
  assert.equal(asked, 1);
  await g1.require();
  assert.equal(asked, 1, 'remembered');
  const g2 = mk('1.1');
  assert.equal(g2.isAccepted(), false, 'new version is not accepted');
  await g2.require();
  assert.equal(asked, 2, 'new version re-prompts');
});

test('gate: cancel blocks generation; signed in acceptance is recorded first and a failed record keeps it blocked', async () => {
  const memory = createAcceptanceMemory({ storage: memStorage() });
  const gate = createTermsGate({ memory, getIdentity: () => ({ subject: 'portal:u1', record: true }), openDialog: async () => false });
  assert.equal(await gate.require(), null);
  const recorded = [];
  let fail = true;
  const g = createTermsGate({
    memory, getIdentity: () => ({ subject: 'portal:u1', record: true }),
    record: async (v, c) => { if (fail) throw new Error('net'); recorded.push([v, c]); },
    openDialog: async ({ onConfirm }) => { try { await onConfirm(); return true; } catch { return false; } },
  });
  assert.equal(await g.require({ context: 'c1' }), null);
  assert.equal(g.isAccepted(), false);
  fail = false;
  assert.ok(await g.require({ context: 'c1' }));
  assert.deepEqual(recorded, [[version, 'c1']]);
  const other = createTermsGate({ memory, getIdentity: () => ({ subject: 'portal:u2' }), openDialog: async () => false });
  assert.equal(other.isAccepted(), false, 'per user');
});

// ---- modal in Chromium ---------------------------------------------------------------------------------------------------------
const PYTHON = process.env.PYTHON || 'python3';
const hasBrowser = spawnSync(PYTHON, ['-c', 'import playwright'], { encoding: 'utf8' }).status === 0;
const skipUi = hasBrowser ? false : 'Playwright for Python is not installed';
function browser(body, extra = []) {
  const script = `async () => { const sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); const $=(s)=>document.querySelector(s); const out={}; ${body} return JSON.stringify(out); }`;
  const r = spawnSync(PYTHON, [path.join(ROOT, 'tools/smoke.py'), 'tests/pages/terms.html', '--wait', '300', '--eval', script, ...extra], { cwd: ROOT, encoding: 'utf8', timeout: 90000 });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout.split('\n').find((l) => l.startsWith('eval: ')).slice(6));
}
test('modal: Generate is blocked until the box is ticked, Cancel resolves false, acceptance is remembered, a new version re-prompts', { skip: skipUi }, () => {
  const r = browser(String.raw`
    const T = window.__t;
    let res = null; T.gate.require({ context: 'a' }).then((v) => { res = v; });
    await sleep(100);
    out.open = !!$('[data-ps=terms-dialog]');
    out.role = $('[data-ps=terms-dialog]').getAttribute('role') + '/' + $('[data-ps=terms-dialog]').getAttribute('aria-modal');
    out.label = $('.gi-terms-check span').textContent;
    out.unticked = !$('[data-ps=terms-check]').checked;
    out.disabled = $('[data-ps=terms-generate]').disabled;
    $('[data-ps=terms-generate]').click(); await sleep(50);
    out.stillOpen = !!$('[data-ps=terms-dialog]');
    out.pendingAfterClick = res === null;
    $('[data-ps=terms-cancel]').click(); await sleep(50);
    out.cancelled = res === null && !$('[data-ps=terms-dialog]') && !T.gate.isAccepted();
    let res2 = undefined; T.gate.require({}).then((v) => { res2 = v; }); await sleep(100);
    $('[data-ps=terms-check]').click(); await sleep(20);
    out.enabled = !$('[data-ps=terms-generate]').disabled;
    $('[data-ps=terms-generate]').click(); await sleep(100);
    out.accepted = !!res2 && res2.version === T.PLAN_TERMS.version && T.gate.isAccepted();
    let asked = false; T.gate.require({}).then(() => {}); await sleep(80);
    out.noReprompt = !$('[data-ps=terms-dialog]');
    const g2 = T.createTermsGate({ terms: { ...T.PLAN_TERMS, version: '9.9' }, memory: T.mem, openDialog: T.openTermsModal, getIdentity: () => ({ subject: 'anon' }) });
    g2.require({}); await sleep(100);
    out.reprompt = !!$('[data-ps=terms-dialog]');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(50);
    out.escapes = !$('[data-ps=terms-dialog]');
  `);
  assert.match(r.role, /dialog\/true/);
  assert.equal(r.label, checkboxLabel);
  assert.deepEqual([r.open, r.unticked, r.disabled, r.stillOpen, r.pendingAfterClick, r.cancelled, r.enabled, r.accepted, r.noReprompt, r.reprompt, r.escapes], Array(11).fill(true));
});

// ---- server ----------------------------------------------------------------------------------------------------------------------
const SECRET = 'terms-secret';
const SITE = 'https://site.test';
function world({ d1 = false, env = {} } = {}) {
  let db = null;
  let store;
  if (d1) {
    db = new DatabaseSync(':memory:');
    db.exec(rd('server/schema.sql'));
    const st = (sql, args = []) => ({ bind: (...a) => st(sql, a.map((v) => (v === undefined ? null : v))), run: async () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...args).changes) } }), first: async () => db.prepare(sql).get(...args) ?? null, all: async () => ({ results: db.prepare(sql).all(...args) }) });
    store = createD1Store({ prepare: (sql) => st(sql) });
  } else store = createMemoryStore();
  const app = createApp({ store, env: { SITE_URL: SITE, ENTITLEMENT_SECRET: SECRET, IP_HASH_SALT: 'salt', ADMIN_TOKEN: 'admin-token-123456', ...env }, now: () => Date.UTC(2026, 10, 15, 3, 0, 0), catalogue, loadJsPDF: async () => (await import('jspdf')).jsPDF });
  const call = (p, { method = 'POST', token, body, headers = {} } = {}) => app.fetch(new Request(`https://api.test/api${p}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { app, store, db, call };
}
const proj = (id) => { const p = migrate(catalogue.createFromTemplate('house_single')); p.id = id; return p; };
async function pack(w, id = 'ent_t1', pid = 'p_t1') {
  await w.store.createEntitlement({ id, projectId: pid, email: 'a@b.co', stripeSessionId: `cs_${id}`, creditsTotal: 500, status: 'active', createdAt: new Date().toISOString(), expiresAt: '2099-01-01T00:00:00.000Z' });
  return issueToken({ id, projectId: pid }, { entitlementSecret: SECRET, entitlementDays: 365 }, Date.now());
}

for (const d1 of [false, true]) {
  test(`server (${d1 ? 'D1' : 'memory'}): exports refuse with 409 TERMS_REQUIRED until accepted, acceptance is recorded with a hashed IP, then the DXF carries the note`, { skip: d1 && !DatabaseSync }, async () => {
    const w = world({ d1 });
    const token = await pack(w);
    const body = { project: proj('p_t1') };
    for (const type of ['pdf', 'dxf']) {
      const r = await w.call(`/export/${type}`, { token, body });
      assert.equal(r.status, 409, type);
      assert.equal((await r.json()).error.code, 'TERMS_REQUIRED');
    }
    const bad = await w.call('/terms/accept', { token, body: { version: '0.1', context: 'x' } });
    assert.equal(bad.status, 409, 'an out of date version is refused');
    const ok = await w.call('/terms/accept', { token, body: { version, context: 'export-pdf' }, headers: { 'cf-connecting-ip': '203.0.113.9', 'user-agent': 'UnitTest/1' } });
    assert.equal(ok.status, 200);
    const okb = await ok.json();
    assert.equal(okb.recorded, true);
    assert.equal(okb.acceptedAt, '2026-11-15T03:00:00.000Z');
    const rec = await w.store.getTermsAcceptance('pack:ent_t1', version);
    assert.equal(rec.userAgent, 'UnitTest/1');
    assert.equal(rec.context, 'export-pdf');
    assert.match(rec.ipHash, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(rec).includes('203.0.113.9'), 'the raw address is never stored');
    const dxf = await w.call('/export/dxf', { token, body });
    assert.equal(dxf.status, 200);
    const text = await dxf.text();
    assert.ok(text.includes(`Terms of use v${version} accepted 15/11/2026`));
    assert.ok(text.includes('CONCEPT ONLY. NOT FOR CONSTRUCTION OR APPROVAL'));
    const pdf = await w.call('/export/pdf', { token, body });
    assert.equal(pdf.status, 200);
    // a different pack has not accepted
    const t2 = await pack(w, 'ent_t2', 'p_t2');
    assert.equal((await w.call('/export/dxf', { token: t2, body: { project: proj('p_t2') } })).status, 409);
    // GLB is not a plan: not gated
    assert.equal((await w.call('/export/glb', { token: t2, body: { project: proj('p_t2') } })).status, 200);
    // anonymous accept: not recorded
    const anon = await w.call('/terms/accept', { body: { version } });
    assert.deepEqual(await anon.json(), { recorded: false, reason: 'anonymous', version });
    // admin counts per version
    assert.equal((await w.call('/terms/admin/counts', { method: 'GET' })).status, 401);
    const counts = await (await w.call('/terms/admin/counts', { method: 'GET', token: 'admin-token-123456' })).json();
    assert.equal(counts.currentVersion, version);
    assert.deepEqual(counts.versions.map((v) => [v.version, v.count]), [[version, 1]]);
  });
}

test('server: TERMS_REQUIRED=0 switches the gate off', async () => {
  const w = world({ env: { TERMS_REQUIRED: '0' } });
  const token = await pack(w);
  assert.equal((await w.call('/export/dxf', { token, body: { project: proj('p_t1') } })).status, 200);
});

// ---- migration -------------------------------------------------------------------------------------------------------------------
test('migration 0015 is additive, repeatable and matches schema.sql', { skip: !DatabaseSync }, () => {
  const mig = rd('server/migrations/0015_terms_acceptance.sql');
  assert.ok(!/DROP|ALTER|DELETE/i.test(mig));
  const db = new DatabaseSync(':memory:');
  db.exec(mig); db.exec(mig);
  const cols = (d) => d.prepare("PRAGMA table_info('terms_acceptance')").all().map((c) => c.name).join();
  const flat = new DatabaseSync(':memory:'); flat.exec(rd('server/schema.sql'));
  assert.equal(cols(db), cols(flat));
  assert.equal(cols(db), 'id,subject_id,subject_kind,version,context,accepted_at,ip_hash,user_agent');
  db.prepare("INSERT INTO terms_acceptance (id, subject_id, subject_kind, version, accepted_at) VALUES ('a','s','pack','1','t')").run();
  assert.throws(() => db.prepare("INSERT INTO terms_acceptance (id, subject_id, subject_kind, version, accepted_at) VALUES ('b','s','pack','1','t')").run(), /UNIQUE/);
});

// ---- sheets ----------------------------------------------------------------------------------------------------------------------
test('sheet note: in the DXF and in the text of every PDF flavour (engineering, planset, commercial cover)', async () => {
  const terms = { version, acceptedAt: '2026-11-15T03:00:00.000Z' };
  assert.equal(termsStamp(terms), `Terms of use v${version} accepted 15/11/2026`);
  assert.deepEqual(termsLines(terms), [sheetNote, termsStamp(terms)]);
  const p = proj('p_s');
  const dxf = toDXF(p, { terms });
  assert.ok(dxf.includes(`Terms of use v${version} accepted 15/11/2026`));
  const { jsPDF } = await import('jspdf');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const textOf = async (bytes) => {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
    const out = [];
    for (let i = 1; i <= doc.numPages; i++) out.push((await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(' '));
    return out;
  };
  const eng = await buildExport('pdf', p, { jsPDF, terms, config: {}, catalogue });
  const pages = await textOf(eng.bytes);
  assert.ok(pages.length > 1);
  for (const t of pages) { assert.match(t, /CONCEPT ONLY\. NOT FOR CONSTRUCTION OR APPROVAL/); assert.match(t, /Terms of use v1\.0 accepted 15\/11\/2026/); }
  const legacy = await buildExport('pdf', p, { jsPDF, terms, style: 'legacy', config: {}, catalogue });
  for (const t of await textOf(legacy.bytes)) assert.match(t, /Terms of use v1\.0 accepted 15\/11\/2026/);
  const { exportPlanSet } = await import('../src/premium/exporters/planset/index.js');
  const { FIXTURES } = await import('../src/site/fixtures/index.js');
  const { buildSiteLot } = await import('../src/site/model.js');
  const f = FIXTURES[0];
  const lot = buildSiteLot({ lot: f.lot, aerialMeta: f.aerial, aerialKey: 'k1', contours: f.contours, address: f.search[0].label, source: 'sample' });
  const set = await exportPlanSet({ project: proj('p_s2'), lot, kind: 'site', download: false, jsPDF, terms, fetchSite: null, catalogue });
  const sp = await textOf(await set.blob.arrayBuffer());
  assert.match(sp[0], /CONCEPT ONLY\. NOT FOR CONSTRUCTION OR APPROVAL/, 'the note is on the cover sheet');
  for (const t of sp) assert.match(t, /Terms of use v1\.0 accepted 15\/11\/2026/, 'the stamp is in every title block');
});

// ---- public page -----------------------------------------------------------------------------------------------------------------
test('plan-terms.html carries the same text, the nav tabs, and is linked from terms.html and the footers', () => {
  const page = rd('../website-live/plan-terms.html');
  assert.ok(page.includes(bodyHtml));
  assert.ok(page.includes(`>${version}<`));
  assert.equal(syncPage(page), page, 'in step with src/legal/plan-terms.js (node tools/sync-plan-terms.mjs)');
  assert.match(page, /<a href="index\.html">Residential<\/a>/);
  assert.match(page, /<a href="commercial\/">Commercial<\/a>/);
  assert.match(page, /framework\.css/);
  assert.match(rd('../website-live/terms.html'), /href="plan-terms\.html"/);
  assert.match(rd('../website-live/index.html'), /plan-terms\.html">Plan set terms/);
});

test('wording: no dashes and never "compliant" in the legal and gate files', () => {
  for (const f of ['src/legal/plan-terms.js', 'src/legal/terms-modal.js', 'src/legal/checkout-tick.js', 'server/lib/terms.js']) {
    const s = rd(f).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.ok(!/[–—]/.test(s), f);
    assert.ok(!/compliant/i.test(s), f);
  }
});
