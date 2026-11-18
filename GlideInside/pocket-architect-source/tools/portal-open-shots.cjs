const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = '/home/claude/wt-portal-fixes/GlideInside';
const OUT = '/home/claude/shots/claude-portal-fixes';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const portal = `${base}/website-live/portal/`, app = `${base}/website-live/plan-studio/app/`;
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { window.GI_CONFIG = Object.assign(window.GI_CONFIG || {}, { portalMock: true, portalEnabled: true }); });
  await ctx.route('**/site.config.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.GI_CONFIG = Object.assign(window.GI_CONFIG || {}, { portalMock: true, portalEnabled: true });' }));
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type()==='error') console.log('console', m.text()); }); page.on('response', (r) => { if (r.status()>=400) console.log(r.status(), r.url()); }); page.on('pageerror', (e) => console.log('pageerror', e.message));
  const shot = async (n) => { await page.getByRole('button',{name:'Plan',exact:true}).first().click().catch(()=>{}); await page.waitForTimeout(2500); await page.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }); const t = await page.evaluate(() => ({ flow: !!document.querySelector('.gf-overlay,[class*="gflow"],[data-ps="guided-flow"]'), text: document.body.innerText.slice(0, 200) })); console.log(n, JSON.stringify(t)); };
  await page.goto(portal); await page.waitForSelector('input[name=username]');
  await page.fill('input[name=username]', 'priya@samplehomes.example'); await page.fill('input[name=password]', 'river-maple-47'); await page.click('button[type=submit]'); await page.waitForTimeout(800);
  await page.goto(`${app}?house=h_banksia`, { waitUntil: 'domcontentloaded', timeout: 90000 }); await page.waitForSelector('.pas-strip', { timeout: 20000 }); await shot('1-saved-house-design-opens-in-editor');
  // client project: create as the builder through the mock api, then open it
  const id = await page.evaluate(async () => { const m = await import('/pocket-architect-source/src/portal/mock-api.js'); const t = await import('/pocket-architect-source/src/catalogue/templates.js'); const createMockApi = m.createMockApi, createFromTemplate = t.createFromTemplate; const api = createMockApi(); const p = createFromTemplate('house_double'); p.flow = { kind: 'residential', step: 2 }; const r = await api.saveProject({ name: 'Thornton home', project: p, lotAddress: 'Lot 14, 22 Banksia Rise, Thornton NSW 2322' }); return r.id; });
  await page.goto(`${app}?project=${id}`, { waitUntil: 'domcontentloaded', timeout: 90000 }); await page.waitForSelector('.pas-strip', { timeout: 20000 }); await shot('2-client-project-opens-in-editor');
  await page.goto(`${app}?design=1&project=${id}`, { waitUntil: 'domcontentloaded', timeout: 90000 }); await page.waitForSelector('.pas-strip', { timeout: 20000 }); await shot('3-open-as-client-view');
  await page.goto(`${app}?design=new`, { waitUntil: 'domcontentloaded', timeout: 90000 }); await page.waitForSelector('.pas-strip', { timeout: 20000 }); await shot('4-design-on-a-lot-new-keeps-guided-flow');
  await browser.close(); server.close();
})();
