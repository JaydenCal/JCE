// Reads a simple north up GeoTIFF picture (8 or 16 bit grey, RGB or RGBA; none, LZW or Deflate; strips or tiles; chunky layout) in the browser,
// with its georeferencing: the pixel to map affine (ModelPixelScale plus ModelTiepoint, or ModelTransformation) and the EPSG code from the GeoKeys.
// No dependencies. Processed entirely on the device: nothing here touches the network.
// Not supported (a readable error is thrown): JPEG compressed TIFF, palette colour, planar layout, BigTIFF, user defined coordinate systems.
import { lzwDecode } from './tiff.js';

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
}

/** Read the tags of the first image: { tags, le, bytes, view }. */
function readTags(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 16) throw new Error('That file is not a TIFF picture.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bom = String.fromCharCode(bytes[0], bytes[1]);
  if (bom !== 'II' && bom !== 'MM') throw new Error('That file is not a TIFF picture.');
  const le = bom === 'II';
  const u16 = (o) => view.getUint16(o, le);
  const u32 = (o) => view.getUint32(o, le);
  const magic = u16(2);
  if (magic === 43) throw new Error('BigTIFF files are not supported. Export a normal GeoTIFF, or use a JPG or PNG with a world file.');
  if (magic !== 42) throw new Error('That file is not a TIFF picture.');
  const ifd = u32(4);
  const n = u16(ifd);
  const tags = {};
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    const tag = u16(e);
    const type = u16(e + 2);
    const count = u32(e + 4);
    const size = (TYPE_SIZE[type] || 1) * count;
    const at = size <= 4 ? e + 8 : u32(e + 8);
    if (at + size > bytes.length) continue;
    let v;
    if (type === 3) v = Array.from({ length: count }, (_, j) => u16(at + j * 2));
    else if (type === 4) v = Array.from({ length: count }, (_, j) => u32(at + j * 4));
    else if (type === 2) v = String.fromCharCode(...bytes.subarray(at, at + count)).replace(/\0+$/, '');
    else if (type === 12) v = Array.from({ length: count }, (_, j) => view.getFloat64(at + j * 8, le));
    else v = Array.from({ length: count }, (_, j) => bytes[at + j]);
    tags[tag] = v;
  }
  return { tags, le, bytes, view };
}

/** GeoKey id to value (short values only), from the GeoKeyDirectory. */
function geoKeys(tags) {
  const d = tags[34735];
  const out = {};
  if (!d || d.length < 4) return out;
  const n = d[3];
  for (let i = 0; i < n; i++) {
    const [id, loc, , val] = d.slice(4 + i * 4, 8 + i * 4);
    if (loc === 0) out[id] = val;
  }
  return out;
}

/**
 * The georeferencing only (no pixels): { width, height, affine, epsg, pixelIsPoint, units }.
 * affine maps pixel corner coordinates (column, row from the top left corner of the picture) to map x, y: x = a col + b row + c, y = d col + e row + f.
 * epsg is the EPSG code (projected or geographic) or null when it is not stated or is user defined.
 */
export function readGeoInfo(input) {
  const { tags } = readTags(input);
  const width = tags[256]?.[0];
  const height = tags[257]?.[0];
  if (!width || !height) throw new Error('That TIFF has no size.');
  const scale = tags[33550];
  const tie = tags[33922];
  const mt = tags[34264];
  let affine = null;
  if (mt && mt.length >= 16) affine = { a: mt[0], b: mt[1], c: mt[3], d: mt[4], e: mt[5], f: mt[7] };
  else if (scale && tie && tie.length >= 6) {
    const [i, j, , x, y] = tie;
    affine = { a: scale[0], b: 0, c: x - i * scale[0], d: 0, e: -scale[1], f: y + j * scale[1] };
  }
  const keys = geoKeys(tags);
  const pixelIsPoint = keys[1025] === 2;
  if (affine && pixelIsPoint) { // PixelIsPoint: the tiepoint is the centre of the corner pixel
    affine = { ...affine, c: affine.c - (affine.a + affine.b) / 2, f: affine.f - (affine.d + affine.e) / 2 };
  }
  const proj = keys[3072];
  const geog = keys[2048];
  const epsg = proj && proj !== 32767 ? proj : geog && geog !== 32767 ? geog : null;
  return { width, height, affine, epsg, geographic: !(proj && proj !== 32767) && !!epsg, pixelIsPoint };
}

