// Small HTTP helpers on Web-standard Request and Response: errors, JSON, CORS, body limits.

export const ERROR_STATUS = {
  UNAUTHORISED: 401,
  NOT_ENTITLED: 403,
  CREDITS_EXHAUSTED: 402,
  INSUFFICIENT_CREDITS: 402,
  CONFIRM_REQUIRED: 409,
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
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'authorization, content-type';
    headers['Access-Control-Expose-Headers'] = 'content-disposition';
    headers['Access-Control-Max-Age'] = '600';
  }
  return headers;
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
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

export function clientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}
