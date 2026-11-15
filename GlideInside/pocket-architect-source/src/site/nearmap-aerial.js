// "My Nearmap key": the person pastes THEIR OWN Nearmap API key and this browser asks Nearmap's Tile API for the tiles over their lot.
//   * The key is kept only in this browser (localStorage, every access in try/catch) and removed by Forget key. It is never sent to Glide Inside,
//     never put in an analytics event and never put in an error message or log line.
//   * Tiles are requested straight from api.nearmap.com by the browser, held in memory for this one request and stitched into one picture for the
//     lot, which is kept in the browser's own image store like every other aerial. Nothing is cached on a server.
//   * Tile API (https://developer.nearmap.com/reference/tiles): GET https://api.nearmap.com/tiles/v3/Vert/{z}/{x}/{y}.jpg?apikey={key}, 256 pixel
//     Web Mercator tiles in Google tile coordinates. The documentation does not state the CORS policy, so a browser refusal is reported plainly.
//   * The page's Content-Security-Policy must list https://api.nearmap.com under connect-src (see SECURITY-HEADERS.md).
//   * Do not use this with an account you are not licensed to use. This code never ships a key.

import { planMosaic, stitchMosaic, AerialError } from './mapbox-aerial.js';
import { NEARMAP_ATTRIBUTION, lotFrame, outExtent } from './own-aerial.js';

export const NEARMAP_HOST = 'https://api.nearmap.com';
export const NEARMAP_TILE_PX = 256;
export const NEARMAP_MAX_ZOOM = 21;
export const STORAGE_KEY = 'gi.byo.nearmapKey';
const KEY_RE = /^[A-Za-z0-9_-]{16,200}$/;

// Key storage (this browser only) ------------------------------------------------------------------------------------------------
export const validKey = (k) => KEY_RE.test(String(k || '').trim());
export function readKey() { try { return globalThis.localStorage?.getItem(STORAGE_KEY) || ''; } catch { return ''; } }
export function saveKey(k) { try { globalThis.localStorage?.setItem(STORAGE_KEY, String(k).trim()); return true; } catch { return false; } }
export function forgetKey() { try { globalThis.localStorage?.removeItem(STORAGE_KEY); } catch { /* storage blocked */ } }

/** The tile URL. It carries the key, so it is never logged, stored or put in an error message. */
export const tileUrl = (z, x, y, key) => `${NEARMAP_HOST}/tiles/v3/Vert/${z}/${x}/${y}.jpg?apikey=${encodeURIComponent(key)}`;

async function getTile(z, x, y, key, fetchImpl, signal) {
  let res;
  try {
    res = await fetchImpl(tileUrl(z, x, y, key), { signal, credentials: 'omit' });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new AerialError('This browser could not read tiles from Nearmap. Either the key was refused, or Nearmap does not allow its tiles to be read by a web page. Use My image file instead.', 'NETWORK');
  }
  if (res.status === 401 || res.status === 403) throw new AerialError('Nearmap refused the key, or the key has no access to this area. Check it and try again.', 'KEY');
  if (res.status === 429) throw new AerialError('Nearmap asked for a pause. Try again in a minute.', 'RATE');
  if (res.status === 404 || res.status === 204) throw new AerialError('Nearmap has no imagery here at this zoom.', 'NONE');
  if (!res.ok) throw new AerialError(`Nearmap answered ${res.status} for one tile.`, 'HTTP');
  return res.blob();
}

/**
 * The picture for a lot from the person's own Nearmap key. Returns { blob, meta } with meta { kind: 'nearmap', source, attribution, extent (plan mm), mmPerPx }.
 * deps (tests): fetchImpl, createCanvas, decode, signal.
 */
export async function fetchNearmapForLot({ lot, key, fetchImpl = globalThis.fetch, createCanvas, decode, signal, maxPx = 4096 }) {
  if (!validKey(key)) throw new AerialError('That does not look like a Nearmap API key.', 'KEY');
  const ext = outExtent(lot);
  const o = lot.origin;
  const bbox = { minE: o.e + ext.x0 / 1000, maxE: o.e + ext.x1 / 1000, maxN: o.n - ext.y0 / 1000, minN: o.n - ext.y1 / 1000 };
  const frame = lotFrame(lot);
  let zoom = NEARMAP_MAX_ZOOM;
  let lastErr = null;
  for (let tries = 0; tries < 4; tries++) {
    const plan = planMosaic({ frame, bbox, maxPx, maxZoom: zoom, tilePx: NEARMAP_TILE_PX });
    try {
      const blobs = await Promise.all(plan.tiles.map((t) => getTile(plan.z, t.x, t.y, key.trim(), fetchImpl, signal)));
      const out = await stitchMosaic(plan, blobs, { tilePx: NEARMAP_TILE_PX, createCanvas, decode });
      const blob = await (out.convertToBlob ? out.convertToBlob({ type: 'image/jpeg', quality: 0.93 }) : new Promise((r) => out.toBlob(r, 'image/jpeg', 0.93)));
      return { blob, meta: { kind: 'nearmap', source: 'Nearmap (your licence)', attribution: NEARMAP_ATTRIBUTION, extent: ext, mmPerPx: Math.round(((ext.x1 - ext.x0) / plan.widthPx) * 100) / 100, zoom: plan.z, tiles: plan.tiles.length } };
    } catch (e) {
      if (e?.name === 'AbortError' || e?.code !== 'NONE') throw e;
      lastErr = e;
      zoom = plan.z - 1; // no imagery at this zoom: try a coarser one
    }
  }
  throw lastErr || new AerialError('Nearmap has no imagery here.', 'NONE');
}
