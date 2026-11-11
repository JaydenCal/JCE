// Credit arithmetic, warning levels, global spend caps and per-project rate limits (docs/SCOPE.md 7.4).
// Prices are USD per million tokens, which is the same number as micro-USD per token. All cost maths is in
// micro-USD so credit rounding is exact.

import { estimateTokens } from '../../src/premium/ai/context.js';

export const CACHE_WRITE_MULT = 1.25;
export const CACHE_READ_MULT = 0.1;

/** Cost of one request in micro-USD from the API usage fields (docs/SCOPE.md 7.4). */
export function costMicros(usage = {}, config) {
  const pin = config.priceInPerMtok;
  const pout = config.priceOutPerMtok;
  const I = Number(usage.input_tokens) || 0;
  const O = Number(usage.output_tokens) || 0;
  const W = Number(usage.cache_creation_input_tokens) || 0;
  const R = Number(usage.cache_read_input_tokens) || 0;
  return I * pin + O * pout + W * CACHE_WRITE_MULT * pin + R * CACHE_READ_MULT * pin;
}

/** credits = max(1, ceil(cost / CREDIT_USD)). The small epsilon stops float noise adding a credit. */
export function creditsForCost(costMicrosValue, config) {
  return Math.max(1, Math.ceil(costMicrosValue / (config.creditUsd * 1e6) - 1e-9));
}

/**
 * Pre-flight estimate. Input is characters / 3.5 for context, message and history, the system prompt and
 * tools are priced as a cache write (worst case), and output is max_tokens.
 */
export function estimateRequest({ config, context = '', message = '', history = [], systemTokens = 0 }) {
  const historyChars = history.reduce((n, h) => n + String(h.content || '').length, 0);
  const inputTokens = estimateTokens(context) + estimateTokens(message) + Math.ceil(historyChars / 3.5);
  const micros =
    inputTokens * config.priceInPerMtok +
    systemTokens * CACHE_WRITE_MULT * config.priceInPerMtok +
    config.maxOutputTokens * config.priceOutPerMtok;
  return { inputTokens, costMicros: micros, credits: creditsForCost(micros, config) };
}

export function balance(ent) {
  const total = ent.creditsTotal;
  const used = ent.creditsUsed;
  const reserved = ent.creditsReserved || 0;
  return { total, used, reserved, remaining: Math.max(0, total - used - reserved) };
}

/** Highest warning threshold that the used share has reached, or 0. */
export function warnLevel(used, total, thresholds) {
  if (!total) return 0;
  return thresholds.filter((t) => used / total >= t - 1e-9).at(-1) || 0;
}

/** Highest threshold crossed by moving from usedBefore to usedAfter, or null. */
export function crossedThreshold(usedBefore, usedAfter, total, thresholds) {
  const crossed = thresholds.filter((t) => usedBefore / total < t - 1e-9 && usedAfter / total >= t - 1e-9);
  return crossed.length ? crossed.at(-1) : null;
}

export const periodKeys = (nowMs) => {
  const iso = new Date(nowMs).toISOString();
  return { day: `d:${iso.slice(0, 10)}`, month: `m:${iso.slice(0, 7)}` };
};

/** Null when AI may run, otherwise { period, capUsd, spentUsd } for the cap that has been reached. */
export async function globalPause(store, config, nowMs) {
  const { day, month } = periodKeys(nowMs);
  const [d, m] = await Promise.all([store.getSpend(day), store.getSpend(month)]);
  if (d >= config.dailyCapUsd * 1e6) return { period: day, capUsd: config.dailyCapUsd, spentUsd: d / 1e6 };
  if (m >= config.monthlyCapUsd * 1e6) return { period: month, capUsd: config.monthlyCapUsd, spentUsd: m / 1e6 };
  return null;
}

/** Count one AI request against the per-minute and per-day limits. Null when allowed, otherwise { retryAfter }. */
export async function rateLimit(store, config, projectId, nowMs) {
  const perMin = await store.hitRate(`ai:min:${projectId}`, 60, nowMs);
  if (perMin > config.ratePerMin) return { retryAfter: 60 - (Math.floor(nowMs / 1000) % 60), window: 'minute' };
  const perDay = await store.hitRate(`ai:day:${projectId}`, 86400, nowMs);
  if (perDay > config.ratePerDay) return { retryAfter: 86400 - (Math.floor(nowMs / 1000) % 86400), window: 'day' };
  return null;
}

// Org-scoped monthly pools and top-ups ---------------------------------------------------------------------------------------
// A builder or client login gets a monthly pool of credits (ORG_MONTHLY_CREDITS) that resets at the start of each calendar
// month in Australia/Sydney, plus a top-up pool that carries over until used. Monthly credits are spent first. Each pool is
// an ordinary entitlement row, so reserve, settle and release keep their single guarded write.

export const ORG_TIMEZONE = 'Australia/Sydney';

