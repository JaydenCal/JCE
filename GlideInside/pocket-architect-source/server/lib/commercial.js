// Commercial mode billing and access (owner decision 15/11/2026):
//   * Commercial Developer subscription: A$50 per month (GST inclusive), Stripe Checkout in subscription mode, unlimited commercial plan set
//     PDFs. The AI assistant is LIMITED (owner change 15/11/2026): a monthly allowance of messages (COMMERCIAL_AI_MONTHLY, default 100) that
//     resets with each billing period, then one-off Stripe top-up packs (COMMERCIAL_AI_TOPUP_QTY messages, default 100) that roll over
//     while the subscription stays active. The allowance and the top-ups are ordinary entitlement rows, so the existing guarded
//     reserve, settle and release store operations are reused. One message = one assistant request that reached the model.
//   * ONE shared trial login (username and password typed by the owner in the admin screen), role 'commercial_trial': unlimited plan set
//     PDFs (watermarked unless COMMERCIAL_TRIAL_WATERMARK=0), a total allowance of assistant messages (COMMERCIAL_TRIAL_AI_TOTAL, default 50)
//     that the owner can reset, no top-ups, optional daily PDF cap and optional expiry date (both off by default).
// Both are stored without new tables: the subscription is an entitlement row (id csub_..., project '*', the Stripe subscription id in the
// payment_intent column, status active / past_due / canceled, expires_at = the paid period end), and the trial login is one JSON value in
// portal_settings. Failed card payments get a grace period (owner decision 15/11/2026, COMMERCIAL_GRACE_DAYS, default 3): while Stripe says
// past_due the subscription keeps working for that many days from the FIRST failed invoice, then it locks. The first failure time is one
// marker entitlement row (id cgrace:<csub id>, project 'csubgrace', expires_at holding the start time, status active while the episode is
// open and recovered once the card works again), so there is still no new table. Passwords are only ever hashed (password.js, PBKDF2) and never logged or returned.

import { migrate, validate } from '../../src/model/schema.js';
import { passwordProblem } from '../../src/portal/credentials.js';
import { sydneyDayStartPlus } from '../../src/portal/billing.js';
import { HttpError, json, readJson, clientIp, bearerToken } from './http.js';
import { signToken, verifyToken } from './entitlement.js';
import { countLoginAttempt, clearLoginCounters } from './login-guard.js';
import { hashPassword, verifyPassword, dummyVerify, secretEqual, randomBytes, hex } from './password.js';
import * as credits from './credits.js';
import * as stripe from './stripe.js';

const DAY = 86400000;
export const SUB_PREFIX = 'csub_';
const GRACE_PREFIX = 'cgrace:';
export const TRIAL_ROLE = 'commercial_trial';
export const TRIAL_KEY = 'commercial_trial';
const PROJ_INDEX_KEY = 'commercial_trial_projects';
const MAX_TRIAL_PROJECTS = 20;
export const COMMERCIAL_EXPORT_TYPES = ['pdf', 'dxf'];
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,39}$/;

const rid = (prefix) => `${prefix}_${hex(randomBytes(10))}`;
const sydneyDayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' });
export const sydneyDay = (ms) => sydneyDayFmt.format(new Date(ms)); // YYYY-MM-DD
const sydneyMonthKey = (ms) => sydneyDay(ms).slice(0, 7);

/** Effective subscription status: stored status, and 'ended' once the paid period has passed. */
export function subStatus(ent, nowMs) {
  if (!ent) return 'none';
  if (ent.status !== 'active') return ent.status === 'past_due' ? 'past_due' : 'canceled';
  if (ent.expiresAt && Date.parse(ent.expiresAt) <= nowMs) return 'ended';
  return 'active';
}

const periodEndOf = (sub) => {
  const s = Number(sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end);
  return Number.isFinite(s) && s > 0 ? new Date(s * 1000).toISOString() : null;
};
const mapStripeStatus = (s) => (s === 'active' || s === 'trialing' ? 'active' : s === 'past_due' ? 'past_due' : 'canceled');
const idOf = (v) => (typeof v === 'string' ? v : v?.id || null);

