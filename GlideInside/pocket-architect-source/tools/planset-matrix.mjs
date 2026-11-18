// Sample generator for the plan sets across building types and terrain cases, for a visual check.
//   node tools/planset-matrix.mjs <outDir> [--types warehouse,service-station,...] [--terrain flat,mid,steep,none] [--no-res] [--no-eng] [--png] [--dpi 70]
// Writes <outDir>/com-<type>-<terrain>.pdf (lot viewer commercial set), res-<terrain>.pdf (lot viewer residential set) and
// eng-<terrain>.pdf (engineering style residential set). With --png every page is rasterised with pdftoppm into <outDir>/png/.
// Generic designs only: no builder houses, no brand names. The terrain cases are in tests/helpers/planset-fixtures.mjs.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { exportPlanSet } from '../src/premium/exporters/planset/index.js';
import { toEngineeringPDF } from '../src/premium/exporters/eng/index.js';
import { catalogue } from '../src/catalogue/index.js';
import { commercialCase, residentialCase, TERRAIN_CASES } from '../tests/helpers/planset-fixtures.mjs';

const require = createRequire(import.meta.url);
const { jsPDF } = require('jspdf');
const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? args[0] : '/tmp/planset-matrix';
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i < 0 ? dflt : args[i + 1]; };
const flag = (name) => args.includes(`--${name}`);
export const ALL_TYPES = ['warehouse', 'warehouse-showroom', 'service-station', 'office', 'retail-strip', 'community-centre', 'strata', 'self-storage', 'mixed-use', 'drive-through', 'townhouse-row', 'canopy'];
const types = opt('types', 'warehouse,service-station,mixed-use,strata').split(',').filter(Boolean);
const terrains = opt('terrain', 'flat,mid,steep,none').split(',').filter((t) => t in TERRAIN_CASES);
const dpi = opt('dpi', '70');
const date = new Date(2026, 10, 18);
mkdirSync(`${out}/png`, { recursive: true });

const save = async (name, bytes) => {
  const file = `${out}/${name}.pdf`;
  writeFileSync(file, Buffer.from(bytes));
  if (flag('png')) execFileSync('pdftoppm', ['-r', dpi, '-png', file, `${out}/png/${name}`]);
};

for (const terrain of terrains) {
  for (const type of types) {
    try {
      const r = await exportPlanSet({ project: commercialCase(type, terrain), kind: 'commercial', download: false, jsPDF, fetchSite: null, date });
      await save(`com-${type}-${terrain}`, new Uint8Array(await r.blob.arrayBuffer()));
      console.log(`com ${type} ${terrain}:`, r.sheets.map((s) => `${s.no.split('-').pop()} ${s.scale}`).join(' | '));
    } catch (e) { console.log(`com ${type} ${terrain}: FAILED`, e.message.slice(0, 200)); }
  }
  if (!flag('no-res')) {
    try {
      const r = await exportPlanSet({ project: residentialCase(terrain), kind: 'site', download: false, jsPDF, fetchSite: null, catalogue, date });
      await save(`res-${terrain}`, new Uint8Array(await r.blob.arrayBuffer()));
      console.log(`res ${terrain}:`, r.sheets.map((s) => `${s.no.split('-').pop()} ${s.scale}`).join(' | '));
    } catch (e) { console.log(`res ${terrain}: FAILED`, e.message.slice(0, 200)); }
  }
  if (!flag('no-eng')) {
    try {
      const bytes = await toEngineeringPDF(residentialCase(terrain), { jsPDF, catalogue, date });
      await save(`eng-${terrain}`, bytes);
      console.log(`eng ${terrain}:`, bytes.layout.sheets.map((s) => `${s.number.split('-').pop()} ${s.scale}`).join(' | '));
    } catch (e) { console.log(`eng ${terrain}: FAILED`, e.message.slice(0, 200)); }
  }
}
