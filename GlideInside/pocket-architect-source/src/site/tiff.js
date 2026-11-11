// Minimal TIFF reader for single band elevation rasters (what ArcGIS exportImage returns for format=tiff, pixelType=F32).
// No dependencies. Reads little and big endian files, strips and tiles, one sample per pixel, and
//   compression: 1 none, 5 LZW, 8 and 32946 Deflate (through DecompressionStream, available in Workers, Node 18+ and browsers)
//   predictor: 1 none, 2 horizontal differencing, 3 floating point
//   samples: float 32 and 64, signed and unsigned 8, 16 and 32 bit integers
// Returns { width, height, data: Float32Array (row 0 at the top), nodata: number | null }.
// Why this and not LERC or getSamples: an uncompressed or LZW TIFF is a documented format that a page of JavaScript can parse, whereas LERC needs a
// codec. getSamples is slow for grids (about 30 s for 40 points, measured in the earlier JCE work).

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };

async function inflate(bytes, format = 'deflate') {
  const ds = new DecompressionStream(format);
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// TIFF LZW (MSB first codes, early change).
export function lzwDecode(input, expected = 0) {
  const out = new Uint8Array(expected || input.length * 4);
  let o = 0;
  const grow = (need) => {
    if (o + need <= out.length) return out;
    const bigger = new Uint8Array(Math.max(out.length * 2, o + need));
    bigger.set(out);
    return bigger;
  };
  let buf = out;
  const table = [];
  const reset = () => {
    table.length = 258;
  };
  reset();
  let bits = 9;
  let acc = 0;
  let nacc = 0;
  let i = 0;
  let prev = null;
  const emit = (arr) => {
    buf = grow(arr.length);
    buf.set(arr, o);
    o += arr.length;
  };
  const entry = (code) => (code < 256 ? Uint8Array.of(code) : table[code]);
  for (;;) {
    while (nacc < bits && i < input.length) {
      acc = (acc << 8) | input[i++];
      nacc += 8;
    }
    if (nacc < bits) break;
    const code = (acc >> (nacc - bits)) & ((1 << bits) - 1);
    nacc -= bits;
    acc &= (1 << nacc) - 1;
    if (code === 257) break;
    if (code === 256) {
      reset();
      bits = 9;
      prev = null;
      continue;
    }
    let cur;
    if (prev === null) {
      cur = entry(code);
    } else if (code < table.length) {
      cur = entry(code);
      const n = new Uint8Array(prev.length + 1);
      n.set(prev);
      n[prev.length] = cur[0];
      table.push(n);
    } else {
      const n = new Uint8Array(prev.length + 1);
      n.set(prev);
      n[prev.length] = prev[0];
      table.push(n);
      cur = n;
    }
    emit(cur);
    prev = cur;
    const size = table.length + 1; // early change
    bits = size >= 2048 ? 12 : size >= 1024 ? 11 : size >= 512 ? 10 : 9;
  }
  return buf.subarray(0, o);
}

export async function readTiff(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bom = String.fromCharCode(bytes[0], bytes[1]);
  if (bom !== 'II' && bom !== 'MM') throw new Error('Not a TIFF file');
  const le = bom === 'II';
  const u16 = (o) => view.getUint16(o, le);
  const u32 = (o) => view.getUint32(o, le);
  const magic = u16(2);
  if (magic === 43) throw new Error('BigTIFF is not supported');
  if (magic !== 42) throw new Error('Not a TIFF file');
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
    let value;
    if (type === 3) value = Array.from({ length: count }, (_, j) => u16(at + j * 2));
    else if (type === 4) value = Array.from({ length: count }, (_, j) => u32(at + j * 4));
    else if (type === 2) value = String.fromCharCode(...bytes.subarray(at, at + count)).replace(/\0+$/, '');
    else if (type === 12) value = Array.from({ length: count }, (_, j) => view.getFloat64(at + j * 8, le));
    else value = Array.from({ length: count }, (_, j) => bytes[at + j]);
    tags[tag] = value;
  }
  const one = (t, d) => (tags[t] ? tags[t][0] : d);
  const width = one(256);
  const height = one(257);
  const bps = one(258, 8);
  const compression = one(259, 1);
  const spp = one(277, 1);
  const planar = one(284, 1);
  const predictor = one(317, 1);
  const fmt = one(339, 1); // 1 uint, 2 int, 3 float
  if (!width || !height) throw new Error('TIFF has no size');
  if (spp !== 1) throw new Error(`Expected one band, found ${spp}`);
  if (planar !== 1 && spp > 1) throw new Error('Planar TIFF is not supported');
  const bytesPer = bps / 8;
  const tiled = !!tags[322];
  const tw = tiled ? one(322) : width;
  const th = tiled ? one(323) : one(278, height);
  const offsets = tags[tiled ? 324 : 273];
  const counts = tags[tiled ? 325 : 279];
  if (!offsets || !counts) throw new Error('TIFF has no data');
  const tilesAcross = Math.ceil(width / tw);
  const out = new Float32Array(width * height);

  const decodeSample = (dv, o) => {
    if (fmt === 3) return bps === 64 ? dv.getFloat64(o, le) : dv.getFloat32(o, le);
    if (fmt === 2) return bps === 8 ? dv.getInt8(o) : bps === 16 ? dv.getInt16(o, le) : dv.getInt32(o, le);
    return bps === 8 ? dv.getUint8(o) : bps === 16 ? dv.getUint16(o, le) : dv.getUint32(o, le);
  };

  async function block(idx, rowsInBlock, colsInBlock) {
    let raw = bytes.subarray(offsets[idx], offsets[idx] + counts[idx]);
    const expected = colsInBlock * rowsInBlock * bytesPer;
    if (compression === 5) raw = lzwDecode(raw, expected);
    else if (compression === 8 || compression === 32946) raw = await inflate(raw);
    else if (compression !== 1) throw new Error(`TIFF compression ${compression} is not supported`);
    raw = new Uint8Array(raw); // own copy, aligned
    if (predictor === 2) {
      for (let r = 0; r < rowsInBlock; r++) {
        const rowStart = r * colsInBlock * bytesPer;
        if (bytesPer === 1) for (let c = 1; c < colsInBlock; c++) raw[rowStart + c] = (raw[rowStart + c] + raw[rowStart + c - 1]) & 255;
        else if (bytesPer === 2) {
          const dv = new DataView(raw.buffer);
          for (let c = 1; c < colsInBlock; c++) dv.setUint16(rowStart + c * 2, (dv.getUint16(rowStart + c * 2, le) + dv.getUint16(rowStart + (c - 1) * 2, le)) & 0xffff, le);
        } else throw new Error('Predictor 2 is only supported for 8 and 16 bit samples');
      }
    } else if (predictor === 3) {
      // Floating point predictor: bytes are split into planes per row (most significant first), then differenced bytewise.
      const rowBytes = colsInBlock * bytesPer;
      const fixed = new Uint8Array(raw.length);
      for (let r = 0; r < rowsInBlock; r++) {
        const row = raw.subarray(r * rowBytes, (r + 1) * rowBytes);
        for (let c = bytesPer ? 1 : 0; c < rowBytes; c++) row[c] = (row[c] + row[c - 1]) & 255;
        const dst = fixed.subarray(r * rowBytes, (r + 1) * rowBytes);
        for (let c = 0; c < colsInBlock; c++) {
          for (let b = 0; b < bytesPer; b++) {
            const src = row[b * colsInBlock + c];
            dst[c * bytesPer + (le ? bytesPer - 1 - b : b)] = src;
          }
        }
      }
      raw = fixed;
    }
    return new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  }

  if (tiled) {
    const tilesDown = Math.ceil(height / th);
    for (let ty = 0; ty < tilesDown; ty++) {
      for (let tx = 0; tx < tilesAcross; tx++) {
        const dv = await block(ty * tilesAcross + tx, th, tw);
        for (let r = 0; r < th; r++) {
          const y = ty * th + r;
          if (y >= height) break;
          for (let c = 0; c < tw; c++) {
            const x = tx * tw + c;
            if (x >= width) break;
            out[y * width + x] = decodeSample(dv, (r * tw + c) * bytesPer);
          }
        }
      }
    }
  } else {
    const strips = offsets.length;
    for (let s = 0; s < strips; s++) {
      const y0 = s * th;
      const rows = Math.min(th, height - y0);
      const dv = await block(s, rows, width);
      for (let r = 0; r < rows; r++) for (let c = 0; c < width; c++) out[(y0 + r) * width + c] = decodeSample(dv, (r * width + c) * bytesPer);
    }
  }
  const nd = tags[42113] != null ? Number(String(tags[42113]).trim()) : null;
  return { width, height, data: out, nodata: Number.isFinite(nd) ? nd : null };
}
