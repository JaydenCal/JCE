// Lot data integrity: one parcel supplies the label, area and outline; multipart lots; plan label formatting; neighbourM; title block
// staleness; and the clearance maths on a bent frontage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/lib/app.js';
import { createMemoryStore } from '../server/lib/store.js';
import { neighbourDistance } from '../server/lib/site.js';
import { lonLatToMga, formatPlan, formatLotLabel } from '../src/site/geo.js';
import { buildSiteLot } from '../src/site/model.js';
import * as L from '../src/site/lotplan.js';

const LON = 150.2701; // Gunnedah, zone 56
const LAT = -30.9801;
const C = lonLatToMga(LON, LAT, 56);
const rect = (e0, n0, w, h) => [[e0, n0], [e0, n0 + h], [e0 + w, n0 + h], [e0 + w, n0], [e0, n0]];
const feat = (rings, attrs) => ({ attributes: attrs, geometry: { rings } });
const j = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });

function mk({ pointFeatures, envFeatures = [] }) {
  const log = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(String(input));
    const q = url.searchParams;
    const p = url.pathname;
    if (p.endsWith('NSW_Cadastre/MapServer/9/query')) {
      log.push(Object.fromEntries(q));
      if (q.has('resultRecordCount')) return j({ error: { code: 400, message: 'Failed to execute query.' } });
      return j({ features: q.get('geometryType') === 'esriGeometryEnvelope' ? envFeatures : pointFeatures });
    }
    if (p.includes('NSW_Administrative_Boundaries')) return j({ features: [{ attributes: { lganame: 'GUNNEDAH' } }] });
    if (p.includes('EPI_Primary_Planning_Layers')) return j({ features: [{ attributes: { SYM_CODE: 'RU1', LAY_CLASS: 'Primary Production', EPI_NAME: 'Gunnedah LEP' } }] });
    if (p.includes('NSW_Transport_Theme')) return j({ features: [] });
    return new Response('unexpected', { status: 404 });
  };
  const app = createApp({ store: createMemoryStore(), env: {}, fetchImpl, now: () => Date.UTC(2026, 10, 11) });
  return { log, get: (path) => app.fetch(new Request(`https://api.test/api/site${path}`, { headers: { 'cf-connecting-ip': '2.2.2.2' } })) };
}

test('plan labels and lot labels: leading zeros dropped, section included', () => {
  assert.equal(formatPlan('DP263990'), 'DP 263990');
  assert.equal(formatPlan('DP0254'), 'DP 254');
  assert.equal(formatPlan(' sp 12 '), 'SP 12');
  assert.equal(formatLotLabel({ lotNumber: '3', section: '', planLabel: 'DP263990' }), 'Lot 3 DP 263990');
  assert.equal(formatLotLabel({ lotNumber: '18', section: '13', planLabel: 'DP758951' }), 'Lot 18 Sec 13 DP 758951');
});

test('lot: label, area and outline all come from the largest parcel at the point, not a small stacked or neighbouring one', async () => {
  const big = rect(C.e - 400, C.n - 300, 800, 600); // 48 ha
  const small = rect(C.e - 15, C.n - 26, 30, 26.3); // 789 m2, Lot 3 DP 254
  const { get } = mk({
    pointFeatures: [
      feat([small], { lotnumber: '3', sectionnumber: null, planlabel: 'DP0254', planlotarea: 789, lotidstring: '3//DP254' }),
      feat([big], { lotnumber: '3', sectionnumber: null, planlabel: 'DP263990', planlotarea: 480000, lotidstring: '3//DP263990' }),
    ],
  });
  const b = await (await get(`/lot?lon=${LON}&lat=${LAT}&state=NSW`)).json();
  assert.equal(b.lot.lotLabel, 'Lot 3 DP 263990');
  assert.equal(b.lot.planLabel, 'DP 263990');
  assert.ok(Math.abs(b.lot.areaM2 - 480000) < 1);
  assert.equal(b.lot.polygons.length, 1);
  const xs = b.lot.polygons[0].outer.map((p) => p[0]);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 790, 'outline is the big parcel');
});

test('lot: a multipart lot keeps every part, the area is the sum and the bounding box covers all parts', async () => {
  const a = rect(C.e - 50, C.n - 50, 100, 100); // 10000
  const bpart = rect(C.e + 200, C.n - 20, 50, 40); // 2000
  const { get } = mk({ pointFeatures: [feat([a, bpart], { lotnumber: '18', sectionnumber: '13', planlabel: 'DP758951', planlotarea: 12000, lotidstring: '18/13/DP758951' })] });
  const b = await (await get(`/lot?lon=${LON}&lat=${LAT}&state=NSW`)).json();
  assert.equal(b.lot.lotLabel, 'Lot 18 Sec 13 DP 758951');
  assert.equal(b.lot.polygons.length, 2);
  assert.ok(Math.abs(b.lot.areaM2 - 12000) < 1);
  assert.ok(b.lot.bboxMga.maxE - b.lot.bboxMga.minE > 295, 'bbox spans both parts');
  // Client model: the largest part is the boundary, the rest are `parts`; the area is the whole lot.
  const site = buildSiteLot({ lot: b });
  assert.equal(site.parts.length, 1);
  assert.equal(site.areaM2, b.lot.areaM2);
  assert.equal(site.lotLabel, 'Lot 18 Sec 13 DP 758951');
});

