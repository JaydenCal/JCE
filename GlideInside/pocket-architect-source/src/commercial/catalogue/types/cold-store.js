// Insulated panel cold store: chiller and freezer rooms, dock doors with seals and shelters, plant platform, office pod.
import { defineType, NUM, rect, m2, round1, poly, symPoly, symText } from './_kit.js';

const POD_W = 6000;
const APRON = 27000;

const params = [
  NUM('chillers', 'Chiller rooms', '', 1, 4, 1, 2),
  NUM('freezers', 'Freezer rooms', '', 1, 4, 1, 2),
  NUM('roomW', 'Room width', 'mm', 8000, 20000, 500, 12000),
  NUM('roomD', 'Room depth', 'mm', 20000, 40000, 500, 30000),
  NUM('hallD', 'Dock and dispatch hall depth', 'mm', 8000, 14000, 500, 10000),
  NUM('docks', 'Dock doors', '', 2, 12, 1, 4),
  NUM('eaveH', 'Eave height', 'mm', 8000, 12000, 500, 10000),
];

function spec(p) {
  const nRooms = p.chillers + p.freezers;
  const W = nRooms * p.roomW; const D = p.hallD + p.roomD; const H = p.eaveH;
  const podD = Math.min(8000, p.hallD - 2000);
  const docks = Math.min(p.docks, Math.floor((W - POD_W) / 3600));
  const rooms = [
    { name: 'PROPOSED OFFICE POD', poly: rect(0, 0, POD_W, podD), level: 0 },
    { name: 'PROPOSED DOCK AND DISPATCH HALL', poly: [{ x: POD_W, y: 0 }, { x: W, y: 0 }, { x: W, y: p.hallD }, { x: 0, y: p.hallD }, { x: 0, y: podD }, { x: POD_W, y: podD }], level: 0 },
  ];
  const interior = [
    { a: { x: 0, y: p.hallD }, b: { x: W, y: p.hallD }, thickness: 150 },
    { a: { x: POD_W, y: 0 }, b: { x: POD_W, y: podD }, thickness: 100 },
    { a: { x: 0, y: podD }, b: { x: POD_W, y: podD }, thickness: 100 },
  ];
  for (let i = 0; i < nRooms; i++) {
    const x0 = i * p.roomW;
    const isChill = i < p.chillers;
    rooms.push({ name: isChill ? `PROPOSED CHILLER ROOM ${i + 1}` : `PROPOSED FREEZER ROOM ${i - p.chillers + 1}`, poly: rect(x0, p.hallD, x0 + p.roomW, D), level: 0 });
    if (i > 0) interior.push({ a: { x: x0, y: p.hallD }, b: { x: x0, y: D }, thickness: 150 });
  }
  const openings = [
    { wall: 'front', kind: 'door', offset: 1500, width: 1000, height: 2100, sill: 0 },
    { wall: 'front', kind: 'window', offset: 3000, width: 2000, height: 1200, sill: 900, style: 'fixed' },
    { wall: 'rear', kind: 'door', offset: Math.round(W / 2 - 500), width: 1000, height: 2100, sill: 0 },
  ];
  const avail = W - POD_W - 1200;
  const pitch = avail / docks;
  const extras = [poly('dock-apron', rect(0, -APRON, W, 0), 'DOCK APRON AND TRUCK MANOEUVRING')];
  const boxes = [];
  for (let i = 0; i < docks; i++) {
    const cx = POD_W + 600 + pitch * (i + 0.5);
    openings.push({ wall: 'front', kind: 'roller_door', offset: Math.round(cx - 1500), width: 3000, height: 3300, sill: 1200, dock: true, seal: true, shelter: true });
    extras.push(poly('dock-shelter', rect(cx - 1900, -1500, cx + 1900, 0), `DOCK SHELTER ${i + 1}`));
    boxes.push({ x0: cx - 1900, x1: cx + 1900, y0: -1500, y1: 0, z0: 4600, z1: 4900, slot: 'panel' });
    boxes.push({ x0: cx - 1900, x1: cx - 1750, y0: -1500, y1: 0, z0: 1200, z1: 4600, slot: 'panel' }, { x0: cx + 1750, x1: cx + 1900, y0: -1500, y1: 0, z0: 1200, z1: 4600, slot: 'panel' });
    boxes.push({ x0: cx - 1200, x1: cx + 1200, y0: -1800, y1: 0, z0: 1050, z1: 1200, slot: 'steel' }); // dock leveller
    boxes.push({ x0: cx - 2300, x1: cx - 2100, y0: -1600, y1: -1400, z0: 0, z1: 1000, slot: 'steel' }, { x0: cx + 2100, x1: cx + 2300, y0: -1600, y1: -1400, z0: 0, z1: 1000, slot: 'steel' });
  }
  boxes.push({ x0: 0, x1: W, y0: -2400, y1: 0, z0: 0, z1: 1200, slot: 'concrete' }); // raised dock platform, truck bed height
  // Plant platform at the rear with condensing units, plus roof plant over the rooms.
  const px0 = W / 2 - 6000; const px1 = W / 2 + 6000;
  extras.push(poly('plant-platform', rect(px0, D, px1, D + 6000), 'PLANT PLATFORM'));
  boxes.push({ x0: px0, x1: px1, y0: D, y1: D + 6000, z0: 0, z1: 1200, slot: 'concrete' });
  for (let i = 0; i < 3; i++) boxes.push({ x0: px0 + 500 + i * 3800, x1: px0 + 3800 + i * 3800, y0: D + 1500, y1: D + 3500, z0: 1200, z1: 3400, slot: 'plant' });
  boxes.push({ x0: W / 2 - 3000, x1: W / 2 + 3000, y0: -60, y1: 0, z0: 5200, z1: 5800, slot: 'board' }); // blank sign panel
  const symbols = [
    symPoly(rect(0, 0, POD_W, podD), '#555', 'rgba(150,150,150,0.2)'),
    symPoly(rect(px0, D, px1, D + 6000), '#555', 'rgba(0,0,0,0)', { dash: [4, 3] }), symText({ x: px0 + 600, y: D + 3000 }, 'PLANT'),
    symPoly(rect(0, -APRON, W, 0), '#888', 'rgba(60,60,60,0.06)', { dash: [10, 8] }),
  ];
  for (let i = 0; i < nRooms; i++) symbols.push(symPoly(rect(i * p.roomW, p.hallD, (i + 1) * p.roomW, D), '#4a7a9b', i < p.chillers ? 'rgba(120,170,210,0.12)' : 'rgba(80,120,190,0.22)'), symText({ x: i * p.roomW + 600, y: p.hallD + 1500 }, i < p.chillers ? 'CHILLER' : 'FREEZER'));
  const roomM2 = m2(p.roomW * p.roomD);
  return {
    W, D, storeys: 1, wallH: H, rooms, interior, openings, extras, boxes, symbols, roofs: [{ type: 'skillion', pitchDeg: 3 }],
    extraQuantities: { chillerM2: round1(p.chillers * roomM2), freezerM2: round1(p.freezers * roomM2), dockDoors: docks, panelWallM2: round1(((2 * (W + D) * H) / 1e6)) },
    perUse: () => ({ chiller: round1(p.chillers * roomM2), freezer: round1(p.freezers * roomM2), dockHall: round1(m2(W * p.hallD) - m2(POD_W * podD)), officePod: round1(m2(POD_W * podD)) }),
    site: () => ({
      parking: { ratePerM2: [{ use: 'cold storage', per: 300, m2: round1(m2(W * D) - m2(POD_W * podD)) }, { use: 'office', per: 40, m2: round1(m2(POD_W * podD)) }], accessible: true },
      vehicles: { design: 'HRV', apronDepthMm: APRON, docks },
      landscapeFrontMm: 3000,
      notes: ['Dock apron depth allows a heavy rigid vehicle to reverse onto the docks; confirm by swept path.', 'Storage parking rate hint 1 per 300 m2 plus office at 1 per 40 m2; check with council.'],
    }),
  };
}

export default defineType({
  id: 'cold-store', label: 'Cold store with dock doors', category: 'storage', zonesHint: ['E4', 'IN1', 'IN2', 'IN3'],
  params, planLabel: 'PROPOSED COLD STORE', buildRateKey: 'cold-store', costNotes: 'Insulated panel building, refrigeration plant allowance. ESTIMATE, check current rates.', spec,
});
