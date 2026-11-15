// Writes the site plan PDFs (residential site plan set, free preview, commercial set) for a visual check of the plan size on the sheet.
//   node tools/siteplan-shots.mjs <outDir> <prefix>
// Then: pdftoppm -r 70 -png -f N -l N file.pdf out
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { exportPlanSet } from '../src/premium/exporters/planset/index.js';
import { createStore } from '../src/model/store.js';
import { commercialProject } from '../tests/helpers/commercial-fixture.mjs';

const require = createRequire(import.meta.url);
const { jsPDF } = require('jspdf');
const dir = process.argv[2] || '/home/claude/topview-shots';
const pre = process.argv[3] || 'pdf';
mkdirSync(dir, { recursive: true });
const houses = JSON.parse(readFileSync(new URL('../../golive/builder-houses/hunter-homes.json', import.meta.url), 'utf8'));
const project = houses[0].project;
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const mk = (w, d, extra = {}) => ({ boundaryM: rect(0, 0, w, d), frontEdge: 0, lotNumber: '12', planLabel: 'DP 1234567', address: '12 Sample Street, Thornton NSW 2322', lga: 'Maitland City Council', setbacks: { front: 6, side: 0.9, rear: 3 }, neighbours: [{ lotNumber: '11', planLabel: 'DP 1234567', ringM: rect(-w, 0, 0, d) }], ...extra });
const date = new Date(2026, 10, 15);
const save = async (name, opts) => {
  const r = await exportPlanSet({ download: false, jsPDF, fetchSite: null, date, ...opts });
  writeFileSync(`${dir}/${pre}-${name}.pdf`, Buffer.from(await r.blob.arrayBuffer()));
  console.log(name, r.sheets.map((s) => `${s.no.split('-').pop()} ${s.scale}`).join(' | '));
};
await save('res-narrow-paid', { project, lot: mk(15, 50), kind: 'site' });
await save('res-wide-paid', { project, lot: mk(36, 60), kind: 'site' });
await save('res-narrow-preview', { project, lot: mk(15, 50), kind: 'site', preview: true });
const s = createStore(commercialProject({ plain: false, width: 120000, depth: 60000 }), { autosaveKey: null });
await save('com-wide-paid', { project: s.project, kind: 'commercial' });
const s2 = createStore(commercialProject({ plain: false, width: 60000, depth: 130000 }), { autosaveKey: null });
await save('com-deep-paid', { project: s2.project, kind: 'commercial' });
await save('com-deep-preview', { project: s2.project, kind: 'commercial', preview: true });
