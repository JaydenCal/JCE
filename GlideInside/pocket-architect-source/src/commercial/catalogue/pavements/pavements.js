// Commercial pavement types: indicative layered make-ups with use classes, a rate key (rates.json), a plan colour and hatch, and a 3D texture
// descriptor (view3d.js draws the canvas texture from it). Pure data, no DOM.
//
// Every make-up is indicative only. Thicknesses are typical regional NSW concept values for the stated use, NOT a design: the pavement
// thickness depends on subgrade CBR, design traffic (ESAs) and drainage, and is designed to AGPT02 (Austroads Guide to Pavement Technology
// Part 2, structural design) by a suitably qualified engineer. Layer thicknesses are in mm, top layer first.

export const MAKEUP_NOTE = 'Indicative make-up, design to AGPT02 by a suitably qualified engineer';

/** Use classes a pavement can serve. 'yard' is an unsealed or lightly trafficked working area. */
export const USES = Object.freeze(['car', 'truck', 'pedestrian', 'yard']);

const P = (o) => Object.freeze({ indicative: true, note: MAKEUP_NOTE, ...o, layers: Object.freeze(o.layers.map((l) => Object.freeze(l))) });

export const PAVEMENTS = Object.freeze([
  P({
    id: 'concrete-heavy',
    label: 'Heavy duty reinforced concrete',
    short: 'Heavy duty concrete',
    use: ['truck', 'car'],
    where: 'Truck apron in front of roller doors, loading dock, waste pad',
    layers: [
      { material: 'Reinforced concrete N40, SL92 top and bottom mesh, 200 mm, saw cut and dowelled joints', thicknessMm: 200 },
      { material: 'Lean mix concrete or cement treated crushed rock subbase', thicknessMm: 150 },
      { material: 'Select fill or improved subgrade', thicknessMm: 200 },
    ],
    rateKey: 'concrete-heavy',
    colour: '#bdb9ae',
    hatch2d: { pattern: 'cross', angleDeg: 45, spacingMm: 1500, line: '#6f6b60', fill: 'rgba(160,156,146,0.30)' },
    texture3d: { kind: 'concrete', base: '#c9c2b2', tileM: 4, joints: { alongM: 4, acrossM: 4 }, broom: true },
  }),
  P({
    id: 'concrete-light',
    label: 'Light duty concrete',
    short: 'Light duty concrete',
    use: ['car', 'pedestrian'],
    where: 'Car park, forecourt, light vehicle hardstand',
    layers: [
      { material: 'Reinforced concrete N32, SL82 mesh, 125 mm, saw cut joints', thicknessMm: 125 },
      { material: 'Crushed rock base DGB20', thicknessMm: 150 },
    ],
    rateKey: 'concrete-light',
    colour: '#c6c2b8',
    hatch2d: { pattern: 'diag', angleDeg: 45, spacingMm: 1200, line: '#7b776c', fill: 'rgba(176,172,162,0.28)' },
    texture3d: { kind: 'concrete', base: '#cec7b8', tileM: 3, joints: { alongM: 3, acrossM: 3 }, broom: true },
  }),
  P({
    id: 'asphalt-ac10-car',
    label: 'Asphalt AC10 over granular base, car',
    short: 'Asphalt AC10, car',
    use: ['car'],
    where: 'Car aisles and bays',
    layers: [
      { material: 'Dense graded asphalt AC10', thicknessMm: 40 },
      { material: 'Crushed rock base DGB20', thicknessMm: 150 },
      { material: 'Crushed rock subbase DGS40', thicknessMm: 150 },
    ],
    rateKey: 'asphalt-ac10-car',
    colour: '#45484b',
    hatch2d: { pattern: 'stipple', angleDeg: 0, spacingMm: 900, line: '#555a60', fill: 'rgba(80,84,90,0.30)' },
    texture3d: { kind: 'asphalt', base: '#45484b', tileM: 3 },
  }),
  P({
    id: 'asphalt-ac14-car',
    label: 'Asphalt AC14 over granular base, car',
    short: 'Asphalt AC14, car',
    use: ['car'],
    where: 'Car park with a coarser, more robust wearing course',
    layers: [
      { material: 'Dense graded asphalt AC14', thicknessMm: 40 },
      { material: 'Crushed rock base DGB20', thicknessMm: 150 },
      { material: 'Crushed rock subbase DGS40', thicknessMm: 150 },
    ],
    rateKey: 'asphalt-ac14-car',
    colour: '#4a4d50',
    hatch2d: { pattern: 'stipple', angleDeg: 0, spacingMm: 800, line: '#5b6066', fill: 'rgba(84,88,94,0.32)' },
    texture3d: { kind: 'asphalt', base: '#4a4d50', tileM: 3, coarse: true },
  }),
  P({
    id: 'asphalt-ac10-truck',
    label: 'Asphalt AC10 wearing course over AC14 and granular base, truck',
    short: 'Asphalt AC10 on AC14, truck',
    use: ['truck', 'car'],
    where: 'Truck circulation lanes and driveways',
    layers: [
      { material: 'Dense graded asphalt AC10 wearing course', thicknessMm: 30 },
      { material: 'Dense graded asphalt AC14 base course', thicknessMm: 50 },
      { material: 'Crushed rock base DGB20', thicknessMm: 200 },
      { material: 'Crushed rock subbase DGS40', thicknessMm: 250 },
    ],
    rateKey: 'asphalt-ac10-truck',
    colour: '#3f4245',
    hatch2d: { pattern: 'stipple', angleDeg: 0, spacingMm: 700, line: '#4b5056', fill: 'rgba(70,74,80,0.40)' },
    texture3d: { kind: 'asphalt', base: '#3f4245', tileM: 3 },
  }),
  P({
    id: 'asphalt-ac14-truck',
    label: 'Asphalt AC14 over granular base, truck',
    short: 'Asphalt AC14, truck',
    use: ['truck', 'car'],
    where: 'Truck circulation lanes, heavier traffic',
    layers: [
      { material: 'Dense graded asphalt AC14 wearing course', thicknessMm: 50 },
      { material: 'Dense graded asphalt AC20 base course', thicknessMm: 60 },
      { material: 'Crushed rock base DGB20', thicknessMm: 200 },
      { material: 'Crushed rock subbase DGS40', thicknessMm: 250 },
    ],
    rateKey: 'asphalt-ac14-truck',
    colour: '#3c3f42',
    hatch2d: { pattern: 'stipple', angleDeg: 0, spacingMm: 650, line: '#464b51', fill: 'rgba(66,70,76,0.42)' },
    texture3d: { kind: 'asphalt', base: '#3c3f42', tileM: 3, coarse: true },
  }),
  P({
    id: 'spray-seal',
    label: 'Two coat spray seal over granular base',
    short: 'Two coat spray seal',
    use: ['car', 'truck', 'yard'],
    where: 'Low traffic access roads and overflow parking',
    layers: [
      { material: 'Two coat bitumen spray seal, 14 mm then 7 mm aggregate', thicknessMm: 20 },
      { material: 'Crushed rock base DGB20', thicknessMm: 200 },
      { material: 'Crushed rock subbase DGS40', thicknessMm: 150 },
    ],
    rateKey: 'spray-seal',
    colour: '#6b6a66',
    hatch2d: { pattern: 'dots', angleDeg: 0, spacingMm: 700, line: '#6b6a66', fill: 'rgba(120,118,112,0.26)' },
    texture3d: { kind: 'seal', base: '#6d6c68', tileM: 3 },
  }),
  P({
    id: 'gravel-yard',
    label: 'Crushed rock or gravel yard',
    short: 'Gravel yard',
    use: ['yard', 'car', 'truck'],
    where: 'Storage and laydown yard, overflow parking',
    layers: [
      { material: 'Compacted crushed rock wearing course, 20 mm nominal', thicknessMm: 100 },
      { material: 'Crushed rock base DGB20', thicknessMm: 200 },
    ],
    rateKey: 'gravel-yard',
    colour: '#a79a82',
    hatch2d: { pattern: 'gravel', angleDeg: 0, spacingMm: 600, line: '#8c7f68', fill: 'rgba(190,176,148,0.40)' },
    texture3d: { kind: 'gravel', base: '#a89c84', tileM: 3 },
  }),
  P({
    id: 'permeable-pavers',
    label: 'Permeable interlocking pavers on open graded base',
    short: 'Permeable pavers',
    use: ['car'],
    where: 'Visitor parking where infiltration or water quality credit is wanted',
    layers: [
      { material: 'Permeable interlocking concrete pavers with open joints, 80 mm', thicknessMm: 80 },
      { material: 'Bedding and joint fill, 2 mm to 5 mm aggregate', thicknessMm: 30 },
      { material: 'Open graded base, 7 mm aggregate', thicknessMm: 100 },
      { material: 'Open graded subbase reservoir, 20 mm to 40 mm aggregate, with geotextile', thicknessMm: 250 },
    ],
    rateKey: 'permeable-pavers',
    colour: '#9a9a96',
    hatch2d: { pattern: 'herringbone', angleDeg: 45, spacingMm: 500, line: '#6f706c', fill: 'rgba(150,152,148,0.34)' },
    texture3d: { kind: 'permeable', base: '#9b9b97', tileM: 2.4 },
  }),
  P({
    id: 'concrete-footpath',
    label: 'Pedestrian concrete footpath',
    short: 'Concrete footpath',
    use: ['pedestrian'],
    where: 'Footpaths and accessible paths of travel',
    layers: [
      { material: 'Concrete N25, SL72 mesh, 100 mm, broom finish, control joints', thicknessMm: 100 },
      { material: 'Crushed rock bedding DGB20', thicknessMm: 75 },
    ],
    rateKey: 'concrete-footpath',
    colour: '#cfccc3',
    hatch2d: { pattern: 'grid', angleDeg: 0, spacingMm: 1500, line: '#8a867b', fill: 'rgba(208,205,196,0.45)' },
    texture3d: { kind: 'concrete', base: '#d6d0c2', tileM: 1.5, joints: { alongM: 1.5, acrossM: 1.5 }, broom: true },
  }),
  P({
    id: 'unit-pavers-ped',
    label: 'Pedestrian unit pavers',
    short: 'Unit pavers',
    use: ['pedestrian'],
    where: 'Entry plazas and feature paths',
    layers: [
      { material: 'Concrete unit pavers, 60 mm, stretcher bond', thicknessMm: 60 },
      { material: 'Bedding sand', thicknessMm: 30 },
      { material: 'Crushed rock base DGB20', thicknessMm: 100 },
    ],
    rateKey: 'unit-pavers-ped',
    colour: '#b3a08a',
    hatch2d: { pattern: 'brick', angleDeg: 0, spacingMm: 400, line: '#7f6f5d', fill: 'rgba(190,170,146,0.40)' },
    texture3d: { kind: 'pavers', base: '#b4a28d', tileM: 2.4 },
  }),
  P({
    id: 'exposed-aggregate',
    label: 'Exposed aggregate feature paving',
    short: 'Exposed aggregate',
    use: ['pedestrian', 'car'],
    where: 'Entries, forecourts and feature areas',
    layers: [
      { material: 'Exposed aggregate concrete N32, SL82 mesh, 100 mm, saw cut joints', thicknessMm: 100 },
      { material: 'Crushed rock base DGB20', thicknessMm: 100 },
    ],
    rateKey: 'exposed-aggregate',
    colour: '#b9ad9a',
    hatch2d: { pattern: 'aggregate', angleDeg: 0, spacingMm: 450, line: '#7b6f5d', fill: 'rgba(188,176,156,0.42)' },
    texture3d: { kind: 'aggregate', base: '#b9ad9b', tileM: 2.4, joints: { alongM: 2.4, acrossM: 2.4 } },
  }),
]);

