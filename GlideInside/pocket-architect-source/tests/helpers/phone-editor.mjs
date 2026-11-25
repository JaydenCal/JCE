// Shared by the phone editor tests: the simple phone path to the editor with a granny flat placed, then the 3D view.
import { dismiss } from './phone-harness.mjs';

/** From a fresh page (sample lot) to the phone editor on a 2 bedroom granny flat. The editor opens on the plan, or the 3D view when `view3d`. */
export async function toGrannyEditor(page, { view3d = true } = {}) {
  await dismiss(page);
  await page.click('[data-ps=flow-next]');
  await page.click('[data-ps=phone-pick][data-type=granny2]');
  await page.waitForSelector('[data-ps=phone-house-name]:not(:empty)', { timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.click('[data-ps=phone-get-plans]');
  await page.waitForSelector('[data-ps=phone-free]', { timeout: 30000 });
  await page.evaluate(() => document.querySelectorAll('.psp-modal, .ps-modal').forEach((m) => m.querySelector('button')?.click()));
  await page.click('[data-ps=phone-free]');
  await page.waitForSelector('.ps-shell[data-phone-simple="1"]', { timeout: 30000 });
  await page.waitForTimeout(1500);
  await dismiss(page);
  if (view3d) {
    await page.evaluate(() => window.__ps.store.setUI({ view: '3d' }));
    await page.waitForSelector('canvas.ps3d-canvas', { timeout: 30000, state: 'attached' });
    await page.waitForTimeout(4000);
  }
}

/** Every visible, positioned element inside the editor shell (not sheets, not the 3D canvas): { name, x, y, w, h }. */
export async function overlayBoxes(page) {
  return page.evaluate(() => {
    const out = [];
    const shell = document.querySelector('.ps-shell');
    for (const e of shell.querySelectorAll('*')) {
      if (e.closest('canvas, svg, .ps-topbar, .ps-dock, .ps-modal-root, .ps-sheet')) { if (!e.matches('.ps-topbar, .ps-dock, .ps-topbar>*, .ps-dock>*')) continue; }
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0 || e.hidden) continue;
      const r = e.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (!(e.matches('.ps-topbar>*, .ps-dock>*') || ['fixed', 'absolute', 'sticky'].includes(s.position))) continue;
      if (r.width >= innerWidth * 0.98 && r.height >= innerHeight * 0.5) continue; // the stage itself
      out.push({ name: `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}${e.dataset.ps ? `[${e.dataset.ps}]` : ''}`, x: r.left, y: r.top, w: r.width, h: r.height, text: (e.innerText || '').slice(0, 20) });
    }
    return out;
  });
}
