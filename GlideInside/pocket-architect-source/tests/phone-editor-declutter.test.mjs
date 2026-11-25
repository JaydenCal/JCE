// The phone editor, 3D view (owner 25/11/2026): top bar, the 3D view with Reset view, one bottom toolbar, and nothing else floating over it.
// Bounding box tests at 375x667, 390x844 and 430x932, on both ways into the editor. Plus the Menu (room tour, top view, Edit room, design switcher,
// the computer note and Send me the link), the Export slot, and the hint that shows once.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SRC, SKIP, serve, launch, newPage, openApp, toEditor, dismiss } from './helpers/phone-harness.mjs';
import { toGrannyEditor, overlayBoxes } from './helpers/phone-editor.mjs';
import { extrasModel, COMPUTER_NOTE, CONCEPT_SHORT } from '../src/phone/menu-extras.js';
import { openExportSheet, EXPORT_SHEET_ITEMS } from '../src/phone/export-entry.js';
import { showHintOnce, resetHintOnce, HINT_MS } from '../src/phone/hint.js';

const SIZES = [[375, 667], [390, 844], [430, 932]];
const overlap = (a, b) => !(a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5);
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

test('the copy: the computer note, the concept line, no dashes, never "compliant"', () => {
  assert.equal(COMPUTER_NOTE, 'For the detailed design tool, open glideinside.com.au on a computer');
  assert.equal(CONCEPT_SHORT, 'Concept design only');
  for (const f of ['src/phone/menu-extras.js', 'src/phone/export-entry.js', 'src/phone/hint.js']) {
    const strings = [...read(f).matchAll(/'([^'\n]{8,})'/g)].map((m) => m[1]);
    for (const t of strings) { assert.ok(!/[–—]/.test(t), `${f}: ${t}`); assert.ok(!/compliant/i.test(t)); assert.ok(!/pocket architect/i.test(t)); }
  }
});

test('export-entry.js: the Export slot opens the free Export sheet (round 2 part B: every homeowner file is free behind the lead form)', () => {
  assert.equal(typeof openExportSheet, 'function');
  assert.deepEqual(EXPORT_SHEET_ITEMS.map((i) => i.type), ['pdf', 'glb', 'html', 'dxf']);
  const chrome = read('src/phone/chrome.js');
  assert.match(chrome, /from '\.\/export-entry\.js'/);
  assert.match(chrome, /dockBtn\('dock-export', 'save', 'Export', \(\) => openExportSheet\(\)\)/);
  assert.match(chrome, /toolsBtn, viewBtn, exportBtn, detailsBtn, menuBtn/, 'Tools, Plan, Export, Details, Menu in that order');
  assert.match(read('src/phone/export-entry.js'), /exportFree/, 'a file is built through the free export path (lead form first)');
});

test('the hint shows once and hides itself after 3 seconds', async () => {
  const els = [];
  const doc = { createElement: () => { const e = { className: '', dataset: {}, classList: { add() {}, remove() {} }, setAttribute() {}, remove() { e.gone = true; }, textContent: '' }; return e; } };
  const host = { append: (e) => els.push(e) };
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  resetHintOnce();
  globalThis.requestAnimationFrame = (f) => f();
  const first = showHintOnce({ host, doc, storage, ms: 20 });
  assert.ok(first && first.textContent === 'Drag to move. Twist with two fingers to turn.');
  assert.equal(HINT_MS, 3000);
  assert.equal(showHintOnce({ host, doc, storage, ms: 20 }), null, 'not shown a second time');
  assert.equal(showHintOnce({ host, doc, storage, ms: 20 }), null, 'remembered in storage across page loads');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(first.gone, true, 'removed after it hides');
  delete globalThis.requestAnimationFrame;
});

