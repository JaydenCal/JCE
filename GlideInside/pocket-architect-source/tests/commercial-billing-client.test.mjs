// Client side of commercial billing: the API methods, the message based meter, warnings and the zero balance state, and the Stripe return flow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/premium/api.js';
import { createAdminApi } from '../src/portal/admin-api.js';
import { normaliseCredits, meterText, resetText, warningText, exhaustedText, isExhausted, canBuyMessages, buyMessagesLabel, topUpOfferText, canTopUp } from '../src/premium/credits.js';
import { createCommercialBilling, GATE_LINE } from '../src/premium/ui/commercial-billing.js';
import { isAuthLoss } from '../src/premium/messages.js';

globalThis.window = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, location: { hostname: 'localhost' } };

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const recorder = (replies = []) => {
  const calls = [];
  return { calls, fetchImpl: async (url, init = {}) => { calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined }); return replies.shift() ?? json({}); } };
};

test('the gate line is the one the owner asked for', () => {
  assert.equal(GATE_LINE, 'Commercial Developer, A$50 per month, unlimited plan sets');
});

test('api client: commercial endpoints, bearer tokens and the pending state', async () => {
  const r = recorder([json({ url: 'https://checkout.stripe.com/x' }), json({ error: { code: 'NOT_ENTITLED', message: 'later', pending: true } }, 404), json({ token: 't', subscription: {} }), json({ account: {} }), json({ url: 'https://billing.stripe.com/x' }), json({ url: 'https://checkout.stripe.com/y' }), json({ credits: {} }), json({ token: 'tt', account: {} })]);
  const api = createApi({ base: '/api', fetchImpl: r.fetchImpl });
  assert.equal((await api.commercialSubscribe('a@b.co')).url, 'https://checkout.stripe.com/x');
  assert.deepEqual(await api.commercialSubscription('cs_test_123456'), { pending: true });
  assert.equal((await api.commercialSubscription('cs_test_123456')).token, 't');
  await api.commercialAccount('tok');
  await api.commercialPortal('tok');
  await api.commercialAiTopup('tok');
  await api.commercialAiTopupConfirm('tok', 'cs_x');
  await api.commercialTrialLogin({ username: 'friend', password: 'pw' });
  assert.deepEqual(r.calls.map((c) => `${c.method} ${new URL(c.url, 'https://x.test').pathname}`), [
    'POST /api/commercial/subscribe', 'GET /api/commercial/subscription', 'GET /api/commercial/subscription', 'GET /api/commercial/account',
    'POST /api/commercial/billing-portal', 'POST /api/commercial/ai-topup', 'GET /api/commercial/ai-topup', 'POST /api/commercial/trial/login']);
  assert.equal(r.calls[3].headers.authorization, 'Bearer tok');
  assert.equal(r.calls[0].headers.authorization, undefined);
});

test('admin api: the commercial trial calls go to /commercial/admin with the admin token', async () => {
  const r = recorder([json({ exists: false }), json({ exists: true }), json({ exists: true }), json({ months: [] })]);
  const api = createAdminApi({ token: 'adm', base: '/api', fetchImpl: r.fetchImpl });
  await api.commercialTrial();
  await api.saveCommercialTrial({ username: 'friend', password: 'Gum-tree-Wattle-7731', expiresAt: '2026-12-01' });
  await api.commercialTrialSettings({ resetAi: true });
  await api.commercialUsage();
  assert.deepEqual(r.calls.map((c) => `${c.method} ${c.url}`), ['GET /api/commercial/admin/trial', 'PUT /api/commercial/admin/trial', 'POST /api/commercial/admin/trial/settings', 'GET /api/commercial/admin/usage']);
  assert.ok(r.calls.every((c) => c.headers.authorization === 'Bearer adm'));
});

const sub = (over = {}) => normaliseCredits({ commercial: true, kind: 'commercial', total: 150, used: 0, remaining: 150, topUpRemaining: 0, renewsOn: '2026-12-15T00:00:00.000Z', commercialTopUp: { allowed: true, available: true, messages: 100, priceAud: 15 }, ...over });

test('meter counts AI messages, shows renewal as DD/MM/YYYY and the A$15 for 100 offer', () => {
  const c = sub({ used: 30, remaining: 120, topUpRemaining: 100 });
  assert.equal(meterText(c), '120 of 150 AI messages left plus 100 extra');
  assert.equal(resetText(c), 'Your allowance renews on 15/12/2026.');
  assert.equal(topUpOfferText(c), 'A$15 for 100 more AI messages');
  assert.equal(buyMessagesLabel(c), 'Buy more AI messages');
  assert.equal(canBuyMessages(c), true);
  assert.equal(canTopUp(c), false, 'the portal top-up path is not used for commercial accounts');
});

