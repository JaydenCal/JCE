// Builds the engineering style plan set for the Tamworth sample lot, in public and builder branding, with a synthetic aerial.
//   node tools/engplans-sample.mjs [outDir]        (default docs/engplans-review; writes urban/ and rural/ with PNG pages at 80 dpi when pdftoppm exists)
// The sample lot and its cadastre are invented (see tools/make-site-fixtures.mjs). The aerial is the real NSW photograph in
// tools/fixtures/sample-aerial.jpg (or the file named by SAMPLE_AERIAL), georeferenced over the fixture extent for the sample only.
// When that file is missing the synthetic aerial is drawn instead.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { jsPDF } from 'jspdf';
import { createProject } from '../src/model/schema.js';
import { catalogue } from '../src/catalogue/index.js';
import { buildSiteLot } from '../src/site/model.js';
import { FIXTURES } from '../src/site/fixtures/index.js';
import { siteLotSetbacks } from '../src/site/setbacks.js';
import { autoPose } from '../src/portal/auto-place.js';
import { placeHouse } from '../src/portal/place-house.js';
import { toEngineeringPDF } from '../src/premium/exporters/eng/index.js';

const here = (p) => new URL(p, import.meta.url);
const rules = JSON.parse(fs.readFileSync(here('../../setbacks-data/setback-rules.json'), 'utf8'));
const outDir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(here('../docs/engplans-review/').pathname);

/** Invented surrounding cadastre for the sample only: each fixture lot repeated along the street and one more row outward on each side, so the locality map has context to show. */
function extendLot(fl) {
  const copy = JSON.parse(JSON.stringify(fl));
  const base = [copy.lot, ...copy.neighbours];
  const ringOf = (n) => n.polygons[0].outer;
  const dSub = (() => { const r = ringOf(copy.lot); return { x: r[3][0] - r[0][0], y: r[3][1] - r[0][1] }; })();
  const out = [];
  const keys = new Set(base.map((n) => ringOf(n).reduce((a, q) => [a[0] + q[0] / 4, a[1] + q[1] / 4], [0, 0]).map((v) => Math.round(v / 3)).join(',')));
  let num = 100;
  const add = (n, ox, oy, plan) => {
    const ring = ringOf(n).map(([x, y]) => [x + ox, y + oy]);
    const key = ring.reduce((a, q) => [a[0] + q[0] / 4, a[1] + q[1] / 4], [0, 0]).map((v) => Math.round(v / 3)).join(',');
    if (keys.has(key)) return null;
    keys.add(key);
    num += 1;
    const m = { ...n, lotNumber: String(num), planLabel: plan, lotLabel: `Lot ${num} ${plan}`, polygons: [{ outer: ring, holes: [] }] };
    out.push(m);
    return m;
  };
  for (const n of base) {
    const r = ringOf(n);
    const w = { x: r[1][0] - r[0][0], y: r[1][1] - r[0][1] };
    for (let k = -10; k <= 10; k++) if (k) add(n, w.x * k, w.y * k, 'DP 1234567');
  }
  // One row further out behind the rear row and beyond the row across the road
  const rows = [...base, ...out];
  const dotD = (n) => { const r = ringOf(n); const c = r.reduce((a, q) => [a[0] + q[0] / 4, a[1] + q[1] / 4], [0, 0]); return (c[0] * dSub.x + c[1] * dSub.y) / (dSub.x ** 2 + dSub.y ** 2); };
  const vals = rows.map(dotD);
  const hi = Math.max(...vals);
  const lo = Math.min(...vals);
  for (const n of rows) {
    const r = ringOf(n);
    const depth = { x: r[3][0] - r[0][0], y: r[3][1] - r[0][1] };
    const dv = dotD(n);
    if (Math.abs(dv - hi) < 0.05) add(n, dSub.x * 1, dSub.y * 1, 'DP 1234568');
    if (Math.abs(dv - lo) < 0.05) add(n, -dSub.x * 0.75, -dSub.y * 0.75, 'DP 1234569');
    void depth;
  }
  copy.neighbours = [...copy.neighbours, ...out];
  return copy;
}