const sydneyFormat = new Intl.DateTimeFormat('en-AU', { timeZone: ORG_TIMEZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const sydneyParts = (ms) => Object.fromEntries(sydneyFormat.formatToParts(new Date(ms)).map((p) => [p.type, Number(p.value)]));
const pad = (n) => String(n).padStart(2, '0');

/**
 * The calendar month in Sydney that contains nowMs: { key: 'YYYY-MM', resetsOn: 'YYYY-MM-01' of the next month,
 * resetsAtMs: the instant that month ends }.
 */
export function sydneyMonth(nowMs) {
  const { year, month } = sydneyParts(nowMs);
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  // Midnight Sydney is 13 to 10 hours before midnight UTC depending on daylight saving. Take the instant that reads 00:00.
  let resetsAtMs = Date.UTC(ny, nm - 1, 1) - 11 * 3600000;
  for (const hours of [11, 10]) {
    const t = Date.UTC(ny, nm - 1, 1) - hours * 3600000;
    const q = sydneyParts(t);
    if (q.year === ny && q.month === nm && q.day === 1 && q.hour === 0 && q.minute === 0) resetsAtMs = t;
  }
  return { key: `${year}-${pad(month)}`, resetsOn: `${ny}-${pad(nm)}-01`, resetsAtMs };
}

export const orgPoolIds = (orgId, loginId, monthKey) => ({ monthlyId: `org:${orgId}:${loginId}:${monthKey}`, topUpId: `orgtop:${orgId}:${loginId}` });

/** Balance across the two pools. The meter shows the monthly pool; `available` is what a request can draw on. */
export function orgBalance(monthly, topUp) {
  const m = balance(monthly);
  const t = topUp ? balance(topUp) : { total: 0, used: 0, reserved: 0, remaining: 0 };
  return { total: m.total, used: m.used, reserved: m.reserved, remaining: m.remaining, topUpRemaining: t.remaining, available: m.remaining + t.remaining };
}

/** How many credits to take from each pool: monthly first, then top-up. Null when the pools together cannot cover n. */
export function planSpend(monthlyRemaining, topUpRemaining, n) {
  if (n > monthlyRemaining + topUpRemaining) return null;
  const fromMonthly = Math.min(n, monthlyRemaining);
  return { fromMonthly, fromTopUp: n - fromMonthly };
}

/** Split the actual charge across what was reserved: monthly first, anything beyond the monthly reservation to top-up. */
export function splitCharge(charge, reservedMonthly, reservedTopUp) {
  const m = Math.min(charge, reservedMonthly);
  return { monthly: m, topUp: Math.min(charge - m, reservedTopUp) };
}

/** The billable record for the builder's end-of-month invoice. */
export function topUpRecord({ orgId, loginId, config, nowMs }) {
  return { orgId, loginId, credits: config.topUpCredits, amountCents: config.topUpCents, currency: 'aud', gstInclusive: true, createdAt: new Date(nowMs).toISOString() };
}

/** Latest on/off setting for client top-ups in an org (default on) from the logged setting events. */
export function clientTopUpsEnabled(events, orgId) {
  const mine = events.filter((e) => e.detail?.orgId === orgId);
  return mine.length ? mine.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || 0).at(-1).detail.enabled !== false : true;
}

// Per-organisation spend budgets ------------------------------------------------------------------------------------------
// One busy builder must not pause the AI for everyone. An organisation request is checked against its own daily and monthly
// US$ budgets first, then against the share of the global caps that organisations may use together (the rest is reserved for
// public Plan Pack buyers), and last against the global caps. Public requests only ever see the global caps.

const sydneyDay = (nowMs) => {
  const p = sydneyParts(nowMs);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};

export const orgSpendKeys = (orgId, nowMs) => ({
  orgDay: `od:${orgId}:${sydneyDay(nowMs)}`,
  orgMonth: `om:${orgId}:${sydneyMonth(nowMs).key}`,
  allDay: `oall:d:${sydneyDay(nowMs)}`,
  allMonth: `oall:m:${sydneyMonth(nowMs).key}`,
});

/** This org's budgets in US$: the ORG_BUDGETS override for its id, else the ORG_DAILY_CAP_USD and ORG_MONTHLY_CAP_USD defaults. */
export function orgBudget(config, orgId) {
  const o = config.orgBudgets?.[orgId] || {};
  const n = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 && v !== null && v !== '' && v !== undefined ? Number(v) : d);
  return { dailyUsd: n(o.dailyUsd, config.orgDailyCapUsd), monthlyUsd: n(o.monthlyUsd, config.orgMonthlyCapUsd) };
}

/** Combined share of the global caps that all organisations may use. */
export const orgPoolCaps = (config) => ({ dailyUsd: config.dailyCapUsd * (1 - config.publicReserveShare), monthlyUsd: config.monthlyCapUsd * (1 - config.publicReserveShare) });

/** Null when the org may run, otherwise { scope: 'org'|'orgs', window: 'day'|'month', capUsd, spentUsd }. */
export async function orgPause(store, config, orgId, nowMs) {
  const k = orgSpendKeys(orgId, nowMs);
  const [od, om, ad, am] = await Promise.all([store.getSpend(k.orgDay), store.getSpend(k.orgMonth), store.getSpend(k.allDay), store.getSpend(k.allMonth)]);
  const b = orgBudget(config, orgId);
  if (od >= b.dailyUsd * 1e6) return { scope: 'org', window: 'day', capUsd: b.dailyUsd, spentUsd: od / 1e6 };
  if (om >= b.monthlyUsd * 1e6) return { scope: 'org', window: 'month', capUsd: b.monthlyUsd, spentUsd: om / 1e6 };
  const pool = orgPoolCaps(config);
  if (ad >= pool.dailyUsd * 1e6) return { scope: 'orgs', window: 'day', capUsd: pool.dailyUsd, spentUsd: ad / 1e6 };
  if (am >= pool.monthlyUsd * 1e6) return { scope: 'orgs', window: 'month', capUsd: pool.monthlyUsd, spentUsd: am / 1e6 };
  return null;
}

/** Record the cost of an org request against the org, the organisations together and the global totals. */
export async function addOrgSpend(store, orgId, micros, nowMs) {
  const k = orgSpendKeys(orgId, nowMs);
  const g = periodKeys(nowMs);
  for (const key of [k.orgDay, k.orgMonth, k.allDay, k.allMonth, g.day, g.month]) await store.addSpend(key, micros);
}
