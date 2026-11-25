// The granny flat designer in the browser (src/ui/granny-designer.js): typed overall size and room sizes, Add room presets and the live checks.
// On a phone (390x844, decimal keypad, 44 px boxes) and on a desktop (1366x768, boxes beside the drawing, dragging an edge still works).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, serve, launch, newPage, openApp } from './helpers/phone-harness.mjs';
import { toGrannyEditor } from './helpers/phone-editor.mjs';

const SHOTS = '/home/claude/shots-7a';
const outline = (page) => page.evaluate(() => {
  const p = window.__ps.store.project; const g = p.levels[0];
  const encl = g.rooms.filter((r) => !r.outdoor && !['garage', 'carport'].includes(r.type));
  const xs = encl.flatMap((r) => r.polygon.map((q) => q.x)); const ys = encl.flatMap((r) => r.polygon.map((q) => q.y));
  const area = encl.reduce((s, r) => { let a = 0; r.polygon.forEach((q, i) => { const n = r.polygon[(i + 1) % r.polygon.length]; a += q.x * n.y - n.x * q.y; }); return s + Math.abs(a) / 2; }, 0) / 1e6;
  return { w: Math.max(...xs) - Math.min(...xs), l: Math.max(...ys) - Math.min(...ys), area, rooms: g.rooms.length };
});
const roomBox = (page, name) => page.evaluate((n) => { const r = window.__ps.store.project.levels[0].rooms.find((x) => x.name === n); const xs = r.polygon.map((q) => q.x); const ys = r.polygon.map((q) => q.y); return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys) }; }, name);
const type = async (page, ps, text, { commit = true } = {}) => { const el = page.locator(`[data-ps=${ps}]`); await el.fill(text); if (commit) { await el.press('Enter'); await page.waitForTimeout(250); } };

for (const [label, opts] of [['phone 390x844', { width: 390, height: 844, simple: true }], ['desktop 1366x768', { width: 1366, height: 768, phone: false }]]) {
  test(`${label}: typed overall and room sizes, Add room presets, live area and warnings`, { skip: SKIP, timeout: 300000 }, async () => {
    const { server, origin } = await serve();
    const br = await launch();
    try {
      const phone = opts.phone !== false;
      const { page } = await newPage(br, opts);
      await openApp(page, origin, '?mode=residential&sample=1');
      if (phone) await toGrannyEditor(page, { view3d: false });
      else {
        await page.evaluate(() => window.__ps.loadTemplate('granny_2bed_carport'));
        await page.waitForTimeout(1500);
      }
      await page.evaluate(() => window.__ps.openGrannyDesigner());
      await page.waitForSelector('[data-ps=granny-designer]');
      const o0 = await outline(page);
      // the boxes: decimal keypad, 44 px
      for (const ps of ['gd-width', 'gd-length', 'gd-add-width', 'gd-add-length']) {
        const el = page.locator(`[data-ps=${ps}]`);
        assert.equal(await el.getAttribute('inputmode'), 'decimal', `${ps}: numeric keypad`);
        assert.ok((await el.boundingBox()).height >= 44, `${ps}: 44 px`);
      }
      assert.equal(await page.inputValue('[data-ps=gd-width]'), (o0.w / 1000).toFixed(1));
      assert.equal(await page.inputValue('[data-ps=gd-length]'), (o0.l / 1000).toFixed(1));
      assert.match(await page.textContent('[data-ps=gd-area]'), new RegExp(`Floor area ${o0.area.toFixed(1)} m2 of 60 m2`));
      if (!phone) { // desktop: the boxes sit beside the drawing
        const d = await page.locator('[data-ps=gd-draw]').boundingBox(); const s = await page.locator('[data-ps=gd-side]').boundingBox();
        assert.ok(s.x >= d.x + d.width - 2 && Math.abs(s.y - d.y) < 30, 'boxes are to the right of the drawing, level with it');
        await page.screenshot({ path: `${SHOTS}/granny-typed-sizes-desktop.png` });
      } else {
        const d = await page.locator('[data-ps=gd-draw]').boundingBox(); const s = await page.locator('[data-ps=gd-side]').boundingBox();
        assert.ok(s.y >= d.y + d.height - 2, 'phone: the boxes sit under the drawing');
        await page.screenshot({ path: `${SHOTS}/granny-typed-sizes-phone.png` });
      }
      // live: typing a bigger width updates the area before it is committed
      await type(page, 'gd-width', ((o0.w + 1000) / 1000).toFixed(1), { commit: false });
      await page.waitForTimeout(150);
      assert.notEqual(await outline(page).then((o) => o.w), o0.w + 1000, 'not applied until committed');
      const live = await page.textContent('[data-ps=gd-area]');
      assert.doesNotMatch(live, new RegExp(`Floor area ${o0.area.toFixed(1)} m2`), 'the area moved while typing');
      await page.locator('[data-ps=gd-width]').press('Enter');
      await page.waitForTimeout(300);
      const o1 = await outline(page);
      assert.equal(o1.w, o0.w + 1000, 'the outline redrew');
      assert.ok(o1.area > o0.area, 'the floor area went up');
      // one undo step
      await page.evaluate(() => window.__ps.store.undo());
      assert.equal((await outline(page)).w, o0.w, 'one undo takes the typed width back');
      await page.waitForTimeout(300);
      // tap a room: its own width and length
      await page.locator('[data-ps=gd-room]').first().click({ force: true });
      await page.waitForSelector('[data-ps=gd-room-width]');
      const name = await page.textContent('[data-ps=gd-room-sec] h3');
      const b0 = await roomBox(page, name);
      assert.equal(await page.inputValue('[data-ps=gd-room-width]'), (b0.w / 1000).toFixed(1));
      assert.equal(await page.getAttribute('[data-ps=gd-room-width]', 'inputmode'), 'decimal');
      assert.ok((await page.locator('[data-ps=gd-room-width]').boundingBox()).height >= 44);
      await type(page, 'gd-room-width', ((b0.w + 300) / 1000).toFixed(1));
      assert.equal((await roomBox(page, name)).w, b0.w + 300, 'the typed room width is applied; the walls it shares moved');
      // Add room: presets, typed over
      await page.click('[data-ps=gd-preset][data-preset=bathroom]');
      assert.equal(await page.inputValue('[data-ps=gd-add-width]'), '2.4');
      assert.equal(await page.inputValue('[data-ps=gd-add-length]'), '2.0');
      await type(page, 'gd-add-width', '2.6', { commit: false });
      const n0 = (await outline(page)).rooms;
      await page.click('[data-ps=gd-add]');
      await page.waitForTimeout(400);
      assert.equal((await outline(page)).rooms, n0 + 1, 'a room was added');
      const added = await page.evaluate(() => { const rs = window.__ps.store.project.levels[0].rooms; const r = rs[rs.length - 1]; const xs = r.polygon.map((q) => q.x); const ys = r.polygon.map((q) => q.y); return { name: r.name, w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys) }; });
      assert.deepEqual([added.w, added.d], [2600, 2000], 'the typed 2.6 replaced the 2.4 preset');
      // warnings: a kitchen and living pushes the floor area over 60 m2
      await page.click('[data-ps=gd-preset][data-preset=kitchen-living]');
      await page.click('[data-ps=gd-add]');
      await page.waitForTimeout(400);
      assert.equal(await page.getAttribute('[data-ps=gd-area]', 'data-over'), 'true');
      const warn = await page.locator('[data-ps=gd-warning]').allTextContents();
      assert.ok(warn.some((w) => /over by/.test(w) && /60 m2/.test(w)), 'a clear warning about 60 m2');
      assert.ok((await outline(page)).area > 60, 'but nothing was blocked');
      // a bedroom under 2.4 m
      await page.evaluate(() => { document.querySelectorAll('[data-ps=gd-room]'); });
      const bedId = await page.evaluate(() => window.__ps.store.project.levels[0].rooms.find((r) => r.type === 'bedroom').id);
      await page.locator(`[data-ps=gd-room][data-room="${bedId}"]`).click({ force: true });
      await page.waitForSelector('[data-ps=gd-room-width]');
      await type(page, 'gd-room-width', '2.2');
      assert.ok((await page.locator('[data-ps=gd-warning]').allTextContents()).some((w) => /bedroom is usable from 2\.4 m/i.test(w)), 'bedroom under 2.4 m is flagged');
      // a size that cannot be made says so and changes nothing
      const before = await outline(page);
      await type(page, 'gd-width', '1');
      assert.equal((await page.locator('[data-ps=gd-error]').isVisible()), true);
      assert.deepEqual(await outline(page), before);
      if (!phone) await page.screenshot({ path: `${SHOTS}/granny-typed-sizes-desktop-warnings.png` });
      assert.deepEqual(page.errs.filter((e) => !/401|WebGL|GPU/i.test(e)), []);
    } finally { await br.close(); server.close(); }
  });
}

