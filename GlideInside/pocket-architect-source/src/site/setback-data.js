// Loads the setback rules the lot needs, on demand: the index (128 council names), the council file for the lot's LGA and the
// fallback sets (Codes SEPP Housing and Inland Codes, QDC MP1.1). Files are static and sit next to the site
// (website-live/plan-studio/data/setbacks/, made by tools/split-setbacks.mjs), so nothing here needs the API.

import { CONFIG } from '../config.js';
import { findCouncil } from './setbacks.js';

export class SetbackDataError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SetbackDataError';
  }
}

const cache = new Map(); // url -> Promise of parsed JSON (cleared on failure so a retry can work)

export function clearSetbackCache() {
  cache.clear();
}

function baseUrl(override) {
  const rel = String(override || CONFIG.setbacksBase || '../data/setbacks/');
  const withSlash = rel.endsWith('/') ? rel : `${rel}/`;
  if (/^https?:/i.test(withSlash)) return withSlash;
  const doc = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
  return new URL(withSlash, doc).href;
}

function getJson(url, fetchImpl) {
  if (cache.has(url)) return cache.get(url);
  const f = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  if (!f) return Promise.reject(new SetbackDataError('Setback data cannot be loaded here.'));
  const p = f(url, { credentials: 'omit' })
    .then((r) => {
      if (!r.ok) throw new SetbackDataError(`Setback data not available (${r.status}).`);
      return r.json();
    })
    .catch((e) => {
      cache.delete(url);
      throw e instanceof SetbackDataError ? e : new SetbackDataError('Setback data could not be loaded. Check your connection and try again.');
    });
  cache.set(url, p);
  return p;
}

/**
 * loadRuleSet(lot, { fetchImpl, base }) -> { councils: [council] | [], fallbacks }
 * The shape siteLotSetbacks() expects, with only the one council the lot sits in. Queensland lots need only the fallbacks.
 */
export async function loadRuleSet(lot, { fetchImpl = null, base = null } = {}) {
  const root = baseUrl(base);
  const fallbacks = await getJson(`${root}fallbacks.json`, fetchImpl);
  if (!lot || String(lot.state || '').toUpperCase() !== 'NSW') return { councils: [], fallbacks };
  const index = await getJson(`${root}index.json`, fetchImpl);
  const hit = findCouncil(index.councils, lot.lga);
  if (!hit) return { councils: [], fallbacks, councilNotFound: lot.lga || null };
  const council = await getJson(`${root}${encodeURIComponent(hit.lga_slug)}.json`, fetchImpl);
  return { councils: [council], fallbacks };
}
