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
    anthropicModel: str(env.ANTHROPIC_MODEL) || str(env.AI_MODEL) || 'claude-haiku-5-5', // AI_MODEL is the live Worker's name for it
    priceInPerMtok: num(env.PRICE_IN_PER_MTOK_USD, 0.1),
    priceOutPerMtok: num(env.PRICE_OUT_PER_MTOK_USD, 0.5),
    maxOutputTokens: Math.round(num(env.AI_MAX_OUTPUT_TOKENS, 1500)),
    maxContextTokens: Math.round(num(env.AI_MAX_CONTEXT_TOKENS, 40000)),
    creditUsd: num(env.CREDIT_USD, 0.001),
    planPackCredits: Math.round(num(env.PLAN_PACK_CREDITS, 500)),
    warnThresholds: thresholds.length ? thresholds : [0.5, 0.8, 0.95],
    // Builder and client logins are off until the public launch is done (PORTAL_ENABLED=1).
    portalEnabled: ['1', 'true', 'yes'].includes(str(env.PORTAL_ENABLED).toLowerCase()),
    orgMonthlyCredits: Math.round(num(env.ORG_MONTHLY_CREDITS, 300)),
    topUpCredits: Math.round(num(env.TOPUP_CREDITS, 300)),
    topUpCents: Math.round(num(env.TOPUP_AMOUNT_CENTS, 1000)),
    largeRequestCredits: num(env.LARGE_REQUEST_CREDITS, 10),
    ratePerMin: Math.round(num(env.AI_RATE_PER_MIN, 6)),
    ratePerDay: Math.round(num(env.AI_RATE_PER_DAY, 150)),
    dailyCapUsd: num(env.AI_DAILY_CAP_USD, 5),
    monthlyCapUsd: num(env.AI_MONTHLY_CAP_USD, 50),
    orgDailyCapUsd: num(env.ORG_DAILY_CAP_USD, 1),
    orgMonthlyCapUsd: num(env.ORG_MONTHLY_CAP_USD, 10),
    publicReserveShare: Math.min(0.9, Math.max(0, num(env.PUBLIC_RESERVE_SHARE, 0.3))),
    orgBudgets: (() => {
      try {
        const o = JSON.parse(str(env.ORG_BUDGETS, '{}'));
        return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
      } catch {
        return {};
      }
    })(),
    fxAudPerUsd: num(env.FX_AUD_PER_USD, 1.67),
    stripeSecretKey: str(env.STRIPE_SECRET_KEY),
    stripeWebhookSecret: str(env.STRIPE_WEBHOOK_SECRET),
    stripePriceId: str(env.STRIPE_PRICE_ID),
    planPackPriceCents: Math.round(num(env.PLAN_PACK_PRICE_CENTS, num(env.PLAN_PRICE_CENTS, 3500))), // PLAN_PRICE_CENTS is the live Worker's name for it
    entitlementSecret: str(env.ENTITLEMENT_SECRET),
    entitlementDays: num(env.ENTITLEMENT_DAYS, 365),
    exportMaxProjectBytes: Math.round(num(env.EXPORT_MAX_PROJECT_BYTES, 2000000)),
    aiTimeoutMs: Math.round(num(env.AI_TIMEOUT_MS, 30000)),
    // "Send to JCE" enquiries (lib/enquiry.js). RESEND_API_KEY is a secret; the others are plain variables.
    resendApiKey: str(env.RESEND_API_KEY),
    enquiryTo: str(env.ENQUIRY_TO, 'enquiries@jceinfrastructure.com.au'),
    enquiryFrom: str(env.ENQUIRY_FROM, 'Glide Inside <plans@glideinside.com.au>'),
    enquiryMaxPdfBytes: Math.round(num(env.ENQUIRY_MAX_PDF_BYTES, 6000000)),
    // Builder and client portal (lib/portal.js, lib/portal-billing.js). Secrets: ADMIN_TOKEN, STRIPE_SECRET_KEY.
    adminToken: str(env.ADMIN_TOKEN),
    sellerName: str(env.SELLER_NAME, 'JCE Infrastructure Pty Ltd trading as Glide Inside'),
    sellerAbn: str(env.SELLER_ABN, '29 699 165 663'),
    portalProjectMaxBytes: Math.round(num(env.PORTAL_PROJECT_MAX_BYTES, 1800000)), // D1 rows are limited to 2 MB
    portalLogoMaxBytes: Math.round(num(env.PORTAL_LOGO_MAX_BYTES, 400000)),
    loginMaxFailures: Math.round(num(env.LOGIN_MAX_FAILURES, 5)), // per username, then locked for 15 minutes
    loginIpMaxFailures: Math.round(num(env.LOGIN_IP_MAX_FAILURES, 20)), // per IP address
    sessionDays: num(env.SESSION_DAYS, 30), // sliding
    stripeLiveBillingApproved: str(env.STRIPE_LIVE_BILLING_APPROVED).toLowerCase() === 'owner-written-go-ahead',
    stripeGstTaxRateId: str(env.STRIPE_GST_TAX_RATE_ID),
    // Printed on the PDF title block. Defaults come from src/config.js (decision 17.1).
    disclaimer: str(env.DISCLAIMER),
    // Carried over from the live Pocket Architect API (Worker "pocket-architect-api", 15/10/2026).
    // Save and share (lib/projects.js): designs live in R2 under projects/<id>.json, a small row in D1 holds the lookup.
    ipHashSalt: str(env.IP_HASH_SALT),
    projectMaxBytes: num(env.PROJECT_MAX_BYTES, 0) > 0 ? Math.round(num(env.PROJECT_MAX_BYTES, 0)) : 2000000,
    projectTtlDays: num(env.PROJECT_TTL_DAYS, 0) > 0 ? num(env.PROJECT_TTL_DAYS, 0) : 365,
    projectSaveRateMax: num(env.PROJECT_SAVE_RATE_MAX, 0) > 0 ? Math.round(num(env.PROJECT_SAVE_RATE_MAX, 0)) : 20,
    projectReadRateMax: num(env.PROJECT_READ_RATE_MAX, 0) > 0 ? Math.round(num(env.PROJECT_READ_RATE_MAX, 0)) : 600,
    // Friends and testing codes (comma separated), accepted by /entitlement/restore exactly as on the live Worker.
    testCodes: str(env.TEST_CODES).split(',').map((c) => c.trim()).filter(Boolean),
    testCodePdfSets: Math.round(num(env.TEST_CODE_PDF_SETS, 20)),
    testCodeMaxUses: Math.round(num(env.TEST_CODE_MAX_USES, 25)),
    checkoutRateMax: Math.round(num(env.CHECKOUT_RATE_MAX, 20)), // per IP address per hour
    restoreRateMax: Math.round(num(env.RESTORE_RATE_MAX, 10)), // per IP address per 10 minutes
    exportRatePerHour: Math.round(num(env.EXPORT_RATE_PER_HOUR, 20)), // per Plan Pack
    // One PDF plan set per job (the live rule and the site wording). A repeat request gets the same file back. 0 turns it off.
    pdfSetLimit: !['0', 'false', 'off', 'no'].includes(str(env.PDF_SET_LIMIT, '1').toLowerCase()),
    pdfWaitMs: Math.round(num(env.EXPORT_PDF_WAIT_MS, 10000)),
  };
}
