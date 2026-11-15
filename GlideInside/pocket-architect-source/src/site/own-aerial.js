// "Bring your own aerial": the person's own picture of the lot, used instead of the standard aerial. Everything here runs in the browser.
//   * world file (.jgw .pgw .tfw .wld) parsing, GeoTIFF georeferencing (src/site/own-geotiff.js), a coordinate system choice
//     (GDA2020 or GDA94 MGA zones 49 to 56, WGS 84, Web Mercator), or two control points dragged onto lot corners for a plain picture;
//   * resampling the picture north up into the lot's own plan frame, just big enough for the lot and 30 m around it;
//   * applying it to the project (one undo step, the standard aerial kept so "Standard" brings it back) and the licence wording.
// The picture is kept in the browser's own image store like every other aerial. It is never uploaded by this code.

import { frameToLonLat } from './upload/frame.js';
import { fromLonLat, resolveCrs } from './upload/crs.js';
import { underlayFor } from './model.js';
import { saveImage, loadBitmap, removeImage, underlayKey } from '../editor2d/underlay.js';
import { readGeoInfo, readGeoTiffPixels } from './own-geotiff.js';

export const LICENCE_NOTE = 'Only use imagery you are licensed to use.';
export const NEARMAP_ATTRIBUTION = 'Nearmap imagery, your licence';
export const FILE_ATTRIBUTION = 'Aerial image supplied by the user, used under their own licence';
export const SHARE_WARNING = 'This design uses your own aerial image. Your licence for it may not allow it to be shared. The image file stays on this device and is not saved to a share link, but it is printed on plan PDFs while Aerial is on.';
export const SOURCES = [['standard', 'Standard (NSW/QLD)'], ['nearmap', 'My Nearmap key'], ['file', 'My image file']];
export const MARGIN_MM = 30000;
export const MAX_OUT_PX = 2048;

/** 'standard', 'nearmap' or 'file' for the project's lot. */
export function aerialSourceOf(project) {
  const a = project?.site?.lot?.aerial;
  return a?.userSupplied ? (a.kind === 'nearmap' ? 'nearmap' : 'file') : 'standard';
}
export const hasAerialStandard = (project) => !!project?.site?.lot?.aerialStandard?.aerial;
export const hasUserAerial = (project) => !!project?.site?.lot?.aerial?.userSupplied;

/** The coordinate systems offered for a JPG or PNG with a world file (ids from src/site/upload/crs.js, plus Web Mercator). */
export const WEB_MERCATOR = { id: 'webmerc', label: 'Web Mercator (EPSG:3857)', proj4: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs' };
export function crsChoices() {
  const out = [];
  for (let z = 56; z >= 54; z--) out.push({ id: `mga2020:${z}`, label: `GDA2020 / MGA zone ${z}` });
  for (let z = 56; z >= 54; z--) out.push({ id: `mga94:${z}`, label: `GDA94 / MGA zone ${z}` });
  out.push({ id: WEB_MERCATOR.id, label: WEB_MERCATOR.label });
  return out;
}
/** The id of the MGA zone the lot sits in as a default for the picker. */
export const defaultCrsId = (lot) => (lot?.zone ? `mga2020:${lot.zone}` : 'mga2020:56');
const crsSpec = (id) => (id === WEB_MERCATOR.id ? { proj4: WEB_MERCATOR.proj4 } : id);

/** An EPSG code from a GeoTIFF to a spec for resolveCrs, or null when it is not one we know. */
export function crsFromEpsg(code) {
  if (!Number.isInteger(code)) return null;
  if (code === 3857 || code === 900913 || code === 3785) return WEB_MERCATOR.id;
  if (code >= 7849 && code <= 7856) return `mga2020:${code - 7800}`;
  if (code >= 28349 && code <= 28356) return `mga94:${code - 28300}`;
  if (code === 4326 || code === 7844 || code === 4283 || code === 4939 || code === 4938) return 'wgs84'; // GDA94 degrees treated as WGS 84 (about 1.5 m)
  if (code >= 32601 && code <= 32660) return `utm:${code - 32600}N`;
  if (code >= 32701 && code <= 32760) return `utm:${code - 32700}S`;
  return null;
}

// Affines ------------------------------------------------------------------------------------------------------------------------
/** A world file: six numbers, one per line: A (x size), D (rotation y), B (rotation x), E (y size, normally negative), C, F (centre of the top left pixel). */
export function parseWorldFile(text) {
  const n = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 6).map(Number);
  if (n.length < 6 || n.some((v) => !Number.isFinite(v))) throw new Error('That world file could not be read. It needs six numbers, one per line.');
  const [A, D, B, E, C, F] = n;
  if (A === 0 || E === 0) throw new Error('That world file has a zero pixel size.');
  // The file gives the centre of the top left pixel; the affine here works from the top left corner of the picture.
  return { a: A, b: B, c: C - (A + B) / 2, d: D, e: E, f: F - (D + E) / 2 };
}
export function invertAffine(m) {
  const det = m.a * m.e - m.b * m.d;
  if (!det) throw new Error('That georeferencing cannot be reversed.');
  return { a: m.e / det, b: -m.b / det, c: (m.b * m.f - m.e * m.c) / det, d: -m.d / det, e: m.a / det, f: (m.d * m.c - m.a * m.f) / det };
}
const applyAffine = (m, x, y) => [m.a * x + m.b * y + m.c, m.d * x + m.e * y + m.f];