const BY_ID = new Map(PAVEMENTS.map((p) => [p.id, p]));

export const pavementById = (id) => BY_ID.get(id) || null;
export const isPavementType = (id) => BY_ID.has(id);
export const totalThicknessMm = (p) => (p?.layers || []).reduce((s, l) => s + l.thicknessMm, 0);
export const pavementsForUse = (use) => PAVEMENTS.filter((p) => p.use.includes(use));

/** Make-up as plain lines for a schedule: "AC10 40 mm / DGB20 150 mm / ...". */
export function makeUpText(p) {
  const t = typeof p === 'string' ? pavementById(p) : p;
  if (!t) return '';
  return t.layers.map((l) => `${l.material} ${l.thicknessMm} mm`).join('; ');
}

/** Short make-up for a table cell: "40 + 150 + 150 mm, 340 mm total". */
export function makeUpShort(p) {
  const t = typeof p === 'string' ? pavementById(p) : p;
  if (!t) return '';
  return `${t.layers.map((l) => l.thicknessMm).join(' + ')} mm (${totalThicknessMm(t)} mm total)`;
}

/** The pavement type a layout role gets when nothing overrides it. */
export const ROLE_DEFAULTS = Object.freeze({
  apron: 'concrete-heavy', // truck apron in front of the roller doors
  aisle: 'asphalt-ac10-car', // car aisle
  bays: 'asphalt-ac10-car', // parking bays
  footpath: 'concrete-footpath',
  waste: 'concrete-heavy', // bin truck pad
  yard: 'gravel-yard',
});
