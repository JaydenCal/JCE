// Office building: 1 to 3 storeys, floor plate, core position, open plan or tenancies, glazing ratio, entry canopy, parking hint.
import { defineType, NUM, SEL, BOOL, rect, m2, round1, poly, symPoly, symLine, symText } from './_kit.js';

const params = [
  NUM('storeys', 'Storeys', '', 1, 3, 1, 2),
  NUM('plateW', 'Floor plate width', 'mm', 12000, 60000, 500, 24000),
  NUM('plateD', 'Floor plate depth', 'mm', 12000, 30000, 500, 18000),
  NUM('floorH', 'Floor to floor height', 'mm', 3300, 4200, 100, 3600),
  SEL('corePos', 'Core position (lifts, stairs, amenities)', [{ value: 'centre', label: 'Centre' }, { value: 'left', label: 'Left end' }, { value: 'right', label: 'Right end' }, { value: 'rear', label: 'Rear' }], 'right'),
  NUM('lifts', 'Lifts', '', 1, 3, 1, 1),
  SEL('layout', 'Floor layout', [{ value: 'open', label: 'Open plan' }, { value: 'tenancies', label: 'Tenancies' }], 'open'),
  NUM('tenancies', 'Tenancies per floor', '', 2, 6, 1, 3),
  NUM('glazingPct', 'Glazing ratio of external wall', '%', 20, 80, 5, 45),
  BOOL('canopy', 'Entry canopy', true),
  SEL('parking', 'Parking', [{ value: 'at-grade', label: 'At grade' }, { value: 'basement', label: 'Basement' }], 'at-grade'),
];