/** Decode the pixels to RGBA: { width, height, data: Uint8ClampedArray }. */
export async function readGeoTiffPixels(input) {
  const { tags, le, bytes } = readTags(input);
  const one = (t, d) => (tags[t] ? tags[t][0] : d);
  const width = one(256);
  const height = one(257);
  const bps = tags[258] ? tags[258][0] : 1;
  const spp = one(277, 1);
  const compression = one(259, 1);
  const planar = one(284, 1);
  const predictor = one(317, 1);
  const photometric = one(262, 1);
  const fmt = one(339, 1);
  if (!width || !height) throw new Error('That TIFF has no size.');
  if (width * height > 80e6) throw new Error('That image is very large. Crop or reduce it to under about 80 megapixels first.');
  if (![8, 16].includes(bps) || fmt !== 1) throw new Error('Only 8 or 16 bit colour or grey pictures are supported. Export an 8 bit RGB GeoTIFF, or use a JPG or PNG with a world file.');
  if (photometric === 3) throw new Error('Palette colour TIFFs are not supported. Export an RGB GeoTIFF.');
  if (![1, 3, 4].includes(spp)) throw new Error('Only grey, RGB or RGBA pictures are supported. Export an RGB GeoTIFF.');
  if (planar !== 1 && spp > 1) throw new Error('Planar TIFF layout is not supported. Export a normal RGB GeoTIFF.');
  if (![1, 5, 8, 32946].includes(compression)) throw new Error(`TIFF compression ${compression} is not supported. Use uncompressed, LZW or Deflate, or use a JPG or PNG with a world file.`);
  const bp = bps / 8;
  const tiled = !!tags[322];
  const tw = tiled ? one(322) : width;
  const th = tiled ? one(323) : Math.min(one(278, height), height);
  const offsets = tags[tiled ? 324 : 273];
  const counts = tags[tiled ? 325 : 279];
  if (!offsets || !counts) throw new Error('That TIFF has no picture data.');
  const out = new Uint8ClampedArray(width * height * 4);
  const rowBytes = (cols) => cols * spp * bp;

  async function block(idx, rows, cols) {
    let raw = bytes.subarray(offsets[idx], offsets[idx] + counts[idx]);
    const expected = rowBytes(cols) * rows;
    if (compression === 5) raw = lzwDecode(raw, expected);
    else if (compression === 8 || compression === 32946) raw = await inflate(raw);
    raw = new Uint8Array(raw);
    if (predictor === 2) {
      const rb = rowBytes(cols);
      for (let r = 0; r < rows; r++) {
        const o = r * rb;
        if (bp === 1) for (let c = spp; c < cols * spp; c++) raw[o + c] = (raw[o + c] + raw[o + c - spp]) & 255;
        else {
          const dv = new DataView(raw.buffer);
          for (let c = spp; c < cols * spp; c++) dv.setUint16(o + c * 2, (dv.getUint16(o + c * 2, le) + dv.getUint16(o + (c - spp) * 2, le)) & 0xffff, le);
        }
      }
    } else if (predictor !== 1) throw new Error('That TIFF predictor is not supported.');
    return new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  const sample = (dv, o) => (bp === 1 ? dv.getUint8(o) : dv.getUint16(o, le) >> 8);
  const put = (dv, rowStartByte, c, x, y) => {
    const base = rowStartByte + c * spp * bp;
    const o = (y * width + x) * 4;
    if (spp === 1) { const g = sample(dv, base); out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = 255; } else {
      out[o] = sample(dv, base); out[o + 1] = sample(dv, base + bp); out[o + 2] = sample(dv, base + 2 * bp); out[o + 3] = spp === 4 ? sample(dv, base + 3 * bp) : 255;
    }
    if (photometric === 0 && spp === 1) { out[o] = 255 - out[o]; out[o + 1] = out[o]; out[o + 2] = out[o]; }
  };
  if (tiled) {
    const across = Math.ceil(width / tw);
    const down = Math.ceil(height / th);
    for (let ty = 0; ty < down; ty++) {
      for (let tx = 0; tx < across; tx++) {
        const dv = await block(ty * across + tx, th, tw);
        for (let r = 0; r < th; r++) {
          const y = ty * th + r;
          if (y >= height) break;
          for (let c = 0; c < tw; c++) { const x = tx * tw + c; if (x >= width) break; put(dv, r * rowBytes(tw), c, x, y); }
        }
      }
    }
  } else {
    for (let s = 0; s < offsets.length; s++) {
      const y0 = s * th;
      const rows = Math.min(th, height - y0);
      if (rows <= 0) break;
      const dv = await block(s, rows, width);
      for (let r = 0; r < rows; r++) for (let c = 0; c < width; c++) put(dv, r * rowBytes(width), c, c, y0 + r);
    }
  }
  return { width, height, data: out };
}