export function createCommercial({ store, pstore = null, config, fetchImpl, now = () => Date.now() }) {
  const iso = (ms = now()) => new Date(ms).toISOString();
  const needPstore = () => {
    if (!pstore) throw new HttpError('PORTAL_NOT_CONFIGURED', 'The commercial trial login is not available on this server.');
    return pstore;
  };

  // Subscription ----------------------------------------------------------------------------------------------------------------
  const topUpAvailable = () => !!(config.stripeSecretKey && config.commercialAiTopupPriceId && config.entitlementSecret);
  const subscribable = () => !!(config.stripeSecretKey && config.commercialSubPriceId && config.entitlementSecret);

  async function subToken(ent) {
    return signToken({ eid: ent.id, pid: '*', exp: Math.floor(now() / 1000) + Math.round(config.entitlementDays * 86400) }, config.entitlementSecret);
  }

  // Failed payment grace period -------------------------------------------------------------------------------------------------
  const graceId = (ent) => `${GRACE_PREFIX}${ent.id}`;
  const graceDays = () => Math.max(0, Number(config.commercialGraceDays) || 0);

  /** { active, startedAt, endsAt, daysLeft } while the subscription is past_due with an open marker, else null. daysLeft counts part days up. */
  async function graceOf(ent, nowMs = now()) {
    if (!ent || ent.status !== 'past_due') return null;
    const marker = await store.getEntitlement(graceId(ent));
    const start = marker && marker.status === 'active' && marker.expiresAt ? Date.parse(marker.expiresAt) : NaN;
    if (!Number.isFinite(start)) return null;
    const endsMs = start + graceDays() * DAY;
    return { active: nowMs < endsMs, startedAt: iso(start), endsAt: iso(endsMs), daysLeft: Math.max(0, Math.ceil((endsMs - nowMs) / DAY)) };
  }

  /** The first failed invoice opens the episode; later failures in the same episode keep the first time. */
  async function startGrace(ent, atMs) {
    const id = graceId(ent);
    const startIso = iso(Number.isFinite(atMs) && atMs > 0 ? atMs : now());
    const r = await store.createEntitlement({ id, projectId: 'csubgrace', email: null, stripeSessionId: `cgrace-s:${ent.id}`, amountCents: 0, currency: 'aud', creditsTotal: 0, status: 'active', createdAt: iso(), expiresAt: startIso });
    if (r.created) return;
    const marker = await store.getEntitlement(id);
    if (marker && marker.status !== 'active') {
      await store.setEntitlementExpiry(id, startIso); // a new episode after the card had recovered
      await store.setEntitlementStatus(id, 'active');
    }
  }

  /** The card works again (or the subscription ended): the episode is over. */
  async function endGrace(ent) {
    const marker = await store.getEntitlement(graceId(ent));
    if (marker && marker.status === 'active') await store.setEntitlementStatus(marker.id, 'recovered');
  }

  /** Whether the subscription may be used now: active, or past_due inside the grace period. */
  const usable = (st, grace) => st === 'active' || (st === 'past_due' && !!grace?.active);

  const subView = (ent, grace = null) => ({
    kind: 'subscription',
    plan: 'Commercial Developer',
    priceAud: config.commercialSubPriceAud,
    gstInclusive: true,
    interval: 'month',
    status: subStatus(ent, now()),
    currentPeriodEnd: ent.expiresAt || null, // ISO; the screens show DD/MM/YYYY
    receipt: ent.id,
    unlimitedPlanSets: true,
    aiMonthly: config.commercialAiMonthly,
    ...(grace?.active ? { grace: { endsAt: grace.endsAt, daysLeft: grace.daysLeft, days: graceDays() } } : {}),
  });
  const viewOf = async (ent) => subView(ent, await graceOf(ent));

  /** Create, or refresh, the subscription entitlement from a completed subscription Checkout Session. Idempotent. */
  async function fromSession(session) {
    if (session.metadata?.app && session.metadata.app !== stripe.STRIPE_APP_TAG) return 'ignored: session belongs to another app';
    if (session.metadata?.kind !== stripe.COMMERCIAL_SUB_KIND) return 'ignored: not a commercial subscription';
    if (!['paid', 'no_payment_required'].includes(session.payment_status)) return 'ignored: not paid';
    const subId = idOf(session.subscription);
    if (!subId) return 'ignored: no subscription id';
    const sub = await stripe.retrieveSubscription({ config, fetchImpl, subscriptionId: subId });
    const status = sub ? mapStripeStatus(sub.status) : 'active';
    const end = periodEndOf(sub) || iso(now() + 31 * DAY); // replaced by the true period end on the next subscription event
    const existing = await store.getEntitlementByPaymentIntent(subId);
    if (existing && existing.id.startsWith(SUB_PREFIX)) {
      await store.setEntitlementStatus(existing.id, status);
      await store.setEntitlementExpiry(existing.id, end);
      if (status === 'active') await endGrace(existing);
      return 'subscription refreshed';
    }
    const r = await store.createEntitlement({
      id: rid('csub'), projectId: '*',
      email: String(session.customer_details?.email || session.customer_email || '').toLowerCase().trim() || null,
      stripeSessionId: session.id, stripePaymentIntent: subId, amountCents: session.amount_total ?? null, currency: session.currency ?? null,
      creditsTotal: 0, status, createdAt: iso(), expiresAt: end,
    });
    return r.created ? 'subscription created' : 'duplicate: subscription already exists';
  }

  /**
   * Act on a verified Stripe event that concerns the commercial subscription. Returns a status string, or null when the event is not one
   * of ours (the caller then uses the ordinary Plan Pack handler).
   */
  async function handleEvent(event) {
    const obj = event?.data?.object || {};
    switch (event?.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        if (obj.mode === 'subscription') return fromSession(obj);
        if (obj.mode === 'payment' && obj.metadata?.kind === stripe.COMMERCIAL_AI_TOPUP_KIND) return grantTopUp(obj);
        return null;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const ent = await store.getEntitlementByPaymentIntent(obj.id);
        if (!ent || !ent.id.startsWith(SUB_PREFIX)) return 'ignored: no commercial subscription for this id';
        const status = event.type === 'customer.subscription.deleted' ? 'canceled' : mapStripeStatus(obj.status);
        await store.setEntitlementStatus(ent.id, status);
        const end = periodEndOf(obj);
        if (end) await store.setEntitlementExpiry(ent.id, end);
        if (status === 'past_due') await startGrace(ent, (Number(event.created) || 0) * 1000); // keeps the first failure time when one is already open
        else await endGrace(ent);
        return `subscription ${status}`;
      }
      case 'invoice.payment_failed': {
        const subId = idOf(obj.subscription) || idOf(obj.parent?.subscription_details?.subscription);
        if (!subId) return null;
        const ent = await store.getEntitlementByPaymentIntent(subId);
        if (!ent || !ent.id.startsWith(SUB_PREFIX)) return 'ignored: no commercial subscription for this invoice';
        if (ent.status === 'active') await store.setEntitlementStatus(ent.id, 'past_due');
        // The grace period runs from the first failed invoice, not from the retries Stripe makes after it.
        await startGrace(ent, (Number(obj.created) || Number(event.created) || 0) * 1000);
        return 'subscription past due';
      }
      default:
        return null;
    }
  }

  async function subscribe(request) {
    const body = await readJson(request, 4096).catch(() => ({}));
    if (!subscribable()) throw new HttpError('SUBSCRIPTION_COMING_SOON', 'The Commercial Developer subscription is coming soon.');
    const byIp = await store.hitRate(`csub:ip:${clientIp(request)}`, 3600, now());
    if (byIp > config.checkoutRateMax) throw new HttpError('RATE_LIMITED', 'Too many attempts. Please wait a while and try again.', { retryAfter: 600 });
    const session = await stripe.createSubscriptionCheckout({ config, fetchImpl, email: body.email });
    return json({ url: session.url });
  }

  async function subscriptionGet(url) {
    const sessionId = (url.searchParams.get('session_id') || '').trim();
    if (!/^cs_[A-Za-z0-9_]{6,200}$/.test(sessionId)) throw new HttpError('BAD_REQUEST', 'session_id is missing or invalid.');
    let ent = await store.getEntitlementBySession(sessionId);
    if (!ent) {
      // The webhook can be slower than the customer's return: ask Stripe once and create the same entitlement.
      const session = await stripe.retrieveCheckoutSession({ config, fetchImpl, sessionId });
      if (session?.mode === 'subscription') await fromSession(session);
      ent = await store.getEntitlementBySession(sessionId);
    }
    if (!ent || !ent.id.startsWith(SUB_PREFIX)) throw new HttpError('NOT_ENTITLED', 'Your subscription has not been confirmed yet.', { pending: true }, 404);
    const grace = await graceOf(ent);
    if (!usable(subStatus(ent, now()), grace)) throw new HttpError('NOT_ENTITLED', 'This subscription is not active.');
    return json({ token: await subToken(ent), subscription: subView(ent, grace) });
  }

  async function subscriptionRestore(request) {
    const body = await readJson(request, 4096);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const ref = typeof body.sessionOrReceipt === 'string' ? body.sessionOrReceipt.trim() : '';
    if (!/^[^@\s]+@[^@\s]+$/.test(email) || ref.length < 6 || ref.length > 200) throw new HttpError('BAD_REQUEST', 'Enter the email address used at checkout and the receipt reference.');
    const nowMs = now();
    if ((await store.hitRate(`csub:restore:ip:${clientIp(request)}`, 600, nowMs)) > 8 || (await store.hitRate(`csub:restore:email:${email}`, 3600, nowMs)) > 5) {
      throw new HttpError('RATE_LIMITED', 'Too many attempts. Try again later.', { retryAfter: 600 });
    }
    const ent = await store.findForRestore(email, ref);
    const grace = ent && ent.id.startsWith(SUB_PREFIX) ? await graceOf(ent, nowMs) : null;
    if (!ent || !ent.id.startsWith(SUB_PREFIX) || !usable(subStatus(ent, nowMs), grace)) throw new HttpError('NOT_ENTITLED', 'We could not find an active subscription with those details.');
    return json({ token: await subToken(ent), subscription: subView(ent, grace) });
  }

  async function billingPortal(request) {
    const acct = await account(request);
    if (!acct) throw new HttpError('UNAUTHORISED', 'Sign in to manage billing.');
    if (acct.sub !== 'subscription') throw new HttpError('FORBIDDEN', 'Billing is not available for this login.');
    const sub = await stripe.retrieveSubscription({ config, fetchImpl, subscriptionId: acct.ent.stripePaymentIntent });
    const customerId = idOf(sub?.customer);
    if (!customerId) throw new HttpError('PAYMENTS_UNAVAILABLE', 'The billing page could not be opened. Try again shortly.');
    return json(await stripe.createPortalSession({ config, fetchImpl, customerId }));
  }

  // Trial login record ----------------------------------------------------------------------------------------------------------
  async function loadTrial() {
    const raw = await needPstore().getSetting(TRIAL_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const saveTrial = (rec) => needPstore().setSetting(TRIAL_KEY, JSON.stringify(rec));
  const emptyUsage = () => ({ pdf: 0, dxf: 0, ai: 0, logins: 0, days: {} });
  const todayOf = (rec) => ({ pdf: 0, ai: 0, ...(rec.usage?.days?.[sydneyDay(now())] || {}) });
  const trialExpired = (rec) => !!rec.expiresAt && Date.parse(rec.expiresAt) <= now();

  function bump(rec, key) {
    rec.usage = { ...emptyUsage(), ...(rec.usage || {}) };
    rec.usage[key] = (rec.usage[key] || 0) + 1;
    const d = sydneyDay(now());
    if (key === 'pdf' || key === 'ai') rec.usage.days[d] = { pdf: 0, ai: 0, ...(rec.usage.days[d] || {}), [key]: ((rec.usage.days[d] || {})[key] || 0) + 1 };
    // keep about six weeks of day counters
    for (const k of Object.keys(rec.usage.days)) if (Date.parse(`${k}T00:00:00Z`) < now() - 45 * DAY) delete rec.usage.days[k];
    rec.lastUsedAt = iso();
  }

  const trialView = (rec) => ({
    kind: 'trial', role: TRIAL_ROLE, plan: 'Commercial trial', username: rec.username, expiresAt: rec.expiresAt || null,
    unlimitedPlanSets: !config.commercialTrialDailyPdfs,
    watermark: config.commercialTrialWatermark, caps: { dailyPdfs: config.commercialTrialDailyPdfs || null, aiTotal: config.commercialTrialAiTotal },
    today: todayOf(rec), keepDays: config.commercialTrialKeepDays,
  });

  // Accounts for the AI and export handlers -------------------------------------------------------------------------------------
  /** The commercial account behind the request's bearer token (subscription or trial), or null when it is some other kind of token. */
  async function account(request) {
    const token = bearerToken(request);
    if (!token) return null;
    const nowMs = now();
    const payload = await verifyToken(token, config.entitlementSecret, Math.floor(nowMs / 1000));
    if (!payload) return null;
    if (payload.ct === 1) return trialAccount(payload);
    if (typeof payload.eid === 'string' && payload.eid.startsWith(SUB_PREFIX)) return subAccount(payload);
    return null;
  }

  const WARN = [0.8]; // the assistant panel warns at 80 percent of the allowance

  /** The snapshot the assistant panel reads (see src/premium/credits.js): messages left, 80 percent warning, and the top-up offer. */
  const topUpOffer = (allowed) => ({ allowed, available: !!config.commercialAiTopupPriceId, messages: config.commercialAiTopupQty, priceAud: config.commercialAiTopupPriceAud });

  async function subAccount(payload) {
    const nowMs = now();
    const ent = await store.getEntitlement(payload.eid);
    if (!ent || ent.projectId !== '*') throw new HttpError('NOT_ENTITLED', 'No Commercial Developer subscription was found.');
    const st = subStatus(ent, nowMs);
    const grace = await graceOf(ent, nowMs);
    if (!usable(st, grace)) {
      throw new HttpError('NOT_ENTITLED', st === 'past_due' ? `The last subscription payment did not go through and the ${graceDays()} day grace period has ended. Update your card under Manage billing.` : 'This Commercial Developer subscription is no longer active.');
    }
    // One monthly pool per billing period (a new period end means a new pool, so the allowance resets on renewal) and one top-up pool that
    // carries over for as long as this subscription lives.
    const periodEndMs = ent.expiresAt ? Date.parse(ent.expiresAt) : nowMs + 31 * DAY;
    const monthlyId = `caim:${ent.id}:${periodEndMs}`;
    const topUpId = `caitop:${ent.id}`;
    const ensure = async () => {
      const base = { projectId: 'csubai', email: null, amountCents: 0, currency: 'aud', status: 'active', createdAt: iso(nowMs) };
      await store.createEntitlement({ ...base, id: monthlyId, stripeSessionId: `caim-s:${monthlyId}`, creditsTotal: config.commercialAiMonthly, expiresAt: iso(periodEndMs) });
      await store.createEntitlement({ ...base, id: topUpId, stripeSessionId: `caitop-s:${topUpId}`, creditsTotal: 0, expiresAt: null });
    };
    const pools = async () => {
      await ensure();
      return { m: await store.getEntitlement(monthlyId), t: await store.getEntitlement(topUpId) };
    };
    const snapshot = async () => {
      const { m, t } = await pools();
      const b = credits.orgBalance(m, t);
      return {
        kind: 'commercial', commercial: true, unit: 'messages', total: b.total, used: b.used, remaining: b.remaining, reserved: b.reserved,
        warnLevel: credits.warnLevel(b.used + b.reserved, b.total, WARN), topUpRemaining: b.topUpRemaining, available: b.available,
        renewsOn: ent.expiresAt || null, topUp: undefined, commercialTopUp: topUpOffer(true),
        ...(grace?.active ? { paymentGrace: { endsAt: grace.endsAt, daysLeft: grace.daysLeft } } : {}),
      };
    };
    const ai = {
      kind: 'commercial', messageBased: true, id: monthlyId, logId: ent.id, accountKind: 'subscription', email: ent.email, rateKey: `csub:${ent.id}`, snapshot,
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
      async crossed(res, charged) {
        const { m } = await pools();
        const split = credits.splitCharge(charged, res.m, res.t);
        return credits.crossedThreshold(Math.max(0, m.creditsUsed - split.monthly), m.creditsUsed, m.creditsTotal, WARN);
      },
      exhaustedDetails: async () => ({ commercialTopUp: topUpOffer(true), renewsOn: ent.expiresAt || null }),
    };
    return {
      kind: 'commercial', sub: 'subscription', id: ent.id, ent, rateKey: `csub:${ent.id}`, watermark: false, ai, topUpId, ensure,
      view: () => subView(ent, grace),
      async beforeExport() {},
      async afterExport() {},
    };
  }

  async function trialAccount(payload) {
    const rec = await loadTrial();
    if (!rec || rec.id !== payload.tid || rec.epoch !== payload.ep) throw new HttpError('UNAUTHORISED', 'Please sign in again.');
    if (rec.disabled) throw new HttpError('TRIAL_DISABLED', 'This trial login has been switched off.');
    if (trialExpired(rec)) throw new HttpError('TRIAL_EXPIRED', 'This trial login has expired.');
    const total = config.commercialTrialAiTotal;
    // L1 (pre-launch load test F1): the allowance lives in an entitlement row and is taken with the same guarded reservation as the
    // subscription pool (reserveCredits: used + reserved + n <= total, one statement), so parallel requests can never overspend it.
    const poolId = `ctai:${rec.id}`;
    const ensurePool = async () => {
      const made = await store.createEntitlement({ id: poolId, projectId: 'ctrialai', email: null, stripeSessionId: `ctai-s:${poolId}`, amountCents: 0, currency: 'aud', status: 'active', createdAt: iso(), creditsTotal: total, expiresAt: null });
      if (made.created) {
        if (rec.aiUsed > 0) await store.settleCredits(poolId, 0, Math.min(total, rec.aiUsed)); // carry over what the old JSON counter had used
      } else if (made.entitlement && made.entitlement.creditsTotal !== total) {
        await store.addCredits(poolId, total - made.entitlement.creditsTotal); // the owner changed COMMERCIAL_TRIAL_AI_TOTAL
      }
      return store.getEntitlement(poolId);
    };
    const stateOf = (e) => {
      const used = Math.min(total, e?.creditsUsed || 0);
      return { total, used, remaining: Math.max(0, total - used - (e?.creditsReserved || 0)), reserved: e?.creditsReserved || 0 };
    };
    await ensurePool();
    const poolNow = async () => stateOf(await store.getEntitlement(poolId));
    const snapshot = async () => {
      const a = await poolNow();
      return { kind: 'commercial', commercial: true, trial: true, unit: 'messages', total: a.total, used: a.used, remaining: a.remaining, reserved: a.reserved, warnLevel: credits.warnLevel(a.used, a.total, WARN), topUpRemaining: 0, available: a.remaining, commercialTopUp: null };
    };
    const ai = {
      kind: 'commercial', messageBased: true, id: `ctrial:${rec.id}`, logId: `ctrial:${rec.id}`, accountKind: 'trial', rateKey: `ctrial:${rec.id}`, snapshot,
      available: async () => (await poolNow()).remaining,
      async reserve(n, nowIso) {
        return (await store.reserveCredits(poolId, n, nowIso)) ? { m: n, t: 0 } : null;
      },
      async settle(res, charged) {
        await store.settleCredits(poolId, res.m, charged);
        const fresh = (await loadTrial()) || rec;
        bump(fresh, 'ai'); // usage statistics only; the allowance itself is the pool row above
        await saveTrial(fresh);
        return { monthly: charged, topUp: 0 };
      },
      async release(res) {
        if (res?.m) await store.releaseCredits(poolId, res.m);
      },
      async crossed(res, charged) {
        const a = await poolNow();
        return credits.crossedThreshold(Math.max(0, a.used - charged), a.used, a.total, WARN);
      },
      exhaustedDetails: async () => ({ commercialTopUp: null, trial: true }),
    };
    return {
      kind: 'commercial', sub: 'trial', id: `ctrial:${rec.id}`, rateKey: `ctrial:${rec.id}`, watermark: config.commercialTrialWatermark, ai,
      view: async () => ({ ...trialView(rec), ai: await poolNow() }),
      async beforeExport(type) {
        const cap = config.commercialTrialDailyPdfs;
        if (type === 'pdf' && cap > 0 && todayOf((await loadTrial()) || rec).pdf >= cap) throw new HttpError('TRIAL_LIMIT', `The trial allows ${cap} plan set PDFs per day. Try again tomorrow.`);
      },
      async afterExport(type) {
        const fresh = (await loadTrial()) || rec;
        bump(fresh, type === 'pdf' ? 'pdf' : 'dxf');
        await saveTrial(fresh);
      },
    };
  }

  // AI top-up packs (one-off Stripe payment; the messages go into the top-up pool and roll over while the subscription is active) ---
  async function topUpCheckout(request) {
    const acct = await account(request);
    if (!acct) throw new HttpError('UNAUTHORISED', 'Sign in to buy more AI messages.');
    if (acct.sub !== 'subscription') throw new HttpError('FORBIDDEN', 'The trial login cannot buy more AI messages.');
    if (!config.stripeSecretKey || !config.commercialAiTopupPriceId || !config.entitlementSecret) throw new HttpError('SUBSCRIPTION_COMING_SOON', 'Extra AI messages are coming soon.');
    if ((await store.hitRate(`caitop:ip:${clientIp(request)}`, 3600, now())) > config.checkoutRateMax) throw new HttpError('RATE_LIMITED', 'Too many attempts. Please wait a while and try again.', { retryAfter: 600 });
    const s = await stripe.createAiTopUpCheckout({ config, fetchImpl, entId: acct.ent.id, email: acct.ent.email });
    return json({ url: s.url, messages: config.commercialAiTopupQty });
  }

  /** Credit one paid top-up Checkout Session, once (the session id is the idempotency key). Returns a status string. */
  async function grantTopUp(session, { entId = null } = {}) {
    if (session.metadata?.app !== stripe.STRIPE_APP_TAG || session.metadata?.kind !== stripe.COMMERCIAL_AI_TOPUP_KIND) return 'ignored: not a commercial AI top-up';
    if (session.payment_status !== 'paid') return 'ignored: not paid';
    const id = session.metadata.entId;
    if (typeof id !== 'string' || !id.startsWith(SUB_PREFIX) || (entId && entId !== id)) return 'ignored: bad subscription reference';
    const ent = await store.getEntitlement(id);
    if (!ent) return 'ignored: no subscription for this top-up';
    if (!(await store.claimWebhookEvent(`catop:${session.id}`, 'commercial-ai-topup', iso()))) return 'duplicate: top-up already credited';
    const qty = Number(session.metadata.messages);
    const messages = Number.isInteger(qty) && qty > 0 && qty <= 100000 ? qty : config.commercialAiTopupQty;
    try {
      const topUpId = `caitop:${id}`;
      await store.createEntitlement({ projectId: 'csubai', email: null, amountCents: 0, currency: 'aud', status: 'active', createdAt: iso(), id: topUpId, stripeSessionId: `caitop-s:${topUpId}`, creditsTotal: 0, expiresAt: null });
      await store.addCredits(topUpId, messages);
      await store.logEvent({ id: rid('catop'), type: 'commercial_ai_topup', detail: { entId: id, messages, session: session.id }, createdAt: iso() });
    } catch (e) {
      await store.releaseWebhookEvent(`catop:${session.id}`); // let Stripe retry
      throw e;
    }
    return `top-up credited: ${messages} messages`;
  }

  async function topUpConfirm(request, url) {
    const acct = await account(request);
    if (!acct || acct.sub !== 'subscription') throw new HttpError('UNAUTHORISED', 'Sign in to confirm a top-up.');
    const sessionId = (url.searchParams.get('session_id') || '').trim();
    if (!/^cs_[A-Za-z0-9_]{6,200}$/.test(sessionId)) throw new HttpError('BAD_REQUEST', 'session_id is missing or invalid.');
    // The webhook can be slower than the customer's return: ask Stripe once. grantTopUp is idempotent either way.
    const session = await stripe.retrieveCheckoutSession({ config, fetchImpl, sessionId });
    if (!session) throw new HttpError('NOT_ENTITLED', 'Your payment has not been confirmed yet.', { pending: true }, 404);
    const outcome = await grantTopUp(session, { entId: acct.ent.id });
    if (outcome.startsWith('ignored')) throw new HttpError('NOT_ENTITLED', 'Your payment has not been confirmed yet.', { pending: true }, 404);
    return json({ credits: await acct.ai.snapshot() });
  }

  // Trial login -----------------------------------------------------------------------------------------------------------------
  async function trialLogin(request) {
    const body = await readJson(request, 4096);
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase().slice(0, 60) : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const bad = () => new HttpError('INVALID_CREDENTIALS', 'That sign in did not work. Check the details and try again.');
    if (!username || !password || password.length > 512) throw bad();
    const nowMs = now();
    const ps = needPstore();
    // M1 and M4: the attempt is counted before the password is checked (atomic), per username AND address, with a higher per username ceiling.
    const attempt = await countLoginAttempt(ps, { scope: 'ct:', subject: username, request, nowMs, config });
    const rec = await loadTrial();
    const ok = rec && rec.username === username ? (await verifyPassword(password, rec.passwordHash)).ok : (await dummyVerify(password), false);
    if (!ok) throw attempt.failed();
    await attempt.succeeded();
    if (rec.disabled) throw new HttpError('TRIAL_DISABLED', 'This trial login has been switched off.');
    if (trialExpired(rec)) throw new HttpError('TRIAL_EXPIRED', 'This trial login has expired.');
    bump(rec, 'logins');
    rec.lastLoginAt = iso();
    await saveTrial(rec);
    const token = await signToken({ ct: 1, tid: rec.id, ep: rec.epoch, exp: Math.floor(nowMs / 1000) + Math.round(config.commercialTrialSessionHours * 3600) }, config.entitlementSecret);
    return json({ token, account: trialView(rec) });
  }

  async function accountGet(request) {
    const acct = await account(request);
    if (!acct) throw new HttpError('UNAUTHORISED', 'Sign in to see your account.');
    return json({ account: await acct.view() });
  }

  // Trial saved projects (only this one login can reach them; cleared after COMMERCIAL_TRIAL_KEEP_DAYS) ------------------------------
  const projKey = (id) => `ctp:${id}`;
  async function loadIndex() {
    const raw = await needPstore().getSetting(PROJ_INDEX_KEY);
    try {
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }
  /** Drop saved projects older than the keep period. Returns the index that remains. */
  async function sweepProjects() {
    const ps = needPstore();
    const list = await loadIndex();
    const cutoff = now() - config.commercialTrialKeepDays * DAY;
    const keep = list.filter((p) => Date.parse(p.updatedAt) > cutoff);
    for (const p of list) if (!keep.includes(p)) await ps.setSetting(projKey(p.id), '');
    if (keep.length !== list.length) await ps.setSetting(PROJ_INDEX_KEY, JSON.stringify(keep));
    return keep;
  }
  const projView = (p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, expiresAt: iso(Date.parse(p.updatedAt) + config.commercialTrialKeepDays * DAY) });
  async function trialOnly(request) {
    const acct = await account(request);
    if (!acct) throw new HttpError('UNAUTHORISED', 'Sign in with the trial login.');
    if (acct.sub !== 'trial') throw new HttpError('FORBIDDEN', 'Saved projects in this list are for the trial login.');
    return acct;
  }
  async function trialProjects(request, id) {
    await trialOnly(request);
    const ps = needPstore();
    const index = await sweepProjects();
    if (request.method === 'GET' && !id) return json(index.map(projView));
    if (request.method === 'GET') {
      const meta = index.find((p) => p.id === id);
      const raw = meta ? await ps.getSetting(projKey(id)) : null;
      if (!raw) throw new HttpError('NOT_FOUND', 'That project was not found.');
      return json({ ...projView(meta), project: JSON.parse(raw) });
    }
    if (request.method === 'DELETE' && id) {
      if (index.some((p) => p.id === id)) {
        await ps.setSetting(projKey(id), '');
        await ps.setSetting(PROJ_INDEX_KEY, JSON.stringify(index.filter((p) => p.id !== id)));
      }
      return json({ ok: true });
    }
    if (request.method === 'POST' && !id) {
      const body = await readJson(request, config.portalProjectMaxBytes + 100000);
      let project;
      try {
        project = migrate(body.project);
      } catch (e) {
        throw new HttpError('BAD_REQUEST', `The project could not be read: ${e.message}`);
      }
      if (project.mode !== 'commercial') throw new HttpError('BAD_REQUEST', 'The trial login saves commercial designs only.');
      if (validate(project).length) throw new HttpError('BAD_REQUEST', 'The project has problems and cannot be saved.');
      const text = JSON.stringify(project);
      if (text.length > config.portalProjectMaxBytes) throw new HttpError('PAYLOAD_TOO_LARGE', 'This project is too large to save.');
      const name = (typeof body.name === 'string' && body.name.trim() ? body.name.trim() : String(project.name || 'Commercial design')).slice(0, 80);
      const existing = typeof body.id === 'string' ? index.find((p) => p.id === body.id) : null;
      if (typeof body.id === 'string' && body.id && !existing) throw new HttpError('NOT_FOUND', 'That project was not found.');
      if (!existing && index.length >= MAX_TRIAL_PROJECTS) throw new HttpError('BAD_REQUEST', `The trial login keeps up to ${MAX_TRIAL_PROJECTS} saved projects. Delete one first.`);
      const meta = { id: existing?.id || rid('ctp'), name, updatedAt: iso() };
      await ps.setSetting(projKey(meta.id), text);
      await ps.setSetting(PROJ_INDEX_KEY, JSON.stringify([meta, ...index.filter((p) => p.id !== meta.id)]));
      return json(projView(meta));
    }
    throw new HttpError('BAD_REQUEST', 'That method is not allowed for this endpoint.', {}, 405);
  }

  // Owner only admin: create or reset, disable, expiry, usage --------------------------------------------------------------------
  async function adminAuth(request) {
    if (!config.adminToken) throw new HttpError('PORTAL_NOT_CONFIGURED', 'ADMIN_TOKEN is not set.');
    if ((await store.hitRate(`admin:${clientIp(request)}`, 600, now())) > 30) throw new HttpError('RATE_LIMITED', 'Too many attempts.', { retryAfter: 600 });
    const given = bearerToken(request);
    if (!given || !(await secretEqual(given, config.adminToken))) throw new HttpError('UNAUTHORISED', 'Not authorised.');
  }

  const trialPoolOf = (rec) => store.getEntitlement(`ctai:${rec.id}`);
  async function trialPoolView(rec) {
    const total = config.commercialTrialAiTotal;
    const e = await trialPoolOf(rec);
    const used = e ? Math.min(total, e.creditsUsed || 0) : Math.min(total, rec.aiUsed || 0); // no pool row yet: the old counter, if any
    return { total, used, remaining: Math.max(0, total - used) };
  }
  async function resetTrialPool(rec) {
    rec.aiUsed = 0;
    const e = await trialPoolOf(rec);
    if (e) await store.settleCredits(e.id, 0, -(e.creditsUsed || 0));
  }
  async function adminView(rec) {
    if (!rec) return { exists: false, caps: { dailyPdfs: config.commercialTrialDailyPdfs || null, aiTotal: config.commercialTrialAiTotal }, watermark: config.commercialTrialWatermark, keepDays: config.commercialTrialKeepDays };
    const u = { ...emptyUsage(), ...(rec.usage || {}) };
    return {
      exists: true, username: rec.username, disabled: !!rec.disabled, expiresAt: rec.expiresAt || null, expired: trialExpired(rec),
      createdAt: rec.createdAt, updatedAt: rec.updatedAt, lastLoginAt: rec.lastLoginAt || null, lastUsedAt: rec.lastUsedAt || null,
      usage: { pdf: u.pdf, dxf: u.dxf, ai: u.ai, logins: u.logins }, today: todayOf(rec),
      ai: await trialPoolView(rec),
      caps: { dailyPdfs: config.commercialTrialDailyPdfs || null, aiTotal: config.commercialTrialAiTotal }, watermark: config.commercialTrialWatermark,
      keepDays: config.commercialTrialKeepDays, projectCount: (await loadIndex()).length,
    };
  }

  /** "YYYY-MM-DD" (or empty / null for no expiry) to the instant the login stops working: 00:00 Sydney the day after that date. */
  function parseExpiry(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T12:00:00Z`))) throw new HttpError('BAD_REQUEST', 'The expiry date must be a date, or blank for no expiry.');
    return new Date(sydneyDayStartPlus(Date.parse(`${v}T12:00:00Z`), 1)).toISOString();
  }

  async function adminTrial(request, sub) {
    await adminAuth(request);
    const method = request.method;
    if (!sub && method === 'GET') return json(await adminView(await loadTrial()));
    if (!sub && method === 'PUT') {
      const body = await readJson(request, 4096);
      const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
      if (!USERNAME_RE.test(username)) throw new HttpError('BAD_REQUEST', 'The username needs 3 to 40 characters: letters, numbers, dot, dash or underscore.');
      const password = typeof body.password === 'string' ? body.password : '';
      if (password.length > 512) throw new HttpError('BAD_REQUEST', 'That password is too long.');
      const problem = passwordProblem(password, { username });
      if (problem) throw new HttpError('BAD_REQUEST', problem);
      const expiresAt = parseExpiry(body.expiresAt);
      const old = await loadTrial();
      const rec = {
        id: old?.id || rid('ctr'), username, passwordHash: await hashPassword(password), epoch: (old?.epoch || 0) + 1, disabled: false, expiresAt,
        createdAt: old?.createdAt || iso(), updatedAt: iso(), lastLoginAt: old?.lastLoginAt || null, lastUsedAt: old?.lastUsedAt || null, usage: old?.usage || emptyUsage(), aiUsed: old?.aiUsed || 0,
      };
      await saveTrial(rec); // epoch + 1 signs out every device that held the previous login
      await clearLoginCounters(needPstore(), { scope: 'ct:', subject: username });
      return json(await adminView(rec));
    }
    if (sub === '/settings' && method === 'POST') {
      const body = await readJson(request, 2048);
      const rec = await loadTrial();
      if (!rec) throw new HttpError('NOT_FOUND', 'There is no trial login yet. Create one first.');
      if (body.disabled !== undefined) {
        if (typeof body.disabled !== 'boolean') throw new HttpError('BAD_REQUEST', 'disabled must be true or false.');
        rec.disabled = body.disabled; // checked on every request, so it takes effect at once
      }
      if (body.expiresAt !== undefined) rec.expiresAt = parseExpiry(body.expiresAt);
      if (body.resetAi === true) await resetTrialPool(rec); // gives the trial a fresh allowance of messages
      rec.updatedAt = iso();
      await saveTrial(rec);
      return json(await adminView(rec));
    }
    throw new HttpError('NOT_FOUND', 'No such endpoint.');
  }

  /**
   * Owner only: actual assistant token usage and cost per account and month, from the per-message records (event type commercial_ai_use).
   * Costs use COMMERCIAL_AI_PRICE_*_PER_MTOK_USD. Returns { months: [{ month, accounts: [{ account, kind, email, messages, input, cacheRead, cacheWrite, output, costUsd }] , totals }] }.
   */
  async function adminUsage(request) {
    await adminAuth(request);
    const rows = await store.listEvents('commercial_ai_use');
    const by = new Map();
    for (const e of rows) {
      const d = e.detail || {};
      const month = sydneyMonthKey(Date.parse(e.createdAt));
      const key = `${month}|${d.account}`;
      const a = by.get(key) || { month, account: d.account, kind: d.kind, email: d.email || null, messages: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, costMicros: 0 };
      a.messages += d.messages || 1;
      a.input += d.inputTokens || 0;
      a.cacheRead += d.cacheReadTokens || 0;
      a.cacheWrite += d.cacheWriteTokens || 0;
      a.output += d.outputTokens || 0;
      a.costMicros += d.costUsdMicros || 0;
      by.set(key, a);
    }
    const months = new Map();
    for (const a of by.values()) {
      const m = months.get(a.month) || { month: a.month, accounts: [], totals: { messages: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, costUsd: 0 } };
      const { costMicros, ...rest } = a;
      const costUsd = Math.round(costMicros) / 1e6;
      m.accounts.push({ ...rest, costUsd });
      for (const k of ['messages', 'input', 'cacheRead', 'cacheWrite', 'output']) m.totals[k] += a[k];
      m.totals.costUsd += costUsd;
      months.set(a.month, m);
    }
    const out = [...months.values()].sort((x, y) => y.month.localeCompare(x.month));
    for (const m of out) m.accounts.sort((x, y) => y.costUsd - x.costUsd);
    return json({ model: config.commercialAiModel, priceUsdPerMtok: { input: config.commercialAiPriceInPerMtok, cacheWrite: config.commercialAiPriceCacheWritePerMtok, cacheRead: config.commercialAiPriceCacheReadPerMtok, output: config.commercialAiPriceOutPerMtok }, months: out });
  }

  // Router (the part of the path after /api) ------------------------------------------------------------------------------------
  async function route(request, url, path) {
    const method = request.method;
    const allow = (...m) => {
      if (!m.includes(method)) throw new HttpError('BAD_REQUEST', `Use ${m.join(' or ')} for this endpoint.`, {}, 405);
    };
    if (path === '/commercial/status') return allow('GET'), json({ subscribable: subscribable(), topUp: topUpAvailable(), trialLogin: !!pstore, priceAud: config.commercialSubPriceAud, aiMonthly: config.commercialAiMonthly, topUpMessages: config.commercialAiTopupQty, topUpPriceAud: config.commercialAiTopupPriceAud });
    if (path === '/commercial/subscribe') return allow('POST'), subscribe(request);
    if (path === '/commercial/subscription') return allow('GET'), subscriptionGet(url);
    if (path === '/commercial/subscription/restore') return allow('POST'), subscriptionRestore(request);
    if (path === '/commercial/ai-topup') return method === 'GET' ? topUpConfirm(request, url) : (allow('POST'), topUpCheckout(request));
    if (path === '/commercial/billing-portal') return allow('POST'), billingPortal(request);
    if (path === '/commercial/account') return allow('GET'), accountGet(request);
    if (path === '/commercial/trial/login') return allow('POST'), trialLogin(request);
    const proj = /^\/commercial\/trial\/projects(?:\/([\w-]{1,80}))?$/.exec(path);
    if (proj) return trialProjects(request, proj[1] || null);
    if (path === '/commercial/admin/usage') return allow('GET'), adminUsage(request);
    const admin = /^\/commercial\/admin\/trial(\/settings)?$/.exec(path);
    if (admin) return adminTrial(request, admin[1] || null);
    return null;
  }

  return { route, handleEvent, account, subscribable, topUpAvailable, sweepProjects: () => (pstore ? sweepProjects() : null), subToken, subView };
}
