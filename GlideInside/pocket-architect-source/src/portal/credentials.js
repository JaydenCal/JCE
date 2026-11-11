// Login generator for builder staff and client logins (docs/PORTAL_API.md 5).
//   username: first name plus a short suffix that is easy to read out, e.g. "sarah-4827"
//   password: two plain words and two digits, e.g. "river-maple-47"
// Digits are 2 to 9 only, so 0, 1, O, I and l can never be confused. Randomness is crypto.getRandomValues unless a
// test supplies its own `randomInt(max)`.

import { WORDS } from './wordlist.js';

export const DIGITS = '23456789';
export const USERNAME_SUFFIX_DIGITS = 4;

/** Words that must never appear as a word or inside a word in the list or in generated output. */
export const BLOCKED_PARTS = ['fuck', 'shit', 'cunt', 'dick', 'cock', 'piss', 'slut', 'whor', 'nazi', 'rape', 'porn', 'nig', 'fag', 'crap', 'damn', 'hell', 'sex', 'arse', 'anal', 'kill', 'dead', 'hate', 'bitch', 'bastard', 'tit', 'ass'];

/** Uniform integer in [0, max) from crypto.getRandomValues, by rejection sampling (no modulo bias). */
export function cryptoInt(max) {
  if (!Number.isInteger(max) || max < 1 || max > 0xffffffff) throw new RangeError('max must be an integer from 1 to 2^32');
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

const digits = (n, randomInt) => Array.from({ length: n }, () => DIGITS[randomInt(DIGITS.length)]).join('');

/** "Sarah-Jane O'Neil" becomes "sarah" (first word, letters only, at most 12 characters). Empty names give "user". */
export function usernameBase(firstName) {
  const first = String(firstName || '').trim().split(/\s+/)[0] || '';
  const ascii = first.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  return (ascii || 'user').slice(0, 12);
}

/** A username not already in `taken` (a Set or array of existing usernames in the organisation, lowercase). */
export function generateUsername(firstName, taken = [], { randomInt = cryptoInt } = {}) {
  const used = taken instanceof Set ? taken : new Set([...taken].map((t) => String(t).toLowerCase()));
  const base = usernameBase(firstName);
  for (let i = 0; i < 200; i += 1) {
    const candidate = `${base}-${digits(USERNAME_SUFFIX_DIGITS, randomInt)}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('Could not generate a unique username');
}

/** Two different words from the list and two digits: "river-maple-47". */
export function generatePassword({ randomInt = cryptoInt, words = WORDS } = {}) {
  const a = words[randomInt(words.length)];
  let b = words[randomInt(words.length)];
  while (b === a) b = words[randomInt(words.length)];
  return `${a}-${b}-${digits(2, randomInt)}`;
}

export function generateCredentials(firstName, taken = [], opts = {}) {
  return { username: generateUsername(firstName, taken, opts), password: generatePassword(opts) };
}

/** A longer one time token for reset links in the mock (not a password). */
export function generateToken(bytes = 16) {
  return [...globalThis.crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const passwordProblem = (pw) => (typeof pw !== 'string' || pw.length < 8 ? 'Use at least 8 characters.' : null);
