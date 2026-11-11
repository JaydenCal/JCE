// Site lookup back end (server/lib/site.js) with a mocked upstream returning recorded-shape ArcGIS JSON and a synthetic TIFF DEM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/lib/app.js';
import { createMemoryStore, createD1Store } from '../server/lib/store.js';
import { createSite, parseBbox, createCache, buildNswWhere, buildQldWhere, searchWords, inferState } from '../server/lib/site.js';
import { lonLatToMga, mgaToLonLat } from '../src/site/geo.js';

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  /* no sqlite */
}

const T0 = Date.UTC(2026, 10, 11, 1, 0, 0);
const LON = 150.9301;
const LAT = -31.0902; // Tamworth, zone 56
const C = lonLatToMga(LON, LAT, 56);
const ring = (e0, n0, w, h) => [[e0, n0], [e0, n0 + h], [e0 + w, n0 + h], [e0 + w, n0], [e0, n0]]; // clockwise (ArcGIS outer ring)
const LOT = ring(C.e - 10, C.n - 20, 20, 40);
const lotFeature = (rings, attrs) => ({ attributes: attrs, geometry: { rings: [rings] } });
const NSW_LOT_ATTRS = { lotnumber: '12', sectionnumber: null, planlabel: 'DP 123456', planlotarea: 800, lotidstring: '12//DP123456' };

function tiffF32(width, height, fn, nodata = -9999) {
  const n = width * height;
  const entries = [[256, 4, width], [257, 4, height], [258, 3, 32], [259, 3, 1], [262, 3, 1], [273, 4, 0], [277, 3, 1], [278, 4, height], [279, 4, n * 4], [339, 3, 3]];
  const ifdLen = 2 + entries.length * 12 + 4;
  const dataAt = 8 + ifdLen;
  const buf = new ArrayBuffer(dataAt + n * 4);
  const dv = new DataView(buf);
  dv.setUint8(0, 0x49); dv.setUint8(1, 0x49); dv.setUint16(2, 42, true); dv.setUint32(4, 8, true);
  dv.setUint16(8, entries.length, true);
  entries.forEach(([tag, type, v], i) => {
    const o = 10 + i * 12;
    dv.setUint16(o, tag, true); dv.setUint16(o + 2, type, true); dv.setUint32(o + 4, 1, true);
    if (type === 3) dv.setUint16(o + 8, tag === 273 ? 0 : v, true); else dv.setUint32(o + 8, tag === 273 ? dataAt : v, true);
  });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) dv.setFloat32(dataAt + (y * width + x) * 4, fn(x, y) ?? nodata, true);
  return new Uint8Array(buf);
}

