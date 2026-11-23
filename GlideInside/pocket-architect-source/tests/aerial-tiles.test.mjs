// NSW aerial tile mosaic fallback: zoom and range maths, georeference, server endpoints (/aerial-tiles, /tile) and the client switch-over.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/lib/app.js';
import { createMemoryStore } from '../server/lib/store.js';
import { lonLatToMga, mgaToWeb, mgaBoxToWebBox, webToLonLat } from '../src/site/geo.js';
import { STANDARD_SCHEME, resolutionAt, schemeFromTileInfo, tileRange, chooseZoom, planMosaic, tileBounds, usableLevels } from '../src/site/tile-math.js';
import { fetchAerial, resetExportBreaker, EXPORT_SLOW_MS } from '../src/site/client.js';
import { fetchAerialTiles, mapLimit } from '../src/site/tile-mosaic.js';
import { sourcePixelFor } from '../src/site/warp.js';

const LON = 150.9301;
const LAT = -31.0902;
const C = lonLatToMga(LON, LAT, 56);
const BOX = { minE: C.e - 40, minN: C.n - 50, maxE: C.e + 40, maxN: C.n + 50 };

test('scheme: standard resolutions, tileInfo parsing and its fallbacks', () => {
  assert.ok(Math.abs(resolutionAt(STANDARD_SCHEME, 19) - 0.29858214173896974) < 1e-9);
  assert.equal(resolutionAt(STANDARD_SCHEME, 21), null);
  const ti = { rows: 256, cols: 256, origin: { x: -20037508.342787, y: 20037508.342787 }, spatialReference: { wkid: 102100, latestWkid: 3857 }, lods: [{ level: 0, resolution: 156543.03392800014 }, { level: 10, resolution: 152.8740565703525 }, { level: 11, resolution: 76.43702828517625 }] };
  const s = schemeFromTileInfo(ti);
  assert.equal(s.maxLevel, 11);
  assert.equal(resolutionAt(s, 10), 152.8740565703525);
  assert.equal(resolutionAt(s, 12), null);
  assert.equal(schemeFromTileInfo(null), STANDARD_SCHEME);
  assert.equal(schemeFromTileInfo({ ...ti, spatialReference: { wkid: 4326 } }), STANDARD_SCHEME);
  assert.equal(schemeFromTileInfo({ ...ti, rows: 512 }), STANDARD_SCHEME);
});

test('addressing: the user example tile 10/600/940 is the NSW tile covering about 150.5 to 150.8 E, 29.8 S (z/y/x = level/row/col)', () => {
  const b = tileBounds(10, 940, 600);
  const lo = webToLonLat(b.minX, b.minY);
  const hi = webToLonLat(b.maxX, b.maxY);
  assert.ok(lo.lon < 150.6 && hi.lon > 150.5 && hi.lat > -30 && lo.lat < -29.5, `${lo.lon} ${hi.lon} ${lo.lat} ${hi.lat}`);
});

test('tileRange: a box inside one tile gives one tile; a box on a boundary spans two', () => {
  const span = resolutionAt(STANDARD_SCHEME, 19) * 256;
  const x = 400000;
  const wb = { minX: -20037508.342787 + x * span + 5, maxX: -20037508.342787 + x * span + 50, minY: 0, maxY: 0 };
  const y = 262144;
  const one = tileRange({ ...wb, minY: 20037508.342787 - y * span - 60, maxY: 20037508.342787 - y * span - 10 }, 19);
  assert.deepEqual([one.cols, one.rows, one.x0, one.y0], [1, 1, x, y]);
  const two = tileRange({ ...wb, maxX: wb.minX + span }, 19);
  assert.equal(two.cols, 2);
});

