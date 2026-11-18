// Worldwide aerial from Mapbox Satellite raster tiles, used wherever the NSW and Queensland state imagery does not apply.
//
//   chooseAerialSource({ lon, lat, token })  -> { source: 'nsw' | 'qld' | 'mapbox' | 'none', reason }
//   planMosaic({ frame, bbox, ... })         -> the zoom, the tiles and the output size for a box of ground (pure)
//   fetchMapboxAerial({ frame, bbox, ... })  -> { blob, meta } in the same form the state imagery gives (meta.bbox in the lot's frame)
//
// Terms of use: tiles are fetched straight from Mapbox by the browser with the PUBLIC token, kept in memory for this page view only (a
// small least recently used map, never written to disk by this code) and never fetched in bulk. The picture stitched for the lot is kept in the
// browser's own image store like every other aerial and is never uploaded. The attribution below must stay on screen and on the plan sheets.

import { CONFIG } from '../config.js';
import { stateAt, lonLatToFrame, frameToLonLat } from './upload/frame.js';

export const MAPBOX_ATTRIBUTION = '© Mapbox © OpenStreetMap';
export const MAPBOX_SOURCE = 'Mapbox Satellite';
export const NO_AERIAL_TEXT = 'Aerial not available for this location';
export const TILE_PX = 512; // the @2x raster tile
const WEB_R = 6378137;
const WORLD_M = 2 * Math.PI * WEB_R;
export const MAX_TILES = 49; // per picture; a lot and its surroundings never need more
export const MAX_OUT_PX = 4096;
const CACHE_MAX = 160;

export const mapboxToken = () => (typeof CONFIG.mapboxToken === 'string' && /^pk\./.test(CONFIG.mapboxToken) ? CONFIG.mapboxToken : '');

let tokenAsked = false;
/** Read the public token from /api/health once when it was not set at build time. Never throws. */
export async function ensureMapboxToken({ fetchImpl = globalThis.fetch } = {}) {
  if (mapboxToken() || tokenAsked || typeof fetchImpl !== 'function') return mapboxToken();
  tokenAsked = true;
  try {
    const r = await fetchImpl(`${String(CONFIG.apiBase || '/api').replace(/\/+$/, '')}/health`, { headers: { accept: 'application/json' } });
    const j = r.ok ? await r.json() : null;
    if (j && typeof j.mapboxToken === 'string' && /^pk\./.test(j.mapboxToken)) CONFIG.mapboxToken = j.mapboxToken;
  } catch { /* the grey ground is used */ }
  return mapboxToken();
}
export const resetTokenAsk = () => { tokenAsked = false; };

/**
 * Which aerial a site gets. NSW and Queensland keep their own state imagery (the existing service); everywhere else Mapbox Satellite when
 * a public token is set; with no token, none (a plain grey ground and the words "Aerial not available for this location").
 */
export function chooseAerialSource({ lon, lat, token = mapboxToken(), forceMapbox = false }) {
  const st = forceMapbox ? null : stateAt(lon, lat);
  if (st === 'NSW') return { source: 'nsw', reason: 'Inside NSW: state imagery' };
  if (st === 'QLD') return { source: 'qld', reason: 'Inside Queensland: state imagery' };
  if (token && /^pk\./.test(token)) return { source: 'mapbox', reason: 'Outside NSW and Queensland: Mapbox Satellite' };
  return { source: 'none', reason: NO_AERIAL_TEXT };
}

/** Tile URL. The token is part of the URL, so a URL is never logged or put in an error message. */
export function tileUrl(z, x, y, token) {
  return `https://api.mapbox.com/v4/mapbox.satellite/${z}/${x}/${y}@2x.jpg90?access_token=${encodeURIComponent(token)}`;
}

/** Metres per pixel of a @2x 512 pixel tile at zoom z (256 pixel grid) and latitude. */
export const metresPerPixel = (z, lat, tilePx = TILE_PX) => (WORLD_M * Math.cos((lat * Math.PI) / 180)) / (tilePx * 2 ** z);

const mercX = (lon, z) => ((lon + 180) / 360) * 2 ** z; // tile units
const mercY = (lat, z) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z;
};
export const lonLatToTile = (lon, lat, z) => ({ x: mercX(lon, z), y: mercY(lat, z) });