const SAMPLE_AERIAL = process.env.SAMPLE_AERIAL ? path.resolve(process.env.SAMPLE_AERIAL) : path.resolve(here('./fixtures/sample-aerial.jpg').pathname);
const AERIAL_CREDIT = 'Aerial imagery: NSW Spatial Services (sample).';
let sampleImg;
/** The real sample photograph decoded once, or null when the file is missing. */
async function sampleImage() {
  if (sampleImg !== undefined) return sampleImg;
  sampleImg = null;
  try {
    if (fs.existsSync(SAMPLE_AERIAL)) sampleImg = await (await import('@napi-rs/canvas')).loadImage(fs.readFileSync(SAMPLE_AERIAL));
  } catch { sampleImg = null; }
  return sampleImg;
}

/** The sample photograph over a ground window (metres, any origin): the picture is laid down as mirrored tiles of tileM metres across, so any extent has ground. */
async function sampleGround(img, win, widthPx, tileM) {
  const { createCanvas } = await import('@napi-rs/canvas');
  const heightPx = Math.round((widthPx * (win.maxN - win.minN)) / (win.maxE - win.minE));
  const c = createCanvas(widthPx, heightPx);
  const g = c.getContext('2d');
  const tw = tileM;
  const th = tileM * (img.height / img.width);
  const sx = widthPx / (win.maxE - win.minE);
  const sy = heightPx / (win.maxN - win.minN);
  for (let i = Math.floor(win.minE / tw); i <= Math.floor(win.maxE / tw); i++) {
    for (let j = Math.floor(win.minN / th); j <= Math.floor(win.maxN / th); j++) {
      const dw = tw * sx;
      const dh = th * sy;
      const fx = i % 2 !== 0;
      const fy = j % 2 !== 0;
      g.save();
      g.translate((i * tw - win.minE) * sx + (fx ? dw : 0), (win.maxN - (j + 1) * th) * sy + (fy ? dh : 0));
      g.scale(fx ? -1 : 1, fy ? -1 : 1);
      g.drawImage(img, 0, 0, dw + 1, dh + 1); // mirrored tiles share edges, so there is no seam
      g.restore();
    }
  }
  return { buf: c.toBuffer('image/jpeg', 78), heightPx };
}

async function syntheticAerial(fixture) {
  let canvasLib;
  try { canvasLib = await import('@napi-rs/canvas'); } catch { return null; }
  const { createCanvas } = canvasLib;
  globalThis.OffscreenCanvas = class {
    constructor(w, h) { this.c = createCanvas(w, h); }
    getContext(t) {
      const g = this.c.getContext(t);
      // The mock paints a flat grey ground first: replace it with paddocks and bush so the sample aerial has ground to show everywhere
      const fr = g.fillRect.bind(g);
      let done = false;
      g.fillRect = (x, y, w, h) => {
        if (!done && w >= this.c.width && h >= this.c.height) {
          done = true;
          let seed = 11;
          const r = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
          g.fillStyle = '#6f7a58'; fr(x, y, w, h);
          for (let i = 0; i < 260; i++) { g.fillStyle = `rgb(${96 + Math.floor(r() * 50)},${108 + Math.floor(r() * 36)},${62 + Math.floor(r() * 30)})`; fr(r() * w, r() * h, 40 + r() * 160, 30 + r() * 120); }
          for (let i = 0; i < 2500; i++) { g.fillStyle = 'rgba(40,70,38,0.8)'; g.beginPath(); g.arc(r() * w, r() * h, 2 + r() * 5, 0, 7); g.fill(); }
          return;
        }
        fr(x, y, w, h);
      };
      return g;
    }
    async convertToBlob() { return new Blob([this.c.toBuffer('image/jpeg', 80)], { type: 'image/jpeg' }); }
  };
  const { mockAerialBlob } = await import('../src/site/mock-aerial.js');
  const m = 450; // wider than the fixture picture so the locality map has ground to show
  const b = fixture.aerial.bbox;
  const bbox = { minE: b.minE - m, minN: b.minN - m, maxE: b.maxE + m, maxN: b.maxN + m };
  const widthPx = 2048;
  const heightPx = Math.round((widthPx * (bbox.maxN - bbox.minN)) / (bbox.maxE - bbox.minE));
  const meta = { ...fixture.aerial, bbox, widthPx, heightPx, mmPerPx: ((bbox.maxE - bbox.minE) * 1000) / widthPx };
  const blob = await mockAerialBlob(meta, extendLot(fixture.lot));
  const buf = Buffer.from(await blob.arrayBuffer());
  return { meta, url: `data:image/jpeg;base64,${buf.toString('base64')}` };
}