function spec(p) {
  const W = p.plateW; const D = p.plateD; const H = p.floorH;
  const coreW = 4000 + p.lifts * 2500; const coreD = 6000;
  let core; let zones;
  if (p.corePos === 'left') { core = rect(0, 0, coreW, D); zones = [rect(coreW, 0, W, D)]; }
  else if (p.corePos === 'right') { core = rect(W - coreW, 0, W, D); zones = [rect(0, 0, W - coreW, D)]; }
  else if (p.corePos === 'rear') { core = rect(0, D - coreD, W, D); zones = [rect(0, 0, W, D - coreD)]; }
  else { const x0 = (W - coreW) / 2; core = rect(x0, 0, x0 + coreW, D); zones = [rect(0, 0, x0, D), rect(x0 + coreW, 0, W, D)]; }
  const coreArea = m2((core[2].x - core[0].x) * (core[2].y - core[0].y));
  const levels = Array.from({ length: p.storeys }, (_, i) => ({ name: i === 0 ? 'Ground' : `Level ${i}`, elevationMm: i * H }));
  const rooms = []; const interior = [];
  for (let li = 0; li < p.storeys; li++) {
    rooms.push({ name: 'CORE (LIFTS, STAIRS, AMENITIES)', poly: core, level: li });
    const total = zones.reduce((a, z) => a + (z[2].x - z[0].x), 0);
    let tn = 0;
    zones.forEach((z) => {
      const zw = z[2].x - z[0].x;
      const cnt = p.layout === 'open' ? 1 : Math.max(1, Math.round(p.tenancies * (zw / total)));
      for (let k = 0; k < cnt; k++) {
        tn += 1;
        const w = zw / cnt; const x0 = z[0].x + k * w;
        const r = rect(x0, z[0].y, x0 + w, z[2].y);
        rooms.push({ name: p.layout === 'open' ? 'PROPOSED OFFICE' : `PROPOSED OFFICE TENANCY ${tn}`, poly: r, level: li });
        if (k > 0) interior.push({ a: { x: x0, y: z[0].y }, b: { x: x0, y: z[2].y }, level: li });
      }
    });
    for (const z of zones) {
      const edge = p.corePos === 'rear' ? [{ x: 0, y: core[0].y }, { x: W, y: core[0].y }] : p.corePos === 'left' ? [{ x: core[1].x, y: 0 }, { x: core[1].x, y: D }] : p.corePos === 'right' ? [{ x: core[0].x, y: 0 }, { x: core[0].x, y: D }] : null;
      if (edge && z === zones[0]) interior.push({ a: edge[0], b: edge[1], level: li });
    }
    if (p.corePos === 'centre') interior.push({ a: { x: core[0].x, y: 0 }, b: { x: core[0].x, y: D }, level: li }, { a: { x: core[1].x, y: 0 }, b: { x: core[1].x, y: D }, level: li });
  }
  const doorX = zones[0][0].x + (zones[0][2].x - zones[0][0].x) / 2; // entry on the front of the first office zone
  const openings = [];
  const ww = 2400; const wh = 2100;
  for (let li = 0; li < p.storeys; li++) {
    for (const [side, L] of [['front', W], ['right', D], ['rear', W], ['left', D]]) {
      const want = Math.round(((p.glazingPct / 100) * L * H) / (ww * wh));
      const n = Math.min(Math.max(1, want), Math.floor(L / 2600));
      const gap = (L - n * ww) / (n + 1);
      for (let i = 0; i < n; i++) {
        const off = gap * (i + 1) + i * ww;
        if (li === 0 && side === 'front' && off < doorX + 1500 && off + ww > doorX - 1500) continue;
        openings.push({ wall: side, kind: 'window', offset: Math.round(off), width: ww, height: wh, sill: 800, level: li, style: 'fixed' });
      }
    }
  }
  openings.push({ wall: 'front', kind: 'door', offset: Math.round(doorX - 1100), width: 2200, height: 2400, sill: 0, level: 0 });
  openings.push({ wall: 'rear', kind: 'door', offset: Math.round(W / 2 - 500), width: 1000, height: 2100, sill: 0, level: 0 });
  const extras = [];
  if (p.canopy) extras.push(poly('canopy', rect(doorX - 4000, -3500, doorX + 4000, 0), 'ENTRY CANOPY'));
  const net = m2(W * D) * p.storeys - coreArea * p.storeys;
  const bays = Math.ceil(net / 40);
  if (p.parking === 'basement') extras.push(poly('basement-ramp', rect(0, -12000, 3500, 0), 'BASEMENT RAMP'));
  const top = H * p.storeys;
  const boxes = [{ x0: core[0].x, x1: core[2].x, y0: core[0].y, y1: core[2].y, z0: top, z1: top + 1800, slot: 'plant' }];
  if (p.canopy) {
    boxes.push({ x0: doorX - 4000, x1: doorX + 4000, y0: -3500, y1: 0, z0: 3000, z1: 3250, slot: 'canopy' });
    for (const dx of [-3800, 3800]) boxes.push({ x0: doorX + dx - 100, x1: doorX + dx + 100, y0: -3400, y1: -3200, z0: 0, z1: 3000, slot: 'steel' });
  }
  boxes.push({ x0: doorX - 1500, x1: doorX + 1500, y0: -60, y1: 0, z0: 3400, z1: 3900, slot: 'board' }); // blank sign panel, no logo
  const symbols = [symPoly(core, '#666', 'rgba(120,120,120,0.12)'), symText({ x: core[0].x + 400, y: core[0].y + 1200 }, `LIFT x${p.lifts}`), symLine([{ x: doorX, y: -1500 }, { x: doorX, y: 600 }], '#c33', { lw: 2 })];
  if (p.canopy) symbols.push(symPoly(rect(doorX - 4000, -3500, doorX + 4000, 0), '#777', 'rgba(0,0,0,0)', { dash: [6, 4] }));
  return {
    W, D, storeys: p.storeys, wallH: H, levels, rooms, interior, openings, extras, boxes, symbols, roofs: [{ type: 'flat', pitchDeg: 2 }],
    extraQuantities: { basementM2: p.parking === 'basement' ? bays * 30 : 0, coreM2: round1(coreArea * p.storeys), lifts: p.lifts },
    perUse: (gfa) => ({ office: round1(gfa - coreArea * p.storeys), core: round1(coreArea * p.storeys) }),
    site: (n) => ({
      parking: { ratePerM2: [{ use: 'office', per: 40, m2: round1(net) }], accessible: true, hint: n.parking === 'basement' ? `about ${bays} bays in a basement` : `about ${bays} bays at grade` },
      vehicles: { design: 'B99', apronDepthMm: 0, docks: 0 },
      landscapeFrontMm: n.parking === 'basement' ? 4500 : 3000,
      notes: ['Parking rate hint 1 per 40 m2 of office floor area; check with council.', n.parking === 'basement' ? 'Basement ramp grade and headroom to be confirmed by the traffic engineer.' : 'At grade parking uses site area, so check coverage.'],
    }),
  };
}

export default defineType({
  id: 'office', label: 'Office building', category: 'office', zonesHint: ['B3', 'B4', 'B5', 'E1', 'E2', 'MU1'],
  params, planLabel: 'PROPOSED OFFICE', buildRateKey: 'office', costNotes: 'Office, 1 to 3 storeys; basement parking costed separately. ESTIMATE, check current rates.', spec,
});
