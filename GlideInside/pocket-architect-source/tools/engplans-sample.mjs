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

async function syntheticAerial(fixture) {
  let canvasLib;
  try { canvasLib = await import('@napi-rs/canvas'); } catch { return null; }
  const { createCanvas } = canvasLib;
  globalThis.OffscreenCanvas = class {
    constructor(w, h) { this.c = createCanvas(w, h); }
    getContext(t) { return this.c.getContext(t); }
    async convertToBlob() { return new Blob([this.c.toBuffer('image/jpeg', 80)], { type: 'image/jpeg' }); }
  };
  const { mockAerialBlob } = await import('../src/site/mock-aerial.js');
  const m = 200; // wider than the fixture picture so the locality map has ground to show
  const b = fixture.aerial.bbox;
  const bbox = { minE: b.minE - m, minN: b.minN - m, maxE: b.maxE + m, maxN: b.maxN + m };
  const widthPx = 1800;
  const heightPx = Math.round((widthPx * (bbox.maxN - bbox.minN)) / (bbox.maxE - bbox.minE));
  const meta = { ...fixture.aerial, bbox, widthPx, heightPx, mmPerPx: ((bbox.maxE - bbox.minE) * 1000) / widthPx };
  const blob = await mockAerialBlob(meta, fixture.lot);
  const buf = Buffer.from(await blob.arrayBuffer());
  return { meta, url: `data:image/jpeg;base64,${buf.toString('base64')}` };
}

export async function sampleProject({ withAerial = true } = {}) {
  const f = FIXTURES[0];
  const aer = withAerial ? await syntheticAerial(f) : null;
  const lot = buildSiteLot({ lot: f.lot, aerialMeta: aer?.meta || f.aerial, aerialKey: aer ? 'sample-aerial' : null, contours: f.contours, address: f.search[0].label, source: 'sample' });
  const r = siteLotSetbacks(lot, rules, { storeys: 2, wallHeightM: 5.4, buildingHeightM: 8 });
  lot.setbacks = r.setbacks;
  lot.envelope = r.envelope;
  // The fixture coordinates are synthetic; place the search point where Calala really is so the locality map can point to the town centre.
  lot.query = { lon: 150.9296, lat: -31.0446 };
  const p = createProject({ name: 'Sample Residence' });
  p.site.lot = lot;
  Object.assign(p.titleBlock, { client: 'A Sample Client', company: 'Sample Designs Pty Ltd', drawnBy: 'AB', jobNumber: 'TAM24', council: 'Tamworth Regional' });
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
