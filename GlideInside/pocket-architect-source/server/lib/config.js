// Server configuration: every variable in docs/SCOPE.md 11.6 with its default.
// `env` is the platform environment (Workers env, process.env, or a test object). Values are strings.

const num = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const str = (value, fallback = '') => (value === undefined || value === null ? fallback : String(value));

export const ANTHROPIC_VERSION = '2023-06-01';

export function readConfig(env = {}) {
  const siteUrl = str(env.SITE_URL).replace(/\/+$/, '');
  const thresholds = str(env.WARN_THRESHOLDS, '0.5,0.8,0.95')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 1)
    .sort((a, b) => a - b);
  return {
    siteUrl,
    siteOrigin: (() => {
      try {
        return siteUrl ? new URL(siteUrl).origin : '';
      } catch {
        return '';
      }
    })(),
    appUrl: str(env.APP_URL) || `${siteUrl}/floor-plan-designer/app/`,
    anthropicApiKey: str(env.ANTHROPIC_API_KEY),
    anthropicModel: str(env.ANTHROPIC_MODEL, 'claude-haiku-5-5'),
    priceInPerMtok: num(env.PRICE_IN_PER_MTOK_USD, 0.1),
    priceOutPerMtok: num(env.PRICE_OUT_PER_MTOK_USD, 0.5),
    maxOutputTokens: Math.round(num(env.AI_MAX_OUTPUT_TOKENS, 1500)),
    maxContextTokens: Math.round(num(env.AI_MAX_CONTEXT_TOKENS, 40000)),
    creditUsd: num(env.CREDIT_USD, 0.001),
    planPackCredits: Math.round(num(env.PLAN_PACK_CREDITS, 500)),
    warnThresholds: thresholds.length ? thresholds : [0.5, 0.8, 0.95],
    largeRequestCredits: num(env.LARGE_REQUEST_CREDITS, 10),
    ratePerMin: Math.round(num(env.AI_RATE_PER_MIN, 6)),
    ratePerDay: Math.round(num(env.AI_RATE_PER_DAY, 150)),
    dailyCapUsd: num(env.AI_DAILY_CAP_USD, 5),
    monthlyCapUsd: num(env.AI_MONTHLY_CAP_USD, 50),
    fxAudPerUsd: num(env.FX_AUD_PER_USD, 1.67),
    stripeSecretKey: str(env.STRIPE_SECRET_KEY),
    stripeWebhookSecret: str(env.STRIPE_WEBHOOK_SECRET),
    stripePriceId: str(env.STRIPE_PRICE_ID),
    planPackPriceCents: Math.round(num(env.PLAN_PACK_PRICE_CENTS, 3000)),
    entitlementSecret: str(env.ENTITLEMENT_SECRET),
    entitlementDays: num(env.ENTITLEMENT_DAYS, 365),
    exportMaxProjectBytes: Math.round(num(env.EXPORT_MAX_PROJECT_BYTES, 2000000)),
    aiTimeoutMs: Math.round(num(env.AI_TIMEOUT_MS, 30000)),
    // Printed on the PDF title block. Defaults come from src/config.js (decision 17.1).
    disclaimer: str(env.DISCLAIMER),
  };
}
