// Vehicle repair and service centre: a row of work bays across the front (roller door each, some with hoists), a wash bay at one end,
// a customer reception and office column at the other, and a back strip of parts store, staff amenities and workshop support.
// Local plan mm, front edge along y = 0, depth into +y.

import { Plan, num, bool, makeType, mm, rectPoly, M } from './_kitB.js';

export const PARAMS = [
  num('bays', 'Work bays', 'no.', 3, 12, 1, 6),
  num('bayWidthM', 'Bay width', 'm', 3.5, 5.5, 0.1, 4),
  num('bayDepthM', 'Bay depth', 'm', 7, 14, 0.5, 9),
  num('doorWidthM', 'Roller door width', 'm', 3, 4.5, 0.1, 3.4),
  num('doorHeightM', 'Roller door height', 'm', 3, 5, 0.1, 3.6),
  num('hoistBays', 'Bays with a hoist', 'no.', 0, 12, 1, 2),
  bool('washBay', 'Wash bay', true),
  num('washBayWidthM', 'Wash bay width', 'm', 4, 6, 0.1, 4.5),
  num('partsStoreM2', 'Parts store', 'm2', 10, 80, 2, 28),
  num('receptionM2', 'Customer reception', 'm2', 20, 80, 2, 36),
  num('officeM2', 'Office', 'm2', 8, 60, 2, 16),
  num('amenitiesM2', 'Staff amenities', 'm2', 10, 40, 1, 18),
  num('eaveHeightM', 'Eave height', 'm', 4, 8, 0.1, 5),
];

const BACK_MM = 4500;

