// Billing rules (docs/PORTAL_API.md 4). Pure functions, no storage, so the rules can be tested.
//   A$20 incl. GST once per NEW client login issued in a calendar month (Australia/Sydney). No monthly charge.
//   A$10 incl. GST per AI top-up of 300 credits, added at once, on the same end of month invoice.
// Resetting a password, disabling, enabling or editing a login never creates a charge.

export const TZ = 'Australia/Sydney';
export const NEW_LOGIN_FEE_CENTS = 2000;
export const TOPUP_FEE_CENTS = 1000;
export const TOPUP_CREDITS = 300;

const fmt = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** { year, month (1-12), day, hour, minute } of an instant on the Sydney wall clock. */
export function sydneyParts(ms) {
  const out = {};
  for (const p of fmt.formatToParts(new Date(ms))) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out;
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
 * New client logins charged in a month. `issues` are login_issues rows { loginId, issuedAt, amountCents }.
 * A login is charged once, in the month it was issued: duplicate rows for one loginId are ignored.
 */
export function loginsInMonth(issues, key) {
  const seen = new Set();
  const out = [];
  for (const i of [...issues].sort((a, b) => toMs(a.issuedAt) - toMs(b.issuedAt))) {
    if (seen.has(i.loginId)) continue;
    seen.add(i.loginId);
    if (monthKey(i.issuedAt) === key) out.push(i);
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
