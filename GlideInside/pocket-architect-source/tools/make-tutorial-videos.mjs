#!/usr/bin/env node
// Records the how to videos for the tutorial chapters (one per chapter, plus a longer overview for each mode) from the real app, and writes them
// with posters to website-live/help/videos/. Re-run it after a UI change:
//   node tools/make-tutorial-videos.mjs [--only residential-place,commercial-overview] [--shots] [--keep]
//
// How it works:
//   1. website-live is served with `python3 -m http.server` on an unused port; /api calls are routed to a local stub of the Worker app that
//      knows the sample lot (tools/resiflow-harness.cjs), so no network or API key is needed.
//   2. Playwright drives the real UI (recordVideo at 1280x720) with deliberately paced clicks, drags and typing on the sample lot. A cursor dot
//      and click ring are drawn in the page so viewers can follow the pointer. Each scenario fast forwards through its setup and calls
//      rec.begin(), and everything before that is trimmed off.
//   3. ffmpeg burns a large caption bar under the screen for each action, adds a short Glide Inside title card, encodes H.264 (veryfast, CRF about
//      28, faststart, no audio) and takes a poster JPG. Clips stay under 4 MB and overviews under 15 MB.
//   4. help/videos/manifest.json is written and the grid on help/index.html is regenerated (tools/help-page.mjs).
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { CHAPTERS, BASICS_ID } from '../src/tutorial/steps.js';
import { updatePage, VIDEOS, SITE } from './help-page.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require.resolve('playwright', { paths: ['/opt/npm-tools/node_modules', process.env.NODE_PATH || ''] }))); }
const { startServer } = require('./resiflow-harness.cjs');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const ONLY = (opt('only') || '').split(',').filter(Boolean);
const SHOTS = flag('shots'); // a screenshot at each caption, into the scratch folder, for debugging a scenario
const FFMPEG = process.env.FFMPEG || '/usr/local/bin/ffmpeg';
const FONT_B = '/usr/share/fonts/opentype/inter/Inter-Bold.otf';
const FONT_S = '/usr/share/fonts/opentype/inter/Inter-SemiBold.otf';
const W = 1280, H = 640, BAR = 80, GOLD = '0xe9b66f', NAVY = '0x0a111e';
const T = Number(process.env.VIDEO_TIMEOUT || 240000); // generous: the machine that records may be busy

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (page, sel) => page.locator(sel).first();

// ---------------------------------------------------------------------------------------------------------------------------------------
// Recorder: paced actions plus a caption log
// ---------------------------------------------------------------------------------------------------------------------------------------
const DISMISS_JS = `(() => { window.__dismissPrompt = true; setInterval(() => { const q = (x) => document.querySelector(x); const hit = (b) => b && b.click();
  if (window.__dismissPrompt) hit(q('[data-action="prompt-notnow"]'));
  hit(q('[data-ps="fit-coach-skip"]'));
  const g = [...document.querySelectorAll('.pso-btn--primary')].find((b) => /Got it/.test(b.textContent)); hit(g); }, 350); })();`;
const CURSOR_JS = `(() => {
  const dot = document.createElement('div');
  dot.style.cssText = 'position:fixed;z-index:2147483647;left:0;top:0;width:22px;height:22px;margin:-3px 0 0 -3px;pointer-events:none;transition:left var(--cur-ms,650ms) cubic-bezier(.45,0,.2,1),top var(--cur-ms,650ms) cubic-bezier(.45,0,.2,1)';
  dot.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 17 L7.2 13.2 L10 19.5 L12.6 18.4 L9.8 12.2 L15.5 12 Z" fill="#fff" stroke="#0a111e" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const ring = document.createElement('div');
  ring.style.cssText = 'position:fixed;z-index:2147483646;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:4px solid #e9b66f;pointer-events:none;opacity:0;transform:scale(.4)';
  const add = () => { document.documentElement.append(ring, dot); };
  if (document.documentElement) add(); else addEventListener('DOMContentLoaded', add);
  addEventListener('mousemove', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px'; }, true);
  addEventListener('mousedown', () => { ring.style.transition = 'none'; ring.style.opacity = '1'; ring.style.transform = 'scale(.4)'; requestAnimationFrame(() => requestAnimationFrame(() => { ring.style.transition = 'transform .45s ease-out, opacity .45s ease-out'; ring.style.transform = 'scale(1.15)'; ring.style.opacity = '0'; })); }, true);
})();`;

