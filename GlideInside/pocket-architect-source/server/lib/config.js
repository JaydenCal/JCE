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
    // Mapbox PUBLIC token (pk.) handed to the browser for the worldwide aerial. A secret token (sk.) is never accepted or sent.
    mapboxPublicToken: /^pk\.[A-Za-z0-9._-]+$/.test(str(env.MAPBOX_PUBLIC_TOKEN)) ? str(env.MAPBOX_PUBLIC_TOKEN) : '',
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
    internalAiMonthly: Math.max(0, Math.round(num(env.INTERNAL_AI_MONTHLY, 1000))), // monthly AI allowance of an internal test account (no top-up charges)
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
    planPackPriceCents: Math.round(num(env.PLAN_PACK_PRICE_CENTS, num(env.PLAN_PRICE_CENTS, 3000))), // PLAN_PRICE_CENTS is the live Worker's name for it
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
    loginMaxFailures: Math.round(num(env.LOGIN_MAX_FAILURES, 5)), // attempts per username AND address per 15 minutes (counted before the password is checked), then locked
    loginIpMaxFailures: Math.round(num(env.LOGIN_IP_MAX_FAILURES, 20)), // attempts per address (all usernames)
    loginUserGlobalMax: Math.round(num(env.LOGIN_USER_GLOBAL_MAX, 40)), // attempts per username from ALL addresses per 15 minutes: slows distributed guessing (a higher ceiling than the per address limit)
    sessionDays: num(env.SESSION_DAYS, 30), // sliding
    stripeLiveBillingApproved: str(env.STRIPE_LIVE_BILLING_APPROVED).toLowerCase() === 'owner-written-go-ahead',
    stripeGstTaxRateId: str(env.STRIPE_GST_TAX_RATE_ID),
    // Printed on the PDF title block. Defaults come from src/config.js (decision 17.1).
    disclaimer: str(env.DISCLAIMER),
    // Carried over from the live Pocket Architect API (Worker "pocket-architect-api", 15/10/2026).
    // Save and share (lib/projects.js): designs live in R2 under projects/<id>.json, a small row in D1 holds the lookup.
    ipHashSalt: str(env.IP_HASH_SALT),
    // Plan set terms (lib/terms.js): paid PDF and DXF exports are refused with 409 TERMS_REQUIRED until the account has accepted the current version.
    // On unless TERMS_REQUIRED is 0, false, off or no (only the legacy export tests turn it off).
    termsRequired: !['0', 'false', 'off', 'no'].includes(str(env.TERMS_REQUIRED, '1').toLowerCase()),
    projectMaxBytes: num(env.PROJECT_MAX_BYTES, 0) > 0 ? Math.round(num(env.PROJECT_MAX_BYTES, 0)) : 2000000,
    projectTtlDays: num(env.PROJECT_TTL_DAYS, 0) > 0 ? num(env.PROJECT_TTL_DAYS, 0) : 365,
    projectSaveRateMax: num(env.PROJECT_SAVE_RATE_MAX, 0) > 0 ? Math.round(num(env.PROJECT_SAVE_RATE_MAX, 0)) : 20,
    projectDailyBytesPerIp: num(env.PROJECT_DAILY_BYTES_PER_IP, 0) > 0 ? Math.round(num(env.PROJECT_DAILY_BYTES_PER_IP, 0)) : 40000000, // anonymous share storage written per visitor address per day (L8)
    projectReadRateMax: num(env.PROJECT_READ_RATE_MAX, 0) > 0 ? Math.round(num(env.PROJECT_READ_RATE_MAX, 0)) : 600,
    // Friends and testing codes (comma separated), accepted by /entitlement/restore exactly as on the live Worker.
    testCodes: str(env.TEST_CODES).split(',').map((c) => c.trim()).filter(Boolean),
    testCodePdfSets: Math.round(num(env.TEST_CODE_PDF_SETS, 20)),
    testCodeMaxUses: Math.round(num(env.TEST_CODE_MAX_USES, 25)),
    checkoutRateMax: Math.round(num(env.CHECKOUT_RATE_MAX, 20)), // per IP address per hour
    restoreRateMax: Math.round(num(env.RESTORE_RATE_MAX, 10)), // per IP address per 10 minutes
    exportRatePerHour: Math.round(num(env.EXPORT_RATE_PER_HOUR, 20)), // per Plan Pack
    // Off by default (owner decision 11/11/2026): a paid job can re-export its current design; the hourly export limit still applies.
    // PDF_SET_LIMIT=1 brings back the old live rule: ONE PDF plan set per job, a repeat request gets the same file back.
    pdfSetLimit: !['0', 'false', 'off', 'no'].includes(str(env.PDF_SET_LIMIT, '0').toLowerCase()),
    pdfWaitMs: Math.round(num(env.EXPORT_PDF_WAIT_MS, 10000)),
    // Commercial Developer subscription and the shared commercial trial login (lib/commercial.js). Owner decision 15/11/2026: both are
    // UNLIMITED for plan set PDFs. The AI assistant is limited (monthly allowance, trial total, top-up packs); optional caps are OFF at 0.
    commercialSubPriceId: str(env.COMMERCIAL_SUB_PRICE_ID), // the A$50 per month recurring price the owner creates in Stripe; empty = "Coming soon"
    commercialSubPriceAud: num(env.COMMERCIAL_SUB_PRICE_AUD, 50), // display only
    commercialAiMonthly: Math.max(0, Math.round(num(env.COMMERCIAL_AI_MONTHLY, 150))), // assistant messages per billing period for a subscriber
    commercialAiTopupPriceId: str(env.COMMERCIAL_AI_TOPUP_PRICE_ID), // one-off Stripe price for one top-up pack; empty = "Coming soon"
    commercialAiTopupPriceAud: num(env.COMMERCIAL_AI_TOPUP_PRICE_AUD, 15), // display only: must match the one-off price the owner creates in Stripe
    commercialAiModel: str(env.COMMERCIAL_AI_MODEL) || 'claude-sonnet-5-5', // the commercial assistant (commercial mode only); residential keeps ANTHROPIC_MODEL
    commercialAiPriceInPerMtok: num(env.COMMERCIAL_AI_PRICE_IN_PER_MTOK_USD, 2), // USD per million tokens for claude-sonnet-5-5 (verified Anthropic pricing 15/11/2026), used for the owner's cost view
    commercialAiPriceOutPerMtok: num(env.COMMERCIAL_AI_PRICE_OUT_PER_MTOK_USD, 10),
    commercialAiPriceCacheWritePerMtok: num(env.COMMERCIAL_AI_PRICE_CACHE_WRITE_PER_MTOK_USD, 2.5), // 5 minute cache write
    commercialAiPriceCacheReadPerMtok: num(env.COMMERCIAL_AI_PRICE_CACHE_READ_PER_MTOK_USD, 0.1),
    commercialAiTopupQty: Math.max(1, Math.round(num(env.COMMERCIAL_AI_TOPUP_QTY, 100))), // messages in one top-up pack
    commercialGraceDays: Math.max(0, num(env.COMMERCIAL_GRACE_DAYS, 3)), // days of access kept after the first failed subscription invoice (Stripe past_due), then it locks
    commercialExportRatePerHour: Math.max(1, Math.round(num(env.COMMERCIAL_EXPORT_RATE_PER_HOUR, 120))), // anti-abuse only, per account
    commercialTrialDailyPdfs: Math.max(0, Math.round(num(env.COMMERCIAL_TRIAL_DAILY_PDFS, 0))), // 0 = off (plan set PDFs are unlimited)
    commercialTrialAiTotal: Math.max(0, Math.round(num(env.COMMERCIAL_TRIAL_AI_TOTAL, 50))), // assistant messages for the whole trial login, owner can reset
    commercialTrialWatermark: !['0', 'false', 'off', 'no'].includes(str(env.COMMERCIAL_TRIAL_WATERMARK, '1').toLowerCase()), // on by default
    commercialTrialKeepDays: Math.max(1, num(env.COMMERCIAL_TRIAL_KEEP_DAYS, 30)), // trial saved projects are cleared after this
    // Free user profiles (lib/profiles.js): sign up with name and email to keep designs. Nothing here sends email.
    freeProfileMaxDesigns: Math.max(1, Math.round(num(env.FREE_PROFILE_MAX_DESIGNS, 10))), // saved designs per free profile
    profileSignupRateMax: Math.max(1, Math.round(num(env.PROFILE_SIGNUP_RATE_MAX, 5))), // sign ups per IP address per hour
    profileSigninIpMax: Math.max(1, Math.round(num(env.PROFILE_SIGNIN_IP_MAX, 30))), // sign in attempts per IP address per 10 minutes
    profileSigninEmailMax: Math.max(1, Math.round(num(env.PROFILE_SIGNIN_EMAIL_MAX, 8))), // sign in attempts per email AND address per 15 minutes (M4: a stranger cannot throttle the owner on another address)
    profileSigninEmailGlobalMax: Math.max(1, Math.round(num(env.PROFILE_SIGNIN_EMAIL_GLOBAL_MAX, 40))), // sign in attempts per email from all addresses per 15 minutes: slows guessing spread over many addresses
    profileSaveRateMax: Math.max(1, Math.round(num(env.PROFILE_SAVE_RATE_MAX, 1200))), // design saves per profile per hour (autosave is debounced in the browser)
    aiEstimateRatePerMin: Math.max(1, Math.round(num(env.AI_ESTIMATE_RATE_PER_MIN, 20))), // /ai/estimate calls per account per minute (L11)
    clientTopUpMonthlyMax: Math.max(0, Math.round(num(env.CLIENT_TOPUP_MONTHLY_MAX, 3))), // top-ups one CLIENT login may buy per Sydney month, billed to the builder (L2); 0 = none
    consentArchiveYears: Math.max(1, num(env.CONSENT_ARCHIVE_YEARS, 3)), // anonymised consent records kept after a profile is deleted (L6)
    trustForwardedHeaders: ['1', 'true', 'yes', 'on'].includes(str(env.TRUST_FORWARDED_HEADERS).toLowerCase()), // L13: only for a host that is NOT behind Cloudflare
    commercialTrialSessionHours: Math.max(1, num(env.COMMERCIAL_TRIAL_SESSION_HOURS, 168)),
  };
}
