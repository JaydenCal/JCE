// Back end tests: docs/SCOPE.md section 16 tests 7, 8, 10 and 11 to 15, plus store and request checks.
// In-memory store (and a D1 shim over node:sqlite), a fake fetch for Stripe and Anthropic with realistic
// usage numbers, signed webhook payloads and a controllable clock.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../server/lib/app.js';
import { createMemoryStore, createD1Store } from '../server/lib/store.js';
import { createFileStore } from '../server/lib/store-file.js';
import { createUpstashStore } from '../server/lib/store-upstash.js';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { hmacSha256, signToken } from '../server/lib/entitlement.js';
import { costMicros, creditsForCost, warnLevel, crossedThreshold } from '../server/lib/credits.js';
import { readConfig } from '../server/lib/config.js';
import { createProject } from '../src/model/schema.js';
import { applyOp } from '../src/model/ops.js';
import { createStore } from '../src/model/store.js';
import { compactContext } from '../src/premium/ai/context.js';

let hasSqlite = true;
let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  hasSqlite = false;
}

const T0 = Date.UTC(2026, 8, 14, 3, 0, 0); // 14/09/2026 03:00 UTC
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Usage numbers as the API reports them. Warm cache: 1 credit. Cold cache with a longer reply: 2 credits.
const WARM = { input_tokens: 5200, output_tokens: 180, cache_creation_input_tokens: 0, cache_read_input_tokens: 5800 }; // 668 micro-USD
const COLD = { input_tokens: 5200, output_tokens: 1000, cache_creation_input_tokens: 5800, cache_read_input_tokens: 0 }; // 1745 micro-USD
const ROOF_CALL = { type: 'tool_use', id: 'toolu_1', name: 'set_finish', input: { target: 'roof', colour: 'steel-charcoal' } };
const anthropicOk = (content, usage = WARM) => jsonRes({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content, stop_reason: 'tool_use', usage });

function makeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({
    bind: (...a) => statement(sql, a),
    run: async () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
  });
  return { prepare: (sql) => statement(sql) };
}

function makeWorld(envOverrides = {}, { store = createMemoryStore(), catalogue = null } = {}) {
  const clock = { t: T0 };
  const calls = { stripe: [], anthropic: [] };
  const world = {
    clock,
    calls,
    store,
    stripeSessions: new Map(),
    anthropic: () => anthropicOk([{ type: 'text', text: 'Done.' }, ROOF_CALL]),
  };
  let n = 0;
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.stripe.com/v1/checkout/sessions')) {
      if ((init.method || 'GET') === 'POST') {
        n += 1;
        calls.stripe.push({ url: u, headers: init.headers, form: new URLSearchParams(init.body) });
        return jsonRes({ id: `cs_test_${n}`, url: `https://checkout.stripe.com/c/pay/cs_test_${n}` });
      }
      const s = world.stripeSessions.get(decodeURIComponent(u.split('/').pop()));
      return s ? jsonRes(s) : jsonRes({ error: { type: 'invalid_request_error' } }, 404);
    }
    if (u === 'https://api.anthropic.com/v1/messages') {
      const body = JSON.parse(init.body);
      calls.anthropic.push({ headers: init.headers, body });
      return world.anthropic(body, calls.anthropic.length);
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  const env = {
    SITE_URL: 'https://site.test',
    ENTITLEMENT_SECRET: 'unit-test-secret',
    STRIPE_SECRET_KEY: 'sk_test_123',
    STRIPE_WEBHOOK_SECRET: 'whsec_unit',
    ANTHROPIC_API_KEY: 'sk-ant-unit',
    ...envOverrides,
  };
  world.app = createApp({ store, env, fetchImpl, now: () => clock.t, catalogue, devGrant: !!envOverrides.__devGrant, loadJsPDF: async () => (await import('jspdf')).jsPDF });
  world.config = world.app.config;

  world.call = async (method, path, { token, body, raw, headers = {} } = {}) => {
    const init = { method, headers: { ...headers } };
    if (token) init.headers.authorization = `Bearer ${token}`;
    if (raw !== undefined) init.body = raw;
    else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers['content-type'] = 'application/json';
    }
    const res = await world.app.fetch(new Request(`https://api.test${path}`, init));
    const type = res.headers.get('content-type') || '';
    return { res, status: res.status, json: type.includes('json') ? await res.clone().json() : null };
  };
  world.webhook = async (event, { secret = 'whsec_unit', t = Math.floor(clock.t / 1000), signature } = {}) => {
    const rawBody = JSON.stringify(event);
    const sig = signature ?? hex(await hmacSha256(secret, `${t}.${rawBody}`));
    return world.call('POST', '/api/stripe/webhook', { raw: rawBody, headers: { 'stripe-signature': `t=${t},v1=${sig}`, 'content-type': 'application/json' } });
  };
  world.buy = async ({ projectId = 'p_test1', sessionId = 'cs_test_paid1', email = 'buyer@example.com', pi = 'pi_paid1' } = {}) => {
    const hook = await world.webhook(completedEvent(sessionId, projectId, { email, pi }));
    assert.equal(hook.status, 200);
    const got = await world.call('GET', `/api/entitlement?session_id=${sessionId}&project=${projectId}`);
    assert.equal(got.status, 200, JSON.stringify(got.json));
    return { token: got.json.token, body: got.json, projectId, sessionId, email, pi };
  };
  world.edit = (token, extra = {}) =>
    world.call('POST', '/api/ai/edit', { token, body: { message: 'Make the roof dark grey', context: 'PROJECT "T" type=house units=mm\nLEVEL l_1 "Ground" active', history: [], activeLevelId: 'l_1', ...extra } });
  return world;
}

const completedEvent = (sessionId, projectId, { email = 'buyer@example.com', pi = 'pi_paid1', paid = 'paid', id = `evt_${sessionId}` } = {}) => ({
  id,
  type: 'checkout.session.completed',
  data: { object: { id: sessionId, object: 'checkout.session', payment_status: paid, client_reference_id: projectId, metadata: { projectId }, amount_total: 3000, currency: 'aud', customer_details: { email }, payment_intent: pi } },
});
const refundEvent = (pi, id = 'evt_refund_1') => ({ id, type: 'charge.refunded', data: { object: { id: 'ch_1', object: 'charge', payment_intent: pi, refunded: true, amount: 3000, amount_refunded: 3000 } } });

function sampleProject(id) {
  const p = createProject({ id, name: 'Smith residence' });
  applyOp(p, 'add_room', { type: 'living', name: 'Living', x: 0, y: 0, width: 6000, depth: 4500 });
  applyOp(p, 'add_opening', { kind: 'window', x: 3000, y: 0 });
  return p;
}

