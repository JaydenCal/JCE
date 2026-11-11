// Plan Studio project schema, version 1. All lengths in millimetres, angles in degrees.
// Plan coordinates: x to the right, y down the screen. See docs/SCOPE.md section 9.

export const SCHEMA_VERSION = 1;

export const PROJECT_TYPES = ['house', 'unit', 'shed', 'extension'];
export const STATUS = ['new', 'existing', 'demolish'];
export const ROOF_TYPES = ['hip', 'gable', 'skillion', 'flat'];
export const OPENING_KINDS = ['window', 'door', 'sliding_door', 'garage_door', 'roller_door', 'opening'];
export const WINDOW_STYLES = ['sliding', 'awning', 'fixed', 'double_hung', 'louvre'];
export const ROOM_TYPES = [
  'living', 'family', 'kitchen', 'dining', 'bedroom', 'bathroom', 'ensuite', 'wc', 'laundry',
  'garage', 'carport', 'study', 'entry', 'hall', 'robe', 'pantry', 'media', 'rumpus',
  'workshop', 'store', 'deck', 'patio', 'alfresco', 'verandah', 'other',
];
export const OUTDOOR_TYPES = ['deck', 'patio', 'alfresco', 'verandah', 'carport'];
export const ROOFED_OUTDOOR_TYPES = ['alfresco', 'verandah', 'carport'];

export const ROOM_LABELS = {
  living: 'Living', family: 'Family', kitchen: 'Kitchen', dining: 'Dining', bedroom: 'Bedroom',
  bathroom: 'Bathroom', ensuite: 'Ensuite', wc: 'WC', laundry: 'Laundry', garage: 'Garage',
  carport: 'Carport', study: 'Study', entry: 'Entry', hall: 'Hall', robe: 'Robe', pantry: 'Pantry',
  media: 'Media', rumpus: 'Rumpus', workshop: 'Workshop', store: 'Store', deck: 'Deck',
  patio: 'Patio', alfresco: 'Alfresco', verandah: 'Verandah', other: 'Room',
};

// Colour and material ids must exist in src/catalogue/finishes.js.
export const DEFAULT_FINISHES = {
  externalWalls: { material: 'brick', colour: 'brick-light-grey' },
  internalWalls: { material: 'paint', colour: 'paint-white' },
  roof: { material: 'corrugated', colour: 'steel-charcoal' },
  fascia: { colour: 'steel-charcoal' },
  frames: { colour: 'frame-black' },
  floors: { material: 'timber', colour: 'floor-natural-oak' },
};

export const DEFAULT_FINISHES_SHED = {
  externalWalls: { material: 'corrugated', colour: 'steel-off-white' },
  internalWalls: { material: 'corrugated', colour: 'steel-off-white' },
  roof: { material: 'corrugated', colour: 'steel-off-white' },
  fascia: { colour: 'steel-charcoal' },
  frames: { colour: 'steel-charcoal' },
  floors: { material: 'polished_concrete', colour: 'floor-concrete' },
};

export const DEFAULTS = {
  gridMm: 100,
  snapMm: 50,
  extWall: 250,
  intWall: 100,
  shedWall: 100,
  ceiling: 2550,
  shedHeight: 3600,
  floorToFloor: 3000,
  roof: {
    house: { type: 'hip', pitch: 22.5, overhang: 450 },
    shed: { type: 'gable', pitch: 11, overhang: 150 },
  },
  openings: {
    window: { width: 1800, height: 1200, sill: 900, style: 'sliding' },
    door: { width: 820, height: 2040, sill: 0, style: 'hinged' },
    sliding_door: { width: 2400, height: 2100, sill: 0, style: 'sliding' },
    garage_door: { width: 4800, height: 2100, sill: 0, style: 'panel' },
    roller_door: { width: 3000, height: 3000, sill: 0, style: 'roller' },
    opening: { width: 900, height: 2040, sill: 0, style: 'none' },
  },
  // Standard round rainwater tanks: capacity (L), diameter and height (mm).
  tanks: [
    { capacityL: 2000, diameter: 1350, height: 1600 },
    { capacityL: 5000, diameter: 1850, height: 2000 },
    { capacityL: 10000, diameter: 2400, height: 2400 },
    { capacityL: 22500, diameter: 3600, height: 2400 },
  ],
  tankColour: 'steel-dune',
};

export function uid(prefix = 'e') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

const pt = (p) => ({ x: Number(p.x), y: Number(p.y) });

