// Credits: the meter text, the warning banners and the "shown once" memory. Pure helpers plus a little storage.

import { storage, plural, formatAud, ddmmyyyy } from './util.js';

/**
 * Accepts the server's balance shapes ({ total, used, remaining, warnLevel } or the edit reply's `credits`). Builder and
 * client logins also carry monthResetsOn ('YYYY-MM-DD', the first day of next month in Sydney), topUpRemaining (carry-over
 * credits, spent after the monthly ones) and topUp { allowed, credits, amountCents } for the top-up offer.
 */
export function normaliseCredits(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const total = Number(raw.total);
  const used = Number(raw.used);
  if (!Number.isFinite(total) || !Number.isFinite(used)) return null;
  const remaining = Number.isFinite(Number(raw.remaining)) ? Number(raw.remaining) : Math.max(0, total - used);
  const out = { total, used, remaining: Math.max(0, remaining), warnLevel: Number(raw.warnLevel) || 0 };
  if (typeof raw.monthResetsOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.monthResetsOn)) out.monthResetsOn = raw.monthResetsOn;
  if (raw.kind === 'org' || out.monthResetsOn) out.kind = 'org';
  const top = Number(raw.topUpRemaining);
  if (Number.isFinite(top) && top > 0) out.topUpRemaining = Math.round(top);
  // Commercial Developer subscription and the trial login count assistant MESSAGES (server/lib/commercial.js).
  if (raw.commercial === true) {
    out.commercial = true;
    out.trial = raw.trial === true;
    if (typeof raw.renewsOn === 'string' && !Number.isNaN(Date.parse(raw.renewsOn))) out.renewsOn = raw.renewsOn;
    const g = raw.paymentGrace;
    if (g && typeof g === 'object' && Number.isFinite(Number(g.daysLeft)) && !Number.isNaN(Date.parse(g.endsAt))) out.paymentGrace = { daysLeft: Math.max(0, Math.round(Number(g.daysLeft))), endsAt: g.endsAt };
    const o = raw.commercialTopUp;
    out.commercialTopUp = o && typeof o === 'object' ? { allowed: o.allowed !== false, available: o.available === true, messages: Math.round(Number(o.messages)) || 0, priceAud: Number(o.priceAud) || 0 } : null;
  }
  const offer = raw.topUp;
  if (offer && Number(offer.credits) > 0 && Number(offer.amountCents) > 0) out.topUp = { allowed: offer.allowed !== false, credits: Math.round(Number(offer.credits)), amountCents: Math.round(Number(offer.amountCents)) };
  return out;
}

/** The banner for a subscription whose last card payment failed and is still inside the grace period. */
export const graceText = (daysLeft) => `Your card payment failed. Update your card within ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} to keep access.`;

/** 'YYYY-MM-DD' to DD/MM/YYYY without time zone shifts. */
export const resetDate = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : '');
/** Credits a request can draw on: the monthly credits left plus any top-up credits. */
export const availableCredits = (c) => (c ? c.remaining + (c.topUpRemaining || 0) : 0);

export const meterText = (c) => {
  if (!c) return '';
  if (c.commercial) {
    const top = c.topUpRemaining ? ` plus ${c.topUpRemaining} extra` : '';
    return `${c.remaining} of ${c.total} ${c.trial ? 'trial ' : ''}AI messages left${top}`;
  }
  if (c.kind !== 'org') return `${c.remaining} of ${c.total} credits left`;
  const top = c.topUpRemaining ? ` plus ${c.topUpRemaining} top-up` : '';
  return `${c.remaining} of ${c.total} monthly credits left${top}`;
};
/** Second meter line for builder and client logins: when the monthly credits reset. */
export const resetText = (c) => (c?.commercial && c.renewsOn && !c.trial ? `Your allowance renews on ${ddmmyyyy(c.renewsOn)}.` : '') || (c?.kind === 'org' && c.monthResetsOn ? `Monthly credits reset on ${resetDate(c.monthResetsOn)}.` : '');
export const leftFraction = (c) => (c && c.total > 0 ? Math.min(1, Math.max(0, c.remaining / c.total)) : 0);
export const isExhausted = (c) => !!c && availableCredits(c) <= 0;

/** A subscriber (not the trial login) may buy a pack of extra AI messages. `available` is false until the owner sets the Stripe price: the button then reads Coming soon. */
export const canBuyMessages = (c) => !!c?.commercial && !c.trial && !!c.commercialTopUp?.allowed;
export const buyMessagesLabel = (c) => (c?.commercialTopUp?.available ? 'Buy more AI messages' : 'Buy more AI messages, coming soon');
/** "A$15 for 100 more AI messages" (GST inclusive), shown beside the button. */
export const topUpOfferText = (c) => {
  const t = c?.commercialTopUp;
  return t && t.messages > 0 && t.priceAud > 0 ? `${formatAud(t.priceAud)} for ${t.messages} more AI messages` : '';
};

