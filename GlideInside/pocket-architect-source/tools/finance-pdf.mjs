// Writes the plan set PDFs with the feasibility page (commercial C105, residential F100) and renders that page to PNG.
//   node tools/finance-pdf.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { jsPDF } from 'jspdf';
import { exportPlanSet } from '../src/premium/exporters/planset/index.js';
import { commercialProject } from '../tests/helpers/commercial-fixture.mjs';
import { largeLot, storeWith } from '../tests/helpers/fit-lots.mjs';
import { createStore } from '../src/model/store.js';
import { saveScenario, setValue, compute } from '../src/finance/model.js';

const OUT = path.resolve(process.argv[2] || '/home/claude/growth/fin-shots');
fs.mkdirSync(OUT, { recursive: true });
const c = createStore(commercialProject({ plain: false }), { autosave: false });
c.apply('s', (q) => saveScenario(q, 'Sell'));
c.apply('h', (q) => { setValue(q, compute(q).model.descs.find((d) => d.key === 'mode'), 'hold'); });
c.apply('s2', (q) => saveScenario(q, 'Hold'));
c.apply('h2', (q) => { setValue(q, compute(q).model.descs.find((d) => d.key === 'mode'), 'sell'); });
const r = storeWith(largeLot());
r.apply('s', (q) => saveScenario(q, 'Standard'));
const jobs = [['commercial', { project: c.project, kind: 'commercial' }, 'C105'], ['residential', { project: r.project, kind: 'house', feasibility: true }, 'F100']];
for (const [name, o, code] of jobs) {
  const out = await exportPlanSet({ ...o, download: false, jsPDF, fetchSite: null, date: new Date(2026, 10, 18) });
  const file = path.join(OUT, `fin-${name}-planset.pdf`);
  fs.writeFileSync(file, Buffer.from(await out.blob.arrayBuffer()));
  const page = out.sheets.findIndex((s) => s.no.endsWith(code)) + 1;
  execFileSync('pdftoppm', ['-f', String(page), '-l', String(page), '-r', '110', '-png', file, path.join(OUT, `fin-${name}-pdf-page`)]);
  console.log(name, 'pages', out.pages, 'feasibility page', page);
}