test('desktop 1366x768: dragging a room edge in the drawing still resizes it', { skip: SKIP, timeout: 300000 }, async () => {
  const { server, origin } = await serve();
  const br = await launch();
  try {
    const { page } = await newPage(br, { width: 1366, height: 768, phone: false });
    await openApp(page, origin, '?mode=residential&sample=1');
    await page.evaluate(() => window.__ps.loadTemplate('granny_2bed_carport'));
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__ps.openGrannyDesigner());
    await page.waitForSelector('[data-ps=granny-designer]');
    const living = await page.evaluate(() => window.__ps.store.project.levels[0].rooms.find((r) => r.type === 'living' || r.type === 'kitchen').id);
    const g = page.locator(`[data-ps=gd-room][data-room="${living}"]`);
    await g.click({ force: true });
    await page.waitForSelector('[data-ps=gd-room-width]');
    const sec = await page.textContent('[data-ps=gd-room-sec] h3');
    const w0 = (await roomBox(page, sec)).w;
    const bb = await page.locator(`[data-ps=gd-room][data-room="${living}"] polygon`).boundingBox();
    const y = bb.y + bb.height * 0.4; const xEdge = bb.x + bb.width - 4;
    await page.mouse.move(xEdge, y); await page.mouse.down();
    await page.mouse.move(xEdge + 20, y, { steps: 4 }); await page.mouse.move(xEdge + 40, y, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const w1 = (await roomBox(page, sec)).w;
    assert.ok(w1 > w0 && (w1 - w0) % 100 === 0, `the east edge was dragged out in 100 mm steps (${w0} to ${w1})`);
    await page.evaluate(() => window.__ps.store.undo());
    assert.equal((await roomBox(page, sec)).w, w0, 'one undo step');
  } finally { await br.close(); server.close(); }
});
