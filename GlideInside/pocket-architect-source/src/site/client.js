// Browser side of the site lookup ("Find my block"): address search and the lot, aerial and contour requests.
// With CONFIG.siteMock true the recorded-shape samples in ./fixtures are served instead of calling /api/site/*.

import { CONFIG } from '../config.js';
import { maxAerialSide } from './device-limits.js';

export class SiteError extends Error {
  constructor(message, code = 'SITE_ERROR', status = null) {
    super(message);
    this.name = 'SiteError';
    this.code = code;
    if (status != null) this.status = status; // the HTTP status, when the failure was an HTTP answer
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
  if (!res.ok) throw new SiteError(friendly(body, res.status), body?.code || `HTTP_${res.status}`, res.status);
  return body;
}

export const GOV_DOWN_TEXT = 'The government map service is not responding. Try again soon, or keep drawing without a lot.';

function friendly(body, status) {
  if (body?.code === 'UNSUPPORTED_AREA') return 'That address is outside NSW and Queensland. Site lookup only covers those two states. You can still draw without a lot.';
  if (body?.code === 'NOT_FOUND') return 'No lot was found at that address. Try a nearby address, or keep drawing without a lot.';
  if (body?.code === 'RATE_LIMITED' || status === 429) return 'Too many lookups just now. Wait a minute and try again.';
  if (status >= 500) return GOV_DOWN_TEXT;
  return body?.message || 'The lookup failed. You can keep drawing without a lot.';
}

export const RETRY_DELAY_MS = 1500;
export const SLOW_TEXT = 'The address service is slow, try again.';
export const LOT_TIMEOUT_MS = 25000; // one lot request that never answers is given up on, then retried once, then the final message shows
export const SEARCH_TIMEOUT_MS = 16000; // the server allows its prefix query up to 6.5 s plus one retry
export const RATE_RETRY_MS = 2500; // a 429 waits a little longer before its one quiet retry
export const BUSY_MESSAGE = 'Busy, trying again';

// A failure worth one more try: the network, a timeout or a 5xx. Never a 4xx, a rate limit or the user's own abort.
export const isRetryable = (e) => e?.name !== 'AbortError' && (e?.code === 'NETWORK' || e?.code === 'TIMEOUT' || e?.code === 'SLOW' || /^HTTP_5\d\d$/.test(e?.code || '') || e?.code === 'SITE_UPSTREAM');

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
async function getJsonTimed(path, params, { signal, fetchImpl, timeoutMs = SEARCH_TIMEOUT_MS, timeoutText = 'The address lookup took too long. Try again.' } = {}) {
  const ctl = new AbortController();
  let timedOut = false;
  const onAbort = () => ctl.abort();
  if (signal?.aborted) ctl.abort();
  else signal?.addEventListener?.('abort', onAbort, { once: true });
  const timer = timeoutMs ? setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs) : null;
  try {
    return await getJson(path, params, { signal: ctl.signal, fetchImpl });
  } catch (e) {
    if (timedOut && e?.name === 'AbortError') throw new SiteError(timeoutText, 'TIMEOUT');
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
  const once = async () => {
    const body = await getJsonTimed('search', { q: text }, { signal, fetchImpl, timeoutMs });
    // The upstream timed out: this is "slow, try again", never "no match".
    if (body?.unavailable) throw new SiteError(SLOW_TEXT, 'SLOW');
    const rows = body?.results || [];
    if (body?.hint) rows.hint = body.hint;
    return rows;
  };
  // One quiet retry. A real timeout, 5xx or 429 shows "Busy, trying again" (onRetry); an empty answer for partial text retries without it.
  const isRate = (e) => e?.code === 'RATE_LIMITED' || e?.code === 'HTTP_429';
  const quietEmpty = () => { const r = []; r.rateLimited = true; return r; };
  let first;
  let showBusy = true;
  let delay = retryDelayMs;
  try {
    first = await once();
    if (first.length) return first;
    showBusy = false; // an empty answer is not a failure: retry without a "busy" notice
  } catch (e) {
    if (isRate(e)) delay = Math.max(retryDelayMs, RATE_RETRY_MS);
    else if (!isRetryable(e)) throw e;
  }
  if (showBusy) onRetry?.();
  await wait(delay, signal, sleepImpl);
  try {
    return await once();
  } catch (e) {
    if (isRate(e)) return quietEmpty(); // still limited: show nothing rather than an error (rows.rateLimited is set)
    throw e;
  }
}

/** The lot lookup with one retry after about 1.5 s on a 5xx, timeout or network failure (onRetry shows "Busy, trying again"). */
export async function getLot(params, { signal, fetchImpl, onRetry, retryDelayMs = RETRY_DELAY_MS, sleepImpl, timeoutMs = LOT_TIMEOUT_MS } = {}) {
  const once = () => getJsonTimed('lot', params, { signal, fetchImpl, timeoutMs, timeoutText: GOV_DOWN_TEXT });
  try {
    return await once();
  } catch (e) {
    if (!isRetryable(e)) throw e;
  }
  onRetry?.();
  await wait(retryDelayMs, signal, sleepImpl);
  return once();
}

// Metres of margin around the lot for the aerial and the elevation grid.
export const margin = () => Number(CONFIG.siteAerialMarginM) || 30;

// The wide outer aerial: at least 300 m beyond the lot on every side, more for big lots (0.75 of the lot's longest side, to 700 m), the
// box rounded out to 50 m so neighbouring lots share a cached image. One 2048 px picture, so the ground past the sharp inner tile is real
// imagery in the default 3/4 view and the Top view, at a lower resolution.
export const WIDE_MIN_M = 300;
export const WIDE_MAX_M = 700;
export const WIDE_PX = 2048;
export const WIDE_PX_NSW = 3072; // NSW imagery can be asked for more pixels: the ground beside the lot stays sharp (about 0.2 m per pixel)
export const INNER_RES = '0.05'; // finest the service allows; it lowers the pixel count itself to fit its size limit
// The imagery service refuses a box longer than 2000 m a side (server MAX_SPAN_M, a 400 BAD_REQUEST). A big lot (over about 600 m long) used to
// ask for lot + 2 x 700 m, got that refusal, and the optional wide tile was silently dropped: the ground then ended at the sharp tile's edge.
// So each side's margin shrinks until the whole box fits under WIDE_MAX_SPAN_M (1900 m, 100 m spare for the 50 m rounding out).
export const WIDE_MAX_SPAN_M = 1900;
export const WIDE_MIN_MARGIN_M = 45; // never narrower than the sharp inner tile's own margin
export function wideBbox(b, minM = WIDE_MIN_M) {
  const spanE = b.maxE - b.minE;
  const spanN = b.maxN - b.minN;
  const m = Math.min(WIDE_MAX_M, Math.max(minM, Math.max(spanE, spanN) * 0.75));
  const side = (span) => Math.max(WIDE_MIN_MARGIN_M, Math.min(m, (WIDE_MAX_SPAN_M - span) / 2));
  const mE = side(spanE);
  const mN = side(spanN);
  const lo = (v) => Math.floor(v / 50) * 50;
  const hi = (v) => Math.ceil(v / 50) * 50;
  return { minE: lo(b.minE - mE), minN: lo(b.minN - mN), maxE: hi(b.maxE + mE), maxN: hi(b.maxN + mN) };
}
export function wideAerialParams(b, px = WIDE_PX) {
  const w = wideBbox(b);
  const res = Math.min(2, Math.max(0.1, Math.max(w.maxE - w.minE, w.maxN - w.minN) / px));
  return { bbox: `${w.minE},${w.minN},${w.maxE},${w.maxN}`, res: res.toFixed(3), maxpx: String(px) };
}

// A lot this long (metres, longest side of its box) is a rural block or a large holding. Its aerial is asked at no finer than about 2048 px
// along the long side (the service otherwise works through several failing sizes, 40 s each, before it answers), and the optional wide tile
// is skipped past WIDE_SKIP_SPAN_M. Every aerial request is also given up on after a time limit: the aerial is optional, the lot is not.
export const BIG_LOT_SPAN_M = 600;
export const WIDE_SKIP_SPAN_M = 900;
export const BIG_AERIAL_PX = 2048;
export const AERIAL_TIMEOUT_MS = 25000;
export const BIG_AERIAL_TIMEOUT_MS = 20000;
export const WIDE_AERIAL_TIMEOUT_MS = 15000;

/** The inner aerial request for a lot box: the finest resolution, or for a big lot one that keeps the picture to about 2048 px. */
export function innerAerialRes(b, m = margin()) {
  // Keyed on the requested box: past about 614 m a 4096 px export is coarser than the 0.15 m the service answers reliably.
  const span = Math.max(b.maxE - b.minE, b.maxN - b.minN) + 2 * m;
  if (span / MAX_EXPORT_PX <= 0.15) return INNER_RES;
  return Math.min(2, Math.max(Number(INNER_RES), span / BIG_AERIAL_PX)).toFixed(3);
}
export const MAX_EXPORT_PX = 4096;
// Time kept back for the steps after the aerial (setbacks, placing the home) when a deadline is given.
export const AFTER_AERIAL_RESERVE_MS = 12000;
export const MIN_AERIAL_MS = 3000;

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

export const OVERLAYS_TIMEOUT_MS = 20000;

/**
 * Site constraint overlays (flood, bushfire, heritage, easements) for a lot response or a stored site.lot. Never rejects: any failure
 * gives null and the lot simply has no overlays. `request` is { state, srid, origin, bbox } (see overlayRequestFor in ./overlays.js).
 */
export async function fetchOverlays(request, { fetchImpl, timeoutMs = OVERLAYS_TIMEOUT_MS } = {}) {
  if (!request) return null;
  if (CONFIG.siteMock) {
    const { mockOverlays } = await import('./fixtures/overlays.js');
    return mockOverlays(request);
  }
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), timeoutMs);
  try {
    return await getJson('overlays', request, { signal: ctl?.signal, fetchImpl });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * fetchSite(selection, { fetchImpl, signal, onStep, deferContours }) -> { lot, aerial: { blob, meta } | null, contours | null, warnings: [] }
 * selection: { label, state, lon, lat }. The lot is required. A failed aerial or elevation request only adds a warning.
 */
export async function fetchSite(selection, { fetchImpl, signal, onStep, deferContours = false, retryDelayMs, sleepImpl, aerialTimeoutMs = 0, deadlineAt = 0 } = {}) {
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
  const spanM = Math.max(b.maxE - b.minE, b.maxN - b.minN);
  const big = spanM > BIG_LOT_SPAN_M;
  // With a deadline the aerial only gets the time left (less a reserve for the steps after it): a slow photo never costs the lot.
  const left = () => (deadlineAt ? deadlineAt - Date.now() - AFTER_AERIAL_RESERVE_MS : Infinity);
  let aerial = null;
  let aerialSkipped = false;
  if (left() < MIN_AERIAL_MS) {
    aerialSkipped = true;
    warnings.push('No aerial image: the lookup was running out of time.');
  } else {
    try {
      aerial = await fetchAerial({ ...common, bbox, res: innerAerialRes(b, m) }, { ...opts, timeoutMs: Math.min(aerialTimeoutMs || (big ? BIG_AERIAL_TIMEOUT_MS : AERIAL_TIMEOUT_MS), left()) });
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      warnings.push(`No aerial image: ${e.message}`);
    }
  }
  // The wide outer tile is optional: if it fails the view still works with the inner tile and the fade ring as before.
  let aerialWide = null;
  if (aerial && spanM <= WIDE_SKIP_SPAN_M && left() >= MIN_AERIAL_MS) {
    try {
      aerialWide = await fetchAerial({ ...common, ...wideAerialParams(b, lot.state === 'NSW' ? WIDE_PX_NSW : WIDE_PX) }, { ...opts, timeoutMs: Math.min(aerialTimeoutMs || WIDE_AERIAL_TIMEOUT_MS, left()) });
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
    }
  }
  // Ground levels come last and slowest. With deferContours the caller gets the lot, the aerial and a promise for the ground levels now.
  step('contours');
  const pending = fetchContours(lot, { fetchImpl });
  if (deferContours) return { lot, aerial, aerialWide, contours: null, contoursPromise: pending, warnings, aerialSkipped };
  const contours = await pending;
  if (!contours) warnings.push('No contours were available for this lot.');
  return { lot, aerial, aerialWide, contours, warnings, aerialSkipped };
}

// NSW only: when the dynamic export fails or takes longer than EXPORT_SLOW_MS the aerial is built from NSW's cached tiles instead (same imagery).
// After a slow or failed export the export is skipped for EXPORT_DOWN_MS so the inner and wide pictures do not each wait the full time.
export const EXPORT_SLOW_MS = 12000;
export const EXPORT_DOWN_MS = 120000;
let exportDownUntil = 0;
/** On a phone the picture is asked for at no more than 2048 px a side (the service lowers its own pixel count to fit); elsewhere the request is unchanged. */
export function phoneAerialParams(params, side = maxAerialSide()) {
  if (!params || side >= 4096) return params;
  const asked = Number(params.maxpx) || 4096;
  return asked > side ? { ...params, maxpx: String(side) } : params;
}
export const resetExportBreaker = () => { exportDownUntil = 0; };

export async function fetchAerial(params, opts = {}) {
  params = phoneAerialParams(params);
  if (params?.state !== 'NSW' || opts.noTiles || CONFIG.siteTiles === false) return fetchAerialExport(params, opts);
  const { signal, fetchImpl = globalThis.fetch, exportSlowMs = Number(globalThis.GI_CONFIG?.siteExportSlowMs) || EXPORT_SLOW_MS } = opts; // the host page may shorten it (tests)
  // The caller's budget (timeoutMs, set by fetchSite from the lookup deadline) covers the export AND the tile fallback: the export gets under half of it
  // so the tiles always have time, and the tiles are abandoned when the whole budget is spent.
  const budget = Number(opts.timeoutMs) || 0;
  const t0 = Date.now();
  const exportMs = budget ? Math.min(exportSlowMs, Math.max(2000, Math.round(budget * 0.45))) : exportSlowMs;
  const tiles = async () => {
    const tc = typeof AbortController === 'function' ? new AbortController() : null;
    const onA = () => tc?.abort();
    if (signal?.aborted) tc?.abort(); else signal?.addEventListener?.('abort', onA, { once: true });
    let over = false;
    const tt = budget && tc ? setTimeout(() => { over = true; tc.abort(); }, Math.max(1500, budget - (Date.now() - t0))) : null;
    try {
      return await (await import('./tile-mosaic.js')).fetchAerialTiles(params, { signal: tc?.signal || signal, fetchImpl, ...(opts.tileOpts || {}) });
    } catch (e) {
      if (over && e?.name === 'AbortError') throw new SiteError('the imagery service took too long', 'TIMEOUT');
      throw e;
    } finally { clearTimeout(tt); signal?.removeEventListener?.('abort', onA); }
  };
  if (Date.now() < exportDownUntil) {
    try { return await tiles(); } catch (e) { if (e?.name === 'AbortError') throw e; /* tiles failed too: try the export once more, in what is left of the budget */ }
    const left = budget ? budget - (Date.now() - t0) : 0;
    if (budget && left < 2000) throw new SiteError('the imagery service took too long', 'TIMEOUT');
    return fetchAerialExport(params, { ...opts, timeoutMs: budget ? left : opts.timeoutMs });
  }
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  let slow = false;
  const onAbort = () => ctl?.abort();
  if (signal?.aborted) ctl?.abort();
  else signal?.addEventListener?.('abort', onAbort, { once: true });
  const timer = ctl ? setTimeout(() => { slow = true; ctl.abort(); }, exportMs) : null;
  try {
    return await fetchAerialExport(params, { ...opts, timeoutMs: 0, signal: ctl?.signal || signal });
  } catch (first) {
    if (signal?.aborted) throw first; // the caller's own abort
    if (!slow && ['BAD_REQUEST', 'UNSUPPORTED_AREA', 'RATE_LIMITED', 'NOT_FOUND'].includes(first?.code)) throw first; // a refusal the tiles would not fix
    exportDownUntil = Date.now() + EXPORT_DOWN_MS;
    try {
      return await tiles();
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      throw slow ? new SiteError('the imagery service is too slow right now', 'TIMEOUT') : first;
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

export async function fetchAerialExport(params, { signal, fetchImpl = globalThis.fetch, timeoutMs = 0 } = {}) {
  params = phoneAerialParams(params);
  let res;
  // A request that never answers is given up on after timeoutMs (a TIMEOUT error, not an abort), still honouring the caller's own signal.
  const ctl = new AbortController();
  let timedOut = false;
  const onAbort = () => ctl.abort();
  if (signal?.aborted) ctl.abort(); else signal?.addEventListener?.('abort', onAbort, { once: true });
  const timer = timeoutMs ? setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs) : null;
  const clean = () => { clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); };
  const tooLong = () => new SiteError('the imagery service took too long', 'TIMEOUT');
  try {
    res = await fetchImpl(`${base()}/site/aerial?${new URLSearchParams(params)}`, { signal: ctl.signal });
  } catch (e) {
    clean();
    if (e?.name === 'AbortError') { if (timedOut) throw tooLong(); throw e; }
    throw new SiteError('the imagery service could not be reached', 'NETWORK');
  }
  try {
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
  let blob;
  try {
    blob = await res.blob(); // the body can stall after the headers: the same time limit covers it
  } catch (e) {
    if (e?.name === 'AbortError' && timedOut) throw tooLong();
    throw e;
  }
  clean(); // the picture is here: the rest is local work
  if (meta.georef && meta.georef !== 'mga') {
    const { warpToMga } = await import('./warp.js');
    ({ blob, meta } = await warpToMga(blob, meta));
  }
  return { blob, meta };
  } finally {
    clean();
  }
}
