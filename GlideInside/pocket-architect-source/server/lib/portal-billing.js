// Portal billing (docs/PORTAL_API.md 4 and 5): month usage, tax invoice snapshots and Stripe invoices for the previous month.
//   A$20 incl. GST per client login, once, at the login's first sign in (login_issues, created by lib/portal.js).
//   A$10 incl. GST per AI top-up of 300 credits (the AI branch's `ai_topup` events in the main store).
// Stripe is used only through its REST API with fetch. An org with no card on file gets a send_invoice invoice (Stripe emails it; this
// server sends nothing). An org that added card details (Checkout in setup mode, see lib/portal.js) gets a charge_automatically
// invoice paid at once with its saved card.
// TEST MODE ONLY unless STRIPE_LIVE_BILLING_APPROVED=owner-written-go-ahead (see server/README.md).

import { monthKey, monthStartMs, previousMonthKey, summariseMonth, gstOfTotal, NEW_LOGIN_FEE_CENTS, TOPUP_FEE_CENTS, TOPUP_CREDITS, sydneyParts } from '../../src/portal/billing.js';
import { HttpError } from './http.js';

const DAY = 86400000;
const API = 'https://api.stripe.com/v1';
export const INVOICE_DUE_DAYS = 14;
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const randomId = (prefix) => `${prefix}_${[...crypto.getRandomValues(new Uint8Array(10))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;

/** Billing contact is complete when the buyer name, an 11 digit ABN and an email are present. */
export const contactComplete = (org) => !!(org.legalName && /^\d{11}$/.test(String(org.abn || '').replace(/\s+/g, '')) && org.billingEmail);

export async function topUpRows(store, orgId) {
  return (await store.listEvents('ai_topup'))
    .filter((e) => e.detail?.orgId === orgId)
    .map((e) => ({ id: e.id, loginId: e.detail.loginId, credits: Number(e.detail.credits) || TOPUP_CREDITS, amountCents: Number.isFinite(e.detail.amountCents) ? e.detail.amountCents : TOPUP_FEE_CENTS, createdAt: e.detail.createdAt || e.createdAt }));
}

/** GET /portal/billing/usage for one Sydney calendar month. */
export async function usageForMonth({ pstore, store, orgId, month, names }) {
  const issues = (await pstore.listLoginIssues(orgId)).map((i) => ({ id: i.id, loginId: i.loginId, clientName: i.clientName, chargedAt: i.issuedAt, amountCents: i.amountCents }));
  const s = summariseMonth({ issues, topUps: await topUpRows(store, orgId) }, month);
  return {
    month, timezone: 'Australia/Sydney',
    rates: { newLoginCents: NEW_LOGIN_FEE_CENTS, topUpCents: TOPUP_FEE_CENTS, topUpCredits: TOPUP_CREDITS },
    logins: s.logins.map((i) => ({ id: i.id, loginId: i.loginId, clientName: names.get(i.loginId) || i.clientName || '', firstSignInAt: i.chargedAt, amountCents: i.amountCents })),
    topUps: s.topUps.map((t) => ({ id: t.id, loginId: t.loginId, clientName: names.get(t.loginId) || '', credits: t.credits, amountCents: t.amountCents, createdAt: t.createdAt })),
    totals: { ...s.totals, gstCents: gstOfTotal(s.totals.totalCents) },
  };
}

export const invoiceNumber = (org, month) => `GI-${org.shortCode || String(org.id).slice(-4).toUpperCase()}-${month.replace('-', '')}`;

/** The tax invoice: seller name and ABN, "Tax invoice", date, description of supply, GST amount and total incl. GST. */
export function buildSnapshot({ org, config, month, usage, number, issuedAtMs, payment = null }) {
  const t = usage.totals;
  const card = payment ? payment.method === 'card' : !!org.paymentMethodId;
  const pay = payment || (card ? { method: 'card', brand: org.cardBrand || '', last4: org.cardLast4 || '' } : { method: 'invoice' });
  const lines = [
    { description: `New client logins first signed in during ${month} (A$${NEW_LOGIN_FEE_CENTS / 100} each, incl. GST)`, quantity: t.loginsCount, unitCents: t.loginsCount ? Math.round(t.loginsCents / t.loginsCount) : NEW_LOGIN_FEE_CENTS, totalCents: t.loginsCents },
    { description: `AI credit top-ups of ${config.topUpCredits} credits (A$${config.topUpCents / 100} each, incl. GST)`, quantity: t.topUpsCount, unitCents: t.topUpsCount ? Math.round(t.topUpsCents / t.topUpsCount) : config.topUpCents, totalCents: t.topUpsCents },
  ].filter((l) => l.quantity > 0);
  return {
    title: 'Tax invoice', number, month,
    issuedAt: new Date(issuedAtMs).toISOString(), dueAt: new Date(issuedAtMs + (card ? 0 : INVOICE_DUE_DAYS) * DAY).toISOString(), payment: pay,
    seller: { name: config.sellerName, abn: config.sellerAbn },
    buyer: { name: org.legalName, legalName: org.legalName, abn: org.abn, contact: org.billingName || '', email: org.billingEmail || '' },
    lines, subtotalExGstCents: t.totalCents - gstOfTotal(t.totalCents), gstCents: gstOfTotal(t.totalCents), totalInclGstCents: t.totalCents,
    logins: usage.logins, topUps: usage.topUps,
  };
}

// Stripe ----------------------------------------------------------------------------------------------------------------------
export async function stripeCall({ config, fetchImpl, method = 'POST', path, form, idempotencyKey }) {
  const key = config.stripeSecretKey;
  if (!key) throw new HttpError('BILLING_UNAVAILABLE', 'STRIPE_SECRET_KEY is not set.');
  if (/^(sk|rk)_live_/.test(key) && !config.stripeLiveBillingApproved) {
    throw new HttpError('BILLING_UNAVAILABLE', 'A live Stripe key is configured but live billing has not been approved. Use a test key (sk_test_...).');
  }
  const headers = { authorization: `Bearer ${key}` };
  let body;
  if (form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(form).toString();
  }
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  let res;
  try {
    res = await fetchImpl(`${API}${path}`, { method, headers, body });
  } catch {
    throw new HttpError('BILLING_UNAVAILABLE', 'Could not reach Stripe.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError('BILLING_UNAVAILABLE', `Stripe refused the request: ${String(data?.error?.message || res.status).slice(0, 200)}`, { status: res.status });
  return data;
}

async function gstTaxRate({ config, pstore, fetchImpl }) {
  if (config.stripeGstTaxRateId) return config.stripeGstTaxRateId;
  const saved = await pstore.getSetting('stripe_gst_tax_rate');
  if (saved) return saved;
  const rate = await stripeCall({ config, fetchImpl, path: '/tax_rates', idempotencyKey: 'gi-gst-tax-rate', form: { display_name: 'GST', description: 'Goods and services tax (included in the price)', percentage: '10', inclusive: 'true', country: 'AU', tax_type: 'gst' } });
  await pstore.setSetting('stripe_gst_tax_rate', rate.id);
  return rate.id;
}

export async function ensureCustomer({ config, pstore, fetchImpl, org }) {
  if (org.stripeCustomerId) return org.stripeCustomerId;
  const form = { name: org.legalName, email: org.billingEmail, 'metadata[org_id]': org.id, 'metadata[abn]': org.abn, 'metadata[short_code]': org.shortCode || '' };
  if (org.billingPhone) form.phone = org.billingPhone;
  const c = await stripeCall({ config, fetchImpl, path: '/customers', form, idempotencyKey: `gi-cust-${org.id}` });
  await pstore.updateOrg(org.id, { stripeCustomerId: c.id });
  org.stripeCustomerId = c.id;
  return c.id;
}

/** Create one org's invoice for a month. Safe to call again: one row per org and month, resumed if an earlier run stopped part way. */
export async function invoiceOrgMonth({ pstore, store, config, fetchImpl, nowMs, org, month }) {
  const base = { orgId: org.id, month };
  let row = await pstore.getInvoiceByMonth(org.id, month);
  if (row && ['due', 'paid', 'void'].includes(row.status)) return { ...base, status: 'exists', invoiceId: row.id, number: row.number, totalCents: row.totalCents };
  if (row && row.status === 'pending' && nowMs - Date.parse(row.issuedAt) < 15 * 60000) return { ...base, status: 'in_progress', invoiceId: row.id };
  if (!contactComplete(org)) return { ...base, status: 'skipped', reason: 'billing_contact_incomplete' };

  const names = new Map((await pstore.listUsers(org.id, false)).map((u) => [u.id, u.name]));
  const usage = await usageForMonth({ pstore, store, orgId: org.id, month, names });
  if (!usage.totals.totalCents) return { ...base, status: 'skipped', reason: 'no_charges' };

  if (!row) {
    const number = invoiceNumber(org, month);
    const snapshot = buildSnapshot({ org, config, month, usage, number, issuedAtMs: nowMs });
    const created = await pstore.insertInvoice({
      id: randomId('inv'), orgId: org.id, month, number, issuedAt: snapshot.issuedAt, dueAt: snapshot.dueAt, loginsCount: usage.totals.loginsCount, topUpsCount: usage.totals.topUpsCount,
      totalCents: usage.totals.totalCents, status: 'pending', stripeStep: null, snapshot,
    });
    row = await pstore.getInvoiceByMonth(org.id, month);
    if (!created) return { ...base, status: row && ['due', 'paid'].includes(row.status) ? 'exists' : 'in_progress', invoiceId: row?.id };
  } else {
    // Resuming: refresh the figures and the date so the record matches what is sent.
    const snapshot = buildSnapshot({ org, config, month, usage, number: row.number, issuedAtMs: nowMs, payment: row.stripeInvoiceId ? row.snapshot?.payment : null });
    await pstore.updateInvoice(row.id, { issuedAt: snapshot.issuedAt, dueAt: snapshot.dueAt, loginsCount: usage.totals.loginsCount, topUpsCount: usage.totals.topUpsCount, totalCents: usage.totals.totalCents, status: 'pending', snapshot });
    row = await pstore.getInvoice(org.id, row.id);
  }
  const snap = row.snapshot;
  const byCard = snap.payment?.method === 'card' && !!org.paymentMethodId;

  try {
    const call = (opts) => stripeCall({ config, fetchImpl, ...opts });
    const customer = await ensureCustomer({ config, pstore, fetchImpl, org });
    const taxRate = await gstTaxRate({ config, pstore, fetchImpl });
    let invoiceId = row.stripeInvoiceId;
    const resumed = !!invoiceId;
    if (!invoiceId) {
      const inv = await call({
        path: '/invoices', idempotencyKey: `gi-inv-${org.id}-${month}`,
        form: {
          customer, currency: 'aud', auto_advance: 'false', pending_invoice_items_behavior: 'exclude',
          ...(byCard ? { collection_method: 'charge_automatically', default_payment_method: org.paymentMethodId } : { collection_method: 'send_invoice', days_until_due: String(INVOICE_DUE_DAYS) }),
          description: `Glide Inside usage for ${month}. Tax invoice ${snap.number}. All amounts include GST.`,
          footer: `Tax invoice. Supplier: ${config.sellerName}, ABN ${config.sellerAbn}. Prices include GST.`,
          'custom_fields[0][name]': 'Supplier ABN', 'custom_fields[0][value]': config.sellerAbn,
          'custom_fields[1][name]': 'Buyer ABN', 'custom_fields[1][value]': org.abn,
          'default_tax_rates[0]': taxRate, 'metadata[org_id]': org.id, 'metadata[month]': month, 'metadata[number]': snap.number,
        },
      });
      invoiceId = inv.id;
      await pstore.updateInvoice(row.id, { stripeInvoiceId: invoiceId, stripeStep: 'created', error: null });
      row.stripeStep = 'created';
    }
    if (!['items', 'finalized', 'sent', 'charged'].includes(row.stripeStep)) {
      // On a resume, items already on the draft (matched by metadata[line]) are not added again.
      const have = new Set();
      if (resumed && row.stripeStep === 'created') {
        const list = await call({ method: 'GET', path: `/invoiceitems?invoice=${encodeURIComponent(invoiceId)}&limit=100` });
        for (const it of list?.data || []) if (it.metadata?.line) have.add(String(it.metadata.line));
      }
      let i = 0;
      for (const line of snap.lines) {
        i += 1;
        if (have.has(String(i))) continue;
        await call({
          path: '/invoiceitems', idempotencyKey: `gi-item-${invoiceId}-${i}`,
          form: { customer, invoice: invoiceId, currency: 'aud', description: line.description, ...(line.unitCents * line.quantity === line.totalCents ? { quantity: String(line.quantity), unit_amount: String(line.unitCents) } : { amount: String(line.totalCents) }), 'tax_rates[0]': taxRate, 'metadata[org_id]': org.id, 'metadata[month]': month, 'metadata[line]': String(i) },
        });
      }
      await pstore.updateInvoice(row.id, { stripeStep: 'items' });
      row.stripeStep = 'items';
    }
    let hosted = row.stripeHostedUrl || null;
    if (row.stripeStep === 'items') {
      const fin = await call({ path: `/invoices/${invoiceId}/finalize`, idempotencyKey: `gi-fin-${invoiceId}`, form: { auto_advance: 'false' } });
      hosted = fin.hosted_invoice_url || null;
      await pstore.updateInvoice(row.id, { stripeStep: 'finalized', stripeHostedUrl: hosted });
      row.stripeStep = 'finalized';
    }
    if (row.stripeStep === 'finalized' && byCard) {
      // Saved card: pay the finalized invoice now. A declined card leaves the invoice open and recorded as due with the reason.
      let paid = false;
      let declined = null;
      try {
        const res = await call({ path: `/invoices/${invoiceId}/pay`, idempotencyKey: `gi-pay-${invoiceId}`, form: { payment_method: org.paymentMethodId, off_session: 'true' } });
        paid = res?.status === 'paid';
        hosted = res?.hosted_invoice_url || hosted;
      } catch (e) {
        declined = String(e?.message || e).replace(/^Stripe refused the request: /, '').slice(0, 200);
      }
      await pstore.updateInvoice(row.id, { stripeStep: 'charged', stripeHostedUrl: hosted, status: paid ? 'paid' : 'due', error: paid ? null : `Card payment did not go through: ${declined || 'the invoice is still open'}` });
      return { ...base, status: 'issued', invoiceId: row.id, number: row.number, stripeInvoiceId: invoiceId, totalCents: row.totalCents, payment: paid ? 'card_paid' : 'card_failed' };
    }
    if (row.stripeStep === 'finalized') {
      const sent = await call({ path: `/invoices/${invoiceId}/send`, idempotencyKey: `gi-send-${invoiceId}` });
      hosted = sent.hosted_invoice_url || hosted;
      await pstore.updateInvoice(row.id, { stripeStep: 'sent', stripeHostedUrl: hosted });
    }
    await pstore.updateInvoice(row.id, { status: byCard ? (row.status === 'paid' ? 'paid' : 'due') : 'due', error: null });
    return { ...base, status: 'issued', invoiceId: row.id, number: row.number, stripeInvoiceId: invoiceId, totalCents: row.totalCents };
  } catch (e) {
    await pstore.updateInvoice(row.id, { status: 'failed', error: String(e?.message || e).slice(0, 300) });
    return { ...base, status: 'failed', invoiceId: row.id, reason: String(e?.message || e).slice(0, 200) };
  }
}

/** Create the invoices for `month` (default: the previous Sydney month) for every org, or just `orgId`. */
export async function runMonth({ pstore, store, config, fetchImpl, now, month, orgId }) {
  const nowMs = now();
  const key = month || previousMonthKey(monthKey(nowMs));
  if (!MONTH_RE.test(key)) throw new HttpError('BAD_REQUEST', 'month must be YYYY-MM.');
  if (monthStartMs(key) > nowMs) throw new HttpError('BAD_REQUEST', 'That month has not started yet.');
  if (monthKey(nowMs) === key) throw new HttpError('BAD_REQUEST', 'That month has not finished yet. Invoices are created after month end.');
  const orgs = orgId ? [await pstore.getOrg(orgId)].filter(Boolean) : await pstore.listOrgs();
  if (orgId && !orgs.length) throw new HttpError('NOT_FOUND', 'No such organisation.');
  const results = [];
  for (const org of orgs) results.push(await invoiceOrgMonth({ pstore, store, config, fetchImpl, nowMs, org, month: key }));
  return { month: key, results };
}

/** True when the Sydney wall clock is 06:00 on the 1st. The Worker cron fires at both 19:00 and 20:00 UTC to cover daylight saving. */
export function isMonthlyRunTime(nowMs) {
  const p = sydneyParts(nowMs);
  return p.day === 1 && p.hour === 6;
}