/** The urban aerial: the real photograph georeferenced over the fixture extent (the fixture cadastre is invented, so it does not line up with the buildings), else the synthetic one. */
async function urbanAerial(fixture) {
  const img = await sampleImage();
  if (!img) return syntheticAerial(fixture);
  const m = 450;
  const b = fixture.aerial.bbox;
  const bbox = { minE: b.minE - m, minN: b.minN - m, maxE: b.maxE + m, maxN: b.maxN + m };
  const widthPx = 2048;
  // One tile spans the whole extent, so the picture is laid across it once
  const { buf, heightPx } = await sampleGround(img, { minE: 0, minN: 0, maxE: bbox.maxE - bbox.minE, maxN: bbox.maxN - bbox.minN }, widthPx, bbox.maxE - bbox.minE);
  const meta = { ...fixture.aerial, bbox, widthPx, heightPx, mmPerPx: ((bbox.maxE - bbox.minE) * 1000) / widthPx };
  return { meta, real: true, url: `data:image/jpeg;base64,${buf.toString('base64')}` };
}

export async function sampleProject({ withAerial = true } = {}) {
  const f = FIXTURES[0];
  const aer = withAerial ? await urbanAerial(f) : null;
  const lot = buildSiteLot({ lot: extendLot(f.lot), aerialMeta: aer?.meta || f.aerial, aerialKey: aer ? 'sample-aerial' : null, contours: f.contours, address: f.search[0].label, source: 'sample' });
  const r = siteLotSetbacks(lot, rules, { storeys: 2, wallHeightM: 5.4, buildingHeightM: 8 });
  lot.setbacks = r.setbacks;
  lot.envelope = r.envelope;
  if (aer?.real && lot.aerial) { lot.aerial.attribution = ''; lot.aerial.source = ''; }
  // The fixture coordinates are synthetic; place the search point where Calala really is so the locality map can point to the town centre.
  lot.query = { lon: 150.9296, lat: -31.0446 };
  const p = createProject({ name: 'Sample Residence' });
  p.colourScheme = 'ironstone-brick';
  p.site.lot = lot;
  Object.assign(p.titleBlock, { client: 'A Sample Client', jobNumber: 'TAM24', council: 'Tamworth Regional' });
  const h = catalogue.createFromTemplate('house_double');
  placeHouse(p, h, autoPose(p, h).pose);
  return { project: p, aerial: aer?.url || null };
}

// Rural fixture ------------------------------------------------------------------------------------------------------------------
// A large irregular rural lot (50.93 ha, MGA zone 56, near Gunnedah) on Quia Road, with the aerial stored the way the app stores it
// (the lot plus a 30 m margin) and a wider aerial supplied through options.fetchAerial, the way the site service would. Invented
// geometry: no real parcel. Cadastre shapes follow the lookup response (metres from the origin, north up).
const RURAL_RING = [[-560, -270], [-180, -270], [120, -270], [540, -270], [600, -120], [560, 60], [610, 230], [300, 300], [-60, 265], [-330, 290], [-600, 210], [-640, 0]];
const shoelace = (r) => Math.abs(r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + (p[0] * q[1] - q[0] * p[1]); }, 0)) / 2;

