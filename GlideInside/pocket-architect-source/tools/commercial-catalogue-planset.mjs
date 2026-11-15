// Writes the commercial plan set for a warehouse and a showroom on a sample lot to a PDF (real jsPDF), for a visual check of C101 and C103.
//   node tools/commercial-catalogue-planset.mjs [out.pdf]
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createStore } from '../src/model/store.js';
import { commercialProject } from '../tests/helpers/commercial-fixture.mjs';
import { chooseBuilding } from '../src/commercial/catalogue/fit.js';
import { applyBuildingChoice, addBuilding, setBuildingParam } from '../src/commercial/catalogue/ops.js';
import { exportPlanSet } from '../src/premium/exporters/planset/index.js';

const require = createRequire(import.meta.url);
const { jsPDF } = require('jspdf');
const out = process.argv[2] || '/home/claude/catalogue-shots/planset.pdf';
const s = createStore(commercialProject({ plain: false, width: 120000, depth: 130000 }), { autosaveKey: null });
applyBuildingChoice(s, chooseBuilding(s.project, 'warehouse'));
setBuildingParam(s, s.project.commercial.buildings[0].id, 'docks', 4);
addBuilding(s, 'showroom');
const r = await exportPlanSet({ project: s.project, kind: 'commercial', download: false, jsPDF, fetchSite: null, date: new Date(2026, 10, 15) });
writeFileSync(out, Buffer.from(await r.blob.arrayBuffer()));
console.log('wrote', out, r.pages, 'pages');
