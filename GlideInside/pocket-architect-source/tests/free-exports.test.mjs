// Release 7 round 2 (part B), owner decision 25/11/2026: every homeowner export (PDF plan set, 3D model, interactive 3D file, DXF) is free behind the one
// lead form; the A$30 purchase is now the AI design assistant with 1,000 credits; the phone Export sheet; the export_unlocked_by_lead event.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../src/config.js';
import { readConfig } from '../server/lib/config.js';
import { mapEvent } from '../src/ui/ga.js';
import { EXPORT_SHEET_ITEMS, DESKTOP_LINE } from '../src/phone/export-entry.js';
import { SRC, SKIP, serve, launch, newPage, openApp, dismiss } from './helpers/phone-harness.mjs';

const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const fill = async (page) => {
  await page.fill('#fps-name', 'Sam Citizen'); await page.fill('#fps-email', 'sam@example.com'); await page.fill('#fps-suburb', 'Calala');
  await page.check('[data-ps=planset-timeframe][value="6m"]'); await page.check('[data-ps=planset-ownership][value=yes]'); await page.check('#fps-consent');
};
const acceptTerms = async (page) => { const c = await page.waitForSelector('[data-ps=terms-check]', { timeout: 20000 }).catch(() => null); if (c) { await page.check('[data-ps=terms-check]'); await page.click('[data-ps=terms-generate]'); } };

test('the AI design assistant grants 1,000 credits on the client and the server, at the same A$30', () => {
  assert.equal(CONFIG.planPack.credits, 1000);
  assert.equal(CONFIG.planPack.priceAud, 30);
  assert.equal(readConfig({}).planPackCredits, 1000);
  assert.equal(readConfig({}).planPackPriceCents, 3000);
  assert.equal(readConfig({ PLAN_PACK_CREDITS: '20' }).planPackCredits, 20, 'the variable still overrides');
});

test('no user facing string in the app still sells a "Plan Pack" or "Unlock plans" to homeowners', () => {
  for (const f of ['src/premium/ui/topbar.js', 'src/premium/ui/flows.js', 'src/premium/ui/assistant.js', 'src/premium/credits.js', 'src/premium/messages.js', 'src/premium/free-planset.js', 'src/phone/export-entry.js']) {
    const t = read(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(!/Unlock plans|500 AI credits|Unlock the Plan Pack/.test(t), f);
    assert.ok(!/'[^']*Plan Pack[^']*'/.test(t), `${f} has no Plan Pack in a quoted string`);
    assert.ok(!/[–—]/.test(t) && !/compliant/i.test(t) && !/Pocket Architect/i.test(t), f);
  }
});

test('the site sells the AI design assistant, not the Plan Pack, and keeps builder and Commercial pricing', () => {
  const site = (f) => fs.readFileSync(path.join(SRC, '../website-live', f), 'utf8');
  for (const f of ['index.html', 'pricing/index.html', 'terms.html', 'sample-plan-set/index.html', 'plan-studio/index.html', 'plans/index.html', 'granny-flat-designs/index.html']) {
    const t = site(f);
    assert.ok(!/Plan Pack|500 AI|A\$30 only if/.test(t.replace(/<li>If you bought a Plan Pack before 25[\s\S]*?<\/li>/, '')), `${f} has no old Plan Pack copy`);
    assert.ok(!/[\u2013\u2014]/.test(t.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '')) || f === 'x', f);
  }
  assert.match(site('index.html'), /Free to design and download your plans\. AI design assistant A\$30 for 1,000 credits\./);
  assert.match(site('pricing/index.html'), /A\$20 per job/);
  assert.match(site('pricing/index.html'), /A\$50 per month/);
  assert.match(site('site.config.js'), /planPackCredits: "1,000"/);
  assert.match(site('terms.html'), /AI design assistant/);
  assert.match(site('index.html'), /"name":"Glide Inside Residential AI design assistant \(1,000 credits\)"/);
});

test('export_unlocked_by_lead maps through ga.js with no personal data', () => {
  const g = mapEvent('export_unlocked_by_lead', { surface: 'phone', type: 'glb', email: 'sam@example.com', name: 'Sam', suburb: 'Calala' });
  assert.deepEqual(g, [{ name: 'export_unlocked_by_lead', params: { surface: 'phone', export_type: 'glb' } }]);
  assert.deepEqual(mapEvent('export_unlocked_by_lead', { surface: 'tablet<script>', type: 'a b' }), [{ name: 'export_unlocked_by_lead', params: {} }]);
  assert.deepEqual(mapEvent('ps_upgrade_click', { source: 'ai_pack', from: 'topbar' })[0].params, { source: 'ai_pack', from: 'topbar' });
  const buy = mapEvent('ps_checkout_completed', { sessionId: 'cs_test_12345678' }, { once: () => true, price: 30 }).find((e) => e.name === 'purchase');
  assert.equal(buy.params.items[0].item_name, 'AI design assistant');
  assert.equal(buy.params.value, 30);
});