export function roofDefaults(type) {
  return { enabled: true, ...(type === 'shed' ? DEFAULTS.roof.shed : DEFAULTS.roof.house) };
}

export function tankSize(capacityL) {
  const std = DEFAULTS.tanks.find((t) => t.capacityL === capacityL);
  if (std) return { diameter: std.diameter, height: std.height };
  const height = capacityL <= 5000 ? 2000 : 2400;
  const volumeMm3 = capacityL * 1e6 * 1.08; // allow for freeboard
  const diameter = Math.round(Math.sqrt((4 * volumeMm3) / (Math.PI * height)) / 10) * 10;
  return { diameter, height };
}

export function createLevel(opts = {}) {
  return {
    id: opts.id || uid('l'),
    name: opts.name || 'Ground',
    elevation: opts.elevation ?? 0,
    height: opts.height ?? DEFAULTS.ceiling,
    roof: { ...roofDefaults('house'), ...(opts.roof || {}) },
    walls: [],
    openings: [],
    rooms: [],
    furniture: [],
    stairs: [],
  };
}

export function createProject(opts = {}) {
  const type = PROJECT_TYPES.includes(opts.type) ? opts.type : 'house';
  const now = new Date().toISOString();
  const shed = type === 'shed';
  return {
    schema: SCHEMA_VERSION,
    id: opts.id || uid('p'),
    name: opts.name || 'Untitled design',
    type,
    createdAt: now,
    updatedAt: now,
    settings: {
      gridMm: DEFAULTS.gridMm,
      snapMm: DEFAULTS.snapMm,
      extWall: shed ? DEFAULTS.shedWall : DEFAULTS.extWall,
      intWall: DEFAULTS.intWall,
      floorToFloor: DEFAULTS.floorToFloor,
    },
    finishes: structuredClone(shed ? DEFAULT_FINISHES_SHED : DEFAULT_FINISHES),
    site: { northDeg: 0, underlay: null, tanks: [] },
    titleBlock: defaultTitleBlock(),
    drawing: { scale: 'auto', paper: 'A3' },
    levels: [
      createLevel({
        name: 'Ground',
        elevation: 0,
        height: shed ? DEFAULTS.shedHeight : DEFAULTS.ceiling,
        roof: roofDefaults(type),
      }),
    ],
  };
}

export function createWall({ a, b, thickness = null, height = null, status = 'new' }) {
  return {
    id: uid('w'),
    a: pt(a),
    b: pt(b),
    thickness: thickness ?? DEFAULTS.extWall,
    height,
    kind: 'exterior',
    outside: 0,
    auto: thickness == null,
    status,
    finish: null,
  };
}

export function createOpening(opts) {
  const kind = opts.kind || 'window';
  const d = DEFAULTS.openings[kind] || DEFAULTS.openings.window;
  return {
    id: uid('o'),
    wallId: opts.wallId,
    kind,
    offset: Number(opts.offset ?? 0),
    width: Number(opts.width ?? d.width),
    height: Number(opts.height ?? d.height),
    sill: Number(opts.sill ?? d.sill),
    style: opts.style ?? d.style,
    hinge: kind === 'door' ? (opts.hinge === 'b' ? 'b' : 'a') : null,
    side: opts.side === -1 ? -1 : 1,
    status: opts.status || 'new',
  };
}

export function createRoom(opts) {
  const type = ROOM_TYPES.includes(opts.type) ? opts.type : 'other';
  const outdoor = opts.outdoor ?? OUTDOOR_TYPES.includes(type);
  return {
    id: uid('r'),
    name: opts.name ?? ROOM_LABELS[type],
    type,
    polygon: opts.polygon.map(pt),
    floor: opts.floor ?? null,
    outdoor,
    roofed: opts.roofed ?? ROOFED_OUTDOOR_TYPES.includes(type),
    balustrade: opts.balustrade ?? false,
    status: opts.status || 'new',
  };
}

export function createFurniture({ item, x, y, rotation = 0, w = null, d = null }) {
  return { id: uid('f'), item, x: Number(x), y: Number(y), rotation: Number(rotation) || 0, w, d };
}

export function createStair({ x, y, width = 1000, length = 3600, rotation = 0 }) {
  return { id: uid('s'), x: Number(x), y: Number(y), width: Number(width), length: Number(length), rotation: Number(rotation) || 0 };
}

export function createTank({ x, y, capacityL = 5000, colour, status = 'new' }) {
  const size = tankSize(capacityL);
  return {
    id: uid('t'),
    x: Number(x),
    y: Number(y),
    capacityL,
    diameter: size.diameter,
    height: size.height,
    colour: colour || DEFAULTS.tankColour,
    status,
  };
}

