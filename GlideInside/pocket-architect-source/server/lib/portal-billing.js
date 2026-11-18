// Portal billing (docs/PORTAL_API.md 4 and 5): month usage, tax invoice snapshots and Stripe invoices for the previous month.
//   Builder JOBS (18/11/2026): A$20 incl. GST per new project, charged off session to the saved card at the moment the builder confirms it
//   (chargeJob below, one Stripe invoice per job, its amount read from BUILDER_JOB_PRICE_ID). Jobs are listed in the usage view but are not on the month end invoice.
//   Client logins are no longer charged. Login rows from before 18/11/2026 (login_issues, amount A$30 or A$25) are history and still invoice as they always did.
//   A$10 incl. GST per AI top-up of 300 credits (the AI branch's `ai_topup` events in the main store).
// Stripe is used only through its REST API with fetch. An org with no card on file gets a send_invoice invoice (Stripe emails it; this
// server sends nothing). An org that added card details (Checkout in setup mode, see lib/portal.js) gets a charge_automatically
// invoice paid at once with its saved card.
// TEST MODE ONLY unless STRIPE_LIVE_BILLING_APPROVED=owner-written-go-ahead (see server/README.md).

import { JOB_FEE_CENTS, JOB_PLANS, jobPlanOf, summariseJobs, monthKey, monthStartMs, previousMonthKey, summariseMonth, gstOfTotal, NEW_LOGIN_FEE_CENTS, VOLUME_LOGIN_FEE_CENTS, priceForNthLoginThisMonth, loginRateInfo, TOPUP_FEE_CENTS, TOPUP_CREDITS, sydneyParts } from '../../src/portal/billing.js';
import { HttpError } from './http.js';

const DAY = 86400000;
const API = 'https://api.stripe.com/v1';
export { priceForNthLoginThisMonth, loginRateInfo };
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
  const org = await pstore.getOrg(orgId);
  // Jobs are charged to the saved card when each project is started, so they are listed here but are NOT part of totals (the month end invoice).
  const jobRows = await pstore.listJobCharges(orgId, month);
  return {
    month, timezone: 'Australia/Sydney',
    // Client logins are no longer charged (18/11/2026). Rows from before then are history and still list below.
    loginPricing: null,
    rates: { newLoginCents: NEW_LOGIN_FEE_CENTS, volumeLoginCents: VOLUME_LOGIN_FEE_CENTS, topUpCents: TOPUP_FEE_CENTS, topUpCredits: TOPUP_CREDITS, jobCents: JOB_FEE_CENTS },
    jobs: { ...summariseJobs(jobRows), feeCents: JOB_FEE_CENTS, items: jobRows.map((j) => ({ id: j.id, projectName: j.projectName || '', userName: j.userName || '', createdAt: j.createdAt, kind: j.kind, amountCents: j.amountCents, plan: j.plan || null })) },
    logins: s.logins.map((i) => ({ id: i.id, loginId: i.loginId, clientName: names.get(i.loginId) || i.clientName || '', firstSignInAt: i.chargedAt, amountCents: i.amountCents, ...(org?.internal === true ? { label: 'internal test, no charge' } : {}) })),
    topUps: s.topUps.map((t) => ({ id: t.id, loginId: t.loginId, clientName: names.get(t.loginId) || '', credits: t.credits, amountCents: t.amountCents, createdAt: t.createdAt })),
    totals: { ...s.totals, gstCents: gstOfTotal(s.totals.totalCents) },
  };
}

/** One invoice line per distinct unit price (the first 15 logins, then the volume rate, or a custom rate). */
function loginLines(logins, month) {
  const by = new Map();
  for (const l of logins) by.set(l.amountCents, (by.get(l.amountCents) || 0) + 1);
  return [...by.entries()].sort((a, b) => b[0] - a[0]).map(([cents, qty]) => ({
    description: `New client logins first signed in during ${month} (A$${cents / 100} each, incl. GST)`, quantity: qty, unitCents: cents, totalCents: cents * qty,
  }));
}

export const invoiceNumber = (org, month) => `GI-${org.shortCode || String(org.id).slice(-4).toUpperCase()}-${month.replace('-', '')}`;

