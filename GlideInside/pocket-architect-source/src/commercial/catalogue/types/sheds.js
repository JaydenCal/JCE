// Sheds: gable roof shed, skillion (mono-pitch) shed, barn style shed and a lean-to or free standing carport. Plain rectangles with the front on
// local y = 0 facing the street, built through the shared kit. Sheds need no customer parking.
import { defineType, NUM, SEL, BOOL, rect, m2, round1, poly, symPoly, symLine, symText } from './_kit.js';
import { doorOffsets, fitDoors, doorParams, planSymbols, noParkingSite } from './_kitD.js';

const ZONES = ['RU1', 'RU2', 'RU5', 'R5', 'E3', 'E4', 'IN1', 'IN2', 'IN4', 'SP2'];

/** The openings of a shed: roller doors in the front wall, a side personnel door, side windows. */
function shedOpenings(p, W, D, H) {
  const dw = Math.min(p.doorW, W - 1200);
  const n = fitDoors(p.doorCount, W, dw);
  const dh = Math.min(p.doorH, H - 200);
  const ops = doorOffsets(n, W, dw, p.doorPos).map((off) => ({ wall: 'front', kind: 'roller_door', offset: off, width: dw, height: dh, sill: 0 }));
  for (let i = 0; i < (p.personnelDoors || 0); i++) ops.push({ wall: i % 2 ? 'left' : 'right', kind: 'door', offset: Math.round(Math.min(D - 1200, 1500 + 3000 * Math.floor(i / 2))), width: 900, height: 2040, sill: 0 });
  const wins = p.windows || 0;
  for (let i = 0; i < wins; i++) ops.push({ wall: i % 2 ? 'left' : 'right', kind: 'window', offset: Math.round(Math.max(600, Math.min(D - 1800, D * (0.35 + 0.3 * Math.floor(i / 2))))), width: 1200, height: 900, sill: 1200, style: 'fixed' });
  return { ops, doors: n };
}

function shedType({ id, label, planLabel, rateKey, params, roof, extras, presets, notes }) {
  const base = defineType({
    id, label, category: 'sheds', zonesHint: ZONES, params, planLabel, buildRateKey: rateKey, costNotes: `${label}. ESTIMATE, check current rates.`,
    spec(p) {
      const { W, D, H } = p;
      const { ops } = shedOpenings(p, W, D, H);
      const ex = extras ? extras(p) : { extras: [], boxes: [], symbols: [], extraGfa: 0 };
      const boxes = [{ x0: -120, x1: W + 120, y0: -120, y1: 0, z0: H - 80, z1: H + 40, slot: 'steel' }, ...ex.boxes];
      if (p.doorCount > 0) boxes.push({ x0: 300, x1: W - 300, y0: -2500, y1: 0, z0: 0, z1: 60, slot: 'concrete' });
      const gfa = m2(W * D);
      return {
        W, D, storeys: 1, wallH: H, rooms: [{ name: planLabel, poly: rect(0, 0, W, D), level: 0 }], interior: [], openings: ops, extras: ex.extras, boxes,
        symbols: planSymbols(W, D, `${label.toUpperCase()} ${(W / 1000).toFixed(1)} x ${(D / 1000).toFixed(1)}`, ex.symbols), roofs: [roof(p)],
        extraQuantities: { ridgeHeightM: round1((H + (roof(p).type === 'gable' ? (W / 2) : roof(p).type === 'skillion' ? W : 0) * Math.tan((roof(p).pitchDeg * Math.PI) / 180)) / 1000) },
        perUse: () => ({ [id]: round1(gfa) }),
        site: noParkingSite(notes || ['No customer parking is required for a shed. Rural and exempt development limits on size and setbacks vary, check with council.']),
      };
    },
  });
  return { ...base, presets };
}

const commonSize = (w, d, h, wMax = 30000, dMax = 60000) => [
  NUM('W', 'Width', 'mm', 3000, wMax, 100, w),
  NUM('D', 'Length', 'mm', 3000, dMax, 100, d),
  NUM('H', 'Wall height', 'mm', 2400, 6000, 100, h),
];
const sideParams = [NUM('personnelDoors', 'Side personnel doors', '', 0, 4, 1, 1), NUM('windows', 'Side windows', '', 0, 6, 1, 0)];

