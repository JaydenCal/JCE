// Free builder trial (docs/PORTAL_API.md 14): the trial request form, the account state rules and the owner notification.
//
//   * A builder REQUESTS a trial (public form, stored in trial_requests). The owner APPROVES each one; only then does the org exist.
//   * Approval day is day 1. trial_ends_at is 00:00 Sydney on the day 14 calendar days after the approval date, so the trial runs
//     through the end of the 14th day (approved 11/11/2026, last day 24/11/2026, read only from 00:00 on 25/11/2026).
//   * During the trial staff can use everything except issue client logins and AI top-ups. After it the account is read only
//     until card details are added (Stripe Checkout in setup mode), which makes the org active.
//   * Orgs with no account row (created before trials existed, or by the ADMIN_TOKEN create-org job) are active.
//   * The owner is told about a new request by one email to his OWN address (Resend). The builder is never emailed by this server.

import { HttpError } from './http.js';
import { sydneyDayStartPlus, ddmmyyyy } from '../../src/portal/billing.js';

export const TRIAL_DAYS = 14;
export const TRIAL_EXTENSION_DAYS = 7;
export const DATA_KEEP_DAYS = 90; // builder data is kept this long after a trial ends unless the builder asks for deletion
export const TERMS_VERSION = '11/11/2026';
export const ORG_STATES = ['trial', 'trial_ended', 'active', 'read_only'];
const DAY = 86400000;

const str = (v, d = '') => (v === undefined || v === null ? d : String(v));

/** Trial settings come from the Worker environment (createApp passes `env`). */
export function readTrialConfig(env = {}) {
  return {
    notify: str(env.TRIAL_NOTIFY, '1').trim() !== '0',
    notifyTo: str(env.TRIAL_NOTIFY_TO, 'hello@glideinside.com.au').trim(),
  };
}

// Errors ----------------------------------------------------------------------------------------------------------------------
export const trialNoClients = () => new HttpError('TRIAL_NO_CLIENTS', 'Client logins unlock when you add billing details. Your free trial gives your staff everything else.', {}, 403);
export const trialNoTopUps = () => new HttpError('TRIAL_NO_TOPUPS', 'AI credit top-ups are not available during the free trial. Your monthly AI allowance still applies. Add billing details to unlock top-ups.', {}, 403);
export const readOnlyError = (state) => new HttpError('READ_ONLY', state?.status === 'read_only'
  ? 'This account is read only. Add billing details, or contact Glide Inside, to make changes again.'
  : 'Your free trial has ended, so the account is read only. You can still view your projects. Add billing details to make changes again.', { accountStatus: state?.status || 'trial_ended' }, 403);

// Account state -----------------------------------------------------------------------------------------------------------------
/**
 * The state of an org at an instant. `status` is the effective one:
 *   trial        stored 'trial' and trial_ends_at is in the future
 *   trial_ended  stored 'trial' and trial_ends_at has passed (read only until card details are added)
 *   active       paid account (or a legacy org with no account row)
 *   read_only    set by the owner
 */
export function orgState(org, nowMs) {
  const stored = org.status || 'active';
  const endsMs = org.trialEndsAt ? Date.parse(org.trialEndsAt) : null;
  let status = stored;
  if (stored === 'trial' && endsMs != null && endsMs <= nowMs) status = 'trial_ended';
  if (stored === 'trial_ended') status = 'trial_ended';
  const isTrial = status === 'trial';
  const ended = status === 'trial_ended';
  const msLeft = endsMs != null ? endsMs - nowMs : null;
  return {
    status,
    stored,
    isTrial,
    readOnly: ended || status === 'read_only',
    canIssueClients: status === 'active',
    canTopUp: status === 'active',
    canExport: !(ended || status === 'read_only'),
    trialStartedAt: org.trialStartedAt || null,
    trialEndsAt: org.trialEndsAt || null,
    daysLeft: isTrial && msLeft != null ? Math.max(1, Math.ceil(msLeft / DAY)) : 0,
    lastTrialDay: endsMs != null ? ddmmyyyy(endsMs - 1) : null, // the last full day of the trial, DD/MM/YYYY
    dataKeptUntil: ended && endsMs != null ? new Date(endsMs + DATA_KEEP_DAYS * DAY).toISOString() : null,
    cardOnFile: !!org.paymentMethodId,
  };
}

/** The shape sent to the screens (me().account and the admin lists). No payment method ids. */
export function accountView(org, nowMs) {
  const s = orgState(org, nowMs);
  return {
    status: s.status, trialStartedAt: s.trialStartedAt, trialEndsAt: s.trialEndsAt, daysLeft: s.daysLeft, lastTrialDay: s.lastTrialDay,
    readOnly: s.readOnly, canIssueClients: s.canIssueClients, canTopUp: s.canTopUp, cardOnFile: s.cardOnFile,
    card: s.cardOnFile ? { brand: org.cardBrand || '', last4: org.cardLast4 || '' } : null, dataKeptUntil: s.dataKeptUntil,
  };
}

/** Trial end (ISO) for an approval at `nowMs`: 00:00 Sydney, TRIAL_DAYS calendar days after the approval date. */
export const trialEndFor = (nowMs, days = TRIAL_DAYS) => new Date(sydneyDayStartPlus(nowMs, days)).toISOString();