test('chooseZoom: z19 (about 0.26 m on the ground at 31 S) for a small lot, coarser for a big box, never over the tile cap', () => {
  const small = mgaBoxToWebBox(BOX, 56);
  assert.equal(chooseZoom(small, LAT), 19);
  const wide = mgaBoxToWebBox({ minE: C.e - 500, minN: C.n - 500, maxE: C.e + 500, maxN: C.n + 500 }, 56);
  const z = chooseZoom(wide, LAT);
  assert.ok(z < 19 && z >= 15);
  const r = tileRange(wide, z);
  assert.ok(r.cols * r.rows <= 64);
  assert.ok(tileRange(wide, z + 1).cols * tileRange(wide, z + 1).rows > 64, 'the next finer level would exceed 64 tiles');
  assert.ok(usableLevels(STANDARD_SCHEME).every((l) => l >= 10 && l <= 20));
});

test('planMosaic: the crop edges are the web box, tiles cover it, and the mosaic georeference lines up with the MGA box through warp', () => {
  const p = planMosaic(BOX, 56);
  assert.equal(p.z, 19);
  assert.ok(p.tiles.length >= 1 && p.tiles.length <= 64 && p.tiles.length === p.cols * p.rows);
  const wb = mgaBoxToWebBox(BOX, 56);
  assert.ok(p.webBbox.minX <= wb.minX && p.webBbox.maxX >= wb.maxX && p.webBbox.minY <= wb.minY && p.webBbox.maxY >= wb.maxY);
  assert.ok(p.webBbox.maxX - wb.maxX < p.webResolution * 1.01);
  assert.equal(p.crop.widthPx, Math.round((p.webBbox.maxX - p.webBbox.minX) / p.webResolution));
  assert.ok(p.crop.sx >= 0 && p.crop.sx + p.crop.widthPx <= p.cols * 256 && p.crop.sy + p.crop.heightPx <= p.rows * 256);
  // The mosaic pixel at a known web coordinate, via the real warp mapping, equals the tile position of that coordinate.
  const meta = { bbox: BOX, zone: 56, webBbox: p.webBbox, widthPx: p.crop.widthPx, heightPx: p.crop.heightPx, outWidthPx: p.outWidthPx, outHeightPx: p.outHeightPx };
  const centre = mgaToWeb((BOX.minE + BOX.maxE) / 2, (BOX.minN + BOX.maxN) / 2, 56);
  const sp = sourcePixelFor(meta, p.outWidthPx / 2 - 0.5, p.outHeightPx / 2 - 0.5);
  const mosX = (centre.x - (-20037508.342787 + p.x0 * 256 * p.webResolution)) / p.webResolution - p.crop.sx;
  assert.ok(Math.abs(sp.x - mosX) < 0.6, `${sp.x} vs ${mosX}`);
  assert.ok(p.outWidthPx > 200 && p.mmPerPx > 250 && p.mmPerPx < 400);
});

test('planMosaic: maxPx caps the output and maxTiles is honoured', () => {
  const big = { minE: C.e - 900, minN: C.n - 900, maxE: C.e + 900, maxN: C.n + 900 };
  const p = planMosaic(big, 56, { maxPx: 1024 });
  assert.ok(Math.max(p.outWidthPx, p.outHeightPx) <= 1024);
  const q = planMosaic(big, 56, { maxTiles: 100 });
  assert.ok(q.tiles.length <= 100 && q.z >= p.z);
});

// ---- server ----------------------------------------------------------------------------------------------------------------------
const T0 = Date.UTC(2026, 10, 23, 5, 0, 0);
function mk({ tileInfo = null, tileStatus = 200, tileType = 'image/jpeg' } = {}) {
  const calls = [];
  const j = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    calls.push(`${url.host}${url.pathname}`);
    if (url.pathname.includes('NSW_Imagery_Dates')) return j({ features: [{ attributes: { BlockStartDate: Date.UTC(2022, 2, 5) } }] });
    if (/NSW_Imagery\/MapServer\/tile\//.test(url.pathname)) return new Response(tileStatus === 200 ? new Uint8Array(400).fill(7) : 'no', { status: tileStatus, headers: { 'content-type': tileType } });
    if (url.pathname.endsWith('NSW_Imagery/MapServer')) return j(tileInfo ? { name: 'x', tileInfo } : { name: 'x' });
    return new Response('unexpected', { status: 500 });
  };
  const app = createApp({ store: createMemoryStore(), env: {}, fetchImpl, now: () => T0 });
  const get = (path, ip = '2.2.2.2') => app.fetch(new Request(`https://api.test/api/site${path}`, { headers: { 'cf-connecting-ip': ip } }));
  return { get, calls };
}
const bboxQ = `${BOX.minE},${BOX.minN},${BOX.maxE},${BOX.maxN}`;

