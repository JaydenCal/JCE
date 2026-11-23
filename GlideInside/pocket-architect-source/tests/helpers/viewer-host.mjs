// Browser helpers for the lot loading tests: Playwright, and a host page that holds the embedded viewer and records its gi: messages.
export let chromium = null;
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright').catch(() => import('/opt/npm-tools/node_modules/playwright/index.mjs'))); } catch { /* skipped below */ }
export const SKIP = chromium ? false : 'Playwright is not available';

export const HOST = '<!doctype html><meta charset=utf-8><body style="margin:0"><iframe id=f src="/plan-studio/app/?embed=1" style="width:100vw;height:100vh;border:0"></iframe><script>window.__M=[];addEventListener("message",e=>window.__M.push(e.data));</script>';

export async function viewerPage(browser, url, { w = 1280, h = 800, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: touch, hasTouch: touch });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage();
  await page.route('**/host.html', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: HOST }));
  await page.goto(url + '/host.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__M.some((m) => m.type === 'gi:ready'), null, { timeout: 60000 });
  const frame = page.frames().find((f) => f !== page.mainFrame());
  return { ctx, page, frame };
}
export const send = (page, address) => page.evaluate((a) => document.getElementById('f').contentWindow.postMessage({ type: 'gi:find-address', address: a }, location.origin), address);
// Record every label and aria-valuenow the bar shows, in the frame, from the moment it is called.
export const watchBar = (frame) => frame.evaluate(() => {
  window.__B = [];
  const note = () => { const b = document.querySelector('.ps-lp'); if (b) window.__B.push({ hidden: b.hidden, state: b.dataset.state, now: Number(b.getAttribute('aria-valuenow')), label: b.querySelector('.ps-lp-label')?.textContent }); };
  new MutationObserver(note).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
});

