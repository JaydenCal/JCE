// Transport depot: a hardstand of marked heavy vehicle bays (HRV, AV or B-double) in rows with manoeuvring aisles, a heavy vehicle
// workshop shed with a wash bay, a site office and driver amenities column, an optional refuelling point and an optional weighbridge.
// The building is at the origin (front edge along y = 0, depth into +y); the hardstand is in front of it (negative y). Local plan mm.

import { Plan, num, sel, bool, makeType, mm, rectPoly, polyArea } from './_kitB.js';

// Indicative bay length and manoeuvring aisle by design vehicle (ESTIMATE, to be checked against AS 2890.2 and a swept path).
export const VEHICLES = {
  HRV: { label: 'HRV (12.5 m)', bayL: 14000, aisle: 18000, length: 12500 },
  AV: { label: 'AV (19 m articulated)', bayL: 21000, aisle: 24000, length: 19000 },
  'B-double': { label: 'B-double (26 m)', bayL: 28000, aisle: 30000, length: 26000 },
};

export const PARAMS = [
  num('truckBays', 'Truck parking bays', 'no.', 4, 40, 1, 12),
  sel('vehicle', 'Design vehicle', Object.entries(VEHICLES).map(([value, v]) => ({ value, label: v.label })), 'AV'),
  num('bayWidthM', 'Bay width', 'm', 3.5, 4.5, 0.1, 3.8),
  num('bayRows', 'Bay rows', 'no.', 1, 3, 1, 1),
  num('workshopBays', 'Heavy vehicle workshop bays', 'no.', 1, 6, 1, 3),
  num('workshopBayWidthM', 'Workshop bay width', 'm', 5, 7, 0.5, 6),
  num('workshopDepthM', 'Workshop depth', 'm', 14, 30, 1, 20),
  bool('washBay', 'Truck wash bay', true),
  num('washBayWidthM', 'Wash bay width', 'm', 5, 7, 0.5, 6),
  bool('refuelling', 'Refuelling point', true),
  bool('weighbridge', 'Weighbridge', false),
  num('weighbridgeLengthM', 'Weighbridge deck length', 'm', 14, 24, 1, 18),
  num('officeM2', 'Site office', 'm2', 40, 300, 5, 120),
  num('amenitiesM2', 'Driver amenities', 'm2', 20, 150, 5, 60),
  num('eaveHeightM', 'Workshop eave height', 'm', 6, 10, 0.5, 7),
  bool('showVehicles', 'Show parked trucks', true),
];

