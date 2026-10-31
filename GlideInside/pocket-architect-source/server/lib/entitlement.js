// Entitlement tokens (docs/SCOPE.md 11.5): base64url(payload).base64url(HMAC-SHA256(payload, secret)),
// payload { eid, pid, exp } with exp in seconds. The token alone grants nothing: the database is checked
// on every request for status, expiry and credits.

import { HttpError, bearerToken } from './http.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

export const toB64u = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const fromB64u = (s) => {
  const padded = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

export async function hmacSha256(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, typeof data === 'string' ? enc.encode(data) : data));
}

// Compare in constant time for equal lengths.
export function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function signToken(payload, secret) {
  if (!secret) throw new HttpError('SERVER_NOT_CONFIGURED', 'ENTITLEMENT_SECRET is not set.');
  const body = enc.encode(JSON.stringify(payload));
  return `${toB64u(body)}.${toB64u(await hmacSha256(secret, body))}`;
}

/** Returns the payload when the signature is valid and the token has not expired, otherwise null. */
export async function verifyToken(token, secret, nowSec) {
  if (!token || !secret || typeof token !== 'string') return null;
  const [p, s, extra] = token.split('.');
  if (!p || !s || extra !== undefined) return null;
  try {
    const body = fromB64u(p);
    const expected = await hmacSha256(secret, body);
    if (!safeEqual(expected, fromB64u(s))) return null;
    const payload = JSON.parse(dec.decode(body));
    if (!payload?.eid || !payload?.pid) return null;
    if (typeof payload.exp === 'number' && payload.exp <= nowSec) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function issueToken(ent, config, nowMs) {
  const exp = ent.expiresAt ? Math.floor(Date.parse(ent.expiresAt) / 1000) : Math.floor(nowMs / 1000) + Math.round(config.entitlementDays * 86400);
  return signToken({ eid: ent.id, pid: ent.projectId, exp }, config.entitlementSecret);
}

/**
 * Authenticate a request and load its entitlement from the database.
 * `missing` chooses the code for a missing or invalid token: 'UNAUTHORISED' (default) or 'NOT_ENTITLED' (exports).
 */
export async function authenticate(request, { store, config, now, missing = 'UNAUTHORISED' }) {
  const nowMs = now();
  const payload = await verifyToken(bearerToken(request), config.entitlementSecret, Math.floor(nowMs / 1000));
  if (!payload) {
    if (missing === 'NOT_ENTITLED') throw new HttpError('NOT_ENTITLED', 'A Plan Pack is needed for this feature.');
    throw new HttpError('UNAUTHORISED', 'Your Plan Pack could not be verified. Restore your purchase to continue.');
  }
  const ent = await store.getEntitlement(payload.eid);
  if (!ent || ent.projectId !== payload.pid) throw new HttpError('NOT_ENTITLED', 'No Plan Pack was found for this project.');
  if (ent.status !== 'active') {
    throw new HttpError('NOT_ENTITLED', ent.status === 'refunded' ? 'This Plan Pack has been refunded.' : 'This Plan Pack is no longer active.');
  }
  if (ent.expiresAt && Date.parse(ent.expiresAt) <= nowMs) throw new HttpError('NOT_ENTITLED', 'This Plan Pack has expired.');
  return ent;
}
