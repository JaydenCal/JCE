// Agricultural and machinery dealership: a display yard in front, a glazed showroom, a parts counter and offices behind it, and a tall
// service workshop beside them. The two blocks share the wall at x = cw; their depths differ, so the outline is a six point polygon.
// Display yard vehicles are simple massing. Local plan mm, front edge along y = 0, depth into +y.

import { Plan, num, bool, makeType, mm, rectPoly, polyArea } from './_kitB.js';

export const PARAMS = [
  num('showroomM2', 'Showroom', 'm2', 100, 600, 10, 240),
  num('showroomDepthM', 'Showroom depth', 'm', 10, 20, 0.5, 14),
  num('glazingPct', 'Showroom front glazing', '%', 30, 90, 5, 70),
  num('partsCounterM2', 'Parts counter and store', 'm2', 30, 150, 5, 60),
  num('officesM2', 'Offices', 'm2', 30, 200, 5, 80),
  num('workshopBays', 'Service workshop bays', 'no.', 2, 10, 1, 4),
  num('workshopBayWidthM', 'Workshop bay width', 'm', 6, 9, 0.5, 7),
  num('workshopDepthM', 'Workshop depth', 'm', 15, 30, 1, 18),
  num('doorWidthM', 'Workshop door width', 'm', 4.5, 6, 0.5, 5.5),
  num('doorHeightM', 'Workshop door height', 'm', 4.5, 6, 0.5, 5),
  num('eaveHeightM', 'Workshop eave height', 'm', 5.5, 9, 0.5, 6.5),
  num('displayYardM2', 'Display yard', 'm2', 500, 5000, 100, 2000),
  num('yardVehicles', 'Display vehicles shown', 'no.', 0, 16, 1, 6),
  bool('showVehicles', 'Show display vehicles in 3D', true),
];

