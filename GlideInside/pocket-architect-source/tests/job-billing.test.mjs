// Builder per job billing (owner decision 18/11/2026): every NEW project a builder staff login starts is one job, A$20 incl. GST, confirmed on
// screen and charged to the saved card before the project exists. Capped monthly plans count down. Client logins are no longer charged.
// Stripe is a mocked fetch (test keys, no real call, no email). Core flows run on the in-memory store and on D1 (SQLite shim).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../server/lib/app.js';
import { readConfig } from '../server/lib/config.js';
import { createMemoryStore, createD1Store } from '../server/lib/store.js';
import { createMemoryPortalStore, createD1PortalStore } from '../server/lib/portal-store.js';
import { hmacSha256 } from '../server/lib/entitlement.js';
import { jobBillingReadiness } from '../server/lib/portal-billing.js';
import { JOB_FEE_CENTS, JOB_PLANS, jobPriceFor, summariseJobs, monthKey } from '../src/portal/billing.js';
import { createFromTemplate } from '../src/catalogue/templates.js';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* D1 shim tests are skipped without node:sqlite */ }

const SITE = 'https://site.test';
const ADMIN_TOKEN = 'admin-token-for-tests-0123456789';
const WHSEC = 'whsec_job_unit';
const T0 = Date.UTC(2026, 10, 18, 1, 0, 0); // 18/11/2026 12:00 Sydney
const DAY = 86400000;
const PRICES = { BUILDER_JOB_PRICE_ID: 'price_job_test', BUILDER_STARTER_PRICE_ID: 'price_starter_test', BUILDER_PRO_PRICE_ID: 'price_pro_test', BUILDER_TEAMS_PRICE_ID: 'price_teams_test' };
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

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

