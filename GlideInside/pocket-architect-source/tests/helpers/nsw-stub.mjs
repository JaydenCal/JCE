// Shared by the browser aerial tests: the real Worker app (memory store) with a stubbed NSW upstream. The NSW export hangs, so the lot's aerial comes from
// cached tiles painted in MGA coordinates (the lot is a light rectangle with a red edge on the cadastre boundary). Copied from aerial-tiles-browser.test.mjs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { SITE } from './phone-harness.mjs';
import { createApp } from '../../server/lib/app.js';
import { createMemoryStore } from '../../server/lib/store.js';
import { lonLatToMga, webToMga } from '../../src/site/geo.js';
import { STANDARD_SCHEME, tileBounds } from '../../src/site/tile-math.js';

export const LON = 150.9301;
export const LAT = -31.0902;
export const C = lonLatToMga(LON, LAT, 56);
const ring = (e0, n0, w, h) => [[e0, n0], [e0, n0 + h], [e0 + w, n0 + h], [e0 + w, n0], [e0, n0]];
const LOT = ring(C.e - 10, C.n - 20, 20, 40);

const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// A tile painted from ground truth: every pixel is converted web mercator -> MGA and coloured by what is there.
function tilePng(z, x, y) {
  const b = tileBounds(z, x, y, STANDARD_SCHEME);
  const res = (b.maxX - b.minX) / 256;
  const rgb = Buffer.alloc(256 * 256 * 3);
  // MGA at a 17 x 17 lattice, bilinear between (the projection is smooth over a tile): fast enough to paint many tiles.
  const G = 16;
  const lat = [];
  for (let gy = 0; gy <= G; gy++) for (let gx = 0; gx <= G; gx++) lat.push(webToMga(b.minX + (gx / G) * 256 * res, b.maxY - (gy / G) * 256 * res, 56));
  for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) {
    const u = ((px + 0.5) / 256) * G; const v = ((py + 0.5) / 256) * G;
    const gx = Math.min(G - 1, Math.floor(u)); const gy = Math.min(G - 1, Math.floor(v));
    const fx = u - gx; const fy = v - gy;
    const q = (a, bb, cc, dd, k) => (a[k] * (1 - fx) + bb[k] * fx) * (1 - fy) + (cc[k] * (1 - fx) + dd[k] * fx) * fy;
    const l00 = lat[gy * (G + 1) + gx]; const l10 = lat[gy * (G + 1) + gx + 1]; const l01 = lat[(gy + 1) * (G + 1) + gx]; const l11 = lat[(gy + 1) * (G + 1) + gx + 1];
    const m = { e: q(l00, l10, l01, l11, 'e'), n: q(l00, l10, l01, l11, 'n') };
    const de = m.e - C.e;
    const dn = m.n - C.n;
    let c = [88, 120, 64]; // paddock
    if (dn < -26) c = [96, 96, 100]; // road
    else if (dn < -20) c = [150, 150, 150]; // verge and footpath
    const inLot = de >= -10 && de <= 10 && dn >= -20 && dn <= 20;
    if (inLot) c = [214, 196, 150];
    if (Math.abs(de) <= 10.25 && Math.abs(dn) <= 20.25 && !(Math.abs(de) < 9.75 && Math.abs(dn) < 19.75) && Math.abs(de) <= 10.25 && Math.abs(dn) <= 20.25) c = [230, 30, 30]; // 0.5 m red edge on the boundary
    if (de >= -5 && de <= 5 && dn >= -2 && dn <= 10) c = [150, 60, 40]; // a roof
    if ((Math.floor(m.e / 20) + Math.floor(m.n / 20)) % 2 === 0 && !inLot && dn >= -20) c = c.map((v) => v - 12);
    rgb.set(c, (py * 256 + px) * 3);
  }
  return png(256, 256, rgb);
}

function tiffF32(width, height, fn, nodata = -9999) {
  const n = width * height;
  const entries = [[256, 4, width], [257, 4, height], [258, 3, 32], [259, 3, 1], [262, 3, 1], [273, 4, 0], [277, 3, 1], [278, 4, height], [279, 4, n * 4], [339, 3, 3]];
  const ifdLen = 2 + entries.length * 12 + 4;
  const dataAt = 8 + ifdLen;
  const buf = new ArrayBuffer(dataAt + n * 4);
  const dv = new DataView(buf);
  dv.setUint8(0, 0x49); dv.setUint8(1, 0x49); dv.setUint16(2, 42, true); dv.setUint32(4, 8, true);
  dv.setUint16(8, entries.length, true);
  entries.forEach(([tag, type, v], i) => {
    const o = 10 + i * 12;
    dv.setUint16(o, tag, true); dv.setUint16(o + 2, type, true); dv.setUint32(o + 4, 1, true);
    if (type === 3) dv.setUint16(o + 8, tag === 273 ? 0 : v, true); else dv.setUint32(o + 8, tag === 273 ? dataAt : v, true);
  });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) dv.setFloat32(dataAt + (y * width + x) * 4, fn(x, y) ?? nodata, true);
  return new Uint8Array(buf);
}

