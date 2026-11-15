// Glide Inside booking and sales concierge: HTTP routes under /api/concierge/*. Wired into app.js with one line.
// Hybrid by design: intent chips, FAQ answers and every booking step are deterministic code. A small model (CONCIERGE_MODEL, Haiku 5.5 by
// default) answers only free text the FAQ cannot, from the approved knowledge file, and is switched off by a monthly budget ceiling.
// Off by default: CONCIERGE_ENABLED must be 1, booking types must be approved (CONCIERGE_APPROVED_TYPES), and a real calendar needs BOOKING_LIVE=1.

import { HttpError, json, readJson, clientIp } from './http.js';
import { createBooking, BOOKING_TYPES, BOOKING_TYPE_IDS, signBlob, verifyBlob } from './booking.js';
import { createProvider } from './booking-provider.js';
import { createD1BookingStore, createMemoryBookingStore } from './booking-store.js';
import { answerFromKnowledge, BOOKING_WORDS, INTENTS, INTENT_OPENERS, LINKS, CONTACT } from './concierge-knowledge.js';
import { askModel, budgetExhausted } from './concierge-ai.js';
import { toB64u } from './entitlement.js';
import { handleEnquiry, parseEnquiry } from './enquiry.js'; // CALLBACK: the default flow goes through the existing enquiry pipeline (save first, then Resend)

const flag = (v) => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').toLowerCase());
const num = (v, d) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
let ephemeral = ''; // per isolate fallback, made on first use (Workers forbid random values in global scope); only ever used in mock mode
const ephemeralSecret = () => (ephemeral ||= toB64u(crypto.getRandomValues(new Uint8Array(32))));
const sha256Hex = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const err = (code, msg, extra = {}, status) => new HttpError(code, msg, extra, status);