export const gableShed = shedType({
  id: 'gable-shed', label: 'Gable roof shed', planLabel: 'PROPOSED GABLE SHED', rateKey: 'shed-small',
  params: [...commonSize(6000, 9000, 3000), NUM('roofPitchDeg', 'Roof pitch', 'deg', 5, 35, 0.5, 15), ...doorParams(1, 3000, 2700, 4), ...sideParams],
  roof: (p) => ({ type: 'gable', pitchDeg: p.roofPitchDeg }),
  presets: [{ id: 'small', label: 'Small 4.5 x 6 m', params: { W: 4500, D: 6000, H: 2700, doorW: 2700, doorH: 2400 } }, { id: 'standard', label: 'Standard 6 x 9 m', params: { W: 6000, D: 9000 } },
    { id: 'large', label: 'Large 9 x 15 m', params: { W: 9000, D: 15000, H: 3600, doorCount: 2, doorW: 3600, doorH: 3000, doorPos: 'spread' } }, { id: 'workshop', label: 'Workshop 12 x 18 m', params: { W: 12000, D: 18000, H: 4200, doorCount: 2, doorW: 4200, doorH: 3600, doorPos: 'spread', windows: 2 } }],
});

export const skillionShed = shedType({
  id: 'skillion-shed', label: 'Skillion shed', planLabel: 'PROPOSED SKILLION SHED', rateKey: 'shed-small',
  params: [...commonSize(6000, 9000, 3000), NUM('roofPitchDeg', 'Roof pitch', 'deg', 2, 20, 0.5, 7), ...doorParams(1, 3000, 2700, 4), ...sideParams],
  roof: (p) => ({ type: 'skillion', pitchDeg: p.roofPitchDeg }),
  presets: [{ id: 'small', label: 'Small 3.6 x 6 m', params: { W: 3600, D: 6000, H: 2700, doorW: 2700, doorH: 2400 } }, { id: 'standard', label: 'Standard 6 x 9 m', params: { W: 6000, D: 9000 } },
    { id: 'large', label: 'Large 9 x 12 m', params: { W: 9000, D: 12000, H: 3600, doorCount: 2, doorW: 3600, doorH: 3000, doorPos: 'spread' } }],
});

export const barnShed = shedType({
  id: 'barn-shed', label: 'Barn style shed', planLabel: 'PROPOSED BARN SHED', rateKey: 'shed-small',
  params: [...commonSize(9000, 15000, 4200), NUM('roofPitchDeg', 'Roof pitch', 'deg', 15, 40, 0.5, 30), ...doorParams(1, 4800, 3600, 3), ...sideParams, BOOL('sideLeanTos', 'Side lean-tos either side', true), NUM('leanToW', 'Lean-to width', 'mm', 2400, 6000, 100, 3000)],
  roof: (p) => ({ type: 'gable', pitchDeg: p.roofPitchDeg }),
  extras: (p) => {
    if (!p.sideLeanTos) return { extras: [], boxes: [], symbols: [] };
    const lw = p.leanToW;
    const lh = Math.max(2400, p.H - 600);
    const post = (x, y) => ({ x0: x - 75, x1: x + 75, y0: y - 75, y1: y + 75, z0: 0, z1: lh, slot: 'steel' });
    const boxes = [{ x0: -lw, x1: 0, y0: 0, y1: p.D, z0: lh, z1: lh + 120, slot: 'canopy' }, { x0: p.W, x1: p.W + lw, y0: 0, y1: p.D, z0: lh, z1: lh + 120, slot: 'canopy' }];
    const n = Math.max(2, Math.round(p.D / 5000) + 1);
    for (let i = 0; i < n; i++) { const y = 150 + ((p.D - 300) * i) / (n - 1); boxes.push(post(-lw + 100, y), post(p.W + lw - 100, y)); }
    return {
      extras: [poly('lean-to', rect(-lw, 0, 0, p.D), 'LEAN-TO'), poly('lean-to', rect(p.W, 0, p.W + lw, p.D), 'LEAN-TO')], boxes,
      symbols: [symPoly(rect(-lw, 0, 0, p.D), '#777', 'rgba(0,0,0,0)', { dash: [8, 6] }), symPoly(rect(p.W, 0, p.W + lw, p.D), '#777', 'rgba(0,0,0,0)', { dash: [8, 6] })],
    };
  },
  presets: [{ id: 'standard', label: 'Standard 9 x 15 m', params: {} }, { id: 'hay', label: 'Hay barn 12 x 24 m', params: { W: 12000, D: 24000, H: 4800, doorCount: 2, doorW: 4800, doorH: 4200, doorPos: 'spread' } },
    { id: 'small', label: 'Small barn 6 x 9 m', params: { W: 6000, D: 9000, H: 3600, sideLeanTos: false, doorW: 3600, doorH: 3000 } }],
});

