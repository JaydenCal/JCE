// Smoke test for the builder house import files: loads every design in golive/builder-houses/*.json into the built Pocket Architect app
// (store.replace, 2D then 3D view) and fails on any page error.   node tools/smoke-houses.mjs [--only slug]
import http from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, join, dirname } from 'node:path';
import { createRequire } from 'node:module';

const here = dirname(new URL(import.meta.url).pathname);
const ROOT = resolve(here, '../../website-live');
const DATA = resolve(here, '../../golive/builder-houses');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require.resolve('playwright', { paths: ['/opt/npm-tools/node_modules', process.env.NODE_PATH || ''] }))); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg > 0 ? process.argv[onlyArg + 1] : null;
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(ROOT, p);
  if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const errors = [];
let loaded = 0;
const browser = await chromium.launch();
try {
  for (const file of readdirSync(DATA).filter((f) => f.endsWith('.json') && (!only || f === `${only}.json`))) {
    const houses = JSON.parse(readFileSync(join(DATA, file), 'utf8'));
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await page.goto(`http://127.0.0.1:${port}/plan-studio/app/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__ps && window.__ps.store', null, { timeout: 30000 });
    for (const h of houses) {
      const r = await page.evaluate(async (proj) => {
        const ps = window.__ps;
        ps.store.replace(proj);
        const L = ps.store.project.levels[0];
        if (typeof ps.setView === 'function') ps.setView('3d');
        await new Promise((res) => setTimeout(res, 600));
        return { name: ps.store.project.name, walls: L.walls.length, rooms: L.rooms.length };
      }, h.project);
      if (r.walls !== h.project.levels[0].walls.length || r.rooms !== h.project.levels[0].rooms.length) errs.push(`${h.name}: loaded ${r.walls} walls ${r.rooms} rooms, file has ${h.project.levels[0].walls.length}/${h.project.levels[0].rooms.length}`);
      else loaded += 1;
      console.log(`  ${file.replace('.json', '')}: ${h.name} loaded (${r.walls} walls, ${r.rooms} rooms)`);
    }
    for (const e of errs) errors.push(`${file}: ${e}`);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
if (!errors.length && loaded) { console.log(`smoke-houses: PASS (${loaded} designs)`); process.exit(0); }
console.error('smoke-houses: FAIL\n' + errors.join('\n')); process.exit(1);
