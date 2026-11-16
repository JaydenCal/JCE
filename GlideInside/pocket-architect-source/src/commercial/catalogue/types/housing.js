// Attached housing: a duplex (dual occupancy), a townhouse row and a terrace row. Each dwelling is one bay of the row with its own front door,
// optional garage door, party walls on every level and a private yard at the rear. Local plan mm, front on y = 0 facing the street.
import { defineType, NUM, SEL, BOOL, rect, m2, round1, poly, symPoly, symLine, symText } from './_kit.js';

const GARAGE = [{ value: 'none', label: 'No garage' }, { value: 'single', label: 'Single garage each' }, { value: 'double', label: 'Double garage each' }];
const ZONES = ['R1', 'R2', 'R3', 'R4', 'MU1', 'B1', 'B2', 'B4', 'E1'];

function housingType({ id, label, planLabel, dwMin, dwMax, dwDef, fixedDw, unitW, unitWMin, unitWMax, depth, storeys, garage, yard, lane, presets, visitors = 1 / 3, blurb }) {
  const params = [
    ...(fixedDw ? [] : [NUM('dwellings', 'Number of dwellings', '', dwMin, dwMax, 1, dwDef)]),
    NUM('unitW', 'Dwelling width', 'mm', unitWMin, unitWMax, 100, unitW),
    NUM('D', 'Dwelling depth', 'mm', 8000, 24000, 500, depth),
    NUM('storeys', 'Storeys', '', 1, 3, 1, storeys),
    NUM('H', 'Storey height', 'mm', 2500, 3600, 100, 2700),
    NUM('roofPitchDeg', 'Roof pitch', 'deg', 3, 40, 0.5, 22.5),
    SEL('garage', 'Garage', GARAGE, garage),
    SEL('doorKind', 'Garage door type', [{ value: 'sectional', label: 'Sectional (panel lift) door' }, { value: 'roller', label: 'Roller door' }], 'sectional'),
    NUM('yardD', 'Private yard depth at the rear', 'mm', 0, 15000, 500, yard),
    ...(lane !== undefined ? [BOOL('rearLane', 'Rear lane', lane), NUM('laneW', 'Rear lane width', 'mm', 3000, 8000, 500, 5500)] : []),
    NUM('parkingFactor', 'Visitor and extra parking, bays per dwelling (check with council)', '', 0, 2, 0.1, Math.round(visitors * 10) / 10),
  ];
  const base = defineType({
    id, label, category: 'residential', zonesHint: ZONES, params, planLabel, buildRateKey: 'townhouse', costNotes: `${label}, structure and fitout of the dwellings. ESTIMATE, check current rates.`,
    spec(p) {
      const N = fixedDw ? 2 : p.dwellings;
      const { unitW: uw, D, H, storeys: st } = p;
      const W = N * uw;
      const gw = p.garage === 'double' ? 5400 : p.garage === 'single' ? 2800 : 0;
      const hasGarage = gw > 0 && uw - 1000 - 1200 >= gw; // door leaves room for the front door
      const dk = p.doorKind === 'roller' ? 'roller_door' : 'garage_door';
      const rooms = []; const interior = []; const openings = []; const extras = []; const boxes = [];
      for (let i = 0; i < N; i++) {
        const x0 = i * uw; const x1 = x0 + uw;
        for (let l = 0; l < st; l++) {
          rooms.push({ name: `PROPOSED DWELLING ${i + 1} ${l === 0 ? 'GROUND' : `LEVEL ${l}`}`, poly: rect(x0, 0, x1, D), level: l });
          if (i > 0) interior.push({ a: { x: x0, y: 0 }, b: { x: x0, y: D }, thickness: 250, level: l });
        }
        const doorX = hasGarage ? x0 + 400 : x0 + Math.round(uw / 2 - 500);
        openings.push({ wall: 'front', kind: 'door', offset: doorX, width: 1000, height: 2100, sill: 0 });
        if (hasGarage) openings.push({ wall: 'front', kind: dk, offset: x1 - 300 - gw, width: gw, height: Math.min(2400, H - 200), sill: 0 });
        else openings.push({ wall: 'front', kind: 'window', offset: Math.max(x0 + 300, x0 + Math.round(uw / 2 - 500) - 1600), width: 1200, height: 1200, sill: 900, style: 'fixed' });
        for (let l = 1; l < st; l++) openings.push({ wall: 'front', kind: 'window', offset: x0 + Math.round(uw / 2 - 700), width: Math.min(1400, uw - 600), height: 1200, sill: 900, style: 'fixed', level: l });
        openings.push({ wall: 'rear', kind: 'sliding_door', offset: x0 + Math.round(uw / 2 - 900), width: Math.min(1800, uw - 600), height: 2100, sill: 0 });
        for (let l = 1; l < st; l++) openings.push({ wall: 'rear', kind: 'window', offset: x0 + Math.round(uw / 2 - 600), width: Math.min(1200, uw - 600), height: 1200, sill: 900, style: 'fixed', level: l });
        boxes.push({ x0: doorX - 300, x1: doorX + 1300, y0: -1200, y1: 0, z0: 2500, z1: 2620, slot: 'canopy' });
        if (p.yardD > 0) extras.push(poly('yard', rect(x0 + 300, D, x1 - 300, D + p.yardD), `YARD ${i + 1}`));
      }
      if (lane !== undefined && p.rearLane) extras.push(poly('service-lane', rect(0, D + p.yardD, W, D + p.yardD + p.laneW), 'REAR LANE'));
      const symbols = [symPoly(rect(0, 0, W, D), '#555', 'rgba(120,120,120,0.08)'), symLine([{ x: W / 2, y: -1500 }, { x: W / 2, y: 500 }], '#c33', { lw: 2 })];
      for (let i = 1; i < N; i++) symbols.push(symLine([{ x: i * uw, y: 0 }, { x: i * uw, y: D }], '#222', { lw: 3 }));
      for (let i = 0; i < N; i++) symbols.push(symText({ x: i * uw + uw * 0.12, y: D / 2 }, `${i + 1}`));
      symbols.push(symText({ x: W * 0.02, y: -400 }, label.toUpperCase()));
      const gfa = m2(W * D) * st;
      const perDw = gfa / N;
      const bays = N * (p.parkingFactor + (hasGarage ? 0 : 1)); // without a garage each dwelling needs its own bay on the lot
      return {
        W, D, storeys: st, wallH: H, extWallMm: 250, rooms, interior, openings, extras, boxes, symbols, roofs: [{ type: 'gable', pitchDeg: p.roofPitchDeg }],
        extraQuantities: { dwellings: N, garagesPerDwelling: hasGarage ? (p.garage === 'double' ? 2 : 1) : 0, dwellingM2: round1(perDw) },
        perUse: () => ({ residential: round1(gfa) }),
        site: () => ({
          parking: { ratePerM2: [{ use: hasGarage ? 'visitor parking' : 'dwellings and visitors', per: Math.max(1, gfa / Math.max(0.1, bays)), m2: round1(gfa) }], accessible: true },
          vehicles: { design: 'B99', apronDepthMm: 0, docks: 0 },
          landscapeFrontMm: 3000,
          notes: [blurb, 'Garages count toward resident parking; visitor bays are an estimate, check with council. Private open space, solar access and fire separation between dwellings are not checked here.'],
        }),
      };
    },
  });
  return { ...base, presets };
}