// Lot geometry -------------------------------------------------------------------------------------------------------------------
export const lotFrame = (lot) => lot.frame || { kind: 'mga', zone: lot.zone };
/** Plan mm to longitude and latitude. */
export function planToLonLat(lot, x, y) {
  const o = lot.origin || { e: 0, n: 0 };
  return frameToLonLat(lotFrame(lot), o.e + x / 1000, o.n - y / 1000);
}
/** The picture's extent in plan mm: the lot's bounding box with 30 m around it. */
export function outExtent(lot, margin = MARGIN_MM) {
  const pts = [...lot.boundary, ...(lot.parts || []).flatMap((p) => p.ring)];
  const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
  return { x0: Math.round(Math.min(...xs) - margin), y0: Math.round(Math.min(...ys) - margin), x1: Math.round(Math.max(...xs) + margin), y1: Math.round(Math.max(...ys) + margin) };
}

/** Plan mm to source pixel through a georeferenced picture: affine (pixel to map), and the coordinate system id the map x, y are in. */
export function georefMapper(lot, { affine, crsId }) {
  const inv = invertAffine(affine);
  const spec = crsSpec(crsId);
  resolveCrs(spec); // throws a readable message for an unusable system
  return (x, y) => {
    const ll = planToLonLat(lot, x, y);
    const [X, Y] = fromLonLat(spec, ll.lon, ll.lat);
    return applyAffine(inv, X, Y);
  };
}

/** Native picture resolution in mm per pixel, for a georeferenced picture. */
export function nativeMmPerPx(lot, { affine, crsId }) {
  const geographic = resolveCrs(crsSpec(crsId)).kind === 'lonlat';
  const k = geographic ? 111320 * Math.cos((planToLonLat(lot, 0, 0).lat * Math.PI) / 180) * 1000 : 1000;
  return Math.hypot(affine.a, affine.d) * k;
}

// Control points -----------------------------------------------------------------------------------------------------------------
/** A turn, scale and shift taking two picture points to two plan points (both y down). Returns { to(x, y) -> plan, from(x, y) -> picture, scale, deg }. */
export function similarityFromPairs(img, plan) {
  const [p1, p2] = img; const [q1, q2] = plan;
  const dw = { x: p2.x - p1.x, y: p2.y - p1.y };
  const dz = { x: q2.x - q1.x, y: q2.y - q1.y };
  const l2 = dw.x * dw.x + dw.y * dw.y;
  if (l2 < 1 || dz.x * dz.x + dz.y * dz.y < 1) throw new Error('Choose two different points that are well apart.');
  // complex division dz / dw
  const a = { x: (dz.x * dw.x + dz.y * dw.y) / l2, y: (dz.y * dw.x - dz.x * dw.y) / l2 };
  const mul = (u, v) => ({ x: u.x * v.x - u.y * v.y, y: u.x * v.y + u.y * v.x });
  const t = (() => { const m = mul(a, p1); return { x: q1.x - m.x, y: q1.y - m.y }; })();
  const a2 = a.x * a.x + a.y * a.y;
  const to = (x, y) => { const m = mul(a, { x, y }); return [m.x + t.x, m.y + t.y]; };
  const from = (x, y) => { const z = { x: x - t.x, y: y - t.y }; const m = mul({ x: a.x, y: -a.y }, z); return [m.x / a2, m.y / a2]; };
  return { to, from, scale: Math.sqrt(a2), deg: (Math.atan2(a.y, a.x) * 180) / Math.PI };
}