test('the menu model: the computer note and the send button are always there; the 3D rows only in 3D', () => {
  const doc = { querySelector: () => null, querySelectorAll: () => [] };
  const plan = extrasModel({ store: { ui: { view: '2d' }, project: {} }, doc });
  assert.deepEqual(plan.map((r) => r.ps), ['pme-concept', 'pme-computer']);
  assert.equal(plan.at(-1).label, COMPUTER_NOTE);
  assert.equal(plan.at(-1).button.label, 'Send me the link');
});

for (const [W, H] of SIZES) {
  test(`${W}x${H}: the phone editor 3D view (granny flat, simple path) has the top bar, Reset view and one bottom toolbar, and nothing overlaps`, { skip: SKIP, timeout: 300000 }, async () => {
    const { server, origin } = await serve();
    const br = await launch();
    try {
      const { page } = await newPage(br, { width: W, height: H, simple: true });
      await openApp(page, origin, '?mode=residential&sample=1');
      await toGrannyEditor(page);
      await page.waitForTimeout(3500); // the hint has hidden itself
      const boxes = await overlayBoxes(page);
      const names = boxes.map((b) => b.name);
      // the top bar: back, title, undo, Save
      const top = boxes.filter((b) => b.y < 60);
      assert.ok(top.some((b) => /ps-btn/.test(b.name) && b.x < 20), 'back');
      assert.ok(top.some((b) => /ps-name/.test(b.name)), 'title');
      assert.ok(top.some((b) => /ps-group/.test(b.name)), 'undo');
      assert.ok(top.some((b) => /Save/.test(b.text)), 'Save design');
      // one bottom toolbar of five
      const dock = boxes.filter((b) => /ps-dock-btn/.test(b.name));
      assert.equal(dock.length, 5, 'Tools, Plan, Export, Details, Menu');
      assert.deepEqual(dock.map((b) => b.text.trim()), ['Full editor', 'Plan', 'Export', 'Details', 'Menu']);
      assert.ok(dock.every((b) => b.h >= 44 && b.w >= 44), 'every dock button is a 44 px target');
      // Reset view is there, top right
      const reset = boxes.find((b) => /view3d-reset/.test(b.name));
      assert.ok(reset, 'Reset view shows');
      assert.ok(reset.x + reset.w <= W && reset.y >= 56 && reset.x > W / 2, 'top right of the 3D view');
      // nothing else floats
      const allowed = (b) => top.includes(b) || dock.includes(b) || b === reset || /ps-dock|ps-topbar/.test(b.name);
      const extra = boxes.filter((b) => !allowed(b));
      assert.deepEqual(extra.map((b) => b.name), [], 'nothing else is over the 3D view');
      // no two boxes overlap
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]; const b = boxes[j];
        if (/ps-topbar|ps-dock$|ps-dock\b(?!-)/.test(a.name) || /ps-topbar|ps-dock$/.test(b.name)) continue;
        assert.ok(!overlap(a, b), `${a.name} overlaps ${b.name} at ${W}x${H}`);
      }
      assert.ok(boxes.every((b) => b.x >= -0.5 && b.x + b.w <= W + 0.5 && b.y >= -0.5 && b.y + b.h <= H + 0.5), 'inside the screen');
      // the floating pieces are hidden, not just moved
      for (const ps of ['lot-head', 'lc-rooms', 'lc-pager', 'lc-mini', 'lot-card', 'lc-aerial']) assert.equal(await page.locator(`[data-ps=${ps}]`).first().isVisible().catch(() => false), false, `${ps} is out of the view`);
      for (const sel of ['.ps-backplan', '.ps3d-editbar', '.ps-statusbar', '.ps-credit', '.gf-backpill']) assert.equal(await page.locator(sel).first().isVisible().catch(() => false), false, `${sel} is out of the view`);
      assert.deepEqual(page.errs.filter((e) => !/401|WebGL|GPU/i.test(e)), []);
    } finally { await br.close(); server.close(); }
  });
}

