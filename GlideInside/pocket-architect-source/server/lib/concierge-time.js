// Australia/Sydney time helpers for the booking concierge. DST safe: every conversion goes through Intl with the IANA zone,
// days are walked by calendar date (never +24h), and a local time that does not exist or occurs twice is reported, not guessed.
// 2026 transitions: ends Sunday 05/04/2026 (03:00 AEDT -> 02:00 AEST), starts Sunday 04/10/2026 (02:00 AEST -> 03:00 AEDT).

export const TZ = 'Australia/Sydney';
const fmt = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Wall clock parts in Sydney for a UTC instant (ms). */
export function sydneyParts(utcMs) {
  const p = {};
  for (const x of fmt.formatToParts(new Date(utcMs))) if (x.type !== 'literal') p[x.type] = Number(x.value);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offsetMin = Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
  return { y: p.year, m: p.month, d: p.day, h: p.hour, mi: p.minute, offsetMin };
}
export const offsetMinutesAt = (utcMs) => sydneyParts(utcMs).offsetMin;

/**
 * Local Sydney wall time to UTC ms. Returns { ms, status } where status is 'ok', 'gap' (the time does not exist, ms is the
 * instant after the gap) or 'ambiguous' (it happens twice, ms is the EARLIER one; later is ms + the clock change).
 */
export function localToUtc({ y, m, d, h = 0, mi = 0 }) {
  const naive = Date.UTC(y, m - 1, d, h, mi);
  const cands = new Set();
  for (const off of [offsetMinutesAt(naive - 14 * 3600e3), offsetMinutesAt(naive + 14 * 3600e3)]) {
    const ms = naive - off * 60000;
    const back = sydneyParts(ms);
    if (back.y === y && back.m === m && back.d === d && back.h === h && back.mi === mi) cands.add(ms);
  }
  const list = [...cands].sort((a, b) => a - b);
  if (list.length === 1) return { ms: list[0], status: 'ok' };
  if (list.length === 2) return { ms: list[0], status: 'ambiguous', laterMs: list[1] };
  // gap: shift forward by the size of the jump
  const before = offsetMinutesAt(naive - 14 * 3600e3);
  return { ms: naive - before * 60000, status: 'gap' };
}

export const dateKey = ({ y, m, d }) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export const parseDateKey = (k) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(k || ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? { y, m: mo, d } : null;
};
export const addDays = (key, n) => {
  const { y, m, d } = parseDateKey(key);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return dateKey({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() });
};
/** 0 = Sunday. Weekday of a calendar date. */
export const weekday = (key) => { const { y, m, d } = parseDateKey(key); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
export const sydneyDateKey = (utcMs) => dateKey(sydneyParts(utcMs));

/** [startMs, endMs) of a Sydney calendar day. 23, 24 or 25 hours long. */
export function dayBoundsUtc(key) {
  const p = parseDateKey(key);
  const start = localToUtc({ ...p, h: 0, mi: 0 });
  const next = parseDateKey(addDays(key, 1));
  const end = localToUtc({ ...next, h: 0, mi: 0 });
  return [start.ms, end.ms];
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** "Tuesday 03/11/2026, 10:30 am AEDT". DD/MM/YYYY as the site requires. */
export function formatSlot(utcMs) {
  const p = sydneyParts(utcMs);
  const hh = p.h % 12 === 0 ? 12 : p.h % 12;
  const abbr = p.offsetMin === 660 ? 'AEDT' : p.offsetMin === 600 ? 'AEST' : `UTC${p.offsetMin >= 0 ? '+' : '-'}${Math.abs(p.offsetMin) / 60}`;
  return {
    day: dateKey(p),
    dayLabel: `${DAYS[weekday(dateKey(p))]} ${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}`,
    timeLabel: `${hh}:${String(p.mi).padStart(2, '0')} ${p.h < 12 ? 'am' : 'pm'} ${abbr}`,
  };
}