function build(p) {
  const pl = new Plan();
  const sd = mm(p.showroomDepthM);
  const cw = Math.max(mm(8), Math.round((p.showroomM2 * 1e6) / sd / 100) * 100);
  const rest = Math.max(mm(3), Math.round(((p.partsCounterM2 + p.officesM2) * 1e6) / cw / 100) * 100);
  const Dl = sd + rest;
  const bwb = mm(p.workshopBayWidthM);
  const Dw = mm(p.workshopDepthM);
  const ww = p.workshopBays * bwb;
  const W = cw + ww;
  const eave = mm(p.eaveHeightM);
  const lowEave = mm(4.2);
  pl.levels[0].heightMm = eave;
  pl.outline = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: Dw }, { x: cw, y: Dw }, { x: cw, y: Dl }, { x: 0, y: Dl }];
  const m = Math.min(Dl, Dw);
  // Exterior walls: left block front, left, back; workshop front, right, back; the shared edge x = cw.
  const sf = pl.wall({ x: 0, y: 0 }, { x: cw, y: 0 }, { out: { x: 0, y: -1 }, height: lowEave });
  const wf = pl.wall({ x: cw, y: 0 }, { x: W, y: 0 }, { out: { x: 0, y: -1 }, height: eave });
  pl.wall({ x: W, y: 0 }, { x: W, y: Dw }, { out: { x: 1, y: 0 }, height: eave });
  const wb = pl.wall({ x: W, y: Dw }, { x: cw, y: Dw }, { out: { x: 0, y: 1 }, height: eave });
  const lb = pl.wall({ x: cw, y: Dl }, { x: 0, y: Dl }, { out: { x: 0, y: 1 }, height: lowEave });
  const ll = pl.wall({ x: 0, y: Dl }, { x: 0, y: 0 }, { out: { x: -1, y: 0 }, height: lowEave });
  // The shared wall: interior over [0, m], exterior over the part that sticks out.
  const shared = pl.wall({ x: cw, y: 0 }, { x: cw, y: m }, { kind: 'interior', thickness: 200, height: eave });
  if (Dl > Dw) pl.wall({ x: cw, y: Dl }, { x: cw, y: Dw }, { out: { x: 1, y: 0 }, height: lowEave });
  else if (Dw > Dl) pl.wall({ x: cw, y: Dl }, { x: cw, y: Dw }, { out: { x: -1, y: 0 }, height: eave });
  // Showroom to back block wall, parts to offices wall.
  const split = pl.wall({ x: 0, y: sd }, { x: cw, y: sd }, { kind: 'interior', thickness: 100, height: lowEave });
  const pw = Math.round(((p.partsCounterM2 * 1e6) / rest) / 100) * 100;
  const pOff = pl.wall({ x: pw, y: sd }, { x: pw, y: Dl }, { kind: 'interior', thickness: 100, height: lowEave });

  // Rooms.
  pl.room('PROPOSED SHOWROOM', 'other', rectPoly(0, 0, cw, sd), { use: 'showroom' });
  pl.room('PROPOSED PARTS COUNTER AND STORE', 'store', rectPoly(0, sd, pw, Dl), { use: 'parts' });
  pl.room('PROPOSED OFFICES', 'other', rectPoly(pw, sd, cw, Dl), { use: 'office' });
  pl.room('PROPOSED SERVICE WORKSHOP', 'workshop', rectPoly(cw, 0, W, Dw), { use: 'workshop' });

  // Openings. Showroom glazing in 3 m slots with the entry in the middle slot.
  const slots = Math.max(1, Math.floor(cw / 3000));
  const slotW = cw / slots;
  const midSlot = Math.floor(slots / 2);
  const winW = Math.max(900, Math.round(slotW * 0.9 * (p.glazingPct / 100)));
  for (let i = 0; i < slots; i++) {
    const cx = slotW * (i + 0.5);
    if (i === midSlot) pl.openAt(sf, cx, 0, 'door', 1800, 2100, 0);
    else pl.openAt(sf, cx, 0, 'window', winW, 2700, 300, { style: 'fixed' });
  }
  pl.openAt(lb, 600 + 450, Dl, 'door', 920, 2040, 0);
  pl.openAt(ll, 0, sd + rest / 2, 'window', 1500, 1200, 900, { style: 'fixed' });
  pl.openAt(split, pw / 2, sd, 'door', 920, 2040, 0);
  pl.openAt(split, cw - 1500, sd, 'door', 920, 2040, 0);
  pl.openAt(shared, cw, Math.min(sd / 2, m / 2), 'door', 1800, 2100, 0);
  const dw = Math.min(mm(p.doorWidthM), bwb - 600);
  const dh = Math.min(mm(p.doorHeightM), eave - 400);
  for (let i = 0; i < p.workshopBays; i++) {
    const cx = cw + bwb * i + bwb / 2;
    pl.openAt(wf, cx, 0, 'roller_door', dw, dh, 0, { tag: 'bay' });
    if (i % 2 === 0) pl.openAt(wb, cx, Dw, 'roller_door', dw, dh, 0, { tag: 'bay' });
  }
  pl.openAt(wb, W - 1500, Dw, 'door', 920, 2040, 0);
  pl.roof(rectPoly(0, 0, cw, Dl), 'skillion', 3);
  pl.roof(rectPoly(cw, 0, W, Dw), 'gable', 5);

  // Display yard in front.
  const yd = Math.max(mm(6), Math.round((p.displayYardM2 * 1e6) / W / 100) * 100);
  pl.extra('display-yard', rectPoly(0, -yd, W, 0));
  pl.sym({ t: 'poly', pts: rectPoly(0, -yd, W, 0), closed: true, stroke: '#777', w: 40, dash: [400, 300] });
  pl.sym({ t: 'text', x: W / 2, y: -yd / 2, text: 'DISPLAY YARD', size: 800 });
  // Display vehicles as massing: tractors and larger harvesters/sprayers alternate in two rows.
  const cols = Math.max(1, Math.floor(W / 6500));
  for (let i = 0; i < p.yardVehicles; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const cx = 3250 + col * 6500 + (row % 2) * 1000;
    const cy = -3500 - row * 7000;
    if (cy - 3500 < -yd) break;
    const big = i % 3 === 2;
    if (p.showVehicles) {
      if (big) {
        pl.box('machine', cx - 1600, cy - 3200, cx + 1600, cy + 3200, 500, 3000, 'vehicle', '#2e7d32');
        pl.box('machineCab', cx - 1000, cy + 600, cx + 1000, cy + 2800, 3000, 4100, 'glass', '#8fb8cc');
      } else {
        pl.box('tractor', cx - 1100, cy - 1500, cx + 1100, cy + 1500, 500, 1800, 'vehicle', '#c62828');
        pl.box('tractorCab', cx - 900, cy + 100, cx + 900, cy + 1500, 1800, 3000, 'glass', '#8fb8cc');
      }
    }
    pl.sym({ t: 'poly', pts: big ? rectPoly(cx - 1600, cy - 3200, cx + 1600, cy + 3200) : rectPoly(cx - 1100, cy - 1500, cx + 1100, cy + 1500), closed: true, stroke: '#444', w: 40 });
  }
  pl.box('sign', 600, 0, cw - 600, 150, lowEave - 1200, lowEave - 300, 'sign', '#d9d9d9');
  pl.sym({ t: 'text', x: W / 2, y: Math.max(Dl, Dw) + 900, text: 'PROPOSED MACHINERY DEALERSHIP', size: 700 });
  pl._yardM2 = polyArea(rectPoly(0, -yd, W, 0)) / 1e6;
  return pl;
}

export default makeType(
  {
    id: 'machinery-dealership', label: 'Machinery and agricultural dealership', category: 'automotive', zonesHint: ['E1', 'E3', 'E4', 'IN1', 'B5', 'B6', 'RU5'], planLabel: 'PROPOSED MACHINERY DEALERSHIP',
    costHints: { buildRateKey: 'dealership', notes: 'Showroom glazing and the tall workshop doors lift the rate over a plain shed' },
    extraQuantities: (p, pl) => ({ displayYardM2: Math.round(pl._yardM2) }),
  },
  PARAMS,
  build,
  (p, pl) => ({
    parking: { ratePerM2: [{ use: 'showroom', per: 1, m2: 40, status: 'ESTIMATE' }, { use: 'service workshop', per: 1, m2: 100, status: 'ESTIMATE' }, { use: 'offices', per: 1, m2: 40, status: 'ESTIMATE' }], accessible: true },
    vehicles: { design: 'HRV', apronDepthMm: 18000, docks: 0 },
    landscapeFrontMm: 3000,
    notes: ['Display yard is not counted as customer parking, check with council', 'Tall workshop doors suit large implements, confirm the largest machine height', `Display yard ${Math.round(pl._yardM2)} m2`],
  }),
);
