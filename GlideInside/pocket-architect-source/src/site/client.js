// Browser side of the site lookup ("Find my block"): address search and the lot, aerial and contour requests.
// With CONFIG.siteMock true the recorded-shape samples in ./fixtures are served instead of calling /api/site/*.

import { CONFIG } from '../config.js';

export class SiteError extends Error {
  constructor(message, code = 'SITE_ERROR') {
    super(message);
    this.name = 'SiteError';
    this.code = code;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = () => String(CONFIG.apiBase || '/api').replace(/\/+$/, '');

export async function getJson(path, params, { signal, fetchImpl = globalThis.fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(`${base()}/site/${path}?${new URLSearchParams(params)}`, { signal, headers: { accept: 'application/json' } });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new SiteError('The address lookup could not be reached. Check your connection. You can keep drawing without a lot.', 'NETWORK');
  }
  return readJson(res);
}

async function readJson(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) throw new SiteError(friendly(body, res.status), body?.code || `HTTP_${res.status}`);
  return body;
}

function friendly(body, status) {
  if (body?.code === 'UNSUPPORTED_AREA') return 'That address is outside NSW and Queensland. Site lookup only covers those two states. You can still draw without a lot.';
  if (body?.code === 'NOT_FOUND') return 'No lot was found at that address. Try a nearby address, or keep drawing without a lot.';
  if (body?.code === 'RATE_LIMITED' || status === 429) return 'Too many lookups just now. Wait a minute and try again.';
  if (status >= 500) return 'The government map service is not responding. Try again soon, or keep drawing without a lot.';
  return body?.message || 'The lookup failed. You can keep drawing without a lot.';
}

export const RETRY_DELAY_MS = 1500;
export const SEARCH_TIMEOUT_MS = 12000;
export const BUSY_MESSAGE = 'Busy, trying again';

// A failure worth one more try: the network, a timeout or a 5xx. Never a 4xx, a rate limit or the user's own abort.
export const isRetryable = (e) => e?.name !== 'AbortError' && (e?.code === 'NETWORK' || e?.code === 'TIMEOUT' || /^HTTP_5\d\d$/.test(e?.code || '') || e?.code === 'SITE_UPSTREAM');

// Sleep that ends early (rejecting with an AbortError) when the caller's signal aborts.
function wait(ms, signal, sleepImpl = sleep) {
  if (signal?.aborted) return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    signal?.addEventListener?.('abort', onAbort, { once: true });
    sleepImpl(ms).then(() => { signal?.removeEventListener?.('abort', onAbort); resolve(); });
  });
}

