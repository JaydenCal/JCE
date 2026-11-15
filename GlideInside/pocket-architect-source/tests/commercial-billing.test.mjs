// Commercial Developer subscription (A$50 per month), AI allowance and top-ups, and the shared commercial trial login
// (server/lib/commercial.js). In memory stores, a fake Stripe and Anthropic, signed webhooks and a controllable clock. No live Stripe.
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { createApp } from '../server/lib/app.js';
import { createMemoryStore } from '../server/lib/store.js';
import { hmacSha256, signToken } from '../server/lib/entitlement.js';
import { verifyPassword } from '../server/lib/password.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { createProject } from '../src/model/schema.js';

const T0 = Date.UTC(2026, 10, 15, 3, 0, 0);
const DAY = 86400000;
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ROOF = { type: 'tool_use', id: 'toolu_1', name: 'set_finish', input: { target: 'roof', colour: 'steel-charcoal' } };
const USAGE = { input_tokens: 5200, output_tokens: 180, cache_creation_input_tokens: 1000, cache_read_input_tokens: 5800 };
const ADMIN = 'admin-token-for-tests-0123456789';
const TRIAL_PW = 'Gum-tree-Wattle-7731';

function makeWorld(env = {}) {
  const clock = { t: T0 };
  const w = { clock, stripe: [], sessions: new Map(), subs: new Map(), store: createMemoryStore(), anthropicBodies: [] };
  let n = 0;
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method || 'GET';
    if (u.origin === 'https://api.stripe.com') {
      const path = u.pathname.replace('/v1', '');
      if (path === '/checkout/sessions' && method === 'POST') {
        n += 1;
        w.stripe.push(Object.fromEntries(new URLSearchParams(init.body)));
        return jsonRes({ id: `cs_test_${n}`, url: `https://checkout.stripe.com/c/pay/cs_test_${n}` });
      }
      if (path.startsWith('/checkout/sessions/')) return w.sessions.has(path.split('/').pop()) ? jsonRes(w.sessions.get(path.split('/').pop())) : jsonRes({ error: {} }, 404);
      if (path.startsWith('/subscriptions/')) return w.subs.has(path.split('/').pop()) ? jsonRes(w.subs.get(path.split('/').pop())) : jsonRes({ error: {} }, 404);
      if (path === '/billing_portal/sessions') {
        w.stripe.push({ portal: true, ...Object.fromEntries(new URLSearchParams(init.body)) });
        return jsonRes({ url: 'https://billing.stripe.com/p/session/test_1' });
      }
    }
    if (u.href === 'https://api.anthropic.com/v1/messages') w.anthropicBodies.push(JSON.parse(init.body));
    if (u.href === 'https://api.anthropic.com/v1/messages') return jsonRes({ id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: 'Done.' }, ROOF], stop_reason: 'tool_use', usage: USAGE });
    throw new Error(`unexpected fetch ${url}`);
  };
  const full = { SITE_URL: 'https://site.test', ENTITLEMENT_SECRET: 'unit-secret', STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_WEBHOOK_SECRET: 'whsec_unit', ANTHROPIC_API_KEY: 'sk-ant', ADMIN_TOKEN: ADMIN,
    COMMERCIAL_SUB_PRICE_ID: 'price_sub', COMMERCIAL_AI_TOPUP_PRICE_ID: 'price_topup', AI_RATE_PER_MIN: '1000', AI_RATE_PER_DAY: '1000', ...env };
  w.app = createApp({ store: w.store, env: full, fetchImpl, now: () => clock.t, loadJsPDF: async () => (await import('jspdf')).jsPDF });
  w.call = async (method, path, { token, body, headers = {} } = {}) => {
    const init = { method, headers: { ...headers } };
    if (token) init.headers.authorization = `Bearer ${token}`;
    if (body !== undefined) { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
    const res = await w.app.fetch(new Request(`https://api.test${path}`, init));
    const type = res.headers.get('content-type') || '';
    return { res, status: res.status, json: type.includes('json') ? await res.clone().json() : null };
  };
  w.event = async (event) => {
    const raw = JSON.stringify({ id: `evt_${++n}`, ...event });
    const t = Math.floor(clock.t / 1000);
    const sig = hex(await hmacSha256('whsec_unit', `${t}.${raw}`));
    const res = await w.app.fetch(new Request('https://api.test/api/stripe/webhook', { method: 'POST', body: raw, headers: { 'stripe-signature': `t=${t},v1=${sig}` } }));
    return res.status;
  };
  w.setSub = (id, status = 'active', endMs = T0 + 30 * DAY, customer = 'cus_1') => w.subs.set(id, { id, status, customer, current_period_end: Math.floor(endMs / 1000) });
  // Buy the subscription end to end and return its token.
  w.subscribe = async ({ sub = 'sub_1', session = 'cs_sub_000001', email = 'dev@example.com', endMs = T0 + 30 * DAY } = {}) => {
    w.setSub(sub, 'active', endMs);
    const obj = { id: session, mode: 'subscription', payment_status: 'paid', subscription: sub, customer_details: { email }, amount_total: 5000, currency: 'aud', metadata: { app: 'pocket-architect', kind: 'commercial_sub' } };
    w.sessions.set(session, obj);
    assert.equal(await w.event({ type: 'checkout.session.completed', data: { object: obj } }), 200);
    const got = await w.call('GET', `/api/commercial/subscription?session_id=${session}`);
    assert.equal(got.status, 200, JSON.stringify(got.json));
    return got.json.token;
  };
  w.ai = (token, extra = {}) => w.call('POST', '/api/ai/edit', { token, body: { message: 'Make the roof dark grey', context: 'PROJECT "T"\nLEVEL l_1 "Ground" active', history: [], activeLevelId: 'l_1', commercial: true, ...extra } });
  w.pdf = (token, project = commercialProject({ plain: false })) => w.call('POST', '/api/export/pdf', { token, body: { project } });
  w.admin = (method, path, body, token = ADMIN) => w.call(method, `/api/commercial/admin/trial${path}`, { token, body });
  w.createTrial = async (body = {}) => {
    const r = await w.admin('PUT', '', { username: 'friend', password: TRIAL_PW, ...body });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r;
  };
  w.trialLogin = (username = 'friend', password = TRIAL_PW) => w.call('POST', '/api/commercial/trial/login', { body: { username, password } });
  return w;
}