// Resampling ---------------------------------------------------------------------------------------------------------------------
/**
 * Draw the picture north up into an output of outW by outH pixels covering `extent` (plan mm). `planToSrc(x, y)` gives the source pixel (column, row)
 * for a plan point; it is evaluated on a coarse grid and interpolated, which is exact for a straight line map and well under a pixel over a lot
 * for a map projection. Pixels outside the picture are filled with a neutral ground colour. Returns { data: Uint8ClampedArray RGBA, covered: share 0 to 1 }.
 */
export function resamplePlan({ src, extent, outW, outH, planToSrc, fill = [227, 234, 217] }) {
  const NX = Math.max(2, Math.min(33, outW + 1));
  const NY = Math.max(2, Math.min(33, outH + 1));
  const gx = new Float64Array(NX * NY); const gy = new Float64Array(NX * NY);
  const W = extent.x1 - extent.x0; const H = extent.y1 - extent.y0;
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const [sx, sy] = planToSrc(extent.x0 + (i / (NX - 1)) * W, extent.y0 + (j / (NY - 1)) * H);
      gx[j * NX + i] = sx; gy[j * NX + i] = sy;
    }
  }
  const data = new Uint8ClampedArray(outW * outH * 4);
  const s = src.data; const sw = src.width; const sh = src.height;
  let covered = 0;
  for (let oy = 0; oy < outH; oy++) {
    const v = ((oy + 0.5) / outH) * (NY - 1); const j = Math.min(NY - 2, Math.floor(v)); const tv = v - j;
    for (let ox = 0; ox < outW; ox++) {
      const u = ((ox + 0.5) / outW) * (NX - 1); const i = Math.min(NX - 2, Math.floor(u)); const tu = u - i;
      const k00 = j * NX + i; const k10 = k00 + 1; const k01 = k00 + NX; const k11 = k01 + 1;
      const fx = (gx[k00] * (1 - tu) + gx[k10] * tu) * (1 - tv) + (gx[k01] * (1 - tu) + gx[k11] * tu) * tv - 0.5;
      const fy = (gy[k00] * (1 - tu) + gy[k10] * tu) * (1 - tv) + (gy[k01] * (1 - tu) + gy[k11] * tu) * tv - 0.5;
      const o = (oy * outW + ox) * 4;
      if (fx < -0.5 || fy < -0.5 || fx > sw - 0.5 || fy > sh - 0.5) { data[o] = fill[0]; data[o + 1] = fill[1]; data[o + 2] = fill[2]; data[o + 3] = 255; continue; }
      covered += 1;
      const x0 = Math.floor(fx); const y0 = Math.floor(fy); const tx = fx - x0; const ty = fy - y0;
      const cx0 = Math.max(0, Math.min(sw - 1, x0)); const cx1 = Math.max(0, Math.min(sw - 1, x0 + 1));
      const cy0 = Math.max(0, Math.min(sh - 1, y0)); const cy1 = Math.max(0, Math.min(sh - 1, y0 + 1));
      for (let c = 0; c < 3; c++) {
        const a = s[(cy0 * sw + cx0) * 4 + c]; const b = s[(cy0 * sw + cx1) * 4 + c]; const d = s[(cy1 * sw + cx0) * 4 + c]; const e = s[(cy1 * sw + cx1) * 4 + c];
        data[o + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
      }
      data[o + 3] = 255;
    }
  }
  return { data, covered: covered / (outW * outH) };
}

/** Output size in pixels for an extent at a native resolution (mm per pixel), never more than MAX_OUT_PX on the long side. */
export function outputSize(extent, nativeMm) {
  const W = extent.x1 - extent.x0; const H = extent.y1 - extent.y0;
  const mm = Math.max(nativeMm || 0, Math.max(W, H) / MAX_OUT_PX, 20);
  return { outW: Math.max(16, Math.round(W / mm)), outH: Math.max(16, Math.round(H / mm)), mmPerPx: mm };
}