class Rec {
  constructor(page, id, dir) { this.page = page; this.id = id; this.dir = dir; this.t0 = Date.now(); this.caps = []; this.startAt = null; this.endAt = null; this.cuts = []; this.x = 640; this.y = 360; this.n = 0; }
  get now() { return (Date.now() - this.t0) / 1000; }
  begin() { this.startAt = this.now; this.caps = []; }
  /** Show a caption from now until the next one. Keep it short: one line is about 54 characters. */
  async cap(text) {
    this.caps.push({ at: this.now, text });
    if (SHOTS) await this.page.screenshot({ path: path.join(this.dir, `${this.id}-${String(++this.n).padStart(2, '0')}.png`) }).catch(() => {});
  }
  finish() { this.endAt = this.now; }
  /** Run a slow step (a load, a render) and cut its dead time out of the video, keeping a short lead in and out. */
  async cut(fn) {
    const a = this.now; const v = await fn(); const b = this.now;
    if (this.startAt !== null && b - a > 1.6) this.cuts.push({ a: a + 0.5, b: b - 0.5 });
    return v;
  }
  /** Wait until the flow has stopped loading, placing or rendering. */
  quiet(extra = 1200) {
    return this.cut(async () => {
      await this.page.waitForFunction(() => !document.querySelector('[data-ps="flow-placing"],[data-ps="flow-3d-loading"],[data-ps="flow-spinner"],[data-ps="flow-loading-text"]'), null, { timeout: T });
      await sleep(extra);
    });
  }
  /** After Open the editor: wait for the editor shell. */
  editor() { return this.cut(async () => { await this.page.waitForFunction(() => document.querySelector('.ps-shell')?.dataset.flow === 'editor', null, { timeout: T }); await sleep(3000); await this.page.click('[data-ps="prompt-notnow"]', { timeout: 800 }).catch(() => {}); await this.page.click('[data-ps="fit-hide"]', { timeout: 300 }).catch(() => {}); await sleep(500); }); }
  step(n) { return this.cut(async () => { await this.page.waitForFunction((k) => Number(document.querySelector('[data-ps="flow-root"]:not([hidden])')?.dataset.step || 0) === k, n, { timeout: T }); await sleep(1200); await this.page.waitForFunction(() => !document.querySelector('[data-ps="flow-placing"],[data-ps="flow-3d-loading"],[data-ps="flow-spinner"],[data-ps="flow-loading-text"]'), null, { timeout: T }); await sleep(600); }); }
  async hold(ms) { await sleep(ms); }
  /** Move the pointer. The cursor dot glides in the page (a CSS transition), so a slow machine does not make the motion slow: the real
   *  pointer jumps once. While a button is held (a drag) the move is stepped, because the app follows the pointer events. */
  async glide(x, y, ms = 650, { drag = false } = {}) {
    if (!drag) { await this.page.mouse.move(x, y); await sleep(ms); }
    else {
      const steps = Math.max(3, Math.round(ms / 330)), x0 = this.x, y0 = this.y;
      for (let i = 1; i <= steps; i += 1) { const k = i / steps; await this.page.mouse.move(x0 + (x - x0) * k, y0 + (y - y0) * k); await sleep(ms / steps); }
    }
    this.x = x; this.y = y;
  }
  async fast(on) { await this.page.evaluate((v) => document.documentElement.style.setProperty('--cur-ms', v ? '110ms' : '650ms'), on); }
  async box(sel) {
    const loc = q(this.page, sel);
    await loc.waitFor({ state: 'visible', timeout: T });
    await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    const b = await loc.boundingBox();
    if (!b) throw new Error(`no box for ${sel}`);
    return b;
  }
  async at(sel, fx = 0.5, fy = 0.5) { const b = await this.box(sel); return { x: b.x + b.width * fx, y: b.y + b.height * fy }; }
  async point(sel, fx, fy, ms) { const p = await this.at(sel, fx, fy); await this.glide(p.x, p.y, ms); return p; }
  async click(sel, { fx = 0.5, fy = 0.5, after = 900 } = {}) {
    if (sel.includes('profile-save')) await this.page.evaluate(() => { window.__dismissPrompt = false; });
    const p = await this.at(sel, fx, fy);
    await this.glide(p.x, p.y, 700);
    await sleep(250);
    await this.page.mouse.down(); await sleep(90); await this.page.mouse.up();
    await sleep(after);
  }
  /** Click the first VISIBLE match by script-measured box (robust when the panel re-renders under load); returns false if none. */
  async softClick(sel, { after = 1200 } = {}) {
    const b = await this.page.evaluate((q) => { const el = [...document.querySelectorAll(q)].find((e) => e.getClientRects().length); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
    if (!b) return false;
    await this.clickAt(b.x, b.y, { after }); return true;
  }
  async clickAt(x, y, { after = 700 } = {}) { await this.glide(x, y, 600); await sleep(200); await this.page.mouse.down(); await sleep(80); await this.page.mouse.up(); await sleep(after); }
  async dblclickAt(x, y, { after = 900 } = {}) { await this.glide(x, y, 600); await sleep(200); await this.page.mouse.dblclick(x, y); await sleep(after); }
  async type(sel, text, { delay = 130, after = 900 } = {}) {
    await this.click(sel, { after: 300 });
    await this.page.keyboard.type(text, { delay });
    await sleep(after);
  }
  async pick(sel, value, { after = 1100 } = {}) { await this.point(sel, 0.5, 0.5, 600); await sleep(300); await q(this.page, sel).selectOption(value); await sleep(after); }
  async drag(from, to, { ms = 900, steps = null } = {}) {
    await this.glide(from.x, from.y, 700); await sleep(250);
    await this.page.mouse.down(); await this.fast(true); await sleep(150);
    if (steps) { for (const st of steps) await this.glide(st.x, st.y, ms / steps.length, { drag: true }); } else await this.glide(to.x, to.y, ms, { drag: true });
    await sleep(200); await this.page.mouse.up(); await this.fast(false); await sleep(700);
  }
  async key(k, { after = 600 } = {}) { await this.page.keyboard.press(k); await sleep(after); }
  /** Plan point (mm) to page pixels, via the editor. */
  async plan(p) { return this.page.evaluate((pt) => window.__ps.editor.toClient(pt), p); }
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Setup helpers: fast, never recorded (everything before rec.begin() is trimmed)
// ---------------------------------------------------------------------------------------------------------------------------------------
const flowStep = (page) => page.evaluate(() => Number(document.querySelector('[data-ps="flow-root"]:not([hidden])')?.dataset.step || 0));
const idle = async (page) => { await page.waitForFunction(() => !document.querySelector('[data-ps="flow-placing"]'), null, { timeout: T }); await sleep(700); };
async function quietClick(page, sel, ms = 600) { await q(page, sel).click({ timeout: T }); await sleep(ms); }
async function setupFind(page) {
  for (let k = 0; k < 4; k += 1) {
    await page.fill('[data-ps="flow-address"]', '');
    await page.fill('[data-ps="flow-address"]', '14 Sample');
    await page.waitForSelector('[data-ps="flow-suggest"] li', { timeout: T });
    await sleep(900);
    await page.click('[data-ps="flow-suggest"] li');
    try { await page.waitForSelector('[data-ps="flow-lot-label"]', { timeout: 40000 }); break; } catch { if (k === 3) throw new Error('the lot did not load'); }
  }
  await page.waitForFunction(() => !document.querySelector('[data-ps="flow-loading-text"],[data-ps="flow-spinner"]'), null, { timeout: T }).catch(() => {});
  await sleep(2500);
}
const waitStep = (page, n) => page.waitForFunction((k) => Number(document.querySelector('[data-ps="flow-root"]:not([hidden])')?.dataset.step || 0) === k, n, { timeout: T });
/** Press the flow's Next once it is enabled and wait until the flow reaches step n. */
async function nextTo(page, n) {
  await page.waitForFunction(() => { const b = document.querySelector('[data-ps="flow-next"]'); return b && !b.disabled; }, null, { timeout: T });
  await page.click('[data-ps="flow-next"]', { timeout: T });
  await waitStep(page, n); await sleep(900);
}
async function toStep(page, kind, n) {
  if (n >= 2) { await setupFind(page); await nextTo(page, 2); }
  if (n >= 3) {
    if (kind === 'commercial') { await page.waitForSelector('[data-ps="flow-type"]', { timeout: T }); await q(page, '[data-ps="flow-type"][data-type="warehouse"]').click(); await sleep(800); await idle(page); }
    else { await page.waitForSelector('[data-ps="flow-home"]', { timeout: T }); await page.locator('[data-ps="flow-home"]').first().click(); await sleep(500); }
    await nextTo(page, 3); await idle(page);
    await page.click('[data-ps="fit-coach-skip"]', { timeout: 3000 }).catch(() => {});
  }
  if (n >= 4) { await nextTo(page, 4); await idle(page); await page.click('[data-ps="prompt-notnow"]', { timeout: 1500 }).catch(() => {}); }
}
async function toEditor(page, kind) {
  await toStep(page, kind, 4);
  await openEditor(page);
}
async function openEditor(page) {
  await page.waitForFunction(() => { const b = document.querySelector('[data-ps="flow-next"]'); return b && !b.disabled; }, null, { timeout: T });
  await page.click('[data-ps="flow-next"]', { timeout: T });
  await page.waitForFunction(() => document.querySelector('.ps-shell')?.dataset.flow === 'editor', null, { timeout: T });
  await sleep(3000);
  await page.click('[data-ps="prompt-notnow"]', { timeout: 3000 }).catch(() => {});
  await page.click('[data-ps="fit-hide"]', { timeout: 500 }).catch(() => {});
  await sleep(800);
}
/** The lot boundary in plan mm: bounding box, so scenarios can aim at fractions of it. */
const lotBox = (page) => page.evaluate(() => { const b = window.__ps.store.project.site.lot.boundary; const xs = b.map((p) => p.x), ys = b.map((p) => p.y); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; });
const levelInfo = (page) => page.evaluate(() => { const l = window.__ps.store.project.levels[0]; return { walls: l.walls.map((w) => ({ id: w.id, a: w.a || w.start || w.p0 || w.points?.[0], b: w.b || w.end || w.p1 || w.points?.[1] })), rooms: l.rooms.map((r) => ({ id: r.id, polygon: r.polygon })) }; });
const centroid = (poly) => ({ x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length });
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// Shared segments, reused by the chapter clips and the overviews
const seg = {
  async find(r, kind, short = false) {
    const page = r.page;
    await r.cap(kind === 'commercial' ? 'Type the address of your site' : 'Type your street address');
    await r.type('[data-ps="flow-address"]', '14 Sample', { delay: 150, after: 1500 });
    await r.cap('Choose your address from the list');
    await r.cut(() => page.waitForSelector('[data-ps="flow-suggest"] li', { timeout: T })); await r.hold(1200);
    await r.click('[data-ps="flow-suggest"] li', { after: 500 });
    await r.cut(async () => { await page.waitForSelector('[data-ps="flow-lot-label"]', { timeout: T }); await page.waitForFunction(() => !document.querySelector('[data-ps="flow-loading-text"],[data-ps="flow-spinner"]'), null, { timeout: T }); await sleep(2500); });
    await r.cap('Check the lot and plan number');
    await r.point('[data-ps="flow-lot-label"]', 0.5, 0.5); await r.hold(short ? 1000 : 2200);
    await r.cap('The setbacks show where a building can go');
    await r.point('[data-ps="flow-setbacks"]', 0.5, 0.4); await r.hold(short ? 1200 : 3200);
    if (!short) { await r.cap('No address? Use the sample lot to try it');
    await r.point('[data-ps="flow-sample"]', 0.5, 0.5); await r.hold(2200); }
    await r.cap('Press This is my lot to continue');
    await r.click('[data-ps="flow-next"]', { after: 300 }); await r.step(2);
  },
};

// ---------------------------------------------------------------------------------------------------------------------------------------
// Scenarios. Each takes (page, rec) on a fresh app (tutorial card off) and returns when the clip is done.
// ---------------------------------------------------------------------------------------------------------------------------------------
const SCENARIOS = {};

SCENARIOS['residential-find'] = { kind: 'residential', run: async (r) => { r.begin(); await seg.find(r, 'residential'); await r.cap('Step 2: now choose a design'); await r.hold(1500); } };

SCENARIOS['residential-design'] = { kind: 'residential', setup: (p) => toStep(p, 'residential', 2), run: async (r) => {
  r.begin();
  await r.cap('Each design shows its size and whether it fits'); await r.point('[data-ps="flow-homes"]', 0.5, 0.15, 900); await r.hold(2200);
  await r.cap('Filter by number of bedrooms'); await r.pick('[data-ps="flow-filter-bedrooms"]', '3');
  await r.cap('Filter by storeys'); await r.pick('[data-ps="flow-filter-storeys"]', '1');
  await r.cap('Enter your lot width to hide designs that are too wide'); await r.pick('[data-ps="flow-filter-frontage"]', '14');
  await r.cap('Show only the designs that fit this lot'); await r.pick('[data-ps="flow-filter-fits"]', '1');
  await r.cap('Click a design to choose it'); await r.click('[data-ps="flow-home"]', { after: 1800 });
  await r.cap('Then press Place this home'); await r.click('[data-ps="flow-next"]', { after: 300 }); await r.step(3);
} };

SCENARIOS['residential-place'] = { kind: 'residential', setup: (p) => toStep(p, 'residential', 3), run: async (r) => {
  r.begin();
  await r.cap('The home is placed square to the street'); await r.hold(2500);
  const house = await r.at('[data-ps="flow-house"]', 0.5, 0.5);
  await r.cap('Drag the house to move it');
  await r.drag(house, { x: house.x + 34, y: house.y - 26 }, { ms: 1100 }); await r.quiet(600);
  await r.cap('Drag the gold ring to turn it');
  const hc = await r.at('[data-ps="flow-house"]', 0.5, 0.5); const hd = await r.at('[data-ps="flow-handle"]', 0.5, 0.5);
  const rad = Math.hypot(hd.x - hc.x, hd.y - hc.y), a0 = Math.atan2(hd.y - hc.y, hd.x - hc.x);
  const arc = [0.25, 0.5, 0.75, 1].map((k) => ({ x: hc.x + rad * Math.cos(a0 + k * Math.PI / 2), y: hc.y + rad * Math.sin(a0 + k * Math.PI / 2) }));
  await r.drag(hd, null, { ms: 1400, steps: arc }); await r.quiet(600);
  await r.cap('Push it outside the setbacks and the status turns red');
  for (let i = 0; i < 6; i += 1) { await r.click('[data-ps="flow-nudge-left"]', { after: 100 }); } await r.quiet();
  await r.hold(1800);
  await r.cap('Best fit is Auto fit: it puts the home right again'); await r.click('[data-ps="flow-bestfit"]', { after: 500 });
  await r.quiet(); await r.hold(2500);
} };

SCENARIOS['residential-edit'] = { kind: 'residential', setup: async (p) => { await toEditor(p, 'residential'); await q(p, '[data-ps="zoom-building"]').click({ timeout: 5000 }).catch(() => {}); }, run: async (r) => {
  const page = r.page;
  const { rooms } = await levelInfo(page);
  const room = rooms[0], c = centroid(room.polygon);
  r.begin();
  await r.cap('The editor opens with your design on the plan'); await r.hold(2200);
  await r.cap('Edit room: turn it on in the 3D view'); await r.click('[data-ps="room-edit-arm"]', { after: 2200 });
  await r.cap('Wall tool: click the start, then the end'); await r.click('[data-tool="wall"]');
  const a = await r.plan({ x: c.x - 1500, y: c.y }), b = await r.plan({ x: c.x + 1500, y: c.y });
  await r.clickAt(a.x, a.y); await r.clickAt(b.x, b.y, { after: 500 }); await r.key('Enter', { after: 1500 });
  await r.cap('Door tool: click on a wall'); await r.click('[data-tool="door"]');
  const { walls } = await levelInfo(page); const w = walls[walls.length - 1];
  const wp = w?.a && w?.b ? await r.plan(lerp(w.a, w.b, 0.3)) : a;
  await r.clickAt(wp.x, wp.y, { after: 1500 });
  await r.cap('Window tool: the same way'); await r.click('[data-tool="window"]');
  const wp2 = w?.a && w?.b ? await r.plan(lerp(w.a, w.b, 0.75)) : b;
  await r.clickAt(wp2.x, wp2.y, { after: 1500 });
  await r.cap('Select anything to change it in the panel'); await r.click('[data-tool="select"]');
  await r.clickAt(wp.x, wp.y, { after: 2500 });
} };

SCENARIOS['residential-driveway'] = { kind: 'residential', setup: (p) => toStep(p, 'residential', 3), run: async (r) => {
  const page = r.page;
  r.begin();
  await r.cap('Drag the round handle to slide the driveway entry');
  const dh = await r.at('[data-ps="flow-drive-handle"]', 0.5, 0.5);
  await r.drag(dh, { x: dh.x + 36, y: dh.y }, { ms: 1000 }); await r.hold(600);
  await r.cap('Add bend puts a corner in the driveway');
  await r.click('[data-ps="flow-drive-bend"]', { after: 1000 }); await r.click('[data-ps="flow-drive-bend"]', { after: 1200 });
  await r.cut(async () => { await nextTo(page, 4); await idle(page); await openEditor(page); await q(page, '[data-ps="lc-minimise"]').click({ timeout: 3000 }).catch(() => {}); await q(page, '[data-view="2d"]').click({ timeout: 3000 }).catch(() => {}); await sleep(1500); await q(page, '[data-ps="zoom-development"]').click({ timeout: 3000 }).catch(() => {}); await sleep(800); });
  await r.cap('In the editor, the Driveway PIs tool edits the bends'); await r.click('[data-tool="drivepi"]', { after: 1500 });
  await page.click('[data-ps="prompt-notnow"]', { timeout: 1500 }).catch(() => {});
  await page.evaluate(() => { const g = window.getSelection(); g && g.removeAllRanges(); });
  const dr = () => page.evaluate(() => { const d = window.__ps.editor.drivepi.draft(); return { centre: d.centre.map((q) => ({ x: q.x, y: q.y })), pis: d.pis.map((q) => ({ x: q.x, y: q.y })) }; });
  const before = await dr();
  let bi = 0, bl = -1;
  for (let i = 0; i + 1 < before.centre.length; i += 1) { const l = Math.hypot(before.centre[i + 1].x - before.centre[i].x, before.centre[i + 1].y - before.centre[i].y); if (l > bl) { bl = l; bi = i; } }
  const mid = lerp(before.centre[bi], before.centre[bi + 1], 0.5);
  await r.cap('Click the driveway centreline to add a PI');
  const m = await r.plan(mid); await r.clickAt(m.x, m.y, { after: 1400 });
  await r.cap('Drag a square to move the PI');
  const after = await dr();
  const nw = after.pis.find((q) => !before.pis.some((o) => Math.abs(o.x - q.x) < 5 && Math.abs(o.y - q.y) < 5)) || mid;
  const from = await r.plan(nw);
  await r.drag(from, { x: from.x + 30, y: from.y + 14 }, { ms: 1000 }); await r.hold(900);
  await r.cap('Pick a bend radius to round every PI'); await r.softClick('[data-ps="drivepi-radius"] button:nth-child(3)', { after: 1600 });
  await r.cap('Delete PI removes the selected bend'); await r.softClick('[data-ps="drivepi-delete"]', { after: 1500 });
  await r.cap('Reset to auto brings the automatic driveway back'); await r.softClick('[data-ps="drivepi-reset"]', { after: 2200 });
} };

SCENARIOS['residential-view3d'] = { kind: 'residential', setup: (p) => toStep(p, 'residential', 4), run: async (r) => {
  const page = r.page;
  r.begin();
  await r.cap('The Check step shows your design in 3D'); await r.hold(2500);
  const c = await r.at('[data-ps="flow-3d"]', 0.5, 0.5);
  await r.cap('Drag to look around'); await r.drag({ x: c.x - 60, y: c.y }, { x: c.x + 90, y: c.y - 10 }, { ms: 1400 });
  await r.cap('Open the editor for the full 3D view'); await r.click('[data-ps="flow-next"]', { after: 300 }); await r.editor();
  await page.click('[data-ps="prompt-notnow"]', { timeout: 3000 }).catch(() => {});
  await r.cap('3D fills the whole screen'); await r.click('[data-view="3d"]', { after: 2500 });
  await r.cap('Preset views: Aerial'); await r.softClick('[data-ps="view3d-aerial"]', { after: 2500 });
  await r.cap('Street view'); await r.softClick('[data-ps="view3d-hero"]', { after: 2500 });
  await r.cap('Walk puts you inside at eye height'); await r.click('[data-view="walk"]', { after: 2500 });
  await r.cap('Use W A S D to move and drag to look');
  await page.keyboard.down('w'); await sleep(1400); await page.keyboard.up('w'); await r.hold(600);
  await r.drag({ x: 640, y: 360 }, { x: 760, y: 360 }, { ms: 900 }); await r.hold(1200);
} };

SCENARIOS['residential-save'] = { kind: 'residential', setup: (p) => toEditor(p, 'residential'), run: async (r) => {
  const page = r.page;
  r.begin();
  await r.cap('Your design is built as you go'); await r.hold(2000);
  await r.cap('Save design keeps your work in a free profile'); await r.click('[data-action="profile-save"]', { after: 3000 });
  await page.click('[data-ps="prompt-notnow"]', { timeout: 1500 }).catch(() => {});
  await page.keyboard.press('Escape'); await sleep(600);
  await r.cap('Save also downloads a file you can keep'); await r.point('[data-action="save"]'); await r.hold(2200);
  await r.cap('Open brings back a saved design'); await r.point('[data-action="open"]'); await r.hold(2200);
  await r.cap('Share makes a link to view the design'); await r.click('[data-action="share"]', { after: 3000 });
  await page.keyboard.press('Escape'); await sleep(800);
} };

SCENARIOS['residential-planset'] = { kind: 'residential', setup: (p) => toEditor(p, 'residential'), run: async (r) => {
  const page = r.page;
  r.begin();
  await r.cap('The lot card shows the key numbers'); await r.point('[data-ps="lot-card"]', 0.5, 0.3); await r.hold(2500);
  await r.cap('Details opens the plan set buttons'); await r.softClick('[data-ps="lot-card"] .lc-more', { after: 1200 });
  await r.cap('Site plan PDF builds the plan set'); await r.point('[data-ps="lc-pdf"]'); await r.hold(1800);
  await r.cap('Send to engineer passes it on for the next stage');
  if (await q(page, '[data-ps="lc-send-engineer"]').isVisible().catch(() => false)) { await r.point('[data-ps="lc-send-engineer"]'); await r.hold(2500); }
  else await r.hold(2500);
} };

SCENARIOS['residential-overview'] = { kind: 'residential', run: async (r) => {
  const page = r.page;
  r.begin();
  await seg.find(r, 'residential', true);
  await r.cap('Step 2: filter and choose a design');
  await r.click('[data-ps="flow-home"]', { after: 1500 });
  await r.cap('Press Place this home'); await r.click('[data-ps="flow-next"]', { after: 300 }); await r.step(3);
  await page.click('[data-ps="fit-coach-skip"]', { timeout: 2000 }).catch(() => {});
  await r.cap('Step 3: drag the house, or press Best fit');
  const house = await r.at('[data-ps="flow-house"]', 0.5, 0.5);
  await r.drag(house, { x: house.x + 30, y: house.y - 24 }, { ms: 1100 }); await r.click('[data-ps="flow-bestfit"]', { after: 300 }); await r.quiet();
  await r.cap('Step 4: check the design in 3D'); await r.click('[data-ps="flow-next"]', { after: 300 }); await r.step(4);
  await r.hold(1800);
  await r.cap('Open the editor to change anything'); await r.click('[data-ps="flow-next"]', { after: 300 }); await r.editor();
  await page.click('[data-ps="prompt-notnow"]', { timeout: 3000 }).catch(() => {});
  await r.cap('3D shows the house on your lot'); await r.click('[data-view="3d"]', { after: 3000 });
  await r.click('[data-view="split"]', { after: 1500 });
  await r.cap('Save design keeps it in a free profile'); await r.click('[data-action="profile-save"]', { after: 2500 });
  await page.click('[data-ps="prompt-notnow"]', { timeout: 1500 }).catch(() => {}); await page.keyboard.press('Escape');
  await r.softClick('[data-ps="lot-card"] .lc-more', { after: 800 });
  await r.cap('Site plan PDF builds the plan set'); await r.point('[data-ps="lc-pdf"]'); await r.hold(2000);
  await r.cap('Press Show me how any time for more help'); await r.point('[data-ps="tutorial-help"]'); await r.hold(2500);
} };

// Commercial ----------------------------------------------------------------------------------------------------------------------------
SCENARIOS['commercial-find'] = { kind: 'commercial', run: async (r) => { r.begin(); await seg.find(r, 'commercial'); await r.cap('Step 2: choose what to build'); await r.hold(1500); } };

SCENARIOS['commercial-type'] = { kind: 'commercial', setup: (p) => toStep(p, 'commercial', 2), run: async (r) => {
  const page = r.page;
  r.begin();
  await r.cap('Choose a building type that suits the site'); await r.point('[data-ps="flow-types"]', 0.5, 0.3, 900); await r.hold(2200);
  const types = await page.locator('[data-ps="flow-type"]').count();
  await r.cap('Click a type to see its layouts'); await r.click('[data-ps="flow-type"]', { after: 2000 });
  if (types > 2) { await r.click('[data-ps="flow-type"] >> nth=2', { after: 2000 }); }
  await r.cap('Step through the layouts and the mix of buildings'); await r.point('[data-ps="flow-mix"]', 0.5, 0.3, 900); await r.hold(3000);
  await r.cap('Pick the wall finish'); await r.point('[data-ps="flow-wall"]', 0.5, 0.5); await r.hold(2500);
  await r.click('[data-ps="flow-type"][data-type="warehouse"]', { after: 1500 });
  await r.cap('Press next to place it on the lot'); await r.click('[data-ps="flow-next"]', { after: 300 }); await r.step(3);
} };

SCENARIOS['commercial-place'] = { kind: 'commercial', setup: (p) => toStep(p, 'commercial', 3), run: async (r) => {
  r.begin();
  await r.cap('The building and car park are laid out for you'); await r.hold(2200);
  const b = await r.at('[data-ps="flow-building"]', 0.5, 0.5);
  await r.cap('Drag the building to slide it on the lot'); await r.drag(b, { x: b.x + 30, y: b.y - 20 }, { ms: 1000 }); await r.quiet(600);
  await r.cap('Drag the entry and exit handles along the frontage');
  const ah = await r.at('[data-ps="flow-access-handle"]', 0.5, 0.5); await r.drag(ah, { x: ah.x + 50, y: ah.y }, { ms: 1000 }); await r.quiet(600);
  await r.cap('Try another layout with the arrows'); await r.click('[data-ps="flow-layout-next"]', { after: 400 }); await r.quiet(800);
  await r.cap('Best fit puts the building back'); await r.click('[data-ps="flow-bestfit"]', { after: 300 }); await r.quiet(); await r.hold(1500);
} };

SCENARIOS['commercial-hardstand'] = { kind: 'commercial', setup: async (p) => { await toEditor(p, 'commercial'); await q(p, '[data-ps="panel-close"], [data-action="panel-close"]').click({ timeout: 2000 }).catch(() => {}); }, run: async (r) => {
  const page = r.page;
  const lb = await lotBox(page);
  const at = (fx, fy) => ({ x: lb.x0 + (lb.x1 - lb.x0) * fx, y: lb.y0 + (lb.y1 - lb.y0) * fy });
  r.begin();
  await r.cap('The Hardstand tool draws car parks and paving'); await r.click('[data-tool="hardstand"]', { after: 2000 });
  await r.cap('Choose the pavement surface'); await r.point('[data-ps="hardstand-type"]'); await r.hold(1800);
  await r.cap('Drag a rectangle to draw a hardstand area');
  const a = await r.plan(at(0.12, 0.12)), b = await r.plan(at(0.34, 0.3));
  await r.drag(a, b, { ms: 1400 }); await r.hold(1800);
} };

SCENARIOS['commercial-numbers'] = { kind: 'commercial', setup: (p) => toStep(p, 'commercial', 4), run: async (r) => {
  const page = r.page;
  r.begin();
  await r.cap('The Check step lists floor area, coverage and parking'); await r.point('[data-ps="flow-summary"]', 0.5, 0.2, 900); await r.hold(3000);
  await r.cap('The finance cards show the indicative profit and yield'); await r.point('[data-ps="fin-cards"]', 0.5, 0.5); await r.hold(2800);
  await r.cap('Rough estimates help you compare options'); await r.point('[data-ps="flow-estimates"]', 0.5, 0.5); await r.hold(2800);
  await r.cap('Figures are indicative, check with council'); await r.hold(2200);
  await r.cap('Open the editor for the full feasibility numbers'); await r.click('[data-ps="flow-next"]', { after: 300 }); await r.editor();
  await page.click('[data-ps="prompt-notnow"]', { timeout: 3000 }).catch(() => {});
  if (await q(page, '[data-ps="cc-feas-open"]').isVisible().catch(() => false)) { await r.cap('See details opens the feasibility panel'); await r.click('[data-ps="cc-feas-open"]', { after: 3000 }); }
  else { await r.cap('The commercial panel holds the numbers'); await r.point('[data-ps="fz-headlines"]'); await r.hold(3000); }
} };

SCENARIOS['commercial-editor'] = { kind: 'commercial', setup: (p) => toEditor(p, 'commercial'), run: async (r) => {
  r.begin();
  await r.cap('The editor opens in Split view: plan and 3D'); await r.hold(2500);
  await r.cap('Plan shows just the plan'); await r.click('[data-view="2d"]', { after: 2200 });
  await r.cap('3D shows the building on the lot'); await r.click('[data-view="3d"]', { after: 3000 });
  await r.click('[data-view="split"]', { after: 1800 });
  await r.cap('The commercial panel sets buildings, rows and units'); await r.point('[data-ps="commercial-dock"]', 0.5, 0.3, 900); await r.hold(2500);
  await r.cap('Add building puts another building on the lot'); await r.point('[data-ps="add-building"]'); await r.hold(2200);
  await r.cap('Re-run car park layout redraws the parking'); await r.click('[data-ps="rerun-site-layout"]', { after: 3500 });
} };

SCENARIOS['commercial-planset'] = { kind: 'commercial', setup: (p) => toEditor(p, 'commercial'), run: async (r) => {
  const page = r.page;
  r.begin();
  await r.cap('Save design keeps the layout in a free profile'); await r.click('[data-action="profile-save"]', { after: 3000 });
  await page.click('[data-ps="prompt-notnow"]', { timeout: 1500 }).catch(() => {}); await page.keyboard.press('Escape'); await sleep(500);
  await r.cap('The plan set button builds the PDF'); await r.point('[data-ps="cc-planset"]'); await r.hold(2200);
  await r.cap('Send to engineer passes the layout on');
  if (await q(page, '[data-ps="lc-send-engineer"]').isVisible().catch(() => false)) { await r.point('[data-ps="lc-send-engineer"]'); await r.hold(2500); } else await r.hold(2500);
} };

SCENARIOS['commercial-overview'] = { kind: 'commercial', run: async (r) => {
  const page = r.page;
  r.begin();
  await seg.find(r, 'commercial', true);
  await r.cap('Step 2: choose a building type'); await r.click('[data-ps="flow-type"]', { after: 2000 });
  await r.click('[data-ps="flow-type"][data-type="warehouse"]', { after: 1500 });
  await r.click('[data-ps="flow-next"]', { after: 300 }); await r.step(3);
  await page.click('[data-ps="fit-coach-skip"]', { timeout: 2000 }).catch(() => {});
  await r.cap('Step 3: drag the building and set entry and exit');
  const b = await r.at('[data-ps="flow-building"]', 0.5, 0.5); await r.drag(b, { x: b.x + 30, y: b.y - 20 }, { ms: 1100 });
  const ah = await r.at('[data-ps="flow-access-handle"]', 0.5, 0.5); await r.drag(ah, { x: ah.x + 50, y: ah.y }, { ms: 1100 });
  await r.cap('Best fit puts the building back'); await r.click('[data-ps="flow-bestfit"]', { after: 300 }); await r.quiet(); await r.hold(1500);
  await r.cap('Step 4: check the numbers'); await r.click('[data-ps="flow-next"]', { after: 300 }); await r.step(4);
  await r.point('[data-ps="flow-summary"]', 0.5, 0.2, 900); await r.hold(2500);
  await r.cap('Open the editor'); await r.click('[data-ps="flow-next"]', { after: 300 }); await r.editor();
  await page.click('[data-ps="prompt-notnow"]', { timeout: 3000 }).catch(() => {});
  await r.cap('The Hardstand tool draws car parks'); await r.click('[data-tool="hardstand"]', { after: 2500 });
  await r.click('[data-tool="select"]', { after: 800 });
  await r.cap('Plan, Split and 3D change the view'); await r.click('[data-view="3d"]', { after: 3000 }); await r.click('[data-view="split"]', { after: 1500 });
  await r.cap('Save design keeps the layout in a free profile'); await r.click('[data-action="profile-save"]', { after: 2500 });
  await page.click('[data-ps="prompt-notnow"]', { timeout: 1500 }).catch(() => {}); await page.keyboard.press('Escape');
  await r.cap('The plan set button builds the PDF'); await r.point('[data-ps="cc-planset"]'); await r.hold(2500);
  await r.cap('Press Show me how any time for more help'); await r.point('[data-ps="tutorial-help"]'); await r.hold(2500);
} };

// ---------------------------------------------------------------------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------------------------------------------------------------------
function ff(args) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
}
const probeSeconds = (file) => {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr || '');
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
};
const esc = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
/** Split a caption into at most two balanced lines. */
function wrap(text) {
  if (text.length <= 52) return { text, size: 36 };
  const mid = text.length / 2; let best = -1;
  for (let i = 0; i < text.length; i += 1) if (text[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return { text: `${text.slice(0, best)}\n${text.slice(best + 1)}`, size: 31 };
}

function encode({ raw, start, end, caps, cuts = [], title, label, out, tmp, crf = 28 }) {
  const files = [];
  const tf = (name, text) => { const f = path.join(tmp, name); fs.writeFileSync(f, text); files.push(f); return esc(f); };
  const card = [
    `drawtext=fontfile=${esc(FONT_B)}:textfile=${tf('c1.txt', 'Glide Inside')}:fontsize=96:fontcolor=white:x=(w-text_w)/2:y=h/2-150`,
    `drawbox=x=(iw-140)/2:y=ih/2-20:w=140:h=6:color=${GOLD}:t=fill`,
    `drawtext=fontfile=${esc(FONT_B)}:textfile=${tf('c2.txt', title)}:fontsize=54:fontcolor=${GOLD}:x=(w-text_w)/2:y=h/2+30`,
    `drawtext=fontfile=${esc(FONT_S)}:textfile=${tf('c3.txt', label)}:fontsize=30:fontcolor=0xa9b3c4:x=(w-text_w)/2:y=h/2+120`,
    'fade=t=in:st=0:d=0.4', 'fade=t=out:st=2.2:d=0.4',
  ].join(',');
  const rawDur = Math.max(1, end - start);
  const cs = cuts.map((c) => ({ a: c.a - start, b: c.b - start })).filter((c) => c.b > c.a && c.b > 0);
  // Time in the finished clip: raw time minus the dead time cut out before it.
  const adj = (t) => cs.reduce((acc, c) => acc - Math.max(0, Math.min(t, c.b) - Math.max(c.a, 0)), t);
  const dur = adj(rawDur);
  const capFilters = caps.map((c, i) => {
    const a = Math.max(0, adj(c.at - start)), b = i + 1 < caps.length ? Math.max(0, adj(caps[i + 1].at - start)) : dur;
    const wr = wrap(c.text), lines = wr.text.split('\n');
    const en = `enable='between(t,${a.toFixed(2)},${b.toFixed(2)})'`;
    return lines.map((ln, k) => {
      const y = lines.length === 1 ? `${H}+(${BAR}-text_h)/2` : `${H}+${4 + k * 38}`;
      return `drawtext=fontfile=${esc(FONT_S)}:textfile=${tf(`k${i}_${k}.txt`, ln)}:fontsize=${wr.size}:fontcolor=white:x=(w-text_w)/2:y=${y}:${en}`;
    }).join(',');
  });
  const sel = cs.length ? [`select='not(${cs.map((c) => `between(t,${c.a.toFixed(2)},${c.b.toFixed(2)})`).join('+')})'`, 'setpts=N/25/TB'] : [];
  const body = [`fps=25`, ...sel, `scale=${W}:${H}:flags=lanczos`, `pad=${W}:${H + BAR}:0:0:color=${NAVY}`, `drawbox=x=0:y=${H}:w=iw:h=3:color=${GOLD}:t=fill`, ...capFilters].join(',');
  ff(['-f', 'lavfi', '-i', `color=c=${NAVY}:s=${W}x${H + BAR}:r=25:d=2.6`, '-ss', start.toFixed(2), '-t', rawDur.toFixed(2), '-i', raw,
    '-filter_complex', `[0:v]${card}[c];[1:v]${body}[b];[c][b]concat=n=2:v=1:a=0[v]`, '-map', '[v]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out]);
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------------------------------------------------
async function main() {
  fs.mkdirSync(VIDEOS, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'gi-videos-'));
  const apiPort = await freePort();
  const webPort = await freePort();
  const apiSrv = await startServer(apiPort, {});
  const apiCom = await startServer(await freePort(), { commercial: true });
  const web = spawn('python3', ['-m', 'http.server', String(webPort), '--bind', '127.0.0.1', '--directory', SITE], { stdio: 'ignore' });
  const ORIGIN = `http://127.0.0.1:${webPort}`;
  for (let i = 0; i < 50; i += 1) { try { if ((await fetch(`${ORIGIN}/help/`)).ok) break; } catch { /* starting */ } await sleep(200); }

  const wanted = [];
  for (const kind of ['residential', 'commercial']) for (const c of CHAPTERS[kind]) if (c.id === BASICS_ID || SCENARIOS[c.video]) wanted.push({ kind, chapter: c });
  const manifestFile = path.join(VIDEOS, 'manifest.json');
  let manifest = {}; try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch { /* new */ }
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const failures = [];
  try {
    for (const { kind, chapter } of wanted) {
      const id = chapter.video;
      if (ONLY.length && !ONLY.includes(id)) continue;
      const sc = SCENARIOS[id];
      if (!sc) { failures.push(`${id}: no scenario`); continue; }
      console.log(`recording ${id} ...`);
      const rawDir = path.join(scratch, id); fs.mkdirSync(rawDir, { recursive: true });
      const api = kind === 'commercial' ? apiCom : apiSrv;
      let rec = null, video = null, ok = false; const errors = [];
      for (let attempt = 1; attempt <= 2 && !ok; attempt += 1) {
        const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: rawDir, size: { width: W, height: H } }, reducedMotion: 'no-preference' });
        await ctx.addInitScript(CURSOR_JS); await ctx.addInitScript(DISMISS_JS);
        await ctx.addInitScript(() => { try { localStorage.setItem('gi.tutorial', JSON.stringify({ residential: 'skipped', commercial: 'skipped' })); } catch { /* none */ } });
        await ctx.route(/^https:\/\/(fonts\.(googleapis|gstatic)\.com|www\.googletagmanager\.com|api\.mapbox\.com)\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
        await ctx.route((u) => u.pathname.startsWith('/api/') && u.origin === ORIGIN, (route) => {
          const u = new URL(route.request().url());
          route.continue({ url: `${api.ORIGIN}${u.pathname}${u.search}` });
        });
        const page = await ctx.newPage();
        page.setDefaultTimeout(T);
        rec = new Rec(page, id, scratch);
        page.on('pageerror', (e) => errors.push(e.message));
        try {
          await page.goto(`${ORIGIN}/plan-studio/app/${kind === 'commercial' ? '?mode=commercial' : ''}`, { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('[data-ps="flow-root"]:not([hidden])', { timeout: T });
          await sleep(1500);
          await page.mouse.move(640, 360);
          if (sc.setup) await sc.setup(page);
          await sc.run(rec);
          await sleep(7000); rec.finish(); ok = true;
        } catch (e) { console.log(`  attempt ${attempt} FAILED ${id}: ${e.message.split('\n').slice(0, 3).join(' | ')}`); if (attempt === 2) failures.push(`${id}: ${String(e.message).split('\n')[0]}`); await page.screenshot({ path: path.join(scratch, `${id}-fail${attempt}.png`), timeout: 20000 }).catch(() => {}); console.log(`    page: ${await page.evaluate(() => `${document.querySelector('[data-ps=\\"flow-root\\"]')?.dataset.step || 'noflow'} ${document.body.innerText.slice(0, 120).replace(/\\n/g, ' / ')}`).catch((x) => `no page: ${x.message}`)}`); }
        video = page.video();
        await ctx.close();
      }
      if (!ok) { if (SHOTS) console.log(`  shots kept in ${scratch}`); continue; }
      const raw = await video.path();
      const title = chapter.id === BASICS_ID ? 'Overview' : chapter.title;
      const label = kind === 'commercial' ? 'Commercial' : 'Residential';
      const out = path.join(VIDEOS, `${id}.mp4`);
      let crf = 28;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        encode({ raw, start: rec.startAt, end: rec.endAt, caps: rec.caps, cuts: rec.cuts, title, label, out, tmp: rawDir, crf });
        const mb = fs.statSync(out).size / 1048576;
        if (mb < (chapter.id === BASICS_ID ? 14 : 3.9)) break;
        crf += 3;
      }
      const seconds = probeSeconds(out);
      const poster = path.join(VIDEOS, `${id}.jpg`);
      ff(['-ss', String(Math.min(seconds - 1, 2.6 + (seconds - 2.6) * 0.55)), '-i', out, '-frames:v', '1', '-vf', `scale=${W}:-1`, '-q:v', '6', poster]);
      manifest[id] = { seconds: Math.round(seconds * 10) / 10, bytes: fs.statSync(out).size };
      fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
      console.log(`  ${id}: ${seconds.toFixed(1)} s, ${(manifest[id].bytes / 1048576).toFixed(2)} MB${errors.length ? `, page errors: ${errors.slice(0, 2).join(' | ')}` : ''}`);
    }
  } finally { await browser.close(); web.kill(); apiSrv.close(); apiCom.close(); }
  updatePage();
  if (!flag('keep') && !SHOTS) fs.rmSync(scratch, { recursive: true, force: true }); else console.log(`scratch kept: ${scratch}`);
  if (failures.length) { console.log(`\nFAILURES:\n${failures.join('\n')}`); process.exit(1); }
  console.log('done');
}
await main();