// Bring an older or partial project up to the current schema. Throws on unusable input.
export function migrate(input) {
  if (!input || typeof input !== 'object') throw new Error('Not a Plan Studio project file');
  const p = structuredClone(input);
  if (!p.schema) throw new Error('Not a Plan Studio project file (no schema version)');
  if (p.schema > SCHEMA_VERSION) throw new Error('This project was saved by a newer version of Plan Studio');
  p.settings = { ...createProject({ type: p.type }).settings, ...(p.settings || {}) };
  p.finishes = { ...structuredClone(p.type === 'shed' ? DEFAULT_FINISHES_SHED : DEFAULT_FINISHES), ...(p.finishes || {}) };
  p.titleBlock = { ...defaultTitleBlock(), ...(p.titleBlock || {}) };
  p.drawing = { scale: 'auto', paper: 'A3', ...(p.drawing || {}) };
  p.site = { northDeg: 0, underlay: null, tanks: [], ...(p.site || {}) };
  if (!Array.isArray(p.levels) || !p.levels.length) p.levels = [createLevel()];
  for (const l of p.levels) {
    for (const key of ['walls', 'openings', 'rooms', 'furniture', 'stairs']) if (!Array.isArray(l[key])) l[key] = [];
    l.roof = { ...roofDefaults(p.type), ...(l.roof || {}) };
  }
  return p;
}

// Structural checks. Returns a list of problems (empty when valid).
export function validate(p) {
  const errors = [];
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  if (!p || p.schema !== SCHEMA_VERSION) errors.push('schema version missing or unsupported');
  if (!Array.isArray(p?.levels) || !p.levels.length) {
    errors.push('project has no levels');
    return errors;
  }
  const ids = new Set();
  const seen = (id, what) => {
    if (!id) errors.push(`${what} without id`);
    else if (ids.has(id)) errors.push(`duplicate id ${id}`);
    ids.add(id);
  };
  for (const l of p.levels) {
    seen(l.id, 'level');
    const wallIds = new Set();
    for (const w of l.walls) {
      seen(w.id, 'wall');
      wallIds.add(w.id);
      if (![w.a?.x, w.a?.y, w.b?.x, w.b?.y, w.thickness].every(finite)) errors.push(`wall ${w.id} has invalid geometry`);
    }
    for (const o of l.openings) {
      seen(o.id, 'opening');
      if (!wallIds.has(o.wallId)) errors.push(`opening ${o.id} is not on a wall of level ${l.name}`);
      if (![o.offset, o.width, o.height, o.sill].every(finite)) errors.push(`opening ${o.id} has invalid size`);
    }
    for (const r of l.rooms) {
      seen(r.id, 'room');
      if (!Array.isArray(r.polygon) || r.polygon.length < 3 || !r.polygon.every((q) => finite(q.x) && finite(q.y))) errors.push(`room ${r.id} has an invalid outline`);
    }
    for (const f of l.furniture) {
      seen(f.id, 'furniture');
      if (![f.x, f.y].every(finite)) errors.push(`furniture ${f.id} has an invalid position`);
    }
    for (const s of l.stairs) seen(s.id, 'stair');
  }
  for (const t of p.site?.tanks || []) seen(t.id, 'tank');
  return errors;
}

// Title block fields printed on drawing sheets. All user-editable; nothing is pre-filled with a company name.
export const TITLE_BLOCK_FIELDS = [
  ['projectName', 'Project'], ['client', 'Client'], ['address', 'Site address'], ['lotDp', 'Lot and DP'],
  ['council', 'Council'], ['company', 'Prepared by (company)'], ['drawnBy', 'Drawn'], ['checkedBy', 'Checked'],
  ['jobNumber', 'Job number'], ['drawingPrefix', 'Drawing number prefix'], ['revision', 'Revision'],
  ['issuePurpose', 'Issue purpose'], ['date', 'Date (DD/MM/YYYY)'], ['notes', 'Notes'],
];
export function defaultTitleBlock() {
  const o = Object.fromEntries(TITLE_BLOCK_FIELDS.map(([k]) => [k, '']));
  o.revision = 'A';
  o.issuePurpose = 'Concept';
  o.drawingPrefix = 'PS';
  return o;
}
export const DRAWING_SCALES = ['auto', 20, 50, 100, 200, 500];
export const PAPER_SIZES = ['A3', 'A1'];