test('lot: neighbourM defaults to max(60, 15% of the diagonal), is capped at 400, and sizes the neighbour query', () => {
  assert.equal(neighbourDistance(null, 50), 60);
  assert.equal(neighbourDistance(null, 1000), 150);
  assert.equal(neighbourDistance(null, 20000), 400);
  assert.equal(neighbourDistance('250', 10), 250);
  assert.equal(neighbourDistance('9999', 10), 400);
  assert.equal(neighbourDistance('-5', 10), 0);
});

test('lot: neighbour envelope grows with neighbourM, sends no resultRecordCount to NSW and simplifies big extents', async () => {
  const lotRing = rect(C.e - 400, C.n - 300, 800, 600);
  const attrs = { lotnumber: '3', sectionnumber: null, planlabel: 'DP263990', planlotarea: 480000, lotidstring: '3//DP263990' };
  const one = mk({ pointFeatures: [feat([lotRing], attrs)] });
  await (await one.get(`/lot?lon=${LON}&lat=${LAT}&state=NSW&neighbourM=300`)).json();
  const env = one.log.find((q) => q.geometryType === 'esriGeometryEnvelope');
  const e = JSON.parse(env.geometry);
  assert.ok(e.xmax - e.xmin > 800 + 2 * 299 && e.xmax - e.xmin < 800 + 2 * 301);
  assert.equal(env.resultRecordCount, undefined);
  assert.ok(env.maxAllowableOffset && env.geometryPrecision);
  const def = mk({ pointFeatures: [feat([lotRing], attrs)] });
  await (await def.get(`/lot?lon=${LON}&lat=${LAT}&state=NSW`)).json();
  const e2 = JSON.parse(def.log.find((q) => q.geometryType === 'esriGeometryEnvelope').geometry);
  assert.ok(Math.abs(e2.xmax - e2.xmin - (800 + 2 * 150)) < 2, 'default scales with the lot diagonal (1000 m x 0.15)');
  assert.equal((await one.get(`/lot?lon=${LON}&lat=${LAT}&state=NSW&neighbourM=abc`)).status, 400);
});

test('lot: radius is capped at 300 m, sizes the neighbour query, rejects non-numbers and is cached per value', async () => {
  const lotRing = rect(C.e - 40, C.n - 30, 80, 60);
  const attrs = { lotnumber: '3', sectionnumber: null, planlabel: 'DP263990', planlotarea: 4800, lotidstring: '3//DP263990' };
  const big = mk({ pointFeatures: [feat([lotRing], attrs)] });
  await (await big.get(`/lot?lon=${LON}&lat=${LAT}&state=NSW&radius=9999`)).json();
  const e = JSON.parse(big.log.find((q) => q.geometryType === 'esriGeometryEnvelope').geometry);
  assert.ok(e.xmax - e.xmin > 80 + 2 * 299 && e.xmax - e.xmin < 80 + 2 * 301, 'radius 9999 is clamped to 300');
  assert.equal((await big.get(`/lot?lon=${LON}&lat=${LAT}&state=NSW&radius=abc`)).status, 400);
  const n = big.log.filter((q) => q.geometryType === 'esriGeometryEnvelope').length;
  await (await big.get(`/lot?lon=${LON}&lat=${LAT}&state=NSW&radius=9999`)).json();
  assert.equal(big.log.filter((q) => q.geometryType === 'esriGeometryEnvelope').length, n, 'second identical request is served from the cache');
  const small = mk({ pointFeatures: [feat([lotRing], attrs)] });
  await (await small.get(`/lot?lon=${LON}&lat=${LAT}&state=NSW&radius=200`)).json();
  const e2 = JSON.parse(small.log.find((q) => q.geometryType === 'esriGeometryEnvelope').geometry);
  assert.ok(e2.xmax - e2.xmin > 80 + 2 * 199 && e2.xmax - e2.xmin < 80 + 2 * 201);
});

test('title block: a stale auto-filled Lot and DP never overrides the found lot; a typed value does', () => {
  const lot = { lotLabel: 'Lot 3 DP 263990', areaM2: 509264.5 };
  const stale = { titleBlock: { lotDp: 'Lot 3 DP 254' }, site: { lot } };
  assert.equal(L.titleLotDp(stale), 'Lot 3 DP 263990');
  assert.equal(L.titleLotDp({ titleBlock: { lotDp: 'Stage 2 (lot 3)' }, site: { lot } }), 'Stage 2 (lot 3)');
  assert.equal(L.titleLotDp({ titleBlock: { lotDp: '' }, site: { lot } }), 'Lot 3 DP 263990');
  assert.equal(L.titleLotDp({ titleBlock: { lotDp: 'Lot 9 DP 1' }, site: {} }), 'Lot 9 DP 1');
});

test('clearance: a corner over the extended line of a bent frontage edge is not reported as outside by hundreds of metres', () => {
  // Bent frontage: edge 0 runs along y = 0 from x=0 to 20000, edge 1 turns up and right (a 150 degree bend), the lot lies at +y (down the page).
  const boundary = [{ x: 0, y: 0 }, { x: 20000, y: 0 }, { x: 30000, y: 6000 }, { x: 30000, y: 40000 }, { x: 0, y: 40000 }];
  const lot = { boundary };
  // A house corner well inside the lot whose foot on edge 0 falls beyond its end (x > 20000), over the extended line of the bend.
  const house = [{ x: 22000, y: 12000 }, { x: 28000, y: 12000 }, { x: 28000, y: 20000 }, { x: 22000, y: 20000 }];
  const best = L.clearanceToEdge([house], lot, 0);
  assert.ok(best.d > 0, `clearance is positive room, got ${best.d}`);
  assert.ok(Math.abs(best.d - Math.hypot(2000, 12000)) < 1, `nearest is the end of the segment, got ${best.d}`);
});
