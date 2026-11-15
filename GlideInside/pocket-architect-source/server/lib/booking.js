// Deterministic booking functions for the concierge. NO model is involved here: availability, proposals, confirmation, reconciliation
// and cancellation are plain code over a provider adapter (booking-provider.js). The model can only ask the UI to show these steps.
//
// Integrity rules (docs: DESIGN.md "Booking integrity"):
//  * a booking exists only when the provider returned an accepted confirmation; nothing else is ever reported as confirmed
//  * confirm needs a signed, unexpired proposal AND an explicit user confirmation flag AND an idempotency key
//  * one atomic claim per proposal id and per idempotency key (duplicate submit, replay)
//  * availability is rechecked at propose time and again immediately before the provider is asked to book
//  * a timeout or unclear answer is UNKNOWN: reconciled by lookup, never retried blindly
//  * only the reference, type, slot time, status, provider id and an ownership token hash are stored (no name, email or text)

import { hmacSha256, toB64u, fromB64u, safeEqual } from './entitlement.js';
import { ProviderError } from './booking-provider.js';
import { HttpError } from './http.js';
import { sydneyDateKey, addDays, dayBoundsUtc, formatSlot, parseDateKey } from './concierge-time.js';

/** Booking types. Every type is INACTIVE until the owner approves it (CONCIERGE_APPROVED_TYPES). Durations await owner approval too. */
export const BOOKING_TYPES = {
  homeowner: { id: 'homeowner', label: 'Homeowner consultation', durationMin: 15, audience: 'Homeowner', active: false },
  builder: { id: 'builder', label: 'Builder demonstration', durationMin: 30, audience: 'Builder', active: false },
  developer: { id: 'developer', label: 'Developer or estate presentation', durationMin: 30, audience: 'Developer or estate', active: false },
  agent: { id: 'agent', label: 'Real estate agent demonstration', durationMin: 20, audience: 'Real estate agent', active: false },
};
export const BOOKING_TYPE_IDS = Object.keys(BOOKING_TYPES);

const enc = new TextEncoder();
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomRef = () => `GI-${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('')}`;
const randomToken = () => toB64u(crypto.getRandomValues(new Uint8Array(24)));
const sha256Hex = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const bad = (msg, code = 'BAD_REQUEST', extra = {}, status) => new HttpError(code, msg, extra, status);

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const clean = (v, max) => String(typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f\u2028\u2029<>]+/g, ' ').trim().slice(0, max);

// Signed, short lived proposal token. It carries the details the visitor typed, so the server stores none of them before confirmation.
export async function signBlob(payload, secret) {
  const text = toB64u(enc.encode(JSON.stringify(payload)));
  return `${text}.${toB64u(await hmacSha256(secret, `cc1.${text}`))}`;
}
export async function verifyBlob(token, secret, nowMs, kind) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const [p, s, extra] = token.split('.');
  if (!p || !s || extra !== undefined) return null;
  try {
    if (!safeEqual(await hmacSha256(secret, `cc1.${p}`), fromB64u(s))) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64u(p)));
    if (payload?.k !== kind || typeof payload.exp !== 'number' || payload.exp <= nowMs) return null;
    return payload;
  } catch { return null; }
}

/**
 * @param {object} o
 * @param {object} o.provider adapter (booking-provider.js)
 * @param {object} o.bstore booking-store.js
 * @param {object} o.settings { approved: string[], eventTypeIds: {type:id}, noticeHours, horizonDays, proposalTtlMin, reconcileGraceMs }
 * @param {string} o.secret signing secret
 */
