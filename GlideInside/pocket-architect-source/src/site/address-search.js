// Forgiving address search, on top of searchAddresses (src/site/client.js). Pure helpers plus one wrapper.
//
//   "Unit 3/12 Marius St Tamworth", "3/12 marius st", "Lot 5 12 Marius Rd" -> the street address with the number that names the lot
//   St Rd Ave Dr Ct Pl Cres Hwy Ln Pde Tce Blvd Cl Cct and similar are spelled out
//   Results with the exact house number come first, then the same street, then the rest in the order they came
// The server already expands street type abbreviations and offers the nearest numbers; this layer makes the client tolerant of unit and
// lot prefixes, ranks the exact number first and lets Enter take the top match.

import { searchAddresses } from './client.js';

const ABBREV = {
  st: 'street', rd: 'road', ave: 'avenue', av: 'avenue', dr: 'drive', drv: 'drive', ct: 'court', crt: 'court', pl: 'place', cres: 'crescent', cr: 'crescent', hwy: 'highway',
  ln: 'lane', pde: 'parade', tce: 'terrace', blvd: 'boulevard', bvd: 'boulevard', cl: 'close', cct: 'circuit', ccl: 'circle', esp: 'esplanade', pwy: 'parkway', pky: 'parkway',
  sq: 'square', gr: 'grove', grv: 'grove', rdge: 'ridge', wy: 'way', hts: 'heights', mt: 'mount',
};
const STREET_TYPES = new Set(Object.values(ABBREV).concat(['street', 'road', 'avenue', 'drive', 'court', 'place', 'crescent', 'highway', 'lane', 'parade', 'terrace', 'way', 'close', 'circuit', 'boulevard']));

/** Words of an address, lower case, punctuation dropped (a slash and a hyphen inside a number are kept). */
const words = (s) => String(s || '').toLowerCase().replace(/[,.;]/g, ' ').replace(/[^a-z0-9/\- ]/g, ' ').split(/\s+/).filter(Boolean);

/**
 * Break a typed address into its parts.
 *   number   the house number that names the lot (the part after a unit slash; the first of a range "12-14" is kept in `range`)
 *   unit     unit, flat or shop number when typed, else ''
 *   lot      "Lot 5" number when typed, else ''
 *   street   the words after the number, abbreviations spelled out
 *   rest     everything after the street type (suburb, state, postcode) as typed
 *   clean    the search text to send: number + street + rest
 */
export function parseAddressQuery(q) {
  let w = words(q);
  let unit = '';
  let lot = '';
  // "lot 5 12 marius st": a lot number is not the house number
  for (let i = 0; i < w.length - 1; i++) {
    if (w[i] === 'lot' && /^\d+[a-z]?$/.test(w[i + 1])) { lot = w[i + 1]; w.splice(i, 2); break; }
  }
  // "unit 3 12 marius st", "u3 12 ...", "flat 2/...", "shop 4 ..."
  for (let i = 0; i < w.length; i++) {
    const m = /^(unit|u|flat|apt|apartment|shop|suite|ste)$/.exec(w[i]);
    if (m && w[i + 1] && /^\d+[a-z]?(\/\d+[a-z]?(-\d+[a-z]?)?)?$/.test(w[i + 1])) { unit = w[i + 1]; if (unit.includes('/')) { w.splice(i, 2, unit); unit = ''; } else w.splice(i, 2); break; }
    const m2 = /^(unit|flat|apt|shop|suite|u)(\d+[a-z]?)$/.exec(w[i]);
    if (m2) { unit = m2[2]; w.splice(i, 1); break; }
  }
  let number = '';
  let range = '';
  const first = w[0] || '';
  let m = /^(\d+[a-z]?)\/(\d+[a-z]?)(?:-(\d+[a-z]?))?$/.exec(first); // 3/12 or 3/12-14
  if (m) { unit = unit || m[1]; number = m[2]; range = m[3] || ''; w.shift(); }
  else if ((m = /^(\d+[a-z]?)(?:-(\d+[a-z]?))?$/.exec(first))) { number = m[1]; range = m[2] || ''; w.shift(); }
  else if (w.length > 1 && /^\d+[a-z]?$/.test(w[1]) && !STREET_TYPES.has(w[0]) && unit) { number = w[1]; w.splice(1, 1); }
  const out = w.map((x, i) => (ABBREV[x] && !(x === 'st' && i === 0) ? ABBREV[x] : x));
  const at = out.findIndex((x) => STREET_TYPES.has(x));
  const street = (at >= 0 ? out.slice(0, at + 1) : out).join(' ');
  const rest = at >= 0 ? out.slice(at + 1).join(' ') : '';
  return { number, range, unit, lot, street, rest, clean: [number, street, rest].filter(Boolean).join(' ').trim() };
}

