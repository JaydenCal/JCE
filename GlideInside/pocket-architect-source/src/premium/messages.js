// Friendly wording for failures. One place, so the upgrade flow, exports and the assistant say the same things.

import { plural } from './util.js';

/**
 * Plain-English message for an ApiError (or any error). `area` is 'ai', 'export', 'checkout', 'restore' or 'general'.
 * `dev` adds a pointer to the server README when the API is not there.
 */
export function friendlyError(e, { area = 'general', dev = false } = {}) {
  const code = e?.code;
  const fallback = typeof e?.message === 'string' && e.message ? e.message : 'Something went wrong. Try again.';
  switch (code) {
    case 'NETWORK':
      return 'Could not reach the Plan Studio server. Check your connection and try again. Nothing was charged.';
    case 'TIMEOUT':
      return area === 'ai' ? 'The assistant took too long to answer. Nothing was charged. Try again.' : 'The server took too long to answer. Try again.';
    case 'SERVER_UNAVAILABLE':
      if (dev) return 'The Plan Studio server is not running at this address. See server/README.md to start it.';
      return area === 'ai' ? 'The assistant is not available right now. Try again shortly.' : 'This is not available right now. Try again shortly.';
    case 'RATE_LIMITED': {
      const s = Number(e?.retryAfter);
      if (area === 'restore') return 'Too many attempts. Wait a little while and try again.';
      return Number.isFinite(s) && s > 0 && s <= 120
        ? `You are sending requests quickly. Wait about ${Math.ceil(s)} ${plural(Math.ceil(s), 'second')} and try again.`
        : 'You have reached the limit for AI requests on this project for now. Try again later.';
    }
    case 'AI_PAUSED':
      return 'The assistant is paused for a while to keep running costs under control. Your credits are untouched. Please try again later.';
    case 'PAYLOAD_TOO_LARGE':
      return area === 'export' ? 'This design is too large to export from here.' : 'This design is too large for the assistant to read. Try removing some furniture, or work on a smaller part of it.';
    case 'AI_TIMEOUT':
      return 'The assistant took too long to answer. Nothing was charged. Try again.';
    case 'AI_NOT_CONFIGURED':
      return 'The assistant is not switched on for this site yet.';
    case 'AI_ERROR':
      return fallback;
    case 'PAYMENTS_UNAVAILABLE':
      return 'Payments are not available right now. Please try again soon.';
    case 'EXPORT_UNAVAILABLE':
      return 'That export is not available right now. Try again, or try a different format.';
    case 'UNAUTHORISED':
    case 'NOT_ENTITLED':
      return area === 'restore' ? 'We could not find a Plan Pack with those details. Check the email used at checkout and the reference.' : fallback;
    default:
      return fallback;
  }
}

/** True when the failure means this browser's token is no longer good and should be forgotten. */
export const isAuthLoss = (e) => e?.code === 'UNAUTHORISED' || e?.code === 'NOT_ENTITLED';