// The PDF text with its Flate streams inflated, so drawn text (the watermark) can be searched.
const pdfText = async (r) => {
  const buf = Buffer.from(await r.res.arrayBuffer());
  const raw = buf.toString('latin1');
  let out = raw;
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      out += `\n${zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1')}`;
    } catch { /* not a Flate stream */ }
  }
  return out;
};

// Subscription -----------------------------------------------------------------------------------------------------------------
test('subscribe: Coming soon without a price id, subscription mode Checkout with one', async () => {
  const off = makeWorld({ COMMERCIAL_SUB_PRICE_ID: '' });
  assert.equal((await off.call('GET', '/api/commercial/status')).json.subscribable, false);
  const r = await off.call('POST', '/api/commercial/subscribe', { body: {} });
  assert.equal(r.status, 503);
  assert.equal(r.json.error.code, 'SUBSCRIPTION_COMING_SOON');
  assert.equal(off.stripe.length, 0);
  const w = makeWorld();
  assert.equal((await w.call('GET', '/api/commercial/status')).json.subscribable, true);
  const ok = await w.call('POST', '/api/commercial/subscribe', { body: { email: 'dev@example.com' } });
  assert.equal(ok.status, 200);
  assert.match(ok.json.url, /^https:\/\/checkout\.stripe\.com\//);
  const form = w.stripe[0];
  assert.equal(form.mode, 'subscription');
  assert.equal(form['line_items[0][price]'], 'price_sub');
  assert.equal(form['metadata[kind]'], 'commercial_sub');
  assert.match(form.success_url, /csub=success&session_id=\{CHECKOUT_SESSION_ID\}/);
});

test('webhook transitions: created, past due, renewed, payment failed, cancelled', async () => {
  const w = makeWorld();
  const token = await w.subscribe();
  const acct = async () => (await w.call('GET', '/api/commercial/account', { token })).json;
  let a = await acct();
  assert.equal(a.account.status, 'active');
  assert.equal(a.account.currentPeriodEnd, new Date(T0 + 30 * DAY).toISOString());
  // a duplicate checkout event changes nothing
  assert.equal((await w.store.getEntitlementBySession('cs_sub_000001')).status, 'active');
  // past due
  assert.equal(await w.event({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'past_due', current_period_end: Math.floor((T0 + 30 * DAY) / 1000) } } }), 200);
  const blocked = await w.call('GET', '/api/commercial/account', { token });
  assert.equal(blocked.status, 403);
  assert.match(blocked.json.error.message, /did not go through/);
  // renewal after the card is fixed moves the period end and restores access
  assert.equal(await w.event({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'active', current_period_end: Math.floor((T0 + 60 * DAY) / 1000) } } }), 200);
  a = await acct();
  assert.equal(a.account.status, 'active');
  assert.equal(a.account.currentPeriodEnd, new Date(T0 + 60 * DAY).toISOString());
  // payment failed
  assert.equal(await w.event({ type: 'invoice.payment_failed', data: { object: { id: 'in_1', subscription: 'sub_1' } } }), 200);
  assert.equal((await w.call('GET', '/api/commercial/account', { token })).status, 403);
  // cancelled
  await w.event({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'active', current_period_end: Math.floor((T0 + 60 * DAY) / 1000) } } });
  assert.equal(await w.event({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', status: 'canceled' } } }), 200);
  assert.equal((await w.call('GET', '/api/commercial/account', { token })).status, 403);
  // an event for an unknown subscription is accepted and ignored
  assert.equal(await w.event({ type: 'customer.subscription.updated', data: { object: { id: 'sub_unknown', status: 'active' } } }), 200);
});

test('a subscription that has passed its paid period ends even without an event', async () => {
  const w = makeWorld();
  const token = await w.subscribe();
  w.clock.t = T0 + 31 * DAY;
  assert.equal((await w.call('GET', '/api/commercial/account', { token })).status, 403);
});

test('restore a subscription with email and receipt, wrong details refused', async () => {
  const w = makeWorld();
  await w.subscribe();
  const ent = await w.store.getEntitlementBySession('cs_sub_000001');
  const bad = await w.call('POST', '/api/commercial/subscription/restore', { body: { email: 'dev@example.com', sessionOrReceipt: 'ent_wrong_123' } });
  assert.equal(bad.status, 403);
  const ok = await w.call('POST', '/api/commercial/subscription/restore', { body: { email: 'dev@example.com', sessionOrReceipt: ent.id } });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.token);
});

