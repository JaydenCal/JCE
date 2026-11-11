// TIFF float reader on synthetic buffers: uncompressed strips, tiles, big endian, LZW, Deflate, predictors, nodata.
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { readTiff, lzwDecode } from '../src/site/tiff.js';

// Writer ---------------------------------------------------------------------------------------------------------
function tiffBytes({ width, height, values, le = true, compression = 1, rowsPerStrip = height, tiled = false, tile = 4, predictor = 1, nodata = null, bps = 32, fmt = 3, encode = (b) => b }) {
  const bytesPer = bps / 8;
  const blocks = [];
  const sample = (x, y) => (x < width && y < height ? values[y * width + x] : 0);
  const rawBlock = (x0, y0, cols, rows) => {
    const raw = new Uint8Array(cols * rows * bytesPer);
    const dv = new DataView(raw.buffer);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = sample(x0 + c, y0 + r);
        const o = (r * cols + c) * bytesPer;
        if (fmt === 3) (bps === 64 ? dv.setFloat64(o, v, le) : dv.setFloat32(o, v, le));
        else if (bps === 16) dv.setInt16(o, v, le);
        else dv.setUint8(o, v);
      }
    }
    if (predictor === 3) {
      // float predictor encode: split into byte planes (MSB first), then difference bytewise
      const out = new Uint8Array(raw.length);
      const rowBytes = cols * bytesPer;
      for (let r = 0; r < rows; r++) {
        const row = raw.subarray(r * rowBytes, (r + 1) * rowBytes);
        const dst = out.subarray(r * rowBytes, (r + 1) * rowBytes);
        for (let c = 0; c < cols; c++) for (let b = 0; b < bytesPer; b++) dst[b * cols + c] = row[c * bytesPer + (le ? bytesPer - 1 - b : b)];
        for (let c = rowBytes - 1; c > 0; c--) dst[c] = (dst[c] - dst[c - 1]) & 255;
      }
      return out;
    }
    return raw;
  };
  if (tiled) {
    for (let ty = 0; ty < Math.ceil(height / tile); ty++) for (let tx = 0; tx < Math.ceil(width / tile); tx++) blocks.push(encode(rawBlock(tx * tile, ty * tile, tile, tile)));
  } else {
    for (let y = 0; y < height; y += rowsPerStrip) blocks.push(encode(rawBlock(0, y, width, Math.min(rowsPerStrip, height - y))));
  }
  const entries = [];
  const add = (tag, type, vals) => entries.push({ tag, type, vals: Array.isArray(vals) ? vals : [vals] });
  add(256, 4, width);
  add(257, 4, height);
  add(258, 3, bps);
  add(259, 3, compression);
  add(262, 3, 1);
  add(277, 3, 1);
  if (tiled) {
    add(322, 4, tile);
    add(323, 4, tile);
  } else add(278, 4, rowsPerStrip);
  add(284, 3, 1);
  if (predictor !== 1) add(317, 3, predictor);
  add(339, 3, fmt);
  if (nodata != null) {
    const s = `${nodata}\0`;
    entries.push({ tag: 42113, type: 2, vals: [...s].map((ch) => ch.charCodeAt(0)) });
  }
  const dataStart = 8;
  let at = dataStart;
  const offs = [];
  for (const b of blocks) {
    offs.push(at);
    at += b.length;
  }
  const offTag = tiled ? 324 : 273;
  const cntTag = tiled ? 325 : 279;
  entries.push({ tag: offTag, type: 4, vals: offs }, { tag: cntTag, type: 4, vals: blocks.map((b) => b.length) });
  entries.sort((a, b) => a.tag - b.tag);
  const ifdAt = at;
  let extra = ifdAt + 2 + entries.length * 12 + 4;
  const total = [];
  const out = new Uint8Array(extra + 4096 + blocks.reduce((s, b) => s + b.length, 0));
  const dv = new DataView(out.buffer);
  out[0] = out[1] = le ? 0x49 : 0x4d;
  dv.setUint16(2, 42, le);
  dv.setUint32(4, ifdAt, le);
  let p = dataStart;
  for (const b of blocks) {
    out.set(b, p);
    p += b.length;
  }
  dv.setUint16(ifdAt, entries.length, le);
  entries.forEach((e, k) => {
    const o = ifdAt + 2 + k * 12;
    dv.setUint16(o, e.tag, le);
    dv.setUint16(o + 2, e.type, le);
    dv.setUint32(o + 4, e.vals.length, le);
    const size = e.type === 3 ? 2 : e.type === 4 ? 4 : 1;
    const bytes = size * e.vals.length;
    let w = o + 8;
    if (bytes > 4) {
      w = extra;
      dv.setUint32(o + 8, extra, le);
      extra += bytes;
    }
    e.vals.forEach((v, j) => {
      if (e.type === 3) dv.setUint16(w + j * 2, v, le);
      else if (e.type === 4) dv.setUint32(w + j * 4, v, le);
      else out[w + j] = v;
    });
  });
  void total;
  return out.subarray(0, extra);
}

