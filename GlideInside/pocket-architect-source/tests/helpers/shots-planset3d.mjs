// The HVS shed plan set with the 3D renders: node tests/helpers/shots-planset3d.mjs [outDir]. Writes the PDF, the cover and the 3D views sheet as PNG.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { renderPlanSet } from './planset3d-browser.mjs';
import { hvsShedProject, syntheticAerial, BUILDER } from './hvs-shed-fixture.mjs';

const out = process.argv[2] || '/home/claude/shots-7final';
fs.mkdirSync(out, { recursive: true });
const r = await renderPlanSet(hvsShedProject(), { aerial: syntheticAerial(), builder: BUILDER });
const pdf = `${out}/HVS-shed-plan-set-3d.pdf`;
fs.writeFileSync(pdf, r.bytes);
const codes = r.sheets.map((s) => s.no.split('-').pop());
console.log(codes.join(' '), 'pages', r.pages, 'ms', r.ms, r.errs);
const at = (code) => codes.indexOf(code) + 1;
if (at('C000') > 0) execFileSync('pdftoppm', ['-png', '-r', '110', '-f', String(at('C000')), '-l', String(at('C000')), '-singlefile', pdf, `${out}/HVS-cover`]);
if (at('A400') > 0) execFileSync('pdftoppm', ['-png', '-r', '110', '-f', String(at('A400')), '-l', String(at('A400')), '-singlefile', pdf, `${out}/HVS-3d-views-sheet`]);
