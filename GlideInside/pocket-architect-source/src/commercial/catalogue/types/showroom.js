// Bulky goods showroom: a glazed frontage with an awning and an automatic entry, the showroom floor, offices and amenities behind it, and a
// warehouse at the rear with roller doors. Customer parking at the frontage. Local frame: front edge on y = 0, body in y >= 0 (showroom first,
// then the back of house band, then the warehouse), the street toward -y. Built with the Plan kit (see _kitB.js).

import { Plan, num, sel, makeType, rectPoly, emit3d, resolve as resolveP } from './_kitB.js';

const defs = [
  num('widthMm', 'Frontage width', 'mm', 18000, 80000, 500, 36000),
  num('showroomDepthMm', 'Showroom floor depth', 'mm', 12000, 60000, 500, 24000),
  num('backBandDepthMm', 'Offices and amenities depth', 'mm', 4000, 10000, 500, 6000),
  num('officeWidthMm', 'Offices and amenities width', 'mm', 8000, 30000, 500, 14000),
  num('warehouseDepthMm', 'Rear warehouse depth', 'mm', 6000, 40000, 500, 12000),
  num('eaveHeightMm', 'Eave height', 'mm', 4500, 10000, 250, 6500),
  num('awningDepthMm', 'Awning depth over the footpath', 'mm', 0, 5000, 250, 3000),
  num('glazingPct', 'Glazed share of the frontage', '%', 30, 100, 5, 70),
  num('rearDoors', 'Roller doors at the rear', '', 0, 3, 1, 1),
  sel('roofType', 'Roof', [{ value: 'skillion', label: 'Skillion, falls to the rear' }, { value: 'gable', label: 'Gable, falls to each side' }, { value: 'flat', label: 'Flat with parapet' }], 'skillion'),
  num('roofPitchDeg', 'Roof pitch', 'deg', 2, 15, 1, 3),
];

const AWNING_Z = 3800;
const REAR_W = 4000;
const REAR_H = 4500;
const AISLE = 6000;

export const SHOWROOM_PRESETS = [
  { id: 'small', label: 'Small, 24 x 36 m', params: { widthMm: 24000, showroomDepthMm: 18000, warehouseDepthMm: 10000, officeWidthMm: 10000 } },
  { id: 'medium', label: 'Medium, 36 x 42 m', params: {} },
  { id: 'large', label: 'Large, 50 x 56 m', params: { widthMm: 50000, showroomDepthMm: 34000, warehouseDepthMm: 16000, officeWidthMm: 18000, rearDoors: 2 } },
];

