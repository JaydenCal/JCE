// Local check of the static site security headers (SECURITY-HEADERS.md at the repo root).
//
//   node tools/csp-check.mjs [--control]
//
// Serves ../website-live from a small static server that sends EXACTLY the header values written in SECURITY-HEADERS.md (the two ```headers blocks:
// rule 1 for the whole site, rule 2 for /portal/), opens every page and the app in headless Chrome through Playwright, clicks through the app, and
// fails on any Content-Security-Policy violation (securitypolicyviolation events and the browser's "Refused to ..." console errors).
// It also prints every external host the pages tried to reach, which is the source inventory the policy is built from.
// --control serves a deliberately strict policy instead and must report violations (it proves the detector works).
//
// Needs Playwright and Chrome (not part of the node:test suite). PLAYWRIGHT_MODULE overrides where Playwright is imported from.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, '../../website-live');
const DOC = path.resolve(here, '../../../SECURITY-HEADERS.md');
const control = process.argv.includes('--control');

function readRules() {
  const md = fs.readFileSync(DOC, 'utf8');
  const blocks = [...md.matchAll(/```headers\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (blocks.length < 2) throw new Error('SECURITY-HEADERS.md needs two ```headers blocks (rule 1 and rule 2)');
  const parse = (b) => Object.fromEntries(b.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]));
  return { site: parse(blocks[0]), portal: parse(blocks[1]) };
}
const rules = control ? { site: { 'Content-Security-Policy': "default-src 'none'" }, portal: { 'Content-Security-Policy': "default-src 'none'" } } : readRules();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain', '.xml': 'application/xml', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = decodeURIComponent(u.pathname);
  if (p.startsWith('/api/')) {
    // The Worker answers /api/ with its own headers (Transform Rules must not touch it); the static check has no Worker, so answer 404 JSON.
    res.writeHead(404, { 'content-type': 'application/json', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" });
    return res.end('{"error":{"code":"NOT_FOUND"}}');
  }
  let f = path.join(SITE, p);
  if (!f.startsWith(SITE)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
  const hdr = p.startsWith('/portal/') ? rules.portal : rules.site;
  res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', ...hdr });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('_review')) continue;
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (e.name.endsWith('.html')) out.push('/' + path.relative(SITE, f).split(path.sep).join('/'));
  }
  return out;
};
const pages = walk(SITE).sort();
const extra = ['/plan-studio/app/?embed=1', '/plan-studio/app/?embed=1&mode=commercial', '/portal/?client=1', '/for-builders/#trial'];

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright').catch(() => import('/opt/npm-tools/node_modules/playwright/index.mjs'));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const external = new Map();
const violations = [];

// Stand-ins for the third party hosts: the request is made (so a CSP that does not allow the host is reported), nothing leaves the machine.
await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
  const url = new URL(route.request().url());
  external.set(url.host, (external.get(url.host) || 0) + 1);
  if (url.host === 'www.googletagmanager.com') {
    // A stub gtag.js that does what the real one does: beacons to the analytics hosts with an image and fetch calls.
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: "(function(){var i=new Image();i.src='https://www.google-analytics.com/g/collect?v=2';fetch('https://region1.google-analytics.com/g/collect',{method:'POST',mode:'no-cors'}).catch(function(){});fetch('https://www.google-analytics.com/g/collect',{method:'POST',mode:'no-cors'}).catch(function(){});})();" });
  }
  if (/\.css|css2/.test(url.pathname + url.search) && url.host === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: '/* stub */' });
  return route.fulfill({ status: 204, body: '' });
});

const record = (where) => (v) => violations.push({ where, ...v });
async function open(url) {
  const page = await context.newPage();
  await page.exposeFunction('__cspViolation', (v) => record(url)(v));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => window.__cspViolation({ directive: e.violatedDirective, blocked: e.blockedURI, source: e.sourceFile || '', line: e.lineNumber || 0 }));
  });
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) record(url)({ directive: 'console', blocked: m.text().slice(0, 240) });
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
  await page.goto(base + url, { waitUntil: 'load', timeout: 45000 }).catch((e) => errors.push('goto: ' + e.message.slice(0, 100)));
  await page.waitForTimeout(1500).catch(() => null);
  return { page, errors };
}

for (const url of [...pages, ...extra]) {
  const { page, errors } = await open(url);
  // Scroll so lazy iframes and images load, and let the embedded 3D viewers start.
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); }).catch(() => null);
  await page.waitForTimeout(1200).catch(() => null);
  console.log(`page ${url}${errors.length ? `  (page errors: ${errors.slice(0, 2).join(' | ')})` : ''}`);
  await page.close().catch(() => null);
}

// The app: open it and click through the visible controls (each click is followed by Escape so dialogs close).
{
  const { page } = await open('/plan-studio/app/');
  await page.waitForTimeout(2500);
  const total = 90;
  for (let i = 0; i < total; i += 1) {
    const buttons = await page.$$('button:visible, [role="tab"]:visible, [role="button"]:visible, summary:visible');
    if (!buttons.length) break;
    const b = buttons[i % buttons.length];
    const label = ((await b.innerText().catch(() => '')) || (await b.getAttribute('aria-label').catch(() => '')) || '').trim().slice(0, 40);
    if (/delete|remove|clear all|sign out|reset/i.test(label)) continue;
    await b.click({ timeout: 1500, trial: false }).catch(() => null);
    await page.waitForTimeout(250);
    await page.keyboard.press('Escape').catch(() => null);
    if (page.url().startsWith('http') && !page.url().startsWith(base)) await page.goBack().catch(() => null);
  }
  // Third party hosts the app and site use: the same requests their scripts make, so a missing allowance is reported here.
  await page.evaluate(async () => {
    await fetch('https://api.mapbox.com/v4/mapbox.satellite/1/0/0@2x.jpg90?access_token=pk.test').catch(() => null);
    await fetch('https://api.mapbox.com/geocoding/v5/mapbox.places/test.json?access_token=pk.test').catch(() => null);
    const i = new Image(); i.src = 'https://api.mapbox.com/v4/mapbox.satellite/1/0/0@2x.jpg90?access_token=pk.test';
    const w = new Worker(URL.createObjectURL(new Blob(['postMessage(1)'], { type: 'text/javascript' }))); w.terminate();
    const b = URL.createObjectURL(new Blob(['x'])); await fetch(b).catch(() => null);
  }).catch(() => null);
  await page.waitForTimeout(1500);
  console.log('page /plan-studio/app/ (clicked through the visible controls)');
  await page.close();
}

await browser.close();
server.close();

console.log('\nExternal hosts requested (allowed by the policy; stubbed locally):');
for (const [h, n] of [...external].sort()) console.log(`  ${h}  x${n}`);
const uniq = [...new Map(violations.map((v) => [`${v.where}|${v.directive}|${v.blocked}`, v])).values()];
console.log(`\nCSP violations: ${uniq.length}`);
for (const v of uniq.slice(0, 40)) console.log(`  ${v.where}  [${v.directive}]  ${v.blocked}${v.source ? `  (${v.source}:${v.line})` : ''}`);
if (control) {
  if (!uniq.length) { console.error('CONTROL FAILED: a deliberately strict policy reported no violations, so the detector is not working.'); process.exit(1); }
  console.log('Control run: violations were detected as expected.');
  process.exit(0);
}
process.exit(uniq.length ? 1 : 0);