// Lean-to or free standing carport: an open roof on posts. The kit always draws four walls, so the open sides are full width openings.
const MODES = [{ value: 'carport', label: 'Free standing carport (open all sides)' }, { value: 'lean-to', label: 'Lean-to (rear wall against a building)' }];
export const carport = (() => {
  const params = [
    NUM('W', 'Width', 'mm', 2400, 30000, 100, 6000), NUM('D', 'Depth', 'mm', 2400, 20000, 100, 5400), NUM('H', 'Clear height at the low side', 'mm', 2100, 4500, 100, 2700),
    NUM('roofPitchDeg', 'Roof pitch', 'deg', 2, 25, 0.5, 5), SEL('mode', 'Type', MODES, 'carport'), NUM('posts', 'Posts along the front', '', 2, 12, 1, 3),
  ];
  const base = defineType({
    id: 'lean-to-carport', label: 'Lean-to or carport', category: 'sheds', zonesHint: ZONES.concat(['R1', 'R2', 'R3']), params, planLabel: 'PROPOSED CARPORT', buildRateKey: 'carport',
    costNotes: 'Open roof on posts. ESTIMATE, check current rates.',
    spec(p) {
      const { W, D, H } = p;
      const open = (wall, len) => ({ wall, kind: 'opening', offset: 100, width: len - 200, height: H - 150, sill: 0 });
      const openings = [open('front', W), open('left', D), open('right', D)];
      if (p.mode === 'carport') openings.push(open('rear', W));
      const boxes = [{ x0: -250, x1: W + 250, y0: -250, y1: D + 250, z0: H, z1: H + 140, slot: 'canopy' }];
      const post = (x, y) => ({ x0: x - 60, x1: x + 60, y0: y - 60, y1: y + 60, z0: 0, z1: H, slot: 'steel' });
      for (let i = 0; i < p.posts; i++) { const x = 100 + ((W - 200) * i) / (p.posts - 1); boxes.push(post(x, 100)); if (p.mode === 'carport') boxes.push(post(x, D - 100)); }
      if (p.mode === 'lean-to') boxes.push({ x0: 0, x1: W, y0: D - 100, y1: D, z0: 0, z1: H + 140, slot: 'panel' });
      const gfa = m2(W * D);
      const symbols = [symPoly(rect(0, 0, W, D), '#666', 'rgba(120,120,120,0.08)', { dash: [10, 6] }), symText({ x: W * 0.1, y: D / 2 }, p.mode === 'lean-to' ? 'LEAN-TO' : 'CARPORT'),
        symLine([{ x: W / 2, y: -1500 }, { x: W / 2, y: 500 }], '#c33', { lw: 2 })];
      if (p.mode === 'lean-to') symbols.push(symLine([{ x: 0, y: D }, { x: W, y: D }], '#333', { lw: 3 }));
      return {
        W, D, storeys: 1, wallH: H, extWallMm: 100, rooms: [{ name: 'PROPOSED CARPORT', poly: rect(0, 0, W, D), level: 0, outdoor: true }], interior: [], openings, extras: [], boxes, symbols,
        roofs: [{ type: 'skillion', pitchDeg: p.roofPitchDeg }], extraQuantities: { cars: Math.max(1, Math.floor(W / 3000)) },
        perUse: () => ({ carport: round1(gfa) }),
        site: noParkingSite(['Open sided roof on posts, counts as covered area for coverage. Carports in front of the building line have extra limits, check with council.']),
      };
    },
  });
  return {
    ...base,
    presets: [{ id: 'single', label: 'Single 3.0 x 5.4 m', params: { W: 3000, D: 5400, posts: 2 } }, { id: 'double', label: 'Double 6.0 x 5.4 m', params: {} }, { id: 'lean-to', label: 'Lean-to 6.0 x 4.0 m', params: { mode: 'lean-to', D: 4000 } }, { id: 'triple', label: 'Triple 9.0 x 5.4 m', params: { W: 9000, posts: 4 } }],
  };
})();

export const TYPES_SHEDS = [gableShed, skillionShed, barnShed, carport];
export default TYPES_SHEDS;
