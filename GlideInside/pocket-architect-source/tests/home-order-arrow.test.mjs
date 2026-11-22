// Home page (23/11/2026): the live 3D tool comes first and the how to video second, with a glass arrow under the viewer that points to the video.
// Static checks always run; the layout checks need Playwright (skipped when it is missing).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../website-live');
const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(SITE, 'framework.css'), 'utf8');

test('the live tool section comes before the how to video section, and the steps follow the video', () => {
  const iTry = html.indexOf('id="try"'); const iVid = html.indexOf('id="video"'); const iHow = html.indexOf('id="how"');
  assert.ok(iTry > 0 && iVid > 0 && iHow > 0);
  assert.ok(iTry < iVid && iVid < iHow, 'order: try, video, how');
  assert.ok(html.indexOf('class="cine') < iTry, 'the hero is first');
});

test('the arrow is a link to #video with an aria label, inside the tool section and after the viewer', () => {
  const sec = html.slice(html.indexOf('id="try"'), html.indexOf('id="video"'));
  const m = /<a class="vh-arrow" href="#video"[^>]*aria-label="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(sec);
  assert.ok(m, 'arrow link present in the tool section');
  assert.match(m[1], /how to/i);
  assert.match(m[2], /New here\? Watch the 80 second how to/);
  assert.ok(sec.indexOf('class="vh-arrow"') > sec.indexOf('id="live-tool"'), 'below the viewer, not inside it');
});

test('the arrow bobs only when motion is allowed, is translucent glass and has a visible keyboard focus', () => {
  assert.match(css, /@media\(prefers-reduced-motion:no-preference\)\{\.vid-hint \.vh-arrow svg\{animation:vh-bob/);
  assert.match(css, /\.vid-hint \.vh-arrow\{[^}]*backdrop-filter:blur/);
  assert.match(css, /\.vid-hint \.vh-arrow\{[^}]*background:rgba\(/);
  assert.match(css, /\.vid-hint \.vh-arrow:focus-visible\{outline/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\*\{[^}]*scroll-behavior:auto!important/, 'smooth scroll is switched off for reduced motion');
});

test('no hero or script link relies on the old order, and the new copy follows the text rules', () => {
  assert.ok(!/href="#try"/.test(html));
  const arrow = html.slice(html.indexOf('class="vid-hint"'), html.indexOf('</section>', html.indexOf('class="vid-hint"')));
  assert.ok(!/[–—]/.test(arrow) && !/compliant|Pocket Architect/i.test(arrow));
});

test('speed: no preload of the viewer poster, gtag is deferred, site.config.js does not block, critical css is inline', () => {
  assert.ok(!/rel="preload" as="image"/.test(html), 'the below the fold poster must not be preloaded');
  assert.match(html, /<script src="site\.config\.js[^"]*" defer>/);
  assert.match(html, /<style id="critical-css">/);
  assert.match(html, /<link rel="stylesheet" href="framework\.css\?v=[^"]+" media="print" onload="this\.media='all'">/);
  const an = fs.readFileSync(path.join(SITE, 'analytics.js'), 'utf8');
  assert.ok(!/document\.head\.appendChild\(s\);\s*\n\s*\}\s*\n\s*function send/.test(an), 'gtag is no longer appended straight away');
  assert.match(an, /requestIdleCallback\(loadGtag/);
  for (const f of ['assets/step-block-600.webp', 'assets/video-poster-residential.webp', 'assets/hero-builders-phone-800.webp']) assert.ok(fs.existsSync(path.join(SITE, f)), f);
});

let chromium = null;
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright').catch(() => import('/opt/npm-tools/node_modules/playwright/index.mjs'))); } catch { /* skipped below */ }
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.woff2': 'font/woff2' };
async function serve() {
  const srv = http.createServer((q, r) => { let p = path.join(SITE, decodeURIComponent(q.url.split('?')[0])); if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html'); if (!p.startsWith(SITE) || !fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok)); return { srv, url: `http://127.0.0.1:${srv.address().port}` };
}

for (const [name, w, h, touch] of [['desktop 1440x900', 1440, 900, false], ['laptop 1536x730', 1536, 730, false], ['phone 390x844', 390, 844, true], ['phone 360x780', 360, 780, true]]) {
  test(`layout, ${name}: the order holds, the arrow sits below the viewer, clear of it and of the video, and a click lands on the video`, { skip: chromium ? false : 'Playwright is not available', timeout: 90000 }, async () => {
    const { srv, url } = await serve(); const browser = await chromium.launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: touch, hasTouch: touch, reducedMotion: 'reduce' });
      const page = await ctx.newPage(); await page.route(/googletagmanager|fonts\.g/, (r) => r.abort());
      await page.goto(url + '/', { waitUntil: 'load' }); await page.waitForTimeout(800);
      const g = await page.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top + scrollY, bottom: b.bottom + scrollY, left: b.left, right: b.right, w: b.width, h: b.height }; };
        return { tool: r('#live-tool'), arrow: r('.vh-arrow'), video: r('#video'), videoEl: r('#video video'), cap: r('.stage-cap'), vw: innerWidth, sw: document.documentElement.scrollWidth, handoff: getComputedStyle(document.querySelector('[data-handoff]')).display, try: r('#try') }; });
      assert.ok(g.tool.top < g.video.top, 'tool above video');
      assert.ok(g.arrow.top >= g.tool.bottom - 1, 'arrow is below the viewer frame');
      assert.ok(g.arrow.top >= g.cap.bottom - 1, 'arrow is below the caption');
      assert.ok(g.arrow.bottom <= g.video.top + 1, 'arrow is above the video section');
      assert.ok(g.arrow.left >= 0 && g.arrow.right <= g.vw, 'arrow is inside the viewport width');
      assert.ok(g.arrow.h >= 44, 'a 44 px touch target at least');
      assert.ok(g.sw <= g.vw + 1, 'no sideways scroll');
      assert.equal(g.handoff, touch ? 'block' : 'none', 'the phone card shows on phones only');
      await page.focus('.vh-arrow'); await page.keyboard.press('Enter'); await page.waitForTimeout(600);
      const y = await page.evaluate(() => scrollY); const vt = await page.evaluate(() => document.querySelector('#video').getBoundingClientRect().top);
      assert.ok(y > 0 && vt < h * 0.6, `the video section is brought into view (top ${Math.round(vt)})`);
    } finally { await browser.close(); srv.close(); }
  });
}