/** The house numbers a label carries: "UNIT 3/12-14 MARIUS STREET, TAMWORTH NSW" gives 12 and 14. */
function labelNumbers(label) {
  const m = /^\s*(?:(?:unit|u|flat|shop|lot)\s*\S+\s*,?\s*)?(?:\d+[a-z]?\/)?(\d+[a-z]?)(?:-(\d+[a-z]?))?\b/i.exec(String(label || ''));
  if (!m) return [];
  return [m[1], m[2]].filter(Boolean).map((x) => x.toLowerCase());
}

/** Score a result against the parsed query: 3 exact number on the same street, 2 same street, 1 exact number only, 0 other. */
export function scoreResult(parsed, result) {
  const label = String(result?.label || '').toLowerCase();
  const nums = labelNumbers(label);
  const sameStreet = !!parsed.street && label.includes(parsed.street.split(' ').slice(0, Math.max(1, parsed.street.split(' ').length)).join(' '));
  const wanted = [parsed.number, parsed.range].filter(Boolean);
  const numHit = wanted.length ? wanted.some((n) => nums.includes(n)) || (parsed.number && nums.includes(parsed.number)) : false;
  if (numHit && sameStreet) return 3;
  if (sameStreet) return 2;
  if (numHit) return 1;
  return 0;
}

/** Stable sort, best match first. Results with no number in the query keep their order. */
export function rankResults(q, results) {
  const parsed = typeof q === 'string' ? parseAddressQuery(q) : q;
  if (!Array.isArray(results)) return [];
  return results.map((r, i) => ({ r, i, s: scoreResult(parsed, r) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.r);
}

/** Search with the cleaned text, fall back to what was typed, and put the exact house number first. */
export async function smartSearch(q, opts = {}) {
  const text = String(q || '').trim();
  const parsed = parseAddressQuery(text);
  const tries = [];
  if (parsed.clean && parsed.clean.toLowerCase() !== text.toLowerCase() && parsed.clean.length >= 3) tries.push(parsed.clean);
  tries.push(text);
  let found = [];
  for (const t of tries) {
    found = await (opts.search || searchAddresses)(t, opts);
    if (found.length) break;
  }
  const ranked = rankResults(parsed, found);
  if (found.rateLimited) ranked.rateLimited = true;
  return ranked;
}

/** Wording for "nothing found". */
export const NOT_FOUND_TEXT = 'We could not find that address. Check the spelling, try the street name and suburb, or use a sample lot or your own boundary.';

export const SEARCH_DEBOUNCE_MS = 300;

/**
 * Live suggestions for a search box: waits delay ms after the last keystroke, aborts the previous request on every keystroke (and when
 * cancelled), ignores aborted and out of date answers, and never reports a failure (a 429 or error just clears the suggestions).
 * trigger() on each input event; onBusy() only for a real timeout, 5xx or 429 retry; onResults(rows) with the final rows.
 */
export function createLiveSearch({ getText, onResults, onBusy, search = smartSearch, delay = SEARCH_DEBOUNCE_MS, setT = setTimeout, clearT = clearTimeout }) {
  let timer = null;
  let ctl = null;
  const cancel = () => { clearT(timer); timer = null; ctl?.abort(); ctl = null; };
  const run = async () => {
    const q = String(getText() || '').trim();
    if (q.length < 3) { onResults([]); return; }
    const mine = new AbortController();
    ctl = mine;
    try {
      const rows = await search(q, { signal: mine.signal, onRetry: () => { if (!mine.signal.aborted) onBusy?.(); } });
      if (mine.signal.aborted || String(getText() || '').trim() !== q) return;
      onResults(Array.isArray(rows) ? rows : []);
    } catch (e) {
      if (e?.name === 'AbortError' || mine.signal.aborted) return;
      onResults([]);
    }
  };
  return {
    trigger() { cancel(); timer = setT(run, delay); },
    cancel,
  };
}
