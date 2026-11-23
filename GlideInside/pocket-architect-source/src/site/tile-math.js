// Web mercator tile mosaic maths for the aerial fallback (NSW cached tiles, ArcGIS /tile/{level}/{row}/{col} = z/y/x).
// Pure functions shared by the Worker (server/lib/aerial-tiles.js) and the browser (src/site/tile-mosaic.js).
// The NSW_Imagery cache is expected to use the standard ArcGIS Online / Google web mercator scheme (256 px tiles, origin top left at
// -20037508.342787, 20037508.342787, level 0 = 156543.03392800014 m per pixel). The server reads tileInfo once and falls back to this.

import { mgaBoxToWebBox, mgaToLonLat, round } from './geo.js';

export const WEB_HALF = 20037508.342787;
export const STANDARD_SCHEME = Object.freeze({ originX: -WEB_HALF, originY: WEB_HALF, tileSize: 256, res0: 156543.03392800014, minLevel: 0, maxLevel: 20, resolutions: null });
export const MIN_ZOOM = 10; // the proxy never serves levels coarser than this
export const MAX_ZOOM = 20;
export const TARGET_GROUND_RES = 0.3; // metres per pixel on the ground for small lots
export const DEFAULT_MAX_TILES = 64;

/** Resolution (web metres per pixel) of a level, or null when the scheme has no such level. */
export function resolutionAt(scheme, z) {
  if (scheme.resolutions) return scheme.resolutions[z] ?? null;
  if (!Number.isInteger(z) || z < (scheme.minLevel ?? 0) || z > scheme.maxLevel) return null;
  return scheme.res0 / 2 ** z;
}

/** A tiling scheme from ArcGIS tileInfo JSON. Anything that is not 256 px web mercator with sane lods gives the standard scheme. */
export function schemeFromTileInfo(ti) {
  try {
    const wkid = ti?.spatialReference?.latestWkid ?? ti?.spatialReference?.wkid;
    if (![102100, 3857, 102113, 900913].includes(wkid)) return STANDARD_SCHEME;
    const size = Number(ti.rows);
    if (!(size > 0) || Number(ti.cols) !== size || !Array.isArray(ti.lods) || !ti.lods.length) return STANDARD_SCHEME;
    const ox = Number(ti.origin?.x);
    const oy = Number(ti.origin?.y);
    if (!Number.isFinite(ox) || !Number.isFinite(oy)) return STANDARD_SCHEME;
    const resolutions = {};
    let maxLevel = 0;
    for (const l of ti.lods) {
      if (!Number.isInteger(l.level) || !(Number(l.resolution) > 0)) return STANDARD_SCHEME;
      resolutions[l.level] = Number(l.resolution);
      maxLevel = Math.max(maxLevel, l.level);
    }
    return { originX: ox, originY: oy, tileSize: size, res0: null, minLevel: 0, maxLevel, resolutions };
  } catch {
    return STANDARD_SCHEME;
  }
}

/** The levels a mosaic may use, ascending (coarse to fine), within MIN_ZOOM..MAX_ZOOM and the scheme. */
export function usableLevels(scheme) {
  const out = [];
  for (let z = MIN_ZOOM; z <= Math.min(MAX_ZOOM, scheme.maxLevel); z++) if (resolutionAt(scheme, z)) out.push(z);
  return out;
}

/** Tile column/row range (inclusive) covering a web mercator box at level z. */
export function tileRange(wb, z, scheme = STANDARD_SCHEME) {
  const span = resolutionAt(scheme, z) * scheme.tileSize;
  const eps = 1e-6;
  const x0 = Math.floor((wb.minX - scheme.originX) / span + eps);
  const x1 = Math.floor((wb.maxX - scheme.originX) / span - eps);
  const y0 = Math.floor((scheme.originY - wb.maxY) / span + eps);
  const y1 = Math.floor((scheme.originY - wb.minY) / span - eps);
  return { x0, x1: Math.max(x0, x1), y0, y1: Math.max(y0, y1), cols: Math.max(x0, x1) - x0 + 1, rows: Math.max(y0, y1) - y0 + 1 };
}

