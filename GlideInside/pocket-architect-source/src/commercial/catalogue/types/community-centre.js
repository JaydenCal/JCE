// Community floor plate: childcare centre or medical centre. Zones, fenced outdoor play area (childcare), drop-off bays, accessible entry.
import { defineType, NUM, SEL, rect, m2, round1, poly, symPoly, symLine, symText } from './_kit.js';

const params = [
  SEL('variant', 'Use', [{ value: 'childcare', label: 'Childcare centre' }, { value: 'medical', label: 'Medical centre' }], 'childcare'),
  NUM('places', 'Childcare places', 'children', 20, 120, 4, 60),
  NUM('consultRooms', 'Medical consulting rooms', '', 3, 20, 1, 6),
  NUM('dropOffBays', 'Drop-off bays', '', 2, 12, 1, 6),
  NUM('fenceH', 'Play area fence height', 'mm', 1200, 2100, 100, 1800),
];

function spec(p) {
  const child = p.variant === 'childcare';
  const gfa = child ? p.places * 3.25 * 1.5 : 60 + p.consultRooms * 14 * 1.4 + 40;
  const W = Math.round(Math.sqrt(gfa * 2.2) * 2) * 500;
  const D = (gfa * 1e6) / W;
  const H = 3300;
  const fd = D * 0.35; // front zone depth: reception, admin and amenities
  const n = child ? Math.ceil(p.places / 25) : p.consultRooms;
  const rooms = []; const interior = []; const openings = [];
  const fz = child ? ['PROPOSED RECEPTION AND ENTRY', 'PROPOSED STAFF ROOM AND KITCHEN', 'PROPOSED AMENITIES'] : ['PROPOSED WAITING AND RECEPTION', 'PROPOSED TREATMENT ROOM', 'PROPOSED AMENITIES'];
  const fx = [0, W * 0.4, W * 0.7, W];
  fz.forEach((name, i) => rooms.push({ name, poly: rect(fx[i], 0, fx[i + 1], fd), level: 0 }));
  interior.push({ a: { x: 0, y: fd }, b: { x: W, y: fd }, thickness: 100 }, { a: { x: fx[1], y: 0 }, b: { x: fx[1], y: fd }, thickness: 100 }, { a: { x: fx[2], y: 0 }, b: { x: fx[2], y: fd }, thickness: 100 });
  const rw = W / n;
  for (let i = 0; i < n; i++) {
    rooms.push({ name: child ? `PROPOSED ACTIVITY ROOM ${i + 1}` : `PROPOSED CONSULTING ROOM ${i + 1}`, poly: rect(i * rw, fd, (i + 1) * rw, D), level: 0 });
    if (i > 0) interior.push({ a: { x: i * rw, y: fd }, b: { x: i * rw, y: D }, thickness: 100 });
    openings.push(child ? { wall: 'rear', kind: 'door', offset: Math.round(i * rw + rw / 2 - 900), width: 1800, height: 2400, sill: 0 } : { wall: 'rear', kind: 'window', offset: Math.round(i * rw + rw / 2 - 600), width: 1200, height: 1500, sill: 900, style: 'fixed' });
    if (child) openings.push({ wall: 'rear', kind: 'window', offset: Math.round(i * rw + 300), width: Math.max(900, Math.round(rw / 2 - 1300)), height: 1800, sill: 600, style: 'fixed' });
  }
  const entryX = W * 0.2;
  openings.push({ wall: 'front', kind: 'door', offset: Math.round(entryX - 900), width: 1800, height: 2400, sill: 0 }); // accessible entry, clear width above 1.0 m
  openings.push({ wall: 'front', kind: 'window', offset: Math.round(W * 0.4 + 800), width: Math.round(W * 0.3 - 1600), height: 1500, sill: 900, style: 'fixed' });
  openings.push({ wall: 'left', kind: 'door', offset: Math.round(fd / 2 - 500), width: 1000, height: 2100, sill: 0 });
  const bayW = 2600; const bayD = 5400;
  const bays = p.dropOffBays;
  const extras = [poly('drop-off-bays', rect(0, -bayD - 1500, bays * bayW, -1500), 'DROP-OFF BAYS'), poly('accessible-path', rect(entryX - 900, -1500, entryX + 900, 0), 'ACCESSIBLE ENTRY PATH')];
  let playM2 = 0;
  const boxes = [{ x0: entryX - 2500, x1: entryX + 2500, y0: -2500, y1: 0, z0: 2900, z1: 3100, slot: 'canopy' }, { x0: entryX - 1500, x1: entryX + 1500, y0: -60, y1: 0, z0: 3300, z1: 3800, slot: 'board' }];
  const symbols = [symPoly(rect(0, -bayD - 1500, bays * bayW, -1500), '#777', 'rgba(60,60,60,0.10)'), symLine([{ x: entryX, y: -1500 }, { x: entryX, y: 500 }], '#c33', { lw: 2 }), symText({ x: entryX + 1000, y: -700 }, 'ACCESSIBLE ENTRY')];
  for (let i = 1; i < bays; i++) symbols.push(symLine([{ x: i * bayW, y: -bayD - 1500 }, { x: i * bayW, y: -1500 }], '#999'));
  if (child) {
    playM2 = p.places * 7;
    const pd = Math.max(6000, (playM2 * 1e6) / W);
    extras.push(poly('play-area-fenced', rect(0, D, W, D + pd), 'FENCED OUTDOOR PLAY AREA'));
    const f = p.fenceH;
    boxes.push({ x0: 0, x1: W, y0: D + pd - 50, y1: D + pd, z0: 0, z1: f, slot: 'steel' }, { x0: 0, x1: 50, y0: D, y1: D + pd, z0: 0, z1: f, slot: 'steel' }, { x0: W - 50, x1: W, y0: D, y1: D + pd, z0: 0, z1: f, slot: 'steel' });
    boxes.push({ x0: W * 0.1, x1: W * 0.1 + 6000, y0: D + 1500, y1: D + 7500, z0: 2800, z1: 2950, slot: 'canopy' }); // shade structure
    for (const [cx, cy] of [[W * 0.1 + 200, D + 1700], [W * 0.1 + 5800, D + 1700], [W * 0.1 + 200, D + 7300], [W * 0.1 + 5800, D + 7300]]) boxes.push({ x0: cx - 100, x1: cx + 100, y0: cy - 100, y1: cy + 100, z0: 0, z1: 2800, slot: 'steel' });
    boxes.push({ x0: W * 0.55, x1: W * 0.55 + 3000, y0: D + 2000, y1: D + 3200, z0: 0, z1: 1800, slot: 'furniture' }, { x0: W * 0.55 + 4000, x1: W * 0.55 + 6000, y0: D + 2000, y1: D + 4000, z0: 0, z1: 300, slot: 'concrete' }, { x0: W * 0.55 + 1000, x1: W * 0.55 + 2200, y0: D + 5000, y1: D + 5600, z0: 0, z1: 450, slot: 'furniture' });
    symbols.push(symPoly(rect(0, D, W, D + pd), '#3a7d44', 'rgba(80,160,90,0.12)', { dash: [6, 4] }), symText({ x: 800, y: D + pd / 2 }, `PLAY AREA ${round1(playM2)} m2`));
  }
  const zoneM2 = m2(W * fd);
  return {
    W, D, storeys: 1, wallH: H, rooms, interior, openings, extras, boxes, symbols, roofs: [{ type: 'skillion', pitchDeg: 5 }],
    extraQuantities: { rooms: n, dropOffBays: bays, playAreaM2: round1(playM2), places: child ? p.places : 0, consultRooms: child ? 0 : p.consultRooms },
    perUse: () => ({ [child ? 'childcare' : 'medical']: round1(m2(W * D) - zoneM2), reception: round1(zoneM2) }),
    site: (nn) => ({
      parking: { ratePerM2: [{ use: child ? 'childcare centre' : 'medical centre', per: Math.round(child ? m2(W * D) / (nn.places / 4) : m2(W * D) / (nn.consultRooms * 3)), m2: round1(m2(W * D)) }], accessible: true },
      vehicles: { design: 'B99', apronDepthMm: 0, docks: 0 },
      landscapeFrontMm: 2000,
      notes: [child ? 'Parking hint 1 bay per 4 children, with a separate drop-off zone; check with council.' : 'Parking hint 3 bays per consulting room; check with council.', child ? 'Indoor 3.25 m2 and outdoor 7 m2 per child are indicative regulatory minimums, UNVERIFIED here: confirm against the current education and care regulations.' : 'Accessible entry and WC provision to be confirmed against the current standards.'],
    }),
  };
}

export default defineType({
  id: 'community-centre', label: 'Childcare or medical centre', category: 'community', zonesHint: ['E1', 'E3', 'R3', 'R4', 'B1', 'B2', 'SP2'],
  params, planLabel: 'PROPOSED COMMUNITY FACILITY', buildRateKey: 'community', costNotes: 'Single storey childcare or medical fitout; play area landscaping extra. ESTIMATE, check current rates.', spec,
});