// Configuration -------------------------------------------------------------------------------------
test('config reads every SCOPE 11.6 variable with its default', () => {
  const c = readConfig({});
  assert.equal(c.anthropicModel, 'claude-haiku-5-5');
  assert.equal(c.priceInPerMtok, 0.1);
  assert.equal(c.priceOutPerMtok, 0.5);
  assert.equal(c.maxOutputTokens, 1500);
  assert.equal(c.maxContextTokens, 40000);
  assert.equal(c.creditUsd, 0.001);
  assert.equal(c.planPackCredits, 500);
  assert.deepEqual(c.warnThresholds, [0.5, 0.8, 0.95]);
  assert.equal(c.largeRequestCredits, 10);
  assert.equal(c.ratePerMin, 6);
  assert.equal(c.ratePerDay, 150);
  assert.equal(c.dailyCapUsd, 5);
  assert.equal(c.monthlyCapUsd, 50);
  assert.equal(c.fxAudPerUsd, 1.67);
  assert.equal(c.planPackPriceCents, 3000);
  assert.equal(c.entitlementDays, 365);
  assert.equal(c.exportMaxProjectBytes, 2000000);
  assert.equal(readConfig({ SITE_URL: 'https://a.test/' }).appUrl, 'https://a.test/floor-plan-designer/app/');
  assert.equal(readConfig({ PLAN_PACK_CREDITS: '20', WARN_THRESHOLDS: '0.9, 0.5' }).planPackCredits, 20);
  assert.deepEqual(readConfig({ WARN_THRESHOLDS: '0.9, 0.5' }).warnThresholds, [0.5, 0.9]);
});

test('credit arithmetic follows SCOPE 7.4', () => {
  const c = readConfig({});
  // Typical edit from the brief: 6,000 cached + 5,000 context + 500 message + 1,000 output = US$0.00111, 2 credits.
  const typical = costMicros({ input_tokens: 5500, output_tokens: 1000, cache_read_input_tokens: 6000 }, c);
  assert.ok(Math.abs(typical - 1110) < 1e-6, `typical ${typical}`);
  assert.equal(creditsForCost(typical, c), 2);
  assert.equal(creditsForCost(0, c), 1, 'never less than one credit');
  assert.equal(creditsForCost(1000, c), 1, 'exactly one credit does not round up');
  assert.equal(creditsForCost(1000.5, c), 2);
  assert.equal(costMicros(WARM, c), 668);
  assert.equal(costMicros(COLD, c), 1745);
  assert.equal(warnLevel(10, 20, c.warnThresholds), 0.5);
  assert.equal(warnLevel(9, 20, c.warnThresholds), 0);
  assert.equal(crossedThreshold(8, 10, 20, c.warnThresholds), 0.5);
  assert.equal(crossedThreshold(10, 12, 20, c.warnThresholds), null);
  assert.equal(crossedThreshold(14, 20, 20, c.warnThresholds), 0.95, 'reports the highest threshold crossed');
});

// Test 7: locked exports ----------------------------------------------------------------------------
test('7. export endpoints return NOT_ENTITLED without a valid token', async () => {
  const w = makeWorld();
  const body = { project: sampleProject('p_test1') };
  for (const type of ['pdf', 'dxf', 'glb', 'obj']) {
    const none = await w.call('POST', `/api/export/${type}`, { body });
    assert.equal(none.status, 403);
    assert.equal(none.json.error.code, 'NOT_ENTITLED');
    assert.equal(none.json.code, 'NOT_ENTITLED');
  }
  const junk = await w.call('POST', '/api/export/dxf', { token: 'not.a.token', body });
  assert.equal(junk.json.error.code, 'NOT_ENTITLED');
  const forged = await signToken({ eid: 'ent_x', pid: 'p_test1', exp: Math.floor(T0 / 1000) + 9999 }, 'some-other-secret');
  assert.equal((await w.call('POST', '/api/export/dxf', { token: forged, body })).json.error.code, 'NOT_ENTITLED');
  // A correctly signed token for an entitlement that does not exist grants nothing: the database decides.
  const orphan = await signToken({ eid: 'ent_missing', pid: 'p_test1', exp: Math.floor(T0 / 1000) + 9999 }, 'unit-test-secret');
  assert.equal((await w.call('POST', '/api/export/dxf', { token: orphan, body })).json.error.code, 'NOT_ENTITLED');
  assert.equal((await w.call('GET', '/api/credits?project=p_test1')).json.error.code, 'UNAUTHORISED');
  assert.equal((await w.call('POST', '/api/ai/edit', { body: { message: 'x', context: 'y' } })).json.error.code, 'UNAUTHORISED');
});

test('7. an expired token is refused even with a live entitlement', async () => {
  const w = makeWorld();
  const { token } = await w.buy();
  const ok = await w.call('POST', '/api/export/dxf', { token, body: { project: sampleProject('p_test1') } });
  assert.equal(ok.status, 200);
  w.clock.t += 366 * 86400000;
  const late = await w.call('POST', '/api/export/dxf', { token, body: { project: sampleProject('p_test1') } });
  assert.equal(late.status, 403);
  assert.equal(late.json.error.code, 'NOT_ENTITLED');
});