/** The finest level at or under `targetGround` metres per ground pixel (the finest level overall when none is fine enough), then coarsened until it fits maxTiles. */
export function chooseZoom(wb, lat, { scheme = STANDARD_SCHEME, targetGround = TARGET_GROUND_RES, maxTiles = DEFAULT_MAX_TILES } = {}) {
  const levels = usableLevels(scheme);
  if (!levels.length) return null;
  const cos = Math.cos((lat * Math.PI) / 180);
  let i = levels.findIndex((z) => resolutionAt(scheme, z) * cos <= targetGround + 1e-9);
  if (i < 0) i = levels.length - 1;
  while (i > 0) {
    const r = tileRange(wb, levels[i], scheme);
    if (r.cols * r.rows <= maxTiles) break;
    i--;
  }
  return levels[i];
}

/**
 * Plan a mosaic for an MGA box. Returns everything the browser needs to fetch the tiles, draw them and hand the result to warpToMga:
 *  z, tiles [{x, y}], mosaic { cols, rows, tileSize }, crop { sx, sy, widthPx, heightPx } in mosaic pixels, webBbox (exactly the crop edges),
 *  outWidthPx / outHeightPx (north up MGA output size), mmPerPx.
 * `maxPx` caps the longest output side.
 */
export function planMosaic(box, zone, { scheme = STANDARD_SCHEME, res = 0, maxTiles = DEFAULT_MAX_TILES, maxPx = 4096 } = {}) {
  const wbox = mgaBoxToWebBox(box, zone);
  const centre = mgaToLonLat((box.minE + box.maxE) / 2, (box.minN + box.maxN) / 2, zone);
  const z = chooseZoom(wbox, centre.lat, { scheme, targetGround: Math.max(TARGET_GROUND_RES, res || 0), maxTiles });
  if (z == null) return null;
  const tres = resolutionAt(scheme, z);
  const span = tres * scheme.tileSize;
  const r = tileRange(wbox, z, scheme);
  const mosMinX = scheme.originX + r.x0 * span;
  const mosMaxY = scheme.originY - r.y0 * span;
  const sx = Math.max(0, Math.floor((wbox.minX - mosMinX) / tres));
  const sy = Math.max(0, Math.floor((mosMaxY - wbox.maxY) / tres));
  const ex = Math.min(r.cols * scheme.tileSize, Math.ceil((wbox.maxX - mosMinX) / tres));
  const ey = Math.min(r.rows * scheme.tileSize, Math.ceil((mosMaxY - wbox.minY) / tres));
  const webBbox = { minX: mosMinX + sx * tres, maxX: mosMinX + ex * tres, maxY: mosMaxY - sy * tres, minY: mosMaxY - ey * tres };
  const ground = tres * Math.cos((centre.lat * Math.PI) / 180);
  let outW = Math.ceil((box.maxE - box.minE) / ground);
  let outH = Math.ceil((box.maxN - box.minN) / ground);
  const k = Math.max(1, Math.max(outW, outH) / Math.max(256, maxPx));
  outW = Math.max(16, Math.ceil(outW / k));
  outH = Math.max(16, Math.ceil(outH / k));
  const tiles = [];
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) tiles.push({ x, y });
  return {
    z, tileSize: scheme.tileSize, x0: r.x0, y0: r.y0, cols: r.cols, rows: r.rows, tiles,
    crop: { sx, sy, widthPx: ex - sx, heightPx: ey - sy }, webBbox,
    outWidthPx: outW, outHeightPx: outH, mmPerPx: round(((box.maxE - box.minE) / outW) * 1000, 3), webResolution: tres,
  };
}

/** Web mercator bounds of tile x/y at level z. */
export function tileBounds(z, x, y, scheme = STANDARD_SCHEME) {
  const span = resolutionAt(scheme, z) * scheme.tileSize;
  return { minX: scheme.originX + x * span, maxX: scheme.originX + (x + 1) * span, maxY: scheme.originY - y * span, minY: scheme.originY - (y + 1) * span };
}
