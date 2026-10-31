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