/**
 * Place a decoded picture on the lot. `how` is { kind: 'georef', affine, crsId } or { kind: 'points', img: [{x,y},{x,y}], plan: [{x,y},{x,y}] }.
 * Returns { rgba, outW, outH, extent, mmPerPx, covered }. Throws a readable error when the picture does not cover the lot.
 */
export function placeOnLot({ lot, src, how }) {
  const extent = outExtent(lot);
  let planToSrc; let nativeMm;
  if (how.kind === 'points') {
    const sim = similarityFromPairs(how.img, how.plan);
    planToSrc = (x, y) => sim.from(x, y);
    nativeMm = sim.scale; // plan mm per picture pixel
  } else {
    planToSrc = georefMapper(lot, how);
    nativeMm = nativeMmPerPx(lot, how);
  }
  const { outW, outH, mmPerPx } = outputSize(extent, nativeMm);
  const r = resamplePlan({ src, extent, outW, outH, planToSrc });
  // The lot itself must be inside the picture: check the lot's centre and its corners.
  const probe = [...lot.boundary, { x: lot.boundary.reduce((t, p) => t + p.x, 0) / lot.boundary.length, y: lot.boundary.reduce((t, p) => t + p.y, 0) / lot.boundary.length }];
  const inside = probe.filter((p) => { const [sx, sy] = planToSrc(p.x, p.y); return sx >= 0 && sy >= 0 && sx <= src.width && sy <= src.height; }).length;
  if (inside < probe.length) throw new Error(inside === 0 ? 'This picture does not cover your lot. Check the coordinate system, or the points you placed.' : 'This picture covers only part of your lot. Use a picture that covers the whole lot.');
  return { rgba: r.data, outW, outH, extent, mmPerPx, covered: r.covered };
}

// Encoding (browser) -------------------------------------------------------------------------------------------------------------
const defaultCanvas = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));
/** RGBA pixels to a JPEG blob. */
export async function encodeJpeg(rgba, w, h, { createCanvas = defaultCanvas } = {}) {
  const cv = createCanvas(w, h);
  const ctx = cv.getContext('2d');
  const id = ctx.createImageData(w, h);
  id.data.set(rgba);
  ctx.putImageData(id, 0, 0);
  return cv.convertToBlob ? cv.convertToBlob({ type: 'image/jpeg', quality: 0.93 }) : new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.93));
}
/** A JPG or PNG file (or blob) to RGBA pixels. */
export async function decodeImageFile(file, { createCanvas = defaultCanvas, decode = (b) => createImageBitmap(b) } = {}) {
  if (!file || !/^image\/(png|jpeg)$/.test(file.type || '')) throw new Error('Choose a JPG or PNG picture, or a GeoTIFF.');
  if (file.size > 40 * 1024 * 1024) throw new Error('That picture is over 40 MB. Crop or reduce it first.');
  const bmp = await decode(file);
  const w = bmp.width; const h = bmp.height;
  if (w * h > 80e6) throw new Error('That picture is very large. Crop or reduce it to under about 80 megapixels first.');
  const cv = createCanvas(w, h);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
}

