// Business park unit block (light industrial units with a front office, roller door and rear store) and a mixed-use building (shops below,
// homes above). Local plan mm, front on y = 0 facing the street. Built through the shared kit.
import { defineType, NUM, SEL, BOOL, rect, m2, round1, poly, symPoly, symLine, symText } from './_kit.js';

export const businessPark = (() => {
  const params = [
    NUM('units', 'Number of units', '', 2, 20, 1, 6), NUM('unitW', 'Unit width', 'mm', 5000, 15000, 500, 7500), NUM('D', 'Unit depth', 'mm', 12000, 45000, 500, 24000),
    NUM('H', 'Eave height', 'mm', 4500, 10000, 500, 7000), NUM('roofPitchDeg', 'Roof pitch', 'deg', 2, 20, 0.5, 5),
    NUM('officeD', 'Front office depth', 'mm', 3000, 9000, 500, 5000), NUM('doorW', 'Roller door width', 'mm', 3000, 5400, 100, 3600), NUM('doorH', 'Roller door height', 'mm', 3000, 5400, 100, 4200),
    SEL('doorSide', 'Roller door in', [{ value: 'front', label: 'Front wall' }, { value: 'rear', label: 'Rear wall' }], 'front'),
    NUM('apronD', 'Shared truck apron depth', 'mm', 0, 30000, 500, 15000), BOOL('awning', 'Front awning over the entries', true),
  ];
  const base = defineType({
    id: 'business-park', label: 'Business park unit block', category: 'industrial', zonesHint: ['E4', 'E5', 'IN1', 'IN2', 'MU1'], params, planLabel: 'PROPOSED BUSINESS PARK UNITS',
    buildRateKey: 'business-park', costNotes: 'Light industrial units with a front office each. ESTIMATE, check current rates.',
    spec(p) {
      const { units: N, unitW: uw, D, H } = p;
      const W = N * uw;
      const oD = Math.min(p.officeD, D / 2);
      const rooms = []; const interior = []; const openings = []; const boxes = []; const extras = [];
      const dw = Math.min(p.doorW, uw - 1800);
      const dh = Math.min(p.doorH, H - 300);
      for (let i = 0; i < N; i++) {
        const x0 = i * uw; const x1 = x0 + uw;
        rooms.push({ name: `PROPOSED UNIT ${i + 1} OFFICE`, poly: rect(x0, 0, x1, oD), level: 0 }, { name: `PROPOSED UNIT ${i + 1} WAREHOUSE`, poly: rect(x0, oD, x1, D), level: 0 });
        if (i > 0) interior.push({ a: { x: x0, y: 0 }, b: { x: x0, y: D }, thickness: 200 });
        interior.push({ a: { x: x0, y: oD }, b: { x: x1, y: oD }, thickness: 100 });
        const rollerFront = p.doorSide === 'front';
        openings.push({ wall: 'front', kind: 'door', offset: x0 + (rollerFront ? 300 : 500), width: 1000, height: 2100, sill: 0 });
        if (rollerFront) {
          const rx = x0 + uw - 300 - dw;
          openings.push({ wall: 'front', kind: 'roller_door', offset: rx, width: dw, height: dh, sill: 0 });
          if (rx - (x0 + 1500) >= 1100) openings.push({ wall: 'front', kind: 'window', offset: x0 + 1500, width: rx - (x0 + 1500) - 200, height: 1500, sill: 900, style: 'fixed' });
          openings.push({ wall: 'rear', kind: 'door', offset: x0 + 1000, width: 920, height: 2040, sill: 0 });
        } else {
          openings.push({ wall: 'front', kind: 'window', offset: x0 + 1800, width: Math.max(1200, uw - 2400), height: 1500, sill: 900, style: 'fixed' });
          openings.push({ wall: 'rear', kind: 'roller_door', offset: x0 + 300, width: dw, height: dh, sill: 0 }, { wall: 'rear', kind: 'door', offset: x0 + uw - 1400, width: 920, height: 2040, sill: 0 });
        }
      }
      if (p.apronD > 0) extras.push(poly('apron', rect(0, -p.apronD, W, 0), 'SHARED TRUCK APRON'));
      if (p.awning) { extras.push(poly('awning', rect(0, -2500, W, 0), 'ENTRY AWNING')); boxes.push({ x0: 0, x1: W, y0: -2500, y1: 0, z0: 3200, z1: 3350, slot: 'canopy' }); for (let i = 0; i <= N; i++) boxes.push({ x0: Math.min(W - 150, i * uw), x1: Math.min(W, i * uw + 150), y0: -2400, y1: -2250, z0: 0, z1: 3200, slot: 'steel' }); }
      boxes.push({ x0: 0, x1: W, y0: -100, y1: 0, z0: H - 100, z1: H + 100, slot: 'panel' });
      const symbols = [symPoly(rect(0, 0, W, D), '#555', 'rgba(120,120,120,0.08)'), symLine([{ x: W / 2, y: -1500 }, { x: W / 2, y: 500 }], '#c33', { lw: 2 })];
      for (let i = 1; i < N; i++) symbols.push(symLine([{ x: i * uw, y: 0 }, { x: i * uw, y: D }], '#222', { lw: 3 }));
      for (let i = 0; i < N; i++) symbols.push(symText({ x: i * uw + uw * 0.1, y: D / 2 }, `UNIT ${i + 1}`), symLine([{ x: i * uw, y: oD }, { x: (i + 1) * uw, y: oD }], '#888', { dash: [8, 6] }));
      const officeM2 = m2(W * oD);
      const gfa = m2(W * D);
      return {
        W, D, storeys: 1, wallH: H, extWallMm: 200, rooms, interior, openings, extras, boxes, symbols, roofs: [{ type: 'skillion', pitchDeg: p.roofPitchDeg }],
        extraQuantities: { units: N, unitM2: round1(m2(uw * D)) },
        perUse: () => ({ office: round1(officeM2), warehouse: round1(gfa - officeM2) }),
        site: () => ({
          parking: { ratePerM2: [{ use: 'light industry or warehouse', per: 100, m2: round1(gfa - officeM2) }, { use: 'unit office', per: 40, m2: round1(officeM2) }], accessible: true },
          vehicles: { design: 'MRV', apronDepthMm: p.apronD, docks: 0 },
          landscapeFrontMm: 3000,
          notes: ['Each unit has its own office, roller door and rear store. Parking rate depends on how the council treats the use, check with council.', 'Truck apron sized for a medium rigid vehicle turning path; confirm by swept path.'],
        }),
      };
    },
  });
  return {
    ...base,
    presets: [{ id: 'four', label: 'Four units 7.5 x 24 m', params: { units: 4 } }, { id: 'standard', label: 'Six units 7.5 x 24 m', params: {} }, { id: 'small-units', label: 'Eight small units 6 x 18 m', params: { units: 8, unitW: 6000, D: 18000, H: 6000, doorW: 3000, doorH: 3600 } }, { id: 'large', label: 'Ten large units 10 x 30 m', params: { units: 10, unitW: 10000, D: 30000, H: 8000, doorW: 4800, doorH: 4800, apronD: 20000 } }],
  };
})();

