// Small HTTP helpers on Web-standard Request and Response: errors, JSON, CORS, body limits.

export const ERROR_STATUS = {
  UNAUTHORISED: 401,
  NOT_ENTITLED: 403,
  CREDITS_EXHAUSTED: 402,
  INSUFFICIENT_CREDITS: 402,
  CONFIRM_REQUIRED: 409,
  TOPUP_DISABLED: 403,
  RATE_LIMITED: 429,
  AI_PAUSED: 503,
  PAYLOAD_TOO_LARGE: 413,
  BAD_REQUEST: 400,
  // Added to the brief's list for conditions it does not cover.
  NOT_FOUND: 404,
  AI_ERROR: 502,
  AI_TIMEOUT: 504,
  AI_NOT_CONFIGURED: 503,
  PAYMENTS_UNAVAILABLE: 503,
  EXPORT_UNAVAILABLE: 503,
  SERVER_NOT_CONFIGURED: 500,
  // Site lookup (server/lib/site.js).
  UNSUPPORTED_AREA: 422,
  SITE_UPSTREAM: 502,
  ENQUIRY_NOT_CONFIGURED: 503,
  EMAIL_FAILED: 502,
  // Builder and client portal (docs/PORTAL_API.md 1).
  INVALID_CREDENTIALS: 401,
  PASSWORD_EXPIRED: 401,
  ACCOUNT_LOCKED: 423,
  ACCOUNT_DISABLED: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  FORBIDDEN: 403,
  TOPUPS_DISABLED: 403,
  CONFLICT: 409,
  TERMS_REQUIRED: 409,
  BILLING_DETAILS_REQUIRED: 409,
  PORTAL_NOT_CONFIGURED: 503,
  BILLING_UNAVAILABLE: 502,
  // Save and share (carried over from the live Worker, same codes and statuses).
  SHARING_UNAVAILABLE: 503,
  PROJECT_TOO_LARGE: 413,
  BAD_PROJECT: 400,
  BAD_EMAIL: 400,
  BAD_EDIT_KEY: 403,
  EXPIRED: 410,
  PDF_LIMIT_REACHED: 403,
  EXPORT_FAILED: 500,
  // Commercial subscription and trial login (lib/commercial.js).
  SUBSCRIPTION_COMING_SOON: 503,
  TRIAL_DISABLED: 403,
  TRIAL_EXPIRED: 403,
  FAIR_USE_LIMIT: 429,
  TRIAL_LIMIT: 429,
  // Free user profiles (lib/profiles.js).
  PROFILES_NOT_CONFIGURED: 503,
  DESIGN_LIMIT_REACHED: 409,
  SIGNUP_FAILED: 409,
};

export class HttpError extends Error {
  constructor(code, message, extra = {}, status = ERROR_STATUS[code] || 500) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function corsHeaders(request, config) {
  const headers = { Vary: 'Origin' };
  const origin = request.headers.get('origin');
  if (origin && config.siteOrigin && origin === config.siteOrigin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'authorization, content-type, x-gi-request, x-edit-key';
    headers['Access-Control-Allow-Credentials'] = 'true'; // only ever sent for the configured site origin
    headers['Access-Control-Expose-Headers'] = 'content-disposition, x-site-meta';
    headers['Access-Control-Max-Age'] = '600';
  }
  return headers;
}

// Security headers for API responses (security review M5). The API only ever returns JSON or a downloaded file, so the CSP is as tight as it
// gets: nothing may load or run from an API response and it cannot be framed. The static site's headers are set in Cloudflare (SECURITY-HEADERS.md).
export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

/** Add the security headers to a response unless it already set that header (an HTML export sets its own sandbox CSP). */
export function withSecurityHeaders(res) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!res.headers.has(k)) res.headers.set(k, v);
  return res;
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS, ...headers },
  });
}

export function errorBody(err) {
  return { error: { code: err.code, message: err.message, ...err.extra }, code: err.code, message: err.message, ...err.extra };
}

export function errorResponse(err, headers = {}) {
  const extraHeaders = { ...headers };
  if (err.extra?.retryAfter) extraHeaders['retry-after'] = String(err.extra.retryAfter);
  return json(errorBody(err), err.status, extraHeaders);
}

// Read a body without trusting content-length, stopping at maxBytes.
export async function readText(request, maxBytes) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError('PAYLOAD_TOO_LARGE', 'That request is too large.', { maxBytes });
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => {});
      throw new HttpError('PAYLOAD_TOO_LARGE', 'That request is too large.', { maxBytes });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function readJson(request, maxBytes) {
  const text = await readText(request, maxBytes);
  if (!text.trim()) throw new HttpError('BAD_REQUEST', 'A JSON body is required.');
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
    return body;
  } catch {
    throw new HttpError('BAD_REQUEST', 'The request body is not valid JSON.');
  }
}

export const bearerToken = (request) => /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '')?.[1] || null;

// L13: the visitor address is the one Cloudflare puts in CF-Connecting-IP (a client cannot set it: Cloudflare overwrites it). X-Forwarded-For and
// X-Real-IP are spoofable when the Worker is reached some other way, so they are ignored unless the host is NOT behind Cloudflare and says so
// (TRUST_FORWARDED_HEADERS=1). With neither, every request shares the address "unknown", which is the safe (strictest) behaviour.
let trustForwarded = false;
export const setTrustForwardedHeaders = (on) => {
  trustForwarded = on === true;
};

export function clientIp(request) {
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  if (trustForwarded) return (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
  return 'unknown';
}
