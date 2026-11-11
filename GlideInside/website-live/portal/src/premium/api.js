// Browser client for the Plan Studio API (docs/SCOPE.md 11.2). Plain fetch. Every failure becomes an ApiError with a
// stable `code` so the UI can choose a friendly message: the server's own codes (NOT_ENTITLED, CREDITS_EXHAUSTED,
// RATE_LIMITED, AI_PAUSED, ...) plus NETWORK, TIMEOUT and SERVER_UNAVAILABLE for failures before a reply.

export class ApiError extends Error {
  constructor(code, message, { status = 0, details = {}, retryAfter = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.retryAfter = retryAfter;
  }
}

const NETWORK_MESSAGE = 'Could not reach the Plan Studio server. Check your connection and try again.';

function filenameFrom(res, fallback) {
  const header = res.headers.get('content-disposition') || '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  if (!match) return fallback;
  try {
    return decodeURIComponent(match[1]).replace(/[\\/]/g, '_');
  } catch {
    return match[1].replace(/[\\/]/g, '_');
  }
}

/**
 * createApi({ base, fetchImpl, timeoutMs }) returns the endpoint methods. `token` arguments are bearer tokens.
 * `fetchImpl` lets tests and hosts supply their own fetch.
 */
export function createApi({ base = '/api', fetchImpl = null, timeoutMs = 45000 } = {}) {
  const root = String(base || '/api').replace(/\/+$/, '');
  const doFetch = (...args) => (fetchImpl || globalThis.fetch).call(globalThis, ...args);

  async function send(method, path, { token, body, query, timeout = timeoutMs } = {}) {
    const qs = query ? `?${new URLSearchParams(query)}` : '';
    const headers = { accept: 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
    let res;
    try {
      res = await doFetch(`${root}${path}${qs}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller?.signal,
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } catch (e) {
      if (timer) clearTimeout(timer);
      if (e?.name === 'AbortError') throw new ApiError('TIMEOUT', 'The server took too long to answer. Try again.');
      throw new ApiError('NETWORK', NETWORK_MESSAGE);
    }
    if (timer) clearTimeout(timer);
    return res;
  }

  async function failure(res) {
    const type = res.headers.get('content-type') || '';
    let data = null;
    if (type.includes('json')) data = await res.json().catch(() => null);
    if (!data || (!data.error && !data.code)) {
      // An HTML page or an empty reply: the API is not running behind this address.
      throw new ApiError('SERVER_UNAVAILABLE', 'The Plan Studio server is not available.', { status: res.status });
    }
    const e = data.error && typeof data.error === 'object' ? data.error : data;
    const { code, message, ...details } = e;
    const retry = Number(res.headers.get('retry-after') ?? details.retryAfter);
    throw new ApiError(code || 'ERROR', message || 'Something went wrong.', {
      status: res.status,
      details,
      retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null,
    });
  }

  async function json(method, path, options) {
    const res = await send(method, path, options);
    if (!res.ok) return failure(res);
    const data = await res.json().catch(() => null);
    if (data === null) throw new ApiError('SERVER_UNAVAILABLE', 'The Plan Studio server is not available.', { status: res.status });
    return data;
  }

  return {
    base: root,
    health: () => json('GET', '/health', { timeout: 8000 }),
    checkout: ({ projectId, projectName }) => json('POST', '/checkout', { body: { projectId, projectName }, timeout: 20000 }),
    /** { pending: true } while the payment is unconfirmed, otherwise { token, credits, projectId, receipt, expiresAt }. */
    async entitlement({ sessionId, projectId }) {
      const res = await send('GET', '/entitlement', { query: { session_id: sessionId, project: projectId }, timeout: 20000 });
      if (res.ok) return res.json();
      try {
        return await failure(res);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404 && e.details.pending) return { pending: true };
        throw e;
      }
    },
    /** Local testing only: the site's development server hands out a test entitlement (PLAN_STUDIO_DEV_GRANT=1). */
    devGrant: (projectId) => json('GET', '/entitlement', { query: { dev: '1', project: projectId }, timeout: 15000 }),
    restore: ({ email, sessionOrReceipt }) => json('POST', '/entitlement/restore', { body: { email, sessionOrReceipt }, timeout: 20000 }),
    credits: (token, projectId) => json('GET', '/credits', { token, query: projectId ? { project: projectId } : undefined, timeout: 15000 }),
    estimate: (token, body) => json('POST', '/ai/estimate', { token, body, timeout: 15000 }),
    edit: (token, body) => json('POST', '/ai/edit', { token, body, timeout: 45000 }),
    /** Paid export. Resolves { blob, filename }. */
    async exportFile(token, type, body, fallbackName = `export.${type}`) {
      const res = await send('POST', `/export/${type}`, { token, body, timeout: 90000 });
      if (!res.ok) return failure(res);
      return { blob: await res.blob(), filename: filenameFrom(res, fallbackName) };
    },
  };
}
