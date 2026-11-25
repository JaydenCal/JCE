// The simple phone path of the Residential tool (src/flow/phone-simple.js): Address, Pick, Fit, Plans. Pure logic first, then the real app in a
// phone window (390 x 844) and, to guard desktop, in a desktop window. Browser parts skip cleanly without Playwright and Chrome.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { catalogue } from '../src/catalogue/index.js';
import { houseStats } from '../src/portal/house-stats.js';
import { PHONE_TYPES, PHONE_TYPE_ORDER, designsForType, nextInCycle, typeOfDesign, buyLabel, simpleEditorOn, isPhoneType, withPhoneSteps } from '../src/flow/phone-simple.js';
import { PHONE_STEPS, RESIDENTIAL_STEPS, writeFlow, flowOf } from '../src/flow/state.js';
import { residentialSteps } from '../src/flow/residential.js';
import { SRC, SITE, SKIP, serve, launch, newPage, openApp, dismiss } from './helpers/phone-harness.mjs';

const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

// ---------------------------------------------------------------------------------------------- pure
test('the picks map to existing plans in the library, granny flats first, then shed houses, then full houses', () => {
  assert.deepEqual(PHONE_TYPE_ORDER, ['granny1', 'granny2', 'shed', 'house']);
  assert.deepEqual(PHONE_TYPE_ORDER.map((t) => PHONE_TYPES[t].label), ['Granny flat, 1 bedroom', 'Granny flat, 2 bedroom', 'Shed house', 'House']);
  for (const t of PHONE_TYPE_ORDER) {
    assert.ok(PHONE_TYPES[t].ids.length >= 2, `${t} has designs to cycle through`);
    for (const id of PHONE_TYPES[t].ids) assert.ok(catalogue.templates.some((x) => x.id === id), `${id} is a template in the plan library`);
  }
  assert.equal(isPhoneType('granny1'), true);
  assert.equal(isPhoneType('commercial'), false);
  assert.equal(isPhoneType('__proto__'), false);
});

test('every granny flat is a NSW 60 m2 secondary dwelling design', () => {
  for (const id of [...PHONE_TYPES.granny1.ids, ...PHONE_TYPES.granny2.ids]) {
    const s = houseStats(catalogue.createFromTemplate(id));
    assert.ok(s.floorAreaM2 <= 60, `${id} is ${s.floorAreaM2} m2`);
    assert.ok(s.floorAreaM2 > 20, `${id} is a real home`);
  }
});

test('designsForType returns the designs of a type in cycle order, and nothing for an unknown type', () => {
  for (const t of PHONE_TYPE_ORDER) {
    const list = designsForType(catalogue, { site: {} }, t);
    assert.deepEqual(list.map((d) => d.id), PHONE_TYPES[t].ids, `${t} keeps its cycle order`);
    assert.ok(list.every((d) => d.project.levels.length >= 1));
  }
  assert.deepEqual(designsForType(catalogue, { site: {} }, 'castle'), []);
});

test('Try another design cycles inside the same type and wraps round', () => {
  for (const t of PHONE_TYPE_ORDER) {
    const ids = PHONE_TYPES[t].ids;
    let id = ids[0];
    const seen = [];
    for (let i = 0; i < ids.length; i++) { id = nextInCycle(t, id); seen.push(id); assert.equal(typeOfDesign(id), t, 'never leaves the type'); }
    assert.equal(id, ids[0], 'a full lap comes back to the start');
    assert.equal(new Set(seen).size, ids.length);
  }
  assert.equal(nextInCycle('castle', 'x'), null);
});

test('the Plan Pack button label (used when the free plan set is switched off) names the price from the plan pack config', () => {
  assert.equal(buyLabel({ planPack: { priceAud: 30 } }), 'Download the plan set, A$30');
  assert.equal(buyLabel({ planPack: { priceAud: 29.5 } }), 'Download the plan set, A$29.50');
  assert.equal(buyLabel({}), 'Download the plan set, A$30');
});