function build(p) {
  const pl = new Plan();
  const V = VEHICLES[p.vehicle];
  const bwb = mm(p.workshopBayWidthM);
  const D = mm(p.workshopDepthM);
  const eave = mm(p.eaveHeightM);
  const ww = p.washBay ? mm(p.washBayWidthM) : 0;
  const cw = Math.max(mm(6), Math.round(((p.officeM2 + p.amenitiesM2) * 1e6) / D / 100) * 100);
  const xw0 = cw + p.workshopBays * bwb;
  const W = xw0 + ww;
  pl.levels[0].heightMm = eave;
  pl.outline = rectPoly(0, 0, W, D);
  const ext = pl.rect(0, 0, W, D, { height: eave, thickness: 200 });
  pl.wall({ x: cw, y: 0 }, { x: cw, y: D }, { kind: 'interior', thickness: 150, height: eave });
  if (ww) pl.wall({ x: xw0, y: 0 }, { x: xw0, y: D }, { kind: 'interior', thickness: 200, height: eave });
  const od = Math.round(((p.officeM2 * 1e6) / cw) / 100) * 100;
  const colWall = pl.wall({ x: 0, y: od }, { x: cw, y: od }, { kind: 'interior', thickness: 100, height: eave });
  pl.room('PROPOSED SITE OFFICE', 'other', rectPoly(0, 0, cw, od), { use: 'office' });
  pl.room('PROPOSED DRIVER AMENITIES', 'other', rectPoly(0, od, cw, D), { use: 'amenities' });
  pl.room('PROPOSED HEAVY VEHICLE WORKSHOP', 'workshop', rectPoly(cw, 0, xw0, D), { use: 'workshop' });
  if (ww) pl.room('PROPOSED TRUCK WASH BAY', 'workshop', rectPoly(xw0, 0, W, D), { use: 'wash' });
  for (let i = 0; i < p.workshopBays; i++) pl.openAt(ext.front, cw + bwb * i + bwb / 2, 0, 'roller_door', Math.min(5000, bwb - 600), Math.min(5500, eave - 500), 0, { tag: 'bay' });
  if (ww) pl.openAt(ext.front, xw0 + ww / 2, 0, 'roller_door', Math.min(5000, ww - 600), Math.min(5500, eave - 500), 0, { tag: 'wash' });
  pl.openAt(ext.front, 1500, 0, 'door', 1800, 2100, 0);
  pl.openAt(ext.front, cw - 2200, 0, 'window', 1800, 1500, 900, { style: 'fixed' });
  pl.openAt(ext.back, cw / 2, D, 'door', 920, 2040, 0);
  pl.openAt(ext.back, cw + bwb / 2, D, 'roller_door', Math.min(5000, bwb - 600), Math.min(5500, eave - 500), 0, { tag: 'bay' });
  pl.openAt(colWall, cw / 2, od, 'door', 920, 2040, 0);
  pl.openAt(ext.left, 0, od / 2, 'window', 1800, 1200, 900, { style: 'fixed' });
  pl.roof(rectPoly(0, 0, W, D), 'gable', 5);

  // Hardstand: from the building face outward, aisle then bay row, repeated for each row.
  const R = p.bayRows;
  const perRow = Math.ceil(p.truckBays / R);
  const bw = mm(p.bayWidthM);
  const Wh = Math.max(W, perRow * bw);
  const Hh = R * (V.aisle + V.bayL);
  pl.extra('hardstand', rectPoly(0, -Hh, Wh, 0));
  let left = p.truckBays;
  const bayRects = [];
  for (let r = 0; r < R; r++) {
    const yFar = -(V.aisle + r * (V.aisle + V.bayL)); // aisle edge nearest the building for this row, negative
    const y0 = yFar - V.bayL;
    const n = Math.min(left, perRow);
    left -= n;
    for (let i = 0; i < n; i++) bayRects.push(rectPoly(i * bw, y0, (i + 1) * bw, yFar));
  }
  bayRects.forEach((poly, i) => {
    pl.sym({ t: 'poly', pts: poly, closed: true, stroke: '#d9a800', w: 60 });
    pl.sym({ t: 'text', x: (poly[0].x + poly[1].x) / 2, y: poly[2].y - 600, text: `${p.vehicle} ${i + 1}`, size: 380 });
    pl.extra('bay', poly);
    if (p.showVehicles) {
      const cx = (poly[0].x + poly[1].x) / 2;
      const yb = poly[0].y; // far end of the bay (most negative)
      // Parked nose first against the far end: cab then trailer.
      pl.box('truckCab', cx - 1200, yb + 400, cx + 1200, yb + 2800, 350, 3200, 'vehicle', '#3d5a80');
      pl.box('truckTrailer', cx - 1250, yb + 3000, cx + 1250, yb + 400 + V.length - 400, 500, 3700, 'vehicle', '#d8d8d2');
    }
  });
  pl.sym({ t: 'text', x: Wh / 2, y: -Hh / 2, text: 'HARDSTAND', size: 900 });
  // Weighbridge and fuel at the entry side (right of the hardstand).
  let xr = Wh + 2000;
  const entryTop = -Hh;
  if (p.weighbridge) {
    const L = mm(p.weighbridgeLengthM);
    pl.extra('weighbridge', rectPoly(xr, entryTop + 2000, xr + 3400, entryTop + 2000 + L));
    pl.box('weighbridgeDeck', xr, entryTop + 2000, xr + 3400, entryTop + 2000 + L, 0, 250, 'steel', '#6b7178');
    pl.box('weighBooth', xr + 4000, entryTop + 2000, xr + 6400, entryTop + 4400, 0, 2700, 'wall', '#aab0b5');
    pl.sym({ t: 'poly', pts: rectPoly(xr, entryTop + 2000, xr + 3400, entryTop + 2000 + L), closed: true, stroke: '#333', w: 50 });
    pl.sym({ t: 'text', x: xr + 1700, y: entryTop + 2000 + L / 2, text: 'WEIGHBRIDGE', size: 380 });
    xr += 9000;
  }
  if (p.refuelling) {
    const cx = xr + 3600;
    const y0 = entryTop + 3000;
    pl.extra('fuel-canopy', rectPoly(xr, y0, xr + 7200, y0 + 14000));
    pl.box('fuelIsland', cx - 600, y0 + 3000, cx + 600, y0 + 11000, 0, 150, 'concrete', '#a9a69d');
    for (const yy of [y0 + 5000, y0 + 9000]) pl.box('bowser', cx - 300, yy - 250, cx + 300, yy + 250, 150, 1900, 'steel', '#c0392b');
    pl.box('fuelCanopy', xr, y0, xr + 7200, y0 + 14000, 5300, 5650, 'roof', '#8a8f94');
    for (const [px, py] of [[xr + 200, y0 + 200], [xr + 7000, y0 + 200], [xr + 200, y0 + 13800], [xr + 7000, y0 + 13800]]) pl.box('canopyColumn', px - 150, py - 150, px + 150, py + 150, 0, 5300, 'steel', '#6c7379');
    pl.sym({ t: 'poly', pts: rectPoly(xr, y0, xr + 7200, y0 + 14000), closed: true, stroke: '#444', w: 50, dash: [300, 200] });
    pl.sym({ t: 'poly', pts: rectPoly(xr + 1200, y0 + 15000, xr + 6000, y0 + 22000), closed: true, stroke: '#888', w: 40, dash: [200, 200] });
    pl.sym({ t: 'text', x: cx, y: y0 + 7000, text: 'REFUELLING', size: 380 });
    pl.sym({ t: 'text', x: cx, y: y0 + 18500, text: 'UNDERGROUND TANK', size: 300 });
  }
  pl.sym({ t: 'text', x: W / 2, y: D + 900, text: 'PROPOSED TRANSPORT DEPOT', size: 700 });
  pl._hardstandM2 = polyArea(rectPoly(0, -Hh, Wh, 0)) / 1e6;
  return pl;
}

