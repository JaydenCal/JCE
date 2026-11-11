// Builds the engineering style plan set for the Tamworth sample lot, in public and builder branding, with a synthetic aerial.
//   node tools/engplans-sample.mjs [outDir]        (default docs/engplans-review; also writes PNG pages at 80 dpi when pdftoppm exists)
// The sample lot and its aerial are invented (see tools/make-site-fixtures.mjs): the aerial is a picture of nothing real.
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

export async function sampleProject({ withAerial = true } = {}) {
  const f = FIXTURES[0];
  const aer = withAerial ? await syntheticAerial(f) : null;
  const lot = buildSiteLot({ lot: extendLot(f.lot), aerialMeta: aer?.meta || f.aerial, aerialKey: aer ? 'sample-aerial' : null, contours: f.contours, address: f.search[0].label, source: 'sample' });
  const r = siteLotSetbacks(lot, rules, { storeys: 2, wallHeightM: 5.4, buildingHeightM: 8 });
  lot.setbacks = r.setbacks;
  lot.envelope = r.envelope;
  // The fixture coordinates are synthetic; place the search point where Calala really is so the locality map can point to the town centre.
  lot.query = { lon: 150.9296, lat: -31.0446 };
  const p = createProject({ name: 'Sample Residence' });
  p.site.lot = lot;
  Object.assign(p.titleBlock, { client: 'A Sample Client', jobNumber: 'TAM24', council: 'Tamworth Regional' });
  const h = catalogue.createFromTemplate('house_double');
  placeHouse(p, h, autoPose(p, h).pose);
  return { project: p, aerial: aer?.url || null };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const { project, aerial } = await sampleProject();
  const date = new Date(2026, 10, 11);
  for (const [name, builder] of [['public', null], ['builder', { name: 'Sample Builder Homes', logo: null }]]) {
    const bytes = await toEngineeringPDF(project, { jsPDF, catalogue, date, builder, aerial });
    const pdf = path.join(outDir, `tamworth-${name}.pdf`);
    fs.writeFileSync(pdf, bytes);
    console.log(pdf, bytes.layout.sheets.length, 'sheets');
    spawnSync('pdftoppm', ['-r', '80', '-png', pdf, path.join(outDir, name)], { stdio: 'inherit' });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) await main();
