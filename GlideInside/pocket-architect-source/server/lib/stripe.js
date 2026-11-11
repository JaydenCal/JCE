// Stripe over its REST API with fetch only (no SDK): Checkout Session creation, webhook signature
// verification and entitlement creation from webhook events. See docs/SCOPE.md 11.4.

import { HttpError } from './http.js';
import { hmacSha256, safeEqual } from './entitlement.js';

const API = 'https://api.stripe.com/v1';
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomId = (prefix) => `${prefix}_${hex(crypto.getRandomValues(new Uint8Array(12)))}`;

export function newEntitlementId() {
  return randomId('ent');
}

function withQuery(url, query) {
  return `${url}${url.includes('?') ? '&' : '?'}${query}`;
}

/** Create a hosted Checkout Session for one Plan Pack. Returns { id, url }. */
export const STRIPE_APP_TAG = 'pocket-architect'; // metadata.app, set by the live Worker since 15/10/2026

export async function createCheckoutSession({ config, fetchImpl, projectId, projectName, email = null }) {
  if (!config.stripeSecretKey) throw new HttpError('PAYMENTS_UNAVAILABLE', 'Payments not configured');
  const p = new URLSearchParams();
  p.set('mode', 'payment');
  p.set('currency', 'aud');
  p.set('client_reference_id', projectId);
  p.set('metadata[projectId]', projectId);
  p.set('metadata[app]', STRIPE_APP_TAG);
  p.set('payment_intent_data[metadata][projectId]', projectId);
  p.set('payment_intent_data[description]', `Plan Pack for ${projectName || projectId}`.slice(0, 200));
  // Carried over from the live Worker: a customer record and a Stripe invoice (the tax invoice for the A$35 including GST).
  p.set('customer_creation', 'always');
  p.set('invoice_creation[enabled]', 'true');
  p.set('invoice_creation[invoice_data][description]', `Plan Pack: ${projectName || projectId}`.slice(0, 200));
  p.set('invoice_creation[invoice_data][metadata][projectId]', projectId);
  if (typeof email === 'string' && email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) p.set('customer_email', email.trim());
  p.set('line_items[0][quantity]', '1');
  if (config.stripePriceId) {
    p.set('line_items[0][price]', config.stripePriceId);
  } else {
    p.set('line_items[0][price_data][currency]', 'aud');
    p.set('line_items[0][price_data][unit_amount]', String(config.planPackPriceCents));
    p.set('line_items[0][price_data][tax_behavior]', 'inclusive');
    p.set('line_items[0][price_data][product_data][name]', 'Plan Pack');
    p.set('line_items[0][price_data][product_data][description]', `AI design assistant and PDF, DXF and 3D exports for ${projectName || 'this design'}`.slice(0, 300));
  }
  p.set('success_url', withQuery(config.appUrl, `checkout=success&session_id={CHECKOUT_SESSION_ID}&project=${encodeURIComponent(projectId)}`));
  p.set('cancel_url', withQuery(config.appUrl, 'checkout=cancel'));
  p.set('locale', 'en-AU');
  let res;
  try {
    res = await fetchImpl(`${API}/checkout/sessions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.stripeSecretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: p.toString(),
    });
  } catch {
    throw new HttpError('PAYMENTS_UNAVAILABLE', 'Could not reach the payment provider. Try again shortly.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) {
    console.warn(JSON.stringify({ event: 'stripe_checkout_failed', status: res.status, type: data?.error?.type, code: data?.error?.code }));
    throw new HttpError('PAYMENTS_UNAVAILABLE', 'The payment page could not be created. Try again shortly.');
  }
  return { id: data.id, url: data.url };
}

/** Fetch a Checkout Session (used when the webhook is slower than the customer's return). Null on any failure. */
export async function retrieveCheckoutSession({ config, fetchImpl, sessionId }) {
  if (!config.stripeSecretKey) return null;
  try {
    const res = await fetchImpl(`${API}/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { authorization: `Bearer ${config.stripeSecretKey}` },
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/**
 * Verify a Stripe-Signature header: HMAC-SHA256 of `${t}.${rawBody}` against every v1 signature,
 * constant-time compare, 300 s tolerance. Returns { ok, reason }.
 */
export async function verifyStripeSignature({ rawBody, header, secret, nowSec, toleranceSec = 300 }) {
  if (!secret) return { ok: false, reason: 'no webhook secret configured' };
  if (!header) return { ok: false, reason: 'missing signature header' };
  let t = null;
  const sigs = [];
  for (const part of header.split(',')) {
    const [k, ...v] = part.trim().split('=');
    if (k === 't') t = Number(v.join('='));
    else if (k === 'v1') sigs.push(v.join('='));
  }
  if (!Number.isFinite(t) || !sigs.length) return { ok: false, reason: 'malformed signature header' };
  if (Math.abs(nowSec - t) > toleranceSec) return { ok: false, reason: 'timestamp outside tolerance' };
  const expected = new TextEncoder().encode(hex(await hmacSha256(secret, `${t}.${rawBody}`)));
  const ok = sigs.some((s) => safeEqual(expected, new TextEncoder().encode(s.toLowerCase())));
  return ok ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}

/**
 * Create the entitlement for a paid Checkout Session. Idempotent on the session id.
 * The checks are the live Worker's: a one-off AUD payment for this app, at least the Plan Pack price. A refund or dispute that
 * arrived before this event is honoured (the row is created refunded or disputed), so a late event cannot grant access.
 */
export async function entitlementFromSession({ session, store, config, now }) {
  const projectId = session.client_reference_id || session.metadata?.projectId;
  if (!projectId) return { ok: false, reason: 'no project id on session' };
  if (!/^[\w-]{1,80}$/.test(projectId)) return { ok: false, reason: 'invalid project id' };
  if (session.mode && session.mode !== 'payment') return { ok: false, reason: 'not a one-off payment' };
  if (session.metadata?.app && session.metadata.app !== STRIPE_APP_TAG) return { ok: false, reason: 'session belongs to another app' };
  if (session.metadata?.projectId && session.metadata.projectId !== projectId) return { ok: false, reason: 'project id mismatch' };
  if (String(session.currency || '').toLowerCase() !== 'aud' || !(Number(session.amount_total) >= config.planPackPriceCents)) {
    return { ok: false, reason: 'amount or currency does not match the Plan Pack' };
  }
  const nowMs = now();
  const created = new Date(nowMs).toISOString();
  const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
  let status = 'active';
  if (pi && store.hasWebhookEvent) {
    if (await store.hasWebhookEvent(`refund:${pi}`)) status = 'refunded';
    else if (await store.hasWebhookEvent(`dispute:${pi}`)) status = 'disputed';
  }
  const result = await store.createEntitlement({
    id: newEntitlementId(),
    projectId,
    email: String(session.customer_details?.email || session.customer_email || '').toLowerCase().trim() || null,
    stripeSessionId: session.id,
    stripePaymentIntent: pi,
    amountCents: session.amount_total ?? null,
    currency: session.currency ?? null,
    creditsTotal: config.planPackCredits,
    status,
    createdAt: created,
    expiresAt: new Date(nowMs + config.entitlementDays * 86400000).toISOString(),
  });
  return { ok: true, created: result.created, entitlement: result.entitlement };
}

const paymentIntentOf = (obj) => (typeof obj.payment_intent === 'string' ? obj.payment_intent : obj.payment_intent?.id || null);

/** Act on one verified Stripe event. Returns a short status string for logs. */
export async function handleStripeEvent({ event, store, config, now }) {
  const obj = event?.data?.object || {};
  const iso = () => new Date(now()).toISOString();
  switch (event?.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      if (obj.payment_status !== 'paid') return 'ignored: not paid';
      const r = await entitlementFromSession({ session: obj, store, config, now });
      if (!r.ok) return `ignored: ${r.reason}`;
      return r.created ? 'entitlement created' : 'duplicate: entitlement already exists';
    }
    case 'charge.refunded': {
      // Partial refunds keep access; a full refund ends it.
      if (obj.refunded === false && Number(obj.amount_refunded) < Number(obj.amount)) return 'ignored: partial refund';
      const pi = paymentIntentOf(obj);
      if (!pi) return 'ignored: no payment intent';
      // The marker lets a checkout event that arrives after the refund create the pack as refunded.
      if (store.claimWebhookEvent) await store.claimWebhookEvent(`refund:${pi}`, 'refund-marker', iso());
      const ent = await store.getEntitlementByPaymentIntent(pi);
      if (!ent) return 'ignored: no entitlement for payment intent';
      await store.setEntitlementStatus(ent.id, 'refunded');
      return 'entitlement refunded';
    }
    case 'charge.dispute.created': {
      const pi = paymentIntentOf(obj);
      if (!pi) return 'ignored: no payment intent';
      if (store.claimWebhookEvent) await store.claimWebhookEvent(`dispute:${pi}`, 'dispute-marker', iso());
      if (store.setStatusByPaymentIntent) await store.setStatusByPaymentIntent(pi, 'disputed', 'active');
      return 'entitlement held for dispute';
    }
    case 'charge.dispute.closed': {
      const pi = paymentIntentOf(obj);
      if (!pi || obj.status !== 'won') return 'ignored: dispute not won';
      if (store.releaseWebhookEvent) await store.releaseWebhookEvent(`dispute:${pi}`);
      if (store.setStatusByPaymentIntent) await store.setStatusByPaymentIntent(pi, 'active', 'disputed');
      return 'entitlement restored after dispute';
    }
    default:
      return `ignored: ${event?.type}`;
  }
}
