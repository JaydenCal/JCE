// Scheduling provider adapters for the booking concierge. The provider is the ONLY authority on availability and bookings: we never keep a
// calendar of our own. Interface (all times are UTC ms, all methods async):
//   getSlots({ type, eventTypeId, startMs, endMs })        -> [{ startMs }]
//   createBooking({ type, eventTypeId, startMs, name, email, ref })
//        -> { providerRef, status: 'accepted' | 'pending' }  (accepted = the provider confirmed it; pending = host must still approve)
//   findBooking({ type, eventTypeId, startMs, email, ref }) -> { providerRef, status } | null   (reconciliation after a timeout)
//   cancelBooking({ providerRef, reason })                  -> { ok: true }
// Failures throw ProviderError with kind: conflict | validation | auth | unavailable | timeout | unknown.
//   conflict / validation / auth / unavailable mean the provider answered and NO booking was made.
//   timeout / unknown mean we cannot tell: the caller treats the outcome as UNKNOWN and reconciles by lookup.

import { TZ, dayBoundsUtc, addDays, weekday, localToUtc, sydneyDateKey, parseDateKey } from './concierge-time.js';

export class ProviderError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// MockProvider: deterministic in-memory calendar. The default, and the only provider tests use. No network.
// Availability: Monday to Friday 09:00 to 17:00 Sydney, slots on the half hour grid, minus bookings. Failure injection for tests.
export class MockProvider {
  constructor({ nowMs = () => Date.now(), startHour = 9, endHour = 17, stepMin = 30 } = {}) {
    this.kind = 'mock';
    this.nowMs = nowMs;
    this.startHour = startHour; this.endHour = endHour; this.stepMin = stepMin;
    this.bookings = new Map(); // providerRef -> { startMs, durationMin, type, name, email, ref, status }
    this.busy = new Set();     // extra blocked start times (ms): simulates a competing booking made elsewhere
    this.inject = [];          // queue of failures for the next createBooking calls: { kind, created }
    this.calls = { getSlots: 0, createBooking: 0, findBooking: 0, cancelBooking: 0 };
    this.seq = 0;
  }
  failNext(kind, { created = false } = {}) { this.inject.push({ kind, created }); }
  _taken(startMs, durationMin) {
    const endMs = startMs + durationMin * 60000;
    if ([...this.busy].some((b) => b >= startMs && b < endMs)) return true;
    for (const b of this.bookings.values()) {
      if (b.status === 'cancelled') continue;
      if (startMs < b.startMs + b.durationMin * 60000 && endMs > b.startMs) return true;
    }
    return false;
  }
  async getSlots({ type, startMs, endMs, durationMin = 30 }) {
    this.calls.getSlots++;
    const out = [];
    let day = sydneyDateKey(startMs);
    const last = sydneyDateKey(endMs - 1);
    for (let guard = 0; guard < 40 && day <= last; guard++, day = addDays(day, 1)) {
      const wd = weekday(day);
      if (wd === 0 || wd === 6) continue;
      const p = parseDateKey(day);
      for (let mins = this.startHour * 60; mins + durationMin <= this.endHour * 60; mins += this.stepMin) {
        const loc = localToUtc({ ...p, h: Math.floor(mins / 60), mi: mins % 60 });
        if (loc.status === 'gap') continue;
        if (loc.ms < startMs || loc.ms >= endMs) continue;
        if (loc.ms <= this.nowMs()) continue;
        if (this._taken(loc.ms, durationMin)) continue;
        out.push({ startMs: loc.ms });
      }
    }
    return out;
  }
  async createBooking({ type, startMs, name, email, ref, durationMin = 30 }) {
    this.calls.createBooking++;
    const inj = this.inject.shift();
    const make = () => {
      const providerRef = `mock_${++this.seq}_${Math.random().toString(36).slice(2, 8)}`;
      this.bookings.set(providerRef, { startMs, durationMin, type, name, email: String(email).toLowerCase(), ref, status: 'accepted' });
      return providerRef;
    };
    if (inj) {
      if (inj.created) make(); // the booking really was made but the answer never arrived
      if (inj.kind === 'timeout') throw new ProviderError('timeout', 'The calendar did not answer in time.');
      if (inj.kind === 'unknown') throw new ProviderError('unknown', 'Unclear provider answer.');
      if (inj.kind === 'unavailable') throw new ProviderError('unavailable', 'The calendar is down.');
      if (inj.kind === 'conflict') throw new ProviderError('conflict', 'That time is no longer free.');
      if (inj.kind === 'auth') throw new ProviderError('auth', 'Provider rejected the credentials.');
      if (inj.kind === 'pending') { const r = make(); this.bookings.get(r).status = 'pending'; return { providerRef: r, status: 'pending' }; }
    }
    if (this._taken(startMs, durationMin)) throw new ProviderError('conflict', 'That time is no longer free.');
    return { providerRef: make(), status: 'accepted' };
  }
  async findBooking({ startMs, email, ref }) {
    this.calls.findBooking++;
    for (const [providerRef, b] of this.bookings) {
      if (b.status === 'cancelled') continue;
      if (b.startMs === startMs && b.email === String(email).toLowerCase() && (!ref || b.ref === ref)) return { providerRef, status: b.status };
    }
    return null;
  }
  async cancelBooking({ providerRef }) {
    this.calls.cancelBooking++;
    const b = this.bookings.get(providerRef);
    if (!b) throw new ProviderError('validation', 'No such booking.');
    b.status = 'cancelled';
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// CalComProvider: Cal.com API v2 over fetch. The API key comes from the Worker environment only (secret CALCOM_API_KEY).
// Versions per endpoint follow the current docs (see DESIGN.md): slots 2024-09-04, bookings create/get/cancel 2026-02-25, list 2026-05-01.
export class CalComProvider {
  constructor({ apiKey, baseUrl = 'https://api.cal.com', fetchImpl, timeoutMs = 8000, versions = {} } = {}) {
    if (!apiKey) throw new Error('CalComProvider needs an API key (secret CALCOM_API_KEY).');
    this.kind = 'calcom';
    this.apiKey = apiKey;
    this.base = String(baseUrl).replace(/\/+$/, '');
    this.fetch = fetchImpl || ((...a) => globalThis.fetch(...a));
    this.timeoutMs = timeoutMs;
    this.v = { slots: '2024-09-04', bookings: '2026-02-25', list: '2026-05-01', ...versions };
  }
  async _call(method, path, { version, query, body } = {}) {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    let res;
    try {
      res = await this.fetch(url.toString(), {
        method,
        headers: { authorization: `Bearer ${this.apiKey}`, 'cal-api-version': version, 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(this.timeoutMs) : undefined,
      });
    } catch (e) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new ProviderError('timeout', 'The calendar did not answer in time.');
      throw new ProviderError('unknown', 'The calendar could not be reached.'); // request may or may not have been sent
    }
    const data = await res.json().catch(() => null);
    if (res.ok) return data;
    const text = JSON.stringify(data?.error || data?.message || '').toLowerCase();
    if (res.status === 401 || res.status === 403) throw new ProviderError('auth', 'The calendar rejected our credentials.');
    if (res.status === 409 || (res.status === 400 && /(not\s+available|no_available|already\s+has\s+booking|busy|unavailable|conflict|no available)/.test(text))) throw new ProviderError('conflict', 'That time is no longer free.');
    if (res.status === 429 || res.status >= 500) throw new ProviderError(res.status >= 500 ? 'unknown' : 'unavailable', 'The calendar is busy.'); // a 5xx may have created the booking
    throw new ProviderError('validation', 'The calendar refused the request.');
  }
  async getSlots({ eventTypeId, startMs, endMs, durationMin }) {
    const data = await this._call('GET', '/v2/slots', {
      version: this.v.slots,
      query: { eventTypeId, start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), timeZone: 'UTC', format: 'range', duration: durationMin },
    });
    const out = [];
    for (const list of Object.values(data?.data || {})) {
      for (const s of Array.isArray(list) ? list : []) {
        const iso = typeof s === 'string' ? s : s?.start;
        const ms = Date.parse(iso);
        if (Number.isFinite(ms)) out.push({ startMs: ms });
      }
    }
    return out.sort((a, b) => a.startMs - b.startMs);
  }
  async createBooking({ eventTypeId, startMs, name, email, ref, durationMin }) {
    const data = await this._call('POST', '/v2/bookings', {
      version: this.v.bookings,
      body: {
        start: new Date(startMs).toISOString(), eventTypeId: Number(eventTypeId), lengthInMinutes: durationMin,
        attendee: { name, email, timeZone: TZ, language: 'en' },
        metadata: { giRef: ref }, // our reference only, no personal data
      },
    });
    const b = data?.data;
    const status = b?.status;
    if (data?.status !== 'success' || !b?.uid) throw new ProviderError('unknown', 'Unclear calendar answer.');
    if (status === 'accepted') return { providerRef: b.uid, status: 'accepted' };
    if (status === 'pending' || status === 'awaiting_host') return { providerRef: b.uid, status: 'pending' };
    throw new ProviderError('unknown', 'The calendar did not confirm the booking.');
  }
  async findBooking({ eventTypeId, startMs, email }) {
    const data = await this._call('GET', '/v2/bookings', {
      version: this.v.list,
      query: { attendeeEmail: email, eventTypeId, afterStart: new Date(startMs - 60000).toISOString(), beforeEnd: new Date(startMs + 3 * 3600e3).toISOString(), limit: 20 },
    });
    for (const b of Array.isArray(data?.data) ? data.data : []) {
      if (Date.parse(b.start) === startMs && b.status !== 'cancelled' && b.status !== 'rejected') return { providerRef: b.uid, status: b.status === 'accepted' ? 'accepted' : 'pending' };
    }
    return null;
  }
  async cancelBooking({ providerRef, reason = 'Cancelled by the person who booked' }) {
    await this._call('POST', `/v2/bookings/${encodeURIComponent(providerRef)}/cancel`, { version: this.v.bookings, body: { cancellationReason: reason } });
    return { ok: true };
  }
}

/** Build the provider from the Worker environment. Mock is the default. */
export function createProvider({ env = {}, fetchImpl, nowMs } = {}) {
  const which = String(env.BOOKING_PROVIDER || 'mock').toLowerCase();
  if (which === 'calcom') return new CalComProvider({ apiKey: env.CALCOM_API_KEY, baseUrl: env.CALCOM_API_BASE || undefined, fetchImpl, timeoutMs: Number(env.CALCOM_TIMEOUT_MS) || 8000 });
  return new MockProvider({ nowMs });
}