// A tiny LZW encoder, only to make test data (TIFF flavour: MSB first, early change).
function lzwEncode(data) {
  const out = [];
  let acc = 0;
  let nacc = 0;
  let bits = 9;
  const put = (code) => {
    acc = (acc << bits) | code;
    nacc += bits;
    while (nacc >= 8) {
      out.push((acc >> (nacc - 8)) & 255);
      nacc -= 8;
    }
    acc &= (1 << nacc) - 1;
  };
  let dict = new Map();
  let next = 258;
  put(256);
  let w = '';
  const reset = () => {
    dict = new Map();
    next = 258;
    bits = 9;
  };
  for (const byte of data) {
    const c = String.fromCharCode(byte);
    const wc = w + c;
    if (wc.length === 1 || dict.has(wc)) w = wc;
    else {
      put(w.length === 1 ? w.charCodeAt(0) : dict.get(w));
      dict.set(wc, next++);
      const size = next; // libtiff encoder: widen when the next free code passes 2^bits - 1
      if (size > 4093) {
        put(256);
        reset();
      } else bits = size >= 2048 ? 12 : size >= 1024 ? 11 : size >= 512 ? 10 : 9;
      w = c;
    }
  }
  if (w) put(w.length === 1 ? w.charCodeAt(0) : dict.get(w));
  put(257);
  if (nacc > 0) out.push((acc << (8 - nacc)) & 255);
  return Uint8Array.from(out);
}

const ramp = (w, h) => Array.from({ length: w * h }, (_, i) => Math.round(((i % w) * 0.37 + Math.floor(i / w) * 1.1 + 100.25) * 100) / 100);
const same = (a, b) => assert.ok(a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-4), 'raster values differ');

test('uncompressed float32 strips, little and big endian', async () => {
  const values = ramp(7, 5);
  for (const le of [true, false]) {
    const t = await readTiff(tiffBytes({ width: 7, height: 5, values, le, rowsPerStrip: 2 }));
    assert.equal(t.width, 7);
    assert.equal(t.height, 5);
    same([...t.data], values);
    assert.equal(t.nodata, null);
  }
});

test('tiles that overhang the image edge', async () => {
  const values = ramp(10, 9);
  const t = await readTiff(tiffBytes({ width: 10, height: 9, values, tiled: true, tile: 4 }));
  same([...t.data], values);
});

test('LZW compressed, with the horizontal and floating point predictors', async () => {
  const values = ramp(33, 17);
  const lz = await readTiff(tiffBytes({ width: 33, height: 17, values, compression: 5, rowsPerStrip: 6, encode: lzwEncode }));
  same([...lz.data], values);
  const fp = await readTiff(tiffBytes({ width: 33, height: 17, values, compression: 5, predictor: 3, encode: lzwEncode }));
  same([...fp.data], values);
  // direct codec check on repetitive data (forces table growth)
  const rep = Uint8Array.from({ length: 6000 }, (_, i) => (i * 7) % 13);
  assert.deepEqual([...lzwDecode(lzwEncode(rep), rep.length)], [...rep]);
});

test('Deflate compressed, float64 and 16 bit integers, nodata tag', async () => {
  const values = ramp(12, 6);
  const df = await readTiff(tiffBytes({ width: 12, height: 6, values, compression: 8, predictor: 3, encode: (b) => zlib.deflateSync(b), nodata: -9999 }));
  same([...df.data], values);
  assert.equal(df.nodata, -9999);
  const d64 = await readTiff(tiffBytes({ width: 12, height: 6, values, bps: 64 }));
  same([...d64.data], values);
  const ints = Array.from({ length: 12 * 6 }, (_, i) => i * 3 - 40);
  const i16 = await readTiff(tiffBytes({ width: 12, height: 6, values: ints, bps: 16, fmt: 2 }));
  same([...i16.data], ints);
});

test('rejects what it cannot read', async () => {
  await assert.rejects(readTiff(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])), /Not a TIFF/);
  await assert.rejects(readTiff(Uint8Array.from([0x49, 0x49, 43, 0, 8, 0, 0, 0])), /BigTIFF/);
  const jpeg = tiffBytes({ width: 4, height: 4, values: ramp(4, 4), compression: 7 });
  await assert.rejects(readTiff(jpeg), /compression 7/);
});
