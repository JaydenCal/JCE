// Every 3D view: a visible "Reset view" button, a double tap reset, and clamps that keep the camera from getting lost (owner 25/11/2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { clampOrbit, orbitLimits } from '../src/viewer3d/camera-limits.js';
import { SRC, SKIP, serve, launch, newPage, openApp, dismiss } from './helpers/phone-harness.mjs';

const box = { min: { x: 0, y: 0, z: 0 }, max: { x: 30, y: 6, z: 40 } };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('clamps: an extreme pan keeps the target within the lot plus a margin, and the view angle is kept', () => {
  const lim = orbitLimits(box);
  const r = clampOrbit({ x: 5000, y: 0, z: -5000 }, { x: 5010, y: 12, z: -4990 }, box, lim);
  assert.ok(r.changed);
  assert.ok(r.target.x <= box.max.x + lim.margin + 1e-9 && r.target.z >= box.min.z - lim.margin - 1e-9);
  assert.ok(Math.abs((r.position.x - r.target.x) - 10) < 1e-6 && Math.abs((r.position.y - r.target.y) - 12) < 1e-6, 'the camera moves with the target');
});
test('clamps: zoom distance stays between the minimum and the maximum for the lot size', () => {
  const lim = orbitLimits(box);
  const far = clampOrbit({ x: 15, y: 1, z: 20 }, { x: 15, y: 90000, z: 90000 }, box, lim);
  assert.ok(dist(far.position, far.target) <= lim.maxDist + 1e-6);
  const near = clampOrbit({ x: 15, y: 1, z: 20 }, { x: 15, y: 1.0001, z: 20.0001 }, box, lim);
  assert.ok(dist(near.position, near.target) >= lim.minDist - 1e-6);
  assert.ok(lim.maxDist < 400, 'sensible for a small lot');
  assert.ok(orbitLimits({ min: { x: 0, y: 0, z: 0 }, max: { x: 400, y: 6, z: 400 } }).maxDist > lim.maxDist, 'a bigger lot allows more');
});
test('clamps: the camera never goes below the ground, and a good pose is left alone', () => {
  const lim = orbitLimits(box);
  const under = clampOrbit({ x: 15, y: 0.5, z: 20 }, { x: 25, y: -30, z: 30 }, box, lim);
  assert.ok(under.position.y >= lim.minCamY - 1e-9);
  assert.ok(Math.abs(dist(under.position, under.target) - dist({ x: 25, y: -30, z: 30 }, { x: 15, y: 0.5, z: 20 })) < 1e-6 || dist(under.position, under.target) <= lim.maxDist, 'distance stays valid');
  const ok = clampOrbit({ x: 15, y: 1, z: 20 }, { x: 35, y: 20, z: 60 }, box, lim);
  assert.equal(ok.changed, false);
});
test('wiring: the Reset view button, the double tap and the clamps are in the viewer, and the copy follows the text rules', () => {
  const v = fs.readFileSync(path.join(SRC, 'src/viewer3d/viewer.js'), 'utf8');
  assert.match(v, /Reset view<\/span>/);
  assert.match(v, /pointerType === 'touch'\) \{ lastClick = null; resetView\(\)/);
  assert.match(v, /constrainCamera\(\)/);
  const css = fs.readFileSync(path.join(SRC, 'src/viewer3d/viewer-css.js'), 'utf8');
  assert.match(css, /\.ps3d-reset\{[^}]*min-height:44px/);
  assert.ok(!/[–—]/.test(v.match(/ps3d-reset[\s\S]{0,700}/)[0]));
});

test('browser: Reset view puts the camera back to the opening pose after it was thrown away; clamps hold after extreme input', { skip: SKIP, timeout: 240000 }, async () => {
  const { server, origin } = await serve();
  const br = await launch();
  try {
    const { page } = await newPage(br, { width: 390, height: 844, simple: true });
    await openApp(page, origin, '?embed=1&mode=residential');
    await dismiss(page);
    await page.waitForSelector('[data-ps=phone-bar]', { state: 'visible', timeout: 60000 });
    await page.waitForTimeout(4000);
    const btn = page.locator('[data-ps=view3d-reset]').first();
    assert.equal(await btn.isVisible(), true, 'the Reset view button shows');
    assert.match(await btn.textContent(), /Reset view/);
    const bb = await btn.boundingBox();
    assert.ok(bb.height >= 44 && bb.x + bb.width <= 390 && bb.y >= 0, 'a 44 px target inside the screen');
    const pose = () => page.evaluate(async () => { const v = await window.__ps.getViewer(); const c = v.camera.position; const t = v.controls.target; return { c: [c.x, c.y, c.z], t: [t.x, t.y, t.z] }; });
    const start = await pose();
    // throw the camera away: target far off the lot, camera under the ground, huge zoom
    await page.evaluate(async () => { const v = await window.__ps.getViewer(); v.controls.target.set(4000, 0, -4000); v.camera.position.set(4000, -50, -3000); v.controls.update(); });
    await page.waitForTimeout(600);
    const lost = await pose();
    assert.ok(Math.hypot(lost.t[0] - start.t[0], lost.t[2] - start.t[2]) < 400, 'the clamp kept the target near the lot');
    assert.ok(lost.c[1] >= 0.3, 'the camera is above the ground');
    await btn.click();
    await page.waitForTimeout(1500);
    const back = await pose();
    const d = Math.hypot(back.c[0] - start.c[0], back.c[1] - start.c[1], back.c[2] - start.c[2]) + Math.hypot(back.t[0] - start.t[0], back.t[1] - start.t[1], back.t[2] - start.t[2]);
    assert.ok(d < 1.5, `reset restores the opening framing (off by ${d.toFixed(2)})`);
    // a double tap on the 3D view also resets
    await page.evaluate(async () => { const v = await window.__ps.getViewer(); v.controls.target.set(60, 0, 60); v.camera.position.set(60, 40, 120); v.controls.update(); });
    const box = await page.locator('.ps3d-canvas').first().boundingBox();
    const x = box.x + box.width / 2; const y = box.y + box.height * 0.4;
    await page.touchscreen.tap(x, y); await page.waitForTimeout(80); await page.touchscreen.tap(x, y);
    await page.waitForTimeout(1500);
    const dbl = await pose();
    const d2 = Math.hypot(dbl.c[0] - start.c[0], dbl.c[1] - start.c[1], dbl.c[2] - start.c[2]);
    assert.ok(d2 < 1.5, `a double tap resets the view (off by ${d2.toFixed(2)})`);
    assert.deepEqual(page.errs, []);
  } finally { await br.close(); server.close(); }
});