test('server /aerial-tiles: a mosaic plan with georeference, attribution and a capture date; cached on the second call', async () => {
  const { get, calls } = mk();
  const r = await get(`/aerial-tiles?state=NSW&srid=7856&bbox=${bboxQ}`);
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.z, 19);
  assert.equal(b.tiles.length, b.cols * b.rows);
  assert.equal(b.meta.georef, 'web-mercator');
  assert.equal(b.meta.srid, 7856);
  assert.equal(b.meta.captureDate, '05/03/2022');
  assert.match(b.meta.attribution, /NSW Spatial Services/);
  assert.ok(b.meta.webBbox.maxX > b.meta.webBbox.minX && b.meta.outWidthPx > 0);
  const n = calls.length;
  await get(`/aerial-tiles?state=NSW&srid=7856&bbox=${bboxQ}`);
  assert.equal(calls.length, n);
});

test('server /aerial-tiles: NSW only, validates srid and bbox', async () => {
  const { get } = mk();
  assert.equal((await get(`/aerial-tiles?state=QLD&srid=7856&bbox=${bboxQ}`)).status, 422);
  assert.equal((await get(`/aerial-tiles?srid=7856&bbox=${bboxQ}`)).status, 400);
  assert.equal((await get(`/aerial-tiles?state=NSW&srid=1234&bbox=${bboxQ}`)).status, 400);
  assert.equal((await get('/aerial-tiles?state=NSW&srid=7856&bbox=1,2,3')).status, 400);
});

test('server /aerial-tiles: reads tileInfo once; a coarser cache limits the zoom', async () => {
  const ti = { rows: 256, cols: 256, origin: { x: -20037508.342787, y: 20037508.342787 }, spatialReference: { wkid: 102100 }, lods: [10, 11, 12, 13, 14, 15, 16, 17].map((level) => ({ level, resolution: 156543.03392800014 / 2 ** level })) };
  const { get, calls } = mk({ tileInfo: ti });
  const b = await (await get(`/aerial-tiles?state=NSW&srid=7856&bbox=${bboxQ}`)).json();
  assert.equal(b.z, 17);
  await get(`/aerial-tiles?state=NSW&srid=7856&bbox=${bboxQ.replace(/\d$/, '1')}`);
  assert.equal(calls.filter((c) => c.endsWith('NSW_Imagery/MapServer')).length, 1);
});

test('server /tile: serves the JPEG with long immutable cache headers, then from cache', async () => {
  const { get, calls } = mk();
  const r = await get('/tile?z=10&x=940&y=600');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.equal(r.headers.get('cache-control'), 'public, max-age=2592000, immutable');
  assert.equal((await r.arrayBuffer()).byteLength, 400);
  assert.ok(calls.includes('maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/tile/10/600/940'));
  const n = calls.length;
  assert.equal((await get('/tile?z=10&x=940&y=600')).status, 200);
  assert.equal(calls.length, n);
});

