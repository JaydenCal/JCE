// Small add-on buildings for the Add building picker: amenities block, kiosk, car wash, open canopy and storage shed. Each is a plain
// rectangle (front on local y = 0, facing the street) built through the shared kit so 2D, 3D, quantities and costs agree.
import { defineType, NUM, SEL, rect, m2, round1, poly, symPoly, symLine, symText } from './_kit.js';

const rooms1 = (name, W, D) => [{ name, poly: rect(0, 0, W, D), level: 0 }];
const door = (wall, offset, width = 1000, height = 2100) => ({ wall, kind: 'door', offset, width, height, sill: 0 });
const win = (wall, offset, width = 1800) => ({ wall, kind: 'window', offset, width, height: 1200, sill: 900, style: 'fixed' });
const roller = (wall, offset, width = 3000, height = 3000) => ({ wall, kind: 'roller_door', offset, width, height, sill: 0 });
const frontMark = (W) => symLine([{ x: W / 2, y: -1500 }, { x: W / 2, y: 500 }], '#c33', { lw: 2 });

function simple({ id, label, category, planLabel, rateKey, params, size, openings, zones, parkingRate, notes }) {
  return defineType({
    id, label, category, zonesHint: zones, params, planLabel, buildRateKey: rateKey, costNotes: `${label}. ESTIMATE, check current rates.`,
    spec(p) {
      const { W, D, H } = size(p);
      const gfa = m2(W * D);
      return {
        W, D, storeys: 1, wallH: H, rooms: rooms1(planLabel.replace(/^PROPOSED /, 'PROPOSED '), W, D), interior: [], openings: openings(p, W, D), extras: [],
        boxes: [], symbols: [symPoly(rect(0, 0, W, D), '#666', 'rgba(120,120,120,0.10)'), symText({ x: W * 0.1, y: D / 2 }, label.toUpperCase()), frontMark(W)],
        roofs: [{ type: 'skillion', pitchDeg: 3 }],
        perUse: () => ({ [id]: round1(gfa) }),
        site: () => ({
          parking: { ratePerM2: parkingRate ? [{ use: label.toLowerCase(), per: parkingRate, m2: round1(gfa) }] : [], accessible: !!parkingRate },
          vehicles: { design: 'B99', apronDepthMm: 0, docks: 0 },
          landscapeFrontMm: 1500,
          notes: notes || ['Indicative only, check with council.'],
        }),
      };
    },
  });
}

export const amenitiesBlock = simple({
  id: 'amenities-block', label: 'Amenities block', category: 'office', planLabel: 'PROPOSED AMENITIES BLOCK', rateKey: 'shed',
  zones: ['IN1', 'IN2', 'E1', 'E3', 'B5', 'B6', 'SP2'],
  params: [NUM('W', 'Width', 'mm', 4000, 16000, 500, 8000), NUM('D', 'Depth', 'mm', 3000, 10000, 500, 5000), NUM('H', 'Wall height', 'mm', 2700, 3600, 100, 2700)],
  size: (p) => ({ W: p.W, D: p.D, H: p.H }),
  openings: (p, W, D) => [door('front', Math.round(W / 2 - 600), 1200, 2100), door('rear', Math.round(W / 2 - 500)), win('front', 600, 1200)],
  parkingRate: 0, notes: ['Toilets, lunch room and lockers for staff. Services and accessible toilet to be confirmed.'],
});

export const kiosk = simple({
  id: 'kiosk', label: 'Kiosk', category: 'retail', planLabel: 'PROPOSED KIOSK', rateKey: 'service-station-kiosk',
  zones: ['E1', 'B5', 'B6', 'IN1', 'IN2', 'SP2'],
  params: [NUM('W', 'Width', 'mm', 3000, 12000, 500, 6000), NUM('D', 'Depth', 'mm', 3000, 9000, 500, 5000), NUM('H', 'Wall height', 'mm', 2700, 3600, 100, 3000)],
  size: (p) => ({ W: p.W, D: p.D, H: p.H }),
  openings: (p, W) => [door('front', Math.round(W / 2 - 900), 1800, 2400), win('front', 400, 1400), win('front', W - 1800, 1400)],
  parkingRate: 20,
});

export const carWash = simple({
  id: 'car-wash', label: 'Car wash', category: 'automotive', planLabel: 'PROPOSED CAR WASH', rateKey: 'workshop',
  zones: ['E1', 'B5', 'B6', 'IN1', 'IN2', 'SP2'],
  params: [NUM('W', 'Width', 'mm', 4000, 10000, 500, 5000), NUM('D', 'Length', 'mm', 9000, 30000, 500, 18000), SEL('kind', 'Type', [{ value: 'tunnel', label: 'Automatic tunnel' }, { value: 'bay', label: 'Self serve bays' }], 'tunnel')],
  size: (p) => ({ W: p.W, D: p.D, H: 4200 }),
  openings: (p, W) => [roller('front', Math.round(W / 2 - 1800), 3600, 3600), roller('rear', Math.round(W / 2 - 1800), 3600, 3600)],
  parkingRate: 0, notes: ['Queue space for at least 4 cars before the entry is checked with council. Wastewater to trade waste.'],
});

export const canopyShed = simple({
  id: 'canopy', label: 'Open canopy', category: 'industrial', planLabel: 'PROPOSED CANOPY', rateKey: 'service-station-canopy',
  zones: ['IN1', 'IN2', 'E1', 'E3', 'B5', 'B6', 'SP2'],
  params: [NUM('W', 'Width', 'mm', 4000, 30000, 500, 12000), NUM('D', 'Depth', 'mm', 4000, 20000, 500, 8000), NUM('H', 'Clear height', 'mm', 3000, 6000, 100, 4500)],
  size: (p) => ({ W: p.W, D: p.D, H: p.H }),
  openings: () => [],
  parkingRate: 0, notes: ['Open sided roof on steel posts. Counts as covered area for coverage.'],
});

export const storageShed = simple({
  id: 'storage-shed', label: 'Storage shed', category: 'storage', planLabel: 'PROPOSED STORAGE SHED', rateKey: 'shed',
  zones: ['IN1', 'IN2', 'E1', 'E3', 'RU1', 'RU5'],
  params: [NUM('W', 'Width', 'mm', 4000, 30000, 500, 9000), NUM('D', 'Depth', 'mm', 4000, 30000, 500, 12000), NUM('H', 'Wall height', 'mm', 2700, 6000, 100, 3600)],
  size: (p) => ({ W: p.W, D: p.D, H: p.H }),
  openings: (p, W) => [roller('front', Math.round(W / 2 - 1500), 3000, 3000), door('left', 1500)],
  parkingRate: 200,
});

export const TYPES_SMALL = [amenitiesBlock, canopyShed, carWash, kiosk, storageShed];
export default TYPES_SMALL;
