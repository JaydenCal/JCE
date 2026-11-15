// Sign in attempt counting for the portal and the commercial trial login (security review 15/11/2026, M1 and M4).
//
// M1: the attempt is COUNTED FIRST, in one atomic upsert (store.attempt, same idea as store.hitRate), and only then is the password
//     checked. Parallel guesses therefore cannot all slip past a limit that is only updated after the check. A correct password gives
//     the attempt back (the counters are not a quota for honest sign ins).
// M4: the lock is keyed on username PLUS address, so a stranger guessing at a known username locks only their own address, never the real
//     user. A separate, higher ceiling per username across all addresses (LOGIN_USER_GLOBAL_MAX) slows guessing spread over many addresses.
//     A per address ceiling over all usernames (LOGIN_IP_MAX_FAILURES) stays as before.
// Messages and codes are unchanged: ACCOUNT_LOCKED (423) for a username lock, RATE_LIMITED (429) for an address lock.

import { HttpError, clientIp } from './http.js';

export const LOCKOUT_MS = 15 * 60000;

export const loginKeys = (scope, subject, ip) => ({ ip: `${scope}ip:${ip}`, user: `${scope}u:${subject}|${ip}`, global: `${scope}ug:${subject}`, userPrefix: `${scope}u:${subject}|`, globalKey: `${scope}ug:${subject}` });

const lockedError = (retryAfter) => new HttpError('ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${Math.max(1, Math.ceil(retryAfter / 60))} minutes.`, { retryAfter });
const rateError = (retryAfter) => new HttpError('RATE_LIMITED', 'Too many attempts. Try again later.', { retryAfter });

/**
 * Count one attempt for `subject` (a lower case username or email) from this request's address. Throws when any limit is already used up.
 * Returns { failed(), succeeded() }: call failed() after a wrong password (it returns the error to throw, ACCOUNT_LOCKED when this guess used the
 * last allowance) and succeeded() after a right one.
 */
export async function countLoginAttempt(ps, { scope = '', subject, request, nowMs, config }) {
  const ip = clientIp(request);
  const k = loginKeys(scope, subject, ip);
  const ipMax = config.loginIpMaxFailures;
  const userMax = config.loginMaxFailures;
  const globalMax = Math.max(config.loginUserGlobalMax, userMax);
  const a = await ps.attempt(k.ip, nowMs, { windowMs: LOCKOUT_MS, max: ipMax });
  if (!a.allowed) throw rateError(a.retryAfter);
  const u = await ps.attempt(k.user, nowMs, { windowMs: LOCKOUT_MS, max: userMax });
  if (!u.allowed) {
    await ps.releaseAttempt(k.ip); // a refused attempt is not charged to the address ceiling
    throw lockedError(u.retryAfter);
  }
  const g = await ps.attempt(k.global, nowMs, { windowMs: LOCKOUT_MS, max: globalMax });
  if (!g.allowed) {
    await ps.releaseAttempt(k.ip);
    await ps.releaseAttempt(k.user);
    throw lockedError(g.retryAfter);
  }
  return {
    failed() {
      return u.count >= userMax || g.count >= globalMax ? lockedError(LOCKOUT_MS / 1000) : new HttpError('INVALID_CREDENTIALS', 'That sign in did not work. Check the details and try again.');
    },
    async succeeded() {
      await ps.clearFailure(k.user);
      await ps.releaseAttempt(k.ip);
      await ps.releaseAttempt(k.global);
    },
  };
}

/** Forget every counter for a username (a new temporary password, an admin reset). */
export async function clearLoginCounters(ps, { scope = '', subject }) {
  const k = loginKeys(scope, subject, '');
  await ps.clearFailuresByPrefix(k.userPrefix);
  await ps.clearFailure(k.globalKey);
}
