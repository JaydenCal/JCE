// Moving and turning the house with real touch input in the phone editor 3D view (CDP touch events): one finger on the house drags it with orbit
// off, a finger off the house orbits the camera, two fingers twist, the Rotate buttons turn 15 degrees, the rotate handle is a 44 px target, and
// each move and turn is one undo step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, serve, launch, newPage, openApp } from './helpers/phone-harness.mjs';
import { toGrannyEditor } from './helpers/phone-editor.mjs';

const SHOTS = '/home/claude/shots-7a';

test('phone 390x844: touch move, orbit off the house, twist, 15 degree buttons, handle size, one undo step each', { skip: SKIP, timeout: 400000 }, async () => {
  const { server, origin } = await serve();
  const br = await launch();
  try {
    const { ctx, page } = await newPage(br, { width: 390, height: 844, simple: true });
    await openApp(page, origin, '?mode=residential&sample=1');
    await toGrannyEditor(page);
    await page.evaluate(() => {
      const s = window.__ps.store; const a = s.apply.bind(s); window.__applied = [];
      s.apply = (l, f) => { window.__applied.push(l); return a(l, f); };
    });
    const info = () => page.evaluate(async () => {
      const v = await window.__ps.getViewer(); const p = window.__ps.store.project;
      const rs = p.levels[0].rooms; const xs = rs.flatMap((r) => r.polygon.map((q) => q.x)); const ys = rs.flatMap((r) => r.polygon.map((q) => q.y));
      const c = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
      const w0 = p.levels[0].walls[0]; const ang = Math.round((Math.atan2(w0.b.y - w0.a.y, w0.b.x - w0.a.x) * 180) / Math.PI);
      const e = v.camera.matrixWorldInverse.elements; const pr = v.camera.projectionMatrix.elements;
      const m = (M, q) => [0, 1, 2, 3].map((r) => M[r] * q[0] + M[4 + r] * q[1] + M[8 + r] * q[2] + M[12 + r] * q[3]);
      const clip = m(pr, m(e, [c.x / 1000, 1.2, c.y / 1000, 1]));
      const cv = document.querySelector('canvas.ps3d-canvas').getBoundingClientRect();
      return { c, ang, sx: cv.left + ((clip[0] / clip[3] + 1) / 2) * cv.width, sy: cv.top + ((1 - clip[1] / clip[3]) / 2) * cv.height, orbit: v.controls.enabled, ta: document.querySelector('canvas.ps3d-canvas').style.touchAction, cam: [v.camera.position.x, v.camera.position.y, v.camera.position.z].map((n) => Math.round(n * 100)) };
    });
    const cdp = await ctx.newCDPSession(page);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i })) });
    const keepIfAsked = async () => { // a drop outside the setbacks asks first: keep it
      const b = page.locator('button:has-text("Keep this position")');
      try { await b.first().waitFor({ state: 'visible', timeout: 7000 }); await b.first().click(); } catch { /* no question was asked */ }
      await page.waitForTimeout(600);
    };
    const i0 = await info();
    assert.equal(i0.orbit, true);

    // 1. one finger off the house orbits the camera and never commits anything
    await T('touchStart', [[60, 200]]);
    for (let k = 1; k <= 6; k++) { await T('touchMove', [[60 + k * 20, 200]]); await page.waitForTimeout(25); }
    await T('touchEnd', []);
    await page.waitForTimeout(500);
    const iOrbit = await info();
    assert.notDeepEqual(iOrbit.cam, i0.cam, 'a drag that starts off the house orbits the camera');
    assert.deepEqual(await page.evaluate(() => window.__applied), [], 'nothing was committed');
    await page.waitForTimeout(500);
    await page.click('[data-ps=view3d-reset]'); // the orbit moved the house out of view: Reset view brings it back
    await page.waitForTimeout(2500);

    // 2. one finger on the house drags it: orbit off and touch-action none during, back after, one undo step
    const a = await info();
    await T('touchStart', [[a.sx, a.sy]]);
    for (let k = 1; k <= 8; k++) { await T('touchMove', [[a.sx + k * 8, a.sy + k]]); await page.waitForTimeout(25); }
    const during = await info();
    assert.equal(during.orbit, false, 'orbit is off while the house drags');
    assert.equal(during.ta, 'none', 'touch-action is none on the canvas during the drag');
    assert.deepEqual(during.c, a.c, 'the project is only changed on release (live preview, one commit)');
    await page.screenshot({ path: '/home/claude/shots-7a/phone-house-being-moved.png' });
    await T('touchEnd', []);
    await keepIfAsked();
    const b = await info();
    assert.equal(b.orbit, true, 'orbit is back');
    assert.notDeepEqual(b.c, a.c, 'the house moved');
    assert.deepEqual(await page.evaluate(() => window.__applied), ['Move house'], 'one commit');
    assert.equal(await page.locator('.ps3d-rot-handle').isVisible(), true, 'the house is selected: the rotate handle shows');
    const hb = await page.locator('.ps3d-rot-handle').boundingBox();
    assert.ok(hb.width >= 44 && hb.height >= 44, `the rotate handle is 44 px (${hb.width} x ${hb.height})`);
    await page.screenshot({ path: '/home/claude/shots-7a/phone-rotate-handle.png' });
    await page.evaluate(() => window.__ps.store.undo());
    await page.waitForTimeout(500);
    assert.deepEqual((await info()).c, a.c, 'one undo puts the house back');

    // 3. the Rotate buttons turn 15 degrees, one step each
    await page.evaluate(() => { window.__applied = []; });
    const c0 = await info();
    await page.locator('[data-ps=house-turn-right]').click();
    await keepIfAsked();
    const c1 = await info();
    assert.equal(((c1.ang - c0.ang + 540) % 360) - 180, 15, 'turned 15 degrees clockwise');
    await page.locator('[data-ps=house-turn-left]').click();
    await keepIfAsked();
    assert.equal((await info()).ang, c0.ang, 'and 15 back');
    assert.deepEqual(await page.evaluate(() => window.__applied), ['Rotate house', 'Rotate house']);
    const bar = await page.locator('[data-ps=house-turn-right]').boundingBox();
    assert.ok(bar.height >= 44, 'the buttons are 44 px');

    // 4. two fingers twist the house, orbit off while both are down, one undo step
    await page.evaluate(() => { window.__applied = []; });
    const d0 = await info();
    const r = 50;
    const P = (deg) => [[d0.sx + r * Math.cos(deg * Math.PI / 180), d0.sy + r * Math.sin(deg * Math.PI / 180)], [d0.sx - r * Math.cos(deg * Math.PI / 180), d0.sy - r * Math.sin(deg * Math.PI / 180)]];
    await T('touchStart', [P(0)[0]]);
    await T('touchStart', P(0));
    for (let deg = 10; deg <= 60; deg += 10) { await T('touchMove', P(deg)); await page.waitForTimeout(30); }
    assert.equal((await info()).orbit, false, 'orbit is off while two fingers are on the house');
    await T('touchEnd', []);
    await keepIfAsked();
    const d1 = await info();
    assert.equal(d1.orbit, true);
    const turned = ((d1.ang - d0.ang + 540) % 360) - 180;
    assert.ok(Math.abs(turned - 60) <= 3, `a 60 degree twist turned the house by about 60 (${turned})`);
    assert.deepEqual(await page.evaluate(() => window.__applied), ['Move house', 'Rotate house'].slice(1), 'the twist is one step (the first finger placed on the house made no move)');
    await page.evaluate(() => window.__ps.store.undo());
    await page.waitForTimeout(500);
    assert.equal((await info()).ang, d0.ang, 'one undo takes the whole twist back');
    assert.deepEqual(page.errs.filter((e) => !/401|WebGL|GPU/i.test(e)), []);
  } finally { await br.close(); server.close(); }
});
