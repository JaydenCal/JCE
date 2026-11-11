// Billing rules (docs/PORTAL_API.md 4). Pure functions, no storage, so the rules can be tested.
//   Per NEW client login, charged once when the client FIRST SIGNS IN, in the calendar month (Australia/Sydney) of that first sign in.
//   Volume pricing per builder org, counted by first sign ins in that month, GST included: logins 1 to 15 A$30 each, logins 16 to 50 A$25 each,
//   above 50 a custom rate set by the owner (org.customLoginCents; until it is set the A$25 rate keeps applying and the admin page flags the org). Generating a login is free, and an unused login can be deleted free. No monthly charge.
//   A$10 incl. GST per AI top-up of 300 credits, added at once, on the same end of month invoice.
// Resetting a password, disabling, enabling or editing a login never creates a charge.
// A billing row is { loginId, chargedAt (the first sign in), amountCents }.

export const TZ = 'Australia/Sydney';
export const NEW_LOGIN_FEE_CENTS = 3000;
export const VOLUME_LOGIN_FEE_CENTS = 2500;
export const LOGIN_TIER_1_MAX = 15; // logins 1 to 15 in a month are NEW_LOGIN_FEE_CENTS
export const LOGIN_TIER_2_MAX = 50; // logins 16 to 50 are VOLUME_LOGIN_FEE_CENTS; above this the owner sets a custom rate
export const TOPUP_FEE_CENTS = 1000;
export const TOPUP_CREDITS = 300;

const fmt = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** { year, month (1-12), day, hour, minute } of an instant on the Sydney wall clock. */
export function sydneyParts(ms) {
  const out = {};
  for (const p of fmt.formatToParts(new Date(ms))) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out;
}

/** The org's custom per-login price in cents (a positive whole number), or null. */
export const customLoginRate = (org) => (Number.isInteger(org?.customLoginCents) && org.customLoginCents > 0 ? org.customLoginCents : null);

/**
 * Price in cents (incl. GST) of the nth client login (1 based) to first sign in during one Sydney calendar month for one org.
 * A custom org rate, when set, applies to every login that month. Otherwise 1 to 15: A$30, 16 and above: A$25 (above 50 the
 * owner is asked to set a custom rate, see loginRateInfo, but the A$25 rate keeps being charged until he does).
 */
export function priceForNthLoginThisMonth(n, org = null) {
  const custom = customLoginRate(org);
  if (custom) return custom;
  return n <= LOGIN_TIER_1_MAX ? NEW_LOGIN_FEE_CENTS : VOLUME_LOGIN_FEE_CENTS;
}

/** What the Billing view and the admin page show: this month's count, the rate the NEXT login will be charged and the over 50 flag. */
export function loginRateInfo(count, org = null) {
  const custom = customLoginRate(org);
  return {
    count,
    currentRateCents: priceForNthLoginThisMonth(count + 1, org),
    customRateCents: custom,
    over50NeedsCustomRate: count > LOGIN_TIER_2_MAX && !custom,
    tiers: [
      { from: 1, to: LOGIN_TIER_1_MAX, cents: NEW_LOGIN_FEE_CENTS },
      { from: LOGIN_TIER_1_MAX + 1, to: LOGIN_TIER_2_MAX, cents: VOLUME_LOGIN_FEE_CENTS },
      { from: LOGIN_TIER_2_MAX + 1, to: null, cents: null }, // custom
    ],
  };
}

const toMs = (t) => (typeof t === 'number' ? t : Date.parse(t));

/** 'YYYY-MM' for the Sydney calendar month containing the instant (ms or ISO string). */
export function monthKey(t) {
  const p = sydneyParts(toMs(t));
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

export const previousMonthKey = (key) => {
  const [y, m] = key.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

/** DD/MM/YYYY on the Sydney calendar. */
export function ddmmyyyy(t) {
  const p = sydneyParts(toMs(t));
  return `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}/${p.year}`;
}

export function ddmmyyyyTime(t) {
  const p = sydneyParts(toMs(t));
  return `${ddmmyyyy(t)} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = (key) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

export function formatAud(cents) {
  const neg = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString('en-AU');
  const rest = abs % 100;
  return `${neg}A$${dollars}${rest ? `.${String(rest).padStart(2, '0')}` : ''}`;
}

/**
 * New client logins charged in a month. `issues` are login_charges rows { loginId, chargedAt, amountCents }.
 * A login is charged once, in the month of its first sign in: duplicate rows for one loginId are ignored.
 */
const at = (i) => i.chargedAt ?? i.issuedAt;
export function loginsInMonth(issues, key) {
  const seen = new Set();
  const out = [];
  for (const i of [...issues].sort((a, b) => toMs(at(a)) - toMs(at(b)))) {
    if (seen.has(i.loginId)) continue;
    seen.add(i.loginId);
    if (monthKey(at(i)) === key) out.push(i);
  }
  return out;
}

export const topUpsInMonth = (topUps, key) => topUps.filter((t) => monthKey(t.createdAt) === key);

/** Everything the Billing tab and the invoice need for one month. */
export function summariseMonth({ issues = [], topUps = [] }, key) {
  const logins = loginsInMonth(issues, key);
  const tops = topUpsInMonth(topUps, key);
  const loginsCents = logins.reduce((s, i) => s + (i.amountCents ?? NEW_LOGIN_FEE_CENTS), 0);
  const topUpsCents = tops.reduce((s, t) => s + (t.amountCents ?? TOPUP_FEE_CENTS), 0);
  return {
    month: key,
    logins,
    topUps: tops,
    totals: { loginsCount: logins.length, loginsCents, topUpsCount: tops.length, topUpsCents, totalCents: loginsCents + topUpsCents },
  };
}

/** Instant (ms) of 00:00 on the first day of the Sydney calendar month `key`. */
export function monthStartMs(key) {
  const [y, m] = key.split('-').map(Number);
  let t = Date.UTC(y, m - 1, 1, -14);
  for (let i = 0; i < 40; i += 1, t += 3600000) {
    const p = sydneyParts(t);
    if (monthKey(t) === key && p.day === 1 && p.hour === 0) return t;
  }
  throw new Error(`monthStartMs: no start found for ${key}`);
}

/** GST included in a GST-inclusive total (one eleventh), rounded to the nearest cent. */
export const gstOfTotal = (totalCents) => Math.round(totalCents / 11);

/** Instant (ms) of 00:00 Sydney on the calendar day y-m-d (month 1-12). Days outside the month roll over, so day + 14 is safe. */
export function sydneyDayStartMs(y, m, d) {
  const t0 = Date.UTC(y, m - 1, d); // the same calendar day at 00:00 UTC; Sydney midnight is 10 to 11 hours before this
  for (let t = t0 - 14 * 3600000; t <= t0 + 3600000; t += 3600000) {
    const p = sydneyParts(t);
    const ref = Date.UTC(p.year, p.month - 1, p.day);
    if (ref === t0 && p.hour === 0) return t;
  }
  throw new Error(`sydneyDayStartMs: no start found for ${y}-${m}-${d}`);
}

/** 00:00 Sydney on the day `days` calendar days after the Sydney day that contains `ms` (daylight saving safe). */
export function sydneyDayStartPlus(ms, days) {
  const p = sydneyParts(ms);
  const t = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return sydneyDayStartMs(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
