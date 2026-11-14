// Service station: fuel canopy with pump islands, convenience kiosk, underground tank pad, air and water, truck diesel island, car wash.
import { defineType, NUM, SEL, BOOL, rect, m2, round1, poly, symPoly, symLine, symText } from './_kit.js';

const PITCH = 6500; // island to island

const params = [
  NUM('pumps', 'Pump islands (two fuelling positions each)', '', 2, 8, 1, 4),
  NUM('kioskM2', 'Convenience kiosk floor area', 'm2', 80, 300, 10, 150),
  NUM('tanks', 'Underground tanks', '', 2, 6, 1, 4),
  BOOL('truckDiesel', 'Truck diesel island', false),
  SEL('carWash', 'Car wash', [{ value: 'none', label: 'None' }, { value: 'bay', label: 'Self serve bay' }, { value: 'automatic', label: 'Automatic tunnel' }], 'none'),
  BOOL('airWater', 'Air and water bay', true),
  NUM('canopyH', 'Canopy clearance height', 'mm', 4500, 6500, 100, 5200),
];

function spec(p) {
  const W = Math.round(Math.sqrt(p.kioskM2 * 2.2) * 2) * 500;
  const D = (p.kioskM2 * 1e6) / W;
  const H = 3600;
  const cw = p.pumps * PITCH + 3000;
  const cx0 = (W - cw) / 2; const cy0 = -26000; const cy1 = -14000;
  const rooms = [
    { name: 'PROPOSED CONVENIENCE KIOSK', poly: rect(0, 0, W, D * 0.7), level: 0 },
    { name: 'PROPOSED STORE AND AMENITIES', poly: rect(0, D * 0.7, W, D), level: 0 },
    { name: 'PROPOSED FUEL CANOPY', poly: rect(cx0, cy0, cx0 + cw, cy1), level: 0, outdoor: true },
  ];
  const interior = [{ a: { x: 0, y: D * 0.7 }, b: { x: W, y: D * 0.7 }, thickness: 100 }];
  const openings = [
    { wall: 'front', kind: 'door', offset: Math.round(W / 2 - 1000), width: 2000, height: 2400, sill: 0 },
    { wall: 'front', kind: 'window', offset: 600, width: Math.round(W / 2 - 1800), height: 2400, sill: 500, style: 'fixed' },
    { wall: 'front', kind: 'window', offset: Math.round(W / 2 + 1200), width: Math.round(W / 2 - 1800), height: 2400, sill: 500, style: 'fixed' },
    { wall: 'rear', kind: 'door', offset: Math.round(W / 2 - 500), width: 1000, height: 2100, sill: 0 },
  ];
  const extras = [poly('fuel-canopy', rect(cx0, cy0, cx0 + cw, cy1), 'FUEL CANOPY')];
  const boxes = [{ x0: cx0, x1: cx0 + cw, y0: cy0, y1: cy1, z0: p.canopyH, z1: p.canopyH + 450, slot: 'canopy' }];
  const symbols = [symPoly(rect(cx0, cy0, cx0 + cw, cy1), '#666', 'rgba(0,0,0,0)', { dash: [8, 5] })];
  const midY = (cy0 + cy1) / 2;
  for (let i = 0; i < p.pumps; i++) {
    const cx = cx0 + 1500 + 3250 + i * PITCH;
    extras.push(poly('pump-island', rect(cx - 600, midY - 3500, cx + 600, midY + 3500), `PUMP ISLAND ${i + 1}`));
    boxes.push({ x0: cx - 600, x1: cx + 600, y0: midY - 3500, y1: midY + 3500, z0: 0, z1: 150, slot: 'concrete' });
    boxes.push({ x0: cx - 350, x1: cx + 350, y0: midY - 250, y1: midY + 250, z0: 150, z1: 1900, slot: 'pump' }); // dispenser, no markings
    for (const dy of [-3300, 3300]) boxes.push({ x0: cx - 200, x1: cx + 200, y0: midY + dy - 200, y1: midY + dy + 200, z0: 0, z1: p.canopyH, slot: 'steel' });
    symbols.push(symPoly(rect(cx - 600, midY - 3500, cx + 600, midY + 3500), '#444', 'rgba(150,150,150,0.35)'), symText({ x: cx - 300, y: midY }, `P${i + 1}`));
  }
  // Underground tank pad, plan symbol only: dashed tanks under the forecourt toward the street.
  const tx0 = cx0; const ty0 = -38000; const ty1 = -28500;
  extras.push(poly('underground-tank-pad', rect(tx0, ty0, tx0 + p.tanks * 3500, ty1), 'UNDERGROUND TANK PAD'));
  for (let i = 0; i < p.tanks; i++) symbols.push(symPoly(rect(tx0 + i * 3500 + 250, ty0 + 250, tx0 + (i + 1) * 3500 - 250, ty1 - 250), '#a33', 'rgba(170,50,50,0.08)', { dash: [4, 3] }), symText({ x: tx0 + i * 3500 + 500, y: (ty0 + ty1) / 2 }, `UST ${i + 1}`));
  boxes.push({ x0: tx0 + p.tanks * 3500, x1: tx0 + p.tanks * 3500 + 150, y0: ty0, y1: ty0 + 150, z0: 0, z1: 4000, slot: 'steel' }); // vent stack
  let truckM2 = 0;
  if (p.truckDiesel) {
    const x0 = cx0 + cw + 2500; const x1 = x0 + 9000; const y0 = -34000; const y1 = -14000;
    truckM2 = m2(9000 * 20000);
    extras.push(poly('truck-canopy', rect(x0, y0, x1, y1), 'TRUCK DIESEL CANOPY'), poly('pump-island', rect(x0 + 3900, y0 + 5000, x0 + 5100, y1 - 5000), 'TRUCK DIESEL ISLAND'));
    boxes.push({ x0, x1, y0, y1, z0: 6500, z1: 6950, slot: 'canopy' }, { x0: x0 + 3900, x1: x0 + 5100, y0: y0 + 5000, y1: y1 - 5000, z0: 0, z1: 150, slot: 'concrete' }, { x0: x0 + 4150, x1: x0 + 4850, y0: (y0 + y1) / 2 - 250, y1: (y0 + y1) / 2 + 250, z0: 150, z1: 2100, slot: 'pump' });
    for (const [cx, cy] of [[x0 + 300, y0 + 300], [x1 - 300, y0 + 300], [x0 + 300, y1 - 300], [x1 - 300, y1 - 300]]) boxes.push({ x0: cx - 200, x1: cx + 200, y0: cy - 200, y1: cy + 200, z0: 0, z1: 6500, slot: 'steel' });
    symbols.push(symPoly(rect(x0, y0, x1, y1), '#666', 'rgba(0,0,0,0)', { dash: [8, 5] }), symText({ x: x0 + 600, y: y0 + 1500 }, 'TRUCK DIESEL'));
  }
  let washM2 = 0;
  if (p.carWash !== 'none') {
    const wx0 = W + 4000; const ww = p.carWash === 'automatic' ? 5500 : 5000; const wl = p.carWash === 'automatic' ? 16000 : 9000;
    washM2 = m2(ww * wl);
    rooms.push({ name: p.carWash === 'automatic' ? 'PROPOSED CAR WASH TUNNEL' : 'PROPOSED SELF SERVE WASH BAY', poly: rect(wx0, 0, wx0 + ww, wl), level: 0 });
    extras.push(poly('car-wash', rect(wx0, 0, wx0 + ww, wl), p.carWash === 'automatic' ? 'CAR WASH TUNNEL' : 'SELF SERVE WASH BAY'));
    boxes.push({ x0: wx0, x1: wx0 + ww, y0: 0, y1: wl, z0: 0, z1: 3800, slot: 'panel' });
    symbols.push(symPoly(rect(wx0, 0, wx0 + ww, wl), '#555', 'rgba(100,140,170,0.15)'), symText({ x: wx0 + 400, y: wl / 2 }, 'WASH'));
  }
  if (p.airWater) {
    extras.push(poly('air-water-bay', rect(W + 500, 2000, W + 3500, 8000), 'AIR AND WATER BAY'));
    boxes.push({ x0: W + 1800, x1: W + 2200, y0: 4800, y1: 5200, z0: 0, z1: 1400, slot: 'pump' });
    symbols.push(symPoly(rect(W + 500, 2000, W + 3500, 8000), '#555', 'rgba(0,0,0,0)', { dash: [4, 3] }), symText({ x: W + 600, y: 5000 }, 'AIR WATER'));
  }
  boxes.push({ x0: W / 2 - 1500, x1: W / 2 + 1500, y0: -60, y1: 0, z0: 3000, z1: 3500, slot: 'board' }); // blank sign panel
  const canopyM2 = m2(cw * (cy1 - cy0));
  return {
    W, D, storeys: 1, wallH: H, rooms, interior, openings, extras, boxes, symbols, roofs: [{ type: 'skillion', pitchDeg: 3 }],
    extraQuantities: { canopyM2: round1(canopyM2), truckCanopyM2: round1(truckM2), carWashM2: round1(washM2), islands: p.pumps, fuellingPositions: p.pumps * 2, tanks: p.tanks },
    perUse: () => ({ kiosk: round1(m2(W * D * 0.7)), storeAndAmenities: round1(m2(W * D * 0.3)) }),
    site: (n) => ({
      parking: { ratePerM2: [{ use: 'convenience store', per: 20, m2: round1(m2(W * D)) }], accessible: true },
      vehicles: { design: n.truckDiesel ? 'HRV' : 'AV', apronDepthMm: 0, docks: 0 },
      landscapeFrontMm: 3000,
      notes: ['Fuel tanker delivery path to be shown by swept path; design vehicle covers the delivery tanker.', 'Parking rate hint 1 per 20 m2 of kiosk; check with council.', 'Tank pad is a plan symbol only. Environmental, fire and dangerous goods requirements need separate specialist advice.'],
    }),
  };
}

export default defineType({
  id: 'service-station', label: 'Service station', category: 'automotive', zonesHint: ['E1', 'B5', 'B6', 'IN1', 'IN2', 'SP2'],
  params, planLabel: 'PROPOSED SERVICE STATION', buildRateKey: 'service-station', costNotes: 'Kiosk, canopy, tank installation and forecourt paving. ESTIMATE, check current rates.', spec,
});
