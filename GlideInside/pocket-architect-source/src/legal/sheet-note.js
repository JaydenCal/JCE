// What the plan terms print on the sheets. Pure functions, no DOM: used by every PDF exporter, the DXF exporter and the Worker.
//   termsStamp({ version, acceptedAt })  ->  'Terms of use v0.0-draft accepted 15/11/2026'   (no date when none is known)
//   termsLines(terms)                    ->  [sheetNote, stamp]
// `acceptedAt` is an ISO timestamp, a Date, or an already formatted DD/MM/YYYY. Dates print in Sydney time.

import { PLAN_TERMS } from './plan-terms.js';

export function ddmmyyyySydney(value) {
  if (typeof value === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(d);
    const g = (t) => parts.find((p) => p.type === t)?.value;
    return `${g('day')}/${g('month')}/${g('year')}`;
  } catch {
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  }
}

export function termsStamp(terms = null) {
  const v = terms?.version || PLAN_TERMS.version;
  const when = terms?.acceptedAt ? ddmmyyyySydney(terms.acceptedAt) : '';
  return `Terms of use v${v}${when ? ` accepted ${when}` : ''}`;
}

export const termsLines = (terms = null) => [PLAN_TERMS.sheetNote, termsStamp(terms)];
