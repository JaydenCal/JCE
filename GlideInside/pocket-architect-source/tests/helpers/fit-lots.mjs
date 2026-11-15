// Lots for the house fit tests (tests/fit-advice.test.mjs) and the fit shots (tools/fit-shots.cjs). Plan mm, y down, the street along the top.
//   narrowLot()  a narrow, irregular, sloping lot like the one a tester walked away from: it runs back on a slant and tapers
//   normalLot()  an ordinary 20 x 40 m residential lot
//   largeLot()   a 40 x 80 m lot with room to spare
import { migrate, createProject } from '../../src/model/schema.js';
import { demoLotResponse } from '../../src/site/demo-lot.js';
import { buildSiteLot } from '../../src/site/model.js';
import { envelopeOf } from '../../src/model/placement.js';
import catalogue from '../../src/catalogue/index.js';
import { swapHouse } from '../../src/lotcard/swap.js';
import { createStore } from '../../src/model/store.js';

/** The narrow lot's corners in metres: x east, y south from the left end of the frontage (edge 0 is the street). */
export const NARROW_M = [[0, 0], [16, 0], [27, 20], [30, 46], [18, 52], [10.5, 27]];
export const NARROW_KINDS = ['front', 'side', 'side', 'rear', 'side', 'side'];

/** A terrain grid that falls `fallPerM` metres per metre toward the south east. */
export function slopeTerrain(boundary, fallPerM = 0.14) {
  const xs = boundary.map((p) => p.x); const ys = boundary.map((p) => p.y);
  const cellMm = 2000;
  const x0 = Math.min(...xs) - 6000; const y0 = Math.min(...ys) - 6000;
  const cols = Math.ceil((Math.max(...xs) - x0 + 6000) / cellMm) + 1;
  const rows = Math.ceil((Math.max(...ys) - y0 + 6000) / cellMm) + 1;
  const values = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) values.push(Math.round((120 - fallPerM * ((c * cellMm) / 1000) * 0.6 - fallPerM * ((r * cellMm) / 1000) * 0.8) * 100) / 100);
  return { cols, rows, cellMm, x0, y0, values };
}

function lotProject(boundary, kinds, { setbacks = { front: 4.5, side: 0.9, rear: 3 }, fallPerM = 0, label = 'Lot 1 DP 100' } = {}) {
  const p = migrate(createProject({ name: 'Lot' }));
  p.levels = [];
  const lot = buildSiteLot({ lot: demoLotResponse(), address: '1 Test Street', source: 'nsw' });
  lot.boundary = boundary;
  lot.holes = []; lot.parts = []; lot.neighbours = []; lot.roads = [];
  lot.areaM2 = Math.round(Math.abs(boundary.reduce((t, a, i) => { const b = boundary[(i + 1) % boundary.length]; return t + a.x * b.y - b.x * a.y; }, 0)) / 2e6);
  lot.lotLabel = label;
  lot.demo = false;
  lot.frontEdges = [0];
  lot.cornerLot = false;
  lot.frontageConfirmed = true;
  lot.setbacks = { ...setbacks, edgeKinds: kinds };
  lot.envelope = null;
  lot.envelope = envelopeOf(lot).polygon;
  lot.terrain = fallPerM ? slopeTerrain(boundary, fallPerM) : null;
  lot.contours = [];
  p.site.lot = lot;
  return p;
}

export const narrowLot = (opts = {}) => lotProject(NARROW_M.map(([x, y]) => ({ x: x * 1000, y: y * 1000 })), NARROW_KINDS, { fallPerM: 0.14, label: 'Lot 12 DP 200', ...opts });
const rect = (w, d) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }];
export const normalLot = (opts = {}) => lotProject(rect(20000, 40000), ['front', 'side', 'rear', 'side'], { label: 'Lot 2 DP 200', ...opts });
export const largeLot = (opts = {}) => lotProject(rect(40000, 80000), ['front', 'side', 'rear', 'side'], { label: 'Lot 3 DP 200', ...opts });

/** A store holding `project` with the template `id` placed on it the way the app does (swapHouse: garage to the street, best fit). */
export function storeWith(project, id = 'house_double') {
  const store = createStore(project, { autosave: false });
  const t = catalogue.templates.find((x) => x.id === id);
  swapHouse(store, catalogue.createFromTemplate(id), { id, name: t?.name || id });
  return store;
}
export { catalogue };