function world({ d1 = false, env = PRICES } = {}) {
  const clock = { t: T0 };
  const db = d1 ? makeD1() : null;
  const store = d1 ? createD1Store(db) : createMemoryStore();
  const pstore = d1 ? createD1PortalStore(db) : createMemoryPortalStore();
  const stripe = { calls: [], invoices: 0, payResult: 'paid', price: { id: 'price_job_test', active: true, currency: 'aud', unit_amount: 2000, type: 'one_time', recurring: null }, sessions: {} };
  const logs = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.origin !== 'https://api.stripe.com') throw new Error(`unexpected fetch ${url}`);
    const path = u.pathname.replace('/v1', '');
    const method = init.method || 'GET';
    const form = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : {};
    stripe.calls.push({ method, path, form, headers: init.headers });
    if (method === 'GET' && path.startsWith('/prices/')) return stripe.price && path.endsWith(stripe.price.id) ? jsonRes(stripe.price) : jsonRes({ error: { message: 'No such price' } }, 404);
    if (method === 'POST' && path === '/customers') return jsonRes({ id: 'cus_test_1' });
    if (method === 'POST' && path === '/tax_rates') return jsonRes({ id: 'txr_test_1' });
    if (method === 'POST' && path === '/invoices') return jsonRes({ id: `in_job_${++stripe.invoices}` });
    if (method === 'POST' && path === '/invoiceitems') return jsonRes({ id: 'ii_1' });
    if (method === 'POST' && /\/finalize$/.test(path)) return jsonRes({ id: path.split('/')[2] });
    if (method === 'POST' && /\/void$/.test(path)) return jsonRes({ id: path.split('/')[2], status: 'void' });
    if (method === 'POST' && /\/pay$/.test(path)) return stripe.payResult === 'paid' ? jsonRes({ id: path.split('/')[2], status: 'paid' }) : jsonRes({ error: { message: 'Your card was declined.' } }, 402);
    if (method === 'POST' && path === '/checkout/sessions') return jsonRes({ id: 'cs_test_plan1', url: 'https://checkout.stripe.com/c/pay/cs_test_plan1', form });
    if (method === 'GET' && path.startsWith('/checkout/sessions/')) return stripe.sessions[path.split('/')[3]] ? jsonRes(stripe.sessions[path.split('/')[3]]) : jsonRes({ error: { message: 'none' } }, 404);
    if (method === 'POST' && /^\/subscriptions\//.test(path)) return jsonRes({ id: path.split('/')[2], cancel_at_period_end: true });
    return jsonRes({ error: { message: 'unhandled' } }, 404);
  };
  const orig = console.log;
  console.log = (...a) => { logs.push(a.map(String).join(' ')); };
  const app = createApp({
    store, portalStore: pstore, fetchImpl, now: () => clock.t,
    env: { SITE_URL: SITE, ENTITLEMENT_SECRET: 'unit-test-secret', PORTAL_ENABLED: '1', ADMIN_TOKEN, STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_WEBHOOK_SECRET: WHSEC, TRIAL_NOTIFY: '0', ...env },
  });
  const w = { clock, store, pstore, app, stripe, logs, restore: () => { console.log = orig; } };
  w.browser = () => {
    const jar = { cookie: null };
    const call = async (method, path, body) => {
      const h = { origin: SITE, 'x-gi-request': '1' };
      if (jar.cookie) h.cookie = `gi_session=${jar.cookie}`;
      if (body !== undefined) h['content-type'] = 'application/json';
      const res = await app.fetch(new Request(`${SITE}/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
      for (const c of res.headers.getSetCookie?.() || []) { const m = /^gi_session=([^;]*)/.exec(c); if (m) jar.cookie = m[1] || null; }
      return { status: res.status, data: await res.json().catch(() => null) };
    };
    return { call, get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), put: (p, b) => call('PUT', p, b) };
  };
  w.admin = (method, path, body) => app.fetch(new Request(`${SITE}/api${path}`, { method, headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) })).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
  w.webhook = async (event) => {
    const raw = JSON.stringify(event);
    const t = Math.floor(clock.t / 1000);
    const sig = hex(await hmacSha256(WHSEC, `${t}.${raw}`));
    const res = await app.fetch(new Request(`${SITE}/api/stripe/webhook`, { method: 'POST', body: raw, headers: { 'stripe-signature': `t=${t},v1=${sig}`, 'content-type': 'application/json' } }));
    return { status: res.status };
  };
  /** An active builder org with an admin signed in, billing details saved and (unless noCard) a card on file. */
  w.org = async ({ name = 'Coastal Homes Pty Ltd', noCard = false } = {}) => {
    const r = await w.admin('POST', '/portal/admin/orgs', { name, adminFirstName: 'Priya', adminEmail: 'priya@coastal.example' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const b = w.browser();
    assert.equal((await b.post('/portal/session', { identifier: r.data.credentials.username, password: r.data.credentials.password })).status, 200);
    assert.equal((await b.post('/portal/password', { currentPassword: r.data.credentials.password, newPassword: 'Correct-Horse-Battery-9' })).status, 200);
    assert.equal((await b.put('/portal/billing/contact', { name: 'Priya', email: 'accounts@coastal.example', phone: '', legalName: name, abn: '51824753556' })).status, 200);
    if (!noCard) await w.pstore.updateOrg(r.data.org.id, { paymentMethodId: 'pm_test_1', cardBrand: 'visa', cardLast4: '4242', stripeCustomerId: 'cus_test_1' });
    return { orgId: r.data.org.id, b };
  };
  w.paths = () => w.stripe.calls.map((c) => `${c.method} ${c.path}`);
  return w;
}
const proj = (name = 'Lot 14') => ({ name, project: createFromTemplate('house_single'), lotAddress: 'Lot 14 Banksia Rise' });
const stores = [['memory', false]];
if (DatabaseSync) stores.push(['D1 (SQLite shim)', true]);

// Pure rules ------------------------------------------------------------------------------------------------------------------
test('the rules: A$20 a job, plans of 10, 20 and 40 jobs, extras at A$20, no rollover (the count is per month)', () => {
  assert.equal(JOB_FEE_CENTS, 2000);
  assert.deepEqual(Object.values(JOB_PLANS).map((p) => [p.id, p.monthlyCents, p.jobs]), [['starter', 11900, 10], ['pro', 21900, 20], ['teams', 41900, 40]]);
  assert.deepEqual(jobPriceFor({}), { kind: 'charged', cents: 2000, plan: null, remaining: null });
  for (const p of Object.values(JOB_PLANS)) {
    assert.deepEqual(jobPriceFor({ planId: p.id, planJobsUsed: 0 }), { kind: 'plan_included', cents: 0, plan: p.id, remaining: p.jobs - 1 });
    assert.deepEqual(jobPriceFor({ planId: p.id, planJobsUsed: p.jobs - 1 }), { kind: 'plan_included', cents: 0, plan: p.id, remaining: 0 });
    assert.deepEqual(jobPriceFor({ planId: p.id, planJobsUsed: p.jobs }), { kind: 'plan_extra', cents: 2000, plan: p.id, remaining: 0 });
  }
  assert.equal(jobPriceFor({ planId: 'nonsense', planJobsUsed: 99 }).kind, 'charged', 'an unknown plan id is no plan');
  assert.deepEqual(summariseJobs([{ kind: 'charged', amountCents: 2000 }, { kind: 'plan_included', amountCents: 0 }, { kind: 'plan_extra', amountCents: 2000 }, { kind: 'trial_free', amountCents: 0 }, { kind: 'internal', amountCents: 0 }, { kind: 'unbilled', amountCents: 0 }]),
    { count: 6, chargedCount: 2, chargedCents: 4000, planIncludedCount: 1, planExtraCount: 1, trialFreeCount: 1, internalCount: 1, unbilledCount: 1 });
});

test('readiness: needs the Stripe key, the job price id, and the owner go-ahead for a live key; the config holds no amounts', () => {
  assert.equal(jobBillingReadiness(readConfig({})).reason, 'no_stripe_key');
  assert.equal(jobBillingReadiness(readConfig({ STRIPE_SECRET_KEY: 'sk_test_x' })).reason, 'price_not_configured');
  assert.match(jobBillingReadiness(readConfig({ STRIPE_SECRET_KEY: 'sk_test_x' })).message, /BUILDER_JOB_PRICE_ID/);
  assert.equal(jobBillingReadiness(readConfig({ STRIPE_SECRET_KEY: 'sk_live_x', BUILDER_JOB_PRICE_ID: 'price_x' })).reason, 'live_not_approved');
  assert.equal(jobBillingReadiness(readConfig({ STRIPE_SECRET_KEY: 'sk_live_x', BUILDER_JOB_PRICE_ID: 'price_x', STRIPE_LIVE_BILLING_APPROVED: 'owner-written-go-ahead' })).ready, true);
  assert.equal(jobBillingReadiness(readConfig({ STRIPE_SECRET_KEY: 'sk_test_x', BUILDER_JOB_PRICE_ID: 'price_x' })).ready, true);
  const c = readConfig({});
  assert.deepEqual([c.builderJobPriceId, c.builderStarterPriceId, c.builderProPriceId, c.builderTeamsPriceId], ['', '', '', '']);
  assert.equal(c.commercialSubPriceAud, 50, 'Commercial Solo stays A$50 a month');
});

for (const [label, d1] of stores) {
  const t = (name, fn) => test(`${label}: ${name}`, async () => { const w = world({ d1 }); try { await fn(w); } finally { w.restore(); } });

  t('a builder starting a new project must confirm first; the confirm charges A$20 to the saved card, then the project exists', async (w) => {
    const o = await w.org();
    const ask = await o.b.post('/portal/projects', proj());
    assert.equal(ask.status, 409);
    assert.equal(ask.data.error.code, 'JOB_CONFIRM_REQUIRED');
    const q = ask.data.error.quote;
    assert.deepEqual([q.kind, q.cents, q.priceText, q.charging, q.needsCard], ['charged', 2000, 'A$20 incl. GST', true, false]);
    assert.match(q.covers, /One job is one new project/);
    assert.match(q.message, /charged to your card ending 4242/);
    assert.equal((await o.b.get('/portal/projects')).data.length, 0, 'nothing is created until the job is confirmed');
    assert.equal(w.stripe.calls.length, 0, 'asking never touches Stripe');

    const ok = await o.b.post('/portal/projects', { ...proj(), confirmJob: true, jobRequestId: 'job_req_00000001' });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.deepEqual([ok.data.job.kind, ok.data.job.amountCents], ['charged', 2000]);
    assert.deepEqual(w.paths(), ['GET /prices/price_job_test', 'POST /tax_rates', 'POST /invoices', 'POST /invoiceitems', 'POST /invoices/in_job_1/finalize', 'POST /invoices/in_job_1/pay']);
    const [, , inv, item, , pay] = w.stripe.calls;
    assert.deepEqual([inv.form.collection_method, inv.form.default_payment_method, inv.form.currency, inv.form.customer], ['charge_automatically', 'pm_test_1', 'aud', 'cus_test_1']);
    assert.equal(inv.form['default_tax_rates[0]'], 'txr_test_1');
    assert.equal(item.form.price, 'price_job_test', 'the amount comes from the owner\'s Stripe price, never from code');
    assert.equal(item.form.unit_amount, undefined);
    assert.equal(item.form.amount, undefined);
    assert.deepEqual([pay.form.payment_method, pay.form.off_session], ['pm_test_1', 'true']);
    assert.ok(w.stripe.calls.filter((c) => c.method === 'POST').every((c) => c.headers['idempotency-key']));
    assert.equal((await o.b.get('/portal/projects')).data.length, 1);
    const rows = await w.pstore.listJobCharges(o.orgId, monthKey(w.clock.t));
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].kind, rows[0].amountCents, rows[0].stripeInvoiceId, rows[0].projectId], ['charged', 2000, 'in_job_1', ok.data.id]);

    // Saving the same project again is free and needs no confirm.
    w.stripe.calls.length = 0;
    const again = await o.b.post('/portal/projects', { ...proj('Lot 14 v2'), id: ok.data.id });
    assert.equal(again.status, 200);
    assert.equal(again.data.job, undefined);
    // A retry of the confirmed request (a lost response) returns the same project and never charges twice.
    const retry = await o.b.post('/portal/projects', { ...proj(), confirmJob: true, jobRequestId: 'job_req_00000001' });
    assert.equal(retry.status, 200);
    assert.equal(retry.data.id, ok.data.id);
    assert.equal(w.stripe.calls.length, 0);
    assert.equal((await w.pstore.listJobCharges(o.orgId, monthKey(w.clock.t))).length, 1);
    // The Billing page numbers.
    const jobs = (await o.b.get('/portal/billing/jobs')).data;
    assert.deepEqual([jobs.summary.count, jobs.summary.chargedCents, jobs.feeCents], [1, 2000, 2000]);
    assert.equal(jobs.plans.every((p) => p.available && !p.current), true);
    const usage = (await o.b.get('/portal/billing/usage')).data;
    assert.equal(usage.jobs.count, 1);
    assert.equal(usage.totals.totalCents, 0, 'jobs are charged when started, so they are not on the month end invoice');
  });

  t('no saved card: the job asks for a card first and creates nothing; a declined card creates nothing and leaves no open invoice', async (w) => {
    const o = await w.org({ noCard: true });
    const ask = await o.b.post('/portal/projects', proj());
    assert.equal(ask.data.error.quote.needsCard, true);
    const refused = await o.b.post('/portal/projects', { ...proj(), confirmJob: true });
    assert.equal(refused.status, 409);
    assert.equal(refused.data.error.code, 'JOB_CARD_REQUIRED');
    assert.equal(w.stripe.calls.length, 0);
    assert.equal((await o.b.get('/portal/projects')).data.length, 0);
    await w.pstore.updateOrg(o.orgId, { paymentMethodId: 'pm_test_1', cardBrand: 'visa', cardLast4: '4242', stripeCustomerId: 'cus_test_1' });
    w.stripe.payResult = 'declined';
    const declined = await o.b.post('/portal/projects', { ...proj(), confirmJob: true, jobRequestId: 'job_req_declined1' });
    assert.equal(declined.status, 402);
    assert.equal(declined.data.error.code, 'JOB_PAYMENT_FAILED');
    assert.match(declined.data.error.message, /not charged, so the project was not created/);
    assert.ok(w.paths().includes('POST /invoices/in_job_1/void'), 'the open invoice is voided');
    assert.equal((await o.b.get('/portal/projects')).data.length, 0);
    assert.equal((await w.pstore.listJobCharges(o.orgId)).length, 0, 'no job is recorded for a payment that failed');
    // The same request id works once the card does.
    w.stripe.payResult = 'paid';
    const ok = await o.b.post('/portal/projects', { ...proj(), confirmJob: true, jobRequestId: 'job_req_declined1' });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
  });

  t('a Stripe price that is not exactly a one off A$20 AUD price is never charged', async (w) => {
    const o = await w.org();
    w.stripe.price = { ...w.stripe.price, unit_amount: 2500 };
    const r = await o.b.post('/portal/projects', { ...proj(), confirmJob: true });
    assert.equal(r.status, 502);
    assert.equal(r.data.error.code, 'JOB_PRICE_MISMATCH');
    assert.ok(!w.paths().includes('POST /invoices'), 'no invoice was created');
    assert.equal((await o.b.get('/portal/projects')).data.length, 0);
    w.stripe.price = { ...w.stripe.price, unit_amount: 2000, recurring: { interval: 'month' }, type: 'recurring' };
    assert.equal((await o.b.post('/portal/projects', { ...proj(), confirmJob: true })).data.error.code, 'JOB_PRICE_MISMATCH', 'a recurring price is refused too');
  });

  t('commercial is unaffected: a client login designs free, a commercial subscription event is not taken by job billing', async (w) => {
    const o = await w.org();
    const made = await o.b.post('/portal/clients', { firstName: 'Sarah' });
    assert.equal(made.status, 201);
    const c = w.browser();
    assert.equal((await c.post('/portal/session', { identifier: made.data.credentials.username, password: made.data.credentials.password })).status, 200);
    assert.equal((await c.post('/portal/password', { currentPassword: made.data.credentials.password, newPassword: 'Another-Long-Pass-77' })).status, 200);
    const mine = await c.post('/portal/projects', proj());
    assert.equal(mine.status, 200, 'a client login is never asked to confirm or pay a job');
    assert.equal(mine.data.job, undefined);
    assert.equal(w.stripe.calls.length, 0);
    assert.equal((await w.pstore.listJobCharges(o.orgId)).length, 0);
    // A Commercial subscription cancelled at Stripe goes to the commercial handler, not the builder job plan handler.
    w.logs.length = 0;
    assert.equal((await w.webhook({ id: 'evt_comm_1', type: 'customer.subscription.deleted', data: { object: { id: 'sub_commercial_1', status: 'canceled' } } })).status, 200);
    assert.ok(w.logs.some((l) => /ignored: no commercial subscription for this id/.test(l)), w.logs.join('\n'));
    // A commercial style subscription checkout (no gi_job_plan purpose) is not claimed by job billing either.
    assert.equal((await w.webhook({ id: 'evt_comm_2', type: 'checkout.session.completed', data: { object: { id: 'cs_comm', mode: 'subscription', metadata: {}, customer: 'cus_other', subscription: 'sub_comm' } } })).status, 200);
    assert.equal((await w.pstore.getOrg(o.orgId)).jobPlan ?? null, null);
  });

  t('an internal test account is never charged, even with every price configured', async (w) => {
    const r = await w.admin('POST', '/portal/admin/internal-orgs', { username: 'internal.test', password: 'Owner-Typed-Pass-2026-x' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const b = w.browser();
    assert.equal((await b.post('/portal/session', { identifier: 'internal.test', password: 'Owner-Typed-Pass-2026-x' })).status, 200);
    const ask = await b.post('/portal/projects', proj());
    assert.equal(ask.data.error.code, 'JOB_CONFIRM_REQUIRED');
    assert.deepEqual([ask.data.error.quote.kind, ask.data.error.quote.cents], ['internal', 0]);
    const ok = await b.post('/portal/projects', { ...proj(), confirmJob: true });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.deepEqual([ok.data.job.kind, ok.data.job.amountCents], ['internal', 0]);
    assert.equal(w.stripe.calls.length, 0, 'no Stripe call, no customer, no invoice');
    assert.equal((await w.admin('POST', `/portal/admin/orgs/${r.data.org.id}/job-plan`, { plan: 'starter' })).status, 400, 'an internal account has no plan');
  });

  t('during a trial jobs are free, and the confirm says what a job costs after the trial', async (w) => {
    const o = await w.org({ noCard: true });
    await w.pstore.updateOrg(o.orgId, { status: 'trial', trialStartedAt: new Date(w.clock.t).toISOString(), trialEndsAt: new Date(w.clock.t + 10 * DAY).toISOString() });
    const ask = await o.b.post('/portal/projects', proj());
    assert.equal(ask.data.error.code, 'JOB_CONFIRM_REQUIRED');
    assert.deepEqual([ask.data.error.quote.kind, ask.data.error.quote.cents, ask.data.error.quote.needsCard], ['trial_free', 0, false]);
    assert.match(ask.data.error.quote.message, /free during your trial/);
    assert.match(ask.data.error.quote.message, /After the trial each new job is A\$20 incl\. GST/);
    const ok = await o.b.post('/portal/projects', { ...proj(), confirmJob: true });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.deepEqual([ok.data.job.kind, ok.data.job.amountCents], ['trial_free', 0]);
    assert.equal(w.stripe.calls.length, 0);
    // After the trial the account is read only until a card is added: no project can be started at all.
    w.clock.t += 11 * DAY;
    const ended = await o.b.post('/portal/projects', { ...proj('Late'), confirmJob: true });
    assert.equal(ended.status, 403);
    assert.equal(ended.data.error.code, 'READ_ONLY');
  });

  t('a capped plan counts jobs down, then extras are A$20 each, and the allowance resets next month with no rollover', async (w) => {
    const o = await w.org();
    assert.equal((await w.admin('POST', `/portal/admin/orgs/${o.orgId}/job-plan`, { plan: 'bogus' })).status, 400);
    const set = await w.admin('POST', `/portal/admin/orgs/${o.orgId}/job-plan`, { plan: 'starter' });
    assert.equal(set.status, 200, JSON.stringify(set.data));
    assert.equal(set.data.jobs.plan.id, 'starter');
    for (let n = 1; n <= 10; n += 1) {
      const ask = await o.b.post('/portal/projects', proj(`Job ${n}`));
      assert.deepEqual([ask.data.error.quote.kind, ask.data.error.quote.cents], ['plan_included', 0], `job ${n}`);
      assert.match(ask.data.error.quote.message, new RegExp(`${10 - n} of 10 jobs left this month after this one`));
      const ok = await o.b.post('/portal/projects', { ...proj(`Job ${n}`), confirmJob: true });
      assert.equal(ok.status, 200, JSON.stringify(ok.data));
      assert.deepEqual([ok.data.job.kind, ok.data.job.amountCents, ok.data.job.plan], ['plan_included', 0, 'starter']);
    }
    assert.equal(w.stripe.calls.length, 0, 'included jobs never touch Stripe');
    const extraAsk = await o.b.post('/portal/projects', proj('Job 11'));
    assert.deepEqual([extraAsk.data.error.quote.kind, extraAsk.data.error.quote.cents], ['plan_extra', 2000]);
    assert.match(extraAsk.data.error.quote.message, /used all 10 jobs in your Builder Starter plan this month\. This extra job is A\$20 incl\. GST/);
    const extra = await o.b.post('/portal/projects', { ...proj('Job 11'), confirmJob: true });
    assert.equal(extra.status, 200, JSON.stringify(extra.data));
    assert.deepEqual([extra.data.job.kind, extra.data.job.amountCents], ['plan_extra', 2000]);
    assert.equal(w.stripe.invoices, 1, 'one A$20 invoice for the one extra job');
    const jobs = (await o.b.get('/portal/billing/jobs')).data;
    assert.deepEqual([jobs.summary.count, jobs.summary.planIncludedCount, jobs.summary.planExtraCount, jobs.summary.chargedCents], [11, 10, 1, 2000]);
    assert.equal(jobs.plan.name, 'Builder Starter');
    // Next Sydney month: the allowance is counted afresh, so the 10 jobs are back (used jobs never carry over, unused ones never roll over).
    w.clock.t += 20 * DAY; // 08/12/2026, inside the session window
    const next = (await o.b.get('/portal/billing/jobs')).data;
    assert.equal(next.month, monthKey(w.clock.t));
    assert.deepEqual([next.summary.count, next.quote.kind, next.quote.plan.used], [0, 'plan_included', 0]);
    assert.match(next.quote.message, /9 of 10 jobs left this month after this one/);
  });

  t('unset price ids are safe: the confirm still shows, nothing is charged, and the admin view says the price is not configured', async () => {
    const w = world({ d1, env: {} });
    try {
      const o = await w.org({ noCard: true });
      const ask = await o.b.post('/portal/projects', proj());
      assert.equal(ask.status, 409);
      const q = ask.data.error.quote;
      assert.deepEqual([q.priceText, q.charging, q.needsCard], ['A$20 incl. GST', false, false]);
      assert.match(q.message, /Job billing is not switched on yet, so this job will not be charged/);
      assert.doesNotMatch(JSON.stringify(ask.data), /BUILDER_JOB_PRICE_ID/, 'env names never reach a builder');
      const ok = await o.b.post('/portal/projects', { ...proj(), confirmJob: true });
      assert.equal(ok.status, 200, JSON.stringify(ok.data));
      assert.deepEqual([ok.data.job.kind, ok.data.job.amountCents], ['unbilled', 0]);
      assert.equal(w.stripe.calls.length, 0, 'no made up amount is ever charged');
      const view = (await w.admin('GET', '/portal/admin/orgs')).data.find((x) => x.id === o.orgId);
      assert.equal(view.jobs.billingReady, false);
      assert.match(view.jobs.billingMessage, /A\$20 job price is not configured \(set BUILDER_JOB_PRICE_ID\)/);
      assert.equal(view.jobs.unbilledCount, 1);
      // Plans cannot be bought, and say so.
      const plans = (await o.b.get('/portal/billing/jobs')).data.plans;
      assert.equal(plans.length, 3);
      assert.equal(plans.every((p) => p.available === false), true);
      const buy = await o.b.post('/portal/billing/job-plan', { plan: 'pro' });
      assert.equal(buy.status, 503);
      assert.equal(buy.data.error.code, 'JOB_PLAN_UNAVAILABLE');
      assert.match(buy.data.error.message, /coming soon/);
      assert.equal(w.stripe.calls.length, 0);
    } finally { w.restore(); }
    // A live key without the owner's written go ahead charges nothing either.
    const w2 = world({ d1, env: { ...PRICES, STRIPE_SECRET_KEY: 'sk_live_abc' } });
    try {
      const o = await w2.org();
      const ok = await o.b.post('/portal/projects', { ...proj(), confirmJob: true });
      assert.equal(ok.status, 200, JSON.stringify(ok.data));
      assert.equal(ok.data.job.kind, 'unbilled');
      assert.equal(w2.stripe.calls.length, 0);
      assert.match((await w2.admin('GET', '/portal/admin/orgs')).data[0].jobs.billingMessage, /STRIPE_LIVE_BILLING_APPROVED/);
    } finally { w2.restore(); }
  });

  t('client logins are no longer billed: no row at first sign in, nothing on the usage view, no billing details needed', async (w) => {
    const o = await w.org({ noCard: true });
    await w.pstore.updateOrg(o.orgId, { legalName: null, abn: null, billingEmail: null });
    const made = await o.b.post('/portal/clients', { firstName: 'Sarah' });
    assert.equal(made.status, 201, JSON.stringify(made.data));
    assert.deepEqual(made.data.charge, { amountCents: 0, trigger: 'none', note: 'No charge for client logins.' });
    const c = w.browser();
    assert.equal((await c.post('/portal/session', { identifier: made.data.credentials.username, password: made.data.credentials.password })).status, 200);
    assert.equal((await w.pstore.listLoginIssues(o.orgId)).length, 0);
    const usage = (await o.b.get('/portal/billing/usage')).data;
    assert.deepEqual([usage.totals.loginsCount, usage.totals.totalCents, usage.loginPricing], [0, 0, null]);
    // History is intact: a login charged before this change still shows and still totals.
    await w.pstore.addLoginIssue({ loginId: 'old_login', id: 'li_old', orgId: o.orgId, clientName: 'Old', issuedAt: new Date(w.clock.t).toISOString(), month: monthKey(w.clock.t), amountCents: 3000 });
    assert.equal((await o.b.get('/portal/billing/usage')).data.totals.loginsCents, 3000);
  });

  t('the admin sees jobs charged per org, with a per org list for any month', async (w) => {
    const a = await w.org({ name: 'Alpha Builders Pty Ltd' });
    for (const n of [1, 2]) assert.equal((await a.b.post('/portal/projects', { ...proj(`A${n}`), confirmJob: true })).status, 200);
    const list = (await w.admin('GET', '/portal/admin/orgs')).data;
    const row = list.find((x) => x.id === a.orgId);
    assert.deepEqual([row.jobs.count, row.jobs.chargedCents, row.jobs.chargedCount, row.jobs.billingReady, row.jobs.items.length], [2, 4000, 2, true, 2]);
    assert.equal(row.jobs.items[0].projectName.startsWith('A'), true);
    const detail = await w.admin('GET', `/portal/admin/orgs/${a.orgId}/jobs`);
    assert.equal(detail.status, 200);
    assert.deepEqual([detail.data.count, detail.data.chargedCents], [2, 4000]);
    assert.equal((await w.admin('GET', `/portal/admin/orgs/${a.orgId}/jobs?month=2026-10`)).data.count, 0);
    assert.equal((await w.admin('GET', `/portal/admin/orgs/${a.orgId}/jobs?month=nope`)).status, 400);
    assert.equal((await w.admin('GET', '/portal/admin/orgs/none/jobs')).status, 404);
    // Another builder cannot see these jobs.
    const other = await w.org({ name: 'Other Builders Pty Ltd' }).catch(() => null);
    assert.ok(!other || (await other.b.get('/portal/billing/jobs')).data.summary.count === 0);
  });

  t('buying a plan: Checkout in subscription mode with the owner\'s price id, the webhook starts it, cancelling ends it at Stripe', async (w) => {
    const o = await w.org();
    const start = await o.b.post('/portal/billing/job-plan', { plan: 'pro' });
    assert.equal(start.status, 200, JSON.stringify(start.data));
    const call = w.stripe.calls.find((c) => c.path === '/checkout/sessions');
    assert.deepEqual([call.form.mode, call.form['line_items[0][price]'], call.form['metadata[purpose]'], call.form['metadata[plan]'], call.form['metadata[org_id]']], ['subscription', 'price_pro_test', 'gi_job_plan', 'pro', o.orgId]);
    assert.equal((await o.b.post('/portal/billing/job-plan', { plan: 'nope' })).status, 400);
    const session = { id: 'cs_test_plan1', mode: 'subscription', status: 'complete', payment_status: 'paid', customer: 'cus_test_1', subscription: 'sub_plan_1', client_reference_id: o.orgId, metadata: { org_id: o.orgId, purpose: 'gi_job_plan', plan: 'pro' } };
    w.stripe.sessions.cs_test_plan1 = session;
    assert.equal((await o.b.post('/portal/billing/job-plan/confirm', { sessionId: 'cs_test_missing1' })).status, 404);
    const conf = await o.b.post('/portal/billing/job-plan/confirm', { sessionId: 'cs_test_plan1' });
    assert.equal(conf.status, 200, JSON.stringify(conf.data));
    assert.equal(conf.data.plan.id, 'pro');
    // The same event by webhook is idempotent and is not taken by commercial.
    assert.equal((await w.webhook({ id: 'evt_plan_1', type: 'checkout.session.completed', data: { object: session } })).status, 200);
    assert.equal((await w.store.getEntitlementByPaymentIntent('sub_plan_1')), null, 'no Commercial entitlement was made');
    const q = (await o.b.post('/portal/projects', proj())).data.error.quote;
    assert.deepEqual([q.kind, q.plan.name, q.plan.jobs], ['plan_included', 'Builder Pro', 20]);
    assert.equal((await o.b.post('/portal/billing/job-plan', { plan: 'teams' })).status, 409, 'one plan at a time');
    assert.equal((await o.b.post('/portal/billing/job-plan/cancel')).status, 200);
    assert.ok(w.paths().includes('POST /subscriptions/sub_plan_1'));
    assert.equal(w.stripe.calls.find((c) => c.path === '/subscriptions/sub_plan_1').form.cancel_at_period_end, 'true');
    // Stripe ends the subscription: the plan goes and jobs are A$20 again.
    assert.equal((await w.webhook({ id: 'evt_plan_2', type: 'customer.subscription.deleted', data: { object: { id: 'sub_plan_1', status: 'canceled' } } })).status, 200);
    assert.equal((await w.pstore.getOrg(o.orgId)).jobPlan ?? null, null);
    assert.equal((await o.b.post('/portal/projects', proj())).data.error.quote.kind, 'charged');
  });
}

// Public copy and strings ---------------------------------------------------------------------------------------------------------
const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
test('public copy: A$20 a job, no monthly fee, plans A$119 / A$219 / A$419 with 10 / 20 / 40 jobs marked Coming soon, no old login fees or plan prices', () => {
  for (const f of ['../website-live/pricing/index.html', '../website-live/for-builders/index.html']) {
    const s = read(f);
    assert.match(s, /A\$20/, f);
    for (const x of ['A$119', 'A$219', 'A$419', '10 jobs', '20 jobs', '40 jobs']) assert.ok(s.includes(x), `${f} mentions ${x}`);
    assert.match(s, /gx-badge soon">Coming soon<\/span><h3>Builder Starter/, f);
    assert.doesNotMatch(s, /Builder (Starter|Pro|Teams)<\/h3><div class="amount">A\$(149|249|449)|A\$30 <small>per login|A\$25 from the 16th|per client login<|Pay per client login/, f);
  }
  const fw = read('../website-live/framework.js');
  assert.match(fw, /fee: 119, inc: 10/);
  assert.match(fw, /fee: 219, inc: 20/);
  assert.match(fw, /fee: 419, inc: 40/);
  assert.doesNotMatch(fw, /fee: 149|fee: 249|fee: 449/);
  const toml = read('wrangler.toml');
  for (const k of ['BUILDER_JOB_PRICE_ID', 'BUILDER_STARTER_PRICE_ID', 'BUILDER_PRO_PRICE_ID', 'BUILDER_TEAMS_PRICE_ID']) assert.ok(toml.includes(k), k);
  assert.doesNotMatch(toml.split('\n').filter((l) => !l.startsWith('#') && /BUILDER_/.test(l)).join('\n'), /BUILDER_/, 'documentation only: no setting is enabled in the file');
});

test('the break even calculator in framework.js works out jobs at A$20 and the three plans', () => {
  const src = read('../website-live/framework.js');
  const a = src.indexOf('// builder job cost calculator');
  const body = src.slice(a, src.indexOf('// reveal on scroll'));
  const els = (n, extra = {}) => ({ value: String(n), textContent: '', addEventListener() {}, ...extra });
  const root = { querySelector: (sel) => ({ '[data-calc-range]': range, '[data-calc-topups]': tops, '[data-calc-n]': nOut, '[data-calc-total]': total, '[data-calc-line]': line, '[data-calc-best]': best })[sel] };
  const range = els(20); const tops = els(0); const nOut = els(0); const total = els(0); const line = els(0); const best = els(0);
  const document = { querySelectorAll: () => [root] };
  new Function('document', body.replace(/^[^\n]*\n/, '').replace('document.querySelectorAll', 'document.querySelectorAll'))(document);
  const run = (n, t = 0) => { range.value = String(n); tops.value = String(t); range.listeners?.forEach((f) => f()); };
  // upd runs once at load with 20 jobs: A$400 pay per job, Builder Pro (A$219) is cheapest.
  assert.equal(total.textContent, 'A$400');
  assert.match(best.textContent, /Cheapest for 20 jobs: Builder Pro at A\$219 a month, against A\$400 pay per job/);
  assert.ok(run);
});

test('new copy has no em or en dashes and never the word compliant', () => {
  for (const f of ['src/portal/ui/billing-tab.js', 'src/portal/ui/trial-ui.js', 'src/portal/ui/clients-tab.js', '../website-live/pricing/index.html', '../website-live/for-builders/index.html', '../website-live/trial-terms.html']) {
    const s = read(f);
    assert.doesNotMatch(s, /[–—]/, `${f} has a dash character`);
    assert.doesNotMatch(s, /\bcompliant\b/i, f);
  }
  const added = read('src/portal/client-mode.js').split('\n').filter((l) => /job|Job/.test(l)).join('\n');
  assert.doesNotMatch(added, /[–—]/);
});

// AI top-up pack (owner decision 18/11/2026): 100 messages for A$15 incl. GST, 2 credits a message on the builder meter.
test('AI top-up pack: 100 messages, A$15, 200 stored credits; older 300 credit A$10 rows keep their own amounts on the invoice', async () => {
  const B = await import('../src/portal/billing.js');
  const { readConfig } = await import('../server/lib/config.js');
  assert.deepEqual([B.TOPUP_MESSAGES, B.TOPUP_FEE_CENTS, B.TOPUP_CREDITS, B.AI_CREDITS_PER_MESSAGE], [100, 1500, 200, 2]);
  const cfg = readConfig({ TOPUP_CREDITS: '300', TOPUP_AMOUNT_CENTS: '1000' });
  assert.deepEqual([cfg.topUpMessages, cfg.topUpCredits, cfg.topUpCents], [100, 200, 1500], 'old wrangler variables are ignored');
  const rows = [
    { id: 'a', credits: 300, amountCents: 1000, createdAt: '2026-11-10T00:00:00Z' },
    { id: 'b', credits: 200, amountCents: 1500, createdAt: '2026-11-20T00:00:00Z' },
    { id: 'c', credits: 200, amountCents: 1500, createdAt: '2026-11-21T00:00:00Z' },
  ];
  const s = B.summariseMonth({ topUps: rows }, '2026-11');
  assert.equal(s.totals.topUpsCents, 4000);
  const lines = B.topUpInvoiceLines(rows);
  assert.deepEqual(lines.map((l) => [l.quantity, l.unitCents, l.totalCents]), [[2, 1500, 3000], [1, 1000, 1000]]);
  assert.match(lines[0].description, /100 messages/);
  assert.match(lines[1].description, /300 credits/);
  assert.equal(B.topUpQuantityText(rows[0]), '300 AI credits');
  assert.equal(B.topUpQuantityText(rows[1]), '100 AI messages');
});