test('the phone Export sheet lists the four files, the computer line, and 44 px rows', () => {
  assert.deepEqual(EXPORT_SHEET_ITEMS.map((i) => i.label), ['Plan set (PDF)', '3D model', 'Interactive 3D file', 'CAD file (DXF)']);
  assert.deepEqual(EXPORT_SHEET_ITEMS.map((i) => i.type), ['pdf', 'glb', 'html', 'dxf']);
  assert.equal(DESKTOP_LINE, 'For the detailed design tool, open glideinside.com.au on a computer');
  const css = read('src/phone/css.js');
  assert.match(css, /\.ps-sheet-item\{[^}]*min-height:5\dpx/, 'the rows are at least 44 px');
  assert.match(css, /\.ps-sheet-close\{min-height:44px/);
  const src = read('src/phone/export-entry.js');
  assert.ok(/export function openExportSheet/.test(src) && /touchend/.test(src) && /exportFree/.test(src));
});

test('desktop: Exports menu has no locks, the first file asks for details once, every other file then downloads; the AI pack button starts checkout', { skip: SKIP, timeout: 360000 }, async () => {
  const { server, origin } = await serve();
  const br = await launch();
  try {
    const { page } = await newPage(br, { width: 1280, height: 860, phone: false });
    await page.addInitScript(() => { window.__ev = []; window.addEventListener('ps:analytics', (e) => window.__ev.push([e.detail.event, e.detail.props])); });
    const posted = [];
    await page.route('**/api/enquiry/jce', async (r) => { posted.push(JSON.parse(r.request().postData())); await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, reference: 'GI-ABCDE', emailed: false }) }); });
    await page.route('**/api/health', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, paymentsConfigured: true }) }));
    const checkouts = [];
    await page.route('**/api/checkout', async (r) => { checkouts.push(JSON.parse(r.request().postData())); await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' }) }); });
    await openApp(page, origin, '?mode=residential&sample=1&flow=0');
    await dismiss(page);
    await page.waitForFunction(() => window.__ps.premium, null, { timeout: 30000 });
    const bar = page.locator('.ps-topbar').first();
    assert.equal((await bar.textContent()).includes('AI design assistant, A$30'), true);
    assert.equal((await bar.textContent()).includes('Unlock plans'), false);
    await page.click('.psp-bar button[aria-haspopup=menu]');
    await page.waitForSelector('.psp-menu:not([hidden])');
    const menu = await page.evaluate(() => { const m = document.querySelector('.psp-menu:not([hidden])'); return { text: m.textContent, items: [...m.querySelectorAll('.psp-menu-item[data-type]')].map((b) => b.dataset.type), lockIcons: m.querySelectorAll('svg[data-icon=lock], .psp-icon-lock').length }; });
    assert.ok(!/Locked/.test(menu.text), 'no item says Locked');
    for (const t of ['pdf', 'dxf', 'glb', 'obj', 'html']) assert.ok(menu.items.includes(t), t);
    assert.equal(menu.lockIcons, 0);
    await page.screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'desktop-exports-menu.png') });
    await page.click('.psp-menu-item[data-type=glb]');
    await page.waitForSelector('[data-ps=planset-form]');
    assert.match(await page.locator('.psp-modal').first().textContent(), /Every other file for this design is free too/);
    await fill(page);
    const dl = page.waitForEvent('download', { timeout: 120000 });
    await page.click('[data-ps=planset-form] button[type=submit]');
    await acceptTerms(page);
    assert.match((await dl).suggestedFilename(), /\.glb$/i);
    await page.waitForSelector('[data-ps=planset-done]:not([hidden])');
    assert.equal(posted.length, 1);
    assert.equal(posted[0].source, 'planset-free');
    await page.click('.psp-modal button:has-text("Close")');
    for (const [type, re] of [['html', /\.html$/i], ['dxf', /\.dxf$/i], ['pdf', /\.pdf$/i]]) {
      const d = page.waitForEvent('download', { timeout: 120000 });
      await page.evaluate((t) => { window.__ps.premium.exportAs(t); }, type);
      await acceptTerms(page);
      assert.match((await d).suggestedFilename(), re, type);
      assert.equal(await page.locator('[data-ps=planset-form]:visible').count(), 0, `${type}: the form is not shown again`);
    }
    assert.equal(posted.length, 1, 'one lead only');
    const ev = await page.evaluate(() => window.__ev);
    assert.equal(ev.filter((e) => e[0] === 'export_unlocked_by_lead').length, 1);
    assert.deepEqual(ev.find((e) => e[0] === 'export_unlocked_by_lead')[1], { surface: 'desktop', type: 'glb' }, 'no personal data in the event');
    // the flag survives a reload of the same design (stored in this browser)
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('gi.planset.lead')).projects.length > 0), true);
    // the AI design assistant button: the checkout prompt, then the existing checkout
    await page.click('[data-ps=ai-pack]');
    await page.waitForSelector('.psp-modal [data-ps=checkout-terms]');
    const modalText = await page.locator('.psp-modal').last().textContent();
    for (const s of ['AI design assistant', '1,000 AI credits', 'A$30']) assert.ok(modalText.includes(s), s);
    assert.ok(!/Plan Pack|500 AI/.test(modalText));
    await page.screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'desktop-ai-pack-checkout.png') });
    const up = (await page.evaluate(() => window.__ev)).find((e) => e[0] === 'ps_upgrade_click'); // read before the page leaves for the payment page
    await page.check('.psp-modal [data-ps=checkout-terms]');
    await page.click('.psp-modal button:has-text("Continue to secure checkout")');
    await page.waitForFunction(() => true);
    for (let i = 0; i < 40 && !checkouts.length; i++) await page.waitForTimeout(100);
    assert.equal(checkouts.length, 1, 'the existing checkout is called');
    assert.deepEqual(up[1], { source: 'ai_pack', from: 'ai_pack' });
    assert.deepEqual(page.errs, []);
  } finally { await br.close(); server.close(); }
});

