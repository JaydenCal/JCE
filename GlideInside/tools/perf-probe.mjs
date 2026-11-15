// Local performance probe for the static marketing pages (SEO-008).
// Set DESKTOP=1 for a 1350x940 desktop profile with no CPU throttle (Lighthouse desktop style).
// Set SCROLL=1 to scroll the live viewer section into view (this is what starts the 3D app on the old pages).
// Usage: node tools/perf-probe.mjs <baseUrl> <label> <outJson> [paths...]
// Needs playwright (found via NODE_PATH style lookup below) and a Chromium. Mobile emulation, 4x CPU throttle,
// slow 4G style network. Reports LCP element, FCP, CLS, long tasks (TBT estimate), render blocking resources,
// transfer weight and JS self time by script (CDP Profiler) so the 3D viewer is not blamed without evidence.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const [base, label, out, ...paths] = process.argv.slice(2);
const pages = paths.length ? paths : ['/', '/3d-floor-plan-maker/', '/granny-flat-designs/', '/plans/', '/commercial/', '/for-builders/'];
const DESK = process.env.DESKTOP === '1';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const results = [];
for (const p of pages) {
  const ctx = await browser.newContext(DESK ? { viewport: { width: 1350, height: 940 }, deviceScaleFactor: 1 } : { viewport: { width: 412, height: 823 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 11; Moto G Power) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: DESK ? 1 : 4 });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: DESK ? 40 : 150, downloadThroughput: (DESK ? 10 : 1.6) * 1024 * 1024 / 8, uploadThroughput: (DESK ? 10 : 0.75) * 1024 * 1024 / 8 });
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await page.addInitScript(() => {
    window.__m = { lcp: null, cls: 0, tasks: [], fcp: null };
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__m.lcp = { t: Math.round(e.startTime), url: e.url || '', tag: e.element ? e.element.tagName.toLowerCase() + (e.element.className && typeof e.element.className === 'string' ? '.' + e.element.className.split(' ')[0] : '') : '', size: e.size }; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__m.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__m.tasks.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__m.fcp = Math.round(e.startTime); }).observe({ type: 'paint', buffered: true });
  });
  const reqs = [];
  page.on('response', async r => { try { const h = r.headers(); reqs.push({ url: r.url(), status: r.status(), type: r.request().resourceType(), len: Number(h['content-length'] || 0) }); } catch {} });
  await cdp.send('Profiler.start');
  const t0 = Date.now();
  await page.goto(base + p, { waitUntil: 'load', timeout: 120000 });
  if (process.env.SCROLL) await page.evaluate(() => { const t = document.querySelector('#try, #live-tool'); if (t) t.scrollIntoView(); });
  await page.waitForTimeout(process.env.SCROLL ? 9000 : 4000);
  const prof = (await cdp.send('Profiler.stop')).profile;
  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const rb = performance.getEntriesByType('resource').filter(r => r.renderBlockingStatus === 'blocking').map(r => r.name.replace(location.origin, ''));
    const imgs = [...document.images].map(i => ({ src: i.currentSrc.replace(location.origin, ''), lazy: i.loading, w: i.width, h: i.height, hasDims: !!(i.getAttribute('width') && i.getAttribute('height')) }));
    return { ...window.__m, dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), renderBlocking: rb, imgCount: imgs.length, iframes: [...document.querySelectorAll('iframe')].map(f => f.src || f.dataset.src || '(none)'), videos: [...document.querySelectorAll('video')].map(v => ({ autoplay: v.autoplay, preload: v.preload, poster: !!v.poster })), canvases: document.querySelectorAll('canvas').length };
  });
  // JS self time by script from the CPU profile
  const byUrl = {}; const nodes = new Map(prof.nodes.map(n => [n.id, n]));
  const dt = prof.timeDeltas; let i = 0;
  for (const id of prof.samples) { const n = nodes.get(id); const u = (n.callFrame.url || '(' + n.callFrame.functionName + ')').replace(/^https?:\/\/[^/]+/, '') || '(native)'; byUrl[u] = (byUrl[u] || 0) + (dt[i++] || 0) / 1000; }
  const js = Object.entries(byUrl).filter(([u]) => u !== '(program)' && u !== '(idle)' && u !== '(garbage collector)' && u !== '(root)').sort((a, b) => b[1] - a[1]).slice(0, 6).map(([u, ms]) => [u, Math.round(ms * 10) / 10]);
  const tbt = m.tasks.reduce((a, [s, d]) => a + Math.max(0, d - 50), 0);
  const bytes = { total: reqs.reduce((a, r) => a + r.len, 0), js: 0, img: 0, css: 0, font: 0, media: 0 };
  for (const r of reqs) { const k = { script: 'js', image: 'img', stylesheet: 'css', font: 'font', media: 'media' }[r.type]; if (k) bytes[k] += r.len; }
  results.push({ path: p, fcp: m.fcp, lcp: m.lcp, cls: Math.round(m.cls * 1000) / 1000, tbtEstimate: tbt, longTasks: m.tasks.length, dcl: m.dcl, load: m.load, requests: reqs.length, failed: reqs.filter(r => r.status >= 400).length, bytes, renderBlocking: m.renderBlocking, iframes: m.iframes, videos: m.videos, canvases: m.canvases, topJsSelfMs: js });
  await ctx.close();
}
await browser.close();
fs.writeFileSync(out, JSON.stringify({ label, base, when: new Date().toISOString(), results }, null, 1));
for (const r of results) console.log(label, r.path, 'FCP', r.fcp, 'LCP', r.lcp?.t, r.lcp?.tag, r.lcp?.url?.replace(/^https?:\/\/[^/]+/, ''), 'CLS', r.cls, 'TBT~', r.tbtEstimate, 'reqs', r.requests, 'KB', Math.round(r.bytes.total / 1024));