test('the phone path keeps its flags on the flow record and the four steps sit in the four residential slots', () => {
  assert.deepEqual(PHONE_STEPS.map((s) => s.title), ['Address', 'Pick', 'Place', 'Free plans', 'Edit']);
  assert.deepEqual(PHONE_STEPS.map((s) => s.id), RESIDENTIAL_STEPS.map((s) => s.id));
  const store = { project: { flow: { kind: 'residential', step: 2 } }, emit() {} };
  writeFlow(store, { phoneType: 'shed' });
  assert.equal(store.project.flow.phoneType, 'shed', 'a patch that only adds a key is still written');
  writeFlow(store, { phoneSimple: true });
  assert.equal(store.project.flow.phoneSimple, true);
  assert.equal(flowOf(store.project).step, 2);
  assert.equal(simpleEditorOn(store.project, true), true);
  assert.equal(simpleEditorOn(store.project, false), false, 'only on a phone');
  assert.equal(simpleEditorOn({ flow: { kind: 'residential', step: 5 } }, true), false, 'a design made without the path has the full editor');
});

test('outside phone mode the wrapped steps are the desktop steps', async () => {
  const desktop = [{ id: 'lot', title: 'Find your lot', intro: 'a', mount: () => 'desktop-lot' }, { id: 'home', title: 'Choose a home', intro: 'b', mount: () => 'desktop-home' }, { id: 'place', title: 'Place it', intro: 'c', mount: () => 'desktop-place' }, { id: 'check', title: 'Check it', intro: 'd', mount: () => 'desktop-check' }];
  const wrapped = withPhoneSteps(desktop, { catalogue, store: {} });
  assert.deepEqual(wrapped.map((s) => s.id), ['lot', 'home', 'place', 'check']);
  assert.deepEqual(wrapped.map((s) => s.title), desktop.map((s) => s.title), 'node has no phone, so the desktop titles show');
  assert.deepEqual(wrapped.map((s) => s.mount({})), ['desktop-lot', 'desktop-home', 'desktop-place', 'desktop-check']);
  const real = residentialSteps({ catalogue, store: { project: {} } });
  assert.deepEqual(real.map((s) => s.id), ['lot', 'home', 'place', 'check']);
});