test('Manage billing opens the Stripe customer portal for the subscriber only', async () => {
  const w = makeWorld();
  const token = await w.subscribe();
  const r = await w.call('POST', '/api/commercial/billing-portal', { token });
  assert.equal(r.status, 200);
  assert.match(r.json.url, /^https:\/\/billing\.stripe\.com\//);
  assert.equal(w.stripe.at(-1).customer, 'cus_1');
  assert.equal((await w.call('POST', '/api/commercial/billing-portal')).status, 401);
});

// Gating of the plan set PDF ---------------------------------------------------------------------------------------------------
test('gating: active subscriber gets unlimited commercial plan sets, others are blocked, residential designs are not covered', async () => {
  const w = makeWorld();
  assert.equal((await w.pdf(null)).status, 403);
  const token = await w.subscribe();
  for (let i = 0; i < 4; i += 1) {
    const r = await w.pdf(token);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const text = await pdfText(r);
    assert.ok(text.startsWith('%PDF-'));
    assert.ok(!text.includes('TRIAL'), 'a subscriber PDF is not watermarked');
  }
  const resi = await w.pdf(token, createProject({ id: 'p_house', name: 'House' }));
  assert.equal(resi.status, 403);
  assert.equal((await w.call('POST', '/api/export/glb', { token, body: { project: commercialProject({ plain: false }) } })).status, 403);
  await w.event({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', status: 'canceled' } } });
  assert.equal((await w.pdf(token)).status, 403);
});

// AI allowance, renewal and top-ups --------------------------------------------------------------------------------------------
test('AI allowance: counted in messages, warns at 80 percent, blocks at zero with the top-up offer', async () => {
  const w = makeWorld({ COMMERCIAL_AI_MONTHLY: '5' });
  const token = await w.subscribe();
  const c0 = (await w.call('GET', '/api/credits', { token })).json;
  assert.deepEqual([c0.total, c0.used, c0.remaining, c0.unit], [5, 0, 5, 'messages']);
  assert.equal(c0.commercialTopUp.available, true);
  // outside commercial mode the subscription does not cover the assistant
  assert.equal((await w.ai(token, { commercial: false })).status, 403);
  const warnings = [];
  for (let i = 0; i < 4; i += 1) {
    const r = await w.ai(token);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.credits.charged, 1);
    warnings.push(r.json.warning?.level ?? null);
  }
  assert.deepEqual(warnings, [null, null, null, 0.8]);
  assert.equal((await w.ai(token)).status, 200);
  const zero = await w.ai(token);
  assert.equal(zero.status, 402);
  assert.equal(zero.json.error.code, 'CREDITS_EXHAUSTED');
  assert.equal(zero.json.error.commercialTopUp.messages, 100);
  assert.equal((await w.call('GET', '/api/credits', { token })).json.remaining, 0);
  assert.equal((await w.pdf(token)).status, 200, 'plan sets stay unlimited at zero AI messages');
});

test('AI allowance resets on renewal, and top-up messages roll over', async () => {
  const w = makeWorld({ COMMERCIAL_AI_MONTHLY: '2' });
  const token = await w.subscribe();
  await w.ai(token);
  await w.ai(token);
  assert.equal((await w.ai(token)).status, 402);
  // buy a top-up (Stripe webhook, then the confirm call is a harmless duplicate)
  const sess = { id: 'cs_top_000001', mode: 'payment', payment_status: 'paid', amount_total: 1500, currency: 'aud', metadata: { app: 'pocket-architect', kind: 'commercial_ai_topup', entId: (await w.store.getEntitlementBySession('cs_sub_000001')).id, messages: '3' } };
  w.sessions.set('cs_top_000001', sess);
  assert.equal(await w.event({ type: 'checkout.session.completed', data: { object: sess } }), 200);
  assert.equal(await w.event({ type: 'checkout.session.completed', data: { object: sess } }), 200);
  assert.equal((await w.call('GET', '/api/commercial/ai-topup?session_id=cs_top_000001', { token })).status, 200);
  let c = (await w.call('GET', '/api/credits', { token })).json;
  assert.equal(c.topUpRemaining, 3, 'credited once only');
  assert.equal((await w.ai(token)).status, 200);
  c = (await w.call('GET', '/api/credits', { token })).json;
  assert.deepEqual([c.remaining, c.topUpRemaining], [0, 2]);
  // renewal: a new billing period gives a fresh monthly allowance, the unused top-up stays
  await w.event({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'active', current_period_end: Math.floor((T0 + 60 * DAY) / 1000) } } });
  w.clock.t = T0 + 31 * DAY;
  c = (await w.call('GET', '/api/credits', { token })).json;
  assert.deepEqual([c.total, c.used, c.remaining, c.topUpRemaining], [2, 0, 2, 2]);
  assert.equal((await w.ai(token)).status, 200);
  // while the subscription is cancelled nothing is usable
  await w.event({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', status: 'canceled' } } });
  assert.equal((await w.ai(token)).status, 403);
});

test('top-up checkout: Coming soon without a price id, payment Checkout with one, subscribers only', async () => {
  const off = makeWorld({ COMMERCIAL_AI_TOPUP_PRICE_ID: '' });
  const t0 = await off.subscribe();
  assert.equal((await off.call('GET', '/api/commercial/status')).json.topUp, false);
  const r0 = await off.call('POST', '/api/commercial/ai-topup', { token: t0 });
  assert.equal(r0.status, 503);
  assert.equal(r0.json.error.code, 'SUBSCRIPTION_COMING_SOON');
  const w = makeWorld({ COMMERCIAL_AI_TOPUP_QTY: '150' });
  const token = await w.subscribe();
  const r = await w.call('POST', '/api/commercial/ai-topup', { token });
  assert.equal(r.status, 200);
  assert.equal(r.json.messages, 150);
  const form = w.stripe.at(-1);
  assert.equal(form.mode, 'payment');
  assert.equal(form['line_items[0][price]'], 'price_topup');
  assert.equal(form['metadata[kind]'], 'commercial_ai_topup');
  assert.equal(form['metadata[messages]'], '150');
  assert.equal((await w.call('POST', '/api/commercial/ai-topup')).status, 401);
  // a top-up session for someone else's subscription is not accepted by confirm
  const forged = { id: 'cs_top_00000x', mode: 'payment', payment_status: 'paid', metadata: { app: 'pocket-architect', kind: 'commercial_ai_topup', entId: 'csub_other', messages: '99' } };
  w.sessions.set('cs_top_00000x', forged);
  assert.equal((await w.call('GET', '/api/commercial/ai-topup?session_id=cs_top_00000x', { token })).status, 404);
  assert.equal((await w.call('GET', '/api/credits', { token })).json.topUpRemaining, 0);
});

// Trial login ------------------------------------------------------------------------------------------------------------------
test('admin screen routes are owner only (ADMIN_TOKEN)', async () => {
  const w = makeWorld();
  assert.equal((await w.admin('GET', '', undefined, null)).status, 401);
  assert.equal((await w.admin('GET', '', undefined, 'wrong-token')).status, 401);
  assert.equal((await w.admin('PUT', '', { username: 'friend', password: TRIAL_PW }, null)).status, 401);
  const sub = await w.subscribe();
  assert.equal((await w.admin('PUT', '', { username: 'friend', password: TRIAL_PW }, sub)).status, 401, 'a subscriber token is not an admin token');
  assert.equal((await w.admin('GET', '')).json.exists, false);
  const off = makeWorld({ ADMIN_TOKEN: '' });
  assert.equal((await off.admin('GET', '')).status, 503);
});

test('trial login: username sign in, watermarked unlimited PDFs, no billing, no password change', async () => {
  const w = makeWorld();
  await w.createTrial();
  const bad = await w.trialLogin('friend', 'not-the-password');
  assert.equal(bad.status, 401);
  assert.equal((await w.trialLogin('FRIEND ')).status, 200, 'username is not case sensitive');
  const login = await w.trialLogin();
  assert.equal(login.status, 200);
  assert.equal(login.json.account.role, 'commercial_trial');
  const token = login.json.token;
  for (let i = 0; i < 4; i += 1) {
    const r = await w.pdf(token);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const text = await pdfText(r);
    assert.ok(text.includes('TRIAL, NOT FOR CONSTRUCTION'), 'watermark title');
    assert.ok(!text.includes('Watermark removed'), 'no removal line for the commercial trial');
    assert.ok(!text.includes('LODGEMENT'), 'one consistent wording');
  }
  const dxf = await w.call('POST', '/api/export/dxf', { token, body: { project: commercialProject({ plain: false }) } });
  assert.equal(dxf.status, 200);
  const dxfText = Buffer.from(await dxf.res.arrayBuffer()).toString('utf8');
  assert.ok(dxfText.includes('TRIAL, NOT FOR CONSTRUCTION'), 'DXF watermark text');
  assert.ok(!dxfText.includes('LODGEMENT') && !dxfText.includes('Watermark removed'), 'DXF has the one consistent wording');
  assert.equal((await w.pdf(token, createProject({ id: 'p_h', name: 'H' }))).status, 403);
  assert.equal((await w.call('POST', '/api/commercial/billing-portal', { token })).status, 403);
  assert.equal((await w.call('POST', '/api/commercial/ai-topup', { token })).status, 403);
  assert.equal((await w.call('POST', '/api/portal/password', { token, body: { currentPassword: TRIAL_PW, newPassword: 'Another-long-pass-99' }, headers: { 'x-gi-request': '1' } })).status >= 400, true);
  const view = (await w.admin('GET', '')).json;
  assert.equal(view.usage.pdf, 4);
  assert.ok(view.lastUsedAt);
});

test('trial watermark can be switched off by env, and an optional daily PDF cap works', async () => {
  const off = makeWorld({ COMMERCIAL_TRIAL_WATERMARK: '0' });
  await off.createTrial();
  const t = (await off.trialLogin()).json.token;
  assert.ok(!(await pdfText(await off.pdf(t))).includes('TRIAL, NOT FOR CONSTRUCTION'));
  const w = makeWorld({ COMMERCIAL_TRIAL_DAILY_PDFS: '2' });
  await w.createTrial();
  const token = (await w.trialLogin()).json.token;
  assert.equal((await w.pdf(token)).status, 200);
  assert.equal((await w.pdf(token)).status, 200);
  const capped = await w.pdf(token);
  assert.equal(capped.status, 429);
  assert.equal(capped.json.error.code, 'TRIAL_LIMIT');
  w.clock.t += DAY;
  assert.equal((await w.pdf(token)).status, 200, 'the cap is per day');
});

test('trial AI: limited total, blocked at zero, owner reset, no top-up', async () => {
  const w = makeWorld({ COMMERCIAL_TRIAL_AI_TOTAL: '3' });
  await w.createTrial();
  const token = (await w.trialLogin()).json.token;
  assert.deepEqual(await w.call('GET', '/api/credits', { token }).then((r) => [r.json.total, r.json.remaining, r.json.commercialTopUp]), [3, 3, null]);
  assert.equal((await w.ai(token, { commercial: false })).status, 403);
  const levels = [];
  for (let i = 0; i < 3; i += 1) levels.push((await w.ai(token)).json.warning?.level ?? null);
  assert.deepEqual(levels, [null, null, 0.8]);
  const zero = await w.ai(token);
  assert.equal(zero.status, 402);
  assert.equal(zero.json.error.commercialTopUp, null);
  const reset = await w.admin('POST', '/settings', { resetAi: true });
  assert.equal(reset.json.ai.remaining, 3);
  assert.equal((await w.ai(token)).status, 200);
  assert.equal((await w.pdf(token)).status, 200, 'PDFs unaffected by the AI total');
});

test('trial login: disable, expiry date and password reset', async () => {
  const w = makeWorld();
  await w.createTrial({ expiresAt: '2026-11-20' });
  let token = (await w.trialLogin()).json.token;
  assert.equal((await w.pdf(token)).status, 200);
  // disable
  assert.equal((await w.admin('POST', '/settings', { disabled: true })).json.disabled, true);
  assert.equal((await w.pdf(token)).status, 403);
  assert.equal((await w.trialLogin()).json.error.code, 'TRIAL_DISABLED');
  assert.equal((await w.admin('POST', '/settings', { disabled: false })).json.disabled, false);
  token = (await w.trialLogin()).json.token;
  assert.equal((await w.pdf(token)).status, 200);
  // expiry: the whole of 20/11/2026 (Sydney) still works, 21/11/2026 does not
  w.clock.t = Date.UTC(2026, 10, 20, 12, 0, 0); // 20/11/2026 23:00 Sydney
  assert.equal((await w.pdf(token)).status, 200);
  w.clock.t = Date.UTC(2026, 10, 20, 14, 0, 0); // 21/11/2026 01:00 Sydney
  const gone = await w.pdf(token);
  assert.equal(gone.status, 403);
  assert.equal(gone.json.error.code, 'TRIAL_EXPIRED');
  assert.equal((await w.trialLogin()).json.error.code, 'TRIAL_EXPIRED');
  // clearing the expiry date brings it back
  assert.equal((await w.admin('POST', '/settings', { expiresAt: null })).json.expiresAt, null);
  assert.equal((await w.pdf(token)).status, 200);
  // a password reset signs out the devices that hold the old login and changes the password
  await w.admin('PUT', '', { username: 'friend2', password: 'Second-Blue-Gum-4412' });
  assert.equal((await w.pdf(token)).status, 401);
  assert.equal((await w.trialLogin('friend', TRIAL_PW)).status, 401);
  assert.equal((await w.trialLogin('friend2', 'Second-Blue-Gum-4412')).status, 200);
});

test('trial login attempts are rate limited per username', async () => {
  const w = makeWorld({ LOGIN_MAX_FAILURES: '3' });
  await w.createTrial();
  for (let i = 0; i < 2; i += 1) assert.equal((await w.trialLogin('friend', `wrong-${i}`)).status, 401);
  const locked = await w.trialLogin('friend', 'wrong-3');
  assert.equal(locked.status, 423);
  assert.equal((await w.trialLogin()).status, 423, 'even the right password waits out the lockout');
  w.clock.t += 16 * 60000;
  assert.equal((await w.trialLogin()).status, 200);
});

test('trial saved projects: only the trial login, cleared after 30 days', async () => {
  const w = makeWorld();
  await w.createTrial();
  const token = (await w.trialLogin()).json.token;
  const sub = await w.subscribe();
  const project = commercialProject({ plain: false });
  const saved = await w.call('POST', '/api/commercial/trial/projects', { token, body: { name: 'Friend design', project } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal((await w.call('GET', '/api/commercial/trial/projects', { token })).json.length, 1);
  assert.equal((await w.call('GET', `/api/commercial/trial/projects/${saved.json.id}`, { token })).json.project.id, project.id);
  assert.equal((await w.call('GET', '/api/commercial/trial/projects', { token: sub })).status, 403, 'a subscriber cannot read the trial projects');
  assert.equal((await w.call('GET', '/api/commercial/trial/projects')).status, 401);
  assert.equal((await w.call('POST', '/api/commercial/trial/projects', { token, body: { project: createProject({ id: 'p_h', name: 'H' }) } })).status, 400);
  w.clock.t += 29 * DAY;
  const t1 = (await w.trialLogin()).json.token; // the sign in lasts 7 days
  assert.equal((await w.call('GET', '/api/commercial/trial/projects', { token: t1 })).json.length, 1);
  w.clock.t += 2 * DAY;
  {
    const t2 = (await w.trialLogin()).json.token;
    assert.equal((await w.call('GET', '/api/commercial/trial/projects', { token: t2 })).json.length, 0);
    assert.equal((await w.call('GET', `/api/commercial/trial/projects/${saved.json.id}`, { token: t2 })).status, 404);
  }
});

test('the password is hashed, never logged and never returned', async () => {
  const logs = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(orig)) console[k] = (...a) => logs.push(a.map(String).join(' '));
  let put;
  try {
    const w = makeWorld();
    put = await w.createTrial();
    await w.trialLogin();
    await w.trialLogin('friend', 'definitely-wrong-password');
    await w.admin('PUT', '', { username: 'friend', password: 'short' }); // refused
    const view = await w.admin('GET', '');
    assert.ok(!JSON.stringify(view.json).includes(TRIAL_PW));
    assert.ok(!JSON.stringify(view.json).includes('pbkdf2'));
    assert.ok(!JSON.stringify(put.json).includes('passwordHash'));
  } finally {
    Object.assign(console, orig);
  }
  assert.ok(!logs.some((l) => l.includes(TRIAL_PW) || l.includes('definitely-wrong-password')), 'no password in any log line');
});

test('the stored trial record holds a PBKDF2 hash, not the password', async () => {
  const { createMemoryPortalStore } = await import('../server/lib/portal-store.js');
  const pstore = createMemoryPortalStore();
  const store = createMemoryStore();
  const app = createApp({ store, portalStore: pstore, env: { SITE_URL: 'https://site.test', ENTITLEMENT_SECRET: 's', ADMIN_TOKEN: ADMIN }, now: () => T0 });
  const res = await app.fetch(new Request('https://api.test/api/commercial/admin/trial', { method: 'PUT', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: JSON.stringify({ username: 'friend', password: TRIAL_PW }) }));
  assert.equal(res.status, 200);
  const raw = await pstore.getSetting('commercial_trial');
  assert.ok(!raw.includes(TRIAL_PW));
  const rec = JSON.parse(raw);
  assert.match(rec.passwordHash, /^pbkdf2-sha256\$/);
  assert.equal((await verifyPassword(TRIAL_PW, rec.passwordHash)).ok, true);
  assert.equal((await verifyPassword('wrong', rec.passwordHash)).ok, false);
});

test('defaults: 150 messages a month, A$15 for 100 more, commercial model is Sonnet 5.5', async () => {
  const w = makeWorld();
  assert.equal(w.app.config.commercialAiMonthly, 150);
  assert.equal(w.app.config.commercialAiTopupQty, 100);
  assert.equal(w.app.config.commercialAiTopupPriceAud, 15);
  assert.equal(w.app.config.commercialAiModel, 'claude-sonnet-5-5');
  assert.equal(w.app.config.commercialTrialAiTotal, 50);
  const token = await w.subscribe();
  const c = (await w.call('GET', '/api/credits', { token })).json;
  assert.deepEqual([c.total, c.commercialTopUp.messages, c.commercialTopUp.priceAud], [150, 100, 15]);
});

test('commercial model is used only for commercial accounts in commercial mode; residential keeps the Haiku model', async () => {
  const w = makeWorld({ ANTHROPIC_MODEL: 'claude-haiku-5-5' });
  const sub = await w.subscribe();
  await w.createTrial();
  const trial = (await w.trialLogin()).json.token;
  assert.equal((await w.ai(sub)).status, 200);
  assert.equal((await w.ai(trial)).status, 200);
  assert.deepEqual(w.anthropicBodies.map((b) => b.model), ['claude-sonnet-5-5', 'claude-sonnet-5-5']);
  // a commercial account that does not say commercial is refused, not silently run on another model
  assert.equal((await w.ai(sub, { commercial: false })).status, 403);
  assert.equal(w.anthropicBodies.length, 2);
  // a residential Plan Pack that claims commercial still runs on the residential model
  await w.store.createEntitlement({ id: 'ent_pack1', projectId: 'p_house1', email: 'h@example.com', stripeSessionId: 'cs_pack_000001', amountCents: 3000, currency: 'aud', creditsTotal: 50, status: 'active', createdAt: new Date(T0).toISOString(), expiresAt: new Date(T0 + 300 * DAY).toISOString() });
  const pack = await signToken({ eid: 'ent_pack1', pid: 'p_house1', exp: Math.floor((T0 + 300 * DAY) / 1000) }, 'unit-secret');
  assert.equal((await w.ai(pack)).status, 200);
  assert.equal(w.anthropicBodies.at(-1).model, 'claude-haiku-5-5');
  // a token for no account gets nothing
  assert.equal((await w.ai('not.a-token')).status, 401);
});

test('per-message token usage is recorded per account and shown to the owner with its cost', async () => {
  const w = makeWorld();
  const sub = await w.subscribe();
  await w.createTrial();
  const trial = (await w.trialLogin()).json.token;
  await w.ai(sub);
  await w.ai(sub);
  await w.ai(trial);
  assert.equal((await w.call('GET', '/api/commercial/admin/usage')).status, 401);
  assert.equal((await w.call('GET', '/api/commercial/admin/usage', { token: sub })).status, 401);
  const r = await w.call('GET', '/api/commercial/admin/usage', { token: ADMIN });
  assert.equal(r.status, 200);
  assert.equal(r.json.model, 'claude-sonnet-5-5');
  const [m] = r.json.months;
  assert.equal(m.month, '2026-11');
  const subRow = m.accounts.find((a) => a.kind === 'subscription');
  assert.equal(subRow.messages, 2);
  assert.equal(subRow.cacheWrite, 2000);
  assert.deepEqual([subRow.input, subRow.cacheRead, subRow.output], [10400, 11600, 360]);
  // 2 x (5200 in x $2 + 5800 cache read x $0.10 + 180 out x $10) per million tokens, cache write at $2.50
  const one = (5200 * 2 + 1000 * 2.5 + 5800 * 0.1 + 180 * 10) / 1e6;
  assert.ok(Math.abs(subRow.costUsd - 2 * one) < 1e-6, String(subRow.costUsd));
  assert.equal(subRow.email, 'dev@example.com');
  assert.equal(m.accounts.find((a) => a.kind === 'trial').messages, 1);
  assert.equal(m.totals.messages, 3);
});
