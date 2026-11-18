// Local harness for the residential guided flow: serves website-live as the site root, the real Worker app at /api and stubs /api/site/*
// with a real looking residential lot. Shared by tools/resiflow-shots.cjs. Live API calls do not work locally, hence the stubs.
const http = require('http'); const fs = require('fs'); const path = require('path');
const SITE = path.resolve(__dirname, '../../website-live');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const ADDRESS = '14 Sample Street, Westdale NSW';

// `aerial` (optional) replaces the aerial meta. `lot` and `contours` (optional) replace the sample lot and levels: functions returning the /api/site/lot and /api/site/contours responses.
async function startServer(port = Number(process.env.PORT || 8821), { commercial = false, lot = null, contours = null, aerial = null } = {}) {
  const ORIGIN = `http://127.0.0.1:${port}`;
  const { createApp } = await import('../server/lib/app.js');
  const { createMemoryStore } = await import('../server/lib/store.js');
  const { demoLotResponse } = await import('../src/site/demo-lot.js');
  const tam = (await import('../src/site/fixtures/tamworth.js')).default;
  const app = createApp({ store: createMemoryStore(), env: { SITE_URL: ORIGIN, ENTITLEMENT_SECRET: 'x', PORTAL_ENABLED: '1' } });
  const lotResp = () => {
    const r = demoLotResponse({ commercial });
    return { ...r, sample: false, demo: false, attribution: 'Cadastre: NSW Spatial Services.', lga: 'TAMWORTH REGIONAL',
      lot: { ...r.lot, lotNumber: '7', planLabel: 'DP 1198432', lotLabel: 'Lot 7 DP 1198432', lotPlan: '7/DP1198432' } };
  };
  const jpg = fs.readFileSync(path.resolve(__dirname, '../tests/fixtures/aerial-test.jpg'));
  const json = (res, o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, ORIGIN);
    if (u.pathname === '/api/site/search') return json(res, { results: [{ label: ADDRESS, state: 'NSW', lon: 150.930273, lat: -31.090267 }] });
    if (u.pathname === '/api/site/lot') return json(res, lot ? lot(lotResp()) : lotResp());
    if (u.pathname === '/api/site/aerial') { res.writeHead(200, { 'content-type': 'image/jpeg', 'x-site-meta': encodeURIComponent(JSON.stringify(aerial ? aerial(tam.aerial) : tam.aerial)) }); return res.end(jpg); }
    if (u.pathname === '/api/site/overlays') return json(res, { state: 'NSW', srid: 0, origin: { e: 0, n: 0 }, retrieved: new Date().toISOString(), layers: [], warnings: [] });
    if (u.pathname === '/api/site/contours') return json(res, contours ? contours(tam.contours) : tam.contours);
    if (u.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const r = await app.fetch(new Request(u, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }));
      const headers = {};
      r.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
      res.writeHead(r.status, headers);
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
    let f = path.join(SITE, p);
    if (process.env.APP_DIR && p.startsWith('/plan-studio/app/')) f = path.join(path.resolve(process.env.APP_DIR), p);
    if ((!f.startsWith(SITE) && !process.env.APP_DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { server, ORIGIN, close: () => server.close() };
}

async function newPage(browser, vp, log) {
  const ctx = await browser.newContext({ viewport: vp });
  await ctx.route(/^https:\/\/(fonts\.(googleapis|gstatic)\.com|www\.googletagmanager\.com|api\.mapbox\.com)\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') log.push(`console.error: ${m.text()} @ ${m.location().url}`); });
  return page;
}
module.exports = { startServer, newPage, ADDRESS, SITE };
