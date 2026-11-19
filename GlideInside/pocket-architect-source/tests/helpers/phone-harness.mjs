// Browser harness for the phone tool tests: the built app and website served from ../website-live, with the real Worker API
// (memory store) behind /api. Lots come from ?sample=1 (no /api/site call needed). Skips cleanly without Playwright or Chrome.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SRC = path.resolve(here, '../..');
export const SITE = path.resolve(SRC, '../website-live');
let chromium = null;
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright').catch(() => import('/opt/npm-tools/node_modules/playwright/index.mjs'))); } catch { /* no playwright */ }
export const SKIP = !chromium || !fs.existsSync(path.join(SITE, 'plan-studio/app/index.html')) ? 'Playwright or the built app is not available' : false;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
export const ARGS = ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];

export async function serve() {
  const { createApp } = await import('../../server/lib/app.js');
  const { createMemoryStore } = await import('../../server/lib/store.js');
  let origin = '';
  const holder = {};
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, origin || 'http://127.0.0.1');
    try {
      if (u.pathname.startsWith('/api/')) {
        const ch = []; for await (const c of req) ch.push(c);
        const r = await holder.app.fetch(new Request(u, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(ch) }));
        const h = {}; r.headers.forEach((v, k) => { if (k !== 'set-cookie') h[k] = v; });
        const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : []; if (sc.length) h['set-cookie'] = sc;
        res.writeHead(r.status, h); return res.end(Buffer.from(await r.arrayBuffer()));
      }
      let p = decodeURIComponent(u.pathname);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(SITE, p);
      if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
    } catch (e) { res.writeHead(500); res.end(String(e?.message)); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  holder.app = createApp({ store: createMemoryStore(), env: { SITE_URL: origin, ENTITLEMENT_SECRET: 'x', PORTAL_ENABLED: '1', ADMIN_TOKEN: 'phone-test-admin-token-0123456789' } });
  return { server, origin };
}

export const launch = () => chromium.launch({ args: ARGS });

/** A page. `phone` gives a touch device (coarse pointer); otherwise a mouse window. `profile` stubs a signed in profile and the design save. */
export async function newPage(browser, { width, height, phone = true, profile = false, share = 'stub' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, ...(phone ? { hasTouch: true, isMobile: true } : {}) });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route('**/api/site/**', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'UPSTREAM', message: 'offline in tests' }) }));
  await ctx.route('**/api/projects', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'abc123', editKey: 'k', url: 'https://glideinside.com.au/plan-studio/app/?share=abc123', expiresAt: Date.now() + 86400000 }) }));
  await ctx.addInitScript((mode) => {
    window.__shared = [];
    if (mode === 'stub') { navigator.share = async (d) => { window.__shared.push(d); }; navigator.canShare = () => true; }
    if (mode === 'none') { try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); } catch { /* keep */ } window.__copied = []; try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied.push(t); } }, configurable: true }); } catch { /* keep */ } }
  }, share);
  if (profile) {
    const j = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    await ctx.route('**/api/profile/me', (r) => r.fulfill(j({ profile: { id: 'u1', name: 'Sam', email: 's@example.com', designLimit: 10 }, limits: { designs: 10 } })));
    await ctx.route('**/api/profile/designs', (r) => r.fulfill(r.request().method() === 'POST' ? j({ created: true, design: { id: 'd1', name: 'x' } }) : j({ designs: [] })));
  }
  const page = await ctx.newPage();
  page.errs = [];
  page.on('pageerror', (e) => page.errs.push(e.message));
  return { ctx, page };
}

export const appUrl = (origin, q = '?mode=residential&sample=1') => `${origin}/plan-studio/app/${q}`;
export async function openApp(page, origin, q) {
  await page.goto(appUrl(origin, q), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ps && window.__ps.store, null, { timeout: 60000 });
  await page.waitForTimeout(1800);
}
export async function dismiss(page) { for (const t of ['text=Skip tutorial', 'button:has-text("Not now")', 'text=Got it', 'text=Skip tips']) await page.click(t, { timeout: 250 }).catch(() => {}); }
/** From step 1 to a numbered step (2 to 4) with the first home chosen. */
export async function toStep(page, n) {
  const cur = Number(await page.evaluate(() => document.querySelector('.gf-root:not([hidden])')?.dataset.step || 1));
  for (let s = cur; s < n; s++) {
    if (s === 2) await page.locator('[data-ps=flow-home]').first().click();
    await page.click('[data-ps=flow-next]', { timeout: 15000 });
    await page.waitForTimeout(s === 3 ? 4500 : 2500);
    await dismiss(page);
  }
}
export async function toEditor(page) { await toStep(page, 4); await page.click('[data-ps=flow-next]'); await page.waitForTimeout(3500); await dismiss(page); }