export const mixedUse = (() => {
  const params = [
    NUM('shops', 'Shops on the ground floor', '', 2, 12, 1, 4), NUM('shopW', 'Shop width', 'mm', 5000, 12000, 500, 6500), NUM('D', 'Building depth', 'mm', 12000, 30000, 500, 18000),
    NUM('levelsAbove', 'Levels of homes above', '', 1, 3, 1, 1), NUM('H', 'Storey height', 'mm', 3000, 4200, 100, 3600),
    NUM('roofPitchDeg', 'Roof pitch', 'deg', 2, 25, 0.5, 5), BOOL('awning', 'Continuous awning', true), NUM('awningDepth', 'Awning depth', 'mm', 2000, 4000, 100, 3000),
    BOOL('balconies', 'Balconies to the street', true), BOOL('serviceLane', 'Rear service lane', true), NUM('laneW', 'Service lane width', 'mm', 5000, 9000, 500, 6000),
    NUM('shopParkingPer', 'Shop parking: one bay per this floor area (check with council)', 'm2', 15, 60, 1, 30), NUM('homeBays', 'Home parking, bays per home (check with council)', '', 0.5, 2.5, 0.1, 1.5),
  ];
  const base = defineType({
    id: 'mixed-use', label: 'Mixed use, shops below and homes above', category: 'residential', zonesHint: ['E1', 'B1', 'B2', 'B4', 'MU1', 'R3', 'R4'], params, planLabel: 'PROPOSED MIXED USE BUILDING',
    buildRateKey: 'mixed-use', costNotes: 'Shop shells below with apartments above. ESTIMATE, check current rates.',
    spec(p) {
      const { shops: N, shopW: sw, D, H } = p;
      const W = N * sw;
      const st = 1 + p.levelsAbove;
      const rooms = []; const interior = []; const openings = []; const boxes = []; const extras = [];
      for (let l = 0; l < st; l++) {
        for (let i = 0; i < N; i++) {
          const x0 = i * sw; const x1 = x0 + sw;
          rooms.push({ name: l === 0 ? `PROPOSED SHOP ${i + 1}` : `PROPOSED HOME ${i + 1} LEVEL ${l}`, poly: rect(x0, 0, x1, D), level: l });
          if (i > 0) interior.push({ a: { x: x0, y: 0 }, b: { x: x0, y: D }, thickness: 200, level: l });
        }
      }
      const ew = 1100; // the home entry beside each shop door
      for (let i = 0; i < N; i++) {
        const x0 = i * sw;
        openings.push({ wall: 'front', kind: 'door', offset: x0 + 300, width: ew, height: 2100, sill: 0 }, { wall: 'front', kind: 'door', offset: x0 + 300 + ew + 200, width: 1500, height: 2400, sill: 0 });
        openings.push({ wall: 'front', kind: 'window', offset: x0 + 300 + ew + 200 + 1500 + 150, width: Math.max(1200, sw - ew - 1500 - 1000), height: 2400, sill: 600, style: 'fixed' });
        openings.push({ wall: 'rear', kind: 'door', offset: x0 + Math.round(sw / 2 - 500), width: 1000, height: 2100, sill: 0 });
        for (let l = 1; l < st; l++) {
          openings.push({ wall: 'front', kind: p.balconies ? 'sliding_door' : 'window', offset: x0 + Math.round(sw / 2 - 1000), width: 2000, height: p.balconies ? 2100 : 1500, sill: p.balconies ? 0 : 900, style: 'fixed', level: l });
          openings.push({ wall: 'rear', kind: 'window', offset: x0 + Math.round(sw / 2 - 600), width: 1200, height: 1200, sill: 900, style: 'fixed', level: l });
          if (p.balconies) boxes.push({ x0: x0 + 400, x1: x0 + sw - 400, y0: -1500, y1: 0, z0: l * H - 150, z1: l * H, slot: 'concrete' }, { x0: x0 + 400, x1: x0 + sw - 400, y0: -1500, y1: -1440, z0: l * H, z1: l * H + 1000, slot: 'glass' });
        }
      }
      if (p.awning) { extras.push(poly('awning', rect(0, -p.awningDepth, W, 0), 'CONTINUOUS AWNING')); boxes.push({ x0: 0, x1: W, y0: -p.awningDepth, y1: 0, z0: 3200, z1: 3400, slot: 'canopy' }); for (let i = 0; i <= N; i++) boxes.push({ x0: Math.min(W - 150, i * sw), x1: Math.min(W, i * sw + 150), y0: -p.awningDepth + 100, y1: -p.awningDepth + 250, z0: 0, z1: 3200, slot: 'steel' }); }
      if (p.serviceLane) extras.push(poly('service-lane', rect(0, D, W, D + p.laneW), 'REAR SERVICE LANE'));
      const symbols = [symPoly(rect(0, 0, W, D), '#555', 'rgba(120,120,120,0.08)'), symLine([{ x: W / 2, y: -1500 }, { x: W / 2, y: 500 }], '#c33', { lw: 2 })];
      for (let i = 1; i < N; i++) symbols.push(symLine([{ x: i * sw, y: 0 }, { x: i * sw, y: D }], '#222', { lw: 3 }));
      if (p.serviceLane) symbols.push(symLine([{ x: 0, y: D + p.laneW / 2 }, { x: W, y: D + p.laneW / 2 }], '#888', { dash: [10, 8] }), symText({ x: 600, y: D + p.laneW / 2 - 300 }, 'SERVICE LANE'));
      symbols.push(symText({ x: W * 0.02, y: D * 0.06 }, 'SHOPS BELOW, HOMES ABOVE'));
      const retailM2 = m2(W * D);
      const homesM2 = retailM2 * p.levelsAbove;
      const homes = N * p.levelsAbove;
      return {
        W, D, storeys: st, wallH: H, extWallMm: 250, rooms, interior, openings, extras, boxes, symbols, roofs: [{ type: 'skillion', pitchDeg: p.roofPitchDeg }],
        extraQuantities: { shops: N, homes },
        perUse: () => ({ retail: round1(retailM2), residential: round1(homesM2) }),
        site: (n2) => ({
          parking: { ratePerM2: [{ use: 'shops', per: n2.shopParkingPer, m2: round1(retailM2) }, { use: 'homes', per: Math.max(1, homesM2 / Math.max(0.1, homes * n2.homeBays)), m2: round1(homesM2) }], accessible: true },
          vehicles: { design: 'MRV', apronDepthMm: p.serviceLane ? p.laneW : 0, docks: 0 },
          landscapeFrontMm: 0,
          notes: ['Shops below and homes above. Default rates 1 bay per 30 m2 of shop and 1.5 per home; check with council, rates differ by council.', 'Separate entries for the homes keep them out of the shops. Fire separation and acoustic ratings between uses are not checked here.'],
        }),
      };
    },
  });
  return {
    ...base,
    presets: [{ id: 'small', label: 'Small 3 shops, 1 level above', params: { shops: 3 } }, { id: 'standard', label: '4 shops, 1 level above', params: { shops: 4 } }, { id: 'two-levels', label: '5 shops, 2 levels above', params: { shops: 5, levelsAbove: 2 } }, { id: 'large', label: '8 shops, 3 levels above', params: { shops: 8, levelsAbove: 3, D: 22000 } }],
  };
})();

export const TYPES_BUSINESS_MIXED = [businessPark, mixedUse];
export default TYPES_BUSINESS_MIXED;
