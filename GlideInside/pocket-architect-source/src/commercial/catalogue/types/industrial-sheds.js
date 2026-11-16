// Large industrial sheds: a clear-span shed with roller doors and a small front office, and a machinery shed with an open front bay.
// Local plan mm, front on y = 0 facing the street. Built through the shared kit.
import { defineType, NUM, BOOL, rect, m2, round1, poly, symPoly, symLine, symText } from './_kit.js';
import { doorOffsets, fitDoors, doorParams, planSymbols, noParkingSite } from './_kitD.js';

const tanR = (deg) => Math.tan((deg * Math.PI) / 180);

export const clearSpanShed = (() => {
  const params = [
    NUM('W', 'Clear span (width)', 'mm', 12000, 60000, 500, 24000), NUM('D', 'Length', 'mm', 12000, 150000, 500, 45000), NUM('H', 'Eave height', 'mm', 4000, 14000, 500, 8000),
    NUM('roofPitchDeg', 'Roof pitch', 'deg', 2, 25, 0.5, 7.5),
    ...doorParams(2, 4800, 4800, 8).map((x) => (x.key === 'doorH' ? { ...x, min: 3500, max: 7000 } : x)),
    NUM('sideDoors', 'Roller doors per long side', '', 0, 6, 1, 0),
    BOOL('office', 'Small office at the front corner', true), NUM('officeW', 'Office width', 'mm', 4000, 12000, 500, 8000), NUM('officeD', 'Office depth', 'mm', 4000, 12000, 500, 6000),
    NUM('yardDepth', 'Truck apron depth', 'mm', 0, 40000, 500, 20000), NUM('parkingPer', 'Parking rate: one bay per this floor area (check with council)', 'm2', 50, 400, 10, 100),
  ];
  const base = defineType({
    id: 'clear-span-shed', label: 'Clear-span industrial shed', category: 'industrial', zonesHint: ['E4', 'E5', 'IN1', 'IN2', 'RU1', 'RU5'], params, planLabel: 'PROPOSED INDUSTRIAL SHED',
    buildRateKey: 'shed', costNotes: 'Large clear-span steel portal shed with a small office. ESTIMATE, check current rates.',
    spec(p) {
      const { W, D, H } = p;
      const dw = Math.min(p.doorW, W - 1200);
      const dh = Math.min(p.doorH, H - 200);
      const oW = Math.min(p.officeW, W / 2);
      const oD = Math.min(p.officeD, D / 2);
      const x0 = p.office ? oW + 300 : 0; // the office stands in the front left corner, so the roller doors sit to its right
      const n = fitDoors(p.doorCount, W - x0, dw, 1000);
      const openings = doorOffsets(n, W - x0, dw, p.doorPos, 1000).map((off) => ({ wall: 'front', kind: 'roller_door', offset: x0 + off, width: dw, height: dh, sill: 0 }));
      const sn = fitDoors(p.sideDoors, D, dw, 3000);
      for (const off of doorOffsets(sn, D, dw, 'spread', 3000)) { openings.push({ wall: 'left', kind: 'roller_door', offset: off, width: dw, height: dh, sill: 0 }, { wall: 'right', kind: 'roller_door', offset: off, width: dw, height: dh, sill: 0 }); }
      openings.push({ wall: 'rear', kind: 'door', offset: 2000, width: 920, height: 2040, sill: 0 });
      const rooms = [];
      const interior = [];
      const extras = [];
      const boxes = [];
      let officeM2 = 0;
      if (p.office) {
        officeM2 = m2(oW * oD);
        rooms.push({ name: 'PROPOSED OFFICE', poly: rect(0, 0, oW, oD), level: 0 }, { name: 'PROPOSED SHED', poly: [{ x: oW, y: 0 }, { x: W, y: 0 }, { x: W, y: D }, { x: 0, y: D }, { x: 0, y: oD }, { x: oW, y: oD }], level: 0 });
        interior.push({ a: { x: oW, y: 0 }, b: { x: oW, y: oD }, thickness: 100 }, { a: { x: 0, y: oD }, b: { x: oW, y: oD }, thickness: 100 });
        openings.push({ wall: 'front', kind: 'door', offset: 600, width: 1000, height: 2100, sill: 0 }, { wall: 'front', kind: 'window', offset: 2200, width: Math.max(1200, oW - 3200), height: 1200, sill: 900, style: 'fixed' });
      } else rooms.push({ name: 'PROPOSED SHED', poly: rect(0, 0, W, D), level: 0 });
      if (p.yardDepth > 0) extras.push(poly('apron', rect(0, -p.yardDepth, W, 0), 'TRUCK APRON'));
      // columns at each bay line on both long walls, rafter ridge beam
      const bays = Math.max(1, Math.round(D / 7500));
      for (let i = 0; i <= bays; i++) { const y = Math.min(D - 150, Math.max(150, (D * i) / bays)); boxes.push({ x0: -50, x1: 150, y0: y - 150, y1: y + 150, z0: 0, z1: H, slot: 'steel' }, { x0: W - 150, x1: W + 50, y0: y - 150, y1: y + 150, z0: 0, z1: H, slot: 'steel' }); }
      boxes.push({ x0: -120, x1: W + 120, y0: -120, y1: 0, z0: H - 100, z1: H + 40, slot: 'steel' });
      const symbols = planSymbols(W, D, `CLEAR-SPAN SHED ${(W / 1000).toFixed(0)} x ${(D / 1000).toFixed(0)} m`);
      for (let i = 1; i < bays; i++) symbols.push(symLine([{ x: 0, y: (D * i) / bays }, { x: W, y: (D * i) / bays }], '#aaa', { dash: [10, 12] }));
      const gfa = m2(W * D);
      return {
        W, D, storeys: 1, wallH: H, extWallMm: 150, rooms, interior, openings, extras, boxes, symbols, roofs: [{ type: 'gable', pitchDeg: p.roofPitchDeg }],
        extraQuantities: { bayCount: bays, spanM: W / 1000, lengthM: D / 1000, ridgeHeightM: round1((H + (W / 2) * tanR(p.roofPitchDeg)) / 1000) },
        perUse: () => ({ shed: round1(gfa - officeM2), office: round1(officeM2) }),
        site: (n2) => ({
          parking: { ratePerM2: [{ use: 'industry or warehouse', per: n2.parkingPer, m2: round1(gfa - officeM2) }, ...(officeM2 ? [{ use: 'office', per: 40, m2: round1(officeM2) }] : [])], accessible: true },
          vehicles: { design: W >= 24000 ? 'HRV' : 'MRV', apronDepthMm: n2.yardDepth, docks: 0 },
          landscapeFrontMm: 3000,
          notes: ['Parking rate depends on whether the council treats the use as industry or warehouse, check with council', 'Truck apron sized for a heavy rigid vehicle turning path; confirm by swept path.'],
        }),
      };
    },
  });
  return {
    ...base,
    presets: [{ id: 'small', label: 'Small 15 x 30 m', params: { W: 15000, D: 30000, H: 6000, doorCount: 1, doorW: 4200, doorH: 4200, yardDepth: 15000 } }, { id: 'standard', label: 'Standard 24 x 45 m', params: {} },
      { id: 'large', label: 'Large 36 x 72 m', params: { W: 36000, D: 72000, H: 10000, doorCount: 3, doorW: 5400, doorH: 5400, sideDoors: 2, yardDepth: 30000 } }, { id: 'huge', label: 'Very large 48 x 120 m', params: { W: 48000, D: 120000, H: 12000, doorCount: 4, doorW: 6000, doorH: 6000, sideDoors: 3, yardDepth: 35000 } }],
  };
})();