/** The top-up offer is shown when the login may top up (the builder can turn client top-ups off for the organisation). */
export const canTopUp = (c) => !!c?.kind && c.kind === 'org' && !!c.topUp?.allowed;
/** Button text. A builder login sees its own invoice; a client login sees the builder's. */
export function topUpLabel(c, role = 'client') {
  const t = c?.topUp;
  if (!t) return '';
  return `Top up ${t.credits} credits, ${formatAud(t.amountCents / 100)} on ${role === 'builder' ? 'your' : "your builder's"} monthly invoice`;
}

/** 'ok' | 'warn' (80% used or more) | 'danger' (95% used or more). */
export function meterLevel(c) {
  if (!c || c.total <= 0) return 'ok';
  const used = 1 - leftFraction(c);
  return used >= 0.95 ? 'danger' : used >= 0.8 ? 'warn' : 'ok';
}

/** Banner text for a server warning { level, usedPercent, remaining }. `c` (the balance) selects the monthly wording. */
export function warningText(w, c = null) {
  if (c?.commercial) {
    const n = w.remaining;
    const pct = Number.isFinite(w.usedPercent) ? Math.round(w.usedPercent) : Math.round(w.level * 100);
    return `You have used ${pct}% of your AI messages. ${n} ${plural(n, 'message')} left${c.trial ? ' in this trial' : c.renewsOn ? ` until your allowance renews on ${ddmmyyyy(c.renewsOn)}` : ''}.`;
  }
  const left = `${w.remaining} ${plural(w.remaining, 'credit')} left`;
  const cap = left[0].toUpperCase() + left.slice(1);
  const percent = Number.isFinite(w.usedPercent) ? Math.round(w.usedPercent) : Math.round(w.level * 100);
  if (c?.kind === 'org') {
    const reset = c.monthResetsOn ? ` They reset on ${resetDate(c.monthResetsOn)}.` : '';
    if (w.level >= 0.95) return `Only ${left} this month. When they run out the assistant becomes read-only until the monthly reset. Editing and exports keep working.${reset}`;
    return `You have used ${w.level >= 0.5 && w.level < 0.6 ? 'half' : `${percent}%`} of this month's AI credits. ${cap}.${reset}`;
  }
  if (w.level >= 0.95) return `Only ${left}. When they run out the assistant becomes read-only. Editing and exports keep working.`;
  if (w.level >= 0.8) return `You have used ${percent}% of the AI credits in this Plan Pack. ${cap}.`;
  if (w.level >= 0.5 && w.level < 0.6) return `You have used half of the AI credits in this Plan Pack. ${cap}.`;
  return `You have used ${percent}% of the AI credits in this Plan Pack. ${cap}.`;
}

export const exhaustedText = (c) =>
  c?.commercial
    ? (c.trial
      ? `You have used all ${c.total} AI messages in this trial, so the assistant is read-only. Plan sets and manual editing still work.`
      : `You have used all your AI messages${c.renewsOn ? ` until your allowance renews on ${ddmmyyyy(c.renewsOn)}` : ''}, so the assistant is read-only. Buy more AI messages to keep going. Plan sets and manual editing still work.`)
    : c?.kind === 'org'
    ? `You have used all your AI credits for this month, so the assistant is read-only${c.monthResetsOn ? ` until the credits reset on ${resetDate(c.monthResetsOn)}` : ''}. Manual editing and exports still work.`
    : `You have used all ${c?.total ?? ''} AI credits in this Plan Pack, so the assistant is now read-only. Manual editing and exports still work.`.replace('  ', ' ');

// Each threshold is shown once per project, even across reloads.
const key = (projectId) => `ps.ai.warned.${projectId}`;

export function warnedLevels(projectId) {
  try {
    const list = JSON.parse(storage.get(key(projectId)) || '[]');
    return Array.isArray(list) ? list.filter((n) => Number.isFinite(n)) : [];
  } catch {
    return [];
  }
}

/** True the first time a level is seen for this project (and remembers it), false after. */
export function claimWarning(projectId, level) {
  const seen = warnedLevels(projectId);
  if (seen.includes(level)) return false;
  seen.push(level);
  storage.set(key(projectId), JSON.stringify(seen));
  return true;
}