function upstream({ failDirectAerial = false, fail = null, calls = [], failNeighbours = null } = {}) {
  const j = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  const impl = async (input, init) => {
    const url = new URL(String(input));
    const p = url.pathname;
    const q = url.searchParams;
    calls.push(`${url.host}${p}`);
    if (fail && fail.test(`${url.host}${p}`)) return new Response('nope', { status: 503 });
    if (failNeighbours?.on && (q.get('geometryType') === 'esriGeometryEnvelope' || String(init?.body || '').includes('esriGeometryEnvelope')) && p.endsWith('/query')) return new Response('nope', { status: 503 });
    if (q.get('f') === 'json' && !p.endsWith('/query') && !p.endsWith('/identify')) return j({ name: 'svc', currentVersion: 11.1 });
    if (p.endsWith('NSW_Cadastre/MapServer/9/query')) {
      // The live NSW cadastre layer answers resultRecordCount with "Failed to execute query" (seen 11/11/2026): the server must not send it.
      if (q.has('resultRecordCount')) return j({ error: { code: 400, message: 'Failed to execute query.' } });
      const env = q.get('geometryType') === 'esriGeometryEnvelope';
      const feats = [lotFeature(LOT, NSW_LOT_ATTRS)];
      if (env) {
        feats.push(lotFeature(ring(C.e + 10, C.n - 20, 20, 40), { ...NSW_LOT_ATTRS, lotnumber: '13', lotidstring: '13//DP123456', planlotarea: 810 }));
        feats.push(lotFeature(ring(C.e - 40, C.n - 20, 30, 40), { ...NSW_LOT_ATTRS, lotnumber: '11', lotidstring: '11//DP123456' }));
        feats.push(lotFeature(LOT, NSW_LOT_ATTRS)); // duplicate of the lot is skipped
      }
      return j({ features: feats });
    }
    if (p.includes('NSW_Geocoded_Addressing_Theme') && p.endsWith('/query')) {
      calls.push(`where:${q.get('where')}`);
      if (!/SMITH STREET/.test(q.get('where'))) return j({ features: [] });
      return j({ features: [{ attributes: { address: '12 SMITH STREET TAMWORTH' }, geometry: { x: LON, y: LAT } }] });
    }
    if (p.includes('NSW_Administrative_Boundaries')) return j({ features: [{ attributes: { lganame: 'TAMWORTH REGIONAL' } }] });
    if (p.includes('EPI_Primary_Planning_Layers')) return j({ features: [{ attributes: { SYM_CODE: 'R2', LAY_CLASS: 'R2 Low Density Residential', EPI_NAME: 'Tamworth Regional LEP 2010' } }] });
    if (p.includes('NSW_Transport_Theme')) return j({ features: [{ attributes: { roadnamebase: 'SMITH', roadnametype: 'STREET' }, geometry: { paths: [[[C.e - 60, C.n - 25], [C.e + 60, C.n - 25]]] } }] });
    if (p.includes('NSW_Imagery_Dates')) return j({ features: [{ attributes: { BlockStartDate: Date.UTC(2022, 2, 5), Resolution_cm: 10 } }] });
    if (p.endsWith('NSW_Imagery/MapServer/export')) {
      if (failDirectAerial && q.get('imageSR') === '7856') return new Response('bad', { status: 400 });
      return new Response(new Uint8Array(500).fill(7), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }
    if (p.endsWith('NSW_5M_Elevation/ImageServer/exportImage')) {
      const [w, h] = q.get('size').split(',').map(Number);
      const [x0, , x1] = q.get('bbox').split(',').map(Number);
      const px = (x1 - x0) / w;
      return new Response(tiffF32(w, h, (x) => 300 + 0.05 * (x0 + (x + 0.5) * px - x0)), { status: 200, headers: { 'content-type': 'image/tiff' } });
    }
    return new Response('unexpected ' + p, { status: 404 });
  };
  impl.calls = calls;
  return impl;
}

const mk = (opts = {}) => {
  let now = T0;
  const store = createMemoryStore();
  const fetchImpl = upstream(opts);
  const app = createApp({ store, env: {}, fetchImpl, now: () => now });
  const get = (path, ip = '1.1.1.1') => app.fetch(new Request(`https://api.test/api/site${path}`, { headers: { 'cf-connecting-ip': ip } }));
  return { app, store, fetchImpl, get, tick: (ms) => { now += ms; } };
};

test('parseBbox validates and limits the area', () => {
  assert.deepEqual(parseBbox('1,2,3,4'), { minE: 1, minN: 2, maxE: 3, maxN: 4 });
  assert.throws(() => parseBbox('1,2,3'));
  assert.throws(() => parseBbox('3,2,1,4'));
  assert.throws(() => parseBbox('0,0,5000,10'));
});

test('search where builders: abbreviations, state and postcode stripped, prefix and per-word clauses', () => {
  const tk = (q) => q.toUpperCase().replace(/[,.]/g, ' ').split(/\s+/).filter(Boolean);
  assert.deepEqual(searchWords(tk('12 Smith St, Tamworth NSW 2340'), 'NSW'), ['12', 'SMITH', 'STREET', 'TAMWORTH']);
  assert.deepEqual(searchWords(tk('5 St Johns Rd'), 'NSW'), ['5', 'ST', 'JOHNS', 'ROAD']);
  assert.deepEqual(buildNswWhere(tk('756 Quia Rd Gunnedah')), { prefix: "address LIKE '756 QUIA ROAD GUNNEDAH%'", words: "address LIKE '%756%' AND address LIKE '%QUIA%' AND address LIKE '%ROAD%' AND address LIKE '%GUNNEDAH%'" });
  assert.equal(buildNswWhere(tk("o'brien st x")).prefix, "address LIKE 'O''BRIEN STREET X%'");
  assert.equal(buildNswWhere(tk('NSW')), null);
  assert.equal(buildQldWhere(tk('flinders st townsville qld 4810')), "UPPER(address) LIKE '%FLINDERS%' AND UPPER(address) LIKE '%STREET%' AND UPPER(address) LIKE '%TOWNSVILLE%'");
  assert.match(buildQldWhere(tk('100 Flinders Street')), /^\(UPPER\(address\) LIKE '100 %'/);
});

test('search: NSW address returns label, state, lon, lat (max 8)', async () => {
  const { get } = mk();
  const res = await get('/search?q=12%20Smith%20Street%20Tamworth');
  assert.equal(res.status, 200);
  const { results } = await res.json();
  assert.ok(results.length >= 1 && results.length <= 8);
  assert.equal(results[0].state, 'NSW');
  assert.equal(results[0].label, '12 Smith Street Tamworth NSW');
  assert.ok(Math.abs(results[0].lon - LON) < 0.001 && Math.abs(results[0].lat - LAT) < 0.001);
  assert.equal((await (await get('/search?q=ab')).json()).results.length, 0);
});

test('lot: parcel, neighbours, LGA, zone, MGA origin and relative coordinates', async () => {
  const { get } = mk();
  const res = await get(`/lot?lon=${LON}&lat=${LAT}&state=NSW`);
  assert.equal(res.status, 200);
  const b = await res.json();
  assert.equal(b.state, 'NSW');
  assert.equal(b.srid, 7856);
  assert.equal(b.zone, 56);
  assert.equal(b.lot.lotLabel, 'Lot 12 DP 123456');
  assert.ok(Math.abs(b.lot.areaM2 - 800) < 0.5);
  assert.equal(b.lga, 'TAMWORTH REGIONAL');
  assert.equal(b.zoning.code, 'R2');
  assert.equal(b.neighbours.length, 2);
  assert.deepEqual(b.neighbours.map((n) => n.lotNumber).sort(), ['11', '13']);
  assert.ok(Math.abs(b.origin.e - C.e) < 0.01 && Math.abs(b.origin.n - C.n) < 0.01);
  const xs = b.lot.polygons[0].outer.map((p) => p[0]);
  assert.ok(Math.min(...xs) > -10.1 && Math.max(...xs) < 10.1, 'coordinates are relative to the origin');
  assert.equal(b.roads.length, 1);
  assert.match(b.attribution, /CC BY 3\.0 AU/);
  assert.equal((await get(`/lot?lon=${LON}&lat=${LAT}&state=NSW`)).status, 200);
});

test('lot: outside NSW and QLD is refused, bad input is 400', async () => {
  const { get } = mk();
  const r1 = await get('/lot?lon=115.86&lat=-31.95'); // Perth
  assert.equal(r1.status, 422);
  assert.equal((await r1.json()).code, 'UNSUPPORTED_AREA');
  assert.equal((await get('/lot?lon=abc&lat=1')).status, 400);
  assert.equal((await get('/lot?lon=150.9&lat=-31.1&state=VIC')).status, 422);
});

test('lot: results are cached in the store (second call makes no upstream requests)', async () => {
  const { get, fetchImpl } = mk();
  await get(`/lot?lon=${LON}&lat=${LAT}&state=NSW`);
  const n = fetchImpl.calls.length;
  await get(`/lot?lon=${LON}&lat=${LAT}&state=NSW`);
  assert.equal(fetchImpl.calls.length, n);
});

test('lot: a response whose neighbour fetch failed is not cached, so the next lookup retries', async () => {
  const failNeighbours = { on: true };
  const { get, fetchImpl } = mk({ failNeighbours });
  const url = `/lot?lon=${LON}&lat=${LAT}&state=NSW`;
  const r1 = await get(url);
  const b1 = await r1.json();
  assert.ok(b1.notes.some((n) => /Neighbouring lots could not be loaded/.test(n)));
  assert.equal(r1.headers.get('cache-control'), 'no-store');
  failNeighbours.on = false;
  const b2 = await (await get(url)).json();
  assert.equal(b2.neighbours.length, 2, 'the failed result was not served from the cache');
  const n = fetchImpl.calls.length;
  await get(url);
  assert.equal(fetchImpl.calls.length, n, 'the complete result is cached');
});

test('lot: upstream failure is a 502 SITE_UPSTREAM', async () => {
  const { get } = mk({ fail: /NSW_Cadastre/ });
  const res = await get(`/lot?lon=${LON}&lat=${LAT}&state=NSW`);
  assert.equal(res.status, 502);
  assert.equal((await res.json()).code, 'SITE_UPSTREAM');
});

test('aerial: direct MGA image with georeference header, then served from cache', async () => {
  const { get, fetchImpl } = mk();
  const bbox = `${C.e - 40},${C.n - 50},${C.e + 40},${C.n + 50}`;
  const res = await get(`/aerial?state=NSW&srid=7856&bbox=${bbox}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  const meta = JSON.parse(decodeURIComponent(res.headers.get('x-site-meta')));
  assert.equal(meta.georef, 'mga');
  assert.equal(meta.srid, 7856);
  assert.equal(meta.captureDate, '05/03/2022');
  assert.match(meta.attribution, /NSW Spatial Services/);
  assert.ok(meta.widthPx > 100 && meta.mmPerPx > 0);
  assert.equal((await res.arrayBuffer()).byteLength, 500);
  const n = fetchImpl.calls.length;
  await get(`/aerial?state=NSW&srid=7856&bbox=${bbox}`);
  assert.equal(fetchImpl.calls.length, n);
});

test('aerial: falls back to web mercator when the MGA export is refused', async () => {
  const { get } = mk({ failDirectAerial: true });
  const res = await get(`/aerial?state=NSW&srid=7856&bbox=${C.e - 40},${C.n - 50},${C.e + 40},${C.n + 50}`);
  assert.equal(res.status, 200);
  const meta = JSON.parse(decodeURIComponent(res.headers.get('x-site-meta')));
  assert.equal(meta.georef, 'web-mercator');
  assert.ok(meta.webBbox.maxX > meta.webBbox.minX);
  assert.ok(meta.outWidthPx > 0 && meta.outHeightPx > 0);
});

test('aerial: QLD is refused unless imagery is openly licensed aerial', async () => {
  const old = Date.UTC(2019, 1, 1);
  let items = [{ attributes: { objectid: 1, name: 'Planet_2025', capturestart: Date.UTC(2025, 1, 1), captureend: Date.UTC(2025, 1, 1) } }];
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/identify')) return new Response(JSON.stringify({ objectId: 1, catalogItems: { features: items } }), { status: 200 });
    return new Response(new Uint8Array(500).fill(9), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
  const app = createApp({ store: createMemoryStore(), env: {}, fetchImpl, now: () => T0 });
  const q = lonLatToMga(146.82, -19.26, 55);
  const path = `/aerial?state=QLD&srid=7855&bbox=${q.e - 40},${q.n - 40},${q.e + 40},${q.n + 40}`;
  const ask = (ip) => app.fetch(new Request(`https://x.test/api/site${path}`, { headers: { 'cf-connecting-ip': ip } }));
  const r1 = await ask('2.2.2.2');
  assert.equal(r1.status, 404);
  assert.equal((await r1.json()).reason, 'IMAGERY_NOT_OPEN');
  items = [{ attributes: { objectid: 1, name: 'SISP_2019', capturestart: old, captureend: old } }];
  const r2 = await ask('2.2.2.3');
  assert.equal(r2.status, 200);
  const meta = JSON.parse(decodeURIComponent(r2.headers.get('x-site-meta')));
  assert.equal(meta.captureDate, '01/02/2019');
  assert.match(meta.attribution, /State of Queensland/);
});

test('contours: DEM decoded, resampled onto an MGA grid, contours and provenance returned', async () => {
  const { get } = mk();
  const lotBox = `${C.e - 10},${C.n - 20},${C.e + 10},${C.n + 20}`;
  const res = await get(`/contours?state=NSW&srid=7856&bbox=${lotBox}&buffer=10&origin=${C.e},${C.n}`);
  assert.equal(res.status, 200);
  const b = await res.json();
  assert.equal(b.minor, 0.5);
  assert.equal(b.major, 2.5);
  const g = b.grid;
  assert.equal(g.cell, 2);
  assert.equal(g.values.length, g.cols * g.rows);
  assert.ok(g.values.every((v) => Number.isFinite(v)));
  assert.ok(Math.abs(g.x0 - -20) < 0.01 && Math.abs(g.y0 - 30) < 0.01);
  // The plane rises 0.05 per web metre going east; the grid should rise to the east and not change northwards by much.
  const row = Math.floor(g.rows / 2);
  assert.ok(g.values[row * g.cols + g.cols - 1] > g.values[row * g.cols] + 1);
  assert.ok(b.contours.length > 0 && b.contours.every((c) => c.points.length >= 2));
  assert.ok(b.contours.some((c) => c.major && Math.abs(c.level / 2.5 - Math.round(c.level / 2.5)) < 1e-9));
  assert.match(b.provenance.note, /NSW 5 m DEM, indicative only; detailed survey required/);
  assert.equal(b.provenance.resolutionM, 5);
  assert.ok(b.minRL < b.maxRL);
});

test('contours: a bad raster is reported as a 502, not a crash', async () => {
  const fetchImpl = async () => new Response(new TextEncoder().encode('<html>error</html>'), { status: 200, headers: { 'content-type': 'text/html' } });
  const app = createApp({ store: createMemoryStore(), env: {}, fetchImpl, now: () => T0 });
  const res = await app.fetch(new Request(`https://x.test/api/site/contours?state=NSW&srid=7856&bbox=${C.e - 10},${C.n - 10},${C.e + 10},${C.n + 10}`));
  assert.equal(res.status, 502);
});

test('health: probes every upstream and reports ok', async () => {
  const { get, fetchImpl } = mk();
  const res = await get('/health');
  assert.equal(res.status, 200);
  const b = await res.json();
  assert.equal(b.upstreams.length, 14);
  assert.equal(b.ok, true);
  assert.ok(b.upstreams.every((u) => u.ok));
  assert.ok(fetchImpl.calls.length >= 14);
});

test('health: a failing required upstream makes ok false, optional ones only allOk', async () => {
  const bad = mk({ fail: /NSW_Cadastre/ });
  const b1 = await (await bad.get('/health')).json();
  assert.equal(b1.ok, false);
  const opt = mk({ fail: /NSW_5M_Elevation/ });
  const b2 = await (await opt.get('/health')).json();
  assert.equal(b2.ok, true);
  assert.equal(b2.allOk, false);
});

test('rate limit: search is limited per IP and other IPs are unaffected', async () => {
  const { get } = mk();
  let last = 0;
  for (let i = 0; i < 61; i++) last = (await get('/search?q=12+smith+street', '9.9.9.9')).status;
  assert.equal(last, 429);
  assert.equal((await get('/search?q=12+smith+street', '8.8.8.8')).status, 200);
});

test('unknown site endpoint is 404 and POST is 405', async () => {
  const { app, get } = mk();
  assert.equal((await get('/nothing')).status, 404);
  assert.equal((await app.fetch(new Request('https://x.test/api/site/lot', { method: 'POST' }))).status, 405);
});

test('CORS exposes x-site-meta for the site origin', async () => {
  const store = createMemoryStore();
  const app = createApp({ store, env: { SITE_URL: 'https://site.test' }, fetchImpl: upstream(), now: () => T0 });
  const res = await app.fetch(new Request('https://x.test/api/site/health', { headers: { origin: 'https://site.test' } }));
  assert.match(res.headers.get('access-control-expose-headers') || '', /x-site-meta/);
});

test('site cache: memory store honours the TTL', async () => {
  const s = createMemoryStore();
  await s.putSiteCache('k', '{"a":1}', 10, T0);
  assert.equal(await s.getSiteCache('k', T0 + 9000), '{"a":1}');
  assert.equal(await s.getSiteCache('k', T0 + 11000), null);
});

test('site cache: D1 store (sqlite shim) honours the TTL', { skip: !DatabaseSync }, async () => {
  const fs = await import('node:fs');
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  const stmt = (sql) => {
    const st = { binds: [] };
    st.bind = (...a) => { st.binds = a; return st; };
    st.run = async () => ({ meta: { changes: db.prepare(sql).run(...st.binds).changes } });
    st.first = async () => db.prepare(sql).get(...st.binds) ?? null;
    st.all = async () => ({ results: db.prepare(sql).all(...st.binds) });
    return st;
  };
  const d1 = { prepare: (sql) => stmt(sql.replace(/\?(\d+)/g, '?$1')) };
  const s = createD1Store(d1);
  await s.putSiteCache('lot:x', '{"b":2}', 60, T0);
  assert.equal(await s.getSiteCache('lot:x', T0 + 1000), '{"b":2}');
  assert.equal(await s.getSiteCache('lot:x', T0 + 61000), null);
  await s.putSiteCache('lot:x', '{"b":3}', 60, T0 + 70000);
  assert.equal(await s.getSiteCache('lot:x', T0 + 71000), '{"b":3}');
});

test('createCache keeps entries until they expire', async () => {
  let t = 0;
  const c = createCache({ now: () => t });
  await c.put('a', { body: new Uint8Array([1]).buffer, headers: {} }, 5);
  assert.ok(await c.get('a'));
  t = 6000;
  assert.equal(await c.get('a'), null);
});

test('QLD: search uses the Addresses layer, lot uses cadastral parcels, zoning is null with a note', async () => {
  const Q = lonLatToMga(146.8179, -19.2590, 55);
  const qlot = ring(Q.e - 12, Q.n - 15, 24, 30);
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    const p = url.pathname;
    const j = (b) => new Response(JSON.stringify(b), { status: 200 });
    if (p.endsWith('/MapServer/0/query')) return j({ features: [{ attributes: { address: '5 EXAMPLE STREET, WEST END QLD 4810' }, geometry: { x: 146.8179, y: -19.259 } }] });
    if (p.endsWith('/MapServer/4/query')) {
      const feats = [{ attributes: { lot: '7', plan: 'RP123', lotplan: '7RP123', lot_area: 720, tenure: 'Freehold', parcel_typ: 'Lot Type Parcel', locality: 'WEST END', shire_name: 'Townsville City' }, geometry: { rings: [qlot] } }];
      if (url.searchParams.get('geometryType') === 'esriGeometryEnvelope') feats.push({ attributes: { lot: '1', plan: 'SP9', lotplan: '1SP9', lot_area: 3000, tenure: 'Road', parcel_typ: 'Road', locality: 'WEST END' }, geometry: { rings: [ring(Q.e - 12, Q.n - 40, 24, 20)] } });
      return j({ features: feats });
    }
    if (p.endsWith('/MapServer/20/query')) return j({ features: [{ attributes: { lga: 'Townsville City' } }] });
    return j({ features: [] });
  };
  const app = createApp({ store: createMemoryStore(), env: {}, fetchImpl, now: () => T0 });
  const ask = (path) => app.fetch(new Request(`https://x.test/api/site${path}`, { headers: { 'cf-connecting-ip': '3.3.3.3' } }));
  const s = await (await ask('/search?q=5+example+street+west+end+qld')).json();
  assert.equal(s.results[0].state, 'QLD');
  assert.equal(s.results[0].label, "5 Example Street, West End QLD 4810");
  const b = await (await ask('/lot?lon=146.8179&lat=-19.259&state=QLD')).json();
  assert.equal(b.state, 'QLD');
  assert.equal(b.srid, 7855);
  assert.equal(b.lot.lotLabel, 'Lot 7 RP 123');
  assert.equal(b.zoning, null);
  assert.match(b.zoneNote, /council/);
  assert.equal(b.lga, 'Townsville City');
  assert.equal(b.neighbours.length, 1);
  assert.equal(b.neighbours[0].isRoad, true);
});

test('search routing: a state or postcode hint queries only that state, otherwise both run in parallel', async () => {
  const tk = (t) => t.toUpperCase().split(/\s+/);
  assert.equal(inferState(tk('12 smith street tamworth nsw')), 'NSW');
  assert.equal(inferState(tk('5 example street west end qld')), 'QLD');
  assert.equal(inferState(tk('5 example street queensland')), 'QLD');
  assert.equal(inferState(tk('5 example street new south wales')), 'NSW');
  assert.equal(inferState(tk('5 example street kirwan 4817')), 'QLD');
  assert.equal(inferState(tk('12 smith street tamworth 2340')), 'NSW');
  assert.equal(inferState(tk('12 smith street')), null);
  assert.equal(inferState(tk('12 smith street nsw qld')), null);

  const hosts = async (q) => {
    const calls = [];
    const { get } = mk({ calls });
    await (await get(`/search?q=${encodeURIComponent(q)}`)).json();
    return { nsw: calls.some((c) => /NSW_Geocoded/.test(c)), qld: calls.some((c) => /LandParcelPropertyFramework/.test(c)) };
  };
  assert.deepEqual(await hosts('12 smith street tamworth nsw'), { nsw: true, qld: false });
  assert.deepEqual(await hosts('12 smith street west end qld'), { nsw: false, qld: true });
  assert.deepEqual(await hosts('12 smith street'), { nsw: true, qld: true });

  // Parallel: both upstream calls are in flight before either answers.
  let inFlight = 0;
  let peak = 0;
  const slow = async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 30));
    inFlight--;
    return new Response(JSON.stringify({ features: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const app = createApp({ store: createMemoryStore(), env: {}, fetchImpl: slow, now: () => T0 });
  await app.fetch(new Request('https://api.test/api/site/search?q=12+smith+street', { headers: { 'cf-connecting-ip': '2.2.2.2' } }));
  assert.ok(peak >= 2, `upstream calls ran one after another (peak ${peak})`);
});

test('search: a slow upstream is cut off and an answer that arrived is still returned', async () => {
  const j = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  const impl = async (input) => {
    const u = String(input);
    if (/LandParcelPropertyFramework/.test(u)) return new Response('down', { status: 503 });
    return j({ features: [{ attributes: { address: '12 SMITH STREET TAMWORTH' }, geometry: { x: LON, y: LAT } }] });
  };
  const app = createApp({ store: createMemoryStore(), env: {}, fetchImpl: impl, now: () => T0 });
  const res = await app.fetch(new Request('https://api.test/api/site/search?q=12+smith+street', { headers: { 'cf-connecting-ip': '3.3.3.3' } }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.results[0].label, '12 Smith Street Tamworth NSW');
});