export const machineryShed = (() => {
  const params = [
    NUM('W', 'Width', 'mm', 8000, 40000, 500, 18000), NUM('D', 'Depth', 'mm', 8000, 60000, 500, 18000), NUM('H', 'Clear height at the eaves', 'mm', 4000, 9000, 500, 5000),
    NUM('roofPitchDeg', 'Roof pitch', 'deg', 2, 25, 0.5, 10), NUM('closedDepth', 'Enclosed store at the rear (0 for all open)', 'mm', 0, 20000, 500, 6000),
    NUM('posts', 'Posts along the front', '', 2, 12, 1, 4), BOOL('rearDoor', 'Roller door into the enclosed store', true), BOOL('apron', 'Gravel hardstand in front', true),
  ];
  const base = defineType({
    id: 'machinery-shed', label: 'Machinery shed with open bay', category: 'industrial', zonesHint: ['RU1', 'RU2', 'RU5', 'R5', 'E3', 'E4', 'IN1', 'IN2', 'IN4'], params,
    planLabel: 'PROPOSED MACHINERY SHED', buildRateKey: 'shed-small', costNotes: 'Open fronted steel machinery shed. ESTIMATE, check current rates.',
    spec(p) {
      const { W, D, H } = p;
      const closed = Math.min(p.closedDepth, D - 4000);
      const openD = D - closed;
      const openings = [{ wall: 'front', kind: 'opening', offset: 100, width: W - 200, height: H - 250, sill: 0 }];
      for (const wall of ['left', 'right']) openings.push({ wall, kind: 'opening', offset: 100, width: Math.max(1000, openD - 200), height: H - 250, sill: 0 });
      const interior = [];
      const rooms = [{ name: 'PROPOSED MACHINERY BAY', poly: rect(0, 0, W, openD), level: 0, outdoor: true }];
      let closedM2 = 0;
      if (closed > 0) {
        rooms.push({ name: 'PROPOSED STORE', poly: rect(0, openD, W, D), level: 0 });
        interior.push({ a: { x: 0, y: openD }, b: { x: W, y: openD }, thickness: 150 });
        closedM2 = m2(W * closed);
        if (p.rearDoor) openings.push({ wall: 'rear', kind: 'roller_door', offset: Math.round((W / 2 - 2400) / 50) * 50, width: 4800, height: Math.min(4200, H - 200), sill: 0 }, { wall: 'right', kind: 'door', offset: openD + 1200, width: 920, height: 2040, sill: 0 });
      } else openings.push({ wall: 'rear', kind: 'door', offset: 2000, width: 920, height: 2040, sill: 0 });
      const boxes = [{ x0: -120, x1: W + 120, y0: -120, y1: 0, z0: H - 100, z1: H + 40, slot: 'steel' }];
      const post = (x, y) => ({ x0: x - 150, x1: x + 150, y0: y - 150, y1: y + 150, z0: 0, z1: H, slot: 'steel' });
      for (let i = 0; i < p.posts; i++) boxes.push(post(150 + ((W - 300) * i) / (p.posts - 1), 150));
      if (p.apron) boxes.push({ x0: 0, x1: W, y0: -8000, y1: 0, z0: 0, z1: 40, slot: 'asphalt' });
      const symbols = planSymbols(W, D, 'MACHINERY SHED', [symLine([{ x: 0, y: openD }, { x: W, y: openD }], '#333', { lw: 3 }), symPoly(rect(0, 0, W, openD), '#777', 'rgba(0,0,0,0)', { dash: [10, 6] })]);
      const gfa = m2(W * D);
      return {
        W, D, storeys: 1, wallH: H, extWallMm: 150, rooms, interior, openings, extras: p.apron ? [poly('apron', rect(0, -8000, W, 0), 'HARDSTAND')] : [], boxes, symbols,
        roofs: [{ type: 'gable', pitchDeg: p.roofPitchDeg }], extraQuantities: { openBayM2: round1(m2(W * openD)), ridgeHeightM: round1((H + (W / 2) * tanR(p.roofPitchDeg)) / 1000) },
        perUse: () => ({ machinery: round1(gfa - closedM2), store: round1(closedM2) }),
        site: noParkingSite(['No customer parking is required for a farm or plant machinery shed. Hardstand sized for a heavy rigid vehicle, confirm by swept path.', 'The open bay is roofed area and counts as covered area for coverage.'], { design: 'HRV', apron: p.apron ? 8000 : 0, landscape: 2000 }),
      };
    },
  });
  return {
    ...base,
    presets: [{ id: 'small', label: 'Small 12 x 12 m', params: { W: 12000, D: 12000, H: 4500, closedDepth: 0, posts: 3 } }, { id: 'standard', label: 'Standard 18 x 18 m', params: {} },
      { id: 'large', label: 'Large 30 x 24 m', params: { W: 30000, D: 24000, H: 6000, closedDepth: 8000, posts: 6 } }, { id: 'open', label: 'All open hay shed 24 x 15 m', params: { W: 24000, D: 15000, closedDepth: 0, posts: 5, apron: false } }],
  };
})();

export const TYPES_INDUSTRIAL_SHEDS = [clearSpanShed, machineryShed];
export default TYPES_INDUSTRIAL_SHEDS;