/**
 * Plan the picture for a box of ground (frame metres) as a mosaic of tiles. The zoom is the sharpest allowed (CONFIG.mapboxMaxZoom, or
 * opts.maxZoom) that keeps the output at most maxPx a side and the tile count at most MAX_TILES. Pure.
 * Returns { z, tiles: [{ x, y, col, row }], cols, rows, widthPx, heightPx, mPerPx, corners: [lonlat x4], box }
 */
export function planMosaic({ frame, bbox, maxPx = MAX_OUT_PX, maxZoom = CONFIG.mapboxMaxZoom || 19, minZoom = 3, tilePx = TILE_PX }) {
  const corners = [[bbox.minE, bbox.maxN], [bbox.maxE, bbox.maxN], [bbox.maxE, bbox.minN], [bbox.minE, bbox.minN]].map(([e, n]) => frameToLonLat(frame, e, n));
  const cLat = (corners[0].lat + corners[3].lat) / 2;
  const spanM = Math.max(bbox.maxE - bbox.minE, bbox.maxN - bbox.minN);
  let z = Math.min(22, maxZoom);
  for (; z >= minZoom; z--) {
    const mpp = metresPerPixel(z, cLat, tilePx);
    if (spanM / mpp > maxPx * 1.02) continue;
    const xs = corners.map((c) => mercX(c.lon, z));
    const ys = corners.map((c) => mercY(c.lat, z));
    const x0 = Math.floor(Math.min(...xs));
    const x1 = Math.floor(Math.max(...xs));
    const y0 = Math.floor(Math.min(...ys));
    const y1 = Math.floor(Math.max(...ys));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) <= MAX_TILES) break;
  }
  z = Math.max(minZoom, z);
  const xs = corners.map((c) => mercX(c.lon, z));
  const ys = corners.map((c) => mercY(c.lat, z));
  const x0 = Math.floor(Math.min(...xs));
  const x1 = Math.floor(Math.max(...xs));
  const y0 = Math.floor(Math.min(...ys));
  const y1 = Math.floor(Math.max(...ys));
  const tiles = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push({ x, y, col: x - x0, row: y - y0 });
  const mpp = metresPerPixel(z, cLat, tilePx);
  // Output pixel size: the source resolution, but never more than maxPx on the long side.
  const scale = Math.min(1, maxPx / (spanM / mpp));
  const widthPx = Math.max(16, Math.round(((bbox.maxE - bbox.minE) / mpp) * scale));
  const heightPx = Math.max(16, Math.round(((bbox.maxN - bbox.minN) / mpp) * scale));
  return { z, tiles, cols: x1 - x0 + 1, rows: y1 - y0 + 1, x0, y0, widthPx, heightPx, mPerPx: (bbox.maxE - bbox.minE) / widthPx, corners, box: bbox, outputScale: scale };
}

// Tiles in memory for this page view (least recently used); the key holds no token.
const cache = new Map();
export const clearTileCache = () => cache.clear();
export const tileCacheSize = () => cache.size;
function remember(key, value) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

export class AerialError extends Error {
  constructor(message, code = 'AERIAL') {
    super(message);
    this.name = 'AerialError';
    this.code = code;
  }
}

async function getTile(z, x, y, token, fetchImpl, signal) {
  const key = `${z}/${x}/${y}`;
  if (cache.has(key)) { const v = cache.get(key); remember(key, v); return v; }
  const p = (async () => {
    let res;
    try {
      res = await fetchImpl(tileUrl(z, x, y, token), { signal });
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      throw new AerialError('The Mapbox aerial could not be reached.', 'NETWORK');
    }
    if (res.status === 401 || res.status === 403) throw new AerialError('The Mapbox token was refused. Check that the public token is allowed for this website.', 'TOKEN');
    if (res.status === 429) throw new AerialError('Mapbox asked us to slow down. Try again in a minute.', 'RATE');
    if (!res.ok) throw new AerialError(`The Mapbox aerial answered ${res.status} for one tile.`, 'HTTP');
    return res.blob();
  })();
  remember(key, p);
  try {
    return await p;
  } catch (e) {
    cache.delete(key);
    throw e;
  }
}

const defaultCanvas = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));
const toBlob = (cv, type, q) => (cv.convertToBlob ? cv.convertToBlob({ type, quality: q }) : new Promise((r) => cv.toBlob(r, type, q)));

