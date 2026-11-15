// Two building types that follow the catalogue interface (src/commercial/catalogue/INTERFACE.md), for the assistant tests. The real
// catalogue is built on another branch; these stand in so the assistant is tested against the interface, not against that code.

const rect = (w, d) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }];

const make = ({ id, label, category, zonesHint, w, d, officeShare, ratePer }) => ({
  id, label, category, zonesHint,
  params: [
    { key: 'widthMm', label: 'Width', type: 'number', unit: 'mm', min: 8000, max: 60000, step: 500, default: w },
    { key: 'depthMm', label: 'Depth', type: 'number', unit: 'mm', min: 10000, max: 80000, step: 500, default: d },
    { key: 'docks', label: 'Loading docks', type: 'number', unit: '', min: 0, max: 10, step: 1, default: 2 },
    { key: 'office', label: 'Office', type: 'bool', default: true },
    { key: 'roof', label: 'Roof', type: 'select', options: ['skillion', 'gable'], default: 'skillion' },
  ],
  defaults: () => ({ widthMm: w, depthMm: d, docks: 2, office: true, roof: 'skillion' }),
  footprint: (p) => ({ outline: rect(p.widthMm, p.depthMm), extras: [] }),
  quantities: (p) => {
    const gfa = (p.widthMm * p.depthMm) / 1e6;
    const office = p.office ? gfa * officeShare : 0;
    return { gfaM2: gfa, groundM2: gfa, upperM2: 0, roofM2: gfa, wallM2: 0, glazingM2: 0, doors: { roller: 1, personnel: 1, dock: p.docks }, perUse: { [category === 'automotive' ? 'workshop' : 'warehouse']: gfa - office, office } };
  },
  site: (p) => ({
    parking: { ratePerM2: [{ use: 'main', per: ratePer, m2: (p.widthMm * p.depthMm) / 1e6 }], accessible: true },
    vehicles: { design: 'MRV', apronDepthMm: 12000, docks: p.docks }, landscapeFrontMm: 3000, notes: [],
  }),
  costHints: { buildRateKey: id },
  planLabel: `PROPOSED ${label.toUpperCase()}`,
});

export const FAKE_TYPES = [
  make({ id: 'warehouse', label: 'Warehouse with loading docks', category: 'industrial', zonesHint: ['E4', 'IN1'], w: 24000, d: 30000, officeShare: 0.1, ratePer: 300 }),
  make({ id: 'workshop', label: 'Workshop', category: 'automotive', zonesHint: ['E4', 'IN1'], w: 15000, d: 20000, officeShare: 0.05, ratePer: 100 }),
];
