// Drive-through food outlet: building 150 to 400 m2, queue lane (vehicles stacked), order and pay windows, dining, outdoor seating, bypass lane.
import { defineType, NUM, BOOL, rect, m2, round1, poly, symPoly, symLine, symText } from './_kit.js';

const STACK_MM = 6000; // one queued vehicle
const LANE_W = 3200;

const params = [
  NUM('gfaM2', 'Building floor area', 'm2', 150, 400, 10, 250),
  NUM('queueVehicles', 'Queue lane capacity before the order point', 'vehicles', 4, 24, 1, 12),
  NUM('orderPoints', 'Order points in tandem', '', 1, 2, 1, 1),
  BOOL('payWindow', 'Separate pay window (otherwise order, pay and collect at one window)', true),
  NUM('diningPct', 'Dining area share of building', '%', 20, 65, 5, 45),
  BOOL('outdoorSeating', 'Outdoor seating', true),
  NUM('outdoorSeats', 'Outdoor seats', 'seats', 4, 40, 4, 16),
  BOOL('bypassLane', 'Bypass lane beside the queue', true),
];

function spec(p) {
  const W = Math.round(Math.sqrt(p.gfaM2 * 1.6) * 2) * 500; // metres to mm in 500 steps
  const D = (p.gfaM2 * 1e6) / W;
  const H = 3600;
  const dd = D * (p.diningPct / 100);
  const kd = D - dd;
  const yPay = dd + kd * 0.3; const yPick = dd + kd * 0.7;
  const rooms = [
    { name: 'PROPOSED DINING AREA', poly: rect(0, 0, W, dd), level: 0 },
    { name: 'PROPOSED KITCHEN AND SERVICE', poly: rect(0, dd, W, D), level: 0 },
  ];
  const interior = [{ a: { x: 0, y: dd }, b: { x: W, y: dd }, thickness: 100 }];
  const openings = [
    { wall: 'front', kind: 'door', offset: Math.round(W / 2 - 900), width: 1800, height: 2400, sill: 0 },
    { wall: 'front', kind: 'window', offset: 800, width: Math.round(W / 2 - 1900), height: 2400, sill: 600, style: 'fixed' },
    { wall: 'front', kind: 'window', offset: Math.round(W / 2 + 1100), width: Math.round(W / 2 - 1900), height: 2400, sill: 600, style: 'fixed' },
    { wall: 'left', kind: 'window', offset: Math.round(dd / 2 - 900), width: 1800, height: 1500, sill: 900, style: 'fixed' },
    { wall: 'rear', kind: 'door', offset: Math.round(W / 2 - 500), width: 1000, height: 2100, sill: 0 },
    { wall: 'right', kind: 'window', offset: Math.round(p.payWindow ? yPay - 500 : yPick - 500), width: 1000, height: 1100, sill: 1000, style: 'sliding' },
    { wall: 'right', kind: 'window', offset: Math.round(yPick - 500), width: 1000, height: 1100, sill: 1000, style: 'sliding' },
  ];
  if (!p.payWindow) openings.splice(5, 1); // a single combined window
  // Drive-through lane: a leg along the rear (from the west) then down the east side to the exit at the front.
  const laneX0 = W + 300; const laneX1 = laneX0 + LANE_W;
  const yOrder = D * 0.9;
  const Lq = p.queueVehicles * STACK_MM;
  const yTurn = D + 600 + LANE_W / 2;
  const rearLen = Math.max(0, Lq - (yTurn - yOrder));
  const extras = [poly('queue-lane', rect(laneX0, -3000, laneX1, D + 600 + LANE_W), 'DRIVE-THROUGH LANE')];
  if (rearLen > 0) extras.push(poly('queue-lane', rect(laneX1 - rearLen - LANE_W, D + 600, laneX1, D + 600 + LANE_W), 'QUEUE LANE (REAR LEG)'));
  for (let i = 0; i < p.orderPoints; i++) extras.push(poly('order-point', rect(laneX1 + 100, yOrder - i * 6000 - 500, laneX1 + 700, yOrder - i * 6000 + 500), `ORDER POINT ${i + 1}`));
  if (p.bypassLane) extras.push(poly('bypass-lane', rect(laneX1 + 800, -3000, laneX1 + 800 + 3000, D + 600), 'BYPASS LANE'));
  const seatX1 = Math.min(W - 1000, 11000);
  if (p.outdoorSeating) extras.push(poly('outdoor-seating', rect(1000, -4200, seatX1, -600), 'OUTDOOR SEATING'));
  const boxes = [];
  const lastWin = yPick;
  boxes.push({ x0: W, x1: W + 2400, y0: yPay - 1500, y1: lastWin + 1500, z0: 3000, z1: 3200, slot: 'canopy' }); // window canopy
  for (let i = 0; i < p.orderPoints; i++) {
    const y = yOrder - i * 6000;
    boxes.push({ x0: laneX1 + 150, x1: laneX1 + 550, y0: y - 700, y1: y + 700, z0: 900, z1: 2500, slot: 'board' }); // blank menu board, no logos
    boxes.push({ x0: laneX1 + 250, x1: laneX1 + 450, y0: y - 100, y1: y + 100, z0: 0, z1: 900, slot: 'steel' });
  }
  boxes.push({ x0: laneX0 - 100, x1: laneX1 + 100, y0: -3000, y1: -2900, z0: 2200, z1: 2400, slot: 'steel' }); // height bar
  for (const y of [yPay, yPick]) boxes.push({ x0: W + 2100, x1: W + 2400, y0: y - 100, y1: y + 100, z0: 0, z1: 3000, slot: 'steel' });
  boxes.push({ x0: W / 2 - 1500, x1: W / 2 + 1500, y0: -60, y1: 0, z0: 3000, z1: 3500, slot: 'board' });
  if (p.outdoorSeating) {
    const tables = Math.ceil(p.outdoorSeats / 4);
    for (let t = 0; t < tables; t++) {
      const cx = 1800 + (t % 5) * 1900; const cy = -3400 + Math.floor(t / 5) * 1700;
      boxes.push({ x0: cx - 400, x1: cx + 400, y0: cy - 400, y1: cy + 400, z0: 0, z1: 750, slot: 'furniture' });
      for (const [dx, dy] of [[-650, 0], [650, 0], [0, -650], [0, 650]]) boxes.push({ x0: cx + dx - 200, x1: cx + dx + 200, y0: cy + dy - 200, y1: cy + dy + 200, z0: 0, z1: 450, slot: 'furniture' });
    }
  }
  boxes.push({ x0: W - 3500, x1: W - 500, y0: D - 2500, y1: D - 500, z0: H, z1: H + 1000, slot: 'plant' }); // roof plant
  const symbols = [
    symPoly(rect(laneX0, -3000, laneX1, D + 600 + LANE_W), '#777', 'rgba(60,60,60,0.10)'),
    symLine([{ x: laneX0 + LANE_W / 2, y: D + 600 + LANE_W / 2 }, { x: laneX0 + LANE_W / 2, y: -3000 }], '#888', { dash: [10, 8] }),
    symText({ x: laneX0, y: yOrder - 1200 }, `QUEUE ${p.queueVehicles} VEHICLES`),
  ];
  if (p.bypassLane) symbols.push(symPoly(rect(laneX1 + 800, -3000, laneX1 + 3800, D + 600), '#999', 'rgba(60,60,60,0.05)', { dash: [6, 4] }));
  const ground = m2(W * D);
  return {
    W, D, storeys: 1, wallH: H, rooms, interior, openings, extras, boxes, symbols, roofs: [{ type: 'skillion', pitchDeg: 4 }],
    extraQuantities: { queueLaneM: round1((Lq + 6000) / 1000), queueVehicles: p.queueVehicles, outdoorSeats: p.outdoorSeating ? p.outdoorSeats : 0 },
    perUse: () => ({ dining: round1(m2(W * dd)), kitchen: round1(m2(W * kd)) }),
    site: (n) => ({
      parking: { ratePerM2: [{ use: 'food and drink premises', per: 15, m2: round1(ground) }], accessible: true },
      vehicles: { design: 'MRV', apronDepthMm: 0, docks: 0 },
      landscapeFrontMm: 2000,
      notes: [`Queue lane stacks ${n.queueVehicles} vehicles at 6.0 m each (${(Lq / 1000).toFixed(0)} m) before the first order point; the queue must not back onto the street.`, 'Parking rate hint 1 per 15 m2 plus queue storage; check with council and the road authority.'],
    }),
  };
}

export default defineType({
  id: 'drive-through', label: 'Drive-through food outlet', category: 'retail', zonesHint: ['E1', 'B1', 'B2', 'B5', 'B6', 'IN2'],
  params, planLabel: 'PROPOSED DRIVE-THROUGH FOOD OUTLET', buildRateKey: 'drive-through', costNotes: 'Building, lane paving and fitout allowance. ESTIMATE, check current rates.', spec,
});