test('Buy more reads Coming soon when the owner has not set the Stripe price, and the trial cannot buy', () => {
  const c = sub({ commercialTopUp: { allowed: true, available: false, messages: 100, priceAud: 15 } });
  assert.equal(buyMessagesLabel(c), 'Buy more AI messages, coming soon');
  const trial = normaliseCredits({ commercial: true, trial: true, total: 50, used: 5, remaining: 45, commercialTopUp: null });
  assert.equal(canBuyMessages(trial), false);
  assert.equal(meterText(trial), '45 of 50 trial AI messages left');
});

test('warning at 80 percent and the zero balance state', () => {
  const c = sub({ used: 120, remaining: 30, warnLevel: 0.8 });
  assert.match(warningText({ level: 0.8, remaining: 30, usedPercent: 80 }, c), /used 80% of your AI messages\. 30 messages left until your allowance renews on 15\/12\/2026/);
  assert.equal(isExhausted(c), false);
  const zero = sub({ used: 150, remaining: 0 });
  assert.equal(isExhausted(zero), true);
  assert.match(exhaustedText(zero), /Buy more AI messages/);
  assert.equal(isExhausted(sub({ used: 150, remaining: 0, topUpRemaining: 40 })), false, 'extra messages keep the assistant open');
  const trialZero = normaliseCredits({ commercial: true, trial: true, total: 50, used: 50, remaining: 0 });
  assert.match(exhaustedText(trialZero), /trial/);
  assert.doesNotMatch(exhaustedText(trialZero), /Buy more/);
});

test('trial disabled or expired counts as losing the sign in', () => {
  assert.equal(isAuthLoss({ code: 'TRIAL_EXPIRED' }), true);
  assert.equal(isAuthLoss({ code: 'TRIAL_DISABLED' }), true);
  assert.equal(isAuthLoss({ code: 'TRIAL_LIMIT' }), false);
});

function billing({ api, csub = null, sleeps = [] }) {
  const state = { csub, notes: [], refreshed: 0, navigated: [] };
  const ui = createCommercialBilling({
    layer: { notify: (t, k) => state.notes.push([k, t]) }, api, store: {}, config: {},
    getCsub: () => state.csub, setCsub: (v) => { state.csub = v; }, clearCsub: () => { state.csub = null; },
    refreshCredits: async () => { state.refreshed += 1; }, navigate: (u) => state.navigated.push(u), sleep: async (ms) => sleeps.push(ms), timing: { intervalMs: 10, timeoutMs: 50 },
  });
  return { ui, state };
}

test('return from Stripe: waits for the webhook, then keeps the subscription token', async () => {
  let n = 0;
  const api = { commercialSubscription: async () => (++n < 3 ? { pending: true } : { token: 'sub-token', subscription: {} }) };
  const { ui, state } = billing({ api });
  const res = await ui.handleReturn({ status: 'success', sessionId: 'cs_x' });
  assert.equal(res.token, 'sub-token');
  assert.deepEqual(state.csub, { token: 'sub-token', kind: 'subscription' });
  assert.equal(state.refreshed, 1);
  assert.equal(n, 3);
});

test('return from Stripe: a top-up is confirmed and the meter refreshed; cancel changes nothing', async () => {
  const api = { commercialAiTopupConfirm: async (t, id) => ({ credits: { total: 150 }, t, id }) };
  const { ui, state } = billing({ api, csub: { token: 'sub-token', kind: 'subscription' } });
  assert.ok(await ui.handleReturn({ status: 'topup', sessionId: 'cs_t' }));
  assert.equal(state.refreshed, 1);
  const c = billing({ api });
  assert.equal(await c.ui.handleReturn({ status: 'cancel' }), null);
  assert.equal(c.state.csub, null);
  assert.match(c.state.notes[0][1], /not been charged/);
});

test('return from Stripe: gives up with a message when the payment never confirms', async () => {
  const { ui, state } = billing({ api: { commercialSubscription: async () => ({ pending: true }) } });
  assert.equal(await ui.handleReturn({ status: 'success', sessionId: 'cs_x' }), null);
  assert.equal(state.csub, null);
  assert.match(state.notes.at(-1)[1], /not been confirmed yet/);
});