/**
 * Draw the fetched tiles on one mosaic and draw the mosaic onto the north up output canvas with one affine map (exact at the corners, within a
 * centimetre over a lot). Shared by the Mapbox and the bring your own Nearmap key paths. Returns the output canvas.
 */
export async function stitchMosaic(plan, blobs, { tilePx = TILE_PX, createCanvas = defaultCanvas, decode = (b) => createImageBitmap(b) } = {}) {
  const mosaic = createCanvas(plan.cols * tilePx, plan.rows * tilePx);
  const mctx = mosaic.getContext('2d');
  for (let i = 0; i < plan.tiles.length; i++) {
    const bmp = await decode(blobs[i]);
    mctx.drawImage(bmp, plan.tiles[i].col * tilePx, plan.tiles[i].row * tilePx, tilePx, tilePx);
    bmp.close?.();
  }
  // Affine map from output pixels to mosaic pixels through the three corners (top left, top right, bottom left).
  const px = (c) => ({ x: (mercX(c.lon, plan.z) - plan.x0) * tilePx, y: (mercY(c.lat, plan.z) - plan.y0) * tilePx });
  const tl = px(plan.corners[0]);
  const tr = px(plan.corners[1]);
  const bl = px(plan.corners[3]);
  const W = plan.widthPx;
  const H = plan.heightPx;
  const out = createCanvas(W, H);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // The mosaic is drawn so that mosaic point tl lands on output (0, 0): output = M^-1 * (mosaic - tl). Using setTransform with the output to mosaic
  // matrix inverted by hand keeps this free of DOMMatrix.
  const a = (tr.x - tl.x) / W; const b = (tr.y - tl.y) / W; // mosaic step per output pixel across
  const c = (bl.x - tl.x) / H; const d = (bl.y - tl.y) / H; // mosaic step per output pixel down
  const det = a * d - b * c;
  const ia = d / det; const ib = -b / det; const ic = -c / det; const id = a / det;
  const ie = -(ia * tl.x + ic * tl.y);
  const iff = -(ib * tl.x + id * tl.y);
  ctx.setTransform(ia, ib, ic, id, ie, iff);
  ctx.drawImage(mosaic, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return out;
}

/**
 * The picture for a box of ground, north up in the lot's frame. Fetches the tiles (memory cache), draws them on one mosaic and draws the
 * mosaic onto the output with one affine map (exact at the corners, within a centimetre over a lot, a few decimetres over a kilometre).
 * deps (for tests): fetchImpl, createCanvas(w, h), decode(blob) -> bitmap, signal.
 * Returns { blob, meta } with meta { source, attribution, captureDate: null, bbox, widthPx, heightPx, mmPerPx, georef: 'mga'|'frame', zoom }.
 */
export async function fetchMapboxAerial({ frame, bbox, token = mapboxToken(), fetchImpl = globalThis.fetch, createCanvas = defaultCanvas, decode = (b) => createImageBitmap(b), signal, maxPx = MAX_OUT_PX, maxZoom }) {
  if (!token) throw new AerialError(NO_AERIAL_TEXT, 'NO_TOKEN');
  const plan = planMosaic({ frame, bbox, maxPx, ...(maxZoom ? { maxZoom } : {}) });
  const blobs = await Promise.all(plan.tiles.map((t) => getTile(plan.z, t.x, t.y, token, fetchImpl, signal)));
  const out = await stitchMosaic(plan, blobs, { tilePx: TILE_PX, createCanvas, decode });
  const W = plan.widthPx;
  const H = plan.heightPx;
  const blob = await toBlob(out, 'image/jpeg', 0.95);
  const meta = { source: MAPBOX_SOURCE, attribution: MAPBOX_ATTRIBUTION, captureDate: null, licence: 'Mapbox terms of service', retrieved: new Date().toISOString(), georef: frame.kind === 'mga' ? 'mga' : 'frame', bbox, widthPx: W, heightPx: H, mmPerPx: Math.round(((bbox.maxE - bbox.minE) / W) * 1000 * 1000) / 1000, zoom: plan.z, tiles: plan.tiles.length };
  return { blob, meta };
}

/** The attribution text that goes with a lot's aerial, or '' when the aerial is not Mapbox. */
export function aerialAttribution(lot) {
  const a = lot?.aerial || lot?.provenance?.aerial;
  if (!a) return '';
  return /mapbox/i.test(`${a.source || ''} ${a.attribution || ''}`) ? MAPBOX_ATTRIBUTION : '';
}

/**
 * The inner (sharp) and wide (outer, lower resolution) pictures for a lot, by the chosen source. Never throws for a missing aerial: returns
 * { aerial: null, aerialWide: null, source, warnings }. The state sources use `stateFetch(params)` (the existing fetchAerial).
 */
export async function loadAerialForLot({ lot, frame, bbox, marginM = 30, wideM = 500, token = mapboxToken(), forceMapbox = false, fetchImpl, signal, stateFetch = null, createCanvas, decode, onStep }) {
  const warnings = [];
  const centre = frameToLonLat(frame, (bbox.minE + bbox.maxE) / 2, (bbox.minN + bbox.maxN) / 2);
  const choice = chooseAerialSource({ lon: centre.lon, lat: centre.lat, token, forceMapbox });
  // Large sites get a proportionally wider sharp aerial around the lot (owner 16/11/2026), up to 300 m each side.
  const lotSpan = Math.max(bbox.maxE - bbox.minE, bbox.maxN - bbox.minN);
  marginM = Math.max(marginM, 120, Math.min(300, lotSpan * 0.4)); // at least 120 m each side so a small lot still sees its neighbours in the photo
  const inner = { minE: bbox.minE - marginM, minN: bbox.minN - marginM, maxE: bbox.maxE + marginM, maxN: bbox.maxN + marginM };
  const span = Math.max(inner.maxE - inner.minE, inner.maxN - inner.minN);
  const m = Math.min(700, Math.max(wideM, span * 0.75));
  const snap = (v, up) => (up ? Math.ceil(v / 50) : Math.floor(v / 50)) * 50;
  const wide = { minE: snap(bbox.minE - m, false), minN: snap(bbox.minN - m, false), maxE: snap(bbox.maxE + m, true), maxN: snap(bbox.maxN + m, true) };
  onStep?.('aerial');
  let source = choice.source;
  const viaMapbox = async () => {
    const innerPic = await fetchMapboxAerial({ frame, bbox: inner, token, fetchImpl, signal, createCanvas, decode });
    let wideOut = null;
    try { wideOut = await fetchMapboxAerial({ frame, bbox: wide, token, fetchImpl, signal, createCanvas, decode, maxPx: 2048 }); } catch (e) { if (e?.name === 'AbortError') throw e; }
    return { aerial: innerPic, aerialWide: wideOut };
  };
  try {
    if (choice.source === 'mapbox') return { ...(await viaMapbox()), source, warnings };
    if (choice.source === 'nsw' || choice.source === 'qld') {
      if (stateFetch && frame.kind === 'mga') {
        const common = { state: choice.source.toUpperCase(), srid: String(lot.srid), origin: `${lot.origin.e},${lot.origin.n}` };
        try {
          const innerSpan = Math.max(inner.maxE - inner.minE, inner.maxN - inner.minN);
          const innerPic = await stateFetch({ ...common, bbox: `${inner.minE},${inner.minN},${inner.maxE},${inner.maxN}`, ...(innerSpan > 400 ? { res: String(Math.min(1, innerSpan / 4096).toFixed(3)), maxpx: '4096' } : {}) });
          let wideOut = null;
          try { wideOut = await stateFetch({ ...common, bbox: `${wide.minE},${wide.minN},${wide.maxE},${wide.maxN}`, res: String(Math.min(2, Math.max(0.1, (wide.maxE - wide.minE) / 2048)).toFixed(3)), maxpx: '2048' }); } catch (e) { if (e?.name === 'AbortError') throw e; }
          return { aerial: innerPic, aerialWide: wideOut, source, warnings };
        } catch (e) {
          if (e?.name === 'AbortError') throw e;
          warnings.push(`State imagery was not available (${e.message}).`);
          if (token) { source = 'mapbox'; return { ...(await viaMapbox()), source, warnings: [...warnings, 'Mapbox Satellite is shown instead.'] }; }
        }
      }
    }
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    warnings.push(e?.message || NO_AERIAL_TEXT);
  }
  warnings.push(NO_AERIAL_TEXT);
  return { aerial: null, aerialWide: null, source: 'none', warnings };
}