test('phone: the Export sheet asks for details once, then every file downloads; Close, a tap outside and a swipe down all close it', { skip: SKIP, timeout: 360000 }, async () => {
  const { server, origin } = await serve();
  const br = await launch();
  try {
    const { page } = await newPage(br, { width: 390, height: 844, phone: true });
    await page.addInitScript(() => { window.__ev = []; window.addEventListener('ps:analytics', (e) => window.__ev.push([e.detail.event, e.detail.props])); });
    const posted = [];
    await page.route('**/api/enquiry/jce', async (r) => { posted.push(JSON.parse(r.request().postData())); await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, reference: 'GI-ABCDE', emailed: false }) }); });
    await openApp(page, origin, '?mode=residential&sample=1&flow=0');
    await dismiss(page);
    await page.waitForFunction(() => window.__ps.premium, null, { timeout: 30000 });
    // The phone toolbar button belongs to the other agent's work; here the real module is bundled and called as the toolbar will call it.
    const { build } = await import('esbuild');
    const out = await build({ entryPoints: [path.join(SRC, 'src/phone/export-entry.js')], bundle: true, write: false, format: 'iife', globalName: '__exp', platform: 'browser' });
    await page.addScriptTag({ content: out.outputFiles[0].text });
    const open = () => page.evaluate(() => { window.__exp.openExportSheet(); });
    await open();
    await page.waitForSelector('[data-ps=export-sheet]');
    const rows = await page.evaluate(() => [...document.querySelectorAll('[data-ps=export-sheet] .ps-sheet-item')].map((b) => ({ t: b.textContent, h: b.getBoundingClientRect().height })));
    assert.equal(rows.length, 4);
    assert.ok(rows.every((r) => r.h >= 44), JSON.stringify(rows));
    assert.ok((await page.textContent('[data-ps=export-sheet]')).includes('For the detailed design tool, open glideinside.com.au on a computer'));
    await page.screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'phone-export-sheet.png') });
    await page.click('[data-ps=export-sheet-close]');
    assert.equal(await page.locator('[data-ps=export-sheet]').count(), 0, 'Close works');
    await open();
    await page.mouse.click(195, 60);
    assert.equal(await page.locator('[data-ps=export-sheet]').count(), 0, 'a tap outside works');
    await open();
    await page.evaluate(() => { const s = document.querySelector('[data-ps=export-sheet]'); const mk = (type, y) => { const t = new Touch({ identifier: 1, target: s, clientX: 200, clientY: y }); s.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], changedTouches: [t] })); }; mk('touchstart', 500); mk('touchmove', 560); mk('touchend', 640); });
    assert.equal(await page.locator('[data-ps=export-sheet]').count(), 0, 'a swipe down works');
    // first file: the lead form, then the download
    await open();
    await page.click('[data-ps=export-glb]');
    await page.waitForSelector('[data-ps=planset-form]');
    await fill(page);
    const dl = page.waitForEvent('download', { timeout: 120000 });
    await page.click('[data-ps=planset-form] button[type=submit]');
    await acceptTerms(page);
    assert.match((await dl).suggestedFilename(), /\.glb$/i);
    assert.equal(posted.length, 1);
    assert.equal(posted[0].notes.includes('Surface: phone'), true);
    await page.waitForSelector('[data-ps=planset-done]:not([hidden])');
    await page.click('.psp-modal button:has-text("Close")');
    // every other file: no form
    await open();
    const d2 = page.waitForEvent('download', { timeout: 120000 });
    await page.click('[data-ps=export-dxf]');
    await acceptTerms(page);
    assert.match((await d2).suggestedFilename(), /\.dxf$/i);
    assert.equal(await page.locator('[data-ps=planset-form]:visible').count(), 0);
    const ev = await page.evaluate(() => window.__ev);
    assert.deepEqual(ev.find((e) => e[0] === 'export_unlocked_by_lead')[1], { surface: 'phone', type: 'glb' });
    assert.ok(ev.some((e) => e[0] === 'phone_planset_lead_submit'));
    assert.deepEqual(page.errs, []);
  } finally { await br.close(); server.close(); }
});