export function createBooking({ provider, bstore, settings, secret, now = () => Date.now(), log = () => {} }) {
  const types = () => Object.fromEntries(BOOKING_TYPE_IDS.map((id) => [id, { ...BOOKING_TYPES[id], active: settings.approved.includes(id) }]));
  const typeOrThrow = (id) => {
    const t = types()[id];
    if (!t) throw bad('Unknown booking type.');
    if (!t.active) throw bad('That booking type is not open yet. Please use the enquiry form.', 'BOOKING_TYPE_INACTIVE', {}, 409);
    return t;
  };
  const eventTypeId = (type) => settings.eventTypeIds?.[type] ?? null;
  const earliestMs = () => now() + settings.noticeHours * 3600e3;

  async function listSlots({ type, from, days = 7 }) {
    const t = typeOrThrow(type);
    const todayKey = sydneyDateKey(now());
    let fromKey = from == null || from === '' ? todayKey : parseDateKey(from) ? from : null;
    if (!fromKey) throw bad('from must be a date like 2026-11-20.');
    if (fromKey < todayKey) fromKey = todayKey;
    const n = Math.max(1, Math.min(14, Math.floor(Number(days) || 7)));
    const lastKey = addDays(todayKey, settings.horizonDays);
    if (fromKey > lastKey) return { type, slots: [], horizonEnd: lastKey };
    const endKey = addDays(fromKey, n);
    const startMs = Math.max(dayBoundsUtc(fromKey)[0], earliestMs());
    const endMs = dayBoundsUtc(endKey > addDays(lastKey, 1) ? addDays(lastKey, 1) : endKey)[0];
    let raw;
    try {
      raw = await provider.getSlots({ type, eventTypeId: eventTypeId(type), startMs, endMs, durationMin: t.durationMin });
    } catch (e) {
      if (e instanceof ProviderError) throw bad('The calendar is not available right now. Please use the enquiry form.', 'CALENDAR_UNAVAILABLE', {}, 503);
      throw e;
    }
    const slots = raw.filter((s) => s.startMs >= startMs && s.startMs < endMs).slice(0, 60).map((s) => ({ start: new Date(s.startMs).toISOString(), ...formatSlot(s.startMs) }));
    return { type, durationMin: t.durationMin, slots };
  }

  async function slotIsFree(type, startMs) {
    const t = types()[type];
    const got = await provider.getSlots({ type, eventTypeId: eventTypeId(type), startMs, endMs: startMs + 60000, durationMin: t.durationMin });
    return got.some((s) => s.startMs === startMs);
  }

  /** Validate and return a signed proposal. Nothing is booked and nothing is stored. */
  async function propose({ type, slotStart, name, email, marketingOptIn = false, convId }) {
    const t = typeOrThrow(type);
    const startMs = Date.parse(slotStart);
    if (!Number.isFinite(startMs) || typeof slotStart !== 'string') throw bad('Choose a time from the list.');
    const nm = clean(name, 100);
    const em = clean(email, 254).toLowerCase();
    if (nm.length < 2) throw bad('Enter your name.');
    if (!EMAIL.test(em)) throw bad('That email address does not look right.');
    if (startMs < earliestMs()) throw bad('That time is too soon. Please choose a later time.', 'SLOT_EXPIRED', {}, 409);
    let free;
    try { free = await slotIsFree(type, startMs); } catch (e) { if (e instanceof ProviderError) throw bad('The calendar is not available right now. Please use the enquiry form.', 'CALENDAR_UNAVAILABLE', {}, 503); throw e; }
    if (!free) throw bad('That time has just been taken. Please choose another.', 'SLOT_TAKEN', {}, 409);
    const id = randomRef();
    const exp = now() + settings.proposalTtlMin * 60000;
    const token = await signBlob({ k: 'prop', id, t: type, s: startMs, n: nm, e: em, m: marketingOptIn === true ? 1 : 0, c: convId || null, exp }, secret);
    return { proposalToken: token, expiresAt: new Date(exp).toISOString(), summary: { type, label: t.label, durationMin: t.durationMin, start: new Date(startMs).toISOString(), ...formatSlot(startMs), name: nm, email: em, marketingOptIn: marketingOptIn === true } };
  }

  const publicResult = (row, extra = {}) => {
    const f = formatSlot(row.slotStartMs);
    return { ref: row.id, type: row.type, start: new Date(row.slotStartMs).toISOString(), ...f, ...extra };
  };

  async function alternatives(type, startMs) {
    try {
      const out = await listSlots({ type, from: sydneyDateKey(startMs), days: 5 });
      return out.slots.filter((s) => Date.parse(s.start) !== startMs).slice(0, 6);
    } catch { return []; }
  }

  /**
   * Confirm. `userConfirmed` must be the literal boolean true set by the browser's confirm button; the server never takes it from model text.
   * Returns { state: 'confirmed' | 'requested' | 'unknown' | 'failed' | 'in_progress', ... }. Only 'confirmed' may be shown as confirmed.
   */
  async function confirm({ proposalToken, idemKey, userConfirmed, convId }) {
    if (userConfirmed !== true) throw bad('Press Confirm booking to book this time.', 'CONFIRM_REQUIRED', {}, 409);
    if (typeof idemKey !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(idemKey)) throw bad('A valid idempotency key is required.');
    const p = await verifyBlob(proposalToken, secret, now(), 'prop');
    if (!p) throw bad('This booking request has expired. Please choose a time again.', 'PROPOSAL_EXPIRED', {}, 410);
    if (p.c && convId && p.c !== convId) throw bad('This booking request belongs to a different conversation.', 'FORBIDDEN', {}, 403);
    const type = p.t; const startMs = p.s;
    if (!types()[type]?.active) throw bad('That booking type is not open yet.', 'BOOKING_TYPE_INACTIVE', {}, 409);

    const existing = (await bstore.get(p.id)) || (await bstore.getByIdem(idemKey));
    if (existing) return replay(existing, p);

    if (startMs < earliestMs()) throw bad('That time is too soon. Please choose a later time.', 'SLOT_EXPIRED', {}, 409);
    const at = new Date(now()).toISOString();
    const claimed = await bstore.claim({ id: p.id, idemKey, type, slotStartMs: startMs, provider: provider.kind, at });
    if (!claimed) return replay((await bstore.get(p.id)) || (await bstore.getByIdem(idemKey)), p); // lost the race: same outcome as the winner

    return attempt(p, type, startMs);
  }

  async function attempt(p, type, startMs) {
    const id = p.id;
    const stamp = () => new Date(now()).toISOString();
    // 1. recheck availability immediately before booking
    let free;
    try { free = await slotIsFree(type, startMs); } catch (e) {
      await bstore.updateIf(id, ['pending'], { status: 'failed_retryable' }, stamp());
      return { state: 'failed', code: 'CALENDAR_UNAVAILABLE', retryable: true, message: 'The calendar is not available right now. Nothing was booked.' };
    }
    if (!free) {
      await bstore.updateIf(id, ['pending'], { status: 'failed' }, stamp());
      return { state: 'failed', code: 'SLOT_TAKEN', retryable: false, message: 'That time has just been taken. Nothing was booked.', alternatives: await alternatives(type, startMs) };
    }
    // 2. ask the provider
    let made;
    try {
      made = await provider.createBooking({ type, eventTypeId: eventTypeId(type), startMs, name: p.n, email: p.e, ref: id, durationMin: types()[type].durationMin });
    } catch (e) {
      if (!(e instanceof ProviderError)) { await bstore.updateIf(id, ['pending'], { status: 'unknown' }, stamp()); throw e; }
      if (e.kind === 'conflict') {
        await bstore.updateIf(id, ['pending'], { status: 'failed' }, stamp());
        return { state: 'failed', code: 'SLOT_TAKEN', retryable: false, message: 'That time has just been taken. Nothing was booked.', alternatives: await alternatives(type, startMs) };
      }
      if (e.kind === 'unavailable' || e.kind === 'validation' || e.kind === 'auth') {
        await bstore.updateIf(id, ['pending'], { status: e.kind === 'unavailable' ? 'failed_retryable' : 'failed' }, stamp());
        log({ event: 'concierge_provider_refused', kind: e.kind });
        return { state: 'failed', code: e.kind === 'unavailable' ? 'CALENDAR_UNAVAILABLE' : 'BOOKING_REFUSED', retryable: e.kind === 'unavailable', message: 'We could not book that time. Nothing was booked.' };
      }
      // timeout / unknown: the booking may or may not exist. UNKNOWN, reconciled by lookup.
      await bstore.updateIf(id, ['pending'], { status: 'unknown' }, stamp());
      return { state: 'unknown', code: 'OUTCOME_UNKNOWN', message: 'We are checking whether this booking went through. Please do not book again.', ref: id };
    }
    return finish(id, made, type, startMs);
  }

  async function finish(id, made, type, startMs) {
    const ownerToken = randomToken();
    const status = made.status === 'accepted' ? 'confirmed' : 'requested';
    const ok = await bstore.updateIf(id, ['pending', 'unknown'], { status, providerRef: made.providerRef, ownerHash: await sha256Hex(ownerToken) }, new Date(now()).toISOString());
    if (!ok) log({ event: 'concierge_store_after_provider', note: 'row not updated' }); // provider still confirmed, so we still report it
    const row = (await bstore.get(id)) || { id, type, slotStartMs: startMs };
    return { state: status, ownerToken, ...publicResult(row), message: status === 'confirmed' ? 'Your booking is confirmed.' : 'Your request was received. The booking is not confirmed until the host accepts it.' };
  }

  // A second confirm for a proposal or key we have already seen: return the true state, never a second booking.
  async function replay(row, p) {
    if (!row) throw bad('That booking could not be found.', 'NOT_FOUND', {}, 404);
    if (row.status === 'confirmed') return { state: 'confirmed', duplicate: true, ...publicResult(row), message: 'This booking was already confirmed.' };
    if (row.status === 'requested') return { state: 'requested', duplicate: true, ...publicResult(row), message: 'This request was already received.' };
    if (row.status === 'pending') return { state: 'in_progress', ref: row.id, message: 'This booking is being processed.' };
    if (row.status === 'unknown') return status({ proposalToken: await signBlob({ ...p, k: 'prop' }, secret) });
    if (row.status === 'failed_retryable') {
      const re = await bstore.updateIf(row.id, ['failed_retryable'], { status: 'pending', attempts: row.attempts + 1 }, new Date(now()).toISOString());
      if (re) return attempt(p, row.type, row.slotStartMs);
      return { state: 'in_progress', ref: row.id, message: 'This booking is being processed.' };
    }
    return { state: 'failed', code: 'ALREADY_FAILED', retryable: false, ref: row.id, message: 'That booking did not go through. Nothing was booked. Please choose a time again.' };
  }

  /** Reconcile an UNKNOWN outcome by asking the provider. The proposal token supplies the email; we never stored it. */
  async function status({ proposalToken }) {
    const p = await verifyBlob(proposalToken, secret, now(), 'prop');
    if (!p) throw bad('This booking request has expired. Please choose a time again.', 'PROPOSAL_EXPIRED', {}, 410);
    const row = await bstore.get(p.id);
    if (!row) return { state: 'none', message: 'No booking was started for this request.' };
    if (row.status === 'confirmed' || row.status === 'requested') return { state: row.status, ...publicResult(row), message: row.status === 'confirmed' ? 'Your booking is confirmed.' : 'Your request was received.' };
    if (row.status !== 'unknown') return { state: row.status === 'pending' ? 'in_progress' : 'failed', ref: row.id, message: row.status === 'pending' ? 'This booking is being processed.' : 'That booking did not go through. Nothing was booked.' };
    let found = null;
    try {
      found = await provider.findBooking({ type: row.type, eventTypeId: eventTypeId(row.type), startMs: row.slotStartMs, email: p.e, ref: row.id });
    } catch {
      return { state: 'unknown', ref: row.id, message: 'We are still checking this booking. Please do not book again.' };
    }
    if (found) return finish(row.id, found, row.type, row.slotStartMs);
    const age = now() - Date.parse(row.updatedAt);
    if (age < settings.reconcileGraceMs) return { state: 'unknown', ref: row.id, message: 'We are still checking this booking. Please do not book again.' };
    await bstore.updateIf(row.id, ['unknown'], { status: 'failed' }, new Date(now()).toISOString());
    return { state: 'failed', code: 'NOT_CREATED', retryable: false, ref: row.id, message: 'The booking was not created. Nothing was booked. Please choose a time again.' };
  }

  /** Manage a booking (status or cancel). Only the holder of the ownership token issued at confirmation may do either. */
  async function manage({ ref, ownerToken, action }) {
    if (typeof ref !== 'string' || typeof ownerToken !== 'string' || ownerToken.length > 200) throw bad('ref and ownerToken are required.');
    const row = await bstore.get(ref);
    const given = enc.encode(await sha256Hex(ownerToken));
    const want = enc.encode(row?.ownerHash || '0'.repeat(64));
    if (!row || !row.ownerHash || !safeEqual(given, want)) throw bad('That booking link is not valid.', 'FORBIDDEN', {}, 403); // same answer for unknown ref and wrong token
    if (action === 'status') return { state: row.status, ...publicResult(row) };
    if (action !== 'cancel') throw bad('action must be status or cancel.');
    if (row.status === 'cancelled') return { state: 'cancelled', ...publicResult(row) };
    if (!['confirmed', 'requested'].includes(row.status)) throw bad('That booking cannot be cancelled.', 'CONFLICT', {}, 409);
    try { await provider.cancelBooking({ providerRef: row.providerRef }); } catch (e) {
      if (e instanceof ProviderError) throw bad('The calendar could not cancel this booking. Please use the cancel link in your confirmation email.', 'CALENDAR_UNAVAILABLE', {}, 503);
      throw e;
    }
    await bstore.updateIf(row.id, ['confirmed', 'requested'], { status: 'cancelled' }, new Date(now()).toISOString());
    return { state: 'cancelled', ...publicResult({ ...row, status: 'cancelled' }) };
  }

  return { types, listSlots, propose, confirm, status, manage };
}
