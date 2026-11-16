// Local preview of the release build: serves ../website-live and passes ONLY read-only GET /api/site/* lookups (address search, lot, aerial,
// contours) through to the live site. Everything else under /api answers 404, so nothing here can write to the live database.
// Usage: node golive/preview-local.mjs [port]      then open http://localhost:8100/plan-studio/app/?mode=commercial
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../website-live');
const port = Number(process.argv[2] || 8100);
const LIVE = 'https://glideinside.com.au';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${port}`);
  if (u.pathname.startsWith('/api/')) {
    if (req.method !== 'GET' || !u.pathname.startsWith('/api/site/')) { res.writeHead(404); return res.end('Not available in the local preview'); }
    try {
      const r = await fetch(LIVE + u.pathname + u.search, { headers: { 'user-agent': 'Mozilla/5.0 GlideInsideLocalPreview', accept: '*/*' } });
      const headers = {};
      r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie'].includes(k)) headers[k] = v; });
      res.writeHead(r.status, headers);
      return res.end(Buffer.from(await r.arrayBuffer()));
    } catch { res.writeHead(502); return res.end('Live lookup failed'); }
  }
  let p = path.normalize(path.join(root, decodeURIComponent(u.pathname)));
  if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': types[path.extname(p).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(d);
  });
}).listen(port, () => console.log(`Glide Inside preview: http://localhost:${port}/plan-studio/app/?mode=commercial\n(Residential: http://localhost:${port}/plan-studio/app/?mode=residential)  Press Ctrl+C to stop.`));
