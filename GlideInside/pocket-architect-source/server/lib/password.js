// Password hashing, session tokens and constant-time helpers for the builder and client logins (docs/PORTAL_API.md 6).
// PBKDF2-HMAC-SHA-256 through Web Crypto. Cloudflare Workers throws above 100,000 iterations, so that is the figure used.
// Stored form: pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>, so the count can be raised later and old hashes upgraded at next sign in.

import { safeEqual } from './entitlement.js';

export const PBKDF2_ITERATIONS = 100000; // Workers maximum
export const SALT_BYTES = 16;
export const HASH_BYTES = 32;
const enc = new TextEncoder();

export const b64 = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, HASH_BYTES * 8));
}

export async function hashPassword(password, { iterations = PBKDF2_ITERATIONS } = {}) {
  if (typeof password !== 'string' || !password) throw new TypeError('password must be a non-empty string');
  const salt = randomBytes(SALT_BYTES);
  return `pbkdf2-sha256$${iterations}$${b64(salt)}$${b64(await derive(password, salt, iterations))}`;
}

/** { ok, needsRehash }. Never throws on a malformed stored value (answers ok false). */
export async function verifyPassword(password, stored, { iterations = PBKDF2_ITERATIONS } = {}) {
  try {
    if (typeof password !== 'string' || typeof stored !== 'string') return { ok: false, needsRehash: false };
    const [scheme, it, salt, hash] = stored.split('$');
    const n = Number(it);
    if (scheme !== 'pbkdf2-sha256' || !Number.isInteger(n) || n < 1 || n > 10_000_000 || !salt || !hash) return { ok: false, needsRehash: false };
    const actual = await derive(password, unb64(salt), n);
    const ok = safeEqual(actual, unb64(hash));
    return { ok, needsRehash: ok && n < iterations };
  } catch {
    return { ok: false, needsRehash: false };
  }
}

let dummy = null;
/** Spend the same time as a real check when the account does not exist, so response time does not reveal it. */
export async function dummyVerify(password) {
  dummy ||= hashPassword('not-a-real-password-for-timing');
  await verifyPassword(String(password ?? ''), await dummy);
}

/** A random 32 byte session token (base64url) and the SHA-256 hex of it, which is all the database keeps. */
export async function newSessionToken() {
  const raw = randomBytes(32);
  const token = b64(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { token, idHash: await sha256Hex(token) };
}

export async function sha256Hex(text) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))));
}

/** Constant-time string comparison (hashes both sides first so lengths do not leak). */
export async function secretEqual(a, b) {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(String(a))), crypto.subtle.digest('SHA-256', enc.encode(String(b)))]);
  return safeEqual(new Uint8Array(x), new Uint8Array(y));
}