export function readConciergeConfig(env = {}, base = {}) {
  const provider = String(env.BOOKING_PROVIDER || 'mock').toLowerCase() === 'calcom' ? 'calcom' : 'mock';
  const approved = String(env.CONCIERGE_APPROVED_TYPES || '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => BOOKING_TYPE_IDS.includes(s));
  const eventTypeIds = {};
  for (const t of BOOKING_TYPE_IDS) { const v = env[`CALCOM_EVENT_TYPE_${t.toUpperCase()}`]; if (v) eventTypeIds[t] = String(v); }
  return {
    enabled: flag(env.CONCIERGE_ENABLED),            // default OFF
    bookingLive: flag(env.BOOKING_LIVE),              // default OFF: no real calendar is touched until this is 1
    provider,
    allowMock: flag(env.CONCIERGE_ALLOW_MOCK),        // the mock provider is for tests and staging only
    approved,                                         // booking types the owner has approved
    eventTypeIds,
    model: String(env.CONCIERGE_MODEL || 'claude-haiku-5-5'),
    aiEnabled: String(env.CONCIERGE_AI ?? '1') !== '0',
    anthropicApiKey: base.anthropicApiKey || '',
    aiTimeoutMs: base.aiTimeoutMs || 30000,
    fxAudPerUsd: base.fxAudPerUsd || 1.67,
    monthlyBudgetAud: num(env.AI_MONTHLY_BUDGET_AUD, 10),
    maxOutputTokens: Math.round(num(env.CONCIERGE_MAX_OUTPUT_TOKENS, 300)),
    maxMessages: Math.round(num(env.CONCIERGE_MAX_MESSAGES, 12)),   // per conversation
    ipPerMin: Math.round(num(env.CONCIERGE_IP_PER_MIN, 20)),
    ipSessionsPerHour: Math.round(num(env.CONCIERGE_IP_SESSIONS_PER_HOUR, 10)),
    ipConfirmsPerHour: Math.round(num(env.CONCIERGE_IP_CONFIRMS_PER_HOUR, 6)),
    ipCallbacksPerHour: Math.round(num(env.CONCIERGE_IP_CALLBACKS_PER_HOUR, 4)),
    emailBookingsPerDay: Math.round(num(env.CONCIERGE_EMAIL_BOOKINGS_PER_DAY, 3)),
    turnstileSecret: String(env.TURNSTILE_SECRET_KEY || ''),
    turnstileSiteKey: String(env.TURNSTILE_SITE_KEY || ''),
    signingSecret: String(env.CONCIERGE_SIGNING_SECRET || env.ENTITLEMENT_SECRET || ''),
    siteOrigin: base.siteOrigin || '',
    settings: {
      approved, eventTypeIds,
      noticeHours: num(env.CONCIERGE_NOTICE_HOURS, 12), horizonDays: Math.round(num(env.CONCIERGE_HORIZON_DAYS, 21)),
      proposalTtlMin: num(env.CONCIERGE_PROPOSAL_TTL_MIN, 10), reconcileGraceMs: num(env.CONCIERGE_RECONCILE_GRACE_MS, 120000),
    },
  };
}

export function createConcierge({ store, env = {}, baseConfig = {}, fetchImpl, now = () => Date.now(), provider: injected, bstore: injectedStore } = {}) {
  const cfg = readConciergeConfig(env, baseConfig);
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const mockOk = cfg.provider === 'mock' && cfg.allowMock;
  const providerOk = cfg.provider === 'calcom' ? !!env.CALCOM_API_KEY : mockOk;
  const provider = injected || (providerOk ? createProvider({ env: { ...env, BOOKING_PROVIDER: cfg.provider }, fetchImpl: doFetch, nowMs: now }) : null);
  const bstore = injectedStore || (env.DB ? createD1BookingStore(env.DB) : createMemoryBookingStore());
  const secret = cfg.signingSecret || (cfg.allowMock ? ephemeralSecret() : '');
  // Default flow is "Request a call back" (owner decision 15/11/2026). Slots and booking exist only behind BOOKING_PROVIDER=calcom (or the mock in tests).
  const mode = !cfg.enabled ? 'off' : !providerOk ? 'callback' : cfg.provider === 'mock' ? 'test' : cfg.bookingLive ? 'live' : 'readonly';
  const callbackAvailable = cfg.enabled && !!secret;
  const bookingAvailable = cfg.enabled && providerOk && !!secret && cfg.approved.length > 0 && (cfg.provider === 'mock' || cfg.bookingLive);
  const aiAvailable = cfg.enabled && cfg.aiEnabled && !!cfg.anthropicApiKey;
  const log = (o) => console.warn(JSON.stringify({ ...o, svc: 'concierge' })); // never pass personal data here
  const booking = provider && secret ? createBooking({ provider, bstore, settings: cfg.settings, secret, now, log }) : null;
  const needTurnstile = cfg.turnstileSecret ? true : !cfg.allowMock; // fail closed everywhere except the mock/test setup

  const publicConfig = () => ({
    enabled: cfg.enabled, mode, bookingAvailable, callbackAvailable, aiAvailable,
    testMode: mode === 'test',
    types: booking ? Object.values(booking.types()).filter((t) => t.active).map(({ id, label, durationMin, audience }) => ({ id, label, durationMin, audience })) : [],
    intents: Object.values(INTENTS).map((i) => ({ id: i.id, label: i.label, blurb: i.blurb, bookingType: i.bookingType, qualifier: i.qualifier })),
    turnstileSiteKey: needTurnstile ? cfg.turnstileSiteKey : '',
    maxMessages: cfg.maxMessages, links: LINKS, contact: CONTACT, timezone: 'Australia/Sydney',
  });

  // Guards ---------------------------------------------------------------------------------------------------------------------
  function guard(request, { post = true } = {}) {
    if (!cfg.enabled) throw err('CONCIERGE_DISABLED', 'The assistant is not available.', {}, 503);
    if (post) {
      if (request.headers.get('x-gi-request') !== '1') throw err('FORBIDDEN', 'That request was blocked.', {}, 403);
      const origin = request.headers.get('origin');
      if (origin && cfg.siteOrigin && origin !== cfg.siteOrigin) throw err('FORBIDDEN', 'That request was blocked.', {}, 403);
    }
  }
  async function limit(key, windowSec, max, message = 'Too many requests. Please wait a moment and try again.') {
    const n = await store.hitRate(key, windowSec, now());
    if (n > max) throw err('RATE_LIMITED', message, { retryAfter: Math.min(windowSec, 60) }, 429);
  }
  async function ipLimit(request) { await limit(`cc:ip:min:${clientIp(request)}`, 60, cfg.ipPerMin); }

  async function verifyTurnstile(token, ip) {
    if (!needTurnstile) return true;
    if (!cfg.turnstileSecret) throw err('TURNSTILE_NOT_CONFIGURED', 'The assistant is not available right now. Please use the enquiry form.', {}, 503);
    if (typeof token !== 'string' || !token || token.length > 2048) return false;
    try {
      const res = await doFetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret: cfg.turnstileSecret, response: token, remoteip: ip }),
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
      });
      const out = await res.json().catch(() => null);
      return out?.success === true;
    } catch { return false; }
  }

  async function convOf(body) {
    const p = await verifyBlob(body?.conv, secret, now(), 'conv');
    if (!p) throw err('SESSION_EXPIRED', 'This chat has expired. Please start again.', {}, 401);
    return p.cid;
  }
  const text = (v, max) => String(typeof v === 'string' ? v : '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, max);

  // Handlers -------------------------------------------------------------------------------------------------------------------
  async function session(request) {
    guard(request);
    await ipLimit(request);
    const ip = clientIp(request);
    await limit(`cc:ip:sess:${ip}`, 3600, cfg.ipSessionsPerHour);
    const body = await readJson(request, 4096);
    if (!(await verifyTurnstile(body.turnstileToken, ip))) throw err('TURNSTILE_FAILED', 'We could not check that you are a person. Please try again, or use the enquiry form.', {}, 403);
    if (!secret) throw err('CONCIERGE_NOT_CONFIGURED', 'The assistant is not available right now.', {}, 503);
    const cid = toB64u(crypto.getRandomValues(new Uint8Array(12)));
    return json({ conv: await signBlob({ k: 'conv', cid, exp: now() + 2 * 3600e3 }, secret), ...publicConfig() });
  }

  const bookingTypeFor = (intent, message) => {
    if (INTENTS[intent]) return INTENTS[intent].bookingType;
    const m = String(message || '');
    if (/\bbuilder/i.test(m)) return 'builder';
    if (/\b(developer|estate|commercial|subdivision)/i.test(m)) return 'developer';
    if (/\bagent/i.test(m)) return 'agent';
    if (/\b(home ?owner|my (house|block|home))/i.test(m)) return 'homeowner';
    return null;
  };

  async function slotsFor(type, from, days) {
    if (!booking || !bookingAvailable) return null;
    try { return await booking.listSlots({ type, from, days }); } catch (e) { if (e instanceof HttpError) return { type, slots: [], error: e.code }; throw e; }
  }

  async function message(request) {
    guard(request);
    await ipLimit(request);
    const body = await readJson(request, 8192);
    const cid = await convOf(body);
    await limit(`cc:conv:msg:${cid}`, 6 * 3600, cfg.maxMessages, 'This chat has reached its message limit. Please use the enquiry form.');
    const intent = INTENTS[body.intent] ? body.intent : null;
    const msg = text(body.message, 600);
    const page = text(body.page, 60);
    const out = { source: 'deterministic', reply: '', links: [], ops: [], ai: false };
    if (!msg) { // intent chosen with no text: the deterministic opener
      if (!intent) throw err('BAD_REQUEST', 'Choose an option or type a question.');
      out.reply = INTENT_OPENERS[intent];
      out.links = intent === 'homeowner' ? ['tool'] : intent === 'builder' ? ['builders'] : intent === 'developer' ? ['commercial'] : [];
      return json(out);
    }
    // 1. booking intent (deterministic)
    if (BOOKING_WORDS.test(msg)) {
      const type = bookingTypeFor(intent, msg);
      if (type && bookingAvailable && booking.types()[type]?.active) {
        out.reply = `I can show you available times for a ${BOOKING_TYPES[type].label.toLowerCase()} (${BOOKING_TYPES[type].durationMin} minutes). Times are in Sydney time.`;
        out.ops = [{ op: 'get_slots', type }];
        out.slots = await slotsFor(type);
        return json(out);
      }
      out.reply = bookingAvailable ? 'Tell me which best describes you, and I will show times. Or I can pass a call back request to Jayden.' : 'I cannot book a time here. I can pass a call back request to Jayden, who will call you, usually within one business day. You can also use the demo form or send an enquiry.';
      out.links = bookingAvailable ? [] : ['demo', 'enquiry'];
      out.ops = bookingAvailable ? [{ op: 'choose_intent' }, { op: 'callback' }] : [{ op: 'callback' }];
      return json(out);
    }
    // 2. FAQ and refusals (deterministic, free)
    const hit = answerFromKnowledge(msg);
    if (hit) { out.reply = hit.answer; out.links = hit.links; out.faq = hit.id; return json(out); }
    // 3. model, only if allowed and the budget is not exhausted
    if (aiAvailable && !(await budgetExhausted({ store, config: cfg, now: now() }))) {
      try {
        const r = await askModel({ config: cfg, fetchImpl: doFetch, store, now: now(), secret, intent, page, message: msg, booking: bookingAvailable, priorUserMessages: (Array.isArray(body.history) ? body.history : []).filter((h) => typeof h === 'string').slice(-2) });
        if (!r.exhausted) {
          out.source = 'ai'; out.ai = true; out.reply = r.text; out.flagged = r.flagged || undefined;
          for (const op of r.ops) {
            if (op.op === 'get_slots' && bookingAvailable && booking.types()[op.type]?.active) { out.ops.push(op); out.slots = await slotsFor(op.type, op.from, op.days); }
            else if (op.op === 'propose_booking' && bookingAvailable && booking.types()[op.type]?.active) out.ops.push(op);
            else if (op.op === 'callback') out.ops.push(op); // only opens the form; the visitor still has to press the send button
            else if (op.op === 'handoff') { out.ops.push(op); out.links.push(op.target === 'tool' ? 'tool' : op.target); }
          }
          if (r.blocked.length) log({ event: 'concierge_blocked_tool', tools: r.blocked });
          return json(out);
        }
      } catch (e) {
        if (!(e instanceof HttpError)) throw e;
        log({ event: 'concierge_ai_failed', code: e.code });
      }
      out.source = 'fallback'; out.aiPaused = true;
    } else { out.source = 'fallback'; out.aiPaused = aiAvailable; }
    out.reply = 'I am not able to answer that here right now. You can request a call back, send an enquiry, or email the team and they will reply.';
    out.links = ['enquiry', 'demo'];
    return json(out);
  }

  async function slots(request) {
    guard(request); await ipLimit(request);
    const body = await readJson(request, 2048);
    await convOf(body);
    if (!bookingAvailable) throw err('BOOKING_UNAVAILABLE', 'Online booking is not open yet. Please use the enquiry form.', {}, 503);
    return json(await booking.listSlots({ type: body.type, from: body.from, days: body.days }));
  }

  async function propose(request) {
    guard(request); await ipLimit(request);
    const body = await readJson(request, 4096);
    const cid = await convOf(body);
    if (!bookingAvailable) throw err('BOOKING_UNAVAILABLE', 'Online booking is not open yet. Please use the enquiry form.', {}, 503);
    if (body.bookingConsent !== true) throw err('BAD_REQUEST', 'Please tick the box to agree to your name and email being used to make this booking.');
    return json(await booking.propose({ type: body.type, slotStart: body.slotStart, name: body.name, email: body.email, marketingOptIn: body.marketingOptIn === true, convId: cid }));
  }

  async function confirm(request) {
    guard(request); await ipLimit(request);
    const ip = clientIp(request);
    const body = await readJson(request, 4096);
    const cid = await convOf(body);
    if (!bookingAvailable) throw err('BOOKING_UNAVAILABLE', 'Online booking is not open yet. Please use the enquiry form.', {}, 503);
    await limit(`cc:ip:conf:${ip}`, 3600, cfg.ipConfirmsPerHour, 'Too many booking attempts. Please try again later or use the enquiry form.');
    await limit(`cc:conv:conf:${cid}`, 86400, 6, 'Too many booking attempts for this chat. Please use the enquiry form.');
    const p = await verifyBlob(body.proposalToken, secret, now(), 'prop');
    if (p && body.confirm === true) await limit(`cc:em:${await sha256Hex(`${secret}|${p.e}`)}`, 86400, cfg.emailBookingsPerDay * 3, 'Too many bookings for that email address today.'); // hashed, counter only
    const r = await booking.confirm({ proposalToken: body.proposalToken, idemKey: body.idemKey, userConfirmed: body.confirm === true, convId: cid });
    return json({ ...r, testMode: mode === 'test' || undefined }, r.state === 'confirmed' || r.state === 'requested' ? 200 : r.state === 'failed' ? 409 : 202);
  }

  // ---- Request a call back (default flow). The only place a visitor request becomes an email to the owner. ----
  const TIMES = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', note: 'See note' };
  const TYPE_LABEL = { homeowner: 'Homeowner', builder: 'Builder', developer: 'Developer or estate', agent: 'Real estate agent', other: 'Other' };
  const refFrom = async (cid, idem) => {
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${secret}|cb|${cid}|${idem}`));
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return `GI-${Array.from(new Uint8Array(h).slice(0, 5), (b) => A[b % A.length]).join('')}`;
  };
  async function callback(request) {
    guard(request); await ipLimit(request);
    const ip = clientIp(request);
    const body = await readJson(request, 8192);
    const cid = await convOf(body);
    if (!callbackAvailable) throw err('CALLBACK_UNAVAILABLE', 'Call back requests are not available right now. Please use the enquiry form.', {}, 503);
    // Explicit click only: a literal boolean from the Confirm button. Model text can never produce this request.
    if (body.confirm !== true) throw err('CONFIRM_REQUIRED', 'Please press the send button to send your request.', {}, 400);
    if (body.consent !== true) throw err('BAD_REQUEST', 'Please tick the box to agree to Glide Inside calling you back about your request.');
    if (typeof body.idemKey !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(body.idemKey)) throw err('BAD_REQUEST', 'This request is not valid. Please reload and try again.');
    const type = TYPE_LABEL[body.type] ? body.type : 'other';
    const timeKey = TIMES[body.bestTime] ? body.bestTime : '';
    const timeNote = text(body.bestTimeNote, 120).replace(/\s+/g, ' ');
    if (!timeKey && !timeNote) throw err('BAD_REQUEST', 'Please tell us the best time to call: morning, afternoon, evening, or add a note.');
    const bestTime = [timeKey && timeKey !== 'note' ? TIMES[timeKey] : '', timeNote].filter(Boolean).join(': ');
    const page = /^\/[A-Za-z0-9\-_/.]{0,78}$/.test(String(body.page || '')) ? String(body.page) : '';
    const campaign = /^[A-Za-z0-9._-]{1,60}$/.test(String(body.campaign || '')) ? String(body.campaign) : '';
    const userNotes = text(body.notes, 1000);
    const marketing = body.marketingOptIn === true;
    const label = `Call back request (${TYPE_LABEL[type]})`;
    const notes = [label, `Best time to call: ${bestTime || 'not given'}`, userNotes ? `Notes: ${userNotes}` : null, page ? `Page: ${page}` : null, campaign ? `Campaign: ${campaign}` : null, `Marketing updates: ${marketing ? 'yes' : 'no'}`].filter(Boolean).join('\n');
    const enquiryBody = { consent: true, name: body.name, phone: body.phone, email: body.email, need: 'callback', source: 'public', notes, userNotes,
      callback: { type: TYPE_LABEL[type], bestTime, page, campaign, marketing } };
    parseEnquiry(enquiryBody); // the existing validation (name, phone, email); invalid requests do not use up the rate limit
    // Duplicate submit: one attempt key makes one request. A replay (double click, retry) returns the same reference and sends nothing again.
    const reference = await refFrom(cid, body.idemKey);
    const seen = await store.hitRate(`cc:cb:idem:${await sha256Hex(`${cid}|${body.idemKey}`)}`, 86400, now());
    if (seen > 1) return json({ ok: true, state: 'callback_requested', reference, duplicate: true });
    await limit(`cc:ip:cb:${ip}`, 3600, cfg.ipCallbacksPerHour, 'Too many requests. Please try again later or use the enquiry form.');
    await limit(`cc:conv:cb:${cid}`, 86400, 3, 'Too many requests for this chat. Please use the enquiry form.');
    let emailed = false;
    try {
      const r = await handleEnquiry({ body: enquiryBody, request, store, config: baseConfig, fetchImpl: doFetch, now, clientIp, reference });
      emailed = r.emailed === true;
    } catch (e) {
      // Email failure: the request is already saved (enquiry.js saves first), so the visitor is not told it failed.
      if (e instanceof HttpError && e.code === 'EMAIL_FAILED') log({ event: 'concierge_callback_email_failed' });
      else throw e;
    }
    log({ event: 'concierge_callback', type, emailed }); // no personal data in logs
    return json({ ok: true, state: 'callback_requested', reference, emailed });
  }

  async function status(request) {
    guard(request); await ipLimit(request);
    const body = await readJson(request, 4096);
    await convOf(body);
    if (!booking) throw err('BOOKING_UNAVAILABLE', 'Online booking is not open yet.', {}, 503);
    return json(await booking.status({ proposalToken: body.proposalToken }));
  }

  async function manage(request) {
    guard(request); await ipLimit(request);
    await limit(`cc:ip:manage:${clientIp(request)}`, 3600, 20);
    const body = await readJson(request, 2048);
    if (!booking) throw err('BOOKING_UNAVAILABLE', 'Online booking is not open yet.', {}, 503);
    return json(await booking.manage({ ref: body.ref, ownerToken: body.ownerToken, action: body.action }));
  }

  async function route(request, url, path) {
    const m = request.method;
    const need = (...ms) => { if (!ms.includes(m)) throw err('BAD_REQUEST', `Use ${ms.join(' or ')} for this endpoint.`, {}, 405); };
    if (path === '/concierge/config') { need('GET'); if (!cfg.enabled) return json({ enabled: false }); await ipLimit(request); return json(publicConfig()); }
    const handlers = { '/concierge/callback': callback, '/concierge/session': session, '/concierge/message': message, '/concierge/slots': slots, '/concierge/propose': propose, '/concierge/confirm': confirm, '/concierge/status': status, '/concierge/manage': manage };
    if (handlers[path]) { need('POST'); return handlers[path](request); }
    return null;
  }

  return { route, config: cfg, mode, provider, booking, bstore, publicConfig, bookingAvailable, callbackAvailable, aiAvailable };
}
