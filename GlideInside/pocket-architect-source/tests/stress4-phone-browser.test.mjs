import test from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, serve, launch, newPage, openApp, toStep, toEditor, dismiss } from './helpers/phone-harness.mjs';

test('stress4 phone in the browser', { skip: SKIP, timeout: 900000 }, async (t) => {
  const { server, origin } = await serve();
  const browser = await launch();
  t.after(async () => { await browser.close(); server.close(); });

  await t.test('2+4+5. phone: sample and fail actions at 44 px, inline save offer, flow tap targets', async () => {
    const { ctx, page } = await newPage(browser, { width: 390, height: 844 });
    await openApp(page, origin, '?mode=residential');
    await dismiss(page);
    const hit = (sel) => page.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r && { w: r.width, h: r.height }; }, sel);
    const sample = await hit('[data-ps=flow-sample]');
    assert.ok(sample && sample.h >= 44 && sample.w > 100, `sample button shown: ${JSON.stringify(sample)}`);
    await page.fill('[data-ps=flow-address]', '12 Industrial Drive Westdale');
    await page.locator('[data-ps=flow-find]').tap();
    await page.waitForTimeout(4500);
    const fs2 = await hit('[data-ps=flow-fail-skip]');
    assert.ok(fs2 && fs2.h >= 44, `Keep drawing without a lot shown: ${JSON.stringify(fs2)}`);
    assert.ok(await hit('[data-ps=flow-fail-sample]'));
    await page.locator('[data-ps=flow-fail-sample]').tap();
    await page.waitForTimeout(2500);
    await toStep(page, 3);
    const prog = await page.evaluate(() => [...document.querySelectorAll('.gf-prog li button')].map((b) => { const r = b.getBoundingClientRect(); return [r.width, r.height]; }));
    assert.ok(prog.length >= 2 && prog.every(([w, h]) => w >= 43.5 && h >= 43.5), `progress buttons ${JSON.stringify(prog)}`);
    await toStep(page, 4);
    await page.waitForTimeout(2500);
    const o = await page.evaluate(() => {
      const p = document.querySelector('.ps-prof-prompt'); if (!p) return null;
      const q = p.getBoundingClientRect();
      const body = document.querySelector('.gf-root:not([hidden]) .gf-body').getBoundingClientRect();
      const cover = q.top < body.bottom - 1 && q.bottom > body.top ? 1 : 0; // the offer stands below the scrolling step, not over it
      const btns = [...p.querySelectorAll('button')].map((b) => { const r = b.getBoundingClientRect(); return [r.width, r.height]; });
      return { inFlow: !!p.closest('.gf-root'), pos: getComputedStyle(p).position, cover, btns };
    });
    if (o) {
      assert.ok(o.inFlow && o.pos !== 'fixed', JSON.stringify(o));
      assert.equal(o.cover, 0, 'the offer covers nothing');
      assert.ok(o.btns.every(([w, h]) => w >= 43.5 && h >= 43.5), JSON.stringify(o.btns));
    }
    await ctx.close();
  });

});
