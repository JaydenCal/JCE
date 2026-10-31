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
import { authenticate, issueToken } from './entitlement.js';
import * as stripe from './stripe.js';
import * as credits from './credits.js';
import * as anthropic from './anthropic.js';

const EXPORT_TYPES = ['pdf', 'dxf', 'glb', 'obj'];
const WEBHOOK_MAX_BYTES = 1_000_000;
const randomId = (prefix) => `${prefix}_${[...crypto.getRandomValues(new Uint8Array(10))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;

export function createApp({ store, env = {}, fetchImpl, now = () => Date.now(), catalogue = null, loadExporters = null, loadJsPDF = null, devGrant = false } = {}) {
  if (!store) throw new Error('createApp needs a store');
  const config = readConfig(env);
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const iso = (ms = now()) => new Date(ms).toISOString();

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

  async function creditsGet(request, url) {
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
    const ent = await authenticate(request, { store, config, now });
    const { message, context, body } = await aiBody(request);
    const { systemTokens } = await getTools();
    const est = credits.estimateRequest({ config, context, message, history: anthropic.cleanHistory(body.history), systemTokens });
    return json({ estimatedCredits: est.credits, remaining: credits.balance(ent).remaining, requiresConfirm: est.credits > config.largeRequestCredits });
  }

  async function aiEdit(request) {
    needAi();
    const started = now();
    const ent = await authenticate(request, { store, config, now });
    const { message, context, body } = await aiBody(request);
    const activeLevelId = typeof body.activeLevelId === 'string' ? body.activeLevelId.slice(0, 64) : '';
    const history = anthropic.cleanHistory(body.history);

    const pause = await credits.globalPause(store, config, started);
    if (pause) {
      console.warn(JSON.stringify({ event: 'ai_paused', ...pause }));
      await store.logEvent({ id: `ai_paused:${pause.period}`, type: 'ai_paused', detail: pause, createdAt: iso(started) });
      await store.logAiRequest({ id: randomId('req'), entitlementId: ent.id, createdAt: iso(started), model: config.anthropicModel, status: 'ai_paused' });
      throw new HttpError('AI_PAUSED', 'The assistant is paused for now. Your credits are untouched. Try again later.');
    }
    const limited = await credits.rateLimit(store, config, ent.projectId, started);
    if (limited) {
      throw new HttpError('RATE_LIMITED', limited.window === 'minute' ? 'You are sending requests quickly. Wait a moment and try again.' : 'The daily limit for AI requests on this project has been reached.', { retryAfter: limited.retryAfter });
    }

    const { tools, systemTokens } = await getTools();
    const est = credits.estimateRequest({ config, context, message, history, systemTokens });
    const bal = credits.balance(ent);
    if (bal.remaining < est.credits) {
      throw new HttpError('CREDITS_EXHAUSTED', bal.remaining <= 0 ? 'All AI credits in this Plan Pack have been used.' : `Only ${bal.remaining} AI ${bal.remaining === 1 ? 'credit remains' : 'credits remain'}, which is not enough for another request.`, { remaining: bal.remaining, estimatedCredits: est.credits });
    }
    if (est.credits > config.largeRequestCredits && body.confirmLarge !== true) {
      throw new HttpError('CONFIRM_REQUIRED', 'This change may use a large number of credits.', { estimatedCredits: est.credits, remaining: bal.remaining });
    }
    if (!(await store.reserveCredits(ent.id, est.credits, iso(started)))) {
      throw new HttpError('INSUFFICIENT_CREDITS', 'Your remaining credits are reserved by another request. Try again in a moment.');
    }

    const reqBody = anthropic.buildRequest({ config, tools, history, context, message, activeLevelId });
    let data;
    try {
      data = await anthropic.callAnthropic({ config, fetchImpl: doFetch, body: reqBody });
    } catch (e) {
      await store.releaseCredits(ent.id, est.credits);
      await store.logAiRequest({ id: randomId('req'), entitlementId: ent.id, createdAt: iso(started), model: config.anthropicModel, latencyMs: now() - started, status: 'error' });
      throw e;
    }

    const parsed = anthropic.parseResponse(data, tools);
    const cost = credits.costMicros(parsed.usage, config);
    const charged = credits.creditsForCost(cost, config);
    await store.settleCredits(ent.id, est.credits, charged);
    const { day, month } = credits.periodKeys(started);
    await store.addSpend(day, cost);
    await store.addSpend(month, cost);
    await store.logAiRequest({
      id: randomId('req'), entitlementId: ent.id, createdAt: iso(started), model: config.anthropicModel,
      inputTokens: parsed.usage.input_tokens, outputTokens: parsed.usage.output_tokens,
      cacheWriteTokens: parsed.usage.cache_creation_input_tokens, cacheReadTokens: parsed.usage.cache_read_input_tokens,
      costUsdMicros: cost, credits: charged, opsCount: parsed.ops.length, latencyMs: now() - started, status: 'ok',
    });
    const after = await store.getEntitlement(ent.id);
    const usedBefore = Math.max(0, after.creditsUsed - charged);
    const crossed = credits.crossedThreshold(usedBefore, after.creditsUsed, after.creditsTotal, config.warnThresholds);
    const bal2 = balanceOf(after);
    return json({
      reply: parsed.reply,
      ops: parsed.ops,
      rejected: parsed.rejected,
      credits: { charged, ...bal2 },
      warning: crossed ? { level: crossed, usedPercent: Math.round((after.creditsUsed / after.creditsTotal) * 100), remaining: bal2.remaining } : null,
    });
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

  return { fetch: handle, handle, config };
}

export default createApp;
