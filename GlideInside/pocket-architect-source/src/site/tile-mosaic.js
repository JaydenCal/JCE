// Browser side of the NSW aerial tile fallback: ask the server for a mosaic plan, load the cached tiles (same origin, so the canvas stays clean),
// draw them, crop to the requested box and re-sample north up with the web mercator to MGA warp. Returns the same { blob, meta } as fetchAerial.

import { CONFIG } from '../config.js';
import { makeWorkingCanvas, maxAerialSide } from './device-limits.js';

export const TILE_CONCURRENCY = 8;
export const MAX_MISSING_FRACTION = 0.1; // tiles that failed twice; more than this and the mosaic is refused
const base = () => String(CONFIG.apiBase || '/api').replace(/\/+$/, '');

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

/** Run `fn` over items with at most `limit` in flight. Results keep their order. Stops starting new work once the signal aborts. */
export async function mapLimit(items, limit, fn, signal) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      if (signal?.aborted) throw abortError();
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Draw decoded tiles onto a canvas of the crop size and encode it as JPEG. `tiles` is [{ x, y, img }] (img null = missing). Replaceable in tests.
 * The canvas is kept inside what the device can draw (a phone: 2048 px a side; a canvas that comes out blank is made again smaller) and the
 * tiles are drawn scaled to match, so the picture is the same ground at a lower resolution.
 */
export async function composeMosaic(plan, tiles, { side = maxAerialSide(), make } = {}) {
  const { crop, x0, y0, tileSize } = plan;
  const { canvas, ctx, scale } = makeWorkingCanvas(crop.widthPx, crop.heightPx, { side, ...(make ? { make } : {}) });
  ctx.fillStyle = '#6b7a5a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(scale, scale);
  for (const t of tiles) {
    if (!t.img) continue;
    ctx.drawImage(t.img, (t.x - x0) * tileSize - crop.sx, (t.y - y0) * tileSize - crop.sy);
    t.img.close?.();
  }
  ctx.restore();
  return canvas.convertToBlob ? canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 }) : new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.95));
}

async function loadTile(plan, t, { signal, fetchImpl, decode }) {
  const url = `${base()}/site/${plan.tilePath || 'tile'}?${new URLSearchParams({ state: plan.state || 'NSW', z: plan.z, x: t.x, y: t.y })}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw abortError();
    try {
      const res = await fetchImpl(url, { signal });
      if (!res.ok) continue;
      return { x: t.x, y: t.y, img: await decode(await res.blob()) };
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
    }
  }
  return { x: t.x, y: t.y, img: null };
}

/** fetchAerialTiles(params, { signal, fetchImpl }) -> { blob, meta }. params are the /api/site/aerial params (state, srid, origin, bbox, res, maxpx). */
export async function fetchAerialTiles(params, { signal, fetchImpl = globalThis.fetch, concurrency = TILE_CONCURRENCY, compose = composeMosaic, decode = (b) => createImageBitmap(b), warp = null } = {}) {
  const { SiteError } = await import('./client.js');
  const side = maxAerialSide();
  const maxpx = Math.min(Number(params.maxpx) || 4096, side); // a phone asks for no more than it can draw
  const q = { state: params.state, srid: params.srid, bbox: params.bbox, ...(params.res ? { res: params.res } : {}), ...(params.maxpx || maxpx < 4096 ? { maxpx: String(maxpx) } : {}) };
  if (Number(params.maxpx) >= 2048 && side >= 4096) q.maxtiles = '100'; // the wide outer picture may use more tiles
  let res;
  try {
    res = await fetchImpl(`${base()}/site/aerial-tiles?${new URLSearchParams(q)}`, { signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new SiteError('the imagery tile service could not be reached', 'NETWORK');
  }
  if (!res.ok) {
    let body = null;
    try { body = await res.json(); } catch { /* ignore */ }
    throw new SiteError(body?.message || `the imagery tile service answered ${res.status}`, body?.code, res.status);
  }
  const plan = await res.json();
  if (!plan?.tiles?.length || !plan.crop || !plan.meta) throw new SiteError('the imagery tile plan was incomplete', 'NO_GEOREF');
  const tiles = await mapLimit(plan.tiles, concurrency, (t) => loadTile(plan, t, { signal, fetchImpl, decode }), signal);
  const missing = tiles.filter((t) => !t.img).length;
  if (missing > Math.floor(tiles.length * MAX_MISSING_FRACTION)) {
    tiles.forEach((t) => t.img?.close?.());
    throw new SiteError('the imagery tiles did not load', 'SITE_UPSTREAM');
  }
  const mosaic = await compose(plan, tiles);
  const doWarp = warp || (await import('./warp.js')).warpToMga;
  return doWarp(mosaic, plan.meta);
}
