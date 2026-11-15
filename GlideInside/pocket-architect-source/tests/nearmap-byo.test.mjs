// Nearmap with the visitor's own key: tiles come straight from api.nearmap.com (mocked here, the real API is never called), the key stays in the
// browser, and the page policy lists the host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchNearmapForLot, tileUrl, validKey, saveKey, readKey, forgetKey, STORAGE_KEY, NEARMAP_HOST } from '../src/site/nearmap-aerial.js';

const KEY = 'TESTKEY_abcdefghijklmnop1234';
const lot = { zone: 56, origin: { e: 500000, n: 6400000 }, boundary: [{ x: 0, y: 0 }, { x: 20000, y: 0 }, { x: 20000, y: 30000 }, { x: 0, y: 30000 }] };
const fakeCanvas = () => ({ getContext: () => ({ drawImage() {}, setTransform() {}, save() {}, restore() {}, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), fillRect() {}, transform() {}, imageSmoothingEnabled: true }), convertToBlob: async () => new Blob(['jpeg']) });

test('tiles are requested only from api.nearmap.com, with the key, without cookies', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url: String(url), init }); return { ok: true, status: 200, blob: async () => new Blob(['t']) }; };
  const out = await fetchNearmapForLot({ lot, key: KEY, fetchImpl, createCanvas: fakeCanvas, decode: async () => ({ close() {} }) });
  assert.ok(seen.length >= 1);
  for (const s of seen) {
    assert.ok(s.url.startsWith(`${NEARMAP_HOST}/tiles/v3/Vert/`), s.url);
    assert.equal(s.init.credentials, 'omit');
  }
  assert.equal(out.meta.kind, 'nearmap');
  assert.match(out.meta.attribution, /Nearmap imagery, your licence/);
  assert.equal(tileUrl(1, 2, 3, KEY), `${NEARMAP_HOST}/tiles/v3/Vert/1/2/3.jpg?apikey=${KEY}`);
});

test('the key never goes to our origin and never enters the project', async () => {
  const origins = new Set();
  const fetchImpl = async (url) => { origins.add(new URL(url).origin); return { ok: true, status: 200, blob: async () => new Blob(['t']) }; };
  const out = await fetchNearmapForLot({ lot, key: KEY, fetchImpl, createCanvas: fakeCanvas, decode: async () => ({ close() {} }) });
  assert.deepEqual([...origins], [NEARMAP_HOST]);
  assert.ok(!JSON.stringify(out.meta).includes(KEY), 'the key must not be in the aerial metadata kept in the project');
});

test('key storage: this browser only, forgettable, validated', () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  assert.equal(STORAGE_KEY, 'gi.byo.nearmapKey');
  assert.ok(validKey(KEY) && !validKey('short') && !validKey('has space in it 12345678'));
  saveKey(KEY);
  assert.equal(readKey(), KEY);
  forgetKey();
  assert.equal(readKey(), '');
  delete globalThis.localStorage;
});

test('the dialog masks the key, offers Forget my key and states the terms; no code sends the key to the server', () => {
  const ui = readFileSync(new URL('../src/ui/aerial-source.js', import.meta.url), 'utf8');
  assert.match(ui, /type: 'password'/);
  assert.match(ui, /Forget my key/);
  assert.match(ui, /Your Nearmap subscription terms apply\. Exported and shared plans will include the imagery\./);
  const nm = readFileSync(new URL('../src/site/nearmap-aerial.js', import.meta.url), 'utf8');
  assert.ok(!/\/api\/|console\.|track\(|sendBeacon/.test(nm.replace(/\/\/.*$/gm, '')), 'no server call, logging or analytics near the key');
});

test('the security headers list api.nearmap.com in img-src and connect-src, in both rules', () => {
  const md = readFileSync(new URL('../../../SECURITY-HEADERS.md', import.meta.url), 'utf8');
  const blocks = [...md.matchAll(/```headers\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.ok(blocks.length >= 2);
  for (const b of blocks.slice(0, 2)) {
    const csp = b.split('\n').find((l) => l.startsWith('Content-Security-Policy:'));
    for (const dir of ['img-src', 'connect-src']) {
      const part = csp.split(';').map((x) => x.trim()).find((x) => x.startsWith(dir));
      assert.ok(part.includes('https://api.nearmap.com'), `${dir} lacks api.nearmap.com`);
    }
  }
});