export default makeType(
  {
    id: 'transport-depot', label: 'Transport depot with truck hardstand', category: 'industrial', zonesHint: ['E4', 'IN1', 'IN2', 'RU1', 'RU5'], planLabel: 'PROPOSED TRANSPORT DEPOT',
    costHints: { buildRateKey: 'depot', notes: 'Hardstand pavement is the main cost, price it with the heavy duty pavement rate' },
    extraQuantities: (p, pl) => ({ hardstandM2: Math.round(pl._hardstandM2), truckBays: p.truckBays }),
  },
  PARAMS,
  build,
  (p, pl) => ({
    parking: { ratePerM2: [{ use: 'transport depot office and amenities', per: 1, m2: 40, status: 'ESTIMATE' }, { use: 'heavy vehicle workshop', per: 1, m2: 100, status: 'ESTIMATE' }], truckBays: p.truckBays, accessible: true },
    vehicles: { design: p.vehicle === 'HRV' ? 'HRV' : 'AV', designVehicle: p.vehicle, apronDepthMm: VEHICLES[p.vehicle].aisle, docks: 0 },
    landscapeFrontMm: 5000,
    notes: ['Bay lengths and aisle widths are indicative, check against AS 2890.2 with a swept path analysis', 'Fuel storage and refuelling need a separate approval, check with council and the fire authority', `Hardstand ${Math.round(pl._hardstandM2)} m2 for ${p.truckBays} ${p.vehicle} bays`],
  }),
);