test('server /tile: validation and not an open proxy', async () => {
  const { get, calls } = mk();
  const bad = ['z=9&x=1&y=1', 'z=21&x=1&y=1', 'z=10&x=1024&y=600', 'z=10&x=940&y=-1', 'z=10&x=9.5&y=600', 'z=10&x=abc&y=600', 'z=10&x=940', 'z=10&x=940&y=600/../../x', 'z=10&x=%2e%2e&y=1'];
  for (const q of bad) assert.equal((await get(`/tile?${q}`)).status, 400, q);
  assert.equal((await get('/tile?z=10&x=940&y=600&state=QLD')).status, 422);
  assert.equal((await get('/tile?z=10&x=100&y=300')).status, 422, 'a tile over Africa is refused');
  assert.equal((await get('/tile?z=10&x=940&y=600&url=https://evil.example/x.jpg&host=evil.example')).status, 200);
  assert.ok(calls.every((c) => c.startsWith('maps.six.nsw.gov.au/')), `only the fixed NSW host: ${calls.join(' ')}`);
  assert.equal(calls.some((c) => c.includes('evil')), false);
});

test('server /tile: an upstream failure or a non image answer is a 502 and is not cached', async () => {
  const a = mk({ tileStatus: 404 });
  assert.equal((await a.get('/tile?z=10&x=940&y=600')).status, 502);
  const b = mk({ tileType: 'text/html' });
  assert.equal((await b.get('/tile?z=10&x=940&y=600')).status, 502);
  assert.equal((await b.get('/tile?z=10&x=940&y=600')).status, 502);
});

test('server /tile and /aerial-tiles: GET only', async () => {
  const { app } = (() => { const m = mk(); return { app: m }; })();
  void app;
  const a = createApp({ store: createMemoryStore(), env: {}, fetchImpl: async () => new Response('{}'), now: () => T0 });
  const r = await a.fetch(new Request('https://api.test/api/site/tile?z=10&x=940&y=600', { method: 'POST' }));
  assert.equal(r.status, 405);
});

// ---- client ----------------------------------------------------------------------------------------------------------------------
const plan = () => planMosaic(BOX, 56);
const planBody = () => {
  const p = plan();
  return { state: 'NSW', z: p.z, tileSize: 256, x0: p.x0, y0: p.y0, cols: p.cols, rows: p.rows, tiles: p.tiles, crop: p.crop, tilePath: 'tile', meta: { georef: 'web-mercator', srid: 7856, zone: 56, bbox: BOX, webBbox: p.webBbox, widthPx: p.crop.widthPx, heightPx: p.crop.heightPx, outWidthPx: p.outWidthPx, outHeightPx: p.outHeightPx, attribution: 'NSW' } };
};
const jsonRes = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
const params = { state: 'NSW', srid: '7856', origin: '1,2', bbox: bboxQ, res: '0.05' };
const tileOpts = (extra = {}) => ({ decode: async (b) => ({ size: b.size, close() {} }), compose: async () => new Blob(['mosaic']), warp: async (blob, meta) => ({ blob, meta: { ...meta, georef: 'mga', warped: true } }), ...extra });

test('mapLimit never runs more than the limit at once and keeps order', async () => {
  let live = 0;
  let peak = 0;
  const out = await mapLimit([...Array(30).keys()], 8, async (i) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 2)); live--; return i * 2; });
  assert.equal(peak, 8);
  assert.deepEqual(out, [...Array(30).keys()].map((i) => i * 2));
});

test('fetchAerialTiles: loads every tile with the limit, composes and warps to an MGA aerial', async () => {
  const body = planBody();
  const seen = [];
  const f = async (url) => {
    const u = String(url);
    if (u.includes('/site/aerial-tiles')) { assert.match(u, /state=NSW/); return jsonRes(body); }
    seen.push(u);
    return new Response(new Uint8Array(10), { status: 200 });
  };
  const out = await fetchAerialTiles(params, { fetchImpl: f, ...tileOpts() });
  assert.equal(seen.length, body.tiles.length);
  assert.ok(seen.every((u) => /\/site\/tile\?state=NSW&z=19&x=\d+&y=\d+$/.test(u)));
  assert.equal(out.meta.georef, 'mga');
  assert.ok(out.blob instanceof Blob);
});