// getJson with a per attempt timeout (TIMEOUT error) that still honours the caller's own abort signal.
async function getJsonTimed(path, params, { signal, fetchImpl, timeoutMs = SEARCH_TIMEOUT_MS } = {}) {
  const ctl = new AbortController();
  let timedOut = false;
  const onAbort = () => ctl.abort();
  if (signal?.aborted) ctl.abort();
  else signal?.addEventListener?.('abort', onAbort, { once: true });
  const timer = timeoutMs ? setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs) : null;
  try {
    return await getJson(path, params, { signal: ctl.signal, fetchImpl });
  } catch (e) {
    if (timedOut && e?.name === 'AbortError') throw new SiteError('The address lookup took too long. Try again.', 'TIMEOUT');
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

/**
 * Address search. An empty answer or a timeout / network / 5xx failure is retried once after retryDelayMs (about 1.5 s) while onRetry()
 * lets the UI show "Busy, trying again" instead of "no match". A second empty answer is a genuine no match ([]).
 */
export async function searchAddresses(q, opts = {}) {
  const text = String(q || '').trim();
  if (text.length < 3) return [];
  if (CONFIG.siteMock) {
    const { mockSearch } = await import('./fixtures/index.js');
    return mockSearch(text);
  }
  const { onRetry, retryDelayMs = RETRY_DELAY_MS, sleepImpl, signal, fetchImpl, timeoutMs } = opts;
  const once = async () => ((await getJsonTimed('search', { q: text }, { signal, fetchImpl, timeoutMs }))?.results || []);
  let first;
  try {
    first = await once();
    if (first.length) return first;
  } catch (e) {
    if (!isRetryable(e)) throw e;
  }
  onRetry?.();
  await wait(retryDelayMs, signal, sleepImpl);
  return once();
}

/** The lot lookup with one retry after about 1.5 s on a 5xx, timeout or network failure (onRetry shows "Busy, trying again"). */
export async function getLot(params, { signal, fetchImpl, onRetry, retryDelayMs = RETRY_DELAY_MS, sleepImpl } = {}) {
  try {
    return await getJson('lot', params, { signal, fetchImpl });
  } catch (e) {
    if (!isRetryable(e)) throw e;
  }
  onRetry?.();
  await wait(retryDelayMs, signal, sleepImpl);
  return getJson('lot', params, { signal, fetchImpl });
}

// Metres of margin around the lot for the aerial and the elevation grid.
export const margin = () => Number(CONFIG.siteAerialMarginM) || 30;

// The wide outer aerial: at least 300 m beyond the lot on every side, more for big lots (0.75 of the lot's longest side, to 700 m), the
// box rounded out to 50 m so neighbouring lots share a cached image. One 2048 px picture, so the ground past the sharp inner tile is real
// imagery in the default 3/4 view and the Top view, at a lower resolution.
export const WIDE_MIN_M = 300;
export const WIDE_MAX_M = 700;
export const WIDE_PX = 2048;
export function wideBbox(b, minM = WIDE_MIN_M) {
  const span = Math.max(b.maxE - b.minE, b.maxN - b.minN);
  const m = Math.min(WIDE_MAX_M, Math.max(minM, span * 0.75));
  const lo = (v) => Math.floor(v / 50) * 50;
  const hi = (v) => Math.ceil(v / 50) * 50;
  return { minE: lo(b.minE - m), minN: lo(b.minN - m), maxE: hi(b.maxE + m), maxN: hi(b.maxN + m) };
}
export function wideAerialParams(b) {
  const w = wideBbox(b);
  const res = Math.min(2, Math.max(0.1, Math.max(w.maxE - w.minE, w.maxN - w.minN) / WIDE_PX));
  return { bbox: `${w.minE},${w.minN},${w.maxE},${w.maxN}`, res: res.toFixed(3), maxpx: String(WIDE_PX) };
}

export const CONTOURS_TIMEOUT_MS = 30000;
const CONTOURS_KEEP_MS = 120000;
const contoursCache = new Map(); // request -> promise, so an identical request (a second search for the same lot) never goes out twice

/**
 * The ground levels for a lot (the elevation service can take 20 s or more). Never rejects: a failure or a wait over 30 s gives null and
 * the caller carries on without ground levels. An identical request already in flight, or answered in the last two minutes, is shared.
 */
export function fetchContours(lot, { fetchImpl, timeoutMs = CONTOURS_TIMEOUT_MS } = {}) {
  const b = lot.lot.bboxMga;
  const m = margin();
  const params = { state: lot.state, srid: lot.srid, origin: `${lot.origin.e},${lot.origin.n}`, bbox: `${b.minE},${b.minN},${b.maxE},${b.maxN}`, buffer: m };
  const key = JSON.stringify(params);
  if (contoursCache.has(key)) return contoursCache.get(key);
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), timeoutMs);
  const p = getJson('contours', params, { signal: ctl?.signal, fetchImpl }).catch(() => null).then((r) => {
    clearTimeout(timer);
    if (!r) contoursCache.delete(key);
    else { const t = setTimeout(() => contoursCache.delete(key), CONTOURS_KEEP_MS); t.unref?.(); }
    return r;
  });
  contoursCache.set(key, p);
  return p;
}

/**
 * fetchSite(selection, { fetchImpl, signal, onStep, deferContours }) -> { lot, aerial: { blob, meta } | null, contours | null, warnings: [] }
 * selection: { label, state, lon, lat }. The lot is required. A failed aerial or elevation request only adds a warning.
 */
