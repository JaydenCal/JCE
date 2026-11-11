// Plan Studio API (docs/SCOPE.md 11.2) as Web-standard handlers: Request in, Response out.
//   const app = createApp({ store, env, fetchImpl, now });
//   const response = await app.fetch(request);
// Tests inject an in-memory store, a fake fetch and a clock. No vendor SDKs.

import { CONFIG as SITE_CONFIG } from '../../src/config.js';
import { migrate, validate } from '../../src/model/schema.js';
import { SYSTEM_PROMPT } from '../../src/premium/ai/prompt.js';
import { estimateTokens } from '../../src/premium/ai/context.js';
import { buildTools } from '../../src/premium/ai/tools.js';
import { readConfig } from './config.js';
import { HttpError, json, errorResponse, corsHeaders, readJson, readText, clientIp } from './http.js';
import { authenticate, issueToken, readOrgToken as readOrgTokenRaw } from './entitlement.js';
import * as stripe from './stripe.js';
import * as credits from './credits.js';
import * as anthropic from './anthropic.js';
import { createSite } from './site.js';
import { handleEnquiry } from './enquiry.js';
import { createPortal } from './portal.js';
import { createMemoryPortalStore } from './portal-store.js';

const EXPORT_TYPES = ['pdf', 'dxf', 'glb', 'obj'];
const WEBHOOK_MAX_BYTES = 1_000_000;
const randomId = (prefix) => `${prefix}_${[...crypto.getRandomValues(new Uint8Array(10))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;

export function createApp({ store, env = {}, fetchImpl, now = () => Date.now(), catalogue = null, loadExporters = null, loadJsPDF = null, devGrant = false, portalStore = undefined, loadTemplates = undefined } = {}) {
  if (!store) throw new Error('createApp needs a store');
  const config = readConfig(env);
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const iso = (ms = now()) => new Date(ms).toISOString();

  const site = createSite({ store, fetchImpl, now });
  // Builder and client portal (lib/portal.js). It needs a portal store: D1 in production (the Worker passes one), memory in tests
  // and local development. Other stores (Upstash) cannot hold it, so those hosts answer 503 PORTAL_NOT_CONFIGURED.
  const pstore = portalStore !== undefined ? portalStore : ['memory', 'file'].includes(store.kind) ? createMemoryPortalStore() : null;
  const portal = pstore ? createPortal({ store, pstore, config, fetchImpl: doFetch, now, ...(loadTemplates ? { loadTemplates } : {}) }) : null;

  let toolsCache = null;
  let catalogueCache = null;
  const getCatalogue = async () => {
    if (catalogueCache === null) {
      try {
        catalogueCache = (typeof catalogue === 'function' ? await catalogue() : await catalogue) || false;
      } catch {
        catalogueCache = false;
      }
    }
    return catalogueCache || null;
  };
  const getTools = async () => {
    if (!toolsCache) {
      const tools = buildTools(await getCatalogue());
      toolsCache = { tools, systemTokens: estimateTokens(SYSTEM_PROMPT + JSON.stringify(tools)) };
    }
    return toolsCache;
  };
  const exporters = loadExporters || (() => import('../../src/premium/exporters/index.js'));

  const balanceOf = (ent) => {
    const b = credits.balance(ent);
    return { total: b.total, used: b.used, remaining: b.remaining, warnLevel: credits.warnLevel(b.used + b.reserved, b.total, config.warnThresholds) };
  };

  const str = (v, name, { min = 1, max = 200 } = {}) => {
    if (typeof v !== 'string' || v.trim().length < min || v.length > max) throw new HttpError('BAD_REQUEST', `${name} is missing or invalid.`);
    return v.trim();
  };

  // Handlers --------------------------------------------------------------------------------------
  async function health() {
    return json({ ok: true, aiPaused: !!(await credits.globalPause(store, config, now())), ...(devGrant ? { devGrant: true } : {}) });
  }

  async function checkout(request) {
    const body = await readJson(request, 4096);
    const projectId = str(body.projectId, 'projectId', { max: 80 });
    if (!/^[A-Za-z0-9_-]+$/.test(projectId)) throw new HttpError('BAD_REQUEST', 'projectId is invalid.');
    const projectName = typeof body.projectName === 'string' ? body.projectName.trim().slice(0, 80) : '';
    const session = await stripe.createCheckoutSession({ config, fetchImpl: doFetch, projectId, projectName });
    return json({ url: session.url });
  }

  async function webhook(request) {
    const rawBody = await readText(request, WEBHOOK_MAX_BYTES);
    const check = await stripe.verifyStripeSignature({
      rawBody,
      header: request.headers.get('stripe-signature'),
      secret: config.stripeWebhookSecret,
      nowSec: Math.floor(now() / 1000),
    });
    if (!check.ok) throw new HttpError('BAD_REQUEST', `Webhook signature check failed: ${check.reason}.`);
    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      throw new HttpError('BAD_REQUEST', 'Webhook body is not valid JSON.');
    }
    if (!event?.id || !event?.type) throw new HttpError('BAD_REQUEST', 'Webhook event is incomplete.');
    if (!(await store.claimWebhookEvent(event.id, event.type, iso()))) return json({ received: true, duplicate: true });
    try {
      const outcome = await stripe.handleStripeEvent({ event, store, config, now });
      console.log(JSON.stringify({ event: 'stripe_webhook', id: event.id, type: event.type, outcome }));
      return json({ received: true });
    } catch (e) {
      await store.releaseWebhookEvent(event.id); // let Stripe retry
      throw e;
    }
  }

  // Local testing without Stripe. The host turns this on only for a development server (devGrant option), so it
  // does not exist in production: the request then falls through to the normal checks and fails on session_id.
  async function devEntitlement(url) {
    const projectId = str(url.searchParams.get('project') || '', 'project', { max: 80 });
    if (!/^[A-Za-z0-9_-]+$/.test(projectId)) throw new HttpError('BAD_REQUEST', 'project is invalid.');
    const sessionId = `cs_dev_${projectId}`;
    let ent = await store.getEntitlementBySession(sessionId);
    if (!ent) {
      const nowMs = now();
      ent = (await store.createEntitlement({
        id: `ent_dev${[...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('')}`,
        projectId, email: 'dev@example.com', stripeSessionId: sessionId, amountCents: 0, currency: 'aud',
        creditsTotal: config.planPackCredits, status: 'active', createdAt: iso(nowMs), expiresAt: iso(nowMs + config.entitlementDays * 86400000),
      })).entitlement;
    } else if (ent.status !== 'active') {
      await store.setEntitlementStatus(ent.id, 'active');
      ent = await store.getEntitlement(ent.id);
    }
    return json({ token: await issueToken(ent, config, now()), credits: balanceOf(ent), projectId: ent.projectId, receipt: ent.id, expiresAt: ent.expiresAt, dev: true });
  }

  async function entitlementGet(request, url) {
    if (devGrant && url.searchParams.get('dev') === '1') return devEntitlement(url);
    const sessionId = str(url.searchParams.get('session_id') || '', 'session_id', { max: 200 });
    const projectId = str(url.searchParams.get('project') || '', 'project', { max: 80 });
    let ent = await store.getEntitlementBySession(sessionId);
    if (!ent) {
      // The webhook can be slower than the customer's return. Ask Stripe directly, once, and create the same entitlement.
      const session = await stripe.retrieveCheckoutSession({ config, fetchImpl: doFetch, sessionId });
      if (session?.payment_status === 'paid' && (session.client_reference_id || session.metadata?.projectId) === projectId) {
        ent = (await stripe.entitlementFromSession({ session, store, config, now })).entitlement;
      }
    }
    if (!ent) throw new HttpError('NOT_ENTITLED', 'Your payment has not been confirmed yet.', { pending: true }, 404);
    if (ent.projectId !== projectId) throw new HttpError('NOT_ENTITLED', 'That payment belongs to a different project.');
    if (ent.status !== 'active') throw new HttpError('NOT_ENTITLED', 'This Plan Pack is no longer active.');
    return json({ token: await issueToken(ent, config, now()), credits: balanceOf(ent), projectId: ent.projectId, receipt: ent.id, expiresAt: ent.expiresAt });
  }

  async function restore(request) {
    const body = await readJson(request, 4096);
    const email = str(body.email, 'email', { max: 200 }).toLowerCase();
    const ref = str(body.sessionOrReceipt, 'sessionOrReceipt', { min: 6, max: 200 });
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new HttpError('BAD_REQUEST', 'Enter the email address used at checkout.');
    const nowMs = now();
    const byIp = await store.hitRate(`restore:ip:${clientIp(request)}`, 600, nowMs);
    const byEmail = await store.hitRate(`restore:email:${email}`, 3600, nowMs);
    if (byIp > 8 || byEmail > 5) throw new HttpError('RATE_LIMITED', 'Too many attempts. Try again later.', { retryAfter: 600 });
    const ent = await store.findForRestore(email, ref);
    if (!ent || ent.status !== 'active' || (ent.expiresAt && Date.parse(ent.expiresAt) <= nowMs)) {
      throw new HttpError('NOT_ENTITLED', 'We could not find a Plan Pack with those details.');
    }
    return json({ token: await issueToken(ent, config, nowMs), projectId: ent.projectId, credits: balanceOf(ent), receipt: ent.id, expiresAt: ent.expiresAt });
  }

  // Builder and client logins sit behind PORTAL_ENABLED (the public launch comes first).
  const readOrgToken = async (request, deps) => {
    const payload = await readOrgTokenRaw(request, deps);
    if (payload && !config.portalEnabled) throw new HttpError('NOT_ENTITLED', 'Builder and client logins are not switched on yet.');
    return payload;
  };

  // Accounts ----------------------------------------------------------------------------------------
  // A request is paid for either by a Plan Pack (one entitlement row for the project) or by a builder or client login
  // (a monthly pool per login per Sydney calendar month, then a carry-over top-up pool). Both expose the same small
  // interface so the AI handlers do not care which one they have.
  const TOPUP_OFFER = () => ({ credits: config.topUpCredits, amountCents: config.topUpCents, gstInclusive: true, currency: 'aud' });

  async function topUpAllowed(payload) {
    if (payload.role === 'builder') return true;
    return credits.clientTopUpsEnabled(await store.listEvents('org_topup_setting'), payload.oid);
  }

  async function orgAccount(payload) {
    const nowMs = now();
    const month = credits.sydneyMonth(nowMs);
    const { monthlyId, topUpId } = credits.orgPoolIds(payload.oid, payload.lid, month.key);
    const cap = Number.isFinite(payload.cap) ? payload.cap : config.orgMonthlyCredits;
    const base = { projectId: payload.oid, email: null, amountCents: 0, currency: 'aud', status: 'active', createdAt: iso(nowMs) };
    await store.createEntitlement({ ...base, id: monthlyId, stripeSessionId: `org-m:${monthlyId}`, creditsTotal: cap, expiresAt: iso(month.resetsAtMs) });
    await store.createEntitlement({ ...base, id: topUpId, stripeSessionId: `org-t:${topUpId}`, creditsTotal: 0, expiresAt: null });
    const pools = async () => ({ m: await store.getEntitlement(monthlyId), t: await store.getEntitlement(topUpId) });
    const snapshot = async () => {
      const { m, t } = await pools();
      const b = credits.orgBalance(m, t);
      return {
        kind: 'org', total: b.total, used: b.used, remaining: b.remaining, reserved: b.reserved,
        warnLevel: credits.warnLevel(b.used + b.reserved, b.total, config.warnThresholds),
        topUpRemaining: b.topUpRemaining, available: b.available, monthResetsOn: month.resetsOn,
        topUp: { allowed: await topUpAllowed(payload), ...TOPUP_OFFER() },
      };
    };
    return {
      kind: 'org', payload, id: monthlyId, rateKey: `org:${payload.oid}:${payload.lid}`,
      snapshot,
      async available() {
        const { m, t } = await pools();
        return credits.orgBalance(m, t).available;
      },
      async reserve(n, nowIso) {
        const { m, t } = await pools();
        const b = credits.orgBalance(m, t);
        const plan = credits.planSpend(b.remaining, b.topUpRemaining, n);
        if (!plan) return null;
        if (plan.fromMonthly && !(await store.reserveCredits(monthlyId, plan.fromMonthly, nowIso))) return null;
        if (plan.fromTopUp && !(await store.reserveCredits(topUpId, plan.fromTopUp, nowIso))) {
          if (plan.fromMonthly) await store.releaseCredits(monthlyId, plan.fromMonthly);
          return null;
        }
        return { m: plan.fromMonthly, t: plan.fromTopUp };
      },
      async settle(res, charged) {
        const split = credits.splitCharge(charged, res.m, res.t);
        if (res.m || split.monthly) await store.settleCredits(monthlyId, res.m, split.monthly);
        if (res.t || split.topUp) await store.settleCredits(topUpId, res.t, split.topUp);
        return split;
      },
      async release(res) {
        if (res.m) await store.releaseCredits(monthlyId, res.m);
        if (res.t) await store.releaseCredits(topUpId, res.t);
      },
      // Threshold crossing counts the monthly pool only; top-up credits do not warn.
      async crossed(res, charged) {
        const { m } = await pools();
        const split = credits.splitCharge(charged, res.m, res.t);
        return credits.crossedThreshold(Math.max(0, m.creditsUsed - split.monthly), m.creditsUsed, m.creditsTotal, config.warnThresholds);
      },
      exhaustedDetails: async () => ({ topUp: { allowed: await topUpAllowed(payload), ...TOPUP_OFFER() }, monthResetsOn: month.resetsOn }),
    };
  }

  function packAccount(ent) {
    return {
      kind: 'pack', id: ent.id, rateKey: ent.projectId,
      snapshot: async () => balanceOf((await store.getEntitlement(ent.id)) || ent),
      available: async () => credits.balance((await store.getEntitlement(ent.id)) || ent).remaining,
      reserve: async (n, nowIso) => ((await store.reserveCredits(ent.id, n, nowIso)) ? { m: n, t: 0 } : null),
      settle: async (res, charged) => (await store.settleCredits(ent.id, res.m, charged), { monthly: charged, topUp: 0 }),
      release: (res) => store.releaseCredits(ent.id, res.m),
      async crossed(res, charged) {
        const after = await store.getEntitlement(ent.id);
        return credits.crossedThreshold(Math.max(0, after.creditsUsed - charged), after.creditsUsed, after.creditsTotal, config.warnThresholds);
      },
      exhaustedDetails: async () => ({}),
    };
  }

  async function accountFor(request) {
    const org = await readOrgToken(request, { config, now });
    if (org) return orgAccount(org);
    return packAccount(await authenticate(request, { store, config, now }));
  }

  async function creditsGet(request, url) {
    const org = await readOrgToken(request, { config, now });
    if (org) return json(await (await orgAccount(org)).snapshot());
    const ent = await authenticate(request, { store, config, now });
    const project = url.searchParams.get('project');
    if (project && project !== ent.projectId) throw new HttpError('NOT_ENTITLED', 'This Plan Pack is for a different project.');
    return json({ ...balanceOf(ent), reserved: ent.creditsReserved || 0 });
  }

  const aiBody = async (request) => {
    const body = await readJson(request, config.maxContextTokens * 4 + 30000);
    const message = str(body.message, 'message', { max: 2000 });
    const context = typeof body.context === 'string' ? body.context : '';
    if (!context) throw new HttpError('BAD_REQUEST', 'context is missing.');
    if (estimateTokens(context) > config.maxContextTokens) throw new HttpError('PAYLOAD_TOO_LARGE', 'This design is too large for the assistant.', { maxContextTokens: config.maxContextTokens });
    return { body, message, context };
  };

  const needAi = () => {
    if (!config.anthropicApiKey) throw new HttpError('AI_NOT_CONFIGURED', 'AI not configured');
  };

  async function aiEstimate(request) {
    needAi();
    const acct = await accountFor(request);
    const { message, context, body } = await aiBody(request);
    const { systemTokens } = await getTools();
    const est = credits.estimateRequest({ config, context, message, history: anthropic.cleanHistory(body.history), systemTokens });
    return json({ estimatedCredits: est.credits, remaining: await acct.available(), requiresConfirm: est.credits > config.largeRequestCredits });
  }

  async function aiEdit(request) {
    needAi();
    const started = now();
    const acct = await accountFor(request);
    const { message, context, body } = await aiBody(request);
    const activeLevelId = typeof body.activeLevelId === 'string' ? body.activeLevelId.slice(0, 64) : '';
    const history = anthropic.cleanHistory(body.history);
    const logBase = { id: randomId('req'), entitlementId: acct.id, createdAt: iso(started), model: config.anthropicModel };

    // Organisation budgets come first so one busy builder cannot use up the AI for public buyers.
    if (acct.kind === 'org') {
      const orgStop = await credits.orgPause(store, config, acct.payload.oid, started);
      if (orgStop) {
        console.warn(JSON.stringify({ event: 'org_budget', org: acct.payload.oid, ...orgStop }));
        await store.logEvent({ id: `org_budget:${acct.payload.oid}:${orgStop.window}:${credits.orgSpendKeys(acct.payload.oid, started).orgDay}`, type: 'org_budget', detail: { orgId: acct.payload.oid, ...orgStop }, createdAt: iso(started) });
        await store.logAiRequest({ ...logBase, status: 'org_budget' });
        throw new HttpError('AI_PAUSED', orgStop.scope === 'org' ? `Your organisation has reached its AI ${orgStop.window === 'day' ? 'daily' : 'monthly'} budget. Your credits are untouched. Try again ${orgStop.window === 'day' ? 'tomorrow' : 'next month'}.` : 'The assistant is paused for now. Your credits are untouched. Try again later.', { scope: orgStop.scope });
      }
    }
    const pause = await credits.globalPause(store, config, started);
    if (pause) {
      console.warn(JSON.stringify({ event: 'ai_paused', ...pause }));
      await store.logEvent({ id: `ai_paused:${pause.period}`, type: 'ai_paused', detail: pause, createdAt: iso(started) });
      await store.logAiRequest({ ...logBase, status: 'ai_paused' });
      throw new HttpError('AI_PAUSED', 'The assistant is paused for now. Your credits are untouched. Try again later.');
    }
    const limited = await credits.rateLimit(store, config, acct.rateKey, started);
    if (limited) {
      throw new HttpError('RATE_LIMITED', limited.window === 'minute' ? 'You are sending requests quickly. Wait a moment and try again.' : 'The daily limit for AI requests on this project has been reached.', { retryAfter: limited.retryAfter });
    }

    const { tools, systemTokens } = await getTools();
    const est = credits.estimateRequest({ config, context, message, history, systemTokens });
    const remaining = await acct.available();
    const what = acct.kind === 'org' ? 'AI credits for this month' : 'AI credits in this Plan Pack';
    if (remaining < est.credits) {
      throw new HttpError('CREDITS_EXHAUSTED', remaining <= 0 ? `All ${what} have been used.` : `Only ${remaining} AI ${remaining === 1 ? 'credit remains' : 'credits remain'}, which is not enough for another request.`, { remaining, estimatedCredits: est.credits, ...(await acct.exhaustedDetails()) });
    }
    if (est.credits > config.largeRequestCredits && body.confirmLarge !== true) {
      throw new HttpError('CONFIRM_REQUIRED', 'This change may use a large number of credits.', { estimatedCredits: est.credits, remaining });
    }
    const reservation = await acct.reserve(est.credits, iso(started));
    if (!reservation) {
      throw new HttpError('INSUFFICIENT_CREDITS', 'Your remaining credits are reserved by another request. Try again in a moment.');
    }

    const reqBody = anthropic.buildRequest({ config, tools, history, context, message, activeLevelId });
    let data;
    try {
      data = await anthropic.callAnthropic({ config, fetchImpl: doFetch, body: reqBody });
    } catch (e) {
      await acct.release(reservation);
      await store.logAiRequest({ ...logBase, latencyMs: now() - started, status: 'error' });
      throw e;
    }

    const parsed = anthropic.parseResponse(data, tools);
    const cost = credits.costMicros(parsed.usage, config);
    const charged = credits.creditsForCost(cost, config);
    await acct.settle(reservation, charged);
    if (acct.kind === 'org') await credits.addOrgSpend(store, acct.payload.oid, cost, started);
    else {
      const { day, month } = credits.periodKeys(started);
      await store.addSpend(day, cost);
      await store.addSpend(month, cost);
    }
    await store.logAiRequest({
      ...logBase,
      inputTokens: parsed.usage.input_tokens, outputTokens: parsed.usage.output_tokens,
      cacheWriteTokens: parsed.usage.cache_creation_input_tokens, cacheReadTokens: parsed.usage.cache_read_input_tokens,
      costUsdMicros: cost, credits: charged, opsCount: parsed.ops.length, latencyMs: now() - started, status: 'ok',
    });
    const crossed = await acct.crossed(reservation, charged);
    const snap = await acct.snapshot();
    return json({
      reply: parsed.reply,
      ops: parsed.ops,
      rejected: parsed.rejected,
      credits: { charged, ...snap },
      warning: crossed ? { level: crossed, usedPercent: Math.round(((snap.used) / snap.total) * 100), remaining: snap.remaining } : null,
    });
  }

  // Top-ups for builder and client logins. The credits are added at once and the charge is recorded as a billable event for
  // the builder's end-of-month invoice (no card payment). Builders can switch client top-ups off for their organisation.
  async function aiTopUp(request) {
    const org = await readOrgToken(request, { config, now });
    if (!org) throw new HttpError('NOT_ENTITLED', 'Top-ups are for builder and client logins.');
    if (!(await topUpAllowed(org))) throw new HttpError('TOPUP_DISABLED', 'Top-ups are turned off for your organisation. Ask your builder.');
    const nowMs = now();
    if ((await store.hitRate(`topup:${org.oid}:${org.lid}`, 3600, nowMs)) > 10) throw new HttpError('RATE_LIMITED', 'Too many top-ups in the last hour.', { retryAfter: 600 });
    const acct = await orgAccount(org);
    const month = credits.sydneyMonth(nowMs);
    const { topUpId } = credits.orgPoolIds(org.oid, org.lid, month.key);
    await store.addCredits(topUpId, config.topUpCredits);
    const record = { ...credits.topUpRecord({ orgId: org.oid, loginId: org.lid, config, nowMs }), role: org.role };
    await store.logEvent({ id: randomId('topup'), type: 'ai_topup', detail: record, createdAt: record.createdAt });
    return json({ credits: await acct.snapshot(), topUp: record });
  }

  async function aiTopUpSetting(request) {
    const org = await readOrgToken(request, { config, now });
    if (!org || org.role !== 'builder') throw new HttpError('NOT_ENTITLED', 'Only a builder login can change this.');
    const body = await readJson(request, 1024);
    if (typeof body.enabled !== 'boolean') throw new HttpError('BAD_REQUEST', 'enabled must be true or false.');
    const createdAt = iso();
    await store.logEvent({ id: randomId('orgset'), type: 'org_topup_setting', detail: { orgId: org.oid, loginId: org.lid, enabled: body.enabled }, createdAt });
    return json({ clientTopUps: body.enabled });
  }

  async function exportFile(request, type) {
    if (!EXPORT_TYPES.includes(type)) throw new HttpError('BAD_REQUEST', `Unknown export type. Use one of: ${EXPORT_TYPES.join(', ')}.`);
    const ent = await authenticate(request, { store, config, now, missing: 'NOT_ENTITLED' });
    const body = await readJson(request, config.exportMaxProjectBytes + (type === 'pdf' ? 2_000_000 : 0));
    let project;
    try {
      project = migrate(body.project);
    } catch (e) {
      throw new HttpError('BAD_REQUEST', `The project could not be read: ${e.message}`);
    }
    if (JSON.stringify(body.project).length > config.exportMaxProjectBytes) throw new HttpError('PAYLOAD_TOO_LARGE', 'This project is too large to export.');
    const problems = validate(project);
    if (problems.length) throw new HttpError('BAD_REQUEST', 'The project has problems and cannot be exported.', { details: problems.slice(0, 5) });
    if (project.id !== ent.projectId) throw new HttpError('NOT_ENTITLED', 'This Plan Pack is for a different project.');
    const image = typeof body.image === 'string' && /^data:image\/png;base64,/.test(body.image) && body.image.length < 1_900_000 ? body.image : null;

    let mod;
    try {
      mod = await exporters();
    } catch (e) {
      console.error('export module failed to load', e?.message);
      throw new HttpError('EXPORT_UNAVAILABLE', 'Exports are not available right now. Try again later.');
    }
    const exportConfig = {
      disclaimer: config.disclaimer || SITE_CONFIG.disclaimer,
    };
    let file;
    try {
      file = await mod.buildExport(type, project, {
        image,
        config: exportConfig,
        catalogue: await getCatalogue(),
        // The host supplies jsPDF (a literal import here would force every host bundle to include it).
        loadJsPDF: async () => {
          if (!loadJsPDF) throw new Error('No jsPDF loader was given to createApp');
          return loadJsPDF();
        },
      });
    } catch (e) {
      console.error(JSON.stringify({ event: 'export_failed', type, message: e?.message }));
      throw new HttpError('EXPORT_UNAVAILABLE', 'That export could not be built. Try again, or try a different format.');
    }
    await store.logEvent({ id: randomId('export'), type: 'export', detail: { eid: ent.id, type }, createdAt: iso() });
    return new Response(file.bytes, {
      status: 200,
      headers: {
        'content-type': file.mime,
        'content-disposition': `attachment; filename="${file.filename}"`,
        'content-length': String(file.bytes.byteLength),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  async function enquiryJce(request) {
    const body = await readJson(request, 10_000_000);
    return json(await handleEnquiry({ body, request, store, config, fetchImpl: doFetch, now, clientIp }));
  }

  // Router ----------------------------------------------------------------------------------------
  async function route(request, url) {
    const m = /\/api(\/.*)?$/.exec(url.pathname.replace(/\/+$/, '') || '/');
    const path = m?.[1] || '';
    const method = request.method;
    const allow = (...methods) => {
      if (!methods.includes(method)) throw new HttpError('BAD_REQUEST', `Use ${methods.join(' or ')} for this endpoint.`, {}, 405);
    };
    if (path === '/health') return allow('GET'), health();
    if (path === '/checkout') return allow('POST'), checkout(request);
    if (path === '/stripe/webhook') return allow('POST'), webhook(request);
    if (path === '/entitlement') return allow('GET'), entitlementGet(request, url);
    if (path === '/entitlement/restore') return allow('POST'), restore(request);
    if (path === '/credits') return allow('GET'), creditsGet(request, url);
    if (path === '/ai/estimate') return allow('POST'), aiEstimate(request);
    if (path === '/ai/edit') return allow('POST'), aiEdit(request);
    if (path === '/ai/topup') return allow('POST'), aiTopUp(request);
    if (path === '/ai/topup-setting') return allow('POST'), aiTopUpSetting(request);
    const sub = /^\/site(\/[a-z]+)$/.exec(path);
    if (sub) return site.handle(sub[1], request, url);
    if (path === '/enquiry/jce') return allow('POST'), enquiryJce(request);
    if (path.startsWith('/portal/') || path === '/billing/run-month') {
      if (!portal) throw new HttpError('PORTAL_NOT_CONFIGURED', 'The builder portal is not available on this server.');
      return portal.route(request, url, path);
    }
    const exp = /^\/export\/([a-z0-9]+)$/.exec(path);
    if (exp) return allow('POST'), exportFile(request, exp[1]);
    throw new HttpError('NOT_FOUND', 'No such endpoint.');
  }

  async function handle(request) {
    const cors = corsHeaders(request, config);
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      const res = await route(request, new URL(request.url));
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      if (e instanceof HttpError) return errorResponse(e, cors);
      console.error(JSON.stringify({ event: 'unhandled_error', message: e?.message, stack: e?.stack?.split('\n').slice(0, 4) }));
      return errorResponse(new HttpError('INTERNAL_ERROR', 'Something went wrong on the server. Try again.'), cors);
    }
  }

  return { fetch: handle, handle, config, portal, scheduled: async () => (portal ? portal.scheduled() : null) };
}

export default createApp;
