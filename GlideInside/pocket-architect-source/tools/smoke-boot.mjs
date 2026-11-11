// Boot smoke test: serves website-live statically, loads plan-studio/app/ in Chromium and asserts the app boots
// (the .ps-boot placeholder disappears within 15 s) with no page errors.   node tools/smoke-boot.mjs [--page /plan-studio/app/]
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, join, dirname } from 'node:path';
import { createRequire } from 'node:module';

const here = dirname(new URL(import.meta.url).pathname);
const ROOT = resolve(here, '../../website-live');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require.resolve('playwright', { paths: ['/opt/npm-tools/node_modules', process.env.NODE_PATH || ''] }))); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const pageArg = process.argv.indexOf('--page');
const pagePath = pageArg > 0 ? process.argv[pageArg + 1] : '/plan-studio/app/';

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
const browser = await chromium.launch();
let ok = false;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  // External fonts and map tiles are not reachable offline; only script and page errors count.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.goto(`http://127.0.0.1:${port}${pagePath}`, { waitUntil: 'domcontentloaded' });
  try { await page.waitForSelector('.ps-boot', { state: 'detached', timeout: 15000 }); ok = true; } catch { errors.push('.ps-boot still present after 15 s'); }
  if (ok) { await page.waitForTimeout(1500); if (!(await page.locator('#app *').count())) { ok = false; errors.push('#app is empty'); } }
} finally { await browser.close(); server.close(); }
if (ok && !errors.length) { console.log('smoke-boot: PASS'); process.exit(0); }
console.error('smoke-boot: FAIL\n' + errors.join('\n')); process.exit(1);