// Test 8: Stripe flow -------------------------------------------------------------------------------
test('8. checkout creates a Stripe session with the A$30 Plan Pack for the project', async () => {
  const w = makeWorld({ APP_URL: 'https://site.test/floor-plan-designer/app/' });
  const r = await w.call('POST', '/api/checkout', { body: { projectId: 'p_abc123', projectName: 'Smith residence' } });
  assert.equal(r.status, 200);
  assert.match(r.json.url, /^https:\/\/checkout\.stripe\.com\//);
  const call = w.calls.stripe[0];
  assert.equal(call.url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(call.headers.authorization, 'Bearer sk_test_123');
  assert.equal(call.headers['content-type'], 'application/x-www-form-urlencoded');
  const f = call.form;
  assert.equal(f.get('mode'), 'payment');
  assert.equal(f.get('currency'), 'aud');
  assert.equal(f.get('client_reference_id'), 'p_abc123');
  assert.equal(f.get('metadata[projectId]'), 'p_abc123');
  assert.equal(f.get('line_items[0][price_data][currency]'), 'aud');
  assert.equal(f.get('line_items[0][price_data][unit_amount]'), '3000');
  assert.equal(f.get('line_items[0][quantity]'), '1');
  assert.equal(f.get('success_url'), 'https://site.test/floor-plan-designer/app/?checkout=success&session_id={CHECKOUT_SESSION_ID}&project=p_abc123');
  assert.equal(f.get('cancel_url'), 'https://site.test/floor-plan-designer/app/?checkout=cancel');
  assert.equal(f.get('line_items[0][price]'), null);
  // A configured price id replaces the inline price.
  const w2 = makeWorld({ STRIPE_PRICE_ID: 'price_planpack' });
  await w2.call('POST', '/api/checkout', { body: { projectId: 'p_abc123' } });
  assert.equal(w2.calls.stripe[0].form.get('line_items[0][price]'), 'price_planpack');
  assert.equal(w2.calls.stripe[0].form.get('line_items[0][price_data][unit_amount]'), null);
  assert.equal((await w.call('POST', '/api/checkout', { body: { projectId: 'bad id!' } })).status, 400);
  assert.equal((await makeWorld({ STRIPE_SECRET_KEY: '' }).call('POST', '/api/checkout', { body: { projectId: 'p_1' } })).json.error.code, 'PAYMENTS_UNAVAILABLE');
});

test('8. a paid webhook creates one entitlement, a repeat does not, a refund ends it', async () => {
  const w = makeWorld({ PLAN_PACK_CREDITS: '500' });
  const { token, body, projectId } = await w.buy();
  assert.equal(body.credits.total, 500);
  assert.equal(body.credits.remaining, 500);
  assert.equal(body.projectId, projectId);
  const ents = [...w.store._ents.values()];
  assert.equal(ents.length, 1);
  assert.equal(ents[0].stripePaymentIntent, 'pi_paid1');
  assert.equal(ents[0].email, 'buyer@example.com');
  assert.equal(ents[0].amountCents, 3000);

  const repeat = await w.webhook(completedEvent('cs_test_paid1', projectId));
  assert.equal(repeat.status, 200);
  assert.equal(repeat.json.duplicate, true);
  // Same payment under a new event id still maps to the one session: no second entitlement.
  const resent = await w.webhook(completedEvent('cs_test_paid1', projectId, { id: 'evt_other_id' }));
  assert.equal(resent.status, 200);
  assert.equal(w.store._ents.size, 1);

  // Exports work, then stop after the refund.
  const project = sampleProject(projectId);
  assert.equal((await w.call('POST', '/api/export/dxf', { token, body: { project } })).status, 200);
  const refund = await w.webhook(refundEvent('pi_paid1'));
  assert.equal(refund.status, 200);
  assert.equal(ents[0].status, 'refunded');
  const after = await w.call('POST', '/api/export/dxf', { token, body: { project } });
  assert.equal(after.status, 403);
  assert.equal(after.json.error.code, 'NOT_ENTITLED');
  assert.equal((await w.edit(token)).json.error.code, 'NOT_ENTITLED', 'AI stops too');
  assert.equal((await w.call('GET', `/api/entitlement?session_id=cs_test_paid1&project=${projectId}`)).status, 403);
});

test('8. unpaid sessions, bad signatures and stale timestamps create nothing', async () => {
  const w = makeWorld();
  assert.equal((await w.webhook(completedEvent('cs_unpaid', 'p_1', { paid: 'unpaid' }))).status, 200);
  assert.equal(w.store._ents.size, 0);
  const bad = await w.webhook(completedEvent('cs_a', 'p_1'), { signature: 'deadbeef' });
  assert.equal(bad.status, 400);
  const wrongSecret = await w.webhook(completedEvent('cs_a', 'p_1'), { secret: 'whsec_other' });
  assert.equal(wrongSecret.status, 400);
  const stale = await w.webhook(completedEvent('cs_a', 'p_1'), { t: Math.floor(T0 / 1000) - 301 });
  assert.equal(stale.status, 400);
  const edge = await w.webhook(completedEvent('cs_edge', 'p_1'), { t: Math.floor(T0 / 1000) - 299 });
  assert.equal(edge.status, 200, 'inside the 300 s tolerance');
  assert.equal(w.store._ents.size, 1);
  const noHeader = await w.call('POST', '/api/stripe/webhook', { raw: '{}' });
  assert.equal(noHeader.status, 400);
  // Tampered body with a signature computed for the original.
  const t = Math.floor(T0 / 1000);
  const original = JSON.stringify(completedEvent('cs_t', 'p_1'));
  const sig = hex(await hmacSha256('whsec_unit', `${t}.${original}`));
  const tampered = await w.call('POST', '/api/stripe/webhook', { raw: original.replace('p_1', 'p_2'), headers: { 'stripe-signature': `t=${t},v1=${sig}` } });
  assert.equal(tampered.status, 400);
  // A partial refund keeps access.
  const { token, pi } = await w.buy({ projectId: 'p_9', sessionId: 'cs_9', pi: 'pi_9' });
  await w.webhook({ id: 'evt_partial', type: 'charge.refunded', data: { object: { payment_intent: pi, refunded: false, amount: 3000, amount_refunded: 500 } } });
  assert.equal((await w.call('GET', '/api/credits?project=p_9', { token })).status, 200);
});

test('8. GET /api/entitlement waits for the webhook, then returns a token (and can ask Stripe directly)', async () => {
  const w = makeWorld();
  const pending = await w.call('GET', '/api/entitlement?session_id=cs_late&project=p_1');
  assert.equal(pending.status, 404);
  assert.equal(pending.json.pending, true);
  // Webhook slower than the return: Stripe says the session is paid, so the entitlement is created once.
  w.stripeSessions.set('cs_late', { id: 'cs_late', payment_status: 'paid', client_reference_id: 'p_1', metadata: { projectId: 'p_1' }, amount_total: 3000, currency: 'aud', customer_details: { email: 'late@example.com' }, payment_intent: 'pi_late' });
  const got = await w.call('GET', '/api/entitlement?session_id=cs_late&project=p_1');
  assert.equal(got.status, 200);
  assert.ok(got.json.token);
  assert.equal(w.store._ents.size, 1);
  const hook = await w.webhook(completedEvent('cs_late', 'p_1', { pi: 'pi_late' }));
  assert.equal(hook.status, 200);
  assert.equal(w.store._ents.size, 1, 'the late webhook does not duplicate it');
  const other = await w.call('GET', '/api/entitlement?session_id=cs_late&project=p_other');
  assert.equal(other.status, 403, 'a session cannot unlock a different project');
  assert.equal((await w.call('GET', '/api/entitlement?project=p_1')).status, 400);
});

// Test 10: restore purchase ---------------------------------------------------------------------------
test('10. restore purchase returns access with email and session id, and is rate limited', async () => {
  const w = makeWorld();
  const first = await w.buy({ projectId: 'p_77', sessionId: 'cs_test_77', email: 'Buyer@Example.com', pi: 'pi_test_77' });
  for (const ref of ['cs_test_77', 'pi_test_77', first.body.receipt]) {
    const r = await w.call('POST', '/api/entitlement/restore', { body: { email: 'buyer@example.com', sessionOrReceipt: ref } });
    assert.equal(r.status, 200, `restore with ${ref}`);
    assert.equal(r.json.projectId, 'p_77');
    const credits = await w.call('GET', '/api/credits?project=p_77', { token: r.json.token });
    assert.equal(credits.status, 200, 'the restored token works on a second browser');
  }
  const wrong = await w.call('POST', '/api/entitlement/restore', { body: { email: 'other@example.com', sessionOrReceipt: 'cs_test_77' } });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.json.error.code, 'NOT_ENTITLED');
  assert.equal((await w.call('POST', '/api/entitlement/restore', { body: { email: 'not an email', sessionOrReceipt: 'cs_test_77' } })).status, 400);
  let limited = null;
  for (let i = 0; i < 10 && !limited; i++) {
    const r = await w.call('POST', '/api/entitlement/restore', { body: { email: 'buyer@example.com', sessionOrReceipt: `cs_guess_${i}` } });
    if (r.status === 429) limited = r;
  }
  assert.ok(limited, 'guessing is rate limited');
  assert.equal(limited.json.error.code, 'RATE_LIMITED');
  assert.ok(limited.res.headers.get('retry-after'));
});

// Tests 11 to 15: the AI assistant ------------------------------------------------------------------
test('11. "Make the roof dark grey" changes the roof colour as one undo step and charges 1 to 3 credits', async () => {
  const w = makeWorld();
  const { token } = await w.buy();
  const store = createStore(sampleProject('p_test1'));
  store.run('set_finish', { target: 'roof', colour: 'steel-off-white' });
  const context = compactContext(store.project, { activeLevelId: store.ui.activeLevelId });
  const r = await w.edit(token, { context, activeLevelId: store.ui.activeLevelId });
  assert.equal(r.status, 200);
  assert.equal(r.json.reply, 'Done.');
  assert.deepEqual(r.json.ops, [{ op: 'set_finish', args: { target: 'roof', colour: 'steel-charcoal' } }]);
  assert.ok(r.json.credits.charged >= 1 && r.json.credits.charged <= 3, `charged ${r.json.credits.charged}`);
  assert.equal(r.json.credits.charged, 1);
  assert.equal(r.json.credits.remaining, 499);
  assert.equal(r.json.warning, null);
  // The browser applies the operations as one batch.
  const results = store.runBatch('AI: roof colour', r.json.ops.map((o) => ({ op: o.op, args: o.args })));
  assert.deepEqual(results.map((x) => x.ok), [true]);
  assert.equal(store.project.finishes.roof.colour, 'steel-charcoal');
  assert.equal(store.undoLabel(), 'AI: roof colour');
  store.undo();
  assert.equal(store.project.finishes.roof.colour, 'steel-off-white', 'one undo restores the colour');
  // The request is logged with tokens, cost and credits.
  const ent = [...w.store._ents.values()][0];
  const [log] = await w.store.listAiRequests(ent.id);
  assert.equal(log.status, 'ok');
  assert.equal(log.credits, 1);
  assert.equal(log.opsCount, 1);
  assert.equal(log.costUsdMicros, 668);
  assert.equal(log.inputTokens, 5200);
  assert.equal(log.cacheReadTokens, 5800);
  assert.equal(log.model, 'claude-haiku-5-5');
  assert.deepEqual((await w.call('GET', '/api/credits?project=p_test1', { token })).json, { total: 500, used: 1, remaining: 499, warnLevel: 0, reserved: 0 });
  // A cold cache request is charged for the cache write.
  w.anthropic = () => anthropicOk([{ type: 'text', text: 'Done.' }, ROOF_CALL], COLD);
  w.clock.t += 61000;
  assert.equal((await w.edit(token)).json.credits.charged, 2);
});

test('the model request carries the cached system prompt and tools, the context and the last turns', async () => {
  const w = makeWorld();
  const { token } = await w.buy();
  const history = [];
  for (let i = 1; i <= 6; i++) history.push({ role: 'user', content: `request ${i}` }, { role: 'assistant', content: `reply ${i}` });
  const r = await w.edit(token, { history, context: 'PROJECT "T" type=house\nLEVEL l_1 "Ground" active' });
  assert.equal(r.status, 200);
  const { headers, body } = w.calls.anthropic[0];
  assert.equal(headers['x-api-key'], 'sk-ant-unit');
  assert.equal(headers['anthropic-version'], '2023-06-01');
  assert.equal(headers['content-type'], 'application/json');
  assert.equal(body.model, 'claude-haiku-5-5');
  assert.equal(body.max_tokens, 1500);
  assert.deepEqual(body.tool_choice, { type: 'auto' });
  assert.equal(body.system[0].type, 'text');
  assert.deepEqual(body.system[0].cache_control, { type: 'ephemeral' });
  assert.match(body.system[0].text, /tools provided/);
  const { OPS } = await import('../src/model/ops.js');
  assert.deepEqual(body.tools.map((t) => t.name), Object.keys(OPS));
  assert.deepEqual(body.tools.at(-1).cache_control, { type: 'ephemeral' });
  assert.ok(body.tools.slice(0, -1).every((t) => !t.cache_control));
  assert.ok(body.tools.every((t) => t.input_schema?.type === 'object'));
  assert.equal(body.messages[0].role, 'user');
  assert.ok(body.messages.length <= 9, 'at most the last four exchanges plus the new request');
  assert.equal(body.messages.at(-2).content, 'reply 6');
  const last = body.messages.at(-1);
  assert.equal(last.role, 'user');
  assert.match(last.content, /LEVEL l_1 "Ground" active/);
  assert.match(last.content, /Request: Make the roof dark grey/);
  assert.match(last.content, /Active level: l_1/);
  for (let i = 1; i < body.messages.length; i++) assert.notEqual(body.messages[i].role, body.messages[i - 1].role);
});

test('tool calls are checked: unknown names dropped, bad arguments rejected, extras removed', async () => {
  const w = makeWorld();
  const { token } = await w.buy();
  w.anthropic = () => anthropicOk([
    { type: 'text', text: 'Added a study.' },
    { type: 'tool_use', id: 't1', name: 'delete_everything', input: {} },
    { type: 'tool_use', id: 't2', name: 'set_finish', input: { target: 'chimney', colour: 'x' } },
    { type: 'tool_use', id: 't3', name: 'add_room', input: { type: 'study', x: 0, y: 0, width: 3000, depth: '3000', junk: 1 } },
    { type: 'tool_use', id: 't4', name: 'add_room', input: { x: 0 } },
  ]);
  const r = await w.edit(token);
  assert.deepEqual(r.json.ops, [{ op: 'add_room', args: { type: 'study', x: 0, y: 0, width: 3000, depth: 3000 } }]);
  assert.deepEqual(r.json.rejected.map((x) => x.op), ['set_finish', 'add_room']);
  assert.equal(r.json.reply, 'Added a study.');
  // A question with no tool call applies nothing and still costs at least one credit.
  w.anthropic = () => anthropicOk([{ type: 'text', text: 'Which wall do you mean?' }]);
  w.clock.t += 61000;
  const q = await w.edit(token);
  assert.deepEqual(q.json.ops, []);
  assert.equal(q.json.reply, 'Which wall do you mean?');
  assert.ok(q.json.credits.charged >= 1);
});

test('12. warnings arrive at 50%, 80% and 95% of the allowance (PLAN_PACK_CREDITS=20)', async () => {
  const w = makeWorld({ PLAN_PACK_CREDITS: '20' });
  w.anthropic = () => anthropicOk([{ type: 'text', text: 'Done.' }, ROOF_CALL], COLD); // 2 credits each
  const { token } = await w.buy();
  const seen = [];
  for (let i = 0; i < 10; i++) {
    w.clock.t += 61000;
    const r = await w.edit(token);
    assert.equal(r.status, 200, `request ${i + 1}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.credits.charged, 2);
    seen.push(r.json.warning?.level ?? null);
    if (r.json.warning) assert.equal(r.json.warning.usedPercent, Math.round(((i + 1) * 2 / 20) * 100));
  }
  assert.deepEqual(seen, [null, null, null, null, 0.5, null, null, 0.8, null, 0.95]);
  assert.equal((await w.call('GET', '/api/credits?project=p_test1', { token })).json.warnLevel, 0.95);
});

test('13. at the allowance the server refuses AI requests with 402 while exports keep working', async () => {
  const w = makeWorld({ PLAN_PACK_CREDITS: '20' });
  w.anthropic = () => anthropicOk([{ type: 'text', text: 'Done.' }, ROOF_CALL], COLD);
  const { token } = await w.buy();
  for (let i = 0; i < 10; i++) {
    w.clock.t += 61000;
    assert.equal((await w.edit(token)).status, 200);
  }
  const callsBefore = w.calls.anthropic.length;
  w.clock.t += 61000;
  const refused = await w.edit(token);
  assert.equal(refused.status, 402);
  assert.equal(refused.json.error.code, 'CREDITS_EXHAUSTED');
  assert.equal(w.calls.anthropic.length, callsBefore, 'no model call is made');
  const credits = await w.call('GET', '/api/credits?project=p_test1', { token });
  assert.equal(credits.json.remaining, 0);
  assert.equal(credits.json.used, 20);
  const est = await w.call('POST', '/api/ai/estimate', { token, body: { message: 'x', context: 'PROJECT "T"' } });
  assert.equal(est.status, 200);
  assert.equal(est.json.remaining, 0);
  assert.equal((await w.call('POST', '/api/export/dxf', { token, body: { project: sampleProject('p_test1') } })).status, 200);
  // Fewer credits left than the estimate also stops the request.
  const w2 = makeWorld({ PLAN_PACK_CREDITS: '3' });
  w2.anthropic = () => anthropicOk([{ type: 'text', text: 'Done.' }], COLD);
  const buyer = await w2.buy();
  assert.equal((await w2.edit(buyer.token)).status, 200);
  w2.clock.t += 61000;
  const short = await w2.edit(buyer.token);
  assert.equal(short.status, 402);
  assert.equal(short.json.error.code, 'CREDITS_EXHAUSTED');
  assert.match(short.json.error.message, /Only 1 AI credit remains/);
});

test('14. a request estimated above the threshold asks for confirmation first', async () => {
  const w = makeWorld({ LARGE_REQUEST_CREDITS: '2' });
  const { token } = await w.buy();
  const big = 'ROOM r_x "Big" other rect x=0..1000 y=0..1000 area=1.00\n'.repeat(700);
  const est = await w.call('POST', '/api/ai/estimate', { token, body: { message: 'Make the roof dark grey', context: big } });
  assert.equal(est.status, 200);
  assert.ok(est.json.estimatedCredits > 2);
  assert.equal(est.json.requiresConfirm, true);
  assert.equal(est.json.remaining, 500);
  const small = await w.call('POST', '/api/ai/estimate', { token, body: { message: 'Make the roof dark grey', context: 'PROJECT "T" type=house' } });
  assert.equal(small.json.requiresConfirm, false);
  assert.equal(w.calls.anthropic.length, 0, 'estimating makes no model call');
  const refused = await w.edit(token, { context: big });
  assert.equal(refused.status, 409);
  assert.equal(refused.json.error.code, 'CONFIRM_REQUIRED');
  assert.equal(refused.json.estimatedCredits, est.json.estimatedCredits);
  assert.equal(w.calls.anthropic.length, 0);
  const ok = await w.edit(token, { context: big, confirmLarge: true });
  assert.equal(ok.status, 200);
  assert.equal(w.calls.anthropic.length, 1);
  // With the default threshold of 10 credits, a context at the cap is estimated above it once prices are 10 times higher.
  const dear = makeWorld({ PRICE_IN_PER_MTOK_USD: '1', PRICE_OUT_PER_MTOK_USD: '5' });
  const buyer = await dear.buy();
  const e2 = await dear.call('POST', '/api/ai/estimate', { token: buyer.token, body: { message: 'x', context: big } });
  assert.ok(e2.json.estimatedCredits > 10);
  assert.equal(e2.json.requiresConfirm, true);
});

test('15. with a very low daily cap AI pauses for every project (503) and the event is logged', async () => {
  const w = makeWorld({ AI_DAILY_CAP_USD: '0.0005' }); // 500 micro-USD
  const a = await w.buy({ projectId: 'p_a', sessionId: 'cs_a_test', pi: 'pi_a_test' });
  const b = await w.buy({ projectId: 'p_b', sessionId: 'cs_b_test', pi: 'pi_b_test', email: 'b@example.com' });
  assert.equal((await w.call('GET', '/api/health')).json.aiPaused, false);
  assert.equal((await w.edit(a.token)).status, 200, 'the first request costs 668 micro-USD and reaches the cap');
  const paused = await w.edit(b.token);
  assert.equal(paused.status, 503);
  assert.equal(paused.json.error.code, 'AI_PAUSED');
  w.clock.t += 61000;
  assert.equal((await w.edit(a.token)).status, 503, 'the same project is paused too');
  assert.equal(w.calls.anthropic.length, 1, 'no model call while paused');
  const events = await w.store.listEvents('ai_paused');
  assert.equal(events.length, 1, 'logged once for the period');
  assert.equal(events[0].detail.period, 'd:2026-09-14');
  const entB = [...w.store._ents.values()].find((e) => e.projectId === 'p_b');
  assert.equal(entB.creditsUsed, 0, 'credits are untouched');
  assert.equal((await w.store.listAiRequests(entB.id))[0].status, 'ai_paused');
  assert.equal((await w.call('GET', '/api/health')).json.aiPaused, true);
  // The next UTC day starts a new daily period.
  w.clock.t += 86400000;
  assert.equal((await w.call('GET', '/api/health')).json.aiPaused, false);
  assert.equal((await w.edit(b.token)).status, 200);
  // The monthly cap works the same way.
  const m = makeWorld({ AI_MONTHLY_CAP_USD: '0.0005' });
  const buyer = await m.buy();
  assert.equal((await m.edit(buyer.token)).status, 200);
  m.clock.t += 61000;
  const mp = await m.edit(buyer.token);
  assert.equal(mp.status, 503);
  assert.equal((await m.store.listEvents('ai_paused'))[0].detail.period, 'm:2026-09');
});

test('AI requests are rate limited per project per minute and per day', async () => {
  const w = makeWorld({ AI_RATE_PER_MIN: '3', AI_RATE_PER_DAY: '5' });
  const { token } = await w.buy();
  for (let i = 0; i < 3; i++) assert.equal((await w.edit(token)).status, 200);
  const limited = await w.edit(token);
  assert.equal(limited.status, 429);
  assert.equal(limited.json.error.code, 'RATE_LIMITED');
  assert.ok(Number(limited.res.headers.get('retry-after')) > 0);
  assert.equal(w.calls.anthropic.length, 3);
  w.clock.t += 61000;
  assert.equal((await w.edit(token)).status, 200);
  assert.equal((await w.edit(token)).status, 200);
  const day = await w.edit(token);
  assert.equal(day.status, 429);
  assert.match(day.json.error.message, /daily/);
  // Another project has its own allowance.
  const other = await w.buy({ projectId: 'p_other', sessionId: 'cs_other_test', pi: 'pi_other_test', email: 'o@example.com' });
  assert.equal((await w.edit(other.token)).status, 200);
});

test('credits are reserved before the model call, so parallel requests cannot overspend', async () => {
  const w = makeWorld({ PLAN_PACK_CREDITS: '5', AI_RATE_PER_MIN: '50' });
  const { token } = await w.buy();
  let release;
  const gate = new Promise((r) => (release = r));
  w.anthropic = async () => {
    await gate;
    return anthropicOk([{ type: 'text', text: 'ok' }], COLD);
  };
  const pending = Array.from({ length: 5 }, () => w.edit(token));
  await new Promise((r) => setTimeout(r, 30));
  const ent = [...w.store._ents.values()][0];
  assert.ok(ent.creditsReserved >= 2 && ent.creditsReserved <= 5, `reserved ${ent.creditsReserved} while calls are in flight`);
  release();
  const results = await Promise.all(pending);
  const ok = results.filter((r) => r.status === 200);
  assert.equal(ok.length, 2);
  for (const r of results.filter((x) => x.status !== 200)) {
    assert.equal(r.status, 402);
    assert.ok(['INSUFFICIENT_CREDITS', 'CREDITS_EXHAUSTED'].includes(r.json.error.code));
  }
  assert.equal(ent.creditsUsed, 4);
  assert.equal(ent.creditsReserved, 0);
  assert.ok(ent.creditsUsed <= ent.creditsTotal);
});

test('a model failure releases the reservation and charges nothing', async () => {
  const w = makeWorld();
  const { token } = await w.buy();
  w.anthropic = () => jsonRes({ error: { type: 'overloaded_error' } }, 529);
  const r = await w.edit(token);
  assert.equal(r.status, 502);
  assert.equal(r.json.error.code, 'AI_ERROR');
  assert.match(r.json.error.message, /Nothing was charged/);
  const ent = [...w.store._ents.values()][0];
  assert.equal(ent.creditsUsed, 0);
  assert.equal(ent.creditsReserved, 0);
  assert.equal(await w.store.getSpend('d:2026-09-14'), 0);
  assert.equal((await w.store.listAiRequests(ent.id))[0].status, 'error');
  w.anthropic = () => {
    throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
  };
  w.clock.t += 61000;
  const t = await w.edit(token);
  assert.equal(t.status, 504);
  assert.equal(t.json.error.code, 'AI_TIMEOUT');
  assert.equal(ent.creditsReserved, 0);
  // Spend is recorded for successful requests only.
  w.anthropic = () => anthropicOk([{ type: 'text', text: 'ok' }]);
  w.clock.t += 61000;
  await w.edit(token);
  assert.equal(await w.store.getSpend('d:2026-09-14'), 668);
  assert.equal(await w.store.getSpend('m:2026-09'), 668);
});

// Validation, limits and CORS ------------------------------------------------------------------------
test('requests are validated and size limited, and CORS is limited to SITE_URL', async () => {
  const w = makeWorld();
  const { token } = await w.buy();
  assert.equal((await w.call('POST', '/api/checkout', { raw: '{nope' })).json.error.code, 'BAD_REQUEST');
  assert.equal((await w.call('POST', '/api/checkout', { raw: '' })).json.error.code, 'BAD_REQUEST');
  const big = await w.call('POST', '/api/checkout', { body: { projectId: 'p_1', projectName: 'x'.repeat(5000) } });
  assert.equal(big.status, 413);
  assert.equal(big.json.error.code, 'PAYLOAD_TOO_LARGE');
  const huge = await w.edit(token, { context: 'x'.repeat(141000) });
  assert.equal(huge.status, 413);
  assert.equal(huge.json.error.code, 'PAYLOAD_TOO_LARGE');
  assert.equal((await w.edit(token, { message: '' })).json.error.code, 'BAD_REQUEST');
  assert.equal((await w.edit(token, { message: 'x'.repeat(2001) })).json.error.code, 'BAD_REQUEST');
  assert.equal((await w.call('GET', '/api/nope')).status, 404);
  assert.equal((await w.call('GET', '/api/checkout')).status, 405);

  const pre = await w.app.fetch(new Request('https://api.test/api/ai/edit', { method: 'OPTIONS', headers: { origin: 'https://site.test', 'access-control-request-method': 'POST' } }));
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://site.test');
  assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
  const evil = await w.app.fetch(new Request('https://api.test/api/health', { headers: { origin: 'https://evil.test' } }));
  assert.equal(evil.status, 200);
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const good = await w.app.fetch(new Request('https://api.test/api/health', { headers: { origin: 'https://site.test' } }));
  assert.equal(good.headers.get('access-control-allow-origin'), 'https://site.test');
  const err = await w.app.fetch(new Request('https://api.test/api/credits', { headers: { origin: 'https://site.test' } }));
  assert.equal(err.status, 401);
  assert.equal(err.headers.get('access-control-allow-origin'), 'https://site.test', 'errors carry CORS headers too');
});

// Exports on the server ------------------------------------------------------------------------------
test('paid exports build real files for the entitled project only', async () => {
  const w = makeWorld();
  const { token } = await w.buy({ projectId: 'p_exp' });
  const project = sampleProject('p_exp');
  const dxf = await w.call('POST', '/api/export/dxf', { token, body: { project } });
  assert.equal(dxf.status, 200);
  assert.equal(dxf.res.headers.get('content-type'), 'application/dxf');
  assert.equal(dxf.res.headers.get('content-disposition'), 'attachment; filename="smith-residence.dxf"');
  const dxfText = await dxf.res.text();
  assert.ok(dxfText.startsWith('  0\nSECTION\n  2\nHEADER'));
  assert.match(dxfText, /AC1009/);
  const pdf = await w.call('POST', '/api/export/pdf', { token, body: { project } });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.res.headers.get('content-disposition'), 'attachment; filename="smith-residence-plans.pdf"');
  const pdfBytes = Buffer.from(await pdf.res.arrayBuffer());
  assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-');
  const obj = await w.call('POST', '/api/export/obj', { token, body: { project } });
  if (obj.status === 200) {
    assert.equal(obj.res.headers.get('content-disposition'), 'attachment; filename="smith-residence-obj.zip"');
    assert.equal(Buffer.from(await obj.res.arrayBuffer()).subarray(0, 2).toString(), 'PK');
    const glb = await w.call('POST', '/api/export/glb', { token, body: { project } });
    assert.equal(glb.status, 200);
    assert.equal(Buffer.from(await glb.res.arrayBuffer()).subarray(0, 4).toString(), 'glTF');
  } else {
    assert.equal(obj.json.error.code, 'EXPORT_UNAVAILABLE');
    assert.ok(!fs.existsSync(new URL('../src/viewer3d/build.js', import.meta.url)), '3D exports fail only when the 3D builder is missing');
  }
  const exportsLogged = await w.store.listEvents('export');
  assert.ok(exportsLogged.length >= 2);
  // Other projects, broken projects, large projects and unknown types.
  const other = await w.call('POST', '/api/export/dxf', { token, body: { project: sampleProject('p_someone_else') } });
  assert.equal(other.status, 403);
  assert.equal(other.json.error.code, 'NOT_ENTITLED');
  const broken = sampleProject('p_exp');
  broken.levels[0].openings[0].wallId = 'w_missing';
  const bad = await w.call('POST', '/api/export/dxf', { token, body: { project: broken } });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, 'BAD_REQUEST');
  assert.ok(bad.json.details.length >= 1);
  assert.equal((await w.call('POST', '/api/export/dxf', { token, body: {} })).status, 400);
  assert.equal((await w.call('POST', '/api/export/stl', { token, body: { project } })).status, 400);
  const small = makeWorld({ EXPORT_MAX_PROJECT_BYTES: '300' });
  const buyer = await small.buy({ projectId: 'p_exp' });
  const large = await small.call('POST', '/api/export/dxf', { token: buyer.token, body: { project } });
  assert.equal(large.status, 413);
  assert.equal(large.json.error.code, 'PAYLOAD_TOO_LARGE');
});

// Stores ---------------------------------------------------------------------------------------------
// A real redis-server (when installed) behind a fetch that speaks the Upstash REST format, so the Lua scripts really run.
async function startRedis() {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no', '--bind', '127.0.0.1'], { stdio: 'ignore' });
  let spawnFailed = false;
  child.on('error', () => { spawnFailed = true; });
  const socket = await new Promise((resolve) => {
    let tries = 0;
    const attempt = () => {
      if (spawnFailed || tries++ > 150) return resolve(null);
      const sock = net.connect(port, '127.0.0.1');
      sock.once('connect', () => resolve(sock));
      sock.once('error', () => { sock.destroy(); setTimeout(attempt, 100); });
    };
    attempt();
  });
  if (!socket) { child.kill(); return null; }
  let buf = Buffer.alloc(0);
  const waiting = [];
  socket.on('data', (d) => { buf = Buffer.concat([buf, d]); pump(); });
  function parse(at) {
    if (at >= buf.length) return null;
    const lineEnd = buf.indexOf('\r\n', at);
    if (lineEnd < 0) return null;
    const type = String.fromCharCode(buf[at]);
    const line = buf.toString('utf8', at + 1, lineEnd);
    const next = lineEnd + 2;
    if (type === '+') return { value: line, at: next };
    if (type === '-') return { value: new Error(line), at: next };
    if (type === ':') return { value: Number(line), at: next };
    if (type === '$') {
      const len = Number(line);
      if (len < 0) return { value: null, at: next };
      if (buf.length < next + len + 2) return null;
      return { value: buf.toString('utf8', next, next + len), at: next + len + 2 };
    }
    if (type === '*') {
      const n = Number(line);
      if (n < 0) return { value: null, at: next };
      const out = [];
      let cur = next;
      for (let i = 0; i < n; i++) {
        const r = parse(cur);
        if (!r) return null;
        out.push(r.value);
        cur = r.at;
      }
      return { value: out, at: cur };
    }
    throw new Error(`bad RESP ${type}`);
  }
  function pump() {
    for (;;) {
      const r = waiting.length ? parse(0) : null;
      if (!r) return;
      buf = buf.subarray(r.at);
      waiting.shift()(r.value);
    }
  }
  const send = (args) => new Promise((resolve) => {
    waiting.push(resolve);
    socket.write(`*${args.length}\r\n${args.map((a) => `$${Buffer.byteLength(String(a))}\r\n${a}\r\n`).join('')}`);
  });
  const fetchImpl = async (_url, init) => {
    const reply = await send(JSON.parse(init.body));
    return reply instanceof Error ? jsonRes({ error: reply.message }, 400) : jsonRes({ result: reply });
  };
  return { fetchImpl, stop: () => { socket.destroy(); child.kill(); } };
}
const redis = await startRedis();
after(() => redis?.stop());
process.on('exit', () => redis?.stop());

const stores = [['memory', () => createMemoryStore()], ['file', () => createFileStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ps-store-')), 'data', 'plan-studio.json'))]];
if (redis) stores.push(['Upstash (real Redis, Lua)', () => createUpstashStore({ url: 'http://redis.test', token: 't', fetchImpl: redis.fetchImpl })]);
if (hasSqlite) stores.push(['D1 (SQLite shim)', () => createD1Store(makeD1())]);

for (const [name, make] of stores) {
  test(`store contract: ${name}`, async () => {
    const s = make();
    const iso = (ms) => new Date(ms).toISOString();
    const base = { id: 'ent_1', projectId: 'p_1', email: 'A@B.com', stripeSessionId: 'cs_1', stripePaymentIntent: 'pi_1', amountCents: 3000, currency: 'aud', creditsTotal: 10, status: 'active', createdAt: iso(T0), expiresAt: iso(T0 + 86400000) };
    const first = await s.createEntitlement(base);
    assert.equal(first.created, true);
    const dup = await s.createEntitlement({ ...base, id: 'ent_2' });
    assert.equal(dup.created, false);
    assert.equal(dup.entitlement.id, 'ent_1');
    assert.equal((await s.getEntitlement('ent_1')).creditsTotal, 10);
    assert.equal((await s.getEntitlementBySession('cs_1')).id, 'ent_1');
    assert.equal((await s.getEntitlementByPaymentIntent('pi_1')).id, 'ent_1');
    assert.equal((await s.findForRestore('a@b.com', 'cs_1')).id, 'ent_1', 'email match ignores case');
    assert.equal((await s.findForRestore('a@b.com', 'pi_1')).id, 'ent_1');
    assert.equal((await s.findForRestore('a@b.com', 'ent_1')).id, 'ent_1');
    assert.equal(await s.findForRestore('x@y.com', 'cs_1'), null);
    assert.equal(await s.getEntitlement('nope'), null);
    // Reserve, settle, release.
    const now = iso(T0 + 1000);
    assert.equal(await s.reserveCredits('ent_1', 6, now), true);
    assert.equal(await s.reserveCredits('ent_1', 5, now), false, '6 + 5 is over the allowance');
    assert.equal(await s.reserveCredits('ent_1', 4, now), true, 'exactly the allowance');
    assert.equal(await s.reserveCredits('ent_1', 1, now), false);
    await s.settleCredits('ent_1', 6, 3);
    let e = await s.getEntitlement('ent_1');
    assert.deepEqual([e.creditsUsed, e.creditsReserved], [3, 4]);
    await s.releaseCredits('ent_1', 4);
    e = await s.getEntitlement('ent_1');
    assert.deepEqual([e.creditsUsed, e.creditsReserved], [3, 0]);
    assert.equal(await s.reserveCredits('ent_1', 7, now), true);
    await s.settleCredits('ent_1', 7, 9);
    e = await s.getEntitlement('ent_1');
    assert.deepEqual([e.creditsUsed, e.creditsReserved], [10, 0], 'settling is clamped to the allowance');
    assert.equal(await s.reserveCredits('ent_1', 1, now), false);
    // Expiry and status.
    await s.createEntitlement({ ...base, id: 'ent_3', stripeSessionId: 'cs_3', stripePaymentIntent: 'pi_3' });
    assert.equal(await s.reserveCredits('ent_3', 1, iso(T0 + 2 * 86400000)), false, 'expired');
    assert.equal(await s.setEntitlementStatus('ent_3', 'refunded'), true);
    assert.equal(await s.reserveCredits('ent_3', 1, now), false, 'refunded');
    assert.equal((await s.getEntitlement('ent_3')).status, 'refunded');
    assert.equal(await s.setEntitlementStatus('missing', 'refunded'), false);
    // Request log, spend, webhook events, rate limits, events.
    await s.logAiRequest({ id: 'req_1', entitlementId: 'ent_1', createdAt: iso(T0), model: 'm', inputTokens: 10, outputTokens: 5, cacheWriteTokens: 1, cacheReadTokens: 2, costUsdMicros: 668.4, credits: 1, opsCount: 2, latencyMs: 120, status: 'ok' });
    const [row] = await s.listAiRequests('ent_1');
    assert.deepEqual([row.inputTokens, row.outputTokens, row.cacheWriteTokens, row.cacheReadTokens, row.costUsdMicros, row.credits, row.opsCount, row.status], [10, 5, 1, 2, 668, 1, 2, 'ok']);
    assert.equal(await s.getSpend('d:2026-09-14'), 0);
    await s.addSpend('d:2026-09-14', 100);
    await s.addSpend('d:2026-09-14', 50.4);
    assert.equal(await s.getSpend('d:2026-09-14'), 150);
    assert.equal(await s.claimWebhookEvent('evt_1', 'x', now), true);
    assert.equal(await s.claimWebhookEvent('evt_1', 'x', now), false);
    await s.releaseWebhookEvent('evt_1');
    assert.equal(await s.claimWebhookEvent('evt_1', 'x', now), true);
    assert.deepEqual([await s.hitRate('k', 60, T0), await s.hitRate('k', 60, T0 + 1000), await s.hitRate('k', 60, T0 + 2000)], [1, 2, 3]);
    assert.equal(await s.hitRate('k', 60, T0 + 61000), 1, 'a new window starts again');
    assert.equal(await s.hitRate('other', 60, T0), 1);
    assert.equal(await s.logEvent({ id: 'ev_1', type: 'ai_paused', detail: { a: 1 }, createdAt: now }), true);
    assert.equal(await s.logEvent({ id: 'ev_1', type: 'ai_paused', detail: { a: 2 }, createdAt: now }), false);
    assert.deepEqual((await s.listEvents('ai_paused')).map((x) => x.detail), [{ a: 1 }]);
  });
}

test('the whole purchase and AI flow works on the D1 store', { skip: !hasSqlite }, async () => {
  const w = makeWorld({ PLAN_PACK_CREDITS: '20' }, { store: createD1Store(makeD1()) });
  w.anthropic = () => anthropicOk([{ type: 'text', text: 'Done.' }, ROOF_CALL], COLD);
  const { token } = await w.buy();
  const levels = [];
  for (let i = 0; i < 10; i++) {
    w.clock.t += 61000;
    const r = await w.edit(token);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    levels.push(r.json.warning?.level ?? null);
  }
  assert.deepEqual(levels, [null, null, null, null, 0.5, null, null, 0.8, null, 0.95]);
  assert.equal((await w.edit(token)).json.error.code, 'CREDITS_EXHAUSTED');
  assert.deepEqual((await w.call('GET', '/api/credits?project=p_test1', { token })).json, { total: 20, used: 20, remaining: 0, warnLevel: 0.95, reserved: 0 });
  const restored = await w.call('POST', '/api/entitlement/restore', { body: { email: 'BUYER@example.com', sessionOrReceipt: 'cs_test_paid1' } });
  assert.equal(restored.status, 200);
  assert.equal((await w.call('POST', '/api/export/dxf', { token: restored.json.token, body: { project: sampleProject('p_test1') } })).status, 200);
  assert.equal((await w.webhook(completedEvent('cs_test_paid1', 'p_test1'))).json.duplicate, true);
  await w.webhook(refundEvent('pi_paid1'));
  assert.equal((await w.call('POST', '/api/export/dxf', { token, body: { project: sampleProject('p_test1') } })).json.error.code, 'NOT_ENTITLED');
  const paused = makeWorld({ AI_DAILY_CAP_USD: '0.0005' }, { store: createD1Store(makeD1()) });
  const buyer = await paused.buy();
  assert.equal((await paused.edit(buyer.token)).status, 200);
  paused.clock.t += 61000;
  assert.equal((await paused.edit(buyer.token)).status, 503);
  assert.equal((await paused.store.listEvents('ai_paused')).length, 1);
});

// Next.js site additions ------------------------------------------------------------------------------
test('without ANTHROPIC_API_KEY the AI endpoints answer 503 "AI not configured"; without Stripe keys checkout answers 503 "Payments not configured"', async () => {
  const w = makeWorld({ ANTHROPIC_API_KEY: '' });
  const { token } = await w.buy();
  const edit = await w.edit(token);
  assert.equal(edit.status, 503);
  assert.equal(edit.json.error.code, 'AI_NOT_CONFIGURED');
  assert.equal(edit.json.error.message, 'AI not configured');
  const est = await w.call('POST', '/api/ai/estimate', { token, body: { message: 'x', context: 'PROJECT "T"' } });
  assert.equal(est.status, 503);
  assert.equal((await w.call('GET', '/api/credits?project=p_test1', { token })).status, 200, 'credits and exports do not need the AI key');
  const pay = await makeWorld({ STRIPE_SECRET_KEY: '' }).call('POST', '/api/checkout', { body: { projectId: 'p_1' } });
  assert.equal(pay.status, 503);
  assert.equal(pay.json.error.message, 'Payments not configured');
});

test('the development grant exists only when the host turns it on, and is idempotent per project', async () => {
  const off = makeWorld({});
  assert.equal((await off.call('GET', '/api/entitlement?dev=1&project=p_dev1')).status, 400, 'falls through to the normal session_id check');
  assert.equal((await off.call('GET', '/api/health')).json.devGrant, undefined);
  const on = makeWorld({ __devGrant: true });
  assert.equal((await on.call('GET', '/api/health')).json.devGrant, true);
  const a = await on.call('GET', '/api/entitlement?dev=1&project=p_dev1');
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(a.json.credits.total, 500);
  assert.equal(a.json.projectId, 'p_dev1');
  const b = await on.call('GET', '/api/entitlement?dev=1&project=p_dev1');
  assert.equal(b.json.receipt, a.json.receipt, 'the same entitlement comes back');
  assert.equal((await on.call('GET', '/api/credits?project=p_dev1', { token: a.json.token })).json.remaining, 500);
  assert.equal((await on.call('GET', '/api/entitlement?dev=1&project=bad%20id')).status, 400);
  const ex = await on.call('POST', '/api/export/dxf', { token: a.json.token, body: { project: sampleProject('p_dev1') } });
  assert.equal(ex.status, 200);
});

test('Upstash store: parallel reservations cannot overspend (Lua)', { skip: !redis }, async () => {
  const s = createUpstashStore({ url: 'http://redis.test', token: 't', fetchImpl: redis.fetchImpl });
  await s.createEntitlement({ id: 'ent_par', projectId: 'p_par', email: 'a@b.com', stripeSessionId: 'cs_par', creditsTotal: 10, status: 'active', createdAt: new Date(T0).toISOString(), expiresAt: new Date(T0 + 86400000).toISOString() });
  const results = await Promise.all(Array.from({ length: 8 }, () => s.reserveCredits('ent_par', 3, new Date(T0).toISOString())));
  assert.equal(results.filter(Boolean).length, 3, '3 x 3 fits in 10, the rest are refused');
  assert.equal((await s.getEntitlement('ent_par')).creditsReserved, 9);
});

test('file store: data survives a new instance and a changed file is re-read', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ps-file-')), 'nested', 'plan-studio.json');
  const a = createFileStore(file);
  await a.createEntitlement({ id: 'ent_f', projectId: 'p_f', email: 'a@b.com', stripeSessionId: 'cs_f', creditsTotal: 10, status: 'active', createdAt: new Date(T0).toISOString(), expiresAt: null });
  assert.equal(await a.reserveCredits('ent_f', 4, new Date(T0).toISOString()), true);
  const b = createFileStore(file);
  assert.equal((await b.getEntitlement('ent_f')).creditsReserved, 4);
  await b.settleCredits('ent_f', 4, 2);
  assert.equal((await a.getEntitlement('ent_f')).creditsUsed, 2, 'the first instance sees the second one\'s write');
  fs.writeFileSync(file, 'not json');
  assert.equal(await createFileStore(file).getEntitlement('ent_f'), null, 'an unreadable file starts empty rather than crashing');
});

test('server exports draw furniture with the catalogue plan symbols (catalogue reaches the exporters)', async () => {
  const { catalogue } = await import('../src/catalogue/index.js');
  const project = catalogue.createFromTemplate('granny_flat');
  project.id = 'p_sym';
  const lines = async (cat) => {
    const w = makeWorld({}, { catalogue: cat });
    const { token } = await w.buy({ projectId: 'p_sym' });
    const dxf = await w.call('POST', '/api/export/dxf', { token, body: { project } });
    assert.equal(dxf.status, 200);
    return (await dxf.res.text()).split('PS-FURN').length;
  };
  const without = await lines(null);
  const withCat = await lines(() => Promise.resolve(catalogue));
  assert.ok(withCat > without * 3, `symbols give many more furniture entities (${withCat} against ${without})`);
});