test('390x844: the guided flow editor (Open the editor) on the double storey sample is just as clear, and Back to placement moves into the Menu', { skip: SKIP, timeout: 300000 }, async () => {
  const { server, origin } = await serve();
  const br = await launch();
  try {
    const { page } = await newPage(br, { width: 390, height: 844 });
    await openApp(page, origin, '?mode=residential&sample=1');
    await dismiss(page);
    await toEditor(page);
    await page.click('[data-ps=dock-view]');
    await page.waitForTimeout(8000);
    const boxes = await overlayBoxes(page);
    const extra = boxes.filter((b) => !/ps-dock|ps-topbar|ps-btn|ps-name|ps-group|ps-premium-slot|view3d-reset/.test(b.name));
    assert.deepEqual(extra.map((b) => b.name), []);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlap(boxes[i], boxes[j]) || /ps-topbar|ps-dock$/.test(boxes[i].name + boxes[j].name), `${boxes[i].name} overlaps ${boxes[j].name}`);
    assert.equal(await page.locator('[data-ps=flow-back-to-placement]').isVisible(), false);
    // Menu: lot label, Back to placement, Room tour, Top view, Edit room, the computer note
    await page.click('[data-ps=dock-menu]');
    const pme = page.locator('[data-ps=phone-menu-extras]');
    await pme.waitFor({ state: 'visible' });
    assert.match(await page.textContent('[data-ps=pme-lot]'), /LOT|Lot/i);
    assert.equal(await page.locator('[data-ps=pme-placement]').count(), 1, 'Back to placement is in the Menu');
    assert.ok((await page.locator('[data-ps=pme-rooms] .ps-pme-chip').count()) >= 3, 'Room tour has the room chips');
    assert.equal(await page.locator('[data-ps=pme-topview]').count(), 1);
    assert.equal(await page.locator('[data-ps=pme-edit-room]').count(), 1);
    assert.equal(await page.locator('[data-ps=pme-edit]').count(), 1);
    assert.equal(await page.locator('[data-ps=pme-design]').count(), 1);
    assert.equal(await page.locator('[data-ps=pme-concept]').textContent(), 'Concept design only');
    assert.equal((await page.textContent('[data-ps=pme-computer] .ps-pme-note')).trim(), COMPUTER_NOTE);
    // Room tour chip: taps the real room tab and closes the Menu
    const before = await page.evaluate(async () => { const v = await window.__ps.getViewer(); const c = v.camera.position; return [c.x, c.y, c.z]; });
    await page.locator('[data-ps=pme-rooms] .ps-pme-chip').nth(1).click();
    await page.waitForTimeout(2500);
    const after = await page.evaluate(async () => { const v = await window.__ps.getViewer(); const c = v.camera.position; return [c.x, c.y, c.z]; });
    assert.notDeepEqual(after.map((n) => Math.round(n * 10)), before.map((n) => Math.round(n * 10)), 'the camera moved to the room');
    assert.equal(await page.locator('[data-ps=phone-menu-extras]').isVisible(), false, 'the Menu closed');
    // Edit room from the Menu arms room edit
    await page.click('[data-ps=dock-menu]');
    await page.click('[data-ps=pme-edit-room]');
    await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(() => document.querySelector('.ps3d-redit-arm')?.getAttribute('aria-pressed')), 'true', 'room edit is armed from the Menu');
    assert.equal(await page.locator('.ps3d-editbar').isVisible(), true, 'while it is on, its bar shows top left so it can be turned off');
    assert.deepEqual(page.errs.filter((e) => !/401|WebGL|GPU/i.test(e)), []);
  } finally { await br.close(); server.close(); }
});