function ruralWorld() {
  const k = Math.sqrt(509300 / shoelace(RURAL_RING));
  const lotRing = RURAL_RING.map(([x, y]) => [Math.round(x * k * 100) / 100, Math.round(y * k * 100) / 100]);
  // Neighbouring holdings: a jittered grid of rural lots around and beyond, skipping the subject lot, each pulled off the road
  let seed = 5;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const nbs = [];
  const roadN = -285 * k; // Quia Road centreline sits south of the south boundary
  let num = 10;
  for (let gx = -4; gx <= 4; gx++) {
    for (let gy = -3; gy <= 3; gy++) {
      const w = 760 + rnd() * 260;
      const h = 520 + rnd() * 240;
      const x0 = gx * 900 + (rnd() - 0.5) * 120 - w / 2 + 60;
      const y0 = gy * 700 + (rnd() - 0.5) * 100 - h / 2;
      const ring = [[x0, y0], [x0 + w, y0 + rnd() * 30], [x0 + w + rnd() * 30, y0 + h], [x0 + rnd() * 30, y0 + h - rnd() * 30]].map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
      const c = ring.reduce((a, q) => [a[0] + q[0] / 4, a[1] + q[1] / 4], [0, 0]);
      if (Math.hypot(c[0], c[1]) < 520) continue; // inside the subject lot's own ground
      if (Math.abs(c[1] - roadN) < h / 2 + 12) continue; // keep the road corridor clear
      num += 1;
      nbs.push({ lotNumber: String(num), planLabel: `DP ${1000100 + num * 7}`, lotLabel: `Lot ${num} DP ${1000100 + num * 7}`, areaM2: Math.round(shoelace(ring)), polygons: [{ outer: ring, holes: [] }], isRoad: false });
    }
  }
  const roads = [
    { name: 'Mullaley Road', points: [[-2400, 700], [-1200, 500], [0, 640], [1400, 760], [2800, 620]] },
    { name: 'Quia Road', points: [[-2800, roadN - 6], [-1400, roadN + 4], [0, roadN], [1400, roadN - 8], [2800, roadN + 2]] },
    { name: 'River Street', points: [[-2400, 330 * k + 30], [-800, 330 * k + 30], [0, 345 * k + 30], [800, 322 * k + 30], [2800, 340 * k + 30]] },
    { name: 'Boggabri Lane', points: [[1500, -2100], [1560, -900], [1520, 300], [1580, 2100]] },
  ];
  return { k, lotRing, nbs, roads, roadN };
}

