// Garages: single, double and triple, with a roller or sectional door. A closed gable roofed box, doors in the street (front) wall, an optional
// side personnel door and window. Built through the shared kit so 2D, 3D, quantities and costs agree. Garages need no customer parking.
import { defineType, NUM, SEL, BOOL, rect, m2, round1, symPoly, symLine, symText } from './_kit.js';

const DOOR_KINDS = [{ value: 'roller', label: 'Roller door' }, { value: 'sectional', label: 'Sectional (panel lift) door' }];

function garageType({ id, label, bays, width, presets }) {
  const params = [
    NUM('W', 'Width', 'mm', 2700 * bays, 4500 * bays + 1500, 100, width),
    NUM('D', 'Length', 'mm', 4800, 12000, 100, 6000),
    NUM('H', 'Wall height', 'mm', 2400, 3600, 100, 2700),
    NUM('roofPitchDeg', 'Roof pitch', 'deg', 3, 35, 0.5, 15),
    SEL('doorKind', 'Door type', DOOR_KINDS, 'roller'),
    ...(bays > 1 ? [NUM('doorCount', 'Number of doors', '', 1, bays, 1, bays === 3 ? 2 : bays)] : []),
    NUM('doorH', 'Door height', 'mm', 2100, 3000, 100, 2100),
    BOOL('sideDoor', 'Side personnel door', true),
    BOOL('sideWindow', 'Side window', false),
    BOOL('slab', 'Concrete apron in front of the doors', true),
  ];
  const base = defineType({
    id, label, category: 'sheds', zonesHint: ['R1', 'R2', 'R3', 'R5', 'RU1', 'RU2', 'RU5', 'E4', 'IN1', 'IN2', 'MU1', 'B4'],
    params, planLabel: `PROPOSED ${label.toUpperCase()}`, buildRateKey: 'garage', costNotes: `${label}, slab, frame, cladding and door. ESTIMATE, check current rates.`,
    spec(p) {
      const { W, D, H } = p;
      const dk = p.doorKind === 'sectional' ? 'garage_door' : 'roller_door';
      const n = p.doorCount || 1;
      const margin = 300;
      const slot = (W - 2 * margin) / n;
      const dw = Math.min(5400, Math.max(2400, Math.round((slot - 300) / 100) * 100));
      const dh = Math.min(p.doorH, H - 200);
      const openings = [];
      for (let i = 0; i < n; i++) openings.push({ wall: 'front', kind: dk, offset: Math.round(margin + slot * i + (slot - dw) / 2), width: dw, height: dh, sill: 0 });
      if (p.sideDoor) openings.push({ wall: 'right', kind: 'door', offset: Math.round(D - 1500), width: 900, height: 2040, sill: 0 });
      if (p.sideWindow) openings.push({ wall: 'left', kind: 'window', offset: Math.round(D / 2 - 450), width: 900, height: 900, sill: 1200, style: 'fixed' });
      const boxes = [];
      if (p.slab) boxes.push({ x0: margin, x1: W - margin, y0: -3000, y1: 0, z0: 0, z1: 60, slot: 'concrete' });
      boxes.push({ x0: -150, x1: W + 150, y0: -150, y1: 0, z0: H - 80, z1: H + 40, slot: 'steel' }); // front fascia and gutter
      const gfa = m2(W * D);
      const symbols = [symPoly(rect(0, 0, W, D), '#555', 'rgba(120,120,120,0.10)'), symText({ x: W * 0.12, y: D / 2 }, `${label.toUpperCase()} ${(W / 1000).toFixed(1)} x ${(D / 1000).toFixed(1)}`),
        symLine([{ x: W / 2, y: -1500 }, { x: W / 2, y: 500 }], '#c33', { lw: 2 })];
      for (let i = 1; i < n; i++) symbols.push(symLine([{ x: margin + slot * i, y: 0 }, { x: margin + slot * i, y: 700 }], '#777', { dash: [8, 6] }));
      return {
        W, D, storeys: 1, wallH: H, rooms: [{ name: `PROPOSED ${label.toUpperCase()}`, poly: rect(0, 0, W, D), level: 0 }], interior: [], openings, extras: [], boxes, symbols,
        roofs: [{ type: 'gable', pitchDeg: p.roofPitchDeg }], extraQuantities: { bays, doorWidthMm: dw },
        perUse: () => ({ [id]: round1(gfa) }),
        site: () => ({
          parking: { ratePerM2: [], accessible: false },
          vehicles: { design: 'B99', apronDepthMm: 0, docks: 0 },
          landscapeFrontMm: 1500,
          notes: ['No customer parking is required for a garage; the apron in front of the door holds the car. Setbacks and exempt or complying development limits depend on the council, check with council.'],
        }),
      };
    },
  });
  return { ...base, presets };
}

export const garageSingle = garageType({
  id: 'garage-single', label: 'Single garage', bays: 1, width: 3600,
  presets: [{ id: 'compact', label: 'Compact 3.0 x 5.4 m', params: { W: 3000, D: 5400 } }, { id: 'standard', label: 'Standard 3.6 x 6.0 m', params: { W: 3600, D: 6000 } }, { id: 'long', label: 'With workshop 3.6 x 7.2 m', params: { W: 3600, D: 7200 } }],
});
export const garageDouble = garageType({
  id: 'garage-double', label: 'Double garage', bays: 2, width: 6000,
  presets: [{ id: 'compact', label: 'Compact 5.4 x 5.4 m', params: { W: 5400, D: 5400, doorCount: 1 } }, { id: 'standard', label: 'Standard 6.0 x 6.0 m', params: { W: 6000, D: 6000 } }, { id: 'large', label: 'Large 6.6 x 7.2 m', params: { W: 6600, D: 7200 } }],
});
export const garageTriple = garageType({
  id: 'garage-triple', label: 'Triple garage', bays: 3, width: 9000,
  presets: [{ id: 'standard', label: 'Standard 9.0 x 6.0 m', params: { W: 9000, D: 6000 } }, { id: 'three-doors', label: 'Three doors 9.6 x 6.6 m', params: { W: 9600, D: 6600, doorCount: 3 } }, { id: 'large', label: 'Large 10.5 x 7.2 m', params: { W: 10500, D: 7200 } }],
});

export const TYPES_GARAGE = [garageSingle, garageDouble, garageTriple];
export default TYPES_GARAGE;
