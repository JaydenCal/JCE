// A static server for website-live with stubbed /api/site/* answers, for the browser tests of the lot loading steps.
//   startStub() -> { srv, url, S }   S.scenario: 'tam' (a normal lot) | 'rural' (a 50.9 ha lot, the 756 Quia Road shape)
//   S.mode: 'ok' | 'hangaerial' (the aerial request never answers) | 'slowaerial' (3 s) | 'hanglot' (the lot request never answers) | '500'
//   S.calls counts requests per endpoint.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SITE = path.resolve(ROOT, '../website-live');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.xml': 'application/xml', '.txt': 'text/plain', '.glb': 'model/gltf-binary' };

function png(w, h, px) {
  const T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = px(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const TILE = png(256, 256, (x, y) => [96 + ((x * 7 + y * 13) % 11), 150, 70]);

/** The 756 Quia Road Gunnedah lot response shape: one 50.9 ha rural lot with large neighbours and a road along its south side. */
export function ruralLot() {
  const outer = [[279.882, 598.081], [120.186, -651.937], [-231.378, -607.14], [-279.329, -601.031], [-120.472, 653.389]];
  const nb = (n, pts) => ({ lotNumber: n, planLabel: 'DP 263990', lotLabel: `Lot ${n} DP 263990`, areaM2: 450000, polygons: [{ outer: pts, holes: [] }] });
  return {
    state: 'NSW', srid: 7856, zone: 56, origin: { e: 227905.081, n: 6572466.61 }, query: { lon: 150.151393, lat: -30.953601 },
    lot: { lotNumber: '3', planLabel: 'DP 263990', lotLabel: 'Lot 3 DP 263990', areaM2: 509264.5, registeredAreaM2: 509264.5, lotPlan: '3/DP263990', polygons: [{ outer, holes: [] }], bboxMga: { minE: 227625.752, minN: 6571814.673, maxE: 228184.963, maxN: 6573119.999 } },
    neighbours: [nb('2', [[279.9, 598.1], [120.2, -651.9], [900, -700], [1000, 500]]), nb('4', [[-120.5, 653.4], [-279.3, -601], [-900, -560], [-800, 700]]), nb('5', [[279.9, 598.1], [-120.5, 653.4], [-100, 1300], [300, 1250]]), nb('6', [[120.2, -651.9], [-231.4, -607.1], [-300, -1200], [200, -1250]])],
    roads: [{ name: 'Quia Road', points: [[400, -700], [120, -672], [-231, -627], [-600, -580]] }],
    lga: 'GUNNEDAH', zoning: { code: 'RU1', name: 'Primary Production', instrument: 'Gunnedah Local Environmental Plan 2012' }, zoneNote: null, attribution: 'Test data', retrieved: '2026-11-23T00:00:00.000Z',
  };
}

export async function startStub() {
  const tam = (await import('../../src/site/fixtures/tamworth.js')).default;
  const { mockOverlays } = await import('../../src/site/fixtures/overlays.js');
  const S = { scenario: 'tam', mode: 'ok', calls: { search: 0, lot: 0, aerial: 0, contours: 0, overlays: 0 }, urls: [] };
  const J = (res, o, st = 200) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/site/search') {
      S.calls.search++;
      const label = S.scenario === 'rural' ? '756 Quia Road Gunnedah NSW' : '14 Sample Street Calala NSW';
      const o = S.scenario === 'rural' ? { label, state: 'NSW', lon: 150.151393, lat: -30.953601 } : { label, state: 'NSW', lon: 150.930273, lat: -31.090267 };
      return J(res, { results: [o] });
    }
    const m = /^\/api\/site\/(lot|aerial|contours|overlays)$/.exec(u.pathname);
    if (m) {
      const k = m[1]; S.calls[k]++; S.urls.push(`${k} ${u.search}`);
      if (S.mode === '500') return J(res, { code: 'UPSTREAM', message: 'boom' }, 500);
      if (S.mode === 'hanglot' && k === 'lot') { await new Promise((r) => { res.on('close', r); setTimeout(r, 120000); }); return undefined; }
      if (k === 'aerial' && S.mode === 'hangaerial') { await new Promise((r) => { res.on('close', r); setTimeout(r, 120000); }); return undefined; }
      if (k === 'aerial' && S.mode === 'slowaerial') await new Promise((r) => setTimeout(r, S.aerialDelay || 3000));
      const f = S.scenario === 'rural' ? ruralLot() : JSON.parse(JSON.stringify(tam.lot));
      if (k === 'lot') { f.sample = false; return J(res, f); }
      if (k === 'aerial') {
        const [minE, minN, maxE, maxN] = (u.searchParams.get('bbox') || '0,0,100,100').split(',').map(Number);
        const meta = { ...tam.aerial, sample: false, synthetic: false, georef: 'mga', bbox: { minE, minN, maxE, maxN }, widthPx: 256, heightPx: 256, mmPerPx: ((maxE - minE) / 256) * 1000 };
        res.writeHead(200, { 'content-type': 'image/png', 'x-site-meta': encodeURIComponent(JSON.stringify(meta)) });
        return res.end(TILE);
      }
      if (k === 'contours') return J(res, tam.contours);
      const q = Object.fromEntries(u.searchParams);
      return J(res, mockOverlays({ bbox: q.bbox, origin: q.origin, srid: q.srid, state: q.state }));
    }
    if (u.pathname.startsWith('/api/')) return J(res, { code: 'NOT_FOUND' }, 404);
    let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(SITE, p);
    if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
    return undefined;
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  return { srv, url: `http://127.0.0.1:${srv.address().port}`, S };
}

export const GL_ARGS = ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];