export const duplex = housingType({
  id: 'duplex', label: 'Duplex (dual occupancy)', planLabel: 'PROPOSED DUPLEX', fixedDw: true, unitW: 8000, unitWMin: 5500, unitWMax: 14000, depth: 16000, storeys: 2, garage: 'single', yard: 6000,
  presets: [{ id: 'compact', label: 'Compact 2 x 6.5 m wide', params: { unitW: 6500, D: 14000, yardD: 5000 } }, { id: 'standard', label: 'Standard 2 x 8 m wide', params: {} }, { id: 'large', label: 'Large 2 x 10 m wide', params: { unitW: 10000, D: 18000, garage: 'double', yardD: 8000 } }, { id: 'single-storey', label: 'Single storey 2 x 9 m', params: { unitW: 9000, D: 18000, storeys: 1 } }],
  blurb: 'Two attached dwellings on one lot, each with its own entry.',
});
export const townhouseRow = housingType({
  id: 'townhouse-row', label: 'Townhouse row', planLabel: 'PROPOSED TOWNHOUSES', dwMin: 3, dwMax: 14, dwDef: 4, unitW: 6000, unitWMin: 4500, unitWMax: 10000, depth: 14000, storeys: 2, garage: 'single', yard: 5000,
  presets: [{ id: 'three', label: 'Three townhouses', params: { dwellings: 3 } }, { id: 'standard', label: 'Four townhouses', params: {} }, { id: 'six', label: 'Six townhouses', params: { dwellings: 6, yardD: 4000 } }, { id: 'ten', label: 'Ten townhouses', params: { dwellings: 10, yardD: 4000, storeys: 3 } }],
  blurb: 'A row of attached townhouses facing the street.',
});
export const terraceRow = housingType({
  id: 'terrace-row', label: 'Terrace row', planLabel: 'PROPOSED TERRACES', dwMin: 3, dwMax: 16, dwDef: 5, unitW: 5000, unitWMin: 3600, unitWMax: 7000, depth: 12000, storeys: 2, garage: 'none', yard: 4000, lane: true, visitors: 0.3,
  presets: [{ id: 'short', label: 'Short row of 3', params: { dwellings: 3 } }, { id: 'standard', label: 'Row of 5', params: {} }, { id: 'long', label: 'Long row of 8', params: { dwellings: 8, storeys: 3, unitW: 4500 } }, { id: 'no-lane', label: 'Row of 6 without a lane', params: { dwellings: 6, rearLane: false } }],
  blurb: 'Narrow two storey terraces with a rear lane.',
});

export const TYPES_HOUSING = [duplex, townhouseRow, terraceRow];
export default TYPES_HOUSING;