/** The tax invoice: seller name and ABN, "Tax invoice", date, description of supply, GST amount and total incl. GST. */
export function buildSnapshot({ org, config, month, usage, number, issuedAtMs, payment = null }) {
  const t = usage.totals;
  const card = payment ? payment.method === 'card' : !!org.paymentMethodId;
  const pay = payment || (card ? { method: 'card', brand: org.cardBrand || '', last4: org.cardLast4 || '' } : { method: 'invoice' });
  const lines = [
    ...loginLines(usage.logins, month),
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

// Builder jobs -----------------------------------------------------------------------------------------------------------------
/** The Stripe price id the owner configured for a plan id, or ''. */
export const planPriceId = (config, planId) => ({ starter: config.builderStarterPriceId, pro: config.builderProPriceId, teams: config.builderTeamsPriceId })[planId] || '';

/**
 * Can a job be charged right now? Needs the Stripe secret key, the job price id, and (for a live key) the owner's written go ahead.
 * `message` is for the admin side only: it names the missing setting. Builders only ever see "not switched on yet".
 */
export function jobBillingReadiness(config) {
  if (!config.stripeSecretKey) return { ready: false, reason: 'no_stripe_key', message: 'Job billing is off: STRIPE_SECRET_KEY is not set. New jobs are recorded but not charged.' };
  if (!config.builderJobPriceId) return { ready: false, reason: 'price_not_configured', message: 'Job billing is off: the A$20 job price is not configured (set BUILDER_JOB_PRICE_ID). New jobs are recorded but not charged.' };
  if (/^(sk|rk)_live_/.test(config.stripeSecretKey) && !config.stripeLiveBillingApproved) return { ready: false, reason: 'live_not_approved', message: 'Job billing is off: a live Stripe key is set but STRIPE_LIVE_BILLING_APPROVED is not. New jobs are recorded but not charged.' };
  return { ready: true, reason: null, message: null };
}

/** Which capped plans can be bought: a plan is available only when its Stripe price id is set (and billing could run at all). */
export function jobPlansView(config) {
  const base = jobBillingReadiness(config);
  return Object.values(JOB_PLANS).map((p) => ({ ...p, available: !!planPriceId(config, p.id) && !!config.stripeSecretKey && (base.reason !== 'live_not_approved') }));
}

/**
 * Charge one job, off session, to the org's saved card, as a one line Stripe invoice built from the owner's BUILDER_JOB_PRICE_ID (the amount
 * always comes from that Stripe price; it is checked to be exactly A$20 in AUD before anything is charged). A declined card voids the invoice
 * and throws JOB_PAYMENT_FAILED so no project is created. `requestId` is the idempotency key, so a retry never charges twice.
 * Returns { stripeInvoiceId }.
 */
export async function chargeJob({ config, pstore, fetchImpl, org, requestId }) {
  const call = (opts) => stripeCall({ config, fetchImpl, ...opts });
  const price = await call({ method: 'GET', path: `/prices/${encodeURIComponent(config.builderJobPriceId)}` });
  if (!price || price.active === false || price.currency !== 'aud' || price.unit_amount !== JOB_FEE_CENTS || price.type === 'recurring' || price.recurring) {
    throw new HttpError('JOB_PRICE_MISMATCH', 'The job price in Stripe is not a one off A$20 price in AUD, so nothing was charged. Contact Glide Inside.');
  }
  const customer = await ensureCustomer({ config, pstore, fetchImpl, org });
  const taxRate = await gstTaxRate({ config, pstore, fetchImpl });
  const inv = await call({
    path: '/invoices', idempotencyKey: `gi-job-inv-${org.id}-${requestId}`,
    form: {
      customer, currency: 'aud', auto_advance: 'false', pending_invoice_items_behavior: 'exclude', collection_method: 'charge_automatically', default_payment_method: org.paymentMethodId,
      description: 'Glide Inside builder job: one new project. Tax invoice. Price includes GST.',
      footer: `Tax invoice. Supplier: ${config.sellerName}, ABN ${config.sellerAbn}. Prices include GST.`,
      'custom_fields[0][name]': 'Supplier ABN', 'custom_fields[0][value]': config.sellerAbn, 'custom_fields[1][name]': 'Buyer ABN', 'custom_fields[1][value]': org.abn || '',
      'default_tax_rates[0]': taxRate, 'metadata[org_id]': org.id, 'metadata[purpose]': 'gi_job', 'metadata[request_id]': requestId,
    },
  });
  try {
    await call({ path: '/invoiceitems', idempotencyKey: `gi-job-item-${inv.id}`, form: { customer, invoice: inv.id, currency: 'aud', price: config.builderJobPriceId, 'tax_rates[0]': taxRate, 'metadata[org_id]': org.id, 'metadata[purpose]': 'gi_job' } });
    await call({ path: `/invoices/${inv.id}/finalize`, idempotencyKey: `gi-job-fin-${inv.id}`, form: { auto_advance: 'false' } });
    const res = await call({ path: `/invoices/${inv.id}/pay`, idempotencyKey: `gi-job-pay-${inv.id}`, form: { payment_method: org.paymentMethodId, off_session: 'true' } });
    if (res?.status !== 'paid') throw new HttpError('BILLING_UNAVAILABLE', 'The card payment did not complete.');
  } catch (e) {
    await call({ path: `/invoices/${inv.id}/void`, idempotencyKey: `gi-job-void-${inv.id}` }).catch(() => null); // never leave an open invoice behind a project that was not created
    if (e instanceof HttpError && e.code === 'JOB_PRICE_MISMATCH') throw e;
    const why = String(e?.message || e).replace(/^Stripe refused the request: /, '').slice(0, 200);
    throw new HttpError('JOB_PAYMENT_FAILED', `Your card was not charged, so the project was not created. ${why}`, { reason: why });
  }
  return { stripeInvoiceId: inv.id };
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

export async function gstTaxRate({ config, pstore, fetchImpl }) {
  if (config.stripeGstTaxRateId) return config.stripeGstTaxRateId;
  const saved = await pstore.getSetting('stripe_gst_tax_rate');
  if (saved) return saved;
  const rate = await stripeCall({ config, fetchImpl, path: '/tax_rates', idempotencyKey: 'gi-gst-tax-rate', form: { display_name: 'GST', description: 'Goods and services tax (included in the price)', percentage: '10', inclusive: 'true', country: 'AU', tax_type: 'gst' } });
  await pstore.setSetting('stripe_gst_tax_rate', rate.id);
  return rate.id;
}

export async function ensureCustomer({ config, pstore, fetchImpl, org }) {
  if (org.internal === true) throw new HttpError('BILLING_UNAVAILABLE', 'An internal test account has no billing.');
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
  // An internal test account is never invoiced: no usage rows, no Stripe customer, no invoice.
  if (org.internal === true) return { ...base, status: 'skipped', reason: 'internal' };
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