// Reading the person's files -----------------------------------------------------------------------------------------------------
const ext = (f) => (String(f?.name || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
export const WORLD_EXT = ['jgw', 'jpgw', 'pgw', 'pngw', 'tfw', 'tifw', 'wld'];
/** Sort the chosen files into one picture and an optional world file: { image, world, kind: 'tiff' | 'raster' }. Throws a readable message otherwise. */
export function classifyFiles(files) {
  const list = Array.from(files || []);
  const image = list.find((f) => ['tif', 'tiff', 'jpg', 'jpeg', 'png'].includes(ext(f)));
  const world = list.find((f) => WORLD_EXT.includes(ext(f))) || null;
  if (!image) throw new Error('Choose a GeoTIFF, or a JPG or PNG picture (with its world file if it has one).');
  return { image, world, kind: ['tif', 'tiff'].includes(ext(image)) ? 'tiff' : 'raster' };
}
const readText = (f) => (f.text ? f.text() : new Response(f).text());
const readBuf = (f) => (f.arrayBuffer ? f.arrayBuffer() : new Response(f).arrayBuffer());

/**
 * Decode the chosen files. Resolves { src: { width, height, data RGBA }, how: { kind: 'georef', affine, crsId, detected } | null, note }.
 * `how` is null for a plain picture (the person then places two control points). deps (tests): decode, createCanvas.
 */
export async function loadOwnPicture(files, deps = {}) {
  const { image, world, kind } = classifyFiles(files);
  if (kind === 'tiff') {
    const buf = await readBuf(image);
    const info = readGeoInfo(buf);
    const src = await readGeoTiffPixels(buf);
    if (info.affine) {
      const id = crsFromEpsg(info.epsg);
      return { src, how: { kind: 'georef', affine: info.affine, crsId: id, detected: !!id, epsg: info.epsg }, note: id ? `GeoTIFF read. Coordinate system: EPSG:${info.epsg}.` : 'GeoTIFF read, but its coordinate system is not one we know. Choose it below.' };
    }
    if (world) return { src, how: { kind: 'georef', affine: parseWorldFile(await readText(world)), crsId: null, detected: false }, note: 'World file read. Choose the coordinate system below.' };
    return { src, how: null, note: 'This TIFF has no georeferencing. Place two points to fit it to your lot.' };
  }
  const src = await decodeImageFile(image, deps);
  if (world) return { src, how: { kind: 'georef', affine: parseWorldFile(await readText(world)), crsId: null, detected: false }, note: 'World file read. Choose the coordinate system below.' };
  return { src, how: null, note: 'No world file chosen. Place two points to fit the picture to your lot.' };
}

// Applying ------------------------------------------------------------------------------------------------------------------------
/**
 * Make `blob` the lot's aerial (one undo step). The standard aerial is kept in site.lot.aerialStandard so Standard brings it back.
 * meta: { kind: 'nearmap' | 'file', source, attribution, extent {x0,y0,x1,y1}, mmPerPx }.
 */
export async function applyUserAerial(store, { blob, meta }) {
  const lot0 = store.project.site?.lot;
  if (!lot0) throw new Error('Find your lot first.');
  const key = `${underlayKey(store.project.id)}.own.${Date.now().toString(36)}`;
  await saveImage(key, blob);
  if (!(await loadBitmap(key))) { removeImage(key); throw new Error('That picture could not be read back from this browser.'); }
  const prev = lot0.aerial?.userSupplied ? lot0.aerial.key : null;
  store.apply('Aerial source', (p) => {
    const lot = p.site.lot;
    if (!lot.aerial?.userSupplied && !lot.aerialStandard) lot.aerialStandard = { aerial: lot.aerial || null, aerialWide: lot.aerialWide || null, provenance: lot.provenance?.aerial || null };
    lot.aerial = { key, source: meta.source, attribution: meta.attribution, captureDate: null, mmPerPx: meta.mmPerPx, extent: meta.extent, userSupplied: true, kind: meta.kind };
    lot.aerialWide = null;
    lot.provenance = { ...(lot.provenance || {}), aerial: { source: meta.source, attribution: meta.attribution, captureDate: null } };
    lot.layers = { ...(lot.layers || {}), aerial: true };
    p.site.underlay = underlayFor(lot);
  });
  if (prev && prev !== key) removeImage(prev);
  return key;
}

/** Back to the standard aerial (one undo step). The person's own picture is removed from this browser. */
export function useStandardAerial(store) {
  const lot0 = store.project.site?.lot;
  if (!lot0 || !lot0.aerial?.userSupplied) return false;
  const own = lot0.aerial.key;
  store.apply('Aerial source', (p) => {
    const lot = p.site.lot;
    const std = lot.aerialStandard || { aerial: null, aerialWide: null, provenance: null };
    lot.aerial = std.aerial;
    lot.aerialWide = std.aerialWide;
    lot.provenance = { ...(lot.provenance || {}), aerial: std.provenance };
    delete lot.aerialStandard;
    p.site.underlay = lot.aerial ? underlayFor(lot) : null;
  });
  removeImage(own);
  return true;
}
