// NSW aerial from the cached tile pyramid, used when the dynamic /export of NSW_Imagery is down or slow (same imagery, same licence).
//   GET /api/site/aerial-tiles?state=NSW&srid=&bbox=[&res=][&maxpx=][&maxtiles=]   JSON mosaic plan (zoom, tile list, crop, georeference); the browser draws it
//   GET /api/site/tile?z=&x=&y=[&state=NSW]                                          one JPEG tile proxied from the fixed NSW_Imagery tile URL, cached for 30 days
// Workers cannot decode or encode images, so the browser assembles the mosaic on a canvas and runs it through the existing web mercator to MGA warp.
// /tile is not an open proxy: the upstream URL is one fixed template, z/x/y are integers range checked, and the tile must touch NSW.

import { HttpError, json } from './http.js';
import { webToLonLat } from '../../src/site/geo.js';
import { STANDARD_SCHEME, MIN_ZOOM, MAX_ZOOM, resolutionAt, schemeFromTileInfo, planMosaic, tileBounds } from '../../src/site/tile-math.js';

export const TILE_TTL = 30 * 86400;
export const TILE_CACHE_CONTROL = `public, max-age=${TILE_TTL}, immutable`;
export const TILE_TIMEOUT_MS = 8000;
const SCHEME_TTL_MS = 6 * 3600 * 1000;
const SCHEME_RETRY_MS = 5 * 60 * 1000;
// A generous box around NSW (and the ACT); a tile wholly outside it is refused.
const NSW_LON = [140.9, 154.0];
const NSW_LAT = [-37.7, -27.9];

const int = (v) => (/^\d{1,8}$/.test(String(v ?? '')) ? Number(v) : null);

