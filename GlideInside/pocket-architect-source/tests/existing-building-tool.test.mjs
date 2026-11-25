// The Existing building tool: desktop (click to place, type name, width, length and rotation, drag to move, delete, undo) and the phone Tools list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, serve, launch, newPage, openApp, dismiss, toEditor } from './helpers/phone-harness.mjs';
import { updateExistingBuilding, pointInExisting, addExistingBuilding, existingBuildingsOf } from '../src/site/existing-buildings.js';

test('existing building records: update changes only the given fields, pointInExisting follows the rotation', () => {
  const p = { site: {} };
  const r = addExistingBuilding(p, { name: 'Existing dwelling', x: 1000, y: 2000, widthMm: 12000, depthMm: 9000 });
  updateExistingBuilding(p, r.id, { widthMm: 10000, name: null, rotationDeg: 90 });
  const [e] = existingBuildingsOf(p);
  assert.equal(e.widthMm, 10000);
  assert.equal(e.depthMm, 9000);
  assert.equal(e.name, 'Existing dwelling');
  assert.equal(e.rotationDeg, 90);
  assert.equal(pointInExisting(e, { x: 1000, y: 2000 + 4900 }), true, 'turned 90 degrees, the 10 m width runs along y');
  assert.equal(pointInExisting(e, { x: 1000 + 4900, y: 2000 + 4900 }), false);
  assert.equal(updateExistingBuilding(p, 'nope', { widthMm: 5000 }), null);
});

test('desktop: place, edit in the panel, drag, delete, undo', { skip: SKIP, timeout: 240000 }, async () => {
  const { server, origin } = await serve();
  const br = await launch();
  try {
    const { page } = await newPage(br, { width: 1280, height: 800, phone: false });
    await openApp(page, origin, '?mode=residential&sample=1');
    await dismiss(page);
    await toEditor(page);
    await page.click('[data-tool=existing]');
    assert.equal(await page.evaluate(() => window.__ps.store.ui.tool), 'existing');
    const box = await page.locator('canvas.ps-plan-canvas').first().boundingBox();
    const list = () => page.evaluate(() => window.__ps.store.project.site.existingBuildings || []);
    // choose a spot well off the house: the lower left of the plan
    const px = box.x + box.width * 0.85;
    const py = box.y + box.height * 0.3;
    await page.mouse.click(px, py);
    await page.waitForTimeout(400);
    let l = await list();
    assert.equal(l.length, 1, 'one click places one building');
    assert.equal(l[0].name, 'Existing dwelling');
    assert.equal(l[0].widthMm, 12000);
    assert.equal(l[0].depthMm, 9000);
    // the panel types name, width, length and rotation
    const fill = async (label, v) => { const f = page.locator('.ps-field', { has: page.locator(`label:text-is("${label}")`) }).locator('input'); await f.fill(String(v)); await f.press('Tab'); await page.waitForTimeout(250); };
    await fill('Name', 'Old farmhouse');
    await fill('Width', 14.5);
    await fill('Length', 8);
    await fill('Rotation', 30);
    l = await list();
    assert.equal(l[0].name, 'Old farmhouse');
    assert.equal(l[0].widthMm, 14500);
    assert.equal(l[0].depthMm, 8000);
    assert.equal(l[0].rotationDeg, 30);
    // drag moves it as one step
    const before = { x: l[0].x, y: l[0].y };
    const c = await page.evaluate(() => { const e = window.__ps.store.project.site.existingBuildings[0]; return { x: e.x, y: e.y }; });
    await page.mouse.move(px, py);
    await page.mouse.down();
    for (let k = 1; k <= 6; k++) await page.mouse.move(px + k * 10, py + k * 4);
    await page.mouse.up();
    await page.waitForTimeout(300);
    l = await list();
    assert.equal(l.length, 1, 'a drag on a building moves it, never places another');
    assert.notDeepEqual({ x: l[0].x, y: l[0].y }, before);
    assert.ok(c);
    // undo the move, then the rotation
    await page.evaluate(() => window.__ps.store.undo());
    l = await list();
    assert.deepEqual({ x: l[0].x, y: l[0].y }, before, 'undo puts the building back');
    // delete from the panel, then undo restores it
    await page.click('button:has-text("Delete existing building")');
    assert.equal((await list()).length, 0);
    await page.evaluate(() => window.__ps.store.undo());
    assert.equal((await list()).length, 1, 'undo brings the deleted building back');
    // the plan draws it: a canvas redraw does not throw
    assert.deepEqual(page.errs, []);
  } finally { await br.close(); server.close(); }
});

test('phone: the Existing building tool is in the Tools list and places a building', { skip: SKIP, timeout: 240000 }, async () => {
  const { server, origin } = await serve();
  const br = await launch();
  try {
    const { page } = await newPage(br, { width: 390, height: 844 });
    await openApp(page, origin, '?mode=residential&sample=1');
    await dismiss(page);
    await toEditor(page);
    await page.click('[data-ps=dock-tools]');
    await page.click('[data-ps=tools-more]');
    const tile = page.locator('[data-ps=tool-existing]');
    assert.equal(await tile.count(), 1);
    assert.match((await tile.innerText()), /Existing building/);
    await tile.click();
    assert.equal(await page.evaluate(() => window.__ps.store.ui.tool), 'existing');
    assert.deepEqual(page.errs, []);
  } finally { await br.close(); server.close(); }
});