/**
 * Extend by `days` calendar days. A running trial moves its end date on (the end is a Sydney midnight, so +1 h is still inside that
 * Sydney day); an ended trial restarts from today's Sydney date. Both land on a Sydney midnight.
 */
export function extendedEnd(org, nowMs, days = TRIAL_EXTENSION_DAYS) {
  const cur = org.trialEndsAt ? Date.parse(org.trialEndsAt) : 0;
  return new Date(sydneyDayStartPlus(cur > nowMs ? cur + 3600000 : nowMs, days)).toISOString();
}

// The request form --------------------------------------------------------------------------------------------------------------
const oneLine = (v, name, { max = 120, required = false } = {}) => {
  if (v != null && typeof v !== 'string') throw new HttpError('BAD_REQUEST', `${name} must be text.`);
  const s = (v || '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim();
  if (required && !s) throw new HttpError('BAD_REQUEST', `${name} is required.`);
  if (s.length > max) throw new HttpError('BAD_REQUEST', `${name} is too long.`);
  return s;
};

/** Checks and cleans the body of POST /portal/trial-request. `abnValid(digits)` is passed in by portal.js. Throws BAD_REQUEST. */
export function parseTrialRequest(body, { abnValid }) {
  if (body.consent !== true) throw new HttpError('BAD_REQUEST', 'Please tick the box to agree to the trial terms.');
  const companyLegalName = oneLine(body.companyLegalName, 'Company legal name', { required: true });
  const digits = String(body.abn || '').replace(/\s+/g, '');
  if (!abnValid(digits)) throw new HttpError('BAD_REQUEST', 'Enter the 11 digit ABN for your business. That ABN does not look right.');
  const email = oneLine(body.email, 'Email', { required: true, max: 160 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError('BAD_REQUEST', 'That email address does not look right.');
  const mobile = oneLine(body.mobile, 'Mobile', { required: true, max: 30 });
  const mdigits = mobile.replace(/[\s()+-]/g, '');
  if (!/^\d{8,15}$/.test(mdigits)) throw new HttpError('BAD_REQUEST', 'That mobile number does not look right.');
  let homes = null;
  if (body.homesPerYear !== undefined && body.homesPerYear !== null && body.homesPerYear !== '') {
    const n = Number(body.homesPerYear);
    if (!Number.isInteger(n) || n < 0 || n > 100000) throw new HttpError('BAD_REQUEST', 'Homes built per year must be a whole number, or leave it blank.');
    homes = n;
  }
  return {
    companyLegalName, abn: `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`,
    tradingName: oneLine(body.tradingName, 'Trading name'),
    firstName: oneLine(body.firstName, 'First name', { required: true, max: 60 }),
    lastName: oneLine(body.lastName, 'Last name', { required: true, max: 60 }),
    email, mobile, region: oneLine(body.region, 'Region', { required: true, max: 80 }),
    homesPerYear: homes, howHeard: oneLine(body.howHeard, 'How you heard about us', { max: 200 }),
  };
}

// Owner notification ------------------------------------------------------------------------------------------------------------
export function notificationText(r, { siteUrl = '' } = {}) {
  return [
    `A builder has asked for a free 14 day trial of the Glide Inside builder portal.`,
    '',
    `Company: ${r.companyLegalName}`, r.tradingName ? `Trading name: ${r.tradingName}` : null, `ABN: ${r.abn}`,
    `Contact: ${r.firstName} ${r.lastName}`, `Email: ${r.email}`, `Mobile: ${r.mobile}`, `Region: ${r.region}`,
    r.homesPerYear != null ? `Homes built per year: ${r.homesPerYear}` : null, r.howHeard ? `Heard about us: ${r.howHeard}` : null,
    '',
    `Review and approve or decline: ${siteUrl}/portal/admin/`,
    '',
    'This email goes to you only. Nothing has been sent to the builder.',
  ].filter((l) => l !== null).join('\n');
}

/**
 * Emails the OWNER (never the builder) through Resend. Resolves { sent: true, id } or { skipped: reason } or { failed: reason }.
 * It never throws, so a mail problem cannot lose or reject the request (it is already saved).
 * Skipped silently when TRIAL_NOTIFY=0, RESEND_API_KEY is unset or TRIAL_NOTIFY_TO is empty.
 */
export async function notifyOwner({ request, trialConfig, config, fetchImpl }) {
  if (!trialConfig.notify) return { skipped: 'TRIAL_NOTIFY is 0' };
  if (!config.resendApiKey) return { skipped: 'RESEND_API_KEY is not set' };
  if (!trialConfig.notifyTo) return { skipped: 'TRIAL_NOTIFY_TO is not set' };
  const subject = `Trial request: ${request.companyLegalName}`.replace(/[\r\n]+/g, ' ').slice(0, 200);
  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.resendApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: config.enquiryFrom, to: [trialConfig.notifyTo], subject, text: notificationText(request, { siteUrl: config.siteUrl }) }),
    });
    if (!res.ok) return { failed: `Resend answered ${res.status}` };
    const data = await res.json().catch(() => ({}));
    return { sent: true, id: data?.id || null };
  } catch {
    return { failed: 'Could not reach Resend' };
  }
}
