import test from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, serve, launch, newPage, openApp, toStep, toEditor, dismiss } from './helpers/phone-harness.mjs';

test('stress4 dialogs in the browser', { skip: SKIP, timeout: 900000 }, async (t) => {
  const { server, origin } = await serve();
  const browser = await launch();
  t.after(async () => { await browser.close(); server.close(); });

  await t.test('1. the New design dialog fits 1440x900, 1536x730, 390x844 and 360x780 and a scrim tap closes it', async () => {
    for (const [W, H, phone] of [[1440, 900, false], [1536, 730, false], [390, 844, true], [360, 780, true]]) {
      const { ctx, page } = await newPage(browser, { width: W, height: H, phone });
      await openApp(page, origin);
      await toEditor(page);
      await page.evaluate(() => document.querySelector('button[aria-label="New design from a template"]').click());
      await page.waitForTimeout(800);
      const r = await page.evaluate(() => {
        const d = [...document.querySelectorAll('.ps-modal')].pop();
        const q = d.getBoundingClientRect(); const b = d.querySelector('.ps-modal-body');
        return { top: q.top, bottom: q.bottom, left: q.left, right: q.right, ih: innerHeight, iw: innerWidth, scroll: b.scrollHeight > b.clientHeight, ov: getComputedStyle(b).overflowY, cards: d.querySelectorAll('.ps-card').length };
      });
      assert.ok(r.cards >= 15, `${W}: cards`);
      assert.ok(r.top >= 0 && r.bottom <= r.ih + 1 && r.left >= 0 && r.right <= r.iw + 1, `${W}x${H}: dialog on screen ${JSON.stringify(r)}`);
      assert.equal(r.ov, 'auto');
      await page.mouse.click(W / 2, 3);
      await page.waitForTimeout(300);
      assert.equal(await page.locator('.ps-modal').count(), 0, `${W}: scrim tap closes`);
      await ctx.close();
    }
  });

});
