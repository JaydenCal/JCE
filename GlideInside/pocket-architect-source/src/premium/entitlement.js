// Client side of the entitlement: the signed token kept in localStorage (`ps.ent.<projectId>`), and the wait for
// the webhook after checkout. The token proves nothing by itself: the server checks the database on every request.

import { storage, sleep as realSleep } from './util.js';
import { ApiError } from './api.js';

export const tokenKey = (projectId) => `ps.ent.${projectId}`;

function b64uToString(part) {
  const padded = String(part).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Read the payload { eid, pid, exp (seconds) } without verifying the signature. Null when malformed. */
export function tokenInfo(token, nowMs = Date.now()) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const p = JSON.parse(b64uToString(parts[0]));
    if (!p || typeof p.eid !== 'string' || typeof p.pid !== 'string') return null;
    const exp = typeof p.exp === 'number' ? p.exp : null;
    return { eid: p.eid, pid: p.pid, exp, expired: exp !== null && exp * 1000 <= nowMs };
  } catch {
    return null;
  }
}

export function clearToken(projectId) {
  if (projectId) storage.remove(tokenKey(projectId));
}

export function saveToken(projectId, token) {
  return !!projectId && storage.set(tokenKey(projectId), token);
}

/** The stored token for this project, or null. Malformed, expired or mismatched tokens are removed. */
export function loadToken(projectId, nowMs = Date.now()) {
  if (!projectId) return null;
  const token = storage.get(tokenKey(projectId));
  if (!token) return null;
  const info = tokenInfo(token, nowMs);
  if (!info || info.pid !== projectId || info.expired) {
    clearToken(projectId);
    return null;
  }
  return token;
}

/**
 * After checkout, ask for the entitlement until the payment is confirmed (up to 30 s by default).
 * Resolves { token, credits, projectId, receipt, expiresAt }. Rejects with an ApiError:
 *   PAYMENT_PENDING when the time ran out, or the server's own error when it is final (wrong project, refunded, bad request).
 * `sleep` and `now` can be replaced in tests.
 */
export async function waitForEntitlement({ api, sessionId, projectId, timeoutMs = 30000, intervalMs = 2000, sleep = realSleep, now = Date.now, onTick = null, signal = null }) {
  const started = now();
  let attempt = 0;
  for (;;) {
    if (signal?.aborted) throw new ApiError('CANCELLED', 'Cancelled.');
    attempt += 1;
    try {
      const res = await api.entitlement({ sessionId, projectId });
      if (res?.token) return res;
    } catch (e) {
      const transient = e instanceof ApiError && (e.code === 'NETWORK' || e.code === 'TIMEOUT' || e.status >= 500);
      if (!transient) throw e;
    }
    const elapsed = now() - started;
    if (elapsed + intervalMs > timeoutMs) throw new ApiError('PAYMENT_PENDING', 'Your payment has not been confirmed yet.');
    onTick?.({ attempt, elapsedMs: elapsed });
    await sleep(intervalMs);
  }
}