test('fetchAerialTiles: a failed tile is retried once; too many missing tiles refuse the mosaic', async () => {
  const body = planBody();
  let first = true;
  const flaky = async (url) => {
    if (String(url).includes('aerial-tiles')) return jsonRes(body);
    if (first) { first = false; return new Response('x', { status: 500 }); }
    return new Response(new Uint8Array(10), { status: 200 });
  };
  await fetchAerialTiles(params, { fetchImpl: flaky, ...tileOpts() });
  const dead = async (url) => (String(url).includes('aerial-tiles') ? jsonRes(body) : new Response('x', { status: 500 }));
  await assert.rejects(fetchAerialTiles(params, { fetchImpl: dead, ...tileOpts() }), /did not load/);
});

test('fetchAerial: a hanging NSW export is aborted after the slow limit and the lot still gets a tile aerial', async () => {
  resetExportBreaker();
  const body = planBody();
  let exportAborted = false;
  const f = (url, init) => {
    const u = String(url);
    if (u.includes('/site/aerial?')) return new Promise((_, rej) => init.signal.addEventListener('abort', () => { exportAborted = true; rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); }));
    if (u.includes('aerial-tiles')) return Promise.resolve(jsonRes(body));
    return Promise.resolve(new Response(new Uint8Array(10), { status: 200 }));
  };
  const t0 = Date.now();
  const out = await fetchAerial(params, { fetchImpl: f, exportSlowMs: 60, tileOpts: tileOpts() });
  assert.ok(exportAborted);
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(out.meta.georef, 'mga');
  // The breaker is open: the next NSW aerial goes straight to tiles without touching the export.
  let exportCalls = 0;
  const g = (url) => { if (String(url).includes('/site/aerial?')) { exportCalls++; return Promise.reject(new Error('x')); } return f(url, {}); };
  await fetchAerial(params, { fetchImpl: g, exportSlowMs: 60, tileOpts: tileOpts() });
  assert.equal(exportCalls, 0);
  resetExportBreaker();
});

test('fetchAerial: an export that answers 502 falls back to tiles at once; a refusal (400) does not', async () => {
  resetExportBreaker();
  const body = planBody();
  const f = (code) => async (url) => {
    const u = String(url);
    if (u.includes('/site/aerial?')) return new Response(JSON.stringify({ code, message: 'no' }), { status: code === 'BAD_REQUEST' ? 400 : 502 });
    if (u.includes('aerial-tiles')) return jsonRes(body);
    return new Response(new Uint8Array(10), { status: 200 });
  };
  assert.equal((await fetchAerial(params, { fetchImpl: f('SITE_UPSTREAM'), tileOpts: tileOpts() })).meta.georef, 'mga');
  resetExportBreaker();
  await assert.rejects(fetchAerial(params, { fetchImpl: f('BAD_REQUEST'), tileOpts: tileOpts() }), /no/);
  resetExportBreaker();
});

test('fetchAerial: a fast export is unchanged (no tile calls); the caller\'s abort is respected; QLD never uses tiles', async () => {
  resetExportBreaker();
  const calls = [];
  const meta = { georef: 'mga', srid: 7856, bbox: BOX };
  const good = async (url) => { calls.push(String(url)); return new Response(new Blob(['jpg']), { status: 200, headers: { 'x-site-meta': encodeURIComponent(JSON.stringify(meta)) } }); };
  const out = await fetchAerial(params, { fetchImpl: good });
  assert.equal(out.meta.georef, 'mga');
  assert.equal(calls.length, 1);
  const ctl = new AbortController();
  const hang = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))));
  const p = fetchAerial(params, { fetchImpl: hang, signal: ctl.signal });
  ctl.abort();
  await assert.rejects(p, { name: 'AbortError' });
  const q = [];
  const fail = async (url) => { q.push(String(url)); return new Response(JSON.stringify({ message: 'down' }), { status: 502 }); };
  await assert.rejects(fetchAerial({ ...params, state: 'QLD' }, { fetchImpl: fail }), /down/);
  assert.equal(q.length, 1);
  assert.ok(EXPORT_SLOW_MS >= 10000 && EXPORT_SLOW_MS <= 15000);
  resetExportBreaker();
});
