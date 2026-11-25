// Final review screenshots for release 7: node tests/helpers/shots-7final.mjs [outDir]. iPhone 14 emulation, stubbed API (like the phone tests).
import fs from 'node:fs';
import { serve, launch, newPage, openApp, dismiss } from './phone-harness.mjs';
import { toGrannyEditor } from './phone-editor.mjs';

const out = process.argv[2] || '/home/claude/shots-7final';
fs.mkdirSync(out, { recursive: true });
const { server, origin } = await serve();
const br = await launch();
try {
  const { page } = await newPage(br, { width: 390, height: 844, simple: true });
  await openApp(page, origin, '?mode=residential&sample=1');
  await dismiss(page);
  await page.click('[data-ps=flow-next]');
  await page.click('[data-ps=phone-pick][data-type=granny2]');
  await page.waitForSelector('[data-ps=phone-house-name]:not(:empty)', { timeout: 60000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${out}/1-phone-house-screen.png` });
  await page.click('[data-ps=phone-get-plans]');
  await page.waitForSelector('[data-ps=phone-free]', { timeout: 30000 });
  await page.evaluate(() => document.querySelectorAll('.psp-modal, .ps-modal').forEach((m) => m.querySelector('button')?.click()));
  await page.click('[data-ps=phone-free]');
  await page.waitForSelector('.ps-shell[data-phone-simple="1"]', { timeout: 30000 });
  await page.waitForTimeout(1500);
  await dismiss(page);
  await page.evaluate(() => window.__ps.store.setUI({ view: '3d' }));
  await page.waitForSelector('canvas.ps3d-canvas', { timeout: 30000, state: 'attached' });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${out}/2-phone-editor-3d.png` });
  await page.click('[data-ps=dock-export]');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/3-export-sheet.png` });
  await page.evaluate(() => document.querySelectorAll('.ps-sheet-close, [data-ps=sheet-close]').forEach((b) => b.click()));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  // the existing building tool placing a house, on the plan
  await page.evaluate(() => window.__ps.store.setUI({ view: '2d' }));
  await page.waitForTimeout(1500);
  await page.click('[data-ps=dock-tools]'); // on the simple path the first tap opens the full editor, the second the Tools list
  await page.waitForTimeout(1500);
  if (!(await page.locator('[data-ps=tools-more]').count())) { await page.click('[data-ps=dock-tools]'); await page.waitForTimeout(800); }
  await page.click('[data-ps=tools-more]');
  await page.click('[data-ps=tool-existing]');
  await page.waitForTimeout(800);
  const box = await page.locator('canvas.ps-plan-canvas').first().boundingBox();
  await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.2);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/4-existing-building-tool.png` });
  console.log(await page.evaluate(() => JSON.stringify(window.__ps.store.project.site.existingBuildings)), page.errs);
} finally { await br.close(); server.close(); }