test('390x844: Send me the link uses the share sheet with the design link; nothing is emailed by the server', { skip: SKIP, timeout: 300000 }, async () => {
  const { server, origin } = await serve();
  const br = await launch();
  try {
    const { page } = await newPage(br, { width: 390, height: 844, simple: true });
    const posts = [];
    page.on('request', (r) => { if (r.method() === 'POST') posts.push(new URL(r.url()).pathname); });
    await openApp(page, origin, '?mode=residential&sample=1');
    await toGrannyEditor(page, { view3d: false });
    await page.click('[data-ps=dock-menu]');
    await page.waitForSelector('[data-ps=pme-send-link]');
    assert.equal(await page.locator('[data-ps=pme-size-rooms]').count(), 1, 'Size and rooms is in the Menu for a granny flat');
    await page.click('[data-ps=pme-send-link]');
    await page.waitForFunction(() => window.__shared.length === 1, null, { timeout: 15000 });
    const shared = await page.evaluate(() => window.__shared[0]);
    assert.match(shared.url, /share=abc123/);
    assert.ok(!posts.some((p) => /email|mail|send/i.test(p)), `no email route was called: ${posts.join(', ')}`);
    await page.screenshot({ path: '/home/claude/shots-7a/phone-menu-computer-note.png' });
  } finally { await br.close(); server.close(); }
});

test('390x844: no share sheet means the link is copied', { skip: SKIP, timeout: 300000 }, async () => {
  const { server, origin } = await serve();
  const br = await launch();
  try {
    const { page } = await newPage(br, { width: 390, height: 844, simple: true, share: 'none' });
    await openApp(page, origin, '?mode=residential&sample=1');
    await toGrannyEditor(page, { view3d: false });
    await page.click('[data-ps=dock-menu]');
    await page.click('[data-ps=pme-send-link]');
    await page.waitForFunction(() => window.__copied && window.__copied.length === 1, null, { timeout: 15000 });
    assert.match(await page.evaluate(() => window.__copied[0]), /share=abc123/);
  } finally { await br.close(); server.close(); }
});

test('390x844: the Export slot opens the free Export sheet, and the hint shows once in 3D and hides after 3 seconds', { skip: SKIP, timeout: 300000 }, async () => {
  const { server, origin } = await serve();
  const br = await launch();
  try {
    const { page } = await newPage(br, { width: 390, height: 844, simple: true });
    await openApp(page, origin, '?mode=residential&sample=1');
    await toGrannyEditor(page, { view3d: false });
    await page.evaluate(() => { window.__ps.premium = { exportFree(type, o) { window.__exported = [...(window.__exported || []), [type, o?.surface]]; return Promise.resolve(); } }; });
    await page.click('[data-ps=dock-export]');
    await page.waitForSelector('[data-ps=export-sheet-list]');
    for (const t of ['pdf', 'glb', 'html', 'dxf']) assert.equal(await page.locator(`[data-ps=export-${t}]`).count(), 1, `the sheet offers ${t}`);
    assert.match(await page.textContent('[data-ps=export-sheet-note]'), /^Free\./);
    await page.click('[data-ps=export-pdf]');
    assert.deepEqual(await page.evaluate(() => window.__exported), [['pdf', 'phone']], 'a tap builds the file through the free export path');
    // the hint
    await page.evaluate(() => { try { localStorage.removeItem('ps.phone3d.hinted'); } catch { /* none */ } window.__ps.store.setUI({ view: '3d' }); });
    await page.waitForSelector('[data-ps=phone-hint].is-on', { timeout: 8000 });
    assert.match(await page.textContent('[data-ps=phone-hint]'), /Drag to move\. Twist with two fingers to turn\./);
    const t0 = Date.now();
    await page.waitForSelector('[data-ps=phone-hint]', { state: 'detached', timeout: 8000 });
    const shownFor = Date.now() - t0;
    assert.ok(shownFor < 3600 && shownFor > 1500, `hides itself after about 3 seconds (${shownFor} ms left)`);
    await page.evaluate(() => { window.__ps.store.setUI({ view: '2d' }); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { window.__ps.store.setUI({ view: '3d' }); });
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('[data-ps=phone-hint]').count(), 0, 'it does not come back');
  } finally { await br.close(); server.close(); }
});
