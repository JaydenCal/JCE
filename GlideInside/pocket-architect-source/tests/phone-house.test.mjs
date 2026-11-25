// The phone house screen (src/phone/house-ui.js, src/lotcard/lot-card.js): pill, the 3D view and the bottom bar only; the rest in the menu.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { housePillText, shortAddress, lotNumber, stepBarModel, houseMenuModel, HOUSE_STEPS, NOTICE_MS, PHONE_HOUSE_CSS } from '../src/phone/house-ui.js';
import { PHONE_TYPE_ORDER, PHONE_TYPES } from '../src/flow/phone-simple.js';
import { SRC, SKIP, serve, launch, newPage, openApp, dismiss } from './helpers/phone-harness.mjs';

const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

test('the pill is the address and the lot number', () => {
  assert.equal(shortAddress('9 Andrew Cl, Taree NSW 2430'), '9 Andrew Cl, Taree');
  assert.equal(lotNumber({ lotLabel: 'Lot 51 DP 123456' }), '51');
  assert.equal(housePillText({ address: '9 Andrew Cl, Taree NSW 2430', lotLabel: 'Lot 51 DP 123456' }), '9 Andrew Cl, Taree · Lot 51');
  assert.match(housePillText({ lotLabel: 'Sample lot', demo: true, areaM2: 1080 }), /^Sample lot/);
  assert.equal(housePillText(null), '');
});

test('the 4 step bar lights the current step', () => {
  assert.deepEqual(HOUSE_STEPS, ['Address', 'Pick', 'Place', 'Free plans']);
  assert.deepEqual(stepBarModel(3).map((s) => s.state), ['done', 'done', 'current', 'todo']);
});

test('notices hide after 3 seconds', () => {
  assert.equal(NOTICE_MS, 3000);
  const fc = read('src/ui/fit-card.js');
  assert.ok(/doneMs/.test(fc) && /setTimeout\(\(\) => \{ if \(done === mine/.test(fc), 'the Auto fit done notice times out');
  assert.ok(/ph-house/.test(read('src/ui/toast.js')) && /Math\.min\(ms \|\| 3000, 3000\)/.test(read('src/ui/toast.js')), 'toasts are capped on the phone house screen');
});

test('granny flats come first on the Pick step, then shed houses, then houses', () => {
  assert.deepEqual(PHONE_TYPE_ORDER.map((t) => PHONE_TYPES[t].label), ['Granny flat, 1 bedroom', 'Granny flat, 2 bedroom', 'Shed house', 'House']);
});

test('the menu holds Aerial, Upload boundary, Room tour and Compass', () => {
  const rows = houseMenuModel({ aerial: { has: true, on: true, toggle() {} }, upload() {}, rooms: [{ id: 'living', label: 'Living' }], tour() {}, northUp() {} });
  assert.deepEqual(rows.map((r) => r.label), ['Aerial: On', 'Upload boundary', 'Room tour', 'Compass, north up']);
});

test('copy rules and colours', () => {
  const t = read('src/phone/house-ui.js');
  assert.ok(!/[–—]/.test(t) && !/compliant/i.test(t) && !/Pocket Architect/.test(t));
  for (const c of ['#0a111e', '#121b2b', '#e9b66f', '#1c1407']) assert.ok(PHONE_HOUSE_CSS.includes(c), c);
  assert.ok(/Save your design/.test(read('src/profile/ui.js')) && /if \(isPhoneMode\(\)\) return;/.test(read('src/profile/ui.js')), 'no save card on phones');
});

test('phone viewer: only the pill, the view and the bottom bar; the rest is in the menu', { skip: SKIP, timeout: 240000 }, async () => {
  const { server, origin } = await serve();
  const br = await launch();
  try {
    const { page } = await newPage(br, { width: 390, height: 844, simple: true });
    await openApp(page, origin, '?embed=1&mode=residential');
    await dismiss(page);
    await page.waitForSelector('[data-ps=phone-bar]', { state: 'visible', timeout: 60000 });
    await page.waitForTimeout(4000);
    const vis = (ps) => page.locator(`[data-ps=${ps}]`).first().isVisible();
    for (const ps of ['lc-find', 'lc-menu', 'phone-bar', 'phone-get-plans', 'phone-change-home', 'phone-move-house', 'phone-rotate-house', 'phone-steps']) assert.equal(await vis(ps), true, `${ps} shows`);
    for (const ps of ['lot-head', 'lc-mini', 'lc-full-editor', 'lc-upload', 'lc-rooms', 'lc-compass', 'lot-card']) assert.equal(await vis(ps), false, `${ps} is gone`);
    assert.equal(await page.locator('.lc-aerial').first().isVisible(), false, 'no floating Aerial button');
    assert.equal(await page.locator('.ps-prof-prompt').count(), 0, 'no Save your design card');
    assert.deepEqual(await page.$$eval('[data-ps=phone-steps] .ph-lbl', (e) => e.map((x) => x.textContent)), ['Address', 'Pick', 'Place', 'Free plans']);
    assert.equal(await page.getAttribute('[data-ps=phone-steps] li[data-state=current]', 'data-step'), '3');
    const g = await page.locator('[data-ps=phone-get-plans]').boundingBox();
    assert.ok(g.width > 340 && g.y + g.height <= 844, 'full width gold button inside the screen');
    assert.match(await page.evaluate(() => getComputedStyle(document.querySelector('[data-ps=phone-get-plans]')).backgroundColor), /233, 182, 111/);
    // the menu
    await page.click('[data-ps=lc-menu]');
    await page.waitForSelector('[data-ps=phone-menu-aerial]');
    for (const ps of ['phone-menu-aerial', 'phone-menu-upload', 'phone-menu-rooms', 'phone-menu-north', 'phone-concept']) assert.equal(await vis(ps), true, `${ps} is in the menu`);
    assert.ok((await page.$$eval('[data-ps=phone-room]', (e) => e.map((x) => x.textContent))).includes('Kitchen'), 'the room chips are in the menu');
    await page.click('[data-ps=phone-house-menu-close]');
    // Rotate steps
    await page.click('[data-ps=phone-rotate-house]');
    assert.equal(await vis('phone-rotate-left'), true);
    assert.deepEqual(page.errs, []);
  } finally { await br.close(); server.close(); }
});

test('desktop viewer keeps its minimap, label box and Open full editor', { skip: SKIP, timeout: 240000 }, async () => {
  const { server, origin } = await serve();
  const br = await launch();
  try {
    const { page } = await newPage(br, { width: 1280, height: 800, phone: false });
    await openApp(page, origin, '?embed=1&mode=residential');
    await page.waitForSelector('[data-ps=lc-mini]', { state: 'visible', timeout: 60000 });
    for (const ps of ['lot-head', 'lc-mini', 'lc-full-editor', 'lc-upload']) assert.equal(await page.locator(`[data-ps=${ps}]`).first().isVisible(), true, ps);
    assert.equal(await page.locator('[data-ps=phone-bar]').first().isVisible(), false);
  } finally { await br.close(); server.close(); }
});
