// Retail strip: 2 to 12 shops, cafe end tenancy with outdoor dining, continuous awning, rear service lane and bin store.
import { defineType, NUM, SEL, BOOL, rect, m2, round1, poly, symPoly, symLine, symText } from './_kit.js';

const params = [
  NUM('shops', 'Number of shops', '', 2, 12, 1, 5),
  NUM('shopW', 'Shop width', 'mm', 4000, 10000, 500, 6000),
  NUM('depth', 'Shop depth', 'mm', 10000, 30000, 500, 15000),
  BOOL('cafeEnd', 'Cafe in the end tenancy', true),
  BOOL('outdoorDining', 'Outdoor dining for the cafe', true),
  BOOL('continuousAwning', 'Continuous awning', true),
  NUM('awningDepth', 'Awning depth', 'mm', 2000, 4500, 100, 3000),
  BOOL('serviceLane', 'Rear service lane', true),
  NUM('laneW', 'Service lane width', 'mm', 5000, 9000, 500, 6000),
  BOOL('binStore', 'Bin store', true),
  NUM('parkingPerM2', 'Parking rate: one bay per this floor area (check with council)', 'm2', 15, 50, 1, 25),
];

function spec(p) {
  const W = p.shops * p.shopW; const D = p.depth; const H = 4200;
  const cafeX0 = (p.shops - 1) * p.shopW;
  const rooms = []; const interior = []; const openings = [];
  for (let i = 0; i < p.shops; i++) {
    const x0 = i * p.shopW; const isCafe = p.cafeEnd && i === p.shops - 1;
    rooms.push({ name: isCafe ? 'PROPOSED CAFE' : `PROPOSED SHOP ${i + 1}`, poly: rect(x0, 0, x0 + p.shopW, D), level: 0 });
    if (i > 0) interior.push({ a: { x: x0, y: 0 }, b: { x: x0, y: D }, thickness: 200 });
    openings.push({ wall: 'front', kind: 'door', offset: x0 + 450, width: 1500, height: 2400, sill: 0 });
    const ww = Math.max(1200, p.shopW - 2400);
    openings.push({ wall: 'front', kind: 'window', offset: x0 + 450 + 1500 + 150, width: Math.min(ww, p.shopW - 2250), height: 2400, sill: isCafe ? 300 : 600, style: 'fixed' });
    openings.push({ wall: 'rear', kind: 'door', offset: x0 + Math.round(p.shopW / 2 - 500), width: 1000, height: 2100, sill: 0 });
  }
  const extras = [];
  if (p.continuousAwning) extras.push(poly('awning', rect(0, -p.awningDepth, W, 0), 'CONTINUOUS AWNING'));
  else for (let i = 0; i < p.shops; i++) extras.push(poly('awning', rect(i * p.shopW + 300, -p.awningDepth, (i + 1) * p.shopW - 300, 0), `AWNING ${i + 1}`));
  if (p.cafeEnd && p.outdoorDining) extras.push(poly('outdoor-dining', rect(cafeX0, -p.awningDepth - 2000, W, -300), 'CAFE OUTDOOR DINING'));
  if (p.serviceLane) extras.push(poly('service-lane', rect(0, D, W, D + p.laneW), 'REAR SERVICE LANE'));
  if (p.binStore) extras.push(poly('bin-store', rect(W, D, W + 4000, D + 3500), 'BIN STORE'));
  const boxes = [];
  if (p.continuousAwning) boxes.push({ x0: 0, x1: W, y0: -p.awningDepth, y1: 0, z0: 3200, z1: 3400, slot: 'canopy' });
  else for (let i = 0; i < p.shops; i++) boxes.push({ x0: i * p.shopW + 300, x1: (i + 1) * p.shopW - 300, y0: -p.awningDepth, y1: 0, z0: 3200, z1: 3400, slot: 'canopy' });
  for (let i = 0; i <= p.shops; i++) boxes.push({ x0: Math.min(W, i * p.shopW) - 75 - (i === p.shops ? 150 : 0), x1: Math.min(W, i * p.shopW) + 75 - (i === p.shops ? 150 : 0), y0: -p.awningDepth + 100, y1: -p.awningDepth + 250, z0: 0, z1: 3200, slot: 'steel' });
  for (let i = 0; i < p.shops; i++) boxes.push({ x0: i * p.shopW + 400, x1: (i + 1) * p.shopW - 400, y0: -80, y1: 0, z0: 3500, z1: 4100, slot: 'board' }); // blank sign panels
  let seats = 0;
  if (p.cafeEnd && p.outdoorDining) {
    const dw = p.shopW; const dd = p.awningDepth + 1700 - 300;
    const cols = Math.max(1, Math.floor(dw / 1800)); const rws = Math.max(1, Math.floor(dd / 1500));
    for (let c = 0; c < cols; c++) for (let r = 0; r < rws; r++) {
      const cx = cafeX0 + 900 + c * 1800; const cy = -p.awningDepth - 2000 + 800 + r * 1500;
      boxes.push({ x0: cx - 400, x1: cx + 400, y0: cy - 400, y1: cy + 400, z0: 0, z1: 750, slot: 'furniture' });
      boxes.push({ x0: cx - 300, x1: cx + 300, y0: cy - 750, y1: cy - 450, z0: 0, z1: 450, slot: 'furniture' });
      boxes.push({ x0: cx - 300, x1: cx + 300, y0: cy + 450, y1: cy + 750, z0: 0, z1: 450, slot: 'furniture' });
      seats += 2;
    }
  }
  if (p.binStore) for (let i = 0; i < 3; i++) boxes.push({ x0: W + 500 + i * 1200, x1: W + 1500 + i * 1200, y0: D + 500, y1: D + 1500, z0: 0, z1: 1100, slot: 'plant' });
  const symbols = [symPoly(rect(0, -p.awningDepth, W, 0), '#777', 'rgba(0,0,0,0)', { dash: [6, 4] })];
  if (p.serviceLane) symbols.push(symLine([{ x: 0, y: D + p.laneW / 2 }, { x: W, y: D + p.laneW / 2 }], '#888', { dash: [10, 8] }), symText({ x: 600, y: D + p.laneW / 2 - 300 }, 'SERVICE LANE'));
  if (p.cafeEnd && p.outdoorDining) symbols.push(symPoly(rect(cafeX0, -p.awningDepth - 2000, W, -300), '#8a6d4e', 'rgba(138,109,78,0.12)'));
  const cafeM2 = p.cafeEnd ? m2(p.shopW * D) : 0;
  const shopsM2 = m2(W * D) - cafeM2;
  return {
    W, D, storeys: 1, wallH: H, rooms, interior, openings, extras, boxes, symbols, roofs: [{ type: 'skillion', pitchDeg: 3 }],
    extraQuantities: { shops: p.shops, outdoorSeats: seats },
    perUse: () => ({ retail: round1(shopsM2), cafe: round1(cafeM2) }),
    site: (n) => ({
      parking: { ratePerM2: [{ use: 'shops', per: n.parkingPerM2, m2: round1(shopsM2) }, ...(cafeM2 ? [{ use: 'cafe', per: n.parkingPerM2, m2: round1(cafeM2) }] : [])], accessible: true },
      vehicles: { design: 'MRV', apronDepthMm: n.serviceLane ? n.laneW : 0, docks: 0 },
      landscapeFrontMm: 0,
      notes: ['Default rate 1 per 25 m2 of floor area; check with council, as rates differ by council and a cafe may attract a higher rate.', 'Rear service lane sized for a medium rigid vehicle turning path; confirm by swept path.'],
    }),
  };
}

export default defineType({
  id: 'retail-strip', label: 'Retail strip with shops', category: 'retail', zonesHint: ['E1', 'B1', 'B2', 'MU1'],
  params, planLabel: 'PROPOSED RETAIL SHOPS', buildRateKey: 'retail', costNotes: 'Base building shopfronts, tenant fitout excluded. ESTIMATE, check current rates.', spec,
});