export function upstream(state) {
  const j = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  return async (input, init) => {
    const url = new URL(String(input));
    const p = url.pathname;
    const q = url.searchParams;
    state.log.push(p);
    if (q.get('f') === 'json' && !p.endsWith('/query') && !p.endsWith('/identify')) return j({ name: 'svc', currentVersion: 11.1 });
    if (p.endsWith('NSW_Imagery/MapServer/export')) return new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('timeout')))); // hangs
    const m = /NSW_Imagery\/MapServer\/tile\/(\d+)\/(\d+)\/(\d+)$/.exec(p);
    if (m) { state.tiles++; return new Response(tilePng(Number(m[1]), Number(m[3]), Number(m[2])), { status: 200, headers: { 'content-type': 'image/jpeg' } }); }
    if (p.endsWith('NSW_Cadastre/MapServer/9/query')) {
      const f = (rings, a) => ({ attributes: a, geometry: { rings: [rings] } });
      const A = { lotnumber: '12', sectionnumber: null, planlabel: 'DP 123456', planlotarea: 800, lotidstring: '12//DP123456' };
      const feats = [f(LOT, A)];
      if (q.get('geometryType') === 'esriGeometryEnvelope') feats.push(f(ring(C.e + 10, C.n - 20, 20, 40), { ...A, lotnumber: '13', lotidstring: '13//DP123456' }), f(ring(C.e - 30, C.n - 20, 20, 40), { ...A, lotnumber: '11', lotidstring: '11//DP123456' }));
      return j({ features: feats });
    }
    if (p.includes('NSW_Geocoded_Addressing_Theme') && p.endsWith('/query')) return /SMITH STREET/.test(q.get('where')) ? j({ features: [{ attributes: { address: '12 SMITH STREET TAMWORTH' }, geometry: { x: LON, y: LAT } }] }) : j({ features: [] });
    if (p.includes('NSW_Administrative_Boundaries')) return j({ features: [{ attributes: { lganame: 'TAMWORTH REGIONAL' } }] });
    if (p.includes('EPI_Primary_Planning_Layers')) return j({ features: [{ attributes: { SYM_CODE: 'R2', LAY_CLASS: 'R2 Low Density Residential', EPI_NAME: 'Tamworth Regional LEP 2010' } }] });
    if (p.includes('NSW_Transport_Theme')) return j({ features: [{ attributes: { roadnamebase: 'SMITH', roadnametype: 'STREET' }, geometry: { paths: [[[C.e - 60, C.n - 25], [C.e + 60, C.n - 25]]] } }] });
    if (p.includes('NSW_Imagery_Dates')) return j({ features: [{ attributes: { BlockStartDate: Date.UTC(2022, 2, 5), Resolution_cm: 10 } }] });
    if (p.endsWith('NSW_5M_Elevation/ImageServer/exportImage')) {
      const [w, h] = q.get('size').split(',').map(Number);
      const [x0, , x1] = q.get('bbox').split(',').map(Number);
      const px = (x1 - x0) / w;
      return new Response(tiffF32(w, h, (x, y) => 300 + 0.03 * (x * px) + 0.02 * (y * px)), { status: 200, headers: { 'content-type': 'image/tiff' } });
    }
    return new Response('unavailable', { status: 503 });
  };
}

export async function serve(state) {
  let origin = '';
  const holder = { app: createApp({ store: createMemoryStore(), env: { PORTAL_ENABLED: '1', ENTITLEMENT_SECRET: 'x', ADMIN_TOKEN: 'phone-test-admin-token-0123456789' }, fetchImpl: upstream(state) }) };
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, origin || 'http://127.0.0.1');
    if (u.pathname.startsWith('/api/')) {
      const r = await holder.app.fetch(new Request(u, { method: req.method, headers: { ...req.headers, 'cf-connecting-ip': '3.3.3.3' } }));
      const h = {}; r.headers.forEach((v, k) => { if (k !== 'set-cookie') h[k] = v; });
      res.writeHead(r.status, h); return res.end(Buffer.from(await r.arrayBuffer()));
    }
    let p = decodeURIComponent(u.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(SITE, p);
    if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin };
}

