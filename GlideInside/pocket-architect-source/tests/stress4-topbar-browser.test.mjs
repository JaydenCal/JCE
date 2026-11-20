import test from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, serve, launch, newPage, openApp, toStep, toEditor, dismiss } from './helpers/phone-harness.mjs';

test('stress4 top bar in the browser', { skip: SKIP, timeout: 900000 }, async (t) => {
  const { server, origin } = await serve();
  const browser = await launch();
  t.after(async () => { await browser.close(); server.close(); });

  await t.test('8. signed in top bar is one row with a 180 px name at 1440x900 and 1536x730', async () => {
    for (const [W, H, signed] of [[1280, 720, true], [1440, 900, true], [1536, 730, true], [1920, 1080, true]]) {
      const { ctx, page } = await newPage(browser, { width: W, height: H, phone: false, profile: signed });
      await openApp(page, origin);
      await toEditor(page);
      await page.waitForTimeout(1200);
      const r = await page.evaluate(() => {
        const tb = document.querySelector('.ps-topbar');
        const els = [...tb.querySelectorAll(':scope > *, :scope .psp-bar > *')].filter((e) => !e.hidden && e.offsetParent && !e.classList.contains('ps-topbar-spacer') && !e.classList.contains('psp-sr'));
        const cy = els.map((e) => e.getBoundingClientRect()).filter((q) => q.width && q.height).map((q) => q.top + q.height / 2);
        return { spread: Math.max(...cy) - Math.min(...cy), name: tb.querySelector('.ps-name').getBoundingClientRect().width, h: tb.getBoundingClientRect().height };
      });
      assert.ok(r.spread <= 14, `${W}: one row ${JSON.stringify(r)}`);
      assert.ok(r.name >= 175, `${W}: name ${r.name}`);
      assert.ok(await page.evaluate(() => { const u = document.querySelector('.psp-bar-slot'); return !u || !u.closest('.ps-more-pop'); }), `${W}: Unlock / Plan Pack stays on the bar`);
      assert.equal(await page.evaluate(() => !!document.querySelector('.ps-topbar .ps-prof-save') && !document.querySelector('.ps-more-pop .ps-prof-save') || !document.querySelector('.ps-prof-save')), true, `${W}: Save design stays on the bar`);
      // Settled: the bar does not keep re-laying itself out.
      const muts = await page.evaluate(() => new Promise((res) => { let n = 0; const mo = new MutationObserver((l) => { n += l.length; }); mo.observe(document.querySelector('.ps-topbar'), { childList: true, subtree: true, attributes: true }); setTimeout(() => { mo.disconnect(); res(n); }, 2000); }));
      assert.ok(muts <= 10, `${W} signed ${signed}: ${muts} top bar mutations in 2 s`);
      await ctx.close();
    }
  });
});