/** ctx: { baseUrl, upstream, doFetch, bytesCache, now, iso, captureDate, parseBbox, srsFor, stateParam, rateLimit, source } */
export function createAerialTiles(ctx) {
  const { baseUrl, upstream, doFetch, bytesCache, now, iso, captureDate, parseBbox, srsFor, stateParam, rateLimit, meta: baseMetaFor, UA } = ctx;
  let schemeMemo = null;

  // One request in flight per isolate: a burst of tile requests on a cold isolate shares it instead of each asking NSW for the service description.
  let schemeInflight = null;
  function getScheme() {
    if (schemeMemo && schemeMemo.until > now()) return Promise.resolve(schemeMemo.scheme);
    if (!schemeInflight) schemeInflight = loadScheme().finally(() => { schemeInflight = null; });
    return schemeInflight;
  }
  async function loadScheme() {
    let scheme = STANDARD_SCHEME;
    let ttl = SCHEME_RETRY_MS;
    try {
      const body = await upstream(baseUrl, { f: 'json' }, { retries: 0, timeoutMs: 6000 });
      if (body?.tileInfo) { scheme = schemeFromTileInfo(body.tileInfo); ttl = SCHEME_TTL_MS; }
    } catch {
      /* the standard scheme; retried in five minutes */
    }
    schemeMemo = { scheme, until: now() + ttl };
    return scheme;
  }

  async function plan(request, url) {
    await rateLimit(request, 'aerialTiles');
    const state = stateParam(url, { required: true });
    if (state !== 'NSW') throw new HttpError('UNSUPPORTED_AREA', 'The tile aerial covers NSW only.');
    const { srid, zone } = srsFor(url);
    const box = parseBbox(url.searchParams.get('bbox'));
    const res = Math.min(2, Math.max(0, Number(url.searchParams.get('res')) || 0));
    const mp = Number(url.searchParams.get('maxpx'));
    const maxPx = Number.isFinite(mp) && mp > 0 ? Math.min(4096, Math.max(256, Math.round(mp))) : 4096;
    const mt = Number(url.searchParams.get('maxtiles'));
    const maxTiles = Number.isFinite(mt) && mt > 0 ? Math.min(100, Math.max(4, Math.round(mt))) : 64;
    const key = `aerialtiles:${srid}:${[box.minE, box.minN, box.maxE, box.maxN].map((v) => Math.round(v * 10) / 10).join(',')}:${res}:${maxPx}:${maxTiles}`;
    const hit = await bytesCache.get(key);
    let body;
    if (hit) {
      body = typeof hit.body === 'string' ? hit.body : new TextDecoder().decode(hit.body);
    } else {
      // The capture date runs alongside the scheme and is only waited on briefly: the tiles matter more than the date label.
      const capP = Promise.race([captureDate(box, zone).catch(() => null), new Promise((r) => setTimeout(() => r(null), 1500))]);
      const scheme = await getScheme();
      const p = planMosaic(box, zone, { scheme, res, maxTiles, maxPx });
      if (!p) throw new HttpError('SITE_UPSTREAM', 'The imagery tile cache has no usable zoom level.');
      const capture = await capP;
      const meta = { ...baseMetaFor(capture), tiled: true, georef: 'web-mercator', srid, zone, bbox: box, webBbox: p.webBbox, widthPx: p.crop.widthPx, heightPx: p.crop.heightPx, outWidthPx: p.outWidthPx, outHeightPx: p.outHeightPx, mmPerPx: p.mmPerPx };
      body = JSON.stringify({ state, z: p.z, tileSize: p.tileSize, x0: p.x0, y0: p.y0, cols: p.cols, rows: p.rows, tiles: p.tiles, crop: p.crop, tilePath: 'tile', meta });
      await bytesCache.put(key, { body: new TextEncoder().encode(body).buffer, headers: { 'content-type': 'application/json' } }, 86400);
    }
    return json(JSON.parse(body), 200, { 'cache-control': 'public, max-age=86400' });
  }

  async function tile(request, url) {
    const st = (url.searchParams.get('state') || 'NSW').toUpperCase();
    if (st !== 'NSW') throw new HttpError('UNSUPPORTED_AREA', 'The tile aerial covers NSW only.');
    const z = int(url.searchParams.get('z'));
    const x = int(url.searchParams.get('x'));
    const y = int(url.searchParams.get('y'));
    if (z == null || x == null || y == null) throw new HttpError('BAD_REQUEST', 'z, x and y must be whole numbers.');
    if (z < MIN_ZOOM || z > MAX_ZOOM) throw new HttpError('BAD_REQUEST', `z must be ${MIN_ZOOM} to ${MAX_ZOOM}.`);
    const scheme = await getScheme();
    if (!resolutionAt(scheme, z)) throw new HttpError('BAD_REQUEST', 'That zoom level is not in the tile cache.');
    const n = 2 ** z;
    if (x >= n || y >= n) throw new HttpError('BAD_REQUEST', 'x or y is outside the tile grid.');
    const b = tileBounds(z, x, y, scheme);
    const lo = webToLonLat(b.minX, b.minY);
    const hi = webToLonLat(b.maxX, b.maxY);
    if (hi.lon < NSW_LON[0] || lo.lon > NSW_LON[1] || hi.lat < NSW_LAT[0] || lo.lat > NSW_LAT[1]) throw new HttpError('UNSUPPORTED_AREA', 'That tile is outside NSW.');
    const key = `tile:${z}:${x}:${y}`;
    let hitTile = await bytesCache.get(key);
    if (!hitTile) {
      // Fixed template, integers only: nothing the caller sends reaches the upstream URL except these three numbers.
      const got = await upstream(`${baseUrl}/tile/${z}/${y}/${x}`, null, { as: 'bytes', timeoutMs: TILE_TIMEOUT_MS, retries: 1 });
      if (!/^image\//i.test(got.type) || got.bytes.length < 100) throw new HttpError('SITE_UPSTREAM', 'The imagery tile cache did not return a picture.');
      hitTile = { body: got.bytes.buffer.slice(got.bytes.byteOffset, got.bytes.byteOffset + got.bytes.byteLength), headers: { 'content-type': got.type.split(';')[0] } };
      await bytesCache.put(key, hitTile, TILE_TTL);
    }
    return new Response(hitTile.body, { status: 200, headers: { 'content-type': hitTile.headers['content-type'] || 'image/jpeg', 'cache-control': TILE_CACHE_CONTROL, 'x-content-type-options': 'nosniff' } });
  }

  return { plan, tile, getScheme };
}