test('copy rules: plain Australian English, no dashes, never "compliant", concept wording said once', () => {
  const src = read('src/flow/phone-simple.js');
  const css = /The simple phone path: Address[\s\S]*?`;/.exec(read('src/phone/css.js'))?.[0] || '';
  assert.ok(css.length > 500, 'the phone path styles are in the phone css');
  for (const [name, t] of [['phone-simple.js', src], ['phone css', css]]) {
    assert.ok(!/[–—]/.test(t), `${name} has an en or em dash`);
    assert.ok(!/compliant/i.test(t), `${name} says compliant`);
  }
  assert.equal((src.match(/CONCEPT_LINE/g) || []).length, 3, 'the concept line is imported and shown once');
  assert.equal((src.match(/Concept only/g) || []).length, 0);
});

test('analytics: the host page forwards the phone events and the upgrade source', { skip: 'website-live/analytics.js is the live server copy and is updated separately in release 7' }, () => {
  const a = fs.readFileSync(path.join(SITE, 'analytics.js'), 'utf8');
  for (const e of ['phone_step_address', 'phone_lot_loaded', 'phone_pick_type', 'phone_house_placed', 'phone_planset_preview', 'phone_full_editor', 'phone_planset_lead_submit', 'phone_planset_download']) assert.ok(a.includes(e), `${e} is forwarded to GA4`);
  assert.ok(/ps_upgrade_click: 1, ps_checkout_started: 1/.test(a), 'the existing upgrade and checkout events are still forwarded');
  const build = read('tools/build-single.mjs');
  assert.ok(/analytics\.js/.test(build) && /window\.top!==window/.test(build), 'the directly opened app loads analytics, a framed one does not');
});

test('the buy button goes to the existing checkout with its own source', () => {
  const s = read('src/flow/phone-simple.js');
  assert.ok(/p\.openUpgrade\(\{ source: 'phone-planset' \}\)/.test(s));
  const p = read('src/premium/premium.js');
  assert.ok(/openUpgrade: \(o\) => openUpgrade\(\{ source:/.test(p), 'premium.openUpgrade takes a source');
  const f = read('src/premium/ui/flows.js');
  assert.ok(f.includes("track('ps_upgrade_click', { source })") && f.includes("track('ps_checkout_started', {})"), 'the events still fire in the checkout flow');
});

// ---------------------------------------------------------------------------------------------- browser
const steps = (page) => page.evaluate(() => ({ step: document.querySelector('.gf-root:not([hidden])')?.dataset.step || null, title: document.querySelector('.gf-title')?.textContent || '' }));

test('phone window: four steps, one action each, the six events, checkout and the simple editor', { skip: SKIP, timeout: 300000 }, async () => {
  const { server, origin } = await serve();
  const br = await launch();
  try {
    const { page } = await newPage(br, { width: 390, height: 844, simple: true });
    await page.addInitScript(() => { window.__ev = []; window.addEventListener('ps:analytics', (e) => window.__ev.push([e.detail.event, e.detail.props])); });
    await openApp(page, origin, '?mode=residential&sample=1');
    await dismiss(page);
    // 1 Address: one big input, nothing else offered
    assert.deepEqual(await steps(page), { step: '1', title: '1. Address' });
    assert.equal(await page.locator('[data-ps=flow-address]').isVisible(), true);
    assert.equal(await page.locator('[data-ps=flow-sample]').isVisible(), false, 'no sample or upload links on the address step');
    assert.equal(await page.locator('[data-ps=flow-menu]').isVisible(), false);
    await page.click('[data-ps=flow-next]');
    // 2 Pick: granny flats first, then shed houses, then full houses; a slim 4 step bar on top
    await page.waitForSelector('[data-ps=phone-pick]');
    assert.deepEqual(await page.$$eval('[data-ps=phone-pick]', (b) => b.map((x) => x.querySelector('b').textContent)), ['Granny flat, 1 bedroom', 'Granny flat, 2 bedroom', 'Shed house', 'House']);
    assert.deepEqual(await page.$$eval('[data-ps=flow-progress] .gf-lbl', (e) => e.map((x) => x.textContent)), ['Address', 'Pick', 'Place', 'Free plans']);
    assert.equal(await page.getAttribute('[data-ps=flow-progress] li[data-state=current]', 'data-step'), '2');
    assert.ok((await page.locator('[data-ps=phone-pick]').first().boundingBox()).height >= 80, 'big buttons');
    assert.equal(await page.locator('[data-ps=flow-next]').isVisible(), false, 'one action: no Next on the pick step');
    await page.click('[data-ps=phone-pick][data-type=granny2]');
    // 3 Place: the phone house screen. Pill, 3D view, bottom bar.
    await page.waitForSelector('[data-ps=phone-house-name]:not(:empty)', { timeout: 60000 });
    await page.waitForTimeout(2500);
    assert.deepEqual(await steps(page), { step: '3', title: '3. Place' });
    const first = await page.textContent('[data-ps=phone-house-name]');
    assert.match(first, /Granny flat/);
    assert.equal(await page.locator('[data-ps=phone-3d] canvas').count() > 0, true, '3D is showing');
    assert.match(await page.textContent('[data-ps=phone-pill]'), /Sample lot/);
    assert.deepEqual(await page.$$eval('.gf-ps-fit button', (b) => b.filter((x) => x.offsetParent).map((x) => x.textContent.trim())), ['Reset view', 'Sample lot \u00B7 1,080 m\u00B2', '', 'Change home', 'Move', 'Rotate', 'Get my free plans']);
    for (const ps of ['phone-change-home', 'phone-move-house', 'phone-rotate-house']) assert.ok((await page.locator(`[data-ps=${ps}]`).boundingBox()).height >= 44, `${ps} is 44 px`);
    // the fit notice hides itself after 3 seconds
    await page.waitForTimeout(3500);
    assert.equal(await page.locator('[data-ps=phone-fit-status]').isVisible(), false);
    // Rotate: 15 degree steps
    const rot = () => page.evaluate(() => JSON.stringify(window.__ps.store.project.levels[0].rooms[0].polygon[0]));
    const r0 = await rot();
    await page.click('[data-ps=phone-rotate-house]');
    await page.click('[data-ps=phone-rotate-right]');
    assert.notEqual(await rot(), r0, 'Rotate turned the house');
    await page.click('[data-ps=phone-rotate-house]');
    // Move it: a plan with a drag, then back
    await page.click('[data-ps=phone-move-house]');
    await page.waitForSelector('[data-ps=phone-move-plan] svg');
    const before = await rot();
    const box = await page.locator('[data-ps=phone-move-plan] svg').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 5 }); await page.mouse.up();
    await page.waitForTimeout(400);
    assert.notEqual(await rot(), before, 'dragging moved the house');
    await page.click('[data-ps=phone-move-house]');
    // Change home goes back to Pick and keeps the lot
    await page.click('[data-ps=phone-change-home]');
    await page.waitForSelector('[data-ps=phone-pick]');
    assert.equal(await page.evaluate(() => !!window.__ps.store.project.site?.lot), true, 'the lot is kept');
    await page.click('[data-ps=phone-pick][data-type=granny2]');
    await page.waitForSelector('[data-ps=phone-house-name]:not(:empty)', { timeout: 60000 });
    // Get my free plans goes to the plan set step
    await page.click('[data-ps=phone-get-plans]');
    // 4 Plans: a preview of their sheet, one primary button (free for details), keep designing for free
    await page.waitForSelector('[data-ps=phone-sheet]');
    assert.deepEqual(await steps(page), { step: '4', title: '4. Free plans' });
    assert.match(await page.textContent('[data-ps=phone-sheet] .gf-ps-mark'), /Preview/);
    assert.equal(await page.locator('[data-ps=phone-sheet] svg').count() > 0, true, 'their lot and house are on the sheet');
    assert.equal(await page.textContent('[data-ps=phone-buy]'), 'Get my plan set, free');
    assert.equal(await page.textContent('[data-ps=phone-free]'), 'Keep designing for free');
    assert.equal(await page.textContent('.gf-ps-note'), 'Concept only. Not for construction or approval.');
    assert.ok(!/A\$\s?30/.test(await page.textContent('[data-ps=phone-plans]')), 'no price on the homeowner plan set step');
    assert.equal(await page.locator('.ps-prof-prompt').isVisible().catch(() => false), false, 'the save card waits');
    // the lead is saved through the existing enquiry endpoint with the planset-free tag
    const posted = [];
    await page.route('**/api/enquiry/jce', async (r) => { posted.push(JSON.parse(r.request().postData())); await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, reference: 'GI-ABCDE', emailed: false }) }); });
    await page.click('[data-ps=phone-buy]');
    await page.waitForSelector('[data-ps=phone-lead-form]:not([hidden])');
    assert.equal(await page.locator('[data-ps=phone-buy]').isVisible(), false);
    assert.ok((await page.locator('[data-ps=phone-lead-submit]').boundingBox()).y + 60 < 844, 'the whole form, with its button, is on one screen');
    assert.ok((await page.locator('[data-ps=phone-privacy]').boundingBox()).y < 844, 'and the privacy line');
    await page.click('[data-ps=phone-lead-submit]');
    assert.match(await page.textContent('[data-ps=phone-lead-error]'), /name/i, 'every field is needed');
    await page.fill('[data-ps=phone-lead-name]', 'Sam Citizen');
    await page.fill('[data-ps=phone-lead-email]', 'sam@example.com');
    await page.fill('[data-ps=phone-lead-suburb]', 'Calala');
    await page.click('[data-ps=phone-lead-submit]');
    assert.match(await page.textContent('[data-ps=phone-lead-error]'), /when you are hoping to build/i, 'the two questions are needed');
    await page.check('[data-ps=phone-lead-timeframe][value="12m"]', { force: true });
    await page.check('[data-ps=phone-lead-ownership][value=buying]', { force: true });
    await page.click('[data-ps=phone-lead-submit]');
    assert.match(await page.textContent('[data-ps=phone-lead-error]'), /Tick the box/, 'consent is needed');
    assert.equal(posted.length, 0, 'nothing is sent before consent');
    await page.check('[data-ps=phone-lead-consent]');
    const dl = page.waitForEvent('download', { timeout: 120000 });
    await page.click('[data-ps=phone-lead-submit]');
    await page.waitForSelector('[data-ps=terms-check]', { timeout: 30000 });
    await page.check('[data-ps=terms-check]');
    await page.click('[data-ps=terms-generate]');
    const file = await dl;
    assert.match(file.suggestedFilename(), /\.pdf$/i, 'the plan set downloads in the browser');
    await page.waitForSelector('[data-ps=phone-planset-done]:not([hidden])');
    assert.equal(posted.length, 1);
    assert.equal(posted[0].source, 'planset-free');
    assert.equal(posted[0].need, 'planset');
    assert.equal(posted[0].consent, true);
    assert.equal(posted[0].email, 'sam@example.com');
    assert.match(posted[0].notes, /Suburb: Calala/);
    assert.equal(posted[0].timeframe, '12m');
    assert.equal(posted[0].ownership, 'buying');
    assert.equal(posted[0].designType, 'granny2');
    assert.ok(posted[0].consentAt && posted[0].consentText === (await page.textContent('[data-ps=phone-consent-text]')), 'the exact text shown is stored'); assert.equal(posted[0].builder, null);
    assert.equal(await page.locator('[data-ps=phone-privacy]').getAttribute('href'), '/privacy.html');
    assert.equal(posted[0].pdfBase64, undefined, 'a lead only: no plan set and no design file are sent');
    assert.equal(await page.textContent('[data-ps=phone-quote]'), 'Need stormwater, site classification or footings? Get a quote from JCE');
    await page.click('[data-ps=phone-quote]');
    await page.waitForSelector('.psp-modal', { timeout: 15000 });
    assert.match(await page.locator('.psp-modal').first().textContent(), /Order engineering/);
    const ev = await page.evaluate(() => window.__ev);
    const names = ev.map((e) => e[0]);
    for (const n of ['phone_step_address', 'phone_lot_loaded', 'phone_pick_type', 'phone_house_placed', 'phone_planset_preview', 'phone_planset_lead_submit', 'phone_planset_download']) assert.ok(names.includes(n), `${n} fired`);
    assert.deepEqual(ev.find((e) => e[0] === 'phone_pick_type')[1], { type: 'granny2' });
    assert.equal(names.filter((n) => n === 'phone_pick_type').length, 2, 'Change home picks again');
    await page.evaluate(() => document.querySelectorAll('.psp-modal').forEach((m) => m.querySelector('button')?.click()));
    // Keep designing: the simple editor, then Full editor
    await page.evaluate(() => document.querySelectorAll('.psp-modal, .ps-modal').forEach((m) => m.querySelector('button')?.click()));
    await page.click('[data-ps=phone-free]');
    await page.waitForSelector('.ps-shell[data-phone-simple="1"]', { timeout: 20000 });
    assert.equal((await page.textContent('[data-ps=dock-tools]')).trim(), 'Full editor');
    await page.click('[data-ps=dock-tools]');
    await page.waitForSelector('.ps-shell[data-phone-simple="0"]');
    assert.equal((await page.textContent('[data-ps=dock-tools]')).trim(), 'Tools');
    await page.click('[data-ps=dock-tools]');
    assert.ok(await page.waitForSelector('.ps-sheet [data-ps=tool-movehouse]', { timeout: 5000 }), 'the full toolbox opens after Open full editor');
    assert.ok((await page.evaluate(() => window.__ev)).some((e) => e[0] === 'phone_full_editor'));
    assert.deepEqual(page.errs, []);
  } finally { await br.close(); server.close(); }
});

test('phone window: Open full editor on the Fit step goes straight to the editor with the whole toolbox', { skip: SKIP, timeout: 240000 }, async () => {
  const { server, origin } = await serve();
  const br = await launch();
  try {
    const { page } = await newPage(br, { width: 390, height: 844, simple: true });
    await page.addInitScript(() => { window.__ev = []; window.addEventListener('ps:analytics', (e) => window.__ev.push([e.detail.event, e.detail.props])); });
    await openApp(page, origin, '?mode=residential&sample=1');
    await dismiss(page);
    await page.click('[data-ps=flow-next]');
    await page.click('[data-ps=phone-pick][data-type=shed]');
    await page.waitForSelector('[data-ps=phone-house-name]:not(:empty)', { timeout: 60000 });
    assert.match(await page.textContent('[data-ps=phone-house-name]'), /shed/i);
    await page.click('[data-ps=phone-house-menu-btn]');
    await page.click('[data-ps=phone-full-editor]');
    await page.waitForSelector('.ps-shell[data-phone-simple="0"]', { timeout: 20000 });
    assert.equal((await page.textContent('[data-ps=dock-tools]')).trim(), 'Tools');
    assert.ok((await page.evaluate(() => window.__ev)).some((e) => e[0] === 'phone_full_editor' && e[1].from === 'fit'));
    assert.deepEqual(page.errs, []);
  } finally { await br.close(); server.close(); }
});

test('desktop window: the usual five step flow is unchanged', { skip: SKIP, timeout: 240000 }, async () => {
  const { server, origin } = await serve();
  const br = await launch();
  try {
    const { page } = await newPage(br, { width: 1280, height: 860, phone: false });
    await page.addInitScript(() => { window.__ev = []; window.addEventListener('ps:analytics', (e) => window.__ev.push(e.detail.event)); });
    await openApp(page, origin, '?mode=residential&sample=1');
    await dismiss(page);
    assert.deepEqual(await steps(page), { step: '1', title: '1. Find your lot' });
    assert.deepEqual(await page.$$eval('[data-ps=flow-progress] .gf-lbl', (e) => e.map((x) => x.textContent)), ['Find your lot', 'Choose a home', 'Place it', 'Check it', 'Edit and export']);
    assert.equal(await page.locator('[data-ps=flow-sample]').count() > 0, true, 'the sample link is still there');
    await page.click('[data-ps=flow-next]');
    await page.waitForSelector('[data-ps=flow-home]');
    assert.equal(await page.locator('[data-ps=phone-pick]').count(), 0);
    assert.equal(await page.locator('[data-ps=flow-filter-bedrooms]').count(), 1, 'the filters are still there');
    await page.locator('[data-ps=flow-home]').first().click();
    await page.click('[data-ps=flow-next]');
    await page.waitForSelector('[data-ps=flow-bestfit]', { timeout: 30000 });
    assert.equal(await page.locator('[data-ps=flow-drive-bend]').count(), 1, 'the driveway tools are still on step 3');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.phone), '0');
    assert.ok(!(await page.evaluate(() => window.__ev)).some((n) => n.startsWith('phone_')), 'no phone events on a desktop');
    assert.deepEqual(page.errs, []);
  } finally { await br.close(); server.close(); }
});
