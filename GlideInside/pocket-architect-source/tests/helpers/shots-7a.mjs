// Review screenshots for release 7 round 2 part A: node tests/helpers/shots-7a.mjs [outDir]. iPhone 14 emulation, stubbed API (like the phone tests).
import { serve, launch, newPage, openApp, toEditor, dismiss } from './phone-harness.mjs';
import { toGrannyEditor } from './phone-editor.mjs';

const out = process.argv[2] || '/home/claude/shots-7a';
const { server, origin } = await serve();
const br = await launch();
try {
  // 1. phone editor 3D (the guided flow editor, double storey) and the pull up Menu sheet with Room tour
  {
    const { page } = await newPage(br, { width: 390, height: 844 });
    await openApp(page, origin, '?mode=residential&sample=1'); await dismiss(page);
    await toEditor(page);
    await page.click('[data-ps=dock-view]'); await page.waitForTimeout(8000);
    await page.screenshot({ path: `${out}/phone-editor-3d.png` });
    await page.click('[data-ps=dock-menu]'); await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/phone-pullup-sheet.png` });
  }
  // 2. the granny flat phone editor in 3D
  {
    const { page } = await newPage(br, { width: 390, height: 844, simple: true });
    await openApp(page, origin, '?mode=residential&sample=1');
    await toGrannyEditor(page); await page.waitForTimeout(3500);
    await page.screenshot({ path: `${out}/phone-editor-3d-granny.png` });
  }
} finally { await br.close(); server.close(); }