function build(p) {
  const pl = new Plan();
  const bw = mm(p.bayWidthM);
  const bd = mm(p.bayDepthM);
  const D = bd + BACK_MM;
  const eave = mm(p.eaveHeightM);
  const ww = p.washBay ? mm(p.washBayWidthM) : 0;
  const hoists = Math.min(p.hoistBays, p.bays);
  const colArea = (p.receptionM2 + p.officeM2) * 1e6;
  const rw = Math.max(mm(4), Math.round(colArea / D / 100) * 100);
  const W = rw + p.bays * bw + ww;
  const xw1 = rw + p.bays * bw; // end of the bays
  pl.levels[0].heightMm = eave;
  pl.outline = rectPoly(0, 0, W, D);
  const ext = pl.rect(0, 0, W, D, { height: eave });
  const dw = Math.min(mm(p.doorWidthM), bw - 400);

  // Interior walls: reception/office column, wash bay, workshop to back strip.
  pl.wall({ x: rw, y: 0 }, { x: rw, y: D }, { kind: 'interior', thickness: 150, height: eave });
  if (ww) pl.wall({ x: xw1, y: 0 }, { x: xw1, y: D }, { kind: 'interior', thickness: 200, height: eave });
  const sep = pl.wall({ x: rw, y: bd }, { x: xw1, y: bd }, { kind: 'interior', thickness: 150, height: eave });
  const rd = Math.round((p.receptionM2 * 1e6) / rw / 100) * 100;
  const colWall = pl.wall({ x: 0, y: rd }, { x: rw, y: rd }, { kind: 'interior', thickness: 100, height: eave });
  // Back strip: parts store, amenities, support.
  const availW = xw1 - rw;
  let ps = (p.partsStoreM2 * 1e6) / BACK_MM;
  let am = (p.amenitiesM2 * 1e6) / BACK_MM;
  if (ps + am > availW * 0.9) { const f = (availW * 0.9) / (ps + am); ps *= f; am *= f; }
  ps = Math.round(ps / 100) * 100;
  am = Math.round(am / 100) * 100;
  const xp = rw + ps;
  const xa = xp + am;
  pl.wall({ x: xp, y: bd }, { x: xp, y: D }, { kind: 'interior', thickness: 100, height: eave });
  pl.wall({ x: xa, y: bd }, { x: xa, y: D }, { kind: 'interior', thickness: 100, height: eave });

  // Rooms.
  pl.room('PROPOSED RECEPTION', 'entry', rectPoly(0, 0, rw, rd), { use: 'reception' });
  pl.room('PROPOSED OFFICE', 'other', rectPoly(0, rd, rw, D), { use: 'office' });
  pl.room('PROPOSED WORKSHOP', 'workshop', rectPoly(rw, 0, xw1, bd), { use: 'workshop' });
  pl.room('PROPOSED PARTS STORE', 'store', rectPoly(rw, bd, xp, D), { use: 'parts' });
  pl.room('PROPOSED STAFF AMENITIES', 'other', rectPoly(xp, bd, xa, D), { use: 'amenities' });
  if (xw1 - xa > 0) pl.room('PROPOSED WORKSHOP SUPPORT', 'workshop', rectPoly(xa, bd, xw1, D), { use: 'workshop' });
  if (ww) pl.room('PROPOSED WASH BAY', 'workshop', rectPoly(xw1, 0, W, D), { use: 'wash' });

  // Openings.
  for (let i = 0; i < p.bays; i++) {
    const cx = rw + bw * i + bw / 2;
    pl.openAt(ext.front, cx, 0, 'roller_door', dw, mm(p.doorHeightM), 0, { tag: 'bay' });
  }
  if (ww) pl.openAt(ext.front, xw1 + ww / 2, 0, 'roller_door', Math.min(mm(p.doorWidthM), ww - 400), mm(p.doorHeightM), 0, { tag: 'wash' });
  pl.openAt(ext.front, 1300, 0, 'door', 1800, 2100, 0);
  const winW = rw - 2300 - 600;
  if (winW >= 900) pl.openAt(ext.front, 2300 + 300 + winW / 2, 0, 'window', winW, 2400, 300, { style: 'fixed' });
  pl.openAt(pl.walls.find((w) => w === ext.left), 0, rd + (D - rd) / 2, 'window', 1500, 1200, 900, { style: 'fixed' });
  pl.openAt(ext.back, xp + am / 2, D, 'door', 920, 2040, 0);
  pl.openAt(ext.back, rw + ps / 2, D, 'roller_door', Math.min(2400, ps - 300), 2400, 0, { tag: 'parts' });
  pl.openAt(sep, rw + ps / 2, bd, 'door', 920, 2040, 0);
  pl.openAt(colWall, rw / 2, rd, 'door', 920, 2040, 0);
  pl.openAt(sep, xa + 600, bd, 'door', 920, 2040, 0);

  pl.roof(rectPoly(0, 0, W, D), 'skillion', 3);

  // Extras: customer forecourt and the apron in front of the doors.
  pl.extra('forecourt', rectPoly(0, -6000, W, 0));
  pl.extra('apron', rectPoly(0, -12000, W, -6000));
  // 3D: hoists (two post), wash bay pit and bund, signage blank.
  for (let i = 0; i < hoists; i++) {
    const cx = rw + bw * i + bw / 2;
    const yc = bd * 0.45;
    for (const s of [-1, 1]) pl.box('hoistPost', cx + s * 1250 - 175, yc - 175, cx + s * 1250 + 175, yc + 175, 0, 3700, 'steel', '#c9a227');
    pl.box('hoistBeam', cx - 1425, yc - 120, cx + 1425, yc + 120, 3600, 3760, 'steel', '#c9a227');
    for (const s of [-1, 1]) pl.box('hoistArm', cx + s * 1250 - 80, yc - 1100, cx + s * 1250 + 80, yc + 1100, 250, 380, 'steel', '#9a7d1b');
    pl.sym({ t: 'poly', pts: rectPoly(cx - 1425, yc - 200, cx + 1425, yc + 200), closed: true, stroke: '#444', w: 40 });
    pl.sym({ t: 'text', x: cx, y: yc + 700, text: 'HOIST', size: 300 });
  }
  for (let i = 0; i < p.bays; i++) {
    const cx = rw + bw * i + bw / 2;
    pl.sym({ t: 'poly', pts: rectPoly(cx - 1000, 1500, cx + 1000, bd - 800), closed: true, stroke: '#999', w: 30, dash: [250, 200] });
  }
  if (ww) {
    const cx = xw1 + ww / 2;
    pl.box('washPit', cx - ww / 2 + 500, 1500, cx + ww / 2 - 500, 6500, 0, 40, 'pit', '#2b2f33'); // drainage grate trough
    pl.box('washBund', xw1 + 200, 600, W - 200, 750, 0, 120, 'concrete', '#a9a69d'); // bund across the door line
    pl.box('washBund', xw1 + 200, 600, xw1 + 320, D - 600, 0, 120, 'concrete', '#a9a69d');
    pl.box('washBund', W - 320, 600, W - 200, D - 600, 0, 120, 'concrete', '#a9a69d');
    pl.box('washBund', xw1 + 200, D - 750, W - 200, D - 600, 0, 120, 'concrete', '#a9a69d');
    pl.box('washLance', cx - 150, D - 1500, cx + 150, D - 1200, 0, 2000, 'steel', '#4d5a66');
    pl.sym({ t: 'poly', pts: rectPoly(xw1 + 200, 600, W - 200, D - 600), closed: true, stroke: '#2a6f97', w: 40, dash: [300, 200] });
    pl.sym({ t: 'text', x: cx, y: D / 2, text: 'WASH BAY', size: 400 });
  }
  pl.box('sign', 600, 0, rw - 300, 120, eave - 1300, eave - 500, 'sign', '#d9d9d9');
  pl.sym({ t: 'text', x: W / 2, y: D + 900, text: 'PROPOSED VEHICLE WORKSHOP', size: 700 });
  return pl;
}

export default makeType(
  { id: 'vehicle-workshop', label: 'Vehicle repair and service centre', category: 'automotive', zonesHint: ['E4', 'IN1', 'IN2', 'B5', 'B6', 'E3'], planLabel: 'PROPOSED VEHICLE WORKSHOP', costHints: { buildRateKey: 'workshop', notes: 'Workshop rate, add the wash bay drainage and oil separator allowance' } },
  PARAMS,
  build,
  (p, pl) => ({
    parking: { ratePerM2: [{ use: 'vehicle workshop', per: 1, m2: 40, status: 'ESTIMATE' }], perBay: 1, bays: p.bays + (p.washBay ? 1 : 0), accessible: true },
    vehicles: { design: 'MRV', apronDepthMm: 12000, docks: 0 },
    landscapeFrontMm: 3000,
    notes: ['Parking rate hint 1 space per 40 m2 GFA or 1 per work bay, whichever the council applies, check with council', 'Wash bay wastewater to be discharged to the sewer under trade waste approval, check with the water authority', `${pl.rooms.length} rooms, ${p.bays} work bays`],
  }),
);