function build(p) {
  const pl = new Plan();
  const W = p.widthMm;
  const S = p.showroomDepthMm;
  const B = p.backBandDepthMm;
  const D = S + B + p.warehouseDepthMm;
  const H = p.eaveHeightMm;
  const OW = Math.min(p.officeWidthMm, W - 3000);
  pl.levels[0].heightMm = H;
  const sides = pl.rect(0, 0, W, D, { height: H });
  const issues = [];
  // Interior walls: showroom to back of house, back of house to warehouse, office, amenities and store.
  pl.wall({ x: 0, y: S }, { x: W, y: S }, { kind: 'interior', thickness: 150, height: H });
  pl.wall({ x: 0, y: S + B }, { x: W, y: S + B }, { kind: 'interior', thickness: 150, height: H });
  const wOff = pl.wall({ x: OW * 0.6, y: S }, { x: OW * 0.6, y: S + B }, { kind: 'interior', thickness: 100, height: H });
  const wAm = pl.wall({ x: OW, y: S }, { x: OW, y: S + B }, { kind: 'interior', thickness: 100, height: H });
  const wShow = pl.walls[pl.walls.length - 4];
  const wWare = pl.walls[pl.walls.length - 3];
  // Rooms
  pl.room('PROPOSED SHOWROOM', 'other', rectPoly(0, 0, W, S), { use: 'showroom' }).ceilingMm = H;
  pl.room('PROPOSED OFFICE', 'other', rectPoly(0, S, OW * 0.6, S + B), { use: 'office' }).ceilingMm = 3000;
  pl.room('PROPOSED AMENITIES', 'other', rectPoly(OW * 0.6, S, OW, S + B), { use: 'amenities' }).ceilingMm = 3000;
  pl.room('PROPOSED STORE', 'store', rectPoly(OW, S, W, S + B), { use: 'warehouse' }).ceilingMm = H;
  pl.room('PROPOSED WAREHOUSE', 'workshop', rectPoly(0, S + B, W, D), { use: 'warehouse' }).ceilingMm = H;
  pl.outline = rectPoly(0, 0, W, D);
  // Glazed frontage: panels either side of the entry, with piers between them.
  const front = sides.front;
  const entryW = 2400;
  const glazed = (W * p.glazingPct) / 100;
  const g0 = (W - glazed) / 2;
  const g1 = g0 + glazed;
  const gh = Math.min(3600, H - 1200);
  const run = (a, b) => {
    const len = b - a;
    if (len < 1500) return 0;
    const k = Math.max(1, Math.ceil(len / 3300));
    const w = (len - (k - 1) * 200) / k;
    for (let i = 0; i < k; i++) pl.openAt(front, a + i * (w + 200) + w / 2, 0, 'window', w, gh, 150, { style: 'fixed' });
    return k;
  };
  const left = run(g0, W / 2 - entryW / 2 - 200);
  const right = run(W / 2 + entryW / 2 + 200, g1);
  pl.openAt(front, W / 2, 0, 'sliding_door', entryW, 2400, 0);
  if (p.glazingPct < 40) issues.push({ id: 'glazing', kind: 'info', text: 'A low glazed share reads as a warehouse from the street, raise it for a showroom frontage' });
  // Doors between the bands and the rear roller doors.
  pl.openAt(wShow, W - 2500, S, 'door', 1800, 2100, 0, { style: 'double' });
  pl.openAt(wWare, W / 2, S + B, 'roller_door', 3600, 4000, 0);
  pl.openAt(wWare, OW / 2, S + B, 'door', 1000, 2100, 0);
  for (let j = 0; j < p.rearDoors; j++) pl.openAt(sides.back, W - 3000 - j * 5500, D, 'roller_door', REAR_W, REAR_H, 0, { motorised: true });
  // Roof
  pl.roofs.push({ polygon: rectPoly(0, 0, W, D), type: p.roofType, pitchDeg: p.roofType === 'flat' ? 2 : p.roofPitchDeg, level: 'Ground', baseMm: H, overhangMm: 300, ridge: 'y', fall: 'rear' });
  // Extras: awning over the frontage, delivery apron at the rear.
  if (p.awningDepthMm > 0) pl.extras.push({ kind: 'canopy', polygon: rectPoly(0, -p.awningDepthMm, W, 0), label: 'AWNING', heightMm: AWNING_Z, posts: false, thicknessMm: 200 });
  if (p.rearDoors > 0) pl.extras.push({ kind: 'apron', polygon: rectPoly(Math.max(0, W - 14000), D, W, D + 14000), label: 'DELIVERY APRON' });
  pl.zone = { x0: 0, x1: W, offsetMm: Math.max(AISLE, p.awningDepthMm + 2500) };
  // 3D props: a blank sign panel over the entry, entry canopy blade, trolley bay slab.
  pl.box('sign', W / 2 - 3000, -120, W / 2 + 3000, 0, H - 1300, H - 400, 'sign', '#dcdcd6');
  pl.box('steel', W / 2 - 1500, -p.awningDepthMm, W / 2 + 1500, -p.awningDepthMm + 120, AWNING_Z - 500, AWNING_Z, 'steel', '#6b7480');
  pl.sym({ t: 'text', x: W / 2, y: D + 900, text: 'PROPOSED SHOWROOM', size: 800 });
  pl.sym({ t: 'text', x: W / 2, y: -p.awningDepthMm - 1200, text: 'ENTRY', size: 700, fill: '#444' });
  pl.sym({ pts: [{ x: W / 2 - 1200, y: -1500 }, { x: W / 2 + 1200, y: -1500 }, { x: W / 2 + 1200, y: 0 }, { x: W / 2 - 1200, y: 0 }], closed: true, stroke: '#c33', w: 50 });
  pl.meta = { issues, panels: left + right };
  return pl;
}

function siteFn(p, plan) {
  const u = plan.uses;
  const r1 = (v) => Math.round((v || 0) * 10) / 10;
  return {
    parking: { ratePerM2: [{ use: 'showroom', per: 50, m2: r1(u.showroom), status: 'ESTIMATE' }, { use: 'warehouse', per: 300, m2: r1(u.warehouse), status: 'ESTIMATE' }, { use: 'office', per: 40, m2: r1(u.office), status: 'ESTIMATE' }], accessible: true, zone: plan.zone },
    vehicles: { design: 'MRV', apronDepthMm: 14000, docks: 0 },
    landscapeFrontMm: 3000,
    notes: ['Parking rates are indicative: 1 per 50 m2 of showroom floor, 1 per 300 m2 of warehouse floor and 1 per 40 m2 of office floor, check with council.', 'Customer parking is at the frontage, deliveries use the rear apron.'],
  };
}

const base = makeType({
  id: 'showroom', label: 'Bulky goods showroom', category: 'retail', zonesHint: ['E3', 'E4', 'B5', 'B6', 'IN2'], planLabel: 'PROPOSED SHOWROOM',
  costHints: { buildRateKey: 'showroom', notes: 'Showroom shell with glazed frontage and awning, offices and a rear warehouse. ESTIMATE, check with a quantity surveyor.' },
}, defs, build, siteFn);

const R = (params) => resolveP(params, defs);
export default {
  ...base,
  presets: SHOWROOM_PRESETS,
  footprint(params) {
    const pl = build(R(params));
    return { outline: pl.outline.map((q) => ({ ...q })), extras: pl.extras.map((e) => ({ ...e, polygon: e.polygon.map((q) => ({ ...q })) })) };
  },
  checks(params) { return build(R(params)).meta.issues; },
  view3d(params, ctx = {}) { return emit3d(build(R(params)), ctx); },
};
