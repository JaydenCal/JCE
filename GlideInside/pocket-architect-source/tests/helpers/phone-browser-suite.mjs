// The phone tool in a real browser. Split by group so each test file stays well inside the per file time limit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, serve, launch, newPage, openApp, toStep, toEditor, dismiss } from './phone-harness.mjs';

// ---------------------------------------------------------------------------------------------- browser
const SIZES = [[360, 780], [390, 844], [430, 932]];
export function phoneBrowserSuite(GROUP) {
test(`phone mode in the browser (${GROUP})`, { skip: SKIP, timeout: 900000 }, async (t) => {
  const sub = (g, name, fn) => (g === GROUP ? t.test(name, fn) : null);
  const { server, origin } = await serve();
  const browser = await launch();
  t.after(async () => { await browser.close(); server.close(); });
  const phoneFlag = (p) => p.evaluate(() => document.documentElement.dataset.phone);

  await sub('a', 'detection: touch and narrow is phone mode; a mouse window, a wide touch window and Desktop view are not', async () => {
    const a = await newPage(browser, { width: 390, height: 844 });
    await openApp(a.page, origin);
    assert.equal(await phoneFlag(a.page), '1');
    assert.equal(await a.page.evaluate(() => !!document.querySelector('.gf-menu') && getComputedStyle(document.querySelector('.gf-menu')).display !== 'none'), true, 'the flow menu button shows');
    // Desktop view from the menu
    await a.page.click('[data-ps=flow-menu]');
    await a.page.click('[data-ps=flow-menu-desktop]');
    await a.page.waitForTimeout(400);
    assert.equal(await phoneFlag(a.page), '0');
    assert.equal(await a.page.evaluate((k) => localStorage.getItem(k), 'ps.desktopView'), '1');
    assert.match(await a.page.evaluate(() => document.querySelector('meta[name=viewport]').content), /width=1100/);
    await a.ctx.close();
    const m = await newPage(browser, { width: 390, height: 844, phone: false });
    await openApp(m.page, origin);
    assert.equal(await phoneFlag(m.page), '0', 'a narrow mouse window keeps the desktop layout');
    await m.ctx.close();
    const w = await newPage(browser, { width: 1024, height: 800, phone: true });
    await openApp(w.page, origin);
    assert.equal(await phoneFlag(w.page), '0', 'a wide touch screen is not a phone');
    await w.ctx.close();
  });

  for (const [W, H] of SIZES) {
    await sub(W === 360 ? 'b' : W === 390 ? 'c' : 'd', `${W}x${H}: bottom action bar, 44 px targets and no sideways scrolling through the flow`, async () => {
      const { ctx, page } = await newPage(browser, { width: W, height: H });
      await openApp(page, origin);
      const check = async (label) => {
        const r = await page.evaluate(() => {
          const foot = document.querySelector('.gf-root:not([hidden]) .gf-foot')?.getBoundingClientRect();
          const btns = [...document.querySelectorAll('.gf-root:not([hidden]) .gf-foot .gf-btn')].map((b) => b.getBoundingClientRect());
          const body = document.querySelector('.gf-root:not([hidden]) .gf-body');
          return { foot: foot && { bottom: foot.bottom, h: foot.height }, minH: Math.min(...btns.map((b) => b.height)), minW: Math.min(...btns.map((b) => b.width)), vh: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth, bodyOver: body.scrollWidth - body.clientWidth };
        });
        assert.ok(r.foot, `${label}: the bar exists`);
        assert.ok(Math.abs(r.foot.bottom - r.vh) <= 1, `${label}: the action bar is stuck to the bottom (${r.foot.bottom} vs ${r.vh})`);
        assert.ok(r.minH >= 44 && r.minW >= 44, `${label}: buttons are at least 44 px (${r.minW} x ${r.minH})`);
        assert.ok(r.sw <= r.iw, `${label}: page overflows sideways (${r.sw} > ${r.iw})`);
        assert.ok(r.bodyOver <= 0, `${label}: the step overflows sideways by ${r.bodyOver}`);
      };
      await check('step 1');
      await toStep(page, 2); await check('step 2');
      await toStep(page, 3); await check('step 3');
      // the one line status and the big controls
      const s3 = await page.evaluate(() => ({ status: document.querySelector('[data-ps=flow-place-status]').getBoundingClientRect().height, ctl: [...document.querySelectorAll('[data-ps=flow-phone-controls] button')].map((b) => { const r = b.getBoundingClientRect(); return [r.width, r.height]; }) }));
      assert.ok(s3.status < 70, `the setback status is a short line (${s3.status})`);
      assert.equal(s3.ctl.length, 6);
      for (const [w, h] of s3.ctl) assert.ok(w >= 44 && h >= 44, `nudge and turn buttons are big (${w} x ${h})`);
      await toStep(page, 4); await check('step 4');
      assert.equal(await page.locator('[data-ps=flow-view-toggle] button').count(), 2, 'plan and 3D toggle');
      await page.click('[data-ps=flow-view-plan]');
      assert.equal(await page.evaluate(() => !document.querySelector('[data-ps=flow-plan-view]').hidden && document.querySelector('[data-ps=flow-3d]').hidden), true);
      await check('step 4 plan');
      assert.deepEqual(page.errs.filter((e) => !/401|WebGL|GPU/i.test(e)), []);
      await ctx.close();
    });

    await sub(W === 360 ? 'b' : W === 390 ? 'c' : 'd', `${W}x${H}: the phone editor has the dock, the reduced top bar, sheets, and no sideways scrolling`, async () => {
      const { ctx, page } = await newPage(browser, { width: W, height: H });
      await openApp(page, origin);
      await toEditor(page);
      const r = await page.evaluate(() => {
        const rect = (s) => document.querySelector(s)?.getBoundingClientRect();
        const vis = (s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; };
        return { dock: rect('[data-ps=phone-dock]'), vh: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth, toolbox: vis('.ps-toolbox'), viewSwitch: vis('.ps-view-switch'), back: vis('.ps-back'), name: vis('.ps-name'), undo: vis('.ps-group button'), save: vis('[data-action="profile-save"]'),
          dockBtns: [...document.querySelectorAll('.ps-dock-btn')].map((b) => b.getBoundingClientRect().height), topbarH: rect('.ps-topbar').height };
      });
      assert.ok(Math.abs(r.dock.bottom - r.vh) <= 1, 'the dock is at the bottom');
      assert.ok(r.dockBtns.every((h) => h >= 44), 'dock buttons are 44 px or more');
      assert.equal(r.toolbox, false, 'the desktop toolbox is not shown');
      assert.equal(r.viewSwitch, false, 'the view switch moves to the dock');
      assert.ok(r.back && r.name && r.undo && r.save, 'top bar has Back, the name, undo and Save design');
      assert.ok(r.sw <= r.iw, 'no sideways scroll in the editor');
      // tools sheet
      await page.click('[data-ps=dock-tools]');
      for (const id of ['movehouse', 'rotate', 'room', 'drivepi', 'furniture']) assert.equal(await page.locator(`[data-ps=tool-${id}]`).count(), 1, `tool ${id} is in the sheet`);
      await page.click('[data-ps=tool-room]');
      assert.equal(await page.evaluate(() => window.__ps.store.ui.tool), 'room');
      assert.equal(await page.locator('[data-ps=tools-sheet]').count(), 0, 'choosing a tool closes the sheet');
      // quick bar for Move house
      await page.evaluate(() => window.__ps.setTool('movehouse'));
      await page.waitForTimeout(300);
      assert.equal(await page.locator('[data-ps=phone-quick]').isVisible(), true);
      // properties as a bottom sheet
      await page.click('[data-ps=dock-details]');
      const p = await page.evaluate(() => { const b = document.querySelector('.ps-panel').getBoundingClientRect(); return { l: b.left, r: b.right, vw: innerWidth, bottomGap: innerHeight - b.bottom }; });
      assert.ok(p.l >= 0 && p.r <= p.vw + 1, 'the details sheet fits the width');
      await page.click('[data-ps=dock-details]');
      // menu sheet with Desktop view
      await page.click('[data-ps=dock-menu]');
      assert.equal(await page.locator('[data-ps=desktop-view]').isVisible(), true);
      const m = await page.evaluate(() => { const b = document.querySelector('.ps-more-pop').getBoundingClientRect(); return { l: b.left, r: b.right, vw: innerWidth }; });
      assert.ok(m.l >= 0 && m.r <= m.vw + 1, 'the menu sheet fits the width');
      await page.mouse.click(W / 2, 80);
      // 3D and back
      await page.click('[data-ps=dock-view]');
      await page.waitForTimeout(3500);
      assert.equal(await page.evaluate(() => window.__ps.store.ui.view), '3d');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll in 3D');
      assert.equal(await page.evaluate(() => document.querySelector('canvas.ps3d-canvas')?.dataset.perf), 'phone', '3D runs in the lighter phone profile');
      assert.ok(Number(await page.evaluate(() => document.querySelector('canvas.ps3d-canvas')?.dataset.pixelRatio)) <= 1.5, 'lower pixel ratio on a phone');
      await ctx.close();
    });
  }

  await sub('a', 'two finger twist turns the home on step 3', async () => {
    const { ctx, page } = await newPage(browser, { width: 390, height: 844 });
    await openApp(page, origin);
    await toStep(page, 3);
    const rot = () => page.evaluate(() => { const w = window.__ps.store.project.levels[0].walls[0]; return Math.round((Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 180) / Math.PI); });
    const r0 = await rot();
    const box = await page.locator('[data-ps=flow-stage]').boundingBox();
    const cx = box.x + 110, cy = box.y + box.height / 2, R = 60;
    const cdp = await ctx.newCDPSession(page);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i })) });
    const at = (a) => [[cx + R * Math.cos(a), cy + R * Math.sin(a)], [cx - R * Math.cos(a), cy - R * Math.sin(a)]];
    await T('touchStart', at(0));
    for (let i = 1; i <= 12; i++) { await T('touchMove', at((i * Math.PI) / 36)); await page.waitForTimeout(30); }
    await T('touchEnd', []);
    await page.waitForTimeout(500);
    assert.equal(((await rot()) - r0 + 360) % 360, 60, 'a 60 degree twist turns the home 60 degrees');
    // a plain two finger pinch (no twist) does not turn it
    const r1 = await rot();
    const sp = (k) => [[cx - k, cy], [cx + k, cy]];
    await T('touchStart', sp(30));
    for (let i = 1; i <= 8; i++) { await T('touchMove', sp(30 + i * 6)); await page.waitForTimeout(30); }
    await T('touchEnd', []);
    await page.waitForTimeout(400);
    assert.equal(await rot(), r1, 'pinching does not turn the home');
    await ctx.close();
  });

  await sub('e', 'Share appears after saving and uses the share sheet; without one it copies the link', async () => {
    for (const mode of ['stub', 'none']) {
      const { ctx, page } = await newPage(browser, { width: 390, height: 844, profile: true, share: mode });
      await openApp(page, origin);
      await page.waitForFunction(() => window.__ps.profiles?.controller?.state?.status === 'in', null, { timeout: 20000 });
      await page.click('[data-ps=flow-menu]');
      assert.equal(await page.locator('[data-ps=flow-menu-share]').count(), 0, 'no Share before the design is saved');
      await page.click('[data-ps=flow-menu-save]');
      await page.waitForFunction(() => window.__ps.profiles.controller.state.saveState === 'saved', null, { timeout: 20000 });
      await page.waitForTimeout(500);
      await page.click('[data-ps=flow-menu]');
      assert.equal(await page.locator('[data-ps=flow-menu-share]').count(), 1, 'Share is offered once saved');
      await page.click('[data-ps=flow-menu-share]');
      if (mode === 'stub') {
        await page.waitForFunction(() => window.__shared.length === 1, null, { timeout: 15000 });
        const d = await page.evaluate(() => window.__shared[0]);
        assert.match(d.url, /[?&]share=/);
        assert.ok(!/[–—]/.test(d.title + d.text));
      } else {
        await page.waitForFunction(() => window.__copied.length === 1, null, { timeout: 15000 });
        assert.match(await page.evaluate(() => window.__copied[0]), /[?&]share=/);
      }
      await ctx.close();
    }
  });

  await sub('e', 'Share button sits beside Save design in the editor once saved', async () => {
    const { ctx, page } = await newPage(browser, { width: 390, height: 844, profile: true });
    await openApp(page, origin);
    await page.waitForFunction(() => window.__ps.profiles?.controller?.state?.status === 'in', null, { timeout: 20000 });
    await toEditor(page);
    const shown = () => page.evaluate(() => ({ saved: window.__ps.profiles.controller.state.saveState === 'saved', vis: !document.querySelector('[data-ps=phone-share]').hidden }));
    const b0 = await shown(); assert.equal(b0.vis, b0.saved, 'Share shows only while the design is saved');
    await page.click('[data-action="profile-save"]');
    await page.waitForFunction(() => window.__ps.profiles.controller.state.saveState === 'saved', null, { timeout: 20000 });
    await page.waitForTimeout(400);
    assert.equal(await page.locator('[data-ps=phone-share]').isVisible(), true);
    const box = await page.locator('[data-ps=phone-share]').boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44 && box.x + box.width <= 390);
    await ctx.close();
  });

  // The three fixes hold on any window, phone or not.
  await sub('f', 'Back to plan never overlaps Edit room, at every width and in 3D and split views', async () => {
    const { ctx, page } = await newPage(browser, { width: 1440, height: 900, phone: false });
    await openApp(page, origin, '?mode=residential&sample=1&flow=0');
    for (const view of ['3d', 'split']) {
      await page.evaluate((v) => window.__ps.store.setUI({ view: v }), view);
      await page.waitForSelector('.ps3d-editbar .ps3d-edit', { timeout: 30000, state: 'attached' });
      for (const w of [320, 360, 390, 430, 600, 768, 900, 1100, 1440]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.waitForTimeout(250);
        const r = await page.evaluate(() => {
          const back = document.querySelector('.ps-backplan');
          if (!back || back.hidden) return null;
          const b = back.getBoundingClientRect();
          const hits = [...document.querySelectorAll('.ps3d-editbar button, .ps3d-editbar .ps3d-edit')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.getBoundingClientRect()).filter((e) => !(e.right <= b.left || e.left >= b.right || e.bottom <= b.top || e.top >= b.bottom));
          return { overlaps: hits.length, back: [b.left, b.top, b.right, b.bottom] };
        });
        if (r) assert.equal(r.overlaps, 0, `${view} at ${w}: Back to plan overlaps the edit buttons ${JSON.stringify(r.back)}`);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    await ctx.close();
  });

  await sub('g', 'the room buttons row wraps on a phone: nothing runs past the edge', async () => {
    for (const [W, H] of SIZES) {
      const { ctx, page } = await newPage(browser, { width: W, height: H });
      await openApp(page, origin);
      await toEditor(page);
      await page.evaluate(() => window.__ps.store.setUI({ view: '3d' }));
      await page.waitForSelector('[data-ps=lc-tabs-compact] .lc-tab', { timeout: 30000, state: 'attached' });
      await page.waitForTimeout(800);
      const r = await page.evaluate(() => { const t = document.querySelector('[data-ps=lc-tabs-compact]'); const p = t.closest('.lc-rooms').getBoundingClientRect(); const tabs = [...t.querySelectorAll('.lc-tab')].map((b) => b.getBoundingClientRect()); return { scroll: t.scrollWidth - t.clientWidth, count: tabs.length, maxRight: Math.max(...tabs.map((b) => b.right)), panelRight: p.right, vw: innerWidth, rows: new Set(tabs.map((b) => Math.round(b.top))).size }; });
      assert.ok(r.count >= 3, 'the rooms are listed');
      assert.ok(r.scroll <= 0, `${W}: the row does not scroll sideways`);
      assert.ok(r.maxRight <= r.panelRight + 1 && r.maxRight <= r.vw, `${W}: every room button is inside the panel`);
      assert.ok(r.rows >= 2, `${W}: the buttons wrap onto rows`);
      await ctx.close();
    }
  });

  await sub('h', 'status bar help line: short touch wording on a phone (never cut off), unchanged on desktop', async () => {
    for (const [W, H] of SIZES) {
      const { ctx, page } = await newPage(browser, { width: W, height: H });
      await openApp(page, origin);
      await toEditor(page);
      await page.evaluate(() => window.__ps.setTool('movehouse'));
      await page.waitForTimeout(400);
      const r = await page.evaluate(() => { const h = document.querySelector('.ps-status-hint'); const b = h.getBoundingClientRect(); return { text: h.textContent, over: h.scrollWidth - h.clientWidth, right: b.right, vw: innerWidth, full: h.title }; });
      assert.equal(r.text, 'Drag to move. Twist with two fingers to turn.');
      assert.ok(r.over <= 0 && r.right <= r.vw, `${W}: the line is not cut off`);
      assert.match(r.full, /Drag the house to move it/, 'the full line stays as the tooltip');
      await ctx.close();
    }
    // a narrow mouse window (not phone mode) wraps the full line instead of cutting it
    const n = await newPage(browser, { width: 390, height: 844, phone: false });
    await openApp(n.page, origin, '?mode=residential&sample=1&flow=0');
    await n.page.evaluate(() => window.__ps.setTool('movehouse'));
    await n.page.waitForTimeout(400);
    const r = await n.page.evaluate(() => { const h = document.querySelector('.ps-status-hint'); return { over: h.scrollWidth - h.clientWidth, ws: getComputedStyle(h).whiteSpace }; });
    assert.ok(r.over <= 0 && r.ws === 'normal', 'wrapped, not cut off');
    await n.ctx.close();
    const d = await newPage(browser, { width: 1440, height: 900, phone: false });
    await openApp(d.page, origin, '?mode=residential&sample=1&flow=0');
    await d.page.evaluate(() => window.__ps.setTool('movehouse'));
    await d.page.waitForTimeout(400);
    assert.match(await d.page.evaluate(() => document.querySelector('.ps-status-hint').textContent), /^Drag the house to move it\. Drag the gold ring/, 'desktop keeps the full line');
    assert.equal(await d.page.evaluate(() => document.documentElement.dataset.phone), '0');
    assert.equal(await d.page.evaluate(() => getComputedStyle(document.querySelector('.ps-toolbox')).display !== 'none' && !document.querySelector('.ps-dock') || getComputedStyle(document.querySelector('.ps-dock')).display === 'none'), true, 'desktop shows the toolbox and no dock');
    await d.ctx.close();
  });
});
}
