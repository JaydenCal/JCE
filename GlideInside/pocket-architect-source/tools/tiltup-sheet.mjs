// Writes the C104 elevations sheet of a tilt-up strata project to a PDF (node tools/tiltup-sheet.mjs out.pdf), for a look at the drawing.
import fs from 'node:fs';
import { jsPDF } from 'jspdf';
import { createStore } from '../src/model/store.js';
import { setRowsUnit } from '../src/commercial/catalogue/ops.js';
import { commercialProject } from '../tests/helpers/commercial-fixture.mjs';
import { exportPlanSet } from '../src/premium/exporters/planset/index.js';
const out = process.argv[2] || 'c104.pdf';
const store = createStore(commercialProject({ plain: false }), { autosaveKey: null });
setRowsUnit(store, { construction: 'tilt_up', panelFinish: 'painted', panelReveals: 'one', accentPanels: 'corners', signageBand: true });
const p = store.project;
const r = await exportPlanSet({ project: p, kind: 'commercial', download: false, jsPDF, fetchSite: null, date: new Date(2026, 10, 15) });
fs.writeFileSync(out, Buffer.from(await r.blob.arrayBuffer()));
console.log('wrote', out, r.pages);
