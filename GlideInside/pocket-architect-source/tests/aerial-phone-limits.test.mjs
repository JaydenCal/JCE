// iPhone aerial limits: iOS Safari draws nothing (no error) on a canvas over about 16.7 million pixels, and indexedDB can hang or refuse blobs.
// The aerial path must keep every canvas and request inside the phone limits and keep the picture in memory when storage fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitScale, makeWorkingCanvas, isConstrainedDevice, maxAerialSide, PHONE_MAX_SIDE, IOS_MAX_CANVAS_PIXELS } from '../src/site/device-limits.js';
import { composeMosaic } from '../src/site/tile-mosaic.js';
import { warpToMga } from '../src/site/warp.js';
import { phoneAerialParams } from '../src/site/client.js';

// A fake canvas that behaves like iOS over its limit: a context that accepts every call and draws nothing.
function fakeFactory(limitPixels, log = []) {
  return (w, h) => {
    const dead = w * h > limitPixels;
    log.push({ w, h, dead });
    const px = dead ? null : new Uint8ClampedArray(w * h * 4);
    const ctx = {
      fillStyle: '#000',
      imageSmoothingEnabled: true,
      fillRect(x, y, ww, hh) { if (!px) return; const n = /^#(..)(..)(..)$/.exec(this.fillStyle); const [r, g, b] = n ? [1, 2, 3].map((i) => parseInt(n[i], 16)) : [0, 0, 0]; for (let yy = y; yy < y + hh && yy < h; yy++) for (let xx = x; xx < x + ww && xx < w; xx++) px.set([r, g, b, 255], (yy * w + xx) * 4); },
      clearRect() {}, save() {}, restore() {}, scale() {}, setTransform() {}, drawImage() {},
      getImageData(x, y, ww, hh) { const out = new Uint8ClampedArray(ww * hh * 4); if (px) for (let i = 0; i < ww * hh * 4; i++) out[i] = px[((y * w + x) * 4) + i] ?? 0; return { data: out }; },
      createImageData(ww, hh) { return { data: new Uint8ClampedArray(ww * hh * 4) }; },
      putImageData() {},
    };
    return { width: w, height: h, getContext: () => ctx, convertToBlob: async () => ({ size: w * h, w, h, type: 'image/jpeg' }) };
  };
}

test('fitScale keeps the long side and the pixel count inside the limits', () => {
  assert.equal(fitScale(1000, 800, 2048), 1);
  assert.equal(fitScale(4096, 4096, 2048), 0.5);
  const k = fitScale(8000, 8000, 99999, IOS_MAX_CANVAS_PIXELS);
  assert.ok(8000 * k * 8000 * k <= IOS_MAX_CANVAS_PIXELS + 1);
});

test('isConstrainedDevice: iPhone, iPad as Mac, small memory; not a desktop', () => {
  assert.equal(isConstrainedDevice({ navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari' } }), true);
  assert.equal(isConstrainedDevice({ navigator: { userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 } }), true);
  assert.equal(isConstrainedDevice({ navigator: { userAgent: 'Mozilla/5.0 (X11; Linux)', deviceMemory: 8 }, innerWidth: 1600, matchMedia: () => ({ matches: false }) }), false);
  assert.equal(maxAerialSide({ navigator: { userAgent: 'iPhone' } }), PHONE_MAX_SIDE);
});

test('low reported memory counts only with a coarse pointer: a desktop keeps full sharpness, an iPad stays capped', () => {
  const mm = (coarse) => () => ({ matches: coarse });
  const desktop = { navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0)', deviceMemory: 4 }, innerWidth: 1600, matchMedia: mm(false) };
  assert.equal(isConstrainedDevice(desktop), false);
  assert.equal(maxAerialSide(desktop), 4096);
  assert.equal(isConstrainedDevice({ navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 13)', deviceMemory: 2 }, innerWidth: 1600, matchMedia: mm(true) }), true);
  assert.equal(isConstrainedDevice({ navigator: { userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0)', deviceMemory: 8 }, innerWidth: 1600, matchMedia: mm(false) }), true);
  assert.equal(maxAerialSide({ navigator: { userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 }, matchMedia: mm(true) }), PHONE_MAX_SIDE);
});

test('after the first IndexedDB timeout the rest of the session skips IndexedDB and goes straight to memory', async () => {
  const u = await import('../src/editor2d/underlay.js');
  u.resetIdbState();
  u.idb.timeoutMs = 60;
  let opens = 0;
  globalThis.indexedDB = { open: () => { opens++; return {}; } };
  globalThis.createImageBitmap = async () => ({ width: 100, height: 100 });
  try {
    const blob = { size: 1, type: 'image/jpeg' };
    assert.equal(await u.saveImage('k.a', blob), false);
    assert.equal(opens, 1);
    assert.equal(u.idbUsable(), false);
    const t0 = Date.now();
    assert.equal(await u.saveImage('k.b', blob), false);
    assert.equal(await u.loadImageBlob('k.zzz'), null);
    assert.ok(await u.loadBitmap('k.b'));
    assert.equal(opens, 1, 'no further open was attempted');
    assert.ok(Date.now() - t0 < 50, 'no second wait');
  } finally { delete globalThis.indexedDB; delete globalThis.createImageBitmap; u.idb.timeoutMs = 4000; u.resetIdbState(); }
});

test('makeWorkingCanvas shrinks a canvas that the device would blank and returns one that draws', () => {
  const log = [];
  const got = makeWorkingCanvas(4096, 4096, { side: 4096, make: fakeFactory(2048 * 2048, log) });
  assert.ok(got.width * got.height <= 2048 * 2048);
  assert.ok(log[0].dead, 'the first, full size canvas was the blank one');
  assert.ok(got.scale < 1 && got.scale > 0.4);
});

test('makeWorkingCanvas on a phone never asks for more than 2048 px a side', () => {
  const log = [];
  const got = makeWorkingCanvas(3500, 3000, { side: PHONE_MAX_SIDE, make: fakeFactory(IOS_MAX_CANVAS_PIXELS, log) });
  assert.ok(Math.max(got.width, got.height) <= PHONE_MAX_SIDE);
  assert.ok(log.every((c) => !c.dead));
});

test('makeWorkingCanvas throws a readable error when every size is blank', () => {
  assert.throws(() => makeWorkingCanvas(512, 512, { side: 512, make: fakeFactory(0) }), /could not make a canvas/);
});

test('composeMosaic on a phone draws a 3000 px mosaic at no more than 2048 px', async () => {
  const log = [];
  const plan = { crop: { sx: 0, sy: 0, widthPx: 3000, heightPx: 2800 }, x0: 0, y0: 0, tileSize: 256 };
  const blob = await composeMosaic(plan, [{ x: 0, y: 0, img: {} }], { side: PHONE_MAX_SIDE, make: fakeFactory(IOS_MAX_CANVAS_PIXELS, log) });
  assert.ok(Math.max(blob.w, blob.h) <= PHONE_MAX_SIDE);
  assert.ok(log.every((c) => !c.dead));
});

test('warpToMga re-samples inside the size cap and reports the size it really has', async () => {
  globalThis.createImageBitmap = async () => ({ width: 600, height: 600, close() {} });
  try {
    const bbox = { minE: 500000, maxE: 500100, minN: 6000000, maxN: 6000100 };
    const meta = { bbox, zone: 56, georef: 'web-mercator', widthPx: 600, heightPx: 600, outWidthPx: 800, outHeightPx: 800, webBbox: { minX: 0, maxX: 1, minY: 0, maxY: 1 } };
    const r = await warpToMga({}, meta, { side: 256, make: fakeFactory(IOS_MAX_CANVAS_PIXELS) }).catch((e) => e);
    // The pixel loop needs real web mercator bounds; only the sizing is under test, so a failure after sizing is not a sizing failure.
    if (r instanceof Error) throw r;
    assert.ok(r.meta.widthPx <= 256 && r.meta.heightPx <= 256, 'capped to the side given');
    assert.equal(r.meta.georef, 'mga');
  } finally { delete globalThis.createImageBitmap; }
});

test('phoneAerialParams caps maxpx on a phone and leaves a desktop request alone', () => {
  assert.deepEqual(phoneAerialParams({ state: 'NSW', maxpx: '3072' }, 2048), { state: 'NSW', maxpx: '2048' });
  assert.deepEqual(phoneAerialParams({ state: 'NSW' }, 2048), { state: 'NSW', maxpx: '2048' });
  assert.deepEqual(phoneAerialParams({ state: 'NSW', maxpx: '1024' }, 2048), { state: 'NSW', maxpx: '1024' });
  const d = { state: 'NSW', maxpx: '4096' };
  assert.equal(phoneAerialParams(d, 4096), d);
});

test('storage that never answers or refuses blobs keeps the aerial in memory so it still shows', async () => {
  const u = await import('../src/editor2d/underlay.js');
  u.idb.timeoutMs = 60;
  globalThis.indexedDB = { open: () => ({}) }; // never calls back: the Safari hang
  globalThis.createImageBitmap = async () => ({ width: 2048, height: 1500 });
  try {
    const blob = { size: 10, type: 'image/jpeg' };
    const stored = await u.saveImage('k.hang', blob);
    assert.equal(stored, false, 'reported as not stored');
    const bmp = await u.loadBitmap('k.hang');
    assert.ok(bmp && bmp.w === 2048 && bmp.h === 1500, 'the decoded picture is still there');
    // A browser that throws on storing a Blob (in-app browsers, private mode).
    globalThis.indexedDB = { open: () => { const r = {}; setTimeout(() => r.onerror?.(), 0); Object.defineProperty(r, 'error', { value: new Error('denied') }); return r; } };
    assert.equal(await u.saveImage('k.deny', blob), false);
    assert.ok(await u.loadBitmap('k.deny'));
  } finally { delete globalThis.indexedDB; delete globalThis.createImageBitmap; u.idb.timeoutMs = 4000; }
});