export async function fetchSite(selection, { fetchImpl, signal, onStep, deferContours = false, retryDelayMs, sleepImpl } = {}) {
  const warnings = [];
  const step = (s) => onStep?.(s);
  if (CONFIG.siteMock) {
    step('lot');
    const { fixtureByState } = await import('./fixtures/index.js');
    const fx = fixtureByState(selection.state);
    await sleep(120);
    step('aerial');
    const { mockAerialBlob, mockAerialSize } = await import('./mock-aerial.js');
    let blob = null;
    try {
      blob = await mockAerialBlob(fx.aerial, fx.lot, { sampleUrl: CONFIG.siteMockAerialUrl || null });
    } catch {
      warnings.push('The sample aerial could not be drawn in this browser.');
    }
    step('contours');
    const meta = structuredClone(fx.aerial);
    if (blob) {
      const px = mockAerialSize(meta);
      Object.assign(meta, { widthPx: px.w, heightPx: px.h, mmPerPx: ((meta.bbox.maxE - meta.bbox.minE) / px.w) * 1000 });
    }
    let aerialWide = null;
    if (blob) {
      try {
        const wb = wideBbox(meta.bbox);
        const wm = structuredClone(fx.aerial);
        wm.bbox = wb;
        const wpx = WIDE_PX;
        Object.assign(wm, { widthPx: wpx, heightPx: Math.round((wpx * (wb.maxN - wb.minN)) / (wb.maxE - wb.minE)) });
        const wblob = await mockAerialBlob(wm, fx.lot, { sampleUrl: CONFIG.siteMockAerialUrl || null });
        Object.assign(wm, { mmPerPx: ((wb.maxE - wb.minE) / mockAerialSize(wm).w) * 1000 });
        aerialWide = { blob: wblob, meta: wm };
      } catch { /* the wide ring is optional */ }
    }
    return { lot: structuredClone(fx.lot), aerial: blob ? { blob, meta } : null, aerialWide, contours: structuredClone(fx.contours), warnings };
  }

  const opts = { signal, fetchImpl };
  step('lot');
  const lot = await getLot({ lon: selection.lon, lat: selection.lat, ...(selection.state ? { state: selection.state } : {}) }, { ...opts, retryDelayMs, sleepImpl, onRetry: () => step('busy') });
  const m = margin();
  const b = lot.lot.bboxMga;
  const bbox = `${b.minE - m},${b.minN - m},${b.maxE + m},${b.maxN + m}`;
  const common = { state: lot.state, srid: lot.srid, origin: `${lot.origin.e},${lot.origin.n}` };

  step('aerial');
  let aerial = null;
  try {
    aerial = await fetchAerial({ ...common, bbox }, opts);
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    warnings.push(`No aerial image: ${e.message}`);
  }
  // The wide outer tile is optional: if it fails the view still works with the inner tile and the fade ring as before.
  let aerialWide = null;
  if (aerial) {
    try {
      aerialWide = await fetchAerial({ ...common, ...wideAerialParams(b) }, opts);
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
    }
  }
  // Ground levels come last and slowest. With deferContours the caller gets the lot, the aerial and a promise for the ground levels now.
  step('contours');
  const pending = fetchContours(lot, { fetchImpl });
  if (deferContours) return { lot, aerial, aerialWide, contours: null, contoursPromise: pending, warnings };
  const contours = await pending;
  if (!contours) warnings.push('No contours were available for this lot.');
  return { lot, aerial, aerialWide, contours, warnings };
}

export async function fetchAerial(params, { signal, fetchImpl = globalThis.fetch }) {
  let res;
  try {
    res = await fetchImpl(`${base()}/site/aerial?${new URLSearchParams(params)}`, { signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new SiteError('the imagery service could not be reached', 'NETWORK');
  }
  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    throw new SiteError(body?.message || `the imagery service answered ${res.status}`, body?.code);
  }
  let meta = null;
  try {
    meta = JSON.parse(decodeURIComponent(res.headers.get('x-site-meta') || ''));
  } catch {
    throw new SiteError('the imagery response had no georeference', 'NO_GEOREF');
  }
  let blob = await res.blob();
  if (meta.georef && meta.georef !== 'mga') {
    const { warpToMga } = await import('./warp.js');
    ({ blob, meta } = await warpToMga(blob, meta));
  }
  return { blob, meta };
}