async function ruralAerialBytes(world, bboxRel, origin) {
  const { createCanvas } = await import('@napi-rs/canvas');
  const W = Math.min(3600, Math.round((bboxRel.maxE - bboxRel.minE) / 0.9));
  const real = await sampleImage();
  if (real) return (await sampleGround(real, bboxRel, W, 1000)).buf;
  const H = Math.round((W * (bboxRel.maxN - bboxRel.minN)) / (bboxRel.maxE - bboxRel.minE));
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  const px = (e) => ((e - bboxRel.minE) / (bboxRel.maxE - bboxRel.minE)) * W;
  const py = (n) => ((bboxRel.maxN - n) / (bboxRel.maxN - bboxRel.minN)) * H;
  let seed = 3;
  const r = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  g.fillStyle = '#8a8f63'; g.fillRect(0, 0, W, H);
  const rings = [world.lotRing, ...world.nbs.map((n) => n.polygons[0].outer)];
  for (const ring of rings) {
    const base = [96 + r() * 70, 104 + r() * 50, 62 + r() * 30];
    g.fillStyle = `rgb(${base.map(Math.round)})`;
    g.beginPath(); ring.forEach(([e, n], i) => g[i ? 'lineTo' : 'moveTo'](px(e), py(n))); g.closePath(); g.fill();
    const xs = ring.map((q) => q[0]); const ys = ring.map((q) => q[1]);
    for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(${90 + r() * 90},${100 + r() * 70},${60 + r() * 40},0.45)`; g.fillRect(px(Math.min(...xs) + r() * (Math.max(...xs) - Math.min(...xs))), py(Math.min(...ys) + r() * (Math.max(...ys) - Math.min(...ys))), 40 + r() * 160, 30 + r() * 100); }
    g.fillStyle = 'rgba(38,66,36,0.85)';
    for (let i = 0; i < 70; i++) { const e = Math.min(...xs) + r() * (Math.max(...xs) - Math.min(...xs)); const n = Math.min(...ys) + r() * (Math.max(...ys) - Math.min(...ys)); g.beginPath(); g.arc(px(e), py(n), 2 + r() * 5, 0, 7); g.fill(); }
  }
  g.strokeStyle = '#c9c2ae'; g.lineWidth = Math.max(3, W / 400);
  for (const rd of world.roads) { g.beginPath(); rd.points.forEach(([e, n], i) => g[i ? 'lineTo' : 'moveTo'](px(e), py(n))); g.stroke(); }
  g.fillStyle = '#d8d4c6'; g.fillRect(px(-40), py(world.roadN + 130), 26, 18); g.fillStyle = '#7a4a3c'; g.fillRect(px(-38), py(world.roadN + 128), 22, 14);
  void origin;
  return c.toBuffer('image/jpeg', 78);
}

export async function ruralProject() {
  const world = ruralWorld();
  const origin = { e: 238412.5, n: 6571834.2 };
  const b = { minX: Math.min(...world.lotRing.map((q) => q[0])), maxX: Math.max(...world.lotRing.map((q) => q[0])), minY: Math.min(...world.lotRing.map((q) => q[1])), maxY: Math.max(...world.lotRing.map((q) => q[1])) };
  const m = 30;
  const aerialBox = { minE: b.minX - m, minN: b.minY - m, maxE: b.maxX + m, maxN: b.maxY + m };
  const bufM = 40;
  const cell = 5;
  const gx0 = b.minX - bufM; const gy1 = b.maxY + bufM;
  const cols = Math.ceil((b.maxX + bufM - gx0) / cell) + 1;
  const rows = Math.ceil((gy1 - (b.minY - bufM)) / cell) + 1;
  const values = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const e = gx0 + i * cell; const n = gy1 - j * cell; values.push(Math.round((318 + 0.011 * n - 0.006 * e + 3.2 * Math.sin(e / 210) + 2.4 * Math.cos(n / 170)) * 100) / 100); }
  const grid = { cols, rows, cell, x0: gx0, y0: gy1, values };
  const { contourLines } = await import('../src/site/contours.js');
  const contours = { sample: true, srid: 7856, origin, minor: 1, major: 5, minRL: Math.min(...values), maxRL: Math.max(...values), grid, contours: contourLines(grid, { minor: 1, major: 5 }), provenance: { source: 'NSW 5 m DEM (sample)', resolutionM: 5, datum: 'AHD', copyright: 'DFSI 2019', retrieved: '2026-11-11', note: 'indicative only' } };
  const lotResp = {
    state: 'NSW', srid: 7856, zone: 56, origin, query: { lon: 150.2711, lat: -30.9864 },
    lot: { lotNumber: '3', planLabel: 'DP 263990', lotLabel: 'Lot 3 DP 263990', areaM2: 509300, registeredAreaM2: 509300, polygons: [{ outer: world.lotRing, holes: [] }], bboxMga: { minE: origin.e + b.minX, minN: origin.n + b.minY, maxE: origin.e + b.maxX, maxN: origin.n + b.maxY } },
    neighbours: world.nbs.filter((n) => n.polygons[0].outer.some(([x, y]) => x > b.minX - 60 && x < b.maxX + 60 && y > b.minY - 60 && y < b.maxY + 60)),
    // The lookup lists River Street first (it runs along the far boundary), then the frontage road
    roads: ['River Street', 'Quia Road'].map((n) => world.roads.find((rd) => rd.name === n)).map((rd) => ({ name: rd.name, points: rd.points })),
    lga: 'GUNNEDAH SHIRE', zoning: { code: 'RU1', name: 'Primary Production', instrument: 'Gunnedah Local Environmental Plan 2012' }, zoneNote: null,
    attribution: 'Cadastre: NSW Spatial Services (CC BY).', retrieved: '2026-11-11T00:00:00.000Z',
  };
  const aerialBytes = await ruralAerialBytes(world, aerialBox, origin);
  const widthPx = 1800;
  const meta = { srid: 7856, georef: 'mga', bbox: { minE: origin.e + aerialBox.minE, minN: origin.n + aerialBox.minN, maxE: origin.e + aerialBox.maxE, maxN: origin.n + aerialBox.maxN }, widthPx, heightPx: 900, mmPerPx: 600, source: 'NSW Imagery (sample, synthetic picture)', attribution: 'Imagery: NSW Spatial Services (c) Department of Customer Service 2020. Sample picture only.', captureDate: null };
  const lot = buildSiteLot({ lot: lotResp, aerialMeta: meta, aerialKey: 'rural-aerial', contours, address: '756 Quia Road Gunnedah NSW', source: 'sample' });
  // The way the service reports it: the lookup gives the first road it finds, which is not always the one the lot fronts
  const r = siteLotSetbacks(lot, rules, { storeys: 1, wallHeightM: 2.7, buildingHeightM: 5 });
  lot.setbacks = r.setbacks;
  lot.envelope = r.envelope;
  if (await sampleImage() && lot.aerial) { lot.aerial.attribution = ''; lot.aerial.source = ''; }
  const p = createProject({ id: 'p_rural_demo', name: '  Single   storey,  4 bedroom ' });
  p.site.lot = lot;
  Object.assign(p.titleBlock, { client: 'A Sample Client', council: 'Gunnedah Shire', lotDp: 'Lot 3 DP 263990' });
  const h = catalogue.createFromTemplate('house_single') || catalogue.createFromTemplate('house_double');
  placeHouse(p, h, autoPose(p, h).pose);
  // The wider aerial: the same invented ground over the ground the locality map needs (what the site service would return)
  const fetchAerial = async ({ extent }) => {
    const bx = { minE: extent.x0 / 1000, maxE: extent.x1 / 1000, minN: -extent.y1 / 1000, maxN: -extent.y0 / 1000 };
    // The wider cadastre and roads for the locality map, in plan mm as the lot carries them
    const flat = (pts) => pts.flatMap(([e, n]) => [Math.round(e * 1000), Math.round(-n * 1000)]);
    const neighbours = world.nbs.map((n, i) => ({ id: `w_${i}`, lotNumber: n.lotNumber, planLabel: n.planLabel, isRoad: false, ring: n.polygons[0].outer.map(([e, n2]) => ({ x: Math.round(e * 1000), y: Math.round(-n2 * 1000) })), holes: [] }));
    return { bytes: await ruralAerialBytes(world, bx, origin), extent, neighbours, roads: world.roads.map((rd) => ({ name: rd.name, pts: flat(rd.points) })) };
  };
  return { project: p, fetchAerial, aerial: `data:image/jpeg;base64,${aerialBytes.toString('base64')}` };
}

async function main() {
  const jobs = [['urban', await sampleProject(), 'tamworth'], ['rural', await ruralProject(), 'gunnedah']];
  const date = new Date(2026, 10, 11);
  for (const [dir, { project, aerial, fetchAerial }, tag] of jobs) {
    const out = path.join(outDir, dir);
    fs.mkdirSync(out, { recursive: true });
    for (const f of fs.readdirSync(out)) if (/\.(png|pdf)$/.test(f)) fs.rmSync(path.join(out, f));
    for (const [name, builder] of [['public', null], ['builder', { name: 'Sample Builder Homes', logo: null }]]) {
      const bytes = await toEngineeringPDF(project, { jsPDF, catalogue, date, builder, aerial, fetchAerial, aerialCredit: (await sampleImage()) ? AERIAL_CREDIT : null });
      const pdf = path.join(out, `${tag}-${name}.pdf`);
      fs.writeFileSync(pdf, bytes);
      console.log(pdf, bytes.layout.sheets.length, 'sheets');
      spawnSync('pdftoppm', ['-r', '80', '-png', pdf, path.join(out, name)], { stdio: 'inherit' });
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) await main();
